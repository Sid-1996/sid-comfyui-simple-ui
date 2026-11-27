"""comfy_lora_paths.py — 唯讀重建 ComfyUI LoRA 搜尋路徑（Phase B1 / R1）。

Windows only，只用 Python 標準庫。不啟動／停止服務、不建目錄、不下載、不碰 GPU。

R1 重要結論：短命子程序重新 import folder_paths、重讀目前 YAML 只能得到「重建候選」，
**不能證明 live ComfyUI 的實際路徑**：prestartup script 可在 apply_custom_paths() 之後
改變 folder_paths，YAML 也可能在啟動後被修改。因此本模組最大只給 B（不可下載），
A 級必須另有來自 live process 的獨立驗證來源（目前沒有，見 B1 R1 報告）。
"""

from __future__ import annotations

import ctypes
import json
import os
import struct
import subprocess
import sys
import unicodedata
from ctypes import wintypes

MAX_CMDLINE_CHARS = 32768
MAX_ARGV = 4096
MAX_ARG_CHARS = 8192
MAX_PATH_CHARS = 32768
MAX_ENV_BYTES = 262144
READ_CHUNK_BYTES = 8192

# 只列真正會影響 LoRA 目錄的旗標；其他旗標不拿來判斷 CWD 依賴。
PATH_FLAGS = (
    "--base-directory",
    "--models-directory",
    "--output-directory",
    "--extra-model-paths-config",
)

_SUPERSCRIPTS = tuple(chr(cp) for cp in (185, 178, 179))  # ¹ ² ³（避免終端編碼問題）
RESERVED_NAMES = frozenset(
    ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"]
    + ["COM%d" % i for i in range(1, 10)]
    + ["LPT%d" % i for i in range(1, 10)]
    + ["COM" + s for s in _SUPERSCRIPTS]
    + ["LPT" + s for s in _SUPERSCRIPTS]
)
ILLEGAL_CHARS = frozenset('<>:"|?*\\/')
ENV_MARKERS = ("$", "%", "~")

MAX_FILENAME_CHARS = 200
MAX_FULL_PATH_CHARS = 259

# Windows 處理器架構（SYSTEM_INFO.wProcessorArchitecture）
PROCESSOR_ARCHITECTURE_AMD64 = 9
PROCESSOR_ARCH_NAMES = {
    0: "x86", 6: "IA64", 9: "AMD64", 12: "ARM64", 0xFFFF: "UNKNOWN",
}
# IsWow64Process2 回傳的 IMAGE_FILE_MACHINE_*
IMAGE_FILE_MACHINE_AMD64 = 0x8664
IMAGE_FILE_MACHINE_ARM64 = 0xAA64
IMAGE_FILE_MACHINE_I386 = 0x014C
PROCESS_ARCH_NAMES = {
    IMAGE_FILE_MACHINE_I386: "x86",
    IMAGE_FILE_MACHINE_AMD64: "AMD64",
    IMAGE_FILE_MACHINE_ARM64: "ARM64",
}


class ResolverError(Exception):
    """內部解析失敗；附帶穩定 code。"""

    def __init__(self, code, message=""):
        super().__init__(message or code)
        self.code = code


class _ReadFailure(Exception):
    pass


# ── Windows command line ──────────────────────────────────────────────

def parse_windows_command_line(cmdline):
    """用 shell32.CommandLineToArgvW 解析 Windows 命令行；禁用 shlex.split()。"""
    if sys.platform != "win32":
        raise ResolverError("UNSUPPORTED_PLATFORM")
    if not isinstance(cmdline, str) or not cmdline.strip():
        raise ResolverError("BAD_COMMANDLINE")
    if len(cmdline) > MAX_CMDLINE_CHARS:
        raise ResolverError("BAD_COMMANDLINE")

    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    shell32.CommandLineToArgvW.restype = ctypes.POINTER(ctypes.c_wchar_p)
    shell32.CommandLineToArgvW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
    count = ctypes.c_int()
    arr = shell32.CommandLineToArgvW(cmdline, ctypes.byref(count))
    if not arr:
        raise ResolverError("BAD_COMMANDLINE")
    try:
        n = count.value
        if n <= 0 or n > MAX_ARGV:
            raise ResolverError("BAD_COMMANDLINE")
        out = []
        for i in range(n):
            arg = arr[i]
            if arg is None or len(arg) > MAX_ARG_CHARS:
                raise ResolverError("BAD_COMMANDLINE")
            out.append(arg)
        return out
    finally:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.LocalFree.argtypes = [wintypes.HANDLE]
        kernel32.LocalFree.restype = wintypes.HANDLE
        kernel32.LocalFree(ctypes.cast(arr, wintypes.HANDLE))


