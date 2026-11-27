# Open-Source Readiness — Phase 3：乾淨環境部署驗證

## 0. 結論摘要

以公開 `origin` 乾淨 Clone + 隔離環境（系統 Python 3.13.15、Mock ComfyUI、獨立 Port、獨立輸出目錄）驗證：

- **基本生圖前端服務可在沒有開發者本機環境、沒有 WD14 資源的情況下啟動並提供完整基本流程**（HTTP 20/20 通過、瀏覽器端 0 個 JS 錯誤、Mock 結果可正確渲染成歷史縮圖）。
- **但乾淨 Clone 仍內含多處硬編碼開發者路徑**（`C:\ComfyUI\logs`、`C:\ComfyUI\tools\...`、`C:\ComfyUI\tmp\wd14`、`C:\ComfyUI\ComfyUI_windows_portable`）。實測確認：即使沒有 WD14 資源，main() 仍可啟動；但無 WD14 環境變數覆寫時，反推請求會直接找到 developer 本機的 WD14 Worker，並寫入 developer 本機 log。此為本次最重要發現。
- 全程**未修改正式 Repo 程式碼、未 commit/push、未停止重啟任何正式服務**。

結果分類 legend：`【實際執行通過】`、`【隔離測試通過】`、`【靜態檢查通過】`、`【未執行／無法驗證】`。

---

## 1. 任務目標

驗證公開 GitHub Repo 能否讓一般 Windows 使用者從乾淨 Clone 開始，用自己的系統 Python、自己啟動的 ComfyUI，執行 `python server.py` 後使用基本生圖功能，且不安装 WD14 也不受影響。本次為部署可行性驗證，不是功能開發或架構重構。

---

## 2. 測試機器 Python 版本及環境

| 項目 | 值 |
|---|---|
| OS | Windows 11（win32） |
| Python | 3.13.15 `tags/v3.13.15:4061bc4, Aug 5 2026` MSC v.1944 64-bit |
| 執行檔 | `C:\Users\user\AppData\Local\Programs\Python\Python313\python.exe` |
| `websocket-client` | 未安裝（False） |
| `onnxruntime` | 未安裝（False） |
| `PIL` / `numpy` | 已安裝（True / True），但 `server.py` 完全未使用 |
| Node（僅語法檢查） | 可用，`node --check` 全部 exit 0 |

`server.py` 的 import 清單（靜態檢查）：`base64, hashlib, http.server, json, mimetypes, os, select, socket, socketserver, subprocess, sys, threading, time, urllib.error, urllib.parse, urllib.request` — **全部為 Python 標準庫**，無第三方套件。 `【靜態檢查通過】`

---

## 3. 開始前 Git / 服務狀態

### 3.1 Repo 與 Git 狀態 `【實際執行通過】`

- Repo 路徑：`C:\ComfyUI\simple_ui`（依 `C:\ComfyUI\AGENTS.md`，唯一本專案 repo）
- Branch：`main`
- HEAD：`76da5a5f4f480f63fca679ccb3435bff7320a8c5`
- Remote：
  - fetch `https://github.com/Sid-1996/sid-comfyui-simple-ui.git`
  - push `https://github.com/Sid-1996/sid-comfyui-simple-ui.git`
- `git fetch origin` 後：`origin/main` = `76da5a5f4f480f63fca679ccb3435bff7320a8c5`
- `git merge-base --is-ancestor 76da5a5... origin/main` → exit 0（**包含 Phase 2C Commit**）
- `git rev-list --left-right --count HEAD...origin/main` → `0  0`（完全同步）
- 工作區：tracked 檔案乾淨；既有 7 份未追蹤報告完整保留：
  - `devtools/reports/open-source-readiness-phase1.md`
  - `...-phase2a.md`、`...-phase2b1.md`、`...-phase2b2.md`、`...-phase2b3.md`
  - `...-phase2c-implementation.md`、`...-phase2c.md`
- 既有未追蹤檔案（`_tag_stats_test_report.json`、`tag-learning-phase1.md`、`devtools/wd14_review/` 等）未觸碰。

