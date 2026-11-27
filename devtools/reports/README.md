# Sid-simple-ui 開發報告索引

本文件是開發報告入口，不取代設計契約、實作報告或審查紀錄。狀態會隨工作區改變；開始新任務時請先依 `AGENTS.md` 重新查 Git 與 CodeGraph，不要沿用此頁的舊數字。

## 專案進度

- **A2 資料契約：已完成設計。** 最後的契約補正見 [A2-R4-R1-R1](./prompt-tag-system-a2-r4-r1-r1-final-contract-fixes.md)；前面各輪仍是契約演進證據，請勿只保留最後一份。
- **A3 UX：已完成設計。** 最新設計決策集中在 [A3-R2 §1.4](./prompt-tag-system-a3-r2-ux-design.md)；A3-R1 是早期盤點與設計歷史。
- **A3 Phase 1：實作與已知修正已完成，並已接受 ChatGPT 獨立審查。** ChatGPT 已通過 R1-R2 的 M8 非物件列備份修正（依目前使用者確認）。實作/測試紀錄見 [Phase 1 實作報告](./a3-phase1-implementation.md)；工作區與文件盤點見 [收尾盤點](./a3-phase1-closeout-inventory.md)。
- 工作區目前有尚未提交的既有修改；未 stage/commit/push 狀態及數量會改變，請以 `git status --short --branch` 即時結果為準。

## 權威文件入口

| 主題 | 文件 | 用途 |
|---|---|---|
| A2 資料契約 | [prompt-tag-system-a2-r4-r1-r1-final-contract-fixes.md](./prompt-tag-system-a2-r4-r1-r1-final-contract-fixes.md) | BackupRecord 寫入安全、錯誤狀態與最後契約修正；需模型背景時回看 A2-R4/R3。 |
| A3 最新 UX 設計 | [prompt-tag-system-a3-r2-ux-design.md](./prompt-tag-system-a3-r2-ux-design.md) | 多輪 UX 修正同檔保存；以 §1.4 最新決策為準，設計不代表均已實作。 |
| A3 Phase 1 實作/測試 | [a3-phase1-implementation.md](./a3-phase1-implementation.md) | 初版與 R1、R1-R2 修正歷史，含測試結果和限制。 |
| A3 Phase 1 收尾盤點 | [a3-phase1-closeout-inventory.md](./a3-phase1-closeout-inventory.md) | 工作區分類、文件地圖、後續索引/整理建議。 |

## Phase 1 已完成摘要

- **資料模型：** PromptEntry、PromptModel 與 Legacy Adapter。
- **組裝：** Prompt Composer 作為提示詞組裝入口；生成快照沿用 Composer 結果。
- **標籤與 Negative：** Quality 白名單及模式過濾；Negative L1 保留原始字串、L2 另作結構化解析。
- **LoRA：** v1→v2 Migration、持久化 Backup/Quarantine/Retry 與 M1–M8 處理。
- **歷史：** 只帶文字與完整還原分流、確認流程及 Snapshot/生成整合。
- **M8 R1-R2：** null、字串、數字、boolean、Array 資料列以原始整包 JSON 備份；備份驗證後才寫清理結果。

細節及資料保護契約以權威文件為準，本索引不複製實作說明。

## 驗收狀態與限制

以下測試結果抄錄自 [Phase 1 實作報告](./a3-phase1-implementation.md)，不是本索引任務重新執行的結果：

- `lora_migration_test.mjs`：17 passed / 0 failed；包含五種 M8 非物件列、原始 JSON 保全及備份失敗保護。
- `lora_core_test.mjs`：34 passed。
- `prompt_core_test.mjs`：5 passed；`prompt_integration_contract_test.mjs` 通過；`history_reuse_test.mjs`：4 passed。
- `category_apply_test.mjs`：28/28；`category_apply_ui_test.mjs`：22 UI tests passed。
- **未完整驗證：** `lora_ui_test.mjs` 曾於 39 PASS 後，在既有 Civitai Checkpoint recognition 等待逾時，該次 exit 1。不可描述為整套 UI E2E 通過。
- **未驗項目：** Phase 1 報告未記錄正式使用者 localStorage/資料恢復或真實生圖驗收；不得推稱已通過。

## 後續工作與決策

