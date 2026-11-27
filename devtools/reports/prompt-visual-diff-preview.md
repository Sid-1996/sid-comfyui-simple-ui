# Prompt 來源與套用流程－視覺化差異預覽

日期：2026-11-28（Asia/Taipei）
Repository：`C:\ComfyUI\simple_ui`

## 1. 目標與完成範圍

為歷史正向套用、歷史完整狀態還原、Model B 分類套用及 WD14 候選加入補上確認前的視覺化結果。歷史 Positive 預覽直接使用待提交的資料；完整還原另標示 Negative、LoRA 的 replace/keep/clear 及生成設定保留；分類視窗列出 planner 最終標籤與補充描述；WD14 的 known/unknown/duplicate 預覽及提交共用一個純資料 planner。

沒有改 `prompt_core.js`、`tags.js`、`server.py`、歷史格式、Prompt Composer、WD14 後端或正式資料契約。未 stage、commit、push 或清理既有 Git 變更。

## 2. 開始時 Repository 與工作樹

依序閱讀 `C:\ComfyUI\AGENTS.md`、本 repo 的 `AGENTS.md`、A3-R2-R4 UX 設計、A3 Phase 1 實作報告、A2 最終契約修正報告、Prompt 來源 UX 研究／實作報告、歷史分類套用調查／實作報告，以及相關歷史、分類、WD14、Prompt Core 測試。根目錄 AGENTS 的路徑規則確認本 repo 是 `simple_ui`，未碰上游 ComfyUI repo。

| 項目 | 起始值 |
|---|---|
| Branch / HEAD | `main` / `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push） |
| Remote tracking | `main...origin/main [ahead 1]`（未 fetch） |
| `git status --short` | 18 個 tracked modified，無 staged；既有 untracked 清單如下 |
| `git diff --stat` | 18 files changed, 3910 insertions(+), 275 deletions(-) |
| `git diff --cached --stat` | 空 |

起始 tracked modified：`AGENTS.md`、`app.css`、`app.js`、`devtools/category_apply_test.mjs`、`devtools/category_apply_ui_test.mjs`、`devtools/lora_api_test.py`、`devtools/lora_core_test.mjs`、`devtools/lora_explorer_api_test.py`、`devtools/lora_explorer_core_test.mjs`、`devtools/lora_mock_civitai.py`、`devtools/lora_ui_test.mjs`、`devtools/test_ui_control_wd14.ps1`、`index.html`、`server.py`、`tags.js`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`。

起始既有 untracked：

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
devtools/reports/README.md
devtools/reports/a3-phase1-closeout-inventory.md
devtools/reports/a3-phase1-implementation.md
devtools/reports/a3-phase1-report-index.md
devtools/reports/amora-lora-ab-20261126/
devtools/reports/amora-lora-real-generation-ab-test.md
devtools/reports/amora-star-savior-download-install.md
devtools/reports/amora-star-savior-official-crosscheck.md
devtools/reports/amora-star-savior-version-3276795-audit.md
devtools/reports/fix-local-wd14-and-output-directory.md
devtools/reports/history-prompt-category-apply-investigation.md
devtools/reports/lora-ab-20261126/
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
devtools/reports/prompt-source-ux-implementation.md
devtools/reports/prompt-source-ux-research.md
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

CodeGraph 起始 `status`：35 files、1,094 nodes、4,837 edges；pending Added 11 / Modified 9。依 repo 指示以 `codegraph sync` 更新**衍生索引**後再查詢：索引為 46 files、1,589 nodes、7,072 edges，pending changes 清空。此索引更新不改 Git tracked/untracked 工作檔案；所有流程查詢基於同步後索引及磁碟原始碼。

## 3. 修改檔案與目的

| 檔案 | 本任務修改 |
|---|---|
| `app.js` | 共用歷史正向計畫與差異呈現；完整還原欄位差異；分類最終 Positive 預覽；WD14 純 planner 回傳預計補充描述文字，預覽與提交使用相同資料形狀 |
| `index.html` | WD14 modal 增加可存取的預覽容器 |
| `app.css` | 差異卡片、長文字捲動及窄視窗單欄樣式，沿用既有 token |
| `devtools/history_reuse_test.mjs` | 歷史預覽與提交資料相同、XSS escaping、Negative/LoRA 顯示與保護測試 |
| `devtools/category_apply_ui_test.mjs` | 驗證 planner 最終結果區與補充描述輸入即時更新 |
| `devtools/prompt_integration_contract_test.mjs` | 鎖定歷史及 WD14 共用 plan、WD14 不在 commit 重新拼接 |
| `devtools/wd14_preview_test.mjs` | 新增隔離 WD14 planner/UI stub 測試：known、unknown、duplicate、XSS、preview 不寫入及 commit 同源 |
| 本報告 | 記錄實作與驗證證據 |

