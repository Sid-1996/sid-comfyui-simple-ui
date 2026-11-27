# Phase 2C 公開安裝與啟動體驗 — 實作與驗證報告

## 1. 修改檔案及目的

| 檔案 | 目的 |
|---|---|
| `README.md` | 全面重整為公開使用者文件：移除 repo 外 AGENTS.md 指示、過時輸出目錄／Checkpoint／embedded Python／桌面捷徑說法；補上可直接複製的 PowerShell／CMD 安裝啟動步驟、三個一般使用者環境變數、WD14 與控制台限制、更新／備份／解除安裝／常見錯誤。 |
| `app.js` | WD14 反推錯誤分類：`rvRun()`（`:1261`）把後端 `code`／HTTP `status` 附在 Error 上；`rvExplain()`（`:1168-1189`）以 `code` 為第一層判斷，區分「Worker 未安裝」與「暫時性失敗」，保留其他錯誤原語意。 |
| `server.py` | `main()`（`:1098-1102`）把 `SIMPLE_UI_PORT` 解析提前到啟動提示之前，讓終端機印出的網址與實際 bind 的 Port 一致。 |
| `devtools/reports/open-source-readiness-phase2c-implementation.md` | 本報告（新增）。 |

`git diff --stat`：`README.md | 200 +…`、`app.js | 22 +-`、`server.py | 3 +-`（共 201 insertions、24 deletions）。

未修改：`ui_control.ps1`、`ui_panel.pyw`、`ui_panel.ps1`、`gen_assets.py`、Workflow、Checkpoint、WD14 資源、localStorage 格式、正式圖片或服務；未新增 `requirements.txt`、`.env`、Installer 或多平台支援。

---

## 2. README 各章節變更摘要

| 章節（目前行號） | 變更 |
|---|---|
| 這是什麼（`:6-20`） | 明確說明這是 ComfyUI 的外部前端、使用者在本機執行並連接自己的 ComfyUI、使用自己的硬體／Checkpoint／模型，不連接開發者電腦或外部代繪服務；WD14 改標為選用。 |
| 系統需求（`:22-30`） | 改為 Windows 桌面 + 建議 Python 3.10+；ComfyUI 由使用者自行安裝管理；基本服務只用標準庫、不需 `pip install`；前端不需 Node/npm/build/CDN；移除「必須用 embedded Python」。 |
| 安裝與啟動（`:32-82`） | 完整五步驟（Clone → 確認 Python → 啟動自己的 ComfyUI → `python server.py` → 開 `http://127.0.0.1:7860`）；提供 PowerShell 與 CMD 的 `cd` 指令；說明 `py` 替代方案、`Ctrl+C` 停止；另設小節示範 `COMFY_URL` 的 PowerShell／CMD 寫法。 |
| 環境變數（`:84-141`） | 只列 `COMFY_URL`、`COMFY_OUTPUT_DIR`、`SIMPLE_UI_PORT`；逐項寫預設值、用途、何時設定、範例、「重啟後生效」；說明 `COMFY_URL` 僅 loopback（localhost/127.0.0.1）、不支援 LAN/遠端、設定錯誤會終止；說明 `COMFY_OUTPUT_DIR` 非必要、須與 ComfyUI 實際輸出資料夾一致、未設定時基本生圖與瀏覽仍可用但刪圖／開資料夾停用；`SIMPLE_UI_PORT` 改 Port 後要開對應網址。 |
| Checkpoint 與 Workflow（`:143-147`） | 改為「清單由 ComfyUI 動態提供、在 UI 選擇、不需改 Workflow」，並聲明 Repo 不含任何 Checkpoint。 |
| WD14 反推（`:149-155`） | 標為選用；基本生圖不依賴；公開 Repo 不含完整 Worker／模型／venv；開發者 `C:\ComfyUI\tools` 不屬 Repo；尚無公開安裝指引，缺少資源時會明確提示，不影響生圖。 |
| 桌面控制台（`:157-161`） | 明確標為開發者本機輔助工具，不進一般使用者流程，並警告可能停止使用者自己的 ComfyUI。 |
| 更新、備份與解除安裝（`:163-185`） | 補 `git status` 更新前檢查、備份自行修改檔案與 `localStorage`、停止程序後只刪 Repo 目錄、不刪 ComfyUI／模型／輸出圖片。 |
| 常見錯誤（`:187-196`） | 新增 Python 找不到、Port 衝突、ComfyUI 未啟動、`COMFY_URL` 錯誤、輸出目錄未設定、WD14 資源缺失六項。 |
| 移除 | 原「怎麼跑」的桌面捷徑與 `D:\ComfyUI_output` 段落、原「路徑說明」要求修改本機路徑的段落、要求閱讀 repo 外 `AGENTS.md` 的指示。 |
| 保留 | 專案介紹、設計約束、授權（Fair AI Public License 1.0-SD，與 `LICENSE:1` 一致）、致謝與個人筆記。 |

