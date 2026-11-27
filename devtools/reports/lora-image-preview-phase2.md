# LoRA 探索中心圖片預覽 Phase 2 — 交付報告

## 1. 任務目標

為既有 LoRA 探索中心加入 Civitai 圖片預覽：

- 搜尋結果卡片顯示小型縮圖（64×80、4:5）。
- 點擊卡片圖片或預覽入口開啟精簡詳細預覽（主圖 180×225、縮圖 48×60、最多 8 張）。
- 詳細預覽可切換多圖，並顯示名稱／作者／版本／Base Model／適配狀態／Trigger Words／Civitai 版本連結。
- **圖片必須與決定卡片適配等級的版本一致**，不跨版本混用。
- 不改變既有四級適配規則、搜尋分頁、本機 LoRA 選取／權重／Trigger Words／`ui.loras`／生圖 Workflow／歷史紀錄。
- 不新增 API、後端 Proxy、圖片資料庫、localStorage key、前端框架或第三方依賴。

本輪為實作＋隔離測試，**未 Commit / Push、未重啟或操作任何正式服務**。

---

## 2. 起始 Branch / HEAD / 工作區狀態

【實際重新確認】

| 項目 | 值 |
|---|---|
| branch / upstream | `main...origin/main [ahead 1]` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| 與遠端差距 | `1 0` |
| 原有 tracked 修改（未動） | `devtools/test_ui_control_wd14.ps1`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw` |
| 原有 untracked（未動） | 15 份 reports + `devtools/test_ui_control_process.ps1` + `devtools/test_ui_panel_reporting.py`，以及上一輪的 `devtools/reports/lora-image-preview-research.md` |

已閱讀 `C:\ComfyUI\AGENTS.md`、`simple_ui\AGENTS.md`，並重新閱讀 `lora-image-preview-research.md`；實際程式碼與報告所述一致（ `_normalize_civitai_item()` 原本確實丟棄 `images[]`）。所有 Git 查詢都用 `git -C C:\ComfyUI\simple_ui`。

---

## 3. 修改／新增檔案清單

| 檔案 | 狀態 | 目的 |
|---|---|---|
| `server.py` | 修改 | 新增圖片中繼資料白名單正規化（HTTPS + CDN host、縮圖变换、每版本上限 8、NSFW 明確旗標），並在每個 version 回傳 `images[]` |
| `app.js` | 修改 | 新增 `cvBestVersionInfo()`、圖片 URL 驗證／可見性判斷、卡片縮圖、詳細預覽 Modal、兩段式失敗降級與事件清理 |
| `app.css` | 修改 | 新增 `.cv-thumb` / `.cv-card-main` / `.cv-pv-*` 固定尺寸樣式，沿用既有 CSS 變數 |
| `devtools/lora_explorer_api_test.py` | 修改 | 後端正規化隔離測試（正常／缺欄位／空／非陣列／無效 URL／NSFW／上限／版本隔離／API 相容） |
| `devtools/lora_explorer_core_test.mjs` | 修改 | 純資料層測試納入 `cvBestVersionInfo`，新增版本對應與穩定順序測試 |
| `devtools/lora_ui_test.mjs` | 修改 | 擴充既有隔離 E2E：卡片圖片、無圖、詳細預覽、切圖、NSFW 隱藏、失敗降級、關閉清理 |
| `devtools/lora_mock_civitai.py` | 修改 | mock 新增 `images` 查詢案例（含成熟圖片與無圖片模型），供 UI 測試使用 |
| `devtools/reports/lora-image-preview-phase2.md` | 新增 | 本報告 |

**未修改**：`index.html`、`tags.js`、`dict.js`、`tag_categories.js`、`ui_control.ps1`、`ui_panel.*`、既有 16 份 reports、Workflow、任何模型或使用者資料。

---

## 4. 每個檔案的修改目的（細節）

### `server.py`

- 新增常數：`_CIVITAI_IMAGE_HOSTS = {"image.civitai.com"}`、`_CIVITAI_THUMB_WIDTH = 300`、`_CIVITAI_MAX_IMAGES = 8`。
- `_civitai_image_urls()`：用 `urllib.parse.urlsplit/urlunsplit` 解析；只收 `https`、host 白名單、port 443/無、無 userinfo、無 `..` 路徑段；只在路徑段**完全等於** `original=true` 時替換成 `width=300`，其餘情況 `thumb = original`（安全退回原圖）。不做任意字串拼接。
- `_normalize_civitai_images()`：只收 `dict` 且 `type === "image"`；保留 `id/url/thumb/width/height/nsfwLevel/mature/unknown`；最多 8 張；其餘欄位（`meta`、`hash`、prompt、description）一律不回傳。
- `_normalize_civitai_item()` 每個 version 增加 `images`，並更新 docstring（不再宣稱完全不回傳 images）。

### `app.js`

- `cvBestVersionInfo(versions, ckptBase)` 回 `{version, index, cls}`；`cvBestVersion()` 改為呼叫它，分級與排序行為不變。
- `cvImageUrl()` 前端再驗證一次 URL（HTTPS + `image.civitai.com` + port + userinfo + 路徑）。
- `cvImageVisible()` / `cvPickImage()`：成熟／未知標記與模型 `nsfw` 保守判斷；圖片只從指定版本挑選。
- `cvRenderCard()`：左側固定 64×80 縮圖盒， cover 只取自 `bestInfo.version`；無圖用同一個 `.cv-thumb-none` 佔位；其餘文字欄位與版本列表完全保留。
- `cvOpenPreview()` / `cvPaintPreview()` / `cvPreviewHtml()` / `cvPreviewImageError()`：用既有 `openModal()` 開詳細預覽；縮圖條事件用新的 DOM 容器單次綁定（不累積）；主圖兩段式降級。
- `closeModal()` 加上 `PV` 守衛：關閉時清空主圖 `src` 並解綁縮圖條事件。
- `#cvResults` click handler 增加 `[data-cv-preview]` 分支；`renderExplore()` 重繪後對新卡片 img 綁 error 降級。

