#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""WD14 反推後端 API 測試（Task 2）。

執行：
    & 'C:\ComfyUI\tools\wd14-venv\Scripts\python.exe' simple_ui\devtools\wd14_api_test.py

測試圖片放在 C:\ComfyUI\tmp\wd14_test\（不放進 Git repo）。
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("REV_BASE", "http://127.0.0.1:7860")
TMP = r"C:\ComfyUI\tmp\wd14_test"
OUT = os.path.join(TMP, "img")
PY = r"C:\ComfyUI\tools\wd14-venv\Scripts\python.exe"
LOG = r"C:\ComfyUI\logs\wd14_worker.log"

R = []


def check(cid, name, ok, detail=None):
    R.append({"id": cid, "name": name, "pass": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL") + " [" + cid + "] " + name + " :: " + json.dumps(detail, ensure_ascii=False))
    return ok


def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def post(payload, base=BASE, timeout=180):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(base + "/api/reverse", data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode()), time.time() - t0
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            j = json.loads(raw)
        except Exception:
            j = {"raw": raw[:300]}
        return e.code, j, time.time() - t0


def make_fixtures():
    os.makedirs(OUT, exist_ok=True)
    from PIL import Image
    # 透明 PNG
    p = os.path.join(OUT, "transparent.png")
    if not os.path.exists(p):
        im = Image.new("RGBA", (640, 480), (0, 0, 0, 0))
        for x in range(0, 640, 40):
            for y in range(0, 480, 40):
                im.putpixel((x, y), (255, 120, 60, 255))
        im.save(p)
    # 尺寸超標（5000 寬，檔案很小）
    p2 = os.path.join(OUT, "toowide.png")
    if not os.path.exists(p2):
        Image.new("RGB", (5000, 20), (30, 60, 200)).save(p2)
    # 尺寸過小
    p3 = os.path.join(OUT, "tiny.png")
    if not os.path.exists(p3):
        Image.new("RGB", (8, 8), (10, 10, 10)).save(p3)
    return p, p2, p3


def worker_pids():
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
         "Where-Object { $_.CommandLine -like '*wd14_worker.py*' }).ProcessId"],
        capture_output=True, text=True)
    return [int(x) for x in out.stdout.split() if x.strip().isdigit()]


