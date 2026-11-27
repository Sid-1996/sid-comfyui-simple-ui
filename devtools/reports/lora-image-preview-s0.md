# S0：修復 Civitai LoRA 圖片預覽與成熟內容判斷 — 交付報告

## 1. 任務目標及實際根因

**目標**：只修復 S0 圖片可用性問題；不處理 OAuth、下載、相容性重構或其他 LoRA UI 改版。

**實際根因**（與任務描述一致，並已用真實 API + 瀏覽器確認）：

1. 真實 Civitai `/models` 回傳的圖片物件**沒有 `nsfw` 布林欄位**，只有數字 `nsfwLevel` 與 `minor`/`poi` 布林。
2. 上一輪 S0 前的程式把「無 `nsfw` 布林且無明確成熟標記」的圖片一律標成 `unknown:true`。
3. 前端 `cvImageVisible()` 在成熟內容關閉時同時隐藏 `mature` 與 `unknown`，因此真實公開圖片全部被過濾，`cvRenderCard()` 只渲染「無預覽」佔位，**根本不產生 `<img>`**。
4. 既有 Mock 人為補上 `nsfw:false`，讓測試通過，掩蓋了真實資料形狀。

**最小修正方向**：以 Civitai 官方 `nsfw=false` 搜尋過濾作為「公開安全」的依據（而非猜測 `nsfwLevel` 數字語意），新增 `publicSafe` 欄位；前端所有圖片入口共用同一個 `cvImageSafety()`。無法辨識的圖片仍維持受限制。

---

## 2. Civitai API 欄位調查結果及官方依據

【已驗證事實】真實公開 GET（低負載）：

```text
GET https://civitai.com/api/v1/models?types=LORA&limit=5&query=anime&nsfw=false → 200
共 138 張圖片：nsfwLevel 分布 {1: 138}
含 nsfw 布林：0 / 138
含 browsingLevel：0 / 138
host 全部為 image.civitai.com
```

單張真實圖片欄位：

```json
{"id":326152,"url":"https://image.civitai.com/.../original=true/326152.jpeg",
 "nsfwLevel":1,"width":1280,"height":1920,"type":"image",
 "minor":false,"poi":false,"hasMeta":true,"hash":"..."}
```

【官方文件記載】（`developer.civitai.com/site/reference/models.md`、`model-versions.md`、`images.md`、`guide/authentication.md`）

- `GET /models` 的 `nsfw` 參數：`false`（預設）表示**不包含成熟內容**；`true` 才包含。SFW-gated 地區會無視參數強制 SFW。
- `GET /images` 回傳的欄位包含布林 `nsfw`、**字串** `nsfwLevel`（`None/Soft/Mature/X`）與 **bitmask** `browsingLevel`；這是 `/images` 端點的形狀，**不是** `/models` 圖片物件的形狀。
- 官方明確：部分圖片會基於安全理由從公開回應省略；全部被省略時 `images: []`，不會是 null。
- 官方**未**在我們查閱的頁面提供 `/models` 圖片物件中數字 `nsfwLevel` 的對照表。

【決策】

- **不解讀**數字 `nsfwLevel`；**不把** `nsfwLevel` 當成 `browsingLevel`；**不使用** bitmask 猜測。
- 安全依據是官方 `nsfw=false` 搜尋過濾 + 沒有明確成熟標記 + 官方數字 `nsfwLevel` 欄位存在（或明確 `nsfw:false`）。
- 未知字串等級、完全缺分類資訊、`nsfw=true` 搜尋結果 → 不給 `publicSafe`，維持受限制。
- 模型層級 `model.nsfw` 保護完全保留。

---

## 3. 修改／新增檔案清單

