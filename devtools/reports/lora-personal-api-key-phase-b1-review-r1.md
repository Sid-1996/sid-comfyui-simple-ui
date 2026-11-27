# Phase B1 獨立審查修正 R1 報告

> 本輪修正 ChatGPT 對 `comfy_lora_paths.py` 的獨立審查問題，**沒有覆蓋原 B1 報告**。
> 沒有修改 `server.py`／前端／ComfyUI 上游／使用者模型目錄；沒有啟動或停止任何服務；
> 沒有連 Civitai、沒有下载模型、沒有 GPU 操作、沒有 Git 寫入。

標記：【本機驗證，讀碼】／【隔離測試】／【真實原始碼子程序測試】／【未驗證】／【推論】

---

## 1. 本次修正目標

1. **最高優先**：重新建立可信的 A/B/C 分級。承認「短命子程序重建 + 目前 YAML」不等於 live ComfyUI 狀態。
2. 修正候選行程歧義：任何可能是 ComfyUI 但無法讀取／排除的候選都 fail closed；交叉確認 WMI／PEB／argv[0] 與 PID 身分。
3. 修正架構辨識：改用 Windows API 確認實際處理器架構，不再用 `sizeof(void*)` 冒充 AMD64。
4. 補齊 Windows 保留名稱與完整路徑長度檢查。
5. 敏感資訊：`evidence` 不回傳完整 argv／絕對路徑／環境值。
6. 提出可行替代驗證方案，但不引入插件、不改上游、不改產品架構。

---

## 2. 起始 Git 狀態

| 項目 | 值 |
|---|---|
| 設備 | `DESKTOP-ADPHHAP`（Online） |
| Repository | `C:/ComfyUI/simple_ui` |
| Branch | `main...origin/main [ahead 1]` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| ahead/behind | `1/0` |
| tracked modified | **12** |
| untracked | **36** |
| staged | 0 |
| `git diff --check` | 無輸出 |

已重新閱讀兩份 AGENTS.md；`codegraph status`：35 files / 1,094 nodes / 4,837 edges，
Pending Changes: Added 4, Modified 2（新模組與測試尚未進索引，依指引未 sync）。
7860／8188 無監聽、無 Python 行程；全程維持關閉。

---

## 3. A 級信任模型調查結論

### 3.1 四個審查問題的回答

**問題 1：是否有可靠方式證明目前 YAML 與啟動時載入的內容一致？**

【本機驗證，讀碼】**目前方案不能。** 子程序重新 `open()` YAML 只能讀到「當下內容」。
可行的**部分**證據是：WMI `Win32_Process.CreationDate` 可得行程建立時間；
若所有 YAML 的最後寫入時間早於行程建立時間，且檔案仍存在，可排除「啟動後被修改／刪除後重建」。
但這是**時間戳證據，不是內容證明**（時鐘、刻意改 mtime、啟動後短時間內修改都無法排除），
本輪**沒有實作**，也不把它當作 A 級充分條件。

**問題 2：是否能證明 prestartup script 沒有改變 LoRA 搜尋路徑？**

**不能。** `main.py:239` 呼叫 `apply_custom_paths()`，但 `main.py:185–236` 的
`execute_prestartup_script()` 在其前後流程中執行各 custom node 的 `prestartup_script.py`
（`module_from_spec` + `exec_module`，可執行任意程式碼，包括 `folder_paths.add_model_folder_path()`）。
本機 `custom_nodes` 沒有找到 `prestartup_script.py`，但這只是本機現況，不能推廣到一般使用者。
靜態掃描也無法證明動態執行沒有副作用。

**問題 3：是否有其他啟動後程式碼能改變 `folder_paths`？**

【本機驗證，讀碼】有：
- `folder_paths.py:382–398` 的 `add_model_folder_path()` 是公開可呼叫的全域函式；
  `is_default=True` 還會 `insert(0, ...)` 改寫順序。
- `folder_paths.py:123–125` 的 `set_output_directory()` 會影響 output 下 LoRA 路徑。
- custom nodes、prestartup scripts、甚至執行期 custom node 都可呼叫兩者。
- `folder_names_and_paths` 是可變全域 dict，任何 import 到它的模組都能直接改。

**問題 4：現有 PEB + 子程序方案是否足以證明 live runtime 的有效路徑？**

**不足以。** 它只能證明「以讀到的 argv／CWD／環境、重讀目前 YAML、重現 `apply_custom_paths()`
的路徑部分」得到一組候選；它無法排除 prestartup 改變、啟動後 YAML 變動、或執行期修改。
因此 R1 已把相關斷言全部降級。

### 3.2 可行的替代驗證方案（只提出，不實作）

