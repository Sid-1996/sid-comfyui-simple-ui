// wd14_ui_test.mjs — Task 2 前端測試：反推 Modal、加入標籤規則、版面量測
// 用 devtools/cdp_lib.mjs 開獨立 headless Chrome，不碰使用者正式 localStorage。
import { launch, sleep } from './cdp_lib.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const OUT = 'C:\\ComfyUI\\simple_ui\\devtools\\wd14_review';
const URL = 'http://127.0.0.1:7860/?v=40';
const IMG = 'C:\\ComfyUI\\tmp\\wd14_test\\general_512.png';
const IMG_GENERAL_B64 = readFileSync(IMG).toString('base64');
const R = [];
const check = (id, name, pass, detail) => {
  R.push({ id, name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' [' + id + '] ' + name + ' :: ' + JSON.stringify(detail));
};

const selTags = cdp => cdp.eval(() => window.Tags.selected().map(s => s.t));
const posVal = cdp => cdp.eval(() => document.getElementById('pos').value);
const promptOf = cdp => cdp.eval(() => window.Tags.buildPrompt());

// 把 base64 變成 File 塞進 #revFile（等同使用者選檔）
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

async function waitTags(cdp, timeoutMs = 150000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const n = await cdp.eval(() => document.querySelectorAll('#revGeneral .rev-tag').length);
    if (n > 0) return n;
    const err = await cdp.eval(() => document.getElementById('revError').hidden
      ? '' : document.getElementById('revError').textContent);
    if (err) return { err: err };
    await sleep(500);
  }
  return 0;
}

