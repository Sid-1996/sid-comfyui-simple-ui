# Sid-simple-ui Prompt / Tag 統一資料模型設計補正（A2-R1）

- **日期**：2026-11-27
- **專案**：`C:\ComfyUI\simple_ui`（`Sid-1996/sid-comfyui-simple-ui`）
- **性質**：**唯讀架構設計補正**，不開始實作。未修改任何程式碼、設定、使用者資料；未執行 Git 寫入；未重啟服務；未生成圖片；未讀取 API Key。
- **交付**：本報告僅作為後續整合的設計依據，並**不覆蓋** `devtools/reports/prompt-tag-system-a2-data-model-design.md`（A2 原始報告）。
- **相依報告**：
  - `devtools/reports/prompt-tag-system-consolidation-audit.md`（全系統盤點）
  - `devtools/reports/lora-trigger-words-a1-audit.md`（LoRA Trigger Words 深入調查）
  - `devtools/reports/prompt-tag-system-a2-data-model-design.md`（A2 原始報告，本報告為其補正）

---

## 1. 任務目標及範圍

修正 A2 報告中的事實錯誤、資料模型矛盾及遷移策略缺口，產出可供 ChatGPT 獨立審查的完整設計。核心修正方向：

1. 正確區分 Tag DB 原始資料、使用者目前選取狀態、使用者手動輸入、生成時組裝結果四類資料，不再混為一談。
2. 正確描述三處 Prompt 組裝函式的重複責任，不在缺乏證據時宣稱實際輸出已不一致。
3. 重新分類 A1 發現，區分「現行設計決策」與「程式缺陷／UX 限制」。
4. 重新設計 Prompt Entry / Source Model，明確 owner / origin / provenance 與 adopted metadata 關係。
5. 明確 PromptModel 權威來源與既有狀態的同步關係，若無法成為唯一權威則提出漸進方案。
6. 明確 PromptComposer 完整語意，僅負責文字組裝，不混入 Workflow LoRA Loader 責任。
7. 歷史快照與遷移明確區分「提示詞重現」與「完整生成條件重現」。

調查範圍涵蓋 A2 任務第二至第九節全部內容。

---

## 2. Repository / Git 基準

查詢方式：`git -C C:\ComfyUI\simple_ui status -sb`

| 項目 | 結果 |
|------|------|
| Repository 根目錄 | `C:\ComfyUI\simple_ui` |
| Branch | `main` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| Ahead / Behind | `1` / `0` |
| Staged | 0 |
| Tracked Modified | 13 個（`AGENTS.md`, `app.css`, `app.js`, `devtools/lora_api_test.py`, `devtools/lora_core_test.mjs`, `devtools/lora_explorer_api_test.py`, `devtools/lora_explorer_core_test.mjs`, `devtools/lora_mock_civitai.py`, `devtools/lora_ui_test.mjs`, `devtools/test_ui_control_wd14.ps1`, `index.html`, `server.py`, `ui_control.ps1`, `ui_panel.ps1`, `ui_panel.pyw`） |
| Untracked | 48 個 porcelain 項目（80 個檔案），含 `devtools/reports/` 與本輪新增的 `devtools/reports/prompt-tag-system-a2-r1-design-correction.md` |
| CodeGraph 索引 | `codegraph status` 因環境中 `pwsh.exe` 為 0 bytes 無效別名無法執行；上一輪已知索引過期（Added 5 / Modified 6，未執行 `codegraph sync`）。所有程式碼位置與行號以直接 Read 磁碟原始碼為準。 |

---

## 3. 現況資料模型修正（事實層）

### 3.1 四類資料正確區分

現行程式碼並未將四類資料全部混在 `state.sel` 或 `o.pos`。正確的區分如下：

| 類別 | 儲存位置 | 程式碼位置 | 說明 |
|------|----------|------------|------|
| 1. Tag DB 原始資料 | `tags.js` `CATS` 陣列 + `tag_categories.js` `MAP` | `tags.js:9-23`、`tag_categories.js` | 靜態標籤庫，執行期由 `ensureLearnedCategory()` 動態插入「已學習」分類（`tags.js:700-726`） |
| 2. 使用者目前選取狀態 | `tags.js` `state.sel` `[{t,w}]` + localStorage `sel` | `tags.js:260-280`、`tags.js:294-303` | 使用者點選的標籤陣列，具有權重 `w` 與順序 |
| 3. 使用者手動輸入 | `localStorage` `ui.extra` + DOM `#pos` textarea | `app.js:3683-3691`、`index.html:90-91` | 補充描述原始文字，即時寫入 `ui.extra` |
| 4. 生成時組裝結果 | `app.js` `snapshotNow()` → `o.pos` 字串 + `/prompt` payload | `app.js:322-350`、`app.js:895-901` | 生成前一次取齊的最終正面 Prompt 字串 |

### 3.2 三處 Prompt 組裝函式（重複責任，未證實輸出不一致）

現行有三處獨立實作 Prompt 組裝，責任分散，但**程式碼層面未證實實際輸出已不一致**。未來若一方修改另一方未同步，才會產生預覽與實際生成不一致的風險。

| # | 函式 | 位置 | 職責 | 包含內容 |
|---|------|------|------|----------|
| 1 | `Tags.buildPrompt()` | `tags.js:1001-1006` | 標籤 + 補充描述組裝（預覽用） | `state.sel`（帶權重） + `Dict.tr(#pos.value)`，**不含 QUALITY，不含 LoRA** |
| 2 | `composePrompt()` | `app.js:313-318` | 實際送進模型的正面 Prompt | `QUALITY`（可選） + `buildPrompt()` + `loraTokensFromSnapshot()` |
| 3 | `snapshotNow()` | `app.js:322-350` | 生成前快照（供 history 與 payload） | `QUALITY`（可選） + `sel` 帶權重 + `Dict.tr(#pos)` + `loraTokens`，另回傳 `extraRaw` |

