# Phase B-1：LoRA 下載功能實作規格（定稿草案）

> 本輪只做調查、設計與規格撰寫，**沒有開始 Phase B 程式實作**。
> 唯一工作區寫入是本報告；沒有修改 `server.py`／`app.js`／`app.css`／`index.html`／任何測試，
> 沒有修改設定或使用者資料，沒有啟動／停止／重啟任何服務，沒有 Git 寫入。

明確標記：【已驗證】＝本輪讀碼或唯讀指令；【社群／官方文件】＝外部文件；
【推論】＝設計推導；【未驗證】＝尚無實測證據，不得當成事實。

---

## 1. 任務目標及範圍

目標：根據目前程式碼、既有四份歷史報告與 ChatGPT 審查意見，產出一份可直接遵循的
LoRA 下載實作規格，讓後續 Phase B 實作不需要再重新設計。

產品定位：
- 公開搜尋維持匿名，不因設定 Key 而改變。
- Personal API Key 是**下載授權**，不是登入系統。
- 不引入 OAuth、共用 Key、任意 URL 下載器或額外服務架構。
- 第一版只做：primary file、單一任務、HTTP polling、簡單進度、可取消、
  正確 ComfyUI LoRA 目錄、SHA256、`.part`、原子改名、失敗清理、同名保護、完成刷新清單。

---

## 2. Repository、Branch、HEAD、Remote、開始前 Git 狀態

| 項目 | 值 |
|---|---|
| Repository 根目錄 | `C:/ComfyUI/simple_ui` |
| Branch | `main...origin/main [ahead 1]`（ahead/behind `1/0`） |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| tracked modified | **12** |
| untracked | **32** |
| staged | 0 |
| `git diff --check` | 無輸出 |
| 目標報告 | 開始時不存在，無覆蓋衝突 |
| 設備 | `DESKTOP-ADPHHAP` |

正式服務：本輪開始時 7860／8188 **沒有監聽**，查不到任何 Python 行程；
依任務指示，使用者已手動關閉服務，本輪**維持關閉**，未重啟。

CodeGraph：先執行 `codegraph status`（35 files / 1094 nodes / 4837 edges；
Pending Changes: Added 2, Modified 2），再執行
`codegraph explore "folder_paths _local_checkpoint_size loras routes"` 與
`codegraph explore "_civitai_get _civitai_me _NoRedirectHandler key status"`。
依指示未 `codegraph sync`。ComfyUI `main.py`／`folder_paths.py` 不在本專案索引內，
故以 `read`／`grep` 直接讀取。

---

## 3. 參考的歷史報告與實際程式碼位置

### 3.1 歷史報告（已讀）

- `devtools/reports/lora-personal-api-key-design-review.md`：定位下載為探索中心延伸，不做帳號系統／下載管理器。
- `devtools/reports/lora-personal-api-key-phase-b-audit.md`：首輪 B-0 調查（307→`b2.civitai.com`、folder_paths、整合點）。
- `devtools/reports/lora-personal-api-key-phase-b-audit-r1.md`：live runtime 與獨立 import 差異、R2 host 樣本、DNS pinning。
- `devtools/reports/lora-personal-api-key-phase-b-audit-r2.md`：A/B/C 分級、CommandLineToArgvW、allowlist 收緊、競態與 timeout。

### 3.2 目前程式碼（重新確認，未沿用舊行號）

| 檔案／行號 | 現況 |
|---|---|
| `server.py:115–116` | `KEY_FILE_NAME = "civitai_key.bin"`、`_KEY_PATH` |
| `server.py:285–311` | `_civitai_auth_allowed()`：https／精確 `civitai.com`／port None 或 443／無 userinfo／R1a 空 port 修正 |
| `server.py:569` | `_comfy_get_json()`：本機 ComfyUI API 呼叫 |
| `server.py:726–740` | `_NoRedirectHandler`、`_open_without_redirect()` |
| `server.py:743–782` | `_civitai_get(path, timeout, auth=False)`；Bearer 只在 host guard 通過時附加；3xx → `REDIRECT_BLOCKED` |
| `server.py:785–809` | `_civitai_me(key)`：Key 測試，固定 Bearer、no-redirect |
| `server.py:811–832` | `_civitai_key_error()`：401/403/429/5xx/網路錯誤映射 |
| `server.py:1034–1081` | `_local_checkpoint_size()`：獨立 import `folder_paths`，只見 canonical 目錄 |
| `server.py:1698–1734` | `do_GET()`：Civitai status/search、Key status、LoRA 等路由 |
| `server.py:1741–1774` | `do_POST()`：check/delete/reverse/output-dir/key/key/test/key/remove；**沒有 download 路由** |
| `server.py:1777–...` | `_set_output_dir()`：同源檢查範本 |
| `server.py:1917–1945` | `_key_guard()`／`_key_forbidden()`／`_key_body()` |
| `server.py:1947–...` | Key status/set/test/remove handlers |
| `server.py:2055–2065` | `_hash_stream()`：串流 SHA-256 + byte 計數，可重用 |
| `app.js:1765–1811` | `refreshLoraList(force)` → `GET /api/loras` |
| `app.js:1995–2110` | Key UI 狀態機 |
| `app.js:2142–2184` | `cvRenderCard()`：版本卡片與檔案列，可加下載按鈕 |
| `index.html:359–397` | `#exploreModal`，可加進度列 |
| `devtools/lora_mock_civitai.py` / `lora_mock_comfy.py` | 隔離 mock server |

