# Prompt 來源與套用流程 UX 優化實作

日期：2026-11-27（Asia/Taipei）
Repo：`C:\ComfyUI\simple_ui`
性質：依產品確認操作定義修正歷史圖片與 WD14 操作 UX；不改 A3 資料模型。

## 1. 目標與執行範圍

讓使用者清楚辨認目前提示詞是目標、歷史圖片／WD14 是來源，以及操作會替換或追加哪些欄位。完成歷史正向套用、已保存提示詞狀態還原、分類替換與 WD14 文案調整，並保護缺欄位的舊歷史資料。新增/更新隔離測試與本報告。

未修改 `prompt_core.js`、`tags.js`、`server.py`、A3 序列化契約或任何正式設定；未讀寫正式 localStorage／歷史圖片，未啟停服務、Worker 或 ComfyUI，未生成圖片、未執行 WD14 實際反推，未使用 GPU，未 stage/commit/push。CodeGraph pending changes 未同步。

## 2. 開始前 Repository 與 Git 狀態

- Repository：`C:\ComfyUI\simple_ui`（根 AGENTS 指定之本專案 repo）
- Branch：`main`
- HEAD：`cf5609e0cfbd69163247786f1f50dbf8e600c090`
- Remote：`origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push）
- `git status -sb`：`main...origin/main [ahead 1]`；本次未 fetch，未確認遠端是否有新提交。
- 開始前 staged：0；tracked modified：17 個既有檔案；untracked：108 個既有路徑（完整清單見下）。既有修改與報告均保留。
- 開始前 tracked modified：`AGENTS.md`、`app.css`、`app.js`、`devtools/category_apply_test.mjs`、`devtools/lora_api_test.py`、`devtools/lora_core_test.mjs`、`devtools/lora_explorer_api_test.py`、`devtools/lora_explorer_core_test.mjs`、`devtools/lora_mock_civitai.py`、`devtools/lora_ui_test.mjs`、`devtools/test_ui_control_wd14.ps1`、`index.html`、`server.py`、`tags.js`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`。
- CodeGraph 起始：35 files、1,094 nodes、4,837 edges；pending Added 11 / Modified 8。依唯讀/索引保護要求未 sync/index。結束 pending Added 11 / Modified 9（本任務新增/更新測試程式仍使索引有差異）。

### 開始前 untracked 路徑清單

