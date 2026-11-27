# Sid-simple-ui 遷移備份寫入安全性與 LoRA 權重契約修正（A2-R4-R1-R1）

- **日期**：2026-11-27（本機 01:38 +08:00 開始）
- **專案**：`C:\ComfyUI\simple_ui`（`Sid-1996/sid-comfyui-simple-ui`）
- **性質**：**唯讀設計定點補正**。未修改任何既有程式碼、測試、報告、AGENTS.md、README、設定、模型、Tag DB、Dict、LoRA 或使用者資料；未執行 Git 寫入；未啟動／停止／重啟正式服務；未生圖；未執行 `codegraph sync`。
- **交付**：只新增本報告一份：`devtools/reports/prompt-tag-system-a2-r4-r1-r1-final-contract-fixes.md`。
- **相依報告（已讀取）**：`devtools/reports/prompt-tag-system-a2-r4-final-model-correction.md`（前輪已完整讀取，本輪引用其 §6.2／§7／§8）、`devtools/reports/prompt-tag-system-a2-r4-r1-final-contract-fixes.md`（本輪完整重讀 589 行，直接補正對象）。
- **規範（已讀取）**：`C:\ComfyUI\AGENTS.md`（303 行）、`C:\ComfyUI\simple_ui\AGENTS.md`（184 行）。

---

## 1. 任務目標與範圍

依 ChatGPT 獨立審查，只修正兩項：

1. **R4-3 寫入安全性**：R4-R1 §6 定義了備份資料結構，但未完整定義「先備份再覆寫」的交易順序、寫入失敗時的 UI 錯誤狀態，且 §6.2 宣稱「唯一新增 key」卻在 §6.3 規則 10 使用第二個 key。本輪補足寫入協定、錯誤狀態與正式 key 清單。
2. **R4-4 權重契約**：R4-R1 把 `strengthModel`／`strengthClip` 描述為「Workflow 可讀但正常管線未保存」的隱藏差異，並列為 L3 重現限制。直接讀碼後必須更正：這兩欄**只存在於 `loraApplyToWorkflow()` 的 fallback 判斷**，正常生成路徑的資料層完全不會產生它們，Model 與 CLIP 使用**同一個 `strength`**。

保留 A2-R1／R2／R3／R4／R4-R1 已通過方向：混合架構、衍生 PromptModel、唯一 Composer、`personalTriggers`／`authorSuggestions` 分離、`adoptionRecords` UUID + `sourceGroupId`、Negative L1 原字串與 L2 描述、Quality→Tag→Freetext→LoRA 順序、版本化 `promptSnapshot`、舊資料漸進相容。本輪不設計 A3 UX、不寫程式。

---

## 2. 開始前檢查紀錄

### 2.1 設備

| 項目 | 結果 |
|---|---|
| Hostname | `DESKTOP-ADPHHAP`（Online） |
| 時間 | 2026-11-27 01:38:28 +08:00 |
| 使用者 | `desktop-adphhap\user` |
| 本機服務 | `127.0.0.1:7860`、`127.0.0.1:8188` 皆 `connect_ex=0`（僅 TCP 檢查，未發 HTTP 請求） |

### 2.2 CodeGraph

`codegraph status` 執行成功：Files 35／Nodes 1,094／Edges 4,837，DB 7.02 MB，backend `node:sqlite`（full WAL、journal wal），Pending Changes：Added 5／Modified 6。索引過期，依禁令**未 sync**；行號與結論以直接 Read 磁碟原始碼為準。

### 2.3 Git（開始時，重新查詢）

| 項目 | 結果 |
|---|---|
| Repository | `C:/ComfyUI/simple_ui` |
| Branch | `main` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 同址） |
| Ahead / Behind | `1` / `0`（`cf5609e feat: add Civitai LoRA explorer`） |
| `git status --porcelain` | `modified=15`、`staged=0`、`untracked=62`、`total=77` |
| Modified tracked（15） | `AGENTS.md`, `app.css`, `app.js`, `devtools/lora_api_test.py`, `devtools/lora_core_test.mjs`, `devtools/lora_explorer_api_test.py`, `devtools/lora_explorer_core_test.mjs`, `devtools/lora_mock_civitai.py`, `devtools/lora_ui_test.mjs`, `devtools/test_ui_control_wd14.ps1`, `index.html`, `server.py`, `ui_control.ps1`, `ui_panel.ps1`, `ui_panel.pyw` |
| `git diff --check` | **exit 0**（無空白錯誤）；兩個既存 CRLF 警告：`devtools/lora_api_test.py`、`devtools/lora_core_test.mjs`。未做任何轉換。 |
| 既有使用者修改 | 存在，本輪完全未動 |

