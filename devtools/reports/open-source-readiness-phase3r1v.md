# Open-Source Readiness — Phase 3R1-V：開源乾淨環境重新部署驗證

## 0. 結論

以公開 `origin` 的全新 Clone（HEAD `d7e3fe7c62fa222953239b3d6626c4b77ca364af`）、 system Python 3.13.15、兩個隔離 Mock ComfyUI、獨立 Port 與隔離 `LOCALAPPDATA` / `APPDATA` / `TEMP` 完成重新驗證。

**核心驗收目標達成**：一般使用者只取得公開 Repo、準備自己的 Python 與 ComfyUI，即可啟動並使用基本生圖功能；不需要開發者本機路徑、WD14 Worker、模型或任何外部資源。全程沒有連到正式 8188，也沒有使用正式 Worker。

- 開發者路徑 snapshot（logs / tmp / tools）測試前後 **IDENTICAL**，沒有新啟動的 portable / Worker / ComfyUI 程序。
- 靜態/隔離測試 65/0；HTTP 整合 19/0（無輸出目錄）與 24/0（有輸出目錄）；WebSocket 六種模式全通過；瀏覽器端完整生成流程 console 0 錯誤。
- 只新增本報告，未修改正式 Repo 程式碼，未 commit / push / stage。

結果分類：`【實際執行】`、`【隔離 Mock 測試】`、`【靜態檢查】`、`【未執行】`。

---

## 1. 任務目標與測試環境

驗證 Phase 3R1 修正後，公開 Repo 在完全獨立環境下的部署可行性；不是新功能開發。

| 項目 | 值 |
|---|---|
| 測試根目錄 | `%TEMP%\sid-simple-ui-phase3r1v-20261123-113238`（已刪除） |
| Clone | `<base>\clone`（直接 `git clone https://github.com/Sid-1996/sid-comfyui-simple-ui.git`） |
| Clone HEAD | `d7e3fe7c62fa222953239b3d6626c4b77ca364af`（`main`，working tree 乾淨） |
| Python | 3.13.15，`C:\Users\user\AppData\Local\Programs\Python\Python313\python.exe` |
| 第三方套件 | 未安裝 WD14 / onnxruntime；基本服務 import 全為標準庫 |
| Mock Port | `58111`（mock1）、`58112`（mock2，帶不同版本標籤） |
| simple_ui Port | `58113`；無 `COMFY_URL` 實例 `54089` |
| 隔離環境變數 | `LOCALAPPDATA` / `APPDATA` / `TEMP` / `TMP` 全部指向 `<base>\env` |
| 清除的環境變數 | `WD14_PY`, `WD14_WORKER`, `WD14_VIT_PY`, `WD14_VIT_WORKER`, `WD14_TMP`, `SIMPLE_UI_LOG_DIR`, `COMFY_URL`, `COMFY_LAUNCH_CMD`, `COMFY_OUTPUT_DIR`（依情境另外設定） |

沒有複製正式 Repo 檔案、`C:\ComfyUI\tools`、venv、Worker、模型或正式圖片；Mock 測試圖片為本次以 zlib/struct 產生的小型 48×48 PNG（123 bytes）。

---

## 2. 公開 Clone 的 Commit 與起始檢查 `【實際執行】`

| 項目 | 結果 |
|---|---|
| 正式 Repo | `C:\ComfyUI\simple_ui`，`.git` 存在 |
| Branch / HEAD | `main` / `d7e3fe7c62fa222953239b3d6626c4b77ca364af`（與預期一致） |
| Remote | `origin` → `https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| `origin/main` | `d7e3fe7...`，`rev-list --left-right HEAD...origin/main` = `0 0` |
| 正式 Port | 7860 / 8188 測試前後皆無 Listen |
| Staged | 空；既有 10 份報告未追蹤、完整保留 |

已閱讀 `C:\ComfyUI\AGENTS.md`、Repo 內 `README.md` / `SECURITY.md` / `devtools/README.md` 及既有 Phase 1～3R1-R 報告。未對正式 Repo 做任何 reset / checkout / pull / clean。

---

## 3. 測試 A：開發者路徑完全隔離 `【實際執行 + 隔離 Mock 測試】`

`static_tests.py`（65/0 PASS，摘錄）：

| 檢查 | 結果 |
|---|---|
| `COMFY_EXTERNAL=False`、預設 `COMFY=http://127.0.0.1:8188` | PASS |
| `COMFY_LAUNCH=[]`、無設定錯誤 | PASS |
| 四個 WD14 Worker 路徑皆空 | PASS |
| `WD14_TMP` 落在隔離 `LOCALAPPDATA\SidSimpleUI\wd14-tmp`，且開頭無 `ComfyUI` | PASS |
| `LOG_DIR` 落在隔離 `LOCALAPPDATA\SidSimpleUI\logs` | PASS |
| EVA02 / ViT `wd14_missing_config()` 皆回「尚未設定」 | PASS |
| `purge_wd14_tmp()` 目錄不存在時回 0 且不建立目錄 | PASS |

