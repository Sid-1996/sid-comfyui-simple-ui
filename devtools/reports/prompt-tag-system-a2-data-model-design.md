# Sid-simple-ui Prompt / Tag 統一資料模型與資料所有權設計（A2）

- **日期**：2026-11-27
- **專案**：`C:\ComfyUI\simple_ui`（`Sid-1996/sid-comfyui-simple-ui`）
- **性質**：**唯讀架構設計調查**，不開始實作。未修改任何程式碼、設定、使用者資料；未執行 Git 寫入；未重啟服務；未生成圖片；未讀取 API Key。
- **交付**：本報告僅作為後續整合的設計依據。
- **相依報告**：`devtools/reports/prompt-tag-system-consolidation-audit.md`（全系統盤點）、`devtools/reports/lora-trigger-words-a1-audit.md`（LoRA Trigger Words 深入調查）

---

## 1. 任務目標及範圍

建立 Sid-simple-ui Prompt / Tag 系統的統一資料模型與資料所有權設計，核心目標：

1. 建立清楚的資料所有權與來源管理（provenance）。
2. 統一 Prompt 的資料結構及組裝責任，消除目前三處獨立 Prompt 組裝邏輯。
3. 明確定義 Tag、Prompt、歷史、WD14、LoRA Trigger Words 之間的關係。
4. 避免資料在複製、套用、歷史還原、作者 metadata 更新時遺失或意外覆蓋。
5. 確保一般使用者不需要理解底層資料結構，就能自然地編輯及使用提示詞。

調查範圍涵蓋 A（Tag 資料模型）、B（Prompt 統一資料模型）、C（LoRA Trigger Words 資料模型）、D（歷史與快照）、E（統一 Prompt 組裝器）、F（相容性與遷移策略）、G（模組邊界）。

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
| Untracked | 48 個 porcelain 項目（80 個檔案），含 `devtools/reports/` 與本輪新增的 `devtools/reports/prompt-tag-system-a2-data-model-design.md` |
| CodeGraph 索引 | `codegraph status` 因環境中 `pwsh.exe` 為 0 bytes 無效別名無法執行；上一輪已知索引過期（Added 5 / Modified 6，未執行 `codegraph sync`）。所有程式碼位置與行號以直接 Read 磁碟原始碼為準。 |

---

## 3. 現況資料模型

### 3.1 四類資料混用的現狀（現行缺陷）

現行程式碼未區分以下四類資料，導致多處邏輯衝突：

| 類別 | 現行儲存位置 | 問題 |
|------|-------------|------|
| 1. Tag DB 原始資料 | `tags.js` `CATS`（靜態）、`tag_categories.js` `MAP` | 與使用者選取狀態共用 `state.sel`，無來源區分 |
| 2. 使用者目前選取狀態 | `localStorage` `sel` `[{t,w}]`、`tags.js` `state.sel` | 與 Prompt 中實際使用的 Tag 同一陣列，無順序/權重/來源獨立管理 |
| 3. Prompt 中實際使用的 Tag | `app.js` `snapshotNow()` → `o.pos` 字串 | 僅為組裝後字串，無結構化 Entry，無法追溯來源 |
| 4. 使用者手動輸入文字 | `localStorage` `ui.extra`（#pos） | 與 Tag 合併在 `buildPrompt()`，無權重、無來源標記 |

### 3.2 現行三處獨立 Prompt 組裝

| 位置 | 函式 | 行 | 職責 | 問題 |
|------|------|----|------|------|
| `tags.js` | `Tags.buildPrompt()` | 1001-1006 | `sel.map(...) + Dict.tr(#pos.value)`，不含 QUALITY 與 LoRA | 預覽用，與實際生成邏輯分離 |
| `app.js` | `composePrompt()` | 313-318 | `QUALITY + buildPrompt() + loraTokens`，實際送進模型 | 與 `buildPrompt()` 邏輯相似但獨立 |
| `app.js` | `snapshotNow()` | 322-350 | 生成前快照，各自拼接 `parts.join(", ")` | 第三套獨立實作，未來改一方易導致預覽與實際不符 |

### 3.3 現行 LoRA Trigger Words 資料結構（`ui.loras`）

```js
{
  v: 1,
  items: [{
    name,              // ComfyUI 相對路徑，唯一鍵
    display,
    strength,
    triggers: [],      // 個人觸發詞（唯一注入來源），扁平字串陣列
    autoTrigger: true,
    enabled: true,
    authorSuggestions: {
      local: { groups: string[][] },      // 本機 metadata
      civitai: { versionId, groups, fetchedAt, fingerprint }
    },
    noTriggerNeeded: false
  }]
}
```

### 3.4 現行歷史紀錄（`ui.gallery` 項目）

```js
{
  url, filename, seed, w, h,
  sel: [{t,w}],           // 標籤快照
  extra: "",              // #pos 原始輸入
  neg: "",                // 負面提示詞
  prompt: "",             // 最終組裝字串（僅供顯示）
  loras: [{name,display,strength,triggers,autoTrigger,enabled:true,noTriggerNeeded}],
  at: Date.now()
}
```

