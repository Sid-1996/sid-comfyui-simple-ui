# Phase 2B-2：ComfyUI 外部連線設定 — 實作與驗證報告

## 1. 任務目標

讓公開 Repo 使用者可在本機以 `COMFY_URL` 指定任意 Port 的 ComfyUI（例如 `http://127.0.0.1:8189`），並確保：

- HTTP 代理、連線狀態檢查、WebSocket `/ws` 隧道共用同一個設定來源。
- 只允許本機 loopback（`127.0.0.1` / `localhost`），非法設定在啟動時明確終止，不靜默退回 8188。
- 明確設定 `COMFY_URL` 時視為「外部連線模式」，`/start-comfy` 拒絕啟動開發者路徑的 ComfyUI。
- 未設定時完全維持既有 8188 與自動啟動行為。

僅支援同一台電腦，不支援 LAN／遠端。

---

## 2. 修改檔案及各自目的

| 檔案 | 目的 |
|---|---|
| `server.py` | 新增 `COMFY_URL` 解析與驗證、統一 `COMFY_HOST/COMFY_PORT/COMFY_SCHEME/COMFY_EXTERNAL`、新增 `comfy_up()`、替換所有 hardcoded `port_open(8188)`、`/ws` 改用同一 host/port/Host/Origin（https 時用 stdlib ssl）、外部模式拒絕 `/start-comfy`、設定錯誤時 `main()` 終止 |
| `app.js` | `startComfy()` 正確處理 `EXTERNAL_COMFY` 拒絕結果：顯示後端中文訊息、不誤導去看 logs、不重試 |
| `devtools/reports/open-source-readiness-phase2b2.md` | 本報告（新增） |

`git diff --stat`：`app.js | 9 ++++++-`、`server.py | 88 +++++...`（82 insertions、15 deletions）。

未修改：workflow、KSampler、checkpoint、生成參數、localStorage、WD14、輸出目錄、刪圖、`ui_control.ps1`、`ui_panel.pyw`、README。

---

## 3. `COMFY_URL` 設定方式及支援格式

### 3.1 支援格式

| 輸入 | 結果 |
|---|---|
| 未設定或空字串 | `http://127.0.0.1:8188`，外部模式 `False`（舊行為） |
| `http://127.0.0.1:8189` | Host `127.0.0.1`、Port 8189、外部模式 `True` |
| `http://127.0.0.1:8189/` | 同上，尾端 `/` 正規化 |
| `http://localhost:8189` | Host `localhost`、Port 8189 |
| `https://localhost:8443` | 允許（WS 隧道使用 stdlib `ssl` 包裹） |

### 3.2 拒絕的設定（皆附白話中文錯誤，啟動時終止）

- 非 `http` / `https`（如 `ftp://`）。
- Host 不是 `127.0.0.1` / `localhost`（如 `example.com`、`192.168.1.10`、`127.0.0.2`、`::1`）。
- Port 非數字、超出 1–65535、或完全缺少。
- URL 含帳號密碼、query、fragment、或非預期路徑。

### 3.3 使用方式

```powershell
# 預設（不改任何設定）
python server.py

# 本機 8189
$env:COMFY_URL = "http://127.0.0.1:8189"
python server.py
```

---

## 4. 修改前後 HTTP / WebSocket 連線流程

### 4.1 修改前

```text
HTTP：  /comfy/* → COMFY(寫死 http://127.0.0.1:8188) + path          (舊 28、454 行)
狀態：  port_open(8188) 散見 8 處（start_comfy / status / check / ws / print）
WS：    socket.create_connection(("127.0.0.1", 8188))
        Host: 127.0.0.1:8188 / Origin: http://127.0.0.1:8188
前端：  /comfy/* 與 ws://location.host/ws（相對路徑，本來就正確）
```

### 4.2 修改後

