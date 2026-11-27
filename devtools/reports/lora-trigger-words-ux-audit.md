# LoRA Trigger Words 使用體驗唯讀調查

日期：2026-11-26
Repository：`C:\ComfyUI\simple_ui`
性質：**唯讀調查**。本輪沒有修改任何程式碼、測試、使用者設定、localStorage、模型或服務；唯一新增檔案是本報告。

---

## 1. 任務目標與執行範圍

### 1.1 目標

改善 Simple UI 的 LoRA Trigger Words 使用體驗，讓一般自架使用者能正確使用社群訓練的 LoRA。近期 Amora（Star Savior）真實 A/B 已證實：

- LoRA 可正常載入並接入 Workflow（LoraLoader 的 MODEL/CLIP 鏈正確）。
- **沒有 Trigger Words 時無法喚出角色**（B 組只滲出配件，角色本體沒被喚起）。
- 加入正確角色識別詞後可成功產出目標角色（C 組，Group 1 + weight 0.8，與 W08 逐像素一致）。
- 本機 safetensors metadata 的 `triggerWords` 是空陣列，但 Civitai 版本資料的 `trainedWords` 有兩組字串。

本輪調查的是**通用產品設計**，不是為 Amora 寫特例；且**只調查、不實作**。

### 1.2 執行範圍

依任務要求依序完成：

1. 讀 `C:\ComfyUI\AGENTS.md`（完整 303 行）。
2. 讀 `C:\ComfyUI\simple_ui\AGENTS.md`（完整 184 行）。
3. 讀任務涉及的其他規範／既有報告（`lora-phase1.md`、`lora-ux-copy.md`、`lora-personal-api-key-phase-a.md`、`lora-personal-api-key-phase-b-audit-r2.md`、`lora-personal-api-key-phase-b1-implementation.md`、`amora-lora-real-generation-ab-test.md`、`amora-star-savior-official-crosscheck.md`、`lora-explorer-real-world-audit.md` 等）。另有全 repo 搜尋 `AGENTS.md`：只有 `simple_ui\AGENTS.md` 一份，無子目錄規範檔。
4. 執行 `codegraph status`（結果見 §3）。
5. 實際查詢 Repository / Branch / HEAD / Remote / Ahead-Behind / Git Status（見 §2）。

### 1.3 給技術審查的執行摘要

- 現有 `ui.loras` 只有**一組扁平 `triggers` 字串陣列 + 單一 `autoTrigger` 布林**，作者提供的詞與使用者自己輸入的詞**混在同一個欄位**，無法區分。
- Civitai 的 `trainedWords` 目前**只當卡片文字顯示**，不會自動或手動寫入 LoRA 觸發詞；唯一會「帶入」的建議來自本機 safetensors metadata（`triggerWords`）。
- Civitai 官方 API 的 `GET /api/v1/model-versions/{id}` 與 `GET /api/v1/models/{id}` 都回 `trainedWords`；**不需 API Key**，實測成功的 NSFW LoRA 也回得到。**但 `trainedWords` 是「字串陣列，每個字串可能是一整串逗號分隔詞組」**，且不同版本內容不同；直接 concat 進 `triggers` 會產生含逗號的巨大 chip，且可能把服裝／暴露詞一併注入。
- 建議：**保留現有扁平 `triggers` 不變，另加只讀的作者建議欄位＋指紋；作者詞一律需使用者明確「帶入」，metadata 更新永不覆蓋使用者詞；提醒用非阻塞行內提示，並以每個 LoRA 的「不需要觸發詞」確認避免重複警告**。不需要 API Key，不需要群組管理系統。
- 重大實作陷阱：`loraParseItems()` / `loraSerialize()` / `reusePrompt()` 都是**白名單式重建物件**，任何新增欄位若不同時加進這三處，會在下次存檔或歷史還原時被靜默丟掉。

---

## 2. Repository、Branch、HEAD、Remote、Git 狀態

全部資料為本輪實際查詢結果（`git -C C:\ComfyUI\simple_ui ...`），未沿用舊報告。

| 項目 | 實際結果 |
|---|---|
| Repository 根目錄 | `C:/ComfyUI/simple_ui` |
| Branch | `main`（`git status -sb` 顯示 `## main...origin/main [ahead 1]`） |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch / push 相同） |
| Ahead / Behind | `git rev-list --left-right --count HEAD...origin/main` → `1` / `0` |
| Staged | **0**（`git diff --cached --name-only` 無輸出） |
| Tracked Modified | **13** |
| Untracked | **47 個 porcelain 項目**（其中 2 個是目錄）；`git ls-files --others --exclude-standard` 展開為 **79 個檔案** |
| Porcelain 總行數 | 60 = 13 modified + 47 untracked |

本輪任務開始時的 tracked modified（13 個）：

`AGENTS.md`、`app.css`、`app.js`、`devtools/lora_explorer_api_test.py`、`devtools/lora_explorer_core_test.mjs`、`devtools/lora_mock_civitai.py`、`devtools/lora_ui_test.mjs`、`devtools/test_ui_control_wd14.ps1`、`index.html`、`server.py`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`。

重要的 untracked 項目包含既有 LoRA / API Key / 開源準備 / Amora 等報告目錄與檔案；本輪**全部保留、未覆蓋、未清理**。目標檔 `devtools/reports/lora-trigger-words-ux-audit.md` 在寫入前經 glob 確認**不存在**，故使用原訂檔名，未版本化。

---

## 3. CodeGraph 索引狀態

`cd C:\ComfyUI\simple_ui; codegraph status` 實際輸出：

```text
Project: C:\ComfyUI\simple_ui
Files: 35 / Nodes: 1,094 / Edges: 4,837 / DB Size: 7.02 MB
Backend: node:sqlite — built-in (full WAL) / Journal: wal
Pending Changes:
  Added:     4 files
  Modified:  2 files
ℹ Run "codegraph sync" to update the index
```

判定：**索引過期（stale）**。依上層 `AGENTS.md` 與任務要求，本輪**不執行 `codegraph sync`**（唯讀、禁止寫入衍生索引），改以 Grep + Read 直接讀取目前磁碟原始碼；所有程式碼位置與行號均以本輪讀到的內容為準，**不把舊索引當成完整依據**。因此本報告中若有新函式未被索引收錄，屬預期情況。

---

## 4. 現有 LoRA 架構及程式碼位置

### 4.1 核心呼叫鏈（本輪逐段讀取）

```text
載入：app.js:596  S.loras = loraParseState(loadJSON("ui.loras", null)).items
  ↓
UI：renderLoraSelected()(1694) / renderLoraPick()(2350) / renderLoraTriggers()(2396)
  ↓  loraOnPickClick()(2471) / loraSaveTriggerInput()(2505) / loraOnTriggersClick()(2523)
  ↓  loraOnTriggersChange()(2559) → loraSet()(491) → loraSave()(1662) → saveJSON("ui.loras")
  ↓
生成：generate()(698) → verifySelectedLoras()(1813)
  → snapshotNow()(320) → loraSnapshot()(522) + loraTokensFromSnapshot()(534)
  → o = {... loras: snap.loras} → wf()(578) → loraApplyToWorkflow()(551) → POST /prompt
  → 歷史項目 loras: snap.loras（820）→ reusePrompt()(1063) → loraParseItems()(446) → loraSave()
