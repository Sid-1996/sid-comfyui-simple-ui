"""comfy_lora_paths_test.py — Phase B1 路徑解析器隔離測試。

不啟動／停止任何服務，不碰撞 GPU，不連 Civitai，不建立或修改實際模型目錄。
mock process / mock WMI / mock PEB / mock 子程序輸出；
唯一「接近真實」的測試是在子程序 import ComfyUI 的 folder_paths（唯讀、無 GPU、無監聽 port）。
"""

import json
import os
import shlex
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import comfy_lora_paths as m  # noqa: E402

WIN = sys.platform == "win32"
EMBEDDED_PY = r"C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe"
COMFY_ROOT = r"C:\ComfyUI\ComfyUI_windows_portable\ComfyUI"


class TestWindowsCommandLine(unittest.TestCase):
    @unittest.skipUnless(WIN, "Windows only")
    def test_command_line_to_argvw_sample(self):
        cmd = 'prog.exe -s "C:\\path with space\\main.py" --output-directory D:\\out --feature "a b"'
        got = m.parse_windows_command_line(cmd)
        self.assertEqual(got, ["prog.exe", "-s", "C:\\path with space\\main.py",
                               "--output-directory", "D:\\out", "--feature", "a b"])
        # shlex 不能拿來解析 Windows 命令行
        self.assertIn("D:out", shlex.split(cmd, posix=True))
        self.assertTrue(shlex.split(cmd, posix=False)[2].startswith('"'))

    @unittest.skipUnless(WIN, "Windows only")
    def test_rejects_bad_command_line(self):
        for bad in ("", None, 123, "x" * (m.MAX_CMDLINE_CHARS + 1)):
            with self.assertRaises(m.ResolverError):
                m.parse_windows_command_line(bad)

    def test_path_args_and_cwd_dependence(self):
        argv = ["py.exe", "-s", "ComfyUI\\main.py", "--output-directory", "D:\\out",
                "--extra-model-paths-config", "a.yaml", "b.yaml", "--port", "8188"]
        pairs = m.path_args_from_argv(argv)
        self.assertIn(("--output-directory", "D:\\out"), pairs)
        self.assertEqual([v for f, v in pairs if f == "--extra-model-paths-config"],
                         ["a.yaml", "b.yaml"])
        self.assertEqual(m.cwd_dependent_args(argv), ["--extra-model-paths-config"])
        equal_form = ["py.exe", "--output-directory=D:\\out"]
        self.assertEqual(m.cwd_dependent_args(equal_form), [])

    def test_main_py_resolution(self):
        with tempfile.TemporaryDirectory() as td:
            root = os.path.join(td, "ComfyUI")
            os.makedirs(root)
            main_py = os.path.join(root, "main.py")
            with open(main_py, "w", encoding="utf-8") as f:
                f.write("# dummy\n")
            found, found_root = m.main_py_from_argv(["py.exe", "-s", "ComfyUI\\main.py"], td)
            self.assertEqual(os.path.normcase(found), os.path.normcase(main_py))
            self.assertEqual(os.path.normcase(found_root), os.path.normcase(root))
            self.assertEqual(m.main_py_from_argv(["py.exe", "nope.py"], td), (None, None))


class TestPEBHelpers(unittest.TestCase):
    @unittest.skipUnless(WIN, "Windows only")
    def test_self_process_read_is_current_snapshot(self):
        # 只驗證「可讀取」，不宣稱等於啟動時狀態。
        ev = m.read_process_parameters(os.getpid())
        self.assertTrue(ev.get("ok"), ev)
        self.assertEqual(ev["bitness"], "x64")
        self.assertEqual(os.path.normcase(os.path.normpath(ev["cwd"])),
                         os.path.normcase(os.path.normpath(os.getcwd())))
        self.assertTrue(any(k.lower() == "path" for k in ev["env"]))
        self.assertIn("command_line", ev)
        self.assertGreater(ev["env_key_count"], 0)

    def test_read_exact_short_read_fails(self):
        class K:
            ReadProcessMemory = None
        k = K()

        def fake(handle, addr, buf, size, got):
            got._obj.value = size - 1
            return True
        self.assertIsNone(k.ReadProcessMemory)
        k.ReadProcessMemory = fake
        with self.assertRaises(m._ReadFailure):
            m._read_exact(k, 1, 0x1000, 16)

    def test_unicode_string_rejects_bad_length(self):
        import struct
        orig_read, orig_max = m._read_exact, m.MAX_PATH_CHARS
        m.MAX_PATH_CHARS = 100
        bad = struct.pack("<HH4xQ", 201, 999, 0x1000)
        m._read_exact = lambda k, h, a, s: bad
        try:
            with self.assertRaises(m._ReadFailure):
                m._read_unicode_string(object(), 1, 0x2000)
        finally:
            m._read_exact, m.MAX_PATH_CHARS = orig_read, orig_max

    def test_env_block_without_terminator_fails(self):
        orig = m._read_exact
        chunk = "A=1\x00".encode("utf-16-le")
        m._read_exact = lambda k, h, a, s: chunk
        try:
            with self.assertRaises(m._ReadFailure):
                m._read_env_block(object(), 1, 0x3000)
        finally:
            m._read_exact = orig