---

## 3. 實際程式碼核對結果

| 主題 | 位置 | 本輪重新確認的事實 |
|---|---|---|
| `saveJSON()` | `app.js:24-26` | `try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){}` → **吞掉所有錯誤且無回傳值**。呼叫成功 ≠ 資料已保存。 |
| `loadJSON()` | `app.js:20-23` | `getItem` 或 `JSON.parse` 例外時回傳 `d`，**原始字串未保留**。 |
| `loraParseItems()` | `app.js:555-576` | 只保留 `name, display, strength, triggers, autoTrigger, enabled, authorSuggestions, noTriggerNeeded`；`strength: loraWeight(it.strength)`（567）。**沒有 `strengthModel`／`strengthClip`**。 |
| `loraSerialize()` | `app.js:582-596` | 白名單輸出同樣 8 欄；`strength: loraWeight(it.strength)`（588）。任何 `migration.*` 或自訂欄位都不會被保存。 |
| `loraParseState()` | `app.js:578-580` | 回傳 `{v: LORA_VERSION, items: ...}`，`LORA_VERSION=1`（393）。 |
| 開頁載入 | `app.js:716` | `S.loras = loraParseState(loadJSON("ui.loras", null)).items;` → 解析失敗直接變空清單。 |
| `loraSnapshot()` | `app.js:641-650` | 只輸出 `name, display, strength, triggers, autoTrigger, noTriggerNeeded`；**`strength` 是唯一權重欄位**，沒有 Model/CLIP 分流。 |
| `loraApplyToWorkflow()` | `app.js:671-696` | `const w = loraWeight(l.strength)`（680）；`strength_model: loraWeight(l.strengthModel == null ? w : l.strengthModel)`（685）、`strength_clip: loraWeight(l.strengthClip == null ? w : l.strengthClip)`（686）。 |
| `wf()` | `app.js:698-712` | KSampler 固定 `sampler_name:"dpmpp_2m"`、`scheduler:"karras"`、`denoise:1`（707）；`loras: o.loras` 經 `loraApplyToWorkflow` 串接。 |
| `snapshotNow()` | `app.js:322-350` | 取 `loraSnapshot(S.loras)` 作為 `snap.loras`（328），同一份再給 `/prompt` 與歷史；組裝順序 QUALITY→Tag→Freetext→LoRA（330-334）。 |
| `loraSave()` | `app.js:1827-1829` | `saveJSON("ui.loras", loraSerialize(S.loras))`，無錯誤回傳、無 backup key 寫入。 |
| `strengthModel` / `strengthClip` 全檔搜尋 | `app.js` | **只出現在 685、686 兩行**。沒有 UI、沒有解析、沒有序列化、沒有 snapshot 寫入。 |

### 3.1 由以上事實得出的兩項結論

1. **遷移備份目前完全不存在**：`ui.loras.migrationBackup` 與 `.corrupt` 都不存在；`saveJSON()` 吞錯，沒有任何機制可證明「已持久化」。
2. **正常 LoRA 權重只有一個 `strength`**：`loraParseItems` → `loraSnapshot` → `loraApplyToWorkflow` 的資料鏈只攜帶 `strength`；`strengthModel`／`strengthClip` 是 `loraApplyToWorkflow()` 對*外部呼叫者*提供的選用覆寫參數，正常生成路徑永遠走 `== null ? w` 的 fallback，因此 `strength_model === strength_clip === loraWeight(strength)`。R4-R1 把它們當成「未保存的隱藏差異」是**不正確**的，本輪更正。

---

## 4. 補正一（R4-3）：備份寫入順序、錯誤狀態與 key 一致性

### 4.1 正式新增 key 清單（完整、唯一清單）

