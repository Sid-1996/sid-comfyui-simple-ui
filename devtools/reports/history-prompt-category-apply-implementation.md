# 歷史提示詞分類套用／替換功能 — 實作報告

- 日期：2026-11-24
- Repository：`C:\ComfyUI\simple_ui`
- 狀態：實作與測試完成，已完成三輪**獨立審查／驗收修正**（見第 14、15、16 節）；**未 commit、未 push**，等待再次審查。

---

## 1. 任務目標與模型 B 的實際實作語意

任務指定的方向是 **模型 B：以歷史提示詞為底，把使用者選取的分類換成目前提示詞的內容**。

實際公式：

```
result = history.sel - 選取分類的歷史標籤 + 選取分類的目前標籤
```

對應範例：歷史＝角色 A／服裝 A／姿勢 A／背景 A，目前＝角色 B／服裝 B／姿勢 B；勾選角色與服裝後，結果＝角色 B／服裝 B／姿勢 A／背景 A。

程式中的位置：`app.js` 的 `caPlanApply()`（純資料層）。它以 `historySel` 為基底逐筆走過、`window.Tags.snapshot()` 只作為「覆蓋來源」，完全沒有沿用調查報告中模型 A 的 direction。`reusePrompt(it)` 一個字都沒改，仍是原本的完整套用。

---

## 2. 修改檔案及目的

| 檔案 | 變更 | 目的 |
|---|---|---|
| `app.js` | +399 行（純新增） | 新增可擷取的純 planner、UI 狀態/渲染/事件、`#lbApply` 與 `modalBody` 事件裝線；審查修正補上 `cross-body`、角色模式狀態派生、預覽顯示所有候選、chip 即時狀態統一由 `CA.checked` 決定，以及補充描述可單獨套用。`reusePrompt` 未動。 |
| `index.html` | +1 行 | 燈箱工具列在「用同提示詞」與「刪除」之間加入 `<button id="lbApply">分類套用</button>`。 |
| `devtools/category_apply_test.mjs` | 新增（untracked） | 28 個純資料測試，直接從 `app.js` 擷取 planner 區段並搭配真正的 `tag_categories.js` 執行。 |
| `devtools/category_apply_ui_test.mjs` | 新增（untracked） | 19 個 DOM-stub UI 測試，驗證渲染、事件、XSS 轉義、單次提交、保護規則、chip 即時勾選同步與補充描述單獨套用。 |

**沒有修改**：`server.py`、`app.css`、`tags.js`、`tag_categories.js`、`dict.js`、Workflow、WD14、任何既有報告與既有未追蹤檔案。沒有新增框架、外部套件或 build step。

`git diff --stat`：`app.js | 364 +`、`index.html | 1 +`；兩者都是 0 刪除，代表既有程式沒有被改寫。

---

## 3. Planner 的資料處理規則

純資料區塊以註記包起來，方便測試擷取：

```
/* ==== CATEGORY_APPLY_PLANNER_START ==== */
...
/* ==== CATEGORY_APPLY_PLANNER_END ==== */
```

### 3.1 分類解析

- 用 `window.TagCategories.has(t)` 判斷是否為詞表內標籤；`of(t)` 取得分類。
- `has()===false` → 視為 `unknown`（不是 `other`）；`of()==="other"` → 視為已知 `other`。兩者分開處理。
- 分類 API 不存在時：`caOpen()` 以白話提示「分類資料沒有載入，請重新整理頁面再試；仍然可以用『用同提示詞』完整套用。」並且不開預覽。

### 3.2 候選建立 `caBuildCandidates()`

- 輸入：歷史 `sel`、目前 `snapshot()`、`cats`（**支援 Array 或 Set**）、`{role}`。
- 兩邊各掃一次，用 `caNorm()`（`小寫 + trim + 底線/空白互換`）去重。
- 一般分類：只要該標籤分類在 `cats` 內就成為候選，並**預設勾選**。
- `other`／unknown：只有勾了「其他」分類才會列出，且**一律預設不勾**。
- 角色模式另見第 4 節。

### 3.3 規劃 `caPlanApply()`

