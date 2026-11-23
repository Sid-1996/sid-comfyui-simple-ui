# Sid-simple-ui — Phase 1：標籤學習輕量統計與治理

> 文件性質：Phase 1 實作與驗收紀錄。本次**沒有**引入 Embedding 模型、沒有新增 Worker、沒有修改 ComfyUI workflow、沒有 GPU 生圖。
> 日期：2026-11-23。
> 用語：[已實作] / [已測試] / [尚未測試] / [僅為未來建議]。

---

## 1. Git 起始狀態

| 項目 | 起始值 |
|---|---|
| Branch | `main` |
| HEAD | `3b0b039210c4d9b746d64fc5787852e32e9f997e` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push） |
| 與 origin/main | 0 ahead / 0 behind |
| 工作區 | `M app.css`, `M app.js`, `M index.html`, `M tags.js`（376 insertions / 119 deletions） |
| 既有修改 | 全部視為使用者重要工作，**未回退、未覆蓋、未重構**；所有新程式碼都疊在磁碟上最新版本之上 |

**服務起始狀態（已確認，未更動）**：7860 = PID 14132（`C:\ComfyUI\simple_ui\server.py`），8188 = PID 11720（ComfyUI），WD14 Worker 4 個（EVA02 ×2、ViT v3 ×2）。

---

## 2. 修改檔案清單及目的

| 檔案 | 狀態 | 目的 |
|---|---|---|
| `tags.js` | 修改 | 新增權威正規化 `canonicalTag()`、`ui.tagStats` 引擎、收藏 API、兩個個人 virtual 分類、標籤上的 ★ 收藏入口；既有 `learn()` / `clearLearned()` / `matchTag()` / `sel` / `combos` 完全保留 |
| `app.js` | 修改 | 在**唯一成功路徑**紀錄一次統計；storage event 接受 `ui.tagStats*` 前綴；既有 `wf()`、`generate()`、WD14、燈箱、快捷鍵未動 |
| `app.css` | 修改 | 新增 `.cat-vicon` 與 `.tag-fav` 樣式；星號固定 11px 預留寬度，只改 opacity，hover 不改尺寸 |
| `index.html` | 修改 | 配合既有 UI／反推標籤介面調整搜尋工具列、排序模式入口與反推操作文案；不是 Phase 1 統計功能本身的必要修改 |
| `devtools/tag_stats_test.js` | 新增 | 瀏覽器內自動化測試（58 項，mock generate，無 GPU） |
| `devtools/tag_stats_runner.mjs` | 新增 | 獨立臨時 Chrome profile 的 CDP 執行器 + 版面量測 |
| `devtools/reports/_tag_stats_test_report.json` | 新增 | 測試原始結果（純文字紀錄） |
| `devtools/reports/tag-learning-phase1.md` | 新增 | 本報告 |

未修改任何 Repo 外工具、模型或 venv。

---

## 3. 新增資料結構與 localStorage key [已實作]

主 key：`ui.tagStats`

```json
{
  "version": 1,
  "tags": {
    "long hair": {
      "positiveCount": 12,
      "negativeCount": 2,
      "lastUsedAt": 1790000000000,
      "favorite": false
    }
  },
  "updatedAt": 1790000000000
}
```

| key | 用途 | 寫入時機 |
|---|---|---|
| `ui.tagStats` | **base 快照**（只含已折入的count，绝不含 live evt，避免重複計算） | 成功生成／收藏切換；開頁只讀不寫 |
| `ui.tagStats.evt.<jobId>` | 一事一筆的事件：`{v:1, at, pos:[canonical], neg:[canonical]}`，`jobId` 用 `fileTag` UUID | 每次成功生成寫一個新 key |
| `ui.tagStats.fav.<encodeURIComponent(tag)>` | `{tag, favorite, at}`，一標籤一 key | 使用者點 ★ |
| `ui.tagStats.broken.<ts>` | 損壞／未知版本資料的**原樣備份** | 只在讀到壞資料時寫一次，之後移除原 key |

設計要點：

- **收藏沒有獨立成另一個主 key**，而是放在同一筆 record 的 `favorite` 欄位，但**權威來源是 fav key**。原因：收藏可存在於從未使用的標籤（record 的 count 為 0 仍可 favorite:true），且 independent LWW 需要各標籤自己的時間戳；若只用主 key 做整份覆寫，多分頁會互相蓋掉。相容策略：重建時永遠以 fav keys 覆寫快照中的 `favorite`，舊快照沒有 fav key 也不會使它損毀。
- `positiveCount` / `negativeCount` 分欄；`lastUsedAt` 為 Unix ms，取事件中最大值。
- 未知欄位忽略；`version !== 1` 或結構不對 → 備份原字串、以空資料繼續，**不覆蓋原始資料、不拋錯**。