---

## 4. 現有資料流及衝突

### 4.1 資料流圖（現行）

```
標籤點選 ──→ Tags.sel (localStorage sel)
#pos 輸入 ──→ ui.extra ──→ Dict.tr()
LoRA triggers ──→ ui.loras.triggers ──→ loraTokensFromSnapshot()
WD14 結果 ──→ RV.picked ──→ rvSplitPicked() ──→ addTags() / #pos
品質標籤 ──→ QUALITY 常數
─────────────────────────────────────────
composePrompt() = QUALITY + buildPrompt() + loraTokens ──→ o.pos ──→ /prompt
snapshotNow() 獨立拼接，與 composePrompt 邏輯分離
```

### 4.2 已確認衝突（來自既有審查報告）

| # | 衝突 | 位置 | 嚴重度 |
|---|------|------|--------|
| C1 | `reusePrompt()` 整組覆寫目前 `ui.loras`（含 LoRA 角色） | `app.js:1217-1236` | 高 |
| C2 | 作者建議與個人觸發詞合併後來源不可區分 | `app.js:2932-2934` | 高 |
| C3 | 三處獨立 Prompt 組裝邏輯 | `tags.js:1001`, `app.js:313`, `app.js:322` | 高 |
| C4 | 四套獨立正規化/去重實作 | `tags.js:616`, `app.js:406`, `app.js:3125`, `app.js:1247` | 中 |
| C5 | `Tags.restore()` 強制切 `manual` 排序模式 | `tags.js:1027-1028` | 中 |
| C6 | CATS 與 TagCategories 分類規則不一致 | `tags.js:10-23` vs `tag_categories.js` | 中 |

---

## 5. A1 發現修正（依任務要求重新分類）

根據 A2 任務第 5 節（A1 發現修正），重新分類 A1 報告中的發現：

### 5.1 程式缺陷（Confirmed Bugs）

| # | 發現 | 修正後分類 | 位置 | 說明 |
|---|------|-----------|------|------|
| P1 | `authorSuggestions` 不進歷史快照，`reusePrompt` 還原時取自「目前」LoRA | **程式缺陷**（歷史還原資料遺失） | `app.js:641-650`, `app.js:1220-1228` | 歷史生成時的作者建議群組不見，還原後被目前狀態覆蓋或歸 null |
| P2 | `loraParseItems`/`loraSerialize`/`reusePrompt` 白名單式重建，新增欄位若遺漏任一處會靜默丟失 | **程式缺陷**（資料靜默遺失風險） | `app.js:555-576`, `app.js:582-596`, `app.js:1217-1236` | 未來新增 LoRA 欄位需同步三處，否則存檔後丟失 |
| P3 | `loraCleanTriggers()` 不按逗號切割（作者建議路徑） | **程式缺陷**（輸入解析不一致） | `app.js:439-450` | 作者建議字串若含逗號會當成單一 chip，與手動輸入框 `loraSaveTriggerInput`（`app.js:2890` 有逗號切割）行為不一致 |
| P4 | `reusePrompt()` 整組覆寫目前 `ui.loras` | **程式缺陷**（意外覆蓋） | `app.js:1217-1236` | 使用者可能只想 copy 提示詞文字，卻連 LoRA 角色一起換掉 |

### 5.2 UX 限制（Confirmed UX Limitations）

| # | 發現 | 修正後分類 | 位置 | 說明 |
|---|------|-----------|------|------|
| U1 | 作者建議與個人觸發詞合併後來源不可區分，chip 無來源標記 | **UX 限制** | `app.js:2794-2817`, `app.js:2612-2616` | 無法分辨哪個詞是作者給的，無法一鍵移除「所有作者來源的詞」 |
| U2 | 作者建議詞本身不可直接編輯，只能「整組/逐詞加入」複製到 `triggers` | **UX 限制**（設計意圖） | `app.js:2584-2596` | 作者建議唯讀（設計意圖，但未明確告知使用者） |
| U3 | `autoTrigger=false` 時觸發詞不進 Prompt，缺乏生成前明確提示 | **UX 限制** | `app.js:654-668`, `app.js:1878-1880` | 使用者可能以為觸發詞「被鎖定／沒作用」 |
| U4 | `noTriggerNeeded` 被加入任何詞時自動清除 | **UX 限制** | `app.js:2807`, `app.js:2895` | 先確認「不需要」後加詞，確認被自動取消 |

### 5.3 既有設計決策（Existing Design Decisions，非缺陷）

