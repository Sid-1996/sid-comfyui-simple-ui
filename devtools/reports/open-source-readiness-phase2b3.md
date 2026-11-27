# Phase 2B-3：輸出目錄外部化與刪圖安全 — 唯讀調查報告

## 1. 任務目標與唯讀聲明

### 1.1 目標

讓公開版 Sid-simple-ui 能配合使用者自己的 ComfyUI 輸出目錄，並確保刪圖功能在「找不到圖片」或「無法確認刪除結果」時，不會錯誤回報成功、也不會錯誤移除歷史紀錄。

### 1.2 唯讀聲明

本次**僅調查，未實作、未修改任何程式碼/Workflow/localStorage/圖片**。

已執行的動作僅限於：

- 讀取 `C:\ComfyUI\AGENTS.md`、Repo 內 `README.md`、`devtools/README.md` 與既有階段報告。
- Git 唯讀查詢（`status`、`rev-parse`、`log`、`remote`、`rev-list`）。
- 以 CodeGraph（`codegraph_explore`）與 Grep/Read 閱讀原始碼。
- 讀取本機已安裝 ComfyUI（`C:\ComfyUI\ComfyUI_windows_portable\ComfyUI`）的原始碼做 API 相容性調查。
- 執行一段**不寫檔、不刪檔**的 Python 路徑解析分析（見第 7 節）。
- 建立本報告（唯一新增檔案）。

未啟動、停止或重啟 ComfyUI / simple_ui server / WD14 Worker；未生圖；未安裝或更新套件；未 commit / push / reset / restore / stash / checkout / clean；未修改任何正式圖片或 localStorage。

---

## 2. Repository 狀態

| 項目 | 實際值 |
|---|---|
| Repository | `C:\ComfyUI\simple_ui` |
| 分支 | `main`（`## main...origin/main`，未切換） |
| HEAD（開始時） | `f7d5c412078278195280cc21709c2b7179cdc720`（與任務指定一致） |
| HEAD（結束時） | 同上，未變動 |
| HEAD commit | `2026-11-23 09:39:20 +0800` — `feat: support configurable local ComfyUI endpoint` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 同一個） |
| 與遠端差距 | `git rev-list --left-right --count HEAD...origin/main` → `0 0` |
| 已追蹤修改 | 無 |
| 未追蹤檔案（開始時） | `devtools/reports/open-source-readiness-phase1.md`、`phase2a.md`、`phase2b1.md`、`phase2b2.md`（全部保留，內容未動） |
| 未追蹤檔案（結束時） | 上列四份 + 本報告 |
| Git 寫入 | 無 |

上一階段（Phase 2B-2）的修改已進入 HEAD，因此本報告描述的是**已包含 `COMFY_URL` 支援的目前 HEAD**，不是修改前版本。

---

## 3. `OUTPUT_DIR` 所有使用位置及作用

### 3.1 定義

| 位置 | 內容 |
|---|---|
| `server.py:76` | `OUTPUT_DIR = r"D:\ComfyUI_output"` — 寫死的字串常數，無環境變數覆寫 |

### 3.2 使用點（server.py 內共 4 處）

| 位置 | 用途 | 對公開版的影響 |
|---|---|---|
| `server.py:162-167` | `start_comfy()` 以 `subprocess.Popen` 啟動 ComfyUI，傳入 `--output-directory OUTPUT_DIR`（`server.py:164`）。僅在**預設模式**會到達；外部模式在 `server.py:585-594` 直接回 409 `EXTERNAL_COMFY`，不會呼叫 `start_comfy()`。 | 公開使用者若按「開始生圖」且未設 `COMFY_URL`，ComfyUI 會被強迫输出到 `D:\ComfyUI_output`；沒有 D: 槽的機器會失敗。 |
| `server.py:560-565` | `GET /open-output` → `os.startfile(OUTPUT_DIR)`；按鈕在 `index.html:34`、`app.js:1518-1519`。 | 公開使用者點「開啟圖片資料夾」會開啟開發者路徑（不存在或不是自己的輸出目錄）。 |
| `server.py:566-568` | `GET /api/status` 回傳 `{"comfy": comfy_up(), "output": OUTPUT_DIR, "external": COMFY_EXTERNAL}`；前端 `app.js:1675-1679` 把 `j.output` 顯示成「圖片存到 …」（`index.html:222`）。 | 公開使用者會看到 `D:\ComfyUI_output`，與實際輸出位置不符。 |
| `server.py:666-671` | `_delete_file()` 用 `root = os.path.realpath(OUTPUT_DIR)` 當作唯一允許的根目錄，並做「檔案不在就回 already」的判斷。 | **本任務的核心問題**：這是刪圖唯一依赖本機輸出目錄的地方，也是已知誤報的來源。 |

### 3.3 Repo 內其他硬編碼輸出路徑（非 `OUTPUT_DIR` 常數本身）

| 位置 | 內容 |
|---|---|
| `ui_control.ps1:104-105` | 控制台啟動 ComfyUI 時也寫死 `--output-directory D:\ComfyUI_output` |
| `README.md:31` | 「圖片輸出預設 `D:\ComfyUI_output`」 |
| `README.md:56-58` | 「路徑說明…請依你的環境修改」 |
| `devtools/wd14_api_test.py:93-96` | 測試用圖片路徑指向 `D:\ComfyUI_output`（僅 devtools，不影響正式服務） |

### 3.4 結論：`OUTPUT_DIR` 是否真的需要存在？

**瀏覽/生成/歷史不需要，只有「刪圖」、「開啟資料夾」、「狀態顯示」、「預設模式代啟動」需要。**

- 生成與瀏覽完全走 `/comfy/*` 代理（`server.py:494-513`），图片由 ComfyUI 自己的 `/view` 提供（詳見第 4 節）。
- 歷史存在性檢查 `_check_files()`（`server.py:606-646`）也是問 ComfyUI 的 `/view`（`server.py:633`），註解與 AGENTS.md:59 都明確要求「不可用檔案系統猜輸出資料夾」。
- 因此目前 `OUTPUT_DIR` 是**只為刪圖等少數功能存在的本機假設**，且這個假設在公開版情境下通常不成立。

---

## 4. 生成圖片、`/view`、歷史紀錄的完整資料流

### 4.1 生成送出

1. `app.js:337`：workflow 節點 `"7"` 為 `SaveImage`，`filename_prefix = "ui_" + o.fileTag`（沒有斜線，所以實務上 `subfolder` 為空字串）。
2. `app.js:413-417`：`api("/prompt", {method:"POST", body: JSON.stringify({prompt: wf(o)})})`。
3. `app.js:49-57`：`api()` 把路徑加上前綴 `/comfy`，所以實際請求是 `/comfy/prompt`。
4. `server.py:558-559` + `494-513`：`_proxy()` 把 `/comfy` 前綴去掉，轉成 `COMFY + "/prompt"`，`COMFY` 由 `COMFY_URL` 決定（`server.py:28-71`），封包原文轉送。
5. `server.py:500-501`：若是 `/prompt` POST，額外寫診斷檔 `logs/gen_requests.jsonl`（`_log_gen_request`，`server.py:515-552`），不影響生成。

### 4.2 取得結果

6. `app.js:432`：`waitFor(pid)` 輪詢 `/history/{pid}`（實際請求見 `app.js:508`），同樣經 `/comfy` 代理。
7. `app.js:445`：從 `hist.outputs["7"].images` 取得 ComfyUI 回傳的圖片陣列。此陣列元素的形狀由 ComfyUI 的 SaveImage 節點決定；本機安裝版本可見 `comfy_extras/nodes_images.py:2234`、`2260` 明確回傳 `{"filename": ..., "subfolder": ..., "type": "output"}`。

