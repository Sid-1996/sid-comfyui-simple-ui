// category_apply_test.mjs — 分類套用 planner 的純資料測試
// 不開瀏覽器、不連 ComfyUI：直接從 app.js 擷取純資料層，搭配真正的
// tag_categories.js 分類表執行。執行：node devtools/category_apply_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const tcSrc = fs.readFileSync(path.join(ROOT, "tag_categories.js"), "utf8");

const a = appSrc.indexOf("/* ==== CATEGORY_APPLY_PLANNER_START");
const b = appSrc.indexOf("/* ==== CATEGORY_APPLY_PLANNER_END");
assert.ok(a >= 0 && b > a, "找不到 planner 標記");
const pureSrc = appSrc.slice(a, b);

const win = { TagCategories: null };
new Function("window", tcSrc)(win);
assert.ok(win.TagCategories && typeof win.TagCategories.of === "function", "分類表載入失敗");

const P = new Function("window", pureSrc +
  "\nreturn { caNorm, caInfo, caIsGenericChar, caRoleGroup, caBuildCandidates, caPlanApply, caExtraResult, caMergeExtra, CA_CATS };")(win);

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS " + name); }
  catch (e) { console.error("  FAIL " + name + "\n    " + (e && e.message)); process.exitCode = 1; }
}
const keys = arr => arr.map(x => P.caNorm(x.t));
const hasKey = (arr, t) => keys(arr).includes(P.caNorm(t));
const candidates = (h, c, cats, role = false) => P.caBuildCandidates(h, c, cats, { role });
const defaults = cs => new Set(cs.filter(x => x.checked).map(x => x.id));
const plan = (h, c, cs, checked) => P.caPlanApply(h, c, checked, cs);

// 1. 模型 B 方向
test("1 模型 B：基底是歷史，覆蓋來源是目前", () => {
  const h = [{ t: "2b (nier:automata)", w: 1 }, { t: "classroom", w: 1 }, { t: "sitting", w: 1 }];
  const c = [{ t: "hatsune miku", w: 1 }];
  const cs = candidates(h, c, ["character"]);
  const r = plan(h, c, cs, defaults(cs));
  assert.ok(hasKey(r.nextSel, "hatsune miku"), "目前角色應加入");
  assert.ok(!hasKey(r.nextSel, "2b (nier:automata)"), "歷史角色應移除");
  assert.ok(hasKey(r.nextSel, "classroom") && hasKey(r.nextSel, "sitting"), "未選分類應保留");
  assert.deepEqual(keys(r.nextSel), ["hatsune miku", "classroom", "sitting"]);
});

// 2. 只換角色：通用外觀不得被自動刪除
test("2 角色預覽：專名預勾，通用特徵不勾且不被誤刪", () => {
  const h = [
    { t: "2b (nier:automata)", w: 1 }, { t: "long hair", w: 1 },
    { t: "solo", w: 1 }, { t: "blue eyes", w: 1 }, { t: "sitting", w: 1 }
  ];
  const c = [{ t: "hatsune miku", w: 1 }, { t: "short hair", w: 1 }, { t: "1girl", w: 1 }];
  const cs = candidates(h, c, ["character"], true);
  const grouped = Object.fromEntries(cs.map(x => [x.id, x.group]));
  assert.equal(grouped["history:2b (nier:automata)"], "name-certain");
  assert.equal(grouped["history:long hair"], "generic");
  assert.equal(grouped["history:solo"], "generic");
  assert.equal(grouped["history:blue eyes"], "generic");
  assert.equal(grouped["current:hatsune miku"], "name-possible");
  const r = plan(h, c, cs, defaults(cs));
  assert.ok(hasKey(r.nextSel, "2b (nier:automata)") === false, "專名應被移除");
  for (const t of ["long hair", "solo", "blue eyes", "sitting"]) {
    assert.ok(hasKey(r.nextSel, t), "通用特徵不得被誤刪：" + t);
  }
  assert.ok(!hasKey(r.nextSel, "short hair") && !hasKey(r.nextSel, "1girl"), "未勾選的目前標籤不應加入");
  // 人工勾選通用特徵後才會替换
  const checked = new Set(defaults(cs));
  checked.add("history:long hair"); checked.add("current:short hair");
  const r2 = plan(h, c, cs, checked);
  assert.ok(!hasKey(r2.nextSel, "long hair") && hasKey(r2.nextSel, "short hair"), "人工勾選後應替换");
});