| # | Key | 用途 | 資料結構 | 生命週期 |
|---|---|---|---|---|
| 1 | `ui.loras.migrationBackup` | 保存待確認／已確認的遷移備份 | `{v:1, backups: BackupRecord[]}`（見 §4.2） | 建立 → pending → confirmed → 保留期 → 明確清理；corrupt 狀態下不再改寫 |
| 2 | `ui.loras.migrationBackup.corrupt` | 當 `ui.loras.migrationBackup` 本身 JSON 損壞時，保全其原始字串 | **純字串**（原始 backup JSON 文字），不是物件 | 僅在 backup key 解析失敗且此 key 不存在時寫一次；人工處理前不覆蓋、不清除 |

> 沒有第三個新增 key。`ui.loras` 與其他既有 key 格式不變。

**為什麼必須有第 2 個 key（證明不會覆蓋原始資料）**：若 backup key 本身無法解析，就沒有任何位置可以安全存放它的原始字串；把它塞回 `ui.loras` 會被 `loraSerialize()` 白名單丟棄，且會更動權威設定；覆蓋 backup key 又會毀掉唯一證據。因此使用一個獨立、只寫一次的字串 key。寫入前先用 `getItem` 確認它不存在；若已存在，不改寫、直接回 `BACKUP_CORRUPT_UNHANDLED`。

### 4.2 `BackupRecord` 欄位（沿用 R4-R1 §6.2，補 `targetVersion`／`expectedItemCount`）

```json
{
  "v": 1,
  "backups": [
    {
      "backupId": "77777777-7777-4777-8777-777777777777",
      "createdAt": 1735296000000,
      "reason": "v1-data-v2-empty",
      "sourceKey": "ui.loras",
      "itemName": "chars\\Amora.safetensors",
      "payload": {
        "kind": "item",
        "value": { "triggers": ["amora", "old_trigger"], "personalTriggers": [] }
      },
      "targetVersion": 2,
      "expectedItemCount": 1,
      "status": "pending",
      "confirmedAt": null,
      "note": "v2 為有效空陣列；v1 舊詞已保全，不自動合回"
    }
  ]
}
```

新增欄位：`targetVersion`（integer，遷移目標版號；目前 2）、`expectedItemCount`（integer ≥ 0，遷移後預期筆數）。兩者供重新載入時判斷「遷移是否完成」，不影響 R4-R1 既有欄位。

### 4.3 寫入原語與錯誤狀態（不得把「函式已呼叫」當成「已保存」）

所有對上面兩個 key 與 `ui.loras` 的寫入，都必須走同一個 `safeSetJSON`，回傳：

