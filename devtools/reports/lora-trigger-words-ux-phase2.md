# LoRA Trigger Words UX Phase 2 — 實作交付報告

日期：2026-11-26
Repository：`C:\ComfyUI\simple_ui`

---

## 1. 任務目標與實際執行範圍

### 1.1 目標

在 LoRA Phase 1 基礎上完成 Trigger Words 管理升級，核心原則：

1. 作者提供的 Trigger Words 是**建議**，不是使用者設定。
2. 只有使用者個人 `triggers` 會實際注入生成 Prompt。
3. 本機 metadata 與 Civitai metadata **分開保存、互不覆蓋**。
4. 一般自架使用者**不設定 API Key** 也能取得公開版本 metadata。
5. 舊歷史紀錄不得讓目前最新的作者 metadata 倒退。
6. Civitai 或 metadata 錯誤不得影響基本生圖。
7. 完整保留 Phase 1 的選擇、權重、Workflow、快照與歷史功能。

### 1.2 實際執行

- 開工前重讀 `C:\ComfyUI\AGENTS.md`、`C:\ComfyUI\simple_ui\AGENTS.md`，讀取 `lora-phase1.md`、`lora-ux-copy.md`、`lora-trigger-words-ux-audit.md`，並直接 Grep/Read 目前原始碼（不依賴舊報告行號）。
- CodeGraph 索引**過期**（Added 4 / Modified 2），未執行 sync（避免寫入衍生索引），改用 Grep + Read 直接檢查程式碼。
- 修改 `app.js`、`server.py`、`app.css` 與 4 個既有測試、新增 1 個測試、新增本報告。
- **未**重啟／停止正式 ComfyUI、simple_ui、WD14 Worker；**未**讀取任何 API Key、Cookie 或憑證；**未**進行 Git 寫入；**未**下載模型或做 GPU 生圖。

---

## 2. 開始前 Repository / Branch / HEAD / Remote / Git 狀態

全部為本輪實際查詢結果：

| 項目 | 值 |
|---|---|
| 工作目錄 | `C:/ComfyUI/simple_ui` |
| Branch | `main`，`## main...origin/main [ahead 1]` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 相同） |
| Ahead / Behind | `1` / `0` |
| Staged | 0 |
| Tracked modified | 13 |
| Untracked | 48 個 porcelain 項目（79 個檔案，含 2 個報告目錄） |
| Porcelain 總數 | 60 |

