# Prompt 來源與套用流程 UX 研究

日期：2026-11-27（Asia/Taipei）
性質：唯讀調查與 UX 設計；本報告為本次唯一新增工作成果。

## 1. 目標與範圍

釐清目前提示詞、歷史圖片提示詞、WD14 反推候選之來源、目標、替換／追加／還原語意與資料寫回位置；檢視 A3 Prompt Composer 整合；提出兩種 UI 方向與推薦示意。遵守既有分類套用 Model B、A3/A2 契約與 WD14「分析→候選→選取→加入」概念。

只讀程式、規範與既有設計文件，查閱官方競品文件，新增本報告。未修改正式程式、設定、使用者資料；未讀寫 localStorage、啟停服務或 Worker、呼叫生圖／反推 API、執行 GPU 工作或 Git 寫入。CodeGraph 未同步，查詢用來定位，變更中的程式以本機當前內容補核。

## 2. 開始前 Repo 紀錄

- Repository：`C:\ComfyUI\simple_ui`（依根 AGENTS 指示；忽略上游 ComfyUI repo）
- Branch：`main`
- HEAD：`cf5609e0cfbd69163247786f1f50dbf8e600c090`（HEAD -> main）
- Remote：`origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push）
- 對遠端狀態：起始 `main...origin/main [ahead 1]`；本次未 fetch，behind 狀態未重新確認。
- Git status：起始無 staged 變更；17 個 tracked modified paths，另有多筆 untracked paths（包含 `prompt_core.js`、提示詞測試、A3/A2/LoRA/歷史報告等）。完整清單是開始前 `git status -sb` 輸出；均為既有工作，本次沒有覆蓋或整理。
- 主要既有 tracked 修改包括 AGENTS、app.css/app.js/index.html/server.py/tags.js、多個測試與控制台檔。未追蹤報告目錄內也已有數十份文件。
- CodeGraph：`C:\ComfyUI` 根目錄未初始化；在實際 repo 查得 35 files、1,094 nodes、4,837 edges，pending Added 11 / Modified 8。依規範唯讀任務不執行 sync/index；索引有落差，以下關鍵流程以磁碟目前版本為準。
- 規範：讀取 `C:\ComfyUI\AGENTS.md`、`C:\ComfyUI\simple_ui\AGENTS.md`；repo 內只有根 `AGENTS.md`。另讀 A3-R2-R4 UX 報告最新 §1.4、A3 Phase 1 實作報告、A3 closeout inventory、A2 最終契約脈絡及歷史分類套用調查／實作報告。歷史報告中明列分類套用 Model B；不更動其決策。

## 3. 三種來源的目前資料流

### 3.1 目前提示詞（正在編輯的目標）

A3 Phase 1 已落地 `prompt_core.js` 的 `PromptModel`／`PromptComposer`。目前的正向內容由 `derivePromptModel()` 將標籤選取、補充描述、啟用 LoRA 的個人 Trigger Words、品質詞轉成 entries；`compose()` 依 order 排序，停用 entry 不輸出，依 NFKC/小寫/空白底線正規化去重，標籤權重以 `(tag:1.2)` 格式輸出。負面詞 raw 字串另存為 `negativeRaw`；解析出的 L2 項目不回寫 raw Negative。

- 目前標籤來源：`tags.js` state，`sel` localStorage（每筆 `{t,w}`）；點選、移除、權重調整、拖曳排序後 `commit()` 存回。auto 模式按分類排序；手動模式保留順序，新標籤追加到尾端。`Tags.restore()` 會設定快照順序並切為 manual；`Tags.addTags()` 是不清空的增量加入，新增權重 1。
- 自由文字來源：`#pos` 與 `ui.extra`；輸入同步保存。Composer 將中文翻譯／分段資訊放入 freetext entries；未翻譯片段仍能保存為原始文字／解析資訊。
- Negative：`#neg` 由 `ui.settings` 保存；歷史有 `neg` 才能依對應操作還原。A3 契約目前保留 L1 raw 為輸出權威，不因 L2 parse 改寫。
- LoRA：本機 `ui.loras`（v2）保存名稱、enabled、strength、個人 triggers 等；生成 Composer 用啟用角色的 personal triggers。Trigger Words 的持久資料與提示詞條目分開。歷史完整還原替換記錄的 LoRA 名單與 strength，但沿用本機同名角色的作者建議；歷史沒有 `loras` 欄位則保留目前 LoRA 狀態。只帶文字不改 LoRA。
- 生成時 `snapshotNow()` 單次取得 sel、Composer 結果、Negative、LoRA、設定；同一正向結果供 payload `wf()`、歷史 `prompt`、snapshot 使用。畫面上的編輯來源仍是多個表單／狀態欄位，不是一個完整 Prompt 字串欄位。
- 附加 A3 設計文件 §1.4.6 明確指出 Composer 的 `effectiveNegative` 是 L2，並未授權拿來取代 `text.neg`。LoRA 與目前提示詞內容會共同影響 Composer 輸出，但歷史的文字帶入與分類替換不會順便換 LoRA。

