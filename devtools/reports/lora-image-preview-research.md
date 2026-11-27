# LoRA 探索中心圖片預覽能力調查 — 唯讀研究報告

> 任務性質：**唯讀調查（Research Only）**。本輪未修改任何正式程式碼、未新增/刪除專案檔案（**本報告是唯一建立的檔案**）、未動作 localStorage、未停止或重啟 ComfyUI / simple_ui / WD14 Worker、未下載模型或大量圖片、未執行 Commit / Push、未清理既有 reports。

## 證據標記約定

| 標記 | 意義 |
|---|---|
| 【已驗證事實】 | 本輪直接讀取目前程式碼，或實際送出少量公開 GET / Range 請求取得的結果 |
| 【官方文件記載】 | Civitai 官方開發者文件 `developer.civitai.com/site/...` 明文記載 |
| 【合理推論】 | 由上述事實推導，尚未經本輪實作驗證 |
| 【尚待確認】 | 官方文件未明文、或本輪未驗證，實作前需再確認 |

---

## 1. Git 起始狀態

【已驗證事實】全部 Git 操作都用 `git -C C:\ComfyUI\simple_ui`，沒有碰 `C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\.git`（上游 ComfyUI）。

| 項目 | 起始值 |
|---|---|
| branch / upstream | `main...origin/main [ahead 1]` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| remote origin | `https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch / push） |
| 與遠端差距 | `1 0`（領先 1、落後 0） |
| tracked 修改 | `M devtools/test_ui_control_wd14.ps1`、`M ui_control.ps1`、`M ui_panel.ps1`、`M ui_panel.pyw` |
| diff 量 | `4 files changed, 377 insertions(+), 76 deletions(--stat)` |
| untracked | 15 份 `devtools/reports/*.md` + `devtools/test_ui_control_process.ps1` + `devtools/test_ui_panel_reporting.py`（共 17 項） |

以上既有修改與 untracked 檔案**完全未觸碰、未清理、未 stage**。若交接基準不同，以本節實際狀態為準。

---

## 2. 現有 LoRA 探索架構（Task 1）

### 2.1 入口、彈窗與狀態

【已驗證事實】

| 項目 | 位置與內容 |
|---|---|
| 進入點 | `index.html:197` 的 `#btnLoraExplore`「探索」；`app.js:2909` 綁到 `cvOpenModal` |
| 彈窗 | `index.html:359–397` 的 `#exploreModal`，`modal-card modal-card-lg`；標題、`#cvCkptInfo`、`.cv-search-row`（`#cvSearch` / `#cvSort` / `#cvPeriod` / `#cvGo`）、`#cvNsfw`、`#cvResults`、`#cvMore` |
| 開關 | `app.js:1945–1957` `cvOpenModal()` / `cvCloseModal()`；關閉時 abort 兩個請求並清 debounce |
| 事件 | `app.js:2908–2928`：搜尋輸入 280ms debounce、Enter、排序/期間/NSFW 變更重新搜尋、`#cvRetry` 重試；`#ckpt.onchange`（2906）觸發 `cvOnCkptChange()` |
| 狀態 | `app.js:36–41` `S.civitai`（ckpt / ckptState / ckptError / query / sort / period / nsfw / items / nextCursor / state / error / seq / AbortController / debounce），`app.js:1816` 別名 `CV` |
| dialog 基礎 | `app.js:119–144` `openDialog` / `closeDialog` + `dialogStack` + `inert`；`app.js:1538–1544` 通用 `openModal(title, html)` / `closeModal()`（寫入 `#modalBody`）；Esc 由 `app.js:3181–3191` 關閉最上層 dialog |

### 2.2 資料流與快取

【已驗證事實】

1. **Checkpoint 辨識**：`cvLoadStatus(force)`（`app.js:1833–1872`）打同源 `GET /api/civitai/status?ckpt=...`；結果放 `CV.ckpt`，`source === "civitai-exact-file"` 表示已用檔案 SHA256 精確比對。
2. **搜尋**：`cvRunSearch(reset)`（`app.js:1892–1938`）打同源 `GET /api/civitai/search?...`（q / sort / period / nsfw / cursor）；用 `AbortController` + `searchSeq` 防止舊回應覆蓋；分頁靠 `CV.nextCursor` 與「載入更多」；錯誤場景有 idle / loading / ready / error 四態。
3. **後端**：`server.py:484–631` 定義 `CIVITAI_API`（預設官方 `https://civitai.com/api/v1`，環境變數可覆寫供隔離測試）、`CIVITAI_TIMEOUT=15`、`CIVITAI_PAGE_LIMIT=20`、`CHECKPOINT_SEARCH_PAGES=3`、sort/period 白名單、`_civitai_get()`、`_normalize_civitai_item()`、`civitai_search()`；路由分派在 `server.py:1335–1338`，handler 在 `server.py:1466–1516`；`_civitai_error()` 把 429 轉 `CIVITAI_RATE_LIMITED`（附 `retryAfter`）、5xx 轉 `CIVITAI_SERVER_ERROR`、`UNREACHABLE` 轉 `CIVITAI_OFFLINE`。
4. **快取**：`_civitai_cache` + `_cache_lock`（`server.py:497–518`），TTL 300 秒、超過 300 筆整包清空；依完整 query 字串作 key；不寫入 localStorage、不落碟。
5. **隔離測試**：`devtools/lora_explorer_core_test.mjs` 用 `CIVITAI_CORE_START/END` 標記擷取純資料層；`devtools/lora_explorer_api_test.py` + `devtools/lora_mock_civitai.py` 用本機 mock，不連正式服務。

### 2.3 版本、Base Model、Trigger Words 與卡片

【已驗證事實】

- 純資料層 `app.js:594–674`（`CIVITAI_CORE`）：`CV_LEVELS`（exact / review / unknown / bad）、`cvClassify()`、`cvBestVersion()`、`cvSortItems()`、`cvStatusKey()`、`cvVersionUrl()`。
- 目前適配規則：`Illustrious + Standard → 完全適配`；`NoobAI / SDXL* → 需要確認`；`Pony / SD1.x / SD2.x / SD3.x / Flux* → 不建議`（僅在目前 Checkpoint 為 Illustrious 時）；其他或 `Other`、缺少 ckpt 基底 → `需要確認（未知基底）`。非 Illustrious Checkpoint 不會套用「不建議」清單。
- 卡片 `cvRenderCard()`（`app.js:1963–1994`）：card head 有模型名、`成熟內容` 標記、作者/下載/喜歡、`best.reason`；版本區逐版顯示 badge、版本名、`基底：...（+ baseModelType）`、`reason`、`觸發詞：`（`trainedWords` 取前 8）、檔案名稱/格式/KB/主要檔、以及 `cvVersionUrl()` 產生的 Civitai 版本連結（`target="_blank" rel="noopener noreferrer"`）。
- 分組 `renderExplore()`（`app.js:1996–2047`）：依適配 level 分 4 組，組標題用 `cv-lv-*`，同級內保留 API 原順序。
- **沒有任何獨立「詳細資訊彈窗」**：所有版本資訊已攤在卡片內；唯一的外部連結是開 Civitai 網頁。
- **沒有任何圖片**：後端 `_normalize_civitai_item()`（`server.py:549–599`）的 docstring 明寫「不回傳 description HTML / images / token」，回給前端的 item 只有 `modelId/name/type/creator/nsfw/nsfwLevel/modelBaseModels/stats/versions/url`，version 只有 `id/name/baseModel/baseModelType/trainedWords/files/downloadUrl`。前端 `cvRenderCard()` 也沒有 `<img>`。

### 2.4 既有燈箱能否直接重用

【已驗證事實】

- `app.js:995–1023`：`openLightbox(list, index)` / `paintLightbox()` / `lbStep()` / `closeLightbox()` 操作 `S.lbList`，每項預期 `{url, filename, w, h, seed}`，並更新 `#lbImg/#lbCount/#lbMeta`。
- `app.js:3142–3149` 的燈箱按鈕是 `下載 / 刪除 / 用同種子 / 用同提示詞 / 按分類套用`，全部是本機生成圖片語意；`app.js:3192–3197` 的 `←/→` 也只在 `#lightbox` 為最上層 dialog 時生效。

【合理推論】直接把 Civitai 外部圖片塞進這個燈箱會讓「刪除本機圖 / 用同種子」等按鈕語意錯誤，且 `w/h/seed/filename` 欄位來源不同；建議改用既有通用 `openModal()` 自訂「模型預覽」內容，不要改動本機燈箱。

**結論：目前唯一阻斷點是後端正規化時丟棄 `images[]`；除此之外，搜尋、分組、適配、觸發詞、快取、錯誤處理與彈窗基礎都已完備，不需要重做。**

---

## 3. Civitai 公開 API 圖片能力（Task 2）

### 3.1 官方文件記載

【官方文件記載】（`https://developer.civitai.com/site/reference/models.md`、`model-versions.md`、`images.md`、`reference.md`、`guide/errors.md`、`guide/getting-started.md`）

1. `GET /api/v1/models`（Auth: **Mixed**，`favorites`/`hidden` 才需要 token）的每個 `modelVersions[]` 含 `images[]`；官方範例即為 `"images": []`。明文註記：「有些圖片基於安全理由不會出現在公開回應；當某版本圖片全被略過時，`images` 是空陣列，不會是 missing / null」；`model.mode = Archived` 會拿掉 `files[]`，`TakenDown` 會清空 `images`。
2. `GET /api/v1/model-versions/{id}`（Auth: **Mixed**）回傳 `images[]`（"preview images, filtered by browsing level"），以及 `baseModel`、`baseModelType`、`trainedWords`、`files`、`stats`、`model`、`nsfwLevel`、`air` 等。
3. `GET /api/v1/model-versions/mini/{id}` 明確**跳過** `images[]`，不適合做預覽。
4. `GET /api/v1/images`（Auth: **Public**）可用 `modelId` / `modelVersionId` 查圖；單張 image 欄位含 `id, url, width, height, type, nsfw(boolean), nsfwLevel(string: None/Soft/Mature/X), browsingLevel(bitmask), hash(BlurHash), postId, thumbnail(video still), meta, modelVersionIds`。匿名者被限制在 public browsing level；green 網域或特定地區會静默只給 SFW。
5. 快取與限制：公開端點設 `Cache-Control: public, s-maxage=300, stale-while-revalidate=150`；**沒有**穩定的 per-endpoint rate limit 合約，Cloudflare 邊緣會擋濫用；429 附 `Retry-After` 與 body `rateLimit`，5xx/429 建議 1→30 秒指數退避；`page * limit > 1000` 也会 429，深頁要用 cursor。
6. 大多數 site API endpoint 無需 token；本專案現有設計「不接受、不保存任何 Token」與此相容。

### 3.2 本輪實際 API 驗證（少量公開 GET / Range，未下載模型、未大量抓圖）

【已驗證事實】

| 驗證 | 結果 |
|---|---|
| `GET /models?types=LORA&limit=1&query=illustrious` | model 1060551 / version 2211883 的 `images` 長度 **0**（與官方「可能被安全過濾成空陣列」一致）；model 最上層**沒有** `images` 欄位 |
| `GET /models?types=LORA&limit=8&query=anime&nsfw=false` | 版本圖片數分別為 16、16、12、9、15、11、3、7、6、10…；**同一版本可有多張圖**，實測最多 16 張 |
| 上述搜尋的第一張圖（version 28907） | `{"id":326152,"url":"https://image.civitai.com/<sig>/<uuid>/original=true/326152.jpeg","nsfwLevel":1,"width":1280,"height":1920,"hash":"UGPjDV…","type":"image","minor":false,"poi":false,"hasMeta":true,…}`；**無 `description` HTML、無 token** |
| `GET /model-versions/28907` | 回傳 10 張圖，含 `url/nsfwLevel/width/height/hash/metadata/meta/availability/minor/poi/…`；版本 `baseModel = SD 1.5`、`baseModelType = Standard`；此端點 response header 是 `Cache-Control: private, no-store` |
| 公開端點 response header | `Cache-Control: public, s-maxage=300, stale-while-revalidate=150`、`cf-cache-status: MISS`；**未觀察到** rate-limit 表頭（與官方「無穩定合約」一致） |
| 圖片 URL 变换（Range `bytes=0-0`） | `original=true` → `image/png`、3,110,272 bytes；把路徑段改成 `width=300` → `image/jpeg`、69,529 bytes（約原圖 2.2%）；`width=1024` → `image/jpeg`、697,428 bytes；`?width=300` **查詢字串無效**（仍為 3.1 MB PNG）；CDN `Cache-Control: max-age=3600` |
| NSFW 數值分布（metadata only） | `nsfw=true` 搜尋中 image `nsfwLevel` 出現 `{1,2,4,8,16}`，model `nsfwLevel` 出現 `{1,5,7,31}`；看起來是 bitmask，但 |

【尚待確認】

- 官方文件沒有明文記載 `image.civitai.com` 的 `width=<n>` **路徑变换**合約；上表是目前實測有效，不能保證永久不變，因此必須做載入失敗降級。
- `nsfwLevel` 數字與 `None/Soft/Mature/X` 的精確對照，以及 `8/16/31` 等旗標意義，本輪 read 過的官方頁沒有對照表。
- 圖片 URL 中簽名字段是否會過期/輪替、過期後確切狀態碼為何，本輪未驗證（只觀察到 `max-age=3600`）。

### 3.3 直接回答 Task 2 的 8 個問題

1. **Model 搜尋 API 是否提供版本圖片？** 【已驗證事實】有，在每個 `modelVersions[].images[]`（不是 model 最上層）。
2. **Model Version API 的圖片欄位？** 【官方文件記載 + 已驗證事實】`images[]`，每張至少含 `url/width/height/nsfwLevel/hash/type`；version detail 另含 `meta`（生成參數/prompt）——**不要**把 prompt/meta 放進 UI。
3. **URL / 縮圖 / 原圖？** 【已驗證事實】`image.civitai.com/.../original=true/<id>.jpeg` 是原圖；把該路徑段換成 `width=300` 可得 ~68 KB JPEG；`?width=` 無效。
4. **寬高 / NSFW？** 【已驗證事實】有 `width/height` 與數字 `nsfwLevel`、`minor/poi`；【官方文件記載】`/images` 另有 boolean `nsfw`、字串 `nsfwLevel`、`browsingLevel` bitmask、BlurHash `hash`。
5. **一個版本多張圖？** 【已驗證事實】是，實測單版本 3–16 張。
6. **能取得與版本正確對應的圖？** 【已驗證事實】能——`images[]` 就嵌在各版本物件內，不需額外請求；也可用官方 `/images?modelVersionId=` 交叉查（本輪未需要）。
7. **權限 / Token / Rate Limit / 匿名？** 【官方文件記載】讀取端點 Public 或 Mixed，匿名可行但瀏覽等級受限；無 token 也能用現有搜尋；429 採退避；現有 `CIVITAI_RATE_LIMITED` + `retryAfter` 已覆蓋。
8. **圖片失效 / CDN 限制？** 【尚待確認 + 已驗證事實】官方會基于安全省略圖片、Archived/TakenDown 會清圖；CDN 有 `max-age=3600`；實測縮圖变换有效。設計上必須把 URL 視為短暫、可失效。

---

## 4. 圖片呈現方案比較（Task 3）

以下「資訊密度 / 載入量」屬【合理推論】，依目前 `#cvResults` 的 `max-height: 56vh`（1080p 約 605px）與 `.modal-card-lg` 的 `min(1060px, 94vw)` 推算；本輪未實際量測新版面。

| 方案 | 操作步驟 | 1920×1080 資訊密度 | 載入 / 記憶體 / 網路 | 快取 | 無圖 / 失敗 / NSFW | 多圖切換 |
|---|---|---|---|---|---|---|
| **A. 卡片直接顯示第一張圖** | 開探索 → 搜尋 → 直接看到圖（1 步） | 最差：20 張卡若放大圖會迅速把 605px 結果區填滿，版本/觸發詞被擠到下方 | 20 張縮圖（懶載可降）；每張卡固定空間，DOM/解碼量中等 | 瀏覽器 HTTP cache + 既有 300s 搜尋快取 | 需 placeholder；成熟圖會直接曝光 | 無（要看其他圖仍需外部連結） |
| **B. 卡片縮圖 + 點擊開多圖詳細預覽（建議）** | 開探索 → 搜尋 → 點縮圖 → 詳細視窗切圖（2 步） | 最佳：卡片維持目前高度，僅左側多一塊固定 64×80 縮圖；詳細資訊移到獨立視窗 | 卡片 20 張小縮圖（懶載）；詳細視窗一次只解碼 1 張主圖 + ≤8 張縮圖 | 同上；不新增儲存 | placeholder + 失敗降級；成熟圖可先模糊、點開才顯示 | 縮圖條 + 上一張/下一張，體驗最好 |
| **C. 縮圖 + hover 快速預覽 + 點擊看完整資訊** | 多一步 hover；觸控/鍵盤較難用 | 中等，但 floating preview 易遮到其他卡 | 除縮圖外，hover 還會觸發額外請求/解碼 | 同上，但快取冷啟動更頻繁 | hover 就可能誤曝光成熟圖，風險最高 | 仍有 B 的詳細視窗，但兩套預覽要維護 |

### 建議：方案 B

理由（對應專案硬限制）：

1. **Hover 不得改變元素尺寸**（AGENTS.md 與根 AGENTS.md 都明確）：C 的浮層/展開最容易踩到閃爍；B 的縮圖是固定盒子，完全不變形。
2. **一屏不捲動 / 結果區自己捲**：B 不增加卡片高度，不用改整頁版面。
3. **已有通用 `openModal()` + `dialogStack`**，可直接承載詳細預覽；不必碰本機圖片燈箱。
4. **NSFW 開關已存在**（`#cvNsfw`，且明確「不改變既有成人標籤設定」）：B 可在詳細視窗做「先模糊、點擊才顯示」，不會在 hover 時誤觸。
5. **最小改動**：只需要在後端多帶 `images` 欄位、前端多一個縮圖函式與一個詳細視窗；不新增 API、不新增依賴、不碰 Workflow / localStorage。

---

## 5. 圖片載入、安全與效能分析（Task 4）

### 5.1 建議做法

| 議題 | 建議 | 依據 |
|---|---|---|
| 是否用縮圖 URL | **是**。卡片用 `width=160`（推論，需實作時確認），詳細主圖用 `width=800~1024`；只用 `type === "image"` 的項目 | 【已驗證事實】`width=300` 68 KB vs 原圖 3.1 MB、`width=1024` 697 KB；【合理推論】160 亦可用 |
| lazy loading | **是**，`<img loading="lazy" decoding="async">`；由 API 的 `width/height` 設定固定 `width/height` 屬性避免 CLS | 【合理推論】；且符合「hover 不改變尺寸」 |
| 同時載入上限 | 初版不需要自訂 limiter：搜尋頁本來就 `limit=20`，且只取每卡第一張；原生 lazy 已足夠。若實測超出再考慮 `IntersectionObserver` | 【合理推論】 |
| 外部 HTML / SVG | **絕對不要**插入。只用 `<img src>`；所有文字仍走 `Dict.esc()` / `esc()`；不要 innerHTML 任何 `meta.prompt`、`description` 或外部 SVG | 【已驗證事實】後端目前就刻意丟掉 description；repo AGENTS.md 要求轉義 |
| URL 驗證 | Strict allowlist：`^https:\/\/image\.civitai\.com\/` 才接受；拒絕 `http:`、`data:`、`javascript:`、其他 host、非 image `type`。即使 URL 来自自家後端也在前端再驗一次 | 【合理推論 + 已驗證事實】實際 host 為 `image.civitai.com` |
| NSFW 控制 | `CV.nsfw=false`：信賴 Civitai 伺服器過濾，且 `model.nsfw===true` 不顯示縮圖；`CV.nsfw=true`：縮圖先模糊 + 點開才顯示。**不讀取也不改變既有 `adult` localStorage** | 【官方文件記載】匿名/public browsing level、SFW 静默過濾；【已驗證事實】`nsfw` 欄位已存在于正規化結果 |
| CDN 不可用降級 | `<img onerror>` → 隱藏圖片、顯示固定大小「預覽圖暫時無法載入」placeholder；卡片文字、適配 badge、Civitai 連結完全不受影響；不要彈錯誤 toast | 【合理推論】 |
| 後端 Proxy | **不需要**。瀏覽器直接載入 `https://image.civitai.com/...`（http localhost 頁面載 https 圖片沒有 mixed-content 問題）；可避免後端頻寬、SSRF、新路由與新服務 | 【合理推論】；且任務禁止建立不必要的圖片下載服務 |
| 快取策略 | 沿用瀏覽器/CDN `max-age=3600` 與後端既有 300 秒 `_civitai_cache`；**不新增** DB、檔案快取或 localStorage key | 【已驗證事實】兩層快取都已存在 |

### 5.2 明確不做

- 不新增 `/api/...` 圖片下載路由、不新增圖片快取資料夾、不把圖片 URL 寫入 localStorage 歷史。
- 不引入前端框架、外部 CDN、套件或 build step；不改變 `index.html` 的腳本載入順序（目前只有 `dict.js → tags.js → tag_categories.js → app.js`，【已驗證事實】`index.html:434–437`）。

---

## 6. 與既定適配規則整合（Task 5）

【已驗證事實】`cvClassify()` 目前完全不依賴圖片，規則如第 2.3 節。建議：

1. **圖片不得參與分級**。即使預覽圖看起來是某種畫風，也不能提升或降低 `CV_LEVELS`；未知 Base Model 仍是「需要確認」，Illustrious Standard 仍是「完全適配」。
2. **卡片欄位配置建議**（由左至右、由上而下）：

   ```
   ┌────────┬──────────────────────────────────────────────┐
   │ 固定   │ 模型名稱 [成熟內容]                          │
   │ 64×80  │ 作者 · 下載 · 喜歡                            │
   │ 縮圖   │ [適配 badge] reason                           │
   │        │ 版本區：badge / 版本名 / 基底 / 觸發詞 / 檔案  │
   └────────┴──────────────────────────────────────────────┘
   ```

   對應來源：`item.name`、`item.creator`、`item.stats`、`v.name`、`v.baseModel(+baseModelType)`、`cvBadge(lv)` + `c.reason`、`v.trainedWords`。全部沿用 `esc()`。

3. **縮圖要對應到「決定卡片等級的那個版本」**。【已驗證事實】目前 `cvBestVersion()` 只回傳分類物件，不回傳是哪個版本；【合理推論】若直接拿 `versions[0]` 的圖，可能出現「卡片標完全適配、縮圖卻來自另一版本」的落差。建議把 `cvBestVersion()` 擴成同時回傳版本索引（或新增一個小 pure helper），並在既有 `lora_explorer_core_test.mjs` 加新房牆測試；這仍屬於 `CIVITAI_CORE` 純資料層，不碰 DOM。
4. **不影響選取/權重/觸發詞/localStorage/生圖**。探索中心目前是唯讀（【已驗證事實】沒有寫 localStorage、沒有呼叫 lora 加入函式）；預覽詳細視窗只提供「在 Civitai 開啟這個版本 ↗」與 shrink/關按鈕，不新增「直接加入本機 LoRA」之類動作。

---

## 7. 建議 UI 方案（方案 B 具體流程）

1. **後端**：在 `_normalize_civitai_item()` 的每個 version 增加白名單化的 `images`（最多取前 8～12 張）：
   `id / url / width / height / type / nsfwLevel / minor / poi`；其餘（`hash`、`meta`、prompt、description）**不回傳**。
2. **卡片**：`cvRenderCard()` 左側加入固定尺寸縮圖盒；用 best version 的第一張 `type === "image"` 圖片，經 URL validate + `width=160` 变换；載入失敗顯示 placeholder。佔位盒子即使在無圖時也保留固定尺寸，避免版面跳動。
3. **詳細視窗**：點縮圖呼叫通用 `openModal("模型預覽…", html)`（`#modal`，不是 `#lightbox`），內容含：主圖 `width=800`、縮圖條（≤8）、目前版本的名稱/基底/適配 badge/reason/觸發詞、既有 Civitai 版本連結、關閉按鈕。用 `event delegation` 綁在 `#modalBody`；Esc / `[data-close]` 沿用現有行為。
4. **多圖切換**：點縮圖條換主圖；`←/→` 目前只服務 `#lightbox`（【已驗證事實】`app.js:3192–3197`），若要做需另加限定條件（例如「`#modal` 是最上層且處於預覽模式」），或先只提供點擊切換並在報告中列為已知小缺口。
5. **成年內容**：`#cvNsfw` 未勾時不顯示 `model.nsfw` 為真的縮圖；勾選時縮圖模糊、點詳細視窗才清晰。不觸及 `adult` key。

---

## 8. 預計修改檔案與實作計畫（Task 6）

> 以下為**建議**，本輪完全沒有執行。

| 檔案 | 修改目的 | 風險 |
|---|---|---|
| `server.py` | 僅在 `_normalize_civitai_item()` 增加 images 白名單欄位（含 URL host/type 驗證與數量上限）；**不改路由、不新增 API、不新增 token、不新增圖片服務** | 低：回傳格式是「新增欄位」，前端舊版忽略即可；既有 API 測試的 mock 沒有 images 時要視為空陣列 |
| `app.js` | (a) `cvBestVersion()`/新增 helper 回傳最佳版本索引；(b) `cvRenderCard()` 加固定縮圖盒 + 點擊Delegation；(c) 新增 `cvOpenPreview()` 用既有 `openModal()` 做多圖詳細視窗；(d) 在 `app.js:2926` 的 `#cvResults` click handler 加一條分支；(e) URL 驗證 / 縮圖变换 / onerror 降級 | 中：需回歸探索中心核心測試與既有 modal/Esc 行為 |
| `app.css` | 新增 `.cv-thumb` / `.cv-thumb-ph` / `.cv-preview-*` 少數 class，一律用現有 CSS 變數；固定尺寸、hover 只改邊框或透明度、不改 box size | 低 |
| `devtools/lora_explorer_core_test.mjs` | 為「最佳版本索引」與「挑選可顯示圖片」加 pure 測試 | 低 |
| `devtools/lora_explorer_api_test.py`、`devtools/lora_mock_civitai.py` | mock 加入合法/惡意/空 images 案例，驗證後端白名單、URL host 限制、無圖降級 | 低 |
| `devtools/lora_ui_test.mjs`（或新增一個隔離 UI test） | 1920×1080、100% DPI 量測：整頁不捲動、`#cvResults` 可捲、卡片不因圖片長高、縮圖失敗不破圖、詳細視窗可切圖 | 中：UI 測試需獨立 mock，不碰正式 7860 |
| `devtools/reports/lora-image-preview-research.md` | 本報告（本輪已建立） | — |

**不需要**：新增 API route、後端 proxy、圖片下載服務、資料庫、localStorage 新 key、dependency、framework、build step、改 Workflow / 生成器 / 本機 LoRA 選取權重觸發詞邏輯、改 `#lightbox`。

**相容性重點**：影像相關狀態全部放 `CV`（記憶體）或既有後端 300 秒快取；不碰 `sel/combos/adult/showEn/ui.*`。探索中心本來就不寫 localStorage，維持現狀。

---

## 9. 相容性與風險分析

| 風險 | 等級 | 緩解 |
|---|---|---|
| 圖片 URL 变换 (`width=`) 非官方合約，未來可能失效 | 中 | 嚴格 onerror 降級；不把縮圖當唯一資訊來源；可能時改走官方 `/images` 或其他正式參數（尚待確認） |
| CDN / 網路不可用 | 中 | 不阻塞搜尋結果；placeholder；不彈錯誤 toast；Civitai 連結仍在 |
|  mature 內容誤曝光 | 高 | 伺服器端 `nsfw=false` 過濾 + `model.nsfw` 判斷 + 詳細視窗 click-to-reveal；不碰 `adult` key |
| 外部 URL 注入 / XSS | 高 | host allowlist + `type` 檢查 + 只做 `<img src>` + 文字 `esc()`；不插入 SVG/HTML |
| 卡片縮圖與版本等級不一致 | 中 | 用最佳版本索引挑圖（第 6 節第 3 點） |
| 既有 4 個 modified / 17 個 untracked 檔案被誤改 | 高（流程風險） | 本輪完全未碰；實作時也需避開 `ui_control.ps1` / `ui_panel.*` 等 |
| Windows 上多個 `server.py` 綁 7860 導致「改了沒生效」 | 中 | 改 `server.py` 後依根 AGENTS.md 的完整路徑比對流程全部清掉再開（本輪未重啟任何服務） |
| 同級排序與既有核心測試被破壞 | 中 | 只為 `cvBestVersion()` 增加回傳索引，不改分級/排序邏輯；執行 `lora_explorer_core_test.mjs` 回歸 |
| 鍵盤 `←/→` 與本機燈箱衝突 | 低 | 不共用 `#lightbox`；詳細視窗另做條件或先省略 |

---

## 10. 未能確認的事項

【尚待確認】

1. `image.civitai.com` 路徑 `width=<n>` 变换的官方合約、可用寬度範圍與失效行為（本輪只實測 300 / 1024 有效）。
2. 數字 `nsfwLevel`（1/2/4/8/16/31…）與 `None/Soft/Mature/X`、browsingLevel bitmask 的精確對照。
3. 圖片 URL 簽名字段是否會過期、過期狀態碼，以及是否所有興趣版本都能拿到圖（Civitai 會因安全理由省略部分圖片）。
4. 在 `nsfw=true` 模式且 `model.nsfw===true` 時，是否仍有「SFW 静默過濾」導致卡片等級與圖片內容視覺上不一致（需 UI 實測）。
5. 1920×1080、100% DPI 下新增縮圖後，`.cv-results`（`max-height: 56vh`）內實際可見卡片數與是否仍不影響整頁不捲動（本輪未量測）。
6. 詳細視窗是否要提供 `←/→` 切圖而不干擾既有 `#lightbox` 快捷鍵（需與產品決策確認）。
7. 是否需要把擷取的圖片欄位同步進 `lora_explorer_api_test.py` 的 pre-existing mock 斷言（目前 mock 的 images 是 `"should-not-leak"`，正好用來驗證不會外洩）。

---

## 11. Git 最終狀態

【已驗證事實】本報告建立後再次檢查（預期與起始狀態相比只多一個 untracked 報告）：

- branch：`main...origin/main [ahead 1]`；HEAD 仍為 `cf5609e0cfbd69163247786f1f50dbf8e600c090`。
- tracked 修改仍是原本 4 個檔案，內容完全未動。
- untracked：原本 17 項 + 本報告 `devtools/reports/lora-image-preview-research.md`。
- 沒有 commit / push / stage / reset / restore / stash / checkout / clean。

> 本節的最終數字已於交付前用 `git -C C:\ComfyUI\simple_ui status -sb` 覆核；若有出入以該命令輸出為準。

---

## 12. 聲明

1. 本輪**沒有修改任何正式程式碼**（`app.js` / `app.css` / `server.py` / `index.html` 等皆未動）。
2. 本輪**沒有新增或刪除專案檔案**；唯一建立的是本報告 `devtools/reports/lora-image-preview-research.md`。
3. 本輪**沒有重啟或停止** ComfyUI、simple_ui（7860）、WD14 Worker 或任何正式服務。
4. 本輪**沒有修改 localStorage、正式服務設定、生圖 Workflow、模型或輸出圖片**。
5. 外部請求僅為少數 Civitai 公開 API metadata GET 與 3 次圖片 Range 探測（每次只讀 1 byte），**未下載模型、未大量抓取圖片、未執行高負載測試**。
6. 本輪到期立即停止，**不進入實作階段**，等待獨立審查後再決定下一步。
