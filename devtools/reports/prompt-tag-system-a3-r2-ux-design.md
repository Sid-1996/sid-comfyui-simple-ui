# Sid-simple-ui Prompt／Tag／LoRA 整合 UX 設計修正（A3-R2）

- **日期**：2026-11-27（本機 +08:00）
- **專案**：`C:\ComfyUI\simple_ui`（`Sid-1996/sid-comfyui-simple-ui`）
- **補正版本**：**A3-R2-R4**（在同一檔案內補正，保留 §1.1／§1.2／§1.3 與歷史脈絡；**最新權威為 §1.4**，本輪 R1～R4 修改前後差異見 §1.4.2）
- **性質**：**唯讀設計修正／補正**。未修改任何既有程式碼、測試、HTML、CSS、JavaScript、Python、PowerShell、設定、AGENTS、README、模型、LoRA、Workflow、使用者圖片或 localStorage；未執行 Git 寫入；未啟停正式服務；未生圖；未執行 `codegraph sync`／`index`。
- **交付**：只更新本報告 `devtools/reports/prompt-tag-system-a3-r2-ux-design.md`（未新增第二份報告）。
- **依據**：ChatGPT 對 A3-R1（A3-R2）、A3-R2（A3-R2-R1）、A3-R2-R1（A3-R2-R2）、A3-R2-R2（A3-R2-R3）的獨立審查，以及其對 A3-R2-R3 的獨立審查（A3-R2-R4，本輪）。本輪**只做設計補正**，不開始 A3 Phase 1 實作。
- **證據標籤**：
  - 【已驗證】：由目前磁碟原始碼或既有實測報告證實。
  - 【設計】：本報告提出的新 UX 方案（尚未實作）。
  - 【PD】：需產品負責人決策，本報告先給暫定值。

---

## 1. 任務目標及範圍

依 A3-R1 審查意見，把六項決策落成可實作的 UX 規格：完整還原的確認與 LoRA 語意（D1）、只帶文字的精確範圍（D2）、品質詞單一開關但保留進階能力（D3）、分類套用正式固定 Model B（D4）、Trigger Words 在未實作 `adoptionRecords` 前的誠實狀態（D5）、Civitai 探索與本機 LoRA 的界線（D6）。

設計限制維持不變：原生 HTML／CSS／JavaScript、無框架／build step、一屏操作、單一主動作（生成）、不讓一般使用者理解底層資料模型、不把所有功能塞進單一大型彈窗、不破壞既有生圖／歷史／LoRA／WD14 功能、不改變 A2 已定案資料契約。

---

## 1.1 A3-R2-R1 補正版本紀錄（R1～R4）

本節為本輪新增，記錄 ChatGPT 對 A3-R2 審查後的定點補正。**原有 §2～§18 的設計決策與歷史脈絡保留**；與本節衝突處，以本節及後續標註「R1 補正」的章節為準。

### 1.1.1 新增查核事實（F17～F22）

| # | 主題 | 位置 | 查核結果 |
|---|---|---|---|
| F17 | 三處組裝入口 | `tags.js:1001`、`app.js:313,322,872,1783` | `Tags.buildPrompt()` 組 sel＋`#pos` 翻譯且**不含品質**（註明品質由 `app.js` 加）；`composePrompt()` **只被提示詞預覽** `showPromptModal()` 呼叫；`snapshotNow()` **只被生成** `generate()` 呼叫。兩套字串組裝，沒有共用出口。 |
| F18 | A2 Composer 契約 | A2-R3 §647-682、A2-R4 §756-768 | 唯一 `PromptComposer.compose()`；去重鍵 `normalizeText(text)=NFKC→lowercase→trim→[_\s]+→空白`，保留第一次出現，quality 前綴也參與去重；**每次生成只呼叫一次 `compose()`**，同一結果供 `/prompt` payload、`ui.gallery[].prompt`、`promptSnapshot.text`；**明確禁止 `snapshotNow()` 自己再拼一次**。 |
| F19 | 品質詞入口 | `tags.js:369-415,425-430` | `groupItems()` 把「常用」前五筆（`masterpiece`／`best quality`／`amazing quality`／`very aesthetic`／`absurdres`）放進 `fav` 群組（`:378-381,401-402`）；`TagCategories.of(e)==="style"` 放進 `quality` 群組（`:403`）；**搜尋命中走 `state.q` 分支（`:398-400`）直接進 `search` 群組，繞過分類與品質分組**；`renderTags()` 搜尋比對只做事字串比對（`:425-430`）。 |
| F20 | 本機 LoRA 欄位 | `server.py:1925`、`server.py:654-662` | `/api/loras` 只回 `{name, display, sub}`；`/api/lora-meta` 回 `title/architecture/description/networkDim/networkAlpha/resolution/triggerWords`。**兩者都沒有 SHA256，也沒有 Civitai model/version ID。** |
| F21 | Civitai 版本檔案欄位 | `server.py:946-959`、`app.js:2128,2474-2484` | 搜尋結果每個 version 的 `files[]` 含 `name`、`sizeKB`、`format`、`primary`、**`sha256`**（大寫、截 64 字）、`downloadUrl`；前端 `CV.items` 保留這些欄位，但 `cvPaintPreview()` 只顯示 trainedWords，**目前不顯示雜湊**。 |
| F22 | disabled 角色可開觸發詞 | `app.js:611,642,654-668,2874-2877` | `loraSet()` 新建一筆時預設 `enabled:false`；`loraOnPickClick` 的 `triggers` 分支只設 `LORA.active`，**不會 enable**；`loraSnapshot()` 只取 `loraEnabled()`，`loraTokensFromSnapshot()` 只處理 snapshot 內的詞。→ **disabled 設定不會進入生成 Prompt／Workflow。** |

### 1.1.2 R1～R4 修改前後差異

| 項 | A3-R2 原文（修改前） | A3-R2-R1（修改後） | 原因 |
|---|---|---|---|
| **R1a** | §10 寫「唯一去重點在 `composePrompt()`／`snapshotNow()` 之前統一處理」——等於兩處仍各自組裝 | §10 改為**唯一組裝入口**：Phase 1 用共用純計算 `composeOnce()`；A2 Composer 落地後由 `PromptComposer.compose()` 取代。預覽／生成／歷史／payload 全部 consume 同一次結果；`composePrompt()`／`snapshotNow()` 降為薄殼或淘汰 | ChatGPT：違反 A2「唯一 PromptComposer」；F17／F18 |
| **R1b** | §10 只說「品質標籤從一般分類移除」 | 明確列出並隱藏**四個入口**：常用前五（`fav`）、`quality` 群組、一般分類、搜尋結果；以單一 `isQualityWord()` 判定；舊 `sel` 品質標籤不刪、不失效 | F19；任務要求 |
| **R1c** | 去重規則未定義計算式 | 採 A2 `normalizeText` 做**唯一**規則（NFKC→lowercase→trim→`[_\s]+`→空白），保留首次，quality 前綴參與；不在前端另寫第二套 | F18 |
| **R2a** | §9「以本機 LoRA 清單比對，比對不到就走未安裝」 | 改為**三層對應**：① Civitai `files[].sha256` 優先（需本端雜湊，目前不存在）→ ② 檔名＋大小保守比對 → ③ 疑似命中標「可能相符」並請使用者確認。不得宣稱「已確認本機存在相同版本」 | F20／F21；任務要求 |
| **R2b** | §9「已安裝分支先把 LoRA 加入我的角色（enabled）」 | **移除自動 enabled**。改為：本機找得到 → 可建立／沿用一筆 `enabled:false` 的設定並打開觸發詞面板；該設定**不進生成 Prompt／Workflow**。是否自動啟用列為 PD7 | F22；A3-R1 原核准範圍 |
| **R2c** | 未定義後端欄位需求 | 列出 SHA256 對應所需的 `/api/loras`／metadata 欄位與修改範圍（僅設計，不實作） | F20 |
| **R3** | §7-A 只寫「有值才覆蓋、無值保留目前」【PD1】 | 明確三種 `neg` 情境（非空／空字串／欄位不存在）＋介面文案＋**標為產品決策建議，非已完成授權** | 任務要求 |
| **R4** | §7-C 只定義確認視窗「內容」，未定義「時序」 | 新增「先讀→純資料摘要→確認→單次提交」時序；取消不得執行 `Tags.restore()`、改 `#pos`／`#neg`、改 `S.loras` 或寫 localStorage；補測試條件 | 任務要求 |

### 1.1.3 修正後 D1～D6 決策對照（本輪權威版本）

| 決策 | 修正後規格 | 與 A3-R2 的差異 | 依據 |
|---|---|---|---|
| **D1 完整還原** | 先建立**純資料摘要**，確認後才單次提交；逐筆列名稱＋權重；三種 `loras` 語意；取消完全不變 | 補「確認時序」與取消測試（R4） | F5／F6／§7-C |
| **D2 只帶文字** | 標籤＋描述＋Negative；不碰 LoRA／尺寸／張數／步數／CFG／種子。Negative 三情境明確定義，且為**產品決策建議** | 補 Negative 空值語意與文案（R3） | F5／§7-A |
| **D3 品質詞** | **唯一組裝入口**＋唯一去重規則；單一開關；一般模式隱藏四類品質入口；進階可查看／調整；不新增 key | 改組裝架構（R1a/c）、補隱藏範圍（R1b） | F17-F19／§10 |
| **D4 分類套用** | Model B（歷史基底／目前替換）；未勾保留歷史；候選預覽＋人工確認＋通用外觀不預勾；不得改回 Model A | **不變** | F8-F10 |
| **D5 Trigger Words** | 不顯示精確「已採用」；保留「我的詞中也有這個詞」即時比對提示並**明說不記錄來源**；建議唯讀、個人可編輯 | 文案強化「不記錄來源」 | F11／F12／§8 |
| **D6 Civitai↔本機** | 三層對應（SHA256→檔名大小→「可能相符」）；**不自動 enabled**；disabled 設定可開觸發詞但不進 Prompt；未找到只給取得與放置說明 | 改對應演算法（R2a）、移除自動啟用（R2b）、補後端欄位（R2c） | F20-F22／§9 |

---

## 1.2 A3-R2-R2 補正版本紀錄（品質分類／入口過濾／SHA256／Composer）

本節記錄 ChatGPT 對 A3-R2-R1 的獨立審查後的第二輪定點補正。**原有 §1.1、§2～§18 全部保留**；與本節衝突處，以本節及後續標註「R2 補正」的章節為準。

### 1.2.1 新增查核事實（F23～F27）

| # | 主題 | 位置 | 查核結果 |
|---|---|---|---|
| F23 | `style` 不是品質詞 | `tag_categories.js:8-19,81,137,342,438,617,973,1742,1860,10990-11002` | `CATEGORIES.style` 的標籤是**「畫風品質」**，MAP 中有 **141** 筆 `"style"`：同時包含一般畫風（`anime coloring`:438、`art nouveau`:617、`cel shading`:1742、`chibi`:1860、`cyberpunk`、`fantasy`、`vibrant colors`）與品質詞（`8k`:81、`absurdres`:137、`amazing quality`:342、`best quality`:973）。`TagCategories.of()` 只回 9 種分類之一，**沒有 quality kind**；公開 API 只有 `categories/of/has`（:10998-11002）。→ 不可把 `of(e)==="style"` 視為品質詞。 |
| F24 | 常用標籤內容 | `tags.js:10,19,378-381` | 「常用」前五＝`masterpiece`／`best quality`／`amazing quality`／`very aesthetic`／`absurdres`（`groupItems()` 的 `core` 由此 derivation）；其餘同分類還含 `ultra-detailed`、`8k`、`clean sharp lines`、`sharp digital rendering`、`delicate rendering`、`high resolution digital illustration`，以及非品質詞 `solo`、`looking at viewer`、`simple background`、`white background`、`detailed`。一般畫風在獨立的「風格」分類（`tags.js:19`，如 `anime coloring`、`watercolor_(medium)`、`cel shading`），**不該被品質開關隱藏**。 |
| F25 | 標籤顯示資料流 | `tags.js:322-332,369-415,418-447,458,537-548,1021` | `renderTags()` 在 `L.filter()`（:425-442）依序處理 18+、搜尋（`state.q`，:429 直接 return）、成人、`__fav__`（:436-439）、`__top__`（:440）、一般分類（:441）；`__top__` 再排序取前 20（:444-445），個人入口改寫 `c`（:447）；最後才交 `groupItems()`（:458）。`groupItems()` 另有 personal／adult／search／常用 core／quality(`style`)／fav／cat:* 分支（:385-412）。`renderCats()` 的收藏／使用計數（:322-332）另算，可能經由數字洩漏。已選 chips `renderSel()`（:537-548）直接讀 `state.sel`；`snapshot()`（:1021）深拷貝；`buildPools()`（:651）原本就排除常用。 |
| F26 | 版本檔案可能多筆 | `server.py:943-959`、`app.js:2128` | 一個 Civitai 版本最多取 30 個版本，每版本最多 8 個 `files[]`，各有 `primary` 旗標與選擇性 `sha256`；前端保留整包。→ 不可假設「一個版本只有一個primary檔案」或「primary 一定有 hash」。 |
| F27 | 原演算法缺陷 | A3-R2-R1 §9.1（本報告 :323-337） | 原寫「SHA256 不符 → 降級到檔名比對」。這會讓**已知 hash 不同**的兩個檔案因同名再次被判「可能相符」，違反 R3 要求。 |

> 以上全部由直接 Read／Grep 磁碟原始碼取得；CodeGraph 索引仍過期（Added 5／Modified 6），依禁令未 sync／index。

### 1.2.2 R1～R4 修改前後差異（A3-R2-R1 → A3-R2-R2）

| 項 | A3-R2-R1（修改前） | A3-R2-R2（修改後） | 原因 |
|---|---|---|---|
| **R1** | §10.3 用 `TagCategories.of(e)==="style"` 當品質詞判定，且把常用整包當品質來源 | 改為**明確的 quality 集合**；`style` 只是一般畫風分類，**不得整類視為 quality**；一般畫風（`anime coloring`／`cel shading`／`chibi`／`fantasy`…）保留可選。單一判定函式 `isQualityWord()`，首選未來把 quality kind 寫進標籤 metadata（含產生器同步），Phase 1 用單一明確集合 | F23／F24；任務要求 |
| **R2** | §10.3 只列四個入口（常用前五／quality 群組／一般分類／搜尋），並在 `groupItems()` 層處理 | 改為在 **`renderTags()` 的共用 `L.filter()` 資料來源**一次過濾，涵蓋 `__fav__`／`__top__` 與所有分支；`groupItems()` 不再各自判定；已選 chips 不過濾；個人入口的品質詞不得重新出現 | F25；任務要求 |
| **R3** | §9.1「SHA256 不符 → 降級檔名」 | 改為**逐候選獨立比較**：兩側都有 hash 且不同→**排除該候選，不降級**；只有缺 hash 才能用檔名／大小；所有可比對候選 hash 都不同→「本機找不到相同版本」；多筆同名不自動選 | F26／F27；任務要求 |
| **R4** | §10.2 先做臨時 `composeOnce()`，A2 Composer 落地後再換本體 | 改為 **Phase 1 直接建立最小 `PromptComposer.compose()`**＋Legacy Adapter；不建立 `composeOnce()` 過渡層，避免第二套長期架構與重複工作；每次生成只呼叫一次 | A2-R3 §647-682／A2-R4 §756-768；任務要求 |

### 1.2.3 最新 D1～D6 決策對照（本輪權威版本）

