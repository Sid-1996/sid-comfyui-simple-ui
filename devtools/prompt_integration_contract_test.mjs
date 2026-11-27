import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const tags = fs.readFileSync(path.join(root, "tags.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
function body(source, marker, next) {
  const start = source.indexOf(marker), end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `missing ${marker}`);
  return source.slice(start, end);
}
const generate = body(app, "async function generate()", "async function waitFor(pid)");
const snapshot = body(app, "function snapshotNow()", "// ── 生成診斷紀錄");
const composeCurrent = body(app, "function composeCurrentPrompt(selected)", "// 生成前取");
const preview = body(app, "function showPromptModal()", "/* ── 角色 LoRA");
const historyText = body(app, "function reuseTextPrompt(it)", "/* ==== CATEGORY_APPLY_PLANNER_START");
const historyPlan = body(app, "function buildReusePlan(it)", "function commitReuse(plan)");
const positivePlan = body(app, "function buildPositiveReusePlan(item)", "function reuseDiffList(entries, empty)");
const positivePreview = body(app, "function positiveReusePreview(plan)", "function commitReuse(plan)");
const reverseApply = body(app, "function rvApply()", "function openReverse()");
const reversePlan = body(app, "function rvBuildApplyPlan(", "function rvResetResult()");

assert.equal((generate.match(/const snap = snapshotNow\(\);/g) || []).length, 1, "generation must take one snapshot");
assert.equal((snapshot.match(/composeCurrentPrompt\(sel\)/g) || []).length, 1, "snapshot must use one composed result");
assert.equal((composeCurrent.match(/PromptComposer\.compose\(/g) || []).length, 1, "the single composition helper calls Composer once");
assert.ok(!generate.includes("PromptComposer.compose("), "generation must not compose a second time");
assert.ok(generate.includes("pos: snap.pos, neg: snap.neg"));
assert.ok(generate.includes("prompt: o.pos"), "gallery prompt must use payload prompt text");
assert.ok(preview.includes("const p = composed.result.pos"), "preview uses the Composer result");
assert.ok(snapshot.includes("posHash: composed.result.posHash"));
assert.ok(snapshot.includes("entries: composed.result.snapshotEntries"), "generation snapshot must carry Composer SnapshotEntry objects");
assert.ok(!snapshot.includes("composed.result.entries"), "generation snapshot must not leak memory PromptEntry ids");
assert.ok(!snapshot.includes("Tags.buildPrompt") && !snapshot.includes("Dict.tr"), "snapshot cannot rebuild or retranslate");
assert.ok(tags.includes("window.PromptComposer.isQualityWord(x.e)"));
assert.ok(tags.includes("const isQualityWord = window.PromptComposer.isQualityWord"));
assert.ok(tags.includes('advanced ? "全部 " : "可選 "'));
assert.ok(index.indexOf('<script src="/prompt_core.js"') < index.indexOf('<script src="/tags.js"'), "quality predicate must exist before tag initialization");
assert.ok(!historyText.includes("loraSave") && !historyText.includes("S.loras"), "text-only history cannot change LoRA");
assert.ok(!historyPlan.includes("setItem") && !historyPlan.includes("Tags.restore"), "plan building is read-only");
assert.ok(historyPlan.includes("positive") && historyPlan.includes("sel: positive ? positive.sel") && historyPlan.includes("extra: positive ? positive.extra"));
assert.ok(positivePreview.includes("plan.sel") && positivePreview.includes("plan.extra"), "history preview must read the shared planned target");
assert.ok(reverseApply.includes("rvBuildApplyPlan") && reverseApply.includes("split.extraText"));
assert.ok(!reverseApply.includes("rvMergePrompt("), "reverse commit must not recalculate the preview merge");
assert.ok(reversePlan.includes("rvSplitPicked") && reversePlan.includes("rvMergePrompt"));
assert.ok(index.includes("來源：正在分析的圖片。候選：WD14 反推標籤。目標：目前提示詞。"));
assert.ok(index.includes("只會新增，不會移除既有內容，重複項目會略過。"));
assert.ok(index.includes("加入目前提示詞（0）"));
assert.ok(index.includes('id="rvApplyPreviewBody"') && index.includes('aria-label="反推標籤加入預覽"'));
assert.ok(reverseApply.includes('window.Tags.addTags(split.toBottom)'));
assert.ok(reverseApply.includes('localStorage.setItem("ui.extra", split.extraText)'));
assert.ok(reverseApply.includes("已加入目前提示詞："));

const promptContext = {};
promptContext.window = promptContext;
vm.runInNewContext(fs.readFileSync(path.join(root, "prompt_core.js"), "utf8"), promptContext);
const model = promptContext.PromptComposer.derivePromptModel({ sel: [{ t: "blue eyes", w: 1 }], extra: "", loras: [], negativeRaw: "" });
const composed = promptContext.PromptComposer.compose(model);
let composerCalls = 0;
const dom = { pos: { value: "" }, neg: { value: "" }, ckpt: { value: "checkpoint" }, steps: { value: "25" }, cfg: { value: "6" } };
const snapshotNow = new Function("$", "window", "S", "composeCurrentPrompt", "loraSnapshot", "readSeed", `${snapshot}\nreturn snapshotNow;`)(
  id => dom[id] || null,
  { Tags: { snapshot: () => [{ t: "blue eyes", w: 1 }] } },
  { settings: { size: "1024x1024", n: 1 }, loras: [] },
  () => { composerCalls++; return { model, result: composed }; },
  () => [], () => -1
);
const generatedSnapshot = snapshotNow();
assert.equal(composerCalls, 1);
assert.equal(generatedSnapshot.entries[0].entryId, composed.snapshotEntries[0].entryId);
assert.ok(!Object.prototype.hasOwnProperty.call(generatedSnapshot.entries[0], "id"));
assert.equal(generatedSnapshot.entries[0].text, "blue eyes");
console.log("PASS generation composer count, shared prompt strings, quality flow and history side-effect boundaries");
