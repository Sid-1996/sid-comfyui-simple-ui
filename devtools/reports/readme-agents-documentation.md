# GitHub README / AGENTS.md 文件分流與重整 — 交付報告

## 1. 任務目標

將公開 Repo 文件依讀者分流：

- `README.md`：只給一般人類使用者，協助第一次接觸專案的人理解用途、安裝、啟動與使用。
- `AGENTS.md`（新增）：只給 AI Coding Agent，提供理解架構、修改程式、遵守相容性與執行測試的規則。

本次只整理文件，未修改任何應用程式程式碼或正式環境。

---

## 2. 新版 README 的章節及內容調整

### 章節（依建議順序）

1. 專案名稱與簡介
2. 這個專案能做什麼
3. 介面特色與主要功能
4. 系統需求
5. 安裝與啟動
6. 如何連接自己的 ComfyUI
7. 基本操作說明
8. Checkpoint 與 Workflow
9. 環境變數及進階設定
10. WD14 反推功能（選用）
11. 常見問題與故障排除
12. 資料儲存、備份及解除安裝
13. 授權與致謝

### 主要調整

- 保留並強化「使用者連接的是自己電腦上的 ComfyUI、使用自己的硬體與模型、不連接開發者電腦、不是雲端代繪」的說明。
- 保留完整 PowerShell / CMD 安裝、啟動、`COMFY_URL` 設定範例；補充基本操作步驟與快捷鍵表。
- 保留環境變數表與個別說明（`COMFY_URL`、`COMFY_OUTPUT_DIR`、`SIMPLE_UI_PORT`、`COMFY_LAUNCH_CMD`、`SIMPLE_UI_LOG_DIR`、`WD14_*`、`WD14_TMP`），並保留「資料與日誌位置」章節。
- 保留 WD14 選用、未安裝不影響基本生圖的說明。
- 保留常見錯誤表、備份/更新/解除安裝，以及授權（Fair AI Public License 1.0-SD）與致謝。
- **移除**原本屬於開發者文件的內容：「開發驗證」指令、`設計約束（請保留）`、localStorage key 清單、內部模組與 API 術語。
- 末段加入「一般使用者不需要閱讀 `AGENTS.md`」的提示與相對連結。

---

## 3. 新版 AGENTS 的章節及涵蓋規範

新增公開版 `AGENTS.md`，共 13 節：

1. 專案定位與產品目標
2. Repository 結構與檔案職責
3. 技術架構
4. 前端模組與既有 API
5. 後端架構及 API 路由
6. ComfyUI HTTP 代理與 WebSocket 資料流
7. WD14 選用功能及 Worker 邊界
8. localStorage 格式與向下相容要求
9. UI / UX 設計規範
10. 安全性與資料保護
11. 開發風格與修改原則
12. 測試及驗收標準
13. 禁止事項與正式環境注意事項

已涵蓋的具體限制包含：IIFE / `window.Tags` / `window.Dict`、輸出轉義、設計變數、快捷鍵/燈箱/彈窗保留、hover 不變尺寸、一屏不捲動、`/comfy` 與 `/ws` 唯一通道、固定 Workflow 節點、`_json` / `_send` 用法、`ALLOWED` 白名單、`realpath` + `commonpath` 路徑安全、外部輸入驗證、錯誤碼與白話訊息、`WD14_NOT_CONFIGURED` vs `WORKER_ERROR`、`CPUExecutionProvider`、localStorage 新舊 key（`sel`/`combos`/`adult`/`showEn`、`ui.extra`，不讀舊 `pos`）、刪圖安全與 ComfyUI 未連線不刪歷史、測試指令與禁止高負載/GPU 驗收。

---

## 4. 從私人規範保留及排除的內容

### 保留（公開版有價值的技術限制）

- 前端不得直連 ComfyUI，HTTP 走 `/comfy`、WS 走 `/ws`（含 handshake 剩餘 bytes 轉送要求）。
- 靜態檔副檔名白名單與真實路徑邊界檢查。
- `ui.extra` 與舊 `pos` 的相容要求；`sel` / `combos` / `adult` / `showEn` 格式不可改。
- hover 不變尺寸、一屏不捲動、系統字、inline SVG 圖示等 UI 規則。
- `/api/check` 問 ComfyUI 而非猜輸出資料夾；刪圖 SHA-256 比對。
- 基本服務只用標準庫、Python 3.10+、不引入框架/CDN/第三方套件。

### 排除（私人環境依賴）

- `C:\ComfyUI\...`、`D:\ComfyUI_output`、`python_embeded`、私人 venv 與 worker 路徑。
- 私人模型名稱與位置（`WAI-Nsfw-...` 等）。
- 桌面捷徑、`ui_panel.pyw` / `ui_control.ps1` 的個人操作流程。
- Port 清理、PID、行程比對、個人維護指令與硬體 Benchmark 數據。
- ChatGPT / 小弟分工、私人 GitHub 協作授權流程。

