# Open-Source Readiness — Phase 3R1-V-R：靜態檔案路徑安全修正

## 0. 結論

只處理 ChatGPT 獨立審查指出的兩個問題，未做其他重構：

1. `_static()` 改以 `os.path.realpath()` + `os.path.commonpath()` 判斷目錄邊界，不再用 `str.startswith(ROOT)`；錯誤、不同磁碟、symlink/junction 逃逸一律回 403。
2. README 移除錯誤的「基本服務最低為 3.5」宣稱，統一為 Python 3.10 或更新版本。

所有新增與回歸測試通過；正式服務未受影響；只新增本報告，未 commit / push / stage。

結果分類：`【實際執行】`、`【隔離 Mock 測試】`、`【靜態檢查】`、`【未執行】`。

---

## 1. 原始漏洞及根因 `【實際執行 + 靜態檢查】`

### 1.1 字串前綴誤判（`server.py::_static()`）

原寫法：

```python
full = os.path.normpath(os.path.join(ROOT, rel))
if not full.startswith(ROOT):
    return 403
```

`startswith()` 是**字串前綴**比較，不是路徑階層比較。當 Repo 旁邊存在同名前綴目錄時：

```
ROOT = C:\...\clone
FULL = C:\...\clone_evil\secret.js
full.startswith(ROOT) == True   # 實際在 Repo 外面，卻被放行
```

實測隔離環境输出：

```
ROOT      = C:\Users\user\AppData\Local\Temp\sid-r1vr-... \clone
FULL      = C:\Users\user\AppData\Local\Temp\sid-r1vr-... \clone_evil\secret.js
old startswith(ROOT) = True   <-- 舊寫法會放行
new realpath commonpath inside = False
```

此外 `startswith()` 也無法阻擋 Repo 內 symlink/junction 指向外部目標的情形（路徑字串仍在 ROOT 內，但實際讀到外部檔案）。

### 1.2 README Python 版本不一致

原文字：`Python 3.10 或更新版本（建議；基本服務最低為 3.5，但你不需要去裝舊版）`。程式並無針對 3.5 的相容承諾或測試，該宣屬無依據的舊資訊。

---

## 2. 修正方式

### 2.1 `server.py::_static()`（最小修改）

```python
full = os.path.normpath(os.path.join(ROOT, rel))
root_real = os.path.realpath(ROOT)
full_real = os.path.realpath(full)
try:
    inside = os.path.commonpath([root_real, full_real]) == root_real
except (ValueError, OSError):
    inside = False
if not inside:
    return self._send(403, b"forbidden", "text/plain; charset=utf-8")
if os.path.isdir(full_real) or not os.path.isfile(full_real):
    full_real = os.path.join(root_real, "index.html")   # 前端路由一律回首頁
full = full_real
```

- `realpath()` 同時正規化 ROOT 與目標，junction / symlink 會解析成實際目標。
- `commonpath()` 做真正的路徑階層比較；不同磁碟機等造成的 `ValueError` / `OSError` 一律拒絕。
- 後續 `isdir` / `isfile` / `open()` 都改用 `full_real`（已確認在 ROOT 內的實際路徑）。
- 前端路由 fallback 與 `ALLOWED` / `NO_STORE` 白名單完全保留；未引入第三方套件。

### 2.2 `README.md`

改為：`- **Python 3.10 或更新版本**`。沒有修改程式碼，也沒有加入任何版本相容層。

---

## 3. 靜態路徑安全測試案例及結果 `【實際執行（隔離 Clone + HTTP）】`

隔離環境：公開 Repo Clone（HEAD `d7e3fe7`，只覆寫修改後的 `server.py` / `README.md`），`SIMPLE_UI_PORT=50406`，隔離 `LOCALAPPDATA`/`APPDATA`/`TEMP`，旁邊建立同名前綴目錄 `clone_evil`（內含 `secret.js`、`data.json`）與外部 `outside.js`。

命令：`python <base>\static_path_tests.py 50406`

| 案例 | 結果 |
|---|---|
| 正常 `/`、`/app.css`、`/app.js`、`/tags.js`、`/dict.js` | 200，內容正確 |
| `/../clone_evil/secret.js`（同名前綴 sibling） | **403**，無內容洩漏 |
| `/../clone_evil/data.json`（ALLOWED 副檔名） | **403**，無內容洩漏 |
| `/../outside.js`（Repo 外部 ALLOWED 檔案） | **403**，無內容洩漏 |
| `/../clone_evil/nonexistent.js`（即使檔案不存在） | **403**，先做邊界檢查 |
| `/evil_link/secret.js`、`/evil_link/data.json`（junction 逃逸） | **403**，無內容洩漏 |
| `/no/such/route`（不存在的前端路由） | 200，回 index.html（既有 fallback 未破壞） |
| `/server.py`（不在 ALLOWED） | 404 |

結果：**19 pass / 0 fail**（重啟 server 後再跑一次亦為 19/0）。

---

## 4. symlink 測試及未執行原因 `【實際執行 + 部分未執行】`

