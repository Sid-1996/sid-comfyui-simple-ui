"""lora_explorer_api_test.py — LoRA 探索中心後端測試

用隔離的 mock Civitai + mock ComfyUI + 臨時 simple_ui server（全部 127.0.0.1 隨機 port），
不連真實 Civitai、不碰正式 7860/8188、不讀寫模型、不下載任何檔案。
執行：python devtools/lora_explorer_api_test.py
"""

import http.server
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

CKPT = "WAI-Nsfw-Illustrious-17.safetensors"
SIZE_KB = 6775430.353515625
SIZE_BYTES = 6938040682

CHECKPOINT_ITEM = {
    "id": 827184, "name": "WAI-illustrious-SDXL", "type": "Checkpoint",
    "modelVersions": [{
        "id": 2883731, "name": "v17.0", "baseModel": "Illustrious",
        "baseModelType": "Standard", "trainedWords": [],
        "files": [{"name": CKPT, "sizeKB": SIZE_KB, "type": "Model", "primary": True,
                   "metadata": {"format": "SafeTensor"},
                   "hashes": {"SHA256": "ABC123", "AutoV2": "SECRET"},
                   "downloadUrl": "https://civitai.com/api/download/models/2883731"}],
        "images": [{"url": "should-not-leak"}],
    }],
}
LORA_ITEM = {
    "id": 1060551, "name": "Illustrious Style Pack", "type": "LORA",
    "nsfw": False, "baseModels": ["Illustrious"],
    "description": "<p>should-not-leak</p>",
    "stats": {"downloadCount": 100, "thumbsUpCount": 5},
    "creator": {"username": "tester"},
    "modelVersions": [{
        "id": 2211883, "name": "IFL", "baseModel": "Illustrious",
        "baseModelType": "Standard", "trainedWords": ["miku", "blue eyes"],
        "files": [{"name": "IFL_v1.0_IL.safetensors", "sizeKB": 111786.57,
                   "metadata": {"format": "SafeTensor"},
                   "hashes": {"SHA256": "DEF456", "AutoV2": "SECRET"},
                   "primary": True, "downloadUrl": "https://civitai.com/api/download/models/2211883"}],
        "images": [{"url": "should-not-leak"}],
    }],
}

# 圖片正規化測試資料（全部是 metadata，不下載任何圖片）
IMG_BASE = "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/fab28432-7d00-43c4-fbd6-ac5989ebf000/original=true/"


def img(i, **kw):
    # 真實 API 形狀：沒有 nsfw 布林，只有數字 nsfwLevel + minor/poi 布林。
    d = {"id": i, "url": IMG_BASE + "%d.jpeg" % i, "type": "image",
         "width": 1280, "height": 1920, "nsfwLevel": 1,
         "minor": False, "poi": False}
    d.update(kw)
    return d


INVALID_IMAGES = [
    {"id": 900, "url": "http://image.civitai.com/a/original=true/900.jpeg", "type": "image"},
    {"id": 901, "url": "https://evil.example/a/original=true/901.jpeg", "type": "image"},
    {"id": 902, "url": "javascript:alert(1)", "type": "image"},
    {"id": 903, "url": "https://image.civitai.com@evil.example/a/original=true/903.jpeg", "type": "image"},
    {"id": 904, "url": "https://image.civitai.com/a/../original=true/904.jpeg", "type": "image"},
    {"id": 905, "url": "https://image.civitai.com:8443/a/original=true/905.jpeg", "type": "image"},
    {"id": 906, "url": IMG_BASE + "906.jpeg", "type": "video"},
    {"id": 907, "url": None, "type": "image"},
]