1. 依 `checked` 把歷史候選放進 `removeSet`、目前候選放進 `addList`（addList 本身也用正規化 key 去重）。
2. 歷史列從頭到尾走一遍：遇到該分類的第一個移除點時，把對應的目前標籤插入該位置；未被移除的歷史標籤原樣保留順序與權重。沒有移除點的分類附加到尾端。
3. 去重：若同一正規化 key 仍留在結果中（例如使用者手動取消移除該歷史標籤），目前的同 key 標籤**不再插入**，避免 `long_hair`／`long hair` 並存。
4. 相同 key 同時被移除與加入時，結果採用**目前來源的 `w`**；`stats.weightChanges` 記錄 `from → to`，預覽以 `1.0→1.3` 顯示。
5. 一次回傳 `{nextSel, remove, add, stats}`；所有選取分類在同一個 planner 內算完，提交端只呼叫一次 `window.Tags.restore(nextSel)`。

---

## 4. 角色替換及跨分類處理方式

沒有把 `character` 當成角色專名來整套替換。角色快捷列（`只換角色`）設定 `{role:true, cats:['character']}`，但候選會再分層：

| 群組 | 判定 | 預設 | UI 提示 |
|---|---|---|---|
| `name-certain` | `character` + 含作品括號 `(…)` + 不命中通用特徵規則 | **勾選** | 角色專名（含作品名，預先勾選，可取消） |
| `name-possible` | `character`、不含括號、不命中通用特徵 | 不勾 | 可能是角色名，也可能是通用詞，請確認 |
| `generic` | `character` 且命中通用特徵規則 | 不勾 | 通用外觀特徵（髮型／眼睛／人數／年齡等，預設不換） |
| `cross-clothing` | `clothing` 且含 `cosplay` 或作品括號 | 不勾 | 角色專屬服裝或 Cosplay，請確認是否一起換 |
| `cross-body` | `body` 且含作品識別括號（排除通用消歧括號） | 不勾 | 與作品／角色相關的人物設計，請確認是否一起換 |
| `cross-expression` | `expression` | 不勾 | 表情可能影響角色辨識，請確認 |

通用特徵規則 `CA_GENERIC_CHAR` 覆蓋：人數（`1girl/2girls/solo/…`）、頭髮（`hair/bangs/braid/ponytail/ahoge/…`）、眼睛（`eye/pupil/iris/heterochromia/…`）、年齡與關係（`age/aged/young/brother/sister/…`）、獸耳與特徵（`animal ears/tail/horns/wings/fang/…`）、泛角色與種族（`maid/nurse/angel/elf/idol/robot/…`）以及部分身體詞。

因此「只換角色」的預設行為是**只带走高置信度專名**；`long hair`、`blue eyes`、`1girl`、`solo`、`ahoge` 等外觀特徵會留在歷史結果中，Cosplay／角色專屬服裝與表情會列出但需人工勾選。所有預勾項目都能在預覽中點一下取消。

已知限制：這套規則是關鍵字啟發式，不是角色專名白名單。少數「角色名恰好含通用詞」會被歸到 `generic`（保守不換），不會造成誤刪；反之也不聲稱能列舉所有角色名。

---

## 5. Extra、負面提示詞、生成設定的保護方式

### Extra（`ui.extra` / `#pos`）

- 部分分類套用預設 `keep`：**完全不讀寫 `#pos`、不寫 `ui.extra`**。
- 預覽提供三選一：保留目前（預設）／取代為這張圖的文字／合併兩邊（去重）。
- 合併沿用 `caMergeExtra()`：`逗號／換行` 切分、`(tag:1.2)` 解殼、正規化去重，**保留目前文字原文**，只把歷史的新項目接在後面。
- 文字框是「所見即所得」：切換模式時預填將寫入的內容，使用者修改後以修改過的文字為準；`keep` 時不出現文字框。
- 完整套用仍走原 `reusePrompt`，覆蓋為 `it.extra`，語意不變。

### 負面提示詞與生成設定

- 新功能完全不碰 `#neg`、Checkpoint、尺寸、Steps、CFG、Seed、Batch 或 `ui.settings`。
- 測試 15 直接檢查原始碼：分類套用區塊沒有出現 `$("neg")`、`persistSettings`、`S.settings`、`#ckpt/#steps/#cfg/#seed`。
- UI 測試 21 確認 `#neg` 值不變，且 localStorage 只寫 `ui.extra` 一個 key。

### 已知副作用

