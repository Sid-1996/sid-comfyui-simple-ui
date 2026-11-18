// phase11_tagname_test.mjs — Phase 1.1：已選標籤中文名稱一致性測試
// 獨立臨時 Chrome profile，不碰使用者正式 localStorage。
import { launch, sleep } from './cdp_lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'C:\\ComfyUI\\simple_ui\\devtools\\phase1_final_review';
const URL = 'http://127.0.0.1:7860/?v=33';
const R = [];
const check = (id, name, pass, detail) => { R.push({ id, name, pass: !!pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + ' [' + id + '] ' + name + ' :: ' + JSON.stringify(detail)); };

const pills = cdp => cdp.eval(() => [...document.querySelectorAll('#selBar .pill .pill-t')].map(e => e.textContent.trim()));
const isAscii = s => !/[\u4e00-\u9fff]/.test(s);          // 沒有中文 → 顯示為英文原文
const selCount = cdp => cdp.eval(() => document.querySelector('#selCount')?.textContent);
const clickCat = (cdp, c) => cdp.eval(n => { const b = document.querySelector('#cats .cat[data-c="' + CSS.escape(n) + '"]'); if (b) { b.click(); return true; } return false; }, c);
const clickTags = (cdp, list) => cdp.eval(ts => {
  const out = [];
  for (const t of ts) { const el = document.querySelector('#tags .tag[data-e="' + CSS.escape(t) + '"]'); if (el) { el.click(); out.push(t); } else out.push('MISS:' + t); }
  return out;
}, list);
const setSearch = async (cdp, v) => { await cdp.eval(q => { const el = document.querySelector('#search'); el.value = q; el.dispatchEvent(new Event('input', { bubbles: true })); }, v); await sleep(300); };
const tagTexts = cdp => cdp.eval(() => [...document.querySelectorAll('#tags .tag')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));
const learnedLS = cdp => cdp.eval(() => JSON.parse(localStorage.getItem('ui.learnedTags') || 'null'));
const catList = cdp => cdp.eval(() => [...document.querySelectorAll('#cats .cat')].map(b => (b.querySelector('span:not(.cat-initial)')?.textContent || '').trim() || b.textContent.trim()));

async function waitReady(cdp) {
  for (let i = 0; i < 60; i++) { if (await cdp.eval(() => document.querySelectorAll('#tags .tag').length > 0)) return true; await sleep(250); }
  return false;
}
async function generate(cdp, timeoutMs = 200000) {
  await cdp.eval(() => { const b = document.querySelector('#go'); b.click(); });
  const t0 = Date.now();
  let sawProgress = false;
  while (Date.now() - t0 < timeoutMs) {
    const st = await cdp.eval(() => ({
      prog: !document.querySelector('#stageProgress')?.hidden,
      res: !document.querySelector('#stageResults')?.hidden,
      imgs: document.querySelectorAll('#stageResults img').length
    }));
    if (st.prog) sawProgress = true;
    if (st.res && st.imgs > 0) return { ok: true, sawProgress };
    if (!st.prog && !st.res && Date.now() - t0 > 3000) return { ok: false, sawProgress, err: 'stage 回到空狀態' };
    await sleep(1200);
  }
  return { ok: false, sawProgress, err: 'timeout' };
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  mkdirSync(OUT, { recursive: true });
  const { cdp, chrome } = await launch({ port: 9666 });
  const nav = async () => { await cdp.send('Page.navigate', { url: URL }); await sleep(2200); await waitReady(cdp); };
  await nav();

  // ── T1 一般標籤選取 → 底部中文 ──────────────────────────
  await clickCat(cdp, '人物'); await sleep(250); await clickTags(cdp, ['1girl']);
  await clickCat(cdp, '臉&表情'); await sleep(250); await clickTags(cdp, ['smile']);
  await clickCat(cdp, '場景'); await sleep(250); await clickTags(cdp, ['classroom']);
  await sleep(400);
  const p1 = await pills(cdp);
  check('T1', '一般標籤選取後底部顯示中文', eq(p1, ['女孩', '微笑', '教室']), { pills: p1, count: await selCount(cdp) });

  // ── T2 生成中 / 生成完成後仍顯示中文 ───────────────────
  const beforeGen1 = await pills(cdp);
  const g1 = await generate(cdp);
  const p2 = await pills(cdp);
  check('T2', '生成完成後底部顯示名稱與生成前一致（且仍是中文）',
        eq(beforeGen1, p2) && p2.every(x => !isAscii(x)),
        { gen: g1, before: beforeGen1, after: p2, learnedPositive: (await learnedLS(cdp)).positive });

  // ── T4 新增已學習標籤（帶中文）→ 中文名稱正常 ──────────
  await cdp.eval(() => localStorage.setItem('ui.learnedTags', JSON.stringify({
    general: [{ en: 'mycustomtag', zh: '我的客製標籤' }], positive: [], negative: [] })));
  await cdp.send('Page.reload'); await sleep(2200); await waitReady(cdp);
  const catsAfter = await catList(cdp);
  await cdp.eval(() => { const b = document.querySelector('#cats .cat[data-act="moreCats"]'); if (b) b.click(); });
  await sleep(400);
  const hasLearned = await cdp.eval(() => !!document.querySelector('#cats .cat[data-c="已學習·一般"]'));
  const clicked = await clickCat(cdp, '已學習·一般');
  await sleep(350);
  const learnedTags = await tagTexts(cdp);
  const pickedCustom = await clickTags(cdp, ['mycustomtag']);
  await sleep(400);
  const pCustom = await pills(cdp);
  check('T4', '新增已學習標籤（帶中文）後中文名稱正常',
        hasLearned && clicked && pCustom.includes('我的客製標籤'),
        { hasLearned, cats: catsAfter, learnedTags, picked: pickedCustom, pills: pCustom });

  // ── T5 已學習標籤可取消選取 / 再次選取 ─────────────────
  const before5 = await pills(cdp);
  await clickTags(cdp, ['mycustomtag']); await sleep(400);
  const afterDeselect = await pills(cdp);
  await clickTags(cdp, ['mycustomtag']); await sleep(400);
  const afterReselect = await pills(cdp);
  check('T5', '已學習標籤可取消選取並再次選取',
        afterDeselect.length === before5.length - 1 && eq(afterReselect, before5),
        { before5, afterDeselect, afterReselect });

  // ── T6 成人標籤選取 ────────────────────────────────────
  await cdp.eval(() => { const b = document.querySelector('#btnAdult'); if (b) b.click(); });
  await sleep(600);
  await clickCat(cdp, '成人向'); await sleep(300);
  const pickedAdult = await clickTags(cdp, ['nsfw', 'nude', 'lingerie']);
  await sleep(400);
  const p6a = await pills(cdp);
  check('T6a', '成人標籤可選取且底部顯示名稱穩定', pickedAdult.length === 3 && p6a.length >= 3,
        { picked: pickedAdult, pills: p6a, 成人_裸體: p6a.includes('裸體') });

  // ── T7 中文 / 英文搜尋 ─────────────────────────────────
  await setSearch(cdp, '微笑');
  const zhHits = await tagTexts(cdp);
  await setSearch(cdp, 'smile');
  const enHits = await tagTexts(cdp);
  await setSearch(cdp, '女孩');
  const zhHits2 = await tagTexts(cdp);
  await setSearch(cdp, '');
  check('T7', '中文搜尋與英文搜尋皆正常',
        zhHits.some(t => t.includes('微笑')) && enHits.some(t => t.includes('smile')) && zhHits2.some(t => t.includes('女孩')),
        { 中文搜尋微笑: zhHits.slice(0, 3), 英文搜尋smile: enHits.slice(0, 3), 中文搜尋女孩: zhHits2.slice(0, 3) });

  // ── T8 重新載入後既有選取資料正常 ─────────────────────
  const beforeReload = await pills(cdp);
  await cdp.send('Page.reload'); await sleep(2200); await waitReady(cdp);
  const afterReload = await pills(cdp);
  check('T8', '頁面重新載入後既有選取資料正常', eq(beforeReload, afterReload) && afterReload.length > 0,
        { beforeReload, afterReload });

  // ── T9 生成前後一致性 + 對照表未被覆寫 ─────────────────
  const beforeGen2 = await pills(cdp);
  const g2 = await generate(cdp);
  const p9 = await pills(cdp);
  const becameEnglish = beforeGen2.filter((x, i) => p9[i] !== x);
  const learnedNow = await learnedLS(cdp);
  check('T9', '生成前後已選標籤顯示名稱完全一致（中英對照表未被覆寫）',
        eq(beforeGen2, p9) && becameEnglish.length === 0,
        { gen: g2, before: beforeGen2, after: p9, 被改成英文: becameEnglish,
          learnedPositive: learnedNow.positive, learnedGeneral: learnedNow.general });

  // ── T9b 已學習·正向 分類仍顯示中文 ─────────────────────
  await cdp.eval(() => { const b = document.querySelector('#cats .cat[data-act="moreCats"]'); if (b) b.click(); });
  await sleep(400);
  const clickedLearned = await clickCat(cdp, '已學習·正向');
  await sleep(350);
  const learnedPositiveTags = await tagTexts(cdp);
  check('T9b', '已學習·正向 分類可開啟且內容正常', clickedLearned && learnedPositiveTags.length > 0,
        { 已學習正向標籤: learnedPositiveTags.slice(0, 8) });

  // ── T10 冷啟動：使用者既有「已被污染」的 ui.learnedTags ──
  await cdp.eval(() => localStorage.setItem('ui.learnedTags', JSON.stringify({
    general: [{ en: 'mycustomtag', zh: '我的客製標籤' }],
    positive: [{ en: '1girl', zh: '1girl' }, { en: 'smile', zh: 'smile' }, { en: 'classroom', zh: 'classroom' }],
    negative: [{ en: 'worst quality', zh: 'worst quality' }] })));
  await cdp.send('Page.reload'); await sleep(2200); await waitReady(cdp);
  const pollutedPills = await pills(cdp);
  const mustBeChinese = ['女孩', '微笑', '教室', '我的客製標籤'];
  check('T10', '冷啟動時舊的污染資料不會讓中文名變英文',
        mustBeChinese.every(z => pollutedPills.includes(z)) && !pollutedPills.some(x => ['1girl', 'smile', 'classroom', 'mycustomtag'].includes(x)),
        { 冷啟動後底部: pollutedPills, 應為中文: mustBeChinese,
          已學習原始: JSON.parse(await cdp.eval(() => localStorage.getItem('ui.learnedTags'))) });

  const report = { results: R, consoleErrors: cdp.consoleErrors, pageErrors: cdp.pageErrors,
                   failedRequests: cdp.failedRequests.filter(f => !String(f.url).startsWith('ws')) };
  writeFileSync(OUT + '/\_phase11_test_report.json', JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log('PASS ' + R.filter(r => r.pass).length + ' / ' + R.length);
  console.log('consoleErrors=' + JSON.stringify(report.consoleErrors) + ' pageErrors=' + JSON.stringify(report.pageErrors));

  chrome.kill();
  await sleep(400);
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
