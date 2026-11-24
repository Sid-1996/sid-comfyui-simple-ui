// category_apply_ui_test.mjs — 分類套用 UI 層的無瀏覽器模擬測試
// 用極小 DOM stub 執行 app.js 的 planner + UI 區塊，驗證渲染、事件、
// XSS 轉義、單次提交與不碰 neg／設定。執行：node devtools/category_apply_ui_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const tc = fs.readFileSync(path.join(ROOT, "tag_categories.js"), "utf8");
const start = app.indexOf("/* ==== CATEGORY_APPLY_PLANNER_START");
const end = app.indexOf("/* ── 刪圖", start);
assert.ok(start >= 0 && end > start, "找不到分類套用程式區塊");
const src = app.slice(start, end);

const win = { TagCategories: null, Tags: null };
new Function("window", tc)(win);

let currentSel = [];
let restored = null;
const calls = { restore: 0, toast: [], openModal: 0, closeModal: 0, closeLightbox: 0, reuse: 0, warn: 0 };
const store = {};
const settingsStub = {};
const els = {
  modalBody: { innerHTML: "", scrollTop: 0, querySelector: () => null },
  pos: { value: "目前補充" },
  neg: { value: "worst quality" }
};
const $ = id => els[id] || null;
const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); }
};
win.Tags = {
  snapshot: () => currentSel,
  tagZh: () => "",
  isAdult: () => false,
  restore: sel => { calls.restore++; restored = sel; }
};
const api = new Function("$", "esc", "window", "toast", "openModal", "closeModal",
  "closeLightbox", "reusePrompt", "updateWarn", "localStorage", "S",
  src + "\nreturn { CA, caOpen, caOnClick, caOnChange, caOnInput, caRender, caCurrentPlan };")(
  $, esc, win,
  (m, k) => calls.toast.push([m, k]),
  title => { calls.openModal++; modalTitle = String(title || ""); els.modalBody.innerHTML = ""; },
  () => { calls.closeModal++; },
  () => { calls.closeLightbox++; },
  () => { calls.reuse++; },
  () => { calls.warn++; },
  localStorage,
  { settings: settingsStub }
);

let modalTitle = "";
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS " + name); }
  catch (e) { console.error("  FAIL " + name + "\n    " + (e && e.stack || e)); process.exitCode = 1; }
}
const click = data => api.caOnClick({ target: { closest: () => ({ dataset: data }) } });
const html = () => els.modalBody.innerHTML;

test("19 預覽視窗結構：方向說明、8 快捷、10 分類、兩欄預覽", () => {
  currentSel = [{ t: "hatsune miku", w: 1 }];
  api.caOpen({ sel: [{ t: "2b (nier:automata)", w: 1 }, { t: "classroom", w: 1 }], extra: "歷史文字" });
  assert.equal(calls.openModal, 1);
  assert.ok(html().includes("以這張歷史圖片為基底"), "缺少方向說明");
  assert.equal((html().match(/data-ca="preset"/g) || []).length, 8);
  assert.equal((html().match(/data-ca="cat"/g) || []).length, 10);
  assert.ok(html().includes("歷史圖片中將被替換的標籤") && html().includes("將從目前提示詞帶入的標籤"));
  assert.ok(html().includes("補充描述"));
});

test("20 只換角色預覽：專名預勾、通用特徵⚠未勾、無提交", () => {
  const before = calls.restore;
  click({ ca: "preset", preset: "role" });
  assert.ok(api.CA.cats.has("character"));
  assert.ok(api.CA.role === true);
  assert.ok(html().includes("⚠"), "需顯示人工確認標記");
  assert.ok(html().includes("角色專名（含作品名，預先勾選，可取消）"));
  assert.equal(calls.restore, before, "預覽不得提交");
});

