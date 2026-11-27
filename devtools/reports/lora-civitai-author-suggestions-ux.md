# Civitai 作者建議詞 UX 修正

日期：2026-11-26
Repository：`C:\ComfyUI\simple_ui`

---

## 1. 任務目標與實際執行範圍

### 1.1 目標

修復「Civitai 作者提供的建議詞」讓完全不懂技術的使用者也能直覺操作：

- A：不知道去哪裡取得正確網址、要選哪個版本。
- B：讀取失敗後輸入框被清空、不知道如何重試、讀取中可重複點擊。
- C：重新讀取同一版本會先清掉原有成功資料；更新失敗後舊資料消失。
- D：「解除」措辭讓人誤以為會刪除自己的觸發詞。

限制：只做 UX 與流程修正，不改資料模型的語意、不改 Workflow／Prompt 注入、不碰 API Key、不改正式服務。

### 1.2 實際執行

- 讀取 `C:\ComfyUI\AGENTS.md`、`C:\ComfyUI\simple_ui\AGENTS.md` 與五份既有 Phase 2 報告（唯讀）。
- `codegraph status`：`Files 35 / Nodes 1,094 / Edges 4,837`，Pending `Added 5 / Modified 6` → **索引過期**；未執行索引寫入，以 Grep/Read 直接確認目前原始碼。文件與程式碼一致，沒有發現需要以程式碼為準推翻報告的地方。
- 修改 `app.js`、`app.css`、`devtools/lora_trigger_words_ui_test.mjs`、`devtools/lora_ui_test.mjs`。
- **沒有**修改 `server.py`、`index.html`、任何模型／使用者資料或既有報告。

---

## 2. 開始前 Repository / Branch / HEAD / Remote / Git 狀態

| 項目 | 值 |
|---|---|
| Branch | `main`，`## main...origin/main [ahead 1]` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| Ahead / Behind | `1` / `0` |
| Staged | 0 |
| Tracked modified | 15 |
| Untracked | 85 個檔案（54 個 porcelain 項目） |
| Porcelain 總數 | 68 |

所有既有 modified 與 untracked 報告保留，未清理、未覆蓋、未重置。

---

## 3. 調查結果及根因

| 問題 | 根因（實際程式碼） |
|---|---|
| A | `renderLoraTriggers()` 原本只有一行「貼上版本頁面網址…」與一般類型 placeholder；沒有說明要到哪個網站、選哪個版本、網址長什麼樣，也沒有把「選用」與「選錯版本的後果」講清楚。 |
| B | `loraLinkCv()` 先 `loraSave()` 再 `renderLoraTriggers()`，而後者重建 `#loraCvId` 的 innerHTML 時沒有保留輸入值；失敗後輸入消失。`loadCivMeta()` 設定 `loading` 後沒有立刻重繪，按鈕短時間仍可點擊；也沒有「用已選版本重試」的路徑。 |
| C | `loraLinkCv()` 无论新旧版本都把 `groups/fetchedAt/fingerprint` 清空再請求；`loadCivMeta()` 的 `loading` 状態覆蓋舊状態，失敗時舊建議已不在。 |
| D | 按鈕文字只有「解除」，旁邊沒有說明；_handler_ 直接清空 versionId/groups 且沒有任何回饋。 |

補充：成功與失敗路径原本已有 `authorSuggestions.civitai.versionId !== vid` 的過期防護（前一輪修正），本輪保留並擴充到「同版本更新失敗保留舊資料」。

---

## 4. 修改檔案清單

| 檔案 | 目的 |
|---|---|
| `app.js` | 新增 `cvInputs` 暫存；重寫 Civitai 區塊文案與操作；`loraLinkCv()` 保留輸入、同版本更新保留舊資料、空白輸入才用已選版本重試；《loadCivMeta》立刻反映讀取中並保留舊資料於失敗時；《cv-unlink》改語意與回饋 |
| `app.css` | `.lora-cv-help`、`.lora-cv-example`（短的步驟與網址範例，沿用既有設計變數） |
| `devtools/lora_trigger_words_ui_test.mjs` | 更新文案契約，新增 test 10 檢查保留輸入／loading guard／舊資料保留／免 Key |
| `devtools/lora_ui_test.mjs` | 新增 6 項真 DOM E2E（指引、錯誤輸入保留、失敗重試、讀取中、更新失敗保留舊資料、取消連結）並調整既有版本字串 |