```

後端：

```text
server.py:_loras()(1819) → fetch_lora_list()(610) → ComfyUI /models/loras
server.py:_lora_meta()(1833) → fetch_lora_meta()(666) → ComfyUI /view_metadata/loras
  → _lora_meta_extract()(630) → LORA_TRIGGER_KEYS(563-566) → triggerWords[]
server.py:_civitai_search()(1896) → civitai_search()(989) → _civitai_get()(743)
  → _normalize_civitai_item()(928) → version.trainedWords[]
```

### 4.2 A1–A8 逐題回答

**A1. 現有 LoRA 資料結構如何保存 Trigger Words？**

- 使用者詞：`ui.loras.items[].triggers`，**字串陣列**，扁平、無分組、無來源標記。定義於 `app.js:454-462`（parse）、`471-481`（serialize）、`496-499`（新增預設）。
- 清理規則：`loraCleanTriggers()`（`app.js:432-443`）：換行轉空白、trim、單筆 ≤200 字、以 `loraNorm()`（小寫 + 底線/空白折疊成單一空白）去重、最多 **40** 筆（`LORA_MAX_TRIGGERS`, `app.js:396`）。**注意：它不按逗號切割**；只有手動輸入框 `loraSaveTriggerInput()`（`app.js:2509`）會用 `/[,\r\n]+/` 拆分。
- 另一個獨立來源：**本機 safetensors `__metadata__`**。`server.py:630-663` 的 `_lora_meta_extract()` 從 `modelspec.trigger_phrase`、`modelspec.trigger_words`、`ss_trigger_words`、`trigger_words`、`trigger_phrase` 取值，逗號/換行拆分，去重，最多 20 筆，欄位名為 **`triggerWords`**。前端在 `renderLoraTriggers()`（`app.js:2405-2421`）顯示「metadata 建議：… [帶入]」，由 `loraOnTriggersClick()` 的 `use-meta` 分支（`app.js:2546-2555`）以 `it.triggers.concat(sug)` 複製到使用者欄位。**不自動注入**。
- Civitai `trainedWords` 目前**只是卡片/預覽文字**（`app.js:2152, 2161, 2302, 2309`；資料來自 `server.py:961-962`），**完全沒有進入 `ui.loras`**。

**A2. `ui.loras` 中每個 LoRA 的欄位及持久化方式？**

```js
{
  v: 1,
  items: [{
    name:        "chars\\角色.safetensors", // ComfyUI 相對路徑＝穩定識別值
    display:     "角色",                     // 顯示名（預設取檔名去副檔名）
    strength:    0.8,                        // 單一權重，同時給 MODEL/CLIP
    triggers:    ["角色", "red eyes"],       // 扁平字串陣列（本輪主角）
    autoTrigger: true,                       // 是否把 triggers 加進 positive prompt
    enabled:     true                        // 選取狀態；移除＝false，保留其他設定
  }]
}
```

- key：`ui.loras`（新 key，與舊 `sel`/`combos`/`adult`/`showEn`/`ui.extra` 無關）。
- 讀：`app.js:596` → `loraParseState()`(467) → `loraParseItems()`(446)；壞資料逐筆跳過，大小寫不敏感同名去重，名稱格式由 `loraNameOk()`(412) 驗證（只准 `.safetensors`、相對路徑、無 `..`/絕對路徑/null byte/≤512 字）。
- 寫：`loraSave()`(1662) → `loraSerialize()`(471)。每次切換、改權重、改觸發詞、開關自動加入、移除都寫。
- `strength`：`loraWeight()`(405) 擋非數值，夾在 ±100（ComfyUI 節點上限），UI 滑桿 -2～2 / step 0.05；snapshot 另保留 `strengthModel` / `strengthClip` 覆寫介面（`app.js:565-566`）。

**A3. 自動注入開關如何運作？**

- 每筆 LoRA 一個 `autoTrigger`，UI 是 `#loraAuto` 核取方塊（`app.js:2434-2438`），變更走 `loraOnTriggersChange()`(`2559-2567`) → `loraSet(..., {autoTrigger})` → 存檔。
- `loraSnapshot()`(`522-530`) **無條件保存完整 triggers**；`loraTokensFromSnapshot()`(`534-548`) 才判斷：`autoTrigger === false` 直接跳過，其餘依加入順序跨 LoRA 去重後輸出。此職責分離是 Phase 1 獨立審查後的修正（`lora-phase1.md:241-265`）。
- 舊資料缺欄位：`loraParseItems()` 用 `it.autoTrigger !== false`、`loraTokensFromSnapshot()` 用 `l.autoTrigger === false` 判斷 → **缺欄位視為啟用**。
- **沒有全域開關**：`S.settings`（`app.js:15-18, 31`）不含任何 LoRA 相關欄位；`S.civitai`（`36-44`）的 `nsfw` 只影響探索中心圖片，不影響觸發詞。跨 LoRA 的唯一「全域效果」是 prompt 組合時的共用去重。

**A4. 多 LoRA Trigger Words 如何合併、去重、維持順序？**

- 單筆內：`loraCleanTriggers()` 用 `loraNorm()` 小寫＋`[_\s]+`→空白去重，保留第一次出現的原始大小寫/底線形式，上限 40。
- 跨筆：`loraTokensFromSnapshot()` 依 `loraSnapshot()` 的順序（＝使用者加入順序＝Workflow 串接順序，`app.js:519-521`）走訪已啟用 LoRA，跳過 `autoTrigger:false`，以同一 `loraNorm()` key 去重，**保留第一次出現順序**。
- 限制：去重 key 是正規化字串；「同義不同字」（如 `hair ornament` / `hair_ornament`）會被合併，但「整串群組字串」與其內容單詞**不會**被拆解比較（見 §6）。

**A5. 生圖時如何把 Trigger Words 加入 Prompt？**

- `snapshotNow()`(`320-347`)：`parts = 標籤 → #pos(ui.extra) → loraTokens`，最後 `pos = QUALITY + parts.join(", ")`，前後逗號/空白清掉；回傳 `{pos, neg, loras, loraTokens, ...}`。
- `composePrompt()`(`311-316`) 用同一套邏輯，因此「完整提示詞」預覽（`showPromptModal()`, `1624-1646`）與實際送出一致。
- `wf(o)`(`578-592`) 把 `o.pos` 放進 node `"2"` `CLIPTextEncode`；`o.neg` 放 node `"3"`。**觸發詞只進正面，不進負面**。
- `loraApplyToWorkflow()`(`551-576`) 在 0 個 LoRA 時原封不動回傳 7 個節點；N 個時依序新增 `LoraLoader`，同時串 MODEL 與 CLIP，最後把 node 2/3 的 clip 與 node 5 的 model 接到鏈尾。`generate()` 在 `ensureComfy()` 之後先跑 `verifySelectedLoras()`(`1813-1825`) 確認模型還在 `/api/loras` 清單中。

**A6. 歷史紀錄如何保存及恢復 LoRA 設定？**

