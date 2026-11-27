# Phase 2C：公開安裝與啟動流程 — 唯讀調查報告

## 1. 任務目標與調查範圍

目標：讓任何取得公開 Repo 的 Windows 使用者，能在自己的電腦上安裝、啟動 Sid-simple-ui，連接自己電腦上的 ComfyUI，用自己的硬體、模型與資源生圖；基本生圖不得依賴開發者電腦、路徑、Worker、模型或外部服務。

本次**只調查、只建議**，未修改 README、程式碼、設定、測試或既有報告；唯一新增檔案是本報告。

調查範圍：基本服務依賴與 Python 需求、完整環境變數盤點、桌面控制台與開發工具可移植性、WD14 選用功能現況、README 逐項核對、最小公開部署方案、P0/P1/P2 排序，以及殘餘風險。

---

## 2. Git 起始與結束狀態

| 項目 | 起始 | 結束 |
|---|---|---|
| Repository | `C:\ComfyUI\simple_ui` | 同 |
| 分支 | `main`（`## main...origin/main`） | 同，未切換 |
| HEAD | `12ad15ae2d23e67d16db2c4ec745c133eb21c28c` | 同，未變動 |
| HEAD commit | `2026-11-23 10:16:53 +0800` — `feat: externalize output directory and verify image deletion` | 同 |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push） | 同，未 fetch |
| 已追蹤修改 | 無 | 無 |
| 未追蹤檔案 | 五份報告：`open-source-readiness-phase1.md`、`phase2a.md`、`phase2b1.md`、`phase2b2.md`、`phase2b3.md` | 同五份 + 本報告 |
| Git 寫入 | — | 無 commit / push / reset / restore / stash / checkout / clean / rebase |

HEAD 與任務指定一致；既有五份報告完整保留、內容未覆蓋。無須辨識外來修改。

---

## 3. 基本服務實際依賴與 Python 需求

### 3.1 依賴

- `server.py:11-26` 的 import 全部是 **Python 標準庫**：`base64, hashlib, http.server, json, mimetypes, os, select, socket, socketserver, subprocess, sys, threading, time, urllib.error, urllib.parse, urllib.request`。
- Repo 根目錄沒有 `requirements.txt`、`pyproject.toml`、`setup.py`、`.env` 或任何 install script（完整檔案列表已檢查；隱藏檔只有 `.gitignore` 與 `.codegraph/.gitignore`）。
- 前端 `index.html:8,356-359` 只引用 repo 內的 `app.css`、`dict.js`、`tags.js`、`tag_categories.js`、`app.js` 與 `assets/*.webp`；無 CDN、無 build step。
- 因此**基本服務（靜態檔 + `/comfy` 代理 + `/ws` 隧道）不需要任何第三方 Python 套件**。唯一的外部系統需求是「有一個可被 HTTP 存取的 ComfyUI」。
- 注意：`gen_assets.py:7-12` 也是標準庫，但它會呼叫 ComfyUI 生圖並寫回 repo `assets/`；屬一次性開發工具，與基本服務無關。

### 3.2 Python 最低版本（從實際語法與 API 推導，非印象）

`server.py` 沒有 f-string、walrus、型別註記或 `match`，語法本身是寬鬆的 Python 3。真正決定下限的是標準庫 API：

| API | 使用位置 | 引入版本 | 影響 |
|---|---|---|---|
| `urllib.request.Request(..., method=...)` | `server.py:532, 668, 688` | Python 3.3 | HEAD / 自訂 method 代理 |
| `ssl.create_default_context()` | `server.py:988` | Python 3.4 | HTTPS ComfyUI 的 WS 隧道 |
| `os.path.commonpath()` | `server.py:744` | Python 3.5 | 刪圖路徑容器檢查 |
| `subprocess.Popen(..., text=True, encoding=...)` | `server.py:329` | Python 3.7 | **僅 WD14 Worker 路徑** |

推導結論：

