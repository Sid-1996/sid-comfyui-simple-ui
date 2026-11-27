import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = {};
context.window = context;
vm.runInNewContext(fs.readFileSync(path.join(root, "prompt_core.js"), "utf8"), context);
const P = context.PromptComposer;
const Dict = {
  tr(s) { return String(s).replace("樹下", "under tree").replace("紅髮", "red hair"); },
  leftover(s) { return String(s).includes("樹下") ? ["樹下"] : []; }
};
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS " + name); }

test("PromptEntry has all 14 fields; empty and populated arrays are valid", () => {
  const empty = P.derivePromptModel({ sel: [], extra: "", loras: [], negativeRaw: "" }, { Dict });
  assert.deepEqual(Array.from(empty.positive), []);
  const model = P.derivePromptModel({ sel: [{ t: "blue_eyes", w: 1.2 }], extra: "紅髮，樹下", loras: [], negativeRaw: "" }, { Dict });
  assert.ok(model.positive.length > 1);
  const fields = ["id", "kind", "owner", "origin", "text", "weight", "order", "lora", "disabled", "raw", "translated", "untranslated", "fragments", "adoptionId"];
  for (const entry of model.positive) {
    assert.deepEqual(Object.keys(entry).sort(), fields.slice().sort());
    assert.notEqual(entry.id, "e1");
    assert.ok(["user", "system"].includes(entry.owner));
    assert.notEqual(entry.origin, "personal");
    assert.equal(entry.adoptionId, null);
    assert.equal(entry.kind === "lora-trigger" || entry.lora === null, true);
  }
  const free = model.positive.filter(x => x.kind === "freetext");
  assert.equal(free.length, 2);
  assert.deepEqual(Array.from(free[1].untranslated), ["樹下"]);
  assert.ok(!model.positive.some(x => x.text.includes("樹下")));
  assert.equal(free[0].raw, "紅髮");
  assert.deepEqual(Array.from(free[0].translated), ["red hair"]);
  assert.equal(free[0].fragments[0].raw, "紅髮");
  const composed = P.compose(model);
  assert.equal(composed.snapshotEntries[0].entryId, "e1");
  assert.notEqual(composed.snapshotEntries[0].entryId, model.positive[0].id);
  assert.ok(!Object.prototype.hasOwnProperty.call(composed.snapshotEntries[0], "id"));
  assert.equal(composed.effective[0].entryId, composed.snapshotEntries[0].entryId);
  assert.ok(composed.snapshotEntries.every(x => typeof x.entryId === "string" && !Object.prototype.hasOwnProperty.call(x, "id")));
});

test("Legacy LoRA adapter normalizes enabled, personal triggers and autoTrigger", () => {
  const base = { name: "char/a.safetensors", triggers: ["A", "Shared"], autoTrigger: true };
  const model = P.derivePromptModel({ sel: [], extra: "", qualityTags: false, negativeRaw: "", loras: [
    base, { ...base, name: "char/b.safetensors", enabled: null, autoTrigger: false, triggers: ["shared", "B"] },
    { ...base, name: "char/c.safetensors", enabled: false, triggers: ["off"] },
    { ...base, name: "char/d.safetensors", enabled: true, autoTrigger: false, triggers: ["kept"] },
    { ...base, name: "char/e.safetensors", enabled: true, triggers: [], authorSuggestions: ["never"] }
  ] }, { Dict });
  const entries = model.positive.filter(x => x.kind === "lora-trigger");
  assert.equal(entries.length, 5);
  assert.ok(entries.some(x => x.text === "kept" && x.disabled));
  assert.ok(!entries.some(x => x.text === "off" || x.text === "never"));
  const result = P.compose(model);
  assert.ok(!result.pos.includes("kept"));
  assert.equal(result.entries.length, 5);
  assert.deepEqual(Array.from(result.effective, x => x.token), ["A", "Shared"]);
});

test("Composer order, weight formatting, NFKC dedup and disabled filtering", () => {
  const model = { v: 2, qualityTags: true, negativeRaw: "", positive: [
    { id: "l1", kind: "lora-trigger", owner: "user", origin: "manual", text: "red hair", weight: null, order: 4, lora: "a.safetensors", disabled: false, raw: null, translated: [], untranslated: [], fragments: [], adoptionId: null },
    { id: "t1", kind: "tag", owner: "user", origin: "tag-db", text: "blue eyes", weight: 1.25, order: 1, lora: null, disabled: false, raw: null, translated: [], untranslated: [], fragments: [], adoptionId: null },
    { id: "t2", kind: "tag", owner: "user", origin: "tag-db", text: "BLUE_EYES", weight: 1, order: 2, lora: null, disabled: false, raw: null, translated: [], untranslated: [], fragments: [], adoptionId: null },
    { id: "f1", kind: "freetext", owner: "user", origin: "freetext", text: "under tree", weight: null, order: 3, lora: null, disabled: false, raw: "樹下", translated: ["under tree"], untranslated: [], fragments: [{ raw: "樹下", translated: ["under tree"], untranslated: [] }], adoptionId: null },
    { id: "q1", kind: "quality", owner: "system", origin: "default", text: "masterpiece", weight: null, order: 0, lora: null, disabled: false, raw: null, translated: [], untranslated: [], fragments: [], adoptionId: null },
    { id: "x", kind: "tag", owner: "user", origin: "tag-db", text: "ignored", weight: 1, order: 5, lora: null, disabled: true, raw: null, translated: [], untranslated: [], fragments: [], adoptionId: null }
  ] };
  const result = P.compose(model);
  assert.equal(result.pos, "masterpiece, (blue eyes:1.3), under tree, red hair");
  assert.equal(result.effective.length, 4);
  assert.equal(result.entries.length, 6);
  assert.equal(result.posHash, P.compose(model).posHash);
});

test("Negative L1 is untouched; L2 deduplicates and keeps unparsed tokens", () => {
  const raw = " worst_quality, (low quality:1.25), WORST QUALITY, (broken ";
  const result = P.compose({ positive: [], negativeRaw: raw });
  assert.equal(result.neg, raw);
  assert.equal(result.negativeParse.mode, "parsed");
  assert.deepEqual(Array.from(result.negativeParse.unparsed), ["(broken"]);
  assert.equal(result.negativeEntries[0].text, "worst quality");
  assert.equal(result.negativeEntries[1].weight, 1.25);
  assert.deepEqual(Array.from(result.effectiveNegative, x => x.token), ["worst quality", "(low quality:1.3)", "(broken"]);
  assert.ok(!("neg" in result.negativeEntries[0]));
});

test("quality whitelist is exact and general styles remain selectable", () => {
  const expected = ["masterpiece", "best quality", "amazing quality", "very aesthetic", "absurdres", "ultra-detailed", "8k", "clean sharp lines", "sharp digital rendering", "delicate rendering", "high resolution digital illustration"];
  assert.deepEqual(Array.from(P.qualityWords()), expected);
  for (const word of expected) assert.equal(P.isQualityWord(word), true, word);
  for (const word of ["detailed", "anime coloring", "cel shading", "watercolor_(medium)"]) assert.equal(P.isQualityWord(word), false, word);
});

console.log(`\n${passed} prompt core tests passed`);