// 3. 只換服裝
test("3 只換服裝：服裝替換、姿勢保留", () => {
  const h = [{ t: "school uniform", w: 1 }, { t: "sitting", w: 1 }];
  const c = [{ t: "bikini", w: 1 }, { t: "standing", w: 1 }];
  const cs = candidates(h, c, ["clothing"]);
  const r = plan(h, c, cs, defaults(cs));
  assert.deepEqual(keys(r.nextSel), ["bikini", "sitting"]);
});

// 4. 只換姿勢
test("4 只換姿勢", () => {
  const h = [{ t: "sitting", w: 1 }, { t: "classroom", w: 1 }];
  const c = [{ t: "standing", w: 1 }];
  const cs = candidates(h, c, ["pose"]);
  const r = plan(h, c, cs, defaults(cs));
  assert.deepEqual(keys(r.nextSel), ["standing", "classroom"]);
});

// 5. 多分類同時替換
test("5 多分類一次規劃、結果一次提交", () => {
  const h = [{ t: "school uniform", w: 1 }, { t: "sitting", w: 1 }, { t: "classroom", w: 1 }];
  const c = [{ t: "bikini", w: 1 }, { t: "standing", w: 1 }];
  const cs = candidates(h, c, ["clothing", "pose"]);
  const r = plan(h, c, cs, defaults(cs));
  assert.deepEqual(keys(r.nextSel), ["bikini", "standing", "classroom"]);
  assert.equal(r.stats.removeCount, 2);
  assert.equal(r.stats.addCount, 2);
});

// 6. 未選分類保留歷史內容與順序
test("6 未選分類保留順序與內容", () => {
  const h = [{ t: "1girl", w: 1 }, { t: "smile", w: 0.8 }, { t: "classroom", w: 1 }, { t: "sitting", w: 1 }];
  const c = [{ t: "1boy", w: 1 }, { t: "angry", w: 1 }, { t: "classroom", w: 1.2 }];
  const cs = candidates(h, c, ["background"]);
  const r = plan(h, c, cs, defaults(cs));
  assert.deepEqual(keys(r.nextSel), ["1girl", "smile", "classroom", "sitting"], "只有 background 被替換");
  assert.equal(r.nextSel.find(x => x.t === "smile").w, 0.8);
  assert.equal(r.nextSel.find(x => x.t === "classroom").w, 1.2);
});

// 7. 正規化去重
test("7 long_hair 與 long hair 視為同一標籤，不重複", () => {
  const h = [{ t: "long hair", w: 1 }];
  const c = [{ t: "long_hair", w: 1.2 }];
  const cs = candidates(h, c, ["character"]);
  const r = plan(h, c, cs, defaults(cs));
  assert.equal(r.nextSel.length, 1);
  assert.equal(r.nextSel[0].t, "long_hair");
  assert.equal(new Set(keys(r.nextSel)).size, 1);
  // 取消移除歷史項時，目前同 key 不會再被加入
  const checked = new Set(cs.filter(x => x.side === "current").map(x => x.id));
  const r2 = plan(h, c, cs, checked);
  assert.equal(r2.nextSel.length, 1);
  assert.equal(r2.nextSel[0].t, "long hair");
});

// 8. 權重採目前來源並記錄變化
test("8 相同標籤採用目前權重並在預覽標示", () => {
  const h = [{ t: "long hair", w: 0.8 }];
  const c = [{ t: "long hair", w: 1.3 }];
  const cs = candidates(h, c, ["character"]);
  const r = plan(h, c, cs, defaults(cs));
  assert.equal(r.nextSel[0].w, 1.3);
  assert.equal(r.stats.weightChanges.length, 1);
  assert.equal(r.stats.weightChanges[0].from, 0.8);
  assert.equal(r.stats.weightChanges[0].to, 1.3);
});

