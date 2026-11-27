# Sid-simple-ui Prompt / Tag 統一資料模型一致性修正（A2-R2）

- **日期**：2026-11-27
- **專案**：`C:\ComfyUI\simple_ui`（`Sid-1996/sid-comfyui-simple-ui`）
- **性質**：**唯讀架構設計修正**，不開始實作。未修改任何程式碼、設定、使用者資料；未執行 Git 寫入；未重啟服務；未生成圖片；未讀取 API Key。
- **交付**：本報告為 A2-R1 的一致性修正，**不覆蓋** `prompt-tag-system-a2-data-model-design.md` 與 `prompt-tag-system-a2-r1-design-correction.md`。
- **相依報告**：
  - `devtools/reports/prompt-tag-system-consolidation-audit.md`（全系統盤點）
  - `devtools/reports/lora-trigger-words-a1-audit.md`（LoRA Trigger Words 深入調查）
  - `devtools/reports/prompt-tag-system-a2-data-model-design.md`（A2 原始報告）
  - `devtools/reports/prompt-tag-system-a2-r1-design-correction.md`（A2-R1 報告）

---

## 1. 任務範圍與目標

本輪只解決 A2-R1 混合方案中尚未自洽的資料模型定義，不重新進行整套架構發明。保留 A2-R1 的核心方向：

- PromptModel 作為**衍生模型**（非唯一權威來源）。
- 現行 localStorage 持久化來源不立即改成單一 PromptModel。
- PromptComposer 統一組裝責任。
- 個人觸發詞與作者建議分開。
- 歷史保存結構化提示詞快照。
- 舊資料採漸進相容策略。

本輪重點修正：

1. 作者詞採用後的保存規則必須唯一自洽（消除「複製進 personalTriggers」與「不進 personalTriggers」的矛盾）。
2. 欄位語意必須統一（`id`/`kind`/`owner`/`origin`/`provenance`/`adoptedFrom`/`lora`/`text`/`raw`/`weight`/`order`）。
3. 多來源同詞必須有明確處理（UI 顯示幾筆、持久化幾筆、最終注入幾次）。
4. PromptEntry 與持久化結構必須對齊（provide deserialize/serialize/snapshot 轉換規則）。
5. LoRA Trigger Word 逐詞權重必須決定是否需要。
6. 中文補充描述必須有可追溯的結構化表示（一筆 freetext 對應多個翻譯結果）。
7. PromptComposer 去重與格式規則必須完整（大小寫、底線空白、重複標籤、不同來源同一文字等）。
8. A2-R1 的分類錯誤必須重新分類（U3、P1、P2、D1）。

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
| Untracked porcelain 項目 | 48 個項目（80 個檔案），含 `devtools/reports/` 與本輪新增的 `devtools/reports/prompt-tag-system-a2-r2-model-consistency.md` |
| CodeGraph 索引 | `codegraph status` 可執行：Files 35 / Nodes 1,094 / Edges 4,837，Pending Changes Added 5 / Modified 6。索引過期，未執行 `codegraph sync`。所有程式碼位置與行號以直接 Read 磁碟原始碼為準。 |
| `git diff --check` | 未執行（唯讀調查，無需） |

---

## 3. 實際查閱的程式碼位置

| 檔案 | 關鍵位置 | 用途 |
|------|----------|------|
| `app.js` | `composePrompt()` (313-318)、`snapshotNow()` (322-350)、`loraSnapshot()` (641-650)、`loraTokensFromSnapshot()` (654-668)、`loraAddAuthorWords()` (2794-2817)、`loraSaveTriggerInput()` (2886-2902)、`loraCleanTriggers()` (453-455)、`loraCleanTriggerList()` (439-450)、`loraNorm()` (406-408)、`reusePrompt()` (1210-1239)、`loraRemindBeforeGenerate()` (820-840)、`wf()` (698-712)、`loraApplyToWorkflow()` (671-696) | Prompt 組裝、LoRA 資料結構、歷史還原、觸發詞管理 |
| `tags.js` | `buildPrompt()` (1001-1006)、`snapshot()` (1021)、`restore()` (1023-1030)、`addTags()` (1032-1045)、`matchTag()` (1048-1055)、`norm()` (616)、`tagAlts()` (288-292) | 標籤庫與標籤操作 |
| `dict.js` | `tr()` (23-32)、`leftover()` (35-37) | 中文轉英文標籤 |
| `tag_categories.js` | `MAP`（10,959 筆）、`of()`、`has()`、`categories` | 標籤分類查詢 |
| `index.html` | `#pos` (90)、`#neg` (102)、`loraModal` (413-434)、`revModal` (288-358) | UI 骨架 |