### 3.2 正式服務與 Port `【實際執行通過】`

- 開始前與結束後：`Get-NetTCPConnection -LocalPort 7860,8188` 均未觀察到 Listen。
- **未**停止、重啟、修改正式 ComfyUI / simple_ui / WD14 Worker，未修改正式環境變數、模型、Workflow 或輸出圖片。
- 未使用 `Stop-Process python` 之類模糊比對；所有測試程序終止前皆以 `Get-CimInstance Win32_Process` 核對完整 CommandLine 與 PID。

### 3.3 已閱讀規範

`C:\ComfyUI\AGENTS.md`（280 行）、`simple_ui\README.md`（232 行）、`simple_ui\SECURITY.md`、`.github/` 結構。

---

## 4. 乾淨 Clone

| 項目 | 值 |
|---|---|
| 測試根目錄 | `C:\Users\user\AppData\Local\Temp\sid-simple-ui-phase3-20261123-104943`（已於結束時移除） |
| Clone 路徑 | `<above>\clone` |
| 指令 | `git clone https://github.com/Sid-1996/sid-comfyui-simple-ui.git <base>\clone` |
| Branch | `main` |
| HEAD | `76da5a5f4f480f63fca679ccb3435bff7320a8c5`（含 Phase 2C，ancestor 檢查 exit 0） |

Clone 頂層檔案清單：`.git/`, `.github/`, `assets/`, `devtools/`, `.gitignore`, `LICENSE`, `README.md`, `SECURITY.md`, `app.css`, `app.js`, `dict.js`, `gen_assets.py`, `index.html`, `r18.json`, `server.py`, `tag_categories.js`, `tags.js`, `ui_control.ps1`, `ui_panel.ps1`, `ui_panel.pyw`。

依需求「是否依賴開發者本機路徑」的檢查 `【實際執行通過】`：

| 項目 | Clone 內是否存在 |
|---|---|
| `tools/wd14_worker.py` | ❌ |
| `tools/wd14-venv/` | ❌ |
| `tools/wd14_vit_worker.py` | ❌ |
| `tools/models/wd14/` | ❌ |
| 任何 `wd14_worker.py`（遞迴） | ❌ |

但請注意：`devtools/` **確實包含** `wd14_api_test.py`、`wd14_gen_test.mjs`、`wd14_perf_test.py`、`wd14_race_test.py`、`wd14_tmpfile_test.py`、`wd14_ui_429_test.mjs`、`wd14_ui_test.mjs` 與 `devtools/wd14_review/` 報告。也就是「測試腳本隨 Repo 公開，但其實作的 Worker/模型/venv 沒有」。此點與 README 的說法一致，但一般使用者可能誤以為有測試腳本就代表功能可用。

全程使用 Clone 目錄啟動；未複製 ComfyUI portable、模型、輸出圖片或私人設定；測試產物全部放在 `<base>` 下（已刪除）。

---

## 5. 隔離測試環境設計

| 項目 | 值 |
|---|---|
| Mock ComfyUI Port | `58045`（bind 前確認無監聽） |
| simple_ui Port | `58046`（bind 前確認無 Listen；曾有 39 個 TIME_WAIT，但可成功 bind） |
| `COMFY_URL` | `http://127.0.0.1:58045` |
| `COMFY_OUTPUT_DIR`（第一輪） | **未設定** |
| `COMFY_OUTPUT_DIR`（第二輪） | `<base>\test_output` |
| `WD14_TMP`（測試覆寫） | `<base>\wd14_tmp` |
| `WD14_PY` / `WD14_WORKER`（測試覆寫） | `<base>\no_wd14\python.exe` / `<base>\no_wd14\wd14_worker.py`（皆不存在） |
| `WD14_VIT_PY` / `WD14_VIT_WORKER`（測試覆寫） | `<base>\no_wd14\vit_python.exe` / `<base>\no_wd14\wd14_vit_worker.py`（皆不存在） |

