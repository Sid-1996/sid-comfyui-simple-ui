# Sid-simple-ui LoRA Trigger Words 鎖定問題與資料生命週期補充調查（A1）

- **日期**：2026-11-27
- **專案**：`C:\ComfyUI\simple_ui`（`Sid-1996/sid-comfyui-simple-ui`）
- **性質**：**唯讀調查**。未修改任何程式碼、設定、使用者資料；未執行 Git 寫入；未重啟服務；未生成圖片；未下載模型；未讀取或使用真實 API Key。
- **交付**：本報告僅作為後續整合的依據，不開始實作。
- **相依報告**：請併讀 `devtools/reports/prompt-tag-system-consolidation-audit.md`（全系統盤點）與 `devtools/reports/lora-trigger-words-ux-audit.md`（既有 LoRA UX 審查）。

---

## 1. Git 基準

查詢方式：`git -C C:\ComfyUI\simple_ui status -sb`

| 項目 | 結果 |
|------|------|
| Repository 根目錄 | `C:\ComfyUI\simple_ui` |
| Branch | `main` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| Ahead / Behind | `1` / `0` |
| Staged | 0 |
| Tracked Modified | 13 個（`AGENTS.md`, `app.css`, `app.js`, `server.py`, `index.html`, `ui_control.ps1`, `ui_panel.ps1`, `ui_panel.pyw` 等；與上一輪相同，本輪未新增任何修改） |
| Untracked | 48 個 porcelain 項目（80 個檔案），含 `devtools/reports/` 與本輪新增的 `devtools/reports/lora-trigger-words-a1-audit.md` |
| CodeGraph 索引 | `codegraph status` 因 shell 啟動問題未能執行；上一輪已知索引過期（Added 5 / Modified 6，未執行 `codegraph sync`）。所有行號以直接 Read 磁碟原始碼為準。 |

---

## 2. 欄位定義與資料流圖

### 2.1 `ui.loras` 單筆 LoRA 資料結構（`app.js` LORA_CORE，`app.js:390-713`）

```js
{
  name,                   // ComfyUI 相對路徑，唯一鍵（小寫去重）
  display,                // 顯示名，預設取檔名去副檔名
  strength,               // 權重（-100~100，UI 滑桿 -2~2）
  triggers: [],           // ★ 個人觸發詞（扁平字串陣列，唯一會注入 Prompt 的來源）
  autoTrigger: true,      // 是否把 triggers 加進 positive prompt
  enabled: true,          // 是否選取此 LoRA（移除＝false，保留其他設定）
  authorSuggestions: {    // ★ 作者建議（只讀，不進快照／歷史）
    local: { groups: string[][] },        // 本機 safetensors metadata 觸發詞
    civitai: {                            // Civitai 版本 trainedWords
      versionId: null, groups: [], fetchedAt: null, fingerprint: null
    }
  },
  noTriggerNeeded: false   // 使用者明確確認「這個 LoRA 不需要觸發詞」
}
```

上限與正規化：
- `triggers` 最多 40 筆（`LORA_MAX_TRIGGERS`，`app.js:398`）；單詞 ≤200 字（`loraCleanTriggerList`，`app.js:439-450`）。
- 作者建議群組最多 20 組（`LORA_AUTHOR_GROUPS`，`app.js:401`）。
- `loraNorm()`（`app.js:406-408`）：小寫＋trim＋`[_\s]+`→單一空白，用於去重。**不按逗號切割**。

### 2.2 資料流圖

```
本機 safetensors metadata
   └─ /api/lora-meta → loadLoraMeta() (app.js:2708) → loraSetLocalGroups() (app.js:2573)
        └─ authorSuggestions.local.groups   （唯讀，顯示於「從模型檔案讀取的建議詞」）

Civitai API /api/civitai/version?id=<vid>
   └─ loadCivMeta() (app.js:2727) → authorSuggestions.civitai.{versionId, groups, fetchedAt, fingerprint}
        └─ 唯讀，顯示於「Civitai 作者提供的建議詞」

使用者手動輸入 (#loraTrigInput)
   └─ loraSaveTriggerInput() (app.js:2886) → it.triggers.push/splice
        └─ 個人觸發詞（唯一注入 Prompt 來源）

作者建議 → 加入 (use-meta / add-group / add-word)
   └─ loraAddAuthorWords() (app.js:2794) → loraAddPlan() → it.triggers.concat(authorWords)
        └─ 複製進 triggers 後，與使用者自訂詞**混在同一陣列，來源不可區分**

生成時注入 Prompt
   └─ loraTokensFromSnapshot() (app.js:654) 只讀 autoTrigger===true 的 triggers
        └─ composePrompt() (app.js:313) → o.pos → /prompt

歷史快照 (ui.gallery)
   └─ loraSnapshot() (app.js:641) 只存 5 欄：name/display/strength/triggers/autoTrigger/noTriggerNeeded
        └─ authorSuggestions **不存入** 歷史
   └─ reusePrompt() (app.js:1217) 還原時 authorSuggestions 取自「目前」LoRA (app.js:1226)
```

