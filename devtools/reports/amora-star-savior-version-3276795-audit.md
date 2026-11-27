# Amora Star Savior 指定版本 3276795 — 唯讀頁面查核報告（修正版）

> 任務性質：**唯讀瀏覽查核**。本輪使用 OpenCode `browse` 擴充中繼（Chrome relay）實際連線到**使用者目前這台電腦的 Chrome**（`browser: chrome-this-computer`），查看公開模型頁面。未登入／登出任何帳號、未讀取或使用 Cookie／API Key／任何登入憑證、未呼叫 Civitai API、未下載模型、未點擊 Download、未修改專案程式碼或瀏覽器／擴充設定、未執行 Git 寫入。唯一新增／修改的檔案是本報告。

## 0. 修正紀錄（重要）

本報告前一版是**錯誤的**：當時誤用 OpenCode 桌面 App 內建的 `browser` 工具（不是使用者電腦上的 `browse` Chrome 擴充），該內建瀏覽器沒有使用者的登入狀態，因此只看到「Log in to view」遮罩，並错误推斷「模型內容不可見、欄位只能從 SSR 內嵌資料取得」。

本輪改用正確的 `browse` 擴充並確認中繼狀態為 `connected: true`、browser `chrome-this-computer`（Chrome on this computer，已配對、協定 v3）。在該 Chrome 中，**頁面完整可見**（右上角有已登入帳號頭像與 Buzz 數），版本 `Illustrious` 分頁被選中，Download 區塊可見。前版所有「被登入遮罩擋住／未能確認下載按鈕」的結論已作廢，以本版為準。

---

## 1. 任務目標與範圍

查核 `https://civitai.red/models/2898222/amorastar-savior?modelVersionId=3276795`：模型與版本 ID、作者與發布資訊、Base Model、Trigger Words／trainedWords、建議 LoRA 權重、檔案資訊、SHA-256、其他版本與相容性說明；並確認資料確實屬於版本 **3276795**，不是其他版本或同名轉載。

---

## 2. 實際連線與瀏覽來源【已驗證】

| 項目 | 觀察結果 |
|---|---|
| 工具 | OpenCode `browse` MCP（`tools.browse.*`），**不是**內建 `browser` |
| 中繼狀態 | `connected: true`、`pairingState: connected`；relay v0.1.5，`endpoint http://127.0.0.1:19988` |
| 瀏覽器 | `id: chrome-this-computer`，名稱 `Chrome on this computer`，`connected: true`（另有使用者主動借出的一個 ChatGPT 分頁，未被操作） |
| 本輪分頁 | `tab 539268331`，群組 `amora-audit`，`readOnly: true`，allowlist 僅 `civitai.red` |
| 頁面 URL | `https://civitai.red/models/2898222/amorastar-savior?modelVersionId=3276795` |
| 最終 URL | 完全相同，**沒有觀察到跳轉** |
| 頁面標題 | `Amora（阿莫拉）——Star Savior（星之救援者） - Illustrious \| Illustrious LoRA \| Civitai` |
| 實際 host | `civitai.red`（非官方 `civitai.com`）。頁面內嵌 `host = "civitai.red"`；`og:image` 字串指向 `https://civitai.com/api/og?...mv=3484585...`，但本輪**沒有請求該 URL**，它只是頁面既有的 meta 字串 |
| 登入狀態 | 該 Chrome 已處於登入狀態（頁面右上角顯示帳號頭像 `SL` 與 100 Buzz）。**本輪沒有讀取、使用或傳送任何憑證／Cookie／API Key**；只是讀取使用者瀏覽器已顯示的公開頁面 |
| 截圖 | 由 `browse.screenshot` 從該分頁實際截取（1685×769 JPEG），可見版本分頁、Download 區塊、Trigger Words 等 |

**版本歸屬證據（三獨立來源一致）**【已驗證】：

1. 可見頁面文字含 `civitai: 2898222 @ 3276795`，且版本分頁「Illustrious」是藍色選中狀態（`filledBlue`），另外兩個版本按鈕為灰色（`filledGray`）。
2. `__NEXT_DATA__.query = { id: "2898222", modelVersionId: "3276795", slug: ["amorastar-savior"] }`。
3. 下方所有版本欄位都從 `model.modelVersions` 中 **id === 3276795** 的物件讀出；沒有拿其他版本替代。

---

## 3. 查核結果 — 版本 3276795

### 3.1 模型（model 層級）