---

## 4. A/B/C 路徑可靠性定義及決策表

### 4.1 等級定義

**A：能可靠還原 live runtime 的有效 LoRA 搜尋路徑。** 必須全部成立：
1. 以 WMI 找到 ComfyUI process：`Name` 為 `python.exe`／`pythonw.exe`，
   `ExecutablePath` 指向 ComfyUI 安裝的 Python，CommandLine 含 `main.py` 且完整路徑比對 ComfyUI 根；
   PID 仍存活，讀取前後 CommandLine 一致。
2. CommandLine 以 `CommandLineToArgvW`（shell32）解析；**禁止 `shlex.split()`**（實測 `posix=True` 會把 `D:\out` 變成 `D:out`，`posix=False` 會保留引號）。
3. 以 `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ)` +
   `NtQueryInformationProcess(ProcessBasicInformation)` + `ReadProcessMemory` 唯讀取得
   該 PID **當下**的 CWD（`RTL_USER_PROCESS_PARAMETERS+0x38`）與**當下的 EnvironmentBlock**
  （`+0x80`）。**兩者都是讀取當下的值，不是行程建立時的原始值。** 行程可以在啟動後呼叫
   `os.chdir()` 或修改 `os.environ`，因此「讀得到」不代表「等於 ComfyUI 初始化時使用的值」。
   【未驗證】此程序目前只在自身 x64 行程實測成功，**未在實際 ComfyUI PID 上驗證**。
   A 級必須另外證明這些當下值**足以還原初始化時的解析結果**：
   - 若任一影響 LoRA 路徑的 argv 路徑參數（`--base-directory`／`--models-directory`／
     `--output-directory`／`--extra-model-paths-config` 等）是相對路徑，其 `os.path.abspath()`
     依赖啟動當下的 CWD；目前 CWD 可能已改變 → **fail closed**。
   - 若任一 yaml 的路徑值使用環境變數（`expandvars()`）或 `~`（`expanduser()`），
     目前 EnvironmentBlock 可能已與啟動時不同 → **fail closed**。
   - 反之，若所有相關路徑皆為絕對路徑且未使用環境變數展開，則 CWD／EnvironmentBlock
     的「當下性」不影響解析結果，才允许 A 級。
   不得因為讀取到看似合理的環境變數，就宣稱 A 級路徑已驗證。
   「資料可讀取」與「資料足以證明實際路徑」是兩件不同的事。
4. 目标與自身必須同為 x64；若 `ProcessWow64Information` 顯示 WOW64（32-bit）→ 降級 B。
5. 用讀到的 `ExecutablePath` 起短命子程序，`cwd=` 用讀到的 CWD、`env=` 用讀到的環境，
   `sys.argv` 用解析出的 argv；先 `comfy.options.enable_args_parsing(True)`，
   `import folder_paths`，重現 `apply_custom_paths()` 的**路徑變更部分**：
   - 根 `extra_model_paths.yaml`（若存在）→ `utils.extra_config.load_extra_path_config()`
   - `--extra-model-paths-config` 依 `itertools.chain(*args...)` 順序逐份載入
   - `--base-directory`／`--models-directory`／`--output-directory`（注意 `os.path.abspath` 相對於 ComfyUI CWD）
   - `add_model_folder_path("loras", os.path.join(get_output_directory(), "loras"))`
   - **不 import `main.py`、不初始化 GPU、不寫任何目錄**
6. 子程序以 JSON 回傳：`grade="A"`、`exe`、`cwd`、`argv`（可遮罩敏感值）、
   `effective_loras_paths`、`output_directory`、`evidence` 各項布值。
