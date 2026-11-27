# Sid-simple-ui Prompt / Tag / LoRA 最終契約定點補正（A2-R4-R1）

- **日期**：2026-11-27（本機 01:11 +08:00 開始）
- **專案**：`C:\ComfyUI\simple_ui`（`Sid-1996/sid-comfyui-simple-ui`）
- **性質**：**唯讀設計補正**。未修改任何既有程式碼、測試、報告、AGENTS.md、README、設定、模型、Tag DB、Dict、LoRA 或使用者資料；未執行 Git 寫入；未啟動／停止／重啟正式服務；未生圖；未執行 `codegraph sync`。
- **交付**：只新增本報告一份：`devtools/reports/prompt-tag-system-a2-r4-r1-final-contract-fixes.md`。不覆蓋或修改 A2-R4 舊報告。
- **相依報告（已讀取）**：`devtools/reports/prompt-tag-system-a2-r3-final-model.md`（本輪重新讀取 §3.1／§7／§8 關鍵章節，前輪已完整讀取）、`devtools/reports/prompt-tag-system-a2-r4-final-model-correction.md`（本輪完整重讀 911 行）。
- **規範（已讀取）**：`C:\ComfyUI\AGENTS.md`（303 行）、`C:\ComfyUI\simple_ui\AGENTS.md`（184 行）。

---

## 1. 任務目標與範圍

針對 ChatGPT 對 A2-R4 提出的四項阻擋做**定點補正**，不重新設計架構、不擴張到 A3 UX、不開始實作：

1. **R4-1**：Negative Prompt 只有 `text.neg` 與 `negativeRaw` 概念，沒有正式的 Negative Entries／Effective Negative 契約 → 補上與 Positive 對稱的 L2 結構。
2. **R4-2**：A2-R4 §6.4 的「衍生順序」與 §5.4 JSON 範例／實際 `snapshotNow()` 的 QUALITY 前綴位置不一致 → 以實際程式碼為準，統一 `order` 語意與所有範例。
3. **R4-3**：A2-R4 的 `migration.backup`／`migration.quarantine` 只存在於推導的記憶體描述，會被白名單式 `loraSerialize()` 在下一次存檔時丟失 → 設計正式、可持久化、可恢復的備份機制。
4. **R4-4**：L3 快照缺少 `sampler_name`／`scheduler`／`denoise` 與 Workflow 版本識別 → 盤點 `wf()` 全部影響生成的參數，並分類「已保存／Workflow 固定／外部依賴」，不誇大重現能力。

A2-R4 §7 已通過的 12 項方向（混合架構、衍生 PromptModel、單一 Composer、`personalTriggers`、`authorSuggestions`、`adoptionRecords`、UUID、`sourceGroupId`、取消不刪詞、`promptSnapshot` 持久化、`text.pos`/`text.neg` 權威、漸進相容）**全部維持**；本報告只補契約缺口，唯一必要的新增是 R4-3 的持久化備份 key（理由見 §6.2）。

---

## 2. 開始前檢查紀錄

### 2.1 設備與連線

| 項目 | 結果 |
|---|---|
| Hostname | `DESKTOP-ADPHHAP`（Online） |
| 時間 | 2026-11-27 01:11:21 +08:00 |
| 使用者 | `desktop-adphhap\user` |
| 本機服務 | `127.0.0.1:7860`、`127.0.0.1:8188` 皆回 `connect_ex=0`（監聽中；**僅 TCP 檢查，未發 HTTP 請求**） |

### 2.2 CodeGraph（優先 CMD）

本輪**先以 CMD 執行** `cmd /c codegraph status`，**成功回傳**（與前輪的 pwsh spawn 錯誤不同，如實記錄）：

```
CodeGraph Status
Project: C:\ComfyUI\simple_ui
Index Statistics: Files 35 / Nodes 1,094 / Edges 4,837
DB Size: 7.02 MB   Backend: node:sqlite — built-in (full WAL)   Journal: wal
Nodes by Kind: function 488 / variable 161 / import 158 / constant 136 /
               method 95 / file 32 / class 24
Files by Language: javascript 19 / python 13 / yaml 3
Pending Changes: Added 5 files / Modified 6 files
```

索引仍過期（pending changes）；依禁令**未執行 `codegraph sync`**。所有行號以直接 Read／Grep 目前磁碟原始碼為準，CodeGraph 只作交叉參考。

### 2.3 Git 狀態（開始時，重新查詢，未沿用前輪）

| 項目 | 結果 |
|---|---|
| Repository 根目錄 | `C:/ComfyUI/simple_ui` |
| Branch | `main` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 同址） |
| Ahead / Behind | `1` / `0`（`origin/main..HEAD` = `cf5609e feat: add Civitai LoRA explorer`；反向無 commit） |
| `git status --porcelain` | `modified=15`、`staged=0`、`untracked=61`、`total=76` |
| Modified tracked（15） | `AGENTS.md`, `app.css`, `app.js`, `devtools/lora_api_test.py`, `devtools/lora_core_test.mjs`, `devtools/lora_explorer_api_test.py`, `devtools/lora_explorer_core_test.mjs`, `devtools/lora_mock_civitai.py`, `devtools/lora_ui_test.mjs`, `devtools/test_ui_control_wd14.ps1`, `index.html`, `server.py`, `ui_control.ps1`, `ui_panel.ps1`, `ui_panel.pyw` |
| Untracked（61） | 含 A2-R4 報告在內的 `devtools/reports/*.md`、devtools 測試、`comfy_lora_paths.py`、兩個 untracked 目錄等 |
| `git diff --check` | **exit 0**（無空白錯誤）；另有 2 則 CRLF 警告：`devtools/lora_api_test.py`、`devtools/lora_core_test.mjs` 的 LF 將於 Git 觸碰時轉 CRLF。警告不屬錯誤，未做任何轉換。 |
| 既有使用者修改 | **存在**且本輪完全未動 |

---

## 3. 實際程式碼調查結果（本輪重新讀取）

