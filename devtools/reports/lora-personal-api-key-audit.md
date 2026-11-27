# Civitai 個人 API Key 整合 — 本機程式碼獨立核對（唯讀）

> 本報告是承接先前 API Key 可行性調查的**獨立核對**，不是實作，也不是重述調查。
> 所有結論以目前工作區磁碟上的程式碼為準（工作區有 11 個 tracked modified，與 HEAD 不同）。
> 標記：【已驗證】= 本輪實際讀碼／唯讀指令；【靜態推論】= 由程式碼推導，未實測；【未知】= 無法從本機或官方文件確認。

---

## 1. 任務目標與範圍

### 1.1 產品目標

讓每個人自行架設 Sid-simple-ui，**第一次設定自己的 Civitai Personal API Key 後**，即可用自己的帳號權限搜尋、查看、下載 LoRA；不要求註冊 OAuth App、不填 Client ID、不設 Redirect URI。

### 1.2 本輪範圍

- 唯讀核對既有可行性結論是否符合目前本機程式碼。
- 整理可直接交付後續實作的**最小方案**（檔案清單、流程、階段、驗收、低風險測試）。
- **唯一的允許寫入**：建立本報告檔 `devtools/reports/lora-personal-api-key-audit.md`。

### 1.3 明確不做

不修改程式碼／測試／設定／既有報告；不建立或輸入 API Key；不呼叫真實 Civitai 帳號；不下載模型；不重啟／停止任何服務；不執行 Git 寫入；不還原 OAuth 實作。

---

## 2. Repository、Branch、HEAD、Remote、開始 Git 狀態

| 項目 | 值 |
|---|---|
| 工作目錄 | `C:\ComfyUI\simple_ui` |
| Repository 根目錄 | `C:/ComfyUI/simple_ui` |
| Branch | `main...origin/main [ahead 1]`（ahead/behind `1/0`） |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 同） |
| tracked modified | **11** |
| untracked | **22** |
| staged | 0 |
| 命令 | `git status --short --branch`、`rev-parse`、`remote -v`、`rev-list --left-right --count` |

### 2.1 tracked modified 清單（開始時，全部保留未動）

```
 M app.css
 M app.js
 M devtools/lora_explorer_api_test.py
 M devtools/lora_explorer_core_test.mjs
 M devtools/lora_mock_civitai.py
 M devtools/lora_ui_test.mjs
 M devtools/test_ui_control_wd14.ps1
 M server.py
 M ui_control.ps1
 M ui_panel.ps1
 M ui_panel.pyw
```

### 2.2 untracked 清單（開始時 22 項）

```
devtools/reports/fix-local-wd14-and-output-directory.md
devtools/reports/history-prompt-category-apply-investigation.md
devtools/reports/lora-explorer-real-world-audit.md
devtools/reports/lora-image-preview-phase2.md
devtools/reports/lora-image-preview-research.md
devtools/reports/lora-image-preview-s0.md
devtools/reports/lora-oauth-s1-design.md
devtools/reports/open-source-readiness-phase1.md
devtools/reports/open-source-readiness-phase2a.md
devtools/reports/open-source-readiness-phase2b1.md
devtools/reports/open-source-readiness-phase2b2.md
devtools/reports/open-source-readiness-phase2b3.md
devtools/reports/open-source-readiness-phase2c-implementation.md
devtools/reports/open-source-readiness-phase2c.md
devtools/reports/open-source-readiness-phase3.md
devtools/reports/open-source-readiness-phase3r1.md
devtools/reports/open-source-readiness-phase3r1r.md
devtools/reports/open-source-readiness-phase3r1v.md
devtools/reports/open-source-readiness-phase3r1vr.md
devtools/reports/readme-agents-documentation.md
devtools/test_ui_control_process.ps1
devtools/test_ui_panel_reporting.py
```

> 與基準完全一致。`devtools/reports` 存在；本報告檔名開始時**不存在**，故無覆蓋衝突。

---

## 3. 正式服務及相關程序狀態（只讀取，未干預）

【已驗證】`Get-Process` + `Get-NetTCPConnection -State Listen`：

| 程序 | PID | Path / CommandLine | 監聽 |
|---|---|---|---|
| ComfyUI | 12196 | `...\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --output-directory D:\ComfyUI_output` | `127.0.0.1:8188` |
| simple_ui server | 13424 | `...\python_embeded\python.exe C:\ComfyUI\simple_ui\server.py` | `127.0.0.1:7860` |
| WD14 VIT Worker（啟動器） | 16428 | 系統 Python 3.13 `python.exe`，CommandLine 指向 `wd14_vit_worker.py` | — |
| WD14 VIT Worker（子行程） | 14572 | `...\wd14-vit-eval\venv\Scripts\python.exe C:\ComfyUI\tools\wd14_vit_worker.py` | — |

