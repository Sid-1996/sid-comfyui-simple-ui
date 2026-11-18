"""簡易生圖的本機伺服器。

  python server.py  ->  http://127.0.0.1:7860

負責三件事：
  1. 提供 simple_ui 底下的靜態檔（.html / .css / .js / assets 圖檔）
  2. 把 /comfy/* 反向代理到 ComfyUI（127.0.0.1:8188）
  3. /start-comfy 一鍵啟動 ComfyUI、/open-output 開啟圖片資料夾
"""

import base64
import hashlib
import http.server
import json
import mimetypes
import os
import select
import socket
import socketserver
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

COMFY = "http://127.0.0.1:8188"
COMFY_ROOT = r"C:\ComfyUI\ComfyUI_windows_portable"
COMFY_PY = os.path.join(COMFY_ROOT, "python_embeded", "python.exe")
LOG_DIR = r"C:\ComfyUI\logs"
OUTPUT_DIR = r"D:\ComfyUI_output"

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, "assets")

# 只開放這幾種副檔名，避免把 .py / 金鑰檔當靜態內容送出去
ALLOWED = {".html", ".css", ".js", ".png", ".webp", ".jpg", ".jpeg", ".svg", ".ico", ".woff2", ".json"}
NO_STORE = {".html", ".css", ".js", ".json"}

_start_lock = threading.Lock()


def port_open(port, host="127.0.0.1"):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.35)
        return s.connect_ex((host, port)) == 0


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
    """ComfyUI 沒開就把它開起來，回傳是否成功。"""
    if port_open(8188):
        return True
    with _start_lock:
        if port_open(8188):
            return True
        os.makedirs(LOG_DIR, exist_ok=True)
        out = open(os.path.join(LOG_DIR, "comfyui.log"), "ab", buffering=0)
        err = open(os.path.join(LOG_DIR, "comfyui.err.log"), "ab", buffering=0)
        subprocess.Popen(
            [COMFY_PY, "-s", r"ComfyUI\main.py", "--windows-standalone-build",
             "--output-directory", OUTPUT_DIR],
            cwd=COMFY_ROOT, stdout=out, stderr=err,
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        )
        for _ in range(wait_seconds):
            if port_open(8188):
                time.sleep(1.5)
                return True
            time.sleep(1)
        return False


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

    # ── GET ────────────────────────────────────────────────
    def do_GET(self):
        if self.path.startswith("/ws"):
            return self._ws_tunnel()
        if self.path.startswith("/comfy/"):
            return self._proxy()
        if self.path == "/open-output":
            try:
                os.startfile(OUTPUT_DIR)
                return self._json(200, {"ok": True})
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
        if self.path == "/api/status":
            return self._json(200, {"comfy": port_open(8188), "output": OUTPUT_DIR})
        if self.path == "/api/check":
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
            ok = start_comfy()
            return self._json(200 if ok else 504, {"ok": ok, "comfy": port_open(8188)})
        if self.path == "/api/check":
            return self._check_files()
        if self.path == "/api/delete":
            return self._delete_file()
        return self._json(404, {"error": "not found"})

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
        if not port_open(8188):
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

    # ── 刪圖（移到資源回收筒，路徑必須在輸出資料夾內）──────────────
    def _delete_file(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if n > 20_000:
            return self._json(413, {"ok": False, "error": "too large"})
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._json(400, {"ok": False, "error": "bad json"})

        name = str(data.get("filename") or "").strip()
        sub = str(data.get("subfolder") or "").strip().replace("\\", "/").strip("/")
        typ = str(data.get("type") or "output")
        if not name or "/" in name or "\\" in name or ".." in sub:
            return self._json(400, {"ok": False, "error": "檔名不合法"})
        if typ != "output":
            return self._json(400, {"ok": False, "error": "只能刪輸出圖"})

        root = os.path.realpath(OUTPUT_DIR)
        path = os.path.realpath(os.path.join(root, sub, name))
        if os.path.dirname(path) != root and not path.startswith(root + os.sep):
            return self._json(400, {"ok": False, "error": "路徑不合法"})
        if not os.path.isfile(path):
            return self._json(200, {"ok": True, "already": True})

        if recycle(path):
            return self._json(200, {"ok": True, "recycled": True})
        try:
            os.remove(path)
            return self._json(200, {"ok": True, "recycled": False})
        except Exception as e:
            return self._json(500, {"ok": False, "error": str(e)})

    # ── WebSocket 代理（ComfyUI 只接受同源，所以由 7860 轉發）──────
    WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    def _ws_tunnel(self):
        ckey = self.headers.get("Sec-WebSocket-Key")
        if not ckey:
            return self._json(400, {"error": "missing Sec-WebSocket-Key"})
        if not port_open(8188):
            return self._json(503, {"error": "ComfyUI not running"})

        try:
            up = socket.create_connection(("127.0.0.1", 8188), timeout=10)
        except OSError as e:
            return self._json(502, {"error": str(e)})

        try:
            ukey = base64.b64encode(os.urandom(16)).decode()
            handshake = (
                "GET %s HTTP/1.1\r\n"
                "Host: 127.0.0.1:8188\r\n"
                "Origin: http://127.0.0.1:8188\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                "Sec-WebSocket-Key: %s\r\n"
                "Sec-WebSocket-Version: 13\r\n\r\n" % (self.path, ukey)
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
            if b" 101 " not in head.split(b"\r\n", 1)[0]:
                raise OSError("ComfyUI 拒絕 WebSocket：" + head.split(b"\r\n", 1)[0].decode(errors="replace"))

            accept = base64.b64encode(hashlib.sha1((ckey + self.WS_GUID).encode()).digest()).decode()
            self.wfile.write((
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                "Sec-WebSocket-Accept: %s\r\n\r\n" % accept).encode())
            self.wfile.flush()
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

        if not full.startswith(ROOT):          # path traversal
            return self._send(403, b"forbidden", "text/plain; charset=utf-8")
        if os.path.isdir(full) or not os.path.isfile(full):
            full = os.path.join(ROOT, "index.html")   # 前端路由一律回首頁

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
    os.makedirs(ASSETS, exist_ok=True)
    print("簡易生圖: http://127.0.0.1:7860  (ComfyUI: %s)" % ("已連線" if port_open(8188) else "未啟動"))
    S(("127.0.0.1", 7860), H).serve_forever()


if __name__ == "__main__":
    main()
