# AGENTS.md — Sid-simple-ui 開發規範（公開版）

> 這份文件給 AI Coding Agent 與開發者閱讀。一般使用者請看 `README.md`。

## 1. 專案定位與產品目標

Sid-simple-ui 是 ComfyUI 的**外部極簡生圖前端**：使用者自己安裝並啟動 ComfyUI，本專案只提供一個單頁介面，讓使用者點標籤、按一顆生成鍵就得到圖片。

產品目標：一屏到底、只有一個主要動作、錯誤訊息用白話、沒有死路。任何修改都不得破壞「猴子也能上手」的簡單性。

公開 Repo 不包含 ComfyUI、模型、WD14 Worker 或任何使用者資料。不要假設開發者本機環境存在。

## 2. Repository 結構與檔案職責

```
index.html          版面骨架（頂列 / 標籤庫 / 舞台 / 設定 / 動作列）
app.css             設計 token 與全部樣式（深紫主題）
app.js              生成流程、進度、取消、歷史、燈箱、快捷鍵（IIFE）
tags.js             標籤庫資料與渲染，暴露 window.Tags（IIFE）
dict.js             中文 → Danbooru 英文對照，暴露 window.Dict（IIFE）
tag_categories.js   標籤分類資料（由 index.html 載入）
r18.json            成人標籤資料
server.py           標準庫 HTTP 伺服器：靜態檔 + /comfy 代理 + /ws 隧道 + API
assets/             介面圖片與 icon
devtools/           開發者驗收工具與報告，不是一般使用者流程
gen_assets.py       一次性產生介面素材的工具
ui_control.ps1 /
ui_panel.pyw /
ui_panel.ps1        開發者本機輔助控制台，含環境專屬路徑；公開使用者不要使用
```

`index.html` 依序載入 `dict.js`、`tags.js`、`tag_categories.js`、`app.js`。修改腳本載入順序前，先確認模組間的全域 API 相依性。

## 3. 技術架構

- 前端：原生 HTML / CSS / JavaScript，沒有框架、沒有 build step、沒有外部 CDN 或外部字型。
- 後端：`server.py` 只用 **Python 標準庫**；不引入第三方 Python 套件。
- 各 JS 檔案以 IIFE 包裹，透過 `window.Tags` / `window.Dict` 對外提供既有 API。
- 不任意引入 React、Vue、其他前端框架、Build System、外部字型或 CDN。

## 4. 前端模組與既有 API

- `window.Dict` 提供 `DICT`、`tr()`、`leftover()`、`esc()`；`app.js` 用 `Dict.esc()` 做輸出轉義。
- `window.Tags` 提供標籤渲染與操作（例如 `init()`、`buildPrompt()`、`applyRandomCombo()`、`snapshot()`、`restore()`、`clear()`、`addTags()`、`matchTag()`、`tagZh()`、`isAdult()`、`learn()`、`recordGeneration()`、`syncFromStorage()`、`hasContent()`）。
- 產生動態 HTML 時必須沿用 `Dict.esc()` 或同等轉義，避免 XSS。
- CSS 優先沿用 `app.css` 開頭的設計變數，不要到處寫死顏色、圓角與間距。
- 保持既有快捷鍵、彈窗（dialog）、燈箱與互動流程。目前快捷鍵包含 `Ctrl/Cmd+Enter` 生成、`Esc` 關閉最上層視窗（生成中連按兩次才取消）、`/` 聚焦搜尋、`?` 顯示說明、燈箱中 `←` / `→` 切換圖片。
- Hover 不得改變元素尺寸（曾因英文標籤展開造成閃爍）。要顯示額外資訊請用 tooltip 或固定空間。
- 保持「一屏不捲動」：`html/body` 不應出現捲軸；內部 `.tags`、`.stage-body` 可各自捲動。
- 只用系統字（微軟正黑體），不引入外部字型。

## 5. 後端架構及 API 路由

`server.py` 沿用 `http.server` + `socketserver.ThreadingMixIn` 的標準庫伺服器，所有路由集中在上層 handler 分派：

