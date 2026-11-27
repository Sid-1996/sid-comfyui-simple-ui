# Civitai API Key 使用體驗與 LoRA 實際套用問題 — 唯讀整合審查

> 任務性質：**嚴格唯讀調查**。本輪未修改任何正式程式碼、設定、localStorage、模型檔案或既有報告；未呼叫真實 Civitai API、未使用真實 API Key、未下載模型、未啟動／停止／重啟 ComfyUI 或 Simple UI、未執行真實生圖或 GPU 測試、未執行任何 Git 寫入。`codegraph sync` 亦未執行（唯讀約束）。唯一新增的檔案是本報告。
>
> 證據標記：
> - 【已驗證】＝本輪直接讀取目前工作區磁碟上的程式碼、Git 狀態、CodeGraph 索引狀態，或實際執行離線／mock 測試所得。
> - 【靜態推論】＝由程式碼推導，未在真實環境執行。
> - 【尚未實測】＝必須在真實 ComfyUI／Civitai 環境才能確認，本輪不得推測成功或失敗。

---

## 1. 任務目標與調查範圍

### 1.1 使用者回報的兩個產品級問題

1. **API Key 缺少完整使用者設定入口**：沒有明確輸入窗口、沒有取得 Key 的操作引導、沒有清楚的設定／儲存／驗證狀態，一般使用者不知道如何開始。
2. **LoRA 套用後沒有實際效果**：已選擇／套用 LoRA 但生圖看不到效果。「出現在選單」「下載成功」「工作流成功送出」都不能當成功能正常。

### 1.2 本輪範圍

- 從第一次開啟介面開始，追蹤 API Key 的前端入口 → 後端保存／驗證／使用 → 是否存在前端沒有入口的後端 API。
- 從使用者操作一路追蹤到 ComfyUI 工作流：選擇 → 權重 → Trigger Words → snapshot → `wf()` → `/prompt` → 推論。
- 檢查 LoRA 目錄解析（`comfy_lora_paths.py`、`folder_paths`）、同名檔案遮蔽與快取／掃描時機。
- 整理兩個問題之間的完整資料流與斷點，逐一標記狀態。
- 提出最小、可靠、易維護的修正方案與順序。

### 1.3 明確不做

不實作、不修改既有檔案、不覆蓋既有報告、不連接正式服務做 E2E、不碰使用者資料、不 Git 寫入。

---

## 2. Repository、Branch、HEAD、Remote、Git 起始狀態

| 項目 | 值 |
|---|---|
| Repository 根目錄 | `C:\ComfyUI\simple_ui`（唯一本專案 repo；上游 ComfyUI repo 忽略） |
| Branch | `main`，狀態 `## main...origin/main [ahead 1]` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 相同） |
| tracked modified | 12 |
| staged | 0 |
| untracked | 39 |
| 命令 | `git -C C:\ComfyUI\simple_ui status -sb` / `rev-parse HEAD` / `branch --show-current` / `remote -v` |

### 2.1 tracked modified（開始時，全部保留未動）

```
 M app.css
 M app.js
 M devtools/lora_explorer_api_test.py
 M devtools/lora_explorer_core_test.mjs
 M devtools/lora_mock_civitai.py
 M devtools/lora_ui_test.mjs
 M devtools/test_ui_control_wd14.ps1
 M index.html
 M server.py
 M ui_control.ps1
 M ui_panel.ps1
 M ui_panel.pyw
```

diff stat：`12 files changed, 1688 insertions(+), 104 deletions(-)`。與 HEAD 相比，Civitai 探索中心／API Key 相关程式主要落在未提交的工作區修改中；LoRA 工作流核心（`wf()` / `loraApplyToWorkflow()`）在本次 diff 中**沒有出現**，代表它已存在於 HEAD。

### 2.2 untracked（開始時 39 項）

