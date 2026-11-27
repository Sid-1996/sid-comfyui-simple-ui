# Open-Source Readiness — Phase 3R1：開發者路徑隔離與 WebSocket 修正

## 0. 結論

- R1：一般公開使用流程**已不再觸及開發者本機路徑**。實測確認：啟動、背景清理、生成診斷、WD14 未設定反推、未設定啟動指令時，開發者 `C:\ComfyUI\logs` 與 `C:\ComfyUI\tmp\wd14` 的內容和 mtime **完全不變**，且沒有啟動任何 developer Worker 或 portable ComfyUI。
- R2：`_ws_tunnel()` 已正確分離 handshake header 與後續 bytes；同 chunk、分段、多 frame、binary payload、失敗 handshake 全部以**位元組完全一致**驗證通過。
- 保留功能：WD14 在完整設定時仍走原有 JSON Lines 協定，EVA02 與 ViT 各自獨立；HTTP 代理、狀態、/api/check、/view、/ws、localStorage 格式皆未破壞。
- 全程未 commit / push / stage / reset / restore / stash / checkout / clean；既有 7 份 Phase 1～Phase 2C 報告與 Phase 3 報告完整保留。

結果分類：`【實際執行】`、`【隔離 Mock 測試】`、`【靜態檢查】`、`【未執行】`。

---

## 1. 任務目標及起始 Git 狀態

### 1.1 起始狀態 `【實際執行】`

| 項目 | 值 |
|---|---|
| Repo | `C:\ComfyUI\simple_ui`（`Test-Path .git = True`） |
| Branch | `main` |
| HEAD | `76da5a5f4f480f63fca679ccb3435bff7320a8c5` |
| Remote | `origin` → `https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| `origin/main` | `76da5a5...`（含 Phase 2C，`merge-base --is-ancestor` exit 0） |
| `HEAD...origin/main` | `0  0` |
| Staged | 空 |
| 未追蹤 | 既有 8 份報告（phase1、2a、2b1/2b2/2b3、2c-implementation、2c、phase3） |
| 正式 Port | 7860 / 8188 皆無 Listen；未停止或重啟任何正式服務 |

已閱讀：`C:\ComfyUI\AGENTS.md`、`README.md`、`SECURITY.md`、`devtools/README.md`、`open-source-readiness-phase3.md` 及 Phase 1/2A/2B/2C 歷史報告。先完成唯讀 investigation 才開始修改。

### 1.2 測試環境

- 隔離Clone：`%TEMP%\sid-simple-ui-phase3r1-20261123-110839\clone`（從公開 `origin` clone，HEAD `76da5a5`，再把 3 個修改檔複製進去；結束時已刪除）。
- 系統 Python 3.13.15；Mock ComfyUI / Mock WD14 Worker 皆只用標準庫。
- 隔離 Port：Mock `63080`、simple_ui `63081`、無 `COMFY_URL` 實例 `56722`。
- 測試用 `LOCALAPPDATA` 指向隔離目錄，因此連「本機使用者資料目錄」也沒有碰到真實使用者資料。

---

## 2. R1 開發者路徑：原始問題與修正方式

| 原始問題 | 修正 | 檔案 |
|---|---|---|
| `COMFY_ROOT = C:\ComfyUI\ComfyUI_windows_portable`、`COMFY_PY = ...\python_embeded\python.exe`，`start_comfy()` 會啟動第二份 portable | **完全移除**兩個常數；新增選用 `COMFY_LAUNCH_CMD`，只執行使用者明確提供的 argv；沒有設定就回 409 `START_NOT_CONFIGURED`，不猜路徑、不啟動任何程式 | `server.py` |
| `LOG_DIR = C:\ComfyUI\logs`，`/comfy/prompt` 會寫入 developer 的 `gen_requests.jsonl` | 改為 `%LOCALAPPDATA%\SidSimpleUI\logs`，可用 `SIMPLE_UI_LOG_DIR` 絕對路徑覆寫；`_log_gen_request()` 原本就有 try/except，寫入失敗不影響生成 | `server.py` |
| `WD14_PY/WORKER` 與 `WD14_VIT_PY/WORKER` 預設指向 `C:\ComfyUI\tools\...` | 預設改為**空字串**（未設定）；EVA02 / ViT 各自檢查完整性，缺少時回 503 `WD14_NOT_CONFIGURED`；不再搜尋或啟動任何預設 Worker | `server.py` |
| `WD14_TMP = C:\ComfyUI\tmp\wd14`，啟動時 purge 會清理該目錄 | 改為 `%LOCALAPPDATA%\SidSimpleUI\wd14-tmp`；purge 只刪「自己產生、過期、檔名符合、且 realpath 仍在目錄內」的檔案 | `server.py` |
| 前端把未知啟動錯誤一律顯示「請看 logs/comfyui.err.log」 | 新增 `j.code && j.error` 分支，直接顯示後端白話訊息 | `app.js` |
| 前端 `rvExplain()` 只靠 `WORKER_ERROR` + 字串判斷未安裝 | 新增 `WD14_NOT_CONFIGURED` code 判斷，保留 `WORKER_ERROR` 給真正的執行期故障，避免誤分類 | `app.js` |
| README 未說明新環境變數與資料位置 | 補 `COMFY_LAUNCH_CMD`、`SIMPLE_UI_LOG_DIR`、WD14 各變數與「資料與日誌位置」章節 | `README.md` |

### 2.1 使用者資料目錄實際解析方式 `【實際執行】`

```
DATA_DIR = %LOCALAPPDATA% \ SidSimpleUI
           （LOCALAPPDATA 不存在 → %APPDATA%；再不存在 → tempfile.gettempdir()）