---

## 4. 作者詞資料模型最終方案

### 4.1 採用詞保存規則（唯一自洽規則）

**決定：方案 A——`personalTriggers` 維持字串陣列，另以 `adoptedSources` Map 追蹤採用來源。**

不採用方案 B（`personalTriggers` 改成結構化 Entry），理由：

- 現行 `ui.loras.items[].triggers` 已是字串陣列，改成結構化 Entry 會大幅提升遷移成本與 UI 複雜度。
- 使用者編輯觸發詞時，直觀期待的是字串清單，不是帶 provenance 的物件清單。
- 來源追溯可透過獨立的 `adoptedSources` Map 實現，不需污染 `personalTriggers` 的字串陣列語義。

**規則：**
- 作者建議詞若被使用者主動採用（整組或逐詞），該詞的字串會被加入 `personalTriggers` 字串陣列。
- 同時在 `adoptedSources` 中記錄來源：`"civitai:3276795" → { groupIndex: 0, words: ["amora", "blonde hair"], adoptedAt: ... }`。
- `adoptedSources` 僅供**來源追溯與「一鍵移除所有作者來源詞」**，不參與 Prompt 組裝。
- `personalTriggers` 中的詞一旦加入，即成為使用者的個人詞，可自由編輯、刪除、修改，與 `adoptedSources` 解耦。

### 4.2 欄位語意統一

| 欄位 | 語意 | 允許值 | 位置 |
|------|------|--------|------|
| `id` | 條目唯一識別碼，用於順序追蹤與 UI 操作對應 | UUID 字串 | PromptEntry（記憶體層） |
| `kind` | 條目類型 | `tag`, `lora-trigger`, `freetext`, `quality`, `default` | PromptEntry |
| `owner` | 目前由誰管理該詞（誰可編輯） | `user`, `system`, `lora` | PromptEntry |
| `origin` | 該詞最初來自哪裡 | `tag-db`, `author-local`, `author-civitai`, `wd14`, `freetext`, `default` | PromptEntry |
| `provenance` | 可追溯的來源紀錄（僅讀參考） | 物件或 null，含 `source`, `versionId`, `groupIndex` 等 | PromptEntry |
| `adoptedFrom` | 若從作者建議採用，記錄來源版本與群組索引 | `{ source, versionId, groupIndex }` 或 null | PromptEntry |
| `lora` | 詞所屬 LoRA 名稱（ComfyUI 相對路徑） | 字串或 null | PromptEntry |
| `text` | 正規化後送入 ComfyUI 的文字（空格形式） | 字串 | PromptEntry |
| `raw` | 使用者原始輸入（如中文），僅 freetext 有值 | 字串或 null | PromptEntry |
| `weight` | 權重，用於 `(text:weight)` 外框；不適用時為 `null` | 數字或 null | PromptEntry |
| `order` | 顯示與組裝順序 | 整數 | PromptEntry |

**重要：**
- `owner` 表示目前由誰管理，**不得**同時表示 LoRA 歸屬；LoRA 歸屬由 `lora` 欄位表示。
- `origin` 表示最初來源，**不得**使用 `personal`（R1 錯誤使用）。
- `provenance` 與 `adoptedFrom` 僅在 PromptEntry（記憶體層）使用，不持久化到 `ui.loras`。
- `weight` 在 LoRA Trigger Word 中為 `null`（現行無逐詞權重）；僅在標籤權重（`w`）適用時有值。

### 4.3 多來源同詞處理

情境：使用者手動建立 `amora`，作者 A 提供 `amora`，作者 B 也提供 `amora`，使用者採用作者 A 的詞。

