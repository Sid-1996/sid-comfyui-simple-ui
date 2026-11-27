# Civitai Personal API Key 階段 A — R1a 空 Port 邊界修正

> 本輪只修正 `_civitai_auth_allowed()` 對「明確指定空 Port」的誤判，並新增回歸測試。
> 沒有開始階段 B、沒有模型下載、沒有改動 Redirect 防護、公開搜尋、快取、前端或其他報告。

---

## 1. 任務目標

ChatGPT R1 審查發現：`https://civitai.com:` 被 `_civitai_auth_allowed()` 錯誤判定為可附加 Bearer。原因是 Python `urllib.parse` 對「完全沒寫 Port」與「寫了空 Port（`host:`）」都回傳 `parts.port is None`。

本任務只修正此邊界，並確保合法的 `:443`、`:0443` 不受影響。

---

## 2. 開始前 Repository／Branch／HEAD／Remote／Git 狀態

| 項目 | 值 |
|---|---|
| Repository 根目錄 | `C:/ComfyUI/simple_ui` |
| Branch | `main...origin/main [ahead 1]`（ahead/behind `1/0`） |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git`（fetch/push 同） |
| tracked modified | **12** |
| untracked | **28** |
| staged | 0 |
| `git diff --check` | 無輸出（乾淨） |
| 正式服務 | 7860（PID 13424）、8188（PID 12196）監聽中 |

既有 12 個 tracked modified：`app.css`、`app.js`、`devtools/lora_explorer_api_test.py`、`devtools/lora_explorer_core_test.mjs`、`devtools/lora_mock_civitai.py`、`devtools/lora_ui_test.mjs`、`devtools/test_ui_control_wd14.ps1`、`index.html`、`server.py`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`。全部保留未清理。

既有報告確認存在：`devtools/reports/lora-personal-api-key-phase-a.md`、`lora-personal-api-key-phase-a-r1.md`、`lora-personal-api-key-design-review.md`。新報告 `lora-personal-api-key-phase-a-r1a.md` 開始時不存在，無覆蓋衝突。

**Remote Desktop Commander 設備狀態**：目前工作環境沒有暴露任何 Remote Desktop Commander 專用工具（工具搜尋只找到 browser／playwright／wispbyte 等），因此無法透過工具直接讀取「Online」旗標。本輪以本機 shell 可正常執行、7860／8188 仍在原行程監聽作為裝置可達的間接確認；此點請 ChatGPT 以 RDC 端畫面直接核對。

---

## 3. AGENTS.md 與 CodeGraph 查閱情況

- 已重新閱讀 `C:\ComfyUI\AGENTS.md` 與 `C:\ComfyUI\simple_ui\AGENTS.md`（含 Git 倉庫導覽、只准標準庫、既有修改不得清理、禁止 Git 寫入等規範）。
- 先執行 `codegraph status`：索引 35 files / 1094 nodes / 4837 edges，但顯示 **Pending Changes: Added 2 files, Modified 2 files**（先前新增的測試與報告尚未 sync）。索引未更新，符合 AGENTS.md「唯讀任務可跳過 sync」的指引，本輪未執行 `codegraph sync`。
- 再執行 `codegraph explore "_civitai_auth_allowed Civitai api key host guard"` 與 `codegraph explore "_civitai_auth_allowed"`：`codegraph node _civitai_auth_allowed` 因索引過期回 「Symbol not found」；explore 回傳的是重新從磁碟讀取的原始碼，但輸出被截斷未直接顯示該函式。因此最後用 `read` 工具讀取 `server.py:285–306` 取得精確現況，再進行最小修改。
- 沒有大量 grep 或整檔讀取。

---

## 4. 修改檔案與程式碼位置

只修改兩個既有檔案、新增一個報告：

