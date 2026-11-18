# devtools/ — 驗收工具與紀錄

個人工具用的驗收區，不影響正式應用（`C:\ComfyUI\simple_ui` 根目錄的檔案才是程式碼）。

## 腳本（可重複執行）

全部用 CDP 驅動本機 Chrome，不需要 npm 安裝任何套件（Node 24 內建 WebSocket）。
每支腳本都用**獨立的臨時 Chrome profile**，不會寫入你正式瀏覽器的 localStorage。

| 檔案 | 用途 | 執行 |
|---|---|---|
| `cdp_lib.mjs` | 共用 CDP 客戶端 + 版面量測函式 | （被下列腳本 import） |
| `phase1_capture.mjs` | 1920×1080 截圖 + 三欄版面量測 | `node devtools/phase1_capture.mjs` |
| `phase1_generate.mjs` | 實跑一次生成，驗證「生成中／生成結果／燈箱」 | `node devtools/phase1_generate.mjs` |
| `phase11_tagname_test.mjs` | Phase 1.1 回歸測試（10 項，涵蓋 2 次真實生成） | `node devtools/phase11_tagname_test.mjs` |

前置條件：`server.py`（7860）與 ComfyUI（8188）都要開著。

> 腳本網址上的 `?v=N` 只是快取保險。server.py 對 `.html/.css/.js/.json` 一律送
> `Cache-Control: no-store`，所以重新載入就會拿到最新檔案。

## 紀錄

`phase1_final_review/` 下的 `_*.json` 是驗收量測原始資料（純文字、會進版控）：

- `_measurements.json` — Phase 1 三種狀態的 1920×1080 版面數值
- `_gen_report.json` — 生成流程驗收（分類數量、進度、燈箱）
- `_phase11_test_report.json` — Phase 1.1 的 10 項測試結果

## 保留在磁碟、不進版控

- `phase1_final_review/*.png` — 驗收截圖，由 `phase1_capture.mjs` 重新產生
- `phase1_ui_review.pdf` — Phase 1 視覺驗收 PDF
- `uiux_prototype/` — Phase 0.5 UI/UX 原型，已被正式版取代

（規則寫在根目錄 `.gitignore`；要納入版控就把對應行刪掉。）