- `generate()` 在拿到輸出後，每張圖寫入 `loras: snap.loras`（`app.js:810-822`），存到 `ui.gallery`（最多 24 筆，`825-826`）。內容含 name/display/strength/**完整 triggers**/autoTrigger；**不含 `enabled`**（還原時一律 `enabled:true`）。
- `logGen("snapshot", …)`(`759`) 只記 `name@strength` 供診斷；`ui.genLog` 保留最近 50 筆。
- `reusePrompt()`(`1063-1081`)：有 `it.loras` 就用 `loraParseItems({items: it.loras.map(...)})` 還原 → `loraSave()` → 重繪。**這會整組覆寫目前 `ui.loras` 選擇**，不只還原提示詞。

**A7. 舊版歷史缺新欄位時如何相容？**

- 舊歷史**完全沒有 `loras` 欄位** → `reusePrompt()` 不進還原分支，**保留目前 LoRA 選擇**（`app.js:1068-1070` 註解、`lora-phase1.md:283-304` 的第二輪審查）。
- `loras: []` → 還原成空清單，**清空**目前角色。
- 有 `loras` 但缺少 `autoTrigger` → `loraParseItems()` 視為 `true`。
- `triggers` 非陣列／含壞值 → `loraCleanTriggers()` 安全清理。
- 相容性測試記載於 `lora-phase1.md:5.4 / 10.3 / 11.3`（當時 17 core / 14 API / 29 UI tests passed；本輪未重跑，見 §15）。

**A8. 是否存在全域設定與單一 LoRA 設定互相影響的問題？**

- 沒有全域 trigger 開關（見 A3），所以不存在「全域 Cover 掉單筆 autoTrigger」。
- 但目前有三個**跨層互相影響點**，是本次改善要處理的：
  1. `reusePrompt()` 從「單張歷史」反向覆寫**全域目前選擇**（使用者可能只是想copy文字，卻整組 LoRA 被換掉）。
  2. `use-meta` 把作者 metadata `concat` 進使用者 `triggers`（`app.js:2550`），**兩來源合併後不可分辨**；日後 metadata 更新沒有任何依據可安全刷新。
  3. Civitai 探索中心的 `trainedWords` 是**另一個作者來源**，目前沒有任何持久化欄位，也沒有「從卡片套用到本機 LoRA」的路徑（全 repo grep `data-cv-act` / 加入角色：不存在）。

### 4.3 既有報告的相關設計結論

- `lora-phase1.md:77-91`：`ui.loras` v1 格式；`:104-110`：觸發詞是獨立來源，不進 `sel`/`#pos`，移除角色保留設定；`:120-124`：快照與歷史完整保存 `triggers`/`autoTrigger`。
- `lora-ux-copy.md:3-11, 51-74`：UX 修正「完全沒有更動 LoRA 選取、權重、觸發詞、`ui.loras`、Workflow、歷史格式」；正常空清單與 API 錯誤要嚴格區分，Civitai 入口只是外部連結。
- `amora-lora-real-generation-ab-test.md:77-89, 162-189`：兩組 trainedWords 原文、A/B/C/D/W06/W08/W10 結果；Group 1 喚角色、Group 2 改服裝/姿態；官方**沒有**把 Group 2 標為 Negative；本機 metadata `triggerWords: []`。
- `amora-star-savior-official-crosscheck.md:98-122, 220-237`：官方頁與鏡像頁 `trainedWords` 逐字一致，第二組只是陣列第二項，不是官方標示的 negative。

---

## 5. Civitai API 官方文件及實際驗證結果

本章用標籤區分證據強度：**【官方文件】**、**【實際 API 回應】**、**【推論／尚未驗證】**。

### 5.1 【官方文件】developer.civitai.com

查核時間：本輪。文件首頁宣告 wiki 已搬至 `developer.civitai.com`，每個頁面有 `.md` 版本。

- 基底：`https://civitai.com/api/v1`，所有回應 `application/json; charset=utf-8`。
- Auth 分級：
  - *Public*：不需 token。
  - *Mixed*：無 token 也可用，但部分參數或回應欄位需要 token。
  - *Authenticated*：無有效 token 回 401。
- `GET /models`：**Mixed**；`favorites` / `hidden` 參數需要 Bearer。文件 CLI章節明說 models search **已內嵌 `.modelVersions[]`**（含 `files[].hashes.SHA256` 與 `trainedWords`），從搜尋開始時「per-version `model-versions get` 通常多餘」。
- `GET /models/{id}`：**Public**，回單一 item（含 `modelVersions[]`、creator、tags、stats 等）；不存在回 404，非正整數 id 回 400。
- `GET /model-versions/{id}`：**Mixed**；回 `id/modelId/name/baseModel/baseModelType/air/status/availability/nsfwLevel/trainedWords/files[]/images[]/stats/model/downloadUrl` 等；**版本不存在或未發布回 404**（管理員可略過發布檢查）。有 token 只多揭露少數欄位（如早期存取）。
- `GET /model-versions/by-hash/{hash}`：**Public**，回同形狀；`POST /model-versions/by-hash`：Public，最多 100 個完整 SHA256；`POST /by-hash/ids`：Public，最多 10,000 個，只回 id/hash 對。
- `GET /model-versions/mini/{id}`：**Mixed**，精簡版，**不含 `trainedWords`**（跳過 images/description/完整 files）。
- 快取：Public 端點帶 `Cache-Control: public, s-maxage=300, stale-while-revalidate=150`；authenticated 呼叫略過快取。
- 區域／成人：`images[]` 依 caller browsing level 過濾；Civitai「green domain」或受限區域會**靜默**只回 SFW；基於安全考量部分圖片被省略，全被省略時是 `images: []` 而非 null；`files[]` 只含公開檔；`model.mode` 可能為 `Archived` / `TakenDown`。
- 錯誤：共用 envelope `{code, message, error}`（`code`: `BAD_REQUEST` / `NOT_FOUND` / `CONFLICT` / `TIMEOUT` / `TOO_MANY_REQUESTS` / `INTERNAL_SERVER_ERROR`；但 401/部分 4xx 沒有 `code`，要同時看 HTTP status）；429 另有 `rateLimit: {retryAfterSeconds, retryAt}` 與 `Retry-After` header；5xx 與 429 用 1～30 秒指數退避；**沒有公布的每端點 rate limit 合約**，Cloudflare 邊緣限制屬營運措施。
- 官方文件**沒有定義 `trainedWords` 的語意**，只在範例顯示 `"trainedWords": []`。「作者訓練時用的提示詞／觸發建議」是社群慣例與本專案的解讀，**不是官方保證**。

### 5.2 【實際 API 回應】本輪未帶任何憑證的公開端點（webfetch，共 3 個 GET）

**驗證 1 — `GET https://civitai.com/api/v1/model-versions/3276795`（Amora Illustrious 版本）**

HTTP 200，JSON。關鍵欄位逐字：

