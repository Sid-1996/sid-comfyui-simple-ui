// wd14_ui_429_test.mjs — Task 2-R1 / P2-e：429 忙碌提示與其他錯誤訊息
// 用 devtools/cdp_lib.mjs 開獨立 headless Chrome，不碰使用者正式 localStorage。
import { launch, sleep } from './cdp_lib.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const OUT = 'C:\\ComfyUI\\simple_ui\\devtools\\wd14_review';
const URL = 'http://127.0.0.1:7860/?v=41';
const APP = 'C:\\ComfyUI\\simple_ui\\app.js';
const IMG = 'C:\\ComfyUI\\tmp\\wd14_test\\general_512.png';
const IMG_B64 = readFileSync(IMG).toString('base64');

const R = [];
const check = (id, name, pass, detail) => {
  R.push({ id, name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' [' + id + '] ' + name + ' :: ' + JSON.stringify(detail));
};

// 從 app.js 抽出 rvExplain 的原始碼（它是 IIFE 內的函式，沒有掛到 window）
const appSrc = readFileSync(APP, 'utf8');
const m = appSrc.match(/function rvExplain\(e\) \{[\s\S]*?\n  \}/);
if (!m) {
  console.log('FAIL [W0] 從 app.js 抓不到 rvExplain 的原始碼');
  process.exit(1);
}
const RV_EXPLAIN_SRC = m[0];

const injectFile = (cdp, b64, name, type) => cdp.eval((b64, name, type) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], name, { type: type || 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById('revFile');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, b64, name, type);

async function waitError(cdp, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await cdp.eval(() => {
      const e = document.getElementById('revError');
      return { hidden: e.hidden, text: e.textContent.trim() };
    });
    if (!s.hidden && s.text) return s;
    await sleep(200);
  }
  return { hidden: true, text: '' };
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const { cdp, chrome } = await launch({ width: 1920, height: 1080, port: 9669 });
  await cdp.send('Page.navigate', { url: URL });
  await sleep(2800);

  // ── W1/W2：rvExplain 的訊息對應 ───────────────────────────
  const mapped = await cdp.eval((src) => {
    const fn = new Function('return (' + src + ')')();
    const cases = [
      ['429', '同時反推的圖片太多，等一下再試'],
      ['400', '沒有收到圖片，請重新選一次'],
      ['413', '圖片太大了（上限 8 MB），請換小一點的'],
      ['415', '只認 PNG、JPG、WebP 圖片'],
      ['503', 'WD14 Worker 意外結束'],
      ['504', 'WD14 推論逾時（120 秒）']
    ];
    const out = {};
    for (const [k, msg] of cases) out[k] = fn(new Error(msg));
    out['429_raw'] = fn('同時反推的圖片太多，等一下再試');
    return out;
  }, RV_EXPLAIN_SRC);

  check('W1', '429 顯示後端白話訊息，且不冠「反推失敗」',
    mapped['429'] === '同時反推的圖片太多，等一下再試'
    && mapped['429'].indexOf('反推失敗') < 0,
    { got: mapped['429'] });
  check('W2a', '400 仍顯示原本的錯誤訊息',
    mapped['400'].indexOf('反推失敗') >= 0 && mapped['400'].indexOf('沒有收到圖片') >= 0,
    { got: mapped['400'] });
  check('W2b', '413 仍顯示「圖片太大囉」提示',
    mapped['413'].indexOf('圖片太大囉') >= 0, { got: mapped['413'] });
  check('W2c', '415 仍顯示「格式不行」提示',
    mapped['415'].indexOf('格式不行') >= 0, { got: mapped['415'] });
  check('W2d', '503 仍顯示「反推服務沒回應」提示',
    mapped['503'].indexOf('反推服務沒回應') >= 0, { got: mapped['503'] });
  check('W2e', '504 仍顯示「分析太久了」提示',
    mapped['504'].indexOf('分析太久了') >= 0, { got: mapped['504'] });

  // ── W3：真實 429（3 個併發 + 第 4 個）────────────────────
  await cdp.eval(() => { document.getElementById('btnReverse').click(); });
  await sleep(400);
  await injectFile(cdp, IMG_B64, 'general.png', 'image/png');
  await sleep(1200);

  // 先在背景送出 3 個反推請求，佔住 server 的併發上限
  const bgCount = await cdp.eval((b64) => {
    const url = 'data:image/png;base64,' + b64;
    window.__bg = [];
    for (let i = 0; i < 3; i++) {
      window.__bg.push(fetch('/api/reverse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: url })
      }).then(r => r.status).catch(e => 'ERR:' + e));
    }
    return window.__bg.length;
  }, IMG_B64);
  await sleep(1200);

  await cdp.eval(() => { document.getElementById('revRun').click(); });
  const err = await waitError(cdp, 30000);
  check('W3', '真實 429 時 UI 顯示忙碌提示（不是「反推失敗」）',
    bgCount === 3 && !err.hidden && err.text.indexOf('太多') >= 0
    && err.text.indexOf('反推失敗') < 0,
    { bgCount, error: err });

  const bgStatus = await cdp.eval(() => Promise.all(window.__bg));
  check('W3b', '背景 3 個請求都成功（代表第 4 個才是被拒的那個）',
    bgStatus.every(s => s === 200), { bgStatus });

  await cdp.shot('reverse_429.png', OUT);

  // ── W4：忙碌過後 UI 還能正常反推 ─────────────────────────
  await cdp.eval(() => {
    document.getElementById('revError').hidden = true;
    document.getElementById('revError').textContent = '';
  });
  await cdp.eval(() => { document.getElementById('revRun').click(); });
  let ok = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    const n = await cdp.eval(() => document.querySelectorAll('#revGeneral .rev-tag').length);
    if (n > 0) { ok = true; break; }
    await sleep(500);
  }
  check('W4', '忙碌過後下一個反推仍然正常（UI 沒有卡死）', ok, { tags: ok });

  check('W5', 'Console 沒有錯誤',
    cdp.consoleErrors.length === 0 && cdp.pageErrors.length === 0,
    { consoleErrors: cdp.consoleErrors, pageErrors: cdp.pageErrors });

  const summary = { total: R.length, passed: R.filter(x => x.pass).length,
    failed: R.filter(x => !x.pass).map(x => x.id) };
  console.log('=== SUMMARY === ' + JSON.stringify(summary));
  writeFileSync(OUT + '/wd14_ui_429_test_report.json', JSON.stringify({ results: R, summary }, null, 2));
  chrome.kill();
  process.exit(summary.failed.length ? 1 : 0);
})();
