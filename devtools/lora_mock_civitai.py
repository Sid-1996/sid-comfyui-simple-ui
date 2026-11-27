"""lora_mock_civitai.py — 隔離測試用的假 Civitai 公開 API（無 GPU、無下載）

只實作 /api/v1/models 與兩個測試用控制端點：
  GET /__mock/last   回傳最後一次 /api/v1/models 的 query（驗證 nsfw / cursor）
  POST /__mock/reset 清空紀錄

參數：
  --port 18189   監聽 port（127.0.0.1）
"""

import argparse
import json
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CKPT = "WAI-Nsfw-Illustrious-17.safetensors"
CKPT_SIZE_KB = 6775430.353515625

CHECKPOINT_ITEM = {
    "id": 827184, "name": "WAI-illustrious-SDXL", "type": "Checkpoint",
    "modelVersions": [{
        "id": 2883731, "name": "v17.0", "baseModel": "Illustrious",
        "baseModelType": "Standard", "trainedWords": [],
        "files": [{"name": CKPT, "sizeKB": CKPT_SIZE_KB, "type": "Model", "primary": True,
                   "metadata": {"format": "SafeTensor"},
                   "hashes": {"SHA256": "ABC123"},
                   "downloadUrl": "https://civitai.com/api/download/models/2883731"}],
        "images": [],
    }],
}


def lora_item(mid, name, base, version_name="v1", nsfw=False):
    return {
        "id": mid, "name": name, "type": "LORA", "nsfw": nsfw,
        "baseModels": [base], "description": "<p>should-not-leak</p>",
        "stats": {"downloadCount": 1000 - mid, "thumbsUpCount": 50},
        "creator": {"username": "mock"},
        "modelVersions": [{
            "id": mid * 10, "name": version_name, "baseModel": base,
            "baseModelType": "Standard", "trainedWords": ["mock_word"],
            "files": [{"name": "file-%d.safetensors" % mid, "sizeKB": 12345.5,
                       "metadata": {"format": "SafeTensor"},
                       "hashes": {"SHA256": "HASH%d" % mid},
                       "primary": True, "downloadUrl": "https://civitai.com/api/download/models/%d" % mid}],
            "images": [],
        }],
    }


PAGE1 = [
    lora_item(1060551, "Illustrious Style Pack", "Illustrious"),
    lora_item(43820, "Pixel Art XL & 1.5", "Pony", "v1-XL-pony"),
]
PAGE2 = [lora_item(264290, "Pony Styles", "Pony")]

# 圖片預覽專用 mock（只提供 URL metadata，不提供圖片本體）
IMG_BASE = "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/fab28432-7d00-43c4-fbd6-ac5989ebf000/original=true/%d.jpeg"


def image_item(iid, **kw):
    # 真實 API 形狀：沒有 nsfw 布林，只有數字 nsfwLevel + minor/poi。
    d = {"id": iid, "url": IMG_BASE % iid, "type": "image",
         "width": 1280, "height": 1920, "nsfwLevel": 1,
         "minor": False, "poi": False}
    d.update(kw)
    return d


def image_pages(nsfw=False):
    good = lora_item(700001, "Image Good", "Illustrious", "v1")
    good["modelVersions"][0]["images"] = [
        image_item(1), image_item(2),
        {"id": 3, "url": IMG_BASE % 3, "type": "image", "nsfw": True},           # 明確成熟
        # 未知字串等級：既不當成熟，也不能當成公開安全
        {"id": 4, "url": IMG_BASE % 4, "type": "image", "nsfwLevel": "Weird",
         "minor": False, "poi": False},
    ]
    other = {
        "id": 700011, "name": "v-pony", "baseModel": "Pony", "baseModelType": "Standard",
        "trainedWords": [], "files": [], "images": [image_item(99)],
    }
    good["modelVersions"].append(other)
    none = lora_item(700002, "Image None", "Illustrious", "v1")
    none["modelVersions"][0]["images"] = []
    adult_model = lora_item(700004, "Image NSFW Model", "Illustrious", "v1", nsfw=True)
    adult_model["modelVersions"][0]["images"] = [image_item(5)]
    items = [good, none, adult_model]
    if nsfw:
        # 成熟模式獨有標記，讓 UI 測試能確認新回應已套用（避免讀到上一輪結果）。
        marker = lora_item(700003, "Image Nsfw Mode", "Illustrious", "v1")
        marker["modelVersions"][0]["images"] = [image_item(10)]
        items.append(marker)
    return items

STATE = {"last": None, "all": [], "lock": threading.Lock()}

# Phase 2：公開版本 metadata（匿名）。可為每個版本獨立設定回應、狀態與延遲，
# 用來測試「舊請求延遲失敗不得覆蓋新版本成功狀態」。
VERSIONS = {}
VERSION_LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _json(self, code, obj):
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(parts.query)
        if parts.path == "/__mock/last":
            return self._json(200, STATE["last"] or {})
        if parts.path == "/__mock/all":
            return self._json(200, STATE["all"])
        if parts.path.startswith("/api/v1/model-versions/"):
            vid = parts.path.rsplit("/", 1)[-1]
            with VERSION_LOCK:
                cfg = dict(VERSIONS.get(vid) or {})
            delay = cfg.pop("delay_ms", 0)
            if delay:
                time.sleep(delay / 1000.0)
            if not cfg:
                return self._json(404, {"error": "Model not found"})
            code = int(cfg.get("code", 200))
            if code != 200:
                return self._json(code, {"error": "mock error"})
            return self._json(200, cfg.get("data", {}))
        if parts.path != "/api/v1/models":
            return self._json(404, {"error": "not found"})
        with STATE["lock"]:
            STATE["last"] = q
            STATE["all"].append(q)
        kinds = (q.get("types") or [""])[0]
        if kinds == "Checkpoint":
            return self._json(200, {"items": [CHECKPOINT_ITEM] if
                                    (q.get("nsfw") or [""])[0] == "true" else [], "metadata": {}})
        query = (q.get("query") or [""])[0]
        if query == "none":
            return self._json(200, {"items": [], "metadata": {}})
        if query == "images":
            nsfw = (q.get("nsfw") or [""])[0] == "true"
            return self._json(200, {"items": image_pages(nsfw), "metadata": {}})
        if query == "rate":
            self.send_response(429)
            self.send_header("Retry-After", "3")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"slow down"}')
            return
        if query == "bad":
            raw = b"{ not json"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if (q.get("cursor") or [""])[0] == "page2":
            return self._json(200, {"items": PAGE2, "metadata": {}})
        return self._json(200, {"items": PAGE1, "metadata": {"nextCursor": "page2"}})

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/__mock/reset":
            with STATE["lock"]:
                STATE["last"] = None
                STATE["all"] = []
            with VERSION_LOCK:
                VERSIONS.clear()
            return self._json(200, {"ok": True})
        if path == "/__mock/version":
            n = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(n) if n else b"{}"
            try:
                patch = json.loads(raw or b"{}")
            except Exception:
                patch = {}
            vid = str(patch.get("id", ""))
            if vid:
                with VERSION_LOCK:
                    VERSIONS[vid] = {
                        "data": patch.get("data", {}),
                        "code": int(patch.get("code", 200)),
                        "delay_ms": int(patch.get("delay_ms", 0)),
                    }
            return self._json(200, {"ok": True})
        return self._json(404, {"error": "not found"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18189)
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("mock civitai on %d" % srv.server_address[1], flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
