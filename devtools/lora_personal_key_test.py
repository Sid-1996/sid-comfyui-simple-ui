"""lora_personal_key_test.py — 階段 A（Civitai Personal API Key）隔離測試

全部使用本機隨機 port 的 mock Civitai + 臨時 DATA_DIR + 假金鑰，
不連正式 7860／8188、不呼叫真實 Civitai、不下載模型、不碰使用者資料。

執行：python devtools/lora_personal_key_test.py
"""

import http.server
import json
import os
import socket
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server  # noqa: E402

FAKE_KEY = "TEST-KEY-DO-NOT-USE-12345"
TMP = tempfile.TemporaryDirectory(prefix="sid-civitai-key-")
server.DATA_DIR = TMP.name
server._KEY_PATH = os.path.join(TMP.name, server.KEY_FILE_NAME)

STATE = {
    "me_mode": "200", "requests": [], "lock": threading.Lock(),
    "redirect_to": "", "redirect_code": 302, "redirect_owner_port": None,
}


class MockCivitai(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, code, obj, extra=None):
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(parts.query)
        with STATE["lock"]:
            STATE["requests"].append({
                "path": parts.path,
                "query": q,
                "authorization": self.headers.get("Authorization"),
                "port": self.server.server_address[1],
            })
        if (STATE["redirect_to"] and
                STATE["redirect_owner_port"] == self.server.server_address[1]):
            self.send_response(STATE["redirect_code"])
            self.send_header("Location", STATE["redirect_to"])
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if parts.path == "/api/v1/me":
            mode = STATE["me_mode"]
            if mode == "401":
                return self._json(401, {"error": "Unauthorized"})
            if mode == "403":
                return self._json(403, {"error": "forbidden for this operation"})
            if mode == "429":
                return self._json(429, {"error": "slow down", "code": "TOO_MANY_REQUESTS"},
                                  {"Retry-After": "5"})
            if mode == "500":
                return self._json(500, {"error": "oops"})
            return self._json(200, {
                "id": 12345, "username": "tester", "tier": "founder",
                "status": "active", "isMember": True, "subscriptions": ["monthly"],
                "email": "secret@example.com", "emailVerified": True,
            })
        if parts.path == "/api/v1/models":
            return self._json(200, {"items": [], "metadata": {}})
        return self._json(404, {"error": "not found"})


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve(handler):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


civitai = serve(MockCivitai)
civitai_port = civitai.server_address[1]
STATE["redirect_owner_port"] = civitai_port
server.CIVITAI_API = "http://127.0.0.1:%d/api/v1" % civitai_port
server.CIVITAI_ME_URL = "http://127.0.0.1:%d/api/v1/me" % civitai_port
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


def good():
    return {"X-SimpleUI": "1", "Origin": "http://127.0.0.1:%d" % ui_port}


