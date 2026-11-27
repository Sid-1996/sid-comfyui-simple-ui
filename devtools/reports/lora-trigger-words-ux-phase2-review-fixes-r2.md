# LoRA Trigger Words Phase 2 — 第二輪審查最後修正

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
| Untracked | 83 個檔案（52 個 porcelain 項目） |
| Porcelain 總數 | 66 |

已讀 `C:\ComfyUI\AGENTS.md`、`C:\ComfyUI\simple_ui\AGENTS.md`、`devtools/reports/lora-trigger-words-ux-phase2.md`、`devtools/reports/lora-trigger-words-ux-phase2-review-fixes.md`。

`codegraph status`：`Files 35 / Nodes 1,094 / Edges 4,837`，Pending `Added 5 / Modified 6` → **索引過期**。本輪不執行 sync（避免寫入衍生索引），以 Grep/Read 直接確認目前原始碼。

所有既有 modified 與 untracked 報告保留，未清理、未覆蓋、未重置。

---

## 2. 根因

`loraCleanTriggers()` 同時做兩件事：清理／去重，以及 `slice(0, LORA_MAX_TRIGGERS)`（40 詞保存上限）。

前一輪新增的 `loraAddPlan()` 用 `loraCleanTriggers(words)` 清理作者建議，因此：

- 45 個不同的新詞在計算 `skipped` **之前**就被截成 40 個；
- `fresh.length` 只剩 40，`skipped = 0`，實際上有 5 個詞被靜默丟棄；
- 本機作者建議允許多組、每組最多 40 詞，兩組各 30 詞合起來 60 詞時，問題更明顯。

這是「統計用清理」與「保存上限」混在同一函式造成的。

---

## 3. 修改內容

### 3.1 `app.js`

1. 新增 `loraCleanTriggerList(list)`：與原本完全相同的清理／正規化／去重邏輯（換行轉空白、trim、單詞 ≤200 字、以 `loraNorm()` 去重、保留順序），但**不套用 40 詞截斷**。
2. `loraCleanTriggers(list)` 改為 `loraCleanTriggerList(list).slice(0, LORA_MAX_TRIGGERS)`：對外行為與 Phase 1 完全相同，**個人詞 40 上限不放寬**。
3. `loraAddPlan()` 改用 `loraCleanTriggerList(words)` 清理傳入的作者建議：
   - `cur` 仍用 `loraCleanTriggers(existing)`，個人詞仍限 40；
   - `clean` 保留所有有效、去重後的作者建議；
   - `fresh = clean.filter(未被個人詞收錄)`；
   - `room = max(0, 40 - cur.length)`，`taking = fresh.slice(0, room)`；
   - `next = loraCleanTriggers(cur.concat(taking))`；
   - `added = next.length - cur.length`（以實際保存結果為準）；
   - `skipped = fresh.length - taking.length`（因容量不足未加入的**唯一新詞**數）；
   - `duplicates = clean.length - fresh.length`（與個人詞重複的數量；群組內重複先被清理，不計入）。
4. `loraAddAuthorWords()` 的空值檢查也改用 `loraCleanTriggerList(words)`，其餘行為不變：`noTriggerNeeded` 只在實際加入至少一個詞時設為 `false`。
5. 整組加入、逐詞加入、本機「全部加入我的觸發詞」全部沿用同一 `loraAddAuthorWords()` → `loraAddPlan()` 路徑。

### 3.2 測試檔

- `devtools/lora_core_test.mjs`：導出 `loraCleanTriggerList`，新增 tests 30–33（見下）。
- `devtools/lora_trigger_words_ui_test.mjs`：test 3 增加契約檢查——`loraAddPlan` 必須用 `loraCleanTriggerList(words)`；`loraCleanTriggerList` 不得含 40 截斷；`loraCleanTriggers` 仍須 `slice(0, LORA_MAX_TRIGGERS)`。
- `devtools/lora_ui_test.mjs`：新增一項真 DOM E2E（60 詞 → 保存 40、回報 20）。

**沒有**修改 `server.py`、`app.css`、`index.html`、Workflow、API Key 路徑或任何模型／使用者資料。

---

## 4. 測試結果

| 指令 | 結果 |
|---|---|
| `node --check app.js` | 通過 |
| `python -m py_compile server.py` | 通過 |
| `node devtools/lora_core_test.mjs` | **33 tests passed**（原 29 + 新 4） |
| `python devtools/lora_api_test.py` | **23 tests passed**（無回歸） |
| `node devtools/lora_trigger_words_ui_test.mjs` | **9 tests passed** |
| `node devtools/lora_ui_test.mjs …` | **64 UI tests passed**（原 63 + 新 1） |
| `git diff --check` | 無錯誤輸出（只有 LF→CRLF 提示） |

新增 core tests：

