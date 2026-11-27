// lora_explorer_core_test.mjs — LoRA 探索中心純資料層測試
// 從 app.js 擷取 CIVITAI_CORE 區塊，不開瀏覽器、不連 Civitai。
// 執行：node devtools/lora_explorer_core_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const a = src.indexOf("/* ==== CIVITAI_CORE_START");
const b = src.indexOf("/* ==== CIVITAI_CORE_END");
assert.ok(a >= 0 && b > a, "找不到 CIVITAI_CORE 標記");
const C = new Function(src.slice(a, b) + `
return { CV_LEVELS, cvText, cvClassify, cvBestVersionInfo, cvBestVersion, cvImageSafety, cvSortItems, cvStatusKey, cvVersionUrl };`)();

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS " + name); }
  catch (e) { console.error("  FAIL " + name + "\n    " + e.message); process.exitCode = 1; }
}

const lv = (base, type, ckpt) => C.cvClassify(base, type, ckpt);

test("1 Illustrious Standard → 完全適配", () => {
  const r = lv("Illustrious", "Standard", "Illustrious");
  assert.equal(r.key, "exact"); assert.equal(r.level, 0);
});
test("2 Illustrious 非 Standard → 需要確認", () => {
  for (const t of ["Inpainting", "Refiner", "Pix2Pix", "Other", null, ""]) {
    const r = lv("Illustrious", t, "Illustrious");
    assert.equal(r.key, "review", "type=" + t + " → " + r.key);
    assert.equal(r.level, 1);
  }
});
test("3 NoobAI / SDXL 1.0 / SDXL Turbo → 需要確認（已知基底）", () => {
  for (const base of ["NoobAI", "SDXL 1.0", "SDXL 1.0 LCM", "SDXL Turbo"]) {
    const r = lv(base, "Standard", "Illustrious");
    assert.equal(r.key, "review", base + " → " + r.key);
    assert.equal(r.level, 1);
  }
});
test("4 Pony / SD1.5 / Flux → 不建議", () => {
  for (const base of ["Pony", "Pony V7", "SD 1.5", "SD 2.1", "SD 3.5", "Flux.1 D", "Flux.2 D"]) {
    const r = lv(base, "Standard", "Illustrious");
    assert.equal(r.key, "bad", base + " → " + r.key);
    assert.equal(r.level, 3);
  }
});
test("5 Other / 未知值 / 缺少 baseModel → 需要確認（未知基底）", () => {
  for (const base of ["Other", "SomeNewBase", "", null, undefined]) {
    const r = lv(base, "Standard", "Illustrious");
    assert.equal(r.key, "unknown", base + " → " + r.key);
    assert.equal(r.level, 2);
  }
});
test("6 Checkpoint 未知時，任何版本都不能完全適配", () => {
  for (const base of ["Illustrious", "NoobAI", "SDXL 1.0", "Pony", null]) {
    const r = lv(base, "Standard", null);
    assert.equal(r.key, "unknown", base + " → " + r.key);
    assert.equal(r.level, 2);
    assert.ok(!r.label.includes("完全"));
  }
});
test("7 非 Illustrious Checkpoint：不可套用 Illustrious 的不建議清單", () => {
  // Pony / SD 1.5 / NoobAI Checkpoint 配相同基底 LoRA，最多只能「需要確認」
  for (const [base, ckpt] of [["Pony", "Pony"], ["SD 1.5", "SD 1.5"], ["NoobAI", "NoobAI"]]) {
    const r = lv(base, "Standard", ckpt);
    assert.equal(r.key, "review", base + " + " + ckpt + " → " + r.key);
    assert.equal(r.level, 1);
    assert.notEqual(r.key, "bad");
  }
  // 非 Illustrious Checkpoint 下，Pony / SD / Flux LoRA 也不能直接被判不建議
  for (const base of ["Pony", "SD 1.5", "Flux.1 D"]) {
    const r = lv(base, "Standard", "NoobAI");
    assert.notEqual(r.key, "bad", base + " 在 NoobAI Checkpoint 下被誤判 bad");
  }
  assert.equal(lv("Illustrious", "Standard", "Pony").key, "unknown");
  assert.equal(lv("Other", "Standard", "Pony").key, "unknown");
});
test("7b Illustrious Checkpoint 的既有規則完全不變", () => {
  assert.equal(lv("Illustrious", "Standard", "Illustrious").key, "exact");
  assert.equal(lv("Illustrious", "Inpainting", "Illustrious").key, "review");
  assert.equal(lv("NoobAI", "Standard", "Illustrious").key, "review");
  assert.equal(lv("SDXL 1.0", "Standard", "Illustrious").key, "review");
  assert.equal(lv("Pony", "Standard", "Illustrious").key, "bad");
  assert.equal(lv("SD 1.5", "Standard", "Illustrious").key, "bad");
  assert.equal(lv("Flux.1 D", "Standard", "Illustrious").key, "bad");
  assert.equal(lv("Other", "Standard", "Illustrious").key, "unknown");
  assert.equal(lv(null, null, "Illustrious").key, "unknown");
});
test("7c 未知 Checkpoint 的保守規則完全不變", () => {
  for (const base of ["Illustrious", "Pony", "SD 1.5", "Flux.1 D", null]) {
    const r = lv(base, "Standard", null);
    assert.equal(r.key, "unknown");
    assert.equal(r.level, 2);
  }
});
test("8 多版本混合基底：卡片取最佳（最適合）版本", () => {
  const versions = [
    { baseModel: "Pony", baseModelType: "Standard" },
    { baseModel: "Illustrious", baseModelType: "Standard" },
    { baseModel: "SD 1.5", baseModelType: "Standard" }
  ];
  assert.equal(C.cvBestVersion(versions, "Illustrious").key, "exact");
  assert.equal(C.cvBestVersion(versions, null).key, "unknown");
  assert.equal(C.cvBestVersion([], "Illustrious").key, "unknown");
});
test("9 Strict 排序：完全 → 需要確認 → 未知 → 不建議，同級保持原順序", () => {
  const items = [
    { id: "bad", versions: [{ baseModel: "Pony", baseModelType: "Standard" }] },
    { id: "review-b", versions: [{ baseModel: "NoobAI", baseModelType: "Standard" }] },
    { id: "unknown", versions: [{ baseModel: "Other", baseModelType: "Standard" }] },
    { id: "exact", versions: [{ baseModel: "Illustrious", baseModelType: "Standard" }] },
    { id: "review-a", versions: [{ baseModel: "SDXL 1.0", baseModelType: "Standard" }] }
  ];
  assert.deepEqual(C.cvSortItems(items, "Illustrious").map(x => x.id),
    ["exact", "review-b", "review-a", "unknown", "bad"]);
});
test("10 排序不改動原陣列；缺少 versions 視為未知", () => {
  const items = [{ id: 1 }, { id: 2, versions: [{ baseModel: "Illustrious", baseModelType: "Standard" }] }];
  const sorted = C.cvSortItems(items, "Illustrious");
  assert.deepEqual(items.map(x => x.id), [1, 2]);
  assert.deepEqual(sorted.map(x => x.id), [2, 1]);
});
test("11 Checkpoint cache key 與版本連結", () => {
  assert.equal(C.cvStatusKey(" WAI-Illustrious.safetensors "), "wai-illustrious.safetensors");
  assert.equal(C.cvVersionUrl(827184, 2883731),
    "https://civitai.com/models/827184?modelVersionId=2883731");
});
test("12 真實案例 43820：同作品三版本各自分類", () => {
  const versions = [
    { id: 1352325, baseModel: "Illustrious", baseModelType: "Standard" },
    { id: 356467, baseModel: "Pony", baseModelType: "Standard" },
    { id: 121559, baseModel: "SD 1.5", baseModelType: "Standard" }
  ];
  assert.deepEqual(versions.map(v => C.cvClassify(v.baseModel, v.baseModelType, "Illustrious").key),
    ["exact", "bad", "bad"]);
  assert.equal(C.cvBestVersion(versions, "Illustrious").key, "exact");
});

