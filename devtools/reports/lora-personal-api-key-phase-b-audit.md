# Civitai Personal API Key — Phase B-0 下載閉環唯讀安全調查

> 本輪為**唯讀調查**，唯一工作區寫入是本報告。沒有修改任何程式碼、設定、ComfyUI、
> `extra_model_paths.yaml`、模型目錄或既有報告；沒有下載模型；沒有重啟／停止任何服務；
> 沒有 Git 寫入。

標記說明：
- 【官方文件】= Civitai 現行官方文件或官方 CLI 原始碼記載。
- 【實際探測】= 本輪只讀取 HTTP metadata／公開 JSON 的結果，未下載模型內容。
- 【本機驗證】= 本輪讀碼或唯讀本機指令。
- 【推論】= 依上述證據設計，尚未實作。
- 【未知】= 尚無證據，不得當成事實。

---

## 1. 任務目標及調查範圍

目標：確認 Civitai Personal API Key 下載 LoRA 的最小可行閉環，包含下載 API 實際 HTTP 行為、
CDN Redirect、Authorization 安全、SSRF／DNS 防護、ComfyUI 實際 LoRA 目錄，以及
Sid-simple-ui 的最小整合設計。

明確不做：OAuth、通用 URL 下載器、任意路徑、多檔案選擇、Range/Resume、多工併發、
跨重啟任務恢復、下載歷史、WebSocket 進度、第三方套件、模型內容下載。

---

## 2. Repository、Branch、HEAD、Remote、開始 Git 狀態

| 項目 | 值 |
|---|---|
| 設備 | `DESKTOP-ADPHHAP` |
| 工作目錄（shell 預設） | `C:\ComfyUI`；Git／CodeGraph 操作鎖定 `C:\ComfyUI\simple_ui` |
| Repository 根目錄 | `C:/ComfyUI/simple_ui` |
| Branch | `main...origin/main [ahead 1]`（ahead/behind `1/0`） |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 同） |
| tracked modified | **12** |
| untracked | **29** |
| staged | 0 |
| `git diff --check`（開始時） | 無輸出 |
| 7860 / 8188 | 監聽中，PID 13424 / 12196 |

目標報告 `devtools/reports/lora-personal-api-key-phase-b-audit.md` 開始時不存在，無覆蓋衝突。
12 個 tracked modified 與 29 個 untracked 全部保留，未清理、未還原。

---

## 3. AGENTS.md 與 CodeGraph 調查紀錄

- 已讀 `C:\ComfyUI\AGENTS.md` 與 `C:\ComfyUI\simple_ui\AGENTS.md`；遵守「只准標準庫」、
  「不改既有修改」、「不重啟正式服務」、「先用 CodeGraph」等規範。
- 先執行 `codegraph status`：索引 35 files / 1094 nodes / 4837 edges，
  **Pending Changes: Added 2, Modified 2**（先前新增的測試與報告未 sync）。依 AGENTS.md，
  唯讀任務可跳過 sync，本輪未執行 `codegraph sync`。
- 再執行 `codegraph explore "_civitai_get _civitai_auth_allowed _NoRedirectHandler _open_without_redirect _civitai_me"`
  與 `codegraph explore "folder_paths loras _hash_stream do_GET do_POST routes"`。
  explore 回傳的是重新從磁碟讀取原始碼（不是過期 cache），但長輸出被截斷；
  `codegraph node _civitai_auth_allowed` 因索引過期回「Symbol not found」。
  因此僅對需要的函式用 `read` 取精確行號，沒有大量 grep 或整檔讀取。
- 既有報告已讀：`lora-personal-api-key-audit.md`、`lora-personal-api-key-design-review.md`、
  `lora-personal-api-key-phase-a.md`、`lora-personal-api-key-phase-a-r1.md`、
  `lora-personal-api-key-phase-a-r1a.md`。一律保留未修改。

---

## 4. Civitai API 及 Redirect 實際證據

### 4.1 Model Version 資訊端點【官方文件＋實際探測】

官方文件：https://developer.civitai.com/site/reference/model-versions.md

