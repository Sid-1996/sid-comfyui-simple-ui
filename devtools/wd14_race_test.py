#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""WD14 Worker 跨行程 pending 競態測試（Task 2-R1 / P2-a）。

直接測 server.py 真正的 Wd14Worker 程式碼，驗證：
  R1 pending slot 記錄所屬 process
  R2 _on_exit(proc) 只處理同一個 process 的 slot（舊 Worker 結束不影響新 Worker）
  R3 reader thread 綁定自己的 process（不會讀到別的 Worker 的 stdout）
  R4 submit() 寫入 stdin 的 process 與 slot 記錄的是同一個
  R5 Worker 送出前就死掉 → 回明確錯誤，不會卡住
  R6 真實環境：推論中殺掉 Worker → 該請求回 503，下一個請求自動恢復
  R7 _on_exit() 不覆寫已完成的 pending slot（Task 2-R3 / P2-1）

執行：
    & 'C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe' simple_ui\devtools\wd14_race_test.py
"""
import base64
import importlib.util
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

SERVER_PY = r"C:\ComfyUI\simple_ui\server.py"
BASE = os.environ.get("REV_BASE", "http://127.0.0.1:7860")
TMP = r"C:\ComfyUI\tmp\wd14_test"
IMG = os.path.join(TMP, "general_512.png")

R = []


def check(cid, name, ok, detail=None):
    R.append({"id": cid, "name": name, "pass": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL") + " [" + cid + "] " + name + " :: "
          + json.dumps(detail, ensure_ascii=False))
    return bool(ok)


def load_server():
    spec = importlib.util.spec_from_file_location("simple_ui_server_under_test", SERVER_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── 假的 Worker process（不需要真的推論）─────────────────────────
class FakeStdin(object):
    def __init__(self, proc):
        self.proc = proc

    def write(self, s):
        self.proc.written.append(s)
        return len(s)

    def flush(self):
        pass

    def close(self):
        pass


class FakeProc(object):
    def __init__(self, pid, name):
        self.pid = pid
        self.name = name
        self.returncode = None
        self.stdin = FakeStdin(self)
        self.stdout = []
        self.written = []

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        return self.returncode

    def kill(self):
        self.returncode = -9


class DyingProc(FakeProc):
    """第一次 poll 回 None（活著），之後都回 1（死掉）。"""

    def __init__(self, pid, name):
        FakeProc.__init__(self, pid, name)
        self.polls = 0

    def poll(self):
        self.polls += 1
        return None if self.polls == 1 else 1


class DummyErr(object):
    def close(self):
        pass


def make_worker(server, proc):
    """假裝 Worker 已經 ready（不真的啟動子行程）。"""
    w = server.Wd14Worker()
    w.ready_info = {"model": "fake-model"}
    with w.lock:
        w.proc = proc
        w.errfiles[proc] = DummyErr()
    return w


def submit_async(w, path, timeout=90):
    """在背景執行 submit()，回傳 (thread, result_holder)。"""
    out = {}

    def run():
        out["r"] = w.submit(path, 0.35, 0.85, timeout)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t, out


def wait_pending(w, n, timeout=5.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        with w.lock:
            if len(w.pending) >= n:
                return list(w.pending.keys())
        time.sleep(0.02)
    with w.lock:
        return list(w.pending.keys())


def post(payload, timeout=180):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(BASE + "/api/reverse", data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:300]}


def worker_pids():
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
         "Where-Object { $_.CommandLine -like '*wd14_worker.py*' }).ProcessId"],
        capture_output=True, text=True)
    return [int(x) for x in out.stdout.split() if x.strip().isdigit()]


def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def main():
    server = load_server()

    # ── R1/R2/R4：舊 Worker 晚一步結束，不得殺掉新 Worker 的請求 ──
    procA = FakeProc(9001, "A")
    w = make_worker(server, procA)

    tA, outA = submit_async(w, "fake_A.png")
    rids = wait_pending(w, 1)
    okA = len(rids) == 1
    ridA = rids[0] if rids else None
    slotA = w.pending.get(ridA) if ridA else None
    check("R1", "pending slot 記錄了所屬的 Worker process",
          bool(slotA) and slotA.get("proc") is procA,
          {"rid": ridA, "proc_is_A": bool(slotA) and slotA.get("proc") is procA})
    check("R4a", "stdin 寫進的是建立 slot 的同一個 process（A）",
          len(procA.written) == 1, {"writes_to_A": len(procA.written)})

    # A 死掉 → 換新的 Worker B 上線
    procA.returncode = 1
    procB = FakeProc(9002, "B")
    with w.lock:
        w.proc = procB
    w.ready_info = {"model": "fake-model"}

    tB, outB = submit_async(w, "fake_B.png")
    rids = wait_pending(w, 2)
    ridB = None
    for r in rids:
        if r != ridA:
            ridB = r
    slotB = w.pending.get(ridB) if ridB else None
    check("R1b", "新 Worker B 的 pending slot 記錄的是 B",
          bool(slotB) and slotB.get("proc") is procB,
          {"rid": ridB, "proc_is_B": bool(slotB) and slotB.get("proc") is procB})
    check("R4b", "stdin 寫進的是建立 slot 的同一個 process（B）",
          len(procB.written) == 1 and len(procA.written) == 1,
          {"writes_to_B": len(procB.written), "writes_to_A": len(procA.written)})

    # 舊 Worker A 的 reader 晚一步結束 → 只能影響 A 的請求
    w._on_exit(procA)

    check("R2a", "A 的 pending 會被正確標記失敗",
          bool(slotA) and slotA["event"].is_set()
          and "意外結束" in str((slotA["msg"] or {}).get("error", "")),
          {"msg": slotA["msg"] if slotA else None})
    check("R2b", "B 的 pending 不受 A 結束影響（還在等待）",
          bool(slotB) and not slotB["event"].is_set() and slotB["msg"] is None,
          {"event_set": slotB["event"].is_set() if slotB else None,
           "msg": slotB["msg"] if slotB else None})
    check("R2c", "B 的 pending 還在 pending 表裡（沒被提前清掉）",
          ridB in w.pending, {"rid_in_pending": ridB in w.pending})
    check("R2d", "A 結束不會把 worker.proc 清成 None（新的 B 還在）",
          w.proc is procB, {"proc": getattr(w.proc, "pid", None)})

    # 讓 B 的請求正常完成，清掉現場
    if slotB:
        slotB["msg"] = {"success": True, "result": {"general": [], "character": [],
                                                    "rating": {"name": "general", "score": 0.0}}}
        slotB["event"].set()
    tB.join(timeout=10)
    tA.join(timeout=10)
    check("R2e", "B 的請求最後拿到自己的結果（沒有被 A 的結束污染）",
          outB.get("r") and outB["r"][0] is True, {"result": outB.get("r")})

    # ── R3：reader 綁定自己的 process ───────────────────────────
    procC = FakeProc(9003, "C")
    procD = FakeProc(9004, "D")
    w2 = make_worker(server, procD)          # 現行 Worker 是 D
    rid = "rid-reader-test"
    slot = {"event": threading.Event(), "msg": None, "proc": procD}
    w2.pending[rid] = slot
    # 這則訊息在「舊 Worker C」的 stdout 裡
    procC.stdout = [json.dumps({"type": "result", "request_id": rid,
                                "success": True,
                                "result": {"general": [], "character": [],
                                           "rating": {"name": "general", "score": 0.0}}})]
    t = threading.Thread(target=w2._reader, args=(procC,), daemon=True)
    t.start()
    t.join(timeout=5)
    check("R3a", "reader 讀自己的 stdout（不是現行 Worker 的 stdout）",
          slot["event"].is_set() and bool(slot["msg"] and slot["msg"].get("success")),
          {"msg": slot["msg"]})
    check("R3b", "舊 Worker 的 reader 結束不會影響現行 Worker 的 pending",
          w2.proc is procD and slot["msg"].get("success") is True,
          {"proc": getattr(w2.proc, "pid", None)})

    # ── R5：送出前 Worker 就死掉 → 回明確錯誤 ───────────────────
    procE = DyingProc(9005, "E")
    w3 = make_worker(server, procE)
    ok, err, keep = w3.submit("fake_E.png", 0.35, 0.85, 5)
    check("R5", "送出前 Worker 死掉 → 回明確錯誤而不是卡住",
          ok is False and "剛剛結束" in str(err) and keep is False,
          {"ok": ok, "err": err, "keep_file": keep})

    # ── R7：_on_exit 不覆寫已完成的 pending slot（Task 2-R3 / P2-1）──
    # 真實情境：Worker 回完結果才被殺 → _dispatch 已寫入成功結果，
    # 同一個 reader thread 接著在 finally 觸發 _on_exit，不可以把它覆寫掉。
    procF = FakeProc(9006, "F")
    w4 = make_worker(server, procF)

    # A) 已完成成功結果
    rid_ok = "rid-guard-success"
    slot_ok = {"event": threading.Event(), "msg": None, "proc": procF}
    w4.pending[rid_ok] = slot_ok
    w4._dispatch({"type": "result", "request_id": rid_ok, "success": True,
                  "result": {"general": ["1girl"], "character": [],
                             "rating": {"name": "general", "score": 0.98}}})
    before_ok = json.dumps(slot_ok["msg"], ensure_ascii=False, sort_keys=True)
    w4._on_exit(procF)
    after_ok = json.dumps(slot_ok["msg"], ensure_ascii=False, sort_keys=True)
    check("R7a", "已完成的成功結果不會被 _on_exit 覆寫成 crashed",
          slot_ok["msg"].get("success") is True
          and "crashed" not in slot_ok["msg"]
          and before_ok == after_ok
          and slot_ok["event"].is_set(),
          {"before": json.loads(before_ok), "after": json.loads(after_ok)})

    # B) 已完成錯誤結果（Worker 正常回錯誤）
    procG = FakeProc(9007, "G")
    w5 = make_worker(server, procG)
    rid_err = "rid-guard-error"
    slot_err = {"event": threading.Event(), "msg": None, "proc": procG}
    w5.pending[rid_err] = slot_err
    w5._dispatch({"type": "result", "request_id": rid_err, "success": False,
                  "error": "推論失敗：測試用的錯誤"})
    w5._on_exit(procG)
    check("R7b", "已完成的錯誤結果不會被 _on_exit 覆寫",
          slot_err["msg"].get("success") is False
          and slot_err["msg"].get("error") == "推論失敗：測試用的錯誤"
          and "crashed" not in slot_err["msg"],
          {"msg": slot_err["msg"]})

    # C) 尚未完成的 pending → 仍要收到 crashed 通知
    procH = FakeProc(9008, "H")
    w6 = make_worker(server, procH)
    rid_wait = "rid-guard-wait"
    slot_wait = {"event": threading.Event(), "msg": None, "proc": procH}
    w6.pending[rid_wait] = slot_wait
    w6._on_exit(procH)
    check("R7c", "尚未完成的 pending 仍會收到 crashed 通知",
          slot_wait["event"].is_set()
          and slot_wait["msg"].get("crashed") is True
          and slot_wait["msg"].get("success") is False
          and "意外結束" in str(slot_wait["msg"].get("error", "")),
          {"msg": slot_wait["msg"]})

    # D) A/B Worker 隔離
    procI = FakeProc(9009, "I")
    procJ = FakeProc(9010, "J")
    w7 = make_worker(server, procJ)              # 現行 Worker 是 J
    rid_done = "rid-guard-done"
    rid_other = "rid-guard-other"
    slot_done = {"event": threading.Event(), "msg": None, "proc": procI}
    slot_other = {"event": threading.Event(), "msg": None, "proc": procJ}
    w7.pending[rid_done] = slot_done
    w7.pending[rid_other] = slot_other
    w7._dispatch({"type": "result", "request_id": rid_done, "success": True,
                  "result": {"general": ["1girl"], "character": [],
                             "rating": {"name": "general", "score": 0.98}}})
    w7._on_exit(procI)                           # 舊 Worker I 結束
    check("R7d1", "舊 Worker 的 _on_exit 不覆寫自己已完成的結果",
          slot_done["msg"].get("success") is True and "crashed" not in slot_done["msg"],
          {"msg": slot_done["msg"]})
    check("R7d2", "舊 Worker 的 _on_exit 不影響新 Worker 尚未完成的 pending",
          slot_other["msg"] is None and not slot_other["event"].is_set(),
          {"msg": slot_other["msg"], "event_set": slot_other["event"].is_set()})
    check("R7d3", "舊 Worker 的 _on_exit 不會把現行 Worker 清成 None",
          w7.proc is procJ, {"proc": getattr(w7.proc, "pid", None)})

    # E) 完整重現真實執行順序：reader 讀到結果 → stdout 結束 → finally 觸發 _on_exit
    procK = FakeProc(9011, "K")
    w8 = make_worker(server, procK)
    rid_full = "rid-guard-full"
    slot_full = {"event": threading.Event(), "msg": None, "proc": procK}
    w8.pending[rid_full] = slot_full
    procK.stdout = [json.dumps({"type": "result", "request_id": rid_full,
                                 "success": True,
                                 "result": {"general": ["1girl"], "character": [],
                                            "rating": {"name": "general", "score": 0.98}}})]
    t8 = threading.Thread(target=w8._reader, args=(procK,), daemon=True)
    t8.start()
    t8.join(timeout=5)
    check("R7e", "reader 讀完結果後 Worker 結束，成功結果仍然保留（真實執行順序）",
          slot_full["event"].is_set() and slot_full["msg"].get("success") is True
          and "crashed" not in slot_full["msg"],
          {"msg": slot_full["msg"]})

    # ── R6：真實環境：推論中殺掉 Worker ───────────────────────
    if not os.path.exists(IMG):
        check("R6", "真實環境測試（缺少測試圖）", False, {"missing": IMG})
    else:
        payload = {"image": b64(IMG)}
        res = {}

        def run_post():
            try:
                res["r"] = post(payload, timeout=180)
            except Exception as exc:
                res["r"] = ("EXC", str(exc))

        th = threading.Thread(target=run_post, daemon=True)
        t0 = time.time()
        th.start()
        killed = []
        while time.time() - t0 < 20:
            pids = worker_pids()
            if pids and (time.time() - t0) > 4.0:
                for pid in pids:
                    subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)
                killed = pids
                break
            time.sleep(0.2)
        th.join(timeout=60)
        st, j = res.get("r", (None, {}))
        check("R6a", "推論中殺掉 Worker → 該請求明確失敗（503）而不是無限期等待",
              st == 503 and bool(j.get("error")), {"killed": killed, "status": st, "error": j.get("error")})

        st2, j2 = post(payload, timeout=180)
        check("R6b", "Worker 被殺後下一個請求會自動重啟並成功",
              st2 == 200 and j2.get("ok"),
              {"status": st2, "ok": j2.get("ok"),
               "rating": (j2.get("rating") or {}).get("name")})
        # 清掉這次測試留下來的暫存檔（逾時/崩潰會保留，交由 TTL 清理）
        left = []
        tmpdir = r"C:\ComfyUI\tmp\wd14"
        if os.path.isdir(tmpdir):
            for name in os.listdir(tmpdir):
                left.append(os.path.join(tmpdir, name))
        for p in left:
            try:
                os.remove(p)
            except OSError:
                pass

    summary = {"total": len(R), "passed": sum(1 for x in R if x["pass"]),
               "failed": [x["id"] for x in R if not x["pass"]]}
    print("\n=== SUMMARY === " + json.dumps(summary, ensure_ascii=False))
    out = os.path.join(TMP, "wd14_race_test_report.json")
    os.makedirs(TMP, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"results": R, "summary": summary}, f, ensure_ascii=False, indent=2)
    return 0 if not summary["failed"] else 1


if __name__ == "__main__":
    sys.exit(main())