test("21 逐項取消與補充描述合併，確認只提交一次", () => {
  click({ ca: "preset", preset: "role" });
  const before = calls.restore;
  // 取消一個候選：不應提交
  const first = html().match(/data-ca="item" data-id="([^"]+)"/);
  assert.ok(first, "要有可取消的候選");
  click({ ca: "item", id: first[1] });
  click({ ca: "item", id: "current:hatsune miku" }); // 保留一個實際變更
  assert.equal(calls.restore, before, "取消候選不得提交");
  // 切到合併模式並輸入
  api.caOnChange({ target: { dataset: { ca: "extra", mode: "merge" } } });
  assert.ok(html().includes('id="caExtraText"'), "合併模式應出現文字框");
  api.caOnInput({ target: { id: "caExtraText", value: "目前補充, 新文字" } });
  assert.equal(api.CA.extraText, "目前補充, 新文字");
  // 確認
  click({ ca: "apply" });
  assert.equal(calls.restore, before + 1, "必須恰好提交一次");
  assert.ok(restored && Array.isArray(restored));
  assert.equal(store["ui.extra"], "目前補充, 新文字", "文字框所見即所得");
  assert.equal(els.neg.value, "worst quality", "負面提示詞不得變動");
  assert.deepEqual(Object.keys(store), ["ui.extra"], "不得寫入其他 localStorage key");
});

test("22 保留補充描述（預設）時完全不寫 localStorage", () => {
  for (const k of Object.keys(store)) delete store[k];
  currentSel = [{ t: "sitting", w: 1 }];
  els.pos.value = "目前補充";
  api.caOpen({ sel: [{ t: "standing", w: 1 }], extra: "歷史文字" });
  click({ ca: "preset", preset: "pose" });
  const before = calls.restore;
  click({ ca: "apply" });
  assert.equal(calls.restore, before + 1);
  assert.deepEqual(Object.keys(store), [], "keep 模式不寫 ui.extra");
  assert.equal(els.pos.value, "目前補充");
});

test("23 XSS：歷史文字與標籤皆被跳脫", () => {
  const evil = '<img src=x onerror="alert(1)">';
  currentSel = [];
  api.caOpen({ sel: [{ t: evil, w: 1 }], extra: evil });
  assert.ok(!html().includes("<img"), "動態內容不得原樣進 HTML");
  assert.ok(html().includes("&lt;img"));
});

test("24 分類資料缺失：白話提示，停用新功能但保留完整套用", () => {
  const saved = win.TagCategories;
  const before = calls.openModal;
  win.TagCategories = null;
  try {
    api.caOpen({ sel: [], extra: "" });
  } finally { win.TagCategories = saved; }
  assert.equal(calls.openModal, before, "不應開啟預覽");
  assert.ok(calls.toast.some(x => String(x[0]).includes("分類資料沒有載入")), "要有白話提示");
  assert.ok(calls.toast.some(x => String(x[0]).includes("用同提示詞")), "要引導使用完整套用");
});

// ==== 審查修正回歸：body 候選與角色模式狀態 ====
const BODY_WORK = "oripathy lesion (arknights)";
const roleHistory = () => [
  { t: "2b (nier:automata)", w: 1 }, { t: "long hair", w: 1 },
  { t: "hatsune miku (cosplay)", w: 1 }, { t: BODY_WORK, w: 1 },
  { t: "smile", w: 1 }, { t: "classroom", w: 1 }
];

test("25 角色快捷啟用，body／服裝／表情跨分類候選都出現", () => {
  currentSel = [{ t: "hatsune miku", w: 1 }];
  api.caOpen({ sel: roleHistory(), extra: "" });
  click({ ca: "preset", preset: "role" });
  assert.equal(api.CA.role, true);
  for (const t of ["hatsune miku (cosplay)", BODY_WORK, "smile"]) {
    assert.ok(html().includes(t), "缺少候選：" + t);
  }
  assert.ok(html().includes("與作品／角色相關的人物設計"), "缺少 cross-body 說明");
});