def path_args_from_argv(argv):
    """回傳 [(flag, value)]；同時接受 `--flag value` 與 `--flag=value`。"""
    values = []
    i = 0
    while i < len(argv):
        tok = argv[i]
        flag, sep, inline = tok.partition("=")
        if flag not in PATH_FLAGS:
            i += 1
            continue
        if sep:
            values.append((flag, inline))
            i += 1
            continue
        if flag == "--extra-model-paths-config":
            # argparse nargs='+'：吃到下一個旗標為止。
            i += 1
            while i < len(argv) and not argv[i].startswith("-"):
                values.append((flag, argv[i]))
                i += 1
            continue
        if i + 1 < len(argv):
            values.append((flag, argv[i + 1]))
        i += 2 if not sep else 1
    return values


def cwd_dependent_args(argv):
    """回傳需要啟動時 CWD 才能還原的相對路徑參數；空串代表沒有。"""
    bad = []
    for flag, value in path_args_from_argv(argv):
        if (not value or not os.path.isabs(value)) and flag not in bad:
            bad.append(flag)
    return bad


def redact_argv(argv):
    """只保留旗標名稱，不回傳任何參數值／路徑／金鑰。"""
    flags = []
    for tok in argv:
        flag = tok.split("=", 1)[0]
        if flag.startswith("-") and flag not in flags:
            flags.append(flag)
    return flags


def comfy_argv_from_argv(argv, cwd):
    """從完整命令行取出 ComfyUI 的 argv。

    命令行前面可能含 Python 自己的旗標（例如 `-s`），argparse 不認識，
    必須從 main.py 那一格開始才算 ComfyUI 的參數。
    回傳 (comfy_argv, main_py, comfy_root) 或 (None, None, None)。
    """
    for i, tok in enumerate(argv):
        if os.path.basename(tok).lower() != "main.py":
            continue
        main_py = tok if os.path.isabs(tok) else os.path.abspath(os.path.join(cwd, tok))
        main_py = os.path.normpath(main_py)
        if os.path.isfile(main_py):
            return argv[i:], main_py, os.path.dirname(main_py)
    return None, None, None


def main_py_from_argv(argv, cwd):
    """相容性包裝：回傳 (main_py, comfy_root) 或 (None, None)。"""
    _, main_py, comfy_root = comfy_argv_from_argv(argv, cwd)
    return main_py, comfy_root


# ── 唯讀 PEB 讀取 ─────────────────────────────────────────────────────

class _PROCESS_BASIC_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("Reserved1", ctypes.c_void_p),
        ("PebBaseAddress", ctypes.c_void_p),
        ("Reserved2", ctypes.c_void_p * 2),
        ("UniqueProcessId", ctypes.c_void_p),
        ("Reserved3", ctypes.c_void_p),
    ]


class _SYSTEM_INFO(ctypes.Structure):
    _fields_ = [
        ("wProcessorArchitecture", wintypes.WORD),
        ("wReserved", wintypes.WORD),
        ("dwPageSize", wintypes.DWORD),
        ("lpMinimumApplicationAddress", ctypes.c_void_p),
        ("lpMaximumApplicationAddress", ctypes.c_void_p),
        ("dwActiveProcessorMask", ctypes.c_void_p),
        ("dwNumberOfProcessors", wintypes.DWORD),
        ("dwProcessorType", wintypes.DWORD),
        ("dwAllocationGranularity", wintypes.DWORD),
        ("wProcessorLevel", wintypes.WORD),
        ("wProcessorRevision", wintypes.WORD),
    ]


def get_native_architecture():
    """用 GetNativeSystemInfo 取得實際處理器架構，不能用 pointer size 代替。"""
    if sys.platform != "win32":
        return "UNKNOWN"
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.GetNativeSystemInfo.argtypes = [ctypes.POINTER(_SYSTEM_INFO)]
    k.GetNativeSystemInfo.restype = None
    si = _SYSTEM_INFO()
    k.GetNativeSystemInfo(ctypes.byref(si))
    return PROCESSOR_ARCH_NAMES.get(si.wProcessorArchitecture, "UNKNOWN")