---

## 3. 完整操作流程（10 個步驟）

以下追查使用者設定 LoRA 後的完整操作，標記程式碼位置與可能遇到的「無法修改」原因。

### 步驟 1：新增 LoRA
**路徑**：右設定「角色 LoRA」→ 「選擇」→ `openLoraModal()`（`app.js:1999`）→ `loraPickList` toggle（`app.js:2860-2873`）。

- 點選本機 LoRA 卡片 → `loraSet(S.loras, name, { enabled: true, display: ... })` → `loraSave()` → `ui.loras` 新增一筆，預設 `triggers: []`, `autoTrigger: true`, `enabled: true`, `authorSuggestions: loraAuthorDefault()`（`app.js:609-613`）。
- `authorSuggestions` 初始為 `{ local: {groups: []}, civitai: {versionId: null, groups: [], fetchedAt: null, fingerprint: null} }`（`app.js:511-516`）。
- **無「鎖定」**：新增後可立即進觸發詞面板編輯。

### 步驟 2：取得作者建議詞
**路徑**：`loraModal` → 觸發詞面板 → `renderLoraTriggers()`（`app.js:2599`）。

- 本機：`loadLoraMeta(name)`（`app.js:2708`）→ `/api/lora-meta?name=` → `loraSetLocalGroups(name, j.meta.triggerWords)`（`app.js:2718`）→ `authorSuggestions.local.groups`。
- Civitai：使用者在 `#loraCvId` 貼版本 URL → `loraLinkCv()`（`app.js:2819`）→ 設 `versionId` → `loadCivMeta(name)`（`app.js:2727`）→ `/api/civitai/version?id=` → `authorSuggestions.civitai.groups`。
- **顯示為唯讀群組**：`loraRenderAuthorGroups()`（`app.js:2584`）只顯示「建議 1 / 建議 2…」＋「整組加入 / 逐詞加入」按鈕，**沒有直接編輯作者建議詞的 UI**（作者建議本身不可修改，只能複製到 `triggers`）。

### 步驟 3：加入作者建議詞
**路徑**：點「整組加入」（`data-lora-act="add-group"`）或「逐詞加入」（`data-lora-act="add-word"`）→ `loraOnTriggersClick()`（`app.js:2904`）→ `loraAddAuthorWords()`（`app.js:2794`）。

- `loraAddAuthorWords()` → `loraAddPlan(it.triggers, words)`（`app.js:459-474`）→ `loraCleanTriggers(words)` 清理後 `concat` 進 `it.triggers` → `loraSet()` → `loraSave()`。
- **關鍵行為**：加入後，作者建議詞變成 `triggers` 陣列的一員，**與使用者自訂詞視覺上完全相同**（`app.js:2612-2616` 的 chip 顯示沒有來源標記）。
- 一旦混合，使用者無法從 UI 上區分「哪幾個詞原本來自作者建議」，也無法一鍵「移除所有作者來源的詞」。

### 步驟 4：編輯個人觸發詞
**路徑**：`#loraTrigInput` 輸入（逗號分隔）→ 「新增/更新」→ `loraSaveTriggerInput()`（`app.js:2886`）。

- `loraCleanTriggers(String(input.value).split(/[,\r\n]+/))`（`app.js:2890`）：這裡**會按逗號切割**。
- 若 `LORA.editing >= 0`：`next.splice(LORA.editing, 1, ...parts)`（替換單一 chip）；否則 `next.push(...parts)`（追加）。
- `loraSet(S.loras, it.name, { triggers: next, noTriggerNeeded: false })` → `loraSave()`。
- **無「鎖定」**：個人詞可自由新增、替換、刪除。
- **副作用**：`noTriggerNeeded` 被強制設為 `false`（`app.js:2895`）。若使用者先確認「不需要觸發詞」再加入自訂詞，此確認會被自動取消。

### 步驟 5：刪除部分觸發詞
**路徑**：chip 上的 × 按鈕（`data-lora-act="del-trig"`）→ `loraOnTriggersClick()`（`app.js:2910-2921`）。

- `next.splice(idx, 1)` → `loraSet(..., { triggers: next })` → `loraSave()`。
- **註解明確**：「刪除個人詞不得自動設成『不需要』」（`app.js:2915`）。`noTriggerNeeded` 保持不變。
- **無「鎖定」**：可逐個刪除。

### 步驟 6：關閉自動注入
**路徑**：`#loraAuto` checkbox → `loraOnTriggersChange()`（`app.js:2971-2979`）。

- `loraSet(S.loras, it.name, { autoTrigger: e.target.checked })` → `loraSave()`。
- **行為**：`autoTrigger: false` 時，`triggers` 仍完整保存在 `ui.loras` 和歷史快照，但 `loraTokensFromSnapshot()`（`app.js:654-668`）會跳過此 LoRA，不注入 Prompt。
- **使用者影響**：使用者可能以為「觸發詞不見了」，實際上只是不自動注入。UI 上「觸發詞 N」仍顯示（`app.js:1878-1880`），但沒有明確提示「目前不會注入」。