**沒有**修改 `server.py`：後端匿名版本路由與 `trainedWords` 正規化已能滿足需求，無須變動。

---

## 5. 重要程式碼位置及設計判斷

- `app.js:1810` `cvInputs`：只存在記憶體的版本網址暫存，重新繪製面板時回填 `#loraCvId`；不進 localStorage。
- `app.js:2594` `renderLoraTriggers()`：Civitai 區塊分為
  - 短的選用說明（「不知道怎麼設定可以直接略過，不影響生圖」）；
  - 操作指引（到模型網站選與下載檔案相同的版本，複製該版本頁面網址；選錯版本建議詞可能不適用）；
  - 完整網址範例 `https://civitai.com/models/2898222?modelVersionId=3276795`（此處的數字是網址本身，不是要求使用者理解技術名詞）；
  - 輸入框保留 `cvInputs` 值、讀取中禁用「重新讀取」、解除改為「取消版本連結」並附上「只取消作者建議來源，不會刪除你自己的觸發詞，也不影響生圖」；
  - 状態顯示「已選版本：…」「上次取得：…」「正在讀取，請稍候…」「取得失敗…（仍顯示先前已取得的建議）」「這個版本沒有提供建議詞」。
- `app.js:2722` `loadCivMeta()`：`hadData` 記錄是否已有成功建議；設定 `loading` 後**立刻重繪**（避免重複點擊）；成功只更新作者建議；失敗只更新暫時状態且保留舊資料；過期 versionId 的回應仍直接丟棄。
- `app.js:2800` `loraLinkCv()`：
  - `raw` 空白才沿用已選版本直接重試；有輸入但格式錯 → 提示並保留原文；
  - 同版本重新讀取保留 `groups/fetchedAt/fingerprint`；不同版本才清空，避免顯示舊版本建議；
  - 個人 `triggers`、本機建議、Workflow 完全不變。
- `app.js:2934` `cv-unlink`：清空版本建議與 `cvInputs`，保留本機建議與個人觸發詞，並 toast「已取消版本連結；你自己的觸發詞都還在」。

設計判斷：沒有新增資料欄位，也沒有把 `_civitai_get` 改成帶 Key；所有改動都在既有 `authorSuggestions.civitai` 與暫時状態 `S.loraCiv` 內完成，風險最低。

---

## 6. 測試執行命令與結果

| 指令 | 結果 |
|---|---|
| `node --check app.js` | 通過 |
| `node --check devtools/lora_ui_test.mjs` | 通過 |
| `python -m py_compile server.py` | 通過 |
| `node devtools/lora_core_test.mjs` | **33 tests passed** |
| `python devtools/lora_api_test.py` | **23 tests passed** |
| `node devtools/lora_trigger_words_ui_test.mjs` | **10 tests passed** |
| `node devtools/lora_ui_test.mjs --ui http://127.0.0.1:7861 --mock http://127.0.0.1:18188 --mockcv http://127.0.0.1:18189 --capture <tmp>\cap.jsonl` | **71 UI tests passed**（原 65 + 新 6） |
| `git diff --check` | 無錯誤輸出（只有 LF→CRLF 提示） |

新增 E2E 全部通過，並逐項對應需求：

1. 正確版本網址／純數字 ID：`loraParseCvId` 既有支援，E2E 多元件連結測試通過。
2. 不正確網址：清楚提示且 `#loraCvId` 保留原文。
3. 失敗後重試：失敗保留輸入，按「重新讀取」不必重新貼上，成功顯示新建議。
4. 讀取中：按鈕 disabled、顯示「正在讀取，請稍候…」，重複點擊不產生干擾請求。
5. 同版本更新成功：顯示新資料。
6. 同版本更新失敗：保留先前成功建議，標示「取得失敗…（仍顯示先前已取得的建議）」，個人詞與本機建議不變。
7. 切換版本：不同版本清空舊建議，不混用。
8. 過期回應：成功／失敗路径的 versionId 守衛仍在；E2E 改為「A 失敗 → B 成功」的順序驗證（見未解決風險）。
9. 空建議詞：顯示「這個版本沒有提供建議詞」，不是錯誤。
10. 取消版本連結：個人觸發詞與本機建議皆不變，並有明確回饋。
11–13：匿名公開讀取持续可用；原始碼契約檢查確認此流程沒有 `read_api_key` / `Authorization` / `Bearer` / `/api/civitai/key`。
14–15：Phase 1 Workflow／Prompt 注入與舊歷史相容測試全數回歸通過。