```
comfy_lora_paths.py
devtools/comfy_lora_paths_test.py
devtools/lora_personal_key_test.py
devtools/lora_personal_key_ui_test.mjs
devtools/reports/fix-local-wd14-and-output-directory.md
devtools/reports/history-prompt-category-apply-investigation.md
devtools/reports/lora-explorer-real-world-audit.md
devtools/reports/lora-image-preview-phase2.md
devtools/reports/lora-image-preview-research.md
devtools/reports/lora-image-preview-s0.md
devtools/reports/lora-oauth-s1-design.md
devtools/reports/lora-personal-api-key-audit.md
devtools/reports/lora-personal-api-key-design-review.md
devtools/reports/lora-personal-api-key-phase-a-r1.md
devtools/reports/lora-personal-api-key-phase-a-r1a.md
devtools/reports/lora-personal-api-key-phase-a.md
devtools/reports/lora-personal-api-key-phase-b-audit-r1.md
devtools/reports/lora-personal-api-key-phase-b-audit-r2.md
devtools/reports/lora-personal-api-key-phase-b-audit.md
devtools/reports/lora-personal-api-key-phase-b-implementation-spec.md
devtools/reports/lora-personal-api-key-phase-b1-implementation.md
devtools/reports/lora-personal-api-key-phase-b1-review-r1.md
devtools/reports/lora-personal-api-key-phase-b1-review-r2-regex-fix.md
devtools/reports/lora-personal-api-key-phase-b1-review-r2.md
devtools/reports/open-source-readiness-phase1.md
devtools/reports/open-source-readiness-phase2a.md
devtools/reports/open-source-readiness-phase2b1.md
devtools/reports/open-source-readiness-phase2b2.md
devtools/reports/open-source-readiness-phase2b3.md
devtools/reports/open-source-readiness-phase2c-implementation.md
devtools/reports/open-source-readiness-phase2c.md
devtools/reports/open-source-readiness-phase3.md
devtools/reports/open-source-readiness-phase3r1.md
devtools/reports/open-source-readiness-phase3r1r.md
devtools/reports/open-source-readiness-phase3r1v.md
devtools/reports/open-source-readiness-phase3r1vr.md
devtools/reports/readme-agents-documentation.md
devtools/test_ui_control_process.ps1
devtools/test_ui_panel_reporting.py
```

> 本報告檔名 `devtools/reports/lora-personal-api-key-and-application-audit.md` 開始時**不存在**，無覆蓋衝突。

### 2.3 CodeGraph 狀態【已驗證】

`codegraph status`（projectPath 由 CLI 目前目錄解析為 `C:\ComfyUI\simple_ui`）：

- Files 35、Nodes 1,094、Edges 4,837、DB 7.02 MB、Backend node:sqlite（WAL）。
- **Pending Changes：Added 4 / Modified 2** → 索引落後於工作區。
- 未執行 `codegraph sync`（唯讀約束）。`codegraph explore` 回傳的是重新從磁碟讀取的原始碼，因此本報告引用的行號以磁碟現況為準；`codegraph node` 對新符號可能查不到。

### 2.4 相關 AGENTS.md【已驗證】

已讀取 `C:\ComfyUI\AGENTS.md`、`C:\ComfyUI\simple_ui\AGENTS.md`。`simple_ui` 下没有其他 AGENTS.md；`C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\AGENTS.md` 屬上游，未納入本專案規範。

---

## 3. API Key 前端與後端實際實作狀況

### 3.1 前端入口：存在，但位置與目的都不清楚【已驗證】

入口**不是**獨立設定頁，而是藏在二級 Modal「LoRA 探索中心」內：

- `index.html:359-410`：`#exploreModal`；`:368-380` 為 `#cvKeyBar`（`#cvKeyStatus`、`#cvKeyEdit`、`#cvKeyTest`、`#cvKeyRemove`）、`#cvKeyForm`（`#cvKeyInput` type=password、 `#cvKeySave`、`#cvKeyCancel`）、`#cvKeyResult`（aria-live）、風險說明 `#cvKeyNote`。
- 對外入口只有 `index.html:197` 的「探索」小按鈕 `#btnLoraExplore`；`app.js:3210` 綁定 `cvOpenModal()`。右欄設定區沒有 Key 欄位。
- `app.js:1975-1980` `cvOpenModal()` 每次開啟都呼叫 `cvKeyRefresh()`；`:1994-2104` 完成狀態渲染、儲存、測試、移除；`:3212-3224` 事件綁定。
- `app.css:985-993` 有一列式 `.cv-key-*` 樣式。

操作能力逐項核對：

| 項目 | 狀態 | 依據 |
|---|---|---|
| 輸入框 | 有 | `index.html:375`，type=password、autocomplete=off |
| 顯示／隱藏 Key | 無（只有 password 遮罩，沒有「顯示」切換） | `index.html:375` 附近無 toggle |
| 儲存 | 有 | `app.js:2053-2073` `cvKeySave()` → `POST /api/civitai/key` |
| 測試連線 | 有 | `app.js:2075-2089` → `POST /api/civitai/key/test` |
| 移除 | 有 | `app.js:2091-2104` → `POST /api/civitai/key/remove` |
| 狀態：未設定／已設定／讀取中／結果成功／失敗 | 有 | `app.js:1995-2019`、`2034-2051` |
| 「正在驗證中」獨立狀態 | 部分：`busy` 只禁用按鈕（`app.js:2016-2018`），狀態文字不顯示「驗證中」 | `app.js:2075-2089` |
| 取得 API Key 的引導／連結 | **沒有** | 全 repo 搜尋「取得／申請／civitai.com/user」在 UI 程式碼中 0 命中；只有後端 401 錯誤文案 `server.py:815` 提到「Civitai 帳號設定 > API Keys」，以及 `index.html:380` 的風險說明。既有報告 `lora-personal-api-key-audit.md:238` 建議的 `https://civitai.com/user/account` 從未進入程式碼。 |
| 錯誤訊息白話程度 | 尚可（401/403/429/5xx/離線都有中文下一步） | `server.py:811-835` |