開始時 13 個 modified：`AGENTS.md`、`app.css`、`app.js`、`devtools/lora_explorer_api_test.py`、`devtools/lora_explorer_core_test.mjs`、`devtools/lora_mock_civitai.py`、`devtools/lora_ui_test.mjs`、`devtools/test_ui_control_wd14.ps1`、`index.html`、`server.py`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`。以上全部保留，未清理或重置；既有 untracked 報告（含 `lora-trigger-words-ux-audit.md`）未覆蓋。

CodeGraph：`Files 35 / Nodes 1,094 / Edges 4,837`，Pending `Added 4 / Modified 2` → **索引過期**，已明確記錄並改用原始碼直接檢查。

---

## 3. 修改檔案及目的

| 檔案 | 狀態 | 目的 |
|---|---|---|
| `app.js` | 修改（原有 modified，再增改） | 新增作者建議純資料層、個人/建議分區 UI、Civitai 版本連結與匿名取得、提醒、歷史相容 |
| `server.py` | 修改（原有 modified，再增改） | 新增 `GET /api/civitai/version?id=`，匿名取得單一版本 `trainedWords` 並正規化、快取、錯誤映射 |
| `app.css` | 修改（原有 modified，再增改） | 新增 `.lora-section` / `.lora-group` / `.lora-word` / `.lora-cv-link` / `.lora-status`，並限制面板高度 |
| `devtools/lora_core_test.mjs` | 修改（原未 modified） | 更新既有序列化預期，新增 tests 18–24 驗證新資料模型、正規化、fingerprint、提醒 |
| `devtools/lora_api_test.py` | 修改（原未 modified） | 新增 mock Civitai 與 tests 驗證匿名取得、空陣列、非陣列、壞元素、429/404/離线/坏 ID |
| `devtools/lora_ui_test.mjs` | 修改（原有 modified，再增改） | 新增 7 項真 DOM E2E（分區、整組/逐詞加入、只注入個人詞、狀態轉換、更新不覆蓋、空建議 vs 故障） |
| `devtools/lora_mock_civitai.py` | 修改（原有 modified，再增改） | 加入 `/api/v1/model-versions/{id}` 與 `POST /__mock/version`，供隔離 E2E 模擬更新/故障 |
| `devtools/lora_trigger_words_ui_test.mjs` | **新增** | 原始碼契約檢查：分區、操作、免 Key、狀態規則、歷史、提醒、路由、CSS |
| 本報告 | **新增** | 交付說明 |

**沒有**修改 `index.html`（觸發詞面板本來就由 `renderLoraTriggers()` 動態產生）、`tags.js`、`dict.js`、`tag_categories.js`、WD14、控制台或任何模型／使用者資料。

---

## 4. 新資料模型及相容策略

### 4.1 格式（向後相容，全部選用欄位）

```js
ui.loras.items[i] = {
  // Phase 1 原有欄位，語意完全不變
  name, display, strength, triggers, autoTrigger, enabled,
  // Phase 2 新增
  authorSuggestions: {
    local:   { groups: [["miku", "hatsune miku"]] },
    civitai: { versionId: 3276795, groups: [["amora", "blonde hair"], ["cleavage"]],
               fetchedAt: 1730000000000, fingerprint: "a1b2c3d4" }
  },
  noTriggerNeeded: false
}
```

- `triggers`：**唯一**實際注入 Prompt 的來源。
- `authorSuggestions.local`：本機 safetensors metadata 的建議（單一群組，因為後端已拆分詞）。
- `authorSuggestions.civitai`：使用者**明確連結**的單一 Model Version 快照；換版本就清空舊群的 `groups/fetchedAt/fingerprint`，不混用。
- `noTriggerNeeded`：使用者明確確認「不需要 Trigger Words」。
- `groups` 一律 `string[][]`；保留作者群組關係，但不持久化「群組開關」（避免過度設計）。

### 4.2 白名單路徑（任務高優先項）

新增欄位同時補進所有會重建物件的位置：

| 位置 | 處理 |
|---|---|
| `loraParseItems()`（`app.js:530`） | 讀 `authorSuggestions` / `noTriggerNeeded`，舊資料得安全預設 |
| `loraSerialize()`（`:557`） | 寫回新欄位 |
| `loraSet()`（`:579`） | patch 支援新欄位，局部更新不清空其他欄位 |
| `loraSnapshot()`（`:616`） | **只帶 `noTriggerNeeded`**；刻意不帶 `authorSuggestions`，避免舊歷史讓最新 metadata 回退 |
| `loraTokensFromSnapshot()`（`:629`） | 完全不改；仍只吃 `triggers` + `autoTrigger` |
| `reusePrompt()`（`:1185`） | 個人設定照舊還原，作者建議一律取目前 `S.loras` 的值，不採信歷史欄位 |
| `loadLoraMeta()`（`:2668`） → `loraSetLocalGroups()`（`:2541`） | 本機建議寫入 `authorSuggestions.local`，不改 `civitai` 或個人詞 |

純函式：`loraNormGroups`（`:453`）、`loraCivitaiGroups`（`:465`）、`loraFingerprint`（`:476`）、`loraAuthorDefault`（`:486`）、`loraParseAuthor`（`:494`）、`loraSuggestionCount`（`:514`）、`loraReminderState`（`:520`）。

`fingerprint` 以版本 ID + 建議內容做 FNV-1a（前端）／SHA-256 前 16 碼（後端），只用於辨識「建議是否變動」，**永不覆蓋個人詞**。

---

## 5. Civitai 版本連結與 metadata 取得流程

### 5.1 後端

- `server.py:997` `_civitai_version_words()`、`1015` `_civitai_version_groups()`、`1031` `civitai_version_meta()`，`1993` `H._civitai_version()`，路由註冊於 `1800`：`GET /api/civitai/version?id=<versionId>`。
- 走既有 `_civitai_get(path)` 預設 `auth=False`：`CIVITAI_API + "/model-versions/<id>"`，**完全不碰 API Key**（沒有 `read_api_key` / `Authorization` / `auth=True`）。
- `trainedWords` 正規化：先驗證是 `list`；元素須為 `str` 且非空、长度 ≤4000；按 `/[,\r\n]+/` 拆群組；逐詞 trim、單詞 ≤200 字、去空、以小寫＋底線/空白正規化去重、每群最多 40 詞、最多 20 群。雙逗號／結尾逗號／重複空白都安全；元素型別錯誤直接略過，不會被切成單字元。非陣列回 `groups: []` + `warning`（200，不算服務錯誤）。空陣列也是正常 200。
- 快取沿用 `_cache_get/_cache_set`，key `version|<id>`，TTL 300 秒。
- 錯誤：404 → `CIVITAI_VERSION_NOT_FOUND`；429 → `CIVITAI_RATE_LIMITED` + `retryAfter`；5xx／Node offline／BAD_JSON → `_civitai_error()` 既有映射；ID 格式錯 → 400 `BAD_VERSION_ID`。

### 5.2 前端

- 面板提供 `#loraCvId`（接受純數字 ID 或含 `modelVersionId=` 的版本網址）、`cv-link`、`cv-unlink`。解析見 `loraParseCvId()`（`:2721`）。
- `loraLinkCv()`（`:2750`）把 versionId 寫入目前 LoRA（捆綁本機名稱），清空該版本的舊建議，再呼叫 `loadCivMeta()`。**不猜檔名、不自動套用其他模型**。
- `loadCivMeta()`（`:2687`）匿名 fetch `/api/civitai/version?id=...`；成功時先檢查「目前綁定的 versionId 是否仍是同一個」，避免慢回應覆蓋新版本；只更新 `authorSuggestions.civitai`；失敗時只設 `S.loraCiv[name]` 暫時錯誤狀態，**保留既有建議與個人詞**，不擋生成。
- 面板顯示來源、版本 ID、取得時間、讀取中／取得失敗／作者建議已更新／警告；不同版本不混用。

