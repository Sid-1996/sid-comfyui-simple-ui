"""輸出資料夾設定：隔離測試（B1 / B2 / B3 + 並行保存競態）。

只使用 Python 標準庫 + 暫存目錄 + 模組隔離載入；
不連接正式服務、不讀寫正式輸出資料、不停止任何程序。

執行： python devtools\\test_output_dir_config.py
"""
import importlib.util
import io
import json
import os
import sys
import tempfile
import threading
import types
from pathlib import Path

SERVER = str(Path(__file__).resolve().parent.parent / "server.py")
_counter = 0
_pass = 0
_fail = 0


def check(name, cond, detail=""):
    global _pass, _fail
    if cond:
        _pass += 1
        print("  PASS  %s" % name)
    else:
        _fail += 1
        print("  FAIL  %s  %s" % (name, detail))


def load_server(root_tmp, env_overrides=None, saved=None):
    """以隔離的全域環境重新載入 server.py，回傳該模組。"""
    global _counter
    local = root_tmp / "localappdata"
    data = local / "SidSimpleUI"
    data.mkdir(parents=True, exist_ok=True)
    if saved is not None:
        (data / "output_dir.txt").write_text(saved, encoding="utf-8")

    env = {
        "LOCALAPPDATA": str(local),
        "APPDATA": str(root_tmp / "appdata"),
        "TEMP": str(root_tmp / "temp"),
        "TMP": str(root_tmp / "temp"),
    }
    # 明確移除所有會影響結果的外部設定，避免吃到正式環境
    for key in ("COMFY_OUTPUT_DIR", "WD14_PY", "WD14_WORKER", "WD14_VIT_PY",
                "WD14_VIT_WORKER", "WD14_TMP", "SIMPLE_UI_LOG_DIR",
                "COMFY_URL", "COMFY_LAUNCH_CMD"):
        env[key] = None
    if env_overrides:
        env.update(env_overrides)

    old = {k: os.environ.get(k) for k in env}
    for k, v in env.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    try:
        _counter += 1
        name = "_simple_ui_under_test_%d" % _counter
        spec = importlib.util.spec_from_file_location(name, SERVER)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
        return mod
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class FakeHandler:
    """只模擬 _set_output_dir 需要的介面，不開 socket。"""

    def __init__(self, mod, body, headers=None):
        self.mod = mod
        payload = json.dumps(body).encode("utf-8")
        self.headers = {"X-SimpleUI": "1", "Content-Length": str(len(payload))}
        if headers:
            self.headers.update(headers)
        self.rfile = io.BytesIO(payload)
        self.server = types.SimpleNamespace(server_address=("127.0.0.1", 12345))
        self.result = None

    def _json(self, code, obj):
        self.result = (code, obj)
        return self.result


def call_api(mod, body, headers=None):
    h = FakeHandler(mod, body, headers)
    mod.H._set_output_dir(h)
    return h.result


def concurrent_round(tmp, round_no):
    """可重現的並行競態測試。

    A 先取得鎖並卡在「保存」階段；B 後進來。
    - 舊程式碼（保存不在鎖內）：B 會搶先寫入，A 後寫入 → 記憶體=B、保存檔=A（交叉）。
    - 新程式碼（保存也在鎖內）：B 會被鎖擋住 → 記憶體=B、保存檔=B（一致）。
    完全用 Event 安排順序，不靠 sleep 猜測。
    """
    root = tmp / ("race%d" % round_no)
    dir_a = root / "out-a"
    dir_b = root / "out-b"
    for d in (dir_a, dir_b):
        d.mkdir(parents=True, exist_ok=True)

    m = load_server(root)
    original_persist = m._persist_output_dir

    # 追蹤寫入時是否仍持有鎖：舊程式碼（保存放在鎖外）這裡會是 False。
    class TrackingLock:
        def __init__(self, inner):
            self.inner = inner
            self.held = False

        def __enter__(self):
            self.inner.acquire()
            self.held = True
            return self

        def __exit__(self, *args):
            self.held = False
            self.inner.release()

    tracker = TrackingLock(m._OUTPUT_LOCK)
    m._OUTPUT_LOCK = tracker
    persist_held = []

    a_in_persist = threading.Event()
    b_started = threading.Event()
    let_a_finish = threading.Event()
    results = {}

    def gated_persist(real):
        persist_held.append(tracker.held)
        if real == os.path.realpath(dir_a):
            a_in_persist.set()
            let_a_finish.wait(10)
        return original_persist(real)

    m._persist_output_dir = gated_persist

    def run(label, path):
        if label == "B":
            b_started.set()
        results[label] = m.set_output_dir(str(path))

    ta = threading.Thread(target=run, args=("A", dir_a))
    tb = threading.Thread(target=run, args=("B", dir_b))
    try:
        ta.start()
        got_a = a_in_persist.wait(10)
        tb.start()
        got_b = b_started.wait(10)
        let_a_finish.set()
        ta.join(10)
        tb.join(10)
    finally:
        let_a_finish.set()
        m._persist_output_dir = original_persist

    data_file = Path(m.DATA_DIR) / m._OUTPUT_FILE_NAME
    file_value = data_file.read_text(encoding="utf-8") if data_file.exists() else ""
    final = m.OUTPUT_DIR
    expected = os.path.realpath(dir_b)
    consistent = (
        not ta.is_alive() and not tb.is_alive() and got_a and got_b and
        results.get("A", (False, None, None))[0] and
        results.get("B", (False, None, None))[0] and
        results.get("A", (None, None, None))[2] is True and
        results.get("B", (None, None, None))[2] is True and
        persist_held == [True, True] and
        final == expected and file_value == expected
    )
    check("並行第 %d 輪：保存時持鎖、記憶體與保存檔一致（皆為 B）" % round_no,
          consistent,
          "final=%r file=%r held=%r A=%r B=%r" % (
              final, file_value, persist_held, results.get("A"), results.get("B")))