| 決策 | 最新規格 | 與 A3-R2-R1 的差異 | 依據 |
|---|---|---|---|
| **D1 完整還原** | 先讀→純資料摘要→確認→單次提交；逐筆列名稱＋權重；三種 `loras` 語意；取消完全不變 | 不變 | §7-C／F5／F6 |
| **D2 只帶文字** | 標籤＋描述＋Negative；不碰 LoRA／尺寸／張數／步數／CFG／種子；Negative 三情境為**未授權 PD1** | 不變 | §7-A |
| **D3 品質詞** | **直接 PromptComposer** 唯一組裝＋唯一 `normalizeText` 去重；明確 quality 集合（**非 style**）；在所有標籤新增入口共用過濾；一般畫風不過濾；舊 `sel` 不刪；`ui.settings.quality` 仍為唯一開關權威 | 改品質集合來源（R1）、補兩個人入口（R2）、改 Composer 架構（R4） | F23-F25／§10 |
| **D4 分類套用** | Model B（歷史基底／目前替換）；未勾保留歷史；候選預覽＋人工確認＋通用外觀不預勾；不得改回 Model A | 不變 | F8-F10 |
| **D5 Trigger Words** | 不顯示虛構採用狀態；「我的詞中也有這個詞」即時比對且明說不保存／不記錄來源；建議唯讀、個人可編輯 | 不變 | F11／F12／§8 |
| **D6 Civitai↔本機** | **逐候選 SHA256 比對**（不同即排除）；缺 hash 才用檔名／大小；「本機找不到相同版本／可能相符／相同版本」三態；不自動 enabled；PD7／PD8 待決策 | 修正降級邏輯（R3） | F26／F27／§9 |

---

## 1.3 A3-R2-R3 補正版本紀錄（資料契約對齊）

本節記錄 ChatGPT 對 A3-R2-R2 的獨立審查後，第三輪定點補正。**既有 §1.1、§1.2 與 §2～§18 全部保留**；與本節衝突處，以本節及後續標註「R3 補正」的章節為準。本輪**只對齊 A2 契約與實際程式資料流**，不擴大功能範圍。

### 1.3.1 新增查核事實（F28～F33）

| # | 主題 | 位置 | 查核結果 |
|---|---|---|---|
| F28 | 計數與標籤清單是兩條資料流 | `tags.js:56-83,92-102,318-332,418-447` | `renderCats()` 的 `favN`／`usedN` 由 `Object.keys(stats.tags)` 逐筆統計，只檢查 `CANON_ONLY[k]`（`:323-330`），**不是 `renderTags()` 的 `L.filter()` 下游結果**。`CANON_ONLY` 由 `CATS` 的 canonical（`/` 分割後取第一段）建立（`:59-83`）；`canonicalTag(raw)`（`:92-102`）把權重外框／`:weight`／別名／中文映射到 canonical，認不出回 `null`。→ A3-R2-R2 §10.4 聲稱「共用 `L.filter` 一次過濾也涵蓋分類計數」在資料流上**不成立**。 |
| F29 | PromptEntry 權威欄位 | A2-R4 §6.1（`:699-720`） | 14 欄：`id`、`kind`、`owner`、`origin`、`text`、`weight`、`order`、`lora`、`disabled`、`raw`、`translated`、`untranslated`、`fragments`、`adoptionId`。已移除 `provenance`／`adoptedFrom`／`locked`／`origin:"personal"`／`owner:"lora"`／lora-trigger 的 `weight:1.0`。A3-R2-R2 §10.2 的 7 欄「最小 PromptEntry」**不符合權威契約**。 |
| F30 | freetext 必須保留片段 | A2-R4 §5.3（`:541-549`） | `translateWithFragments(raw)`：① 依 `/[，、；;\n]+/` 切片段 ② 每片段 `Dict.tr(seg)` 與 `Dict.leftover(seg)` 各執行一次 ③ 每片段產生一筆 entry，帶 `raw/translated/untranslated/fragments` ④ Composer 把每段 `text` 當不可分割 block 去重接合 ⑤ Snapshot 不重跑 `Dict.tr()`。A3-R2-R2 §10.2「整段一筆、只留 `text`」**不符合契約**。 |
| F31 | v1→v2 遷移與注入 | A2-R4 §6.2／§6.3（`:722-752`）、`app.js:393,555-596,641-668` | `personalTriggers` 是唯一注入來源；`authorSuggestions` 永不注入。M1～M8 明確區分「欄位缺失」與「有效空陣列」。目前程式 `LORA_VERSION=1`，只有 `triggers`，**沒有** `personalTriggers`／`adoptionRecords`；`loraSnapshot()`／`loraTokensFromSnapshot()` 以 `enabled`／`autoTrigger` 過濾。 |
| F32 | Negative 契約與版本差異 | A2-R4-R1 §4.2-4.5（`:111-167`）、A2-R4 §6.4（`:761-768`）、`app.js:13,16,325-338,904,965` | `negativeRaw`＝`$("neg").value` 原樣（不 trim／不解析），`text.neg === negativeRaw`；舊 gallery `neg = snap.neg.trim()`。A2-R4 §761 寫「Composer 解析 negativeRaw 整 `neg`」，但 A2-R4-R1 §159 明確 `effectiveNegative` 只是 L2，**目前不據此改寫 `text.neg`**，需產品決策才升級。後者為最終修正，本輪採用。目前程式 `#neg` 原字串直通（`:338`、`:896`）。 |
| F33 | SHA 彙總缺口 | A3-R2-R2 §9.1（本報告 :387-393） | 原彙總未涵蓋「有候選、有可比較檔案，但部分 pair 因 hash 不同、部分因檔名／大小不符被排除，最後沒有 CONFIRMED／POSSIBLE」的情境；且「檔名＋資料夾＋大小」與「subfolder 不參與比對」用語打架。 |

> 以上全部由直接 Read／Grep 磁碟原始碼與 A2 報告取得；CodeGraph 索引仍過期（Added 5／Modified 6），依禁令未 sync／index。

### 1.3.2 R1～R6 修改前後差異

| 項 | A3-R2-R2（修改前） | A3-R2-R3（修改後） | 原因 |
|---|---|---|---|
| **R1** | §10.4 稱「在 `L.filter()` 一次過濾，也涵蓋 `__fav__`／`__top__` 計數」 | 改為**兩條資料流各自呼叫同一個 `isQualityWord()`**：`renderTags()` 在 `L.filter()` 過濾；`renderCats()` 在 `stats.tags` 迴圈（用 `CANON_ONLY`＋`canonicalTag()`）以同一函式計數。計數語意明確定義 | F28 |
| **R2** | §10.2「最小 PromptEntry」只有 7 欄 | 改為 **A2-R4 §6.1 完整 14 欄**，逐欄列語意；`id`≠Snapshot `entryId`；`owner` 只有 user/system；`origin` 用 A2 枚舉；不作廢任何欄位，只給預設值 | F29 |
| **R3** | §10.2「`ui.extra → Dict.tr()` → freetext entries（整段一筆）」 | 改為 `translateWithFragments(raw)` 逐片段衍生，每筆保留 `raw/translated/untranslated/fragments`；Composer 不重新翻譯；Snapshot 直接用同次 entries | F30 |
| **R4** | 只寫 `ui.loras`／`enabled`／`autoTrigger`，未定義 v1 `triggers` → v2 `personalTriggers` | 補 A2-R4 §6.2／§6.3 M1～M8；`personalTriggers` 唯一注入；作者建議不進 Prompt；**正規化後** `enabled!==true` 不生 entry；`autoTrigger===false` 保留詞且 entry `disabled:true`（仍存在，此列已被 §1.4.4 真值表取代） | F31 |
| **R5** | §10.2「不解析 `#neg`、原字串直通」 | 改為：`negativeRaw` 是原始權威；Composer 依 A2 `parseNegative()` 產生 L2；**L1 `text.neg` 仍等於 `negativeRaw`**（A2-R4-R1 最終修正）；區分「不解析語意」與「不做字串處理」 | F32 |
| **R6** | 彙總只列四種情境，缺「全部 EXCLUDED」；subfolder 用語矛盾 | 補完整 pair／aggregate 狀態表；所有 EXCLUDED ⇒「本機找不到相同版本」；「本機還找不到」僅限無候選／無可用資訊；basename／size／subfolder 職責分明 | F33 |

### 1.3.3 最新品質過濾與分類計數資料流（R1）

**單一判定函式**：`isQualityWord(tag)` 接收 **canonical tag**（先經 `canonicalTag(tag)` 正規化；認不出回 `null`＝非品質詞），以單一明確集合比對。一般模式與進階模式**都呼叫同一函式**，差異只在是否過濾。

| 資料流 | 函式／位置 | 一般模式 | 進階模式 |
|---|---|---|---|
| 標籤新增入口 | `renderTags()` 的 `L.filter()`（`tags.js:425-442`） | `if (isQualityWord(canonicalTag(x.e))) return false;`，在 18+／搜尋／`__fav__`／`__top__`／一般分類**所有分支之前** | 不過濾 |
| 分類頁籤計數 | `renderCats()` 的 `stats.tags` 迴圈（`:323-330`） | 同一 `isQualityWord(k)`，`k` 已是 `CANON_ONLY` 的 canonical key；**在 `favN++`／`usedN++` 前排除** | 不過濾 |
| 已選 chips | `renderSel()`（`:537-548`） | 不過濾，仍顯示且生效 | 不過濾 |
| 隨機池 | `buildPools()`（`:651`） | 原本排除常用，不變 | 不變 |

**計數語意（避免誤導）**

| 模式 | 頁籤數字 | 文案 |
|---|---|---|
| 一般 | 只計「目前可選的收藏／常用標籤數」（已排除品質詞） | 「我的收藏（可選 N）」／「我的常用（可選 N）」 |
| 進階 | 計全部（含品質詞） | 「我的收藏（全部 N）」／「我的常用（全部 N）」 |

- **不得**宣稱「同一個 `L.filter` 會自動影響計數」；計數是獨立迴圈，必須明確套用同一判定。
- `CANON_ONLY`（`:58`、`:67`）只收 CATS canonical，`canonicalTag()`（`:92-102`）處理權重外框、`:weight`、別名（`a/b`）與中文對照；認不出者不計，避免別名／中文造成重複計數。`isQualityWord()` 比對的也是 canonical，因此不會把別名當成不同品質詞。
- 若產品決定「保留含隱藏品質詞的總數」，必須標成「總收藏／總使用數」，並另外提供可選項數；不得讓數字被解讀為目前可選數（列 PD13）。

### 1.3.4 完整 PromptEntry 權威欄位與 Legacy Adapter 對應（R2）

以 **A2-R4 §6.1 為唯一權威**（本報告 F29）。Phase 1 可給預設值，但**不得改名、刪除或改寫語意**；先前「7 欄已足夠」的判斷**不成立**。

| 欄位 | 型別／預設 | Phase 1 Legacy Adapter 對應 | 語意要點 |
|---|---|---|---|
| `id` | string，必填 | 每次衍生重新產生（記憶體 id） | **不是** Snapshot 的 `entryId`；後者是凍結在 Snapshot 內的另一層識別（A2-R4 §520），兩者不得混為同一欄位契約 |
| `kind` | `tag`\|`lora-trigger`\|`freetext`\|`quality`\|`default` | sel→`tag`；`#pos`→`freetext`；個人詞→`lora-trigger`；QUALITY→`quality`。（**Positive 不含 `default`**；預設負面與 Negative Entry 由 §1.4.6 的 `negativeRaw`／L2 獨立處理） | — |
| `owner` | `user`\|`system` | 標籤／描述／個人詞／已採用作者詞＝`user`；QUALITY／預設負面＝`system` | **管理權**，不是 LoRA 歸屬；不得用 `lora` |
| `origin` | `tag-db`\|`author-local`\|`author-civitai`\|`wd14`\|`freetext`\|`manual`\|`default` | sel→`tag-db`；`#pos`→`freetext`；個人詞→`manual`（手動）或 `author-civitai`／`author-local`（若未來有真實採用紀錄）；QUALITY→`default` | 不得用已淘汰的 `personal` |
| `text` | string，必填 | 正規化後文字（底線轉空格） | 不可為 null；空字串由 Composer 過濾 |
| `weight` | number\|null | 僅 `tag` 用 `sel.w`；其餘 `null` | lora-trigger 不得用 `weight:1.0` |
| `order` | integer ≥0 | tag 用 sel 索引；freetext 續排；lora-trigger 最後；quality 指定最前 | 去重後依此升序 |
| `lora` | string\|null | 僅 lora-trigger 填 LoRA 相對路徑；其餘 `null` | — |
| `disabled` | boolean，預設 false | `autoTrigger===false` → `true`（但個人詞不刪）；其餘 false | Composer 過濾 |
| `raw` | string\|null | 僅 freetext 填原始中文片段 | — |
| `translated` | string[]，預設 [] | freetext 由片段計算 | — |
| `untranslated` | string[]，預設 [] | freetext 由片段計算；不進 Prompt | — |
| `fragments` | array，預設 [] | **freetext 必備**，見 §1.3.5 | 由 `translateWithFragments()` 產生 |
| `adoptionId` | string\|null，預設 null | Phase 1 **一律 null**（無真實採用紀錄，D5） | 不得假造 UUID |

**已移除欄位不得復活**：`provenance`、`adoptedFrom`、`locked`、`origin:"personal"`、`owner:"lora"`。

### 1.3.5 freetext fragments 完整衍生流程（R3）

`ui.extra` 仍是**唯一持久化來源**；Adapter 只衍生条目，不建立第二份權威、不寫回 localStorage。

```
ui.extra（原始字串）
  → translateWithFragments(raw)（A2-R4 §5.3 純函式，每次衍生執行一次）
    1) 依 /[，、；;\n]+/ 切片段（與 Dict.tr 同分隔符）
    2) 每片段 seg：text = Dict.tr(seg)；untranslated = Dict.leftover(seg)
    3) 每片段產生一筆 freetext entry：
       { id, kind:"freetext", owner:"user", origin:"freetext",
         text, weight:null, order, lora:null, disabled:false,
         raw:seg, translated: text ? text.split(", ") : [],
         untranslated, fragments:[{raw:seg, translated:[...], untranslated:[...]}],
         adoptionId:null }
    4) Composer 把每個 text 視為不可分割 block 參與去重與 ", " 接合
       （與現行 snapshotNow() 把整段 Dict.tr(#pos) push 進 parts 的行為一致）
    5) text.pos 直接取 Composer 輸出；Snapshot 不重跑 Dict.tr()
```

- **不得**把整段 `Dict.tr()` 結果存成單一 `text` 後丟棄片段；`untranslated`（如「樹下」）只存在 `fragments`／`untranslated`，不進 Prompt（A2-R4 §5.4）。
- Composer **不負責翻譯**；只組裝 Adapter 已衍生的 entry。
- 未來 `promptSnapshot` 直接凍結同一次衍生的 `entries`／`effective`，**不得**再次執行 `Dict.tr()` 偽造「生成當時的翻譯」。

### 1.3.6 LoRA v1→v2 遷移引用與注入規則（R4）

| 規則 | 內容 |
|---|---|
| 唯一注入來源 | `personalTriggers`（A2-R4 §6.2）。**作者建議 `authorSuggestions` 永不進 Prompt**；只能被「採用」複製成個人詞 |
| 目前程式 | `LORA_VERSION=1`，`loraParseItems()`／`loraSerialize()` 只處理 `triggers`，沒有 `personalTriggers`／`adoptionRecords`（F31） |
| 遷移契約 | Legacy Adapter **必須遵循 A2-R4 §6.3 M1～M8**，不得自創第二套：M1 欄位缺失補 `[]` 並標 `field-missing-v2`；M2 有效空陣列原樣保留、不合成舊詞；M3 型別錯誤入 quarantine；M4 雙欄相同優先用 v2；M5 衝突聯集且保留備份；M6 v1 有詞＋v2 空陣列→v2 勝出但備份 v1；M7 v2 有資料勝出；M8 壞筆只跳過、不清空整組 |
| 有效空 vs 缺失 | M1／M2 必須分辨；不得合併處理；`ui.loras.migrationBackup` 雙 key 規則（A2-R4-R1-R1 §4.1-4.5）不受本設計影響 |
| entry 產生 | **先正規化 `enabled`**（`it.enabled !== false`）；正規化後 `enabled !== true` 的 LoRA 不產生 lora-trigger entry；正規化後 `enabled===true` 時每筆個人詞都建立 entry；`autoTrigger===false` 時個人詞仍留在 `personalTriggers`，該 entry 設 `disabled:true`（仍存在），由 Composer 過濾。完整真值表見 §1.4.4 |
| 取消／來源失效 | 取消版本連結、作者建議更新或採用紀錄失效**皆不得刪除個人詞**（D5、A2-R4 §6.2） |
| 本輪限制 | 不實作遷移、不修改 localStorage、不寫入 `ui.loras`；以上為 Phase 1 設計契約 |

### 1.3.7 Negative 原始資料與 Composer 輸出規則（R5）