---

## 6. 作者建議與個人詞彙 UI 行為

`renderLoraTriggers()`（`app.js:2567`）現在產生三個分區：

1. **我的 Trigger Words**（`.lora-personal`）：`autoTrigger` 開關、`#loraTrigInput`/`#loraTrigSave`、個人詞 chips、`no-trigger` 按鈕。文案明確「只有這些會放進 Prompt」，並顯示目前是否會自動注入。
2. **本機 metadata 建議**：狀態（讀取中／沒有可讀取 metadata／錯誤／建議群組），每組有「整組加入」與逐詞 `+` 按鈕；保留 Phase 1 的 `use-meta`（全部帶入）入口。
3. **Civitai 指定版本建議**：版本連結输入、連結／解除、來源與版本資訊、建議群組。

加入動作 `loraAddAuthorWords()`（`:2731`）：先把群組內詞逐一 `loraCleanTriggers` 正規化，再與既有個人詞合併去重（維持既有順序），**只有實際新增才**把 `noTriggerNeeded` 設為 false；加入後重繪並 toast。整組加入是逐詞加，不是把整串逗號文字塞成一個詞。資料索引（`data-src`/`data-g`/`data-w`）在使用前都做整數範圍驗證。

「此來源沒有提供 Trigger Words」是正常空狀態；API 故障顯示「取得失敗」，兩者不同。

---

## 7. `noTriggerNeeded` 狀態規則

