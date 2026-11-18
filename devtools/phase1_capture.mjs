// phase1_capture.mjs — 1920x1080 正式應用截圖 + 版面量測
import { launch, MEASURE, sleep } from './cdp_lib.mjs';
import { writeFileSync } from 'node:fs';

const OUT = 'C:\\ComfyUI\\simple_ui\\devtools\\phase1_final_review';
const URL = 'http://127.0.0.1:7860/?v=32';

const clickCat = (cdp, c) => cdp.eval(n => { const b = document.querySelector('#cats .cat[data-c="' + CSS.escape(n) + '"]'); if (b) b.click(); return !!b; }, c);
const clickTags = (cdp, list) => cdp.eval(ts => {
  const out = [];
  for (const t of ts) { const el = document.querySelector('#tags .tag[data-e="' + CSS.escape(t) + '"]'); if (el) { el.click(); out.push(t); } else out.push('MISS:' + t); }
  return out;
}, list);

(async () => {
  const { cdp, chrome } = await launch({ port: 9555 });
  await cdp.send('Page.navigate', { url: URL });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await cdp.eval(() => document.querySelectorAll('#tags .tag').length) > 0) break; await sleep(250); }

  const rep = {};

  // ── A. 18+ 關閉（預設） ───────────────────────────────
  rep.A_adultOff = await cdp.eval(MEASURE);
  await cdp.shot('adult_off.png', OUT);

  // ── B. 18+ 開啟 → 切到「成人向」分類，成人標籤帶暖色邊框 ──
  await cdp.eval(() => { const b = document.querySelector('#btnAdult'); if (b) b.click(); return !!b; });
  await sleep(700);
  await clickCat(cdp, '成人向');
  await sleep(400);
  rep.B_adultOn = await cdp.eval(MEASURE);
  rep.B_adultOn.warmBorderSample = await cdp.eval(() => {
    const t = document.querySelector('#tags .tag.adult');
    const n = document.querySelector('#tags .tag:not(.adult)');
    const cs = e => e ? getComputedStyle(e).borderColor : null;
    return { adultTagBorder: cs(t), normalTagBorder: cs(n), adultTagCount: document.querySelectorAll('#tags .tag.adult').length };
  });
  await cdp.shot('adult_on.png', OUT);

  // ── C. 混合選取（一般 + 成人）────────────────────────
  await clickCat(cdp, '人物');
  await sleep(300);
  rep.C_pickedGeneral = await clickTags(cdp, ['1girl']);
  await clickCat(cdp, '成人向');
  await sleep(300);
  rep.C_pickedAdult = await clickTags(cdp, ['nsfw', 'nude', 'lingerie']);
  await cdp.eval(() => {
    const set = (id, v) => { const el = document.querySelector(id); if (!el) return;
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('#pos', '櫻花 夜晚 微微風吹');
    set('#neg', 'blurry, watermark, extra fingers');
  });
  await sleep(600);
  rep.C_mixed = await cdp.eval(MEASURE);
  const libRect = await cdp.eval(() => { const r = document.querySelector('.library').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
  await cdp.shot('mixed_selection.png', OUT, libRect);

  // ── D. 最終整體版面（1920x1080 全景）──────────────────
  await cdp.shot('final_layout.png', OUT);

  rep.consoleErrors = cdp.consoleErrors;
  rep.pageErrors = cdp.pageErrors;
  rep.failedRequests = cdp.failedRequests;
  rep.assetHtmlFallback = cdp.responses.filter(r => r.mime && r.mime.includes('text/html') && r.url.includes('/assets/')).map(r => r.url);

  writeFileSync(OUT + '/\_measurements.json', JSON.stringify(rep, null, 2));
  console.log(JSON.stringify({
    A: { cats: rep.A_adultOff.cats, tags: rep.A_adultOff.tags, libFoot: rep.A_adultOff.libFoot, doc: rep.A_adultOff.doc },
    B: { cats: rep.B_adultOn.cats, tags: rep.B_adultOn.tags, libFoot: rep.B_adultOn.libFoot, doc: rep.B_adultOn.doc, warm: rep.B_adultOn.warmBorderSample },
    C: { cats: rep.C_mixed.cats, tags: rep.C_mixed.tags, libFoot: rep.C_mixed.libFoot, doc: rep.C_mixed.doc,
         sel: rep.C_mixed.selLabels, pills: rep.C_mixed.selPills },
    cols: { library: rep.C_mixed.library, stage: rep.C_mixed.stage, settings: rep.C_mixed.settings, actionbar: rep.C_mixed.actionbar, genBtn: rep.C_mixed.genBtn },
    errs: { console: rep.consoleErrors, page: rep.pageErrors, failed: rep.failedRequests, assets: rep.assetHtmlFallback }
  }, null, 2));

  chrome.kill();
  await sleep(400);
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