| 問題 | 答案 |
|------|------|
| UI 顯示幾筆？ | 3 筆：使用者個人詞 `amora`（可編輯）、作者 A `amora`（僅讀參考）、作者 B `amora`（僅讀參考） |
| 持久化保存幾筆？ | `personalTriggers` 保存 1 筆 `amora`（使用者個人詞）；`authorSuggestions` 保存作者 A 與作者 B 的建議；`adoptedSources` 記錄「作者 A 的 `amora` 已被採用進 personalTriggers」 |
| 最終 Prompt 注入幾次？ | 1 次。Composer 對正規化後的 `text` 做最終去重，`amora` 僅出現一次 |
| 刪除個人詞是否會刪除作者建議？ | 不會。`personalTriggers` 與 `authorSuggestions` 獨立 |
| 移除作者來源是否會誤刪使用者原本的個人詞？ | 不會。`adoptedSources` 僅記錄來源，移除來源不會從 `personalTriggers` 刪除已採用的詞 |

### 4.4 持久化層資料結構（`ui.loras`，v2）

```js
{
  v: 2,
  items: [{
    name: "chars\\Amora.safetensors",
    display: "Amora",
    strength: 0.8,
    personalTriggers: ["amora", "blonde hair"],   // 字串陣列，使用者擁有，可自由編輯
    authorSuggestions: {
      local: { groups: [["amora", "blonde hair", "long hair"]] },
      civitai: { versionId: 3276795, groups: [["amora", "blonde hair", "long hair"], ["cleavage", "black dress"]], fetchedAt: 1735296000000, fingerprint: "abc123" }
    },
    adoptedSources: {                            // 來源追溯，不進 Prompt 組裝
      "civitai:3276795": { groupIndex: 0, words: ["amora", "blonde hair"], adoptedAt: 1735296000000 }
    },
    autoTrigger: true,
    enabled: true,
    noTriggerNeeded: false
  }]
}
```

- `personalTriggers` 取代現有 `triggers`，維持字串陣列語義。
- `authorSuggestions` 僅讀參考，絕不進 `personalTriggers`。
- `adoptedSources` 記錄已採用的作者建議來源，供「一鍵移除所有作者來源詞」使用。
- **`adoptedSources` 中的詞已進入 `personalTriggers`，不再重複記錄為個人詞。**

---

## 5. PromptEntry 與持久化資料的轉換規則

### 5.1 deserialize：持久化資料 → PromptModel

```
輸入：
  state.sel: [{t, w}]                  // tags.js state.sel / localStorage sel
  ui.extra: 字串                       // #pos 原始輸入
  ui.loras.items[]: {name, personalTriggers[], autoTrigger, enabled, ...}
  #neg: 字串                           // 負面提示詞

輸出：PromptModel { positive: PromptEntry[], negative: PromptEntry[], qualityTags }

規則：
  1. state.sel 的每個 {t, w} → PromptEntry { kind: "tag", owner: "user", origin: "tag-db", text: t, weight: w, order: 索引 }
  2. Dict.tr(ui.extra) 的每個翻譯結果 → PromptEntry { kind: "freetext", owner: "user", origin: "freetext", text: 結果, raw: 對應原始片段, weight: null, order: 續排 }
     - 無法翻譯的中文片段 → PromptEntry { kind: "freetext", owner: "user", origin: "freetext", text: null, raw: 原始片段, weight: null, order: 續排, untranslated: true }
  3. ui.loras.items 中 enabled=true 且 autoTrigger=true 的 LoRA，其 personalTriggers[] 的每個詞 → PromptEntry { kind: "lora-trigger", owner: "lora", origin: "personal", text: 詞, weight: null, order: 續排, lora: name }
     - 若該詞在 adoptedSources 中有記錄 → origin 設為作者來源（如 "author-civitai"），provenance 記錄來源
     - 若該詞未在 adoptedSources 中 → origin 設為 "personal"
  4. #neg 的值 → PromptEntry[] { kind: "default", owner: "system", origin: "default", text: 各詞, weight: null, order: 索引 }
  5. qualityTags=true → 頂端插入 PromptEntry { kind: "quality", owner: "system", origin: "default", text: "masterpiece", ... } 等品質標籤
```

### 5.2 serialize：使用者操作後的 Entry → 持久化資料

```
使用者操作只修改持久化層，不直接修改 PromptModel。

操作：使用者在 #pos 輸入中文
  → 立即寫入 localStorage ui.extra（現行行為，app.js:3687-3691）
  → PromptModel 在下次 compose() 前從 ui.extra 重新衍生

操作：使用者點選標籤
  → Tags.addTags() 修改 state.sel → 寫入 localStorage sel（tags.js:1032-1045）
  → PromptModel 在下次 compose() 前從 state.sel 重新衍生

操作：使用者編輯 LoRA 觸發詞
  → loraSaveTriggerInput() 修改 personalTriggers → 寫入 localStorage ui.loras（app.js:2886-2902）
  → PromptModel 在下次 compose() 前從 ui.loras 重新衍生

不持久化的欄位：id、provenance、adoptedFrom、order（order 可從 state.sel 索引重新推導）。
```

