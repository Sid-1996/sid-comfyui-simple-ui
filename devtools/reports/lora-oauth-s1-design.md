# S1 — Civitai OAuth 登入方案調查與設計（唯讀任務）

## 1. 任務目標及調查範圍

為 LoRA 探索中心設計 Civitai 登入授權方案，重點比較 **Authorization Code + PKCE** 與 **Device Authorization Flow**，並評估 Windows 本機應用的 Token 安全保存、UX 流程，以及與後續 S2 模型下載的銜接。

**本輪只調查與設計，不實作、不修改任何專案檔案。**

證據標記：【官方文件記載】= Civitai 官方文件或線上使用說明；【已驗證事實】= 本輪讀碼或直接 GET 驗證；【合理推論】= 由事實推導；【尚待確認】= 官方無明確說明，不可當成可用能力。

---

## 2. Repo 原始 Branch、HEAD、工作區狀態（含時間點區分）

路徑 `C:\ComfyUI\simple_ui`。Branch / HEAD / Remote 在各時間點皆相同：

| 項目 | 值 |
|---|---|
| branch | `main...origin/main [ahead 1]`（ahead/behind `1/0`） |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| tracked modified | **11**（各時間点皆相同） |
| staged | **0**（各時間点皆相同） |
| `git diff --check` | 無輸出 |

**untracked 數量隨時間點變化，不可混為同一時點**：

| 時間點 | untracked | 說明 |
|---|---:|---|
| S1 原始調查開始前 | **21** | 既有 reports 與測試工具，含 S0 報告、真實情境審計報告等；本報告尚未建立 |
| S1 報告建立後 | **22** | 新增本報告 `devtools/reports/lora-oauth-s1-design.md` |
| S1-R1 補正後 | **22** | 只修改本報告內容，沒有新增其他檔案 |
| **S1-R2 目前實際狀態** | **22** | 与本轮 Preflight 重新清點一致；既有 11 個 tracked modified 與其他 untracked 完全未動 |

既有 modified 包含：

- S0 圖片預覽成果：`server.py`、`app.js`、`app.css`（css 為 Phase 2 既存）、`devtools/lora_explorer_api_test.py`、`devtools/lora_explorer_core_test.mjs`、`devtools/lora_mock_civitai.py`、`devtools/lora_ui_test.mjs`。
- 其他任務既有修改：`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`、`devtools/test_ui_control_wd14.ps1`。

本輪沒有使用 `git reset/restore/stash/checkout/clean`，沒有修改上述任何檔案，沒有 stage / commit / push。

---

## 3. 現有程式架構調查結果

### 3.1 後端（`server.py`）

【已驗證事實】

- 只有**標準庫** HTTP server：`class S(socketserver.ThreadingMixIn, http.server.HTTPServer)`，`allow_reuse_address=True`，路由集中在 `H.do_GET()` / `H.do_POST()`（`~1405` / `~1428`）。
- 路由：`/ws`（WS 隧道）、`/comfy/*`（透明代理）、`/api/status`、`/api/loras`、`/api/lora-meta`、`/api/civitai/status`、`/api/civitai/search`、`/api/check`、`/api/delete`、`/api/reverse`、`/api/output-dir` 等；**沒有任何 OAuth／登入／Token 路由**。
- Civitai 模組（`server.py:484–545`）：
  - `CIVITAI_API = os.environ.get("CIVITAI_API", "https://civitai.com/api/v1")`。
  - 檔案註明「公開端點不需要 Token；本模組也不接受、不保存任何 Token」。
  - `_civitai_get()` 只送 `Accept` 與 `User-Agent`，**沒有 Authorization header**；所有搜尋都是匿名。
  - `_civitai_cache` + lock，TTL 300 秒、上限 300 筆。
- 使用者資料目錄：`_user_data_dir()` → `%LOCALAPPDATA%\SidSimpleUI`（或 `%APPDATA%`，退化到 temp）。已用於 `output_dir.txt`、logs、WD14 暫存；**沒有憑證儲存機制**。
- 沒有背景任務管理器；只有 WD14 Worker subprocess 與 `_purge_loop` daemon thread。
- `/api/loras` 是向 ComfyUI 原生 `/models/loras` 查詢（`server.py:405–414, 1499–1511`），不是直接掃資料夾。

### 3.2 前端（`app.js` / `index.html`）

【已驗證事實】

- 探索中心入口：`index.html:197` 的 `#btnLoraExplore` → `app.js:cvOpenModal()`（`~1972`）。
- 彈窗：`index.html:359–397` 的 `#exploreModal`，含標題、`#cvCkptInfo`、搜尋列、`#cvNsfw`、`#cvResults`、`#cvMore`；**目前沒有任何登入入口或帳號狀態顯示**。
- `S.civitai`（`app.js:36–41`）保存 ckpt／query／sort／period／nsfw／items／cursor／state／error 與 AbortController，**全部是記憶體狀態**；`PV` 也註明「不進 localStorage」。
- 所有 Civitai 請求都打同源 `/api/civitai/status`、`/api/civitai/search`；前端從不直接連 Civitai。
- localStorage 既有 keys：`sel`、`combos`、`adult`、`showEn`、`ui.settings`、`ui.gallery`、`ui.loras`、`ui.extra`、`ui.genLog`、`ui.learnedTags` 等；**OAuth 不應新增長期保存 token 的 key**。

