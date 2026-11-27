// lora_personal_key_ui_test.mjs — 階段 A 前端原始碼檢查（不開瀏覽器、不碰正式服務）
//
// 只做靜態檢查：Key 輸入框型態、清除輸入、同源 header、不得寫入
// localStorage/sessionStorage、不得出現在 URL 或 query token。
// 執行：node devtools/lora_personal_key_ui_test.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "app.css"), "utf8");

let passed = 0;
function check(cond, msg) {
  if (!cond) throw new Error(msg);
  passed++;
  console.log("  PASS " + msg);
}
function section(src, start, end) {
  const a = src.indexOf(start);
  const b = a >= 0 ? src.indexOf(end, a) : -1;
  if (a < 0 || b < 0) throw new Error("找不到程式區段：" + start);
  return src.slice(a, b);
}

const keyHtml = section(html, '<div id="cvKeyBar"', '<div class="cv-search-row">');
const keyJs = section(app, "/* ── Civitai Personal API Key", "function cvBadge(cls)");

check(/id="cvKeyInput"[^>]*type="password"/.test(keyHtml), "Key 輸入框為 password 型態");
check(/id="cvKeyTest"/.test(keyHtml) && /id="cvKeyRemove"/.test(keyHtml), "測試與移除按鈕存在");
check(/id="cvKeyResult"[^>]*aria-live="polite"/.test(keyHtml), "測試結果有 aria-live");
check(/DPAPI/.test(keyHtml) && /OAuth/.test(keyHtml) && /Buzz/.test(keyHtml), "風險提示包含 DPAPI／OAuth／Buzz");

check(keyJs.includes('"X-SimpleUI": "1"'), "Key POST 附 X-SimpleUI");
check(keyJs.includes('"/api/civitai/key/status"'), "狀態走 GET /api/civitai/key/status");
check(keyJs.includes('"/api/civitai/key"') && keyJs.includes('"/api/civitai/key/test"') &&
      keyJs.includes('"/api/civitai/key/remove"'), "三個 Key 端點都存在");
check(!/(localStorage|sessionStorage)/.test(keyJs), "Key 邏輯不碰 localStorage/sessionStorage");
check(!/token=/.test(keyJs), "Key 邏輯不使用 query token");
check((keyJs.match(/input\.value\s*=\s*""/g) || []).length >= 2,
      "儲存與取消後清空輸入框");
check(app.includes("CV.key.formOpen = false;") && app.includes("cvKeyRefresh();"),
      "Modal 關閉重開時重取狀態並收起表單");

const whole = app + html;
check(!/\/api\/civitai\/key[^"']*token=/.test(whole), "Key URL 不含 token 參數");
check(/\.cv-key-(bar|status|form|result|note)/.test(css), "使用 .cv-* CSS 命名");
console.log(passed + " UI static checks passed");