- **只啟動 server + 生成/瀏覽（HTTP）**：Python 3.3+ 在 API 層面可行；但前端會建立 WS 連線（`app.js:230`），實際需要 3.4+。
- **包含刪圖等所有基本功能**：**Python 3.5+**（`commonpath` 是基本服務中最新引入的 API）。
- **包含 WD14 反推**：**Python 3.7+**（`text=True`）。
- **桌面控制台 `ui_panel.pyw`**：**Python 3.7+**（`capture_output=True` 在 `ui_panel.pyw:48`；f-string 在 `:69,174,261`；Python 3.6引入 f-string），且必須是**含 tkinter 的系統 Python**；ComfyUI embedded Python 沒有 tkinter（AGENTS.md:45）。
- **建議版本**：Python 3.10+（本機實測系統 Python `3.13.15`、ComfyUI embedded `3.13.14`），理由是安全更新與相容性，**不是程式碼硬需求**。

### 3.3 ComfyUI 是否必須是 Windows portable

**不是。** 基本服務只透過 HTTP 與 ComfyUI 溝通（`server.py:502-513` 代理、`server.py:684-699` HEAD `/view`）。只有「由 simple_ui 代為啟動 ComfyUI」的路徑才假設 portable 佈局：

- `server.py:73-74`：`COMFY_ROOT = C:\ComfyUI\ComfyUI_windows_portable`、`COMFY_PY = ...\python_embeded\python.exe`
- `server.py:179-202` `start_comfy()`：以 `cwd=COMFY_ROOT` 啟動 `ComfyUI\main.py --windows-standalone-build`，只有設定 `OUTPUT_DIR` 時才附加 `--output-directory`（`:190-191`）。
- 若已設定 `COMFY_URL`，外部模式直接拒絕代啟動（`server.py:624-629` 回 409 `EXTERNAL_COMFY`），完全不觸發上述路徑。

### 3.4 是否可在沒有開發者目錄結構的電腦啟動

**可以。** `main()` 只建立 repo 內的 `ASSETS`（`server.py:1092`），不再建立 `D:\ComfyUI_output`；WD14 暫存目錄按需建立（`server.py:930-936`），背景 TTL 清理遇到不存在的目錄直接回 0（`server.py:268-272`）。`LOG_DIR` 只在使用代啟動或生成診斷時建立（`server.py:186, 578`）。未設定 `COMFY_OUTPUT_DIR` 時，刪圖與開啟資料夾停用，但生圖/瀏覽/歷史完全可用（`server.py:600-603, 725`，`app.js:641, 798`）。

### 3.5 Port、衝突與停止

- 預設 UI Port `7860`（`server.py:1099`），只綁 `127.0.0.1`（`server.py:1101`）；ComfyUI 預設 `8188`（`server.py:32`）。
- 修改 UI Port 只靠 `SIMPLE_UI_PORT`（`server.py:1099`）。前端使用相對路徑（`/comfy`、`/api`、`/ws`，見 `app.js:51, 144, 149, 230, 641, 798, 1259, 1736`），所以**前端會自動跟上新 Port**。
- Port 衝突沒有自動換埠或白話錯誤：`int()` 解析失敗會直接 traceback（`server.py:1099`），bind 失敗由 `S(...).serve_forever()`（`server.py:1101`）拋出。
- `allow_reuse_address = True`（`server.py:1082`）在 Windows 會允许多個 `server.py` 同時綁 7860（AGENTS.md:204-212）；這是已知陷阱，不是本次新問題。
- 停止方式：前景執行時按 Ctrl+C／關閉終端；使用控制台時按「關閉生圖」，但它會**連使用者的 ComfyUI 一起殺掉**（`ui_control.ps1:45-79` 比對 `ComfyUI\main.py`）。沒有 graceful shutdown endpoint；`main()` 的 `finally` 只呼叫 `WD14.stop()`（`server.py:1103`）。

---

## 4. 完整環境變數表