| 檔案 | 狀態 | 目的 |
|---|---|---|
| `server.py` | 修改 | `_normalize_civitai_images(raw_images, search_nsfw=False)` 新增 `publicSafe` 分類；`_normalize_civitai_item(raw, search_nsfw=False)` 傳遞搜尋旗標；兩個呼叫端分别帶入實際 `nsfw` / `True` |
| `app.js` | 修改 | 在 `CIVITAI_CORE` 加入共用純函式 `cvImageSafety()`；`cvImageVisible()` 改為「URL 驗證 + 共用安全判斷」，卡片／詳情／切圖自動一致 |
| `devtools/lora_mock_civitai.py` | 修改 | Mock 圖片改為真實 API 形狀（無 `nsfw` 布林）；加入模型層級 `nsfw:true` 情境 |
| `devtools/lora_explorer_api_test.py` | 修改 | 更新安全分類預期、加入 `search_nsfw` 控制測試 |
| `devtools/lora_explorer_core_test.mjs` | 修改 | 擷取並測試 `cvImageSafety()` 的三態與模型層級保護 |
| `devtools/lora_ui_test.mjs` | 修改 | 加入真實資料形狀可見、模型層級 NSFW 保護與成熟模式行為檢查 |
| `devtools/reports/lora-image-preview-s0.md` | 新增 | 本報告 |

**未修改**：`index.html`、`app.css`、Workflow、`ui_control.ps1`、`ui_panel.*`、任何既有報告、localStorage 格式。

---

## 4. 重要程式碼位置及實作說明

### `server.py`

- `_civitai_image_urls()`（`~556`）與 URL 白名單／`width=300` 變换完全未動。
- `_normalize_civitai_images(raw_images, search_nsfw=False)`（`~584`）：

```python
mature = (nsfw is True or minor or poi or 字串 Mature/X)
numeric_level = isinstance(level, (int, float)) and not isinstance(level, bool)
public_safe = (not search_nsfw and not mature and
               (nsfw is False or numeric_level))
unknown = not isinstance(nsfw, bool) and not mature and not public_safe
```

  回傳欄位在原有 `id/url/thumb/width/height/nsfwLevel/mature/unknown` 之外**新增 `publicSafe`**，屬向下相容的新增欄位。
- `_normalize_civitai_item(raw, search_nsfw=False)`（`~635`）：把 `search_nsfw` 傳給圖片正規化。
- `civitai_search()`（`~717`）：`_normalize_civitai_item(i, nsfw)`，使用本次搜尋的官方 `nsfw` 參數。
- Checkpoint 搜尋（`~833`）：固定傳 `True`（該流程本來就用 `nsfw=true`），其圖片不參與探索中心顯示。

### `app.js`

- `CIVITAI_CORE` 內新增：

```js
function cvImageSafety(img, model, showMature) {
  if (!img) return false;
  if (showMature) return true;                    // 沿用既有行為
  if (img.mature || !img.publicSafe) return false;
  if (model && model.nsfw) return false;          // 模型層級保護
  return true;
}
```

- `cvImageVisible()`（`~1996`）改為：

```js
if (!img || !cvImageUrl(img.url)) return false;
return cvImageSafety(img, model, showMature);
```

  卡片 cover（`cvPickImage`）、詳細預覽與縮圖切換（`cvOpenPreview`）都呼叫 `cvImageVisible()`，因此判断一致。

---

## 5. 成熟內容安全判斷規則

| 圖片資料 | `mature` | `publicSafe` | 成熟內容關閉 | 成熟內容開啟 |
|---|---|---|---|---|
| 真實形狀：無 `nsfw`、數字 `nsfwLevel`、`nsfw=false` 搜尋 | false | true | **顯示** | 顯示 |
| 明確 `nsfw:false` | false | true | 顯示 | 顯示 |
| `nsfw:true` / `minor:true` / `poi:true` / 字串 `Mature`/`X` | true | false | 隱藏 | 顯示（沿用既有） |
| 未知字串 `nsfwLevel`、完全缺分類資訊、`nsfw=true` 搜尋 | false | false | **隱藏（受限制）** | 顯示 |
| 模型層級 `nsfw:true` | 依圖片 | 依圖片 | **隱藏（即使圖片 publicSafe）** | 顯示 |
| 不合法 URL / 非 HTTPS / 非 CDN host | — | — | 拒絕（`cvImageUrl`） | 拒絕 |

