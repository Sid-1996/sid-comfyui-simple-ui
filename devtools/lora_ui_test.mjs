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

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const UI = args.ui || "http://127.0.0.1:7861";
const MOCK = args.mock || "http://127.0.0.1:18188";
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
  let apiStatusTestsDone = false;
  cdp.on("Fetch.requestPaused", async p => {
    try {
      if (loraApiOverride && /\/api\/loras(?:\?|$)/.test(p.request.url)) {
        await cdp.send("Fetch.fulfillRequest", {
          requestId: p.requestId,
          responseCode: loraApiOverride.status || 200,
          responseHeaders: [
            { name: "Content-Type", value: loraApiOverride.type || "application/json; charset=utf-8" },
            { name: "Cache-Control", value: "no-store" }
          ],
          body: Buffer.from(loraApiOverride.body || "", "utf8").toString("base64")
        });
      } else {
        await cdp.send("Fetch.continueRequest", { requestId: p.requestId });
      }
    } catch (e) { /* ignore */ }
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/loras*", requestStage: "Request" }] });

  // 2) 開頁並等 app 就緒
  await cdp.send("Page.navigate", { url: UI + "/?v=lora-e2e" });
  await waitFor(() => cdp.eval("document.readyState === 'complete' && document.querySelectorAll('#ckpt option').length > 0"), "app 載入");
  await waitFor(() => cdp.eval("document.querySelector('#statusText').textContent.includes('已連線')"), "ComfyUI 狀態列");
  ok("頁面載入、ComfyUI 狀態列顯示已連線");

  const consoleErrors = () => cdp.events
    .filter(e => (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") ||
                 (e.method === "Log.entryAdded" && e.params.entry.level === "error"))
    .map(e => e.method === "Log.entryAdded" ? e.params.entry.text
      : e.params.args.map(a => a.value || a.description || "").join(" "))
    .filter(t => !/websocket|\/ws|favicon/i.test(t))
    .filter(t => !(apiStatusTestsDone && /Failed to load resource: the server responded with a status of (503|502)/.test(t)));

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
  await cdp.eval(pickRow(MIKU) + '.querySelector(".lora-pick-main").click()');
  await waitFor(() => cdp.eval("document.querySelector('#loraCount').textContent.trim() === '1'"), "加入 LoRA");
  const stored = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras'))");
  check(stored.v === 1 && stored.items.length === 1, JSON.stringify(stored));
  check(stored.items[0].name === MIKU && stored.items[0].enabled === true, JSON.stringify(stored.items[0]));
  check(stored.items[0].strength === 0.8, "預設權重應為 0.8：" + stored.items[0].strength);
  ok("加入 LoRA：主畫面計數、ui.loras 預設值（0.8）正確");

  // 7) 觸發詞：metadata、去重、編輯
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
  await waitFor(() => cdp.eval("document.querySelector('#loraTrigPanel').textContent.includes('沒有可讀取的 metadata')"), "沒有 metadata 的提示", 8000);
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
  check(promptWithLora.includes("mock_miku") && promptWithLora.includes("test extra mock miku"), promptWithLora);
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
  check(nodes["2"].inputs.text.includes("mock_miku") && nodes["2"].inputs.text.includes("test extra mock miku"), nodes["2"].inputs.text);
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
  check(offSaved.triggers.length === 3 && ["mock_miku", "green eyes", "blue eyes"].every(t => offSaved.triggers.includes(t)), "歷史未保存完整觸發詞：" + JSON.stringify(offSaved));
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
  check(changed.autoTrigger === true && changed.triggers.length === 2 && changed.strength === 0.4, "前置改動失敗：" + JSON.stringify(changed));

  await cdp.eval("document.querySelector('#stageResults .shot [data-act=\"prompt\"]').click()");
  await waitFor(() => cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === 'chars\\\\MockMiku.safetensors').autoTrigger === false"), "歷史還原 autoTrigger");
  const restored = await cdp.eval("JSON.parse(localStorage.getItem('ui.loras')).items.find(x => x.name === 'chars\\\\MockMiku.safetensors')");
  check(restored.autoTrigger === false, "歷史還原未恢復 autoTrigger=false：" + JSON.stringify(restored));
  check(restored.triggers.length === 3 && ["mock_miku", "green eyes", "blue eyes"].every(t => restored.triggers.includes(t)), "歷史還原未恢復完整觸發詞：" + JSON.stringify(restored));
  check(restored.strength === 0.8 && restored.name === MIKU, "歷史還原未恢復名稱／權重：" + JSON.stringify(restored));
  ok("歷史「同提示詞」還原：完整觸發詞、autoTrigger=false、名稱與權重都恢復");

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
  await cdp.eval("document.querySelector('#lbPrompt').click()");
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