```text
COMFY_URL → _parse_comfy_url() → COMFY / COMFY_HOST / COMFY_PORT / COMFY_SCHEME / COMFY_EXTERNAL
HTTP：  /comfy/* → COMFY + path                                      (server.py:500)
狀態：  comfy_up() → port_open(COMFY_PORT, COMFY_HOST)               (server.py:109)
WS：    socket.create_connection((COMFY_HOST, COMFY_PORT))
        Host: COMFY_HOST:COMFY_PORT / Origin: COMFY                  (server.py:833, 845)
前端：  不變（仍走 /comfy 與 /ws 同源隧道）
```

所有原本 `port_open(8188)` 的 8 處已改為 `comfy_up()`（目前行號：151、154、166、564、592、616、829、946）；剩餘的 `8188` 只出現在 docstring 與預設值（`server.py:7,32,67`）。

---

## 5. `/start-comfy` 在兩種模式的行為差異

| 模式 | 條件 | 行為 |
|---|---|---|
| 預設模式 | 未設定 `COMFY_URL` | 與修改前完全相同：呼叫 `start_comfy()`，成功 200 / 失敗 504，`comfy` 欄位由 `comfy_up()` 產生 |
| 外部連線模式 | 有明確 `COMFY_URL` | **永不呼叫** `start_comfy()`，也不呼叫 `subprocess.Popen`；回 `409` + `{"ok":false,"code":"EXTERNAL_COMFY","error":"目前為外部連線模式（COMFY_URL=...），請自行啟動 ComfyUI，或檢查 COMFY_URL 是否指向正確的 Port。"}`（目前行號 585-592） |

前端 `app.js:133-153`：收到 `EXTERNAL_COMFY` 時設 `S.comfyUp=false`、狀態改「ComfyUI 未連線 · 外部模式」、顯示後端中文訊息並 `return false`；沒有 `setTimeout` 重試，也不會提示去看 `logs/comfyui.err.log`。WebSocket 重連仍以 `S.comfyUp` 為條件，拒絕後不會啟動重連。

---

## 6. 重要程式碼位置

| 位置 | 內容 |
|---|---|
| `server.py:28-58` | `_parse_comfy_url()`：loopback / scheme / port / 帳密 / query / fragment / path 驗證 |
| `server.py:60-68` | 讀取 `COMFY_URL`；錯誤時記入 `_COMFY_ERROR` 並保留安全預設供匯入使用 |
| `server.py:109-111` | `comfy_up()`：統一的 ComfyUI 狀態檢查 |
| `server.py:151,154,166` | `start_comfy()` 改用 `comfy_up()`（僅預設模式會到達） |
| `server.py:500` | `_proxy()` 使用 `COMFY`（單一來源） |
| `server.py:564` | `/api/status` 使用 `comfy_up()` |
| `server.py:585-592` | `/start-comfy` 外部模式拒絕 + 預設模式原行為 |
| `server.py:616` | `_check_files()` 使用 `comfy_up()`（圖片 `/view` 仍走 `COMFY`） |
| `server.py:819-848` | `/ws` 隧道：host/port/Host/Origin 全部由設定計算；https 用 `ssl.create_default_context()` |
| `server.py:935-940` | `main()`：設定錯誤時印中文說明並 `raise SystemExit(2)`，不啟動 server |
| `app.js:133-153` | `startComfy()` 處理 `EXTERNAL_COMFY`，不重試 |

---

## 7. 實際執行的測試及結果

測試腳本置於 OS 暫存區 `C:\Users\user\AppData\Local\Temp\opencode\phase2b2_test.py`（不進 repo）。所有測試以 `importlib` 重新載入模組並搭配不同 `COMFY_URL` 環境變數，使用 mock 的 `urlopen`、`socket.create_connection`、`port_open`、`subprocess.Popen`、`start_comfy`，**未啟動正式服務、未連正式 ComfyUI**。

### 實際命令

```powershell
python 'C:\Users\user\AppData\Local\Temp\opencode\phase2b2_test.py'
python -m py_compile server.py
node --check app.js
git -C 'C:\ComfyUI\simple_ui' diff --check
```

### 結果：33/33 PASS（實際執行）

