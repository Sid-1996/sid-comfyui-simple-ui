# Amora Star Savior LoRA 下載與安裝報告（Version 3276795）

> 任務性質：已授權的下載／安裝與完整性驗證。本輪未修改程式碼、設定或既有模型；未呼叫 Civitai API；未讀取或使用 Cookie／API Key／登入憑證；未重啟或停止任何服務；未執行生圖；未做 Git 寫入。唯一新增加的是本報告與一枚**由使用者手動放置**的新 LoRA 檔案。

---

## 1. 起始 Repository、Branch、HEAD、Git 狀態

| 項目 | 值 |
|---|---|
| Repository | `C:\ComfyUI\simple_ui` |
| Branch | `main`，`## main...origin/main [ahead 1]` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| 起始 tracked modified | 13（`AGENTS.md`、`app.css`、`app.js`、5 個 devtools 檔案、`index.html`、`server.py`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`） |
| staged | 0 |
| 起始 untracked | 42（含先前各份報告、devtools 測試、`comfy_lora_paths.py`、`lora-ab-20261126/`） |
| `git diff --stat` | `13 files changed, 1702 insertions(+), 104 deletions(-)` |
| CodeGraph | Files 35 / Nodes 1,094 / Edges 4,837；Pending Added 4 / Modified 2（未 sync，唯讀約束） |

已讀取 `C:\ComfyUI\AGENTS.md` 與 `C:\ComfyUI\simple_ui\AGENTS.md`（含 12.1 節「browse 與 browser 不可混用」）。

---

## 2. ComfyUI / Simple UI PID 與服務狀態【已驗證】

| 服務 | PID | CommandLine／監聽 |
|---|---|---|
| ComfyUI | **1760** | `...\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --output-directory D:\ComfyUI_output`；`127.0.0.1:8188` |
| Simple UI server | **12424** | `...\python_embeded\python.exe C:\ComfyUI\simple_ui\server.py`；`127.0.0.1:7860` |

沒有其他符合完整路徑的 Python 行程；本輪沒有啟動、停止或重啟任何服務，PID 前後不變。

---

## 3. 實際 LoRA 搜尋路徑與來源證據

### 3.1 額外模型路徑設定【已驗證】

- `C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\extra_model_paths.yaml`：**不存在**。
- ComfyUI `scripts` 目录下沒有發現 prestartup 腳本。
- 啟動參數只有 `--windows-standalone-build`、`--output-directory D:\ComfyUI_output`，沒有 `--extra-model-paths-config`。

### 3.2 唯讀路徑解析器輸出【已驗證】

`python comfy_lora_paths.py`（唯讀，讀 WMI／PEB、子程序 import `folder_paths` 重建）回傳：

```json
{ "grade": "B", "usable": false, "code": "LIVE_UNVERIFIED",
  "loras": ["C:\\ComfyUI\\ComfyUI_windows_portable\\ComfyUI\\models\\loras", "D:\\ComfyUI_output\\loras"],
  "evidence": { "pid": 1760, "bitness": "x64", "env_used": false, "verification": "none",
                "sources": ["canonical", "yaml", "output_directory"] } }