class TestArchitecture(unittest.TestCase):
    @unittest.skipUnless(WIN, "Windows only")
    def test_native_architecture_uses_getnativeSystemInfo(self):
        self.assertEqual(m.get_native_architecture(), "AMD64")

    @unittest.skipUnless(WIN, "Windows only")
    def test_unsupported_native_arch_is_rejected(self):
        orig = m.get_native_architecture
        m.get_native_architecture = lambda: "ARM64"
        try:
            ev = m.read_process_parameters(os.getpid())
            self.assertEqual(ev["code"], "UNSUPPORTED_ARCH")
        finally:
            m.get_native_architecture = orig

    @unittest.skipUnless(WIN, "Windows only")
    def test_unknown_process_arch_is_rejected(self):
        orig = m.get_process_architecture
        m.get_process_architecture = lambda handle: "UNKNOWN"
        try:
            ev = m.read_process_parameters(os.getpid())
            self.assertEqual(ev["code"], "UNSUPPORTED_ARCH")
        finally:
            m.get_process_architecture = orig

    def test_unsupported_process_arch_via_resolver(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td)
            def read(pid):
                ev = f.read(pid)
                ev.update({"ok": False, "code": "UNSUPPORTED_ARCH", "bitness": "ARM64"})
                return ev
            r = f.run(read_params=read)
            self.assertEqual((r["grade"], r["code"]), ("B", "UNSUPPORTED_ARCH"))
            self.assertFalse(r["usable"])


class _ResolverFixture:
    """ injectable 的假 ComfyUI 行程。" """

    def __init__(self, tmp, *, relative_output=False, env=None, image=None):
        os.makedirs(tmp, exist_ok=True)
        self.root = os.path.join(tmp, "ComfyUI")
        os.makedirs(self.root, exist_ok=True)
        self.main_py = os.path.join(self.root, "main.py")
        for name in ("main.py", "folder_paths.py"):
            with open(os.path.join(self.root, name), "w", encoding="utf-8") as f:
                f.write("# dummy\n")
        self.exe = image or sys.executable
        self.cwd = tmp
        out = "relative_out" if relative_output else os.path.join(tmp, "out")
        self.argv = [self.exe, "-s", "ComfyUI\\main.py", "--output-directory", out]
        self.evidence = {
            "ok": True, "bitness": "x64", "cwd": self.cwd, "image": self.exe,
            "command_line": " ".join(self.argv), "env": dict(env or {"PATH": "C:\\Windows"}),
            "env_key_count": len(env or {"PATH": "C:\\Windows"}),
        }
        self.child = {
            "ok": True, "comfy_root": self.root, "main_py": self.main_py,
            "output_directory": os.path.join(tmp, "out"),
            "loras": [os.path.join(self.root, "models", "loras"),
                      os.path.join(tmp, "extra", "loras"),
                      os.path.join(tmp, "out", "loras")],
            "env_sensitive": [],
        }

    def discover(self):
        return [{"ProcessId": 4242, "CommandLine": " ".join(self.argv),
                 "ExecutablePath": self.exe, "CreationDate": "20260101000000.000000+000"}]

    def confirm(self, pid):
        return self.discover()[0]

    def read(self, pid):
        return dict(self.evidence)

    def probe(self, exe, module_path, argv, cwd, env, comfy_root, main_py):
        return json.loads(json.dumps(self.child))

    def run(self, **kwargs):
        opts = dict(discover=self.discover, read_params=self.read,
                    run_probe=self.probe, confirm=self.confirm)
        opts.update(kwargs)
        return m.resolve_lora_paths(**opts)


