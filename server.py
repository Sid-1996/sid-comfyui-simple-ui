"""簡易生圖的本機伺服器。

  python server.py  ->  http://127.0.0.1:7860

負責三件事：
  1. 提供 simple_ui 底下的靜態檔（.html / .css / .js / assets 圖檔）
  2. 把 /comfy/* 反向代理到 ComfyUI（預設 127.0.0.1:8188，可用 COMFY_URL 覆寫）
  3. /start-comfy 一鍵啟動 ComfyUI、/open-output 開啟圖片資料夾
"""

import base64
import ctypes
import hashlib
import http.server
import importlib
import json
import mimetypes
import os
import re
import select
import shlex
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from ctypes import wintypes
from decimal import Decimal, InvalidOperation

def _parse_comfy_url(raw):
    """解析 COMFY_URL；只允許本機 loopback。回傳 (base, host, port, scheme, external)。"""
    text = (raw or "").strip()
    if not text:
        return "http://127.0.0.1:8188", "127.0.0.1", 8188, "http", False
    # 空的 ? / # 不會出現在 parts.query / parts.fragment，必須直接檢查原始字串
    if "?" in text or "#" in text:
        raise ValueError("COMFY_URL 不可包含 query 或 fragment（含空的 ? 或 # 分隔符）")
    try:
        parts = urllib.parse.urlsplit(text)
    except Exception as exc:
        raise ValueError("COMFY_URL 格式不正確：%s" % exc)
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise ValueError("COMFY_URL 只支援 http 或 https，目前是「%s」" % (parts.scheme or "空白"))
    host = (parts.hostname or "").lower()
    if host not in ("127.0.0.1", "localhost"):
        raise ValueError("COMFY_URL 只支援本機 127.0.0.1 或 localhost，目前是「%s」" % (parts.hostname or "空白"))
    if parts.username is not None or parts.password is not None:
        raise ValueError("COMFY_URL 不可包含帳號或密碼")
    if parts.query or parts.fragment:
        raise ValueError("COMFY_URL 不可包含 query 或 fragment")
    if parts.path not in ("", "/"):
        raise ValueError("COMFY_URL 不可包含路徑，請只填到 port（例：http://127.0.0.1:8189）")
    try:
        port = parts.port
    except ValueError as exc:
        raise ValueError("COMFY_URL 的 port 不合法：%s" % exc)
    if port is None:
        raise ValueError("COMFY_URL 必須明確指定 port（例：http://127.0.0.1:8189）")
    if not 1 <= port <= 65535:
        raise ValueError("COMFY_URL 的 port 必須在 1～65535 之間，目前是 %s" % port)
    return "%s://%s:%d" % (scheme, host, port), host, port, scheme, True


_COMFY_ERROR = ""
try:
    COMFY, COMFY_HOST, COMFY_PORT, COMFY_SCHEME, COMFY_EXTERNAL = _parse_comfy_url(
        os.environ.get("COMFY_URL", ""))
except ValueError as exc:
    # 設定錯誤時不靜默退回預設：main() 會在啟動前明確終止
    COMFY, COMFY_HOST, COMFY_PORT, COMFY_SCHEME, COMFY_EXTERNAL = (
        "http://127.0.0.1:8188", "127.0.0.1", 8188, "http", False)
    _COMFY_ERROR = str(exc)

APP_NAME = "SidSimpleUI"


def _user_data_dir():
    """Sid-simple-ui 專用的使用者資料根目錄；絕對不指向開發者路徑。"""
    base = (os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or
            tempfile.gettempdir())
    try:
        return os.path.join(base, APP_NAME)
    except Exception:
        return os.path.join(tempfile.gettempdir(), APP_NAME)


def _parse_dir_override(raw, label):
    """解析可選目錄覆寫；只接受絕對路徑，無效時回 (None, 原因)。不建立目錄。"""
    text = os.path.expandvars(os.path.expanduser((raw or "").strip()))
    if not text:
        return None, ""
    if "\0" in text or not os.path.isabs(text):
        return None, label + " 必須是絕對路徑"
    try:
        return os.path.realpath(text), ""
    except (OSError, ValueError) as exc:
        return None, label + " 路徑不合法：" + str(exc)


DATA_DIR = _user_data_dir()
_LOG_DIR, _LOG_DIR_ERROR = _parse_dir_override(
    os.environ.get("SIMPLE_UI_LOG_DIR", ""), "SIMPLE_UI_LOG_DIR")
LOG_DIR = _LOG_DIR or os.path.join(DATA_DIR, "logs")


# ── Civitai Personal API Key：Windows DPAPI（CurrentUser）──────────────
# 只保護「靜態資料」：不能抵禦同一 Windows 使用者權限下的惡意程式。
# Key 與目前 Windows 使用者帳號（及機器）綁定，換帳號／換機必須重新輸入。
KEY_FILE_NAME = "civitai_key.bin"
_KEY_PATH = os.path.join(DATA_DIR, KEY_FILE_NAME)
_KEY_BODY_LIMIT = 4096
_CIVITAI_AUTH_HOSTS = {"civitai.com"}
# 正式值固定為官方 /me；只有隔離測試才覆蓋為本機 mock（不進環境變數）。
CIVITAI_ME_URL = "https://civitai.com/api/v1/me"


class KeyStoreError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _blob(data):
    keep = ctypes.create_string_buffer(data if data else b"\0")
    return _DATA_BLOB(len(data), ctypes.cast(keep, ctypes.POINTER(ctypes.c_byte))), keep


def _crypt32():
    if os.name != "nt":
        raise KeyStoreError("DPAPI_UNSUPPORTED", "只能在 Windows 上使用本機金鑰保護。")
    dll = ctypes.WinDLL("crypt32", use_last_error=True)
    sig = [ctypes.POINTER(_DATA_BLOB), wintypes.LPCWSTR, ctypes.POINTER(_DATA_BLOB),
           wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(_DATA_BLOB)]
    dll.CryptProtectData.argtypes = sig
    dll.CryptProtectData.restype = wintypes.BOOL
    dll.CryptUnprotectData.argtypes = sig
    dll.CryptUnprotectData.restype = wintypes.BOOL
    return dll


def _free_blob(blob):
    try:
        kernel = ctypes.windll.kernel32
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree.restype = ctypes.c_void_p
        kernel.LocalFree(ctypes.cast(blob.pbData, ctypes.c_void_p))
    except Exception:
        pass


def _dpapi_protect(plain):
    dll = _crypt32()
    src, keep = _blob(plain)
    out = _DATA_BLOB()
    # CRYPTPROTECT_UI_FORBIDDEN = 0x1；CurrentUser（不用 LocalMachine）
    if not dll.CryptProtectData(ctypes.byref(src), "SidSimpleUI Civitai Key",
                                None, None, None, 0x1, ctypes.byref(out)):
        raise KeyStoreError("DPAPI_ERROR", "Windows 無法加密這把金鑰。")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        _free_blob(out)


def _dpapi_unprotect(cipher):
    dll = _crypt32()
    src, keep = _blob(cipher)
    out = _DATA_BLOB()
    if not dll.CryptUnprotectData(ctypes.byref(src), None, None, None, None,
                                  0x1, ctypes.byref(out)):
        raise KeyStoreError("KEY_DECRYPT_FAILED",
                            "這台電腦無法讀取已儲存的金鑰，請重新輸入。")
    try:
        return bytes(ctypes.string_at(out.pbData, out.cbData))
    finally:
        _free_blob(out)


def _validate_key_text(key):
    if not isinstance(key, str):
        return False, "金鑰格式不正確。"
    k = key.strip()
    if not k:
        return False, "請輸入 Civitai API Key。"
    if len(k) < 8 or len(k) > 512:
        return False, "金鑰長度必須在 8～512 字元之間。"
    if any(ord(c) < 33 or ord(c) > 126 for c in k):
        return False, "金鑰不能包含空白或控制字元。"
    return True, k


def _atomic_write_key(cipher):
    folder = os.path.dirname(_KEY_PATH) or "."
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="civitai_key_", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(cipher)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, _KEY_PATH)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def save_api_key(key):
    ok, result = _validate_key_text(key)
    if not ok:
        return False, result
    try:
        cipher = _dpapi_protect(result.encode("utf-8"))
        _atomic_write_key(cipher)
        return True, ""
    except KeyStoreError as exc:
        return False, exc.message
    except OSError:
        return False, "無法寫入本機金鑰檔，請檢查 %s 的寫入權限。" % DATA_DIR
    except Exception:
        return False, "無法儲存金鑰，請稍後再試一次。"


def read_api_key():
    """只在呼叫端區域變數中解密；不快取明文於全域、不寫日誌。"""
    try:
        with open(_KEY_PATH, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        raise KeyStoreError("KEY_NOT_SET", "尚未設定 Civitai API Key。")
    except OSError:
        raise KeyStoreError("KEY_READ_FAILED", "無法讀取本機金鑰檔，請重新設定。")
    if not raw:
        raise KeyStoreError("KEY_DECRYPT_FAILED", "本機金鑰檔內容無效，請重新輸入。")
    try:
        plain = _dpapi_unprotect(raw)
        key = plain.decode("utf-8")
    except KeyStoreError:
        raise
    except Exception:
        raise KeyStoreError("KEY_DECRYPT_FAILED",
                            "這台電腦無法讀取已儲存的金鑰，請重新輸入。")
    ok, _ = _validate_key_text(key)
    if not ok:
        raise KeyStoreError("KEY_DECRYPT_FAILED", "本機金鑰檔內容無效，請重新輸入。")
    return key


def remove_api_key():
    try:
        os.remove(_KEY_PATH)
    except FileNotFoundError:
        return True, ""
    except OSError:
        return False, "無法移除本機金鑰檔，請檢查檔案權限。"
    # 明文只在呼叫端區域變數，函式結束即離開作用域；沒有全域 Key 狀態可清。
    return True, ""


def key_status():
    """只給前端「是否已設定」與解密失敗的白話提示，永不回傳 Key 或密文。"""
    if not os.path.isfile(_KEY_PATH):
        return {"configured": False, "error": ""}
    try:
        read_api_key()
        return {"configured": True, "error": ""}
    except KeyStoreError as exc:
        return {"configured": True, "error": exc.message}


def _civitai_auth_allowed():
    """只有正式 HTTPS Civitai host、預設 443、無 URL 帳密才准附加 Bearer。

    CIVITAI_API 可被環境變數覆寫，因此必須逐項驗證：
    scheme / hostname 精確比對 / port / username/password；任何解析異常一律拒絕。
    """
    try:
        parts = urllib.parse.urlsplit(CIVITAI_API)
        if parts.scheme.lower() != "https":
            return False
        if parts.username is not None or parts.password is not None:
            return False
        host = (parts.hostname or "").lower()
        if host not in _CIVITAI_AUTH_HOSTS:
            return False
        # hostname 已限定官方 host 且無 URL 帳密，netloc 只可能是 host 或 host:port。
        # 不能用 parts.port：它對「完全沒指定」與「明確寫空 port（host:）」都回 None。
        authority = parts.netloc.lower()
        if authority == host:
            return True                      # 完全沒有指定 port
        if not authority.startswith(host + ":"):
            return False
        raw_port = authority[len(host) + 1:]
        if not raw_port or not raw_port.isascii() or not raw_port.isdigit():
            return False
        return int(raw_port) == 443            # :0443 數值等於 443，繼續允許
    except Exception:
        return False


def _split_command(raw):
    """把使用者明確提供的啟動指令拆成 argv；引號只拿來包含空白的路徑。"""
    if not (raw or "").strip():
        return []          # 沒設定就是沒設定，不是格式錯誤
    try:
        parts = shlex.split(raw, posix=False)
    except ValueError as exc:
        raise ValueError("COMFY_LAUNCH_CMD 格式不正確：" + str(exc))
    argv = []
    for p in parts:
        if len(p) >= 2 and p[0] == p[-1] and p[0] in ("'", '"'):
            p = p[1:-1]
        if p:
            argv.append(p)
    if not argv:
        raise ValueError("COMFY_LAUNCH_CMD 是空的")
    return argv


_COMFY_LAUNCH_ERROR = ""
try:
    COMFY_LAUNCH = _split_command(os.environ.get("COMFY_LAUNCH_CMD", ""))
except ValueError as exc:
    COMFY_LAUNCH = []
    _COMFY_LAUNCH_ERROR = str(exc)


def _parse_output_dir(raw):
    """解析 COMFY_OUTPUT_DIR；無效時回 (None, 白話原因)，不猜測、不建立目錄。"""
    text = os.path.expandvars(os.path.expanduser((raw or "").strip()))
    if not text:
        return None, "尚未設定 COMFY_OUTPUT_DIR"
    if not os.path.isabs(text):
        return None, "COMFY_OUTPUT_DIR 必須是絕對路徑"
    if not os.path.exists(text):
        return None, "COMFY_OUTPUT_DIR 指向的資料夾不存在"
    if not os.path.isdir(text):
        return None, "COMFY_OUTPUT_DIR 指向的不是資料夾"
    try:
        os.listdir(text)
    except OSError as exc:
        return None, "無法讀取 COMFY_OUTPUT_DIR：%s" % exc
    if not os.access(text, os.W_OK):
        return None, "沒有 COMFY_OUTPUT_DIR 的寫入權限，無法刪圖"
    return os.path.realpath(text), ""


OUTPUT_DIR = None
_OUTPUT_ERROR = ""
_OUTPUT_LOCK = threading.Lock()
_OUTPUT_FILE_NAME = "output_dir.txt"
# 空字串／未設定 = 允許讀取保存設定；有明確內容但無效 = 保持錯誤，絕不偷偷回退
_OUTPUT_ENV_RAW = os.environ.get("COMFY_OUTPUT_DIR", "")
_OUTPUT_ENV_EXPLICIT = bool(str(_OUTPUT_ENV_RAW).strip())
try:
    OUTPUT_DIR, _OUTPUT_ERROR = _parse_output_dir(_OUTPUT_ENV_RAW)
except OSError as exc:
    OUTPUT_DIR, _OUTPUT_ERROR = None, "COMFY_OUTPUT_DIR 設定錯誤：%s" % exc

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, "assets")