// 9. 未知標籤不自動替換
test("9 未知標籤：選其他分類時仍預設不勾", () => {
  const h = [{ t: "foo bar", w: 1 }, { t: "sitting", w: 1 }];
  const c = [{ t: "zzz thing", w: 1 }];
  const csPose = candidates(h, c, ["pose"]);
  assert.ok(!csPose.some(x => x.key === "foo bar"), "未勾 other 時未知標籤不應出現");
  const r0 = plan(h, c, csPose, defaults(csPose));
  assert.ok(hasKey(r0.nextSel, "foo bar"));
  const csOther = candidates(h, c, ["other"]);
  assert.ok(csOther.every(x => !x.checked), "未知標籤不得預設勾選");
  const r1 = plan(h, c, csOther, defaults(csOther));
  assert.equal(r1.stats.removeCount, 0);
  const checked = new Set(csOther.map(x => x.id));
  const r2 = plan(h, c, csOther, checked);
  assert.ok(hasKey(r2.nextSel, "zzz thing") && !hasKey(r2.nextSel, "foo bar"));
});

// 10. other 不整桶替換
test("10 已知 other 分類不得整桶替換", () => {
  const h = [{ t: "dog", w: 1 }, { t: "sitting", w: 1 }];
  const c = [{ t: "bell", w: 1 }];
  const cs = candidates(h, c, ["other"]);
  assert.ok(cs.length >= 2);
  assert.ok(cs.every(x => !x.checked), "other 候選應全部預設不勾");
  const r = plan(h, c, cs, defaults(cs));
  assert.equal(r.stats.removeCount, 0);
  assert.equal(r.stats.addCount, 0);
  const checked = new Set(cs.map(x => x.id));
  const r2 = plan(h, c, cs, checked);
  assert.ok(hasKey(r2.nextSel, "bell") && !hasKey(r2.nextSel, "dog"));
});

// 11. 角色跨分類候選需人工選取
test("11 Cosplay 與表情跨分類候選預設不勾，可人工選取", () => {
  const h = [{ t: "hatsune miku (cosplay)", w: 1 }, { t: "2b (nier:automata)", w: 1 }, { t: "smile", w: 1 }];
  const c = [{ t: "shimakaze (kancolle) (cosplay)", w: 1 }, { t: "angry", w: 1 }];
  const cs = candidates(h, c, ["character"], true);
  const g = Object.fromEntries(cs.map(x => [x.id, x.group]));
  assert.equal(g["history:hatsune miku (cosplay)"], "cross-clothing");
  assert.equal(g["current:shimakaze (kancolle) (cosplay)"], "cross-clothing");
  assert.equal(g["history:smile"], "cross-expression");
  assert.equal(g["current:angry"], "cross-expression");
  const r = plan(h, c, cs, defaults(cs));
  assert.ok(hasKey(r.nextSel, "hatsune miku (cosplay)"), "跨分類服裝不得被自動移除");
  assert.ok(hasKey(r.nextSel, "smile"), "表情不得被自動移除");
  const checked = new Set(defaults(cs));
  ["history:hatsune miku (cosplay)", "current:shimakaze (kancolle) (cosplay)", "history:smile", "current:angry"]
    .forEach(id => checked.add(id));
  const r2 = plan(h, c, cs, checked);
  assert.ok(hasKey(r2.nextSel, "shimakaze (kancolle) (cosplay)"));
  assert.ok(hasKey(r2.nextSel, "angry"));
  assert.ok(!hasKey(r2.nextSel, "hatsune miku (cosplay)"));
});

// 12-14. extra 三種模式
test("12 Extra 預設保留目前內容", () => {
  assert.equal(P.caExtraResult("keep", "目前文字", "歷史文字"), "目前文字");
});
test("13 Extra 取代為歷史內容", () => {
  assert.equal(P.caExtraResult("replace", "目前文字", "歷史文字"), "歷史文字");
});
test("14 Extra 合併去重且保留原始文字", () => {
  const cur = "女孩, 教室, 櫻花";
  const hist = "女孩, classroom, 夜晚";
  assert.equal(P.caExtraResult("merge", cur, hist), "女孩, 教室, 櫻花, classroom, 夜晚");
  assert.equal(P.caExtraResult("merge", cur, "女孩"), cur, "完全重複時不變");
});

