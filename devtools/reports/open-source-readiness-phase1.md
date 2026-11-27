# Open Source Readiness — Phase 1：開源專案可用性唯讀盤點

> 性質：**唯讀調查**。本次未修改任何既有檔案、未安裝/下載依賴、未啟動或停止正式服務、未執行生圖、未執行 git 寫入操作。
> 唯一新增檔案：本報告 `devtools/reports/open-source-readiness-phase1.md`。
> 調查日期：2026-11-23。所有行號以本機工作區 `C:\ComfyUI\simple_ui`（HEAD `c229186…`）為準。

---

## 1. 調查摘要

### 1.1 目前開源可用性評級

| 面向 | 評級 | 說明 |
|---|---|---|
| 專案用途理解 | **尚可** | README 前 16 行能讓人懂「這是包在 ComfyUI 外的單頁生圖 UI」 |
| 從零安裝部署 | **不合格** | 沒有安裝流程、沒有依賴清單、沒有從 clone 到可跑的腳本 |
| 文件自洽性 | **不合格** | README 指向不存在的 `AGENTS.md`；路徑/模型說法與程式碼有落差 |
| 陌生人可獨立使用 | **不合格（需既有開發環境）** | 目前只有在「已照開發者路徑裝好 ComfyUI + 模型 + 外部工具」時才會動 |
| Coding Agent 自主部署 | **不合格** | 關鍵知識在 repo 外，Agent 拿公開 repo 無法補齊 |

**綜合結論：目前是「可讀的個人專案」，還不是「可部署的開源專案」。**

### 1.2 陌生使用者能否完成部署？

- **否**（除非他的環境恰好與開發者完全一致，且已有 ComfyUI portable、模型、WD14 工具）。
- 公開 repo 內沒有任何「從零開始」的步驟；README 的「怎麼跑」只有 3 行，且第一步就依賴桌面捷徑 `生圖控制台.lnk`（`README.md:27`），該捷徑不在 repo 內、也沒有產生腳本。

### 1.3 Coding Agent 能否自主部署？

- **否。** 詳細矩陣見第 6 節。
- agent 只拿公開 repo 會立刻卡在：README 叫它「見根目錄 AGENTS.md」，但該檔在公開 repo 中不存在（本機實際位置是 `C:\ComfyUI\AGENTS.md`，在 repo 上一層、未進版控）。

### 1.4 最重要的五個阻礙

1. **P0 — 文件指向不存在的檔案**：`README.md:16`「需另裝工具，見根目錄 AGENTS.md」；公開 repo 根目錄沒有 `AGENTS.md`（git 內搜尋為空，GitHub raw URL 回 404）。
2. **P0 — 外部 Worker / venv / 模型全部在 repo 外**：`server.py:46-51` 的 WD14 EVA02 與 ViT v3 路徑都指向 `C:\ComfyUI\tools\...`，公開 repo 完全沒有這些原始碼、環境或模型，也沒有建立腳本。
3. **P0 — 硬編碼絕對路徑散落多檔且無設定檔**：`server.py:28-32`、`ui_control.ps1:13-16`、`ui_panel.pyw:15-16`、`gen_assets.py:14,17`、`devtools/README.md:16,19-22`；README 只說「請依你的環境修改」（`README.md:58`），沒有列出完整清單。
4. **P0 — 沒有依賴清單與安裝流程**：repo 沒有 `requirements.txt` / `pyproject.toml` / 任何 install/setup 腳本；系統 Python 3.13 + tkinter、ComfyUI portable、模型下載都沒有可執行的安裝指引。
5. **P1 — 沒有版本／更新／解除安裝／備份說明**：GitHub releases 為空陣列，README 沒有 CHANGELOG、更新步驟或資料保留指引。

---

## 2. Repository 現況

### 2.1 Git 基本資訊（事實）

| 項目 | 值 | 來源 |
|---|---|---|
| 本機路徑 | `C:\ComfyUI\simple_ui` | `Test-Path` |
| 分支 | `main` | `git branch --show-current` |
| HEAD | `c2291861ee14e536a994dbe4f9456676a3e19eb0` | `git rev-parse HEAD` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` | `git remote -v` |
| 與 `origin/main` 差距 | `0 0`（ahead 0 / behind 0） | `git rev-list --left-right --count HEAD...origin/main` |
| 工作區 | 乾淨（`git status --porcelain` 無輸出） | 同上 |
| 最近提交 | `c229186 feat: improve tag library UX and add personal tag stats`（2026-11-23） | `git log -5` |

**比對公開版本**：
- 未執行 `git fetch`（避免任何 git 寫入）；比較依據為本機 `origin/main` tracking ref + GitHub API + raw 檔案。
- `https://raw.githubusercontent.com/Sid-1996/sid-comfyui-simple-ui/main/README.md` 與本機 `README.md` 內容一致。
- GitHub API：公開 repo、default branch `main`、description「Sid 的 ComfyUI 簡易生圖介面：單頁標籤式前端，一鍵生成，無 build step」、license `NOASSERTION`、0 stars / 0 forks / 0 open issues、issues 啟用、discussions 關閉、wiki 啟用、releases `[]`。
- **未逐 blob 驗證整個 tree**；此為「未確認」項目，但 README 一致 + ahead/behind 0 強烈支持本機即公開 main。

