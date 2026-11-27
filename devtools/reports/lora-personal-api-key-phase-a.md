# Civitai Personal API Key — 階段 A 安全儲存與連線驗證

> 本輪只完成 Key 的安全管理（DPAPI 加密保存、狀態／設定／測試／移除 API、探索中心 UI），
> **沒有實作模型下載、Download Worker、Redirect Handler、CDN allowlist、Favorites/Hidden、OAuth**。
> 既有 11 個 tracked modified 與 23 個 untracked 全部完整保留，未清理、未覆蓋。

---

## 1. 開始時 Repository、Branch、HEAD、Remote、Git Status

| 項目 | 值 |
|---|---|
| 工作目錄 | `C:\ComfyUI\simple_ui` |
| Repository 根目錄 | `C:/ComfyUI/simple_ui` |
| Branch | `main...origin/main [ahead 1]`（ahead/behind `1/0`） |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 同） |
| tracked modified | **11** |
| untracked | **23**（含前一份 `lora-personal-api-key-audit.md`） |
| staged | 0 |

開始時 tracked modified：`app.css`、`app.js`、`devtools/lora_explorer_api_test.py`、`devtools/lora_explorer_core_test.mjs`、`devtools/lora_mock_civitai.py`、`devtools/lora_ui_test.mjs`、`devtools/test_ui_control_wd14.ps1`、`server.py`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`。

已先讀取上層與 Repo 根目錄 `AGENTS.md`，以及 `lora-personal-api-key-audit.md`、`lora-oauth-s1-design.md`、`server.py`、`app.js`、`index.html`、`app.css`，並重新以目前的磁碟內容確認行號（未沿用舊報告行號）。

---

## 2. 修改檔案及目的

| 檔案 | 狀態 | 目的 |
|---|---|---|
| `simple_ui/server.py` | 修改 | 新增 DPAPI 金鑰儲存層、`_civitai_get(auth=)`、Bearer host 限制、`/me` 測試、四個 Key API 路由與同源防護 |
| `simple_ui/app.js` | 修改 | 探索中心 Key 狀態／表單／測試／移除 UI、前端同源 POST、輸入框清除、每次開 Modal 重取狀態 |
| `simple_ui/index.html` | 修改（原本未修改） | `#exploreModal` 內新增緊湊 Key 管理 DOM 與風險提示 |
| `simple_ui/app.css` | 修改 | `.cv-key-*` 樣式，沿用既有 CSS 變數與 `.cv-*` 命名 |
| `simple_ui/devtools/lora_personal_key_test.py` | 新增 | 9 項隔離後端測試（含 mock Civitai、假金鑰、臨時 DATA_DIR） |
| `simple_ui/devtools/lora_personal_key_ui_test.mjs` | 新增 | 13 項前端原始碼檢查（password、清除、同源 header、localStorage/URL 不外洩） |
| `devtools/reports/lora-personal-api-key-phase-a.md` | 新增 | 本報告 |

---

## 3. DPAPI 與安全設計

### 3.1 實作位置（`server.py`）

| 行號 | 內容 |
|---|---|
| 11–31 | 新增 `import ctypes`、`from ctypes import wintypes`（全數標準庫） |
| 115–121 | `KEY_FILE_NAME = "civitai_key.bin"`、`_KEY_PATH = os.path.join(DATA_DIR, ...)`、`_KEY_BODY_LIMIT = 4096`、`_CIVITAI_AUTH_HOSTS = {"civitai.com"}`、`CIVITAI_ME_URL`（正式值固定官方 `/me`） |
| 123–129 | `KeyStoreError(code, message)`；對外只使用 `message`（白話），`code` 供内部映射 |
| 131–161 | `_DATA_BLOB`、`_blob()`、`_crypt32()`（設定 argtypes/restype，避免 64-bit 指標截斷）、`_free_blob()`（`LocalFree`） |
| 163–189 | `_dpapi_protect()` / `_dpapi_unprotect()`：`CryptProtectData` / `CryptUnprotectData`，`CRYPTPROTECT_UI_FORBIDDEN = 0x1`，**CurrentUser，未使用 LocalMachine** |
| 191–202 | `_validate_key_text()`：空值、8–512 字、不可含空白或控制字元 |
| 204–220 | `_atomic_write_key()`：同目錄 `mkstemp` → `write` → `flush` → `os.fsync` → `os.replace`；例外清理暫存檔 |
| 222–236 | `save_api_key()`：驗證 → 加密 → 原子寫入；失敗回 `(False, 白話訊息)`，不回報成功 |
| 238–261 | `read_api_key()`：只讀檔解密，明文只存在呼叫端區域變數；解密失敗丟 `KeyStoreError("KEY_DECRYPT_FAILED", "請重新輸入")` |
| 263–272 | `remove_api_key()`：刪密文檔；無明文全域狀態可清（已在註解說明） |
| 274–283 | `key_status()`：只回 `{configured, error}`；解密失敗仍回 `configured=True` 加白話提示，**不回 Key／密文** |