### 3.3 與 S0 的關係

`lora-image-preview-s0.md` 已修正圖片安全判斷，`publicSafe` 由 `nsfw=false` 搜尋過濾決定。OAuth 若要改變搜尋行為（例如 `favorites`、較高 browsing level），必須沿用該判斷，不可把登入後的圖片直接視為安全而繞過 `cvImageSafety()`。

---

## 4. 官方文件及來源連結

| 主題 | 來源 |
|---|---|
| OAuth 總覽、Token 生命週期 | https://developer.civitai.com/site/oauth.md |
| Authorization Code + PKCE 快速上手 | https://developer.civitai.com/site/oauth/quickstart.md |
| OAuth 端點（authorize/token/revoke/userinfo）、Device Flow 限制 | https://developer.civitai.com/site/oauth/endpoints.md |
| Scope bitmask 對照 | https://developer.civitai.com/site/oauth/scopes.md |
| 註冊 OAuth App、public/confidential client、redirect URI | https://developer.civitai.com/site/oauth/register-app.md |
| Bearer token 用法、Public/Mixed/Authenticated 分類 | https://developer.civitai.com/site/guide/authentication.md |
| CLI 使用 OAuth device flow 與個人 API Key | https://developer.civitai.com/site/guide/cli-auth.md |
| CLI 下載需登入、gated 401 | https://developer.civitai.com/site/guide/cli.md |
| Models API 參數與欄位（`nsfw`、`earlyAccess`、`availability`） | https://developer.civitai.com/site/reference/models.md |
| Errors / 429 / Retry-After | https://developer.civitai.com/site/guide/errors.md |
| OIDC discovery（實際 GET） | https://auth.civitai.com/.well-known/openid-configuration |

---

## 5. OAuth 流程及 Scope 調查

### 5.1 正式支援的流程（官方文件記載）

- Civitai 是 OAuth 2.0 / OIDC provider，端點在 `https://auth.civitai.com/api/auth/oauth/*`（舊 `civitai.com/api/auth/oauth/*` 會 308 導向）。
- **Authorization Code + PKCE 正式支援且為官方建議**：`response_type=code`、`code_challenge_method` 必須是 `S256`，`plain` 被拒。
- 實際 GET discovery（`https://auth.civitai.com/.well-known/openid-configuration`）回傳：
  - `response_types_supported: ["code"]`
  - `code_challenge_methods_supported: ["S256"]`
  - `grant_types_supported`: `authorization_code`, `refresh_token`, `client_credentials`, `urn:ietf:params:oauth:grant-type:device_code`, `urn:ietf:params:oauth:grant-type:token-exchange`
  - `device_authorization_endpoint`: `https://auth.civitai.com/api/auth/oauth/device`
  - `revocation_endpoint`、`introspection_endpoint`、`scopes_supported`（含 `offline_access`）
- **Device Flow 對本專案不可行**：官方 `endpoints.md` 明確寫「discovery 列出 device_authorization_endpoint，但**你註冊的 client 一開始只有 `authorization_code` 與 `refresh_token` grants，device flow 不對它開放**」。官方 CLI 的 device flow 使用第一方 `civitai-cli` client，不代表第三方 app 可用。
- redirect URI：官方註冊文件說明 **完全逐字比對**；`http://localhost:3000/oauth/callback` 可用於本機開發（localhost 不需 HTTPS）。本專案實際監聽 `127.0.0.1`（見下），`127.0.0.1` 是否可在 Civitai OAuth App 註冊**尚待確認**，必須以實際註冊為準，不可假設等價於 localhost。
- 註冊：Civitai 帳號設定 → OAuth Apps，自我服務建立，無需等待人工審核；`isVerified` 僅影響 consent 畫面信任提示，未驗證也能走完整流程。

#### 5.1.1 本機 callback 連線限制（S1-R1 補充）

【已驗證事實】目前 `server.py` 的啟動方式是：

```python
S(("127.0.0.1", port), H).serve_forever()
```

Server **只監聽 IPv4 `127.0.0.1`**，沒有監聽 `::1`，也沒有監聽所有介面。

【官方文件記載】Civitai 註冊文件提供 `http://localhost:...` 範例，但 redirect URI 必須與註冊值逐字相符。
https://developer.civitai.com/site/oauth/register-app.md

【尚待確認／必須實測】：

1. Civitai 是否接受 `http://127.0.0.1:<port>/oauth/callback` 作為註冊 redirect URI。
2. 若只能註冊 `localhost`，瀏覽器把 `localhost` 解析為 IPv6 `::1` 時，callback **無法連到只聽 IPv4 的 server**；解析為 `127.0.0.1` 時才可以。此行為依瀏覽器／系統 hosts 設定而異，本輪未實測，不可假設。
3. 必須以**實際註冊 + 實際瀏覽器 callback** 驗證兩者是否都能回到本機 server。