---

## 4. 標籤正規化及權威資料來源 [已實作]

**明確不使用 `Tags.matchTag()` 作為統計依據**——它掃描的 `L` 在執行期會被 `ensureLearnedCategory()` 塞入個人學習標籤（`已學習·*`），把舊錯誤資料當成標準標籤。

`canonicalTag(raw)`（`tags.js:84`）的權威來源只有兩處，且在模組初始化時建立一次：

1. **內建 CATS**（跳過 `^已學習·`）：`english:中文` 的 `english` 以 `/` 拆分為明確別名，正規化（小寫 + `_`/空白互通 + trim）後映射到第一個片段作為 canonical；中文標籤建立 `中文 → canonical`。
2. **`window.Dict.DICT`**：中文 key → 英文 value，且 value 必須能解析到 CATS canonical 才收錄。

處理規則：

- `(tag:1.2)` 去除括號與權重；逗號/換行直接拒絕。
- 完全無法匹配 → 回 `null`，呼叫端**安靜略過**，不猜測、不統計。
- 自然語句（`pussy juice dripping down thighs`）、任意 WD14 原始輸出、動態學習標籤都不會被統計（N7/N8/N10 測試通過）。
- **沒有**做語意相近合併：不會把 `blue eyes` 合到 `blue hair`，也不會把 `miniskirt` 合到 `skirt`。

---

## 5. 成功生成的統計觸發位置及防重複 [已實作]

觸發點在 `app.js:456-478`，也就是 `waitFor(pid)` 已完成、且通過以下檢查**之後**：

1. `status.status_str !== "error"`；
2. 多張時检查 `execution_error`；
3. `hist.outputs["7"].images` 非空。

也就是失敗、取消（第 411、420 行提前 return）、讀取歷史圖片都不會走到統計。統計放在既有 `Tags.learn()` 之後、`toast()` 之前。

防重複機制：

- **一事一 key**：用 `fileTag`（每次生成產生的 UUID，本來就用来避免檔名碰撞）當 evt key 後綴；同一任務多張圖片只寫一筆。
- `recordGeneration()` 先檢查 key 是否存在，存在就直接 return（S7 測試）。
- 同一任務內 `uniq()` 先對 pos/neg 各自去重；正負分别計入不同欄位（同一 tag 同時在兩邊 → 兩欄各 +1，S4 測試）。
- 寫入失敗（quota/無痕）catch 後不影響生圖與 toast。
- `ui.tagStats` 的 base 快照**刻意不含 live evt**，每次重建都是 `base + evt keys + fav keys`，避免「base 已含事件又再加一次」的雙算（首輪測試曾抓到這個 bug，已修正，見 §9）。

---

## 6. 收藏功能 UI 操作方式 [已實作 / 已測試]

- 每個標籤 chip 前面有一個 ★（`.tag-fav`）：未收藏時 opacity 0 但**寬度固定 11px**，hover 只變透明度 → chip 尺寸與排列不因 hover 改變（實測 computed width `11px`）。
- 點 ★ → `toggleFavorite()` 寫 fav key 並立即重建/保存；`els.tags.onclick` **先攔截 `.tag-fav`** 再處理 `.tag`，所以收藏不會誤觸標籤選取（F2 測試）。
- 再點一次取消收藏；收藏/取消後立刻保存（F3/F5/F6）。
- 成人標籤、學習標籤若不是 CATS canonical，不能收藏（正規化回 null）。
- 沒有自動收藏：沒有任何程式碼依 count / lastUsedAt / combos / 生成成功去設 favorite。

---

## 7. 個人常用標籤呈現 [已實作]

沿用既有分類列與標籤格，新增兩個 **virtual 分類**（不進 CATS、不進 L）：

| 分類 | data-c | 顯示條件 | 內容 |
|---|---|---|---|
| 我的收藏 | `__fav__` | 永遠顯示（count 可為 0） | 所有 `favorite:true` 的 CATS 標籤 |
| 我的常用 | `__top__` | 有任何使用記錄時才出現 | 依 `positiveCount + negativeCount` 排序前 20 名 |

- 兩者都用既有 `.cat` 按鈕、既有 `.tag-group` / `.tag` 渲染，沒有新增頁面或大量重複標籤副本。
- 常用視圖的 tooltip 會寫「使用 N 次」，但**不顯示推薦分數、不把次數解讀成喜好**。
- 18+ 關閉時成人標籤仍被擋掉（先在原分類判斷，再轉 virtual 分類）。
- 搜尋方塊優先於 virtual 分類（輸入搜尋時照舊全庫搜尋）。

