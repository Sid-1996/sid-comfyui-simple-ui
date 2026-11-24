# LoRA Phase 1 — 本機角色套用：實作與交付報告

日期：2026-11-24　負責：主要 Coding Agent　審查：ChatGPT（獨立檢查）

---

## 1. 任務目標

在既有 Sid-simple-ui 中加入 LoRA Phase 1，讓使用者不需要碰 ComfyUI 節點或 Workflow，就能：

- 從本機 ComfyUI 取得可用的 LoRA 清單（含子資料夾、相對路徑）。
- 在主畫面右側選取／移除多個角色 LoRA，各自調整權重。
- 在選擇視窗搜尋、查看有限的 metadata、管理各自的觸發詞（新增／編輯／移除／去重／開關自動加入）。
- 生成時自動把啟用中的觸發詞附加在提示詞後面，且不污染使用者手動輸入的補充描述。
- 以 `ui.loras` 保存設定，重新開啟後還原；模型消失時保留設定並提示。
- 生成時把 LoRA 狀態固定為快照，並用 ComfyUI 原生 `LoraLoader` 依序串接 MODEL／CLIP。
- 把本次使用的 LoRA 寫入生成歷史；0 個 LoRA 時舊 Workflow 完全等效。

**完成狀態：以上功能皆已實作；除「真實 LoRA 生圖」外皆有可執行測試證據。**

---

## 2. Git 起始與結束狀態

| 項目 | 起始 | 結束 |
|---|---|---|
| Repository | `C:\ComfyUI\simple_ui` | 同 |
| Branch | `main` | `main` |
| HEAD | `6573e3b` | `6573e3b`（未變動） |
| Remote | `origin  https://github.com/Sid-1996/sid-comfyui-simple-ui.git` | 同 |
| 工作區 | 4 個乾淨檔案 + 15 個既有未追蹤 `devtools/reports/*.md` | 4 個修改 + 5 個本次新增（4 個測試工具 + 本報告）；既有 15 份報告未動 |
| Commit / Push | 無 | 無（依指示不執行） |

既有未提交的 15 份報告（`devtools/reports/` 下的 tag-learning／open-source／history-prompt／README 等）**完全未修改、未刪除、未混入交付**。未執行 reset / restore / stash / checkout / clean / rebase / force push。

---

## 3. 修改檔案清單

### 本次修改（4 個）

| 檔案 | 目的 | 主要位置 |
|---|---|---|
| `server.py` | 新增兩個唯讀 API：`GET /api/loras`（清單）與 `GET /api/lora-meta?name=`（metadata），全部經既有 COMFY 反向Proxy；白名單只收 `.safetensors` | helpers：L355–489；路由分派：L990–993；handler：`_loras()` L1079、`_lora_meta()` L1093 |
| `app.js` | LoRA 純資料層與 Workflow 串接、生成快照、後端請求、UI 操作流程、事件綁定 | 狀態：`S.loras` L28 起；`composePrompt()` L301、`snapshotNow()` L310；核心 `LORA_CORE_START/END` L378–578（`wf()` L563）；生成驗證 L605、快照 L639、歷史 L706；`reusePrompt()` L949；UI 層 L1520–1940；init 綁定 L2564 起 |
| `index.html` | 右欄「角色 LoRA」區塊與選擇視窗 `#loraModal` | 右欄 L193–199；視窗 L356–383 |
| `app.css` | LoRA 主區塊、選擇視窗、觸發詞 chip 的樣式（只用既有 CSS 變數） | 第 8.5 節 L947 起 |

### 本次新增（5 個）

| 檔案 | 用途 |
|---|---|
| `devtools/lora_core_test.mjs` | 從 `app.js` 擷取 `LORA_CORE` 區塊做純資料／Workflow 測試（14 項） |
| `devtools/lora_api_test.py` | 用臨時 mock ComfyUI + 臨時 simple_ui server 測後端 API（14 項） |
| `devtools/lora_mock_comfy.py` | 測試用的假 ComfyUI（只回快取的 JSON／1×1 PNG，無 GPU、無寫模型） |
| `devtools/lora_ui_test.mjs` | 用 headless Chrome CDP 操作隔離實例的端對端測試（25 項） |
| `devtools/reports/lora-phase1.md` | 本報告 |