HTTP（`http_tests.py 58113`）：

- `/api/status` → `{"comfy": true, "output": "", "external": true, ...}`。
- `/api/reverse`（eva02 / vit）→ 503 `WD14_NOT_CONFIGURED`，訊息不含任何開發者路徑。
- 無 `COMFY_URL` 的獨立實例：`POST /start-comfy` → 409 `START_NOT_CONFIGURED`，沒有啟動任何程式。
- 開發者行程檢查：`wd14_worker.py` / `python_embeded` / `ComfyUI\main.py` 全部 0 個。

Developer snapshot（只讀 metadata，`dev_snapshot.py` 前後比對）：

- `C:\ComfyUI\logs`：檔案清單、大小、mtime_ns、小檔 SHA-256 全部相同。
- `C:\ComfyUI\tmp`：`wd14`、`wd14_test` 子目錄及其檔案清單相同（未讀模型內容）。
- `C:\ComfyUI\tools`：頂層名稱/類型/mtime 相同（未進入模型與 venv 內容）。
- 結果：**IDENTICAL**。

---

## 4. 測試 B：基本服務與 Mock ComfyUI 整合

### B1 HTTP 代理 `【隔離 Mock 測試】`

`http_tests.py 58113`（無輸出目錄）19/19 PASS：

- 靜態資源 `/app.css`、`/app.js`、`/tags.js`、`/dict.js`、`/tag_categories.js`、`/r18.json` 全部 200。
- `/comfy/system_stats` → 200，回傳 Mock 版本。
- `/comfy/object_info/CheckpointLoaderSimple` → checkpoint 清單 `['WAI-Nsfw-Illustrious-17.safetensors','mock.safetensors']`。
- `POST /comfy/prompt` → `prompt_id=r1v-prompt-0001`。
- `/comfy/history/<pid>` → `outputs["7"].images` 含 1 張圖。
- `GET`/`HEAD /comfy/view` → 200，PNG magic 正確，HEAD body 為空。

### B2 生圖流程（瀏覽器）`【實際執行（真實瀏覽器 + Mock）】`

- 狀態列 `ComfyUI 已連線`（`data-state=up`），checkpoint 下拉自動帶出 Mock 的兩個模型。
- 點擊 `#go` 後 network 記錄到 `/comfy/prompt` 與 `/comfy/history/r1v-prompt-0001`。
- `#stageResults` 顯示、`#stageProgress` 隱藏，`localStorage['ui.gallery']` 從 0 變 1。
- 結果圖 Scroll 入可視範圍後 `complete=true`、`naturalWidth=48`、`naturalHeight=48`，確認由 `/comfy/view` 正確解碼。
- Console 錯誤數 **0**。

### B3 WebSocket 首批 frame `【隔離 Mock 測試】`

`ws_test.py <mode> 58113` 逐 byte 比對：

| Mock 模式 | 結果 |
|---|---|
| `normal`（handshake 後 0.2s 才送 frame） | 101 + 5 個 text frame 位元組完全一致 |
| `samechunk`（101 + 5 frame 同一個 TCP write） | 101 + 5/5 frame 完全一致（Phase 3R1 修正回歸） |
| `split`（handshake 分多段） | 101 + 5/5 frame 完全一致 |
| `multiframe` | 5 text frame + `bytes(range(256))` binary frame 完全一致 |
| `echo`（client 在 handshake 同一 write 提早送 frame） | 101 + client frame 原封 Echo，位元組完全一致 |
| `fail`（上游 403） | tunnel 回 502 JSON，含 `HTTP/1.1 403 Forbidden` 原因 |

> 測試腳本初版在 echo / fail 模式印出「不適用」的檢查 FAIL 行，已修正顯示邏輯並重跑，兩模式皆 PASS；正式程式未因此修改。

### B4 不同 ComfyUI Port `【隔離 Mock 測試】`

將 `COMFY_URL` 改為 `http://127.0.0.1:58112`（mock2，代號 `mock2-distinct`）並重啟隔離 server：

