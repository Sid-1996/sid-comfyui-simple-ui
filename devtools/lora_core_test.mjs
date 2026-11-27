// lora_core_test.mjs — LoRA 純資料層與 Workflow 串接測試
// 不開瀏覽器、不連 ComfyUI：直接從 app.js 擷取 LORA_CORE 區塊執行。
// 執行：node devtools/lora_core_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

const a = appSrc.indexOf("/* ==== LORA_CORE_START");
const b = appSrc.indexOf("/* ==== LORA_CORE_END");
assert.ok(a >= 0 && b > a, "找不到 LORA_CORE 標記");
const pureSrc = appSrc.slice(a, b);

const L = new Function(pureSrc + `
return { LORA_DEFAULT_WEIGHT, LORA_UI_MIN, LORA_UI_MAX, LORA_LIMIT,
  loraNorm, loraWeight, loraNameOk, loraDisplay, loraSub, loraCleanTriggers,
  loraParseItems, loraParseState, loraSerialize, loraFind, loraSet, loraRemove,
  loraEnabled, loraSnapshot, loraTokensFromSnapshot, loraApplyToWorkflow, wf,
  loraCleanTriggerList, loraNormGroups, loraCivitaiGroups, loraFingerprint, loraAuthorDefault,
  loraParseAuthor, loraSuggestionCount, loraReminderState, loraAddPlan };`)();

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS " + name); }
  catch (e) { console.error("  FAIL " + name + "\n    " + (e && e.message)); process.exitCode = 1; }
}

// 舊版（0 LoRA）Workflow，逐欄位寫死，任何變動都要讓測試失敗
const baseOpts = {
  ckpt: "WAI-Nsfw-Illustrious-17.safetensors", pos: "masterpiece, 1girl", neg: "worst quality",
  w: 1024, h: 1024, n: 1, seed: 123, steps: 25, cfg: 6, fileTag: "20260101_000000"
};
function legacy() {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: baseOpts.ckpt } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: baseOpts.pos, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: baseOpts.neg, clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "5": { class_type: "KSampler", inputs: {
      model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0],
      seed: 123, steps: 25, cfg: 6,
      sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1 } },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "ui_20260101_000000" } }
  };
}

test("1 零個 LoRA：Workflow 與舊版完全等效", () => {
  const got = L.wf(Object.assign({}, baseOpts, { loras: [] }));
  assert.deepEqual(got, legacy());
  assert.deepEqual(L.wf(Object.assign({}, baseOpts)), legacy(), "沒有 loras 欄位也必須等效");
});

test("2 一個 LoRA：MODEL 與 CLIP 都經 LoraLoader，權重回填", () => {
  const o = Object.assign({}, baseOpts, { loras: [
    { name: "chars\\Miku.safetensors", strength: 0.75 }
  ] });
  const w = L.wf(o);
  assert.equal(w["8"].class_type, "LoraLoader");
  assert.deepEqual(w["8"].inputs.model, ["1", 0]);
  assert.deepEqual(w["8"].inputs.clip, ["1", 1]);
  assert.equal(w["8"].inputs.lora_name, "chars\\Miku.safetensors");
  assert.equal(w["8"].inputs.strength_model, 0.75);
  assert.equal(w["8"].inputs.strength_clip, 0.75);
  assert.deepEqual(w["2"].inputs.clip, ["8", 1], "正面 CLIP 要接到 LoRA");
  assert.deepEqual(w["3"].inputs.clip, ["8", 1], "負面 CLIP 要接到同一條鏈");
  assert.deepEqual(w["5"].inputs.model, ["8", 0], "KSampler 要用 LoRA 的 MODEL");
  assert.deepEqual(w["6"].inputs, { samples: ["5", 0], vae: ["1", 2] }, "VAE / 其他節點不可被改");
  assert.equal(w["7"].inputs.images[0], "6");
});

