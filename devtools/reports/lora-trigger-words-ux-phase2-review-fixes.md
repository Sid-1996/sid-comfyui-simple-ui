# LoRA Trigger Words Phase 2 — 獨立審查修正

日期：2026-11-26
Repository：`C:\ComfyUI\simple_ui`

---

## 1. 開工前狀態

| 項目 | 值 |
|---|---|
| Branch | `main`，`## main...origin/main [ahead 1]` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| Ahead / Behind | `1` / `0` |
| Staged | 0 |
| Tracked modified | 15 |
| Untracked | 82 個檔案（51 個 porcelain 項目） |
| Porcelain 總數 | 65 |

已讀 `C:\ComfyUI\AGENTS.md`、`C:\ComfyUI\simple_ui\AGENTS.md`、`devtools/reports/lora-trigger-words-ux-phase2.md`。

`codegraph status`：`Files 35 / Nodes 1,094 / Edges 4,837`，Pending `Added 5 / Modified 6` → **索引過期**。本輪不執行 sync（避免寫入衍生索引），以 Grep/Read 直接確認目前原始碼。

所有既有 modified 與 untracked 報告保留，未清理、未覆蓋、未重置。

---

## 2. 修改檔案及原因

| 檔案 | 原因 |
|---|---|
| `app.js` | 三項修正：容量感知加入、一般使用者文案、`loadCivMeta()` 失敗路徑的過期請求防護 |
| `devtools/lora_core_test.mjs` | 新增純函式 `loraAddPlan()` 的導出與 tests 25–29，驗證回報數量與保存結果一致 |
| `devtools/lora_ui_test.mjs` | 更新兩個文案斷言；新增 4 項 E2E（選用功能說明／40 詞上限 toast／滿額不成功／過期失敗不污染新版本） |
| `devtools/lora_trigger_words_ui_test.mjs` | 更新文案契約；驗證加入走 `loraAddPlan`、catch 也有版本守衛 |
| `devtools/lora_mock_civitai.py` | 版本 mock 改為「每個版本獨立設定」，新增 `delay_ms` 以模擬慢失敗；`/__mock/reset` 一併清空版本狀態 |
| 本報告 | 交付說明 |

**沒有**修改 `server.py`（任務要求執行的 `py_compile` 仍通過）、`app.css`、`index.html`、Workflow 串接、40 詞上限或任何模型／使用者資料。

---

## 3. 三項修正的實際行為

### 修正一：作者建議加入數量正確性

- 新增純函式 `loraAddPlan(existing, words)`，回傳 `{ next, added, skipped, room, duplicates }`：
  - 先對個人詞與傳入詞做 `loraCleanTriggers()` 正規化（維持去重要點與原有順序）。
  - `room = max(0, LORA_MAX_TRIGGERS - 目前個人詞數)`，上限仍為 **40**。
  - `taking = fresh.slice(0, room)`，`next = loraCleanTriggers(existing.concat(taking))`。
  - `added = next.length - existing.length`（**以保存後結果為準**），`skipped = fresh.length - taking.length`。
- `loraAddAuthorWords()` 改用此 plan：
  - 完全沒有剩餘容量且還有新詞 → 只顯示「我的觸發詞已滿（40 個），請先移除一些再加入」，**不顯示成功**。
  - 容量不足 → 只加入可容納的詞，toast 顯示實際加入數與「還有 N 個沒加入（已滿 40 個）」（warn）。
  - 全部重複 → 顯示「這些詞已經在我的觸發詞裡」，不修改資料。
  - **實際加入至少一個詞**才把 `noTriggerNeeded` 設為 `false`。
- 整組加入、逐詞加入、本機「全部加入我的觸發詞」都走同一函式，行為一致。

### 修正二：一般使用者文案

| 原文案 | 新文案 |
|---|---|
| 我的 Trigger Words（只有這些會放進 Prompt） | 我的觸發詞（只有這裡的詞會自動加入提示詞） |
| 本機 metadata 建議（作者提供） | 從模型檔案讀取的建議詞 |
| Civitai 指定版本建議（需自行連結版本） | Civitai 作者提供的建議詞 |
| 貼上版本 ID 或 civitai.com/models/… | 貼上 Civitai 版本頁面網址（選填） |
| 全部帶入（本機） | 全部加入我的觸發詞 |
| 這個 LoRA 不需要 Trigger Words | 這個模型不需要觸發詞 |
| 此來源沒有提供 Trigger Words | 這個來源沒有提供建議詞 |
| 沒有可讀取的 metadata | 沒有可讀取的資料 |

- Civitai 區塊明確加入：「這是選用功能，不知道怎麼設定可以直接略過，不影響生圖。」
- 按鈕改為「讀取建議」，未連結時提示「選填：貼上 Civitai 版本頁面網址（也可輸入純數字版本編號），再按『讀取建議』」。
- **保留**版本網址解析（`modelVersionId=`）與純數字 ID 輸入，資料來源區分沒有刪除；一般操作文案不再出現 metadata / fingerprint 等內部名詞。
- 原本程式碼註解中的「本機 metadata 建議」也一併改為「從模型檔案讀取的建議詞」。

### 修正三：Civitai 過期請求防護

`loadCivMeta()` 的成功路徑原本就檢查 `cur.authorSuggestions.civitai.versionId !== vid`；現在 `.catch()` 也做同樣檢查：

```js
.catch(e => {
  const cur = loraItem(name);
  if (!cur || cur.authorSuggestions.civitai.versionId !== vid) return;
  S.loraCiv[name] = { state: "error", error: cvTranslate(e) };
})
```

