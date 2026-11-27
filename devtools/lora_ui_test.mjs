// lora_ui_test.mjs — 角色 LoRA UI 端對端測試
//
// 用 headless Chrome 的 CDP 直接操作「隔離的 simple_ui + 假 ComfyUI」，
// 不連正式 7860、不連真 ComfyUI、不產生 GPU 工作、不碰使用者 Chrome。
//
// 前置：
//   python devtools/lora_mock_comfy.py --port 18188 --capture <cap.jsonl> --prompt-delay 3
//   COMFY_URL=http://127.0.0.1:18188 SIMPLE_UI_PORT=7861 python server.py
// 執行：
//   node devtools/lora_ui_test.mjs --ui http://127.0.0.1:7861 --mock http://127.0.0.1:18188 --capture <cap.jsonl>
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const UI = args.ui || "http://127.0.0.1:7861";
const MOCK = args.mock || "http://127.0.0.1:18188";
const MOCKCV = args.mockcv || "http://127.0.0.1:18189";
const CAPTURE = args.capture || path.join(os.tmpdir(), "lora-capture.jsonl");
const CHROME = args.chrome || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const MIKU = "chars\\MockMiku.safetensors";
const LINEART = "style/Lineart.safetensors";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (cond, msg) => { if (!cond) throw new Error(msg); };
const js = v => JSON.stringify(v);
let passed = 0;
function ok(name) { passed++; console.log("  PASS " + name); }

