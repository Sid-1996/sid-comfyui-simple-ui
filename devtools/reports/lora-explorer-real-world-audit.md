# LoRA 探索中心真實使用情境調查 — 唯讀審計報告

> 任務性質：**唯讀調查**。本輪未修改任何正式程式碼／設定／localStorage／Workflow，未下載 LoRA 模型，未停止或重啟任何服務，未 Commit / Push。唯一建立的檔案是本報告。
>
> 證據標記：【已驗證事實】= 本輪直接讀碼／實際 API 或瀏覽器觀察；【官方文件記載】= Civitai 官方開發者文件；【合理推論】= 由事實推導；【尚待確認】= 未驗證，不可當成可用功能。

---

## 1. 調查結論摘要

目前阻礙使用者的**不是 Civitai CDN，也不是縮圖 URL 轉換**，而是上一輪「NSFW 未知判斷修正」與真實 API 資料形狀不相容所造成的**前端自我隱藏**。

- 真實 Civitai `/models` 回傳的每張圖片**沒有 `nsfw` 布林欄位**，只有數字 `nsfwLevel`（本輪實測 `1`）。
- 後端因此把每張圖標成 `mature:false, unknown:true`（這是上一輪審查要求的保守行為）。
- 前端 `cvImageVisible()` 在「顯示成熟內容」未勾選時，同時隱藏 `mature` 與 `unknown`；於是**所有真實圖片都不會產生 `<img>`**。
- 瀏覽器實證：正式 UI 搜尋 `anime` → 20 張卡、**0 個 `<img>`、20 個「無預覽」佔位、Network 0 個圖片請求**；勾選「顯示成熟內容」後 → **19 張圖片成功載入**（`naturalWidth=320`），Network 3 個圖片回應、**0 失敗**。

建議方向：

1. **先修圖片門檻**（最小、最高優先）：不要把「無 `nsfw` 布林」直接等同「不可顯示」；改用官方可用的明確欄位，或把 unknown 圖片改為「模糊＋點擊才顯示」而非完全消失。真實資料必須進入 mock／E2E，避免再次發生 mock 通過、正式全壞。
2. **以官方 OAuth（Authorization Code + PKCE）作為登入主軸**，token 只存後端、依 Windows 帳號加密保存；未登入仍可公開瀏覽。
3. **模型下載做成背景任務**：下載到 `folder_paths.get_folder_paths("loras")` 回傳的實際目錄，`.part` 暫存＋SHA256 驗證＋原子改名，完成後刷新 `/api/loras`。
4. **相容性維持三態**：相容／不相容／未知；未知絕不當相容，也不靠名稱或關鍵字推測。

---

## 2. 圖片預覽失敗根因（A）

### 2.1 真實 API 回應（已驗證事實）

低負載公開 GET（2026-11-24）：

```text
GET https://civitai.com/api/v1/models?types=LORA&limit=2&query=anime&nsfw=false  → 200
model 16014 / version 28907：baseModel = SD 1.5，images = 16 張
model 11177 / version 28609：baseModel = SD 1.5，images = 9 張
```

單張圖片的實際欄位：

```json
{
  "id": 326152,
  "url": "https://image.civitai.com/.../original=true/326152.jpeg",
  "nsfwLevel": 1,
  "width": 1280, "height": 1920,
  "type": "image", "minor": false, "poi": false,
  "hasMeta": true, "hash": "...", "onSite": false
}
```

**沒有 `nsfw` 欄位**（`img.get("nsfw")` → `None`）。另一次掃描 119 張真實圖片：

- host 全部是 `image.civitai.com`（119/119）。
- 0 張 URL 帶 query string 或 fragment。
- 目前真實資料未見 signed URL／token 參數。

### 2.2 後端正規化結果（已驗證事實）

直接用正式環境的 `server._normalize_civitai_images()` 處理上述真實圖片物件：

```json
[{"id":326152,
  "url":"https://image.civitai.com/.../original=true/326152.jpeg",
  "thumb":"https://image.civitai.com/.../width=300/326152.jpeg",
  "width":1280,"height":1920,"nsfwLevel":1,
  "mature":false,"unknown":true}]
```

原因在 `server.py`（審查修正後）：

```python
mature = (nsfw is True or minor or poi or 字串 Mature/X)
unknown = not isinstance(nsfw, bool) and not mature
```

真實資料 `nsfw is None`、沒有成熟旗標 → `unknown = True`。

### 2.3 前端門檻（已驗證事實）

