# LoRA 探索中心 Phase 1 — 公開搜尋與版本級適配：交付報告

## 1. 任務目標

在 Sid-simple-ui 新增「LoRA 探索中心」，讓使用者在既有單頁介面內：

1. 搜尋 Civitai 公開 LoRA（後端代發，前端不直接連 Civitai）。
2. 以目前選中的 Checkpoint 辨識基底，對每個 Civitai **model version** 做適配分類。
3. Strict 排序：完全適配優先，但「需要確認」「不建議」仍可查看、不隱藏。
4. 顯示版本名稱、基底、類型、觸發詞、主要檔案資訊與 Civitai 版本頁連結。
5. 提供「顯示成熟內容」開關，預設關閉；Checkpoint 辨識固定使用 `nsfw=true`。

本階段**不含下載、安裝、檔案寫入、Token 設定、LoRA 清單自動新增或任何 Workflow / 快照 / 歷史改動**。

---

## 2. 修改檔案及各自目的

| 檔案 | 目的 |
|---|---|
| `server.py` | 新增 Civitai 公開 API 代理、回應白名單正規化、Checkpoint 身份辨識（精確檔名 + 大小）、短時間記憶體快取，以及 `GET /api/civitai/status`、`GET /api/civitai/search` 兩個路由。 |
| `app.js` | 新增 `CIVITAI_CORE_START/END` 純資料區塊（適配分類、Strict 排序）；新增探索 Modal 的狀態、請求管理、渲染與事件；`#ckpt.onchange` 額外觸發適配重算。 |
| `index.html` | `.lora-head-actions` 新增低調「探索」按鈕；新增 `#exploreModal`；保留原「尋找 LoRA」外連、`#btnLoraPick` 與 `#loraModal` 完全不變。 |
| `app.css` | 探索 Modal 的卡片／版本／徽章／搜尋列樣式，只用既有 CSS 變數；hover 只改顏色與底線，不改尺寸。 |
| `devtools/lora_explorer_core_test.mjs` | 純函式測試：適配規則、多版本、Strict 排序、Unknown 處理（新增）。 |
| `devtools/lora_explorer_api_test.py` | 後端測試：mock Civitai + mock ComfyUI + 臨時 simple_ui；Checkpoint 精確比對、降級、API 錯誤、白名單（新增）。 |
| `devtools/lora_mock_civitai.py` | 隔離測試用的假 Civitai（新增；含 `/__mock/last`、`/__mock/all`、`/__mock/reset` 控制端點）。 |
| `devtools/lora_mock_comfy.py` | mock 增加 `/models/checkpoints`，並把 CheckpointLoaderSimple 的選項改為 WAI 檔名，供 Checkpoint 辨識 E2E 使用。 |
| `devtools/lora_ui_test.mjs` | 既有 E2E 擴充探索中心情境（入口、辨識、搜尋、分頁、成熟內容、切換 Checkpoint、Modal 關閉）。 |
| `devtools/reports/lora-explorer-phase1.md` | 本報告（新增）。 |

**未修改**：`tags.js`、`dict.js`、`tag_categories.js`、既有 15 份 untracked reports、`LORA_CORE_START/END` 內任何函式、`ui.loras` 格式、Workflow、生成快照、歷史還原。

---

## 3. Checkpoint 辨識實際方案與限制

### 3.1 安全取得本機大小

`server.py::_local_checkpoint_size(name)`：

1. 以**實際執行本伺服器的 `sys.executable`** 為起點，只往上走最多 4 層尋找 `ComfyUI/folder_paths.py` 或 `folder_paths.py`（**不是掃描整顆硬碟**，也沒有硬編碼安裝路徑）。
2. 短暫把找到的 ComfyUI root 加入 `sys.path`，`importlib.import_module("folder_paths")` 後立刻還原 `sys.path`。
3. 呼叫 ComfyUI 自己的 `folder_paths.get_full_path("checkpoints", name)`，因此支援 `extra_model_paths.yaml` 等自訂模型目錄；再用 `os.path.getsize()` 只取檔案大小，**不讀取模型內容、不計算 SHA256**。
4. 任何一步失敗 → 回 `None`，最終結果降級為 unknown。

實測（正式 embedded Python）：`sys.executable = C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe`，找到 `ComfyUI\folder_paths.py`，解析出大小 `6,938,040,682 bytes`。

