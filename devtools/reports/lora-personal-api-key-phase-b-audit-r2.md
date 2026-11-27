# Civitai Personal API Key — Phase B-0 R2 路徑與下載安全設計補充調查

> 本輪為唯讀補充調查與設計驗證；唯一工作區寫入是本報告。沒有修改程式碼／設定／使用者資料，
> 沒有建立或修改模型目錄，沒有下載模型或讀取模型內容，沒有重啟服務，沒有 Git 寫入，
> 沒有 `codegraph sync`，沒有覆蓋既有報告。

標記：【本機驗證】／【官方文件】／【實際探測】／【推論】／【未知】

---

## 1. Repository、Branch、HEAD、Remote、開始及結束 Git 狀態

| 項目 | 值 |
|---|---|
| Repository 根目錄 | `C:/ComfyUI/simple_ui` |
| Branch | `main...origin/main [ahead 1]`（ahead/behind `1/0`） |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| 開始 tracked modified | **12** |
| 開始 untracked | **31** |
| staged | 0 |
| 開始 `git diff --check` | 無輸出 |
| 目標報告 | 開始時不存在，無覆蓋衝突 |

結束狀態見第 10 節。已重新閱讀 `C:\ComfyUI\AGENTS.md` 與 `C:\ComfyUI\simple_ui\AGENTS.md`。
先執行 `codegraph status`（35 files / 1094 nodes / 4837 edges，Pending Changes: Added 2, Modified 2），
再執行 `codegraph explore "folder_paths _local_checkpoint_size loras get_full_path"` 與
`codegraph explore "_civitai_get download sha256 redirect"`；依指示未 sync。
ComfyUI `main.py`／`folder_paths.py` 不在本專案索引內，故用 `read`／`grep` 直接讀取。

---

## 2. 設備與正式服務 PID（重要變化）

【本機驗證】設備 `DESKTOP-ADPHHAP`。

**本輪開始時，7860／8188 沒有監聽，且查不到任何 `python.exe`／`pythonw.exe` 行程。**
先前幾輪觀察到的 ComfyUI PID 12196（`...python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --output-directory D:\ComfyUI_output`）
與 simple_ui PID 13424（`...python_embeded\python.exe C:\ComfyUI\simple_ui\server.py`）
本輪已不存在。`netstat -ano` 亦無 ':7860'／':8188'。

依任務限制，**不得重啟或停止服務**，因此本輪不嘗試恢復服務；
所有需要 live ComfyUI process 的驗證只能依賴先前記錄的 CommandLine 與靜態原始碼，
並明確標記「目前無 live process」。這也使「讀取指定 PID 的 CWD／環境變數」只能做 API 可行性驗證
（在本機自身行程上），不能在正式 ComfyUI PID 上實測。

---

## 3. ComfyUI 有效 LoRA 路徑還原方案

### 3.1 Windows 取得 CWD／環境變數【本機驗證】

- WMI `Win32_Process` **不提供**目前工作目錄，也不提供環境變數；只有 CommandLine／ExecutablePath／ProcessId。
- `.NET Process.StartInfo.WorkingDirectory` 對外部行程不可靠（僅適用自己啟動的 process）。
- 可行做法（唯讀）：`OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ)` →
  `NtQueryInformationProcess(ProcessBasicInformation=0)` 取得 PEB →
  `ReadProcessMemory(PEB+0x20)` 取得 `RTL_USER_PROCESS_PARAMETERS` →
  其 `+0x38` 的 `CURDIR` 含目前目錄 UNICODE_STRING，`+0x80` 為環境區塊指標。