// 15. planner 不碰 neg / 生成設定
test("15 資料層與 UI 層不碰負面提示詞與生成設定", () => {
  const block = appSrc.slice(a, appSrc.indexOf("/* ── 刪圖", b));
  for (const s of ['$("neg")', "persistSettings", 'S.settings', '$("ckpt")', '$("steps")', '$("cfg")', '$("seed")']) {
    assert.ok(!block.includes(s), "分類套用不應出現 " + s);
  }
  const r = plan([{ t: "sitting", w: 1 }], [], [], new Set());
  assert.deepEqual(Object.keys(r).sort(), ["add", "nextSel", "remove", "stats"]);
});

// 16. 預覽階段不呼叫 Tags.restore
test("16 建立候選與規劃過程不寫入 Tags 狀態", () => {
  const calls = [];
  const saved = win.Tags;
  win.Tags = { restore: () => calls.push("restore"), tagZh: () => "", isAdult: () => false };
  try {
    const h = [{ t: "sitting", w: 1 }], c = [{ t: "standing", w: 1 }];
    const cs = candidates(h, c, ["pose"]);
    plan(h, c, cs, defaults(cs));
    P.caExtraResult("merge", "a", "b");
    assert.equal(calls.length, 0);
  } finally { win.Tags = saved; }
});