### `app.css`

- 卡片：`.cv-card-main`（flex）、`.cv-thumb`（64×80、`object-fit: cover`、絕對定位 img、固定佔位）、hover 只改 `border-color`。
- 詳細預覽：`.cv-pv`（兩欄 grid）、`.cv-pv-stage`（180×225）、`.cv-pv-main`、`.cv-pv-strip`、`.cv-pv-thumb`（48×60）、失敗時 `.failed::after` 顯示「預覽圖暫時無法載入」。全部使用既有設計變數。

### 測試檔

見第 10 節。

---

## 5. 圖片資料正規化設計

```
Civitai /models → modelVersions[i].images[]
        ↓ server._normalize_civitai_images()
   version.images[]（每版本最多 8）
        ↓ /api/civitai/search
   CV.items[i].versions[j].images
        ↓ cvPickImage(bestInfo.version, ...)
   卡片 cover / 詳細預覽 images
```

- **以版本為單位**：`images` 寫在每個 version 物件內，不往上合併到 model。
- **URL 安全**：HTTPS + host allowlist + 結構化解析；縮圖只做 `original=true` → `width=300` 的路徑段替換；查詢字串完全保留原樣、不附加 `?width=`。
- **原圖保留**：`url` 是驗證過的原始 URL，`thumb` 是变换結果（失灵時等於 `url`）。
- **不下载、不代理、不建檔、不進 DB、不進 localStorage**；沿用既有 300 秒 `_civitai_cache`。

---

## 6. 圖片版本對應方式

- 新增 `cvBestVersionInfo()`：逐一以既有 `cvClassify()` 計算，只有 `c.level < best.level` 才替換，因此**同級保持原順序**、四級規則不變。
- 卡片適配等級、適配原因、以及 cover 圖片都來自同一個 `bestInfo.version`；當最佳版本沒有可顯示圖片時，顯示佔位，**不會拿其他版本的圖補位**。
- E2E 明確驗證：最佳版本（Illustrious）的 cover 是 `/1.jpeg`，不是另一個 Pony 版本的 `/99.jpeg`。