```

該工具明確說明：重建結果只是候選，**單獨不足以證明 live process**。因此本輪另外做下列 live 交叉驗證。

### 3.3 Live runtime 交叉驗證【已驗證，關鍵】

- `GET /comfy/models/loras`（經 Simple UI 代理打到正在執行的 ComfyUI）在安裝前只回一個名稱：`Star Savior - Serpang (Morpholi).safetensors`。
- 該名稱對應的檔案**只存在於** `C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\models\loras\`；另一個候選目錄 `D:\ComfyUI_output\loras` **不存在**。
- `GET /comfy/object_info/LoraLoader` 的 `lora_name` 可選項與上面完全一致。

結論：`models\loras` 是正在執行的 ComfyUI **實際會搜尋**的目錄（live API 回報的檔案就在那裡），且在重建順序中排第一；`D:\ComfyUI_output\loras` 為第二候選且不存在。雖然解析器本身只給 B 級，但「live API 回報名稱 ↔ 檔案系統位置」的對應提供了可驗證的安裝目錄證據。無 `extra_model_paths.yaml`／prestartup，沒有其他同名遮蔽來源。

---

## 4. 同名檔案檢查結果【已驗證】

| 時機 | 檢查結果 |
|---|---|
| 安裝前 | `models\loras\Amora.safetensors`：不存在；`D:\ComfyUI_output\loras\Amora.safetensors`：不存在。目錄內只有 `Star Savior - Serpang (Morpholi).safetensors`（99,193,668 bytes，SHA-256 `2E93721E…A8049A`）與 0-byte 的 `put_loras_here` 佔位檔。 |
| 安裝後 | 兩候選目錄中只有一枚 `Amora.safetensors`（見第 6 節），沒有第二份同名或大小寫變體；既有 LoRA 未被覆蓋或改名。 |

---

## 5. 下載來源與實際下載方式【已驗證／如實說明】

- 來源頁：`https://civitai.red/models/2898222/amorastar-savior?modelVersionId=3276795`（先前已由官方搬遷連結交叉核對，見 `amora-star-savior-official-crosscheck.md`）。
- 頁面 Download 元素是正常站內連結：`a[href="https://civitai.red/api/download/models/3276795?fileId=3160868"]`，文字 `Download (217.87 MB)`。本輪透過 `browse` 擴充在該元素上執行了一次點擊。**沒有呼叫程式化 Civitai API、沒有使用 API Key／Cookie／憑證**。
- 該次瀏覽器點擊後，工具端沒有返回可取得的檔案，且在 `C:\Users\user\Downloads`（不存在）、Desktop、Documents、Temp 與使用者目錄下都沒有找到新下載的 `Amora.safetensors`。
- **實際完成安裝的人是使用者**：使用者隨後告知「我已手動協助將檔案下載至 lora 模型位置」。因此本報告**不宣稱**下载是由本輪工具完成；本輪負責的是安裝位置與完整性驗證。

若之後要自動化這一步，需先處理「瀏覽器下載檔案如何安全取得／搬移」的工具限制，不在本輪範圍。

---

## 6. 最終安裝路徑、大小與 SHA-256【已驗證】

| 項目 | 值 |
|---|---|
| 最終路徑 | `C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\models\loras\Amora.safetensors` |
| 檔案名稱 | `Amora.safetensors`（與指定版本檔名一致） |
| 實際大小 | **228,458,292 bytes**（= 223,103.80078125 KB × 1024；約 217.87 MiB / 228.46 MB） |
| 預期 SHA-256 | `C46B816CB90118E85CE4CE7F857B24E9E918DF3ED9B6AE3930A61B6424F708F5` |
| 實際 SHA-256 | `C46B816CB90118E85CE4CE7F857B24E9E918DF3ED9B6AE3930A61B6424F708F5` |
| 比對結果 | **完全一致（PASS）** |
| LastWriteTimeUtc | `2026-11-26T11:20:01.2354738Z` |

### 檔案內部 metadata 輔助核對【已驗證】

- safetensors header 423,800 bytes、**2,958 tensors**（與頁面可見 `Tensors 2,958` 一致）。
- `modelspec.title = Amora`、`modelspec.architecture = stable-diffusion-xl-v1-base/lora`、`ss_network_dim = 32`、`ss_network_alpha = 16`、`resolution = 1024x1024`。
- `GET /api/lora-meta?name=Amora.safetensors` 回 `title: Amora`、`architecture: stable-diffusion-xl-v1-base/lora`、`networkDim: 32`、`triggerWords: []`。
  注意：檔案 metadata 內**沒有**觸發詞；頁面上的兩組 `trainedWords` 需要使用者手動加入，不會自動進入 Prompt。

---

## 7. ComfyUI 是否辨識新 LoRA【已驗證，無需重啟】

| 檢查 | 結果 |
|---|---|
| `GET /comfy/models/loras` | `Amora.safetensors`、`Star Savior - Serpang (Morpholi).safetensors` |
| `GET /comfy/object_info/LoraLoader` → `lora_name` | 同上兩項 |
| `GET /api/loras`（Simple UI） | `ok:true`、`count:2`，含 `{name:"Amora.safetensors", display:"Amora", sub:""}` |