### 5.3 snapshot：當次生成實際使用的 Entry → 歷史快照

```
generate() 發送 /prompt 之前：

snapshotNow() 產出：
  {
    sel: [...],              // 現行 {t, w}
    pos: "...",              // PromptComposer 組裝後的最終字串
    neg: "...",              // 最終負面字串
    extraRaw: "...",         // #pos 原始輸入
    loras: [{name, display, strength, personalTriggers, autoTrigger, noTriggerNeeded}],
    ...
  }

歷史快照（ui.gallery 項目）：
  {
    url, filename, seed, w, h,
    sel: [{t,w}],
    extra: "...",
    neg: "...",
    prompt: "...",           // 最終組裝字串（legacy fallback）
    loras: [{name, display, strength, personalTriggers, autoTrigger, enabled: true, noTriggerNeeded}],
    at: Date.now()
  }

- promptSnapshot（結構化 PromptEntry[]）不進 ui.gallery，僅作為記憶體層的中間表示。
- 歷史還原時，從 sel/extra/neg 重新衍生 PromptModel，不依賴 prompt 字串。
```

### 5.4 ID 穩定性規則

- PromptEntry 的 `id` 僅在記憶體層生成，用於 UI 操作對應（如刪除單一 chip）。
- 每次 `compose()` 前從持久化層重新衍生 PromptModel，**不保留跨 compose 的 id**。
- 歷史快照不依賴 id，依賴 `text` + `order` + `source` 進行比對。

### 5.5 逐詞權重決定

**決定：LoRA Trigger Word 不需要逐詞權重。**

理由：
- 現行 `ui.loras.items[].triggers` 是字串陣列，無逐詞權重欄位。
- LoRA 已有層級權重 `strength`（`app.js:405-415` `loraWeight`），足夠控制 LoRA 整體影響。
- 逐詞權重會大幅提升 UI 複雜度與遷移成本，與「猴子也能上手」的設計目標不符。

PromptEntry 欄位：
- `weight`：標籤適用（來自 `state.sel` 的 `w`），LoRA Trigger Word 與 freetext 設為 `null`。
- Composer 組裝時，`weight === null` 輸出純 `text`；`weight !== null` 且 `!== 1` 輸出 `(text:weight)`。

---

## 6. 中文補充描述資料模型

`Dict.tr()`（`dict.js:23-32`）的實際行為：
- 將中文詞彙轉換為英文標籤（依 DICT 對照表，長匹配優先）。
- 將逗號、頓號、分號及換行轉為分隔符。
- 去除重複結果。
- 過濾無法翻譯的中文片段（`keep=false` 時）。

因此一筆 `freetext` 不能永遠只對應一個 `text`。設計如下：

### 6.1 freetext PromptEntry 結構

```json
{
  "id": "freetext-uuid-001",
  "kind": "freetext",
  "owner": "user",
  "origin": "freetext",
  "text": "long hair, 1girl, sakura tree",      // 翻譯後的多個英文結果，用 ", " 連接
  "raw": "長髮，一個女孩，櫻花樹下",             // 使用者原始輸入
  "weight": null,
  "order": 5,
  "translated": ["long hair", "1girl", "sakura tree"],  // 翻譯成功的英文結果陣列
  "untranslated": ["櫻花樹下"]                      // 無法翻譯的中文片段陣列
}
```

### 6.2 對應規則

| 原始片段 | 翻譯結果 | PromptEntry 表示 |
|----------|----------|-----------------|
| 長髮 | long hair | `text` 包含 "long hair"，`translated` 包含 "long hair" |
| 一個女孩 | 1girl | `text` 包含 "1girl"，`translated` 包含 "1girl" |
| 櫻花樹下 | (無法翻譯) | `text` 不包含，`untranslated` 包含 "櫻花樹下"，`text` 中該片段被過濾 |

### 6.3 使用者修改後重新衍生

