// tag_stats_runner.mjs — Phase 1 統計/收藏自動化驗收
// 獨立臨時 Chrome profile，不會寫入使用者正式 localStorage；生成流程全為 mock，無 GPU。
import { launch, sleep, MEASURE } from './cdp_lib.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'C:\\ComfyUI\\simple_ui\\devtools\\reports';
const SRC = 'C:\\ComfyUI\\simple_ui\\devtools\\tag_stats_test.js';
const URL = 'http://127.0.0.1:7860/?v=40';
const PORT = 9777;

(async () => {
  mkdirSync(OUT, { recursive: true });
  const { cdp, chrome } = await launch({ port: PORT });
  try {
    await cdp.send('Page.navigate', { url: URL });
    await sleep(2400);
    for (let i = 0; i < 80; i++) {
      const n = await cdp.eval(() => document.querySelectorAll('#tags .tag').length);
      if (n > 0) break;
      await sleep(250);
    }
    const before = await cdp.eval(MEASURE);
    const src = readFileSync(SRC, 'utf8');
    await cdp.send('Runtime.evaluate', { expression: src });
    const res = await cdp.eval(() => window.__tagStatsTests.unit());
    const after = await cdp.eval(MEASURE);

    const layout = {
      noVerticalScroll: after.doc.scrollH <= after.innerHeight,
      noHorizontalScroll: after.doc.scrollW <= after.innerWidth,
      tagsScrollInternally: after.tags.scrollH > after.tags.clientH,
      catsNoVerticalClip: after.cats.scrollH <= after.cats.clientH + 1,
      doc: after.doc, tags: after.tags, cats: after.cats
    };
    const report = {
      at: new Date().toISOString(), url: URL, port: PORT,
      passed: res.passed, failed: res.failed, results: res.results,
      layout,
      consoleErrors: cdp.consoleErrors, pageErrors: cdp.pageErrors,
      failedRequests: cdp.failedRequests
    };
    writeFileSync(OUT + '\\_tag_stats_test_report.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      passed: res.passed, failed: res.failed,
      layout: { noVerticalScroll: layout.noVerticalScroll, noHorizontalScroll: layout.noHorizontalScroll },
      consoleErrors: cdp.consoleErrors.length, pageErrors: cdp.pageErrors.length,
      failures: res.results.filter(x => !x.ok)
    }, null, 2));
    process.exitCode = res.failed === 0 && cdp.consoleErrors.length === 0 && cdp.pageErrors.length === 0 &&
      layout.noVerticalScroll && layout.noHorizontalScroll ? 0 : 1;
  } finally {
    chrome.kill();
    await sleep(350);
  }
})().catch(e => { console.error('RUNNER FAIL', e); process.exit(2); });