test("3 三個 LoRA：依加入順序串接，各自權重獨立", () => {
  const loras = [
    { name: "a.safetensors", strength: 0.9 },
    { name: "sub/b.safetensors", strength: 0.55 },
    { name: "sub\\c.safetensors", strength: -0.35 }
  ];
  const w = L.wf(Object.assign({}, baseOpts, { loras }));
  assert.deepEqual(w["8"].inputs.model, ["1", 0]);
  assert.deepEqual(w["8"].inputs.clip, ["1", 1]);
  assert.deepEqual(w["9"].inputs.model, ["8", 0]);
  assert.deepEqual(w["9"].inputs.clip, ["8", 1]);
  assert.deepEqual(w["10"].inputs.model, ["9", 0]);
  assert.deepEqual(w["10"].inputs.clip, ["9", 1]);
  assert.deepEqual(w["5"].inputs.model, ["10", 0]);
  assert.deepEqual(w["2"].inputs.clip, ["10", 1]);
  assert.deepEqual(w["3"].inputs.clip, ["10", 1]);
  assert.deepEqual(loras.map(l => w[String(8 + loras.indexOf(l))].inputs.lora_name), loras.map(l => l.name));
  assert.deepEqual([8, 9, 10].map(i => w[i].inputs.strength_model), [0.9, 0.55, -0.35]);
  assert.deepEqual([8, 9, 10].map(i => w[i].inputs.strength_clip), [0.9, 0.55, -0.35]);
});

test("4 無效資料：單筆跳過、全無效回舊版、連續生成不累積節點", () => {
  const w = L.wf(Object.assign({}, baseOpts, { loras: [
    { name: "../../evil.safetensors", strength: 0.8 },
    { name: "C:\\abs\\x.safetensors", strength: 0.8 },
    { name: "model.pt", strength: 0.8 },
    { name: "", strength: 0.8 },
    { name: "ok.safetensors", strength: "bad" }
  ] }));
  assert.equal(Object.keys(w).length, 8, "只保留一個合法 LoRA");
  assert.equal(w["8"].inputs.lora_name, "ok.safetensors");
  assert.equal(w["8"].inputs.strength_model, L.LORA_DEFAULT_WEIGHT, "無效權重用預設");

  assert.deepEqual(L.wf(Object.assign({}, baseOpts, { loras: [{ name: "x.pt" }] })), legacy());
  assert.deepEqual(L.wf(Object.assign({}, baseOpts, { loras: [] })), legacy());
});

test("5 每次生成都從乾淨 Workflow 開始：先 2 個再 0 個不殘留", () => {
  const two = L.wf(Object.assign({}, baseOpts, { loras: [{ name: "a.safetensors" }, { name: "b.safetensors" }] }));
  assert.ok(two["9"]);
  const zero = L.wf(Object.assign({}, baseOpts, { loras: [] }));
  assert.deepEqual(zero, legacy(), "LoRA 節點不可累積");
  const one = L.wf(Object.assign({}, baseOpts, { loras: [{ name: "a.safetensors" }] }));
  assert.equal(one["8"].inputs.lora_name, "a.safetensors");
  assert.equal(one["9"], undefined);
});

test("6 觸發詞去重：大小寫、底線、多餘空白都視為同一個", () => {
  assert.deepEqual(
    L.loraCleanTriggers(["Miku", "miku", "long_hair", " long  hair ", "blue eyes", "blue eyes"]),
    ["Miku", "long_hair", "blue eyes"]
  );
  assert.deepEqual(L.loraCleanTriggers(["", "   ", null, 123]), ["123"]);
  assert.equal(L.loraCleanTriggers(Array.from({ length: 60 }, (_, i) => "t" + i)).length, 40);
});