本機 ComfyUI 原始碼存在一個**直接來自 live 行程**的路徑來源：

- `api_server/routes/internal/internal_routes.py:47–52`：`GET /internal/folder_paths`
  回傳 `{ key: folder_names_and_paths[key][0] }`，包含 live 的 `loras` 清單。
- `server.py:1334` 以 `add_subapp('/internal', ...)` 掛載；simple_ui 的 `/comfy/*` 代理
  現成可轉送請求，不需新服務、不需插件。
- 優點：直接問正在執行的行程，prestartup／YAML 變動／執行期修改都能反映。
- 風險：原始碼明確註明「endpoints here should NOT be depended upon；僅供 ComfyUI frontend 使用」，
  版本相容性不安全；`is_default` 順序、遮蔽語意仍需小心；目前 ComfyUI 關閉，【未驗證】。

**提議的 A 級條件（需 ChatGPT 批准後才在 B2 之後考慮）**：
`重建候選` 與 `live /internal/folder_paths 的 loras` **完全一致**（含順序）才給 A；
任一不一致、端點不存在、回應格式异常 → 降級 B/C。
在實作並驗證此來源之前，**A 級不可用**。

### 3.3 已落實的修正

- `resolve_lora_paths()` 成功重建現在回 **`B` / `LIVE_UNVERIFIED`、`usable=false`**，
  `loras` 只作唯讀候選顯示；不再回 `A`。
- `_result()` 的 `usable` 仍只在 `grade=="A"` 時為真，沒有任何程式路徑會產生 A。
- 規格 `lora-personal-api-key-phase-b-implementation-spec.md` 同步修正 §4.1／§4.3a／§4.5／§6.1／§14。

---

## 4. 候選行程歧義修正

- WMI 查詢加入 `CreationDate`；`ExecutablePath` 原本就有。
- 先列出**所有** CommandLine 含 `main.py` 的候選（排除 `simple_ui\server.py`）：
  - 0 個 → `C / NO_COMFY_PROCESS`
  - **≥2 個 → `C / MULTIPLE_CANDIDATES`**（不再「挑讀得成功的那一個」）
- 單一候選還要通過三項交叉確認：
  1. PEB `ImagePathName` vs `argv[0]`；
  2. PEB `ImagePathName` vs WMI `ExecutablePath`；
  3. 再次查 WMI 比對 `ProcessId`／`CommandLine`／`ExecutablePath`／`CreationDate`
     （`same_process_identity()`），防止行程結束與 PID 回收競態。
  任一失敗 → `C / IDENTITY_MISMATCH`。
- 讀取失敗／資料不完整 → `C`；架構类失败 → `B / UNSUPPORTED_ARCH` 或 `BITNESS_UNKNOWN`，皆 `usable=false`。
- 新增隔離測試：`test_unreadable_second_candidate_is_not_a`（第二候選 ACCESS_DENIED → MULTIPLE_CANDIDATES）、
  `test_identity_mismatch_is_c`、`test_wmi_executable_path_mismatch_is_c`。

---

## 5. 架構辨識修正

- 新增 `_SYSTEM_INFO` 與 `get_native_architecture()`，呼叫 **kernel32.GetNativeSystemInfo**
  讀 `wProcessorArchitecture`；只有 `PROCESSOR_ARCHITECTURE_AMD64 (9)` 才繼續用 x64 PEB offset。
- 新增 `get_process_architecture(handle)`，呼叫 **kernel32.IsWow64Process2**：
  `procArchitecture=0`（未被模擬）時以 `nativeArchitecture` 判定；
  目標不是 AMD64 → `UNSUPPORTED_ARCH`；API 不可用 → `BITNESS_UNKNOWN`。
- 移除「`ctypes.sizeof(c_void_p)==8` 就當 x64」的推論。ARM64／IA64／x86／UNKNOWN 一律降級。
- 新增測試：本機 GetNativeSystemInfo 回 AMD64；mock ARM64 → `UNSUPPORTED_ARCH`；
  mock 未知 process arch → `UNSUPPORTED_ARCH`；resolver 層降級為 B 且 `usable=false`。

---

## 6. 檔名規則修正

- `RESERVED_NAMES` 補上 `COM¹/²/³`、`LPT¹/²/³`，上標用 `chr(185)/chr(178)/chr(179)` 產生，
  測試也用 `chr()`，不受終端／檔案編碼影響。
- 新增 `MAX_FILENAME_CHARS=200`、`MAX_FULL_PATH_CHARS=259` 與 `validate_full_path()`。
- `sanitize_lora_filename(raw, directory=None)` 可接受目的地目錄，檢查最終完整路徑長度；
  只驗檔名而漏掉實際目標路徑的情況已補上。