IMAGE_LORA_ITEM = {
    "id": 999001, "name": "Image Test Lora", "type": "LORA", "nsfw": False,
    "creator": {"username": "imgtester"},
    "stats": {"downloadCount": 1, "thumbsUpCount": 2},
    "modelVersions": [
        {"id": 99001, "name": "v-good", "baseModel": "Illustrious", "baseModelType": "Standard",
         "trainedWords": ["word1"], "files": [],
         "images": [
             img(1),
             img(2, nsfw=True),
             img(3, minor=True),
             img(4, poi=True),
             img(5, nsfwLevel="Mature"),
             {"id": 6, "url": IMG_BASE + "6.jpeg", "type": "image"},  # 未知標記
             {"id": 7, "url": "https://image.civitai.com/sig/uuid/width=300/7.jpeg", "type": "image"},
             img(8), img(9),
         ] + INVALID_IMAGES},
        {"id": 99002, "name": "v-other", "baseModel": "Pony", "baseModelType": "Standard",
         "trainedWords": [], "files": [], "images": [img(200)]},
        {"id": 99003, "name": "v-empty", "baseModel": "Illustrious", "images": []},
        {"id": 99004, "name": "v-bad", "baseModel": "Illustrious", "images": "not-a-list"},
        {"id": 99005, "name": "v-missing", "baseModel": "Illustrious"},
        {"id": 99006, "name": "v-invalid-only", "baseModel": "Illustrious", "images": INVALID_IMAGES},
        {"id": 99007, "name": "v-nsfw-matrix", "baseModel": "Illustrious",
         "images": [
             {"id": 20, "url": IMG_BASE + "%d.jpeg" %20, "type": "image", "nsfwLevel": 1},
             {"id": 21, "url": IMG_BASE + "%d.jpeg" %21, "type": "image", "nsfwLevel": 16},
             {"id": 22, "url": IMG_BASE + "%d.jpeg" %22, "type": "image", "nsfwLevel": "Weird"},
             {"id": 23, "url": IMG_BASE + "%d.jpeg" %23, "type": "image", "nsfw": False, "nsfwLevel": 8},
             {"id": 24, "url": IMG_BASE + "%d.jpeg" %24, "type": "image", "nsfw": True},
             {"id": 25, "url": IMG_BASE + "%d.jpeg" %25, "type": "image", "minor": True},
             {"id": 26, "url": IMG_BASE + "%d.jpeg" %26, "type": "image", "poi": True},
             {"id": 27, "url": IMG_BASE + "%d.jpeg" %27, "type": "image", "nsfwLevel": "X"},
             {"id": 28, "url": IMG_BASE + "%d.jpeg" %28, "type": "image", "nsfw": False, "nsfwLevel": 1},
         ]},
        {"id": 99008, "name": "v-query", "baseModel": "Illustrious",
         "images": [{"id": 30,
                     "url": "https://image.civitai.com/signature/id/original=true/example.jpeg?token=abc123&expires=456#frag",
                     "type": "image", "nsfw": False}]},
    ],
}

STATE = {"checkpoint_items": [CHECKPOINT_ITEM], "lora_items": [LORA_ITEM],
         "requests": [], "size": SIZE_BYTES, "mode": "normal",
         "checkpoint_by_query": {}, "checkpoint_errors": {}}


class MockCivitai(http.server.BaseHTTPRequestHandler):
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
        STATE["requests"].append({"path": parts.path, "query": q})
        if parts.path != "/api/v1/models":
            return self._json(404, {"error": "not found"})
        mode = (q.get("query") or [""])[0]
        if mode == "rate":
            self.send_response(429)
            self.send_header("Retry-After", "7")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"code":"TOO_MANY_REQUESTS","error":"slow down"}')
            return
        if mode == "five":
            return self._json(500, {"error": "oops"})
        if mode == "badjson":
            raw = b"{ not json"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if (q.get("types") or [""])[0] == "Checkpoint":
            # 只接受 nsfw=true；用來驗證 Checkpoint 辨識固定帶 nsfw=true
            if (q.get("nsfw") or [""])[0] != "true":
                return self._json(200, {"items": [], "metadata": {}})
            query = (q.get("query") or [""])[0]
            err = STATE["checkpoint_errors"].get(query)
            if err:
                code, retry = err
                self.send_response(code)
                if retry:
                    self.send_header("Retry-After", retry)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error":"checkpoint error"}')
                return
            items = STATE["checkpoint_by_query"].get(query, STATE["checkpoint_items"])
            return self._json(200, {"items": items, "metadata": {}})
        cur = (q.get("cursor") or [""])[0]
        items = [] if cur == "end" else STATE["lora_items"]
        meta = {"nextCursor": "next-123"} if not cur else {}
        return self._json(200, {"items": items, "metadata": meta})