三處函式的共同點：皆對 `state.sel` 做 `s.w === 1 ? s.t : (t:w)` 權重格式化，皆對 `#pos` 執行 `Dict.tr()`，皆以 `, ` 連接。差異點：`snapshotNow()` 多保存 `extraRaw`；`composePrompt()` 與 `snapshotNow()` 都包含 LoRA tokens，`buildPrompt()` 不包含。

### 3.3 現行 LoRA Trigger Words 資料結構（`ui.loras`，v1）

```js
{
  v: 1,
  items: [{
    name,              // ComfyUI 相對路徑，唯一鍵（小寫去重）
    display,           // 顯示名，預設檔名去副檔名
    strength,          // 權重（-100~100，UI 滑桿 -2~2）
    triggers: [],      // 個人觸發詞（扁平字串陣列，唯一注入 Prompt 來源）
    autoTrigger: true, // 是否把 triggers 加進 positive prompt
    enabled: true,     // 是否選取此 LoRA
    authorSuggestions: {
      local: { groups: string[][] },        // 本機 safetensors metadata 觸發詞
      civitai: { versionId, groups, fetchedAt, fingerprint }
    },
    noTriggerNeeded: false
  }]
}
```

`loraSnapshot()`（`app.js:641-650`）實際保存欄位（歷史快照）：`name`, `display`, `strength`, `triggers`, `autoTrigger`, `noTriggerNeeded`。**不保存** `authorSuggestions`，**不保存** `enabled`（已過濾只保留 `enabled` 者）。

### 3.4 現行歷史紀錄（`ui.gallery` 項目）

```js
{
  url, filename, seed, w, h,
  sel: [{t,w}],           // 標籤快照
  extra: "",              // #pos 原始輸入
  neg: "",                // 負面提示詞
  prompt: "",             // 最終組裝字串（僅供顯示，非組裝來源）
  loras: [{name,display,strength,triggers,autoTrigger,enabled:true,noTriggerNeeded}],
  at: Date.now()
}
```

`prompt` 欄位是生成時已組裝的完整字串，**僅供顯示**（`showPromptModal()` 顯示用、`reusePrompt()` 還原時不以 `prompt` 為還原來源，而是以 `sel`/`extra`/`neg` 為還原來源，`app.js:1211-1213`）。

### 3.5 WD14 結果加入路徑（實際程式碼）

WD14 反推結果不自動寫入 Prompt。使用者點選標籤後，由 `rvApply()`（`app.js:3545-3579`）執行：

1. `rvSplitPicked()`（`app.js:3176-3195`）：依 `Tags.matchTag(name)` 分流
   - CATS 已知標籤 → `toBottom`，透過 `Tags.addTags()` 加入底部標籤列（`tags.js:1032-1045`，增量去重，不整組替換）
   - CATS 未知標籤 → `toExtra`，透過 `rvMergePrompt()`（`app.js:3149-3169`）追加到 `#pos` / `ui.extra`，不覆蓋原內容、去重
2. `rvApply()` 執行加入後，**不清空** `RV.picked`，使用者可繼續檢查調整。

### 3.6 分類套用與歷史還原資料流

| 操作 | 位置 | 資料流 | 覆蓋風險 |
|------|------|--------|----------|
| 歷史還原 `reusePrompt(it)` | `app.js:1210-1239` | `Tags.restore(it.sel)` 替換 `state.sel`；`#pos = it.extra` 覆蓋 `ui.extra`；`#neg = it.neg`；若 `it.loras` 存在，整組覆寫 `S.loras` | **高** - 使用者可能只想 copy 文字，卻連 LoRA 角色一起換掉 |
| 分類套用 `caCommit()` | `app.js:1620-1637` | `Tags.restore(plan.nextSel)` 替換 `state.sel`；若 `extraMode !== "keep"` 覆蓋 `#pos` / `ui.extra` | 中 - 有預覽確認步驟 |

---

## 4. A1 發現重新分類（依任務要求）

### 4.1 已確認程式缺陷（Confirmed Bugs）

| # | 發現 | 位置 | 實際執行路徑 | 使用者影響 |
|---|------|------|--------------|-----------|
| P1 | `reusePrompt()` 整組覆寫目前 `ui.loras`（含 LoRA 角色） | `app.js:1217-1236` | 歷史縮圖 / 燈箱 → 「用同提示詞」 → `reusePrompt(it)` → `loraParseItems({items: restored})` 整組覆寫 `S.loras` | 使用者可能只想 copy 提示詞文字，卻連 LoRA 角色一起換掉 |
| P2 | `loraParseItems`/`loraSerialize`/`reusePrompt` 為白名單式重建，新增欄位若遺漏任一處會靜默丟失 | `app.js:555-576`, `app.js:582-596`, `app.js:1217-1236` | 未來新增 LoRA 欄位若未同步三處，存檔後該欄位靜默丟失 | 資料靜默遺失風險，除非有測試覆蓋 |

### 4.2 已確認 UX 限制（Confirmed UX Limitations）