- 未觀察到 EVA02 Worker；未觀察到 18189 監聽。
- 本輪**沒有**停止、重啟、發出狀態改變 API，或任何方式干預上述程序。

---

## 4. 實際調查的檔案及重要程式碼位置

### 4.1 後端 `simple_ui/server.py`（本輪重新讀取）

| 位置 | 內容 | 與本任務的關係 |
|---|---|---|
| 11–31 | import：全數標準庫（`hashlib`、`threading`、`urllib.*`、`tempfile`…） | DPAPI 可用 `ctypes` 新增（標準庫），不需第三方 |
| 78–88 | `APP_NAME="SidSimpleUI"`、`_user_data_dir()` → `%LOCALAPPDATA%\SidSimpleUI`，退化 `%APPDATA%`、temp | Key 密文檔可沿用此目錄 |
| 104–107 | `DATA_DIR`、`LOG_DIR` | 既有設定保存位置 |
| 284–293 | `_persist_output_dir()`：`makedirs(DATA_DIR)` + 文字檔寫入 + 白話失敗原因 | 可借鏡「保存失敗要如實回報」，但 Key 必須改成二進位＋加密 |
| 296–340 | `set_output_dir()` 與啟動時讀回；三來源驗證 | 凭證**不可**比照此處存明文 |
| 484–495 | Civitai 常數；註明「公開端點不需要 Token；本模組也不接受、不保存任何 Token」 | 現況與新方法的分界線 |
| 497–518 | `_civitai_cache`、`_cache_get()`、`_cache_set()`（TTL 預設 300、上限 300） | 需分區 |
| **521–542** | **`_civitai_get(path, timeout=...)`**：`urllib.request.Request(CIVITAI_API+path, headers={"Accept","User-Agent"})` → `urlopen`；回 `(obj, code, retry_after)` | **唯一 externa API 入口；加 Bearer 的最小侵入點** |
| 549–581 | `_CIVITAI_IMAGE_HOSTS={"image.civitai.com"}`、`_civitai_image_urls()` 只收 HTTPS/白名單 host | 可延伸成 download 的 host allowlist 模式 |
| 584–632 | `_normalize_civitai_images()`：`publicSafe` 由 `nsfw=false` 搜尋過濾決定 | 登入後不可放寬既有安全判斷 |
| 635–693 | `_normalize_civitai_item()`：已取出 `files[].name/sizeKB/format/primary/sha256/downloadUrl` 與 version `downloadUrl` | **downloadUrl 與 SHA-256 來源已存在，不需新 API 呼叫** |
| 696–725 | `civitai_search()`；cache key `"search|"+urlencode(params)`（710），TTL 300（724）；呼叫 `_civitai_get()` 在 715 | 需加 auth 分區 |
| 791–799 | `_size_matches()` 用 `Decimal` 比對 sizeKB | 下載尺寸比對可重用 |
| 820–841 | `_search_checkpoint_candidates()`；**第二個 `_civitai_get()` 呼叫點在 831** | 加 Bearer 時必須同步考量 |
| 858–903 | `identify_checkpoint()`；cache key `"ckpt|"+name+"|"+size`（878），TTL 900（891/902） | 需 auth 分區；失敗結果不進快取 |
| 1324–1342 | `class H`；`log_message()` 直接 `pass`（無一般 access log）；`_send()` / `_json()` | 目前天然不記錄 URL；新增路由不得破壞 |
| 1344–1363 | `_proxy()`：只代理本機 ComfyUI，headers 僅 `Content-Type` | 不適合直接挪用為 Civitai download |
| 1365–1402 | `_log_gen_request()`：只記 prompt hash、seed 等，寫 `LOG_DIR/gen_requests.jsonl` | 需確認新流程不把 Key 寫進此處 |
| **1405–1439** | `do_GET()` 路由；Civitai 路由在 1429–1432 | 需新增 `GET /api/civitai/key/status`、download status 等 |
| **1446–1473** | `do_POST()` 路由；**沒有任何 download 路由** | 需新增 key 設定／測試／移除、download start/cancel |
| **1476–1515** | `_set_output_dir()`：`X-SimpleUI: 1` + Origin 白名單 + body ≤8192 + 403 `FORBIDDEN` | **Key 路由應直接複製這套同源檢查** |
| 1517–1558 | `_loras()` / `_lora_meta()` | 下載完成後刷新清單用既有 `/api/loras` |
| 1560–1610 | `_civitai_error()`（1562，無 401/403 分支）、`_civitai_status()`、`_civitai_search()` | 需補 401/403 |
| **1673–1684** | **`_hash_stream(stream)`**：串流算 SHA-256 + byte 數，64 KiB chunk | **下載驗證可直接重用** |
| 1686+ | `_delete_file()`：內容 SHA-256 比對才刪 | 下載完整性思路一致 |
| 2090–2118 | `class S(ThreadingMixIn, HTTPServer)`；`main()` 只起 `_purge_loop` daemon thread + WD14 worker；綁 `127.0.0.1:port` | 新背景下載任務需自建 task 管理器 |

