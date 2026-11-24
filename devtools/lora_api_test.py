"""lora_api_test.py — 角色 LoRA 後端（清單／metadata）測試

用一個隔離的 mock ComfyUI + 一個臨時 simple_ui server（127.0.0.1 隨機 port），
不連正式 ComfyUI、不動正式 7860 服務、不讀寫模型或使用者資料。
執行：python devtools/lora_api_test.py
"""

import http.server
import json
import os
import socket
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

# ComfyUI 可能回傳的各種名稱；後端必須只留安全的 .safetensors
LORA_FILES = [
    "zeta.safetensors",
    "chars\\Miku.safetensors",
    "chars\\alpha.safetensors",
    "dup.safetensors",
    "DUP.safetensors",
    "sub/dir/ok.safetensors",
    "notes.pt",
    "model.ckpt",
    "put_loras_here",
    "../evil.safetensors",
    "C:\\abs.safetensors",
    "/rooted.safetensors",
    "",
]

MIKU_META = {
    "modelspec.title": "Miku v1",
    "modelspec.trigger_phrase": "miku, Miku, hatsune miku",
    "modelspec.architecture": "stable-diffusion-xl-v1-base/lora",
    "ss_network_dim": "32",
    "ss_network_alpha": "16",
    "ss_tag_frequency": '{"dataset": {"1girl": 999}}',
}

EXPECTED = [
    "chars\\alpha.safetensors", "chars\\Miku.safetensors",
    "dup.safetensors", "sub/dir/ok.safetensors", "zeta.safetensors",
]

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


class MockComfy(http.server.BaseHTTPRequestHandler):
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
        if parts.path == "/models/loras":
            return self._json(200, LORA_FILES)
        if parts.path == "/view_metadata/loras":
            name = (urllib.parse.parse_qs(parts.query).get("filename") or [""])[0]
            if name.lower() == "chars\\miku.safetensors":
                return self._json(200, MIKU_META)
            if name.lower() == "zeta.safetensors":
                return self._json(200, {})          # 空 metadata
            return self._json(404, {"error": "not found"})
        return self._json(404, {"error": "unknown"})


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


mock = http.server.ThreadingHTTPServer(("127.0.0.1", 0), MockComfy)
threading.Thread(target=mock.serve_forever, daemon=True).start()
mock_base = "http://127.0.0.1:%d" % mock.server_address[1]

_original_comfy = server.COMFY
server.COMFY = mock_base

app = server.S(("127.0.0.1", 0), server.H)
ui_port = app.server_address[1]
threading.Thread(target=app.serve_forever, daemon=True).start()


def get(path):
    url = "http://127.0.0.1:%d%s" % (ui_port, path)
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def t_list_filter():
    names, code = server.fetch_lora_list()
    check(code == "", "code=%r" % code)
    check(names == EXPECTED, "實際：%r" % (names,))


def t_api_list():
    st, body = get("/api/loras")
    check(st == 200 and body["ok"] is True, "status/ok：%r %r" % (st, body))
    check(body["count"] == 5, "count=%r" % body["count"])
    check(body["loras"][1] == {"name": "chars\\Miku.safetensors",
                               "display": "Miku", "sub": "chars"},
          "第二筆：%r" % (body["loras"][1],))
    check(body["loras"][2]["sub"] == "", "根目錄 sub 應為空：" + repr(body["loras"][2]))


def t_meta_parse():
    meta, code, st = server.fetch_lora_meta("chars\\Miku.safetensors")
    check(code == "" and meta, "code=%r meta=%r" % (code, meta))
    check(meta["triggerWords"] == ["miku", "hatsune miku"], "去重：%r" % (meta["triggerWords"],))
    check(meta["title"] == "Miku v1", meta)
    check(meta["networkDim"] == "32", meta)
    check(meta["architecture"] == "stable-diffusion-xl-v1-base/lora", meta)


def t_api_meta():
    st, body = get("/api/lora-meta?name=" + urllib.parse.quote("chars\\Miku.safetensors"))
    check(st == 200 and body["ok"] is True, "%r %r" % (st, body))
    check(body["meta"]["triggerWords"] == ["miku", "hatsune miku"], body)


def t_meta_empty():
    meta, code, st = server.fetch_lora_meta("zeta.safetensors")
    check(meta is None and code == "NO_METADATA", "code=%r" % code)


def t_meta_not_found():
    meta, code, st = server.fetch_lora_meta("not\\there.safetensors")
    check(meta is None and code == "LORA_NOT_FOUND", "code=%r" % code)


def t_meta_absolute():
    meta, code, st = server.fetch_lora_meta("C:\\Windows\\evil.safetensors")
    check(meta is None and code == "LORA_NAME_INVALID", "code=%r" % code)