---

## 3. WD14 錯誤提示的判斷依據與處理方式

### 3.1 後端實際回應（唯讀確認）

- `server.py:313-317`：`_spawn()` 找不到 Worker Python／程式時丟 `RuntimeError("找不到 WD14 Python：…" / "找不到 WD14 Worker：…")`。
- `server.py:371-382`：`ensure_ready()` 捕捉該例外，回 `(False, 錯誤字串)`。
- `server.py:945-962`：`submit()` 的失敗結果轉成 `/api/reverse` 的 `503 {ok:false, code:"WORKER_ERROR", error:找不到…}`，逾時則 `504`，Worker 意外結束則 `503`。
- 其他錯誤各有明確 code：`BUSY`(429)、`TMP_FAIL`(500)、`BAD_TYPE`(415)、`TOO_LARGE`(413) 等。

### 3.2 前端修改

- `app.js:1278-1284`（`rvRun()`）：原本 `throw new Error(j.error || ...)` 會把 `j.code`／HTTP status 丟掉；現在建立 Error 後附加 `err.code = j.code || ""`、`err.status = r.status`，再丟出。
- `app.js:1168-1189`（`rvExplain()`）：
  1. **先以 `code` 判斷大類**：`code === "WORKER_ERROR"` 才進入 Worker 相關分支。
  2. 在 `WORKER_ERROR` 內，用 `error` 是否含「找不到 WD14／未安裝／not found」區分「資源不存在」→ 新提示「WD14 反推功能尚未安裝或未完成設定…基本生圖不受影響…」。
  3. 其餘 `WORKER_ERROR`（例如 Worker 意外結束、啟動逾時）→ 「反推服務暫時沒回應，按一下 F5 重新整理再試；基本生圖不受影響。」
  4. `BUSY` 直接顯示後端白話訊息，不冠「反推失敗」。
  5. `TMP_FAIL`、`逾時`、HTTP 502/503、`Failed to fetch`、圖片格式／大小／內容錯誤各自保留原有提示。
- 既有 EVA02／ViT v3 模型切換與成功渲染流程完全未動；API 回傳格式未變；未新增安裝按鈕或連結。

### 3.3 為什麼仍需要看 `error` 文字

後端目前把「資源不存在」與「Worker 暫時失敗」都放在同一個 `WORKER_ERROR` code 下（`server.py:315-317,959-962`），只靠 code/status 無法再細分；因此做法是以 code 當第一層依據、再用後端原有的錯誤字串做第二層分類，**不是只靠比對文字**。若要完全去除文字比對，需另外新增后端 error code，屬本次範圍外。

---

## 4. Port 提示修正方式

`main()` 原本先印 `http://127.0.0.1:7860`，再讀 `SIMPLE_UI_PORT`（原 `server.py:1098-1099`），造成設定其他 Port 時提示錯誤。本次只做最小調整（`server.py:1098-1102`）：

```python
# 先取得實際監聽 port，再印網址，避免提示與 bind 的 port 不一致
port = int(os.environ.get("SIMPLE_UI_PORT", "7860") or 7860)
print("簡易生圖: http://127.0.0.1:%d  (ComfyUI: %s)" % (port, "已連線" if comfy_up() else "未啟動"))
try:
    S(("127.0.0.1", port), H).serve_forever()
```

- 預設值仍為 7860；環境變數名稱與 `int()` 行為完全不變。
- 未新增驗證：非數字設定仍維持原本的 `ValueError` 行為，避免破壞既有使用方式。
- 沒有啟動正式服務即可驗證（見第 5 節 mock 測試）。

---

## 5. 實際測試命令及結果

工作目錄：`C:\ComfyUI\simple_ui`

```powershell
node --check app.js
python -m py_compile server.py
git diff --check
python 'C:\Users\user\AppData\Local\Temp\opencode\phase2c_impl_test.py'
node 'C:\Users\user\AppData\Local\Temp\opencode\phase2c_frontend_test.mjs'
python 'C:\Users\user\AppData\Local\Temp\opencode\phase2b3_backend_test.py'
node 'C:\Users\user\AppData\Local\Temp\opencode\phase2b3_frontend_test.mjs'
```

| 檢查 | 結果 |
|---|---|
| `node --check app.js` | 結束碼 **0** |
| `python -m py_compile server.py` | 結束碼 **0** |
| `git diff --check` | 結束碼 **0**、無警告（README 換行已統一為 CRLF） |
| Phase 2C README + Port 隔離測試 | **18/18 PASS** |
| Phase 2C WD14 前端隔離測試 | **10/10 PASS** |
| Phase 2B-3 後端回歸測試 | **41/41 PASS** |
| Phase 2B-3 前端回歸測試 | **23/23 PASS** |