| 環境變數 | 讀取位置 | 預設值 | 格式限制 | 影響範圍 | 設定錯誤行為 | 一般使用者需要設定？ |
|---|---|---|---|---|---|---|
| `COMFY_URL` | `server.py:65-66`（`_parse_comfy_url` 在 `:28-60`） | 空 → `http://127.0.0.1:8188`（`:32`） | 只接受 `http/https`（`:40-42`）；host 只能 `127.0.0.1` / `localhost`（`:44-45`）；必須明確 port 1–65535（`:52-59`）；不接受 path/query/fragment，空 `?`/`#` 也擋（`:33-35,48-51`） | HTTP 代理、狀態檢查、`/ws` 隧道（Host/Origin）共用；設定即進入外部模式（`:60`） | 啟動前 `_COMFY_ERROR` 記錄，`main()` 以 `SystemExit(2)` 終止並印中文（`:1088-1091`） | 僅當 ComfyUI 不在預設 8188 時需要 |
| `COMFY_OUTPUT_DIR` | `server.py:101`（解析函式 `:78-95`） | 無；`OUTPUT_DIR = None`、 `_OUTPUT_ERROR = "尚未設定…"`（`:98-103`） | `strip` → `expanduser` → `expandvars`；必須絕對路徑、存在、是資料夾、可 listdir、可寫（`:80-94`）；有效值存 `realpath`（`:95`） | `/api/status` 的 `output/output_ok/output_error`（`:600-603`）、`/open-output`（`:589-598`）、刪圖根目錄與驗證（`:723-827`） | 不擋主服務；功能停用並回白話錯誤（`:591,725`） | 只有需要刪圖/開資料夾時需要 |
| `SIMPLE_UI_PORT` | `server.py:1099` | `7860` | `int(...)`，無範圍檢查 | 只影響 server bind（`server.py:1101`）；前端相對 URL 會跟上；控制台仍寫死 7860 | 非數字 → `ValueError` traceback，無友善訊息 | 僅 port 衝突時需要 |
| `WD14_PY` | `server.py:117` | `C:\ComfyUI\tools\wd14-venv\Scripts\python.exe` | 無驗證 | WD14 Worker 启动器 | 找不到 → `/api/reverse` 回 503 `WORKER_ERROR`（`:315-317,959-962`） | 否（選用功能） |
| `WD14_WORKER` | `server.py:118` | `C:\ComfyUI\tools\wd14_worker.py` | 無驗證 | EVA02 Worker 程式 | 同上 | 否 |
| `WD14_VIT_PY` | `server.py:120` | `C:\ComfyUI\tools\wd14-vit-eval\venv\Scripts\python.exe` | 無驗證 | ViT 快速模式 Worker | 同上 | 否 |
| `WD14_VIT_WORKER` | `server.py:121` | `C:\ComfyUI\tools\wd14_vit_worker.py` | 無驗證 | ViT 快速模式 Worker | 同上 | 否 |
| `WD14_TMP` | `server.py:122` | `C:\ComfyUI\tmp\wd14` | 無驗證 | 反推暫存圖、TTL 清理 | 寫入失敗 → 500 `TMP_FAIL`（`:937-939`）；清理失敗靜默忽略（`:258-272`） | 否 |
| `REV_BASE`（額外發現） | `devtools/wd14_api_test.py:19`、`wd14_race_test.py:29`、`wd14_tmpfile_test.py:30` | `http://127.0.0.1:7860` | URL 字串 | 僅 devtools 測試target base | 只影響測試腳本 | 否，一般使用者完全不需要 |

補充：