### 步驟 7：重新開啟自動注入
**路徑**：同 `#loraAuto` 重新打勾。

- `autoTrigger` 回 `true` → 生成時 `loraTokensFromSnapshot()` 重新包含此 LoRA 的 `triggers`。
- **無資料遺失**：關閉期間 `triggers` 未動過。

### 步驟 8：取消 Civitai 版本連結
**路徑**：「取消版本連結」（`data-lora-act="cv-unlink"`）→ `loraOnTriggersClick()`（`app.js:2953-2967`）。

- `loraSet(S.loras, it.name, { authorSuggestions: { local: ..., civitai: { versionId: null, groups: [], fetchedAt: null, fingerprint: null } } })`。
- `delete S.loraCiv[it.name]`；`delete cvInputs[it.name]`；`civReqSeq[it.name]++`（使舊請求失效）。
- **重要**：**不碰 `triggers`、`noTriggerNeeded`、`autoTrigger`**。個人觸發詞完全保留。
- **註解**：「取消版本連結只會移除作者建議來源，不會刪除你自己的觸發詞，也不影響生圖」（`app.js:2683` 的 meta 說明）。
- **不會造成資料遺失**，但作者建議群組被清空（`groups: []`），重新連結需重新讀取。

### 步驟 9：重新連結其他版本
**路徑**：貼新版本 URL → `loraLinkCv()`（`app.js:2819`）→ `loadCivMeta()`（`app.js:2727`）。

- 若輸入框有新 ID：`civitai.versionId = id`, `groups: []`, `fetchedAt: null`, `fingerprint: null`（`app.js:2839-2842`），舊建議被清空，等待新請求回填。
- 若輸入框空白（重試同一版本）：`groups: same ? prev.groups : []`，保留先前成功取得的建議直到新資料回來（`app.js:2840`）。
- **無資料遺失**：個人 `triggers` 不受影響。

### 步驟 10：從歷史紀錄還原 LoRA
**路徑**：歷史縮圖 / 燈箱 → 「用同提示詞」→ `reusePrompt(it)`（`app.js:1210-1239`）。

- `Tags.restore(it.sel)` 替換目前標籤；`#pos = it.extra`；`#neg = it.neg`。
- **關鍵**：若 `Array.isArray(it.loras)`，則：
  ```js
  const restored = it.loras.map(l => ({
    name, display, strength, triggers, autoTrigger, enabled: true,
    noTriggerNeeded: l.noTriggerNeeded,
    authorSuggestions: prev ? prev.authorSuggestions : null   // ← 取自「目前」LoRA，非歷史
  }));
  S.loras = loraParseItems({ items: restored });
  ```
- **問題**：`loraSnapshot()`（`app.js:641-650`）只存 5 欄，**不存 `authorSuggestions`**。歷史項目本來就沒有作者建議資料。
- `reusePrompt` 的 `authorSuggestions` 來自 `loraItem(l.name)`（當前 `S.loras` 中的項目）：
  - 若目前 `S.loras` 裡有同名 LoRA → 取用「目前」的作者建議（可能與歷史生成時的版本不同）。
  - 若目前 `S.loras` 裡沒有同名 LoRA → `authorSuggestions: null`（無論歷史生成時是否有建議，都歸零）。
- **這是真正的「可能失去作者建議」情境**：歷史還原後，該 LoRA 的作者建議群組會以「目前狀態」覆蓋，而非保留歷史生成時的建議。

---

## 4. 鎖定問題根因分析

使用者覺得「LoRA Trigger Words 已設定後可能被完全鎖定、無法靈活修改」以及「取消設定可能失去原先保存的作者建議觸發詞」，經靜態程式碼分析，根因如下：

