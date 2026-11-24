"""lora_mock_comfy.py — 隔離測試用的假 ComfyUI（不產生 GPU 工作）

只實作 simple_ui 會用到的端點：
  /system_stats、/object_info/CheckpointLoaderSimple、/models/loras、
  /view_metadata/loras、POST /prompt、/history/<pid>、/view、/queue、/interrupt

參數：
  --port 18188        監聽 port（127.0.0.1）
  --capture FILE      把每個 /prompt 的 body 依序寫成 JSON Lines
  --history-delay N   等 N 秒才讓 /history 有結果（用來測生成期間改 UI）

測試專用控制端點（正式環境不會有）：
  POST /__mock/loras  body {"loras": [...]}   動態增減清單
"""

import argparse
import base64
import json
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

LORAS = [
    "chars\\MockMiku.safetensors",
    "style/Lineart.safetensors",
    "legacy\\Old.pt",
]

META = {
    "chars\\MockMiku.safetensors": {
        "modelspec.title": "Mock Miku",
        "modelspec.trigger_phrase": "mock_miku, mock miku",
        "modelspec.architecture": "sdxl_base_v1-0/lora",
        "ss_network_dim": "16",
    }
}

STATE = {
    "loras": list(LORAS),
    "capture": None,
    "history_delay": 0,
    "prompt_delay": 0,
    "submitted": {},
    "lock": threading.Lock(),
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, code, raw, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode("utf-8"))

    def _body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw or b"{}")
        except Exception:
            return {}

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        path = parts.path
        if path == "/system_stats":
            return self._json(200, {"system": {"comfyui_version": "0.45.0-mock"},
                                    "devices": []})
        if path == "/object_info/CheckpointLoaderSimple":
            return self._json(200, {"CheckpointLoaderSimple": {
                "input": {"required": {"ckpt_name": [["mock-model.safetensors"]]}},
                "output": ["MODEL", "CLIP", "VAE"],
                "output_name": ["MODEL", "CLIP", "VAE"],
            }})
        if path == "/models/loras":
            return self._json(200, STATE["loras"])
        if path == "/view_metadata/loras":
            name = (urllib.parse.parse_qs(parts.query).get("filename") or [""])[0]
            meta = META.get(name)
            if meta:
                return self._json(200, meta)
            return self._json(404, {"error": "no metadata"})
        if path.startswith("/history/"):
            pid = path.split("/history/", 1)[1]
            info = STATE["submitted"].get(pid)
            if not info:
                return self._json(200, {})
            if time.time() - info["at"] < STATE["history_delay"]:
                return self._json(200, {})
            return self._json(200, {pid: {
                "status": {"status_str": "success", "completed": True, "messages": []},
                "outputs": {"7": {"images": [
                    {"filename": "mock-%s.png" % pid, "subfolder": "", "type": "output"}
                ]}},
            }})
        if path == "/view":
            return self._send(200, PNG, "image/png")
        if path == "/queue":
            return self._json(200, {"queue_running": [], "queue_pending": []})
        if path == "/ws":
            return self._json(400, {"error": "mock 不支援 websocket"})
        return self._json(404, {"error": "unknown " + path})

    def do_POST(self):
        parts = urllib.parse.urlsplit(self.path)
        path = parts.path
        body = self._body()
        if path == "/prompt":
            pid = "mock-%d" % (len(STATE["submitted"]) + 1)
            with STATE["lock"]:
                STATE["submitted"][pid] = {"at": time.time()}
                if STATE["capture"]:
                    with open(STATE["capture"], "a", encoding="utf-8") as f:
                        f.write(json.dumps({"prompt_id": pid, "body": body},
                                           ensure_ascii=False) + "\n")
            if STATE["prompt_delay"]:
                time.sleep(STATE["prompt_delay"])
            return self._json(200, {"prompt_id": pid, "number": 1})
        if path == "/queue":
            return self._json(200, {"ok": True})
        if path == "/interrupt":
            return self._json(200, {"ok": True})
        if path == "/__mock/loras":
            if isinstance(body.get("loras"), list):
                STATE["loras"] = body["loras"]
            return self._json(200, {"ok": True, "loras": STATE["loras"]})
        return self._json(404, {"error": "unknown " + path})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18188)
    ap.add_argument("--capture", default="")
    ap.add_argument("--history-delay", type=float, default=0)
    ap.add_argument("--prompt-delay", type=float, default=0,
                    help="收到 /prompt 後延後回應，用來在生成期間改 UI")
    args = ap.parse_args()
    STATE["capture"] = args.capture
    STATE["history_delay"] = args.history_delay
    STATE["prompt_delay"] = args.prompt_delay
    if args.capture:
        open(args.capture, "w", encoding="utf-8").close()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("mock comfy on %d" % srv.server_address[1], flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