class TestResolverGrades(unittest.TestCase):
    def test_reconstruction_is_b_not_usable(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td)
            r = f.run()
            self.assertEqual(r["grade"], "B")
            self.assertEqual(r["code"], "LIVE_UNVERIFIED")
            self.assertFalse(r["usable"])
            self.assertEqual(r["loras"], f.child["loras"])  # 僅供唯讀顯示的候選
            self.assertFalse(r["evidence"]["env_used"])

    def test_unreadable_second_candidate_is_not_a(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td)
            good = f.discover()[0]
            broken = dict(good, ProcessId=9999,
                          CommandLine=f.evidence["command_line"].replace("4242", "9999"))
            def read(pid):
                if pid == 9999:
                    return {"ok": False, "code": "ACCESS_DENIED"}
                return f.read(pid)
            r = f.run(discover=lambda: [good, broken], read_params=read)
            self.assertNotEqual(r["grade"], "A")
            self.assertFalse(r["usable"])
            self.assertEqual(r["code"], "MULTIPLE_CANDIDATES")

    def test_identity_mismatch_is_c(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td)
            def bad_confirm(pid):
                row = f.discover()[0]
                return dict(row, CreationDate="20260102000000.000000+000")
            r = f.run(confirm=bad_confirm)
            self.assertEqual((r["grade"], r["code"]), ("C", "IDENTITY_MISMATCH"))

    def test_wmi_executable_path_mismatch_is_c(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td)
            cand = dict(f.discover()[0], ExecutablePath="C:\\Other\\python.exe")
            r = f.run(discover=lambda: [cand])
            self.assertEqual((r["grade"], r["code"]), ("C", "IDENTITY_MISMATCH"))

    def test_relative_output_dir_is_c(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td, relative_output=True)
            r = f.run()
            self.assertEqual(r["grade"], "C")
            self.assertEqual(r["code"], "CWD_UNPROVEN")
            self.assertEqual(r["loras"], [])

    def test_env_sensitive_yaml_is_c(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td)
            f.child["env_sensitive"] = [os.path.join(td, "extra.yaml")]
            r = f.run()
            self.assertEqual(r["grade"], "C")
            self.assertEqual(r["code"], "ENV_UNPROVEN")

    def test_probe_failure_is_c(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td)
            def boom(*a, **k):
                raise m.ResolverError("PROBE_FAILED")
            r = f.run(run_probe=boom)
            self.assertEqual((r["grade"], r["code"]), ("C", "PROBE_FAILED"))

    def test_bad_paths_and_duplicates(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td)
            for bad in (["relative\\loras"], [], ["C:\\a", "C:\\a"]):
                f.child["loras"] = bad
                r = f.run()
                self.assertEqual((r["grade"], r["code"]), ("C", "PROBE_BAD_PATHS"))

    def test_wow64_is_b_and_not_usable(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td)
            def wow(pid):
                return {"ok": False, "code": "WOW64", "bitness": "wow64"}
            r = f.run(read_params=wow)
            self.assertEqual(r["grade"], "B")
            self.assertFalse(r["usable"])

    def test_access_denied_is_c(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td)
            r = f.run(read_params=lambda pid: {"ok": False, "code": "ACCESS_DENIED"})
            self.assertEqual((r["grade"], r["code"]), ("C", "ACCESS_DENIED"))

    def test_no_process_and_ambiguous(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td)
            r = f.run(discover=lambda: [])
            self.assertEqual((r["grade"], r["code"]), ("C", "NO_COMFY_PROCESS"))
            r = f.run(discover=lambda: [f.discover()[0], f.discover()[0]])
            self.assertEqual((r["grade"], r["code"]), ("C", "MULTIPLE_CANDIDATES"))

    def test_server_py_is_ignored(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td)
            r = f.run(discover=lambda: [
                {"ProcessId": 1, "CommandLine": "python.exe C:\\ComfyUI\\simple_ui\\server.py"}])
            self.assertEqual((r["grade"], r["code"]), ("C", "NO_COMFY_PROCESS"))

    def test_env_values_never_leak(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td, env={"SECRET_TOKEN": "SUPERSECRET123"})
            r = f.run()
            self.assertNotIn("SUPERSECRET123", json.dumps(r, ensure_ascii=False))

    def test_evidence_has_no_argv_values_or_absolute_paths(self):
        with tempfile.TemporaryDirectory() as td:
            f = _ResolverFixture(td)
            r = f.run()
            ev = r["evidence"]
            self.assertNotIn("argv", ev)
            self.assertNotIn("comfy_argv", ev)
            self.assertNotIn("cwd", ev)
            self.assertNotIn("image", ev)
            self.assertNotIn("main_py", ev)
            self.assertNotIn("comfy_root", ev)
            self.assertIn("--output-directory", ev["argv_flags"])
            blob = json.dumps(ev, ensure_ascii=False)
            self.assertNotIn(td, blob)
            self.assertNotIn(f.exe, blob)
            self.assertNotIn(os.path.join(td, "out"), blob)