# 只開放這幾種副檔名，避免把 .py / 金鑰檔當靜態內容送出去
ALLOWED = {".html", ".css", ".js", ".png", ".webp", ".jpg", ".jpeg", ".svg", ".ico", ".woff2", ".json"}
NO_STORE = {".html", ".css", ".js", ".json"}

_start_lock = threading.Lock()

# ── WD14 圖片反推（選用功能；沒有設定就不啟用，不碰開發者環境）──
def _is_within(path, root):
    try:
        real_path = os.path.realpath(path)
        real_root = os.path.realpath(root)
        return os.path.commonpath([real_path, real_root]) == real_root
    except (OSError, ValueError):
        return False


def _parse_wd14_file(raw):
    text = os.path.expandvars(os.path.expanduser((raw or "").strip()))
    return "" if "\0" in text else text


def _parse_wd14_tmp(raw):
    path, err = _parse_dir_override(raw, "WD14_TMP")
    if err:
        return "", err
    if not path:
        path = os.path.join(DATA_DIR, "wd14-tmp")   # 預設值也必須通過下面同一套安全檢查
    real = os.path.realpath(path)
    parent = os.path.dirname(real)
    if real == parent:                      # 磁碟機根目錄，例如 C:\
        return "", "WD14_TMP 不可指向磁碟機根目錄"
    if _is_within(ROOT, real):              # 指向 Repo 的上層（會掃到整個專案）
        return "", "WD14_TMP 不可指向 Repo 或其上層目錄"
    if _is_within(real, ROOT):              # 指向 Repo 內部
        return "", "WD14_TMP 不可位於 Repo 內"
    if OUTPUT_DIR and (_is_within(real, OUTPUT_DIR) or _is_within(OUTPUT_DIR, real)):
        return "", "WD14_TMP 不可與 COMFY_OUTPUT_DIR 重疊"
    return real, ""


WD14_PY = _parse_wd14_file(os.environ.get("WD14_PY", ""))
WD14_WORKER = _parse_wd14_file(os.environ.get("WD14_WORKER", ""))
WD14_VIT_PY = _parse_wd14_file(os.environ.get("WD14_VIT_PY", ""))
WD14_VIT_WORKER = _parse_wd14_file(os.environ.get("WD14_VIT_WORKER", ""))
WD14_TMP, _WD14_TMP_ERROR = _parse_wd14_tmp(os.environ.get("WD14_TMP", ""))
# 即使 WD14_TMP 本身因衝突被判無效，輸出資料夾仍不得與使用者指定的路徑重疊
_WD14_TMP_CONFIGURED, _ = _parse_dir_override(os.environ.get("WD14_TMP", ""), "WD14_TMP")


def _looks_like_path(text):
    return (os.path.sep in text or (os.path.altsep and os.path.altsep in text) or
            re.match(r"^[A-Za-z]:", text) is not None)


def wd14_missing_config(model):
    """回傳 WD14 未安裝／未設定的白話原因；已完整設定則回空字串。"""
    vit = str(model or "eva02").strip().lower() in (
        "vit", "vit_v3", "vit-v3", "wd-vit-tagger-v3")
    label = "ViT v3" if vit else "EVA02"
    py = WD14_VIT_PY if vit else WD14_PY
    worker = WD14_VIT_WORKER if vit else WD14_WORKER
    py_var = "WD14_VIT_PY" if vit else "WD14_PY"
    worker_var = "WD14_VIT_WORKER" if vit else "WD14_WORKER"
    if not py or not worker:
        missing = [v for v, val in ((py_var, py), (worker_var, worker)) if not val]
        return ("WD14「%s」尚未設定：請設定 %s，指向你自己的 Python 與 Worker。"
                "基本生圖不受影響。" % (label, " 與 ".join(missing)))
    if _looks_like_path(py) and not os.path.isfile(py):
        return "WD14「%s」的 %s 指向的檔案不存在；請檢查設定。" % (label, py_var)
    if _looks_like_path(worker) and not os.path.isfile(worker):
        return "WD14「%s」的 %s 指向的檔案不存在；請檢查設定。" % (label, worker_var)
    if _WD14_TMP_ERROR:
        return "WD14 暫存目錄設定無效（%s）；請檢查 WD14_TMP。" % _WD14_TMP_ERROR
    return ""


WD14_MAX_UPLOAD = 12 * 1024 * 1024             # base64 字串上限
WD14_MAX_BYTES = 8 * 1024 * 1024               # 原始位元組上限
WD14_MAX_DIM = 4096                            # 最長邊上限
WD14_MIN_DIM = 16                              # 最短邊下限
WD14_START_TIMEOUT = 90                        # Worker 啟動逾時（秒）
WD14_INFER_TIMEOUT = 120                       # 單張推論逾時（秒）
WD14_MAX_CONCURRENT = 3                        # 同時反推上限
WD14_TMP_TTL = 3600                            # 暫存檔存活秒數（超過就清掉）


# ── 輸出資料夾：所有來源共用同一套安全驗證 ──
def _output_dir_conflicts(real):
    """回傳輸出資料夾與其他受保護目錄衝突的原因；沒有衝突回空字串。"""
    if real == os.path.dirname(real):
        return "輸出資料夾不可為磁碟機根目錄"
    if _is_within(real, ROOT) or real == os.path.realpath(ROOT):
        return "輸出資料夾不可位於程式資料夾內"
    wd_candidates = []
    if WD14_TMP and not _WD14_TMP_ERROR:
        wd_candidates.append(os.path.realpath(WD14_TMP))
    if _WD14_TMP_CONFIGURED:
        wd_candidates.append(_WD14_TMP_CONFIGURED)
    for wd in wd_candidates:
        if _is_within(real, wd) or _is_within(wd, real):
            return "輸出資料夾不可與反推暫存目錄重疊"
    return ""


def _validate_output_dir(raw):
    """所有輸出資料夾來源共用的驗證：先格式、再安全邊界。回 (real, error)。"""
    real, err = _parse_output_dir(raw)
    if err:
        return None, err
    return real, _output_dir_conflicts(real)


def _persist_output_dir(real):
    """寫入保存設定；成功回空字串，失敗回白話原因（不再吞掉錯誤）。"""
    target = os.path.join(DATA_DIR, _OUTPUT_FILE_NAME)
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(real)
    except OSError as exc:
        return "無法寫入保存設定 %s（%s）；本次設定仍已生效，但重新啟動後會失效。" % (target, exc)
    return ""


def set_output_dir(raw):
    """驗證並設定輸出資料夾；回 (ok, error, persisted)。

    - ok        ：本次執行是否已套用（保存失敗也為 True）
    - error     ：驗證失敗或保存失敗的白話原因；完全成功為空字串
    - persisted ：是否已永久保存；False 代表重新啟動後可能失效
    驗證失敗時完全不碰目前的 OUTPUT_DIR，避免破壞有效的輸出路徑。
    「更新記憶體」與「寫入保存檔」必須在同一個鎖內完成，避免兩個請求
    造成記憶體是最後一個、保存檔卻是較早一個的交叉覆蓋。
    """
    global OUTPUT_DIR, _OUTPUT_ERROR
    real, err = _validate_output_dir(raw)
    if err:
        return False, err, False
    with _OUTPUT_LOCK:
        OUTPUT_DIR = real
        _OUTPUT_ERROR = ""
        err = _persist_output_dir(real)   # 不釋放鎖，序列化整個更新＋保存
        if err:
            return True, err, False
        return True, "", True


# 啟動環境變數也必須通過同一套安全驗證，不可只在 UI／保存檔檢查
if OUTPUT_DIR:
    _env_real, _env_err = _validate_output_dir(_OUTPUT_ENV_RAW)
    if _env_err:
        OUTPUT_DIR = None
        _OUTPUT_ERROR = "COMFY_OUTPUT_DIR 設定無效（%s）。請改用其他資料夾後重新啟動生圖介面；基本生圖不受影響。" % _env_err
elif _OUTPUT_ENV_EXPLICIT:
    # 明確設定但無效：保留錯誤狀態，絕不回退到 output_dir.txt 的舊設定
    _OUTPUT_ERROR = "COMFY_OUTPUT_DIR 設定無效（%s）。請修正或移除這個環境變數後重新啟動生圖介面；基本生圖不受影響。" % _OUTPUT_ERROR
else:
    # 只有環境變數未設定時，才讀取使用者在介面儲存的設定
    try:
        with open(os.path.join(DATA_DIR, _OUTPUT_FILE_NAME), "r", encoding="utf-8") as f:
            _saved = f.read().strip()
    except OSError:
        _saved = ""
    if _saved:
        _saved_real, _saved_err = _validate_output_dir(_saved)
        if _saved_real and not _saved_err:
            OUTPUT_DIR, _OUTPUT_ERROR = _saved_real, ""
        elif _saved_err and "尚未設定" not in _saved_err:
            _OUTPUT_ERROR = "儲存的輸出資料夾設定無效（%s）。請到右欄「輸出設定」重新指定。" % _saved_err


def port_open(port, host="127.0.0.1"):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.35)
        return s.connect_ex((host, port)) == 0


def comfy_up():
    """檢查目前 COMFY_URL 指向的 ComfyUI 是否正在監聽。"""
    return port_open(COMFY_PORT, COMFY_HOST)


# ── 角色 LoRA 清單／metadata（唯讀，全部經 ComfyUI 原生 API）──────────
# 第一階段只支援 .safetensors：ComfyUI 另外接受 .pt/.ckpt/.bin 等 pickle 格式，
# 但那些需要不安全反序列化才能讀 metadata，本專案不開放。
LORA_EXT = ".safetensors"
LORA_TRIGGER_KEYS = (
    "modelspec.trigger_phrase", "modelspec.trigger_words",
    "ss_trigger_words", "trigger_words", "trigger_phrase",
)


def _comfy_get_json(path, base=None, timeout=10):
    """向 ComfyUI 要 JSON。回 (obj, status)：status 為 ok / HTTP_xxx / UNREACHABLE / BAD_JSON。"""
    req = urllib.request.Request((base or COMFY) + path)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        return None, "HTTP_%d" % e.code
    except Exception:
        return None, "UNREACHABLE"
    try:
        return json.loads(raw), "ok"
    except Exception:
        return None, "BAD_JSON"


def _lora_name_ok(name):
    """ComfyUI 的相對名稱（可含子資料夾）；只做格式檢查，不碰檔案系統。"""
    if not isinstance(name, str):
        return False
    s = name.strip()
    if not s or len(s) > 512 or "\0" in s:
        return False
    if s[0] in ("/", "\\") or re.match(r"^[A-Za-z]:", s):
        return False
    if any(seg in ("", "..") for seg in re.split(r"[\\/]+", s)):
        return False
    return s.lower().endswith(LORA_EXT)


def _lora_display(name):
    base = re.split(r"[\\/]", name)[-1]
    stem = base[:-len(LORA_EXT)] if base.lower().endswith(LORA_EXT) else base
    return stem or base


def _lora_sub(name):
    parts = re.split(r"[\\/]", name)[:-1]
    return " / ".join(parts)


def fetch_lora_list(base=None):
    """回 (names, code)：只留 .safetensors，個別壞資料跳過，不讓整份清單失效。"""
    obj, status = _comfy_get_json("/models/loras", base)
    if obj is None:
        return [], status
    if not isinstance(obj, list):
        return [], "LORA_LIST_INVALID"
    out, seen = [], set()
    for raw in obj[:5000]:
        if not _lora_name_ok(raw):
            continue
        key = raw.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(raw.strip())
    out.sort(key=str.lower)
    return out, ""


def _lora_meta_extract(meta):
    """從 safetensors __metadata__ 取可靠欄位；不猜測、不推論。"""
    if not isinstance(meta, dict):
        return None

    def sval(key, limit=200):
        v = meta.get(key)
        if isinstance(v, (str, int, float)) and str(v).strip():
            return str(v).strip()[:limit]
        return ""

    triggers, seen = [], set()
    for key in LORA_TRIGGER_KEYS:
        for part in re.split(r"[,\r\n]+", sval(key, 600)):
            t = part.strip()[:200]
            norm = re.sub(r"[_\s]+", " ", t.lower())
            if not t or norm in seen:
                continue
            seen.add(norm)
            triggers.append(t)
            if len(triggers) >= 20:
                break
        if len(triggers) >= 20:
            break
    out = {
        "title": sval("modelspec.title") or sval("ss_output_name"),
        "architecture": sval("modelspec.architecture", 120) or sval("ss_base_model_version", 120),
        "description": sval("modelspec.description", 400),
        "networkDim": sval("ss_network_dim", 20),
        "networkAlpha": sval("ss_network_alpha", 20),
        "resolution": sval("modelspec.resolution", 40),
        "triggerWords": triggers,
    }
    return out if any(out.values()) else None