### 2.2 文件與原始碼結構（事實）

公開 repo 內與部署/文件相關的檔案：

| 檔案 | 角色 |
|---|---|
| `README.md`（72 行） | 唯一的使用者入門文件 |
| `AGENTS.md` | **不存在**（本機上一層 `C:\ComfyUI\AGENTS.md` 才是，未進版控） |
| `LICENSE`（Fair AI Public License 1.0-SD） | 授權條款；GitHub 辨識為 `NOASSERTION` |
| `SECURITY.md` | 安全回報窗口，30 天回覆 |
| `.gitignore` | 排除 `__pycache__/`、`.codegraph/`、輸出、devtools 截圖 |
| `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.yml`、`PULL_REQUEST_TEMPLATE.md` | issue / PR 模板 |
| `.github/workflows/ci.yml` | 僅做 `node --check` 與 `python -m py_compile`（Node 20 / Python 3.11） |
| `devtools/README.md` | 驗收工具說明，含多處絕對路徑 |

**原始碼入口**：
- 後端：`server.py`（807 行，Python 標準庫，綁 `127.0.0.1:7860`）
- 前端：`index.html`、`app.css`、`app.js`（1565 行）、`tags.js`（1113 行）、`dict.js`、`tag_categories.js`（10997 行，資料檔）、`r18.json`
- 桌面控制台：`ui_panel.pyw`（230 行，pythonw + tkinter）、`ui_control.ps1`（149 行）、`ui_panel.ps1`（舊備用）
- 一次性工具：`gen_assets.py`（137 行）
- 資產：`assets/*.webp`（已提交）

**Repo 內沒有**：`requirements.txt`、`pyproject.toml`、install/setup 腳本、`docs/`、CHANGELOG、版本檔、WD14 worker 原始碼、WD14 venv、任何模型檔。

---

## 3. 完整部署流程（從程式碼還原）

以下為**現況還原**，不是建議流程。標註 `[硬編碼]` / `[環境變數]` / `[可設定]` / `[未確認]`。

### 3.1 必要環境（事實 + 推論）

| 項目 | 現況 | 證據 |
|---|---|---|
| OS | Windows 10/11（PowerShell、`os.startfile`、Windows 回收筒 API） | `README.md:20`；`server.py:68-100,510`；`ui_control.ps1:15` |
| 其他 OS | 程式碼不支援（非跨平台抽象） | `README.md:58` |
| ComfyUI | Windows portable，根目錄 `[硬編碼] C:\ComfyUI\ComfyUI_windows_portable` | `server.py:29-30`；`ui_control.ps1:14` |
| ComfyUI 啟動 | `python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --output-directory D:\ComfyUI_output`，cwd = ComfyUI 根目錄 | `server.py:113-118`；`ui_control.ps1:104-105` |
| ComfyUI port | `[硬編碼] 8188`（代理、狀態檢查、WebSocket、啟動等待全用 8188） | `server.py:28,105,120,515,561,774,778,883`；`ui_control.ps1:106,122,155` |
| 模型 | `WAI-Nsfw-Illustrious-17.safetensors`（一次性工具寫死；UI 則從 ComfyUI 下拉選） | `gen_assets.py:17`；`app.js:155-169,315` |
| Python（server） | ComfyUI embedded python | `README.md:23`；`ui_control.ps1:13,115` |
| Python（桌面控制台） | 系統 Python 3.13 + tkinter（embedded 沒有 tkinter） | `README.md:23`；`ui_panel.pyw:2,15-16` |
| Node | 僅開發驗證需要；CI 用 20，devtools 文件寫 Node 24 | `.github/workflows/ci.yml:14-16`；`devtools/README.md:7` |
| RAM / GPU / VRAM | **未確認**（公開文件完全沒有；WD14 走 CPU，ComfyUI 生圖仍需 GPU/VRAM，但需求值未記載） | 無文件證據 |
| ComfyUI 版本 / API 相容性 | **未確認**（程式用到 `/prompt`、`/history/<id>`、`/view`、`/object_info/CheckpointLoaderSimple`、`/system_stats`、`/queue`、`/interrupt`、WebSocket） | `app.js:105-181,400-495`；`server.py:442-461` |

### 3.2 埠與輸出

| 項目 | 現況 | 證據 |
|---|---|---|
| simple_ui port | `[可設定]` `SIMPLE_UI_PORT` 環境變數，預設 7860；但控制台到處寫死 7860 | `server.py:884-886`；`ui_control.ps1:96,113-118,155`；`ui_panel.pyw:156,160,193,196,220,223,232` |
| 綁定位址 | 只綁 `127.0.0.1`，不對外；一般不需防火牆規則 | `server.py:886` |
| 輸出目錄 | `[硬編碼]` `D:\ComfyUI_output`，出現在 server 與控制台兩處 | `server.py:32,115,510,607`；`ui_control.ps1:104` |
| 日誌目錄 | `[硬編碼]` `C:\ComfyUI\logs` | `server.py:31,110-112,239,496`；`ui_control.ps1:16,86,105,115,132` |
| 暫存目錄 | `[環境變數]` `WD14_TMP`，預設 `C:\ComfyUI\tmp\wd14` | `server.py:51,878` |