| 主題 | 位置 | 實際行為（現況） |
|---|---|---|
| QUALITY / 預設負面 | `app.js:12-18` | `QUALITY = "masterpiece, best quality, amazing quality, "`；`DEFAULT_NEG` 為長字串；`DEFAULTS.neg = DEFAULT_NEG` |
| localStorage 讀寫 | `app.js:20-26` | `loadJSON(k,d)` 在 `JSON.parse` 例外時**靜默回傳 `d`**（原始字串未保留）；`saveJSON` 吞掉寫入例外 |
| 正向組裝（預覽） | `app.js:313-318` `composePrompt()` | `[QUALITY + buildPrompt(), lora].filter(Boolean).join(", ")` → 順序 QUALITY → tag → extra → LoRA |
| 正向組裝（生成） | `app.js:322-350` `snapshotNow()` | `parts = sel 權重格式化 → Dict.tr(#pos) → loraTokens`；`pos = (QUALITY前綴) + parts.join(", ")` → 同樣 QUALITY → tag → extra → LoRA |
| 標籤組裝 | `tags.js:1001-1006` | `sel.map(w===1?t:(t:w.toFixed(1)))`，再 push `Dict.tr(#pos)`，`join(", ")`；不含 QUALITY／LoRA |
| 負面現況 | `app.js:325,338,896,904,965,702` | `neg = $("#neg").value`（**原字串直通**）；gallery 存 `snap.neg.trim()`；`wf()` 直接把 `o.neg` 放進 CLIPTextEncode 節點 `"3"`。**沒有任何解析、去重、權重格式化** |
| 負面持久化 | `app.js:3032-3038`、`3023` | `#neg` ↔ `ui.settings.neg`；`reusePrompt()` 從 `it.neg` 回填（1214） |
| LoRA 白名單 | `app.js:555-596` | `loraParseItems()`／`loraSerialize()` 只接受 `name, display, strength, triggers, autoTrigger, enabled, authorSuggestions, noTriggerNeeded`；`LORA_VERSION=1`（393）。**任何 `migration.*` 欄位都不會被保存** |
| LoRA 存檔 | `app.js:716,1827-1829` | 開頁 `loraParseState(loadJSON("ui.loras", null))`；任何 LoRA 操作後 `saveJSON("ui.loras", loraSerialize(S.loras))` |
| Workflow | `app.js:698-712` `wf()` | 節點 1–7 如 §8；KSampler 固定 `sampler_name:"dpmpp_2m"`、`scheduler:"karras"`、`denoise:1` |
| LoRA 節點 | `app.js:671-696` `loraApplyToWorkflow()` | 依 `loras` 順序串接 LoraLoader；讀 `strengthModel`/`strengthClip`（685-686）但 `loraSnapshot()` 不保存這兩欄 |
| 歷史寫入 | `app.js:957-973` | `{url,filename,seed,w,h,sel,extra,neg:negSnap, prompt:o.pos, loras:snap.loras, at}`；最多 24 筆 |
| 歷史還原 | `app.js:1210-1239` | `Tags.restore`、`#pos=it.extra`、`#neg=it.neg`、`it.loras` 整組覆寫，`authorSuggestions` 取目前 LoRA |

**文件／程式差異（本輪新發現，必須記錄）**

1. A2-R4 §6.4 說 Composer 會解析 `negativeRaw` 組成 `neg`；**實際程式沒有解析**，負向是原字串直通。本報告把「解析／去重／權重」明確定為 L2 描述性結構，不改現行輸出行為（除非未來產品決策）。
2. A2-R4 §6.4 的「衍生順序 Tag→Freetext→LoRA→Quality」是**建構 Entry 的順序**，但 `snapshotNow()` 的**最終文字順序**是 Quality→Tag→Freetext→LoRA；A2-R4 §5.4 範例的 `order` 已反映後者。本報告統一 `order` 為最終輸出位置（§5）。
3. 現行 gallery 的 `neg` 是 `snap.neg.trim()`，而實際送進 Workflow 的是**未 trim** 的 `snap.neg`。本報告要求新 Snapshot 的 `negativeRaw`／`text.neg` 保存**未 trim 的實際送出字串**，legacy `neg` 仍維持 trimmed（§4.2）。
4. `loraApplyToWorkflow()` 會讀 `strengthModel`／`strengthClip`，但 `loraSnapshot()` 不保存 → 屬「Workflow 可讀但未保存」的潛在差異（§8）。
5. 目前程式**沒有** `ui.loras.migrationBackup` 或任何遷移備份機制；A2-R4 的 `migration.backup`／`quarantine` 只是設計符號，不是現況。

---

## 4. R4-1：Negative Prompt 正式契約

### 4.1 現況與未來設計的界線

| 項目 | 現況（程式碼） | 本契約（設計，尚未實作） |
|---|---|---|
| 負向來源 | `#neg` → `ui.settings.neg` → `snapshotNow().neg` | 新增 `promptSnapshot.negativeRaw`（擷取當下未 trim 的原字串） |
| L1 文字 | gallery `neg`（trim 後）→ `wf()` 用未 trim 值 | `text.neg` = **未 trim、實際送進 CLIPTextEncode 的字串** |
| L2 結構 | 不存在 | `structure.negativeEntries[]` + `structure.effectiveNegative[]` |
| 解析／去重 | 不存在 | `parseNegative()` 只產生 L2 描述；**不改動 `text.neg`** |

> 本輪**不宣稱** Negative 已有結構化持久化資料；現況只有字串。以下是未來 Snapshot 的正式欄位契約。

### 4.2 `negativeRaw` 來源與語意

| 欄位 | 位置 | 型別 | 語意 |
|---|---|---|---|
| `negativeRaw` | `promptSnapshot.negativeRaw` | string | 擷取時 `$("neg").value` 的**原樣**（不 trim、不解析）。等於 `snapshotNow().neg`，也等於 `wf(o).neg`，因此等於 `text.neg`。 |
| `text.neg` | `promptSnapshot.text.neg` | string | 生成時實際送進 Negative CLIPTextEncode 的字串。L1 唯一權威。 |
| legacy `neg` | `ui.gallery[].neg` | string | 沿用現行 `snap.neg.trim()`；可能與 `text.neg` 僅差前後空白，不算不一致。 |

不變量：`text.neg === negativeRaw`（位元組相同）。若舊歷史只有 `neg` 字串，則 `negativeRaw = fallback(legacy neg)` 並標 `negativeParse.mode:"raw-only"`，**不可宣稱知道未 trim 的原值**。

### 4.3 Negative Entry 正式欄位（與 SnapshotEntry 對稱，限制子集）

`structure.negativeEntries[]` 的每筆使用與 A2-R4 §5.2 SnapshotEntry **同名同型**的欄位，allowlist 如下：

