# Sid-simple-ui Prompt / Tag / LoRA 最終資料模型補正（A2-R4）

- **日期**：2026-11-27（本機時間 00:57 +08:00 開始）
- **專案**：`C:\ComfyUI\simple_ui`（`Sid-1996/sid-comfyui-simple-ui`）
- **性質**：**唯讀設計調查與報告**。未修改任何既有程式碼、測試、報告、設定、模型、Tag DB、Dict、LoRA 檔案或使用者資料；未執行 Git 寫入；未啟動／停止／重啟正式服務；未生圖；未執行 `codegraph sync`。
- **交付**：只新增本報告一份檔案：`devtools/reports/prompt-tag-system-a2-r4-final-model-correction.md`。不覆蓋任何舊報告。
- **相依報告**（全部已讀取）：
  - `devtools/reports/prompt-tag-system-consolidation-audit.md`
  - `devtools/reports/lora-trigger-words-a1-audit.md`
  - `devtools/reports/prompt-tag-system-a2-data-model-design.md`
  - `devtools/reports/prompt-tag-system-a2-r1-design-correction.md`
  - `devtools/reports/prompt-tag-system-a2-r2-model-consistency.md`
  - `devtools/reports/prompt-tag-system-a2-r3-final-model.md`（本報告直接補正的對象）
- **規範文件**（全部已讀取）：`C:\ComfyUI\AGENTS.md`、`C:\ComfyUI\simple_ui\AGENTS.md`、`devtools/README.md`（導覽參考）。

---

## 1. 任務目標與範圍

A2-R3 建立了混合式架構方向，但經 ChatGPT 獨立審查後仍留下三項阻擋問題：

1. 作者建議詞的採用關係無法正確表示**多來源、多群組、多次採用**，且 `groupIndex` 是不穩定的位置索引。
2. 歷史 Prompt 快照沒有正式持久化契約，也無法保證保留生成當時的翻譯結果（不能依賴未來的 `Dict.tr()`）。
3. 欄位定義、JSON 範例、枚舉與遷移規則之間存在不一致（例如 R3 禁止 `origin: "personal"` 卻又在範例使用、`fragments` 出現在範例卻不在欄位表、R3 §5.3 明說 `promptSnapshot` 不進 `ui.gallery` 但又定義歷史快照結構）。

本輪針對上述三項做**最終契約補正**，目標是讓後續實作者可直接依照本報告的欄位表、Schema、操作流程、遷移表與一致性矩陣實作。

本輪**不重新討論** A2-R1 已確立的整體架構（詳 §6.6）：PromptModel 為衍生模型、既有 localStorage 持久化來源不變、PromptComposer 唯一組裝責任、四類資料分離、`personalTriggers` 唯一注入來源、`authorSuggestions` 唯讀、負向暫存原始字串、舊資料漸進相容。

---

## 2. 開始前檢查紀錄

### 2.1 設備與連線狀態

| 項目 | 結果 |
|---|---|
| 時間 | 2026-11-27 00:57:20 +08:00 |
| 主機 / 使用者 | `DESKTOP-ADPHHAP` / `desktop-adphhap\user` |
| Git | `git version 2.55.0.windows.3` |
| Python | `Python 3.13.15` |
| 外部連線 | `github.com:443` TCP 連線成功（遠端可達） |
| 本機服務 | `127.0.0.1:7860`（simple_ui）與 `127.0.0.1:8188`（ComfyUI）皆在監聽（仅 TCP connect 測試，**未发送任何 HTTP 請求**） |

連線檢查使用 Python `socket.create_connection` / `connect_ex`，唯讀，未連到任何 API 端點。

### 2.2 文件讀取紀錄

| 檔案 | 狀態 |
|---|---|
| `C:\ComfyUI\AGENTS.md` | 已讀取（303 行） |
| `C:\ComfyUI\simple_ui\AGENTS.md` | 已讀取（184 行） |
| `devtools/README.md` | 已確認存在（報告導覽用） |
| §開頭所列 6 份設計／調查報告 | 全部已讀取 |

### 2.3 CodeGraph 狀態

依任務要求「優先使用 CMD 執行；不得因 PowerShell 執行環境錯誤就判定 CodeGraph 不可用」：

1. 先後兩次嘗試 `cmd /c "cd /d C:\ComfyUI\simple_ui && codegraph status"` 與 `cmd /c codegraph status`，皆在 shell 啟動階段失敗，錯誤為 `failed to spawn ...pwsh.EXE: OS Error -1073283067 (FormatMessageW() returned error 317)`。**這是 harness 的 pwsh 啟動錯誤，不是 CodeGraph 本身的錯誤**。
2. 改在 `C:\ComfyUI\simple_ui` 工作目錄直接執行 `codegraph status`，**成功**。

```
CodeGraph Status
Project: C:\ComfyUI\simple_ui
Index Statistics:
  Files: 35   Nodes: 1,094   Edges: 4,837
  DB Size: 7.02 MB   Backend: node:sqlite — built-in (full WAL)   Journal: wal
Nodes by Kind: function 488 / variable 161 / import 158 / constant 136 /
               method 95 / file 32 / class 24
Files by Language: javascript 19 / python 13 / yaml 3
Pending Changes: Added 5 files / Modified 6 files
```

- 索引**已過期**（pending changes），且 `codegraph_explore` 回傳的符號行號與磁碟實際行號不一致（例如它標示 `reusePrompt` 在 `app.js:1060`，但實際 `reusePrompt` 在 `app.js:1210`；`loraSnapshot` 標示 519，實際 641）。
- 依禁令**未執行 `codegraph sync`**。所有行號與程式碼結論以直接 Read 目前磁碟原始碼為準；CodeGraph 僅作為交叉參考，不作為行號依據。

### 2.4 Git 狀態（開始時）

查詢方式：`git -C C:\ComfyUI\simple_ui status -sb`、`git status --porcelain`、`git log --oneline ...`（`rev-list --left-right --count HEAD...origin/main` 因 shell spawn 錯誤未回傳，改以兩方向 `git log --oneline` 判定）。

| 項目 | 結果 |
|---|---|
| Repository 根目錄 | `C:/ComfyUI/simple_ui` |
| Branch | `main` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 同址） |
| Ahead / Behind | `1` / `0`（`origin/main..HEAD` 有 `cf5609e feat: add Civitai LoRA explorer`；反向無 commit） |
| Staged | 0 |
| Modified（tracked） | **15** 個：`AGENTS.md`, `app.css`, `app.js`, `devtools/lora_api_test.py`, `devtools/lora_core_test.mjs`, `devtools/lora_explorer_api_test.py`, `devtools/lora_explorer_core_test.mjs`, `devtools/lora_mock_civitai.py`, `devtools/lora_ui_test.mjs`, `devtools/test_ui_control_wd14.ps1`, `index.html`, `server.py`, `ui_control.ps1`, `ui_panel.ps1`, `ui_panel.pyw` |
| Untracked | **60** 個 porcelain 項目（含多份 `devtools/reports/*.md`、`devtools/*.mjs` / `*.py`、`comfy_lora_paths.py` 與兩個 untracked 目錄） |
| 既有使用者修改 | **存在**（上述 15 個 modified + 60 個 untracked）。本輪全部未動。 |

> **與舊報告的差異**：A2-R3 等舊報告寫「13 個 modified / 48 個 untracked」，但實際 `git status --porcelain` 為 **15 modified / 60 untracked**（舊報告自己列出的 modified 檔名其實也是 15 個，數字與清單不符）。本報告以實際 Git 輸出為準。

---

## 3. 實際程式碼與既有資料結構調查結果

以下為本輪重新讀取的**目前磁碟程式碼**（行號以直接 Read / Grep 為準；與舊報告行號大致一致，但 CodeGraph 索引行號不可信）。

### 3.1 Prompt 組裝與快照（實際路徑）

| 函式 / 常數 | 位置 | 實際行為 |
|---|---|---|
| `QUALITY` | `app.js:12` | `"masterpiece, best quality, amazing quality, "` |
| `DEFAULT_NEG` | `app.js:13` | 固定負面字串 |
| `loadJSON` / `saveJSON` | `app.js:20-26` | localStorage 讀寫，例外吞掉（無痕模式） |
| `composePrompt()` | `app.js:313-318` | `Tags.buildPrompt()` + QUALITY + `loraTokensFromSnapshot(loraSnapshot(S.loras))`，以 `, ` 接合並 trim |
| `snapshotNow()` | `app.js:322-350` | 自行組裝：Q + `sel` 權重格式化 + `Dict.tr(#pos)` + loraTokens；回傳 `sel, pos, neg, extraRaw, ckpt, w, h, n, steps, cfg, seed, loras, loraTokens` |
| `showPromptModal()` | `app.js:1782-1804` | 用 `composePrompt()` 做預覽/複製 |
| `generate()` | `app.js:842-1010` | `snap = snapshotNow()`；`o.pos = snap.pos`；`wf(o)` 送 `/prompt`；結果寫入 `ui.gallery` |
| 歷史寫入 | `app.js:957-973` | 每張圖 `{url, filename, seed, w, h, sel, extra, neg, prompt:o.pos, loras:snap.loras, at}`，最多 24 筆 |
| `reusePrompt()` | `app.js:1210-1239` | `Tags.restore(it.sel)`、`#pos = it.extra`、`#neg = it.neg`；`it.loras` 若為陣列則整組覆寫 `S.loras`，且 `authorSuggestions` 取自**目前** LoRA（`app.js:1226`），`enabled` 一律 `true` |
| `syncGallery()` | `app.js:1102-1129` | 問 `/api/check`；`comfy:false` 時完全不動紀錄 |

**關鍵事實**：`composePrompt()` 與 `snapshotNow()` 是兩份獨立組裝邏輯，.generate 實際使用的是 `snapshotNow().pos`；`ui.gallery[].prompt` 是該字串的副本，但 `reusePrompt()` 不以它還原，而以 `sel`/`extra`/`neg` 重新衍生 → 字典更新後重現結果可能不同。

### 3.2 LoRA 核心（實際仍為 v1）