- **A（test 30）**：輸入 45 個不同詞、個人詞 0 → `added=40`、`skipped=5`、`next.length=40`；另驗證 `loraCleanTriggerList(45)=45`、`loraCleanTriggers(45)=40`。
- **B（test 31）**：輸入 45 個不同詞、個人詞已有 38 → `room=2`、`added=2`、`skipped=43`、`next.length=40`，原有 38 詞與順序完全不變，只加入 `new0/new1`。
- **C（test 32）**：兩組各 30 個不同詞合併（即「全部加入」的 `reduce(concat)` 形狀）→ 保存 40、`added=40`、`skipped=20`，第一組 30 詞完整保留、第二組加入前 10 詞。
- **D（test 33）**：45 項中含 1 個與個人詞重複、2 個群組內重複 → `duplicates=1`、`added=39`、`skipped=3`，只有唯一新詞 `n39/n40/n41` 計入 skipped，重複詞不重複加入。

每項都驗證 `added === next.length - existing.length`。

---

## 5. 隔離 E2E

### 5.1 執行方式

```powershell
# 隔離服務：mock ComfyUI 18188、mock Civitai 18189
python devtools\lora_mock_comfy.py --port 18188 --capture <tmp>\cap.jsonl --prompt-delay 2
python devtools\lora_mock_civitai.py --port 18189

# 隔離 Simple UI 7861：使用 ComfyUI embedded python 以保留 folder_paths 偵測
C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe devtools\..\server.py
# env: COMFY_URL=http://127.0.0.1:18188
#      CIVITAI_API=http://127.0.0.1:18189/api/v1
#      SIMPLE_UI_PORT=7861, SIMPLE_UI_LOG_DIR=<tmp>\logs, WD14_TMP=<tmp>\wd14

node devtools\lora_ui_test.mjs --ui http://127.0.0.1:7861 --mock http://127.0.0.1:18188 --mockcv http://127.0.0.1:18189 --capture <tmp>\cap.jsonl
```

### 5.2 結果

**64 UI tests passed**，Console 0 非預期錯誤。Phase 1（53）、Phase 2（7）、第一輪審查修正（4）與本輪新增（1）全數通過。

新增項目真 DOM 行為：mock Civitai 版本提供兩組各 30 詞（合計 60），先清空個人詞，再逐組按「整組加入」；第一次保存 30，第二次只保存 10，localStorage 最終 40 詞且順序為 `manyA0…manyA29, manyB0…manyB9`；toast 明確顯示「已加入 10 個觸發詞」與「還有 20 個沒加入（已滿 40 個）」，不再是 0。

> 說明：本機 metadata 建議由後端 `fetch_lora_meta()` 限制每份最多 20 詞，無法在真 DOM 中直接取得 60 詞；因此「60 詞 → 40 保存／20 未加入」的 E2E 使用 Civitai 兩組建議，兩次「整組加入」都走同一個 `loraAddAuthorWords()` → `loraAddPlan()`。本機「全部加入我的觸發詞」的合併形狀（兩組 concat 後一次傳入）由 core test 32 直接覆蓋，既有的 use-meta E2E 也持續通過。

### 5.3 清理

測試後已終止 mock ComfyUI、mock Civitai、隔離 Simple UI 與 headless Chrome；`Get-NetTCPConnection -LocalPort 7861,18188,18189 -State Listen` 回傳空（三個連接埠皆已釋放）；暫存目錄已刪除。正式 7860／8188／WD14 Worker 未連接、未重啟、未停止。

---

## 6. Git 狀態

建立本報告前：`main` / HEAD `cf5609e0...` / ahead 1 / behind 0 / staged 0 / modified 15 / untracked 83 檔案（52 porcelain 項目）/ porcelain 66。

建立本報告後：untracked 84 檔案（53 porcelain 項目）/ porcelain 67；modified 15、staged 0、HEAD 不變。

`git diff --check`：無錯誤輸出。

**沒有**執行 stage、commit、push、reset、restore、stash、checkout、clean；既有修改與所有 untracked 報告保留。

---

## 7. 尚未解決的風險

1. 個人詞 40 上限仍存在；超過的詞需使用者自行移除舊詞後再加入，沒有自動替換（刻意不擴大範圍）。
2. `duplicates` 的語意是「清理後與個人詞重複的數量」；群組內部重複先被 `loraCleanTriggerList()` 消除，不算在 `duplicates` 或 `skipped`（與前一輪測試 28 一致）。
3. 作者建議單一群組仍受 `loraCleanTriggers()` 的 40 詞限制（本機 metadata 後端本身也最多 20 詞）；此限制是作者建議的呈現上限，不是個人詞上限，本輪未變動。
4. Civitai 仍沿用 300 秒快取，沒有「立即重新抓取」按鈕。
5. CodeGraph 索引仍過期；本輪位置以 Grep/Read 為準。

---

## 結語

最後一項邊界條件已修正：清理與保存上限分離，`skipped` 現在完整反映因容量不足未加入的唯一新詞。所有要求的驗收命令都已執行且通過，未擴大功能範圍、未碰憑證或正式服務。等待 ChatGPT 獨立審查。
