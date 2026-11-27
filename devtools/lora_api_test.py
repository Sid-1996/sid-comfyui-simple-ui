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


# ── 單一 Civitai 版本公開 trainedWords（匿名）──────────────────
class MockCivitai(http.server.BaseHTTPRequestHandler):
    response = {}
    code = 200

    def log_message(self, *args):
        pass

    def _json(self, code, obj, retry=False):
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        if retry:
            self.send_header("Retry-After", "7")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.code != 200:
            return self._json(self.code, {"error": "test"}, self.code == 429)
        return self._json(200, self.response)


mockcv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), MockCivitai)
threading.Thread(target=mockcv.serve_forever, daemon=True).start()
cv_base = "http://127.0.0.1:%d" % mockcv.server_address[1]
_original_cv = server.CIVITAI_API
server.CIVITAI_API = cv_base


def _reset_cv(response, code=200):
    server._civitai_cache.clear()
    MockCivitai.response = {"modelId": 9, "name": "Mock", "baseModel": "Illustrious",
                            "trainedWords": response}
    MockCivitai.code = code


def t_cv_ok():
    _reset_cv(["amora,  blonde hair,, long_hair", "cleavage, black dress"])
    st, body = get("/api/civitai/version?id=3276795")
    check(st == 200 and body.get("ok") is True, "%r %r" % (st, body))
    v = body["version"]
    check(v["groups"] == [["amora", "blonde hair", "long_hair"],
                          ["cleavage", "black dress"]], "群組解析：%r" % (v["groups"],))
    check(v["id"] == 3276795, v)
    check(bool(v["fingerprint"]) and v["fetchedAt"] > 0, "fingerprint/fetchedAt：%r" % (v,))
    check(v["warning"] == "", v)


def t_cv_empty():
    _reset_cv([])
    st, body = get("/api/civitai/version?id=3276796")
    check(st == 200 and body["version"]["groups"] == [], "%r %r" % (st, body))
    check(body["version"]["warning"] == "", body)


def t_cv_nonarray():
    _reset_cv("miku, miku")
    st, body = get("/api/civitai/version?id=3276797")
    check(st == 200 and body["version"]["groups"] == [], "%r %r" % (st, body))
    check("不是陣列" in body["version"]["warning"], body)


def t_cv_bad_elements():
    _reset_cv([123, None, "", "   ", "a,, b ,a", {"x": 1}])
    st, body = get("/api/civitai/version?id=3276798")
    check(st == 200, "%r %r" % (st, body))
    check(body["version"]["groups"] == [["a", "b"]], body["version"]["groups"])


def t_cv_429():
    _reset_cv([], code=429)
    st, body = get("/api/civitai/version?id=3276799")
    check(st == 429 and body["code"] == "CIVITAI_RATE_LIMITED", "%r %r" % (st, body))
    check(body.get("retryAfter") == "7", body)


def t_cv_404():
    _reset_cv([], code=404)
    st, body = get("/api/civitai/version?id=3276800")
    check(st == 404 and body["code"] == "CIVITAI_VERSION_NOT_FOUND", "%r %r" % (st, body))


def t_cv_offline():
    _reset_cv([])
    server.CIVITAI_API = "http://127.0.0.1:%d" % free_port()
    try:
        st, body = get("/api/civitai/version?id=3276801")
        check(st == 503 and body["code"] == "CIVITAI_OFFLINE", "%r %r" % (st, body))
    finally:
        server.CIVITAI_API = cv_base


def t_cv_bad_id():
    st, body = get("/api/civitai/version?id=abc")
    check(st == 400 and body["code"] == "BAD_VERSION_ID", "%r %r" % (st, body))
    st, body = get("/api/civitai/version")
    check(st == 400, "%r %r" % (st, body))


# ── R3：後端版本 metadata 快取寫入競態（世代保護）───────────────
# 透過真實 HTTP endpoint /api/civitai/version 驗證，並把 upstream
# server._civitai_get 換成可控制時序的假函式，不依賴真實網路或睡眠猜測。


def _cv_r3_reset(vid):
    server._civitai_cache.pop("version|%d" % vid, None)
    server._civitai_gen.pop(vid, None)