| # | 發現 | 位置 | 實際執行路徑 | 使用者影響 |
|---|------|------|--------------|-----------|
| U1 | 作者建議與個人觸發詞合併後來源不可區分，chip 無來源標記 | `app.js:2794-2817` (`loraAddAuthorWords`)、`app.js:2612-2616` (chip 顯示) | `use-meta` / `add-group` / `add-word` 將作者詞 `concat` 進 `triggers`，chip 顯示無來源區分 | 無法分辨哪個詞是作者給的，無法一鍵移除「所有作者來源的詞」 |
| U2 | 作者建議詞本身不可直接編輯，只能「整組/逐詞加入」複製到 `triggers` | `app.js:2584-2596` (`loraRenderAuthorGroups`) | 開啟觸發詞面板 → 作者建議區塊，僅有「整組加入 / 逐詞加入」按鈕 | 作者建議唯讀（設計意圖，但未明確告知使用者） |
| U3 | `autoTrigger=false` 時觸發詞不進 Prompt，缺乏生成前明確提示 | `app.js:654-668` (`loraTokensFromSnapshot`)、`app.js:1878-1880` (`renderLoraSelected`) | 生成時 `loraTokensFromSnapshot()` 跳過 `autoTrigger === false` 的 LoRA；列表僅顯示「觸發詞（不自動加入）N」 | 使用者可能以為觸發詞「被鎖定／沒作用」 |
| U4 | `noTriggerNeeded` 被加入任何詞時自動清除 | `app.js:2807` (`loraAddAuthorWords`)、`app.js:2895` (`loraSaveTriggerInput`) | 加入作者建議或自訂詞後，`loraSet(..., {triggers: ..., noTriggerNeeded: false})` | 先確認「不需要」後加詞，確認被自動取消 |

### 4.3 現行設計決策（Existing Design Decisions，非缺陷）

| # | 發現 | 位置 | 說明 | 分類理由 |
|---|------|------|------|----------|
| D1 | `loraSaveTriggerInput()` 已有逗號及換行切割 | `app.js:2886-2890` | 手動輸入框會按 `/[,\r\n]+/` 切割，不可籠統宣稱手動輸入會產生單一 chip；僅作者建議路徑 `loraCleanTriggers`（`app.js:439-450`）不切割逗號 | 程式碼證實手動輸入有切割，不屬缺陷 |
| D2 | `loraRemindBeforeGenerate()` 已存在，生成前提醒為現有行為 | `app.js:820-840` | 生成前非阻塞提醒：`autoTrigger=false` 提「不會自動加入」、有作者建議尚未加入提「可挑選」、無觸發詞提「可手動新增」；`loraReminded` Set 防止同一狀態重複提醒 | 程式碼證實提醒已實作，不屬缺失，但需評估是否足夠 |
| D3 | 歷史不保存作者建議是目前刻意設計 | `app.js:641-650` (`loraSnapshot` 僅存 5 欄) | `loraSnapshot()` 只保存 `name/display/strength/triggers/autoTrigger/noTriggerNeeded`，`authorSuggestions` 被捨棄 | 不可直接判定為程式缺陷；若需保留，屬新功能需求 |
| D4 | 歷史快照只保存已啟用 LoRA，還原時設定 `enabled=true` | `app.js:641-650`, `app.js:1224` | `loraSnapshot()` 僅處理 `loraEnabled(items)`；`reusePrompt()` 還原時 `enabled: true` | 符合目前快照語意（快照記錄「當次生成使用的 LoRA」，還原視為重新啟用） |
| D5 | 取消 Civitai 連結會清除 Civitai 建議群組 | `app.js:2953-2957` | `civitai: {versionId: null, groups: [], fetchedAt: null, fingerprint: null}`；個人 `triggers` 不受影響 | 個人觸發詞不遺失，但作者建議群組被清除，產品需確認是否可接受 |

### 4.4 待產品決策（Pending Product Decision）

| # | 發現 | 位置 | 需決策內容 |
|---|------|------|-----------|
| PD1 | 作者 metadata 更新不應覆蓋個人設定 | `app.js:2760-2766` (`loadCivMeta` 僅更新 `civitai.groups/fetchedAt/fingerprint`，不碰 `triggers`) | 現行已符合，但產品需確認「作者建議更新」的提示文案與時機 |
| PD2 | 歷史還原時 `authorSuggestions` 取自「目前」LoRA 而非歷史 | `app.js:1226` (`prev ? prev.authorSuggestions : null`) | 歷史生成時的作者建議群組不見，還原後被目前狀態覆蓋或歸 null；產品需決定是否接受 |
| PD3 | 取消 Civitai 連結後，已採用的該版本作者詞是否保留為個人詞 | `app.js:2953-2957` | `cv-unlink` 僅清除 `civitai.groups`，不碰 `triggers`；已採用進 `triggers` 的詞保留，產品需確認語意 |

### 4.5 尚未驗證（Unconfirmed Issues）

| # | 發現 | 需驗證方式 |
|---|------|-----------|
| V1 | 使用者實際操作中是否真的遇到「無法刪除/編輯個人觸發詞」 | 開啟頁面實際操作 LoRA 觸發詞面板，嘗試增刪改 |
| V2 | 歷史還原後作者建議群組是否真的被「目前」LoRA 狀態覆蓋 | 建立有作者建議的 LoRA → 生成 → 修改目前作者建議 → 還原歷史，比較 |
| V3 | 貼入含逗號的作者建議詞是否真的變成單一 chip | 觀察作者建議群組顯示與「整組加入」結果（`loraCleanTriggers` 不切割逗號） |
| V4 | 跨分頁同時操作同一 LoRA 觸發詞是否有覆蓋衝突 | 開兩個分頁同時編輯 `ui.loras` 同一 LoRA |

---

## 5. 重新設計 Prompt Entry / Source Model

### 5.1 資料擁有權與原始來源

明確區分四個維度：

