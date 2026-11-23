# Sid 的 ComfyUI 簡易生圖介面

> 一個給「不想碰 ComfyUI 節點」的人用的單頁生圖前端。
> 我自己日常在用，順手整理成公開寶藏，歡迎參考、自用、改造。

## 這是什麼

Sid-simple-ui 是 ComfyUI 的**外部極簡生圖前端**。你把 ComfyUI 留在背景，改用這個頁面點標籤、按一顆「生成」鍵就有圖。

- 你在自己的電腦上執行這個介面，連接**你自己啟動的 ComfyUI**
- 生圖使用的是你自己的硬體、Checkpoint、模型與資源
- 不需要連接開發者的電腦，也不使用任何外部代繪服務
- 左邊標籤庫、中間舞台、右邊設定，只有一個主要動作
- 中文標籤 ↔ Danbooru 英文自動對照
- 生成進度、取消、歷史縮圖、燈箱、快捷鍵
- 18+ 標籤預設隱藏，需手動開啟
- 標籤使用會自動學習，下次更快
- WD14 圖片反推是**選用功能**，預設不包含（見下方說明）

> 前端由 HTML / CSS / JavaScript 組成，沒有 build step；`server.py` 只使用 Python 標準庫。

## 系統需求

- Windows 桌面環境（建議 Windows 10 / 11）
- **Python 3.10 或更新版本**（建議；基本服務最低為 3.5，但你不需要去裝舊版）
- **ComfyUI 必須由你自己安裝、啟動與管理**。任何安裝方式都可以，不限 Windows portable 版
- 基本服務（含 `server.py`）只用 Python 標準庫，**不需 `pip install` 任何第三方套件**
- 前端不需要 Node.js、npm、Build System 或外部 CDN；直接開瀏覽器即可

> ComfyUI 本身所需的 Python／顯示卡驅動／模型，請依 ComfyUI 官方文件安裝；那些不屬於本 Repo。

## 安裝與啟動

以下假設你已經自己安裝並啟動 ComfyUI，且它監聽 `127.0.0.1:8188`（ComfyUI 預設值）。這種情況不需要設定任何環境變數。

1. 下載或 Clone 本 Repo 到任意資料夾，例如 `C:\sid-comfyui-simple-ui`。
2. 確認 Python 可以使用：

   ```powershell
   python --version
   ```

   如果系統回應找不到 `python`，可改用 Windows 的 `py` 啟動器，例如 `py --version`、`py server.py`。

3. 先啟動你自己的 ComfyUI，並確認它正在運行。
4. 在 Repo 目錄執行：

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

5. 開啟瀏覽器：

   <http://127.0.0.1:7860>

看到頁面後，在右欄選擇你已安裝的 Checkpoint、點標籤，再按「生成」即可。停止服務時，在該終端機按 `Ctrl + C`，或直接關閉該終端機視窗。

### 若 ComfyUI 使用其他本機 Port

例如 ComfyUI 在 `8189`，啟動 Sid-simple-ui 前先設定 `COMFY_URL`：

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

環境變數只對目前終端機有效；重開視窗後需要重新設定。

## 環境變數

一般使用者只會用到下面三項。**全部都要在啟動 `server.py` 前設定，重啟服務後才會生效。**

| 變數 | 預設值 | 用途 | 什麼時候需要設定 |
|---|---|---|---|
| `COMFY_URL` | `http://127.0.0.1:8188` | 告訴 Sid-simple-ui 你的 ComfyUI 在哪裡 | ComfyUI 不在預設 8188 Port 時 |
| `COMFY_OUTPUT_DIR` | 未設定 | 刪圖與「開啟輸出資料夾」使用的目錄 | 只有你需要這兩個功能時 |
| `SIMPLE_UI_PORT` | `7860` | 本頁面的 Port（不是 ComfyUI 的 Port） | 7860 被佔用時 |

### `COMFY_URL`

- 只支援本機 loopback 位址：`127.0.0.1` 或 `localhost`。
- 支援 `http` 與 `https`，但**不支援 LAN 或遠端 ComfyUI**（例如 `192.168.x.x` 或網域名稱會被拒絕）。
- 必須寫到 Port 為止，不要加路徑、query 或 fragment。
- 範例：`http://127.0.0.1:8189`、`http://localhost:8189`。
- 設定後，介面不會再嘗試代你啟動 ComfyUI，請自行啟動它。
- 設定格式錯誤時，`server.py` 會直接終止並印出中文說明。

### `COMFY_OUTPUT_DIR`

- **不是基本生圖的必要條件**。不設定也可以生圖、看圖、載入歷史。
- 必須指向**你的 ComfyUI 實際使用的輸出資料夾**，而且該資料夾必須已存在。
- 未設定時，「刪除圖片」與「開啟圖片資料夾」會停用；設定後才有作用。
- 為避免刪錯圖，刪除前會比較 ComfyUI 回傳的圖片內容與本機檔案（SHA-256）；內容不一致時不會刪除，也不會移除歷史紀錄。
- 範例：

  **PowerShell**
  ```powershell
  $env:COMFY_OUTPUT_DIR = "C:\Users\YourName\ComfyUI\output"
  python server.py
  ```

  **CMD**
  ```cmd
  set "COMFY_OUTPUT_DIR=C:\Users\YourName\ComfyUI\output"
  python server.py
  ```

### `SIMPLE_UI_PORT`

