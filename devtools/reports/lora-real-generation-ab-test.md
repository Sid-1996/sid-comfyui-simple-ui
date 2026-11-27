# LoRA 真實環境開／關 A/B 生圖驗證

> 任務性質：經使用者授權的**真實 ComfyUI／GPU 生圖 A/B 對照**，唯讀程式碼與設定。本輪未修改程式碼、設定、既有 LoRA／Checkpoint、輸出目錄或任何服務狀態；未下載模型、未呼叫 Civitai API、未使用 API Key、未執行 Git 寫入。唯一新增的是本報告與本次專用產物資料夾 `devtools/reports/lora-ab-20261126/`。
>
> 證據標記：【已驗證】＝本輪實際請求／回應／檔案量測；【靜態推論】＝由程式碼或旗標推導；【尚未驗證】＝本輪未涵蓋。

---

## 1. 任務目標及範圍

在正式 ComfyUI 環境做一次 A/B 生圖：除「是否套用 LoRA」外，Checkpoint、Positive/Negative Prompt、Seed、Steps、CFG、Sampler、Scheduler、尺寸、VAE 等全部相同，藉此確認 LoRA 是否真的參與推論，並判讀使用者回報「套用後沒有效果」可能落在哪個環節。

A/B 各生成一次，不重複 heroic 測試。所有請求經由 Simple UI 的 `/comfy/*` 同源代理（不是前端直連 8188），workflow 結構比對 `app.js:578-592` 的 `wf()`。

---

## 2. Repository、Branch、HEAD、Remote、Git 起始狀態

| 項目 | 值 |
|---|---|
| Repository 根目錄 | `C:\ComfyUI\simple_ui` |
| Branch | `main`，`## main...origin/main [ahead 1]` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| tracked modified | 12 |
| staged | 0 |
| untracked | 40（含上一輪新增的 `lora-personal-api-key-and-application-audit.md`） |
| CodeGraph | Files 35 / Nodes 1,094 / Edges 4,837；Pending Added 4 / Modified 2（未 sync，唯讀約束） |

已讀取 `C:\ComfyUI\AGENTS.md` 與 `C:\ComfyUI\simple_ui\AGENTS.md`；上游 ComfyUI 的 AGENTS.md 不屬本專案規範。

---

## 3. 正式服務及 PID 狀態【已驗證】

以 `Get-CimInstance Win32_Process` 比對完整 CommandLine，再用 `Get-NetTCPConnection -LocalPort ... -State Listen` 交叉確認：

| 服務 | PID | 命令列／監聽 |
|---|---|---|
| ComfyUI | **1760** | `...\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --output-directory D:\ComfyUI_output`；listen `127.0.0.1:8188` |
| Simple UI server | **12424** | `...\python_embeded\python.exe C:\ComfyUI\simple_ui\server.py`；listen `127.0.0.1:7860` |

- 沒有其他符合這兩個完整路徑的 Python 行程；未觀察到 AGENTS.md 所述「多個 server.py 同時綁 7860」。
- 測試前 `/comfy/queue`：`queue_running=[]`、`queue_pending=[]`；測試後亦皆為空 → 沒有干擾別人的任務，也沒有殘留任務。
- 未啟動、停止或重啟任何服務；未使用或傳送個人 API Key；未呼叫 Civitai API。

---

## 4. 使用的 Checkpoint 與 LoRA 識別資訊

### 4.1 選擇依據【已驗證】

- 以只讀瀏覽器分頁讀取正式 UI 的 `localStorage`：`ui.loras` 為 **null** → 使用者目前沒有選取 LoRA，因此依任務原則改從本機既有 LoRA 挑選。
- `ui.settings`：`size=1024x1024`、`n=1`、`quality=true`、`steps=25`、`cfg=6`、`ckpt=WAI-Nsfw-Illustrious-17.safetensors`、`seed=-1`（每次隨機；本測試改為固定 seed，僅存在於請求中，**未寫回使用者設定**）。
- `GET /comfy/models/loras` 只回 **1** 個 LoRA，因此選用它是唯一選項，不是靠檔名猜測。
- `GET /comfy/object_info/LoraLoader` 的 `lora_name` 可選項也只有同一個名稱 → ComfyUI 與 UI 清單一致。