7. 父行程驗證：輸出格式正確、路徑皆為絕對路徑、無重複、無空白；任一不符 → 降級 C。
8. **R1 新增（最高優先）**：以上 1–7 只证明「重建候選」，**不能證明 live runtime**。
   `main.py` 的順序是 `apply_custom_paths()` → `execute_prestartup_script()` → 後續初始化，
   自訂節點 prestartup script 可在 `apply_custom_paths()` 之後改變 `folder_paths`；
   已載入的 YAML 也可能在啟動後被修改或刪除。因此：
   - 沒有獨立的 live 驗證來源時，**最大只能給 B，`usable=false`，不得下載**；
   - A 級必須另有「來自正在執行行程」的驗證（例：ComfyUI 自身回傳的有效路徑），
     且與重建結果一致；此驗證來源尚未實作，属【未驗證】。
   - 候選行程歧義、WMI `ExecutablePath`／PEB `ImagePathName`／argv[0] 不一致、
     PID 身分無法再次確認、架構無法用 Windows API 證實為 AMD64 → 一律降級 B/C。
   - R2 補充：WMI 必須列出**所有** Python 行程，不得用 `-and $_.CommandLine` 預先過濾；
     CommandLine 空／null／不可讀視為未知候選，fail closed；
     第一次與第二次 WMI snapshot 的 `ExecutablePath` 都必須存在、非空、有效絕對路徑，
     且與 PEB `ImagePathName` 一致；明確 PID 路徑也不得繞過這些檢查。

**B：只能取得部分資訊。** 例如：argv 可讀但 CWD／環境讀不到；或目標為 32-bit；
或子程序只能確認部分旗標。必須在回傳中明確列出「已證實」與「推測」欄位。
**B 級只允許唯讀顯示（例如介面提示「路徑資訊不完整」），不得作為下載目的地。**

**C：無法可靠還原。** 找不到 ComfyUI process、PID 失效、AccessDenied、
CommandLine 解析失敗、子程序失敗／格式錯誤、A 級任一必要條件不成立、
或不同來源資訊互相矛盾。C 級必須 **fail closed**：停止下載並顯示白話原因。

### 4.2 明確拒絕條件（不可猜測）

- `Python ExecutablePath` **不等於**工作目錄；不得用它當 CWD。
- 不得用目前 simple_ui 行程的 CWD／環境冒充 ComfyUI 啟動時狀態。
- 也不得把**目標行程當下**的 CWD／EnvironmentBlock 直接當成「啟動時狀態」；
  必須先證明當下值與初始化解析無關（全部路徑絕對且無環境變數展開），否則 fail closed。
- 不得用 `shlex.split()` 解析 Windows 命令列。
- 不得假設 PEB 偏移在 32-bit／WOW64 上也相同。
- 不得默默回退硬編碼 `models/loras`。
- 不得要求一般使用者修改 Python 程式碼或手動輸入路徑。

### 4.3 設定檔與相對路徑規則（必須正確處理）

- `folder_paths.py:15–23`：`base_path` 預設模組目錄；`--base-directory`／`--models-directory`
  以 `os.path.abspath()` 解析 → 相對於 ComfyUI CWD。
- `main.py:156–159`：`--output-directory` 同樣 `os.path.abspath()` → 相對於 ComfyUI CWD。
- `utils/extra_config.py:9–19`：`yaml_dir = dirname(abspath(yaml_path))`；
  `base_path` 經 `expandvars()`＋`expanduser()`，若相對則以 yaml_dir 為基準；
  個別 folder 若無 base_path 也以 yaml_dir 為基準（`30–31`）；最後 `normpath()`。
  **只有 base_path 做環境變數展開**。
- `main.py:137–145` 載入順序：根 yaml → `--extra-model-paths-config` 依 argv 順序。
- `add_model_folder_path()`（`folder_paths.py:382–398`）：預設 append；`is_default=True` 移到首位。
- 環境變數展開必須用**目標行程當下**的 EnvironmentBlock；但該區塊不保證等於啟動時環境。
  只要有任何路徑值依賴 `expandvars()`／`expanduser()`，就無法證明還原實際初始化值 → fail closed（C 級），
  不得因為「讀到了環境變數」就當成 A 級已驗證。

### 4.3a ComfyUI 初始化順序（依本機原始碼實際追查，2026-11-26）

