# 修復：本機 WD14 啟動配置 + 圖片輸出資料夾三項問題

## 0. 結論

- **修復 A（WD14 本機啟動配置）已完成**：`ui_control.ps1` 在啟動 `server.py` 前短暫注入四個 WD14 環境變數，啟動後在 `finally` 還原；本機 WD14 資源存在時完整配置 EVA02 與 ViT v3，缺少時明確警告但仍啟動基本生圖。
- **修復 B（輸出資料夾三項問題）已完成**：B1 環境變數無效不再回退舊設定；B2 三種來源（環境變數 / UI API / 保存檔）共用同一套安全驗證；B3 保存失敗如實回報 `persisted:false`，不再假裝永久成功。
- 全程**未停止、未重啟任何正式程序**，未執行真實模型推論或生圖，未 commit / push / stage / reset / restore / stash / checkout / clean。
- 測試結果：Python 隔離測試 **28 PASS / 0 FAIL**；PowerShell 隔離測試在 **PS 7.7.0** 與 **Windows PowerShell 5.1.22621.6133** 各 **11 PASS / 0 FAIL**。

結果分類：`【實際執行】`、`【隔離測試】`、`【靜態檢查】`、`【未執行】`。

---

## 1. 任務目標及根因

### 1.1 開始前檢查 `【實際執行】`