// 17. 提交只有一次 restore
test("17 caCommit 只呼叫一次 Tags.restore", () => {
  const block = appSrc.slice(a, appSrc.indexOf("/* ── 刪圖", b));
  const n = (block.match(/window\.Tags\.restore\(/g) || []).length;
  assert.equal(n, 1, "還原提交應恰好一次，實際 " + n);
});

// 18. 完整套用未被改動
test("18 既有 reusePrompt 完整套用語意不變", () => {
  const expected = [
    'function reusePrompt(it) {',
    '    window.Tags.restore(it.sel || []);',
    '    $("pos").value = it.extra || "";',
    '    try { localStorage.setItem("ui.extra", $("pos").value); } catch (e) { /* ignore */ }',
    '    if (it.neg) { $("neg").value = it.neg; persistSettings(); }',
    '    updateWarn();',
    '    toast("已套用這張圖的提示詞", "ok");',
    '  }'
  ].join("\n");
  assert.ok(appSrc.replace(/\r\n/g, "\n").includes(expected), "reusePrompt 被修改");
});

// ==== 審查修正回歸測試：body 跨分類候選 ====
const BODY_WORK = "oripathy lesion (arknights)";

test("19 角色模式找到 body 跨分類候選（歷史與目前兩側）", () => {
  const h = [{ t: BODY_WORK, w: 1 }, { t: "heart (organ)", w: 1 }, { t: "large breasts", w: 1 }];
  const c = [{ t: BODY_WORK, w: 1.2 }];
  const cs = candidates(h, c, ["character"], true);
  const g = Object.fromEntries(cs.map(x => [x.id, x.group]));
  assert.equal(g["history:" + BODY_WORK], "cross-body");
  assert.equal(g["current:" + BODY_WORK], "cross-body");
  assert.ok(!cs.some(x => x.t === "heart (organ)"), "通用消歧括號不得列為候選");
  assert.ok(!cs.some(x => x.t === "large breasts"), "一般身體特徵不得列為角色候選");
});

test("20 body 跨分類候選預設不勾選", () => {
  const cs = candidates([{ t: BODY_WORK, w: 1 }], [{ t: BODY_WORK, w: 1.2 }], ["character"], true);
  const cross = cs.filter(x => x.group === "cross-body");
  assert.equal(cross.length, 2);
  assert.ok(cross.every(x => !x.checked));
});

test("21 body 候選未勾選時，兩側 body 標籤都不變", () => {
  const h = [{ t: BODY_WORK, w: 1 }, { t: "large breasts", w: 1 }];
  const c = [{ t: BODY_WORK, w: 1.2 }];
  const cs = candidates(h, c, ["character"], true);
  const r = plan(h, c, cs, defaults(cs));
  assert.deepEqual(keys(r.nextSel), [BODY_WORK, "large breasts"]);
  assert.equal(r.nextSel[0].w, 1, "未勾選不得採用目前權重");
  assert.equal(r.stats.removeCount, 0);
  assert.equal(r.stats.addCount, 0);
});

test("22 人工勾選歷史與目前 body 候選後才替換", () => {
  const h = [{ t: BODY_WORK, w: 1 }, { t: "large breasts", w: 1 }];
  const c = [{ t: BODY_WORK, w: 1.2 }];
  const cs = candidates(h, c, ["character"], true);
  const checked = new Set(cs.filter(x => x.group === "cross-body").map(x => x.id));
  const r = plan(h, c, cs, checked);
  assert.equal(r.nextSel.find(x => P.caNorm(x.t) === P.caNorm(BODY_WORK)).w, 1.2);
  assert.ok(hasKey(r.nextSel, "large breasts"), "一般身體特徵應保留");
  assert.equal(r.stats.weightChanges.length, 1);
});

test("23 一般 body 特徵不會被當成角色專名", () => {
  for (const t of ["large breasts", "demon horns", "dragon tail", "heart (organ)", "alternate skin color"]) {
    assert.equal(P.caRoleGroup({ t, cat: "body", has: true, key: P.caNorm(t) }), null, t + " 不應是跨分類角色候選");
  }
});

// ==== 審查修正回歸測試：角色模式狀態 ====
const ROLE_H = [
  { t: "2b (nier:automata)", w: 1 }, { t: "long hair", w: 1 },
  { t: "hatsune miku (cosplay)", w: 1 }, { t: BODY_WORK, w: 1 }, { t: "smile", w: 1 }
];
const ROLE_C = [{ t: "hatsune miku", w: 1 }];

test("24 角色快捷模式正常啟用並列出跨分類候選", () => {
  const cs = candidates(ROLE_H, ROLE_C, ["character"], true);
  const groups = new Set(cs.map(x => x.group));
  assert.ok(groups.has("name-certain"));
  assert.ok(groups.has("generic"));
  assert.ok(groups.has("cross-clothing") && groups.has("cross-body") && groups.has("cross-expression"));
});

test("25 取消 character 後角色專用跨分類候選不再出現", () => {
  const h = ROLE_H.concat([{ t: "sitting", w: 1 }]);
  const cs = candidates(h, ROLE_C, ["pose"], true); // role=true 但 character 未選
  assert.ok(!cs.some(x => x.group && x.group.indexOf("cross-") === 0));
  assert.deepEqual(keys(cs), ["sitting"], "只剩一般 pose 候選");
});

test("26 取消 character 後單獨選 expression 恢復一般預設勾選", () => {
  const h = [{ t: "smile", w: 1 }, { t: "sitting", w: 1 }];
  const c = [{ t: "angry", w: 1 }];
  const cs = candidates(h, c, ["expression"], true);
  assert.ok(cs.length > 0);
  assert.ok(cs.every(x => x.checked), "明確選取的分類不得沿用角色模式的預設不勾選");
});

test("27 角色模式下增加 background，兩者共同預覽", () => {
  const h = [{ t: "2b (nier:automata)", w: 1 }, { t: "long hair", w: 1 }, { t: "classroom", w: 1 }];
  const c = [{ t: "hatsune miku", w: 1 }, { t: "bedroom", w: 1 }];
  const cs = candidates(h, c, ["character", "background"], true);
  const by = Object.fromEntries(cs.map(x => [x.id, x]));
  assert.equal(by["history:2b (nier:automata)"].group, "name-certain");
  assert.ok(by["history:2b (nier:automata)"].checked);
  assert.ok(!by["history:long hair"].checked, "角色模式內通用特徵仍不勾");
  assert.ok(by["history:classroom"].checked && by["history:classroom"].cat === "background");
  assert.ok(by["current:bedroom"].checked);
});

test("28 再次選擇角色快捷，候選與預設狀態恢復", () => {
  const cs = candidates(ROLE_H, ROLE_C, ["character"], true);
  const by = Object.fromEntries(cs.map(x => [x.id, x]));
  assert.ok(by["history:2b (nier:automata)"].checked);
  assert.ok(!by["history:long hair"].checked);
  assert.ok(!by["history:" + BODY_WORK].checked);
  assert.ok(!by["history:smile"].checked);
});

console.log("\n" + passed + " / 28 tests passed");