| # | 發現 | 修正後分類 | 位置 | 說明 |
|---|------|-----------|------|------|
| D1 | `loraSaveTriggerInput()` 已有逗號及換行切割 | **既有設計決策**（非缺陷） | `app.js:2886-2890` | 手動輸入框會按 `/[,\r\n]+/` 切割，不可籠統宣稱手動輸入會產生單一 chip；僅作者建議路徑 `loraCleanTriggers` 不切割 |
| D2 | `loraRemindBeforeGenerate()` 已存在，生成前提醒為現有行為 | **既有設計決策** | `app.js:820-840` | 生成前非阻塞提醒已實作，應評估提醒是否足夠，而非宣稱缺失 |
| D3 | 歷史不保存作者建議是目前刻意設計 | **既有設計決策** | `app.js:641-650` (`loraSnapshot` 僅存 5 欄) | 不可直接判定為程式缺陷；若需保留，屬新功能需求 |
| D4 | 歷史快照只保存已啟用 LoRA，還原時設定 `enabled=true` | **既有設計決策** | `app.js:641-650`, `app.js:1224` | 符合目前快照語意（快照記錄「當次生成使用的 LoRA」，還原視為重新啟用） |
| D5 | 取消 Civitai 連結會清除 Civitai 建議群組 | **需重新評估的產品語意** | `app.js:2953-2957` | `civitai: {versionId: null, groups: [], ...}`；A1 誤判為「可能失去資料」，實際個人 `triggers` 不受影響，但作者建議群組被清除，產品需確認是否可接受 |

### 5.4 未確認問題（Unconfirmed Issues）

| # | 發現 | 修正後分類 | 需驗證方式 |
|---|------|-----------|-----------|
| V1 | 使用者實際操作中是否真的遇到「無法刪除/編輯個人觸發詞」 | 未確認 | 開啟頁面實際操作 LoRA 觸發詞面板 |
| V2 | 歷史還原後作者建議群組是否真的被「目前」LoRA 狀態覆蓋 | 未確認 | 建立有作者建議的 LoRA → 生成 → 修改目前作者建議 → 還原歷史，比較 |
| V3 | 貼入含逗號的作者建議詞是否真的變成單一 chip | 未確認 | 觀察作者建議群組顯示與「整組加入」結果 |
| V4 | 跨分頁同時操作同一 LoRA 觸發詞是否有覆蓋衝突 | 未確認 | 開兩個分頁同時編輯 `ui.loras` 同一 LoRA |

---

## 6. 方案 A：在現有結構上漸進統一

### 6.1 設計理念

保留現有 `ui.loras`、`sel`、`ui.extra`、`ui.gallery` 所有 localStorage key 與欄位格式，不改變既有資料結構；僅新增「來源標記」與「單一 Prompt Entry 陣列」作為記憶體層的統一表示，由現有三處組裝函式逐步匯入。

### 6.2 JSON 資料範例

#### 6.2.1 記憶體層統一 Prompt Entry（新增，不持久化為新 key）

```json
{
  "version": 1,
  "positive": [
    { "id": "entry-001", "kind": "tag", "source": "user", "text": "long hair", "weight": 1.0, "order": 0 },
    { "id": "entry-002", "kind": "tag", "source": "tag-db", "text": "1girl", "weight": 1.0, "order": 1 },
    { "id": "entry-003", "kind": "lora-trigger", "source": "author-civitai", "lora": "chars\\Amora.safetensors", "text": "amora", "weight": 1.0, "order": 2, "adopted": true },
    { "id": "entry-004", "kind": "freetext", "source": "user", "text": "櫻花樹下", "weight": 1.0, "order": 3, "raw": "櫻花樹下" },
    { "id": "entry-005", "kind": "lora-trigger", "source": "personal", "lora": "chars\\Amora.safetensors", "text": "blonde hair", "weight": 1.2, "order": 4, "adopted": true }
  ],
  "negative": [
    { "id": "entry-n001", "kind": "tag", "source": "default", "text": "worst quality", "weight": 1.0, "order": 0 }
  ],
  "meta": {
    "qualityTags": true,
    "ckpt": "WAI-Nsfw-Illustrious-17.safetensors",
    "size": { "w": 1024, "h": 1024 },
    "seed": -1,
    "assembledAt": 1735296000000
  }
}
```

#### 6.2.2 LoRA Trigger Words（擴充現有 `ui.loras`，新增 `adoptedSources`）

```js
{
  v: 1,
  items: [{
    name: "chars\\Amora.safetensors",
    display: "Amora",
    strength: 0.8,
    triggers: ["amora", "blonde hair"],
    autoTrigger: true,
    enabled: true,
    noTriggerNeeded: false,
    authorSuggestions: {
      local: { groups: [["amora", "blonde hair", "long hair"]] },
      civitai: { versionId: 3276795, groups: [["amora", "blonde hair", "long hair"], ["cleavage", "black dress"]], fetchedAt: 1735296000000, fingerprint: "abc123" }
    },
    // 新增：記錄哪些作者建議已被採用進 triggers（來源區分）
    adoptedSources: {
      "civitai:3276795": { groupIndex: 0, words: ["amora", "blonde hair"], adoptedAt: 1735296000000 }
    }
  }]
}
```

