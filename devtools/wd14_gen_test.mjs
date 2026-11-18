// wd14_gen_test.mjs — 測試 17：ComfyUI 生圖流程不受反推功能影響 + 同時生成時的反推延遲
import { launch, sleep } from './cdp_lib.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const OUT = 'C:\\ComfyUI\\simple_ui\\devtools\\wd14_review';
const URL = 'http://127.0.0.1:7860/?v=41';
const IMG_GENERAL_B64 = readFileSync('C:\\ComfyUI\\tmp\\wd14_test\\general_512.png').toString('base64');
const IMG_ADULT_B64 = readFileSync('C:\\ComfyUI\\tmp\\wd14_test\\adult_512.png').toString('base64');
const R = [];
const check = (id, name, pass, detail) => {
  R.push({ id, name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' [' + id + '] ' + name + ' :: ' + JSON.stringify(detail));
};

const injectFile = (cdp, b64, name) => cdp.eval((b64, name) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], name, { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const input = document.getElementById('revFile');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, b64, name);

(async () => {
  mkdirSync(OUT, { recursive: true });
  const { cdp, chrome } = await launch({ width: 1920, height: 1080, port: 9668 });
  await cdp.send('Page.navigate', { url: URL });
  await sleep(2800);
  // 把圖片 base64 放進頁面，等一下生圖中反推用得到
  await cdp.eval(b64 => { window.__REV_B64 = b64; return true; }, IMG_GENERAL_B64);

  // ── 成人向圖片在 UI 的呈現（不被過濾）──────────────────
  await cdp.eval(() => { document.getElementById('btnReverse').click(); });
  await sleep(300);
  await injectFile(cdp, IMG_ADULT_B64, 'adult.png');
  await sleep(900);
  await cdp.eval(() => { document.getElementById('revRun').click(); });
  let adultOk = false;
  for (let i = 0; i < 240; i++) {
    const n = await cdp.eval(() => document.querySelectorAll('#revGeneral .rev-tag').length);
    if (n > 0) { adultOk = true; break; }
    await sleep(500);
  }
  const adultInfo = await cdp.eval(() => ({
    rating: document.getElementById('revRating').textContent.trim(),
    general: document.querySelectorAll('#revGeneral .rev-tag').length,
    adultStyled: document.querySelectorAll('#revGeneral .rev-tag.adult').length,
    names: [...document.querySelectorAll('#revGeneral .rev-tag')].slice(0, 8).map(b => b.dataset.name)
  }));
  check('A1', '成人向圖片在 UI 正常顯示且不被過濾',
    adultOk && adultInfo.general > 0 && adultInfo.rating.indexOf('explicit') >= 0, adultInfo);
  await cdp.shot('reverse_adult.png', OUT);
  await cdp.eval(() => { document.getElementById('revModal').hidden = true; });
  await sleep(300);

  // ── 真實生成：確認生圖流程完全不受影響 ──────────────────
  await cdp.eval(() => {
    const s = document.getElementById('search');
    s.value = '1girl'; s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(500);
  await cdp.eval(() => {
    const el = document.querySelector('#tags .tag[data-e="1girl"]');
    if (el) el.click();
    document.getElementById('sizes').querySelector('[data-size="1024x1024"]').click();
    document.getElementById('counts').querySelector('[data-n="1"]').click();
  });
  await sleep(500);
  const genT0 = Date.now();
  await cdp.eval(() => { document.getElementById('go').click(); });

  // 生成進行中，同時發一個反推請求，量延遲
  let revDuring = null;
  for (let i = 0; i < 400; i++) {
    const st = await cdp.eval(() => ({
      prog: !document.getElementById('stageProgress').hidden,
      res: !document.getElementById('stageResults').hidden,
      imgs: document.querySelectorAll('#stageResults img').length,
      pct: document.getElementById('progPct').textContent
    }));
    if (st.prog && revDuring === null) {
      await sleep(2500);
      revDuring = await cdp.eval(async () => {
        const t0 = Date.now();
        const r = await fetch('/api/reverse', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: window.__REV_B64, threshold: 0.35, character_threshold: 0.85 })
        });
        const j = await r.json();
        return { ms: Date.now() - t0, ok: !!j.ok, general: (j.general || []).length };
      });
    }
    if (st.res && st.imgs > 0) break;
    await sleep(1000);
  }
  const genState = await cdp.eval(() => ({
    results: document.querySelectorAll('#stageResults img').length,
    goText: document.getElementById('goText').textContent,
    hist: document.querySelectorAll('#histBar img').length
  }));
  check('T17', 'ComfyUI 生圖流程正常（反推功能沒有干擾）',
    genState.results > 0 && genState.goText.indexOf('生成') >= 0,
    { ...genState, gen_seconds: Math.round((Date.now() - genT0) / 1000), revDuringGen: revDuring });
  check('T17b', '生圖進行中反推仍然可用', revDuring && revDuring.ok,
    { revDuringGen: revDuring });

  await cdp.shot('after_generate.png', OUT);
  check('V5', 'Console 沒有錯誤', cdp.consoleErrors.length === 0 && cdp.pageErrors.length === 0,
    { consoleErrors: cdp.consoleErrors, pageErrors: cdp.pageErrors });

  const summary = { total: R.length, passed: R.filter(x => x.pass).length,
    failed: R.filter(x => !x.pass).map(x => x.id) };
  console.log('=== SUMMARY === ' + JSON.stringify(summary));
  writeFileSync(OUT + '/wd14_gen_test_report.json', JSON.stringify({ results: R, summary }, null, 2));
  chrome.kill();
  process.exit(summary.failed.length ? 1 : 0);
})();
