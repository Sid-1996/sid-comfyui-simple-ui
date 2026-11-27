// lora_trigger_words_ui_test.mjs — Phase 2 UI 原始碼契約檢查
// 不開瀏覽器、不連正式服務：直接檢查 app.js / server.py / app.css 的關鍵行為。
// 執行：node devtools/lora_trigger_words_ui_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "app.css"), "utf8");
const srv = fs.readFileSync(path.join(ROOT, "server.py"), "utf8");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS " + name); }
  catch (e) { console.error("  FAIL " + name + "\n    " + (e && e.message)); process.exitCode = 1; }
}
const between = (src, start, end) => {
  const a = src.indexOf(start);
  const b = end ? src.indexOf(end, a + 1) : src.length;
  assert.ok(a >= 0 && b > a, "找不到區段：" + start);
  return src.slice(a, b);
};

test("1 面板分區：個人詞、檔案建議、Civitai 建議各自獨立", () => {
  assert.match(app, /我的觸發詞（只有這裡的詞會自動加入提示詞）/);
  assert.match(app, /從模型檔案讀取的建議詞/);
  assert.match(app, /Civitai 作者提供的建議詞/);
  assert.match(app, /來源：Civitai.*已選版本：/);
  assert.match(app, /這是選用功能，不知道怎麼設定可以直接略過，不影響生圖/);
  assert.match(app, /跟你下載的檔案相同的版本/);
  assert.match(app, /網址長這樣：https:\/\/civitai\.com\/models\//);
  assert.match(app, /取消版本連結/);
  assert.match(app, /不會刪除你自己的觸發詞，也不影響生圖/);
  assert.match(app, /貼上版本頁面網址（也可以只貼數字）/);
  assert.match(app, /全部加入我的觸發詞/);
  assert.match(app, /這個模型不需要觸發詞/);
  assert.doesNotMatch(app, /我的 Trigger Words|本機 metadata 建議|只有這些會放進 Prompt/);
});

test("2 版本連結操作：ID／網址輸入、連結、解除、錯誤提示", () => {
  assert.match(app, /id="loraCvId"/);
  assert.match(app, /data-lora-act="cv-link"/);
  assert.match(app, /data-lora-act="cv-unlink"/);
  const fn = between(app, "function loraParseCvId", "function loraAddAuthorWords");
  assert.ok(fn.includes("modelVersionId="), "支援版本網址解析");
  assert.ok(fn.includes("^(\\d+)$"), "支援純數字 ID");
  assert.match(fn, /2147483647/);
  assert.match(app, /請貼上模型頁面的網址，或只貼版本頁面上那一串數字/);
});

test("3 作者建議加入：容量與回報數量一致，整組/逐詞/全部都走同一函式", () => {
  assert.match(app, /data-lora-act="add-group"/);
  assert.match(app, /data-lora-act="add-word"/);
  assert.match(app, /data-lora-act="use-meta"/, "保留 Phase 1 的 use-meta 入口");
  const fn = between(app, "function loraAddAuthorWords", "function loraLinkCv");
  assert.match(fn, /loraAddPlan\(it\.triggers, words\)/);
  assert.match(fn, /plan\.added/);
  assert.match(fn, /plan\.skipped/);
  assert.match(fn, /noTriggerNeeded: false/);
  assert.doesNotMatch(fn, /fresh\.length\} 個/, "不可回報未受上限截斷的數量");
  const plan = between(app, "function loraAddPlan", "// ── 作者建議");
  assert.match(plan, /loraCleanTriggerList\(words\)/, "作者建議須完整清理，不可先被 40 截斷");
  assert.match(plan, /LORA_MAX_TRIGGERS - cur\.length/);
  assert.match(plan, /next\.length - cur\.length/);
  const clean = between(app, "function loraCleanTriggerList", "function loraCleanTriggers");
  assert.doesNotMatch(clean, /slice\(0, LORA_MAX_TRIGGERS\)/);
  const capped = between(app, "function loraCleanTriggers", "// 計算「加入作者建議");
  assert.match(capped, /loraCleanTriggerList\(list\)\.slice\(0, LORA_MAX_TRIGGERS\)/);
});

test("4 取得 Civitai 建議：匿名、不讀 API Key、不清既有建議", () => {
  const fn = between(app, "function loadCivMeta", "function loraParseCvId");
  assert.match(fn, /\/api\/civitai\/version\?id=/);
  assert.match(fn, /cache: "no-store"/);
  assert.doesNotMatch(fn, /read_api_key|Authorization|Bearer|api\/civitai\/key/);
  assert.match(fn, /authorSuggestions\.civitai\.versionId !== vid/, "舊版本的回應不可覆蓋新版本");
  const catches = fn.match(/\.catch\(e => \{[\s\S]*?\}\)/g) || [];
  assert.equal(catches.length, 1, "loadCivMeta 應只有一個 catch");
  assert.match(catches[0], /authorSuggestions\.civitai\.versionId !== vid/, "過期失敗回應也必須被丟棄");
  assert.match(fn, /cur\.authorSuggestions\.local/, "更新 Civitai 建議不可清掉本機建議");
  assert.doesNotMatch(fn, /triggers:/, "update 不得碰個人 triggers");
});