| 欄位 | 定義 | 說明 |
|------|------|------|
| `owner` | 目前由誰擁有與編輯該詞 | `user`（使用者手動）、`system`（系統自動，如 QUALITY）、`lora`（歸屬某 LoRA） |
| `origin` / `provenance` | 該詞最初來自哪裡 | `tag-db`（CATS 標籤庫）、`author-local`（本機 metadata）、`author-civitai`（Civitai 版本）、`wd14`（反推結果）、`freetext`（使用者自由輸入）、`default`（預設負面） |
| `authorSuggestions` | 目前可參考的作者建議 | 僅讀，不直接進 Prompt，僅供使用者參考與主動採用 |
| `adopted metadata` | 使用者採用作者建議後的來源紀錄 | 記錄哪個作者詞被複製進個人可用詞，供來源追溯與「一鍵移除所有作者來源」 |

作者建議只能在使用者主動採用後，成為個人可用的觸發詞。採用後該詞的 `owner` 變為 `user`，`origin` 保留原始來源（如 `author-civitai`），供 UI 顯示來源標記。

### 5.2 PromptEntry 結構（統一條目）

```json
{
  "id": "prompt-entry-uuid-001",
  "kind": "tag | lora-trigger | freetext | quality | default",
  "owner": "user | system | lora",
  "origin": "tag-db | author-local | author-civitai | wd14 | freetext | default",
  "text": "long hair",
  "raw": "長髮",
  "weight": 1.0,
  "order": 0,
  "lora": "chars\\Amora.safetensors",
  "adoptedFrom": { "source": "author-civitai", "versionId": 3276795, "groupIndex": 0 },
  "locked": false,
  "disabled": false
}
```

- `id`：UUID，用於去重與順序追蹤。
- `kind`：條目類型。
- `owner`：目前擁有者，決定誰可編輯。
- `origin`：原始來源，決定是否受 metadata 更新影響。
- `text`：正規化後送入 ComfyUI 的文字（空格形式，底線已轉空格）。
- `raw`：使用者原始輸入（如中文），僅 `freetext` 有值。
- `weight`：權重，用於 `(text:weight)` 外框。
- `order`：顯示與組裝順序。
- `lora`：若 `kind === "lora-trigger"`，歸屬哪個 LoRA 名稱。
- `adoptedFrom`：若從作者建議採用，記錄來源版本與群組索引。
- `locked`：是否鎖定不可編輯（如系統品質標籤）。
- `disabled`：是否暫時停用（如 `autoTrigger=false` 的 LoRA 觸發詞）。

### 5.3 PromptModel（記憶體層單一表示）

```json
{
  "version": 2,
  "positive": [ /* PromptEntry[] */ ],
  "negative": [ /* PromptEntry[] */ ],
  "qualityTags": true,
  "computed": {
    "pos": "masterpiece, best quality, long hair, 1girl, amora, (blonde hair:1.2)",
    "neg": "worst quality, low quality",
    "posHash": "abc123",
    "assembledAt": 1735296000000
  },
  "sources": {
    "tagDbVersion": "cats-v1",
    "dictVersion": "dict-v1"
  }
}
```

### 5.4 LoRA Trigger Words（持久化層，擴充 `ui.loras`，v2）

```js
{
  v: 2,
  items: [{
    name: "chars\\Amora.safetensors",
    display: "Amora",
    strength: 0.8,
    personalTriggers: ["amora", "blonde hair"],   // 使用者擁有，可自由編輯
    authorSuggestions: {
      local: { groups: [["amora", "blonde hair", "long hair"]] },
      civitai: { versionId: 3276795, groups: [["amora", "blonde hair", "long hair"], ["cleavage", "black dress"]], fetchedAt: 1735296000000, fingerprint: "abc123" }
    },
    adoptedAuthorWords: {                        // 記錄已採用的作者建議，不進 personalTriggers
      "civitai:3276795": { groupIndex: 0, words: ["amora", "blonde hair"], adoptedAt: 1735296000000 }
    },
    autoTrigger: true,
    enabled: true,
    noTriggerNeeded: false
  }]
}
```

- `personalTriggers` 取代現有 `triggers`，僅含使用者個人詞 + 使用者主動採用的作者詞。
- `authorSuggestions` 僅讀參考，絕不進 `personalTriggers`。
- `adoptedAuthorWords` 記錄哪些作者詞已被複製進 `personalTriggers`，供來源區分。

### 5.5 作者詞採用後的生命週期（8 個情境）

| # | 情境 | 行為規則 | 位置參考 |
|---|------|----------|----------|
| 1 | 採用一個作者詞 | 從 `authorSuggestions` 複製單一詞進 `personalTriggers`；記錄 `adoptedAuthorWords`；`owner` 變 `user`，`origin` 保留原始來源 | `loraAddAuthorWords` 路徑 |
| 2 | 整組採用 | 從 `authorSuggestions.groups[gi]` 複製整組進 `personalTriggers`；記錄 `adoptedAuthorWords` | `loraAddAuthorWords` 路徑 |
| 3 | 修改已採用的詞 | 修改 `personalTriggers` 中對應詞；`adoptedAuthorWords` 保留（來源紀錄不變） | 個人詞編輯路徑 |
| 4 | 刪除已採用的詞 | 從 `personalTriggers` 刪除；`adoptedAuthorWords` 中對應 `words` 移除（若該組已無詞則移除整組紀錄） | 個人詞刪除路徑 |
| 5 | 同一詞同時由個人與作者來源提供 | `personalTriggers` 與 `authorSuggestions` 可並存同一文字；UI 上個人詞顯示為可編輯，作者詞顯示為僅讀參考；Prompt 輸出時以 `personalTriggers` 為準，不重複注入 | 去重規則 §5.6 |
| 6 | 作者 metadata 更新 | 僅更新 `authorSuggestions` 的 `groups/fetchedAt/fingerprint`，**不碰** `personalTriggers`、`adoptedAuthorWords`、`noTriggerNeeded` | `loadCivMeta` 路徑 |
| 7 | 取消 Civitai 連結 | `civitai.groups` 清空、`versionId` 設 null；`adoptedAuthorWords` 中該版本的紀錄**保留**（已採用的詞屬個人詞） | `cv-unlink` 路徑 |
| 8 | 歷史還原 | `personalTriggers` 從歷史快照還原；`authorSuggestions` 維持 `ui.loras` 中目前最新值（若無同名 LoRA 則為 null），**不**自動覆蓋 | `reusePrompt` 路徑 |