```json
"id": 3276795, "modelId": 2898222, "name": "Illustrious",
"status": "Published", "availability": "Public",
"baseModel": "Illustrious", "baseModelType": "Standard",
"nsfwLevel": 60,
"model": {"name":"Amora（阿莫拉）——Star Savior（星之救援者）","type":"LORA","nsfw":true,"poi":false},
"trainedWords": [
  "amora,  blonde hair, hair ornament, long hair, purple eyes, blue eyes, hair over one eye,single hair bun, mole under eye,,mature_female",
  "cleavage, black dress, flower, bare shoulders, detached sleeves, high heels, thigh strap,  jewelry, gloves, hair ornament, no panties, purple rose, black gloves, long sleeves, purple dress, choker,"
]
```

觀察：

- `trainedWords` 是**陣列，元素為字串**；每個元素是一**整串以逗號分隔的詞組**，不是單一 tag。
- 格式異常實際存在：第一組 `amora,  blonde hair` 有**雙空格**、`mole under eye,,mature_female` 有**雙逗號**；第二組 `thigh strap,  jewelry` 有雙空格、結尾有逗號。
- **回應中沒有 `triggerWords` 欄位**（官方 docs 也沒有；「trigger words」只是文件叙述用語）。
- 這是 **NSFW / nsfwLevel 60 / model.nsfw=true** 的模型，匿名仍拿到 `trainedWords` 與 `images[]`。
- 與 `amora-star-savior-official-crosscheck.md` 的官方 SSR 內嵌值一致；但 `amora-lora-real-generation-ab-test.md:81,86` 的手抄「逐字」版本把第一個雙空格寫成單空格，**手抄不可作為格式依據**。

**驗證 2 — `GET https://civitai.com/api/v1/models/2898222`（同一模型的 model 層級）**

HTTP 200，JSON。有三個版本，id `3484585`(Anima2.0)、`3413349`(Anima1.0)、`3276795`(Illustrious)，**每個版本都有自己的 `trainedWords` 兩組字串，且內容逐版不同**（例如 Anima1.0 的第一組少了 `long hair`、`mature_female` 等）。這證明：

- 詞是**版本級**資料，不是模型級共用。
- 作者更新版本時詞會變 → 需要版本指紋／更新提示，不能只抓一次就永久視為正確。
- model 層級 `description` 也有 TAG/clothing 文字，但**權威欄位是版本的 `trainedWords`**。

**驗證 3 — `GET https://civitai.com/api/v1/model-versions/2514310`（WAI checkpoint）**

HTTP 200，JSON，`"trainedWords": []`。證明**空陣列是真實且常見的回應形狀**（Checkpoint 通常沒有訓練詞）；同時其 `model.nsfw: true` / `nsfwLevel: 60` 與官方文件範例的 `nsfw:false` 不同 → 文件範例僅供結構參考，不可當作實際值。

> 本輪**沒有**發 404、429、gated 模型或惡意格式請求（見 §15）。

### 5.3 B1–B10 逐題回答

| # | 問題 | 結論 |
|---|---|---|
| 1 | Model Version API 能否取得 `trainedWords`？ | **能**。【官方文件】`GET /model-versions/{id}` 回此欄位；【實際】3276795 回兩組字串。 |
| 2 | Model ID 與 Version ID 差異？ | `models/{id}` 回全部版本（各有自己的詞）；`model-versions/{id}` 只回指定版本。**選錯版本會拿到別的詞**（Amora 三版內容不同）。【實際】 |
| 3 | 資料型態及語意？ | JSON **字串陣列**，元素是「可能含逗號的整串詞組」；語意官方未定義，「訓練時相關詞」僅為本專案解讀。【官方＋實際＋解讀】 |
| 4 | 可能有多組不同用途詞彙？ | **可能**，Amora 就有兩組；但 API **沒有欄位標示用途／.Sequential／是否 negative**。「Group 2 進 negative」是先前使用者端建議，不是官方語意（見 `amora-star-savior-official-crosscheck.md:122`）。【實際＋既有報告】 |
| 5 | `triggerWords` 與 `trainedWords` 是否不同欄位？ | **不同來源、不同名稱**。本機 safetensors metadata 經 `server.py` 轉成 UI 的 `triggerWords`；Civitai API 只有 `trainedWords`。Amora 兩者同時成立（本機空、Civitai 兩組），**不矛盾**。【官方＋實際＋程式碼】 |
| 6 | 欄位不存在 / null / 空陣列 / 空字串 / 格式異常？ | 空陣列【實際】；其餘**尚未以真實 API 驗證**。建議正規化：非陣列→空、過濾非字串/空字串、每元素按逗號/換行拆 token、trim、正規化去重、訂上限。現有 `server.py:961-962` 先 `[:30]` 再檢查型別，若 API 回字串會被切成 30 個單字，屬韌性缺口。【推論＋程式碼】 |
| 7 | 是否需要 API Key？ | **不需要**。【實際】三個匿名 GET 皆 200；【官方】`models/{id}`=Public、`model-versions/{id}`=Mixed、`by-hash*`=Public；只有 `favorites`/`hidden`、下載與生成需要 token。 |
| 8 | 公開程度／成人／權限影響？ | 已發布 Public 且 NSFW 的模型仍回 `trainedWords`【實際】；未發布／不存在回 404【官方】；`Archived`/`TakenDown` 會影響 files/images【官方】；區域／green domain 會靜默 SFW 化，但本輪**未驗證**是否影響 `trainedWords`【推論】。 |
| 9 | Rate Limit、快取、錯誤處理？ | 【官方】429 有 `Retry-After`/`rateLimit`，無穩定 per-endpoint 合約；Public 快取 s-maxage=300。【既有程式】`server.py:702-723` TTL 300 秒、`_civitai_error()`(1862-1880) 已映射 429/5xx/offline 並轉送 `Retry-After`。**不要在短時間內大量查詢**。 |
| 10 | 頁面顯示的 trainedWords 是否與 API 一致？ | Amora **一致**（官方 SSR 內嵌值與本輪 API 逐字相同，含重複空格與結尾逗號）；**不能據此推廣到所有模型**。【既有報告＋實際】 |

### 5.4 Civitai metadata 與本機 metadata 的關係（重要）

```text
本機 LoRA 檔案 __metadata__
  → ComfyUI /view_metadata/loras
  → server.py:_lora_meta_extract() → { ..., triggerWords: [...] }   ← UI 現有「metadata 建議」
  → app.js:loadLoraMeta() → S.loraMeta[name] → 「帶入」 → ui.loras.items[].triggers

Civitai 版本資料
  → GET /api/v1/model-versions/{id} 或既有 /api/civitai/search（已含 trainedWords）
  → app.js:cvRenderCard() / cvRenderPreview() → 只顯示文字（目前無寫入路徑）
```

兩者都是「作者提供的資訊」，但**目前只有前者有 UI 入口**；後者要接進觸發詞，必須先解決「本機檔案 ↔ Civitai 版本」的對應（見 §13）。

---

## 6. trainedWords 資料格式與限制

