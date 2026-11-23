# Sid-simple-ui：ComfyUI 簡易生圖介面

一個給「不想碰 ComfyUI 節點」的人用的單頁生圖前端。你把 ComfyUI 留在背景，改用這個頁面點標籤、按一顆生成鍵就有圖。

> 這是我自己日常在用、順手整理出來的公開版本。歡迎參考、自用或改造。

## 這個專案能做什麼

Sid-simple-ui 是 ComfyUI 的**外部極簡前端**，不是 ComfyUI 本身，也不是雲端代繪服務。

- 你連接的是**自己電腦上自行安裝與啟動的 ComfyUI**
- 生圖使用你自己的硬體、Checkpoint、模型與資源
- 不需要連接開發者的電腦，也不使用任何外部代繪服務
- 不需要學習 ComfyUI 的節點操作

> ComfyUI 必須由你自己安裝、啟動與管理；它的 Python、顯示卡驅動與模型請依 ComfyUI 官方文件準備，不屬於本專案。

## 介面特色與主要功能

- 左邊是標籤庫，中間是結果舞台，右邊是設定，底部只有一個主要動作：**生成**
- 中文標籤會自動對照成繪圖模型看得懂的 Danbooru 英文標籤
- 顯示生成進度，可以取消
- 保留最近生成的圖片縮圖（歷史），可放大查看
- 18+ 標籤預設隱藏，需要手動開啟
- 常用標籤會自動學習，下次更容易找到
- 圖片反推（WD14）是**選用功能**，預設不包含

## 系統需求

- Windows 桌面環境（建議 Windows 10 / 11）
- **Python 3.10 或更新版本**
- 已安裝並可自行啟動的 ComfyUI（任何安裝方式都可以，不限 Windows portable 版）
- 基本服務（含 `server.py`）只用 Python 標準庫，**不需 `pip install` 任何第三方套件**
- 前端使用原生 HTML / CSS / JavaScript，**不需要 Node.js、npm 或 Build System**

## 安裝與啟動

以下假設你已經自己安裝並啟動 ComfyUI，且它監聽 `http://127.0.0.1:8188`（ComfyUI 預設值）。這種情況不需要設定任何環境變數。

1. 下載或 Clone 本 Repo 到任意資料夾，例如 `C:\sid-comfyui-simple-ui`。

2. 確認 Python 可以使用：

   ```powershell
   python --version
   ```

   如果系統回應找不到 `python`，可改用 Windows 的 `py` 啟動器，例如 `py --version`、`py server.py`。

3. 先啟動你自己的 ComfyUI，並確認它正在運行。

4. 在 Repo 目錄啟動 Sid-simple-ui：

   **PowerShell**

   ```powershell
   cd C:\sid-comfyui-simple-ui
   python server.py
   ```

   **CMD**

   ```cmd
   cd /d C:\sid-comfyui-simple-ui
   python server.py
   ```

5. 開啟瀏覽器：<http://127.0.0.1:7860>

6. 看到頁面後，在右欄選擇你已安裝的 Checkpoint、點幾個左邊的標籤，再按「生成」。

停止服務時，在該終端機按 `Ctrl + C`，或直接關閉該終端機視窗。

> 如果沒有設定 `COMFY_LAUNCH_CMD`，本介面**不會**猜你的 ComfyUI 安裝在哪裡，也不會自動啟動任何程式。請自己先啟動 ComfyUI。

## 如何連接自己的 ComfyUI

Sid-simple-ui 預設向本機 `http://127.0.0.1:8188` 連線。如果你的 ComfyUI 在不同 Port（例如 `8189`），啟動前設定 `COMFY_URL`：

**PowerShell**

```powershell
$env:COMFY_URL = "http://127.0.0.1:8189"
python server.py
```

**CMD**

```cmd
set COMFY_URL=http://127.0.0.1:8189
python server.py
```

注意事項：

- 只支援本機loopback 位址：`127.0.0.1` 或 `localhost`。
- **不支援 LAN 或遠端 ComfyUI**（例如 `192.168.x.x` 或網域名稱）。
- 只寫到位址與 Port，不要加路徑、query 或 fragment。
- 環境變數只對目前終端機有效；重開視窗後需要重新設定。

## 基本操作說明

1. 右欄選擇你已安裝的 Checkpoint。
2. 左邊點標籤（建議 3～6 個），也可以用搜尋框找標籤。
3. 必要時在「補充描述」與「負面提示詞」補充文字。
4. 可調整尺寸、張數、步數、CFG 與種子。
5. 按「生成」，進度會顯示在中間舞台；生成中可以取消。
6. 完成後結果會顯示在舞台上，並加入下方歷史縮圖。點縮圖可放大查看。