LOG_DIR  = SIMPLE_UI_LOG_DIR（若為有效絕對路徑）否則 DATA_DIR\logs
WD14_TMP = WD14_TMP（若為有效絕對路徑且通過安全邊界）否則 DATA_DIR\wd14-tmp
```

`SIMPLE_UI_LOG_DIR` 無效時退回預設並在 stderr 提示，不阻止啟動；`WD14_TMP` 無效時讓 WD14 功能回 503 `WD14_NOT_CONFIGURED`，主服務仍正常。

### 2.2 ComfyUI 啟動路徑隔離 `【隔離 Mock 測試】`

- 有 `COMFY_URL`（外部模式）：`POST /start-comfy` 仍回 409 `EXTERNAL_COMFY`（原有行為不變）。
- 無 `COMFY_URL` 且無 `COMFY_LAUNCH_CMD`：回 409 `START_NOT_CONFIGURED`，訊息「尚未設定 ComfyUI 啟動指令，不會自動啟動任何程式。請先自行啟動你的 ComfyUI…」。瀏覽器實測狀態列顯示「ComfyUI 未連線 · 請自行啟動」，toast 顯示同一段話。
- `COMFY_LAUNCH_CMD` 有設定時（in-process，Popen 以假物件取代）：argv **完全等於**使用者輸入（含引號路徑解析），沒有偷偷加入 `cwd`、`python_embeded`、`--windows-standalone-build`；只有設定 `COMFY_OUTPUT_DIR` 時才附加 `--output-directory`（6/6 通過，`test_launch.py`）。
- 實測任何階段都沒有 `python_embeded`、`ComfyUI\main.py`、`wd14_worker.py` 行程被測試程序啟動。

### 2.3 WD14 缺少設定時的實際行為 `【隔離 Mock 測試】`

| 情境 | 結果 |
|---|---|
| 完全未設 WD14 環境變數，EVA02 | 503 `WD14_NOT_CONFIGURED`，「WD14「EVA02」尚未設定：請設定 WD14_PY 與 WD14_WORKER…」 |
| 同上，ViT v3 | 503 `WD14_NOT_CONFIGURED`，「WD14「ViT v3」尚未設定：請設定 WD14_VIT_PY 與 WD14_VIT_WORKER…」 |
| 只設 `WD14_PY`，未設 `WD14_WORKER` | EVA02 → 503 `WD14_NOT_CONFIGURED`（指出缺 WD14_WORKER）；ViT 仍 200（各自獨立，未誤用） |
| 完整設定兩套 Mock Worker | EVA02 → 200 `model=mock-eva02`；ViT → 200 `model=mock-vit`，general 標籤各自不同；JSON Lines `request_id` / `ready` / `success` 協定正常 |
| `WD14_TMP=C:\`（磁碟機根目錄） | 兩個模型都 503 `WD14_NOT_CONFIGURED`：「WD14 暫存目錄設定無效（WD14_TMP 不可指向磁碟機根目錄）」；`/api/status` 仍 200 |
| 瀏覽器反推（未設定 WD14） | `#revError` 顯示「WD14 反推功能尚未安裝或未完成設定…基本生圖不受影響」（console 只有預期的 503 HTTP 狀態紀錄，無 JS 錯誤） |

