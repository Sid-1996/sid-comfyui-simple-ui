# LoRA 標題列常駐 Civitai 快捷入口 — 交付報告

## 1. 修改檔案及各自目的

| 檔案 | 目的 |
|---|---|
| `index.html` | 在 `.lora-head` 內新增常駐「尋找 LoRA ↗」外部連結，並把連結與原有「選擇」按鈕包進 `.lora-head-actions`，維持原本「左標題、右控制」的兩端對齊。 |
| `app.css` | 新增 `.lora-head-actions` 與 `.lora-find-link` 樣式，沿用既有 CSS 變數，連結低調、不換行、不撐高、Hover 只改顏色與底線。 |
| `devtools/lora_ui_test.mjs` | 擴充既有 E2E：驗證常駐連結属性、原有「選擇」按鈕、空狀態雙入口、錯誤狀態只有常駐入口、1920×1080 標題列版面。 |
| `devtools/reports/lora-civitai-shortcut.md` | 本報告（新增）。 |

**未修改**：`app.js`、`server.py`、Workflow、localStorage 格式、LoRA API、其他按鈕或報告。既有 15 份 untracked `devtools/reports/*.md` 完全未動。

---

## 2. 實際 UI 修改內容

`index.html`（`.lora-head`，原 L194–197）：

```diff
 <div class="lora-head">
   <span class="field-label">角色 LoRA <b id="loraCount" class="lora-count">0</b></span>
-  <button id="btnLoraPick" class="btn btn-ghost btn-sm" type="button">選擇</button>
+  <div class="lora-head-actions">
+    <a class="lora-find-link" href="https://civitai.com/models?types=LORA" target="_blank" rel="noopener noreferrer">尋找 LoRA <span class="lora-ext-mark" aria-hidden="true">↗</span></a>
+    <button id="btnLoraPick" class="btn btn-ghost btn-sm" type="button">選擇</button>
+  </div>
 </div>
```

`app.css`（`.lora-count` 之後、`.lora-list` 之前）：

```css
.lora-head-actions {
  display: flex; align-items: center; gap: 6px;
}
.lora-find-link {
  display: inline-flex; align-items: center; gap: 4px;
  height: 30px; padding: 0 2px;
  white-space: nowrap; text-decoration: none;
  color: var(--muted); font-size: 11.5px;
}
.lora-find-link:hover { color: var(--text); text-decoration: underline; }
```

設計說明：

- 常駐連結是靜態 HTML，不依賴 LoRA 清單狀態，也不由 `app.js` 重建（`renderLoraSelected()` 只改 `#loraCount.textContent` 與 `#loraList.innerHTML`）。
- `href` 固定 `https://civitai.com/models?types=LORA`；`target="_blank"`；`rel="noopener noreferrer"`。
- 連結用 `var(--muted)`、11.5px，比 `.btn-ghost` 的「選擇」低調；`↗` 沿用空狀態既有寫法。
- Hover 只改 `color` 與 `text-decoration`，不改 padding／字級／transform／位置。
- Modal 空狀態原有的 `.lora-ext-link`（「前往 Civitai 挑選 LoRA」）完全保留。

---

## 3. 測試項目與真實結果

### 環境

隔離架構（未連接正式服務）：`devtools/lora_mock_comfy.py --port 18188 --capture <temp>/capture.jsonl --prompt-delay 3` + 獨立 `server.py`（`COMFY_URL=http://127.0.0.1:18188`、`SIMPLE_UI_PORT=7861`、獨立 LOG_DIR / WD14_TMP）+ headless Chrome CDP。測試後已終止 7861/18188 並刪除暫存目錄。

### 新增／強化的 E2E 項目（全部實際通過）