class TestFilenameSafety(unittest.TestCase):
    REJECT = {
        "a/b.safetensors": "PATH_SEPARATOR",
        "..\\x.safetensors": "PATH_SEPARATOR",
        "C:\\x.safetensors": "PATH_SEPARATOR",
        "\\\\server\\share\\x.safetensors": "PATH_SEPARATOR",
        "dir\\..\\ok.safetensors": "PATH_SEPARATOR",
        "x:s.safetensors": "ILLEGAL_CHAR",
        "x\u0000.safetensors": "CONTROL_CHAR",
        "x..safetensors": "DOT_DOT",
        "x .safetensors": "TRAILING_SPACE_OR_DOT",
        "x..": "DOT_DOT",
        "CON.safetensors": "RESERVED_NAME",
        "LPT9.safetensors": "RESERVED_NAME",
        "com1.safetensors": "RESERVED_NAME",
        "x.exe": "BAD_EXTENSION",
        "x.txt": "BAD_EXTENSION",
        "": "FILENAME_INVALID",
        ".safetensors": "EMPTY_STEM",
        "a" * 201 + ".safetensors": "TOO_LONG",
        "a<b.safetensors": "ILLEGAL_CHAR",
        'a"b.safetensors': "ILLEGAL_CHAR",
    }

    def test_all_reject_cases(self):
        for raw, code in self.REJECT.items():
            with self.subTest(raw=raw):
                ok, _, got = m.sanitize_lora_filename(raw)
                self.assertFalse(ok, raw)
                self.assertEqual(got, code, raw)

    def test_accept_and_normalize(self):
        ok, name, code = m.sanitize_lora_filename("mother_lora.safetensors")
        self.assertTrue(ok)
        self.assertEqual((name, code), ("mother_lora.safetensors", ""))
        ok, name, _ = m.sanitize_lora_filename("e\u0301lora.safetensors")
        self.assertTrue(ok)
        self.assertEqual(name, "\u00e9lora.safetensors")
        ok, name, _ = m.sanitize_lora_filename("MODEL.SAFETENSORS")
        self.assertTrue(ok)
        self.assertEqual(name, "MODEL.SAFETENSORS")

    def test_subscript_reserved_names_use_chr(self):
        # 用 chr() 產生 ¹²³，不受終端／檔案編碼影響。
        for prefix in ("COM", "LPT"):
            for cp in (185, 178, 179):
                raw = prefix + chr(cp) + ".safetensors"
                with self.subTest(raw=prefix + cp.__str__()):
                    ok, _, code = m.sanitize_lora_filename(raw)
                    self.assertFalse(ok, raw)
                    self.assertEqual(code, "RESERVED_NAME", raw)

    def test_full_path_length_is_checked(self):
        short = "a.safetensors"
        ok, _, code = m.sanitize_lora_filename(short, "C:\\short")
        self.assertTrue(ok, code)
        ok, _, code = m.sanitize_lora_filename(short, "C:\\" + "d" * 300)
        self.assertFalse(ok)
        self.assertEqual(code, "FULL_PATH_TOO_LONG")
        ok, code = m.validate_full_path("C:\\" + "d" * 300, short)
        self.assertFalse(ok)
        self.assertEqual(code, "FULL_PATH_TOO_LONG")
        ok, code = m.validate_full_path("C:\\base", "x\\y.safetensors")
        self.assertFalse(ok)
        self.assertEqual(code, "PATH_SEPARATOR")

    def test_collision_is_casefold_nfc(self):
        self.assertTrue(m.filename_collides("e\u0301.safetensors", ["\u00e9.safetensors"]))
        self.assertTrue(m.filename_collides("abc.safetensors", ["ABC.safetensors"]))
        self.assertFalse(m.filename_collides("abc.safetensors", ["abd.safetensors"]))