### 3.2 後端保存與安全：【已驗證】

- 位置和格式：`server.py:115-120` `KEY_FILE_NAME="civitai_key.bin"`、`_KEY_PATH=%LOCALAPPDATA%\SidSimpleUI\civitai_key.bin`、`_KEY_BODY_LIMIT=4096`、正式 `/me` URL 固定。
- DPAPI(CurrentUser)：`server.py:130-188`，`CryptProtectData`/`CryptUnprotectData`，flags `0x1 = CRYPTPROTECT_UI_FORBIDDEN`，description `"SidSimpleUI Civitai Key"`，未使用 `CRYPTPROTECT_LOCAL_MACHINE`。
- 驗證：`server.py:191-201`（8～512 字、無空白控制字元）。
- 原子寫入：`server.py:204-220`（`mkstemp` + `fsync` + `os.replace`）。
- 最小暴露：`server.py:222-271`（save/read/remove）；`:238-260` 明文只在區域變數解密，不快取全域。
- 狀態端點：`server.py:274-282` `key_status()` 只回 `{configured, error}`，**永不回傳 Key 或密文**。
- Host guard：`server.py:285-312` `_civitai_auth_allowed()` 只接受 HTTPS + `civitai.com` + port 443（`:0443` 亦接受）+ 無 URL 帳密；`:726-740` `_NoRedirectHandler` 封鎖帶 Bearer 的跨 Host 3xx。
- 路由：`server.py:1726-1727`（GET status）、`:1768-1773`（POST set/test/remove）；handler `:1916-1991`（`X-SimpleUI: 1` + Origin 白名單、body 上限、白名單回傳欄位）。
- 重開後仍在：密文檔寫在使用者資料目錄，重啟 server 後 `key_status()` 重新讀檔即可恢復【靜態推論，未做重啟實測】。
- 洩漏路徑檢查【已驗證】：`_civitai_key_error()` 明確不回顯 header/body/Key/例外（`server.py:811-835`）；`/me` 只回 `username`、`tier` 白名單欄位（`server.py:1980-1983`）；前端 Key 狀態只在記憶體（`app.js:41-43`）；`X-SimpleUI` guard 阻擋跨站寫入（`server.py:1917-1927`）。離線測試 `lora_personal_key_test.py` 涵蓋 redirect 不帶 Bearer 到第二 Host、mock host 永不收真 Key。

### 3.3 最關鍵缺口：Key 目前「沒有實際用途」【已驗證】

`server.py` 中 `_civitai_get()` 支援 `auth=True` 才會附加 Bearer（`:743-782`），但**正式呼叫端只有兩個，且都使用預設 `auth=False`**：

- `server.py:1008` `civitai_search()` → `_civitai_get(path)`
- `server.py:1124` checkpoint 查詢 → `_civitai_get("/models?" + ...)`

`read_api_key()` 的正式呼叫端只有：

- `server.py:279`（狀態探測）
- `server.py:1970`（`/api/civitai/key/test` → `_civitai_me()`）

也就是說：

> **API Key 目前只被「存起來」和「拿去 /me 測試」。它沒有解鎖任何搜尋、任何私密／gated 內容，也沒有任何下載功能。** 這與既有報告 `lora-personal-api-key-design-review.md:49` 的判斷一致：「階段 A 的 Key 管理對使用者只有保存與 /me 測試價值，尚未解鎖任何搜尋或下載能力」。

`server.py` 中**沒有任何下載路由**：`do_GET`/`do_POST` 分派表（`:1700-1774`）沒有 `/api/civitai/download`、`/api/download` 或任何寫入 safetensors 的端點；grep `download` 在 server.py 只命中 Civitai 回傳的 metadata 欄位（`:952`、`:968`、`:982`）。前端探索中心的卡片只提供「在 Civitai 開啟這個版本 ↗」外連（`app.js:2163`、`:2263`、`:2368`），沒有「下載／安裝」按鈕。

### 3.4 依任務要求分類

| 分類 | 內容 |
|---|---|
| ① 已實作且可從程式碼確認 | DPAPI CurrentUser 加解密、原子寫入、key status/test/set/remove API、前端輸入／儲存／測試／移除／狀態渲染、host guard、redirect 封鎖、錯誤白話化、Key 不進 localStorage／log／回應 |
| ② 後端有但前端沒有入口 | 無。四個 Key API 前端都有對應呼叫；`auth=True` 是後端内部能力，不是「後端已支援但前端沒入口的 API」，而是**完全沒有呼叫端** |
| ③ 只有部分實作 | 「取得 Key 引導」完全沒有；「驗證中」狀態只有按鈕 disabled；「顯示 Key」沒有；Key 的實際用途只有 /me |
| ④ 目前無法證明 | 重啟後保存是否如預期（未重啟實測）；真實 Civitai /me 驗證（禁止呼叫）；「一般使用者能否順利找到入口」（未做使用者測試／瀏覽器 E2E） |

