# Phase B1 Review R2 — WMI 候選與身分驗證修正報告

> 本輪只修正 ChatGPT 獨立審查 R1 指出的兩個明確問題，沒有擴大架構、沒有新增功能、
> 沒有開始 B2。沒有覆蓋既有報告，沒有修改 `server.py`／前端／ComfyUI 上游／模型目錄。

標記：【本機驗證】／【隔離測試】／【未驗證】

---

## 1. 起始 Repository / Branch / HEAD / Remote / Git 狀態

| 項目 | 值 |
|---|---|
| 設備 | `DESKTOP-ADPHHAP`（Online） |
| Repository | `C:/ComfyUI/simple_ui` |
| Branch | `main...origin/main [ahead 1]` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| ahead/behind | `1/0` |
| tracked modified | **12** |
| untracked | **37** |
| staged | 0 |
| `git diff --check` | 無輸出 |

已重新閱讀 `C:\ComfyUI\AGENTS.md`、`C:\ComfyUI\simple_ui\AGENTS.md` 及相關規範。
`codegraph status`：35 files / 1,094 nodes / 4,837 edges；Pending Changes: Added 4, Modified 2
（新模組與測試尚未進索引，依指引未 sync）。
7860／8188 無監聽、無 Python 行程；全程維持關閉，所有既有修改與未追蹤檔案完整保留。

---

## 2. R1 問題及修正方式

### R2-1：WMI 不得因 CommandLine 不可讀而漏掉 Python 行程

**原問題**：`_WMI_PS` 使用 `Where-Object { $_.Name -match '...' -and $_.CommandLine }`，
在候選分析前就排除 CommandLine 為空／null／不可讀的 Python 行程，可能低估候選數量而誤判唯一性。

**修正**：
- WMI 查詢改為 `Where-Object { $_.Name -match '^python(w)?\\.exe$' }`，只按行程名稱列出，**不再過濾 CommandLine**。
- 候選分析中，`CommandLine` 不是非空字串（缺失、null、空字串、非字串）→ 歸入 `unknown`，
  **不得視為非 ComfyUI 排除**；只要有任一未知候選即回 `C / UNKNOWN_CANDIDATE`（fail closed）。
- 只有明確可讀、且明確判定為 `simple_ui\server.py` 的 CommandLine 才會被排除；
  明確可讀但不含 `main.py` 才視為非 ComfyUI。
- 多個已知候選仍回 `C / MULTIPLE_CANDIDATES`，不挑「讀得成功的那一個」。

### R2-2：WMI ExecutablePath 必須強制驗證

**原問題**：`same_wmi_exe = (not wmi_exe or ...)` 讓空 ExecutablePath 直接被當成相符。

**修正**：
- 新增 `valid_executable_path(value)`：必須是非空字串、`os.path.isabs()`、長度上限內、
  無 `..` 元件、basename 非空的絕對路徑。
- 第一次 WMI snapshot：驗證 `ExecutablePath`，無效 → `C / EXECUTABLE_PATH_INVALID`。
- 與 PEB `ImagePathName` 比較時不再有「空值即放行」的捷徑；不一致 → `C / IDENTITY_MISMATCH`。
- 第二次 WMI snapshot（`confirm_process_identity` 的結果）：同樣先驗證 `ExecutablePath`，
  無效 → `C / EXECUTABLE_PATH_INVALID`；再比對前後 snapshot 與 PEB 三者是否一致。
- `same_process_identity(before, after, image)` 已移除空值相等放行的路徑。

### 明確 PID 路徑

`pid=` 參數仍建立只有 `ProcessId` 的候選，因此沒有 CommandLine／ExecutablePath，
依 R2-1 會被歸為未知候選 → `C / UNKNOWN_CANDIDATE`，**不會繞過身分驗證**。新增測試覆蓋。

---

## 3. 實際修改檔案

| 檔案 | 動作 |
|---|---|
| `comfy_lora_paths.py` | WMI 查詢移除 CommandLine 過濾；新增 `valid_executable_path()`；兩次 snapshot 強制驗證；未知候選 fail closed |
| `devtools/comfy_lora_paths_test.py` | 新增 `TestR2WmiHardening`（11 件） |
| `devtools/reports/lora-personal-api-key-phase-b-implementation-spec.md` | §4.1 與 §14 補 R2 決策說明 |

未修改其他任何檔案；未建立或刪除既有報告。

---

## 4. 新增測試及結果

新增 `TestR2WmiHardening` 11 件，連同既有共 **44 tests，全部 OK**：