未修改：`tags.js`、`dict.js`、`tag_categories.js`、`r18.json`、任何既有報告、任何模型／Workflow／使用者圖片。

---

## 4. 技術實作摘要

### 4.1 LoRA 清單 API 與後端代理

- `GET /api/loras`：向 ComfyUI `GET /models/loras` 取清單（經既有 `COMFY` 本機 loopback 機制），只保留 `.safetensors`；拒絕絕對路徑、`..`、空節、null byte、過長名稱；大小寫不敏感去重；個別壞資料跳過，不讓整份清單失效；回傳 `{ok, comfy, count, loras:[{name, display, sub}]}`，`name` 保留 ComfyUI 原始相對路徑（Windows 反斜線），`display` 取檔名去副檔名，`sub` 取子資料夾。
- `GET /api/lora-meta?name=...`：**不接受前端任意檔案系統路徑**，先把 `name` 與「目前 `/models/loras` 的有效清單」重新比對，命中才轉送 `GET /view_metadata/loras?filename=...`；只取可靠欄位（`modelspec.title`、`modelspec.architecture`、`modelspec.description`、`modelspec.resolution`、`ss_network_dim`、`ss_network_alpha` 與 `modelspec.trigger_phrase` / `modelspec.trigger_words` / `ss_trigger_words` 等觸發詞欄位），觸發詞也做大小寫／底線／空白去重。
- 前端**完全沒有**出現 `127.0.0.1:8188` 或任何直連 ComfyUI 的程式碼；皆走同源 `/api/loras`、`/api/lora-meta`、`/comfy/*`。
- 無 preview 圖：本機 ComfyUI 核心沒有可靠的 LoRA 預覽 API，本案**不下載、不複製模型**，清單只用文字與既有 `.lora-pick` 排版呈現。

### 4.2 模型檔案安全

- 白名單只有 `.safetensors`（大小寫不敏感）。已查 ComfyUI v0.45.0 的 `folder_paths` 支援 `.pt/.ckpt/.bin/.pth/.pkl` 等格式，但那些需要 pickle 反序列化才能讀 metadata；**本案不開放、不使用 pickle**。
- 目前本機 `models/loras` 只有 0-byte `put_loras_here` placeholder，**沒有真實 LoRA**；因此未做真實 LoRA 生圖。

### 4.3 LoRA 資料結構（`ui.loras`，version 1）

```js
{
  v: 1,
  items: [{
    name: "chars\\角色.safetensors",  // ComfyUI 相對路徑（穩定識別值）
    display: "角色",                  // 快取顯示名
    strength: 0.8,                    // 單一 UI 權重；snapshot 同時給 strength_model / strength_clip
    triggers: ["角色", "red eyes"],
    autoTrigger: true,
    enabled: true                     // 選取狀態；取消即停用但保留權重與觸發詞
  }]
}
```

- 新 key `ui.loras`，若不存在的話以空清單初始化；`loraParseItems()` 對非物件、非陣列、名稱無效、重複名稱、壞權重、壞觸發詞都逐筆防護。
- 未動 `sel` / `combos` / `adult` / `showEn` / `ui.extra` / `ui.gallery` 的既有格式；`ui.gallery` 只是在新生成項目多一個 `loras` 欄位，舊紀錄沒有該欄位也能讀。
- 預設權重 **0.8**（角色 LoRA 常見起點）；滑桿 -2～2、step 0.05，旁邊數值框可輸入 -100～100；`loraWeight()` 擋非數值／NaN／Infinity，保守夾在 ComfyUI 節點的 -100～100。底層 `strength_model` / `strength_clip` 在 snapshot 時都填同一個值，但 Workflow 建構函式保留 `strengthModel` / `strengthClip` 覆寫介面（已寫測試），Phase 2 可拆開。

### 4.4 UI 操作流程