### 4.2 Checkpoint

`WAI-Nsfw-Illustrious-17.safetensors`（ComfyUI `CheckpointLoaderSimple.ckpt_name` 唯一可選項）。

### 4.3 LoRA 完整識別【已驗證】

| 項目 | 值 |
|---|---|
| 名稱（ComfyUI 相對名稱） | `Star Savior - Serpang (Morpholi).safetensors` |
| 實際解析路徑 | `C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\models\loras\Star Savior - Serpang (Morpholi).safetensors` |
| 檔案大小 | 99,193,668 bytes（約 94.6 MiB） |
| SHA-256 | `2E93721E1796D52D97E35BB45BE95782A2EF61DDF6079A6EFBCA03FD81A8049A` |
| LastWriteTimeUtc | 2026-11-24 01:50:58 UTC |
| safetensors header | 366,600 bytes、2,382 個 tensor |
| `modelspec.architecture` | `stable-diffusion-xl-v1-base/lora` |
| `ss_base_model_version` | `sdxl_` |
| `modelspec.resolution` | `1024x1024` |
| `modelspec.title` / author | `Stable Diffusion XL 1.0 Base LoRA` / StabilityAI |
| `modelspec.hash_sha256` | `0xe435269b1aafdf1cfd07c09749c865f63768ff0e6a35d09b337b872723aac1b3` |
| Trigger Words | **無**。`GET /api/lora-meta` 回 `triggerWords: []`；safetensors metadata 也沒有任何 trigger 欄位 |
| 權重 | 0.8 / 0.8（App 的 `LORA_DEFAULT_WEIGHT`，`app.js:392`；因使用者沒有既有設定，未任意調高） |

**同名／遮蔽檢查**【已驗證】：`C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\extra_model_paths.yaml` 不存在；ComfyUI 啟動參數指定的 `D:\ComfyUI_output\loras` 也不存在；`/models/loras` 與 `LoraLoader` 可選項都只有這一個檔案。因此沒有「同名檔遮蔽」或「載入另一個同名 LoRA」的風險。

相容性：`sdxl_ / stable-diffusion-xl-v1-base` 與 Illustrious（SDXL 系）Checkpoint 相容，基底沒有明顯衝突。

---

## 5. A、B 兩組完整生圖參數

| 參數 | A（不套用 LoRA） | B（套用 LoRA） |
|---|---|---|
| Checkpoint | `WAI-Nsfw-Illustrious-17.safetensors` | 同左（node 1 在 B 被 `execution_cached` 重用） |
| LoRA | 無 | `Star Savior - Serpang (Morpholi).safetensors` |
| `strength_model` / `strength_clip` | — | 0.8 / 0.8 |
| Seed | `123456789` | `123456789` |
| Steps / CFG | 25 / 6 | 25 / 6 |
| Sampler / Scheduler | `dpmpp_2m` / `karras` | 同左 |
| Denoise | 1 | 1 |
| 尺寸 / 張數 | 1024×1024 / 1 | 1024×1024 / 1 |
| VAE | Checkpoint 內建（node 1 slot 2） | 同左，未改 |
| `filename_prefix` | `ui_A` | `ui_B` |
| Prompt ID | `ea8eba76-84d6-481d-b890-c118ab8c8caa` | `e136b906-6f02-4bee-b0ed-fcaf2ee18fe7` |
| 實際送出時間（ms epoch） | 1,795,689,640,781 | 1,795,689,672,881 |

唯一差異是 B 多出 node 8 `LoraLoader` 與其造成的模型／CLIP 改接。完整參數與兩份 workflow 已保存於 `devtools/reports/lora-ab-20261126/workflow_A.json`、`workflow_B.json`、`run_summary.json`。

---

## 6. A、B 最終 Prompt【已驗證】

兩組**逐字相同**，且此 LoRA 沒有 Trigger Words，因此不存在「B 因自動加入觸發詞而改變 Prompt」的情況：

**Positive（A = B）**
```
masterpiece, best quality, amazing quality, 1girl, solo, upper body, looking at viewer, smile
```
（前綴與 `app.js:12` 的 `QUALITY` 相同；後半段是固定的一般描述，沒有任何 LoRA 觸發詞。）