### 2.4 WD14 暫存清理安全邊界 `【實際執行】`

`purge_wd14_tmp()` 現在：

1. 先確認 `WD14_TMP` 有效且 `realpath` 是目錄（不存在就回 0，不建立）。
2. 只遍歷該目錄**第一層**（`os.listdir`，不遞迴）。
3. 檔名必須符合 `^\d{10,}_[0-9a-f]{8}\.(png|jpg|jpeg|webp|gif)$`（正是 `_reverse_inner()` 的命名格式）。
4. 逐一检查 `realpath` 的父目錄必須等於暫存目錄根、且不是 symlink、且是一般檔案。
5. 只刪超過 TTL 的檔案；任何 `OSError` 都吸收，最外層再包一層 `try/except`。

實測（`test_purge.py`，12/12）：

| 測試 | 結果 |
|---|---|
| 過期且符合格式的暫存檔 | 刪除（removed=1） |
| 新的符合格式暫存檔 | 保留 |
| `notes.txt`、`camera_photo.png`（非本程式格式） | 保留 |
| 子目錄內的符合格式檔 | 不碰 |
| `os.remove` 拋 PermissionError | 回 0、不抛例外 |
| `os.listdir` 拋 OSError | 回 0、不抛例外 |
| `WD14_TMP` 指向磁碟機根 / Repo 上層 / Repo 本身 / `COMFY_OUTPUT_DIR` | 全部拒絕並回明确原因 |

### 2.5 日誌隔離 `【實際執行】`

- 測試前後對 developer 路徑做 read-only snapshot（size、mtime_ns、SHA-256、目錄清单）：`C:\ComfyUI\logs\gen_requests.jsonl`、`wd14_worker.log`、`wd14_vit_worker.log`、`comfyui.log`、`comfyui.err.log`、`C:\ComfyUI\tmp\wd14` → **IDENTICAL**。
- 隔離 `LOCALAPPDATA\SidSimpleUI\logs\gen_requests.jsonl` 確實產生，並包含本次 `X-Request-Id: r1-phaseA`；_record 仍只有 hash / 長度 / 參數，沒有原始提示詞內容。
- 沒有設定 `WD14_*` 時，連 `LOCALAPPDATA\SidSimpleUI\wd14-tmp` 都不會被建立。

---

## 3. R2：WebSocket 原始問題與修正

原始問題：`head` 累積到 `\r\n\r\n` 後只檢查狀態碼，接著直接進 `_pump()`；同一 TCP recv 中 `\r\n\r\n` 之後的 frame bytes 被丟棄。

修正（`_ws_tunnel()`）：

```python
idx = head.find(b"\r\n\r\n")
header, trailing = head[:idx+4], head[idx+4:]
first_line = header.split(b"\r\n", 1)[0]
if b" 101 " not in first_line: raise OSError(...)     # 失敗仍回 502 並關閉 upstream
... 送出 101 給前端 ...
if trailing:
    self.wfile.write(trailing); self.wfile.flush()     # 原封不動，不解碼、不重組
# 另外把 http.server rfile 已 buffered 的 client bytes 補送給 upstream，
# 再進入 select + recv 的透明 byte pump。
```

未改變 `/ws` URL、連線方式、frame 透明代理設計，也沒有解碼 WebSocket frame。

### 3.1 WebSocket 測試結果 `【隔離 Mock 測試】`

Mock 可切換 5 種 handshake 模式；每種都用 raw socket 收取全部 bytes 後解析 frame 並比對內容：

| 模式 | 結果 |
|---|---|
| `samechunk`：101 header + 5 個 frame 在同一個 `sendall` | 101，5/5 text frame 位元組完全一致 |
| `split`：header 分 3 段送，最後一段才附 frame | 101，5/5 frame 完全一致 |
| `multiframe`：同 chunk 5 個 text + 1 個 binary(`bytes(range(256))`) + 1 個 text | 101，5/5 text + binary 256 bytes 完全一致 |
| `fail`：上游回 403 | tunnel 回 502 JSON，含 `HTTP/1.1 403 Forbidden` 原因，upstream 正確關閉 |
| `normal`：先 handshake，0.25s 後才送 frame | 101，5/5 frame 完全一致 |