- `GET /api/v1/model-versions/{id}`：Mixed；回 `files[]`（含 `name`、`sizeKB`、`primary`、
  `hashes.SHA256`、`downloadUrl`）、版本 `downloadUrl`、`availability`、
  `earlyAccessEndsAt`、`earlyAccessConfig`。
- `GET /api/v1/model-versions/mini/{id}`：Mixed；**專為「需要最低限度資訊以下載檔案」設計**，
  回 `fileName`、`size`、`hashes.SHA256`、`downloadUrls[]`、`format`、`requireAuth`、
  `checkPermission`、`canGenerate`、`earlyAccessEndsAt`、`freeTrialLimit`、
  `additionalResourceCharge`。官方定義：
  - `requireAuth=true` → 下載 URL 需要 token（`Authorization: Bearer` 或 `?token=`）。
  - `checkPermission=true` → 資源被 gated（early access 生效中或 Private），需搭配 `/permissions/check`。
  - `availability`：`Public` 等。
- https://developer.civitai.com/site/reference/permissions.md：`/permissions/check` 回
  `true/false`；`false` 的例子包含「early access 生效且未付款」與「Private 且非擁有者」。

【實際探測】公開 metadata GET（版本 28907，無金鑰，只取欄位、不下载檔案）：

```text
mini: availability=Public, fileName=animeoutlineV4_16.safetensors,
      fileType=Model, size=18541.3203125, format=SafeTensor,
      hashes.SHA256=2FCD88E6AA07B2DB73BEFCA54B3956131E1DECC8E6E719508CE32C28768F9B91,
      downloadUrls=["https://civitai.com/api/download/models/28907?fileId=23894"],
      requireAuth=false, checkPermission=false, earlyAccessEndsAt=null
detail: id=28907, modelId=16014, downloadUrl=.../28907,
        files[0]={id:23894, name:animeoutlineV4_16.safetensors, primary:true,
                  sizeKB:18541.3203125, 同一 SHA256,
                  downloadUrl:.../28907?fileId=23894}
```

結論：
- **primary file 資訊由 mini 端點提供最完整且最輕量**（`fileName`、`SHA256`、`downloadUrls`、gated 旗標一次取得）。
- 版本級 `downloadUrl` 不含 `fileId`；**檔案級 `downloadUrl` 含 `?fileId=<int>`**。
- 【未知】detail Endpoint 的 `availability` 在此回 `null`，mini 回 `Public`；不要以 detail 的 availability 為準。
- 【未知】gated／paid 檔案是否有不同 `downloadUrls` 形狀，未測試。

### 4.2 下載端點與 Redirect【實際探測】

只用 HEAD，不帶 Authorization、不讀 body、不自動跟隨 Redirect；只輸出_status／header 名稱／Location 的 host：

```text
HEAD https://civitai.com/api/download/models/28907
→ 307
Location scheme=https host=b2.civitai.com port=443(implicit) has_query=True
Cache-Control: no-store, max-age=0
其他 header 名稱：access-control-*, alt-svc, cf-*, connection, date, location, server, vary, x-frame-options
Content-Length / Content-Type / Content-Disposition：無（307 本身沒有檔案 metadata）
```

逐跳檢查下一跳（HEAD 到 CDN，仍不帶 Authorization、不讀 body）：

```text
→ 200
header 名稱含：content-disposition, content-length, content-type, accept-ranges,
                last-modified, cache-control, x-bz-content-sha1, x-bz-file-id,
                x-bz-file-name, strict-transport-security, cf-* 等
Content-Length: 18986312
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="animeoutlineV4_16.safetensors"
Accept-Ranges: bytes
Cache-Control: max-age=300
DNS(b2.civitai.com)：4 個公開 IP，全部非 private
```

結論：
- 下載 API **會回 307**；本輪觀測是一次 Redirect 到 `b2.civitai.com`（`*.civitai.com` 子網域），
  Location 附帶 signed query（內容未讀取、未記錄）。