- `comfy_lora_paths.py`
- `devtools/comfy_lora_paths_test.py`
- `devtools/history_reuse_test.mjs`
- `devtools/lora_migration_test.mjs`
- `devtools/lora_personal_key_test.py`
- `devtools/lora_personal_key_ui_test.mjs`
- `devtools/lora_trigger_words_ui_test.mjs`
- `devtools/prompt_core_test.mjs`
- `devtools/prompt_integration_contract_test.mjs`
- `devtools/reports/README.md`
- `devtools/reports/a3-phase1-closeout-inventory.md`
- `devtools/reports/a3-phase1-implementation.md`
- `devtools/reports/a3-phase1-report-index.md`
- `devtools/reports/amora-lora-ab-20261126/compare_A_B_C_D.json`
- `devtools/reports/amora-lora-ab-20261126/compare_C_W06_W08_W10.json`
- `devtools/reports/amora-lora-ab-20261126/history_A.json`
- `devtools/reports/amora-lora-ab-20261126/history_B.json`
- `devtools/reports/amora-lora-ab-20261126/history_C.json`
- `devtools/reports/amora-lora-ab-20261126/history_D.json`
- `devtools/reports/amora-lora-ab-20261126/history_W06.json`
- `devtools/reports/amora-lora-ab-20261126/history_W08.json`
- `devtools/reports/amora-lora-ab-20261126/history_W10.json`
- `devtools/reports/amora-lora-ab-20261126/image_A.png`
- `devtools/reports/amora-lora-ab-20261126/image_B.png`
- `devtools/reports/amora-lora-ab-20261126/image_C.png`
- `devtools/reports/amora-lora-ab-20261126/image_D.png`
- `devtools/reports/amora-lora-ab-20261126/image_W06.png`
- `devtools/reports/amora-lora-ab-20261126/image_W08.png`
- `devtools/reports/amora-lora-ab-20261126/image_W10.png`
- `devtools/reports/amora-lora-ab-20261126/summary_round1.json`
- `devtools/reports/amora-lora-ab-20261126/summary_round2.json`
- `devtools/reports/amora-lora-ab-20261126/verification.json`
- `devtools/reports/amora-lora-ab-20261126/workflow_A.json`
- `devtools/reports/amora-lora-ab-20261126/workflow_B.json`
- `devtools/reports/amora-lora-ab-20261126/workflow_C.json`
- `devtools/reports/amora-lora-ab-20261126/workflow_D.json`
- `devtools/reports/amora-lora-ab-20261126/workflow_W06.json`
- `devtools/reports/amora-lora-ab-20261126/workflow_W08.json`
- `devtools/reports/amora-lora-ab-20261126/workflow_W10.json`
- `devtools/reports/amora-lora-real-generation-ab-test.md`
- `devtools/reports/amora-star-savior-download-install.md`
- `devtools/reports/amora-star-savior-official-crosscheck.md`
- `devtools/reports/amora-star-savior-version-3276795-audit.md`
- `devtools/reports/fix-local-wd14-and-output-directory.md`
- `devtools/reports/history-prompt-category-apply-investigation.md`
- `devtools/reports/lora-ab-20261126/compare.json`
- `devtools/reports/lora-ab-20261126/history_A.json`
- `devtools/reports/lora-ab-20261126/history_B.json`
- `devtools/reports/lora-ab-20261126/image_A.png`
- `devtools/reports/lora-ab-20261126/image_B.png`
- `devtools/reports/lora-ab-20261126/run_summary.json`
- `devtools/reports/lora-ab-20261126/workflow_A.json`
- `devtools/reports/lora-ab-20261126/workflow_B.json`
- `devtools/reports/lora-civitai-author-suggestions-ux.md`
- `devtools/reports/lora-explorer-real-world-audit.md`
- `devtools/reports/lora-image-preview-phase2.md`
- `devtools/reports/lora-image-preview-research.md`
- `devtools/reports/lora-image-preview-s0.md`
- `devtools/reports/lora-oauth-s1-design.md`
- `devtools/reports/lora-personal-api-key-and-application-audit.md`
- `devtools/reports/lora-personal-api-key-audit.md`
- `devtools/reports/lora-personal-api-key-design-review.md`
- `devtools/reports/lora-personal-api-key-phase-a-r1.md`
- `devtools/reports/lora-personal-api-key-phase-a-r1a.md`
- `devtools/reports/lora-personal-api-key-phase-a.md`
- `devtools/reports/lora-personal-api-key-phase-b-audit-r1.md`
- `devtools/reports/lora-personal-api-key-phase-b-audit-r2.md`
- `devtools/reports/lora-personal-api-key-phase-b-audit.md`
- `devtools/reports/lora-personal-api-key-phase-b-implementation-spec.md`
- `devtools/reports/lora-personal-api-key-phase-b1-implementation.md`
- `devtools/reports/lora-personal-api-key-phase-b1-review-r1.md`
- `devtools/reports/lora-personal-api-key-phase-b1-review-r2-regex-fix.md`
- `devtools/reports/lora-personal-api-key-phase-b1-review-r2.md`
- `devtools/reports/lora-real-generation-ab-test.md`
- `devtools/reports/lora-trigger-words-a1-audit.md`
- `devtools/reports/lora-trigger-words-ux-audit.md`
- `devtools/reports/lora-trigger-words-ux-phase2-review-fixes-r2.md`
- `devtools/reports/lora-trigger-words-ux-phase2-review-fixes-r3.md`
- `devtools/reports/lora-trigger-words-ux-phase2-review-fixes.md`
- `devtools/reports/lora-trigger-words-ux-phase2.md`
- `devtools/reports/open-source-readiness-phase1.md`
- `devtools/reports/open-source-readiness-phase2a.md`
- `devtools/reports/open-source-readiness-phase2b1.md`
- `devtools/reports/open-source-readiness-phase2b2.md`
- `devtools/reports/open-source-readiness-phase2b3.md`
- `devtools/reports/open-source-readiness-phase2c-implementation.md`
- `devtools/reports/open-source-readiness-phase2c.md`
- `devtools/reports/open-source-readiness-phase3.md`
- `devtools/reports/open-source-readiness-phase3r1.md`
- `devtools/reports/open-source-readiness-phase3r1r.md`
- `devtools/reports/open-source-readiness-phase3r1v.md`
- `devtools/reports/open-source-readiness-phase3r1vr.md`
- `devtools/reports/prompt-source-ux-research.md`
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
- `devtools/reports/readme-agents-documentation.md`
- `devtools/test_ui_control_process.ps1`
- `devtools/test_ui_panel_reporting.py`
- `lora_migration.js`
- `prompt_core.js`