1. 標題列常駐連結存在於 `.lora-head`，文字含「尋找 LoRA」。
2. `href === "https://civitai.com/models?types=LORA"`（完全比對）。
3. `target === "_blank"`。
4. `rel` 同時包含 `noopener` 與 `noreferrer`。
5. 點擊原有 `#btnLoraPick` 仍可開啟 `#loraModal`。
6. API 正常回 `loras: []` 時，Modal 既有入口仍存在，整頁共有 **2 個** Civitai 入口。
7. 缺 `loras` 欄位、`loras:{}`、HTML fallback、invalid JSON 四種錯誤狀態：常駐連結仍存在，但 `#loraPickList a` 不存在（頁面只有 1 個入口），不會把錯誤偽裝成正常空狀態。
8. `COMFY_OFFLINE`（503）與其他 JSON 錯誤（502）：同上，常駐連結存在、空狀態入口不出現。
9. 1920×1080、100% DPI iframe 量測：`.lora-head.scrollWidth <= clientWidth`、常駐連結與「選擇」同列且都在標題列內、連結與按鈕高度一致、標題列高度 ≤ 32px；整頁不水平／垂直捲動、右欄不撐高不裁切。

### 實際命令與結果

```text
node --check app.js                            → 通過
node --check devtools/lora_ui_test.mjs          → 通過
node --check tags.js / dict.js / tag_categories.js → 通過
python -m py_compile server.py                  → 通過
git diff --check                                → 無輸出
node devtools/lora_ui_test.mjs --ui http://127.0.0.1:7861 --mock http://127.0.0.1:18188 --capture <temp>/capture.jsonl
                                               → 39 UI tests passed（原 37 + 新增 2）
node devtools/lora_core_test.mjs                → 17 tests passed（回歸）
python devtools/lora_api_test.py                → 15 tests passed（回歸）
node devtools/category_apply_ui_test.mjs        → 22 UI tests passed（回歸）
```

E2E 輸出包含新增項目：「標題列常駐入口：文字／URL／target／rel 都正確」、「原有「選擇」按鈕仍可正常開啟 LoRA Modal」、「API 正常空清單：Modal 既有入口 + 標題列常駐入口（共 2 個），不顯示舊版推論」、「版面 1920×1080（2 個 LoRA）：標題列無溢出、不換行、不撐高，右欄與整頁都不捲動」。

---

## 4. 未執行測試及原因

- 真實 LoRA 生圖：不需要，也禁止正式生圖；本修改純靜態 UI。
- 正式 7860／8188 服務連線測試：依任務限制不得連接正式服務；E2E 全走 mock。
- Civitai 外部網站可用性／內容：不測試外部網路、不驗證平台內容或條款。
- 真實使用者 Chrome（browse MCP）：本輪延續既有 headless Chrome CDP 架構，未額外連接使用者瀏覽器。
- GPU／高負載測試：不涉及，且被禁止。

---

## 5. Git Branch、HEAD、工作區狀態

- Repository：`C:\ComfyUI\simple_ui`
- Branch：`main`（開始與結束相同）
- HEAD：`24f2b72066f3edd235f0e0bc91df485e5f48f237`（與已知基準相符，未變）
- Remote：`origin` → `https://github.com/Sid-1996/sid-comfyui-simple-ui.git`
- 結束時 tracked 修改：`app.css`、`index.html`、`devtools/lora_ui_test.mjs`（本任務）；untracked 新增：本報告；15 份既有 untracked reports 保留原狀。
- 無 commit／push／stage／reset／restore／stash／checkout／clean。

---

## 6. 正式服務是否受到影響

- 未啟動、停止或重啟任何正式程序：7860 simple_ui（PID 2668）、8188 ComfyUI（PID 15468，本任務開始前已在上線）、WD14 Worker 皆未觸碰。
- 未修改模型、Workflow、輸出圖片、使用者設定或正式資料；未正式生圖、未下載模型、未安裝依賴。
- 測試用 18188 mock 與 7861 隔離實例已終止，暫存檔已清除。
- 7860 行程仍是舊程式（磁碟上的 `server.py` 已更新但行程未重啟）；本輪不宣稱正式環境已生效，也不代為重啟。

---

## 7. 尚存問題或風險

- 常駐連結僅是外部網站入口，不驗證 Civitai 可用性、內容分級或條款，也不提供模型預覽／搜尋／下載。
- 右欄在極窄視窗（≤1100px）會轉堆疊版面，該情境由既有 RWD 規則處理；本輪量測聚焦 1920×1080 / 100% DPI。
- `↗` 為文字箭頭（沿用空狀態既有寫法），非 inline SVG；專案規範偏好功能圖示用 SVG，但為維持一致性與最小修改範圍，本輪未更改。
- 無 JS 事件或狀態依賴，因此不存在與 LoRA 清單／localStorage 不同步的風險。
