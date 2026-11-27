# Amora Star Savior — 官方 Civitai 版本交叉核對（Model 2898222 / Version 3276795）

> 任務性質：**唯讀交叉核對**。本輪使用使用者本機 Chrome 的 OpenCode `browse` 擴充查看官方 `civitai.com` 頁面；未點擊 Download、未點擊站內「Continue on civitai.red」、未下載檔案、未呼叫 API、未讀取或使用 Cookie／API Key／登入憑證、未修改程式碼／模型／瀏覽器或擴充設定、未執行生圖或重啟服務、未做 Git 寫入。唯一新增檔案是本報告。
>
> 對照來源：`devtools/reports/amora-star-savior-version-3276795-audit.md`（上一輪 civitai.red 鏡像查核，報告未被修改）。

---

## 1. 官方頁面的實際瀏覽證據及最終 URL【已驗證】

| 項目 | 值 |
|---|---|
| 工具 | OpenCode `browse` MCP（`tools.browse.*`），**不是**桌面 App 內建 `browser` |
| 連線狀態 | `connected: true`、`pairingState: connected`；browser `chrome-this-computer`（Chrome on this computer，v0.1.5） |
| 分頁 | `tab 539268336`，群組 `amora-official`，`readOnly: true`，allowlist `civitai.com` / `*.civitai.com` |
| 要求的 URL | `https://civitai.com/models/2898222/amorastar-savior?modelVersionId=3276795` |
| **最終 URL** | **完全相同**（`navigate` 未回報任何 redirect） |
| 頁面標題 | `Amora（阿莫拉）——Star Savior（星之救援者） - Illustrious \| Illustrious LoRA \| Civitai` |
| Canonical | `https://civitai.com/models/2898222/amorastar-savior` |
| `__NEXT_DATA__.host` | `civitai.com`（官方域，非 civitai.red） |
| 登入狀態 | Chrome 已登入（可見頭像 `SL`、100 Buzz）。本輪未讀取或使用任何憑證 |
| 截圖 | `browse.screenshot` 實際截取 1685×769 JPEG，畫面為下列「搬遷提示」頁 |

### 官方頁面實際顯示的內容（重要限制）

官方域**沒有直接顯示模型Details／版本分頁／Download 區塊**，而是顯示一個站內搬遷提示：

```
This content has a new home
Mature content now lives on civitai.red
We split things up so everyone gets a better experience. The page you are looking for is waiting for you on our mature-content site.
Same account / Your Yellow Buzz carries over / Switch between sites any time
Continue on civitai.red
```

該連結的實際 href 為：

```
https://civitai.red/models/2898222/amorastar-savior?modelVersionId=3276795&sync-account=green
```

依任務要求「若出現限制，記錄實際狀況，不可嘗試繞過」，本輪**沒有點擊**這個連結，也沒有以其他方式切換到鏡像域。因此官方域上**無法以肉眼確認版本分頁選中狀態、Download 區塊、Trigger Words 可見文字**；這些只能從官方頁面自身的 SSR 內嵌資料讀取（見下）。

補充： oficial 頁面沒有出現登入提示或登入遮罩，限制形式是「內容已搬遷」而非「未登入」。

---

## 2. 版本 ID 的確認方式【已驗證】

三條獨立證據都指向 **3276795**，沒有拿預設版本代替：

1. **URL query**：`?modelVersionId=3276795`（最終 URL 保留此參數）。
2. **頁面內嵌 `__NEXT_DATA__.query`**：`{ id: "2898222", modelVersionId: "3276795", slug: ["amorastar-savior"] }`。
3. **模型的 `modelVersions` 陣列**：存在 `id: 3276795`、`name: "Illustrious"`、`baseModel: "Illustrious"` 的物件；本報告所有版本欄位都只從該物件讀出。

需要注意：官方頁面的 `og:image` 仍指向 `...&mv=3484585`（預設版本 Anima2.0），與上一輪鏡像頁相同；這是策略性替換，不能當作「目前版本是 3484585」的證據。

---

## 3. 所有欄位：官方值 vs 鏡像值