| 函式 / 常數 | 位置 | 實際行為 |
|---|---|---|
| `LORA_VERSION` | `app.js:393` | `1` |
| `loraNorm()` | `app.js:406-408` | lowercase + trim + `[_\s]+` → 單一空白 |
| `loraCleanTriggerList()` / `loraCleanTriggers()` | `app.js:439-455` | 清理去重；個人詞上限 40；**不按逗號切割** |
| `loraAddPlan()` | `app.js:459-474` | 計算加入作者詞後的結果與數量 |
| `loraNormGroups()` / `loraCivitaiGroups()` / `loraFingerprint()` | `app.js:478-509` | 建議群組正規化；fingerprint 用 32-bit FNV-1a |
| `loraAuthorDefault()` / `loraParseAuthor()` | `app.js:511-537` | 建議欄位白名單解析；缺欄位回預設 |
| `loraParseItems()` | `app.js:555-576` | **白名單式重建**：只接受 `name, display, strength, triggers, autoTrigger, enabled, authorSuggestions, noTriggerNeeded` |
| `loraParseState()` / `loraSerialize()` | `app.js:578-596` | 寫出 `{v:1, items:[...]}`；新欄位若未加入白名單會靜默丟失 |
| `loraSet()` | `app.js:604-626` | 同名合併、不可變更新；patch 僅接受已知欄位 |
| `loraSnapshot()` | `app.js:641-650` | 只存 `name, display, strength, triggers, autoTrigger, noTriggerNeeded`；**不存 enabled、authorSuggestions** |
| `loraTokensFromSnapshot()` | `app.js:654-668` | `autoTrigger===false` 跳過；跨 LoRA 以 `loraNorm` 去重 |
| `loraApplyToWorkflow()` / `wf()` | `app.js:671-712` | 負責 LoraLoader 節點串接，與 Prompt 文字組裝無關 |
| `loraRemindBeforeGenerate()` | `app.js:820-840` | 生成前非阻塞提醒（autoOff / hasSuggestions / missing） |
| `loraSetLocalGroups()` | `app.js:2573-2582` | 只更新 `authorSuggestions.local.groups` |
| `loraRenderAuthorGroups()` / `renderLoraTriggers()` | `app.js:2584-2706` | 作者建議唯讀顯示（建議 1/2…、整組加入、逐詞加入），個人 chip 無來源標記 |
| `loadCivMeta()` | `app.js:2727-2783` | 只更新 `civitai.groups/fetchedAt/fingerprint`，**不碰個人 triggers**；用 `civReqSeq` 讓過期請求失效 |
| `loraAddAuthorWords()` | `app.js:2794-2817` | `loraAddPlan` 後把詞 concat 進 `triggers`，並設 `noTriggerNeeded:false`；**不記錄來源** |
| `loraLinkCv()` / `loraParseCvId()` | `app.js:2785-2850` | 版本 URL/數字解析；同版本重讀保留舊建議 |
| `loraSaveTriggerInput()` | `app.js:2886-2902` | 手動輸入**有** `/[,\r\n]+/` 切割；設 `noTriggerNeeded:false` |
| `loraOnTriggersClick()` | `app.js:2904-2969` | 刪 chip、編輯、`use-meta`、`add-group`/`add-word`、`no-trigger`、`cv-link`、`cv-unlink` |
| `cv-unlink` | `app.js:2953-2967` | 清空 `civitai` 建議與版本，**不碰個人 triggers**，並讓舊請求失效 |
| `loraSave()` | `app.js:1827-1829` | `saveJSON("ui.loras", loraSerialize(S.loras))` |

**關鍵事實**：目前**沒有** `adoptedSources`、`adoptionRecords`、`personalTriggers`、`promptSnapshot` 任何欄位或程式碼。A2-R2/R3 的 `adoptedSources` 是**尚未實作的設計提議**，不是現況。

### 3.3 Dict 實際行為（已用 Node 唯讀驗證）

`dict.js:23-32` 的 `Dict.tr(s, keep)`：分隔符 `[，、；;\n]+` → `,`；依 `DICT` 長匹配優先替換；trim；去空；`keep=false` 時過濾含中文的片段；全域去重；`, ` 接合。

唯讀執行 `node -e "global.window={};require('.../dict.js');..."` 的實際輸出：

| 輸入 | `tr()` | `leftover()` |
|---|---|---|
| `櫻花樹下` | `cherry blossoms` | `["樹下"]` |
| `長髮，一個女孩，櫻花樹下` | `long hair, 1girl, cherry blossoms` | — |
| `樹下` | `""` | — |

所以 R3 的 `Dict.tr("櫻花樹下") → "cherry blossoms"` 正確；但 R3 §6.2 把 `fragments` 寫成 `{raw:"櫻花樹下", translated:["cherry blossoms"], untranslated:[]}` 是**不精確**的：實際未翻譯片段是 `樹下`，不是空陣列。本報告 §5 的 fragments 契約據此修正。

### 3.4 Tags 實際行為

- `tags.js:260-280`：從 `sel`, `combos`, `adult`, `showEn`, `ui.moreCats`, `ui.selSortMode`, `ui.learnedTags` 讀取。
- `tags.js:294-304`：`save()` 寫回上述 key。
- `tags.js:601-612`：`commit()` 在 auto 模式排序後存檔。
- `tags.js:616` `norm()`、`tags.js:288-292` `tagAlts()`：小寫 + 底線/空白互通，後者拆 `/` 同義。
- `tags.js:1001-1006` `buildPrompt()`：`sel` 權重格式化 + `Dict.tr(#pos)`，不含 QUALITY / LoRA。
- `tags.js:1020-1030` `snapshot()` 深拷貝、`restore()` 整組替換並強制 `sortMode="manual"`。
- `tags.js:1032-1045` `addTags()`：增量去重，拒絕含逗號的輸入。
- `tags.js:1048-1055` `matchTag()`：CATS 正名比對（WD14 分流用）。

### 3.5 實際使用的 localStorage 結構

| Key | 實際格式 | 擁有者 |
|---|---|---|
| `sel` | `[{t:string, w:number}]` | `tags.js` |
| `combos` | 使用者組合陣列 | `tags.js` |
| `adult` / `showEn` / `ui.moreCats` / `ui.advOpen` | `"1"` / `"0"` | `tags.js` / `app.js` |
| `ui.selSortMode` | `"auto"` / `"manual"` | `tags.js` |
| `ui.learnedTags` | `{general:[], positive:[], negative:[]}`（舊版可能為純陣列，已有相容讀取） | `tags.js` |
| `ui.tagStats` + `ui.tagStats.evt.*` / `fav.*` / `broken.*` | 統計物件 | `tags.js` |
| `ui.extra` | `#pos` 原始字串（**唯一**補充描述 key；不讀舊 `pos`） | `app.js` |
| `ui.settings` | `{size,n,quality,neg,steps,cfg,ckpt,seed}` | `app.js` |
| `ui.gallery` | 歷史陣列，最多 24；項目如 §3.1 | `app.js` |
| `ui.loras` | `{v:1, items:[{name,display,strength,triggers,autoTrigger,enabled,authorSuggestions,noTriggerNeeded}]}` | `app.js` |
| `ui.genLog` | 陣列，最多 50 | `app.js` |

**本輪未讀取瀏覽器內的實際 localStorage 值**（唯讀設計任務，且任務只要求確認「實際使用的資料結構」）；上述結構由程式碼直接確認。真實使用者資料是否含異常格式，仍屬未驗證項目（§9）。

### 3.6 文件與程式碼的差異紀錄

| 項目 | 舊報告 | 實際程式碼 | 處理 |
|---|---|---|---|
| `adoptedSources` | A2-R2/R3 當作既有設計範例 | 程式碼完全不存在 | 視為**提議**，本輪重新設計為 `adoptionRecords`（§4） |
| `personalTriggers` | A2-R2/R3 v2 提議 | 實際仍為 `triggers`，`LORA_VERSION=1` | 保留 v1→v2 遷移契約（§6.3） |
| `promptSnapshot` | A2-R2 §7.2.4 提議；A2-R3 §5.3 又說「不進 ui.gallery」 | 程式碼不存在；兩份報告互相矛盾 | 本輪定為**正式持久化欄位**（§5） |
| `origin:"personal"` | A2-R3 §9.4 / §11.3 在欄位表禁止、範例使用 | 無此程式碼 | 本輪枚舉改為 `manual`，並修正所有範例（§6.1） |
| `owner:"lora"` | A2-R1/R2/R3 使用 | 無此程式碼 | 本輪移除，避免與 `lora` 欄位語意重疊（§6.1） |
| `fragments` | A2-R3 範例有、欄位表無 | 無此程式碼 | 本輪正式定義（§6.1、§5.2） |
| Tracked modified 數 | 舊報告寫 13 | 實際 15 | 本報告以 Git 輸出為準（§2.4） |
| CodeGraph 可用性 | A2-R1/A2-R3 寫「pwsh 0 bytes 無法執行」 | 本輪直接執行成功，索引過期但可用 | 修正為「可執行但索引過期」（§2.3） |

---

## 4. 補正一：作者建議詞採用關係模型

### 4.1 設計結論（一句話）

**把「採用」建模成一筆筆有 `adoptionId` 的獨立紀錄（事件），而不是以來源為鍵的 Map；個人詞 `personalTriggers` 仍是字串陣列，採用紀錄只是唯讀來源證據，永不擁有、永不自動刪除個人詞。**

Legacy `adoptedSources`（A2-R3 §5.1）停止使用；v2 改名為 `adoptionRecords`（陣列），避免新舊形狀混淆。

### 4.2 正式欄位定義（`ui.loras.items[].adoptionRecords[]`）