class MockComfy(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        raw = json.dumps([CKPT]).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve(handler):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


civitai = serve(MockCivitai)
comfy = serve(MockComfy)
server.CIVITAI_API = "http://127.0.0.1:%d/api/v1" % civitai.server_address[1]
server.COMFY = "http://127.0.0.1:%d" % comfy.server_address[1]
server._local_checkpoint_size = lambda name: STATE["size"]

app = server.S(("127.0.0.1", 0), server.H)
ui_port = app.server_address[1]
threading.Thread(target=app.serve_forever, daemon=True).start()

passed = 0


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def test(name, fn):
    global passed
    try:
        fn()
    except AssertionError as exc:
        print("  FAIL " + name + "\n    " + str(exc))
        raise SystemExit(1)
    passed += 1
    print("  PASS " + name)


def get(path):
    url = "http://127.0.0.1:%d%s" % (ui_port, path)
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def reset():
    server._civitai_cache.clear()
    STATE["requests"] = []
    STATE["checkpoint_items"] = [CHECKPOINT_ITEM]
    STATE["lora_items"] = [LORA_ITEM]
    STATE["size"] = SIZE_BYTES
    STATE["mode"] = "normal"
    STATE["checkpoint_by_query"] = {}
    STATE["checkpoint_errors"] = {}


def t_status_exact():
    reset()
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    check(st == 200 and body["ok"], str(body))
    c = body["checkpoint"]
    check(c["baseModel"] == "Illustrious", str(c))
    check(c["confidence"] == "high" and c["source"] == "civitai-exact-file", str(c))
    check(c["versionId"] == 2883731, str(c))
    qs = [r["query"] for r in STATE["requests"] if "Checkpoint" in r["query"].get("types", [])]
    check(qs and qs[0]["nsfw"] == ["true"], "Checkpoint 搜尋未帶 nsfw=true：%r" % qs)


def t_status_size_mismatch():
    reset()
    STATE["size"] = 123
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    check(body["checkpoint"]["baseModel"] is None, str(body))
    check(body["checkpoint"]["confidence"] == "unknown", str(body))
    check(body["checkpoint"]["reason"] == "NO_UNIQUE_MATCH", str(body))


def t_status_name_mismatch():
    reset()
    item = json.loads(json.dumps(CHECKPOINT_ITEM))
    item["modelVersions"][0]["files"][0]["name"] = "other.safetensors"
    STATE["checkpoint_items"] = [item]
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    check(body["checkpoint"]["confidence"] == "unknown", str(body))


def t_status_multiple_candidates():
    reset()
    other = json.loads(json.dumps(CHECKPOINT_ITEM))
    other["id"] = 999999
    other["modelVersions"][0]["id"] = 9999999
    STATE["checkpoint_items"] = [CHECKPOINT_ITEM, other]
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    check(body["checkpoint"]["confidence"] == "unknown", str(body))
    check(body["checkpoint"]["reason"] == "NO_UNIQUE_MATCH", str(body))


def t_status_no_candidate():
    reset()
    STATE["checkpoint_items"] = []
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    check(body["checkpoint"]["confidence"] == "unknown", str(body))


def t_status_no_local_size():
    reset()
    server._local_checkpoint_size = lambda name: None
    try:
        st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
        check(body["checkpoint"]["reason"] == "LOCAL_SIZE_UNAVAILABLE", str(body))
    finally:
        server._local_checkpoint_size = lambda name: STATE["size"]


def t_status_nsfw_false_would_miss():
    # mock 在 nsfw=false 時回空清單；若後端沒帶 nsfw=true 就不可能找到配對
    reset()
    qs = urllib.parse.urlencode({"types": "Checkpoint", "query": CKPT, "nsfw": "false", "limit": 20})
    obj, code, _ = server._civitai_get("/models?" + qs)
    check(code == "" and obj["items"] == [], str(obj))
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    check(body["checkpoint"]["baseModel"] == "Illustrious", str(body))


def t_status_invalid_name():
    reset()
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote("../evil.safetensors"))
    check(st == 400 and body["code"] == "CHECKPOINT_NAME_INVALID", str(body))