def main():
    with tempfile.TemporaryDirectory(prefix="sid-output-dir-test-") as td:
        tmp = Path(td)
        out_valid = tmp / "out-valid"
        out_saved = tmp / "out-saved"
        out_other = tmp / "out-other"
        wd_tmp = tmp / "wd14-tmp"
        for d in (out_valid, out_saved, out_other, wd_tmp):
            d.mkdir()

        saved_path = str(out_saved)
        root_drive = os.path.splitdrive(SERVER)[0] + os.sep
        repo = str(Path(SERVER).parent)
        missing = str(tmp / "does-not-exist")

        print("[B1] 環境變數與保存設定優先順序")
        m = load_server(tmp, saved=saved_path)
        check("未設定環境變數 → 讀取 output_dir.txt",
              m.OUTPUT_DIR == os.path.realpath(saved_path) and not m._OUTPUT_ERROR,
              (m.OUTPUT_DIR, m._OUTPUT_ERROR))

        m = load_server(tmp, {"COMFY_OUTPUT_DIR": ""}, saved=saved_path)
        check("空字串視為未設定 → 仍讀取保存設定",
              m.OUTPUT_DIR == os.path.realpath(saved_path), m.OUTPUT_DIR)

        m = load_server(tmp, {"COMFY_OUTPUT_DIR": str(out_valid)}, saved=saved_path)
        check("環境變數有效 → 優先於保存設定",
              m.OUTPUT_DIR == os.path.realpath(out_valid), m.OUTPUT_DIR)

        m = load_server(tmp, {"COMFY_OUTPUT_DIR": missing}, saved=saved_path)
        check("環境變數無效 → 不回退到保存設定",
              m.OUTPUT_DIR is None and "COMFY_OUTPUT_DIR 設定無效" in m._OUTPUT_ERROR,
              (m.OUTPUT_DIR, m._OUTPUT_ERROR))
        check("錯誤訊息指出下一步（修正或移除環境變數）",
              "修正或移除" in m._OUTPUT_ERROR and "重新啟動" in m._OUTPUT_ERROR,
              m._OUTPUT_ERROR)

        print("[B2] 所有來源共用安全驗證")
        check("_output_dir_conflicts 拒絕磁碟根目錄",
              "磁碟機根目錄" in m._output_dir_conflicts(root_drive), root_drive)
        check("_output_dir_conflicts 拒絕 Repo 本身",
              "程式資料夾" in m._output_dir_conflicts(repo), repo)
        check("_output_dir_conflicts 拒絕 Repo 內部",
              "程式資料夾" in m._output_dir_conflicts(os.path.join(repo, "assets")))

        m = load_server(tmp, {"COMFY_OUTPUT_DIR": root_drive}, saved=saved_path)
        check("環境變數=磁碟根 → 拒絕（不回退）",
              m.OUTPUT_DIR is None and "COMFY_OUTPUT_DIR 設定無效" in m._OUTPUT_ERROR,
              (m.OUTPUT_DIR, m._OUTPUT_ERROR))

        m = load_server(tmp, {"COMFY_OUTPUT_DIR": repo}, saved=saved_path)
        check("環境變數=Repo → 拒絕",
              m.OUTPUT_DIR is None and "程式資料夾" in m._OUTPUT_ERROR,
              (m.OUTPUT_DIR, m._OUTPUT_ERROR))

        m = load_server(tmp, {"COMFY_OUTPUT_DIR": os.path.join(repo, "assets")},
                        saved=saved_path)
        check("環境變數=Repo 內部 → 拒絕",
              m.OUTPUT_DIR is None and "程式資料夾" in m._OUTPUT_ERROR,
              (m.OUTPUT_DIR, m._OUTPUT_ERROR))

        m = load_server(tmp, {"WD14_TMP": str(wd_tmp),
                              "COMFY_OUTPUT_DIR": str(wd_tmp)}, saved=saved_path)
        check("環境變數=WD14 暫存目錄 → 拒絕",
              m.OUTPUT_DIR is None and "反推暫存目錄" in m._OUTPUT_ERROR,
              (m.OUTPUT_DIR, m._OUTPUT_ERROR))

        m = load_server(tmp, saved=str(repo))
        check("保存設定指向 Repo → 同樣拒絕",
              m.OUTPUT_DIR is None and "程式資料夾" in m._OUTPUT_ERROR,
              (m.OUTPUT_DIR, m._OUTPUT_ERROR))

        m = load_server(tmp, {"COMFY_OUTPUT_DIR": str(out_valid)})
        ok, err, persisted = m.set_output_dir(repo)
        check("UI API 設定 Repo → 拒絕且不改動現有路徑",
              not ok and err and m.OUTPUT_DIR == os.path.realpath(out_valid),
              (ok, err, m.OUTPUT_DIR))
        check("UI API 與環境變數使用同一個驗證函式",
              hasattr(m, "_validate_output_dir") and
              m._validate_output_dir(repo)[1] == m._output_dir_conflicts(repo))

        print("[B3] 保存成功 / 失敗的如實回報")
        m = load_server(tmp)
        ok, err, persisted = m.set_output_dir(str(out_valid))
        data_file = Path(m.DATA_DIR) / m._OUTPUT_FILE_NAME
        check("保存成功 → ok / persisted=True / 檔案內容正確",
              ok and not err and persisted and
              data_file.read_text(encoding="utf-8") == str(out_valid),
              (ok, err, persisted))

        code, body = call_api(m, {"path": str(out_other)})
        check("API 保存成功 → 200 + persisted=True（舊欄位 output 仍在）",
              code == 200 and body.get("ok") and body.get("persisted") is True and
              body.get("output") == os.path.realpath(out_other),
              (code, body))
        check("API 相容性：成功回應不含 OUTPUT_NOT_PERSISTED",
              "code" not in body, body)

        # 模擬保存寫入失敗（不碰任何真實檔案權限）
        real_persist = m._persist_output_dir
        m._persist_output_dir = lambda real: "無法寫入保存設定（模擬 Permission denied）"
        try:
            ok, err, persisted = m.set_output_dir(str(out_valid))
            check("保存失敗 → ok=True（本次已生效）但 persisted=False",
                  ok and err and persisted is False, (ok, err, persisted))
            check("保存失敗 → OUTPUT_DIR 未被清空",
                  m.OUTPUT_DIR == os.path.realpath(out_valid), m.OUTPUT_DIR)

            code, body = call_api(m, {"path": str(out_valid)})
            check("保存失敗 API → 200 + persisted=False + OUTPUT_NOT_PERSISTED",
                  code == 200 and body.get("ok") and
                  body.get("persisted") is False and
                  body.get("code") == "OUTPUT_NOT_PERSISTED", (code, body))
            check("保存失敗 API → 白話訊息含重啟後可能失效",
                  "重新啟動" in (body.get("warning") or "") and
                  body.get("output") == os.path.realpath(out_valid), (code, body))

            ok2, err2, persisted2 = m.set_output_dir(missing)
            check("保存失敗後再設無效路徑 → 仍拒絕且保留有效路徑",
                  not ok2 and m.OUTPUT_DIR == os.path.realpath(out_valid),
                  (ok2, err2, m.OUTPUT_DIR))
        finally:
            m._persist_output_dir = real_persist

        print("[API] 同源檢查與既有格式")
        code, body = call_api(m, {"path": str(out_valid)}, {"X-SimpleUI": ""})
        check("缺少 X-SimpleUI → 403 FORBIDDEN",
              code == 403 and body.get("code") == "FORBIDDEN", (code, body))
        code, body = call_api(m, {"path": str(out_valid)},
                              {"X-SimpleUI": "1", "Origin": "http://evil.example"})
        check("跨站 Origin → 403 FORBIDDEN",
              code == 403 and body.get("code") == "FORBIDDEN", (code, body))

        print("[回歸] 刪圖安全檢查仍保留")
        src = Path(SERVER).read_text(encoding="utf-8")
        check("刪圖仍做 realpath + commonpath 邊界檢查",
              "os.path.commonpath([root, path]) == root" in src)
        check("刪圖仍做 SHA-256 內容比對",
              "hashlib.sha256" in src and "PATH_MISMATCH" in src)
        check("刪圖仍限制 type=output", "TYPE_NOT_ALLOWED" in src)

        print("[並行] 更新與保存同一把鎖（可重現，3 輪）")
        for i in range(1, 4):
            concurrent_round(tmp, i)

    print("\n結果：%d PASS / %d FAIL" % (_pass, _fail))
    return 0 if _fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
