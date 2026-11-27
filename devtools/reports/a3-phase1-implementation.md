# A3 Phase 1 — Prompt／Tag／LoRA 資料模型與 Composer 核心實作

## 結果

完成 A3 Phase 1 的核心資料模型、Prompt Composer、LoRA v1→v2 遷移與復原備份、歷史文字／完整還原分流，以及 Quality 標籤篩選。生成快照只建立一次 Composer 結果，並共用在送出、歷史及預覽所需的正面提示詞。

工作日期：2026-11-27（台北時間）。執行記錄未保留可核實的起始時間。

## 變更

- 新增 `prompt_core.js`：PromptEntry 14 欄位、舊選取資料轉接、提示詞分段與去重、權重格式、L1 原始 Negative 保留及 L2 有效 Negative 解析、固定 Quality 白名單。
- 新增 `lora_migration.js`：v1→v2 遷移、寫入後讀回確認、先持久化原始資料復原備份、損壞資料隔離，以及備份確認流程。一般儲存保留尚未確認的備份紀錄。
- 更新 `index.html` 載入核心模組，並提供歷史「只帶文字」及「完整還原（含角色）」入口。
- 更新 `app.js`：以單一 Composer 快照供生成與歷史使用；LoRA v2 序列化；PD1 文字套用與完整還原確認／提交流程；相容缺少與空 `loras` 欄位的差異。
- 更新 `tags.js`：一般／進階共用 Quality 判定，加入可選數量提示與刷新入口。
- 更新相關測試與 `AGENTS.md` 檔案導覽。

## 驗證

- 語法：`node --check` 通過 `app.js`、`tags.js`、`dict.js`、`tag_categories.js`、`prompt_core.js`、`lora_migration.js`、`devtools/lora_ui_test.mjs`；`python -m py_compile server.py` 通過。
- 測試：Prompt core 5 項、整合契約 1 項、LoRA migration 8 項、history reuse 4 項、LoRA core 34 項、category apply 28 項、category apply UI 22 項均通過。
- 隔離 headless UI：新增 Quality 模式驗證通過；LoRA 選取、提示詞、送出快照、歷史完整還原／空清單／舊格式相容等相關案例均通過。整體 `lora_ui_test.mjs` 後段在既有 Civitai「Checkpoint 辨識完成」等待逾時，未完整通過；此例不屬 Phase 1 改動範圍，不能據此宣稱整套 UI 測試全數通過。
- UI 測試使用獨立 mock ComfyUI、mock Civitai 與 7861 測試伺服器，結束後已停止。最後確認測試及正式用 port 7861、18188、18189、7860、8188 均無 listener；沒有呼叫正式服務或 GPU 生圖。
- `git diff --check` 通過；Git 僅輸出既有行尾轉換警告。

## 資料保護與限制

- 未讀寫使用者正式瀏覽器 localStorage、圖片或正式服務；所有瀏覽器 UI 操作限於 headless 測試的新 profile。
- 遷移備份沿用 A2 核准的 `ui.loras.migrationBackup` 與 `.corrupt` 鍵。一般成功遷移的待確認安全備份以 `partial-failure` reason 保存，並附註其為遷移安全備份；此欄位語意需在整合審查時確認是否符合最終契約。
- 完整還原的 UI 確認與取消、空陣列清空、欄位缺失保留等案例已覆蓋；使用者資料上的真實復原與真實生圖未測試。

## Git 狀態

- 起始：`main`，HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`，相對 `origin/main` ahead 1 / behind 0；起始工作目錄已有 15 個修改檔案、62 個未追蹤項目，無 staged 變更。
- 結束：仍在 `main`，ahead 1 / behind 0；沒有新增 staged 變更。工作目錄原有大量使用者變更，故結束的整份 diff 不代表本次 A3 的變更量；本次僅在 A3 相關核心、UI、測試及此報告範圍編輯，未清理或覆寫其他既有檔案。
- 未執行 stage、commit、push、reset 或正式服務重啟。

## R1 獨立審查修正（2026-11-27）

本節補充及更正 R1 狀態；上方初版歷史保留原樣。R1 開始時重新查核 `C:\ComfyUI\simple_ui`：branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、`origin/main` ahead 1 / behind 0、無 staged changes、`git diff --check` 成功。起始有 17 個 tracked modified files：`AGENTS.md`、`app.css`、`app.js`、`devtools/category_apply_test.mjs`、`devtools/lora_api_test.py`、`devtools/lora_core_test.mjs`、`devtools/lora_explorer_api_test.py`、`devtools/lora_explorer_core_test.mjs`、`devtools/lora_mock_civitai.py`、`devtools/lora_ui_test.mjs`、`devtools/test_ui_control_wd14.ps1`、`index.html`、`server.py`、`tags.js`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`；起始未追蹤檔案及目錄完整清單見 R1 起始 `git ls-files --others --exclude-standard` 記錄（包含下列 R1 新增測試檔及眾多既有報告/資料，均保留）。無 staged changes。