| 欄位 | 型別 | Negative 限制 / 預設 | 語意 |
|---|---|---|---|
| `entryId` | string | 必填 | Snapshot 內唯一；Negative 與 Positive 各自從 `"n1"` 起算。 |
| `kind` | `"default"` \| `"freetext"` | 必填 | 不使用 `tag`／`lora-trigger`／`quality`（現行負向沒有這些來源）。 |
| `owner` | `"system"` \| `"user"` | 必填 | `origin==="default"` → `system`；`origin==="manual"` → `user`。 |
| `origin` | `"default"` \| `"manual"` | 必填 | 整个 `negativeRaw === DEFAULT_NEG` 時為 `default`；否則 `manual`。混合字串**不得**逐詞猜來源。 |
| `text` | string | 必填 | 正規化後的單一 token；空字串由 Composer 過濾。 |
| `weight` | number \| null | 必填 | 僅由 `(text:1.2)` 形式解析；其餘 `null`。 |
| `order` | integer ≥ 0 | 必填 | **Negative 區段內**最終輸出順序，從 0 起算（與 Positive 的 `order` 各自獨立）。 |
| `disabled` | boolean | 預設 `false` | 目前 Negative 沒有停用機制，固定 `false`。 |
| `raw` | string \| null | 預設 `null` | 解析前的原始 token（含權重外框），供追溯。 |
| `translated` / `untranslated` / `fragments` | array | 預設 `[]` | Negative 不經 `Dict.tr()`，必為空。 |
| `lora` / `adoptionId` | null | 預設 `null` | Negative 不注入 LoRA 觸發詞，必為 `null`。 |

`structure.negativeParse`：`{ mode: "parsed" | "raw-only", unparsed: string[] }`。`mode==="parsed"` 表示已成功執行 `parseNegative()`；`raw-only` 表示舊歷史或解析失敗，只有字串沒有 L2。

### 4.4 `parseNegative(raw)` 與 Effective Negative 組裝規則

```
1. 以 /[,\r\n]+/ 切分 raw；每段 trim；空段略過。
2. 比對 ^\((.+):([0-9]+(?:\.[0-9]+)?)\)$：
   命中 → text = group1, weight = Number(group2), raw = 原 token
   未命中 → text = token, weight = null, raw = token
3. 若 token 含未配對括號或非數值權重（看起來像權重但解析失敗），
   除了建立 entry（weight:null）外，另把原 token 放進 negativeParse.unparsed，
   保证原文不遺失。
4. negativeEntries = 所有解析後的 entry（不去重），依切分順序給 order=0,1,2,...
5. effectiveNegative = 對 negativeEntries 以 normalizeText(text) 去重，
   保留第一次出現；每筆記 {entryId, token}；
   token = weight===null || weight===1 ? text : `(${text}:${weight.toFixed(1)})`
6. order 以 effectiveNegative 的輸出順序為準（重新從 0 编号）。
```

- `normalizeText` 與 A2-R4 §6.4 同一函式：`NFKC → lowercase → trim → [_\s]+ → 單一空白`。
- **`effectiveNegative` 是 L2 描述**：呈現「若依 Composer 規則會如何去重／格式化」，但**本輪不據此改寫 `text.neg`**；現行生成仍用原字串直通。若未來要讓 Composer 真正輸出 `effectiveNegative` 字串，屬產品行為變更，需另案決策並升級 `composerVersion`。
- 與 Positive 的差異：Positive 的 `effective` 直接對應 `text.pos`（A2-R4 不變量）；Negative 的 `effectiveNegative` 目前**不**保證等於 `text.neg`，此差異必須在文件與 UI 文案標明，避免混淆。

### 4.5 `text.neg` 與 Negative Entries 的關係（三層）

| 層級 | 欄位 | 是否為權威 |
|---|---|---|
| L1 | `text.neg` / `negativeRaw` | **是**（實際送進模型的字串） |
| L2 | `negativeEntries` / `effectiveNegative` / `negativeParse` | 否（追溯與選擇性套用用） |
| 舊資料 | legacy `neg`（trim） | 僅 L1 降級用 |

若 `text.neg` 與 `effectiveNegative` 不一致，標 `integrity:"negative-effective-mismatch"`，**以 `text.neg` 為準**，不自動改字串。

### 4.6 操作案例（6 例）

| # | 情境 | negativeRaw / 舊 neg | negativeEntries（L2） | effectiveNegative | text.neg |
|---|---|---|---|---|---|
| N1 | 預設負面未改 | `worst quality, low quality, ...`（等於 `DEFAULT_NEG`） | 每逗號一個 entry，`origin:"default"`、`owner:"system"` | 依序、無去重差異 | 原字串不變 |
| N2 | 使用者在原字串後加自訂詞 | `...(DEFAULT_NEG), my token` | 前面各詞 `default`？**不可以逐詞猜**：整串 `origin:"manual"` | 全部保留 | 原字串不變 |
| N3 | 含權重外框 | `worst quality, (low quality:1.2)` | n1 `worst quality`/null；n2 `low quality`/1.2，`raw:"(low quality:1.2)"` | `[{n1,"worst quality"},{n2,"(low quality:1.2)"}]` | 原字串不變（仍含括號） |
| N4 | 重複詞 | `worst quality, WORST QUALITY` | 兩筆（n1、n2） | 只留 n1 | 原字串不變（兩個都在） |
| N5 | 無法解析內容 | `worst quality, (broken` | n2 `text:"(broken"`, weight:null；`unparsed:["(broken"]` | 保留 n2 原文 | 原字串不變 |
| N6 | 舊歷史只有 `neg`，無 Snapshot | legacy `neg:"worst quality"` | `[]`，`mode:"raw-only"` | `[]` | fallback 為 legacy `neg`，標 `restoredFrom:"legacy-neg"` |

---

## 5. R4-2：Composer 順序與一致性

### 5.1 實際程式行為（直接讀取，本輪重新確認）

- `snapshotNow()` `app.js:330-334`：
  ```
  parts = sel 格式化 → (extra ? push extra) → push(...loraTokens)
  pos = (quality ? QUALITY : "") + parts.join(", ")
  ```
- `composePrompt()` `app.js:313-317`：`[QUALITY + buildPrompt(), lora].join(", ")`；`buildPrompt()` 是 `sel` 再 `extra`。
- 兩條路徑的**最終文字順序相同**：`QUALITY → Tag → Freetext → LoRA Trigger`。
- 去重現況：`loraTokensFromSnapshot()` 只在 LoRA 之間去重；`Dict.tr()` 內部去重；**沒有跨 Tag／Freetext／LoRA 的全域去重**。全域去重是 A2-R4 已定的新設計，不是現況。

### 5.2 必須逐項核對的對照表

| 區段 | 實際程式行為 | 正式 Composer 順序 | Snapshot order | 最終文字位置 |
|---|---|---|---|---|
| Quality | `snapshotNow()` 以 `(quality ? QUALITY : "") + parts` 前綴（`app.js:333`）；`composePrompt()` 用 `q + base`（315-317） | **1（最前）** | `0,1,2`（masterpiece / best quality / amazing quality） | 字串最前 |
| Tag | `parts` 由 `sel.map` 產生（`app.js:330`）；`buildPrompt()` 的 `sel.map`（`tags.js:1002`） | **2** | `3,4,…`（依 `sel` 索引） | Quality 之後 |
| Freetext | `if (extra) parts.push(extra)`（`app.js:331`）；`buildPrompt()` 的 `tags.push(extra)`（`tags.js:1004`） | **3** | 續 Tag 之後（如 `5,6,7`） | Tag 之後 |
| LoRA Trigger | `parts.push(...loraTokens)`（`app.js:332`）；`composePrompt()` 的最後一段（316-317） | **4（最後）** | 最大（如 `8`） | 字串最後 |