---

## 7. UI 與圖片尺寸實際結果

【E2E 實際量測，1920×1080、隔離 Chrome】

| 項目 | 最小值 | 實際 |
|---|---|---|
| 卡片縮圖容器 | 約 64×80 | **64×80**（`.cv-thumb` 含 border） |
| 詳細主圖容器 | 約 180×225 | **180×225**（`.cv-pv-stage`） |
| 詳細縮圖按鈕 | 約 48×60 | **48×60** |
| 每版本圖片數上限 | 8 | 8（後端測試驗證） |
| 整頁捲動 | 不捲動 | 既有 1920×1080 測試通過，新增圖片後仍通過 |
| Console 錯誤 | 0 | 0 |

詳細預覽使用既有 `#modal` / `dialogStack`，**不是** `#lightbox`；沒有「刪除本機圖／同種子／同提示詞」等按鈕。

---

## 8. NSFW 處理

- **模型層**：`item.nsfw` 仍照舊顯示「成熟內容」標記；`cvNsfw` 未勾時，模型標為成熟的不顯示圖片。
- **圖片層**：後端保留明確旗標 `nsfw === true`、`minor`、`poi`、字串 `Mature/X` → `mature: true`；完全沒有 `nsfw` 布林也沒有 `nsfwLevel` → `unknown: true`。
- **不解讀 `nsfwLevel` 的 bitmask 語意**（數字 1/2/4/8/16 只原樣保留為 `nsfwLevel`，不參與安全與否的判斷）。**沒有 `nsfw` 布林時，即使有數字或未知字串 `nsfwLevel`，一律 `unknown: true`**；只有明確 `nsfw:false` 且無其他成熟標記才算非成熟。明確成熟標記優先於 `nsfw:false`。
- `CV.nsfw=false`：`mature` 或 `unknown` 的圖片一律不進卡片／詳細預覽；`CV.nsfw=true`：才顯示。此規則未變動。
- 不讀取、不改變既有 `adult` localStorage；搜尋仍由既有 `cvNsfw` 控制後端 `nsfw=true/false`。

E2E 驗證：成熟內容關閉時，詳細預覽只出現 2 張縮圖（第 3 張標 `nsfw:true` 被隱藏）。

---

## 9. 圖片失敗降級策略

1. 卡片縮圖 `loading="lazy" decoding="async"`，attr 固定 `width=64 height=80`，即使失敗也不撐動版面。
2. 卡片 img `error`：第一次改載 `data-cv-fallback`（原圖）；第二次 `hidden = true`，由固定 `.cv-thumb-ph`「無預覽」佔位接管。
3. 詳細主圖 `error`：第一次改載原圖；第二次 `removeAttribute("src")` 並加 `.failed`，顯示「預覽圖暫時無法載入」。
4. 詳細縮圖條 `error`（capture 階段）：第一次退回原圖；因事件綁在新建立的 `#pvStrip` 上，重複開啟不會累積。
5. 關閉 Modal 時清空 `#pvMain` 的 `src`、解綁 `#pvStrip.onclick`、重置 `PV`。
6. 任何圖片失敗都不會清除搜尋結果、不彈錯誤 toast、不影響適配分類與 Civitai 連結。

以上四條路徑（卡片兩段、主圖兩段、詳細縮圖、關閉清理）都有 E2E Assertion。

---

## 10. 測試項目及實際結果

### D4 基礎檢查（實際執行）

```text
node --check app.js                              → 通過（無輸出）
node --check devtools/lora_ui_test.mjs            → 通過
node --check devtools/lora_explorer_core_test.mjs → 通過
python -m py_compile server.py                    → 通過
python -m py_compile devtools/lora_explorer_api_test.py → 通過
python -m py_compile devtools/lora_mock_civitai.py     → 通過
git diff --check                                 → 無輸出
```

### D1 後端隔離測試（實際執行）