class TestR2WmiHardening(unittest.TestCase):
    """R2-1／R2-2：未知 CommandLine 與缺失 ExecutablePath 都必須 fail closed。"""

    def _fixture(self):
        td = tempfile.mkdtemp(prefix="sid-r2-")
        self.addCleanup(lambda: _rmtree(td))
        return _ResolverFixture(td)

    def test_wmi_query_does_not_filter_out_empty_commandline(self):
        self.assertNotIn("and $_.CommandLine", m._WMI_PS)

    def test_wmi_name_regex_behavior(self):
        """不只用字串包含檢查：直接驗證 regex 能匹配與拒絕實際行程名稱。"""
        import re
        # PowerShell -match 不分大小寫，Python 端也用 IGNORECASE 模擬相同語意。
        pattern = re.compile(m._WMI_NAME_REGEX, re.IGNORECASE)
        for name in ("python.exe", "pythonw.exe", "PYTHON.EXE"):
            with self.subTest(accept=name):
                self.assertIsNotNone(pattern.fullmatch(name))
        for name in ("python3.exe", "python.exe.bak", "cmd.exe", "pythonXexe", "python.exe "):
            with self.subTest(reject=name):
                self.assertIsNone(pattern.fullmatch(name))

    def test_wmi_command_carries_single_escaped_dot(self):
        # Python 原始碼用 raw string 寫 `\.`；PowerShell 收到的也必須是單一反斜線。
        self.assertEqual(m._WMI_NAME_REGEX, r'^python(w)?\.exe$')
        self.assertIn("'^python(w)?\\.exe$'", m._WMI_PS)
        self.assertNotIn("\\\\.exe", m._WMI_PS)

    @unittest.skipUnless(WIN, "Windows only")
    def test_powershell_regex_actually_matches_process_names(self):
        """讓 PowerShell 自己套用regex，避免 Python 與 PowerShell 語意差異。"""
        import subprocess
        ps = ("$names = 'python.exe','pythonw.exe','python3.exe','cmd.exe','pythonXexe'; "
              "$names | Where-Object { $_ -match '%s' }" % m._WMI_NAME_REGEX)
        proc = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                              capture_output=True, text=True, timeout=30)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        hits = [x.strip().lower() for x in proc.stdout.splitlines() if x.strip()]
        self.assertEqual(hits, ["python.exe", "pythonw.exe"])

    def test_missing_commandline_is_unknown_candidate(self):
        f = self._fixture()
        cand = dict(f.discover()[0])
        cand.pop("CommandLine")
        r = f.run(discover=lambda: [cand])
        self.assertEqual((r["grade"], r["code"]), ("C", "UNKNOWN_CANDIDATE"))
        self.assertFalse(r["usable"])

    def test_none_commandline_is_unknown_candidate(self):
        f = self._fixture()
        cand = dict(f.discover()[0], CommandLine=None)
        r = f.run(discover=lambda: [cand])
        self.assertEqual((r["grade"], r["code"]), ("C", "UNKNOWN_CANDIDATE"))

    def test_unreadable_commandline_does_not_hide_second_candidate(self):
        f = self._fixture()
        good = f.discover()[0]
        unknown = dict(good, ProcessId=7777, CommandLine="")
        r = f.run(discover=lambda: [good, unknown])
        self.assertEqual((r["grade"], r["code"]), ("C", "UNKNOWN_CANDIDATE"))
        self.assertFalse(r["usable"])

    def test_first_snapshot_executable_path_missing(self):
        f = self._fixture()
        cand = dict(f.discover()[0])
        cand.pop("ExecutablePath")
        r = f.run(discover=lambda: [cand])
        self.assertEqual((r["grade"], r["code"]), ("C", "EXECUTABLE_PATH_INVALID"))

    def test_first_snapshot_executable_path_empty(self):
        f = self._fixture()
        cand = dict(f.discover()[0], ExecutablePath="")
        r = f.run(discover=lambda: [cand])
        self.assertEqual((r["grade"], r["code"]), ("C", "EXECUTABLE_PATH_INVALID"))

    def test_second_snapshot_executable_path_missing(self):
        f = self._fixture()
        second = dict(f.discover()[0])
        second.pop("ExecutablePath")
        r = f.run(confirm=lambda pid: second)
        self.assertEqual((r["grade"], r["code"]), ("C", "EXECUTABLE_PATH_INVALID"))

    def test_second_snapshot_executable_path_empty(self):
        f = self._fixture()
        second = dict(f.discover()[0], ExecutablePath="   ")
        r = f.run(confirm=lambda pid: second)
        self.assertEqual((r["grade"], r["code"]), ("C", "EXECUTABLE_PATH_INVALID"))

    def test_executable_path_mismatch_is_c(self):
        f = self._fixture()
        cand = dict(f.discover()[0], ExecutablePath="C:\\Other\\python.exe")
        r = f.run(discover=lambda: [cand])
        self.assertEqual((r["grade"], r["code"]), ("C", "IDENTITY_MISMATCH"))

    def test_explicit_pid_does_not_bypass_identity_checks(self):
        f = self._fixture()
        r = f.run(pid=4242)
        # 明確 PID 仍沒有 CommandLine／ExecutablePath，必須當未知候選 fail closed。
        self.assertEqual((r["grade"], r["code"]), ("C", "UNKNOWN_CANDIDATE"))
        self.assertFalse(r["usable"])

    def test_valid_executable_path_helper(self):
        self.assertTrue(m.valid_executable_path("C:\\Python\\python.exe"))
        for bad in (None, "", "   ", "relative\\python.exe", 123,
                    "C:\\foo\\..\\python.exe"):
            with self.subTest(bad=bad):
                self.assertFalse(m.valid_executable_path(bad))