### 5.6 去重規則

同一個文字可能有多個來源，必須分開定義：

| 層級 | 去重鍵 | 行為 | 說明 |
|------|--------|------|------|
| UI 條目識別 | `(origin, text)` | 同一 `(origin, text)` 只出現一次 | 使用者自訂 `amora`（`origin: freetext`）與作者建議 `amora`（`origin: author-civitai`）可並存 |
| 來源追溯 | `id` | 每個條目唯一 `id` | 供「一鍵移除所有作者來源」使用 |
| Prompt 最終輸出 | `text`（正規化後） | 同一 `text` 在最終 Prompt 字串中僅出現一次 | 避免 `(amora) amora` 重複 |
| 生成文字去重 | `text` | Composer 輸出時對 `text` 做最終去重 | 保證送進 ComfyUI 的字串無重複 |

### 5.7 欄位枚舉一致性

| 欄位 | 允許值 | 說明 |
|------|--------|------|
| `kind` | `tag`, `lora-trigger`, `freetext`, `quality`, `default` | 條目類型 |
| `owner` | `user`, `system`, `lora` | 目前擁有者 |
| `origin` | `tag-db`, `author-local`, `author-civitai`, `wd14`, `freetext`, `default` | 原始來源 |
| `locked` | `boolean` | 是否鎖定不可編輯 |
| `disabled` | `boolean` | 是否暫時停用（不進 Prompt） |

JSON 範例、文字說明、Composer 規則必須以此枚舉為準，不得混用。

---

## 6. PromptModel 權威來源及同步架構

### 6.1 與既有狀態的關係

| 既有狀態 | 與 PromptModel 的關係 | 權威歸屬 |
|----------|----------------------|----------|
| `Tags.state.sel` / localStorage `sel` | 使用者選取的標籤陣列 `{t,w}` | **現行權威**：標籤選取的持久化來源；PromptModel 的 `positive` 中 `kind=tag` 條目可從 `state.sel` 衍生 |
| `#pos` / `ui.extra` | 使用者手動輸入的補充描述 | **現行權威**：補充描述的持久化來源；PromptModel 的 `positive` 中 `kind=freetext` 條目可從 `ui.extra` 衍生 |
| `S.loras` / `ui.loras` | LoRA 設定，含 `personalTriggers`、`autoTrigger` | **現行權威**：LoRA 觸發詞的持久化來源；PromptModel 的 `positive` 中 `kind=lora-trigger` 條目可從 `ui.loras` 衍生 |
| 負面提示詞 (`#neg` / `ui.settings.neg`) | 負面 Prompt | **現行權威**：負面 Prompt 的持久化來源；PromptModel 的 `negative` 條目可從 `#neg` 衍生 |
| WD14 結果 (`RV.picked`) | 反推候選標籤 | **非持久化**：使用者點選後加入 `state.sel` 或 `#pos`，不直接寫入 PromptModel |
| 歷史分類套用 (`caPlanApply`) | 歷史標籤替換 | 透過 `Tags.restore()` 修改 `state.sel`，PrompModel 需隨之重新衍生 |

### 6.2 權威來源答案

**PromptModel 不應被宣稱為「唯一權威來源」**，因為現行架構中 `state.sel`、`ui.extra`、`ui.loras`、`#neg` 各自有自己的 localStorage 持久化鍵與 UI 事件綁定。強行讓 PromptModel 成為唯一權威會引入第二份狀態，違反「不要為了架構漂亮而引入不必要的複雜度」原則。

**建議的漸進方案（衍生模型模式）**：

- `state.sel`、`ui.extra`、`ui.loras`、`#neg` 繼續作為現行持久化層（權威來源）。
- `PromptModel` 作為**記憶體層的衍生模型**，在生成前、預覽前，從現行狀態重新衍生：
  - `positive` = `state.sel`（`kind=tag, owner=user, origin=tag-db`） + `Dict.tr(ui.extra)`（`kind=freetext, owner=user, origin=freetext`） + `ui.loras` 個人觸發詞（`kind=lora-trigger, owner=lora, origin=personal`，`autoTrigger=true` 者）
  - `negative` = `#neg` 值
- `PromptComposer.compose(PromptModel)` 產出最終 `pos`/`neg` 字串，供預覽與生成共用。
- 現行 `Tags.buildPrompt()`、`composePrompt()`、`snapshotNow()` 逐步重構為呼叫 `PromptComposer.compose()`，不再各自維護組裝邏輯。

這樣既避免第二份持久化狀態，又統一了組裝責任。

### 6.3 跨分頁 storage event 同步

現行 `SHARED_KEYS`（`app.js:367`）包含 `sel`, `adult`, `showEn`, `ui.learnedTags`, `ui.extra`, `ui.selSortMode`。跨分頁 `storage` event 觸發 `syncSharedState()` 僅讀取 localStorage 更新記憶體與 UI，**不寫回**，避免寫入迴圈。