### 3.3 實際啟動路徑（兩條）

**路徑 A — 桌面控制台（README 建議）**
1. 使用者自行在桌面建立 `生圖控制台.lnk`，指向系統 Python 3.13 的 `pythonw.exe`，參數為 `C:\ComfyUI\simple_ui\ui_panel.pyw`。
   - repo 內**沒有**建立此捷徑的腳本或說明（`README.md:27` 直接假設它已存在）。
2. `ui_panel.pyw` 用 socket 查 port（`ui_panel.pyw:30,156,160`），按鈕用 `CREATE_NO_WINDOW` 呼叫 `ui_control.ps1`（`ui_panel.pyw:47-49`）。
3. `ui_control.ps1`  hardcoded PowerShell / Python / ComfyUI / server / logs 路徑（`ui_control.ps1:13-16`）：
   - Stop：完整路徑比對砍掉所有 `simple_ui\server.py` 與 `ComfyUI\main.py`（21-32,50-78）。
   - Start：先清重複 server（88-96），必要時啟動 ComfyUI（103-106），再啟動 server.py（112-118）。
   - 啟動成功後自動開瀏覽器 `http://127.0.0.1:7860`（`ui_panel.pyw:196,223,232`）。

**路徑 B — 開發者直接跑**
1. 確認 ComfyUI 已在 8188（`README.md:28`）。
2. 用 ComfyUI embedded python 執行 `python server.py`。
3. `server.py:876-889`：建立 assets / WD14 暫存資料夾 → 啟動 10 分鐘週期 TTL 清理執行緒 → 清過期暫存 → 印出網址 → `serve_forever()` → 結束時 `WD14.stop()`。

### 3.4 WD14 圖片反推（選用功能，但 UI 按鈕始終存在）

前端反推模型切換：`app.js:1442-1449`（EVA02 預設 / ViT 快速），API 為 `POST /api/reverse`（`app.js` RV 流程；`server.py:542-543,637-664`）。

| 模型 | Python | Worker | 模型檔 | 限制 | 證據 |
|---|---|---|---|---|---|
| EVA02 | `[環境變數 WD14_PY]` 預設 `C:\ComfyUI\tools\wd14-venv\Scripts\python.exe` | `[環境變數 WD14_WORKER]` 預設 `C:\ComfyUI\tools\wd14_worker.py` | `C:\ComfyUI\tools\models\wd14\model.onnx` + `selected_tags.csv` | `providers=["CPUExecutionProvider"]`；偵測到 CUDA 報警告 | `server.py:46-47`；`tools\wd14_core.py:22-24,181-193` |
| ViT v3 | `[環境變數 WD14_VIT_PY]` 預設 `C:\ComfyUI\tools\wd14-vit-eval\venv\Scripts\python.exe` | `[環境變數 WD14_VIT_WORKER]` 預設 `C:\ComfyUI\tools\wd14_vit_worker.py` | 由 `C:\ComfyUI\tools\wd14-vit-eval\scripts\evaluate_vit.py` 決定；模型名 `wd-vit-tagger-v3` | 非 CPU provider 直接回 `fatal` | `server.py:49-50`；`tools\wd14_vit_worker.py:22-29,107-114` |

其他限制（`server.py:52-59,637-707`）：base64 ≤12 MB、原始圖 ≤8 MB、最長邊 4096、最短邊 16、只認 PNG/JPG/WebP/GIF（`sniff_image` 在 `server.py:128-177`）、同時最多 3 個請求（超過回 429，`server.py:654-658`）、Worker 啟動逾時 90 秒、單張推論逾時 120 秒、暫存 TTL 3600 秒。

**Worker 生命週期**：`Wd14Worker`（`server.py:207-418`）以 stdin/stdout JSON Lines 通訊；`ensure_ready()` 負責載入模型（319-342），`submit()` 綁定 process 避免競態（344-394），`stop()` 優雅 shutdown（396-414）。Worker 是用 `CREATE_NO_WINDOW` 啟動的子行程（245-251）。

### 3.5 首次啟動可能遇到的問題（文件有無說明）

| 問題 | 程式碼/環境事實 | 公開文件是否說明 |
|---|---|---|
| 7860 被多隻 server.py 同時綁住 | `server.py:871 allow_reuse_address = True`；Windows 上會有多個實例接手請求 | **無**（只在本機 `C:\ComfyUI\AGENTS.md` 記載） |
| 改了程式碼卻沒生效 | 同上，舊實例接手 | 無 |
| ComfyUI 沒開 | UI 狀態顯示「ComfyUI 沒開 · 點我開啟」，可 POST `/start-comfy` | 部分（`README.md:28` 只說假設已開） |
| 找不到模型 | `app.js:164-168` 顯示「（找不到模型）」 | 無 |
| WD14 工具缺失 | `server.py:233-236` 丟 `找不到 WD14 Python/Worker`；前端顯示反推錯誤 | **無**（README 只叫你看不存在的 AGENTS.md） |
| 輸出資料夾不存在 | `server.py:115` 由 ComfyUI 建立；`ui_control.ps1:104` 也帶同一參數 | 無 |
| 桌面控制台跳命令視窗 | 已用 pythonw + CREATE_NO_WINDOW 解決 | `README.md:23` 有提，但沒說捷徑怎麼建 |