> 正式 7860 與 ComfyUI 都使用同一支 embedded Python（PID 2668 / 15468）；先前報告「simple_ui 使用系統 Python」的說法僅適用桌面控制台 `ui_panel.pyw`，已在本任務重新確認。

### 3.2 唯一匹配流程

`GET /api/civitai/status?ckpt=<name>`：

1. 驗證名稱（拒絕絕對路徑、`..`、null byte、過長）。
2. 用 `/models/checkpoints` 確認名稱仍存在於 ComfyUI。
3. 取本機大小；取不到 → `{baseModel:null, confidence:"unknown", source:null, reason:"LOCAL_SIZE_UNAVAILABLE"}`。
4. Civitai 搜尋固定 `types=Checkpoint&query=<name>&nsfw=true&limit=20`，最多 3 頁 cursor；若沒找到唯一匹配，再用去掉副檔名的名稱補搜一輪，同樣有頁數上限。
5. 對候選版本的 `files[]` 逐一檢查：**檔名完全一致**且 **sizeKB 與本機 bytes 經 `Decimal` 換算完全相等**；以 version ID 去重後，只有唯一一筆才採用其 `baseModel`，標記 `confidence:"high"`、`source:"civitai-exact-file"`。
6. 其他情形（大小不同、檔名不同、多筆候選、沒有候選、Civitai 錯誤）一律 unknown，理由寫入 `reason`。

浮點誤差以 `Decimal(str(sizeKB)) * 1024` 处理；`sizeKB <= 0` 視為無效。

### 3.3 真實驗證（ investigations，非自動化測試）

在隔離腳本中以真實公開 API 查 `WAI-Nsfw-Illustrious-17.safetensors`：命中 Civitai model `827184` / version `2883731`（v17.0），`sizeKB = 6775430.353515625`，與本機 bytes 精確相等，`baseModel = "Illustrious"`。此結果僅作為設計驗證；自動化測試全部使用 mock，未依賴真實外部服務。

### 3.4 Checkpoint 切換

`#ckpt.onchange` 改為 `persistSettings()` + `cvOnCkptChange()`；後者清空目前結果、重新抓 `/api/civitai/status`。Cache key 包含 Checkpoint 名稱（後端再搭配大小）。未依賴 `storage` event（現有程式只同步標籤 key，不同步 `ui.settings`）。

---

## 4. Civitai API 實作細節

- 後端常數 `CIVITAI_API`（可由環境變數覆寫，僅供隔離測試指向 127.0.0.1 mock），預設 `https://civitai.com/api/v1`；**不接受也不保存任何 Token**。
- `GET /api/civitai/search` 參數：`q`（1–200 字）、`sort`、`period`、`nsfw`（`0/1`）、`cursor`；固定 `types=LORA`、`limit=20`。`sort`/`period` 以官方允許值白名單驗證。
- 分頁直接使用回傳的 `metadata.nextCursor`，前端不推測格式；「載入更多」把 cursor 原樣送回後端。
- 白名單正規化後每個 model 只保留：`modelId,name,type,creator,nsfw,nsfwLevel,modelBaseModels,stats{downloadCount,thumbsUpCount},versions[],url`；version 只保留 `id,name,baseModel,baseModelType,trainedWords,files,downloadUrl`；file 只保留 `name,sizeKB,format,primary,sha256,downloadUrl`。**不回傳 description HTML、images、其他 hash 或 token**。
- 快取：搜尋結果 300 秒、Checkpoint 辨識 900 秒，只存在記憶體；不寫 localStorage。
- 錯誤對應：429 → `CIVITAI_RATE_LIMITED`（尊重 `Retry-After`，回傳 `retryAfter`）；5xx → `CIVITAI_SERVER_ERROR`；連線失敗 → `CIVITAI_OFFLINE`；無效 JSON → `CIVITAI_BAD_RESPONSE`；參數錯誤 → 400。前端顯示白話中文，不自動無限重試。

---

## 5. 適配規則及案例

判斷單位為 `modelVersions[]`：