PromptModel 作為衍生模型，不需要自己監聽 `storage` event；它在每次 `compose()` 前從現行狀態重新衍生，天然對應跨分頁變更。

### 6.4 歷史還原與分類套用如何更新資料

- **歷史還原 `reusePrompt(it)`**：修改 `state.sel`、`#pos`、`#neg`、`ui.loras`（若 `it.loras` 存在）。PromptModel 在下次 `compose()` 時從更新後的現行狀態衍生。
- **分類套用 `caCommit()`**：修改 `state.sel`（透過 `Tags.restore(plan.nextSel)`）及 `#pos` / `ui.extra`（若 `extraMode !== "keep"`）。PromptModel 在下次 `compose()` 時衍生。
- 兩者均不直接寫入 PromptModel，PromptModel 為衍生視圖。

---

## 7. PromptComposer 完整語意

PromptComposer **只負責文字組裝**，不負責 ComfyUI Workflow 的 LoRA Loader 節點（`loraApplyToWorkflow` 繼續獨立處理 Workflow 節點串接）。

### 7.1 輸入與輸出

**輸入**：`PromptModel`（`positive`/`negative` `PromptEntry[]`、`qualityTags`）

**輸出**：`{ pos: string, neg: string, posHash: string }`

### 7.2 組裝規則

| 項目 | 規則 | 位置參考 |
|------|------|----------|
| Tag 權重格式 | `weight === 1` 時輸出 `text`；否則輸出 `(text:weight)`，weight 保留一位小數 | `tags.js:1002`, `app.js:330` |
| `Dict.tr()` 中文轉換 | `#pos` 原始中文透過 `Dict.tr()` 翻譯為英文標籤；未翻譯中文被過濾（不進 `pos`） | `dict.js:23-32`, `app.js:326` |
| 補充描述原始文字 | `extraRaw` 分別保存（snapshotNow 已做），PromptComposer 僅處理轉換後英文 | `app.js:339` |
| 逗號、換行、空白 | 輸入端各自負責分割（`Dict.tr` 對 `#pos`，`loraCleanTriggers` 對 LoRA 輸入）；Composer 輸出統一用 `, ` 連接，前後 trim | `app.js:317`, `app.js:334` |
| 正向與負向 Prompt | `positive` 陣列組裝 `pos`，`negative` 陣列組裝 `neg`，獨立處理 | `app.js:313-318` |
| QUALITY 標籤 | `qualityTags === true` 時前綴 `QUALITY = "masterpiece, best quality, amazing quality, "` | `app.js:12`, `app.js:315` |
| LoRA Trigger Words | 僅 `autoTrigger !== false` 且 `disabled !== true` 的 `lora-trigger` 條目納入 `pos` | `app.js:654-668` |
| `autoTrigger=false` | 條目 `disabled = true`，Composer 跳過；`triggers` 本身不刪除 | `app.js:656-657` |
| 去重順序 | 最終輸出對 `text`（正規化後）做去重，保留第一次出現順序；同一 `text` 不同 `origin` 可並存於 `PromptModel`，但最終輸出僅出現一次 | 新規則 |
| 預覽與生成共用 | 預覽（`showPromptModal`）與生成（`snapshotNow` → `/prompt`）皆呼叫同一 `PromptComposer.compose()` | 新架構 |

### 7.3 可測試的輸入與預期輸出 JSON 範例

**輸入（PromptModel）：**

```json
{
  "version": 2,
  "qualityTags": true,
  "positive": [
    { "id": "e1", "kind": "tag", "owner": "user", "origin": "tag-db", "text": "1girl", "weight": 1.0, "order": 0 },
    { "id": "e2", "kind": "tag", "owner": "user", "origin": "tag-db", "text": "long hair", "weight": 1.0, "order": 1 },
    { "id": "e3", "kind": "lora-trigger", "owner": "lora", "origin": "personal", "text": "amora", "weight": 1.0, "order": 2, "lora": "chars\\Amora.safetensors" },
    { "id": "e4", "kind": "lora-trigger", "owner": "lora", "origin": "author-civitai", "text": "blonde hair", "weight": 1.2, "order": 3, "lora": "chars\\Amora.safetensors", "adoptedFrom": { "source": "author-civitai", "versionId": 3276795, "groupIndex": 0 } },
    { "id": "e5", "kind": "freetext", "owner": "user", "origin": "freetext", "text": "sakura tree", "weight": 1.0, "order": 4, "raw": "櫻花樹下" },
    { "id": "e6", "kind": "lora-trigger", "owner": "lora", "origin": "personal", "text": "amora", "weight": 1.0, "order": 5, "lora": "chars\\Amora.safetensors", "disabled": true }
  ],
  "negative": [
    { "id": "n1", "kind": "default", "owner": "system", "origin": "default", "text": "worst quality", "weight": 1.0, "order": 0 }
  ]
}
```

**預期輸出：**

```json
{
  "pos": "masterpiece, best quality, amazing quality, 1girl, long hair, amora, (blonde hair:1.2), sakura tree",
  "neg": "worst quality",
  "posHash": "hash-value"
}
```

說明：
- `e6` 因 `disabled: true`（對應 `autoTrigger=false`）被跳過。
- `e1` 與 `e6` 都有 `text: "amora"`，但 `e6` 被跳過，最終輸出只出現一次 `amora`。
- `e4` 權重 `1.2` 輸出為 `(blonde hair:1.2)`。
- `e5` 來自 `freetext`，`raw` 欄位僅供參考，最終輸出使用轉換後的 `text`。
- QUALITY 前綴自動加入。

---

## 8. 歷史快照與遷移

### 8.1 明確區分：提示詞重現 vs 完整生成條件重現