test("5 noTriggerNeeded 狀態規則", () => {
  assert.match(app, /data-lora-act="no-trigger"/);
  assert.match(app, /noTriggerNeeded: false/);
  assert.match(app, /noTriggerNeeded: !it\.noTriggerNeeded/);
  const del = between(app, "if (act === \"del-trig\")", "} else if (act === \"edit-trig\")");
  assert.doesNotMatch(del, /noTriggerNeeded/, "刪除所有個人詞不可自動設為不需要");
  const auto = between(app, "function loraOnTriggersChange", "function loraOnTriggersKey");
  assert.doesNotMatch(auto, /noTriggerNeeded/, "autoTrigger 開關不得改 noTriggerNeeded");
});

test("6 歷史：還原個人設定，但不採信歷史的 authorSuggestions", () => {
  // 歷史還原先建立純資料 plan；作者建議只能沿用目前 LoRA 的 metadata，不能讀歷史快照。
  const fn = between(app, "function buildReusePlan", "function buildPositiveReusePlan");
  assert.match(fn, /authorSuggestions: prev \? prev\.authorSuggestions : null/);
  assert.match(fn, /noTriggerNeeded: l && l\.noTriggerNeeded/);
  assert.doesNotMatch(fn, /l\.authorSuggestions/);
  const snap = between(app, "function loraSnapshot", "function loraTokensFromSnapshot");
  assert.match(snap, /noTriggerNeeded:/);
  assert.doesNotMatch(snap, /authorSuggestions/);
});

test("7 生成前提醒非阻塞且不改 Prompt", () => {
  const fn = between(app, "const loraReminded = new Set()", "async function generate()");
  assert.match(fn, /loraReminded/);
  assert.match(fn, /toast\(/);
  assert.doesNotMatch(fn, /confirm\(|alert\(|throw new Error/);
  const gen = between(app, "if (!(await verifySelectedLoras()))", "// ② 生成前同步標籤狀態");
  assert.match(gen, /loraRemindBeforeGenerate\(\)/);
});

test("8 後端路由：匿名版本 metadata，限制與快取", () => {
  assert.match(srv, /if self\.path\.split\("\?", 1\)\[0\] == "\/api\/civitai\/version"/);
  const fn = between(srv, "def civitai_version_meta", "def civitai_search");
  assert.match(fn, /_civitai_get\("\/model-versions\/%d" % version_id\)/);
  assert.doesNotMatch(fn, /auth=True|read_api_key|Authorization/);
  assert.match(fn, /_cache_get|_cache_set/);
  const norm = between(srv, "def _civitai_version_groups", "def civitai_version_meta");
  assert.match(norm, /trainedWords 不是陣列/);
});

test("9 CSS：新區塊沿用設計變數且限制高度", () => {
  for (const cls of ["lora-section", "lora-group", "lora-word", "lora-cv-link", "lora-status"]) {
    assert.match(css, new RegExp("\\." + cls + "\\s*\\{"));
  }
  assert.match(css, /\.lora-trig-panel \{ max-height: 64vh; overflow: auto; \}/);
});

test("10 Civitai UX：保留輸入、失敗重試、避免重複請求、保留舊資料、免 Key", () => {
  const link = between(app, "function loraLinkCv", "function loraOnPickClick");
  assert.match(link, /cvInputs\[it\.name\]/, "重新繪製後要保留網址輸入");
  assert.match(link, /state === "loading"\) return/, "讀取中不可再送出請求");
  assert.match(link, /const id = parsed \|\| \(!raw \? prev\.versionId : null\)/, "空白輸入才用已選版本重試；錯誤輸入要提示");
  assert.match(link, /groups: same \? prev\.groups : \[\]/, "同版本更新不可先清空舊建議");
  assert.match(link, /fingerprint: same \? prev\.fingerprint : null/);
  const load = between(app, "function loadCivMeta", "function loraParseCvId");
  assert.match(load, /hadData = it\.authorSuggestions\.civitai\.groups\.length > 0/);
  assert.match(load, /state: "loading", hadData \};[\s\S]*?renderLoraTriggers\(true\)/, "讀取中要立刻反映在畫面上");
  assert.match(load, /state: "error", error: cvTranslate\(e\), hadData/);
  assert.match(load, /authorSuggestions\.civitai\.versionId !== vid/, "過期回應仍須被丟棄");
  assert.doesNotMatch(load, /read_api_key|Authorization|Bearer|api\/civitai\/key/);
  const unlink = between(app, "} else if (act === \"cv-unlink\")", "function loraOnTriggersChange");
  assert.match(unlink, /delete cvInputs\[it\.name\]/);
  assert.match(unlink, /你自己的觸發詞都還在/);
  assert.doesNotMatch(unlink, /triggers:/, "取消連結不可動個人觸發詞");
  assert.match(unlink, /local: it\.authorSuggestions\.local/, "本機建議須保留");
});

console.log(passed + " tests passed" + (process.exitCode ? "（有失敗）" : ""));
