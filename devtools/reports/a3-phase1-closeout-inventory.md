# A3 Phase 1 收尾盤點與專案資訊降噪

> 盤點日期：2026-11-27（用戶端日期）。標記：[事實] 本輪指令/工作區/既有報告可核對；[用戶提供] 本任務明確陳述；[推論] 依內容和報告歸屬判斷；[建議] 尚未執行。

## 1. 目標與範圍

[事實] 唯讀盤點 `C:\ComfyUI\simple_ui` 的 Git、CodeGraph、A2/A3 契約與相關報告，並提出不破壞歷史證據的降噪方案。未修改既有程式、測試、設定、文件或使用者資料；本報告是唯一新增檔案。沒有檔案移動/改名/刪除、Git 寫入、CodeGraph sync/index、服務啟停或生圖。

## 2. 開始前 Repository 基線

[事實] 以 `git -C C:\ComfyUI\simple_ui` 查詢：

- Repository：`C:/ComfyUI/simple_ui`
- Branch：`main`
- HEAD：`cf5609e0cfbd69163247786f1f50dbf8e600c090`
- Remote：`origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push）
- `main` ahead 1 / behind 0；staged 0
- tracked modified 17；untracked 104（含子目錄內檔案）
- `git diff --check` exit 0；只有既存 LF→CRLF 警告，涉及 `devtools/category_apply_test.mjs`、`devtools/lora_api_test.py`、`devtools/lora_core_test.mjs`、`devtools/lora_ui_test.mjs`

起始 `git status --short --branch`：

```text
## main...origin/main [ahead 1]
 M AGENTS.md
 M app.css
 M app.js
 M devtools/category_apply_test.mjs
 M devtools/lora_api_test.py
 M devtools/lora_core_test.mjs
 M devtools/lora_explorer_api_test.py
 M devtools/lora_explorer_core_test.mjs
 M devtools/lora_mock_civitai.py
 M devtools/lora_ui_test.mjs
 M devtools/test_ui_control_wd14.ps1
 M index.html
 M server.py
 M tags.js
 M ui_control.ps1
 M ui_panel.ps1
 M ui_panel.pyw