【本機驗證，讀碼】逐項追查 `C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\` 現行原始碼，
順序如下；解析必須重現此順序，不可只看最後目錄列表是否「看似正確」：

1. `comfy/options.py:2–6`：`args_parsing = False`；`enable_args_parsing(True)` 才會解析 argv。
   `comfy/cli_args.py:287–290` 在**模組 import 時**決定 `args = parser.parse_args()` 或空參數。
   因此子程序必須先 `sys.argv = <CommandLineToArgvW 結果>`、再 `enable_args_parsing(True)`、
   **最後才** `import folder_paths`（它會 import `comfy.cli_args`）。
2. `folder_paths.py:8`：module 層級 `from comfy.cli_args import args`。
3. `folder_paths.py:14–28`（import 時立即執行）：
   - `base_path = os.path.abspath(args.base_directory)`，否則 `dirname(realpath(__file__))`；
   - `models_dir = os.path.abspath(args.models_directory)`，否則 `base_path/models`；
   - `folder_names_and_paths["loras"] = ([os.path.join(models_dir, "loras")], ...)` → **規範路徑（順序 0）**。
   - `--base-directory`／`--models-directory` 是 `is_valid_directory` 型別（`cli_args.py:265–266`），
     解析時就會檢查目錄存在。
4. `main.py:239` 呼叫 `apply_custom_paths()`；其內部順序（`main.py:137–182`）：
   1. 根 `extra_model_paths.yaml`（若存在）→ `utils.extra_config.load_extra_path_config()`（`139–141`）；
   2. `--extra-model-paths-config` 依 `itertools.chain(*args...)` 順序逐份載入（`143–145`）；
   3. 只在 log 中回報 base/models directory（`147–153`，路径已由步驟 3 套用）；
   4. `--output-directory` → `os.path.abspath()` → `folder_paths.set_output_directory()`（`155–159`）；
   5. 依序 `add_model_folder_path()` 加入 output 下的 `checkpoints`、`clip`、`vae`、
      `diffusion_models`、**`loras`**（`161–167`）→ output 的 loras 永遠是**最後 append**；
   6. input／previews／user directory（`169–182`，不影響 loras）。
5. `utils/extra_config.py:6–34`：每份 yaml 以 `yaml_dir = dirname(abspath(yaml_path))` 為基準；
   `base_path` 做 `expandvars()`+`expanduser()`，相對則以 yaml_dir 為基準（`15–19`）；
   個別路徑若無 base_path 且相對也以 yaml_dir 為基準（`30–31`）；`normpath()` 後
   `add_model_folder_path(x, path, is_default)`。
6. `folder_paths.py:382–398`：`add_model_folder_path()` 預設 append；`is_default=True`
   時 `insert(0, ...)`（已存在則移到首位）→ **yaml 的 `is_default` 可以改寫順序**。
7. `folder_paths.py:450–467`：`get_full_path("loras", name)` 依註冊順序回第一個存在的檔案
   → 前面同名檔遮蔽後面；`recursive_search()`（`404–406`）略過不存在目錄。

最終 LoRA 順序 = 規範路徑（0）→ 根 yaml 的 `loras` 項目 → 各 extra yaml 的 `loras` 項目
（依 argv 與檔案內順序）→ `output_directory/loras`（最後）。
若子程序輸出與此順序不符、或任一來源無法取得／無法證明，一律降級 C，不得假裝已驗證。

【R1 補充】`main.py:239` 的 `apply_custom_paths()` 之後還有 `execute_prestartup_script()`
（`main.py:185–236`），它會執行各 custom node 的 `prestartup_script.py`，
該程式可以呼叫 `add_model_folder_path()` 改變 LoRA 路徑；之後仍有大量主程式初始化。
因此「重現 apply_custom_paths 的路徑部分」**不是** live 路徑的完整證明。
本機現況沒有 prestartup script，但這不能推廣到一般使用者的安裝。

### 4.4 多目錄優先順序（已驗證／推論）

- `get_full_path("loras", name)`（`folder_paths.py:450–467`）依註冊順序回第一個存在的檔案 → 前面同名檔會遮蔽後面。
- `recursive_search()`（`404–406`）略過不存在的目錄；建立已註冊但不存在的目錄即可被辨識（【推論】，依 cache mtime 失效邏輯）。
- **不盲目用 `[0]`**：先過濾存在且可寫的路徑，再取註冊順序中第一個可用者。

### 4.5 決策表

| 情況 | 等級 | 下載是否允許 |
|---|---|---|
| 子程序重建成功，但沒有 live 驗證來源（目前唯一可達狀態） | **B / `LIVE_UNVERIFIED`** | **不允許**（僅供唯讀顯示） |
| 重建結果與 live 獨立驗證來源一致 | A | 允許（驗證來源尚未實作，【未驗證】） |
| argv 可讀但 CWD／環境不可讀；或架構無法證實為 AMD64 | B | **不允許** |
| 候選行程多於一個、讀取失敗、身分不一致或 PID 無法再確認 | C | **不允許** |
| process 不存在／資訊矛盾／子程序失敗 | C | **不允許**，白話停止 |
| ComfyUI 使用者已關閉服務（本輪現況） | C | 不允許 |

---

## 5. 下載目的地選擇規則

1. 只使用 A 級回傳的 `effective_loras_paths`。
2. 逐項過濾：`os.path.isabs`、正規化、無 `..` 逃逸、`os.path.isdir` 且 `os.access(..., W_OK)`。
3. **不建立不存在的目錄**（不得為了下載擅自建立使用者未設定的模型目錄）。
4. 選「註冊順序中第一個存在且可寫」的目錄；不硬編碼 `models/loras`，也不要求一定要 `[0]`。
5. 對**所有有效路徑**（不限選中的目錄）做同名檔檢查（Windows 不分大小寫）；任一存在 → `NAME_CONFLICT`。
6. 寫入前以 `os.path.realpath()` + `commonpath()` 確認最終路徑仍在選中目錄內，阻擋 symlink/junction 逃逸。
7. 沒有可用目錄 → `NO_WRITABLE_LORA_DIR`，白話：「找不到可使用的 ComfyUI LoRA 目錄，請先啟動 ComfyUI 後再試」。
8. B／C 級一律不下載，不猜路徑。

---

## 6. Windows 檔名與路徑安全規格

### 6.1 拒絕（fail closed）

**原始輸入先檢查，絕對不可以先做路徑剝除：**

- API 回傳的原始檔名只要包含 `/` 或 `\` → **直接拒絕**。
  **不可先呼叫 `os.path.basename()`／`ntpath.basename()` 再接受檔名**；
  那會把 `..\evil.safetensors`、`a/b.safetensors` 當成合法，掩蓋路徑穿越企圖。
- 任何 `:`（磁碟機路徑、UNC、NTFS Alternate Data Streams）→ 拒絕。
- 非法字元：`< > " | ? *` 及所有控制字元（ord < 32 或 127）→ 拒絕。
- 相對路徑元件 `.`、`..` 若出現在原始輸入中 → 拒絕（不可靠剝除掩飾）。
- 尾端空白或句點（`name != name.rstrip(" .")`）→ 拒絕（Windows 會自動改檔名）。
- Windows 保留名稱（取第一個 `.` 前的 stem，大寫比對）：`CON`、`PRN`、`AUX`、`NUL`、
  `CONIN$`、`CONOUT$`、`COM1`–`COM9`、`LPT1`–`LPT9`，含 `CON.txt` 形式 → 拒絕。