**正式契約**：`order` 是**全域最終輸出位置**（Positive 與 Negative 各自從 0 起算），**不是** Entry 的產生順序。Composer 內部可以先產生 tag entry、再產生 freetext entry、最後插入 quality entry，但寫入 Snapshot 前必須依最終輸出順序重新編號。A2-R4 §6.4 的「衍生順序」一詞應理解為「建構 Entry 的順序」，與 `order` 語意不同；本報告以本表為唯一權威。

### 5.3 `effective` 如何反映去重／權重／最終組裝

1. 來源為 `structure.entries`（去重前，依 `order` 升序）。
2. 略過 `disabled === true` 與 `text === ""`。
3. 以 `normalizeText(text)` 去重，保留第一次出現（含其 weight 與 origin）。
4. 每筆輸出 `{entryId, token}`；`token = weight===null || weight===1 ? text : (text:weight.toFixed(1))`。
5. `effective` 依最終輸出順序排列。
6. **不變量**：`text.pos === effective.map(x => x.token).join(", ")`（前後 trim 後相等）。
7. 若不符合，以 `text.pos` 為 L1 權威，標 `integrity:"effective-mismatch"`，不得改寫歷史字串。

A2-R4 §5.4 範例已滿足此不變量（quality 0-2、tag 3-4、freetext 5-7、lora 8；effective 七筆；`text.pos` 等於七個 token 接合），本報告延用並在 §9 加上 Negative／Workflow 欄位。

### 5.4 未來順序改變時，舊 Snapshot 如何維持原始輸出

- `text.pos` 是不可變的实际输出，任何未來的順序變更**不得重新排序歷史字串**。
- Snapshot 自帶 `structure.entries[].order` 與 `effective`，代表**當次**的順序；還原 L2 時用 Snapshot 自己的 `order`，不用現行 Composer 的規則。
- `provenance.composerVersion` 在順序／去重／權重規則變更時遞增；舊 Snapshot 保留舊值，UI 可提示「這個歷史使用舊版組裝規則」。
- `workflow.version`（§8）另行記錄 Workflow 參數變更，與 `composerVersion` 獨立。

---

## 6. R4-3：LoRA 遷移備份持久化契約

### 6.1 問題證明（為什麼記憶體備份不安全）

1. `loraParseItems()`／`loraSerialize()`（`app.js:555-596`）白名單只保留 8 個欄位；`migration.backup`／`migration.quarantine` 不在其中。
2. `loraSave()`（`app.js:1827-1829`）每次 LoRA 操作都呼叫 `saveJSON("ui.loras", loraSerialize(S.loras))`，因此任何只存在於記憶體的 `migration.*` 會在**下一次普通存檔**時消失。
3. `loadJSON()`（`app.js:20-23`）在 `JSON.parse` 失敗時靜默回傳預設值，`ui.loras` 的原始字串**未被保存**，而且下一次存檔會覆蓋它。

**結論**：「仍在記憶體中」绝不可以描述為「已安全保存」。必須先寫入 localStorage 才視為持久化。

### 6.2 正式備份資料結構（新增 minimal key）

新增 `localStorage["ui.loras.migrationBackup"]`（**唯一新增 key**）：