| 類別 | 項目 | 結果 |
|---|---|---|
| URL（U1–U12） | 預設 8188、8189、`/` 尾斜線、localhost、https、不合法 port（文字/超範圍/0/缺少）、外部網域、LAN IP、127.0.0.2、帳密、query、fragment、路徑、ftp、IPv6 | 全數 PASS |
| HTTP / WS（H1–H5） | 代理 URL 為 `http://127.0.0.1:8189/system_stats`；狀態檢查 `(127.0.0.1, 8189)`；WS 連線 `(127.0.0.1, 8189)`；handshake 含 `Host: 127.0.0.1:8189` 與 `Origin: http://127.0.0.1:8189`；WS 失敗回 502；代理回應格式 200 不變 | 全數 PASS |
| 啟動隔離（S1–S5） | 預設模式仍呼叫 `start_comfy()` 並回 200；外部模式回 409 `EXTERNAL_COMFY`；未呼叫 `start_comfy()`；未觸發 `subprocess.Popen`；含白話中文錯誤訊息 | 全數 PASS |
| 設定錯誤（E1–E2） | 非法 host 被記錄；`main()` 以 `SystemExit(2)` 終止且 `serve_forever()` 未被呼叫 | 全數 PASS |
| 前端（F1–F2） | `app.js` 含 `EXTERNAL_COMFY` 處理；`startComfy()` 內無 `setTimeout` 重試 | 全數 PASS（靜態檢查） |

基礎檢查：`python -m py_compile server.py` 結束碼 **0**；`node --check app.js` 結束碼 **0**；`git diff --check` 結束碼 **0**、無輸出。

---

## 8. 未執行測試及原因

| 項目 | 原因 |
|---|---|
| 真實啟動 server 並用瀏覽器連 8189 的 ComfyUI | 不可啟動／停止正式服務，也沒有取得操作授權 |
| 真正 ComfyUI WebSocket 101 handshake | 需真實 ComfyUI；本次以 mock 上游回 400 驗證 502 路徑與連線參數 |
| 前端 DOM／瀏覽器 runtime 驗證 `EXTERNAL_COMFY` 提示 | 需啟動正式前端；目前已做 `node --check` 與靜态檢查，未做 runtime |
| `https://` ComfyUI 的真實 TLS 連線 | 本機 ComfyUI 一般為 http；https 路徑僅完成程式碼與解析驗證，未實測 |
| GPU 生圖、歷史、燈箱 | 不可執行正式生圖；本次未觸及這些流程 |

上述項目**未執行，不視為通過**。

---

## 9. Git branch、HEAD、工作區狀態

| 項目 | 值 |
|---|---|
| 分支 | `main`（未切換） |
| HEAD（開始時） | `1222293c7b2da04c571c4fd612c4a0a9216f65b1`（`fix: decouple WD14 temp setup from server startup`，由外部於 Phase 2B-1 後提交；與任務文件所載 `c229186…` 不同，已重新確認） |
| HEAD（結束時） | 同上，未變動 |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`，未變更、未 fetch |
| 已追蹤修改 | `server.py`、`app.js` |
| 未追蹤檔案 | 三份既有報告（Phase 1 / 2A / 2B-1，大小未變）與本報告 |
| Git 寫入 | 無 commit / push / reset / rebase / stash / checkout / clean |

`git status --short --branch` 開始時即為 `## main...origin/main` 加上三份未追蹤報告，結束時相同（另加本報告）。

---

## 10. 正式服務是否受到影響

**未受影響。**

- 未啟動、停止或重啟 ComfyUI、simple_ui server、WD14 Worker。
- 未修改 venv、模型、使用者圖片、localStorage 或正式環境變數（測試用環境變數僅存在於隔離 Python 行程）。
- 未安裝或更新任何套件；未執行生圖或高負載測試。
- 測試中的 `COMFY_URL` 只寫入測試行程的 `os.environ`，測試結束即移除，未寫入系統或 shell 設定。

---

## 11. 尚未解決的問題及風險

