# Civitai Personal API Key — Phase B-0 R1 補充唯讀調查

> 本輪為唯讀補充調查；唯一工作區寫入是本報告。沒有修改程式碼／設定／使用者資料，
> 沒有下載模型內容，沒有重啟或停止任何服務，沒有 Git 寫入，也沒有 `codegraph sync`。

標記：【官方文件】／【實際探測】／【本機驗證】／【推論】／【未知】

---

## 1. 任務目標與調查範圍

1. 的最高優先級：釐清 ComfyUI **真正的** LoRA 目錄，比較 simple_ui 獨立 import 與 ComfyUI live runtime 的差異，提出適合一般自架使用者的最小可靠方案。
2. 補充 Civitai 下載 Redirect 探測：使用 mini endpoint 實際回傳、含 `fileId` 的 URL，以 GET 關閉自動 Redirect，只記録第一個 response header；確認是否出現 R2 delivery host。
3. 補充下載安全設計：DNS/IP pinning、proxy、redirect loop、CNN 錯誤分類、Windows 檔名與同名競態、timeout／磁碟空間等。

明確維持產品範圍：primary file、單一任務、簡單進度、可取消、正確 LoRA 目錄、SHA256、`.part`、原子改名、失敗清理、同名保護、完成刷新清單；不擴張成通用下載管理器。

---

## 2. 開始時 Repository、Branch、HEAD、Remote、Git 狀態

| 項目 | 值 |
|---|---|
| Repository 根目錄 | `C:/ComfyUI/simple_ui` |
| Branch | `main...origin/main [ahead 1]`（ahead/behind `1/0`） |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| tracked modified | **12** |
| untracked | **30** |
| staged | 0 |
| 目標報告 | 開始時不存在，無覆蓋衝突 |

開始時 `git diff --check` 無輸出。既有 12 tracked modified 與 30 untracked 全部保留。

CodeGraph：先執行 `codegraph status`，顯示 35 files / 1094 nodes / 4837 edges，
**Pending Changes: Added 2, Modified 2**；依指示不同步。再以
`codegraph explore "folder_paths _local_checkpoint_size loras _comfy_get_json"` 與
`codegraph explore "_civitai_get _civitai_auth_allowed download sha256"` 查詢。
explore 回傳的是重新從磁碟讀取的原始碼（非過期 cache）；ComfyUI `main.py` 不在本專案索引內，
故用 `read`/`grep` 直接讀取該檔案，未大量 grep 或整檔輸出。

已重新閱讀 `C:\ComfyUI\AGENTS.md` 與 `C:\ComfyUI\simple_ui\AGENTS.md`。

---

## 3. 設備與服務 PID

【本機驗證】

| 服務 | PID | Process | CommandLine |
|---|---|---|---|
| ComfyUI | **12196** | `python.exe`（`C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe`） | `-s ComfyUI\main.py --windows-standalone-build --output-directory D:\ComfyUI_output` |
| simple_ui | **13424** | 同一顆 embedded `python.exe` | `C:\ComfyUI\simple_ui\server.py` |

設備 `DESKTOP-ADPHHAP`；7860／8188 仍監聽。兩者 **是不同 PID、不同行程**，
即使可執行檔相同，也不能假設 `folder_paths` module-level 狀態一致。

正式 ComfyUI 啟動參數只有：`--windows-standalone-build`、`--output-directory D:\ComfyUI_output`。
**沒有** `--base-directory`、`--models-directory`、`--extra-model-paths-config`。
ComfyUI 根目錄沒有 `extra_model_paths.yaml`（只有 `.example` 與 `tests/execution/` 下的測試檔）。

---

## 4. ComfyUI 真正路徑初始化流程

【本機驗證／讀碼】

- `main.py:239` 呼叫 `apply_custom_paths()`（在 `governance.initialize()` 之後、`init_mime_types()` 之前）。
- `apply_custom_paths()`（`main.py:137–167`）依序：
  1. `139–141`：若 ComfyUI 根目錄有 `extra_model_paths.yaml`，
     呼叫 `utils.extra_config.load_extra_path_config()`。目前檔案不存在 → 無影響。
  2. `143–145`：若 `args.extra_model_paths_config`（`--extra-model-paths-config`），逐一載入。目前無此參數。
  3. `147–153`：`--base-directory`／`--models-directory` 只寫 log；
     實際改變路徑的是 `folder_paths.py:15–23` 在 **import 時**讀 `comfy.cli_args.args`。
  4. `155–159`：若有 `--output-directory`，`os.path.abspath()` 後
     `folder_paths.set_output_directory(output_dir)`（`folder_paths.py:123–125`，只設定全域字串，不建目錄）。
  5. `161–167`：不管有沒有 output dir，都呼叫
     `folder_paths.add_model_folder_path("loras", os.path.join(folder_paths.get_output_directory(), "loras"))`
     （`folder_paths.py:382–398`，append 到 list）。同時也為 checkpoints/clip/vae/diffusion_models 加路徑。