| 欄位 | 型別 | 必填 | 持久化 | 語意 |
|---|---|---|---|---|
| `adoptionId` | string（UUID v4） | 是 | 是 | 單筆採用事件唯一識別。每次「採用」操作（含重複採用同一詞）都產生新 UUID；一生不變、不重用、不隨來源更新而變。 |
| `source.kind` | `"author-local"` \| `"author-civitai"` | 是 | 是 | 作者建議來源種類。嚴格區分本機 metadata 與 Civitai 版本。 |
| `source.versionId` | integer(1..2147483647) \| null | 是 | 是 | `kind==="author-civitai"` 時必為整數；`author-local` 時必為 `null`。 |
| `source.localFingerprint` | string \| null | 是 | 是 | `kind==="author-local"` 時記錄當時本機 metadata 的 fingerprint；Civitai 時必為 `null`。 |
| `source.sourceFingerprint` | string \| null | 是 | 是 | 採用當時整個建議快照的 fingerprint（Civitai 用 API `fingerprint`；local 用 `loraFingerprint(groups, null)`）。可為 `null`（來源尚未提供），用于判定「來源是否已改變」。 |
| `sourceGroupId` | string | 是 | 是 | 來源內群組的**內容識別**，不是陣列索引。格式 `g_<8 hex>`；找不到原始群組時 `g_unknown_<8 hex>`；碰撞時 `g_<8hex>.<n>`。 |
| `word` | string(1..200) | 是 | 是 | 採用當時從建議複製的字串原樣（不可變）。 |
| `wordKey` | string(1..200) | 是 | 是 | `word` 的正規化比對鍵：`NFKC → lowercase → trim → [_\s]+ 轉單一空白`。 |
| `adoptedAt` | integer ≥ 0 | 是 | 是 | 採用事件時間（epoch ms）。 |
| `via` | `"word"` \| `"group"` \| `"all-local"` \| `"migration"` | 是 | 是 | 採用操作種類：`word`=逐詞、`group`=整組、`all-local`=全部本機建議、`migration`=舊版轉換。 |

**衍生欄位（不持久化，讀取時計算）**：

| 欄位 | 型別 | 規則 |
|---|---|---|
| `sourceStatus` | `"available"` \| `"changed"` \| `"unavailable"` | 見 §4.4。 |
| `supportCount` | integer ≥ 0 | 同一 `wordKey` 在此 LoRA 的 `adoptionRecords` 中筆數。 |

**群組識別演算法（`sourceGroupId`，必須可重現）**：

1. `wordKey(s) = String(s||"").normalize("NFKC").toLowerCase().trim().replace(/[_\s]+/g," ")`。
2. `canonicalGroupKey(words)` = `words.map(wordKey)` → 去重（保留首次）→ 字典序排序 → 以 `U+001F` 接合。
3. `fnv1a32(s)` = offset basis `2166136261`，逐 byte `h = ((h ^ byte) * 16777619) >>> 0`，輸出 8 位小寫 hex。
4. `sourceGroupId = "g_" + fnv1a32(canonicalGroupKey(words))`。
5. 若同一來源快照中兩個**不同內容**的群組算到同一 hash（碰撞），在「碰撞集合內依 `canonicalGroupKey` 排序」後附 `.1`、`.2`…（內容導向，不使用來源陣列索引）。
6. 內容完全相同的重複群組共用同一 `sourceGroupId`（語意上等價，不需用索引區分）。
7. 舊資料沒有原始群組可供計算時，用 `g_unknown_ + fnv1a32(words.map(wordKey).sort().join(U+001F))`，並視為 `sourceStatus: "unavailable"`。

> `fnv1a32` 與現行 `loraFingerprint()`（`app.js:501-509`）採同一演算法，出路數由 32-bit hex，可在純資料層同步計算，不需 `crypto.subtle`。

### 4.3 嚴格 JSON Schema（draft 2020-12）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "sid-ui://schemas/lora/v2/adoption-record.json",
  "title": "SidSimpleUI.AdoptionRecord",
  "type": "object",
  "additionalProperties": false,
  "required": ["adoptionId", "source", "sourceGroupId", "word", "wordKey", "adoptedAt", "via"],
  "properties": {
    "adoptionId": {
      "type": "string",
      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "versionId", "localFingerprint", "sourceFingerprint"],
      "properties": {
        "kind": { "enum": ["author-local", "author-civitai"] },
        "versionId": { "type": ["integer", "null"], "minimum": 1, "maximum": 2147483647 },
        "localFingerprint": { "type": ["string", "null"] },
        "sourceFingerprint": { "type": ["string", "null"] }
      },
      "allOf": [
        { "if": { "properties": { "kind": { "const": "author-civitai" } }, "required": ["kind"] },
          "then": { "properties": { "versionId": { "type": "integer" }, "localFingerprint": { "const": null } } } },
        { "if": { "properties": { "kind": { "const": "author-local" } }, "required": ["kind"] },
          "then": { "properties": { "versionId": { "const": null } } } }
      ]
    },
    "sourceGroupId": { "type": "string", "pattern": "^g_(unknown_)?[0-9a-f]{8}(\\.[1-9][0-9]*)?$" },
    "word": { "type": "string", "minLength": 1, "maxLength": 200 },
    "wordKey": { "type": "string", "minLength": 1, "maxLength": 200 },
    "adoptedAt": { "type": "integer", "minimum": 0 },
    "via": { "enum": ["word", "group", "all-local", "migration"] }
  }
}
```

v2 item 的新增欄位：`adoptionRecords: AdoptionRecord[]`（**必填**，即使為空也要是 `[]`；「缺欄位」與「有效空陣列」不同，見 §6.3）。`personalTriggers` 取代 v1 `triggers`（字串陣列，唯一注入來源）。

### 4.4 來源生命週期判定（`sourceStatus`，衍生）

| 情況 | 判定 | 對紀錄 / 個人詞的動作 |
|---|---|---|
| Civitai `versionId` 與紀錄相同、現有 `groups` 中有同 `sourceGroupId` 的群組且含該 `wordKey`、`fingerprint` 相同 | `available` | 無 |
| 同一版本但 `fingerprint` 不同，或找不到 `sourceGroupId` / `wordKey` | `changed` | 紀錄保留原值；UI 顯示「原建議已更新」，詞仍為個人詞 |
| Civitai 版本已取消（`versionId:null`）或改成別的版本 | `unavailable` | 紀錄保留；詞仍為個人詞；不自動補新版本 |
| 本機 `local.groups` 非空且 fingerprint 與紀錄相同且群組可匹配 | `available` | 無 |
| 本機 metadata 更新（fingerprint 不同或群組內容變動） | `changed` | 同上；不自動覆蓋 |
| 本機來源不存在／群組清空 | `unavailable` | 同上 |

**鐵則**：任何 `sourceStatus` 變化都**不修改** `adoptionRecords` 已保存的欄位，也**不修改** `personalTriggers`。來源失效只是「證據過期」，不是「詞失效」。

### 4.5 操作流程契約

| 操作 | `personalTriggers` | `adoptionRecords` | `authorSuggestions` | `noTriggerNeeded` |
|---|---|---|---|---|
| 新增個人詞（手動輸入） | 依 `wordKey` 去重後加入 | 不改 | 不改 | 設 `false`（沿用現行） |
| 逐詞採用（`via:"word"`） | 依 `wordKey` 去重後加入（已是個人詞則不重複字串） | **新增 1 筆**新 UUID | 不改 | 設 `false`（沿用現行） |
| 整組採用（`via:"group"`） | 每詞依 `wordKey` 去重加入 | **每詞新增 1 筆**（同一操作可有多筆） | 不改 | 設 `false` |
| 全部本機採用（`via:"all-local"`） | 同上 | 每詞 1 筆，記錄各別 `sourceGroupId` | 不改 | 設 `false` |
| **重複採用**同一詞（同來源同群組） | 字串不重複 | **再新增 1 筆**新 UUID（累計 2 筆） | 不改 | 設 `false` |
| 取消單筆採用（`cancelAdoption(id)`） | **完全不改** | 只移除該 UUID 1 筆 | 不改 | 不改 |
| 取消全部／某來源全部採用 | **完全不改** | 只篩掉符合的筆 | 不改 | 不改 |
| 刪除個人詞（既有 chip ×） | 移除該字串 | **不改**（保留歷史證據；該詞衍生 `wordPresent=false`） | 不改 | 不改（沿用現行） |
| 作者 metadata 更新 | 不改 | 不改 | 只更新 groups/fetchedAt/fingerprint（沿用 `loadCivMeta`） | 不改 |
| 取消 Civitai 連結 | 不改 | 不改（紀錄轉 `unavailable`） | civitai 清空（沿用 `cv-unlink`） | 不改 |
| 舊版遷移 | `triggers` → `personalTriggers`（union 衝突時） | 建立 `via:"migration"` 紀錄 | 原樣保留 | 原樣保留 |

> **防誤刪核心**：沒有任何「取消採用／來源失效」操作會删除 `personalTriggers` 字串。要刪詞只能走既有、明確的「刪除個人詞」UI 動作。因此即使某詞同時被多筆紀錄支持，或其實是使用者先建後才採用，取消任一筆都不會誤刪。

### 4.6 Before / After 操作案例（12 例）

以下所有範例均符合 §4.3 Schema；`personalTriggers` 與 `adoptionRecords` 同步呈現。`g_1a2b3c4d` 等 8-hex ID 為符合 Schema pattern 的示範值（分別對應不同群組內容；實作以 §4.2 演算法實際計算）。

#### 案例 1：原本沒有詞，逐詞採用 Civitai group 的 `amora`

**Before**
```json
{ "personalTriggers": [], "adoptionRecords": [],
  "authorSuggestions": { "civitai": { "versionId": 3276795, "groups": [["amora", "blonde hair"]], "fingerprint": "fpA" } } }