| 操作 | 結果 |
|---|---|
| 初始／舊資料缺欄 | `false`（尚未確認） |
| 按「這個 LoRA 不需要 Trigger Words」 | `true`（可再按一次取消） |
| 手動新增個人詞 | `false` |
| 從作者建議整組／逐詞加入（實際有新增） | `false` |
| 刪除個人詞（含刪到全空） | **不變**，不會自動變 `true` |
| 關閉 `autoTrigger` | 不變 |
| 開啟 `autoTrigger` | 不變 |

UI 用「尚未確認是否需要」與「已確認不需要，生成前不再提醒」明確區分；右欄該 LoRA 的列也顯示對應狀態。

---

## 8. 生成前提醒行為

- `loraRemindBeforeGenerate()`（`app.js:795`）在 `verifySelectedLoras()` 通過後呼叫，**非阻塞**：只是 toast，不擋生成、不跳出 modal、不改 Prompt。
- 狀態（純函式 `loraReminderState()`）：已確認不需要 → 不提醒；`autoTrigger=false` 且有個人詞 → 提示目前不會自動注入；有作者建議尚未加入 → 提示可去挑選；完全沒有詞且未確認 → 提示確認是否需要。
- 用 `loraReminded` Set 記住「LoRA 名稱 + 狀態」，同一狀態只提醒一次；多筆時只顯示第一筆並附加「另有 N 個 LoRA」。
- Civitai 取得失敗只在面板顯示狀態，不在生成時轟炸警告。

---

## 9. 歷史紀錄相容策略

- `loraSnapshot()` 保存 `triggers`、`autoTrigger`、`noTriggerNeeded`；**不保存** `authorSuggestions`。
- `reusePrompt()`：
  - 有 `it.loras` → 還原當時個人設定（缺 `noTriggerNeeded` 視為 `false`）。
  - 作者建議一律用目前 `S.loras` 的值；即使舊歷史含 `authorSuggestions` 也不採用（明確忽略）。
  - Civitai 版本連結與最新建議不因重用舊歷史而改變。
  - `loras: []` → 清空目前角色（Phase 1 語意不變）；完全缺 `loras` 欄位 → 保留目前 LoRA 設定（Phase 1 語意不變）。
- 舊 `ui.loras`、`ui.gallery` 都能載入、保存、重用與生成；新欄位缺損時安全回退。

---

## 10. 實際執行的測試及結果

全部在隔離環境執行，未連正式 7860／8188：

| 指令 | 結果 |
|---|---|
| `node --check app.js` | 通過 |
| `node --check devtools/lora_core_test.mjs` | 通過 |
| `node --check devtools/lora_ui_test.mjs` | 通過 |
| `node --check devtools/lora_trigger_words_ui_test.mjs` | 通過 |
| `python -m py_compile server.py` | 通過 |
| `python -m py_compile devtools/lora_api_test.py` | 通過 |
| `python -m py_compile devtools/lora_mock_civitai.py` | 通過 |
| `git diff --check` | 無錯誤輸出（只有 LF→CRLF 提示，非錯誤） |
| `node devtools/lora_core_test.mjs` | **24 tests passed**（原 17 + 新 7） |
| `python devtools/lora_api_test.py` | **23 tests passed**（原 15 + 新 8） |
| `node devtools/lora_trigger_words_ui_test.mjs` | **9 tests passed**（新建） |
| `node devtools/lora_ui_test.mjs --ui http://127.0.0.1:7861 --mock http://127.0.0.1:18188 --mockcv http://127.0.0.1:18189 --capture <tmp>/cap.jsonl` | **60 UI tests passed**（原 53 全數回歸 + 新 7） |

E2E 環境：`lora_mock_comfy.py --port 18188`、`lora_mock_civitai.py --port 18189`、ComfyUI embedded Python 跑的隔離 `server.py`（`COMFY_URL` / `CIVITAI_API` / `SIMPLE_UI_PORT=7861` / `SIMPLE_UI_LOG_DIR` / `WD14_TMP` 全指向隔離資源），headless Chrome 1920×1080 / CDP。Console 0 非預期錯誤；版面不捲動、右欄不裁切。