```json
{
  "v": 1,
  "backups": [
    {
      "backupId": "77777777-7777-4777-8777-777777777777",
      "createdAt": 1735296000000,
      "reason": "dual-conflict",
      "sourceKey": "ui.loras",
      "itemName": "chars\\Amora.safetensors",
      "payload": {
        "kind": "item",
        "value": { "triggers": ["amora", "old_trigger"], "personalTriggers": [] }
      },
      "status": "pending",
      "confirmedAt": null,
      "note": "v1 與 v2 衝突；聯集後仍保留原始兩欄"
    }
  ]
}
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `v` | integer | 備份結構版號（目前 1） |
| `backups[].backupId` | UUID v4 | 唯一識別，建立後不變 |
| `createdAt` | integer | 建立時間（epoch ms） |
| `reason` | `"dual-conflict"` \| `"v1-data-v2-empty"` \| `"type-error"` \| `"parse-failure"` \| `"quarantine"` \| `"partial-failure"` | 為何備份 |
| `sourceKey` | string | 原始資料 key（通常 `ui.loras`） |
| `itemName` | string \| null | 單筆 LoRA 名稱；整包事件為 null |
| `payload.kind` | `"item"` \| `"raw-json"` | 結構化片段或原始 JSON 字串 |
| `payload.value` | object \| string | 原始欄位物件或原始 JSON 字串（未解析） |
| `status` | `"pending"` \| `"confirmed"` \| `"discarded"` | 生命週期狀態 |
| `confirmedAt` | integer \| null | 使用者確認時間 |
| `note` | string | 白話說明（可為空） |

> **與 A2-R4 的偏差（必須記錄）**：A2-R4 §6.6 寫「不新增持久化 key」。R4-3 要求在 `ui.loras` 本身無法解析時仍能保護原始字串，這在既有 key 內不可能達成，因此新增一個 `ui.` 前綴 key。這是任務明確要求的最小必要例外，不引入第二份 LoRA 設定權威：`ui.loras` 仍是唯一設定來源，backup 只是一旦需要可還原的保全副本。

### 6.3 生命週期與十項規則

| # | 要求 | 契約 |
|---|---|---|
| 1 | 保存在哪 | `ui.loras.migrationBackup`（localStorage）；記憶體另有 `S.lorasBackups` 鏡像，但**鏡像不等于持久化** |
| 2 | 版本／ID／時間 | `v`、`backupId`（UUID v4）、`createdAt` 必填；缺任一視為損壞備份 |
| 3 | 生命週期 | `pending`（未確認）→ `confirmed`（使用者已確認結果）→ 保留一段期間（建議 30 天，待 PD）→ 明確清理 → `discarded`／移除 |
| 4 | 何時可標已確認 | 只有使用者明確選擇「保留新結果」或「還原舊詞」並寫入 `confirmedAt` 才可；程式不得自動標 |
| 5 | 未確認備份如何避免被 `loraSerialize()` 遺失 | 備份**不放在** `ui.loras.items[]`，放在獨立 key；白名單式序列化自然不會碰到它 |
| 6 | 一般存檔如何保留 | `loraSave()` 寫完 `ui.loras` 後，**若 `S.lorasBackups.length>0` 必同時寫** `ui.loras.migrationBackup`；即使 backups 為空也不得刪除既有 key（除非已 confirmed 且過保留期） |
| 7 | 重新啟動如何恢復 | 開頁先 `loadJSON("ui.loras.migrationBackup", null)` → 驗證 `v` 與每筆必填欄 → `S.lorasBackups = ...`；`pending` 筆必須被看見，不得靜默忽略 |
| 8 | JSON 解析失敗 | 在呼叫 `loraParseState()` **之前**，把 `localStorage.getItem("ui.loras")` 的原始字串包成 `payload.kind:"raw-json"`、`reason:"parse-failure"` 寫入 backup；**原始 `ui.loras` 字串保持不動**，直到使用者確認。不可先寫空清單再備份 |
| 9 | 部分遷移失敗 | 先備份原始整包／該筆，再進行任何轉換；若轉換拋錯，保留原始 `ui.loras` 不變，backup 標 `reason:"partial-failure"`、`status:"pending"`；可恢復筆照常讀取，壞筆隔離 |
| 10 | 備份本身損壞 | 若 backup key `JSON.parse` 失敗：把原始 backup 字串另存 `ui.loras.migrationBackup.corrupt`（僅一次、覆寫前先確認不存在），**不覆蓋原 key**、不自動清除，提示人工處理；視為「尚未安全保存」 |

### 6.4 必須案例（8+1，逐案例標明位置與遺失風險）

| # | 情境 | 資料保存位置 | 是否可能遺失 | 處理 |
|---|---|---|---|---|
| B1 | v1 有詞、v2 有效空陣列（A2-R4 M6） | backup key `pending` + 原 `ui.loras` 未動 | **否** | v2 勝出但 v1 詞以 `payload.kind:"item"` 保全；一般存檔寫兩個 key |
| B2 | v1 與 v2 衝突（M5） | backup key `pending` | **否** | 聯集後仍保存兩欄原值；使用者確認後才改 `status` |
| B3 | v2 欄位型別錯誤（M3） | backup key `reason:"type-error"`／`"quarantine"` | **否** | 有效筆保留，壞筆原件入 `payload.value`；`personalTriggers` 不受影響 |
| B4 | `ui.loras` JSON 解析失敗 | backup key 存原始 JSON 字串 + 原 `ui.loras` 原樣保留 | **否**（前提：先備份再解析） | 若順序颠倒（先解析才備份）則**會遺失**，契約明令禁止 |
| B5 | 遷移途中發生錯誤 | backup key `reason:"partial-failure"` + 原 `ui.loras` 不變 | **否** | 交易式：先寫 backup，失敗即中止寫入 |
| B6 | 使用者未確認就重新載入頁面 | backup key `pending` 仍在 | **否** | 開頁讀回並提示；不能因 reload 就當已確認 |
| B7 | 一般存檔後重新啟動 | 兩個 key 都在 | **否** | `loraSave()` 必須寫 backup key；重新啟動後仍可恢復 |
| B8 | 備份確認完成後清理 | `status:"confirmed"` → 保留期後移除 | 是（**有意**丟棄） | 必須由明確確認觸發；未確認前绝不清理 |
| B9 | 備份本身損壞 | `ui.loras.migrationBackup.corrupt` + 原 backup key 不覆蓋 | **否**（但「尚未安全保存」） | 人工救援前不得宣稱資料安全 |

---

## 7. R4-4：L3 完整生成條件契約

### 7.1 `wf()` 影響生成結果的參數盤點（全部）

| 節點 | 參數 | 現值來源 | 是否影響像素 | 目前 Snapshot 狀態 |
|---|---|---|---|---|
| `1` CheckpointLoaderSimple | `ckpt_name` | `o.ckpt`（`#ckpt`） | 是 | 已保存 `conditions.ckpt` |
| `2` CLIPTextEncode | `text` | `o.pos` | 是 | 已保存 `text.pos` |
| `3` CLIPTextEncode | `text` | `o.neg` | 是 | 已保存 `text.neg` |
| `2`/`3` CLIPTextEncode | `clip` | `["1",1]` 或 LoRA 鏈最後 CLIP | 是 |  indirectly 由 `conditions.loras` 順序決定 |
| `4` EmptyLatentImage | `width` / `height` / `batch_size` | `o.w` / `o.h` / `o.n` | 是（含 batch） | 已保存 `w/h/n` |
| `5` KSampler | `model` | checkpoint MODEL 或 LoRA 鏈最後 MODEL | 是 | indirectly 由 `conditions.loras` 決定 |
| `5` KSampler | `positive` / `negative` | 節點 2 / 3 | 是 | 由 `text.pos/neg` 決定 |
| `5` KSampler | `latent_image` | 節點 4 | 是 | 由 `w/h/n` 決定 |
| `5` KSampler | `seed` | `o.seed`（實際使用值） | 是 | 已保存 `conditions.seed` |
| `5` KSampler | `steps` | `o.steps` | 是 | 已保存 `conditions.steps` |
| `5` KSampler | `cfg` | `o.cfg` | 是 | 已保存 `conditions.cfg` |
| `5` KSampler | `sampler_name` | 硬編碼 `"dpmpp_2m"`（`app.js:707`） | 是 | **未保存 → 本輪補** |
| `5` KSampler | `scheduler` | 硬編碼 `"karras"`（`app.js:707`） | 是 | **未保存 → 本輪補** |
| `5` KSampler | `denoise` | 硬編碼 `1`（`app.js:707`） | 是 | **未保存 → 本輪補** |
| LoRA Loader（動態新增） | `lora_name`, `strength_model`, `strength_clip`，以及串接順序 | `loraApplyToWorkflow()` `app.js:671-696` | 是 | `name`/`strength`/順序已保存；`strengthModel`/`strengthClip` 可被Workflow讀但 `loraSnapshot()` 不存 → 列為「可讀未保存」 |
| `6` VAEDecode | `samples`, `vae` | 節點 5 / checkpoint VAE | 是 | VAE 屬 checkpoint 外部依賴 |
| `7` SaveImage | `filename_prefix` | `"ui_" + o.fileTag`（UUID） | **否**（只影響檔名） | 不需為重現保存；可另存供查檔 |
| 整體 | 節點圖結構／類型 | `wf()` 固定 | 是 | **未保存 → 以 `workflow.version`／`fingerprint` 間接識別** |

### 7.2 三種狀態分類（不得混為「完全可重現」）

**已保存條件（Snapshot 明確記錄）**：`text.pos`、`text.neg`、`negativeRaw`、`ckpt`、`w/h/n`、`steps`、`cfg`、`seed`、`loras`（名稱、權重、順序、autoTrigger、personalTriggers）、`sampler_name`、`scheduler`、`denoise`、`workflow.id/version/fingerprint`、`provenance`（dict/tagDb/composer 版本）。