1. 右欄「輸出設定 → 模型」下方新增「角色 LoRA N · 選擇」。N 是已選數量；已選清單每列有名稱（過長以 ellipsis）、子資料夾、權重滑桿＋數值、移除 `×`；模型消失時該列紅框提示且禁止生成。
2. 按「選擇」開既有 Modal：搜尋框、本機清單（顯示名／子資料夾／觸發詞數／是否已加入）、「加入／取消」與「觸發詞」按鈕；右側面板管理該 LoRA 的 metadata 資訊、自動加入開關、觸發詞輸入與 chip（點文字編輯、`×` 移除）。
3. 狀態：空清單／載入中／讀取失敗（含「simple_ui 服務還是舊版」指示）／找不到模型／無搜尋結果都有明確文案。
4. Hover 不改變尺寸；長名稱用固定寬度 + ellipsis + `title`；進階資訊（metadata、觸發詞）只在視窗內；1920×1080 實測整頁不捲動、右欄不捲動、無橫向溢出。

### 4.5 觸發詞處理與資料隔離

- 觸發詞是 `ui.loras.items[].triggers` 的**獨立來源**，完全不進 `sel` / `combos`，不改 `tags.js`，不寫回 `#pos`。
- `loraSnapshot()` **完整保存**名稱、顯示名、權重、清理過的 `triggers` 與 `autoTrigger`（即使自動加入關閉也不丟觸發詞）；`loraTokensFromSnapshot()` 才負責判斷是否放進 Prompt。`snapshotNow()` 只取其中「自動加入」的觸發詞附加在正面 prompt **最後面**，逗號分隔；不對使用者輸入做任何字串替換。舊快照沒有 `autoTrigger` 欄位時視為啟用。
- `loraCleanTriggers()` / `loraTokensFromSnapshot()` 以「小寫＋底線轉空白＋摺疊空白」去重（跨 LoRA 也去重）。
- 移除角色＝把該筆 `enabled` 設為 false，保留其權重／觸發詞供重新加入；使用者在 `#pos` 手動輸入的相同文字完全不被碰。
- `showPromptModal()` 與實際生成共用同一個提示詞組成邏輯（包含 LoRA 觸發詞），不會出現「預覽與送出不一致」。

### 4.6 Workflow 動態串接

- `wf(o)` 仍先建立原本 7 個節點，再呼叫 `loraApplyToWorkflow(nodes, o.loras)`：
  - 0 個 → 原封不動回傳（測試逐欄位 deepEqual 舊版）。
  - N 個 → 從 CheckpointLoaderSimple 的 `["1",0]` / `["1",1]` 開始，依使用者加入順序建立 id 為 `max(現有數字 id)+1` 遞增的 `LoraLoader`，每顆都同時接 MODEL 與 CLIP，並把輸出接到下一顆。
  - 最後 `nodes["2"].inputs.clip`、`nodes["3"].inputs.clip` 都接同一條最後 CLIP；`nodes["5"].inputs.model` 接最後 MODEL。Checkpoint、VAE、Sampler、Prompt、SaveImage 都不改。
- 每次 `wf()` 都新建 nodes 物件，多次生成不會累積重複 LoRA 節點（純測試與 E2E 都驗證）。

### 4.7 生成快照與歷史

- `generate()` 在 `ensureComfy()` 後先跑 `verifySelectedLoras()`：重新抓清單，缺模型就擋下生成並列出名稱；清單 API 失敗也擋下，不靜默略過角色。
- 之後 `snapshotNow()` 一次取得標籤、提示詞、負面、設定與 `loras` 快照；`o.loras` 直接送進 `wf(o)`。生成期間 UI 改權重／移除角色，都不會影響已提交的 Workflow（mock 故意延遲回應後實測）。
- `logGen("snapshot", …)` 記錄 LoRA 名稱@權重；`ui.gallery` 每張圖多存 `loras: snap.loras`（名稱、顯示名、實際權重、**完整觸發詞**、實際 `autoTrigger`），舊紀錄讀取不受影響。`reusePrompt()` 遇到有 `loras` 欄位的新紀錄就完整還原（空陣列＝清空目前角色）；完全沒有 `loras` 欄位的舊紀錄則保持目前 LoRA 設定。即使該次生成沒有使用觸發詞也不會清除使用者的觸發詞設定。

### 4.8 錯誤處理

