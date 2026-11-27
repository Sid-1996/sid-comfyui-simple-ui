# Open-Source Readiness — Phase 3R1-R：獨立審查問題修正

## 0. 結論

只處理 ChatGPT 獨立審查指出的兩個問題，未做其他重構：

1. **修正 A**：WD14 預設暫存目錄現在與自訂路徑**共用同一套安全驗證**；若與 `COMFY_OUTPUT_DIR` 重疊（相同、互為父子、或 realpath 正規化後重疊），回傳明確 `WD14_NOT_CONFIGURED`，基本生圖不受影響。
2. **修正 B**：日誌目錄/檔案不可寫時，`start_comfy()` **不再取消**使用者明確指定的 `COMFY_LAUNCH_CMD`；改用 `subprocess.DEVNULL`，照樣呼叫 `Popen`，argv 完全不變，已開啟的句柄保證關閉。

全部測試通過；正式服務未受影響；未 commit / push / stage。

---

## 1. 兩個問題的原始根因

### 1.1 WD14 預設暫存目錄缺少安全檢查

`_parse_wd14_tmp()`（原 `server.py:186-202`）一開始就：

```python
if not path:
    return os.path.join(DATA_DIR, "wd14-tmp"), ""   # 直接回傳，跳過所有驗證
```

自訂 `WD14_TMP` 會經過磁碟根 / Repo / output 重疊檢查，但**預設值完全沒檢查**。當 `COMFY_OUTPUT_DIR` 恰好等於 `DATA_DIR` 或其祖先時，預設暫存目錄會落在輸出目錄內，purge 與暫存寫入可能碰到使用者的輸出圖片。

### 1.2 日誌失敗取消使用者啟動指令

`start_comfy()`（原 `server.py:311-326`）把 `os.makedirs(LOG_DIR)` 與兩個 `open()` 包在同一個 `try`：

```python
except OSError as exc:
    return False, "LOG_DIR_ERROR", "無法寫入日誌目錄，已取消啟動：%s" % exc
```

日誌只是診斷用途，但其中任何一步失敗就直接 return，**完全不會執行 `subprocess.Popen()`**，違反「明確設定的啟動指令應被執行」的要求。此外原本只有成功路徑才 `close()`，第二個 `open()` 失敗時第一個句柄沒有_close 路徑（雖然後續因為 return 不會洩漏到 Popen，但結構不夠健全）。

---

## 2. 修改檔案及目的

| 檔案 | 變更 | 目的 |
|---|---|---|
| `server.py` | 修改（+19 / -3 行，相較 Phase 3R1） | A：把預設暫存路徑導入既有驗證流程；B：日誌失敗改用 DEVNULL、仍執行 Popen、保證句柄關閉 |
| `devtools/reports/open-source-readiness-phase3r1r.md` | 新增 | 本報告 |

`README.md`、`app.js` 與既有八份報告**未再修改**。

---

## 3. 修正後的路徑安全規則 `【實際執行 + 靜態檢查】`

```python
def _parse_wd14_tmp(raw):
    path, err = _parse_dir_override(raw, "WD14_TMP")   # 自訂：絕對路徑 + expandvars + realpath
    if err: return "", err
    if not path:
        path = os.path.join(DATA_DIR, "wd14-tmp")       # 預設：同樣進下面流程
    real = os.path.realpath(path)                       # 一律 realpath 正規化
    if real == os.path.dirname(real): reject 磁碟根
    if _is_within(ROOT, real): reject Repo 上層
    if _is_within(real, ROOT): reject Repo 內部
    if OUTPUT_DIR and (雙向 _is_within): reject 與 COMFY_OUTPUT_DIR 重疊
    return real, ""
```

`_is_within()` 使用 `os.path.commonpath([realpath(a), realpath(b)])`，不同磁碟機等例外回 False，不會誤判。無效情境只讓 `wd14_missing_config()` 回 `WD14_NOT_CONFIGURED`（HTTP 503）；`main()` 不建立目錄、不檢查 WD14 是否可用，基本服務照常啟動。