test("26 取消 character 後跨分類候選消失，CA.role 同步關閉", () => {
  currentSel = [{ t: "hatsune miku", w: 1 }];
  api.caOpen({ sel: roleHistory(), extra: "" });
  click({ ca: "preset", preset: "role" });
  click({ ca: "cat", cat: "character" });
  assert.equal(api.CA.role, false);
  assert.ok(!api.CA.cats.has("character"));
  for (const t of ["hatsune miku (cosplay)", BODY_WORK, "smile"]) {
    assert.ok(!html().includes(t), "不應殘留跨分類候選：" + t);
  }
});

test("27 取消 character 後單選 expression，恢復一般預設勾選", () => {
  currentSel = [{ t: "angry", w: 1 }];
  api.caOpen({ sel: roleHistory(), extra: "" });
  click({ ca: "preset", preset: "role" });
  click({ ca: "cat", cat: "character" });
  click({ ca: "cat", cat: "expression" });
  assert.equal(api.CA.role, false);
  assert.ok(/class="rev-tag on"[^>]*data-id="history:smile"/.test(html()),
    "expression 候選應恢復預設勾選");
});

test("28 角色模式下加 background，character 仍保持角色分層", () => {
  currentSel = [{ t: "hatsune miku", w: 1 }];
  api.caOpen({ sel: roleHistory(), extra: "" });
  click({ ca: "preset", preset: "role" });
  click({ ca: "cat", cat: "background" });
  assert.equal(api.CA.role, true);
  assert.ok(api.CA.cats.has("character") && api.CA.cats.has("background"));
  assert.ok(/class="rev-tag on"[^>]*data-id="history:2b \(nier:automata\)"/.test(html()));
  assert.ok(/class="rev-tag"[^>]*data-id="history:long hair"/.test(html()), "通用特徵仍不勾");
  assert.ok(html().includes("classroom"), "background 候選應出現");
});

test("29 再次點擊只換角色，狀態與預設完全恢復", () => {
  currentSel = [{ t: "hatsune miku", w: 1 }];
  api.caOpen({ sel: roleHistory(), extra: "" });
  click({ ca: "preset", preset: "role" });
  click({ ca: "cat", cat: "background" });
  click({ ca: "item", id: "history:long hair" }); // 手動覆寫
  click({ ca: "preset", preset: "role" });
  assert.equal(api.CA.role, true);
  assert.deepEqual([...api.CA.cats], ["character"]);
  assert.equal(api.CA.overrides.size, 0, "快捷應清掉手動覆寫");
  assert.ok(/class="rev-tag on"[^>]*data-id="history:2b \(nier:automata\)"/.test(html()));
  assert.ok(/class="rev-tag"[^>]*data-id="history:long hair"/.test(html()));
  assert.ok(!html().includes("classroom"), "背景分類應被清除");
});

// ==== 審查修正回歸：chip 即時勾選狀態以 CA.checked 為唯一來源 ====
const chipFor = id => {
  const h = html();
  const i = h.indexOf('data-id="' + id + '"');
  if (i < 0) return "";
  const start = h.lastIndexOf("<button", i);
  const end = h.indexOf(">", i);
  return start < 0 || end < 0 ? "" : h.slice(start, end + 1);
};
const assertChip = (id, on, label) => {
  assert.ok(api.CA.checked.has(id) === on, label + "：CA.checked 不同步");
  const chip = chipFor(id);
  assert.ok(chip, label + "：找不到 chip " + id);
  assert.equal(/class="rev-tag on(?: |")/.test(chip), on, label + "：on class 不同步");
  assert.ok(chip.includes('aria-pressed="' + on + '"'), label + "：aria-pressed 不同步");
};