def fetch_lora_meta(name, base=None):
    """只接受「目前 ComfyUI 清單裡實際存在」的名稱；回 (meta, code, status)。"""
    if not _lora_name_ok(name):
        return None, "LORA_NAME_INVALID", 0
    names, code = fetch_lora_list(base)
    if code:
        return None, code, 0
    match = next((n for n in names if n.lower() == name.strip().lower()), None)
    if match is None:
        return None, "LORA_NOT_FOUND", 0
    q = urllib.parse.urlencode({"filename": match})
    obj, status = _comfy_get_json("/view_metadata/loras?" + q, base)
    if obj is None:
        # ComfyUI 對「沒有 __metadata__」與「檔案不存在」都回 404，這裡一律視為沒有資訊
        if status in ("HTTP_404", "HTTP_400"):
            return None, "NO_METADATA", 404
        return None, status, 0
    meta = _lora_meta_extract(obj)
    if meta is None:
        return None, "NO_METADATA", 404
    return meta, "", 200


# ── LoRA 探索中心：Civitai 公開搜尋（唯讀，全部由後端代發）──────────
# 公開端點不需要 Token；本模組也不接受、不保存任何 Token。
# CIVITAI_API 可用環境變數覆寫，僅供隔離測試指向本機 mock；正式值為官方 API。
CIVITAI_API = os.environ.get("CIVITAI_API", "https://civitai.com/api/v1").rstrip("/")
CIVITAI_TIMEOUT = 15
CIVITAI_PAGE_LIMIT = 20
CHECKPOINT_SEARCH_PAGES = 3
CIVITAI_SORTS = {
    "Highest Rated", "Most Downloaded", "Most Liked", "Most Discussed",
    "Most Collected", "Most Images", "Newest", "Oldest",
}
CIVITAI_PERIODS = {"AllTime", "Year", "Month", "Week", "Day"}

_civitai_cache = {}
_cache_lock = threading.Lock()
# Civitai 版本 metadata 快取寫入競態保護：
# _civitai_gen[version_id] 記錄該版本目前最新一代的請求序號；每次 cache miss
# 發起 upstream fetch 前遞增。只有序號仍為最新的請求，才允許寫入快取，避免
# 較早開始但較晚完成的舊請求，覆蓋較新請求已寫入的快取結果。
_civitai_gen = {}
_gen_lock = threading.Lock()
_folder_paths_mod = None
_folder_paths_checked = False


def _cache_get(key):
    with _cache_lock:
        hit = _civitai_cache.get(key)
        if hit is None:
            return None
        if hit[0] < time.time():
            _civitai_cache.pop(key, None)
            return None
        return hit[1]


def _cache_set(key, value, ttl=300):
    with _cache_lock:
        if len(_civitai_cache) > 300:
            _civitai_cache.clear()
        _civitai_cache[key] = (time.time() + ttl, value)


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """對帶 Bearer 的請求完全不跟隨 3xx（301/302/303/307/308）。

    Python 預設 redirect_request() 會複製原 request 的所有 header（只移除
    content-length / content-type），Authorization 因此可能被帶到另一個 Host。
    這裡一律回傳 None，讓 http_error_30x 直接把 3xx 當成 HTTPError，
    不產生第二次請求；匿名請求仍走原本的 urlopen，行為不變。
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _open_without_redirect(req, timeout):
    return urllib.request.build_opener(_NoRedirectHandler()).open(req, timeout=timeout)


def _civitai_get(path, timeout=CIVITAI_TIMEOUT, auth=False):
    """回 (obj, code, retry_after)。code：'' / HTTP_xxx / UNREACHABLE / BAD_JSON。

    auth=True 時才可能附加 Bearer，而且只准正式 HTTPS Civitai host；
    現有公開搜尋與 Checkpoint 查詢一律用預設 auth=False，行為不變。
    """
    headers = {
        "Accept": "application/json",
        "User-Agent": "SidSimpleUI/1.0 (local; public read-only)",
    }
    bearer = bool(auth and _civitai_auth_allowed())
    if bearer:
        try:
            key = read_api_key()
        except KeyStoreError as exc:
            return None, exc.code, None
        headers["Authorization"] = "Bearer " + key
    req = urllib.request.Request(CIVITAI_API + path, headers=headers)
    try:
        if bearer:
            with _open_without_redirect(req, timeout) as r:
                raw = r.read()
        else:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
    except urllib.error.HTTPError as e:
        if bearer and e.code in (301, 302, 303, 307, 308):
            return None, "REDIRECT_BLOCKED", None
        try:
            body = json.loads(e.read() or b"{}")
        except Exception:
            body = {}
        retry = e.headers.get("Retry-After")
        return body or {}, "HTTP_%d" % e.code, retry
    except Exception:
        return None, "UNREACHABLE", None
    try:
        return json.loads(raw), "", None
    except Exception:
        return None, "BAD_JSON", None


def _civitai_me(key):
    """Key 測試用：固定 Bearer 呼叫 /me，不使用 query token。
    CIVITAI_ME_URL 正式值固定為官方端點；只有隔離測試才覆蓋為本機 mock。
    不讀、不回顯 HTTPError body，避免敏感資訊 entering 日誌或前端。
    """
    req = urllib.request.Request(CIVITAI_ME_URL, headers={
        "Accept": "application/json",
        "User-Agent": "SidSimpleUI/1.0 (local; key test)",
        "Authorization": "Bearer " + key,
    })
    try:
        with _open_without_redirect(req, CIVITAI_TIMEOUT) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308):
            return None, "REDIRECT_BLOCKED", None
        return None, "HTTP_%d" % e.code, e.headers.get("Retry-After")
    except Exception:
        return None, "UNREACHABLE", None
    try:
        obj = json.loads(raw)
    except Exception:
        return None, "BAD_JSON", None
    return (obj, "", None) if isinstance(obj, dict) else (None, "BAD_JSON", None)


def _civitai_key_error(code, retry=None):
    """白話錯誤；不回顯 header、body、Key 或例外內容。"""
    if code == "HTTP_401":
        return 401, {"ok": False, "code": "CIVITAI_KEY_INVALID",
                     "error": "金鑰無效、已被撤銷或未被 Civitai 接受，請到 Civitai 帳號設定 > API Keys 確認後重新輸入。"}
    if code == "HTTP_403":
        return 403, {"ok": False, "code": "CIVITAI_FORBIDDEN",
                     "error": "Civitai 拒絕此操作，可能是帳號權限不足；這不代表金鑰無效。"}
    if code == "HTTP_429":
        body = {"ok": False, "code": "CIVITAI_RATE_LIMITED",
                "error": "Civitai 要求放慢查詢，請稍後再試一次。"}
        if retry:
            body["retryAfter"] = str(retry)[:40]
        return 429, body
    if isinstance(code, str) and code.startswith("HTTP_5"):
        return 502, {"ok": False, "code": "CIVITAI_SERVER_ERROR",
                     "error": "Civitai 暫時無法回應，請稍後再試一次。"}
    if code == "REDIRECT_BLOCKED":
        return 502, {"ok": False, "code": "CIVITAI_REDIRECT_BLOCKED",
                     "error": "Civitai 回傳了重新導向，已基於安全停止處理，請稍後再試一次。"}
    if code == "UNREACHABLE":
        return 503, {"ok": False, "code": "CIVITAI_OFFLINE",
                     "error": "連不到 Civitai，請確認網路連線後再試一次。"}
    return 502, {"ok": False, "code": "CIVITAI_BAD_RESPONSE",
                 "error": "Civitai 回傳的資料格式不正確，請稍後再試一次。"}


def _as_int(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


# LoRA 探索中心圖片：只信任 Civitai 官方圖片 CDN，且只保留中繼資料。
# 不下載圖片、不代理圖片、不猜測 nsfwLevel bitmask 語意。
_CIVITAI_IMAGE_HOSTS = {"image.civitai.com"}
_CIVITAI_THUMB_WIDTH = 300
_CIVITAI_MAX_IMAGES = 8


def _civitai_image_urls(raw_url):
    """回 (original, thumb)；不接受就回 (None, None)。thumb 為路径变换失敗時的 original。"""
    if not isinstance(raw_url, str) or not raw_url or len(raw_url) > 1000:
        return None, None
    try:
        p = urllib.parse.urlsplit(raw_url)
        host = (p.hostname or "").lower()
        port = p.port
    except (ValueError, AttributeError):
        return None, None
    if p.scheme.lower() != "https" or host not in _CIVITAI_IMAGE_HOSTS:
        return None, None
    if port not in (None, 443) or "@" in p.netloc or not p.path.startswith("/"):
        return None, None
    if any(seg == ".." for seg in p.path.split("/")):
        return None, None
    original = urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, p.query, p.fragment))
    thumb = original
    parts = p.path.split("/")
    # 實測格式：/<signature>/<uuid>/original=true/<id>.jpeg
    # 只做「完全等於 original=true」的路徑段替換，不做任意字串拼接。
    hits = [i for i, seg in enumerate(parts) if seg == "original=true"]
    if len(hits) == 1:
        parts[hits[0]] = "width=%d" % _CIVITAI_THUMB_WIDTH
        thumb = urllib.parse.urlunsplit((p.scheme, p.netloc, "/".join(parts), p.query, p.fragment))
    return original, thumb


def _normalize_civitai_images(raw_images, search_nsfw=False):
    """把版本的 images[] 正規化成固定欄位；最多 _CIVITAI_MAX_IMAGES 張。

    search_nsfw 是本次 /models 搜尋使用的官方 nsfw 參數：
      - nsfw=false → Civitai 已做成熟內容過濾，沒有明確成熟標記的公開圖片可視為安全；
      - nsfw=true  → 不給 publicSafe，避免在成熟模式中把未分類圖片當成公開安全。
    不解讀 nsfwLevel 數字的語意，也不可把 browsingLevel 與 nsfwLevel 混用。
    """
    if not isinstance(raw_images, list):
        return []
    out = []
    for img in raw_images:
        if len(out) >= _CIVITAI_MAX_IMAGES:
            break
        if not isinstance(img, dict):
            continue
        if str(img.get("type") or "image").lower() != "image":
            continue
        original, thumb = _civitai_image_urls(img.get("url"))
        if not original:
            continue
        iid = img.get("id")
        level = img.get("nsfwLevel")
        nsfw = img.get("nsfw")
        # 明確成熟標記優先於一切；不解讀 nsfwLevel 數字的語意。
        mature = (nsfw is True or bool(img.get("minor")) or bool(img.get("poi")) or
                  (isinstance(level, str) and level.strip().lower() in ("mature", "x")))
        # 真實 API 的公開搜尋圖片常見「沒有 nsfw 布林、只有數字 nsfwLevel」。
        # 安全與否的依據是官方 nsfw=false 搜尋過濾，不是猜測數字等級：
        #   - 明確 nsfw:false，或
        #   - 搜尋已過濾成熟內容 + 官方數字 nsfwLevel + 沒有明確成熟標記
        # 未知字串等級、完全缺分類資訊、或 nsfw=true 搜尋結果一律不給 publicSafe。
        numeric_level = isinstance(level, (int, float)) and not isinstance(level, bool)
        public_safe = (not search_nsfw and not mature and
                       (nsfw is False or numeric_level))
        # 保留 unknown 欄位給舊呼叫端：代表「無法可靠判定」，不是「成熟」。
        unknown = not isinstance(nsfw, bool) and not mature and not public_safe
        out.append({
            "id": iid if isinstance(iid, int) and not isinstance(iid, bool) else None,
            "url": original,
            "thumb": thumb,
            "width": _as_int(img.get("width")) or None,
            "height": _as_int(img.get("height")) or None,
            "nsfwLevel": level if isinstance(level, (int, float, str)) and not isinstance(level, bool) else None,
            "mature": bool(mature),
            "unknown": bool(unknown),
            "publicSafe": bool(public_safe),
        })
    return out


def _normalize_civitai_item(raw, search_nsfw=False):
    """只保留 UI 需要的欄位；不回傳 description HTML / 圖片二進位 / token。

    images 只保留通過 HTTPS + CDN host 白名單檢查的中繼資料（每版本最多 8 張）。
    search_nsfw 用來標記圖片是否來自官方 nsfw=false 的成熟內容過濾搜尋。
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), int):
        return None
    versions = []
    for v in (raw.get("modelVersions") or [])[:30]:
        if not isinstance(v, dict) or not isinstance(v.get("id"), int):
            continue
        files = []
        for f in (v.get("files") or [])[:8]:
            if not isinstance(f, dict):
                continue
            hashes = f.get("hashes") if isinstance(f.get("hashes"), dict) else {}
            meta = f.get("metadata") if isinstance(f.get("metadata"), dict) else {}
            files.append({
                "name": str(f.get("name") or "")[:300],
                "sizeKB": _as_int(f.get("sizeKB")),
                "format": str(meta.get("format") or "")[:40],
                "primary": bool(f.get("primary")),
                "sha256": str(hashes.get("SHA256") or "")[:64],
                "downloadUrl": str(f.get("downloadUrl") or "")[:500],
            })
        base = v.get("baseModel")
        btype = v.get("baseModelType")
        versions.append({
            "id": v["id"],
            "name": str(v.get("name") or "")[:200],
            "baseModel": str(base)[:80] if isinstance(base, str) and base.strip() else None,
            "baseModelType": str(btype)[:40] if isinstance(btype, str) and btype.strip() else None,
            "trainedWords": [str(x)[:200] for x in (v.get("trainedWords") or [])[:30]
                             if isinstance(x, (str, int, float)) and not isinstance(x, bool)],
            "files": files,
            "images": _normalize_civitai_images(
                v.get("images"),
                search_nsfw=search_nsfw,
            ),
            "downloadUrl": str(v.get("downloadUrl") or "")[:500],
        })
    if not versions:
        return None
    stats = raw.get("stats") if isinstance(raw.get("stats"), dict) else {}
    creator = raw.get("creator") if isinstance(raw.get("creator"), dict) else {}
    return {
        "modelId": raw["id"],
        "name": str(raw.get("name") or "")[:200],
        "type": str(raw.get("type") or "")[:40],
        "creator": str(creator.get("username") or "")[:100],
        "nsfw": bool(raw.get("nsfw")),
        "nsfwLevel": _as_int(raw.get("nsfwLevel")),
        "modelBaseModels": [str(x)[:80] for x in (raw.get("baseModels") or [])[:12] if isinstance(x, str)],
        "stats": {"downloadCount": _as_int(stats.get("downloadCount")),
                  "thumbsUpCount": _as_int(stats.get("thumbsUpCount"))},
        "versions": versions,
        "url": "https://civitai.com/models/%d" % raw["id"],
    }