**【已驗證】全檔 grep 結果：`server.py` 沒有任何 `Authorization`、`Bearer`、`api_key`、`DPAPI`、`CryptProtectData`、download worker、`.part`、`os.replace` 的既有實作。** 唯一 `urlopen` 的外部呼叫是 `_civitai_get()`（528）與本機 ComfyUI（368 / 1356 / 1642 / 1662 / 1741）。

### 4.2 前端

| 位置 | 內容 |
|---|---|
| `app.js:21–25` | `localStorage` get/set 包 try/catch |
| `app.js:36–44` | `S.civitai`、`PV`（註明不進 localStorage） |
| `app.js:1043–1046` | `function download(it)` → `a.download`；**這是下載「已生成圖片」，不是 Civitai 模型下載，勿混淆** |
| `app.js:1588–1597` | 輸出資料夾設定的 POST 寫法：`headers: {Content-Type, X-SimpleUI:"1"}` → 可直接套用到 Key 端點 |
| `app.js:1842–1984` | `CV`、`cvLoadStatus()`（1860）、`cvRunSearch()`（1919）、`cvOpenModal()`（1972）、`cvCloseModal()`（1978） |
| `app.js:1994–2001` | `cvImageUrl()` 前端 CDN host/HTTPS 檢查 |
| `app.js:2035–2064` | `cvRenderCard()`：檔案列與「在 Civitai 開啟這個版本 ↗」連結——**下載按鈕可放在此處** |
| `app.js:2066–2124` | `renderExplore()`：狀態、錯誤、卡片、縮圖 fallback；Key 狀態列可在此更新 |
| `app.js:3089–3107` |事件綁定（`btnLoraExplore`、`cvGo`、`cvMore`、`cvSort/Period/Nsfw`） |
| `index.html:193–203` | 角色 LoRA 列，`#btnLoraExplore` 在 197 |
| `index.html:359–397` | `#exploreModal`（head/body/foot），**目前無任何 Key／登入／下載 UI** |
| `index.html:233–242` | 右欄 `.set-foot`（`#btnSetOutput`）與收合軌 |
| `app.css:979–1060` | `.cv-*` 樣式群；`app.css:1489` `.modal-card-lg` |

### 4.3 既有報告與測試

- `devtools/reports/lora-oauth-s1-design.md`：OAuth 方案（暫停）。可重用與不適用項目見第 5.5 節。
- `devtools/reports/lora-explorer-real-world-audit.md:180–248`：已有真實 API 欄位範例、HEAD probe（只 HEAD，未下載）、下載任務設計建議。可重用。
- `devtools/lora_explorer_api_test.py`：隔離 mock Civitai/ComfyUI + 隨機 port；`lora_mock_civitai.py`、`lora_explorer_core_test.mjs`、`lora_ui_test.mjs`。目前全部匿名、無下載。
- CodeGraph：`codegraph status` 回「Index is up to date」（35 files / 1094 nodes / 4837 edges）。

> **【已驗證】行號漂移**：既有報告中的 `class S @2072`、`_normalize_civitai_item @549–599`、`cvLoadStatus @1833–1872` 等已與目前工作區不符（實際為 2090、635–693、1860–1899）。後續實作請以本報告行號為準。

---

## 5. 既有調查結論與本機程式碼核對結果

### 5.1 Civitai API 現況（A）