**Workflow 固定條件（目前由程式碼提供，舊 Snapshot 未逐欄保存，靠版本推斷）**：`sampler_name:"dpmpp_2m"`、`scheduler:"karras"`、`denoise:1`、節點 1–7 的圖結構、LoRA 串接規則、CLIP/MODEL/VAE 的輸出槽位、`filename_prefix` 產生規則（不影響像素）、`strengthModel`/`strengthClip` 的 fallback 規則。這些在**新版 Snapshot 已改為已保存**（ sampler/scheduler/denoise 或至少 workflow 版本），但 A2-R4 之前的歷史只能靠版本間接推斷。

**外部依賴條件（Snapshot 無法保存，重現限制）**：checkpoint 檔案內容與版本、LoRA 檔案內容與版本、VAE／CLIP 權重、ComfyUI 版本、節點實作與自訂節點、sampler/scheduler 演算法版本、VAEDecode 行為、GPU／driver／浮點非決定性、ComfyUI 啟動參數與 output 目錄。

> **不可宣稱「同一 Snapshot = 同一張圖」**。即使所有已保存條件一致，外部依賴不同仍可能產生不同結果；本契約只保證「生成條件的忠實記錄」。

### 7.3 `conditions.workflow` 正式欄位

| 欄位 | 型別 | 語意 |
|---|---|---|
| `id` | string，固定 `"sid-simple-ui-fixed-wf"` | Workflow 識別 |
| `version` | integer | 每次 `wf()`／`loraApplyToWorkflow()` 的節點或參數改變即遞增；目前定為 `1` |
| `fingerprint` | string（8 hex） | 對「節點模板（含硬編碼 sampler/scheduler/denoise、輸出槽位、LoRA 串接規則）」做穩定 hash，例如 `fnv1a32(JSON.stringify(template))` |
| `sampler_name` | string | 目前 `"dpmpp_2m"` |
| `scheduler` | string | 目前 `"karras"` |
| `denoise` | number | 目前 `1` |
| `modelLink` | string | 固定 `"checkpoint-model-then-loras-chain"` |
| `clipLink` | string | 固定 `"shared-lora-clip-chain"` |
| `vaeSource` | string | 固定 `"checkpoint:2"` |
| `outputNode` | string | 固定 `"7"`（SaveImage） |
| `capturedParams` | string[] | 本 Snapshot 已逐欄保存的鍵名（便於降級判斷） |
| `unsavedParams` | string[] | 仍需靠版本推斷或外部條件的鍵名（目前可含 `strengthModel`/`strengthClip`、模型檔案內容等） |

舊 Snapshot 沒有 `conditions.workflow` 時：以 `provenance.composerVersion==="1"` 推斷為 `version:1` 的模板，標 `workflowInferred:true`，L3 標記為「部分條件」。

---

## 8. 完整 JSON 範例（含四項補正）

以下示例延續 A2-R4 §5.4：dict `d1`、`sel = [{1girl,1},{long hair,1.2}]`、補充描述、LoRA `Amora`。新增 Negative 結構與 Workflow 條件；Positive 的 `order` 維持 Quality→Tag→Freetext→LoRA 的全域順序。

```json
{
  "url": "/comfy/view?filename=ui_123_00001_.png&subfolder=&type=output",
  "filename": "ui_123_00001_.png",
  "seed": 1234567890,
  "w": 1024,
  "h": 1024,
  "sel": [{ "t": "1girl", "w": 1 }, { "t": "long hair", "w": 1.2 }],
  "extra": "長髮，一個女孩，櫻花樹下",
  "neg": "worst quality",
  "prompt": "masterpiece, best quality, amazing quality, 1girl, (long hair:1.2), cherry blossoms, amora",
  "loras": [{
    "name": "chars\\Amora.safetensors",
    "display": "Amora",
    "strength": 0.8,
    "personalTriggers": ["amora"],
    "autoTrigger": true,
    "enabled": true,
    "noTriggerNeeded": false
  }],
  "at": 1735296000000,
  "promptSnapshot": {
    "v": 1,
    "capturedAt": 1735296000000,
    "text": {
      "pos": "masterpiece, best quality, amazing quality, 1girl, (long hair:1.2), cherry blossoms, amora",
      "neg": "worst quality"
    },
    "negativeRaw": "worst quality",
    "structure": {
      "qualityTags": true,
      "entries": [
        { "entryId": "e1", "kind": "quality", "owner": "system", "origin": "default", "text": "masterpiece", "weight": null, "order": 0 },
        { "entryId": "e2", "kind": "quality", "owner": "system", "origin": "default", "text": "best quality", "weight": null, "order": 1 },
        { "entryId": "e3", "kind": "quality", "owner": "system", "origin": "default", "text": "amazing quality", "weight": null, "order": 2 },
        { "entryId": "e4", "kind": "tag", "owner": "user", "origin": "tag-db", "text": "1girl", "weight": 1.0, "order": 3 },
        { "entryId": "e5", "kind": "tag", "owner": "user", "origin": "tag-db", "text": "long hair", "weight": 1.2, "order": 4 },
        { "entryId": "e6", "kind": "freetext", "owner": "user", "origin": "freetext", "text": "long hair", "weight": null, "raw": "長髮", "translated": ["long hair"], "untranslated": [], "fragments": [{ "raw": "長髮", "translated": ["long hair"], "untranslated": [] }], "order": 5 },
        { "entryId": "e7", "kind": "freetext", "owner": "user", "origin": "freetext", "text": "1girl", "weight": null, "raw": "一個女孩", "translated": ["1girl"], "untranslated": [], "fragments": [{ "raw": "一個女孩", "translated": ["1girl"], "untranslated": [] }], "order": 6 },
        { "entryId": "e8", "kind": "freetext", "owner": "user", "origin": "freetext", "text": "cherry blossoms", "weight": null, "raw": "櫻花樹下", "translated": ["cherry blossoms"], "untranslated": ["樹下"], "fragments": [{ "raw": "櫻花樹下", "translated": ["cherry blossoms"], "untranslated": ["樹下"] }], "order": 7 },
        { "entryId": "e9", "kind": "lora-trigger", "owner": "user", "origin": "author-civitai", "text": "amora", "weight": null, "order": 8, "lora": "chars\\Amora.safetensors", "adoptionId": "11111111-1111-4111-8111-111111111111" }
      ],
      "effective": [
        { "entryId": "e1", "token": "masterpiece" },
        { "entryId": "e2", "token": "best quality" },
        { "entryId": "e3", "token": "amazing quality" },
        { "entryId": "e4", "token": "1girl" },
        { "entryId": "e5", "token": "(long hair:1.2)" },
        { "entryId": "e8", "token": "cherry blossoms" },
        { "entryId": "e9", "token": "amora" }
      ],
      "negativeEntries": [
        { "entryId": "n1", "kind": "default", "owner": "system", "origin": "default", "text": "worst quality", "weight": null, "order": 0, "raw": "worst quality" }
      ],
      "effectiveNegative": [
        { "entryId": "n1", "token": "worst quality" }
      ],
      "negativeParse": { "mode": "parsed", "unparsed": [] }
    },
    "conditions": {
      "ckpt": "WAI-Nsfw-Illustrious-17.safetensors",
      "w": 1024,
      "h": 1024,
      "n": 1,
      "steps": 25,
      "cfg": 6,
      "seed": 1234567890,
      "loras": [{
        "name": "chars\\Amora.safetensors",
        "display": "Amora",
        "strength": 0.8,
        "personalTriggers": ["amora"],
        "autoTrigger": true,
        "noTriggerNeeded": false,
        "enabledAtCapture": true,
        "adoptionIds": ["11111111-1111-4111-8111-111111111111"]
      }],
      "workflow": {
        "id": "sid-simple-ui-fixed-wf",
        "version": 1,
        "fingerprint": "1a2b3c4d",
        "sampler_name": "dpmpp_2m",
        "scheduler": "karras",
        "denoise": 1,
        "modelLink": "checkpoint-model-then-loras-chain",
        "clipLink": "shared-lora-clip-chain",
        "vaeSource": "checkpoint:2",
        "outputNode": "7",
        "capturedParams": ["ckpt", "pos", "neg", "w", "h", "n", "seed", "steps", "cfg", "sampler_name", "scheduler", "denoise", "loras", "workflow.version"],
        "unsavedParams": ["strengthModel", "strengthClip", "checkpoint-file-content", "lora-file-content", "comfyui-version"]
      }
    },
    "provenance": {
      "dictFingerprint": "d1",
      "tagDbFingerprint": "c1",
      "composerVersion": "1"
    }
  }
}
```