---

## 4. 依賴及外部資源清單

### 4.1 Repo 內部（無需安裝）

| 名稱 | 用途 | 必要性 | 取得來源 | 版本要求 | 安裝說明 | 替代方案 | 缺少時 |
|---|---|---|---|---|---|---|---|
| HTML/CSS/JS（5 個檔） | 單頁前端 | 必要 | repo 內 | 無 | 不需要 | 無 | 介面無法使用 |
| `assets/*.webp` | 吉祥物／空狀態／分類 icon | 必要（視覺） | repo 內 | 無 | 不需要 | 可改 asset | 影像區塊空（有 onerror 隱藏） |
| `tag_categories.js` | WD14 標籤→分類資料 | 選用（反推分類） | repo 內；標頭說由 `tools/wd14-category-builder` 產生（`tag_categories.js:1`） | 無 | 已提交，不需重生 | 無 | 反推分類落到 `other` |
| `r18.json` | 成人向組合資料 | 選用 | repo 內 | 無 | 不需要 | 無 | 成人組合消失 |

### 4.2 Repo 外部（公開 clone 完全拿不到）

| 名稱 | 用途 | 必要性 | 本機路徑（實測存在） | 版本要求 | 公開安裝說明 | 缺少時 |
|---|---|---|---|---|---|---|
| ComfyUI Windows portable | 實際生圖引擎 | **必要** | `C:\ComfyUI\ComfyUI_windows_portable` | 未確認（API 相容性未記載） | 只有 `README.md:21` 一個上游連結 | `/comfy/*` 全回 502；生成無法用 |
| ComfyUI embedded python | 跑 `server.py`、啟動 ComfyUI | **必要** | `...\python_embeded\python.exe` | 隨 portable | 無 | server.py 起不來 |
| 系統 Python 3.13 + tkinter | 桌面控制台 `ui_panel.pyw` | 選用（控制台） | 本機系統 Python | 3.13（`README.md:23`） | 無 | 控制台不能用，仍可直接跑 server.py |
| 模型 `WAI-Nsfw-Illustrious-17.safetensors` | 生圖 ckpt | **必要** | 本機 ComfyUI models 目錄（未逐檔確認） | 無 | `README.md:22` 只給名字，沒給下載來源/放置路徑 | 下拉顯示「（找不到模型）」，生成被擋（`app.js:362-368`） |
| WD14 EVA02 venv + worker + 模型 | 圖片反推（預設） | 選用 | `C:\ComfyUI\tools\wd14-venv`、`wd14_worker.py`、`models\wd14` | onnxruntime / numpy / pillow（版本未記載於 repo） | **無**（指向不存在的 AGENTS.md） | 反推按鈕回錯；生成不受影響 |
| WD14 ViT v3 venv + worker + 模型 | 快速反推 | 選用 | `C:\ComfyUI\tools\wd14-vit-eval`、`wd14_vit_worker.py` | 含 onnx，CPU only | **無** | 切換到 ViT 後反推失敗 |
| `D:\ComfyUI_output` | 圖片輸出 | **必要** | 本機存在 | 無 | `README.md:31` 只說預設值 | ComfyUI 啟動參數指到不存在的路徑 |
| `C:\ComfyUI\logs` | ComfyUI / server / WD14 日誌 | 必要（診斷） | 由程式建立 | 無 | 無 | 啟動時自動建立 |
| PowerShell 5.1 路徑 | `ui_panel.pyw:15` 寫死 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` | 控制台必要 | Windows 內建 | 無 | 無 | 控制台按鈕失效 |

**第三方套件聲明**：repo 內沒有任何套件清單。`LICENSE:11-13` 提到網路存取有特殊要求；`README.md:66-67` 只致謝 ComfyUI 與 NovelAI-tag-generator，未列 onnxruntime / numpy / pillow / tkinter 等依賴與版本。

---

## 5. 設定與資料保護分析

### 5.1 設定來源

| 類型 | 位置 | 可修改性 | 證據 |
|---|---|---|---|
| Python 常數 | `server.py:28-32,38-39,52-59` | 改程式碼 | COMFY / COMFY_ROOT / COMFY_PY / LOG_DIR / OUTPUT_DIR / ALLOWED / NO_STORE / WD14 限制 |
| 環境變數 | `SIMPLE_UI_PORT`、`WD14_PY`、`WD14_WORKER`、`WD14_VIT_PY`、`WD14_VIT_WORKER`、`WD14_TMP` | 可設定，但**文件完全沒提** | `server.py:46-51,884` |
| PowerShell 常數 | `ui_control.ps1:13-16` | 改程式碼 | Python / ComfyRoot / ServerScript / Logs |
| Python 常數 | `ui_panel.pyw:15-16` | 改程式碼 | PS / CONTROL |
| 一次性工具常數 | `gen_assets.py:14,17` | 改程式碼 | COMFY / CKPT |
| 瀏覽器 localStorage | 見下表 | 使用者操作 | 各 JS 檔 |

### 5.2 localStorage 完整清單（事實）

| Key | 用途 | 讀寫位置 | 相容性風險 |
|---|---|---|---|
| `sel` | 選取的標籤（舊格式，必須保留） | `tags.js:262,296,756` | 格式不可改（`README.md:50`） |
| `combos` | 收藏組合（舊格式） | `tags.js:263,297` | 同上 |
| `adult` | 18+ 開關，`"1"/"0"`（舊格式） | `tags.js:264,298,767` | 同上 |
| `showEn` | 顯示英文標籤（舊格式） | `tags.js:265,299,769` | 同上 |
| `ui.moreCats` | 展開更多分類 | `tags.js:266,300` | 低 |
| `ui.selSortMode` | 標籤排序 `manual`/`auto` | `tags.js:267,301,752` | 低 |
| `ui.learnedTags` | 學習標籤 `{general,positive,negative}` | `tags.js:268,302,309,734,1103,1119`；`app.js:461-465` | 只寫自己的 key，不覆蓋 sel/adult/showEn（註解 306,1103） |
| `ui.tagStats` | 生成統計物化快照，`version:1` | `tags.js:47,126-205` | 版本不符時**原樣備份**到 `ui.tagStats.broken.<ts>` 再移除（134-135） |
| `ui.tagStats.evt.*` | 事件 log（UUID jobId） | `tags.js:48,158,230-231` | 不自動壓縮（52 行註解） |
| `ui.tagStats.fav.*` / `.broken.*` | 收藏 / 損壞備份 | `tags.js:49-50,134-135,177` | 保留原資料 |
| `ui.extra` | `#pos` 補充描述 | `app.js:1408-1412,689,1342,236`；`README.md:49` | **不讀舊 `pos` key**（刻意）；`surpriseCombo()` 會清除（`app.js:236`） |
| `ui.settings` | 尺寸/數量/品質/負面/steps/cfg/seed/ckpt | `app.js:30,168,681,833` | 用 `Object.assign(DEFAULTS, ...)`，新增欄位有預設 |
| `ui.gallery` | 歷史縮圖（最多 24 筆，`app.js:450`） | `app.js:31,451,605,713` | 只存 URL/檔名，不存圖檔 |
| `ui.genLog` | 生成診斷 log | `app.js:280-283` | 低 |
| `ui.advOpen` | 進階設定展開狀態 | `app.js:1595-1597` | 低 |