def _cv_r3_patch(sequences):
    """sequences: per upstream call, (block_event, release_event, response)。
    response 為 _civitai_get 的回傳 (obj, code, retry)。
    每次呼叫先（可選）等待 block_event，再（可選）觸發 release_event，最後回傳 response。
    """
    calls = {"n": 0}
    lock = threading.Lock()
    orig = server._civitai_get

    def fake_get(path, timeout=server.CIVITAI_TIMEOUT, auth=False):
        with lock:
            i = calls["n"]
            calls["n"] += 1
        block, release, resp = sequences[i]
        if release is not None:
            release.set()        # 先通知測試：此呼叫已達上游阻塞點
        if block is not None:
            block.wait()         # 再阻塞上游（若有）
        return resp

    server._civitai_get = fake_get
    return orig


def _cv_r3_unpatch(orig):
    server._civitai_get = orig


def t_r3_old_late_not_overwrite():
    # R3-1：舊請求 A 先開始但上游暫停；新請求 B 先完成並寫入快取；
    # A 晚到時不得覆蓋 B 已寫入的快取。
    vid = 990301
    _cv_r3_reset(vid)
    old_data = {"modelId": 9, "name": "Old", "baseModel": "Illustrious",
                "trainedWords": ["old word"]}
    new_data = {"modelId": 9, "name": "New", "baseModel": "Illustrious",
                "trainedWords": ["new word"]}
    a_block = threading.Event()      # A 等待上游（測試稍後釋放）
    a_reached = threading.Event()    # A 已進入上游等待
    sequences = [
        (a_block, a_reached, (old_data, "", None)),   # call 0 = A（暫停）
        (None, None, (new_data, "", None)),           # call 1 = B（立即回傳）
    ]
    orig = _cv_r3_patch(sequences)
    result = {}
    ta_done = False

    def call_a():
        nonlocal ta_done
        try:
            st, body = get("/api/civitai/version?id=%d" % vid)
            result["a"] = (st, body)
        except Exception as exc:  # pragma: no cover
            result["a"] = ("EXC", repr(exc))
        finally:
            ta_done = True

    ta = threading.Thread(target=call_a)
    ta.start()
    try:
        check(a_reached.wait(timeout=10), "R3-1 A 應進入上游等待：%r" % result.get("a"))

        # B：快取未命中，上游立即回傳新資料並寫入快取
        st_b, body_b = get("/api/civitai/version?id=%d" % vid)
        check(st_b == 200 and body_b.get("ok") is True, "R3-1 B 失敗：%r %r" % (st_b, body_b))
        check(body_b["version"]["groups"] == [["new word"]],
              "R3-1 B 應回傳新資料：%r" % (body_b,))
        hit = server._cache_get("version|%d" % vid)
        check(hit is not None and hit["groups"] == [["new word"]],
              "R3-1 快取應保留 B：%r" % (hit,))

        # 釋放 A（舊資料晚到）→ 世代守衛擋下，不得覆寫快取
        a_block.set()
        ta.join(timeout=10)
        check(ta_done and not ta.is_alive(), "R3-1 A 執行緒應完成")
        st_a, body_a = result["a"]
        check(st_a == 200 and body_a.get("ok") is True,
              "R3-1 A 本身應仍成功：%r %r" % (st_a, body_a))

        # 再次呼叫：必須仍回傳 B 的新資料，而非 A 的舊資料
        st_c, body_c = get("/api/civitai/version?id=%d" % vid)
        check(st_c == 200 and body_c.get("ok") is True, "R3-1 C 失敗：%r %r" % (st_c, body_c))
        check(body_c["version"]["groups"] == [["new word"]],
              "R3-1 A 晚到不得覆蓋 B，應回傳 B 新資料：%r" % (body_c,))
    finally:
        # 無論測試通過或失敗，都必須釋放阻塞中的 A、等待執行緒結束、還原 mock；
        # 並不掩蓋原本的 AssertionError。
        a_block.set()
        ta.join(timeout=5)
        _cv_r3_unpatch(orig)