- `folder_paths.get_folder_paths("loras")`（`folder_paths.py:400–402`）回
  `folder_names_and_paths["loras"][0][:]`，**可能是多筆**；`add_model_folder_path` 預設 append（不是 default），
  所以 canonical `models/loras` 仍是第一筆，output-dir loras 是第二筆。
- `comfy/cli_args.py:287–290`：`comfy.options.args_parsing` 预设 **False**，
  因此 `args = parser.parse_args([])`——**一般 import `folder_paths` 會忽略所有 CLI 參數**；
  `main.py` 在 import CLI args 前呼叫 `comfy.options.enable_args_parsing(True)`。

### A/B/C 比較【本機驗證】

| 狀態 | loras 路徑 |
|---|---|
| A. simple_ui 行程內獨立 `import folder_paths`（對應 `server.py:1034–1081` 的模式） | `C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\models\loras`（只有一筆） |
| B. 重現 live runtime（`set_output_directory(D:\ComfyUI_output)` + `add_model_folder_path('loras', ...)`） | `C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\models\loras` + `D:\ComfyUI_output\loras`（兩筆；第二筆目前不存在、不可寫） |
| C. 實際 CommandLine + `extra_model_paths.yaml` 影響 | 只有 `--output-directory` 造成第二筆；無 base/models/extra config 參數，無 yaml |

B 是以 ComfyUI 自己的 Python、只 import `folder_paths`（**不 import `main.py`、不啟動第二個 ComfyUI**）
重現 `apply_custom_paths()` 的路徑變更後讀到；兩行程 PID 不同這點已納入考量。
另測得：單純設 `sys.argv` 仍不夠，必須先 `comfy.options.enable_args_parsing(True)`，
`cli.args.output_directory` 才會是 `D:\ComfyUI_output`。

> 副作用發現：`server.py:1034–1081` 的 `_local_checkpoint_size()` 用獨立 import，
> 因此目前 Checkpoint 大小辨識也只看到 canonical 目錄，看不到 output-dir 的 checkpoints。
> 本輪不修改，僅列為風險。

### 第一版建議方案【推論】

1. 用唯讀 WMI（`Get-CimInstance Win32_Process`）找出 ComfyUI 行程：
   以 `python/pythonw` + CommandLine 包含 `main.py` 且**完整路徑比對** ComfyUI 安裝根，
   避免誤命中其他專案；取得完整 argv。
2. 用**同一顆 ComfyUI Python executable** 起一個短命子程序（`subprocess`，`CREATE_NO_WINDOW`）執行：
   - `sys.argv = <從 ComfyUI process 解析出的 argv>`
   - `comfy.options.enable_args_parsing(True)`
   - `import folder_paths`、`from utils import extra_config`
   - 重現 `apply_custom_paths()` 中**只改路徑的部分**（讀 yaml、載 extra config、`set_output_directory`、為 loras 加 output-dir 路徑）
   - 以 JSON 印出 `get_folder_paths("loras")`，父行程解析。
   - **不 import `main.py`、不初始化 GPU、不寫任何目錄。**
3. 從回傳清單中挑「存在且可寫」的第一筆（不是盲目 `[0]`；本機 B 的第二筆不存在）；
   若全部不存在或不可寫，白話報錯「找不到可寫入的 ComfyUI LoRA 目錄」，**不回退到硬編碼路徑**。
4. 若找不到 ComfyUI 行程或子程序失敗，降級為「目前 Python 獨立 import + 明確提示可能缺少自訂路徑」，
   但不能假設與 live runtime 相同。
5. 不硬編碼 `models/loras`；相容於其他使用者把 ComfyUI 裝在別處、用 `--models-directory`、
   `--base-directory`、`extra_model_paths.yaml` 的情況。

---

## 5. simple_ui 獨立 import 與 ComfyUI live runtime 的差異