| 檔案 | 位置 | 修改 |
|---|---|---|
| `server.py` | `_civitai_auth_allowed()`（`285–311 行`，核心改動在 `301–310`） | 移除 `parts.port`，改以 `parts.netloc` 直接區分「無 Port」與「明確空 Port」 |
| `devtools/lora_personal_key_test.py` | `t_auth_allowed_urls()`（`345 行` 起）、測試登錄（`435 行`） | 新增 3 個 URL 案例並更新測試名稱 |
| `devtools/reports/lora-personal-api-key-phase-a-r1a.md` | 新檔 | 本報告 |

**沒有修改**：`_NoRedirectHandler`、`_open_without_redirect()`、`_civitai_get()`、`_civitai_me()`、`app.js`、`index.html`、`app.css`、OAuth、公開搜尋、快取、API 回應格式、其他報告。

---

## 5. 空 Port 問題的根因及修正方式

### 根因

原程式碼：

```python
port = parts.port          # https://civitai.com: 也回 None
return port in (None, 443)
```

`urllib.parse.urlsplit("https://civitai.com:/api/v1").port` 回 `None`，與完全沒指定 Port 無法區分，因此 `https://civitai.com:` 被當成合法並允許附加 Bearer。

### 修正方式（簡單、無通用 URL 框架）

在已確認 scheme 為 HTTPS、無 URL 帳密、hostname 精確等於 `civitai.com` 的前提下，直接檢查 `netloc`：

- `netloc == host` → 完全沒指定 Port，允許。
- `netloc` 必須以 `host + ":"` 開頭，否則拒絕。
- 取出 `:` 後的字串；空字串、非 ASCII、非全數字一律拒絕。
- 數值必須等於 `443`；`:0443` 因數值相同繼續允許。

關鍵程式碼（目前 `server.py:301–310`）：

```python
authority = parts.netloc.lower()
if authority == host:
    return True
if not authority.startswith(host + ":"):
    return False
raw_port = authority[len(host) + 1:]
if not raw_port or not raw_port.isascii() or not raw_port.isdigit():
    return False
return int(raw_port) == 443
```

`isascii()` 另外避免 Unicode 數字被 `int()` 接受。所有解析錯誤仍由外層 `except Exception: return False` 攔截。

---

## 6. 新增測試案例

`t_auth_allowed_urls()` 案例表（預期值）：

| URL | 預期 | 狀態 |
|---|---|---|
| `https://civitai.com/api/v1` | True | PASS |
| `https://civitai.com:443/api/v1` | True | PASS |
| `https://civitai.com:0443/api/v1` | True | PASS（新增） |
| `https://civitai.com:/api/v1` | False | PASS（新增） |
| `https://civitai.com:8443/api/v1` | False | PASS |
| `https://civitai.com:abc/api/v1` | False | PASS（新增，非數字 Port） |
| `http://civitai.com/api/v1` | False | PASS |
| `https://user:pass@civitai.com/api/v1` | False | PASS |
| `https://sub.civitai.com/api/v1` | False | PASS |
| `https://evil.example/api/v1` | False | PASS |
| `明顯不是網址` | False | PASS |

測試仍使用既有隔離方式：本機隨機 port mock、假金鑰、臨時資料夾，未呼叫真實 Civitai、未使用真實 API Key。

另以獨立唯讀指令直接列印上述 URL 的 `_civitai_auth_allowed()` 結果，全部與預期一致。

---

## 7. 每項測試的實際結果

| 執行項目 | 結果 |
|---|---|
| `python devtools/lora_personal_key_test.py` | **12 tests passed**（含本輪擴充的 URL guard 測試） |
| `python devtools/lora_explorer_api_test.py` | **35 tests passed** |
| `node devtools/lora_explorer_core_test.mjs` | **21 tests passed** |
| `node devtools/lora_personal_key_ui_test.mjs` | **13 checks passed** |
| `node --check app.js` | OK（無輸出） |
| Python `compile()`：`server.py`、`lora_personal_key_test.py` | OK（未留下 `__pycache__`） |
| `git diff --check` | OK（無輸出） |