def t_r3_old_first_new_after():
    # R3-2：舊請求 A 先完成並寫入快取；清除快取後，新請求 B 仍能發出新的
    # upstream fetch，取得更新後的資料 B，並寫入快取（真正的後續更新）。
    vid = 990302
    _cv_r3_reset(vid)
    data_a = {"modelId": 9, "name": "A", "baseModel": "Illustrious",
              "trainedWords": ["a word"]}
    data_b = {"modelId": 9, "name": "B", "baseModel": "Illustrious",
              "trainedWords": ["b word"]}

    orig = server._civitai_get
    calls = {"n": 0}
    lock = threading.Lock()

    def fake_get(path, timeout=server.CIVITAI_TIMEOUT, auth=False):
        with lock:
            i = calls["n"]
            calls["n"] += 1
        if "/model-versions/%d" % vid in path:
            # 第 0 次（A）回傳資料 A；第 1 次（B）回傳更新後的資料 B
            return (data_a, "", None) if i == 0 else (data_b, "", None)
        return (None, "UNREACHABLE", None)

    server._civitai_get = fake_get
    try:
        # A 完成並寫入快取
        st_a, body_a = get("/api/civitai/version?id=%d" % vid)
        check(st_a == 200 and body_a.get("ok") is True, "R3-2 A 失敗：%r %r" % (st_a, body_a))
        check(body_a["version"]["groups"] == [["a word"]],
              "R3-2 A 應回傳資料 A：%r" % (body_a,))

        # 明確清除該 Version ID 的測試快取，迫使後續請求發出 upstream fetch
        server._civitai_cache.pop("version|%d" % vid, None)

        # B 在後開始：快取已失效，確實發出新的 upstream fetch 並取得資料 B
        st_b, body_b = get("/api/civitai/version?id=%d" % vid)
        check(st_b == 200 and body_b.get("ok") is True, "R3-2 B 失敗：%r %r" % (st_b, body_b))
        check(body_b["version"]["groups"] == [["b word"]],
              "R3-2 B 應回傳更新後的資料 B：%r" % (body_b,))

        # 快取內容已更新為資料 B
        hit = server._cache_get("version|%d" % vid)
        check(hit is not None and hit["groups"] == [["b word"]],
              "R3-2 快取應更新為 B：%r" % (hit,))
    finally:
        server._civitai_get = orig


def t_r3_old_failure_not_poison():
    # R3-3：新請求 B 成功寫入快取後，舊請求 A 最後失敗，
    # 不得清除或破壞新快取。
    vid = 990303
    _cv_r3_reset(vid)
    new_data = {"modelId": 9, "name": "New", "baseModel": "Illustrious",
                "trainedWords": ["new word"]}
    a_block = threading.Event()
    a_reached = threading.Event()
    sequences = [
        (a_block, a_reached, (None, "UNREACHABLE", None)),   # call 0 = A（最後失敗）
        (None, None, (new_data, "", None)),                  # call 1 = B（成功寫入）
    ]
    orig = _cv_r3_patch(sequences)
    result = {}
    ta_done = False

    def call_a():
        nonlocal ta_done
        try:
            st, body = get("/api/civitai/version?id=%d" % vid)
            result["a"] = (st, body)
        except Exception as exc:  # pragma: no cover
            result["a"] = ("EXC", repr(exc))
        finally:
            ta_done = True

    ta = threading.Thread(target=call_a)
    ta.start()
    try:
        check(a_reached.wait(timeout=10), "R3-3 A 應進入上游等待")

        # B 在後開始、先完成：新資料寫入快取
        st_b, body_b = get("/api/civitai/version?id=%d" % vid)
        check(st_b == 200 and body_b.get("ok") is True, "R3-3 B 失敗：%r %r" % (st_b, body_b))
        check(body_b["version"]["groups"] == [["new word"]], "R3-3 B 應回傳新資料：%r" % (body_b,))
        hit = server._cache_get("version|%d" % vid)
        check(hit is not None and hit["groups"] == [["new word"]],
              "R3-3 快取應持有 B：%r" % (hit,))

        # 釋放 A：失敗提早返回，不寫入快取，快取不得被清除
        a_block.set()
        ta.join(timeout=10)
        check(ta_done and not ta.is_alive(), "R3-3 A 執行緒應完成")
        st_a, body_a = result["a"]
        check(st_a != 200, "R3-3 A 應失敗：%r %r" % (st_a, body_a))

        # 再次呼叫：仍回傳 B 的新資料，未被 A 的失敗污染
        st_c, body_c = get("/api/civitai/version?id=%d" % vid)
        check(st_c == 200 and body_c.get("ok") is True, "R3-3 C 失敗：%r %r" % (st_c, body_c))
        check(body_c["version"]["groups"] == [["new word"]],
              "R3-3 A 失敗不得污染 B，應回傳新資料：%r" % (body_c,))
    finally:
        # 無論測試通過或失敗，都必須釋放阻塞中的 A、等待執行緒結束、還原 mock；
        # 並不掩蓋原本的 AssertionError。
        a_block.set()
        ta.join(timeout=5)
        _cv_r3_unpatch(orig)