- `/api/status` → `external: true`、`comfy: true`。
- `/comfy/system_stats` 回傳 `mock2-distinct`，證明請求到第二個 Mock，而非回退 8188。
- 8188 Listen 數 = 0。

---

## 5. 測試 C：輸出目錄與刪圖安全 `【隔離 Mock 測試】`

### 未設定 `COMFY_OUTPUT_DIR`

`http_tests.py 58113` → 19/19 PASS：

- `/open-output` → 409 `OUTPUT_DIR_UNSET`；`/api/delete` → 409 `OUTPUT_DIR_UNSET`。
- `/api/check` 仍正常（`comfy:true`），基本瀏覽/生成不受影響。
- 沒有猜測或讀取任何開發者輸出路徑。

### 設定隔離輸出目錄

在 `<base>\test_output` 放入本次產生的測試圖（SHA-256 `903136bb774f88751180d680e527ace23b8ca7c34444b35d4656ce76120c4961`），`http_tests.py 58113 <out>` → 24/24 PASS：

- `/api/status` 回報該路徑、`output_ok:true`、`output_error:""`。
- `/open-output` 回 200 且 `output` 為該路徑。
- `POST /api/delete` 對內容相符的測試圖回 200 `deleted / recycled:true`，檔案從測試目錄消失。
- 本機找不到對應檔時回 `already_gone`（**不是**假裝成功後移除歷史）；subfolder 不一致回 409 `PATH_MISMATCH`；`type=temp` 回 400 `TYPE_NOT_ALLOWED`。
- 完全沒有操作正式輸出圖片或正式回收筒。

---

## 6. 測試 D：Phase 3R1-R 修正回歸

### D1 暫存目錄安全（10/10）

`COMFY_OUTPUT_DIR` 與 `DATA_DIR` 相同、位於其下、或其祖先 → 拒絕；預設與自訂路徑都經過 realpath + Repo / output / 磁碟根雙向檢查；含 `..` 的路徑正規化後正確比對；正常預設與自訂路徑接受。詳細結果見第 3 節 static_tests 的 D1 段落。

### D2 暫存清理（6/6）

只刪「本程式命名格式 + 過期」的檔案；新檔、其他名稱、`nested/` 子目錄都不動；`os.remove` / `os.listdir` 失敗皆被吸收不影響主服務。Windows symlink 建立權限不足，`os.symlink` 情境**未執行**，改以 `realpath` + `dirname` 邊界檢查覆蓋（見第 9 節）。

### D3 日誌故障（30/30）

`MOCK` 方式模擬 `makedirs` 失敗、stdout log 失敗、stderr log 失敗、兩者皆失敗、Popen 本身失敗、正常日誌：

- 所有情境 Popen 都被呼叫，argv 完全等於 `COMFY_LAUNCH`。
- 失敗串流使用 `subprocess.DEVNULL`；成功開啟的 handle 在 finally 全部關閉。
- Popen 失敗仍回 `START_FAILED`；其他情境仍 `ok=True`。
- 沒有真正啟動 ComfyUI。

---

## 7. 測試 E：文件與硬編碼路徑盤點 `【靜態檢查】`

README（公開 Clone 版本，`static_tests.py` E 段）：

- 無 `C:\ComfyUI`、無 `D:\ComfyUI_output`、無要求讀取 `AGENTS.md`。
- 明確說明 Windows / Python 3.10+、標準庫、不需 pip。
- `COMFY_URL`、`COMFY_OUTPUT_DIR`、`COMFY_LAUNCH_CMD` 皆有清楚的預設值與範例。
- WD14 標為選用；未設定時不啟動 Worker、不影響基本生圖；一般使用者不需裝任何 `WD14_*`。
- 桌面控制台明確標為開發者工具，不是一般使用者步驟。

全 Repo 關鍵字搜尋分類：

| 分類 | 檔案 | 處理 |
|---|---|---|
| 一般執行路徑 | `server.py`, `app.js`, `README.md`, `index.html`, 其他前端檔 | **零命中** |
| 開發者工具 | `ui_control.ps1`, `ui_panel.pyw` | 保留，不在本次範圍 |
| 測試程式 / 文件或歷史報告 | `devtools/wd14_*_test.py`, `devtools/README.md`, `devtools/reports/tag-learning-phase1.md` | 保留，未修改 |

---

## 8. 回歸檢查 `【實際執行】`

在乾淨 Clone 內：

```
python -m py_compile server.py          -> exit 0
node --check app.js                     -> exit 0
node --check tags.js                    -> exit 0
node --check dict.js                    -> exit 0
node --check tag_categories.js          -> exit 0
git -C C:\ComfyUI\simple_ui diff --check -> exit 0
```

