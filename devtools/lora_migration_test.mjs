import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const a = app.indexOf("/* ==== LORA_CORE_START");
const b = app.indexOf("/* ==== LORA_CORE_END", a);
assert.ok(a >= 0 && b > a, "actual LoRA parser block is available");
const L = new Function(app.slice(a, b) + `return { loraParseState, loraSerialize, loraNorm, loraCleanTriggers };`)();
let serial = 1;
const context = { crypto: { randomUUID() {
  const tail = String(serial++).padStart(12, "0");
  return `00000000-0000-4000-8000-${tail}`;
} } };
context.window = context;
vm.runInNewContext(fs.readFileSync(path.join(root, "lora_migration.js"), "utf8"), context);
const M = context.LoraMigration;
const promptContext = {};
promptContext.window = promptContext;
vm.runInNewContext(fs.readFileSync(path.join(root, "prompt_core.js"), "utf8"), promptContext);

class Store {
  constructor(seed = {}) { this.map = new Map(Object.entries(seed)); this.failKey = null; this.failCount = 0; this.mismatch = null; this.mismatchCount = null; this.writes = []; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    this.writes.push(k);
    if (this.failKey === k && this.failCount > 0) { this.failCount--; throw Object.assign(new Error("blocked"), { name: "QuotaExceededError", code: 22 }); }
    if (this.mismatch === k && (this.mismatchCount === null || this.mismatchCount > 0)) {
      if (this.mismatchCount !== null) this.mismatchCount--;
      this.map.set(k, "{}");
    } else this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
}
const run = store => M.readAndMigrate(store, L.loraParseState, L.loraSerialize);
const readBackup = store => JSON.parse(store.getItem(M.keys.backup));
const rawOf = value => JSON.stringify(value);
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.error("FAIL " + name + "\n  " + (e && e.stack || e)); }
}

test("M1/M2 transaction: v1 converts, missing v2 adoptionRecords gets [], effective empty stays empty", () => {
  const store = new Store({ "ui.loras": rawOf({ v: 1, items: [{ name: "a.safetensors", triggers: ["old"], enabled: true }] }) });
  const first = run(store);
  assert.equal(first.migrated, true);
  assert.deepEqual(JSON.parse(store.getItem("ui.loras")).items[0].personalTriggers, ["old"]);
  assert.deepEqual(JSON.parse(store.getItem("ui.loras")).items[0].adoptionRecords, []);
  assert.equal(store.getItem(M.keys.backup), null, "lossless ordinary conversion does not invent partial-failure backup");
  const validEmpty = new Store({ "ui.loras": rawOf({ v: 2, items: [{ name: "b.safetensors", personalTriggers: [], adoptionRecords: [] }] }) });
  const empty = run(validEmpty);
  assert.equal(empty.migrated, false);
  assert.deepEqual(empty.state.items[0].triggers, []);
  const missing = new Store({ "ui.loras": rawOf({ v: 2, items: [{ name: "c.safetensors", personalTriggers: ["kept"] }] }) });
  assert.equal(run(missing).migrated, true);
  assert.deepEqual(JSON.parse(missing.getItem("ui.loras")).items[0].personalTriggers, ["kept"]);
  assert.deepEqual(JSON.parse(missing.getItem("ui.loras")).items[0].adoptionRecords, []);
});

test("M4/M7 transaction: identical dual fields and v2-only data normalize without losing order or words", () => {
  const source = { v: 2, items: [
    { name: "same.safetensors", triggers: ["a", "B"], personalTriggers: ["A", "b"], adoptionRecords: [] },
    { name: "v2-only.safetensors", personalTriggers: ["new"], adoptionRecords: [] }
  ] };
  const store = new Store({ "ui.loras": rawOf(source) });
  const result = run(store), items = JSON.parse(store.getItem("ui.loras")).items;
  assert.equal(result.migrated, false, "identical normalized content does not need rewrite");
  assert.deepEqual(items[0].personalTriggers, ["A", "b"]);
  assert.deepEqual(items[1].personalTriggers, ["new"]);
  assert.equal(store.getItem(M.keys.backup), null);
});