正在執行的 ComfyUI **無需重啟就已辨識**新檔案，因此沒有觸及「必須重啟才能確認」的停止條件。

---

## 8. 未執行項目及原因

| 未執行 | 原因 |
|---|---|
| 重啟 ComfyUI／Simple UI | 明確禁止，且無需重啟即可辨識 |
| GPU 生圖／A/B 測試 | 明確禁止；完成後立即停止 |
| 修改 UI LoRA 設定／localStorage | 明確禁止 |
| 呼叫 Civitai API／取得 downloadUrl | 明確禁止；使用頁面正常 Download 流程 |
| 讀取或使用 Cookie／API Key／登入憑證 | 明確禁止 |
| 使用其他版本或同名模型替代 | 明確禁止；SHA-256 已鎖定 3276795 |
| 覆蓋、改名或刪除既有模型 | 明確禁止；新檔是新增且無同名衝突 |
| 修改 ComfyUI／Simple UI／專案程式碼或設定 | 明確禁止 |
| Git stage／commit／push 或其他寫入 | 明確禁止 |
| `codegraph sync` | 未修改程式碼，且索引 pending 不影響本輪 |

---

## 9. Git 最終狀態

```
## main...origin/main [ahead 1]
（13 項 tracked modified 完全不變，git diff --stat 與開始時相同）
?? devtools/reports/amora-star-savior-download-install.md   ← 本報告（唯一新增）
```

- 沒有 Git 寫入；既有報告、程式碼、devtools 測試與使用者修改全部未動。
- 新模型檔案位於 ComfyUI 模型目錄，不在 git repo 內。

---

## 10. 服務與既有使用者資料是否受到影響

- ComfyUI PID 1760、Simple UI PID 12424 前後不變；沒有中斷服務或干擾佇列。
- 既有 LoRA `Star Savior - Serpang (Morpholi).safetensors` 未被修改、覆蓋或刪除。
- 使用者 localStorage、UI 設定、輸出資料夾、輸出圖片都未變動。
- 瀏覽器只開過一個下載用分頁（`539268366`），已關閉；未修改瀏覽器／擴充設定。
- 唯一的新增資料是 `Amora.safetensors`（由使用者手動放置）與本報告。

---

## 11. 尚未解決的問題及風險

1. **觸發詞不會自動帶入**：檔案 metadata `triggerWords: []`，頁面的兩組 `trainedWords` 需使用者自行設定；若不設定，角色效果可能不如預期。先前 A/B 已證明 LoRA 工作流本身正常。
2. **基底相容性**：檔案 `architecture = stable-diffusion-xl-v1-base/lora`，與 Illustrious Checkpoint 同屬 SDXL 系；但仍建議在使用者端做一次同 seed A/B 確認視覺效果（本輪禁止生圖）。
3. **路徑解析器仍只有 B 級**：完整搜尋目錄清單／優先順序無法從 live process 獨立證明；不過目标目录已由 live API 回報檔案對應確認為實際搜尋目錄，且它排在重建清單第一，沒有同名遮蔽。
4. **下載自動化缺口**：瀏覽器點擊 Download 後工具端未能取得檔案，最終由使用者手動下載；若日後要重複此流程，需要先解決下載檔案的取得／搬移方式。
5. **沒有做生圖驗收**：本輪只做到「檔案存在 + 雜湊正確 + ComfyUI 辨識」，不代表已完成模型推論效果驗證。

---

## 12. 一句話結論

版本 3276795 的 `Amora.safetensors` 已存在於 ComfyUI 實際 LoRA 目錄 `models\loras`，大小 228,458,292 bytes、SHA-256 與官方／鏡像預期值**完全一致**；ComfyUI 無需重啟即已辨識（`/models/loras`、`LoraLoader`、`/api/loras` 皆列出）。實際下载由使用者手動完成，本輪只完成驗證；未重啟服務、未生圖、未改設定，Git 無變動。