- 清理後為空（含只有副檔名 `.safetensors`）→ 拒絕。
- 副檔名不是 `.safetensors`（不分大小寫）→ 拒絕；不接受 `.exe`／`.bat`／`.dll`／`.zip` 等。
- 檔名 > 200 字元 → 拒絕；**最終完整目的地路徑 > 259 字元也要拒絕**（不可只驗檔名）。
- 上標保留名稱也必須拒絕：`COM¹`、`COM²`、`COM³`、`LPT¹`、`LPT²`、`LPT³`
  （測試用 `chr(185)`／`chr(178)`／`chr(179)` 產生，避免終端編碼問題）。
- Unicode NFC 正規化後與其他有效路徑中的檔案名稱碰撞（不分大小寫）→ 拒絕。

### 6.2 安全轉換（可測試）

- **第一步就對原始輸入做 6.1 的路徑分隔符與控制字元檢查**，通過後才進行正規化。
- `unicodedata.normalize("NFC", raw_name)`；**不呼叫 `os.path.basename()`**。
- 若前後有空白或非尾端空白，`strip()` 後重新跑 6.1 全部檢查；
  原本尾端是空白或句點仍先按 6.1 拒絕。
- 轉換後重新跑 6.1 全部檢查；任一失敗即拒絕。
- 成功後以轉換名稱作為唯一寫入名，並重新檢查同名衝突。

### 6.3 可測試案例

**拒絕（含路徑穿越，即使 basename 看起來合法）**：
`a/b.safetensors`、`..\x.safetensors`、`C:\x.safetensors`、`\\server\share\x.safetensors`、
`x:s.safetensors`、`CON.safetensors`、`LPT9.safetensors`、`x .safetensors`、
`x..safetensors`、`x.exe`、`x.txt`、`""`、超長名稱、NFC 碰撞、`x\u0000.safetensors`、
`dir\..\ok.safetensors`（basename 是 `ok.safetensors` 但仍必須拒絕）。

**接受**：`mother_lora.safetensors`、`角色-v2.safetensors`（NFC 正規化後不變）、
`MODEL.SAFETENSORS`（副檔名不分大小寫）。

**轉換**：NFC 未正規化形式 → 正規化後接受；檔名前後空白（非尾端句點）→ trim 後接受。

---

## 7. Civitai primary file 與 CDN 安全規格

### 7.1 API 與 primary file

