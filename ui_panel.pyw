# -*- coding: utf-8 -*-
"""生圖控制台 — pythonw + tkinter，無命令視窗、無延遲空窗。

狀態用 socket 直接查 port（毫秒級）；按鈕動作才呼叫 ui_control.ps1，
並用 CREATE_NO_WINDOW 避免跳出 PowerShell 命令視窗。
"""
import ctypes
import json
import socket
import subprocess
import threading
import tkinter as tk
from tkinter import font as tkfont

PS = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
CONTROL = r"C:\ComfyUI\simple_ui\ui_control.ps1"
CREATE_NO_WINDOW = 0x08000000

BG = "#1e182c"
BTN = "#5c408c"
BTN_HOVER = "#6b4fa0"
GREEN = "#50d278"
RED = "#e65a5a"
FG = "#ffffff"
DIM = "#c8bee0"


def port_up(port):
    """毫秒級检查 port 是否正在監聽。"""
    s = socket.socket()
    s.settimeout(0.25)
    try:
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()


def call_control(action):
    """呼叫 ui_control.ps1 -Action <action>，回傳 (ok, 訊息)。

    PowerShell 5.1 的 stdout 是 Big5，不能用 utf-8 解碼，
    因此先取 bytes 再嘗試 big5 / utf-8，避免中文訊息變亂碼。
    """
    cmd = [PS, "-NoProfile", "-ExecutionPolicy", "Bypass",
           "-File", CONTROL, "-Action", action]
    try:
        r = subprocess.run(
            cmd, capture_output=True,
            creationflags=CREATE_NO_WINDOW, timeout=300,
        )
        raw = (r.stdout or b"").strip()
        text = ""
        for enc in ("utf-8", "big5"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            text = raw.decode("utf-8", errors="replace")
        try:
            data = json.loads(text)
            return bool(data.get("Ok")), (data.get("Message") or text)
        except (ValueError, TypeError):
            return False, (text or (r.stderr or b"").decode("utf-8", errors="replace") or "（沒有收到回應）")
    except subprocess.TimeoutExpired:
        return False, "操作逾時，請檢查 ComfyUI / server.py 是否卡住。"
    except Exception as e:
        return False, f"操作失敗：{e}"


class Console:
    def __init__(self, root):
        self.root = root
        self.buttons = []
        self._busy = False
        self._action_labels = {"start": "▶ 開始生圖", "stop": "■ 關閉生圖", "restart": "↻ 重新啟動"}
        root.title("生圖控制台")
        root.geometry("420x322")
        root.resizable(False, False)
        root.configure(bg=BG)

        self.font = tkfont.Font(family="Microsoft JhengHei", size=10)
        self.font_small = tkfont.Font(family="Microsoft JhengHei", size=9)

        # ---------- 狀態區 ----------
        # 用普通 Frame 當外框 + 標題覆蓋上緣（模擬 GroupBox），
        # 內部的燈號/文字直接用 root 絕對座標，避免 LabelFrame 標題吃掉空間。
        grp = tk.Frame(root, bg=BG, bd=1, relief="groove")
        grp.place(x=16, y=14, width=372, height=82)
        tk.Label(root, text="服務狀態", fg=DIM, bg=BG, font=self.font).place(x=24, y=7)

        self.dot_comfy = self._dot(root, 34, 48)
        self.lbl_comfy = tk.Label(root, fg=FG, bg=BG, font=self.font, anchor="w")
        self.lbl_comfy.place(x=56, y=46, width=320, height=20)

        self.dot_ui = self._dot(root, 34, 72)
        self.lbl_ui = tk.Label(root, fg=FG, bg=BG, font=self.font, anchor="w")
        self.lbl_ui.place(x=56, y=70, width=320, height=20)

        # ---------- 按鈕 ----------
        self.btn_start = self._btn("▶ 開始生圖", 16, 108, lambda: self.act("start"))
        self.btn_stop = self._btn("■ 關閉生圖", 152, 108, lambda: self.act("stop"))
        self.btn_restart = self._btn("↻ 重新啟動", 288, 108, lambda: self.act("restart"))
        self.btn_open = self._btn("開啟介面", 16, 154, self.open_ui)
        self.btn_refresh = self._btn("重新整理狀態", 152, 154, self.refresh_status)
        self.buttons = [self.btn_start, self.btn_stop, self.btn_restart,
                        self.btn_open, self.btn_refresh]
        # 只有這三顆會在動作期間鎖住；「開啟介面」「重新整理狀態」永遠可用。
        self._action_buttons = [self.btn_start, self.btn_stop, self.btn_restart]
        self._auto_open_pending = False   # start 完成/超時後自動開瀏覽器的旗標

        # ---------- 訊息區 ----------
        frame = tk.Frame(root, bg=BG)
        frame.place(x=16, y=204, width=372, height=72)
        self.msg = tk.Text(frame, font=self.font_small, bg="#161020",
                           fg="#aae6aa", relief="solid", bd=1,
                           wrap="word", state="disabled", height=4)
        scroll = tk.Scrollbar(frame, command=self.msg.yview)
        self.msg.config(yscrollcommand=scroll.set)
        self.msg.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        # 初次狀態（socket 查詢，瞬間完成）
        self.refresh_status()
        self.root.after(5000, self._tick)

    # ---------- 小工具 ----------
    def _dot(self, parent, x, y):
        c = tk.Canvas(parent, width=14, height=14, bg=BG, highlightthickness=0)
        c.place(x=x, y=y)
        item = c.create_oval(2, 2, 12, 12, fill=RED, outline="")
        return c, item

    def _set_dot(self, dot, up):
        c, item = dot
        c.itemconfig(item, fill=GREEN if up else RED)

    def _btn(self, text, x, y, command):
        b = tk.Button(self.root, text=text, command=command, font=self.font,
                      bg=BTN, fg=FG, relief="flat", bd=0,
                      activebackground=BTN_HOVER, activeforeground=FG,
                      highlightthickness=0, cursor="hand2")
        b.place(x=x, y=y, width=116, height=38)
        return b

    def _write(self, text):
        self.msg.config(state="normal")
        self.msg.delete("1.0", "end")
        self.msg.insert("1.0", text)
        self.msg.config(state="disabled")

    # ---------- 行為 ----------
    def refresh_status(self):
        comfy = port_up(8188)
        ui = port_up(7860)
        self._set_dot(self.dot_comfy, comfy)
        self._set_dot(self.dot_ui, ui)
        self.lbl_comfy.config(text="ComfyUI (8188)：" + ("運行中" if comfy else "未啟動"))
        self.lbl_ui.config(text="生圖介面 (7860)：" + ("運行中" if ui else "未啟動"))

    def _tick(self):
        self.refresh_status()
        self.root.after(5000, self._tick)

    def act(self, action):
        """背景執行動作；只鎖動作按鈕，「開啟介面」永遠可用。全流程自動處理。"""
        if self._busy:
            return
        self._busy = True
        self._auto_open_pending = (action == "start")
        for b in self._action_buttons:
            b.config(state="disabled")
        self._write(f"正在執行「{self._action_labels[action]}」…請稍候")
        threading.Thread(target=self._act_worker, args=(action,), daemon=True).start()
        # 保險：20 秒內背景沒回報就自動解鎖，改為輪詢 port（後端卡住也不連累 UI）
        self.root.after(20000, lambda: self._unlock_if_stuck(action))

    def _unlock_if_stuck(self, action):
        if not self._busy:
            return  # 背景已正常回報
        self._busy = False
        for b in self._action_buttons:
            b.config(state="normal")
        self._write("啟動程序中，正在自動等待生圖介面準備完成…")
        if self._auto_open_pending:
            self._wait_and_open(0)

    def _wait_and_open(self, tries):
        """背景卡住時的後備：輪詢 7860，起來就自動開瀏覽器（最多 60 秒）。"""
        if not self._auto_open_pending:
            return
        if port_up(7860):
            self._auto_open_pending = False
            import webbrowser
            webbrowser.open("http://127.0.0.1:7860")
            self._write("生圖介面已準備完成，已自動開啟瀏覽器。")
            self.refresh_status()
        elif tries < 60:
            self.root.after(1000, lambda: self._wait_and_open(tries + 1))
        else:
            self._auto_open_pending = False
            self._write("生圖介面啟動逾時，請查看 C:\\ComfyUI\\logs 或按「重新啟動」。")

    def _act_worker(self, action):
        ok, msg = call_control(action)
        self.root.after(0, lambda: self._act_done(action, ok, msg))

    def _act_done(self, action, ok, msg):
        if not self._busy:
            return  # 已被保險計時器解除，避免重複處理
        self._busy = False
        for b in self._action_buttons:
            b.config(state="normal")
        self._write(msg)
        self.refresh_status()

        # start 成功 → 自動開瀏覽器；背景卡住沒回報 → 交給 _wait_and_open 輪詢
        if action == "start":
            if ok and port_up(7860):
                self._auto_open_pending = False
                import webbrowser
                webbrowser.open("http://127.0.0.1:7860")
                self._write(msg + "\n（已自動開啟生圖介面）")
            elif not port_up(7860):
                self._auto_open_pending = True
                self._write(msg + "\n（仍在等待生圖介面，準備好會自動開啟）")
                self._wait_and_open(0)

    def open_ui(self):
        import webbrowser
        webbrowser.open("http://127.0.0.1:7860")
        self._write("已開啟生圖介面（請到瀏覽器操作）。")


def set_window_icon(root):
    """用 imageres.dll,67 當標題列圖示（與桌面捷徑一致），取代 Python 預設圖示。"""
    try:
        from ctypes import wintypes
        hicon = ctypes.windll.shell32.ExtractIconW(None, "imageres.dll", 67)
        if hicon:
            hwnd = wintypes.HWND(int(root.frame(), 16))
            # WM_SETICON = 0x0080; ICON_SMALL = 0, ICON_BIG = 1
            ctypes.windll.user32.SendMessageW(hwnd, 0x0080, 0, hicon)
            ctypes.windll.user32.SendMessageW(hwnd, 0x0080, 1, hicon)
    except Exception:
        pass  # 圖示失敗不影響功能


def main():
    root = tk.Tk()
    root.withdraw()                 # 初始化期間完全不顯示
    Console(root)
    set_window_icon(root)
    root.update_idletasks()

    # 置中（原本 WinForms 的 CenterScreen）
    w, h = root.winfo_width(), root.winfo_height()
    x = (root.winfo_screenwidth() - w) // 2
    y = (root.winfo_screenheight() - h) // 2
    root.geometry(f"+{x}+{y}")
    root.deiconify()                # 完成後一次顯示，無透明空窗
    root.mainloop()


if __name__ == "__main__":
    main()