### 3.2 安全界限（如實說明）

- DPAPI 只保護**靜態資料**。同一 Windows 使用者權限下的惡意程式仍可呼叫 `CryptUnprotectData` 解開；**不可宣稱絕對安全**。
- Key 與目前 Windows 使用者帳號（及機器）綁定；換帳號或換機必須重新輸入，備份無法攜帶。
- Key 不在 Repo、不在環境變數、不在 URL、不在前端 localStorage、不在明文設定檔。
- 明文不進全域狀態、不進 `_civitai_cache`、不進 `LOG_DIR`；`H.log_message()` 仍是 no-op。
- 檔名固定 `civitai_key.bin`，位於 `_user_data_dir()` 回傳的 `%LOCALAPPDATA%\SidSimpleUI`。

---

## 4. API 路由與錯誤處理

### 4.1 路由

| 方法 | 路徑 | 位置 | 說明 |
|---|---|---|---|
| GET | `/api/civitai/key/status` | `server.py:1678` | 只回 `{ok, configured, error}`；不需 `X-SimpleUI`（唯讀） |
| POST | `/api/civitai/key` | `server.py:1720` | `{key}` → 驗證 → DPAPI → 原子寫入；不回 Key |
| POST | `/api/civitai/key/test` | `server.py:1722` | 後端 Bearer 呼叫固定 `/me`，只回 `{username, tier}` |
| POST | `/api/civitai/key/remove` | `server.py:1724` | 刪密文檔，立即回 `configured:false` |

處理函式：`_key_guard()`（1865，比照 `_set_output_dir()` 的 `X-SimpleUI` + Origin 白名單）、`_key_body()`（1877，上限 4096）、`_key_forbidden()`、`_civitai_key_set()`（1900）、`_civitai_key_test()`（1914）、`_civitai_key_remove()`（1933）。

### 4.2 `/me` 測試

- `_civitai_me()`（`server.py:741`）：`Authorization: Bearer <key>`，**不使用 `?token=`**；正式 URL 固定為 `https://civitai.com/api/v1/me`（`CIVITAI_ME_URL` 只供隔離測試覆蓋為本機 mock）。
- 不讀、不回顯 `HTTPError` body，避免敏感資訊進日誌或前端。
- 成功只回 `username`、`tier`（白名單），不回 `id`、`email`、`emailVerified`、`status`、`subscriptions` 或原始回應。

### 4.3 錯誤映射（`_civitai_key_error()`，`server.py:765`）

| 情況 | HTTP | code | 白話訊息要點 |
|---|---|---|---|
| 401 | 401 | `CIVITAI_KEY_INVALID` | 金鑰無效／已撤銷／未被接受，請到帳號設定確認 |
| 403 | 403 | `CIVITAI_FORBIDDEN` | Civitai 拒絕此操作，可能是帳號權限不足；**不代表金鑰無效** |
| 429 | 429 | `CIVITAI_RATE_LIMITED` | 放慢查詢，附 `retryAfter` |
| 5xx | 502 | `CIVITAI_SERVER_ERROR` | 服務端暫時錯誤 |
| 網路失敗 | 503 | `CIVITAI_OFFLINE` | 連不到 Civitai |
| 格式錯誤 | 502 | `CIVITAI_BAD_RESPONSE` | 回傳資料格式不正確 |
| 解密失敗 | 409 | `KEY_DECRYPT_FAILED` | 這台電腦無法讀取，請重新輸入 |
| 未設定 | 409 | `KEY_NOT_SET` | 尚未設定金鑰 |
| 同源失敗 | 403 | `FORBIDDEN` | 請從本機生圖介面操作 |
| Body 過大／壞 JSON | 413 / 400 | `TOO_LARGE` / `BAD_JSON` | 請求太大／格式錯誤 |

所有錯誤都不回顯 request header、POST body、Key 或例外字串。

### 4.4 `_civitai_get(auth=)`（`server.py:706`）

- 預設 `auth=False`，**現有 `/models` 公開搜尋（`civitai_search`，約 890 行）與 Checkpoint 搜尋（`_search_checkpoint_candidates`）都沒改呼叫方式**。
- 只有 `auth=True` 且 `_civitai_auth_allowed()`（`server.py:285`）成立才加 Bearer；條件是 `CIVITAI_API` 的 scheme 為 `https` 且 host 為 `civitai.com`。
- `CIVITAI_API` 指向本機 mock／其他 host 時**絕對不送 Key**（測試已驗證）。
- 沒有修改既有快取 key、TTL、 `_civitai_cache` 策略；未來授權專屬查詢必須另做快取隔離。