### 3.2 歷史圖片提示詞（還原／替換基底）

生成完成後，每張圖以 `ui.gallery` 保存 `sel`、`extra`、`neg`、已組好的 `prompt`、LoRA 快照、seed/尺寸/時間、輸出路徑等。歷史的 `prompt` 是生成時結果字串；可逆的分類資料依賴保存的 `sel` 與 `extra`，不可只從已組裝文字精確重建。

- 歷史卡片／結果提供「只帶文字」「完整還原」，圖燈箱內另有「分類套用」。歷史更新由 `ui.gallery` 本機保存；圖片存在性則走 `/api/check`，與提示詞資料分開。

### 3.3 WD14 反推候選（只可選取並加入）

`app.js` 將圖片 base64、threshold、model 送到 `/api/reverse`；後端驗 MIME/大小/尺寸並透過 WD14 Worker 回 rating、general、character。前端 `RV` 暫存候選與 picked Set，候選經 TagCategories 分類，重名合併；點選候選可勾選／取消，清單顯示已選項目，加入按鈕顯示數量。

選取後 `rvSplitPicked()` 以目前底部標籤列及 `#pos` 做跨來源去重。已知 CATS tag 走 `Tags.addTags()` 追加到底部標籤列；未知 tag 轉空格並增量追加至 `#pos`，保存 `ui.extra`。既有文字和標籤都保留；重複項略過並回報數量。反推候選及選取只在 modal 記憶體中，不寫入歷史或持久化候選清單。Rating 僅顯示不進提示詞。

## 4. 歷史操作實際行為

### 4.1「只帶文字」

目前函式 `reuseTextPrompt()` 並非只複製可見 `prompt` 字串：它用 `Tags.restore(item.sel || [])` 取代目前選取標籤、把歷史 `extra` 寫入 `#pos`/`ui.extra`；若歷史 `neg` 是非空字串，再覆蓋 Negative 並保存 `ui.settings`。負面空字串或不存在時保留目前 Negative。LoRA 與其他設定不動。此行為會覆蓋目前 Positive 的標籤與自由文字，而且「只」字容易令人誤以為僅帶入 prompt 文本或只追加。

### 4.2「完整還原（含角色）」

開確認視窗後 `buildReusePlan()` 以歷史 `sel`、`extra` 為目標值；明確空 `neg` 會清空目前 Negative，舊紀錄沒有 `neg` 欄位則保留目前值。歷史有 `loras` 欄位時替換目前 LoRA 列表（空陣列會清空），無欄位時保留。提交前先保存／驗證 LoRA 資料，失敗則不改其餘狀態；其後 `Tags.restore()`、補充文字、Negative（若 replace）、LoRA 一起套用。其它生成設定（尺寸、步數、CFG、seed、模型等）沒有由 `commitReuse()` 還原。故 UI 文案「文字與設定」比實際覆蓋範圍廣：會換文字／標籤／可能 LoRA 與 Negative，不是整份生成設定。

### 4.3「分類套用」— 必須維持 Model B

`CA.it` 是歷史來源；目前 `Tags.selected()` 是替換內容來源。`caPlanApply(historySel,currentSel,checkedIds,candidates)` 從歷史標籤建立結果，選取分類內歷史標籤列入移除；目前同分類候選列入加入；未選分類歷史標籤保留。結果以一個預覽視窗呈現移除、加入兩欄，並允許先看預覽再套用。`caCommit()` 將 `plan.nextSel` 寫回目前 `Tags`（有標籤變動才 restore）；不會把結果寫回歷史圖片。這正是產品決策 Model B。