環境變數只在 `Start-Process` 前的該次 PowerShell 行程內設定，啟動後立即清除，未寫入系統或使用者環境變數。Mock 與 simple_ui 都只用系統 Python（3.13.15），非 ComfyUI embedded Python。

### 5.1 一個重要的測試偏差（誠實揭露）

第一輪最初**未覆寫 `WD14_PY` / `WD14_WORKER`**，直接以乾淨 Clone 的預設值執行 `/api/reverse`。結果回傳 **HTTP 200 且含真實反推標籤**（`blue_theme`、`monochrome`、`no_humans`…，`inference_seconds: 5.1`），並確認測試 server（PID 2488）spawn 了：

```
PID 14220  C:\ComfyUI\tools\wd14-venv\Scripts\python.exe C:\ComfyUI\tools\wd14_worker.py
PID 7136   （其子行程，持有模型）
```

也就是**乾淨 Clone 在預設環境下確實會觸發開發者本機的 WD14 Worker**。這違反本次「不得使用 developer 本機 WD14」的隔離要求，因此該結果**不計入 WD14 缺失驗證**，已立即終止測試 server（WD14 worker 隨之在數秒內退出），並加上上述 `WD14_*` 覆寫後重跑第一輪。此偏差同時是本次最關鍵的部署風險證據（見第 18 節）。

---

## 6. Mock ComfyUI 實作的端點及格式依據

Mock 為 `<base>\mock_comfy.py`，**只用 Python 標準庫**，無 Pillow / numpy / 第三方套件。格式依據來自逐行閱讀 `server.py` 與 `app.js`，非臆測：

| Mock 端點 | 格式依據 | 回傳 |
|---|---|---|
| `GET /system_stats` | `app.js:149` `checkComfy()` 以此判斷 ComfyUI 是否連線 | `{"system":{"comfyui_version":"mock-phase3"},"devices":[]}` |
| `GET /object_info/CheckpointLoaderSimple` | `app.js:206-207` 讀 `j.CheckpointLoaderSimple.input.required.ckpt_name[0]` | `{"CheckpointLoaderSimple":{"input":{"required":{"ckpt_name":[["WAI-...safetensors","mock-model-v2.safetensors"]]}},"output":[...]}}` |
| `POST /prompt` | `app.js:449-455` 送 `{prompt: wf}`，讀 `res.prompt_id` | `{"prompt_id":"phase3-prompt-0001","number":1,"node_errors":{}}` |
| `GET /history/<pid>` | `app.js:539-545` 讀 `hs[pid]`；`app.js:471-481` 讀 `status.status_str` / `outputs["7"].images` | `{pid:{status:{status_str:"success",messages:[...]},outputs:{"7":{images:[{filename,subfolder,type}]}}}}` |
| `GET`/`HEAD /view?filename=&subfolder=&type=` | `server.py:663-669`（`/_check_files`  HEAD）、`server.py:684-699`（`/_view_status`）、`server.py:768-789`（GET + SHA-256） | 實際測試 PNG 位元組（48×48，`\x89PNG...`），HEAD 只送 header |
| `POST /queue`、`POST /interrupt` | `app.js:462-464`、`560-562` 取消流程 | `{}` |
| `GET /ws` (Upgrade) | `server.py:977-1049` `_ws_tunnel()` 原封不動轉送 frame，並改寫 Host/Origin | 101 handshake + 5 個**未遮蔽(unmasked)** text frame：`status`、`execution_start`、`progress`×2、`executing` |
| 其他 | — | 404 |

Mock 將所有收到的請求寫入 `mock_requests.jsonl` 供事後核對。實測計數：

```
GET /system_stats                          11
GET /object_info/CheckpointLoaderSimple     6
POST /prompt                                4
GET /history/phase3-prompt-0001             4
GET /view                                   6
HEAD /view                                  9
WS /ws                                     75   （Mock 送完 frame 即關，前端退避重連所致）
```