test("M5 transaction: v2 order first, v1 unique words appended by wordKey, exact item backup is durable", () => {
  const source = { v: 2, items: [{ name: "chars/example.safetensors", triggers: ["v1 only", "same", "V2"], personalTriggers: ["same", "v2"], adoptionRecords: [], enabled: true }] };
  const raw = rawOf(source), store = new Store({ "ui.loras": raw });
  const result = run(store), saved = JSON.parse(store.getItem("ui.loras")), record = readBackup(store).backups[0];
  assert.equal(result.migrated, true);
  assert.deepEqual(saved.items[0].personalTriggers, ["same", "v2", "v1 only"]);
  assert.equal("triggers" in saved.items[0], false);
  assert.equal(record.reason, "dual-conflict");
  assert.equal(record.itemName, "chars/example.safetensors");
  assert.deepEqual(record.payload.value, { triggers: ["v1 only", "same", "V2"], personalTriggers: ["same", "v2"] });
  assert.equal(record.status, "pending");
  assert.equal(M.validateRecord(record), true);
  assert.match(record.backupId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(store.getItem(M.keys.backup) != null, true);
});

test("M5 union preserves every unique word even when the union exceeds the current add limit", () => {
  const v2 = Array.from({ length: 30 }, (_, i) => "v2_" + i);
  const v1 = ["V2 0", ...Array.from({ length: 20 }, (_, i) => "v1_" + i)];
  const store = new Store({ "ui.loras": rawOf({ v: 2, items: [{ name: "large.safetensors", triggers: v1, personalTriggers: v2, adoptionRecords: [] }] }) });
  run(store);
  const saved = JSON.parse(store.getItem("ui.loras")).items[0].personalTriggers;
  assert.equal(saved.length, 50);
  assert.deepEqual(saved.slice(0, 30), v2);
  assert.deepEqual(saved.slice(30), v1.slice(1));
  assert.equal(readBackup(store).backups[0].payload.value.triggers.length, v1.length);
});

test("M6 transaction: v2 [] wins, no old prompt injection, itemName and legacy payload persist", () => {
  const source = { v: 2, items: [{ name: "char/empty.safetensors", triggers: ["old secret"], personalTriggers: [], adoptionRecords: [], enabled: true }] };
  const store = new Store({ "ui.loras": rawOf(source) }), result = run(store);
  assert.deepEqual(result.state.items[0].triggers, []);
  assert.deepEqual(JSON.parse(store.getItem("ui.loras")).items[0].personalTriggers, []);
  const model = promptContext.PromptComposer.derivePromptModel({ sel: [], extra: "", loras: result.state.items, negativeRaw: "" });
  assert.equal(promptContext.PromptComposer.compose(model).pos.includes("old secret"), false);
  const rec = readBackup(store).backups[0];
  assert.equal(rec.reason, "v1-data-v2-empty");
  assert.equal(rec.itemName, "char/empty.safetensors");
  assert.deepEqual(rec.payload.value.triggers, ["old secret"]);
  assert.deepEqual(rec.payload.value.personalTriggers, []);
  assert.equal(rec.status, "pending");
});

test("M8 transaction: invalid name, malformed fields and bad adoption rows are quarantined before rewrite", () => {
  const badRecord = { adoptionId: "bad", source: {}, sourceGroupId: "bad", word: "x", wordKey: "x", adoptedAt: -1, via: "word" };
  const source = { v: 2, items: [
    { name: "valid.safetensors", personalTriggers: ["keep"], adoptionRecords: [] },
    { name: "../unsafe.safetensors", personalTriggers: ["preserve me"], adoptionRecords: [] },
    { name: "bad-field.safetensors", personalTriggers: "not-array", adoptionRecords: [] },
    { name: "bad-adoption.safetensors", personalTriggers: ["safe"], adoptionRecords: [badRecord] }
  ] };
  const store = new Store({ "ui.loras": rawOf(source) }), result = run(store), backup = readBackup(store);
  assert.equal(result.state.items.length, 3, "all valid LoRA names remain available");
  assert.equal(backup.backups.length, 3);
  assert.ok(backup.backups.some(x => x.itemName === "../unsafe.safetensors" && x.payload.value.personalTriggers[0] === "preserve me"));
  assert.ok(backup.backups.some(x => x.itemName === "bad-field.safetensors" && x.reason === "type-error"));
  assert.ok(backup.backups.some(x => x.itemName === "bad-adoption.safetensors" && x.reason === "type-error" && x.payload.value.adoptionRecords[0].adoptionId === "bad"));
  const before = JSON.stringify(backup.backups);
  assert.equal(M.saveState(store, { items: result.state.items }, L.loraSerialize).ok, true);
  assert.equal(JSON.stringify(readBackup(store).backups), before, "ordinary save keeps quarantine backups intact");
  assert.equal(run(store).state.items.length, 3);
});

test("M8 non-object rows preserve exact raw JSON before cleanup; verified backup survives ordinary save", () => {
  const invalidRows = [null, "bad-row", 17, true, ["array-row"]];
  for (const badRow of invalidRows) {
    const source = { v: 2, items: [
      { name: "keep.safetensors", personalTriggers: ["preserve"], adoptionRecords: [] },
      badRow
    ] };
    const raw = rawOf(source), store = new Store({ "ui.loras": raw });
    const result = run(store);
    assert.equal(result.result.ok, true, `migration succeeds for ${JSON.stringify(badRow)}`);
    assert.equal(result.migrated, true);
    assert.deepEqual(result.state.items.map(x => x.name), ["keep.safetensors"]);
    const backup = readBackup(store);
    assert.equal(backup.backups.length, 1);
    const record = backup.backups[0];
    assert.equal(record.reason, "quarantine");
    assert.equal(record.payload.kind, "raw-json");
    assert.equal(record.payload.value, raw, "BackupRecord stores the exact source ui.loras string");
    assert.equal(record.itemName, null);
    assert.equal(M.validateRecord(record), true);
    assert.ok(store.writes.indexOf(M.keys.backup) >= 0);
    assert.ok(store.writes.indexOf(M.keys.backup) < store.writes.indexOf("ui.loras"), "verified backup write precedes cleaned source write");
    const cleaned = JSON.parse(store.getItem("ui.loras"));
    assert.deepEqual(cleaned.items.map(x => x.name), ["keep.safetensors"]);
    assert.equal(cleaned.items.length, 1, "non-object row is excluded from normalized items");

    const beforeOrdinarySave = store.getItem(M.keys.backup);
    assert.equal(M.saveState(store, { items: result.state.items }, L.loraSerialize).ok, true);
    assert.equal(store.getItem(M.keys.backup), beforeOrdinarySave, "ordinary save keeps the verified quarantine backup readable");
    assert.equal(readBackup(store).backups[0].payload.value, raw);

    const failed = new Store({ "ui.loras": raw });
    failed.failKey = M.keys.backup; failed.failCount = 1;
    const failure = run(failed);
    assert.notEqual(failure.result.code, "OK");
    assert.equal(failed.getItem("ui.loras"), raw, "backup failure leaves the source string byte-for-byte unchanged");
    assert.equal(failed.writes.includes("ui.loras"), false, "source is never written after backup failure");
  }
});

test("unknown numeric version is not downgraded; raw source stays intact in quarantine", () => {
  const raw = ' { "v": 77, "items": [{ "name": "future.safetensors", "triggers": ["keep"] }] } ';
  const store = new Store({ "ui.loras": raw }), result = run(store);
  assert.equal(result.result.code, "MIGRATION_INCOMPLETE");
  assert.equal(store.getItem("ui.loras"), raw);
  const rec = readBackup(store).backups[0];
  assert.equal(rec.reason, "quarantine");
  assert.equal(rec.payload.kind, "raw-json");
  assert.equal(rec.payload.value, raw);
});

test("malformed top-level null or missing items is quarantined without replacing source", () => {
  for (const raw of ["null", '{"v":1,"other":"keep"}']) {
    const store = new Store({ "ui.loras": raw }), result = run(store);
    assert.equal(result.result.code, "MIGRATION_INCOMPLETE");
    assert.equal(store.getItem("ui.loras"), raw);
    assert.equal(readBackup(store).backups[0].reason, "quarantine");
    assert.equal(readBackup(store).backups[0].payload.value, raw);
  }
});

test("non-numeric invalid version is inferred only with durable raw backup", () => {
  const raw = rawOf({ v: "future", items: [{ name: "inferred.safetensors", personalTriggers: ["current"], adoptionRecords: [] }] });
  const store = new Store({ "ui.loras": raw }), result = run(store);
  assert.equal(result.migrated, true);
  const record = readBackup(store).backups[0];
  assert.equal(record.reason, "quarantine");
  assert.equal(record.payload.kind, "raw-json");
  assert.equal(record.payload.value, raw);
  assert.deepEqual(JSON.parse(store.getItem("ui.loras")).items[0].personalTriggers, ["current"]);
});

test("parse failure keeps exact source string and stores raw-json recovery record", () => {
  const raw = "{broken\r\nraw";
  const store = new Store({ "ui.loras": raw }), result = run(store);
  assert.equal(result.result.code, "BACKUP_CORRUPT");
  assert.equal(store.getItem("ui.loras"), raw);
  assert.equal(readBackup(store).backups[0].payload.value, raw);
  assert.equal(readBackup(store).backups[0].reason, "parse-failure");
});

test("backup set failure and readback mismatch prevent source overwrite", () => {
  const raw = rawOf({ v: 2, items: [{ name: "a.safetensors", triggers: ["v1"], personalTriggers: ["v2"], adoptionRecords: [] }] });
  const fail = new Store({ "ui.loras": raw }); fail.failKey = M.keys.backup; fail.failCount = 1;
  assert.equal(run(fail).result.code, "BACKUP_WRITE_FAILED");
  assert.equal(fail.getItem("ui.loras"), raw);
  const mismatch = new Store({ "ui.loras": raw }); mismatch.mismatch = M.keys.backup;
  assert.notEqual(run(mismatch).result.code, "OK");
  assert.equal(mismatch.getItem("ui.loras"), raw);
  assert.equal(mismatch.getItem(M.keys.backup), null, "failed unverified first backup is rolled back to absent");
  const sourceMismatch = new Store({ "ui.loras": raw }); sourceMismatch.mismatch = "ui.loras"; sourceMismatch.mismatchCount = 1;
  assert.notEqual(run(sourceMismatch).result.code, "OK");
  assert.equal(sourceMismatch.getItem("ui.loras"), raw, "unverified source overwrite is rolled back byte-for-byte");
  assert.equal(readBackup(sourceMismatch).backups[0].status, "pending");
});

test("retry is idempotent across three startups and reuses one pending record", () => {
  const raw = rawOf({ v: 2, items: [{ name: "retry.safetensors", triggers: ["old"], personalTriggers: ["new"], adoptionRecords: [] }] });
  const store = new Store({ "ui.loras": raw }); store.failKey = "ui.loras"; store.failCount = 2;
  const first = run(store);
  assert.equal(first.result.code, "LORA_SAVE_FAILED");
  assert.equal(readBackup(store).backups.length, 1);
  assert.equal(store.getItem("ui.loras"), raw);
  const second = run(store);
  assert.equal(second.result.code, "MIGRATION_INCOMPLETE");
  assert.equal(readBackup(store).backups.length, 1);
  const third = run(store);
  assert.equal(third.result.ok, true);
  assert.equal(readBackup(store).backups.length, 1);
  assert.equal(readBackup(store).backups[0].status, "pending", "success still waits for user confirmation");
});

test("general loraSave retains pending backup and refuses source write if backup write fails", () => {
  const raw = rawOf({ v: 2, items: [{ name: "save.safetensors", triggers: ["old"], personalTriggers: ["new"], adoptionRecords: [] }] });
  const store = new Store({ "ui.loras": raw });
  const migrated = run(store), recs = readBackup(store).backups;
  assert.equal(M.saveState(store, { items: migrated.state.items }, L.loraSerialize).ok, true);
  assert.equal(readBackup(store).backups[0].backupId, recs[0].backupId);
  assert.equal(readBackup(store).backups[0].status, "pending");
  const before = store.getItem("ui.loras"); store.failKey = M.keys.backup; store.failCount = 1;
  const failed = M.saveState(store, { items: migrated.state.items }, L.loraSerialize);
  assert.equal(failed.ok, false);
  assert.equal(store.getItem("ui.loras"), before, "backup failure blocks ui.loras write");
});

test("confirmBackup targets one UUID, readback verifies, failure remains pending", () => {
  const raw = rawOf({ v: 2, items: [{ name: "confirm.safetensors", triggers: ["old"], personalTriggers: ["new"], adoptionRecords: [] }] });
  const store = new Store({ "ui.loras": raw }), migrated = run(store), rec = readBackup(store).backups[0];
  store.failKey = M.keys.backup; store.failCount = 1;
  assert.equal(M.confirmBackup(store, rec.backupId, 123).code, "BACKUP_CONFIRM_FAILED");
  assert.equal(readBackup(store).backups[0].status, "pending");
  store.failKey = null;
  store.mismatch = M.keys.backup; store.mismatchCount = 1;
  assert.equal(M.confirmBackup(store, rec.backupId, 234).code, "BACKUP_CONFIRM_FAILED");
  assert.equal(readBackup(store).backups[0].status, "pending", "readback mismatch rolls back the confirmation");
  store.mismatch = null;
  const ok = M.confirmBackup(store, rec.backupId, 456);
  assert.equal(ok.ok, true); assert.equal(ok.verified, true);
  assert.equal(readBackup(store).backups[0].backupId, rec.backupId);
  assert.equal(readBackup(store).backups[0].status, "confirmed");
  assert.equal(readBackup(store).backups[0].confirmedAt, 456);
  assert.equal(readBackup(store).backups.length, 1, "confirmation never deletes backups");
  assert.equal(migrated.result.ok, true);
});

test("corrupt backup is copied once to .corrupt without replacing source or backup", () => {
  const source = "{broken source", corrupt = "{broken backup";
  const store = new Store({ "ui.loras": source, [M.keys.backup]: corrupt });
  assert.equal(run(store).result.code, "BACKUP_CORRUPT");
  assert.equal(store.getItem(M.keys.backup), corrupt);
  assert.equal(store.getItem(M.keys.corrupt), corrupt);
  assert.equal(store.getItem("ui.loras"), source);
  assert.equal(run(store).result.code, "BACKUP_CORRUPT_UNHANDLED");
});

test("backup with malformed BackupRecord is treated as corrupt and preserved once", () => {
  const source = rawOf({ v: 2, items: [{ name: "safe.safetensors", personalTriggers: [], adoptionRecords: [] }] });
  const badBackup = rawOf({ v: 1, backups: [{ backupId: "not-uuid", status: "pending" }] });
  const store = new Store({ "ui.loras": source, [M.keys.backup]: badBackup });
  assert.equal(run(store).result.code, "BACKUP_CORRUPT");
  assert.equal(store.getItem(M.keys.backup), badBackup);
  assert.equal(store.getItem(M.keys.corrupt), badBackup);
  assert.equal(store.getItem("ui.loras"), source);
});

console.log(`\n${passed} migration transaction tests passed; ${failed} failed`);
if (failed) process.exitCode = 1;