1. **陣列元素是整串群組**，不是單一觸發詞。現有 `loraCleanTriggers()` 不拆逗號；若照 `use-meta` 的 `concat` 模式直接帶入 Civitai `trainedWords`，會得到兩個超長 chip，而且 Prompt 裡等於把整串原文貼回去（含雙逗號、結尾逗號）。**必須先拆分＋trim＋去重＋丟空值**。
2. **一組不等於一詞，也不等於「必須注入的角色詞」**。Amora Group 1 是角色外觀，Group 2 是服裝／姿態；把兩組全注入會改變構圖與暴露度。產品上應讓使用者**選一组／逐詞挑**，而不是全自動。
3. **官方無語意標記**。沒有 `type: character | clothing | negative`、沒有 `<|...|>` 角色關鍵字欄位；任何「哪一組是角色詞」的判斷都是使用者端決定。
4. **版本級、會變**。模型有多版且詞不同 → 需保存 `versionId`／指紋與抓取時間；重新查詢時比對，更新只更新「作者建議」，永不寫入使用者詞。
5. **空陣列是正常狀態**（驗證 3）。「沒有 trainedWords」不該被當成錯誤；很多 LoRA 本來就不需要觸發詞。
6. **來源混淆风险**。UI 的 `triggerWords`（本機）與 Civitai `trainedWords` 名字不同、語意相近但內容可能不同；如果混在同一個 `triggers` 欄位，日後無法回答「這個詞是作者給的還是我自己打的」。
7. **現有後端正規化弱點**：`server.py:961-962` 用 `[:30]` 先截再檢查型別；若欄位是字串或 unusual 型別，會被切成單字。將來若新增 Civitai metadata 路由，應先驗證 `isinstance(list)` 再逐項處理。
8. **回應體積**：`/models/{id}` 與 `/model-versions/{id}` 的 `images[].meta.comfy` 內含巨大 JSON（本輪 `/models/2898222` 回應很大）。既有 `_normalize_civitai_item()` 已限制 images 最多 8、version 最多 30、trainedWords 最多 30，並不回 description，請沿用相同收斂策略。

---

## 7. 每個 LoRA 個人 Trigger Words 的設計方案

### 7.1 共同約束

- 作者提供的 metadata 與使用者自行設定的詞**必須明確區分**。
- metadata 更新**不得覆蓋**使用者編輯；也不得覆蓋使用者「這個 LoRA 不需要觸發詞」的確認。
- 不得把 `trainedWords` 每一詞都當成必須注入的角色識別詞。
- 基本功能不依賴 API Key；無法取得 metadata 時仍可手動編輯。
- 一屏不捲動、hover 不變尺寸、只用系統字、inline SVG、無框架／build step。
- 舊 `ui.loras` / 舊 `ui.gallery` 必須能讀。

### 7.2 方案 A（對應任務「方案 1」）：沿用單組 `triggers` + Civitai metadata 自動匯入

- 資料結構：完全沿用現有 `{triggers, autoTrigger}`；新增查询時把 Civitai `trainedWords` 拆詞後直接 `concat` 進 `triggers`（或覆蓋）。
- 使用者編輯：和現在一樣只有一個 chip 清單；匯入後作者詞與使用者詞視覺上完全相同。
- 優點：改動最小；`loraParseItems/serialize`、`reusePrompt()`、Workflow、去重、歷史全部不用改。
- 缺點：**無法區分來源**；再次匯入／metadata 更新會重複或覆蓋；Amora 兩組全匯入會注入服裝／暴露詞；「自動匯入」與「autoTrigger 自動注入」容易被混為一談。
- 風險等級：高（資料所有權不清，日後難補）。

### 7.3 方案 B（對應任務「方案 2」）：每個 LoRA 多組 Trigger Words，使用者選啟用組別

- 資料結構：`triggers: [{id, label, words[], enabled, source}]` 或另加 `groups[]`；需維持 group id、順序、啟用狀態。
- 使用者編輯：每組一個開關＋逐詞編輯；可在面板選擇只啟用 Group 1。
- 優點：最接近 Amora 真實需求（選一組）；語意清楚。
- 缺點：新資料格式需要完整 migration；`loraCleanTriggers` / `loraTokensFromSnapshot` / 歷史 / 預覽都要重寫；一屏版面要塞群組 UI；大多數只有一組的 LoRA 也要承擔複雜度。**過度設計風險高**。
- 風險等級：中高（相容性與版面）。

### 7.4 方案 C（對應任務「方案 3」）：作者建議與個人詞分開，保留扁平 active triggers

- 資料結構（在既有欄位之外，**只加選用欄位**）：

```js
{
  name, display, strength, triggers, autoTrigger, enabled,   // 全部沿用，語意不變
  author: {                                                  // 只讀建議，使用者詞不進這裡
    source: "local" | "civitai",
    sourceId: "3276795" | null,        // Civitai version id；local 用 null
    words: string[],                   // 已拆分、去重的建議詞（可再分 groupIndex）
    groups: [{ index: 1, words: [...] }, ...],
    fetchedAt: 1730000000000,
    fingerprint: "..."                 // versionId 或設定檔 hash，用來判斷是否更新
  } | null,
  noTriggerNeeded: false               // 使用者明確確認「這個 LoRA 不用觸發詞」
}
```

- `triggers` 仍是**唯一會被注入 Prompt 的使用者詞**；作者詞只能透過「加入」動作複製進 `triggers`，複製後就是使用者的，可自由改/刪。
- 群組呈現：用 `groups[index]` 唯讀顯示「建議 1 / 建議 2」，每組一個「加入這組」與「逐詞加入」；**不需要持久化群組開關**。Amora 情境就是按「加入建議 1」。
- 更新：`fingerprint` 變了只更新 `author.words/groups/fetchedAt` 並顯示「作者建議有更新，查看差異」，**不碰 `triggers` / `noTriggerNeeded`**。
- 優點：明確區分來源、不覆蓋使用者、不需群組管理系統、舊資料完全相容、Prompt/Workflow/去重/歷史邏輯不用改。
- 缺點：要多幾個欄位與一個正規化函式；`author` 需要填入路徑（見 §13 對應問題）。
- 風險等級：低～中。

### 7.5 比較表（必要項目全部列入）

| 評估項目 | 方案 A（現有單組 + 自動匯入） | 方案 B（多組管理） | 方案 C（作者/個人分離，**推薦**） |
|---|---|---|---|
| 初次使用難度 | 低（全自動，但可能一次注入過多詞） | 高（要理解群組與開關） | 低（一鍵加入建議組，或跳過） |
| Trigger Words 管理 | 單一 chip 清單，來源混在一起 | 多組＋每組開關，功能最完整 | 使用者的 `triggers` 不變；作者建議唯讀陳列 |
| 多組詞彙支援 | 無（攤平成單組） | 完整（持久化 group 與 enabled） | 顯示／一鍵加入即可，不持久化群組狀態（足夠且不過度設計） |
| 作者 metadata 整合 | 直接覆蓋/合併，風險高 | 可，但 migration 大 | 可，指紋比對、只更新建議 |
| 個人編輯保存 | 會被再次匯入覆蓋 | 可保存但格式已變 | **永不覆蓋**；作者詞與使用者詞物理分離 |
| 無 API Key 體驗 | 可（若用既有公開 search） | 可 | 可；本機 metadata + 公開 Civitai 都免 Key |
| 舊資料相容性 | 完美 | 差（需遷移 group 格式） | 完美（只加選用欄位） |
| 實作複雜度 | 最低 | 最高 | 中低（新增正規化＋指紋＋UI 提示） |
| 長期維護成本 | 高（資料所有權不清，bug 難追） | 高（群組狀態、排序、歷史都要维护） | 低（既有核心邏輯不用動） |