# ── 單一 Model Version 的公開 trainedWords（匿名、免 API Key）────────
# 只供使用者「明確連結」的本機 LoRA 取得作者建議；不會自動套用到任何模型。
CIVITAI_VERSION_GROUPS = 20
CIVITAI_VERSION_WORDS = 40
CIVITAI_VERSION_WORD_LEN = 200
CIVITAI_VERSION_ITEM_LEN = 4000


def _civitai_version_words(parts):
    out, seen = [], set()
    for raw in parts:
        if not isinstance(raw, str):
            continue
        t = re.sub(r"[\r\n]+", " ", raw).strip()[:CIVITAI_VERSION_WORD_LEN]
        if not t:
            continue
        norm = re.sub(r"[_\s]+", " ", t.lower()).strip()
        if not norm or norm in seen:
            continue
        seen.add(norm)
        out.append(t)
        if len(out) >= CIVITAI_VERSION_WORDS:
            break
    return out


def _civitai_version_groups(trained):
    """trainedWords 是字串陣列；每元素是一整串逗號分隔組。回 (groups, warning)。"""
    if not isinstance(trained, list):
        return [], "trainedWords 不是陣列，已略過作者建議"
    groups = []
    for item in trained[:CIVITAI_VERSION_GROUPS]:
        if not isinstance(item, str) or not item.strip():
            continue
        if len(item) > CIVITAI_VERSION_ITEM_LEN:
            continue
        words = _civitai_version_words(re.split(r"[,\r\n]+", item))
        if words:
            groups.append(words)
    return groups, ""


def civitai_version_meta(version_id):
    """回 (info, code, retry)。info.groups 為 string[][]；空陣列是正常狀態。

    快取寫入競態保護：同一個 Version ID 只允許最新一代請求寫入快取。
    每次 cache miss 發起 upstream fetch 前先取得該版本的新世代序號；不在等
    待網路回應時持有世代鎖。upstream 回應成功後，只有當該請求仍是該版
    本最新世代，才允許寫入快取。較早開始但較晚完成的舊請求，因此不
    能覆蓋較新請求已寫入的快取；舊請求失敗也不會清除新快取。
    """
    if not isinstance(version_id, int) or version_id <= 0 or version_id > 2147483647:
        return None, "BAD_VERSION_ID", None
    key = "version|%d" % version_id
    hit = _cache_get(key)
    if hit is not None:
        return hit, "", None
    # 取得此版本的最新請求世代；僅在 cache miss 時遞增，不持鎖等網路。
    with _gen_lock:
        gen = _civitai_gen.get(version_id, 0) + 1
        _civitai_gen[version_id] = gen
    obj, code, retry = _civitai_get("/model-versions/%d" % version_id)
    if code:
        return None, code, retry
    if not isinstance(obj, dict):
        return None, "BAD_JSON", None
    groups, warning = _civitai_version_groups(obj.get("trainedWords"))
    fp_src = json.dumps([version_id, groups], ensure_ascii=False, separators=(",", ":"))
    info = {
        "id": version_id,
        "modelId": _as_int(obj.get("modelId")),
        "name": str(obj.get("name") or "")[:200],
        "baseModel": str(obj.get("baseModel") or "")[:80],
        "baseModelType": str(obj.get("baseModelType") or "")[:40],
        "groups": groups,
        "fingerprint": hashlib.sha256(fp_src.encode("utf-8")).hexdigest()[:16],
        "fetchedAt": int(time.time() * 1000),
        "warning": warning,
        "url": "https://civitai.com/models/%d?modelVersionId=%d" % (
            _as_int(obj.get("modelId")) or 0, version_id),
    }
    # 只有此請求仍是該版本最新世代，才寫入快取；舊請求晚到不得覆蓋新快取。
    with _gen_lock:
        if _civitai_gen.get(version_id) == gen:
            _cache_set(key, info, ttl=300)
    return info, "", None


def civitai_search(query, sort="Highest Rated", period="AllTime", nsfw=False, cursor=""):
    """回 (items, next_cursor, code, retry_after)。"""
    if not isinstance(query, str) or not query.strip() or len(query.strip()) > 200:
        return [], None, "BAD_QUERY", None
    if sort not in CIVITAI_SORTS or period not in CIVITAI_PERIODS:
        return [], None, "BAD_PARAMS", None
    if cursor and (not isinstance(cursor, str) or len(cursor) > 200):
        return [], None, "BAD_PARAMS", None
    params = {
        "types": "LORA", "query": query.strip(), "limit": CIVITAI_PAGE_LIMIT,
        "sort": sort, "period": period, "nsfw": "true" if nsfw else "false",
    }
    if cursor:
        params["cursor"] = cursor
    key = "search|" + urllib.parse.urlencode(params)
    cached = _cache_get(key)
    if cached is not None:
        return cached[0], cached[1], "", None
    path = "/models?" + urllib.parse.urlencode(params)
    obj, code, retry = _civitai_get(path)
    if code:
        return [], None, code, retry
    if not isinstance(obj, dict) or not isinstance(obj.get("items"), list):
        return [], None, "BAD_JSON", None
    items = [x for x in (_normalize_civitai_item(i, nsfw) for i in obj["items"]) if x]
    meta = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}
    nxt = meta.get("nextCursor")
    nxt = str(nxt) if isinstance(nxt, str) and nxt else None
    _cache_set(key, (items, nxt), ttl=300)
    return items, nxt, "", None


def _checkpoint_name_ok(name):
    if not isinstance(name, str):
        return False
    s = name.strip()
    if not s or len(s) > 512 or "\0" in s:
        return False
    if s[0] in ("/", "\\") or re.match(r"^[A-Za-z]:", s):
        return False
    if any(seg in ("", "..") for seg in re.split(r"[\\/]+", s)):
        return False
    return True


def _local_checkpoint_size(name):
    """用「實際執行中的 Python」往上一層級找 ComfyUI/folder_paths.py，
    讓 ComfyUI 自己解析 models 目錄（含 extra_model_paths.yaml）。
    只取得檔案大小，不讀取模型內容。找不到就回 None（未知）。"""
    global _folder_paths_mod, _folder_paths_checked
    if not _checkpoint_name_ok(name):
        return None
    if not _folder_paths_checked:
        _folder_paths_checked = True
        try:
            base = os.path.dirname(os.path.realpath(sys.executable))
            for _ in range(4):
                root = os.path.join(base, "ComfyUI")
                if os.path.isfile(os.path.join(root, "folder_paths.py")):
                    sys.path.insert(0, root)
                    try:
                        _folder_paths_mod = importlib.import_module("folder_paths")
                    finally:
                        try:
                            sys.path.remove(root)
                        except ValueError:
                            pass
                    break
                if os.path.isfile(os.path.join(base, "folder_paths.py")):
                    sys.path.insert(0, base)
                    try:
                        _folder_paths_mod = importlib.import_module("folder_paths")
                    finally:
                        try:
                            sys.path.remove(base)
                        except ValueError:
                            pass
                    break
                parent = os.path.dirname(base)
                if parent == base:
                    break
                base = parent
        except Exception:
            _folder_paths_mod = None
    if _folder_paths_mod is None:
        return None
    try:
        path = _folder_paths_mod.get_full_path("checkpoints", name)
        if not path or not os.path.isfile(path):
            return None
        return os.path.getsize(path)
    except Exception:
        return None


def _size_matches(size_kb, size_bytes):
    """用 Decimal 比對 Civitai 的 sizeKB 與本機 byte 數，避免浮點誤差。"""
    try:
        kb = Decimal(str(size_kb))
        if not kb.is_finite() or kb <= 0:
            return False
        return int((kb * 1024).to_integral_value()) == int(size_bytes)
    except (InvalidOperation, ValueError, TypeError):
        return False


def match_checkpoint_version(candidates, name, size_bytes):
    """檢查候選版本的 files[]；只有檔名與大小都完全符合且唯一才回版本資料。"""
    hits = []
    for item in candidates or []:
        for v in (item.get("versions") or []):
            for f in (v.get("files") or []):
                if f.get("name") != name or not _size_matches(f.get("sizeKB"), size_bytes):
                    continue
                hits.append({
                    "modelId": item.get("modelId"), "versionId": v.get("id"),
                    "versionName": v.get("name"), "baseModel": v.get("baseModel"),
                })
    uniq = {}
    for h in hits:
        uniq[h["versionId"]] = h
    return uniq.popitem()[1] if len(uniq) == 1 else None


def _search_checkpoint_candidates(query):
    """以 query 搜尋 Checkpoint，最多 CHECKPOINT_SEARCH_PAGES 頁。
    回 (candidates, code)：code 非空白代表 API 錯誤，不可當成空結果。"""
    params = {"types": "Checkpoint", "query": query, "nsfw": "true",
              "limit": CIVITAI_PAGE_LIMIT}
    cursor, candidates, tried = "", [], 0
    while tried < CHECKPOINT_SEARCH_PAGES:
        tried += 1
        p = dict(params)
        if cursor:
            p["cursor"] = cursor
        obj, err, _retry = _civitai_get("/models?" + urllib.parse.urlencode(p))
        if err:
            return [], err
        if not isinstance(obj, dict) or not isinstance(obj.get("items"), list):
            return [], "BAD_JSON"
        candidates.extend([x for x in (_normalize_civitai_item(i, True) for i in obj["items"]) if x])
        meta = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}
        cursor = meta.get("nextCursor")
        if not isinstance(cursor, str) or not cursor:
            break
    return candidates, ""


def _merge_candidates(*groups):
    """依 (modelId, versionId) 去重，保留第一次出現的候選。"""
    out, seen = [], set()
    for group in groups:
        for item in group or []:
            for v in (item.get("versions") or []):
                k = (item.get("modelId"), v.get("id"))
                if k in seen:
                    continue
                seen.add(k)
                out.append({"modelId": item.get("modelId"), "versions": [v]})
    return out


def identify_checkpoint(name):
    """回 {name, size, baseModel, confidence, source, reason}。失敗一律 unknown。"""
    unknown = {"name": name, "size": None, "baseModel": None,
               "confidence": "unknown", "source": None, "reason": ""}
    if not _checkpoint_name_ok(name):
        unknown["reason"] = "INVALID_NAME"
        return unknown
    # 先確認這個名稱確實還在 ComfyUI 的 Checkpoint 清單中
    obj, status = _comfy_get_json("/models/checkpoints")
    if status != "ok" or not isinstance(obj, list):
        unknown["reason"] = "COMFY_UNAVAILABLE"
        return unknown
    if not any(isinstance(n, str) and n.strip().lower() == name.strip().lower() for n in obj):
        unknown["reason"] = "CHECKPOINT_NOT_FOUND"
        return unknown
    size = _local_checkpoint_size(name)
    if not size:
        unknown["reason"] = "LOCAL_SIZE_UNAVAILABLE"
        return unknown
    unknown["size"] = size
    key = "ckpt|" + name.lower() + "|" + str(size)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    # 第一輪：完整檔名。找到唯一精確匹配就直接使用，不再補搜。
    candidates, err = _search_checkpoint_candidates(name)
    if err:
        return dict(unknown, reason=err)
    hit = match_checkpoint_version(candidates, name, size)
    result = _checkpoint_hit(name, size, hit) if hit else None
    if result and result.get("confidence") == "high":
        # 與 fallback 成功一樣寫入 900 秒快取；錯誤與不可用結果不進快取
        _cache_set(key, result, ttl=900)
        return result

    # 第二輪：去掉副檔名補搜；合併去重後再判斷，避免漏掉標題不含檔名的作品。
    extensionless = re.sub(r"\.(safetensors|ckpt|pt2|pt|pth|bin|sft)$", "", name, flags=re.I)
    extra, err = _search_checkpoint_candidates(extensionless) if extensionless else ([], "")
    if err:
        return dict(unknown, reason=err)
    merged = _merge_candidates(candidates, extra)
    hit = match_checkpoint_version(merged, name, size)
    result = _checkpoint_hit(name, size, hit) if hit else dict(unknown, reason="NO_UNIQUE_MATCH")
    _cache_set(key, result, ttl=900)
    return result


def _checkpoint_hit(name, size, hit):
    """只把有效 baseModel 當成成功。任何情況都回傳完整 dict，絕不回 None。"""
    base = hit.get("baseModel") if isinstance(hit, dict) else None
    if not isinstance(base, str) or not base.strip():
        return {"name": name, "size": size, "baseModel": None,
                "confidence": "unknown", "source": None, "reason": "BASE_MODEL_UNAVAILABLE"}
    return {"name": name, "size": size, "baseModel": base.strip(),
            "confidence": "high", "source": "civitai-exact-file", "reason": "",
            "versionId": hit.get("versionId"), "versionName": hit.get("versionName")}


