# Sid-simple-ui Prompt 與 Tag 全系統整合前期盤點（唯讀審查報告）

- **日期**：2026-11-27
- **專案**：`C:\ComfyUI\simple_ui`（`Sid-1996/sid-comfyui-simple-ui`）
- **性質**：**唯讀調查**。未修改任何程式碼、設定、使用者資料；未執行 Git 寫入；未重啟服務；未生成圖片；未下載模型；未使用 API Key。
- **交付**：本報告僅作為後續整合的依據，不開始實作。

---

## 1. 任務目標與執行範圍

盤點 Sid-simple-ui 全部標籤與提示詞相關功能，找出架構問題、資料流問題及 UX 問題，為後續整體整合建立可靠依據。

調查範圍涵蓋：
- **A 標籤系統**：CATS 標籤庫、分類、搜尋、收藏、選取、加入/刪除/排序/去重、正負向標籤、手動輸入與資料庫標籤共存。
- **B Prompt 編輯系統**：正向/負向 Prompt 狀態管理、字串解析與序列化、標籤與自由文字共存、排序與重複處理、多套更新方式、狀態覆蓋/不同步/資料遺失風險。
- **C 歷史 Prompt 系統**：資料結構、保存/還原、分類套用、角色替換、補充描述、LoRA 與歷史關係、覆蓋風險。
- **D WD14 反推系統**：結果轉換為標籤/Prompt、是否直接修改目前 Prompt、人工確認 vs 自動套用、與既有標籤分類共用邏輯、重複解析與去重。
- **E LoRA Trigger Words**（特別深入）：`triggers` 資料結構、`authorSuggestions.local` / `.civitai` 保存與使用、作者建議與個人觸發詞關係、UI 耦合、新增/刪除/修改/取消版本連結行為、自動注入與手動編輯限制、歷史還原處理、鎖定/覆蓋/遺失風險。
- **F 跨功能整合**：哪些功能讀/修改/覆蓋 Prompt、獨立資料狀態、應共用/區別的資料、重複的解析/分類/去重/序列化實作、`app.js` 多套狀態管理邏輯。

UX 操作流程（無技術背景使用者視角）建立 9 個流程並找出多餘操作、不直覺入口、認知衝突等。

**禁止事項已全部遵守**（見「六、禁止事項」）。

---

## 2. 開始時 Git 基準

查詢方式：`git -C C:\ComfyUI\simple_ui status -sb`（`-C` 指定本專案 repo，不遞迴搜尋 `.git`，避免誤判上游 ComfyUI）。

| 項目 | 結果 |
|------|------|
| Repository 根目錄 | `C:\ComfyUI\simple_ui` |
| Branch | `main` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| Ahead / Behind | `1` / `0`（領先 origin/main 1 個 commit） |
| Staged | 0 |
| Tracked Modified | 13 個：`AGENTS.md`、`app.css`、`app.js`、`devtools/lora_api_test.py`、`devtools/lora_core_test.mjs`、`devtools/lora_explorer_api_test.py`、`devtools/lora_explorer_core_test.mjs`、`devtools/lora_mock_civitai.py`、`devtools/lora_ui_test.mjs`、`devtools/test_ui_control_wd14.ps1`、`index.html`、`server.py`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw` |
| Untracked | 48 個 porcelain 項目（80 個檔案），其中大多為 `devtools/reports/` 與 `devtools/` 測試檔，以及 `comfy_lora_paths.py`（untracked，在 repo 之外邏輯） |
| 本報告 | 新增 `devtools/reports/prompt-tag-system-consolidation-audit.md`（尚未寫入時為不存在） |

### CodeGraph 索引狀態（調查前）
`codegraph status`：Files 35 / Nodes 1,094 / Edges 4,837，Pending Changes Added 5 / Modified 6。**索引已過期**。依規定未執行 `codegraph sync`（唯讀、禁止寫入衍生索引），所有程式碼位置與行號以直接 Read 目前磁碟原始碼為準。

---

## 3. 完整功能及模組盤點

### 3.1 原始碼模組（frontend + backend）

| 檔案 | 職責 | 行數（約） |
|------|------|-----------|
| `index.html` | 版面骨架：頂列 / 左標籤庫 / 中舞台 / 右設定 / 底部動作列；多個 modal（反推、LoRA 探索中心、角色 LoRA、說明/提示詞、燈箱） | 452 |
| `app.css` | 設計 token 與全部樣式（深紫主題） | ~6,700 |
| `app.js` | 生成流程、WebSocket 進度、取消、歷史、燈箱、快捷鍵、LoRA 選取/觸發詞、Civitai 探索中心、WD14 反推、分類套用、補充描述 | 3,988 |
| `tags.js` | 標籤庫資料（CATS）與渲染，暴露 `window.Tags`；個人統計、學習標籤、收藏 | 1,193 |
| `dict.js` | 中文 → Danbooru 英文對照 `window.Dict`（`tr`, `leftover`, `esc`） | 44 |
| `tag_categories.js` | 標籤分類資料 `window.TagCategories`（10,959 筆，10 類） | 35,568 |
| `r18.json` | 成人標籤資料 | 10,607 |
| `server.py` | 標準庫 HTTP 伺服器：靜態檔、/comfy 代理、/ws 隧道、API（/api/status, /api/check, /api/delete, /api/reverse, /api/loras, /api/lora-meta, /api/civitai/*, /api/output-dir, /start-comfy, /open-output） | 118,147 |

### 3.2 功能入口盤點（前端 UI）

| 功能 | 入口位置 | 操作元素 |
|------|---------|---------|
| 標籤選取 | 左側標籤庫（分類導航 + 標籤格） | 點標籤格 toggle；星星收藏；搜尋框；ENTER 加入第一個結果 |
| 補充描述（正向自由文字） | 左下 `#pos` textarea | 直接輸入中文/英文，即時寫 `ui.extra`；翻譯警告 `wchip` |
| 負面提示詞 | `#neg` 細節展開 | 清除 / 預設 / 複製 |
| 隨機組合 | 左下「隨機配一組」 / 舞台空狀態 | `Tags.applyRandomCombo()`，整組重選並清 `#pos` |
| 品質標籤開關 | 右設定 `q` | 加入 `masterpiece, best quality, ...` |
| 尺寸/張數/模型/步數/CFG/種子 | 右設定 | 寫入 `ui.settings` |
| 角色 LoRA 選取 | 右設定「角色 LoRA」 / 彈窗 `loraModal` | toggle 啟用、權重滑桿、觸發詞面板 |
| LoRA 觸發詞管理 | `loraModal` → 觸發詞面板 | 手動輸入（逗號分隔）、編輯/刪除 chip、自動加入開關、「不需要觸發詞」確認、本機 metadata 建議、Civitai 版本連結 |
| LoRA 探索中心（Civitai） | 右設定「探索」 | 公開搜尋、版本適配分類、觸發詞顯示（僅顯示，不寫入） |
| WD14 反推 | 頂列「圖片反推」按鈕 `btnReverse` → `revModal` | 拖放/貼上圖片、選模型（EVA02/ViT）、分類/模式篩選、點選標籤、批次選取、加入提示詞 |
| 歷史紀錄 | 舞台下方橫向條 `histBar`、燈箱 | 點縮圖開燈箱；卡片「同提示詞」 `reusePrompt`；燈箱「用同提示詞」「分類套用」 |
| 分類套用（角色/服裝/姿勢等替換） | 燈箱「分類套用」`lbApply` → `modal` | 快速替換（8 種預設）、分類勾選、候選標籤預覽、補充描述 keep/replace/merge |
| 完整提示詞預覽 | 底列「完整提示詞」`btnPreview` | `composePrompt()`，複製 |
| 生成 | 底列「生成」`go` / `Ctrl+Enter` | 一鍵生成，沒內容時自動配一組 |