def t_search_normal():
    reset()
    st, body = get("/api/civitai/search?" + urllib.parse.urlencode({
        "q": "illustrious", "sort": "Most Downloaded", "period": "Week", "nsfw": "0"}))
    check(st == 200 and body["ok"] and len(body["items"]) == 1, str(body)[:400])
    check(body["nextCursor"] == "next-123", str(body))
    item = body["items"][0]
    check("description" not in item and "images" not in item, str(item.keys()))
    check(item["versions"][0]["trainedWords"] == ["miku", "blue eyes"], str(item))
    f = item["versions"][0]["files"][0]
    check(f["sha256"] == "DEF456" and "AutoV2" not in f, str(f))
    check(item["url"] == "https://civitai.com/models/1060551", str(item))
    qs = STATE["requests"][-1]["query"]
    check(qs["nsfw"] == ["false"] and qs["types"] == ["LORA"], str(qs))


def t_search_nsfw_and_cursor():
    reset()
    st, body = get("/api/civitai/search?" + urllib.parse.urlencode({
        "q": "x", "nsfw": "1", "cursor": "end"}))
    check(st == 200 and body["items"] == [], str(body)[:300])
    qs = STATE["requests"][-1]["query"]
    check(qs["nsfw"] == ["true"] and qs["cursor"] == ["end"], str(qs))


def t_search_rate_limited():
    reset()
    st, body = get("/api/civitai/search?q=rate")
    check(st == 429 and body["code"] == "CIVITAI_RATE_LIMITED", str(body))
    check(body.get("retryAfter") == "7", str(body))


def t_search_server_error():
    reset()
    st, body = get("/api/civitai/search?q=five")
    check(st == 502 and body["code"] == "CIVITAI_SERVER_ERROR", str(body))


def t_search_bad_json():
    reset()
    st, body = get("/api/civitai/search?q=badjson")
    check(st == 502 and body["code"] == "CIVITAI_BAD_RESPONSE", str(body))


def t_search_bad_params():
    reset()
    st, body = get("/api/civitai/search?q=" + urllib.parse.quote("x" * 300))
    check(st == 400 and body["code"] == "BAD_QUERY", str(body))
    st, body = get("/api/civitai/search?q=x&sort=NotASort")
    check(st == 400 and body["code"] == "BAD_PARAMS", str(body))


def t_size_decimal():
    check(server._size_matches(SIZE_KB, SIZE_BYTES), "精確大小比對失敗")
    check(not server._size_matches(SIZE_KB, SIZE_BYTES + 1), "大小不同卻通過")
    check(not server._size_matches("abc", SIZE_BYTES), "無效大小卻通過")
    check(not server._size_matches(0, 0), "0 KB 不應視為有效")


def ckpt_queries():
    out = []
    for r in STATE["requests"]:
        q = r["query"]
        if (q.get("types") or [""])[0] == "Checkpoint":
            out.append((q.get("query") or [""])[0])
    return out


def t_no_fallback_on_exact_hit():
    reset()
    ext = CKPT.rsplit(".", 1)[0]
    STATE["checkpoint_by_query"] = {CKPT: [CHECKPOINT_ITEM], ext: []}
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    check(body["checkpoint"]["confidence"] == "high", str(body))
    check(ckpt_queries() == [CKPT], "唯一匹配後仍舊補搜：" + str(ckpt_queries()))


def no_base_item():
    item = json.loads(json.dumps(CHECKPOINT_ITEM))
    item["modelVersions"][0].pop("baseModel", None)
    return item


def t_exact_hit_cached_900s():
    reset()
    url = "/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT)
    st1, body1 = get(url)
    check(st1 == 200 and body1["checkpoint"]["confidence"] == "high", str(body1))
    st2, body2 = get(url)
    check(st2 == 200 and body1 == body2, "兩次結果不一致：%r / %r" % (body1, body2))
    qs = ckpt_queries()
    check(len(qs) == 1 and qs[0] == CKPT, "Civitai Checkpoint 搜尋超過一次或執行 fallback：" + str(qs))
    key = "ckpt|" + CKPT.lower() + "|" + str(SIZE_BYTES)
    hit = server._civitai_cache.get(key)
    check(hit is not None, "成功結果未寫入快取：" + str(list(server._civitai_cache)))
    remaining = hit[0] - time.time()
    check(870 <= remaining <= 901, "快取 TTL 不是 900 秒：%r" % remaining)