test("13 最佳版本 helper：版本物件／索引／分類三者一致", () => {
  const versions = [
    { id: 11, baseModel: "Pony", baseModelType: "Standard", images: [{ id: 1 }] },
    { id: 22, baseModel: "Illustrious", baseModelType: "Standard", images: [{ id: 2 }] },
    { id: 33, baseModel: "SD 1.5", baseModelType: "Standard", images: [{ id: 3 }] }
  ];
  const info = C.cvBestVersionInfo(versions, "Illustrious");
  assert.equal(info.index, 1);
  assert.equal(info.version, versions[1]);
  assert.equal(info.cls.key, "exact");
  assert.equal(info.cls.key, C.cvBestVersion(versions, "Illustrious").key);
  assert.deepEqual(info.version.images.map(x => x.id), [2]);
});
test("14 同級版本保持穩定順序（不被圖片或其他版本取代）", () => {
  const versions = [
    { id: 1, baseModel: "Illustrious", baseModelType: "Standard", images: [{ id: 101 }] },
    { id: 2, baseModel: "Illustrious", baseModelType: "Standard", images: [{ id: 102 }] },
    { id: 3, baseModel: "NoobAI", baseModelType: "Standard", images: [{ id: 103 }] }
  ];
  const info = C.cvBestVersionInfo(versions, "Illustrious");
  assert.equal(info.index, 0);
  assert.equal(info.version.id, 1);
  assert.equal(info.cls.key, "exact");
});
test("15 沒有版本／沒有圖片時回空版本，不明確指向別的版本", () => {
  const empty = C.cvBestVersionInfo([], "Illustrious");
  assert.equal(empty.version, null);
  assert.equal(empty.index, -1);
  assert.equal(empty.cls.key, "unknown");
  const noImages = C.cvBestVersionInfo([
    { id: 1, baseModel: "Illustrious", baseModelType: "Standard" }
  ], "Illustrious");
  assert.equal(noImages.version.id, 1);
  assert.equal(noImages.cls.key, "exact");
});
test("16 未知 Checkpoint 時最佳版本仍保守：只回 unknown", () => {
  const versions = [
    { id: 1, baseModel: "Illustrious", baseModelType: "Standard", images: [{ id: 1 }] },
    { id: 2, baseModel: "Pony", baseModelType: "Standard", images: [{ id: 2 }] }
  ];
  const info = C.cvBestVersionInfo(versions, null);
  assert.equal(info.index, 0);
  assert.equal(info.cls.key, "unknown");
  assert.equal(info.cls.level, 2);
});