| 項目 | 規則 |
|---|---|
| 原始權威 | `negativeRaw`＝擷取時 `$("neg").value` **原樣**（不 trim、不解析）；存量 `snapshotNow().neg`、`wf().neg`、`text.neg` 三者相等（A2-R4-R1 §4.2） |
| 舊歷史 | 只有 `neg` 字串時，`negativeRaw = fallback(legacy neg)`，標 `negativeParse.mode:"raw-only"`，**不宣稱知道未 trim 原值** |
| Composer L2 | 依 A2-R4-R1 §4.4 `parseNegative()`：`/[,\r\n]+/` 切分 → trim → 解析 `(text:weight)` → 無法解析者入 `negativeParse.unparsed` → `negativeEntries` → 以 `normalizeText` 去重得 `effectiveNegative` |
| L1 不變 | **最終權威版本 A2-R4-R1 §159**：`effectiveNegative` 只是 L2 描述，**目前不據此改寫 `text.neg`**；若未來讓 Composer 真正輸出 `effectiveNegative` 字串，屬產品行為變更，需另案決策並升級 `composerVersion` |
| 原始不被破壞 | Composer 解析只產生 L2，不覆寫、不 trim、不重寫 `negativeRaw` |
| 語意區分 | 「不解析自然語言語意」≠「不做 A2 定義的字串分隔／組裝」：Phase 1 的 Composer 要實作 A2 定義的分隔／去重 L2 處理，但**不**做自然語言理解 |
| 版本衝突 | A2-R4 §761 寫「Composer 解析 negativeRaw 整 `neg`」，與 A2-R4-R1 §159 有語意落差；**採用較晚的最終修正 A2-R4-R1**（並由 A2-R4-R1-R1 保留其方向），不選方便版本 |
| PD1 | D2 的「歷史 Negative 空字串保留目前」仍是**未授權的產品決策建議**，本輪不定案 |

### 1.3.8 SHA256 pair／aggregate 完整狀態表（R6）

**Pair 狀態（所有 `files[] × candidates[]` 的 pair 都要參與，primary 只是排序提示）**

| 狀態 | 條件 | 可否降級 |
|---|---|---|
| `CONFIRMED` | 雙方都有 hash 且 `casefold` 後相同 | — |
| `EXCLUDED_HASH_DIFF` | 雙方都有 hash 但不同 | **絕不降級到檔名比對** |
| `POSSIBLE` | 至少一側缺 hash，且 basename 相同且（有 size 時）size 相符 | 僅此分支可用保守證據 |
| `EXCLUDED_WEAK_MISMATCH` | 至少一側缺 hash，且 basename 或 size 不符 | — |

**Aggregate 狀態（優先順序由上而下，第一個命中即採用）**

| # | 條件 | 顯示 | 說明 |
|---|---|---|---|
| 1 | 至少一筆 `CONFIRMED` | 本機找得到相同版本 | 列出**所有** CONFIRMED 的本機 `name`／`subfolder`；>1 筆時請使用者選，不自動挑 |
| 2 | 無 CONFIRMED，至少一筆 `POSSIBLE` | 可能相符，請你確認 | 顯示候選與檔名；未確認前不寫入 `ui.loras` |
| 3 | 無 CONFIRMED／POSSIBLE，但**至少評估過一個 pair**（所有 pair 皆 EXCLUDED，不論原因是 hash 不同或檔名／大小不符） | 本機找不到相同版本 | 可附：「hash 不同 N 筆／檔名或大小不符 M 筆」；**不回退到 POSSIBLE** |
| 4 | 沒有本機候選，或沒有可用檔案資訊（無 `files[]`／無 name、hash、size 可用） | 本機還找不到 | 取得與放置說明；**只有此分支可用** |

**欄位職責（消除用語矛盾）**

| 項目 | 負責什麼 | 不負責什麼 |
|---|---|---|
| `basename`（NFC→casefold→去資料夾） | POSSIBLE 的檔名證據 | 不當 hash 相等的替代 |
| `size`／`sizeKB`（±1 KB） | POSSIBLE 的輔助數值證據 | 不單獨構成 CONFIRMED |
| `subfolder`（本機 `sub`） | **僅顯示**對應本機路徑 | **不是內容相符證據**，不參與比對 |

> 無 any hash-diff pair 被降級；所有 multi-file × multi-candidate pair 都進入 aggregate；「本機還找不到」不再被用在「有候選但不相符」的情境。

### 1.3.9 最新 D1～D6 決策對照（本輪權威版本）

| 決策 | 最新規格 | 與 A3-R2-R2 的差異 | 依據 |
|---|---|---|---|
| **D1** | 先讀→純資料摘要→確認→單次提交；三種 `loras` 語意；取消完全不變 | 不變 | §7-C |
| **D2** | 只帶文字範圍不變；Negative 三情境仍為**未授權 PD1** | 不變；R5 只對齊 Composer L1／L2，不改 PD1 | §7-A |
| **D3** | `ui.settings.quality` 唯一開關權威；明確 quality 集合；**過濾與計數各自呼叫同一判定**；一般畫風不過濾 | R1 修正計數資料流 | §10.3／§10.4 |
| **D4** | Model B 固定，歷史 Prompt 為基底 | 不變 | §7-B |
| **D5** | 不虛構 `adoptionRecords`；「我的詞中也有這個詞」即時比對、不記錄來源 | 不變；R2 明確 `adoptionId:null` | §8 |
| **D6** | 不自動 enabled、不下載安裝；SHA pair／aggregate 完整四態 | R6 補齊全部 EXCLUDED 分支 | §9.1／§9.4 |

### 1.3.10 Phase 1 最終架構與驗收條件

```
ui.extra ─┐
sel ──────┼→ Legacy Adapter（A2-R4 §6.1／§6.3／translateWithFragments）
ui.loras ─┤      → PromptModel {v:2, positive:PromptEntry[], negativeRaw}
#neg ─────┘              │
quality ─────────────────┘→ PromptComposer.compose()（唯一入口，呼叫 1 次）
                              → {pos, neg, posHash, entries, effective}
                              → /prompt payload、gallery.prompt、預覽共用
```

| # | 驗收條件 |
|---|---|
| A1 | PromptEntry 輸出 14 欄齊全；`id` 與 Snapshot `entryId` 不同；`owner`∈{user,system}；`origin` 無 `personal`；`lora` 僅 lora-trigger 有值；`adoptionId:null` |
| A2 | freetext 每片段都有 `raw/translated/untranslated/fragments`；「樹下」等未譯詞不進 `text.pos`；Snapshot 不重跑 `Dict.tr()` |
| A3 | **正規化後** `enabled!==true` 無 entry；正規化後 `enabled===true` 時每筆 personalTriggers 都有 entry；`autoTrigger===false` 詞仍在 `personalTriggers` 且 entry `disabled:true`（不建立 entry 的舊規則已被 §1.4 取代）；M1～M8 有測試，M1≠M2 |
| A4 | `negativeRaw` 逐位元組等於 `#neg` 原值；Composer 只產 L2；`negativeParse.unparsed` 保留解析失敗 token；PD1 未被當成既定行為 |
| A5 | 一般模式：`renderTags()` 與 `renderCats()` 都呼叫同一 `isQualityWord()`；頁籤文案標明「可選 N」；進階模式標「全部 N」；一般畫風仍可選；舊 `sel` 品質詞不刪 |
| A6 | SHA aggregate 四態可重現：CONFIRMED／POSSIBLE／全 EXCLUDED→找不到相同版本／無候選→還找不到；hash 不同 pair 不降級；subfolder 只顯示 |
| A7 | 每次生成只呼叫一次 Composer；payload／gallery／預覽 `pos` 逐字相同；不新增 localStorage key |

### 1.3.11 尚未解決問題、PD 與未驗證事項

| # | 項目 | 類型 | 狀態 |
|---|---|---|---|
| PD13 | 一般模式頁籤數字要「可選數」還是「總收藏／總使用數」？ | PD | 建議可選數並標「可選 N」；若保留總數須明確標「總收藏」 |
| PD14 | 是否讓 Composer 真正輸出 `effectiveNegative` 為 `text.neg`（升級 `composerVersion`）？ | PD | 否；維持 A2-R4-R1 最終修正的 L2 定位 |
| PD1／PD7／PD8／PD11／PD12 | 沿用前輪，未授權 | PD | 不得視為已授權 |
| U8 | `translateWithFragments()` 與 `Dict.tr()` 在極端跨片段去重的等價性 | 未驗證 | 依 A2-R4 §549，以 `text.pos` 為唯一真相 |
| U9 | 真實 localStorage 的 v1／v2 混存情形 | 未驗證 | 本輪唯讀，不碰使用者資料 |
| U10 | 1366×768 一屏與頁籤文案長度 | 未驗證 | 實作階段量測 |

### 1.3.12 開始／結束 Git 與服務

- 本輪開始：`modified=15`、`staged=0`、`untracked=65`、`total=80`；Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、Remote `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`、Ahead 1／Behind 0；CodeGraph 仍 Added 5／Modified 6（未 sync）。
- 本輪只更新本報告，Git 結束狀態與 `git diff --check` 結果見 §16（本節不重複）。
- 正式服務未受影響，見 §17。**明確聲明：未開始 A3 Phase 1。**

---

## 1.4 A3-R2-R4 補正版本紀錄

本節為 ChatGPT 對 A3-R2-R3 獨立審查後的第四輪定點補正，是**最新權威**。§1.1／§1.2／§1.3 與 §2～§18 的歷史脈絡保留；凡與本節衝突的舊描述，依 §1.4.9 清單視為**已被取代**。本輪**只做設計文件補正**，不實作、不修改任何程式或 A2 契約。

### 1.4.1 本輪目標及範圍

修正四項契約問題：R1 統一 autoTrigger 的 entry 規則（建立與啟用分離）；R2 修正 `PromptEntry[]` 陣列型別（避免被誤讀為 14 筆 tuple）；R3 明確分離 Positive 與 Negative 的 L1／L2；R4 補齊舊 `enabled` 欄位缺失的正規化相容規則。範圍限於本報告，D1～D6 產品決策不變。

### 1.4.2 R1～R4 修改前後差異

| 項 | A3-R2-R3（修改前） | A3-R2-R4（修改後） | 依據 |
|---|---|---|---|
| **R1** | §10.2 寫「僅在 enabled 為真且 autoTrigger 非假時才衍生 lora-trigger entry」的舊規則，把「是否建立 entry」與「entry 是否啟用」混在一起 | 統一為：先正規化 `enabled`；正規化後 `enabled===true` → **每筆 `personalTriggers` 都建立 entry**；`autoTrigger===true` → `disabled:false`，`autoTrigger===false` → `disabled:true`（entry 仍存在）；Composer 過濾 `disabled:true`；`authorSuggestions` 永不衍生 entry | A2-R4 §6.1／§6.2；`app.js:633-668` |
| **R2** | §1.3.10／§10.2 使用「PromptEntry 後接括號 14」的舊陣列寫法，易被誤讀為「恰好 14 筆 Entry 的 tuple」 | 改為 `PromptEntry[]`：零至多筆；**每筆**具有 A2-R4 §6.1 的完整 14 欄；`id`（記憶體）≠ `entryId`（Snapshot） | A2-R4 §6.1／§5.2 |
| **R3** | PromptModel 只寫 `positive`＋`negativeRaw`，未交代 Negative L2；§1.3.4 kind 表把「預設負面→`kind:default`」列為 Positive Adapter 來源 | Positive 只含 `tag`／`lora-trigger`／`freetext`／`quality`；Negative L1＝`negativeRaw`（＝`#neg.value` 原樣＝`text.neg`）；Negative L2＝Composer `parseNegative()` 產生的 `negativeEntries`／`effectiveNegative`／`negativeParse`，與 Positive 分開；移除 Positive 的 `default` 來源 | A2-R4-R1 §4.2-4.5（最終修正） |
| **R4** | 只寫 `enabled!==true` 不生 entry，未說明舊資料缺欄位的正規化 | Legacy Adapter 先依 `loraParseItems()` 的 `it.enabled !== false` 正規化：缺欄位／null／其他非 false 值→`true`；只有明確 `false`→`false`。新建 LoRA 的 `loraSet()` 預設仍為 `enabled:false`，兩者不得混為一談 | `app.js:570,578-580,604-625,633-635` |

### 1.4.3 A2 契約依據與實際程式碼證據

| # | 主題 | 位置 | 證據 |
|---|---|---|---|
| F34 | enabled 正規化 | `app.js:570`、`app.js:633-635` | `loraParseItems()` 用 `enabled: it.enabled !== false`；`loraEnabled()` 用 `it.enabled !== false && loraNameOk(it.name)`。→ 缺欄位／null／其他非 false 值都視為 `true`，只有明確 `false` 才是停用。 |
| F35 | 新建 LoRA 預設 | `app.js:604-625`（`loraSet()`，:611） | 新建一筆時 `enabled:false`；與 F34 的舊資料相容是**兩種不同情境**，不可互換。 |
| F36 | autoTrigger 的現行語意 | `app.js:569,641-650,654-668` | `loraSnapshot()` 保留所有 `loraEnabled()` 項目的 `triggers` 與 `autoTrigger`；`loraTokensFromSnapshot()` 只跳過 `autoTrigger===false`，**不刪除個人詞**。→ 今日「不注入」是 Composer 層的過濾，不是資料不存在。 |
| F37 | 契約權威 | A2-R4 §6.1／§6.2／§6.3；A2-R4-R1 §4.2-4.5 | PromptEntry 完整 14 欄；`personalTriggers` 唯一注入；M1～M8；`negativeRaw` 為 L1、`negativeEntries`／`effectiveNegative`／`negativeParse` 為 L2。 |

> CodeGraph 索引仍為 Added 5／Modified 6，**未 sync／index**；以上均為直接 Read 磁碟原始碼與 A2 報告。

### 1.4.4 R1：統一的 autoTrigger entry 規則

**兩階段，不可合併**

| 階段 | 動作 | 規則 |
|---|---|---|
| ① Legacy Adapter 正規化 | `enabled` | 依 F34 `it.enabled !== false`；正規化後的布林才進入下一步 |
| ② 建立 entry | 只看正規化後的 `enabled` | `enabled===true` → 該 LoRA 的**每一筆** `personalTriggers` 建立一筆 `kind:"lora-trigger"` entry；`enabled!==true` → **不建立任何 entry** |
| ③ 設定 entry 狀態 | 只看 `autoTrigger` | `autoTrigger===true` → `disabled:false`；`autoTrigger===false` → entry **仍存在**，`disabled:true` |
| ④ Composer 組裝 | 過濾 `disabled:true` | `disabled:true` 的 entry 不進 `text.pos`，但個人詞仍保留在 `personalTriggers` |

完整真值表

| 正規化後 enabled | autoTrigger | 是否建立 lora-trigger entry | entry.disabled | 是否進 `text.pos` | 個人詞是否保留 |
|---|---|---|---|---|---|
| true | true | 是（每筆 personalTriggers 一筆） | false | 是 | 是 |
| true | false | **是** | **true** | 否（被 Composer 過濾） | **是** |
| false | true | 否 | — | 否 | 是（資料仍在） |
| false | false | 否 | — | 否 | 是（資料仍在） |

- `authorSuggestions` **永遠不衍生 PromptEntry**，只能被「採用」複製進 `personalTriggers` 後才可能成為 entry。
- `autoTrigger===false` 是 **disabled 狀態，不是不存在狀態**；不得再出現「enable 為真且 autoTrigger 非假才衍生 entry」的舊規則。
- 全文已無「autoTrigger 關閉就不建立 entry」的描述；若有舊段落，依 §1.4.9 取代。

### 1.4.5 R2：`PromptEntry[]` 陣列型別

**正確寫法**：`PromptModel.positive: PromptEntry[]`（零至多筆的陣列）。

| 誤解 | 正確語意 |
|---|---|
| 舊寫法（PromptEntry 後接括號 14）＝恰好 14 筆 entry 的 tuple | `PromptEntry[]`＝任何長度的陣列（含空陣列 `[]`） |
| 14 是 entry 筆數 | **14 是每一筆 PromptEntry 的欄位數**（A2-R4 §6.1：`id, kind, owner, origin, text, weight, order, lora, disabled, raw, translated, untranslated, fragments, adoptionId`） |
| 記憶體 `id` 可當 Snapshot `entryId` | `id` 是每次衍生重新產生的記憶體識別；`entryId` 是 Snapshot 內凍結的識別（Positive 從 `e1`、Negative 從 `n1` 起算，**各自獨立**）；兩者不可混用 |