`python devtools/lora_explorer_api_test.py` → **32 tests passed**（原 25 + 本任務新增 7，含審查修正新增 2；最終數字以第 16 節為準）。新增項目：

- 多張上限 8、縮圖 `width=300`、原圖保留、非 `original=true` 路徑退回原圖。
- NSFW 明確／未知標記、數字 `nsfwLevel` 不猜 bitmask。
- 缺 `images`／空陣列／非陣列皆安全回 `[]`。
- `http:`／其他網域／`javascript:`／userinfo／路径遍歷／非 443 port／非 image 類型全部拒絕。
- 模型與版本圖片不混淆、原有 API 欄位相容（top-level 仍無 `images`/`description`）。

### D2 前端純資料測試（實際執行）

`node devtools/lora_explorer_core_test.mjs` → **18 tests passed**（原 14 + 新增 4）。新增：`cvBestVersionInfo` 版本／索引／分類一致、同級穩定順序、空版本／無圖片保守回退、未知 Checkpoint 仍 `unknown`。

### D3 前端 UI 測試（實際執行）

隔離架構（未碰正式服務）：`lora_mock_comfy.py --port 18188`、`lora_mock_civitai.py --port 18189`、ComfyUI 內嵌 Python 跑的 `server.py` `--SIMPLE_UI_PORT=7861`（獨立 `SIMPLE_UI_LOG_DIR` / `WD14_TMP`），headless Chrome CDP。

`node devtools/lora_ui_test.mjs --ui http://127.0.0.1:7861 --mock http://127.0.0.1:18188 --mockcv http://127.0.0.1:18189 --capture <temp>/cap.jsonl` → **53 UI tests passed**（原 45 + 本任務新增 8，含審查修正新增「成熟內容開啟時顯示成熟與未知圖片」；最終數字以第 16 節為準）。新增：卡片 64×80／原圖降級 URL／無圖佔位／最佳版本圖片、詳細 180×225＋48×60／資訊與成熟圖隱藏、縮圖切換、兩段式失敗降級、卡片兩段式降級、關閉清理、成熟模式顯示。既有搜尋、分頁、成熟內容開關、未知 Checkpoint、原有 LoRA 選取／權重／Trigger Words／歷史還原、Console 0 錯誤全部回歸通過。

### 其他回歸（實際執行）

- `node devtools/lora_core_test.mjs` → **17 tests passed**。
- `python devtools/lora_api_test.py` → **15 tests passed**。

---

## 11. 未執行測試及原因

| 未執行 | 原因 |
|---|---|
| 正式 7860 / 8188 上的真實 Civitai 搜尋與真實 CDN 圖片載入 | 本輪沒有正式服務操作授權；任務禁止連正式服務與大量抓圖。研究階段已用少量公開 Range 請求驗證過 `width=300` 变换 |
| 正式生圖／GPU 測試 | 任務明確禁止，且本次改動不涉及 Workflow |
| 其他解析度（如 1366×768、2560×1440）下詳細預覽量測 | 本輪只沿用既有 1920×1080 版面測試；未在額外解析度量測詳細 Modal |
| 鍵盤 `←/→` 切換詳細預覽 | 未實作（現有快捷鍵仍只服務本機 `#lightbox`），因此無測試 |
| 真實 NSFW 數值 bitmask 對照 | 官方文件未提供對照表，本輪刻意不解讀，故無可測 |

---

## 12. Git 最終狀態

