# Phase 2B-1：WD14 與基本服務啟動隔離 — 實作與驗證報告

## 1. 任務目標

讓 Sid-simple-ui 的基本服務**完全不依賴 WD14 選用功能**：

- 沒有 `C:\ComfyUI`、WD14 venv / Worker / 模型，或無權限建立原預設 `C:\ComfyUI\tmp\wd14` 時，仍能啟動 server、提供前端、透過既有 `/comfy` 代理與 `/ws` 隧道連接 ComfyUI，並使用基本生成／歷史／瀏覽功能。
- WD14 功能完整保留，且只在真正執行 `/api/reverse` 時才按需建立暫存目錄。

範圍外（依指示未處理）：`COMFY_URL`、ComfyUI 自動啟動、輸出目錄外部化、刪圖語意、`ui_control.ps1`、`ui_panel.pyw`、README、依賴清單。

---

## 2. 開始時 Git 與工作區狀態

| 項目 | 值 |
|---|---|
| Repository | `C:\ComfyUI\simple_ui`（`Test-Path = True`） |
| Branch | `main` |
| HEAD | `c2291861ee14e536a994dbe4f9456676a3e19eb0`（與 Phase 2A 基準一致） |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| `git status --short --branch` | `## main...origin/main`；`?? devtools/reports/open-source-readiness-phase1.md`；`?? devtools/reports/open-source-readiness-phase2a.md` |
| 既有修改 | 無已追蹤檔案修改；兩份未追蹤報告已確認存在（33,161 / 43,645 bytes）且**未修改、未刪除、未納入任何 git 操作** |
| 其他未提交修改 | 無 |

已閱讀：`C:\ComfyUI\AGENTS.md`（工作環境提供）、`README.md`（設計約束 45-54 行）、`devtools/README.md`、`.github/*`，以及 `server.py` 的 WD14 初始化／清理／Worker／請求／結束流程。

---

## 3. 修改、新增或刪除的檔案清單

| 檔案 | 動作 | 目的 |
|---|---|---|
| `C:\ComfyUI\simple_ui\server.py` | 修改（2 處） | 移除啟動時對 WD14_TMP 的硬性依賴；為背景清理補上例外隔離 |
| `devtools/reports/open-source-readiness-phase2b1.md` | 新增 | 本交付報告 |

**未新增／修改任何測試檔至 repo**；隔離測試放在 OS 暫存區 `C:\Users\user\AppData\Local\Temp\opencode\phase2b1_test.py`，不進版控。
**未刪除任何檔案；未建立或刪除 repo 內目錄。**

---

## 4. 每個修改的詳細目的

### 4.1 `_purge_loop()`（`server.py:180-187`）

```python
180: def _purge_loop(interval=600):
181:     """定期清掉過期的反推暫存圖（逾時放著的檔案靠這個收尾）。"""
182:     while True:
183:         time.sleep(interval)
184:         try:
185:             purge_wd14_tmp()
186:         except Exception:
187:             pass   # 選用功能的背景清理不得影響主服務
```

- **修改前**：`184: purge_wd14_tmp()` 直接呼叫，雖然 `purge_wd14_tmp()` 本身有全域 try/except，但背景迴圈沒有第二層防護。
- **修改後**：任何 WD14 清理例外都被限制在選用功能的背景執行緒內，執行緒不會因單次錯誤永久結束，主服務完全不受影響。

### 4.2 `main()`（`server.py:879-891`）

```python
879: def main():
880:     os.makedirs(ASSETS, exist_ok=True)
881:     # WD14 暫存目錄改為按需建立（見 _reverse_inner）：基本服務不依賴選用功能
882:     threading.Thread(target=_purge_loop, daemon=True).start()
883:     n = purge_wd14_tmp()
...
889:         S(("127.0.0.1", port), H).serve_forever()
891:         WD14.stop()
```