- `COMFY_URL` **支援任意本機 port**（含 8189、8443）、`localhost` 與 `127.0.0.1`、HTTP 與 HTTPS；**不支援 LAN／遠端 IP**（`server.py:44-45` 明確拒絕）。
- 明確設定 `COMFY_URL` 即進入外部模式，`/start-comfy` 回 409 `EXTERNAL_COMFY`（`server.py:624-629`），不會自動啟動 ComfyUI。
- `COMFY_OUTPUT_DIR` 未設定時：刪圖與「開啟圖片資料夾」停用，基本生圖、`/view` 瀏覽、歷史載入與同步不受影響（`server.py:600-603,725`；`app.js:641,798`）。
- 設定輸出目錄**必須與 ComfyUI 實際輸出位置一致**：刪圖前會以 `filename/subfolder/type` 打 ComfyUI `/view` 取得內容，並與本機檔案做 SHA-256 比對（`server.py:765-827`）；路徑或內容不一致回 409 `PATH_MISMATCH`，`already_gone` 只在 ComfyUI 明確 404/410 且本機也沒有時成立（`server.py:763,777`）。

---

## 5. 基本安裝與啟動流程（目前程式碼可達的最短路徑）

以下門檻假設使用者已自行安裝並啟動 ComfyUI、且監聽 `127.0.0.1:8188`：

1. 安裝 Windows 10/11 + Python 3.5+（建議 3.10+；若要用控制台需含 tkinter 的 3.7+）。
2. 自行安裝並啟動 ComfyUI（不限 portable），確認 `http://127.0.0.1:8188/system_stats` 有回應。
3. Clone 或下載 `sid-comfyui-simple-ui` 到任意資料夾（repo 內已含 `assets/` 與所有前端檔）。
4. 在 repo 根目錄執行 `python server.py`。
5. 瀏覽器開啟 `http://127.0.0.1:7860`。
6. 在右欄選擇模型（模型列表由 `/object_info/CheckpointLoaderSimple` 動態取得，`app.js:205-214`）、標籤，按生成。
7. 如需刪圖/開資料夾，才另設 `COMFY_OUTPUT_DIR` 並重啟 server。

若 ComfyUI 在不同 port：於啟動前設 `COMFY_URL=http://127.0.0.1:<port>`（例如 8189），不需要改任何程式碼。若 7860 被佔用：另設 `SIMPLE_UI_PORT`。

**使用者不必修改任何程式碼或 workflow**：workflow 由 `app.js:362-364` 動態組出，checkpoint 使用 UI 選擇的 `o.ckpt`，不是寫死型號。

---

## 6. 桌面控制台及開發工具可移植性

| 檔案 | 用途 | 依賴 | 硬編碼路徑 / Port | 可移植程度 | 一般使用者需要？ |
|---|---|---|---|---|---|
| `ui_control.ps1` | 控制台核心：清理重複 server、啟動/停止 ComfyUI 與 server、查狀態；輸出 JSON | Windows PowerShell + `Get-CimInstance` / `Get-NetTCPConnection` | `C:\ComfyUI\...` 四處（`:13-16`）；`D:\ComfyUI_output`（`:104`）；8188/7860（`:96,102,113,122,154-155`） | **極低**：直接執行會啟動開發者 portable ComfyUI 並覆蓋輸出目錄；停止會殺掉符合 `ComfyUI\main.py` 的所有行程（`:28-31,45-79`） | **不需要**，且目前 README 把它放進基本流程是誤導 |
| `ui_panel.pyw` | 現行桌面控制台（pythonw + tkinter，無命令視窗） | 系統 Python 3.7+ 含 tkinter；`subprocess.run(capture_output=...)`（`:48`）；Windows `CREATE_NO_WINDOW`；`ctypes`/`webbrowser` | `C:\Windows\...\powershell.exe`（`:15`）、`C:\ComfyUI\simple_ui\ui_control.ps1`（`:16`）；8188/7860（`:155-160,196,232`）；`C:\ComfyUI\logs`（`:203`） | 低：路徑全寫死 | 不需要；可列為選用 |
| `ui_panel.ps1` | 舊 WinForms 控制台（保留備用） | PowerShell 5.1 + `System.Windows.Forms` / `System.Drawing` + inline C# `Add-Type`（`:9-21`） | dot-source `ui_control.ps1`（`:23`）；8188/7860 顯示與開啟（`:104-105,137`） | 低 | 不需要；應標為 deprecated |
| `gen_assets.py` | 一次性批次生 17 張 UI 素材到 `assets/` | 標準庫 + 可用 ComfyUI + 指定 checkpoint | `COMFY = http://127.0.0.1:8188`（`:14`）、`CKPT = WAI-...`（`:17`）、Output 到 repo `assets/`（`:15-16,131-153`） | 中：路徑相對於 repo，但 model/port 寫死 | 不需要；素材已提交在 repo，一般使用者不應執行 |