本輪已把報告中所有舊的括號 14 陣列寫法改寫為 `PromptEntry[]`（詳 §1.4.8 搜尋結果）。

### 1.4.6 R3：Positive 與 Negative 的 L1／L2 分離

**Positive**

`PromptModel.positive: PromptEntry[]` **只含正向條目**：`tag`、`lora-trigger`、`freetext`、`quality`。**不得**把 Negative Entry 塞入 `positive`；§1.3.4 舊 kind 對應表中的「預設負面→`kind:default`」已移除（見 §1.4.9）。

**Negative L1（輸出權威）**

`PromptModel.negativeRaw: string`＝擷取時 `#neg.value` **原樣**；不 trim、不覆寫、不因解析結果改寫；`text.neg === negativeRaw`（A2-R4-R1 §4.2）。舊歷史只有 `neg` 時以 fallback 取得並標 `negativeParse.mode:"raw-only"`。

**Negative L2（Composer 衍生）**

由 `PromptComposer.compose()` 依 A2-R4-R1 §4.4 `parseNegative()` 衍生：

- `negativeEntries`：解析後的 **Negative SnapshotEntry 型態**資料，使用 A2-R4-R1 §4.3 的欄位子集與自己的 `entryId`（從 `n1` 起算）；**不是**把 Positive 的記憶體 `id` 當成 Snapshot `entryId`。
- `effectiveNegative`：`normalizeText` 去重與格式化後的 L2 描述。
- `negativeParse`：`{ mode:"parsed"|"raw-only", unparsed:string[] }`，保留解析失敗的原始 token。
- Negative 與 Positive 的 entry 與 `order` **各自獨立**（Negative 從 0 起算）。
- Composer 產生 L2 **不代表改寫 L1**；`effectiveNegative` **不得**直接取代 `text.neg`。是否讓 Composer 真正輸出 `effectiveNegative` 為 `text.neg` 仍是 **PD14，未授權**。

**完整資料流**

```
Positive：sel / ui.extra / ui.loras / ui.settings.quality
   → Legacy Adapter → PromptModel.positive: PromptEntry[]（tag/lora-trigger/freetext/quality）
   → PromptComposer.compose() → text.pos（唯一正向輸出）

Negative：#neg.value
   → negativeRaw（L1 原樣，text.neg = negativeRaw）
   → PromptComposer.parseNegative(negativeRaw)  ← 同一 Composer，但獨立處理
   → negativeEntries / effectiveNegative / negativeParse（L2）
   → 不回寫 negativeRaw、不取代 text.neg
```

### 1.4.7 R4：`enabled` 舊資料相容規則

**正規化規則（依 F34）**

| 原始欄位 | 正規化後 `enabled` |
|---|---|
| `enabled:true` | `true` |
| `enabled:false` | `false` |
| `enabled` 欄位不存在 | `true` |
| `enabled:null` | `true` |
| `enabled` 其他非 false 值 | `true` |

Legacy Adapter **必須先正規化再決定是否建立 entry**；不得直接用原始 localStorage 的 `enabled === true` 判斷，否則舊資料會突然停止注入。新建 LoRA 的 `loraSet()` 預設 `enabled:false` 必須保留，且**不得**與「舊資料缺欄位視為 true」混為一談。

**三種核心測試情境**

| # | 情境 | 正規化 | Adapter 結果 | 預期 |
|---|---|---|---|---|
| T-EN1 | 舊資料缺 `enabled` 欄位 | `true`（F34） | 建立 personal trigger entries | 與現行生圖行為一致，詞正常注入 |
| T-EN2 | 舊資料明確 `enabled:false` | `false` | 不建立任何 entry | 詞保留在 `personalTriggers` 但不進 Prompt |
| T-EN3 | 新建 LoRA（`loraSet()` 預設） | `false`（F35） | 不建立任何 entry | 直到使用者明確啟用才注入 |

補充：T-EN4 `enabled:true`＋`autoTrigger:false` → entry 存在且 `disabled:true`，詞不進 Prompt 但不被刪除（§1.4.4 真值表第 2 列）。

### 1.4.8 全文搜尋結果

以 Python 逐行讀取本報告（UTF-8）搜尋下列詞，結果如下（「修改前」為加入了 §1.4 之前的磁碟內容）：

| 搜尋詞 | 修改前命中 | 處理後結果 |
|---|---|---|
| 舊的 PromptEntry 括號 14 寫法 | 2 處：§1.3.10 架構圖（原 :271）、§10.2 `PromptModel` 列（原 :697） | **0 處**；兩處改為 `PromptEntry[]` |
| 舊的 autoTrigger 非 false 條件（含空格變體） | 1 處：§10.2 `derivePromptModel`（原 :699） | **0 處**；改為「先正規化 enabled，再以 autoTrigger 設 disabled」 |
| 舊的「enable 為真且 autoTrigger 非假」複合寫法 | 0 處 | 仍 0 處 |
| 「autoTrigger 關閉即不建立 entry」 | 0 處（§1.3.6／§10.2 原已用 disabled 語意，但 §10.2 的複合條件仍矛盾） | 統一為 §1.4.4 真值表 |
| 「預設負面→`kind:default`」 | 1 處：§1.3.4 kind 對應表（原 :160） | **0 處**；Positive 只保留 4 種 kind |
| `negativeRaw`／`negativeEntries`／`effectiveNegative`／`negativeParse` | 多處（§1.3.7、§12、§14 等） | 保留，並由 §1.4.6 明確歸屬 L1／L2 |
| `enabled!==true` | 多處（§1.3.6、§1.3.10 A3、§10.2、§13、結論） | 保留，但全部加「正規化後」限定語（見 §1.4.9） |

### 1.4.9 舊章節衝突取代清單

以下舊描述**已被 §1.4 取代**，本輪已直接修改本報告對應文字，避免新舊並存：

| 舊位置 | 舊描述 | 取代後 |
|---|---|---|
| §1.3.10 架構圖 | positive 為 PromptEntry 括號 14 的舊寫法 | `positive: PromptEntry[]` |
| §10.2 `PromptModel` 列 | positive 為 PromptEntry 括號 14 的舊寫法 | `positive: PromptEntry[]`，並註明「14 是每筆欄位數，不是筆數」 |
| §10.2 `derivePromptModel` 列 | 「僅 enable 為真且 autoTrigger 非假才衍生 entry」 | 「先正規化 enabled；enable 為真時每筆 personalTriggers 建立 entry；autoTrigger 為假者 `disabled:true`」 |
| §1.3.4 `kind` 對應表 | 「預設負面→`default`」列在 Positive Adapter | 移除；Negative 由 `negativeRaw`／L2 獨立處理 |
| §1.3.6／§1.3.10 A3／§10.2／§13／結論 | 「`enabled!==true` 無 entry」未標明正規化 | 改為「正規化後 `enabled!==true` 無 entry」 |

### 1.4.10 未解決事項與產品決策

| # | 項目 | 狀態 |
|---|---|---|
| PD14 | 是否讓 Composer 輸出 `effectiveNegative` 為 `text.neg`（升級 `composerVersion`）？ | 未授權；維持 L2 定位 |
| PD1／PD7／PD8／PD11～PD13 | 前輪未授權決策 | 仍待產品負責人，本輪不定案 |
| U9 | 真實 localStorage 的 v1／v2 混存與 `enabled` 缺欄位實例 | 未驗證（本輪唯讀，未讀 localStorage） |
| U11 | `autoTrigger:false` 但 entry 存在的 UI 呈現（狀態卡「不自動加入」）是否需避免與「沒詞」混淆 | 未驗證，實作階段確認 |

### 1.4.11 Git、服務與 Phase 1 聲明

- **Git 開始**：Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、Remote `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`、Ahead 1／Behind 0；`modified=15`、`staged=0`、`untracked=65`、`total=80`；CodeGraph 仍 Added 5／Modified 6（未 sync）。
- **Git 結束與 `git diff --check`**：見 §16 的本輪查核（更新後填入實際輸出）。
- **正式服務**：未受影響；未啟停 ComfyUI／Simple UI／WD14 Worker、未發請求、未生圖、未操作 GPU、未讀寫 localStorage。
- **明確聲明：未開始 A3 Phase 1**；本輪只有文件補正授權。

---

## 2. 開始前確認紀錄

### 2.1 已閱讀文件

| # | 文件 | 結果 |
|---|---|---|
| 1 | `C:\ComfyUI\AGENTS.md` | 已完整讀取（303 行） |
| 2 | `C:\ComfyUI\simple_ui\AGENTS.md` | 已完整讀取（184 行） |
| 3 | `devtools/reports/prompt-tag-system-a3-r1-ux-design.md` | 已完整讀取（370 行），A3-R2 直接修正對象；R1 補正輪重讀 |
| 4 | `devtools/reports/prompt-tag-system-a2-r4-r1-r1-final-contract-fixes.md` | 已完整讀取（451 行），A2 最終資料契約；R1 補正輪重讀 |
| 4a | `devtools/reports/prompt-tag-system-a3-r2-ux-design.md` | **R1 補正輪新增**：本報告 A3-R2 原文（435 行）已完整重讀，直接補正對象 |
| 4b | `devtools/reports/prompt-tag-system-a2-r3-final-model.md`、`prompt-tag-system-a2-r4-final-model-correction.md` | **R1 補正輪新增、R2 補正輪重讀**：已讀 PromptComposer 契約（R3 §647-682）與唯一組裝／去重規則（R4 §756-768） |
| 4c | `tag_categories.js`、`tags.js`、`server.py` | **R2 補正輪新增直接查核**：`style` 分類內容與 `TagCategories` API、`renderTags()`／`groupItems()`／`__fav__`／`__top__` 資料流、Civitai `files[]` 欄位 |
| 5 | `devtools/reports/history-prompt-category-apply-investigation.md` | 已讀取方向矛盾章節（§4.1、§261、§342） |
| 6 | `devtools/reports/lora-trigger-words-ux-audit.md` | 已讀取 §7.4／§7.5（作者／個人分離、`triggers` 唯一注入）、metadata 來源說明 |
| 7 | `devtools/reports/lora-civitai-author-suggestions-ux.md` | 已讀取 §10／§11（選用、免 Key、無自動下載） |
| 8 | `devtools/reports/lora-trigger-words-ux-phase2.md` | 已讀取（未碰 B2 gated 下載） |

### 2.2 CodeGraph 狀態

`codegraph status`（在 `C:\ComfyUI\simple_ui` 執行）：Files 35／Nodes 1,094／Edges 4,837，DB 7.02 MB，backend `node:sqlite`（full WAL），Pending Changes **Added 5／Modified 6**。

判定：**索引過期**。依禁令**未 sync／index**。本輪所有行號與行為結論以直接 Read／Grep 磁碟原始碼為準；CodeGraph 未用於下結論。

### 2.3 Git 初始狀態（writing 前重新查詢）

| 項目 | 結果 |
|---|---|
| Repository | `C:/ComfyUI/simple_ui`（`-C` 指定，未查上游） |
| Branch | `main` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 同址） |
| Ahead / Behind | `1` / `0`（`cf5609e feat: add Civitai LoRA explorer`） |
| `git status --porcelain` | `modified=15`、`staged=0`、`untracked=64`、`total=79` |
| Modified tracked（15） | `AGENTS.md`, `app.css`, `app.js`, `devtools/lora_api_test.py`, `devtools/lora_core_test.mjs`, `devtools/lora_explorer_api_test.py`, `devtools/lora_explorer_core_test.mjs`, `devtools/lora_mock_civitai.py`, `devtools/lora_ui_test.mjs`, `devtools/test_ui_control_wd14.ps1`, `index.html`, `server.py`, `ui_control.ps1`, `ui_panel.ps1`, `ui_panel.pyw` |
| 既有使用者修改 | 存在，本輪完全未動 |

**R1 補正輪重新查詢**：Repository／Branch／HEAD／Remote／Ahead-Behind 與上表完全相同；`git status --porcelain` 為 `modified=15`、`staged=0`、`untracked=65`、`total=80`（較 A3-R2 開始時多 1 項，即 A3-R2 報告本身）。

**R2 補正輪重新查詢（本輪開始，2026-11-27）**：各項與 R1 補正輪完全相同——`modified=15`、`staged=0`、`untracked=65`、`total=80`；`codegraph status` 仍為 Added 5／Modified 6，**索引仍過期，依禁令未 sync／index**；F23～F27 全部由直接 Read／Grep 磁碟原始碼取得。

---

## 3. 實際程式碼查核結果（設計的事實基礎）

| # | 主題 | 位置 | 查核結果 |
|---|---|---|---|
| F1 | 品質詞來源一 | `app.js:12` | `const QUALITY = "masterpiece, best quality, amazing quality, ";` |
| F2 | 品質詞來源二 | `tags.js:10` | 「常用」分類前段即 `masterpiece:大師作品｜best quality:最佳畫質｜amazing quality:極佳畫質｜very aesthetic…`；`tags.js:403` 另有 quality 分組。 |
| F3 | 品質開關持久化 | `app.js:16,31,3038,3606` | `S.settings.quality`（預設 `true`）存於既有 `ui.settings`；開關 `#q` 直接寫回。**沒有第二個品質 key。** |
| F4 | 組裝無去重 | `app.js:313-317,322-349` | `composePrompt()`／`snapshotNow()` 把 `QUALITY` 前綴與 `sel` 直接字串相接；同一品質詞若同時來自開關與手動標籤會重複出現。 |
| F5 | 完整還原現況 | `app.js:1210-1239` | `reusePrompt()` 直接 `Tags.restore(it.sel)` → `#pos=it.extra` → `if (it.neg)` → **若 `Array.isArray(it.loras)` 則整組覆寫 `S.loras` 並 `loraSave()`**；**沒有確認視窗**。 |
| F6 | `loras` 欄位語意 | `app.js:1215-1217` | 註明「空陣列表示該次生成沒有用 LoRA，必須清空；舊紀錄完全沒有欄位時保持目前選擇」——與 D1 完全一致，已具備相容性。 |
| F7 | 作者建議沿用目前 | `app.js:1218-1226` | 還原個人欄位，`authorSuggestions` 一律取目前 LoRA 的 metadata，不讓舊資料回退。 |
| F8 | 分類套用方向 | `app.js:1470,1473,1368` | `caPlanApply(CA.it.sel, Tags.snapshot(), ...)`、`caBuildCandidates(historySel, currentSel, ...)` → **歷史為基底、目前為替換來源＝Model B**（與 D4 一致）。 |
| F9 | 候選預設 | `app.js:1343-1358` | 角色模式中 `name-certain` 預勾；`generic`／`name-possible`／`other`／`unknown` 預設不勾；UI 以 `⚠` 標示（`:1513-1515`）。 |
| F10 | 送出單次提交 | `app.js:1620-1637` | `caCommit()` 只在標籤真的變動時 `Tags.restore(plan.nextSel)`；補充描述依 `extraMode` 處理；不碰 LoRA／尺寸／步數。 |
| F11 | A2 欄位不存在 | 全 repo `*.js` grep | `adoptionRecords`／`adoptionId`／`personalTriggers`／`promptSnapshot` **完全找不到**。D5 禁止的精確採用狀態目前沒有資料源。 |
| F12 | 作者／個人分離 | `app.js:2932-2945,2951-2967` | 建議詞只能經「加入」動作複製進 `triggers`；取消版本連結只清 `authorSuggestions.civitai`，個人詞與本機建議不變。`triggers` 是唯一注入欄位（審查報告 §7.4）。 |
| F13 | Civitai 探索無橋接 | `app.js:3656-3659,2474-2487` | 探索卡片只有 `cvOpenPreview`；未發現「加入本機／用這個角色」路徑。 |
| F14 | 未安裝引導已存在 | `app.js:2536-2543` | 本機空清單顯示「先到模型平台挑選…再放進 ComfyUI 的 LoRA 資料夾」＋外部連結＋重新整理。 |
| F15 | 沒有模型下載 | `app.js:1055` 的 `data-act="dl"` | 是**結果圖片下載**，不是 LoRA 下載。全檔無模型下載／安裝路由。 |
| F16 | 目前文案 | `index.html:208,276,277`、`app.js:1057,1488` | `自動加品質標籤`、`用同提示詞`、`分類套用`、`同提示詞`；分類套用 modal 標題實際是「按分類替換提示詞」。 |