- `GET /`：靜態首頁；其他不存在的前端路由一律回退到 `index.html`。
- `GET/POST /comfy/*`：透明代理到 `COMFY_URL`。
- `GET /ws`：WebSocket 隧道（需 `Sec-WebSocket-Key`）。
- `GET /api/status`：回傳 `comfy`、`output`、`external`、`output_ok`、`output_error`。
- `POST /api/check`：檢查歷史圖片是否仍存在（向 ComfyUI 的 `/view` 發 HEAD）。
- `POST /api/delete`：刪圖；必須通過路徑、類型及 SHA-256 內容比對。
- `POST /api/reverse`：WD14 反推（選用）。
- `GET /open-output`、`POST /start-comfy`：均由輸出資料夾 / `COMFY_LAUNCH_CMD` 控制。
- `POST /api/output-dir`：由介面設定輸出資料夾；body 為 `{"path": "<absolute path>"}`。只接受帶 `X-SimpleUI: 1` 的同源請求（Origin 存在時也必須匹配本頁 host），避免跨站竄改本機路徑。
- 輸出資料夾來源：啟動環境變數 `COMFY_OUTPUT_DIR`（有明確設定但無效時保持錯誤，**不回退**到保存設定）→ 未設定時才讀使用者資料目錄的 `output_dir.txt` → 未設定。三種來源共用同一套驗證（絕對路徑、存在、可讀寫、非磁碟根、不在 Repo 內、不與 `WD14_TMP` 重疊）。介面設定立即更新全域 `OUTPUT_DIR`；保存寫入失敗時 API 回 `persisted:false` 與 `OUTPUT_NOT_PERSISTED`，前端明確提示重啟後可能失效，不假裝永久保存成功。
- 設定輸出資料夾時不得放寬既有安全檢查：路徑必須絕對、存在、可讀寫、不是磁碟根、不在 Repo 內、不與 `WD14_TMP` 重疊；刪圖仍須通過 SHA-256 內容比對。

規則：

- JSON 回應優先使用既有 `_json(code, obj)`；原始位元組（圖片、靜態檔）沿用 `_send()`。
- 新增路由遵循既有 `do_GET` / `do_POST` 分派方式，不要把邏輯散到各處。
- 靜態檔遵守副檔名白名單 `ALLOWED`，並使用 `realpath()` + `commonpath()` 做目錄邊界檢查；例外一律拒絕。
- 外部輸入（query、POST body、圖片、路徑）都必須驗證。
- 錯誤回應應包含適當 HTTP status、穩定錯誤 `code` 與白話中文 `error`；不要破壞既有 API 回傳格式。

## 6. ComfyUI HTTP 代理與 WebSocket 資料流

- 前端**不得**直接連接 ComfyUI（例如直連 `ws://127.0.0.1:8188`）；ComfyUI 有同源檢查，會回 403。
- HTTP 一律走同源的 `/comfy/*`，由 `server.py::_proxy()` 轉送。
- WebSocket 一律走同源的 `/ws?clientId=...`，由 `_ws_tunnel()` 轉發，並改寫 Host / Origin。
- `_ws_tunnel()` 必須保留握手後剩餘 bytes 的轉送，以及客戶端在握手階段已送出資料的補送；WS frame 必須原封不動，不解碼、不重組。
- ComfyUI 位址沿用 `COMFY_URL` 機制（只接受本機 loopback）。不要新增第二套位址來源，也不要偷偷回退到固定 Port。
- 不得任意更改固定生圖 Workflow、節點或生成參數。目前 Workflow（在 `app.js` 的 `wf()`）固定使用 `CheckpointLoaderSimple`、`CLIPTextEncode` ×2、`EmptyLatentImage`、`KSampler`、`VAEDecode`、`SaveImage` 等節點，輸出從節點 `"7"` 讀取。
- 前端使用的 ComfyUI 端點包含 `/system_stats`、`/object_info/CheckpointLoaderSimple`、`/prompt`、`/history/<pid>`、`/view`、`/queue`、`/interrupt`。

## 7. WD14 選用功能及 Worker 邊界

- WD14 是**選用功能**，不是基本生圖的必要依賴；缺少時基本服務必須照常啟動與運作。
- 公開 Repo **不包含**完整 Worker、模型與專用 Python venv。不要假設任何外部 WD14 路徑存在，也不要把它們搬進 Repo 當成必要依賴。
- 未設定 WD14 環境變數時，`/api/reverse` 回 503 `WD14_NOT_CONFIGURED`；真正執行期故障才用 `WORKER_ERROR`，不要混為一談。
- EVA02 與 ViT v3 各自使用獨立設定，不可因其中一套不存在而誤用另一套。
- WD14 一律使用 `CPUExecutionProvider`；**不可為 WD14 使用 GPU**，以免影響 ComfyUI 生圖。
- 暫存圖放在 Sid-simple-ui 自己管理的使用者資料目錄；清理只針對本程式命名格式的過期檔案，且不遞迴、不追蹤 symlink 逃逸。
- 不要自動下載模型、建立 venv 或安裝依賴。