Mock 本身有兩次修正（皆只改測試腳本，未動正式程式）：
1. 測試 PNG 由 8×8 改為 48×48，以通過 `server.py` 的 `WD14_MIN_DIM=16`。
2. WS frame 原本錯誤地設定 mask bit（`0x80|n`）但沒有 mask key，瀏覽器回 `A server must not mask any frames that it sends to the client`；改為 RFC 6455 正確的 unmasked server frame 後，瀏覽器 console 錯誤歸零。
3. frame 延後 0.4 秒送出，因為 `server.py:1005-1013` 讀取 upstream handshake 時，同一 TCP chunk 中多餘的 bytes 不會被轉送給客戶端（見第 18 節風險 R2）。

---

## 7. HTTP API 代理驗證結果 `【隔離測試通過】`

第一輪（無 `COMFY_OUTPUT_DIR` + 完整 WD14 隔離覆寫）共 20/20 通過，實際命令：

```
$env:COMFY_URL='http://127.0.0.1:58045'; $env:SIMPLE_UI_PORT='58046'
$env:WD14_TMP=...; $env:WD14_PY=...; $env:WD14_WORKER=...  # 不存在路徑
Remove-Item Env:\COMFY_OUTPUT_DIR
Start-Process python -ArgumentList server.py -WorkingDirectory <base>\clone ...
python <base>\checks_r1.py
```

| 檢查 | 結果 |
|---|---|
| `GET /` | 200，20257 bytes HTML |
| 靜態 `/app.css`、`/app.js`、`/tags.js`、`/dict.js`、`/tag_categories.js`、`/r18.json` | 全部 200，Content-Type 正確（`.js` → text/javascript; charset=utf-8，`.json` → application/json; charset=utf-8） |
| `GET /api/status` | `{"comfy":true,"output":"","external":true,"output_ok":false,"output_error":"尚未設定 COMFY_OUTPUT_DIR"}` |
| `GET /comfy/system_stats` | 200，Proxy 正確回傳 Mock 內容 |
| `GET /comfy/object_info/CheckpointLoaderSimple` | 200，讀到 2 個 checkpoint |
| `POST /comfy/prompt` | 200，`prompt_id=phase3-prompt-0001` |
| `GET /comfy/history/<pid>` | 200，`outputs["7"].images` 含 1 張圖 |
| `GET /comfy/view` | 200，123 bytes，PNG magic 正確 |
| `HEAD /comfy/view` | 200，body 0 bytes |
| `POST /api/check` | `{"missing":[],"comfy":true,"total":1}` |
| `GET /open-output`（未設定輸出目錄） | 409 `OUTPUT_DIR_UNSET`，中文指示正確 |
| `POST /api/delete`（未設定輸出目錄） | 409 `OUTPUT_DIR_UNSET`，圖片與紀錄都還在 |
| `POST /start-comfy` | 409 `EXTERNAL_COMFY`，**未觸發 developer ComfyUI 啟動流程** |
| `POST /api/reverse`（WD14 不存在） | 503 `WORKER_ERROR`，訊息指向隔離測試的不存在路徑，**不含** `C:\ComfyUI\tools` |
| `WS /ws` | 101 + `progress`/`execution_start` frame 成功穿透 |

第二輪（設定 `COMFY_OUTPUT_DIR`）7/7 通過，見第 11 節。

---

## 8. WebSocket 驗證結果 `【隔離測試通過】`

- 以原始 socket 手動送出 `GET /ws?clientId=...` + `Upgrade: websocket` + `Sec-WebSocket-Key`，收到 `HTTP/1.1 101 Switching Protocols`，並在 payload 中收到 Mock 的 `status` / `execution_start` / `progress` frame。
- 瀏覽器端（真實 Chromium，`http://127.0.0.1:58046/?phase3=1`）在修正 Mock frame 遮蔽問題後，**console 錯誤數 = 0**；狀態列顯示 `ComfyUI 已連線`（`data-state=up`）。
-  tunnels 全程經過 `server.py::_ws_tunnel()`，前端未直連 Mock 的 58045。
- 限制：Mock 只驗證隧道與 frame 轉送，**未驗證真實 ComfyUI 的 WebSocket 語意或進度時序**。