def t_exact_hit_missing_base_model():
    reset()
    ext = CKPT.rsplit(".", 1)[0]
    STATE["checkpoint_by_query"] = {CKPT: [no_base_item()], ext: []}
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    check(st == 200 and body["ok"], str(body))
    c = body["checkpoint"]
    check(isinstance(c, dict), str(c))
    check(c.get("baseModel") is None, str(c))
    check(c.get("confidence") == "unknown" and c.get("source") is None, str(c))
    check(c.get("reason") == "BASE_MODEL_UNAVAILABLE", str(c))


def t_fallback_missing_base_model():
    reset()
    ext = CKPT.rsplit(".", 1)[0]
    STATE["checkpoint_by_query"] = {CKPT: [], ext: [no_base_item()]}
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    check(st == 200 and body["ok"], str(body))
    c = body["checkpoint"]
    check(c.get("baseModel") is None and c.get("confidence") == "unknown", str(c))
    check(c.get("reason") == "BASE_MODEL_UNAVAILABLE", str(c))
    check(ckpt_queries() == [CKPT, ext], str(ckpt_queries()))


def t_fallback_finds_unique():
    reset()
    ext = CKPT.rsplit(".", 1)[0]
    STATE["checkpoint_by_query"] = {CKPT: [], ext: [CHECKPOINT_ITEM]}
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    c = body["checkpoint"]
    check(c["confidence"] == "high" and c["baseModel"] == "Illustrious", str(c))
    check(ckpt_queries() == [CKPT, ext], "未執行 extensionless fallback：" + str(ckpt_queries()))


def t_fallback_still_requires_exact_size():
    reset()
    ext = CKPT.rsplit(".", 1)[0]
    wrong = json.loads(json.dumps(CHECKPOINT_ITEM))
    wrong["modelVersions"][0]["files"][0]["sizeKB"] = SIZE_KB + 100
    STATE["checkpoint_by_query"] = {CKPT: [], ext: [wrong]}
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    check(body["checkpoint"]["confidence"] == "unknown", str(body))
    check(body["checkpoint"]["reason"] == "NO_UNIQUE_MATCH", str(body))


def t_merged_candidates_multiple_unknown():
    reset()
    ext = CKPT.rsplit(".", 1)[0]
    other = json.loads(json.dumps(CHECKPOINT_ITEM))
    other["id"] = 999999
    other["modelVersions"][0]["id"] = 9999999
    STATE["checkpoint_by_query"] = {CKPT: [CHECKPOINT_ITEM, other], ext: [CHECKPOINT_ITEM]}
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    check(body["checkpoint"]["confidence"] == "unknown", str(body))
    check(body["checkpoint"]["reason"] == "NO_UNIQUE_MATCH", str(body))
    check(ckpt_queries() == [CKPT, ext], str(ckpt_queries()))


def t_first_round_error_no_fallback():
    reset()
    ext = CKPT.rsplit(".", 1)[0]
    STATE["checkpoint_errors"] = {CKPT: (429, "5")}
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    c = body["checkpoint"]
    check(c["confidence"] == "unknown" and c["reason"] == "HTTP_429", str(c))
    check(ckpt_queries() == [CKPT], "API 錯誤時仍舊補搜：" + str(ckpt_queries()))
    check("error" in body and "放慢" in body["error"], str(body))


def t_fallback_error_is_not_empty():
    reset()
    ext = CKPT.rsplit(".", 1)[0]
    STATE["checkpoint_by_query"] = {CKPT: []}
    STATE["checkpoint_errors"] = {ext: (500, None)}
    st, body = get("/api/civitai/status?ckpt=" + urllib.parse.quote(CKPT))
    c = body["checkpoint"]
    check(c["confidence"] == "unknown" and c["reason"] == "HTTP_500", str(c))
    check(ckpt_queries() == [CKPT, ext], str(ckpt_queries()))
    check("error" in body and "暫時" in body["error"], str(body))


def t_checkpoint_pagination():
    reset()
    calls = []
    original = server._civitai_get

    def fake(path):
        calls.append(path)
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)
        if not (q.get("cursor") or [""])[0]:
            return {"items": [], "metadata": {"nextCursor": "p2"}}, "", None
        return {"items": [CHECKPOINT_ITEM], "metadata": {}}, "", None

    server._civitai_get = fake
    try:
        cands, code = server._search_checkpoint_candidates("anything")
    finally:
        server._civitai_get = original
    check(code == "" and len(cands) == 1, "code=%r cands=%r" % (code, cands))
    check(len(calls) == 2 and "cursor=p2" in calls[1], str(calls))
    check(all("nsfw=true" in p for p in calls), str(calls))