來源標記：【可見】＝官方頁面肉眼可見文字；【內嵌】＝官方頁面 SSR `__NEXT_DATA__/trpcState`；鏡像值取自上一輪報告。

| 欄位 | 官方值（來源） | 鏡像查核值 | 判定 |
|---|---|---|---|
| Model ID | `2898222`【內嵌】 | `2898222` | 一致 |
| Model Version ID | `3276795`【URL + 內嵌】 | `3276795` | 一致 |
| 版本名稱 | `Illustrious`【內嵌】 | `Illustrious` | 一致 |
| Base Model | `Illustrious`【內嵌】 | `Illustrious` | 一致 |
| Base Model Type | `Standard`【內嵌】 | `Standard` | 一致 |
| 檔名 | `Amora.safetensors`【內嵌】 | `Amora.safetensors` | 一致 |
| 格式 | `SafeTensor`【內嵌】；**BF16 未見於官方** | `BF16 SafeTensor`（鏡像可見）、`SafeTensor`【內嵌】 | 部分：`SafeTensor` 一致；`BF16` 官方未能確認 |
| 大小 | `sizeKB = 223103.80078125`【內嵌】（≈ 228,458,292 bytes ≈ 217.9 MiB）；**「217.87 MB」字串官方未顯示** | 可見 `217.87 MB`；內嵌同一數值 | 數值一致；可見字串官方未能確認 |
| SHA-256 | `C46B816CB90118E85CE4CE7F857B24E9E918DF3ED9B6AE3930A61B6424F708F5`【內嵌】 | 完全相同 | 一致 |
| SHA256_12 | `C46B816CB901`【內嵌】 | `C46B816CB901` | 一致 |
| AutoV1 / AutoV2 / AutoV3 | `62F20F18` / `C46B816CB9` / `7929BFBB0744`【內嵌】 | 完全相同 | 一致 |
| CRC32 / BLAKE3 | `6A43D08D` / `85BB46942A1B1C8226669D89636E7BB747C76DB77FD04B1EBADD0AD077FE7499`【內嵌】 | 完全相同 | 一致 |
| Trigger Words | 兩組字串【內嵌】，見第 4 節逐字比較 | 兩組字串 | **逐字一致** |
| 建議權重 | 官方可見文字中 `weight`/`strength` 0 命中；內嵌無欄位 | 未能確認 | 一致（雙方皆未能確認） |
| 作者 | `w0011153`【內嵌】；可見頁未顯示作者區塊 | `w0011153` | 一致（官方僅內嵌可證） |
| 模型發布 | `2026-08-29T07:41:58.177Z`【內嵌】；可見頁未顯示 | 同值 | 一致 |
| 模型更新 | `2026-11-22T17:10:40.938Z`【內嵌】 | 同值 | 一致 |
| 版本發布 | `2026-08-29T07:41:58.177Z`【內嵌】 | 同值 | 一致 |
| 版本更新 | `2026-11-22T16:56:00.791Z`【內嵌】 | 同值 | 一致 |
| 版本描述 | `null`（空）【內嵌】 | 空 | 一致 |
| 狀態／可見性 | `Published` / `Public`【內嵌】 | 相同 | 一致 |
| `requireAuth` | `true`【內嵌】 | `true` | 一致 |
| 授權 | 官方可見頁未顯示；內嵌 `licenses: []`、`mode: null` | 鏡像可見 `Illustrious License` / `REMIX` | **未能確認官方值**（不視為矛盾） |
| 可見相容性資訊 | 官方可見頁無任何相容性說明；內嵌 `baseModel: Illustrious`、`baseModelType: Standard` | 鏡可見 `Base Model Illustrious` | 資料一致；可見說明官方未能確認 |
| 其他版本 | `3484585 Anima2.0`、`3413349 Anima1.0`、`3276795 Illustrious`【內嵌】 | 相同三版 | 一致 |
| `og:image` | `...&mv=3484585...`【可見 meta】 | 相同 | 一致（皆為預設版本 meta） |
| 社群數字 | 官方 meta：`597 downloads, 91 likes` | 可見 `91 / 597` | 一致 |
| 下載 URL | 內嵌 `url: -1`（null） | 未能確認 | 雙方皆未能確認 |
| Tensors | 官方內嵌未提供（可見頁無 Details） | 鏡像可見 `2,958` | 官方未能確認 |