```json
{
  "ok": false,
  "code": "QUOTA_EXCEEDED",
  "key": "ui.loras.migrationBackup",
  "verified": false,
  "message": "備份寫入失敗：儲存空間不足；原始資料未更動，不得繼續遷移。"
}
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `ok` | boolean | 僅當 `setItem` 未拋錯**且**讀回比對相同才為 `true` |
| `code` | enum | 見下表 |
| `key` | string | 目標 key |
| `verified` | boolean | 是否完成讀回比對；遷移關鍵寫入要求 `verified:true` |
| `message` | string | 白話中文，供 UI 直接顯示 |

**錯誤碼（UI 狀態）**

| code | 觸發條件 | 允許下一步 | 禁止下一步 |
|---|---|---|---|
| `OK` | setItem 成功且讀回一致 | 進行下一階段 | — |
| `SERIALIZE_FAILED` | `JSON.stringify` 拋錯（循環引用等） | 修正資料後重試 | 寫入任何 key |
| `SETITEM_FAILED` | `setItem` 拋一般例外 | 顯示錯誤、保留原資料 | 覆寫 `ui.loras` |
| `QUOTA_EXCEEDED` | `QuotaExceededError`（name/code 22 或 1014） | 釋出空間或放棄遷移 | 覆寫 `ui.loras`、宣稱成功 |
| `SECURITY_ERROR` | `SecurityError`（隱私模式／被封鎖） | 提示「此環境無法保證保存」 | 標為 `confirmed`、清理備份 |
| `STORE_UNAVAILABLE` | `localStorage` 不存在或 `getItem` 失敗 | 降級為唯讀、提示 | 任何寫入與遷移 |
| `READ_FAILED` | 讀取既有 key 失敗，無法證明原始值 | 中止交易 | 任何覆寫 |
| `BACKUP_CORRUPT` | backup key `JSON.parse` 失敗且 `.corrupt` 已成功寫入 | 等待人工處理 | 遷移、確認、清理 |
| `BACKUP_CORRUPT_UNHANDLED` | backup key 損壞且 `.corrupt` 也無法寫入 | 停止並醒目提示 | 所有寫入 |
| `BACKUP_WRITE_FAILED` | 備份寫入任何失敗 | 中止遷移 | 覆寫 `ui.loras` |
| `BACKUP_CONFIRM_FAILED` | 寫入 `status:"confirmed"` 失敗 | 保持 pending 重試 | 清理備份 |
| `LORA_SAVE_FAILED` | 一般存檔寫入 `ui.loras` 失敗 | 保留 pending 備份、重試 | 清除 backup key |
| `MIGRATION_INCOMPLETE` | 重新載入後發現 pending 但 `ui.loras` 未達 `targetVersion` | 重新執行遷移寫入 | 標為完成、清理 |
| `UNVERIFIED` | 讀回比對失敗（無痕等看似成功但並不持久） | 視為失敗處理 | 標為成功 |

> 無痕／受限環境：`setItem` 可能不拋錯但頁面關閉後消失。`ok:true` 必須包含讀回比對；無法比對一律 `UNVERIFIED`，不得宣稱安全保存。

### 4.4 寫入順序（六個流程）

| 流程 | 順序（嚴格） | 失敗時 |
|---|---|---|
| **遷移備份建立** | ① `getItem("ui.loras")` 取得原始字串（失敗 → `READ_FAILED` 中止）→ ② `getItem` backup key；不存在→新 `{v:1,backups:[]}`，有效→準備 append，損壞→走「備份損壞保全」並中止 → ③ append `BackupRecord(status:"pending")` → ④ `safeSetJSON(backup)` 且 `verified:true` → ⑤ 才允許進入遷移 | 任一失敗 →  Migration 中止，`ui.loras` 完全未動，UI 顯示對應 code |
| **遷移結果寫入** | ① 確認 backup 已 `verified` → ② 記憶體計算遷移結果 → ③ `safeSetJSON("ui.loras", ...)` 且 `verified:true` → ④ 檢查結果 `v === targetVersion`（不符 → `MIGRATION_INCOMPLETE`） | ③ 失敗 → 保留 pending backup，**不得**標完成；重新載入後以 `MIGRATION_INCOMPLETE` 辨識 |
| **一般 LoRA 存檔** | ① 若有 pending backup 需要更新 → 先寫 backup（`verified`）→ ② 再寫 `ui.loras`（`verified`）→ ③ 兩者皆成功才回成功 | backup 失敗 → 不寫 `ui.loras`；`ui.loras` 失敗 → backup 仍是 pending，绝不清除 |
| **使用者確認** | ① 比對 backup record → ② 改 `status:"confirmed"`、`confirmedAt=Date.now()` → ③ `safeSetJSON(backup)` 且 `verified` | 失敗 → 維持 pending；UI `BACKUP_CONFIRM_FAILED` |
| **備份清理** | ① 僅限 `status:"confirmed"` 且 `confirmedAt` 超過保留期（建議 30 天，PD）→ ② 明確使用者清理動作 → ③ 寫回移除該筆的 backup（verified） | 失敗 → 不清除任何東西；`pending` 永不清理 |
| **備份損壞保全** | ① backup key 解析失敗 → ② `getItem(".corrupt")`；不存在才 `safeSet` 原始字串 → ③ 不覆蓋 backup key、不碰 `ui.loras` → ④ UI `BACKUP_CORRUPT` | `.corrupt` 也失敗 → `BACKUP_CORRUPT_UNHANDLED`，停止所有寫入 |

**核心不變量**：任何可能覆蓋 `ui.loras` 的動作之前，pending backup 必須已經 `ok:true && verified:true` 存在於 localStorage。這條規則同時適用於 migration 與一般 `loraSave()`。

### 4.5 失敗案例（9 例，逐例標明 key 與可恢復性）

| # | 情境 | 已寫入的 key | 原始資料可恢復？ | 允許下一步 | 禁止下一步 |
|---|---|---|---|---|---|
| C1 | 備份寫入成功 + 設定寫入成功 | `ui.loras.migrationBackup`（pending, verified）、`ui.loras` | **是** | 等待使用者確認 | 自動清理備份 |
| C2 | 備份寫入失敗 | 無（backup key 未被覆寫） | **是**（`ui.loras` 原樣） | 修正後重試備份 | 遷移、覆寫 `ui.loras`、宣稱成功 |
| C3 | 備份成功 + 設定寫入失敗 | 只有 backup key（pending, verified）；`ui.loras` 維持舊值 | **是** | 重試 `ui.loras` 寫入 | 清除 backup key、標完成 |
| C4 | backup key 原本已有 pending 項目 | backup key（append 後 verified） | **是** | 以 `backupId` 區分兩筆，分別確認 | 覆蓋整個 backup 物件、遺失既有 pending |
| C5 | backup key JSON 損壞 | `ui.loras.migrationBackup.corrupt`（原始字串） | **是**（backup 原文仍在 `.corrupt`，`ui.loras` 未動） | 人工救援 | 遷移、確認、清理、覆蓋 backup key |
| C6 | backup key 寫入遇 quota exceeded | 無新寫入；舊 backup 與 `ui.loras` 原樣 | **是** | 釋出空間後重試；UI `QUOTA_EXCEEDED` | 覆寫 `ui.loras`、宣稱備份成功 |
| C7 | 使用者重新載入後恢復 pending | 無新寫入（讀取既有 backup key） | **是** | 顯示 pending，若 `MIGRATION_INCOMPLETE` 則重試遷移 | 視為已確認、清理 |
| C8 | 一般存檔不會清除 pending | `ui.loras.migrationBackup`（原 pending 保留）+ `ui.loras` | **是** | 正常使用 | 讓 `loraSerialize()` 碰 backup key、清除 pending |
| C9 | 使用者確認後清理 | backup key（`status:"confirmed"` → 保留期後移除該筆） | 是，**但此時為有意丟棄** | 僅在 confirmed + 保留期 + 明確清理後執行 | 對 pending 筆清理、未確認就清除 |

補充：若 `getItem("ui.loras")` 本身失敗（C10，`READ_FAILED`），不得進行任何遷移；原始值雖可能仍在瀏覽器中，但程式**無法證明**，因此視為「尚未安全保存」。

---

## 5. 補正二（R4-4）：LoRA 權重契約修正

### 5.1 現況（直接讀碼）

| 資料層 | 函式 | 實際內容 |
|---|---|---|
| 解析 | `loraParseItems()` `app.js:567` | 只讀 `it.strength`，經 `loraWeight()` 正規化；**不讀** `strengthModel`／`strengthClip` |
| 序列化 | `loraSerialize()` `app.js:588` | 只寫 `strength`；自訂欄位不會保存 |
| 快照 | `loraSnapshot()` `app.js:645` | 只輸出 `strength` |
| Workflow | `loraApplyToWorkflow()` `app.js:680-687` | `w = loraWeight(l.strength)`；`strength_model = l.strengthModel == null ? w : ...`；`strength_clip = l.strengthClip == null ? w : ...` |
| 全檔搜尋 | `app.js` | `strengthModel`/`strengthClip` 僅出現在 685、686 兩行 |

**正常生成路徑結論**：`S.loras` 的每筆只有 `strength` → `loraSnapshot()` 複製 `strength` → `wf()` 把 snapshot 交給 `loraApplyToWorkflow()` → 因 `strengthModel`/`strengthClip` 皆為 `null/undefined`，兩條 LoraLoader 都得到同一個 `loraWeight(strength)`。因此 **Model 與 CLIP 權重使用同一個值**，這是目前產品行為，不是缺漏。

### 5.2 三類權重欄位（明確區分，不虛構）

| 類別 | 欄位 | 是否存在於正常資料管線 | 說明 |
|---|---|---|---|
| **正常保存及使用** | `strength` | **是** | 唯一權重；`loraParseItems`／`loraSerialize`／`loraSnapshot` 都處理；`loraWeight()` 正規化（ clamp ±100、小數 2 位）。L3 已由 `conditions.loras[].strength` 保存。 |
| **函式支援但正常管線不傳入** | `strengthModel`、`strengthClip` | **否** | 僅 `loraApplyToWorkflow()` 的選用覆寫参数；沒有 UI、沒有解析、沒有序列化、沒有 snapshot。正常生成時永遠走 fallback 到 `strength`。**不構成重現缺口**，也**不是目前存在的資料欄位**。 |
| **未來若要支援獨立 Model/CLIP 權重** | 需新增 | 尚未存在 | 必須同時修改：① `loraParseItems()` 白名單；② `loraSerialize()` 白名單；③ `loraSet()` patch allowlist；④ `loraSnapshot()` 輸出；⑤ `conditions.loras[]` Snapshot 契約；⑥ `workflow.weightMode` 由 `"shared-strength"` 改為 `"split-strength"`；⑦ 測試與 UI。**本輪不做**。 |

### 5.3 同步修正 R4-R1 各節

| R4-R1 位置 | 原敘述 | 修正後 |
|---|---|---|
| §7.1 LoRA Loader 列 | `strengthModel`/`strengthClip`「可被 Workflow 讀但Snapshot 不存→可讀未保存」 | 改為：`strength_model`/`strength_clip` 正常路徑皆由 `strength` fallback 得到；`strengthModel`/`strengthClip` 不是正常管線欄位，不列為未保存差異 |
| §7.2 Workflow 固定條件 | 包含 `strengthModel`/`strengthClip` fallback 規則，暗示重現風險 | 改為：fallback 規則由 `workflow.weightMode:"shared-strength"` 明確記錄；不屬外部依賴 |
| §7.2 外部依賴 | （原未明確排除） | 明確排除 `strengthModel`/`strengthClip`：它們不是外部條件，而是不存在的欄位 |
| §7.3 `workflow.unsavedParams` | 含 `strengthModel`/`strengthClip` | 移除；改為含 `weightMode:"shared-strength"` 於已保存欄位 |
| §8 JSON 範例 | `unsavedParams` 列出 `strengthModel`/`strengthClip` | 移除；加入 `weightMode:"shared-strength"`；`conditions.loras[].strength` 維持唯一權重欄位 |
| §9 一致性矩陣 | 以 `strengthModel`／`strengthClip` 為.hidden 風險 | 改為「權重路徑符合實際程式：單一 `strength` 同時用於 Model 與 CLIP」 |
| §10 未解決問題 #5 | 說 `loraSnapshot()` 不存但 Workflow 會讀，屬隱藏差異 | 改為「目前無此問題；若未來支援獨立權重需修改 §5.2 列出的 7 處」 |

### 5.4 `conditions.workflow` 修正後欄位（僅列出變動）

| 欄位 | 型別 | 修正後語意 |
|---|---|---|
| `weightMode` | string，枚舉 `"shared-strength"` \| `"split-strength"` | 目前固定 `"shared-strength"`：Model 與 CLIP 同值，來自 `conditions.loras[].strength`。`"split-strength"` 保留給未來支援獨立權重，本輪不啟用。 |
| `unsavedParams` | string[] | 只列真正外部依賴，例如 `checkpoint-file-content`、`lora-file-content`、`comfyui-version`；**不得**再列 `strengthModel`／`strengthClip` |

---

## 6. JSON 範例（本輪更新版）

### 6.1 兩個新增 key 的完整範例

```json
{
  "ui.loras.migrationBackup": {
    "v": 1,
    "backups": [
      {
        "backupId": "77777777-7777-4777-8777-777777777777",
        "createdAt": 1735296000000,
        "reason": "v1-data-v2-empty",
        "sourceKey": "ui.loras",
        "itemName": "chars\\Amora.safetensors",
        "payload": {
          "kind": "item",
          "value": { "triggers": ["amora", "old_trigger"], "personalTriggers": [] }
        },
        "targetVersion": 2,
        "expectedItemCount": 1,
        "status": "pending",
        "confirmedAt": null,
        "note": "v2 為有效空陣列；v1 舊詞已保全，不自動合回"
      }
    ]
  },
  "ui.loras.migrationBackup.corrupt": "{\"v\":1,\"backups\":[BROKEN"
}
```

### 6.2 更新後的完整 `promptSnapshot`（結構與 R4-R1 §8 相同；權重與 workflow 已修正）

```json
{
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
      "effectiveNegative": [{ "entryId": "n1", "token": "worst quality" }],
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
        "weightMode": "shared-strength",
        "modelLink": "checkpoint-model-then-loras-chain",
        "clipLink": "shared-lora-clip-chain",
        "vaeSource": "checkpoint:2",
        "outputNode": "7",
        "capturedParams": ["ckpt", "pos", "neg", "w", "h", "n", "seed", "steps", "cfg", "sampler_name", "scheduler", "denoise", "weightMode", "loras", "workflow.version"],
        "unsavedParams": ["checkpoint-file-content", "lora-file-content", "comfyui-version"]
      }
    },
    "provenance": {
      "dictFingerprint": "d1",
      "tagDbFingerprint": "c1",
      "composerVersion": "1"
    }
  }