| # | 根因 | 檔案:行 | 說明 | 使用者影響 |
|---|------|---------|------|-----------|
| R1 | 作者建議與個人觸發詞合併後來源不可區分 | `app.js:2794-2817` (`loraAddAuthorWords`)、`app.js:2932-2934` (`use-meta`)、`app.js:2612-2616` (chip 顯示) | `use-meta` 將 `authorSuggestions.local.groups` `concat` 進 `it.triggers`；加入後作者詞與使用者詞視覺完全相同，chip 無來源標記。 | 使用者無法從 UI 分辨哪個詞是作者給的、哪個是自己加的；無法一鍵移除「所有作者來源的詞」而保留自訂詞。 |
| R2 | `loraCleanTriggers()` 不按逗號切割（僅在手動輸入框切割） | `app.js:439-450` (`loraCleanTriggers`) vs `app.js:2890` (`loraSaveTriggerInput`) | `loraCleanTriggers` 只換行轉空白、trim、去重，**不拆逗號**。若使用者貼入「amora, blonde hair」會當成單一 chip。 | 批次貼入多個詞時無法拆成獨立 chip，編輯/刪除單一詞變困難，感覺「被鎖定在一個長字串裡」。 |
| R3 | `authorSuggestions` 不進歷史快照 | `app.js:641-650` (`loraSnapshot`) | 快照只存 `name/display/strength/triggers/autoTrigger/noTriggerNeeded` 5 欄，`authorSuggestions` 被捨棄。 | 歷史紀錄本身不保留作者建議；還原時無法知道該 LoRA 當初有哪些作者建議。 |
| R4 | `reusePrompt` 還原 `authorSuggestions` 取自「目前」LoRA，非歷史 | `app.js:1220-1228` | `authorSuggestions: prev ? prev.authorSuggestions : null`，`prev = loraItem(l.name)` 取自當前 `S.loras`。 | 歷史還原後，作者建議群組會被「目前」狀態覆蓋（或歸為 null），不是歷史生成時的建議，使用者可能覺得「作者建議詞不見了/變了」。 |
| R5 | `noTriggerNeeded` 被加入自訂詞時自動清除 | `app.js:2807` (`loraAddAuthorWords`)、`app.js:2895` (`loraSaveTriggerInput`) | `loraSet(..., { triggers: ..., noTriggerNeeded: false })`，任何加詞動作都會把「不需要觸發詞」確認設為 false。 | 使用者先確認「不需要」，後來加入一個自訂詞，此確認被自動取消，可能不符合預期。 |
| R6 | `autoTrigger=false` 時觸發詞不進 Prompt，但 UI 未明確提示 | `app.js:654-668` (`loraTokensFromSnapshot`)、`app.js:1878-1880` (`renderLoraSelected`) | `autoTrigger: false` 時 `loraTokensFromSnapshot()` 跳過；列表只顯示「觸發詞（不自動加入）N」。 | 使用者可能以為觸發詞「沒作用／被鎖定」，實際上只是不自動注入，缺乏明確的生成前提示。 |

**關鍵結論**：程式碼層面**並沒有真正「鎖定」個人觸發詞的修改**（`triggers` 可自由增刪改，`cv-unlink` 不碰 `triggers`）。使用者感覺到的「鎖定」主要來自 R1（來源混在一起無法區分）、R2（逗號貼入不拆分）、以及 R3/R4（歷史還原時作者建議不被保留/正確還原）。

---

## 5. 資料生命週期

逐欄位確認建立／修改／保存／載入／覆蓋／遺失時機。

### 5.1 `triggers`（個人觸發詞）

| 階段 | 時機 | 函式：行 | 說明 |
|------|------|----------|------|
| 建立 | 新增 LoRA 時 | `loraSet()` `app.js:610` | 預設 `triggers: []` |
| 修改 | 使用者手動輸入儲存 | `loraSaveTriggerInput()` `app.js:2886` → `loraSet(..., {triggers})` → `loraSave()` `app.js:1827` | 逗號切割、清理、追加/替換 |
| 修改 | 從作者建議加入 | `loraAddAuthorWords()` `app.js:2794` → `loraSet(..., {triggers: plan.next})` → `loraSave()` | 作者詞 concat 進 triggers，來源標記遺失 |
| 修改 | 刪除單一 chip | `loraOnTriggersClick()` `app.js:2910` → `loraSet(..., {triggers: next})` | 逐個刪除 |
| 修改 | 編輯單一 chip | `loraOnTriggersClick()` `app.js:2922` → `LORA.editing` → `loraSaveTriggerInput()` | 替換單一 |
| 保存 | 每次變動後 | `loraSave()` `app.js:1827-1829` → `saveJSON("ui.loras", loraSerialize(S.loras))` | 寫入 localStorage `ui.loras` |
| 載入 | 開頁初始化 | `loraParseState(loadJSON("ui.loras", null))` `app.js:596` → `S.loras` | 白名單式重建，壞資料逐筆跳過 |
| 覆蓋 | 歷史還原 | `reusePrompt()` `app.js:1217-1236` → `loraParseItems({items: restored})` | 整組覆寫 `S.loras`；`triggers` 從歷史還原 |
| 遺失 | `loraCleanTriggers` 不拆逗號 | `app.js:439-450` | 貼入「a, b」當成單一 chip，實際上只有一個詞 |

### 5.2 `authorSuggestions.local`（本機 metadata 建議）

| 階段 | 時機 | 函式：行 | 說明 |
|------|------|----------|------|
| 建立 | 讀取本機 LoRA metadata | `loadLoraMeta()` `app.js:2708` → `loraSetLocalGroups()` `app.js:2573` | 從 `j.meta.triggerWords` 填入 `authorSuggestions.local.groups` |
| 修改 | 僅透過 `loraSetLocalGroups` | `app.js:2573` | 由後端 `/api/lora-meta` 回覆決定，使用者不可直接編輯 |
| 保存 | 每次變動 | `loraSave()` `app.js:1827` → `loraSerialize()` `app.js:582` | `authorSuggestions` 隨 `ui.loras` 一起序列化 |
| 載入 | 開頁初始化 | `loraParseItems()` `app.js:555` → `loraParseAuthor()` `app.js:519` | 白名單式重建，缺欄位回退 `loraAuthorDefault()` |
| 覆蓋 | 歷史還原 | `reusePrompt()` `app.js:1226` | 取自 `loraItem(l.name)`（目前 LoRA），**非歷史項目** |
| 遺失 | 歷史快照不存 | `loraSnapshot()` `app.js:641-650` | 快照只存 5 欄，`authorSuggestions` 被捨棄 |