```
**After**
```json
{
  "personalTriggers": ["amora"],
  "adoptionRecords": [{
    "adoptionId": "11111111-1111-4111-8111-111111111111",
    "source": { "kind": "author-civitai", "versionId": 3276795, "localFingerprint": null, "sourceFingerprint": "fpA" },
    "sourceGroupId": "g_1a2b3c4d", "word": "amora", "wordKey": "amora",
    "adoptedAt": 1735296000000, "via": "word"
  }]
}
```
結果：個人詞 1 筆、紀錄 1 筆、最終注入 1 次。

#### 案例 2：整組採用（一操作產生多筆紀錄）

**Before**：`personalTriggers: []`, `adoptionRecords: []`, civitai group 0 = `["amora","blonde hair","long hair"]`。
**After**
```json
{
  "personalTriggers": ["amora", "blonde hair", "long hair"],
  "adoptionRecords": [
    { "adoptionId": "22222222-2222-4222-8222-222222222221", "source": { "kind": "author-civitai", "versionId": 3276795, "localFingerprint": null, "sourceFingerprint": "fpA" }, "sourceGroupId": "g_2b3c4d5e", "word": "amora", "wordKey": "amora", "adoptedAt": 1735296001000, "via": "group" },
    { "adoptionId": "22222222-2222-4222-8222-222222222222", "source": { "kind": "author-civitai", "versionId": 3276795, "localFingerprint": null, "sourceFingerprint": "fpA" }, "sourceGroupId": "g_2b3c4d5e", "word": "blonde hair", "wordKey": "blonde hair", "adoptedAt": 1735296001000, "via": "group" },
    { "adoptionId": "22222222-2222-4222-8222-222222222223", "source": { "kind": "author-civitai", "versionId": 3276795, "localFingerprint": null, "sourceFingerprint": "fpA" }, "sourceGroupId": "g_2b3c4d5e", "word": "long hair", "wordKey": "long hair", "adoptedAt": 1735296001000, "via": "group" }
  ]
}
```
結果：同一次操作產生 3 筆可個別取消的紀錄。

#### 案例 3：使用者原本已有個人詞，再採用作者同詞（字串去重、紀錄新增）

**Before**：`personalTriggers:["amora"]`, `adoptionRecords:[]`。
**After（採用 civitai group 的 amora）**：`personalTriggers:["amora"]`（不變），`adoptionRecords` 新增 1 筆（同案例 1，`via:"word"`）。
結果：`supportCount("amora") = 1`；個人詞保留；最終注入 1 次。

#### 案例 4：同一來源兩個不同群組都含 `amora`

**Before**：civitai groups = `[["amora","long hair"],["amora","cleavage"]]`，皆空。
**After（兩組都整組採用）**
```json
{
  "personalTriggers": ["amora", "long hair", "cleavage"],
  "adoptionRecords": [
    { "adoptionId": "33333333-3333-4333-8333-333333333331", "source": { "kind": "author-civitai", "versionId": 3276795, "localFingerprint": null, "sourceFingerprint": "fpA" }, "sourceGroupId": "g_3c4d5e6f", "word": "amora", "wordKey": "amora", "adoptedAt": 1735296002000, "via": "group" },
    { "adoptionId": "33333333-3333-4333-8333-333333333332", "source": { "kind": "author-civitai", "versionId": 3276795, "localFingerprint": null, "sourceFingerprint": "fpA" }, "sourceGroupId": "g_3c4d5e6f", "word": "long hair", "wordKey": "long hair", "adoptedAt": 1735296002000, "via": "group" },
    { "adoptionId": "33333333-3333-4333-8333-333333333333", "source": { "kind": "author-civitai", "versionId": 3276795, "localFingerprint": null, "sourceFingerprint": "fpA" }, "sourceGroupId": "g_4d5e6f70", "word": "amora", "wordKey": "amora", "adoptedAt": 1735296003000, "via": "group" },
    { "adoptionId": "33333333-3333-4333-8333-333333333334", "source": { "kind": "author-civitai", "versionId": 3276795, "localFingerprint": null, "sourceFingerprint": "fpA" }, "sourceGroupId": "g_4d5e6f70", "word": "cleavage", "wordKey": "cleavage", "adoptedAt": 1735296003000, "via": "group" }
  ]
}
```
結果：個人詞 3 筆（amora 去重）、紀錄 4 筆、兩個群組可分別辨識。

#### 案例 5：同一個詞被不同來源支持（local + Civitai）

**Before**：`personalTriggers:[]`。
**After（先採用 local group `amora`，再採用 civitai group `amora`）**
```json
{
  "personalTriggers": ["amora"],
  "adoptionRecords": [
    { "adoptionId": "44444444-4444-4444-8444-444444444441", "source": { "kind": "author-local", "versionId": null, "localFingerprint": "loc1", "sourceFingerprint": "loc1" }, "sourceGroupId": "g_5e6f7081", "word": "amora", "wordKey": "amora", "adoptedAt": 1735296004000, "via": "word" },
    { "adoptionId": "44444444-4444-4444-8444-444444444442", "source": { "kind": "author-civitai", "versionId": 3276795, "localFingerprint": null, "sourceFingerprint": "fpA" }, "sourceGroupId": "g_1a2b3c4d", "word": "amora", "wordKey": "amora", "adoptedAt": 1735296005000, "via": "word" }
  ]
}
```
結果：`supportCount("amora")=2`，個人詞 1 筆，注入 1 次。

#### 案例 6：同一來源、同一群組、同一詞**重複採用**

**Before**：案例 1 的 After。
**After（再次點「逐詞加入 amora」）**：`personalTriggers` 不變；`adoptionRecords` 新增第二筆，例如
```json
{ "adoptionId": "55555555-5555-4555-8555-555555555555",
  "source": { "kind": "author-civitai", "versionId": 3276795, "localFingerprint": null, "sourceFingerprint": "fpA" },
  "sourceGroupId": "g_1a2b3c4d", "word": "amora", "wordKey": "amora",
  "adoptedAt": 1735296006000, "via": "word" }