常用快捷鍵：

| 按鍵 | 功能 |
|---|---|
| `Ctrl + Enter` / `Cmd + Enter` | 生成 |
| `Esc` | 關閉視窗；生成中連按兩次才會取消 |
| `/` | 聚焦標籤搜尋框 |
| `?` | 顯示說明 |
| `←` / `→` | 在放大檢視中切換上一張／下一張 |

## Checkpoint 與 Workflow

- Checkpoint 清單由 ComfyUI 動態提供，右欄下拉選單會列出你已安裝的模型。
- 直接在介面選擇即可，**基本操作不需要修改 Workflow 或程式碼**。
- 本 Repo 沒有附任何 Checkpoint 或模型，你必須自行安裝符合 ComfyUI 的模型。

## 環境變數及進階設定

環境變數都要在啟動 `server.py` **之前**設定，重啟服務後才會生效。

| 變數 | 預設值 | 用途 | 什麼時候需要設定 |
|---|---|---|---|
| `COMFY_URL` | `http://127.0.0.1:8188` | 你的 ComfyUI 在哪裡 | ComfyUI 不在預設 8188 Port 時 |
| `COMFY_OUTPUT_DIR` | 未設定 | 刪圖與「開啟輸出資料夾」使用的目錄 | 只有你需要這兩個功能時 |
| `SIMPLE_UI_PORT` | `7860` | 本頁面的 Port（不是 ComfyUI 的 Port） | 7860 被佔用時 |
| `COMFY_LAUNCH_CMD` | 未設定 | 由本介面代為啟動 ComfyUI 的指令 | 想使用自動啟動時 |
| `SIMPLE_UI_LOG_DIR` | 見下方 | 診斷日誌目錄 | 想改日誌位置時 |
| `WD14_PY` / `WD14_WORKER` | 未設定 | EVA02 反推的 Python 與 Worker | 自行架設 WD14 時 |
| `WD14_VIT_PY` / `WD14_VIT_WORKER` | 未設定 | ViT v3 反推的 Python 與 Worker | 自行架設 WD14 ViT 時 |
| `WD14_TMP` | 見下方 | 反推暫存圖目錄 | 想改暫存位置時 |

### `COMFY_OUTPUT_DIR`

- **不是基本生圖的必要條件**。不設定也可以生圖、看圖、載入歷史。
- 最簡單的做法是點右欄輸出設定的「設定資料夾」，貼上你的 ComfyUI 輸出資料夾完整路徑；設定後立即生效，不需要重開介面，下次啟動也會記住。若無法寫入保存設定，介面會明確告訴你「已生效但重啟後可能失效」，不會假裝已經永久保存。
- 也可以使用環境變數（適合自動化或進階使用者）。啟動時環境變數優先於介面儲存的設定；若環境變數有明確設定但路徑無效，會顯示錯誤且不回退到舊的保存設定（基本生圖仍可使用）。
- 必須指向**你的 ComfyUI 實際使用的輸出資料夾**，而且該資料夾必須已存在。
- 未設定時，「刪除圖片」與「開啟圖片資料夾」會停用。
- 為避免刪錯圖，刪除前會比較 ComfyUI 回傳的圖片內容與本機檔案；內容不一致時不會刪除，也不會移除歷史紀錄。

```powershell
$env:COMFY_OUTPUT_DIR = "C:\Users\YourName\ComfyUI\output"
python server.py
```

### `SIMPLE_UI_PORT`

預設 `7860`。若已被其他程式佔用：

```powershell
$env:SIMPLE_UI_PORT = "7861"
python server.py
```

然後開啟 <http://127.0.0.1:7861>。

### `COMFY_LAUNCH_CMD`（選用）

- 預設未設定；本介面**不會**猜測或啟動任何 ComfyUI。
- 只有明確設定時，當 ComfyUI 尚未連線、而介面需要代為啟動時，才會執行你指定的指令。你可以在生圖流程或狀態列觸發啟動；執行內容完全來自該設定。
- 指令寫成一個字串，含空白的路徑請用引號包住，例如：

  ```powershell
  $env:COMFY_LAUNCH_CMD = '"C:\Path\To\Python\python.exe" "C:\Path\To\ComfyUI\main.py"'
  python server.py
  ```

- 若同時設定 `COMFY_OUTPUT_DIR`，且指令中沒有 `--output-directory`，啟動時會自動附加該參數。
- 指令格式錯誤或啟動失敗時，介面會顯示明確原因。

### 資料與日誌位置

