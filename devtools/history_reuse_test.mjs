import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const start = app.indexOf("function buildReusePlan(it)");
const end = app.indexOf("/* ==== CATEGORY_APPLY_PLANNER_START", start);
assert.ok(start >= 0 && end > start, "history reuse functions were not found");
const source = app.slice(start, end);

function fixture() {
  const store = new Map([["sel", "before-sel"], ["ui.extra", "before-extra"], ["ui.settings", "before-settings"], ["ui.loras", "before-loras"]]);
  const calls = { restore: 0, persist: 0, writes: 0, toast: [], warn: 0, modal: null, saves: 0, saveOk: true };
  const els = { pos: { value: "before-extra" }, neg: { value: "before-neg" }, modalBody: { querySelector: () => calls.confirm } };
  const $ = id => els[id];
  const localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { calls.writes++; store.set(k, String(v)); }
  };
  const win = {
    Tags: {
      snapshot() { return calls.currentSel || [{ t: "current tag", w: 0.8 }]; },
      restore(sel) { calls.restore++; calls.sel = JSON.parse(JSON.stringify(sel)); }
    },
    LoraMigration: { saveState() { calls.saves++; return calls.saveOk ? { ok: true } : { ok: false, message: "save failed" }; } }
  };
  const context = {
    $, localStorage, window: win, S: { loras: [{ name: "current.safetensors" }], loraCiv: {} },
    esc: s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    loraItem: () => null, loraParseItems: x => x.items, loraSerialize: x => x,
    LORA: { active: null, editing: -1 }, renderLoraSelected() {}, renderLoraPick() {}, renderLoraTriggers() {}, renderLoraBackupNotice() {},
    persistSettings() { calls.persist++; }, updateWarn() { calls.warn++; }, toast(m) { calls.toast.push(m); },
    openModal(title, html) { calls.modal = { title, html }; calls.confirm = { disabled: html.includes('data-reuse="confirm" disabled') || html.includes('data-positive-reuse="confirm" disabled'), onclick: null }; },
    closeModal() { calls.closed = (calls.closed || 0) + 1; },
    JSON, Object, Array, String, Number
  };
  vm.runInNewContext(source + "\nthis.api = { buildReusePlan, buildPositiveReusePlan, commitReuse, reusePrompt, reuseTextPrompt, hasPositiveSnapshot };", context);
  return { context, calls, store, els };
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS " + name); }

for (const neg of ["old negative", "", undefined]) {
  test("positive apply replaces only positive and preserves Negative/LoRA/settings/history (neg=" + String(neg) + ")", () => {
    const f = fixture();
    const history = { sel: [{ t: "blue eyes", w: 1.2 }], extra: "history extra", loras: [], neg };
    const historyBefore = JSON.stringify(history);
    const currentLoras = f.context.S.loras;
    f.context.api.reuseTextPrompt(history);
    assert.equal(f.calls.modal.title, "套用正向提示詞");
    assert.ok(f.calls.modal.html.includes("將這張歷史圖片的正向標籤與補充描述套用到目前提示詞；目前 Negative、LoRA 與生成設定不會改變。"));
    assert.ok(f.calls.modal.html.includes("目前 Positive") && f.calls.modal.html.includes("套用後 Positive"));
    assert.ok(f.calls.modal.html.includes("新增") && f.calls.modal.html.includes("移除") && f.calls.modal.html.includes("保留"));
    assert.ok(f.calls.modal.html.includes("current tag") && f.calls.modal.html.includes("blue eyes"));
    f.calls.confirm.onclick();
    assert.deepEqual(f.calls.sel, [{ t: "blue eyes", w: 1.2 }]);
    assert.equal(f.els.pos.value, "history extra");
    assert.equal(f.els.neg.value, "before-neg");
    assert.equal(f.context.S.loras, currentLoras);
    assert.equal(f.calls.persist, 0);
    assert.equal(JSON.stringify(history), historyBefore);
    assert.equal(f.store.get("ui.extra"), "history extra");
  });
}