def get_process_architecture(handle):
    """用 IsWow64Process2 取得目標行程架構；不可用時回 None（未知）。"""
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    fn = getattr(k, "IsWow64Process2", None)
    if fn is None:
        return None
    fn.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.WORD), ctypes.POINTER(wintypes.WORD)]
    fn.restype = wintypes.BOOL
    proc = wintypes.WORD()
    native = wintypes.WORD()
    if not fn(handle, ctypes.byref(proc), ctypes.byref(native)):
        return None
    # proc=IMAGE_FILE_MACHINE_UNKNOWN(0) 代表「未被模擬」，即與原生架構相同。
    machine = proc.value if proc.value else native.value
    return PROCESS_ARCH_NAMES.get(machine, "UNKNOWN")


def _kernel32():
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    k.OpenProcess.restype = wintypes.HANDLE
    k.CloseHandle.argtypes = [wintypes.HANDLE]
    k.CloseHandle.restype = wintypes.BOOL
    k.ReadProcessMemory.argtypes = [
        wintypes.HANDLE, wintypes.LPCVOID, wintypes.LPVOID,
        ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
    k.ReadProcessMemory.restype = wintypes.BOOL
    k.IsWow64Process.argtypes = [wintypes.HANDLE, ctypes.POINTER(ctypes.c_int)]
    k.IsWow64Process.restype = wintypes.BOOL
    return k


def _read_exact(k, handle, address, size):
    if address <= 0 or size <= 0 or size > MAX_ENV_BYTES:
        raise _ReadFailure("bad range")
    buf = ctypes.create_string_buffer(size)
    got = ctypes.c_size_t(0)
    if not k.ReadProcessMemory(handle, ctypes.c_void_p(address), buf, size, ctypes.byref(got)):
        raise _ReadFailure("ReadProcessMemory failed")
    if got.value != size:
        raise _ReadFailure("short read")
    return buf.raw


def _read_ptr(k, handle, address):
    return struct.unpack("<Q", _read_exact(k, handle, address, 8))[0]


def _read_unicode_string(k, handle, address):
    raw = _read_exact(k, handle, address, 16)
    # x64 UNICODE_STRING：Length(2) + MaximumLength(2) + 4 bytes padding + Buffer ptr(8)
    length, max_len, buffer_addr = struct.unpack("<HH4xQ", raw)
    if length % 2 or length > MAX_PATH_CHARS * 2 or max_len < length:
        raise _ReadFailure("bad UNICODE_STRING")
    if length == 0:
        return ""
    return _read_exact(k, handle, buffer_addr, length).decode("utf-16-le", "strict")


def _read_env_block(k, handle, address):
    if address <= 0:
        raise _ReadFailure("bad env address")
    acc = bytearray()
    offset = 0
    text = None
    while len(acc) < MAX_ENV_BYTES:
        size = min(READ_CHUNK_BYTES, MAX_ENV_BYTES - len(acc))
        acc.extend(_read_exact(k, handle, address + offset, size))
        if len(acc) % 2 == 0:
            # 用替換解碼找結尾，避免 chunk 剛好切在 surrogate pair 中間時誤判。
            candidate = bytes(acc).decode("utf-16-le", "replace")
            # 用 UTF-16 字元層級找結尾，避免把 ASCII 位元組高位 00 誤當成 NUL 边界。
            if "\x00\x00" in candidate:
                try:
                    full = bytes(acc).decode("utf-16-le", "strict")
                except UnicodeDecodeError:
                    full = candidate
                text = full.split("\x00\x00", 1)[0]
                break
        offset += size
    if text is None:
        raise _ReadFailure("env block too large")
    env = {}
    for item in text.split("\x00"):
        if not item:
            continue
        key, sep, value = item.partition("=")
        if sep and key:
            env[key] = value
    return env


def read_process_parameters(pid):
    """唯讀取得目標 PID 的當下 CWD／EnvironmentBlock／CommandLine／ImagePathName。

    回傳 dict；失敗時 `ok=False`、`code` 為穩定原因。绝不回傳環境變數值給上層日誌。
    """
    if sys.platform != "win32":
        return {"ok": False, "code": "UNSUPPORTED_PLATFORM"}
    if ctypes.sizeof(ctypes.c_void_p) != 8:
        return {"ok": False, "code": "UNSUPPORTED_ARCH"}
    if get_native_architecture() != "AMD64":
        # 只驗證過 x64 AMD64 的 PEB offset；ARM64／未知一律不使用。
        return {"ok": False, "code": "UNSUPPORTED_ARCH"}
    try:
        pid = int(pid)
        if pid <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return {"ok": False, "code": "BAD_PID"}

    k = _kernel32()
    handle = k.OpenProcess(0x1000 | 0x0010, False, pid)  # QUERY_LIMITED_INFO | VM_READ
    if not handle:
        return {"ok": False, "code": "ACCESS_DENIED"}
    try:
        proc_arch = get_process_architecture(handle)
        if proc_arch is None:
            return {"ok": False, "code": "BITNESS_UNKNOWN"}
        if proc_arch != "AMD64":
            return {"ok": False, "code": "UNSUPPORTED_ARCH", "bitness": proc_arch}

        ntdll = ctypes.WinDLL("ntdll", use_last_error=True)
        ntdll.NtQueryInformationProcess.argtypes = [
            wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID,
            ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong)]
        ntdll.NtQueryInformationProcess.restype = ctypes.c_long
        pbi = _PROCESS_BASIC_INFORMATION()
        status = ntdll.NtQueryInformationProcess(
            handle, 0, ctypes.byref(pbi), ctypes.sizeof(pbi), None)
        if status != 0 or not pbi.PebBaseAddress:
            return {"ok": False, "code": "PEB_QUERY_FAILED"}
        peb = ctypes.cast(pbi.PebBaseAddress, ctypes.c_void_p).value

        rtl = _read_ptr(k, handle, peb + 0x20)
        if rtl <= 0:
            return {"ok": False, "code": "PEB_INVALID"}
        cwd = _read_unicode_string(k, handle, rtl + 0x38)
        image = _read_unicode_string(k, handle, rtl + 0x60)
        cmdline = _read_unicode_string(k, handle, rtl + 0x70)
        env = _read_env_block(k, handle, _read_ptr(k, handle, rtl + 0x80))
        if not cwd or not image or not cmdline:
            return {"ok": False, "code": "PEB_INCOMPLETE"}
        if not os.path.isabs(cwd) or not os.path.isabs(image):
            return {"ok": False, "code": "PEB_INCOMPLETE"}
        return {
            "ok": True,
            "bitness": "x64",
            "cwd": cwd,
            "image": image,
            "command_line": cmdline,
            "env": env,
            "env_key_count": len(env),
        }
    except _ReadFailure as exc:
        return {"ok": False, "code": "PEB_READ_FAILED", "detail": str(exc)}
    finally:
        k.CloseHandle(handle)