- 新增正反例：`COM¹.safetensors` 等拒絕、`C:\short + a.safetensors` 接受、
  300 字元目錄 + `a.safetensors` → `FULL_PATH_TOO_LONG`、`x\y.safetensors` → `PATH_SEPARATOR`。

---

## 7. 敏感資訊處理

- `evidence` 移除 `cwd`、`image`、`argv`、`comfy_argv`、`comfy_root`、`main_py`；
  改為 `pid`、`bitness`、`argv_flags`（只有 `-` 開頭的旗標名）、`argv_count`、
  `env_key_count`、三個「當下值」布林、`env_used`、`verification`、`sources`。
- 新增 `redact_argv()`，只回旗標名稱，不回任何參數值（含路徑與可能的 token）。
- EnvironmentBlock 值仍在子程序內部使用，但**不進回傳、不進日誌**。
- 測試確認：`evidence` 沒有完整 argv、沒有絕對路徑、沒有環境值；
  秘密字串 `SUPERSECRET123` 不出現在結果中。
- `loras` 仍回傳絕對路徑供內部使用；**未來 API 不得直接暴露**，B2 需另做白話化／遮蔽。

---

## 8. 測試結果

| 項目 | 結果 |
|---|---|
| `python devtools/comfy_lora_paths_test.py` | **33 tests OK**（原 23 + 新增 10） |
| 候選行程歧義（第二候選讀取失敗／身分不符／WMI 路徑不符） | 通過，全部非 A |
| 架構辨識（GetNativeSystemInfo／IsWow64Process2／mock ARM64／未知） | 通過 |
| Windows 檔名安全（保留上標、完整路徑長度、分隔符） | 通過 |
| 敏感資訊不外洩 | 通過 |
| `python -m py_compile server.py comfy_lora_paths.py devtools/comfy_lora_paths_test.py` | exit 0 |
| `node --check app.js` | exit 0 |
| `python devtools/lora_personal_key_test.py` | 12 passed |
| `python devtools/lora_explorer_api_test.py` | 35 passed |
| `node devtools/lora_explorer_core_test.mjs` | 21 passed |
| `python comfy_lora_paths.py`（現況無 live process） | `C / NO_COMFY_PROCESS`，`usable=false` |
| `git diff --check` | 無輸出 |

其中兩件「真實原始碼子程序」測試只驗證初始化順序，**不是 live ComfyUI 驗證**。

---

## 9. 未解決風險

1. 【未驗證】沒有 live ComfyUI PID；PEB／WMI 交叉確認、`/internal/folder_paths` 都未在正式行程上實測。
2. 【未驗證】`/internal/folder_paths` 被上游標註為不應依賴；ComfyUI 改版可能移除或改格式。
3. 【未驗證】YAML mtime vs `CreationDate` 的證明力有限，本輪未實作，也不當作 A 級依據。
4. 【未驗證】prestartup script 的副作用只能靠 live 端點間接反映，靜態分析不足。
5. 目前沒有任何 A 級路徑；B2 的下載流程若接上解析器會永遠 fail closed。
6. IsWow64Process2 在舊 Windows 可能不存在，此時一律 `BITNESS_UNKNOWN` → 降級，安全性優先。
7. `evidence` 已淨化，但 B2 若把 `loras` 直接放進 API 仍會暴露絕對路徑，需額外設計。

---

## 10. 是否仍能宣稱 A 級可用

**不能。** R1 之後：

- 重建成功 → `B / LIVE_UNVERIFIED`、`usable=false`；
- 本機現況（無 live process）→ `C / NO_COMFY_PROCESS`、`usable=false`；
- 沒有任何程式路徑會回 `A`。

先前 B1 報告中「A 級可用」的敘述已被本輪修正取代；原報告未覆蓋，做為歷史紀錄。
若無 ChatGPT 明確批准新的 live 驗證來源，**不得**重新宣稱 A 級。

---

## 11. Phase B2 是否具備進入條件

**不具備。** 阻礙是結構性的，不是實作工程量：

- 目前沒有可證明 live 有效 LoRA 路径的來源；重建路径只能到 B。
- 下载功能需要 A 級目的地；解析器現在永遠 `usable=false`，接入下载只會 fail closed。
- 可行下一步需先由 ChatGPT 決定：
  1. 是否接受 ComfyUI `/internal/folder_paths` 做為 live 驗證來源並承擔相容風險；
  2. 若接受，是否另開驗證階段（B1b）專門在 live ComfyUI 上驗證一致性；
  3. 若不接受，是否放寬產品設計（例如由使用者明確指定下載目錄） — 這涉及產品架構，**本輪不建議、不實作**。

本輪已停止相關實作，**沒有接入下載流程**。等待 ChatGPT 再次獨立審查。