- **修改前**：`878: os.makedirs(WD14_TMP, exist_ok=True)` 無條件在 `serve_forever()` 之前執行，且無例外處理。
- **修改後**：改為註解，啟動時**完全不建立也不要求** WD14_TMP；`ASSETS`（repo 內）仍正常初始化。

---

## 5. `main()` 啟動前後 WD14 初始化流程差異

| 步驟 | 修改前 | 修改後 |
|---|---|---|
| 模組載入 | `server.py:11-26` stdlib import；`417-418` 建立兩個空 Worker 物件（無 I/O） | **不變** |
| `os.makedirs(ASSETS)` | 執行 | **不變**（`server.py:880`） |
| `os.makedirs(WD14_TMP)` | **無條件執行，無 try/except**（舊 878 行） | **移除**（改為 `server.py:881` 註解） |
| 啟動背景 `_purge_loop` | 執行（無例外防護） | 執行（`server.py:882`），清理呼叫包 try/except（`184-187`） |
| `purge_wd14_tmp()` | 執行（本身有 try/except，`190-207`） | **不變**（`server.py:883`），目錄不存在時直接回 0 |
| `serve_forever()` | 若 WD14_TMP 建立失敗則**永遠到不了** | 不再受 WD14 檔案系統錯誤影響 |
| `finally: WD14.stop()` | 執行 | **不變**（`server.py:891`），未啟動時安全 return（`399-404`） |

---

## 6. WD14 暫存目錄按需建立的實際呼叫流程

```text
POST /api/reverse
  → server.py:640  do_POST → _reverse()
  → server.py:654-664  併發上限檢查（>3 回 429 BUSY）
  → server.py:666  _reverse_inner()
  → server.py:719-721  選擇 WD14（EVA02）或 WD14_VIT（ViT v3）
  → server.py:724-732  ★ os.makedirs(WD14_TMP, exist_ok=True) + 寫暫存檔
                        失敗 → 500 {"ok":false,"code":"TMP_FAIL","error":...}
  → server.py:738  worker.submit() → ensure_ready() → _spawn()（僅此時檢查 py/worker 檔案）
  → server.py:740-750  finally：成功/錯誤立即刪；逾時或崩潰保留交 TTL
  → server.py:752-766  既有 503/504/500/200 回應格式
```

- 沿用既有 `WD14_TMP` 環境變數（`server.py:51`）、EVA02 / ViT v3 Worker、JSON Lines 協定、`request_id` / `ready` / `fatal` / `pong` 生命週期、逾時與 CPUExecutionProvider。
- **未修改** Worker 啟動時機、模型載入策略、TTL 目的或 API 回應格式。
- 建立失敗時回傳既有 `TMP_FAIL` JSON（實測見 T4b），前端不會誤以為成功。

---

## 7. 清理流程如何處理不存在／無權限／其他檔案系統錯誤

| 情況 | 處理位置 | 行為 |
|---|---|---|
| 目錄不存在 | `server.py:192-193`（`if not os.path.isdir(WD14_TMP): return 0`） | 直接略過，**不建立目錄** |
| `isdir` 丟例外（模擬無權限） | `server.py:203-204` 全域 `except Exception: return 0` | 回 0，不中斷 |
| `listdir` / `getmtime` / `remove` 丟例外 | `server.py:196-201` 逐檔 `except OSError: pass` + 外層 `except` | 略過該檔，不中斷 |
| 背景清理本身丟例外 | `server.py:184-187`（本次新增） | 限制在背景執行緒，迴圈繼續；主服務不受影響 |
| 啟動時呼叫一次清理 | `server.py:883` | 目錄不存在時回 0、不列印訊息 |

TTL（`WD14_TMP_TTL = 3600`，`server.py:59`）與 10 分鐘週期（`_purge_loop(interval=600)`）皆未改變。

---

## 8. Worker 未啟動時的 `stop()` 行為

`Wd14Worker.stop()`（`server.py:399` 起）：

```python
399:     def stop(self):
400:         with self.lock:
401:             proc = self.proc
402:             self.proc = None
403:         if proc is None:
404:             return
```

