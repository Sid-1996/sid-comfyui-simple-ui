#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""WD14 暫存圖生命週期測試（Task 2-R1 / P2-b）。

驗證 _reverse_inner() 的 finally 行為：
  F1 推論成功 → 暫存圖立刻刪掉
  F2 推論逾時 → 暫存圖保留（Worker 可能還在讀）
  F3 推論途中 Worker 崩潰 → 暫存圖保留
  F4 Worker 根本沒起來 → 圖片沒人接手，可以立刻刪
  F5 不會影響其他請求的暫存檔
  F6 保留的檔案由 TTL 機制清掉；TTL 機制不會誤刪剛寫入的圖片
  F7 真實 HTTP：成功反推後暫存目錄沒有殘留
  F8 server 啟動時有排 TTL 清理的背景執行緒

執行：
    & 'C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe' simple_ui\devtools\wd14_tmpfile_test.py
"""
import base64
import importlib.util
import io
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request

SERVER_PY = r"C:\ComfyUI\simple_ui\server.py"
BASE = os.environ.get("REV_BASE", "http://127.0.0.1:7860")
TMP = r"C:\ComfyUI\tmp\wd14_test"
IMG = os.path.join(TMP, "general_512.png")
SANDBOX = os.path.join(TMP, "sandbox_tmp")     # 單元測試專用暫存目錄
REAL_TMP = r"C:\ComfyUI\tmp\wd14"

R = []


def check(cid, name, ok, detail=None):
    R.append({"id": cid, "name": name, "pass": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL") + " [" + cid + "] " + name + " :: "
          + json.dumps(detail, ensure_ascii=False))
    return bool(ok)


def load_server():
    spec = importlib.util.spec_from_file_location("simple_ui_server_tmp_test", SERVER_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FakeHandler(object):
    """只提供 _reverse_inner() 真正會用到的方法。"""

    def __init__(self):
        self.status = None
        self.payload = None

    def _json(self, code, obj):
        self.status = code
        self.payload = obj
        return code, obj


def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def fake_submit_factory(result, recorder):
    def _submit(image_path, threshold, character_threshold, timeout=None):
        recorder["path"] = image_path
        recorder["existed"] = os.path.exists(image_path)
        return result
    return _submit


def run_reverse_inner(server, data, result):
    """用假的 submit() 跑一次 _reverse_inner，回傳 (status, payload, 被寫入的暫存檔路徑)。"""
    rec = {}
    orig = server.WD14.submit
    server.WD14.submit = fake_submit_factory(result, rec)
    try:
        h = FakeHandler()
        code, payload = server.H._reverse_inner(h, data)
        return code, payload, rec.get("path"), rec.get("existed")
    finally:
        server.WD14.submit = orig


def listdir(path):
    return sorted(os.listdir(path)) if os.path.isdir(path) else []


def main():
    if not os.path.exists(IMG):
        print("找不到測試圖：" + IMG)
        return 2
    server = load_server()

    # 單元測試用獨立沙盒目錄，不碰真的暫存目錄
    if os.path.isdir(SANDBOX):
        shutil.rmtree(SANDBOX, ignore_errors=True)
    os.makedirs(SANDBOX, exist_ok=True)
    server.WD14_TMP = SANDBOX

    data = {"image": "data:image/png;base64," + b64(IMG)}

    # ── F1 成功：圖片立刻刪 ────────────────────────────────────
    code, payload, path, existed = run_reverse_inner(
        server, data, (True, {"general": [], "character": [],
                              "rating": {"name": "general", "score": 0.0}}, False))
    check("F1", "推論成功 → 暫存圖立刻刪掉",
          code == 200 and existed and path and not os.path.exists(path),
          {"status": code, "path": path, "existed_at_submit": existed,
           "still_exists": os.path.exists(path) if path else None})

    # ── F2 逾時：圖片保留 ──────────────────────────────────────
    code, payload, path, existed = run_reverse_inner(
        server, data, (False, "WD14 推論逾時（120 秒）", True))
    check("F2a", "推論逾時 → 暫存圖保留（Worker 可能還在讀）",
          code == 504 and existed and path and os.path.exists(path),
          {"status": code, "path": path, "still_exists": os.path.exists(path) if path else None,
           "error": payload.get("error")})
    timeout_file = path

    # ── F3 推論途中 Worker 崩潰：圖片保留 ──────────────────────
    code, payload, path, existed = run_reverse_inner(
        server, data, (False, "WD14 Worker 意外結束", True))
    check("F3", "推論途中 Worker 崩潰 → 暫存圖不會被錯誤立刻刪掉",
          code == 503 and existed and path and os.path.exists(path),
          {"status": code, "path": path, "still_exists": os.path.exists(path) if path else None,
           "error": payload.get("error")})
    crash_file = path

    # ── F4 Worker 根本沒起來：圖片可以立刻刪 ────────────────────
    code, payload, path, existed = run_reverse_inner(
        server, data, (False, "找不到 WD14 Worker：xxx", False))
    check("F4", "Worker 沒起來（沒人接手圖片）→ 暫存圖立刻刪掉",
          code == 503 and existed and path and not os.path.exists(path),
          {"status": code, "path": path, "still_exists": os.path.exists(path) if path else None,
           "error": payload.get("error")})

    # ── F5 不影響其他請求的暫存檔 ──────────────────────────────
    other = os.path.join(SANDBOX, "other_request.png")
    with open(other, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + b"0" * 32)
    code, payload, path, existed = run_reverse_inner(
        server, data, (True, {"general": [], "character": [],
                              "rating": {"name": "general", "score": 0.0}}, False))
    check("F5", "刪除自己的暫存圖不會動到其他請求的檔案",
          os.path.exists(other) and path and not os.path.exists(path),
          {"other_exists": os.path.exists(other),
           "target_exists": os.path.exists(path) if path else None})

    # ── F6 TTL 清理 ────────────────────────────────────────────
    kept = listdir(SANDBOX)
    server.purge_wd14_tmp()                      # 預設 TTL 3600 秒，不該動到剛寫的
    after_default = listdir(SANDBOX)
    check("F6a", "TTL 還沒到的檔案不會被清掉（不會誤刪使用中的圖）",
          after_default == kept, {"before": kept, "after": after_default})
    removed = server.purge_wd14_tmp(ttl=0)       # 模擬 TTL 到期
    after_expire = listdir(SANDBOX)
    check("F6b", "TTL 到期後保留的檔案會被清掉（不會留下永久檔案）",
          timeout_file not in after_expire and crash_file not in after_expire,
          {"removed": removed, "left": after_expire})

    # ── F7 真實 HTTP：成功反推後沒有殘留 ───────────────────────
    if os.path.isdir(REAL_TMP):
        before = set(listdir(REAL_TMP))
    else:
        before = set()
    body = json.dumps({"image": "data:image/png;base64," + b64(IMG)}).encode()
    req = urllib.request.Request(BASE + "/api/reverse", data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            st = r.status
            j = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        st = e.code
        try:
            j = json.loads(e.read().decode())
        except Exception:
            j = {}
    after = set(listdir(REAL_TMP)) if os.path.isdir(REAL_TMP) else set()
    check("F7", "真實 HTTP 反推成功且暫存目錄沒有殘留",
          st == 200 and j.get("ok") and (after - before) == set(),
          {"status": st, "ok": j.get("ok"), "new_files": sorted(after - before)})

    # ── F8 server 啟動時有排 TTL 清理 ──────────────────────────
    with open(SERVER_PY, "r", encoding="utf-8") as f:
        src = f.read()
    has_loop = "def _purge_loop(" in src
    has_start = "threading.Thread(target=_purge_loop, daemon=True).start()" in src
    check("F8", "server 啟動時會啟動 TTL 清理背景執行緒",
          has_loop and has_start, {"has_loop": has_loop, "has_start": has_start})

    shutil.rmtree(SANDBOX, ignore_errors=True)

    summary = {"total": len(R), "passed": sum(1 for x in R if x["pass"]),
               "failed": [x["id"] for x in R if not x["pass"]]}
    print("\n=== SUMMARY === " + json.dumps(summary, ensure_ascii=False))
    os.makedirs(TMP, exist_ok=True)
    with open(os.path.join(TMP, "wd14_tmpfile_test_report.json"), "w", encoding="utf-8") as f:
        json.dump({"results": R, "summary": summary}, f, ensure_ascii=False, indent=2)
    return 0 if not summary["failed"] else 1


if __name__ == "__main__":
    sys.exit(main())