- 本輪以 ctypes 對**自身 Python 行程**實際驗證：讀到 `cwd=C:\ComfyUI\`，
  環境 block 含 `PATH=`、`LOCALAPPDATA=`。全部操作唯讀，未寫入目標行程。
- 環境區塊格式為一連串 `KEY=VALUE\0`，最後一個額外 `\0`；解析時只取出需要的 key，
  **不可 log 整塊**（可能含使用者 API Key／憑證），直接作子程序 `env=` 傳入。

交叉限制【推論／官方 API 語意】：
- 32/64 位元：上述偏移是 x64。若目標是 WOW64（32-bit）行程，
  須先 `NtQueryInformationProcess(ProcessWow64Information=26)` 判斷，
  並改用 32-bit PEB／RTL 偏移；本輪未實作 32-bit 路徑。
- 本專案觀察到 ComfyUI 與 simple_ui 都用同一顆 x64 embedded Python；
  一般自架若混合位元，**必須 fail closed**（白話告知無法可靠讀取），不可猜偏移。
- 權限：需 same-user 或較高完整性層級；`OpenProcess`/`ReadProcessMemory` 可能 AccessDenied → fail closed。
- PID 可能被回收：讀取前後都要再核對 CommandLine 與 ExecutablePath 仍相符。

### 3.2 Windows argv 解析【本機驗證】

使用 `shell32.CommandLineToArgvW`（Windows 官方解析器），不可用 `shlex.split()` 代替。

實測字串 `prog.exe -s "C:\path with space\main.py" --output-directory D:\out --feature "a b"`：

| 解析器 | 結果 |
|---|---|
| `CommandLineToArgvW` | `['prog.exe','-s','C:\path with space\main.py','--output-directory','D:\out','--feature','a b']` |
| `shlex.split(..., posix=False)` | 保留引號（`'"C:\path..."'`），錯誤 |
| `shlex.split(..., posix=True)` | `D:\out` → `D:out`，反斜線被吃掉，錯誤 |

結論：**必須用 `CommandLineToArgvW`** 解析 WMI 取得的 CommandLine。

### 3.3 相對路徑與 yaml 規則【本機驗證／讀碼】

- `folder_paths.py:15–23`：`base_path` 預設為模組所在目錄；
  `--base-directory`／`--models-directory` 用 `os.path.abspath()` → **相對於 ComfyUI process 的 CWD**。
- `main.py:156–159`：`--output-directory` 亦 `os.path.abspath()` → 相對於 ComfyUI CWD。
- `utils/extra_config.py:9–19`：`yaml_dir = dirname(abspath(yaml_path))`；
  `base_path` 經 `expandvars()` + `expanduser()`，若相對則以 **yaml 檔所在目錄**為基準；
  個別資料夾路徑若沒有 base_path，也以 yaml_dir 為基準（`30–31`）；最後 `normpath()`。
  注意：**只有 `base_path` 做環境變數展開**，個別 folder 字串不展開。
- `main.py:137–145`：先載 ComfyUI 根目錄 `extra_model_paths.yaml`（若存在），
  再依 `itertools.chain(*args.extra_model_paths_config)` 順序載入每份 yaml；
  `cli_args.py:71` 定義 `--extra-model-paths-config` 為 `nargs='+', action='append'`。
- `add_model_folder_path()`（`folder_paths.py:382–398`）：
  已存在則 append；`is_default=True` 時移到 list[0]；不存在則建立新 list。
  因此多份 yaml 的載入順序會影響路徑順序，且 `is_default` 可覆寫順序。
- 環境變數展開用的是**執行載入的行程**的環境（即 ComfyUI process），不是 simple_ui 的環境。

### 3.4 可靠性分級與降級

| 等級 | 條件 |
|---|---|
| **A：能可靠還原** | 找得到 ComfyUI process；CommandLine 用 `CommandLineToArgvW` 解析；PEB CWD／環境可讀且與 simple_ui 同為 x64；子程序以相同 argv + CWD + env 執行；未 import `main.py`。 |
| **B：僅明確條件下還原** | process 可見但 bitness 不同或 env 只部分可讀；需額外處理 WOW64 偏移，或只還原 argv 而 CWD 用 `ExecutablePath` 的目錄推斷（需向使用者明確說明）。 |
| **C：無法可靠還原** | 看不到 ComfyUI process（**本輪現況**）、AccessDenied、PID 失效、PEB 讀取失敗、子程序輸出格式錯誤。 |

**安全降級（必須）**：
- 不得默默回退硬編碼 `models/loras`。
- 不得宣稱「獨立 import = live runtime」（本機已證明兩者 loras 清單不同）。
- C 級直接停止下載，回白話：「找不到正在執行的 ComfyUI，無法安全確認模型目錄；請啟動 ComfyUI 後再試。」
- 不要求一般使用者改 Python 程式碼；也不提供任意路徑輸入。

### 3.5 對上一輪建議的接受／修正

- **接受**：WMI 找 process + 子程序重現 `apply_custom_paths()` 的核心方向。
- **修正**：
  1. 補上 PEB CWD 與環境讀取（含 x64 驗證、bitness/access fail closed）。
  2. argv 解析改 `CommandLineToArgvW`，不用 `shlex.split()`。
  3. 子程序必須用讀到的 cwd 作為 `cwd=`、讀到的 env 作為 `env=`（不是繼承 simple_ui 環境）。
  4. 找不到 process 時不得降級成硬編碼或獨立 import，改為停下來白話提示。
- **否決**：直接 `get_folder_paths()[0]` 作為唯一 target（見第 4 節）。

---

## 4. 多個 LoRA 目錄的搜尋優先順序

【本機驗證／讀碼】

- `get_folder_paths("loras")`（`folder_paths.py:400–402`）回註冊順序的 list。
- `add_model_folder_path()`（`382–398`）：append；`is_default=True` 才移到前面。
- `get_full_path("loras", filename)`（`450–467`）：**依序遍歷所有路徑，回第一個 `os.path.isfile()` 命中**；
  所以前面的同名檔會遮蔽後面的。
- `recursive_search()`（`404–406`）：`if not os.path.isdir(directory): return [], {}`；
  已註冊但目錄不存在時會被略過，建立目錄後即可被掃到。
- `get_filename_list()`（`519–527`）搭配 cache（`493–517`）：
  `cached_filename_list_()` 檢查每個已記錄目錄的 mtime，
  若某目錄從不存在變成存在（`x not in out[1]`）→ cache 失效並重掃。
  因此**建立先前不存在的已註冊目錄是足以讓 ComfyUI 辨識的**。
- `/models/loras`（`server.py:415–420`）就是呼叫 `get_filename_list("loras")`。

結論：
1. 同名檔：第一個註冊且實際存在的路徑勝出。
2. 第一路徑不存在：仍會繼續搜尋後續路徑。
3. 下載到後面目錄可能被前面同名檔遮蔽 → **寫入前必須檢查所有有效路徑是否已有同名檔**。
4. 建立已註冊但不存在的目錄足以讓 ComfyUI 辨識。
5. 多目錄同名不同內容會混淆，第一版採「任何有效路徑已有同名檔就拒絕」。

第一版建議【推論】：
- 由子程序回傳完整有效 loras 路徑（不只是 `[0]`）。
- 過濾出「存在且可寫」的路徑；若無 → `NO_WRITABLE_LORA_DIR`。
- 對**所有**有效路徑檢查目標檔名；任一存在 → `NAME_CONFLICT`，不覆寫。
- 寫入其中一個可寫路徑（建議第一個可寫者），寫完可用子程序再問一次
  `get_full_path("loras", name)` 是否指向此次寫入檔（可選驗證）。
- 不寫到 ComfyUI 未註冊的位置。

---

## 5. CDN Host allowlist 收緊

【實際探測】先前兩輪觀測到兩個 Host：

1. `b2.civitai.com`（28907，HEAD 與 GET 第一跳都是 307）
2. `civitai-delivery-worker-prod.5ac0637cfd0766c97916cefa3764fbdf.r2.cloudflarestorage.com`（135867）
   DNS 4 個公開 IP。

【官方文件】官方 CLI `isTrustedDownloadHost` 信任 `civitai.com` 與任意 `*.civitai.com`
（https://raw.githubusercontent.com/civitai/cli/main/pkg/civitai/download.go），
但那是 CLI 的較大信任範圍，不代表本專案第一版必須跟進。

**對上一輪建議的修正**：

| 項目 | 上一輪 | 本輪最終建議 |
|---|---|---|
| `*.civitai.com` | 建議放行 | **收緊為精確 `b2.civitai.com`**；不必要的 wildcard 不放行 |
| R2 | regex 接受任意 32 hex | **改成已觀測到的精確完整 Host**；不接受任意 hex |
| 初始 host | `civitai.com` | 保留精確 `civitai.com` |

最終 allowlist（第一版）【推論】：
- 初始：$`https://civitai.com/api/download/models/<digits>?fileId=<digits>`$，精確 host `civitai.com`、https、443/無 port、無 userinfo；只此跳帶 Bearer。
- Redirect target 只接受兩個精確 Host：
  - `b2.civitai.com`
  - `civitai-delivery-worker-prod.5ac0637cfd0766c97916cefa3764fbdf.r2.cloudflarestorage.com`