結論：控制台三者都可安全列為**選用工具**。對公開使用者，最小流程完全不需要它們；目前 README 第一步就要求桌面捷徑（`README.md:27`），但 repo 內**沒有任何 `.lnk` 或建立捷徑的腳本**，這是文件與現況最大的落差之一。

---

## 7. WD14 選用功能現況

### 7.1 Repo 內實際有的東西

- 只有 `devtools/wd14_*.py` / `wd14_*.mjs` 測試腳本與 `devtools/wd14_review/` 紀錄、已提交的 `tag_categories.js` 分類資料（其表頭 `tag_categories.js:1` 說由 repo 外的 `tools/wd14-category-builder` 產生）。
- **沒有** Worker、推論核心、模型、venv、模型下載工具。 AGENTS.md:157-163 所列路徑全部在 `C:\ComfyUI\tools\` 與 `C:\ComfyUI\tmp\`（repo 外）。

### 7.2 使用者自行建立 WD14 環境需要的資源（僅列出，本次未下載/安裝）

- `tools/wd14_core.py`、`tools/wd14_worker.py`（可選 `wd14_tag.py` CLI、`wd14_download.py`）。
- 獨立 venv：Python 3.7+、onnxruntime（CPU only）、numpy、pillow（AGENTS.md:160,179-181）。
- 模型 `SmilingWolf/wd-eva02-large-tagger-v3`（及選用 ViT v3），`selected_tags.csv`（AGENTS.md:161,121）。
- 暫存目錄（預設 `C:\ComfyUI\tmp\wd14`，可用 `WD14_TMP` 覆寫）。

### 7.3 沒有 WD14 資源時的行為

- `server.py` 可正常啟動：`main()` 不檢查 WD14 資源，只啟動 TTL 清理執行緒（`server.py:1094-1097`），`purge_wd14_tmp()` 對不存在目錄直接回 0（`:268-272`）。
- 基本生圖、瀏覽、歷史不受影響；WD14 完全只在 `/api/reverse` 被呼叫時才會用到 Worker（`server.py:844-973`）。
- 反推 API 錯誤：`worker.submit()` 找不到 Python/Worker 時回 `503 {"ok":false,"code":"WORKER_ERROR","error":"找不到 WD14 Python/Worker…"}`（`server.py:315-317,959-962`）；暫存失敗 500 `TMP_FAIL`（`:937-939`）。
- UI 提示不足：反推 Modal 一律可用（`app.js:1497-1503`），沒有「未安裝」的停用狀態；錯誤被 `rvExplain()` 對應成「反推服務沒回應，按一下 F5 重新整理再試」（`app.js:1173`），對「根本沒裝」的情境是**誤導**。README 只說「需另裝工具，見根目錄 AGENTS.md」（`README.md:16`），而該 AGENTS.md 位於 repo 外，公開 clone 看不到。

---

## 8. README 過時敘述及具體位置

| README 位置 | 現有說法 | 程式碼實際行為 | 建議替代說法 |
|---|---|---|---|
| `:16` | 「一鍵 WD14…需另裝工具，見根目錄 AGENTS.md」 | repo 內沒有 AGENTS.md（它在 `C:\ComfyUI\AGENTS.md`，公開 clone 不會有）；WD14 所需檔案也全在 repo 外 | 改為「WD14 為選用功能，本 repo 不含 Worker/模型/venv；未提供時基本功能不受影響，反推會回錯。完整自建資源清單另文說明」 |
| `:21-23` | 「ComfyUI Windows portable 已安裝」、Python 用 embedded、控制枱需系統 Python 3.13 | 基本服務只需 stdlib，任何 Python 3.5+ 皆可；portable 只在代啟動時需要；3.13 是作者環境不是需求 | 拆分為「基本服務：Python 3.5+（建議 3.10+）；選用控制台：含 tkinter 的系統 Python 3.7+；ComfyUI 可任意安裝方式，只要本機 HTTP 可達」 |
| `:22` | 模型 `WAI-Nsfw-Illustrious-17.safetensors`（或其他 Illustrious 系列，**需自行改 workflow**） | workflow 由 `app.js:362-364` 動態組出，checkpoint 用 UI 下拉（`app.js:205-214`），**不需改 workflow** | 改為「任何本机已有的 checkpoint 都可在右欄選擇；不需要改 workflow」 |
| `:27` | 「雙擊桌面 `生圖控制台.lnk`」 | repo 沒有 `.lnk` 也沒有建立腳本；控制台路径寫死開發者目錄 | 改為選用章節：「控制台僅供原開發者環境；公開使用者請用 `python server.py`」 |
| `:28` | 「`python server.py`（假設 ComfyUI 已在 8188）」 | 可用 `COMFY_URL` 指向任意本機 port / HTTPS；不再假設輸出路徑 | 補充「若 ComfyUI 不在 8188，先設 `COMFY_URL`；例：`$env:COMFY_URL='http://127.0.0.1:8189'`」 |
| `:31` | 「圖片輸出預設 `D:\ComfyUI_output`」 | 已移除硬編碼（`server.py:78-103`）；未設定時刪圖/開資料夾停用 | 改為「輸出位置由你的 ComfyUI 決定；若要刪圖，請設 `COMFY_OUTPUT_DIR` 指向同一資料夾」 |
| `:56-58` | 「`ui_panel.pyw`、`ui_control.ps1` 與 `server.py` 內含本機路徑…請依環境修改」 | `server.py` 已無 `D:\ComfyUI_output`；但 console 兩檔與 `ui_control.ps1:104` 仍有 | 改為「控制台與 `ui_control.ps1` 仍含開發者路徑，公開使用者不要使用；基本服務不需修改任何檔案」 |
| `:11,16` | 「無外部依賴」 | 對前端與 server.py 成立；但 WD14 與 `tag_categories.js` 產生工具在 repo 外 | 限縮語意：「基本服務無第三方套件；選用 WD14 需另行自建環境」 |
| 整體 | 沒有更新／備份／解除安裝／常見錯誤章節 | — | 補上極短章節：更新=拉取後重啟；備份=`ui.gallery` 等 localStorage；解除安裝=停行程+刪資料夾；常見錯誤=port 衝突、ComfyUI 未啟動、輸出目錄不一致 |
| `:62` | 授權 `Fair AI Public License 1.0-SD` | `LICENSE:1` 完全一致 | 無誤，保留 |

其餘設計約束（`README.md:45-54`）與程式碼一致：前端走 `/ws` 隧道、靜態白名單、`ui.extra`、`sel/combos/adult`、一屏不捲動、hover 不變尺寸、系統字、`/api/check`。

---

## 9. 最小公開部署方案

### 9.1 建議流程（與目前架構最一致）

1. 使用者自行安裝 ComfyUI（任意安裝方式）並啟動，確認本機 HTTP 可達。
2. Clone / 下載 repo 到任意資料夾。
3. （可選）若 ComfyUI 不在 8188：`$env:COMFY_URL = "http://127.0.0.1:8189"`。
4. （可選）若 7860 被佔：`$env:SIMPLE_UI_PORT = "7861"`。
5. `python server.py`。
6. 瀏覽 `http://127.0.0.1:7860`（或新 port，前端會自動跟）。
7. 需要刪圖時才設 `COMFY_OUTPUT_DIR`，重啟 server；WD14 完全略過。

