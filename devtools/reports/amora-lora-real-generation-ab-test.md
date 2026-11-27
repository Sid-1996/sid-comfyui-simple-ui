# Amora Star Savior 角色 LoRA 真實生圖 A/B 驗收

> 任務性質：已授權的有限度 GPU 生圖（第一輪 4 張 + 第二輪 3 張 = 7 張，未超限）。本輪未修改程式碼／UI 設定／localStorage／checkpoint／既有模型；未重啟服務；未下載模型；未呼叫 Civitai API 或使用 API Key；未 commit/push。唯一新增的是本報告與專用產物目錄 `devtools/reports/amora-lora-ab-20261126/`（開始前不存在，沒有覆蓋既有檔案）。

---

## 1. 起始 Repository / Branch / HEAD / Git 狀態

| 項目 | 值 |
|---|---|
| Repository | `C:\ComfyUI\simple_ui` |
| Branch | `main`，`## main...origin/main [ahead 1]` |
| HEAD | `cf5609e0cfbd69163247786f1f50dbf8e600c090` |
| Remote | `origin https://github.com/Sid-1996/sid-comfyui-simple-ui.git` |
| tracked modified | 13（`AGENTS.md`、`app.css`、`app.js`、5 個 devtools 檔案、`index.html`、`server.py`、`ui_control.ps1`、`ui_panel.ps1`、`ui_panel.pyw`） |
| staged | 0 |
| `git diff --stat` | `13 files changed, 1702 insertions(+), 104 deletions(-)` |
| CodeGraph | Files 35 / Nodes 1,094 / Edges 4,837；Pending Added 4 / Modified 2（未 sync，唯讀約束） |

已讀取 `C:\ComfyUI\AGENTS.md` 與 `C:\ComfyUI\simple_ui\AGENTS.md`（含 12.1 節瀏覽器工具路由）。

---

## 2. 正式服務 PID 與 queue 狀態【已驗證】

| 服務 | PID | CommandLine／監聽 |
|---|---|---|
| ComfyUI | **1760** | `...\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --output-directory D:\ComfyUI_output`；`127.0.0.1:8188` |
| Simple UI | **12424** | `...\python_embeded\python.exe C:\ComfyUI\simple_ui\server.py`；`127.0.0.1:7860` |

- 測試前 `GET /comfy/queue`：`queue_running=[]`、`queue_pending=[]` → 沒有使用者工作，未插隊。
- 測試後 queue 同樣為空，沒有殘留任務。
- GPU：`NVIDIA GeForce RTX 3060`，總 12,288 MiB；測試前已用 7,734 MiB、可用 4,382 MiB、利用率 2%。未發生 OOM 或服務異常；PID 前後不變，沒有重啟。

---

## 3. LoRA SHA-256 及 ComfyUI 辨識結果【已驗證】

| 項目 | 值 |
|---|---|
| 檔案 | `C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\models\loras\Amora.safetensors` |
| 大小 | 228,458,292 bytes |
| 重新計算 SHA-256 | `C46B816CB90118E85CE4CE7F857B24E9E918DF3ED9B6AE3930A61B6424F708F5`（與預期一致） |
| `GET /comfy/models/loras` | `Amora.safetensors`、`Star Savior - Serpang (Morpholi).safetensors` |
| `LoraLoader.lora_name` | 同上兩項 |
| Checkpoint | `WAI-Nsfw-Illustrious-17.safetensors`（ComfyUI 唯一可選 checkpoint） |

---

## 4. Checkpoint 與完整測試參數

| 參數 | 值 |
|---|---|
| Checkpoint | `WAI-Nsfw-Illustrious-17.safetensors` |
| LoRA | `Amora.safetensors` |
| Seed | `20261126`（固定，所有 7 張相同） |
| Steps / CFG | 25 / 6 |
| Sampler / Scheduler | `dpmpp_2m` / `karras` |
| Denoise | 1 |
| 尺寸 / 張數 | 1024×1024 / 1 |
| VAE | Checkpoint 內建（node 1 slot 2），各組相同 |
| 輸出節點 | node `7` `SaveImage`，prefix `ui_<tag>` |
| 工作流來源 | 與 `app.js:wf()` 相同結構；B/C/D/W* 加入 node `8` `LoraLoader`，`model=["1",0]`、`clip=["1",1]`、`2.clip=3.clip=["8",1]`、`5.model=["8",0]` |

### 基本 Positive（所有組固定）

```
masterpiece, best quality, amazing quality, 1girl, solo, upper body, looking at viewer, simple background
```