`app.js:1996–2001`：

```js
function cvImageVisible(img, model, showMature) {
  if (!img || !cvImageUrl(img.url)) return false;
  if (!showMature && (img.mature || img.unknown)) return false;
  if (!showMature && model && model.nsfw) return false;
  return true;
}
```

`CV.nsfw === false` 時，`unknown:true` 的真實圖片全部被過濾；`cvRenderCard()` 因此渲染 `.cv-thumb-none` 佔位而非 `<img>`，詳細預覽的 `images` 也為空。

### 2.4 瀏覽器 Network／Console 實證（已驗證事實）

使用已連線的 browse relay，在正式 `http://127.0.0.1:7860/?v=real-audit` 開新分頁（只讀，未改 localStorage），操作探索中心搜尋 `anime`：

| 狀况 | 卡片 | `<img>` | 佔位 | Network（image.civitai.com） | 結果 |
|---|---:|---:|---:|---|---|
| 成熟內容關閉（預設） | 20 | **0** | 20 | **0 requests / 0 responses / 0 failures** | 全部「無預覽」 |
| 勾選「顯示成熟內容」 | 20 | **19** | 1 | 3 responses / 0 failures | 前三張 `naturalWidth=320`，`complete=true` |

主圖 URL 例如 `https://image.civitai.com/.../width=300/77075963.jpeg`，直接成功載入。分頁已於觀察後關閉。

### 2.5 CDN／CSP／其他假設的排除（已驗證事實）

| 假設 | 驗證結果 |
|---|---|
| CDN 掛掉 | HEAD 原圖 `200 image/png 3,110,272 bytes`；HEAD `width=300` `200 image/jpeg 69,529 bytes`；無 redirect；`Cache-Control: max-age=3600` |
| URL 轉換錯誤 | `width=300` 路徑變换在真實 URL 上有效，瀏覽器自然寬度 320 |
| CSP `img-src` 阻擋 | `server.py` 與 `index.html` 找不到任何 `Content-Security-Policy` / `img-src` 設定 |
| CORS | `<img>` 不需要 CORS；實測成功載入 |
| `crossorigin` / `loading="lazy"` | 卡片用 `loading="lazy"`，但 DOM 中根本沒有 `<img>`，與 lazy 無關 |
| 圖片 URL query/fragment 遺失 | 119 張真實 URL 都沒有 query/fragment；本輪不是此因（上一輪已另修） |

### 2.6 仍待確認（尚待確認）

- 官方文件在我們查閱的 `/models`、`/model-versions` 頁面只說明 `/images` 的 `nsfwLevel` 是字串（`None/Soft/Mature/X`）與 `browsingLevel` bitmask；**未提供 `/models` 圖片物件中數字 `nsfwLevel` 的對照表**。不能自行宣布 `1` 代表安全。
- 另一種解法是改用 `GET /images?modelVersionId=` 的字串 `nsfw`/`nsfwLevel`，但這會增加請求，且與「版本對應圖片」的既有設計需重新確認。
- 成熟內容開啟時仍有 1 張卡顯示佔位，可能是該版本沒有图片或 url 被過濾；本輪未逐張追查。

---

## 3. Civitai 登入與授權（B）

### 3.1 官方支援方式（官方文件記載）

| 項目 | 官方說法 |
|---|---|
| 第三方登入 | **OAuth 2.0 Authorization Code + PKCE**，S256 強制，含 refresh token；端點在 `https://auth.civitai.com/api/auth/oauth/*`（舊 `civitai.com/api/auth/oauth/*` 會 308 導向） |
| 是否可用個人 API Key | 可以，但官方明確建議：**自己在腳本用 API Key；第三方 app 讓其他使用者登入請用 OAuth**。API Key 是帳號層級、無細粒度 scope |
| 註冊 | `civitai.com/user/account` → OAuth Apps 自我服務建立 `client_id`／選擇 confidential 或 public；redirect URI 需**逐字完全比對**，`localhost` 不需要 HTTPS |
| 端點 | `GET/POST /authorize`、`POST /token`（authorization_code / refresh_token）、`POST /revoke`、`GET /userinfo` |
| 生命週期 | access token 1 小時、refresh token 30 天、authorization code 10 分鐘單次 |
| 撤銷 | 使用者可從 Civitai「Connected Apps」自行撤回；confidential client 可呼叫 `/revoke`；public client 只能本地丟棄 token |
| Scope | bitmask；`UserRead`(1) 永遠授予；**`ModelsRead`(4) = Browse & download models**；download 場景只需 `UserRead | ModelsRead = 5`，不應要求 AIServices/Buzz 等花錢權限 |
| 速率 | `/authorize` >10 次/分鐘/使用者→429；`/token`、`/revoke` 20 次/分鐘/IP |
| 登入≠授權 | 官方流程要求**使用者在 consent 畫面明確同意**；瀏覽器已有 Civitai session 只是讓登入步驟更快，不能當成 Sid-simple-ui 已取得 token |