- branch：`main...origin/main [ahead 1]`；HEAD 仍為 `cf5609e0cfbd69163247786f1f50dbf8e600c090`。
- 本次修改 7 個檔案：`app.css`、`app.js`、`server.py`、`devtools/lora_explorer_api_test.py`、`devtools/lora_explorer_core_test.mjs`、`devtools/lora_mock_civitai.py`、`devtools/lora_ui_test.mjs`。
- 原有 4 個 modified（`test_ui_control_wd14.ps1`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`）**完全未動**。
- 原有 untracked 全部保留；新增本報告一個 untracked 檔。
- 沒有 commit / push / stage / reset / restore / stash / checkout / clean。

> 交付前已用 `git -C C:\ComfyUI\simple_ui status -sb` 覆核；本節以該輸出為準。

---

## 13. 正式服務影響

- **沒有**停止或重啟 ComfyUI（8188）、simple_ui（7860）或 WD14 Worker。
- 隔離測試服務（18188 / 18189 / 7861）已全數停止，port 已釋放；正式 7860（PID 16308）與 8188（PID 13104）全程正常監聽、未被觸碰。
- 沒有修改正式環境依賴、設定、模型、Workflow、使用者圖片或輸出資料。
- 沒有部署、沒有大量生成圖片、沒有高負載測試。

---

## 14. 尚未解決問題及風險

1. **`width=300` 变换非官方合約**：目前有兩段式降級，但未来 Civitai 改變路径规则時，卡片會退回原圖（較大、較慢）。可考慮改用官方支援的參數（尚待確認）。
2. **NSFW 數字等級語意未對照（已修正取捨）**：數字 `nsfwLevel` 原樣保留但不參與安全判斷；沒有 `nsfw` 布林時一律視為 `unknown`，成熟內容關閉時隱藏。代價是部分實際上 SFW 的圖片會被隱藏，但符合「不猜測 bitmask」的保守原則。
3. **詳細預覽沒有鍵盤 `←/→` 切圖**：只能點縮圖；既有 `←/→` 仍保留給本機燈箱，避免衝突。
4. **卡片 cover 使用 `width=300`（約 68 KB）而非更小尺寸**：20 張卡皆 lazy loading，實測可接受；若要再降可改后端寬度常數，但需重新驗證。
5. **真實 CDN 圖片未在正式環境驗證**：本輪 UI 測試使用 mock URL；真實圖片行為僅由研究階段的少量 Range 請求佐證。
6. **`closeModal()` 增加 `PV` 守衛**：属通用函式的小幅改動；既有 45 項 UI 測試（含多種 Modal）已全部回歸通過，但仍建議審查時留意。
7. **既有未提交修改仍在工作區**：本輪沒有合併或整理，審查時請以 `-C C:\ComfyUI\simple_ui` 区分本次 7 個檔案與原有 4 個 modified。

---

## 15. 完成後動作

已完成實作、隔離測試與本報告，**立即停止**。不 Commit、不 Push、不重啟任何正式服務，等待 ChatGPT 直接讀取程式碼、Diff、測試輸出與本報告進行獨立審查。

---

## 16. 獨立審查修正（本輪，最終狀態）

### 16.1 問題一：NSFW「未知」判斷錯誤

**根因**：原程式 `unknown = not isinstance(nsfw, bool) and level is None`，把「沒有 `nsfw` 布林、但有數字 `nsfwLevel`」的圖片同時判定為 `mature=false`、`unknown=false`，等於把數字等級當成安全等級，與「不猜測 bitmask」矛盾；既有測試甚至用這種圖片當安全資料。

**實際修正**（`server.py` / `devtools/lora_explorer_api_test.py` / `devtools/lora_mock_civitai.py` / `devtools/lora_ui_test.mjs`）：

```python
mature = (nsfw is True or bool(img.get("minor")) or bool(img.get("poi")) or
          (isinstance(level, str) and level.strip().lower() in ("mature", "x")))
