"""簡易生圖的本機伺服器。

  python server.py  ->  http://127.0.0.1:7860

負責三件事：
  1. 提供 simple_ui 底下的靜態檔（.html / .css / .js / assets 圖檔）
  2. 把 /comfy/* 反向代理到 ComfyUI（預設 127.0.0.1:8188，可用 COMFY_URL 覆寫）
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
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

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

# ── WD14 圖片反推（獨立 CPU Worker，不動 ComfyUI）──────────────
# 下面幾個路徑可用環境變數覆寫，純粹是為了測試時能指向別的檔案；
# 一般使用不需要設定。
WD14_PY = os.environ.get("WD14_PY", r"C:\ComfyUI\tools\wd14-venv\Scripts\python.exe")
WD14_WORKER = os.environ.get("WD14_WORKER", r"C:\ComfyUI\tools\wd14_worker.py")
# ViT v3：用已驗證的獨立 venv（含 onnx），CPU only
WD14_VIT_PY = os.environ.get("WD14_VIT_PY", r"C:\ComfyUI\tools\wd14-vit-eval\venv\Scripts\python.exe")
WD14_VIT_WORKER = os.environ.get("WD14_VIT_WORKER", r"C:\ComfyUI\tools\wd14_vit_worker.py")
WD14_TMP = os.environ.get("WD14_TMP", r"C:\ComfyUI\tmp\wd14")  # 暫存圖片（不放進 simple_ui repo）
WD14_MAX_UPLOAD = 12 * 1024 * 1024             # base64 字串上限
WD14_MAX_BYTES = 8 * 1024 * 1024               # 原始位元組上限
WD14_MAX_DIM = 4096                            # 最長邊上限
WD14_MIN_DIM = 16                              # 最短邊下限
WD14_START_TIMEOUT = 90                        # Worker 啟動逾時（秒）
WD14_INFER_TIMEOUT = 120                       # 單張推論逾時（秒）
WD14_MAX_CONCURRENT = 3                        # 同時反推上限
WD14_TMP_TTL = 3600                            # 暫存檔存活秒數（超過就清掉）


def port_open(port, host="127.0.0.1"):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.35)
        return s.connect_ex((host, port)) == 0


def comfy_up():
    """檢查目前 COMFY_URL 指向的 ComfyUI 是否正在監聽。"""
    return port_open(COMFY_PORT, COMFY_HOST)


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
    if comfy_up():
        return True
    with _start_lock:
        if comfy_up():
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
            if comfy_up():
                time.sleep(1.5)
                return True
            time.sleep(1)
        return False


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


def purge_wd14_tmp(ttl=WD14_TMP_TTL):
    """清掉過期的暫存圖片（失敗或逾時留下來的）。"""
    try:
        if not os.path.isdir(WD14_TMP):
            return 0
        now = time.time()
        n = 0
        for name in os.listdir(WD14_TMP):
            p = os.path.join(WD14_TMP, name)
            try:
                if os.path.isfile(p) and now - os.path.getmtime(p) > ttl:
                    os.remove(p)
                    n += 1
            except OSError:
                pass
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
            raise RuntimeError("找不到 WD14 Python：" + self.py)
        if not os.path.isfile(self.worker):
            raise RuntimeError("找不到 WD14 Worker：" + self.worker)
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
            try:
                os.startfile(OUTPUT_DIR)
                return self._json(200, {"ok": True})
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
        if self.path == "/api/status":
            return self._json(200, {"comfy": comfy_up(), "output": OUTPUT_DIR,
                                    "external": COMFY_EXTERNAL})
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
            ok = start_comfy()
            return self._json(200 if ok else 504, {"ok": ok, "comfy": comfy_up()})
        if self.path == "/api/check":
            return self._check_files()
        if self.path == "/api/delete":
            return self._delete_file()
        if self.path == "/api/reverse":
            return self._reverse()
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

        # 選擇模型：EVA02（預設）或 ViT v3
        model = str(data.get("model") or "eva02").strip().lower()
        worker = WD14_VIT if model in ("vit", "vit_v3", "vit-v3", "wd-vit-tagger-v3") else WD14

        # 寫進專用暫存目錄（不放 simple_ui repo），用完立刻刪
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
    print("簡易生圖: http://127.0.0.1:7860  (ComfyUI: %s)" % ("已連線" if comfy_up() else "未啟動"))
    port = int(os.environ.get("SIMPLE_UI_PORT", "7860") or 7860)
    try:
        S(("127.0.0.1", port), H).serve_forever()
    finally:
        WD14.stop()


if __name__ == "__main__":
    main()
