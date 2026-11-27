# Civitai Personal API Key — 階段 A 安全修正 R1（Bearer Redirect 洩漏）

> 本輪只修正 ChatGPT 獨立審查發現的 Bearer Redirect 洩漏風險與 host 驗證不足。
> **沒有開始階段 B、沒有模型下載、沒有 Download Worker、沒有 CDN allowlist、沒有 OAuth、沒有改動公開搜尋或既有快取。**
> 既有 tracked／untracked 修改全部保留，階段 A 原始報告未被覆蓋。

---

## 1. 開始時 Repository／Branch／HEAD／Remote／Git Status

| 項目 | 值 |
|---|---|
| Repository 根目錄 | `C:/ComfyUI/simple_ui` |
| Branch | `main...origin/main [ahead 1]`（ahead/behind `1/0`） |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 同） |
| tracked modified | **12** |
| untracked | **26**（含 `lora-personal-api-key-audit.md` 與 `lora-personal-api-key-phase-a.md`） |
| staged | 0 |

目標報告 `devtools/reports/lora-personal-api-key-phase-a-r1.md` 開始時不存在，無覆蓋衝突。

已讀取上層與 Repo 的 `AGENTS.md`、`lora-personal-api-key-audit.md`、`lora-personal-api-key-phase-a.md`、`server.py`、`devtools/lora_personal_key_test.py`，並重新以目前磁碟內容確認行號。

---

## 2. 原始 Redirect 洩漏問題及根因

`_civitai_get(auth=True)`（`server.py:736`）與 `_civitai_me(key)`（`server.py:778`）都使用 `urllib.request.urlopen()`。

Python 標準庫 `HTTPRedirectHandler.redirect_request()` 在建立重新導向請求時，只移除 `content-length` 與 `content-type`，其餘 header 全部複製到新請求：

```python
CONTENT_HEADERS = ("content-length", "content-type")
newheaders = {k: v for k, v in req.headers.items()
              if k.lower() not in CONTENT_HEADERS}
```

因此 301／302／303／307／308 跨 Host 時，`Authorization: Bearer <key>` 會被送到重新導向的目標（例如 CDN）。個人 API Key 是 full-scope 高權限憑證，這等同把 Key 交給第三方 Host。

另外，原 `_civitai_auth_allowed()` 只檢查 scheme 與 hostname，未排除：

- `http://civitai.com/api/v1`（非 HTTPS）
- `https://civitai.com:8443/api/v1`（非標準 Port）
- `https://user:pass@civitai.com/api/v1`（URL 帳密）
- `https://sub.civitai.com/api/v1`（子網域原本會被 `_CIVITAI_AUTH_HOSTS` 拒絕，但防護不完整）

而 `CIVITAI_API` 可透過環境變數覆寫，使上述風險實際可被觸發。

---

## 3. 實際修正的程式碼位置

全部修改集中在 `server.py`（本輪未改 `app.js`、`index.html`、`app.css`）：

| 行號 | 修正 |
|---|---|
| `285–305` | `_civitai_auth_allowed()` 強化：scheme 必為 `https`、hostname 精確等於 `civitai.com`、`parts.port` 必須 `None` 或 `443`、`username`/`password` 不存在、任何解析例外回 `False` |
| `719–734` | 新增 `_NoRedirectHandler(urllib.request.HTTPRedirectHandler)`，`redirect_request()` 一律回 `None`；新增 `_open_without_redirect(req, timeout)` 用 `build_opener(_NoRedirectHandler())` |
| `736–776` | `_civitai_get()`：`bearer = auth and _civitai_auth_allowed()`；帶 Bearer 時改用 `_open_without_redirect()`；3xx 回 `("REDIRECT_BLOCKED")`；匿名仍走原 `urllib.request.urlopen()`，**行為完全不變** |
| `778–802` | `_civitai_me()`：改用 `_open_without_redirect()`；3xx 回 `REDIRECT_BLOCKED`；不讀／不回顯 HTTPError body |
| `804–832` | `_civitai_key_error()` 新增 `REDIRECT_BLOCKED → 502 / CIVITAI_REDIRECT_BLOCKED` 白話訊息 |
| `1856–1872` | `_civitai_error()` 同步新增 `REDIRECT_BLOCKED` 映射（供未來 `auth=True` 呼叫使用） |
| `devtools/lora_personal_key_test.py` | mock 加入 301/302/303/307/308 redirect 模式、第二個 mock Host、記錄 `Host`/port；新增 3 項測試；`reset()` 清 `_civitai_cache` |