## 3. 修改檔案與目的

本任務實際編輯的路徑：

- `app.js`：驗證歷史 canonical Positive 資料；正向套用改為有確認的正向限定操作；完整還原範圍文案與欄位摘要；分類替換來源／目標與文字缺欄位保護；WD14 加入目標文案。
- `index.html`：歷史燈箱操作名稱、分類替換名稱、WD14 來源/候選/目標與加入效果提示。
- `app.css`：限制結果卡片操作按鈕區寬度並允許換行，避免精確標籤造成溢出。
- `devtools/history_reuse_test.mjs`：以獨立 VM / localStorage stub 覆蓋歷史操作及欄位缺失／空值／失敗情境。
- `devtools/category_apply_test.mjs`：更新歷史操作契約斷言。
- `devtools/category_apply_ui_test.mjs`：更新方向和文字選項斷言；新增缺 sel/extra 保護測試。
- `devtools/lora_ui_test.mjs`：歷史正向套用流程加上確認步驟（未連正式 UI 執行）。
- `devtools/prompt_integration_contract_test.mjs`：新增 WD14 來源/目標/增量語意與分流契約斷言。
- `devtools/reports/prompt-source-ux-implementation.md`：本交付報告。

上述檔案中有不少在開始前已是使用者修改或 untracked；變更只限本任務的相關區塊，沒有清理或覆寫其他內容。

## 4.「套用正向提示詞」最終行為

- 入口改名為「套用正向提示詞」。在執行前確認：「將這張歷史圖片的正向標籤與補充描述套用到目前提示詞；目前 Negative、LoRA 與生成設定不會改變。」並標示來源歷史圖片、目標目前提示詞。
- 確認後以歷史 `sel` 取代目前標籤、歷史 `extra` 取代目前補充描述，保存至既有 `sel` / `ui.extra` 路徑；不讀取歷史 `neg`，不動 LoRA 和生成設定。
- `hasPositiveSnapshot()` 要求 `sel` 欄位存在且為陣列（每筆為含字串 `t` 的物件），`extra` 欄位存在且為字串。空陣列與空字串是有效的明確空值；缺欄位、型態錯誤或畸形項目會停用相應入口並拒絕提交，不以空值覆蓋目前內容，也不反解析 `prompt`。
- 套用前先呼叫 `Tags.restore()`；若拋錯，不寫入補充描述，提示目前提示詞沒有變更。歷史來源物件不修改。

## 5.「還原已保存的提示詞狀態」最終行為

- 原「完整還原（含角色）」改為「還原已保存的提示詞狀態」。確認頁標明來源及目標，並列出 Positive、Negative、LoRA 及被保留的生成設定。
- `sel`/`extra` 先通過相同完整性驗證；否則確認按鈕 disabled，不能提交。
- `sel`/`extra` 取代目前 Positive。`neg` 欄位存在且為字串時套用（空字串會清空）；欄位不存在或不是字串時保留目前 Negative。`loras` 為陣列時先依既有 `LoraMigration.saveState()` 持久化並驗證，再修改其他提示詞狀態；`[]` 清空 LoRA，有內容時替換；欄位不存在或不是陣列則保留目前 LoRA。
- LoRA 保存失敗會提前退出，Positive、Negative、目前 LoRA 記憶體都不改。尺寸、步數、CFG、Seed、Checkpoint/模型和其他生成設定皆保留。
- 成功訊息改成只宣稱還原已保存提示詞狀態，避免暗示生成設定也恢復。

## 6. 分類替換 Model B

保持現有 `caPlanApply()`、候選辨識、分類、權重、排序、去重、預覽與 commit 規則，沒有改 planner。

UI 顯示：「基底：歷史圖片；替換來源：目前提示詞；寫入目標：目前提示詞」。已選分類以目前同分類內容替換歷史內容；未選分類保留歷史內容。兩欄差異預覽保留。

補充描述 keep/replace/merge 明確標為獨立選項並標示文字來源。若歷史缺 `sel`，不開啟分類替換；若缺 `extra` 或型態錯誤，replace/merge 選項 disabled，事件層也拒絕切換，keep 仍可用。這防止舊資料缺欄位被默認成空文字而清除目前補充描述。