### 未執行的測試及原因

- 真實 Civitai API 大量呼叫：任務禁止；只用 mock（18189）。
- 正式 7860／8188 上的操作與 GPU 生圖：任務禁止。
- API Key 相關流程測試：任務禁止讀取或使用憑證。

---

## 7. API Key 邊界確認

- 本輪**沒有**讀取、輸出、記錄、修改任何 API Key 或憑證；報告不含任何敏感值。
- 作者建議讀取仍走 `GET /api/civitai/version?id=`，前端 `fetch` 沒有額外 header；後端 `_civitai_get()` 使用預設 `auth=False`。
- 原始碼契約測試明確檢查 `loadCivMeta()` 內不含 `read_api_key` / `Authorization` / `Bearer` / `api/civitai/key`。
- 沒有把既有 Key 變成基本功能必要條件，也沒有擴張到 OAuth、登入、Civitai 搜尋或其他 API 整合。
- 本輪沒有發現匿名讀取的實際限制，因此沒有任何改用 Key 的行為需要記錄。

---

## 8. 正式服務是否受到影響

- 未停止、重啟或修改正式 ComfyUI（8188）、simple_ui（7860）或 WD14 Worker。
- 未連接正式服務；未修改模型、Workflow、使用者資料或 localStorage。
- 隔離 E2E 使用 mock ComfyUI（18188）、mock Civitai（18189）、以 **ComfyUI embedded Python** 啟動的隔離 Simple UI（7861）與獨立 profile 的 headless Chrome。
- 測試後已終止所有隔離行程與 Chrome；`Get-NetTCPConnection -LocalPort 7861,18188,18189 -State Listen` 回傳空（連接埠已釋放），暫存目錄已刪除。

---

## 9. 最終 Git 狀態

Branch `main`、HEAD `cf5609e0...`、ahead 1／behind 0、staged 0、tracked modified 15。

建立本報告前：untracked 85 檔案（54 porcelain 項目）、porcelain 68。
建立本報告後：untracked 86 檔案（55 porcelain 項目）、porcelain 69。

`git diff --check`：無錯誤輸出。

**沒有**執行 Stage、Commit、Push、Reset、Restore、Stash、Checkout、Clean。既有 modified 與 untracked 報告保留。

---

## 10. 一般使用者 UX 驗收

以完全不懂技術的角度逐項檢查：

- **知道功能在做什麼？** 區塊標題「Civitai 作者提供的建議詞」加上「選用，可略過，不影響生圖」與「建議只是參考，加入後才會生效」。
- **知道複製哪一種網址？** 明確寫「到模型網站找到你下載的模型，選跟你下載的檔案相同的版本，複製該版本的頁面網址」，並給完整範例。
- **理解選錯版本的後果？** 「選錯版本，建議詞可能不適用」。
- **讀取失敗能直接重試？** 失敗保留原文，按鈕變成「重新讀取」，不必重新找網址。
- **讀取中有沒有回饋？** 「正在讀取，請稍候…」且按鈕禁用，不會重複送出。
- **取消連結會不會刪自己的詞？** 按鈕改為「取消版本連結」，旁邊與 toast 都說明只移除作者建議來源，自己的觸發詞都還在。
- **不用這個功能能生圖嗎？** 可以；此區塊完全選用，個人觸發詞與本機建議照舊可用，E2E 的 Phase 1 流程全數通過。

### 未解決問題與風險

