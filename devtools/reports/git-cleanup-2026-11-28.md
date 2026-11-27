# Git 工作樹整理與 Commit／Push 報告

日期：2026-11-28
Repository：`C:\\ComfyUI\\simple_ui`
Remote：`origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`

---

## 1. 任務目標與授權

使用者明確授權：整理完成後可分批建立本機 Commit，並 Push 至 `origin`。
本次目標是把累積的跨任務修改按功能邊界提交，保留個人 A/B 生圖資料，不改寫既有 Commit 歷史，不使用 Force Push。

## 2. 開始前狀態

- Branch：`main`
- HEAD：`cf5609e0cfbd69163247786f1f50dbf8e600c090`
- Remote：`origin`
- 開始時相對 origin：Ahead 1 / Behind 0
- Staged：0
- Tracked modified：18 個檔案
- 未追蹤內容包含歷史 Markdown 報告，以及 A/B 生圖 JSON／PNG 原始資料。
- `codegraph status` 開工前確認索引最新。
- 未發現 Git lock file。

執行期間再次 `git fetch origin`，確認 `origin/main...HEAD` 為 `0 4`；遠端沒有新提交需要整合。

## 3. Commit 分組

### 3.1 Civitai 後端與 LoRA 路徑檢查

Commit：`c49a6d2ce85bf1a581dff0e2e33a8b73aeb570fe`
訊息：`feat: harden Civitai integration and LoRA path inspection`

7 個檔案，新增 3,120 行、刪除 11 行。內容包括：
- Civitai Personal API Key 的 Windows DPAPI 保護、同源請求防護、錯誤處理及禁止帶 Bearer 跟隨 Redirect。
- Civitai 版本 metadata 快取競態保護、圖片 URL 白名單與成熟內容欄位正規化。
- `comfy_lora_paths.py` 唯讀解析模組及隔離測試。
- API、個人金鑰、LoRA 路徑測試與 Civitai mock。

### 3.2 Prompt Composer 與 LoRA UX 整合

Commit：`2b94cfcba04227a5699c45f19c8cba229aa930db`
訊息：`feat: unify prompt composition and LoRA UX workflows`

18 個檔案，新增 3,747 行、刪除 202 行。內容包括：
- A3 Prompt Composer、PromptModel 與品質詞篩選。
- LoRA localStorage v1→v2 遷移與原始資料備份驗證。
- 歷史提示詞套用／完整狀態還原、分類套用、WD14 增量套用差異預覽。
- LoRA 作者建議詞、Civitai Explorer／圖片預覽及 Personal API Key UI。
- 對應單元、契約與隔離瀏覽器 E2E 測試。

### 3.3 桌面服務生命週期安全

Commit：`ac93a715cc10b0bc81f572131439376b9fec45e6`
訊息：`fix: harden desktop service lifecycle controls`

6 個檔案，新增 936 行、刪除 76 行。內容包括：
- ComfyUI／Simple UI 程序與 Port 所有者辨識。
- Start／Stop／Restart 的外部程序保護、停止結果驗證及錯誤回報。
- WD14 環境注入與還原測試。
- tkinter／WinForms 控制台失敗訊息與狀態刷新測試。

獨立審查時發現舊版 `Test-IsManagedServer` 以命令列子字串判斷，可能把「只把本專案 server.py 路徑當參數」的其他 Python 程序誤認為本專案。已收緊為解析 Python 真正的 Script entry，且必須是本專案 server.py 絕對路徑；相對路徑因無法由 WMI 證明 CWD，保守列為 Foreign。新增兩個反例測試後通過。

### 3.4 文件與歷史報告

文件 Commit：`aa1ccc8d1ea173a18ce0a9e7cb90f9c4566b5310`
訊息：`docs: index project development reports`

共 65 個檔案，新增 21,921 行，收納：
- `AGENTS.md` 的瀏覽器工具路由及驗收注意事項。
- `devtools/reports/README.md` 報告索引。
- 本次整理前累積的 63 份 Markdown 報告。
- 本次 Git 整理報告。

`devtools/reports/README.md` 已補充說明：A/B 生圖資料夾內的 PNG、Workflow 與 History JSON 是本機個人測試資料，刻意不納入 Git。

## 4. 測試與驗收

### 4.1 自動化測試

19 個測試套件均通過，涵蓋：
- Prompt Composer、整合契約、LoRA 遷移。
- 歷史提示詞、分類套用、WD14 預覽。
- LoRA 核心、作者觸發詞、Explorer、Personal API Key UI。
- LoRA API、Explorer API、Personal API Key、ComfyUI LoRA 路徑。
- LoRA 完整 UI E2E。
- 桌面程序辨識／Start／Stop／Restart、WD14 啟動環境及控制台回報。

LoRA UI E2E 使用隔離 Simple UI（7861）、Mock ComfyUI（18188）、Mock Civitai（18189）與獨立 Headless Chrome profile；**79 UI tests passed**。測試後三個 Port 均確認釋放，暫存環境清除。

桌面程序測試在補強反例後為：
- `test_ui_control_process.ps1`：43 PASS / 0 FAIL
- `test_ui_control_wd14.ps1`：16 PASS / 0 FAIL
- `test_ui_panel_reporting.py`：9 tests passed

### 4.2 語法與 Diff

- `node --check`：26 個 JavaScript／MJS 檔案通過。
- `python -m py_compile`：14 個 Python 檔案通過。
- `git diff --check`：通過。
- 各分組建立 Commit 前均執行 `git diff --cached --check`，通過。

### 4.3 測試環境邊界

- 沒有啟動、停止或重啟正式 Simple UI／ComfyUI。
- 正式 Port 7860、8188 在檢查時均為 FREE。
- 沒有 GPU 生圖、沒有下載模型、沒有呼叫真實 Civitai API。
- Personal API Key 測試使用假金鑰、暫存資料目錄與本機 Mock。
- 沒有讀取或輸出使用者實際 API Key。

## 5. 保留、不提交的本機資料

以下 A/B 原始資料刻意保留為未追蹤檔案，沒有刪除、搬移或覆蓋：
- `devtools/reports/lora-ab-20261126/`
- `devtools/reports/amora-lora-ab-20261126/`

合計包含 25 個 JSON 與 9 張 PNG。它們可能含個人生成 Prompt、Workflow、History 與生成圖片，因此不納入公開 Git。

## 6. Git 操作限制

- 沒有 Reset、Restore、Stash、Checkout、Clean。
- 沒有 Stage 非本次分組以外的檔案。
- 沒有修改或重寫既有 Commit。
- 沒有使用 Force Push。
- Commit 分組以後端、前端整合、桌面控制及文件報告區分。

## 7. 最終結果

- 文件報告 Commit：`aa1ccc8d1ea173a18ce0a9e7cb90f9c4566b5310`。
- 一般 `git push origin main` 已成功，遠端回報 `da2112b..aa1ccc8 main -> main`。
- Push 後再次 Fetch，`HEAD` 與 `origin/main` 均為 `aa1ccc8d1ea173a18ce0a9e7cb90f9c4566b5310`，Ahead / Behind 為 `0 / 0`。
- 追蹤檔案無修改、無 staged 內容；唯一未追蹤項目是兩個 A/B 原始資料目錄，合計 25 個 JSON 與 9 張 PNG，均完整保留。
- 本報告在首次 Push 後補記實際 Commit／同步結果；本次報告修訂會再以獨立文件 Commit 提交並同步，避免報告停留在預計狀態。