- 使用者修改 `#pos` 後，立即寫入 `ui.extra`。
- 下次 `compose()` 前，`Dict.tr(ui.extra)` 重新執行，產生新的 `translated` 與 `untranslated`。
- 舊的 `freetext` PromptEntry 被完全替換，不保留舊的翻譯結果。

### 6.4 歷史快照保存

- `extraRaw`（`#pos` 原始輸入）保存到歷史 `extra` 欄位。
- 歷史還原時，`extra` 回填 `#pos`，下次 `compose()` 再次執行 `Dict.tr()` 重新翻譯。
- 因 `Dict.tr()` 是確定性函數（同輸入同輸出），歷史重現的翻譯結果與原次一致。

---

## 7. PromptComposer 去重與格式規則

### 7.1 正規化規則（單一權威）

```js
function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, " ");   // 底線與空白互通，多重空白收斂
}
```

- 大小寫：不區分，`Long Hair` 與 `long hair` 視為相同。
- 底線與空白：`long_hair` 與 `long hair` 視為相同。
- 前後空白：trim 後比對。
- 重複標籤：同一正規化後 `text` 在最終輸出中僅出現一次。
- 權重不同但文字相同：保留第一次出現的權重，後續重複者被捨棄。
- 同一文字來自不同來源：PromptEntry 可並存（不同 `origin`），但最終輸出僅出現一次，來源以第一次出現者為準。
- Tag 與 LoRA Trigger Word 相同：視為同一個 `text`，最終輸出僅一次。
- QUALITY 前綴：`masterpiece, best quality, amazing quality, ` 固定前綴，不參與去重（與使用者選取的標籤獨立）。
- 正向與負向分離：`positive` 與 `negative` 獨立去重，互不影響。
- `autoTrigger=false`：對應 PromptEntry `disabled = true`，Composer 跳過，`personalTriggers` 本身不刪除。
- 中文翻譯結果的多條目輸出：`freetext` 的 `translated` 陣列中的每個詞作為獨立條目參與去重；`untranslated` 不進 Prompt。

### 7.2 去重發生階段

去重發生在 **PromptComposer.compose() 輸出階段**，不是在 PromptModel 建立階段。

- PromptModel 中可容納同一 `text` 的多個條目（不同 `origin`），供 UI 顯示來源區分。
- Composer 輸出時，對 `text`（正規化後）做最終去重，保留第一次出現的條目（順序、權重、來源）。

### 7.3 完整測試案例

**輸入（PromptModel）：**

```json
{
  "version": 2,
  "qualityTags": true,
  "positive": [
    { "id": "e1", "kind": "tag", "owner": "user", "origin": "tag-db", "text": "1girl", "weight": 1.0, "order": 0 },
    { "id": "e2", "kind": "tag", "owner": "user", "origin": "tag-db", "text": "long hair", "weight": 1.0, "order": 1 },
    { "id": "e3", "kind": "tag", "owner": "user", "origin": "tag-db", "text": "Long_Hair", "weight": 1.2, "order": 2 },
    { "id": "e4", "kind": "lora-trigger", "owner": "lora", "origin": "personal", "text": "amora", "weight": null, "order": 3, "lora": "chars\\Amora.safetensors" },
    { "id": "e5", "kind": "lora-trigger", "owner": "lora", "origin": "author-civitai", "text": "amora", "weight": null, "order": 4, "lora": "chars\\Amora.safetensors", "adoptedFrom": { "source": "author-civitai", "versionId": 3276795, "groupIndex": 0 } },
    { "id": "e6", "kind": "lora-trigger", "owner": "lora", "origin": "personal", "text": "blonde hair", "weight": null, "order": 5, "lora": "chars\\Amora.safetensors", "disabled": true },
    { "id": "e7", "kind": "freetext", "owner": "user", "origin": "freetext", "text": "sakura tree", "weight": null, "order": 6, "raw": "櫻花樹下", "translated": ["sakura tree"], "untranslated": [] },
    { "id": "e8", "kind": "freetext", "owner": "user", "origin": "freetext", "text": "", "weight": null, "order": 7, "raw": "無法翻譯的中文", "translated": [], "untranslated": ["無法翻譯的中文"] }
  ],
  "negative": [
    { "id": "n1", "kind": "default", "owner": "system", "origin": "default", "text": "worst quality", "weight": 1.0, "order": 0 },
    { "id": "n2", "kind": "default", "owner": "system", "origin": "default", "text": "WORST QUALITY", "weight": 1.0, "order": 1 }
  ]
}
```