### Negative（所有組固定）

```
worst quality, low quality, bad anatomy, bad hands, extra fingers, missing fingers, deformed hands, mutated hands, fused fingers, watermark, text, signature, blurry, child, loli, shota
```

### trainedWords 原始資料（逐字保留，未刪改、未重新分類）

**Group 1**
```
amora, blonde hair, hair ornament, long hair, purple eyes, blue eyes, hair over one eye,single hair bun, mole under eye,,mature_female
```

**Group 2**
```
cleavage, black dress, flower, bare shoulders, detached sleeves, high heels, thigh strap, jewelry, gloves, hair ornament, no panties, purple rose, black gloves, long sleeves, purple dress, choker
```

頁面沒有把 Group 2 標示為 Negative Prompt；本輪兩組都放在 **Positive**，沒有擅自移到 Negative，也沒有改寫內容。

---

## 5. 測試矩陣

| 代號 | 輪次 | LoRA | Weight | 加入的 trainedWords |
|---|---|---|---|---|
| A | 1 | 無 | — | 無 |
| B | 1 | Amora | 0.8 | 無 |
| C | 1 | Amora | 0.8 | Group 1 |
| D | 1 | Amora | 0.8 | Group 1 + Group 2 |
| W06 | 2 | Amora | 0.6 | Group 1 |
| W08 | 2 | Amora | 0.8 | Group 1 |
| W10 | 2 | Amora | 1.0 | Group 1 |

第二輪選 Group 1 的原因：第一輪 C 已清楚呈現角色特徵，而 D 的主要差異是服裝且出現較暴露構圖；就「角色喚起」目的，Group 1 是最小且有效的組合。

---

## 6. 各組 Prompt 與輸出檔案

| 代號 | Positive Prompt（相對於基本 Prompt 的差異） | Prompt ID | 輸出檔 | 輸出 bytes | SHA-256 |
|---|---|---|---|---|---|
| A | 無差異 | `99974e34-11fa-4437-b3ad-519d025a4ff7` | `ui_A_00002_.png` | 1,152,522 | `900085b3…b95eb3` |
| B | 無差異 | `3d092207-c43d-4fb3-b4c0-9b10f613a6c3` | `ui_B_00002_.png` | 1,158,356 | `5ede95d7…f9ffa` |
| C | `, ` + Group 1 | `cc4b1fec-036b-402a-b190-d98ed347acde` | `ui_C_00001_.png` | 1,079,025 | `914d1e66…999bb58` |
| D | `, ` + Group 1 + `, ` + Group 2 | `4a71ec31-0d72-4b09-a4cb-aa5b8c4b641c` | `ui_D_00001_.png` | 1,024,697 | `13968a76…03f3abc` |
| W06 | `, ` + Group 1 | `7f6b3918-4247-4ad3-9623-ee324f604db3` | `ui_W06_00001_.png` | 1,014,498 | `b19e0473…c001b1a` |
| W08 | `, ` + Group 1 | `d460b1b2-8b80-49f4-9434-9626f982199b` | `ui_W08_00001_.png` | 1,079,027 | `8126c230…c76da` |
| W10 | `, ` + Group 1 | `038311c4-f315-4cb6-bfcb-1b395b03a064` | `ui_W10_00001_.png` | 1,064,940 | `ac2dc642…0339b3` |

所有圖片副本：`devtools/reports/amora-lora-ab-20261126/image_<tag>.png`（皆 1024×1024）。

**像素差異（PIL）**：

| 比較 | 相異像素比例 | 每通道平均絕對差 |
|---|---|---|
| A vs B | 99.736% | 37.15 / 36.30 / 35.41 |
| A vs C | 99.996% | 76.65 / 72.80 / 68.17 |
| A vs D | 99.988% | 91.18 / 84.28 / 78.76 |
| C vs W06 | 99.991% | 28.43 / 33.96 / 36.68 |
| **C vs W08** | **0%（完全一致）** | 0 / 0 / 0 |
| C vs W10 | 99.982% | 22.46 / 27.77 / 29.67 |

> 第二份 diff 檔 `compare_C_W06_W08_W10.json` 內的 key 名稱仍寫成 `A_vs_*`，但比較基準其實是 **C**；此為腳本沿用命名，數值以上表為準。

C 與 W08 在相同 seed／prompt／weight／checkpoint 下**逐像素完全一致**，證明流程可重現，也證明輸出差異不是隨機雜訊。

---

## 7. Workflow / History 證據【已驗證】