test("30 歷史候選：未勾 → 勾選 → 取消，class 與 aria-pressed 即時同步", () => {
  currentSel = [{ t: "hatsune miku", w: 1 }];
  api.caOpen({ sel: [{ t: "2b (nier:automata)", w: 1 }, { t: "long hair", w: 1 }], extra: "" });
  click({ ca: "preset", preset: "role" });
  const id = "history:long hair";
  assertChip(id, false, "初始");
  click({ ca: "item", id });
  assertChip(id, true, "勾選後");
  click({ ca: "item", id });
  assertChip(id, false, "取消後");
});

test("31 目前候選：未勾 → 勾選 → 取消，class 與 aria-pressed 即時同步", () => {
  currentSel = [{ t: "hatsune miku", w: 1 }, { t: "short hair", w: 1 }];
  api.caOpen({ sel: [{ t: "2b (nier:automata)", w: 1 }], extra: "" });
  click({ ca: "preset", preset: "role" });
  const id = "current:hatsune miku";
  assertChip(id, false, "初始");
  click({ ca: "item", id });
  assertChip(id, true, "勾選後");
  click({ ca: "item", id });
  assertChip(id, false, "取消後");
});

test("32 切換分類與快捷後，新預設與手動覆寫都正確反映在畫面", () => {
  currentSel = [{ t: "hatsune miku", w: 1 }, { t: "bedroom", w: 1 }];
  api.caOpen({
    sel: [{ t: "2b (nier:automata)", w: 1 }, { t: "long hair", w: 1 }, { t: "classroom", w: 1 }],
    extra: ""
  });
  click({ ca: "preset", preset: "role" });
  assertChip("history:long hair", false, "角色模式預設");
  click({ ca: "item", id: "history:long hair" });           // 手動覆寫為勾選
  assertChip("history:long hair", true, "手動覆寫");
  click({ ca: "cat", cat: "background" });                  // 角色仍選取，加入背景
  assertChip("history:long hair", true, "換分類後覆寫仍保留");
  assertChip("history:classroom", true, "新分類用新預設");
  assertChip("current:bedroom", true, "新分類目前側");
  click({ ca: "preset", preset: "role" });                  // 快捷重置覆寫
  assertChip("history:long hair", false, "快捷重置後回到預設");
  assert.ok(!chipFor("history:classroom"), "背景候選應被清除");
});

test("33 畫面勾選數量與 planner 移除／加入數量一致", () => {
  currentSel = [{ t: "hatsune miku", w: 1 }, { t: "bedroom", w: 1 }];
  api.caOpen({ sel: [{ t: "2b (nier:automata)", w: 1 }, { t: "classroom", w: 1 }], extra: "" });
  click({ ca: "preset", preset: "role" });
  let stats = api.caCurrentPlan().stats;
  let onCount = (html().match(/class="rev-tag on(?: |")/g) || []).length;
  assert.equal(onCount, stats.removeCount + stats.addCount, "初始：畫面與 planner 不一致");
  assert.ok(html().includes("套用（移除 " + stats.removeCount + " · 加入 " + stats.addCount + "）"));
  click({ ca: "item", id: "current:hatsune miku" });
  stats = api.caCurrentPlan().stats;
  onCount = (html().match(/class="rev-tag on(?: |")/g) || []).length;
  assert.equal(onCount, stats.removeCount + stats.addCount, "勾選目前側後不一致");
  assertChip("current:hatsune miku", true, "目前側勾選");
  assert.ok(html().includes("套用（移除 " + stats.removeCount + " · 加入 " + stats.addCount + "）"));
  click({ ca: "item", id: "history:2b (nier:automata)" });
  stats = api.caCurrentPlan().stats;
  onCount = (html().match(/class="rev-tag on(?: |")/g) || []).length;
  assert.equal(onCount, stats.removeCount + stats.addCount, "取消歷史側後不一致");
  assertChip("history:2b (nier:automata)", false, "歷史側取消");
});