### 3.2 登入前後功能差異（合理推論，需實作時驗證）

| 功能 | 未登入 | 已登入（UserRead+ModelsRead） |
|---|---|---|
| 公開搜尋／模型資訊／圖片預览 | 可用（現況） | 可用，且可看到該帳號瀏覽等級允許的內容 |
| 收藏／隱藏等 `favorites`/`hidden` 篩選 | 401/不可用 | 可用 |
| 成熟／私人／gated 模型 | 受匿名 public level 限制 | 依帳號 browsing level 與 consent |
| 模型下載 | 部分公開檔可、多數需要 token | 可（官方 CLI 亦以登入為預設） |
| 身分顯示／登出／重新授權 | 無 | 有 |

### 3.3 UI 狀態建議（合理推論）

| 狀態 | 建議呈現 |
|---|---|
| 尚未登入 | 探索中心標題列常駐「登入 Civitai」按鈕＋一行白話說明「登入可解鎖收藏、完整模型資訊與直接下載」；不阻擋搜尋 |
| 正在授權 | 按鈕 disabled＋「正在連到 Civitai…」；callback 完成後回到探索中心 |
| 已登入 | 顯示 Civitai  username（`/userinfo`）+「登出」；下載按鈕出現 |
| 授權失效 | 401/token 過期時自動嘗試 refresh；失敗才顯示「請重新登入」 |
| 權限不足 | 403/insufficient_scope →「這個操作需要額外授權，請重新登入並同意模型讀取權限」 |
| 主動登出 | 本地清 token（confidential client 可呼叫 `/revoke`），回到未登入 |
| 重新授權 | 重新走 `/authorize`，可縮小或擴大 scope |

### 3.4 憑證安全（官方文件記載 + 合理推論）

**不可**放進 localStorage、前端 JS、URL、Git、log 或 API 回傳。建議：

1. 所有 OAuth 交換、refresh、下載都只在 `server.py` 進行；瀏覽器只拿到「已登入／未登入」與非敏感使用者名稱。
2. Token 存在使用者資料目錄，以 **Windows DPAPI（CurrentUser scope）** 加密；或存入 Windows Credential Manager。兩者都綁定目前 Windows 帳號，天然避免不同帳號共用。
3. API Key 若做為備選，也只存後端加密欄位；不提供「貼到前端」的輸入框。
4. 所有錯誤訊息與 log 必須 redact；`?token=` 形式絕對不用（官方也說會進 access log）。
5. 提供「更換／清除授權」與「在 Civitai 撤銷」的明確指引。
6. 最小權限：只申請 `UserRead | ModelsRead`（5），不申請 ModelsWrite/Delete、AIServices、Buzz。

【尚待確認】本專案目前只有 Python 標準庫，沒有加密套件；DPAPI 需透過 PowerShell `ProtectedData` 或 `ctypes` 呼叫。具體實作方式與在 ComfyUI 內嵌 Python 中的可用性需另做隔離驗證。此處不宣稱已解決安全儲存。

---

## 4. 模型下載可行性（C）

### 4.1 真實模型／檔案資料（已驗證事實）

以真實回應為例：

```json
{
  "modelId": 16014,
  "versionId": 28907,
  "name": "v3.0 manga-like",
  "baseModel": "SD 1.5",
  "baseModelType": "Standard",
  "trainedWords": ["lineart, monochrome"],
  "downloadUrl": "https://civitai.com/api/download/models/28907",
  "files": [{
    "name": "animeoutlineV4_16.safetensors",
    "sizeKB": 18541.32,
    "primary": true,
    "metadata": {"format": "SafeTensor"},
    "hashes": {"SHA256": "2FCD88E6AA07B2DB73BEFCA54B3956131E1DECC8E6E719508CE32C28768F9B91", ...},
    "downloadUrl": "https://civitai.com/api/download/models/28907"
  }]
}
```