```
結果：`supportCount=2`；兩筆可分別取消（`adoptionId` 不同）；個人詞仍只有 1 個字串，注入 1 次。這是 A2-R3 的 Map 結構無法表示的第一個核心案例。

#### 案例 7：只取消其中一筆（多筆支持時）

**Before**：案例 6（2 筆）。
**After（取消 `55555555-...-5555`）**：`personalTriggers:["amora"]` 不變；`adoptionRecords` 剩案例 1 的 `11111111-...-1111`。
結果：詞仍保留；`supportCount=1`；注入 1 次。**沒有誤刪個人詞，也沒有誤刪其他來源的紀錄**。

#### 案例 8：取消全部作者來源

**Before**：案例 5（local + civitai 兩筆）。
**After**：`personalTriggers:["amora"]`（不變）、`adoptionRecords:[]`。
結果：作者建議區塊顯示「未採用」，可重新採用；個人詞不受影響。

#### 案例 9：明確刪除個人詞（與取消採用不同）

**Before**：案例 1 的 After。
**After（使用者點 chip × 刪 `amora`）**：`personalTriggers:[]`；`adoptionRecords` **仍保留**該筆（讀取時衍生 `wordPresent:false`）。
結果：作者建議仍顯示「曾採用」；重新加入同詞會再次符合既有紀錄的 `wordKey`（不產生新紀錄，除非使用者再次點採用）。

#### 案例 10：作者 metadata 更新（群組內容與 fingerprint 改變）

**Before**：案例 1 的 After（fingerprint `fpA`，group `g_1a2b3c4d`）。
**更新後**：`authorSuggestions.civitai.fingerprint = "fpB"`、`groups = [["amora","red eyes"]]`；`personalTriggers` 與 `adoptionRecords` **完全不變**。
衍生：`sourceStatus = "changed"`（找不到 `g_1a2b3c4d`、fingerprint 不同）。
結果：詞仍注入；UI 提示「原建議已更新」；使用者可重新採用新群組（會產生新 `adoptionId`、新 `sourceGroupId`，舊紀錄保留）。

#### 案例 11：Civitai 版本取消／失效

**Before**：案例 1 的 After。
**After（`cv-unlink`）**：`authorSuggestions.civitai = {versionId:null, groups:[], fetchedAt:null, fingerprint:null}`；`personalTriggers` 與 `adoptionRecords` 不變；衍生 `sourceStatus = "unavailable"`。
結果：詞仍注入，原紀錄保留供日後追溯；重新貼新版本也不覆蓋舊紀錄。

#### 案例 12：舊版 `adoptedSources` 遷移

**Before（A2-R3 提議的舊形狀）**
```json
{
  "v": 2,
  "personalTriggers": ["amora", "blonde hair"],
  "authorSuggestions": { "civitai": { "versionId": 3276795, "groups": [["amora","blonde hair","long hair"]], "fingerprint": "fpA" } },
  "adoptedSources": { "civitai:3276795": { "groupIndex": 0, "words": ["amora","blonde hair"], "adoptedAt": 1735296000000 } }
}
```
**After（讀取時轉換，不寫回舊格式）**
```json
{
  "personalTriggers": ["amora", "blonde hair"],
  "adoptionRecords": [
    { "adoptionId": "66666666-6666-4666-8666-666666666661", "source": { "kind": "author-civitai", "versionId": 3276795, "localFingerprint": null, "sourceFingerprint": "fpA" }, "sourceGroupId": "g_6f708192", "word": "amora", "wordKey": "amora", "adoptedAt": 1735296000000, "via": "migration" },
    { "adoptionId": "66666666-6666-4666-8666-666666666662", "source": { "kind": "author-civitai", "versionId": 3276795, "localFingerprint": null, "sourceFingerprint": "fpA" }, "sourceGroupId": "g_6f708192", "word": "blonde hair", "wordKey": "blonde hair", "adoptedAt": 1735296000000, "via": "migration" }
  ]
}
```
`adoptedSources` 在記憶體中被丟棄，但**只在讀取時**；原始 localStorage 字串保留到下次存檔才被 v2 格式取代。

**遷移限制（必須記錄，不可假裝可完全還原）**：舊 Map 以 `"civitai:<id>"` / `"local:<fingerprint>"` 為鍵、以 `groupIndex` 記憶群組。若 `authorSuggestions.groups[groupIndex]` 仍存在，可算出 `sourceGroupId`；若不存在（來源已清空／更新），只能用 `g_unknown_*`，並標 `sourceStatus:"unavailable"`。舊 Map 每個來源只有一筆，`groupIndex` 即使是 `[0,1]`（A2-R3 案例 4）也只攜帶群組索引、**沒有每群組 adoptedAt**，因此「誰先採用」的順序無法還原，統一使用 Map 上的 `adoptedAt`；**重複採用次數在舊資料中完全不可還原**，遷移只會為每個不同 `wordKey` 建立 1 筆 `via:"migration"` 紀錄。

### 4.7 資料不一致的恢復與保護規則

| 不一致情況 | 處理 |
|---|---|
| `adoptionRecords` 有紀錄但 `personalTriggers` 沒有對應 `wordKey` | 保留紀錄，衍生 `wordPresent:false`；不自動加回字串（可能是使用者刻意刪除） |
| `personalTriggers` 有詞但沒有任何紀錄 | 正常（純個人詞）；不被任何「取消採用」影響 |
| 同 `adoptionId` 出現兩筆（手動改過 localStorage） | 保留第一筆，第二筆移入 `migration.quarantine`，UI 提示；不刪個人詞 |
| 紀錄欄位型別錯誤（如 `versionId:"abc"`） | 該筆隔離、不參與 `supportCount`；其餘筆照常；原始值保留於記憶體 quarantine |
| `adoptionRecords` 整欄型別錯誤（非陣列） | 視為**欄位損壞**（不同於有效空陣列），見 §6.3；個人詞一律不受影響 |
| `sourceGroupId` 指向已不存在的群組 | `sourceStatus:"changed"` 或 `"unavailable"`；不改紀錄、不改詞 |
| 來源更新後同詞可被新群組再採用 | 新增紀錄；舊紀錄保留；不自動合併、不自動覆蓋 `adoptedAt` |

---

## 5. 補正二：正式歷史 Prompt Snapshot

### 5.1 三種還原能力必須分開命名

| 層級 | 欄位 | 能做的事 | 不能做的事 |
|---|---|---|---|
| **L1 Prompt 文字重現** | `promptSnapshot.text.pos` / `.neg` | 顯示／複製／貼回**生成當時實際送進模型的字串** | 不保證能還原結構或圖片 |
| **L2 Prompt 結構重現** | `promptSnapshot.structure.entries` / `.effective` + `provenance` 指紋 | 知道每個詞的種類、來源、順序、權重、翻譯片段；可選擇性套用 | 不以重新 `Dict.tr()` 覆蓋 L1 字串；字典已變時必須警告 |
| **L3 完整生成條件重现** | 上述 + `promptSnapshot.conditions`（含 `loras`, `ckpt`, `w/h/n/steps/cfg/seed`） | 連同 LoRA／參數重現生成條件 | 仍需 ComfyUI Workflow 與模型版本一致才能保證同圖 |

**三者不得混稱「歷史還原」**。UI 動作的文案必須明示是哪一層；本報告只定義資料契約，不設計 A3 UX。

### 5.2 `promptSnapshot` 正式欄位表（持久化版本 `v: 1`）

位置：`ui.gallery[]` 項目的新增欄位 `promptSnapshot`（**additive；舊欄位全部保留**）。

| 欄位 | 型別 | 必填 | 語意 |
|---|---|---|---|
| `v` | integer，恆為 `1` | 是 | Snapshot 契約版號。未来变更时递增，舊版照本表解讀。 |
| `capturedAt` | integer ≥ 0 | 是 | 擷取時間（epoch ms）。 |
| `text.pos` | string | 是 | **生成時實際送進 ComfyUI 的 Positive Prompt 字串**，不可變。唯一 L1 權威。 |
| `text.neg` | string | 是 | 同上，Negative。 |
| `structure.qualityTags` | boolean | 是 | 當次是否啟用 QUALITY 前綴。 |
| `structure.entries` | SnapshotEntry[] | 是 | Composer 輸入階段的條目（去重前），依 `order` 排序。 |
| `structure.effective` | `{entryId:string, token:string}[]` | 是 | 實際進入 `text.pos` 的條目與其貢獻字串（去重後），依輸出順序。`token` 含權重外框，如 `(long hair:1.2)`。 |
| `conditions.ckpt` | string | 是 | 當次 checkpoint。 |
| `conditions.w/h/n/steps/cfg` | integer | 是 | 生成參數。 |
| `conditions.seed` | integer | 是 | 當次實際使用 seed（非 `-1`）。 |
| `conditions.loras` | SnapshotLora[] | 是 | 當次使用的 LoRA（只含 `enabled===true` 者，沿用現行快照語意）。 |
| `provenance.dictFingerprint` | string \| null | 是 | 擷取時 Dict 的指紋，例如 `fnv1a32(sorted "中文=英文" 對)`。用于detect字典是否已更新。 |
| `provenance.tagDbFingerprint` | string \| null | 是 | 擷取時 CATS 正名集合指紋。 |
| `provenance.composerVersion` | string | 是 | 固定 `"1"`；Composer 規則變更時遞增。 |

**SnapshotEntry 欄位**（`structure.entries[]`）：

| 欄位 | 型別 | 必填 | 預設（可省略） | 語意 |
|---|---|---|---|---|
| `entryId` | string | 是 | — | Snapshot 內唯一 id（`"e1"`…），**不跨 Snapshot 保留**，不是 PromptEntry.id。 |
| `kind` | `"tag"` \| `"lora-trigger"` \| `"freetext"` \| `"quality"` \| `"default"` | 是 | — | 與 §6.1 PromptEntry 同一枚舉。 |
| `owner` | `"user"` \| `"system"` | 是 | — | 與 §6.1 同一枚舉（無 `lora`）。 |
| `origin` | `"tag-db"` \| `"author-local"` \| `"author-civitai"` \| `"wd14"` \| `"freetext"` \| `"manual"` \| `"default"` | 是 | — | 與 §6.1 同一枚舉（無 `personal`）。 |
| `text` | string | 是 | — | 送進 Composer 的文字；空字串表示會被過濾（例如只有未翻譯中文）。 |
| `weight` | number \| null | 是 | — | 與 §6.1 同規則。 |
| `order` | integer ≥ 0 | 是 | — | 去重前順序。 |
| `lora` | string \| null | 否 | `null` | LoRA 相對路徑；僅 `kind==="lora-trigger"` 可有值。 |
| `disabled` | boolean | 否 | `false` | 被 Composer 跳過者為 `true`。 |
| `raw` | string \| null | 否 | `null` | 原始中文；僅 `kind==="freetext"` 可有值。 |
| `translated` | string[] | 否 | `[]` | 翻譯成功的英文結果（攤平）。 |
| `untranslated` | string[] | 否 | `[]` | 翻不出的中文片段（攤平），不進 Prompt。 |
| `fragments` | `{raw:string, translated:string[], untranslated:string[]}[]` | 否 | `[]` | 逐片段對應；**freetext 必填且非空的片段至少要有一筆**。 |
| `adoptionId` | string \| null | 否 | `null` | 若此詞源自已採用作者詞，指向 §4 的 `adoptionId`；其餘為 `null`。 |

不變量：`translated = dedup(flatten(fragments[].translated))`、`untranslated = dedup(flatten(fragments[].untranslated))`。來源為 `author-civitai`/`author-local` 的 `lora-trigger` 必須有非 null `adoptionId`（除非是遷移前舊資料，並以 `null` 明確表示無法追溯）。

**SnapshotLora 欄位**：`name, display, strength, personalTriggers:string[], autoTrigger:boolean, noTriggerNeeded:boolean, enabledAtCapture:true, adoptionIds:string[]`。**不存 `authorSuggestions`**（避免舊歷史讓作者建議回退，沿用 A2-R3 PD4 推薦）。

### 5.3 翻譯結果如何凍結（核心要求）

擷取時呼叫一個**純函式** `translateWithFragments(raw)`：

1. `raw` 依 `/[，、；;\n]+/` 切片段（與 `Dict.tr` 相同分隔符）。
2. 每個片段 `seg`：`text = Dict.tr(seg)`（**在生成當下執行一次**）、`untranslated = Dict.leftover(seg)`。
3. 每片段產生一個 `freetext` SnapshotEntry：`raw=seg`, `text=text`, `translated = text ? text.split(", ") : []`, `untranslated`, `fragments=[{raw:seg, translated:[...], untranslated:[...]}]`。
4. Composer 把每個 `text` 視為一個不可分割的 block 參與去重與 `, ` 接合（與現行 `snapshotNow()` 把 `Dict.tr(#pos)` 整段 push 進 `parts` 的行為一致）。
5. `text.pos` 直接取 Composer 的輸出；**Snapshot 不重新呼叫 `Dict.tr()`，也不從 `structure` 重算 `text.pos`**。

> 此設計直接滿足任務的特別要求：歷史保留生成當時**實際輸出**的 Positive / Negative 字串，未來字典怎麼改都不會影響。若片段切法與整段 `Dict.tr()` 在極端輸入下有差異（例如跨片段去重），以 `text.pos` 為唯一真相；`structure` 是「當時如何組成」的忠實審計快照，不是重算來源。

### 5.4 完整 JSON 範例

以下示範：dict 指紋 `d1` 時，`長髮，一個女孩，櫻花樹下` → `long hair, 1girl, cherry blossoms`，選取標籤 `1girl`（w=1）與 `long hair`（w=1.2），LoRA `Amora` 個人詞 `amora`（採用自 civitai `g_1a2b3c4d`）。翻譯片段 `long hair`、`1girl` 因標籤先出現而被去重；`櫻花樹下` 的未翻譯片段 `樹下` 被保留在 fragments 但不進 Prompt。

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
      ]
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
      }]
    },
    "provenance": {
      "dictFingerprint": "d1",
      "tagDbFingerprint": "c1",
      "composerVersion": "1"
    }
  }
}
```

**範例自我檢查（不變量，必須由測試固化）**：

- `entries` 含 9 筆（去重前），`effective` 含 7 筆（去重後）；`e6`/`e7` 因 `long hair`／`1girl` 已先出現被捨棄。
- `text.pos === effective.map(x => x.token).join(", ")`，且等於外層 legacy `prompt`（三個字串位元組相同）。
- `e5` 是 tag 且 `weight:1.2`，故 `effective` 的 token 為 `(long hair:1.2)`；其餘 tag 的 `weight:1.0` 輸出純文字。
- freetext 的 `translated`／`untranslated` 等於其 `fragments` 攤平去重結果；`樹下` 只存在於 `fragments`／`untranslated`，不在 `text.pos`。
- 若任何這些不變量被破壞，以 `text.pos` 為 L1 權威，標記 `integrity:"effective-mismatch"`（§5.7），不得偷偷改寫歷史字串。

### 5.5 歷史還原案例（6 例）

| # | 情境 | 可用層級 | 行為 |
|---|---|---|---|
| H1 | 同字典、完整 Snapshot | L1+L2+L3 | 顯示／複製用 `text.pos`；「結構套用」用 `structure.entries`；「完整還原」再套 `conditions` 並明確替換 LoRA |
| H2 | 字典已更新（`provenance.dictFingerprint !== 目前指紋`） | L1 完整；L2 可用但警告 | **顯示／複製仍是原 `text.pos`**；結構套用時提示「字典已變，重新套用會重新翻譯」，不得自動把新翻譯覆蓋到 `text.pos` |
| H3 | 舊歷史只有 `prompt`/`sel`/`extra`/`neg`，沒有 `promptSnapshot` | 僅 L1（legacy） | 以 `prompt` 顯示原始正向字串；`neg`/`sel`/`extra` 僅供人工參考；**不可宣稱可完整重現**；不對 `extra` 重新 `Dict.tr()` 後冒充原輸出 |
| H4 | `structure.entries` 損壞／型別錯誤，但 `text` 有效 | L1（L2 停用） | 文字重現正常；結構套用按鈕不可用；保留原欄位不修寫 |
| H5 | `conditions` 缺損，其他正常 | L1+L2 | 文字與結構可用；完整還原不可用；LoRA 維持現況（不覆寫） |
| H6 | `text.pos` 缺損但 `structure.effective` 完好 | 降級 | 可用 `effective[].token` 接合重建「候選字串」，但標記 `restoredFrom:"effective"` 且**不得覆蓋原 `text.pos` 欄位**（寫回時才更新）；若兩者皆缺，顯示「（無紀錄）」 |

### 5.6 字典更新前後差異案例（必須保留原始輸出）

**擷取時（dict `d1`）**

| 片段 | `Dict.tr()`（d1） | `Dict.leftover()` |
|---|---|---|
| `長髮` | `long hair` | `[]` |
| `一個女孩` | `1girl` | `[]` |
| `櫻花樹下` | `cherry blossoms` | `["樹下"]` |

→ `text.pos` = `masterpiece, best quality, amazing quality, 1girl, (long hair:1.2), cherry blossoms, amora`（與 §5.4 範例相同；權重外框照 §6.4 輸出）

**假想未來字典 `d2`**：新增 `"櫻花樹下":"sakura tree"`（目前 `dict.js` **沒有**這個 key，此為假想更新案例）。則今日重新執行 `Dict.tr("櫻花樹下")` 會得到 `sakura tree`。

**歷史表現**：
- 舊 Snapshot 的 `text.pos` 仍是 `..., cherry blossoms, amora`，燈箱／預覽／複製都用這個字串。
- `provenance.dictFingerprint: "d1"` 與目前 `"d2"` 不同 → UI 警告「這張圖的翻譯來自舊字典」。
- 使用者點「結構套用」時，`structure.entries[].fragments` 保存的是 d1 的翻譯結果；實作必須以 fragments 為準，而不是重新呼叫 `Dict.tr()`。
- 即使使用者之後改 `#pos` 並重新生成，那是**新的一次生成**，會寫新的 Snapshot（`d2`）；舊 Snapshot 不被改寫。