**Negative（A = B）**
```
worst quality, low quality, bad anatomy, bad hands, extra fingers, missing fingers, deformed hands, mutated hands, fused fingers, watermark, text, signature, blurry, child, loli, shota
```
（與 `ui.settings`／`app.js:13` 的 `DEFAULT_NEG` 相同。）

`/history` 中保存的 prompt 節點 `"2"`、`"3"` 的 `text` 欄位可逐字核對，兩組完全一致。

---

## 7. Workflow 與 LoraLoader 執行證據【已驗證】

### A 組（`/history/ea8eba76...` 內的 prompt）

- 節點 `1..7`，**沒有 node 8 / 沒有任何 `LoraLoader`**。
- `2.inputs.clip = ["1",1]`、`3.inputs.clip = ["1",1]`（CLIP 直接來自 Checkpoint）。
- `5.inputs.model = ["1",0]`（KSampler 直接用 Checkpoint 的 MODEL）。
- `6.inputs.vae = ["1",2]`、`7` 從 `["6",0]` 取圖，與 `app.js:wf()` 零 LoRA 路徑一致。

### B 組（`/history/e136b906...` 內的 prompt）

```json
"8": {"class_type": "LoraLoader", "inputs": {
  "model": ["1", 0],
  "clip":  ["1", 1],
  "lora_name": "Star Savior - Serpang (Morpholi).safetensors",
  "strength_model": 0.8,
  "strength_clip": 0.8
}}
```

並確認改接：

- `2.inputs.clip = ["8",1]`、`3.inputs.clip = ["8",1]` → 正／負面提示詞的 CLIP 都經過 LoRA。
- `5.inputs.model = ["8",0]` → **KSampler 使用 LoRA 處理後的 MODEL**。
- `6.inputs.vae` 仍為 `["1",2]` → VAE 未被 LoRA 影響（正確）。
- `lora_name` 與 `/models/loras`、`LoraLoader` 可選項、實際檔案路徑三者一致。

### 執行期證據（不只是 JSON 存在）

- B 的 `status.messages` 含 `execution_cached: {"nodes": ["1","4"]}` → ComfyUI **重用了 A 的 Checkpoint 與 latent**，代表兩個模型載入起點完全相同；而 **node 8 不在 cached 清單**，代表 LoraLoader 真正執行了。
- 兩組皆 `status_str = "success"`、`completed = true`、`execution_success`，且沒有任何 `execution_error`／`execution_error` 訊息。
- 兩組 `outputs["7"].images` 都存在，metadata 皆為 1024×1024。

---

## 8. ComfyUI `/history` 與 console 結果【已驗證／部分未驗證】

| 項目 | A | B |
|---|---|---|
| `status_str` | success | success |
| `completed` | true | true |
| `execution_start` → `execution_success` | 1,795,689,640,782 → 1,795,689,672,103（約 31.3 s） | 1,795,689,672,883 → 1,795,689,695,337（約 22.5 s） |
| `execution_cached` nodes | `[]`（首次載入模型） | `["1","4"]`（模型與 latent 重用） |
| 錯誤訊息 | 無 | 無 |
| 模型載入失敗／檔案找不到 | 無 | 無 |
| 輸出圖 | `ui_A_00001_.png` | `ui_B_00001_.png` |

完整原始紀錄：`devtools/reports/lora-ab-20261126/history_A.json`、`history_B.json`。