**R1 補正輪新增事实 F17～F22**：為避免重複，完整表格見 §1.1.1；本輪所有組裝／對應／disabled 結論均以 F17～F22 為準（索引過期，未用 CodeGraph 下結論）。

**R2 補正輪新增事实 F23～F27**：完整表格見 §1.2.1；品質分類、標籤入口過濾、SHA256 逐候選比對與 Composer 架構結論均以 F23～F27 為準。

**與舊文件的差異（記錄，不擴大任務）**：`history-prompt-category-apply-investigation.md` §4.1 曾**建議 Model A**（目前為基底、歷史為來源），但 A3-R1／目前程式採 Model B。D4 明確**正式固定 Model B 且不得改回 Model A**，本報告據此設計；舊調查的建議被本決策覆蓋，僅記錄差異。

---

## 4. 六項決策對照表

| 決策 | 要求 | A3-R1 狀態 | A3-R2-R1 落實（含補正） | 依據 |
|---|---|---|---|---|
| **D1 完整還原** | 確認視窗；列出歷史 LoRA 名稱＋權重；告知目前將被取代；`loras:[]`＝清空；缺欄位＝保留；舊資料相容 | 已有「摘要確認」但**未列出每筆名稱／權重**，未明說三種欄位語意 | 新增確認 modal 規格（§7-C）：逐筆列 `display`＋`strength`，三種欄位狀態文案不同；**R4 補正：先讀→純資料摘要→確認→單次提交；取消完全不變** | F5／F6／§7-C |
| **D2 只帶文字** | 含標籤、補充描述、Negative；不碰 LoRA、尺寸／張數、步數／CFG／種子；記錄語意 | 只說「完全不碰 LoRA」，未列不碰欄位 | 明確操作語意表（§7-A）：六個不碰欄位；**R3 補正：Negative 三種情境明確定義，並標為產品決策建議（非授權）** | F5／§7-A |
| **D3 品質詞** | 一般單一開關；進階可查看／調整；舊品質標籤相容；不重複注入；不新增持久化權威；遵守唯一 Composer | 只提「合併為單一開關」，未處理進階能力與去重 | **R1 補正：唯一組裝入口＋唯一 `normalizeText` 去重規則；預覽／生成／歷史共用同一次結果；一般模式隱藏四類品質入口；舊 `sel` 不刪；不新增 key（§10）** | F17-F19／§10 |
| **D4 分類套用 Model B** | 歷史基底／目前替換；未勾保留歷史；候選預覽＋人工確認＋通用外觀不預勾；不得改回 A | 已建議保留 B，但未寫成正式決定 | 正式固定 B；標題與預覽方向文案固定；明確與舊 Model A 建議的差異（§3） | F8／F9／F10 |
| **D5 Trigger Words 狀態** | A2 未落地前不顯示精確「已採用」；不虛構追蹤；文字相同不算紀錄；可顯示「我的詞中也有這個詞」；建議唯讀、個人可編輯 | 提「已加入我的詞」標記，可能被誤讀為採用紀錄 | 改為即時比對的提示語，明說「不是採用紀錄、不會保存、**不記錄來源**」；不新增欄位（§8） | F11／F12／§8 |
| **D6 Civitai ↔ 本機** | 不暗示點擊即下載；不暗示已安裝；不自動採用建議；已安裝才進觸發詞設定；未安裝說明取得並放入資料夾；不新增下載／安裝 | 提「用這個角色」橋接，未定義安裝狀態分支 | **R2 補正：三層對應（SHA256→檔名大小→「可能相符」確認）；不自動 enabled；disabled 設定可開觸發詞但不進 Prompt；後端欄位需求見 §9.3** | F20-F22／§9 |

---

## 5. 修正後的一屏資訊架構【設計】

維持三層、沒有大型萬用彈窗；不同的「小視窗」職責單一。

```
┌─ 頂列：連線狀態 ／ 圖片反推 ／ 開啟資料夾 ／ 說明 ─────────────┐
├─ 左欄「我要畫什麼」──────────┬─ 中欄「成果」──────────┬─ 右欄「角色與輸出」────┤
│ ① 一句話描述 (#pos) 置頂、最大 │ 結果舞台（單圖／進度） │ 我的角色（LoRA卡片：     │
│ ② 挑標籤：角色／外貌／服裝／    │ 歷史縮圖條 (hover 摘要)│  名稱、第N個、權重、     │
│    動作表情／場景／畫風        │                       │  觸發詞狀態、自動加入） │
│    ※ 品質詞不在一般分類       │                       │ 加入角色（單一入口）     │
│ ③ 已選內容 chips（中文為主）  │                       │ 畫面大小／張數           │
│                              │                       │ 畫質加成（單一開關）     │
│                              │                       │ ▸ 進階（折疊）           │
├─ 底列：清除 ／【生成】／固定種子 ──────────────────────────────┤
```

**進階折疊（右欄 `▸`）**：不想要出現的東西（Negative）、品質詞「查看／調整」、完整提示詞（L1 字串＋可選 L2 組成）、步數／CFG／種子、API Key（標「通常不需要」）、輸出資料夾、顯示英文／成人標籤。

**職責单一的小視窗**（不互相合併）：歷史重用確認、分類套用、圖片反推、Civitai 探索、單一 LoRA 觸發詞設定。

**單一主動作**：底列「生成」。其餘按鈕一律標為「設定」或「次操作」；空狀態按鈕文案見 §9。

---

## 6. 五條完整使用者流程【設計】

### 流程 1：從空白建立畫面並生成（一般模式）
1. 左欄「用你自己的話描述想畫的東西」置頂；輸入「金髮女孩站在櫻花樹下」。
2. 即時提示只針對「目前不會進圖的字」，請點標籤代替；不顯示英文詞來源。
3. 點「挑角色／挑外貌／挑場景／挑畫風」六群組中的標籤；底列只顯示中文名，自動排序去重。
4. 右欄「畫質加成」預設開（一般使用者看不到品質標籤）；選尺寸／張數。
5. 按「生成」。組裝順序：品質（開關一組）→ 標籤 → 描述 →（本例無角色詞）。
6. 若完全沒選沒寫，同一顆按鈕顯示「幫我配一組標籤（你寫的描述會保留）」。

### 流程 2：加一個角色、查看建議詞、手動加入後生成（D5／D6）
1. 右欄「加入角色」→ 開啟「角色與模型」小視窗，含「本機」／「探索」兩個頁籤。
2. 本機頁籤選 `Amora` → 卡片出現在右欄，狀態「還沒給它觸發詞 · 設定」。
3. 點「設定」→ 觸發詞面板：①「模型檔案提供的建議（選填）」②「模型網站提供的建議（選填，可貼版本網址）」皆**唯讀**；③「我的詞（只有這些會進圖）」可增刪。
4. 建議群組旁固定小字：若文字與我的詞相同，顯示「我的詞中也有這個詞」（即時比對、不保存、不是採用紀錄）。**不顯示「已採用」**。
5. 使用者按「加入這組」→ 詞複製進「我的詞」；其他群組**不自動加入**。
6. 開關「把這些詞放進這張圖」預設開；按「生成」注入個人詞。若生成的當下仍無詞，指名 LoRA 提醒但不擋生成。

### 流程 3：同時使用多個角色
1. 已有「Amora（第 1 個角色，0.80）」，再按「加入角色」選第二個。
2. 卡片按加入順序標「第 1／第 2 個角色」；各有獨立權重與觸發詞狀態。
3. 點任一卡片的「設定」只影響該 LoRA；兩邊建議詞不混在一起。
4. 兩邊「我的詞」都注入正向；組裝時做一次文字去重、保留第一次出現順序。
5. 進階「查看這張圖實際送出的文字」可看到「角色詞重複已省略」的說明（不暴露欄位名）。

### 流程 4：從歷史把現在的內容換進舊圖（D4，Model B）
1. 目前畫面已選好新角色／新標籤；點歷史縮圖開燈箱。
2. 點「把現在的內容換進這張舊圖」（原「分類套用」）→ 小視窗一句話：「**以這張舊圖為底**，用現在勾選的分類換掉它；沒勾的都保留。」
3. 預覽兩欄：「會移除（這張舊圖的內容）」／「會帶入（現在的內容）」；髮色、眼睛、人數等通用外觀標 `⚠` 且預設不勾。
4. 使用者可取消任一候選；按「套用（移除 2、加入 3）」。
5. 單次提交標籤、補充描述依選擇保留／取代；燈箱關閉。**方向與 A2 契約無關，不碰 LoRA。**

### 流程 5：從歷史重用（三種方式，見 §7 完整規格）
1. 燈箱頂列分組三顆：`只帶文字`／`把現在的內容換進這張舊圖`／`完整還原（含角色）`。
2. 點「完整還原」→ 確認視窗列出歷史 LoRA 名稱＋權重，並依欄位狀態顯示「會清空／會保留／會取代」。
3. 確認後才套用；取消則一切不變。
4. 回到主畫面後可直接改描述或標籤再生成；文案不宣稱「完全重現」。

---

## 7. 歷史三種重用方式的操作規格【設計】

### A. 只帶文字（D2）

| 項目 | 規格 |
|---|---|
| 入口 | 結果卡「只帶文字」、燈箱「只帶文字」為**同一動作、不同文案** |
| 確認視窗 | 不需要（不破壞任何角色／數值）；以 toast 說明「已套用這張圖的文字，你的角色與設定都沒動」 |
| 帶入 | 歷史標籤（`sel`）、補充描述（`ui.extra`）、Negative（`neg`） |
| **完全不碰** | 目前 LoRA（`ui.loras`）、尺寸／張數、步數／CFG／種子、模型（`ckpt`）、排序模式以外的偏好 |
| Negative 語意 | **R3 補正**：三種情境明確定義（見下方 §7-A.1）；**此為產品決策建議，非已完成產品授權** |
| 舊資料相容 | 缺 `sel`／`extra`／`neg` 欄位時以空值處理但**不清除目前非目標欄位** |
| 完成反饋 | toast「已帶入文字；角色、大小、次數、步數、CFG、種子都沒變」 |

#### 7-A.1 Negative 三種情境（R3 補正，產品決策建議【PD1】）

| 歷史 `neg` 值 | 處理 | 使用者看到 | 依據 |
|---|---|---|---|
| 非空字串 | **覆蓋**目前 Negative（`$("#neg").value = it.neg`） | 「已帶入這張圖的負面詞」 | 現行 `app.js:1214` `if (it.neg)` |
| 空字串 `""` | **暫定保留**目前 Negative（不清除） | 「這張圖沒有記錄負面詞，你現在的負面設定保留」 | 現行 `if (it.neg)` 對空字串不成立 |
| 欄位不存在（舊紀錄） | **保留**目前 Negative，維持舊資料相容 | 「這張圖沒有記錄負面詞，你現在的負面設定保留」 | 現行 `if (it.neg)` 對 `undefined` 不成立 |

- 此規則是**沿用在程式行為的產品決策建議**，尚未取得明確產品授權；若要改成「空字串＝清空」，需另行決策並更新文案與測試。
- 介面必須避免讓使用者以為空值會清除：「只帶文字」的說明與完成 toast 都要明說**沒記錄負面時會保留目前的**；不可只寫「已套用 Negative」。
- 不修改 `ui.settings.neg` 的既有格式；Negative 仍為原字串（A2 契約 §7）。

### B. 分類套用（D4）

| 項目 | 規格 |
|---|---|
| 方向 | **歷史 Prompt 為基底，目前 Prompt 為替換來源**（Model B，正式固定，不得改回 Model A） |
| 未勾分類 | 保留歷史內容 |
| 保護層 | 候選預覽＋人工確認；通用外觀／可能角色名／未分類標 `⚠` 且預設不勾 |
| 不碰 | LoRA、尺寸／張數、步數／CFG／種子 |
| 完成反饋 | 「已移除 N、加入 M；沒勾的都保留」 |

### C. 完整還原（含角色 LoRA）（D1）

| 項目 | 規格 |
|---|---|
| 入口 | 燈箱「完整還原（含角色）」，**必須**先開確認視窗 |
| 確認視窗內容 | ① 標題「完整還原會換掉目前的角色」；② 逐筆列出歷史 LoRA「名稱＋權重（第 N 個）」；③ 依欄位狀態顯示三者之一；④ 兩個明確按鈕「取消」／「完整還原」 |
| `Array.isArray(it.loras)` 且非空 | 「會套用上面 N 個角色；**你現在的角色設定會被取代**」 |
| `it.loras: []` | 「這張圖沒有用角色 → **你現在的角色會被清空**」 |
| 缺 `loras` 欄位（舊紀錄） | 「這張圖沒有記錄角色 → **你現在的角色會保留**」；且不呼叫 `loraSave()` |
| 作者建議 | 沿用目前 LoRA 的最新 metadata，不讓舊資料回退（F7） |
| 取消 | 不寫入任何 localStorage、不變動 `S.loras`／`#pos`／`#neg` |
| 完成反饋 | 「已還原標籤、描述、負面與角色；順序照這張圖」 |

#### 7-C.1 確認與單次提交時序（R4 補正）

現行 `reusePrompt()`（`app.js:1210-1239`）先 `Tags.restore(it.sel)`、再改 `#pos`／`#neg`、最後才覆寫 `S.loras`，**沒有確認點**。本設計禁止在已修改部分資料後才顯示確認視窗。改成兩階段：

| 步驟 | 函式職責 | 允许 | 禁止 |
|---|---|---|---|
| ① 讀取 | `buildReusePlan(it)`：**純資料**，只讀 history item 與目前狀態，回傳 `{sel, extra, neg, loraAction, loraList, summary}` | 讀取、計算摘要 | 任何 DOM 寫入、`localStorage.setItem`、`loraSave()` |
| ② 確認 | 以 plan.summary 開確認 modal：列 LoRA 名稱＋權重、三種 `loras` 語意、兩個按鈕 | 顯示、取消、確認 | 修改 `S.loras`／`#pos`／`#neg`／`sel` |
| ③ 取消 | `closeModal()` 直接返回 | 關閉視窗 | `Tags.restore()`、`S.loras` 改動、`loraSave()`、任何 localStorage 寫入 |
| ④ 確認 | `commitReuse(plan)`：**單次提交**所有欄位，再一次 `loraSave()`（若 `loraAction !== "keep"`） | 一次性寫入 | 分多次部分提交、重新計算摘要 |

**測試條件（R4）**

| # | 案例 | 期望 |
|---|---|---|
| T1 | 非空 `loras` → 開確認 → 按取消 | `Tags.snapshot()`、`#pos.value`、`#neg.value`、`S.loras` 深度等於操作前；`localStorage` 所有 key 值不變；`loraSave()` 未被呼叫 |
| T2 | `loras: []` → 開確認 → 按取消 | 同 T1；確認文字含「你現在的角色會被清空」 |
| T3 | 缺 `loras` → 開確認 → 按取消 | 同 T1；確認文字含「你現在的角色會保留」 |
| T4 | 三種語意各自按「完整還原」 | 非空 → `S.loras` 等於 plan.loraList；空陣列 → `S.loras=[]`；缺欄位 → `S.loras` 與操作前深度相等且不呼叫 `loraSave()` |
| T5 | 確認後檢查 `#pos`／`#neg`／sel | 與 plan 完全一致，且只有一次提交（無中間狀態被看見） |

> 三種方式皆在既有小 modal／燈箱完成，不開新頁面；文案必須同時回答「哪些被替換／哪些保留／LoRA 是否還原」。

---

## 8. LoRA Trigger Words 的狀態及操作規格【設計】

### 8.1 狀態（A2 `adoptionRecords` 尚未實作）