`window.Tags.restore()` 會把排序模式切成 `manual`（與既有完整套用一致）。本次**沒有重構 Tags API**。為減少不必要的副作用，只有真的有標籤變更時才呼叫 restore；只改補充描述時不呼叫，因此不會連排序模式一起改掉。

---

## 6. UI 操作流程

1. 打开歷史燈箱 → 點工具列新增的「分類套用」。
2. 弹出既有 `#modal`（z-index 101，浮在燈箱上），显示方向說明：
   「以這張歷史圖片為底，將選取分類替換成目前提示詞的內容；未選取分類保持不變。」
3. 八顆快捷（只換角色／服裝／人物設計／姿勢／表情／構圖／背景／畫風）→ **只預選並重算預覽，不寫入**。
4. 10 個分類按鈕可多選，顯示「圖 N / 現在 N」筆數；「其他」標註需逐項確認。
5. 兩欄預覽「會移除（這張圖）」「會加入（目前）」，chip 顯示中文名、英文、權重、權重變化；`⚠` 表示需人工確認，點一下可取消或加入。
6. 補充描述三選一；底部顯示「套用（移除 X · 加入 Y）」，X=Y=0 時停用。
7. 確認 → 單次 `Tags.restore()` → 選擇性寫 `ui.extra` → 關 Modal 與燈箱 → toast 回報數量。
8. Modal 內另有「完整套用」→ 直接呼叫未改動的 `reusePrompt(it)`。

使用既有 class：`modal-card / rev-modes / rev-cats / rev-cat / rev-grid / rev-tags / rev-tag / rev-chip / prompt-box / modal-foot / rev-rating / meta`。沒有改 `app.css`。所有動態文字經 `esc()`；hover 只用既有 class 的邊框/底色，不改尺寸；沿用 `openModal/closeDialog/dialogStack`，Esc 與 focus 還原走既有行為。

---

## 7. 實際執行的測試及結果

全部在Repo本地執行，沒有連正式 ComfyUI、沒有生成圖片、沒有跑 WD14。

| 檢查 | 結果 |
|---|---|
| `node devtools/category_apply_test.mjs` | **28 / 28 PASS** |
| `node devtools/category_apply_ui_test.mjs` | **19 / 19 PASS**（含第 15 節 4 個、第 16 節 4 個） |
| `node --check app.js` | PASS |
| `node --check devtools/category_apply_test.mjs` | PASS |
| `node --check devtools/category_apply_ui_test.mjs` | PASS |
| `git diff --check` | PASS（無輸出） |

原本 18 個純資料測試涵蓋：模型 B 方向、只換角色、只換服裝、只換姿勢、多分類、未選分類保留、正規化去重、目前權重、未知標籤、`other` 不整桶、跨分類人工選取、extra 保留／取代／合併、neg 與設定不變、預覽取消不提交、單次 restore、完整套用語意不變。審查後新增 10 個（19–28），見第 14 節。

原本 6 個 UI-stub 測試涵蓋：視窗結構、角色預覽分層、逐項取消＋合併＋單次提交、keep 模式不寫 localStorage、XSS 轉義、分類資料缺失提示。審查後新增 5 個（25–29），見第 14 節。

測試期間實際抓到並修好五個問題（都已完成並重測通過）：

1. UI 傳 `Set` 給只接受陣列的 `caBuildCandidates()`，導致預覽全空。
2. 未知標籤在勾選「其他」時仍被过滤掉。
3. 手動取消移除時，目前同 key 標籤會重複插入。
4. 補充描述文字框的编辑值在確認時被忽略（改為所見即所得）。
5. 預覽只渲染「已勾選」項目，導致未勾選的跨分類候選看不到也點不到；改為渲染全部候選，以 `.on` 區分勾選狀態，數量仍由 planner 的 checked 統計。

---

## 8. 未執行的測試與原因

| 未執行 | 原因 |
|---|---|
| 實際瀏覽器驗證 Modal／燈箱／1920×1080／Console 錯誤 | `Get-NetTCPConnection -LocalPort 7860 -State Listen` 無輸出，本機前端服務未啟動；任務未授權啟動或重啟服務。改以 DOM-stub UI 測試涵蓋渲染、事件、XSS 與提交行為。 |
| 真實生成（1 張 1024） | 任務明確禁止為了驗證執行正式圖片生成。 |
| WD14 反推 | 任務明確禁止；且與本功能無關。 |
| 高負載／多分頁並發測試 | 任務禁止高負載，且此功能為純前端單頁操作。 |
| `python -m py_compile server.py` | 未修改 `server.py`，無必要。 |