| 項目 | 說明 |
|---|---|
| `https` WS 隧道僅程式碼支援 | 使用 stdlib `ssl.create_default_context()`；自簽憑證或特殊 TLS 設定可能失敗，未實測 |
| `COMFY_URL` 錯誤在模組匯入時先保留安全預設 | 真正啟動由 `main()` 檢查 `_COMFY_ERROR` 並以 exit 2 終止，不會對外服務；但直接匯入模組呼叫 handler 的測試情境仍可見預設值 |
| `SIMPLE_UI_PORT` 改變時控制台仍查 7860 | 屬 Phase 2B 其他範圍，本次未處理 |
| 輸出目錄、刪圖語意、README、`ui_control.ps1`、`ui_panel.pyw` | 依指示未處理 |
| 前端只做靜態檢查 | `EXTERNAL_COMFY` 提示未做瀏覽器 runtime 驗證 |
| `main()` 啟動訊息仍印 7860 | 既有行為，與本任務無關 |
| 三份舊報告與本報告皆未追蹤 | 依指示保留，由 ChatGPT 決定 Git 收尾 |

---

## 12. 完成條件對照

| 條件 | 狀態 |
|---|---|
| 預設 8188 行為相容 | ✅ U1、S1 與既有程式碼路徑保留 |
| 自訂 Port 同時影響 HTTP、狀態檢查、WebSocket | ✅ H1、H2、H3、H3b |
| URL 驗證限制為本機 Loopback | ✅ U6–U12 |
| 外部模式不可能誤啟動開發者 ComfyUI | ✅ S2–S4 |
| 前端連線失敗處理正常 | ✅ app.js:133-153、F1、F2（靜態） |
| 隔離測試涵蓋主要情境 | ✅ 33/33 PASS |
| 沒有修改範圍外功能 | ✅ 僅 server.py 與 app.js 必要位置 |
| 報告與實際 Diff 相符 | ✅ 見第 2、6 節 |

---

## 13. 驗收修正：外部模式狀態顯示一致性

### 13.1 問題

ChatGPT 獨立審查發現：`checkComfy()` 在後續輪詢失敗時仍顯示「ComfyUI 沒開 · 點我開啟」，且外部模式點擊時先顯示「正在啟動 ComfyUI，第一次要 20～40 秒…」，與外部模式實際行為不符。

### 13.2 本次修改

| 檔案 | 位置 | 修改 |
|---|---|---|
| `server.py` | `565` | `/api/status` 回應新增 `"external": COMFY_EXTERNAL`，原有 `comfy`、`output` 欄位與語意不變 |
| `app.js` | `29` | `S` 狀態新增 `external: false` |
| `app.js` | `105-123` | `checkComfy()` 先向 `/api/status` 取得 `external` 並記錄到 `S.external`；失敗時依 `S.external` 選擇「ComfyUI 未連線 · 外部模式」或原有「ComfyUI 沒開 · 點我開啟」 |
| `app.js` | `163-166` | `ensureComfy()` 在外部模式直接回 `false`，不呼叫 `startComfy()` |
| `app.js` | `1542-1550` | 狀態列點擊：外部模式只提示「請自行啟動 ComfyUI，或檢查 COMFY_URL 的設定」，不顯示啟動提示、不呼叫 `/start-comfy`、不重試 |
| `app.js` | `1678` | 開場 `/api/status` 一併設定 `S.external`，讓首次點擊前即知模式 |

後端 `/start-comfy` 的 `EXTERNAL_COMFY` 防護（`server.py:585-592`）**完整保留**，未因前端判斷而移除。

### 13.3 本次實際執行的測試

隔離測試（OS 暫存區，不進 repo、不啟動服務）：