沒有覆寫或整理其他既有修改。`app.js`、`app.css`、`index.html` 及多個測試原本已是 dirty；工作樹整體 diff 數字不能視為本任務的淨變更統計。

## 4. 各流程資料路徑與同源證據

### 歷史「套用正向提示詞」

`buildPositiveReusePlan(item)` 先走既有 `hasPositiveSnapshot()` 嚴格驗證，再建立歷史 `sel`/`extra` 提交目標、目前快照、目前補充描述及新增／移除／保留標籤清單。`positiveReusePreview(plan)` 只讀同一 plan。使用者確認時 `reuseTextPrompt()` 傳給 `Tags.restore()` 的仍是 `plan.sel`，並寫入 `plan.extra`。缺 `sel`/`extra`、型別錯誤或畸形標籤不會開啟提交；空陣列與空字串仍是明確有效內容。

### 歷史「還原已保存的提示詞狀態」

`buildReusePlan()` 使用同一個 `positive` 子計畫作為前後差異和提交的 Positive。Negative 預覽依 `negAction` 展示目前值與還原後值：字串欄位 replace（空字串 clear），缺欄或非字串 keep。LoRA 依 `loraAction` 展示目前/歷史名稱與 strength：陣列 replace、空陣列 clear、欄位缺失 keep。尺寸、步數、CFG、Seed、模型等標明保留。預覽不呼叫 LoRA 保存；`commitReuse()` 原有的 LoRA save/validation 仍先於 Positive/Negative 套用，失敗原子性測試仍通過。

### 分類套用

保留 `caPlanApply()` Model B、候選／分類勾選及預設行為。左右候選清單維持原樣，新增「分類套用後 Positive」直接呈現 `caCurrentPlan().nextSel` 和 `CA.extraMode`/`CA.extraText` 將提交的結果。切換分類/候選/補充描述模式會重新渲染 planner 結果；輸入補充文字時以 `textContent` 即時更新結果區。`caCommit()` 仍在最後確認時計算同一 planner，且僅一次 `Tags.restore(plan.nextSel)`；extra 寫入值就是預覽文字框目前值。

### WD14 反推

`rvBuildApplyPlan(picked, selected, posText, resolve)` 共用原 `rvSplitPicked()` 分流與 `rvMergePrompt()` 增量去重，回傳 known tag 列表、unknown tag 列表、duplicate 數量/名稱及最終 `extraText`/新增數。選取候選變動時 `rvUpdateApply()` 只呼叫此純 planner 並安全渲染；確認的 `rvApply()` 以同一 planner 建立分流結果，將 `toBottom` 傳入 `Tags.addTags()`，並直接寫入 `extraText`，不再自行重算 merge。Known alias 的 canonical 名稱已在底列時歸為略過，避免預覽聲稱新增但 `addTags()` 因去重不新增。

四種預覽都只使用安全 escaping / `textContent`；本任務沒有引入第二套 PromptModel、沒有解析組裝後 `prompt`，亦沒有把 preview state 寫入 localStorage。

## 5. 測試與語法檢查

以下每條命令均實際執行並 exit 0：

| 命令 | 結果 |
|---|---|
| `node devtools/history_reuse_test.mjs` | 15 項通過：歷史正向資料一致、相同權重保留、不同權重分列並顯示 old→new、新增／移除分類、commit 保持原權重、missing-field 防護、Negative/LoRA 欄位語意、LoRA save failure 原子性、escape |
| `node devtools/category_apply_test.mjs` | 28/28 通過：Model B、權重、排序、去重、分類與補充描述規則 |
| `node devtools/category_apply_ui_test.mjs` | 23 項通過：分類 UI/單次提交、差異結果與輸入同步、missing-field/XSS 回歸 |
| `node devtools/prompt_core_test.mjs` | 5 項通過：Canonical PromptModel/Composer 回歸 |
| `node devtools/prompt_integration_contract_test.mjs` | 通過：生成 Composer 次數、資料契約、歷史和 WD14 共用計畫契約 |
| `node devtools/wd14_preview_test.mjs` | 3 項通過：known/unknown/duplicate 分類、安全渲染、duplicate-only 無變更狀態、預覽不寫入、commit 使用 planner 結果 |
| `node --check app.js` | exit 0 |
| `git diff --check` | exit 0；Git 顯示既有 LF→CRLF 行尾提示，無 whitespace error |