def t_r3_different_versions_independent():
    # R3-4：不同 Version ID 同時請求，保證兩個 upstream 請求真正重疊，
    # 世代不互相影響，各自取得正確資料（不用睡眠猜測時序）。
    v1, v2 = 990304, 990305
    _cv_r3_reset(v1)
    _cv_r3_reset(v2)
    data1 = {"modelId": 9, "name": "V1", "baseModel": "Illustrious",
             "trainedWords": ["v1 word"]}
    data2 = {"modelId": 9, "name": "V2", "baseModel": "Illustrious",
             "trainedWords": ["v2 word"]}

    # Barrier：兩個 upstream 請求都必須先進入，才允許一起回應（決定性重疊）
    barrier = threading.Barrier(2, timeout=10)
    arrived = {"n": 0}
    lock = threading.Lock()
    orig = server._civitai_get

    def fake_get(path, timeout=server.CIVITAI_TIMEOUT, auth=False):
        with lock:
            arrived["n"] += 1
        barrier.wait()                     # 兩端都到達後，才一起回應（真正重疊）
        if "/model-versions/%d" % v1 in path:
            return (data1, "", None)
        if "/model-versions/%d" % v2 in path:
            return (data2, "", None)
        return (None, "UNREACHABLE", None)

    server._civitai_get = fake_get
    results = {}
    errors = {}

    def fetch(v):
        try:
            results[v] = get("/api/civitai/version?id=%d" % v)
        except Exception as exc:  # pragma: no cover
            errors[v] = repr(exc)

    t1 = threading.Thread(target=fetch, args=(v1,))
    t2 = threading.Thread(target=fetch, args=(v2,))
    t1.start()
    t2.start()
    try:
        t1.join(timeout=15)
        t2.join(timeout=15)
        check(not t1.is_alive() and not t2.is_alive(), "R3-4 兩個請求應都完成")
        check(v1 not in errors and v2 not in errors, "R3-4 無例外：%r" % (errors,))
        st1, body1 = results[v1]
        st2, body2 = results[v2]
        check(st1 == 200 and body1.get("ok") is True, "R3-4 v1 失敗：%r %r" % (st1, body1))
        check(st2 == 200 and body2.get("ok") is True, "R3-4 v2 失敗：%r %r" % (st2, body2))
        check(body1["version"]["groups"] == [["v1 word"]],
              "R3-4 v1 應回傳自己的資料：%r" % (body1,))
        check(body2["version"]["groups"] == [["v2 word"]],
              "R3-4 v2 應回傳自己的資料：%r" % (body2,))
        # 兩個 Version ID 的快取互不污染
        h1 = server._cache_get("version|%d" % v1)
        h2 = server._cache_get("version|%d" % v2)
        check(h1 is not None and h1["groups"] == [["v1 word"]],
              "R3-4 v1 快取正確：%r" % (h1,))
        check(h2 is not None and h2["groups"] == [["v2 word"]],
              "R3-4 v2 快取正確：%r" % (h2,))
    finally:
        server._civitai_get = orig


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
test("Civitai 版本：匿名取得且正確拆分兩組 trainedWords", t_cv_ok)
test("Civitai 版本：空陣列是正常狀態", t_cv_empty)
test("Civitai 版本：trainedWords 非陣列時安全降級", t_cv_nonarray)
test("Civitai 版本：元素型別錯誤、雙逗號與重複詞", t_cv_bad_elements)
test("Civitai 版本：429 回 rate limit 與 Retry-After", t_cv_429)
test("Civitai 版本：404 回版本不存在", t_cv_404)
test("Civitai 版本：網路失敗回 503，不影響既有設定", t_cv_offline)
test("Civitai 版本：版本 ID 格式錯誤回 400", t_cv_bad_id)
test("R3-1：舊請求晚到不得覆蓋新快取", t_r3_old_late_not_overwrite)
test("R3-2：舊請求先完成後，新請求仍可正確取得資料", t_r3_old_first_new_after)
test("R3-3：舊請求失敗不得污染新快取", t_r3_old_failure_not_poison)
test("R3-4：不同 Version ID 同時請求互不干擾", t_r3_different_versions_independent)

app.shutdown()
app.server_close()
mock.shutdown()
mock.server_close()
server.CIVITAI_API = _original_cv
mockcv.shutdown()
mockcv.server_close()
print("%d tests passed" % passed)