| 命令 | 結果 |
|---|---|
| `python 'C:\Users\user\AppData\Local\Temp\opencode\phase2b2_status_test.py'` | **6/6 PASS**：預設 `external:false`、外部 `external:true`、`comfy`/`output` 保留、後端拒絕防護仍回 409 `EXTERNAL_COMFY` |
| `node 'C:\Users\user\AppData\Local\Temp\opencode\phase2b2_ui_test.mjs'` | **7/7 PASS**：以 mock `fetch` 與真實 `app.js` 函式片段驗證外部模式失敗訊息、20 秒輪播不覆蓋、點擊不呼叫 `/start-comfy`、`ensureComfy()` 不呼叫 `/start-comfy`、預設模式原有顯示與點擊啟動、連線成功顯示 |
| `python -m py_compile server.py` | 結束碼 **0** |
| `node --check app.js` | 結束碼 **0** |
| `git diff --check` | 結束碼 **0**、無輸出 |

第一次執行 Node mock 時因 ESM `eval` 作用域使函式不可見而失敗（`ReferenceError: checkComfy is not defined`），屬於測試 harness 問題；修正 harness 後重跑 7/7 通過。**產品程式未因該失敗修改。**

### 13.4 未執行項目

- 真實瀏覽器 runtime 與真實 20 秒定時器（以 mock 連續呼叫 `checkComfy(true)` 驗證狀態不變）。
- 真實 ComfyUI 連線、GPU 生圖、正式服務啟動／停止（無授權且不在範圍）。

### 13.5 修正後 Git 狀態

Branch `main`、HEAD `1222293c7b2da04c571c4fd612c4a0a9216f65b1`（未變動）；已追蹤修改 `server.py`、`app.js`；四份未追蹤報告全部保留且內容未被覆蓋；無 commit / push / reset / rebase / stash / checkout / clean；正式服務未受影響。

---

## 14. 最終驗收修正：拒絕空 Query / Fragment 分隔符

### 14.1 問題

`_parse_comfy_url()` 原本只檢查 `parts.query` 與 `parts.fragment`；當 URL 帶有空的 `?` 或 `#` 時這兩個欄位仍是空字串，導致以下格式被錯誤接受：

- `http://127.0.0.1:8189?`
- `http://127.0.0.1:8189#`
- `http://127.0.0.1:8189/?`
- `http://127.0.0.1:8189/#`

### 14.2 修正

`server.py:33-35`：在 `urlsplit()` 之前直接檢查原始字串：

```python
    # 空的 ? / # 不會出現在 parts.query / parts.fragment，必須直接檢查原始字串
    if "?" in text or "#" in text:
        raise ValueError("COMFY_URL 不可包含 query 或 fragment（含空的 ? 或 # 分隔符）")
```

原有 `if parts.query or parts.fragment` 檢查保留；尾端 `/` 正規化與正常 URL（`http://127.0.0.1:8189`、`http://localhost:8189`、`https://localhost:8443`）不受影響。僅改此一處，未改其他功能。

### 14.3 實際執行的測試（全部重跑）

| 命令 | 結果 |
|---|---|
| `python 'C:\Users\user\AppData\Local\Temp\opencode\phase2b2_test.py'` | **37/37 PASS**（原 33 項 + 新增 U10d–U10g 四個空分隔符案例；U2/U3/U4/U5 正常 URL 回歸通過） |
| `python 'C:\Users\user\AppData\Local\Temp\opencode\phase2b2_status_test.py'` | **6/6 PASS** |
| `node 'C:\Users\user\AppData\Local\Temp\opencode\phase2b2_ui_test.mjs'` | **7/7 PASS** |
| `python -m py_compile server.py` | 結束碼 **0** |
| `node --check app.js` | 結束碼 **0** |
| `git diff --check` | 結束碼 **0**、無輸出 |

新增四項皆如實拒絕，錯誤訊息為「COMFY_URL 不可包含 query 或 fragment（含空的 ? 或 # 分隔符）」。

### 14.4 最終 Git 狀態

Branch `main`、HEAD `1222293c7b2da04c571c4fd612c4a0a9216f65b1`（未變動）；已追蹤修改 `server.py`、`app.js`；四份未追蹤報告全部保留；無 commit / push / reset / rebase / stash / checkout / clean；正式服務未啟動、停止或重啟，未執行 GPU 生圖。

**已停止，等待 ChatGPT 最終審查。**