**範例不變量檢查**：

1. `entries` 9 筆；`order` 0→8 對應 Quality→Tag→Freetext→LoRA，與 §5.2 對照表一致。
2. `effective` 7 筆；`text.pos === effective.map(token).join(", ")` 且等於 legacy `prompt`。
3. `negativeRaw === text.neg`；`negativeEntries[0].order=0`；`effectiveNegative[0].token` 等於 `text.neg`（本例無去重差異）。
4. `conditions.workflow` 記錄了 `sampler_name`／`scheduler`／`denoise` 與版本／指紋；`unsavedParams` 明列外部依賴。
5. 範例只使用本報告與 A2-R4 定義過的欄位／枚舉。

---

## 9. 一致性矩陣與與 A2-R4 差異

### 9.1 一致性矩陣

| 檢查項目 | 狀態 | 依據 |
|---|---|---|
| Negative 有正式結構快照 | 完成 | §4.2–§4.4：`negativeRaw`／`negativeEntries`／`effectiveNegative`／`negativeParse` |
| Positive / Negative Snapshot 契約對稱 | 完成 | Negative Entry 沿用 SnapshotEntry 同名同型欄位，僅限制 kind/origin 子集（§4.3） |
| `text.neg` 為 L1 權威且等於 `negativeRaw` | 完成 | §4.2 不變量；明確區分 legacy `neg` 為 trim 後值 |
| Composer 順序與實際程式一致 | 完成 | §5.2 對照表：Quality→Tag→Freetext→LoRA（`app.js:330-334`） |
| `order` 語意唯一 | 完成 | §5.2：全域最終輸出位置；正／負各自從 0 起算 |
| 所有 JSON 範例與欄位定義一致 | 完成 | §8 範例逐欄比對 §4.3／§5.2／§7.3；本報告 2 個 ```json``` block 已於寫入後通過解析驗證 |
| 遷移備份可持久化 | 完成 | §6.2 新 key + §6.3 寫入順序；`loraSave()` 必須寫兩 key |
| 一般存檔不遺失未確認備份 | 完成 | §6.3 規則 5/6；備份不在 `ui.loras.items[]`，白名單序列化碰不到 |
| JSON 解析失敗不靜默覆蓋 | 完成 | §6.3 規則 8：先存原始字串，原 `ui.loras` 保持不動 |
| L3 列出目前 Workflow 所有影響生成參數 | 完成 | §7.1 全节点参数表 |
| 明確標示已保存／Workflow 固定／外部依賴 | 完成 | §7.2 三類；§8 `unsavedParams` 明列 |
| 不誇大重現能力 | 完成 | §7.2 結論明確「不宣稱同一 Snapshot = 同一張圖」 |
| 不推翻 A2-R4 已通過方向 | 完成 | §1 明列維持 12 項；唯一偏差為備份 key，已於 §6.2 說明 |
| 不擴張 A3 UX／實作 | 完成 | 本報告只有契約與案例；未設計 UI、未寫程式 |

### 9.2 與 A2-R4 的差異

| # | A2-R4 | A2-R4-R1（本報告） | 原因 |
|---|---|---|---|
| 1 | 只有 `text.neg` + `negativeRaw` 概念，無 Negative Entries | 新增 `negativeRaw`、`structure.negativeEntries`、`effectiveNegative`、`negativeParse`（§4） | ChatGPT 審查：L2 无法還原負向結構 |
| 2 | 說 Composer 解析 `negativeRaw` 產生 `neg` | 現況是原字串直通；解析只做 L2 描述，不改 `text.neg` | 以實際程式碼為準；避免假裝已有行為 |
| 3 | gallery `neg` 與 `text.neg` 未區分 trim | `negativeRaw`/`text.neg` = 未 trim 的實際送出字串；legacy `neg` 仍是 trim | `wf()` 用未 trim 值，`app.js:904` 存 trim 值 |
| 4 | §6.4「衍生順序 Tag→Freetext→LoRA→Quality」 | 正式順序 Quality→Tag→Freetext→LoRA；`order` = 最終輸出位置 | 與 `snapshotNow()`／§5.4 範例一致 |
| 5 | `migration.backup`／`quarantine` 只在記憶體推導 | 新增 `ui.loras.migrationBackup` 持久化 key + 完整生命週期 | 白名單序列化會丟失；解析失敗需保全原始字串 |
| 6 | 「不新增持久化 key」 | 唯一新增 `ui.loras.migrationBackup`（必要例外） | R4-3 要求；仍不建立第二份設定權威 |
| 7 | L3 只有 ckpt／尺寸／seed／steps／cfg／LoRA | 補 `sampler_name`／`scheduler`／`denoise`／`workflow.id/version/fingerprint`／三類條件分類 | `wf()` 硬編碼參數未來可能變 |
| 8 | 未明列外部依賴 | 明確列出模型檔案、ComfyUI 版本、節點實作、浮點非決定性等 | 不得宣稱完全可重現 |