| 狀態 | 呈現 | 使用者看到 | 系統行為 |
|---|---|---|---|
| 模型檔案建議 | 唯讀區塊＋「加入這組／加入這個詞」 | 「模型檔案提供的建議（選填）」 | 只更新建議，不碰我的詞 |
| 模型網站建議 | 唯讀區塊＋選填版本網址 | 「模型網站提供的建議（選填，可略過）」 | 取消連結只清來源，不刪個人詞 |
| **文字重複提示** | 建議詞旁的固定小字 | **「我的詞中也有這個詞」** | 即時比對文字得出；**不是採用紀錄、不保存、不產生 id** |
| 我的詞 | 可編輯 chips | 「我的詞（只有這些會進圖）」 | 增刪改即寫入既有 `triggers` |
| 自動加入 | 開關 | 「把這些詞放進這張圖（目前：開／關）」 | 關閉仍保存詞 |
| 不需要詞 | 確認狀態 | 「這個角色不用觸發詞」 | 加詞後自動取消確認（維持現行，UI 明說） |

### 8.2 禁止（D5）

- 不出現「已採用／採用來源／採用時間／採用編號」等精確字樣。
- 不新增 `adoptionRecords`／`adoptionId`／`personalTriggers` 欄位或任何等價持久化。
- **不把個人詞與建議詞文字相同當成採用紀錄**（那只是文字比對後的顯示提示）。
- 作者建議區塊永遠唯讀，不與個人詞放在同一個可編輯 list。
- 取消版本連結後，個人詞、本機建議、生圖行為都不變（F12 已具備）。

### 8.3 未來升級條件

僅當 A2 `adoptionRecords` 真正落地且有穩定 `adoptionId` 契約後，才把「我的詞中也有這個詞」升級為精確的單筆採用狀態；本輪不預留假狀態。

---

## 9. Civitai 探索至本機使用的完整流程【設計】（R2 補正）

### 9.0 現有欄位的事實（設計前提）

| 來源 | 現有欄位 | 沒有的欄位 |
|---|---|---|
| Civitai 搜尋結果（`server.py:946-959`） | `modelId`、`versions[].id`、`name`、`baseModel`、`trainedWords`、`files[].name`、`files[].sizeKB`、`files[].format`、`files[].primary`、**`files[].sha256`**（大寫、64 字）、`downloadUrl` | — |
| 本機 `/api/loras`（`server.py:1925`） | `name`、`display`、`sub` | **SHA256、檔案大小、Civitai model/version ID** |
| 本機 `/api/lora-meta`（`server.py:654-662`） | `title`、`architecture`、`description`、`networkDim`、`networkAlpha`、`resolution`、`triggerWords` | **SHA256、Civitai ID** |

> 前端 `CV.items` 保留 Civitai 的 `files[].sha256`（`app.js:2128`），但 `cvPaintPreview()` 只顯示訓練詞；**目前沒有任何本機端雜湊可與之比對**。因此「本機已安裝相同版本」這件事，現階段**無法被可靠證明**。

### 9.1 對應演算法（R2 補正：逐候選比對，hash 不同即排除）

**核心不變量**：兩個已知 SHA256 不同的檔案，**不得**因檔名相同而被判為「可能相符」。降級比對只發生在至少一側**沒有** hash 的候選。

```
輸入：選定的 Civitai 版本 v → files[]（最多 8 筆，見 F26）
      本機 LoRA 清單 → candidates[]（name / display / sub；未來可含 sha256 / size）

for each civitaiFile in v.files[]:        # 不假設只有 primary；primary 只是優先顯示/排序提示
  for each local in candidates[]:          # 每筆候選獨立比較
    if civitaiFile.sha256 && local.sha256:
       h1 = casefold(civitaiFile.sha256); h2 = casefold(local.sha256)
       if h1 === h2 → 標記 CONFIRMED（相同檔案；記錄 local.name / local.sub）
       else         → 標記 EXCLUDED（排除此 pair；**不做檔名降級**）
    else:
       # 只有這裡可用保守證據
       if normBasename(civitaiFile.name) === normBasename(local.name)
          && sizeMatches(civitaiFile.sizeKB, local.size)   # 有 size 時才比
          → 標記 POSSIBLE（可能相符；記錄檔名與 sub）
       否則 → 標記 EXCLUDED

彙總（R3 補正：優先順序由上而下；完整表見 §1.3.8）：
  ├─ ① 有 CONFIRMED → 狀態「本機找得到相同版本」
  │     · 列出所有 CONFIRMED 的本機路徑／subfolder
  │     · 若 >1 筆，仍列出全部並請使用者選；**不自動選第一筆**
  ├─ ② 無 CONFIRMED 但有 POSSIBLE → 狀態「可能相符，請你確認」＋候選清單
  ├─ ③ 無 CONFIRMED／POSSIBLE，但至少評估過一個 pair（全為 EXCLUDED，
  │     不論 hash 不同或檔名／大小不符）→ 狀態「本機找不到相同版本」
  │     · 可附「hash 不同 N 筆／檔名或大小不符 M 筆」；**不回退到 POSSIBLE**
  └─ ④ 沒有本機候選或沒有可用檔案資訊 → 狀態「本機還找不到」＋取得放置說明
        · **只有此分支可用「本機還找不到」**
```

**逐候選規則**

| 情境 | 處理 |
|---|---|
| 兩側都有 hash，且相同 | 大小寫無視（`casefold`）比對 → CONFIRMED；可確認相同檔案，但顯示對應的本機 `name`／`sub` |
| 兩側都有 hash，但不同 | **EXCLUDED，不得降級到檔名比對**；即使檔名相同也不可視為相符 |
| 其中一側沒有 hash | 才可用 **basename＋（有本機 size 時）size** 做保守比對 → POSSIBLE；subfolder 僅顯示，不是相符證據；不得宣稱相同版本 |
| 多筆同名候選 | 每筆獨立比較；不自動選第一筆；只有 hash 相同才顯示「相同版本」 |
| 多筆 CONFIRMED | 可確認相同檔案，但列出全部路径／sub 並請使用者選，不自動挑 |
| 所有 pair 最終都是 EXCLUDED（不論 hash 不同或檔名／大小不符） | 顯示「本機找不到相同版本」，不回退到 POSSIBLE；只有無候選／無可用資訊才用「本機還找不到」（§1.3.8） |
| 仍有候選缺 hash | 可顯示「可能相符」；永遠標明未確認 |
| primary file | 只是**排序／顯示優先提示**，不是唯一比對對象；primary 缺 hash 時仍要比其他 `files[]`；不得因 primary 缺 hash 就降級 |
| 大小寫 | hash 一律 `casefold()`；檔名 `NFC → casefold → basename` |
| 資料夾 | basename 比對；本機 `sub` 作為顯示脈絡，不參與相符判定 |
| `sizeKB` | 需先有本機 `size`（§9.3）；容忍四捨五入誤差（建議 ±1 KB），且僅用於 POSSIBLE，不單獨構成 CONFIRMED |
| 取消／未確認 | 不寫入任何 `ui.loras` |

> 本輪**不修改後端、不計算本機 hash、不新增 API**（§9.3 僅需求清單）。「相同版本」在目前資料下仍不可可靠證明，除非未來補上本機 hash。

### 9.2 已找到時的單次提交與 disabled 規則

1. **預設不自動啟用**：點「用這個角色」**絕不**把既有設定改成 `enabled:true`，也不呼叫任何「加入這張圖」動作。
2. 若該 LoRA 在 `ui.loras` 尚無任何設定，為了能打開觸發詞面板，允許建立一筆 `enabled:false` 的預設設定（沿用 `loraSet()` 既有格式與既有 key，見 F22）。
3. 該筆 disabled 設定**不會進入生成 Prompt／Workflow**：`loraSnapshot()` 只取 `loraEnabled()`，`loraTokensFromSnapshot()` 只處理 snapshot 內的詞（F22）。面板須明示「這筆設定還沒放進這張圖，不會影響生成」。
4. 使用者若要真的用這個角色，必須另外按明確的「把這個角色放進這張圖」才設 `enabled:true`（**獨立動作，獨立產品決策【PD7】**）。
5. 作者／metadata 建議詞一律唯讀，**不自動採用**到 `triggers`。

### 9.3 若要升級到 SHA256 對應：需要的欄位與修改範圍（本輪不實作）

| # | 需要 | 修改範圍 | 說明 |
|---|---|---|---|
| 1 | `/api/loras` 每筆增加 `sha256`、`size`（bytes） | `server.py::_loras()`／`fetch_lora_list()`；新增讀取 safetensors 檔的雜湊（可用標準庫分段讀取） | 只加欄位，不改 `name/display/sub` 既有格式 |
| 2 | 或新增 `/api/lora-hash?name=...` | `server.py` 路由分派＋測試 | 避免一次對全部檔案算雜湊；只在探索命中時按需取 |
| 3 | 路徑解析與邊界 | `comfy_lora_paths.py`（若需延伸到 LoRA 目錄） | 沿用既有白名單與路徑邊界，不放寬 |
| 4 | 前端比對與狀態 | `app.js` 對應函式＋devtools mock 測試 | 比對規則只有一處（§9.1），大小寫／資料夾／多筆命中共用 |
| 5 | 相容性 | 既有 `/api/loras` 消費者 | 新欄位為選用；舊前端忽略即可 |

> 本輪**只提出需求清單**；不新增路由、不計算雜湊、不修改 `server.py`／`comfy_lora_paths.py`。

### 9.4 操作規格與失敗分支

| 項目 | 規格 |
|---|---|
| 卡片動作 | 「用這個角色」；**文案不得暗示點擊會下載或已安裝** |
| 狀態文字 | 四種：①「本機找得到相同版本」（有 hash 相符）②「可能相符，請你確認」（缺 hash 的保守證據）③「本機找不到相同版本」（至少評估過一個 pair 且全為 EXCLUDED，不論原因）④「本機還找不到」（無本機候選或無可用檔案資訊）。**不使用「已安裝」「已下載」** |
| 已找到分支 | 依 §9.2：可建立 disabled 設定並開觸發詞面板；**不自動 enabled、不自動採用建議詞** |
| 可能相符分支 | 顯示候選與檔名，請使用者確認；未確認前不寫入任何 `ui.loras` |
| 找不到分支（③／④） | 原地顯示「這台電腦還沒有這個模型。請先取得模型檔案，放進 ComfyUI 的 LoRA 資料夾，再回來按『重新整理』。」＋重新整理；**沒有下載／安裝按鈕**。③ 另外標明「比對到的檔案內容不同」，④ 標明「本機還找不到」 |
| 探索失敗／多版本 | 保留既有版本網址流程；API Key 維持「進階」折疊，標「一般使用不需要」 |
| 禁止 | 不新增下載、安裝、登入或 gated 工作流程（F15；既有 Phase B2 未開始） |

---

## 10. 一般模式與進階模式的品質詞操作規格【設計】（R1 補正）

### 10.1 先確認的現有管線（設計前提）

1. 開關值只有 `ui.settings.quality` 一個布林（F3），**已經是持久化權威**。
2. 品質詞本身由 `QUALITY` 常數提供（F1）；同一批詞也存在於 `tags.js` 的「常用／quality」分組並進 `sel`（F2、F19）。
3. 目前**有三個組裝入口**：`Tags.buildPrompt()`（不含品質）、`composePrompt()`（只給預覽）、`snapshotNow()`（只給生成）；沒有共用出口（F17）。
4. A2 契約要求唯一 `PromptComposer.compose()`，每次生成只呼叫一次，同一結果給 payload／歷史／預覽，且明確禁止 `snapshotNow()` 自己再拼（F18）。
5. 因此本補正**推翻 A3-R2 §10 的「兩處各自去重」寫法**，改為單一组裝入口。

### 10.2 PromptComposer 最終架構（R4 補正：直接建立，不設過渡層）

**判斷：不採用 A3-R2-R1 的 `composeOnce()` 兩階段方案。** 理由：A2-R3 §647-682 與 A2-R4 §756-768 已把 Composer 的輸入／輸出／衍生順序／去重鍵定義完整；先做 `composeOnce()` 只是把 Composer 改名寫一次，去重規則、薄殼、測試都要寫兩遍，且容易形成第二套長期架構。Phase 1 **直接建立最小 `PromptComposer.compose()`**，一次到位。

```
持久化來源 ─┬─ ui.settings.quality（品質開關唯一權威）
            ├─ sel（含舊品質標籤）
            ├─ ui.extra → Dict.tr()
            └─ ui.loras（enabled + autoTrigger）
                   │
                   ▼
      【Legacy Adapter】derivePromptModel(state)
          → PromptModel { v:2, qualityTags, positive:Entry[], negativeRaw }
                   │
                   ▼
      【唯一入口】PromptComposer.compose(model)   ← A2 正式契約
          → { pos, neg, posHash, entries, effective }
          → disabled 過濾 + normalizeText 去重 + 依 order 升序
                   │
      ┌────────────┼────────────┬────────────────┐
      ▼            ▼            ▼                ▼
 /prompt payload  ui.gallery[].prompt  提示詞預覽   （A2 落地後）promptSnapshot
 （每次生成同一次結果；預覽呼叫同一 pure function）
```

**PromptModel／Legacy Adapter 範圍（R3 補正：完整 14 欄 PromptEntry，不可縮減）**

> 原「7 欄最小 PromptEntry 已足夠」的判斷**不成立**，已由 A2-R4 §6.1 完整 14 欄取代（見 §1.3.4）。Phase 1 可給預設值，但不得改名／刪除／改寫語意。

| 項目 | 契約範圍 |
|---|---|
| `PromptModel` | `{v:2, qualityTags:boolean, positive:PromptEntry[], negativeRaw:string}`；`PromptEntry[]` 是零至多筆陣列，**每筆**具 A2-R4 §6.1 完整 14 欄（14 是欄位數，不是筆數，見 §1.4.5）；不做版本化 snapshot 欄位（A2 尚未落地，F11），但 `negativeRaw` 必須保留 `#neg` 原值 |
| `PromptEntry` | **完整 14 欄**：`id, kind, owner, origin, text, weight, order, lora, disabled, raw, translated, untranslated, fragments, adoptionId`（逐欄語意見 §1.3.4） |
| `derivePromptModel(state)` | ① `sel` → tag entries（保留 `w` 與原順序）② `ui.extra` → **`translateWithFragments()`** → 每片段一筆 freetext entry（§1.3.5）③ `ui.loras` 依 **A2-R4 M1～M8** 取得 `personalTriggers`，**先正規化 `enabled`（`it.enabled !== false`）**；正規化後 `enabled===true` 時**每筆 personalTriggers 都建立 entry**，`autoTrigger===false` 者 entry `disabled:true`（仍存在，由 Composer 過濾）；正規化後 `enabled!==true` 不建立 entry（完整真值表見 §1.4.4）④ `ui.settings.quality===true` → quality entries（`QUALITY` 拆三筆，`order` 最前）⑤ 作者建議不進 entries |
| `compose(model)` | 過濾 `disabled`；`normalizeText` 去重；保留第一次出現（含 weight／origin）；`weight===null\|1.0` → 純文字，其餘 `(text:weight.toFixed(1))`；正負向各自獨立；Negative 依 A2-R4-R1 §4.4 產生 L2 但**不改寫 `negativeRaw`**；回 `{pos,neg,posHash}` 並附 `entries/effective` |
| 不納入 | 作者建議詞（唯讀，不進 entries，但可經「採用」複製成個人詞）；`promptSnapshot` 版本化 structure（待 A2 落地）；自然語言語意解析（A2 只做字串分隔／組裝） |

| 規則 | 規格 |
|---|---|
| 唯一性 | 只有 `PromptComposer.compose()` 會做文字組裝與去重；不再建立 `composeOnce()` 或任何第二個純計算入口 |
| 舊函式 | `Tags.buildPrompt()`／`composePrompt()`／`snapshotNow()` **逐步降為薄殼**：`snapshotNow()` 先呼叫 adapter＋composer 一次，再從結果取 `pos/neg` 連同 `sel/loras` 回傳；`composePrompt()` 改為同一 composer 的別名；`buildPrompt()` 只保留給不涉及品質的舊呼叫端，最終移除。**禁止各自做字串相加或去重**（F17、F18） |
| 每次生成呼叫次數 | **1 次**；同一結果給 `/prompt` payload、`ui.gallery[].prompt`、歷史 `prompt`（A2-R4 §766） |
| 預覽 | `showPromptModal()` 呼叫**同一個 `PromptComposer.compose()`**；相同狀態必須得到相同 `pos` |
| 去重鍵（唯一規則） | `normalizeText(text) = String(text\|\|"").normalize("NFKC").toLowerCase().trim().replace(/[_\s]+/g," ")`；保留第一次出現；quality 前綴也參與（A2-R4 §762） |
| 順序 | 輸出 Quality→Tag→Freetext→LoRA；去重後依 `order` 升序（A2-R4 §760、§763） |
| `promptSnapshot` | 現況尚不存在（F11），**不提前建立第二份快照**；A2 落地時直接由 compose 回傳值＋entries/effective 產生，不重跑 `Dict.tr()` |