| 情況 | 處理 |
|---|---|
| 清單 API 連不上 | 後端 503 `COMFY_OFFLINE`；視窗顯示白話提示與「重新整理」 |
| 清單格式異常 | 後端 502 `LORA_LIST_INVALID`，不冒充空清單 |
| metadata 不存在／解析失敗 | 200 `meta:null` + `NO_METADATA`；視窗提示可手動新增，清單照常用 |
| 選取的 LoRA 被刪 | 主畫面紅框「本機已找不到這個模型」；生成前阻止並列出名稱 |
| 名稱／路徑無效 | 後端 400 `LORA_NAME_INVALID`，前端也先做 `loraNameOk()` |
| 權重非數值 | 回預設 0.8；超出 -100～100 才夾住 |
| `ui.loras` 損壞 | 安全回退空清單，不清其他 key；回傳 HTML（舊版服務）時顯示「請用控制台重新啟動」 |
| 快速連點 | 同步資料操作＋每一次都重繪，實測 6 次連點不重複 |
| 生成期間改 UI | 快照與 Workflow 使用同一次 `snap`，不受影響 |
| 多 LoRA 其中一筆無效 | 生成前 availability 檢查擋下；`loraApplyToWorkflow()` 另有一層過濾 |

Checkpoint 相容性：metadata 的 `architecture`（例如 `sdxl_base_v1-0/lora`）只在視窗「模型資訊」呈現，**不自動封鎖、不自動換 Checkpoint、不假裝能判斷所有相容性**。

---

## 5. 測試結果

### 5.1 語法檢查（全部實際執行、全數通過）

```text
node --check app.js
node --check tags.js
node --check dict.js
node --check tag_categories.js
node --check devtools/lora_core_test.mjs
node --check devtools/lora_ui_test.mjs
python -m py_compile server.py
→ 無錯誤輸出（ALL OK）
```

### 5.2 純資料／Workflow（`node devtools/lora_core_test.mjs`）→ **17 tests passed**

0 LoRA 深度相等舊版；1 LoRA MODEL/CLIP 接線；3 LoRA 串接順序與個別權重；無效資料跳過且不累積；觸發詞去重；`autoTrigger=false` 快照仍保留完整觸發詞但 Prompt 不帶詞；跨 LoRA 去重只處理自動加入的 LoRA；舊快照缺 `autoTrigger` 視為啟用；序列化往返保留停止自動加入的觸發詞；損壞資料回退；權重驗證；路徑安全；取消保留設定；`strengthModel/strengthClip` 擴充介面。

### 5.3 後端 API（`python devtools/lora_api_test.py`）→ **14 tests passed**

臨時 mock ComfyUI（隨機 port）＋臨時 simple_ui server（隨機 port）：清單過濾與排序、`/api/loras` 格式、metadata 解析、`/api/lora-meta` 200/400/404、ComfyUI 離線 503、清單格式異常 502、空 metadata、非 dict metadata。

### 5.4 端對端 UI（`node devtools/lora_ui_test.mjs …`）→ **29 UI tests passed**

環境：`devtools/lora_mock_comfy.py --port 18188 --capture … --prompt-delay 2/3`；隔離 `server.py`（`COMFY_URL=http://127.0.0.1:18188`、`SIMPLE_UI_PORT=7861`、獨立 LOG_DIR / WD14_TMP）；headless Chrome 1920×1080 透過 CDP 操作。正式 7860 與 ComfyUI 皆未連接、未重啟。

實際通過：頁面載入／狀態列；初始空狀態；清單只列 `.safetensors`；搜尋；加入並寫入 `ui.loras`（預設 0.8）；metadata 讀取；觸發詞新增／大小寫底線去重／編輯／移除／metadata 帶入；無 metadata 提示；關閉自動加入後 prompt 不含觸發詞；兩 LoRA 順序與個別權重（0.9 / 0.55）；提示詞預覽一致；2 LoRA 的 MODEL/CLIP 串接、觸發詞、負面不受污染；**生成中途改 UI 後送出內容與歷史仍是快照**；移除角色保留設定且使用者文字不變；結果走 `/comfy/view`；快速連點；0 LoRA 生成只有 7 個節點無殘留；模型消失阻止生成並標示；`ui.loras` 損壞安全回退且 `sel`/`ui.extra` 不變；舊歷史可讀；1920×1080 含 2 個 LoRA 時整頁與右欄皆不捲動、無橫向溢出；**關閉自動加入後生成：Prompt 不含觸發詞但 `ui.gallery` 完整保存 triggers / autoTrigger=false / 名稱 / 權重；故意改壞 UI 後按「同提示詞」可完整還原**；歷史 `loras: []` 會清空目前角色（`ui.loras` 與主畫面都變空）；舊歷史沒有 `loras` 欄位時保留目前角色；Console 無非預期錯誤。