### 5.3 `authorSuggestions.civitai`（Civitai 版本建議）

| 階段 | 時機 | 函式：行 | 說明 |
|------|------|----------|------|
| 建立 | 使用者連結 Civitai 版本 | `loraLinkCv()` `app.js:2819` → 設 `versionId` → `loadCivMeta()` `app.js:2727` | 從 `/api/civitai/version?id=` 取 `trainedWords` |
| 修改 | 重新讀取同一版本 | `loadCivMeta()` `app.js:2756-2766` | 比對 `fingerprint`，只更新 `civitai.groups/fetchedAt`，**不碰 `triggers`** |
| 保存 | 每次變動 | `loraSave()` `app.js:1827` | 隨 `ui.loras` 序列化 |
| 載入 | 開頁初始化 | `loraParseItems()` → `loraParseAuthor()` | 白名單式重建 |
| 覆蓋 | 取消版本連結 | `loraOnTriggersClick()` `app.js:2953-2957` | `civitai: {versionId: null, groups: [], ...}`，群組清空 |
| 遺失 | 歷史快照不存 | `loraSnapshot()` `app.js:641-650` | 不存入歷史 |
| 遺失 | `reusePrompt` 取自目前 LoRA | `app.js:1226` | 可能被目前狀態覆蓋或歸 null |

### 5.4 `autoTrigger`

| 階段 | 時機 | 函式：行 | 說明 |
|------|------|----------|------|
| 建立 | 新增 LoRA | `loraSet()` `app.js:611` | 預設 `true` |
| 修改 | `#loraAuto` checkbox | `loraOnTriggersChange()` `app.js:2971-2979` → `loraSet(..., {autoTrigger})` | 開關自動注入 |
| 保存 | 每次變動 | `loraSave()` `app.js:1827` | 隨 `ui.loras` 序列化 |
| 載入 | 開頁初始化 | `loraParseItems()` `app.js:569` | 缺欄位視為 `true` (`it.autoTrigger !== false`) |
| 覆蓋 | 歷史還原 | `reusePrompt()` `app.js:1223` | 從歷史 `l.autoTrigger` 還原 |
| 注入判斷 | 生成時 | `loraTokensFromSnapshot()` `app.js:656-657` | `autoTrigger === false` 直接跳過 |

### 5.5 `noTriggerNeeded`

| 階段 | 時機 | 函式：行 | 說明 |
|------|------|----------|------|
| 建立 | 新增 LoRA | `loraSet()` `app.js:612` | 預設 `false` |
| 修改 | 「這個模型不需要觸發詞」按鈕 | `loraOnTriggersClick()` `app.js:2946-2950` → `loraSet(..., {noTriggerNeeded: !it.noTriggerNeeded})` | 切換開關 |
| 修改 | 加入任何觸發詞 | `loraAddAuthorWords()` `app.js:2807`、`loraSaveTriggerInput()` `app.js:2895` | 強制設為 `false` |
| 保存 | 每次變動 | `loraSave()` `app.js:1827` | 隨 `ui.loras` 序列化 |
| 載入 | 開頁初始化 | `loraParseItems()` `app.js:572` | `it.noTriggerNeeded === true` |
| 覆蓋 | 歷史還原 | `reusePrompt()` `app.js:1225` | 從歷史 `l.noTriggerNeeded` 還原 |
| 提醒邏輯 | 生成前 | `loraReminderState()` `app.js:545-552` | `noTriggerNeeded === true` 回傳 `"none"`，不再提醒 |

### 5.6 Civitai Version ID

| 階段 | 時機 | 函式：行 | 說明 |
|------|------|----------|------|
| 建立 | 使用者貼版本 URL | `loraLinkCv()` `app.js:2819` → `loraParseCvId()` `app.js:2785` | 解析 `modelVersionId=(\d+)` 或純數字 |
| 保存 | 每次變動 | `loraSave()` `app.js:1827` | 隨 `ui.loras` 序列化 |
| 載入 | 開頁初始化 | `loraParseItems()` → `loraParseAuthor()` `app.js:524-525` | 驗證 `1 <= id <= 2147483647` |
| 覆蓋 | 取消連結 | `app.js:2956` | `versionId: null` |
| 覆蓋 | 重新連結 | `app.js:2839` | 更新為新 ID |
| 遺失 | 歷史快照不存 | `loraSnapshot()` `app.js:641-650` | 不存入歷史 |