- 具備 Selenium 之外的完整欄位：model/version id、name、base model、primary file、sizeKB、SHA256（大寫）、trainedWords。
- `downloadUrl` 目前不含 token，是版本号為主的 endpoint。
- HEAD probe（只發 HEAD，**未下載模型**）：匿名與無效 token 都回 `200 application/octet-stream, Content-Length 18,986,312`；代表**這個公開檔**匿名可取得，不能推論所有模型皆可。

【官方文件記載】CLI 文件明確說「**most model files need a token**；gated file 無 token 會 401，部分公開檔可匿名」；建議登入後再下載。

【官方文件記載】CLI 的下載設計可作為參考：primary file、`.part` 暫存＋成功才改名、SHA256 驗證（不符就刪掉暫存）、已存在且 hash 相符就跳過、`--force` 覆寫、`--layout comfyui` 目錄路由、`--for-base` 相容性警告。

### 4.2 ComfyUI 實際 LoRA 目錄（已驗證事實）

用 ComfyUI 內嵌 Python 讀取（不啟動／不重啟服務）：

```text
folder_paths.get_folder_paths("loras")
→ ["C:\\ComfyUI\\ComfyUI_windows_portable\\ComfyUI\\models\\loras"]
```

- 目前只有 **一個** LoRA 目錄。
- `extra_model_paths.yaml` 不存在（只有 `.example` 與 tests 內的範例），所以沒有额外路徑。
- 目前 `/api/loras` 是透過 `_comfy_get_json("/models/loras")` 向 ComfyUI 原生端點查詢（`server.py:405–414, 1499–1511`），**不是自己掃資料夾**。
- 因此：下載到上述實際目錄後，刷新本機清單即可被 ComfyUI 與 simple_ui 同時看到；不應硬編碼 `models/loras`。

### 4.3 現有後端架構（已驗證事實）

| 項目 | 現況 |
|---|---|
| Server | `class S(socketserver.ThreadingMixIn, http.server.HTTPServer)`（`server.py:2072`），`allow_reuse_address=True` |
| 路由 | `H.do_GET` / `H.do_POST` 集中分派（`server.py:1387, 1428`），JSON 用 `_json()`，原始位元組用 `_send()` |
| 背景任務 | 只有 `_purge_loop` daemon thread 與 WD14 `Wd14Worker` subprocess（`server.py:2086, 1301–1302`），**沒有通用下載任務管理器** |
| 進度 | 生圖進度走同源 `/ws` 隧道給 ComfyUI；**沒有可復用的通用進度 channel** |
| 快取 | `_civitai_cache` + lock，TTL 300 秒、上限 300 筆 |
| 安全措施 | 靜態檔白名單、路徑邊界、SHA256 內容比對、同源 header 檢查；可延伸為下載驗證 |

【合理推論】下載 must 用背景任務 + 輪詢 `/api/civitai/download/status?id=...`（或新 WS 事件），避免佔住 HTTP request thread；需要 task id、state、progress、cancel flag、owns-lock、去重 key（versionId+fileName）。

### 4.4 下載風險處理建議（合理推論）

- **進度／取消**：task 物件＋`urllib` 串流寫入 `.part`，定期更新 bytes；cancel 設 flag，關閉連線並刪除 `.part`。
- **中斷/續傳**：可尝试 `Range: bytes=N-`，但 Civitai 是否支援**尚待確認**；不支援就重新下載。
- **錯誤**：401→請登入；403→權限不足；429→讀 `Retry-After` 退避；5xx→重試有限次數；全部轉白話中文。
- **驗證**：API 的 SHA256 是大寫，比對前統一大小寫；大小用 `sizeKB` 比較（注意四捨五入容忍）。
- **暫存／原子移動**：`.part` 與目標同一目錄，成功且驗證後 `os.replace()`；失敗清 `.part`。
- **同名衝突**：目标已存在 → 先比 SHA256；相符就跳過，不符則不靜默覆寫，提示「重新下載／保留原檔」。
- **磁碟空間**：下載前用 `shutil.disk_usage()` 檢查；不足直接拒絕並提示。
- **刷新**：完成後前端呼叫既有 `/api/loras`（或 reload lora list），再引導使用者選取、設權重與觸發詞。
- **不下載圖片**、不建立圖片 DB，不以圖片 URL 做下載來源。

---

## 5. 模型相容性與既有 LoRA 整合（D）

### 5.1 現有判斷（已驗證事實）

