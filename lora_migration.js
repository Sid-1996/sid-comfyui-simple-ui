/* Verified localStorage transactions for ui.loras v1 -> v2. */
(function (root) {
  "use strict";
  const LORA_KEY = "ui.loras";
  const BACKUP_KEY = "ui.loras.migrationBackup";
  const CORRUPT_KEY = "ui.loras.migrationBackup.corrupt";
  const REASONS = new Set(["dual-conflict", "v1-data-v2-empty", "type-error", "parse-failure", "quarantine", "partial-failure"]);
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  function result(ok, code, key, message, verified) {
    return { ok, code, key, message, verified: !!verified };
  }
  function safeSetJSON(store, key, value) {
    let serialized;
    try { serialized = JSON.stringify(value); }
    catch (_) { return result(false, "SERIALIZE_FAILED", key, "資料無法整理成 JSON。", false); }
    try { store.setItem(key, serialized); }
    catch (e) {
      const quota = e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014);
      return result(false, quota ? "QUOTA_EXCEEDED" : e && e.name === "SecurityError" ? "SECURITY_ERROR" : "SETITEM_FAILED", key, "儲存失敗；原始資料仍保留。", false);
    }
    try {
      if (store.getItem(key) !== serialized) return result(false, "UNVERIFIED", key, "讀回內容不同，無法確認資料已保存。", false);
    } catch (_) { return result(false, "READ_FAILED", key, "無法讀回驗證儲存內容。", false); }
    return result(true, "OK", key, "已寫入並讀回確認。", true);
  }
  function safeSetString(store, key, value) {
    try { store.setItem(key, value); }
    catch (e) {
      const quota = e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014);
      return result(false, quota ? "QUOTA_EXCEEDED" : e && e.name === "SecurityError" ? "SECURITY_ERROR" : "SETITEM_FAILED", key, "原始備份字串未能另存。", false);
    }
    try { return store.getItem(key) === value ? result(true, "OK", key, "已寫入並讀回確認。", true) : result(false, "UNVERIFIED", key, "讀回內容不同。", false); }
    catch (_) { return result(false, "READ_FAILED", key, "無法讀回驗證備份字串。", false); }
  }
  function restoreRaw(store, key, raw) {
    try {
      if (raw == null) {
        store.removeItem(key);
        return store.getItem(key) == null;
      }
      return safeSetString(store, key, raw).ok;
    } catch (_) { return false; }
  }
  function replaceJSON(store, key, value) {
    let before;
    try { before = store.getItem(key); }
    catch (_) { return result(false, "READ_FAILED", key, "無法讀取舊內容；未進行寫入。", false); }
    const saved = safeSetJSON(store, key, value);
    if (saved.ok && saved.verified) return saved;
    const rolledBack = saved.code === "UNVERIFIED" ? restoreRaw(store, key, before) : true;
    return Object.assign({}, saved, { rolledBack });
  }
  function parseBackup(store) {
    let raw;
    try { raw = store.getItem(BACKUP_KEY); }
    catch (_) { return { error: result(false, "STORE_UNAVAILABLE", BACKUP_KEY, "無法讀取遷移備份。", false) }; }
    if (raw == null) return { value: { v: 1, backups: [] } };
    try {
      const data = JSON.parse(raw);
      if (!data || data.v !== 1 || !Array.isArray(data.backups) || !data.backups.every(validateRecord)) throw new Error("bad backup shape");
      return { value: data };
    } catch (_) {
      let corrupt;
      try { corrupt = store.getItem(CORRUPT_KEY); }
      catch (_) { return { error: result(false, "BACKUP_CORRUPT_UNHANDLED", BACKUP_KEY, "遷移備份損壞，且無法檢查救援位置。", false) }; }
      if (corrupt != null) return { error: result(false, "BACKUP_CORRUPT_UNHANDLED", BACKUP_KEY, "遷移備份損壞；既有救援資料已保留，未進行寫入。", false) };
      const saved = safeSetString(store, CORRUPT_KEY, raw);
      return { error: saved.ok
        ? result(false, "BACKUP_CORRUPT", BACKUP_KEY, "遷移備份損壞；原始字串已保存在救援欄位。", true)
        : result(false, "BACKUP_CORRUPT_UNHANDLED", BACKUP_KEY, "遷移備份損壞，原始字串無法安全另存。", false) };
    }
  }
  function validateRecord(r) {
    return !!r && UUID_V4.test(r.backupId) && Number.isFinite(r.createdAt) && REASONS.has(r.reason) &&
      r.sourceKey === LORA_KEY && (r.itemName === null || typeof r.itemName === "string") &&
      r.payload && (r.payload.kind === "raw-json" || r.payload.kind === "item") &&
      Object.prototype.hasOwnProperty.call(r.payload, "value") &&
      (r.payload.kind !== "raw-json" || typeof r.payload.value === "string") &&
      (r.payload.kind !== "item" || (r.payload.value && typeof r.payload.value === "object" && !Array.isArray(r.payload.value))) &&
      r.targetVersion === 2 && Number.isInteger(r.expectedItemCount) && r.expectedItemCount >= 0 &&
      ["pending", "confirmed", "discarded"].includes(r.status) &&
      (r.status === "pending" ? r.confirmedAt === null : Number.isFinite(r.confirmedAt)) && typeof r.note === "string";
  }
  function uuidV4() {
    try { if (root.crypto && typeof root.crypto.randomUUID === "function") return root.crypto.randomUUID().toLowerCase(); } catch (_) { /* fallback */ }
    const b = new Uint8Array(16);
    try { root.crypto.getRandomValues(b); }
    catch (_) { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); }
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function backupEqual(a, req) {
    return a.status === "pending" && a.targetVersion === 2 && a.reason === req.reason &&
      a.itemName === req.itemName && a.payload.kind === req.payload.kind &&
      JSON.stringify(a.payload.value) === JSON.stringify(req.payload.value);
  }
  function writeRequests(store, requests, expectedItemCount) {
    const parsed = parseBackup(store);
    if (parsed.error) return parsed.error;
    const data = parsed.value;
    if (data.backups.some(x => !validateRecord(x))) return result(false, "BACKUP_CORRUPT_UNHANDLED", BACKUP_KEY, "遷移備份格式不完整；未改動原始資料。", false);
    let changed = false;
    const created = [];
    (Array.isArray(requests) ? requests : []).forEach(req => {
      if (data.backups.some(x => backupEqual(x, req))) return;
      const rec = {
        backupId: uuidV4(), createdAt: Date.now(), reason: REASONS.has(req.reason) ? req.reason : "quarantine",
        sourceKey: LORA_KEY, itemName: req.itemName == null ? null : String(req.itemName),
        payload: req.payload, targetVersion: 2, expectedItemCount,
        status: "pending", confirmedAt: null, note: String(req.note || "遷移前已保全原始資料；請確認轉換結果。")
      };
      if (!validateRecord(rec)) throw new Error("invalid backup request");
      data.backups.push(rec); created.push(rec); changed = true;
    });
    if (!changed) return Object.assign(result(true, "OK", BACKUP_KEY, "沿用既有待確認備份。", true), { records: [], reused: true });
    const saved = replaceJSON(store, BACKUP_KEY, data);
    return saved.ok ? Object.assign(saved, { records: created, reused: false }) : result(false, "BACKUP_WRITE_FAILED", BACKUP_KEY, saved.message, false);
  }
  function serializeResult(serializeState, state) {
    return serializeState(state.items);
  }
  function readAndMigrate(store, parseState, serializeState) {
    let raw;
    try { raw = store.getItem(LORA_KEY); }
    catch (_) { return { state: { v: 2, items: [], migration: {} }, result: result(false, "STORE_UNAVAILABLE", LORA_KEY, "無法讀取 LoRA 資料，已切換唯讀空清單。", false), migrated: false }; }
    const backupState = parseBackup(store);
    if (backupState.error) return { state: { v: 2, items: [], migration: {} }, result: backupState.error, migrated: false };
    let parsedRaw = null;
    if (raw != null) {
      try { parsedRaw = JSON.parse(raw); }
      catch (_) {
        const saved = writeRequests(store, [{ reason: "parse-failure", itemName: null, payload: { kind: "raw-json", value: raw }, note: "LoRA JSON 無法解析；原始字串原樣保留。" }], 0);
        return { state: { v: 2, items: [], migration: { blocked: true, reason: "parse-failure" } },
          result: saved.ok ? result(false, "BACKUP_CORRUPT", LORA_KEY, "LoRA JSON 損壞；原始字串已備份，尚未改寫。", true) : saved, migrated: false };
      }
    }
    let state;
    try {
      if (raw != null && parsedRaw === null) state = { v: 2, items: [], migration: {
        blocked: true, reason: "quarantine", backups: [{ reason: "quarantine", itemName: null,
          payload: { kind: "raw-json", value: raw }, note: "LoRA JSON 外層不是物件；原始字串已隔離保全。" }]
      } };
      else state = parseState(parsedRaw);
    }
    catch (_) { return { state: { v: 2, items: [], migration: { blocked: true } }, result: result(false, "MIGRATION_INCOMPLETE", LORA_KEY, "LoRA 資料無法安全轉換，原始內容未更動。", false), migrated: false }; }
    const migration = state && state.migration || {};
    const version = parsedRaw && typeof parsedRaw === "object" ? parsedRaw.v : null;
    const target = raw != null && version === 2 && !migration.needsWrite && !(migration.backups || []).length && !(migration.quarantine || []).length;
    const needs = raw != null && !target;
    if (!needs) return { state, result: result(true, "OK", LORA_KEY, "LoRA 資料已是 v2。", true), migrated: false, migrationIncomplete: false };
    let requests = Array.isArray(migration.backups) ? migration.backups.map(x => Object.assign({}, x)) : [];
    requests.forEach(req => { if (req.payload && req.payload.kind === "raw-json" && raw != null) req.payload = { kind: "raw-json", value: raw }; });
    const pendingMatch = requests.length > 0 && requests.every(req => backupState.value.backups.some(x => backupEqual(x, req)));
    const incomplete = pendingMatch && !target;
    if (migration.blocked && !requests.length) requests.push({ reason: "quarantine", itemName: null,
      payload: { kind: "raw-json", value: raw == null ? JSON.stringify(parsedRaw) : raw }, note: "資料版本或結構不支援；原始內容已隔離保全。" });
    if (incomplete && pendingMatch && !requests.length) {
      return { state, result: result(false, "MIGRATION_INCOMPLETE", LORA_KEY, "上次遷移尚未完成；原待確認備份已保留，請重新載入重試。", false), migrated: false, migrationIncomplete: true };
    }
    let written = { ok: true, verified: true, records: [] };
    if (requests.length) {
      try { written = writeRequests(store, requests, state.items.length); }
      catch (_) { written = result(false, "SERIALIZE_FAILED", BACKUP_KEY, "遷移備份無法安全整理；原始資料未更動。", false); }
      if (!written.ok || !written.verified) return { state, result: written, migrated: false, migrationIncomplete: true };
    }
    if (migration.blocked) return { state, result: result(false, "MIGRATION_INCOMPLETE", LORA_KEY, "資料版本或結構不支援；原始內容已隔離並保留，未改寫。", true), migrated: false, migrationIncomplete: true };
    let output;
    try { output = serializeResult(serializeState, state); }
    catch (_) { return { state, result: result(false, "SERIALIZE_FAILED", LORA_KEY, "遷移結果無法整理；原始資料與備份均保留。", false), migrated: false, migrationIncomplete: true }; }
    const saved = replaceJSON(store, LORA_KEY, output);
    if (!saved.ok || !saved.verified) return { state, result: result(false, pendingMatch ? "MIGRATION_INCOMPLETE" : "LORA_SAVE_FAILED", LORA_KEY,
      pendingMatch ? "偵測到上次遷移未完成；已重用原待確認備份，但這次仍未能寫入 v2。重新載入可再試。" : "轉換結果未能安全保存；待確認備份已保留。", false), migrated: false, migrationIncomplete: true };
    let check;
    try { check = JSON.parse(store.getItem(LORA_KEY)); } catch (_) { check = null; }
    if (!check || check.v !== 2 || !Array.isArray(check.items) || check.items.length !== state.items.length)
      return { state, result: result(false, "MIGRATION_INCOMPLETE", LORA_KEY, "讀回的 LoRA 版本或筆數不符；備份已保留。", false), migrated: false, migrationIncomplete: true };
    return { state, result: result(true, "OK", LORA_KEY, "LoRA 已安全轉成 v2；待確認備份已保留。", true), migrated: true, migrationIncomplete: false,
      backups: written.records || [] };
  }
  function saveState(store, state, serializeItems) {
    const parsed = parseBackup(store);
    if (parsed.error) return parsed.error;
    if (parsed.value.backups.some(x => !validateRecord(x))) return result(false, "BACKUP_CORRUPT_UNHANDLED", BACKUP_KEY, "遷移備份格式不完整；未寫入 LoRA。", false);
    let current;
    try { current = store.getItem(LORA_KEY); } catch (_) { return result(false, "READ_FAILED", LORA_KEY, "無法確認目前 LoRA 資料；未寫入。", false); }
    if (current != null) {
      try {
        const obj = JSON.parse(current);
        if (!obj || obj.v !== 2 || !Array.isArray(obj.items)) return result(false, "MIGRATION_INCOMPLETE", LORA_KEY, "目前資料尚未完成 v2 遷移；請重新載入後重試。", false);
      } catch (_) { return result(false, "MIGRATION_INCOMPLETE", LORA_KEY, "目前資料無法解析；原始內容未覆寫。", false); }
    }
    if (parsed.value.backups.length) {
      const b = replaceJSON(store, BACKUP_KEY, parsed.value);
      if (!b.ok || !b.verified) return result(false, "BACKUP_WRITE_FAILED", BACKUP_KEY, b.message, false);
    }
    const saved = replaceJSON(store, LORA_KEY, serializeItems(state.items));
    return saved.ok ? saved : result(false, "LORA_SAVE_FAILED", LORA_KEY, saved.message, false);
  }
  function confirmBackup(store, backupId, now) {
    const parsed = parseBackup(store);
    if (parsed.error) return parsed.error;
    const record = parsed.value.backups.find(x => x.backupId === backupId);
    if (!record || !validateRecord(record) || record.status !== "pending") return result(false, "READ_FAILED", BACKUP_KEY, "找不到有效的待確認備份。", false);
    record.status = "confirmed"; record.confirmedAt = Number.isFinite(now) ? now : Date.now();
    const saved = replaceJSON(store, BACKUP_KEY, parsed.value);
    return saved.ok ? saved : result(false, "BACKUP_CONFIRM_FAILED", BACKUP_KEY, saved.message, false);
  }
  root.LoraMigration = { safeSetJSON, replaceJSON, parseBackup, writeRequests, readAndMigrate, saveState, confirmBackup, validateRecord,
    keys: { lora: LORA_KEY, backup: BACKUP_KEY, corrupt: CORRUPT_KEY } };
})(typeof window === "object" ? window : globalThis);