// ==== 審查修正回歸：補充描述可單獨套用 ====
const applyButton = () => {
  const h = html();
  const i = h.indexOf('id="caApply"');
  if (i < 0) return "";
  const start = h.lastIndexOf("<button", i);
  const end = h.indexOf("</button>", i);
  return start < 0 || end < 0 ? "" : h.slice(start, end + "</button>".length);
};
const setExtraMode = mode => api.caOnChange({ target: { dataset: { ca: "extra", mode } } });

test("34 只取代補充描述：按鈕啟用、文字框預填歷史、標籤與設定不變", () => {
  for (const k of Object.keys(store)) delete store[k];
  currentSel = [{ t: "sitting", w: 1 }];
  els.pos.value = "目前補充";
  const snapBefore = JSON.stringify(currentSel);
  const negBefore = els.neg.value;
  const settingsBefore = JSON.stringify(settingsStub);
  const restoreBefore = calls.restore;
  api.caOpen({ sel: [{ t: "standing", w: 1 }], extra: "歷史補充" });
  assert.ok(applyButton().includes("disabled"), "keep 且無標籤變更時應 disabled");
  setExtraMode("replace");
  assert.ok(html().includes('id="caExtraText"'), "應出現文字框");
  assert.ok(html().includes("歷史補充"), "文字框應預填歷史補充描述");
  assert.ok(!applyButton().includes("disabled"), "只改補充描述也應可套用");
  assert.ok(applyButton().includes("套用補充描述"), "按鈕文字應清楚");
  click({ ca: "apply" });
  assert.equal(els.pos.value, "歷史補充");
  assert.equal(store["ui.extra"], "歷史補充");
  assert.equal(calls.restore, restoreBefore, "Tags.snapshot 不變，不得呼叫 restore");
  assert.equal(JSON.stringify(currentSel), snapBefore);
  assert.equal(els.neg.value, negBefore);
  assert.equal(JSON.stringify(settingsStub), settingsBefore);
});

test("35 只合併補充描述：自訂文字最後輸入值被保存", () => {
  for (const k of Object.keys(store)) delete store[k];
  currentSel = [{ t: "sitting", w: 1 }];
  els.pos.value = "目前補充";
  const snapBefore = JSON.stringify(currentSel);
  const negBefore = els.neg.value;
  const settingsBefore = JSON.stringify(settingsStub);
  const restoreBefore = calls.restore;
  api.caOpen({ sel: [{ t: "standing", w: 1 }], extra: "歷史補充" });
  setExtraMode("merge");
  assert.ok(!applyButton().includes("disabled"));
  assert.ok(html().includes("目前補充, 歷史補充"), "合併預覽應包含兩邊文字");
  api.caOnInput({ target: { id: "caExtraText", value: "我改過的文字" } });
  click({ ca: "apply" });
  assert.equal(els.pos.value, "我改過的文字");
  assert.equal(store["ui.extra"], "我改過的文字");
  assert.equal(calls.restore, restoreBefore);
  assert.equal(JSON.stringify(currentSel), snapBefore);
  assert.equal(els.neg.value, negBefore);
  assert.equal(JSON.stringify(settingsStub), settingsBefore);
});

test("36 沒有任何變更時仍不可套用", () => {
  currentSel = [{ t: "sitting", w: 1 }];
  api.caOpen({ sel: [{ t: "standing", w: 1 }], extra: "歷史補充" });
  assert.ok(applyButton().includes("disabled"));
  assert.ok(applyButton().includes("套用（移除 0 · 加入 0）"));
  const restoreBefore = calls.restore;
  click({ ca: "apply" });
  assert.equal(calls.restore, restoreBefore, "停用時呼叫也應被 caCommit 擋下");
});