彙整檔：`devtools/reports/amora-lora-ab-20261126/verification.json`，原始資料：每組 `workflow_<tag>.json`、`history_<tag>.json`。

| 代號 | status | node 8 `lora_name` | weight | `execution_cached` nodes | KSampler model | 正／負 CLIP |
|---|---|---|---|---|---|---|
| A | success | 無（正確） | — | `["1","4"]` | `["1",0]` | `["1",1]` / `["1",1]` |
| B | success | `Amora.safetensors` | 0.8 | `["1","4"]` | `["8",0]` | `["8",1]` / `["8",1]` |
| C | success | `Amora.safetensors` | 0.8 | `["1","3","4","8"]` | `["8",0]` | `["8",1]` / `["8",1]` |
| D | success | `Amora.safetensors` | 0.8 | `["1","3","4","8"]` | `["8",0]` | `["8",1]` / `["8",1]` |
| W06 | success | `Amora.safetensors` | 0.6 | `["1","4"]` | `["8",0]` | `["8",1]` / `["8",1]` |
| W08 | success | `Amora.safetensors` | 0.8 | `["1","4"]` | `["8",0]` | `["8",1]` / `["8",1]` |
| W10 | success | `Amora.safetensors` | 1.0 | `["1","4"]` | `["8",0]` | `["8",1]` / `["8",1]` |

全部 7 組皆 `status_str=success`、`completed=true`，沒有 `execution_error`。

**關於 C/D 的 `execution_cached` 含 `"8"`**：LoraLoader 的輸入（`lora_name`、`strength_model`、`strength_clip`、上游 model/clip）與 B 完全相同，ComfyUI 復用了 B 的 node 8 結果；這不是「略過 LoRA」，而是「相同輸入的計算結果重用」。B 與 W06/W08/W10 的 node 8 未快取，證明 LoraLoader 確實執行過。C/D 的 KSampler 仍明確接在 `["8",0]`，CLIP 接在 `["8",1]`。

所有組的 seed=20261126、steps=25、cfg=6、sampler=dpmpp_2m、scheduler=karras、denoise=1、ckpt=WAI-Nsfw-Illustrious-17.safetensors、negative 完全相同；差異只有上表列出的 LoRA 與 trainedWords／weight。

---

## 8. 視覺比較與判斷（逐張，含不如預期處）

| 代號 | 觀察 |
|---|---|
| **A** | 黑長髮、藍眼、無耳飾、無眼下痣的泛用動畫女孩。**不是 Amora**。 |
| **B** | 仍是黑髮藍眼，但出現菱形耳飾；LoRA 在**沒有觸發詞時只滲出配件**，角色本體沒有被喚起。這直接回答「是否需要 trigger words」：**需要**。 |
| **C** | 金髮、紫眼、單側髮束遮眼、單丸子頭、黑色髮飾、眼下痣、菱形耳飾、深色領口/頸飾——**清楚呈現 Amora 角色特徵**。Group 1 是有效角色觸發組合。 |
| **D** | 臉部特徵與 C 一致，但服裝轉為紫黑玫瑰／手套／吊帶／頸飾等 Group 2 描述；構圖更性感、pose 明顯改變。**Group 2 主要改變服裝與姿態，不是角色觸發詞**；其「no panties」等詞造成較暴露結果，如實記錄，未隱瞞。 |
| **W06** | 仍可辨識 Amora，但耳飾部分偏藍、配件穩定性較差；角色特徵比 0.8 稍弱。 |
| **W08** | 與 C 完全一致：金髮、紫眼、髮飾、眼下痣、深色耳飾穩定，沒有臉部／手部明顯異常。 |
| **W10** | 角色特徵穩定，肩部黑色飾件更明顯；未見明顯崩壞或品質下降，但只測過單一 seed，不能推廣。 |

**綜合判讀**：

1. **Amora 能在目前 Illustrious checkpoint 上正常呈現**——前提是加入 Group 1 trainedWords。
2. **需要 trigger words**：B（有 LoRA、無觸發詞）沒有喚起角色，只有配件滲出；C 才清楚角色化。
3. **Group 1 影響角色外觀**（髮色、紫眼、眼下痣、丸子頭、髮飾）；**Group 2 影響服裝／玫瑰／手套／頸飾與姿態**，不是負面詞，也不該被當成 Negative Prompt。
4. **Weight**：0.8 最穩定且可重現；0.6 偏弱且不穩定；1.0 未見明顯劣化但特件更強。
5. 沒有觀察到 checkpoint 不相容導致的錯誤或明顯畫面崩壞；LoRA 檔案 metadata 為 `stable-diffusion-xl-v1-base/lora`，與 Illustrious（SDXL 系）相容。