### 5.5 未執行的測試

- **真實 LoRA 生圖**：本機沒有任何真實 LoRA 模型（只有 0-byte placeholder），不可下載／建立模型，也未連正式 ComfyUI；因此**不宣稱完成真實 LoRA 生圖驗證**。
- **真實 ComfyUI 連線**：8188 在開始與結束時皆未監聽；依指示未啟動。
- **browse MCP 瀏覽器**：relay 顯示 `paired-offline`；改用隔離 headless Chrome CDP 完成同類驗證，未重試連正式瀏覽器。
- GPU 高負載、大量生圖、依賴安裝／移除、正式部署：依指示未執行。
- WD14 相關測試：本次未改動 WD14，未執行。

---

## 6. 正式服務影響

- **沒有**停止或重啟 ComfyUI、simple_ui（7860，PID 2668 仍活著）、WD14 Worker。
- **沒有**修改任何模型、Workflow、使用者圖片或輸出資料。
- **沒有**正式生圖、GPU 測試或高負載測試；所有生成都是 mock 回傳的 1×1 PNG。
- 測試用的 mock ComfyUI（18188）、隔離 simple_ui（7861）、暫存 log/capture/Chrome profile 已於測試後終止並刪除；8188 仍為原本的離線狀態。

> ⚠️ **交付注意**：正式 7860 服務是重啟前的舊 `server.py`（程式碼在磁碟上已更新，但行程仍舊），所以目前正式介面點「選擇」會看到「simple_ui 服務還是舊版，請用桌面控制台按『重新啟動』後再試」。需由使用者自行按桌面「生圖控制台 → 重新啟動」才會生效；本次依指示未代為重啟。

---

## 7. 未解決問題與風險

1. **真實模型未驗證**：沒有真實 LoRA，也沒有 ComfyUI 連線；metadata 欄位只依 v0.45.0 原始碼與_mock_驗證，其他訓練器（kohya／Flux／SD3）自訂欄位可能不同。缺失時會安全显示「沒有可讀取的 metadata」，不影響手動觸發詞。
2. **單一權重控制**：UI 只有一個 `strength` 同時給 MODEL／CLIP；底層保留拆分介面但未做兩個滑桿（產品決策：避免一般使用者負擔）。
3. **沒有預覽圖**：ComfyUI 核心沒有可靠的 LoRA 預覽 API；刻意不下載／複製模型，清單以文字呈現。
4. **相容性提示有限**：只顯示 metadata 的 base model 字串，不做自動判定或封鎖。
5. **`loraRemove()` 仍存在於純資料層但 UI 改用 `enabled:false`**：停用項目會一直保留在 `ui.loras`（這是刻意行為，為了重新加入時保留設定）；若日後要提供「清除無效設定」按鈕可再使用它。
6. **正式服務需手動重啟**（見第 6 節），否則 LoRA API 不存在。
7. 目前沒有把 LoRA 名稱寫入 `logs/gen_requests.jsonl`（該 log 仍記錄舊的 Prompt／尺寸／Sampler）；生成快照已記錄在 `ui.gallery` 與 `logGen()` 事件中。

---

## 8. 待 ChatGPT 獨立審查事項