因此**不聲稱**已通過真實瀏覽器版面量測或端到端生成驗證；這部分留給獨立審查或後續授權環境驗收。

---

## 9. Git Branch、HEAD、工作區狀態

起始與最終皆相同：

- Branch：`main`
- HEAD：`b5ad7a8273df7309e67460992bb913c8e9df9963`（`b5ad7a8`）
- Remote：`origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`
- `git rev-list --left-right --count HEAD...origin/main` → `0  0`

最終 `git status -sb`：

```
## main...origin/main
 M app.js
 M index.html
?? devtools/category_apply_test.mjs
?? devtools/category_apply_ui_test.mjs
?? devtools/reports/fix-local-wd14-and-output-directory.md
?? devtools/reports/history-prompt-category-apply-investigation.md
?? devtools/reports/open-source-readiness-phase1.md
?? devtools/reports/open-source-readiness-phase2a.md
?? devtools/reports/open-source-readiness-phase2b1.md
?? devtools/reports/open-source-readiness-phase2b2.md
?? devtools/reports/open-source-readiness-phase2b3.md
?? devtools/reports/open-source-readiness-phase2c-implementation.md
?? devtools/reports/open-source-readiness-phase2c.md
?? devtools/reports/open-source-readiness-phase3.md
?? devtools/reports/open-source-readiness-phase3r1.md
?? devtools/reports/open-source-readiness-phase3r1r.md
?? devtools/reports/open-source-readiness-phase3r1v.md
?? devtools/reports/open-source-readiness-phase3r1vr.md
?? devtools/reports/readme-agents-documentation.md
?? devtools/reports/history-prompt-category-apply-implementation.md
```

所有 15 個既有未追蹤報告完整保留；只新增本報告與 2 個測試檔。沒有 commit、push、stash、checkout、clean 或任何 Git 寫入。

---

## 10. 正式服務是否受到影響

**沒有**。

- 沒有啟動、停止或重啟 simple_ui、ComfyUI 或 WD14 Worker。
- 沒有修改 `server.py`、模型、Workflow、輸出圖片、歷史資料或正式設定。
- 沒有清除 localStorage；UI-stub 測試用的是獨立的假 `localStorage` 物件。
- 沒有連到 7860／8188，也沒有產生任何图片。

---

## 11. 未解決問題及風險

1. **角色專名辨識是啟發式**：靠「作品括號」與通用特徵關鍵字，不是完整白名單。少數角色名可能落在 `generic` 或 `name-possible` 而未預勾；方向保守（不誤刪），但需要使用者在預覽中確認。若要更準，需另建角色專名資料，屬資料工程，不在本次範圍。
2. **`adult` 跨分類**：`large breasts` 在 body、`lingerie` 在 clothing，只勾「成人內容」不會換掉全部成人標籤。目前只在分類預覽中呈現，沒有做連動選項。
3. **排序模式副作用**：`Tags.restore()` 會切成手動排序；已報告，未重構 Tags API。
4. **真實瀏覽器版面未量測**：DOM-stub 無法驗證 1920×1080 是否完全不捲動、`.modal-card` 是否裁切、Esc/focus 在真實瀏覽器的行為；需後續授權環境驗收。
5. **已學習標籤**：不在 `tag_categories.js` 的 MAP 中，會被當 unknown 保護，需使用者逐項勾選才會替換。
6. **`other` 門檻刻意偏嚴**：即使勾了「其他」分類也不自動帶入任何東西，這是安全設計；使用者若 expecting 一鍵替換其他分類，需先理解此限制（UI 已有文字提示）。

---

## 14. 獨立審查修正（本次小範圍修正）

### 14.1 body 跨分類的實際辨識規則及資料依據

以 Python 完整解析 `tag_categories.js` 的 737 個 `body` 標籤：

- 只有 **2** 個帶括號：`heart (organ)`、`oripathy lesion (arknights)`。
  - `oripathy lesion (arknights)` 有明確作品識別（`arknights`），列為 `cross-body`。
  - `heart (organ)` 是通用消歧括號，排除。