最小可行處理方式（僅設計，不在本輪改程式碼）：優先把 server 綁定到同時涵蓋 IPv4/IPv6 的本機位址，或註冊一個與目前綁定位址完全相符的 redirect URI；若兩者皆不可行，再考慮本機轉接。任何做法都需先通過 callback 實測。

#### 5.1.2 Port 限制（S1-R1 補充）

`SIMPLE_UI_PORT` 可設定不同 port（`server.py:2091`），因此 redirect URI 的 port **必須與實際啟動 port 完全一致**。這代表：

- 註冊一個固定 port 的 redirect URI 會與「使用者自訂 port」衝突；
- 若要支援自訂 port，需註冊多个 redirect URI，或限制 OAuth 功能只在註冊的 port 上可用；
- 這一點需在 S1 實作前決定並寫入設定說明，不可假設 port 不影響 callback。

#### 5.1.3 Client 類型選擇（S1-R1 補充）

【官方文件記載】註冊文件說「有後端的 app 通常可選 confidential」，但 Sid-simple-ui 的 `server.py` 是**安裝在使用者自己的 Windows 電腦上**，由使用者本機執行，不是開發者控制的遠端伺服器。

因此：

- **不可**把散布給所有使用者的 `client_secret` 當成秘密；任何內建 secret 都能被使用者或本機其他程式取得。
- **Public Client + PKCE** 是目前更合理的預設（無 client_secret，PKCE 保護授權碼）。
- DPAPI 保護的是**使用者自己的 access/refresh token**，不是 OAuth App 的 client_secret；兩者不可混為一談。
- 只有未來改為集中式遠端服務、secret 真正由開發者控管時，才重新評估 Confidential Client。

### 5.2 Scope（官方文件記載）

- `UserRead`(1)：讀取 profile/settings/email，**每個 token 都強制包含**，`/userinfo` 永遠可用。
- `ModelsRead`(4)：官方定義 **Browse & download models**，是下載場景的核心 scope。
- 最小請求：`UserRead | ModelsRead = 5`。**不需要** `AIServicesWrite`、`BuzzRead` 等會涉及花費的權限。
- `allowedScopes` 是上限；實際 token 的 scope 以 `/token` 回傳的 `scope` 為準。
- 匿名可用：`GET /models`、`GET /model-versions/*`、`GET /images`、`GET /creators`、`GET /tags` 等 Public 端點。
- Mixed：`GET /models` 的 `favorites` / `hidden` 需要 token。
- Authenticated：`GET /me` 無 token 回 401。
- 【尚待確認】Gated / Private / Paid / Early Access 模型：官方 API 有 `earlyAccess` 參數、`availability`/`paidAccess` 欄位，CLI 文件說多數模型檔需要 token、gated 無 token 會 401；但**OAuth 登入不代表可下載所有模型**，帳號本身的訂閱、付款、early access 與開發者授權仍起作用。本輪沒有真實 token 可驗證 third-party OAuth token 對所有受限模型的實際結果。

### 5.3 Token 是否能用於下載（已驗證 + 尚待確認）

- 【官方文件記載】Bearer token 用 `Authorization: Bearer <token>` 傳遞；官方強烈不建議 `?token=`（會進 log／快取）。
- 【官方文件記載】CLI 的 `download` 會自動帶其登入 token（可為 OAuth device flow token），且「most model files need a token」。
- 【合理推論】`ModelsRead` 讓 OAuth token 可用於下載端點 `https://civitai.com/api/download/models/<versionId>`。
- 【尚待確認】第三方註冊 app 的 OAuth access token 是否在所有 gated/paid 情境都等價於 CLI 的第一方 token；需以真實 OAuth app 做小檔驗證（不在本輪範圍）。

---

## 6. Token 生命週期

| 項目 | 官方說法 | 來源 |
|---|---|---|
| access token | 1 小時（`expires_in: 3600`），`civitai_…` 前綴， bearer | oauth.md / quickstart.md |
| refresh token | 官方 oauth.md 寫 30 天；CLI 文件說 lifespan 以 server 回傳為準 | oauth.md / cli-auth.md |
| authorization code | 10 分鐘、單次使用 | oauth.md / endpoints.md |
| refresh rotation | 成功 refresh 後**舊 refresh token 失效**，必須先保存新的 | endpoints.md / quickstart.md |
| `offline_access` | discovery 的 scopes_supported 有此值；quickstart 示範**未請求**仍拿到 refresh token。是否影響 refresh token 發放或期限：**尚待確認** | discovery / quickstart.md |
| introspection | discovery 有 `introspection_endpoint`，但 endpoints.md 未文件化參數與回應：**尚待確認** | discovery / endpoints.md |
| revocation | `POST /api/auth/oauth/revoke` 已文件化；撤銷 refresh token 同時撤銷其簽發的 access tokens；public client 無 session 時不能呼叫，只能本地丟棄 | endpoints.md |
| 使用者端撤銷 | 可在 Civitai「Connected Apps」自行撤回；刪除 OAuth app 會 cascades 撤銷所有 token 與 consent | register-app.md |
| refresh 失效 | 官方 buzz-limits 文件提到 token 被撤銷時 refresh 會回 `invalid_grant`，應引導重新 `/authorize` | buzz-limits.md |

