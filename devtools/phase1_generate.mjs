// phase1_generate.mjs — 真實跑一次生成，驗證「生成中 / 生成結果」仍維持三欄版面
import { launch, MEASURE, sleep } from './cdp_lib.mjs';
import { writeFileSync } from 'node:fs';

const OUT = 'C:\\ComfyUI\\simple_ui\\devtools\\phase1_final_review';
const URL = 'http://127.0.0.1:7860/?v=31';

const pick = async (cdp, cat, tags) => {
  await cdp.eval(c => { const b = document.querySelector('#cats .cat[data-c="' + CSS.escape(c) + '"]'); if (b) b.click(); }, cat);
  await sleep(250);
  return await cdp.eval(list => {
    const out = [];
    for (const t of list) {
      const el = document.querySelector('#tags .tag[data-e="' + CSS.escape(t) + '"]');
      if (el) { el.click(); out.push(t); } else out.push('MISS:' + t);
    }
    return out;
  }, tags);
};

(async () => {
  const { cdp, chrome } = await launch({ port: 9444 });
  await cdp.send('Page.navigate', { url: URL });
  await sleep(2500);
  for (let i = 0; i < 40; i++) {
    const n = await cdp.eval(() => document.querySelectorAll('#tags .tag').length);
    if (n > 0) break;
    await sleep(250);
  }

  const rep = {};

  // 1) 記錄 adult 圖示資源的網路結果（cat-adult.webp 是否存在）
  await cdp.eval(() => { const b = document.querySelector('#btnAdult'); if (b) b.click(); });
  await sleep(1200);
  rep.adultAssetResponses = cdp.responses.filter(r => r.url.includes('cat-adult'));
  rep.catNamesAdultOn = await cdp.eval(() => [...document.querySelectorAll('#cats .cat')].map(b => ({
    name: (b.querySelector('span:not(.cat-initial)')?.textContent || '').trim(),
    count: b.querySelector('b')?.textContent,
    badge: (b.querySelector('.cat-initial')?.textContent || '').trim(),
    hasImg: !!b.querySelector('img')
  })));
  rep.catNamesAdultOff = null;
  await cdp.eval(() => { const b = document.querySelector('#btnAdult'); if (b) b.click(); }); // 關回
  await sleep(600);
  rep.catNamesAdultOff = await cdp.eval(() => [...document.querySelectorAll('#cats .cat')].map(b => ({
    name: (b.querySelector('span:not(.cat-initial)')?.textContent || '').trim(),
    count: b.querySelector('b')?.textContent
  })));

  // 2) 一般標籤（乾淨內容，避免測試產生成人圖）
  const picked = [];
  picked.push(...await pick(cdp, '人物', ['1girl', 'long hair']));
  picked.push(...await pick(cdp, '臉&表情', ['smile']));
  picked.push(...await pick(cdp, '場景', ['classroom', 'sunlight']));
  await cdp.eval(() => { const el = document.querySelector('#pos'); el.value = '明亮的教室，午後陽光'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(400);
  rep.picked = picked;

  // 3) 點生成 → 捕捉「生成中」
  await cdp.eval(() => { const b = document.querySelector('#go'); b.click(); });
  await sleep(2500);
  rep.D_progress = await cdp.eval(MEASURE);
  await cdp.shot('gen_progress.png', OUT);

  // 4) 等結果
  let done = false;
  for (let i = 0; i < 120; i++) {
    const st = await cdp.eval(() => ({
      prog: !document.querySelector('#stageProgress')?.hidden,
      res: !document.querySelector('#stageResults')?.hidden,
      imgs: document.querySelectorAll('#stageResults img').length
    }));
    if (st.res && st.imgs > 0) { done = true; break; }
    if (!st.prog && !st.res) { done = true; break; }
    await sleep(1500);
  }
  await sleep(2500);
  rep.D_result = await cdp.eval(MEASURE);
  rep.genDone = done;
  await cdp.shot('gen_result.png', OUT);

  // 5) 燈箱
  await cdp.eval(() => { const img = document.querySelector('#stageResults img'); if (img) img.click(); });
  await sleep(1200);
  rep.lightbox = await cdp.eval(() => ({
    shown: !document.querySelector('#lightbox')?.hidden,
    meta: document.querySelector('#lbMeta')?.textContent,
    count: document.querySelector('#lbCount')?.textContent
  }));
  await cdp.shot('gen_lightbox.png', OUT);
  await cdp.eval(() => { const b = document.querySelector('#lbClose'); if (b) b.click(); });

  rep.consoleErrors = cdp.consoleErrors;
  rep.pageErrors = cdp.pageErrors;
  rep.failedRequests = cdp.failedRequests.filter(f => !String(f.url).startsWith('ws'));
  rep.asset404 = cdp.responses.filter(r => r.mime && r.mime.includes('text/html') && r.url.includes('/assets/')).map(r => r.url);

  writeFileSync(OUT + '/\_gen_report.json', JSON.stringify(rep, null, 2));
  console.log(JSON.stringify(rep, null, 2));
  chrome.kill();
  await sleep(400);
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