### 5.3 資料保護現況（事實）

1. **歷史圖片存在性**：`POST /api/check` 用 `HEAD /view` 問 ComfyUI（`server.py:547-587`）。ComfyUI 沒開時回 `{"missing":[],"comfy":false}`（560-562），前端因此不會刪任何紀錄；連三次網路錯誤也降級為 `comfy:false`（580-584）。符合 `README.md:54` 的設計約束。
2. **刪圖**：`POST /api/delete` 把路徑限制在 `realpath(OUTPUT_DIR)` 之下（`server.py:607-608`），並丟到 Windows 回收筒（`recycle()` 68-100；614-618）。不是永久刪除。
3. **初始化不覆蓋設定**：`ui.settings` 用預設值合併（`app.js:30`）；`ui.extra`、`sel`、`combos`、`adult`、`showEn` 都先讀再寫；`syncFromStorage()` 刻意只讀不寫（`tags.js:730` 註解、`app.js:289-299`）。未發現開頁即覆蓋使用者設定的路徑。
4. **更新影響**：程式碼與資料分離（localStorage 在瀏覽器、圖片在 `D:\ComfyUI_output`、設定在原始碼常數）。單純 `git pull` 不會動 localStorage 或圖片；但若使用者依 `README.md:58` 修改過原始碼內的路徑，更新會覆蓋那些修改——目前沒有更新程序或備份指引。
5. **解除安裝**：沒有文件說明該保留/清除什麼。應保留：localStorage 全部 key、輸出圖片、WD14 模型/venv、ComfyUI 模型；可清除：repo 本身、`C:\ComfyUI\logs`、WD14 暫存。此為**建議**，現況文件完全沒寫。

---

## 6. Coding Agent 自主部署能力矩陣

情境：陌生 Agent 只拿到公開 GitHub repo，沒有本機歷史對話，不知道開發者目錄結構。