### 5.7 舊歷史相容與降級策略

| 欄位狀態 | 處理 |
|---|---|
| 完全沒有 `promptSnapshot` | Legacy fallback：只用既有 `sel`/`extra`/`neg`/`prompt`/`loras`/`at`；標記 `restoreLevel:"legacy-text-only"` |
| `promptSnapshot.v !== 1`（未來版或無法辨識） | 不猜測結構；若 `text.pos` 為字串則僅 L1；其餘降級；保留原值 |
| `text.pos` 非字串 | 改用 legacy `prompt`（若為字串）；兩者皆無 → 無文字可重現 |
| `text.neg` 非字串 | 改用 legacy `neg` |
| `structure.entries` 非陣列 | L2 停用；L1 不受影響 |
| `structure.effective` 與 `text.pos` 不一致 | **以 `text.pos` 為 L1 權威**；標記 `integrity:"effective-mismatch"`；不自動改字串 |
| `conditions.loras` 非陣列／含壞筆 | 只Overview跳過壞筆；完整還原時不覆寫目前 LoRA；保留原值 |
| 任何 Snapshot 欄位損壞 | **不刪除歷史項目**、不覆寫舊欄位、不因此讓 ComfyUI `/api/check` 被跳過 |
| 何時寫入 Snapshot | 只有**新的生成**寫入；讀取舊歷史時只做讀取轉換，不回寫 |

### 5.8 與 `ui.gallery` 既有欄位的關係

- 既有欄位 `url, filename, seed, w, h, sel, extra, neg, prompt, loras, at` **全部保留、格式不變**。
- 新增 `promptSnapshot` 與 `prompt` 同時由**同一次 `PromptComposer.compose()` 結果**寫入；`legacy prompt === promptSnapshot.text.pos`（位元組相同）。
- `legacy extra` = `#pos` 原始輸入（`ui.extra`）；Snapshot 的翻譯結果保存在 `structure.entries[].fragments`，不覆蓋 `extra`。
- `legacy loras` 以 v2 形狀（`personalTriggers`）寫入，欄位與 `conditions.loras` 對齊；`enabled` 仍沿用現行「快照只含啟用者，還原時一律 `true`」語意（Snapshot 內以 `enabledAtCapture:true` 明示）。
- 不提供「舊歷史自動升級成 Snapshot」：那需要重新跑 `Dict.tr()`，會偽造生成當時的翻譯結果，明確禁止。

---

## 6. 補正三：全模型一致性與遷移契約

### 6.1 PromptEntry 權威欄位表（記憶體層衍生，不持久化）

| 欄位 | 型別 | 必填 | 預設 | 用途 / 語意 |
|---|---|---|---|---|
| `id` | string | 是 | — | 條目唯一 id，UI 操作對應用。**每次從持久化層衍生時重新產生**，不跨 compose 保留，不進歷史（歷史用 Snapshot 自己的 `entryId`）。 |
| `kind` | `"tag"` \| `"lora-trigger"` \| `"freetext"` \| `"quality"` \| `"default"` | 是 | — | 條目類型。 |
| `owner` | `"user"` \| `"system"` | 是 | — | **管理權**：`user` = 使用者可編輯（標籤、補充描述、個人觸發詞，含已採用作者詞）；`system` = 系統自動且不可編輯（QUALITY、預設負面）。**不表示 LoRA 歸屬**。 |
| `origin` | `"tag-db"` \| `"author-local"` \| `"author-civitai"` \| `"wd14"` \| `"freetext"` \| `"manual"` \| `"default"` | 是 | — | **最初來源**。`manual` = 使用者在 `#loraTrigInput` 手動輸入的個人詞（取代 R3 錯誤的 `personal`）。**不得**用 `personal`。 |
| `text` | string | 是 | — | 正規化後送入 Composer 的文字（底線轉空格）。**不得為 null**；空字串合法但會被 Composer 過濾。 |
| `weight` | number \| null | 是 | — | `number` 僅用於 `kind==="tag"`（來自 `sel.w`；`1.0` 輸出純文字，其餘 `(text:weight)`，格式化一位小數）。其餘 kind 必為 `null`。 |
| `order` | integer ≥ 0 | 是 | — | 顯示與組裝順序，由持久化索引推導（tag 用 `sel` 索引，freetext 續排，lora-trigger 最後）。 |
| `lora` | string \| null | 否 | `null` | LoRA 相對路徑。**僅** `kind==="lora-trigger"` 可有值；其他必為 `null`。 |
| `disabled` | boolean | 否 | `false` | `true` 時 Composer 跳過；`autoTrigger===false` 的觸發詞所對應條目設 `true`，但 `personalTriggers` 不刪。 |
| `raw` | string \| null | 否 | `null` | 原始中文；僅 `kind==="freetext"` 可有值。 |
| `translated` | string[] | 否 | `[]` | 翻譯成功結果（攤平）；僅 freetext。 |
| `untranslated` | string[] | 否 | `[]` | 無法翻譯片段（攤平），不進 Prompt；僅 freetext。 |
| `fragments` | `{raw:string, translated:string[], untranslated:string[]}[]` | 否 | `[]` | 逐片段對應；**freetext 必備**；由 `translateWithFragments()` 產生，會被 Snapshot 凍結。 |
| `adoptionId` | string \| null | 否 | `null` | 若此 lora-trigger 是採用作者詞而來，指向 §4 的 `adoptionId`；手動詞為 `null`。 |

**已移除的欄位（不得再出現在任何新範例）**：`provenance`、`adoptedFrom`、`locked`、`origin:"personal"`、`owner:"lora"`、`weight:1.0` 用於 lora-trigger。
- `provenance` / `adoptedFrom` 的功能由 `adoptionId` → `adoptionRecords[]` 單一路徑取代（避免 R3 中兩者重疊又語意不同）。
- `locked` 由 `owner:"system"` + UI 只讀取代。

### 6.2 LoRA Trigger Words 四類資料的精確定界

| 資料 | 持久化位置 | 是否注入 Prompt | 可編輯 | 進 Snapshot | 與其他類的關係 |
|---|---|---|---|---|---|
| 個人詞 `personalTriggers` | `ui.loras.items[].personalTriggers`（字串陣列） | **唯一注入來源**（`autoTrigger===true` 時） | 是 | 是（`conditions.loras[].personalTriggers`） | 已採用作者詞被複製進來後即為個人詞，`owner:"user"` |
| 作者建議 `authorSuggestions` | `ui.loras.items[].authorSuggestions`（唯讀） | 否 | 否（只能採用） | 否（只可存指紋／`adoptionIds`） | 更新時不碰個人詞 |
| 採用紀錄 `adoptionRecords` | `ui.loras.items[].adoptionRecords`（v2 新增） | 否（僅來源證據） |  Indirect（取消／重複採用） | 是（`adoptionIds`） | 不擁有個人詞；取消紀錄不刪字串 |
| 實際注入詞 | `PromptComposer.compose()` 的 `text.pos` 中的 lora-trigger 片段 | 是 | 間接 | 是（`text.pos` + `effective`） | 由前三類衍生，不另行持久化 |

`origin` 與作者來源追溯**不得混為一談**：`origin` 是 PromptEntry 的單一語意枚舉；完整來源（版本／本機／群組／事件）只在 `adoptionRecords` 中，兩者靠 `adoptionId` 連結。

### 6.3 LoRA v1 → v2 遷移契約（8 情境，明辨「缺欄位」與「有效空陣列」）

頂層 `v` 仍沿用 `loraParseState()` / `loraSerialize()` 的寫入點；v2 盼頂層 `v:2`、項目使用 `personalTriggers` + `adoptionRecords`（必填）。讀取時**不寫回**；下次任何 LoRA 操作（`loraSave()`）才以 v2 寫回。