> 若日後證明「完整 PromptModel 無法在 Phase 1 建立」，需回到本節重新評估；目前依 F17／F18 與 A2-R3／R4 契約，判斷**可直接建立**，故不列出 `composeOnce()` 的例外路徑。

### 10.3 品質詞與一般畫風的分類邊界（R1 補正）

**禁止**：`TagCategories.of(e)==="style"` 不得當作品質詞判定（F23）。`style` 在 `tag_categories.js:16` 的顯示名是「畫風品質」，141 筆中同時含一般畫風與品質詞；把整類隱藏會連 `anime coloring`／`watercolor_(medium)`／`art nouveau`／`cel shading`／`chibi`／`cyberpunk`／`fantasy`／`vibrant colors` 一起藏掉，違反需求。

| 類別 | 定義 | 例子 | 一般模式 |
|---|---|---|---|
| **quality（品質加成詞）** | 用來加成整體畫質／解析／精緻度，不是描繪具體內容 | `masterpiece`、`best quality`、`amazing quality`、`very aesthetic`、`absurdres`、`ultra-detailed`、`8k`、`clean sharp lines`、`sharp digital rendering`、`delicate rendering`、`high resolution digital illustration` | 從挑標籤入口隱藏，由開關統一注入 |
| **style（一般畫風／視覺表現）** | 描述畫風、技法、現實感、色彩表現，是使用者可選的內容 | `anime coloring`、`watercolor_(medium)`、`cel shading`、`chibi`、`cyberpunk`、`fantasy`、`vibrant colors`、`oil_painting_(medium)` | **正常顯示，可選** |
| 其他（`character`／`clothing`／…） | 與品質無關 | `1girl`、`long hair` | 正常顯示 |

**分類來源（可維護方案）**

- **首選（未來）**：在標籤 metadata 增加明確的 `quality` kind，例如 `tag_categories.js` 增加 `CATEGORIES.quality = "畫質加成"`，把上述 quality 詞從 `style` 改標為 `quality`，`TagCategories.of()` 回傳新值；**必須同步修改產生器 `tools/wd14-category-builder`**，否則重新產生會覆蓋。此變動涉及 repo 外的工具，本輪不實作（列 PD11）。
- **Phase 1 可行做法**：在前端建立**單一、明確、可測試的品質詞集合**（例如 `QUALITY_TAG_SET`），內容＝`QUALITY` 常數三詞 ∪ `tags.js`「常用」中上表列出的品質詞；由唯一個 `isQualityWord(tag)` 以 `norm()` 比對。此集合是**唯一的品質判定來源**，不是第二個持久化 key，也不進 localStorage；`ui.settings.quality` 仍是開關唯一持久化權威。
- 不得在 `groupItems()`、`renderTags()`、進階面板各自寫一份列表；一般模式與進階模式都呼叫同一個 `isQualityWord()`。

### 10.4 所有標籤入口的品質詞過濾（R2 補正）

過濾點只有一個：`renderTags()` 的共用資料來源 `L.filter()`（`tags.js:425-442`），**在任何分支之前**先套用 `if (generalMode && isQualityWord(x.e)) return false;`。這樣所有下游入口一次涵蓋，不需要在每個 UI 分支各寫判定。

| # | 顯示入口 | 資料流 | 一般模式 | 進階模式 |
|---|---|---|---|---|
| 1 | 「常用」前五 / `fav` 群組 | `L.filter` → `groupItems()` `:378-381,401-402` | 過濾 | 顯示 |
| 2 | `quality` 群組（原 `style` 混用） | `groupItems()` `:403` | 過濾（改以 `isQualityWord` 判定，不再用 `style`） | 顯示 |
| 3 | 一般分類 `cat:*` | `L.filter` `:441` → `groupItems()` `:408-412` | 過濾 | 顯示 |
| 4 | 搜尋結果 | `L.filter` `:429` 直接 return → `search` 群組 `:398-400` | **共用過濾已涵蓋**（此分支最先 return，最易漏） | 顯示 |
| 5 | 我的收藏 `__fav__` | `L.filter` `:436-439` 由 `stats.tags[].favorite` 挑選 | **共用過濾已涵蓋**：收藏中的品質詞不出現在新增入口 | 顯示 |
| 6 | 我的常用 `__top__` | `L.filter` `:440` `usage>0`，再排序 `slice(0,20)`（`:444-445`） | **共用過濾必須在排序／截斷前**，避免品質詞擠掉其他標籤 | 顯示 |
| 7 | 分類頁籤計數 `__fav__`／`__top__` | `renderCats()` `:322-332` **獨立於 `L.filter()` 的 `stats.tags` 迴圈**（F28）；用 `CANON_ONLY` 避免別名重複計數 | **必須另外呼叫同一 `isQualityWord(k)` 排除品質詞**；文案標「可選 N」；不可宣稱被 `L.filter()` 自動涵蓋 | 完整，標「全部 N」 |
| 8 | 反推結果／分類套用候選／歷史 tooltip | 各自資料來源（非挑標籤入口） | **不過濾**：這是呈現／稽核，不是新增入口 | 不過濾 |
| 9 | 已選 chips `selBar` | `renderSel()` `:537-548` 直接讀 `state.sel` | **不過濾**：已選品質詞仍顯示、可調權重／移除、仍進 Prompt | 同左 |
| 10 | 隨機組合池 | `buildPools()` `:651` 原本排除常用 | 不變（品質標籤不進隨機池） | 不變 |

**不變式**：一般模式隱藏的是「新增／選取入口」，不是刪除使用者資料。舊 `sel` 中的品質標籤不被刪除、不被覆寫、仍顯示於已選 chips 並參與 Composer 組裝；收藏／常用中的品質詞只是暫時不出現在挑標籤面板，資料本身保留。

### 10.5 操作規格

| 項目 | 一般模式 | 進階模式 |
|---|---|---|
| 可見 | 只有「畫質加成（推薦開啟）」開關；§10.4 十個入口中的新增入口全過濾 | 開關旁「查看／調整品質詞」可展開 |
| 查看 | 不顯示 | 唯讀顯示目前會注入的品質詞（由 `PromptComposer.compose()` 的 `entries` 計算） |
| 調整 | 只能開／關 | 在進階「品質與細節」分組增刪品質標籤（寫入既有 `sel`）＋開關；**不提供自訂字串新欄位**【PD3】 |
| 底層 | `ui.settings.quality`（既有 key） | `sel`（既有 key）；不新增任何 key |
| 注入規則 | 開時注入一組品質詞；關時不注入 | 手動品質標籤照 `sel` 注入；與開關同詞時由**唯一去重點**只保留第一次 |
| **舊 `sel` 相容** | 舊 `sel` 內的品質標籤**不刪除、不覆寫、仍生效**；只是從新增入口隱藏，已選 chips 仍顯示並參與 Composer 組裝 | 舊品質標籤照常可見、可刪 |
| 持久化權威 | 只有 `ui.settings.quality` 與 `sel` 兩個既有 key；`isQualityWord`／去重皆為純計算，**不寫入、不新增 key** | 同左 |
| 畫風標籤 | `anime coloring`／`cel shading`／`chibi`／`fantasy` 等一般畫風**不過濾、可選** | 同左 |

> 不新增持久化資料權威：開關用 `ui.settings.quality`，品質標籤用 `sel`，兩者都是既有 key；判定與去重都是純計算。

---

## 11. 中文介面文案總表【設計】

| 位置 | 目前（F16） | 建議文案 | 決策 |
|---|---|---|---|
| 左欄主輸入標題 | 補充描述 | 用你自己的話描述想畫的東西 | A3-R1 |
| 左欄提示 | 這些中文還沒對應標籤 | 這些字目前不會進圖，點一下找標籤代替： | A3-R1 |
| 品質開關 | 自動加品質標籤／masterpiece, best quality… | 畫質加成（推薦開啟） | D3 |
| 品質進階 | （無） | 查看／調整品質詞 | D3 |
| 一般畫風入口 | 風格／quality 群組混用 | 動漫上色、水彩、賽璐璐、Q版、奇幻等畫風照常可選（不受畫質開關影響） | D3／R1 |
| 一般標籤群組 | 常用／人物／頭髮… | 挑角色／挑外貌／挑服裝／挑動作表情／挑場景／挑畫風 | A3-R1 |
| 負面區標題 | 負面提示詞 | 不想要出現的東西（選填） | D2 |
| 「只帶文字」說明（ Negative 空值） | （無） | 若這張圖沒有記錄負面詞，會保留你現在的負面設定；不會清空。 | D2／R3【PD1，非授權】 |
| LoRA 區標題 | 角色 LoRA | 我的角色 | A3-R1 |
| LoRA 加入入口 | 探索／選擇 | 加入角色（內含「本機」／「探索」頁籤） | D6 |
| LoRA 卡片狀態（無詞） | 尚未確認觸發詞 | 還沒給它觸發詞 · 設定 | A3-R1 |
| 卡片狀態（有建議） | 有待加入的作者建議 N | 作者有 N 個建議（選填） | D5 |
| 觸發詞面板標題 | 我的 Trigger Words／本機 metadata 建議／Civitai 作者建議 | 我的詞（只有這些會進圖）／模型檔案提供的建議（選填）／模型網站提供的建議（選填） | D5 |
| 文字重複提示 | （無） | 我的詞中也有這個詞（不會另外保存） | D5 |
| 禁止出現 | — | ~~已採用／採用來源／採用編號~~ | D5 |
| 自動加入開關 | 自動加入提示詞 | 把這些詞放進這張圖 | A3-R1 |
| 不需要詞 | 這個模型不需要觸發詞 | 這個角色不用觸發詞 | A3-R1 |
| 取消版本連結 | 取消版本連結 | 取消版本連結（不會刪掉你自己的詞） | D5 |
| 結果卡「同提示詞」 | 同提示詞 | 只帶文字 | D2 |
| 燈箱「用同提示詞」 | 用同提示詞 | 完整還原（含角色） | D1 |
| 燈箱「分類套用」 | 分類套用 | 把現在的內容換進這張舊圖 | D4 |
| 分類套用 modal 標題 | 按分類替換提示詞 | 把現在的內容換進這張舊圖 | D4 |
| 分類套用說明 | 以這張歷史圖片為基底… | 以這張舊圖為底，用現在勾選的分類換掉它；沒勾的都保留 | D4 |
| 完整還原確認標題 | （無確認視窗） | 完整還原會換掉目前的角色 | D1 |
| 完整還原確認（非空） | — | 會套用上面 N 個角色（第 1 個 Amora 0.80…）；**你現在的角色設定會被取代** | D1 |
| 完整還原確認（空陣列） | — | 這張圖沒有用角色 → **你現在的角色會被清空** | D1 |
| 完整還原確認（缺欄位） | — | 這張圖沒有記錄角色 → **你現在的角色會保留** | D1 |
| 完整還原取消按鈕 | （無） | 取消（什麼都不會改變） | D1／R4 |
| Civitai 卡片動作 | （無） | 用這個角色 | D6 |
| 未安裝引導 | 本機還沒有角色 LoRA… | 這台電腦還沒有這個模型。請先取得模型檔案，放進 ComfyUI 的 LoRA 資料夾，再回來按「重新整理」。 | D6 |
| 探索狀態（SHA256 相符） | — | 本機找得到相同版本 | D6／R2 |
| 探索狀態（檔名疑似） | — | 可能相符，請你確認（不會自動加入這張圖） | D6／R2 |
| 探索狀態（hash 不同） | — | 本機找不到相同版本（比對到的檔案內容不同） | D6／R2 |
| 探索狀態（找不到） | — | 本機還找不到（不用「已安裝／已下載」） | D6／R2 |
| 探索按了之後 | — | 這筆設定還沒放進這張圖，不會影響生成 | D6／R2 |
| 生成按鈕（空） | 幫我配一組 | 幫我配一組標籤（你寫的描述會保留） | A3-R1 |
| 完整提示詞 | 完整提示詞 | 查看這張圖實際送出的文字 | A3-R1 |

---

## 12. A2 資料契約相容性檢查

| # | A2 契約／欄位 | 本設計是否衝突 | 說明 |
|---|---|---|---|
| 1 | 衍生 PromptModel、不新增持久化權威 | 不衝突 | D3 明確沿用 `ui.settings.quality`＋`sel`，不新增 key |
| 2 | PromptComposer 唯一組裝 | **R2 補正後不衝突** | Phase 1 直接建立 `PromptComposer.compose()`＋Legacy Adapter；不設 `composeOnce()` 過渡層；每次生成只呼叫一次，payload／歷史／預覽共用（§10.2、F18） |
| 3 | 四類資料分離 | 不衝突 | 品質／標籤／描述／角色詞分區呈現 |
| 4 | `personalTriggers` 唯一注入 | 不衝突（目前欄位是 `triggers`） | D5 不建立第二個注入欄位 |
| 5 | `authorSuggestions` 唯讀 | 不衝突 | 只提供「加入」複製到 `triggers` |
| 6 | `adoptionRecords` UUID＋取消不刪個人詞 | 不衝突 | D5 **不顯示**精確狀態、不虛構 id；等 A2 落地再升級 |
| 7 | Negative L1 原字串、不假設解析 | 不衝突 | 進階區仍原字串；R3 補正明確三種 `neg` 情境（§7-A.1），且不解析內容 |
| 8 | 版本化 `promptSnapshot` | 不衝突 | F11 顯示尚未實作；文案避免「完全重現」 |
| 9 | 舊資料漸進相容 | 不衝突 | D1 三種 `loras` 欄位狀態皆保留舊行為（F6） |
| 10 | Quality→Tag→Freetext→LoRA 順序 | 不衝突 | 開關只控制一組品質詞，不改順序 |
| 11 | `order` 全域、正負各自 0 起 | 不衝突 | UI 不重排歷史 |
| 12 | 不保證同圖 | 不衝突 | 文案不承諾重現 |
| 13 | 備份 key `ui.loras.migrationBackup`／`.corrupt` | 不衝突 | 本設計不碰遷移備份雙 key |
| 14 | 去重鍵 `normalizeText`（A2-R4 §762） | **R2 補正後不衝突** | 直接寫在 `PromptComposer.compose()` 內，使用 A2 同一 NFKC→lower→trim→`[_\s]+`→空白規則，保留首次，quality 前綴參與；前端不另寫第二套 |
| 15 | `enabled===true` 的 LoRA 才進 lora-trigger（A2-R4 §760） | **R4 補正後不衝突** | 正規化後 `enabled===true` 才建立 entry；`autoTrigger===false` 者 entry 仍存在但 `disabled:true`（§1.4.4）。探索→本機只建立／沿用 `enabled:false` 設定，不進 Prompt／Workflow（§9.2、F22）；自動啟用列 PD7 |
| 16 | 每次生成只有一次 `compose()`（A2-R4 §766） | **R2 補正後不衝突** | `snapshotNow()` 不再自己拼字串；改呼叫 `PromptComposer.compose()` 一次（§10.2） |
| 17 | PromptModel／quality 詞分類 | 不衝突 | quality 集合是前端判定與 Composer 輸入的單一來源；不新增持久化 key；一般畫風不因 `style` 被誤隱藏（§10.3、F23） |
| 18 | PromptEntry 14 欄（A2-R4 §6.1） | **R3 補正後不衝突** | Phase 1 使用完整 14 欄；`id`≠Snapshot `entryId`；`owner`∈{user,system}；`origin` 無 `personal`；`adoptionId:null`（§1.3.4） |
| 19 | `translateWithFragments`（A2-R4 §5.3） | **R3 補正後不衝突** | `ui.extra` 逐片段衍生，保留 `raw/translated/untranslated/fragments`；Snapshot 不重跑 `Dict.tr()`（§1.3.5） |
| 20 | v1→v2 M1～M8（A2-R4 §6.3） | **R3 補正後不衝突** | Legacy Adapter 遵循 A2 遷移，自分辨 M1 缺失與 M2 有效空陣列；不自行轉換（§1.3.6） |
| 21 | Negative L1／L2（A2-R4-R1 §4） | **R3 補正後不衝突** | `negativeRaw` 原樣為 L1 權威；Composer 只產 L2；衝突時以 A2-R4-R1 最終修正為準（§1.3.7） |