| 既有結論 | 核對 | 證據 |
|---|---|---|
| 唯一入口 `_civitai_get()`，無 Authorization | ✅ 符合 | `server.py:521–526` |
| 只有兩個呼叫點 | ✅ 符合 | 715（`civitai_search`）、831（`_search_checkpoint_candidates`） |
| 錯誤碼 `''/HTTP_xxx/UNREACHABLE/BAD_JSON`，429 附 Retry-After | ✅ 符合 | 521–542；`_civitai_error()` 1562–1576 |
| 無 401/403 處理 | ✅ 符合 | 1562–1576 無對應分支 |
| API 路徑只有 `GET /models` | ✅ 符合 | 714、823–831；無 `/model-versions/*` 呼叫 |
| downloadUrl 與 SHA-256 已在搜尋結果中 | ✅ 符合 | 658–659、675 |
| 前端走同源 `/api/civitai/*` | ✅ 符合 | `app.js:1877, 1943` |
| 沒有任何下載流程或 Worker | ✅ 符合 | `do_GET`/`do_POST` 1405/1446；全檔無 `.part`/`os.replace` |

### 5.2 API Key 儲存與安全（B）

| 既有結論 | 核對 | 證據 |
|---|---|---|
| 無憑證儲存機制 | ✅ 符合 | 全檔 grep 無 DPAPI/Crypt/api_key；`DATA_DIR` 只存 output_dir.txt/logs/wd14-tmp |
| 適合 `%LOCALAPPDATA%\SidSimpleUI` | ✅ 符合 | `_user_data_dir()` 81–88 |
| Embeded Python 可用 ctypes/crypt32 | ✅ 本輪重新驗證 | 3.13.14，`ctypes.windll.crypt32` 可用 |
| 匿名公開搜尋可維持 | ✅ 符合（設計上） | `_civitai_get()` 預設可保持不帶 header；公開搜尋路徑 696–725 不動 |
| 前端不得拿到 Key | ✅ 現況符合 | `S.civitai` 僅記憶體；localStorage keys 不含憑證；`log_message()` 為 no-op |

**【新增發現】** `_hash_stream()`（1673–1684）已存在，可直接用於下載 SHA-256 驗證，先前報告未指出。

### 5.3 下載安全（C）

| 既有結論 | 核對 | 結果 |
|---|---|---|
| 需新增下載 API 與背景任務 | ✅ 符合 | 目前無路由、無 task manager |
| `urllib` redirect 會保留 Authorization | ✅ 本輪重新驗證原始碼 | `HTTPRedirectHandler.redirect_request` 只移除 `content-length`/`content-type`，`newheaders` 複製其餘全部 header → **Authorization 會被帶到跨 host 目標**。注意：方法原始碼內沒有 "Authorization" 字樣，不能以此判斷為安全 |
| 需 host/HTTPS/SSRF 驗證 | ✅ 符合 | 既有 `_civitai_image_urls()` 556–581 是可借鏡的白名單模式；但 downloadUrl 是**伺服器提供**，不可直接信任 |
| `.part`／SHA-256／原子改名可沿用 | ⚠️ 部分 | SHA-256 可重用 `_hash_stream()`；`.part`/`os.replace()` 目前**沒有**，需新增 |
| 多檔案／同名／中斷清理 | ⚠️ 未知 | 本機尚無處理；官方 CLI 有，但本專案不能直接呼叫 CLI |

### 5.4 UI 整合（D）

- ✅ 探索彈窗 `#exploreModal`（`index.html:360–397`）的 head/body 有足夠空間放一列紧凑 Key 狀態，不必新增頁面。
- ✅ 卡片 `cvRenderCard()`（`app.js:2035–2064`）可放版本級「下載」按鈕；狀態可放 `renderExplore()`（2066）。
- ✅ 右欄 `.set-foot`（`index.html:233–236`）是另一個備選入口，但會增加一屏元素；**建議優先在探索彈窗內**。
- ✅ 未設定 Key 時公開搜尋路徑完全不需改動。
- ✅ **不提出大型 UI 重構**：只加一列狀態 + 3 個小按鈕 + 卡片按鈕 + 進度文字。

### 5.5 與 OAuth 設計的關係（E）

**可重用（設計原則，非程式碼）**：

- `lora-oauth-s1-design.md:189–207` 的 DPAPI CurrentUser 比較與「Token 永遠只在 server.py、不進前端、不進 Git、不進 log」原則 → 完全適用於 API Key。
- 該報告 `:261–269` 的「gated/paid 即使有 token 仍可能 401/403，不可因登入而放寬」→ 完全適用。
- `lora-explorer-real-world-audit.md:236–248` 的下載 task id/state/progress/cancel/`.part`/SHA/原子移動/大小比對/磁碟檢查 → 可直接作為 S2 設計基底。