---

## 6. Mock fixture 如何修正

- `lora_mock_civitai.py::image_item()` 移除人工 `nsfw:False`，改為真實欄位：`id/url/type/width/height/nsfwLevel:1/minor:false/poi:false`。
- 安全圖 id 1、2 使用上述真實形狀。
- 明確成熟圖 id 3 用 `nsfw:true`。
- 未知圖 id 4 改用**未知字串** `nsfwLevel:"Weird"`，確保在成熟內容關閉時仍受限制（數字 16 不再被拿來當「未知」，因為安全與否取決於搜尋過濾而非解讀數字）。
- 新增 `Image NSFW Model`（`nsfw:true`）搭配真實形狀圖片，驗證模型層級保護。
- `lora_explorer_api_test.py::img()` 同步改為真實形狀；NSFW 矩陣預期改為 `(id, mature, publicSafe, unknown)`。

---

## 7. 實際執行的測試與結果

```text
node --check app.js                              → 通過
node --check devtools/lora_explorer_core_test.mjs → 通過
node --check devtools/lora_ui_test.mjs            → 通過
python -m py_compile server.py                     → 通過
python -m py_compile devtools/lora_explorer_api_test.py → 通過
python -m py_compile devtools/lora_mock_civitai.py      → 通過
git diff --check                                   → 無輸出

python devtools/lora_explorer_api_test.py          → 33 tests passed
node devtools/lora_explorer_core_test.mjs          → 21 tests passed
node devtools/lora_ui_test.mjs（隔離 7861/18188/18189）→ 53 UI tests passed
node devtools/lora_core_test.mjs                   → 17 tests passed（回歸）
python devtools/lora_api_test.py                   → 15 tests passed（回歸）
codegraph sync                                     → Synced 6 changed files
```

新增／更新測試重點：

- 後端：真實形狀圖片在 `nsfw=false` 搜尋下 `publicSafe:true`；`nsfw=true` 搜尋下 `publicSafe:false`；未知字串仍 `unknown:true/publicSafe:false`；明確成熟標記優先；既有欄位相容。
- 核心：`cvImageSafety()` 的安全／成熟／未知／模型層級 null 等情境。
- UI：卡片 64×80 與真實形狀安全圖可見、無圖佔位、模型層級 NSFW 關閉時受保護、成熟模式顯示、詳細預覽與切圖、兩段式失敗降級、關閉清理、原有 LoRA 功能與 Console 0 錯誤。

---

## 8. 真實瀏覽器驗收的具體數據

**方式**：正式 7860 不會自動載入修改，故另起隔離 `server.py`（ComfyUI 內嵌 Python）於 **7862**，`CIVITAI_API` 使用**官方真實 API**，`COMFY_URL` 指向隔離 mock ComfyUI（18188）。兩者與 7861 E2E 服務已於驗收後全部停止。正式 7860 / 8188 未重啟。

【已驗證事實】隔離 7862 + 真實 Civitai API + 修改後程式碼：

| 項目 | 成熟內容關閉（預設） |
|---|---|
| 卡片數 | 20 |
| `<img>` 數 | **19**（先前為 0） |
| 已完成且 `naturalWidth>0` | 2（其餘 lazy loading 尚未進入視窗） |
| 失敗數（`complete && naturalWidth===0`） | **0** |
| 「無預覽」佔位 | 1（該版本本身無圖片） |
| 實際 naturalWidth | **320** |
| 範例 URL | `https://image.civitai.com/.../width=300/115872395.jpeg` |

詳細預覽與切換：