### 3.3 後端 API 路由（server.py）

| 路由 | 方法 | 職責 | 前端呼叫者 |
|------|------|------|-----------|
| `/` | GET | 靜態首頁，前端路由回退 `index.html` | 瀏覽器 |
| `/comfy/*` | GET/POST | 透明代理到 ComfyUI（`/system_stats`, `/object_info/...`, `/prompt`, `/history/<pid>`, `/view`, `/queue`, `/interrupt`） | `app.js` `api()` |
| `/ws` | GET | WebSocket 隧道（改寫 Host/Origin） | `app.js` `connectWS()` |
| `/api/status` | GET | 回傳 `comfy`, `output`, `external`, `output_ok`, `output_error` | `app.js` `checkComfy()`, `applyOutputStatus()` |
| `/api/check` | POST | 檢查歷史圖片是否存在（HEAD /view） | `app.js` `syncGallery()` |
| `/api/delete` | POST | 刪圖（路徑、類型、SHA-256 比對） | `app.js` `doDelete()` |
| `/api/reverse` | POST | WD14 反推（驗證 MIME/魔術位元組/大小/尺寸 → 寫暫存檔 → Worker 推論） | `app.js` `rvRun()` |
| `/api/loras` | GET | 代理 ComfyUI `/models/loras` | `app.js` `refreshLoraList()` |
| `/api/lora-meta` | GET | 本機 LoRA metadata（`triggerWords` 等） | `app.js` `loadLoraMeta()` |
| `/api/civitai/search` | GET | Civitai 公開 LoRA 搜尋（代理，TLS 300s 快取） | `app.js` `cvRunSearch()` |
| `/api/civitai/status` | GET | Checkpoint 基底辨識（代理 Civitai） | `app.js` `cvLoadStatus()` |
| `/api/civitai/version` | GET | Civitai 特定版本 metadata（`trainedWords`） | `app.js` `loadCivMeta()` |
| `/api/civitai/key/*` | POST | 個人 API Key 儲存/測試/移除（DPAPI，不進前端） | `app.js` `cvKeySave/Test/Remove()` |
| `/api/output-dir` | POST | 設定輸出資料夾（同源、X-SimpleUI:1） | `app.js` `openOutputDirModal()` |
| `/start-comfy` | POST | 啟動 ComfyUI（`COMFY_LAUNCH_CMD`） | `app.js` `startComfy()` |
| `/open-output` | GET | 開啟輸出資料夾 | `app.js` `openFolder()` |

---

## 4. 現有資料結構

### 4.1 localStorage 持久化鍵（前端）

| Key | 格式 | 說明 | 擁有者 |
|-----|------|------|--------|
| `sel` | `[{t, w}, ...]` | 已選標籤陣列（英文標籤 + 權重） | `tags.js` `state.sel` |
| `combos` | 陣列 | 使用者儲存的標籤組合 | `tags.js` `state.saved` |
| `adult` | `"1"`/`"0"` | 成人標籤開關 | `tags.js` `state.adult` |
| `showEn` | `"1"`/`"0"` | 顯示英文標籤開關 | `tags.js` `state.showEn` |
| `ui.moreCats` | `"1"`/`"0"` | 更多分類展開 | `tags.js` |
| `ui.selSortMode` | `"manual"`/`"auto"` | 標籤排序模式 | `tags.js` `state.sortMode` |
| `ui.learnedTags` | `{general, positive, negative}` | 學習標籤（Phase 1） | `tags.js` `state.learned` |
| `ui.extra` | 字串 | 補充描述（`#pos` 原始輸入） | `app.js` |
| `ui.settings` | 物件 | `{size, n, quality, neg, steps, cfg, ckpt, seed}` | `app.js` `S.settings` |
| `ui.gallery` | 陣列（最多 24） | 歷史圖片紀錄（含 `sel`, `extra`, `neg`, `prompt`, `loras`） | `app.js` `S.gallery` |
| `ui.loras` | `{v, items[]}` | LoRA 設定（見 4.3） | `app.js` `S.loras` |
| `ui.tagStats` + `ui.tagStats.evt.*` + `ui.tagStats.fav.*` | 物件 | 標籤使用統計與收藏 | `tags.js` |
| `ui.genLog` | 陣列（最多 50） | 生成診斷紀錄 | `app.js` `logGen()` |
| `ui.advOpen` | `"1"`/`"0"` | 進階設定展開狀態 | `app.js` |

約束（`simple_ui/AGENTS.md` §8）：不得改變 `sel`/`combos`/`adult`/`showEn` 欄位格式，否則使用者存的組合會消失；補充描述用 `ui.extra`，**不得**重新讀取舊的 `pos` key。

