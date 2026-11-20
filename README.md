# Sid 的 ComfyUI 簡易生圖介面

> 一個給「不想碰 ComfyUI 節點」的人用的單頁生圖前端。
> 我自己日常在用，順手整理成公開寶藏，歡迎參考、自用、改造。

## 這是什麼

把 ComfyUI 包進一層極簡 UI：左邊標籤庫、中間舞台、右邊設定，只有一顆「生成」鍵。
非技術使用者也能在 20 秒內出第一張圖；進階參數藏在彈窗裡，平常不用碰。

- 單檔前端（HTML/CSS/JS），無 build step、無外部依賴
- 中文標籤 ↔ Danbooru 英文自動對照（`dict.js`）
- 生成進度、取消、歷史縮圖、燈箱、快捷鍵
- 18+ 標籤預設隱藏，需手動開啟
- 標籤使用會自動學習，下次更快
- 一鍵 WD14 圖片反推：上傳圖片自動辨識標籤並加入選取（需另裝工具，見根目錄 AGENTS.md）

## 需求

- Windows 10/11（腳本為 PowerShell；其他 OS 請自行調整）
- [ComfyUI Windows portable](https://github.com/comfyanonymous/ComfyUI) 已安裝
- 模型：`WAI-Nsfw-Illustrious-17.safetensors`（或其他 Illustrious 系列，需自行改 workflow）
- Python：ComfyUI 內建 embedded python 跑 `server.py`；桌面控制台需系統 Python 3.13（含 tkinter），embedded 沒有 tkinter

## 怎麼跑

1. 雙擊桌面 `生圖控制台.lnk`，在視窗按「開始生圖 / 關閉生圖 / 重新啟動 / 開啟介面」。
2. 或開發時：`python server.py`（假設 ComfyUI 已在 8188）。
3. 查狀態：`powershell -NoProfile -File ui_control.ps1 -Action status`。

圖片輸出預設 `D:\ComfyUI_output`。

## 開發驗證

```powershell
node --check app.js
node --check tags.js
node --check dict.js
python -m py_compile server.py
python -m py_compile ui_panel.pyw
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

## 路徑說明

`ui_panel.pyw`、`ui_control.ps1` 與 `server.py` 內含本機路徑（`C:\ComfyUI\...`、`D:\ComfyUI_output`），請依你的環境修改。這是個人使用導向的專案，未做跨平台/跨路徑抽象。

## 授權

Fair AI Public License 1.0-SD（見 `LICENSE`）。

## 致謝

- ComfyUI
- NovelAI-tag-generator（標籤格式參考）

## 個人筆記

這是我的私人寶藏公開分享，**不接受 PR**，但 issue 歡迎討論、問問題、分享你的改法。
如果你 fork 去做自己的版本，很開心——記得遵守授權條款。