def recycle(path):
    """丟到 Windows 資源回收筒（失敗就回 False，由呼叫端決定要不要硬刪）。"""
    try:
        import ctypes
        from ctypes import wintypes

        class SHFILEOPSTRUCTW(ctypes.Structure):
            _fields_ = [
                ("hwnd", wintypes.HWND),
                ("wFunc", wintypes.UINT),
                ("pFrom", wintypes.LPCWSTR),
                ("pTo", wintypes.LPCWSTR),
                ("fFlags", ctypes.c_uint16),
                ("fAnyOperationsAborted", wintypes.BOOL),
                ("hNameMappings", ctypes.c_void_p),
                ("lpszProgressTitle", wintypes.LPCWSTR),
            ]

        FO_DELETE = 3
        FOF_SILENT = 0x0004
        FOF_NOCONFIRMATION = 0x0010
        FOF_ALLOWUNDO = 0x0040
        FOF_NOERRORUI = 0x0400

        op = SHFILEOPSTRUCTW(
            None, FO_DELETE, path + "\0",
            None, FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI,
            False, None, None,
        )
        res = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
        return res == 0 and not op.fAnyOperationsAborted
    except Exception:
        return False


def start_comfy(wait_seconds=180):
    """回傳 (ok, code, message)。沒有明確啟動設定時不猜路徑、不啟動任何程式。"""
    if comfy_up():
        return True, "", ""
    if _COMFY_LAUNCH_ERROR:
        return False, "START_CONFIG_INVALID", _COMFY_LAUNCH_ERROR
    if not COMFY_LAUNCH:
        return False, "START_NOT_CONFIGURED", (
            "尚未設定 ComfyUI 啟動指令，不會自動啟動任何程式。"
            "請先自行啟動你的 ComfyUI；若要自動啟動，請設定 COMFY_LAUNCH_CMD。")
    with _start_lock:
        if comfy_up():
            return True, "", ""
        args = list(COMFY_LAUNCH)
        if OUTPUT_DIR and "--output-directory" not in args:
            args += ["--output-directory", OUTPUT_DIR]
        # 日誌是診斷用途，不可因為它不可寫就取消使用者明確指定的啟動。
        log_notes = []
        out = err = None
        try:
            os.makedirs(LOG_DIR, exist_ok=True)
            try:
                out = open(os.path.join(LOG_DIR, "comfyui.log"), "ab", buffering=0)
            except OSError as exc:
                log_notes.append("無法開啟 comfyui.log：%s" % exc)
            try:
                err = open(os.path.join(LOG_DIR, "comfyui.err.log"), "ab", buffering=0)
            except OSError as exc:
                log_notes.append("無法開啟 comfyui.err.log：%s" % exc)
        except OSError as exc:
            log_notes.append("無法建立日誌目錄：%s" % exc)
        if log_notes:
            print("[simple-ui] 日誌不可用，ComfyUI 仍會啟動：" + "；".join(log_notes),
                  file=sys.stderr, flush=True)
        stdout_target = out if out is not None else subprocess.DEVNULL
        stderr_target = err if err is not None else subprocess.DEVNULL
        try:
            subprocess.Popen(
                args, stdout=stdout_target, stderr=stderr_target,
                creationflags=0x08000000,  # CREATE_NO_WINDOW
            )
        except OSError as exc:
            return False, "START_FAILED", "啟動 ComfyUI 失敗：%s" % exc
        finally:
            for fh in (out, err):
                if fh is not None:
                    try:
                        fh.close()
                    except OSError:
                        pass
        note = ("；日誌不可用，已略過記錄：" + "；".join(log_notes)) if log_notes else ""
        for _ in range(wait_seconds):
            if comfy_up():
                time.sleep(1.5)
                return True, "", note
            time.sleep(1)
        return False, "START_TIMEOUT", (
            "已送出啟動指令，但 ComfyUI 沒有在預期時間內連線；請檢查你啟動的程式。" + note)