---

## 8. 跨分頁同步策略與競態 [已實作 / 已測試]

| 情境 | 策略 |
|---|---|
| 不同分頁更新不同標籤 | 各寫自己的 `evt.<jobId>`（UUID 唯一），不同 key 不衝突 |
| 不同分頁更新同一標籤 | 兩個 evt key 都在，重建時加總（X1/X5） |
| 收藏同步 | 一標籤一 fav key，帶 `at`；LWW，同一 ms 以「取消收藏」為準（保守，X5） |
| 舊分頁整份覆寫 | `ui.tagStats` 只是 base 快照，live evt 不在裡面；即使舊分頁寫入過期 base，也不會抹掉其他分頁的 evt 計數（X4） |
| 同步不寫回 | `syncFromStorage()` / `syncStatsFromStorage()` 用 `rebuildStats(false)`，唯讀；既有「storage 同步不寫入」測試仍通過（17/17） |
| 事件成長 | 不自動壓縮或刪除 evt；所有事件保留，重建永遠使用 base + 全部 evt + fav，避免跨分頁壓縮競態與計數遺失 |

**殘餘限制（誠實揭露）**：兩個分頁在**同一毫秒**對同一標籤做相反收藏操作時，以「取消收藏」收斂；這是刻意選擇的保守規則，非真正 CRDT。開頁/焦點/storage event 都會重建，因此短暫不一致會自行收斂。

---

## 9. 自動化測試及結果 [已測試]

| 測試 | 方式 | 結果 |
|---|---|---|
| `devtools/tag_stats_runner.mjs` → `tag_stats_test.js` | 獨立臨時 Chrome profile，mock fetch（兩張輸出），**無 GPU** | **58 passed / 0 failed** |
| 既有 `devtools/cross_tab_sync_test.js` | 同一 mock generate 方式，回歸 | **17 passed / 0 failed** |
| `node --check` | app.js / tags.js / dict.js / tag_categories.js / 兩個新測試檔 | 全部 OK |
| 版面量測（runner 內 MEASURE） | 1920×1080 | document 不垂直/不水平捲動；Console 0 錯誤、Page 0 錯誤 |

58 項測試涵蓋正規化、統計、收藏、UI、跨分頁競態／大量事件及舊資料相容性。原始資料：`devtools/reports/_tag_stats_test_report.json`。

**本輪抓到並修正的瑕疵**：初版 `rebuildStats(true)` 把 merged 結果（含 live evt）寫進快照但保留 evt key，導致連續重建時計數從 1 → 2 → 3 → 5 雙算。修正為「快照只寫 base、evt 保持 live」，且不自動壓縮或刪除 evt。修正後相關測試全數通過。

**未測試**：真實 GPU 生成（依限制不執行）；實體兩台 Chrome 視窗同時操作（以合成 `StorageEvent` 與直接寫入 evt/fav key 模擬）；WD14 反推流程（未改動其程式碼，也未啟動 worker）。

---

## 10. 原有功能相容性驗證 [已測試]

- 既有 17 項跨分頁回歸全通過，包含：`sel` / `adult` / `showEn` / `ui.learnedTags` / `ui.extra` 同步、同步期間不寫 localStorage、key 刪除、生成前重讀最新狀態、`Tags.learn()` 不覆蓋 `sel`、**點標籤仍正常**、舊 learnedTags 陣列格式、`'1'/'0'` 格式。
- 新測試額外驗證：點 ★ 不改變 `#selBar`（F2）、搜尋仍可用（U3）、`sel`/`adult`/`showEn` 未被統計操作改動（C5）、損壞統計不造成例外且 `Tags.selected()` 仍可用（C2/C3）。
- `matchTag()` 原有行為保持不變（N10 對照組證明它仍會找到學習標籤，而 `canonicalTag()` 不會）。
- `index.html` 有既有 UI／反推操作介面修改（搜尋工具列、排序模式入口、反推文案及操作狀態）；`app.css` 同時包含既有 UI 調整與本次收藏星號／分類圖示樣式。
- WD14 相關程式碼零更動；`wf()` workflow 零更動。

---

## 11. 正式服務是否受到影響

**沒有。** 開始與結束都確認：

- 7860 = PID 14132（同一個 `server.py`），8188 = PID 11720（同一個 ComfyUI）。
- `simple_ui\server.py` 行程數：**1 → 1**；WD14 Worker 數：**4 → 4**。
- 沒有停止/重啟任何服務或 Worker；沒有呼叫 `/prompt`；測試全部走 mock fetch；沒有安裝依賴、沒有下载模型。
- 測試browser使用 `--user-data-dir` 暫存 profile，沒有寫入使用者正式 Chrome 的 localStorage。