test("7 Snapshot：完整保存設定，autoTrigger 只影響是否加入 Prompt", () => {
  const items = L.loraParseItems({ items: [
    { name: "a.safetensors", strength: 0.7, triggers: ["miku"], enabled: true },
    { name: "b.safetensors", strength: 0.9, triggers: ["miku", "red_hair"], autoTrigger: false, enabled: true },
    { name: "c.safetensors", strength: 1.2, triggers: ["blue eyes"], enabled: false }
  ] });
  assert.deepEqual(items.map(x => x.name), ["a.safetensors", "b.safetensors", "c.safetensors"]);
  const snap = L.loraSnapshot(items);
  assert.deepEqual(snap.map(x => x.name), ["a.safetensors", "b.safetensors"], "未啟用的不進 Workflow");
  assert.deepEqual(snap[1].personalTriggers, ["miku", "red_hair"], "autoTrigger=false 仍須完整保存觸發詞");
  assert.equal(snap[0].autoTrigger, true);
  assert.equal(snap[1].autoTrigger, false);
  assert.deepEqual(L.loraTokensFromSnapshot(snap), ["miku"], "關閉自動加入的 LoRA 不進 Prompt");
  assert.equal(L.loraEnabled(items).length, 2);
});

test("8 觸發詞跨 LoRA 去重且順序穩定；只處理自動加入的 LoRA", () => {
  const snap = [
    { name: "a.safetensors", triggers: ["Miku", "blue eyes"], autoTrigger: true },
    { name: "b.safetensors", triggers: ["miku", "long_hair", "blue_eyes"], autoTrigger: true },
    { name: "c.safetensors", triggers: ["miku", "off only"], autoTrigger: false }
  ];
  assert.deepEqual(L.loraTokensFromSnapshot(snap), ["Miku", "blue eyes", "long_hair"]);
  assert.ok(!L.loraTokensFromSnapshot(snap).includes("off only"), "關閉自動加入的觸發詞不可出現在 Prompt");
});

test("9 讀入損壞資料：安全回退、保留可用項目、名稱去重", () => {
  assert.deepEqual(L.loraParseItems(null), []);
  assert.deepEqual(L.loraParseItems("bad"), []);
  assert.deepEqual(L.loraParseItems({ items: "bad" }), []);
  assert.deepEqual(L.loraParseItems({ items: [null, 3, {}, { name: "" }] }), []);
  const items = L.loraParseItems({ items: [
    { name: "ok.safetensors", strength: "x", triggers: "bad", enabled: "yes" },
    { name: "OK.safetensors", strength: 2 },
    { name: "noext" }
  ] });
  assert.equal(items.length, 1);
  assert.equal(items[0].strength, 0.8);
  assert.deepEqual(items[0].triggers, []);
  assert.equal(items[0].enabled, true);
  assert.equal(items[0].display, "ok");
});

test("10 權重驗證與範圍：不窄限、不讓 NaN 進 Workflow", () => {
  assert.equal(L.loraWeight(0.85), 0.85);
  assert.equal(L.loraWeight("1.25"), 1.25);
  assert.equal(L.loraWeight("abc"), 0.8);
  assert.equal(L.loraWeight(NaN), 0.8);
  assert.equal(L.loraWeight(Infinity), 0.8);
  assert.equal(L.loraWeight(999), 100);
  assert.equal(L.loraWeight(-999), -100);
  assert.equal(L.loraWeight(0.833), 0.83);
  assert.equal(L.LORA_UI_MIN, -2);
  assert.equal(L.LORA_UI_MAX, 2);
});

test("11 名稱安全：不可絕對路徑、不可跳脫、只收 .safetensors", () => {
  assert.equal(L.loraNameOk("chars\\Miku.safetensors"), true);
  assert.equal(L.loraNameOk("style/sub/a.SAFETENSORS"), true);
  assert.equal(L.loraNameOk("../a.safetensors"), false);
  assert.equal(L.loraNameOk("a/../../b.safetensors"), false);
  assert.equal(L.loraNameOk("C:\\a.safetensors"), false);
  assert.equal(L.loraNameOk("/a.safetensors"), false);
  assert.equal(L.loraNameOk("a.ckpt"), false);
  assert.equal(L.loraNameOk("a.safetensors\0x"), false);
  assert.equal(L.loraDisplay("style\\Miku.safetensors"), "Miku");
  assert.equal(L.loraSub("style\\Miku.safetensors"), "style");
  assert.equal(L.loraSub("Miku.safetensors"), "");
});