---

## 9. Checkpoint / Prompt / History / View 驗證結果 `【實際執行通過（瀏覽器端）】`

在真實瀏覽器完成一次 Mock 支援的完整生成流程：

1. 頁面載入後 `#ckpt` 下拉自動出現 `WAI-Nsfw-Illustrious-17.safetensors`、`mock-model-v2.safetensors`（來自 Mock `/object_info`）。
2. 以 `document.querySelector('#go').click()` 觸發生成；network 記錄到 `POST /comfy/prompt` 與 `GET /comfy/history/phase3-prompt-0001`。
3. `#stageProgress` 隱藏、`#stageResults` 顯示，`#stageResults` 內產生 `<img src="/comfy/view?filename=phase3_test_image.png...">`。
4. `localStorage['ui.gallery']` 長度從 0 變 1。
5. 將 lazy-load 的結果圖捲入可視範圍後，`img.complete=true`、`naturalWidth=48`、`naturalHeight=48`，確認圖片是經由 `/comfy/view` 真正解碼，不是破圖。
6. 全程 console 錯誤數 = 0。

**這不是真實 GPU 生圖**；Model / Workflow / KSampler 皆未執行，只有 API 契約與前端渲染被驗證。

---

## 10. 未設定輸出目錄的驗證結果 `【隔離測試通過】`

- 基本生圖、結果渲染、歷史寫入、`/api/check`、`/comfy/view` 全部正常（第 7、9 節）。
- `/open-output` → 409 `OUTPUT_DIR_UNSET`，訊息：「尚未設定有效的 COMFY_OUTPUT_DIR，無法開啟圖片資料夾。請在啟動 server.py 前設定為你的 ComfyUI 輸出資料夾。」
- `/api/delete` → 409 `OUTPUT_DIR_UNSET`，訊息明確說「已取消刪圖…圖片與紀錄都還在」。
- `/api/status` 回 `output:""`、`output_ok:false`、`output_error:"尚未設定 COMFY_OUTPUT_DIR"`，前端能正確停用相關按鈕。
- 未自動猜測 `D:\ComfyUI_output` 或任何 developer 輸出目錄。

---

## 11. 設定輸出目錄的驗證結果 `【隔離測試通過】`

第二輪：建立 `<base>\test_output`，放入與 Mock `/view` 完全相同的測試 PNG（SHA-256 `903136BB774F88751180D680E527ACE23B8CA7C34444B35D4656CE76120C4961`），重新啟動隔離 server。

| 檢查 | 結果 |
|---|---|
| `GET /api/status` | `output` = `<base>\test_output`、`output_ok:true`、`output_error:""` |
| `GET /open-output` | 200 `{"ok":true,"output":"<base>\\test_output"}`（實際觸發 `os.startfile`，短暫開啟了該測試資料夾視窗） |
| 刪先前測試圖 | 200 `{"ok":true,"status":"deleted","recycled":true}`，檔案從測試輸出目錄消失（進資源回收筒） |
| path traversal `filename=../evil.png, subfolder=..` | 400 `FORBIDDEN_PATH` |
| `type=temp` | 400 `TYPE_NOT_ALLOWED` |
| 正式輸出圖片 | 完全未操作（本機正式輸出路徑未被設定） |

SHA-256 比對流程因此被實際走過一次：Mock `/view` 內容與本機測試檔一致才允許回收。

---

## 12. WD14 缺失情境驗證結果