---

## 12. Git 最終狀態

| 項目 | 最終值 |
|---|---|
| Branch | `main`（不變） |
| HEAD | `3b0b039210c4d9b746d64fc5787852e32e9f997e`（不變，未 commit） |
| 與 origin/main | 0 / 0 |
| 既有修改 | `M app.css`, `M app.js`, `M index.html`, `M tags.js` — 本次工作涵蓋既有 UI／反推介面調整及 Phase 1 標籤統計，修改混合在同一批檔案中 |
| 新增（未追蹤） | `?? devtools/reports/`, `?? devtools/tag_stats_runner.mjs`, `?? devtools/tag_stats_test.js` |
| 禁止操作 | 無 commit / push / reset / rebase / stash / checkout / clean |

---

## 13. 尚未解決的問題及風險

1. **真實生成尚未驗證**（[尚未測試]）：統計只在 mock 兩張圖片上驗證；正式 GPU 生成一次後應確認 `ui.tagStats` 真的增加一筆 evt（可在 console 看 `ui.tagStats.evt.*`）。
2. **同時同毫秒收藏衝突**（[殘餘限制]）：以「取消收藏」收斂，不是嚴格 CRDT；對單人單機場景可接受。
3. **base 快照壓縮閾值 300**（[僅為未來建議]）：一般使用數年才會達到；若日後拆除 evt log，應把壓縮邏輯一併搬到server或明確版本遷移。
4. **模型有效性資料未建立**（[僅為未來建議]）：目前 `ui.tagStats` 刻意不含 checkpoint / text encoder / tokenizer 欄位，避免與使用統計混淆。未來可用獨立 key（例如 `ui.tagEffectiveness`）存 `{tag, ckptName, ckptSha256, encoderFp, tokenizerFp, verdict}`，並以固定 seed 的 A/B 生圖驗證；本次不預建空結構。
5. **沒有計數衰減 / 近期偏好**（[僅為未來建議]）：第一版只存累計 count 與 lastUsedAt，沒有 EWMA；避免把次數誤當喜好。
6. **鍵盤可及性**（[尚未測試]）：★ 是 `span`（不是 `<button>`，避免按鈕巢狀），滑鼠可點，但未做鍵盤 focus 操作；正式可及性需求若提高，需另設計。
7. **`tag_lookup.py` 既有 bug**（已知、未修改）：CATS 正則與目前 `tags.js` 縮排不符，與本次功能無關。

---

## 14. 重要 Diff 位置（供獨立審查）

| 位置 | 內容 |
|---|---|
| `tags.js:47-49` | key/prefix/version/MAX_EVENTS 常數 |
| `tags.js:52-82` | CATS/dict 權威 maps 建立（跳過 `已學習·`） |
| `tags.js:84-95` | `canonicalTag()` |
| `tags.js:97-133` | `num/safeParse/keysWith/recOf/readSnapshot`（含損壞備份） |
| `tags.js:135-219` | `rebuildStats()`（base/evt/fav 合併＋壓縮） |
| `tags.js:221-244` | `recordGeneration()` |
| `tags.js:246-263` | `toggleFavorite()` / `isFavorite()` / `statsSnapshot()` / `statsSignature()` |
| `tags.js:323-352` | `renderCats()` 的 `__fav__` / `__top__` virtual 分類 |
| `tags.js:371-377` | `groupItems()` 的 personal group |
| `tags.js:423-455` | `renderTags()` 的 personal 過濾、排序、★ 標記 |
| `tags.js:880-895` | `els.tags.onclick` 的 ★ 攔截（先於選取） |
| `tags.js:997` | `init()` 呼叫 `rebuildStats(false)` |
| `tags.js:1014-1024` | `Tags` 對外 API |
| `app.js:456-478` | 成功生成統計（唯一觸發點，與 learn 並列） |
| `app.js:1650-1652` | storage event 接受 `ui.tagStats*` |
| `app.css:425-426` | `.cat-vicon` |
| `app.css:494-503` | `.tag-fav`（固定 11px、只改 opacity） |

---

## 結論

[已實作] Phase 1 的統計、收藏、個人分類與治理機制；[已測試] 58+17 項自動化測試全通過、版面與 Console 正常；[尚未測試] 真實 GPU 生成與雙實體視窗；[僅為未來建議] 模型有效性資料與偏好衰減。

本次到此停止，不進入 Phase 2；未 commit、未 push。