> `C:\ComfyUI\AGENTS.md` 僅作為背景參考，沒有整份複製。

---

## 5. 文件與實際程式碼核對結果 `【實際執行 / 靜態檢查】`

| 文件敘述 | 程式碼證據 | 結果 |
|---|---|---|
| Python 3.10+、標準庫、無 Node/npm | `README.md`；`server.py` import 全為標準庫 | 一致 |
| 預設 `COMFY_URL=http://127.0.0.1:8188` | `server.py::_parse_comfy_url()` | 一致 |
| 預設 Port 7860 | `server.py:main()` `os.environ.get("SIMPLE_UI_PORT","7860")` | 一致 |
| 只支援 loopback | `_parse_comfy_url()` 拒絕非 `127.0.0.1` / `localhost` | 一致 |
| `COMFY_OUTPUT_DIR` 非必要 | `_parse_output_dir()`、`/open-output`、`/api/delete` 回 409 | 一致 |
| `COMFY_LAUNCH_CMD` 預設不啟動 | `start_comfy()` 回 `START_NOT_CONFIGURED` | 一致 |
| Checkpoint 由 ComfyUI 提供 | `app.js` 讀 `/object_info/CheckpointLoaderSimple` | 一致 |
| 固定 Workflow 節點 | `app.js::wf()` 節點 1–7 | 一致 |
| localStorage keys | `tags.js:262-302`、`app.js:355,747,1493` 等 | 一致 |
| WD14 未設定回 503 | `server.py` `WD14_NOT_CONFIGURED` | 一致 |
| 授權名稱 | `LICENSE` 第一行 `Fair AI Public License 1.0-SD` | 一致 |

沒有發現文件與程式不一致而需要改程式的情況。

---

## 6. 執行的 Markdown / 連結檢查及結果

命令：`python C:\Users\user\AppData\Local\Temp\doc_check.py`（臨時腳本，非 Repo 檔案）

結果：**84 pass / 0 fail**，包含：

- README / AGENTS 的程式碼區塊成對（fence 數量偶數）。
- 相對連結可解析：`README.md → AGENTS.md`、`AGENTS.md → README.md`。
- README 必要事實全部存在；README 不含內部開發規範關鍵字。
- AGENTS 涵蓋全部要求主題；AGENTS 不含私人路徑/模型/個人流程關鍵字。
- 環境變數預設值與 `server.py` 一致。
- 兩份文件唯一的長行重疊數 = 0（無大量重複）。

另外執行 `git diff --check`：exit 0。README 與 AGENTS 已統一是 CRLF 換行，避免 Git line-ending churn。

---

## 7. 修改檔案清單

| 檔案 | 動作 | 目的 |
|---|---|---|
| `README.md` | 修改 | 重寫為一般使用者文件，移除開發者內部規範 |
| `AGENTS.md` | 新增 | 公開版 AI Coding Agent 開發規範 |
| `devtools/reports/readme-agents-documentation.md` | 新增 | 本報告 |

**未修改**：`app.js`、`app.css`、`index.html`、`tags.js`、`dict.js`、`tag_categories.js`、`server.py`、Workflow、模型、Worker 或正式環境設定。

---

## 8. Git Branch、HEAD、工作區狀態 `【實際執行】`

- Repository：`C:\ComfyUI\simple_ui`
- Branch：`main`
- HEAD：`bd61e35bde7ba84e21174132eafcf66cacb0d839`（與預期一致）
- Remote：`origin` → `https://github.com/Sid-1996/sid-comfyui-simple-ui.git`
- Staged：空
- 工作區：`M README.md`、`?? AGENTS.md`，以及既有 12 份未追蹤報告。

全程未執行 commit / push / stage / reset / restore / stash / checkout / clean；既有報告與使用者修改完整保留。

---

## 9. 正式服務是否受到影響

- 未啟動、停止或重啟任何正式服務；本次為純文件任務。
- 未修改正式環境變數、模型、Workflow、輸出圖片、venv 或依賴。
- 沒有執行 GPU 生圖或高負載測試。

---

## 10. 尚未解決的問題

1. 本次是純文件任務，未重新執行完整 HTTP / 瀏覽器回歸；文件所述功能已與目前程式碼靜態核對一致。
2. 原私人規範中的「一屏不捲動」在極小視窗（例如 1000×700）實測仍可垂直捲動；此為既有 UI 觀察，已如實寫入 AGENTS 作为設計目標，未在本任務修改程式。
3. `devtools/` 內的個人測試腳本仍含環境專屬路徑；公開 AGENTS 已明確標示為開發者工具且不是一般使用者流程，未改動這些檔案。

---

完成後停止，等待 ChatGPT 直接檢查 README、AGENTS、Diff 與本報告進行獨立審查。