---

## 10. 尚未解決問題與重現限制

1. **真實 localStorage 未檢視**：只依程式碼定義結構；不知道使用者現有 `ui.loras`／`ui.gallery` 是否有異常格式。
2. **CodeGraph 索引過期**（Added 5／Modified 6）：依禁令未 sync；符號查詢可能遺漏新函式，行號以直接讀檔為準。
3. **Schema/範例未自動驗證**：本輪只做人工比對與 JSON 解析檢查；需實作階段以測試固化不變量。
4. **Negative 解析與現行輸出不一致**：`effectiveNegative` 是 L2 描述，目前不改變 `text.neg`；若要讓 Composer 真正輸出去重／權重格式化的負向字串，屬產品行為變更（需升級 `composerVersion`）。
5. **`strengthModel`／`strengthClip`**：`loraApplyToWorkflow()` 會讀，但 `loraSnapshot()` 不存；若日後 UI 提供這兩個欄位，L3 需同步擴充。
6. **外部依賴無法保存**：模型檔案內容、ComfyUI／節點版本、VAE／CLIP、浮點非決定性 → **不保證同圖**。
7. **`filename_prefix` 使用隨機 `fileTag`**：不影響像素，未列入 Snapshot 重現欄位；若需查檔可另存，但不屬 L3 必要條件。
8. **備份保留天數未定**（建議 30 天，見 PD4）。
9. **A2-R4 的舊 Snapshot（無 `conditions.workflow`）**：只能靠 `composerVersion` 推斷模板版本，屬部分條件。

---

## 11. 需要產品負責人決策

| # | 決策 | 本報告暫定 |
|---|---|---|
| PD1 | `effectiveNegative` 未來是否要真正改寫 `text.neg`（啟用負向去重／權重格式化）？ | 暫不啟用，維持原字串直通；需產品確認 |
| PD2 | 備份 `pending` → `confirmed` 的 UI 由誰操作、如何呈現？ | 本輪不設計 UX；資料欄位已備妥 |
| PD3 | v1/v2 衝突聯集策略是否維持？ | 維持 A2-R4 的聯集＋警告 |
| PD4 | 已確認備份保留多久？ | 建議 30 天後才允許清理 |
| PD5 | `ui.loras.migrationBackup` 新增 key 是否接受？ | 建議接受；這是解析失敗時唯一可保全原始字串的方式 |
| PD6 | `workflow.version` 何時遞增的責任歸屬？ | 任何 `wf()` 參數或節點結構變動都應遞增；需納入開發流程 |

---

## 12. 本次未執行的工作及原因

| 未執行 | 原因 |
|---|---|
| 修改既有程式碼／測試／舊報告／AGENTS／README／設定 | 唯讀任務明確禁止 |
| 修改 localStorage、模型、Tag DB、Dict、LoRA | 同上 |
| 啟停服務、生圖、GPU 測試、HTTP／WS API 請求 | 同上；僅做 TCP 連通性檢查 |
| `codegraph sync` | 明確禁止 |
| Git 寫入（stage/commit/push/reset/restore/stash/checkout/clean） | 明確禁止 |
| 以瀏覽器讀取真實 localStorage 值 | 非必要；任務要求確認「實際使用的資料結構」，已由程式碼確認 |
| 執行既有測試／語法檢查 | 本輪未改程式碼，無修改可驗證 |

---

## 13. Git 最終狀態

- 唯一新增：`devtools/reports/prompt-tag-system-a2-r4-r1-final-contract-fixes.md`（untracked）。
- 開始時 15 modified／0 staged／61 untracked 全部未動。
- 寫入後實際執行 `git status --porcelain`：`modified=15`、`staged=0`、`untracked=62`、`total=77`（開始時為 15／0／61／76），唯一新增的 untracked 項目正是本報告 `?? devtools/reports/prompt-tag-system-a2-r4-r1-final-contract-fixes.md`。
- 寫入後實際執行 `git diff --check`：`exit 0`（無空白錯誤）；仍有兩個既存的 CRLF 警告（`devtools/lora_api_test.py`、`devtools/lora_core_test.mjs`），與本輪無關，未做任何轉換。
- Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、Ahead 1／Behind 0 不變。

---

## 14. 正式服務是否受到影響

**沒有**。未停止、重啟或設定 ComfyUI、simple_ui（7860）、WD14 Worker；兩服務原本即在監聽，本輪未送出任何 HTTP／WebSocket 請求、未生圖、未讀取 API Key、未寫入使用者資料。唯一外部動作是唯讀 TCP 連通性檢查與 CMD `codegraph status`。本報告是純 Markdown，不影響執行期行為。

---

## 15. ChatGPT 獨立審查重點

1. **§4.3 Negative Entry 限制子集**（只用 `default`/`manual`、`kind` 不用 `tag`/`lora-trigger`）是否真的與 Positive「對稱」？還是應該允許 Negative 也有 `tag` kind？
2. **§4.4 `effectiveNegative` 只做 L2 描述、不改 `text.neg`** 是否會造成「有兩個負向結果」的混淆？是否應直接禁用 effectiveNegative 的 weight 格式化，只保留去重視圖？
3. **§5.2 `order` 定位為「最終輸出位置」** 是否與 A2-R4 §6.4「衍生順序」造成實作者的雙重解讀？是否需要把 §6.4 原文明確標為「已廢棄」？
4. **§6.2 新增 `ui.loras.migrationBackup`** 是否真的是最小必要例外？有沒有在未新增 key 的前提下保護「解析失敗的原始字串」的方法？
5. **§6.3 規則 6**：`loraSave()` 必須同時寫 backup key；若 backup key 寫入失敗（配額／無痕模式）該如何？目前契約只說不能假裝已保存，是否需要額外狀態碼？
6. **§7.1 的 `strengthModel`／`strengthClip`**：`loraSnapshot()` 不存但 Workflow 會讀，是否構成 L3 的隱藏不可重現來源？
7. **§7.2 三類分類**：`sampler_name`/`scheduler`/`denoise` 在新 Snapshot 屬「已保存」、舊 Snapshot 屬「Workflow 固定」，這個雙重身份是否清楚？

---

**結論**：A2-R4-R1 完成四項定點補正：（1）Negative 與 Positive 對稱的 L2 結構契約；（2）以實際程式碼為準的 Quality→Tag→Freetext→LoRA 順序與全域 `order` 語意；（3）可持久化、可恢復、未確認不清除的 LoRA 遷移備份；（4）完整 L3 條件（含 sampler/scheduler/denoise 與 Workflow 版本）及三類重現限制。本輪**只新增本報告**，未修改任何既有檔案，未執行 Git 寫入，未影響正式服務，**不開始任何實作**。