---

## 4. LoRA 從 UI 到 ComfyUI 工作流的完整追蹤

### 4.1 前端選擇、權重、Trigger Words【已驗證】

- 狀態：`app.js:35` `S.loras`、`:596` 從 `ui.loras` 讀回（I/O 格式見 `:471-483` `loraSerialize()`）。
- 清單來源：`app.js:1765-1810` `refreshLoraList()` → `GET /api/loras`；`server.py:610-627` → ComfyUI 原生 `/models/loras`；handler `server.py:1818-1830`。**清單就是 ComfyUI 自己看到的檔案**，不是自己掃資料夾。
- 選取／取消：`app.js:2471-2498`，`loraSet()` 設定 `enabled`；停用項目保留在 localStorage（刻意設計）。
- 權重：`app.js:1716-1717`（range −2～2 / number −100～100）、`:1724-1742` 輸入與保存。核心 `loraWeight()` 在 `:405-409`，只擋非數值與超過 ±100。
- Trigger Words：`app.js:2396-2479`，可手動新增／編輯／刪除、可從 safetensors metadata「帶入」（`:2546-2555`）。metadata 來源 `app.js:2454-2468` → `/api/lora-meta` → `server.py:666-686` → ComfyUI `/view_metadata/loras`。
- 自動加入邏輯：`app.js:534-547` `loraTokensFromSnapshot()`——只有 `autoTrigger !== false` 且该 LoRA 有 `triggers` 才會加；跨 LoRA 去重。開關在 `:2435`、`:2559-2567`。
- 保存／還原：`app.js:1662-1664` `loraSave()` → `ui.loras`；歷史還原 `:1063-1081` `reusePrompt()`（有 `loras` 欄位就完整還原並 `enabled:true`）。
- 生圖 snapshot：`app.js:320-347` `snapshotNow()`，一次取 `sel`/`pos`/`neg`/設定/`loras`/`loraTokens`；`:311-316` `composePrompt()` 也用同一份邏輯。_trigger words 進 positive prompt_ 在 `:330` `parts.push(...loraTokens)`。

### 4.2 後端工作流：【已驗證，程式碼層級正確】

`app.js:550-592`（此段在 HEAD 中已存在，不屬本輪 uncommitted diff）：

```
wf(o) 建立節點 1..7：
 1 CheckpointLoaderSimple   ckpt_name
 2 CLIPTextEncode           pos, clip=["1",1]
 3 CLIPTextEncode           neg, clip=["1",1]
 4 EmptyLatentImage
 5 KSampler                 model=["1",0], positive=["2",0], negative=["3",0]
 6 VAEDecode                 samples=["5",0], vae=["1",2]
 7 SaveImage                 images=["6",0]
return loraApplyToWorkflow(nodes, o.loras)
```

`loraApplyToWorkflow()`（`:551-576`）：

- 只接受 `loraNameOk()` 成立的名稱（`:412-419`：相對路徑、不可跳脫、**只收 `.safetensors`**）。
- 從 Checkpoint 的 `MODEL=["1",0]`、`CLIP=["1",1]` 開始，依加入順序建立 `id = max(數字 id)+1` 的 `LoraLoader`。
- 每顆都同時接 `model`/`clip`，輸出 `[id,0]` / `[id,1]` 給下一顆 → **多 LoRA 串接順序正確**。
- `strength_model` / `strength_clip` 由同一 `strength` 帶入（可個別覆寫）。
- 最後把 `nodes["2"].inputs.clip`、`nodes["3"].inputs.clip` 指向最後 CLIP，`nodes["5"].inputs.model` 指向最後 MODEL。
- VAE 仍由 node 1 提供（正確）。

送出：`app.js:748-778`，`o.loras = snap.loras`，`JSON.stringify({ prompt: wf(o) })` → `POST /comfy/prompt`（由 `server.py::_proxy()` 轉送）。**只有一處 `wf()` 呼叫**（grep 全檔僅 `:578` 定義、`:777` 呼叫），不存在「UI 用新設定但後端用舊 snapshot」的第二條路徑。

### 4.3 哪些證據能證明 LoRA 參與推論、哪些不能【已驗證】

**能證明（程式碼／離線測試層級）**

- 離線核心測試 `devtools/lora_core_test.mjs` 17 項全過，其中：
  - PASS 2「一個 LoRA：MODEL 與 CLIP 都經 LoraLoader，權重回填」
  - PASS 3「三個 LoRA：依加入順序串接，各自權重獨立」
  - PASS 5「每次生成都從乾淨 Workflow 開始」
  - PASS 6-8、15-16 涵蓋 Trigger Words 去重、snapshot 職責分離與舊格式相容。
- `app.js:759` 生成紀錄會寫 `loras: snap.loras.map(l => l.name + "@" + l.strength)`；`:820` 歷史項目保存完整 `snap.loras`。

**不能證明（真實效果層級）**