### 4.2 Prompt 內部表示（app.js）

正向 Prompt 最終組裝（`composePrompt()`，`app.js:313-318`）：
```
[QUALITY (可選)] + Tags.buildPrompt() + loraTokens
```
其中 `Tags.buildPrompt()`（`tags.js:1001-1006`）：
```
sel.map(w===1 ? t : (t:w))  → join ", "  →  + Dict.tr(#pos.value)
```

`snapshotNow()`（`app.js:322-350`）生成前一次取齊快照：
```js
{
  sel,           // Tags.snapshot() 深拷貝 [{t,w}]
  pos,           // QUALITY + sel + extra + loraTokens 組裝後字串
  neg,           // #neg.value
  extraRaw,      // #pos 原始輸入
  ckpt, w, h, n, steps, cfg, seed,
  loras,         // loraSnapshot(S.loras)
  loraTokens     // loraTokensFromSnapshot(loras)
}
```

負面 Prompt：獨立 `#neg` textarea，`DEFAULT_NEG` 預設值（`app.js:13`），不與正向共用解析邏輯。

### 4.3 LoRA 資料結構（app.js LORA_CORE，`ui.loras`）

```js
{
  v: 1,
  items: [{
    name,              // ComfyUI 相對路徑＝穩定識別值（唯一鍵，小寫去重）
    display,           // 顯示名（預設檔名去副檔名）
    strength,          // 單一權重，同時給 MODEL/CLIP（-100~100，UI -2~2）
    triggers: [],      // 扁平字串陣列：個人觸發詞（唯一會注入 Prompt 的來源）
    autoTrigger: true, // 是否把 triggers 加進 positive prompt
    enabled: true,     // 選取狀態；移除＝false，保留其他設定
    authorSuggestions: {  // 只讀作者建議（不進快照/歷史）
      local: { groups: string[][] },
      civitai: { versionId, groups: string[][], fetchedAt, fingerprint }
    },
    noTriggerNeeded: false // 使用者明確確認「這個 LoRA 不需要觸發詞」
  }]
}
```
上限：`triggers` 最多 40 筆（`LORA_MAX_TRIGGERS`，`app.js:398`）；作者建議群組最多 20 組（`LORA_AUTHOR_GROUPS`，`app.js:401`）；單詞 ≤200 字（`LORA_AUTHOR_WORD_LEN`，`app.js:402`）。

正規化 `loraNorm()`（`app.js:406-408`）：小寫 + trim + `[_\s]+`→單一空白，用於去重比對。**不按逗號切割**；逗號切割僅在 `loraSaveTriggerInput()`（`app.js:2890`）手動輸入時發生。

### 4.4 WD14 反推結果（app.js RV_）

`/api/reverse` 回傳 `{ rating, general[], character[], timing }`（`app.js:3430-3433`）。前端 `RV.general` / `RV.character` 為陣列 `{name, score}`，底線形式（`long_hair`）。`matchTag()` 做正規化比對（底線/空白互通、`/` 同義別名）。

### 4.5 標籤分類（tags.js CATS + tag_categories.js）

- `tags.js` `CATS`：14 個靜態分類 + 動態「已學習·一般/正向/負面」分類，共 725 個 alias（英文:中文）。
- `tag_categories.js` `MAP`：10,959 筆英文標籤 → 10 分類（character/clothing/body/pose/expression/composition/background/style/adult/other）。
- 兩者分類規則**不一致**：例如 `long hair` 在 CATS 屬「頭髮」，在 TagCategories 屬 `character`；`blue eyes` 在 CATS 屬「臉&表情」，在 TagCategories 屬 `character`。

---

## 5. Prompt 與 Tag 資料流圖

```
文字/文字輸入                              資料流
─────────                                  ─────────
(1) 左側標籤點選 ──→ Tags.sel (localStorage sel)
                                    │
(2) #pos 補充描述 ──→ ui.extra ──→ Dict.tr() ──┐
                                    │          │
(3) LoRA 觸發詞 ──→ ui.loras.triggers ──→ loraTokensFromSnapshot() ──┤
                                    │          │                      ▼
(4) 品質標籤 QUALITY (設定開關) ─────────────────┤  composePrompt() → o.pos ──→ /prompt (ComfyUI)
                                    │          │                      │
(5) 負面 #neg ──→ ui.settings.neg ──────────────┤                      ▼
                                    │          │                  圖片輸出
(6) WD14 反推 ──→ RV.picked ──→ rvSplitPicked() ──→ addTags() / #pos ──┘
                                    │
(7) 歷史還原 reusePrompt() ──→ Tags.restore(it.sel) ──→ Tags.sel
                                    │          │
                                    └→ #pos = it.extra ──→ ui.extra
                                    └→ #neg = it.neg
                                    └→ ui.loras 被整組覆寫（若 it.loras 存在）

生成前快照 snapshotNow()：將 sel/pos/neg/loras 一次擷取，
與 /prompt payload 與 history 記錄同源（app.js:322-350）。
```

### 5.1 多筆 Prompt 更新方式並存（已確認問題點）

1. `Tags.buildPrompt()`（`tags.js:1001`）：即時讀 `#pos` + sel，**不含 QUALITY 與 LoRA**。
2. `composePrompt()`（`app.js:313`）：`QUALITY + buildPrompt() + loraTokens`，**實際送進模型**。
3. `snapshotNow()`（`app.js:322`）：生成前快照，與 `composePrompt()` 邏輯相似但獨立實作（各自拼接 `parts.join(", ")`）。
4. WD14 `rvMergePrompt()`（`app.js:3149`）與 `rvSplitPicked()`（`app.js:3176`）：獨立正規化 `rvPromptTokens()` / `normKey()`，與 `Tags.matchTag()` / `canonicalTag()` 並存。
5. 分類套用 `caMergeExtra()`（`app.js:1434`）：第三套補充描述合併邏輯。
6. `reusePrompt()`（`app.js:1210`）：整組覆寫 sel / #pos / #neg / ui.loras。

---

## 6. 各功能呼叫關係