- 診斷日誌預設放在 `%LOCALAPPDATA%\SidSimpleUI\logs`。
- 反推暫存圖預設放在 `%LOCALAPPDATA%\SidSimpleUI\wd14-tmp`。
- 資料根目錄的優先順序是 `LOCALAPPDATA`、`APPDATA`、系統暫存目錄；若沒有 `LOCALAPPDATA`，會依序改用後兩者。
- 在介面設定的輸出資料夾路徑會存入上述資料根目錄的 `output_dir.txt`；若刪除該檔或換電腦，需要重新設定。若該檔無法寫入，介面會顯示「已生效但重啟後可能失效」，不會顯示為永久保存成功。
- 可用 `SIMPLE_UI_LOG_DIR` / `WD14_TMP` 改成自訂的**絕對路徑**；設定無效時，WD14 會回明確錯誤，日誌會退回預設位置，兩者都不會阻止基本服務啟動。
- 本程式只會使用上述設定的日誌與暫存目錄，不會掃描或清理其他位置的日誌及暫存資料；你自行指定的目錄仍會正常使用。

## WD14 反推功能（選用）

- 基本生圖**完全不依賴 WD14**；沒有 WD14 時，所有基本功能都正常使用。
- 公開 Repo **不包含完整的 WD14 Worker、模型與專用 Python 環境**。Clone 之後不能假設反推功能已經可用。
- 沒有設定 WD14 相關環境變數時，反推**不會啟動任何 Worker**，也不會尋找別處的資源；按「反推標籤」會顯示「尚未安裝或未完成設定」。
- EVA02 與 ViT v3 各自獨立；只設定其中一套，另一套仍會顯示未設定。
- 目前尚無公開的 WD14 安裝指引；一般使用者不需要設定任何 `WD14_*` 變數，直接忽略此功能即可。
- `WD14_TMP` 未設定時，暫存圖放在本機使用者資料目錄下，不會放在 Repo 或 ComfyUI 輸出目錄；背景清理只會刪除本程式產生且過期的暫存檔。

## 常見問題與故障排除

| 狀況 | 可能原因與處理 |
|---|---|
| 執行 `python` 顯示找不到指令 | Python 未安裝或未加入 PATH；可改用 `py server.py`，或重新安裝 Python 並勾選加入 PATH。 |
| Port 已被佔用 | 7860 被其他程式使用；改設 `SIMPLE_UI_PORT` 並開啟對應網址。 |
| 頁面顯示 ComfyUI 沒連線 | ComfyUI 沒啟動，或 `COMFY_URL` 指向錯誤 Port；先啟動 ComfyUI，或確認 `COMFY_URL`。 |
| 顯示尚未設定啟動指令 | 這是正常的：本介面不會猜你的 ComfyUI 安裝位置，也不會在未設定時自動啟動。請先自行啟動 ComfyUI；若要讓介面代啟動，請設定 `COMFY_LAUNCH_CMD`。 |
| 啟動時出現 `COMFY_URL 設定錯誤` | 檢查是否寫成 LAN IP、少了 Port、或含額外路徑。 |
| 可以按生成，但不能刪圖 / 開資料夾 | 尚未設定輸出資料夾；請點右欄輸出設定的「設定資料夾」，貼上 ComfyUI 輸出資料夾路徑。設定後立即生效，不必重啟。 |
| 反推標籤顯示尚未安裝 | 公開 Repo 不含 WD14 資源；基本生圖不受影響，可忽略此功能。 |

## 資料儲存、備份及解除安裝

### 資料儲存與備份

- 生成歷史與偏好設定存放在**瀏覽器**的儲存空間中。清除瀏覽器資料會讓歷史消失，請事先留意。
- 圖片本身由你的 ComfyUI 輸出，不在本 Repo 內。
- 更新前請先備份你自己修改過的檔案。若是 Git clone，可先執行 `git status` 檢查工作區；若有自己的修改，請另外備份，不要直接覆蓋或捨棄。

### 解除安裝

1. 停止你自己啟動的 Sid-simple-ui 程序（在終端機按 `Ctrl + C` 或關閉終端機）。
2. 刪除本 Repo 的資料夾即可。
3. **不要刪除你的 ComfyUI、模型、輸出圖片或其他資料**；它們不在本 Repo 內。

## 授權與致謝

授權：Fair AI Public License 1.0-SD（詳見 `LICENSE`）。

致謝：ComfyUI、NovelAI-tag-generator（標籤格式參考）。

> 如果你是 AI Coding Agent，需要修改這個專案的程式碼，請另外閱讀 [`AGENTS.md`](AGENTS.md)。一般使用者不需要閱讀該文件。