| # | 步驟 | 評級 | 理由 / 卡點 |
|---|---|---|---|
| 1 | 判斷環境是否符合要求 | **文件不足 + 需詢問使用者** | 只有 Windows + ComfyUI portable；RAM/GPU/VRAM、ComfyUI 版本、模型需求皆未確認 |
| 2 | 確認 ComfyUI 位置及狀態 | **需讀程式碼（文件不足）** | 8188 與 `C:\ComfyUI\ComfyUI_windows_portable` 寫死在 `server.py:28-30`；README 只說「假設已在 8188」 |
| 3 | 安裝必要依賴 | **文件不足 / 程式碼不支援** | 無 requirements/pyproject；系統 Python 3.13 + tkinter 沒有安裝指引 |
| 4 | 準備外部 Worker | **程式碼不支援（公開 repo 缺檔）** | EVA02 與 ViT v3 的 worker/venv/model 全在 repo 外；唯一線索 `AGENTS.md` 是死連結 |
| 5 | 確認模型資源 | **文件不足 + 需詢問使用者** | 只給模型名（`README.md:22`），沒有下載來源、放置路徑、授權提醒 |
| 6 | 建立必要設定 | **文件不足 + 部署風險** | 沒有 config file；至少 4 個檔案的絕對路徑要手改，README 只籠統說「請依環境修改」 |
| 7 | 啟動 simple_ui | **部分可依文件完成** | `python server.py` 有寫（`README.md:28`），但沒說要用 embedded python；控制台路徑 A 完全缺腳本 |
| 8 | 驗證 Port 7860 | **可達成（需讀程式碼）** | `README.md:43` 給網址；`ui_control.ps1:155` 有狀態檢查；`SIMPLE_UI_PORT` 未文件化 |
| 9 | 驗證 ComfyUI 連線 | **需讀程式碼（文件不足）** | 端點 `/comfy/system_stats`、`/api/status` 存在但 README 沒寫 |
| 10 | 驗證 WebSocket | **文件不足** | `README.md:47` 只講設計約束 `/ws` 隧道，沒有驗證程序 |
| 11 | 驗證必要功能 | **部分可達成** | README 有語法檢查與版面檢查（33-43 行），但沒有從頭到尾的 smoke test 與預期結果 |
| 12 | 處理常見錯誤 | **文件不足** | 沒有 troubleshooting；多重 server.py 陷阱只寫在 repo 外的 AGENTS.md |

### 6.1 明確回答

**如果今天把公開 repo 交給陌生 Agent，它部署不會成功。** 它會成功 clone、看懂用途、通過語法檢查，然後在「準備外部 WD14 Worker」與「建立必要設定」兩步卡死；即使跳過 WD14，仍會因為不知道要改用 embedded python、不知道模型放置位置、不知道要改哪些絕對路徑，而無法保證生成流程可用。唯一能成功的情況是：使用者額外提供一套與開發者相同的目錄配置與外部工具——那就不是「自主部署」。

---

## 7. 文件缺失及矛盾清單

嚴重的定義：P0 = 造成無法安裝/部署；P1 = 嚴重影響上手或 Agent 操作；P2 = 品質/維護性；P3 = 非必要優化。