---

## 5. UI 互動設計

- `index.html:367` 起，`#exploreModal` 內新增：
  - `#cvKeyBar`：`#cvKeyStatus`、`#cvKeyEdit`、`#cvKeyTest`、`#cvKeyRemove`
  - `#cvKeyForm`：`#cvKeyInput`（`type="password"`、`autocomplete="off"`）、`#cvKeySave`、`#cvKeyCancel`
  - `#cvKeyResult`（`aria-live="polite"`）
  - `.cv-key-note`：風險提示（自己的 Key、Full Access 高權限含消耗 Buzz、自行管理撤銷、DPAPI 不可抵禦同帳號惡意程式、官方建議 OAuth 而本專案取捨）
- `app.js:42` `S.civitai.key` 只存狀態（configured/username/tier/error/state/formOpen/busy/result），**不存 Key**。
- `renderKeyUI()`（`app.js:1995`）依照狀態更新文字與按鈕；只顯示 username/tier，不顯示可逆遮罩。
- `cvKeyPost()`（2021）固定帶 `X-SimpleUI: 1`；`cvKeyRefresh()`（2034）、`cvKeySave()`（2053）、`cvKeyTest()`（2075）、`cvKeyRemove()`（2091）各自處理成功與白話錯誤。
- `cvKeySave()` 在 `finally` 清空輸入框；取消與 `cvCloseModal()`（`app.js:1988`）也清空。
- `cvOpenModal()`（`app.js:1977`）每次開啟都呼叫 `cvKeyRefresh()`，重新向後端取得狀態。
- 事件綁定在 `app.js:3212` 起。
- `app.css:985` 起新增 `.cv-key-*` 樣式，使用既有變數（`--text-2`、`--ok`、`--err`、`--bg-2` 等），hover 不改變尺寸。
- 未設定 Key 時公開搜尋、排序、分頁、圖片預覽、成熟內容判斷完全未改動。

---

## 6. 測試項目及結果

### 6.1 實際執行（全部隔離，不碰 7860/8188）

| 測試 | 結果 |
|---|---|
| `python devtools/lora_personal_key_test.py` | **9 tests passed** |
| `python devtools/lora_explorer_api_test.py` | **35 tests passed**（既有探索測試全通過） |
| `node devtools/lora_explorer_core_test.mjs` | **21 tests passed**（既有核心測試全通過） |
| `node devtools/lora_personal_key_ui_test.mjs` | **13 checks passed**（新增前端原始碼檢查） |
| `node --check app.js`、`node --check devtools/lora_personal_key_ui_test.mjs` | OK |
| `compile(open('server.py').read())`、`compile(open('lora_personal_key_test.py').read())` | OK（不寫 `__pycache__`） |
| `git diff --check` | OK（無 whitespace 錯誤） |

### 6.2 新增後端測試涵蓋（每項都有 PASS）

1. DPAPI 加解密 round-trip，且密文不含明文。
2. 保存／狀態／移除；密文檔不含明文；移除後檔案消失、狀態變未設定。
3. 空值、含空白、過長金鑰皆 400；`_atomic_write_key` 被強制失敗時回 500 且不回報成功、不留檔案、不洩漏例外字串。
4. 密文檔被寫成垃圾時：狀態仍可讀且提示「重新輸入」，測試端點回 409，服務不崩潰。
5. 缺少 `X-SimpleUI` 或 Origin 為 `http://evil.example` 時回 403；正確同源可通過（三個修改端點皆測）。
6. Body 5000 bytes → 413；壞 JSON → 400。
7. `/me`：200 只回 `{ok, username, tier}`（無 email/id 等）；401、403、429（附 retryAfter）、5xx、連線失敗各自正確；Mock 收到 `Bearer TEST-KEY...` 且 URL 無 `token=`；回應不含假金鑰。
8. 已設定金鑰時，`civitai_search()`、`_search_checkpoint_candidates()`、`/api/civitai/search` 對 mock 的要求都**沒有** Authorization。
9. `_civitai_auth_allowed()` 對 mock 為 False、對 `https://civitai.com` 為 True；`auth=True` 也不把 Key 送到 mock host。

### 6.3 新增前端檢查涵蓋

password 型態、測試／移除按鈕、aria-live、風險提示文字、`X-SimpleUI`、三個端點、Key 邏輯不碰 localStorage/sessionStorage、無 `query token`、輸入框清空、Modal 重開重取狀態、URL 無 token、`.cv-*` CSS 命名。

---

## 7. 未執行測試及原因