### 9.2 是否需要新增檔案（逐項評估）

| 項目 | 需要？ | 理由與維護成本 |
|---|---|---|
| `requirements.txt` | **不需要** | 基本服務只用標準庫（`:11-26`）；新增反而讓使用者誤以為要 `pip install`，且 WD14 用的是 repo 外獨立 venv，寫在這裡也是誤導。 |
| `.env` / 設定檔讀取器 | **不需要** | 目前只有 3 個使用者會碰的環境變數，`set` 一次即可；新增 dotenv 解析器反而需要第三方套件或自建讀取邏輯，與「零依賴」衝突。 |
| 啟動 `.bat` / PowerShell 腳本 | **可選，P1** | 一個 10 行以內的 `start.bat`（設 `COMFY_URL` / `COMFY_OUTPUT_DIR` + `python server.py` + pause）可大幅降低 Windows 使用者設定環境變數的門檻；成本低，但要注意不要重構成第二套啟動器。 |
| Installer | **不需要** | 无安装步骤：解壓即用；新增 installer 會引入打包、路徑、卸載、更新等全新維護面。 |
| 桌面捷徑建立腳本 | **不需要**（P2 再考慮） | 目前 repo 就沒有；與其維護 `.lnk` 產生器，不如先把 README 改成「開浏览器網址」即可。 |
| `docs/WD14.md` 或 repo 內 `AGENTS.md` | **P1** | 修復 `README.md:16` 的斷鏈，並把選用功能資源清單寫進公開可得的位置。 |