- 不接受 `*.r2.cloudflarestorage.com`、不接受任意 `*.civitai.com`、不接受其他第三方網域。
- 任何 Redirect 到 allowlist 外 → `UNSAFE_REDIRECT`，fail closed。
- 未來 Host 改變 → 更新程式（或明確審查過的設定），不可自動放寬；錯誤訊息要說「Civitai 的下載主機已改變，請更新生圖介面」而非「帳號無權限」。
- 每一跳（含這兩個 Host）仍要重做 scheme/port/userinfo/DNS/IP 檢查；CDN 一律不帶 Authorization／Cookie；signed query 不進 log／前端／錯誤訊息。

【未知】是否還有第三種 CDN Host；只靠兩個樣本無法保證完整，這是刻意的安全取捨。

---

## 6. 下載完整性與競態細節

【官方文件】model-versions 文件（本輪重新讀取）：
mini 回 `fileName`、`hashes.SHA256`、`downloadUrls[]`、`size`、`requireAuth`、`checkPermission`；
full 回 `files[].id`、`name`、`primary`、`sizeKB`、`hashes.SHA256`、`downloadUrl`（含 `?fileId=`）。

逐項結論【推論，除非標明】：

1. **primary 必須恰好一筆**：api 回 0 或多筆 `primary:true` → `METADATA_AMBIGUOUS` 停止。
   【未知】官方文件未保證永遠恰好一筆，因此第一版以 fail closed 處理。