- 瀏覽器（samechunk 模式）：狀態列 `up`、checkpoint 下拉正確、觸發生成後 `#stageResults` 顯示且圖片由 `/comfy/view` 解碼、**console 錯誤數 0**。
- 連續 25 次 WS 連線後，`/api/status` 仍 200，測試 Port 監聽數正常，無 resources 明顯洩漏跡象。

---

## 4. 所有修改、新增檔案及目的

| 檔案 | 變更 | 目的 |
|---|---|---|
| `server.py` | 修改（+267 / -50 行） | 移除所有 developer 絕對路徑；新增 `SIMPLE_UI_LOG_DIR` / `COMFY_LAUNCH_CMD` / 安全 WD14 路徑解析與 purge；新增 `WD14_NOT_CONFIGURED` 錯誤；修正 WS handshake 剩餘 bytes 與 client buffered bytes 轉送 |
| `app.js` | 修改（+10 / -3 行） | 啟動失敗直接顯示後端白話訊息；支援 `WD14_NOT_CONFIGURED` |
| `README.md` | 修改（+37 行） | 文件化新環境變數、資料/日誌位置、未設定時的行為 |
| `devtools/reports/open-source-readiness-phase3r1.md` | 新增 | 本報告 |

沒有新增其他 Repo 檔案；測試用 Mock、腳本、Clone、圖片全部放在隔離 temp 目錄並已刪除。

---

## 5. 實際執行的測試命令及結果（摘錄）

| 項目 | 命令 / 方式 | 結果 |
|---|---|---|
| 起始 Git | `git -C C:\ComfyUI\simple_ui status -sb` / `rev-parse HEAD` / `remote -v` / `merge-base --is-ancestor` | 如第 1 節 |
| 乾淨 Clone | `git clone https://github.com/Sid-1996/sid-comfyui-simple-ui.git <base>\clone` + 複製 3 個修改檔 | HEAD `76da5a5` |
| R1 HTTP 回歸 | `python <base>\checks_a.py` | 20 PASS；另 1 項為測試預期寫錯（`COMFY_URL` 存在時應回 `EXTERNAL_COMFY`，程式行為正確），另起無 `COMFY_URL` 實例驗證 `START_NOT_CONFIGURED` 成功 |
| Developer 路徑不變 | `python <base>\dev_snapshot.py` 前/後比較 | `IDENTICAL` |
| 行程檢查 | `Get-CimInstance Win32_Process` 比對完整 CommandLine | developer Worker / portable 行程數 0 |
| 暫存安全 | `python <base>\test_purge.py` | 12 PASS / 0 FAIL |
| 啟動指令 | `python <base>\test_launch.py` | 6 PASS / 0 FAIL |
| WD14 Mock | 兩套 Mock Worker + `/api/reverse`（eva02 / vit / partial / invalid tmp） | 全部符合預期 |
| WS byte-exact | `python <base>\ws_test.py <mode>` × 5 | 全部 PASS（`fail` 初始斷言寫錯，修正測試後 PASS） |
| 瀏覽器 | `browser.tabs.open / console / evaluate / network.list` | console 0 JS 錯誤；生成與反推訊息正確 |
| 語法 | `python -m py_compile server.py`；`node --check app.js tags.js dict.js tag_categories.js` | 全部 exit 0 |
| Diff | `git diff --check` | exit 0 |

---

## 6. 未執行測試及原因 `【未執行】`

| 項目 | 原因 |
|---|---|
| 真實 ComfyUI / GPU 生圖 | 正式環境保護禁止；只以 Mock 驗證 API 契約 |
| 真實 WD14 模型推論 | 正式 `C:\ComfyUI\tools` 禁止使用；以 Mock Worker 驗證 JSON Lines 協定 |
| `COMFY_LAUNCH_CMD` 啟動真實 ComfyUI | 同上；改以 in-process 假 Popen 驗證 argv 完全由使用者設定決定 |
| `os.symlink` 暫存逃逸測試 | 本機 Windows 帳號無建立 symlink 權限（`OSError`）；改以 `realpath` + `dirname` 邊界檢查驗證相同目標 |
| 完全沒有 `C:\ComfyUI` 的非管理員全新 Windows | 本機已有該目錄，不能移除；改以隔離 `LOCALAPPDATA` + 路徑 snapshot 證明沒有寫入 |
| 原有 `devtools/wd14_*_test.py`、`phase2b3` 等測試腳本 | 這些腳本硬編碼正式 Repo / 正式 WD14 venv / 正式 log 與 `C:\ComfyUI\tmp`，直接執行會違反第 5 節正式環境保護；已用本次隔離測試覆蓋同等情境，**未刪除或降低原有測試標準** |
| 高負載 Benchmark | 明确禁止 |