- 使用者操作入口只有整數 `versionId`（`^\d+$`，長度上限）；不接受 URL、檔名或路徑。
- 後端呼叫官方 full endpoint `/api/v1/model-versions/{id}` 與 mini `/api/v1/model-versions/mini/{id}`；
  兩者都**不走 `_civitai_cache`**，避免匿名／授權結果混用。
- full endpoint 中必須**恰好一筆** `primary === true`；0 或多筆 → `METADATA_AMBIGUOUS`。
- 該筆必須提供：`id`（fileId）、`name`、`sizeKB`、`hashes.SHA256`（64 hex）、
  `downloadUrl`；任一缺失或格式錯誤 → `METADATA_INVALID`。
- 自行構造下載 URL：`https://civitai.com/api/download/models/<versionId>?fileId=<fileId>`；
  API 的 `downloadUrl` 只做交叉核對（host/path/query 必須一致），不可直接信任並使用。
- mini 的 `fileName`、`SHA256`、`requireAuth`、`checkPermission`、`availability`、
  `earlyAccessEndsAt` 與 full 不一致 → `METADATA_MISMATCH`。
- 【未驗證】官方文件未保證 `primary` 永遠恰好一筆，因此以 fail closed 處理。

### 7.2 授權與錯誤

- 匿名公開搜尋／Checkpoint 查詢維持 `_civitai_get()` 預設 `auth=False`，**不得因 Key 已設定而自動帶 Bearer**。
- 只有以下操作使用 Key：Key 測試、`requireAuth=true` 時的版本 metadata、需要授權的下載請求。
- 錯誤映射：
  - `requireAuth=true` 且無 Key → `KEY_REQUIRED`
  - 401 → `KEY_INVALID`（金鑰無效／已撤銷）
  - 403 → `NO_PERMISSION`（可能 gated／paid／Private，**不可說成 Key 無效**）
  - `earlyAccessEndsAt` 非空 → `GATED`
  - 404 → `MODEL_NOT_FOUND`
  - 429 → `RATE_LIMITED` + `retryAfter`
  - 5xx → `CIVITAI_SERVER_ERROR`
  - 網路失敗 → `CIVITAI_OFFLINE`

### 7.3 CDN 與 SSRF

精確 allowlist（**不是永久完整清單**，未來改變需更新程式）：
- 初始：$`https://civitai.com/api/download/models/<digits>?fileId=<digits>`$，精確 host `civitai.com`。
- Redirect 只接受：
  1. `b2.civitai.com`
  2. `civitai-delivery-worker-prod.5ac0637cfd0766c97916cefa3764fbdf.r2.cloudflarestorage.com`
- 明確不接受 `*.civitai.com`、任意 `*.r2.cloudflarestorage.com`、其他第三方網域。
- 每一跳驗證：https、host 精確比對、port 未指定或 443、無 userinfo、非 IP literal。
- DNS：`getaddrinfo` **所有** IP 必須公開；拒 loopback／unspecified／link-local（含 169.254.169.254）／RFC1918／ULA／CGNAT 100.64/10／multicast／reserved；IPv4-mapped IPv6 先取下層 IPv4 再檢查。
- DNS rebinding：解析後釘選公開 IP 連線，但以原 hostname 做 SNI 與憑證驗證、Host header 保持原 hostname；禁用 proxy 避免繞過 IP 檢查。【推論】
- Authorization **只送初始 civitai.com**；CDN 一律不帶 Authorization／Cookie。
- Redirect 上限 5 跳；visited set `(scheme, host, port, path)` 重複 → `TOO_MANY_REDIRECTS`。
- 未知 Host → `UNSAFE_REDIRECT` fail closed；signed query 不進 log／前端／錯誤訊息。

---

## 8. 下載流程、API、狀態與錯誤代碼

### 8.1 流程

1. `POST /api/civitai/download/start` `{versionId}` → 驗證同源、解析 metadata、驗證路徑等級 A、
   檢查所有有效 LoRA 路徑同名、建立唯一 task。
2. 背景 daemon thread 執行：初始化 GET → 逐跳 redirect → 200 後串流寫 `.part` →
   SHA256／大小驗證 → `os.rename()` 原子改名。
3. 前端 `GET /api/civitai/download/status` 輪詢進度；完成後呼叫 `refreshLoraList(true)`。
4. `POST /api/civitai/download/cancel` 設定 cancel event；worker 在下一 chunk 檢查並清理。

### 8.2 檔案完整性

