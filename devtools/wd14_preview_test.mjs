import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const plannerStart = app.indexOf("function normKey(s)");
const plannerEnd = app.indexOf("function rvResetResult()", plannerStart);
const uiStart = app.indexOf("function rvUpdateApply()");
const uiEnd = app.indexOf("/* ── 分類瀏覽", uiStart);
const applyStart = app.indexOf("function rvApply()");
const applyEnd = app.indexOf("function openReverse()", applyStart);
assert.ok(plannerStart >= 0 && plannerEnd > plannerStart && uiStart > plannerEnd && uiEnd > uiStart && applyEnd > applyStart);

const tags = [{ t: "known tag", w: 1 }];
const pos = { value: "existing unknown" };
const preview = { innerHTML: "" };
const elements = {
  pos,
  rvApplyPreviewBody: preview,
  revApply: { disabled: false, title: "", textContent: "", classList: { toggle() {} } },
  revSelCount: { textContent: "" },
  revClear: { disabled: false }
};
const $ = id => elements[id] || null;
const window = { Tags: {
  selected: () => tags,
  matchTag: name => ({ "known tag": "known tag", "new known": "new known" })[name.toLowerCase()] || null,
  addTags: values => { added.push(...values); return values.length; }
} };
const picked = new Set(["known_tag", "new_known", "brand_new", "existing_unknown", "<img onerror=bad>"]);
const RV = { picked };
const added = [];
const writes = [];
const safe = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const context = {
  $, window, RV, esc: safe, localStorage: { setItem: (...args) => writes.push(args) },
  updateWarn() {}, syncGo() {}, closeReverse() {}, toast(message) { context.message = message; },
  rvUpdateSelectionActions() {},
  console, Set, Map, Array, String, Number, Object
};
vmRun();

function vmRun() {
  vm.runInNewContext(app.slice(plannerStart, plannerEnd) + "\n" +
    app.slice(uiStart, uiEnd) + "\n" + app.slice(applyStart, applyEnd) +
    "\nthis.api={rvBuildApplyPlan,rvUpdateApply,rvApply};", context);
}

let pass = 0;
function test(name, fn) { fn(); pass++; console.log("PASS " + name); }

test("preview splits new known/unknown tags, skips existing values, and escapes text", () => {
  context.api.rvUpdateApply();
  assert.match(preview.innerHTML, /準備新增至標籤列 · 1/);
  assert.match(preview.innerHTML, /準備新增至補充描述 · 2/);
  assert.match(preview.innerHTML, /已存在、將略過 · 2/);
  assert.match(preview.innerHTML, /&lt;img onerror=bad&gt;/);
  assert.doesNotMatch(preview.innerHTML, /<img onerror=bad>/);
  assert.equal(pos.value, "existing unknown", "preview must not mutate current prompt state");
  assert.deepEqual(writes, []);
});

test("rvApply commits the same planned split and merged extra text", () => {
  context.api.rvApply();
  assert.deepEqual(added, ["new known"]);
  assert.equal(pos.value, "existing unknown, brand new, <img onerror=bad>");
  assert.deepEqual(writes, [["ui.extra", pos.value]]);
  assert.match(context.message, /底部 1、補充描述 2/);
  assert.match(context.message, /略過 2 個重複/);
});

test("duplicate-only selection has an explicit no-change state and lists skipped tags", () => {
  picked.clear();
  picked.add("known_tag");
  picked.add("existing_unknown");
  context.api.rvUpdateApply();
  assert.match(preview.innerHTML, /沒有可新增內容/);
  assert.match(preview.innerHTML, /已存在、將略過 · 2/);
  assert.match(preview.innerHTML, /known tag/);
  assert.match(preview.innerHTML, /existing unknown/);
});

console.log(`\n${pass} WD14 preview tests passed`);