- Clone 內 Worker / 模型 / venv 不存在（第 4 節）。 `【實際執行通過】`
- 加上 `WD14_*` 隔離覆寫後：
  - `POST /api/reverse` → 503 `WORKER_ERROR`：「找不到 WD14 Python：`<base>\no_wd14\python.exe`」。 `【隔離測試通過】`
  - 瀏覽器實測：在 `#revFile` 放入測試圖、按「反推標籤」後，`#revError` 顯示「**WD14 反推功能尚未安裝或未完成設定，所以這張圖沒有分析了。基本生圖不受影響，可以繼續用；若要啟用反推，請先準備 WD14 的 Worker、模型與 Python 環境。**」（`app.js:1174-1175` 的 WORKER_ERROR + 「找不到 WD14」分支）。 `【實際執行通過（瀏覽器端）】`
  - 主服務、生圖、/WebSocket 全部不受影響；狀態列仍為 `ComfyUI 已連線`。
  - 沒有觸發任何安裝、下載或模型搜尋行為。
- 未執行：在完全沒有 `C:\ComfyUI` 資料夾的機器上，以**預設環境變數**觸發 `/api/reverse` 的錯誤訊息（見第 15 節）。此處以隔離覆寫代替，避免再次碰到 developer Worker。
- 已知風險：預設 `WD14_PY` / `WD14_WORKER` / `WD14_TMP` 是 developer 絕對路徑（第 5.1 節已實際觀察到）。

---

## 13. README 使用流程核對 `【靜態檢查通過】`

| README 說法 | 程式實際行為 | 一致性 |
|---|---|---|
| Windows 10/11、Python 3.10+ 建議（最低 3.5） | `server.py` 只用 stdlib，`%` 格式化，無 f-string | ✅（3.10+ 建議合理） |
| 基本服務不需 `pip install` | import 全是 stdlib | ✅ |
| ComfyUI 由使用者自行安裝啟動 | `COMFY_URL` 設定後 `/start-comfy` 回 409 拒絕代啟動 | ✅ |
| `python server.py` 直接用 | 測試中以此指令啟動成功 | ✅ |
| 預設 Port 7860 | `main(): int(os.environ.get("SIMPLE_UI_PORT","7860"))` | ✅ |
| `COMFY_URL` 只 loopback、需含 port | `_parse_comfy_url()` 逐項驗證 | ✅ |
| `COMFY_OUTPUT_DIR` 非必要，未設定時刪圖/開資料夾停用 | 實測 409 + status 欄位 | ✅ |
| `SIMPLE_UI_PORT` 說明 | 實測 58046 生效 | ✅ |
| 不要求改 Workflow / 取得私人檔案 | 前端用固定 workflow，checkpoint 由 ComfyUI 提供 | ✅ |
| WD14 選用、公開 Repo 不含資源、尚無安裝指引 | Clone 內無 Worker/模型/venv；錯誤訊息白話 | ✅（但見下） |
| 桌面控制台不是必要步驟 | README 明確標為 developer 輔助工具、請勿使用 | ✅ |
| 不要求不存在的套件 | 無 | ✅ |

**README 與實際行為的落差（只記錄，不修改）**：

1. README 未提到 `server.py` 有多處硬編碼 developer 絕對路徑（`COMFY_ROOT`、`LOG_DIR`、`WD14_PY`、`WD14_WORKER`、`WD14_VIT_PY`、`WD14_VIT_WORKER`、`WD14_TMP`）。一般使用者若照 README 什么都「不設定」，仍可能寫入 `C:\ComfyUI\logs\gen_requests.jsonl`，且若有 WD14 Worker 存在會被直接呼叫。README 說「一般使用者不需要設定任何 `WD14_*` 環境變數」在低階無法完全成立的環境中容易誤導。
2. README 說「Clone 之後不能假設反推功能已經可用」是對的，但沒說「若這台機器剛好有 developer 的路徑，反而會『意外可用』」。

---

## 14. 每項測試的實際命令及結果（摘錄）