unknown = not isinstance(nsfw, bool) and not mature
```

- 明確成熟標記（`nsfw:true` / `minor` / `poi` / 字串 `Mature`、`X`）優先於 `nsfw:false`。
- 沒有 `nsfw` 布林時，不論 `nsfwLevel` 是數字還是未知字串，一律 `unknown=true`；完全沒有 NSFW 資訊亦同。
- 前端 `cvImageVisible()` 完全未改；`CV.nsfw=false` 時仍舊同時隱藏 `mature` 與 `unknown`。
- mock fixture 的「安全圖片」改為明確帶 `nsfw:false`；另加成熟（id 3）與未知（id 4，只有 `nsfwLevel:16`）圖片；成熟模式另回傳獨特標記項目 `Image Nsfw Mode`，讓 E2E 能可靠等待新回應。

**新增測試（全部實際通過）**：

- `nsfwLevel=1` 且無 `nsfw` → `unknown=true, mature=false`。
- `nsfwLevel=16` 且無 `nsfw` → `unknown=true, mature=false`。
- 未知字串 `nsfwLevel` 且無 `nsfw` → `unknown=true, mature=false`。
- `nsfw:false` + 數字 `nsfwLevel` → `mature=false, unknown=false`。
- `nsfw:true` / `minor:true` / `poi:true` / 字串 `X` → `mature=true, unknown=false`。
- UI：`CV.nsfw=false` 時卡片 cover 是安全圖 `/1.jpeg`、詳細預覽只有 2 張縮圖（成熟 id 3 與未知 id 4 都被隱藏）；`CV.nsfw=true` 時詳細預覽有 4 張縮圖，包含 `/3.jpeg` 與 `/4.jpeg`。

### 16.2 問題二：縮圖 URL 遺失 query string / fragment

**根因**：原变换用 `urlunsplit((scheme, netloc, path, "", ""))`，把原始 query 與 fragment 清空，與交付報告「query string 完全保留」的敘述不一致。

**實際修正**（`server.py`）：改為 `urlunsplit((p.scheme, p.netloc, "/".join(parts), p.query, p.fragment))`；HTTPS、host 白名單、port、userinfo、`..` 路徑檢查與原圖保留全部不變。

**新增測試（實際通過）**：合法 URL
`https://image.civitai.com/signature/id/original=true/example.jpeg?token=abc123&expires=456#frag`
→ 原圖 URL 完整不變、縮圖路徑為 `width=300`、`?token=abc123&expires=456#frag` 完整保留；不帶 query 的既有 URL 行為另由原有測試覆蓋。

### 16.3 本輪實際測試結果（最終數字，覆蓋第 10 節）

```text
node --check app.js                               → 通過
node --check devtools/lora_ui_test.mjs             → 通過
node --check devtools/lora_explorer_core_test.mjs  → 通過
python -m py_compile server.py                     → 通過
python -m py_compile devtools/lora_explorer_api_test.py → 通過
python -m py_compile devtools/lora_mock_civitai.py      → 通過
git diff --check                                  → 無輸出
python devtools/lora_explorer_api_test.py          → 32 tests passed
node devtools/lora_explorer_core_test.mjs          → 18 tests passed
node devtools/lora_ui_test.mjs（隔離 7861/18188/18189） → 53 UI tests passed
node devtools/lora_core_test.mjs                   → 17 tests passed
python devtools/lora_api_test.py                   → 15 tests passed
```

UI E2E 使用 mock Civitai + mock ComfyUI + 獨立 simple_ui port（7861），**沒有連接正式 7860 / 8188**。53 項包含成熟內容關閉與開啟兩種狀態，並驗證未知 NSFW 圖片在關閉時不出現、開啟時出現；既有圖片預览、縮圖切換、兩段式失敗降級、關閉清理、分頁、LoRA 選取／權重／Trigger Words／歷史還原與 Console 0 錯誤全部通過。

### 16.4 最終 Git 狀態與正式服務

- branch `main...origin/main [ahead 1]`；HEAD 仍為 `cf5609e0cfbd69163247786f1f50dbf8e600c090`。
- 本次修改档案共 7 個：`server.py`、`app.js`、`app.css`、`devtools/lora_explorer_api_test.py`、`devtools/lora_explorer_core_test.mjs`、`devtools/lora_mock_civitai.py`、`devtools/lora_ui_test.mjs`；新增本報告。
- 原有 4 個 modified（`devtools/test_ui_control_wd14.ps1`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`）與所有既有 untracked **完全未動**。
- 沒有 commit / push / reset / restore / stash / checkout / clean。
- 隔離服務（18188 / 18189 / 7861）已全數停止、port 已釋放；正式 7860 / 8188 未被停止或重啟，也未修改正式環境依賴、模型、Workflow 或使用者資料。