### 6.3 優點

- 遷移成本極低：不改變任何現有 localStorage key 格式，舊資料可直接讀取。
- 現有 `loraParseItems`/`loraSerialize`/`reusePrompt` 白名單僅需加 `adoptedSources` 欄位。
- 三處 Prompt 組裝函式可逐步重構為呼叫單一 Composer，不需一次全部改寫。

### 6.4 缺點

- `triggers` 仍為扁平字串陣列，作者來源標記存在於獨立的 `adoptedSources`，兩者有脫節風險。
- Tag DB 原始資料、使用者選取狀態、Prompt 中實際使用的 Tag 仍共用 `sel` 陣列，未徹底區分四類資料。
- 難以精確回答「這個詞在 Prompt 中到底來自哪裡」，因為 `triggers` 裡的詞已失去與 `authorSuggestions` 的連結。

### 6.5 遷移成本

- **低**：僅新增 `adoptedSources` 欄位，舊資料缺該欄位時回退為 `{}`，無需 migration script。
- 無需改變 `sel`/`combos`/`adult`/`showEn`/`ui.extra`/`ui.gallery` 格式。

### 6.6 對既有功能的影響

- 現有 `Tags.buildPrompt()`、`composePrompt()`、`snapshotNow()` 可維持不變，逐步由新 Composer 包裝。
- 歷史 `ui.gallery` 項目無需變更。

### 6.7 測試成本

- 中低：現有 `lora_core_test.mjs` 17 項測試可回歸，新增 `adoptedSources` 序列化測試。

### 6.8 未來擴充能力

- 中：可後續將 `triggers` 改為 `{word, source}` 物件陣列，但需再次遷移。

### 6.9 主要風險

- `adoptedSources` 與 `triggers` 可能不同步（例如使用者從 `triggers` 刪除一詞，`adoptedSources` 仍保留）。

---

## 7. 方案 B：建立較完整的統一 Prompt Entry / Source Model

### 7.1 設計理念

建立記憶體層的 `PromptModel` 與 `PromptEntry`，徹底區分四類資料來源；`ui.loras` 與 `ui.gallery` 持久化層新增來源欄位；三處組裝函式統一為單一 `PromptComposer`。所有資料變更皆透過單一 Model 入口，避免直接操作 DOM 或 localStorage 導致不同步。

### 7.2 核心資料模型（JSON）

#### 7.2.1 PromptEntry（統一條目）

```json
{
  "id": "prompt-entry-uuid-001",
  "kind": "tag | lora-trigger | freetext | quality",
  "source": "user | tag-db | author-local | author-civitai | wd14 | default | system",
  "text": "long hair",
  "raw": "長髮",
  "weight": 1.0,
  "order": 0,
  "lora": "chars\\Amora.safetensors",
  "adoptedFrom": { "source": "civitai", "versionId": 3276795, "groupIndex": 0 },
  "locked": false,
  "disabled": false
}
```

- `id`：UUID，用於去重與順序追蹤。
- `kind`：條目類型。
- `source`：資料來源，決定是否可編輯、是否受 metadata 更新影響。
- `text`：正規化後送入 ComfyUI 的文字（空格形式）。
- `raw`：使用者原始輸入（如中文），僅 `freetext` 有值。
- `weight`：權重，用於 `(text:weight)` 外框。
- `order`：顯示與組裝順序。
- `lora`：若 `kind === "lora-trigger"`，歸屬哪個 LoRA。
- `adoptedFrom`：若從作者建議採用，記錄來源版本與群組索引。
- `locked`：是否鎖定不可編輯（如系統品質標籤）。
- `disabled`：是否暫時停用（如 `autoTrigger=false` 的 LoRA 觸發詞）。

#### 7.2.2 PromptModel（記憶體層單一權威來源）

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

#### 7.2.3 LoRA Trigger Words（持久化層，擴充 `ui.loras`）

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
- `adoptedAuthorWords` 記錄哪些作者詞已被複製進 `personalTriggers`，供來源區分與「一鍵移除所有作者來源」功能。

#### 7.2.4 歷史快照（`ui.gallery` 項目）

```js
{
  url, filename, seed, w, h,
  promptSnapshot: {                      // 當次生成快照，足以重現
    positive: [{id, kind, source, text, weight, order}],
    negative: [{id, kind, source, text, weight, order}],
    qualityTags: true,
    pos: "最終組裝字串",
    neg: "負面字串"
  },
  loras: [{                              // 當次生成使用的 LoRA
    name, display, strength,
    personalTriggers: [...],             // 當時實際使用的個人詞
    authorSnapshot: {                    // 當時的作者建議快照（僅供參考，不影響重現）
      civitai: { versionId, groups, fingerprint }
    },
    autoTrigger, enabled: true, noTriggerNeeded
  }],
  extraRaw: "",                          // #pos 原始輸入
  at: Date.now()
}
```