【設計要求】不要沿用未經證實的「30 天」作為程式碼常數；以 token response 的 `expires_in` 與實際錯誤為準。

---

## 7. Windows Token 安全方案比較

| 方案 | 安全性 | 標準庫／現況 | 新增依賴 | 重啟後維持 | 同一 Windows 帳號 | 備份／遷移／清除 | 評價 |
|---|---|---|---|---|---|---|---|
| **Windows DPAPI（CurrentUser）** | 高：加密綁定目前 Windows 使用者與機器 | Python `ctypes` 可呼叫 `crypt32`；或 PowerShell `ProtectedData`；無需第三方 | 無 | 可 | 是；不同帳號無法解開 | 密文檔放在 `%LOCALAPPDATA%\SidSimpleUI\`；清除即刪檔；不適合跨機器漫遊 | **建議** |
| Windows Credential Manager | 高：OS 管理、可見於 credential UI | 需 `ctypes`/PowerShell 呼叫 `advapi32` CredWrite/CredRead，或 `cmdkey`；程式碼較複雜 | 無 | 可 | 是 | 由 Windows 管理；清除走 OS UI/API | 可行但複雜度較高 |
| 明文 JSON 設定檔 | 低：任何同機程序／Git／備份都可能讀到 | 容易 | 無 | 可 | 是 | 易外洩 | **禁止** |
| 僅存在記憶體 | 高：不落盤 | 最簡單 | 無 | **不可**，每次重啟都要重新登入 | 是 | 無需清除 | 不適合產品目標 |

### 建議的最小可靠做法

1. Token 完全由 `server.py` 管理，**永不送到前端 JavaScript**；前端只拿到 `{loggedIn, username, scopes?, expiresAt}`，且 username 也要避免放進 log。
2. 加密保存：把 access/refresh token、scope、expiry 以 DPAPI `CurrentUser` 加密後寫入 `%LOCALAPPDATA%\SidSimpleUI\oauth.json`（哨兵檔，非 Git、非 repo），檔案 ACL 限制目前使用者。
3. `offline_access` 不主動要求（官方 quickstart 未要求也有 refresh token）；若實測需要再加入。
4. 撤銷／登出：本專案預設為 **Public Client**，登出只刪除本機 DPAPI token，不呼叫 `/revoke`（沒有瀏覽器 session 可通過其驗證）。若要撤銷 Civitai 端授權，需引導使用者到 Connected Apps 自行移除。只有未來集中式服務且 secret 真正受控時才重新評估 Confidential Client 與程式化 `/revoke`。
5. 日誌與錯誤：任何含 token 的 URL、header、body、exception 都必須 redact；`?token=` 永不使用。
6. API Key 若做為備選，也只存後端加密欄位，且**不放進前端或 Git**。

【尚待確認】ComfyUI 內嵌 Python 以 `ctypes` 呼叫 DPAPI 的實測、以及企業環境 Credential Manager 原則；建議在 S1 實作前先用隔離程式驗證。

### Callback 與 CSRF（S1-R1／S1-R2 補充）

**選定方案 A：HTML form POST → 後端 302 → Civitai 頂層導向 → Civitai 頂層 GET 回本機 callback。**

不用 `fetch()` 跟隨 302 做為頁面導向：`fetch()` 的 302 只會在該請求內部跟隨，不會把使用者目前頁面導到 Civitai。也不選「POST 回 URL 再由 `location.assign()`」的方案 B，以減少前端持有 authorize URL 的時序與快取問題。

完整流程：

1. 前端探索中心放一個**真正的 HTML `<form method="post" action="/api/civitai/auth/start">`**，由使用者點擊提交。
2. 後端收到 POST，驗證 Origin（只允許目前本機 UI 來源），建立 state + PKCE verifier，設定 HttpOnly cookie。
3. 後端回 **302** 到 `https://auth.civitai.com/api/auth/oauth/authorize?...`；因為這是表單的頂層提交，瀏覽器會真正導向 Civitai。
4. Civitai 完成登入／同意後，以**頂層 GET** 回到本機 `/oauth/callback?code&state`。
5. 後端驗證 state/cookie、單次兌換 code、加密存 token，再 302 回首頁並帶非敏感旗標。

**form POST 的 Origin／Cookie／頂層導向要點**：

- HTML form POST 由瀏覽器送出 `Origin` header（同源表單亦會帶），後端沿用既有 `/api/output-dir` 的同源檢查模式：Origin 不存在或不等於 `http://127.0.0.1:<port>`／實際註冊的 `localhost:<port>` 即拒絕。
- Cookie 必須在 `/api/civitai/auth/start` 的 **302 回應**上設定；頂層表單導向後，Civitai 的跨站回導才會把該 cookie 帶回 callback。
- **Cookie 固定 `SameSite=Lax`，不可改用 `Strict`**：本專案採 OAuth Authorization Code Query Callback，callback 是從 Civitai 跨站導回 localhost 的**頂層 GET**；`Strict` 會讓該 cookie 不被送回，造成 state 比對失敗。
- **保留 `HttpOnly`**。`Secure` 不盲目要求：本機是 `http://localhost`/`http://127.0.0.1` callback，需依實際瀏覽器對 localhost 的 Secure cookie 行為與部署方式決定；若設定 Secure 導致 cookie 不被送回，就不可這樣設。這點需以實際 callback 實測確認。
- **State + PKCE verifier + HttpOnly cookie 三者綁定**：
  - 後端產生 state 與 verifier，verifier 存後端記憶體（以 state 為 key，**短 TTL、單次使用**）。
  - 同一 state 寫入上述 `SameSite=Lax`、HttpOnly cookie，作為瀏覽器綁定資訊。
  - callback 時**不信任 query state 單獨作為依據**：必須同時比對「query state === 後端 pending state === cookie state」，任一不符即拒絕；cookie 缺失即視為偽造 callback。