- `cvClassify(baseModel, baseModelType, ckptBase)`（`app.js:612–646`）：
  - Illustrious + Standard → `exact`（完全適配）。
  - Illustrious 其他 type、NoobAI、SDXL* → `review`（需要確認）。
  - Pony / SD1.x / SD2.x / SD3.x / Flux* → `bad`（不建議，僅在 ckpt 為 Illustrious 時）。
  - `Other`、缺值、未知 ckpt → `unknown`（需要確認／未知基底）。
- `cvBestVersionInfo()` 回傳最佳版本物件／索引／分類，卡片圖片只取自該版本（Phase 2 已驗證）。
- Checkpoint base 來源是 `identify_checkpoint()`（Civitai 用檔名＋大小精確比對，source=`civitai-exact-file`）；失敗時 `cvCkptBase()` 回 null，所有版本最多只能 `unknown`。
- 分類完全不看模型名稱、標籤或搜尋關鍵字。

### 5.2 下載後的整合（合理推論）

- 下載流程不得改變 `cvClassify()` 規則；相容性徽章沿用既有四級。
- 在「確認下載」畫面顯示：版本 base model、目前 checkpoint base、三態結果（相容／不相容／未知）。**未知绝不可顯示為相容**；不建議與未知可要求使用者勾選「我了解風險」才繼續，但不自動提升等級。
- 本機 LoRA 清單重新整理後，檔案會以 ComfyUI 相對名稱出現在 `/api/loras`；既有 `ui.loras`（`{v, items:[{name, display, strength, triggers, autoTrigger, enabled}]}`）格式不變。
- 既有選取、權重、Trigger Words、autoTrigger、snapshot、`LoraLoader` 節點、歷史與 prompt reuse 全部不變；新功能只「新增下載與刷新」，不改這些流程。

---

## 6. 完整產品 UX 建議（E）

1. **進入探索中心**：仍可直接搜尋；標題列有常駐「登入 Civitai」按鈕，旁邊一行說明登入可解鎖收藏／完整資訊／直接下載。
2. **授權**：點擊 → 後端產生 PKCE verifier + state，2xx 導向 `auth.civitai.com/authorize`（只要求 `UserRead|ModelsRead`）；使用者同意後回到 `http://localhost:7860/oauth/callback?code&state`（redirect URI 需先在 Civitai 註冊）；後端換 token、加密保存，前端只收到登入狀態與 username。
3. **搜尋與瀏覽**：未登入／已登入皆用既有 `/api/civitai/search`；分頁、排序、成熟內容開關不變。
4. **圖片預覽**：修正 unknown 門檻（見第 7 節）；卡片小圖＋詳細多圖，成熟內容未開時 unknown 圖改為模糊＋點擊揭示，而不是完全消失。
5. **選版本**：在既有詳細預覽加入版本選擇；顯示 base model／檔案大小／SHA256／適用 checkpoint。
6. **相容性**：三態徽章＋原因；未知時明確寫「無法判斷，請自行確認」。
7. **確認下載**：顯示檔名、大小、目標目錄（由 `folder_paths` 取得，只顯示可讀描述）、是否已有同名檔。
8. **執行下載**：背景任務，UI 顯示進度條與已下載/總量。
9. **取消**：按取消即中止並清 `.part`。
10. **結果**：成功→「已下載，已加入本機清單」；失敗→白話原因＋下一步（登入／重試／檢查磁碟 space）。
11. **刷新**：呼叫 `/api/loras`，本機清單出現新檔。
12. **直接選取**：在 LoRA 選擇視窗選取，設定權重與 Trigger Words。
13. **生圖**：既有 workflow 與 localStorage 完全不變。

---

## 7. 技術實作建議（未來，非本輪）

| 階段 | 檔案 | 目的 |
|---|---|---|
| 0 修圖片 | `server.py`、`app.js`、`app.css`、`devtools/lora_explorer_api_test.py`、`devtools/lora_ui_test.mjs`、`devtools/lora_mock_civitai.py` | 讓 mock 使用**真實 API 形狀**（無 `nsfw` 布林）；將 unknown 改為可控顯示（模糊＋點擊）或改用官方明確欄位；E2E 加「真實形狀 fixture」 |
| 1 OAuth | `server.py`、`index.html`、`app.js`、`app.css`、新 devtools mock OAuth | 新增 `/api/civitai/auth/start|callback|status|logout`；server-side token store（DPAPI）；前端登入狀態列與按鈕 |
| 2 下載 | `server.py`、`app.js`、`app.css`、新背景 task 模組／測試 | `/api/civitai/download/start|status|cancel`；`.part`＋SHA256＋原子移動；寫入 `folder_paths` LoRA 目錄；完成後刷新 `/api/loras` |
| 3 打磨 | 既有測試 | 相容性三態文案、同名更新、錯誤地圖、取消競態、磁碟不足 |