@unittest.skipUnless(WIN and os.path.isfile(EMBEDDED_PY), "需要 ComfyUI embedded Python")
class TestRealInitOrder(unittest.TestCase):
    """用真實 ComfyUI 原始碼的 folder_paths 驗證初始化順序，不啟動 ComfyUI、不碰 GPU。"""

    def _probe(self, yaml_text):
        tmp = tempfile.mkdtemp(prefix="sid-b1-")
        self.addCleanup(lambda: _rmtree(tmp))
        extra = os.path.join(tmp, "extra")
        out = os.path.join(tmp, "out")
        for path in (extra, out):
            os.makedirs(path)
        yaml_path = os.path.join(tmp, "extra.yaml")
        with open(yaml_path, "w", encoding="utf-8") as f:
            f.write(yaml_text)
        full_argv = [EMBEDDED_PY, "-s", "ComfyUI\\main.py",
                     "--extra-model-paths-config", yaml_path, "--output-directory", out]
        argv, main_py, root = m.comfy_argv_from_argv(full_argv, os.path.dirname(COMFY_ROOT))
        return m.run_child_probe(EMBEDDED_PY, m.__file__, argv,
                                 os.path.dirname(COMFY_ROOT), dict(os.environ),
                                 root, main_py, timeout=120), out

    def test_order_canonical_yaml_output(self):
        tmp_extra = os.path.join(tempfile.gettempdir(), "sid_b1_loras_a")
        yaml_text = (
            "comfyui:\n"
            "  loras: |\n"
            "    %s\n" % tmp_extra.replace("\\", "/")
        )
        out, output_dir = self._probe(yaml_text)
        loras = [os.path.normcase(os.path.normpath(p)) for p in out["loras"]]
        self.assertEqual(out["env_sensitive"], [])
        self.assertEqual(len(loras), 3)
        self.assertEqual(loras[0], os.path.normcase(os.path.normpath(
            os.path.join(COMFY_ROOT, "models", "loras"))))
        self.assertEqual(loras[1], os.path.normcase(os.path.normpath(tmp_extra)))
        self.assertEqual(loras[2], os.path.normcase(os.path.normpath(
            os.path.join(output_dir, "loras"))))

    def test_is_default_moves_yaml_path_to_front(self):
        tmp_extra = os.path.join(tempfile.gettempdir(), "sid_b1_loras_b")
        yaml_text = (
            "comfyui:\n"
            "  is_default: true\n"
            "  loras: |\n"
            "    %s\n" % tmp_extra.replace("\\", "/")
        )
        out, _ = self._probe(yaml_text)
        first = os.path.normcase(os.path.normpath(out["loras"][0]))
        self.assertEqual(first, os.path.normcase(os.path.normpath(tmp_extra)))


def _rmtree(path):
    import shutil
    shutil.rmtree(path, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