`_NoRedirectHandler.redirect_request()` 回 `None` 時，`HTTPRedirectHandler.http_error_30x()` 不產生新請求，錯誤鏈最終由 `HTTPDefaultErrorHandler` 拋出 `HTTPError`，呼叫端再轉成 `REDIRECT_BLOCKED`。本機另行以 302 驗證過：只收到一次 HTTPError，沒有第二次請求。

---

## 4. Redirect 防護策略及安全界限

- **最保守策略**：帶 Bearer 的請求完全不自動跟隨重新導向；收到任何 3xx 直接安全失敗，並以白話中文提示「已基於安全停止處理」。
- 不實作 CDN allowlist、不實作下載 redirect；那是階段 B 範圍。
- 不把 Bearer 改放 Query String；仍只用 `Authorization` header。
- 錯誤訊息、日誌、前端回應都不含 Key：`REDIRECT_BLOCKED` 是固定字串，`_civitai_key_error()` 不回顯 header／body／exception。
- **匿名公開搜尋完全不受影響**：`auth=False` 時仍用原本的 `urlopen()`，原有重新導向行為與 `_civitai_cache` 策略未改。
- host guard 的三層條件（HTTPS／精確 host／預設 port／無 URL 帳密）與 no-redirect 是**獨立兩層防護**：即使 host guard 被測試暫時放行，redirect 防護仍有效（已分別測試）。

安全界限（未解決）：此策略只適用這兩個函式；未來任何新增的帶憑證外部請求都必須沿用 `_open_without_redirect()`，否则會重新引入相同風險。不要在階段 B 為下載「順手」改回預設 redirect handler。

---

## 5. 新增測試與實際結果

### 5.1 實際執行（全部隔離，本機隨機 port、假 Key、臨時資料夾）

| 測試指令 | 結果 |
|---|---|
| `python devtools/lora_personal_key_test.py` | **12 tests passed**（原 9 + 新增 3） |
| `python devtools/lora_explorer_api_test.py` | **35 tests passed** |
| `node devtools/lora_explorer_core_test.mjs` | **21 tests passed** |
| `node devtools/lora_personal_key_ui_test.mjs` | **13 checks passed** |
| `node --check app.js` | OK |
| Python `compile()`（`server.py`、`lora_personal_key_test.py`） | OK |
| `git diff --check` | OK |

### 5.2 新增測試項目（全部 PASS）

1. `_civitai_auth_allowed()`：HTTPS 正式 host 與 `:443` 允許；HTTP、`:8443`、`user:pass@`、子網域、其他 host、無效字串全部拒絕。
2. `_civitai_get(auth=True)` 遇到 301／302／303／307／308：回 `REDIRECT_BLOCKED`；第二個 Host 收到 **0** 個請求；首請求仍帶 `Bearer TEST-KEY...`。
3. `_civitai_me()` 遇到 301／302／303／307／308：同上，第二 Host 無請求、無 Authorization。
4. 匿名搜尋遇 302 仍跟隨原本 redirect，目標 Host 收到請求且 **沒有** Authorization。
5. 原有階段 A 9 項（DPAPI round-trip、密文非明文、保存失敗、移除、解密失敗、Origin/X-SimpleUI、Body 限制、`/me` 各狀態與欄位白名單、公開搜尋匿名、host guard）全部通過。

> 測試中為獨立驗證 redirect 防護，短暫 monkeypatch `_civitai_auth_allowed = lambda: True`，並在 `finally` 還原；正式程式碼未改變，且全程只用假 Key 與本機 mock，未呼叫真實 Civitai。

---

## 6. 未執行測試及原因

