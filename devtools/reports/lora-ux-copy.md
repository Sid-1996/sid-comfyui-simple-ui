# LoRA 空狀態與分類套用文案 UX 優化 — 交付報告

## 1. 任務目標

在 LoRA Phase 1 既有功能上做小幅 UX 修正：

1. 修正 LoRA 清單的「空狀態」與「錯誤狀態」判斷及文案。
2. 在**正常空清單**時提供 Civitai 外部平台入口（不整合平台 API、不下載模型）。
3. 優化歷史圖片「分類套用」Modal 的說明文案，讓替換方向清楚易懂。

完全沒有更動 LoRA 選取、權重、觸發詞、`ui.loras`、`Workflow` 串接、生成快照、歷史紀錄格式，也沒有重寫分類套用演算法。

---

## 2. 修改／新增檔案清單

| 檔案 | 狀態 | 目的 |
|---|---|---|
| `app.js` | 修改 | `loraReadJSON()` 錯誤分類、`refreshLoraList()` 錯誤 fallback、`renderLoraPick()` 空狀態文案與 Civitai 連結、`caOpen()` / `caRender()` 分類套用文案。 |
| `app.css` | 修改 | 新增 `.lora-ext-link` / `.lora-ext-mark`，沿用既有按鈕樣式。 |
| `devtools/category_apply_ui_test.mjs` | 修改 | 更新舊文案斷言，新增測試 38–40 驗證新文案方向與 `caCommit()` 替換方向不變。 |
| `devtools/lora_api_test.py` | 修改 | 新增「ComfyUI 正常但沒有模型」測試，驗證 API 正常空清單格式。 |
| `devtools/lora_ui_test.mjs` | 修改 | 以 CDP `Fetch` 攔截 `/api/loras`，新增 6 項 API 狀態／文案 E2E。 |
| `devtools/reports/lora-ux-copy.md` | 新增 | 本報告。 |

`index.html`、`server.py`、`tags.js`、`dict.js` 及其他既有報告**未在本輪修改**。`server.py` 仍顯示為修改，是上一輪 LoRA Phase 1 的既有變更，本輪沒有動它。

---

## 3. 每個檔案的修改目的與位置

### `app.js`

- `loraReadJSON()`（約 1558 行）：移除「HTML 回應＝simple_ui 服務還是舊版」的武斷推論。非 JSON 一律回統一白話訊息：「目前無法讀取 LoRA 清單，生圖服務回傳的資料格式不正確。請重新整理；如果持續發生，請重新啟動生圖介面後再試。」
- `refreshLoraList()`（約 1643 行）：保留後端 `j.error` 優先；缺少 `error` 時依 `code` 給予 `COMFY_OFFLINE` 或其他錯誤的可理解 fallback，不再只顯示 `HTTP 200/503`。第二輪補上 `Array.isArray(j.loras)` 檢查：`ok:true` 但缺 `loras` 或型別不是陣列時，進入既有「資料格式不正確」錯誤狀態，不冒充空清單。
- `renderLoraPick()`（約 1716 行）：空狀態改為「本機還沒有角色 LoRA。可以先到模型平台挑選喜歡的角色模型，再放進 ComfyUI 的 LoRA 資料夾。」並加入 Civitai 連結。此分支只有在 `ok:true` 且 `loras:[]` 時才會到達；錯誤狀態已提前 return。
- `caOpen()` / `caRender()`（約 1212 / 1226 行）：只改字串——Modal 標題、方向說明、快速替換標題、分類標題、左右欄標題與補充說明、補充描述三選項、預覽標籤。`caCommit()` 與 `CATEGORY_APPLY_PLANNER_START/END` 區塊完全未改。

### `app.css`

在 `.lora-empty` 後加入 `.lora-ext-link`（inline-flex、無底線、6px 上間距）與 `.lora-ext-mark`（小字、透明度），沿用 `.btn .btn-soft .btn-sm`，不新增按鈕尺寸變化。

### 測試檔

- `lora_api_test.py`：新增 `EmptyComfy` mock（`/models/loras` 回 `[]`）與 `t_empty_list()`，直接斷言 `GET /api/loras` 回 `{ok:true, comfy:true, count:0, loras:[]}`。
- `lora_ui_test.mjs`：CDP `Fetch.enable` 攔截 `/api/loras`，可注入指定 status/body/content-type；覆蓋空清單、HTML、invalid JSON、COMFY_OFFLINE、其他 JSON 錯誤、還原真實 API 六種情境，並檢查連結 `href/target/rel` 與「不出現舊版推論」。
- `category_apply_ui_test.mjs`：test 19 舊文案斷言改為新文案；新增 test 38（標題與方向）、39（左右欄／補充描述／預覽標籤）、40（提交方向不變：`sitting` 被 `standing` 取代，`neg` 與 localStorage 不變）。`openModal` stub 現在會記錄 Modal 標題。