| # | 項目 | 嚴重度 | 影響對象 | 實際證據 | 建議改善 |
|---|---|---|---|---|---|
| 1 | README 指向不存在的根目錄 `AGENTS.md` | **P0** | 使用者 + Agent | `README.md:16`；repo 內 glob 無 `AGENTS.md`；GitHub raw 回 404；實際檔在 `C:\ComfyUI\AGENTS.md`（repo 外） | 將必要部署知識摘錄進 repo 內 `AGENTS.md` 或 `docs/`，README 改指向 repo 內路徑 |
| 2 | WD14 EVA02 / ViT v3 的 Worker、venv、模型全在 repo 外 | **P0** | 使用者 + Agent | `server.py:46-51`；本機 `C:\ComfyUI\tools\{wd14_core.py,wd14_worker.py,wd14_vit_worker.py,wd14-venv,wd14-vit-eval,models\wd14}` 存在但皆不在 repo | 文件列出取得/建立方式，或提供可選的安裝腳本 + 模型下載指引；明確標示反推為選用功能 |
| 3 | 沒有從零安裝流程與依賴清單 | **P0** | 使用者 + Agent | repo 無 requirements/pyproject/install 腳本；`README.md:18-32` 只有 3 行啟動 | 新增 `docs/installation.md`：clone → ComfyUI portable → 模型 → Python → 路徑設定 → 啟動 → 驗證 |
| 4 | 硬編碼絕對路徑散落且清單不完整 | **P0** | 所有非開發者 | `server.py:28-32`、`ui_control.ps1:13-16`、`ui_panel.pyw:15-16`、`gen_assets.py:14,17`；`README.md:58` 只列 3 個檔 | 集中到單一 config 模組/.env，並在 `docs/configuration.md` 用表格列出每一處 |
| 5 | 桌面捷徑 `生圖控制台.lnk` 不在 repo、沒有建立腳本 | **P1** | 一般使用者 | `README.md:27` 直接假設它存在；repo 無 .lnk 產生器 | 提供建立捷徑的 PowerShell 腳本或改為直接雙擊 `ui_panel.pyw` 的說明 |
| 6 | 完全沒有版本資訊 / CHANGELOG / Releases | **P1** | 使用者 + Agent | GitHub API releases `[]`；README 無版本段；`bug_report.yml:19-22` 卻要求填版本 | 加入版本檔與 CHANGELOG（最低限度：git tag + README 版本欄） |
| 7 | 沒有更新、解除安裝、資料備份指引 | **P1** | 既有使用者 | README 無相關段落；localStorage 有 14 類 key（第 5.2 節） | 文件說明更新前備份 localStorage / 輸出資料夾，以及解除安裝時該保留什麼 |
| 8 | 硬體需求（RAM/GPU/VRAM）與 ComfyUI 版本相容性未記載 | **P1** | 新使用者 + Agent | `README.md:18-24` 完全沒有 | 標示最低建議配備與已驗證 ComfyUI 版本；不確定就寫「未確認」 |
| 9 | 環境變數（`SIMPLE_UI_PORT`、`WD14_*`）未文件化 | **P1** | 進階使用者 + Agent | `server.py:46-51,884` 支援覆寫，但 README 完全沒提 | 在 configuration 文件列出變數名、預設值、適用情境 |
| 10 | README 說其他 Illustrious 模型「需自行改 workflow」與程式碼不符 | **P1** | 一般使用者 | `README.md:22` vs `app.js:155-169`（從 `/object_info` 動態抓 ckpt 清單並存入 `ui.settings`）、`app.js:315`（workflow 用 `o.ckpt`） | 更正為「可在右欄下拉更換 checkpoint，不需改 workflow」 |
| 11 | README 說「無外部依賴」易被誤解 | **P2** | 使用者 | `README.md:11`；但 WD14 需 onnxruntime/numpy/pillow、控制台需 tkinter、server 需 ComfyUI embedded python | 限縮語意為「前端無 build step、無 CDN；後端為 Python 標準庫」，並列外部依賴 |
| 12 | CI Python 3.11 vs README 系統 Python 3.13 | **P2** | 貢獻者 | `.github/workflows/ci.yml:17-19` 用 3.11；`README.md:23` 要 3.13 | 註明 CI 只做語法檢查，或對齊版本 |
| 13 | 多重 server.py 綁 7860 的已知陷阱只存在 repo 外知識 | **P2** | 開發者 + Agent | `server.py:871 allow_reuse_address = True`；`ui_control.ps1:88-96` 有清重複邏輯；公開文件無 | 在 troubleshooting 文件記載症狀與完整路徑比對的清理方式 |
| 14 | `tag_categories.js` 由外部工具產生卻未說明 | **P2** | 維護者 | `tag_categories.js:1`；工具在 repo 外 `tools/wd14-category-builder` | 文件說明此檔已提交、不需重生；若要重生，工具來源為何 |
| 15 | README「不接受 PR」與 PR 模板 / CI 並存 | **P3** | 貢獻者 | `README.md:71` vs `.github/PULL_REQUEST_TEMPLATE.md`、`.github/workflows/ci.yml` | 統一表述（例如「不保證合併，歡迎開 issue 討論」） |
| 16 | SECURITY.md「不對外提供服務」 vs 授權條款的網路存取聲明 | **P2（待確認）** | 使用者 | `SECURITY.md:3` 說本機代理；`LICENSE:11-13` 對網路存取有特殊要求 | 確認 Fair AI 1.0-SD 的 Notices 條款是否適用；若適用，補上宣告 |
| 17 | devtools 驗收工具路徑硬編碼且未標為選用 | **P2** | Agent（可能誤跑） | `devtools/README.md:16,19-22` 指向 `C:\ComfyUI\tools\...`；`devtools/README.md:24` 要求 7860/8188 都開著 | 標明「僅開發者環境可用」，避免 Agent 誤以為是部署前置 |

---

## 8. 建議文件結構（最小且有效）

| 檔案 | 讀者 | 用途 | 必要內容 | 是否新增 |
|---|---|---|---|---|
| `README.md` | 一般使用者 | 30 秒理解 + 入口 | 用途、功能截圖、需求（OS/硬體/ComfyUI/模型/Python）、快速開始、設定與資料位置、更新/備份/解除安裝導引、授權與第三方、troubleshooting 連結、版本 | 改寫 |
| `AGENTS.md`（**放進 repo**） | Coding Agent | 自主部署與維護的隱藏知識 | 部署流程、硬編碼路徑清單、連線架構（/ws 隧道、/comfy 代理）、WD14 兩套 worker、localStorage 相容性、已知陷阱（多重 server.py）、唯讀/寫入邊界 | 新增 |
| `docs/installation.md` | 新使用者 + Agent | 從 clone 到可跑 | ComfyUI portable 安裝、模型下載與放置、Python 需求、捷徑建立、選用 WD14 venv/模型、兩條啟動路徑、每步驗證 | 新增 |
| `docs/configuration.md` | 使用者 + Agent | 所有可調項目一張表 | 路径常數與所在檔/行、環境變數、port 7860/8188、輸出/日誌/暫存目錄、localStorage key 與相容性 | 新增 |
| `docs/troubleshooting.md` | 所有使用者 | 常見錯誤對照 | 502 / 找不到模型 / 反推工具缺失 / 7860 多重實例 / 控制台逾時 / 破圖與 `/api/check` | 新增（或先放 README 章節） |
| `devtools/README.md` | 開發者 | 驗收工具 | 現況保留，補「僅開發者環境」標示 | 小幅修改 |