def main():
    # 先清掉上一次測試留下的孤兒 worker，確保「首次啟動」是真的首次
    for pid in worker_pids():
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)
    time.sleep(1.0)
    transparent, toowide, tiny = make_fixtures()
    general_png = r"D:\ComfyUI\output_missing.png"
    general_png = r"D:\ComfyUI_output\ui_00056_.png"
    adult_png = r"D:\ComfyUI_output\ui_00057_.png"
    square_png = r"D:\ComfyUI_output\ui_00063_.png"
    webp = r"C:\ComfyUI\simple_ui\assets\mascot-happy.webp"

    # ── 8/9：Worker 首次啟動 + 模型只載入一次 ─────────────────
    t0 = time.time()
    log_before = os.path.getsize(LOG) if os.path.exists(LOG) else 0
    st, j, dt = post({"image": b64(general_png)})
    first_dt = dt
    check("T8", "Worker 首次啟動並完成第一次反推", st == 200 and j.get("ok"),
          {"status": st, "seconds": round(dt, 2), "rating": (j.get("rating") or {}).get("name"),
           "general": len(j.get("general") or [])})

    # ── 1 一般 PNG ───────────────────────────────────────────
    check("T1", "一般 PNG 反推成功", st == 200 and j.get("ok") and len(j.get("general") or []) > 0,
          {"rating": (j.get("rating") or {}).get("name"), "general": len(j.get("general") or [])})

    # ── 2 成人向 PNG ─────────────────────────────────────────
    st, j2, dt2 = post({"image": b64(adult_png)})
    check("T2", "成人向 PNG 反推成功且 rating=explicit",
          st == 200 and j2.get("ok") and (j2.get("rating") or {}).get("name") == "explicit",
          {"rating": (j2.get("rating") or {}).get("name"), "general": len(j2.get("general") or []),
           "seconds": round(dt2, 2)})

    # ── 3 WebP ───────────────────────────────────────────────
    st, j3, _ = post({"image": b64(webp)})
    check("T3", "WebP 反推成功", st == 200 and j3.get("ok"),
          {"rating": (j3.get("rating") or {}).get("name"), "general": len(j3.get("general") or [])})

    # ── 4 透明 PNG ───────────────────────────────────────────
    st, j4, _ = post({"image": b64(transparent)})
    check("T4", "透明 PNG 反推成功", st == 200 and j4.get("ok"),
          {"rating": (j4.get("rating") or {}).get("name"), "general": len(j4.get("general") or [])})

    # ── 5 非正方形 ───────────────────────────────────────────
    st, j5, _ = post({"image": b64(general_png)})
    check("T5", "非正方形圖片（1216x832）反推成功", st == 200 and j5.get("ok"),
          {"general": len(j5.get("general") or [])})

    # ── 6 無效圖片 ───────────────────────────────────────────
    st, j6, _ = post({"image": base64.b64encode(b"this is not an image at all").decode()})
    check("T6", "無效圖片被擋下（415）", st == 415 and j6.get("code") == "BAD_TYPE",
          {"status": st, "error": j6.get("error")})

    # ── 7 超過大小限制 ───────────────────────────────────────
    st, j7, _ = post({"image": base64.b64encode(os.urandom(9 * 1024 * 1024)).decode()})
    check("T7a", "超過 8MB 上限被擋下（413）", st == 413 and j7.get("code") == "TOO_LARGE",
          {"status": st, "error": j7.get("error")})
    st, j7b, _ = post({"image": base64.b64encode(b"x" * (13 * 1024 * 1024)).decode()})
    check("T7b", "超過 12MB 上傳上限被擋下（413）", st == 413,
          {"status": st, "code": j7b.get("code")})
    st, j7c, _ = post({"image": b64(toowide)})
    check("T7c", "尺寸超過 4096 被擋下（413）", st == 413 and j7c.get("code") == "TOO_LARGE",
          {"status": st, "error": j7c.get("error")})
    st, j7d, _ = post({"image": b64(tiny)})
    check("T7d", "尺寸過小被擋下（400）", st == 400 and j7d.get("code") == "TOO_SMALL",
          {"status": st, "error": j7d.get("error")})

    # ── 9 Worker 重複請求：模型沒有重複載入 ───────────────────
    log_after = open(LOG, "rb").read()[log_before:].decode("utf-8", "replace") if os.path.exists(LOG) else ""
    loads = log_after.count("ONNX 模型載入完成")
    check("T9", "多次請求後模型只載入一次", loads == 1,
          {"model_load_count": loads, "requests_so_far": 9})

    # ── 11 多個請求 request_id 不錯配 ────────────────────────
    import threading
    results = {}

    def hit(key, path):
        st, jj, _ = post({"image": b64(path)})
        results[key] = (st, jj)

    threads = [
        threading.Thread(target=hit, args=("general", general_png)),
        threading.Thread(target=hit, args=("adult", adult_png)),
        threading.Thread(target=hit, args=("webp", webp)),
    ]
    t1 = time.time()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    par = time.time() - t1
    ok11 = (results.get("general", (0, {}))[1].get("rating") or {}).get("name") == "general" \
        and (results.get("adult", (0, {}))[1].get("rating") or {}).get("name") == "explicit" \
        and results.get("webp", (0, {}))[1].get("ok") is True
    check("T11", "多個請求同時送達時結果不會錯配", ok11,
          {"general": (results.get("general", (0, {}))[1].get("rating") or {}).get("name"),
           "adult": (results.get("adult", (0, {}))[1].get("rating") or {}).get("name"),
           "webp_ok": results.get("webp", (0, {}))[1].get("ok"),
           "wall_seconds": round(par, 2)})

    # ── 10 Worker 異常退出後恢復 ─────────────────────────────
    pids = worker_pids()
    for pid in pids:
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)
    time.sleep(1.0)
    st, j10, dt10 = post({"image": b64(square_png)})
    check("T10", "Worker 被殺掉後，下次請求會自動重啟並成功",
          st == 200 and j10.get("ok") and dt10 > 2.0,
          {"killed": pids, "status": st, "seconds": round(dt10, 2),
           "rating": (j10.get("rating") or {}).get("name")})

    # ── 12 Worker 啟動失敗 ───────────────────────────────────
    env = dict(os.environ)
    env["SIMPLE_UI_PORT"] = "7861"
    env["WD14_WORKER"] = r"C:\ComfyUI\tools\__no_such_worker__.py"
    proc = subprocess.Popen(
        [r"C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe",
         r"C:\ComfyUI\simple_ui\server.py"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=0x08000000)
    time.sleep(2.5)
    try:
        st, j12, _ = post({"image": b64(general_png)}, base="http://127.0.0.1:7861", timeout=60)
        check("T12", "Worker 啟動失敗時回明確錯誤（503）",
              st == 503 and j12.get("code") == "WORKER_ERROR" and bool(j12.get("error")),
              {"status": st, "error": j12.get("error")})
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()

    # ── 效能：連續 5 張 ──────────────────────────────────────
    pool = [general_png, adult_png, square_png, webp, transparent]
    t0 = time.time()
    times = []
    for p in pool:
        st, jj, dt = post({"image": b64(p)})
        times.append(round(dt, 2))
    total = time.time() - t0
    check("PERF", "連續 5 張圖片總耗時", total < 120,
          {"per_image": times, "total_seconds": round(total, 2),
           "avg": round(total / len(pool), 2)})

    # ── 暫存目錄清理 ─────────────────────────────────────────
    left = os.listdir(r"C:\ComfyUI\tmp\wd14") if os.path.isdir(r"C:\ComfyUI\tmp\wd14") else []
    check("T15", "反推用完後暫存目錄沒有殘留", len(left) == 0, {"leftover": left[:10]})

    summary = {"total": len(R), "passed": sum(1 for x in R if x["pass"]),
               "failed": [x["id"] for x in R if not x["pass"]]}
    print("\n=== SUMMARY === " + json.dumps(summary, ensure_ascii=False))
    with open(os.path.join(TMP, "wd14_api_test_report.json"), "w", encoding="utf-8") as f:
        json.dump({"results": R, "summary": summary}, f, ensure_ascii=False, indent=2)
    return 0 if not summary["failed"] else 1


if __name__ == "__main__":
    sys.exit(main())