### 5.7 LoRA snapshot（生成快照）

| 階段 | 時機 | 函式：行 | 說明 |
|------|------|----------|------|
| 建立 | 生成前 | `snapshotNow()` `app.js:322` → `loraSnapshot(S.loras)` `app.js:641` | 擷取 `enabled` 者的 5 欄 |
| 使用 | 送進 ComfyUI | `wf(o)` `app.js:698` → `loraApplyToWorkflow()` `app.js:671` | `loras: snap.loras` |
| 保存 | 歷史紀錄 | `generate()` `app.js:957-969` | `loras: snap.loras` 存入 `ui.gallery` 項目 |
| 載入 | 歷史還原 | `reusePrompt()` `app.js:1217` | `it.loras` 還原為 `S.loras` |

### 5.8 歷史紀錄（`ui.gallery` 項目的 LoRA 欄位）

| 欄位 | 存入歷史 | 還原時行為 | 問題 |
|------|----------|------------|------|
| `name/display/strength/triggers/autoTrigger` | ✅ `loraSnapshot()` `app.js:641-650` | ✅ `reusePrompt()` `app.js:1220-1225` | 正常 |
| `noTriggerNeeded` | ✅ `loraSnapshot()` `app.js:648` | ✅ `reusePrompt()` `app.js:1225` | 正常 |
| `enabled` | ❌ 不存（還原時一律 `true`） | `app.js:1224` | 使用者先前停用的 LoRA 還原後會重新啟用 |
| `authorSuggestions` | ❌ 不存 | `app.js:1226` 取自「目前」LoRA | 作者建議可能被目前狀態覆蓋或歸 null |

---

## 6. UI 限制調查

| 檢查項 | 位置 | 結果 | 是否為「鎖定」 |
|--------|------|------|---------------|
| `#loraTrigInput` readonly | `index.html:2627`、`app.js:2626-2629` | 一般 `input type="text"`，無 `readonly` | 否，可自由輸入 |
| chip 編輯／刪除按鈕 | `app.js:2612-2616` | 有 `edit-trig`（設定 `LORA.editing`）與 `del-trig`（`splice` 刪除） | 否，可編輯刪除 |
| 作者建議詞直接編輯 | `app.js:2584-2596` (`loraRenderAuthorGroups`) | 僅顯示「整組加入 / 逐詞加入」，**沒有直接修改作者建議詞的 UI** | 是（作者建議唯讀，屬設計意圖） |
| 作者建議詞來源標記 | `app.js:2612-2616` | chip 顯示沒有來源標記（作者 vs 使用者） | 是（混合後無法區分） |
| `cv-unlink` 後按鈕狀態 | `app.js:2953-2967` | `versionId` 設 null，`cv-unlink` 按鈕 disabled（`app.js:2681`） | 否，個人詞不受影響 |
| `autoTrigger=false` 提示 | `app.js:1878-1880` | 列表顯示「觸發詞（不自動加入）N」 | 部分（未在生成前明確提示） |
| 重新 render 後輸入被覆蓋 | `app.js:2699-2703` | `renderLoraTriggers` 會回填 `LORA.editing` 或 `prev` 值到輸入框，但僅在編輯時 | 否，正常行為 |
| 逗號貼入不拆分（作者建議路徑） | `app.js:439-450` (`loraCleanTriggers`) | `loraAddAuthorWords` 走 `loraCleanTriggerList`，**不按逗號切割** | 是（作者建議字串若含逗號會成單一 chip） |

**靜態程式碼可確認的 UI 限制**：作者建議詞本身不可直接編輯（只能複製到 `triggers`）、合併後來源不可區分、逗號分隔的作者建議字串不拆分。其餘個人觸發詞的增刪改在程式碼層面皆可執行，「無法修改」主要是使用者感知問題（來源混在一起、看不出哪些可改）。

---

## 7. 與整體 Prompt Core 的關係

### 7.1 四類資料的定位

| 資料類別 | 儲存位置 | 是否注入 Prompt | 是否可被使用者編輯 | 是否進歷史快照 |
|----------|----------|-----------------|-------------------|----------------|
| 作者建議詞 (`authorSuggestions`) | `ui.loras.items[].authorSuggestions` | ❌ 否（僅供參考） | ❌ 否（唯讀，只能複製） | ❌ 否（`loraSnapshot` 不存） |
| 個人選用觸發詞 (`triggers`) | `ui.loras.items[].triggers` | ✅ 是（`autoTrigger=true` 時） | ✅ 是 | ✅ 是 |
| 實際注入 Prompt 的詞 | `snapshotNow()` → `o.pos`（記憶體，不持久化） | ✅ 是 | 間接（透過 `triggers`/`#pos`/`sel`） | ✅ 以 `pos` 字串形式存入 `ui.gallery` |
| 歷史快照 LoRA 欄位 | `ui.gallery[].loras[]` | ✅ 還原時應用 | 還原即覆寫目前 `S.loras` | 本身即為歷史 |