| # | 情境 | 處理規則 |
|---|---|---|
| M1 | v2 新欄位**缺失**（`adoptionRecords` 不存在） | 在記憶體補 `[]`，但標記 `migration.reason:"field-missing-v2"`（與有效空不同）；不視為「使用者刻意清空」；下次存檔補上 `[]` |
| M2 | v2 欄位存在且為**有效空陣列** `[]` | 原樣保留；`migration.reason:null`；**不得**因為空就插入任何舊紀錄或合成個人詞 |
| M3 | v2 欄位型別錯誤（非陣列／含壞筆） | 整欄視為損壞：有效筆保留、壞筆進 `migration.quarantine`；原始值留在記憶體供恢復；`personalTriggers` 一律不受影響；不靜默寫回 |
| M4 | v1 `triggers` 與 v2 `personalTriggers` **都存在且內容相同**（正規化後） | 優先用 v2；標記 `migration.reason:"dual-identical"`；不在 Prompt 重複注入；下次存檔只寫 v2 |
| M5 | 兩者都存在但**內容衝突** | **聯集**（v2 順序優先，再把 v1 独有詞 appended，依 `wordKey` 去重）以確保不遺失個人詞；標記 `migration.reason:"dual-conflict"` 並保留 `migration.backup.v1Triggers`；不自動丟棄任一方 |
| M6 | v1 有資料、v2 是**有效空陣列** `[]` | v2 勝出（視為使用者已清空）；但保留 `migration.backup.v1Triggers` 於記憶體並提示「舊個人詞仍在备份中」；**不自動合回** |
| M7 | v1 無資料（或無 `triggers` 欄位）、v2 有資料 | v2 勝出，無衝突標記；若 v1 完全缺欄位則比照 M1 補 `adoptionRecords:[]` |
| M8 | 部分遷移／損壞資料（單筆 name 無效、欄位型別錯、JSON 毀損） | 比照現行 `loraParseItems()` 白名單式重建：壞筆只跳過該筆，其餘保留；壞筆原始物件進 `migration.quarantine`；**不得清空整組 LoRA**；`JSON.parse` 失敗時整包以空清單降級，但保留原字串供人工救援 |

補充規則：
- 若頂層 `v` 缺失或等于 `1` 且有 `triggers` → 視為 v1；若 `v===2` → 走 v2 路徑；`v` 非數字時依是否有 `personalTriggers` 猜測並標 `migration.reason:"invalid-version"`。
- 舊 `ui.gallery[].loras[].triggers`（v1 歷史 LoRA）在 L3 完整還原時套用 M1–M8 同一套轉換；**還原不自動寫回舊歷史項目**。
- 禁止把「有效空陣列」與「欄位缺失」合併處理（M1 vs M2），這是 A2-R3 §8.3 的明確缺口。
- 禁止任何遷移路徑靜默丟失個人詞（M5／M6 強制聯集或保留備份）。

### 6.4 Composer 契約

| 項目 | 契約 |
|---|---|
| 責任 | **唯一** Prompt 文字組裝者。輸出 `{pos, neg, posHash}`。不負責 ComfyUI LoraLoader 節點（`loraApplyToWorkflow()` 獨立，`app.js:671-696`）；不負責中文翻譯（`Dict.tr()`）；不負責分類查詢 |
| 輸入 | `PromptModel {v:2, qualityTags, positive:PromptEntry[], negativeRaw:string}`，由 `sel`/`ui.extra`/`ui.loras`/`#neg` 衍生 |
| 衍生順序 | ① tag（`sel` 原順序）→ ② freetext（每片段一筆，`translateWithFragments`）→ ③ lora-trigger（所有 `enabled===true` 的 LoRA；`autoTrigger===false` 者設 `disabled:true` 但仍進 entries）→ ④ quality（Q 前綴拆成 3 筆） |
| 正負向 | `positive` 組 `pos`；`negativeRaw` 由 Composer 以分隔符解析、正規化、去重整 `neg`；兩邊獨立去重。**負向原始字串仍是持久化權威** |
| 去重 | Composer 輸出階段才做；鍵 = `normalizeText(text) = String(text||"").normalize("NFKC").toLowerCase().trim().replace(/[_\s]+/g," ")`；保留第一次出現（含其 weight 與來源）；quality 前綴本身也參與去重 |
| 順序 | 去重後依 `order` 升序；`effective` 記錄實際順序 |
| 權重格式 | `weight===null` 或 `1.0` → 純 `text`；其餘 → `(text:weight.toFixed(1))`。LoRA trigger / freetext / quality / default 必為 `null` |
| 注入時機 | lora-trigger 條目在**衍生模型時**产生，`disabled` 在 Composer 过濾；`personalTriggers` 本身不被 Composer 修改 |
| 唯一組裝呼叫 | 每次生成**只呼叫一次** `compose()`；同一結果同時用於 `/prompt` payload、`ui.gallery[].prompt`、`promptSnapshot.text`。禁止 `snapshotNow()` 自己再拼一次 |
| Snapshot 取得 | 由該次 `compose()` 回傳值 + 衍生時的 entries/effective 直接組出 Snapshot；不重跑 `Dict.tr()` |
| `posHash` | `pos` 的穩定 hash（實作可沿用 `hashStr()` 或 SHA-256 hex）；僅診斷用，非契約字段 |

### 6.5 全文一致性矩陣

| 檢查項目 | 狀態 | 依據 / 說明 |
|---|---|---|
| PromptEntry 欄位表 ↔ 所有 JSON 範例 | 通過 | §6.1 表為唯一權威；§5.4 SnapshotEntry 沿用同枚舉；未出現表外欄位（已移除 `provenance`/`adoptedFrom`/`locked`） |
| `origin` 枚舉一致且無 `personal` | 通過 | §6.1 定義 `manual`；§5.2 / §5.4 / §6.6 範例皆用 `manual`/`author-*` |
| `owner` 枚舉一致且無 `lora` | 通過 | §6.1 僅 `user`/`system`；LoRA 歸屬一律用 `lora` 欄位 |
| `weight` 預設與格式一致 | 通過 | §6.1 僅 tag 有數值；§6.4 格式規則；§5.4 範例 quality/freetext/lora-trigger 皆 `null` |
| `fragments` 正式定義且保存責任明確 | 通過 | §6.1 + §5.2 + §5.3；freetext 必備，Snapshot 凍結 |
| `lora` 僅 lora-trigger 有值 | 通過 | §6.1；§5.4 僅 `e9`（lora-trigger）有 `lora` |
| `disabled` 不影響持久化 | 通過 | §6.1 衍生欄位；§6.4 Composer 跳過但 `personalTriggers` 不刪 |
| AdoptionRecord Schema ↔ 案例 | 通過 | §4.3 必填欄位全部出現在 §4.6 12 案例中；`via` 仅用定義值 |
| `adoptionRecords` 是新陣列而非 Map | 通過 | §4.1/§4.2；未再出現 `adoptedSources` 於任何新範例 |
| 多來源／多群組／多次採用可表示 | 通過 | §4.6 案例 4/5/6 |
| 單筆取消不誤刪 | 通過 | §4.5 + 案例 7；取消只動紀錄 |
| 個人詞不受來源失效影響 | 通過 | §4.4 + 案例 10/11 |
| `text.pos` ↔ `effective` 一致性 | 通過（明確驗證規則） | §5.4 修正段：`text.pos === effective.map(token).join(", ")`；不一致時以 `text.pos` 為 L1 權威（§5.7） |
| 不依賴未來 `Dict.tr()` 重現 | 通過 | §5.3 凍結翻譯；§5.6 字典更新案例 |
| 舊歷史相容策略 | 通過 | §5.7 + §5.8；不自動升級 |
| v1→v2 八情境 | 通過 | §6.3 M1–M8；M1/M2 明確區分 |
| 不靜默丟失個人詞 | 通過 | §6.3 M5/M6/M8 聯集或備份 |
| Composer 不承擔 Workflow LoRA Loader | 通過 | §6.4；`loraApplyToWorkflow()` 獨立 |
| 持久化來源仍是既有 key | 通過 | §6.6 保留方向 1–8；本報告不新增持久化 key，只在既有 key 內新增欄位 |
| 所有 JSON 範例欄位皆在正式表中 | 通過 | 本報告全部範例逐項人工比對 §6.1／§4.3／§5.2 欄位表，無表外欄位或表外枚舉值 |

### 6.6 保留的既有架構方向（受 §六 約束，未擴大變更）

1. PromptModel 為衍生模型，不建立第二份持久化權威 —— 維持。
2. 持久化來源仍為 `state.sel`、`ui.extra`、`ui.loras`、`#neg`／`ui.settings` —— 維持；`promptSnapshot` 是 `ui.gallery` 項目內的新欄位，不是新 key。
3. PromptComposer 唯一文字組裝責任 —— 維持並強化「每次生成只呼叫一次」。
4. Tag DB 原始資料、使用者選取狀態、Prompt 實際 Tag、手動輸入文字分離 —— 維持（Snapshot 的 `fragments` 是凍結輸出，不是第二份 Tag DB）。
5. `personalTriggers` 是個人觸發詞唯一注入來源 —— 維持。
6. `authorSuggestions` 唯讀 —— 維持；取消連結清空建議但沿用現行不碰個人詞行為。
7. Negative Prompt 暫存原始字串，Compose 時解析 —— 維持；Snapshot 同時保存原始字串與組裝結果。
8. 舊資料漸進相容、不一次性覆寫 localStorage —— 維持；所有遷移只在讀取時進行。

若未來實作發現以上方向有重大問題，應另開報告記錄證據，不在本輪擴大變更。

---

## 7. 與 A2-R3 的差異及修正原因