---

## 10. P0 / P1 / P2 待辦與排序理由

排序原則：先處理「讓第一次啟動失敗或走錯路」的問題，再處理「誤導但不阻擋」的問題，最後是無法立即驗證或屬改善性質的事項。

### P0 — 阻擋首次使用／造成誤操作

1. **重寫 README 的「需求」與「怎麼跑」**（`README.md:18-31,56-58`）。目前第一步指向不存在的桌面捷徑、輸出目錄說法已過時、Python/ComfyUI 需求描述混淆；這是公開使用者最可能卡住的地方。理由：程式本身已可在零設定下跑，文件卻引導到錯誤路徑。
2. **把桌面控制台明確標為選用／不適用公開使用者**（README `:27` 與 `ui_control.ps1:13-16,104`、`ui_panel.pyw:15-16`）。理由：照現有文件操作會啟動開發者路徑的 ComfyUI 並把輸出改到 `D:\ComfyUI_output`，甚至殺掉使用者自己的 ComfyUI。
3. **修正 `README.md:22` 的 checkpoint / workflow 說法**。理由：會讓使用者以為必須改程式才能用自己的模型，但實際上只要選下拉。

### P1 — 影響理解與選用功能可信度

4. **補一份 repo 內的 WD14 選用說明**（可放在 README 新章節或 `docs/WD14.md`），移除對 repo 外 AGENTS.md 的依賴（`README.md:16`）。理由：公開 clone 完全看不到所需資源清單。
5. **修正 WD14 缺失時的 UI 錯誤文案**（`app.js:1173`）。理由：目前叫使用者「按 F5 再試」，但問題是沒裝工具，重試永遠不會成功。屬程式碼修改，需另行授權。
6. **提供可選 `start.bat`**（新檔，P1）。理由：降低 Windows 環境變數設定門檻；但應保持極小，不做成第二套啟動器。
7. **補充更新／備份／解除安裝／常見錯誤**（README 新增短章）。理由：公開 Repo 基本文件完整性。

### P2 — 改善與風險收尾

8. **文件化 `tag_categories.js` 的產生來源**（`tag_categories.js:1`，工具在 repo 外）。理由：避免後人誤以為可隨意重生。
9. **評估控制台可移植化**（`ui_control.ps1`、`ui_panel.pyw` 改用 `$PSScriptRoot` / `__file__` 推导路徑）。理由：目前對公開使用者無用，重構收益低；應先完成 P0 文件隔離再考慮。
10. **補 Python 版本下限與跨版本驗證的最低文件宣告**。理由：本報告已從 API 推導出 3.5/3.7，但沒有實際在 3.5 環境跑過（見第 12 節）。