新增測試（`test_wd14_default_tmp.py`，13/13 PASS）涵蓋：

| 情境 | 結果 |
|---|---|
| 正常預設路徑 | 接受 |
| 預設 == `COMFY_OUTPUT_DIR` | 拒絕 |
| 預設在 `COMFY_OUTPUT_DIR` 之下 | 拒絕 |
| `COMFY_OUTPUT_DIR` 在 `DATA_DIR` 下但與預設同層 | 接受 |
| `COMFY_OUTPUT_DIR` 是 `DATA_DIR` 的上層 | 拒絕 |
| 正常自訂路徑 | 接受 |
| 自訂指向 Repo / Repo 上層 / output 本身 / output 子目錄 / 磁碟根 | 全部拒絕 |
| 含 `..` 的路徑 | realpath 正規化後正確比對 |
| 無效預設 | 只產生 `WD14_NOT_CONFIGURED` 原因，不影響主服務 |

端對端：以 `COMFY_OUTPUT_DIR = DATA_DIR` 啟動隔離 server，`/api/status` 仍 200、`/comfy/view` 等基本流程可用；`POST /api/reverse` 回 503。`【隔離 Mock 測試】`

---

## 4. 日誌失敗時的實際啟動行為 `【實際執行（Mock Popen）】`

修正後流程：

1. 個別 `try` 建立 LOG_DIR、開 `comfyui.log`、開 `comfyui.err.log`；失敗原因收集到 `log_notes`。
2. 失敗的串流改用 `subprocess.DEVNULL`；成功的串流維持原檔案handle。
3. 印一行診斷到 stderr（含原因），**不 return、不取消**。
4. `Popen(args, stdout=..., stderr=..., creationflags=CREATE_NO_WINDOW)` 照樣執行；`args` 只來自 `COMFY_LAUNCH` + 既有 `COMFY_OUTPUT_DIR` 規則。
5. `finally` 關閉所有已開啟的 handle（含 Popen 失敗時）。
6. 成功回傳 `ok=True` 並在 `error` 欄附上日誌診斷；`Popen` 本身失敗仍回 `START_FAILED`；未設定指令仍回 `START_NOT_CONFIGURED`；逾時仍回 `START_TIMEOUT`。

新增測試（`test_log_failure.py`，36/36 PASS）：

| 情境 | 結果 |
|---|---|
| `os.makedirs(LOG_DIR)` 失敗 | Popen 被呼叫；stdout/stderr 皆 DEVNULL；argv 完全一致；ok=True |
| `comfyui.log` 開啟失敗 | Popen 被呼叫；stdout=DEVNULL、stderr=原檔案handle；handle 關閉 |
| `comfyui.err.log` 開啟失敗 | Popen 被呼叫；stdout=原檔案handle、stderr=DEVNULL；handle 關閉 |
| 兩個檔案都失敗 | 兩者皆 DEVNULL；ok=True |
| 部分成功 | 已開啟的 handle 在 finally 全部關閉 |
| Popen 本身失敗 | 回 `(False, "START_FAILED", ...)`，handle 仍關閉 |
| 正常日誌目錄 | 兩個檔案handle 正常開啟並關閉，argv 不變 |

---

## 5. 新增測試、實際命令與結果