test("12 選取／取消／移除：不改動其他 LoRA，取消後仍保留觸發詞設定", () => {
  let items = L.loraSet([], "a.safetensors", { enabled: true, strength: 0.7 });
  assert.equal(items.length, 1);
  assert.equal(items[0].enabled, true);
  items = L.loraSet(items, "a.safetensors", { triggers: ["miku"] });
  items = L.loraSet(items, "a.safetensors", { enabled: false });
  assert.equal(items[0].enabled, false);
  assert.deepEqual(items[0].triggers, ["miku"], "取消選取不可清掉設定");
  assert.equal(items[0].strength, 0.7, "取消選取不可重設權重");
  items = L.loraSet(items, "B.safetensors", { enabled: true });
  assert.deepEqual(items.map(x => x.name), ["a.safetensors", "B.safetensors"]);
  const removed = L.loraRemove(items, "A.safetensors");
  assert.deepEqual(removed.map(x => x.name), ["B.safetensors"], "比對不分大小寫");
});

test("13 序列化往返：資料可保存、重新載入結果一致", () => {
  const items = L.loraParseItems({ items: [
    { name: "chars\\Miku.safetensors", display: "Miku", strength: 0.65, triggers: ["miku", "Miku"], autoTrigger: true, enabled: true }
  ] });
  const round = L.loraParseState(JSON.parse(JSON.stringify(L.loraSerialize(items))));
  assert.equal(round.v, 2);
  assert.deepEqual(round.items, [{
    name: "chars\\Miku.safetensors", display: "Miku", strength: 0.65,
    triggers: ["miku"], autoTrigger: true, enabled: true,
    authorSuggestions: L.loraAuthorDefault(), noTriggerNeeded: false,
    adoptionRecords: []
  }]);
});

test("14 未來擴充：strengthModel / strengthClip 可分別指定", () => {
  const w = L.wf(Object.assign({}, baseOpts, { loras: [
    { name: "a.safetensors", strength: 0.8, strengthModel: 0.6, strengthClip: 1.1 }
  ] }));
  assert.equal(w["8"].inputs.strength_model, 0.6);
  assert.equal(w["8"].inputs.strength_clip, 1.1);
});

test("15 舊快照相容：沒有 autoTrigger 欄位時視為啟用", () => {
  const snap = [
    { name: "a.safetensors", triggers: ["miku"] },
    { name: "b.safetensors", triggers: ["miku", "old_tag"] }
  ];
  assert.deepEqual(L.loraTokensFromSnapshot(snap), ["miku", "old_tag"]);
  assert.deepEqual(L.loraTokensFromSnapshot([{ name: "c.safetensors", triggers: "not-array" }]), []);
  assert.deepEqual(L.loraTokensFromSnapshot([null]), []);
});

test("16 序列化往返：關閉自動加入後觸發詞仍完整保存", () => {
  const items = L.loraParseItems({ items: [{
    name: "chars\\Miku.safetensors", display: "Miku", strength: 0.65,
    triggers: ["miku", "red eyes"], autoTrigger: false, enabled: true
  }] });
  const round = L.loraParseState(JSON.parse(JSON.stringify(L.loraSerialize(items))));
  assert.deepEqual(round.items[0].triggers, ["miku", "red eyes"]);
  assert.equal(round.items[0].autoTrigger, false);
  const snap = L.loraSnapshot(round.items);
  assert.deepEqual(snap[0].personalTriggers, ["miku", "red eyes"], "歷史快照不可因 autoTrigger=false 丟掉觸發詞");
  assert.equal(snap[0].autoTrigger, false);
  assert.deepEqual(L.loraTokensFromSnapshot(snap), [], "還原後仍不把觸發詞放進 Prompt");
});