1. 「舊版本延遲回應不得覆蓋新版本」在真 DOM 中已因「讀取中禁用按鈕 + guard」而無法構成重疊請求；E2E 因此改為「A 失敗 → B 成功」的順序驗證，過期防護本身仍由原始碼契約測試與既有 core 測試覆蓋。若產品日後允許並行請求，需要補回真正的延遲重疊 E2E。
2. 網址範例中的 `civitai.com` 是外部網站；本專案沒有自動下載或登入功能，使用者需自行取得網址。
3. 個人詞 40 上限不變；作者建議最多 20 群、每群最多 40 詞（既有規則）。
4. Civitai 仍有 300 秒快取，沒有「立即重新抓取」按鈕；同版本更新可能讀到快取快照。
5. CodeGraph 索引仍過期；本輪以 Grep/Read 為準，未做索引寫入。

---

## 11. 第二輪審查修正（R2）

日期：2026-11-26
本輪是上一任務的必要修正，**不擴大產品功能**；不重寫 LoRA 狀態管理，只在 `app.js` 做最小且可理解的調整，並在 `devtools/lora_ui_test.mjs` 補真實 DOM 測試。

### 11.1 重複請求根因及修正方式

**根因（已確認的呼叫路徑）：**

- `loraLinkCv()` 更新版本資料後先呼叫 `renderLoraTriggers()`。
- `renderLoraTriggers()` 在 `!S.loraCiv[name]` 時會自動呼叫 `loadCivMeta()`。
- `loraLinkCv()` 隨後又明確呼叫一次 `loadCivMeta()`。
- `loadCivMeta()` 本身**沒有任何重複呼叫防護**，因此第一次連結會對同一 `/api/civitai/version?id=…` 發出兩個相同請求。
- 原本的過期防護只比對 `authorSuggestions.civitai.versionId !== vid`；取消後重新連結**相同** versionId 是不同操作，單靠 versionId 無法辨識請求世代。

**修正方式（最小、容易理解）：**

1. 在 `app.js` 新增兩個記憶體狀態（**不進 localStorage**）：
   - `civReqSeq`：每個 LoRA 的請求世代遞增序號。
   - `civReqPending`：每個 LoRA 目前進行中的 `{ vid, seq }`。
2. `loadCivMeta(name)`：
   - **防重複**：`if (pending && pending.vid === vid) return;`——同一 LoRA 同一版本已有進行中請求就不再重複發送。pending 在 `.finally` 清掉**自己那筆**，**不阻止使用者重新讀取已完成或失敗的版本**。
   - **世代守衛**：每次真正發起請求 `seq = ++civReqSeq[name]`。成功路徑、失敗路徑、`.finally` 重繪前都先 `if (civReqSeq[name] !== seq) return;`。過期請求（版本已變、已取消、或同版本的新操作已開始）一律丟棄，**不覆蓋版本、建議詞或狀態**，且不重繪。
   - **保留既有行為**：仍為匿名公開端點（不帶 Bearer、不讀 API Key）；`hadData` 記錄是否已有成功資料；同版本更新失敗**保留舊成功資料**；成功只更新 `authorSuggestions.civitai`，個人 `triggers` / `noTriggerNeeded` / 本機建議不動；設 `loading` 後立刻重繪；過期 versionId 的回應仍丟棄。
   - 第二輪仍保留 `versionId !== vid` 檢查（雙重保險）。
3. `loraLinkCv()` 本體**不變**：`renderLoraTriggers()` + 明確 `loadCivMeta()` 兩個呼叫點都保留，但被 `loadCivMeta` 內部防重複擋成**只送一個請求**。重新開啟面板時，`renderLoraTriggers()` 對已連結版本的自動讀取（`!S.loraCiv[name]`）**仍保留**；使用者明確點「重新讀取」/「讀取建議」**仍保留**；讀取中 `cv-link` 仍 disabled + `state==="loading"` 擋；同版本重新讀取保留 `groups/fetchedAt/fingerprint` 直到新資料回來。
4. `cv-unlink`（取消版本連結）：除既有清空版本建議、保留 `triggers` 與本機建議外，**額外** `civReqSeq[name]++` 並 `delete civReqPending[name]`，讓讀取中的舊請求失效（成功或失敗都不可回頭覆蓋），並解除防重複，使之後重新連結（包含**相同版本**）算全新操作。**不動個人觸發詞、不動本機建議、不碰 Workflow / Prompt。**

### 11.2 請求計數測試（真 DOM E2E，CDP Fetch interception 計數）