async function runReverse(cdp) {
  await injectFile(cdp, IMG_GENERAL_B64, 'general.png', 'image/png');
  await sleep(900);
  await cdp.eval(() => { document.getElementById('revRun').click(); });
  return await waitTags(cdp);
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const { cdp, chrome } = await launch({ width: 1920, height: 1080, port: 9667 });
  await cdp.send('Page.navigate', { url: URL });
  await sleep(2800);

  // ── V1 版面沒有捲動 ─────────────────────────────────────
  const layout = await cdp.eval(() => {
    const de = document.documentElement;
    const g = s => document.querySelector(s);
    const r = e => e ? { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height),
      x: Math.round(e.getBoundingClientRect().x), y: Math.round(e.getBoundingClientRect().y) } : null;
    const box = s => { const e = g(s); return e ? { scrollH: e.scrollHeight, clientH: e.clientHeight, rect: r(e) } : null; };
    return {
      innerWidth: innerWidth, innerHeight: innerHeight,
      scrollH: de.scrollHeight, clientH: de.clientHeight,
      scrollW: de.scrollWidth, clientW: de.clientWidth,
      libFoot: box('.lib-foot'), cats: box('#cats'), tags: box('#tags'),
      topbar: r(g('.topbar')), actionbar: r(g('.actionbar')), revBtn: r(g('#btnReverse'))
    };
  });
  check('V1', '1920x1080 頁面沒有垂直/水平捲動',
    layout.scrollH <= layout.innerHeight && layout.scrollW <= layout.innerWidth, layout);
  check('V2', '左欄與右欄都沒有被裁切',
    layout.libFoot.scrollH <= layout.libFoot.clientH + 1 && layout.cats.scrollH <= layout.cats.clientH + 1,
    { libFoot: layout.libFoot, cats: layout.cats, tags: layout.tags });

  const hasBtn = await cdp.eval(() => {
    const b = document.getElementById('btnReverse');
    return !!b && b.offsetParent !== null && b.textContent.indexOf('圖片反推') >= 0;
  });
  check('V3', '頂列有「圖片反推」入口且可見', hasBtn, { hasBtn: hasBtn });

  // ── 預先建立既有狀態：兩個已選標籤 + 有內容的補充描述 ─────
  const pickTag = async (cdp, name) => {
    await cdp.eval(q => {
      const s = document.getElementById('search');
      s.value = q; s.dispatchEvent(new Event('input', { bubbles: true }));
    }, name);
    await sleep(450);
    await cdp.eval(q => {
      const el = document.querySelector('#tags .tag[data-e="' + CSS.escape(q) + '"]');
      if (el) el.click();
    }, name);
    await sleep(250);
  };
  await pickTag(cdp, '1girl');
  await pickTag(cdp, 'smile');
  await cdp.eval(() => {
    const p = document.getElementById('pos');
    p.value = '櫻花 夜晚';
    p.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);
  const selBefore = await selTags(cdp);
  const posBefore = await posVal(cdp);
  check('F0', '測試前已備妥既有選取與補充描述', selBefore.length === 2 && posBefore.length > 0,
    { selBefore: selBefore, posBefore: posBefore });

  // ── F1 開 Modal + 反推 ──────────────────────────────────
  await cdp.eval(() => { document.getElementById('btnReverse').click(); });
  await sleep(400);
  const modalOpen = await cdp.eval(() => !document.getElementById('revModal').hidden);
  check('F1a', '點入口會開反推 Modal', modalOpen, { modalOpen: modalOpen });

  const n = await runReverse(cdp);
  check('F1b', '一般圖反推出一般標籤', typeof n === 'number' && n > 0, { tagCount: n });

  const rating = await cdp.eval(() => {
    const e = document.getElementById('revRating');
    return { hidden: e.hidden, text: e.textContent.trim() };
  });
  check('F2', 'Rating 分級有顯示出來', !rating.hidden && rating.text.length > 0, rating);

  const t3 = await cdp.eval(() => {
    const b = document.querySelector('#revGeneral .rev-tag');
    const before = b.classList.contains('on');
    b.click();
    const after = b.classList.contains('on');
    b.click();
    return { before: before, after: after, name: b.dataset.name, restored: b.classList.contains('on') };
  });
  check('F3', '點標籤可取消/選取', t3.before === true && t3.after === false && t3.restored === true, t3);

  const t4 = await cdp.eval(() => {
    document.querySelector('#revModal [data-none="general"]').click();
    const off = document.querySelectorAll('#revGeneral .rev-tag.on').length;
    const applyText = document.getElementById('revApply').textContent;
    document.querySelector('#revModal [data-all="general"]').click();
    const on = document.querySelectorAll('#revGeneral .rev-tag.on').length;
    const total = document.querySelectorAll('#revGeneral .rev-tag').length;
    return { off: off, on: on, total: total, applyTextAfterNone: applyText };
  });
  check('F4', '全選/全取消可用', t4.off === 0 && t4.on === t4.total && t4.total > 0, t4);

  // ── F5/F6/F8 加入提示詞 ─────────────────────────────────
  await cdp.eval(() => { document.getElementById('revApply').click(); });
  await sleep(800);
  const selAfter = await selTags(cdp);
  const posAfter = await posVal(cdp);
  const prompt = await promptOf(cdp);
  const modalClosed = await cdp.eval(() => document.getElementById('revModal').hidden);
  const keptSel = selBefore.every(t => selAfter.includes(t));
  check('F5', '加入標籤不會覆蓋既有選取（原有標籤都還在且有新增）',
    keptSel && selAfter.length > selBefore.length, { before: selBefore, after: selAfter });
  check('F6', '加入標籤不會覆蓋原有 #pos 內容',
    posAfter.indexOf(posBefore) === 0 && posAfter.length > posBefore.length,
    { before: posBefore, after: posAfter });
  const ratingWord = (rating.text.match(/內容分級：([a-z_]+)/) || [])[1];
  check('F8', 'Rating 不會進正向提示詞',
    !ratingWord || prompt.split(',').map(x => x.trim()).indexOf(ratingWord) < 0,
    { ratingWord: ratingWord, prompt: prompt.slice(0, 500) });
  check('F5b', '套用後 Modal 有自動關閉', modalClosed, { modalClosed: modalClosed });

  // ── F7 重複加入不重複 ────────────────────────────────────
  const countBefore = selAfter.length;
  await cdp.eval(() => { document.getElementById('btnReverse').click(); });
  await sleep(300);
  await runReverse(cdp);
  await cdp.eval(() => { document.getElementById('revApply').click(); });
  await sleep(800);
  const selAgain = await selTags(cdp);
  const posAgain = await posVal(cdp);
  check('F7', '同一批標籤再加入一次不會重複',
    selAgain.length === countBefore && posAgain === posAfter,
    { countBefore: countBefore, countAfter: selAgain.length, posBefore: posAfter, posAfter: posAgain });

  const genState = await cdp.eval(() => ({
    goDisabled: !!document.getElementById('go').disabled,
    sel: window.Tags.selected().length
  }));
  check('F9', '反推流程沒有改動生成按鈕狀態', genState.sel === selAgain.length, genState);

  // ── 截圖 ────────────────────────────────────────────────
  await cdp.eval(() => { document.getElementById('btnReverse').click(); });
  await sleep(300);
  await runReverse(cdp);
  await sleep(500);
  await cdp.shot('reverse_modal.png', OUT);
  const modalBox = await cdp.eval(() => {
    const e = document.querySelector('#revModal .modal-card');
    const r = e.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
      bottom: Math.round(r.bottom), right: Math.round(r.right),
      fitsViewport: r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 && r.x >= 0 && r.y >= 0 };
  });
  check('V4', '反推 Modal 沒有超出視窗', modalBox.fitsViewport, modalBox);

  await cdp.eval(() => { document.getElementById('revModal').hidden = true; });
  await sleep(300);
  await cdp.shot('main_1920.png', OUT);

  check('V5', 'Console 沒有錯誤', cdp.consoleErrors.length === 0 && cdp.pageErrors.length === 0,
    { consoleErrors: cdp.consoleErrors, pageErrors: cdp.pageErrors });

  const summary = { total: R.length, passed: R.filter(x => x.pass).length,
    failed: R.filter(x => !x.pass).map(x => x.id) };
  console.log('=== SUMMARY === ' + JSON.stringify(summary));
  writeFileSync(OUT + '/wd14_ui_test_report.json', JSON.stringify({ results: R, summary }, null, 2));
  chrome.kill();
  process.exit(summary.failed.length ? 1 : 0);
})();