---

## 9. 最佳 trigger words 組合與建議 weight

- **角色觸發最佳組合：Group 1**（`amora, blonde hair, ... mature_female`），weight **0.8**。
- 若需要完整服裝再現，可追加 Group 2，但要注意它含較暴露描述且會改變姿態；本輪不建議把 Group 2 放進 Negative Prompt（官方沒有如此標示）。
- 建議初版 UI weight 維持現有預設 0.8；**本輪未修改任何 UI 預設值**。
- 檔案 metadata `triggerWords: []`，所以 UI 不會自動帶入這些詞；使用者需手動設定（本輪也未寫入 localStorage）。

---

## 10. 未執行測試與原因

| 未執行 | 原因 |
|---|---|
| 多 seed sweep／高解析度批次 | 測試數量上限 7 張，且禁止擴大批次 |
| 其他 checkpoint | 禁止替換，且目前只有一個 checkpoint |
| 把 Group 2 放進 Negative Prompt | 官方未如此標示，任務明確禁止 |
| 修改 trainedWords 原文或偷偷刪改 | 任務明確禁止；已逐字保留 |
| 重啟 ComfyUI／Simple UI | 禁止，且無需重啟 |
| 修改 UI 設定／localStorage／.weight 預設 | 禁止 |
| 下載其他模型／呼叫 API／使用 API Key | 禁止 |
| 生圖超過 7 張 | 上限限制 |

---

## 11. Git 最終狀態

```
## main...origin/main [ahead 1]
（13 項 tracked modified 完全不變，git diff --stat 與開始時相同）
?? devtools/reports/amora-lora-ab-20261126/                 ← 本輪產物（唯一新增目錄）
?? devtools/reports/amora-lora-real-generation-ab-test.md   ← 本報告（唯一新增檔案）
```

- 沒有 stage／commit／push／stash／checkout／clean 或其他 Git 寫入。
- 既有的 13 項修改、其他報告與 devtools 檔案完全未動。

---

## 12. 服務、使用者設定與既有資料是否受到影響

- ComfyUI PID 1760、Simple UI PID 12424 前後不變；沒有中斷服務，queue 測試前後皆空。
- 沒有修改 checkpoint、LoRA 或其他模型；`Amora.safetensors` SHA-256 前後一致。
- 沒有修改 UI 程式碼、設定或 localStorage；沒有寫入自動觸發詞或改權重。
- 沒有覆蓋或刪除使用者圖片；所有輸出都是新檔（`ui_<tag>_0000N_.png`），副本另存於專用目錄。
- 瀏覽器查核用分頁已全數關閉；沒有讀取或使用憑證。
- 唯一新增資料是 7 張測試圖與本報告的產物目錄／報告。

---

## 13. 尚未解決的問題及風險

1. **觸發詞不會自動帶入**：檔案 metadata `triggerWords: []`，使用者若只選 LoRA 而不設觸發詞，會得到 B 的結果（黑髮、角色未喚起）。這很可能就是先前「套用 LoRA 沒效果」的使用者情境。
2. **單一 seed／單一 checkpoint**：結論只適用於 seed 20261126 + WAI Illustrious；不同 seed 的穩定性（尤其 weight 1.0 與 0.6）尚未驗證。
3. **Group 2 內容敏感**：含「no panties」等詞，會改變服裝與姿態；若不想要暴露結果，不應加入。但仍不能把它重新分類為 Negative Prompt（官方未標示）。
4. **node 8 快取語意**：C/D 復用 B 的 LoraLoader 結果；雖然 KSampler 仍接在 node 8，但若要嚴格證明「每次都重新執行 LoraLoader」，需避免快取（本輪未做，因 B/W* 已證明執行）。
5. **最小修正方向**：若要改善使用者體驗，應在生成前偵測「已選 LoRA 但沒有觸發詞」並提示，而不是改工作流；工作流本身已被真實 A/B 證明正確。

---

## 14. 一句話結論

7 張有限度真實生圖證明：**Amora LoRA 在目前 Illustrious checkpoint 上正常作用，但必須加入 Group 1 trainedWords 才會喚起角色**；Group 2 主要影響服裝而非角色；weight 0.8 最穩定且可逐像素重現。最佳角色組合為 **Group 1 + weight 0.8**；問題不在工作流，而在「觸發詞不會自動帶入」的使用者體驗。未重啟服務、未改任何正式設定，Git 無變動。
