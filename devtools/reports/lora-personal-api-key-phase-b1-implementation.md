# Phase B1：ComfyUI LoRA 路徑解析器實作報告

> 本輪完成三項規格修正、路徑解析器與隔離測試。**未完成 Phase B2 下載功能**，
> 沒有修改 `server.py`／`app.js`／`app.css`／`index.html`／既有測試，
> 沒有啟動／停止／重啟任何服務，沒有 GPU／模型的任何操作，沒有 Git 寫入，沒有覆蓋既有報告。

標記：【本機驗證】／【隔離測試】／【真實原始碼子程序測試】／【未驗證】／【推論】

---

## 1. 任務目標及範圍

1. 修正 Phase B-1 規格的三項審查問題（PEB EnvironmentBlock 語意、Windows 檔名路徑分隔符、ComfyUI 初始化順序）。
2. 實作獨立、唯讀、Windows-only、標準庫的 ComfyUI LoRA 目錄解析器，A/B/C 分級、fail closed。
3. 建立不依賴 live ComfyUI 的隔離測試。
4. 撰寫本報告。

明確不做：下載、Civitai API、UI、Git commit/push、服務重啟、GPU 測試、建立或修改實際模型目錄。

---

## 2. 開始前 Repository / Branch / HEAD / Remote / Git 狀態

| 項目 | 值 |
|---|---|
| Repository 根目錄 | `C:/ComfyUI/simple_ui` |
| Branch | `main...origin/main [ahead 1]` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| ahead/behind | `1/0` |
| tracked modified | **12** |
| untracked | **33** |
| staged | 0 |
| `git diff --check` | 無輸出 |

已完整重新閱讀 `C:\ComfyUI\AGENTS.md`、`C:\ComfyUI\simple_ui\AGENTS.md`；
ComfyUI 上游的 `AGENTS.md` 也讀過（本輪只讀取上游原始碼，未修改）。
先執行 `codegraph status`：35 files / 1,094 nodes / 4,837 edges，
Pending Changes: Added 2, Modified 2；再執行
`codegraph explore "folder_paths _local_checkpoint_size loras routes"` 與
`codegraph explore "_civitai_get _civitai_me _NoRedirectHandler key status"`。
依指引未執行 `codegraph sync`（`.codegraph/` 視為衍生索引）。

---

## 3. 設備與服務狀態

【本機驗證】設備 `DESKTOP-ADPHHAP`。

本輪開始與結束時，7860／8188 **皆無監聽**，查不到任何 `python.exe`／`pythonw.exe` 行程。
依任務要求，使用者已手動關閉服務，本輪維持關閉，**沒有嘗試啟動或修復**。
唯一執行的 Python 子程序是「probe child」：它只 `import folder_paths`／`utils.extra_config`，
不 import `main.py`、不初始化 GPU、不綁定 port、不建立模型目錄。

---

## 4. 三項規格修正內容

檔案：`devtools/reports/lora-personal-api-key-phase-b-implementation-spec.md`（只修改這一份）。

### 修正 A — PEB EnvironmentBlock 語意（§4.1、§4.2、§4.3、§10、§14）

- 明確改為「讀取目標行程**當下**的 CWD 與 EnvironmentBlock」，**不再宣稱是啟動時環境**。
- 指出行程可在啟動後 `os.chdir()`／修改 `os.environ`，「資料可讀取」≠「資料足以證明實際路徑」。
- 新增 A 級成立條件：所有影響 LoRA 的路徑 argv 必須絕對、yaml 不得依賴 `expandvars()`／`expanduser()`；
  只要有一項無法證明，就 fail closed（C 級）。
- 風險與 ChatGPT 審查清單同步更新。

### 修正 B — Windows 檔名路徑分隔符（§6.1–6.3）