**不適用（不要恢復）**：

- OAuth App 註冊、Client ID/Secret、redirect URI、`/oauth/callback`、PKCE state/verifier、SameSite cookie、refresh rotation、`/revoke`、Connected Apps 撤銷流程 — 全部與 Personal API Key 無關，本輪不實作。
- 該報告 `:339` 明確把「個人 API Key 登入表單」列為 OAuth 範圍外；本任務是**新的獨立需求**，不是恢復 OAuth。

---

## 6. API Key 儲存、安全、快取及下載架構建議

### 6.1 儲存／解密／使用／移除流程（【靜態推論】，需實作後驗證）

1. **寫入**：前端 `POST /api/civitai/key`（`Content-Type: application/json` + `X-SimpleUI: 1`），body 只含 `{key}`，長度上限（建議 ≤ 4096）。後端比照 `_set_output_dir()` 1476–1487 驗證 Origin。
2. **加密**：`ctypes.windll.crypt32.CryptProtectData` with `CRYPTPROTECT_UI_FORBIDDEN`，可加 application entropy；密文寫入 `os.path.join(DATA_DIR, "civitai_key.bin")`。**不得寫明文、不得寫入 LOG_DIR、不得進 Git**。
3. **讀取**：僅在 `server.py` 需要呼叫 Civitai 時，`CryptUnprotectData` 解到區域變數；用完即離開作用域，不快取明文於全域。
4. **使用**：`_civitai_get(path, auth=False)` 增加可選參數；只有 `auth=True` 且 host 為 `civitai.com` / `*.civitai.com` 時加 `Authorization: Bearer <key>`。`CIVITAI_API` 被 env 指向 mock 時**不得送真 Key**（host 檢查自然阻擋）。
5. **測試連線**：`POST /api/civitai/key/test` → 後端 `GET /api/v1/me`（Bearer），只回 `{ok, username, tier}`，不回 Key、不回 email、不回原始 body。
6. **移除**：`DELETE` 或 `POST /api/civitai/key/remove` → 刪除密文檔 + 清記憶體，UI 立刻回「未設定」。
7. **解密失敗**：不當機，回白話：「這台電腦無法讀取已儲存的金鑰，請重新輸入 Civitai API Key」。提示使用者到 `https://civitai.com/user/account` 產生／刪除 Key。

### 6.2 防止 Key 外洩的具體檢查點（阻擋條件）

| 路徑 | 防線 |
|---|---|
| 前端 JavaScript / localStorage | 前端只收 `{configured, username}`；不新增任何 localStorage key；Key 只存在 POST body 一次性送到後端 |
| URL / query | 永不使用 `?token=`；downloadUrl 不加參數 |
| 一般日誌 | `log_message()` 現為 no-op（1327）；新程式碼不得把 header/body 寫入 `LOG_DIR`；例外訊息需 redact |
| 錯誤訊息 | `_civitai_error()` 新增 401/403 分支時不得回顯 Key 或 Authorization；`str(exception)` 可能含 URL/header，需過濾 |
| 外部 CDN | download 時自訂 redirect handler：**跨 host 剝離 Authorization**；只允許 https，每跳檢查，跳數上限；host allowlist + private IP 阻擋 |
| 快取 | key 只用 fingerprint（如 SHA-256(key)[:12]），**不可把 Key 本身放進 cache key 或 value** |

### 6.3 匿名與授權共存

- `_civitai_get()` **預設 `auth=False`**；既有 `civitai_search()` / `_search_checkpoint_candidates()` 呼叫行為不變。
- Key 只「解鎖」能力，不成為進入門檻：未設定 Key 時搜尋、排序、分頁、圖片預覽、既有 generate 流程全部維持現狀。
- 若未來加入 `favorites`/`hidden` 等個人化參數，必須走新的、明確帶 `auth=True` 的路徑，不可偷偷改匿名路徑。

### 6.4 快取是否需要分區（需要）

【已驗證】目前快取 key 不含任何身分：

| 快取 | key | 設定處 | TTL |
|---|---|---|---|
| 搜尋 | `"search|" + urlencode(params)`（`server.py:710`） | 724 | 300 |
| Checkpoint 辨識 | `"ckpt|" + name.lower() + "|" + str(size)`（878） | 891 / 902 | 900 |

建議：