1. WMI 查詢不再含 `and $_.CommandLine`，仍按 python 行程名稱筛选。
2. `CommandLine` 欄位缺失 → `C / UNKNOWN_CANDIDATE`。
3. `CommandLine=None` → `C / UNKNOWN_CANDIDATE`。
4. 第二候選 `CommandLine=""` 不會被當成非 ComfyUI 而隱藏 → `C / UNKNOWN_CANDIDATE`。
5. 第一次 snapshot `ExecutablePath` 缺失 → `C / EXECUTABLE_PATH_INVALID`。
6. 第一次 snapshot `ExecutablePath=""` → `C / EXECUTABLE_PATH_INVALID`。
7. 第二次 snapshot `ExecutablePath` 缺失 → `C / EXECUTABLE_PATH_INVALID`。
8. 第二次 snapshot `ExecutablePath="   "` → `C / EXECUTABLE_PATH_INVALID`。
9. `ExecutablePath` 與 PEB `ImagePathName` 不一致 → `C / IDENTITY_MISMATCH`。
10. 明確 PID 路径 → `C / UNKNOWN_CANDIDATE`（不繞過）。
11. `valid_executable_path()` 正反例（None／空／相對／`..`／非字串 皆拒絕）。

其他驗收：
- `python -m py_compile server.py comfy_lora_paths.py devtools/comfy_lora_paths_test.py` → exit 0
- `node --check app.js` → exit 0
- `python devtools/lora_personal_key_test.py` → 12 passed
- `python devtools/lora_explorer_api_test.py` → 35 passed
- `node devtools/lora_explorer_core_test.mjs` → 21 passed
- `python comfy_lora_paths.py`（本機無 live process）→ `C / NO_COMFY_PROCESS`，`usable=false`
- `git diff --check` → 無輸出

所有測試使用 mock process／mock WMI／mock PEB／temp 目錄；**不是 live ComfyUI 驗證**。

---

## 5. 未執行測試及原因

| 未執行 | 原因 |
|---|---|
| live ComfyUI PID 上的 WMI／PEB 交叉驗證 | 服務由使用者關閉，禁止重啟；無 PID |
| `/internal/folder_paths` live 驗證 | 無 live 服務，且尚未經 ChatGPT 批准 |
| GPU／服務整合、瀏覽器實測 | 明確禁止；本輪無 UI 改動 |
| Civitai API／真實 Key／下载 | B1 範圍外且明確禁止 |
| `codegraph sync` | 衍生索引，依指引不更新 |

---

## 6. 最終 Git 狀態

- Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、Remote `origin`、ahead/behind `1/0`。
- tracked modified **12**（不變）；untracked **38**（37 + 本報告）；staged 0。
- `git diff --check` 無輸出。
- 未執行 add／commit／push／reset／clean／stash／checkout。

---

## 7. 服務是否受到影響

**沒有。** 7860／8188 開始與結束都未監聽、無 Python 行程；
沒有啟動、停止或重啟 ComfyUI／simple_ui／WD14；沒有修改設定、模型目錄或使用者資料。
兩件「真實原始碼子程序」測試只 import `folder_paths`，不綁 port、不碰 GPU。

---

## 8. 尚存風險

1. 【未驗證】R2 的 WMI 行為未在 live Python 行程上實測（本機無行程）；所有結論來自隔離測試。
2. 【未驗證】CommandLine 不可讀的行程一律 fail closed，可能讓資訊不完整的環境完全無法使用解析器；這是刻意的安全取捨。
3. 【未驗證】ExecutablePath 只做語法驗證（絕對路徑／無 `..`），未檢查檔案是否仍存在；若執行檔啟動後被刪仍會被當成有效。
4. A 級仍永久停用；`/internal/folder_paths` 的相容性風險未解決（見 R1 報告）。
5. 候選唯一性以外的 live 路徑證明問題未變，B2 仍不具備進入條件。

---

## 9. 是否仍維持 B / LIVE_UNVERIFIED、usable=false

**是。** 本輪沒有放寬任何 A 級條件，`_result()` 仍只在 `grade == "A"` 時設 `usable=true`，
而沒有任何程式路徑會回 `A`：

- 隔離 mock 重建成功 → `B / LIVE_UNVERIFIED`、`usable=false`、`loras` 僅供唯讀顯示；
- 本機現況（無 live process）→ `C / NO_COMFY_PROCESS`、`usable=false`；
- R2 新增的不確定情況 → `C / UNKNOWN_CANDIDATE` 或 `C / EXECUTABLE_PATH_INVALID`、`usable=false`。

完整 argv、絕對路徑、環境值仍不進 `evidence`；既有遮罩機制未變動。

---

## 10. 完成陳述

R2 完成並立即停止。只修正 R2-1／R2-2，未開始 B2，未 commit／push。
等待 ChatGPT 再次獨立審查。