**console 限制**【尚未驗證】：在 `C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\user\` 下沒有找到 ComfyUI 文字 log 檔，且不能中斷／附加到 ComfyUI 行程的 console。因此本輪以 `/history` 的 `status.messages` 作為執行期錯誤依據；它明確回報 `execution_success` 且沒有錯誤事件，但無法逐字呈現 console 中所有 warn。這不影響「LoraLoader 有執行」的結論，因為 node 8 未被快取且輸出發生變化。

---

## 9. 圖片比較結果【已驗證】

兩張圖由 `/comfy/view` 取得並保存副本；正式輸出仍留在 `D:\ComfyUI_output`。

| 項目 | A | B |
|---|---|---|
| ComfyUI 檔名 | `ui_A_00001_.png` | `ui_B_00001_.png` |
| 本機副本 | `image_A.png` | `image_B.png` |
| 路徑 | `devtools/reports/lora-ab-20261126/image_A.png` | `devtools/reports/lora-ab-20261126/image_B.png` |
| 尺寸 | 1024×1024 | 1024×1024 |
| 檔案大小 | 1,214,918 bytes | 1,289,840 bytes |
| SHA-256 | `f8e37dfe75db9b8156146ecf4ec1c9fc18852aafa26b8e0618cd163144f75cd4` | `543037e1356ca869f12c649cce7f6b340e057fb2e3f2cbf69364018a161778ac` |

像素差異（PIL，`devtools/reports/lora-ab-20261126/compare.json`）：

- `diff_bbox = [0,0,1024,1024]`（差異遍佈全圖）。
- 相異像素 **1,048,573 / 1,048,576（99.9997%）**。
- 每通道平均絕對差：R 70.38、G 72.71、B 68.28；RMS：93.89 / 91.71 / 87.02。
- 每像素三通道絕對差Summary：平均 211.37，最大 760（上限 765）。

**可觀察差異（人工檢視截圖）**：

- **A（無 LoRA）**：深棕／黑長髮、琥珀色眼睛、白色肩帶、接近平面的室內背景，的表情與髮型属一般動畫女孩。
- **B（有 LoRA）**：明顯轉為**金色雙馬尾**、藍色眼睛、黑色髮飾、淺藍色天空背景，整體角色設定與 A 完全不同。
- 差異方向與 LoRA 名稱「Serpang (Morpholi)」的角色特徵一致，而不是雜訊或 compression 差異。

注意：視覺差異很大，但本輪**沒有**把它當成單獨證據；它是與 `/history` 的 node 8 執行證據一起判讀的。

---

## 10. 根因判斷及證據可信度

### 判讀分類：**1. 確認 LoRA 正常參與推論**

依任務的判讀標準逐項對照：

| 標準 | 結果 |
|---|---|
| 有實際執行證據 | ✅ 兩次真實 `/prompt` + `/history`，皆 `execution_success`；B 的 node 8 未被 cached |
| ComfyUI 成功載入指定 LoRA | ✅ 沒有 `lora not found`／載入錯誤；`lora_name` 與唯一可用檔一致；無同名遮蔽 |
| B 工作流確實使用 LoRA 處理後的 MODEL／CLIP | ✅ `5.model=["8",0]`、`2.clip=3.clip=["8",1]`，node 8 輸出串接正確 |
| 其他參數完全相同 | ✅ Prompt 逐字相同、seed/steps/cfg/sampler/scheduler/尺寸一致，node 1 與 4 在 B 被重用 |
| 輸出确实不同 | ✅ 99.9997% 像素改变，且视觉上角色特征明显切换 |

**可信度：高**。這是單次 A/B，但控制變因嚴格、執行紀錄完整、差異量極大，足以排除「LoRA 完全沒作用」的假設。

### 對使用者回報「套用後沒有效果」的含義

- 本測試**沒有重現**該問題；在目前環境、目前唯一 LoRA、0.8 權重下，LoRA 效果非常明顯。
- 因此使用者的問題**不能**歸因於 `wf()` / `loraApplyToWorkflow()` 的 MODEL／CLIP 串接（該段已被真實執行證明正確）。
- 較可能的剩余環節（**尚未驗證**，不可當成結論）：使用者挑的 LoRA 與 Checkpoint 基底不相容、權重过低、該 LoRA 需要觸發詞但沒有設定、挑到不同於預期的同名檔、或比較基準不是同 seed／同提示詞。
- 本 LoRA 在**沒有任何 Trigger Words** 的情況下仍產生明顯效果，所以「沒有觸發詞」不是所有 LoRA 都失效的充分原因。

---

## 11. 未能驗證的項目

1. 其他 LoRA、其他 Checkpoint 的 A/B（本機只有 1 個 LoRA、1 個 Checkpoint）。
2. 多 LoRA 串接順序與個別權重的真實效果（只有單一 LoRA）。
3. 觸發詞自動加入路徑：本 LoRA 沒有 `trainedWords`，因此 `#pos` 自動加入邏輯未被真實觸發。
4. 使用者從 UI 按「生成」的完整前端路徑（本次直接構造與 `wf()` 相同的 JSON 並走 `/comfy` 代理；未經 `snapshotNow()`/`verifySelectedLoras()`，但 `/history` 證實工作流結構一致）。
5. ComfyUI console 逐字warn（無 log 檔、不可附加行程）。
6. 不同 seed、不同權重（特别是极低调權）下的效果阈值。
7. 使用者原始回報的具體 LoRA／設定組合（未提供，且 localStorage 中沒有選取紀錄）。