test("17 快照職責分離：triggers 保存、autoTrigger 才決定 Prompt", () => {
  const make = autoTrigger => L.loraSnapshot(L.loraParseItems({ items: [
    { name: "a.safetensors", triggers: ["m", "n"], autoTrigger }
  ] }));
  const on = make(true), off = make(false);
  assert.deepEqual(on[0].personalTriggers, ["m", "n"]);
  assert.deepEqual(off[0].personalTriggers, ["m", "n"], "關閉自動加入仍須保存觸發詞");
  assert.deepEqual(L.loraTokensFromSnapshot(on), ["m", "n"]);
  assert.deepEqual(L.loraTokensFromSnapshot(off), []);
});

test("18 舊資料解析：新欄位有安全預設，不影響既有資料", () => {
  const items = L.loraParseItems({ items: [{ name: "old.safetensors", triggers: ["miku"] }] });
  assert.deepEqual(items[0].authorSuggestions, L.loraAuthorDefault());
  assert.equal(items[0].noTriggerNeeded, false);
  assert.deepEqual(items[0].triggers, ["miku"]);
});

test("19 序列化往返：本機與 Civitai 建議同時保留，個人詞不被覆蓋", () => {
  const raw = { items: [{
    name: "a.safetensors", triggers: ["mine"], autoTrigger: true, enabled: true,
    noTriggerNeeded: false,
    authorSuggestions: {
      local: { groups: [["miku", "hatsune miku"]] },
      civitai: { versionId: 3276795, groups: [["amora", "blonde hair"], ["cleavage"]],
                 fetchedAt: 1700000000000, fingerprint: "fp1" }
    }
  }] };
  const round = L.loraParseState(JSON.parse(JSON.stringify(L.loraSerialize(L.loraParseItems(raw)))));
  const it = round.items[0];
  assert.deepEqual(it.triggers, ["mine"], "個人詞不變");
  assert.deepEqual(it.authorSuggestions.local.groups, [["miku", "hatsune miku"]]);
  assert.deepEqual(it.authorSuggestions.civitai.groups, [["amora", "blonde hair"], ["cleavage"]]);
  assert.equal(it.authorSuggestions.civitai.versionId, 3276795);
  assert.equal(it.authorSuggestions.civitai.fingerprint, "fp1");
  assert.equal(L.loraSuggestionCount(it), 5);
});

test("20 trainedWords 正規化：雙逗號／空白／重複／壞型別都安全", () => {
  assert.deepEqual(L.loraCivitaiGroups(null), []);
  assert.deepEqual(L.loraCivitaiGroups("not an array"), []);
  const groups = L.loraCivitaiGroups([
    "amora,  blonde hair,, long_hair , blue eyes,amora",
    123, "", "   ", "cleavage, black dress"
  ]);
  assert.deepEqual(groups, [
    ["amora", "blonde hair", "long_hair", "blue eyes"],
    ["cleavage", "black dress"]
  ]);
  assert.deepEqual(L.loraNormGroups([[" A ", "a", 5], "bad", ["B"]]), [["A"], ["B"]]);
  assert.deepEqual(L.loraCivitaiGroups([",,,", ",, "]), [], "空群組不可造成空白建議");
});

test("21 fingerprint 只辨識建議內容；個人 triggers 不受更新影響", () => {
  const g1 = [["amora", "blonde hair"]], g2 = [["amora", "red hair"]];
  assert.equal(L.loraFingerprint(g1, 3276795), L.loraFingerprint(g1, 3276795));
  assert.notEqual(L.loraFingerprint(g1, 3276795), L.loraFingerprint(g2, 3276795));
  assert.notEqual(L.loraFingerprint(g1, 3276795), L.loraFingerprint(g1, 3276796));
  let items = L.loraParseItems({ items: [{ name: "a.safetensors", triggers: ["mine"], authorSuggestions: {
    local: { groups: [["local"]] },
    civitai: { versionId: 1, groups: g1, fingerprint: "old" }
  } }] });
  items = L.loraSet(items, "a.safetensors", { authorSuggestions: {
    local: items[0].authorSuggestions.local,
    civitai: { versionId: 1, groups: g2, fetchedAt: 2, fingerprint: "new" }
  }});
  assert.deepEqual(items[0].triggers, ["mine"], "metadata 更新不可動個人詞");
  assert.deepEqual(items[0].authorSuggestions.local.groups, [["local"]], "不可清掉本機建議");
  assert.equal(items[0].authorSuggestions.civitai.fingerprint, "new");
});