---

## 13. Phase 順序與各階段驗收條件／風險

> 以下為**後續實作建議**，本輪不執行。

### Phase 1（P0，防止資料與預期損失）

| 項目 | 內容 |
|---|---|
| 範圍 | ① **直接建立最小 `PromptComposer.compose()`＋Legacy Adapter**（R4），不設 `composeOnce()`；② D1 完整還原「先讀→摘要→確認→單次提交」；③ D2 只帶文字＋Negative 三情境；④ 明確 quality 集合＋所有新增入口共用過濾（R1／R2），一般畫風不過濾 |
| 驗收條件 | 完整清單見 §1.3.10 A1～A7：① PromptEntry 輸出 **14 欄**，`id`≠Snapshot `entryId`；② freetext 每片段保留 `raw/translated/untranslated/fragments`，未譯詞不進 `pos`；③ 正規化後 `enabled!==true` 無 entry、`enabled===true` 每筆 personalTriggers 都有 entry，`autoTrigger===false` 保留詞但 entry `disabled:true`（仍存在），M1～M8 有測試且 M1≠M2；④ `negativeRaw` 逐位元組等於 `#neg`，Composer 只產 L2，`unparsed` 保留 token；⑤ 一般模式 `renderTags()` 與 `renderCats()` 都呼叫同一 `isQualityWord()`、頁籤標「可選 N」，一般畫風仍可選、舊 `sel` 品質詞不刪；⑥ 每次生成只呼叫一次 Composer，payload／gallery／預覽 `pos` 逐字相同；⑦ 完整還原取消後所有狀態深度不變（T1～T5）；⑧ 不新增 localStorage key |
| 風險／緩解 | 中高：直接建立 Composer 需同時處理 Adapter 與薄殼，需回歸生成／歷史／WD14／預覽；以 `node --check`＋devtools 契約測試＋真實生成 1 張 1024 驗證；品質集合需有單元測試逐詞驗證 |

### Phase 2（P1，來源可理解）

| 項目 | 內容 |
|---|---|
| 範圍 | D4 分類套用 Model B 文案固定；D5 觸發詞「我的詞中也有這個詞（不記錄來源）」；D6 Civitai→本機**逐候選 SHA256 比對**與 disabled 規則（R3）；Negative 移到進階 |
| 驗收條件 | ① 分類套用小視窗方向文案與 Model B 一致；未勾分類保留歷史；通用外觀預設不勾；② 畫面不出現「已採用」字樣；③ 文字相同時只出現「我的詞中也有這個詞」，並標明不保存、不記錄來源；④ 取消版本連結後個人詞仍在；⑤ 探索卡片只有四種狀態文字，未找到時沒有下載／安裝按鈕；⑥ **兩側 hash 相同才「相同版本」，不同即排除且不降級；無 hash 才可能相符；多筆同名逐筆比較、不自動選；所有 pair 皆 EXCLUDED（不論原因）→「本機找不到相同版本」，無候選／無可用資訊才用「本機還找不到」（§1.3.8）；⑦ 點「用這個角色」後既有 `enabled` 不變，新建立者 `enabled:false` 且不在生成 Prompt／Workflow；⑧ 建議詞未自動加入**；⑨ API Key 仍在進階折疊 |
| 風險／緩解 | 中高。SHA256 分支需先補後端欄位（§9.3），未補前只能走「可能相符」；需與 A2 `adoptionRecords` 落地時程對齊。以 mock Civitai＋假本機清單（含同名不同 hash）＋真 DOM 測試驗證所有分支與 disabled 不注入 |

### Phase 3（P1/P2，重用可信與版面）

| 項目 | 內容 |
|---|---|
| 範圍 | D3 進階「查看／調整品質詞」；完整提示詞 L1／可選 L2；歷史 tooltip；多角色順序標示；空狀態文案 |
| 驗收條件 | ① 進階可唯讀看到去重後的品質詞，且增刪走既有 `sel`；② `document.scrollHeight <= innerHeight`、無橫向捲動、右欄 `scrollHeight === clientHeight`；③ hover 不改變元素尺寸；④ 1366×768 與 1920×1080 皆一屏（用同源 iframe 量測，不靠目測） |
| 風險／緩解 | 中。進階區可能撐高右欄；折疊預設收合並保留固定空間 tooltip |

### Phase 4（後續，A2 落地後）

| 項目 | 內容 |
|---|---|
| 範圍 | `adoptionRecords` 精確狀態；`promptSnapshot` 版本化呈現；備份保留天數；PD1／PD7～PD11 定案；若接受 PD11，把 quality kind 寫回標籤 metadata 並同步產生器 |
| 驗收條件 | ① 只有在有真實 `adoptionId` 時才顯示精確採用狀態；② 舊資料仍能降級顯示粗略提示；③ 備份清理僅限 confirmed＋保留期＋明確動作 |
| 風險／緩解 | 中高，取決於 A2 何時落地；本輪不預留假狀態、不先改資料結構 |

---

## 14. 尚未解決問題與需產品負責人決策

| # | 項目 | 類型 | 本報告暫定 |
|---|---|---|---|
| PD1 | 「只帶文字」遇到歷史 `neg` 為空字串：保留目前 Negative 還是清空？（R3） | **產品決策建議，未授權** | 非空→覆蓋；空字串→保留；欄位不存在→保留。**尚未取得產品授權**，不得當成既定行為；見 §7-A.1 |
| PD2 | A3-R2 原「點用這個角色就自動 enabled」是否保留？ | **已由 R2 否決** | 否；改為預設不自動 enabled（§9.2）。舊 PD2 作廢 |
| PD3 | 進階品質詞是否允許自訂字串（會擴充 `ui.settings` 的品質欄位）？ | PD | 否；只允許既有品質標籤增刪＋開關，避免新增權威 |
| PD4 | 分類套用正式 Model B 與 2026-11-24 調查建議 Model A 的取捨 | 已裁決 | 依本任務固定 Model B；舊建議僅記錄差異，不改回 |
| PD5 | A2 `adoptionRecords`／`promptSnapshot` 的落地時程 | 時程 | 未定；落地前只做粗略提示 |
| PD6 | 遷移備份保留天數（A2-R4-R1-R1 PD2） | PD | 建議 30 天 |
| PD7 | 探索→本機找到後，是否提供「把這個角色放進這張圖」的獨立 enabled 動作？ | PD | 建議提供，但**必須是獨立按鈕**；預設仍不 enabled（R2b） |
| PD8 | 為了開觸發詞面板而建立 `enabled:false` 的 `ui.loras` 設定，是否可接受此寫入？ | PD | 建議可接受（既有 key／既有格式、不進 Prompt）；若不可接受，改為「只讀預覽觸發詞」且不寫入 |
| PD9 | 本機端 SHA256 何時補？（決定能否顯示「相同版本已確認」） | 時程／PD | 建議先維持「可能相符，請你確認」；欄位需求見 §9.3 |
| PD10 | `sizeKB` 容忍誤差（建議 ±1 KB）是否可接受？ | PD | 建議可接受；僅做「可能相符」加分，不單獨構成確認 |
| PD11 | 是否把 `quality` kind 寫進 `tag_categories.js` metadata（並同步 repo 外產生器）？ | PD／時程 | 首選長期方案；Phase 1 先用單一明確集合（§10.3）；未同步產生器前不得改 metadata，否則重新產生會覆蓋 |
| PD12 | quality 詞集合的邊界：`detailed`／`very aesthetic`／`absurdres` 等是否全算品質加成？ | PD | 暫採「常用前五＋明確畫質／解析詞」；一般畫風一律不算；需產品確認清單 |
| PD13 | 一般模式頁籤數字顯示「可選數」還是「總收藏／總使用數」？ | PD | 建議可選數＋文案「可選 N」；若保留總數必須明確標「總收藏」，不得讓數字被當成可選數（§1.3.3） |
| PD14 | 是否讓 Composer 真正輸出 `effectiveNegative` 為 `text.neg`（升級 `composerVersion`）？ | PD | 否；維持 A2-R4-R1 §159 最終修正的 L2 定位（§1.3.7） |
| U7 | 標籤 metadata 產生器（`tools/wd14-category-builder`）目前實際位置與輸出格式未查核 | 未驗證 | 本輪唯讀且屬 repo 外工具；PD11 實作前須先查核 |
| U8 | `translateWithFragments()` 與 `Dict.tr()` 在極端跨片段去重的等價性 | 未驗證 | 依 A2-R4 §549，以 `text.pos` 為唯一真相 |
| U9 | 真實 localStorage 的 v1／v2 混存情形 | 未驗證 | 本輪唯讀，不碰使用者資料；M1～M8 尚未被程式驗證 |
| U10 | 1366×768 一屏與頁籤文案（可選 N／全部 N）長度 | 未驗證 | 實作階段量測 |
| U1 | 真實 localStorage 未檢視：使用者現有 `sel`／`ui.loras` 是否有異常格式未知 | 未驗證 | 本輪唯讀，不碰使用者資料 |
| U2 | 1366×768 的一屏表現未實測 | 未驗證 | 實作 Phase 3 時以 iframe 量測 |
| U3 | 未做一般使用者訪談／可用性測試 | 未驗證 | 所有結論從程式碼與既有報告推導 |
| U4 | CodeGraph 索引過期（Added 5／Modified 6） | 工具 | 依禁令未 sync；行號以磁碟為準 |
| U5 | 本輪未實際操作 LoRA 彈窗／分類套用對話（唯讀設計任務） | 未驗證 | 相關感受屬設計推論 |
| U6 | Civitai 實際回傳的 `files[].sha256` 在大寫與大小寫混合時的穩定性 | 未驗證 | 既有審查報告記錄為大寫；比對時一律大小寫無視（§9.1） |

---

## 15. 未執行事項及原因

以下皆**未執行**，原因為本輪（A3-R2-R2）為唯讀設計任務且明確禁止：修改任何程式碼／測試／HTML／CSS／JavaScript／Python／PowerShell／設定／既有報告／AGENTS／README；修改 A2 原始契約；修改 localStorage 或使用者資料；操作 LoRA／模型／使用者圖片；啟停正式服務；生圖或操作 GPU；`codegraph sync`／`index`；任何 Git 寫入（Stage／Commit／Push／Reset／Restore／Stash／Checkout／Clean）；以瀏覽器進行需要寫入的實測。

本輪**只更新本報告**（同一檔案補正，未新增第二份報告），**未開始 A3 Phase 1**，依任務指示在完成報告後停止，等待 ChatGPT 再次獨立審查。

---

## 16. Git 開始／結束狀態

### 開始（A3-R2-R2，本輪重新查詢）

| 項目 | 結果 |
|---|---|
| Repository | `C:/ComfyUI/simple_ui`（`-C` 指定，未查上游） |
| Branch | `main` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 同址） |
| Ahead / Behind | `1` / `0` |
| `git status --porcelain` | `modified=15`、`staged=0`、`untracked=65`、`total=80` |
| Modified tracked（15） | `AGENTS.md`, `app.css`, `app.js`, `devtools/lora_api_test.py`, `devtools/lora_core_test.mjs`, `devtools/lora_explorer_api_test.py`, `devtools/lora_explorer_core_test.mjs`, `devtools/lora_mock_civitai.py`, `devtools/lora_ui_test.mjs`, `devtools/test_ui_control_wd14.ps1`, `index.html`, `server.py`, `ui_control.ps1`, `ui_panel.ps1`, `ui_panel.pyw` |

### 結束（本報告更新後實際執行）

- `git status --porcelain`：`modified=15`、`staged=0`、`untracked=65`、`total=80`——**與開始時完全相同**。
- 本輪**沒有新增檔案**：只更新既有 untracked 報告 `devtools/reports/prompt-tag-system-a3-r2-ux-design.md`（A3-R2 已建立），未新增第二份報告；所有既有 modified／untracked 項目完全未動。
- `git diff --check`：`exit 0`；兩個既存 CRLF 警告（`devtools/lora_api_test.py`、`devtools/lora_core_test.mjs`）與本輪無關，未做任何轉換。
- Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、Ahead 1／Behind 0 不變；**未執行任何 Git 寫入**（Stage／Commit／Push／Reset／Restore／Stash／Checkout／Clean）。

**A3-R2-R3 補正輪查核**：本輪開始與結束皆為 `modified=15`、`staged=0`、`untracked=65`、`total=80`；`git diff --check` `exit 0`（兩個既存 CRLF 警告 `devtools/lora_api_test.py`、`devtools/lora_core_test.mjs` 與本輪無關）。Branch／HEAD／Remote／Ahead 1／Behind 0 不變；**只更新本報告，未新增檔案**。

**A3-R2-R4 補正輪查核（本輪）**：開始與結束皆為 `modified=15`、`staged=0`、`untracked=65`、`total=80`；Branch `main`、HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`、Remote `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`、Ahead 1／Behind 0。`git diff --check` **exit 0**（兩個既存 CRLF 警告與本輪無關）。**只更新本報告，未新增檔案，未執行任何 Git 寫入。**

---

## 17. 正式服務是否受到影響

**沒有**。未停止／重啟 ComfyUI（8188）、simple_ui（7860）或 WD14 Worker；未送出 HTTP／WebSocket 請求、未生圖、未操作 GPU、未讀取 API Key／Cookie／憑證、未修改使用者資料。本輪外部動作只有唯讀 `codegraph status`、唯讀 Git 查詢與讀取本機原始碼；**未使用瀏覽器工具**。本報告為純 Markdown，不影響執行期行為。

---

## 18. 給 ChatGPT 獨立審查重點

1. **R1**：`renderCats()` 計數改用「可選 N」是否會讓使用者誤以為收藏消失（PD13）？是否該保留「總收藏」並同時顯示可選數？
2. **R2**：PromptEntry 完整 14 欄是否在 Phase 1 全數可取得？`author-civitai`／`author-local` 的 `origin` 在沒有真實 `adoptionId` 時應如何標記而不虛構？
3. **R3**：`translateWithFragments()` 與 `Dict.tr()` 在跨片段去重時可能不等價（U8）；以 `text.pos` 為唯一真相是否足夠？
4. **R4**：A2-R4 M1～M8 在 Phase 1 只做「讀取時記憶體衍生、不寫回」是否可接受？`migration.backup` 雙 key 是否需同步啟動？
5. **R5**：A2-R4 §761 與 A2-R4-R1 §159 的 Negative 衝突，本輪採用後者；是否需正式通知產品／更新 A2？PD14 是否要維持「不升級 composerVersion」？
6. **R6**：所有 pair 皆 EXCLUDED → 「本機找不到相同版本」是否清楚？「hash 不同 N 筆／檔名或大小不符 M 筆」是否要顯示給一般使用者？
7. D1～D6 維持不變；PD1／PD7／PD8／PD11～PD14 未授權；是否需要在報告外另外通知產品負責人？

---

**結論（最新：A3-R2-R4）**：A3-R2-R4 完成第四輪定點補正，並以 §1.4 為最新權威：（1）統一 autoTrigger 規則——先正規化 `enabled`，正規化後 `enabled===true` 時每筆 `personalTriggers` 都建立 entry，`autoTrigger` 只決定 `disabled`（`false` 仍建立 entry），Composer 過濾 `disabled:true`，個人詞不刪；（2）舊的 PromptEntry 括號 14 寫法全面改為 `PromptEntry[]`，14 是每筆欄位數而非筆數；（3）Positive 只含 tag／lora-trigger／freetext／quality，Negative L1＝`negativeRaw`＝`text.neg`，L2＝`negativeEntries`／`effectiveNegative`／`negativeParse`，兩者分開；（4）舊 `enabled` 缺欄位依 `it.enabled !== false` 正規化為 `true`，新建 LoRA 預設仍 `enabled:false`，兩者分明。前三輪成果（品質分類與計數、A2 契約 14 欄、fragments、M1～M8、Negative L1/L2、SHA 四態）保留。D1～D6 產品決策不變，PD1／PD7／PD8／PD11～PD14 未授權。本輪**只更新本報告**，未修改任何既有檔案、未執行 Git 寫入、未影響正式服務，**明確不開始 A3 Phase 1**。