- **已執行**：Windows 目錄 junction（`cmd /c mklink /J <clone>\evil_link <clone_evil>`）建立成功，無需系統管理員權限。HTTP 測試確認 `/evil_link/secret.js`、`/evil_link/data.json` 皆回 403，證明 `realpath()` 解析 junction 後正確拒絕逃逸。
- **未執行**：真正的檔案 symlink（`os.symlink`）在目前 Windows 帳號下可能需開發者模式或管理員權限，本次**沒有成功建立**，因此未以真 symlink 進行 HTTP 請求測試。
- 覆蓋方式：junction 已驗證相同語意的逃逸路徑；`commonpath()` 的例外處理也由程式碼路徑與 `ValueError`/`OSError` 防護覆蓋。清理時先以 `cmd /c rmdir` 移除 junction，確認 sibling 檔案未被誤刪。

---

## 5. README 版本修正 `【實際執行】`

- 修改前（`README.md:25`）：`Python 3.10 或更新版本（建議；基本服務最低為 3.5，但你不需要去裝舊版）`
- 修改後：`Python 3.10 或更新版本`
- 隔離 Clone 與正式 Repo 的 README 皆確認：`Python 3.5` 已消失，`Python 3.10` 仍存在且為唯一版本要求。
- 沒有新增相容層，也沒有宣稱支援舊版本。

---

## 6. 實際執行的測試命令與結果 `【實際執行】`

| 項目 | 命令 | 結果 |
|---|---|---|
| 建立乾淨環境 | `git clone https://github.com/Sid-1996/sid-comfyui-simple-ui.git <base>\clone`，HEAD `d7e3fe7` | 成功 |
| 漏洞重現 | Python `startswith` vs `realpath+commonpath` 比較 | 舊寫法 `True`（可放行），新寫法 `False` |
| 新增路徑安全測試 | `python <base>\static_path_tests.py 50406` | 19/0 PASS（兩次） |
| HTTP 整合回歸 | 啟動 Mock + `python <base>\http_regression.py 50406` | 8/0 PASS：`/api/status`、`/comfy/system_stats`、`object_info`、`prompt`+`history`、`/view`、`/api/check`、WD14 eva02/vit 503 |
| README 版本 | `Select-String -Pattern 'Python 3\.5\|Python 3\.10'` | 僅剩 3.10 |
| 語法 | `python -m py_compile server.py` | exit 0 |
| 語法 | `node --check app.js` / `tags.js` / `dict.js` / `tag_categories.js` | 全部 exit 0 |
| Diff | `git -C C:\ComfyUI\simple_ui diff --check` | exit 0 |

HTTP 回歸的 Mock 316 位元組等級小型測試圖片由程式產生（`48×48` PNG，123 bytes），沒有讀取或提供正式環境檔案。

---

## 7. 未執行測試及原因 `【未執行】`

| 項目 | 原因 |
|---|---|
| 真實 ComfyUI / GPU 生圖、真實 WD14 推論 | 正式環境保護禁止；以 Mock 覆蓋 |
| 檔案 symlink 的 HTTP 逃逸測試 | Windows 帳號權限限制；已用 directory junction 驗證相同語意 |
| WebSocket byte-exact 完整模式 | 本次修改範圍不涉及 `/ws` 或 `_ws_tunnel()`；Phase 3R1-V 已完整驗證，未重跑 |
| 刪除/輸出目錄完整流程 | 本次修改不涉及 `/api/delete`、`COMFY_OUTPUT_DIR`；Phase 3R1-V 已驗證，未重跑 |
| 高負載測試 | 明確禁止 |

---

## 8. Git Branch、HEAD、工作區狀態 `【實際執行】`

```
## main...origin/main
 M README.md
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
?? devtools/reports/open-source-readiness-phase3r1v.md
?? devtools/reports/open-source-readiness-phase3r1vr.md
```

- Branch：`main`；HEAD：`d7e3fe7c62fa222953239b3d6626c4b77ca364af`；Remote 不變；staged 空。
- 既有 11 份報告完整保留；本次唯一新增檔案為本報告。
- 未 commit / push / stage / reset / restore / stash / checkout / clean。

---

## 9. 正式服務是否受到影響 `【實際執行】`

- 正式 ComfyUI / simple_ui / WD14 Worker：未停止、未重啟、未修改。
- 7860 / 8188：全程無 Listen；正式環境變數、模型、Workflow、圖片、venv、依賴未更動。
- 測試程序採完整 CommandLine + PID 核對後終止；隔離 Port 50406 / 50407 Listen 數皆 0；temp Clone、Mock、junction、測試圖片與測試目錄已清除。
- 初始 `Remove-Item -Recurse` 因 junction 失敗，已先 `cmd /c rmdir` 移除 junction 再清理；確認 sibling 測試檔案未被誤刪，最終 `Test-Path(base)=False`。

---

## 10. 尚存風險

1. **真正檔案 symlink 未測**（見第 4 節）；junction 已覆蓋相同逃逸語意，但若未來環境允許建立 symlink，建議補一筆 HTTP 測試。
2. `_static()` 現在以 `realpath` 的實際路徑 `open()`；若 Repo 內合法檔案本身是往 Repo 內另一位置的 symlink，仍可讀取（路徑仍在 ROOT 內），這符合既有語意，不視為風險。
3. 本次只修正兩項審查問題；`ui_control.ps1` / `ui_panel.pyw` 與 devtools 測試腳本中的開發者絕對路徑仍在，一般使用者流程不接觸（已於前幾phase分類記錄）。
4. README 現在只寫 3.10+，程式仍以標準庫為主；未在更舊 Python 上實際驗證的行為不再有文件宣稱。

---

完成後停止，等待 ChatGPT 獨立審查。