test("22 快照只帶個人 noTriggerNeeded；作者建議永不進 Prompt", () => {
  const items = L.loraParseItems({ items: [{ name: "a.safetensors", triggers: ["mine"],
    noTriggerNeeded: true, autoTrigger: true,
    authorSuggestions: { local: { groups: [["local word"]] },
      civitai: { versionId: 2, groups: [["civitai word"]] } } }] });
  const snap = L.loraSnapshot(items);
  assert.equal(snap[0].noTriggerNeeded, true);
  assert.equal(snap[0].authorSuggestions, undefined, "作者建議是最新 metadata，不進歷史");
  assert.deepEqual(L.loraTokensFromSnapshot(snap), ["mine"], "只有個人詞會注入");
});

test("23 提醒狀態：已確認 / 關閉自動 / 有建議 / 完全沒有", () => {
  assert.equal(L.loraReminderState({ noTriggerNeeded: true }, 0), "none");
  assert.equal(L.loraReminderState({ triggers: ["m"], autoTrigger: false }, 0), "autoOff");
  assert.equal(L.loraReminderState({ triggers: ["m"], autoTrigger: true }, 2), "hasSuggestions");
  assert.equal(L.loraReminderState({ triggers: ["m"], autoTrigger: true }, 0), "none");
  assert.equal(L.loraReminderState({ triggers: [], noTriggerNeeded: false }, 0), "missing");
  assert.equal(L.loraReminderState({ triggers: [], noTriggerNeeded: false }, 3), "hasSuggestions");
  assert.equal(L.loraReminderState({ enabled: false }, 0), "none");
});

test("24 loraSet 局部更新：改作者建議不會清掉個人欄位", () => {
  let items = L.loraParseItems({ items: [{ name: "a.safetensors", triggers: ["mine"],
    autoTrigger: false, noTriggerNeeded: true, enabled: true }] });
  items = L.loraSet(items, "a.safetensors", { authorSuggestions: {
    local: { groups: [["x"]] }, civitai: { versionId: 5, groups: [], fetchedAt: null, fingerprint: null }
  }});
  assert.deepEqual(items[0].triggers, ["mine"]);
  assert.equal(items[0].autoTrigger, false);
  assert.equal(items[0].noTriggerNeeded, true);
  assert.equal(items[0].enabled, true);
  assert.equal(items[0].authorSuggestions.civitai.versionId, 5);
});

test("25 加入數量：目前 0 詞，加入 5 詞全部成功", () => {
  const p = L.loraAddPlan([], ["a", "b", "c", "d", "e"]);
  assert.equal(p.added, 5);
  assert.equal(p.skipped, 0);
  assert.equal(p.next.length, 5);
  assert.equal(p.added, p.next.length - 0, "回報數量必須等於保存差值");
});

test("26 加入數量：目前 38 詞，加入 5 詞只進 2 個", () => {
  const cur = Array.from({ length: 38 }, (_, i) => "old" + i);
  const p = L.loraAddPlan(cur, ["n1", "n2", "n3", "n4", "n5"]);
  assert.equal(p.room, 2);
  assert.equal(p.added, 2);
  assert.equal(p.skipped, 3);
  assert.equal(p.next.length, 40, "不得超過既有 40 詞上限");
  assert.equal(p.added, p.next.length - cur.length);
  assert.deepEqual(p.next.slice(0, 38), cur, "原有順序不可變");
});