---

## 7. 全 Repo 開發者路徑搜尋結果 `【靜態檢查】`

搜尋關鍵字：`C:\ComfyUI`、`D:\ComfyUI_output`、`ComfyUI_windows_portable`、`python_embeded`、`wd14-venv`、`wd14-vit-eval`、`wd14_worker.py`、`C:\ComfyUI\logs`、`C:\ComfyUI\tmp`。

| 分類 | 結果 |
|---|---|
| **一般使用者執行流程** | `server.py` 與 `README.md`：已**無任何** developer 絕對路徑。`server.py` 只剩 docstring 中提到「wd14_worker.py」這個概念名，不是路徑。 |
| **開發者專用輔助工具** | `ui_control.ps1`（`:13-16`、`:104`、`:132`）、`ui_panel.pyw`（`:16`）、`devtools/README.md`、`devtools/wd14_*_test.py` 仍含路徑。依指示**未修改**，避免破壞開發者工具；README 已明確標示桌面控制台不是一般使用者步驟。 |
| **測試資料 / 歷史報告** | `devtools/reports/*.md`（Phase 1～Phase 3）保留原樣，內含歷史路徑敘述屬紀錄，不修改。 |

---

## 8. 正式服務是否受到影響

- 正式 ComfyUI、simple_ui、WD14 Worker：**未**停止、**未**重啟、**未**修改。
- 正式 Port 7860 / 8188：全程無 Listen，結束後亦同。
- 正式環境變數、模型、Workflow、輸出圖片、venv、依賴：未更動。
- 正式 Repo：未 commit / push / stage / reset / restore / stash / checkout / clean。
- 所有測試程序以完整 CommandLine + PID 核對後終止；測試程序讀取 developer 目錄均為 readonly snapshot。

---

## 9. 最終 Branch、HEAD、工作區狀態 `【實際執行】`

```
## main...origin/main
 M README.md
 M app.js
 M server.py
?? devtools/reports/open-source-readiness-phase1.md
?? devtools/reports/open-source-readiness-phase2a.md
?? devtools/reports/open-source-readiness-phase2b1.md
?? devtools/reports/open-source-readiness-phase2b2.md
?? devtools/reports/open-source-readiness-phase2b3.md
?? devtools/reports/open-source-readiness-phase2c-implementation.md
?? devtools/reports/open-source-readiness-phase2c.md
?? devtools/reports/open-source-readiness-phase3.md
?? devtools/reports/open-source-readiness-phase3r1.md
```

- HEAD：`76da5a5f4f480f63fca679ccb3435bff7320a8c5`
- Remote：`origin` → `https://github.com/Sid-1996/sid-comfyui-simple-ui.git`
- Staged：空
- 測試程序與 temp 目錄：全部清除；測試 Port 63080 / 63081 / 56722 Listen 數皆 0。

---

## 10. 尚未解決的問題及風險

1. **開發者工具仍含絕對路徑**（`ui_control.ps1`、`ui_panel.pyw`、`devtools/wd14_*_test.py`）。依本次範圍刻意保留；一般使用者依 README 不會接觸，但若有 Agent 誤跑 devtools，仍可能碰到正式環境。建議後續另開階段處理或在 `devtools/README.md` 顶部加更明顯警告。
2. **WS tunnel 的 client buffered bytes 補送使用 0.05 秒 timeout**，會為每條 WS 連線增加極小延遲；實測無功能影響。若未來有高頻 WS 場景可再評估。
3. **`WD14_TMP` 自訂路徑只擋 Repo / output / 磁碟根 / 上層**，使用者仍可指向其他既有目錄；但 purge 只刪符合本程式命名格式的檔案，且檢查 realpath 邊界，風險已大幅降低。
4. **真實 ComfyUI 的 WS 首幀時序未驗證**；Mock 已覆蓋同 chunk 與分段兩種極端情況，但真實行為仍需未來在合法環境確認。
5. **1000×700 小視窗下頁面仍可垂直捲動**（既有觀察）；本次未處理，不影響部署。

---

完成後停止，不進行下一階段，不 Commit / Push。