# ── 行程發現 ──────────────────────────────────────────────────────────

# 用 raw string 明確寫出 PowerShell 要收到的 regex：只有一個 `\.`，不再有雙重跳脫的歧義。
_WMI_NAME_REGEX = r'^python(w)?\.exe$'
_WMI_PS = (
    "Get-CimInstance Win32_Process | "
    # 不可加 `-and $_.CommandLine`：那會在候選分析前就排除 CommandLine 為空／不可讀的行程。
    "Where-Object { $_.Name -match '" + _WMI_NAME_REGEX + "' } | "
    "Select-Object ProcessId,Name,ExecutablePath,CommandLine,CreationDate | "
    "ConvertTo-Json -Compress -Depth 3"
)
_WMI_BY_PID = (
    "Get-CimInstance Win32_Process -Filter \"ProcessId = %d\" | "
    "Select-Object ProcessId,Name,ExecutablePath,CommandLine,CreationDate | "
    "ConvertTo-Json -Compress -Depth 3"
)


def _default_run_ps(cmd):
    return subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd],
        capture_output=True, text=True, timeout=20, check=False)


def _wmi_query(cmd, run_ps):
    try:
        proc = run_ps(cmd)
    except Exception:
        return []
    if proc.returncode != 0 or not (proc.stdout or "").strip():
        return []
    try:
        data = json.loads(proc.stdout)
    except Exception:
        return []
    if isinstance(data, dict):
        data = [data]
    return [x for x in data if isinstance(x, dict)]