依任務列的六項，目前**沒有一項能單獨證明效果**；本輪也沒有任何真實 ComfyUI 執行證據：

| 情境 | 目前證據 |
|---|---|
| LoRA 出現在選單 | 只證明 ComfyUI `/models/loras` 看得到檔案 |
| API 回傳成功 | 只證明 HTTP 200 |
| 檔案下載成功 | **本專案沒有下載功能**；瀏覽器下載 ≠ ComfyUI 可見 |
| JSON 含 `LoraLoader` | 離線測試已證明，但不證明 ComfyUI 真的載入權重 |
| ComfyUI 接受請求 | 只通過 prompt 驗證，不代表視覺效果 |
| 生圖沒報錯 | 只代表 graph 執行完畢 |

**【尚未實測】**：同一 seed 開／關 LoRA 的 A/B 圖、ComfyUI console 是否出現 LoRA 載入訊息或 `lora not found`、`/history/<pid>` 的實際 prompt JSON、`/view` 輸出比對。本輪不得推測成功或失敗。

### 4.4 可能造成「看不出效果」的具體風險因素（未確認為根因）

以下都是從程式碼可指出、但**必須真實環境驗證**的因素；不應直接宣稱任何一項就是根因：

1. **沒有 in-app 下載** → 使用者必須手動把 safetensors 放到 ComfyUI 認得的位置。放錯目錄時不會出現在選單，但「瀏覽器下載成功」會讓使用者以為已完成。
2. **`comfy_lora_paths.py` 無法可靠回答「Live ComfyUI 的實際 LoRA 目錄」**。其檔案 docstring（`:1-9`）明言：短命子程序重 import `folder_paths`、重讀 YAML 只得到「重建候選」，**不能證明 live process 的路徑**（prestartup script 可在 `apply_custom_paths()` 後改寫，YAML 也可能啟動後被改）；最高只給 B 級，`usable=False`，A 級需要 live process 的獨立驗證來源「目前沒有」。該檔是 untracked、**沒有被 `server.py` import 或呼叫**（grep `comfy_lora_paths` / `resolve_lora_paths` 在 server.py 0 命中）。因此不能拿它當「下載目標目錄已解決」的證據。
3. **多目錄同名遮蔽**：既有報告（`lora-personal-api-key-phase-b-audit-r2.md:137-151`、`phase-b-implementation-spec.md:204-241`）指出 ComfyUI `folder_paths.get_full_path()` 依註冊順序回第一個存在檔案，前面的同名檔會遮蔽後面的；Windows 不分大小寫。若使用者下載的新檔與前 directories 中同名舊檔不同內容，ComfyUI 可能載入舊檔。【靜態推論，需 live 驗證】
4. **Trigger Words 可能根本不存在**：metadata 只從 safetensors `__metadata__` 取（`server.py:630-663`），ComfyUI 對「沒有 metadata」與「檔案不存在」都回 404，後端當成 `NO_METADATA`（`:679-685`）。此時 `triggers=[]`，`loraTokensFromSnapshot()` 不加任何詞。角色／概念 LoRA 沒有觸發詞時，最容易出現「權重有套但看不出差異」。
5. **相容性只提示不攔截**：探索中心會把版本分成「完全適配／需要確認／不建議」（`app.js:2142-2165`），但本機選取流程（`app.js:2471-2498`）完全不檢查基底。把 Pony / SD 1.5 LoRA 套到 `WAI-Nsfw-Illustrious-17.safetensors`（Illustrious / SDXL 系）上，效果可能不明顯或異常。
6. **只收 `.safetensors`**：`loraNameOk()`（`app.js:418`）與 `_lora_name_ok()`（`server.py:596`）都只接受 `.safetensors`。`.pt` / `.ckpt` 形式的 LoRA 會被清單與工作流同時忽略（mock 測試 `devtools/lora_mock_comfy.py:30` 的 `legacy\Old.pt` 正是用來驗證此行為）。
7. **沒有執行期確認**：`waitFor()`／錯誤處理（`app.js:793-808`）只看 status/messages 與輸出節點 `"7"`，沒有任何「LoraLoader 是否真的載入該 lora_name」的斷言。

---

## 5. 發現的問題及其實際根因（若已能確認）

### 問題 A：API Key 使用體驗

- **可確認的根因（產品完整性）**：Key 的管理功能已做得很完整，但**功能鏈在「保存」之後就斷了**——`auth=True` 無呼叫端、沒有下載端點（`@`/`### 3.3`）。因此「沒有明確設定入口」「不知道如何開始」不只是 UI 找不到，而是**即使找到了也不知道設定它要做什麼**。
- **可確認的 UI 缺口**：取得 Key 的引導／外連完全不存在；入口藏在二級 Modal；沒有「顯示 Key」；「驗證中」只表現為按鈕禁用。
- **不可確認**：是否因為「使用者找不到入口」而導致抱怨——未做真實使用者／瀏覽器測試。