---

## 4. LoRA 清單錯誤狀態的實際根因

開始前逐項核對資料流（**未修改後端**）：

1. `GET /api/loras` 確實存在：`server.py` do_GET dispatch（約 990 行）→ `_loras()`（約 1079 行）。
2. 前端呼叫 URL 正確：`fetch("/api/loras", {cache:"no-store"})`。
3. ComfyUI 正常但沒有模型：`fetch_lora_list()` 回 `([], "")` → `_loras()` 回 HTTP 200 `{ok:true, comfy:true, count:0, loras:[]}`。前端舊版也已把它當成功（`renderLoraPick()` 進入空清單分支），所以「空狀態被誤判為錯誤」**不是後端問題**。
4. ComfyUI 離線：`fetch_lora_list()` 回 `UNREACHABLE` → 503 `{ok:false, comfy:false, code:"COMFY_OFFLINE", error:"…右上角狀態列…"}`；前端會進入 error 狀態並顯示後端白話訊息，與空清單可區分。
5. 路由不存在／HTML fallback：舊 `server.py` 行程或 Static fallback 會回 200 + `index.html`；`r.json()` 失敗後，舊 `loraReadJSON()` 直接宣稱「服務還是舊版」。**HTML 只能證明不是預期 JSON，不能證明版本**——這是真正的根因（前端推論過度）。第二輪審查另發現：`ok:true` 但缺 `loras` 或 `loras` 不是陣列時，舊程式會落入 `[]` 而冒充正常空清單；已在 `refreshLoraList()` 加入 `Array.isArray(j.loras)` 嚴格檢查，失敗即進入既有「資料格式不正確」錯誤狀態。
6. invalid JSON：同樣落入 parse catch，舊訊息「LoRA 清單回傳格式不對」過於簡略。
7. 502 / 其他 JSON 錯誤：後端有穩定 `code` 與中文 `error`，前端原本就沿用；本輪只補上缺少訊息時的 fallback。
8. fetch 網路錯誤：`translateLoraError()` 仍處理「無法連到本機生圖服務」，與 ComfyUI 離線（明確 `COMFY_OFFLINE`）不同。

結論：**不需要調整 `server.py`**；只修正前端錯誤分類與文案，避免掩蓋真實 API 問題。

---

## 5. Civitai 入口實作位置

- 位置：`app.js` 的 `renderLoraPick()`，僅在 `S.loraListState === "ready"` 且 `S.loraList.length === 0` 時渲染。
- 網址：`https://civitai.com/models?types=LORA`
- 文案：「前往 Civitai 挑選 LoRA ↗」
- 屬性：`target="_blank" rel="noopener noreferrer"`，使用既有 `.btn .btn-soft .btn-sm`，並有「這會開啟外部網站」提示。
- 沒有平台搜尋 API、下載器、安裝功能、API Key 或登入；錯誤狀態與有模型的清單都不顯示此入口。

---

## 6. 分類套用文案修改內容

以 `caCommit()` 的實際行為為準（歷史圖片是基底，選取分類的歷史標籤由目前提示詞同分類標籤取代）：

| 位置 | 新文案 |
|---|---|
| Modal 標題 | 按分類替換提示詞 |
| 頂端說明 | 以這張歷史圖片為基底。選取分類後，歷史圖片中相同分類的標籤會由目前提示詞的內容取代；沒有選取的分類會保留歷史圖片原本的內容。 |
| 快速替換標題 | 快速替換（先預覽，確認後才會套用） |
| 分類標題 | 選擇要替換的分類（可多選） |
| 左欄標題／補充 | 歷史圖片中將被替換的標籤／這些標籤原本屬於歷史圖片，套用後會由目前提示詞中相同分類的標籤取代。 |
| 右欄標題／補充 | 將從目前提示詞帶入的標籤／這些標籤會從目前提示詞帶入，取代歷史圖片中選取分類的內容。⚠ 表示需要你確認；角色專屬服裝與表情不會自動帶入。 |
| 補充描述選項 | 保留目前的補充描述（推薦）／改用這張歷史圖片的補充描述／合併目前與歷史圖片的補充描述（自動去重） |
| 預覽標籤 | 目前提示詞：／歷史圖片： |

保留：8 個快速替換、10 個分類多選、左右候選、個別勾選、`⚠` 人工確認、權重變化提示、補充描述三模式與可編輯文字框、`完整套用`、`ui.extra` 寫入行為。


---

## 7. 實際測試命令與結果