CodeGraph 起始狀態：35 files、1,094 nodes、4,837 edges；pending Added 11 / Modified 8。依要求未執行 sync/index，因此 CodeGraph 在任務結束仍是舊索引。

### R1 修正

- `app.js`：解析 v2 LoRA 資料時驗證名稱、欄位、adoption records，保留有效項目並把無效原始列轉成 quarantine 備份請求；處理雙版本衝突和 v2 空 triggers；啟動時執行遷移、阻止不安全覆寫；提供待確認狀態、按 BackupRecord ID 確認，以及依 A2 契約「還原舊詞」操作。生成快照改用 Composer 的 `snapshotEntries`（`entryId`）。
- `lora_migration.js`：遷移備份先持久化並讀回驗證；備份失敗不覆寫 `ui.loras`；依來源、項目、理由及 payload 重用 pending backup，使三次啟動重試冪等；對未知版本、解析錯誤與損壞備份採保全/阻止覆寫；驗證 BackupRecord 欄位與 UUID v4；確認讀回失敗仍維持 pending。僅使用核准的 `ui.loras`、`ui.loras.migrationBackup`、`ui.loras.migrationBackup.corrupt` 三個既有鍵。
- `index.html`、`app.css`：新增精簡的 LoRA 遷移備份通知及確認操作版面。
- `devtools/lora_migration_test.mjs`、`devtools/lora_core_test.mjs`、`devtools/lora_ui_test.mjs`、`devtools/prompt_core_test.mjs`、`devtools/prompt_integration_contract_test.mjs`：增加交易、隔離 Storage、UI 及 Snapshot Entry ID 覆蓋；修正 UI 測試重載後須重新開啟 LoRA 選擇視窗才能操作觸發詞的測試步驟。
- `devtools/reports/a3-phase1-implementation.md`：本節為 R1 補充。

### M1–M8 與持久化證據

- M1：v1→v2 轉換及缺失的 `adoptionRecords` 正規化為 `[]`；有效 v2 缺欄位時補預設並存檔。
- M2：有效空 `personalTriggers: []` 保持空，不被舊欄位覆蓋。
- M3：不合法項目進 quarantine 備份後才允許寫入清理後的有效項目。
- M4：相同雙欄位保留 v2 順序及內容。
- M5：v2 詞序優先，按 NFKC/wordKey 去重後追加 v1 獨有詞；超過一般加入上限仍完整保存。持久化 BackupRecord reason 為 `dual-conflict`，保留 itemName 與原始 item payload。
- M6：v2 空陣列勝出、不把舊詞注入 Prompt；舊 triggers 以 `v1-data-v2-empty`、itemName 及原始 item payload 持久化，先寫備份並驗證後才寫來源。
- M7：無舊欄位的 v2 資料保留並正規化。
- M8：無效 LoRA name、錯誤型別及無效 adoption record 列逐筆 quarantine；整包 JSON 損壞保留精確來源字串；不合法字串版本僅在先保全原字串後推斷；未知數字版本不降級轉換且不覆寫原始來源。

隔離測試中的 BackupRecord 範例（虛構資料）：

```json
{
  "backupId": "00112233-4455-4677-8899-aabbccddeeff",
  "createdAt": 1735296000000,
  "reason": "dual-conflict",
  "sourceKey": "ui.loras",
  "itemName": "chars/MockMiku.safetensors",
  "payload": { "kind": "item", "value": { "triggers": ["old"], "personalTriggers": ["new"] } },
  "targetVersion": 2,
  "expectedItemCount": 1,
  "status": "pending",
  "confirmedAt": null,
  "note": "isolated UI fixture"
}
```

Retry 測試的同一筆來源連續三次啟動：第一次與第二次在遷移來源寫入階段失敗、第三次成功；pending 備份總數始終為 1，重用原 BackupRecord；成功後仍是 pending 等使用者確認。一般 `saveState` 保留 pending；備份寫入失敗、讀回不一致、來源寫入/讀回失敗不丟棄來源或備份。BackupRecord 確認只作用於指定 UUID、讀回成功才確認、不刪除備份。M8 quarantine 經一般存檔與重啟仍可恢復。