- `.part` 命名：`<safe_name>.<task_id>.part`，`open(path, "xb")` 獨佔建立；已存在 → 安全失敗。
- `Content-Type: text/html` → `BAD_CONTENT_TYPE`；接受 `application/octet-stream` 或缺少。
- `Content-Disposition` basename 與 API 檔名不符 → `FILENAME_MISMATCH`；缺少則用 API 檔名。
- `Content-Length` 與 `sizeKB*1024` 用 `Decimal` 比較，容忍 1 KB 或 0.1%（取較大）；不符 → `SIZE_MISMATCH`；缺少 header 仍下載但強制 byte cap。
- byte cap：`min(expected*1.05, expected + 64MB)`；超過 → `SIZE_MISMATCH`。
- SHA256：以實際 `.part` 位元組計算（`_hash_stream()`），與 API 值 case-fold 比對；不符 → `SHA_MISMATCH` 並刪 `.part`。
- 最終改名用 `os.rename()`；Windows 目的檔存在會拋 `FileExistsError`（Python 官方文件）→ `NAME_CONFLICT`，**不得用 `os.replace()`**。
- 所有失敗／取消／逾時路徑在 `finally` 只清**本次 task 自己建立的 `.part`**。
- 異常終止殘留：server 啟動時只清符合本功能命名格式、位於有效 LoRA 目錄內、超過 24h 的 `.part`；不刪其他檔案。

### 8.3 Timeout／磁碟

- 連線／header timeout 30 秒。
- 讀取 timeout 10 秒；每個 chunk 後檢查 cancel，取消 latency ≤10 秒。
- inactivity 60 秒 → `TIMEOUT`。
- 整體期限 `max(30min, expected_bytes / 256KB/s)`，上限 6 小時。
- 下載前 `shutil.disk_usage(target)` 檢查可用空間 ≥ `size*1.2 + 200MB`；串流中每 64MB 重查；不足 → `DISK_FULL`。