- CDN 回 200 時才提供可靠的 `Content-Length`／`Content-Type`／`Content-Disposition`；
  307 本身沒有。
- **第一版可匿名下載公開檔案**（此公開版本 HEAD 307→200 成功，未帶 Key/Authorization/Cookie）。
- CDN 回應中 `x-bz-*` 顯示物件儲存服務；`Accept-Ranges: bytes` 存在，但依產品限制**不做 Range/Resume**。
- 【未知】是否曾回 301/302/303/308；本輪只觀察到 307。
- 【未知】signed URL 期限、是否因檔案/時間改用其他 Host、gated/paid 檔案是否多跳。
- 【未知】API 回應的 SHA-256 是否與實際位元組相符——本輪**沒有下載檔案**，不能宣稱已驗證。
  兩邊 `fileName` 一致（API `animeoutlineV4_16.safetensors` vs CDN Content-Disposition）是 metadata 層的吻合。

### 4.3 官方 CLI 的下載設計【官方文件／原始碼】

- https://developer.civitai.com/site/guide/cli.md：`civitai download <version-id>` 以 stored token
  或 `CIVITAI_TOKEN` 自動帶 Bearer；「most model files need a token；gated file 無 token 401，
  some public files download with no token」；SHA256 預設驗證，不符刪掉部分檔；
  `.part` 暫存＋成功才改名；已存在且 hash 相符就跳過。
- https://raw.githubusercontent.com/civitai/cli/main/pkg/civitai/download.go：
  `/api/download` **307 redirect 到不同 host 的 signed object storage**；Go 預設在跨 host
  時移除 Authorization；每跳重新檢查 https、最多 10 跳、SSRF private-IP 防護、
  `ResponseHeaderTimeout`、無整體 timeout；token 只附加到 `civitai.com`／`*.civitai.com`。
- https://raw.githubusercontent.com/civitai/cli/main/claudedocs/decisions/17-download-presigned-no-credential.md：
  presigned blob  fetching 必須使用「完全沒有 credential」的 entry point，避免把 full-scope key
  送給 `*.civitai.com` 上的其他服務。
- https://developer.civitai.com/site/guide/errors.md：401=缺少/無效 token；403=有效 token 但無權限；
  404=不存在；429=rate limit（附 Retry-After）；5xx=暫時錯誤。429 以外 4xx 不應重試。

### 4.4 現有 Sid-simple-ui Civitai 程式碼【本機驗證】

| 位置 | 現況 |
|---|---|
| `server.py:285–311` | `_civitai_auth_allowed()`：只許可 `https`、精確 host `civitai.com`、無 URL 帳密、無 Port 或數值 443（R1a 修正空 Port） |
| `server.py:726–737` | `_NoRedirectHandler`／`_open_without_redirect()`：帶 Bearer 請求遇到任何 3xx 直接安全失敗 |
| `server.py:743–783` | `_civitai_get(path, ..., auth=False)`：Bearer 只在 host guard 通過時附加；匿名路徑用原 `urlopen` |
| `server.py:785–802` | `_civitai_me(key)`：只用來測試 Key；no-redirect |
| `server.py:928–987` | `_normalize_civitai_item()`：已保留 `files[].sha256`、`files[].downloadUrl`、version `downloadUrl` |
| `server.py:989–1027` | `civitai_search()`：只打 `/models`，匿名，TTL 300 |
| `server.py:2054–2065` | `_hash_stream()`：串流 SHA-256＋byte 計數，可直接重用於下載驗證 |

**重要衝突（必須正視）**：
1. R1a 的 host guard 只准精確 `civitai.com`，但實際 CDN 是 `b2.civitai.com`。
   **不能直接把 R1a guard 拿去驗證 download redirect**，否則合法下載會被拒。
2. R1 的 no-redirect 策略若原樣套用到下載，**所有真實下載都是 307，會全部失敗**。
   下載必須改用「手動逐跳、逐跳驗證、跨 host 必剝離 Authorization」的新流程，而不是放寬舊流程。
3. 公開搜尋／Checkpoint 的匿名路徑與 `_civitai_cache` 必須完全不動。