### 7.6 不建議的做法

- 不把 `trainedWords` 每一項在選取 LoRA 時**自動注入** Prompt。
- 不把 Civitai 兩組詞自動合併成一個 chip 或一整串 prompt。
- 不建立完整群組管理系統（新增/刪除/重命名群組、群組排序持久化）來解決單純的「選 Group 1」需求。

---

## 8. 生圖前提醒 UX 方案

### 8.1 原則

1. **「沒有 Trigger Words」不是錯誤狀態**，提醒永遠非阻塞，不能擋住生成（與 `verifySelectedLoras()` 的「模型不存在」硬性阻擋不同）。
2. 提醒放在**既有 LoRA 面板與右欄行內**，不新增全螢幕步驟、不增加主要動作。
3. 一次性確認：`noTriggerNeeded: true` 記錄在**每個 LoRA**，不再重複同一警告。
4. 時機：**選取 LoRA 時**給主要提醒（那時使用者正在設定角色）；**生成前**只做 Supplement 檢查（並涵蓋「 historical 還原後忘記」的情境），且同一 LoRA 已確認過就不出現。
5. 提供快速入口：直接從提示文字按「加入建議 1 / 手動新增 / 這個不需要」。

### 8.2 八種情境的建議行為

| # | 情境 | 建議行為 |
|---|---|---|
| 1 | LoRA 沒有任何 Trigger Words，也查不到作者建議 | 右欄該列顯示低調提示：「還沒設觸發詞，可以自己加」＋「手動新增」「這個不需要」兩個入口；**不擋生成**、不反覆 toast。 |
| 2 | 有作者提供的 trainedWords，使用者尚未選擇 | 觸發詞面板顯示「作者建議（未必需要）：建議 1…／建議 2…」＋每組「加入這組」「逐詞加入」；右欄該列顯示「有待加入的建議 N」。不自動加入。 |
| 3 | 使用者已有自行設定的 Trigger Words | 顯示既有 chip；作者建議摺疊在下方，不干擾。 |
| 4 | 使用者明確關閉自動注入（`autoTrigger=false`） | 視為**有意為之**：不警告、不提醒；右欄維持現有「觸發詞（不自動加入）N」。 |
| 5 | 使用者知道某 LoRA 不需要 Trigger Words | 按「這個不需要」→ 設 `noTriggerNeeded:true`；之後完全安靜。可從面板隨時撤銷。 |
| 6 | 多 LoRA 只有一個缺詞 | 提醒**指名該 LoRA**（用 display），不要只顯示泛指的警示；其餘 LoRA 不受影響。 |
| 7 | Civitai API 無法連線 | **靜默降級**到本機 metadata／手動編輯；不出現錯誤警告、不阻擋生成（與現在探索中心 API 錯誤的分類一致，見 `lora-ux-copy.md:51-64`）。 |
| 8 | Civitai metadata 查詢失敗／格式異常／404 | 同上，且保留既有 `author`（若上次抓過）並標示「上次更新時間」，不覆蓋、不清空。 |

### 8.3 一次性提示 vs 持續性提示

- **持續性（行內）**：目前狀態本身（「有待加入的建議」／「已設不需要」）一直顯示在 LoRA 面板，但用固定空間＋`title` tooltip，hover 不變尺寸。
- **一次性（toast／首次提示）**：只在「首次選到一個完全沒有詞且沒有建議的 LoRA」時給一次，布林存在 `noTriggerNeeded` 或另一個 `ui.` key 皆可；之後靠行內狀態即可。
- **不建議**每次 `generate()` 都跳 modal；會違反「只有一個主動作／沒有死路」。

### 8.4 快速編輯入口

沿用既有 `loraModal` 的「觸發詞」按鈕（不需要新視窗）：

- `作者建議 → 加入這組`：把該組字串拆分、trim、正規化去重後放進 `triggers`（走既有 `loraCleanTriggers`）。
- `逐詞加入`：把單一建議詞加進 `triggers`。
- `手動新增`：既有 `#loraTrigInput`。
- `這個不需要`：設定 `noTriggerNeeded:true` 並在該列顯示「已標為不需要」。

---

## 9. API Key 與自架使用體驗分析

- **基本 LoRA 功能完全不依賴 Civitai**：`/api/loras`、`/api/lora-meta` 只走本機 ComfyUI（`server.py:610-686, 1819-1859`）；觸發詞、autoTrigger、Workflow、歷史都在本機完成。
- ** trainedWords 也不需要 Key**：本輪三個匿名 GET 全部 200；既有 `/api/civitai/search`（`server.py:989-1018`）用 `_civitai_get(path)` 預設 `auth=False`，回傳的 `versions[].trainedWords` 已經是可用來源。若要取得特定版本的權威值，`GET /model-versions/{id}` 是 Mixed，匿名可用。
- **API Key 維持選用**：`server.py:743-782` 只有 `auth=True` 且 `_civitai_auth_allowed()`（HTTPS + host=`civitai.com`）才加 Bearer；Key 用 DPAPI（CurrentUser）存 `%LOCALAPPDATA%\SidSimpleUI\civitai_key.bin`（`lora-personal-api-key-phase-a.md:42-67`），**永遠不進前端、localStorage、URL、快取或日誌**；`/api/civitai/key/status` 只回 `{configured, error}`。本輪**沒有讀取或嘗試讀取任何 Key**。
- **不強迫申請帳號**：沒有 Key 時，作者建議由公開端點或本機 metadata 取得；都拿不到就手動輸入（既有功能已完整）。
- **延伸到 Phase B2 的可能性**：Phase A/B1 的分層（公開預設、Bearer 僅在授權 host、錯誤碼映射、DPAPI、同源 guard）可自然延伸給「gated 模型的 metadata／下載」，但 **B1 報告明確指出 Phase B2 尚未開始、解析器未接入 `server.py`**（`lora-personal-api-key-phase-b1-implementation.md:230-269`）。本輪**不擅自開始 B2**，也不把 Key 與觸發詞功能綁在一起。

---

## 10. 與現有功能的相容性分析

### 10.1 localStorage（`ui.loras`）— 最重要的陷阱

`loraParseItems()`(`app.js:446-465`) 與 `loraSerialize()`(`471-483`) 都是**逐欄位重建物件**，不是 `Object.assign`。因此新增 `author` / `noTriggerNeeded` 時：

- 必須**同時**加入 `loraParseItems()` 的 push 物件、`loraSerialize()` 的 map 物件，以及 `loraSet()`(`496-505`) 的 patch 處理；漏一處就會在下次 `loraSave()` 被靜默丟掉。
- `loraCore` 的既有測試（17 項，見 `lora-phase1.md:5.2`）以序列化往返驗證，新增欄位要補回歸。
- 舊資料沒有新欄位 → `author:null` / `noTriggerNeeded:false`，既有流程完全不變。
- 不改 `sel`/`combos`/`adult`/`showEn`/`ui.extra`；`ui.gallery` 只是在項目多選用欄位。