- **多流程並發**：一次只允許一個 pending flow；新流程開始時作廢舊 state/verifier 並更新 cookie，不讓舊 callback 兌換到新 verifier。此規則需寫入測試。
- state 不匹配、cookie 缺失、code 重複使用、超時 → 一律拒絕並清除暫存，導回首頁顯示白話錯誤，不自動重試。
- 登入成功後前端用 `/api/civitai/auth/status` 取得狀態；此端點永不回傳 token，也不回傳 client_secret。

---

## 8. UX 流程設計（最少操作步驟）

1. **未登入**：探索中心標題列常駐「登入 Civitai」按鈕；旁邊一行白話說明「登入可使用收藏、完整模型資訊與直接下載」。**未登入仍可搜尋、排序、分頁、瀏覽公開模型**，不彈阻擋視窗。
2. **按登入**：前端提交真正的 HTML form POST 至 `/api/civitai/auth/start`；後端驗證 Origin、建立 state/verifier 與 `SameSite=Lax` HttpOnly cookie，回 302 讓瀏覽器**頂層導向** Civitai 官方授權頁（`auth.civitai.com`），consent 畫面列出 Sid-simple-ui 要求的權限。不是用 `fetch()` 跟隨 302 取代頁面導向。
3. **完成授權**：Civitai 以**頂層 GET** 回到本機 `/oauth/callback?code&state`；後端比對 query state／pending state／cookie state，單次兌換 code、加密保存 token，再 302 回首頁（`http://127.0.0.1:<port>/` 或註冊的 localhost，port 需與實際啟動一致），探索中心顯示「已登入：username」與「登出」。
4. **取消／關閉瀏覽器**：callback 不會到达；後端短 TTL 自動清理 state/verifier，前端維持未登入，不顯示錯誤。
5. **Token 過期／撤銷**：呼叫 API 前先檢查 expiry；過期先 refresh；若 refresh 回 `invalid_grant`，clear 本機狀態並提示「授權已失效，請重新登入」，不自動無限重試。
6. **401 / 403 判斷（S1-R1 修正）**：
   - **401**：先檢查 token 是否缺失、過期或無效；可 refresh 時先 refresh。匿名存取 gated 資源也可能回 401，因此不能一律歸因於「未登入 Sid-simple-ui」。
   - **403**：先檢查 API 回傳內容與**目前 token 的實際 scope**。`ModelsRead` 不足時代表**應用程式授權範圍不足**，應提示「此操作需要額外授權範圍，請重新登入並同意模型讀取權限」，**不可直接歸因於模型訂閱或付費**。
   - **scope 足夠仍 403**：才判斷是否為模型本身限制（帳號權限、付費、Early Access、gated）。
   - **無法可靠區分**：顯示中性錯誤（例如「Civitai 拒絕存取，請確認帳號與授權狀態」），**不自動引導重新登入**。
   - **實際授權依據是 `/token` 回傳的 `scope` 欄位**，不是 OAuth App 註冊時設定的 `allowedScopes`；`allowedScopes` 只是上限，token 可能被裁剪。來源：https://developer.civitai.com/site/oauth/scopes.md 、 https://developer.civitai.com/site/oauth/endpoints.md 、 https://developer.civitai.com/site/guide/errors.md
7. **避免誤解**：在下載按鈕旁明確標示「登入不代表所有模型都可下載；仍受 Civitai 帳號權限限制」。相容性徽章與登入狀態完全分離。
8. **登出語意（S1-R1 修正）**：
   - **Sid-simple-ui 登出**：只刪除本機 DPAPI 加密 token 與本機登入狀態，UI 立刻回到未登入。
   - **Public Client 沒有使用者瀏覽器 session**，因此本機登出**不呼叫官方 `/revoke`**，也不能宣稱已撤銷 Civitai 端授權。
   - **撤銷 Civitai 授權**：引導使用者到 Civitai 帳號的 **Connected Apps** 自行移除 Sid-simple-ui（來源：https://developer.civitai.com/site/oauth/register-app.md ）。
   - UI 文案需明確區分「已從本機登出」與「Civitai 端授權仍有效」；只有未來改為 Confidential Client 且持有受控 secret 時，才可考慮由程式呼叫 `/revoke`。

---

## 9. 與 S2 下載的銜接評估