- 27 個「看似角色／種族關鍵字」的 body 標籤逐一檢視後，都是通用身體特徵或種族部件（`demon horns`、`dragon tail`、`fairy wings`、`robot ears`、`slime girl` 等），**不是角色專名**，全部排除。
- `alternate *` 5 個也是通用變化，排除。

因此規則刻意保守：`body` + 作品括號 + 括號內容不在 `CA_GENERIC_PARENS`（organ/medium/object/style/weapon/symbol/… 等通用消歧詞）→ `cross-body`；其餘 body 標籤一律不進入角色候選。目前詞表下**只有 1 個** body 標籤符合。不虛構更大的辨識能力。

兩側候選皆由同一個 `caBuildCandidates()` 處理；同時修正預覽只渲染已勾選項目的問題，讓未勾選的 `cross-body`（以及其他跨分類候選）也能顯示並由使用者逐項勾選。

### 14.2 角色模式狀態修正方式

- `caBuildCandidates()` 不再單純相信傳入的 `role`，而是計算 `roleActive = role && want.has("character")`。角色跨分類候選與角色內部分層都只在 `roleActive` 時生效。
- 明確勾選的分類（即使是在角色模式下手動加進來的 `expression`／`clothing`／`body`）一律走一般分類規則：預設勾選，不沿用角色模式的「預設不勾」。
- UI 端 `caOnClick()` 切換分類時，若 `character` 被取消就同步把 `CA.role = false`，並清除 `presetKey`；`CA.role` 不再是孤立狀態。
- 新增 `CA.overrides`（使用者手動勾選的 Map）與簡化後的 `caRebuild()`：手動選擇只是覆寫，分類／模式改變時其餘項目重新採用新預設，避免殘留舊的勾選狀態。
- 再次點「只換角色」會重置 `cats = ['character']`、`role = true`、`overrides` 清空，恢復完整預設。

### 14.3 新增的回歸測試與結果

在既有兩個測試檔追加，沒有另建重複測試檔，也沒有弱化原有 18 + 6 個測試：

- `devtools/category_apply_test.mjs` 新增 10 個（19–28）：body 候選兩側辨識、預設不勾、未勾不變、人工勾選才替換、一般 body 不被誤判；角色模式啟用、取消 character 後跨分類候選消失、expression 恢復一般預設、角色＋background 共存、再次快捷恢復。
- `devtools/category_apply_ui_test.mjs` 新增 5 個（25–29）：UI 上角色候選出現、`CA.role` 同步關閉、expression 恢復勾選、角色＋background 共存、再次快捷清除覆寫。

實際結果：

| 檢查 | 結果 |
|---|---|
| `node devtools/category_apply_test.mjs` | **28 / 28 PASS** |
| `node devtools/category_apply_ui_test.mjs` | **11 / 11 PASS**（該輪結果；目前為 15 / 15，見第 15 節） |
| `node --check app.js` | PASS |
| `node --check devtools/category_apply_test.mjs` | PASS |
| `node --check devtools/category_apply_ui_test.mjs` | PASS |
| `git diff --check` | PASS（無輸出） |

### 14.4 實際修改檔案

只修改/更新：`app.js`（該輪 +392 行，純新增）、`devtools/category_apply_test.mjs`、`devtools/category_apply_ui_test.mjs`、本報告。`index.html` 的 +1 行是上一輪既有修改，本次未再更動。

**未修改**：`server.py`、`tags.js`、`tag_categories.js`、`dict.js`、`app.css`、Workflow、WD14、模型或正式設定。

### 14.5 Git Branch、HEAD、工作區狀態

- Branch：`main`；HEAD：`b5ad7a8273df7309e67460992bb913c8e9df9963`；Remote：`origin`（Sid-1996/sid-comfyui-simple-ui）；`HEAD...origin/main` = `0  0`。
- `git diff --stat`（該輪）：`app.js | 392 +`、`index.html | 1 +`（0 刪除）；目前為 `app.js | 399 +`，見第 15、16 節。
- 工作區：`app.js`、`index.html` 為 tracked 修改；2 個測試檔與 15 個既有未追蹤報告（含本報告）保持未追蹤且完整保留。
- 沒有 commit、push、stash、checkout、clean 或任何 Git 寫入。

### 14.6 正式服務影響

**沒有**。未啟動、停止或重啟 simple_ui／ComfyUI／WD14 Worker；未生成圖片、未跑 WD14、未連 7860／8188、未清除 localStorage、未修改正式設定或使用者資料。