| 項目 | 命令 | 結果 |
|---|---|---|
| 前chk Git | `git -C C:\ComfyUI\simple_ui rev-parse HEAD` / `rev-list --left-right --count HEAD...origin/main` | `76da5a5...` / `0 0` |
| Phase 2C 確認 | `git merge-base --is-ancestor 76da5a5... origin/main` | exit 0 |
| Port 占用 | `Get-NetTCPConnection -LocalPort 7860,8188` | 無 Listen |
| Python 環境 | `python --version`、`python -c "..."` | 3.13.15；websocket-client=False, onnxruntime=False |
| 乾淨 Clone | `git clone https://github.com/... <base>\clone` | HEAD `76da5a5`，branch `main` |
| 啟動 Mock | `python <base>\mock_comfy.py 58045`（`$env:MOCK_OUT_DIR=...`） | `MOCK_READY` |
| 啟動 simple_ui | `python server.py`（工作目錄 `<base>\clone`） | PID 13992 / 15188，HTTP 可達 |
| Round 1 | `python <base>\checks_r1.py` | 20 pass / 0 fail |
| Round 2 | `python <base>\checks_r2.py` | 7 pass / 0 fail |
| 語法檢查 | `python -m py_compile server.py`；`node --check app.js tags.js dict.js tag_categories.js` | 全部 exit 0 |
| 瀏覽器 | `browser.tabs.open` → `snapshot`/`evaluate`/`console`/`network.list` | console 0 錯誤，生成流程與反推訊息皆正確 |
| 清理 | `Stop-Process -Id <已核對 PID> -Force`；`Remove-Item <base> -Recurse -Force` | 程序消失、port 釋放、目錄不存在 |

---

## 15. 未執行／無法驗證的項目 `【未執行／無法驗證】`

1. **真實 ComfyUI 生圖**：不得連 8188、不得 GPU 推論；仅以 Mock 驗證 API 契約。
2. **真實模型載入 / Workflow 執行**：同樣受隔離限制。
3. **完全沒有 `C:\ComfyUI` 資料夾的全新機器**：本機已有該目錄，無法移除；因此「預設 WD14 路徑不存在」的錯誤訊息只以變數覆寫模擬。
4. **真實 ComfyUI WebSocket 進度時序**：Mock 只送固定 frame。
5. **`os.startfile` 在無桌面環境行為**：本機為 Windows 桌面，實測會開 Explorer；其他環境未測。
6. **不同解析度版面完整量測**：瀏覽器 pane 為 1000×700，观察到 `scrollHeight=1444 > innerHeight=700`（垂直可捲、`scrollWidth=990 <= innerWidth=1000`）。此為小視窗下的觀察，未在 1920×1080 等典型解析度驗證，不影響部署結論。
7. **未安裝任何第三方套件的能力**：以「無 websocket-client / 無 onnxruntime 的系統 Python 成功啟動」與「import 全 stdlib」雙重驗證，但未建立全新 Windows 使用者帳號測試。

---

## 16. 正式服務是否受到影響

- 正式 ComfyUI / simple_ui / WD14 Worker：**未**停止、**未**重啟、**未**修改。開始與結束時 7860/8188 皆無監聽。
- 正式 Repo 程式碼：**未修改**、未 stage、未 commit、未 push、未 reset/rebase/stash/checkout/clean。
- 既有 7 份未追蹤報告與其他既有檔案：完整保留。
- **已知副作用（誠實揭露）**：`server.py` 的 `LOG_DIR = r"C:\ComfyUI\logs"` 是硬編碼，測試期間 `_log_gen_request()` 在 `C:\ComfyUI\logs\gen_requests.jsonl` 追加了 3 行（request_id `phase3-r1` ×2、`G1-mwso8hvb` ×1）。此外第 5.1 節的一次反推啟動了 developer WD14 Worker 並寫入其 worker log；該 Worker 已隨測試 server 結束而退出（事後查詢無 `wd14_worker.py` 行程）。這些是透過正式程式既有寫入路徑產生，**未手動编辑或刪除任何正式紀錄**。

---

## 17. 測試程序與臨時檔案清理結果 `【實際執行通過】`