Phase 2B-3 / 2C / 3R1 / 3R1-R 的等價情境以隔離測試重現（purge、argv、WS、輸出目錄、README/Port、WD14 未設定、日誌故障），未直接執行硬編碼正式路徑的既有 devtools 腳本。

---

## 9. 未執行測試及原因 `【未執行】`

| 項目 | 原因 |
|---|---|
| 真實 ComfyUI / GPU 生圖、真實 WD14 推論 | 環境保護禁止；以 Mock 覆蓋 API 契約 |
| 正式 Worker 或 developer portable | 明確禁止使用 |
| Windows symlink 逃逸的實際建立 | 本機帳號無 symlink 權限；保留 realpath 邊界測試 |
| LAN / 遠端 ComfyUI | 本專案第一版只支援同機 loopback |
| 1000×700 以外多解析度量測 | 非本次部署可行性核心；小視窗下頁面可垂直捲動的既有觀察仍存在 |
| 既有 devtools 硬編碼正式路徑測試 | 直接執行會違反環境保護；已以隔離等價測試覆蓋，未刪除原檔 |

---

## 10. 發現的問題、嚴重性及建議

1. **[測試腳本，低]** 三處測試预期/顯示错误：README 字串比對用錯子字串、`system_stats` 標寫死、echo/fail 模式印出不適用的 FAIL 行。全部為本次臨時 harness 問題，已修正並重跑通過，**正式程式沒有問題**。
2. **[既有設計，低]** `ui_control.ps1` / `ui_panel.pyw` 與 `devtools/wd14_*_test.py` 仍含開發者絕對路徑；一般使用者流程完全不碰，建議未來在 `devtools/README.md` 更明顯標示「僅開發者環境」。
3. **[既有觀察，低]** 1000×700 小視窗下頁面垂直可捲（`scrollHeight=1444`），與「一屏不捲動」設計約束在該視窗不符；不影響部署，建議於典型 1920×1080 再量測。
4. **[未驗證]** 真實 ComfyUI 的 WebSocket 首幀時序；Mock 已覆蓋同 chunk 與分段兩種極端情況。

**沒有發現阻斷性部署問題。**

---

## 11. 正式服務是否受到影響 `【實際執行】`

- 正式 ComfyUI / simple_ui / WD14 Worker：未停止、未重啟、未修改。
- 7860 / 8188：全程無 Listen；正式環境變數、模型、Workflow、圖片、venv、依賴未更動。
- 正式 Repo 程式碼：未修改；既有十份報告完整保留。
- developer snapshot 前後 IDENTICAL；沒有新啟動的 developer 程序。

---

## 12. 測試程序、Port、Clone、Mock 清理狀態 `【實際執行】`

- 程序：simple_ui 測試實例 PID 632 / 7340 與 Mock PID 16260 / 1248，皆先核對完整 CommandLine 再終止，最後確認 `alive=False`。
- 瀏覽器：2 個測試分頁皆關閉（其中 1 個用於 B2）。
- Port：58111 / 58112 / 58113 / 54089 Listen 數皆 0。
- 暫存 Clone、Mock 腳本、測試圖片、測試輸出目錄、snapshot 與 log：全部隨 `<base>` 移除，`Test-Path=False`。
- 歸屬不明檔案/程序：未清理任何。

---

## 13. Git Branch、HEAD、Remote、工作區狀態 `【實際執行】`

```
## main...origin/main
?? devtools/reports/open-source-readiness-phase1.md
?? devtools/reports/open-source-readiness-phase2a.md
?? devtools/reports/open-source-readiness-phase2b1.md
?? devtools/reports/open-source-readiness-phase2b2.md
?? devtools/reports/open-source-readiness-phase2b3.md
?? devtools/reports/open-source-readiness-phase2c-implementation.md
?? devtools/reports/open-source-readiness-phase2c.md
?? devtools/reports/open-source-readiness-phase3.md
?? devtools/reports/open-source-readiness-phase3r1.md
?? devtools/reports/open-source-readiness-phase3r1r.md
?? devtools/reports/open-source-readiness-phase3r1v.md
```

- Branch：`main`；HEAD：`d7e3fe7c62fa222953239b3d6626c4b77ca364af`；Remote 不變；`origin/main` 同 HEAD。
- Staged：空；無 commit / push。
- 本次唯一新增檔案為本報告；正式 Repo 的 tracked 程式碼維持乾淨。

---

完成後停止，等待 ChatGPT 直接讀取報告、程式碼及測試結果進行獨立審查。