| 項目 | 結果 |
|---|---|
| Modal 開啟 | true |
| 主圖載入 | true，`naturalWidth=320` |
| 縮圖條數量 | 7 |
| 點擊第 2 張後主圖 src 改變 | true |
| Network（image.civitai.com） | **8 responses / 0 failures** |

對照：修改前在同一正式 UI 的觀察為「20 卡、0 `<img>`、20 佔位、0 圖片請求」；本次修改後真實 API 已正常顯示。

---

## 9. 未執行的測試及原因

| 未執行 | 原因 |
|---|---|
| 直接在正式 7860 埠驗證修改後程式碼 | 需重啟正式服務，任務明確禁止；改用隔離 7862 + 真實 API 驗證 |
| gated／私人／限定登入模型圖片 | 無授權憑證，且本任務不處理 OAuth |
| 所有 Civitai 圖片 CDN 極端情境（簽章過期、region gating） | 屬外部服務狀態，非本次修改範圍；既有兩段式降級仍保留 |
| 大規模圖片抓取 | 任務禁止；僅使用單次公開搜尋與少量圖片連線 |

---

## 10. Git Branch、HEAD、工作區狀態

| 項目 | 調查前 | 交付後 |
|---|---|---|
| branch | `main...origin/main [ahead 1]` | 同 |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` | 同 |
| remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` | 同 |
| tracked modified | 11 個（既有控制台 4 個 + Phase 2 的 7 個） | 同（本次修改的是其中 6 個：server.py / app.js + 4 個 devtools 測試/mock） |
| untracked | 20 項（含先前報告） | **21 項**（原有 20 + 本報告；以 S0-R1 重新清點為準） |

本次沒有使用 `git reset/restore/stash/checkout/clean`，沒有 stage / commit / push，沒有清理或覆蓋既有修改與報告。`.codegraph/` 已依專案規範於修改後執行 `codegraph sync`。

---

## 11. 正式服務是否受到影響

- 沒有停止或重啟 port 7860 simple_ui、port 8188 ComfyUI 或任何 WD14 Worker。
- 沒有修改正式服務設定、Workflow、模型、輸出圖片或 localStorage。
- 隔離服務（7861 / 7862 / 18188 / 18189）已全數停止，port 已釋放。
- 真實 API 請求只有少數公開 GET 與圖片連線，無大量抓取。

---

## 12. 尚未解決的問題及風險

1. **數字 `nsfwLevel` 仍無官方對照表**：本次不解讀其語意，安全依據是官方 `nsfw=false` 搜尋過濾。若 Civitai 未來改變搜尋過濾行為，需重新評估。
2. **`publicSafe` 是新欄位**：既有其他 caller 若自行組裝 image 物件而沒有此欄位，成熟內容關閉時會被視為受限制而不顯示；目前專案內僅探索中心使用，已全數更新。
3. **成熟模式仍顯示 `mature` 圖片**：沿用既有設計；若未來要對 `minor`/poi 做更嚴格封鎖，需另行決策。
4. **真實環境仍有 1 張卡無圖**：該版本本身 `images` 為空，屬正常資料情境，非bug。
5. **未做正式 7860 上線後人工覆核**：依任務禁止重啟正式服務；上線由 ChatGPT／使用者決定時機。
6. **CodeGraph**：已 sync，索引與本次修改一致。

---

## 13. 完成後動作

已完成實作、隔離測試、真實 API 瀏覽器驗收與本報告，**立即停止**。不 Commit、不 Push、不重啟任何服務，等待 ChatGPT 直接讀取本機成果進行獨立審查。

---

## 14. S0-R1：旗標傳遞缺陷修正（本輪）

### 14.1 發現的缺陷

ChatGPT 獨立審查發現：`_normalize_civitai_item(raw, search_nsfw=False)` 雖已接收搜尋旗標，但建立版本資料時寫成：

```python
"images": _normalize_civitai_images(v.get("images")),
```

沒有把 `search_nsfw` 往下傳，因此 `_normalize_civitai_images()` 永远使用預設 `False`。