def discover_python_processes(run_ps=None):
    """回傳 WMI 查到的 python 行程列表（只讀，含 CreationDate）。"""
    if sys.platform != "win32":
        return []
    return _wmi_query(_WMI_PS, run_ps or _default_run_ps)


def confirm_process_identity(pid, run_ps=None):
    """再次查 WMI 核對 PID 身分；回傳單一 dict，查不到／重複回 None。"""
    if sys.platform != "win32":
        return None
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return None
    rows = _wmi_query(_WMI_BY_PID % pid, run_ps or _default_run_ps)
    return rows[0] if len(rows) == 1 else None


def valid_executable_path(value):
    """WMI ExecutablePath 必須存在、非空且為有效絕對路徑；空值绝不放行。"""
    if not isinstance(value, str):
        return False
    value = value.strip()
    if not value or not os.path.isabs(value) or len(value) > MAX_PATH_CHARS:
        return False
    if any(seg == ".." for seg in value.replace("/", "\\").split("\\")):
        return False
    return bool(os.path.basename(os.path.normpath(value)))


def same_process_identity(before, after, image=None):
    """比對兩次 WMI snapshot；ExecutablePath 缺失／無效一律失敗，不讓空值相等放行。"""
    if not after:
        return False
    before_exe = before.get("ExecutablePath")
    after_exe = after.get("ExecutablePath")
    if not valid_executable_path(before_exe) or not valid_executable_path(after_exe):
        return False
    norm = lambda p: os.path.normcase(os.path.normpath(p))
    if norm(before_exe) != norm(after_exe):
        return False
    if image and norm(before_exe) != norm(image):
        return False
    for key in ("ProcessId", "CommandLine", "CreationDate"):
        if str(before.get(key) or "") != str(after.get(key) or ""):
            return False
    return True


# ── 子程序 probe ──────────────────────────────────────────────────────