### 7.2 未來應如何處理（建議方向，不決定最終方案）

#### 方案一：擴充現有結構（低遷移成本）
在 `triggers` 中的每個詞加入 `source` 標記（`"personal"` / `"author-local"` / `"author-civitai"`），保留 `authorSuggestions` 作為唯讀參考快照。

```js
{
  triggers: [{word: "amora", source: "author-civitai"}, {word: "custom", source: "personal"}],
  authorSuggestions: { local: {...}, civitai: {...} },  // 唯讀參考
  autoTrigger, enabled, noTriggerNeeded
}
```

- 優點：遷移成本極低（`loraParseItems`/`loraSerialize`/`reusePrompt` 僅需加 `source` 欄位白名單）；現有 `loraTokensFromSnapshot`、`loraApplyToWorkflow` 無需改動。
- 缺點：`triggers` 陣列變為物件陣列，所有去重／顯示邏輯需調整；`authorSuggestions` 與 `triggers` 中的 `source:"author-*"` 重複儲存。

#### 方案二：完全分離（高遷移成本，語義最清晰）
將「作者建議」與「個人觸發詞」完全分開兩個欄位；注入 Prompt 時僅讀取 `personalTriggers`（或 `activeTriggers` 子集）。

```js
{
  personalTriggers: ["amora", "custom"],      // 使用者擁有，可自由編輯，唯一注入來源
  authorSuggestions: { local: {...}, civitai: {...} },  // 唯讀參考，不進 triggers
  autoTrigger, enabled, noTriggerNeeded
}
```

- 優點：來源完全區分，解決 R1；作者建議更新絕不會干擾個人詞；可做「一鍵還原個人詞至作者建議」等功能。
- 缺點：遷移成本高（`loraSnapshot`/`reusePrompt`/`loraSerialize`/`loraParseItems` 皆需改動；舊 `triggers` 欄位需相容處理）；`loraTokensFromSnapshot` 需改為讀 `personalTriggers`。

---

## 8. 既確認問題分類

### 8.1 已確認的程式缺陷

| # | 問題 | 檔案:行 | 實際執行路徑 | 使用者影響 |
|---|------|---------|--------------|-----------|
| P1 | `authorSuggestions` 不進歷史快照，`reusePrompt` 還原時取自「目前」LoRA 而非歷史 | `app.js:641-650` (`loraSnapshot`)、`app.js:1220-1228` (`reusePrompt`) | 歷史還原 LoRA → `authorSuggestions` 被目前狀態覆蓋或歸 null | 歷史生成時的作者建議群組不見，使用者覺得「作者建議詞遺失」 |
| P2 | `loraCleanTriggers()` 不按逗號切割（僅手動輸入框 `loraSaveTriggerInput` 切割） | `app.js:439-450` vs `app.js:2890` | 貼入「amora, blonde hair」當成單一 chip | 批次詞無法拆分，編輯單一詞困難 |
| P3 | `loraParseItems`/`loraSerialize`/`reusePrompt` 為白名單式重建，新增 LoRA 欄位若遺漏任一處會靜默丟失 | `app.js:555-576`, `app.js:582-596`, `app.js:1217-1236` | 未來若新增欄位未同步三處 | 資料靜默遺失，除非有測試覆蓋 |
| P4 | 歷史紀錄不存 `enabled`，還原時一律 `true` | `app.js:1224` | `reusePrompt` 還原 LoRA | 使用者先前停用的 LoRA 還原後重新啟用 |

### 8.2 已確認的 UX 限制

| # | 問題 | 檔案:行 | 實際執行路徑 | 使用者影響 |
|---|------|---------|--------------|-----------|
| U1 | 作者建議與個人觸發詞合併後來源不可區分，chip 無來源標記 | `app.js:2794-2817` (`loraAddAuthorWords`)、`app.js:2612-2616` (chip) | `use-meta` / `add-group` / `add-word` 將作者詞 concat 進 `triggers` | 無法分辨哪個詞是作者給的，無法一鍵移除「所有作者來源的詞」 |
| U2 | 作者建議詞本身不可直接編輯，只能「整組/逐詞加入」複製到 `triggers` | `app.js:2584-2596` (`loraRenderAuthorGroups`) | 開啟觸發詞面板 → 作者建議區塊 | 作者建議唯讀（設計意圖，但未明確告知使用者） |
| U3 | `autoTrigger=false` 時觸發詞不進 Prompt，但缺乏生成前明確提示 | `app.js:654-668`、`app.js:1878-1880` | 生成時 `loraTokensFromSnapshot()` 跳過 | 使用者可能以為觸發詞「被鎖定／沒作用」 |
| U4 | `noTriggerNeeded` 被加入任何詞時自動清除 | `app.js:2807`、`app.js:2895` | 加入作者建議或自訂詞後 | 先確認「不需要」後加詞，確認被自動取消 |
| U5 | Civitai 版本連結需手動貼 URL，無本機檔案→Civitai 自動對應 | `app.js:2819-2850` (`loraLinkCv`) | 使用者須自行到 Civitai 複製版本 URL | 使用門檻高，非技術使用者難以操作 |