### 4.3 前端圖片物件與歷史紀錄

8. `app.js:449-460`：每個 `f` 轉成：

   ```js
   {
     url: "/comfy/view?filename=" + encodeURIComponent(f.filename) +
          "&subfolder=" + encodeURIComponent(f.subfolder || "") +
          "&type=" + (f.type || "output"),
     filename: f.filename, seed, w, h,
     sel, extra, neg, prompt, at: Date.now()
   }
   ```

   注意：`filename` / `subfolder` 是**間接存在 URL 的 query 裡**，本機欄位只有 `filename`；`type` 未做 `encodeURIComponent`（實務上固定 `output`）。

9. `app.js:462-464`：`S.results = items`、`S.gallery = [...items, ...S.gallery].slice(0, 24)`、`saveJSON("ui.gallery", S.gallery)`。這就是歷史紀錄的唯一持久化位置（key `ui.gallery`，`app.js:31`）。**紀錄只存相對 URL 與檔名，沒有存絕對本機路徑。**
10. 顯示處：`app.js:543`（舞台 `<img>`）、`app.js:571`（歷史縮圖）、`app.js:662`（燈箱）、`app.js:685`（下載用 `it.url`）。

### 4.4 圖片載入（`/view`）

11. 瀏覽器 `GET /comfy/view?filename=...&subfolder=...&type=...` → `server.py:558-559` → `_proxy()`（`server.py:494-513`）→ `COMFY + "/view?..."`。
12. ComfyUI 端 `server.py:599-749`：
    - `server.py:621` `folder_paths.annotated_filepath(filename)` 處理 `[output]` 等前綴（`folder_paths.py:266-279`）。
    - `server.py:631-632` 依 `type` 呼叫 `folder_paths.get_directory_by_type(type)`；對應關係在 `folder_paths.py:229-236`：`output → get_output_directory()`、`temp → get_temp_directory()`、`input → get_input_directory()`。
    - `server.py:637-641` 用 `os.path.commonpath` 擋 subfolder 穿越（不自上而下跳脫）。
    - `server.py:643-646` `file = os.path.join(output_dir, filename)` 且 `os.path.isfile(file)` 才回檔，否則 `server.py:749` 回 404。
13. ComfyUI 的 output directory 來源：`folder_paths.py:69` 預設 `<base_path>/output`；`main.py:156-159` 在啟動時讀 `--output-directory` 並呼叫 `folder_paths.set_output_directory()`（`folder_paths.py:123-141`）。

**關鍵結論：只要 ComfyUI 自己知道檔案在哪，`/comfy/view` 就能顯示圖片，與 simple_ui 的 `OUTPUT_DIR` 完全無關。**

### 4.5 歷史存在性同步（`already` 的另一條路徑）

14. `app.js:591-647` `syncGallery()`：從每個 `it.url` 解析 `filename/subfolder/type`（`app.js:595-601`），POST 到 `/api/check`（`app.js:603-607`）。
15. `server.py:606-646` `_check_files()`：
    - `server.py:619-621`：若 `comfy_up()` 為 false，回 `{"missing": [], "comfy": false}`，前端 `app.js:610-611` 直接 return、**不刪任何紀錄**（這條防護是正確的，應保留）。
    - `server.py:628-633`：對每個檔案打 `HEAD COMFY + "/view?..."`。
    - `server.py:637-643`：404/410 視為 missing；其他 HTTP 錯誤視為還在；網路錯誤累計 3 次回 `comfy:false`。
    - `server.py:645`：把整筆 `it` 放進 `missing`。
16. `app.js:612-615`：前端用 `(j.missing || []).map(x => x.filename)` 建立 Set，**只以 filename 比對**（忽略 subfolder/type），再從 `S.gallery` 過濾並寫回 localStorage。
17. 觸發時機：`app.js:1687`（開頁）、`1688-1695`（focus / visibilitychange / 每 45 秒）、`app.js:559, 581, 1686`（圖片載入失敗時先隱藏再同步）。

### 4.6 ComfyUI 本身沒有刪檔 API

在已安裝 ComfyUI `server.py` 中，找到 `POST /history`（清歷史）、`POST /queue`（`delete` 佇列項）、`POST /interrupt`，但**沒有任何唯讀以外的檔案刪除 endpoint**（以 `routes.delete` / `os.remove` / `unlink` / `delete.*route` 搜尋皆無符合）。因此 simple_ui 的「刪圖」只能靠本機檔案系統操作，這正是必須知道真實輸出目錄的原因。

---

## 5. 刪圖前後端完整呼叫鏈

### 5.1 前端

| 步驟 | 位置 | 行為 |
|---|---|---|
| 1 | `app.js:549`（舞台「刪除」）、`app.js:573`（歷史縮圖 `×`） | 兩個刪除入口 |
| 2 | `app.js:1554-1571`、`app.js:1572-1582` | 事件委派，`confirmDelete(it)` |
| 3 | `app.js:709-720` | 確認 Modal；文案「圖片會移到 Windows 資源回收筒（之後還能還原），歷史紀錄也會一起移除」；`btnDoDelete.onclick` → `doDelete(it)` |
| 4 | `app.js:750-751` | 從 `it.url` 的 query 解析出 `subfolder` / `type` |
| 5 | `app.js:753-761` | `POST /api/delete`，body 為 `{filename: it.filename, subfolder, type}` |
| 6 | `app.js:762-765` | `const j = await r.json()`；`if (!r.ok \|\| !j.ok) throw`；通過後**無條件** `dropImages([it.url])`，再 toast |
| 7 | `app.js:766-768` | catch 時 toast「刪不掉：…（檔案可能被鎖住）」，**不更動歷史** |
| 8 | `app.js:723-748` | `dropImages()`：由 URL 比對，移除 `S.gallery`、`S.results`、燈箱項目，並 `saveJSON("ui.gallery", S.gallery)`（`app.js:726`） |

### 5.2 後端