1. 匿名沿用原 key（向後相容、既有測試不用改）。
2. 授權請求使用前綴 `auth|<fingerprint>|` + 原 key，或直接**不快取授權結果**（最安全，代價是個人化查詢每次打 API）。
3. `identify_checkpoint()` 的快取也要分區：登入後 `/models` 可能回不同欄位／browsing level，混用會讓 baseModel 判斷被匿名結果污染。
4. `_cache_set()` 514–518 的 300 筆全清策略在分區後仍可用，但需注意 fingerprint 不同會累積；建議上限不變、TTL 不變。

### 6.5 下載最小可行架構（【靜態推論】，建議與 Key 分階段）

- **強烈建議分兩階段**：先上線 Key（僅影響搜尋／測試連線），再上線下載。理由是 download 的redirect 安全、背景任務、原子寫入風險遠高於 Key 本身。
-  server-side：
  - 新 task manager（dict + `threading.Lock` + `threading.Thread`），task id、`state`、`progress`、`cancel`、`error`、`dedupe key=(versionId, fileName)`。
  - `POST /api/civitai/download/start`、`GET /api/civitai/download/status?id=`、`POST /api/civitai/download/cancel`。
  - 用 `urllib` 串流到 `<target>.part`（與目標同目錄）→ `_hash_stream()` 驗證（API SHA256 大寫，需 case-fold）→ `os.replace()` 原子改名 → 失敗清 `.part`。
  - 寫入目錄：用既有 `folder_paths.get_folder_paths("loras")` 模式（`server.py:783` 已用於 checkpoints），**不要硬編碼** `models/loras`。
  - 完成後前端呼叫既有 `/api/loras`（`app.js:1768`）刷新。
- 前端：卡片「下載」按鈕 → start → 輪詢 status（先不做新 WS 事件，降低複雜度）→ 完成提示「已下載，請到角色 LoRA 選擇」。
- 明確文案：有 Key **不代表**可下載所有模型；Gated / Early Access / Paid / Private 仍受帳號 entitlement 限制。

---

## 7. 最小修改檔案清單及理由

| 檔案 | 必要性 | 修改內容 |
|---|---|---|
| `simple_ui/server.py` | **必要** | Key 加密儲存／解密／移除；`_civitai_get(auth=...)` + host allowlist；cache 分區；401/403 錯誤映射；Key 路由（含同源檢查）；download task manager + 路由 + redirect 安全 + `.part`/SHA/原子移動 |
| `simple_ui/app.js` | **必要** | 探索彈窗 Key 狀態／輸入／測試／移除；卡片下載按鈕 + 進度輪詢 + 取消；沿用既有 `X-SimpleUI` POST 模式（1593–1596） |
| `simple_ui/index.html` | **必要** | `#exploreModal` 內新增 Key 列與狀態元素、卡片模板按鈕（模板在 JS，故主要改 JS，但 DOM 容器需在此） |
| `simple_ui/app.css` | **必要** | Key 狀態列／輸入框／按鈕／進度條樣式，沿用既有 CSS 變數與 `.cv-*` 命名；hover 不改變尺寸 |
| `simple_ui/devtools/lora_personal_key_test.py`（新） | **必要（建議）** | 隔離 mock：Bearer 送出與否、401/403/404、cache 分區、DPAPI round-trip、redirect 剝離 Authorization、`.part` 清理 |
| `simple_ui/devtools/lora_explorer_api_test.py` | **可選** | 若既有匿名測試因 `_civitai_get` 簽名改變而需調整；應盡量保持原測試不動 |
| `simple_ui/ui_control.ps1` / `ui_panel.pyw` | **不需要** | 服務清理／控制台流程與 Key 無關 |
| `simple_ui/tags.js` / `dict.js` / workflow | **不需要** | 與本任務無關 |

> 若想更模組化，可另建 `civitai_key.py`／`civitai_download.py`，但會增加檔案數；「最小方案」建議先放 `server.py`，待穩定後再抽離。

---

## 8. 實作階段與驗收條件

### 階段 A — Key 儲存與測試連線（不含下載）

**內容**：`ctypes` DPAPI package、Key routes、`_civitai_get(auth=)`、cache 分區、401/403 映射、探索彈窗 UI。