const pickRow = name => `[...document.querySelectorAll('#loraPickList .lora-pick')].find(r => r.dataset.name === ${js(name)})`;
const selRow = name => `[...document.querySelectorAll('#loraList .lora-row')].find(r => r.dataset.name === ${js(name)})`;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.handlers = new Map();
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) {
        this.events.push(m);
        const list = this.handlers.get(m.method);
        if (list) list.forEach(fn => { try { fn(m.params); } catch (err) { /* ignore */ } });
      }
    };
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  ready() {
    return new Promise((res, rej) => {
      if (this.ws.readyState === 1) return res();
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error("CDP websocket 失敗"));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: expr, awaitPromise: true, returnByValue: true
    });
    if (r.exceptionDetails) {
      throw new Error("頁面例外：" + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

async function waitFor(fn, label, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (e) { last = e.message; }
    await sleep(150);
  }
  throw new Error("等待逾時：" + label + "（最後：" + JSON.stringify(last) + "）");
}

function readCapture() {
  if (!fs.existsSync(CAPTURE)) return [];
  return fs.readFileSync(CAPTURE, "utf8").split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
}

let chrome = null;
let cdp = null;
let profile = "";

try {
  // 1) 啟動獨立 headless Chrome（自己的 profile，不影響使用者瀏覽器）
  const port = await freePort();
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "lora-chrome-"));
  chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--mute-audio", "--window-size=1920,1080",
    "--user-data-dir=" + profile, "--remote-debugging-port=" + port,
    "about:blank"
  ], { stdio: "ignore" });

  let version = null;
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    try {
      const r = await fetch("http://127.0.0.1:" + port + "/json/version");
      if (r.ok) { version = await r.json(); break; }
    } catch (e) { /* 還沒起來 */ }
    await sleep(200);
  }
  check(version, "Chrome DevTools 沒起來");
  const target = await (await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", { method: "PUT" })).json();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable");

  // 用 CDP 攔截 /api/loras，模擬正常空清單、HTML、invalid JSON、離線與其他錯誤。
  // 只影響這個隔離分頁的請求，不改后端的任何回應格式。
  let loraApiOverride = null;
  let cvStatusOverride = null;
  let loraMetaOverride = null;   // 最後一項 E2E：注入兩組本機建議
  let appJsOverride = null;      // 最後一項 E2E：只對瀏覽器提供的測試版 app.js
  let cvVersionOverride = null;  // 模擬同版本更新失敗（避開後端 300 秒快取）
  let apiStatusTestsDone = false;
  let cvVersion404TestsDone = false;   // 故意觸發 404 時，瀏覽器會記錄資源錯誤
  let cvVersionStaleTestsDone = false; // 故意讓舊版本延遲失敗（500）時，瀏覽器會記錄資源錯誤
  let cvVersionReqCount = 0;           // 計數：實際送出的 /api/civitai/version 請求數
  cdp.on("Fetch.requestPaused", async p => {
    try {
      // 計數：每個真正送出的 /api/civitai/version 請求（不論是否攔截回應）
      if (/\/api\/civitai\/version(?:\?|$)/.test(p.request.url)) cvVersionReqCount++;
      const spec = /\/app\.js(?:\?|$)/.test(p.request.url) ? appJsOverride
        : /\/api\/civitai\/version(?:\?|$)/.test(p.request.url) ? cvVersionOverride
        : /\/api\/lora-meta(?:\?|$)/.test(p.request.url) ? loraMetaOverride
        : /\/api\/civitai\/status(?:\?|$)/.test(p.request.url) ? cvStatusOverride
        : /\/api\/loras(?:\?|$)/.test(p.request.url) ? loraApiOverride : null;
      if (spec) {
        await cdp.send("Fetch.fulfillRequest", {
          requestId: p.requestId,
          responseCode: spec.status || 200,
          responseHeaders: [
            { name: "Content-Type", value: spec.type || "application/json; charset=utf-8" },
            { name: "Cache-Control", value: "no-store" }
          ],
          body: Buffer.from(spec.body || "", "utf8").toString("base64")
        });
      } else {
        await cdp.send("Fetch.continueRequest", { requestId: p.requestId });
      }
    } catch (e) { /* ignore */ }
  });
  await cdp.send("Fetch.enable", { patterns: [
    { urlPattern: "*/api/loras*", requestStage: "Request" },
    { urlPattern: "*/api/civitai/status*", requestStage: "Request" },
    { urlPattern: "*/api/civitai/version*", requestStage: "Request" }
  ] });

  // 2) 開頁並等 app 就緒
  await cdp.send("Page.navigate", { url: UI + "/?v=lora-e2e" });
  await waitFor(() => cdp.eval("document.readyState === 'complete' && document.querySelectorAll('#ckpt option').length > 0"), "app 載入");
  await waitFor(() => cdp.eval("document.querySelector('#statusText').textContent.includes('已連線')"), "ComfyUI 狀態列");

  const qualityCounts = await cdp.eval(`(() => {
    const q = document.querySelector('#search');
    q.value = 'masterpiece'; q.dispatchEvent(new Event('input', { bubbles: true }));
    const general = document.querySelectorAll('#tags .tag[data-e="masterpiece"]').length;
    const catsGeneral = document.querySelector('#cats').textContent;
    const adv = document.querySelector('#advBox'); adv.open = true;
    window.Tags.refresh();
    const advanced = document.querySelectorAll('#tags .tag[data-e="masterpiece"]').length;
    const catsAdvanced = document.querySelector('#cats').textContent;
    document.querySelector('#tags .tag[data-e="masterpiece"]')?.click();
    const selected = document.querySelector('#tags .tag[data-e="masterpiece"]')?.getAttribute('aria-pressed') === 'true';
    adv.open = false; window.Tags.refresh();
    q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true }));
    return { general, advanced, selected, catsGeneral, catsAdvanced };
  })()`);
  check(qualityCounts.general === 0 && qualityCounts.advanced === 1 && qualityCounts.selected,
    "品質詞一般模式隱藏、進階模式可選且能保留選取");
  check(qualityCounts.catsGeneral.includes("可選 ") && qualityCounts.catsAdvanced.includes("全部 "),
    "分類數量文案隨一般／進階模式切換");
  ok("品質詞篩選、分類數量與選取狀態");
  ok("頁面載入、ComfyUI 狀態列顯示已連線");

  const consoleErrors = () => cdp.events
    .filter(e => (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") ||
                 (e.method === "Log.entryAdded" && e.params.entry.level === "error"))
    .map(e => e.method === "Log.entryAdded" ? e.params.entry.text
      : e.params.args.map(a => a.value || a.description || "").join(" "))
    .filter(t => !/websocket|\/ws|favicon/i.test(t))
    .filter(t => !(apiStatusTestsDone && /Failed to load resource: the server responded with a status of (503|502)/.test(t)))
    .filter(t => !(cvVersion404TestsDone && /Failed to load resource: the server responded with a status of 404/.test(t)))
    .filter(t => !(cvVersionStaleTestsDone && /Failed to load resource: the server responded with a status of 500/.test(t)));

  // 3) 初始狀態
  const initState = await cdp.eval(`(() => ({
    count: document.querySelector('#loraCount').textContent.trim(),
    empty: !!document.querySelector('#loraList .lora-empty'),
    hidden: document.querySelector('#loraModal').hidden
  }))()`);
  check(initState.count === "0" && initState.empty && initState.hidden, JSON.stringify(initState));
  ok("初始：0 個 LoRA、主畫面有空狀態、視窗關閉");

  // 3.5) 標題列常駐 Civitai 快捷入口（與 LoRA 清單狀態無關）
  const findLink = await cdp.eval(`(() => {
    const a = document.querySelector('.lora-head .lora-find-link');
    return a ? { text: a.textContent.replace(/\\s+/g, ' ').trim(), href: a.href,
                 target: a.target, rel: a.rel, inHead: !!a.closest('.lora-head') } : null;
  })()`);
  check(findLink && findLink.inHead, "標題列找不到常駐 Civitai 連結");
  check(findLink.href === "https://civitai.com/models?types=LORA", "網址不正確：" + findLink.href);
  check(findLink.target === "_blank", "target 不正確：" + findLink.target);
  check(/noopener/.test(findLink.rel) && /noreferrer/.test(findLink.rel), "rel 不正確：" + findLink.rel);
  check(findLink.text.includes("尋找 LoRA"), "連結文字不正確：" + findLink.text);
  ok("標題列常駐入口：文字／URL／target／rel 都正確");

  // 4) 選擇視窗：只列 .safetensors
  await cdp.eval("document.querySelector('#btnLoraPick').click()");
  check(await cdp.eval("document.querySelector('#loraModal').hidden === false"), "btnLoraPick 無法開啟 LoRA Modal");
  ok("原有「選擇」按鈕仍可正常開啟 LoRA Modal");
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraPickList .lora-pick').length === 2"), "LoRA 清單載入");
  const listInfo = await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll('#loraPickList .lora-pick')];
    return { names: rows.map(r => r.dataset.name), text: rows.map(r => r.textContent.replace(/\\s+/g, ' ').trim()) };
  })()`);
  check(listInfo.names.includes(MIKU) && listInfo.names.includes(LINEART), JSON.stringify(listInfo));
  check(!listInfo.names.some(n => /\.pt$/i.test(n)), "後端未過濾 .pt：" + JSON.stringify(listInfo.names));
  ok("選擇視窗：列出 2 個 .safetensors，子資料夾與 .pt 過濾正確");

  // 5) 搜尋
  await cdp.eval(`(() => { const i = document.querySelector('#loraSearch'); i.value = 'lineart'; i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraPickList .lora-pick').length === 1"), "搜尋結果");
  await cdp.eval(`(() => { const i = document.querySelector('#loraSearch'); i.value = ''; i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraPickList .lora-pick').length === 2"), "清除搜尋");
  ok("搜尋框可過濾並清除");

  // 6) 加入第一個 LoRA
  const backupIdForUi = "00112233-4455-4677-8899-aabbccddeeff";
  const backupIdRestore = "10112233-4455-4677-8899-aabbccddeeff";
  await cdp.eval(`(() => {
    const base = { createdAt: 1735296000000, sourceKey: 'ui.loras', itemName: ${js(MIKU)}, targetVersion: 2,
      expectedItemCount: 0, status: 'pending', confirmedAt: null, note: 'isolated UI fixture' };
    localStorage.setItem('ui.loras.migrationBackup', JSON.stringify({ v: 1, backups: [
      { ...base, backupId: ${js(backupIdForUi)}, reason: 'dual-conflict', payload: { kind: 'item', value: { triggers: ['old'], personalTriggers: ['new'] } } },
      { ...base, backupId: ${js(backupIdRestore)}, reason: 'v1-data-v2-empty', payload: { kind: 'item', value: { triggers: ['old-restored'], personalTriggers: [] } } }
    ] }));
    window.__backupConfirmCalls = [];
    const original = window.LoraMigration.confirmBackup;
    window.LoraMigration.confirmBackup = function(store, id) { window.__backupConfirmCalls.push(id); return original(store, id); };
  })()`);
  await cdp.eval(pickRow(MIKU) + '.querySelector(".lora-pick-main").click()');
  await waitFor(() => cdp.eval("document.querySelector('#loraCount').textContent.trim() === '1'"), "加入 LoRA");
  await waitFor(() => cdp.eval("!!document.querySelector('#loraBackupNotice [data-backup-confirm]')"), "備份確認入口");
  const backupUi = await cdp.eval(`(() => ({
    count: document.querySelector('#loraBackupNotice .lora-backup-head').textContent,
    id: document.querySelector('#loraBackupNotice [data-backup-confirm]').dataset.backupConfirm
  }))()`);
  check(backupUi.id === backupIdForUi && backupUi.count.includes("2 筆待確認"), JSON.stringify(backupUi));
  await cdp.eval(`document.querySelector('#loraBackupNotice [data-backup-confirm="${backupIdForUi}"]').click()`);
  await waitFor(() => cdp.eval("JSON.parse(localStorage.getItem('ui.loras.migrationBackup')).backups[0].status === 'confirmed'"), "備份確認讀回");
  const backupConfirm = await cdp.eval(`({ calls: window.__backupConfirmCalls, record: JSON.parse(localStorage.getItem('ui.loras.migrationBackup')).backups[0] })`);
  check(JSON.stringify(backupConfirm.calls) === JSON.stringify([backupIdForUi]), "確認必須呼叫正確 backupId：" + JSON.stringify(backupConfirm.calls));
  check(backupConfirm.record.backupId === backupIdForUi && backupConfirm.record.confirmedAt > 0, JSON.stringify(backupConfirm.record));
  check(!!await cdp.eval("localStorage.getItem('ui.loras.migrationBackup')"), "確認不可刪除備份");
  await cdp.eval(`document.querySelector('#loraBackupNotice [data-backup-restore="${backupIdRestore}"]').click()`);
  await waitFor(() => cdp.eval("JSON.parse(localStorage.getItem('ui.loras.migrationBackup')).backups[1].status === 'confirmed'"), "還原舊詞確認");
  const restoreUi = await cdp.eval(`({ calls: window.__backupConfirmCalls, triggers: JSON.parse(localStorage.getItem('ui.loras')).items[0].personalTriggers,
    record: JSON.parse(localStorage.getItem('ui.loras.migrationBackup')).backups[1] })`);
  check(JSON.stringify(restoreUi.calls) === JSON.stringify([backupIdForUi, backupIdRestore]), "確認與還原必須以正確 backupId 呼叫 confirmBackup：" + JSON.stringify(restoreUi.calls));
  check(restoreUi.triggers.includes("old-restored") && restoreUi.record.confirmedAt > 0, JSON.stringify(restoreUi));
  check(await cdp.eval("JSON.parse(localStorage.getItem('ui.loras.migrationBackup')).backups.length === 2"), "確認流程不可刪除備份");
  // 清掉 UI fixture 還原的舊詞，確保後續 LoRA 觸發詞回歸從乾淨狀態開始。
  await cdp.eval(`(() => { const d = JSON.parse(localStorage.getItem('ui.loras')); d.items[0].personalTriggers = []; localStorage.setItem('ui.loras', JSON.stringify(d)); })()`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(() => cdp.eval("document.readyState === 'complete' && document.querySelectorAll('#loraList .lora-row').length === 1"), "確認測試資料重載");
  ok("使用者確認保留結果／還原舊詞皆呼叫正確 backupId，讀回 verified 且備份保留");
  const stored = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras'))");
  check(stored.v === 2 && stored.items.length === 1, JSON.stringify(stored));
  check(stored.items[0].name === MIKU && stored.items[0].enabled === true, JSON.stringify(stored.items[0]));
  check(stored.items[0].strength === 0.8, "預設權重應為 0.8：" + stored.items[0].strength);
  ok("加入 LoRA：主畫面計數、ui.loras 預設值（0.8）正確");

  // 7) 觸發詞：metadata、去重、編輯
  await cdp.eval("document.querySelector('#btnLoraPick').click()");
  await waitFor(() => cdp.eval("!!document.querySelector('#loraPickList .lora-pick')"), "重新開啟 LoRA 選擇視窗");
  await cdp.eval(pickRow(MIKU) + '.querySelector("[data-lora-act=\\"triggers\\"]").click()');
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('sdxl_base_v1-0/lora')"), "metadata 載入", 8000);
  await cdp.eval(`(() => {
    const i = document.querySelector('#loraTrigInput');
    i.value = 'mock_miku, mock miku, blue eyes';
    document.querySelector('#loraTrigSave').click();
  })()`);
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraTrigPanel .lora-trig-chip').length === 2"), "觸發詞去重");
  const chips1 = await cdp.eval("[...document.querySelectorAll('#loraTrigPanel .lora-trig-chip button[data-lora-act=\\\"edit-trig\\\"]')].map(b => b.textContent)");
  check(chips1.length === 2 && chips1[0] === "mock_miku" && chips1[1] === "blue eyes", JSON.stringify(chips1));
  ok("觸發詞：新增、大小寫／底線去重（mock_miku + mock miku → 1 個）");

  await cdp.eval("document.querySelector('#loraTrigPanel [data-lora-act=\"use-meta\"]').click()");
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraTrigPanel .lora-trig-chip').length === 2"), "metadata 帶入不重複");
  ok("metadata 建議觸發詞：帶入後不產生重複");

  await cdp.eval("[...document.querySelectorAll('#loraTrigPanel .lora-trig-chip')][1].querySelector('[data-lora-act=\"edit-trig\"]').click()");
  const editVal = await cdp.eval("document.querySelector('#loraTrigInput').value");
  check(editVal === "blue eyes", "編輯應帶入原值：" + editVal);
  await cdp.eval(`(() => {
    const i = document.querySelector('#loraTrigInput');
    i.value = 'green eyes';
    document.querySelector('#loraTrigSave').click();
  })()`);
  await waitFor(() => cdp.eval("[...document.querySelectorAll('#loraTrigPanel .lora-trig-chip button[data-lora-act=\\\"edit-trig\\\"]')].some(b => b.textContent === 'green eyes')"), "編輯觸發詞");
  ok("觸發詞：可編輯（blue eyes → green eyes）");

  await cdp.eval("[...document.querySelectorAll('#loraTrigPanel .lora-trig-chip')][1].querySelector('[data-lora-act=\"del-trig\"]').click()");
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraTrigPanel .lora-trig-chip').length === 1"), "移除觸發詞");
  await cdp.eval(`(() => { const i = document.querySelector('#loraTrigInput'); i.value = 'green eyes'; document.querySelector('#loraTrigSave').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraTrigPanel .lora-trig-chip').length === 2"), "重新加入觸發詞");
  ok("觸發詞：可移除並重新加入");

  // 8) 關閉自動加入 → 提示詞不含觸發詞
  await cdp.eval(`(() => { const c = document.querySelector('#loraAuto'); c.checked = false; c.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await cdp.eval("document.querySelector('#loraClose2').click()");
  await waitFor(() => cdp.eval("document.querySelector('#loraModal').hidden === true"), "關閉視窗");
  await cdp.eval("document.querySelector('#btnPreview').click()");
  const promptNoAuto = await cdp.eval("document.querySelector('#modalBody .prompt-box').textContent");
  check(!/mock_miku|green eyes/.test(promptNoAuto), "關閉自動加入後不應出現觸發詞：" + promptNoAuto);
  await cdp.eval("document.querySelector('#modal [data-close]').click()");
  ok("關閉自動加入：觸發詞不會進入提示詞");

  // 9) 開啟自動加入、第二個 LoRA、各自權重
  await cdp.eval("document.querySelector('#btnLoraPick').click()");
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraPickList .lora-pick').length === 2"), "重開視窗");
  await cdp.eval(pickRow(MIKU) + '.querySelector("[data-lora-act=\\"triggers\\"]").click()');
  await cdp.eval(`(() => { const c = document.querySelector('#loraAuto'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await cdp.eval(pickRow(LINEART) + '.querySelector(".lora-pick-main").click()');
  await waitFor(() => cdp.eval("document.querySelector('#loraCount').textContent.trim() === '2'"), "加入第二個 LoRA");
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('沒有可讀取的資料')"), "沒有建議詞的提示", 8000);
  ok("沒有 metadata 的 LoRA：仍可選取，面板明確提示可手動新增");
  await cdp.eval(`(() => {
    const set = ${selRow(MIKU)}; const v = 0.9;
    const i = set.querySelector('[data-lora-act="strength"]');
    i.value = String(v); i.dispatchEvent(new Event('input', {bubbles:true})); i.dispatchEvent(new Event('change', {bubbles:true}));
    const row2 = ${selRow(LINEART)};
    const i2 = row2.querySelector('[data-lora-act="strength"]');
    i2.value = '0.55'; i2.dispatchEvent(new Event('input', {bubbles:true})); i2.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  const weights = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.map(x => [x.name, x.strength])");
  check(JSON.stringify(weights) === JSON.stringify([[MIKU, 0.9], [LINEART, 0.55]]), JSON.stringify(weights));
  await cdp.eval("document.querySelector('#loraClose2').click()");
  ok("兩個 LoRA：順序與各自權重（0.9 / 0.55）都存進 ui.loras");

  // 10) 提示詞預覽包含觸發詞 + 使用者描述
  await cdp.eval(`(() => { const p = document.querySelector('#pos'); p.value = 'test extra mock miku'; p.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await cdp.eval("document.querySelector('#btnPreview').click()");
  const promptWithLora = await cdp.eval("document.querySelector('#modalBody .prompt-box').textContent");
  check(promptWithLora.includes("mock miku") && promptWithLora.includes("test extra mock miku"), promptWithLora);
  await cdp.eval("document.querySelector('#modal [data-close]').click()");
  ok("提示詞預覽同時包含 LoRA 觸發詞與使用者描述");

  // 11) 生成 + 生成期間改 UI
  const before = readCapture().length;
  await cdp.eval("document.querySelector('#go').click()");
  await waitFor(() => readCapture().length > before, "Workflow 送出", 20000);
  const cap = readCapture().at(-1);
  // 已送出（mock 延後回應）：此刻改 UI 不可影響已提交內容
  await cdp.eval(`(() => {
    const row = ${selRow(MIKU)};
    const i = row.querySelector('[data-lora-act="strength"]');
    i.value = '0.1'; i.dispatchEvent(new Event('input', {bubbles:true})); i.dispatchEvent(new Event('change', {bubbles:true}));
    (${selRow(LINEART)}).querySelector('[data-lora-act="remove"]').click();
  })()`);
  const nodes = cap.body.prompt;
  const loras = Object.entries(nodes).filter(([, n]) => n.class_type === "LoraLoader");
  check(loras.length === 2, "生成當下應有 2 個 LoraLoader：" + JSON.stringify(loras));
  const [[id8, n8], [id9, n9]] = loras;
  check(n8.inputs.lora_name === MIKU && n9.inputs.lora_name === LINEART, JSON.stringify([n8.inputs, n9.inputs]));
  check(n8.inputs.strength_model === 0.9 && n9.inputs.strength_model === 0.55, "snapshot 權重被 UI 修改污染");
  check(JSON.stringify(n8.inputs.model) === '["1",0]' && JSON.stringify(n9.inputs.model) === '["' + id8 + '",0]', JSON.stringify([n8.inputs.model, n9.inputs.model]));
  check(JSON.stringify(nodes["2"].inputs.clip) === '["' + id9 + '",1]' && JSON.stringify(nodes["3"].inputs.clip) === '["' + id9 + '",1]', "CLIP 鏈接錯");
  check(JSON.stringify(nodes["5"].inputs.model) === '["' + id9 + '",0]', "KSampler MODEL 接錯");
  check(nodes["2"].inputs.text.includes("mock miku") && nodes["2"].inputs.text.includes("test extra mock miku"), nodes["2"].inputs.text);
  check(!nodes["3"].inputs.text.includes("mock_miku"), "觸發詞不該進負面提示詞：" + nodes["3"].inputs.text);
  ok("2 個 LoRA 串接：MODEL／CLIP 鏈、各自權重、觸發詞都正確送出");

  await waitFor(() => cdp.eval("document.querySelectorAll('#stageResults .shot').length > 0 && !document.querySelector('#goText').textContent.includes('生成中')"), "生成完成", 25000);
  const gallery = await cdp.eval("JSON.parse(localStorage.getItem('ui.gallery'))");
  check(gallery[0].loras.length === 2 && gallery[0].loras[0].strength === 0.9, "歷史紀錄應保存生成當下的 LoRA：" + JSON.stringify(gallery[0].loras));
  ok("生成期間改 UI：送出的 Workflow 與歷史紀錄仍是快照（0.9 / 0.55）");

  const uiNow = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.map(x => [x.name, x.strength, x.enabled])");
  check(uiNow.length === 2, "移除操作沒有生效：" + JSON.stringify(uiNow));
  check(uiNow.find(x => x[0] === LINEART)[2] === false, "移除後應保留設定但停用：" + JSON.stringify(uiNow));
  check(uiNow.find(x => x[0] === MIKU)[1] === 0.1, "生成後 UI 權重應是 0.1：" + JSON.stringify(uiNow));
  ok("移除角色＝停用並保留觸發詞設定，不影響已送出的生成");

  const posAfter = await cdp.eval("document.querySelector('#pos').value");
  check(posAfter === "test extra mock miku", "使用者描述被改動：" + posAfter);
  ok("移除 LoRA 不會刪除使用者手動輸入的相同文字");

  const shownImage = await cdp.eval("(() => { const i = document.querySelector('#stageResults .shot img'); return i ? i.getAttribute('src') : ''; })()");
  check(shownImage.includes("/comfy/view?"), shownImage);
  ok("結果圖片仍走 /comfy/view 同源代理");

  // 12) 快速連點選取／取消
  await cdp.eval("document.querySelector('#btnLoraPick').click()");
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraPickList .lora-pick').length === 2"), "重開視窗");
  await cdp.eval(`(() => {
    for (let i = 0; i < 6; i++) {
      const row = ${pickRow(MIKU)};
      row.querySelector('.lora-pick-main').click();
    }
  })()`);
  const rapid = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.filter(x => x.enabled).map(x => x.name)");
  check(rapid.length === 1 && rapid[0] === MIKU, "連點後狀態：" + JSON.stringify(rapid));
  ok("快速連點選取／取消：單一項目、不重複、不崩潰");
  await cdp.eval("document.querySelector('#loraClose2').click()");

  // 12.5) 0 個 LoRA 生成：不可殘留 LoraLoader 節點
  await cdp.eval("document.querySelector('#btnLoraPick').click()");
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraPickList .lora-pick').length === 2"), "重開視窗");
  await cdp.eval(pickRow(MIKU) + '.querySelector(".lora-pick-main").click()');
  await waitFor(() => cdp.eval("document.querySelector('#loraCount').textContent.trim() === '0'"), "全部取消");
  await cdp.eval("document.querySelector('#loraClose2').click()");
  const beforeZero = readCapture().length;
  await cdp.eval("document.querySelector('#go').click()");
  await waitFor(() => readCapture().length > beforeZero, "0 LoRA Workflow 送出", 20000);
  const zeroNodes = readCapture().at(-1).body.prompt;
  check(Object.values(zeroNodes).every(n => n.class_type !== "LoraLoader"), "0 LoRA 仍有 LoraLoader：" + JSON.stringify(Object.keys(zeroNodes)));
  check(Object.keys(zeroNodes).length === 7 && "ckpt_name" in zeroNodes["1"].inputs && zeroNodes["7"].class_type === "SaveImage", "0 LoRA Workflow 節點數不對：" + Object.keys(zeroNodes));
  check(!zeroNodes["2"].inputs.text.includes("mock_miku"), "0 LoRA 不該帶入觸發詞");
  await waitFor(() => cdp.eval("!document.querySelector('#goText').textContent.includes('生成中')"), "0 LoRA 生成完成", 20000);
  ok("0 個 LoRA：Workflow 只有原本 7 個節點，沒有累積 LoRA Loader");

  // 還原一個選取的 LoRA，供後面的「模型消失」測試使用
  await cdp.eval("document.querySelector('#btnLoraPick').click()");
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraPickList .lora-pick').length === 2"), "重開視窗");
  await cdp.eval(pickRow(MIKU) + '.querySelector(".lora-pick-main").click()');
  await waitFor(() => cdp.eval("document.querySelector('#loraCount').textContent.trim() === '1'"), "重新加入 LoRA");
  await cdp.eval("document.querySelector('#loraClose2').click()");

  // 13) 模型從本機消失：標示 + 阻止生成
  await fetch(MOCK + "/__mock/loras", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loras: [LINEART] })
  });
  const beforeBlocked = readCapture().length;
  await cdp.eval("document.querySelector('#go').click()");
  await waitFor(() => cdp.eval("[...document.querySelectorAll('#toasts .toast')].some(t => t.textContent.includes('找不到角色 LoRA'))"), "缺少模型提示", 12000);
  await sleep(1200);
  check(readCapture().length === beforeBlocked, "缺少模型時仍送出 Workflow");
  const missingRow = await cdp.eval("!!document.querySelector('#loraList .lora-row.missing') && document.querySelector('#loraList .lora-note.bad').textContent.includes('找不到')");
  check(missingRow, "缺少模型沒有標示在主畫面");
  ok("模型從本機消失：主畫面標示、生成被阻止並用白話提示");

  // 14) 損壞的 ui.loras 安全回退，不動其他 key
  await cdp.eval(`(() => {
    localStorage.setItem('ui.loras', '{broken json');
    localStorage.setItem('sel', JSON.stringify([{t:'long hair', w:1}]));
    localStorage.setItem('ui.extra', 'keep me');
  })()`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(() => cdp.eval("document.readyState === 'complete' && document.querySelectorAll('#ckpt option').length > 0"), "重新載入");
  const recovered = await cdp.eval(`(() => ({
    count: document.querySelector('#loraCount').textContent.trim(),
    empty: !!document.querySelector('#loraList .lora-empty'),
    sel: localStorage.getItem('sel'),
    extra: localStorage.getItem('ui.extra')
  }))()`);
  check(recovered.count === "0" && recovered.empty, JSON.stringify(recovered));
  check(recovered.sel === JSON.stringify([{ t: "long hair", w: 1 }]) && recovered.extra === "keep me", "其他 key 被動到：" + JSON.stringify(recovered));
  ok("ui.loras 損壞：安全回退空清單，sel / ui.extra 不受影響");

  // 15) 歷史紀錄可讀
  const galleryAfter = await cdp.eval("JSON.parse(localStorage.getItem('ui.gallery') || '[]').length");
  check(galleryAfter >= 1, "歷史資料遺失");
  ok("歷史紀錄可正常讀取（gallery " + galleryAfter + " 筆）");

  // 16) 版面：一屏、不橫向捲動、右欄不裁切（用 2 個 LoRA 的狀態）
  await fetch(MOCK + "/__mock/loras", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loras: [
      "chars\\MockMiku.safetensors", "style/Lineart.safetensors", "legacy\\Old.pt"
    ] })
  });
  await cdp.eval(`localStorage.setItem('ui.loras', ${js(JSON.stringify({
    v: 1, items: [
      { name: MIKU, display: "MockMiku", strength: 0.8, triggers: ["mock_miku", "green eyes", "blue eyes"], autoTrigger: true, enabled: true },
      { name: LINEART, display: "Lineart", strength: 0.65, triggers: ["line art"], autoTrigger: true, enabled: true }
    ]
  }))})`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(() => cdp.eval("document.readyState === 'complete' && document.querySelectorAll('#loraList .lora-row').length === 2"), "2 個 LoRA 重新載入");
  const layout = await cdp.eval(`(async () => {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:-99999px;top:0;width:1920px;height:1080px;border:0';
    fr.src = location.pathname + '?v=layout';
    document.body.appendChild(fr);
    await new Promise(res => { fr.onload = () => setTimeout(res, 900); });
    const d = fr.contentDocument, w = fr.contentWindow;
    const setBody = d.querySelector('.set-body');
    const m = {
      vw: w.innerWidth, vh: w.innerHeight,
      docW: d.documentElement.scrollWidth, docH: d.documentElement.scrollHeight,
      bodyW: d.body.scrollWidth,
      setW: setBody.scrollWidth, setClientW: setBody.clientWidth,
      setH: setBody.scrollHeight, setClientH: setBody.clientHeight,
      rows: d.querySelectorAll('#loraList .lora-row').length,
      loraOverflow: [...d.querySelectorAll('.lora-row, .lora-name')].some(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow === 'visible'),
      head: (() => {
        const h = d.querySelector('.lora-head');
        const a = h.querySelector('.lora-find-link');
        const b = h.querySelector('#btnLoraPick');
        const hr = h.getBoundingClientRect(), ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        return {
          scrollW: h.scrollWidth, clientW: h.clientWidth,
          height: hr.height, linkH: ar.height, btnH: br.height,
          sameRow: Math.abs(ar.top - br.top) < 2,
          inside: ar.left >= hr.left - 1 && br.right <= hr.right + 1
        };
      })()
    };
    fr.remove();
    return m;
  })()`);
  check(layout.docW <= layout.vw && layout.docH <= layout.vh, "1920×1080 出現捲動：" + JSON.stringify(layout));
  check(layout.setW <= layout.setClientW + 1, "右欄被撐寬：" + JSON.stringify(layout));
  check(layout.setH <= layout.setClientH + 1, "右欄出現不必要捲動：" + JSON.stringify(layout));
  check(layout.rows === 2 && !layout.loraOverflow, "LoRA 列排版異常：" + JSON.stringify(layout));
  check(layout.head.scrollW <= layout.head.clientW + 1, "標題列橫向溢出：" + JSON.stringify(layout.head));
  check(layout.head.sameRow && layout.head.inside, "常駐連結與「選擇」未按同列排列或超出標題列：" + JSON.stringify(layout.head));
  check(Math.abs(layout.head.linkH - layout.head.btnH) <= 1 && layout.head.height <= 32,
        "標題列被撐高：" + JSON.stringify(layout.head));
  ok("版面 1920×1080（2 個 LoRA）：標題列無溢出、不換行、不撐高，右欄與整頁都不捲動");

  // 17) 審查回歸：關閉自動加入仍保存觸發詞於快照／歷史，並可由歷史還原
  await cdp.eval("document.querySelector('#btnLoraPick').click()");
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraPickList .lora-pick').length === 2"), "重開視窗");
  await cdp.eval(pickRow(MIKU) + '.querySelector("[data-lora-act=\\"triggers\\"]").click()');
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraTrigPanel .lora-trig-chip').length === 3"), "3 個觸發詞");
  await cdp.eval(`(() => { const c = document.querySelector('#loraAuto'); c.checked = false; c.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await cdp.eval("document.querySelector('#loraClose2').click()");
  const beforeOff = readCapture().length;
  await cdp.eval("document.querySelector('#go').click()");
  await waitFor(() => readCapture().length > beforeOff, "關閉自動加入後生成", 20000);
  const offPos = readCapture().at(-1).body.prompt["2"].inputs.text;
  check(!/mock_miku|green eyes|blue eyes/.test(offPos), "關閉自動加入後觸發詞仍進了 Prompt：" + offPos);
  await waitFor(() => cdp.eval("document.querySelectorAll('#stageResults .shot').length > 0 && !document.querySelector('#goText').textContent.includes('生成中')"), "關閉自動加入生成完成", 20000);
  const offSaved = (await cdp.eval("JSON.parse(localStorage.getItem('ui.gallery'))"))[0].loras.find(l => l.name === MIKU);
  check(offSaved && offSaved.autoTrigger === false, "歷史未保存 autoTrigger=false：" + JSON.stringify(offSaved));
  check(offSaved.personalTriggers.length === 3 && ["mock_miku", "green eyes", "blue eyes"].every(t => offSaved.personalTriggers.includes(t)), "歷史未保存完整觸發詞：" + JSON.stringify(offSaved));
  check(offSaved.strength === 0.8 && offSaved.display === "MockMiku", "歷史未保存名稱／權重：" + JSON.stringify(offSaved));
  ok("關閉自動加入：Prompt 不含觸發詞，歷史仍完整保存 triggers / autoTrigger / 名稱 / 權重");

  // 先故意改壞目前的 UI 設定，再從歷史還原
  await cdp.eval("document.querySelector('#btnLoraPick').click()");
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraPickList .lora-pick').length === 2"), "重開視窗");
  await cdp.eval(pickRow(MIKU) + '.querySelector("[data-lora-act=\\"triggers\\"]").click()');
  await cdp.eval(`(() => {
    const c = document.querySelector('#loraAuto'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true}));
    [...document.querySelectorAll('#loraTrigPanel .lora-trig-chip')][0].querySelector('[data-lora-act="del-trig"]').click();
  })()`);
  await cdp.eval("document.querySelector('#loraClose2').click()");
  await cdp.eval(`(() => {
    const row = ${selRow(MIKU)};
    const i = row.querySelector('[data-lora-act="strength"]');
    i.value = '0.4'; i.dispatchEvent(new Event('input', {bubbles:true})); i.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  const changed = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === 'chars\\\\MockMiku.safetensors')");
  check(changed.autoTrigger === true && changed.personalTriggers.length === 2 && changed.strength === 0.4, "前置改動失敗：" + JSON.stringify(changed));

  await cdp.eval("document.querySelector('#stageResults .shot [data-act=\"restore\"]').click()");
  await cdp.eval("document.querySelector('#modalBody [data-reuse=\"confirm\"]').click()");
  await waitFor(() => cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === 'chars\\\\MockMiku.safetensors').autoTrigger === false"), "歷史還原 autoTrigger");
  const restored = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === 'chars\\\\MockMiku.safetensors')");
  check(restored.autoTrigger === false, "歷史還原未恢復 autoTrigger=false：" + JSON.stringify(restored));
  check(restored.personalTriggers.length === 3 && ["mock_miku", "green eyes", "blue eyes"].every(t => restored.personalTriggers.includes(t)), "歷史還原未恢復完整觸發詞：" + JSON.stringify(restored));
  check(restored.strength === 0.8 && restored.name === MIKU, "歷史還原未恢復名稱／權重：" + JSON.stringify(restored));
  ok("歷史完整還原確認：觸發詞、autoTrigger=false、名稱與權重都恢復");

  // 18) 第二輪審查回歸：loras: [] 要清空；沒有 loras 欄位不可清空
  const synthetic = [
    { url: "/comfy/view?filename=review-empty.png&subfolder=&type=output", filename: "review-empty.png",
      seed: 1, w: 1024, h: 1024, sel: [], extra: "from empty lora record", neg: "",
      prompt: "from empty lora record", loras: [], at: Date.now() - 2000 },
    { url: "/comfy/view?filename=review-old.png&subfolder=&type=output", filename: "review-old.png",
      seed: 2, w: 1024, h: 1024, sel: [], extra: "from old record", neg: "",
      prompt: "from old record", at: Date.now() - 1000 }
  ];
  await cdp.eval(`localStorage.setItem('ui.gallery', ${js(JSON.stringify(synthetic))})`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(() => cdp.eval("document.readyState === 'complete' && document.querySelectorAll('#histBar .thumb').length === 2"), "合成歷史載入");
  check(await cdp.eval("document.querySelector('#loraCount').textContent.trim() !== '0'"), "前置狀態沒有已選 LoRA");

  await cdp.eval("document.querySelector('#histBar .thumb[data-i=\"0\"]').click()");
  await waitFor(() => cdp.eval("document.querySelector('#lightbox').hidden === false"), "空 LoRA 歷史的燈箱");
  await cdp.eval("document.querySelector('#lbRestore').click()");
  await cdp.eval("document.querySelector('#modalBody [data-reuse=\"confirm\"]').click()");
  await waitFor(() => cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.length === 0"), "空 LoRA 清空");
  const cleared = await cdp.eval(`(() => ({
    stored: JSON.parse(localStorage.getItem('ui.loras')).items.length,
    count: document.querySelector('#loraCount').textContent.trim(),
    empty: !!document.querySelector('#loraList .lora-empty'),
    extra: localStorage.getItem('ui.extra')
  }))()`);
  check(cleared.stored === 0 && cleared.count === "0" && cleared.empty, JSON.stringify(cleared));
  check(cleared.extra === "from empty lora record", "歷史提示詞還原失敗：" + cleared.extra);
  ok("歷史 loras: []：清空已選角色，ui.loras 與主畫面都更新為空");

  await cdp.eval("document.querySelector('#btnLoraPick').click()");
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraPickList .lora-pick').length === 2"), "重開視窗");
  await cdp.eval(pickRow(MIKU) + '.querySelector(".lora-pick-main").click()');
  await waitFor(() => cdp.eval("document.querySelector('#loraCount').textContent.trim() === '1'"), "重新選取 LoRA");
  await cdp.eval("document.querySelector('#loraClose2').click()");

  await cdp.eval("document.querySelector('#histBar .thumb[data-i=\"1\"]').click()");
  await waitFor(() => cdp.eval("document.querySelector('#lightbox').hidden === false"), "舊歷史的燈箱");
  await cdp.eval("document.querySelector('#lbPrompt').click()");
  await cdp.eval("document.querySelector('#modalBody [data-positive-reuse=\"confirm\"]').click()");
  await waitFor(() => cdp.eval("localStorage.getItem('ui.extra') === 'from old record'"), "舊歷史還原");
  const kept = await cdp.eval(`(() => ({
    items: JSON.parse(localStorage.getItem('ui.loras')).items.map(x => [x.name, x.enabled]),
    count: document.querySelector('#loraCount').textContent.trim(),
    extra: localStorage.getItem('ui.extra')
  }))()`);
  check(kept.count === "1" && kept.items.length === 1 && kept.items[0][0] === MIKU && kept.items[0][1] === true, JSON.stringify(kept));
  ok("舊歷史沒有 loras 欄位：保留目前 LoRA 設定，不誤清空");

  // 19) API 狀態與文案：正常空清單、HTML、invalid JSON、離線、其他錯誤
  const reopenLora = async () => {
    await cdp.eval("(() => { if (!document.querySelector('#loraModal').hidden) document.querySelector('#loraClose2').click(); })()");
    await cdp.eval("document.querySelector('#btnLoraPick').click()");
  };
  const panelText = () => cdp.eval("document.querySelector('#loraPickList').textContent");
  const waitPanel = (text, label) => waitFor(
    () => cdp.eval(`document.querySelector('#loraPickList').textContent.includes(${js(text)})`), label, 12000);
  // 標題列連結永遠在；空狀態入口只在清單為空時出現
  const checkHeadLink = async label => {
    const n = await cdp.eval(`(() => ({
      head: !!document.querySelector('.lora-head .lora-find-link'),
      total: document.querySelectorAll('a[href="https://civitai.com/models?types=LORA"]').length
    }))()`);
    check(n.head, label + "：標題列常駐連結消失");
    check(n.total === 1, label + "：非 empty 狀態不應有空狀態入口，實際 " + n.total + " 個");
  };

  // A) 正常空清單（200 ok:true loras:[]）
  loraApiOverride = {
    status: 200, type: "application/json; charset=utf-8",
    body: JSON.stringify({ ok: true, comfy: true, count: 0, loras: [] })
  };
  await reopenLora();
  await waitPanel("本機還沒有角色 LoRA", "正常空狀態");
  const emptyInfo = await cdp.eval(`(() => {
    const a = document.querySelector('#loraPickList a');
    return { text: document.querySelector('#loraPickList').textContent,
      href: a && a.href, target: a && a.target, rel: a && a.rel, label: a && a.textContent };
  })()`);
  check(!emptyInfo.text.includes("舊版"), "空狀態出現舊版推論：" + emptyInfo.text);
  check(emptyInfo.href === "https://civitai.com/models?types=LORA" &&
        emptyInfo.target === "_blank" &&
        /noopener/.test(emptyInfo.rel || "") && /noreferrer/.test(emptyInfo.rel || ""),
        "Civitai 入口不正確：" + JSON.stringify(emptyInfo));
  check((emptyInfo.label || "").includes("前往 Civitai 挑選 LoRA"), "入口文案不正確：" + emptyInfo.label);
  const emptyLinks = await cdp.eval(`(() => ({
    head: !!document.querySelector('.lora-head .lora-find-link'),
    total: document.querySelectorAll('a[href="https://civitai.com/models?types=LORA"]').length
  }))()`);
  check(emptyLinks.head && emptyLinks.total === 2, "空清單時應有兩個 Civitai 入口：" + JSON.stringify(emptyLinks));
  ok("API 正常空清單：Modal 既有入口 + 標題列常駐入口（共 2 個），不顯示舊版推論");

  // B) 不完整的成功回應、HTML fallback 與 invalid JSON：只能說格式不正確，不可推論版本、不可冒充空清單
  for (const [label, spec] of [
    ["缺 loras 欄位", { status: 200, type: "application/json; charset=utf-8",
      body: JSON.stringify({ ok: true }) }],
    ["loras 型別錯誤", { status: 200, type: "application/json; charset=utf-8",
      body: JSON.stringify({ ok: true, loras: {} }) }],
    ["HTML 回應", { status: 200, type: "text/html; charset=utf-8",
      body: "<!doctype html><html><body>這是首頁</body></html>" }],
    ["invalid JSON", { status: 200, type: "application/json; charset=utf-8",
      body: "{ this is not json" }]
  ]) {
    loraApiOverride = spec;
    await reopenLora();
    await waitPanel("資料格式不正確", label);
    const txt = await panelText();
    check(!txt.includes("舊版"), label + " 出現舊版推論：" + txt);
    check(!txt.includes("本機還沒有角色 LoRA"), label + " 被當成正常空清單：" + txt);
    check(!(await cdp.eval("!!document.querySelector('#loraPickList a')")), label + " 錯誤狀態不應有空狀態入口");
    await checkHeadLink(label);
    ok(label + "：顯示格式不正確的白話提示，不誤判版本或空清單");
  }

  // D) ComfyUI 離線：必須與空清單、格式錯誤分開
  loraApiOverride = {
    status: 503, type: "application/json; charset=utf-8",
    body: JSON.stringify({ ok: false, comfy: false, code: "COMFY_OFFLINE",
      error: "ComfyUI 沒有連線，讀不到 LoRA 清單。請按右上角狀態列確認 ComfyUI 已啟動，再重新整理。" })
  };
  await reopenLora();
  await waitPanel("ComfyUI 沒有連線", "離線訊息");
  const offlineText = await panelText();
  check(offlineText.includes("狀態列") && !offlineText.includes("本機還沒有角色 LoRA"), offlineText);
  check(!offlineText.includes("舊版"), "離線訊息出現舊版推論：" + offlineText);
  await checkHeadLink("COMFY_OFFLINE");
  ok("COMFY_OFFLINE：顯示 ComfyUI 未連線與狀態列指示，不顯示空狀態");

  // E) 其他 JSON 錯誤：保留後端提供的可靠訊息
  loraApiOverride = {
    status: 502, type: "application/json; charset=utf-8",
    body: JSON.stringify({ ok: false, code: "LORA_LIST_INVALID", error: "清單格式異常（測試自訂錯誤）" })
  };
  await reopenLora();
  await waitPanel("清單格式異常（測試自訂錯誤）", "其他 JSON 錯誤");
  await checkHeadLink("其他 JSON 錯誤");
  ok("其他 JSON 錯誤：沿用後端錯誤碼的訊息，不被通用文案覆蓋");

  // F) 還原真實 API：清單、選取、權重與觸發詞仍正常，且沒有空狀態入口
  loraApiOverride = null;
  await reopenLora();
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraPickList .lora-pick').length === 2"), "還原真實清單");
  const restoredPanel = await panelText();
  check(!restoredPanel.includes("本機還沒有角色 LoRA") && !restoredPanel.includes("資料格式不正確"), restoredPanel);
  check(!(await cdp.eval("!!document.querySelector('#loraPickList a')")), "正常清單不應有平台入口");
  check(await cdp.eval("document.querySelector('#loraCount').textContent.trim() === '1'"), "還原後已選 LoRA 不見了");
  check(await cdp.eval("!!document.querySelector('#loraList [data-lora-act=strength]')"), "還原後權重控制不見了");
  await cdp.eval(pickRow(MIKU) + ".querySelector('[data-lora-act=triggers]').click()");
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('dim 16')"), "還原後 metadata");
  ok("還原真實 API：清單／選取／權重／觸發詞功能正常，不出現空狀態入口");
  await cdp.eval("document.querySelector('#loraClose2').click()");
  // 上面刻意讓 /api/loras 回 503 / 502，Chrome 會記錄資源載入失敗；這些是預期噪訊
  apiStatusTestsDone = true;

  // 20) LoRA 探索中心：入口、Checkpoint 辨識、搜尋、分頁、成熟內容、切換 Checkpoint
  await fetch(MOCKCV + "/__mock/reset", { method: "POST" });
  check(await cdp.eval("!!document.querySelector('.lora-head-actions #btnLoraExplore')"), "探索入口不存在");
  await cdp.eval("document.querySelector('#btnLoraExplore').click()");
  await waitFor(() => cdp.eval("document.querySelector('#exploreModal').hidden === false"), "探索 Modal 開啟");
  await waitFor(() => cdp.eval("document.querySelector('#cvCkptInfo').textContent.includes('Illustrious')"), "Checkpoint 辨識完成", 15000);
  const ckptInfo = await cdp.eval("document.querySelector('#cvCkptInfo').textContent");
  check(ckptInfo.includes("WAI-Nsfw-Illustrious-17.safetensors"), ckptInfo);
  check(ckptInfo.includes("已精確比對檔案"), ckptInfo);
  ok("探索中心：Checkpoint 以精確檔名＋大小辨識為 Illustrious");

  await cdp.eval(`(() => {
    const i = document.querySelector('#cvSearch');
    i.value = 'illustrious'; i.dispatchEvent(new Event('input', {bubbles:true}));
    document.querySelector('#cvGo').click();
  })()`);
  await waitFor(() => cdp.eval("document.querySelectorAll('#cvResults .cv-card').length >= 2"), "搜尋結果");
  const groups = await cdp.eval("[...document.querySelectorAll('#cvResults .cv-group-title')].map(x => x.textContent)");
  check(groups.length >= 2 && groups[0].includes("完全適配"), "嚴格排序沒有把完全適配放最前：" + JSON.stringify(groups));
  check(groups.some(g => g.includes("不建議")), "不建議版本被隱藏：" + JSON.stringify(groups));
  const badges = await cdp.eval("[...document.querySelectorAll('#cvResults .cv-badge')].map(x => x.className)");
  check(badges.some(b => b.includes("exact")) && badges.some(b => b.includes("bad")), JSON.stringify(badges));
  const versionLinks = await cdp.eval("[...document.querySelectorAll('#cvResults .cv-link')].map(a => [a.href, a.target, a.rel])");
  check(versionLinks.length >= 2 && versionLinks.every(x => x[0].includes("civitai.com/models/") && x[0].includes("modelVersionId=") && x[1] === "_blank" && /noopener/.test(x[2])), JSON.stringify(versionLinks[0]));
  ok("探索中心：版本級分類、Strict 排序、不隱藏不建議版本、版本連結正確");

  await cdp.eval("document.querySelector('#cvMore').click()");
  await waitFor(() => cdp.eval("document.querySelectorAll('#cvResults .cv-card').length >= 3"), "載入更多");
  const allQ = await (await fetch(MOCKCV + "/__mock/all")).json();
  check(allQ.some(x => (x.cursor || [""])[0] === "page2"), "載入更多未傳 cursor：" + JSON.stringify(allQ));
  ok("探索中心：以 metadata.nextCursor 載入更多");

  await cdp.eval(`(() => { const c = document.querySelector('#cvNsfw'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await waitFor(() => cdp.eval("document.querySelectorAll('#cvResults .cv-card').length >= 2"), "成熟內容搜尋");
  const allQ2 = await (await fetch(MOCKCV + "/__mock/all")).json();
  check(allQ2.some(x => (x.types || [""])[0] === "LORA" && (x.nsfw || [""])[0] === "true"),
        "成熟內容開關未讓後端帶 nsfw=true：" + JSON.stringify(allQ2));
  ok("探索中心：成熟內容開關只影響 Civitai 搜尋（後端轉為 nsfw=true）");

  // 20.5) 圖片預覽：卡片縮圖、版本隔離、詳細 Modal、切圖、NSFW、失敗降級
  await cdp.eval(`(() => {
    const c = document.querySelector('#cvNsfw'); c.checked = false; c.dispatchEvent(new Event('change', {bubbles:true}));
    const i = document.querySelector('#cvSearch'); i.value = 'images'; i.dispatchEvent(new Event('input', {bubbles:true}));
    document.querySelector('#cvGo').click();
  })()`);
  await waitFor(() => cdp.eval("document.querySelector('#cvResults').textContent.includes('Image Good') && document.querySelector('#cvResults').textContent.includes('Image None')"), "圖片搜尋結果");
  const pvCard = await cdp.eval(`(() => {
    const cards = [...document.querySelectorAll('#cvResults .cv-card')];
    const good = cards.find(c => c.textContent.includes('Image Good'));
    const none = cards.find(c => c.textContent.includes('Image None'));
    const adult = cards.find(c => c.textContent.includes('Image NSFW Model'));
    const img = good && good.querySelector('.cv-thumb img');
    const box = good && good.querySelector('.cv-thumb');
    const r = box && box.getBoundingClientRect();
    return {
      good: !!good, none: !!none,
      src: img ? img.src : '',
      w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0,
      noneThumb: !!(none && none.querySelector('.cv-thumb-none')),
      noneImg: !!(none && none.querySelector('.cv-thumb img')),
      adultPlaceholder: !!(adult && adult.querySelector('.cv-thumb-none')),
      adultImg: !!(adult && adult.querySelector('.cv-thumb img'))
    };
  })()`);
  check(pvCard.good && pvCard.none, "圖片搜尋應有兩張卡：" + JSON.stringify(pvCard));
  check(pvCard.w === 64 && pvCard.h === 80, "卡片縮圖應為 64×80：" + JSON.stringify(pvCard));
  check(pvCard.src.includes('image.civitai.com') && pvCard.src.includes('width=300'), "縮圖應走 CDN width=300：" + pvCard.src);
  check(pvCard.src.includes('/1.jpeg') && !pvCard.src.includes('/99.jpeg'), "縮圖應來自最佳適配版本：" + pvCard.src);
  check(pvCard.noneThumb && !pvCard.noneImg, "無圖片應顯示一致佔位：" + JSON.stringify(pvCard));
  check(pvCard.adultPlaceholder && !pvCard.adultImg, "模型層級 nsfw 在成熟內容關閉時應受保護：" + JSON.stringify(pvCard));
  ok("卡片圖片：64×80 固定縮圖、真實 API 形狀安全圖可見、無圖佔位、模型層級 NSFW 保護、只取最佳適配版本");

  await cdp.eval("document.querySelector('#cvResults .cv-thumb[data-cv-preview]').click()");
  await waitFor(() => cdp.eval("document.querySelector('#modal').hidden === false && !!document.querySelector('#pvMain')"), "詳細預覽開啟");
  const pvOpen = await cdp.eval(`(() => ({
    src: document.querySelector('#pvMain').src,
    strip: document.querySelectorAll('#pvStrip .cv-pv-thumb').length,
    name: document.querySelector('#pvName').textContent,
    base: document.querySelector('#pvBase').textContent,
    badge: document.querySelector('#pvBadge').textContent,
    count: document.querySelector('#pvCount').textContent,
    link: document.querySelector('#pvLink').href,
    main: (() => { const r = document.querySelector('.cv-pv-stage').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    thumb: (() => { const r = document.querySelector('#pvStrip .cv-pv-thumb').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()
  }))()`);
  check(pvOpen.strip === 2, "成熟圖片應被隱藏，縮圖只能有 2 張：" + pvOpen.strip);
  check(pvOpen.src.includes('/1.jpeg') && pvOpen.src.includes('width=300'), "主圖應是最佳版本的縮圖：" + pvOpen.src);
  check(pvOpen.name.includes('Image Good') && pvOpen.base.includes('Illustrious') && pvOpen.badge.includes('完全適配'), JSON.stringify(pvOpen));
  check(pvOpen.count === '圖片 1 / 2', pvOpen.count);
  check(pvOpen.link.includes('/models/700001') && pvOpen.link.includes('modelVersionId='), pvOpen.link);
  check(pvOpen.main[0] === 180 && pvOpen.main[1] === 225, "主圖尺寸：" + JSON.stringify(pvOpen.main));
  check(pvOpen.thumb[0] === 48 && pvOpen.thumb[1] === 60, "縮圖尺寸：" + JSON.stringify(pvOpen.thumb));
  ok("詳細預覽：180×225 主圖、48×60 縮圖、版本／適配資訊、成熟圖片隱藏");

  await cdp.eval("document.querySelectorAll('#pvStrip .cv-pv-thumb')[1].click()");
  check((await cdp.eval("document.querySelector('#pvMain').src")).includes('/2.jpeg'), "點擊縮圖未切換主圖");
  ok("詳細預覽：點擊縮圖切換主圖");

  await cdp.eval(`(() => {
    const im = document.querySelector('#pvMain');
    im.src = 'https://image.civitai.com/broken/1.jpeg';
    im.dispatchEvent(new Event('error'));
  })()`);
  const pvFb1 = await cdp.eval(`(() => { const im = document.querySelector('#pvMain'); return [im.dataset.fallbackDone, im.src]; })()`);
  check(pvFb1[0] === '1' && pvFb1[1].includes('/2.jpeg') && !pvFb1[1].includes('width=300'), "縮圖失敗應退回原圖：" + JSON.stringify(pvFb1));
  await cdp.eval("document.querySelector('#pvMain').dispatchEvent(new Event('error'))");
  const pvFb2 = await cdp.eval(`(() => [document.querySelector('#pvMain').src, document.querySelector('.cv-pv-stage').classList.contains('failed')])()`);
  check(pvFb2[0] === '' && pvFb2[1] === true, "原圖也失敗應顯示降級：" + JSON.stringify(pvFb2));
  ok("詳細預覽：縮圖失敗退回原圖、原圖失敗顯示降級訊息");

  await cdp.eval(`(() => {
    const im = document.querySelector('#cvResults .cv-thumb img');
    im.src = 'https://image.civitai.com/broken/2.jpeg';
    im.dispatchEvent(new Event('error'));
  })()`);
  const cardFb1 = await cdp.eval(`(() => { const im = document.querySelector('#cvResults .cv-thumb img'); return [im.dataset.fallbackDone, im.src]; })()`);
  check(cardFb1[0] === '1' && cardFb1[1].includes('original=true'), "卡片縮圖失敗應退回原圖：" + JSON.stringify(cardFb1));
  await cdp.eval("document.querySelector('#cvResults .cv-thumb img').dispatchEvent(new Event('error'))");
  check(await cdp.eval("document.querySelector('#cvResults .cv-thumb img').hidden === true"), "卡片圖片雙失敗應隱藏，由佔位接管");
  ok("卡片縮圖：兩段式失敗降級，不破圖、不撐版面");

  await cdp.eval("[...document.querySelectorAll('#modal [data-close]')].find(b => b.textContent.includes('關閉')).click()");
  check(await cdp.eval("document.querySelector('#modal').hidden === true"), "詳細預覽無法關閉");
  check(await cdp.eval("document.querySelector('#pvMain').src === ''"), "關閉後應清空主圖 src");
  ok("詳細預覽：關閉後清空圖片資源與事件");

  // 20.6) 成熟內容開啟：明確成熟與未知標記圖片都應依設定顯示
  await cdp.eval(`(() => {
    const c = document.querySelector('#cvNsfw'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  // mock 在 nsfw=true 時回傳獨特項目，確認新回應已套用，而不是讀到上一輪舊 DOM。
  await waitFor(() => cdp.eval("document.querySelector('#cvResults').textContent.includes('Image Nsfw Mode')"), "成熟模式搜尋結果");
  const allQ3 = await (await fetch(MOCKCV + "/__mock/all")).json();
  check(allQ3.some(x => (x.query || [""])[0] === "images" && (x.nsfw || [""])[0] === "true"),
        "成熟模式未讓後端帶 nsfw=true：" + JSON.stringify(allQ3.slice(-2)));
  await cdp.eval("document.querySelector('#cvResults .cv-thumb[data-cv-preview]').click()");
  await waitFor(() => cdp.eval("document.querySelector('#modal').hidden === false && document.querySelectorAll('#pvStrip .cv-pv-thumb').length === 4"), "成熟模式詳細預覽");
  const stripOn = await cdp.eval("[...document.querySelectorAll('#pvStrip .cv-pv-thumb img')].map(i => i.src)");
  check(stripOn.length === 4 && stripOn.some(s => s.includes('/3.jpeg')) && stripOn.some(s => s.includes('/4.jpeg')),
        "成熟模式應顯示 4 張（含成熟與未知）：" + JSON.stringify(stripOn));
  const adultOn = await cdp.eval(`(() => {
    const c = [...document.querySelectorAll('#cvResults .cv-card')].find(x => x.textContent.includes('Image NSFW Model'));
    return c ? { img: !!c.querySelector('.cv-thumb img'), ph: !!c.querySelector('.cv-thumb-none') } : null;
  })()`);
  check(adultOn && adultOn.img && !adultOn.ph, "成熟內容開啟時模型層級 nsfw 圖片應可見：" + JSON.stringify(adultOn));
  ok("成熟內容開啟：明確成熟、未知標記與模型層級 NSFW 圖片皆依設定顯示");
  await cdp.eval("[...document.querySelectorAll('#modal [data-close]')].find(b => b.textContent.includes('關閉')).click()");

  await cdp.eval(`(() => {
    const s = document.querySelector('#ckpt');
    const o = document.createElement('option'); o.value = 'UnknownCkpt.safetensors'; s.appendChild(o);
    s.value = 'UnknownCkpt.safetensors'; s.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor(() => cdp.eval("document.querySelector('#cvCkptInfo').textContent.includes('基底未知')"), "切換 Checkpoint 後重新辨識", 15000);
  await cdp.eval("document.querySelector('#cvGo').click()");
  await waitFor(() => cdp.eval("document.querySelectorAll('#cvResults .cv-card').length >= 2"), "未知基底重新搜尋");
  const unknownBadges = await cdp.eval("[...document.querySelectorAll('#cvResults .cv-badge')].map(x => x.className)");
  check(!unknownBadges.some(b => b.includes("exact")), "Checkpoint 未知卻出現完全適配：" + JSON.stringify(unknownBadges));
  ok("探索中心：切換 Checkpoint 後重新辨識，未知基底不出現完全適配");

  await cdp.eval("document.querySelector('#exploreClose').click()");
  check(await cdp.eval("document.querySelector('#exploreModal').hidden === true"), "探索 Modal 無法關閉");
  ok("探索中心：Modal 可正常關閉，原有 LoRA 選擇按鈕不受影響");

  // 21) Checkpoint 辨識錯誤（429）必須顯示原因，且不得分類為完全適配
  cvStatusOverride = {
    status: 200, type: "application/json; charset=utf-8",
    body: JSON.stringify({
      ok: true,
      checkpoint: { name: "WAI-Nsfw-Illustrious-17.safetensors", size: 6938040682,
                    baseModel: null, confidence: "unknown", source: null, reason: "HTTP_429" },
      error: "Civitai 要求放慢查詢，請等一下再按「搜尋」。"
    })
  };
  await cdp.eval("document.querySelector('#btnLoraExplore').click()");
  await waitFor(() => cdp.eval("document.querySelector('#cvCkptInfo').textContent.includes('放慢查詢')"), "顯示 Checkpoint 辨識錯誤", 15000);
  const errText = await cdp.eval("document.querySelector('#cvCkptInfo').textContent");
  check(errText.includes("基底未知"), errText);
  check(!errText.includes("沒有找到匹配") && !errText.includes("NO_UNIQUE_MATCH"), errText);
  await cdp.eval("document.querySelector('#cvGo').click()");
  await waitFor(() => cdp.eval("document.querySelectorAll('#cvResults .cv-card').length >= 2"), "錯誤狀態下搜尋");
  const errBadges = await cdp.eval("[...document.querySelectorAll('#cvResults .cv-badge')].map(x => x.className)");
  check(!errBadges.some(b => b.includes("exact")), "辨識錯誤時出現完全適配：" + JSON.stringify(errBadges));
  ok("探索中心：Checkpoint 辨識錯誤顯示實際原因，且所有分類維持保守");
  cvStatusOverride = null;
  await cdp.eval("document.querySelector('#exploreClose').click()");

  // ── Phase 2：作者建議 / 個人詞分離 ─────────────────────────
  const waitCvIdle = () => waitFor(() => cdp.eval("(() => { const b = document.querySelector('#loraTrigPanel [data-lora-act=cv-link]'); return !!b && !b.disabled; })()"), "Civitai 可再次讀取", 15000);
  const mockVersion = async (data, code = 200, opts = {}) => {
    const r = await fetch(MOCKCV + "/__mock/version", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ id: data.id, data, code }, opts))
    });
    check(r.ok, "設定 mock Civitai 版本失敗");
  };
  const v1 = { id: 3276795, modelId: 2898222, name: "Illustrious", baseModel: "Illustrious",
    baseModelType: "Standard", trainedWords: ["amora,  blonde hair,, long_hair", "cleavage, black dress"] };
  await mockVersion(v1);
  await cdp.eval("document.querySelector('#btnLoraPick').click()");
  await waitFor(() => cdp.eval("!!document.querySelector('#loraPickList .lora-pick')"), "重開 LoRA Modal");
  await cdp.eval(pickRow(MIKU) + '.querySelector("[data-lora-act=\\"triggers\\"]").click()');
  await waitFor(() => cdp.eval("!!document.querySelector('#loraCvId')"), "觸發詞面板");
  const sections = await cdp.eval("document.querySelectorAll('#loraTrigPanel .lora-section').length");
  check(sections === 3, "應有三個分區（個人/本機/Civitai）：" + sections);
  ok("Phase 2：個人詞、本機建議、Civitai 建議三個分區同時存在");

  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId');
    i.value = 'https://civitai.com/models/2898222?modelVersionId=3276795';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraTrigPanel [data-src=civitai][data-lora-act=add-group]').length === 2"),
    "Civitai 兩組建議載入", 15000);
  const beforeAdd = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").personalTriggers.length");
  await cdp.eval(`document.querySelector('#loraTrigPanel [data-src=civitai][data-g="0"][data-lora-act=add-group]').click()`);
  await waitFor(() => cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").personalTriggers.length >= " + (beforeAdd + 3)), "整組加入");
  await cdp.eval(`document.querySelector('#loraTrigPanel [data-src=civitai][data-g="1"][data-w="1"][data-lora-act=add-word]').click()`);
  await waitFor(() => cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").personalTriggers.includes('black dress')"), "逐詞加入");
  const afterAdd = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ")");
  check(afterAdd.personalTriggers.includes("amora") && afterAdd.personalTriggers.includes("long_hair"), "整組加入失敗：" + JSON.stringify(afterAdd.personalTriggers));
  check(!afterAdd.personalTriggers.some(t => t.includes(",")), "不可把整串逗號文字當成一個詞：" + JSON.stringify(afterAdd.personalTriggers));
  check(afterAdd.noTriggerNeeded === false, "加入個人詞後 noTriggerNeeded 應為 false");
  check(afterAdd.authorSuggestions.local.groups.length >= 1, "本機建議不可被 Civitai 更新清掉");
  check(afterAdd.authorSuggestions.civitai.versionId === 3276795, "版本連結未保存");
  ok("Phase 2：整組／逐詞加入只進個人 triggers，保留順序與本機建議");

  await cdp.eval("document.querySelector('#btnPreview').click()");
  const p2 = await cdp.eval("document.querySelector('#modalBody .prompt-box').textContent");
  check(p2.includes("amora") && p2.includes("black dress") && !p2.includes("cleavage"), "只注入個人詞：" + p2);
  await cdp.eval("document.querySelector('#modal [data-close]').click()");
  ok("Phase 2：只有個人 triggers 會進入 Prompt，未選的作者建議不會注入");

  // noTriggerNeeded 狀態轉換
  await cdp.eval("document.querySelector('[data-lora-act=no-trigger]').click()");
  check(await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").noTriggerNeeded === true"), "確認不需要");
  await cdp.eval(`(() => { const i = document.querySelector('#loraTrigInput');
    i.value = 'extra personal'; document.querySelector('#loraTrigSave').click(); })()`);
  check(await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").noTriggerNeeded === false"), "手動新增應取消確認");
  await cdp.eval("document.querySelector('[data-lora-act=no-trigger]').click()");
  await cdp.eval(`(() => { const c = document.querySelector('#loraAuto'); c.checked = false; c.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  check(await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").noTriggerNeeded === true"), "autoTrigger 不應改變確認狀態");
  await cdp.eval(`(() => { const c = document.querySelector('#loraAuto'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await cdp.eval(`(() => { for (let i = 0; i < 40; i++) {
    const b = document.querySelector('#loraTrigPanel [data-lora-act=del-trig]');
    if (!b) break; b.click();
  } })()`);
  check(await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").noTriggerNeeded === true"), "刪光個人詞不可自動改為尚未確認");
  ok("Phase 2：noTriggerNeeded 六種狀態轉換正確");

  // 作者建議更新不覆蓋個人詞；不同版本不混在一起
  const keep = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").personalTriggers.join('|')");
  const v2 = { id: 3276796, modelId: 2898222, name: "v2", baseModel: "Illustrious",
    baseModelType: "Standard", trainedWords: ["new secret", "new hair"] };
  await mockVersion(v2);
  await waitCvIdle();
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '3276796';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('已選版本：3276796')"), "切換版本", 15000);
  await sleep(1500);
  check(await cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('new secret')"),
        "新版本建議未顯示：" + await cdp.eval("document.querySelector('#loraTrigPanel').textContent.slice(-200)"));
  const updated = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ")");
  check(updated.personalTriggers.join("|") === keep, "作者建議更新不可動個人詞：" + JSON.stringify(updated.personalTriggers));
  check(!updated.authorSuggestions.civitai.groups.some(g => g.includes("amora")), "不同版本的建議不可混在一起");
  ok("Phase 2：作者 metadata 更新只換建議，個人詞與舊版本都不回退");

  // 無建議 vs API 故障
  await mockVersion({ id: 3276801, modelId: 9, name: "empty", trainedWords: [] });
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '3276801';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('這個來源沒有提供建議詞')"), "空建議狀態", 15000);
  ok("Phase 2：沒有 trainedWords 顯示為正常空建議，不是 API 故障");
  await mockVersion({ id: 3276802, modelId: 9, name: "broken", trainedWords: [] }, 404);
  cvVersion404TestsDone = true;
  await waitCvIdle();
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '3276802';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('取得失敗')"), "Civitai 404 狀態", 15000);
  const afterErr = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ")");
  check(afterErr.authorSuggestions.civitai.versionId === 3276802, "取得失敗也應保留版本連結");
  check(afterErr.personalTriggers.join("|") === keep, "API 失敗不可動個人詞");
  ok("Phase 2：Civitai 取得失敗有獨立狀態，不破壞既有設定");

  // ── Civitai 建議詞 UX：指引、保留輸入、重試、避免重複請求 ─────
  const cvHelp = await cdp.eval("document.querySelector('#loraTrigPanel').textContent");
  check(cvHelp.includes("跟你下載的檔案相同的版本") && cvHelp.includes("civitai.com/models/2898222?modelVersionId=3276795"),
        "缺少取得網址的簡單指引與範例");
  check(cvHelp.includes("不知道怎麼設定可以直接略過，不影響生圖"), "缺少選用功能說明");
  check(cvHelp.includes("取消版本連結") && cvHelp.includes("不會刪除你自己的觸發詞"), "取消連結文案不清楚");
  ok("Civitai UX：一般使用者看得懂如何取得網址、知道可略過、取消連結不刪詞");

  const triggersBeforeUx = await cdp.eval("JSON.stringify(JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").personalTriggers)");
  await waitCvIdle();
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = 'not-a-url';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  const badToast = await cdp.eval("[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' | ')");
  check(/請貼上模型頁面的網址/.test(badToast), "不正確網址應有清楚提示：" + badToast);
  check((await cdp.eval("document.querySelector('#loraCvId').value")) === "not-a-url", "不正確網址也要保留輸入");
  ok("Civitai UX：不正確網址有提示且保留輸入");

  await mockVersion({ id: 3277300, modelId: 9, name: "fail first", trainedWords: [] }, 500);
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '3277300';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('取得失敗')"), "失敗狀態", 15000);
  check((await cdp.eval("document.querySelector('#loraCvId').value")) === "3277300", "失敗後不可清空輸入");
  await mockVersion({ id: 3277300, modelId: 9, name: "retry ok", trainedWords: ["retry ok"] });
  await waitCvIdle();
  await cdp.eval("document.querySelector('[data-lora-act=cv-link]').click()");
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('retry ok')"), "不重新輸入直接重試", 15000);
  ok("Civitai UX：讀取失敗保留輸入，可直接按「重新讀取」重試");

  await mockVersion({ id: 3277301, modelId: 9, name: "slow", trainedWords: ["slow ok"] }, 200, { delay_ms: 1200 });
  await waitCvIdle();
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '3277301';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  check(await cdp.eval("document.querySelector('#loraTrigPanel [data-lora-act=cv-link]').disabled === true"), "讀取中應禁用按鈕");
  await cdp.eval("document.querySelector('[data-lora-act=cv-link]').click()");
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('正在讀取，請稍候')"), "讀取中狀態", 15000);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('slow ok')"), "讀取完成", 15000);
  ok("Civitai UX：讀取中有明確狀態且不能重複點擊造成干擾");

  await mockVersion({ id: 3277302, modelId: 9, name: "keep", trainedWords: ["keep word"] });
  await waitCvIdle();
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '3277302';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('keep word')"), "首次成功", 15000);
  const beforeRefresh = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ")");
  cvVersionStaleTestsDone = true;
  cvVersionOverride = { status: 500, type: "application/json; charset=utf-8",
    body: JSON.stringify({ ok: false, error: "測試更新失敗" }) };
  await waitCvIdle();
  await cdp.eval("document.querySelector('[data-lora-act=cv-link]').click()");
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('仍顯示先前已取得的建議')"), "更新失敗保留舊資料", 15000);
  cvVersionOverride = null;
  const afterRefresh = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ")");
  check(afterRefresh.authorSuggestions.civitai.groups.some(g => g.includes("keep word")), "更新失敗不可清掉舊建議");
  check(JSON.stringify(afterRefresh.personalTriggers) === JSON.stringify(beforeRefresh.personalTriggers), "更新失敗不可動個人觸發詞");
  check(JSON.stringify(afterRefresh.authorSuggestions.local) === JSON.stringify(beforeRefresh.authorSuggestions.local), "更新失敗不可動本機建議");
  ok("Civitai UX：同版本更新失敗時保留先前成功資料");

  const localBeforeUnlink = await cdp.eval("JSON.stringify(JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").authorSuggestions.local)");
  await cdp.eval("document.querySelector('[data-lora-act=cv-unlink]').click()");
  await waitFor(() => cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").authorSuggestions.civitai.versionId === null"), "取消版本連結");
  const afterUnlink = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ")");
  const triggersAfterUnlink = await cdp.eval("JSON.stringify(JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").personalTriggers)");
  check(triggersAfterUnlink === triggersBeforeUx, "取消連結不可刪個人觸發詞");
  check(JSON.stringify(afterUnlink.authorSuggestions.local) === localBeforeUnlink, "取消連結不可清本機建議");
  const unlinkToast = await cdp.eval("[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' | ')");
  check(/你自己的觸發詞都還在/.test(unlinkToast), "取消連結要有明確回饋：" + unlinkToast);
  ok("Civitai UX：取消版本連結不刪個人詞、不清本機建議，且有明確回饋");

  // ── 審查修正一：40 詞上限與 toast 數量一致 ─────────────────
  // 面板仍開著：先清空個人詞，再多筆輸入到 39 個（不靠 reload）
  await cdp.eval(`(() => { for (let i = 0; i < 40; i++) {
    const b = document.querySelector('#loraTrigPanel [data-lora-act=del-trig]');
    if (!b) break; b.click();
  } })()`);
  await cdp.eval(`(() => { const i = document.querySelector('#loraTrigInput');
    i.value = Array.from({length: 39}, (_, k) => 'filled' + k).join(',');
    document.querySelector('#loraTrigSave').click(); })()`);
  await waitFor(() => cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").personalTriggers.length === 39"), "填入 39 詞");
  const copy = await cdp.eval("document.querySelector('#loraTrigPanel').textContent");
  check(copy.includes("這是選用功能，不知道怎麼設定可以直接略過，不影響生圖"), "缺少選用功能說明");
  check(copy.includes("我的觸發詞") && copy.includes("從模型檔案讀取的建議詞") && copy.includes("Civitai 作者提供的建議詞"), "一般使用者文案未更新");
  ok("審查修正：Civitai 明確標示為選用功能，文案不使用內部技術名詞");

  await mockVersion(v1);
  await waitCvIdle();
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '3276795';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraTrigPanel [data-src=civitai][data-lora-act=add-group]').length === 2"), "建議群組載入", 15000);
  await cdp.eval(`document.querySelector('#loraTrigPanel [data-src=civitai][data-g="0"][data-lora-act=add-group]').click()`);
  await waitFor(() => cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").personalTriggers.length === 40"), "只加入 1 個");
  const capToast = await cdp.eval("[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' | ')");
  check(/已加入 1 個觸發詞/.test(capToast) && /還有 2 個沒加入/.test(capToast), "toast 與保存結果不一致：" + capToast);
  await cdp.eval(`document.querySelector('#loraTrigPanel [data-src=civitai][data-g="1"][data-w="1"][data-lora-act=add-word]').click()`);
  const fullToast = await cdp.eval("[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' | ')");
  check(/已滿/.test(fullToast), "滿額時不可顯示成功：" + fullToast);
  check(await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").personalTriggers.length === 40"), "滿額後不可再增加");
  ok("審查修正：40 詞上限只加可容納的詞，toast 回報實際數量與未加入數");

  // ── 審查修正三：過期請求的失敗不得覆蓋新版本 ───────────────
  cvVersionStaleTestsDone = true;
  await mockVersion({ id: 3277100, modelId: 9, name: "A fail", trainedWords: ["old word"] }, 500);
  await waitCvIdle();
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '3277100';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('取得失敗')"), "舊版本失敗", 15000);
  await mockVersion({ id: 3277101, modelId: 9, name: "B ok", trainedWords: ["fresh word"] });
  await waitCvIdle();
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '3277101';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('已選版本：3277101') && document.querySelector('#loraTrigPanel').textContent.includes('fresh word')"), "新版本成功", 15000);
  const staleTxt = await cdp.eval("document.querySelector('#loraTrigPanel').textContent");
  check(!staleTxt.includes("取得失敗"), "舊版本的延遲失敗覆蓋了新版本狀態");
  check(staleTxt.includes("fresh word"), "新版本建議消失");
  const afterStale = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ")");
  check(afterStale.personalTriggers.length === 40, "過期請求不可動個人觸發詞");
  check(afterStale.authorSuggestions.local.groups.length >= 1, "過期請求不可清掉本機建議");
  ok("審查修正：舊版本延遲失敗不污染新版本狀態，個人詞與本機建議完好");

  // ── 第二輪審查：兩組合計 60 個建議詞，不能靜默遺失 20 個 ─────
  const manyA = Array.from({ length: 30 }, (_, i) => "manyA" + i);
  const manyB = Array.from({ length: 30 }, (_, i) => "manyB" + i);
  await mockVersion({ id: 3277200, modelId: 9, name: "many",
    trainedWords: [manyA.join(", "), manyB.join(", ")] });
  await cdp.eval(`(() => { for (let i = 0; i < 40; i++) {
    const b = document.querySelector('#loraTrigPanel [data-lora-act=del-trig]');
    if (!b) break; b.click();
  } })()`);
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '3277200';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraTrigPanel [data-src=civitai][data-lora-act=add-group]').length === 2"), "兩組建議載入", 15000);
  await cdp.eval(`document.querySelector('#loraTrigPanel [data-src=civitai][data-g="0"][data-lora-act=add-group]').click()`);
  await waitFor(() => cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").personalTriggers.length === 30"), "第一組 30 詞");
  await cdp.eval(`document.querySelector('#loraTrigPanel [data-src=civitai][data-g="1"][data-lora-act=add-group]').click()`);
  await waitFor(() => cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").personalTriggers.length === 40"), "第二組只加入 10 詞");
  const manyToast = await cdp.eval("[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' | ')");
  check(/已加入 10 個觸發詞/.test(manyToast) && /還有 20 個沒加入/.test(manyToast), "60 詞合併的 toast 不正確：" + manyToast);
  const savedMany = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ")");
  check(savedMany.personalTriggers.length === 40 && savedMany.personalTriggers[0] === "manyA0" && savedMany.personalTriggers[39] === "manyB9",
        "實際保存內容與順序不正確：" + JSON.stringify(savedMany.personalTriggers.slice(-3)));
  ok("第二輪審查：60 個建議詞只存 40，toast 明確回報另外 20 個未加入");

  // ── 第二輪審查修正（R2）：首次連結 / 重新讀取 / 讀取中 請求計數 ──
  await waitCvIdle();
  const cvLsMiku = () => cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ")");
  const cvPanelText = () => cdp.eval("document.querySelector('#loraTrigPanel').textContent");

  // R2-C1：第一次連結尚未連結過的版本 → 讀取成功 → /api/civitai/version 只實際呼叫一次
  await mockVersion({ id: 990101, modelId: 9, name: "count-first", trainedWords: ["count word"] });
  const cvCountStart1 = cvVersionReqCount;
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '990101';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('count word')"), "首次讀取成功", 15000);
  await sleep(300);
  check(cvVersionReqCount - cvCountStart1 === 1,
        "首次連結 /api/civitai/version 應只呼叫一次，實際 " + (cvVersionReqCount - cvCountStart1));
  ok("R2：首次連結只發出一個 /api/civitai/version 請求");

  // R2-C2：同版本手動重新讀取 → 只增加一次請求
  await waitCvIdle();
  const cvCountStart2 = cvVersionReqCount;
  await cdp.eval("document.querySelector('[data-lora-act=cv-link]').click()");
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('count word')"), "重新讀取成功", 15000);
  await sleep(300);
  check(cvVersionReqCount - cvCountStart2 === 1,
        "同版本手動重新讀取應只增加一次請求，實際 " + (cvVersionReqCount - cvCountStart2));
  ok("R2：同版本重新讀取只增加一個請求");

  // R2-C3：讀取中重複點擊不增加請求（按鈕禁用 + 防重複 + 序號世代）
  await mockVersion({ id: 990102, modelId: 9, name: "slow-count", trainedWords: ["slow count"] }, 200, { delay_ms: 1500 });
  await waitCvIdle();
  const cvCountStart3 = cvVersionReqCount;
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '990102';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await cdp.eval(`(() => { for (let k = 0; k < 5; k++) {
    const b = document.querySelector('[data-lora-act=cv-link]'); if (b) b.click(); } })()`);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('slow count')"), "讀取完成", 15000);
  await sleep(300);
  check(cvVersionReqCount - cvCountStart3 === 1,
        "讀取中重複點擊不得增加請求，實際 " + (cvVersionReqCount - cvCountStart3));
  ok("R2：讀取中重複點擊不增加請求");

  // ── 第二輪審查修正（R2）：真正延遲重疊競態 ───────────────
  // R2-B1：A 延遲成功回應期間，取消版本連結並連結 B → A 的舊回應不得污染 B
  const raceAok = { id: 990201, modelId: 9, name: "A-slow", trainedWords: ["A only"] };
  const raceB1 = { id: 990202, modelId: 9, name: "B", trainedWords: ["B fresh"] };
  await mockVersion(raceAok, 200, { delay_ms: 1800 });
  await mockVersion(raceB1, 200);
  await waitCvIdle();
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '990201';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel [data-lora-act=cv-link]').disabled === true"), "A 讀取中", 15000);
  await cdp.eval("document.querySelector('[data-lora-act=cv-unlink]').click()");                 // 讀取中取消版本連結
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '990202';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);                         // 立即連結 B
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('B fresh')"), "B 成功", 15000);
  await sleep(2200);                                                                             // 等 A 的延遲回應完成
  const afterAokTxt = await cvPanelText();
  const afterAok = await cvLsMiku();
  check(afterAok.authorSuggestions.civitai.versionId === 990202, "A 舊回應不得覆蓋 B 版本：" + JSON.stringify(afterAok.authorSuggestions.civitai.versionId));
  check(!afterAok.authorSuggestions.civitai.groups.some(g => g.some(w => /A only/.test(w))), "A 舊建議詞不得覆蓋 B：" + JSON.stringify(afterAok.authorSuggestions.civitai.groups));
  check(afterAok.authorSuggestions.civitai.groups.some(g => g.includes("B fresh")), "B 建議詞必須保留：" + JSON.stringify(afterAok.authorSuggestions.civitai.groups));
  check(afterAokTxt.includes("B fresh") && !afterAokTxt.includes("A only"), "A 舊回應不得覆蓋顯示");
  check(afterAokTxt.includes("已選版本：990202") && !afterAokTxt.includes("取得失敗"), "A 舊回應不得覆蓋狀態");
  check(await cdp.eval("document.querySelector('[data-lora-act=cv-link]').disabled === false"), "A 舊回應後不可卡在讀取中");
  ok("R2：A 延遲成功 + 讀取中取消 + 連結 B，A 舊回應不污染 B 版本/建議/狀態");

  // R2-B2：A 延遲失敗回應期間，取消版本連結並連結 B → A 的舊失敗不得污染 B
  const raceAfail = { id: 990203, modelId: 9, name: "A-fail", trainedWords: ["A only"] };
  const raceB2 = { id: 990204, modelId: 9, name: "B2", trainedWords: ["B2 fresh"] };
  await mockVersion(raceAfail, 500, { delay_ms: 1800 });
  await mockVersion(raceB2, 200);
  await waitCvIdle();
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '990203';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel [data-lora-act=cv-link]').disabled === true"), "A 讀取中", 15000);
  await cdp.eval("document.querySelector('[data-lora-act=cv-unlink]').click()");
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '990204';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('B2 fresh')"), "B 成功", 15000);
  await sleep(2200);
  const afterAfailTxt = await cvPanelText();
  const afterAfail = await cvLsMiku();
  check(afterAfail.authorSuggestions.civitai.versionId === 990204, "A 舊失敗不得覆蓋 B 版本");
  check(afterAfail.authorSuggestions.civitai.groups.some(g => g.includes("B2 fresh")), "A 舊失敗不得清掉 B 建議");
  check(afterAfailTxt.includes("B2 fresh") && !afterAfailTxt.includes("取得失敗"), "A 舊失敗不得覆蓋 B 狀態");
  check(!afterAfail.authorSuggestions.civitai.groups.some(g => g.some(w => /A only/.test(w))), "A 舊建議不得混入 B");
  ok("R2：A 延遲失敗 + 讀取中取消 + 連結 B，A 舊失敗不污染 B");

  // R2-B3：取消後重新連結相同版本 → 先前延遲請求的舊回應不得污染新一次操作
  const raceSame = { id: 990301, modelId: 9, name: "A-old", trainedWords: ["A old word"] };
  await mockVersion(raceSame, 200, { delay_ms: 1800 });                                          // op1：延遲 + 舊資料
  await waitCvIdle();
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '990301';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel [data-lora-act=cv-link]').disabled === true"), "op1 讀取中", 15000);
  await cdp.eval("document.querySelector('[data-lora-act=cv-unlink]').click()");                 // 取消
  await mockVersion({ id: 990301, modelId: 9, name: "A-new", trainedWords: ["A new word"] }, 200); // 同版本改新資料、不延遲
  await cdp.eval(`(() => { const i = document.querySelector('#loraCvId'); i.value = '990301';
    document.querySelector('[data-lora-act="cv-link"]').click(); })()`);                         // 重新連結相同版本
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('A new word')"), "op2 成功", 15000);
  await sleep(2200);                                                                             // 等 op1 延遲回應完成
  const afterSameTxt = await cvPanelText();
  const afterSame = await cvLsMiku();
  check(afterSame.authorSuggestions.civitai.versionId === 990301, "版本應為重新連結的同一版本");
  check(afterSame.authorSuggestions.civitai.groups.some(g => g.includes("A new word")), "op2 建議詞必須保留：" + JSON.stringify(afterSame.authorSuggestions.civitai.groups));
  check(!afterSame.authorSuggestions.civitai.groups.some(g => g.some(w => /A old word/.test(w))), "op1 舊資料不得污染 op2：" + JSON.stringify(afterSame.authorSuggestions.civitai.groups));
  check(afterSameTxt.includes("A new word") && !afterSameTxt.includes("A old word"), "op1 舊回應不得覆蓋顯示");
  check(!afterSameTxt.includes("取得失敗"), "op1 舊失敗/舊回應不得覆蓋狀態");
  check(await cdp.eval("document.querySelector('[data-lora-act=cv-link]').disabled === false"), "op1 舊回應後不可卡在讀取中");
  ok("R2：取消後重新連結相同版本，先前延遲請求不污染新一次操作");

  // ── 最後 E2E：真 DOM 點擊本機「全部加入我的觸發詞」─────────
  // 產品檔案不改動；只對這個隔離分頁提供一份測試版 app.js，
  // 讓 /api/lora-meta 的巢狀 triggerWords 能形成兩組本機建議。
  const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const oldLine = "const next = loraNormGroups([Array.isArray(groups) ? groups : []]);";
  const newLine = "const next = loraNormGroups(Array.isArray(groups) && groups.length && Array.isArray(groups[0]) ? groups : [Array.isArray(groups) ? groups : []]);";
  check(appSrc.includes(oldLine), "找不到 loraSetLocalGroups 的測試替換點");
  appJsOverride = { status: 200, type: "application/javascript; charset=utf-8",
    body: appSrc.replace(oldLine, newLine) };
  loraMetaOverride = { status: 200, type: "application/json; charset=utf-8",
    body: JSON.stringify({ ok: true, meta: {
      architecture: "test-local", triggerWords: [manyA, manyB]
    }}) };
  await cdp.send("Fetch.enable", { patterns: [
    { urlPattern: "*/api/loras*", requestStage: "Request" },
    { urlPattern: "*/api/civitai/status*", requestStage: "Request" },
    { urlPattern: "*/api/lora-meta*", requestStage: "Request" },
    { urlPattern: "*/api/civitai/version*", requestStage: "Request" },
    { urlPattern: "*/app.js*", requestStage: "Request" }
  ] });
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(() => cdp.eval("document.readyState === 'complete' && !!document.querySelector('#btnLoraPick')"),
    "fixture reload", 25000);
  await cdp.eval("document.querySelector('#btnLoraPick').click()");
  await waitFor(() => cdp.eval("!!document.querySelector('#loraPickList .lora-pick')"), "重開 LoRA Modal");
  await cdp.eval(pickRow(MIKU) + '.querySelector("[data-lora-act=\\"triggers\\"]").click()');
  await waitFor(() => cdp.eval("document.querySelectorAll('#loraTrigPanel [data-src=local][data-lora-act=add-group]').length === 2"),
    "本機建議區顯示兩組", 15000);
  await cdp.eval(`(() => { for (let i = 0; i < 40; i++) {
    const b = document.querySelector('#loraTrigPanel [data-lora-act=del-trig]');
    if (!b) break; b.click();
  } })()`);
  check(await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").personalTriggers.length === 0"),
        "個人觸發詞必須先清空");
  const otherBeforeLocalAll = await cdp.eval("JSON.stringify(JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(LINEART) + "))");
  const posBeforeLocalAll = await cdp.eval("document.querySelector('#pos').value");
  await cdp.eval("document.querySelector('#loraTrigPanel [data-lora-act=use-meta]').click()");
  await waitFor(() => cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ").personalTriggers.length === 40"),
    "全部加入本機建議", 15000);
  const localAll = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(MIKU) + ")");
  const expected = manyA.concat(manyB.slice(0, 10));
  check(JSON.stringify(localAll.personalTriggers) === JSON.stringify(expected),
        "本機全部加入的順序/內容不正確：" + JSON.stringify(localAll.personalTriggers.slice(-3)));
  check(localAll.noTriggerNeeded === false, "實際加入後 noTriggerNeeded 應為 false");
  const localAllToast = await cdp.eval("[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' | ')");
  check(/已加入 40 個觸發詞/.test(localAllToast) && /還有 20 個沒加入/.test(localAllToast),
        "本機全部加入的 toast 不正確：" + localAllToast);
  const otherAfterLocalAll = await cdp.eval("JSON.stringify(JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === " + js(LINEART) + "))");
  check(otherAfterLocalAll === otherBeforeLocalAll, "不可改變其他 LoRA 設定");
  check((await cdp.eval("document.querySelector('#pos').value")) === posBeforeLocalAll,
        "不可改變使用者描述");
  ok("最後 E2E：真 DOM 點擊本機『全部加入我的觸發詞』，40 詞保存、20 詞明確回報");
  appJsOverride = null;
  loraMetaOverride = null;

  await cdp.eval("document.querySelector('#loraClose2').click()");

  const errs = consoleErrors();
  check(errs.length === 0, "Console 有錯誤：" + JSON.stringify(errs));
  ok("Console 沒有非預期錯誤");

  console.log("\n" + passed + " UI tests passed");
} catch (e) {
  console.error("\nFAIL " + (e && e.message));
  if (cdp) {
    try { console.error("URL: " + await cdp.eval("location.href")); } catch (err) { /* ignore */ }
    try { console.error("toasts: " + await cdp.eval("[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' | ')")); } catch (err) { /* ignore */ }
  }
  process.exitCode = 1;
} finally {
  if (cdp) cdp.close();
  if (chrome) { try { chrome.kill(); } catch (e) { /* ignore */ } }
  await sleep(300);
  if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
}
