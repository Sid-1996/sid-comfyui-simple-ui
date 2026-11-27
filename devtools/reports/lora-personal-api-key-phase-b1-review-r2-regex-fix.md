# Phase B1 R2 後續：WMI 行程名稱 Regex 小修正與測試補足

> 只做審查要求的 Regex 與測試修正，沒有更動其他架構、安全邏輯或服務。
> 本報告為新檔，沒有覆蓋 R2 報告；沒有 Git 寫入，沒有啟動任何服務。

---

## 1. 任務範圍

1. `_WMI_PS` 的行程名稱 Regex 改為直接或明確的 `\.` 寫法，消除跳脫層級歧義。
2. 測試不能只比對字串片段，必須驗證 Regex 真的能匹配 `python.exe`／`pythonw.exe` 並拒絕其他名稱。
3. 其他邏輯全部不動。

---

## 2. 修正前的實測發現（重要）

【本機驗證】我先直接讀取檔案位元組，再檢查執行期字串：

- 原始碼該行在 `python` 與 `exe` 之間有 **2 個**反斜線字元（不是審查訊息提到的 4 個）。
- Python 字串常值 `\\` 在執行期變成 **1 個**反斜線，因此 `_WMI_PS` 傳給 PowerShell 的 regex 已經是
  `^python(w)?\.exe$`。
- 用 PowerShell 實際套用該 regex 的結果：

| 名稱 | 結果 |
|---|---|
| `python.exe` | 匹配 |
| `pythonw.exe` | 匹配 |
| `PYTHON.EXE` | 匹配（`-match` 不分大小寫） |
| `python3.exe`、`cmd.exe`、`pythonXexe`、`python.exe.bak` | 不匹配 |

**結論：修正前後 PowerShell 收到的 regex 與行為相同，沒有發現「排除所有 Python 行程」的功能性錯誤。**
為避免跳脫寫法繼續造成誤判，仍依要求把 regex 抽出為 raw string 常數，並補上真正的行為測試。

---

## 3. 實際修改

| 檔案 | 修改 |
|---|---|
| `comfy_lora_paths.py` | 新增 `_WMI_NAME_REGEX = r'^python(w)?\.exe$'`，`_WMI_PS` 改為串接該常數；其餘 WMI／身分邏輯完全不變 |
| `devtools/comfy_lora_paths_test.py` | `test_wmi_query_does_not_filter_out_empty_commandline` 移除字串包含斷言；新增 3 件真正的 Regex 行為測試 |
| 本報告 | 新增 |

串接後的 `_WMI_PS` 執行期字串與修改前**逐字相同**：
`Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^python(w)?\.exe$' } | Select-Object ProcessId,Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress -Depth 3`

新增測試：
- `test_wmi_name_regex_behavior`：以 `re`（`IGNORECASE` 模擬 PowerShell）匹配 `python.exe`／`pythonw.exe`／`PYTHON.EXE`，拒絕 `python3.exe`／`python.exe.bak`／`cmd.exe`／`pythonXexe`／含尾端空白的名稱。
- `test_wmi_command_carries_single_escaped_dot`：確認常數等於 `r'^python(w)?\.exe$'`、命令中含 `'.exe'` 前有單一反斜線、且沒有雙反斜線殘留。
- `test_powershell_regex_actually_matches_process_names`：讓 PowerShell 自己套用 regex，預期只回 `python.exe`、`pythonw.exe`。

---

## 4. 測試結果

| 項目 | 結果 |
|---|---|
| `python devtools/comfy_lora_paths_test.py` | **47 tests OK**（原 44 + 新增 3） |
| `python -m py_compile server.py comfy_lora_paths.py devtools/comfy_lora_paths_test.py` | exit 0 |
| `node --check app.js` | exit 0 |
| `python devtools/lora_personal_key_test.py` | 12 passed |
| `python devtools/lora_explorer_api_test.py` | 35 passed |
| `node devtools/lora_explorer_core_test.mjs` | 21 passed |
| `git diff --check` | 無輸出 |

PowerShell Regex 測試在 Windows 上實際執行通過，不是 mock；其餘測試均為隔離資料，**不是 live ComfyUI 驗證**。

---

## 5. 未執行測試及原因

| 未執行 | 原因 |
|---|---|
| 完整 WMI 查詢在真實 Python 行程上驗證 | 7860／8188 關閉、無 Python 行程；禁止重啟服務 |
| live ComfyUI 驗證／B2 | 審查明確要求 B2 暫停 |
| GPU／Civitai API／下载 | 明確禁止 |

---

## 6. 既有安全限制（未變動）

- A 級仍永久停用；成功重建只回 `B / LIVE_UNVERIFIED`，`usable=false`。
- 本機現況回 `C / NO_COMFY_PROCESS`，`usable=false`。
- CommandLine 未知候選 → `C / UNKNOWN_CANDIDATE`；ExecutablePath 無效 → `C / EXECUTABLE_PATH_INVALID`。
- `evidence` 仍不含完整 argv、絕對路徑或環境值。
- 沒有宣稱已驗證 live ComfyUI 實際載入的 LoRA 路徑。

---

## 7. Git 與服務狀態

- Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、Remote `origin`、ahead/behind `1/0`。
- tracked modified **12**（不變）；untracked **39**（38 + 本報告）；staged 0。
- `git diff --check` 無輸出；未執行 add／commit／push／reset／clean／stash／checkout。
- 7860／8188 開始與結束都未監聽；沒有啟動、停止或重啟任何服務；沒有修改模型目錄或使用者資料。

---

## 8. 尚存風險

1. 【未驗證】WMI Regex 只在本機 PowerShell 字串層級實測；無 live Python 行程可驗證完整 WMI 查詢結果。
2. 先前審查指出的功能性問題在實際檔案中不存在；若 ChatGPT 手上看到的是不同版本，請以本報告的位元組／執行期檢查為準。
3. 其他 R1／R2 的結構性阻礙（無 live 路徑驗證來源、A 級停用、B2 暫停）完全沒有改變。

---

## 9. 完成陳述

Regex 寫法與測試覆蓋修正完成，立即停止。其他架構與安全邏輯未動，B2 繼續暫停，等待 ChatGPT 獨立審查。