新增 E2E 實際覆蓋：三區同時存在、整組加入與逐詞加入、逗號拆分與去重置順序、只有個人詞進 Prompt（未選的 `cleavage` 不注入）、`noTriggerNeeded` 六種轉換、切版本更新不覆蓋個人詞也不混舊版、空 trainedWords vs 404 故障的狀態差異、API 失敗後設定完好。

測試注意：後端 Civitai search/version 有 300 秒快取，連續跑 E2E 時需重啟隔離 server（或等待 TTL），否則 mock 的 request log 可能為空；本輪已用重啟隔離 server 的方式處理，正式服務不受影響。

---

## 11. 未執行的測試及原因

| 未執行 | 原因 |
|---|---|
| 正式 7860／8188 上的真實 UI 或真實 Civitai API 驗證 | 任務禁止連接正式服務；本輪只用隔離 mock |
| 真實 LoRA GPU 生圖、大量生圖 | 任務禁止；E2E 用 mock ComfyUI 的 1×1 PNG |
| 真實 API Key 相關流程（設定／測試／移除） | 任務禁止讀取或使用憑證；新功能完全不碰 Key |
| 429 在真實 Civitai 上的行為 | 只以 mock 驗證；官方文件亦說明無穩定 per-endpoint rate limit 合約 |
| SHA256 自動配對本機 LoRA ↔ Civitai 版本 | 明確不屬本階段 |
| `codegraph sync`／`index` | 唯讀索引維護，本輪不明確授權寫入 |
| Git commit／push／stage／任何寫入操作 | 任務禁止 |

---

## 12. 正式服務是否受到影響

- **沒有**停止、重啟或修改正式 ComfyUI（8188）、simple_ui（7860）或 WD14 Worker。
- **沒有**連接正式服務，沒有發出 `/prompt`／`/interrupt`／`/queue` 到正式環境。
- **沒有**修改模型、Workflow、輸出圖片、使用者 localStorage 或既有報告。
- **沒有**讀取、保存或使用任何 API Key／Cookie／登入憑證；報告也不含憑證。
- 隔離測試用的三個行程（18188 / 18189 / 7861）已於測試後終止，連接埠已釋放，暫存目錄已刪除。
- 結論：正式服務與使用者資料**未受影響**。

---

## 13. 最終 Git status、Diff 概況與 `git diff --check`

- Branch `main`，HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`，ahead/behind `1/0`，staged **0**。
- Tracked modified **15**（起始 13 + 本輪新動到 `devtools/lora_api_test.py`、`devtools/lora_core_test.mjs`）：`AGENTS.md`、`app.css`、`app.js`、`devtools/lora_api_test.py`、`devtools/lora_core_test.mjs`、`devtools/lora_explorer_api_test.py`、`devtools/lora_explorer_core_test.mjs`、`devtools/lora_mock_civitai.py`、`devtools/lora_ui_test.mjs`、`devtools/test_ui_control_wd14.ps1`、`index.html`、`server.py`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`。
- Untracked：起始 48 個 porcelain 項目 → 本報告完成後 **50**（新增 `devtools/lora_trigger_words_ui_test.mjs` 與本報告）；展開檔案數起始 79 → **82**。`git status --porcelain` 共 **65** 行（15 modified + 50 untracked）。
- 既有 untracked 報告（含 `lora-trigger-words-ux-audit.md`）全部保留，未覆蓋。
- `git diff --check`：**無錯誤輸出**（Git 只提示兩個測試檔 LF 將被轉為 CRLF，屬正常換行提示）。
- **沒有** commit、push、stage、reset、restore、stash、checkout、clean。

---

## 14. 尚未解決的問題、風險及限制