---

## 11. 每項建議涉及的檔案及預期影響

| 建議 | 涉及檔案 | 預期影響 | 風險 |
|---|---|---|---|
| P0-1 重寫需求/啟動/路徑說明 | `README.md:18-31,56-58` | 公開使用者能照做；不影響程式 | 低，純文件 |
| P0-2 控制台標為選用 | `README.md:27`（以及可選在 `devtools/README.md` 加註） | 避免誤啟動開發者 ComfyUI | 低；不改控制台程式 |
| P0-3 checkpoint 說法 | `README.md:22` | 避免不必要改 workflow | 低 |
| P1-4 WD14 文件 | `README.md:16` 或新增 `docs/WD14.md` | 修斷鏈；清楚區分選用功能 | 低 |
| P1-5 WD14 錯誤文案 | `app.js:1173` | 錯誤提示从「按 F5」改為「未安裝工具」 | 低，但需回歸前端測試 |
| P1-6 啟動 bat | 新增 `start.bat`（或 `start-ui.bat`） | 降低設定門檻 | 中：避免變成第二套啟動器、避免寫死路徑 |
| P1-7 常見錯誤章節 | `README.md` 新增 | 自我排查 | 低 |
| P2-8 標註 tag_categories 來源 | `README.md` 或 `devtools/README.md` | 可維護性 | 低 |
| P2-9 控制台可移植化 | `ui_control.ps1:13-16,104`、`ui_panel.pyw:15-16` | 可選工具變可用 | 中高：屬重構，本次明確不應做 |
| P2-10 Python 版本宣告 | `README.md` | 與本報告一致 | 低，但需先實際驗證舊版 |

---

## 12. 尚未確認的事項及風險

1. **Python 3.5/3.7 下限是從 API 引入版本推導**（Context7/CPython 文件：`commonpath` 3.5、`ssl.create_default_context` 3.4、`Request.method` 3.3、`Popen(text=)` 3.7），**沒有實際在這些舊版解釋器執行過**；本機只有 3.13.15 / 3.13.14。
2. **沒有實際在全新使用者環境做端到端安裝**：未建立新資料夾、未 clone、未用外部 ComfyUI port 實跑。最短流程是靜態推導。
3. **Port 衝突與非法 `SIMPLE_UI_PORT` 的實際錯誤畫面未實測**（只讀程式碼：無 try/except）。
4. **HTTPS ComfyUI 的 WS 隧道僅程式碼支援**（`server.py:988`），未實測。
5. **控制台停止行為的實際影響範圍未實測**；文件上是「比對完整路徑」，但公開使用者 ComfyUI 路徑多樣，仍可能誤殺。
6. **README 的 AGENTS.md 連結**： repo 內確認沒有 AGENTS.md；公開 clone 是否另附文件無法從本機驗證。
7. **`tag_categories.js` 的產生工具在 repo 外**，其授權／來源無法只從本機確認。
8. 基本服務仍假定 ComfyUI 在同一台電腦（loopback 限制，`server.py:44-45`）；LAN/遠端不在範圍。
9. 公開使用者若完全不設 `COMFY_OUTPUT_DIR`，刪圖與開資料夾是停用狀態；README 必須講清楚，否則會被當成 bug。

---

## 13. 正式服務是否受到影響

**未受影響。**

- 未啟動、停止或重啟 ComfyUI、`simple_ui/server.py`、WD14 Worker。
- 未執行生圖、反推或任何高負載測試。
- 未修改任何程式碼、README、設定、測試、既有報告、圖片、localStorage 或環境變數。
- 未安裝或更新套件、未下載模型。
- 唯一新增檔案為本報告 `devtools/reports/open-source-readiness-phase2c.md`；Git 狀態仍為 `main` / HEAD `12ad15ae...` / 無已追蹤修改，僅未追蹤報告增加一份。

**已停止，等待 ChatGPT 獨立審查。**