test("17 cvImageSafety：真實形狀公開圖片在成熟內容關閉時可見", () => {
  const safe = { url: "https://image.civitai.com/a/original=true/1.jpeg", publicSafe: true, mature: false, unknown: false, nsfwLevel: 1 };
  assert.equal(C.cvImageSafety(safe, { nsfw: false }, false), true);
  assert.equal(C.cvImageSafety(safe, { nsfw: false }, true), true);
});
test("18 cvImageSafety：成熟／未知／模型層級 nsfw 在關閉時都受保護", () => {
  const mature = { publicSafe: false, mature: true, unknown: false };
  const unknown = { publicSafe: false, mature: false, unknown: true };
  const safe = { publicSafe: true, mature: false, unknown: false };
  assert.equal(C.cvImageSafety(mature, { nsfw: false }, false), false);
  assert.equal(C.cvImageSafety(unknown, { nsfw: false }, false), false);
  assert.equal(C.cvImageSafety(safe, { nsfw: true }, false), false, "模型層級 nsfw 保護不可消失");
  // 既有行為：成熟模式顯示全部
  assert.equal(C.cvImageSafety(mature, { nsfw: false }, true), true);
  assert.equal(C.cvImageSafety(unknown, { nsfw: false }, true), true);
});
test("19 cvImageSafety：null 與缺少 publicSafe 的圖片不公開", () => {
  assert.equal(C.cvImageSafety(null, null, false), false);
  assert.equal(C.cvImageSafety({ mature: false, unknown: false }, null, false), false);
});

console.log(passed + " tests passed" + (process.exitCode ? "（有失敗）" : ""));