### 10.2 歷史（`ui.gallery`）

- `generate()` 的 `loras: snap.loras`（`app.js:820`）目前只存五個欄位。若要在歷史保存作者建議以便「同提示詞」還原後仍能提醒，需要把 `author`/`noTriggerNeeded` 加進 `loraSnapshot()`(`522-530`)。
- `reusePrompt()`(`1070-1078`) 的 `it.loras.map(l => ({name, display, strength, triggers, autoTrigger, enabled:true}))` 也必須加同樣欄位，否則還原會丟。
- 舊歷史沒有新欄位 → 照現況走，不影響。
- **注意**：`reusePrompt()` 會整組覆寫目前 `ui.loras`；若加入「作者建議更新檢查」，應避免把目前其他 LoRA 的建議一起覆蓋（可考慮只還原歷史中有的 LoRA，但這是產品決策，需另外審查）。

### 10.3 Prompt / Workflow

- 只要作者詞不直接進 `triggers`，`snapshotNow()` / `composePrompt()` / `wf()` / `loraApplyToWorkflow()` / `loraTokensFromSnapshot()` **完全不用改**，風險最低。
- 若將來允許「一鍵加入作者詞」，加入後就是普通 `triggers`，既有跨 LoRA 去重與順序規則直接適用。
- 拆分群的函式應放在 LORA_CORE 區塊（`app.js:388-593`）內，讓 `devtools/lora_core_test.mjs` 可無瀏覽器測試。

### 10.4 Civitai 探索中心

- 既有 `_normalize_civitai_item()`(`server.py:928-986`) 已回 `trainedWords`，可作為「作者建議」來源，不需新 route 就能在「探索 → 加入本機 LoRA」流程帶入。
- 若要按版本 id 查詢，需新增後端路由並沿用 `_civitai_get(auth=False)`、`_civitai_error()`、`_cache_get/_cache_set`（TTL 300）與同源檢查；本輪**不實作**。
- `lora-meta`（本機 metadata）與 Civitai 建議應以 `source` 區分，UI 不要混成同一個「metadata 建議」。

### 10.5 測試與既有修改

- 現有工作區已有 13 個 tracked modified 與大量 untracked 報告；本輪**一個都沒動**。
- 將來改动需回歸：`devtools/lora_core_test.mjs`、`lora_api_test.py`、`lora_ui_test.mjs`、`lora_explorer_api_test.py`、`lora_personal_key_test.py` / `lora_personal_key_ui_test.mjs`（Key 相關不可碰 Key 值）。

---

## 11. 各方案優缺點及風險

### 方案 A

- 優點：最快上線；對既有格式零改動。
- 缺點／風險：來源不可區分 → 日後任何「更新作者詞」都可能毀掉使用者設定；整組自動注入會重現 Amora Group 2 的服裝／暴露副作用；把「有 trainedWords」誤解成「必須注入」。
- 結論：**不宜**。

### 方案 B

- 優點：能精確表達「選 Group 1」。
- 缺點／風險：需要 group id、啟用狀態、排序、歷史回放與 migration；一屏版面空間有限；多數 LoRA 只有一組，投入報酬比低。
- 結論：**除非未來真實需求證明多組持久化有必要，否則不做**。

### 方案 C（推薦）

- 優點：來源清楚、不覆蓋使用者、舊資料相容、核心生成邏輯不用動、無 Key 可用、可選 group 一次加入。
- 缺點／風險：
  1. `author` 欄位必須在三處白名單同步（§10.1），否則靜默丟失。
  2. 本機檔案 ↔ Civitai 版本對應尚未解決（§13）。
  3. `trainedWords` 格式異常需穩健拆分；目前後端正規化有弱點（§6.7）。
  4. 提醒文案若過度會變成噪音；需嚴格遵守 §8 的非阻塞與一次性規則。
- 結論：**推薦**，風險可控制且可漸進實作。

---

## 12. 推薦方案與推薦理由

### 12.1 推薦：方案 C 的輕量版

> 保留現有 `triggers` 與 `autoTrigger` 的語意與格式，**新增選用的 `author` 建議快照 + `noTriggerNeeded` 確認**；作者詞只展示、由使用者明確加入； metadata 更新只更新建議，不碰使用者詞。

### 12.2 資料模型（建議，供技術審查）

```js
// ui.loras.items[i] — 舊欄位完全不變
{
  name, display, strength,
  triggers: ["amora", "blonde hair", ...],  // 使用者拥有，唯一注入来源
  autoTrigger: true,
  enabled: true,
  // 以下為新增、選用
  author: {
    source: "local" | "civitai",
    versionId: "3276795" | null,
    fingerprint: "civitai:3276795" | "local:<hash>",
    fetchedAt: 1730000000000,
    groups: [ { index: 1, words: [...] }, { index: 2, words: [...] } ],
    stale: false
  } | null,
  noTriggerNeeded: false
}
```

- `groups` 只是**唯讀呈現與一鍵加入的資料**，不需要 group 開關持久化。
- 拆分規則：先把每個 `trainedWords` 字串按 `[,\r\n]+` 拆、trim、去空、正規化（`loraNorm` 同等規則）、上限沿用 40／單詞 200 字。
- 加入動作：`triggers = loraCleanTriggers(triggers.concat(groupWords))` → `loraSet` → `loraSave` → 重繪。加入後作者詞就变成使用者詞，可自由 edited/deleted。

### 12.3 流程（建議）

1. 使用者加入本機 LoRA → `loraSet` 建立預設（`triggers:[]`, `autoTrigger:true`, `author:null`, `noTriggerNeeded:false`）。
2. 打開觸發詞面板 → 先讀本機 `/api/lora-meta`（既有）；若 `triggerWords` 空且探索中心已知對應版本，才 attempt Civitai metadata（免 Key，失敗靜默）。
3. 呈現作者建議群組；按「加入這組 1」→ 觸發詞 chip 出現；按「這個不需要」→ 設 `noTriggerNeeded:true`。
4. 生成時完全走既有 `snapshotNow()/wf()`；提醒只在 UI 層，不進 Workflow。
5. 之後重新查 metadata：比對 `fingerprint`；不同只更新 `author.groups/fetchedAt` 並設 `stale:true`，**不碰 `triggers`/`noTriggerNeeded`**。

### 12.4 推薦理由

- **直接命中根因**：Amora 的問題不是 Workflow，而是「作者詞沒有進到使用者可見／可選的地方」。方案 C 把作者詞放到正確位置，且讓使用者選 Group 1。
- **尊重資料所有權**：明確區分作者與個人詞，滿足任務的硬性要求；metadata 更新不會覆蓋使用者編輯。
- **不過度設計**：不建完整群組管理系統；「一組／兩組」只要能唯讀展示＋一鍵加入即可。
- **相容性最好**：`ui.loras`、`ui.gallery`、Prompt、Workflow、去重、歷史還原的核心邏輯全部保留；只需在三處白名單補欄位。
- **符合自架產品定位**：全功能不需要 API Key 或帳號；Key 仍是進階選用，Phase B2 不被牽連。

---

## 13. 未驗證事項及需要後續調查的問題