### 問題 B：LoRA 無效果

- **目前無法確認根因**。程式碼層級的證據反而指向「工作流建得對」：`wf()` 與 `loraApplyToWorkflow()` 的 MODEL/CLIP 串接、多 LoRA 順序、權重回填都被 17 項離線測試覆蓋。
- **可確認的支援性缺口**（會讓問題難以診斷或容易發生，但不等於根因）：無 in-app 下載、`comfy_lora_paths.py` 不可靠且未接線、同名遮蔽風險、Trigger Words 可能為空、相容性不攔截、只收 `.safetensors`、無執行期驗證。
- **明確不做推測**：沒有真實 ComfyUI 執行證據，不能說「LoRA 沒有參與推論」，也不能說「已經正常」。

### 不要假設兩個問題有共同根因

A 是「Key 沒有下游用途」的功能完整性問題；B 是「工作流正確但效果未經真实验證」的驗證／環境問題。兩者共享的只有 Civitai 探索中心這個 UI 入口，以及「下載」這個目前不存在的能力。把它們合併成單一根因會導致錯誤修正方向。

---

## 6. 關鍵程式碼位置與行號

| 主題 | 檔案 | 行號 |
|---|---|---|
| Key 常數／路徑 | `server.py` | 112-120 |
| DPAPI protect/unprotect | `server.py` | 130-188 |
| Key 驗證／原子寫入 | `server.py` | 191-220 |
| save/read/remove/status | `server.py` | 222-282 |
| Bearer host guard / no-redirect | `server.py` | 285-312, 726-740 |
| `_civitai_get(auth)` | `server.py` | 743-782 |
| `_civitai_me` / 錯誤對照 | `server.py` | 785-835 |
| 正式呼叫端（都未帶 auth） | `server.py` | 1008, 1124 |
| 路由分派 | `server.py` | 1700-1774 |
| Key handler / guard | `server.py` | 1916-1991 |
| LoRA 清單／metadata | `server.py` | 585-686, 1818-1859 |
| LoRA 清單 handler | `server.py` | 1718-1721 |
| Key UI 狀態 | `app.js` | 36-44, 1994-2019 |
| Key 動作 | `app.js` | 2021-2104 |
| Modal 開關 | `app.js` | 1975-1992 |
| Key 事件綁定 | `app.js` | 3210-3224 |
| Key DOM | `index.html` | 359-410（Key 部分 368-380） |
| Key CSS | `app.css` | 985-993 |
| LoRA 核心（解析／snapshot／tokens） | `app.js` | 388-548 |
| `loraApplyToWorkflow` / `wf` | `app.js` | 550-592 |
| 生成 snapshot／送出 | `app.js` | 320-347, 700-808 |
| 歷史還原 | `app.js` | 1063-1081 |
| 本機清單與驗證 | `app.js` | 1649-1843 |
| Trigger Words 面板 | `app.js` | 2396-2479, 2505-2577 |
| 探索中心卡片／外連 | `app.js` | 2142-2246, 2315-2348 |
| 路徑解析器 docstring | `comfy_lora_paths.py` | 1-9 |
| 子程序 probe 重建路徑 | `comfy_lora_paths.py` | 530-551 |
| 檔名安全／同名 | `comfy_lora_paths.py` | 554-610 |

---

## 7. 兩個問題之間的關聯及完整資料流

```
使用者設定 API Key
   → 後端 DPAPI 保存        【已確認正常】(server.py:222-282)
   → /me 驗證               【已確認程式碼存在；真實呼叫尚未實測】
   → Civitai API 請求       【部分完成】搜尋/checkpoint 仍匿名，auth=True 無呼叫端
   → LoRA 下載              【斷點】沒有任何下載路由／按鈕
   → LoRA 檔案儲存          【斷點】comfy_lora_paths.py 只給 B 級候選且未接線
   → ComfyUI 辨識           【已確認正常】/api/loras 就是 ComfyUI /models/loras
   → 前端選擇 LoRA          【已確認正常】app.js:2471-2498
   → 權重與 Trigger Words   【部分完成】權重正确；triggers 可能為空；相容性不攔截
   → 生圖 snapshot          【已確認正常】app.js:320-347, 753
   → 後端建立工作流         【已確認正常】app.js:550-592 + 17 項離線測試
   → ComfyUI 執行推論       【尚未實測】本輪無真實生圖，不能推測效果
```

**斷點整理**

| 斷點 | 影響 |
|---|---|
| Key → 任何實際用途 | Key 只用於 /me，使用者看不到設定它的回報 |
| Civitai → 本機檔案 | 沒有下載功能；「下載成功」只發生在使用者自己的瀏覽器 |
| 本機檔案 → ComfyUI 真正載入的檔案 | 目錄無法可靠得知；多目錄同名可能遮蔽 |
| Trigger Words → positive prompt | metadata 缺失時不會自動加入，且沒有生成前提醒 |
| 工作流 → 可觀察效果 | 沒有執行期驗證或 A/B 對照機制 |