- `promptSnapshot` 儲存結構化條目，歷史還原時可重建 `PromptModel`，不依賴當時 `tag_categories.js` 或 `CATS` 的後續變更。
- `loras[].authorSnapshot` 僅記錄當時參考的作者建議版本，**不自動覆蓋目前 `ui.loras` 中的 `authorSuggestions`**。

### 7.3 優點

- 四類資料徹底區分，來源可追溯。
- 作者建議與個人觸發詞物理分離，滿足「作者建議是素材，不是命令」。
- 歷史快照獨立於當前 Tag DB 與作者 metadata，重現當次生成結果不受後續更新影響。
- 單一 `PromptComposer` 消除預覽與實際生成不一致。

### 7.4 缺點

- 遷移成本較高：`ui.loras` 的 `triggers` 需改為 `personalTriggers`，舊資料需 migration。
- `ui.gallery` 歷史項目需新增 `promptSnapshot` 與 `loras[].authorSnapshot` 欄位。
- 三處組裝函式需統一重構為 `PromptComposer`，涉及 `app.js` 大量邏輯。

### 7.5 遷移成本

- **中高**：
  1. `ui.loras`：`triggers` → `personalTriggers`，新增 `adoptedAuthorWords`；舊 `triggers` 欄位保留作相容，讀取時若 `personalTriggers` 缺失則從 `triggers` 遷移。
  2. `ui.gallery`：新增 `promptSnapshot` 與 `loras[].authorSnapshot`；舊項目缺欄位時回退至現行 `sel`/`extra`/`neg`/`prompt`/`loras`。
  3. 需 migration version `v: 2`，讀取時判斷版號並執行對應遷移。
- 支援漸進遷移：先維持舊欄位並行，新代碼優先讀新欄位，舊欄位作為 fallback。

### 7.6 對既有功能的影響

- `Tags.buildPrompt()`、`composePrompt()`、`snapshotNow()` 需統一為 `PromptComposer.compose()`。
- `reusePrompt()` 需改為「僅套用提示詞文字」與「完整還原（含 LoRA）」兩個明確動作，避免意外覆蓋 `ui.loras`。
- `loraParseItems`/`loraSerialize` 需同步新欄位（白名單陷阱需特別注意）。

### 7.7 測試成本

- 中高：需新增 `PromptComposer` 單元測試（組裝、去重、權重外框、逗號分隔、正負向分離）、LoRA migration 測試、歷史快照重現測試。

### 7.8 未來擴充能力

- 高：`source` 欄位可輕易擴充新來源（如未來 WD14 直接注入、LoRA 群組管理）。

### 7.9 主要風險

- migration 處理不當可能導致舊 `triggers` 資料遺失。
- `promptSnapshot` 與當前 `PromptModel` 的雙維護可能造成不同步。

---

## 8. 統一 Prompt 組裝架構

### 8.1 模組職責分工

| 模組 | 檔案 | 職責 |
|------|------|------|
| Tag Repository | `tags.js` | 管理 `CATS`、`state.sel`（使用者選取）、`matchTag()`、`canonicalTag()`；僅負責 Tag 與使用者選取的對應關係 |
| Prompt Model | `app.js`（新增 `PromptModel` 類別） | 記憶體層單一權威來源，維護 `positive`/`negative` `PromptEntry[]`，負責去重、順序、權重 |
| Prompt Composer | `app.js`（新增 `PromptComposer`） | **單一組裝權責**，從 `PromptModel` 產出最終 `pos`/`neg` 字串，供預覽與生成共用 |
| Prompt History | `app.js` | 管理 `ui.gallery`，負責快照保存與還原，區分「僅文字套用」與「完整還原」 |
| LoRA Prompt Integration | `app.js` LORA_CORE | 管理 `ui.loras`，負責 `personalTriggers` 與 `authorSuggestions` 分離，`autoTrigger` 判斷 |
| Source / Provenance | `app.js` | `PromptEntry.source` 與 `adoptedFrom`，提供來源追溯 |
| Migration | `app.js` | 讀取時依版號執行 `ui.loras` / `ui.gallery` 遷移 |

### 8.2 資料流圖（統一後）

```
標籤點選 ──→ Tag Repository (state.sel) ──→ PromptModel.positive(kind=tag, source=user)
#pos 輸入 ──→ PromptModel.positive(kind=freetext, source=user, raw=原始中文)
LoRA 個人詞 ──→ LoRA Prompt Integration (personalTriggers) ──→ PromptModel.positive(kind=lora-trigger, source=personal)
作者建議採用 ──→ 複製進 personalTriggers ──→ PromptModel.positive(kind=lora-trigger, source=author-*, adoptedFrom=...)
WD14 結果 ──→ rvSplitPicked() ──→ PromptModel.positive(kind=tag, source=wd14)
品質標籤 ──→ PromptModel.positive(kind=quality, source=system)
─────────────────────────────────────────────────────────────
PromptComposer.compose(model) ──→ pos/neg 字串 ──→ /prompt
                                   │
                                   └→ PromptModel.computed.pos/neg ──→ 預覽（showPromptModal）
                                   └→ snapshotNow() ──→ PromptModel.computed ──→ ui.gallery promptSnapshot
```