test("27 加入數量：目前 40 詞，再加入不顯示成功", () => {
  const cur = Array.from({ length: 40 }, (_, i) => "old" + i);
  const p = L.loraAddPlan(cur, ["new"]);
  assert.equal(p.room, 0);
  assert.equal(p.added, 0);
  assert.equal(p.skipped, 1);
  assert.deepEqual(p.next, cur, "已滿時不可改動任何內容");
});

test("28 加入數量：內容全部重複，added 為 0 且不清空", () => {
  const cur = ["miku", "blue eyes"];
  const p = L.loraAddPlan(cur, ["MIKU", "blue_eyes", "miku"]);
  assert.equal(p.duplicates, 2, "先做群組內去重，再計與個人詞重複的數量");
  assert.equal(p.added, 0);
  assert.equal(p.skipped, 0);
  assert.deepEqual(p.next, cur);
});

test("29 加入數量：部分重複且容量不足，回報與保存一致", () => {
  const cur = Array.from({ length: 39 }, (_, i) => "old" + i);
  const p = L.loraAddPlan(cur, ["old0", "fresh1", "fresh2"]);
  assert.equal(p.room, 1);
  assert.equal(p.added, 1);
  assert.equal(p.skipped, 1);
  assert.equal(p.duplicates, 1);
  assert.equal(p.next.length, 40);
  assert.equal(p.added, p.next.length - cur.length);
  assert.equal(p.next[39], "fresh1", "只加入可容納的第一個新詞");
});

// ── 第二輪審查：>40 個作者建議詞的統計 ───────────────────────
test("30 輸入 45 個不同詞、個人詞 0：added 40、skipped 5", () => {
  const words = Array.from({ length: 45 }, (_, i) => "new" + i);
  const p = L.loraAddPlan([], words);
  assert.equal(p.added, 40);
  assert.equal(p.skipped, 5);
  assert.equal(p.next.length, 40);
  assert.equal(p.added, p.next.length - 0);
  assert.equal(L.loraCleanTriggerList(words).length, 45, "清理函式不得先截斷");
  assert.equal(L.loraCleanTriggers(words).length, 40, "個人詞上限仍為 40");
});

test("31 輸入 45 個不同詞、個人詞已有 38：added 2、skipped 43，原順序不變", () => {
  const cur = Array.from({ length: 38 }, (_, i) => "old" + i);
  const words = Array.from({ length: 45 }, (_, i) => "new" + i);
  const p = L.loraAddPlan(cur, words);
  assert.equal(p.room, 2);
  assert.equal(p.added, 2);
  assert.equal(p.skipped, 43);
  assert.equal(p.next.length, 40);
  assert.equal(p.added, p.next.length - cur.length);
  assert.deepEqual(p.next.slice(0, 38), cur, "原有 38 詞與順序完全不變");
  assert.deepEqual(p.next.slice(38), ["new0", "new1"]);
});

test("32 兩組各 30 個不同詞合併（全部加入）：保存 40、明確統計 20 未加入", () => {
  const g1 = Array.from({ length: 30 }, (_, i) => "g1_" + i);
  const g2 = Array.from({ length: 30 }, (_, i) => "g2_" + i);
  const p = L.loraAddPlan([], g1.concat(g2));
  assert.equal(p.next.length, 40);
  assert.equal(p.added, 40);
  assert.equal(p.skipped, 20, "不可靜默遺失 20 個詞");
  assert.equal(p.added, p.next.length - 0);
  assert.deepEqual(p.next.slice(0, 30), g1, "先加入第一組，順序不變");
  assert.deepEqual(p.next.slice(30), g2.slice(0, 10));
});