**預期輸出：**

```json
{
  "pos": "masterpiece, best quality, amazing quality, 1girl, long hair, amora, sakura tree",
  "neg": "worst quality",
  "posHash": "hash-value"
}
```

**說明：**
- `e2` (`long hair`, w=1.0) 與 `e3` (`Long_Hair`, w=1.2)：正規化後相同，保留第一次出現 `e2` (w=1.0)，`e3` 被捨棄。
- `e4` (`amora`, personal) 與 `e5` (`amora`, author-civitai)：正規化後相同，保留第一次出現 `e4`，`e5` 被捨棄（不重複注入）。
- `e6` (`blonde hair`, disabled=true)：跳過，不進輸出。
- `e7` (`sakura tree`)：輸出。
- `e8` (無法翻譯，translated 為空)：不進輸出。
- 負面 `n1` (`worst quality`) 與 `n2` (`WORST QUALITY`)：正規化後相同，保留第一次出現 `n1`，`n2` 被捨棄。
- QUALITY 前綴：`masterpiece, best quality, amazing quality, ` 固定加入。

### 7.4 Composer 不負責的範圍

PromptComposer **只負責文字組裝**，以下不在其責任範圍：
- ComfyUI Workflow 的 LoRA Loader 節點串接（由 `loraApplyToWorkflow()` 獨立處理，`app.js:671-696`）。
- 標籤分類查詢（由 `tag_categories.js` `of()` 處理）。
- 中文翻譯（由 `dict.js` `Dict.tr()` 處理）。

---

## 8. A2-R1 分類修正

### 8.1 U3 `autoTrigger=false`

**修正：** 現有 `loraRemindBeforeGenerate()`（`app.js:820-840`）已在生成前給予非阻塞提醒：
- `autoTrigger === false` → 提示「觸發詞目前不會自動加入 Prompt」
- 有作者建議尚未加入 → 提示「可挑選」
- 無觸發詞 → 提示「可手動新增」
- `loraReminded` Set 防止同一狀態重複提醒

**新分類：** 已確認 UX 限制（現有提醒是否足夠的 UX 待評估，不是缺乏提醒）。

### 8.2 P1 `reusePrompt()` 覆蓋 LoRA

**修正：** 現行行為已確認（`app.js:1217-1236` 整組覆寫 `S.loras`），但是否為程式缺陷取決於產品決策（歷史還原是否應包含 LoRA 設定）。PD1 未決定前，不可直接定義為 Confirmed Bug。

**新分類：** 待產品決策（現行行為已確認，缺陷性取決於產品定義）。

### 8.3 P2 白名單式重建

**修正：** `loraParseItems`/`loraSerialize`/`reusePrompt` 為白名單式重建（`app.js:555-576`, `app.js:582-596`, `app.js:1217-1236`），是**未來擴充風險**，不得描述成已發生資料遺失或已確認程式缺陷。

**新分類：** 擴充風險。

### 8.4 D1 逗號切割

**修正：** 手動輸入框 `loraSaveTriggerInput()`（`app.js:2890`）會按 `/[,\r\n]+/` 切割；作者建議路徑 `loraCleanTriggers()`（`app.js:439-450`）不切割逗號。不可籠統宣稱手動輸入會產生單一 chip。

**新分類：** 現行設計決策（兩條路徑行為不同，手動輸入有切割，作者建議路徑無切割）。

---

## 9. 產品決策清單

| # | 決策項目 | 相關位置 | 說明 |
|---|----------|----------|------|
| PD1 | 歷史「同提示詞」預設應為「僅文字套用」還是「完整還原（含 LoRA）」？ | `reusePrompt()` `app.js:1210-1239` | 決定歷史還原的預設行為與 UI 入口 |
| PD2 | 是否需要提供「一鍵移除所有作者來源詞」功能？ | `adoptedSources` | 決定使用者可否批次移除已採用的作者詞 |
| PD3 | `autoTrigger=false` 時生成前是否需額外非阻塞提示？ | `loraRemindBeforeGenerate()` `app.js:820-840` | 現有提醒是否足夠，或需調整文案/時機 |
| PD4 | 歷史快照是否保留作者建議快照作為僅供參考資訊？ | `loraSnapshot()` `app.js:641-650` | 決定歷史項目是否記錄當時參考的作者建議版本 |
| PD5 | 取消 Civitai 連結後，已採用的該版本作者詞是否保留為個人詞？ | `cv-unlink` `app.js:2953-2957` | 現行已保留（不碰 `triggers`），產品需確認語意 |
| PD6 | `noTriggerNeeded` 被加入任何詞時是否應自動清除？ | `loraAddAuthorWords` `app.js:2807`、`loraSaveTriggerInput` `app.js:2895` | 現行自動清除，產品需確認是否符合預期 |
| PD7 | LoRA Trigger Word 是否需要逐詞權重？ | `PromptEntry.weight` | 本報告決定：不需要，使用 LoRA 層級 `strength` |