1. **本機 LoRA ↔ Civitai 版本對應仍靠使用者明確輸入**：本輪不實作 SHA256 自動配對（明確排除）。使用者貼錯版本 ID 仍可能拿到別的模型建議；UI 只負責顯示目前連結的版本資訊，不保證語意正確。
2. **提醒是 in-memory**：`loraReminded` 重載頁面後重置；同一狀態在下次開頁可能再提醒一次。這是有意的（避免寫入 `ui.` key），但若產品要求跨工作階段記住，需另行決策。
3. **`trainedWords` 語意仍非官方保證**：官方只定義欄位存在，未定義「哪些是角色詞」。本輪全部當「建議」，由使用者挑選；不猜 group 用途、不自動注入。
4. **單群最多 40 詞、最多 20 群**：異常大量的 metadata 會被截斷（有韌性上限），UI 每群最多顯示 20 個並標示「還有 N 個」；不會造成版面爆掉。
5. **後端 300 秒快取**：使用者按連結後短時間內看到的是快取快照；「作者建議已更新」是以 fingerprint 比對更新結果。若需要「立即重新抓取」按鈕，屬下一階段。
6. **`loraAddAuthorWords` 受既有 40 詞上限影響**：若個人詞已接近 40，加入時可能被 `loraCleanTriggers` 截斷，但 toast 顯示的是預期新增數；後續可改善為回報實際新增數。
7. **個人 API Key 的 Phase B2 未開始**：本輪只確認 `auth=False` 的公開路径可延伸，沒有触碰 gated 下載／Phase B2 架構。
8. **CodeGraph 索引仍過期**：本輪的程式碼位置以 Grep/Read 為準；審查者若依賴索引需先自行 `codegraph sync`（本輪未做）。

---

## 15. ChatGPT 特別需要審查的程式碼位置

| 位置 | 審查重點 |
|---|---|
| `app.js:453-525` | 作者建議正規化與 fingerprint 是否足夠安全；`loraParseAuthor(raw, fallback)` 的 fallback 用法是否語意清楚 |
| `app.js:530-600` | `loraParseItems` / `loraSerialize` / `loraSet` 是否遗漏新欄位；`loraSet` 局部 patch 是否會誤清空作者建議 |
| `app.js:616-640` | `loraSnapshot` 刻意不帶 `authorSuggestions`；是否與 §8 的歷史規則完全一致 |
| `app.js:795-820` | 生成前提醒是否真的非阻塞、是否可能干擾 `generate()` 時序 |
| `app.js:1185-1205` | `reusePrompt()` 是否正確保留「目前」作者建議，且 `loras: []` / 缺欄位行為未變 |
| `app.js:2541-2565` | `loraSetLocalGroups()` 是否可能蓋掉 Civitai 建議（目前只寫 local） |
| `app.js:2567-2665` | 三區 UI 的轉義（`esc()`）、索引驗證、 hover 不變尺寸、固定空間 |
| `app.js:2668-2730` | `loadLoraMeta` / `loadCivMeta` 是否永遠不碰 `triggers`；舊版本慢回應是否被丟棄 |
| `app.js:2731-2780` | 加入詞的去重／順序／`noTriggerNeeded` 轉換是否完整 |
| `app.js:2820-2880` | 所有 `data-lora-act` 分支是否都有索引驗證，且 `cv-unlink` 只清 civitai |
| `server.py:997-1075` | `trainedWords` 正規化是否会把壞字串拆成單字元；上限是否合理 |
| `server.py:1993-2010` | 路由錯誤映射、ID 驗證、是否完全不碰 API Key |
| `app.css:1229-1260` | 新區塊是否沿用設計變數、`max-height:64vh` 是否影響Modal版面 |

---

## 結語

Phase 2 已完成：作者建議與個人詞完全分離、Civitai 版本可由使用者明確連結並免 Key 取得、歷史不會讓最新 metadata 回退、生成前提醒非阻塞，Phase 1 功能與 53 項 E2E 全數回歸通過。等待 ChatGPT 獨立審查；**本輪未 commit、未 push、未操作正式服務**。