在既有 CDP `Fetch.requestPaused` 攔截器上新增 `cvVersionReqCount` 計數 `*/api/civitai/version*`（不新增外部套件）。新增真實 DOM 測試（`R2-C1`～`R2-C3`）：

| 測試 | 內容 | 預期 |
|---|---|---|
| R2-C1 首次連結只一次 | 第一次連結尚未連結過的版本 → 等待讀取成功 | `/api/civitai/version` 實際只呼叫 **1** 次（原本 2 次） |
| R2-C2 同版本重新讀取只 +1 | 同版本手動按「重新讀取」 → 等待成功 | 只增加 **1** 次請求 |
| R2-C3 讀取中重複點擊不增加 | 延遲版本讀取中，連點 `cv-link` 5 次（按鈕已 disabled + 防重複 + 序號） | 仍只 **1** 次請求 |

### 11.3 真正延遲重疊競態測試（真 DOM E2E，使用既有 mock Civitai `delay_ms`）

使用 `devtools/lora_mock_civitai.py` 的 `__mock/version` 設定延遲，**不只順序測試**，是真正重疊請求。新增 `R2-B1`～`R2-B3`：

| 測試 | 步驟 | 驗證 |
|---|---|---|
| R2-B1 A 延遲成功 + 取消 + 連結 B | 設版本 A 延遲回應 `delay_ms`；開始讀取 A；**讀取未完成時點「取消版本連結」**；立即連結 B；等 B 成功顯示 B 建議；等 A 延遲回應完成 | A 舊回應**不覆蓋** B 的版本、建議詞或狀態；B 的 `versionId`/`groups` 不含 A 字詞；不卡在讀取中；無「取得失敗」殘留 |
| R2-B2 A 延遲失敗 + 取消 + 連結 B | 同上但 A 回 500（延遲）；等 B 成功；等 A 延遲失敗完成 | A 的舊失敗**不覆蓋** B 版本、不清 B 建議、不污染狀態；A 字詞不混入 B |
| R2-B3 取消後重新連結相同版本 | 版本 A 延遲 + 舊資料；開始讀取 A；讀取中取消；改同版本為新資料不延遲；**重新連結相同版本**；等 op2 成功；等 op1 延遲回應完成 | 先前請求的延遲回應**不污染新一次操作**；最終為 op2 新資料、同版本 ID、無舊字詞、無「取得失敗」、不卡在讀取中。證明**不只靠 versionId**，靠 `seq` 世代 |

### 11.4 不可破壞的既有行為（本輪確認不變）

- 作者建議匿名公開讀取，不使用 API Key；未讀取／輸出／記錄／修改／傳遞任何真實 API Key。
- `triggers` 仍是唯一會注入 Prompt 的個人觸發詞來源。
- 本機建議與 Civitai 建議分開保存。
- 同版本更新失敗保留舊成功資料；不同版本不混用舊建議。
- 取消版本連結不刪個人觸發詞、不清本機建議。
- Phase 1 Workflow、歷史紀錄、權重、生成行為不變。
- 未修改正式服務、模型、使用者 localStorage 或其他個人資料。
- 原有失敗重試、舊資料保留、取消連結及 Phase 1 回歸測試仍保留（既有測試未刪除、未弱化）。

### 11.5 測試執行與結果

**本輪預期執行（需求 E）：** `node --check app.js`、`node --check devtools/lora_ui_test.mjs`、`python -m py_compile server.py`、`node devtools/lora_core_test.mjs`、`python devtools/lora_api_test.py`、`node devtools/lora_trigger_words_ui_test.mjs`、完整隔離真 DOM E2E、`git diff --check`。

**實際執行狀態：未能在本環境執行（環境限制，非程式碼問題）。**

本機 agent 的 **shell 工具在本輪無法啟動 `pwsh.EXE`**（所有 shell 呼叫一律回 `failed to spawn C:\Program Files\WindowsApps\Microsoft.PowerShell_7.7.0.0_x64__8wekyb3d8bbwe\pwsh.EXE: OS Error -1073283067 (FormatMessageW() returned error 317)`；重試多次、`echo`、`git`、`node`、`rg`、`background` 皆然；但 Code Mode `execute`、檔案讀寫、`grep`/`glob`/`read`/`edit` 正常）。因此**無法實際執行** `node --check`、`python -m py_compile`、各 test、含本輪新增真 DOM E2E 與 `git diff --check`。**不謊報任何測試通過。**