不得宣稱只保存正負向 Prompt 就能完整重現圖片。兩者語意不同：

| 層級 | 保存內容 | 用途 |
|------|----------|------|
| **提示詞重現** | `promptSnapshot.positive` / `promptSnapshot.negative`（結構化 PromptEntry）、`promptSnapshot.pos` / `promptSnapshot.neg`（最終字串） | 讓使用者知道當次生成用了什麼 Prompt，可重新套用相同文字 |
| **完整生成條件重現** | `promptSnapshot` + `loras`（含 `personalTriggers`、`autoTrigger`、`strength`、`enabled`）+ `ckpt`、`w`、`h`、`n`、`steps`、`cfg`、`seed` | 才能完整重現圖片（需 ComfyUI Workflow 亦相同） |

現行 `ui.gallery` 項目已有 `sel`/`extra`/`neg`/`prompt`/`loras`/`at`，但缺少結構化 `promptSnapshot`，且 `loras` 不含 `authorSnapshot`。

### 8.2 對舊 `ui.gallery` 項目的處理

| 欄位 | 處理方式 | 說明 |
|------|----------|------|
| `prompt` 最終字串 | **保留為不可變的 legacy fallback** | 舊項目無 `promptSnapshot` 時，以 `prompt` 字串作為顯示與「僅文字套用」的來源 |
| `sel` | 轉換為 `promptSnapshot.positive`（`kind=tag`） | `extraRaw` 為空時，`sel` 是唯一標籤來源 |
| `extra` | 轉換為 `promptSnapshot.positive` 中 `kind=freetext` 條目（`text` 為 `Dict.tr(extra)` 結果，`raw` 為 `extra` 原始值） | `Dict.tr` 可能過濾未翻譯中文，需註記可能遺失 |
| `neg` | 轉換為 `promptSnapshot.negative` | 直接對應 |
| `prompt` 與 `promptSnapshot` 不一致時 | 以 **`promptSnapshot` 結構化條目為準**（若存在）；若無 `promptSnapshot`，以 `prompt` 字串為準 | 避免歧義 |
| 來源無法還原時 | `origin` 設為 `freetext`（無法確認原始標籤來源）或 `tag-db`（若 `matchTag` 可對應） | 透明告知使用者來源不明 |
| 避免 migration 破壞 | 讀取時僅做**讀取轉換**，不寫回舊格式；下次存檔時才以新格式寫回（漸進遷移） | 舊資料永遠可回退 |

### 8.3 對 `ui.loras` 的 v1 → v2 遷移

| 項目 | v1（現行） | v2（建議） | 相容讀取方式 |
|------|-----------|-----------|-------------|
| 版號 | `v: 1` | `v: 2` | 讀取時判斷 `v`，缺欄位回退預設值 |
| 個人觸發詞 | `triggers: []` | `personalTriggers: []` | 若 `personalTriggers` 缺失，從 `triggers` 複製 |
| 作者建議 | `authorSuggestions: {...}` | `authorSuggestions: {...}`（不變） | 直接保留 |
| 採用紀錄 |（無） | `adoptedAuthorWords: {}` | 若缺失，設為 `{}` |
| `noTriggerNeeded` | `false` | `false`（不變） | 直接保留 |

**新舊欄位並存期間的寫入規則**：讀取時優先使用 `personalTriggers`；寫入時同時寫入 `personalTriggers` 與 `triggers`（為舊程式碼相容），新程式碼僅讀 `personalTriggers`。

**Migration 失敗時如何保留原始資料**：讀取時若 `JSON.parse` 失敗或欄位不符，保留原始 `ui.loras` 字串，以 v1 邏輯降級運作，並以 toast 提示「部分新功能不可用」。

**測試如何證明沒有觸發詞遺失**：建立包含 `triggers` 的 v1 `ui.loras`，執行讀取遷移後，斷言 `personalTriggers` 與原 `triggers` 內容一致；建立包含 `adoptedAuthorWords` 的 v2，執行序列化後反序列化，斷言無遺失。

---

## 9. 方案與實作順序

### 9.1 方案比較

| 評估項目 | 方案 A（漸進統一，現行結構保留） | 方案 B（統一 Source Model，`personalTriggers` 分離） | 推薦：混合方案（B 的核心 + A 的遷移策略） |
|----------|-------------------|---------------------------|----------------------------------|
| 資料所有權清晰度 | 中（`adoptedSources` 與 `triggers` 脫節） | 高（`personalTriggers` 與 `authorSuggestions` 物理分離） | 高（採 B 的 `personalTriggers` 分離） |
| 作者建議不遺失 | 中 | 高 | 高 |
| 歷史快照重現性 | 中 | 高 | 高（採 B 的 `promptSnapshot`） |
| 遷移成本 | 低 | 中高 | 中（採 A 的讀取時漸進遷移，舊欄位並行） |
| 對既有功能影響 | 低 | 高 | 中（PromptModel 為衍生模型，不動現行持久化鍵） |
| 測試成本 | 中低 | 中高 | 中 |
| 未來擴充能力 | 中 | 高 | 高 |
| 主要風險 | `adoptedSources` 與 `triggers` 不同步 | migration 遺失舊 `triggers` | 降低（讀取時 fallback） |
| 對一般使用者操作影響 | 低 | 中（需理解來源概念） | 低（UI 上僅視覺區分來源，不暴露欄位） |

### 9.2 推薦方案：混合方案

採用方案 B 的核心資料模型（`personalTriggers` 與 `authorSuggestions` 物理分離、`promptSnapshot` 結構化歷史），但採用方案 A 的遷移策略（讀取時漸進遷移、舊欄位並行、不立即寫回新格式）。PromptModel 作為**衍生模型**（非唯一權威），避免引入第二份持久化狀態。