---

## 5. CDN Host 與安全策略

建議規則【推論，需 ChatGPT 審查】：

1. **初始 URL 自行構造，不接受外部輸入的 URL**：只接受整數 `versionId`（與可選整數 `fileId`），
   拼成 `https://civitai.com/api/download/models/<versionId>?fileId=<fileId>`。
   即使 API 回傳 `downloadUrls`，也只取出整數 `fileId` 後重新構造，不直接使用該字串。
2. **Authorization 只在第 0 跳附加**，且只附加到精確 `https://civitai.com:443`；
   任何 3xx 之後的請求（含 `*.civitai.com` CDN）**一律不帶 Authorization／Cookie**。
3. **Redirect target 驗證**（每一跳都做）：
   - scheme 必為 `https`；port 必為未指定或 443；不得有 username/password。
   - hostname 必為 `civitai.com` 或以 `.civitai.com` 結尾（點號分隔的精確後綴，
     不用 substring，因此 `evilcivitai.com`、`civitai.com.evil.com` 都拒）。
     這同時符合【實際探測】的 `b2.civitai.com` 與官方 CLI 的 `*.civitai.com` 信任規則。
   - 不接受 IP literal（IPv4/IPv6）、`localhost`、`*.localhost`。
   - DNS 解析後每個 IP 都必須是公開位址；拒 loopback、unspecified、link-local
     （含 169.254.169.254）、RFC1918、IPv6 ULA、CGNAT 100.64/10、multicast、reserved。
   - 建議把連線釘在已驗證的公開 IP（自訂 `http.client.HTTPSConnection`，
     保留 `server_hostname` 做 SNI/憑證驗證）以對抗 DNS rebinding；若第一版不做，
     必須明確列為 residual risk。
   - 關閉 proxy（`http.client` 直連或 opener 用空 ProxyHandler），避免代理绕过 IP 檢查。
   - 記錄 `(scheme, host, port, path)` visited set，重複即拒；最多 5 跳。
4. **signed URL query 不可進日誌／前端／錯誤訊息**：只在 worker 區域變數存在；
   log 只印 host 與 status；對前端只回固定 `code` 與白話訊息，不回 `str(exception)`。
5. **CDN 非敏感 Header**：只送 `User-Agent`／`Accept`；【實際探測】證明公開檔案的 CDN
   不需要 Authorization 或 Cookie 就能 200。
6. **Host 不可假設固定**：白名單用後綴規則而非寫死 `b2.civitai.com`；
   若未來出現非 `*.civitai.com` 的合法 CDN，必須重新審查，不可直接放行所有 HTTPS host。

---

## 6. SSRF / DNS / Redirect 威脅分析

| 威脅 | 現況 | 建議防護 | 分類 |
|---|---|---|---|
| 使用者控制 URL | 前端只傳 versionId/fileId | 後端自行構造 URL，忽略 API 的字串 URL | 【推論】 |
| HTTP 降級 | 307 的 Location 是 https（本輪觀察） | 每跳強制 https | 【官方＋推論】 |
| URL credentials | R1a 已擋初始 URL | 每跳都擋 | 【本機＋推論】 |
| 非預期 Port | R1a 只擋初始 URL | 每跳 port ∈ {None,443} | 【本機＋推論】 |
| 非官方 Host | CDN 是 `*.civitai.com` | 後綴精確比對，不接受其他 host | 【實際探測＋推論】 |
| localhost／private IP／loopback／link-local | 未測 | DNS 後逐 IP 檢查＋釘 IP | 【推論】 |
| IPv6 特殊位址 | 未測 | `ipaddress` 檢查 ULA/loopback/unspecified/multicast/reserved | 【推論】 |
| DNS rebinding | Python `urlopen` 無法保證 | 解析後釘 IP 連線，保留 SNI host；每跳重做 | 【推論】 |
| proxy 繞過 | 環境未知 | 下載連線禁用 proxy | 【推論】 |
| Redirect 迴圈／過多 | 未測 | visited set＋上限 5 跳 | 【推論】 |
| 跨 Host Authorization 洩漏 | R1 已擋 `urlopen` 自動 redirect | 手動逐跳；第 1 跳起不帶任何憑證 | 【官方＋本機】 |
| signed URL 進日誌 | 現無 download | 只記 host/status，不記 query | 【推論】 |