**驗收**：
1. 未設定 Key：公開搜尋、Checkpoint 辨識、圖片預覽、generate 與今天完全一致；Console 0 錯誤；版面不捲動。
2. 設定 Key 後：`GET /me` 測試成功只回 username/tier；前端任何 DOM/localStorage/Network 都找不到 Key 字串。
3. 偽造 Origin 或缺少 `X-SimpleUI` 的 Key 請求回 403。
4. 401 →「金鑰無效或已撤銷，請重新產生」；403 → 不自動導向重新輸入；429 → 沿用 `retryAfter`。
5. `%LOCALAPPDATA%\SidSimpleUI\civitai_key.bin` 為二進位，非明文；移除後檔案消失。
6. 加密／解密失敗時 UI 顯示白話提示且服務不當機。

### 階段 B — 模型下載（隔離 mock 先行）

**內容**：背景 task、download routes、redirect handler、host/HTTPS/SSRF、`.part` + SHA + `os.replace`、取消、刷新 `/api/loras`。

**驗收（全部用 mock，不下載真實模型）**：
1. `civitai.com` 首請求帶 Bearer；307 到外部 CDN 後 **Authorization 消失**；非 https / private IP / 非白名單 host 被拒。
2. `.part` 在成功前存在；SHA 不符時 `.part` 被刪且最終檔不存在；相符才原子改名。
3. 取消後 `.part` 被清、task 狀態可查詢；重複 start 以 dedupe key 合併。
4. 目標檔已存在且 SHA 相符 → 跳過；不符 → 提示，不靜默覆寫。
5. 401/403/404/429 各自回不同白話訊息，**不宣稱「有 Key 就能下載」**。
6. 完成後 `/api/loras` 出現該 LoRA。

### 階段 C — 文件與收尾

- 使用者指南：在哪建立／刪除 Key、full-scope 風險、綁定 Windows 帳號、備份不可攜帶、entitlement 限制。
- 不新增 OAuth 入口、不恢復 S1。

---

## 9. 已執行檢查及結果（唯讀）

| 檢查 | 結果 |
|---|---|
| `git rev-parse --show-toplevel / branch / HEAD / remote -v / rev-list` | 如第 2 節 |
| `git status --short --branch` + porcelain 計數 | tracked modified 11、untracked 22、staged 0 |
| `Get-Process python/pythonw` + `Get-NetTCPConnection` | 如第 3 節 |
| `Test-Path` 報告目錄與目標檔 | 目錄存在；目標檔不存在（無衝突） |
| `codegraph status` | Index up to date；35 files / 1094 nodes / 4837 edges |
| `read` server.py 多段（1–120、277–351、484–733、780–909、1324–1443、1444–1518、1560–1629、1668–1699、2090–2118） | 如第 4/5 節 |
| `read` app.js（1580–1611、1842–2001、2035–2124）/ index.html（186–295、340–409）/ app.css grep | 如第 4 節 |
| `grep` server.py：`urlopen|Authorization|Bearer|api_key|DPAPI|download|cache|Thread|Popen` | 62 matches；確認無授權／下載／DPAPI 實作 |
| `grep` devtools/reports：`download|API Key|part|sha256` | 找到既有設計建議（real-world-audit 180–248）與 S1 可重用原則 |
| `python -c "inspect.getsource(urllib.request.HTTPRedirectHandler.redirect_request)"` | `CONTENT_HEADERS = ("content-length","content-type")`；`newheaders` 複製其餘 → **Authorization 未被剝離** |
| embedded python `-c "import ctypes; ctypes.windll.crypt32"` | True（3.13.14） |
| `node --check app.js` | OK（無寫入） |
| `python -c "ast.parse(open('server.py').read())"` | OK（無 `__pycache__` 寫入） |

---

## 10. 未執行測試及原因

| 未執行 | 原因 |
|---|---|
| `python -m py_compile server.py` | 會寫入 `__pycache__`，違反唯讀限制；改用 `ast.parse` 等同語法驗證 |
| `python devtools/lora_explorer_api_test.py` | 會 import server 並綁定隨機 port、monkeypatch 全域；雖為隔離環境，但本輪不需要執行即可完成核對，為保持零副作用不執行 |
| `node devtools/lora_explorer_core_test.mjs` | 同上，非必要；已靜態確認其為純資料層測試 |
| 任何真實 Civitai API 呼叫（含 `/me`、`/models`、`HEAD /api/download`） | 需要真實帳號／Key，且任務禁止 |
| 任何模型下載 | 明確禁止 |
| 瀏覽器（browse MCP）實測 | 會對正式 7860 服務發請求；本輪為唯讀程式碼核對，不需要 |
| 重啟／停止任何服務 | 明確禁止 |