| 未執行 | 原因 |
|---|---|
| `python -m py_compile server.py` | 會寫 `__pycache__`；改用 `compile()` 做同等等效語法檢查 |
| `node devtools/lora_ui_test.mjs`（headless Chrome 端對端） | 需另外啟動隔離 7861／18188／18189 與 Chrome；本輪為唯讀等級的低風險安全修正，已用原始碼檢查加 API mock 覆蓋 |
| 真實 `https://civitai.com/api/v1/me`／真實 redirect 探測 | 需真實 API Key，明確禁止 |
| 模型下載／`/api/download` 測試 | 階段 B 範圍，明確禁止 |
| 對正式 7860／8188 發 request | 不得干預正式服務 |

---

## 7. Git 最終狀態

- Branch：`main...origin/main [ahead 1]`；HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`；ahead/behind `1/0`；Remote 不變
- tracked modified：**12**（與開始時相同，本輪只修改原本已 modified 的 `server.py` 與 untracked 測試檔）
- untracked：**27**（原有 26 + 本報告）
- staged：0
- 未執行 add／commit／push／checkout／reset／restore／stash／clean；未清理任何既有修改

---

## 8. 正式服務是否受到影響

**沒有。** 7860（PID 13424）與 8188（PID 12196）仍在原本行程上監聽，未停止、未重啟、未修改設定、未輸入真實 Key、未呼叫真實 Civitai、未下載模型。所有測試在隨機 port 與 `tempfile.TemporaryDirectory()` 中進行並於結束時清理。

---

## 9. 尚未解決的風險

1. **策略偏保守**：官方 `/me` 若因維運短暫回 3xx，Key 測試會直接顯示「已基於安全停止處理」，而非成功；這是刻意取捨。
2. **未來新增端點的紀律**：任何新的帶 Bearer 請求都必須使用 `_open_without_redirect()`；目前沒有自動化檢查可防止後人改回 `urlopen()`。
3. **`CIVITAI_ME_URL` 仍為可覆蓋模組變數**：正式值固定官方端點，但測試可覆蓋；需確保正式部署不透過任何設定改它（目前沒有 env 讀取）。
4. **host guard 只擋 `CIVITAI_API`**：`_civitai_me()` 的目標是 `CIVITAI_ME_URL`，並未再走 `_civitai_auth_allowed()`；其安全性依賴「正式值固定官方端點」這個前提。
5. **無 download redirect 功能**：階段 B 若需要跟隨 CDN redirect，必須重新設計「跨 host 剝離 Authorization」的安全流程，不可直接複用本輪的 no-redirect 策略而不重新評估。
6. **full-scope Key 與 DPAPI 界限**仍如階段 A 報告所述，未改善。

---

## 10. 需要 ChatGPT 再次審查的項目

1. `server.py:719–734`：`build_opener(_NoRedirectHandler())` 是否在所有 3xx（含 308）都保證不產生第二次請求；`HTTPError` 是否被正確拋出而非靜默回 `None`。
2. `server.py:285–305`：`parts.port` 對 `https://civitai.com:/path`、`https://civitai.com:0443/`、IPv6 形式等邊界是否都安全拒絕。
3. `server.py:736–776`：`bearer` 判定與匿名路徑是否真的完全分離；匿名 redirect 是否完全未被影響。
4. `server.py:778–802`：`_civitai_me()` 完全不檢查 `_civitai_auth_allowed()` 是否可接受；在正式固定 URL 前提下是否仍符合安全預期。
5. `devtools/lora_personal_key_test.py`：redirect 測試中 monkeypatch host guard 是否可能掩蓋真實 host guard 失效；第二 Host 的請求計數是否可靠。
6. 是否在階段 B 之前需要把 `_open_without_redirect()` 提升到共用工具，並加 static test 防止新增Bearer 呼叫誤用 `urlopen()`。

---

## 11. 完成陳述

R1 安全修正完成並停止。**沒有開始階段 B**，沒有任何下載相關程式碼，沒有 Git 寫入，沒有清理既有工作區修改，正式服務未受影響。