| # | A2-R3 | A2-R4（本報告） | 修正原因 |
|---|---|---|---|
| 1 | `adoptedSources` Map：`"civitai:3276795" → {groupIndex, words[], adoptedAt}` | `adoptionRecords[]` + UUID `adoptionId`／`sourceGroupId`（內容 hash）／逐詞一筆 | 原設計無法表達多群組（案例 4）、多次採用（案例 6）、單筆取消（案例 7）；`groupIndex` 隨來源變動失效 |
| 2 | `groupIndex: [0,1]` 變形沒有完整操作契約 | `sourceGroupId` 內容識別 + 碰撞規則；索引完全退出契約 | 位置索引不是長期識別 |
| 3 | `provenance` + `adoptedFrom` 雙軌 | 合併為 `adoptionId` → `adoptionRecords[]` | 兩者語意重疊；R3 自己定義又互相矛盾 |
| 4 | 欄位表禁止 `origin:"personal"`，但 §9.4 / §11.3 範例使用 | 枚舉新增 `manual`，全部範例改為 `manual` | 消除範例與枚舉矛盾；保留「手動輸入觸發詞」語意 |
| 5 | `owner:"lora"` 表示觸發詞 | 移除 `lora`，只留 `user`/`system` | `lora` 欄位已表達歸屬；owner 應只表管理權（R1 說採用後 owner 變 user，R3 又用 lora，矛盾） |
| 6 | `fragments` 只在 freetext 範例出現，欄位表沒有 | 正式加入 PromptEntry / SnapshotEntry 欄位表，並定義 `translateWithFragments()` | 消除「範例有、表沒有」；同時修正 `櫻花樹下` 的 `untranslated` 應為 `["樹下"]` |
| 7 | §5.3 明說 `promptSnapshot`「不進 ui.gallery」，§7 又定義歷史快照欄位 | 定為 `ui.gallery[].promptSnapshot`，版本 `v:1`，正式持久化 | 直接矛盾；且任務要求正式持久化契約 |
| 8 | 主張「Dict.tr 是確定性函數，歷史重現結果一致」 | 字典更新會改變結果；Snapshot 凍結 `text.pos` + fragments + `dictFingerprint` | 字典是會更新的靜態資料；確定性只在同一版本成立 |
| 9 | 遷移表把 v1/v2 同時存在簡化為「優先 personalTriggers」 | M1–M8 八情境，區分缺失／有效空／衝突／部分損壞 | 任務明確要求；避免清空使用者個人詞 |
| 10 | `composePrompt()` 與 `snapshotNow()` 兩套組裝 | 強制每次生成只呼叫一次 Composer，同一結果供三處 | 保證 Snapshot 字串等於實際送出字串 |
| 11 | 舊报告 modified 13 / untracked 48；CodeGraph 寫「不可用」 | modified 15 / untracked 60；CodeGraph 可執行但索引過期 | 以本次實測為準 |
| 12 | `loraSnapshot()` 不存 authorSuggestions（PD4 推薦不保留） | 維持不存；Snapshot 只存 `adoptionIds` 與指紋 | 避免舊歷史讓作者建議回退 |

---

## 8. 尚未解決的問題與需要產品負責人決策的項目

### 8.1 尚未解決（本輪不猜測）

1. **真實 localStorage 內容未檢視**：本輪只讀程式碼定義的結構；使用者瀏覽器中是否有異常／手動改過的 `ui.loras`／`ui.gallery` 未知。
2. **CodeGraph 索引過期**：pending Added 5 / Modified 6；依禁令未 sync。符號搜尋可能漏掉新函式，本報告行號全部以直接讀檔為準。
3. **Schema 未經自動驗證**：本報告提供 JSON Schema 與一致性規則，但未建立驗證器；「所有範例符合 Schema」是人工審查結論，需實作階段以測試固化。
4. **`sourceGroupId` 的 FNV-1a 32-bit 碰撞**雖已定內容導向後綴規則，但未做大規模真實群組統計；碰撞機率極低但非零。
5. **`translateWithFragments()` 與既有 `Dict.tr()` 的等價性**只在常見分隔符情境確認；跨片段去重等極端輸入的差異以 `text.pos` 為權威，結構僅供審計。
6. **舊 `adoptedSources` 的重複採用次數不可還原**（§4.6 案例 12）；這是舊格式固有的資訊遺失，不是本輪設計缺陷。

### 8.2 需產品負責人決策

| # | 決策項目 | 本報告預設（未替產品定案） |
|---|---|---|
| PD1 | 歷史「同提示詞」預設是 L1 僅文字、L2 結構套用，還是 L3 完整還原？ | 建議 L1，並明確標示層級 |
| PD2 | 是否提供「一鍵取消所有作者來源」（只刪紀錄、不刪詞）？ | 建議提供，但**绝不連帶刪個人詞** |
| PD3 | v1/v2 內容衝突時要聯集還是嚴格選 v2？ | 本契約暫定聯集＋警告，以防個人詞遺失；產品可改 |
| PD4 | Snapshot 是否保存完整 `authorSuggestions` 供參考？ | 建議不存（沿用 A2-R3 PD4），只存 `adoptionIds`／指紋 |
| PD5 | 加入任何詞時是否仍自動清除 `noTriggerNeeded`？（現行行為） | 維持現行，待確認 |
| PD6 | LoRA Trigger Word 是否需要逐詞權重？ | 不需要（沿用 R2/R3 PD7），用 LoRA 層級 `strength` |
| PD7 | `manual` 這個 origin 名稱是否符合產品 terminology？ | 建議用 `manual`；若產品偏好 `user-typed` 需全文同步替換 |
| PD8 | 字典更新時是否要提供「用新字典重新生成一次」的快捷入口？ | 屬 A3 UX，本輪不設計 |

---

## 9. 本次未執行的工作及原因

| 未執行 | 原因 |
|---|---|
| 修改任何既有程式碼／測試／設計報告／AGENTS.md／README／設定 | 任務明確禁止（唯讀設計） |
| 修改 localStorage、模型、Tag DB、Dict、LoRA 檔案 | 任務明確禁止 |
| 啟動／停止／重啟 ComfyUI、simple_ui(7860)、WD14 Worker | 任務明確禁止；兩服務原本就在監聽，未觸碰 |
| 執行生圖／GPU 測試／API 請求（`/prompt`、`/interrupt`、`/queue`） | 任務明確禁止；僅做 TCP 連通性檢查 |
| `codegraph sync` | 任務明確禁止；索引過期已於報告註明 |
| Git Stage / Commit / Push / Reset / Restore / Stash / Checkout / Clean | 任務明確禁止 |
| 以瀏覽器讀取實際 localStorage 內容 | 非必要；任務只要求確認「實際使用的資料結構」，已由程式碼直接確認；且唯讀任務不碰使用者資料 |
| 執行 `node --check` / `py_compile` / 既有測試 | 本輪未改任何程式碼，無修改可驗證；唯讀設計報告不需語法檢查 |
| 把舊報告「13/48」數字改正到舊檔案 | 禁止修改既有報告；只在本報告記錄差異 |

---

## 10. 最終 Git 狀態

- 本報告是**唯一新增檔案**：`devtools/reports/prompt-tag-system-a2-r4-final-model-correction.md`（untracked）。
- 開始時既有的 **15 個 modified tracked 檔案**與 **60 個 untracked 項目**，本輪**完全未動**（.check 將於寫入後重新執行，結果見 §10.1）。
- 未 stage / commit / push / reset / restore / stash / checkout / clean；未建立分支或 worktree。

### 10.1 寫入後 Git 狀態（實際驗證）

寫入後實際執行 `git status --porcelain` 查核：`modified=15`、`untracked=61`、`total=76`（開始時為 15／60／75），唯一新增的 untracked 項目正是本報告 `?? devtools/reports/prompt-tag-system-a2-r4-final-model-correction.md`。`git status -sb` 仍為 `## main...origin/main [ahead 1]`。

Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、Ahead 1 / Behind 0 不變；既有 15 個 modified tracked 檔案的內容未受影響。

---

## 11. 正式服務是否受到影響

**沒有**。

- 未停止、重啟或設定任何正式服務；`127.0.0.1:7860` 與 `127.0.0.1:8188` 在開始時皆已監聽，本輪未送出任何 HTTP／WebSocket 請求，未執行生圖或取消。
- 未讀取 API Key、未呼叫 Civitai API、未寫入任何使用者資料。
- 唯一的外部動作是 TCP 連通性檢查（github.com:443 與本機兩個 port）。
- 本報告是純 Markdown 檔案，不影響執行期行為。

---

## 12. 給 ChatGPT 獨立審查的重點

請優先攻擊以下幾點，而不是重複 A2-R3 已審過的項目：

1. **§4 的 `adoptionId` 模型**：是否真的能表示「同來源、同群組、同詞被多次採用」且單筆取消不影響其他筆？案例 4/5/6/7 是否有漏洞？
2. **`sourceGroupId` 內容 hash**：用 FNV-1a 32-bit + 內容排序 + 碰撞後綴，是否足以替代 `groupIndex`？來源更新後舊紀錄只標 `changed`，是否會讓 UI 無法判断「是否已重新採用」？
3. **「取消採用永不刪個人詞」**：是否與產品預期「一鍵移除所有作者來源詞」衝突？若產品要連帶刪詞，要如何避免誤刪使用者自建同名字詞？（本契約選擇不刪，請審查是否過度保守）
4. **§5 的 L1/L2/L3 分層**：`text.pos` 作为唯一 L1 權威、structure 只供審計，是否足以杜絕「未來 Dict.tr 偷改歷史」？`effective` 與 `text.pos` 不一致時的降級是否安全？
5. **`translateWithFragments()` 與現行 `Dict.tr()` 的差異**：以「片段」與「整段」两种切法在多種分隔符／跨片段去重情境下是否等價？不等價時以 `text.pos` 為權威是否会造成 structure 與輸出無法對應？
6. **§6.3 M1–M8**：M5（聯集）與 M6（v2 有效空勝出但備份）是否自相矛盾？「不靜默丟失個人詞」與「尊重使用者清空意圖」如何取舍？
7. **枚舉變更（移除 `owner:"lora"`、新增 `origin:"manual"`）**：是否會與 A2-R1～R3 已對外承諾的欄位名稱衝突？是否需要相容別名？
8. **一致性矩陣的自證性**：本報告在 §5.4 列出四項可測試不變量（字串相等、權重外框、fragments 攤平、損壞降級）；請確認所有範例真的符合 §6.1 欄位表與 §6.4 去重規則。

---

**結論**：A2-R4 完成三項最終補正：（1）作者詞採用改為逐事件、可個別識別與取消的 `adoptionRecords`，並以內容 hash 取代 `groupIndex`；（2）歷史 `promptSnapshot` 成为 `ui.gallery` 內的版本化正式欄位，凍結生成當時的正負向字串、翻譯片段、結構與生成條件；（3）PromptEntry／LoRA／Composer／Snapshot 欄位、枚舉、範例與八種遷移情境達成一致。本輪**只新增本報告**，未修改任何既有檔案，未執行 Git 寫入，未影響正式服務，**不開始任何實作**。