| version baseModel / baseModelType | 分類 |
|---|---|
| Illustrious + Standard | 完全適配 |
| Illustrious + 非 Standard | 需要確認 |
| NoobAI、SDXL 1.0 / LCM / Turbo / Lightning 等 | 需要確認 |
| Pony / Pony V7、SD 1.x / 2.x / 3.x、Flux.1/2/3 | 不建議 |
| Other、未知值、null、缺少 baseModel | 需要確認（未知基底） |
| Checkpoint 本身未知 | 所有版本最高「需要確認」，不出現完全適配 |

Strict 排序：完全適配 → 需要確認（已知基底）→ 需要確認（未知基底）→ 不建議；同級內保留 Civitai API 原順序（穩定排序）。

真實案例（先前 API 調查）：`43820 Illustrious Pixel Art XL & 1.5` 同一作品三個版本分別為 Illustrious / Pony / SD 1.5 → 完全 / 不建議 / 不建議；`971952` 作品宣告三種基底、32 個版本各異 → 逐版本分類。差異化驗證已寫入 `lora_explorer_core_test.mjs`。

---

## 6. 成熟內容篩選行為

- 探索 Modal 的 `#cvNsfw` 預設未勾選；前端傳 `nsfw=0`，後端轉為 Civitai `nsfw=false`。
- 勾選後前端傳 `nsfw=1`，後端轉為 `nsfw=true`；只影響 LoRA 搜尋。
- Checkpoint 身份辨識**固定** `nsfw=true`，不受此開關影響（WAI Checkpoint 本身是 NSFW 模型，預設 false 會漏掉）。
- 未寫入 `adult` 或任何既有 localStorage key；此狀態只存在記憶體。

---

## 7. 快取與錯誤處理

- 請求解耦：status/search 各有序號與 `AbortController`；新請求會中止舊請求，舊回應因序號不符被丟棄；輸入 debounce 280ms，「搜尋」按鈕會清掉 debounce，避免快速輸入與手動搜尋互相覆蓋。
- 每頁固定 20；分頁最多 3 頁（Checkpoint 辨識）；不無限掃描。
- 空結果、沒有下一頁、Checkpoint 未知、版本缺少欄位、Civitai 離線/429/5xx/無效 JSON 都有對應白話提示；「不建議」版本仍完整可見。
- 所有動態文字經 `Dict.esc()`；不使用 Civitai description HTML。

---

## 8. 測試項目及真實結果

```text
node --check app.js / tags.js / dict.js / tag_categories.js
node --check devtools/lora_ui_test.mjs / devtools/lora_explorer_core_test.mjs
python -m py_compile server.py / devtools/lora_explorer_api_test.py / devtools/lora_mock_civitai.py
    → 全部通過

node devtools/lora_explorer_core_test.mjs          → 14 tests passed
  （Illustrious Standard / 非 Standard、NoobAI、SDXL、Pony、SD1.5、Flux、
    Other、缺欄位、多版本、Checkpoint 未知、Strict 排序、真實案例 43820，
    以及第二輪新增：非 Illustrious Checkpoint 不套用不建議清單、
    Illustrious／未知 Checkpoint 既有規則不變）

python devtools/lora_explorer_api_test.py          → 25 tests passed
  （唯一精確匹配→Illustrious/high/civitai-exact-file；大小不符／檔名不符／
    多候選／無候選／本機大小不可得→unknown；固定 nsfw=true；名稱驗證；
    白名單欄位；cursor；成熟內容；429/5xx/無效 JSON/錯誤參數；Decimal 比對；
    第二輪新增：精確命中不補搜、extensionless fallback、fallback 仍雙重比對、
    合併多筆→unknown、兩輪 API 錯誤安全降級、分頁 cursor；
    第三輪新增：精確匹配成功寫入 900 秒快取、兩輪匹配缺少 baseModel 安全降級）

node devtools/lora_ui_test.mjs …                   → 46 UI tests passed
  （既有 39 項全數保留 + 探索中心 7 項：入口、Checkpoint 精確辨識、
    Strict 排序與不隱藏、cursor 載入更多、成熟內容開關、
    切換 Checkpoint 後不出現完全適配、Modal 關閉、
    Checkpoint 辨識錯誤顯示實際原因且分類保守、Console 0 錯誤）

回歸：
node devtools/lora_core_test.mjs                   → 17 tests passed
python devtools/lora_api_test.py                   → 15 tests passed
node devtools/category_apply_ui_test.mjs           → 22 UI tests passed
git diff --check                                    → 無輸出
```