| 項目 | 命令 | 結果 |
|---|---|---|
| Fix A 路徑安全 | `python <base>\test_wd14_default_tmp.py` | 13 PASS / 0 FAIL |
| Fix B 日誌故障 | `python <base>\test_log_failure.py` | 36 PASS / 0 FAIL |
| Phase 3R1 purge 回歸 | `python <base>\test_purge.py` | 8 PASS / 0 FAIL |
| Phase 3R1 argv 回歸 | `python <base>\test_launch.py` | 5 PASS / 0 FAIL |
| Phase 3R1 WS 回歸 | `python <base>\ws_test.py <mode> 63318`（normal / samechunk / split / multiframe / fail） | 5 模式全 PASS；frame 位元組完全一致；binary 256 bytes 完全一致；失敗 handshake 回 502 含原因 |
| Fix A 端對端 | 隔離 server + `COMFY_OUTPUT_DIR=DATA_DIR`，`POST /api/reverse` | 503 `WD14_NOT_CONFIGURED`；`/api/status` 仍 200 |
| 語法 | `python -m py_compile server.py` | exit 0 |
| 語法 | `node --check app.js / tags.js / dict.js / tag_categories.js` | 全部 exit 0 |
| Diff | `git diff --check` | exit 0 |

隔離環境：公開 Repo clone + 複製 3 個修改檔；Mock ComfyUI Port 63317、simple_ui Port 63318；`LOCALAPPDATA` 指向隔離目錄。測試程序與 temp 目錄已清除，Port 監聽數皆 0。

`【實際執行】` 與 `【隔離 Mock 測試】` 已於上表標註；本階段沒有任何真實 ComfyUI / GPU 生圖或真實 WD14 推論。

---

## 6. 未執行測試及原因 `【未執行】`

| 項目 | 原因 |
|---|---|
| 真實 ComfyUI 啟動 / GPU 生圖 | 正式環境保護禁止；以 Mock Popen 與 Mock ComfyUI 驗證 |
| 真實 WD14 推論 | 禁止使用正式 `C:\ComfyUI\tools` Worker |
| 真正讓 LOG_DIR 權限失效的 OS 層測試 | 以 in-process monkeypatch 精確模擬 `makedirs` / `open` 失敗，避免更動本機 ACL |
| 原有 devtools 硬編碼正式路徑的測試腳本 | 直接執行會違反正式環境保護；已以隔離重寫的同等測試覆蓋，未刪除原本腳本 |
| 高負載 / 效能測試 | 明確禁止 |

---

## 7. Git Branch、HEAD、工作區狀態 `【實際執行】`

```
## main...origin/main
 M README.md
 M app.js
 M server.py
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
```

- Branch：`main`；HEAD：`76da5a5f4f480f63fca679ccb3435bff7320a8c5`；Remote 不變。
- Staged：空；未執行 commit / push / reset / restore / stash / checkout / clean。
- 既有八份歷史報告完整保留，本次唯一新增檔案為本報告。

---

## 8. 正式服務是否受到影響

- 正式 ComfyUI、simple_ui、WD14 Worker：未停止、未重啟、未修改。
- 7860 / 8188：開始與結束皆無 Listen。
- 正式環境變數、模型、Workflow、圖片、venv、依賴：未更動。
- 測試程序以完整 CommandLine + PID 核對後終止；溫度資料全部位於隔離 `%TEMP%` 且已刪除。

---

## 9. 尚存風險

1. `_parse_wd14_tmp()` 的安全性依賴 `os.path.realpath` 與 `commonpath`；Windows junction / symlink 的行為在無系統管理員權限下未能以真實 symlink 驗證，本次以 `..` 正規化與 `commonpath` 邊界測試覆蓋。
2. 日誌失敗時診斷訊息只印在 stderr 並附在成功的 `error` 欄位；若使用者完全不看終端機，可能不知道日誌被略過，但啟動本身不受影響。
3. 既有開發者工具（`ui_control.ps1`、`ui_panel.pyw`、`devtools/wd14_*_test.py`）仍含絕對路徑，依前三階段範圍刻意保留；一般使用者流程不會碰到。
4. 真實 ComfyUI 的 WebSocket 首幀時序仍待合法環境確認（Mock 已覆蓋同 chunk 與分段兩種極端）。

---

完成後停止，不進行下一階段，不 Commit / Push。