### 14.7 尚存限制

1. body 的角色辨識只覆蓋詞表中唯一有作品括號的 `oripathy lesion (arknights)`；其他作品的角色專屬身體特徵若沒有括號線索，不會自動列入，需使用者自訂補充描述或在一般 body 分類中處理。
2. 角色／跨分類候選仍是關鍵字與括號啟發式，不是角色專名白名單；保守方向不會誤刪，但可能需要人工多勾幾項。
3. 真實瀏覽器 1920×1080 版面、Esc/focus 與 Console 仍未量測（服務未啟動且未授權啟動），以 DOM-stub 測試替代。
4. `Tags.restore()` 切換 manual 排序的既有副作用仍在，本次未重構 Tags API。

---

## 15. 第二輪審查修正：候選勾選狀態同步

### 15.1 問題與修正

`caOnClick()` 更新的是 `CA.checked`，但 `caRender()` 的 `chip()` 原本用候選建立時的初始值 `c.checked` 來產生 `.rev-tag` 的 `on` class 與 `aria-pressed`。這造成 planner 狀態正確、畫面外觀可能不同步。

修正只碰 `chip()`：新增 `const checked = CA.checked.has(c.id);`，並以它同時決定 `on` class 與 `aria-pressed`。`c.checked` 仍保留作為 `caRebuild()` 建立新候選時的「預設值」，但不再是 UI 即時狀態來源；畫面與 planner 都只看 `CA.checked`。`caRebuild()` 的重建邏輯（`CA.candidates` + `CA.overrides` → `CA.checked`）完全未變。

### 15.2 新增回歸測試與結果

在 `devtools/category_apply_ui_test.mjs` 追加 4 個（30–33），保留原有 11 個測試與斷言：

- 30：歷史候選未勾 → 勾選 → 取消，驗證 `CA.checked`、`.rev-tag on`、`aria-pressed` 三者同步。
- 31：目前候選做相同驗證。
- 32：切換分類（角色仍選取）與再點快捷後，新預設與手動覆寫都正確反映在 class／aria。
- 33：畫面上 `rev-tag on` 的數量與 planner 的 `removeCount + addCount` 及底部按鈕文字一致。

實際結果：

| 檢查 | 結果 |
|---|---|
| `node devtools/category_apply_test.mjs` | **28 / 28 PASS** |
| `node devtools/category_apply_ui_test.mjs` | **15 / 15 PASS** |
| `node --check app.js` | PASS |
| `node --check devtools/category_apply_test.mjs` | PASS |
| `node --check devtools/category_apply_ui_test.mjs` | PASS |
| `git diff --check` | PASS（無輸出） |

### 15.3 實際 Diff 與 Git 狀態

- Branch：`main`；HEAD：`b5ad7a8273df7309e67460992bb913c8e9df9963`；Remote `origin`（Sid-1996/sid-comfyui-simple-ui）；`HEAD...origin/main` = `0  0`。
- `git diff --stat`：`app.js | 394 +`、`index.html | 1 +`（0 刪除，純新增）。
- 工作區：`app.js`、`index.html` 為 tracked 修改；`devtools/category_apply_test.mjs`、`devtools/category_apply_ui_test.mjs` 與 15 個既有未追蹤報告（含本報告）全數保留。
- 沒有 commit、push、stash、checkout、clean 或任何 Git 寫入。

### 15.4 正式服務影響

**沒有**。未啟動、停止或重啟 simple_ui／ComfyUI／WD14 Worker；未生成圖片、未跑 WD14、未連 7860／8188、未清除 localStorage、未修改正式設定或使用者資料。

### 15.5 尚存限制

第 14.7 節的限制不變；本次只修正 UI 即時狀態來源，沒有改變任何分類判斷、planner 規則或 UI 設計。真實瀏覽器版面與 Esc/focus 仍未量測（服務未啟動且未授權啟動）。

---

## 16. 第三輪修正：補充描述可單獨套用

### 16.1 問題根因

ChatGPT 以真實 Chrome（1920×1080、100% DPI）驗收發現：沒有任何標籤移除／加入時，即使選擇「取代為這張圖的文字」或「合併兩邊」，底部「套用」按鈕仍是 disabled。

根因在 `caRender()` 原本只有：