# ── 圖片格式判讀（不依賴 Pillow，直接看檔頭）────────────────────
def sniff_image(blob: bytes):
    """回傳 (副檔名, mime, 寬, 高)；不認得的格式回 None。"""
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        if len(blob) < 24 or blob[12:16] != b"IHDR":
            return None
        w = int.from_bytes(blob[16:20], "big")
        h = int.from_bytes(blob[20:24], "big")
        return ".png", "image/png", w, h
    if blob[:2] == b"\xff\xd8":
        i, n = 2, len(blob)
        while i + 9 < n:
            if blob[i] != 0xFF:
                i += 1
                continue
            marker = blob[i + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            if marker == 0xFF:
                i += 1
                continue
            seg = int.from_bytes(blob[i + 2:i + 4], "big")
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                          0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h = int.from_bytes(blob[i + 5:i + 7], "big")
                w = int.from_bytes(blob[i + 7:i + 9], "big")
                return ".jpg", "image/jpeg", w, h
            i += 2 + seg
        return None
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        chunk = blob[12:16]
        if chunk == b"VP8X" and len(blob) >= 30:
            w = int.from_bytes(blob[24:27], "little") + 1
            h = int.from_bytes(blob[27:30], "little") + 1
            return ".webp", "image/webp", w, h
        if chunk == b"VP8 " and len(blob) >= 30:
            w = int.from_bytes(blob[26:28], "little") & 0x3FFF
            h = int.from_bytes(blob[28:30], "little") & 0x3FFF
            return ".webp", "image/webp", w, h
        if chunk == b"VP8L" and len(blob) >= 25:
            bits = int.from_bytes(blob[21:25], "little")
            w = (bits & 0x3FFF) + 1
            h = ((bits >> 14) & 0x3FFF) + 1
            return ".webp", "image/webp", w, h
        return None
    if blob[:6] in (b"GIF87a", b"GIF89a"):
        w = int.from_bytes(blob[6:8], "little")
        h = int.from_bytes(blob[8:10], "little")
        return ".gif", "image/gif", w, h
    return None


def _purge_loop(interval=600):
    """定期清掉過期的反推暫存圖（逾時放著的檔案靠這個收尾）。"""
    while True:
        time.sleep(interval)
        try:
            purge_wd14_tmp()
        except Exception:
            pass   # 選用功能的背景清理不得影響主服務


# 只認 _reverse_inner() 自己產生的檔名：<毫秒時間戳>_<8位hex>.<已知圖片副檔名>
WD14_TMP_NAME = re.compile(r"^\d{10,}_[0-9a-f]{8}\.(?:png|jpg|jpeg|webp|gif)$", re.I)


def purge_wd14_tmp(ttl=WD14_TMP_TTL):
    """只清 Sid-simple-ui 自己產生、過期且沒有逃出暫存目錄的暫存檔。"""
    if not WD14_TMP or _WD14_TMP_ERROR:
        return 0
    try:
        root = os.path.realpath(WD14_TMP)
        if not os.path.isdir(root):
            return 0
        now = time.time()
        n = 0
        for name in os.listdir(root):
            if not WD14_TMP_NAME.match(name):
                continue
            p = os.path.join(root, name)
            try:
                rp = os.path.realpath(p)
                if (os.path.dirname(rp) != root or os.path.islink(p) or
                        not os.path.isfile(p)):
                    continue
                if now - os.path.getmtime(p) <= ttl:
                    continue
                os.remove(p)
                n += 1
            except OSError:
                continue
        return n
    except Exception:
        return 0


class Wd14Worker:
    """管理 wd14_worker.py 子行程：單一推論佇列，崩潰會自行重啟。"""

    def __init__(self, py=None, worker=None, label="EVA02"):
        self.py = py or WD14_PY
        self.worker = worker or WD14_WORKER
        self.label = label
        self.proc = None
        self.pending = {}
        self.lock = threading.Lock()
        self.wlock = threading.Lock()
        self.start_lock = threading.Lock()
        self.seq = 0
        self.ready_info = None
        self.start_error = ""
        # 每個 Worker 各自的 stderr 檔句柄（依 process 分開，舊 Worker 結束時
        # 不會把新 Worker 的句柄關掉）
        self.errfiles = {}

    def _log(self, msg):
        try:
            print("[wd14:%s] %s" % (self.label, msg), file=sys.stderr, flush=True)
        except Exception:
            pass

    def _spawn(self):
        if not os.path.isfile(self.py):
            raise RuntimeError("找不到 WD14「%s」Python：%s" % (self.label, self.py or "尚未設定"))
        if not os.path.isfile(self.worker):
            raise RuntimeError("找不到 WD14「%s」Worker：%s" % (self.label, self.worker or "尚未設定"))
        os.makedirs(LOG_DIR, exist_ok=True)
        log_name = "wd14_worker.log" if self.label == "EVA02" else "wd14_vit_worker.log"
        errfile = open(os.path.join(LOG_DIR, log_name), "ab", buffering=0)
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUNBUFFERED"] = "1"
        self.ready_info = None
        self.start_error = ""
        proc = subprocess.Popen(
            [self.py, self.worker],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errfile,
            text=True, encoding="utf-8", bufsize=1,
            creationflags=0x08000000,   # CREATE_NO_WINDOW
            env=env,
        )
        with self.lock:
            self.proc = proc
            self.errfiles[proc] = errfile
        # reader 綁定自己的 proc，不要用 self.proc（否則舊 Worker 的 reader
        # 可能讀到新 Worker 的 stdout）
        threading.Thread(target=self._reader, args=(proc,), daemon=True).start()
        self._log("Worker 已啟動 PID=%d" % proc.pid)

    def _reader(self, proc):
        try:
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except Exception:
                    self._log("收到非 JSON：%r" % line[:200])
                    continue
                self._dispatch(msg)
        except Exception as exc:
            self._log("reader 結束：%r" % (exc,))
        finally:
            self._on_exit(proc)

    def _dispatch(self, msg):
        kind = msg.get("type")
        rid = str(msg.get("request_id") or "")
        if kind == "ready":
            self.ready_info = msg.get("info")
            self._log("Worker ready：%r" % (self.ready_info,))
            return
        if kind == "fatal":
            self.start_error = str(msg.get("error") or "Worker 啟動失敗")
            self._log("Worker 啟動失敗：%s" % self.start_error)
            return
        with self.lock:
            slot = self.pending.get(rid)
        if slot is not None:
            slot["msg"] = msg
            slot["event"].set()

    def _on_exit(self, proc):
        with self.lock:
            if self.proc is proc:
                self.proc = None
            # 只處理「確實掛在這個 Worker 上」的請求：舊 Worker 晚一步結束時，
            # 不能把新 Worker 的請求一起判死（否則使用者會收到假的 503）。
            pend = [s for s in self.pending.values() if s.get("proc") is proc]
            errfile = self.errfiles.pop(proc, None)
        for slot in pend:
            # 已經有結果的 slot 不要覆寫：_dispatch() 可能已經把成功結果寫進來
            # （例如 Worker 回完結果才被殺），覆寫會把成功的推論誤判成 503。
            # 只有還沒完成的 slot 才補 crashed 訊息。
            if slot.get("msg") is None:
                # crashed=True 代表「推論進行中 Worker 死掉」，
                # 暫存圖可能還在被讀，呼叫端要留著不要馬上刪。
                slot["msg"] = {"success": False, "error": "WD14 Worker 意外結束",
                               "crashed": True}
                slot["event"].set()
        if errfile is not None:
            try:
                errfile.close()
            except Exception:
                pass
        self._log("Worker 結束（退出碼 %s）" % (proc.returncode,))

    def ensure_ready(self, timeout=WD14_START_TIMEOUT):
        """確保 Worker 在跑且模型已載入。回傳 (ok, error)。"""
        with self.start_lock:
            with self.lock:
                alive = self.proc is not None and self.proc.poll() is None
            if alive and self.ready_info:
                return True, ""
            if not alive:
                try:
                    self._spawn()
                except Exception as exc:
                    return False, str(exc)
            proc = self.proc
            deadline = time.time() + timeout
            while time.time() < deadline:
                if self.ready_info:
                    return True, ""
                if self.start_error:
                    return False, self.start_error
                if proc.poll() is not None:
                    return False, ("WD14 Worker 啟動後立刻結束：%s" %
                                   (self.start_error or ("退出碼 %s" % proc.returncode)))
                time.sleep(0.1)
            return False, "WD14 Worker 啟動逾時"

    def submit(self, image_path, threshold, character_threshold, timeout=WD14_INFER_TIMEOUT):
        """送一張圖進去推論。回傳 (ok, result 或 error 字串, keep_file)。

        keep_file=True 代表「Worker 可能還在讀這張圖」，呼叫端不要馬上刪；
        False 代表這張圖 Worker 已經不需要（或根本沒拿到），可以立即刪。
        """
        ok, err = self.ensure_ready()
        if not ok:
            # Worker 根本沒起來 → 圖片沒被任何人接手，可以立即刪
            return False, err, False
        # 送出前先鎖定「要送給哪一個 process」：pending slot 記錄的 process
        # 必須和真正收到 stdin 的 process 是同一個，否則 Worker 中途重啟時
        # 會把請求算到別的 process 頭上（另一個競態）。
        with self.lock:
            proc = self.proc
            if proc is None or proc.poll() is not None:
                # 送出前就死了 → 圖片還沒交到 Worker 手裡，可以立即刪
                return False, "WD14 Worker 剛剛結束，請再試一次", False
            self.seq += 1
            rid = "r%d-%d" % (int(time.time() * 1000) % 100000000, self.seq)
            slot = {"event": threading.Event(), "msg": None, "proc": proc}
            self.pending[rid] = slot
        payload = json.dumps({
            "type": "tag", "request_id": rid, "image": image_path,
            "threshold": threshold, "character_threshold": character_threshold,
        }) + "\n"
        try:
            with self.wlock:
                proc.stdin.write(payload)
                proc.stdin.flush()
        except Exception as exc:
            with self.lock:
                self.pending.pop(rid, None)
            # 寫不進去 → Worker 沒拿到這張圖，可以立即刪
            return False, "WD14 Worker 寫入失敗：%s" % exc, False
        if not slot["event"].wait(timeout):
            with self.lock:
                self.pending.pop(rid, None)
            # 逾時：Worker 可能還在讀這張圖 → 保留，交給 TTL 清理
            return False, "WD14 推論逾時（%.0f 秒）" % timeout, True
        with self.lock:
            self.pending.pop(rid, None)
        msg = slot["msg"] or {}
        if msg.get("success"):
            # 推論完成 → 圖片立刻可以刪
            return True, msg.get("result"), False
        if msg.get("crashed"):
            # 推論途中 Worker 死掉 → 圖片可能還在被讀，保留
            return False, str(msg.get("error") or "WD14 回應不明"), True
        # Worker 有回應但回報錯誤 → 已經用完圖片，可以刪
        return False, str(msg.get("error") or "WD14 回應不明"), False

    def stop(self):
        with self.lock:
            proc = self.proc
            self.proc = None
        if proc is None:
            return
        try:
            with self.wlock:
                proc.stdin.write(json.dumps({"type": "shutdown"}) + "\n")
                proc.stdin.flush()
        except Exception:
            pass
        try:
            proc.wait(timeout=10)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


WD14 = Wd14Worker()                                              # 預設 EVA02
WD14_VIT = Wd14Worker(py=WD14_VIT_PY, worker=WD14_VIT_WORKER, label="ViT")
_rev_lock = threading.Lock()
_rev_active = 0

class H(http.server.BaseHTTPRequestHandler):
    server_version = "SimpleUI/2.0"

    def log_message(self, *a):
        pass

    # ── 共用 ────────────────────────────────────────────────
    def _send(self, code, body, ctype="application/json", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode(), "application/json; charset=utf-8")

    def _proxy(self):
        path = self.path[len("/comfy"):]
        data = None
        if self.command in ("POST", "PUT"):
            n = int(self.headers.get("Content-Length", 0) or 0)
            data = self.rfile.read(n) if n else None
        if path == "/prompt" and self.command == "POST" and data:
            self._log_gen_request(data)
        req = urllib.request.Request(
            COMFY + path, data=data, method=self.command,
            headers={"Content-Type": self.headers.get("Content-Type", "application/json")})
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                body = r.read()
                ctype = r.headers.get("Content-Type", "application/octet-stream")
                self._send(r.status, body, ctype, {"Cache-Control": "no-store"})
        except urllib.error.HTTPError as e:
            self._send(e.code, e.read(), e.headers.get("Content-Type", "application/json"))
        except Exception as e:  # ComfyUI 沒開、連線中斷
            self._json(502, {"error": "ComfyUI not reachable: " + str(e)})

    def _log_gen_request(self, body):
        """生成請求診斷：把 /prompt 的實際提示詞 hash 與參數寫進 logs/gen_requests.jsonl。
        客戶端的 X-Request-Id 對應 app.js 的 ui.genLog（同一次生成的可追溯 id）。"""
        try:
            j = json.loads(body or b"{}")
            wf = j.get("prompt") or {}
            pos = neg = ""
            ks = wh = {}
            if isinstance(wf, dict):
                n2 = wf.get("2")
                n3 = wf.get("3")
                if isinstance(n2, dict) and n2.get("class_type") == "CLIPTextEncode":
                    pos = str((n2.get("inputs") or {}).get("text") or "")
                if isinstance(n3, dict) and n3.get("class_type") == "CLIPTextEncode":
                    neg = str((n3.get("inputs") or {}).get("text") or "")
                k5 = wf.get("5")
                ks = ((k5.get("inputs") if isinstance(k5, dict) else None) or {})
                k4 = wf.get("4")
                wh = ((k4.get("inputs") if isinstance(k4, dict) else None) or {})
            rec = {
                "ts": time.time(),
                "request_id": (self.headers.get("X-Request-Id") or "").strip(),
                "pos_len": len(pos),
                "neg_len": len(neg),
                "pos_hash": hashlib.sha256(pos.encode("utf-8", "replace")).hexdigest()[:12],
                "neg_hash": hashlib.sha256(neg.encode("utf-8", "replace")).hexdigest()[:12],
                "seed": ks.get("seed"),
                "steps": ks.get("steps"),
                "cfg": ks.get("cfg"),
                "w": wh.get("width"),
                "h": wh.get("height"),
                "client": self.client_address[0] if self.client_address else "",
            }
            os.makedirs(LOG_DIR, exist_ok=True)
            with open(os.path.join(LOG_DIR, "gen_requests.jsonl"), "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except Exception:
            pass  # 診斷不得影響生成流程

    # ── GET ────────────────────────────────────────────────
    def do_GET(self):
        if self.path.startswith("/ws"):
            return self._ws_tunnel()
        if self.path.startswith("/comfy/"):
            return self._proxy()
        if self.path == "/open-output":
            if not OUTPUT_DIR:
                return self._json(409, {"ok": False, "code": "OUTPUT_DIR_UNSET",
                                        "error": "尚未設定輸出資料夾，無法開啟。請在右欄「輸出設定」按「設定資料夾」，或於啟動前設定 COMFY_OUTPUT_DIR。"})
            try:
                os.startfile(OUTPUT_DIR)
                return self._json(200, {"ok": True, "output": OUTPUT_DIR})
            except Exception as e:
                return self._json(500, {"ok": False, "code": "OPEN_FAILED",
                                        "error": "無法開啟圖片資料夾：%s" % e})
        if self.path == "/api/status":
            return self._json(200, {"comfy": comfy_up(), "output": OUTPUT_DIR or "",
                                    "external": COMFY_EXTERNAL,
                                    "output_ok": bool(OUTPUT_DIR),
                                    "output_error": _OUTPUT_ERROR})
        if self.path == "/api/loras":
            return self._loras()
        if self.path.split("?", 1)[0] == "/api/lora-meta":
            return self._lora_meta()
        if self.path.split("?", 1)[0] == "/api/civitai/status":
            return self._civitai_status()
        if self.path.split("?", 1)[0] == "/api/civitai/search":
            return self._civitai_search()
        if self.path.split("?", 1)[0] == "/api/civitai/version":
            return self._civitai_version()
        if self.path.split("?", 1)[0] == "/api/civitai/key/status":
            return self._civitai_key_status()
        if self.path == "/api/check":
            return self._json(405, {"error": "use POST"})
        if self.path == "/api/reverse":
            return self._json(405, {"error": "use POST"})
        if self.path == "/start-comfy":
            return self._json(405, {"error": "use POST"})
        return self._static()

    # ── HEAD（給某些快取檢查用）────────────────────────────
    def do_HEAD(self):
        return self.do_GET()

    # ── POST ───────────────────────────────────────────────
    def do_POST(self):
        if self.path.startswith("/comfy/"):
            return self._proxy()
        if self.path == "/start-comfy":
            n = int(self.headers.get("Content-Length", 0) or 0)
            if n:
                self.rfile.read(n)
            if COMFY_EXTERNAL:
                return self._json(409, {
                    "ok": False,
                    "code": "EXTERNAL_COMFY",
                    "error": "目前為外部連線模式（COMFY_URL=%s），請自行啟動 ComfyUI，或檢查 COMFY_URL 是否指向正確的 Port。" % COMFY,
                })
            ok, code, msg = start_comfy()
            if not ok and code:
                return self._json(409, {"ok": False, "code": code,
                                        "error": msg, "comfy": comfy_up()})
            return self._json(200 if ok else 504,
                              {"ok": ok, "comfy": comfy_up(), "error": msg})
        if self.path == "/api/check":
            return self._check_files()
        if self.path == "/api/delete":
            return self._delete_file()
        if self.path == "/api/reverse":
            return self._reverse()
        if self.path == "/api/output-dir":
            return self._set_output_dir()
        if self.path == "/api/civitai/key":
            return self._civitai_key_set()
        if self.path == "/api/civitai/key/test":
            return self._civitai_key_test()
        if self.path == "/api/civitai/key/remove":
            return self._civitai_key_remove()
        return self._json(404, {"error": "not found"})

    # ── 由介面設定輸出資料夾（只接受同源請求）──────────────────
    def _set_output_dir(self):
        # 自訂 header 讓跨站請求必須通過 CORS preflight；本伺服器不提供 CORS。
        if self.headers.get("X-SimpleUI") != "1":
            return self._json(403, {"ok": False, "code": "FORBIDDEN",
                                    "error": "無效的請求來源"})
        origin = self.headers.get("Origin")
        if origin:
            port = self.server.server_address[1]
            allowed = {"http://127.0.0.1:%d" % port, "http://localhost:%d" % port}
            if origin not in allowed:
                return self._json(403, {"ok": False, "code": "FORBIDDEN",
                                        "error": "無效的請求來源"})
        n = int(self.headers.get("Content-Length", 0) or 0)
        if n > 8192:
            return self._json(413, {"ok": False, "code": "TOO_LARGE",
                                    "error": "請求太大"})
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._json(400, {"ok": False, "code": "BAD_JSON",
                                    "error": "請求格式錯誤"})
        raw = data.get("path") if isinstance(data, dict) else None
        if not isinstance(raw, str) or not raw.strip():
            return self._json(400, {"ok": False, "code": "OUTPUT_DIR_INVALID",
                                    "error": "請提供輸出資料夾的完整路徑"})
        ok, err, persisted = set_output_dir(raw)
        if not ok:
            return self._json(400, {"ok": False, "code": "OUTPUT_DIR_INVALID",
                                    "error": err})
        with _OUTPUT_LOCK:
            current = OUTPUT_DIR or ""
        body = {"ok": True, "output": current, "persisted": bool(persisted)}
        if not persisted:
            # 本次已生效但保存失敗：不可回報「永久保存成功」
            body["code"] = "OUTPUT_NOT_PERSISTED"
            body["warning"] = ("輸出資料夾已即時生效，但無法永久保存（%s）。"
                               "重新啟動生圖介面後可能失效；請檢查 %s 的寫入權限，"
                               "或改用右欄「輸出設定」重新設定。" %
                               (err, os.path.join(DATA_DIR, _OUTPUT_FILE_NAME)))
        return self._json(200, body)

    # ── 角色 LoRA 清單（唯讀；只走 ComfyUI 原生 /models/loras）────────
    def _loras(self):
        names, code = fetch_lora_list()
        if code == "UNREACHABLE":
            return self._json(503, {
                "ok": False, "comfy": False, "code": "COMFY_OFFLINE",
                "error": "ComfyUI 沒有連線，讀不到 LoRA 清單。請按右上角狀態列確認 ComfyUI 已啟動，再重新整理。"})
        if code:
            return self._json(502, {
                "ok": False, "comfy": True, "code": code,
                "error": "ComfyUI 回傳的 LoRA 清單格式不對，請稍後再試一次。"})
        loras = [{"name": n, "display": _lora_display(n), "sub": _lora_sub(n)} for n in names]
        return self._json(200, {"ok": True, "comfy": True, "count": len(loras), "loras": loras})

    # ── 單一 LoRA 的 safetensors metadata（觸發詞、base model 等）────
    def _lora_meta(self):
        q = urllib.parse.urlsplit(self.path).query
        name = (urllib.parse.parse_qs(q).get("name") or [""])[0]
        if not name.strip():
            return self._json(400, {"ok": False, "code": "LORA_NAME_INVALID",
                                    "error": "缺少 LoRA 名稱"})
        meta, code, status = fetch_lora_meta(name)
        if code == "UNREACHABLE":
            return self._json(503, {
                "ok": False, "code": "COMFY_OFFLINE",
                "error": "ComfyUI 沒有連線，無法讀取模型資訊。請確認 ComfyUI 已啟動。"})
        if code == "LORA_NOT_FOUND":
            return self._json(404, {
                "ok": False, "code": code,
                "error": "這個 LoRA 已不在 ComfyUI 的清單中，可能已被刪除或搬移。"})
        if code == "LORA_NAME_INVALID":
            return self._json(400, {
                "ok": False, "code": code,
                "error": "LoRA 名稱格式不正確，請從清單重新選擇。"})
        if code == "NO_METADATA":
            return self._json(200, {"ok": True, "meta": None, "code": code,
                                    "error": "這個模型沒有可讀取的 metadata。"})
        if code:
            return self._json(502, {
                "ok": False, "code": code,
                "error": "讀不到模型資訊，請稍後再試一次。"})
        return self._json(200, {"ok": True, "meta": meta})

    # ── LoRA 探索中心：Civitai 公開搜尋（唯讀）────────────────
    @staticmethod
    def _civitai_error(code, retry=None):
        if code == "HTTP_429":
            body = {"ok": False, "code": "CIVITAI_RATE_LIMITED",
                    "error": "Civitai 要求放慢查詢，請等一下再按「搜尋」。"}
            if retry:
                body["retryAfter"] = str(retry)[:40]
            return 429, body
        if isinstance(code, str) and code.startswith("HTTP_5"):
            return 502, {"ok": False, "code": "CIVITAI_SERVER_ERROR",
                         "error": "Civitai 暫時無法回應，請稍後再試一次。"}
        if code == "REDIRECT_BLOCKED":
            return 502, {"ok": False, "code": "CIVITAI_REDIRECT_BLOCKED",
                         "error": "Civitai 回傳了重新導向，已基於安全停止處理，請稍後再試一次。"}
        if code in ("UNREACHABLE", "TIMEOUT"):
            return 503, {"ok": False, "code": "CIVITAI_OFFLINE",
                         "error": "連不到 Civitai，請確認網路連線後再試一次。"}
        return 502, {"ok": False, "code": "CIVITAI_BAD_RESPONSE",
                     "error": "Civitai 回傳的資料格式不正確，請稍後再試一次。"}

    def _civitai_status(self):
        q = urllib.parse.urlsplit(self.path).query
        ckpt = (urllib.parse.parse_qs(q).get("ckpt") or [""])[0]
        if not _checkpoint_name_ok(ckpt):
            return self._json(400, {"ok": False, "code": "CHECKPOINT_NAME_INVALID",
                                    "error": "Checkpoint 名稱不正確，請重新選擇模型。"})
        info = identify_checkpoint(ckpt)
        body = {"ok": True, "checkpoint": info}
        if info.get("reason") in ("UNREACHABLE", "BAD_JSON") or \
                (isinstance(info.get("reason"), str) and info["reason"].startswith("HTTP_")):
            _, err = self._civitai_error(info["reason"])
            body["error"] = err["error"]
        return self._json(200, body)

    def _civitai_search(self):
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        query = (q.get("q") or [""])[0]
        sort = (q.get("sort") or ["Highest Rated"])[0]
        period = (q.get("period") or ["AllTime"])[0]
        nsfw = (q.get("nsfw") or ["0"])[0] in ("1", "true", "True")
        cursor = (q.get("cursor") or [""])[0]
        if not query.strip() or len(query.strip()) > 200:
            return self._json(400, {"ok": False, "code": "BAD_QUERY",
                                    "error": "請輸入 1～200 個字的搜尋關鍵字。"})
        if sort not in CIVITAI_SORTS or period not in CIVITAI_PERIODS:
            return self._json(400, {"ok": False, "code": "BAD_PARAMS",
                                    "error": "排序或時間範圍不正確，請重新選擇。"})
        items, nxt, code, retry = civitai_search(query, sort, period, nsfw, cursor)
        if code:
            status, body = self._civitai_error(code, retry)
            return self._json(status, body)
        return self._json(200, {"ok": True, "items": items,
                                "nextCursor": nxt, "count": len(items)})

    # ── 單一版本公開 trainedWords（匿名；不碰 API Key）────────
    def _civitai_version(self):
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        raw = (q.get("id") or [""])[0].strip()
        if not re.fullmatch(r"\d{1,10}", raw):
            return self._json(400, {"ok": False, "code": "BAD_VERSION_ID",
                                    "error": "請輸入正確的 Civitai 版本 ID（數字）。"})
        info, code, retry = civitai_version_meta(int(raw))
        if code == "HTTP_404":
            return self._json(404, {"ok": False, "code": "CIVITAI_VERSION_NOT_FOUND",
                                    "error": "找不到這個 Civitai 版本或尚未公開。請確認版本 ID 後再試。"})
        if code:
            status, body = self._civitai_error(code, retry)
            return self._json(status, body)
        return self._json(200, {"ok": True, "version": info})

    # ── Civitai Personal API Key 管理（全部只在本機同源）──────────
    def _key_guard(self):
        """比照 _set_output_dir()：自訂 header + Origin 白名單，避免跨站改本機憑證。"""
        if self.headers.get("X-SimpleUI") != "1":
            return False
        origin = self.headers.get("Origin")
        if origin:
            port = self.server.server_address[1]
            allowed = {"http://127.0.0.1:%d" % port, "http://localhost:%d" % port}
            if origin not in allowed:
                return False
        return True

    def _key_forbidden(self):
        return self._json(403, {"ok": False, "code": "FORBIDDEN",
                                "error": "無效的請求來源，請從本機生圖介面操作。"})

    def _key_body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if n > _KEY_BODY_LIMIT:
            return None, (413, {"ok": False, "code": "TOO_LARGE", "error": "請求內容太大。"})
        if n <= 0:
            return {}, None
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return None, (400, {"ok": False, "code": "BAD_JSON", "error": "請求格式錯誤。"})
        if not isinstance(data, dict):
            return None, (400, {"ok": False, "code": "BAD_JSON", "error": "請求格式錯誤。"})
        return data, None

    def _civitai_key_status(self):
        st = key_status()
        return self._json(200, {"ok": True, "configured": bool(st.get("configured")),
                                "error": st.get("error") or ""})

    def _civitai_key_set(self):
        if not self._key_guard():
            return self._key_forbidden()
        data, err = self._key_body()
        if err:
            return self._json(*err)
        ok, msg = _validate_key_text(data.get("key"))
        if not ok:
            return self._json(400, {"ok": False, "code": "KEY_INVALID", "error": msg})
        saved, msg = save_api_key(data["key"])
        if not saved:
            return self._json(500, {"ok": False, "code": "KEY_SAVE_FAILED", "error": msg})
        return self._json(200, {"ok": True, "configured": True})

    def _civitai_key_test(self):
        if not self._key_guard():
            return self._key_forbidden()
        try:
            key = read_api_key()
        except KeyStoreError as exc:
            if exc.code == "KEY_NOT_SET":
                return self._json(409, {"ok": False, "code": "KEY_NOT_SET",
                                        "error": "尚未設定 Civitai API Key。"})
            return self._json(409, {"ok": False, "code": exc.code, "error": exc.message})
        obj, code, retry = _civitai_me(key)
        if code:
            status, body = _civitai_key_error(code, retry)
            return self._json(status, body)
        # 白名單欄位：不回 id / email / emailVerified / 原始 body / Key。
        return self._json(200, {"ok": True,
                                "username": str(obj.get("username") or "")[:100],
                                "tier": str(obj.get("tier") or "")[:40]})

    def _civitai_key_remove(self):
        if not self._key_guard():
            return self._key_forbidden()
        ok, msg = remove_api_key()
        if not ok:
            return self._json(500, {"ok": False, "code": "KEY_REMOVE_FAILED", "error": msg})
        return self._json(200, {"ok": True, "configured": False})

    # ── 檢查圖片是否還在（直接問 ComfyUI，不靠猜輸出資料夾）────────
    def _check_files(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if n > 200_000:
            return self._json(413, {"error": "too large"})
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._json(400, {"error": "bad json"})

        files = data.get("files") or []
        if not isinstance(files, list):
            return self._json(400, {"error": "files must be a list"})

        # ComfyUI 沒開就全部當成「還在」，避免誤刪歷史紀錄
        if not comfy_up():
            return self._json(200, {"missing": [], "comfy": False, "total": len(files)})

        missing = []
        net_errors = 0
        for it in files[:60]:
            if not isinstance(it, dict):
                continue
            q = urllib.parse.urlencode({
                "filename": str(it.get("filename") or ""),
                "subfolder": str(it.get("subfolder") or ""),
                "type": str(it.get("type") or "output"),
            })
            req = urllib.request.Request(COMFY + "/view?" + q, method="HEAD")
            try:
                with urllib.request.urlopen(req, timeout=5) as r:
                    ok = 200 <= r.status < 300
            except urllib.error.HTTPError as e:
                ok = e.code not in (404, 410)
            except Exception:
                ok = True
                net_errors += 1
                if net_errors >= 3:
                    return self._json(200, {"missing": missing, "comfy": False, "total": len(files)})
            if not ok:
                missing.append(it)
        return self._json(200, {"missing": missing, "comfy": True, "total": len(files)})

    # ── 刪圖（輸出目錄 + ComfyUI /view 雙重確認）──────────────────
    def _view_status(self, q):
        """HEAD ComfyUI /view；回 ('present'|'missing'|'error'|'unreachable', headers, msg)"""
        if not comfy_up():
            return "unreachable", None, "ComfyUI 沒有連線"
        req = urllib.request.Request(COMFY + "/view?" + q, method="HEAD")
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                if 200 <= r.status < 300:
                    return "present", r.headers, ""
                return "error", None, "ComfyUI /view 回應 HTTP %s" % r.status
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return "missing", None, ""
            return "error", None, "ComfyUI /view 回應 HTTP %s" % e.code
        except Exception as e:
            return "unreachable", None, "無法連到 ComfyUI：%s" % e

    @staticmethod
    def _hash_stream(stream):
        """串流計算 SHA-256 並計位元組數，不把整張圖讀進 RAM。"""
        h = hashlib.sha256()
        total = 0
        while True:
            chunk = stream.read(64 * 1024)
            if not chunk:
                break
            h.update(chunk)
            total += len(chunk)
        return h.hexdigest(), total

    def _delete_file(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if n > 20_000:
            return self._json(413, {"ok": False, "code": "TOO_LARGE", "error": "請求太大"})
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._json(400, {"ok": False, "code": "BAD_JSON", "error": "請求格式錯誤"})

        out_dir = OUTPUT_DIR          # 快照，避免設定變更造成前後不一致
        if not out_dir:
            return self._json(409, {
                "ok": False, "code": "OUTPUT_DIR_UNSET",
                "error": "尚未設定輸出資料夾，已取消刪圖。請在右欄「輸出設定」按「設定資料夾」，或於啟動前設定 COMFY_OUTPUT_DIR；圖片與紀錄都還在。"
            })

        name = str(data.get("filename") or "").strip()
        sub = str(data.get("subfolder") or "").strip().replace("\\", "/").strip("/")
        typ = str(data.get("type") or "output")
        if (not name or name in (".", "..") or
                any(c in name for c in ("/", "\\", "\0", ":")) or
                ".." in sub.split("/") or ":" in sub):
            return self._json(400, {"ok": False, "code": "FORBIDDEN_PATH",
                                    "error": "檔名或資料夾名稱不合法，已取消刪圖"})
        if typ != "output":
            return self._json(400, {"ok": False, "code": "TYPE_NOT_ALLOWED",
                                    "error": "只能刪除輸出類型的圖片，已取消刪圖"})

        root = os.path.realpath(out_dir)
        try:
            path = os.path.realpath(os.path.join(root, sub, name))
            inside = os.path.commonpath([root, path]) == root
        except (ValueError, OSError):
            inside = False
        if not inside or path == root or os.path.isdir(path):
            return self._json(400, {"ok": False, "code": "FORBIDDEN_PATH",
                                    "error": "這個檔案不在允許的輸出資料夾內，已取消刪圖"})

        q = urllib.parse.urlencode({"filename": name, "subfolder": sub, "type": typ})
        state, headers, msg = self._view_status(q)
        if state in ("unreachable", "error"):
            code = "COMFY_UNREACHABLE" if state == "unreachable" else "VIEW_ERROR"
            return self._json(502, {"ok": False, "code": code,
                                    "error": (msg or "無法確認 ComfyUI 的圖片") + "，已取消刪圖；圖片與紀錄都還在。"})

        local_exists = os.path.isfile(path)
        if state == "missing":
            if local_exists:
                return self._json(409, {"ok": False, "code": "PATH_MISMATCH",
                                        "error": "ComfyUI 找不到這張圖，但本機輸出資料夾有同名檔案；為避免刪錯，已取消刪圖。"})
            return self._json(200, {"ok": True, "status": "already_gone"})

        # state == "present"：取得 ComfyUI 實際圖片內容（串流 hash，不寫暫存檔）
        # 即使本機暫時找不到檔案也要問 GET，才能區分「ComfyUI 也沒有」與「路徑設錯」。
        try:
            with urllib.request.urlopen(COMFY + "/view?" + q, timeout=15) as r:
                if not (200 <= r.status < 300):
                    return self._json(502, {"ok": False, "code": "VIEW_ERROR",
                                            "error": "ComfyUI /view 回應 HTTP %s，無法驗證圖片內容，已取消刪圖。" % r.status})
                remote_hash, remote_bytes = self._hash_stream(r)
                length = r.headers.get("Content-Length") if r.headers else None
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                if not os.path.isfile(path):
                    return self._json(200, {"ok": True, "status": "already_gone"})
                return self._json(409, {"ok": False, "code": "PATH_MISMATCH",
                                        "error": "ComfyUI 取得圖片時回報找不到，但本機仍有同名檔案；已取消刪圖。"})
            return self._json(502, {"ok": False, "code": "VIEW_ERROR",
                                    "error": "ComfyUI /view 回應 HTTP %s，無法驗證圖片內容，已取消刪圖。" % e.code})
        except Exception as e:
            return self._json(502, {"ok": False, "code": "COMFY_UNREACHABLE",
                                    "error": "取得 ComfyUI 圖片失敗：%s，已取消刪圖。" % e})

        # Content-Length 只拿來檢查回應是否完整，不再當作內容相同的證據
        if length and str(length).isdigit() and int(length) != remote_bytes:
            return self._json(502, {"ok": False, "code": "COMFY_UNREACHABLE",
                                    "error": "ComfyUI 回傳的圖片不完整，無法驗證內容，已取消刪圖。"})

        if not local_exists:
            return self._json(409, {"ok": False, "code": "PATH_MISMATCH",
                                    "error": "ComfyUI 仍有這張圖，但本機輸出資料夾找不到對應檔案，請檢查輸出資料夾設定是否正確；已取消刪圖。"})

        # 本機檔案：驗證前後都比對狀態，避免驗證期間被替換
        try:
            before = os.stat(path)
            with open(path, "rb") as f:
                local_hash, _ = self._hash_stream(f)
            after = os.stat(path)
        except OSError as e:
            return self._json(500, {"ok": False, "code": "FS_ERROR",
                                    "error": "無法讀取本機圖片：%s，已取消刪圖。" % e})

        def sig(st):
            return (st.st_ino, st.st_size, st.st_mtime_ns)

        try:
            unchanged = (sig(before) == sig(after) and os.path.isfile(path) and
                         os.path.realpath(os.path.join(root, sub, name)) == path)
        except OSError:
            unchanged = False
        if not unchanged:
            return self._json(409, {"ok": False, "code": "PATH_MISMATCH",
                                    "error": "圖片在驗證期間被變動或路徑已改變，已取消刪圖；請再試一次。"})

        if local_hash != remote_hash:
            return self._json(409, {"ok": False, "code": "PATH_MISMATCH",
                                    "error": "本機圖片與 ComfyUI 回傳的內容不同（SHA-256 不一致），可能不是同一張，已取消刪圖。"})

        if not recycle(path):
            return self._json(500, {"ok": False, "code": "RECYCLE_FAILED",
                                    "error": "無法把圖片移到資源回收筒（可能檔案被鎖住）；原始圖片與紀錄都保留。"})
        if os.path.exists(path):
            return self._json(500, {"ok": False, "code": "DELETE_UNVERIFIED",
                                    "error": "資源回收筒回報成功但檔案還在，無法確認刪除結果；原始圖片與紀錄都保留。"})
        return self._json(200, {"ok": True, "status": "deleted", "recycled": True})

    # ── 圖片反推（WD14 CPU Worker）─────────────────────────────
    def _drain(self, n, cap=64 * 1024 * 1024):
        """把 request body 讀掉丟棄，否則 client 會收到連線重置而不是我們的回應。"""
        left = min(n, cap)
        try:
            while left > 0:
                chunk = self.rfile.read(min(65536, left))
                if not chunk:
                    break
                left -= len(chunk)
        except Exception:
            pass
        if n > cap:
            self.close_connection = True

    def _reverse(self):
        global _rev_active

        n = int(self.headers.get("Content-Length", 0) or 0)
        if n > WD14_MAX_UPLOAD:
            self._drain(n)
            return self._json(413, {"ok": False, "code": "TOO_LARGE",
                                    "error": "圖片太大了，請換小一點的再試"})
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._json(400, {"ok": False, "code": "BAD_JSON",
                                    "error": "請求格式錯誤"})
        if not isinstance(data, dict):
            return self._json(400, {"ok": False, "code": "BAD_JSON",
                                    "error": "請求格式錯誤"})

        # 同時請求上限，避免堆圖片
        with _rev_lock:
            if _rev_active >= WD14_MAX_CONCURRENT:
                return self._json(429, {"ok": False, "code": "BUSY",
                                        "error": "同時反推的圖片太多，等一下再試"})
            _rev_active += 1
        try:
            return self._reverse_inner(data)
        finally:
            with _rev_lock:
                _rev_active -= 1

    def _reverse_inner(self, data):
        raw = data.get("image") or data.get("data") or ""
        if not isinstance(raw, str) or not raw.strip():
            return self._json(400, {"ok": False, "code": "NO_IMAGE",
                                    "error": "沒有收到圖片，請重新選一次"})

        payload = raw.strip()
        declared = ""
        if payload.startswith("data:"):
            head, _, payload = payload.partition(",")
            declared = head[5:].split(";")[0].strip().lower()
        payload = payload.strip()
        if not payload:
            return self._json(400, {"ok": False, "code": "NO_IMAGE",
                                    "error": "沒有收到圖片，請重新選一次"})
        try:
            blob = base64.b64decode(payload, validate=False)
        except Exception:
            return self._json(400, {"ok": False, "code": "BAD_IMAGE",
                                    "error": "圖片資料壞了，請重新選一次"})
        if not blob:
            return self._json(400, {"ok": False, "code": "BAD_IMAGE",
                                    "error": "圖片是空的，請重新選一次"})
        if len(blob) > WD14_MAX_BYTES:
            return self._json(413, {"ok": False, "code": "TOO_LARGE",
                                    "error": "圖片太大了（上限 8 MB），請換小一點的"})

        info = sniff_image(blob)
        if not info:
            return self._json(415, {"ok": False, "code": "BAD_TYPE",
                                    "error": "只認 PNG、JPG、WebP 圖片"})
        ext, mime, w, h = info
        if declared and declared not in ("image/png", "image/jpeg", "image/jpg",
                                        "image/webp", "image/gif"):
            return self._json(415, {"ok": False, "code": "BAD_TYPE",
                                    "error": "只認 PNG、JPG、WebP 圖片"})
        if w > WD14_MAX_DIM or h > WD14_MAX_DIM:
            return self._json(413, {"ok": False, "code": "TOO_LARGE",
                                    "error": "圖片尺寸太大（最長邊上限 4096），請換小一點的"})
        if w < WD14_MIN_DIM or h < WD14_MIN_DIM:
            return self._json(400, {"ok": False, "code": "TOO_SMALL",
                                    "error": "圖片太小了，看不出內容"})

        def clamp(val, default):
            try:
                v = float(val)
            except (TypeError, ValueError):
                return default
            return min(1.0, max(0.0, v))

        threshold = clamp(data.get("threshold"), 0.35)
        character_threshold = clamp(data.get("character_threshold"), 0.85)

        # 選擇模型：EVA02（預設）或 ViT v3；兩套設定必須各自完整
        model = str(data.get("model") or "eva02").strip().lower()
        vit = model in ("vit", "vit_v3", "vit-v3", "wd-vit-tagger-v3")
        worker = WD14_VIT if vit else WD14
        missing = wd14_missing_config(model)
        if missing:
            return self._json(503, {"ok": False, "code": "WD14_NOT_CONFIGURED",
                                    "error": missing})

        # 寫進 Sid-simple-ui 自己管理的暫存目錄（不放 Repo），用完立刻刪
        try:
            os.makedirs(WD14_TMP, exist_ok=True)
            name = "%d_%s%s" % (int(time.time() * 1000), os.urandom(4).hex(), ext)
            path = os.path.join(WD14_TMP, name)
            with open(path, "wb") as fh:
                fh.write(blob)
        except Exception as exc:
            return self._json(500, {"ok": False, "code": "TMP_FAIL",
                                    "error": "暫存圖片失敗：%s" % exc})

        ok = False
        result = None
        keep_file = True          # 保守起見：狀況不明就先保留，TTL 會收掉
        try:
            ok, result, keep_file = worker.submit(path, threshold, character_threshold,
                                                  WD14_INFER_TIMEOUT)
        finally:
            # keep_file=False 才代表「確定 Worker 已經用不到這張圖」：
            #   推論成功 / Worker 回錯誤 / Worker 根本沒起來 → 立即刪
            # keep_file=True（推論逾時、推論途中 Worker 死掉）→ 必須保留，
            #   否則 Worker 會讀到「找不到圖片」；改由 TTL 清理接手。
            if not keep_file:
                try:
                    os.remove(path)
                except OSError:
                    pass
            purge_wd14_tmp()

        if not ok:
            code = 504 if "逾時" in str(result) else 503
            return self._json(code, {"ok": False, "code": "WORKER_ERROR",
                                     "error": str(result)})
        if not isinstance(result, dict):
            return self._json(500, {"ok": False, "code": "BAD_RESULT",
                                    "error": "反推結果格式不正確"})
        return self._json(200, {
            "ok": True,
            "model": result.get("model", "wd-eva02-large-tagger-v3"),
            "rating": result.get("rating") or {"name": "", "score": 0.0},
            "general": result.get("general") or [],
            "character": result.get("character") or [],
            "timing": result.get("timing") or {},
        })
    # ── WebSocket 代理（ComfyUI 只接受同源，所以由 7860 轉發）──────
    WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    def _ws_tunnel(self):
        ckey = self.headers.get("Sec-WebSocket-Key")
        if not ckey:
            return self._json(400, {"error": "missing Sec-WebSocket-Key"})
        if not comfy_up():
            return self._json(503, {"error": "ComfyUI not running"})

        try:
            up = socket.create_connection((COMFY_HOST, COMFY_PORT), timeout=10)
            if COMFY_SCHEME == "https":
                import ssl
                up = ssl.create_default_context().wrap_socket(up, server_hostname=COMFY_HOST)
        except OSError as e:
            return self._json(502, {"error": str(e)})

        try:
            ukey = base64.b64encode(os.urandom(16)).decode()
            handshake = (
                "GET %s HTTP/1.1\r\n"
                "Host: %s:%d\r\n"
                "Origin: %s\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                "Sec-WebSocket-Key: %s\r\n"
                "Sec-WebSocket-Version: 13\r\n\r\n"
                % (self.path, COMFY_HOST, COMFY_PORT, COMFY, ukey)
            )
            up.sendall(handshake.encode())
            head = b""
            while b"\r\n\r\n" not in head:
                chunk = up.recv(4096)
                if not chunk:
                    raise OSError("ComfyUI 關閉了連線")
                head += chunk
                if len(head) > 65536:
                    raise OSError("handshake too large")
            # 同一次 recv 可能同時收到 handshake header 與後續 frame，
            # 必須把 \r\n\r\n 之後的 bytes 留下來轉送，不能只檢查狀態就丟掉。
            idx = head.find(b"\r\n\r\n")
            header, trailing = head[:idx + 4], head[idx + 4:]
            first_line = header.split(b"\r\n", 1)[0]
            if b" 101 " not in first_line:
                raise OSError("ComfyUI 拒絕 WebSocket：" + first_line.decode(errors="replace"))

            accept = base64.b64encode(hashlib.sha1((ckey + self.WS_GUID).encode()).digest()).decode()
            self.wfile.write((
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                "Sec-WebSocket-Accept: %s\r\n\r\n" % accept).encode())
            self.wfile.flush()
            if trailing:
                self.wfile.write(trailing)   # 原封不動，不解碼、不重組 frame
                self.wfile.flush()

            # 前端可能已提早送出 frame，被 http.server 的 rfile 讀進 buffer；
            # 在進入純 byte pump 前補送給 upstream，避免遺失 client 資料。
            self.connection.settimeout(0.05)
            try:
                while True:
                    try:
                        chunk = self.rfile.read1(65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    up.sendall(chunk)
            finally:
                self.connection.settimeout(None)
        except OSError as e:
            up.close()
            return self._json(502, {"error": str(e)})

        self.close_connection = True
        try:
            self._pump(self.connection, up)
        finally:
            try:
                up.close()
            except OSError:
                pass

    @staticmethod
    def _pump(a, b):
        """兩邊位元組原封不動互相轉送（WebSocket frame 不需要解碼）。"""
        peers = {a: b, b: a}
        while True:
            ready, _, broken = select.select([a, b], [], [a, b], 600)
            if broken or not ready:
                return
            for s in ready:
                data = s.recv(65536)
                if not data:
                    return
                peers[s].sendall(data)

    # ── 靜態檔 ─────────────────────────────────────────────
    def _static(self):
        rel = self.path.split("?")[0].split("#")[0].lstrip("/")
        if not rel:
            rel = "index.html"
        full = os.path.normpath(os.path.join(ROOT, rel))
        # 用 realpath + commonpath 判斷真正的目錄邊界：
        # startswith(ROOT) 會誤放行 C:\app\simple_ui_evil 這類同名前綴的外部目錄，
        # 也擋不住指向 Repo 外部的 symlink。
        root_real = os.path.realpath(ROOT)
        full_real = os.path.realpath(full)
        try:
            inside = os.path.commonpath([root_real, full_real]) == root_real
        except (ValueError, OSError):
            inside = False
        if not inside:
            return self._send(403, b"forbidden", "text/plain; charset=utf-8")
        if os.path.isdir(full_real) or not os.path.isfile(full_real):
            full_real = os.path.join(root_real, "index.html")   # 前端路由一律回首頁
        full = full_real

        ext = os.path.splitext(full)[1].lower()
        if ext not in ALLOWED:
            return self._json(404, {"error": "not found"})

        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ext in (".html", ".css", ".js", ".json"):
            ctype += "; charset=utf-8"

        try:
            with open(full, "rb") as f:
                body = f.read()
        except OSError:
            return self._json(404, {"error": "not found"})

        cache = "no-store" if ext in NO_STORE else "public, max-age=3600"
        self._send(200, body, ctype, {"Cache-Control": cache})


class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    # 一次要載 4~12 張圖，預設 backlog 5 會讓並行請求被拒絕
    request_queue_size = 128


def main():
    if _COMFY_ERROR:
        print("COMFY_URL 設定錯誤：" + _COMFY_ERROR, file=sys.stderr)
        print("正確範例：COMFY_URL=http://127.0.0.1:8189 python server.py", file=sys.stderr)
        raise SystemExit(2)
    os.makedirs(ASSETS, exist_ok=True)
    # WD14 暫存目錄改為按需建立（見 _reverse_inner）：基本服務不依賴選用功能
    threading.Thread(target=_purge_loop, daemon=True).start()
    n = purge_wd14_tmp()
    if n:
        print("清掉 %d 個過期的反推暫存檔" % n)
    # 先取得實際監聽 port，再印網址，避免提示與 bind 的 port 不一致
    port = int(os.environ.get("SIMPLE_UI_PORT", "7860") or 7860)
    print("簡易生圖: http://127.0.0.1:%d  (ComfyUI: %s)" % (port, "已連線" if comfy_up() else "未啟動"))
    try:
        S(("127.0.0.1", port), H).serve_forever()
    finally:
        WD14.stop()


if __name__ == "__main__":
    main()