| 步驟 | 位置 | 行為 |
|---|---|---|
| 9 | `server.py:582-603` `do_POST()` | `server.py:599-600` 分派到 `_delete_file()` |
| 10 | `server.py:649-657` | 讀 body，上限 20,000 bytes；解析 JSON |
| 11 | `server.py:658-664` | 驗證：`name` 不可含 `/` 或 `\`；`sub` 去除 `\`→`/`、去掉前後 `/`、不可含 `..`；`typ` 必須等於 `"output"`，否則 400 |
| 12 | `server.py:666-667` | `root = os.path.realpath(OUTPUT_DIR)`；`path = os.path.realpath(os.path.join(root, sub, name))` |
| 13 | `server.py:668-669` | 容器檢查：`dirname(path) == root` 或 `path.startswith(root + os.sep)`，否則 400 |
| 14 | `server.py:670-671` | **`if not os.path.isfile(path): return 200 {"ok": True, "already": True}`** |
| 15 | `server.py:673-674` | `recycle(path)` 成功 → 200 `{"ok":True,"recycled":True}` |
| 16 | `server.py:675-677` | recycle 失敗 → `os.remove(path)` → 200 `{"ok":True,"recycled":False}`（**永久刪除**，與 Modal 文案不符） |
| 17 | `server.py:678-679` | 例外 → 500 `{"ok":False,"error":...}` |
| 18 | `server.py:117-149` `recycle()` | 用 `SHFILEOPSTRUCTW` + `FOF_ALLOWUNDO` 丟資源回收筒；例外或非 0 回傳 False |

### 5.3 狀態語意目前的實際行為

| 後端回應 | HTTP | 前端 `dropImages` | 歷史紀錄 |
|---|---|---|---|
| `{"ok":true,"recycled":true}` | 200 | 執行 | 移除（正確） |
| `{"ok":true,"recycled":false}` | 200 | 執行 | 移除（檔案已被永久刪，但文案說在回收筒） |
| `{"ok":true,"already":true}` | 200 | **執行** | **移除（可能是誤報，見第 6 節）** |
| `{"ok":false,...}` | 400/500 | 不執行 | 保留 |
| 非 2xx 或非 JSON | 任意 | catch → 不執行 | 保留 |

---

## 6. 已知刪圖問題是否仍存在

### 6.1 結論

**仍存在，且呼叫鏈完整可重現。** 目前 HEAD 的 `server.py:670-671` 與 `app.js:762-765` 沒有任何 `already` 的特別處理（全 Repo 搜尋 `already` 只出現在 `server.py:671`，前端零匹配；亦無任何刪圖測試）。

### 6.2 重現條件

| 情境 | 後端狀態 | 結果 |
|---|---|---|
| 使用者自己的 ComfyUI 用預設 `<ComfyUI>/output` 或任意自訂目錄，而 simple_ui 仍指向 `D:\ComfyUI_output`（`server.py:76`） | 檔案在 ComfyUI 目錄，`os.path.isfile(D:\ComfyUI_output\...)` 為 false | 回 200 `already:true` → 前端 `dropImages()` → **檔案還在，歷史紀錄消失** |
| `D:\ComfyUI_output` 不存在或無權限 | `realpath` 不報錯、`isfile` false | 同上 |
| 使用者以 `COMFY_URL` 指向另一個 Port 的 ComfyUI，該 ComfyUI 輸出目錄不同 | 同上 | 同上 |
| 檔案確實被外部刪除 | `isfile` false | 回 `already:true`、移除紀錄（這個情境是正確的） |

後端**無法區分**「檔案本來就不見」與「我找錯輸出目錄」，因為 `_delete_file()` 完全沒有問 ComfyUI（`server.py:649-679` 內沒有 `comfy_up()` 或 `/view` 呼叫），也沒有比對 `subfolder`/`type` 的可靠性。

### 6.3 附加問題

- `comfy_up()` 未參與刪圖：ComfyUI 沒開時，若本機路徑剛好存在仍會照刪；若不存在則回 `already:true` 並移除紀錄（比 `_check_files()` 的 `comfy:false` 防護還寬）。
- `recycle()` 失敗會靜默降級成永久刪除（`server.py:675-677`），但 `app.js:714` 仍告訴使用者「會移到資源回收筒（之後還能還原）」。
- `app.js:723-748` 以 URL 比對移除；若兩筆歷史指向同一個 URL（同名同 subfolder/type），一筆刪除會把兩筆紀錄都移除。

---

## 7. 路徑安全性與 Windows 特殊情況

### 7.1 現有防護（已確認）

- `server.py:658-662`：檔名不得含 `/`、`\`；subfolder 不得含 `..`；`type` 只接受 `output`。
- `server.py:666-669`：`os.path.realpath()` 解析後再做容器檢查，因此：
  - `subfolder` 內的 junction / symlink 若指向輸出目錄外，`realpath` 會解析到外部並被拒絕。
  - 絕對路徑或磁碟機相對路徑（例如 `sub = "C:"`、`name = "C:evil.png"`）會解析到 `D:\ComfyUI_output` 之外而被拒絕。
- 前端不接受完整路徑，只傳 `filename`/`subfolder`/`type`（`app.js:757-759`）；這點應保留。

### 7.2 唯讀路徑分析結果

以 Python（未寫檔、未刪檔）模擬 `server.py:658-669` 的驗證與 `realpath` 容器檢查，結果：

| subfolder | filename | 結果 |
|---|---|---|
| `""` | `ui_00001_.png` | ALLOW → `D:\ComfyUI_output\ui_00001_.png` |
| `ui_assets` | `mascot-idle.png` | ALLOW → 子目錄內 |
| `..` | `secret.png` | REJECT（輸入驗證） |
| `a/../b` | `x.png` | REJECT（輸入驗證） |
| `C:` | `x.png` | REJECT（容器檢查，解析到 `C:\ComfyUI\x.png`） |
| `""` | `..` / `.` | REJECT（容器檢查） |
| `""` | `C:evil.png` | REJECT（容器檢查） |
| `foo/./bar` | `x.png` | ALLOW（解析後仍在根內） |
| `""` | `CON` | ALLOW（Windows 保留裝置名，`os.remove` 可能失敗） |

另外驗證 `os.path.realpath(r"c:\windows")` → `C:\Windows`，代表大小寫會被正規化；但 `server.py:668` 的 `startswith(root + os.sep)` 仍是**字串大小寫敏感**比較，兩邊都由 `realpath` 產生時通常一致，屬低風險但應留意。

### 7.3 殘餘風險

| 風險 | 說明 |
|---|---|
| TOCTOU | `server.py:667` 的 `realpath` 與 `server.py:673/676` 的實際刪除之間有時間差；本機惡意程式可在此時把目錄換成 junction 指向外部。 |
| 大小寫敏感比對 | `server.py:668` 用 `startswith`，若將來 root 來源改為非 `realpath` 的字串，可能誤拒或（更糟）誤判。 |
| 保留裝置名 / ADS | `name` 未擋 `CON`/`NUL`/`:` 等 Windows 特殊名稱；`recycle()` 的 `path + "\0"`（`server.py:142`）遇到內嵌 NUL 會截斷。 |
| 多伺服器佔 port | AGENTS.md:204-212 記載 Windows 上多個 `server.py` 可同時綁 7860；若舊行程還活著，實測行為可能不是目前程式碼。查Bug前須先確認只有一隻。 |
| 刪除後未驗證 | 沒有再次用 `/view` 確認 ComfyUI 也看不到圖，就回成功給前端。 |

---

## 8. ComfyUI API 相容性調查

### 8.1 目前專案已使用的 ComfyUI API（已確認事實）

| API | 使用位置 |
|---|---|
| `POST /prompt` | `app.js:413` → `server.py:494-513` |
| `GET /history/{prompt_id}` | `app.js:508` |
| `GET /object_info/CheckpointLoaderSimple` | `app.js:170` |
| `GET /view`（含 HEAD） | `app.js:450-452`、`server.py:633`、代理 `server.py:494-513` |
| `GET /system_stats` | `app.js:113`（僅做連線狀態判斷） |
| `POST /queue`（delete）、`POST /interrupt` | `app.js:426, 428, 524, 526` |
| WebSocket `/ws` | `app.js:194` → `server.py:819-848` 隧道 |

### 8.2 本機 ComfyUI 實際安裝版本（已確認事實）

- `comfyui_version.py:3`：`__version__ = "0.45.0"`
- Git HEAD：`989d93d0d968e704c589ce0146bb18c77f6b50cc`（唯讀查詢，未動）

### 8.3 能否取得「實際 output directory」？

| 途徑 | 結論 |
|---|---|
| `GET /system_stats` | 本機 0.45.0 的 `server.py:807-824` 回傳 `system.argv`（`server.py:821`）。若 ComfyUI 是用 `--output-directory` 啟動，可從 argv 解析。**推測／待驗證**：舊版可能沒有 `argv` 欄位；若使用者用預設輸出目錄，argv 完全沒有路徑資訊；外部模式下 simple_ui 也不知道 ComfyUI 的檔案系統根目錄，無法自己推出 `<root>/output`。 |
| `/internal/folder_paths`、`/internal/files/output` | 本機 0.45.0 存在（`api_server/routes/internal/internal_routes.py:47-70`），但前者只回模型資料夾（`folder_names_and_paths`），後者只回檔名 + `[output]` 標記，**都不回輸出目錄絕對路徑**；且該檔 `internal_routes.py:10-12` 明示「should NOT be depended upon, for ComfyUI frontend use only」。不可用。 |
| `GET /view` 回應 | `server.py:704-747` 只有 `Content-Disposition` / `Content-Type`，沒有本機路徑。 |
| history 的 images 項目 | 只有 `filename` / `subfolder` / `type`，沒有絕對路徑（本機 `comfy_extras/nodes_images.py:2234, 2260`）。 |
| ComfyUI 節點 / Python API | `folder_paths.get_output_directory()` 只在 ComfyUI 行程內有效（`folder_paths.py:139-141`），simple_ui 是獨立行程，無法直接呼叫。 |

**結論：沒有跨版本可靠、可由 API 直接取得 output directory 的方法。** `/system_stats.argv` 只能當 best-effort 提示，不能當唯一依據。

### 8.4 filename / subfolder / type 的可信對應（已確認事實）

- SaveImage 系列的輸出固定帶 `type = "output"`（`comfy_extras/nodes_images.py:2234, 2260`）。
- `subfolder` 來自 `filename_prefix` 中的路徑部分，由 `folder_paths.get_save_image_path()` 產生（`comfy_extras/nodes_images.py:818`、`nodes.py:532`）。
- 因此對**本 workflow 新生成的圖**，`{filename, subfolder, type}` 是可信的；但對舊紀錄、自訂節點或手動改過的 localStorage，不能假設。

---

## 9. 公開版使用情境分析

| 情境 | 目前行為 | 是否符合需求 |
|---|---|---|
| 使用者自行安裝 ComfyUI | 前端靜態檔與代理可跑；但 `server.py:73-76` 的路徑都是開發者本機 | 部分符合 |
| 使用者自行設定 `COMFY_URL`（Phase 2B-2 已完成） | HTTP、狀態、`/ws` 共用同一來源（`server.py:65-70, 109-114, 500, 833-845`）；但 `OUTPUT_DIR` **不受 `COMFY_URL` 影響** | 不符合「輸出目錄跟著使用者走」 |
| 使用者用自己的 ComfyUI 輸出目錄 | 生成與瀏覽**正常**（走 `/view`）；刪圖**誤報 already 並移除紀錄**；「開啟資料夾」與狀態列顯示開發者路徑 | 不符合 |
| 使用者不需要知道 `D:\ComfyUI_output` | `app.js:1677` 直接把這個路徑顯示在畫面上 | 不符合 |
| 基本生圖 / 瀏覽歷史 / 刪圖明確安全 | 生圖、瀏覽安全；刪圖不安全（第 6 節） | 不符合 |
| WD14 為選用 | `server.py:944-949` 與 AGENTS.md:177-192：Worker 只在 `/api/reverse` 時啟動，基本流程不依賴；`main()` 仍會啟動 TTL 清理執行緒，但不載模型 | 符合，應保持 |

補充：公開版若走**預設模式**（未設 `COMFY_URL`）並點「開始生圖」，`server.py:164` 與 `ui_control.ps1:104` 會把 ComfyUI 的輸出目錄改成 `D:\ComfyUI_output`，可能直接導致生圖失敗。這與 `COMFY_URL` 外部模式的拒絕啟動設計（`server.py:585-594`）是兩個不同路徑，需一併考量。

---

## 10. 方案比較與推薦

### 10.1 方案比較

| 方案 | 優點 | 缺點 | 單獨使用是否推薦 |
|---|---|---|---|
| A. 從 ComfyUI API 取得路徑（解析 `/system_stats.system.argv` 的 `--output-directory`） | 不用使用者設定；在本機 0.45.0 + 有帶該參數時可行 | 版本相依；使用者用預設輸出目錄時沒有資訊；外部模式不知道 ComfyUI 檔案系統根目錄；argv 格式可能被改動 | 不推薦（只能當 best-effort） |
| B. 全面用 `/view` 代理、移除本機刪圖 | 瀏覽完全不看本機路徑；不會誤刪 | ComfyUI 沒有刪檔 API，等於放棄刪圖或只能「隱藏紀錄」；使用者期望圖片真的被刪 | 不推薦單獨使用；適合當「無法確認時的降級行為」 |
| C. 設定指定輸出目錄（.env / `COMFY_OUTPUT_DIR` / `SIMPLE_UI_OUTPUT_DIR`） | 明確、可靠、可驗證；公開版最直觀；可同時修好狀態顯示與開啟資料夾 | 需要使用者設定一步；設錯仍可能誤判 | 推薦為主要來源，但要有「未設定時的安全降級」 |
| D. 組合：C 為主 + A 為可選提示 + 刪圖前用 `/view` 交叉驗證 + 無法確認就停用刪圖 | 修正已知誤報；保留現有 `/view` 瀏覽；不依賴單一版本 API；「不知道就明說」 | 改動集中在 `server.py` 與 `app.js`，需小心不要破壞 `comfy:false` 防護 | **推薦** |

### 10.2 推薦方案的語意定義（刪圖）

| 情況 | 建議後端回應 | 前端歷史紀錄 |
|---|---|---|
| 刪除成功（recycle 或 `os.remove` 成功） | `200 {"ok":true,"status":"deleted","recycled":...}` | 移除 |
| 圖片本來就不存在（已設定/確認 root，且 HEAD `/view` 回 404/410，本機也沒有） | `200 {"ok":true,"status":"already_gone"}` | 移除 |
| 無法確認路徑（未設定輸出目錄、argv 解析失敗、外部模式且無可靠來源） | `409/422 {"ok":false,"code":"PATH_UNVERIFIED","error":"請設定 COMFY_OUTPUT_DIR…"}` | **保留**，顯示白話錯誤 |
| 不允許刪除的路徑（容器檢查失敗、`type != output`、檔名含分隔符） | `400 {"ok":false,"code":"FORBIDDEN_PATH"}` | 保留 |
| 檔案系統刪除失敗 | `500 {"ok":false,"code":"FS_ERROR"}` | 保留 |
| ComfyUI 無法連線（HEAD `/view` 無法確認） | `502/503 {"ok":false,"code":"COMFY_UNREACHABLE"}` | 保留，比照 `_check_files()` 的 `comfy:false` 防護 |

要點：

1. **不再讓 `already:true` 單獨觸發 `dropImages()`**。`app.js:762-765` 應改為只看明確的 success status；`already` 必須先經 `/view` 或可靠的 root 驗證。
2. 後端刪圖前後都應交叉檢查 ComfyUI 的 `/view`（沿用 `server.py:628-643` 的 HEAD 邏輯），不要只靠 `os.path.isfile`。
3. `OUTPUT_DIR` 改成環境變數、無寫死預設；未設定時 `/api/status` 的 `output` 回空值、`/open-output` 回明確錯誤，前端隱藏或停用「開啟資料夾」並顯示「請設定 COMFY_OUTPUT_DIR」。
4. 保留 `server.py:658-669` 的輸入驗證與 realpath 容器檢查；可再加入 Windows 保留名稱/`:` 的黑名單，並考慮用 `os.path.commonpath` 取代字串 `startswith`（`server.py:668`）。
5. 前端**不得**改為傳完整本機路徑；同時修正 recycle 失敗降級永久刪除時的文案（`app.js:714`、`app.js:765`）。

---

## 11. 預計修改檔案與每個檔案的修改目的

> 以下為「若獲得授權進入實作階段」的建議清單，**本次未修改任何檔案**。

| 檔案 | 修改目的 |
|---|---|
| `server.py` | `OUTPUT_DIR` 改為環境變數且無寫死預設；可選從 `/system_stats.system.argv` 做 best-effort 推測；`_delete_file()` 加入 ComfyUI `/view` 交叉驗證與結構化 status/code；未確認路徑時回明确錯誤；`/api/status`、`/open-output` 跟著新來源；`start_comfy()` 不再无条件写入开发者路径。 |
| `app.js` | `doDelete()` 依 `status`/`code` 區分處理，只有明確成功才 `dropImages()`；`already`/`PATH_UNVERIFIED`/`COMFY_UNREACHABLE` 保留紀錄並顯示白話指示；`app.js:1675-1679` 的輸出路徑顯示與 `btnOpenFolder`（`app.js:1518-1519`）在未知時停用；修正回收筒文案。 |
| `ui_control.ps1` | `ui_control.ps1:104-105` 移除或參數化 `--output-directory D:\ComfyUI_output`，避免控制台路徑與 `server.py` 新設定分歧。 |
| `devtools/` 新增測試 | 補刪圖 API 的隔離測試：already / 路徑未確認 / 容器外 / 檔名非法 / ComfyUI 離線 / 多 subfolder 同名檔。 |
| `README.md` | **本次範圍外**（任務明確不處理 README）；後續需文件化 `COMFY_OUTPUT_DIR` 與預設行為。 |

---

## 12. 可能的回歸風險

| 風險 | 說明與建議防護 |
|---|---|
| 破壞既有 `already` 行為 | 若直接把 `already` 改成失敗，確實被外部刪除的圖會留在紀錄裡；應以 `/view` 404 驗證後回 `already_gone`，而非一律失敗。 |
| 破壞 `_check_files()` 的 `comfy:false` 防護 | `app.js:610-611` 與 `server.py:619-621` 必須保留；這是 AGENTS.md:59 的設計約束。 |
| localStorage 格式 | 只能在成功時改 `ui.gallery`（`app.js:726`）；不可新增/改欄位，避免使用者舊紀錄消失（AGENTS.md:55）。 |
| 版面與一屏不捲動 | 新增錯誤提示只能用既有 toast / Modal，不要新增常駐區塊（AGENTS.md:56）。 |
| 外部模式 `/start-comfy` 拒絕 | `server.py:585-594` 與 `app.js:133-166` 的 `EXTERNAL_COMFY` 行為不可被新路徑設定影響。 |
| 多 `server.py` 同時綁 7860 | 改完 `server.py` 必須先完整清掉舊行程（AGENTS.md:204-268），否則會誤以為修改沒生效。 |
| WD14 選用性 | 不要在基本啟動路徑載入 WD14 模型或要求 venv 存在（AGENTS.md:177-192、`server.py:944-949`）。 |
| ComfyUI 版本差異 | `/system_stats.argv` 與 `/internal/*` 不可當硬需求；所有 API 假設都要有降級路徑。 |

---

## 13. 已確認事實、推測、待驗證事項

### 13.1 已確認事實（直接讀取目前 HEAD / 已安裝程式碼）

- `OUTPUT_DIR` 定義於 `server.py:76`，使用於 `server.py:164, 562, 567, 666`；另有 `ui_control.ps1:104` 的硬編碼。
- 生成與 `/view` 走 `/comfy` 代理（`server.py:494-513`）；歷史存在性走 `HEAD /view`（`server.py:633`），不用本機輸出目錄。
- `server.py:670-671` 對找不到的檔案回 `200 {"ok":true,"already":true}`；`app.js:762-765` 只檢查 `r.ok && j.ok`，因此會執行 `dropImages()`。全 Repo 沒有 `already` 的前端處理或刪圖測試。
- `server.py:666-669` 用 `realpath` + 容器檢查，可擋住 `..`、絕對/磁碟機相對路徑、junction 指向外部；唯讀 Python 分析結果如第 7 節。
- 本機 ComfyUI 版本 0.45.0（`comfyui_version.py:3`），`/view` 解析邏輯在 `server.py:599-749`，type→目录在 `folder_paths.py:229-236`。
- `/system_stats` 在本機版本的 `system.argv`（`server.py:821`）是唯一可見的路徑線索；`/internal/*` 不回輸出目錄且官方註記不可依賴（`internal_routes.py:10-12, 47-70`）。
- ComfyUI 沒有檔案刪除 endpoint。

### 13.2 推測（合理但未實測）

- 舊版 ComfyUI 可能沒有 `system.argv`；即使有，使用者用預設輸出目錄時 argv 也不會帶路徑。
- 公開使用者若未設 `COMFY_URL`，點「開始生圖」會被帶到 `D:\ComfyUI_output`，在沒有 D: 槽的機器上失敗。
- `app.js:714` 的回收筒文案與 `server.py:675-677` 的永久刪除降級不一致，會誤導使用者。
- 以 filename 比對 missing（`app.js:612, 615`）在多 subfolder 同名檔時會誤刪紀錄。

### 13.3 待驗證事項

- 真實以不同 `COMFY_URL` + 不同輸出目錄重現「already → 紀錄消失」的完整 API 流程（本次不得啟動服務或生圖）。
- 實際建立 junction/symlink 後，目前容器檢查是否在所有 Windows 版本都如預期阻擋（本次不得建立/修改資料夾）。
- `/system_stats.argv` 在目標支援的 ComfyUI 版本範圍內是否一致存在。
- 刪除後 ComfyUI 的 `/view` 是否立刻回 404（有無快取/檔案控制代碼殘留）。
- 瀏覽器 runtime 中 `btnOpenFolder` / 狀態列在輸出目錄未知時的呈現（目前只做靜態程式碼檢查）。

---

## 14. 正式服務是否受到影響

**未受影響。**

- 未啟動、停止或重啟 ComfyUI、`simple_ui/server.py`、WD14 Worker。
- 未執行生圖、反推或任何高負載操作。
- 未修改任何圖片、資料夾、`localStorage`、環境變數或 Workflow。
- 未安裝或更新任何套件；未修改 `.codegraph` 索引。
- 唯一的Repo 寫入是建立本報告 `devtools/reports/open-source-readiness-phase2b3.md`；四份既有未追蹤報告內容未變。
- Git 狀態仍為 `main`、HEAD `f7d5c412...`、與 `origin/main` 差距 `0 0`、無已追蹤修改，亦無任何 Git 寫入操作。

---

## 15. 未執行的檢查及原因

| 未執行 | 原因 |
|---|---|
| 實際啟動 server 並以瀏覽器操作刪除按鈕 | 本次唯讀，不得啟動/停止正式服務 |
| 真實 ComfyUI API 呼叫（`/system_stats`、`/view`、HEAD `/view`） | 不得連線/干擾正式 ComfyUI，且不能假設所有版本相容 |
| 真實生圖並觀察歷史/刪圖 | 不得執行生圖 |
| 建立 junction/symlink 測試路徑逃逸 | 不得新增/修改或搬移檔案與資料夾 |
| 刪除任何測試圖片 | 不得刪除或搬移圖片 |
| 修改 `localStorage` 或 CDP/瀏覽器 runtime 測試 | 不得修改 localStorage；且需啟動服務 |
| 跨版本 ComfyUI API 相容性矩陣 | 僅本機 0.45.0 原始碼可讀，不能推論所有版本 |
| WD14 相關流程 | 與本任務無關，且不得啟動 Worker |
| README / 安裝腳本 / 桌面工具改造 | 任務明確排除（第 1 節與第 9 節 D 項） |

以上未執行項目**不視為通過**。

---

**結論：目前 HEAD 仍存在「找不到圖片就回 `already:true`，前端就移除歷史紀錄」的誤報問題；其根源是刪圖依賴寫死的 `OUTPUT_DIR`，而瀏覽/檢查流程其實完全不需要它。推薦以「可設定輸出目錄 + `/view` 交叉驗證 + 無法確認就安全停用並回明確錯誤」的組合方案修正。本次未進行任何實作，等待獨立審查。**

---
---

# Part II — Phase 2B-3 實作與驗證報告

> 上半部（Part I）是唯讀調查與推薦方案，已保留原樣。以下為本次授權實作後的結果。

## I-1. 任務目標

1. 移除基本服務對 `D:\ComfyUI_output` 的硬編碼依賴。
2. 以 `COMFY_OUTPUT_DIR` 讓使用者指定自己的 ComfyUI 輸出目錄。
3. 未設定時，生圖、`/view` 瀏覽、歷史載入與同步完全不受影響。
4. 刪圖前必須以 ComfyUI `/view` 交叉確認圖片與本機檔案一致；無法確認就保留歷史紀錄。
5. 只有明確成功結果才能讓前端移除圖片；移除回收筒失敗後的永久刪除降級。
6. 歷史同步改用 `filename + subfolder + type` 完整識別，避免同名誤刪。

本次為**實作與隔離測試**，未 commit / push、未啟停正式服務、未生圖、未刪正式圖片。

## I-2. 修改、新增或刪除的檔案及目的

| 檔案 | 動作 | 目的 |
|---|---|---|
| `server.py` | 修改 | 移除 `OUTPUT_DIR` 硬編碼；新增 `_parse_output_dir()`（`server.py:78-95`）與 `COMFY_OUTPUT_DIR` 解析（`98-103`）；`start_comfy()` 只在有設定時帶 `--output-directory`（`190`）；`/api/status` 回報真實路徑與 `output_ok/output_error`（`600-603`）；`/open-output` 未設定時安全失敗（`589-594`）；新增 `_view_status()`（`684-699`）並重寫 `_delete_file()`（`701-772`）。 |
| `app.js` | 修改 | 新增 `fileKey()` / `itemQuery()`（`60-70`）、`applyOutputStatus()`（`72-85`）、`syncDeleteButtons()`（`87-91`）；`S` 增加輸出目錄狀態（`30`）；`checkComfy()` 與開場同步套用後端狀態（`149`、`1737`）；歷史同步改用完整 key（`650`）；`confirmDelete()` 阻擋未設定（`747-757`）；`doDelete()` 只認明確 status（`795-817`）；`openFolder()` 顯示錯誤（`1566-1579`）。 |
| `devtools/reports/open-source-readiness-phase2b3.md` | 更新 | 保留 Part I 調查，新增 Part II 實作與驗證紀錄。 |
| OS 暫存區 `phase2b3_backend_test.py`、`phase2b3_frontend_test.mjs` | 新增（_repo 外_） | 隔離測試；不進版控、不碰正式圖片。 |

刪除的檔案：無。未修改 `ui_control.ps1`、`README.md`、Workflow、KSampler、Checkpoint、WD14、`.codegraph` 或任何圖片。

`git diff --stat`：`app.js | 80 +++++…`、`server.py | 143 +++++…`（共 188 insertions、35 deletions）。

## I-3. `COMFY_OUTPUT_DIR` 設定行為

- 解析：`server.py:78-95` 先 `strip()`，再 `expanduser()` + `expandvars()`（支援 `~` 與 `%VAR%`）。
- 拒絕並回白話原因：未設定／空字串（`尚未設定 COMFY_OUTPUT_DIR`）、非絕對路徑、路徑不存在、指向一般檔案、無法 `os.listdir` 讀取、無寫入權限。
- 有效時存 `os.path.realpath(text)`（正規化 junction/大小寫），做了 `os.listdir` 可讀檢查與 `os.access(W_OK)` 檢查；**不建立任何目錄、不猜測 ComfyUI 路徑、不讀 `/system_stats.argv`**。
- 設定錯誤只記錄到 `_OUTPUT_ERROR`，**不終止主服務**（`main()` 未檢查此變數）。
- `start_comfy()`（`server.py:186-194`）：有設定才附加 `--output-directory`；未設定時讓 ComfyUI 用它自己的預設目錄。`COMFY_URL` / `COMFY_EXTERNAL` 的 loopback 限制與外部模式拒絕啟動完全未動。
- `/api/status`：保留 `comfy`、`external`、`output` 三欄，`output` 未設定回 `""`；新增 `output_ok`、`output_error`（`server.py:600-603`）。
- `/open-output`：未設定或無效回 409 `OUTPUT_DIR_UNSET` + 白話中文；有效才 `os.startfile`；失敗回 500 `OPEN_FAILED`（`server.py:589-598`）。
- 基本生圖、`/comfy/*`、`/ws`、`/api/check`、WD14 反推路徑完全不讀 `OUTPUT_DIR`。

## I-4. 刪圖 API 新舊行為差異

| 情況 | 舊行為 | 新行為 |
|---|---|---|
| 未設定輸出目錄 | 用 `D:\ComfyUI_output` 當根目錄 | 409 `OUTPUT_DIR_UNSET`，不刪、不移除紀錄 |
| 本機找不到檔案 | 200 `ok:true, already:true` → 前端移除紀錄 | 先問 `/view`：404/410 且本機也沒有 → 200 `ok:true, status:"already_gone"`；`/view` 仍有圖 → 409 `PATH_MISMATCH` |
| ComfyUI 沒開 | 不看，直接照本機結果回 already 或刪 | 502 `COMFY_UNREACHABLE` |
| `/view` 500 | 不看 | 502 `VIEW_ERROR` |
| 本機有同名但內容不同 | 照刪 | 比對 `Content-Length` 與本機檔案大小，不符 → 409 `PATH_MISMATCH` |
| 回收筒失敗 | `os.remove()` 永久刪除並回 200 成功 | 500 `RECYCLE_FAILED`，**不永久刪**，原檔與紀錄保留 |
| 回收筒謊報成功但檔案還在 | 回 200 成功 | 500 `DELETE_UNVERIFIED` |
| 成功 | 200 `ok:true, recycled:true` | 200 `ok:true, status:"deleted", recycled:true` |
| 路徑穿越 / 非法 type / 空檔名 | 400 泛用錯誤 | 400 `FORBIDDEN_PATH` / `TYPE_NOT_ALLOWED` |

新增 `_view_status()`（`server.py:684-699`）以 `HEAD COMFY + "/view?..."` 確認，沿用既有 `COMFY` 設定；前端仍不直接連 ComfyUI。用完即棄，一次只處理一張圖，不下載整張圖片。

## I-5. 前端刪圖成功判斷

`doDelete()`（`app.js:795-817`）：

1. 先要求 `r.ok` 且 `j.ok === true`。
2. 再要求 `j.status` 必須是 `"deleted"` 或 `"already_gone"`；兩者皆非就 throw。
3. 只有通過上面兩關才 `dropImages([it.url])` 並寫入 `ui.gallery`。
4. 失敗時 toast 顯示後端白話訊息，並補「圖片與紀錄都保留」。

因此 HTTP 200、單純 `j.ok === true`、舊的 `already:true` 都**不足以**移除紀錄。`confirmDelete()`（`747-757`）在 `S.outOk` 為 false 時直接顯示「無法刪除圖片」Modal；`syncDeleteButtons()`（`87-91`）同時把舞台與歷史的刪除按鈕 `disabled`。Modal 文案已與「回收筒失敗就保留」的新行為一致（`/api/delete` 不再永久刪）。

## I-6. 歷史同步識別方式

- 新增 `fileKey(it)`（`app.js:64-70`）：回傳 `filename + "\0" + subfolder + "\0" + type`。
- 優先讀 explicit 欄位，沒有則從 `it.url` 的 query 解析（`URLSearchParams` 會處理 URL encoding）；空 subfolder 歸 `""`、缺 type 歸 `"output"`。
- `syncGallery()`（`app.js:650`）改為 `new Set((j.missing || []).map(fileKey))` 與 `S.gallery.filter(it => !gone.has(fileKey(it)))`。
- **localStorage 格式完全沒變**：舊紀錄只有 `url` / `filename`，`fileKey()` 會從 URL 補出 subfolder/type，向後相容。
- `comfy:false` 的防護（`app.js:648-649`）保持不動。

## I-7. 路徑安全措施及限制

- 輸入驗證（`server.py:716-726`）：空檔名、`.`/`..`、檔名含 `/`、`\`、`\0`、`:`；subfolder 含 `..` segment 或 `:` → 400。前端仍只傳 `filename`/`subfolder`/`type`，不接受完整路徑。
- `realpath` + `os.path.commonpath([root, path]) == root`（`728-736`）：`commonpath` 在 Windows 會正規化大小寫；擋住絕對路徑、磁碟機相對路徑、junction/reparse 指向外部；另外擋 `path == root` 與目錄路徑。
- 與 `/view` 雙重確認（`738-764`）：ComfyUI 可連線、URL 可取、本機檔案存在、Content-Length 與本機大小一致（header 不存在時略過此檢查，不當成失敗）。
- **明確限制**：`realpath` 與實際 `recycle()` 之間仍有 TOCTOU 競態，本次沒有（也無法只靠 realpath）完全消除；`Content-Length` 是 best-effort 比對，不是內容 hash；Windows `os.access(W_OK)` 對 ACL 的判断可能不完整；刪除後未再打一次 `/view` 驗證（避免快取造成假失敗）。這些列為 I-12 風險。

## I-8. 執行的測試及實際結果

實際命令（工作目錄 `C:\ComfyUI\simple_ui`）：

```powershell
python -m py_compile server.py
node --check app.js
git -C C:\ComfyUI\simple_ui diff --check
python 'C:\Users\user\AppData\Local\Temp\opencode\phase2b3_backend_test.py'
node 'C:\Users\user\AppData\Local\Temp\opencode\phase2b3_frontend_test.mjs'
```

| 檢查 | 結果 |
|---|---|
| `python -m py_compile server.py` | 結束碼 **0**、無輸出 |
| `node --check app.js` | 結束碼 **0**、無輸出 |
| `git diff --check` | 結束碼 **0**、無輸出 |
| 後端隔離測試 | **27/27 PASS** |
| 前端隔離測試 | **23/23 PASS** |

後端 27 項包含：未設定／空字串／相對路徑／不存在／一般檔案／讀取權限失敗／`%VAR%` 展開；`/api/status` 與 `/open-output` 四項；正常刪除、回收筒失敗（並 patch `os.remove` 確保沒被呼叫）、本機缺檔、`/view` 404/500/連線失敗、404 但本機有同名檔、Content-Length 不符、`..` 與巢狀穿越、非法 type、空檔名、謊報成功、未設定目錄拒絕；以及**實際建立 Windows junction** 的路徑逃逸測試（subfolder `link` 指向 temp 外，回 400 `FORBIDDEN_PATH`，victim 未被刪）。

前端 23 項包含：`deleted` / `already_gone` 才移除歷史；回收筒失敗、ComfyUI 連線失敗、輸出目錄未設定、HTTP 200 但缺明確 status、未知 status 都不移除；同名不同 subfolder / type 的 key 差異、舊格式相容、空 subfolder 正規化；`syncGallery` 只移除對應 subfolder 的紀錄；未設定時擋下刪除、有效時才出現確認；狀態列顯示與按鈕停用（含舊後端無 `output_ok` 的 fallback）；以及 `app.js` 無 `j.already`、`server.py` 無開發者路徑常數、`_delete_file` 無 `os.remove`、仍走 `/comfy` 與 `/ws` 的靜態檢查。

測試過程中有三次**測試 harness 本身**的錯誤（FakeHandler 沒綁 `_view_status`、`mklink` 輸出編碼、Node 抽出 `async function` 與依賴注入），修正 harness 後重跑才得到上述結果；**產品程式没有因為這些失敗而修改**。所有測試只使用 `tempfile` 與 mock，未啟動任何服務、未連正式 ComfyUI、未刪正式圖片、未寫 localStorage。

## I-9. 未執行的測試及原因

| 未執行 | 原因 |
|---|---|
| 啟動 server / 瀏覽器點刪除按鈕 | 授權範圍排除正式服務啟停 |
| 真實 ComfyUI `/view` HEAD、真實生圖後刪圖 | 不得啟停正式服務、不得生圖 |
| 正式輸出資料夾的回收筒行為 | 不得刪除正式圖片；以 temp 檔 + mock recycle 取代 |
| 真實 symlink（非 junction） | Windows symlink 需特權；junction 已用真實 `mklink /J` 驗證 |
| 跨 ComfyUI 版本的 `/view` 相容性 | 不能假設所有版本一致；本次只讀本機 0.45.0 原始碼 |
| WD14 流程 | 與本任務無關，且不得啟動 Worker |
| `ui_control.ps1` / README 修改與驗證 | 明確列在本次範圍外 |

以上未執行項目**不視為通過**。

## I-10. Git Branch、HEAD、工作區狀態

| 項目 | 值 |
|---|---|
| 分支 | `main`（未切換） |
| HEAD（開始與結束） | `f7d5c412078278195280cc21709c2b7179cdc720` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（未變動、未 fetch） |
| 與遠端差距 | `0 0` |
| 已追蹤修改 | `app.js`、`server.py` |
| 未追蹤檔案 | 五份報告（Phase 1 / 2A / 2B-1 / 2B-2 / 2B-3），既有四份內容未覆蓋 |
| Git 寫入 | 無 commit / push / reset / restore / stash / checkout / clean / rebase |

開始前工作區只有四份未追蹤報告、無已追蹤修改，與調查時一致；沒有需要辨識歸屬的外來修改。

## I-11. 正式服務是否受到影響

**未受影響。** 未啟動、停止或重啟 ComfyUI、`simple_ui/server.py`、WD14 Worker；未生圖、未反推；未修改正式圖片、資料夾、localStorage、環境變數或 Workflow；未安裝套件。測試用的 `COMFY_OUTPUT_DIR` 只寫入隔離 Python 行程的 `os.environ`，結束即還原。Repo 內只有兩個原始檔被修改與本報告被更新。

## I-12. 尚未解決的問題及風險

| 風險 | 說明 |
|---|---|
| `ui_control.ps1:104-105` 仍硬編碼 `D:\ComfyUI_output` | 桌面控制台啟動 ComfyUI 時仍會帶這個參數，可能與 `COMFY_OUTPUT_DIR` 不一致。**本次依指示未修改**（屬啟動器範圍，需先取得授權）。`server.py` 的 `start_comfy()` 已改為跟隨設定。 |
| TOCTOU | `realpath` 與 `recycle()` 之間仍有競態窗口；本機惡意程式仍可能替換路徑。 |
| 內容比對為 best-effort | 只用 `Content-Length`，不是內容 hash；header 缺席時略過。 |
| `/view` 404 但本機有同名檔 | 目前回 409 `PATH_MISMATCH` 並保留紀錄；後續 `/api/check` 同步會因 ComfyUI 回 404 而自然移除該紀錄。 |
| `already_gone` 的時機 | ComfyUI 404 可能因 ComfyUI 重啟/目錄暫時變動而誤判；目前以「本機也沒有」作為第二道條件降低風險。 |
| Windows 權限判斷 | `os.access(W_OK)` 不一定反映真實 ACL；最終仍以 recycle 結果為準。 |
| 未做瀏覽器 runtime 驗收 | 僅做函式隔離測試與語法檢查；版面、toast、按鈕 disabled 的實際渲染未實測。 |
| 多 `server.py` 綁 7860 | AGENTS.md:204-268 記載的舊問題仍存在；部署時要先清乾淨再測新程式。 |
| README 未更新 | 公開使用者目前沒有文件說明 `COMFY_OUTPUT_DIR`（本次範圍外）。 |
| 回收筒語意 | `SHFILEOPSTRUCTW` 的行為依 Windows 設定而異；失敗現在明確回錯，不再靜默永久刪。 |

**已停止，等待 ChatGPT 獨立審查。**

---
---

# Part III — 修正：刪圖前以 SHA-256 驗證圖片內容

## III-1. 問題與修正範圍

ChatGPT 獨立審查發現 Part II 的驗證只比對 `Content-Length` 與 `os.path.getsize()`，無法證明內容相同；並以隔離測試重現「本機 `LOCAL`、ComfyUI `OTHER`，兩者皆 5 bytes」仍回 `200 {"ok":true,"status":"deleted"}` 的誤刪風險。

本次只改 `server.py`（與本報告），未改 `app.js`、Workflow、WD14、localStorage 或其他檔案。API 回應格式未變，因此前端無需配合修改。

## III-2. 修正方式

- 新增串流 hash helper `_hash_stream()`（`server.py:702-712`）：以 64 KiB chunk 讀取並累計 SHA-256 與位元組數，**不把整張圖讀進 RAM、不寫暫存檔**。
- HEAD `/view` 仍先用 `_view_status()`（`server.py:684-699`）判斷 404/410、HTTP 錯誤與連線狀態；`already_gone` 規則不變。
- HEAD 回 200 後，再以 `GET COMFY + "/view?" + q`（timeout 15s）取得實際內容（`server.py:765-784`）：
  - 200 → 串流算出 `remote_hash` 與 `remote_bytes`。
  - GET 404/410 → 本機也不存在才回 `already_gone`；本機仍有檔則回 `PATH_MISMATCH`。
  - GET 500 → 502 `VIEW_ERROR`；連線失敗／串流中斷 → 502 `COMFY_UNREACHABLE`。
- `Content-Length` 現在**只檢查回應是否完整**（`server.py:786-789`），不再當作內容相同的證據；沒有此 header 時不影響判定。
- 本機端：`os.stat()` → 串流 hash → 再 `os.stat()`，並重新檢查 `isfile()` 與 `realpath(join(root, sub, name)) == path`（`server.py:795-815`）。任一變化回 409 `PATH_MISMATCH`。
- `local_hash != remote_hash` → 409 `PATH_MISMATCH`（`server.py:817-819`），**在 `recycle()` 之前攔下**，本機圖片與前端歷史都保留。
- 只有以上全部通過才呼叫 `recycle(path)`（`server.py:821`）；回收筒失敗仍回 500 `RECYCLE_FAILED`，**沒有 `os.remove()` 降級**（`server.py:821-827`）。

## III-3. 新增隔離測試與實際結果

後端測試腳本（OS 暫存區，不進 repo）已更新 mock：以 `req.get_method()` 區分 HEAD 與 GET，GET 可提供 arbitrary body、省略 Content-Length、中途拋出 OSError。

實際命令：

```powershell
python -m py_compile server.py
node --check app.js
git -C C:\ComfyUI\simple_ui diff --check
python 'C:\Users\user\AppData\Local\Temp\opencode\phase2b3_backend_test.py'
node 'C:\Users\user\AppData\Local\Temp\opencode\phase2b3_frontend_test.mjs'
```

| 檢查 | 實際結果 |
|---|---|
| `python -m py_compile server.py` | 結束碼 **0** |
| `node --check app.js` | 結束碼 **0** |
| `git diff --check` | 結束碼 **0** |
| 後端隔離測試（含 Part II 全部 28 項 + 新增 13 項） | **41/41 PASS** |
| 前端隔離測試（完整重跑） | **23/23 PASS** |

新增的 Hash 驗證測試：

| 項目 | 情境 | 結果 |
|---|---|---|
| H1 | 內容完全相同 `LOCAL` / `LOCAL` | PASS：`deleted`，`recycle()` 被呼叫一次 |
| H2 | 同大小不同內容 `LOCAL` / `OTHER`（本次回報的漏洞） | PASS：409 `PATH_MISMATCH`，`recycle()` **完全沒被呼叫**，原檔存在 |
| H3 | 不同大小不同內容 | PASS：409 `PATH_MISMATCH` |
| H4 | GET 沒有 Content-Length | PASS：靠 hash 正確刪除 |
| H5 | GET 404 且本機沒有 | PASS：`already_gone` |
| H5b | GET 404 但本機有檔 | PASS：409 `PATH_MISMATCH` |
| H6 | GET 500 | PASS：502 `VIEW_ERROR` |
| H7 | GET 中途連線失敗 | PASS：502 `COMFY_UNREACHABLE` |
| H8 | 本機檔案讀取失敗 | PASS：500 `FS_ERROR` |
| H9 | hash 不一致時 recycle 未被呼叫 | PASS（明確記錄 call count = 0） |
| H10 | 回收筒失敗時不呼叫 `os.remove()`、原檔存在 | PASS |
| H11 | 正常成功仍回 `status:"deleted"` | PASS |
| H12 | 驗證期間本機檔案被替換 | PASS：409 `PATH_MISMATCH` |
| H13 | 200,000 bytes（大於單一 chunk）串流 hash | PASS：`deleted` |

原有 28 項（輸出目錄 8、status/open-output 4、刪圖回歸 15、junction 1）全部重跑通過，無回歸。

測試過程如實說明：
- 第一次重跑有多項失敗，原因是測試 harness 的 `FakeHandler` 未綁定新的 `_hash_stream`（與先前 `_view_status` 同類問題）；補上後重跑。
- H5 初次失敗是**產品邏輯問題**：原本在 GET 之前就因「本機找不到」回 `PATH_MISMATCH`，導致 GET 404 沒有機會被判定為 `already_gone`。已調整順序讓 GET 先確認 ComfyUI 狀態，再決定 `already_gone` 或 `PATH_MISMATCH`，重跑通過。
- H12 初次失敗是 harness 的 patch 目標被 instance attribute 遮蔽；改為 patch instance 後通過。
- 上述失敗都已修正並以完整重跑結果為準；沒有把預期結果當成通過。

## III-4. 尚未解決的風險

- **TOCTOU 仍在**：`realpath` / `stat` 最終檢查與 `recycle()` 之間仍有極短窗口；本次沒有引進 OS handle 鎖定等機制，也沒有這樣宣稱。
- GET 會傳輸整張圖片（但串流處理、不落盤、一次只一張）；極大圖片會增加單次刪圖延遲與頻寬。
- `Content-Length` 若不存在，無法檢查回應是否截斷；此時若 GET 提前結束且內容碰巧相同，仍可能通過（截斷通常會造成 hash 不同或連線錯誤）。
- 本機 hash 比對的是 ComfyUI `/view` 的回應內容；若上游對 `/view` 做動態轉換，需以實際回應為準（本次未要求 `channel`/`preview` 參數）。
- 其餘 Part II I-12 所列風險（控制台 `ui_control.ps1` 硬編碼、README、跨版本相容性、未做瀏覽器 runtime）維持不變。

## III-5. Git 與正式環境

Branch `main`、HEAD `f7d5c412078278195280cc21709c2b7179cdc720`（未變）、與 `origin/main` 差距 `0 0`。已追蹤修改為 `server.py`、`app.js`（`app.js` 本次未再改動）；五份報告皆保留。無 commit / push / reset / restore / stash / checkout / clean / rebase。

未啟動、停止或重啟 ComfyUI / simple_ui / WD14；未生圖、未修改正式圖片、資料夾、環境變數或 localStorage；測試只用 `tempfile` 與 mock。

**已停止，等待 ChatGPT 重新獨立審查。**