- Token 只在 `server.py` 內使用：S2 的下載路由從加密儲存讀 access token，必要時先 refresh，再以 `Authorization: Bearer` 呼叫 Civitai 下載端點。
- `.safetensors` 下載、`.part` 暫存、SHA256、原子移動、背景下載、進度、取消、錯誤恢復，全部是 **S2 範圍**，本輪不設計細節，只確認 OAuth 設計不阻礙：
  - 不把 token 傳給前端 → 前端只需 task id 與進度。
  - 瀏覽器 callback + server-managed token 與背景下載相容。
  - gated/paid 模型即使有 OAuth token 仍可能 403/401 → S2 必須按模型本身權限處理，不可因登入而放寬。
  - 模型相容性仍用既有 `cvClassify()` 三態；登入不吃掉「未知／不建議」。
- 【尚待確認】third-party OAuth token 對/download endpoint 的實際授權行為、429/401 在下載端點的確切語意、Refresh 在長時間背景下載中過期的處理。

---

## 10. PKCE / Device Flow 比較

| 面向 | PKCE（Authorization Code + S256） | Device Authorization Flow |
|---|---|---|
| Civitai 官方支援狀態 | **正式支援且為第三方 app 建議流程** | discovery 列出且 grant type 存在，但官方文件明確「註冊的 client 只有 authorization_code + refresh_token，device flow 不對它開放」；CLI 用的是第一方 client |
| 桌面應用適用性 | 適用；public client + 本機 callback | 概念上適合無瀏覽器/輸入受限裝置，但本專案不可取得 |
| 使用者操作步驟 | 點登入 → Civitai 授權 → 自動回本機（約 2 步） | CLI 模式為顯示網址+代碼→另設備輸入；本專案無法使用 |
| Callback 需求 | 需要本機 `localhost`/`127.0.0.1` redirect URI（精確比對） | 不需 redirect URI，但需 device/token 輪詢端點授權 |
| Token 安全性 | PKCE verifier 後端保存、state 防 CSRF；token 不進前端 | 同等 bearer 風險；但 client 不可用 |
| 實作複雜度 | 中：需 state/verifier/callback/token store | 高且**不可行**（需 Civitai 額外授權 client grant） |
| 生命週期管理 | refresh rotation、revoke、introspection（部分待確認） | 同Token機制，但本專案不適用 |
| S2 下載整合 | 可：token 全程 server-side | 不適用 |

**結論：方案 B（Device Flow）對本專案不可行**，不可為了比較而假設可用。唯一首選是 **方案 A：Authorization Code + PKCE（S256）＋本機 backend callback＋DPAPI加密 token**。

---

## 11. 最終建議及尚待確認事項

### 11.1 唯一首選方案

**Authorization Code + PKCE（S256）＋ Public Client**，本機 callback 由 `server.py` 處理，Token 以 DPAPI 加密存於 `%LOCALAPPDATA%\SidSimpleUI\`，前端只取得登入狀態。

選 Public Client 是因為本專案散發在使用者自己的 Windows 電腦上，`server.py` 不是開發者控制的遠端伺服器；任何內建 `client_secret` 都不能視為秘密。DPAPI 保護的是使用者自己的 token，不是 OAuth App 的 client_secret。只有未來改為集中式遠端服務時，才重新評估 Confidential Client。


### 11.2 選擇原因

- 官方明確支援，且是第三方 app 的建議做法。
- 桌面本機 callback 路線已有官方 `http://localhost:...` 範例，與本專案同源 server 架構吻合。
- 登入啟動選 **HTML form POST → 後端 302 → 頂層導向 Civitai**；不使用 `fetch()` 內部跟隨 302 當成頁面導向，也不採用前端 `location.assign()` 方案。
- callback 是跨站頂層 GET，cookie 固定 `SameSite=Lax` + HttpOnly；不以 `Strict` 取代，`Secure` 依實際 localhost HTTP 行為決定。
- PKCE + state + cookie 三者綁定可防 authorization code 攔截與 CSRF；token 不進前端，符合最小暴露。
- 不需要新增第三方依賴（ctypes/PowerShell 為 Windows 內建）。

### 11.3 主要風險

- redirect URI 是否接受 `127.0.0.1` 未確認；目前 server 只聽 IPv4，`localhost` 若解析到 `::1` 可能無法 callback，需實測。
- `SIMPLE_UI_PORT` 可變，redirect URI 的 port 必須完全一致；自訂 port 與固定註冊值可能衝突。
- `SameSite=Strict` 會讓跨站頂層 GET callback 的 cookie 不被送回；`Secure` 若誤設在 HTTP localhost callback 也可能造成 cookie 消失，兩者都需以實際 callback 實測。
- 未驗證的 OAuth app consent 畫面警告可能影響使用者信任。
- `offline_access` 角色、introspection 用法、refresh 實際期限需確認。
- 403 可能是 scope 不足，也可能是模型本身權限；誤判會造成錯誤引導，必須看實際 token scope 與 API 回應。
- OAuth 不等於可下載所有模型；S2 必須尊重模型本身權限。
- DPAPI 加密檔與 Windows 帳號／機器綁定，帳號或機器轉移需重新登入。

### 11.4 必須先向 Civitai 確認的問題