UI 隔離測試明確確認「保留目前結果」及 A2 定義的「還原舊詞」兩個操作；測試以兩個不同 UUID 驗證正確呼叫 `confirmBackup`，還原舊詞被合併存檔、讀回後才確認，兩筆備份都保留。測試使用 headless Chrome 新 profile、mock ComfyUI、mock Civitai 及測試伺服器，未接觸使用者瀏覽器或正式資料。

### Snapshot Entry ID

Composer 測試確認記憶體 PromptEntry 使用 `id`，輸出 SnapshotEntry 使用 `entryId` 且不包含 `id`；整合測試執行實際抽取的 `snapshotNow()`，確認生成快照沿用 `composed.result.snapshotEntries`。未重新翻譯標籤或重組 Prompt。

### 驗證結果

| 命令 | 結果 |
|---|---|
| `node devtools/prompt_core_test.mjs` | exit 0；5 passed / 0 failed |
| `node devtools/prompt_integration_contract_test.mjs` | exit 0；整合契約通過 |
| `node devtools/lora_migration_test.mjs` | exit 0；16 passed / 0 failed，涵蓋 M1–M8、失敗保全、三次重試、確認及 quarantine |
| `node devtools/history_reuse_test.mjs` | exit 0；4 passed / 0 failed |
| `node devtools/lora_core_test.mjs` | exit 0；34 passed / 0 failed |
| `node devtools/category_apply_test.mjs` | exit 0；28 / 28 passed |
| `node devtools/category_apply_ui_test.mjs` | exit 0；22 UI tests passed |
| `node devtools/lora_ui_test.mjs --ui http://127.0.0.1:7861 --mock http://127.0.0.1:18188 --mockcv http://127.0.0.1:18189 --capture <temp>` | exit 1；Phase 1 遷移確認與還原、Prompt／Workflow／歷史、版面及 API 子案例均通過（39 個 PASS）；後段既有 Civitai 等待 `Checkpoint 辨識完成` 逾時，未完整通過，不能宣稱全套 UI 通過 |
| `node --check app.js tags.js dict.js tag_categories.js prompt_core.js lora_migration.js devtools/lora_migration_test.mjs devtools/lora_ui_test.mjs` | exit 0 |
| `python -m py_compile server.py` | exit 0 |
| `git diff --check` | exit 0；只有既有行尾轉換警告 |

### 結束狀態及範圍

正式服務沒有停止或重啟，未呼叫正式 ComfyUI、未用 GPU 生圖，也未讀寫正式使用者 localStorage、圖片或模型。只啟動並停止本次隔離測試的 7861 / 18188 / 18189。結束確認 7860、8188、7861、18188、18189 均無 listener。沒有第三個 localStorage key、外部依賴、Civitai SHA、WD14 或正式服務設定變更。