| 欄位 | 值 |
|---|---|
| 模型 ID | `2898222` |
| 模型名稱 | `Amora（阿莫拉）——Star Savior（星之救援者）` |
| 類型 | `LORA`（頁面 Details 區塊可見 `Type: LORA`） |
| 作者 | `w0011153`（頁面顯示加入日期 `Joined Jan 30, 2023`） |
| 狀態／可見性 | `Published` / `Public`；`locked = false` |
| 發布日期 | 頁面顯示 `Published: Aug 29, 2026`；內嵌 `2026-08-29T07:41:58.177Z` |
| 更新日期 | 頁面顯示 `Updated: Nov 23, 2026`；內嵌 model `updatedAt = 2026-11-22T17:10:40.938Z` |
| 授權 | `Illustrious License`，標記 `REMIX`（頁面可見） |
| 社群數字（頁面可見，僅供參考） | 91 likes、597 downloads、2.2K、128、1.6K；Reviews「Very Positive (78)」 |

### 3.2 指定版本（id = 3276795）

| 欄位 | 值 |
|---|---|
| 版本 ID / 名稱 | `3276795` / `Illustrious`（分頁藍色選中） |
| Base Model | `Illustrious`（頁面 Details 直接顯示 `Base Model: Illustrious`） |
| Base Model Type | `Standard`（內嵌資料） |
| 建立時間 | `2026-08-29T07:32:06.123Z` |
| 發布時間 | 頁面 `Aug 29, 2026`；內嵌 `2026-08-29T07:41:58.177Z` |
| 更新時間 | 內嵌 `2026-11-22T16:56:00.791Z` |
| 狀態／可見性 | `Published` / `Public` |
| `requireAuth` | `true`（內嵌資料；目前 Chrome 已登入，故 Download 區塊可見） |
| 版本描述 | 空（內嵌 `description: null`） |
| steps / epochs / clipSkip | 未提供（null） |
| Tensors | 頁面可見 `Tensors 2,958` |
| 檔案數 | 1 variant available |

### 3.3 Trigger Words / trainedWords【已驗證，逐字】

頁面「Trigger Words」區塊可直接看到兩行；內嵌 `trainedWords` 陣列逐字如下（保留原空格）：

1. `amora,  blonde hair, hair ornament, long hair, purple eyes, blue eyes, hair over one eye,single hair bun, mole under eye,,mature_female`
2. `cleavage, black dress, flower, bare shoulders, detached sleeves, high heels, thigh strap,  jewelry, gloves, hair ornament, no panties, purple rose, black gloves, long sleeves, purple dress, choker,`

觀察：第一行是角色／外貌 positive 詞，第二行是服裝／negative 描述，實務上應分開進 positive／negative prompt。原始字串有重複空格與 `eye,,mature_female` 等瑕疵，使用前建議正規化。

### 3.4 建議 LoRA 權重【未能確認】

- 在目前 Chrome 可見的完整頁面文字中搜尋 `weight` / `strength` / `權重` / `建議`，**0 命中**；內嵌資料也沒有任何建議權重欄位或數值。
- 因此**不能宣稱作者建議 0.8 或任何數值**。日後套用時 0.8 只是本專案前端預設（`app.js:392`），不是作者建議。

### 3.5 檔案資訊與雜湊【已驗證]

頁面 Download 區塊（未點擊）：`1 variant available`、`bf16 SafeTensor`、`Amora.safetensors`、`BF16, good balance • 217.87 MB`、`Verified: 3 months ago`、`Download (217.87 MB)`。

| 欄位 | 值 | 來源 |
|---|---|---|
| 檔名 | `Amora.safetensors` | 頁面可見 + 內嵌 |
| 格式 | `SafeTensor`（bf16） | 頁面可見 + `metadata.format` |
| 大小 | 頁面 `217.87 MB`；內嵌 `sizeKB = 223103.80078125`（≈ 228,458,292 bytes ≈ 217.9 MiB） | 兩者一致 |
| 頁面顯示 Hash | `AUTOV2 C46B816CB9`（Details 區塊 `Hash` 欄） | 可見頁面 |
| SHA-256 | `C46B816CB90118E85CE4CE7F857B24E9E918DF3ED9B6AE3930A61B6424F708F5` | 頁面 SSR 內嵌 `files[].hashes`；**可見 UI 只顯示 AUTOV2 短碼，完整 SHA-256 不是肉眼可見文字** |
| SHA256_12 | `C46B816CB901` | 內嵌 |
| AutoV1 | `62F20F18` | 內嵌 |
| AutoV3 | `7929BFBB0744` | 內嵌 |
| CRC32 | `6A43D08D` | 內嵌 |
| BLAKE3 | `85BB46942A1B1C8226669D89636E7BB747C76DB77FD04B1EBADD0AD077FE7499` | 內嵌 |
| 下載 URL | 【未能確認】內嵌 file `url` 為 null／`-1`；本輪未點擊 Download、未呼叫 API | — |

完整 SHA-256 是頁面提供的 metadata；**本輪沒有下載檔案，未驗證實際位元組是否與它相符**。

---

## 4. 其他版本與相容性【已驗證】

頁面版本分頁可見三個：`Anima2.0`、`Anima1.0`、`Illustrious`（目前選中）。內嵌資料：

