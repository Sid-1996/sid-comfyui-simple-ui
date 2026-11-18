// cdp_lib.mjs — 最小 CDP 客戶端（Node 24 內建 WebSocket，免安裝套件）
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    this.consoleErrors = []; this.pageErrors = []; this.failedRequests = []; this.responses = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
        return;
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
        this.consoleErrors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
      if (m.method === 'Runtime.exceptionThrown')
        this.pageErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
      if (m.method === 'Network.responseReceived') {
        const r = m.params.response;
        this.responses.push({ url: r.url, status: r.status, mime: r.mimeType });
      }
      if (m.method === 'Network.loadingFailed')
        this.failedRequests.push({ url: m.params.requestId, error: m.params.errorText });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 120000);
    });
  }
  async eval(fn, ...args) {
    const expr = '(' + fn.toString() + ')(' + args.map(a => JSON.stringify(a)).join(',') + ')';
    const res = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 900));
    return res.result.value;
  }
  async shot(file, outDir, clip) {
    const p = { format: 'png', captureBeyondViewport: false, fromSurface: true };
    if (clip) p.clip = { ...clip, scale: 1 };
    const r = await this.send('Page.captureScreenshot', p);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, file), Buffer.from(r.data, 'base64'));
    console.log('saved ' + file);
  }
}

export async function launch({ width = 1920, height = 1080, port = 9444 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'phase1-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--window-size=' + width + ',' + height, '--force-device-scale-factor=1', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i++) {
    try { const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
          target = list.find(t => t.type === 'page'); if (target) break; } catch (e) {}
    await sleep(250);
  }
  if (!target) { chrome.kill(); throw new Error('Chrome CDP 未啟動'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  return { cdp, chrome };
}

export const MEASURE = () => {
  const de = document.documentElement;
  const g = s => document.querySelector(s);
  const rect = e => e ? { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height),
                          x: Math.round(e.getBoundingClientRect().x), y: Math.round(e.getBoundingClientRect().y) } : null;
  const cats = g('#cats'), tags = g('#tags'), foot = g('.lib-foot');
  const cs = cats ? getComputedStyle(cats) : null;
  return {
    innerWidth, innerHeight,
    doc: { scrollW: de.scrollWidth, clientW: de.clientWidth, scrollH: de.scrollHeight, clientH: de.clientHeight },
    cats: cats ? { ...rect(cats), scrollH: cats.scrollHeight, clientH: cats.clientHeight, maxHeight: cs.maxHeight,
                   scrollTop: cats.scrollTop, overflows: cats.scrollHeight > cats.clientHeight + 1 } : null,
    tags: tags ? { ...rect(tags), scrollH: tags.scrollHeight, clientH: tags.clientHeight,
                   tagCount: tags.querySelectorAll('.tag').length, adultClassTags: tags.querySelectorAll('.tag.adult').length } : null,
    libFoot: foot ? { ...rect(foot), scrollH: foot.scrollHeight, clientH: foot.clientHeight, clipped: foot.scrollHeight > foot.clientHeight + 1 } : null,
    library: rect(g('.library')), stage: rect(g('.stage')), settings: rect(g('.settings')),
    actionbar: rect(g('.actionbar')), genBtn: rect(g('#go')),
    catNames: [...document.querySelectorAll('#cats .cat')].map(b => (b.querySelector('span:not(.cat-initial)')?.textContent || '').trim()),
    catCounts: [...document.querySelectorAll('#cats .cat b')].map(b => b.textContent),
    selPills: document.querySelectorAll('#selBar .pill').length,
    selLabels: [...document.querySelectorAll('#selBar .pill .pill-t')].map(e => e.textContent.trim()),
    stageEmptyShown: !g('#stageEmpty')?.hidden, stageProgShown: !g('#stageProgress')?.hidden,
    stageResultsShown: !g('#stageResults')?.hidden,
    progPct: g('#progPct')?.textContent, progStep: g('#progStep')?.textContent,
    resultImgs: [...document.querySelectorAll('#stageResults img')].map(i => ({ w: i.naturalWidth, h: i.naturalHeight, src: (i.src || '').slice(0, 90) })),
    historyShown: !g('#history')?.hidden
  };
};