**不建議**另外拆 `docs/architecture.md`、`docs/deployment.md`、`docs/development.md`：目前程式規模與讀者需求不足以支撐，只會增加脫節風險。部署與架構重點直接放 repo 內 `AGENTS.md`。

### 8.1 文件 vs 腳本 vs 使用者確認

| 項目 | 應由誰完成 |
|---|---|
| 路径、port、env var 清單 | **文件**（表格），長期應改為單一 config 由程式讀取 |
| ComfyUI portable / 模型取得 | **文件 + 脚本提示**；下載與放置需**使用者確認**（授權、磁碟位置） |
| WD14 venv / 模型 | 選用；**腳本**可自動建立，但模型下載需**使用者確認** |
| 桌面捷徑建立 | **腳本**（PowerShell），可自動 |
| 更新前備份 localStorage / 輸出 | **文件 + 腳本**；實際備份需**使用者確認** |
| 刪圖、停止服務、覆蓋資料 | **必須保留使用者確認**（現況已用回收筒與 console 按鈕，建議維持） |

### 8.2 避免文件與程式碼再次脫節

1. 把路徑/常數集中到單一模組，文件表格直接對應該模組。
2. CI 增加一個極輕量檢查：確認文件提到的常數名仍存在於程式碼（grep 即可）。
3. 每次改 `server.py` 頂端常數時，PR 模板勾選「已同步 `docs/configuration.md`」。

---

## 9. 建議改善優先級

### P0 — 無法正確安裝或部署
- 補 repo 內 `AGENTS.md` / 部署文件，修掉 README 死連結（#1）。
- WD14 兩套 worker/venv/模型的取得方式與選用性說清楚（#2）。
- 新增從零安裝流程與依賴清單（#3）。
- 集中或完整列舉硬編碼路徑（#4）。

### P1 — 嚴重影響上手或 Agent 自主操作
- 桌面捷徑建立方式（#5）。
- 版本 / CHANGELOG / Release（#6）。
- 更新 / 解除安裝 / 備份（#7）。
- 硬體與 ComfyUI 版本需求（#8）。
- 環境變數文件（#9）。
- 修正模型替換說法（#10）。

### P2 — 文件品質、維護性、易用性
- 「無外部依賴」語意限縮（#11）、CI/Python 版本對齊（#12）、多重 server.py 陷阱（#13）、`tag_categories.js` 產生來源（#14）、授權與網路宣告（#16）、devtools 選用標示（#17）。

### P3 — 非必要優化
- PR 模板與「不接受 PR」表述統一（#15）、Issue 模板在沒有版本號前的引導調整。

---

## 10. 後續實作建議（不分階段執行，僅規劃）

| 階段 | 工作 | 產出 | 需使用者授權 |
|---|---|---|---|
| A：可行性打底 | 建立 repo 內 `AGENTS.md`；盤點並集中路徑常數 | 可自主部署的知識基礎 | 否（唯讀/新增文件） |
| B：說明書 | 改寫 README；新增 installation / configuration / troubleshooting | 陌生人與 Agent 能照做 | 否 |
| C：安裝自動化 | 捷徑建立腳本、選用 WD14 venv/模型安裝腳本 | 減少手動錯誤 | **是**（下載、路徑、模型授權） |
| D：防呆與防脫節 | 版本號、CHANGELOG、CI 文件一致性檢查 | 長期維護 | 否 |

**本次不開始 Phase 2。**

---

## 11. Git 與正式環境狀態

| 項目 | 狀態 |
|---|---|
| Branch | `main`（未切換） |
| HEAD | `c2291861ee14e536a994dbe4f9456676a3e19eb0`（未變動） |
| 工作區（調查前） | 乾淨，無未提交修改 |
| 新增的調查報告 | `devtools/reports/open-source-readiness-phase1.md`（本檔） |
| 既有檔案 | **完全未修改**（含 README.md、AGENTS.md、程式碼、設定、devtools 既有報告） |
| Git 操作 | 只執行 `status` / `branch` / `rev-parse` / `remote` / `rev-list` / `log`；**未** commit / push / fetch / reset / rebase / stash / checkout / clean |
| 正式服務 | **未碰觸**。未啟動、停止、重啟 server.py 或 ComfyUI；未執行生圖 |
| 安裝 / 下載 / 高負載 | **無**。未安裝或更新任何套件、未下載模型、未執行 benchmark |
| 使用者資料 | **未修改**。未碰 localStorage、輸出圖片、設定值 |
| 其他環境操作 | 只有唯讀檔案搜尋、git 查詢、GitHub API/raw 讀取、本機路徑存在性檢查 |

> 本報告完成後，工作區預期只多出一個未追蹤檔案（本報告）。如須確認：`git -C C:\ComfyUI\simple_ui status --porcelain` 應只顯示 `?? devtools/reports/open-source-readiness-phase1.md`。