### 6.1 讀 Prompt 的功能
- `generate()` → `snapshotNow()` → `Tags.buildPrompt()`、`#pos`、`#neg`、`loraTokensFromSnapshot()` → `/prompt`。
- `showPromptModal()` → `composePrompt()`（僅預覽/複製，不修改）。
- `reusePrompt(it)` → 讀取 `it.sel`, `it.extra`, `it.neg`, `it.prompt`（僅顯示）。
- 分類套用 `caCurrentPlan()` → `window.Tags.snapshot()`（讀目前 sel）+ `CA.it.sel`（讀歷史）。
- WD14 `rvApply()` → `rvSplitPicked(Array.from(RV.picked), window.Tags.selected(), posBefore, ...)`（讀目前 sel 與 #pos）。
- `logGen()`、`recordGeneration()`：寫入診斷與統計。

### 6.2 修改 Prompt 的功能
- `#pos` input 事件 → 即時寫 `ui.extra`（`app.js:3687-3691`）。
- `#neg` input/change 事件 → `persistSettings()`（`ui.settings.neg`）。
- `Tags.addTags()`（標籤點選、WD14 加入）→ 修改 `state.sel` → 寫 `sel`。
- `Tags.restore()`（歷史還原、分類套用）→ 整組替換 `state.sel`，切 `manual` 模式。
- `rvApply()` → `addTags()`（底部列）或 `$("pos").value = merged.text` + `ui.extra`（補充描述）。
- `caCommit()` → `Tags.restore(plan.nextSel)` + `$("pos").value = CA.extraText` + `ui.extra`。
- `surpriseCombo()` → `applyRandomCombo()`（整組重選）+ 清 `ui.extra`。
- `Tags.clear()` → 清 `sel`、`#pos`、`ui.extra`。

### 6.3 覆蓋 Prompt 的功能（高風險）
- `reusePrompt(it)`（`app.js:1210-1239`）：`Tags.restore(it.sel)` 整組替換目前標籤；`#pos = it.extra` 覆蓋 `ui.extra`；`#neg = it.neg`；**若 `it.loras` 存在，整組覆寫 `ui.loras`**（使用者可能只想 copy 文字，卻連 LoRA 角色一起換掉）。
- 分類套用 `caCommit()`（`app.js:1620-1637`）：`Tags.restore(plan.nextSel)` 替換目前 sel；若 `extraMode !== "keep"` 覆蓋 `#pos` / `ui.extra`。
- `surpriseCombo()`：清 `#pos` + `ui.extra`，整組換標籤（使用者未預期時會遺失輸入中的補充描述）。