- 預設 `7860`，這是你能開啟本頁面的 Port，不是 ComfyUI 的 Port。
- 若 7860 已被其他程式佔用，可改設其他數字；啟動後請開啟對應網址。
- 範例：

  **PowerShell**
  ```powershell
  $env:SIMPLE_UI_PORT = "7861"
  python server.py
  ```

  **CMD**
  ```cmd
  set SIMPLE_UI_PORT=7861
  python server.py
  ```

  然後開啟 <http://127.0.0.1:7861>。

## Checkpoint 與 Workflow

- Checkpoint 清單由 ComfyUI 動態提供，右欄的下拉選單會列出你已安裝的模型。
- 直接在 UI 選擇你想用的 Checkpoint 即可，**基本操作不需要修改 Workflow 或程式碼**。
- 本 Repo **沒有附任何 Checkpoint 或模型**，你必須自行安裝符合 ComfyUI 的模型。

## WD14 反推（選用功能）

- 基本生圖**完全不依賴 WD14**；沒有 WD14 時，本頁面所有基本功能都正常使用。
- 公開 Repo 目前**不包含完整的 WD14 Worker、模型與專用 Python 環境**。Clone 之後不能假設反推功能已經可用。
- 開發者本機 `C:\ComfyUI\tools` 底下的內容不屬於本 Repo，也不會隨 Clone 一起取得。
- 目前尚無公開的 WD14 安裝指引；若缺少必要資源，按「反推標籤」時會明確提示「尚未安裝或未完成設定」，不會影響生圖。
- 一般使用者不需要設定任何 `WD14_*` 環境變數。

## 桌面控制台

Repo 內的 `ui_control.ps1`、`ui_panel.pyw`、`ui_panel.ps1` 是**開發者本機輔助工具**，不是一般使用者的安裝步驟。

請不要使用它們：這些腳本含有開發者本機的路徑，且可能停止你自己的 ComfyUI 程序。公開使用請一律按照上面的 `python server.py` 流程操作。

## 更新、備份與解除安裝

### 更新

1. 更新前先備份你自己修改過的檔案（見下）。
2. 若是 Git clone，先看工作區狀態：

   ```powershell
   git status
   ```

3. 確認沒有未提交的修改後再拉取更新；如果有自己的修改，請先另外備份，不要直接覆蓋或捨棄。

### 備份

- 你自行修改過的程式碼、設定與腳本請另外保存。
- 歷史紀錄與偏好設定存放在瀏覽器的 `localStorage`（例如 `ui.gallery`、`ui.settings`、`sel`、`combos`、`adult`）。清除瀏覽器資料會讓歷史紀錄消失，請事先留意。

### 解除安裝

1. 停止你自己啟動的 Sid-simple-ui 程序（在終端機按 `Ctrl + C` 或關閉該終端機）。
2. 刪除本 Repo 的資料夾即可。
3. **不要刪除你的 ComfyUI、模型、輸出圖片或其他資料**；它們不在本 Repo 內。

## 常見錯誤

| 狀況 | 可能原因與處理 |
|---|---|
| 執行 `python` 顯示找不到指令 | Python 未安裝或未加入 PATH；可改用 `py server.py`，或重新安裝 Python 並勾選加入 PATH。 |
| Port 已被佔用 | 7860 被其他程式使用；改設 `SIMPLE_UI_PORT` 並開啟對應網址。 |
| 頁面顯示 ComfyUI 沒連線 | ComfyUI 沒啟動，或 `COMFY_URL` 指向錯誤 Port；先啟動 ComfyUI，或確認 `COMFY_URL`。 |
| 啟動時出現 `COMFY_URL 設定錯誤` | 檢查是否寫成 LAN IP、少了 Port、或含額外路徑；格式請見上方範例。 |
| 可以按生成，但不能刪圖 / 開資料夾 | 尚未設定有效的 `COMFY_OUTPUT_DIR`，請設定後重啟服務。 |
| 反推標籤顯示尚未安裝 | 公開 Repo 不含 WD14 資源；基本生圖不受影響，可忽略此功能。 |

## 開發驗證

```powershell
node --check app.js
node --check tags.js
node --check dict.js
python -m py_compile server.py
```

瀏覽器：開 `http://127.0.0.1:7860/?v=N`（N 遞增以避快取），Console 0 錯誤、`document.documentElement.scrollHeight === innerHeight`。

## 設計約束（請保留）

1. 前端不得直連 `ws://127.0.0.1:8188`，進度一律走 `/ws` 隧道（`server.py` 轉發，改寫 Host/Origin）。
2. `server.py` 靜態檔只允許白名單副檔名；新增資產類型要同步更新。
3. `#pos` 用 `ui.extra` localStorage key，不讀舊的 `pos` key。
4. 標籤選取沿用 `sel` / `combos` / `adult`，欄位格式不可改。
5. 一屏不捲動：`html/body` 不該出現捲軸。
6. hover 不可改變元素尺寸。
7. 只用系統字（微軟正黑體），不引入外部字型/CDN。
8. 歷史圖片存在性一律問 `/api/check`，不可用檔案系統猜。

## 授權

Fair AI Public License 1.0-SD（見 `LICENSE`）。

## 致謝

- ComfyUI
- NovelAI-tag-generator（標籤格式參考）

## 個人筆記

這是我的私人寶藏公開分享，**不接受 PR**，但 issue 歡迎討論、問問題、分享你的改法。
如果你 fork 去做自己的版本，很開心——記得遵守授權條款。