E2E 環境：隔離 mock ComfyUI（18188）、mock Civitai（18189）、獨立 simple_ui（7861，`COMFY_URL`/`CIVITAI_API`/`SIMPLE_UI_PORT`/`SIMPLE_UI_LOG_DIR`/`WD14_TMP` 全指向隔離資源），並**使用與正式服務相同的 ComfyUI embedded Python** 啟動隔離 server（因為 Checkpoint 大小解析依賴 `sys.executable` 找到 `folder_paths.py`）。headless Chrome 1920×1080 / 100% DPI。

---

## 9. 未執行測試及原因

- 真實 Civitai API 自動化測試：測試一律使用 mock；真實 API 只用於任務前的唯讀設計驗證，避免不穩定與速率限制。
- 真實 LoRA 下載／安裝／寫檔：明確不在本 Phase 授權範圍。
- 正式服務生圖／GPU 測試：禁止，且本Phase不碰生成流程。
- Token／授權下載流程：本 Phase 不實作，未測試。
- 正式 7860 / 8188 的連線驗收：未連接正式服務；7860 仍為既有行程，新路由需使用者自行重啟才會生效。

---

## 10. Git Branch、HEAD、工作區狀態

- Repository：`C:\ComfyUI\simple_ui`
- Branch：`main`（開始與結束相同）
- HEAD：`da2112b443dccbe4ba069d8f475ddd891efd4b80`（未變）
- Remote：`origin` → `https://github.com/Sid-1996/sid-comfyui-simple-ui.git`
- 結束時 tracked 修改 6 個：`app.css`、`app.js`、`index.html`、`server.py`、`devtools/lora_mock_comfy.py`、`devtools/lora_ui_test.mjs`
- 新增 untracked：3 個測試工具 + 本報告；既有 15 份 untracked reports 完全保留
- 無 commit／push／stage／reset／restore／stash／checkout／clean

---

## 11. 正式服務是否受到影響

- 未啟動、停止或重啟任何正式程序：7860 simple_ui（PID 2668）、8188 ComfyUI（PID 15468）、WD14 Worker 皆未觸碰。
- 未修改模型、Workflow、輸出圖片、使用者圖片或正式設定；未正式生圖、未下載任何模型。
- 隔離測試用 18188 / 18189 / 7861 已終止，暫存目錄已清除。
- ⚠️ 7860 行程仍是舊程式（磁碟上的 `server.py` 已更新），需使用者自行按桌面控制台「重新啟動」才會提供 `/api/civitai/*`；本報告不宣稱正式環境已生效。

---

## 12. 未解決問題及風險

- ComfyUI 公開 API 沒有回傳 LoRA 目錄的絕對路徑；本 Phase 完全不處理下載位置（Auto）。未來 Phase 需另行決定如何可靠取得。
- Checkpoint 身份是「檔名 + 精確大小」的唯一匹配推論，非 SHA256 驗證；若 Civitai 上存在另一個同名同大小檔案，仍可能誤判（已用唯一性檢查降低風險）。
- Civitai `baseModel` 為上傳者宣告值，無法獨立驗證訓練真實性。
- 429 的具體數值閾值沒有公開合約；目前只依 `Retry-After` 與 exponential backoff 設計，未在真實流量下驗證。
- 外部寫入模型後 ComfyUI `/models/loras` 是否即時刷新尚未驗證（本 Phase 不寫檔）。
- 成熟內容開關只影響搜尋；Civitai 仍會依地區/網域規則過濾部分圖片，但本 Phase 不顯示圖片，因此影響有限。
- 非 Illustrious Checkpoint 沒有經過驗證的相容規則，一律採保守分類（相同基底最多「需要確認」，不同基底「未知」），不會給出完全適配或不建議的確定結論。

---

## 13. 第二輪獨立驗收修正

### 13.1 修正原因

獨立驗收指出三項與報告／產品策略不一致之處：

1. `cvClassify()` 在判斷 Checkpoint 基底前，就先把 Pony / SD 1.x–3.x / Flux 標為「不建議」；這組規則是針對 Illustrious 驗證過的，不能套用到其他 Checkpoint。
2. 報告第 3.2 節聲稱「精確檔名沒有唯一匹配時會用去掉副檔名的名稱補搜」，但實際 `identify_checkpoint()` 沒有實作 fallback。
3. 後端 `_civitai_status()` 已回傳 `error`，但前端在 unknown 分支沒有顯示，使用者會把 API 錯誤誤解成「正常沒有找到匹配」。