| 版本 ID | 版本名 | Base Model | 檔案 | sizeKB | SHA-256 |
|---|---|---|---|---|---|
| **3276795** | **Illustrious** | **Illustrious** | **Amora.safetensors** | **223103.80078125** | **C46B816C…708F5** |
| 3484585 | Anima2.0 | Anima | Amora-anima2.0.safetensors | 67304.2578125 | 126A4FBE39835BE5470B9BA0233C742DD250E80E4BF32CBCA34759B6EE3346A3 |
| 3413349 | Anima1.0 | Anima | Amora_anima.safetensors | 203062.359375 | 8A33C41A871C9C066CC4CEB7B68DFB5B83E94B6519C1482F48D4E5C3A0AB10E4 |

- 指定版本 `3276795` 為 **Illustrious** 基底，與目前 Checkpoint `WAI-Nsfw-Illustrious-17.safetensors`（Illustrious 系）相符。
- 另兩版是 **Anima** 基底，檔名相似但版本、大小、雜湊都不同；**不可互相代替**。
- 頁面 `og:image` 的 `mv=3484585` 只是該模型頁的預設版本 meta 字串，不代表目前選中的版本；本輪判定版本以分頁選中狀態與 `?modelVersionId=3276795` 為準。

---

## 5. 與本機現有 LoRA 的關係【已驗證】

先前 A/B 測試用的 `Star Savior - Serpang (Morpholi).safetensors`（SHA-256 `2E93721E…A8049A`，metadata title `Stable Diffusion XL 1.0 Base LoRA`）**不是**本次的 `Amora.safetensors`（`C46B816C…708F5`）。角色相關不代表同一模型或同一版本；日後下載與使用必須以版本 ID 3276795 與上述 SHA-256 為準。

---

## 6. 仍未能確認的資訊

| 項目 | 原因 |
|---|---|
| 作者建議 LoRA 權重 | 頁面與內嵌資料都沒有 |
| 檔案下載 URL | 內嵌值為 null；未點擊 Download、未呼叫 API |
| 實際檔案位元組是否等於 SHA-256 | 禁止下載 |
| 官方 `civitai.com` 上同版本資料是否完全一致 | 本輪只查 `civitai.red` 鏡像；需獨立於官方域交叉核對 |
| 版本專屬描述／訓練參數 | 描述為空，steps/epochs/clipSkip 未提供 |
| 完整 SHA-256 是否在使用者可見 UI 中直接顯示 | 可見 UI 只顯示 AUTOV2 `C46B816CB9`；完整值來自頁面內嵌資料，非肉眼文字 |

---

## 7. 下載前注意事項（建議，非本輪執行）

1. 明確指定 `modelVersionId=3276795`，以「Illustrious / `Amora.safetensors` / SHA-256 `C46B816C…708F5`」三重核對，避免誤抓 Anima2.0／Anima1.0。
2. 來源為 `civitai.red`（非官方域）；若日後允許下載，建議先在官方 `civitai.com` 交叉核對同一 ID 與 SHA-256。
3. 版本 `requireAuth: true`；目前 Chrome 已登入且 Download 按鈕可見，但本輪**未點擊**。
4. 本機 `models/loras` 已有另一個 Star Savior 相關 LoRA；新檔要確認 ComfyUI 實際 LoRA 目錄與同名檔檢查。
5. 兩組 trainedWords 分開使用：第一組進 positive，第二組進 negative；先正規化空格。
6. 權重沒有作者建議；初版可用本專案預設 0.8 起測並做同 seed A/B，不要宣稱是作者建議。
7. 下載後用 SHA-256 比對 `C46B816CB90118E85CE4CE7F857B24E9E918DF3ED9B6AE3930A61B6424F708F5`，不符就不要載入。
8. 本專案目前沒有下載功能；以上只是檢查清單，不代表已實作或授權下載。

---

## 8. Git 最終狀態與影響

```
## main...origin/main [ahead 1]
（12 項 tracked modified 與開始時完全相同，git diff --stat 未變）
?? devtools/reports/amora-star-savior-version-3276795-audit.md   ← 本報告（唯一檔案）
```

- 沒有 commit／push／stage／任何 Git 寫入；本輪只覆寫自己先前建立的同一份報告，未動其他既有報告。
- `browse` 分頁 `539268331` 已關閉；未修改瀏覽器／擴充設定。正式 ComfyUI、Simple UI、模型檔案與使用者資料未受影響。

---

## 9. 一句話結論

透過使用者電腦上的 `browse` Chrome 擴充實際查看，指定版本 **3276795 = Illustrious / Base Model Illustrious / `Amora.safetensors` / bf16 / 217.87 MB / SHA-256 `C46B816C…708F5` / 兩組 trainedWords**，頁面完整可見且已選中該版本；**建議權重與下載 URL 未能確認**；前版「登入遮罩」結論為工具用錯所致，已修正。