| 面向 | 獨立 import | live runtime |
|---|---|---|
| 行程 | PID 13424 | PID 12196 |
| CLI 參數 | 被忽略（`args_parsing=False`） | 已啟用 parsing |
| `extra_model_paths.yaml` | 未載入 | `apply_custom_paths()` 會載入 |
| `--output-directory` | 不生效 | `D:\ComfyUI_output`，並追加 `loras` 路徑 |
| loras 路徑數 | 1 | 2（第二筆目前不存在） |
| `get_full_path` 可見性 | 只 canonical | canonical + output dir |

結論：**不能假設兩者相同**。以 live-effective 清單為準，且挑選可用路徑。

---

## 6. Civitai 實際 Redirect 補充探測結果

【官方文件】https://developer.civitai.com/site/reference/model-versions.md

- mini endpoint：`fileName`、`hashes.SHA256`、`downloadUrls[]`、`format`、
  `requireAuth`、`checkPermission`、`availability`、`earlyAccessEndsAt`、`size`。
  官方定義 `requireAuth=true` 代表 downloadUrls 需要 token；`checkPermission=true` 代表 gated。
- full endpoint：`files[].id`、`name`、`primary`、`sizeKB`、`hashes.SHA256`、
  `downloadUrl`（含 `?fileId=<id>`）；版本 `downloadUrl` 不含 fileId。

【實際探測】全部無 API Key、無 Cookie、無 Authorization、GET 關閉自動 Redirect、不讀 body、
不輸出 Location query／signed URL，timeout 15s：

| 探測 | 結果 |
|---|---|
| `mini/28907` → `downloadUrls[0]`（含 `?fileId=23894`）GET 第一跳 | **307**，Location `https`，host **`b2.civitai.com`**，port 443（隱含） |
| 版本級 `.../28907`（不含 fileId）GET 第一跳 | **307**，host `b2.civitai.com` |
| `mini/135867` → `downloadUrls[0]`（含 `?fileId=99264`）GET 第一跳 | **307**，host **`civitai-delivery-worker-prod.5ac0637cfd0766c97916cefa3764fbdf.r2.cloudflarestorage.com`**，port 443 |
| 先前 HEAD `.../28907` | 307 → `b2.civitai.com`；CDN 第二跳 200，Content-Length 18986312、Content-Disposition 有檔名 |
| R2 host DNS | 4 個公開 IP，全部非 private |

【實際探測】metadata 對應：

- `28907`：`files[0].id=23894`、`primary=true`、`name=animeoutlineV4_16.safetensors`、
  `SHA256=2FCD88E6...F9B91`；mini 的 `fileName`／SHA256／`downloadUrls[0]?fileId=23894` 完全一致。
- `135867`：`files[0].id=99264`、`primary=true`、`name=add-detail-xl.safetensors`、
  `SHA256=0D9BD1B8...83BD7`，`downloadUrl` 含 `?fileId=99264`。

結論：
- **GET 與 HEAD 第一跳都是 307**，但 signed URL 內容可能不同；本輪只記錄第一跳 header，
  未跟隨到 CDN，故 CDN 對 GET 的 200 行為【未知】。
- CDN Host **不固定**：觀測到 `b2.civitai.com` 與 R2 delivery worker 兩種。
  R2 樣本已找到，不再是未知。
- `fileId` 存在於 mini 的 downloadUrls 與 full 的 files[].downloadUrl；
  版本級 URL 沒有 fileId（推測服務端預設 primary，但未實測 CDN 200 內容，標記【未知】）。
- 【未知】gated／paid 版本的 Host、是否多跳、requireAuth 實際行為。

---

## 7. CDN Host allowlist 建議

【推論，需 ChatGPT 審查】

初始請求（第 0 跳）：
- 只能由後端自行構造的 `https://civitai.com/api/download/models/< Vid >?fileId=<fid>`；
- scheme https、hostname **精確** `civitai.com`、port 未指定或 443、無 userinfo；
- **只有這一跳可以帶 Authorization Bearer**（從 DPAPI 解出的 key），不用 `?token=`。