**Python urllib 適合嗎？**【推論】不適合直接用於下載：`HTTPRedirectHandler.redirect_request()` 會複製
Authorization，且無法逐跳做 DNS/IP 驗證或釘 IP。應自行用 `http.client`/ssl 逐跳處理；
std lib 即可完成，不需第三方套件。

---

## 7. ComfyUI Python Interpreter 與 folder_paths 實際結果

【本機驗證】

- ComfyUI process（PID 12196）：
  `C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --output-directory D:\ComfyUI_output`
- simple_ui process（PID 13424）：**同一顆** embedded Python 執行 `C:\ComfyUI\simple_ui\server.py`。
- 該 Interpreter：`3.13.14 ... [MSC v.1944 64 bit (AMD64)]`。
- `folder_paths.py`：`C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\folder_paths.py`。
- 以該 Interpreter 從 ComfyUI 目錄執行只讀查詢：

```json
{"loras": ["C:\\ComfyUI\\ComfyUI_windows_portable\\ComfyUI\\models\\loras"],
 "checkpoints": ["C:\\ComfyUI\\ComfyUI_windows_portable\\ComfyUI\\models\\checkpoints"],
 "base_dir": "C:\\ComfyUI\\ComfyUI_windows_portable\\ComfyUI",
 "models_dir": "C:\\ComfyUI\\ComfyUI_windows_portable\\ComfyUI\\models"}
```

- `folder_paths.get_folder_paths()`（`folder_paths.py:400–402`）回 `folder_names_and_paths[name][0][:]`，
  **可能是多筆**（`add_model_folder_path()` 可追加）；目前只有一筆。
- `folder_paths.py:15–23`：`--base-directory`／`--models-directory` 會改變根目錄；
  目前啟動命令沒有這兩個參數。
- `server.py:1034–1081` 的 `_local_checkpoint_size()` **已經**用
  `os.path.dirname(sys.executable)` 往上找 4 層的 `ComfyUI/folder_paths.py` 並 import，
  所以 Sid-simple-ui 已有安全取得 ComfyUI Python 環境的模式，可重用。
- 刷新：ComfyUI `folder_paths.get_filename_list()`（519–527）用目錄 mtime 判定 cache 過期
  （493–517），**寫入新檔會改變目錄 mtime，因此 `/api/loras` 可看到新 LoRA**；
  `cache_helper` 的 strong cache 只在 with 區塊內生效（77–105），一般 API 請求不受影響。

### 方案比較【推論】

| 方案 | 可靠性 | 相容性 | 固定路徑 | 額外程序 | 改 ComfyUI | 維護 | 評價 |
|---|---|---|---|---|---|---|---|
| A. 用目前 Python 直接 import `folder_paths`（重用 `server.py:1034–1081` 模式） | 高（同 Interpreter 已實測） | 高（依 `sys.executable` 搜尋，不硬編碼） | 否 | 否 | 否 | 低 | **建議** |
| B. 從啟動環境／命令列解析 `--models-directory` | 中（目前無此參數） | 中 | 否 | 否 | 否 | 中 | 備援 |
| C. 另起子程序問 ComfyUI | 低 | 低 | 可能 | 是 | 否 | 高 | 不建議 |

第一版建議：方案 A，抽一個 `_comfy_folder_paths()` helper 供 checkpoint 與 LoRA 共用；
取得 `get_folder_paths("loras")[0]`，確認是真實目錄且可寫入，失敗就白話報錯，
**不回退到硬編碼 `models/loras`**。

### extra_model_paths.yaml【本機驗證】

- ComfyUI 根目錄**沒有** `extra_model_paths.yaml`，只有 `extra_model_paths.yaml.example`
  與 `tests/execution/extra_model_paths.yaml`（測試用）。