### 6.4 獨立資料狀態（不共用，易產生不同步）
| 狀態 | 儲存位置 | 與 Prompt 的關係 | 問題 |
|------|---------|-----------------|------|
| `ui.loras` (triggers/autoTrigger/enabled) | localStorage | `loraTokensFromSnapshot()` 於生成時附加到 pos | 作者建議 `authorSuggestions` 不進快照/歷史，歷史還原時 `authorSuggestions` 從「目前」LoRA 取（`reusePrompt` `app.js:1226`） |
| `ui.extra` (#pos) | localStorage | 正向 Prompt 一部分 | `syncExtraFromStorage()` 有「編輯中保護」（`app.js:374`），但 `reusePrompt` 會無條件覆蓋 |
| `ui.settings.neg` | localStorage | 負面 Prompt | 與 `#pos` 分開管理，兩套 UI（負面細節展開 vs 左下補充描述） |
| `ui.gallery` (history items) | localStorage | 歷史 Prompt 快照 | `reusePrompt` 會覆蓋目前設定；舊歷史無 `loras` 欄位時保持目前 LoRA |
| `ui.tagStats` / evt / fav | localStorage | 僅統計，不影響 Prompt | 獨立於 `sel`，多個 key 碎片化 |

### 6.5 重複的解析／分類／去重／序列化實作
1. 標籤正規化去重：`tags.js` `norm()`（`tags.js:616`、`tags.js:287-292` `tagAlts`）、`app.js` `loraNorm()`（`app.js:406`）、`app.js` `normKey()`（`app.js:3125` WD14）、`app.js` `caNorm()`（`app.js:1247` 分類套用）、**四套獨立實作**，規則略有差異（皆為小寫+底線/空白折疊，但函式名稱與位置分散）。
2. 權重外框 `(tag:1.2)` 拆解：`tags.js` `canonicalTag()`（`tags.js:95`）、`app.js` `rvPromptTokens()`（`app.js:3136`）、`app.js` `caPromptTokens()`（`app.js:1427`）、**三套**。
3. 逗號/換行分割：`tags.js` `addTags()`（拒絕含逗號）、`app.js` `loraSaveTriggerInput()`（`/[\r\n]+/`）、`app.js` `rvPromptTokens()`（`/[,\r\n]+/`）、`app.js` `caMergeExtra()`（`/[,\r\n]+/`）、**四套**。
4. 分類查詢：`tags.js` `matchTag()`（CATS）、`app.js` `caInfo()`（TagCategories.of）、`app.js` `rvCatOf()`（TagCategories.of）、**三套**，且 CATS 與 TagCategories 分類規則不一致。
5. 序列化：`tags.js` `save()`、`saveLearned()`、`commit()`、`loraSerialize()`、`loraParseItems()`、`loraParseState()`，**多處白名單式重建**，新增欄位易遺漏（既存審查報告 §10.1 已指出）。

---

## 7. UX 操作流程及問題

以下以「完全沒有技術背景的一般使用者」為對象，分析 9 個流程。問題標記：`[已確認]`（有程式碼/報告證據）、`[高度懷疑]`（邏輯推論，未實測）、`[改善建議]`（非缺陷）。

### 流程 1：從零開始選擇標籤並生成圖片
**路徑**：開頁（左側標籤庫空）→ 點分類 → 點標籤 → 底列出現 pill → 調權重 → 按「生成」。

| 問題 | 說明 | 位置 | 等級 |
|------|------|------|------|
| 沒選標籤時按生成，會「自動幫配一組」 | `generate()` 偵測 `!Tags.hasContent()` 呼叫 `surpriseCombo()`，清 `#pos` + `ui.extra`，整組換標籤。使用者可能以為只是「生成」，實際上自己的補充描述被清掉。 | `app.js:850-853`, `app.js:300-310` | [已確認] 資料遺失風險 |
| 品質標籤自動加入但無法在主流程細調 | 只有右設定 `q` 開關，無法單獨挑哪幾個品質詞。 | `app.js:315`, `app.js:3005-3009` | [改善建議] |
| 「幫我配一組」與「生成」按鈕文字混用 | 無內容時按鈕顯示「幫我配一組」，有內容時顯示「生成」，同一顆按鈕兩種語意。 | `app.js:3085-3087` | [高度懷疑] 認知衝突 |

### 流程 2：搜尋並加入標籤
**路徑**：搜尋框輸入 → 結果顯示 → 點標籤 / ENTER 加入第一個。

| 問題 | 說明 | 位置 | 等級 |
|------|------|------|------|
| 搜尋 ENTER 直接加入第一個結果，無預覽 | 可能誤加錯標籤，須再移除。 | `tags.js:935-943` | [高度懷疑] |
| 搜尋結果與目前選取無法直覺區分 | `on` 類別標記，但成人標籤、已選狀態交雜。 | `tags.js:448-476` | [改善建議] |
| 18+ 開關關閉時成人標籤完全消失，無提示 | 使用者可能以為標籤「不見了」，而非被隱藏。 | `tags.js:425-427`, `tags.js:857-866` | [高度懷疑] |

### 流程 3：手動編輯 Prompt
**路徑**：左下 `#pos` 補充描述 / `#neg` 負面 / 底列「完整提示詞」預覽。

| 問題 | 說明 | 位置 | 等級 |
|------|------|------|------|
| `#pos` 與 `ui.extra` 雙重寫入 | 輸入即寫 `localStorage`；跨分頁 `syncExtraFromStorage()` 可能覆蓋正在編輯的內容（有「編輯中保護」但僅限本分頁 focus）。 | `app.js:3687-3691`, `app.js:369-382` | [已確認] 跨分頁不同步風險 |
| 負面提示詞與正向補充描述分離在不同區塊 | 使用者難以看出哪些字進正面、哪些進負面。 | `index.html:82-119` | [改善建議] |
| 「完整提示詞」預覽與實際送出不完全一致 | `showPromptModal()` 用 `composePrompt()`，與 `snapshotNow()` 邏輯相似但獨立，未來若一方改動另一方未改，會出現預覽與實際不符。 | `app.js:313-350`, `app.js:1782-1804` | [高度懷疑] |

### 流程 4：使用 WD14 反推結果
**路徑**：頂列「圖片反推」→ 拖放/貼上圖片 → 選模型 → 「反推標籤」→ 分類/模式篩選 → 點選標籤 → 「加入提示詞」。

| 問題 | 說明 | 位置 | 等級 |
|------|------|------|------|
| 反推結果不自動套用，需人工點選 | 設計如此（避免自動注入雜訊），但使用者可能以為按「反推標籤」就會加入提示詞。 | `app.js:3479-3480`, `app.js:3545-3579` | [設計意圖，非缺陷] |
| 已知標籤進底列、未知標籤進 `#pos`，兩條路徑 | `rvSplitPicked()` 依 `matchTag()` 分流；使用者難以預測哪個詞進哪裡。 | `app.js:3176-3195`, `app.js:3556-3568` | [已確認] 兩套寫入路徑 |
| WD14 未安裝時「圖片反推」按鈕仍可點，錯誤才在點「反推標籤」後出現 | 使用者先做了一輪操作才知道功能不可用。 | `server.js` `/api/reverse` 503；`app.js:3414-3428` | [高度懷疑] 入口應提前灰階或提示 |

### 流程 5：從歷史紀錄重新使用 Prompt
**路徑**：舞台下方歷史縮圖 / 燈箱 → 「用同提示詞」 `reusePrompt(it)`。

| 問題 | 說明 | 位置 | 等級 |
|------|------|------|------|
| 「同提示詞」整組覆蓋目前設定 | `Tags.restore(it.sel)` 替換目前全部標籤、`#pos = it.extra` 覆蓋 `ui.extra`、`#neg = it.neg`，且若 `it.loras` 存在還整組覆寫 `ui.loras`。使用者可能只想借文字，卻連角色 LoRA 一起換掉。 | `app.js:1210-1239` | [已確認] 覆蓋風險（既存審查報告 §10.2） |
| 舊歷史無 `loras` 欄位時保持目前 LoRA，有 `loras: []` 則清空角色 | 行為不一致，使用者難以預期。 | `app.js:1217-1236` | [已確認] 相容性陷阱 |
| 歷史 `prompt` 欄位僅供顯示，實際還原用 `sel`/`extra` | `it.prompt` 是翻譯後完整字串，可能與 `it.extra`（原始中文）內容不同，使用者以為「同提示詞」會還原 `prompt` 顯示內容，實際不然。 | `app.js:957-969`, `app.js:1211-1213` | [已確認] 認知落差 |

### 流程 6：只替換歷史 Prompt 中的角色
**路徑**：燈箱「分類套用」`lbApply` → 「只換角色」預設 → 預覽移除/加入 → 「套用」。

| 問題 | 說明 | 位置 | 等級 |
|------|------|------|------|
| `character` 分類含髮型/髮色/眼睛/人數/年齡等通用外觀，一鍵換角色會連帶刪除這些 | `CA_GENERIC_CHAR` 嘗試過濾，但預設僅「建議」而非自動；使用者若勾選整個 character 分類，仍會誤刪外觀標籤。 | `app.js:1263-1306` | [已確認] 分類定義不精確（既存審查報告 §4.2） |
| 角色專名散在多個分類（clothing 的 cosplay、expression 的角色表情） | 只換 `character` 會留下舊角色的專屬服裝/表情，造成「角色 B + 角色 A 衣服」衝突。 | `app.js:1279-1300`, 既存報告 §3.2 | [已確認] |
| 方向矛盾：以「目前為底換歷史角色」 vs 「以歷史為底換目前角色」 | 需求文本兩方向不可同時成立，預設模型 A（目前為底）但按鈕文案「只換角色」易誤解。 | `app.js:1493-1550` (UI 文案), 既存報告 §4.1 | [高度懷疑] 文案與行為不符 |

### 流程 7：使用 LoRA 及管理 Trigger Words
**路徑**：右設定「選擇」→ `loraModal` → 選 LoRA → 觸發詞面板 → 手動輸入 / 從建議詞加入 / 開啟「自動加入提示詞」。

| 問題 | 說明 | 位置 | 等級 |
|------|------|------|------|
| 作者建議與個人觸發詞「視覺上合併」後無法區分來源 | `use-meta` 將 `authorSuggestions.local.groups` `concat` 進 `it.triggers`（`app.js:2932-2934`），加入後即為個人詞，metadata 更新無法安全刷新。 | `app.js:2932-2934`, `app.js:454-455` | [已確認] 來源不可區分（既存審查報告 §A7） |
| 作者建議已更新（fingerprint 變），UI 只顯示「作者建議已更新」不自動覆蓋 | 設計正確，但使用者若先手動編輯過 triggers，再「整組加入」可能產生重複（雖有去重）。 | `app.js:2760-2766`, `app.js:2798-2816` | [高度懷疑] |
| `noTriggerNeeded` 一經確認即靜默，使用者日後忘記該 LoRA 原本需要詞 | 僅在 LoRA 列顯示「已確認不需要觸發詞」，無集中檢視。 | `app.js:1874-1880`, `app.js:2946-2950` | [改善建議] |
| Civitai 版本連結需手動貼 URL，無本機檔案→Civitai 自動對應 | 使用者須自行到 Civitai 找版本頁面複製網址。 | `app.js:2819-2850`, 既存報告 §13.1 | [高度懷疑] 使用門檻高 |
| LoRA 探索中心顯示 `trainedWords` 僅供參考，無「套用到本機 LoRA」路徑 | 使用者在探索中心看到建議詞，無法直接帶入本機 LoRA 觸發詞。 | `app.js:2324`, `app.js:2474` | [已確認] 入口斷裂（既存報告 §A8.3） |

### 流程 8：同時使用標籤、自由文字與 LoRA
**路徑**：點標籤 + `#pos` 輸中文 + 選 LoRA（開自動加入）→ 生成。

| 問題 | 說明 | 位置 | 等級 |
|------|------|------|------|
| 三種來源（標籤、#pos、LoRA triggers）合併後無法在 UI 上看見「哪個詞來自哪裡」 | `composePrompt()` 直接拼接，無來源標記；`showPromptModal()` 僅顯示最終字串。 | `app.js:313-318` | [已確認] 來源不可區分 |
| LoRA `autoTrigger=false` 時觸發詞仍保存在快照/歷史，但不進 Prompt | 設計正確（職責分離），但使用者難以看出「為什麼明明設了觸發詞卻沒出現在圖中」。 | `app.js:654-668`, `app.js:833-839` | [高度懷疑] 需更明確提示 |
| `#pos` 中文翻譯失敗的詞會以橘色 `wchip` 提示，但點擊後只搜尋標籤，不自動替換 | 使用者仍需手動點標籤取代。 | `app.js:3090-3098`, `app.js:3697-3704` | [改善建議] |

### 流程 9：修改已存在的 Prompt，再次生成
**路徑**：歷史「同提示詞」或燈箱「用同提示詞」→ 修改 `#pos`/標籤/LoRA → 按「生成」。

| 問題 | 說明 | 位置 | 等級 |
|------|------|------|------|
| `reusePrompt` 後切到 `manual` 排序模式，使用者原本的自動排序偏好被改掉 | `Tags.restore()` 強制 `sortMode = "manual"`。 | `tags.js:1027-1028` | [已確認] 狀態副作用 |
| 修改後生成，`snapshotNow()` 再次擷取，與 `ui.gallery` 舊紀錄並存，無版本概念 | 使用者難以知道哪次生成對應哪個 Prompt 版本（只有縮圖 + 時間戳）。 | `app.js:957-969`, `app.js:322-350` | [改善建議] |
| 生成失敗時 `S.results` 保留舊結果，使用者可能以為新圖已出 | `generate()` catch 分支 `showStage(S.results.length ? "results" : "empty")`。 | `app.js:1000-1004` | [高度懷疑] 狀態殘留 |

---

## 8. 已確認的邏輯衝突

| # | 衝突 | 證據（檔案:行） | 嚴重度 |
|---|------|----------------|--------|
| 1 | `reusePrompt()` 整組覆寫目前 `ui.loras`（含 LoRA 角色），使用者可能只想 copy 提示詞文字 | `app.js:1217-1236`；既存審查報告 §10.2、§A7 | 高（資料遺失/覆蓋） |
| 2 | 作者建議與個人觸發詞合併後來源不可區分，metadata 更新無法安全刷新 | `app.js:2932-2934`（`use-meta` concat）；`app.js:454-455`；既存報告 §A7 | 高（資料所有權不清） |
| 3 | 四套獨立正規化/去重實作（`norm`, `loraNorm`, `normKey`, `caNorm`）與三套權重外框拆解，規則略有差異 | `tags.js:616`, `app.js:406`, `app.js:3125`, `app.js:1247`；`tags.js:95`, `app.js:3136`, `app.js:1427` | 中（技術債，不一致風險） |
| 4 | `Tags.restore()` 強制 `sortMode = "manual"`，歷史還原副作用改變使用者排序偏好 | `tags.js:1027-1028` | 中（狀態副作用） |
| 5 | CATS 與 TagCategories 分類規則不一致（如 `long hair`：CATS「頭髮」 vs TagCategories `character`），分類套用以 TagCategories 為準，可能與使用者直覺的分類不符 | `tags.js:10-23` vs `tag_categories.js` MAP；既存報告 §3.1-3.2 | 中（認知衝突） |
| 6 | `composePrompt()`、`snapshotNow()`、`Tags.buildPrompt()` 三處 Prompt 組裝邏輯獨立，未來改一方易導致預覽與實際不符 | `app.js:313-318`, `app.js:322-350`, `tags.js:1001-1006` | 高（預覽/實際不一致） |

---

## 9. 尚待驗證的疑似問題

| # | 疑似問題 | 需驗證方式 | 等級 |
|---|---------|-----------|------|
| 1 | 跨分頁同步：`storage` event 觸發 `syncSharedState()`，若多分頁同時編輯 `#pos`，最後寫入者勝出，可能覆蓋未完成輸入 | 開兩個分頁同時輸入 `#pos`，觀察 `ui.extra` 最終值 | 高 |
| 2 | WD14 未設定時「圖片反推」按鈕仍可點擊，錯誤延遲到推論時才顯示 | 檢查 `app.js:3713` 綁定與 `server.py` `/api/reverse` 503 路徑 | 中 |
| 3 | `loraParseItems()` / `loraSerialize()` / `reusePrompt()` 白名單式重建，若未來新增 LoRA 欄位遺漏任一處會靜默丟失 | 程式碼審查（已由既存報告 §10.1 指出，尚未實測） | 高 |
| 4 | `ui.loras` 歷史項目 `enabled` 欄位：歷史紀錄不存 `enabled`，還原時一律 `true`（既存報告 §A6），使用者先前停用的 LoRA 還原後會重新啟用 | 程式碼審查 `app.js:1224` | 中 |
| 5 | `loraCleanTriggers()` 不按逗號切割，若使用者貼入「amora, blonde hair」會當成單一 chip | 程式碼審查 `app.js:439-450` vs `app.js:2890` | 中 |

---

## 10. 重複實作及技術債清單

| # | 項目 | 位置 | 說明 |
|---|------|------|------|
| 1 | 標籤正規化去重四套 | `tags.js:616` (`norm`), `app.js:406` (`loraNorm`), `app.js:3125` (`normKey`), `app.js:1247` (`caNorm`) | 可統一為單一 `normTag()` |
| 2 | 權重外框 `(tag:1.2)` 拆解三套 | `tags.js:95` (`canonicalTag`), `app.js:3136` (`rvPromptTokens`), `app.js:1427` (`caPromptTokens`) | 可統一 |
| 3 | 逗號/換行分割四套 | `tags.js:1038` (`addTags` 拒絕逗號), `app.js:2890` (`loraSaveTriggerInput`), `app.js:3133` (`rvPromptTokens`), `app.js:1438` (`caMergeExtra`) | 行為不一致（有的拒絕、有的切割） |
| 4 | 分類查詢三套 | `tags.js:1048` (`matchTag` 用 CATS), `app.js:1254` (`caInfo` 用 TagCategories), `app.js:3251` (`rvItems` 用 matchTag + TagCategories) | CATS 與 TagCategories 分類不一致 |
| 5 | Prompt 組裝三處 | `tags.js:1001` (`buildPrompt`), `app.js:313` (`composePrompt`), `app.js:322` (`snapshotNow`) | 建議統一為單一 `buildFullPrompt()` |
| 6 | 補充描述合併三套 | `app.js:3149` (`rvMergePrompt`), `app.js:1434` (`caMergeExtra`), `app.js:322` (`snapshotNow` 直接拼接) | 可統一 |
| 7 | `app.js` 單一巨檔（3,988 行）混合生成、LoRA、Civitai、WD14、分類套用、歷史、快捷鍵 | `app.js` 全檔 | 雖以 `/* ==== XXX_START ==== */` 標記純資料層，但 DOM 與邏輯未分離，維護難度高 |
| 8 | localStorage 鍵碎片化 | `sel`, `combos`, `adult`, `showEn`, `ui.extra`, `ui.settings`, `ui.gallery`, `ui.loras`, `ui.tagStats` + evt/fav/broken, `ui.genLog`, `ui.learnedTags`, `ui.advOpen` | 無統一命名空間管理，遷移/清除風險 |

---

## 11. 建議的統一資料模型（僅為建議，未實作）

建議採用「來源區分 + 唯一注入點」模型：

### 11.1 Prompt 組成（單一權威來源）
```
prompt = qualityTags + selectedTags(with weight) + freeText + loraAutoTriggers
```
- `selectedTags`：`{t, w}` 陣列，來自 `ui.loras`（`sel` localStorage）。
- `freeText`：`ui.extra`（#pos，原始輸入），經 `Dict.tr()` 翻譯。
- `loraAutoTriggers`：僅 `autoTrigger === true` 的 LoRA `triggers`，跨 LoRA 去重。
- 負面：獨立 `neg`（`ui.settings.neg`）。

### 11.2 LoRA 觸發詞（作者與個人分離，方案 C 輕量版，參考既存審查報告 §7.4-§12）
```js
{
  name, display, strength, triggers, autoTrigger, enabled,   // 現有，不變
  author: { source, versionId, fingerprint, fetchedAt, groups: [{index, words[]}], stale } | null,
  noTriggerNeeded: false
}
```
- `triggers` 仍是唯一注入 Prompt 的來源；作者詞只能透過「加入」動作複製進 `triggers`，複製後即為個人詞。
- `author` 僅讀，metadata 更新只更新 `author`，不碰 `triggers` / `noTriggerNeeded`。
- `author` 欄位需同步加入 `loraParseItems`、`loraSerialize`、`loraSet`、`reusePrompt`、`loraSnapshot` 三處白名單（既存報告 §10.1 陷阱）。

### 11.3 歷史紀錄（gallery item）
保留現有 `{url, filename, seed, w, h, sel, extra, neg, prompt, loras, at}`，若要在「同提示詞」後仍能提醒作者建議，需將 `loras` 中的 `author` / `noTriggerNeeded` 亦存入（現有 `loraSnapshot()` 僅存五個欄位，`app.js:641-650`）。

---

## 12. 建議的整體 UX 架構（僅為建議）

1. **單一 Prompt 編輯器**：將 `#pos`（補充描述）、標籤列、LoRA 觸發詞、負面提示詞整合為「提示詞編輯」單一概念，各來源可展開/摺疊，並標示來源（標籤 / 自由文字 / LoRA 自動 / 手動加入）。
2. **歷史「套用」分層**：分「只套用提示詞文字」（不動 LoRA / 目前標籤）與「完整還原（含 LoRA、負面、尺寸）」兩個明確動作，避免 `reusePrompt` 意外覆蓋。
3. **角色替換預覽先行**：分類套用的「移除/加入」兩欄預覽（已實作 `caPlanApply`）應在按下確認前可見，且「只換角色」應預設僅勾選 `name-certain` 角色專名，不勾選 `generic` 髮型/眼睛/人數。
4. **LoRA 觸發詞**：作者建議唯讀陳列（群組 1 / 群組 2），個人詞獨立編輯，「自動加入」開關與「不需要觸發詞」確認分開，生成前若啟用 LoRA 且無觸發詞且無建議，給非阻塞行內提示（不擋生成）。
5. **WD14 反推**：保留「人工確認後加入」設計；可加入「一鍵加入目前分類全部」已實作（`rvSetVisible`）；未安裝 WD14 時「圖片反推」入口應灰階並顯示說明。

---

## 13. 舊功能相容性及遷移風險

| 風險 | 說明 | 緩解 |
|------|------|------|
| `sel`/`combos`/`adult`/`showEn` 欄位格式 | `simple_ui/AGENTS.md` §8 禁止改變，否則使用者存的組合會消失 | 任何整合皆不改這四個 key 格式 |
| `ui.extra` 與舊 `pos` key | §3 強制：不得讀舊 `pos`，`ui.extra` 為唯一補充描述 key | 保持現行 |
| 舊 `ui.loras` 缺 `author`/`noTriggerNeeded` 欄位 | `loraParseItems` 已以預設值回退（`authorSuggestions: loraAuthorDefault()`, `noTriggerNeeded: false`） | 新欄位加入時維持此回退 |
| 舊 `ui.gallery` 無 `loras` 欄位 | `reusePrompt` 已判斷 `Array.isArray(it.loras)`，無該欄位時保持目前 LoRA | 保持現行防禦 |
| 舊歷史缺新欄位（若未來加 `author`） | `loraParseItems` / `reusePrompt` 需容許缺欄位 | 新欄位皆為選用，預設 `null` / `false` |
| 分類套用 `Tags.restore()` 切 `manual` 模式 | 舊行為，與現有完整套用一致；若 partial apply 需保留排序模式，需新增 API | 先接受既有行為，報告註記 |

---

## 14. 建議的分階段實作順序（建議，未實作）

1. **Phase 0（盤點完成）**：本報告，確認架構問題與技術債。
2. **Phase 1**：統一 Prompt 組裝為單一 `buildFullPrompt()`（合併 `buildPrompt`/`composePrompt`/`snapshotNow` 組裝邏輯），消除預覽與實際不符風險。
3. **Phase 2**：LoRA Trigger Words 方案 C 輕量版（加 `author` / `noTriggerNeeded`，同步三處白名單），不改 `triggers` 語義。
4. **Phase 3**：歷史「套用」分層（僅文字 vs 完整還原），避免 `reusePrompt` 意外覆蓋 LoRA。
5. **Phase 4**：分類套用角色替換預覽優化（`name-certain` 預勾、`generic` 預不勾，文案與行為一致）。
6. **Phase 5**：重複實作整理（統一正規化、去重、分割、合併函式）。

---

## 15. 測試覆蓋及後續驗收建議

### 15.1 現有測試（僅供參考，未重跑）
- `devtools/lora_core_test.mjs`：LoRA 核心 17 項測試（參考既存報告 `lora-phase1.md:5.2`）。
- `devtools/lora_ui_test.mjs`、`devtools/lora_explorer_core_test.mjs`、`devtools/lora_explorer_api_test.py`：LoRA UI 與 API。
- `devtools/lora_personal_key_test.py` / `lora_personal_key_ui_test.mjs`：API Key（不可碰 Key 值）。
- `devtools/test_ui_control_wd14.ps1`、`devtools/wd14_*`：WD14 相關。
- 註：本輪未執行任何測試（唯讀、禁止連正式服務）。

### 15.2 建議驗收（未來實作時）
1. `node --check app.js tags.js dict.js tag_categories.js`、`python -m py_compile server.py`。
2. 開 `http://127.0.0.1:7860/?v=N` 強制換文件；確認 Console 0 錯誤、`document.documentElement.scrollHeight <= innerHeight`、右欄未裁切。
3. 測試 `reusePrompt` 不意外覆蓋 `ui.loras`（新增「僅文字」選項後）。
4. 測試 LoRA `author` 欄位在 `loraSave`/`loraParseItems`/`reusePrompt` 三處不丟失。
5. 測試跨分頁 `#pos` 同時編輯不互相覆蓋未完成輸入。
6. WD14 未安裝時「圖片反推」入口行為（灰階/提示）。

---

## 16. 尚未解決的問題

1. 本機 LoRA ↔ Civitai 版本的自動對應：目前無 API，使用者需手動貼版本 URL（既存報告 §13.1）。
2. `trainedWords` 語意官方未定義，「哪一組是角色詞」由使用者端決定，需產品負責人確認文案與免責。
3. 跨分頁 `#pos` 同時編輯的衝突處理（最後寫入者勝出）是否可接受。
4. `app.js` 單一巨檔拆分優先序（是否保留 IIFE + `window.Tags`/`window.Dict` 全域模式）。
5. 歷史紀錄是否需要 Prompt 版本概念（目前只有縮圖 + 時間戳）。

---

## 17. Git 最終狀態（報告寫入後）

- 本報告為**唯讀調查**，不執行 Git 寫入。
- 調查開始時：Branch `main`，HEAD `cf5609e0...`，Ahead 1 / Behind 0，Staged 0，Tracked Modified 13 個，Untracked 48 個 porcelain 項目（80 檔）。
- 調查期間未修改任何 tracked 檔案，未 stage/commit/push/reset/restore/stash/checkout/clean。
- 唯一新增檔案：`devtools/reports/prompt-tag-system-consolidation-audit.md`（本報告，untracked）。
- 正式服務未受影響：未停止/重啟 ComfyUI、simple_ui（7860）、WD14 Worker；未連接 7860/8188；未發出 `/prompt`、`/interrupt`、`/queue`；未讀取 API Key；未下載模型；唯一外部網路為既存審查報告已完成的 3 筆匿名 Civitai 公開 GET（該報告為過往工作，本輪未重複）。

---

**結論**：本調查已完整盤點 Prompt 與 Tag 全系統。主要確認問題為：`reusePrompt` 整組覆蓋（含 LoRA）、作者與個人觸發詞來源混在同一 `triggers` 欄位、三處獨立 Prompt 組裝邏輯、四套正規化/去重實作、`app.js` 單一巨檔多功能混雜。建議依第 14 節分階段整合，**本次不開始實作**。