---

## 8. 已執行的測試與結果

全部為離線／mock／靜態，未碰正式 7860/8188、未呼叫真實 Civitai、未使用真實 Key。為避免寫入 `__pycache__`，Python 執行前設定 `PYTHONDONTWRITEBYTECODE=1`。

| 項目 | 結果 |
|---|---|
| `node --check app.js`、`node --check tags.js` | 通過 |
| `python -c "ast.parse(server.py / comfy_lora_paths.py)"` | `AST OK` |
| `node devtools/lora_core_test.mjs` | **17 tests passed**（含 LoRA MODEL/CLIP 串接、順序、權重、trigger、snapshot） |
| `node devtools/lora_explorer_core_test.mjs` | **21 tests passed**（相容性分類、圖片安全） |
| `node devtools/lora_personal_key_ui_test.mjs` | **13 UI static checks passed**（password、同源 header、不進 localStorage、無 query token 等） |
| `python devtools/comfy_lora_paths_test.py` | **47 tests OK**（檔名安全、WMI/PEB 身分、 grades；重建只給 B 級） |
| `python devtools/lora_personal_key_test.py` | **12 tests passed**（DPAPI round-trip、401/403/429、redirect 封鎖、公開搜尋維持匿名、mock 永不收真 Key） |
| `python devtools/lora_explorer_api_test.py` | **35 tests passed**（checkpoint 精確比對、快取、NSFW 正規化、錯誤對照） |

合計 **145 項離線斷言／檢查全數通過**。

補充只讀觀察【已驗證】：`Get-CimInstance Win32_Process` 顯示 ComfyUI（PID 1760，命令含 `ComfyUI\main.py --output-directory D:\ComfyUI_output`）與**恰好一個** simple_ui server（PID 12424，`C:\ComfyUI\simple_ui\server.py`）。目前沒有觀察到 AGENTS.md 警告的「多個 server.py 同時綁 7860」現象；本輪也未干預任何行程。

---

## 9. 未執行的測試及原因

| 未執行 | 原因 |
|---|---|
| 真實 Civitai `/me`、任何真實 API Key | 任務明確禁止 |
| 任何模型下載／`downloadUrl` 請求 | 任務明確禁止 |
| 真實生圖／GPU／A/B 對照 | 任務明確禁止高負載與真實生圖 |
| 啟動／停止／重啟 ComfyUI、Simple UI、WD14 Worker | 任務明確禁止 |
| 瀏覽器 E2E 操作正式 `http://127.0.0.1:7860` | 唯讀約束；且 `browse.eval` 在隔離世界看不到 `window.Tags`，不能替代真功能驗證 |
| `codegraph sync` | 唯讀約束（會寫入索引） |
| `python -m py_compile` | 會建立 `__pycache__`；改以 `ast.parse` 等價語法檢查 |
| `devtools/lora_ui_test.mjs`（需瀏覽器／mock relay） | 本輪不做瀏覽器自動化；改以靜態 UI 測試覆蓋 |

---

## 10. Git 最終狀態

```
## main...origin/main [ahead 1]
 M app.css
 M app.js
 M devtools/lora_explorer_api_test.py
 M devtools/lora_explorer_core_test.mjs
 M devtools/lora_mock_civitai.py
 M devtools/lora_ui_test.mjs
 M devtools/test_ui_control_wd14.ps1
 M index.html
 M server.py
 M ui_control.ps1
 M ui_panel.ps1
 M ui_panel.pyw
?? comfy_lora_paths.py
...（其餘 38 項 untracked 與開始時相同）
?? devtools/reports/lora-personal-api-key-and-application-audit.md   ← 本報告（唯一新增）
```

與開始狀態比較：**12 項 tracked modified 完全不變、staged 仍為 0、既有 39 項 untracked 一項未動**，只多出本報告。沒有 commit、push、stash、checkout、clean、restore 或任何 Git 寫入。

---

## 11. 正式服務是否受到影響

**沒有受到影響**【已驗證】：

- 未呼叫任何狀態改變 API、未停止或重啟任何行程。
- 只讀取行程清單與命令列；ComfyUI 與唯一一個 simple_ui server 仍在原狀態。
- 未修改模型、Workflow、輸出圖片、localStorage、Key 檔或任何設定。
- 離線測試使用本機隨機 port mock、temp 資料夾、假金鑰，並設定不寫 bytecode；測試後 Git 狀態與開始時一致。

---

## 12. 尚未解決的風險