| 項目 | 值 |
|---|---|
| Repo | `C:\ComfyUI\simple_ui`（本專案唯一 repo） |
| Branch | `main` |
| HEAD | `e063f8f52e7215e8c6d3601dd6d3fa070e1c483f` |
| Remote | `origin` → `https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| `HEAD...origin/main` | `0  0` |
| 起始 Staged | 空 |
| 起始 Modified | `AGENTS.md`、`README.md`、`app.js`、`index.html`、`server.py`（皆為使用者既有未提交工作，**完整保留**） |
| 起始 Untracked | 13 份 `devtools/reports/*.md`（既有報告，**未更動**） |
| 正式服務 | 7860 → PID 7244（simple_ui）；8188 → PID 14652（ComfyUI）；**只讀查詢，未操作** |

已閱讀：`C:\ComfyUI\AGENTS.md`、`simple_ui\AGENTS.md`、`devtools\reports\open-source-readiness-phase3r1.md`、`server.py` 的 WD14 與輸出資料夾區段、`ui_control.ps1` 完整啟動流程，以及工作區中圖片輸出資料夾功能的完整 diff。

本機 WD14 外部資源全部存在（只讀 `Test-Path`）：`wd14-venv\Scripts\python.exe`、`wd14_worker.py`、`wd14_core.py`、`wd14-vit-eval\venv\Scripts\python.exe`、`wd14_vit_worker.py`、`tools\models\wd14`。

### 1.2 根因

| 編號 | 根因 |
|---|---|
| A | 公開版開源化時把 `server.py` 的 WD14 路徑改成空字串（正確方向），但本機啟動器 `ui_control.ps1::Start-Ui()` 啟動 Server 子程序時**沒有注入本機環境變數**，导致 `/api/reverse` 回 `503 WD14_NOT_CONFIGURED`。 |
| B1 | `OUTPUT_DIR` 由 `COMFY_OUTPUT_DIR` 解析；當環境變數「有明確設定但無效」時 `OUTPUT_DIR` 變成 `None`，接著 `if not OUTPUT_DIR:` 仍讀取 `output_dir.txt` 舊設定並覆蓋錯誤狀態。 |
| B2 | `_output_dir_conflicts()` 只套用於 UI API 與保存檔；啟動環境變數路徑完全沒經過該檢查（磁碟根 / Repo / WD14 暫存目錄皆可能漏網）。 |
| B3 | `set_output_dir()` 的 `except OSError: pass` 吞掉寫入失敗，API 一律回 200 `ok:true`，前端顯示「已設定」，重啟後設定遺失。 |

---

## 2. 修改、新增檔案清單

| 檔案 | 變更 | 目的 |
|---|---|---|
| `ui_control.ps1` | 修改（+65 / -10 行） | 修復 A：本機 WD14 環境注入、存在性檢查、`finally` 還原、結果訊息 |
| `server.py` | 修改（在使用者既有 diff 上追加） | 修復 B1 / B2 / B3：來源驗證統一、無效不回退、保存失敗如實回報 |
| `app.js` | 修改（在使用者既有 diff 上追加） | 修復 B3 前端：`persisted:false` 時不顯示永久保存成功，保留提示讓使用者看到 |
| `AGENTS.md` | 修改（在使用者既有 diff 上微調） | 同步輸出資料夾來源 / 保存失敗語意的文件描述 |
| `README.md` | 修改（在使用者既有 diff 上微調） | 同步白話說明：環境變數無效不回退、保存失敗會告知 |
| `devtools/test_output_dir_config.py` | 新增 | B1 / B2 / B3 隔離測試（28 項） |
| `devtools/test_ui_control_wd14.ps1` | 新增 | WD14 啟動器隔離測試（11 項，PS 5.1 / 7 相容） |
| `devtools/reports/fix-local-wd14-and-output-directory.md` | 新增 | 本報告 |

**未修改**：`index.html`、`tags.js`、`dict.js`、`tag_categories.js`、`tools/` 下任何 Worker / 模型 / venv、ComfyUI Workflow、正式輸出圖片、既有 13 份報告。

---

## 3. 修復 A：WD14 本機啟動配置

### 3.1 注入方式

在 `ui_control.ps1` 新增 `$script:LocalWd14`（四個本機絕對路徑）、三個函式：

- `Test-LocalWd14Ready`：逐一 `Test-Path -LiteralPath ... -PathType Leaf`，回傳缺少的「變數名 (完整路徑)」。
- `Set-LocalWd14Env`：先用 `[System.Environment]::GetEnvironmentVariable($name, 'Process')` 存快照（含「本來是否設定」），再用 `[System.Environment]::SetEnvironmentVariable(..., 'Process')` 寫入目前 PowerShell Process 環境。
- `Restore-LocalWd14Env`：在 `finally` 還原。原本有值就寫回原值；原本未設定用 `Remove-Item Env:<NAME>` **真正移除**（實測 `SetEnvironmentVariable($name, $null, 'Process')` 只會變成空字串，子程序仍看到空值，故未採用）。

`Start-Ui()` 只在**確實要啟動 `server.py` 子程序時**（`if (-not (Test-PortUp 7860))` 內）注入，緊接 `Start-Process` 後立即在 `finally` 還原；ComfyUI 啟動步驟在注入之前，不會繼承 WD14 變數。

四個變數值（僅存在於本機啟動器，**未寫入公開版 `server.py`**）：

| 環境變數 | 值 |
|---|---|
| `WD14_PY` | `C:\ComfyUI\tools\wd14-venv\Scripts\python.exe` |
| `WD14_WORKER` | `C:\ComfyUI\tools\wd14_worker.py` |
| `WD14_VIT_PY` | `C:\ComfyUI\tools\wd14-vit-eval\venv\Scripts\python.exe` |
| `WD14_VIT_WORKER` | `C:\ComfyUI\tools\wd14_vit_worker.py` |

`WD14_TMP` 未注入，仍用 `server.py` 的 `%LOCALAPPDATA%\SidSimpleUI\wd14-tmp` 預設。

### 3.2 相容性與安全

- **PS 5.1 / PS 7**：只用 `[ordered]@{}`、`[pscustomobject]`、`Test-Path -PathType Leaf`、`[System.Environment]`、`Remove-Item Env:`、`try/finally`，兩版皆可解析；實測兩版皆 11/11 通過。
- **不設永久變數**：只操作 `'Process'` scope，沒有 User / Machine target。
- **不污染其他程式**：注入與還原包住單一 `Start-Process`，且 `finally` 保證還原；父 PowerShell 工作階段原有值（含「未設定」）完全恢復。
- **缺少資源不靜默**：`Wd14` 欄位與 `Message` 會明確列出缺少的變數與路徑，並說明「反推功能無法使用；基本生圖不受影響。若要啟用，請確認上述檔案存在。」；仍照常啟動基本服務。
- **公開情境不變**：`server.py` 未設定 WD14 時仍回 `503 WD14_NOT_CONFIGURED`，沒有開發者路徑搜尋；Worker JSON Lines 協定、`request_id`、生命週期、`CPUExecutionProvider` 均未更動。

---

## 4. 修復 B：圖片輸出資料夾三項問題

### B1：無效環境變數不 fallback `【實際執行】`

- 新增 `_OUTPUT_ENV_RAW` / `_OUTPUT_ENV_EXPLICIT`：
  - 未設定或空字串（含全空白）→ 視為未設定，允許讀取 `output_dir.txt`。
  - 有明確內容 → 由 `_parse_output_dir()` 驗證；有效就使用，無效就**保留錯誤狀態**，不再讀保存檔。
- 錯誤訊息加入白話下一步：「請修正或移除這個環境變數後重新啟動生圖介面；基本生圖不受影響。」
- 基本生圖不依賴 `OUTPUT_DIR`，因此此錯誤只停用刪圖 / 開資料夾。

### B2：所有來源一致安全驗證 `【實際執行】`

- 新增共用 `_validate_output_dir(raw)` = `_parse_output_dir()` + `_output_dir_conflicts()`。
- 套用來源：`COMFY_OUTPUT_DIR`（啟動時再驗證一次）、`POST /api/output-dir`（`set_output_dir()`）、`output_dir.txt`（保存設定）。
- 保留並驗證的邊界：磁碟機根目錄、Repo 本身與內部目錄、WD14 暫存目錄（含「WD14_TMP 本身因衝突被判無效時，仍以使用者指定的原始路徑阻擋輸出資料夾重疊」的新增防護）、既有 realpath / 絕對路徑 / 存在 / 可讀寫檢查。
- 保存檔衝突時也明確回報原因並指向右欄「輸出設定」，不再只顯示「尚未設定」。
- 完全沒有放寬路徑邊界、刪圖安全检查或正規化。

### B3：保存失敗不假裝成功 `【實際執行】`

- `set_output_dir()` 回傳值由 `(ok, error)` 改為 `(ok, error, persisted)`：
  - `ok=True` 代表本次已即時套用（即使保存失敗）。
  - `persisted=False` + 白話 `error` 代表無法永久保存。
  - 驗證失敗時**完全不更動**目前的 `OUTPUT_DIR`，避免破壞有效路徑。
- `_persist_output_dir()` 不再 `except OSError: pass`，改回傳可讀原因（含目標檔案路徑）。
- API `POST /api/output-dir`：
  - 成功（舊格式相容）：`200 {ok:true, output:"...", persisted:true}`。
  - 保存失敗：`200 {ok:true, output:"...", persisted:false, code:"OUTPUT_NOT_PERSISTED", warning:"已即時生效，但無法永久保存…重新啟動後可能失效…"}`。保留既有 `ok` / `output` 欄位，新增欄位對舊呼叫端無害。
- 前端 `openOutputDirModal()`：`j.persisted === false` 時**不關閉視窗**、顯示 `warning` 與黃色 toast「已即時生效，但無法永久保存（重啟後可能失效）」；只有 `persisted !== false`（含舊後端沒有此欄位）才顯示「已設定並保存」。

---

## 5. 測試項目、實際指令及結果

### 5.1 輸出資料夾隔離測試 `【實際執行】`

指令：

```powershell
cd C:\ComfyUI\simple_ui
$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8
python devtools\test_output_dir_config.py
```

結果：**28 PASS / 0 FAIL，exit 0**。涵蓋：

1. 未設定環境變數 → 讀取保存設定 ✅
2. 空字串 → 視為未設定，仍讀保存設定 ✅
3. 環境變數有效 → 優先 ✅
4. 環境變數無效 → 不回退 + 下一步訊息 ✅
5. 磁碟根 / Repo / Repo 內部 / WD14 暫存衝突 → 全部拒絕 ✅
6. 保存檔指向 Repo → 同樣拒絕 ✅
7. UI API 與環境變數共用同一驗證函式 ✅
8. 保存成功 → API 200 / persisted:true / 檔案內容正確 ✅
9. 模擬寫入失敗 → ok:true、persisted:false、OUTPUT_NOT_PERSISTED、白話 warning ✅
10. 保存失敗後 OUTPUT_DIR 未清空；再設無效路徑仍保留原有效路徑 ✅
11. 同源檢查（X-SimpleUI / Origin）仍回 403 ✅
12. 刪圖仍保留 realpath + commonpath 邊界、SHA-256 內容比對、`type=output` 限制 ✅

手法：_temp 目錄 + 隔離 `LOCALAPPDATA` + `importlib` 重新載入 `server.py` + Mock handler；未連接正式服務、未讀寫正式輸出資料。

### 5.2 WD14 啟動器隔離測試 `【實際執行】`

指令（兩版各跑一次）：

```powershell
cd C:\ComfyUI\simple_ui
$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8
pwsh -NoProfile -File devtools\test_ui_control_wd14.ps1
powershell.exe -NoProfile -File devtools\test_ui_control_wd14.ps1
```

結果：

| 環境 | 結果 |
|---|---|
| PowerShell 7.7.0 | **11 PASS / 0 FAIL，exit 0** |
| Windows PowerShell 5.1.22621.6133 | **11 PASS / 0 FAIL，exit 0** |

手法：在 temp 中複製 `ui_control.ps1`，只替換四個 WD14 路徑、Python / ServerScript / Logs 路徑與等待秒數；dot-source 後覆寫 `Test-PortUp`，以 mock server.py 把子程序收到的環境變數寫成 JSON。正式 ComfyUI / simple_ui / WD14 Worker 完全未被啟動或停止。

涵蓋：

1. 四個環境變數正確傳遞給 server.py 子程序 ✅
2. 父 Process 原有值還原 ✅
3. 原本未設定的變數仍為未設定（真正移除，非空字串）✅
4. 缺少路徑時明確白話錯誤、不注入、仍啟動基本服務 ✅
5. PS 5.1 與 PS 7 語法 / 行為相容 ✅
6. 公開版 `server.py` 不含開發者路徑，仍保留 `WD14_NOT_CONFIGURED` ✅

### 5.3 WD14 完整設定驗證（隔離、不啟動 Worker）`【實際執行】`

以隔離 `LOCALAPPDATA` + 四個真實本機路徑載入 `server.py`，檢查 `wd14_missing_config('eva02')` 與 `wd14_missing_config('vit')` 皆回空字串、`WD14_TMP` 使用隔離預設且無錯誤。結果：**PASS**（兩套模型皆完整設定，未啟動任何 Worker）。

### 5.4 只讀狀態與語法檢查 `【實際執行】`

| 項目 | 指令 | 結果 |
|---|---|---|
| 語法 | `python -m py_compile server.py` | exit 0 |
| 語法 | `node --check app.js` / `tags.js` / `dict.js` / `tag_categories.js` | 全部 exit 0 |
| 測試語法 | `python -m py_compile devtools/test_output_dir_config.py` | exit 0 |
| Diff | `git diff --check` | exit 0（僅 `ui_control.ps1` 的 LF→CRLF 自動正規化警告，非錯誤） |
| 啟動器只讀 | `pwsh -NoProfile -File ui_control.ps1 -Action status`<br>`powershell.exe -NoProfile -File ui_control.ps1 -Action status` | 兩版皆 `{"Comfy":true,"UI":true,"ServerCount":1,"ComfyCount":1}` |

### 5.5 基本生圖初始化回歸 `【靜態檢查】`

- `server.py` 的 `main()`、`/comfy/*` 代理、`/ws` 隧道、`/api/check`、`/api/delete`、`/api/reverse` 路由與固定 Workflow 未更動。
- 新增的全域變數與函式皆在模組載入期完成，不啟動 Thread / Process；測試中已實際 `exec_module` 多次成功。
- `WD14 = Wd14Worker()` / `WD14_VIT = Wd14Worker(...)` 的建構與 `request_id` / `ready` / `success` 協定未更動。

---

## 6. 未執行的測試與原因 `【未執行】`

| 項目 | 原因 |
|---|---|
| 真實 EVA02 精準模式反推 | 需使用正式模型 / CPU 資源；本任務禁止真實推論，留待使用者授權 |
| 真實 ViT v3 快速模式反推 | 同上 |
| 瀏覽器實測新 API / 前端提示 | 正式 7860 仍運行修改前的 `server.py`；重啟正式服務被明確禁止，故未連正式服務驗證新程式碼 |
| 真實生圖 / 真實刪圖 | 正式環境保護禁止；只以 Mock 與靜態檢查覆蓋 |
| 大量反推 / Benchmark | 明確禁止 |

上述項目**不可視為通過**。

---

## 7. Git Branch、HEAD、工作區狀態 `【實際執行】`

```
## main...origin/main
 M AGENTS.md
 M README.md
 M app.js
 M index.html
 M server.py
 M ui_control.ps1
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
?? devtools/reports/open-source-readiness-phase3r1vr.md
?? devtools/reports/readme-agents-documentation.md
?? devtools/test_output_dir_config.py
?? devtools/test_ui_control_wd14.ps1
?? devtools/reports/fix-local-wd14-and-output-directory.md
```

- Branch `main`、HEAD `e063f8f52e7215e8c6d3601dd6d3fa070e1c483f`、`origin/main` 同步（`0 0`）。
- Staged：空。未執行任何 Git 寫入操作。
- 使用者原有的 5 個 modified 檔案與 13 份未追蹤報告全部保留；只在其中 4 個檔案上做相符於本任務的目標修改。

---

## 8. 正式服務是否受到影響

| 項目 | 狀態 |
|---|---|
| ComfyUI（8188, PID 14652） | **未**停止 / 重啟 / 修改 |
| simple_ui（7860, PID 7244） | **未**停止 / 重啟 / 修改 |
| WD14 Worker | **未**啟動、**未**停止；測試只用 mock / 隔離模組 |
| 永久環境變數 | 未設定 User / Machine scope |
| 模型 / venv / `C:\ComfyUI\tools\` | 未寫入、未安裝、未更新 |
| 正式圖片 / 輸出資料夾 | 未讀寫、未刪除、未搬移 |
| Workflow / 生成參數 | 未更動 |

前後只讀比對：7860 → PID 7244、8188 → PID 14652，`ServerCount=1`、`ComfyCount=1`，與開始前一致。

---

## 9. 尚未解決的問題及風險

1. **正式 7860 仍運行修改前的程式碼**：本次禁止重啟，因此新的 `/api/output-dir` 與 WD14 注入要等下次由桌面控制台正常重新啟動才會生效。
2. **`COMFY_OUTPUT_DIR` 仍存在時用 UI 設定新路徑**：本次執行會即時生效，但下次重啟環境變數仍優先；B1 的錯誤訊息已明確指示「修正或移除這個環境變數後重新啟動」。
3. **`persisted:false` 語意**：回應仍為 HTTP 200 + `ok:true`（本次已生效），以新增欄位表示未永久保存；不檢查新欄位的舊呼叫端會看到成功，但不會因新欄位而出錯。前端已正確區分。
4. **`ui_control.ps1` 仍含開發者絕對路徑**：依任務需求刻意保留（它本來就是本機開發者工具，已含 ComfyUI 安裝路徑）；公開版 `server.py` / 文件沒有這些路徑。
5. `git diff --check` 對 `ui_control.ps1` 的 LF→CRLF 警告為 Windows `core.autocrlf` 正規化行為，不影響執行；檔案保持 UTF-8 BOM，PS 5.1 可正確讀取中文。

---

## 10. 尚待使用者授權的真實 WD14 測試項目

1. **EVA02 精準模式反推**：重啟正式 simple_ui（讓新的環境注入生效）後，以一張正式圖片測試 `/api/reverse` 的 EVA02 模式，確認回傳 `model=rating/general/character/timing`、CPU 使用率與 Worker 生命週期正常。
2. **ViT v3 快速模式反推**：同一環境以 `model:"vit"` 測試，確認走 `wd14_vit_worker.py` 且沒有誤用 EVA02 Worker。

兩項皆須使用者明確授權「可重啟正式服務」與「可執行真實推論」後才安排；本次未執行，亦未宣稱通過。

---

完成後停止，不進行其他重構、不 Commit / Push。

---

## 11. 補強驗收修正（並行保存競態 + WD14 啟動狀態誤報）

> 本節為後續獨立驗收修正，保留上方原有報告內容不變。

### 11.1 修復 1：`set_output_dir()` 並行保存競態 `【實際執行】`

**根因**：原程式碼在 `_OUTPUT_LOCK` 內更新 `OUTPUT_DIR` 後就釋放鎖，才到鎖外呼叫 `_persist_output_dir()`。`ThreadingMixIn` 下兩個請求可交錯：A 更新記憶體後卡在保存，B 更新記憶體並先把 B 寫入檔，A 再寫入 A，造成「記憶體=B、保存檔=A」。

**修改**（`server.py`）：把更新與保存放進同一個 `with _OUTPUT_LOCK:` 區塊：

```python
with _OUTPUT_LOCK:
    OUTPUT_DIR = real
    _OUTPUT_ERROR = ""
    err = _persist_output_dir(real)   # 不釋放鎖，序列化整個更新＋保存
    if err:
        return True, err, False
    return True, "", True
```

- 驗證失敗仍在鎖外提前回傳，`OUTPUT_DIR` 完全不變。
- 保存失敗仍保留本次即時生效的路徑，回 `ok=True` / `persisted=False` / 原白話錯誤。
- `_persist_output_dir()` 不取得 `_OUTPUT_LOCK`，`_set_output_dir()` 在函式回傳後才重新取鎖讀取 `OUTPUT_DIR`，無重入、無死鎖。
- API 回傳格式完全不變（仍為 3 欄位 `(ok, error, persisted)`，HTTP body 仍有 `ok` / `output` / `persisted` / 失敗時的 `code` / `warning`）。

**測試**（`devtools/test_output_dir_config.py` 新增 `[並行]` 章節，3 輪）：

- 兩個不同的有效暫存輸出目錄 A / B，兩個 Thread 同時呼叫 `set_output_dir()`。
- 用 `threading.Event` 安排 A 先進入保存並暫停、B 後進入，完全不靠 `sleep()` 猜測。
- 用 `TrackingLock` 記錄寫入當下是否仍持有 `_OUTPUT_LOCK`，並驗證最終 `OUTPUT_DIR` 與 `output_dir.txt` 皆為 B。
- 負向對照（把程式暫時改回「保存在鎖外」）：測試如預期 FAIL（`held=[False, False]`），證明測試確實能抓到原bug；對照只存在於測試程序記憶體，未寫回任何檔案。

結果：**3/3 輪 PASS**；原有 28 項全數無回歸，合計 **31 PASS / 0 FAIL**。

### 11.2 修復 2：`ui_control.ps1` WD14 狀態誤報 `【實際執行】`

**根因**：原 `Start-Ui()` 不論是否真的啟動新 Server 都先執行 `Test-LocalWd14Ready`；若四個本機檔案存在但 7860 已有既存 Server，就不會注入也不會重啟，卻仍回報「本機 WD14 已設定（EVA02 與 ViT v3 皆可用）」，無法證明運行中的 Server 已載入設定。

**修改**（`ui_control.ps1`）：先取 `$uiAlreadyUp = Test-PortUp 7860`，並以此決定 `$willLaunchUi`：

| 情境 | 行為 | `Wd14` 回報 |
|---|---|---|
| A：7860 沒有 Server，本次會啟動 | 檢查檔案 → 完整才注入 → `Start-Process` → `finally` 還原 | 「本機 WD14 已設定（EVA02 與 ViT v3 皆可用）。」或缺少資源的明確警告 |
| B：7860 已有既存 Server | 不重啟、不終止、不注入、不呼叫 `Start-Process` | 「生圖介面已在運行；本次沒有重新啟動，因此無法確認目前介面是否已載入 WD14 設定。若反推無法使用，需在適當時機重新啟動生圖介面。」 |

基本生圖判斷、`Stop-Ui`、`Restart-Ui` 與其他啟動流程不變；PS 5.1 / PS 7 語法相容維持。

**測試**（`devtools/test_ui_control_wd14.ps1` 新增 `[D]` 章節，5 項）：

- 四個 WD14 資源（假檔）皆存在，且以覆寫 `Test-PortUp` 模擬 7860 已在運行。
- dot-source 後覆寫 `Set-LocalWd14Env` / `Stop-Process` 做呼叫計數：注入 0 次、終止 0 次。
- mock server 未被啟動（標記檔不存在）→ 證明沒有呼叫 `Start-Process`。
- `Wd14` / `Message` 明確說「沒有重新啟動」「無法確認目前介面是否已載入 WD14」，且不再出現「本機 WD14 已設定」。
- 父 Process 環境變數保持原值（含本來未設定者）。
- 原有 `[A]` 注入＋還原、`[B]` 缺少路徑、`[C]` 公開情境測試全數無回歸。

結果：PS 7.7.0 **16 PASS / 0 FAIL**；Windows PowerShell 5.1.22621.6133 **16 PASS / 0 FAIL**。

### 11.3 補強後完整測試結果 `【實際執行】`

| 指令 | 結果 |
|---|---|
| `python devtools\test_output_dir_config.py` | **31 PASS / 0 FAIL**，exit 0（含 3 輪並行） |
| `pwsh -NoProfile -File devtools\test_ui_control_wd14.ps1` | **16 PASS / 0 FAIL**，exit 0 |
| `powershell.exe -NoProfile -File devtools\test_ui_control_wd14.ps1` | **16 PASS / 0 FAIL**，exit 0 |
| `python -m py_compile server.py` | exit 0 |
| `python -m py_compile devtools\test_output_dir_config.py` | exit 0 |
| `node --check app.js` / `tags.js` / `dict.js` / `tag_categories.js` | 全部 exit 0 |
| `git diff --check` | exit 0（`ui_control.ps1` 的 LF→CRLF 警告非錯誤） |

並行測試已連續執行多次（含正向 3 輪與一次負向對照），結果可重現。

### 11.4 補強後 Git / 服務狀態 `【實際執行】`

- Branch `main`、HEAD `e063f8f52e7215e8c6d3601dd6d3fa070e1c483f`、`HEAD...origin/main = 0 0`。
- Staged：空；未 commit / push / stage / reset / restore / stash / checkout / clean。
- 工作區與補強前相同：6 個 modified（含 `ui_control.ps1`）+ 既有未追蹤報告 + 2 個測試檔 + 本報告；沒有意外清理或提交。
- 正式服務只讀比對：7860 → PID 7244、8188 → PID 14652；**未停止、未重啟**。
- 未啟動任何真實 WD14 Worker、未執行模型推論、未生圖、未動模型 / venv / Workflow / 正式圖片。

### 11.5 補強後仍待授權項目

與第 10 節相同：真實 EVA02 精準模式反推、真實 ViT v3 快速模式反推，以及讓正式 7860 載入新程式碼所需的服務重啟，皆須使用者授權；本次未執行，不視為通過。

等待 ChatGPT 再次獨立驗收。