1. `http://127.0.0.1:<port>/oauth/callback` 是否可註冊（或只能 `localhost`）。
2. 以實際瀏覽器測試 `localhost` 解析到 IPv4/IPv6 時，callback 是否都能回到目前 IPv4-only server。
3. 自訂 `SIMPLE_UI_PORT` 時，是否需註冊多个 redirect URI，或限制 OAuth 只可在註冊 port 使用。
4. 是否可以為第三方 app 開啟 device_code grant；若可，申請流程為何。
5. `offline_access` 是否影響 refresh token 發放／期限。
6. `/api/auth/oauth/introspect` 的請求與回應格式。
7. 第三方 OAuth token 對 gated/paid/early-access 模型下載的實際行為。
8. 是否需要申請 `isVerified` 才能讓一般使用者順利授權。

### 11.5 建議的最小實作範圍（S1 正式實作時）

- 人工：在 Civitai 帳號註冊 OAuth App（ client_id、redirect URI、最小 scope `5`）。
- `server.py`：新增 `/api/civitai/auth/start`（接受 **HTML form POST**，驗證 Origin，設 `SameSite=Lax` HttpOnly cookie，回 302 到 Civitai）、`/oauth/callback`（頂層 GET，比對 query state／pending state／cookie state）、`/api/civitai/auth/status`、`/api/civitai/auth/logout`；PKCE state/verifier 暫存；DPAPI token 存取；`_civitai_get()` 在登入時加 Bearer（匿名時不變）。
- `index.html` / `app.css` / `app.js`：探索中心標題列以真正的 `<form method="post">` 提供登入入口，並顯示帳號狀態／登出；401/403 文案；不改既有 localStorage 格式。
- 測試：mock OAuth server + 隔離 port，不連正式 7860/8188。

### 11.6 本次明確不應順便做的功能

OAuth 登入以外的任何功能：模型下載、`.part`/SHA256/進度/取消、ComfyUI LoRA 目錄管理、相容性重構、localStorage遷移、Workflow 修改、Device Flow、個人 API Key 登入表單。

---

## 12. 本次未修改程式碼的聲明

本輪為唯讀調查，**沒有修改任何程式碼、設定、localStorage、Workflow、報告或其他檔案**；唯一建立的是本報告 `devtools/reports/lora-oauth-s1-design.md`。沒有安裝依賴、沒有執行大量 API 請求、沒有 Commit / Push、沒有清理既有修改或報告。

---

## 13. 結束時 Git Branch、HEAD、工作區狀態

與第 2 節完全一致：

