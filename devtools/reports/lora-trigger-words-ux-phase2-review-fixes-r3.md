# Sid-simple-ui — LoRA Phase 2 最後 E2E 驗收補強

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
| Untracked | 84 個檔案（53 個 porcelain 項目） |
| Porcelain 總數 | 67 |

已讀 `C:\ComfyUI\AGENTS.md`、`C:\ComfyUI\simple_ui\AGENTS.md`，以及三份既有 Phase 2 報告。`codegraph status`：`Files 35 / Nodes 1,094 / Edges 4,837`，Pending `Added 5 / Modified 6` → **索引過期**；未執行索引寫入，以 Grep/Read 直接確認原始碼。

既有 modified 與 untracked 報告全部保留，未清理、未覆蓋、未重置。

---

## 2. 新增的 E2E 測試與實際 DOM 操作

修改檔案：**只有 `devtools/lora_ui_test.mjs`**。`app.js`、`server.py`、`app.css`、`index.html` 等產品程式**完全沒有修改**。

### 2.1 為什麼需要測試版 app.js（fixture 說明）

本機作者建議的正規化路徑是 `loadLoraMeta() → loraSetLocalGroups(name, meta.triggerWords) → loraNormGroups([triggerWords])`，而 `loraNormGroups()` 對單一外層群組只會產生**一組**。因此單靠 `/api/lora-meta` 回應無法讓 UI 持有「兩組各 30 詞」的本機建議狀態。

為不修改產品程式，測試在**隔離瀏覽器分頁**用 CDP `Fetch` 提供一份測試版 `app.js`（由磁碟原始碼做一行字串替換後送上，磁碟檔案不變）：

```js
// 原（產品）
const next = loraNormGroups([Array.isArray(groups) ? groups : []]);
// 測試版：巢狀 triggerWords 視為多組
const next = loraNormGroups(Array.isArray(groups) && groups.length && Array.isArray(groups[0])
  ? groups : [Array.isArray(groups) ? groups : []]);
```

同時以 CDP 攔截 `/api/lora-meta`，回傳 `meta.triggerWords = [manyA, manyB]`（兩組各 30 個不同詞，共 60）。兩者都只存在於該隔離分頁，並在測試結束前清空 override。

### 2.2 真 DOM 步驟

1. `Page.reload({ignoreCache:true})` 後等待 `#btnLoraPick` 出現，讓測試版 app.js 與 mock metadata 生效。
2. 點擊「選擇」開啟 LoRA Modal，點 `MockMiku` 的「觸發詞」按鈕。
3. 等待本機建議區出現 **2 個** `[data-src=local][data-lora-act=add-group]`（兩組建議确实进入 UI 狀態）。
4. 以真 DOM 點擊「×」清空個人觸發詞，並從 `localStorage.ui.loras` 確認為 **0**。
5. 記錄另一個 LoRA（`Lineart`）的設定與 `#pos` 內容。
6. **實際點擊** `[data-lora-act="use-meta"]`（「全部加入我的觸發詞」）。
7. 等待 `localStorage.ui.loras` 更新完成後讀取實際保存結果。

### 2.3 驗收條件（全部成立）

- `triggers.length === 40`。
- 順序完全等於 `manyA0…manyA29, manyB0…manyB9`（逐項 `JSON.stringify` 比對）。
- toast 同時包含「已加入 40 個觸發詞」與「還有 20 個沒加入」。
- `noTriggerNeeded === false`。
- `Lineart` 的 JSON 與點擊前完全相同；`#pos` 內容不變。
- Console 0 非預期錯誤。

測試輸出：`PASS 最後 E2E：真 DOM 點擊本機『全部加入我的觸發詞』，40 詞保存、20 詞明確回報`。

---

## 3. 完整測試結果

| 指令 | 結果 |
|---|---|
| `node --check app.js` | 通過 |
| `node --check devtools/lora_ui_test.mjs` | 通過 |
| `python -m py_compile server.py` | 通過 |
| `node devtools/lora_core_test.mjs` | **33 tests passed** |
| `python devtools/lora_api_test.py` | **23 tests passed** |
| `node devtools/lora_trigger_words_ui_test.mjs` | **9 tests passed** |
| `node devtools/lora_ui_test.mjs …` | **65 UI tests passed**（原 64 + 本輪 1） |
| `git diff --check` | 無錯誤輸出（只有 LF→CRLF 提示） |

---

## 4. 隔離 E2E 環境與清理

- Mock ComfyUI：`127.0.0.1:18188`（`lora_mock_comfy.py`，`--prompt-delay 2`，獨立 capture）。
- Mock Civitai：`127.0.0.1:18189`（`lora_mock_civitai.py`）。
- 隔離 Simple UI：`SIMPLE_UI_PORT=7861`，以 **ComfyUI embedded Python** 啟動：
  `C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe`，避免 system Python 缺少 `folder_paths`。
- 其餘環境變數：`COMFY_URL=http://127.0.0.1:18188`、`CIVITAI_API=http://127.0.0.1:18189/api/v1`、獨立 `SIMPLE_UI_LOG_DIR` 與 `WD14_TMP`。
- headless Chrome：獨立 `--user-data-dir` profile，測試後由測試腳本 kill 並刪除 profile。

結束後主動終止本次建立的三個隔離行程；`Get-NetTCPConnection -LocalPort 7861,18188,18189 -State Listen` 回傳空（`PORTS_FREE`），暫存目錄已刪除。

正式 Simple UI 7860、ComfyUI 8188、WD14 Worker：未連接、未重啟、未停止。沒有 GPU 生圖、沒有讀取任何 API Key，也沒有 Git 寫入操作。

---

## 5. Git 最終狀態

建立本報告前：`main` / HEAD `cf5609e0...` / ahead 1 / behind 0 / staged 0 / modified 15 / untracked 84 檔案（53 porcelain 項目）/ porcelain 67。

建立本報告後：untracked 85 檔案（54 porcelain 項目）/ porcelain 68；modified 仍 15、staged 0、HEAD 不變。

`git diff --check`：無錯誤輸出。

**沒有** Stage、Commit、Push、Reset、Restore、Stash、Checkout、Clean；既有修改與所有 untracked 報告保留。

---

## 6. 未解決問題與風險

1. 測試使用 CDP 提供「測試版 app.js」才能讓本機建議形成兩組；這是為了不修改產品程式。若日後重構 `loraSetLocalGroups()` 的程式碼形狀，測試中的字串替換點需同步更新（測試本身會明確失敗，不會靜默通過）。
2. 本機 metadata 的正式來源（後端 `fetch_lora_meta()`）仍最多回傳 20 詞；真實環境難自然出現兩組各 30 詞。此測試驗證的是 `loraAddPlan()` 在「本機全部加入」路徑上的容量統計，不代表真實模型一定會提供 60 詞。
3. 個人詞 40 上限不變；超過的詞需使用者自行移除後再加入。
4. Civitai 仍沿用 300 秒快取；連續跑 E2E 需重啟隔離 server 以清空快取，本輪已如此處理。
5. CodeGraph 索引仍過期；本輪以 Grep/Read 為準。

---

## 結語

最後一條真 DOM 操作路徑已補齊：本機建議區「全部加入我的觸發詞」在 60 詞輸入下實際保存 40 詞、明確回報 20 詞未加入，且順序、其他 LoRA 設定與使用者描述都不受影響。所有要求的檢查與測試通過，產品程式未變動。等待 ChatGPT 獨立審查。