Redirect target（每一跳都重新驗證）：
1. scheme 必為 `https`；port 未指定或 443；不得有 username/password；不得是 IP literal。
2. hostname 必須符合以下**精確規則之一**：
   - `civitai.com`（回到官方 API host）
   - `*.civitai.com`：以 `.civitai.com` 結尾且前面至少一個 label，
     用 `host == "civitai.com" or host.endswith(".civitai.com")`（精確後綴，不是 substring）
   - R2 delivery：完整 regex
     `^civitai-delivery-worker-prod\.[0-9a-f]{32}\.r2\.cloudflarestorage\.com$`
     （本輪觀測帳號段為 32 位小寫 hex）。
3. **不可**放行所有 `*.r2.cloudflarestorage.com`，也不可放行任意 `*.civitai.com` 以外的 host。
4. 不符合即安全失敗，回固定 `UNSAFE_REDIRECT`，不回顯 Location 完整字串。
5. Host  format 若未來改變（例如 hex 長度不同），fail closed 並要求重新審查；不可放寬成通用規則。

【未知】R2 帳號段是否永遠 32 hex、是否還有第三種 CDN host；需後續觀測。

---

## 8. DNS/IP pinning 設計

【推論】

每一跳（含 R2 host）都做：

1. `socket.getaddrinfo(host, 443, proto=TCP)` 取得**所有**答案。
2. 每個 IP 轉 `ipaddress.ip_address()`：
   - IPv4-mapped IPv6（`::ffff:a.b.c.d`）先取下層 IPv4 再檢查。
   - 拒 loopback、unspecified、link-local（含 169.254.169.254）、private（RFC1918/ULA）、
     CGNAT `100.64.0.0/10`、multicast、reserved。
   - 任一答案不合格即拒（不接受「部分公開、部分私網」）。
3. 選一個公開 IP 做連線，但保留原 hostname：
   - 自訂 `http.client.HTTPSConnection` 子類別，`connect()` 連到已驗證 IP，
     `server_hostname=original_host`，TLS SNI 與憑證驗證仍用原 host；
   - `Host` header 設為原 host（給 CDN virtual hosting 用）。
4. 關閉 proxy： downloaded connections 不用 urllib 的 ProxyHandler／環境 `HTTPS_PROXY`，
   避免「檢查 hostname、實際由 proxy 解析」的繞道。
5. 每跳重做 DNS 檢查，降低 DNS rebinding 風險。
6. 若不作 pinning，必須明確列為 residual risk；本報告建議第一版就做。

---

## 9. primary file / fileId / SHA256 的可靠對應方式

【推論＋實際探測】

1. 後端只用整數 `versionId` 呼叫 mini 與 full endpoint（可選帶 Bearer，視 key 狀態）。
2. 以 **full endpoint 的 `files[]` 中 `primary === true`** 為權威：
   取 `files[].id`（fileId）、`name`、`sizeKB`、`hashes.SHA256`、`downloadUrl`。
   - mini 用來取 `requireAuth`、`checkPermission`、`availability`、`earlyAccessEndsAt` 與輕量 SHA256。
   - 兩者都不進 `_civitai_cache`（避免匿名／授權混用）。
3. **自行構造**下載 URL：`https://civitai.com/api/download/models/<versionId>?fileId=<fileId>`，
   不使用 API 回傳的字串 URL（即使它看起來合法）；fileId 必須是純數字。
4. 下載完成後：
   - 用既有 `server.py:2054–2065` 的 `_hash_stream()` 對 `.part` 算 SHA-256，
     與 API `SHA256` 做 case-fold 比對。
   - 比對 CDN `Content-Disposition` 的檔名與 API `name`（ insufficient／不符 → 失敗；
     但以 API name 為最終寫入檔名，不用 CDN 頭）。
   - 比對 `Content-Length`（若有）與 API `sizeKB*1024`，容忍四捨五入，差距過大即失敗。
5. 若 API 沒有 SHA256 → **停止下載**並回 `NO_SHA256`（比官方 CLI「警告後仍下載」更嚴格）。
6. 【未知】multi-file 版本的 primary 是否永遠對應 `downloadUrls[0]`；
   第一版以 full endpoint 明確選 primary，不依賴順序。

---

## 10. 下載安全設計與錯誤分類

【推論】

### 10.1 逐項確認