### 8.3 關鍵機制說明

| 問題 | 處理方式 |
|------|----------|
| 預覽與實際生成一致 | 預覽與生成皆呼叫同一 `PromptComposer.compose()`，不再有 `buildPrompt()`/`composePrompt()`/`snapshotNow()` 三套獨立邏輯 |
| 快照取得最終組裝結果 | `snapshotNow()` 直接讀取 `PromptComposer.compose()` 結果存入 `promptSnapshot` |
| 避免重複注入 | `PromptEntry.id` + `source` + `text` 做三重去重；同一 `text` 不同 `source` 可並存（如使用者自訂 `amora` 與作者建議 `amora` 可分開顯示） |
| 權重外框 `(tag:1.2)` | `PromptEntry.weight` 欄位，Composer 統一處理 `(text:weight)` 格式，輸入端不再分散處理 |
| 逗號分隔 | Composer 輸出統一用 `, ` 分隔；輸入端 `Dict.tr()` 與 `loraSaveTriggerInput` 的逗號切割統一由 Composer 前的正規化層處理 |
| 正負向內容 | `PromptModel.positive` / `PromptModel.negative` 獨立陣列，Composer 分別組裝 |
| LoRA 動態注入 | `autoTrigger === false` 時 `PromptEntry.disabled = true`，Composer 跳過；`triggers` 本身不刪除 |

### 8.4 Composer 組裝偽碼（設計參考，未實作）

```
function compose(model):
  posEntries = model.positive.filter(e => !e.disabled)
  negEntries = model.negative.filter(e => !e.disabled)
  // 去重：同 (source, text) 保留第一個；同 text 不同 source 並存
  posText = posEntries.map(e => e.weight === 1 ? e.text : `(${e.text}:${e.weight})`).join(", ")
  negText = negEntries.map(e => e.weight === 1 ? e.text : `(${e.text}:${e.weight})`).join(", ")
  if model.qualityTags: posText = QUALITY + ", " + posText
  return { pos: trim(posText), neg: trim(negText), posHash: hash(posText) }
```

---

## 9. 歷史與快照策略

### 9.1 五類資料的語意區分

| 資料類別 | 語意 | 生命週期 |
|----------|------|----------|
| 當次生成快照 | 足以重現當次生成的所有內容，不受後續 Tag DB 或作者 metadata 更新影響 | `ui.gallery[].promptSnapshot`，不變 |
| 使用者可編輯的 Prompt | 目前畫面上的 `PromptModel`，可隨時修改 | 記憶體層，不持久化為新 key |
| 目前最新的 Tag DB | `tags.js` `CATS` 與 `tag_categories.js` `MAP`，可能隨版本更新 | 靜態資料，不進歷史 |
| 目前最新的作者建議 metadata | `ui.loras[].authorSuggestions`，可能隨使用者重新讀取而更新 | `ui.loras`，不進歷史快照 |
| 使用者個人 LoRA 設定 | `ui.loras[].personalTriggers` / `autoTrigger` / `enabled` | `ui.loras`，歷史還原時可選擇是否還原 |

### 9.2 各操作的資料語意

| 操作 | 讀取 | 修改 | 覆蓋風險 | 建議語意 |
|------|------|------|----------|----------|
| 保存 Prompt | `PromptModel` | 無 | 無 | 存入 `ui.gallery[].promptSnapshot`（結構化）+ `loras`（當次使用的 LoRA） |
| 載入 Prompt | `ui.gallery[].promptSnapshot` | `PromptModel` | 覆蓋目前選取 | 僅文字套用：不碰 `ui.loras`；完整還原：明確告知使用者會替換 LoRA |
| 複製 Prompt | `ui.gallery[].promptSnapshot.pos` 字串 | 剪貼簿 | 無 | 僅複製最終字串，不帶來源 |
| 修改 Prompt | `PromptModel` | `PromptModel.positive/negative` | 無 | 即時反映，不寫入歷史 |
| 套用歷史 Prompt | `ui.gallery[]` | `PromptModel`，可選 `ui.loras` | 高（現行 `reusePrompt` 整組覆蓋） | 分「僅文字」與「完整還原」兩動作 |
| 分類套用 | `ui.gallery[].sel` + 目前 `PromptModel` | `PromptModel` | 中 | `caPlanApply` 已有預覽，保留 |
| 角色替換 | 歷史 `sel` + 目前 `sel` | `PromptModel` | 中 | 僅替換選取分類，不碰未選分類 |
| 從歷史還原 LoRA | `ui.gallery[].loras` | `ui.loras` | 高 | 還原 `personalTriggers`/`autoTrigger`/`noTriggerNeeded`；`authorSuggestions` 取自「目前」LoRA，不覆蓋 |
| WD14 結果轉入 Prompt | `RV.picked` | `PromptModel.positive` | 低 | 增量加入，不覆蓋現有 |