### 8.4 API 路由（草案）

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/civitai/download/status` | 目前任務狀態（輪詢） |
| POST | `/api/civitai/download/start` | body `{versionId}`，啟動單一任務 |
| POST | `/api/civitai/download/cancel` | 設定取消旗標 |

所有端點沿用 `_key_guard()`（`X-SimpleUI: 1` + Origin 白名單）與 body 大小限制；
GET status 也套用同源保護，避免本機狀態外洩。

### 8.5 任務狀態欄位

`id`、`state`（`queued`／`downloading`／`verifying`／`done`／`error`／`cancelled`）、
`versionId`、`fileName`、`bytes`、`total`、`percent`、`code`、`error`、
`pathGrade`（A/B/C）、`startedAt`、`finishedAt`。
**不含** signed URL、Key、Authorization、絕對路徑或任何敏感 header。

### 8.6 錯誤代碼表

`KEY_NOT_SET`、`KEY_REQUIRED`、`KEY_INVALID`、`NO_PERMISSION`、`GATED`、
`MODEL_NOT_FOUND`、`RATE_LIMITED`、`CIVITAI_SERVER_ERROR`、`CIVITAI_OFFLINE`、
`METADATA_AMBIGUOUS`、`METADATA_INVALID`、`METADATA_MISMATCH`、
`UNSAFE_REDIRECT`、`TOO_MANY_REDIRECTS`、`BAD_CONTENT_TYPE`、`FILENAME_MISMATCH`、
`SIZE_MISMATCH`、`NO_SHA256`、`SHA_MISMATCH`、`FILENAME_INVALID`、
`NO_WRITABLE_LORA_DIR`、`NAME_CONFLICT`、`PATH_UNRELIABLE`、`DISK_FULL`、
`TIMEOUT`、`CANCELLED`、`DOWNLOAD_IN_PROGRESS`、`FORBIDDEN`。

### 8.7 UI 狀態

使用者必須能清楚看到：
- 尚未設定個人 API Key（可匿名搜尋）。
- Key 無效或授權不足（401/403 不同文案）。
- 模型無法下載或尚未開放（gated／Early Access／Paid）。
- ComfyUI 路徑無法可靠確認（B/C 級），因此暫時不能下載。
- 正在下載、進度百分比、失敗原因、完成提示（含刷新後可直接使用）。

UI 只在探索 Modal 增加進度列與按鈕，不新增頁面、不做下載歷史／多工／WS。

---

## 9. 第一版明確不做

OAuth、共用開發者 Key、任意 URL 下載器、任意路徑輸入、多檔案選擇、
Range／Resume、多工併發、跨重啟任務恢復、下載歷史、WebSocket 進度、
收藏、Favorites/Hidden 搜尋、修改公開搜尋與既有快取、WD14／Workflow 改動、
新增第三方套件或 Build System。

---

## 10. 尚未解決的問題與風險

1. 【未驗證】PEB 讀取 CWD／EnvironmentBlock 在實際 ComfyUI PID 上未實測（自身 x64 行程實測成功）；
   而且即使讀得到，也**不保證等於啟動時的值**，必須靠「路徑全絕對、無環境變數展開」證明無關，否則 fail closed。
2. 【未驗證】目前服務已關閉，A 級 live 路徑還原無法驗證；Phase B 開始前需確認環境。
3. 【未驗證】兩個 CDN Host 是否為完整清單；Host 改變需人工更新 allowlist。
4. 【未驗證】`files[].primary` 是否永遠恰好一筆；以 fail closed 處理。
5. 【未驗證】gated／paid／Early Access 的 redirect 與 requireAuth 實際行為。
6. 【未驗證】API SHA256 是否等於實際位元組（未下載模型）。
7. 【推論】DNS pinning 的 stdlib 自訂 HTTPSConnection 需仔細驗證 SNI／憑證／Host header。
8. 多目錄同名一律拒絕，對進階使用者可能不便。
9. ComfyUI 改版可能改變 `apply_custom_paths()` 或 PEB 結構，需相容性測試。

---

## 11. 後續 Phase B 實作拆分與建議驗收

**B1：路徑解析器（server.py + 新隔離測試）**
- 產出 A/B/C 分級與完整路径 JSON；不下載。
- 驗收：mock process/mock WMI/mock PEB／子程序輸出；shlex 對照測試；多目錄／同名／不存在目錄案例；B/C 必 fail closed。

**B2：metadata + 下載核心（server.py + mock Civitai 測試）**
- primary 唯一性、URL 自行構造、精確 allowlist、逐跳 redirect、DNS/IP、`.part`、SHA、原子改名、取消。
- 驗收：200/401/403/429/5xx/網路；307 到允許與不允許 Host；loop/5 跳；SHA 不符；同名競態；取消清理；-byte cap。

**B3：前端 UI（index.html/app.js/app.css）**
- 下載按鈕、進度列、取消、錯誤文案、完成刷新。
- 驗收：無 localStorage／URL 外洩 Key；版面不捲動；既有探索測試全過；Console 0 錯誤。

**B4：整合與文件**
- 使用者指南（風險、撤銷、entitlement）、完整隔離測試、`git diff --check`、語法檢查。

---

## 12. Git 最終狀態、`git diff --check`

- Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、Remote `origin`、ahead/behind `1/0`。
- tracked modified **12**（不變）；untracked **33**（原 32 + 本報告）；staged 0。
- 結束時 `git diff --check` 無輸出。
- 未執行任何 Git 寫入或清理。

---

## 13. 正式服務是否受到影響

**沒有。** 7860／8188 本輪開始即未監聽（使用者已手動關閉），結束時亦未監聽；
本輪未啟動、停止或重啟任何服務，未修改設定或模型目錄。

---

## 14. 需要 ChatGPT 特別審查的設計決策

1. 是否接受「只有 A 級可下載，B/C 級 fail closed」；B 級是否應完全禁止。
2. 是否接受精確兩個 CDN Host，以及 Host 改變時需更新程式。
3. 是否接受 PEB 讀取**當下** CWD／EnvironmentBlock，並要求「所有相關路徑絕對且無 env 展開」
   才允许 A 級；此設計會讓使用 `%VAR%` yaml 的設定直接 fail closed。
4. 是否接受 `os.rename()` 做 Windows race-safe 原子改名（不用 `os.replace()`）。
5. 是否接受沒有 SHA256 就停止，以及 `primary` 不唯一就停止。
6. 是否接受 `max(30min, size/256KB/s)`、上限 6h 的整體期限。
7. 是否接受在任何有效 LoRA 路徑已有同名檔就拒絕。
8. 目前服務關閉是否代表 B1 应先在隔離 mock 完成，暫不做 live 驗證。
9. **R1**：是否接受「重建最多 B、`usable=false`，A 必須另有 live 驗證來源」；B2 是否應暫緩。
10. **R1**：是否接受把 ComfyUI 既有 `/internal/folder_paths`（`api_server/routes/internal/internal_routes.py:47–52`）
    當作 live 驗證來源；該端點原始碼註明「不應依賴」，需 ChatGPT 決定是否承擔相容風險。
11. **R1**：是否接受 WMI `ExecutablePath` + PEB `ImagePathName` + argv[0] + 再次 WMI 身分比對
    作為唯一候選行程的條件。
12. **R2**：是否接受「CommandLine 不可讀即未知候選 fail closed」與「兩次 snapshot 的
    ExecutablePath 都強制驗證」；這會讓部分資訊不完整環境完全無法使用解析器。

---

## 15. 完成陳述

Phase B-1 規格定稿完成，立即停止。**沒有開始 Phase B 程式實作**，
沒有修改任何程式碼／設定／使用者資料，沒有重啟服務，沒有 Git 寫入，
既有工作區修改完整保留。