不新增前端框架、外部 CDN、Python 第三方套件；不新增圖片下載或圖片 DB。

---

## 8. 風險與未解決問題

1. **數字 `nsfwLevel` 語意無官方對照表**（尚待確認）：目前保守做法直接造成正式環境看不到圖，必須先修。
2. **`127.0.0.1` 是否可註冊為 redirect URI**（尚待確認）：官方範例是 `http://localhost:...`；需實際註冊測試，必要時改用 `localhost:7860`。
3. **OAuth token 是否可直接用於 `/api/download/models/*`**（尚待確認）：官方 scope 文件說 `ModelsRead` 涵蓋下載，但本輪沒有真實 token 可驗證；HEAD probe 不能證明 gated 模型行为。
4. **續傳（Range）支援**（尚待確認）：需對實際 CDN 驗證。
5. **Civitai 條款／自動化 downloading 限制**（尚待確認）：量大時可能觸發 429 或風控。
6. **未註冊/未驗證 OAuth app** 的 consent 畫面會對使用者顯示警告，影響信任感；需考量申請 verification。
7. **Windows 加密儲存細節**（尚待確認）：DPAPI 呼叫方式需隔離驗證；服務帳號/不同 Windows 使用者不能共用 token。
8. **多功能並發**：下載與生圖同時進行時的磁碟 I/O 與 GPU 無直接衝突，但需避免大量並發下載。
9. **多 LoRA 目錄**：目前只有一個；若使用者日後新增 `extra_model_paths.yaml`，需重新以 `folder_paths` 為準，不可寫死。
10. **正式服務 PID 在兩次觀察間不同**（已驗證事實）：本輪前後分別看到 7860 / 8188 監聽 PID 不同（先前 16308/13104，本次 13424/12196）。本 agent **沒有**執行任何服務停止或重啟；推測為外部控制台／使用者操作，已如實記錄。

---

## 9. Git 與正式環境狀態（已驗證事實）

| 項目 | 調查前 | 調查後 |
|---|---|---|
| branch | `main...origin/main [ahead 1]` | 同 |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` | 同 |
| remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` | 同 |
| tracked modified | 11 個（Phase 2 的 7 個 + 既有控制台 4 個） | 同 |
| untracked | 17 項（含研究報告與 Phase 2 報告） | 17 項 + 本報告 |

- 沒有 stage / commit / push / reset / restore / stash / checkout / clean。
- 沒有修改任何正式程式碼、設定、localStorage、模型、輸出圖片或 Workflow。
- 沒有安裝/更新依賴，沒有建立或修改 API Key。
- 只開過一個瀏覽器分頁進行只讀觀察，事後已關閉；沒有要求使用者手動複製錯誤訊息。
- 正式 7860 / 8188 全程未被本 agent 停止或重啟（PID 變化見第 8 節第 10 點）。

---

## 10. 建議的實作階段與依賴

| 階段 | 內容 | 可獨立驗收 | 依賴 |
|---|---|---|---|
| **S0 圖片可用性修復** | 真實形狀 fixture + unknown 顯示策略 | 正式 UI 在未登入／成熟內容關閉時能看到圖片；mock/E2E 用真實資料形狀 | 無（最優先） |
| **S1 OAuth 登入（讀取）** | app 註冊、PKCE、token 加密保存、登入狀態 UI | 可登入／登出／顯示 username；token 不出現前端；未登入仍可搜尋 | S0 建議先做，避免 UX 混淆；非技術硬性依賴 |
| **S2 下載 MVP** | 背景任務、`.part`、SHA256、原子移動、取消、刷新清單 | 隔離 mock 可下載一個 .safetensors 到 temp 目錄並出現在清單；真環境需小檔案人工驗收 | S1（多數檔案需要 token） |
| **S3 完善** | 同名更新、429/401 地圖、磁碟檢查、相容性三態文案 | 各錯誤情境都有白話提示；既有 LoRA 功能回歸全過 | S2 |

**最重要順序**：S0 必须优先。目前即使完成 OAuth 與下載，圖片仍全部不見，探索體驗依然失敗。

---

## 11. 完成後動作

本輪到此停止，**不開始實作、不安排下一階段開發**。等待 ChatGPT 直接讀取本報告、程式碼、Network 證據與 Git 狀態進行獨立審查。