- `main.py:139–145`：若檔案存在會呼叫 `utils.extra_config.load_extra_path_config()`；
  `comfy/cli_args.py:71` 另有 `--extra-model-paths-config`。目前啟動命令都沒用。
- 因此目前路徑不受額外設定影響；但因為方案 A 是問 `folder_paths`，未來使用者加了
  `extra_model_paths.yaml` 也會自動跟著正確路徑，不需要改程式。

---

## 8. Sid-simple-ui 現有架構整合點

| 項目 | 位置／現況 |
|---|---|
| HTTP handler | `server.py:1698` `do_GET()`、`:1741` `do_POST()`；集中分派，JSON 用 `_json()` |
| Civitai 路由 | `server.py:1722–1727`：`/api/civitai/status`、`/search`、`/key/status` |
| Key 路由 | `server.py:1726`、`do_POST` 內 `/api/civitai/key`、`/test`、`/remove` |
| LoRA 清單 | `server.py:1819` `_loras()` → ComfyUI `/models/loras`；前端 `app.js:1765–1795` `refreshLoraList(true)` |
| ComfyUI proxy | `server.py:1344` `_proxy()`，只允許本機 COMFY |
| 探索卡片 | `app.js:2142–2184` `cvRenderCard()`；版本迴圈 2149–2165；檔案列 2153–2156 |
| 版本 previews | `app.js:2250–2329`，`PV` 只存記憶體 |
| Key UI | `app.js:1995–2110`、`index.html:367` 起、`app.css` `.cv-key-*` |
| Hash 工具 | `server.py:2054–2065` `_hash_stream()` |
| 同源檢查 | `server.py:1777` `_set_output_dir()` 的 `X-SimpleUI` + Origin 模式；Key 端點已複製 |
| Mock 測試 | `devtools/lora_mock_civitai.py`、`lora_mock_comfy.py`、`lora_explorer_api_test.py`、`lora_personal_key_test.py` |

回答問題：
1. 最小新增 API：見第 11 節（4 個端點）。
2. 可直接沿用 `H.do_GET/do_POST` 與 `_json()`。
3. **需要**背景 thread（daemon＋ lock）；不能在 handler 內串流大檔。
4. start 立即回 task id，handler 不等待；status 用輪詢。
5. 單一全域 task slot＋lock；有任務時 start 回 `DOWNLOAD_IN_PROGRESS`。
6. polling 欄位見第 11 節；**不含 signed URL／Key／Authorization／完整本機路徑**。
7. 機密只存在 worker 區域變數；API 回固定 code 與白話訊息。
8. 進度用 `bytes/total/percent`，前端定時輪 polling。
9. cancel 設 Event，worker 檢查並關閉連線，`finally` 清 `.part`。
10. 所有失敗路徑統一是 `try/finally` 清 `.part`。
11. 同名檔先算 SHA256，相符則跳過，不符則拒絕覆寫。
12. 檔名以 API `fileName` 為準，basename＋白名單字元＋Windows 保留名稱檢查＋路徑 containment。
13. 用 `_hash_stream()` 對 `.part` 算 SHA256，與 API 值 case-fold 比對。
14. 沒有 SHA256 → **停止下載**並回 `NO_SHA256`（比 CLI 的「警告後仍下載」更嚴格）。
15. 完成後前端呼叫既有 `refreshLoraList(true)`；ComfyUI 的 mtime cache 會失效（第 7 節）。

---

## 9. 第一版最小實作建議

範圍：只下載 LoRA Model Version 的 primary file、單一任務、HTTP polling、簡單進度、
可取消、真正 LoRA 目錄、SHA256、`.part`、原子改名、失敗清理、同名保護、完成刷新清單。
不做多檔案、Range、多工、跨重啟恢復、歷史、WS、OAuth、通用 URL 下載。

### 9.1 必要後端修改位置