| 檔案 | 建議檢查點 |
|---|---|
| `server.py` | L355–489：`_comfy_get_json`、`_lora_name_ok`、`fetch_lora_list`、`_lora_meta_extract`、`fetch_lora_meta`（白名單、路徑安全、metadata 欄位）；L990–993 路由；L1079–1125 handler 的 status／error code |
| `app.js` | L28–42 狀態初始化；L301–345 `composePrompt` / `snapshotNow`；L378–578 `LORA_CORE`（特別是 `loraApplyToWorkflow` 與 `wf`）；L584–712 生成流程；L949–963 `reusePrompt`；L1520–1940 UI 層（觸發詞隔離、event delegation）；L2564–2582 init 綁定 |
| `index.html` | L193–199 右欄區塊；L356–383 `#loraModal` |
| `app.css` | L947–1120 LoRA 樣式與 `@media (max-width:900px)` |
| 測試 | `devtools/lora_core_test.mjs`、`devtools/lora_api_test.py`、`devtools/lora_ui_test.mjs`、`devtools/lora_mock_comfy.py`；請特別確認測試**沒有**拼造「已通過」字樣而是真的執行 |
| 報告 | 本檔案；Git diff 可用 `git -C C:\ComfyUI\simple_ui diff` 查看（4 個修改檔） |

---

## 9. 完成標準對照

| 完成標準 | 狀態 | 證據 |
|---|---|---|
| 本機 LoRA 清單可取得 | ✅ | `/api/loras` + backend 14 tests + UI E2E |
| UI 可選取及移除 LoRA | ✅ | UI E2E（含快速連點、移除保留設定） |
| 每個 LoRA 可設定權重 | ✅ | UI E2E（0.9 / 0.55） |
| 觸發詞可獨立管理 | ✅ | UI E2E（新增／編輯／移除／去重／metadata 帶入） |
| 觸發詞不污染舊 Tags 資料 | ✅ | 程式碼設計 + E2E（`sel` / `ui.extra` 不變，移除不刪手動文字） |
| localStorage 可保存設定 | ✅ | UI E2E（寫入、重新載入、損壞回退） |
| 生成 snapshot 正確 | ✅ | UI E2E（mock 延遲回應期間改 UI） |
| Workflow 串接 0／1／多 LoRA | ✅ | core 17 tests + UI E2E（0 與 2） |
| 舊 Workflow 在 0 LoRA 時等效 | ✅ | core test 1 深度相等 |
| 基本錯誤處理完整 | ✅ | backend 14 tests + UI E2E |
| 必要測試有實際結果 | ✅ | 第 5／10／11 節（60 項自動化測試 + 語法檢查，含兩輪審查回歸） |
| 建立完整交付報告 | ✅ | 本檔案 |

**唯一未能項目：真實 LoRA 模型生圖驗證**（無模型、ComfyUI 離線；已安全替代為 mock + 純資料測試，並明確標記未驗證）。

---

## 10. 獨立審查修正：保留關閉自動加入的觸發詞

### 10.1 審查發現

ChatGPT 指出 `loraSnapshot()` 原本寫成：

```js
triggers: it.autoTrigger ? loraCleanTriggers(it.triggers) : [],
```

當 `autoTrigger === false` 時會**直接丟掉**使用者設定的觸發詞。由於該快照同時用於生成、`ui.gallery` 歷史與 `reusePrompt()` 還原，會導致「關閉自動加入後生成的那張圖，無法從歷史還原原本設定」。屬於資料保存 defect。

### 10.2 修正方式（只改 `app.js` 的兩個純函式）

| 函式 | 修正 |
|---|---|
| `loraSnapshot()` | 無條件保存 `triggers: loraCleanTriggers(it.triggers)`；`autoTrigger` 用 `it.autoTrigger !== false`（缺欄位視為啟用）。快照職責 = 完整保存設定。 |
| `loraTokensFromSnapshot()` | 先跳過 `l.autoTrigger === false` 的 LoRA，再對其餘觸發詞做原有跨 LoRA 去重；容忍非陣列 `triggers` 與 `null` 項目。Prompt 職責 = 只組合要自動加入的詞。 |

`reusePrompt()` 本身無須改動：它已把歷史的 `triggers`、`autoTrigger`、`strength`、`name` 丟給 `loraParseItems()`；修正快照後就能完整還原。未改動任何其他已通過審查的功能。

### 10.3 新增回歸測試