```

Staged 清單為空。104 個起始 untracked 路徑逐項清單見 §5.7。

## 3. CodeGraph

[事實] `codegraph status`：35 files、1,094 nodes、4,837 edges、7.02 MB；JavaScript 19、Python 13、YAML 3；pending Added 11 / Modified 8。索引有未同步變更，symbol coverage 可能過時；只讀狀態，未 sync/index。程式行為以目前工作區實際內容及測試報告為準。

## 4. Tracked modified 完整分類

[事實] 下列是起始 `git diff --name-status` 全清單。[推論] 歸屬依報告與用途判斷；工作區累積多項未提交任務，沒有逐任務 commit/worktree，混合檔案的每個 hunk 無法可靠追溯。

| 路徑 | 分類與依據 | 信心 |
|---|---|---|
| `AGENTS.md` | A3/專案文件混合：含 Prompt/Migration 模組職責，也可能包含其他規範更新 | 中 |
| `app.css` | A3 Phase 1 樣式與其他 UI 任務混合 | 中 |
| `app.js` | A3 Composer、Migration、History Restore；亦混合其他 LoRA/Civitai 功能 | 高（混合） |
| `devtools/category_apply_test.mjs` | Phase 1 History Restore/分類套用與既有分類套用回歸 | 中 |
| `devtools/lora_api_test.py` | 其他功能：LoRA/Civitai API | 高 |
| `devtools/lora_core_test.mjs` | A3 LoRA core 與既有個人詞/作者建議 UX 混合 | 中高 |
| `devtools/lora_explorer_api_test.py` | 其他功能：LoRA Explorer API | 高 |
| `devtools/lora_explorer_core_test.mjs` | 其他功能：LoRA Explorer | 高 |
| `devtools/lora_mock_civitai.py` | 其他功能：Civitai mock，供 Explorer/圖片/Trigger Words 測試 | 高 |
| `devtools/lora_ui_test.mjs` | A3 Phase 1 與 LoRA/History/Civitai UI 回歸混合 | 高（混合） |
| `devtools/test_ui_control_wd14.ps1` | 其他功能：控制台/WD14 測試 | 高 |
| `index.html` | A3 模組載入及 History 入口，與其他 UI 混合 | 中高 |
| `server.py` | 其他後端功能（Civitai API、WD14 等）；Phase 1 核心不需改此檔 | 高 |
| `tags.js` | A3 Quality/filter 與標籤其他功能混合 | 中高 |
| `ui_control.ps1` | 其他功能：桌面服務控制台 | 高 |
| `ui_panel.ps1` | 其他功能：舊 WinForms 控制台 | 高 |
| `ui_panel.pyw` | 其他功能：Tk 控制台 | 高 |

沒有檔案可確認為用途不明；但混合檔案各 hunk 的時間/任務歸屬無法完全確認。[建議] 不以此工作區差異反推作者或回復檔案。

## 5. Untracked 完整分類

[事實] 起始共 104 個 untracked 路徑；逐項清單在 §5.7。

### 5.1 A3 Phase 1 程式碼、測試、報告

- 程式碼：[事實/高] `prompt_core.js`（PromptEntry/PromptModel/Composer/Legacy Adapter）、`lora_migration.js`（Migration/BackupRecord/Quarantine/Retry）。
- 測試：[事實/高] `devtools/prompt_core_test.mjs`、`devtools/prompt_integration_contract_test.mjs`、`devtools/lora_migration_test.mjs`、`devtools/history_reuse_test.mjs`。
- 報告：[事實/高] `devtools/reports/a3-phase1-implementation.md`，含 Phase 1 初版、R1、R1-R2 實作/測試紀錄。

### 5.2 A2/A3 設計與修正報告

- `devtools/reports/prompt-tag-system-a2-data-model-design.md`
- `devtools/reports/prompt-tag-system-a2-r1-design-correction.md`
- `devtools/reports/prompt-tag-system-a2-r2-model-consistency.md`
- `devtools/reports/prompt-tag-system-a2-r3-final-model.md`
- `devtools/reports/prompt-tag-system-a2-r4-final-model-correction.md`
- `devtools/reports/prompt-tag-system-a2-r4-r1-final-contract-fixes.md`
- `devtools/reports/prompt-tag-system-a2-r4-r1-r1-final-contract-fixes.md`
- `devtools/reports/prompt-tag-system-a3-r1-ux-design.md`
- `devtools/reports/prompt-tag-system-a3-r2-ux-design.md`
- `devtools/reports/prompt-tag-system-consolidation-audit.md`

[事實/高] A2 七份報告為契約演進證據，不可只留最後一份。實作契約入口是 A2-R4-R1-R1，按需回溯 R4/R3。A3-R2 §1.4 是最新 UX；A3-R1 保留初始盤點脈絡。

### 5.3 其他測試工具及資料

- 工具/測試：[推論/高] `comfy_lora_paths.py`、`devtools/comfy_lora_paths_test.py`、`devtools/lora_personal_key_test.py`、`devtools/lora_personal_key_ui_test.mjs`、`devtools/lora_trigger_words_ui_test.mjs`、`devtools/test_ui_control_process.ps1`、`devtools/test_ui_panel_reporting.py`。用途對應 LoRA 路徑解析、Civitai key、Trigger Words、桌面控制台。
- A/B 資料：[推論/中] `devtools/reports/amora-lora-ab-20261126/` 與 `devtools/reports/lora-ab-20261126/` 中 JSON/PNG 是相應 A/B 報告配套。用途可辨，但長期版控/分享適切性需人工確認，不宜視為可重建快取刪除。

### 5.4 其他功能報告逐項分類

**LoRA 實作、調查、交付：**

- `devtools/reports/lora-phase1.md` — 本機角色套用交付。
- `devtools/reports/lora-real-generation-ab-test.md` — 真實環境 A/B。
- `devtools/reports/amora-lora-real-generation-ab-test.md` — Amora 指定模型 A/B。
- `devtools/reports/amora-star-savior-download-install.md` — 指定版本安裝/完整性。
- `devtools/reports/amora-star-savior-official-crosscheck.md` — 官方版本核對。
- `devtools/reports/amora-star-savior-version-3276795-audit.md` — 指定版本頁面查核。
- `devtools/reports/lora-explorer-phase1.md` — Explorer Phase 1 交付。
- `devtools/reports/lora-explorer-real-world-audit.md` — Explorer 情境調查。
- `devtools/reports/lora-image-preview-research.md` — 預覽研究。
- `devtools/reports/lora-image-preview-s0.md` — 預覽/成熟內容 S0 修正。
- `devtools/reports/lora-image-preview-phase2.md` — 預覽 Phase 2 交付。
- `devtools/reports/lora-civitai-author-suggestions-ux.md` — 作者建議詞 UX 修正。
- `devtools/reports/lora-civitai-shortcut.md` — 標題列捷徑交付。
- `devtools/reports/lora-trigger-words-a1-audit.md` — 觸發詞生命週期調查。
- `devtools/reports/lora-trigger-words-ux-audit.md` — 觸發詞 UX 調查。
- `devtools/reports/lora-trigger-words-ux-phase2.md` — Trigger Words Phase 2 交付。
- `devtools/reports/lora-trigger-words-ux-phase2-review-fixes.md`、`devtools/reports/lora-trigger-words-ux-phase2-review-fixes-r2.md`、`devtools/reports/lora-trigger-words-ux-phase2-review-fixes-r3.md` — 多輪 review/E2E 補強鏈。
- `devtools/reports/lora-ux-copy.md` — LoRA 空狀態/文案改善。

**Civitai API key、下載及 OAuth：**

- `devtools/reports/lora-personal-api-key-and-application-audit.md`
- `devtools/reports/lora-personal-api-key-audit.md`
- `devtools/reports/lora-personal-api-key-design-review.md`
- `devtools/reports/lora-personal-api-key-phase-a.md`
- `devtools/reports/lora-personal-api-key-phase-a-r1.md`
- `devtools/reports/lora-personal-api-key-phase-a-r1a.md`
- `devtools/reports/lora-personal-api-key-phase-b-audit.md`
- `devtools/reports/lora-personal-api-key-phase-b-audit-r1.md`
- `devtools/reports/lora-personal-api-key-phase-b-audit-r2.md`
- `devtools/reports/lora-personal-api-key-phase-b-implementation-spec.md`
- `devtools/reports/lora-personal-api-key-phase-b1-implementation.md`
- `devtools/reports/lora-personal-api-key-phase-b1-review-r1.md`
- `devtools/reports/lora-personal-api-key-phase-b1-review-r2.md`
- `devtools/reports/lora-personal-api-key-phase-b1-review-r2-regex-fix.md`
- `devtools/reports/lora-oauth-s1-design.md`

[推論] Phase A→R1→R1a、Phase B audit→R1→R2、B1 implementation→review R1→R2→regex fix 是修訂鏈，不是副本。兩份 API-key audit 標題相似但範圍不同，需人工逐節比較。

**History、WD14、標籤、文件及開源準備：**

- `devtools/reports/history-prompt-category-apply-investigation.md`、`devtools/reports/history-prompt-category-apply-implementation.md` — 調查及實作配套。
- `devtools/reports/fix-local-wd14-and-output-directory.md` — WD14/輸出目錄修正。
- `devtools/reports/tag-learning-phase1.md` — 標籤學習 Phase 1。
- `devtools/reports/readme-agents-documentation.md` — README/AGENTS 文件分流交付，不是 reports 索引。
- `devtools/reports/open-source-readiness-phase1.md`
- `devtools/reports/open-source-readiness-phase2a.md`
- `devtools/reports/open-source-readiness-phase2b1.md`
- `devtools/reports/open-source-readiness-phase2b2.md`
- `devtools/reports/open-source-readiness-phase2b3.md`
- `devtools/reports/open-source-readiness-phase2c.md`
- `devtools/reports/open-source-readiness-phase2c-implementation.md`
- `devtools/reports/open-source-readiness-phase3.md`
- `devtools/reports/open-source-readiness-phase3r1.md`
- `devtools/reports/open-source-readiness-phase3r1r.md`
- `devtools/reports/open-source-readiness-phase3r1v.md`
- `devtools/reports/open-source-readiness-phase3r1vr.md`

[推論] Phase 2C 調查/實作及 Phase 3 review/verification 修正是不同階段證據，不是重複檔。

### 5.5 疑似重疊或可能過時

- [疑似重疊] `lora-real-generation-ab-test.md` 與 `amora-lora-real-generation-ab-test.md`：一般 LoRA 與 Amora 特定測試；索引互連，不合併，避免混淆 checkpoint/seed 範圍。合併/移動需授權。
- [疑似重疊] 兩份 `lora-personal-api-key-*-audit.md`：key 審查與整合應用審查；需人工比內容後再決定，合併/改名需授權。
- [不是重複] `open-source-readiness-phase2c.md` 與 `...phase2c-implementation.md`：唯讀調查 vs 實作交付；成對保留。
- [不是重複] 三份 Amora 3276795 報告：鏡像查核、官方核對及安裝是不同證據環節。
- [過時但須留證] A2/A3 修訂鏈、所有 R1/R2/R3 review、WD14/LoRA Explorer/Civitai 調查稿可能描述舊狀態，但保存決策與審查由來。索引應標明後續取代文件；勿只因舊而刪。
- [無法判定] 沒有用途完全不明的路徑；但兩個 A/B 資料夾中 PNG/JSON 是否適合長期版控/分享需人工確認，在決定前保留。

### 5.6 子目錄收納與引用檢查

[建議] 目前不搬檔。A/B 輸出已分組；程式/測試位置有路徑入口；報告互相引用。先以索引降噪。本輪沒有提出具體 move path，因此未做引用遷移。未來若核准搬檔，先全 repo 搜尋路徑引用，再更新文件/測試命令。實際移動、合併、刪除均需使用者授權。

### 5.7 起始 104 個 untracked 路徑完整清單

[事實] 以下清單在建立本報告前由 `git ls-files --others --exclude-standard` 取得；子目錄已逐檔展開。本報告自身不屬於起始清單。

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

## 6. 報告關係與權威文件

### A2 契約

[事實] 七份報告是逐輪演進證據：A2 初版 → R1 事實/策略修正 → R2 模型一致性 → R3 最終收斂 → R4 adoptionRecords/history/M1–M8 → R4-R1 Negative/order/備份契約 → R4-R1-R1 寫入安全及權重契約。**目前實作契約入口為 A2-R4-R1-R1**，按需回看 R4/R3；前版不能刪。

### A3 與 History

- A3-R1 是初始 UX 盤點；A3-R2 §1.4 為最新設計及階段表。
- `a3-phase1-implementation.md` 是實作/測試主報告，保留初版、R1、R1-R2。
- `history-prompt-category-apply-investigation.md` 是調查，`history-prompt-category-apply-implementation.md` 是實作交付。
- `devtools/reports/README.md` 尚不存在。`readme-agents-documentation.md` 是另一任務文件，不能當 reports 索引。

## 7. A3 Phase 1 最終狀態

以下依目前工作區程式碼及報告整理；沒有獨立審查證據的項目不宣稱審查通過。

| 範圍 | 狀態 |
|---|---|
| A2 契約 | 定稿/補正鏈完成；R4-R1-R1 為最後補正，保留前版歷史。 |
| A3 UX | A3-R2 §1.4 最新；Phase 1–4 不代表全數實作。 |
| PromptEntry/PromptModel/Adapter | `prompt_core.js` 有完整 14 欄 PromptEntry、Legacy Adapter 與衍生 PromptModel。 |
| Prompt Composer | `PromptComposer.compose()` 負責 positive/negative 衍生與去重，輸出 entries/SnapshotEntry。 |
| Quality | 明確 whitelist；一般 `style` 類別不全視為品質詞；使用 quality setting。 |
| Negative | L1 `negativeRaw`/`text.neg` 原字串保留；L2 另產 parsed/effective/unparsed 結構，不回寫原始文字。 |
| LoRA Migration | `loraParseState()` / `loraSerialize()` + `lora_migration.js`；備份先寫且 verified 才可覆寫 `ui.loras`。 |
| Backup/Quarantine/Retry | BackupRecord、raw-json、`.corrupt`、pending retry reuse、指定 ID 確認；一般 save 保留 pending；不自動清理、不新增第三 key。 |
| M1–M8 | M1 缺欄補預設；M2 有效空保留；M3 壞欄/壞 adoption row quarantine；M4 相同欄位取 v2；M5 v2 順序優先、append v1 獨有詞並保存原件；M6 v2 空值勝出並備份舊詞、不注入；M7 v2-only 保留；M8 壞名/型別/非物件列/JSON損壞保全。R1-R2 將非物件列改用整包 raw-json 備份。 |
| History Restore | 只帶文字與完整還原分流/確認；missing、empty、populated LoRA 狀態有測試。 |
| Snapshot/生成 | `snapshotNow()` 用 Composer 的 `snapshotEntries`，採 `entryId` 不帶記憶體 `id`；同次 compose 結果供生成/歷史。 |
| R1-R2 review | [用戶提供] ChatGPT 獨立審查已通過 M8 非物件 raw-json 修正。五種 row 的原文及交易次序由測試報告證明。 |

## 8. 已執行測試與限制

[事實，依 `a3-phase1-implementation.md` 記錄；本輪沒有重新執行]：`prompt_core_test.mjs` 5 passed；`prompt_integration_contract_test.mjs` 通過；R1-R2 `lora_migration_test.mjs` 17 passed/0 failed；`history_reuse_test.mjs` 4 passed；`lora_core_test.mjs` 34 passed；`category_apply_test.mjs` 28/28；`category_apply_ui_test.mjs` 22 UI tests；語法檢查及 `git diff --check` 通過。五類非物件 row 各帶一筆有效 LoRA，驗證有效項目保留、原始 JSON 逐字備份、BackupRecord 驗證、備份先於來源覆寫、一般保存保留備份、備份失敗不改原文。

**不能稱全套 UI E2E 通過：** `lora_ui_test.mjs` 曾在 39 PASS 後於既有 Civitai Checkpoint recognition 等待逾時，該次 exit 1。Phase 1 報告也說明真實生成、正式使用者 localStorage/資料恢復未驗。以上未執行項目不列為通過；本輪未重跑測試。

## 9. 專案索引與下一輪摘要設計

### 建議索引：`devtools/reports/README.md`（只建議，本輪未建立）

精簡記結論與權威路徑，不複製長報告：

1. 進度/狀態日期；每次重查 Git，dirty tree 不當 clean baseline。
2. 權威入口：A2 R4-R1-R1、A3-R2 §1.4、A3 Phase 1 implementation report。
3. 已完成項目與驗收測試入口；結果與限制分開列。
4. 未解問題：Civitai UI timeout、真實生圖/使用者資料未驗、未決產品決策。
5. 下一步：把 A3-R2 Phase 2 清單與已完成 LoRA Explorer/Trigger Words/Civitai 功能逐項對照。
6. 歷史報告依 A2/A3/History/LoRA/Civitai/WD14/Open-source readiness 分組；每組列最新報告及修訂鏈，舊稿不刪。

### 下一輪可貼用交接摘要

> 繼續 `C:\ComfyUI\simple_ui` A3 Phase 1 收尾。先依 AGENTS 重查 Git/CodeGraph；不可假設工作樹乾淨。A2 契約入口 `devtools/reports/prompt-tag-system-a2-r4-r1-r1-final-contract-fixes.md`（保留前版演進），A3 UX 最新 `prompt-tag-system-a3-r2-ux-design.md` §1.4，實作/測試 `a3-phase1-implementation.md`。用戶表示 ChatGPT 已通過 R1-R2 M8 非物件 raw-json 修正；五種交易案例在報告中。`lora_ui_test.mjs` 不可稱全通：曾 39 PASS 後於既有 Civitai Checkpoint recognition timeout。不要移動/刪除歷史報告或資料；若開始 A3 Phase 2，先對照已完成 LoRA Explorer/Trigger Words 工作。破壞性操作需授權。

## 10. 安全清理方案（未執行）

### 可保留原位

| 路徑 | 依據 | 建議 | 風險 | 額外授權 |
|---|---|---|---|---|
| `prompt_core.js`、`lora_migration.js` | Runtime modules/載入路徑 | 原位保留、索引連結 | 搬動可能破壞 script 引用 | 保留不需；移動需 |
| `devtools/prompt_core_test.mjs`、`devtools/prompt_integration_contract_test.mjs`、`devtools/lora_migration_test.mjs`、`devtools/history_reuse_test.mjs` | 測試入口依路徑執行 | 原位保留 | 改名會破壞指令/自動化 | 保留不需；移動需 |
| A2 七份、A3 R1/R2、`a3-phase1-implementation.md` | 設計/契約/實作修訂證據 | 保留全文，索引標最新權威 | 刪舊稿失去修訂由來 | 保留不需；刪/移/合需 |
| History investigation/implementation 兩份 | 調查及交付互補 | 成對保留 | 合併會混淆事實與交付 | 保留不需；合併需 |
| `devtools/reports/amora-lora-ab-20261126/`、`devtools/reports/lora-ab-20261126/` | JSON/PNG 配套驗收證據 | 保持成組 | 刪除會失去重核資料 | 保留不需；刪/移需 |
| `devtools/reports/lora-*.md`、`amora-*.md`、`open-source-readiness-*.md`、`tag-learning-phase1.md`、`fix-local-wd14-and-output-directory.md`、`readme-agents-documentation.md` | 其他任務歷史/交付 | 原位保留，索引分 topic | 狀態可能 drift | 保留不需；整理需 |

### 建議納入索引

| 路徑 | 依據 | 建議 | 風險 | 額外授權 |
|---|---|---|---|---|
| `devtools/reports/a3-phase1-implementation.md` | Phase 1/R1/R1-R2 主報告 | A3 Phase 1 入口 | 要保留 timeout 限制 | 建索引不需；本輪未建 |
| `devtools/reports/prompt-tag-system-a2-r4-r1-r1-final-contract-fixes.md` | 最新契約補正 | Current A2 contract，連 R4/R3 | 單讀補正版可能缺模型背景 | 不需，舊版保留 |
| `devtools/reports/prompt-tag-system-a3-r2-ux-design.md` | §1.4 最新 UX | Current UX design | 區分設計與已實作 | 不需 |
| History implementation、Trigger Words R3、image preview Phase 2、open-source readiness Phase3R1-V-R | 各 topic 後續交付/修正入口 | Topic links 並連前版 | 需標示日期避免 drift | 不需 |

### 建議建立子目錄收納

[建議] 不搬動現有檔案。A/B artifacts 已分組；程式/測試有固定路徑；報告互相引用。先以索引降噪。本輪沒有具體 move path，因此未做引用遷移。未來如獲准搬檔，先全 repo 搜路徑引用並更新連結/指令。實際移動、合併、刪除需使用者授權。

### 疑似重複、需人工確認

| 路徑 | 依據 | 建議 | 風險 | 額外授權 |
|---|---|---|---|---|
| `lora-real-generation-ab-test.md`、`amora-lora-real-generation-ab-test.md` | 一般 vs Amora A/B | 互鏈；比 checkpoint/seed 範圍後再決定 | 合併會模糊適用範圍 | 比對不需；合併需 |
| `lora-personal-api-key-audit.md`、`lora-personal-api-key-and-application-audit.md` | 名稱近似但主題不同 | 逐節比對 | 可能丟安全/UX 證據 | 合併/改名需 |
| `open-source-readiness-phase2c.md`、`...phase2c-implementation.md` | 調查 vs 實作 | 成對互鏈，不合併 | 混淆設計與結果 | 保留不需；合併需 |
| 三份 Amora 3276795 報告 | 同版號，不同查核/安裝環節 | 按 chronology 互鏈 | 證據來源不可互替 | 保留不需；合併需 |

### 可能過時但必須保留歷史證據

| 路徑 | 依據 | 建議 | 風險 | 額外授權 |
|---|---|---|---|---|
| `prompt-tag-system-a2-*.md` | 每輪修正模型/契約 | 保留；索引標最新權威與 superseded 範圍 | 讀舊段會採過期規則 | 保留不需；刪除需 |
| A3-R1/R2 設計稿 | R2 §1.4 更新，但早期稿保留脈絡 | 保留並標最新節 | 誤讀舊設計 | 保留不需 |
| Trigger Words review、Open Source Phase3R、API Phase A/B review chains | 多輪 review/驗證 | 全鏈保留，索引突出最新 | 尾碼可能被誤當副本 | 保留不需；刪/移需 |
| History/LoRA Explorer/Prompt consolidation 調查稿 | 實作後調查描述可能舊，但保留決策與測量 | 標歷史調查並連後續交付 | 單讀會誤判現況 | 保留不需；刪除需 |

### 目前無法判定用途

沒有完全無法辨識用途的檔案。但 A/B 資料夾中 PNG/JSON 是否適合長期版控/公開分享需人工確認；確認前保留。實際移動/刪除需授權。

## 11. 結束狀態、影響及授權

[事實] 開始 17 modified/104 untracked/0 staged；結束原有修改全保留，新增本報告後 105 untracked/0 staged。Branch、HEAD、remote 未變，ahead 1/behind 0。沒有 Git 寫入、CodeGraph sync/index。正式服務未啟停，未操作 GPU、生圖、正式 localStorage、使用者圖片/模型。

待使用者授權：是否建立 `devtools/reports/README.md`；是否移動/合併/封存/刪除任何報告或測試資料；是否對 A/B artifact 設定長期版控/分享政策。若啟動 A3 下一階段，先做 Phase 2 規格與已有功能差異表。