### 9.3 歷史還原不意外覆蓋最新作者建議的機制

- 歷史快照的 `loras[].authorSnapshot` 僅記錄當時參考版本，不寫回 `ui.loras[].authorSuggestions`。
- 歷史還原時，`personalTriggers` 從歷史還原；`authorSuggestions` 維持 `ui.loras` 中目前的最新值（若無同名 LoRA 則為 null）。
- 使用者若想「回到歷史時的作者建議」，需手動重新連結 Civitai 版本或重新讀取本機 metadata。

---

## 10. 資料遷移策略

### 10.1 遷移版本

| Key | 版號欄位 | 舊版行為 |
|-----|----------|----------|
| `ui.loras` | `v: 2`（新），舊為 `v: 1` | `triggers` 欄位 |
| `ui.gallery` | 項目新增 `_schema: 2` | 無 `promptSnapshot`，無 `loras[].authorSnapshot` |

### 10.2 遷移步驟（讀取時執行，不寫回舊格式）

1. 讀取 `ui.loras`：
   - 若 `v === 1`：建立 `personalTriggers = triggers.slice()`，`adoptedAuthorWords = {}`，`v = 2`。
   - 若 `v === 2`：直接使用。
   - 缺欄位：`personalTriggers` 預設 `[]`，`adoptedAuthorWords` 預設 `{}`，`noTriggerNeeded` 預設 `false`。
2. 讀取 `ui.gallery`：
   - 若項目無 `promptSnapshot`：從 `sel`/`extra`/`neg`/`prompt` 建立簡易 `promptSnapshot`。
   - 若項目無 `loras[].authorSnapshot`：設為 `null`。
3. 遷移後僅在記憶體層使用新結構；下次存檔時才寫回新格式（漸進遷移，使用者繼續使用即可自然遷移）。

### 10.3 舊版 localStorage 相容

- `sel` / `combos` / `adult` / `showEn`：**絕不改變格式**（`simple_ui/AGENTS.md` §8 約束）。
- `ui.extra`：繼續作為 `#pos` 原始輸入；新 `PromptModel` 讀取時將其轉為 `freetext` Entry。
- 舊 `pos` key：**不讀取**（現行約束）。

### 10.4 回退機制

- Migration 失敗時保留舊格式，以舊邏輯降級運作，並以 toast 提示使用者「部分新功能不可用，請重新設定 LoRA 觸發詞」。
- 無需提供手動回退工具，因舊欄位並行保留，新代碼可隨時回退至舊讀取路徑。

### 10.5 是否需要 migration version

- **需要**：`ui.loras.v` 從 1 遞增至 2，作為遷移判斷依據；`ui.gallery` 項目加 `_schema` 欄位。

---

## 11. 模組邊界建議

| 模組 | 建議歸屬 | 現行檔案 | 是否需新增檔案 |
|------|----------|----------|---------------|
| Tag Repository | `tags.js` | `tags.js` | 否（擴充既有 `window.Tags`） |
| Prompt Model | `app.js` | `app.js` | 否（新增類別，屬 IIFE 內部） |
| Prompt Composer | `app.js` | `app.js` | 否（新增函式） |
| Prompt History | `app.js` | `app.js` | 否（擴充 `reusePrompt`） |
| LoRA Prompt Integration | `app.js` | `app.js` LORA_CORE | 否（擴充既有結構） |
| Source / Provenance | `app.js` | `app.js` | 否（`PromptEntry.source` 欄位） |
| Migration | `app.js` | `app.js` | 否（讀取時邏輯） |

**不建議新增 JS 檔案**：專案規範要求無 build step、無框架，現有 `app.js` / `tags.js` / `dict.js` IIFE 模式足夠。新增模組應以函式/類別形式加入既有 IIFE，避免增加全域變數與腳本載入順序複雜度。

---

## 12. 方案比較及推薦

| 評估項目 | 方案 A（漸進統一） | 方案 B（統一 Source Model） |
|----------|-------------------|---------------------------|
| 資料所有權清楚度 | 中（`adoptedSources` 與 `triggers` 脫節） | 高（`personalTriggers` 與 `authorSuggestions` 物理分離） |
| 作者建議不遺失 | 中（依賴 `adoptedSources` 手動維護） | 高（作者建議唯讀，個人詞獨立） |
| 歷史快照重現性 | 中（現行 `prompt` 字串，無結構化條目） | 高（`promptSnapshot` 結構化條目，不依賴後續 Tag DB 變更） |
| 遷移成本 | 低 | 中高 |
| 對既有功能影響 | 低（可逐步重構） | 高（需統一三處組裝函式） |
| 測試成本 | 中低 | 中高 |
| 未來擴充能力 | 中 | 高 |
| 主要風險 | `adoptedSources` 與 `triggers` 不同步 | migration 處理不當可能遺失舊 `triggers` |