README／Port 測試（OS 暫存區 `phase2c_impl_test.py`）以字串檢查 README 15 項，並以 mock 的 `S` / `comfy_up` / `os.makedirs` / `threading.Thread` 呼叫 `main()`，擷取 stdout 驗證：
- 未設定 → 印 `http://127.0.0.1:7860` 且 bind `("127.0.0.1", 7860)`
- 設 7861 → 印 7861、不出現 7860、bind 7861
- 設 8888 → 印 8888、bind 8888

WD14 前端測試（OS 暫存區 `phase2c_frontend_test.mjs`）從 `app.js` 抽出 `rvExplain` 與 `rvRun`，以 mock `fetch`／DOM 驗證 10 項：Worker 缺失提示、code/status 傳遞、暫時性 Worker 錯誤仍可重試、BUSY 直接顯示、網路錯誤可重試、BAD_TYPE 不被誤判、成功路徑正常渲染、TMP_FAIL 獨立提示，以及基本生成 API 仍在。

兩份測試腳本都在 OS 暫存區，未進 Repo。測試期間 README 靜態檢查曾有一項失敗（環境變數表仍列出 `WD14_*`／`REV_BASE`），已移除該列後完整重跑 18/18 通過；產品程式未因該失敗修改。

---

## 6. 未執行的測試及原因

| 未執行 | 原因 |
|---|---|
| 啟動正式 `server.py` 並在瀏覽器實際操作 | 授權範圍排除正式服務啟停 |
| 真實 ComfyUI 連線、真實生圖 | 不得連線／干擾正式 ComfyUI、不得生圖 |
| 真實 WD14 Worker 缺失或正常的端到端行為 | 不得啟動 Worker；以 mock HTTP 回應取代 |
| 跨平台（Linux/macOS）README 指令驗證 | 範圍限定 Windows |
| Python 3.5/3.7 舊版解釋器實測 | 本機只有 3.13；此為 Phase 2C 調查的殘餘風險 |
| desktop 控制台可移植性 | 明確不在本次範圍 |

以上未執行項目**不視為通過**。

---

## 7. Git Branch、HEAD、工作區狀態

| 項目 | 值 |
|---|---|
| 分支 | `main`（未切換） |
| HEAD（開始與結束） | `12ad15ae2d23e67d16db2c4ec745c133eb21c28c` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（未變動） |
| 已追蹤修改 | `README.md`、`app.js`、`server.py` |
| 未追蹤檔案 | 六份既有報告（Phase 1 / 2A / 2B-1 / 2B-2 / 2B-3 / 2C）完整保留 + 本報告 |
| Git 寫入 | 無 commit / push / reset / restore / stash / checkout / clean / rebase |

開始前工作區只有六份未追蹤報告、無已追蹤修改，與 Phase 2C 調查時一致；沒有需要辨識來源的外來修改，也沒有覆蓋既有報告。

---

## 8. 正式服務是否受到影響

**未受影響。**

- 未啟動、停止或重啟 ComfyUI、`simple_ui/server.py`、WD14 Worker。
- 未執行生圖、反推或任何高負載測試。
- 未修改正式圖片、資料夾、localStorage、環境變數或 Workflow。
- 未安裝或更新套件、未下載模型。
- 測試只使用 tempfile／mock／字串檢查；Repo 內只有三個檔案被修改與本報告被新增。

---

## 9. 尚未解決的問題及風險

1. **WD14 同 code 細分仍依赖錯誤字串**：後端把「未安裝」與「暫時失敗」都回 `WORKER_ERROR`；若要完全以 code 區分，需新增后端 error code（本次範圍外）。
2. **`SIMPLE_UI_PORT` 非數字仍直接 traceback**：本次刻意未加驗證，以維持既有行為；README 常見錯誤未包含此特定情境。
3. **README 的 Python 建議 3.10+ 未實測**：Phase 2C 的 3.5／3.7 是 API 推導，本機只有 3.13。
4. **沒有在全新使用者機器做端到端安裝**：流程為靜態推導與 mock 驗證。
5. **桌面控制台仍含開發者路徑**：本次只透過 README 明確排除，未修改腳本本身（依指示）。
6. **HTTPS ComfyUI 與跨 ComfyUI 版本相容性**未實測（沿用既有風險）。
7. **README 更新／備份的 localStorage 說明較簡化**：未逐條列出所有 localStorage key；屬文件深度取捨。

**已停止，等待 ChatGPT 直接讀取實際程式碼、Diff、測試結果並獨立審查。**