def t_api_meta_404():
    st, body = get("/api/lora-meta?name=missing.safetensors")
    check(st == 404 and body["code"] == "LORA_NOT_FOUND", "%r %r" % (st, body))
    check("已不在" in body["error"], body["error"])


def t_api_meta_400():
    st, body = get("/api/lora-meta?name=" + urllib.parse.quote("C:\\x.safetensors"))
    check(st == 400 and body["code"] == "LORA_NAME_INVALID", "%r %r" % (st, body))


def t_api_meta_missing_name():
    st, body = get("/api/lora-meta")
    check(st == 400, "%r %r" % (st, body))


def t_offline_list():
    server.COMFY = "http://127.0.0.1:%d" % free_port()
    try:
        st, body = get("/api/loras")
        check(st == 503 and body["code"] == "COMFY_OFFLINE", "%r %r" % (st, body))
        check(body["comfy"] is False and "ComfyUI" in body["error"], body)
    finally:
        server.COMFY = mock_base


def t_offline_meta():
    server.COMFY = "http://127.0.0.1:%d" % free_port()
    try:
        st, body = get("/api/lora-meta?name=chars%5CMiku.safetensors")
        check(st == 503 and body["code"] == "COMFY_OFFLINE", "%r %r" % (st, body))
    finally:
        server.COMFY = mock_base


class BadComfy(MockComfy):
    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path == "/models/loras":
            return self._json(200, {"loras": []})
        return super().do_GET()


class EmptyComfy(MockComfy):
    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path == "/models/loras":
            return self._json(200, [])          # ComfyUI 正常，但資料夾沒有模型
        return super().do_GET()


def t_empty_list():
    empty = http.server.ThreadingHTTPServer(("127.0.0.1", 0), EmptyComfy)
    threading.Thread(target=empty.serve_forever, daemon=True).start()
    server.COMFY = "http://127.0.0.1:%d" % empty.server_address[1]
    try:
        names, code = server.fetch_lora_list()
        check(code == "" and names == [], "fetch_lora_list：%r %r" % (names, code))
        st, body = get("/api/loras")
        check(st == 200, "status=%r body=%r" % (st, body))
        check(body == {"ok": True, "comfy": True, "count": 0, "loras": []},
              "空清單格式不是正常成功：%r" % (body,))
    finally:
        server.COMFY = mock_base
        empty.shutdown()
        empty.server_close()


def t_bad_payload():
    bad = http.server.ThreadingHTTPServer(("127.0.0.1", 0), BadComfy)
    threading.Thread(target=bad.serve_forever, daemon=True).start()
    server.COMFY = "http://127.0.0.1:%d" % bad.server_address[1]
    try:
        st, body = get("/api/loras")
        check(st == 502 and body["code"] == "LORA_LIST_INVALID", "%r %r" % (st, body))
    finally:
        server.COMFY = mock_base
        bad.shutdown()
        bad.server_close()


def t_extract_none():
    check(server._lora_meta_extract(None) is None, "None")
    check(server._lora_meta_extract(["x"]) is None, "list")
    check(server._lora_meta_extract({"ss_tag_frequency": "{}"}) is None, "只有 tag frequency")


test("清單：只留 .safetensors、路徑安全、大小寫去重、排序", t_list_filter)
test("/api/loras：回傳可顯示名稱與子資料夾", t_api_list)
test("metadata：modelspec 觸發詞去重、只取可靠欄位", t_meta_parse)
test("/api/lora-meta：200 且有 meta", t_api_meta)
test("metadata：空 metadata → NO_METADATA", t_meta_empty)
test("metadata：不在清單中的名稱 → LORA_NOT_FOUND", t_meta_not_found)
test("metadata：前端傳絕對路徑一律拒絕", t_meta_absolute)
test("/api/lora-meta：不存在的 LoRA 回 404 與白話錯誤", t_api_meta_404)
test("/api/lora-meta：絕對路徑回 400", t_api_meta_400)
test("/api/lora-meta：缺名稱回 400", t_api_meta_missing_name)
test("ComfyUI 離線：/api/loras 回 503 COMFY_OFFLINE", t_offline_list)
test("ComfyUI 離線：/api/lora-meta 回 503", t_offline_meta)
test("格式異常：/api/loras 回 502，不冒充空清單", t_bad_payload)
test("ComfyUI 正常但沒有模型：/api/loras 回正常空清單", t_empty_list)
test("_lora_meta_extract：非 dict／空值回 None", t_extract_none)

app.shutdown()
app.server_close()
mock.shutdown()
mock.server_close()
print("%d tests passed" % passed)