- **已做的程式碼層驗證：** 修改後以 `read` 逐行檢視 `loadCivMeta` 全文、`cv-unlink`、`loraLinkCv`、新增區塊；確認語法括號、字串、正則；並逐條比對 `lora_trigger_words_ui_test.mjs` test 4/10 與本檔新增契約，確認不會破壞既有 source-contract（單一 `.catch`、`state:"loading"→renderLoraTriggers(true)`、`state:"error"…hadData`、`versionId!==vid`、無 `read_api_key|Authorization|Bearer|api/civitai/key`、無 `triggers:`、`delete cvInputs`、本機保留等）。
- **新增測試本身為真實 DOM + 既有 mock Civitai + CDP Fetch，不需外部套件；** 語法結構已人工核對。
- **待重新啟動可用 shell 後執行並回填結果：** 上述 E 清單全部；真 DOM E2E 使用**獨立 Mock ComfyUI + 獨立 Mock Civitai + 獨立 Simple UI Port + 獨立 Chrome profile**，不連正式服務、不用 GPU。

**未執行的測試及原因：** 因 shell 工具無法啟動 `pwsh`，本輪所有需要 shell 的測試指令未能執行；先前已通過的第一輪結果（見第 6 節）不變。

### 11.6 最終 Git 狀態

- 本輪只修改 `app.js`、`devtools/lora_ui_test.mjs`、本報告 `devtools/reports/lora-civitai-author-suggestions-ux.md`。
- **未**執行 Stage / Commit / Push / Reset / Restore / Stash / Checkout / Clean；**未**停止或重啟任何正式服務。
- 既有所有 tracked modified 與 untracked 檔案原樣保留（未覆蓋、未清理、未還原）。
- `git diff --check` 本輪**未能執行**（shell 無法啟動 `pwsh`）；編輯工具寫入不引入 CRLF/尾端空白混亂（編輯前後內容保留原縮排）。
- Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、ahead 1／behind 0（本輪無法重新查詢，因 shell 無法啟動；起始狀態如此）。
- `codegraph` 索引本輪未做 sync；任務明確唯讀保留現有修改，`.codegraph/` 視為衍生索引。待 shell 可用時可 `codegraph sync`。

### 11.7 正式服務是否受到影響

- **未受影響。** 未停止／重啟／修改正式 ComfyUI（8188）、simple_ui（7860）、WD14 Worker 或任何正式設定；未連接正式服務；未修改模型、Workflow、輸出圖片、使用者資料或 localStorage；未讀取或傳遞任何真實 API Key。
- 本輪僅變更 `app.js` 前端記憶體邏輯與測試檔；`server.py` 未變動。

---

## 12. 第三輪審查修正（R3）：後端快取競態

日期：2026-11-26
本輪僅修正 `server.py` Civitai Version Metadata 快取寫入競態，並新增回歸測試；**不擴大產品功能**、**不修改前端**、**不改 TTL**、**不碰 API Key**。

### 12.1 缺陷根因與重現方式

**根因：** `civitai_version_meta(version_id)` 在 cache miss 後會無條件 `_cache_set(key, info, ttl=300)` 寫入快取。當同一 Version ID 有兩筆並行請求：

1. 舊請求 A 先開始 upstream fetch。
2. 新請求 B 隨後開始，並**先**取得較新的資料。
3. B 寫入後端 300 秒快取。
4. A 延遲完成，**舊資料仍無條件覆寫快取**。
5. 前端雖丟棄 A 的過期回應，但使用者再次讀取時，後端從快取回傳 A 的舊資料。

**重現證據（已驗證）：**
- 隔離 Simple UI `GET /api/civitai/version?id=990301` 回傳 `A old word`
- Mock Civitai upstream `GET /api/v1/model-versions/990301` 回傳 `A new word`

這是已驗證的後端缺陷，本次必須修正。

### 12.2 修改檔案及目的