| 檔案／位置 | 目的 |
|---|---|
| `server.py` 新增 `_comfy_folder_paths()`（重用 1034–1081） | 取得真正 LoRA 目錄 |
| `server.py` 新增 `_civitai_version_info(versionId)` | 打 mini endpoint；授權時用 Bearer（auth=True 但**不走 `_civitai_cache`**） |
| `server.py` 新增 `_build_download_url(versionId, fileId)` | 自行構造官方 URL，忽略 API 字串 URL |
| `server.py` 新增 `_safe_redirect_open()` | 手動逐跳、host/DNS/IP/loop/hop 限制、剝離憑證 |
| `server.py` 新增 download task manager（dict + Lock + Thread + Event） | 單一任務、進度、取消 |
| `server.py:1698/1741` | 新增 4 個路由 |
| `server.py:2054` | 重用 `_hash_stream()` |

### 9.2 必要前端修改位置

| 檔案／位置 | 目的 |
|---|---|
| `index.html:359–397`（探索 Modal） | 加一條進度列＋取消按鈕 |
| `app.js:2149–2165` | 每個版本加「下載」按鈕（帶 versionId／fileId） |
| `app.js` 新增 download 狀態機 | start → polling → done/error/cancel；完成呼叫 `refreshLoraList(true)` |
| `app.css` `.cv-*` | 進度列樣式，沿用變數、hover 不變尺寸 |

### 9.3 安全邊界

- 輸入只有整數 versionId／fileId，無任意 URL／路徑。
- 初始 URL 固定官方 HTTPS；Bearer 只送第 0 跳；CDN 永不帶 Authorization/Cookie。
- 每跳重新驗證 scheme/host/port/userinfo/IP/DNS；釘 IP、禁用 proxy、5 跳上限、visited set。
- signed query 不 log、不回前端、不進例外訊息。
- 寫入目錄由 `folder_paths` 決定＋realpath/containment；檔名嚴格清洗。

### 9.4 測試案例（隔離 mock，不碰正式服務）

1. mini 200／401／403／404／429／5xx／網路錯誤分類。
2. 初始 URL 只含整數；API 回的字串 URL 不被直接使用（注入 `http://evil` 會被拒）。
3. 307 → `b2.civitai.com` 友善案例成功；307 → `evil.example`／`civitai.com.evil.com`／IP／
   `localhost`／private IP／http／`:8443`／URL 帳密一律拒且第二 Host 收不到 Authorization。
4. 301/302/303/307/308 都逐跳驗證；loop 與 >5 跳拒絕。
5. DNS rebinding mock（第一次公網、第二次私網）必須被擋（若做釘 IP）。
6. 200 後 `.part` 存在→SHA256 相符→原子改名；不符→`.part` 刪除、最終檔不存在。
7. 同名檔 SHA 相符→跳過；不符→拒絕覆寫。
8. cancel→`.part` 清理；中斷／5xx→清理。
9. Windows 非法檔名、保留名稱、路徑穿越、超長名稱拒絕。
10. polling 回應不含 signed URL／Key／Authorization／絕對路徑。
11. 公開搜尋與 Checkpoint 匿名行為、快取 key、NSFW 判斷全部不變（跑既有 35+21 測試）。
12. 完成後 `/api/loras` 能看到新檔（可用 mock Comfy 的 `/__mock/loras` 類比）。

---

## 10. 已確認事實／推論／未知

**已確認（官方＋本機＋實際探測）**
- mini endpoint 提供 primary file 完整下載資訊與 gated 旗標。
- 公開版本 28907 匿名 HEAD → 307 → `https://b2.civitai.com/...` → 200；
  CDN 200 才有可靠的 Content-Length／Content-Disposition／Content-Type。
- 同一 Embedded Python 跑 ComfyUI 與 simple_ui；`folder_paths` 回一個 LoRA 目錄；
  沒有生效的 `extra_model_paths.yaml`。
- R1/R1a 的 strict host guard 與 no-redirect 不能直接套用到下載。

**推論**
- 手動逐跳＋後綴 host 白名單＋DNS/IP 檢查＋釘 IP 是第一版可行安全設計。
- 單一 thread task＋polling 足以滿足產品範圍。