**推薦的實作順序（設計建議，未實作）：**

1. **Phase 1**：建立 `PromptComposer` 作為單一組裝入口，現行 `buildPrompt()`/`composePrompt()`/`snapshotNow()` 逐步重構為呼叫 `PromptComposer.compose()`；預覽與生成共用。
2. **Phase 2**：LoRA Trigger Words 方案 B 核心（`personalTriggers` 與 `authorSuggestions` 分離、`adoptedAuthorWords` 記錄採用來源），同步 `loraParseItems`/`loraSerialize`/`reusePrompt` 三處白名單。
3. **Phase 3**：歷史快照結構化（`promptSnapshot`、`loras[].authorSnapshot`），`reusePrompt` 分「僅文字套用」與「完整還原」兩動作。
4. **Phase 4**：資料遷移版本 `ui.loras v:2`、`ui.gallery _schema:2`；舊欄位 fallback 相容。

---

## 10. 產品決策清單

保留尚需產品負責人決策的項目，不自行替產品負責人做決定：

| # | 決策項目 | 相關位置 | 說明 |
|---|----------|----------|------|
| PD1 | 歷史「同提示詞」預設應為「僅文字套用」還是「完整還原（含 LoRA）」？ | `reusePrompt()` `app.js:1210-1239` | 決定歷史還原的預設行為與 UI 入口 |
| PD2 | 是否需要提供「一鍵移除所有作者來源詞」功能？ | `adoptedAuthorWords` `app.js:582-596` | 決定使用者可否批次移除已採用的作者詞 |
| PD3 | `autoTrigger=false` 時生成前是否需額外非阻塞提示？ | `loraRemindBeforeGenerate()` `app.js:820-840` | 現有提醒是否足夠，或需調整文案/時機 |
| PD4 | 歷史快照是否保留 `authorSnapshot` 作為僅供參考資訊？ | `loraSnapshot()` `app.js:641-650` | 決定歷史項目是否記錄當時參考的作者建議版本 |
| PD5 | 取消 Civitai 連結後，已採用的該版本作者詞是否保留為個人詞？ | `cv-unlink` `app.js:2953-2957` | 現行已保留（不碰 `triggers`），產品需確認語意是否符合預期 |
| PD6 | `noTriggerNeeded` 被加入任何詞時是否應自動清除？ | `loraAddAuthorWords` `app.js:2807`、`loraSaveTriggerInput` `app.js:2895` | 現行自動清除，產品需確認是否符合預期 |

---

## 11. 風險與限制

| 風險 | 說明 | 緩解 |
|------|------|------|
| Migration 遺失舊 `triggers` | `ui.loras v:1` → `v:2` 若遷移邏輯錯誤 | 舊欄位並行保留，讀取時 fallback；測試以現有 mock 驗證 |
| `PromptModel` 與 DOM 不同步 | 直接操作 `#pos` / 標籤點選未經過 `PromptModel` | PromptModel 為衍生模型，每次 `compose()` 前從現行狀態重新衍生，天然同步 |
| 歷史快照體積增大 | `promptSnapshot` 結構化條目比單字串大 | 歷史上限 24 筆，影響可忽略 |
| 三處組裝函式重構遺漏 | `buildPrompt`/`composePrompt`/`snapshotNow` 其中一處未改 | 單一 `PromptComposer` 作為唯一出口，舊函式標記棄用 |
| 使用者無法理解「來源」概念 | 非技術使用者不需知道 `origin` 欄位 | UI 上僅以視覺區分（如作者建議詞用不同樣式顯示），不向使用者暴露欄位名 |
| 不得修改現有 localStorage | `simple_ui/AGENTS.md` §8 禁止改變 `sel`/`combos`/`adult`/`showEn` 格式 | 遷移策略僅在讀取時轉換，不寫回舊格式 |

---

## 12. Git 最終狀態（報告寫入後）

- 本報告為**唯讀架構設計補正**，不執行 Git 寫入。
- 調查開始時：Branch `main`，HEAD `cf5609e0...`，Ahead 1 / Behind 0，Staged 0，Tracked Modified 13 個，Untracked 48 個 porcelain 項目（80 檔）。
- 調查期間未修改任何 tracked 檔案，未 stage/commit/push/reset/restore/stash/checkout/clean。
- 唯一新增檔案：`devtools/reports/prompt-tag-system-a2-r1-design-correction.md`（本報告，untracked）。
- 正式服務未受影響：未停止/重啟 ComfyUI、simple_ui（7860）、WD14 Worker；未連接 7860/8188；未發出 `/prompt`、`/interrupt`、`/queue`；未讀取 API Key；未下載模型；未執行大量外部請求。

---

## 13. 正式服務是否受到影響

**沒有**。本次純為架構設計調查，唯一新增檔案為本 Markdown 報告，未觸碰任何既有程式碼、設定或使用者資料。

---

**結論**：本報告修正了 A2 的事實錯誤（四類資料正確區分、三處組裝函式僅為重複責任未證實輸出不一致）、重新分類了 A1 發現（區分現行設計決策與程式缺陷/UX 限制）、重新設計了 Prompt Entry / Source Model（明確 owner/origin/provenance 與 adopted metadata）、明確 PromptModel 為衍生模型而非唯一權威（避免第二份狀態）、給出可測試的 PromptComposer 輸入輸出 JSON 範例、歷史快照明確區分提示詞重現與完整生成條件重現、遷移策略採讀取時漸進遷移不修改現有 localStorage。推薦採用「混合方案」（B 的核心 + A 的遷移策略）。本次僅交付設計與證據，**不開始任何實作**。