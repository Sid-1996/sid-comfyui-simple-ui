# Open Source Readiness — Phase 2A：基本部署可行性調查

> 性質：**唯讀調查 + 提出方案**。本次未修改任何既有檔案、未新增程式／設定／測試、未安裝或下載任何東西、未啟動／停止任何服務、未執行生圖、未執行 git 寫入。
> 唯一新增檔案：本報告 `devtools/reports/open-source-readiness-phase2a.md`。
> 調查日期：2026-11-23。行號以工作區 HEAD `c229186…` 為準。
> 用語：**［事實］**＝可直接由程式碼／環境讀出；**［推論］**＝依事實推導、需驗證；**［建議］**＝本次提出的實作方案（未執行）。

---

## 1. 調查摘要與總結

### 1.1 一句結論

基本生圖的程式核心**幾乎已經可移植**，但被**一個 WD14 選用功能的啟動時副作用**與**一組固定 ComfyUI 位址／路徑**擋住。修正這兩類問題後，陌生人即可用自己的 ComfyUI、自己的模型、自己的目錄與一般 Python 啟動基本生圖；WD14 與桌面控制台可維持選用、不必移除。

### 1.2 最重要的發現

1. **［事實］基本服務只依賴 Python 標準庫**：`server.py:11-26` 全部是 stdlib（`ctypes` 也在 `recycle()` 內 lazy import，`server.py:71-72`），沒有任何 WD14／onnxruntime／numpy／pillow 的模組層 import。
2. **［事實］WD14 Worker 物件在模組載入時只做欄位指派**：`server.py:417-418` 呼叫 `Wd14Worker(...)`，建構子 `server.py:210-224` 沒有任何檔案或行程操作；Worker 直到 `POST /api/reverse` 才 spawn（`server.py:232-258,350,738`）。
3. **［P0，事實 + 推論］但 `main()` 在啟動時無條件建立 WD14 暫存目錄**：`server.py:878 os.makedirs(WD14_TMP, exist_ok=True)`，預設 `C:\ComfyUI\tmp\wd14`（`server.py:51`），且**沒有 try/except**。本機 `C:\` ACL 實測為 `BUILTIN\Users:(OI)(CI)(RX)`（一般使用者只有讀取/執行，不能在根目錄建資料夾）。因此在沒有 `C:\ComfyUI` 的全新 Windows、非管理員權限下，`os.makedirs` 會丟 `PermissionError`，`serve_forever()`（`server.py:886`）永遠不會執行——**選用功能擋住了基本服務**。
4. **［P0，事實］ComfyUI 位址固定 `127.0.0.1:8188`**：`server.py:28`、狀態檢查 `105,108,120,515,537,561`、代理 `442-461`、WebSocket `774,778,786-787`、主控台 `ui_control.ps1:102,106,122,154`、`ui_panel.pyw:155,159`。沒有環境變數可覆寫，前端雖然用相對路徑（正確設計，`app.js:49-57,181`），但後端仍只看 8188。
5. **［P0，事實］檢查失敗會自動啟動「開發者路徑 ComfyUI」**：`app.js:105-120` 失敗 → `app.js:149-153 ensureComfy()` → `app.js:128-147 startComfy()` → `POST /start-comfy` → `server.py:103-124 start_comfy()` 用 `C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe` 與 `D:\ComfyUI_output` 啟動（`server.py:113-118`）。使用者若已有自己的 ComfyUI 但在別的 port，會被誤判為「沒開」並嘗試啟動第二份（失敗後回 504）。
6. **［事實］讀圖與歷史不依賴 OUTPUT_DIR**：圖片 URL 是 `/comfy/view?...`（`app.js:436-440`），存在性檢查用 `HEAD /view` 打到 ComfyUI（`server.py:574`）。因此使用者自己的 ComfyUI output 目錄**可以正常瀏覽與生成**。
7. **［P1，事實］刪圖卻依賴 OUTPUT_DIR，且不存在時回「成功」**：`server.py:607-612` 永遠在 `OUTPUT_DIR` 底下組路徑，檔案不存在時回 `{"ok":true,"already":true}`；`app.js:750-752` 只要 `j.ok` 就 `dropImages()` 並顯示「已刪除」。結果：實際圖片還在使用者自己的輸出目錄，但歷史紀錄被移除——**資料保護風險**。
8. **［事實］`'/'`、`'\\'` 與 `..` 有做輸入驗證**（`server.py:602-605`），靜態檔有 traverse 防護（`server.py:844-847`）與白名單（`server.py:38,851-853`）；這部分可沿用。

### 1.3 對核心目標的回答

| 目標 | 現況可達成？ | 關鍵卡點 |
|---|---|---|
| 不依賴 WD14 即可啟動基本服務 | **否** | `server.py:878`（WD14_TMP 建立失敗即整個啟動失敗） |
| 連接自己的 ComfyUI | **否（除非剛好在 8188）** | `server.py:28` + 多處 `port_open(8188)` |
| 保留自己的模型 | **是** | `app.js:155-169` 從 `/object_info` 動態抓 checkpoint，`app.js:315` 用下拉值 |
| 保留自己的 output 目錄 | **部分** | 生成/瀏覽/歷史可以；刪圖、`/open-output`、`/api/status` 不行（第 7 點） |
| 使用一般 Python（非 embedded） | **是** | `server.py` 只依賴 stdlib（需 3.7+ 推論，見第 6 節） |
| 不安装第三方套件即可跑基本服務 | **是** | 同上 |

---

## 2. Repository 與 Git 狀態

| 項目 | 值 |
|---|---|
| Repository 路徑 | `C:\ComfyUI\simple_ui`（`Test-Path = True`） |
| 分支 | `main` |
| HEAD | `c2291861ee14e536a994dbe4f9456676a3e19eb0` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| 調查前工作區 | 只有 `?? devtools/reports/open-source-readiness-phase1.md` |
| Phase 1 報告 | 存在，33,161 bytes，**未修改、未刪除、未納入任何 git 操作** |
| 其它未提交修改 | 無 |
| 已閱讀規範 | `C:\ComfyUI\AGENTS.md`（由工作環境提供之完整內容）、repo 內 `README.md`、`devtools/README.md`、`.github/*`、`LICENSE`、`SECURITY.md` |

未執行 `git fetch`（避免任何 git 寫入）；Commit / Push / Reset / Rebase / Stash / Checkout / Clean 全數未執行。

---

## 3. 完整硬編碼路徑清單

### 3.1 分類方式

- **類別 1 真正的執行依賴**：基本服務啟動或請求時必需。
- **類別 2 開發者輔助工具**：`devtools/`、`gen_assets.py`，不影響正式服務。
- **類別 3 僅預設值**：有環境變數可覆寫，或有替代讀取路徑。
- **類別 4 選用 WD14**：只有反推功能會用到。
- **類別 5 文件／.gitignore 中的範例**：只影響人的理解，不影響執行。

### 3.2 完整清單

| 檔案與行號 | 使用目的 | 使用時機 | 阻擋基本部署 | 可設定 | 類別 | 最小修改建議 |
|---|---|---|---|---|---|---|
| `server.py:28` `COMFY="http://127.0.0.1:8188"` | ComfyUI API/代理目標 | 每次 `/comfy/*` 請求 | **是**（非 8188 就連不上） | 未支援 | 1 | 由 env（例如 `COMFY_URL`）讀取，預設不變 |
| `server.py:29` `COMFY_ROOT=r"C:\ComfyUI\ComfyUI_windows_portable"` | 一鍵啟動 ComfyUI 的根目錄 | 僅 `start_comfy()`（105-118） | 否（只要 ComfyUI 已開或使用外部模式） | 未支援 | 1 | env 覆寫；外部 ComfyUI 模式跳過 |
| `server.py:30` `COMFY_PY=...python_embeded\python.exe` | 一鍵啟動用的 Python | 同上 | 否（同上） | 未支援 | 1 | 同上 |
| `server.py:31` `LOG_DIR=r"C:\ComfyUI\logs"` | ComfyUI/server/WD14 日誌 | `start_comfy()`(110-112)、`_spawn()`(237)、`_log_gen_request()`(496) | 否（請求時自動建立） | 未支援 | 1 | env 覆寫，預設改到 repo 外可寫位置 |
| `server.py:32` `OUTPUT_DIR=r"D:\ComfyUI_output"` | 啟動參數、`/open-output`、`/api/status`、刪圖根目錄 | 115,510,515,607 | **部分是**（刪圖/開資料夾錯誤，生成不受影響） | 未支援 | 1 | env 覆寫；或改由 ComfyUI `/api` 取得 |
| `server.py:46-47` `WD14_PY/WORKER` 預設 `C:\ComfyUI\tools\...` | EVA02 venv 與 Worker | 僅 `/api/reverse` | **否** | **已支援**（env） | 4 + 3 | 文件化即可 |
| `server.py:49-50` `WD14_VIT_*` 預設 `C:\ComfyUI\tools\wd14-vit-eval\...` | ViT v3 venv 與 Worker | 僅 `/api/reverse` | 否 | **已支援**（env） | 4 + 3 | 文件化即可 |
| `server.py:51` `WD14_TMP` 預設 `C:\ComfyUI\tmp\wd14` | 反推暫存圖 + **啟動時建立**（878） | 啟動時（878）、請求時（725）、TTL（187-204） | **是** | **已支援**（env），但預設危險 | 4 → 1 | 移除 878 的無條件建立或改預設（見 4.3） |
| `server.py:38-39` `ALLOWED/NO_STORE` | 靜態檔白名單與快取 | `_static()`(851-865) | 否 | 未支援（不需） | 1 | 保留 |
| `server.py:871 allow_reuse_address=True` | 允許重複綁 7860 | 啟動綁定 | 否（但造成多實例誤診） | 不適用 | 1 | 啟動時檢查 port 已監聽就警告/拒絕 |
| `server.py:886` `S(("127.0.0.1",port))` | 只綁本機 | 啟動 | 否（安全設計） | port 由 `SIMPLE_UI_PORT` 控制 | 1 | 保留 |
| `app.js:50` `fetch("/comfy"+path)` | 所有 API 走同源代理 | 每次 API 請求 | 否（正確設計） | 不需 | 1 | 保留 |
| `app.js:181` `new WebSocket(proto+"//"+location.host+"/ws?...")` | WS 走同源隧道 | 連線時 | 否（正確設計） | 不需 | 1 | 保留；**不可改為直連 8188** |
| `app.js:172` 註解「7860 同源代理」 | 說明文字 | — | 否 | — | 5 | 可改為「本頁 host」避免誤解 |
| `README.md:16` 提及 AGENTS.md | 文件指向 | — | 否（但誤導） | — | 5 | 改指向 repo 內文件或移除 |
| `README.md:27-32` `.lnk`、`D:\ComfyUI_output` | 啟動與輸出說明 | — | 否（文件） | — | 5 | 補可移植說明 |
| `README.md:58` 「路徑請依環境修改」 | 文件 | — | 否 | — | 5 | 補完整清單 |
| `.gitignore:20` `D:/ComfyUI_output/` | 忽略輸出 | — | 否 | — | 5 | 保留或泛化 |
| `ui_control.ps1:13-16` 四個絕對路徑 | 控制腳本的 Python/ComfyUI/server/logs | 所有 start/stop/status | **是**（控制台完全不可用） | 未支援 | 1 | 改相對路徑 + env 覆寫 |
| `ui_control.ps1:96,113-118,122-123,154-155` 固定 7860 | port 檢查 | 控制台 | 否（除非改 `SIMPLE_UI_PORT`） | 未支援 | 1 | 由同一 config 讀 port |
| `ui_control.ps1:101-106,154` 固定 8188 與 D:\ output | 啟動 ComfyUI | 控制台 start | 否（外部模式可跳過） | 未支援 | 1 | 同 `server.py` |
| `ui_control.ps1:29-30` `ComfyUI\main.py` 比對 | 停止時辨識 ComfyUI | Stop-Ui | 否（不會誤殺任意 python） | 不適用 | 1 | 保留，但外部 ComfyUI 不應被砍 |
| `ui_panel.pyw:15` `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` | 呼叫控制台 | 按鈕動作 | 是（控制台） | 未支援 | 1 | 改用 `shutil.which("powershell")` |
| `ui_panel.pyw:16` `C:\ComfyUI\simple_ui\ui_control.ps1` | 控制台腳本路徑 | 按鈕動作 | 是（控制台） | 未支援 | 1 | 改為 `Path(__file__).with_name(...)` |
| `ui_panel.pyw:155,159,190,193,196,220,223,232` 固定 8188/7860 | 狀態顯示與開瀏覽器 | UI 更新 | 否（基本服務可直接跑 server.py） | 未支援 | 1 | 由 config 讀 |
| `gen_assets.py:14,17` `COMFY`、`CKPT` | 一次性批次生素材 | 僅開發者手動執行 | 否 | 未支援 | 2 | 改 CLI 參數或 env；標示選用 |
| `devtools/README.md:3,16,19-22,24` | 驗收工具路徑與前置 | 僅開發 | 否 | — | 2 | 標「僅開發者環境」 |
| `devtools/wd14_api_test.py:20-23,94-97,201-204` | 測試用 venv/圖/路徑 | 僅測試 | 否 | 部分（`REV_BASE`） | 2 | 保留 |
| `devtools/wd14_tmpfile_test.py:29-34,106` | 測試用 server 路徑與 sandbox | 僅測試 | 否 | 測試時覆寫 `server.WD14_TMP` | 2 | 保留（可作為驗證範本） |
| `devtools/wd14_race_test.py:28-30,389`、`wd14_perf_test.py:24-27,62` | 測試用絕對路徑 | 僅測試 | 否 | 部分（`REV_BASE`） | 2 | 保留 |
| `devtools/*.mjs` 的 `http://127.0.0.1:7860/?v=N` | 瀏覽器驗收 URL | 僅測試 | 否 | 部分 | 2 | 可用 `REV_BASE` 統一 |
| `devtools/reports/*.json/md` 中的 7860/C:\ 路徑 | 歷史量測紀錄 | 只讀 | 否 | — | 2/5 | 保留，不改 |

**結論**：真正阻擋「基本部署」的只有 `server.py:28`（ComfyUI 位址）、`server.py:51+878`（WD14_TMP 啟動副作用）、`ui_control.ps1:13-16` + `ui_panel.pyw:15-16`（若使用桌面控制台）。其餘多為**選用工具**或**文件範例**，不應一律列為 P0。

---

## 4. WD14 啟動隔離分析

### 4.1 完整呼叫鏈（事實）

```
Python 載入 server.py
  ├─ server.py:11-26  import stdlib only（無 WD14 / onnx / numpy）
  ├─ server.py:46-51  讀 WD14_* 環境變數（只指派字串，不檢查檔案是否存在）
  ├─ server.py:207-224 Wd14Worker.__init__（只Assign欄位，無 I/O）
  ├─ server.py:417     WD14 = Wd14Worker()                  ← 無 I/O
  └─ server.py:418     WD14_VIT = Wd14Worker(...)            ← 無 I/O

main()  server.py:876-889
  ├─ 877  os.makedirs(ASSETS, exist_ok=True)                ← repo 內，安全
  ├─ 878  os.makedirs(WD14_TMP, exist_ok=True)              ← ★ 無 try/except，★ 外部路徑
  ├─ 879  threading.Thread(_purge_loop, daemon=True)         ← daemon，安全
  ├─ 880  purge_wd14_tmp()                                  ← 內部 try/except（187-204），安全
  ├─ 883  print(...)
  ├─ 884  port = int(os.environ.get("SIMPLE_UI_PORT","7860"))
  ├─ 886  S(("127.0.0.1",port), H).serve_forever()           ← ★ 878 失敗就永遠到不了這裡
  └─ 888  finally: WD14.stop()                              ← 沒 proc 就直接 return（396-401）

POST /api/reverse（僅使用者點反推時）
  ├─ server.py:637-664  _reverse()：大小/併發檢查（429）
  ├─ server.py:719-721  選 WD14 或 WD14_VIT
  ├─ server.py:724-732  建立暫存檔（★ 有 try/except → TMP_FAIL 500）
  ├─ server.py:738      worker.submit()
  │    └─ 350 ensure_ready() → 319-342 → 232-258 _spawn()
  │         └─ 233-236 檢查 py/worker 檔案存在；不存在丟 RuntimeError
  ├─ server.py:740-750  finally 清理（成功刪；逾時/崩潰保留交 TTL）
  └─ server.py:752-766  回 503/504/500 或 200
```

### 4.2 針對問題逐項回答

| 問題 | 答案 | 證據 |
|---|---|---|
| 沒有 WD14 venv，`server.py` 能否啟動？ | **能**（只要 `WD14_TMP` 可建立） | 模組層無 import；`_spawn()` 僅在請求時檢查（`server.py:233-236`） |
| 沒有 Worker 腳本，能否啟動？ | **能** | 同上；失敗只發生在反推請求，回 503 `WORKER_ERROR`（`server.py:752-755`） |
| 沒有模型，能否啟動？ | **能** | 模型由 Worker 自己載入，server 不檢查；錯誤在 Worker 內（repo 外 `wd14_core.py:167-170`） |
| 沒有 `C:\ComfyUI`，能否啟動？ | **不一定，通常不能**（非管理員） | `server.py:878` 無保護的 `os.makedirs`；本機 `C:\` ACL：Users 只有 `(RX)`，無法在根目錄建資料夾 |
| 暫存目錄無寫入權限，能否啟動？ | **不能** | 同上，`PermissionError` 未被捕獲，`serve_forever()` 不會執行 |
| 使用者不反推，哪些 WD14 程式碼仍會執行？ | `46-51` 讀 env、`417-418` 建空物件、`878` 建目錄、`879-880` TTL 執行緒/清理、`888` stop | 見 4.1 呼叫鏈 |
| 是否有不必要的 import／初始化？ | **有**：`878` 的目錄建立是唯一不必要的啟動副作用 | 比較 `725`（有 try/except）與 `878`（沒有） |
| WD14 失敗是否影響基本生圖？ | **請求失敗不影響**（生成走 `/comfy/prompt`，`app.js:400-404`）；**但啟動失敗會影響全部** | `server.py:878` vs `app.js:328-488` |

### 4.3 最小修正方向（建議，未執行）

**方案 A（最小、相容性最高）**：把 `server.py:878` 包進 `try/except OSError`，失敗只印警告，不中斷啟動；`purge_wd14_tmp()` 已有 `isdir` 與 try/except（`server.py:190,203-204`），不需改。真正用到時 `server.py:725` 會再建立一次並在失敗時回 500。
**方案 B（更乾淨）**：完全移除 `878`，把暫存建立留給 `725`（懶建立）。
**方案 C（搭配）**：把 `WD14_TMP` 預設改到 repo 外但保證可寫的位置（例如系統 temp 下），保留 env 覆寫給進階使用者。
三者都不需要動 workflow、KSampler、SaveImage 或任何 ComfyUI 節點。

---

## 5. ComfyUI 連線架構分析

### 5.1 事實：所有入口

| 入口 | 位置 | 目標 |
|---|---|---|
| HTTP 代理 | `server.py:442-461 _proxy()` | `COMFY + path`（`server.py:28`） |
| 狀態檢查 | `app.js:105-120` | `GET /comfy/system_stats` |
| checkpoint 清單 | `app.js:155-169` | `/comfy/object_info/CheckpointLoaderSimple` |
| 生成 | `app.js:400-404` | `POST /comfy/prompt` |
| 歷史 | `app.js:490-499` | `/comfy/history/<pid>` |
| 圖片 | `app.js:436-440` | `/comfy/view?...` |
| 存在性檢查 | `server.py:574` | `HEAD COMFY/view?...` |
| 取消 | `app.js:413-415` | `/comfy/queue`、`/comfy/interrupt` |
| WebSocket | `server.py:770-823` | 手動 TCP 到 `127.0.0.1:8188`（778），改寫 Host/Origin（786-787）後雙向 pump（818） |
| 前端 WS | `app.js:180-181` | `ws(s)://location.host/ws?clientId=...`（同源） |
| 一鍵啟動 | `server.py:103-124`、`ui_control.ps1:101-106` | 自建 ComfyUI |

### 5.2 問題回答

1. **是否固定 127.0.0.1:8188？** 是（`server.py:28,105,120,515,561,774,778`）。
2. **是否支援其他 Port？** 目前不支援；需改 `COMFY` 與所有 `port_open(8188)` 及 `_ws_tunnel` 的連線/Host/Origin。
3. **是否支援其他主機？** 目前不支援（`socket.create_connection(("127.0.0.1",8188))` 寫死，`server.py:778`）。
4. **前端是否依賴固定 Port？** **否**——前端一律用相對路徑（`app.js:50,181`），這一點是正確設計，應保留。
5. **跨域／同源限制？** ComfyUI 的 WS 有同源檢查，所以必須走 `/ws` 隧道（`server.py:767,784-793`）；HTTP 因同源代理沒有 CORS 問題。**不可為方便改成前端直連 8188**。
6. **逾時與錯誤處理？** 代理 `urlopen(timeout=600)`（`server.py:454`）、HTTPError 原樣回傳（458-459）、其他例外回 502（460-461）；WS 上游連線 10 秒（778）、handshake 上限 65536（800）、非 101 回錯（802-803）；前端 WS 失敗退避重連（`app.js:192-198`）。［推論］600 秒過長，可能造成 UI 長時間無回應，應可設定或縮短。
7. **是否必須同機？** 目前是（127.0.0.1 + 直接 socket）。若要支援遠端 ComfyUI，需改 `COMFY` 與 WS 隧道目標；HTTP 代理本身已可達成。
8. **ComfyUI 是否必須已啟動？** 否（有 `/start-comfy`），但「一鍵啟動」是開發者路徑專用。
9. **會不會誤啟動第二份？** **會**（在使用者 ComfyUI 不在 8188 時）：`app.js:105-120` 判失敗 → `149-153` → `128-147` → `server.py:103-124` 以 `COMFY_ROOT/COMFY_PY` 啟動。若 8188 已有 ComfyUI，`port_open(8188)`（`server.py:105-109`）會擋住，不會啟動第二份。
10. **哪些啟動控制是原開發者環境專用？** `server.py:29-32,103-118`、`ui_control.ps1:13-16,101-106`、`ui_panel.ps1` 的 port 顯示、`ui_panel.pyw:15-16,155-160`。

### 5.3 建議［建議］

- 新增單一 `COMFY_URL`（env）作為唯一來源；`COMFY` 由它派生，`port_open()` 改為從 URL 取 host/port；`_ws_tunnel` 用同一 host/port。
- 增加「外部 ComfyUI 模式」：找不到 `COMFY_ROOT`/`COMFY_PY` 時，`/start-comfy` 回明確 501/503「請先自行啟動 ComfyUI」，前端只顯示錯誤、不嘗試啟動。
- 保留 `/ws` 隧道與同源設計，不改前端連線方式。

---

## 6. Python 與依賴分析

### 6.1 事實

| 路徑 | imports | 分類 |
|---|---|---|
| `server.py:11-26` | base64, hashlib, http.server, json, mimetypes, os, select, socket, socketserver, subprocess, sys, threading, time, urllib.{error,parse,request} | 全數標準庫 |
| `server.py:71-72` | ctypes, ctypes.wintypes（在 `recycle()` 內 lazy import） | 標準庫，Windows 專用 |
| `ui_panel.pyw:7-13` | ctypes, json, socket, subprocess, threading, tkinter, tkinter.font | 標準庫 + tkinter（桌面專用） |
| `ui_control.ps1` | PowerShell cmdlet（Get-CimInstance/Get-NetTCPConnection/Start-Process/Stop-Process） | 系統內建 |
| `gen_assets.py:7-12` | json, os, sys, time, urllib.* | 標準庫（一次性工具） |
| `devtools/wd14_*.py` | 會 import `server` 模組、呼叫 subprocess 與 WD14 venv | 僅測試 |

### 6.2 問題回答

1. **基本生圖是否只用標準庫？** 是（`server.py:11-26`）。
2. **最低可行 Python 版本？** ［推論］`server.py` 使用 `subprocess.Popen(text=True, encoding=...)`（`server.py:248`，3.7+）、`os.makedirs(exist_ok=True)`（3.2+）、f-string 未出現於 server.py；控制台用 `subprocess.run(capture_output=...)`（`ui_panel.pyw:48`，3.7+）。推論最低 **3.7**；**未實際驗證**，建議與 ComfyUI embedded python 對齊或文件寫 3.10+。
3. **是否依賴 Windows 專用 API？** 是：`ctypes.windll.shell32.SHFileOperationW`（`server.py:97`）、`os.startfile`（`server.py:510`）、`CREATE_NO_WINDOW`（`server.py:117,249`；`ui_control.ps1:105,115`）。基本服務在正常 Linux 也許能跑，但刪圖/開資料夾/啟動 ComfyUI 不行；專案定位仍是 Windows。
4. **是否需要獨立 venv？** 基本服務不需要；WD14 Worker 各自需要自己的 venv（repo 外）。
5. **能否用一般 Python 安裝？** 可以（`python server.py`），前提是 ComfyUI 可達（目前只能在 8188）。
6. **有無隱藏的外部 Python 環境依賴？** 基本服務**沒有**；`COMFY_PY`（`server.py:30`）只在「一鍵啟動 ComfyUI」時用。
7. **WD14 依賴能否完全隔離？** **可以**，且現況已經隔離（兩套 venv + 子行程 JSON Lines，`server.py:46-51,232-258`）；唯一破口是 `878` 的目錄建立。
8. **是否有套件版本應鎖定？** 基本服務沒有第三方套件；WD14 的 onnxruntime / numpy / pillow 版本在 repo 內沒有任何宣告（只在本機外部 venv）。

---

## 7. 輸出目錄及資料保護分析

### 7.1 事實：OUTPUT_DIR 的實際用途

| 用途 | 位置 | 是否影響生成／讀圖 |
|---|---|---|
| ComfyUI 啟動參數 `--output-directory` | `server.py:115`、`ui_control.ps1:104` | 只有 simple_ui 代為啟動時 |
| `/open-output` 開資料夾 | `server.py:508-513` | 否 |
| `/api/status` 回傳顯示 | `server.py:514-515` | 否 |
| 刪圖根目錄 | `server.py:607-612` | 否（但影響刪除正確性） |
| 讀圖／產生 URL | `app.js:436-440` → `/comfy/view` | **不使用 OUTPUT_DIR** |
| 歷史存在性 | `server.py:574 HEAD /view` | **不使用 OUTPUT_DIR** |

### 7.2 問題回答

1. **能否保留既有 ComfyUI output 目錄？** **能**（生成、歷史、縮圖、燈箱都走 ComfyUI `/view`）。
2. **能否只連接已運作的 ComfyUI、不管理啟動？** 程式上可以（只要它在 8188），但 `ensureComfy()` 會在檢查失敗時尝试啟動（第 5.2 節第 9 點），需「外部模式」開關。
3. **輸出目錄不一致會怎樣？** 瀏覽正常；`/open-output` 開到錯誤資料夾；`/api/status` 顯示錯誤路徑；**刪圖會發生「假成功」**：`server.py:611-612` 在 `OUTPUT_DIR` 下找不到檔案就回 `already:true`，`app.js:750-752` 仍 `dropImages()`，實際圖片留在使用者目錄、歷史卻消失。
4. **有無刪錯檔案的風險？** 路徑本身有防護（`server.py:602-610`），不会任意刪除；風險是「刪不到卻顯示成功」。
5. **哪些目錄應 simple_ui 自行建立？** ASSETS（repo 內，`server.py:877`）；LOG_DIR、WD14_TMP 應改為「需要時才建立」。
6. **哪些資料必須留在 repo 外？** 模型、ComfyUI、輸出圖、日誌、WD14 venv/模型/暫存、localStorage。
7. **更新／解除安裝是否破壞資料？** `git pull` 只改追蹤檔，不碰上述資料；但若使用者依 `README.md:58` 改過原始碼路徑，更新會覆蓋——需設定外部化後才安全。

### 7.3 建議［建議］

- 外部 ComfyUI 模式下，刪圖應走 ComfyUI 既有刪除機制，或在找不到檔案時回 `ok:false, code:"NOT_FOUND"`，前端不要移除歷史。
- 不做任何實際刪除測試；以 mock `os.path.isfile` 驗證。

---

## 8. Port 與環境變數清單

| 名稱 | 預設值 | 讀取位置 | 目的 | 格式驗證 | 錯誤處理 | 影響基本部署 | 應公開為使用者設定 |
|---|---|---|---|---|---|---|---|
| `SIMPLE_UI_PORT` | `7860` | `server.py:884` | simple_ui 綁定 port | `int()` 轉型，失敗直接拋 | 無 | 是（但控制台寫死 7860） | 是 |
| `WD14_PY` | `C:\ComfyUI\tools\wd14-venv\Scripts\python.exe` | `server.py:46` | EVA02 Python | 無 | `_spawn()` 檢查檔案（233-234） | 否 | 是（選用） |
| `WD14_WORKER` | `C:\ComfyUI\tools\wd14_worker.py` | `server.py:47` | EVA02 Worker | 無 | 同上（235-236） | 否 | 是（選用） |
| `WD14_VIT_PY` | `C:\ComfyUI\tools\wd14-vit-eval\venv\Scripts\python.exe` | `server.py:49` | ViT Python | 無 | 同上 | 否 | 是（選用） |
| `WD14_VIT_WORKER` | `C:\ComfyUI\tools\wd14_vit_worker.py` | `server.py:50` | ViT Worker | 無 | 同上 | 否 | 是（選用） |
| `WD14_TMP` | `C:\ComfyUI\tmp\wd14` | `server.py:51` | 暫存 + **啟動時建立** | 無 | 請求時有 try/except（724-732），啟動時**沒有**（878） | **是** | 是 |
| `REV_BASE` | `http://127.0.0.1:7860` | `devtools/wd14_api_test.py:19`、`wd14_race_test.py:29`、`wd14_tmpfile_test.py:30` | 測試用 base URL | 無 | 無 | 否（僅測試） | 否 |
| `PYTHONIOENCODING` / `PYTHONUNBUFFERED` | 由 server 內部設為 `utf-8` / `1` | `server.py:240-242` | 子行程輸出 | 不適用 | 不適用 | 否 | 否 |
| ComfyUI 位址/埠 | **無 env，寫死 127.0.0.1:8188** | `server.py:28` 等 | 見第 5 節 | — | 502/503 | **是** | **應新增** |

其他固定 Port：7860 出現在 `ui_control.ps1:96,113-118,122-123,155`、`ui_panel.pyw:156,160,190,193,196,220,223,232`、`README.md:43`；8188 出現在 `server.py` 多處、`ui_control.ps1:102,106,122,154`、`ui_panel.pyw:155,159`、`gen_assets.py:14`、`devtools/*`。

---

## 9. 桌面啟動工具分析

| 項目 | 事實 | 是否原開發者專用 | 能否在別的電腦用 | 是否強制綁定 ComfyUI | 是否誤殺 Python |
|---|---|---|---|---|---|
| `ui_control.ps1:13-16` | 四個絕對路徑 | 是 | 否（需改路徑） | 是（Start-Ui 會啟動 ComfyUI，101-106） | **否**：只比對完整 `ServerScript` 路徑與 `ComfyUI\main.py`（21-32），未用 `taskkill /IM python.exe`（19 行註解明確禁止） |
| `ui_control.ps1:82-137` | Start-Ui：清重複 server → 啟 ComfyUI → 啟 server | 部分 | 改路徑後可 | 是 | 同上 |
| `ui_control.ps1:46-78` | Stop-Ui：砍 server 與 ComfyUI | 部分 | 可 | 會砍吻合 `ComfyUI\main.py` 的行程 | 不會砍無關 python |
| `ui_panel.pyw:15-16` | PS 與 CONTROL 絕對路徑 | 是 | 否 | 間接 | 不適用 |
| `ui_panel.pyw:28-35,155-160` | 用 socket 查 8188/7860 | 部分 | 可（port 寫死） | 是（顯示） | 不適用 |
| `ui_panel.pyw:190-232` | 背景輪詢 7860、自動開瀏覽器 | 否 | 可 | 否 | 不適用 |
| `ui_panel.ps1` | 舊 WinForms 控制台，僅 port 顯示（104-105,137） | 部分 | 可 | 顯示用 | 不適用 |
| `.lnk` / `.bat` / `.cmd` | repo 內**不存在**（glob 確認） | — | — | — | — |

**回答**：
1. 原開發者專用：`ui_control.ps1:13-16`、`ui_panel.pyw:15-16`（路径），以及兩者對 8188/7860 的假設。
2. 不能在未修改的其它電腦直接使用。
3. **是**，Start-Ui 把 ComfyUI 與 simple_ui 綁在一起（101-118）。
4. **不會**誤殺任意 Python；但會砍到任何命令列含 `ComfyUI\main.py` 的行程（29-30），使用者自裝 ComfyUI 若在別的路徑且以不同形式啟動，可能不在比對內。
5. **應列為選用工具**：基本部署可只用 `python server.py` + 瀏覽器，控制台不是必要條件。
6. 基本部署不需要它。

---

## 10. 建議的最小可移植部署架構

### 10.1 建議架構（建議）

```
使用者自行安裝（不由 simple_ui 代勞，除非選用「一鍵啟動」）
  ├─ ComfyUI（任意路徑、任意 port、任意模型）
  └─ Python 3.7+（可為系統 Python 或 ComfyUI embedded）

simple_ui（clone repo 即可）
  ├─ server.py
  │    ├─ COMFY_URL        ← env，預設 http://127.0.0.1:8188
  │    ├─ SIMPLE_UI_PORT   ← env，預設 7860（既有）
  │    ├─ OUTPUT_DIR       ← env/設定，預設：由 ComfyUI 查詢或留空
  │    ├─ LOG_DIR          ← env/設定，預設 repo 外可寫暫存
  │    ├─ WD14_TMP         ← env，預設系統 temp（懶建立）
  │    └─ WD14_*           ← env，缺失時只影響 /api/reverse
  ├─ 前端：維持 /comfy 代理與 /ws 同源隧道（不改）
  └─ 桌面控制台：選用，路徑改為相對 + env 覆寫
```

### 10.2 必要設定項目與預設值

| 項目 | 建議讀取方式 | 建議預設 | 儲存位置 |
|---|---|---|---|
| ComfyUI URL | env `COMFY_URL` | `http://127.0.0.1:8188` | 環境變數（不改 repo 檔） |
| simple_ui port | env `SIMPLE_UI_PORT`（既有） | `7860` | 同上 |
| 輸出目錄 | env `SIMPLE_UI_OUTPUT` | 留空＝不管理，改問 ComfyUI | 同上 |
| 日誌目錄 | env `SIMPLE_UI_LOG_DIR` | 系統 temp 下 | 同上 |
| WD14 暫存 | env `WD14_TMP`（既有） | 系統 temp 下 | 同上 |
| WD14 四項 | 既有 env | 保持現值但文件化 | 同上 |
| 桌面控制台 | 選用，不进入基本流程 | — | — |

### 10.3 啟動流程（建議）

1. 使用者啟動自己的 ComfyUI（任何 port）。
2. 設定 `COMFY_URL`（若非 8188）；其餘全部用預設。
3. `python server.py`（任何 Python 3.7+）。
4. 瀏覽 `http://127.0.0.1:7860`（或自訂 port）。
5. 狀態列應顯示「已連線」，checkpoint 下拉出現使用者自己的模型。
6. WD14/控制台完全不設定也能完成 1-5。

### 10.4 失敗處理（建議）

- ComfyUI 不可達：`/comfy/*` 回 502，前端狀態列顯示「ComfyUI 沒開」，**不再自動啟動開發者路徑版本**（除非顯式選用一鍵啟動）。
- WD14 工具缺失：反推按鈕可顯示「未安裝」，或點了回 503，但基本生成不受影響。
- 暫存目錄不可寫：`server.py:878` 不再中斷啟動，僅警告；反推回 500 `TMP_FAIL`。
- 輸出目錄不存在：不影響生成；刪圖找不到檔案時回明確錯誤，不移除歷史。

### 10.5 相容性與資料遷移

- 所有預設值保持不變 → 現有正式環境不改任何設定也可繼續運作。
- 既有 `C:\ComfyUI\tmp\wd14` 仍可透過 `WD14_TMP` 指向；不自動搬移或刪除舊暫存。
- localStorage key（`sel`/`combos`/`adult`/`showEn`/`ui.extra`/`ui.learnedTags`/`ui.tagStats`）完全不變。
- Workflow 節點、KSampler 參數、SaveImage prefix 完全不變。

---

## 11. P0～P3 實作清單

### P0：基本部署阻礙

#### P0-1 移除 WD14 暫存目錄對啟動的硬性依賴
- **問題描述**：選用功能擋住基本服務啟動。
- **證據**：`server.py:51,878`；對比 `server.py:725` 有 try/except；本機 `C:\` ACL `Users:(OI)(CI)(RX)`。
- **影響範圍**：所有沒有 `C:\ComfyUI` 或非管理員的新使用者。
- **建議修改檔案**：`server.py`（僅 878 行附近）。
- **最小修改方案**： Package `os.makedirs(WD14_TMP, exist_ok=True)` 於 `try/except OSError` 並印警告；或改懶建立（移除 878）。
- **相容性風險**：低；既有目錄存在時行為不變；TTL 清理已容忍目錄不存在（`server.py:190`）。
- **測試方式**：mock `os.makedirs` 對 WD14_TMP 拋 `PermissionError`，確認 `serve_forever` 仍被呼叫；實際 Windows 非管理員 + 無 `C:\ComfyUI` 驗證。
- **是否需使用者決策**：否（若同時改預設路徑，需決定是否保留舊暫存）。

#### P0-2 ComfyUI 位址／埠外部化
- **問題描述**：固定 `127.0.0.1:8188`，使用者已有其他 port 的 ComfyUI 無法連接。
- **證據**：`server.py:28,105,108,120,515,537,561,774,778,786-787`。
- **影響範圍**：所有非 8188 或非本機的 ComfyUI 使用者。
- **建議修改檔案**：`server.py`。
- **最小修改方案**：新增 `COMFY_URL = os.environ.get("COMFY_URL","http://127.0.0.1:8188")`；`COMFY` 由它派生；`port_open` 改從 URL 取 host/port；`_ws_tunnel` 的 `create_connection` 與 Host/Origin 用同一來源。前端不改。
- **相容性風險**：中——WS 隧道改寫 Host/Origin 必須與 ComfyUI 同源檢查一致；需保留 101 handshake 邏輯（`server.py:784-810`）。
- **測試方式**：用假 ComfyUI（mock server）在 8189 驗證 `/comfy/system_stats`、`/prompt`、`/ws` 皆通。
- **是否需使用者決策**：是（變數名稱、是否提供 UI 輸入欄）。

#### P0-3 避免誤啟動第二份 ComfyUI
- **問題描述**：連線失敗就啟動開發者路徑 ComfyUI。
- **證據**：`app.js:105-120,128-153`；`server.py:103-124`；`ui_control.ps1:101-106`。
- **影響範圍**：已有自己的 ComfyUI 但 port 不同的使用者。
- **建議修改檔案**：`app.js`、`server.py`。
- **最小修改方案**：新增「外部 ComfyUI 模式」（可用 `COMFY_MANAGED=0` 或偵測 `COMFY_ROOT` 不存在）：`/start-comfy` 回明確訊息；前端 `startComfy()` 只顯示錯誤，不呼叫 `/start-comfy`。
- **相容性風險**：中——不可破壞既有「一點就啟動 ComfyUI」流程；.default 應維持原有行為。
- **測試方式**：模擬 ComfyUI 在 8189，確認沒有產生 `ComfyUI\main.py` 子行程。
- **是否需使用者決策**：是（是否保留一鍵啟動為選用）。

#### P0-4 路徑集中與外部化
- **問題描述**：基本服務與控制台的路徑散落多檔，無設定檔。
- **證據**：`server.py:29-32`、`ui_control.ps1:13-16`、`ui_panel.pyw:15-16`。
- **影響範圍**：所有不把 ComfyUI 裝在 `C:\ComfyUI` 的使用者。
- **建議修改檔案**：`server.py`、`ui_control.ps1`、`ui_panel.pyw`。
- **最小修改方案**：`server.py` 用 env 覆寫 `COMFY_ROOT`/`LOG_DIR`/`OUTPUT_DIR`；控制台改相對路徑 + 從同一來源讀取；預設值完全不變。
- **相容性風險**：低（預設不變）；需注意 PowerShell 與 Python 讀同一變數命名一致。
- **測試方式**：clone 到 `D:\myui`、ComfyUI 在 `E:\mycomfy`、輸出在 `F:\img`，驗證啟動與狀態。
- **是否需使用者決策**：是（設定載體：env 或本機 config 檔）。

### P1：基本部署可靠性

#### P1-1 修正「刪不到卻顯示成功」
- **問題描述**：`OUTPUT_DIR` 與 ComfyUI 實際輸出不同時，歷史被移除但圖片還在。
- **證據**：`server.py:611-612`（`already:true`）、`app.js:750-752`（`j.ok` 就 dropImages）。
- **影響範圍**：所有自備 ComfyUI output 目錄的使用者（資料保護）。
- **建議修改檔案**：`server.py`、`app.js`。
- **最小修改方案**：找不到檔案回 `ok:false, code:"NOT_FOUND"`；前端只在 `recycled || j.deleted` 時移除；或改走 ComfyUI 刪除 API。
- **相容性風險**：中——既有本機流程在檔案確實存在時行為不變。
- **測試方式**：mock `os.path.isfile=False`，確認歷史仍在。
- **是否需使用者決策**：是（是否要讓 simple_ui 有權刪使用者的圖）。

#### P1-2 連線錯誤可診斷
- **問題描述**：502/503 只有籠統訊息，無法分辨 port 錯、ComfyUI 沒開、WS 被拒。
- **證據**：`server.py:460-461,774-775,802-803`、`app.js:59-? translateError`。
- **影響範圍**：所有部署失敗的使用者。
- **建議修改檔案**：`server.py`、`app.js`。
- **最小修改方案**：`/api/status` 回傳實際 `COMFY_URL`；錯誤訊息帶 host:port；前端狀態列顯示目標。
- **相容性風險**：低。
- **測試方式**：關掉 ComfyUI、改錯 port，檢查回應內容。
- **是否需使用者決策**：否。

#### P1-3 避免 7860 多實例與代理長逾時
- **問題描述**：`allow_reuse_address=True` 讓多份 server 同時綁 7860；代理 `timeout=600` 過長。
- **證據**：`server.py:871,454`。
- **影響範圍**：開發/重啟情境；可能造成「改了沒生效」。
- **建議修改檔案**：`server.py`。
- **最小修改方案**：啟動前用 `port_open(port)` 檢查並拒絕（或警告）；代理 timeout 改可設定、預設 60-120 秒。
- **相容性風險**：中——不可未授權砍掉既有行程；只拒絕新啟動。
- **測試方式**：啟動兩份，確認第二份拒絕且第一份不受影響。
- **是否需使用者決策**：是（拒絕或自動清理；建議只拒絕）。

### P2：選用功能及桌面工具

#### P2-1 WD14 能力偵測與降級
- **問題描述**：沒有 WD14 時反推按鈕仍可點，錯誤不直觀。
- **證據**：`app.js:1437`（`btnReverse.onclick = openReverse`）、`server.py:233-236,752-755`。
- **影響範圍**：選用功能使用者。
- **建議修改檔案**：`app.js`、`server.py`（可選 `/api/capabilities`）。
- **最小修改方案**：在 establish 時或按鈕點擊時檢查 WD14 可用性；不可用時按鈕禁用並顯示「需另裝 WD14」；不移除任何 WD14 程式碼。
- **相容性風險**：低。
- **測試方式**：不設定 WD14_* 啟動，確認基本生成正常、反推顯示明確提示。
- **是否需使用者決策**：是（是否預設隱藏反推入口）。

#### P2-2 桌面控制台改為真正選用
- **問題描述**：控制台與 ComfyUI 啟動綁死、路徑絕對。
- **證據**：`ui_control.ps1:13-16,101-106`、`ui_panel.pyw:15-16`。
- **影響範圍**：想用控制台但路徑不同的人。
- **建議修改檔案**：`ui_control.ps1`、`ui_panel.pyw`。
- **最小修改方案**：路徑改 `Path(__file__)` 相對 + env；Stop 只砍自己 server，不再砍 ComfyUI（或需明確確認）；文件標為選用。
- **相容性風險**：中—— Stop 行為改變可能影響既有「關機前全關」流程。
- **測試方式**：只驗證 status；start/stop 須在隔離環境且經授權。
- **是否需使用者決策**：**是**（涉及停止行程）。

#### P2-3 一次性工具與 devtools 可移植
- **問題描述**：`gen_assets.py:14,17`、`devtools/README.md:16,19-22` 硬編碼路徑。
- **影響範圍**：僅開發者，不影響基本部署。
- **建議修改檔案**：`gen_assets.py`、`devtools/README.md`、測試檔 URL。
- **最小修改方案**：改 CLI/env；README 標「僅開發者環境」。
- **相容性風險**：低。
- **測試方式**：不需要執行工具，靜態檢查即可。
- **是否需使用者決策**：否。

### P3：後續文件與維護

#### P3-1 依賴與版本宣告
- **問題**：無 requirements/pyproject；Python 最低版本未驗證；WD14 套件版本未宣告。
- **證據**：repo 檔案清單、`server.py:11-26`、`devtools/README.md:16-22`。
- **建議**：文件寫「基本服務僅需 Python 標準庫（實測 3.7+ 語法）」；WD14 版本另列，不強迫安裝。
- **測試**：無需執行；文件與程式碼交叉比對。
- **使用者決策**：否。

#### P3-2 部署文件與設定範例
- **問題**：README 只有 3 行啟動，路徑說明不完整。
- **證據**：`README.md:16,27-32,58`。
- **建議**：補「基本部署（不含 WD14）」章節 + 設定表；不放 `config.ini` 進 repo（避免覆蓋）。
- **測試**：陌生 Agent 依文件在隔離 VM 部署。
- **使用者決策**：是（是否接受文件提供下載連結）。

---

## 12. 未來驗證矩陣

> 本次**未執行**以下任何項目。標示需授權者，日後必須另取得使用者同意。

| # | 場景 | 驗證方式 | 預期結果 | 需授權 |
|---|---|---|---|---|
| 1 | 沒有 `C:\ComfyUI` 的 Windows | 實際 Windows / 隔離 VM（非管理員帳號） | `python server.py` 成功監聽 7860 | 是 |
| 2 | ComfyUI 在其他磁碟（如 `E:\mycomfy`） | 模擬 + 實際 Windows | 基本生成正常；不需改 server.py | 是 |
| 3 | ComfyUI 非預設 Port（8189） | mock ComfyUI server | `COMFY_URL` 指向 8189 後 `/comfy/*` 與 `/ws` 皆通 | 否（模擬） |
| 4 | 使用者已有 ComfyUI 且已啟動 | 模擬 | 狀態列「已連線」，不產生第二份 ComfyUI 行程 | 否（模擬） |
| 5 | 沒有 WD14 venv | 單元 + 模擬 | server 啟動；生成正常；反推回明確 503 | 否 |
| 6 | 沒有 WD14 Worker | 既有測試 `wd14_api_test.py:198-215`（T12）可作為範本 | 回 503 `WORKER_ERROR`，不影響生成 | 否（只讀既有結果／隔離環境） |
| 7 | 沒有 WD14 模型 | 模擬 Worker fatal | server 啟動不受影響 | 否 |
| 8 | WD14 暫存目錄無法建立 | mock `os.makedirs` 拋 `PermissionError`（`wd14_tmpfile_test.py:100-106` 的 sandbox 手法可借鏡） | server 仍啟動；反推回 500/503 | 否 |
| 9 | simple_ui 輸出目錄無寫入權限 | 模擬 `os.path.isfile=False` / mock 權限 | 不誤刪歷史；回明確錯誤 | 否 |
| 10 | simple_ui Port 被占用 | 啟動兩份（隔離環境） | 第二份拒絕，不影響第一份 | 是 |
| 11 | ComfyUI 尚未啟動 | mock + 實際 Windows | 狀態列「未連線」；不誤啟動開發者路徑 ComfyUI | 部分是 |
| 12 | ComfyUI WebSocket 連線失敗 | mock 8188 回非 101（`server.py:802-803`） | `/ws` 回 502/503；前端退避重連（`app.js:192-198`） | 否 |

補充：既有 `devtools/wd14_api_test.py`、`wd14_race_test.py`、`wd14_tmpfile_test.py` 的驗證手法可作為未來單元／模擬測試範本，但它們本身依賴原開發者路徑（`devtools/README.md:16-22`），不可直接當成一般使用者部署驗證。

---

## 13. 尚未確認的資訊與風險

| 項目 | 狀態 | 風險 |
|---|---|---|
| ComfyUI 版本與 API 相容性 | **未確認**（repo 無版本要求） | 新版 ComfyUI 若改 `/ws` 或 `/view` 契約，`server.py:442-461,770-823` 需調整 |
| Python 最低版本 | ［推論］3.7+（`server.py:248` 的 `text=True`） | 未實際驗證；建議文件寫保守值 |
| 非管理員 + 全新 Windows 的 `os.makedirs(C:\ComfyUI\...)` 失敗 | ［事實］本機 ACL + 程式碼；［推論］通用性 | 需實際隔離 Windows 驗證 |
| 使用者 ComfyUI output 目錄與 `D:\ComfyUI_output` 不一致的實際影響 | ［事實］刪圖假成功（`server.py:611-612` + `app.js:750-752`） | 資料保護風險，需優先修正 |
| WD14 兩套 venv 的套件版本 | **未確認**（版本只在本機外部 venv） | 文件化前需查證 |
| 遠端 ComfyUI（非本機）支援 | **未支援**（`server.py:778` 寫死 127.0.0.1） | 若要支援需改 WS 隧道 |
| `SIMPLE_UI_PORT` 改變後控制台行為 | **未確認**（控制台寫死 7860） | 可能出現「UI 在 7861、控制台查 7860」的錯覺 |
| 公開 repo 與本機 tree 是否逐 blob 相同 | 本階段未重新 fetch（Phase 1 已比對 README 一致） | 低風險 |

---

## 14. Git 及正式服務狀態

| 項目 | 狀態 |
|---|---|
| 分支 | `main`（未切換） |
| HEAD | `c2291861ee14e536a994dbe4f9456676a3e19eb0`（未變動） |
| Remote | 未變更；未執行 fetch |
| 調查前 Git 狀態 | `?? devtools/reports/open-source-readiness-phase1.md` |
| Phase 1 報告 | 存在、33,161 bytes、**未修改、未刪除、未被 git 加入任何操作** |
| 本報告 | `devtools/reports/open-source-readiness-phase2a.md`（唯一新增） |
| 既有檔案 | 完全未修改；未建立／刪除任何目錄 |
| Git 寫入 | 無 commit / push / fetch / reset / rebase / stash / checkout / clean |
| 正式服務 | 未啟動、停止、重啟；未碰 ComfyUI / simple_ui / WD14 Worker |
| 生圖／測試 | 未執行任何生圖、高負載或破壞性測試 |
| 安裝／下載 | 無 |
| 使用者資料 | 未修改 localStorage、圖片、設定、環境變數 |

> 完成後預期 `git -C C:\ComfyUI\simple_ui status --porcelain` 顯示兩行未追蹤報告，無其他變更。**未進入 Phase 2B，未開始實作。**