目前額外文字有獨立 keep/replace/merge：keep 是保留目前 `#pos`；replace 用歷史 `extra` 取代目前 `#pos`；merge 去重合併兩者。若在 preview 編輯文字框，提交採用最後輸入。這是附屬自由文字選項，與 tag category planner 分開。

分類候選採 heuristics：標籤分類依 TagCategories/規則映射；特殊角色／表情／服裝跨分類項目依 `caInfo()` 分組；角色專名可能預勾、模糊名或跨分類項目需確認、一般特徵預設不替換。候選以正規化 key 去重並保留權重資訊，按分類、歷史順序建計畫。此啟發式並非無誤分類器；使用者可切換分類／候選，確認前看 remove/add 清單。不存在目前來源的項目不會被當成有內容加入。已有分類套用測試與 UI 測試，但本研究未執行測試。

## 5. A3 整合分析

A3 已完成的核心是「把多種正向來源轉成 PromptEntry，再由單一 Composer 組裝」，其目的不是把候選來源變成可任意覆寫的第二份 Prompt。對本任務的延伸應將操作語意安放在 Composer 之前：歷史操作修改目前模型輸入或以歷史作基底的 planner；WD14 只供候選並由人明確選取。任何 UI 方案需沿用 sel/extra/neg/loras 既有欄位與 A2 序列化契約，不新增平行 Prompt 狀態，不把 `prompt` 歷史輸出反解析成可編輯 canonical model。

A3-R2-R4 報告 §1.4 是最新權威；其 A2 契約和 LoRA／Negative 狀態不得以本研究改寫。視覺上可共用「來源 → 操作 → 寫回目前提示詞」標示與 preview pattern，但三者的行為按鈕須維持不同：歷史有替換／還原，WD14 有追加；分類替換的歷史/目前方向固定為 Model B。

## 6. 競品官方資料與借鏡