def _image_search_item():
    reset()
    STATE["lora_items"] = [IMAGE_LORA_ITEM]
    st, body = get("/api/civitai/search?q=images")
    check(st == 200 and body["ok"] and len(body["items"]) == 1, str(body)[:300])
    return body["items"][0]


def t_images_normal_limit_and_urls():
    item = _image_search_item()
    imgs = item["versions"][0]["images"]
    check(len(imgs) == 8, "每版本圖片上限應為 8，實際 %d" % len(imgs))
    check([x["id"] for x in imgs] == [1, 2, 3, 4, 5, 6, 7, 8], str([x["id"] for x in imgs]))
    check(imgs[0]["url"].startswith("https://image.civitai.com/") and "original=true" in imgs[0]["url"], str(imgs[0]))
    check("width=300" in imgs[0]["thumb"] and "original=true" not in imgs[0]["thumb"], str(imgs[0]["thumb"]))
    check(imgs[0]["url"] != imgs[0]["thumb"], "原圖 URL 應保留")
    check(imgs[0]["width"] == 1280 and imgs[0]["height"] == 1920, str(imgs[0]))
    # 非 original=true 的路徑不猜測变换，直接退回原圖
    check(imgs[6]["thumb"] == imgs[6]["url"], str(imgs[6]))


def t_images_nsfw_flags():
    imgs = _image_search_item()["versions"][0]["images"]
    check("publicSafe" in imgs[0], "缺少 publicSafe 欄位：" + str(imgs[0].keys()))
    # 真實 API 形狀：沒有 nsfw 布林，但 nsfw=false 搜尋已過濾 → 明確安全
    check(imgs[0]["mature"] is False and imgs[0]["unknown"] is False and imgs[0]["publicSafe"] is True,
          "真實公開圖片應為 publicSafe：" + str(imgs[0]))
    check(imgs[1]["mature"] is True and imgs[1]["publicSafe"] is False, "nsfw=true 應標成熟：" + str(imgs[1]))
    check(imgs[2]["mature"] is True, "minor 應標成熟：" + str(imgs[2]))
    check(imgs[3]["mature"] is True, "poi 應標成熟：" + str(imgs[3]))
    check(imgs[4]["mature"] is True and imgs[4]["nsfwLevel"] == "Mature", str(imgs[4]))
    check(imgs[5]["unknown"] is True and imgs[5]["mature"] is False and imgs[5]["publicSafe"] is False,
          "缺少分類資訊應維持受限制：" + str(imgs[5]))
    check(imgs[0]["nsfwLevel"] == 1, "數字 nsfwLevel 應原樣保留、不猜 bitmask：" + str(imgs[0]))


def t_images_nsfw_unknown_matrix():
    imgs = _image_search_item()["versions"][6]["images"]
    # (id, mature, publicSafe, unknown)
    expected = [
        (20, False, True, False),   # 真實形狀 + nsfw=false 搜尋 → 明確安全
        (21, False, True, False),   # 不解讀數字 16；安全依據是搜尋過濾
        (22, False, False, True),   # 未知字串等級 → 受限制
        (23, False, True, False),   # 明確 nsfw:false
        (24, True, False, False),   # nsfw:true
        (25, True, False, False),   # minor:true
        (26, True, False, False),   # poi:true
        (27, True, False, False),   # nsfwLevel:"X"
    ]
    for item, (iid, mature, public_safe, unknown) in zip(imgs, expected):
        check(item["id"] == iid and item["mature"] is mature and
              item["publicSafe"] is public_safe and item["unknown"] is unknown,
              "NSFW 判斷錯誤：%r 期望 mature=%r publicSafe=%r unknown=%r" %
              (item, mature, public_safe, unknown))


def t_images_search_nsfw_flag_controls_public_safe():
    raw = [img(50)]
    sfw = server._normalize_civitai_images(raw, search_nsfw=False)[0]
    mature_search = server._normalize_civitai_images(raw, search_nsfw=True)[0]
    check(sfw["publicSafe"] is True and sfw["unknown"] is False, str(sfw))
    check(mature_search["publicSafe"] is False and mature_search["unknown"] is True, str(mature_search))
    check(sfw["nsfwLevel"] == mature_search["nsfwLevel"] == 1, "nsfwLevel 應原樣保留")