- branch `main...origin/main [ahead 1]`；HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`；remote 不變。
- tracked modified **11**、untracked 由 21 變為 **22**（新增本報告）、staged 0、`git diff --check` 無輸出。
- 沒有 Git 寫入操作。

---

## 14. 正式服務是否受到影響

- 沒有停止或重啟 port 7860 simple_ui、port 8188 ComfyUI 或任何 WD14 Worker。
- 沒有修改正式環境設定、模型、Workflow、輸出圖片或使用者資料。
- 本輪只有讀取程式碼、官方文件 GET 與 Git 唯讀檢查；正式服務無感知。

---

## 15. 完成後動作

唯讀調查與報告已完成，**立即停止**。不開始 OAuth 實作，不擴大範圍，等待 ChatGPT 直接檢查報告、現有程式碼與 Git 狀態進行獨立審查。

---

## 16. S1-R1 審查補正紀錄（僅文件修改）

### 16.1 補正範圍

ChatGPT 獨立審查指出四項需補正，本輪只修改本報告，沒有改动任何程式碼、設定、測試、localStorage、Workflow 或其他報告。

### 16.2 401 / 403 判斷修正（第 8 節）

原報告把 403 直接視為「模型本身權限不足」，過度簡化。已改為：

- 401：檢查 token 缺失／過期／無效，必要時 refresh；匿名存取 gated 資源也可能 401。
- 403：先檢查 API 回應內容與**目前 token 的實際 scope**。
- Scope 不足 → 提示「應用程式授權範圍不足」，不歸因模型訂閱。
- Scope 足夠仍 403 → 才判斷模型本身的帳號權限／付費／Early Access 限制。
- 無法可靠區分 → 中性錯誤，不自動引導重新登入。
- 明確寫出 **`/token` 回傳的 `scope` 才是實際授權依據**，`allowedScopes` 只是上限。
- 官方來源：
  - https://developer.civitai.com/site/oauth/scopes.md
  - https://developer.civitai.com/site/oauth/endpoints.md
  - https://developer.civitai.com/site/guide/errors.md

### 16.3 Callback 實際連線與安全設計（第 5.1、7 節）

已補充：

- 目前 `server.py` 只監聽 IPv4 `127.0.0.1`（`S(("127.0.0.1", port), H).serve_forever()`）；官方只提供 `localhost` 範例且 redirect URI 必須逐字相符。
- `127.0.0.1` 是否可註冊、`localhost` 解析到 `::1` 時能否回到 IPv4-only server，兩者都標為**尚待確認**，必須以實際註冊與瀏覽器 callback 驗證，不可假設。
- 列出最小可行處理方向（不修改程式碼）：讓本機 server 同時涵蓋 IPv4/IPv6，或註冊與實際綁定完全相符的 URI；必要時本機轉接。
- 說明 `SIMPLE_UI_PORT` 可自訂，redirect URI port 必須完全一致；自訂 port 與固定註冊值可能衝突。
- Auth Start 採 POST、驗證 Origin 只允許本機 UI、state + PKCE verifier + HttpOnly cookie 三者綁定、callback 必須驗證 cookie 確實送回、state/verifier 短 TTL 單次使用、多流程並發時一次只允許一個 pending flow 或明確區分 state/cookie。（R1 原寫 `SameSite=Lax/Strict`，已由 S1-R2 修正為**固定 `SameSite=Lax`**，見第 17 節。）
- Callback **不信任 query state 單獨作為依據**，必須與後端保存狀態及瀏覽器 cookie 一致。
- 官方來源：https://developer.civitai.com/site/oauth/register-app.md

### 16.4 Public Client 選擇理由（第 5.1.3、11.1、7 節）

已補充並統一結論：

- `server.py` 安裝在使用者自己的 Windows 電腦，不是開發者控制的遠端伺服器；散布給所有使用者的 `client_secret` 不能視為秘密。
- **Public Client + PKCE** 是合理預設；DPAPI 保護的是使用者自己的 token，不是 app secret。
- 移除先前「若有後端可選 confidential」的曖昧建議；只有未來集中式遠端服務才重新評估 Confidential Client。

### 16.5 登出語意（第 8 節）

已明確區分：

- Sid-simple-ui 登出 = 刪除本機 DPAPI token 與本機登入狀態。
- Public Client 沒有使用者瀏覽器 session，因此本機登出**不呼叫官方 `/revoke`**。
- 撤銷 Civitai 端授權 = 使用者到 Civitai Connected Apps 自行移除。
- UI 文案不得讓使用者誤以為本機登出已撤銷 Civitai 授權。

### 16.6 本輪實際檢查

- 檢查報告內部結論一致性：第 5、7、8、11、16 節已統一為 Public Client、POST start、state/cookie 綁定、scope 為授權依據、本機登出不等於遠端撤銷。
- 官方來源連結已逐項列於第 4 節與補正小節。
- `git diff --check` → 無輸出。
- Git 狀態：branch `main...origin/main [ahead 1]`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、tracked modified **11**、untracked **22**（含本報告，較修改前沒有新增其他檔案）、staged 0。既有 11 個 tracked modified 與其他 untracked 內容完全未動。
- 沒有修改程式碼／設定／localStorage／測試／Workflow，沒有重啟服務，沒有 Commit / Push。

---

## 17. S1-R2 審查補正紀錄（僅文件修改）

### 17.1 SameSite Cookie 修正

- 第 7、8、11、16 節已統一：本專案採 **OAuth Authorization Code Query Callback**，callback 是從 Civitai 跨站導回 localhost 的**頂層 GET**。
- Cookie **固定 `SameSite=Lax`，不可改用 `Strict`**；`Strict` 會讓跨站頂層 GET callback 的 cookie 不被送回，造成 state 比對失敗。
- 保留 `HttpOnly`；`Secure` 不盲目要求，依實際 localhost HTTP callback 的瀏覽器行為與部署方式決定，避免 HTTP callback 上 cookie 消失。
- callback 必須驗證 cookie 確實送回，並比對 query state、後端 pending state 與 cookie state 三者一致。

### 17.2 Auth Start 導向流程修正

選定並統一為**方案 A：HTML form POST**：

```text
前端 <form method="post" action="/api/civitai/auth/start">
  → 後端驗證 Origin、建立 state/verifier、設 SameSite=Lax HttpOnly cookie
  → 後端回 302 到 Civitai authorize
  → 瀏覽器頂層導向 Civitai
  → Civitai 頂層 GET 回本機 /oauth/callback?code&state
```

明確排除：

- 不用 `fetch()` 跟隨 302 當成頁面導向（302 只在 fetch 請求內跟隨，不會導向使用者頁面）。
- 不選「POST 回 authorize URL，再由前端 `location.assign()`」的方案 B。

 Origin 驗證、cookie 設定與頂層導向的配套說明已寫入第 7 節。

### 17.3 Git 數字時間點修正

第 2 節已改為時間軸：

| 時間點 | untracked |
|---|---:|
| S1 原始調查開始前 | 21 |
| S1 報告建立後 | 22 |
| S1-R1 補正後 | 22 |
| S1-R2 目前 | 22 |

不再把不同時間點的 21／22 當成同一時點；第 13、16 節的 22 與此一致。

### 17.4 一致性與完成檢查

- 已檢查第 5、7、8、11、13、16 節的流程與數字一致性。
- `git diff --check` → 無輸出。
- Git：branch `main...origin/main [ahead 1]`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、ahead/behind `1/0`、tracked modified **11**、untracked **22**、staged **0**。
- 本輪只修改本報告；其他 11 個 tracked modified 與其他 untracked 檔案內容完全未動。
- 沒有修改程式碼／設定／localStorage／測試／Workflow，沒有重啟正式服務，沒有 Commit / Push。