- `devtools/lora_core_test.mjs`：test 7／8 改寫，另新增 test 15（舊快照缺 `autoTrigger` 相容）、test 16（序列化往返保留關閉自動加入的觸發詞）、test 17（快照保存與 Prompt 組合職責分離）→ **17 tests passed**。
- `devtools/lora_ui_test.mjs`：新增 E2E 情境——選取 LoRA 並設 3 個觸發詞 → 關閉自動加入 → mock 生成 → 驗證 positive Prompt 不含這 3 個詞、`ui.gallery[0].loras` 仍保存完整 `triggers` 與 `autoTrigger:false`、名稱與權重 → 故意把 UI 改成 `autoTrigger:true`、砍掉一個觸發詞、權重改 0.4 → 按「同提示詞」還原 → 驗證 3 個觸發詞、`autoTrigger:false`、原名稱與 0.8 權重全部回來 → **27 UI tests passed**。

### 10.4 本次審查修正的實際測試結果

```text
node --check app.js                         → 通過
node --check devtools/lora_core_test.mjs     → 通過
node --check devtools/lora_ui_test.mjs       → 通過
node devtools/lora_core_test.mjs             → 17 tests passed
python devtools/lora_api_test.py             → 14 tests passed
node devtools/lora_ui_test.mjs …             → 27 UI tests passed
git diff --check                             → 無輸出
```

Git 起始／結束皆為 `main` / `6573e3b`；既有未提交修改與 15 份其他任務報告未動；未 commit／push，未啟動或重啟任何正式服務，未下載模型或執行 GPU 生圖。測試用 18188 mock 與 7861 隔離實例已終止，暫存擋案已刪除。

---

## 11. 第二輪審查補充修正：歷史還原空 LoRA

### 11.1 審查發現

`reusePrompt()` 原本寫成 `if (Array.isArray(it.loras) && it.loras.length)`，因此當歷史紀錄的 `loras` 是空陣列時（該次生成沒有用 LoRA），不會清除目前已選取的 LoRA。使用者套用這類歷史圖片的提示詞後，畫面仍套著角色，與該張圖的實際生成設定不一致。

### 11.2 修正方式（只改 `app.js` 的 `reusePrompt()`）

- 判斷改成 `if (Array.isArray(it.loras))`：只要有這個欄位就還原，不論是否為空。
- `it.loras = []` → `loraParseItems({ items: [] })` 回傳空清單 → `loraSave()` / `renderLoraSelected()` / `renderLoraPick()` 清空目前已啟用角色並更新主畫面。
- `it.loras` 有內容 → 沿用既有 `loraParseItems()` 還原名稱、權重、觸發詞與 autoTrigger。
- 完全沒有 `loras` 欄位的舊歷史 → 不進入此分支，保留目前 LoRA 設定。
- 未建立新的狀態處理方式，未改其他檔案或功能。

### 11.3 新增 E2E 回歸與實際結果

`devtools/lora_ui_test.mjs` 新增兩筆合成歷史（同一輪 reload 後由 `#histBar` 燈箱觸發「同提示詞」）：

1. 建立 `loras: []` 的紀錄與一筆「沒有 loras 欄位」的舊紀錄。
2. 目前 UI 已選取 LoRA → 點第一筆的「同提示詞」→ `ui.loras.items.length === 0`、`#loraCount === "0"`、`#loraList` 顯示空狀態，提示詞仍正確還原。
3. 重新選取一個 LoRA → 點舊紀錄的「同提示詞」→ `ui.loras` 仍是該 LoRA 且 `enabled:true`，沒有被誤清空。

```text
node --check app.js                         → 通過
node --check devtools/lora_ui_test.mjs       → 通過
node devtools/lora_core_test.mjs             → 17 tests passed
python devtools/lora_api_test.py             → 14 tests passed
node devtools/lora_ui_test.mjs …             → 29 UI tests passed
git diff --check                             → 無輸出
```

Git 起始／結束仍為 `main` / `6573e3b`；15 份其他任務報告與既有未提交修改未動；未 commit／push、未重啟正式服務、未下載模型或執行 GPU 生圖。測試用 18188 mock 與 7861 隔離實例已終止，暫存檔已刪除。