最終仍為 `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、ahead 1 / behind 0、無 staged changes。保留所有任務前已有變更及未追蹤檔案；未執行 stage、commit、push、reset、restore、stash、checkout 或 clean。最終 working tree 包含本報告上列 R1 修改與原有工作；完整即時狀態以結案時 `git status --short --branch` 為準。

未完成項目：`lora_ui_test.mjs` 的 Civitai「Checkpoint 辨識完成」等待逾時；其他 Phase 1 指定測試通過。待使用者交由 ChatGPT 進行下一輪獨立審查。

#### 未追蹤檔案清單（R1 起始與結束核對）

下列未追蹤路徑在 R1 開始時已存在，R1 未新增或移除未追蹤檔案；為便於逐項核對，列出完整清單：

```text
comfy_lora_paths.py
devtools/comfy_lora_paths_test.py
devtools/history_reuse_test.mjs
devtools/lora_migration_test.mjs
devtools/lora_personal_key_test.py
devtools/lora_personal_key_ui_test.mjs
devtools/lora_trigger_words_ui_test.mjs
devtools/prompt_core_test.mjs
devtools/prompt_integration_contract_test.mjs
devtools/reports/a3-phase1-implementation.md
devtools/reports/amora-lora-ab-20261126/compare_A_B_C_D.json
devtools/reports/amora-lora-ab-20261126/compare_C_W06_W08_W10.json
devtools/reports/amora-lora-ab-20261126/history_A.json
devtools/reports/amora-lora-ab-20261126/history_B.json
devtools/reports/amora-lora-ab-20261126/history_C.json
devtools/reports/amora-lora-ab-20261126/history_D.json
devtools/reports/amora-lora-ab-20261126/history_W06.json
devtools/reports/amora-lora-ab-20261126/history_W08.json
devtools/reports/amora-lora-ab-20261126/history_W10.json
devtools/reports/amora-lora-ab-20261126/image_A.png
devtools/reports/amora-lora-ab-20261126/image_B.png
devtools/reports/amora-lora-ab-20261126/image_C.png
devtools/reports/amora-lora-ab-20261126/image_D.png
devtools/reports/amora-lora-ab-20261126/image_W06.png
devtools/reports/amora-lora-ab-20261126/image_W08.png
devtools/reports/amora-lora-ab-20261126/image_W10.png
devtools/reports/amora-lora-ab-20261126/summary_round1.json
devtools/reports/amora-lora-ab-20261126/summary_round2.json
devtools/reports/amora-lora-ab-20261126/verification.json
devtools/reports/amora-lora-ab-20261126/workflow_A.json
devtools/reports/amora-lora-ab-20261126/workflow_B.json
devtools/reports/amora-lora-ab-20261126/workflow_C.json
devtools/reports/amora-lora-ab-20261126/workflow_D.json
devtools/reports/amora-lora-ab-20261126/workflow_W06.json
devtools/reports/amora-lora-ab-20261126/workflow_W08.json
devtools/reports/amora-lora-ab-20261126/workflow_W10.json
devtools/reports/amora-lora-real-generation-ab-test.md
devtools/reports/amora-star-savior-download-install.md
devtools/reports/amora-star-savior-official-crosscheck.md
devtools/reports/amora-star-savior-version-3276795-audit.md
devtools/reports/fix-local-wd14-and-output-directory.md
devtools/reports/history-prompt-category-apply-investigation.md
devtools/reports/lora-ab-20261126/compare.json
devtools/reports/lora-ab-20261126/history_A.json
devtools/reports/lora-ab-20261126/history_B.json
devtools/reports/lora-ab-20261126/image_A.png
devtools/reports/lora-ab-20261126/image_B.png
devtools/reports/lora-ab-20261126/run_summary.json
devtools/reports/lora-ab-20261126/workflow_A.json
devtools/reports/lora-ab-20261126/workflow_B.json
devtools/reports/lora-civitai-author-suggestions-ux.md
devtools/reports/lora-explorer-real-world-audit.md
devtools/reports/lora-image-preview-phase2.md
devtools/reports/lora-image-preview-research.md
devtools/reports/lora-image-preview-s0.md
devtools/reports/lora-oauth-s1-design.md
devtools/reports/lora-personal-api-key-and-application-audit.md
devtools/reports/lora-personal-api-key-audit.md
devtools/reports/lora-personal-api-key-design-review.md
devtools/reports/lora-personal-api-key-phase-a-r1.md
devtools/reports/lora-personal-api-key-phase-a-r1a.md
devtools/reports/lora-personal-api-key-phase-a.md
devtools/reports/lora-personal-api-key-phase-b-audit-r1.md
devtools/reports/lora-personal-api-key-phase-b-audit-r2.md
devtools/reports/lora-personal-api-key-phase-b-audit.md
devtools/reports/lora-personal-api-key-phase-b-implementation-spec.md
devtools/reports/lora-personal-api-key-phase-b1-implementation.md
devtools/reports/lora-personal-api-key-phase-b1-review-r1.md
devtools/reports/lora-personal-api-key-phase-b1-review-r2-regex-fix.md
devtools/reports/lora-personal-api-key-phase-b1-review-r2.md
devtools/reports/lora-real-generation-ab-test.md
devtools/reports/lora-trigger-words-a1-audit.md
devtools/reports/lora-trigger-words-ux-audit.md
devtools/reports/lora-trigger-words-ux-phase2-review-fixes-r2.md
devtools/reports/lora-trigger-words-ux-phase2-review-fixes-r3.md
devtools/reports/lora-trigger-words-ux-phase2-review-fixes.md
devtools/reports/lora-trigger-words-ux-phase2.md
devtools/reports/open-source-readiness-phase1.md
devtools/reports/open-source-readiness-phase2a.md
devtools/reports/open-source-readiness-phase2b1.md
devtools/reports/open-source-readiness-phase2b2.md
devtools/reports/open-source-readiness-phase2b3.md
devtools/reports/open-source-readiness-phase2c-implementation.md
devtools/reports/open-source-readiness-phase2c.md
devtools/reports/open-source-readiness-phase3.md
devtools/reports/open-source-readiness-phase3r1.md
devtools/reports/open-source-readiness-phase3r1r.md
devtools/reports/open-source-readiness-phase3r1v.md
devtools/reports/open-source-readiness-phase3r1vr.md
devtools/reports/prompt-tag-system-a2-data-model-design.md
devtools/reports/prompt-tag-system-a2-r1-design-correction.md
devtools/reports/prompt-tag-system-a2-r2-model-consistency.md
devtools/reports/prompt-tag-system-a2-r3-final-model.md
devtools/reports/prompt-tag-system-a2-r4-final-model-correction.md
devtools/reports/prompt-tag-system-a2-r4-r1-final-contract-fixes.md
devtools/reports/prompt-tag-system-a2-r4-r1-r1-final-contract-fixes.md
devtools/reports/prompt-tag-system-a3-r1-ux-design.md
devtools/reports/prompt-tag-system-a3-r2-ux-design.md
devtools/reports/prompt-tag-system-consolidation-audit.md
devtools/reports/readme-agents-documentation.md
devtools/test_ui_control_process.ps1
devtools/test_ui_panel_reporting.py
lora_migration.js
prompt_core.js
```


## R1-R2 — M8 非物件資料列隔離備份（2026-11-27）

### 問題與修正

第二輪審查指出 `loraParseState()` 的 `quarantine()` 把所有資料列都包成 `payload.kind:"item"`。null、字串、數字、boolean、Array 不符合 BackupRecord 的 item payload 驗證，造成 `readAndMigrate()` 備份整理失敗並回 `SERIALIZE_FAILED`，無法持久化隔離資料。

只修改 `app.js` 與 `devtools/lora_migration_test.mjs`。`quarantine()` 現在只對非 null、非 Array 物件使用 `kind:"item"` 並保存原始列及可取得的名稱；其他值使用 `kind:"raw-json"`、`itemName:null`、`reason:"quarantine"`。沿用既有 `readAndMigrate()` raw-json 替換步驟，將 request payload 換成 `getItem("ui.loras")` 取得的原始 JSON 字串。沒有修改 `lora_migration.js`、Migration 格式、UUID 或 localStorage keys。

### 五種資料列的交易測試

`devtools/lora_migration_test.mjs` 新增完整隔離 Storage 交易測試，分別以 `null`、`"bad-row"`、`17`、`true`、`["array-row"]` 與一筆有效 `keep.safetensors` 同時遷移。五例均驗證：有效 LoRA 留存；BackupRecord 的 reason 為 `quarantine`、kind 為 `raw-json`、itemName 為 null 且 `validateRecord()` 成功；payload.value 逐字等於原始 `ui.loras` 字串；清理後有效項目不含壞列；`Store.writes` 證明備份 key 寫入先於 `ui.loras`；一般 `saveState()` 後仍可讀出原始備份。每種壞列另測一次備份寫入失敗，確認 `ui.loras` 原字串完全不變且來源 key 沒有進入寫入記錄。

### 驗收

| 命令 | 退出碼 | 結果 |
|---|---:|---|
| `node devtools/lora_migration_test.mjs` | 0 | 17 passed / 0 failed，含新增五種非物件列交易及原有 M1–M8、M5/M6、重試、確認、quarantine 案例 |
| `node devtools/lora_core_test.mjs` | 0 | 34 passed |
| `node devtools/prompt_core_test.mjs` | 0 | 5 passed |
| `node devtools/prompt_integration_contract_test.mjs` | 0 | 通過 |
| `node devtools/history_reuse_test.mjs` | 0 | 4 passed |
| `node --check app.js` | 0 | 通過 |
| `node --check lora_migration.js` | 0 | 通過 |
| `node --check devtools/lora_migration_test.mjs` | 0 | 通過 |
| `git diff --check` | 0 | 通過；僅有既存 LF/CRLF 轉換警告 |

R1-R2 開始查核：repo `C:/ComfyUI/simple_ui`，branch `main`，HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`，remote `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`；`git status` 為 17 個 tracked modified、104 個 untracked、0 staged。起始完整檔案清單由同次 `git status --short` / `git ls-files --others --exclude-standard` 輸出記錄；其未追蹤清單已列於上方 R1 節。CodeGraph 為 35 files、1,094 nodes、4,837 edges，pending Added 11 / Modified 8；未 sync/index。結束時仍為 branch `main`、相同 HEAD、ahead 1 / behind 0，17 modified、104 untracked、0 staged；僅本輪既有 `app.js` 與 `devtools/lora_migration_test.mjs` 變更內容，以及本報告增加本節。沒有新增或移除 untracked 檔案。

正式服務與使用者資料沒有受影響：未連接或操作正式服務、未讀寫真實 localStorage，未操作圖片、模型或 GPU；無服務停止或重啟。未執行任何 Git 寫入操作。剩餘風險：無本次要求範圍內未通過項目；等待下一輪獨立審查。