test("positive apply refuses missing sel or extra without writes", () => {
  for (const history of [{ extra: "x" }, { sel: [], extra: null }, { sel: [] }, { sel: null, extra: "x" }, { sel: [null], extra: "x" }]) {
    const f = fixture();
    const before = JSON.stringify([...f.store.entries()]);
    assert.equal(f.context.api.hasPositiveSnapshot(history), false);
    assert.equal(f.context.api.reuseTextPrompt(history), false);
    assert.equal(JSON.stringify([...f.store.entries()]), before);
    assert.equal(f.calls.restore, 0);
    assert.equal(f.els.pos.value, "before-extra");
  }
});

test("failed positive Tags.restore leaves the free text untouched", () => {
  const f = fixture();
  f.context.window.Tags.restore = () => { throw new Error("failure"); };
  f.context.api.reuseTextPrompt({ sel: [], extra: "new" });
  f.calls.confirm.onclick();
  assert.equal(f.els.pos.value, "before-extra");
  assert.equal(f.store.get("ui.extra"), "before-extra");
});

test("full restore plan distinguishes missing, empty and populated optional fields", () => {
  const f = fixture();
  const missing = f.context.api.buildReusePlan({ sel: [], extra: "x" });
  const empty = f.context.api.buildReusePlan({ sel: [], extra: "x", neg: "", loras: [] });
  const populated = f.context.api.buildReusePlan({ sel: [], extra: "x", neg: "n", loras: [{ name: "a.safetensors", strength: 0.8 }] });
  assert.equal(missing.negAction, "keep"); assert.equal(missing.loraAction, "keep");
  assert.equal(empty.negAction, "replace"); assert.equal(empty.loraAction, "replace"); assert.equal(empty.loraList.length, 0);
  assert.equal(populated.negAction, "replace"); assert.equal(populated.loraAction, "replace");
  assert.equal(f.context.api.buildReusePlan({ extra: "x" }).positiveReady, false);
  assert.equal(f.context.api.buildReusePlan({ sel: [] }).positiveReady, false);
});

test("full restore confirmation describes actual fields and leaves generation settings out", () => {
  const f = fixture();
  f.context.api.reusePrompt({ sel: [{ t: "old", w: 1 }], extra: "old", neg: "", loras: [] });
  assert.equal(f.calls.modal.title, "還原已保存的提示詞狀態");
  assert.ok(f.calls.modal.html.includes("尺寸、步數、CFG、Seed、模型及其他生成設定都保留目前值"));
  assert.ok(f.calls.modal.html.includes("Negative · 將清空"));
  assert.ok(f.calls.modal.html.includes("會清空目前 LoRA"));
  assert.ok(f.calls.modal.html.includes('aria-label="Negative 還原差異"'));
  assert.ok(f.calls.modal.html.includes('aria-label="LoRA 還原差異"'));
  f.calls.confirm.onclick();
  assert.deepEqual(f.calls.sel, [{ t: "old", w: 1 }]);
  assert.equal(f.els.pos.value, "old");
  assert.equal(f.els.neg.value, "");
  assert.equal(f.calls.saves, 1);
  assert.equal(f.calls.persist, 1);
});

test("full restore preview shows replace targets for Negative and named LoRAs with strength", () => {
  const f = fixture();
  f.context.S.loras = [{ name: "current.safetensors", display: "Current", strength: 0.7 }];
  f.context.api.reusePrompt({
    sel: [{ t: "new tag", w: 1 }], extra: "new extra", neg: "new negative",
    loras: [{ name: "history.safetensors", display: "History Style", strength: 0.85 }]
  });
  const html = f.calls.modal.html;
  assert.ok(html.includes("Negative · 取代") && html.includes("new negative"));
  assert.ok(html.includes("LoRA · 取代") && html.includes("Current × 0.70") && html.includes("History Style × 0.85"));
  assert.ok(html.includes("new tag") && html.includes("new extra"));
  assert.equal(f.calls.restore, 0, "opening the preview must not commit");
});

