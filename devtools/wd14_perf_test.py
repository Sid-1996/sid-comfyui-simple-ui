#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""
wd14_perf_test.py — Task 2 效能量測（可重複執行）

量三件事：
  1. ONNX Runtime 執行緒上限的效果（intra_op=2 vs ORT 預設）
  2. Worker 的 RSS 與 OS 執行緒數
  3. ComfyUI 正在生圖時反推的延遲（與待機比較）

輸出 JSON 到 C:\ComfyUI\tmp\wd14_test\perf_report.json
"""
import base64
import ctypes
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
from ctypes import wintypes

PY = r"C:\ComfyUI\tools\wd14-venv\Scripts\python.exe"
MODEL = "C:/ComfyUI/tools/models/wd14/model.onnx"
IMG = "C:/ComfyUI/tmp/wd14_test/general_512.png"
OUT = "C:/ComfyUI/tmp/wd14_test/perf_report.json"


class FT(ctypes.Structure):
    _fields_ = [("lo", wintypes.DWORD), ("hi", wintypes.DWORD)]


def cpu_seconds():
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.GetProcessTimes.argtypes = [ctypes.c_void_p, ctypes.POINTER(FT), ctypes.POINTER(FT),
                                  ctypes.POINTER(FT), ctypes.POINTER(FT)]
    k.GetCurrentProcess.restype = ctypes.c_void_p
    c, e, kern, u = FT(), FT(), FT(), FT()
    k.GetProcessTimes(k.GetCurrentProcess(), ctypes.byref(e), ctypes.byref(kern),
                      ctypes.byref(u), ctypes.byref(c))
    return ((c.hi << 32) | c.lo) / 1e7


def os_threads(pid):
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
                          "(Get-Process -Id %d).Threads.Count" % pid],
                         capture_output=True, text=True)
    try:
        return int(out.stdout.strip())
    except Exception:
        return None


def worker_pid():
    """找出真正持有模型的 worker 行程。

    注意：venv 的 Scripts\\python.exe 是個小啟動器，真正的推論行程是它的子行程，
    所以不能只看 CommandLine 命中 wd14_worker.py 的第一個 PID。
    可靠做法：讀 worker 自己寫進日誌的 PID，再確認它的 RSS 有載入模型。
    """
    log = "C:/ComfyUI/logs/wd14_worker.log"
    pids = []
    try:
        with open(log, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if "[Worker] PID=" in line:
                    try:
                        pids.append(int(line.split("[Worker] PID=")[1].split()[0]))
                    except (IndexError, ValueError):
                        pass
    except OSError:
        return None
    for pid in reversed(pids):
        try:
            out = subprocess.run(["powershell", "-NoProfile", "-Command",
                                  "(Get-Process -Id %d).WorkingSet64" % pid],
                                 capture_output=True, text=True)
            ws = int(out.stdout.strip())
        except Exception:
            continue
        if ws > 500 * 1024 * 1024:      # 模型已載入
            return pid
    return pids[-1] if pids else None


def prepare_array():
    import numpy as np
    from PIL import Image
    im = Image.open(IMG).convert("RGBA")
    c = Image.new("RGBA", im.size, (255, 255, 255))
    c.alpha_composite(im)
    im = c.convert("RGB")
    w, h = im.size
    m = max(w, h)
    pad = Image.new("RGB", (m, m), (255, 255, 255))
    pad.paste(im, ((m - w) // 2, (m - h) // 2))
    arr = np.asarray(pad.resize((448, 448), Image.BICUBIC), dtype=np.float32)[:, :, ::-1]
    return np.ascontiguousarray(np.expand_dims(arr, 0))


def thread_lab():
    """比較 intra_op 限制與 ORT 預設的 CPU 用量。"""
    import onnxruntime as ort
    x = prepare_array()
    out = []
    for intra, label in ((2, "intra_op=2（本專案 Worker 的設定）"),
                         (0, "intra_op=0（ORT 預設，用滿所有核心）")):
        o = ort.SessionOptions()
        o.log_severity_level = 3
        o.intra_op_num_threads = intra
        o.inter_op_num_threads = 1
        s = ort.InferenceSession(MODEL, sess_options=o, providers=["CPUExecutionProvider"])
        s.run(None, {"input": x})          # 暖身
        c0 = cpu_seconds()
        t0 = time.time()
        n = 3
        for _ in range(n):
            s.run(None, {"input": x})
        wall = time.time() - t0
        cpu = cpu_seconds() - c0
        out.append({"label": label, "intra_op": intra, "images": n,
                    "wall_seconds": round(wall, 2), "cpu_seconds": round(cpu, 2),
                    "avg_cores": round(cpu / wall, 2), "per_image_seconds": round(wall / n, 2)})
        print("%-38s wall=%.2fs cpu=%.2fs cores=%.2f each=%.2fs" % (
              label, wall, cpu, cpu / wall, wall / n))
    return out


def api_reverse():
    with open(IMG, "rb") as f:
        blob = base64.b64encode(f.read()).decode()
    req = urllib.request.Request("http://127.0.0.1:7860/api/reverse",
                                 data=json.dumps({"image": blob}).encode(),
                                 method="POST", headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=300) as r:
        j = json.loads(r.read().decode())
    return round(time.time() - t0, 2), bool(j.get("ok"))


def comfy_generate(prompt):
    wf = {
        "1": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": "WAI-Nsfw-Illustrious-17.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "worst quality", "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
        "5": {"class_type": "KSampler",
              "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0],
                        "latent_image": ["4", 0], "seed": 999, "steps": 25, "cfg": 6,
                        "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": "wd14load"}}
    }
    req = urllib.request.Request("http://127.0.0.1:8188/prompt",
                                 data=json.dumps({"prompt": wf}).encode(),
                                 method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode()).get("prompt_id")


def comfy_state(prompt_id):
    with urllib.request.urlopen("http://127.0.0.1:8188/queue", timeout=10) as r:
        q = json.loads(r.read().decode())
    running = [str(x[1]) for x in (q.get("queue_running") or []) if len(x) > 1]
    pending = [str(x[1]) for x in (q.get("queue_pending") or []) if len(x) > 1]
    return (prompt_id in running), (prompt_id in pending)


def main():
    report = {}
    print("=== 1) ONNX Runtime 執行緒上限 ===")
    report["thread_limit"] = thread_lab()

    print("=== 2) 待機中反推 ===")
    idle, ok = api_reverse()
    report["idle_reverse_seconds"] = idle
    print("idle reverse:", idle, "s ok=", ok)

    print("=== 3) ComfyUI 真的在跑時反推 ===")
    pid = comfy_generate("1girl, solo, classroom, window, sunlight")
    t0 = time.time()
    started = False
    while time.time() - t0 < 60:
        running, pending = comfy_state(pid)
        if running:
            started = True
            break
        time.sleep(0.2)
    busy, ok2 = api_reverse()
    report["generation_was_running"] = started
    report["busy_reverse_seconds"] = busy
    report["slowdown_ratio"] = round(busy / idle, 2)
    print("reverse while generating:", busy, "s (started=%s) slowdown=%.0f%%" % (
          started, (busy / idle - 1) * 100))
    while True:
        running, pending = comfy_state(pid)
        if not running and not pending:
            break
        time.sleep(0.5)

    print("=== 4) Worker 行程資源 ===")
    wp = worker_pid()
    report["worker_pid"] = wp
    report["worker_os_threads"] = os_threads(wp) if wp else None
    print("worker pid:", wp, "os threads:", report["worker_os_threads"])

    try:
        import ctypes
        class PMC(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("pf", wintypes.DWORD),
                        ("pws", ctypes.c_size_t), ("ws", ctypes.c_size_t),
                        ("q1", ctypes.c_size_t), ("q2", ctypes.c_size_t),
                        ("q3", ctypes.c_size_t), ("q4", ctypes.c_size_t),
                        ("q5", ctypes.c_size_t), ("q6", ctypes.c_size_t)]
        c = PMC()
        c.cb = ctypes.sizeof(c)
        p = ctypes.WinDLL("psapi")
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        h = k.OpenProcess(0x1000, False, wp)
        p.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(PMC), wintypes.DWORD]
        p.GetProcessMemoryInfo(h, ctypes.byref(c), c.cb)
        report["worker_rss_mb"] = round(c.ws / 1048576.0, 1)
        report["worker_peak_rss_mb"] = round(c.pws / 1048576.0, 1)
        print("worker rss:", report["worker_rss_mb"], "MB peak:", report["worker_peak_rss_mb"], "MB")
    except Exception as exc:
        print("rss 量測失敗:", exc)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print("saved", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