### 8.3 尚未重現的使用者問題（需實際操作驗證）

| # | 疑似問題 | 需驗證方式 | 等級 |
|---|---------|-----------|------|
| V1 | 使用者實際操作中是否真的遇到「無法刪除/編輯個人觸發詞」的情境，或僅是感知問題 | 開啟頁面，操作 LoRA 觸發詞面板，嘗試增刪改 | 高 |
| V2 | 歷史還原後，作者建議群組是否真的被「目前」LoRA 狀態覆蓋（而非保留歷史） | 建立有作者建議的 LoRA → 生成 → 修改目前作者建議 → 還原歷史，比較 | 高 |
| V3 | 貼入含逗號的作者建議或自訂詞時，是否真的變成單一 chip | 在 `#loraTrigInput` 貼入「a, b」觀察 chip 數量 | 中 |
| V4 | 跨分頁同時操作同一 LoRA 觸發詞，是否有覆蓋衝突 | 開兩個分頁同時編輯 `ui.loras` 同一 LoRA | 中 |

### 8.4 單純的架構改善建議（非缺陷）

| # | 建議 | 依據 |
|---|------|------|
| S1 | 將 `authorSuggestions` 與 `triggers` 來源區分（方案一或方案二） | 解決 U1、P1 |
| S2 | `loraCleanTriggers` 支援逗號切割，統一與 `loraSaveTriggerInput` 行為 | 解決 P2 |
| S3 | `reusePrompt` 新增「僅套用提示詞文字，不覆寫 LoRA」選項 | 避免整組覆蓋 `ui.loras`（見整體審查報告 §8 衝突 #1） |
| S4 | `autoTrigger=false` 時在生成前給予非阻塞提示 | 解決 U3 |
| S5 | `noTriggerNeeded` 在加詞時是否自動清除，需產品確認是否符合預期 | 解決 U4 |

---

## 9. 與 Prompt／Tag 整合的關聯

本次調查發現的 LoRA Trigger Words 問題，與整體 Prompt／Tag 系統整合（`prompt-tag-system-consolidation-audit.md`）的關聯：

1. **`reusePrompt` 整組覆蓋**（整體報告 §8 衝突 #1）：歷史還原時 `ui.loras` 被整組覆寫，其中包含 `triggers`。若未來加入「僅文字套用」選項，可避免 LoRA 觸發詞被意外替換。
2. **三處 Prompt 組裝邏輯**（整體報告 §8 衝突 #6）：`buildPrompt`/`composePrompt`/`snapshotNow` 分別處理 LoRA tokens，`loraTokensFromSnapshot()` 是 LoRA 與 Prompt 交會的單一點，未來統一時應保留 `autoTrigger` 判斷邏輯。
3. **作者建議與個人詞來源不可區分**（整體報告 §8 衝突 #2）：與 Prompt 來源標記需求相呼應，未來「單一 Prompt 編輯器」若要標示詞來源，LoRA 觸發詞的 `source` 欄位將是關鍵。
4. **`authorSuggestions` 不進歷史**：整體報告 §11.3 已建議若要「同提示詞」後仍能提醒作者建議，需將 `author`/`noTriggerNeeded` 存入歷史 `loras` 欄位。

---

## 10. Git 最終狀態（報告寫入後）

- 本報告為**唯讀調查**，不執行 Git 寫入。
- 調查開始時：Branch `main`，HEAD `cf5609e0...`，Ahead 1 / Behind 0，Staged 0，Tracked Modified 13 個，Untracked 48 個 porcelain 項目（80 檔）。
- 調查期間未修改任何 tracked 檔案，未 stage/commit/push/reset/restore/stash/checkout/clean。
- 唯一新增檔案：`devtools/reports/lora-trigger-words-a1-audit.md`（本報告，untracked）。
- 正式服務未受影響：未停止/重啟 ComfyUI、simple_ui（7860）、WD14 Worker；未連接 7860/8188；未發出 `/prompt`、`/interrupt`、`/queue`；未讀取 API Key；未下載模型；未執行大量外部請求。

---

**結論**：LoRA Trigger Words 在程式碼層面並無真正「鎖定」個人觸發詞的修改（`triggers` 可自由增刪改，`cv-unlink` 不碰個人詞）。使用者感覺到的「無法靈活修改」與「失去作者建議」主要來自：(1) 作者建議與個人詞合併後來源不可區分（P1/U1），(2) 逗號分隔詞不拆分成獨立 chip（P2），(3) `authorSuggestions` 不進歷史快照且 `reusePrompt` 還原時取自「目前」LoRA（P1），(4) `autoTrigger=false` 缺乏明確提示（U3）。建議依「已確認程式缺陷 / UX 限制 / 待驗證 / 架構改善」分類處理，**本次不開始實作**。