---

## 10. 尚未解決的風險

| 風險 | 說明 | 緩解 |
|------|------|------|
| `adoptedSources` 與 `personalTriggers` 不同步 | 使用者從 `personalTriggers` 刪除已採用的作者詞，`adoptedSources` 仍保留 | UI 層刪除時同步清理 `adoptedSources` 中對應的 `words` |
| PromptModel 與 DOM 不同步 | 直接操作 `#pos` / 標籤點選未經過 PromptModel | PromptModel 為衍生模型，每次 `compose()` 前從現行狀態重新衍生 |
| 歷史快照體積增大 | 結構化條目比單字串大 | 歷史上限 24 筆，影響可忽略 |
| 三處組裝函式重構遺漏 | `buildPrompt`/`composePrompt`/`snapshotNow` 其中一處未改 | 單一 `PromptComposer` 作為唯一出口，舊函式標記棄用 |
| 使用者無法理解「來源」概念 | 非技術使用者不需知道 `origin` 欄位 | UI 上僅以視覺區分（如作者建議詞用不同樣式顯示），不向使用者暴露欄位名 |
| 不得修改現有 localStorage | `simple_ui/AGENTS.md` §8 禁止改變 `sel`/`combos`/`adult`/`showEn` 格式 | 遷移策略僅在讀取時轉換，不寫回舊格式 |

---

## 11. Git 最終狀態（報告寫入後）

- 本報告為**唯讀架構設計修正**，不執行 Git 寫入。
- 調查開始時：Branch `main`，HEAD `cf5609e0...`，Ahead 1 / Behind 0，Staged 0，Tracked Modified 13 個，Untracked 48 個 porcelain 項目（80 檔）。
- 調查期間未修改任何 tracked 檔案，未 stage/commit/push/reset/restore/stash/checkout/clean。
- 唯一新增檔案：`devtools/reports/prompt-tag-system-a2-r2-model-consistency.md`（本報告，untracked）。
- 正式服務未受影響：未停止/重啟 ComfyUI、simple_ui（7860）、WD14 Worker；未連接 7860/8188；未發出 `/prompt`、`/interrupt`、`/queue`；未讀取 API Key；未下載模型；未執行大量外部請求。

---

## 12. 正式服務是否受到影響

**沒有**。本次純為架構設計調查，唯一新增檔案為本 Markdown 報告，未觸碰任何既有程式碼、設定或使用者資料。

---

**結論**：本報告修正了 A2-R1 的資料模型不自洽問題：(1) 採用詞保存規則統一為方案 A（`personalTriggers` 字串陣列 + `adoptedSources` Map 追蹤來源，不再矛盾）；(2) 欄位語意統一（`owner` 不表示 LoRA 歸屬、`lora` 表示歸屬、`origin` 不使用 `personal`）；(3) 多來源同詞有明確處理（UI 3 筆、持久化 1 筆、最終注入 1 次）；(4) PromptEntry 與持久化結構對齊（provide deserialize/serialize/snapshot 轉換規則）；(5) LoRA Trigger Word 不需要逐詞權重（`weight` 為 `null`）；(6) 中文補充描述有可追溯的結構化表示（`translated`/`untranslated` 陣列）；(7) PromptComposer 去重規則完整（大小寫、底線空白、前後空白、重複標籤、不同來源同一文字等）並提供可測試 JSON 範例；(8) A2-R1 分類錯誤已重新分類（U3 為 UX 待評估、P1 為待產品決策、P2 為擴充風險、D1 分別記錄兩條路徑）。推薦採用本報告的混合方案。本次僅交付設計與證據，**不開始任何實作**。