- InvokeAI Canvas 的 Generate panel、Canvas、Layers 分列，圖層類型標明起始畫面、inpaint mask、regional guidance、control image 各自用途；生成結果先進 staging area，使用者 Accept to Layer、Save to gallery 或 Discard。可借鏡「來源和結果去向明示」及「先預覽候選再確認」；不借它的多面板複雜度。[Canvas 官方說明](https://invoke-ai.github.io/InvokeAI-7/users-guide/canvas/introduction/)、[Prompt Tools](https://invoke-ai.github.io/InvokeAI-7/users-guide/image-generation/prompt-tools/)
- Midjourney 的 Creation Actions 將重用動作拆成「帶入 prompt text」「作為 Image Prompt」「Style Reference」等明確用途；Remix 編輯可 Reset Prompt 回原始文字。值得借鏡的是以動詞＋用途說明區分輸入類型，以及在可編輯前提供可恢復的原始來源。[Modifying Your Creations](https://docs.midjourney.com/hc/en-us/articles/33329329805581-Modifying-Your-Creations)、[Remix](https://docs.midjourney.com/hc/en-us/articles/32799074515213-Remix)
- Leonardo Phoenix API 將 Style、Content、Character、Image-to-Image 放在分離的 guidance 欄位，各自限制參考數量；官方用不同用途名稱避免把「參考圖」當成一種含糊來源。可借鏡先命名用途，再顯示操作與強度；本地一頁 UI 僅採一個簡單來源標籤，避免複製多種圖像模型架構。[Phoenix Image Guidance](https://docs.leonardo.ai/docs/phoenix)、[Image Guidance](https://docs.leonardo.ai/v1.0/docs/generate-images-using-image-to-image-guidance)

## 7. 可行 UI 方向

### 方向 A：所有來源共用一個「套用到目前提示詞」面板（推薦）

在目前提示詞區新增來源抽屜／彈窗：頂部固定「寫入目標：目前提示詞」；來源卡為「歷史圖片」或「WD14 候選」。選歷史後提供三張具體動作卡：分類替換（標示 Model B）、加入內容（如未來定義的歷史增量加入；現況尚無等價功能，不可假冒為已有）、完整還原（列明覆蓋欄位）。選 WD14 後只顯示勾選、加入。以單一精簡摘要顯示即將寫回目標、將移除／加入數量；分類替換延用目前已有的詳細兩欄 preview。

- 步驟：開來源 → 選來源項目 → 選操作 → 查看變更摘要 → 確認寫回。
- 理解成本：低，因「目前提示詞＝目標」固定；操作動詞和效果穩定。
- 介面影響：中；保留現有 modal，抽屜/標籤只做輕量共用，不搬動主要生成區。
- 實作複雜度：中；需要整合入口、預覽摘要與操作標示，核心 planner 可沿用。
- A3 相容性：高；Composer 前操作，現有 state 與快照模型不變。
- 風險：中低；重排入口需回歸歷史完整還原、Model B、WD14 append/unknown split、LoRA preservation。

### 方向 B：沿用三個入口，各自改成長說明與警示

維持歷史卡片兩按鈕、燈箱分類套用、WD14 modal；各入口加入來源/目標小字、欄位覆蓋清單、結果 preview。

- 步驟：最少，仍在目前入口操作。
- 理解成本：中；使用者須跨視窗學三套呈現，標籤／自由文字/Negative/LoRA 範圍容易混淆。
- 介面影響：低到中；不新增全域入口，但對既有視窗增高，受一屏與 modal 可用高度限制。
- 實作複雜度：低到中；各處加文案/preview，但重複元件和語意較難一致。
- A3 相容性：中高；可保留資料契約，但容易每個流程用不同術語。
- 風險：中；最小改動仍需完整覆蓋「只帶文字」實際替換 Positive 的行為及完整還原的欄位例外。

## 8. 推薦方案與具體示意

推薦 A，但共用的是「來源、目標、結果摘要」視覺語法，不是把三種來源做成相同套用動作。初版應呈現已存在的兩個歷史操作和 WD14 加入；歷史「加入內容」尚無實際等價行為，應列為不可用／未支援研究項，不應暗示既有功能。完整還原明示其實際範圍，而不是宣稱恢復全部生成設定。

```text
┌─ 提示詞來源 ─────────────────────────────┐
│ 寫入目標：目前提示詞（正在編輯）         │
│                                          │
│ 歷史圖片  [選一張縮圖]                   │
│ 來源：這張圖生成時保存的提示詞            │
│                                          │
│ ○ 分類替換（Model B）                    │
│   基底：歷史提示詞                       │
│   替換內容：目前提示詞的同分類標籤        │
│   [選分類] → 預覽「移除 2 / 帶入 2」       │
│   未選分類保留歷史內容。                  │
│                                          │
│ ○ 只帶文字                               │
│   實際會取代標籤與補充描述；非空 Negative  │
│   也會取代。角色／生成設定保留。           │
│   [查看變更] [套用到目前提示詞]            │
│                                          │
│ ○ 完整還原                               │
│   取代標籤、補充描述；有記錄時取代角色。   │
│   Negative 有欄位才取代（空值會清空）；    │
│   尺寸/步數/CFG/seed/模型保留。            │
│   [查看變更] [確認完整還原]                │
│                                          │
│ WD14 反推結果                            │
│ 候選 12 · 已選 3                          │
│ [勾選候選標籤…]                           │
│ 加入目標：目前標籤／補充描述               │
│ 不會移除既有內容；重複項會略過。           │
│ [加入提示詞（3）]                         │
└──────────────────────────────────────────┘
```

預覽採漸進揭露，避免全量重複 prompt：第一層顯示操作句、目標、移除/加入數與覆蓋欄位；展開才看變更 tag。分類替換保留現有移除/加入兩欄。完整還原僅列不同或會清空的欄位，外加目前／歷史摘要，不同時展示整段長 prompt。WD14 顯示「已選 n、預計新增 n、重複略過 n」，可展開被略過標籤；成功後提示寫回目標位置。

## 9. 預估修改檔案與影響（不修改）

- `index.html`：共用來源／目標操作區入口、標籤與必要 dialog 容器。
- `app.js`：呈現適用範圍與結果摘要；歷史與 WD14 操作呼叫既有 planner/commit；修正文案與真實範圍不符處。若改動預覽需避免另建 Prompt 拼接路徑。
- `app.css`：沿用 token、窄視窗 modal 內部捲動，不破壞整頁無捲動。
- `devtools/history_reuse_test.mjs`、分類套用測試、WD14 UI 測試：回歸實際欄位覆蓋與方向；視變更補充整合契約測試。
- `prompt_core.js`、`tags.js`、`server.py` 預估不需要改；若 UX 要求不同的操作資料或保存格式，需另行產品決策與相容性分析。

## 10. 相容性、保存與回歸風險

- 不改 `sel`/`combos`/`adult`、`ui.extra`、`ui.settings`、`ui.loras`、`ui.gallery` 的現有格式；不新增一份持續同步的 prompt string 作為第二真相來源。
- Model B 必須保留「歷史是基底、目前同分類內容是替換來源、結果寫回目前提示詞」及未選分類保留歷史。確認 planner 的 apply 方向、預覽統計、DOM 與實際 `Tags.restore()` 一致。
- 「只帶文字」名稱與實際欄位不一致，是高理解風險；任何更名須基於精確行為說明，不能只更名而不改範圍或 preview。
- 完整還原欄位缺失與空值語意不同；歷史舊資料可能沒有 `neg`/`loras`，欄位存在且空陣列／空字串代表清除。保留 LoRA 遷移保存先行的保護。
- WD14 的 known/unknown 路徑、正規化去重、已選可取消、同批重複、候選不持久化需維持；不得將反推結果描述成另一份完整 prompt，也不將 rating/圖片存到歷史。
- A3 PromptEntry 是衍生表示；應由既有 Composer 組裝，不要修改 `prompt_core.js` 讓來源操作偷偷改輸出順序或 Negative L1/L2。
- 介面仍須一屏無整頁捲動，modal 內可滾；候選量較大時只呈現變更差異，不複製整份 prompt。

## 11. 未能確認項目

- 未操作真實瀏覽器或正式 localStorage；不確認使用者實際 gallery 舊資料樣本、當前 UI 尺寸與按鈕顯示（遵守唯讀/不讀寫使用者資料限制）。
- CodeGraph pending 11 Added / 8 Modified；對新加 `prompt_core.js`、現有修改區由直接檔案檢視補足，不能把舊索引的呼叫圖視為完整。
- 本次沒有執行測試、瀏覽器驗收、生成或反推。部分舊歷史資料只有組裝後 `prompt` 而無 `sel`/`extra` 的實例未確認；現行函式 fallback 會用空 sel/extra，無法由 prompt 字串還原 tags。
- 分類候選的所有 heuristics、角色專名表和邊界例外未逐項審核；本研究聚焦行為與 UX 方向。
- Invoke/Midjourney/Leonardo 研究依官方公開文件，不代表逐步操作當前實際 UI；引用範圍限上述可確認的來源/目的地和重用說明。

## 12. Git 最終狀態與正式服務

- Git 最終：仍為 `main` / HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`；本次唯一新增 `devtools/reports/prompt-source-ux-research.md`，不 stage/commit。既有工作樹變更仍保留。Remote 未 fetch，behind 未核實。
- 正式服務：未啟動、停止、重啟或連接；ComfyUI、Simple UI、WD14 Worker 未受本研究影響。

## 13. 請 ChatGPT 特別審查

1. 推薦共用入口是否會提升理解，或對一屏單一生成主動作造成過度入口負擔。
2. 「只帶文字」是否需要改成明確的 Positive+非空 Negative 套用，或應改為真正只貼入文字；要不要涵蓋 LoRA/生成設定屬產品決策，需先和產品負責人確認。
3. 完整還原目前不恢復尺寸、步數、CFG、seed、checkpoint；UI/名稱能否準確傳達這個範圍。
4. Model B 的預覽例外、角色/服裝跨分類 heuristics 與文字 keep/replace/merge 是否符合原始產品意圖。
5. WD14 是否共用來源容器但保留單向增量語意，以及預覽如何控制資訊量。

---

## 官方參考

- [InvokeAI — Crafting images with the Canvas](https://invoke-ai.github.io/InvokeAI-7/users-guide/canvas/introduction/)
- [InvokeAI — Prompt Tools](https://invoke-ai.github.io/InvokeAI-7/users-guide/image-generation/prompt-tools/)
- [Midjourney — Modifying Your Creations](https://docs.midjourney.com/hc/en-us/articles/33329329805581-Modifying-Your-Creations)
- [Midjourney — Remix](https://docs.midjourney.com/hc/en-us/articles/32799074515213-Remix)
- [Leonardo AI — Phoenix Image Guidance](https://docs.leonardo.ai/docs/phoenix)
- [Leonardo AI — Generate Images Using Image Guidance](https://docs.leonardo.ai/v1.0/docs/generate-images-using-image-to-image-guidance)