2. mini/full 的 fileId／檔名／SHA256 不一致 → `METADATA_MISMATCH` 停止，不猜哪個對。
3. `fileId` 必須純數字（`^\d+$`，長度上限），其他形式拒絕；URL 由後端自行構造。
4. 沒有 SHA256 → **停止下載**（`NO_SHA256`），不作「警告後仍下載」。
5. `Content-Type: text/html` → 直接拒絕（`BAD_CONTENT_TYPE`，通常是錯誤頁）；
   只接受 `application/octet-stream` 或缺少該 header（缺少時靠 SHA/size 判）。
6. `Content-Disposition` 缺失：用 API 檔名；若存在且 basename 與 API 檔名不同 → `FILENAME_MISMATCH` 停止。
7. `Content-Length` 與 `sizeKB`：用 `Decimal` 比較，容忍 1 KB 或 0.1%（取較大），差距過大 → `SIZE_MISMATCH`；
   header 缺少時仍下載但強制 byte cap。
8. 實際 byte 上限：`min(expected_bytes * 1.05, expected_bytes + 64MB)`；超過立刻中止並清 `.part`。
9. SHA256 以**實際寫入 `.part` 的位元組**計算（`server.py:2054–2065` `_hash_stream()` 可重用），
   與 API SHA256 case-fold 比對；不符 → `SHA_MISMATCH` 並刪 `.part`。

Windows 檔案競態：
- `.part` 用唯一名稱（含 task id），`open(path, 'xb')` 獨佔建立；已被占用 → 安全失敗，不覆寫。
- 【官方文件】Python `os.rename()` 在 Windows 若 `dst` 已存在，**總是拋 `FileExistsError`**
  （https://docs.python.org/3/library/os.html#os.rename），因此是最終改名的race-safe選擇；
  **不要用 `os.replace()`**（會覆寫）。
- 寫入前檢查所有有效 LoRA 路徑是否已有同名檔（第 4 節）；最終 rename 若遇競態 → `NAME_CONFLICT`，不覆寫。
- 取消／清理：
  - 用 `threading.Event`；HTTP 讀取採短 timeout（建議 10s）並在每個 chunk 後檢查 cancel，
    取消latency ≤10s，不需從外部危險地關 socket。
  - `finally` 只清**本次 task 自己建立的唯一 `.part` 路徑**，不刪其他檔案。
  - 異常終止殘留：server 啟動時只清符合本功能命名格式且在有效 LoRA 目錄內、
    超過 TTL（例如 24h）的 `.part`；不碰其他檔案。

---

## 7. Timeout 與磁碟空間（重新評估）

上一輪建議 30 分鐘／30 秒 header／60 秒 chunk／`sizeKB*1.1+100MB`。本輪結論：