```js
const changed = !!(plan.stats.removeCount || plan.stats.addCount);
```

按鈕的 `disabled` 只參考標籤變更；但 `caCommit()` 早已允許「沒有標籤變更、但 `CA.extraMode !== 'keep'`」的情况，造成 UI 判斷與提交邏輯不一致。

### 16.2 實際修改內容

只改 `caRender()` 的判斷與按鈕文字：

```js
const hasTagChanges = !!(plan.stats.removeCount || plan.stats.addCount);
const hasExtraChange = CA.extraMode !== "keep";
const canApply = hasTagChanges || hasExtraChange;
const footLabel = hasTagChanges
  ? "套用（移除 X · 加入 Y）"
  : (hasExtraChange ? "套用補充描述" : "套用（移除 0 · 加入 0）");
```

`disabled` 改用 `canApply`。沒有標籤變更、但有補充描述變更時，按鈕文字改為「套用補充描述」，避免出現「移除 0、加入 0」讓人誤以為不能操作。

`caOnChange()` 原本已經會把文字框預填為 `caExtraResult(...)`（replace 顯示歷史文字、merge 顯示去重合併結果），`caOnInput()` 保留使用者最後輸入並由 `caCommit()` 直接寫入，因此「自訂編輯後以最後輸入為準」的行為不變。沒有重構 planner、`caCommit()` 或其他功能。

### 16.3 新增測試與結果

在 `devtools/category_apply_ui_test.mjs` 追加 4 個（34–37），保留原有 15 個測試與斷言：

- 34：只取代補充描述 — 按鈕啟用、文字框預填歷史、`#pos` 被取代；`Tags.restore` 未被呼叫、`snapshot()` 不變、neg 與設定不變。
- 35：只合併補充描述 — 按鈕啟用、修改文字框後以最後輸入寫入；標籤、neg、設定不變。
- 36：`keep` 且沒有任何變更 — 按鈕仍 disabled，即使誤觸也不提交。
- 37：標籤與補充描述同時變更 — 標籤提交一次且 `pos` 一併更新，neg 與設定不變。

實際結果：

| 檢查 | 結果 |
|---|---|
| `node devtools/category_apply_test.mjs` | **28 / 28 PASS** |
| `node devtools/category_apply_ui_test.mjs` | **19 / 19 PASS** |
| `node --check app.js` | PASS |
| `node --check devtools/category_apply_test.mjs` | PASS |
| `node --check devtools/category_apply_ui_test.mjs` | PASS |
| `git diff --check` | PASS（無輸出） |

### 16.4 Git 狀態

- Branch：`main`；HEAD：`b5ad7a8273df7309e67460992bb913c8e9df9963`；Remote `origin`（Sid-1996/sid-comfyui-simple-ui）；`HEAD...origin/main` = `0  0`。
- `git diff --stat`：`app.js | 399 +`、`index.html | 1 +`（0 刪除，純新增）。
- 工作區：`app.js`、`index.html` 為 tracked 修改；`devtools/category_apply_test.mjs`、`devtools/category_apply_ui_test.mjs` 與 15 個既有未追蹤報告（含本報告）全數保留。
- 沒有 commit、push、stash、checkout、clean 或任何 Git 寫入。

### 16.5 正式服務影響

**沒有**。ChatGPT 已啟動的 simple_ui（PID 2668、Port 7860）與未啟動的 ComfyUI（8188）都沒有被本次操作啟動、停止或重啟；沒有連到正式瀏覽器資料或暫存 Chrome Profile，也沒有生成圖片、跑 WD14、修改 Workflow／正式設定或清除 localStorage。

### 16.6 尚未解決的問題

1. 本次只修正 UI 啟用判斷；真實瀏覽器的第二輪驗收需由 ChatGPT 重新執行（本機仍可用既有服務，但本任務未授權自行操作瀏覽器）。
2. 第 14.7、15.5 節的限制不變：角色／跨分類候選仍是啟發式；`Tags.restore()` 切換 manual 排序的副作用仍在；真實版面與 Esc/focus 量測需外部驗收。
3. 「只改補充描述」時不會呼叫 `Tags.restore()`，因此排序模式不會被改動；這是刻意行為，不是遺漏。

---

**交付後停止，等待 ChatGPT 直接檢查實際 Diff、重新執行測試及第二輪真實瀏覽器驗收。**