---

## 4. Trigger Words 逐字比較【已驗證，完全相同】

官方【內嵌】與鏡像是兩個字串；以下保留原始大小寫、逗號、重複空格與多餘逗號，**未做任何正規化、未重新分類**：

**第 1 組（官方）**
```
amora,  blonde hair, hair ornament, long hair, purple eyes, blue eyes, hair over one eye,single hair bun, mole under eye,,mature_female
```
**第 1 組（鏡像）**
```
amora,  blonde hair, hair ornament, long hair, purple eyes, blue eyes, hair over one eye,single hair bun, mole under eye,,mature_female
```
→ **逐字相同**（含 `amora,` 後兩個空格、`one eye,single`、`eye,,mature_female`）。

**第 2 組（官方）**
```
cleavage, black dress, flower, bare shoulders, detached sleeves, high heels, thigh strap,  jewelry, gloves, hair ornament, no panties, purple rose, black gloves, long sleeves, purple dress, choker,
```
**第 2 組（鏡像）**
```
cleavage, black dress, flower, bare shoulders, detached sleeves, high heels, thigh strap,  jewelry, gloves, hair ornament, no panties, purple rose, black gloves, long sleeves, purple dress, choker,
```
→ **逐字相同**（含 `thigh strap,  jewelry` 兩個空格、結尾逗號）。

**重要**：官方頁面**沒有**把第二組標示為 Negative Prompt；官方只是把它放在 `trainedWords` 陣列第二項。上一輪鏡像報告曾「推測」第二組應進 negative prompt，那是**建議而非官方標示**。本輪不延用該歸類宣稱，日後若要這樣用，必須標明是使用者端的处理決定，不是官方欄位語意。

---

## 5. 一致／不同／未能確認

### 一致（可由官方內嵌直接核對）
Model ID、Version ID、版本名稱、Base Model／Type、檔名、`SafeTensor` 格式、大小數值、`sizeKB`、完整 SHA-256 與所有其他雜湊、兩組 trainedWords 逐字、建議權重皆未能確認、作者、發布／更新時間、版本描述為空、`Published`/`Public`、`requireAuth`、其他兩版本資料、og:image 預設版本、downloads/likes 數字。

### 不同
**沒有發現任何欄位值不一致。** 唯一差異是「官方域目前以搬遷提示取代模型頁內容」，因此官方**可見**的欄位比鏡像少；這是頁面可見性差，不是資料值衝突。

### 未能確認（官方域）
BF16 字樣、可見 `217.87 MB` 字串、授權（`licenses: []`）、Tensors 數、Download 按鈕與下載 URL、官方可見的版本分頁選中狀態、官方可見的 Trigger Words 文字（只能讀內嵌）。以上都不能宣稱官方「已確認」或「已否定」。

---

## 6. 是否具備進入下載階段的條件

**尚不具備。** 理由：

1. 雖然版本關鍵.metadata 與鏡像完全一致，但官方 `civitai.com` 頁面目前**不顯示模型內容**，只提供跳往 `civitai.red` 的站內入口；本輪依指示未點擊、未繞過。
2. 版本 `requireAuth: true`，且內嵌檔案 `url` 為 `-1`（null），沒有可直接使用的下載 URL；本輪未點擊 Download、未呼叫 API。
3. 本任務**不包含下載授權**；即使資料完全一致，仍須等 ChatGPT 獨立審查與明確授權後才能決定下一步。
4. 目前沒有任何本機檔案與此 SHA-256 對應；先前 A/B 使用的 LoRA 是另一個檔案（`2E93721E…`），不可混用。

若之後獲授權，建議下載前至少再做：官方域／鏡像域同版本交叉核對（本輪已完成）、檔名與 SHA-256 三重確認、確認 ComfyUI 實際 LoRA 目錄與同名檔檢查、下載後比對 SHA-256。以上只是清單，不代表已授權或已實作。

---

## 7. Git 起始與結束狀態

本輪開始前的狀態沿用上一輪結束時已驗證的快照（本輪一開始未重跑 `git status`，此點如實說明）：