## 8. localStorage 格式與向下相容要求

必須保留既有舊資料格式，未經明確需求不得改變或清空：

| Key | 格式 / 說明 |
|---|---|
| `sel` | 已選標籤陣列 |
| `combos` | 使用者儲存的標籤組合 |
| `adult` | `"1"` / `"0"`，成人標籤開關 |
| `showEn` | `"1"` / `"0"`，顯示英文標籤開關 |

其他新 UI 狀態優先使用 `ui.` 前綴，例如 `ui.gallery`、`ui.settings`、`ui.genLog`、`ui.extra`、`ui.advOpen`、`ui.moreCats`、`ui.selSortMode`、`ui.learnedTags`。

補充描述使用 `ui.extra`；**不得重新讀取舊的 `pos` key**。

不要刪除使用者設定、清空 localStorage，或改變既有 key 的資料格式。修改前先考慮舊版資料的讀取路徑。

## 9. UI / UX 設計規範

- 只有一個主要動作（生成），維持一屏操作。
- 中文文案要白話；錯誤訊息要告訴使用者下一步按哪裡。
- 圖示使用 inline SVG（stroke 1.75），不要用 emoji 當功能圖示。
- hover 不改變元素尺寸；空間不足用 tooltip 或固定空間。
- 內部區域可捲動，但整頁不捲動。
- 18+ 內容預設隱藏，需明確開啟。

## 10. 安全性與資料保護

- 不得假設使用者本機路徑，不得把環境專屬絕對路徑寫成公開部署的必要條件。
- 刪圖前必須保留現有安全驗證：路徑邊界、類型檢查、ComfyUI `/view` 內容比對（SHA-256）。
- 無法確認刪除目標時不要刪除；ComfyUI 未連線時不可移除歷史紀錄。
- 靜態檔案不得回傳 Repo 外部的檔案；路徑檢查失敗一律拒絕。
- 不可擅自清理使用者圖片、輸出資料、設定或其他本機資料。
- 不要在未經授權的情況下停止或重啟正式服務。
- 對外連線僅限本機 loopback；不要加入遠端或 LAN ComfyUI 支援，除非有明確需求。

## 11. 開發風格與修改原則

- 先讀程式碼再改文件；文件與程式不一致時以程式碼為準，並在交付時記錄差異。
- 優先修改既有檔案與函式，避免大規模重寫。
- 沿用現有命名、錯誤碼與回傳格式。
- 不引入框架、build step、外部 CDN 或第三方 Python 套件。
- 不為宣稱支援舊 Python 而加入相容層；本專案要求 Python 3.10+。

## 12. 測試及驗收標準

基本語法檢查：

```powershell
node --check app.js
node --check tags.js
node --check dict.js
node --check tag_categories.js
python -m py_compile server.py
```

- 依修改範圍執行實際測試，不要只依賴語法檢查。
- UI 修改應盡可能透過瀏覽器操作驗證（載入、按鈕、Console 錯誤、版面不捲動）。
- 需要隔離驗證時，使用獨立 Clone、Mock 服務與獨立 Port；不要連接正式服務。
- 不要為了追求測試數量執行沒有價值的測試。
- 不要大量生成圖片或佔用 GPU 進行驗收。
- 涉及 API 回傳格式、localStorage、代理或 WS 的修改，必須做相容性回歸。

## 13. 禁止事項與正式環境注意事項

- 不修改或刪除既有報告與使用者修改。
- 不執行未經授權的 Git 寫入操作（commit、push、stage、reset、restore、stash、checkout、clean）。
- 不停止、重啟或修改正式 ComfyUI、simple_ui、WD14 Worker 與正式環境設定。
- 不修改模型、Workflow、輸出圖片或個人資料。
- 不把私人開發工具、捷徑、個人維護流程、硬體數據或私人路徑寫入公開文件。
- 不承諾尚未實作的功能（例如自動更新、遠端 ComfyUI、內建 WD14 安裝）。

---

如需了解一般使用者如何安裝與操作，請回到 [`README.md`](README.md)。