R1 既有的 redirect 防護測試（301/302/303/307/308 跨 Host 封鎖、匿名 redirect 不變）與 DPAPI／Origin／`/me`／匿名搜尋等測試全部通過，代表本輪修改沒有破壞 R1 或階段 A 行為。

---

## 8. 未執行的測試及原因

| 未執行 | 原因 |
|---|---|
| `python -m py_compile server.py` | 會寫 `__pycache__`；改用 `compile()` 做等效語法檢查 |
| `node devtools/lora_ui_test.mjs`（headless Chrome 端對端） | 需另外啟動隔離 7861／18188／18189 與 Chrome；本輪修改僅在後端 URL 驗證，已由 API mock 與前端原始碼檢查覆蓋 |
| `codegraph sync` | 索引有 pending changes，但本輪為最小修改且 AGENTS.md 允許唯讀任務跳過；避免衍生索引寫入 |
| 真實 Civitai 呼叫／真實 API Key | 明確禁止 |
| 模型下載、GPU／高負載測試 | 非本輪範圍，明確禁止 |
| 7860／8188 重啟或 request | 不得干預正式服務 |

---

## 9. 最終 Git 狀態及與開始時的差異

- Branch：`main...origin/main [ahead 1]`；HEAD `cf5609e0cfbd69163247786f1f50dbf8e600c090`；ahead/behind `1/0`；Remote 不變
- tracked modified：**12**（與開始時相同；本輪只修改原本已 modified 的 `server.py`，`lora_personal_key_test.py` 本來就是 untracked）
- untracked：**29**（開始 28 + 本報告）
- staged：0
- 未執行 add／commit／push／reset／restore／stash／checkout／clean；未清理或覆蓋任何既有修改與報告

---

## 10. 正式服務是否受到影響

**沒有。** 7860（PID 13424）與 8188（PID 12196）仍在原行程監聽，未停止、未重啟、未修改設定、未呼叫真實 Civitai、未使用真實 Key、未下載模型。所有測試在隨機 port 與臨時資料夾中執行並於結束時清理。

---

## 11. 尚存風險

1. `CIVITAI_ME_URL` 仍是可覆蓋的模組變數，正式值固定官方端點，但安全性依賴該前提。
2. `_civitai_me()` 不經過 `_civitai_auth_allowed()`；其目標 URL 的正確性需靠部署設定維持。
3. 本輪只處理 `netloc` 的 Port 邊界；其他少見 URL 形式（例如 IPv6、含空白的主機字串）因 hostname 已被精確限定為 `civitai.com`，會在更早的檢查被拒。
4. CodeGraph 索引仍有 pending changes；後續若有符號查詢需求，應先由開發者決定是否 `codegraph sync`。
5. 階段 B（模型下載）尚未開始，Bearer 仍未被任何正式功能使用。

---

## 12. 需要 ChatGPT 特別審查的項目

1. `server.py:301–310`：以 `parts.netloc` 手工切 Port 是否在所有合法／非法形式上與 `parts.port` 一致，尤其 `https://CIVITAI.COM:0443/`、`https://civitai.com:443?x=1`、`https://civitai.com:/`。
2. `authority.startswith(host + ":")` 是否可能誤收 `host:port@something`（此類已被 username/password 檢查先拒絕，請確認順序）。
3. `isascii() + isdigit() + int()` 是否足以阻止 Unicode 數字或超長數字造成例外。
4. 測試中 monkeypatch `_civitai_auth_allowed` 的 redirect 測試是否仍獨立於本輪修改。
5. 是否需要在後續把 host guard 抽成共用工具並加 static test，避免其他模組另行實作時重犯 `parts.port` 誤用。

---

## 13. 完成陳述

R1a 完成並停止。只修正空 Port 邊界並新增回歸測試，既有工作區完整保留，正式服務未受影響，未開始階段 B，未執行任何 Git 寫入。