### 13.2 實際修改

| 範圍 | 修改 |
|---|---|
| `app.js::cvClassify()` | 把 `cvIsOtherFamily()` 的「不建議」判斷移入 `ckptBase === "illustrious"` 分支內。Illustrious 既有規則完全不變；Checkpoint 未知仍全部「需要確認」；其他已知 Checkpoint 相同基底最多「需要確認」、不同基底「未知」，不再出現 bad。 |
| `server.py::identify_checkpoint()` | 拆出 `_search_checkpoint_candidates(query)`（每輪最多 3 頁、沿用 `nextCursor`、固定 `nsfw=true`、API 錯誤回 error code）與 `_merge_candidates()`（依 modelId + versionId 去重）。第一輪用完整檔名；唯一精確匹配即回傳且不補搜；否則第二輪用去掉副檔名的名稱，合併去重後再以「完整檔名 + Decimal 精確大小」判斷唯一性；任一輪 API 錯誤立即安全降級為 unknown 並保留 `reason`，不當成空結果。 |
| `app.js::renderExplore()` | unknown 分支在 `CV.ckptError` 存在時附加「辨識失敗原因：…」，明確區分 API 錯誤與「沒有找到匹配」；基底仍顯示未知，分類仍保守。 |
| 測試 | `lora_explorer_core_test.mjs` +2 項（非 Illustrious Checkpoint、Illustrious／未知規則不變，共 14）；`lora_explorer_api_test.py` +7 項（fallback、合併多筆、兩輪錯誤、分頁，共 22）；`lora_ui_test.mjs` +1 項 E2E（429 辨識錯誤顯示與保守分類，共 46）。 |

未修改：LoRA 核心、Workflow、快照、歷史、`ui.loras`、LoRA 搜尋 API 的錯誤處理、正式服務。

### 13.3 第二輪測試結果

```text
node --check app.js / devtools/lora_explorer_core_test.mjs / devtools/lora_ui_test.mjs → 通過
python -m py_compile server.py / devtools/lora_explorer_api_test.py / devtools/lora_mock_civitai.py → 通過
node devtools/lora_explorer_core_test.mjs   → 14 tests passed
python devtools/lora_explorer_api_test.py   → 22 tests passed
node devtools/lora_ui_test.mjs …            → 46 UI tests passed
node devtools/lora_core_test.mjs            → 17 tests passed
python devtools/lora_api_test.py            → 15 tests passed
node devtools/category_apply_ui_test.mjs    → 22 UI tests passed
git diff --check                             → 無輸出
```

E2E 仍使用隔離 mock ComfyUI（18188）、mock Civitai（18189）、獨立 simple_ui（7861，embedded Python）與 headless Chrome 1920×1080；未連接正式服務、未生圖、未使用真實 Civitai。

### 13.4 剩餘風險

- extensionless fallback 仍依賴 Civitai 全文搜尋能回傳候選；若兩輪都找不到，結果仍是 unknown（設計上的安全降級）。
- 非 Illustrious Checkpoint 的分類偏保守，可能讓完全適配的 LoRA 只顯示「需要確認」；這是刻意取捨，避免未驗證規則造成錯誤宣稱。
- 兩輪搜尋最多 6 次 API 請求（每輪 3 頁），已設定快取降低重複查詢；Civitai 速率限制仍非合約保證。

### 13.5 最終狀態

- Branch `main`，HEAD `da2112b443dccbe4ba069d8f475ddd891efd4b80`（未變）；無 commit／push／stage。
- tracked 修改：`app.css`、`app.js`、`index.html`、`server.py`、`devtools/lora_mock_comfy.py`、`devtools/lora_ui_test.mjs`。
- untracked 新增：`devtools/lora_explorer_api_test.py`、`lora_explorer_core_test.mjs`、`lora_mock_civitai.py`、本報告；原有 15 份 untracked reports 未動。
- 正式 7860（PID 2668）與 8188（PID 15468）未受影響；隔離 7861/18188/18189 與暫存目錄已清理。

---

## 14. 第三輪驗收後端收尾

### 14.1 兩項問題根因