test("33 超過 40 且含重複詞：重複不計 skipped，只算唯一新詞", () => {
  const cur = ["e0"];
  // 45 項：1 個與個人詞重複、2 個群組內重複、42 個唯一新詞
  const words = ["e0"].concat(
    Array.from({ length: 42 }, (_, i) => "n" + i), ["n0", "n1"]
  );
  const p = L.loraAddPlan(cur, words);
  assert.equal(p.duplicates, 1, "與個人詞重複的只有 e0；群組內重複先被清理");
  assert.equal(p.added, 39);
  assert.equal(p.skipped, 3, "只有 n39/n40/n41 這三個唯一新詞因容量不足未加入");
  assert.equal(p.next.length, 40);
  assert.equal(p.added, p.next.length - cur.length);
  assert.deepEqual(p.next.slice(0, 1), cur, "原有詞不變");
  assert.equal(p.next.filter(t => t === "n0").length, 1, "重複詞不可重複加入");
});

test("34 v1→v2 migration follows M1–M8 and distinguishes missing from empty", () => {
  const m1 = L.loraParseState({ v: 2, items: [{ name: "a.safetensors", personalTriggers: ["mine"] }] });
  assert.deepEqual(m1.items[0].adoptionRecords, []);
  assert.equal(m1.migration.reason, "field-missing-v2");
  assert.equal(m1.migration.needsWrite, true);

  const m2 = L.loraParseState({ v: 2, items: [{ name: "b.safetensors", personalTriggers: [], adoptionRecords: [] }] });
  assert.deepEqual(m2.items[0].triggers, []);
  assert.equal(m2.migration.backups.length, 0);

  const m3 = L.loraParseState({ v: 2, items: [{ name: "c.safetensors", personalTriggers: ["mine"], adoptionRecords: "bad" }] });
  assert.deepEqual(m3.items[0].triggers, ["mine"], "壞 adoptionRecords 不影響 personalTriggers");
  assert.equal(m3.migration.quarantine.length, 1);
  assert.equal(m3.migration.backups[0].reason, "type-error");

  const m4 = L.loraParseState({ v: 1, items: [{ name: "d.safetensors", triggers: ["a", "b"], personalTriggers: ["a", "b"], adoptionRecords: [] }] });
  assert.deepEqual(m4.items[0].triggers, ["a", "b"]);

  const m5 = L.loraParseState({ v: 2, items: [{ name: "e.safetensors", triggers: ["v1", "same", "v2"], personalTriggers: ["same", "v2"], adoptionRecords: [] }] });
  assert.deepEqual(m5.items[0].triggers, ["same", "v2", "v1"]);
  assert.equal(m5.migration.backups[0].reason, "dual-conflict");
  assert.equal(m5.migration.backups[0].itemName, "e.safetensors");

  const m6 = L.loraParseState({ v: 2, items: [{ name: "f.safetensors", triggers: ["old"], personalTriggers: [], adoptionRecords: [] }] });
  assert.deepEqual(m6.items[0].triggers, []);
  assert.equal(m6.migration.backups[0].reason, "v1-data-v2-empty");
  assert.deepEqual(m6.migration.backups[0].payload.value.triggers, ["old"]);

  const m7 = L.loraParseState({ v: 2, items: [{ name: "g.safetensors", personalTriggers: ["new"], adoptionRecords: [] }] });
  assert.deepEqual(m7.items[0].triggers, ["new"]);

  const m8 = L.loraParseState({ v: 1, items: [{ name: "valid.safetensors", triggers: ["ok"] }, { name: "../bad.safetensors", triggers: ["lost"] }] });
  assert.equal(m8.items.length, 1);
  assert.equal(m8.migration.quarantine.length, 1);
  assert.equal(m8.migration.backups[0].payload.value.name, "../bad.safetensors");
  const saved = L.loraSerialize(m8.items);
  assert.equal(saved.v, 2);
  assert.deepEqual(saved.items[0].personalTriggers, ["ok"]);
  assert.deepEqual(saved.items[0].adoptionRecords, []);
});

console.log(passed + " tests passed" + (process.exitCode ? "（有失敗）" : ""));