def call(method, path, body=None, headers=None, raw=None):
    url = "http://127.0.0.1:%d%s" % (ui_port, path)
    h = dict(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h.setdefault("Content-Type", "application/json")
    elif raw is not None:
        data = raw
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def last_req():
    with STATE["lock"]:
        return STATE["requests"][-1] if STATE["requests"] else {}


def clear_reqs():
    with STATE["lock"]:
        STATE["requests"] = []


def reset():
    STATE["me_mode"] = "200"
    STATE["redirect_to"] = ""
    STATE["redirect_code"] = 302
    server._civitai_cache.clear()
    clear_reqs()
    try:
        os.remove(server._KEY_PATH)
    except FileNotFoundError:
        pass


def assert_no_key(value):
    check(FAKE_KEY not in json.dumps(value, ensure_ascii=False), "回應中出現金鑰原文")


def t_dpapi_roundtrip():
    reset()
    cipher = server._dpapi_protect(b"hello-dpapi")
    check(isinstance(cipher, bytes) and cipher, "加密結果為空")
    check(b"hello-dpapi" not in cipher, "加密結果含明文")
    check(server._dpapi_unprotect(cipher) == b"hello-dpapi", "DPAPI round-trip 失敗")


def t_save_status_remove():
    reset()
    st, body = call("POST", "/api/civitai/key", {"key": FAKE_KEY}, good())
    check(st == 200 and body.get("ok"), str((st, body)))
    assert_no_key(body)
    st, body = call("GET", "/api/civitai/key/status")
    check(st == 200 and body.get("configured") is True, str(body))
    assert_no_key(body)
    with open(server._KEY_PATH, "rb") as f:
        raw = f.read()
    check(FAKE_KEY.encode() not in raw, "密文檔含明文 Key")
    st, body = call("POST", "/api/civitai/key/remove", headers=good())
    check(st == 200 and body.get("configured") is False, str(body))
    check(not os.path.exists(server._KEY_PATH), "移除後密文檔仍存在")
    st, body = call("GET", "/api/civitai/key/status")
    check(body.get("configured") is False, str(body))


def t_validation_and_save_failure():
    reset()
    st, body = call("POST", "/api/civitai/key", {"key": ""}, good())
    check(st == 400 and body.get("code") == "KEY_INVALID", str((st, body)))
    st, body = call("POST", "/api/civitai/key", {"key": "a b c d e f g h"}, good())
    check(st == 400 and body.get("code") == "KEY_INVALID", str((st, body)))
    st, body = call("POST", "/api/civitai/key", {"key": "x" * 600}, good())
    check(st == 400 and body.get("code") == "KEY_INVALID", str((st, body)))
    original = server._atomic_write_key
    server._atomic_write_key = lambda data: (_ for _ in ()).throw(OSError("disk full"))
    try:
        st, body = call("POST", "/api/civitai/key", {"key": FAKE_KEY}, good())
        check(st == 500 and body.get("ok") is False, str((st, body)))
        check(body.get("code") == "KEY_SAVE_FAILED", str(body))
        check("disk full" not in json.dumps(body), "例外內容外洩")
    finally:
        server._atomic_write_key = original
    check(not os.path.exists(server._KEY_PATH), "保存失敗卻留下檔案")


def t_decrypt_failure_no_crash():
    reset()
    os.makedirs(os.path.dirname(server._KEY_PATH), exist_ok=True)
    with open(server._KEY_PATH, "wb") as f:
        f.write(b"not-a-valid-dpapi-blob")
    st, body = call("GET", "/api/civitai/key/status")
    check(st == 200 and body.get("configured") is True, str(body))
    check("重新輸入" in body.get("error", ""), str(body))
    assert_no_key(body)
    st, body = call("POST", "/api/civitai/key/test", headers=good())
    check(st == 409 and body.get("code") == "KEY_DECRYPT_FAILED", str((st, body)))
    st, body = call("GET", "/api/civitai/key/status")
    check(st == 200, "解密失敗後服務崩潰")
    call("POST", "/api/civitai/key/remove", headers=good())


def t_origin_guard():
    reset()
    st, body = call("POST", "/api/civitai/key", {"key": FAKE_KEY})
    check(st == 403 and body.get("code") == "FORBIDDEN", str((st, body)))
    st, body = call("POST", "/api/civitai/key", {"key": FAKE_KEY},
                    {"X-SimpleUI": "1", "Origin": "http://evil.example"})
    check(st == 403 and body.get("code") == "FORBIDDEN", str((st, body)))
    st, body = call("POST", "/api/civitai/key", {"key": FAKE_KEY}, good())
    check(st == 200, str((st, body)))
    for p in ("/api/civitai/key/test", "/api/civitai/key/remove"):
        st, body = call("POST", p, headers={"X-SimpleUI": "1"})
        check(st == 200, "缺少 Origin 不應被拒（與 _set_output_dir 一致）：" + str((p, st, body)))
        st, body = call("POST", p, headers={"X-SimpleUI": "1", "Origin": "http://evil.example"})
        check(st == 403 and body.get("code") == "FORBIDDEN", str((p, st, body)))


def t_body_limit():
    reset()
    st, body = call("POST", "/api/civitai/key", raw=b"x" * 5000,
                    headers=dict(good(), **{"Content-Type": "application/json"}))
    check(st == 413 and body.get("code") == "TOO_LARGE", str((st, body)))
    st, body = call("POST", "/api/civitai/key", raw=b"{ bad json",
                    headers=dict(good(), **{"Content-Type": "application/json"}))
    check(st == 400 and body.get("code") == "BAD_JSON", str((st, body)))


def t_me_modes():
    reset()
    call("POST", "/api/civitai/key", {"key": FAKE_KEY}, good())
    clear_reqs()
    st, body = call("POST", "/api/civitai/key/test", headers=good())
    check(st == 200 and body.get("ok") is True, str((st, body)))
    check(set(body.keys()) == {"ok", "username", "tier"}, str(body.keys()))
    check(body.get("username") == "tester" and body.get("tier") == "founder", str(body))
    assert_no_key(body)
    for k in ("email", "emailVerified", "id", "subscriptions", "status"):
        check(k not in body, "回傳了不允許欄位：" + k)
    r = last_req()
    check(r.get("authorization") == "Bearer " + FAKE_KEY, "Mock 未收到 Bearer：" + str(r))
    check("token=" not in r.get("path", ""), "使用了 query token")

    for mode, want_status, want_code in (
        ("401", 401, "CIVITAI_KEY_INVALID"),
        ("403", 403, "CIVITAI_FORBIDDEN"),
        ("429", 429, "CIVITAI_RATE_LIMITED"),
        ("500", 502, "CIVITAI_SERVER_ERROR"),
    ):
        STATE["me_mode"] = mode
        clear_reqs()
        st, body = call("POST", "/api/civitai/key/test", headers=good())
        check(st == want_status and body.get("code") == want_code,
              "%s -> %r" % (mode, (st, body)))
        assert_no_key(body)
        if mode == "429":
            check(body.get("retryAfter") == "5", str(body))
        if mode == "401":
            check("無效" in body.get("error", ""), str(body))
        if mode == "403":
            check("不代表金鑰無效" in body.get("error", ""), str(body))

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        dead = s.getsockname()[1]
    original = server.CIVITAI_ME_URL
    server.CIVITAI_ME_URL = "http://127.0.0.1:%d/api/v1/me" % dead
    try:
        st, body = call("POST", "/api/civitai/key/test", headers=good())
        check(st == 503 and body.get("code") == "CIVITAI_OFFLINE", str((st, body)))
        assert_no_key(body)
    finally:
        server.CIVITAI_ME_URL = original


def t_search_stays_anonymous():
    reset()
    call("POST", "/api/civitai/key", {"key": FAKE_KEY}, good())
    clear_reqs()
    items, nxt, code, retry = server.civitai_search("anything")
    check(code == "", "匿名搜尋失敗：" + str(code))
    r = last_req()
    check(r.get("authorization") is None, "公開搜尋帶了 Bearer：" + str(r))
    clear_reqs()
    candidates, code = server._search_checkpoint_candidates("anything")
    check(code == "", "Checkpoint 搜尋失敗：" + str(code))
    r = last_req()
    check(r.get("authorization") is None, "Checkpoint 搜尋帶了 Bearer：" + str(r))
    clear_reqs()
    st, body = call("GET", "/api/civitai/search?q=x")
    check(st == 200 and body.get("ok"), str((st, body)))
    r = last_req()
    check(r.get("authorization") is None, "API 路由搜尋帶了 Bearer：" + str(r))


def t_auth_host_guard():
    reset()
    check(server._civitai_auth_allowed() is False, "mock host 被判定可送真 Key")
    official = server.CIVITAI_API
    server.CIVITAI_API = "https://civitai.com/api/v1"
    try:
        check(server._civitai_auth_allowed() is True, "正式 host 被判定不可送 Key")
    finally:
        server.CIVITAI_API = official
    call("POST", "/api/civitai/key", {"key": FAKE_KEY}, good())
    clear_reqs()
    server._civitai_get("/api/v1/x", auth=True)
    r = last_req()
    check(r.get("authorization") is None, "auth=True 把 Key 送到了 mock host")


def t_auth_allowed_urls():
    original = server.CIVITAI_API
    cases = [
        ("https://civitai.com/api/v1", True),
        ("https://civitai.com:443/api/v1", True),
        ("https://civitai.com:0443/api/v1", True),
        ("https://civitai.com:/api/v1", False),
        ("https://civitai.com:8443/api/v1", False),
        ("https://civitai.com:abc/api/v1", False),
        ("http://civitai.com/api/v1", False),
        ("https://user:pass@civitai.com/api/v1", False),
        ("https://sub.civitai.com/api/v1", False),
        ("https://evil.example/api/v1", False),
        ("明顯不是網址", False),
    ]
    try:
        for url, want in cases:
            server.CIVITAI_API = url
            got = server._civitai_auth_allowed()
            check(got is want, "auth allowed 判定錯誤：%s -> %r" % (url, got))
    finally:
        server.CIVITAI_API = original


def t_redirect_blocked():
    reset()
    target = serve(MockCivitai)
    target_port = target.server_address[1]
    call("POST", "/api/civitai/key", {"key": FAKE_KEY}, good())
    try:
        STATE["redirect_to"] = "http://127.0.0.1:%d/api/v1/me" % target_port
        for code in (301, 302, 303, 307, 308):
            STATE["redirect_code"] = code
            # 正式環境有 host guard；測試強制放行以獨立驗證 redirect 防護
            clear_reqs()
            original = server._civitai_auth_allowed
            server._civitai_auth_allowed = lambda: True
            try:
                obj, err, retry = server._civitai_get("/api/v1/x", auth=True)
            finally:
                server._civitai_auth_allowed = original
            check(err == "REDIRECT_BLOCKED",
                  "%s: _civitai_get 未封鎖 redirect: %r" % (code, err))
            check(len(STATE["requests"]) == 1, "%s: _civitai_get 跟隨了 redirect" % code)
            check(STATE["requests"][0]["authorization"] == "Bearer " + FAKE_KEY,
                  "%s: 首請求未帶 Bearer" % code)

            clear_reqs()
            obj, err, retry = server._civitai_me(FAKE_KEY)
            check(err == "REDIRECT_BLOCKED",
                  "%s: _civitai_me 未封鎖 redirect: %r" % (code, err))
            check(len(STATE["requests"]) == 1, "%s: _civitai_me 跟隨了 redirect" % code)
            check(STATE["requests"][0]["authorization"] == "Bearer " + FAKE_KEY,
                  "%s: /me 首請求未帶 Bearer" % code)
            check(STATE["requests"][0]["port"] == civitai_port, "請求到了錯誤的 Host")
    finally:
        STATE["redirect_to"] = ""
        target.shutdown()
        target.server_close()


def t_anonymous_redirect_unchanged():
    reset()
    target = serve(MockCivitai)
    target_port = target.server_address[1]
    try:
        STATE["redirect_to"] = "http://127.0.0.1:%d/api/v1/models" % target_port
        STATE["redirect_code"] = 302
        clear_reqs()
        items, nxt, code, retry = server.civitai_search("x")
        check(code == "", "匿名搜尋在 redirect 後失敗：" + str(code))
        check(len(STATE["requests"]) == 2, "匿名搜尋未跟隨原有 redirect")
        check(STATE["requests"][-1]["port"] == target_port, "匿名 redirect 目標不正確")
        check(STATE["requests"][-1]["authorization"] is None, "匿名 redirect 帶了 Authorization")
    finally:
        STATE["redirect_to"] = ""
        target.shutdown()
        target.server_close()


tests = [
    ("DPAPI 加解密 round-trip", t_dpapi_roundtrip),
    ("保存／狀態／移除，密文檔不含明文", t_save_status_remove),
    ("空值／格式／保存失敗不回報成功", t_validation_and_save_failure),
    ("解密失敗不當機且提示重新輸入", t_decrypt_failure_no_crash),
    ("Origin 與 X-SimpleUI 驗證", t_origin_guard),
    ("Body 超限與無效 JSON", t_body_limit),
    ("/me 200/401/403/429/5xx/網路失敗與欄位白名單", t_me_modes),
    ("公開搜尋與 Checkpoint 查詢維持匿名", t_search_stays_anonymous),
    ("Bearer 只送正式 host，mock 永不收真 Key", t_auth_host_guard),
    ("_civitai_auth_allowed URL 嚴格驗證（scheme/host/空 Port/非數字 Port/帳密）", t_auth_allowed_urls),
    ("301/302/303/307/308 跨 Host Redirect 封鎖，第二 Host 收不到 Bearer", t_redirect_blocked),
    ("匿名公開搜尋的 Redirect 行為不變", t_anonymous_redirect_unchanged),
]
for name, fn in tests:
    test(name, fn)

app.shutdown()
app.server_close()
civitai.shutdown()
civitai.server_close()
TMP.cleanup()
print("%d tests passed" % passed)