1. Authorization 僅初始 `civitai.com` API 請求；Redirect 後一律不帶。
2. 每一跳重新驗證 scheme／host／port／userinfo／IP。
3. DNS 回應所有 IP 都必須公開（第 8 節）。
4. 特殊位址：IPv4-mapped IPv6、CGNAT、reserved、link-local、loopback、unspecified、multicast、ULA 全拒。
5. DNS pinning 保留 SNI／憑證驗證（第 8 節）。
6. Proxy 會繞過 IP 驗證 → 下載連線禁用 proxy。
7. visited set（scheme,host,port,path）＋最多 5 跳；重複或超限 → `TOO_MANY_REDIRECTS`。
8. **CDN 403 ≠ Civitai API 403**：前者多是 signed URL 過期／簽章錯誤，後者才是帳號/entitlement；
   分開 `CDN_FORBIDDEN` 與 `CIVITAI_FORBIDDEN`，不可一律說成帳號無權限。
9. GET/HEAD 差異：第一跳都 307；CDN 對 GET 的 200 尚未實測；第一版用 GET 串流，
   metadata 用 mini/full GET（JSON）。
10. Content-Length／預期大小／SHA256 三者交叉驗證；SHA256 是最終依據。
11. 取消／timeout／斷線：worker 用 `threading.Event` cancel；
    socket/read timeout 分段設定；`finally` 一律清 `.part`。
12. Windows 同名檔競態：先用 API name 檢查目標是否存在（SHA 相符就跳過、不符拒絕），
    **最終寫入用 `os.rename(part, final)`（Windows 在目標存在時會拋 FileExistsError），
    不用會覆寫的 `os.replace()`**；不要用「先檢查再覆寫」的競態寫法。
13. 檔名：`os.path.basename()`、拒 `<>:"/\|?*` 與控制字元、Windows 保留名稱
    （CON/PRN/AUX/NUL/COM1–9/LPT1–9）、尾端空白／句點、長度上限、路徑穿越；
    第一版只接受 `.safetensors`；目標目錄 realpath + commonpath containment。
14. 完成後前端呼叫既有 `refreshLoraList(true)`（`app.js:1765`）；
    ComfyUI `folder_paths.get_filename_list()`（`folder_paths.py:493–527`）用目錄 mtime 判 cache 過期，
    新檔會讓 cache 失效，能被 `/api/loras` 看到。
15. 所有 mutating endpoint 比照 `server.py:1777` `_set_output_dir()`：
    `X-SimpleUI: 1` + Origin 白名單 + body 大小限制；status endpoint 也建議同源保護。

### 10.2 錯誤分類

`KEY_NOT_SET`、`KEY_INVALID`(401)、`CIVITAI_FORBIDDEN`(403)、`CDN_FORBIDDEN`(CDN 403)、
`RATE_LIMITED`(429 + Retry-After)、`CIVITAI_SERVER_ERROR`(5xx)、`NETWORK_OFFLINE`、
`UNSAFE_REDIRECT`、`TOO_MANY_REDIRECTS`、`NO_SHA256`、`SHA_MISMATCH`、
`FILENAME_INVALID`、`NAME_CONFLICT`、`DISK_FULL`、`VERSION_NOT_FOUND`(404)、
`CANCELLED`、`TIMEOUT`、`DOWNLOAD_IN_PROGRESS`。
所有前端訊息白話、固定 code，不回顯 exception／signed URL／Authorization。

### 10.3 時間與磁碟保护

- worker 最大執行時間建議 30 分鐘；超過 → `TIMEOUT` 並清 `.part`。
- 連線／response header timeout 30 秒；串流每 chunk read timeout 60 秒。
- 下載前 `shutil.disk_usage(target_dir)`，需求 `sizeKB*1024 * 1.1 + 100MB`，不足 → `DISK_FULL`。
- 串流累加位元組不得超過 `Content-Length` 或 API size 的合理上限（例如 1.05 倍），
  超限立即中止，避免無限制寫入。

---

## 11. 最小實作架構與必要 API

【推論】

後端（全部在 `server.py`，標準庫）：
- `_comfy_lora_dirs()`：第 4 節方案（WMI 解析 argv + 短命 Python 子程序重現 apply_custom_paths）。
- `_civitai_version_meta(versionId)`：mini + full endpoint，授權時 Bearer，不進既有 cache。
- `_civitai_download_worker(task)`：手動逐跳、DNS/IP pinning、`.part`、SHA、原子寫入、清理。
- task slot：`dict + threading.Lock + threading.Event`，單一任務。
- 路由：
  - `GET  /api/civitai/download/status` → 目前任務狀態（輪詢）
  - `POST /api/civitai/download/start` body `{versionId}` → `{ok, taskId}`
  - `POST /api/civitai/download/cancel` → 設 cancel event
  - 全部沿用 `_key_guard()` 的同源檢查。

