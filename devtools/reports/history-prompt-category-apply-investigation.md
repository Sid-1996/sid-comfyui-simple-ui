# 歷史提示詞分類套用／替換功能 — 唯讀技術調查

- 日期：2026-11-24
- 範圍：`C:\ComfyUI\simple_ui`（Sid-simple-ui）
- 性質：**唯讀調查**。除本報告外，未修改任何程式碼、文件、測試、設定；未執行 Git 寫入；未重啟服務；未生成圖片、未跑 WD14、未連正式服務。

---

## 1. Repository 與 Git 起始狀態

| 項目 | 實測結果 |
|---|---|
| Repository | `C:\ComfyUI\simple_ui`（唯一本專案 repo；未碰 `ComfyUI_windows_portable\ComfyUI\.git`） |
| Branch | `main` |
| HEAD | `b5ad7a8273df7309e67460992bb913c8e9df9963`（即 `b5ad7a8`） |
| Remote | `origin  https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 同一個） |
| 與远端差異 | `git rev-list --left-right --count HEAD...origin/main` → `0  0`（同步） |
| 工作區 | 只有 14 個**既有未追蹤**報告（`devtools/reports/*.md`）；無 tracked 修改 |
| 指引 | 已讀 `C:\ComfyUI\AGENTS.md` 與 `C:\ComfyUI\simple_ui\AGENTS.md` |
| 索引 | `simple_ui\.codegraph\` 存在；探索使用 `codegraph_explore({ projectPath: "C:\\ComfyUI\\simple_ui" })` |

既有未追蹤報告已全部保留，未讀寫其內容：`fix-local-wd14-and-output-directory.md`、`open-source-readiness-phase1.md`、`phase2a.md`、`phase2b1/2/3.md`、`phase2c-implementation.md`、`phase2c.md`、`phase3.md`、`phase3r1.md`、`phase3r1r.md`、`phase3r1v.md`、`phase3r1vr.md`、`readme-agents-documentation.md`。

---

## 2. 相關資料結構及呼叫流程

### 2.1 歷史紀錄怎麼產生

`app.js::snapshotNow()`（308–329 行）在生成前一次取齊快照：

```js
const sel = window.Tags.snapshot();          // 深拷貝 [{t, w}, ...]
const extra = window.Dict.tr(posEl.value || "").trim();   // 已翻譯、丟掉未翻譯中文
const pos = ((quality?) + sel.map(s => s.w === 1 ? s.t : `(${s.t}:${s.w.toFixed(1)})`)
  .concat(extra ? [extra] : []).join(", ")).replace(...);
return { sel, pos, neg, extraRaw: (posEl.value || "").trim(), ckpt, w, h, n, steps, cfg, seed };
```

`generate()`（431–510 行）把快照拆成兩份用途：

- 送模型的 `o = { ckpt, pos, neg, w, h, n, seed, steps, cfg, fileTag }`；
- 存歷史的 item（492–503 行）：

```js
{ url, filename, seed, w, h,
  sel: selSnap,        // [{t,w}]，完整深拷貝、順序與權重都在
  extra: extraSnap,    // extraRaw：原始輸入（可能是中文／混合文字）
  neg: negSnap,        // trim 過的負面提示詞
  prompt: o.pos,       // 最終翻譯後完整正向提示詞（僅供顯示）
  at: Date.now() }
```

存入 `S.gallery` 並 `saveJSON("ui.gallery", S.gallery)`（24 張上限）。載入端（32、36 行）只有 `loadJSON("ui.gallery", [])` + `Array.isArray()` + `slice(0,24)`，**沒有逐欄位正規化或搬移**。

### 2.2 完整套用目前的還原方式

`app.js::reusePrompt(it)`（744–751 行）：

```js
window.Tags.restore(it.sel || []);
$("pos").value = it.extra || "";
try { localStorage.setItem("ui.extra", $("pos").value); } catch {}
if (it.neg) { $("neg").value = it.neg; persistSettings(); }
updateWarn();
toast("已套用這張圖的提示詞", "ok");
```

入口有兩處：結果卡 `data-act="prompt"`（1703 行）、燈箱 `#lbPrompt`（1740 行，且 `closeLightbox()`）。

`tags.js::restore()`（1023–1030）：深拷貝 `sel` → **強制 `sortMode = "manual"`** → `commit()`。`commit()`（601–612）在 manual 模式不排序，接著 `save()`（寫 `sel/combos/adult/showEn/ui.moreCats/ui.selSortMode/ui.learnedTags`）、`renderAll(true)`、`tags:change`。

`addTags()`（1033–1045）是**增量、只認精確 `s.t` 去重、新標籤 `w:1`**，沒有分類概念；`matchTag()`（1048–1055）靠 `tagAlts()`（286–292）比對 CATS + 已學習標籤。`buildPrompt()`（1001–1006）另外即時讀 `#pos` 並跑 `Dict.tr()`。

### 2.3 欄位完整度與舊資料

- `sel` 的 `{t, w}` 格式**從初始 commit `30bb408` 就存在**（`git log -S'w: 1'` 命中初始與早期 commit），所以舊版歷史不可預期是「純字串陣列」；但因為完全沒有 runtime 正規化，損壞/手動改過的資料仍可能讓 `s.w.toFixed()` 出錯。
- `reusePrompt` 對缺欄位是寬容的：`it.sel || []`、`it.extra || ""`、`if (it.neg)`。新增功能必須沿用這種防禦。
- `Dict.tr()`（`dict.js:23-32`）把中文全形逗號轉成 `,`，查得到就換英文標籤，**查不到的中文直接濾掉**（`keep=false`）；因此 `it.prompt` 可能比 `it.extra` 少東西，而 `it.extra` 可能含角色名、服裝、場景等自由文字。

### 2.4 可複用的既有模式

- `app.js::RV_MODE_CATS`（1139–1146）：WD14 反推 UI 的「只要角色」模式 = `character ∪ expression`，是專案內**已經存在的跨分類角色定義先例**。
- `rvCatOf()`（1150–1155）：`TagCategories.of()` + missing/`other` 安全退回；`rvSplitPicked()`（1091–1110）與 `rvMergePrompt()`（1064–1084）：雙路徑去重、增量合併、保留原格式的成熟寫法。
- `openModal()` / `closeDialog()` / `dialogStack`：既有 dialog 堆疊與 `#modal { z-index: 101 }`（`app.css:1122`）已能浮在燈箱（z-index 100）之上。

---

## 3. 分類資料分析結果

以 Python 完整解析 `tag_categories.js` 的 `MAP`（不是人工抽樣）：

- `MAP` 共 **10,959** 筆英文標籤 → 分類 ID。
- `CATEGORIES` 10 類：`character / clothing / body / pose / expression / composition / background / style / adult / other`。
- `of()` = `MAP[norm(tag)] || "other"`；`norm()` 小寫 + 底線/空白轉空格。`has()` 才會區別「詞表內的 other」與「詞表外」。

| 分類 | 標籤數 |
|---|---:|
| character | 3,216 |
| other | 2,554 |
| clothing | 2,472 |
| body | 737 |
| background | 644 |
| pose | 516 |
| adult | 425 |
| expression | 164 |
| style | 141 |
| composition | 90 |

### 3.1 前端 CATS 與 TagCategories 的交叉表

把 `tags.js` 的 CATS（725 個正規化後 alias）用 `of()` 的同等規則對應：

| 前端分類 | n | of() 查不到 | 主要落到 |
|---|---:|---:|---|
| 常用 | 16 | 0 | style 12、background 2、character 1、composition 1 |
| 人物 | 56 | 0 | character 27、body 25、other 2、pose 1、clothing 1 |
| 頭髮 | 48 | 0 | **character 44**、clothing 4 |
| 臉&表情 | 45 | 0 | expression 26、**character 14**、body 5 |
| 服裝 | 74 | 0 | clothing 73、body 1 |
| 配件 | 83 | 2 | clothing 63、other 9、character 4、body 4、background 1 |
| 動作 | 51 | 0 | pose 47、composition 3、expression 1 |
| 構圖&光影 | 28 | 0 | composition 15、style 11、background 2 |
| 場景 | 69 | 0 | background 61、other 8 |
| 風格 | 23 | 1 | style 21、other 1 |
| 成人向 | 21 | 1 | **body 9、adult 7、clothing 4** |
| 成人·身體服裝 | 26 | 0 | clothing 13、adult 8、body 4、style 1 |
| 成人·動作 | 13 | 0 | adult 11、clothing 1、pose 1 |
| 成人·R18 | 172 | 2 | adult 152、body 8、character 3、other 3、pose 2、style 2 |

前端 725 個 alias 中只有 6 個查不到（`computer_keyboard`、`computer_mouse`、`oil_painting_(medium)`、`see-through_clothes`、`ball_busting`、`penis_in_thighhigh`）；另有 23 個是「詞表內真正歸在 other」（如 `dog`、`bottle`、`lantern`、`mind control`）。**這兩類不能混為一談**：`of()==="other"` 同時代表「明確 other」與「完全未知」。

### 3.2 各分類的實際內涵（重要落差）

- **character 不是「角色名稱」分類。** 它同時含：
  - 人數：`1girl / 2girls / 3boys / 6+girls / 1other`（14 個這種形式）；
  - 髮型髮色：`long hair`、`black hair`、`blonde hair`、`absurdly long hair`、`ahoge`、`antenna hair`、`alternate hair length`；
  - 眼睛：`blue eyes`、`red pupils`、`heterochromia`；
  - 獸耳／特徵：`cat ears`、`animal ears`、`hair ornament` 等；
  - 年齡／關係／泛角色：`aged up`、`age difference`、`brothers`、`maid`、`angel`。
  - 以關鍵字粗估，這類「非專名」標籤至少 324 個；**前端「頭髮」44/48 都在 character**。
  - 1,403 個 character 標籤帶 `(作品名)` 括號，的確多是專名，但上列通用特徵也混在同一類。
- **clothing 含角色專屬服裝／Cosplay。** 全部 8 個含 `cosplay` 的標籤都在 clothing：`2b (nier:automata) (cosplay)`、`hatsune miku (cosplay)`、`hakurei reimu (cosplay)` 等；另有 `kamiyama high school uniform (hyouka)`、`millennium cheerleader outfit (blue archive)`、`champion's tunic (zelda)` 等 19 個「帶作品/角色括號」的服裝標籤。`nurse` 在 clothing，但 `maid` 卻在 character。
- **body 是身体特徵，不是髮型。** 737 個中只有约 12 個含 hair、16 個含 eye；多數是 `ass / breasts / tail / alternate skin color / bad anatomy` 等；`large breasts` 在 body、`lingerie` 在 clothing、`nsfw/nude` 在 adult。
- **expression 與角色辨識有重疊。** 164 個多為表情／顏文字（`smile`、`ahegao`、`:3`）；`one_eye_closed` 在 expression，但 `blue eyes` 在 character。WD14 UI 已把 `character + expression` 當成「角色模式」。
- **style 混入品質與光影。** `masterpiece/best quality/ultra-detailed/8k/detailed` 在 style，但 `backlighting/cinematic lighting/bokeh` 也在 style（前端放在「構圖&光影」）；`composition` 只有 90 個，含 `looking at viewer`、`full body`。
- **background 含 `halo`、`simple background`、`white background`。**
- **adult 不包办成人內容**：前端「成人向」21 個廣散到 body 9 / adult 7 / clothing 4。
- **other 是混合桶**（whole MAP 2,554 個：物件、medium、雜項）。對前端而言 6 個 unknown 會被 `of()` 預設成 other，23 個是真正 other。因此 **other 不能當成可靠的自動替換單位**。

---

## 4. 角色替換的技術可行性及限制（核心）

### 4.1 需求情境存在一個必須先釐清的方向矛盾

需求文字同時包含：

- 「未選取的分類應保留**目前**提示詞內容」（以目前為底、從歷史套用選取分類）；
- 但範例卻是「歷史的角色 A 被替換成**目前**的角色 B」，同時保留歷史的服裝／姿勢／構圖，且不破壞目前其他設定（以歷史為底、把角色換成目前的）。

這兩個方向不可能同時成立。建議**在寫任何功能碼前確認**，或把方向做成參數並在 UI 明確顯示：

| 模型 | 基底 | 選取分類來源 | 符合的敘述 |
|---|---|---|---|
| A：history → current | 目前 sel | 歷史 sel | 「未選取分類保留目前」✓；結果會是**角色 A**（非範例的角色 B） |
| B：current → history | 歷史 sel | 目前 sel | 「角色 A 換成 B + 保留歷史服裝/姿勢/構圖」✓；但未選取分類變成保留歷史，與需求 4 衝突 |

從需求 4 與「不破壞目前其他內容」判斷，**建議預設採模型 A**；但按鈕文案「只換角色」在模型 A 下其實是「把目前的角色換成這張圖的角色」，容易誤解。最小可靠做法是先用 preview 把「移除／加入」兩欄攤在畫面上，讓方向在按下確認前就可被肉眼驗證，並保留 `direction` 參數以便日後切換。

### 4.2 單靠 `character` 分類替換不足，且不安全

實證理由：

1. 替換 `character` 會連**髮型、髮色、眼睛、人數、solo、獸耳、年齡描述**一起刪除／加入（3.2 節）。這通常不是使用者理解的「換角色」。
2. 角色專名出現在其他分類：8 個 cosplay 全在 clothing、19 個角色專屬服裝在 clothing、`maid` 在 character 但 `nurse` 在 clothing、`usada pekora (1st costume)` 在 character。只換 character 會留下「角色 B + 角色 A 的專屬服裝」的衝突。
3. WD14 既有「只要角色」模式本身就跨越 `character + expression`（`app.js:1141`），說明專案既有的角色定義也不是單一分類。
4. `of()` 對未知回 other；`(tag)` 是否存在於 MAP 必須用 `has()` 才能判別，不能只靠 `of()`。

### 4.3 建議：分層 + 人工確認，而不是全自動

- **A 層（預設勾選）**：`has(tag) && of(tag)==="character"` 且看起來像專名（例如帶 `(作品)` 括號，1,403 個候選）。即便如此仍**只當建議**，務必出現在預覽清單中可取消。
- **B 層（預設不勾，列出供人工勾選）**：同一 character 分類內的通用特徵（人數、髮、眼、年齡、泛角色）、cosplay／角色專屬服裝、expression 標籤。標示「可能與角色有關」。
- **C 層（永不自動處理）**：`has()===false`（unknown）、`other` 分類、`extra` 自由文字、`neg`。
- **一鍵「只換角色」的定義**：一鍵**開啟已準備好的預覽**（A 層預勾、B 層待確認），再一次確認才寫入。若產品要求真正單次點擊生效，至少要提供 toast 的「復原」；不建議在沒有預覽下直接刪標籤。
- 若未來要更準，可另建「角色專名白名單」資料（由 `character` 中帶作品括號者 + 人工維護），但這是資料工程，不應塞進本次最小實作。

---

## 5. 其他分類替換規則建議

### 5.1 通用規則（來源／刪除／保留／去重）

以下以**建議的預設方向 A（基底=目前，補丁=歷史的選取分類）**描述；若最終選 B，只要互換 `cur`/`hist` 角色，其餘規則不變。

- 對每個選取分類 `C`：
  - **刪除**：目前 `sel` 中 `has(t) && of(t) ∈ C` 的標籤（保留其原始索引）。
  - **加入**：歷史 `sel` 中 `has(t) && of(t) ∈ C` 的標籤，**原樣保留 `{t, w}` 與相對順序**。
  - **保留**：其餘所有標籤（含未選取分類、unknown、other）原樣、原順序、原權重。
  - **插入點**：第一個被刪除標籤的索引；若沒有刪除，則附加在尾端。
  - **去重**：用 `normKey()`（小寫、底線↔空白、trim）比對，避免 `long_hair` 與 `long hair` 並存；同一分類內歷史與目前都有的標籤，採歷史的 `w`（因為此分類以歷史為準），並在預覽標註「權重已更新」。
- **多分類**：所有選取分類的 remove/add 取聯集，**單次 `restore(nextSel)` 提交**，避免多次 commit 造成 sortMode/事件反覆抖動。
- **完整套用**：直接沿用 `reusePrompt(it)`，不經新流程（向後相容最高優先）。
- `other`／unknown：**不提供一鍵**，只允许在預覽中逐項人工勾選；即使勾選也須明確列出名稱。

### 5.2 單一分類的行為與注意事項

| 分類 | 來源場域 | 刪除範圍 | 保留 | 特殊風險 |
|---|---|---|---|---|
| character | character | 目前 character | 其餘全部 | 見第 4 節；預設只建議專名，B 層人工勾選 |
| clothing | clothing | 目前 clothing | 其餘全部 | 會連 cosplay／角色專屬服裝一起換；預覽可拆「可能與角色相關」子群 |
| body | body | 目前 body | 其餘全部 | 髮型/眼色在 character，只換 body 會出現「身體特徵換了、髮色沒換」 |
| pose | pose（516，分類乾淨） | 目前 pose | 其餘全部 | 低風險；`v`、`looking back` 都在此 |
| expression | expression（164） | 目前 expression | 其餘全部 | 與角色辨識重疊；WD14 既有把它跟 character 合看，需在 UI 提醒 |
| composition | composition（90） | 目前 composition | 其餘全部 | 含 `looking at viewer`、`full body`；常被誤以為是「構圖&光影」全部 |
| background | background（644） | 目前 background | 其餘全部 | 含 `halo`、`simple background` |
| style | style（141） | 目前 style | 其餘全部 | 品質詞（`masterpiece` 等）與光影詞都在此，會被一起換 |
| adult | adult（425） | 目前 adult | 其餘全部 | **`large breasts` 在 body、`lingerie` 在 clothing**：只換 adult 不會換掉全部成人內容；建議提示或提供「連動成人相關 body/clothing」的進階選項 |
| other | other + 所有 unknown | 僅人工勾選者 | 其餘全部 | 詞表外 6 個前端標籤也落在這裡；禁止整桶一鍵替換 |

### 5.3 重複與衝突處理

- 以 `normKey` 為唯一鍵；單次 planner 內先對 `add` 去重，再與 `keep` 比對。
- 若某標籤同時被判定「刪除」與「加入」（分類相同、名稱相同），最終只會出現一次，並採用歷史權重。
- 不重新排序未被選取的分類；不要在partial apply 呼叫 `sortSel()`。

---

## 6. extra 自由文字的處理建議

### 6.1 現況與限制

- 歷史的 `it.extra` 是 `extraRaw`：**原始輸入**，可能是中文、英文標籤或混合描述；`it.prompt` 才是翻譯後送到模型的結果。
- `Dict.tr()` 只處理它認識的中文詞；「女孩站在櫻花樹下」不會被拆成可靠標籤列，未翻譯的中文會從 `pos` 被丟掉，但仍留在 `extra` 裡。
- 逗號分隔**不足以正確分類**：全形逗號有被 `tr()` 取代，但自然語言片語、含括號權重 `(tag:1.2)`、底線/空格混用、以及完全沒有分類資訊，都讓「用 `of()` 對 extra token 分類後刪除」不可靠。
- `extra` 裡完全可能出現角色名、服裝、姿勢（例如使用者直接打「初音未來 女僕裝 回頭」）；把它當成「不算分類內容」而忽略也有風險。

### 6.2 建議（明確禁止危險做法）

1. **部分分類替換：`extra` 完全不動。** 不讀、不改 `#pos`、不寫 `ui.extra`。
2. **完整套用：維持現況**（`reusePrompt` 覆蓋為 `it.extra`），不因新功能改變。
3. 若產品確實要讓使用者帶走歷史的文字，提供**明確的額外選擇**而非自動行為：
   - 在對話框放一塊「補充描述」區：可編輯文字框預填**目前** `extra`，旁邊以只讀方式顯示**歷史** `extra` 供參考。
   - 三選一：`保留目前`（預設）／`取代為歷史`／`合併`；合併可沿用 `rvMergePrompt()` 的增量去重語意。
4. **不可提出「分類不明確就整段刪除 extra」的設計。** 也不可在 partial apply 中偷偷清空或覆蓋 `ui.extra`。

---

## 7. UI 操作方案（1920 × 1080 桌面）

### 7.1 現有燈箱

`index.html:257-272`：`.lb-top` 內已有 `lbDownload / lbSeed / lbPrompt / lbDel / lbClose` 五個小按钮；`app.css:1065-1111` 灯箱為全螢幕、z-index 100，`#modal` 為 101。再塞 10 個分類按鈕會擠爆頂列，也違反「一個主動作」的設計原則。

### 7.2 建議設計

- **頂列只加一顆** `<button id="lbApply" class="btn btn-ghost btn-sm">分類套用</button>`（放在 `lbPrompt` 與 `lbDel` 之間）。原有的「用同提示詞」保持不變，就是完整套用。
- 點了以後用既有 `openModal()` 開一個 `#modal`（z-index 101，自然是浮在燈箱上）；不新開_page_、不新增外部套件。燈箱可保留在後方，確認後一起關閉（與 `lbPrompt` 一致，focus 回到主畫面）。
- 視窗內容（沿用 `.modal-card` / `.modal-head` / `.modal-body` / `.modal-foot`，`max-height:84vh`、內部可捲、整頁不捲）：

  1. **一句話來源說明**：例如「以你現在的標籤為底，把勾選分類換成這張圖的內容；沒勾的都不動。」（若最終選方向 B，這句話要跟著改。）
  2. **快捷列**：`只換角色`、`只換服裝`、`只換姿勢`、`只換背景` 四顆常用一鍵 + `完整套用`（次要但明顯，直接走 `reusePrompt`）。點快捷列 = 預選分類並立即重算預覽，不是直接寫入。
  3. **分類勾選網格**：10 個核取方塊，2 欄 × 5 列，標籤用 `TagCategories.categories` 中文名 + 該分類在歷史／目前的筆數；`other` 旁加註「含未分類標籤，需逐項確認」。
  4. **替換預覽（核心）**：兩欄 chip 列表
     - 「會移除（目前）」：每一个即將被刪的標籤，中文名 + 英文名 + 權重；
     - 「會加入（這張圖）」：每一个即將被加的標籤，同样資訊。
     - 角色相關的 B 層／可能與角色相關的服裝 chip 預設不勾，前面放 `⚠` 與 tooltip「不確定是否跟角色有關，可自行勾選」；unknown/other 只出現在這裡且預設不勾。
     - chip 可點一下取消該項（即從 plan 中排除），預覽與計數即時更新。
  5. **補充描述**：摺疊區，預設「保留目前」；展開可選「取代／合併」并编辑文字框（見第 6 節）。
  6. **底部**：`取消` / `套用（移除 X · 加入 Y）`；按鈕在 X=Y=0 時停用並顯示「沒有可套用的變更」白話訊息。
- 若 `window.TagCategories` 不存在：整顆「分類套用」停用，並以白話提示「分類資料沒載入，請重新整理頁面；仍然可以用『用同提示詞』完整套用」。比照 `revCatWarn` 的處理。
- 所有動態文字走 `Dict.esc()`；chip hover 只用色塊/邊框，**不改變尺寸**；沿用 `dialogStack`，Esc 可關，focus 會回到 `lbApply`。

---

## 8. 建議的最小可靠實作方案

### 8.1 改動範圍（很小）

1. `index.html`：燈箱頂列加一顆 `#lbApply`。
2. `app.js`：新增三個純函式/流程，`reusePrompt()` 完全不動。
3. **不改** `tags.js`、`tag_categories.js`、`dict.js`、`server.py`、`app.css`（沿用既有 class 即可）。

提交選取時直接呼叫既有 `window.Tags.restore(nextSel)`：它會保存 `sel`、觸發 `tags:change`、更新 UI。已知副作用是它會把 `sortMode` 切成 `manual`（與現有完整套用一致）；若要求 partial apply 不改使用者的排序模式，才需要額外新增一個 `Tags.replace(sel, {keepSortMode:true})` API——但這會擴大改動，建議先接受既有行為並在報告中註記。

### 8.2 Planner 參考邏輯（唯讀設計，未寫入程式碼）

```js
const ALL_CATS = ["character","clothing","body","pose","expression",
                  "composition","background","style","adult","other"];
const NEVER_AUTO = new Set(["other"]);          // unknown 亦永不自動處理
function normKey(s){ return String(s||"").toLowerCase().trim().replace(/[_\s]+/g," "); }
function catOf(entry){
  const TC = window.TagCategories;
  if (!TC || typeof TC.has!=="function" || typeof TC.of!=="function") return null;
  const t = String((entry && entry.t) || entry || "").trim();
  if (!TC.has(t)) return null;                   // 未知 → null，不自動替換
  return TC.of(t) || "other";
}
function planApply(historyItem, cats){
  const cur  = window.Tags.snapshot();
  const hist = Array.isArray(historyItem && historyItem.sel) ? historyItem.sel : [];
  const want = new Set(cats);
  const remove = [], keep = [];
  cur.forEach((s,i)=>{
    const c = catOf(s);
    if (c && want.has(c) && !NEVER_AUTO.has(c)) remove.push({i,s,c});
    else keep.push(s);                            // 未選取分類原樣保留
  });
  const add = [], seen = new Set();
  hist.forEach(s=>{
    const c = catOf(s);
    if (!c || !want.has(c) || NEVER_AUTO.has(c)) return;
    const k = normKey(s.t);
    if (seen.has(k)) return;                      // 新清單內去重
    seen.add(k);
    if (keep.some(x=>normKey(x.t)===k)) return;   // 已存在且不在移除範圍 → 不重複
    add.push({s,c});
  });
  const at = remove.length ? Math.min(...remove.map(r=>r.i)) : cur.length;
  const next = keep.slice();
  next.splice(Math.min(at,next.length),0,...add.map(x=>x.s));
  return {next, remove, add, keep};               // preview 用 remove/add，提交用 next
}
```

`character` 的 A/B 分層在 `planApply` 之外做：先把 character 候選拆成 `strong`（建議）與 `review`（預設不勾），在預覽 UI 上由使用者增刪，再把最終 `cats` 與「排除清單」一起傳入 planner。

### 8.3 驗收建議（本階段不執行）

1. `node --check app.js`（以及 `index.html` 的 DOM id 對照）；不需動 `server.py`。
2. 用 `?v=N` 強制換文件；開燈箱 → 按「分類套用」→ 檢查 Console 0 錯誤、`document.documentElement.scrollHeight <= innerHeight`、`scrollWidth <= innerWidth`、`.modal-card` 沒有被裁切。
3. 以隔離資料（mock 歷史 item）驗證：只換 pose、只換 character、多分類、完整套用、unknown/other 不被動、extra 不被動、權重與順序保留、重複不產生。
4. 向後相容：`lbPrompt` / 卡片「同提示詞」的行為與 toast 完全不變。

---

## 9. 可能影響及風險

| 風險 | 等級 | 說明／緩解 |
|---|---|---|
| 方向矛盾（第 4.1 節） | **高** | 必須先確認 A/B；未確認就寫死會與需求相反。用 preview 的「移除/加入」兩欄在按下前暴露方向。 |
| `character` 含髮/眼/人數 | **高** | 一鍵全換會毀掉外觀設定。分層 + 預覽 + B 層預設不勾。 |
| 角色專名散在 clothing/expression | **高** | 只換 character 會留下角色 A 的衣服。預覽主動列出「可能與角色相關」的服裝供人工勾選。 |
| adult 跨 body/clothing | 中 | 「只換成人」不等於換掉全部成人內容；需提示或提供連動選項。 |
| unknown / other 桶 | 中 | `of()` 對未知回 other；用 `has()` 判別，永不自動刪。6 個前端 alias + 2,554 個 MAP other 都是地雷。 |
| 已學習標籤 | 中 | `ensureLearnedCategory()` 把學習標籤放進 `已學習·*` CATS，但它們不在 MAP → `of()` 回 other → 被保護、不會被自动換掉；需让使用者知道。 |
| `restore()` 副作用 | 低～中 | 會把 sortMode 切成 manual；與現有完整套用一致，但 partial apply 也可能非預期。 |
| 權重/順序 | 中 | 必須保留 `{t,w}` 與順序；用 `normKey` 去重；排序模式 manual 下不可再呼叫 `sortSel`。 |
| `extra` / `neg` | 中 | partial apply 不碰；完整套用維持原狀；禁止整段刪除自由文字。 |
| 多分頁同步 | 低 | `sel` 在 `SHARED_KEYS`；`restore()` 的 `commit()` 已走既有 `tags:change`/storage 路徑，不另寫 localStorage。 |
| XSS / 版面 | 低 | 所有動態文字 `Dict.esc()`；hover 不變尺寸；modal 沿用既有 class 與 z-index。 |
| 後端 / WS | 無 | 純前端改動，不碰 `server.py`、代理、WS、ComfyUI、WD14。 |
| 效能 | 無 | 單張 history 至多數十個 sel；MAP 是靜態物件，不逐筆重建。 |

---

## 10. 本次實際執行的檢查

全部為唯讀：

1. `git -C C:\ComfyUI\simple_ui status -sb`、`rev-parse HEAD`、`branch --show-current`、`remote -v`、`rev-list --left-right --count HEAD...origin/main`。
2. 讀取 `C:\ComfyUI\AGENTS.md` 與 `C:\ComfyUI\simple_ui\AGENTS.md`；確認 `.codegraph` 存在。
3. `codegraph_explore`（`projectPath: C:\ComfyUI\simple_ui`）三次：歷史生成/套用流程、TagCategories、Tags API。
4. 定點讀取原始碼：`app.js`（14–58、240–359、400–559、590–769、875–909、1040–1149、1149–1204、1660–1769）、`tags.js`（1–110、230–324、595–619、698–827、995–1084）、`tag_categories.js`（1–70、10960–11003）、`dict.js`（1–46）、`index.html`（250–362）、`app.css`（1065–1184）。
5. `grep` 定位 `reusePrompt / restore / addTags / matchTag / rvCatOf / RV_MODE_CATS / ui.gallery` 等所有引用點。
6. Python 完整解析 `tag_categories.js`（10,959 筆）與 `tags.js` CATS（725 alias）：分類計數、前端 × TagCategories 交叉表、正規化後覆盖率、character 通用特徵關鍵字統計、cosplay/括號標籤、body/style/other 樣本、代表性標籤對應。
7. `git log --oneline -12 -- tags.js app.js` 與 `git log -S'w: 1' -- tags.js`：確認 `sel` 的 `{t,w}` 格式自初始 commit 即存在。
8. 未執行：瀏覽器自動化、服務連線／重啟、生成、WD14、任何高負載測試；未建立或刪除既有檔案（僅本報告）。

---

## 11. Git 最終狀態（確認沒有修改既有程式碼）

最後一次檢查在報告寫入後執行，結果見下方「最終驗證」區塊；預期狀態：

- tracked 檔案：**0 修改、0 新增、0 刪除**；
- 未追蹤檔案：原有 14 個報告 **+ 本報告** `devtools/reports/history-prompt-category-apply-investigation.md`；
- branch / HEAD / remote 與起始狀態相同，沒有 commit、push、stash、checkout、clean 等寫入操作。

### 最終驗證

```
$ git -C C:\ComfyUI\simple_ui status -sb
## main...origin/main
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

$ git -C C:\ComfyUI\simple_ui diff --stat
（無輸出）

$ git -C C:\ComfyUI\simple_ui rev-parse HEAD
b5ad7a8273df7309e67460992bb913c8e9df9963
```

結論：tracked 檔案零變更；HEAD、branch、remote 與起始一致；唯一新增的未追蹤檔案就是本報告，原有 14 個報告完整保留。