以上皆不影響本輪結論，但限制了對「所有 LoRA 都正常」的推廣。

---

## 12. Git 最終狀態

```
## main...origin/main [ahead 1]
 M app.css
 M app.js
 M devtools/lora_explorer_api_test.py
 M devtools/lora_explorer_core_test.mjs
 M devtools/lora_mock_civitai.py
 M devtools/lora_ui_test.mjs
 M devtools/test_ui_control_wd14.ps1
 M index.html
 M server.py
 M ui_control.ps1
 M ui_panel.ps1
 M ui_panel.pyw
?? devtools/reports/lora-personal-api-key-and-application-audit.md   （上一輪）
?? devtools/reports/lora-ab-20261126/                                  （本輪產物）
?? devtools/reports/lora-real-generation-ab-test.md                    （本報告）
...其餘既有 untracked 檔案完全未動
```

- `git diff --stat` 與開始時完全相同：`12 files changed, 1688 insertions(+), 104 deletions(-)`。
- 沒有 commit、push、stage、stash、checkout、clean、restore 或任何 Git 寫入。

---

## 13. 是否影響正式服務

**沒有不良影響**【已驗證】：

- 只送出 2 個正常的生圖任務，兩者都成功完成；測試前後 `/comfy/queue` 皆為空，沒有殘留或插隊影響。
- 沒有修改程式碼、設定、使用者 `localStorage`、模型檔案、輸出目錄或任何服務進程；ComfyUI PID 1760 與 Simple UI PID 12424 未被觸碰。
- 沒有下载、沒有 Civitai API 呼叫、沒有 API Key 使用。
- 瀏覽器只開了 3 個只讀分頁（UI localStorage 與兩張圖片），已全部關閉。
- 新增檔案只在 `devtools/reports/` 下，且是全新資料夾／檔名，沒有覆蓋既有資料。

---

## 14. 下一步最小修正建議

依本輪證據，不需要改動工作流的 LoRA 串接邏輯。建議minimum steps：

1. **回報使用者時明确指出**：目前環境的 LoRA 套用是有效的，請提供「出問題的 LoRA 檔名、Checkpoint、權重、是否設觸發詞」以便重現，不要直接改 `wf()`。
2. 若要降低同類誤報，做兩個**最小 UX 改動**（非本輪實作）：
   - 生成前若該 LoRA 沒有觸發詞，明顯提示「這個 LoRA 沒有觸發詞，效果可能不如預期」。
   - 在角色 LoRA 清單顯示完整相對名稱與基底資訊，並在基底與目前 Checkpoint 不相容時給警告（本輪 LoRA 的 `sdxl_` metadata 已可取得）。
3. 保留本報告的 `/history` 與圖片差異資料，作為日後回報「LoRA 沒效果」時的標準 A/B 驗收模板（同 seed、同 prompt、只開關 LoRA、查 `execution_cached` 與 `node 8`）。
4. 暂不處理 API Key／下載相關問題；那與本輪已證實的 LoRA 推論路徑無關。

---

## 15. 一句話結論

在目前正式環境中，以相同 checkpoint／prompt／seed／參數、只開關單一本地 LoRA 做真實 A/B，B 組 `LoraLoader` 確實執行且未被快取、KSampler 使用了它處理後的 MODEL／CLIP，輸出有 99.9997% 像素改變與明顯角色特徵切換——**確認 LoRA 正常參與推論**；使用者先前的「沒效果」未能在此重現，應轉向檢查特定 LoRA 的相容性、權重與觸發詞設定。