## 7. WD14 增量加入

保留圖片分析→候選→人工勾選/取消→加入流程與 known/unknown 分流、重複略過規則。UI 明示來源圖片、WD14 候選、目標目前提示詞、加入而非替換、既有內容保留及重複項略過。按鈕及成功提示改成「加入目前提示詞」。不改 rating、候選分類或保存位置。

## 8. 測試與語法檢查

成功：

- `node devtools/history_reuse_test.mjs`：9 項通過，包含歷史 Negative 非空／空／缺欄位皆保留、Positive 覆寫、LoRA/設定/歷史不變、缺 sel/extra 防覆寫、Tag restore 失敗保護、完整還原 optional 欄位語意與 LoRA 保存失敗原子保護。
- `node devtools/category_apply_test.mjs`：28/28 通過，Model B、候選例外、權重、排序、去重與 Extra 流程不變。
- `node devtools/category_apply_ui_test.mjs`：23 UI 項通過，含 Model B 方向與舊欄位安全處理。
- `node devtools/prompt_core_test.mjs`：5 項通過。
- `node devtools/prompt_integration_contract_test.mjs`：通過。
- `node --check` 通過：`app.js`、`history_reuse_test.mjs`、`category_apply_test.mjs`、`category_apply_ui_test.mjs`、`lora_ui_test.mjs`、`prompt_core_test.mjs`、`prompt_integration_contract_test.mjs`。
- `git diff --check` 通過；只看到既有 CRLF 行尾轉換提示，沒有 whitespace error。

未執行：

- `devtools/lora_ui_test.mjs` 真正 headless 執行：需要獨立 7861/18188/18189 測試服務；目前未啟動。其語法檢查通過。
- WD14 UI / API 測試：既有腳本預設連 7860 並會寫入既有 `devtools/wd14_review` 測試圖/報告；查到 7860 正由 PID 2696 監聽，因此不執行，以免操作正式服務或覆蓋既有測試輸出。WD14 UX 以隔離整合契約測試檢查。
- 真實瀏覽器、生成、WD14 Worker、ComfyUI/GPU 測試：依限制不做。沒有 Python 檔案修改，故未跑 py_compile。

## 9. Git 最終狀態與正式服務

- 最終仍為 `main` / HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`；`origin/main` 相對狀態仍顯示 ahead 1（未 fetch）。
- 最終 staged 0、tracked modified 18、untracked 109（原有路徑均保留，新增本報告一個路徑）。多出的 tracked modified 是本任務更新的 `category_apply_ui_test.mjs`；其他修改檔多為原有工作。
- 無 stage、commit、push、reset、restore、stash、checkout 或 clean。
- 正式 Simple UI / ComfyUI / WD14 Worker 未啟停、未連線呼叫；僅以唯讀方式確認 7860 正在監聽。正式服務未受本次操作影響。

## 10. 尚存限制與風險

- 真實瀏覽器排版與完整事件流程未驗收；結果卡按鈕文字變長，雖加換行限制，仍需隔離 UI 瀏覽器確認窄尺寸及 lightbox 操作列。
- `Tags.restore()` 是既有持久化入口；本次先驗資料並在補充文字寫入前呼叫它，但瀏覽器儲存空間錯誤或其內部副作用無法由現有 API 交易回滾。正式資料未測。
- 老紀錄只有 `prompt`、缺 `sel` 或 `extra` 時目前不解析重建；操作被阻止，保護現有資料但無法重用那筆歷史提示詞。
- WD14 真實 UI 端到端測試需另開獨立隔離服務/輸出路徑後再執行。

## 11. 請 ChatGPT 特別審查

1. 正向套用新增確認步驟是否合適，及 `sel`/`extra` 嚴格欄位驗證是否涵蓋可接受的舊紀錄格式。
2. 完整還原提示中 `loras` 有內容的顯示、空 LoRA 清空語意與生成設定保留清單是否清楚。
3. 分類套用 `extra` 缺失時只禁用 replace/merge、保留 tag Model B 的策略是否合適。
4. WD14 成功訊息的「加入目前提示詞」是否能涵蓋 known tag 加到標籤列、unknown tag 加到補充描述這兩種實際落點。
5. 隔離真實 UI 回歸所需服務是否可用 7861/18188/18189 啟動，並避免寫入 `wd14_review` 既有測試輸出。