| 未執行 | 原因 |
|---|---|
| `python -m py_compile server.py` | 會寫入 `__pycache__`；改用 `compile()` 做同等的語法驗證，無檔案寫入 |
| `node devtools/lora_ui_test.mjs`（真實 CDP 端對端） | 需另外啟動隔離 7861／18188／18189 與 headless Chrome；本輪已用原始碼檢查與 API mock 覆蓋 Key 行為，且任務要求低風險，故不啟動額外服務 |
| 真實 `https://civitai.com/api/v1/me` 呼叫 | 需真實 Key，明確禁止 |
| 任何模型下載／`/api/download` | 階段 B 範圍，明確禁止 |
| 對正式 7860／8188 的瀏覽器測試 | 不得干預正式服務；本輪未发送任何狀態改變請求 |

---

## 8. Git 最終狀態

（建立本報告後測得）

- Branch：`main...origin/main [ahead 1]`；HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`；ahead/behind `1/0`
- Remote 不變
- tracked modified：**12**（原有 11 項中之 `app.css`／`app.js`／`server.py` 內容再增加，另把原本未修改的 `index.html` 變成 modified）
- untracked：**26**（原有 23 項保留，新增 `devtools/lora_personal_key_test.py`、`devtools/lora_personal_key_ui_test.mjs`、`devtools/reports/lora-personal-api-key-phase-a.md`）
- staged：0
- 沒有執行 add／commit／push／checkout／reset／restore／stash／clean。

---

## 9. 正式服務是否受到影響

**沒有。** 無停止／重啟 7860、8188 或 WD14 Worker；無修改正式環境設定；無輸入真實 Key；無呼叫真實 Civitai 帳號；無下載模型。所有測試都在隔離隨機 port 與臨時資料夾完成，結束後清理。

---

## 10. 未解決問題及風險

1. **Full-scope 風險**：個人 API Key 可含高權限（包含消耗 Buzz 的操作）；UI 已提示，但仍需使用者自行管理與撤銷。
2. **DPAPI 界限**：同一 Windows 使用者權限下的惡意程式仍可解密；跨帳號／換機需重新輸入。
3. **Download 尚未實作**：本階段無模型下載、無 `.part`／SHA-256／原子下載完成流程、無 Redirect Handler、無 CDN host allowlist；留待階段 B。
4. **快取未分區**：本輪刻意不改既有匿名快取；未來若加入授權專屬搜尋（favorites/hidden），必須另做快取隔離，不可混用匿名結果。
5. **`auth=True` 尚無實際呼叫端**：能力已備妥並經 host guard 測試，但正式功能要到需要授權的端點才會使用。
6. **`CIVITAI_ME_URL` 可變**：正式值固定官方端點，但測試可覆蓋為 mock；需確保正式部署沒有任何環境變數或設定能改它（目前只有模組變數，沒有 env 讀取）。
7. **Key 格式驗證較寬**：只檢查可見 ASCII、8–512 字，未驗證 Civitai 官方前綴；避免誤拒有效金鑰。
8. **無檔案 ACL 強化**：未呼叫 `icacls` 限縮密文檔 ACL；依賴 `%LOCALAPPDATA%` 與 DPAPI 的保護。
9. **前端僅做原始碼靜態檢查**：未以真實瀏覽器驗證 DOM 與 localStorage 執行期行為。

---

## 11. 需要 ChatGPT 特別獨立審查的程式碼位置

1. `server.py:131–189`：ctypes 結構、argtypes/restype、`LocalFree` 是否在所有路徑正確釋放，64-bit 是否安全。
2. `server.py:204–220`：原子寫入是否在所有失敗路徑清掉暫存檔；`os.replace` 目標與暫存檔是否同目錄。
3. `server.py:238–261`：解密失敗是否可能讓 exception 字串外洩；是否所有失敗都轉成 `KEY_DECRYPT_FAILED`。
4. `server.py:285–292` 與 `706–739`：Bearer host 限制是否足以阻止 Key 送往 mock／任何非官方 host。
5. `server.py:741–790`：`_civitai_me()` 是否真的完全不使用 query token、是否完全不回顯 HTTPError body。
6. `server.py:1865–1945`：同源檢查是否與 `_set_output_dir()` 一致；缺少 Origin 時放行是否可接受。
7. `app.js:1995–2110`：Key 是否可能透過 `e.message`、`result.textContent` 或其他路徑間接進入 DOM／localStorage。
8. `index.html:367–381`：風險提示是否合理、是否過度恐嚇或掩蓋風險。
9. 測試檔 `lora_personal_key_test.py` 是否真的完全隔離（尤其 `server.DATA_DIR` 與 `_KEY_PATH` 的覆蓋時機）。

---

## 12. 完成陳述

階段 A 已完成並停止。**沒有開始階段 B**，沒有實作任何下載功能，沒有 Commit／Push，沒有清理既有工作區修改。