def t_item_normalization_propagates_search_nsfw():
    """完整呼叫鏈：_normalize_civitai_item(raw, flag) → 圖片 publicSafe。"""
    raw = {
        "id": 999001, "name": "integration", "type": "LORA", "nsfw": True,
        "modelVersions": [{
            "id": 999010, "name": "v1", "baseModel": "Illustrious",
            "images": [img(60), img(61, nsfw=True), img(62, minor=True)],
        }],
    }
    sfw = server._normalize_civitai_item(raw, search_nsfw=False)
    mature = server._normalize_civitai_item(raw, search_nsfw=True)
    check(sfw is not None and mature is not None, "模型正規化失敗")
    a = sfw["versions"][0]["images"][0]
    b = mature["versions"][0]["images"][0]
    check(a["publicSafe"] is True and a["unknown"] is False,
          "search_nsfw=False 應為 publicSafe：" + str(a))
    check(b["publicSafe"] is False and b["unknown"] is True,
          "search_nsfw=True 不應為 publicSafe：" + str(b))
    for res in (sfw, mature):
        ims = res["versions"][0]["images"]
        check(ims[1]["mature"] is True and ims[1]["publicSafe"] is False, str(ims[1]))
        check(ims[2]["mature"] is True and ims[2]["publicSafe"] is False, str(ims[2]))
        check(res["nsfw"] is True, "模型層級 nsfw 應原樣保留：" + str(res.keys()))
        need = {"id", "url", "thumb", "width", "height", "nsfwLevel",
                "mature", "unknown", "publicSafe"}
        check(need.issubset(set(ims[0].keys())), "API 欄位不相容：" + str(ims[0].keys()))


def t_search_api_preserves_nsfw_flag_to_images():
    """實際 API 路徑：nsfw 參數 → civitai_search → item → images。"""
    for nsfw, expected in (("0", True), ("1", False)):
        reset()
        STATE["lora_items"] = [IMAGE_LORA_ITEM]
        st, body = get("/api/civitai/search?" + urllib.parse.urlencode({
            "q": "images", "nsfw": nsfw}))
        check(st == 200 and body["ok"], str(body)[:300])
        im = body["items"][0]["versions"][0]["images"][0]
        check(im["publicSafe"] is expected,
              "nsfw=%s 應 publicSafe=%r：%s" % (nsfw, expected, str(im)))
        qs = STATE["requests"][-1]["query"]
        check((qs.get("nsfw") or [""])[0] == ("false" if nsfw == "0" else "true"), str(qs))


def t_images_query_and_fragment_preserved():
    im = _image_search_item()["versions"][7]["images"][0]
    original = "https://image.civitai.com/signature/id/original=true/example.jpeg?token=abc123&expires=456#frag"
    thumb = "https://image.civitai.com/signature/id/width=300/example.jpeg?token=abc123&expires=456#frag"
    check(im["url"] == original, str(im["url"]))
    check(im["thumb"] == thumb, str(im["thumb"]))
    check("original=true" not in im["thumb"] and "width=300" in im["thumb"], str(im["thumb"]))


def t_images_missing_empty_nonarray():
    vs = _image_search_item()["versions"]
    check(vs[2]["images"] == [], str(vs[2]))
    check(vs[3]["images"] == [], str(vs[3]))
    check(vs[4]["images"] == [], str(vs[4]))


def t_images_invalid_urls_rejected():
    item = _image_search_item()
    check(item["versions"][5]["images"] == [], str(item["versions"][5]))
    ids = [x["id"] for x in item["versions"][0]["images"]]
    check(all(i < 900 for i in ids), "無效 URL/類型不應留住：" + str(ids))


def t_images_version_separation_and_compat():
    item = _image_search_item()
    v1 = [x["id"] for x in item["versions"][0]["images"]]
    v2 = [x["id"] for x in item["versions"][1]["images"]]
    check(v1 == [1, 2, 3, 4, 5, 6, 7, 8] and v2 == [200], str((v1, v2)))
    check("description" not in item and "images" not in item, str(item.keys()))
    check(item["name"] == "Image Test Lora" and item["creator"] == "imgtester", str(item))
    check(item["versions"][0]["trainedWords"] == ["word1"], str(item["versions"][0]))
    check(item["url"] == "https://civitai.com/models/999001", str(item))
    need = {"id", "name", "baseModel", "baseModelType", "trainedWords", "files", "images", "downloadUrl"}
    check(need.issubset(set(item["versions"][0].keys())), str(item["versions"][0].keys()))