test("37 標籤與補充描述同時變更：兩者都套用", () => {
  for (const k of Object.keys(store)) delete store[k];
  currentSel = [{ t: "standing", w: 1 }];
  els.pos.value = "目前補充";
  const negBefore = els.neg.value;
  const settingsBefore = JSON.stringify(settingsStub);
  api.caOpen({ sel: [{ t: "sitting", w: 1 }], extra: "歷史補充" });
  click({ ca: "preset", preset: "pose" });
  setExtraMode("replace");
  assert.ok(!applyButton().includes("disabled"));
  assert.ok(applyButton().includes("套用（移除 1 · 加入 1）"), "有標籤變更時沿用原按鈕文字");
  const restoreBefore = calls.restore;
  click({ ca: "apply" });
  assert.equal(calls.restore, restoreBefore + 1, "標籤應提交一次");
  assert.ok(JSON.stringify(restored).includes("standing"));
  assert.ok(!JSON.stringify(restored).includes("sitting"));
  assert.equal(els.pos.value, "歷史補充", "補充描述也應一併套用");
  assert.equal(store["ui.extra"], "歷史補充");
  assert.equal(els.neg.value, negBefore);
  assert.equal(JSON.stringify(settingsStub), settingsBefore);
});

test("38 新文案：標題與替換方向以歷史圖片為基底", () => {
  currentSel = [{ t: "hatsune miku", w: 1 }];
  api.caOpen({ sel: [{ t: "2b (nier:automata)", w: 1 }, { t: "classroom", w: 1 }], extra: "歷史文字" });
  assert.equal(modalTitle, "按分類替換提示詞");
  assert.ok(html().includes("選取分類後，歷史圖片中相同分類的標籤會由目前提示詞的內容取代；沒有選取的分類會保留歷史圖片原本的內容。"));
  assert.ok(html().includes("快速替換（先預覽，確認後才會套用）"));
  assert.ok(html().includes("選擇要替換的分類（可多選）"));
});

test("39 新文案：左右欄方向、補充描述三選項與預覽標籤", () => {
  currentSel = [{ t: "hatsune miku", w: 1 }];
  api.caOpen({ sel: [{ t: "2b (nier:automata)", w: 1 }], extra: "歷史文字" });
  click({ ca: "preset", preset: "role" });
  const h = html();
  assert.ok(h.includes("歷史圖片中將被替換的標籤"));
  assert.ok(h.includes("這些標籤原本屬於歷史圖片，套用後會由目前提示詞中相同分類的標籤取代。"));
  assert.ok(h.includes("將從目前提示詞帶入的標籤"));
  assert.ok(h.includes("這些標籤會從目前提示詞帶入，取代歷史圖片中選取分類的內容。⚠ 表示需要你確認；角色專屬服裝與表情不會自動帶入。"));
  assert.ok(h.includes("保留目前的補充描述（推薦）"));
  assert.ok(h.includes("改用這張歷史圖片的補充描述"));
  assert.ok(h.includes("合併目前與歷史圖片的補充描述（自動去重）"));
  assert.ok(h.includes("目前提示詞：") && h.includes("歷史圖片："));
});

test("40 文案改名後 caCommit 替換方向不變：歷史標籤被目前標籤取代", () => {
  for (const k of Object.keys(store)) delete store[k];
  currentSel = [{ t: "standing", w: 1 }];
  els.pos.value = "目前補充";
  const negBefore = els.neg.value;
  const before = calls.restore;
  api.caOpen({ sel: [{ t: "sitting", w: 1 }], extra: "歷史補充" });
  click({ ca: "preset", preset: "pose" });
  const stats = api.caCurrentPlan().stats;
  assert.ok(stats.removeCount >= 1 && stats.addCount >= 1, "仍應有移除與加入兩側");
  click({ ca: "apply" });
  assert.equal(calls.restore, before + 1, "仍須單次提交");
  assert.ok(JSON.stringify(restored).includes("standing"), "目前提示詞標籤應帶入");
  assert.ok(!JSON.stringify(restored).includes("sitting"), "歷史標籤應被移除，不是反過來");
  assert.equal(els.neg.value, negBefore, "neg 不得變動");
  assert.deepEqual(Object.keys(store), [], "keep 模式不寫 ui.extra");
});

console.log("\n" + passed + " UI tests passed");