1. **Key 無下游用途**：使用者投入時間設定後得不到任何可見回報，是最大的產品風險。
2. **沒有下載能力**：「找到 LoRA → 在本機使用」這條最短路徑仍然不存在；這是 A、B 兩問題共同的上游缺口。
3. **LoRA 效果未經真實驗證**：工作流正確 ≠ 視覺效果正確；在拿到 A/B 證據前，不應對外宣稱 LoRA 功能正常，也不應宣稱已壞。
4. **LoRA 目錄不可靠**：`comfy_lora_paths.py` 自承只能給重建候選，且未接線；若未來做下載，選錯目錄會讓檔案「下載成功但 ComfyUI 看不到」。
5. **同名遮蔽**：多 LoRA 目錄下同名不同 content 時，ComfyUI 可能載入舊檔；沒有任何 UI 提示。
6. **Trigger Words 靜默為空**：角色 LoRA 沒有觸發詞時，使用者不會在生成前被提醒。
7. **基底不相容不攔截**：探索中心的分類結果沒有帶到本機選取／生成流程。
8. **Key 的安全邊界**：DPAPI 只保護靜態資料，同一 Windows 使用者下的惡意程式仍可讀取；Full Access Key 是帳號層級高權限，`index.html:380` 已有風險說明但沒有「取得最小權限」的替代方案。
9. **索引落後**：CodeGraph pending 4 added / 2 modified；查詢新符號需以磁碟現況為準。

---

## 13. 建議的最小修正方案與實作順序

原則：先驗證、再補最小缺口；不為了這次問題擴張成通用下載管理器或 OAuth 架構。

### 第 0 步（不需要改程式碼，優先做）

在一次真實生圖中做 **同 seed、同提示詞、同 checkpoint、只開／關 LoRA 的 A/B 對照**，並記錄：

- ComfyUI console 是否出現 `lora_name` 載入或 `lora not found`；
- `/history/<pid>` 中實際送出的 prompt JSON 是否含 `LoraLoader` 與正確 `lora_name`；
- 該 LoRA 的Trigger Words 是否真的進了 positive prompt；
- 兩張圖是否存在可辨識差異。

這一步決定 B 是「程式碼 bug」還是「預期／環境問題」，避免對著正確的工作流亂改。

### 第 1 步：讓 API Key 有明確目的（最小）

- 在探索中心的 Key 說明旁加入**「到 Civitai 取得 API Key」外連**（`https://civitai.com/user/account`，target=_blank + noopener）與一行白話：「目前這把 Key 只用於連線測試，還不能用來自動下載。」
- 加上「顯示／隱藏 Key」按鈕，並在 `busy` 时把狀態文字改成「正在驗證…」。
- 若短期內不做下載，考慮把 Key 區塊標為「進階／選用」，避免初學者以為必填。

### 第 2 步：補最小下載（若第 0 步確認需要；既有設計已足夠，不要重新設計）

- 沿用 `devtools/reports/lora-personal-api-key-phase-b-implementation-spec.md` 的範圍：**primary file、單一任務、進度、可取消、SHA256 驗證、`.part` + 原子改名、失敗清理、同名保護、完成後刷新 `/api/loras`**。
- 只用版本 ID 當輸入，下載 URL 由後端向 Civitai 取得並驗證 host；401/403/429 用既有 `auth=True` + no-redirect 機制。
- 誠實標記目錄可靠度：在拿到 live process 的 A 級證據前，不要把 `comfy_lora_paths.py` 的重建候當成「已確認的目標目錄」對使用者展示。

### 第 3 步：把「看不出效果」的常見原因變成可見提示（最小）

- 生成前若 `loraEnabled()` 非空但任一筆 `triggers.length === 0`，在警告列明確顯示「這個 LoRA 沒有觸發詞，可能看不出效果；可到『角色 LoRA → 觸發詞』新增，或到 Civitai 版本頁複製 trainedWords」。
- 在角色 LoRA 選單顯示**完整相對名稱**（含子資料夾），降低同名檔案混淆。
- 把探索中心的相容性分類（完全適配／需要確認／不建議）延伸到「本機已加入的 LoRA」與生成前警告；不攔截，只提醒。

### 第 4 步：只收 `.safetensors` 的透明化

- 若支援 `.pt`／`.ckpt` 不是目標，至少在選單空狀態或說明中寫「目前只認 `.safetensors`」，避免使用者以為檔案壞掉。

### 明確不建議

- 不要把 `comfy_lora_paths.py` 直接接進下載流程並宣稱路徑已解決（它自己已說明只能給 B 級候選）。
- 不要为了让 Key「有用」而把 Bearer 加到匿名公開搜尋（`lora-personal-api-key-design-review.md:73` 已指出會擴大憑證使用範圍）。
- 不要在沒有 A/B 證據前重寫 `wf()` / `loraApplyToWorkflow()`；離線測試已證明其結構正確。

---

## 14. 結論一句話

API Key 的問題是「**後端做得很完整，但下游用途是空的，且取得引導不存在**」；LoRA 的問題是「**工作流程式碼正確且通過離線測試，但效果完全未經真實環境驗證，且周邊（下載、目錄、觸發詞、相容性）存在多個可見缺口**」。兩者不應被當成同一個根因處理；先做真實 A/B 驗證，再依上面順序補最小缺口。