- 原始檔名含 `/` 或 `\` **直接拒絕**；明確禁止先用 `os.path.basename()` 剝除路徑再接受。
- 補齊禁止字元、控制字元、尾端空格／句點（含副檔名前空白）、保留名稱、`..`、長度、副檔名與 NFC 碰撞規則。
- 測試案例分成拒絕／接受／轉換三類，並加入 `dir\..\ok.safetensors`（basename 合法仍須拒絕）。

### 修正 C — ComfyUI 初始化順序（§4.3a）

依本機原始碼逐項追查並寫入規格（詳見第 5 節），要求子程序重現相同順序，
輸出與順序不符或任一來源不可得即降級 C。

---

## 5. 實際追查的 ComfyUI 原始碼及初始化順序

【本機驗證，讀碼】全部位於 `C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\`：

1. `comfy/options.py:2–6`：`args_parsing = False`，需 `enable_args_parsing(True)`。
   `comfy/cli_args.py:287–290`：在 import 時決定用真 argv 或空 argv。
2. `folder_paths.py:8` module 層級 `from comfy.cli_args import args`。
3. `folder_paths.py:14–28` import 時立即計算 `base_path`（`--base-directory` 的 `abspath`，否則模組目錄）、
   `models_dir`（`--models-directory` 的 `abspath`，否則 `base_path/models`），
   並建立 `folder_names_and_paths["loras"] = ([models_dir/loras], ...)`（順序 0）。
4. `main.py:239` → `apply_custom_paths()`（`main.py:137–182`）：
   - 根 `extra_model_paths.yaml`（若存在，`139–141`）；
   - `--extra-model-paths-config` 依 `itertools.chain(*args...)`（`143–145`）；
   - `--output-directory` → `abspath()` → `set_output_directory()`（`155–159`）；
   - 依序加入 output 下的 checkpoints / clip / vae / diffusion_models / **loras**（`161–167`）。
5. `utils/extra_config.py:6–34`：`yaml_dir = dirname(abspath(yaml_path))`；
   `base_path` 做 `expandvars()`+`expanduser()`，相對以 yaml_dir 為基準；個別路徑亦然；`normpath()` 後加入。
6. `folder_paths.py:382–398`：`add_model_folder_path()` 預設 append，`is_default=True` 移到首位。
7. `folder_paths.py:450–467`：`get_full_path()` 依註冊順序回第一個存在檔案（前面遮蔽後面）；
   `recursive_search()`（`404–406`）略過不存在目錄。

最終順序：**規範路徑 → 根 yaml loras → extra yaml loras（argv／檔內順序）→ output_directory/loras（最後 append）**。

【重要發現】live 命令行以 `-s`（Python 自己的旗標）開頭，argparse 不認識它。
解析器因此從 `main.py` 那一格開始重建 ComfyUI argv（`comfy_argv_from_argv()`），
而不是把整個命令行原餵給 argparse。這是本輪由子程序測試實際發現並修正的。

---

## 6. 新增與修改檔案清單

| 檔案 | 動作 | 說明 |
|---|---|---|
| `devtools/reports/lora-personal-api-key-phase-b-implementation-spec.md` | 修改 | 僅三項審查修正（第 4 節），其餘章節保持原樣 |
| `comfy_lora_paths.py` | 新增 | 路徑解析器（Windows／標準庫／獨立模組），含 `--probe-child` 模式 |
| `devtools/comfy_lora_paths_test.py` | 新增 | 23 件隔離測試 |
| `devtools/reports/lora-personal-api-key-phase-b1-implementation.md` | 新增 | 本報告 |

**未修改**：`server.py`、`app.js`、`app.css`、`index.html`、`tags.js`、`dict.js`、
任何既有測試、設定、使用者資料、ComfyUI 原始碼。未執行 `codegraph sync`。

---

## 7. 路徑解析器設計及信任邊界

`comfy_lora_paths.py` 的公開介面：

- `parse_windows_command_line(cmdline)`：`shell32.CommandLineToArgvW`，限制長度與 argc，
  **不使用 `shlex.split()`**。
- `read_process_parameters(pid)`：`OpenProcess(QUERY_LIMITED_INFORMATION|VM_READ)` →
  `NtQueryInformationProcess(ProcessBasicInformation)` → PEB x64 offsets：
  CWD `+0x38`、ImagePathName `+0x60`、CommandLine `+0x70`、EnvironmentBlock `+0x80`。
  有 `IsWow64Process`、位元組序／長度上限（argv 32K、單 arg 8K、env 256K、路徑 32K）、
  short-read／解碼失敗／資料不完整處理；失敗回穩定 `code`，**環境值绝不進回傳或日誌**。
- `discover_python_processes()`：唯讀 WMI（PowerShell `Get-CimInstance`），只取 python 行程。
- `comfy_argv_from_argv()`：從 `main.py` 開始截取，排除 Python 自身旗標。
- `run_child_probe()`：用 ComfyUI 的 `ExecutablePath` 起短命子程序，
  以讀到的 `cwd=`／`env=` 執行 `--probe-child`，重現 `apply_custom_paths()` 的路徑部分。
- `sanitize_lora_filename()` / `filename_collides()`：第 6 節修正後的檔名規則。
- `resolve_lora_paths()`：組裝 A/B/C；所有外部依賴可注入以便隔離測試。

信任邊界：

1. **只用目標 PID 的當下快照**，不碰 simple_ui 自己的 CWD／env。
2. **ExecutablePath 只當作要執行的 Python 與 argv[0] 比對**，绝不用它猜 CWD。
3. 環境變數的「當下值」不保證等於啟動值；因此要求路徑全絕對、yaml 無 env 展開才給 A。
4. 子程序只重現**路徑變更**，不 import `main.py`、不初始化 GPU、不寫任何目錄。
5. 找不到行程、 runat 模糊、讀取失敗、子程序失敗、路徑重複／相對／格式錯誤 → fail closed。
6. 解析器**只回傳路徑清單與證據摘要**，不下載、不建立目錄、不判斷檔案是否存在。

---

## 8. A/B/C 等級的實際判斷結果

| 情境 | 等級 | 依據 |
|---|---|---|
| 本機現況（無 live ComfyUI） | **C / `NO_COMFY_PROCESS`** | 【本機驗證】實際執行 `python comfy_lora_paths.py` 回传 `grade=C, usable=false, code=NO_COMFY_PROCESS` |
| 隔離 mock：全部絕對路徑 + yaml 無 env 展開 | A | 23 件測試之 `test_a_keeps_lora_order`，loras 順序完整保留 |
| 隔離 mock：相對 `--output-directory` | C / `CWD_UNPROVEN` | 無法證明啟動時 CWD |
| 隔離 mock：yaml 含 `$`／`%`／`~` | C / `ENV_UNPROVEN` | 當下 EnvironmentBlock 不足以證明啟動值 |
| 隔離 mock：WOW64 | B（不可用） | 32-bit PEB 偏移未支援 |
| 隔離 mock：AccessDenied | C / `ACCESS_DENIED` | 權限不足 |
| 隔離 mock：多個候選 | C / `AMBIGUOUS_PROCESS` | 不猜要用哪一個 |
| 隔離 mock：`simple_ui\server.py` | 忽略 → C | 避免誤認自己的行程 |
| 真實原始碼子程序（含 `is_default`） | 順序 A 級資料 | 【真實原始碼子程序測試】見第 9 節 |

**沒有任何 live ComfyUI PID 被用來驗證 A 級**；本機 A 級只在 mock／真實原始碼子程序層級成立。

---

## 9. 測試項目與完整結果

### 9.1 新增隔離測試（`python devtools/comfy_lora_paths_test.py`）

**23 tests，全部 OK**，耗時約 5 秒。分項：

- Windows command line：`CommandLineToArgvW` 範例（並對照 `shlex` 會把 `D:\out` 變成 `D:out`）、無效輸入拒絕、路徑旗標解析、相對路徑偵測、main.py 解析。
- PEB 助手：自身 x64 行程可讀 CWD／env／command line（僅證明「可讀取」）、short-read 失敗、`UNICODE_STRING` 長度超限、env 無結尾拒絕。
- 解析器分級：A 順序、CWD 相對 → C、env 敏感 → C、probe 失敗 → C、相對／空／重複路徑 → C、WOW64 → B、AccessDenied → C、無行程／模糊 → C、忽略 server.py、env 值不外洩。
- 檔名安全：21 個拒絕案例（含分隔符、ADS、保留名、控制字元、尾端空白／句點、`..`、超長、危险的副檔名）、NFC 正規化與大小寫接受案例、碰撞比對。
- **真實原始碼子程序測試（2 件）**：用 ComfyUI embedded Python 與真實 `folder_paths`／`utils.extra_config`，
  以 temp yaml 驗證 `規範 → yaml → output/loras` 順序，以及 `is_default: true` 把 yaml 路徑移到首位。
  未啟動 ComfyUI、未使用 GPU、未建立模型目錄。

### 9.2 語法與既有回歸（全部 exit 0）

- `python -m py_compile server.py comfy_lora_paths.py devtools/comfy_lora_paths_test.py`
- `node --check app.js`、`node --check tags.js`、`node --check dict.js`
- `python devtools/lora_personal_key_test.py`：**12 passed**
- `python devtools/lora_explorer_api_test.py`：**35 passed**
- `node devtools/lora_explorer_core_test.mjs`：**21 passed**

### 9.3 Git 檢查

`git diff --check` 無輸出；未執行任何 Git 寫入。

---

## 10. 未執行測試及原因

| 未執行 | 原因 |
|---|---|
| 在 live ComfyUI PID 上讀 PEB | 服務已由使用者關閉，且禁止重啟；無 PID |
| A 級 live 還原 | 同上；只能靠 mock 與真實原始碼子程序 |
| 32-bit／WOW64 PEB 偏移 | 未實作，直接降級 B |
| 真實 Civitai API／API Key／下載 | B1 範圍外且明確禁止 |
| GPU／服務整合測試、瀏覽器實測 | 明確禁止；本輪無 UI 改動 |
| `codegraph sync` | `.codegraph/` 為衍生索引，依指引不更新 |

---

## 11. Git 最終狀態

- Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、Remote `origin`、ahead/behind `1/0`。
- tracked modified **12**（不變）；untracked **36**（原 33 + 解析器 + 測試 + 本報告）；staged 0。
- `git diff --check` 無輸出。
- 未執行 add／commit／push／checkout／reset／clean／stash。

---

## 12. 是否影響正式服務

**沒有。** 7860／8188 開始與結束都未監聽；沒有啟動、停止或重啟任何服務；
沒有修改設定、模型目錄或使用者資料；沒有建立實際模型資料夾。
probe child 只讀取 ComfyUI 原始碼並在 temp 建立測試用 yaml／空資料夾，結束即刪除。

---

## 13. 未解決問題及風險

1. 【未驗證】PEB 在真實 ComfyUI PID 上的讀取（自身 x64 已驗證）；CLI 與 ImagePathName 比對、PID 回收競態仍待 live 驗證。
2. 【未驗證】PEB 讀到的是**當下**值；本解析器靠「路徑全絕對且無 env 展開」規避，一旦使用者 yaml 用 `%VAR%` 就 fail closed。這對部分進階設定是功能限制。
3. 【未驗證】`--base-directory`／`--models-directory` 使用 `is_valid_directory`，若啟動時存在的目錄後來被刪，子程序可能解析失敗 → C。
4. 【推論】WMI 以 PowerShell 取得，若系統限制 PowerShell 執行會落到 `NO_COMFY_PROCESS`；不會誤用硬編碼路徑。
5. 【未驗證】ComfyUI 改版可能改變 `apply_custom_paths()` 或 PEB 結構，需相容性測試。
6. 解析器目前**沒有接進 `server.py`**；B2 必須新增 API 路由並套用同源檢查，否則功能不可見。
7. 目前沒有 live 環境可驗證「A 級真實可用」，B2 之前仍需 ChatGPT 判斷是否接受隔離驗證作為進入條件。

---

## 14. Phase B2 是否具備進入條件

**具備「隔離層面」條件，但不具備「live 驗證」條件。**

- 已具備：初始化順序由原始碼與真實子程序確認；A/B/C 判斷與 fail closed 有 23 件測試；檔名規則可測試；解析器未接入 server.py，B2 可獨立新增路由。
- 未具備：無 live ComfyUI PID，A 級路徑無法在正式行程上實測；PEB 的當下 vs 啟動語意只能靠保守條件規避。
- 建議：若 ChatGPT 接受「B1 隔離驗證 + fail closed」作為進入條件，B2 可先完成 metadata／下載核心與 mock 測試；
  live A 級驗證留到使用者重新啟動 ComfyUI 後，以獨立、唯讀方式進行，**不得為驗證而重啟服務**。

---

## 15. 需要 ChatGPT 獨立審查的項目

1. 是否接受「PEB 當下值 + 路徑全絕對／無 env 展開才給 A」的信任模型（會讓 `%VAR%` yaml fail closed）。
2. 是否接受把 `-s` 等 Python 旗標從 argv 中從 `main.py` 開始截掉的做法。
3. 是否接受子程序用真實 `folder_paths`／`utils.extra_config` 重現初始化（而非自行重寫解析）。
4. 是否接受 WOW64 直接降級 B、AccessDenied／模糊行程直接 C。
5. 是否接受 yaml 原始文字出現 `$`／`%`／`~` 就視為 env 敏感（保守 fail closed，可能誤傷註解）。
6. 是否接受 B2 在沒有 live A 級驗證的情況下先行實作（以 mock 為主）。
7. 解析器要不要在 B2 一併接入 `server.py` 的 `/api/civitai/download/*`，還是另開 B1b 驗收路由。

---

## 16. 完成陳述

Phase B1 完成並立即停止。沒有開始 Phase B2 下載實作，沒有修改 UI 或既有 API，
沒有啟動服務、沒有 GPU 操作、沒有 Git 寫入，既有工作區修改完整保留。
等待 ChatGPT 直接讀取報告、程式碼與 Diff 完成獨立審查。