- 新建立的 `Wd14Worker()` 或模組層 `WD14` / `WD14_VIT` 在尚未 `_spawn()` 時 `proc is None`，直接 return：不寫 stdin、不等待、不 kill、不碰檔案系統。
- `main()` 的 `finally`（`server.py:891`）因此安全；背景清理與 Worker 結束沒有共享檔案操作，無新增競態。

---

## 9. 測試實際執行結果

所有測試均在**隔離環境**執行：WD14_TMP 指向 OS 暫存區的隨機不存在路徑；`serve_forever()` 以假物件取代（不綁 7860）；Worker 推論以 stub 取代（不載模型、不執行 GPU）；未停止或重啟任何正式服務。

### 測試腳本
`C:\Users\user\AppData\Local\Temp\opencode\phase2b1_test.py`（不在 repo 內）

### 實際命令

```powershell
python 'C:\Users\user\AppData\Local\Temp\opencode\phase2b1_test.py'
python -m py_compile server.py
git -C 'C:\ComfyUI\simple_ui' diff --check
```

### 結果（14/14 PASS，實際執行）

| # | 測試情境 | 結果 | 關鍵證據 |
|---|---|---|---|
| T1 | WD14_TMP 指向不存在路徑，且 `makedirs` 對該路徑丟 `PermissionError`；呼叫 `main()` | **PASS（實際執行）** | `serve_forever` 被呼叫 1 次；未拋例外 |
| T2 | 同上，檢查啟動階段沒有呼叫 `makedirs(WD14_TMP)`、沒有建立目錄，且 ASSETS 仍初始化 | **PASS** | calls=[`C:\ComfyUI\simple_ui\assets`]；WD14_TMP 不存在 |
| T3a | `purge_wd14_tmp()` 遇到不存在目錄 | **PASS** | 回 0，目錄未被建立 |
| T3b | monkeypatch `os.path.isdir` 對 WD14_TMP 丟 `OSError` | **PASS** | 回 0，例外被吸收 |
| T3c | 背景清理第一次丟錯後是否續跑 | **PASS** | `purge=3, sleep=4`（迴圈持續，未被單次錯誤終止）；目錄未建立 |
| T4a | 真正進入 `_reverse_inner()`（16×16 PNG，stub Worker） | **PASS** | 請求前目錄不存在；請求後目錄建立；回 200 `ok:true` |
| T4b | 同上但 `makedirs` 對 WD14_TMP 丟 `PermissionError` | **PASS** | 回 500 `{"ok":false,"code":"TMP_FAIL",...}`；未建立目錄 |
| T5 | 未啟動的 `Wd14Worker()` 與模組層 `WD14` 呼叫 `stop()` | **PASS** | 無例外 |

其他檢查：

- `python -m py_compile server.py`：結束碼 **0**。
- `git diff --check`：結束碼 **0**，無輸出（無空白錯誤）。

---

## 10. 未執行的測試與原因

| 項目 | 原因 |
|---|---|
| 真實 `python server.py` 綁定 7860 | 不可啟動正式服務、避免與現有 server 衝突；已用假 `S.serve_forever()` 驗證初始化流程 |
| 真實 WD14 EVA02 / ViT v3 模型推論 | 不可載入模型／高負載；依指示以 stub Worker 驗證目錄建立與錯誤格式 |
| 全新 Windows + 非管理員帳號實際驗證 | 需另備隔離 VM，不可修改系統 ACL；本次以 monkeypatch `PermissionError` 模擬 |
| 實際 ComfyUI 生成、WebSocket 進度、歷史與燈箱 | 不可執行正式 GPU 生圖；本次修改未觸及這些流程（`app.js`、`/comfy`、`/ws` 皆未改） |
| 瀏覽器 UI 驗證 | 不需要；本次只改後端初始化，且不得啟動正式服務 |

上述項目**未執行，不視為通過**。

---

## 11. 結束時 Git 狀態