- 若啟動 A3 Phase 2，先把 [A3-R2 Phase 2 規格](./prompt-tag-system-a3-r2-ux-design.md) 與已完成 LoRA Explorer、Trigger Words、Civitai 功能逐項對照，僅列差異，避免重做 Phase 1 或既有功能。
- Civitai Checkpoint UI 等待逾時尚未在 Phase 1 報告中解決；後續可獨立調查或提供明確隔離的 Phase 1 UI 驗收入口。
- A3-R2 中未決的產品決策，需讀原設計段落並取得授權；不要由索引推定已決定或擴做 Phase 2/3/4。
- 若需要正式生成、正式使用者資料或任何工作區清理，須依任務授權及 AGENTS 安全規範另行規劃。

## 歷史報告查找

### A2 設計與修正歷史

[初版資料模型](./prompt-tag-system-a2-data-model-design.md) → [R1 修正](./prompt-tag-system-a2-r1-design-correction.md) → [R2 一致性](./prompt-tag-system-a2-r2-model-consistency.md) → [R3 最終收斂](./prompt-tag-system-a2-r3-final-model.md) → [R4 模型補正](./prompt-tag-system-a2-r4-final-model-correction.md) → [R4-R1 契約修正](./prompt-tag-system-a2-r4-r1-final-contract-fixes.md) → [R4-R1-R1 最後補正](./prompt-tag-system-a2-r4-r1-r1-final-contract-fixes.md)。此鏈包含模型和契約演進證據，不要只保留最新版。

### A3 UX 設計與 Phase 1 實作歷史

- [A3-R1 UX 盤點/設計](./prompt-tag-system-a3-r1-ux-design.md) → [A3-R2 多輪設計修正](./prompt-tag-system-a3-r2-ux-design.md)（§1.4 最新）。
- [Phase 1 實作、R1、R1-R2](./a3-phase1-implementation.md)；[Phase 1 收尾盤點](./a3-phase1-closeout-inventory.md)。
- [Prompt/Tag 整合前期盤點](./prompt-tag-system-consolidation-audit.md) 提供早期問題背景，不替代後續契約/實作報告。

### LoRA 與 Civitai

- 本機套用與 A/B：[`lora-phase1.md`](./lora-phase1.md)、[`lora-real-generation-ab-test.md`](./lora-real-generation-ab-test.md)、[`amora-lora-real-generation-ab-test.md`](./amora-lora-real-generation-ab-test.md)。A/B 原始資料位於本機 `lora-ab-20261126/` 與 `amora-lora-ab-20261126/`，包含生成圖片、Workflow 與 History JSON；這些個人測試資料刻意不納入 Git，請在本機保留並與報告配對。
- Explorer/圖片：[`lora-explorer-phase1.md`](./lora-explorer-phase1.md)、[`lora-explorer-real-world-audit.md`](./lora-explorer-real-world-audit.md)、[`lora-image-preview-research.md`](./lora-image-preview-research.md)、[`lora-image-preview-s0.md`](./lora-image-preview-s0.md)、[`lora-image-preview-phase2.md`](./lora-image-preview-phase2.md)。
- Trigger Words/作者建議：[`lora-trigger-words-a1-audit.md`](./lora-trigger-words-a1-audit.md)、[`lora-trigger-words-ux-audit.md`](./lora-trigger-words-ux-audit.md)、[`lora-trigger-words-ux-phase2.md`](./lora-trigger-words-ux-phase2.md) 及 `lora-trigger-words-ux-phase2-review-fixes*.md` 修正鏈；另見 [`lora-civitai-author-suggestions-ux.md`](./lora-civitai-author-suggestions-ux.md)。
- API key/下載/OAuth：查閱 `lora-personal-api-key-*.md`、`lora-oauth-s1-design.md`；Phase A、Phase B/B1 的 review/修正尾碼是歷史鏈，勿當成重複副本。
- 指定模型版本核對/安裝：`amora-star-savior-*.md`，不同文件記錄查核、官方核對與安裝等不同環節。

### 其他功能與測試報告

- History/category：[`history-prompt-category-apply-investigation.md`](./history-prompt-category-apply-investigation.md)（調查）與 [`history-prompt-category-apply-implementation.md`](./history-prompt-category-apply-implementation.md)（實作）。
- WD14/輸出目錄：[`fix-local-wd14-and-output-directory.md`](./fix-local-wd14-and-output-directory.md)。
- 標籤學習：[`tag-learning-phase1.md`](./tag-learning-phase1.md)。
- 開源部署/安全：`open-source-readiness-*.md`；Phase 3R1 的 review/verification 後綴記錄逐輪修正。
- 專案文件分流：[`readme-agents-documentation.md`](./readme-agents-documentation.md)。它不是本索引。

報告日期或工作區可能已變；讀取歷史報告時，留意其中記錄的當時 Git/服務狀態，不要當作目前狀態。