| 項目 | 處理 |
|---|---|
| simple_ui 測試程序 | PID 2488、13992、15188 皆先核對 CommandLine 再 `Stop-Process`，最後確認 `alive=False` |
| Mock 程序 | PID 5224、6328、9484、14592 同樣核對後終止 |
| WD14 Worker | 由測試 server spawn，server 終止後自行退出；最終查询 `wd14_worker.py` 行程數 = 0 |
| 瀏覽器分頁 | 2 個測試 tab 皆以 `browser.tabs.close` 關閉 |
| 測試圖片 / 輸出目錄 / Clone / Mock 腳本 / log | 全部位於 `<base>`，以 `Remove-Item <base> -Recurse -Force` 移除；`Test-Path = False` |
| 測試 Port | 58045、58046 Listen 數皆為 0 |
| 指針檔 `%TEMP%\sid-phase3-base.txt` | 已刪除 |
| 正式 Port 7860/8188 | 未更動（全程無 Listen） |

---

## 18. 發現的問題、風險及建議

| ID | 嚴重度 | 問題 | 證據 | 建議 |
|---|---|---|---|---|
| R1 | 中 | **硬編碼 developer 路徑**：`COMFY_ROOT`、`LOG_DIR`、`WD14_PY/WORKER`、`WD14_VIT_PY/WORKER`、`WD14_TMP` 都指向 `C:\ComfyUI\...`。乾淨 Clone 會寫入 developer log，若該機剛好有 WD14 Worker 會被直接呼叫。 | 第 5.1 節 503→200 偏差；`gen_requests.jsonl` 3 行新記錄 | 讓 `LOG_DIR` / WD14 路徑可選環境變數且預設落在 Repo 或 `%LOCALAPPDATA%`；或至少在 README 明列，並把「一般使用者不需設 WD14_*」改為條件式說法。 |
| R2 | 低 | `_ws_tunnel()` 讀取 upstream handshake 時，同一 TCP chunk 中 `\r\n\r\n` 之後的 bytes 未轉送給前端。 | Mock 必須延後 0.4s 送 frame 才能被瀏覽器收到 | 將 `head` 中_multiple_ 的殘餘 bytes 轉寫給 client；真實 ComfyUI 是否會在同一 packet 送首則訊息未驗證。 |
| R3 | 低 | Clone 內含 WD14 測試腳本但無 Worker/模型，易被誤解為功能可用。 | `devtools/wd14_*_test.*` 與 `devtools/wd14_review/` | README 補一句「測試腳本仅供 developer 回歸，需另備 WD14 資源」。 |
| R4 | 低 | 1000×700 小視窗下頁面可垂直捲動（`scrollHeight=1444`），與 AGENTS.md 的「一屏不捲動」設計約束在該視窗不符。 | 瀏覽器 evaluate | 於典型解析度再量測；若屬實，調整高度分配。非部署阻斷。 |
| R5 | 資訊 | Mock 的 75 次 WS 連線是 Mock 送完 frame 即關、前端退避重連造成，非正式程式異常。 | mock_requests.jsonl | 無需處理。 |

**總結建議**：Phase 3 的「基本部署可行性」可判定為 **通過（在隔離環境下）**；但在修正或至少文件化 R1 之前，不宜對外宣稱「完全不依賴開發者本機路徑」。

---

## 19. 最後 Git 狀態（交付前重新確認）

```
## main...origin/main
?? devtools/reports/open-source-readiness-phase1.md
?? devtools/reports/open-source-readiness-phase2a.md
?? devtools/reports/open-source-readiness-phase2b1.md
?? devtools/reports/open-source-readiness-phase2b2.md
?? devtools/reports/open-source-readiness-phase2b3.md
?? devtools/reports/open-source-readiness-phase2c-implementation.md
?? devtools/reports/open-source-readiness-phase2c.md
```

- Branch `main`、HEAD `76da5a5f4f480f63fca679ccb3435bff7320a8c5`、Remote 不變。
- 本次唯一新增的 Repo 檔案即本報告 `devtools/reports/open-source-readiness-phase3.md`（連同既有 7 份共 8 份未追蹤報告）。
- 沒有任何檔案被 stage、commit 或 push。

完成後停止，等待 ChatGPT 直接讀取實際報告、程式碼、測試結果與 Git 狀態進行獨立審查。