因此「先發版本 A 請求 → 切到版本 B → A 延遲失敗、B 成功」時，A 的失敗會被丟棄；B 的成功狀態保留。個人 `triggers`、本機建議都不受影響，API 失敗仍不擋生圖。

---

## 4. 新增測試及完整結果

| 指令 | 結果 |
|---|---|
| `node --check app.js` | 通過 |
| `python -m py_compile server.py` | 通過 |
| `node devtools/lora_core_test.mjs` | **29 tests passed**（原 24 + 新 5） |
| `python devtools/lora_api_test.py` | **23 tests passed**（無回歸） |
| `node devtools/lora_trigger_words_ui_test.mjs` | **9 tests passed**（文案/守衛契約更新後） |
| `node devtools/lora_ui_test.mjs …` | **63 UI tests passed**（原 60 + 新 4，另更新 2 個文案斷言） |
| `git diff --check` | 無錯誤輸出（只有 LF→CRLF 提示） |

新增 core tests 25–29：

1. 目前 0 詞，加入 5 詞 → `added=5`、`skipped=0`、`next.length=5`。
2. 目前 38 詞，加入 5 詞 → `room=2`、`added=2`、`skipped=3`、`next.length=40`，原有 38 詞順序不變。
3. 目前 40 詞再加入 → `room=0`、`added=0`、`skipped=1`、`next` 與原值完全相同。
4. 全部重複 → `added=0`、`skipped=0`、`next` 不變。
5. 部分重複且容量不足（39 + `[old0, fresh1, fresh2]`）→ `room=1`、`added=1`、`skipped=1`、`duplicates=1`，只加第一個新詞。

每項都驗證 `added === next.length - 原始個人詞數`，確保回報與保存一致。

新增 UI source 契約：三區新文案與選用功能說明存在；舊技術術語不再出現在面板文案；加入函式走 `loraAddPlan` 且不再直接使用未截斷的 `fresh.length`；`loadCivMeta` 的 catch 也有 `versionId !== vid` 守衛。

新增 E2E 4 項：選用功能說明與新文案、40 詞上限只加 1 個且 toast「已加入 1 個…還有 2 個沒加入」、滿額時不出現成功、舊版本延遲失敗不覆蓋新版本且個人詞/本機建議完好。

---

## 5. 隔離 E2E 執行方式及結果

完全未連正式服務：

```powershell
# 隔離 mock（port 18188 / 18189）與隔離 simple_ui（7861）
python devtools\lora_mock_comfy.py --port 18188 --capture <tmp>\cap.jsonl --prompt-delay 2
python devtools\lora_mock_civitai.py --port 18189
# server.py 以 ComfyUI embedded python 啟動，env：
#   COMFY_URL=http://127.0.0.1:18188
#   CIVITAI_API=http://127.0.0.1:18189/api/v1
#   SIMPLE_UI_PORT=7861
#   SIMPLE_UI_LOG_DIR=<tmp>\logs
#   WD14_TMP=<tmp>\wd14
node devtools\lora_ui_test.mjs --ui http://127.0.0.1:7861 --mock http://127.0.0.1:18188 --mockcv http://127.0.0.1:18189 --capture <tmp>\cap.jsonl
```

結果：**63 UI tests passed**，Console 0 非預期錯誤；Phase 1 的 53 項與 Phase 2 的 7 項全數回歸通過。E2E 同時確認只有個人觸發詞進入 Prompt、歷史重用不回退作者建議、版面不捲動。

註：後端 Civitai 快取 TTL 300 秒，連續執行 E2E 時需重啟隔離 server 以清空快取；本輪已如此處理。測試完成後三個隔離行程已終止、連接埠已釋放、暫存目錄已刪除。

---

## 6. Git 最終狀態

建立本報告前：`main` / HEAD `cf5609e0...` / ahead 1 / behind 0 / staged 0 / modified 15 / untracked 82 檔案（51 porcelain 項目）/ porcelain 65。

建立本報告後：untracked 83 檔案（52 porcelain 項目）/ porcelain 66；modified 仍 15、staged 仍 0、HEAD 未變。

本輪 **沒有** commit、push、stage、reset、restore、stash、checkout、clean。既有 15 個 modified 與所有 untracked 報告/檔案保留。

`git diff --check`：無錯誤輸出。

正式服務：未停止、未重啟、未連接 7860 / 8188；未讀取任何 API Key／Cookie／憑證；未做 GPU 生圖。

---

## 7. 尚未解決的問題

1. 容量不足時 toast 會明確告知未加入數，但使用者必須自行移除舊詞後再重新加入；沒有「自動替換最舊詞」功能（刻意不擴大範圍）。
2. `loraAddPlan()` 回報的 `duplicates` 是「先群組內去重再與個人詞比對」的結果；這是既有 `loraCleanTriggers` 語意，非新行為。
3. 過期請求防護只比較 versionId；若同一版本短時間內更換內容，仍以最後一次成功回應為準（既有 fingerprint 只作「已更新」提示）。
4. Civitai 仍無「立即重新抓取」按鈕，沿用 300 秒快取。
5. CodeGraph 索引仍過期；本輪位置以 Grep/Read 為準。

---

## 結語

三項審查修正已完成，未擴大功能範圍、未改 Workflow／40 詞上限、未碰憑證或正式服務。所有要求的檢查與測試均已執行且通過，等待 ChatGPT 再次獨立審查。