修正前本機重現（本輪實際執行）：

```text
search_nsfw=False → publicSafe=True  unknown=False
search_nsfw=True  → publicSafe=True  unknown=False   ← 錯誤
```

這會讓 `nsfw=true` 搜尋回傳的圖片也被標成公開安全，是成熟內容保護的整合缺陷。

### 14.2 修正內容

`server.py::_normalize_civitai_item()` 改為：

```python
"images": _normalize_civitai_images(
    v.get("images"),
    search_nsfw=search_nsfw,
),
```

其他安全判斷、欄位與分類邏輯完全不變。實際搜尋路徑確認完整：

```text
API nsfw 參數
→ civitai_search(nsfw)
→ _normalize_civitai_item(i, nsfw)        # server.py:717
→ _normalize_civitai_images(..., search_nsfw=search_nsfw)  # 修正處
```

Checkpoint 搜尋路徑（`server.py:833`）仍固定帶 `True`，未變動。

### 14.3 新增整合測試（`devtools/lora_explorer_api_test.py`）

1. `t_item_normalization_propagates_search_nsfw()`：直接走完整函式呼叫鏈 `_normalize_civitai_item(raw, flag)`，驗證同一張真實形狀圖片在 `False/True` 下的 `publicSafe/unknown`，並確認明確 `nsfw:true`、`minor:true` 仍為成熟、`model.nsfw` 保留、API 欄位相容。
2. `t_search_api_preserves_nsfw_flag_to_images()`：透過實際 `/api/civitai/search?nsfw=0|1` 端點，驗證 `nsfw` 參數一路影響圖片的 `publicSafe`，並檢查后端確實收到 `false/true`。

原有直接測試 `_normalize_civitai_images()` 的測試保留，但不能取代這兩個整合測試。

### 14.4 本輪實際測試結果（覆蓋本報告先前的舊數字）

```text
python -m py_compile server.py                          → 通過
python -m py_compile devtools/lora_explorer_api_test.py → 通過
python devtools/lora_explorer_api_test.py               → 35 tests passed（本輪重新執行；原 33 為舊結果）
git diff --check                                        → 無輸出
```

最小重現（修正後，本輪實際輸出）：

```text
search_nsfw=False → publicSafe=True  unknown=False
search_nsfw=True  → publicSafe=False unknown=True
```

新增兩項整合測試均通過；既有 33 項無回歸。`codegraph sync` 已執行（Synced 2 changed files，pendingChanges 歸零）。

### 14.5 更新後的 Git 狀態（S0-R1 交付時）

| 項目 | 值 |
|---|---|
| branch | `main...origin/main [ahead 1]` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| tracked modified | **11** |
| untracked | **21**（本輪重新清點；第 10 節已同步更正） |
| staged | 0 |

本輪只修改 `server.py`、`devtools/lora_explorer_api_test.py` 與本報告；沒有 Commit / Push / reset / restore / stash / checkout / clean，沒有清理其他報告或未追蹤檔案。

### 14.6 正式環境

沒有重啟 7860 simple_ui、8188 ComfyUI 或任何 Worker；沒有修改 Workflow、localStorage 或正式設定。本輪只做本機程式碼修正與隔離測試，未連正式服務做新的瀏覽器驗收（S0 的隔離 7862 + 真實 API 驗收結果仍如第 8 節，属修正前既有紀錄，不冒充本輪重新執行）。

### 14.7 剩餘風險

旗標傳遞缺陷已修；仍保留 S0 既有風險：數字 `nsfwLevel` 無官方對照表、`publicSafe` 為新增欄位、成熟模式顯示 `mature` 圖片。本輪沒有重跑 UI E2E／真實瀏覽器驗收，因為 `app.js`、`app.css`、mock 與前端測試都未變動，且修改僅涉及後端旗標傳遞並已由 35 項後端測試與最小重現覆蓋。