- tracked modified：13（`AGENTS.md`、`app.css`、`app.js`、5 個 devtools 檔案、`index.html`、`server.py`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`），staged 0，untracked 43；合計 56 項。
- `git diff --stat`：`13 files changed, 1702 insertions(+), 104 deletions(-)`。

結束時（建立本報告後）：

```
## main...origin/main [ahead 1]
（13 項 tracked modified 完全不變，git diff --stat 與開始時相同）
?? devtools/reports/amora-star-savior-official-crosscheck.md   ← 本報告（唯一新增）
```

- 沒有 stage／commit／push／stash／checkout／clean／restore 或任何 Git 寫入。
- 沒有修改上一輪的 `amora-star-savior-version-3276795-audit.md`，也沒有動其他既有報告。

---

## 8. 未執行事項及原因

| 未執行 | 原因 |
|---|---|
| 點擊「Continue on civitai.red」 | 任務要求記錄限制、不可繞過；且本輪僅授權官方域唯讀瀏覽 |
| 點擊 Download／取得下載 URL | 明確禁止，且本任務不含下載授權 |
| 呼叫 Civitai API | 明確禁止 |
| 讀取或使用 Cookie／API Key／登入憑證 | 明確禁止；僅利用 Chrome 已登入狀態下呈現的公開頁面 |
| 下載模型、比對實際檔案 SHA-256 | 禁止下載，且尚無授權 |
| 修改瀏覽器／擴充設定 | 禁止 |
| 生圖／GPU／重啟服務 | 禁止 |
| Git 寫入 | 禁止 |
| `codegraph sync` | 未修改程式碼，且 pending changes 不影響本輪唯讀查核 |

`browse status` 於結束時仍 `connected: true`；本輪分頁 `539268336` 已關閉，只留下使用者原本借出的 ChatGPT 分頁（未操作）。

---

## 9. 一句話結論

官方 `civitai.com` 頁面（URL 未跳轉，`host=civitai.com`）目前以「內容已搬遷至 civitai.red」提示取代模型頁，肉眼看不到模型細節；但其 SSR 內嵌資料明確指向版本 **3276795 / Illustrious**，且所有可核對欄位（含兩組 trainedWords 逐字、完整 SHA-256）與上一輪鏡像查核**完全一致**，沒有發現值衝突。**仍不具備下載條件**：需等 ChatGPT 審查與明確授權，且本站未提供可直接使用的下載 URL。

---

## 10. 追補：依使用者授權跟隨官方搬遷連結（2026-11-26）

> 本節是**事後追加**，保留第 1～9 節原文不改。使用者隨後明確表示「同意前往搬遷連結」，因此本輪補做「官方域 → civitai.red」的實際跟隨。第 8 節「點擊 Continue on civitai.red 未執行」僅描述最初那一輪，已由本節取代。

### 10.1 實際操作與目的地【已驗證】

- 第一次嘗試時分頁以 `readOnly: true` 開啟，`browse click` 被工具拒絕（「this tab is read-only」），**沒有產生任何頁面動作**；隨後關閉該分頁，重新以可互動分頁（`tab 539268348`）開啟同一官方 URL，allowlist 同時含 `civitai.com` 與 `civitai.red`。
- 點擊官方頁面上的 `link "Continue on civitai.red" [ref=e25]` 後，`browse.click` 回傳：
  - `clicked: link "Continue on civitai.red" (e25)`
  - `from: https://civitai.com/models/2898222/amorastar-savior?modelVersionId=3276795`
  - `url: https://civitai.red/models/2898222/amorastar-savior?modelVersionId=3276795`
  - `navigated: true`、`redirects: 1`、`status: 200`
- **最終 URL**：`https://civitai.red/models/2898222/amorastar-savior?modelVersionId=3276795`。官方 href 原本帶 `&sync-account=green`，但经过一次重新導向後最終 URL 已不含該參數；本輪沒有手動改網址。
- 沒有点击 Download、沒有下载、沒有呼叫 API、沒有讀取或使用任何 Cookie／API Key／憑證。頁面右上角仍顯示同一已登入帳號（`SL`、100 Buzz），本輪未存取其內容。