> 所有「已驗證」均為**讀碼／唯讀指令**；「【靜態推論】」代表尚未在執行期驗證。

---

## 11. 結束時 Git 狀態

（本報告建立後重新檢查，見本節最終值）

- Branch：`main...origin/main [ahead 1]`；HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`；ahead/behind `1/0`
- 11 個 tracked modified：內容未動
- untracked：原 22 項 + 本報告 `devtools/reports/lora-personal-api-key-audit.md`（= 23）
- staged：0
- 沒有 Git 寫入操作

---

## 12. 正式服務是否受到影響

**沒有。** 本輪只有：讀檔、grep、Git 唯讀指令、程序/連接埠查詢、`node --check`、`ast.parse`、Python 標準庫原始碼檢視、以及建立本報告。未呼叫 7860 的狀態改變端點、未呼叫 8188、未碰 WD14 Worker、未修改任何现有檔案。

---

## 13. 未解決問題與風險

### 13.1 正式實作前的阻擋條件（ blocker ）

1. **redirect 授權洩漏**：Python `urllib` 跨 host redirect 保留 Authorization；必須自訂 handler 剝離，否則 full-scope Key 會送給第三方 CDN。
2. **host allowlist**：`downloadUrl` 是 API／上行者提供的字串，不可直接 urlopen；必須限制 `civitai.com` / `*.civitai.com`、https-only、private IP 阻擋。
3. **Key 只留後端**：前端、localStorage、URL、日誌、錯誤訊息、快取 key 都不得出現 Key。
4. **同源檢查**：Key 設定／移除端點必須複製 `_set_output_dir()` 的 `X-SimpleUI` + Origin 檢查，避免本機端口被跨站寫入。
5. **快取分區**：匿名與授權結果混用會造成個人化資料污染／錯誤的 baseModel 判斷。
6. **entitlement 文案**：不可宣稱有 Key 就能下載所有模型；Gated/Early Access/Paid/Private 限制必須保留。
7. **寫入完整性**：`.part` + SHA-256（大小寫折疊）+ 原子改名 + 失敗清理，缺一不可。
8. **full-scope 認知**：個人 Key 含 `ModelsDelete`/`VaultWrite`/`AIServicesWrite`（可花 Buzz），必須在使用者指南中明確告知。

### 13.2 可延後但必須列為風險

- Range／Resume 支援【未知】，不實作就整檔重下。
- 同版本多檔案精確選檔、同名檔案衝突、磁碟空間檢查。
- 進度改用 WS 事件（先用輪 polling 即可）。
- 跨 Windows 帳號／機器的 Key 遷移：DPAPI 無法解開，需重新輸入。
- 官方政策偏好 OAuth for third-party apps；本專案是自架自用取捨，需在文件中如實說明。
- 既有報告行號漂移，後續文件應持續以程式碼為準。
- 429／風控在大量下載時的行為【未知】。

---

## 14. 需要 ChatGPT 特別獨立審查的項目

1. **分階段決策是否正確**：先上 Key（含 auth 搜尋）再上 download，是否會造成「有 Key 但沒有下載」的過渡期體驗問題？
2. **快取策略**：授權結果「分區快取」還是「完全不快取」哪個更符合本專案的低維護目標？
3. **DPAPI 是否值得額外 complex**：是否應改用 Windows Credential Manager，或接受明文（不建議）？
4. **download 寫入位置**：是否應寫入 ComfyUI `loras` 目錄（需 `folder_paths`），還是先寫入 SidSimpleUI 自己的暫存再由使用者搬移？
5. **Key 測試端點**：`GET /me` 是否足以作為「測試連線」，會不會回傳過多帳號資訊？
6. **同源檢查是否需涵蓋 download start/cancel**：目前設計只打算給 Key 端點套用；download 端點是否也該套？
7. **是否有遺漏的 Key 外洩路徑**：特別是 `str(exception)`、`urllib` 的 `HTTPError.body`、以及 `_civitai_error()` 取得的 `retryAfter`。
8. **線號與實際程式碼是否再次漂移**：請以 CHECKOUT 後的實際工作區重新驗證本報告引用的行號。

---

## 15. 完成陳述

本輪為唯讀核對與報告建立，**沒有修改任何既有程式碼、測試、設定、文件、使用者資料或既有報告，沒有恢復 OAuth，沒有開始實作**。唯一的寫入是本報告檔。完成後停止，等待 ChatGPT 獨立審查。