任務狀態欄位：`id`、`state`（queued/downloading/verifying/done/error/cancelled）、
`versionId`、`fileName`、`bytes`、`total`、`percent`、`code`、`error`。
**不含** signed URL、Key、Authorization、絕對路徑。

前端：探索卡片（`app.js:2142–2184`）加「下載」按鈕；Modal 加進度列與取消；
完成後呼叫 `refreshLoraList(true)`。

---

## 12. 仍然未知的項目

- CDN 對 GET 的最終 200 回應（本輪只取第一跳 header，未跟隨、未讀 body）。
- signed URL 期限、gated/paid/Early Access/Private 的 redirect 形狀與 status code。
- R2 帳號段是否永遠 32 hex；是否有第三種 CDN host。
- API SHA256 是否等於實際位元組（本輪沒有下載任何模型）。
- 其他使用者環境是否也有 `--output-directory` 造成的第二筆 loras 路徑（本機有）。
- ComfyUI process 不在 WMI 可見範圍（例如 container／不同使用者）時的降級行為。

---

## 13. 實際執行及未執行的測試

【實際執行】
- `codegraph status` + 兩次 `codegraph explore`（未 sync）。
- Git 狀態／PID／CommandLine 查詢。
- 唯讀 Python：
  - 獨立 import `folder_paths` → 1 筆 loras。
  - 重現 `apply_custom_paths` → 2 筆 loras，第二筆不存在。
  - `enable_args_parsing(True)` + argv → `cli.args.output_directory` 正確。
  - mini/full metadata GET（28907、135867）與一個公開 LORA 列表 GET。
  - 3 次 GET 第一跳（兩次 28907、一次 135867），只記 status/scheme/host/port；
    1 次先前 HEAD 探測；R2 host DNS 分類。
- 全部無 Key／Cookie／Authorization、timeout 15s、不讀 body、不輸出 signed query、
  不下載模型、不寫任何目錄。

【未執行及原因】
- 跟隨 CDN Redirect 或讀取任何response body：明確禁止下載模型內容。
- 真實 Key／gated／paid 測試：禁止使用真實帳號。
- 啟動第二個 ComfyUI／import `main.py`／重啟服務：明確禁止。
- 修改 `extra_model_paths.yaml`、寫入模型目錄、Git 寫入：明確禁止。

---

## 14. Git 最終狀態

- Branch `main`，HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`，Remote `origin`，ahead/behind `1/0`。
- tracked modified **12**（不變）；untracked **31**（原 30 + 本報告）；staged 0。
- 結束時 `git diff --check` 無輸出。
- 未執行任何 Git 寫入或清理。

---

## 15. 正式服務是否受到影響

**沒有。** 7860（PID 13424）與 8188（PID 12196）仍原行程、原 Port 監聽；
未發出狀態改變 API，未重啟、未停止、未修改設定或模型目錄。

---

## 16. 需要 ChatGPT 特別審查的項目

1. 是否接受「WMI 解析 live CommandLine + ComfyUI Python 子程序重現 apply_custom_paths」作為路徑方案；
   是否比直接用 `get_folder_paths()[0]` 更可靠（本機證明 `[0]` 雖然可用，但 live 有兩筆）。
2. R2 host 的正則（`civitai-delivery-worker-prod\.[0-9a-f]{32}\.r2\.cloudflarestorage\.com`）
   是否太窄／太寬；未來 host 變化要 fail closed 還是 allowing。
3. DNS pinning 是否第一版就做；std lib 自訂 HTTPSConnection 的 SNI／憑證驗證實作是否正確。
4. 以 `os.rename` 取代 `os.replace` 做 Windows 同名檔保護是否為最佳解。
5. full endpoint 選 primary + mini 選 gating flag 的兩次 metadata 呼叫是否可接受。
6. 沒有 SHA256 就停止是否過嚴。
7. worker 30 分鐘上限、1.1 倍磁碟保護是否合適。
8. 找不到 ComfyUI process 時的降級策略是否會讓自架使用者困惑。

---

## 17. 完成陳述

Phase B-0 R1 補充唯讀調查完成，立即停止。**沒有開始 Phase B 實作**，
沒有修改程式碼或設定，沒有下載模型，沒有重啟服務，沒有 Git 寫入，
既有工作區修改完整保留。