1. **本機 LoRA ↔ Civitai 版本的對應**：目前沒有「用本機檔案找 Civitai 版本」的 API。官方有 `by-hash/{hash}` / `POST by-hash`（Public）可用，但 `server.py` 目前沒有計算任意 LoRA 檔 SHA-256 的路由（既有哈希只用在中途 `HEAD /view` 內容比對）。可行方向：使用者在探索中心搜尋並按「這是我的某個本機 LoRA」明確 link，或未来用 hash 自動比對。**需決策**：是否自動 link，還是保持使用者明確選擇。
2. **trainedWords 語意**：官方未定義。需產品負責人確認「建議詞」文案與免責（「不一定需要、可自行增刪」）。
3. **格式異常的真實多樣性**：只驗證空陣列、含雙空格/雙逗號的字串群組；null / 缺欄位 / 非陣列 / 元素非字串尚未以真實 API 驗證。
4. **429 / gated / 未發布模型**的實際回應：本輪刻意不發大量或未授權請求，只依官方文件。
5. **區域／green domain 對 trainedWords 的影響**：官方只明說 images 被 SFW 化；trainedWords 是否受影響未驗證。
6. **多 LoRA 同時作者建議的 UI 密度**：一屏不捲動限制下，如何同時顯示多筆建議需實測版面（本輪未開瀏覽器）。
7. **`reusePrompt()` 覆寫行為**：是否要在「同提示詞」時只還原詞而不覆蓋目前其他 LoRA 選擇，屬產品決策，需另行審查。
8. **作者建議的快取期限**：沿用 300 秒 TTL 是否足夠／是否要持久化到 `ui.loras.author` 需決定；目前建議是持久化快照＋手動「檢查更新」。
9. **Phase B2**：未開始，也未評估其實作；本報告只確認 Phase A/B1 架構可延伸。

---

## 14. 實際執行的檢查及結果

| 項目 | 結果 |
|---|---|
| 讀 `C:\ComfyUI\AGENTS.md` | 完整讀取 303 行 |
| 讀 `C:\ComfyUI\simple_ui\AGENTS.md` | 完整讀取 184 行 |
| 其他規範檔搜尋 | 全 repo 只有一份 `AGENTS.md`，無子目錄規範 |
| 讀既有報告 | `lora-phase1.md`、`lora-ux-copy.md`、`lora-personal-api-key-phase-a.md`、`lora-personal-api-key-phase-b-audit-r2.md`（章節）、`lora-personal-api-key-phase-b1-implementation.md`、`amora-lora-real-generation-ab-test.md`、`amora-star-savior-official-crosscheck.md`（章節）、`lora-explorer-real-world-audit.md`（章節） |
| `codegraph status` | 索引過期：Added 4 / Modified 2；未 sync（唯讀） |
| Git 查詢 | branch/HEAD/remote/ahead-behind/porcelain/staged/untracked 全數重新查詢（§2） |
| 程式碼搜尋 | `triggerWords|trainedWords|trigger` 等 grep，64/89/145 筆匹配後再逐段 Read |
| 讀 `app.js` | 1-60、300-599、698-847、1040-1099、1620-1864、2130-2184、2285-2324、2340-2584 |
| 讀 `server.py` | 548-692、689-823、920-1024、1815-1939 |
| 讀 `index.html` | LoRA 面板（193-202）、探索中心（359-）、LoRA Modal（412-430） |
| 官方文件 | `developer.civitai.com/site/reference.md`、`reference/model-versions.md`、`guide/errors.md`、`guide.md`（全部 `.md` 版本） |
| 實際 API GET（無憑證，3 筆） | `model-versions/3276795` → 200，兩組 trainedWords；`models/2898222` → 200，三版本各兩組且內容不同；`model-versions/2514310` → 200，`trainedWords: []` |
| 目標報告是否存在 | glob `devtools/reports/lora-trigger-words-ux-audit*` → 無，使用原訂檔名 |
| localStorage / 瀏覽器 | **未讀取、未修改**；未開 browse/browser，未連 7860/8188 |

---

## 15. 未執行的測試及原因

| 未執行 | 原因 |
|---|---|
| `node --check` / `python -m py_compile` | 本輪未修改任何程式碼，且任務為唯讀調查；不需要驗證語法。 |
| `devtools/lora_core_test.mjs` / `lora_api_test.py` / `lora_ui_test.mjs` / `lora_explorer_*` | 唯讀、禁止啟動 mock 服務或連接正式服務；既有結果只能引用旧報告（§4.2 A7）。 |
| 真實生圖 / GPU 測試 | 任務明確禁止。 |
| 重新啟動或停止 ComfyUI / simple_ui / WD14 Worker | 任務明確禁止。 |
| 瀏覽器 UI 實測（browse/browser） | 任務為唯讀程式碼/API 調查；且不得改 localStorage 或連接正式服務。 |
| 讀取或測試使用者 API Key | 任務明確禁止；本輪沒有讀取任何憑證，報告不含任何真實憑證。 |
| Civitai 404 / 429 / gated / 惡意格式請求 | 「不進行大量外部 API 請求」；只做 3 筆必要公開 GET，其餘依官方文件。 |
| `codegraph sync` / `index` | 唯讀任務禁止寫入衍生索引。 |
| Git stage / commit / push / reset 等 | 任務明確禁止。 |

---

## 16. 最終 Git 狀態

本報告寫入前後比對：

- Branch：`main`，HEAD：`cf5609e0cfbd69163247786f1f50dbf8e600c090`
- Ahead / Behind：`1` / `0`
- Staged：**0**
- Tracked Modified：仍為 **13**（清單同 §2，本輪未修改任何一個）
- Untracked：由任務開始的 **47 個 porcelain 項目（79 檔）** 變為 **48 個（80 檔）**，新增的只有本報告 `devtools/reports/lora-trigger-words-ux-audit.md`
- 沒有 commit、push、stage、reset、restore、stash、checkout、clean

> 本節数字以本輪實際 Git 查詢為準；若在 ChatGPT 審查前工作區又被其他流程變動，請重新查詢，勿沿用本節。

---

## 17. 正式服務是否受到影響

- **沒有**停止、重新啟動或殺掉任何 ComfyUI、simple_ui（7860）或 WD14 Worker 行程。
- **沒有**連接正式 7860 / 8188，沒有發出 `/prompt`、`/interrupt`、`/queue` 等請求。
- **沒有**修改模型、Workflow、輸出圖片、使用者設定、localStorage 或任何既有報告。
- **沒有**安裝或下載模型／套件；沒有 GPU 操作。
- 唯一的外部網路行為是對 `civitai.com` 官方公開 API 的 **3 筆匿名 GET** 與官方文件 `.md` 的下載；未帶任何憑證、未使用或保存 API Key。
- 因此正式服務與使用者資料**未受影響**。

---

## 結語

本報告已足以進入技術方案審查：現況程式碼位置、Civitai API 官方/實測證據、三種設計比較、提醒 UX、API Key 定位、相容性陷阱與未驗證事項皆已列出。**推薦方案 C 的輕量版**；下一步應由 ChatGPT 獨立審查，並由產品負責人決定是否進入下一階段。本輪**不開始實作**。