def run_child_probe(exe, module_path, argv, cwd, env, comfy_root, main_py, timeout=90):
    """用 ComfyUI 自己的 Python 重現 apply_custom_paths() 的路徑部分。"""
    if not exe or not os.path.isfile(exe):
        raise ResolverError("BAD_PYTHON_EXE")
    request = {
        "argv": list(argv), "cwd": cwd, "env": dict(env),
        "comfy_root": comfy_root, "main_py": main_py,
    }
    try:
        proc = subprocess.run(
            [exe, module_path, "--probe-child"],
            input=json.dumps(request), capture_output=True, text=True,
            cwd=cwd, env=dict(env), timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ResolverError("PROBE_FAILED", str(exc)) from exc
    if proc.returncode != 0:
        raise ResolverError("PROBE_FAILED")
    try:
        out = json.loads(proc.stdout)
    except Exception as exc:
        raise ResolverError("PROBE_BAD_JSON") from exc
    if not isinstance(out, dict) or out.get("ok") is not True:
        raise ResolverError("PROBE_FAILED", str(out.get("error", "")) if isinstance(out, dict) else "")
    return out


def _probe_child_main():
    """子程序模式：重現初始化順序，輸出 JSON；绝不 import main.py 或初始化 GPU。"""
    req = json.load(sys.stdin)
    sys.argv = list(req["argv"])
    os.chdir(req["cwd"])
    os.environ.clear()
    os.environ.update(req["env"])
    comfy_root = req["comfy_root"]
    main_py = req["main_py"]
    sys.path.insert(0, comfy_root)

    import comfy.options
    comfy.options.enable_args_parsing(True)
    import folder_paths
    import utils.extra_config
    from comfy.cli_args import args

    root_yaml = os.path.join(os.path.dirname(os.path.realpath(main_py)), "extra_model_paths.yaml")
    yamls = []
    if os.path.isfile(root_yaml):
        yamls.append(root_yaml)
    if args.extra_model_paths_config:
        for group in args.extra_model_paths_config:
            for path in group:
                yamls.append(path)

    env_sensitive = []
    for path in yamls:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            raw = f.read()
        if any(marker in raw for marker in ENV_MARKERS):
            env_sensitive.append(path)

    # 順序必須與 main.py:137-167 的 apply_custom_paths() 完全一致。
    for path in yamls:
        utils.extra_config.load_extra_path_config(path)
    if args.output_directory:
        folder_paths.set_output_directory(os.path.abspath(args.output_directory))
    for kind in ("checkpoints", "clip", "vae", "diffusion_models", "loras"):
        folder_paths.add_model_folder_path(
            kind, os.path.join(folder_paths.get_output_directory(), kind))

    print(json.dumps({
        "ok": True,
        "comfy_root": comfy_root,
        "main_py": main_py,
        "output_directory": folder_paths.get_output_directory(),
        "loras": folder_paths.get_folder_paths("loras"),
        "env_sensitive": env_sensitive,
    }))


# ── 檔名安全 ──────────────────────────────────────────────────────────

def validate_full_path(directory, name):
    """驗證最終目的地完整路徑長度；避免只驗檔名卻漏掉實際目標路徑。"""
    if (not isinstance(directory, str) or not isinstance(name, str)
            or not directory or not name):
        return False, "PATH_INVALID"
    full = os.path.join(directory, name)
    if len(full) > MAX_FULL_PATH_CHARS:
        return False, "FULL_PATH_TOO_LONG"
    if "/" in name or "\\" in name or ".." in name:
        return False, "PATH_SEPARATOR"
    return True, ""


def sanitize_lora_filename(raw, directory=None):
    """回傳 (ok, name, code)。原始輸入含路徑分隔符一律拒絕，不做 basename 剝除。"""
    if not isinstance(raw, str) or not raw:
        return False, "", "FILENAME_INVALID"
    if "/" in raw or "\\" in raw:
        return False, "", "PATH_SEPARATOR"
    if ".." in raw or raw in (".", ".."):
        return False, "", "DOT_DOT"
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in raw):
        return False, "", "CONTROL_CHAR"

    name = unicodedata.normalize("NFC", raw)
    if any(ch in ILLEGAL_CHARS for ch in name):
        return False, "", "ILLEGAL_CHAR"
    if name != name.rstrip(" ."):
        return False, "", "TRAILING_SPACE_OR_DOT"
    name = name.strip()
    if not name or any(ch in ILLEGAL_CHARS for ch in name) or name != name.rstrip(" ."):
        return False, "", "FILENAME_INVALID"
    stem_raw = name.split(".", 1)[0]
    if stem_raw != stem_raw.rstrip(" ."):
        return False, "", "TRAILING_SPACE_OR_DOT"
    stem = stem_raw.upper()
    if stem in RESERVED_NAMES:
        return False, "", "RESERVED_NAME"
    if len(name) > MAX_FILENAME_CHARS:
        return False, "", "TOO_LONG"
    if not name.lower().endswith(".safetensors"):
        return False, "", "BAD_EXTENSION"
    if name.lower() == ".safetensors":
        return False, "", "EMPTY_STEM"
    if directory is not None:
        ok, code = validate_full_path(directory, name)
        if not ok:
            return False, "", code
    return True, name, ""


def filename_collides(name, existing_names):
    """NFC + 不分大小寫比對；用於同名遮蔽檢查。"""
    key = unicodedata.normalize("NFC", name).casefold()
    return any(unicodedata.normalize("NFC", str(x)).casefold() == key for x in existing_names)


# ── 組裝結果 ──────────────────────────────────────────────────────────

def _result(grade, code, message, **extra):
    out = {
        "grade": grade,
        "usable": grade == "A",
        "code": code,
        "error": message,
        "loras": [],
        "evidence": {},
        "reasons": [],
    }
    out.update(extra)
    return out


def _validate_child_loras(out, comfy_root):
    loras = out.get("loras")
    if not isinstance(loras, list) or not loras:
        raise ResolverError("PROBE_BAD_PATHS")
    seen = set()
    clean = []
    for item in loras:
        if not isinstance(item, str) or not os.path.isabs(item):
            raise ResolverError("PROBE_BAD_PATHS")
        if len(item) > 600 or any(seg == ".." for seg in item.split(os.sep)):
            raise ResolverError("PROBE_BAD_PATHS")
        key = os.path.normcase(os.path.normpath(item))
        if key in seen:
            raise ResolverError("PROBE_BAD_PATHS")
        seen.add(key)
        clean.append(os.path.normpath(item))
    if not clean:
        raise ResolverError("PROBE_BAD_PATHS")
    if os.path.normcase(os.path.normpath(out.get("comfy_root") or "")) != os.path.normcase(comfy_root):
        raise ResolverError("PROBE_ROOT_MISMATCH")
    output_dir = out.get("output_directory")
    if not isinstance(output_dir, str) or not os.path.isabs(output_dir):
        raise ResolverError("PROBE_BAD_PATHS")
    sensitive = out.get("env_sensitive")
    if not isinstance(sensitive, list):
        raise ResolverError("PROBE_BAD_JSON")
    return clean, sensitive