tests = [
    ("精確匹配成功後寫入 900 秒快取，重查不再打 Civitai", t_exact_hit_cached_900s),
    ("精確匹配缺少 baseModel → 安全降級 BASE_MODEL_UNAVAILABLE", t_exact_hit_missing_base_model),
    ("fallback 命中缺少 baseModel → 安全降級 BASE_MODEL_UNAVAILABLE", t_fallback_missing_base_model),
    ("精確檔名命中時不執行 fallback", t_no_fallback_on_exact_hit),
    ("精確檔名無候選時 extensionless fallback 找到唯一匹配", t_fallback_finds_unique),
    ("fallback 仍須通過檔名與大小雙重精確比對", t_fallback_still_requires_exact_size),
    ("兩輪候選合併後多筆匹配 → unknown", t_merged_candidates_multiple_unknown),
    ("第一輪 API 錯誤 → 安全降級、不補搜", t_first_round_error_no_fallback),
    ("fallback API 錯誤 → 降級且不被當成空結果", t_fallback_error_is_not_empty),
    ("Checkpoint 搜尋分頁沿用 nextCursor 且固定 nsfw=true", t_checkpoint_pagination),
    ("Checkpoint 唯一精確匹配 → Illustrious / high / civitai-exact-file", t_status_exact),
    ("檔名相同但大小不同 → unknown", t_status_size_mismatch),
    ("大小相同但檔名不同 → unknown", t_status_name_mismatch),
    ("多筆候選 → unknown，不猜測", t_status_multiple_candidates),
    ("沒有候選 → unknown", t_status_no_candidate),
    ("本機大小無法安全取得 → unknown", t_status_no_local_size),
    ("Checkpoint 辨識固定 nsfw=true；nsfw=false 確實會漏掉", t_status_nsfw_false_would_miss),
    ("Checkpoint 名稱驗證", t_status_invalid_name),
    ("搜尋正常回應：白名單欄位、nsfw、分頁", t_search_normal),
    ("成熟內容開關與 cursor 傳遞", t_search_nsfw_and_cursor),
    ("429 → CIVITAI_RATE_LIMITED + retryAfter", t_search_rate_limited),
    ("5xx → CIVITAI_SERVER_ERROR", t_search_server_error),
    ("無效 JSON → CIVITAI_BAD_RESPONSE", t_search_bad_json),
    ("錯誤參數 → 400", t_search_bad_params),
    ("sizeKB 以 Decimal 精確比對", t_size_decimal),
    ("圖片正規化：多張上限、縮圖变换、原圖保留、非原圖路徑降級", t_images_normal_limit_and_urls),
    ("圖片 NSFW：明確成熟／未知標記保守處理、數字等級不猜測", t_images_nsfw_flags),
    ("圖片 NSFW 矩陣：真實形狀＋nsfw=false 搜尋才安全，未知字串受限制", t_images_nsfw_unknown_matrix),
    ("搜尋 nsfw 旗標控制 publicSafe，數字等級不被解讀", t_images_search_nsfw_flag_controls_public_safe),
    ("整合測試：_normalize_civitai_item 正確傳遞 search_nsfw 到圖片", t_item_normalization_propagates_search_nsfw),
    ("整合測試：/api/civitai/search 的 nsfw 参数完整傳到圖片分類", t_search_api_preserves_nsfw_flag_to_images),
    ("縮圖变换保留 query string 與 fragment", t_images_query_and_fragment_preserved),
    ("圖片缺欄位／空陣列／非陣列皆安全回空", t_images_missing_empty_nonarray),
    ("圖片無效 URL / 非 HTTPS / 不可信 CDN / 非 image 類型全數拒絕", t_images_invalid_urls_rejected),
    ("圖片按版本隔離、原有 API 欄位相容", t_images_version_separation_and_compat),
]
for name, fn in tests:
    test(name, fn)

app.shutdown()
app.server_close()
civitai.shutdown()
civitai.server_close()
comfy.shutdown()
comfy.server_close()
print("%d tests passed" % passed)