```

**範例檢查**：`loras[0]` 只有 `strength:0.8`（沒有 `strengthModel`／`strengthClip`）→ 正常路徑 `strength_model = strength_clip = loraWeight(0.8) = 0.8`；`workflow.weightMode:"shared-strength"` 與之一致；`unsavedParams` 只含外部依賴。

### 6.3 PersistResult 錯誤範例

```json
{
  "ok": false,
  "code": "QUOTA_EXCEEDED",
  "key": "ui.loras.migrationBackup",
  "verified": false,
  "message": "備份寫入失敗：儲存空間不足；原始 ui.loras 未更動，不得繼續遷移。"
}
```

---

## 7. 一致性矩陣

| 檢查項目 | 狀態 | 依據 |
|---|---|---|
| 備份先於可能覆蓋原始資料的操作持久化 | 完成 | §4.4 交易順序；核心不變量要求 `ok && verified` 才寫 `ui.loras` |
| 備份失敗時遷移中止 | 完成 | §4.4「遷移備份建立」步驟 ⑤；C2／C6 |
| 一般存檔不破壞 pending 備份 | 完成 | §4.4「一般存檔」；C8；備份不在 `ui.loras.items[]`，白名單碰不到 |
| 備份與設定寫入失敗均有明確處理 | 完成 | §4.3 錯誤碼表 + §4.5 C2／C3／C6／C7 |
| 新增 key 定義完全一致 | 完成 | §4.1 完整列出 2 個 key；§6.1 範例只用這 2 個 |
| 所有失敗案例可追溯且不誤稱安全保存 | 完成 | §4.5 每例標明「哪個 key 已寫入／是否可恢復／允許與禁止」 |
| `strengthModel`／`strengthClip` 描述符合正常路徑 | 完成 | §3 全檔搜尋僅 685/686；§5.1／§5.2 明確單一 `strength` fallback |
| `workflow.unsavedParams` 不再列不存在的欄位 | 完成 | §5.3、§5.4、§6.2 |
| 所有 JSON 範例與欄位表一致 | 完成 | §6 三個 json block 已於寫入後驗證解析 |
| 未推翻既有 A2 方向 | 完成 | §1 明列保留；本輪只補契約 |
| 未擴大 A3／實作 | 完成 | 無 UI 設計、無程式修改 |

---

## 8. 與 R4-R1 的差異

| # | R4-R1 | 本報告 | 原因 |
|---|---|---|---|
| 1 | 只說「先備份再寫入」但未定義交易順序 | §4.4 六個流程的嚴格順序與核心不變量 | ChatGPT 審查：寫入順序不完整 |
| 2 | `saveJSON()` 吞錯被視為已知但未轉成契約 | §4.3 `safeSetJSON` + 15 個錯誤碼 + `verified` 讀回比對 | 不得把「函式已呼叫」當成已保存 |
| 3 | 宣稱「唯一新增 key」但用了 `.corrupt` | §4.1 正式列出 2 個新增 key 並證明必要性 | key 清單不一致 |
| 4 | 未定義 UI 錯誤狀態 | §4.3 錯誤碼表可供 UI 直接顯示 | 任務要求 |
| 5 | 未定義遷移結果寫入失敗的重載辨識 | `targetVersion`／`expectedItemCount` + `MIGRATION_INCOMPLETE` | 任務要求 |
| 6 | `strengthModel`／`strengthClip` 被當成「可讀未保存」的隱藏差異 | §5 更正：正常路徑只有 `strength`，兩欄不存在於資料管線 | 直接讀碼證據 |
| 7 | `workflow.unsavedParams` 含 `strengthModel`／`strengthClip` | 移除，改加 `weightMode:"shared-strength"` | 避免虛構欄位 |
| 8 | §10 把權重列為未解決問題 | §5.2／§10 改為「目前無問題；未來支援才需改 7 處」 | 同上 |

---

## 9. 尚未解決風險

1. **真實 localStorage 未檢視**：不知道使用者現有 backup key 是否已被手動改過或已含 pending。
2. **CodeGraph 索引過期**（Added 5／Modified 6），依禁令未 sync；行號以直接讀檔為準。
3. **這些都是設計契約，尚未實作**：`safeSetJSON`、`ui.loras.migrationBackup`、`.corrupt`、錯誤狀態都不存在於目前 `app.js`；需實作階段以測試固化。
4. **保留天數未定**（建議 30 天，PD）。
5. **`verified` 讀回比對**在部分瀏覽器仍可能無法證明跨工作階段持久化（例如磁碟快取）；無痕環境一律 `UNVERIFIED`，不能宣稱安全。
6. **外部重現限制仍在**：模型檔案內容、ComfyUI／節點版本、VAE／CLIP、浮點非決定性 → 不保證同圖（與本輪權重修正無關）。

---

## 10. 需產品負責人決策

| # | 決策 | 本報告暫定 |
|---|---|---|
| PD1 | 第二個 key `ui.loras.migrationBackup.corrupt` 是否接受？ | 建議接受；證明見 §4.1 |
| PD2 | 備份保留天數 | 建議 30 天 |
| PD3 | `QUOTA_EXCEEDED` 時是否提供「清舊歷史換空間」入口？ | 本輪不設計 UX；資料契約已給錯誤碼 |
| PD4 | 未來是否支援獨立 Model/CLIP 權重？ | 本輪不支援；若支援需改 §5.2 列出的 7 處 |

---

## 11. 本次未執行的工作

修改既有程式碼／測試／報告／AGENTS／README／設定；修改 localStorage 或使用者資料；操作模型／Tag DB／Dict／LoRA；啟停服務；生圖或 GPU 測試；`codegraph sync`；任何 Git 寫入；以瀏覽器讀取真實 localStorage。原因均為唯讀任務明確禁止或無需求。

---

## 12. Git 最終狀態

- 唯一新增：`devtools/reports/prompt-tag-system-a2-r4-r1-r1-final-contract-fixes.md`（untracked）。
- 開始時 15 modified／0 staged／62 untracked 全部未動。
- 寫入後實際執行 `git status --porcelain`：`modified=15`、`staged=0`、`untracked=63`、`total=78`（開始時 15／0／62／77），唯一新增 untracked 即本報告。
- 寫入後實際執行 `git diff --check`：`exit 0`；兩個既存 CRLF 警告（`devtools/lora_api_test.py`、`devtools/lora_core_test.mjs`）與本輪無關。
- Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、Ahead 1／Behind 0 不變。

---

## 13. 正式服務是否受到影響

**沒有**。未停止／重啟 ComfyUI、simple_ui（7860）、WD14 Worker；兩服務原本即在監聽，本輪未送出 HTTP／WebSocket 請求、未生圖、未讀取 API Key、未寫入使用者資料。唯一外部動作是唯讀 TCP 檢查與 `codegraph status`。本報告是純 Markdown，不影響執行期行為。

---

## 14. ChatGPT 獨立審查重點

1. §4.1 的第二個 key 是否真的必要？有沒有「單 key 且能保護解析失敗原文」的做法？
2. §4.3 的 `verified` 讀回比對是否足以對抗無痕模式？還是應直接把無痕視為 `STORE_UNAVAILABLE`？
3. §4.4「一般存檔也要先寫 backup」是否會造成每次存檔都兩次寫入的效能／失敗率問題？
4. §4.5 C4（既有 pending append）是否需要使用者的單獨確認，還是允许交易自動 append？
5. §5.2 把 `strengthModel`／`strengthClip` 定為「正常管線不存在的欄位」是否正確？有沒有其他呼叫端（例如 devtools mock）可能傳入它們？

---

**結論**：本輪完成兩項定點補正：（1）遷移備份的嚴格寫入順序、`safeSetJSON` 錯誤狀態、完整新增 key 清單（2 個）與 9+1 個失敗案例；（2）依實際程式碼更正 LoRA 權重契約——正常路徑只有單一 `strength`，Model/CLIP 同值，`strengthModel`／`strengthClip` 只是未被資料管線使用的函式選用參數，並同步修正 §7／§8／§9／§10。本輪**只新增本報告**，未修改任何既有檔案，未執行 Git 寫入，未影響正式服務，**不開始任何實作**。