1. **精確匹配成功未寫快取**：`identify_checkpoint()` 第一輪唯一匹配後直接 `return _checkpoint_hit(...)`，跳過 `_cache_set()`，與 fallback 成功路徑不一致，造成同一 Checkpoint 每次都重新打 Civitai。
2. **缺少 baseModel 時回傳 None**：`_checkpoint_hit()` 遇到 `baseModel` 不存在／不是有效字串時回 `None`，`identify_checkpoint()` 直接回傳該 `None`，`_civitai_status()` 再呼叫 `info.get()` 時可能觸發 500。

### 14.2 實際修改

| 範圍 | 修改 |
|---|---|
| `server.py::identify_checkpoint()` | 第一輪命中後先經 `_checkpoint_hit()` 組出結果；只有 `confidence == "high"` 才 `_cache_set(key, result, ttl=900)` 並直接回傳。不可用結果（含缺少 baseModel）不寫快取，改走既有 extensionless fallback；最終結果一律經 `_cache_set()` 後回傳。既有「唯一匹配不補搜」「錯誤不快取」「兩輪合併去重」行為不變。 |
| `server.py::_checkpoint_hit()` | 不再回傳 `None`。`baseModel` 無效時回傳完整 dict：`{name, size, baseModel:None, confidence:"unknown", source:None, reason:"BASE_MODEL_UNAVAILABLE"}`；有效時維持原高信心結果。`identify_checkpoint()` 因此任何路徑都回傳 dict，`_civitai_status()` 不再有 500 風險。 |
| `devtools/lora_explorer_api_test.py` | 新增 3 項測試（精確命中 900 秒快取、第一輪缺少 baseModel、fallback 缺少 baseModel），共 25 項。 |

未修改：`app.js` 前端、`index.html`、`app.css`、LoRA 核心／Workflow／快照／歷史／`ui.loras`、LoRA 搜尋 API 的錯誤處理、任何正式服務。

### 14.3 新增測試與全部實際結果

```text
node --check app.js / tags.js / dict.js / tag_categories.js
node --check devtools/lora_explorer_core_test.mjs / devtools/lora_ui_test.mjs
python -m py_compile server.py / devtools/lora_explorer_api_test.py
                 / devtools/lora_mock_civitai.py / devtools/lora_api_test.py → 通過

node devtools/lora_explorer_core_test.mjs   → 14 tests passed
python devtools/lora_explorer_api_test.py   → 25 tests passed
node devtools/lora_ui_test.mjs …            → 46 UI tests passed
node devtools/lora_core_test.mjs            → 17 tests passed
python devtools/lora_api_test.py            → 15 tests passed
node devtools/category_apply_ui_test.mjs    → 22 UI tests passed
git diff --check                             → 無輸出
```

新增 API 測試實際驗證：

- 精確匹配成功後連續查詢兩次，結果一致；Civitai Checkpoint 搜尋只發生 1 次；第二次未執行 extensionless fallback；快取 TTL 實測約 900 秒。
- 第一輪精確匹配到的 version 缺少 `baseModel`：HTTP 200、`ok:true`、`checkpoint` 為 dict、`baseModel:null`、`confidence:"unknown"`、`source:null`、`reason:"BASE_MODEL_UNAVAILABLE"`，未標為 Illustrious。
- extensionless fallback 命中相同缺欄位 version：同樣安全降級，且確認兩輪搜尋都確實發生。

E2E 仍以隔離 mock ComfyUI（18188）、mock Civitai（18189）、獨立 simple_ui（7861，embedded Python）與 headless Chrome 1920×1080 執行；未連正式服務、未生圖。

### 14.4 剩餘風險

- `BASE_MODEL_UNAVAILABLE` 屬結果性降級，會被快取 900 秒；若 Civitai 後補上 baseModel，最長需等快取過期才會重新辨識。
- 其餘風險與第 12、13 節相同（非 SHA256 身份推論、宣告值真實性、外部速率限制等）。

### 14.5 最終狀態

- Branch `main`，HEAD `da2112b443dccbe4ba069d8f475ddd891efd4b80`（未變）；無 commit／push／stage。
- 本輪修改：`server.py`、`devtools/lora_explorer_api_test.py`、本報告。
- 15 份原有 untracked reports 未動；正式 7860（PID 2668）與 8188（PID 15468）未受影響；隔離服務與暫存目錄已清理。