| 檔案 | 目的 |
|---|---|
| `server.py` | 新增 per-version 請求世代序號 (`_civitai_gen`) 與守護鎖 (`_gen_lock`)；`civitai_version_meta()` 只有當請求仍是該版本最新世代時才寫入快取 |
| `devtools/lora_api_test.py` | 新增 R3-1～R3-4 決定性競態測試，經真實 HTTP endpoint `/api/civitai/version` 驗證 |

### 12.3 世代保護的實作方式及鎖定範圍

新增兩個模組級狀態（僅記憶體，不進 localStorage，不影響既有快取 TTL）：

- `_civitai_gen = {}`：`version_id -> 遞增序號`，記錄該版本目前最新一代的請求。
- `_gen_lock = threading.Lock()`：保護 `_civitai_gen` 的讀寫。

`civitai_version_meta()` 流程：

1. 版本 ID 驗證（不變）。
2. 快取命中直接回傳（不變，世代機制不介入 cache hit）。
3. **cache miss 時**取得新世代：`with _gen_lock: gen = _civitai_gen.get(version_id, 0) + 1; _civitai_gen[version_id] = gen`。**鎖僅用於 dict 遞增，立即釋放，不在等待網路回應時持鎖。**
4. `_civitai_get(...)` upstream fetch（鎖已釋放，不同版本請求獨立進行，不互相長時間阻塞）。
5. 失敗/非 dict 直接回錯誤，不寫入快取（舊請求失敗不污染）。
6. 建構 `info`（不變）。
7. **寫入守衛：** `with _gen_lock: if _civitai_gen.get(version_id) == gen: _cache_set(key, info, ttl=300)`。只有序號仍為最新的請求才寫入；較早開始但較晚完成的舊請求，序號已被新請求遞增，守衛失敗，不寫入、不覆蓋。
8. 回傳 `info`（不變）。

**鎖定範圍：** `_gen_lock` 僅保護 `_civitai_gen` dict 的短暫讀寫；`_cache_lock` 由 `_cache_set`/`_cache_get` 內部保護。鎖序固定為 `_gen_lock` → `_cache_lock`（僅在寫入守衛內），無反向路徑，不會死結。

### 12.4 如何確保舊請求不能覆蓋新快取

- 每個 version_id 的世代只增不減；新請求啟動時遞增為最新。
- 寫入快取前必須通過「序號仍等於目前最新」的檢查。
- 舊請求晚到完成時，其序號已非最新，一律丟棄寫入；快取保留由較新請求寫入的資料。
- 舊請求失敗時提早回傳錯誤，連寫入守衛都達不到，快取更不會被清除。
- 快取命中路徑完全不碰世代，既有 cache hit 行為與 300 秒 TTL 不變。

### 12.5 新增測試案例與預期結果

全部經真實 HTTP endpoint `/api/civitai/version?id=…` 驗證，upstream 用可控制時序的假 `server._civitai_get`（`threading.Event`），**不依賴睡眠猜測、不連真實 Civitai、不讀 API Key**。

| 測試 | 內容 | 驗收條件 |
|---|---|---|
| R3-1 舊請求晚到不得覆蓋新快取（最重要） | A 先開始且上游暫停；B 先完成寫入新資料；釋放 A 讓舊資料晚到；再次呼叫 endpoint | endpoint 必須仍回傳 B 的新資料；快取不被 A 覆寫；A 本身仍可成功回傳（僅不寫入快取） |
| R3-2 後續 cache miss 仍能正常更新 | A 先完成並寫入資料 A；測試明確清除該 Version ID 快取；B 再呼叫並確實發出新的 upstream fetch；upstream 回傳資料 B | B 成功回傳資料 B；快取內容已更新為資料 B；不僅是 cache hit |
| R3-3 舊請求失敗不得污染新快取 | B 成功寫入新資料；A 最後失敗 | 再次呼叫仍回傳 B 的新資料；A 失敗不清除快取 |
| R3-4 不同 Version ID 同時請求重疊 | v1、v2 分別啟動；Barrier 確保兩個 upstream 請求都已進入後才回應；驗證兩者完成且快取互不污染 | 兩個請求各自回傳正確資料；兩個 Version ID 的快取互不污染 |