test("positive preview output is the exact data committed after confirmation and escaped", () => {
  const f = fixture();
  f.calls.currentSel = [{ t: "remove me", w: 1 }];
  f.context.api.reuseTextPrompt({ sel: [{ t: "<img onerror=1>", w: 1.2 }], extra: "new extra" });
  assert.ok(f.calls.modal.html.includes("&lt;img onerror=1&gt;"));
  assert.ok(!f.calls.modal.html.includes("<img onerror=1>"));
  f.calls.confirm.onclick();
  assert.deepEqual(f.calls.sel, [{ t: "<img onerror=1>", w: 1.2 }]);
  assert.equal(f.els.pos.value, "new extra");
});

test("same normalized tag and weight is retained", () => {
  const f = fixture();
  f.calls.currentSel = [{ t: "blue eyes", w: 1 }];
  const plan = f.context.api.buildPositiveReusePlan({ sel: [{ t: "blue eyes", w: "1.0" }], extra: "" });
  assert.deepEqual(JSON.parse(JSON.stringify(plan.retained)), [{ t: "blue eyes", w: "1.0" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.weightChanges)), []);

  f.calls.currentSel = [{ t: "blue eyes", w: 0 }];
  const defaulted = f.context.api.buildPositiveReusePlan({ sel: [{ t: "blue eyes" }], extra: "" });
  assert.equal(defaulted.retained.length, 1, "non-positive or missing weights use the project default 1");
  assert.equal(defaulted.weightChanges.length, 0);
});

test("same tag with a different weight has its own old-to-new preview and commits the original weight", () => {
  const f = fixture();
  f.calls.currentSel = [{ t: "blue eyes", w: 1 }];
  f.context.api.reuseTextPrompt({ sel: [{ t: "blue eyes", w: 1.2 }], extra: "" });
  assert.ok(f.calls.modal.html.includes("權重變更"));
  assert.ok(f.calls.modal.html.includes("blue eyes：1.0 → 1.2"));
  assert.ok(f.calls.modal.html.includes("<p class=\"meta\">沒有相同標籤</p>"));
  f.calls.confirm.onclick();
  assert.deepEqual(f.calls.sel, [{ t: "blue eyes", w: 1.2 }]);
});

test("only-new tags stay in the added category", () => {
  const f = fixture();
  f.calls.currentSel = [];
  const plan = f.context.api.buildPositiveReusePlan({ sel: [{ t: "blue eyes", w: 1 }], extra: "" });
  assert.deepEqual(JSON.parse(JSON.stringify(plan.added)), [{ t: "blue eyes", w: 1 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.removed)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.weightChanges)), []);
});

test("only-removed tags stay in the removed category", () => {
  const f = fixture();
  f.calls.currentSel = [{ t: "blue eyes", w: 1.2 }];
  const plan = f.context.api.buildPositiveReusePlan({ sel: [], extra: "" });
  assert.deepEqual(JSON.parse(JSON.stringify(plan.added)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.removed)), [{ t: "blue eyes", w: 1.2 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.weightChanges)), []);
});

test("LoRA persistence failure prevents every other full-restore change", () => {
  const f = fixture();
  f.calls.saveOk = false;
  const before = JSON.stringify([...f.store.entries()]);
  const oldLoras = f.context.S.loras;
  f.context.api.reusePrompt({ sel: [{ t: "new", w: 1 }], extra: "new", neg: "new neg", loras: [] });
  f.calls.confirm.onclick();
  assert.equal(JSON.stringify([...f.store.entries()]), before);
  assert.equal(f.calls.restore, 0);
  assert.equal(f.els.pos.value, "before-extra");
  assert.equal(f.els.neg.value, "before-neg");
  assert.equal(f.context.S.loras, oldLoras);
});

test("full restore with incomplete positive snapshot shows disabled confirmation", () => {
  const f = fixture();
  f.context.api.reusePrompt({ sel: [], neg: "new", loras: [] });
  assert.equal(f.calls.confirm.disabled, true);
  assert.ok(f.calls.modal.html.includes("缺少完整提示詞資料"));
  f.calls.confirm.onclick();
  assert.equal(f.calls.restore, 0);
  assert.equal(f.els.pos.value, "before-extra");
  assert.equal(f.els.neg.value, "before-neg");
});

console.log(`\n${passed} history reuse tests passed`);