### 推薦方案：方案 B（統一 Source Model）

理由：
1. A1 發現的核心問題（作者建議與個人詞來源不可區分、歷史還原作者建議遺失）僅靠方案 B 的物理分離能徹底解決。
2. 方案 A 的 `adoptedSources` 與 `triggers` 脫節設計，未來仍可能因同步疏忽導致資料不一致，屬技術債。
3. 專案處於 Vibe Coding 後期，架構整合正是適時引入統一模型的機會；遷移成本可透過「舊欄位並行、讀取時遷移」降低。

### 推薦的實作順序（設計建議，未實作）

1. **Phase 1**：建立 `PromptModel` 與 `PromptComposer`，統一三處組裝邏輯；預覽與生成共用 `compose()`。
2. **Phase 2**：LoRA Trigger Words 方案 B（`personalTriggers` 與 `authorSuggestions` 分離，`adoptedAuthorWords` 記錄採用來源），同步 `loraParseItems`/`loraSerialize`/`reusePrompt` 三處白名單。
3. **Phase 3**：歷史快照結構化（`promptSnapshot`、`loras[].authorSnapshot`），`reusePrompt` 分「僅文字」與「完整還原」兩動作。
4. **Phase 4**：資料遷移版本 `ui.loras v:2`、`ui.gallery _schema:2`；舊欄位 fallback 相容。

---

## 13. 尚未確認事項

| # | 事項 | 需產品負責人決策 |
|---|------|----------------|
| UQ1 | 歷史「同提示詞」是預設「僅文字套用」仍「完整還原（含 LoRA）」？ | 是 |
| UQ2 | 作者建議 `adoptedAuthorWords` 是否應提供「一鍵移除所有作者來源詞」功能？ | 是 |
| UQ3 | `autoTrigger=false` 時是否在生成前顯示非阻塞提示（現有 `loraRemindBeforeGenerate` 是否足夠）？ | 是 |
| UQ4 | 歷史快照是否應保留 `authorSnapshot` 作為僅供參考資訊，而不影響重現？ | 是 |
| UQ5 | 取消 Civitai 連結後，`adoptedAuthorWords` 中已採用的該版本詞是否保留（目前方案 B 建議保留，屬個人詞）？ | 是 |

---

## 14. 風險與限制

| 風險 | 說明 | 緩解 |
|------|------|------|
| Migration 遺失舊 `triggers` | `ui.loras v:1` → `v:2` 若遷移邏輯錯誤 | 舊欄位並行保留，讀取時 fallback；測試以現有 mock 驗證 |
| `PromptModel` 與 DOM 不同步 | 直接操作 `#pos` / 標籤點選未經過 `PromptModel` | 所有 UI 變更皆透過 `PromptModel` 入口，DOM 僅反映 |
| 歷史快照體積增大 | `promptSnapshot` 結構化條目比單字串大 | 歷史上限 24 筆，影響可忽略 |
| 三處組裝函式重構遺漏 | `buildPrompt`/`composePrompt`/`snapshotNow` 其中一處未改 | 單一 `PromptComposer` 作為唯一出口，舊函式標記棄用 |
| 使用者無法理解「來源」概念 | 非技術使用者不需知道 source 欄位 | UI 上僅以視覺區分（如作者建議詞用不同樣式顯示），不向使用者暴露 `source` 欄位 |

---

## 15. Git 最終狀態

- 本報告為**唯讀架構設計**，不執行 Git 寫入。
- 調查開始時：Branch `main`，HEAD `cf5609e0...`，Ahead 1 / Behind 0，Staged 0，Tracked Modified 13 個，Untracked 48 個 porcelain 項目（80 檔）。
- 調查期間未修改任何 tracked 檔案，未 stage/commit/push/reset/restore/stash/checkout/clean。
- 唯一新增檔案：`devtools/reports/prompt-tag-system-a2-data-model-design.md`（本報告，untracked）。
- 正式服務未受影響：未停止/重啟 ComfyUI、simple_ui（7860）、WD14 Worker；未連接 7860/8188；未發出 `/prompt`、`/interrupt`、`/queue`；未讀取 API Key；未下載模型；未執行大量外部請求。

---

## 16. 正式服務是否受到影響

**沒有**。本次純為架構設計調查，唯一新增檔案為本 Markdown 報告，未觸碰任何既有程式碼、設定或使用者資料。

---

**結論**：建議採用方案 B（統一 Source Model），以 `PromptModel` + `PromptComposer` 作為單一權威來源，徹底區分 Tag DB 原始資料、使用者選取狀態、Prompt 中實際使用的 Tag、使用者手動輸入文字四類資料；LoRA Trigger Words 採 `personalTriggers` 與 `authorSuggestions` 物理分離，歷史快照採結構化 `promptSnapshot`。本次僅交付設計與證據，**不開始任何實作**。