未執行真實瀏覽器測試，亦未啟動獨立服務作瀏覽器驗收；分類 UI 與 WD14 預覽以現有 DOM stub 和隔離 planner 測試覆蓋。依禁止事項未執行正式 WD14、ComfyUI、Simple UI、Worker、GPU 生圖或 E2E；`server.py`、模型及使用者 localStorage 未觸碰。

## 6. 最終 Git 狀態與影響

結束時 branch/HEAD/remote 仍是起始值；無 staged 變更。既有 18 個 tracked modified 與起始相同；新增本任務的 untracked `devtools/wd14_preview_test.mjs`、`devtools/reports/prompt-visual-diff-preview.md` 兩個路徑。其他原有 untracked 全保留。結束 `git diff --stat`：18 files changed, 4046 insertions(+), 289 deletions(-)；這是含起始 dirty files 的總差異，不代表本次淨差異。`git diff --cached --stat` 仍為空。最終 `git diff --check` exit 0。

正式 Simple UI、ComfyUI、WD14 Worker、模型、設定、圖片、localStorage 均未讀寫或啟停；本次只跑本機 Node 測試。沒有 Git stage、commit、push、reset、restore、stash、checkout 或 clean。

## 7. 未解決事項與審查建議

- 沒有真實瀏覽器視覺驗收；modal 的狹窄 viewport、高度和長列表可用性尚未實測。樣式限制了 `<pre>`/清單高度並允許 modal 內捲動，仍建議獨立 UI 環境檢視。
- 分類與 WD14 的 commit 會在確認時再次呼叫同一純 planner，而非長期保存預覽結果物件；依需求允許的共用純資料 planner 模式，且避免 preview 時保留可變狀態。WD14 modal 阻擋同頁編輯；若跨分頁修改當前標籤列，確認時按最新目前狀態重新計畫，預覽初始狀態可能因此不同。
- LoRA 持久化先行原子保護是既有流程；瀏覽器 localStorage quota/寫入行為未在正式環境驗證。
- 請審查 `app.js` 的 `buildPositiveReusePlan()` / `positiveReusePreview()`、`reusePrompt()`、`caRender()` 最終 Positive 區塊、`rvBuildApplyPlan()` / `rvUpdateApply()` / `rvApply()`；尤其確認長內容預覽密度及 canonical alias 略過數量符合預期。

## 8. 審查修正：明確呈現歷史 Positive 權重變更（2026-11-28）

修正 `buildPositiveReusePlan()`：新增 `currentByKey` 比對相同 normalized tag，計算 `weightChanges`。存在性仍只由 tag key 決定，故新增／移除判斷不受權重影響；同 key 權重相同才列入 `retained`，同 key 權重不同改列入獨立「權重變更」清單，顯示 `tag：舊值 → 套用後值`（例：`blue eyes：1.0 → 1.2`）。差異計算不改 `sel` 或 `extra`，確認仍把原始 `plan.sel` 傳給 `Tags.restore()`。

權重比較遵循現有 `caWeight()` 語意：`Number(entry.w)` 為有限正數時採該值；缺失、非數值、零或負值一律用預設 `1`。前後 Positive 完整預覽依同一預設顯示實際標籤內容；權重數字按目前標籤列的顯示精度呈現一位小數。只動用歷史 Positive 預覽所需的 `app.js`，及讓差異列容納四類結果的 `app.css`；分類套用與 WD14 未變。

新增／加強 `history_reuse_test.mjs` 案例：normalized 同權重保留（含預設權重）、不同權重單獨分類並呈現舊新值、單純新增、單純移除、確認後 commit 仍收到原始新權重，以及既有 XSS escaping。這次指定回歸矩陣實際結果：history reuse 15 項、category planner 28/28、category UI 23 項、Prompt Core 5 項、Prompt integration contract 通過、WD14 isolated preview 3 項；`node --check app.js` 和最終 `git diff --check` 均 exit 0。沒有跑服務、瀏覽器、WD14 E2E 或 GPU 測試。

此審查修正延續起始 dirty worktree；`main` / HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、remote 不變，無 staged 變更，未做 Git 收尾。
