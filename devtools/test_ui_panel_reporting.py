"""test_ui_panel_reporting.py — 控制台 UI 回報處理的隔離測試

不啟動 tkinter 視窗、不呼叫 ui_control.ps1、不碰正式服務。
只驗證 ui_panel.pyw 解析 PowerShell JSON 的行為，以及兩個控制台都清楚標示失敗。
執行：python devtools/test_ui_panel_reporting.py
"""

import importlib.util
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("ui_panel_mod", os.path.join(ROOT, "ui_panel.pyw"))
panel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(panel)

passed = 0


def check(name, cond, detail=""):
    global passed
    if not cond:
        print("  FAIL %s  %s" % (name, detail))
        raise SystemExit(1)
    passed += 1
    print("  PASS " + name)


class Result:
    def __init__(self, stdout=b"", stderr=b""):
        self.stdout = stdout
        self.stderr = stderr


def fake_run(payload):
    def run(*args, **kwargs):
        raw = payload if isinstance(payload, bytes) else payload.encode("utf-8")
        return Result(stdout=raw, stderr=b"")
    return run


original_run = panel.subprocess.run
try:
    panel.subprocess.run = fake_run(json.dumps({"Ok": True, "Message": "已關閉"}))
    ok, msg = panel.call_control("stop")
    check("Ok=true 解析為成功", ok is True and msg == "已關閉", repr((ok, msg)))

    panel.subprocess.run = fake_run(json.dumps({"Ok": False, "Message": "停止逾時：連接埠 7860 仍在監聽"}))
    ok, msg = panel.call_control("stop")
    check("Ok=false 解析為失敗且保留白話原因", ok is False and "7860" in msg, repr((ok, msg)))

    panel.subprocess.run = fake_run(json.dumps({"Ok": False, "Result": "foreign_port", "Message": "被其他程式占用"}))
    ok, msg = panel.call_control("start")
    check("外部占用結果不會被當成成功", ok is False and "占用" in msg, repr((ok, msg)))

    panel.subprocess.run = fake_run("<html>不是 JSON</html>")
    ok, msg = panel.call_control("status")
    check("非 JSON 回應視為失敗", ok is False and "不是 JSON" in msg, repr((ok, msg)))

    def timeout_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0] if args else "cmd", 300)
    panel.subprocess.run = timeout_run
    ok, msg = panel.call_control("restart")
    check("逾時視為失敗", ok is False and "逾時" in msg, repr((ok, msg)))
finally:
    panel.subprocess.run = original_run

pyw = open(os.path.join(ROOT, "ui_panel.pyw"), encoding="utf-8").read()
ps1 = open(os.path.join(ROOT, "ui_panel.ps1"), encoding="utf-8").read()
check("tkinter 控制台對失敗結果加註「操作失敗」", "操作失敗：" in pyw)
check("tkinter 控制台完成後重新讀取實際狀態", "self.refresh_status()" in pyw)
check("WinForms 控制台對失敗結果加註「操作失敗」", "操作失敗：" in ps1)
check("WinForms 控制台統一設定成功/失敗訊息", "Set-ActionMessage" in ps1)

print("\n%d tests passed" % passed)