### 10.2 目的地頁面可見證據【已驗證】

目的地是完整模型頁（不再是搬遷提示），`browse.screenshot` 實際截取 1123×770 JPEG。可見內容：

| 項目 | 目的地可見值 |
|---|---|
| 版本分頁 | `Anima2.0`、`Anima1.0`、`Illustrious`，其中 **Illustrious 為藍色選中** |
| 檔案區塊 | `1 variant available`、`bf16 SafeTensor`、`Amora.safetensors`、`BF16, good balance • 217.87 MB`、`Verified: 3 months ago`、`Download (217.87 MB)`（**未點擊**） |
| Details | `Type: LORA`、`Published Aug 29, 2026`、`Base Model: Illustrious`、`Hash: CRC32 6A43D08D`、`Tensors 2,958`、`civitai: 2898222 @ 3276795 + 3160868` |
| Trigger Words | 可見兩行（UI 全大寫）：`AMORA, BLONDE HAIR, HAIR ORNAMENT, LONG HAIR, PURPLE EYES, BLUE EYES, HAIR OVER ONE EYE,SINGLE HAIR BUN, MOLE UNDER EYE,,MATURE_FEMALE` / `CLEAVAGE, BLACK DRESS, FLOWER, BARE SHOULDERS, DETACHED SLEEVES, HIGH HEELS, THIGH STRAP, JEWELRY, GLOVES, HAIR ORNAMENT, NO PANTIES, PURPLE ROSE, BLACK GLOVES, LONG SLEEVES, PURPLE DRESS, CHOKER,` |
| 作者／授權 | `w0011153`（Joined Jan 30, 2023）、`License: Illustrious License`、`REMIX` |

**Hash 顯示差異（已觀察，非資料衝突）**：上一輪鏡像查核時可見 `Hash: AUTOV2 C46B816CB9`，本次顯示 `Hash: CRC32 6A43D08D`。兩者都存在於同一版本的 hashes 集合；此差異是可見 UI 的輪替顯示，不是模型資料改變。完整 SHA-256 仍為 `C46B816CB90118E85CE4CE7F857B24E9E918DF3ED9B6AE3930A61B6424F708F5`（見下）。

### 10.3 目的地內嵌資料覆核【已驗證】

`__NEXT_DATA__`：`host = civitai.red`、`query = { id: "2898222", modelVersionId: "3276795", slug: ["amorastar-savior"] }`。版本 `3276795` 物件：

- `name: Illustrious`、`baseModel: Illustrious`、`description: null`、`requireAuth: true`
- `Amora.safetensors`、`sizeKB = 223103.80078125`
- SHA-256 `C46B816CB90118E85CE4CE7F857B24E9E918DF3ED9B6AE3930A61B6424F708F5`
- `trainedWords` 兩組，與第 4 節官方值及上一輪鏡像值**逐字相同**（包含重複空格與結尾逗號）
- 三個版本仍為 `3484585 Anima2.0`、`3413349 Anima1.0`、`3276795 Illustrious`

### 10.4 小結

官方搬遷連結如實導向 civitai.red 的同一模型／同一版本頁面，版本 3276795 的所有可核對欄位在官方域與搬遷後目的地**一致**，沒有新衝突。第二組 trainedWords 在兩邊都只是 `trainedWords` 陣列第二項，**官方沒有標示為 Negative Prompt**。

**仍然沒有進入下載階段的授權**：本任務只同意跟隨搬遷連結，未授權下載；Download 按鈕全程未點擊，也沒有取得下载 URL／呼叫 API。仍需等 ChatGPT 獨立審查與明確授權。

### 10.5 本節之後的狀態

- `browse` 分頁 `539268348` 已關閉；只留下使用者原本借出的 ChatGPT 分頁（未操作），`browse status` 仍 `connected: true`。
- Git：沒有 stage／commit／push 或任何寫入；只修改本報告（追加本節），`git diff --stat` 與本任務開始時相同（`13 files changed, 1702 insertions(+), 104 deletions(-)`）。除本報告外沒有動到其他既有報告或程式碼。