def resolve_lora_paths(*, pid=None, discover=None, read_params=None, run_probe=None,
                       module_path=None, confirm=None):
    """重建 ComfyUI LoRA 路徑；R1 起最大只給 B（不可下載）。

    所有外部依賴都可注入，方便隔離測試；預設值才會碰真實 Windows API。
    """
    reasons = []
    find = discover or discover_python_processes
    read = read_params or read_process_parameters
    probe = run_probe or run_child_probe
    confirm = confirm or confirm_process_identity
    module_path = module_path or os.path.abspath(__file__)

    if sys.platform != "win32":
        return _result("C", "UNSUPPORTED_PLATFORM", "這個功能只支援 Windows。")

    candidates = [{"ProcessId": pid}] if pid else find()
    if not candidates:
        return _result("C", "NO_COMFY_PROCESS",
                       "找不到正在執行的 ComfyUI，無法確認模型目錄；請先啟動 ComfyUI 後再試。")

    # 任何「可能是 ComfyUI」的候選都必須被排除或完整讀取，不能只挑讀得成功的那個。
    # CommandLine 為空／null／不可讀者視為未知候選，绝不可當成非 ComfyUI 排除。
    suspects = []
    unknown = []
    for cand in candidates:
        raw_cmd = cand.get("CommandLine")
        if not isinstance(raw_cmd, str) or not raw_cmd.strip():
            unknown.append(cand)
            continue
        cmd = raw_cmd.lower()
        if "simple_ui" in cmd and "server.py" in cmd:
            continue  # 明確判定為 simple_ui 自己的行程
        if "main.py" in cmd:
            suspects.append(cand)
    if unknown:
        reasons.append("有 %d 個 Python 候選的 CommandLine 不可讀，無法判定身分" % len(unknown))
        return _result("C", "UNKNOWN_CANDIDATE",
                       "有 Python 行程的啟動資訊讀不到，無法確認是否為 ComfyUI；為安全起見暫不提供路徑資訊。",
                       reasons=reasons)
    if not suspects:
        return _result("C", "NO_COMFY_PROCESS",
                       "找不到正在執行的 ComfyUI，無法確認模型目錄；請先啟動 ComfyUI 後再試。")
    if len(suspects) != 1:
        return _result("C", "MULTIPLE_CANDIDATES",
                       "找到多個可能是 ComfyUI 的行程，無法確認哪一個是實際使用的；請只開一個 ComfyUI。",
                       reasons=["候選行程數：%d" % len(suspects)])

    cand = suspects[0]
    ev = read(cand.get("ProcessId"))
    if not ev.get("ok"):
        code = ev.get("code") or "UNKNOWN"
        soft = code in ("UNSUPPORTED_ARCH", "BITNESS_UNKNOWN", "WOW64")
        return _result("B" if soft else "C", code,
                       "無法確認 ComfyUI 行程的架構或內容，為安全起見暫不提供路徑資訊。"
                       if soft else
                       "讀不到 ComfyUI 行程資料，無法確認模型目錄；請確認 ComfyUI 正常執行。",
                       reasons=[code])

    try:
        argv = parse_windows_command_line(ev["command_line"])
    except ResolverError:
        return _result("C", "BAD_COMMANDLINE", "ComfyUI 的啟動參數無法解析。")

    comfy_argv, main_py, comfy_root = comfy_argv_from_argv(argv, ev["cwd"])
    if not comfy_argv or not main_py or not comfy_root:
        return _result("C", "NO_MAIN_PY", "找不到 ComfyUI 主程式路徑，無法重建模型目錄。")
    if not os.path.isfile(os.path.join(comfy_root, "folder_paths.py")):
        return _result("C", "NO_COMFY_ROOT", "ComfyUI 安裝不完整，無法重建模型目錄。")

    # WMI ExecutablePath / PEB ImagePathName / argv[0] 三方交叉確認。
    arg0 = argv[0]
    if os.path.dirname(arg0):
        same_argv_exe = (os.path.normcase(os.path.normpath(ev["image"])) ==
                         os.path.normcase(os.path.normpath(arg0)))
    else:
        same_argv_exe = os.path.normcase(os.path.basename(ev["image"])) == os.path.normcase(arg0)
    wmi_exe = cand.get("ExecutablePath")
    if not valid_executable_path(wmi_exe):
        reasons.append("第一次 WMI snapshot 缺少有效的 ExecutablePath")
        return _result("C", "EXECUTABLE_PATH_INVALID",
                       "ComfyUI 行程的執行檔資訊不完整，為安全起見暫不提供路徑資訊。",
                       reasons=reasons)
    same_wmi_exe = (os.path.normcase(os.path.normpath(wmi_exe)) ==
                    os.path.normcase(os.path.normpath(ev["image"])))
    if not same_argv_exe or not same_wmi_exe:
        reasons.append("ExecutablePath／ImagePathName／argv[0] 不一致")
        return _result("C", "IDENTITY_MISMATCH",
                       "ComfyUI 行程身分無法確認，為安全起見暫不提供路徑資訊。",
                       reasons=reasons)

    # 再查一次 WMI，防止 PID 結束後被回收而誤用舊資料；第二次也必須有有效 ExecutablePath。
    after = confirm(cand.get("ProcessId"))
    if not valid_executable_path(after.get("ExecutablePath") if after else None):
        reasons.append("第二次 WMI snapshot 缺少有效的 ExecutablePath")
        return _result("C", "EXECUTABLE_PATH_INVALID",
                       "ComfyUI 行程的執行檔資訊不完整，為安全起見暫不提供路徑資訊。",
                       reasons=reasons)
    if not same_process_identity(cand, after, ev["image"]):
        reasons.append("PID 身分在讀取前後不一致或無法再次確認")
        return _result("C", "IDENTITY_MISMATCH",
                       "ComfyUI 行程身分無法確認，為安全起見暫不提供路徑資訊。",
                       reasons=reasons)

    evidence = {
        "pid": cand.get("ProcessId"),
        "bitness": ev["bitness"],
        "argv_flags": redact_argv(comfy_argv),
        "argv_count": len(comfy_argv),
        "env_key_count": ev["env_key_count"],
        "cwd_is_current_not_startup": True,
        "env_is_current_not_startup": True,
        "env_used": False,
        "verification": "none",
        "sources": [],
    }
    cwd_args = cwd_dependent_args(comfy_argv)
    if cwd_args:
        reasons.append("相對路徑參數依賴啟動時 CWD：" + ", ".join(sorted(set(cwd_args))))
        return _result("C", "CWD_UNPROVEN",
                       "ComfyUI 的啟動設定含相對路徑，無法確認實際模型目錄；請改用絕對路徑後重新啟動 ComfyUI。",
                       evidence=evidence, reasons=reasons)

    try:
        child = probe(ev["image"], module_path, comfy_argv, ev["cwd"], ev["env"],
                      comfy_root, main_py)
        loras, sensitive = _validate_child_loras(child, comfy_root)
    except ResolverError as exc:
        reasons.append(exc.code)
        return _result("C", exc.code,
                       "無法可靠還原 ComfyUI 的模型目錄；請確認 ComfyUI 安裝完整後再試。",
                       evidence=evidence, reasons=reasons)

    evidence["env_used"] = bool(sensitive)
    evidence["sources"] = ["canonical", "yaml", "output_directory"]
    if sensitive:
        reasons.append("yaml 使用環境變數展開，當下 EnvironmentBlock 不足以證明啟動時的值")
        return _result("C", "ENV_UNPROVEN",
                       "ComfyUI 的模型路徑使用了環境變數，無法確認啟動時的實際值；為了安全起見暫不下載。",
                       evidence=evidence, reasons=reasons)

    # 重建成功 ≠ live 證明。prestartup script 與啟動後修改過的 YAML 都無法排除。
    reasons.append("只有重建候選，缺少 live process 的獨立驗證來源")
    return _result("B", "LIVE_UNVERIFIED",
                   "已重建 LoRA 路徑，但無法證明與正在執行的 ComfyUI 完全一致；為了安全起見暫不提供下載。",
                   loras=loras, evidence=evidence, reasons=reasons)


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "--probe-child":
        try:
            _probe_child_main()
        except Exception as exc:
            print(json.dumps({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}))
            sys.exit(1)
        return
    print(json.dumps(resolve_lora_paths(), ensure_ascii=False))


if __name__ == "__main__":
    main()