**未知（不得寫成事實）**
- signed URL 期限、是否多跳、CDN Host 是否恒定、302/301/303/308 是否出現。
- gated／Early Access／Paid／Private 的實際 status code 與是否多跳。
- API SHA256 是否等於實際位元組（本輪未下載）。
- CDN 是否需要 Cookie（只測到公開檔案不需要）。
-  Proxy 環境是否會影響連線。

---

## 11. 未執行測試及原因

- 模型本體下載／SHA256 實際比對：明確禁止，且會產生大型檔案。
- Gated／Paid／Early Access 的下載探測：需要真實帳號／Key，明確禁止。
- 完整 301/302/303/308 官方行為矩陣：只觀測到 307，其餘未實測。
- 重啟服務、寫入模型目錄、修改 `extra_model_paths.yaml`：明確禁止。
- Git 寫入：明確禁止。

本輪實際 HTTP 請求：初始 HEAD（2 次，第一次僅為修正輸出格式）、CDN HEAD（1 次）、
公開 metadata GET（2 次），全部 timeout 15 秒、不使用真實 Key、不帶 Authorization、
不讀 response body、不輸出 signed query。

---

## 12. Git 最終狀態

- Branch：`main...origin/main [ahead 1]`；HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`；
  ahead/behind `1/0`；Remote 不變。
- tracked modified：**12**（與開始時相同）。
- untracked：**30**（開始 29 + 本報告）。
- staged：0；`git diff --check` 於結束時再次執行，無輸出。
- 未執行任何 Git 寫入或清理。

---

## 13. 7860 / 8188 服務是否受到影響

**沒有。** 7860（PID 13424）與 8188（PID 12196）仍監聽原 Port、原行程；
未發出任何狀態改變 API，未重啟、未停止、未修改設定。

---

## 14. 尚未解決的風險

1. CDN Host 後綴白名單與「不可假設 Host 固定」之間仍有張力；若 Civitai 改到非 `*.civitai.com`
   CDN，第一版會擋住合法下載，需重新審查（不能為了解決而放行所有 HTTPS host）。
2. DNS rebinding 若不做 IP pinning 會是殘留風險；建議第一版就做，需 ChatGPT 裁決。
3. R1a 的 `_civitai_auth_allowed()` 與下載 redirect 驗證是兩套不同規則，
   後續維護者可能誤用；需文件化並加測試。
4. Gated／Paid／Early Access 的錯誤分類只能按官方文件推論，未能實測。
5. 多檔案版本只取 primary；API `downloadUrls[0]` 是否永遠是 primary【未知】。
6. 沒有 SHA256 就停止下載會比官方 CLI 更嚴格，可能讓少數舊模型無法下載。
7. Windows 檔名與 ComfyUI 子資料夾（例如 `loras/style/`）的相容性需決定：
   第一版建議只寫入 `loras` 根目錄，不做子目錄。

---

## 15. 需要 ChatGPT 特別審查的項目

1. 是否接受「手動逐跳 + `*.civitai.com` 後綴白名單 + 釘 IP」取代 R1 的 no-redirect，
   以及是否需要把 R1a guard 明確改名／註解以免誤用。
2. DNS pinning 的 stdlib 實作是否值得第一版就做；若不做，是否接受為 residual risk。
3. 以 mini endpoint 為唯一 metadata 來源是否足夠（尤其 multi-file 版本與 `fileId`）。
4. 沒有 SHA256 就拒絕下載是否過嚴，是否改成「警告並標記 unverified」。
5. 寫入 LoRA 根目錄還是尊重 API 檔名中的子路徑；建議根目錄，請確認。
6. polling 是否要回 targetPath（目前建議不回絕對路徑）。
7. 是否需要把 download task 與 Key store 拆成獨立模組，還是先放 `server.py`。

---

## 16. 完成陳述

Phase B-0 唯讀調查完成，報告建立後停止。**沒有開始 Phase B 實作**，
沒有修改任何程式碼或設定，沒有下載模型，沒有重啟或干預 7860／8188／WD14，
沒有 Git 寫入，既有工作區修改完整保留。