| 項目 | 上一輪 | 本輪建議 | 理由 |
|---|---|---|---|
| 連線／header timeout | 30s | 保留 30s | 正常連線應快速回應 |
| chunk read timeout | 60s | **10–15s** | 60s 讓取消太久；10–15s 仍能容忍家庭網路短暫停頓 |
| 總時限 | 固定 30 分鐘 | ** inactivity 60s + 動態上限**：`max(30min, expected_bytes / 256KB/s)`，上限 6h | 30 分鐘對慢速網路的大 LoRA 不合理；但仍不能無限掛住 |
| 磁碟 | `size*1.1+100MB` | 提高到 `size*1.2 + 200MB`，並在串流中每 64MB 重查 | 預留暫存與系統緩衝；避免途中被其他程式吃滿 |

[推論] 取消優先於 timeout；使用者可隨時按取消，不必等 timeout。
所有 timeout 都轉固定 code（`TIMEOUT`／`CANCELLED`），不在前端顯示原始 exception。

---

## 8. 尚未解決的風險

1. **目前無 live ComfyUI process**（第 2 節），因此 A 級路徑還原無法在本輪實測；
   若 Phase B 開始時服務仍不在，下載功能必須 fail closed。
2. x86/WOW64 目標行程的 PEB 偏移未實作；混合位元環境會落在 B/C 級。
3. 只有兩個 CDN Host 樣本；Host 改變時需人工更新 allowlist。
4. `files[].primary` 是否永遠恰好一筆未知，以 fail closed 處理。
5. gated／paid／Early Access 的下載 redirect 与 requireAuth 行為仍未實測。
6. API SHA256 是否等於實際位元組仍未驗證（本輪未下載）。
7. 多目錄同名檔的處理採「全部拒絕」，對少數進階使用者可能不便，但第一版求安全。
8. 子程序重現 apply_custom_paths 的細節若 ComfyUI 改版可能失效，需納入相容性測試。

---

## 9. 未執行的測試及原因

- 在正式 ComfyUI PID 上讀取 CWD／環境：本輪無該 process，且不得啟動第二個 ComfyUI。
- 32-bit/WOW64 PEB 讀取：無目標且未實作。
- 跟隨 CDN Redirect、讀取任何 response body、下載模型：明確禁止。
- 真實 API Key／gated 模型：明確禁止。
- 建立或修改模型目錄：明確禁止。
- 重啟／停止服務、Git 寫入、`codegraph sync`：明確禁止。

【實際執行】AGENTS.md 重讀、`codegraph status` + 2 次 explore、Git/PID/netstat 查詢、
GB 功率低的本機驗證：PEB 自身行程 CWD/env 可讀、`CommandLineToArgvW` vs `shlex` 比較、
ComfyUI `extra_config.py`／`folder_paths.py`／`main.py`／`cli_args.py` 讀碼、
Python `os.rename` 官方文件確認。

---

## 10. `git diff --check` 與最終 Git 狀態

- Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、Remote `origin`、ahead/behind `1/0`。
- tracked modified **12**（不變）；untracked **32**（原 31 + 本報告）；staged 0。
- 結束時 `git diff --check` 無輸出。
- 未執行任何 Git 寫入或清理。

---

## 11. 正式服務是否受到影響

**沒有。** 本輪沒有重啟、停止或干任何服務；7860／8188 本輪開始即未監聽，
結束時亦未監聽（見第 2 節），這是環境現況而非本輪造成。
沒有修改設定、模型目錄或使用者資料。

---

## 12. 需要 ChatGPT 特別審查的項目

1. 是否接受「A/B/C 可靠性分級 + C 級 fail closed」取代上一輪的單一方案。
2. 是否接受精確兩個 CDN Host（不放 wildcard）作為第一版 allowlist，以及 Host 改變的更新流程。
3. PEB 讀取 CWD／env 是否值得第一版就做，還是先限制為「同位元、同使用者」A 級才允許。
4. 動態總時限 `max(30min, size/256KB/s)` 上限 6h 是否合理。
5. 「任何有效路徑已有同名檔就拒絕」是否過嚴。
6. `.part` TTL 清理是否應放在模型目錄（為原子改名）還是另找工作目錄。
7. 目前服務不在是否代表 Phase B 不應開始；建議 ChatGPT 先確認環境。

---

## 13. 完成陳述

Phase B-0 R2 補充調查完成，立即停止。沒有開始 Phase B 實作，沒有修改任何程式碼或設定，
沒有下載模型，沒有重啟服務，沒有 Git 寫入，既有工作區修改完整保留。