**mock 清理：** 所有以 `server._civitai_get` 做 monkeypatch 的 R3 測試，均在 `finally` 區塊中 `server._civitai_get = orig` 還原；阻塞中的 `threading.Event` 在 `finally` 中一律 `set()` 並 `join()` 執行緒，確保不留下背景執行緒，也不污染後續既有 `t_cv_*` 測試；清理不掩蓋原本的 `AssertionError`。

### 12.6 執行的完整測試命令及結果（已以 CMD 執行）

本環境 `pwsh.EXE` 無法啟動，因此改用 `cmd /c python ...` 執行：

- `python -m py_compile C:\ComfyUI\simple_ui\server.py` → **PY_COMPILE_OK**
- `python devtools/lora_api_test.py` → **27 tests passed**（含既有 `t_cv_*` 與新增 R3-1～R3-4 全數通過）
- `git -C C:\ComfyUI\simple_ui diff --check` → **GIT_DIFF_CHECK_OK**（僅出現既有的 LF→CRLF 提示，無實際錯誤）

### 12.7 未執行測試及原因

- 正式 7860／8188、GPU、真實 Civitai、真實 API Key：任務禁止，未執行。
- 其餘所需測試指令（`py_compile`、`lora_api_test.py`、`git diff --check`）均已以 CMD 執行通過，無未執行項。

### 12.8 Git 最終狀態

- 僅修改 `server.py`、`devtools/lora_api_test.py`、本報告 `devtools/reports/lora-civitai-author-suggestions-ux.md`。
- **未**執行 Stage / Commit / Push / Reset / Restore / Stash / Checkout / Clean；**未**停止或重啟任何正式服務。
- 既有所有 tracked modified 與 untracked 檔案原樣保留（未覆蓋、未清理、未還原）。
- `git diff --check`：**已執行通過**（GIT_DIFF_CHECK_OK）。
- Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、ahead 1／behind 0。
- `codegraph` 索引：本輪未 sync（`pwsh` 啟動失敗，`codegraph status` 無法執行）；`.codegraph/` 視為衍生索引，待 shell 回復後 sync。

### 12.9 正式服務是否受到影響

- **未受影響。** 未停止／重啟／修改正式 ComfyUI（8188）、simple_ui（7860）、WD14 Worker 或任何正式設定；未連接正式服務；未修改模型、Workflow、輸出圖片、使用者資料或 localStorage；未讀取或傳遞任何真實 API Key。
- 本輪僅變更 `server.py` Civitai version metadata 快取寫入邏輯，並加測試；前端 `app.js` 未變動。

### 12.10 尚存風險與需要 ChatGPT 特別審查的項目

1. `civitai_version_meta` 的 `_gen_lock` → `_cache_lock` 鎖序：需確認代碼庫中沒有其他路徑先持 `_cache_lock` 再觸碰 `_civitai_gen`（現行僅 `civitai_version_meta` 觸碰 `_gen_lock`，風險低）。
3. `_civitai_gen` 只增不減，長期運行後序號會增長（Python int 無上限，實務無影響，但為設計細節）。
4. cache miss 併發時，較低世代的成功請求會被跳過寫入（不寫快取），下一次請求需重新 upstream fetch；這是為了正確性的合理代價，不影響資料正確性。
5. 代碼庫中 `server._civitai_get` 被測試 monkeypatch，需確認還原 (`_cv_r3_unpatch` / `finally`) 正確，不污染既有 `t_cv_*` 測試。

---

## 結語

第三輪審查修正（R3）已修正後端 Civitai Version Metadata 快取寫入競態：同一 Version ID 僅允許最新一代請求寫入快取，較早開始但較晚完成的舊請求不得覆蓋較新快取，舊請求失敗亦不污染新快取；TTL 300 秒與既有 API 行為不變，未碰 API Key、前端或正式服務。新增 R3-1～R3-4 決定性競態測試（經真實 HTTP endpoint 驗證），並以 CMD 已實際執行：`python -m py_compile server.py` 通過、`python devtools/lora_api_test.py` **27 tests passed**（R3-1～R3-4 與既有 `t_cv_*` 全數通過）、`git diff --check` 通過。正式服務未受影響。等待 ChatGPT 獨立審查。