```text
node --check app.js                                   → 通過
node --check devtools/lora_core_test.mjs               → 通過
node --check devtools/lora_ui_test.mjs                 → 通過
node --check devtools/category_apply_ui_test.mjs       → 通過
python -m py_compile server.py                         → 通過
node devtools/lora_core_test.mjs                       → 17 tests passed
python devtools/lora_api_test.py                       → 15 tests passed
node devtools/category_apply_ui_test.mjs               → 22 UI tests passed
node devtools/lora_ui_test.mjs --ui http://127.0.0.1:7861 --mock http://127.0.0.1:18188 --capture <temp>/capture.jsonl
                                                       → 37 UI tests passed
git diff --check                                       → 無輸出
```

UI E2E 使用隔離環境：`devtools/lora_mock_comfy.py`（18188，`--prompt-delay 3`）+ 獨立 `server.py`（7861，`COMFY_URL` 指向 mock、`SIMPLE_UI_PORT=7861`、獨立 log/WD14 temp）+ headless Chrome CDP；結束後已終止並清除暫存檔。

新增的 8 項 LoRA E2E 全部實際通過：正常空狀態與 Civitai 入口 URL/target/rel、`{"ok":true}` 缺 `loras`、`{"ok":true,"loras":{}}` 型別錯誤、HTML 回應、invalid JSON、COMFY_OFFLINE、其他 JSON 錯誤沿用後端訊息、還原真實 API 後功能正常。兩種不完整成功回應都確認顯示「資料格式不正確」、不出現「本機還沒有角色 LoRA」、不出現 Civitai 入口。分類套用新增 3 項通過，原有的 19–37 行為斷言全數保留並通過。

合計 **91 項自動化測試**通過（17 + 15 + 22 + 37）。

---

## 8. 未執行測試及原因

- 真實 LoRA 生圖：本機 LoRA 資料夾沒有可用模型；不使用正式環境或下載模型進行驗證。
- 正式 ComfyUI／7860 服務連線測試：依任務限制不得連接正式服務進行測試；E2E 全走 mock。
- Civitai 網站 actual 連線／內容：屬外部網站，不測試外部網路，也不驗證平台條款。
- GPU／高負載測試：不需要，且被禁止。
- WD14 回歸：本輪未改動任何 WD14 程式碼。
- `browse` MCP：relay 離線，改以 headless Chrome CDP 進行等效 DOM 驗證。

---

## 9. Git Branch、HEAD、工作區狀態

- Repository：`C:\ComfyUI\simple_ui`
- Branch：`main`（起始與結束相同）
- HEAD：`6573e3b`（起始與結束相同）
- Remote：`origin` → `https://github.com/Sid-1996/sid-comfyui-simple-ui.git`
- 無 commit／push／stage／reset／restore／stash／checkout／clean。
- 本輪修改：`app.js`、`app.css`、`devtools/category_apply_ui_test.mjs`、`devtools/lora_api_test.py`、`devtools/lora_ui_test.mjs`。
- 本輪新增：`devtools/reports/lora-ux-copy.md`。
- 既有 4 個修改加上本輪的測試檔修改皆保留；15 份既存 untracked reports 完全未動。

---

## 10. 正式服務是否受到影響

- 沒有啟動、停止或重啟任何正式程序：7860 simple_ui（PID 2668）、8188 ComfyUI（PID 7336，本輪開始時已在上線）、WD14 Worker 皆未觸碰。
- 沒有修改模型、Workflow、使用者圖片、輸出資料或正式設定；沒有正式生圖、下載或 GPU 使用。
- 測試用 18188 mock 與 7861 隔離實例已終止，暫存目錄已刪除。
- 注意：7860 行程仍是舊的 `server.py`（不含 `/api/loras` 路由），前端靜態檔會即時更新，但 LoRA API 必須由使用者自行按桌面控制台「重新啟動」後才會生效；本輪**未宣稱正式環境已生效**。

---

## 11. 尚未解決問題與風險

- 正式 7860 服務需要重新啟動才會提供 `/api/loras`；在此之前 LoRA 選擇視窗會顯示「回傳資料格式不正確」的通用提示（已不再是錯誤的舊版推論）。
- Civitai 連結僅是外部網站入口，未驗證該站可用性、內容分級或條款；不提供模型預覽、搜尋或下載。
- 空狀態文案只在 API **明確成功且為空**時顯示；若 API 回傳異常，仍顯示錯誤狀態，不會誤導使用者去平台找模型。
- 分類套用只改文字；`⚠` 候選仍需人工確認，權重變化提示維持原樣。
- 真實 LoRA 生圖／metadata 多格式仍如 Phase 1 報告所述未驗證。