| 項目 | 值 |
|---|---|
| Branch | `main`（未切換） |
| HEAD | `c2291861ee14e536a994dbe4f9456676a3e19eb0`（未變動） |
| Remote | 未變更；未執行 fetch |
| 已追蹤修改 | `server.py`（2 處，見第 3、4 節） |
| 未追蹤檔案 | `devtools/reports/open-source-readiness-phase1.md`（33,161 bytes）、`devtools/reports/open-source-readiness-phase2a.md`（43,645 bytes）、`devtools/reports/open-source-readiness-phase2b1.md`（本報告） |
| Git 寫入 | 無 commit / push / reset / rebase / stash / checkout / clean |

---

## 12. `git diff --check` 結果

- 命令：`git -C 'C:\ComfyUI\simple_ui' diff --check`
- 結束碼：`0`
- 輸出：無
- 結論：通過，無 trailing whitespace / 空白錯誤。

---

## 13. 正式服務是否受到影響

**未受影響。**

- 未啟動、停止或重啟 ComfyUI、simple_ui server、WD14 Worker。
- 未連接到 7860/8188 的正式服務（測試中 `port_open` 亦被 stub 化）。
- 未修改 localStorage、使用者圖片、模型、venv、環境變數或系統 ACL。
- 未安裝、更新或移除任何套件；未下載模型；未執行生圖或高負載測試。

---

## 14. 尚未解決的問題與風險

| 項目 | 說明 | 所屬範圍 |
|---|---|---|
| `WD14_TMP` 預設仍為 `C:\ComfyUI\tmp\wd14`（`server.py:51`） | 使用者啟用 WD14 但未設 env 時，請求會嘗試在該路徑建立，失敗回 500 `TMP_FAIL`；基本服務不受影響。需文件說明 env 覆寫 | 後續文件／Phase 2B |
| 背景 `_purge_loop` 仍啟動（即使未用 WD14） | 只是一個 daemon thread，每 10 分鐘對不存在目錄做一次 `isdir` 即返回；額外開銷極小，未移除以維持最小修改 | 可接受 |
| `purge_wd14_tmp()` 使用廣域 `except Exception: return 0` | 既有行為，可能隱藏真實清理錯誤；本次未改動以免影響既有語意 | 既有設計 |
| `main()` 的啟動訊息仍寫死 7860（`server.py:885`） | 與 `SIMPLE_UI_PORT` 不一致時訊息不準；屬 Phase 2B 其他項目 | 範圍外 |
| ComfyUI 位址仍固定 127.0.0.1:8188 | 屬 Phase 2B 其他項目 | 範圍外 |
| 未實際驗證非管理員全新 Windows | 已用模擬驗證，仍需日後在隔離 VM 做真實驗證 | 驗證風險 |
| 兩份既有報告與本報告皆為未追蹤 | 依指示不 commit；由 ChatGPT 獨立審查與決定 Git 收尾 | Git 流程 |

---

## 15. 完成條件對照

| 條件 | 狀態 |
|---|---|
| WD14 不再是啟動必要條件 | ✅ `main()` 不再建立／要求 WD14_TMP |
| 啟動時不會無條件建立 WD14_TMP | ✅ 實測 T2 |
| 清理流程不會阻止主服務啟動 | ✅ 實測 T1 / T3 |
| WD14 使用時仍按需建立暫存目錄 | ✅ 實測 T4，原有 `server.py:728` 之路徑與錯誤格式不變 |
| WD14 功能與 Worker 架構保留 | ✅ 未改 Worker、模型、CPUExecutionProvider、JSON Lines 協定 |
| 基本生圖流程未被修改 | ✅ 未動 `app.js`、`/comfy`、`/ws`、workflow、localStorage |
| 必要測試實際執行並如實回報 | ✅ 14/14 PASS；未執行項目已於第 10 節明確列出 |
| `git diff --check` 通過 | ✅ 結束碼 0 |
| 交付報告完整 | ✅ 本報告 |
| 沒有 Commit / Push | ✅ |

**已停止，未開始 Phase 2B-2。**
