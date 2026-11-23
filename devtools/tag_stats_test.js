/* ============================================================
   tag_stats_test.js — Phase 1 個人標籤統計 / 收藏 / 正規化 / 跨分頁
   用法：在頁面 main world 載入本檔後呼叫 window.__tagStatsTests.unit()。
   生成流程用 mock fetch 模擬（兩張輸出），完全不呼叫真實 GPU。
   測試結束會還原所有 localStorage key 與 #pos。
   ============================================================ */
(function () {
  const K = (window.Tags && window.Tags.statsKeys) ? window.Tags.statsKeys()
    : { main: "ui.tagStats", evt: "ui.tagStats.evt.", fav: "ui.tagStats.fav.", broken: "ui.tagStats.broken." };

  function allKeys() {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) out.push(k); } }
    catch (e) { /* ignore */ }
    return out;
  }
  function backup() { const b = {}; allKeys().forEach(k => { b[k] = localStorage.getItem(k); }); return b; }
  function restore(b) {
    allKeys().forEach(k => { if (!(k in b)) { try { localStorage.removeItem(k); } catch (e) {} } });
    Object.keys(b).forEach(k => {
      try { if (b[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, b[k]); } catch (e) {}
    });
  }
  function fire(key) {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: localStorage.getItem(key), storageArea: localStorage }));
  }
  function check(r, name, ok, detail) { r.push({ name, ok: !!ok, detail }); }
  function stats() { return window.Tags.statsSnapshot(); }
  function rec(tag) { return stats().tags[tag] || null; }
  function evtKeys() { return allKeys().filter(k => k.indexOf(K.evt) === 0); }
  function json(obj) { return new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } }); }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function mockGenerate(o) {
    o = o || {};
    const origFetch = window.fetch;
    let pid = "mock-p1-" + Date.now();
    let histCalled = false;
    window.fetch = function (url, opt) {
      const u = String(url);
      if (u.indexOf("/comfy/prompt") >= 0) return Promise.resolve(json({ prompt_id: pid }));
      if (u.indexOf("/comfy/history/") >= 0) {
        histCalled = true;
        if (o.fail) return Promise.resolve(json({
          [pid]: { status: { status_str: "error", messages: [["execution_error", { exception_message: "mock fail" }]] } }
        }));
        return Promise.resolve(json({
          [pid]: {
            status: { status_str: "success", messages: [] },
            outputs: { "7": { images: [
              { filename: "mock_a.png", subfolder: "", type: "output" },
              { filename: "mock_b.png", subfolder: "", type: "output" }
            ] } }
          }
        }));
      }
      if (u.indexOf("/comfy/system_stats") >= 0) return Promise.resolve(json({}));
      if (u.indexOf("/comfy/object_info/CheckpointLoaderSimple") >= 0)
        return Promise.resolve(json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [["mock.safetensors"]] } } } }));
      return origFetch.apply(this, arguments);
    };
    try {
      const before = Date.now();
      const ck = document.querySelector("#ckpt");
      if (ck && !ck.value && ck.options.length) ck.value = ck.options[0].value;
      if (o.sel) { localStorage.setItem("sel", JSON.stringify(o.sel.map(t => ({ t, w: 1 })))); fire("sel"); }
      const pos = document.querySelector("#pos"), neg = document.querySelector("#neg");
      if (pos) { pos.value = o.pos || ""; pos.dispatchEvent(new Event("input", { bubbles: true })); }
      if (neg) { neg.value = o.neg || ""; neg.dispatchEvent(new Event("change", { bubbles: true })); }
      const go = document.querySelector("#go");
      if (!go) return { ok: false, err: "no #go" };
      go.click();
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        if (histCalled) { await sleep(350); return { ok: !o.fail, pid }; }
        await sleep(80);
      }
      return { ok: false, err: "history not called", before };
    } finally {
      window.fetch = origFetch;
    }
  }

  async function unit() {
    const b = backup();
    const r = [];
    try {
      /* ── 正規化：只認 CATS / dict，不認學習標籤 ── */
      const c = window.Tags.canonicalTag;
      check(r, "N1 CATS canonical", c("long hair") === "long hair", c("long hair"));
      check(r, "N2 大小寫＋底線", c("  LONG_HAIR ") === "long hair", c("  LONG_HAIR "));
      check(r, "N3 底線/空格互通", c("one eye closed") === "one_eye_closed", c("one eye closed"));
      check(r, "N4 CATS 明確 / 別名", c("low_leg_panties") === "lowleg_panties", c("low_leg_panties"));
      check(r, "N5 CATS 中文標籤", c("長髮") === "long hair", c("長髮"));
      check(r, "N6 dict 中英對照", c("絲襪") === "thighhighs", c("絲襪"));
      check(r, "N7 不存在的標籤回 null", c("definitely_not_a_tag_zzz") === null, c("definitely_not_a_tag_zzz"));
      check(r, "N8 自由描述回 null", c("pussy juice dripping down thighs") === null, c("pussy juice dripping down thighs"));
      check(r, "N9 權重括號可解析", c("(long hair:1.2)") === "long hair", c("(long hair:1.2)"));
      const learned = { general: [{ en: "tag_stats_custom", zh: "自訂" }], positive: [], negative: [] };
      localStorage.setItem("ui.learnedTags", JSON.stringify(learned)); fire("ui.learnedTags");
      check(r, "N10 學習標籤不能被當成權威",
        c("tag_stats_custom") === null && window.Tags.matchTag("tag_stats_custom") === "tag_stats_custom",
        { canonical: c("tag_stats_custom"), matchTag: window.Tags.matchTag("tag_stats_custom") });
      check(r, "N11 CATS 完整複合別名 lowleg", c("lowleg_panties/low_leg_panties") === "lowleg_panties", c("lowleg_panties/low_leg_panties"));
      check(r, "N12 CATS 完整複合別名 oral/fellatio", c("oral/fellatio") === "oral", c("oral/fellatio"));
      check(r, "N13 CATS 完整複合別名 pussy/vaginal", c("pussy/vaginal") === "pussy", c("pussy/vaginal"));
      check(r, "N14 複合別名大小寫＋底線", c("  ORAL/FELLATIO ") === "oral", c("  ORAL/FELLATIO "));
      check(r, "N15 不存在的 foo/bar 仍回 null", c("foo/bar") === null, c("foo/bar"));
      check(r, "N16 任意反轉組合不猜測", c("vaginal/pussy") === null, c("vaginal/pussy"));

      /* ── 統計：成功生成才計、一事一筆、正負分開 ── */
      localStorage.removeItem(K.main);
      evtKeys().forEach(k => localStorage.removeItem(k));
      window.Tags.syncStatsFromStorage();
      const g1 = await mockGenerate({
        sel: ["long hair", "blue eyes"],
        pos: "長髮",                       // Dict.tr → long hair，與 sel 重複
        neg: "short hair, long hair"       // long hair 正負都出現
      });
      const ev1 = evtKeys();
      check(r, "S1 mock 生成成功（無 GPU，2 張圖）", g1.ok === true, g1);
      check(r, "S2 一次任務只寫一個 evt key", ev1.length === 1, ev1);
      const tLong = rec("long hair"), tBlue = rec("blue eyes"), tShort = rec("short hair");
      check(r, "S3 正向計數＋同任務去重", tLong && tLong.positiveCount === 1 && tBlue && tBlue.positiveCount === 1,
        { long: tLong, blue: tBlue });
      check(r, "S4 負向計數（正負分欄）", tShort && tShort.negativeCount === 1 && tLong && tLong.negativeCount === 1,
        { short: tShort, long: tLong });
      check(r, "S5 lastUsedAt 是 Unix ms", tLong && tLong.lastUsedAt > 1.7e12 && tLong.lastUsedAt <= Date.now() + 1000, tLong && tLong.lastUsedAt);
      check(r, "S6 快照版本欄位", stats().version === 1, stats().version);

      // 同一 jobId 重複呼叫不得再加
      window.Tags.recordGeneration({ jobId: "dup-job", at: Date.now(), pos: ["long hair"], neg: [] });
      const afterFirst = rec("long hair").positiveCount;
      window.Tags.recordGeneration({ jobId: "dup-job", at: Date.now(), pos: ["long hair"], neg: [] });
      check(r, "S7 同 jobId 不重複計", rec("long hair").positiveCount === afterFirst, { before: afterFirst, after: rec("long hair").positiveCount });

      // 失敗生成：不新增 evt、計數不變
      const beforeFail = rec("long hair").positiveCount;
      const evBeforeFail = evtKeys().length;
      const gf = await mockGenerate({ fail: true, sel: ["long hair"], pos: "", neg: "" });
      check(r, "S8 失敗生成不計數", gf.ok === false && evtKeys().length === evBeforeFail && rec("long hair").positiveCount === beforeFail,
        { gf, events: evtKeys().length, count: rec("long hair").positiveCount });

      // 複合別名經由真實 prompt 流程統計（sel + #pos + #neg 都用完整 a/b 形式）
      const longBeforeComposite = rec("long hair").positiveCount;
      const gc = await mockGenerate({
        sel: ["lowleg_panties/low_leg_panties", "oral/fellatio"],
        pos: "oral/fellatio",                    // 與 sel 重複 → 同任務只算一次
        neg: "pussy/vaginal"
      });
      check(r, "S9 複合別名生成成功", gc.ok === true, gc);
      const rLow = rec("lowleg_panties"), rOral = rec("oral"), rPussy = rec("pussy");
      check(r, "S10 複合別名正/負向計數",
        rLow && rLow.positiveCount === 1 && rOral && rOral.positiveCount === 1 && rPussy && rPussy.negativeCount === 1,
        { low: rLow, oral: rOral, pussy: rPussy });
      check(r, "S11 同任務複合別名不重複計",
        rOral && rOral.positiveCount === 1 && rec("long hair").positiveCount === longBeforeComposite,
        { oral: rOral && rOral.positiveCount, long: rec("long hair").positiveCount });

      /* ── 收藏：使用者主動、未用過也能收藏、不誤觸選取 ── */
      // 先搜尋到 long hair（目前分類不一定 Display 它）
      const searchEl = document.querySelector("#search");
      if (searchEl) { searchEl.value = "long hair"; searchEl.dispatchEvent(new Event("input", { bubbles: true })); await sleep(150); }
      const beforeSel = JSON.stringify(window.Tags.selected());
      const star = Array.from(document.querySelectorAll("#tags .tag-fav"))
        .find(el => el.dataset.fav === "long hair");
      check(r, "F1 標籤上有收藏入口", !!star, !!star);
      if (star) {
        star.click();
        check(r, "F2 點星星不改變選取", JSON.stringify(window.Tags.selected()) === beforeSel,
          { before: beforeSel, after: JSON.stringify(window.Tags.selected()) });
        check(r, "F3 收藏已保存", rec("long hair").favorite === true && !!localStorage.getItem(favKeyOf("long hair")),
          rec("long hair"));
        fire(K.fav + encodeURIComponent("long hair"));
        check(r, "F4 收藏狀態可同步", window.Tags.isFavorite("long hair") === true, window.Tags.isFavorite("long hair"));
        document.querySelector("#tags .tag-fav[data-fav='long hair']").click();
        check(r, "F5 再點取消收藏", rec("long hair").favorite === false, rec("long hair"));
      }
      const favUnused = window.Tags.toggleFavorite("chibi", true);
      const ru = rec("chibi");
      check(r, "F6 未使用過的標籤也能收藏", favUnused === true && ru && ru.positiveCount === 0 && ru.negativeCount === 0 && ru.favorite === true, ru);

      // 複合別名：必須透過實際渲染出來的 UI 操作
      const adultBtn = document.querySelector("#btnAdult");
      if (adultBtn && adultBtn.getAttribute("aria-pressed") !== "true") adultBtn.click();
      await sleep(120);
      const searchC = document.querySelector("#search");
      if (searchC) { searchC.value = "lowleg"; searchC.dispatchEvent(new Event("input", { bubbles: true })); await sleep(150); }
      const compBtn = Array.from(document.querySelectorAll("#tags .tag"))
        .find(e => e.dataset.e === "lowleg_panties/low_leg_panties");
      check(r, "F7 複合別名在 UI 可見", !!compBtn, !!compBtn);
      if (compBtn) {
        const selBeforeComp = JSON.stringify(window.Tags.selected());
        const compStar = () => document.querySelector("#tags .tag[data-e='lowleg_panties/low_leg_panties'] .tag-fav");
        compStar().click();
        check(r, "F8 複合別名可收藏且不誤觸選取",
          rec("lowleg_panties").favorite === true && JSON.stringify(window.Tags.selected()) === selBeforeComp,
          { fav: rec("lowleg_panties"), sel: JSON.stringify(window.Tags.selected()) });
        check(r, "F8b 收藏後星號立即變色（gold class）",
          compStar().classList.contains("on"), compStar().className);
        compStar().click();
        check(r, "F9 複合別名可取消收藏", rec("lowleg_panties").favorite === false, rec("lowleg_panties"));
        compStar().click();   // 留著給 U4
      }

      /* ── UI：個人分類、搜尋不受影響 ── */
      const catBtns = Array.from(document.querySelectorAll("#cats .cat")).map(b => b.dataset.c);
      check(r, "U1 我的收藏分類存在", catBtns.indexOf("__fav__") >= 0 && catBtns.indexOf("__top__") >= 0, catBtns);
      const favCat = document.querySelector("#cats .cat[data-c='__fav__']");
      if (favCat) {
        favCat.click(); await sleep(120);
        const shown = Array.from(document.querySelectorAll("#tags .tag")).map(e => e.dataset.e);
        check(r, "U2 收藏分類只顯示已收藏標籤", shown.includes("chibi") && !shown.includes("long hair"), shown);
      }
      const search = document.querySelector("#search");
      if (search) { search.value = "blue"; search.dispatchEvent(new Event("input", { bubbles: true })); await sleep(120); }
      check(r, "U3 原有搜尋仍可用", Array.from(document.querySelectorAll("#tags .tag")).some(e => e.dataset.e === "blue eyes"),
        Array.from(document.querySelectorAll("#tags .tag")).slice(0, 5).map(e => e.dataset.e));
      if (search) { search.value = ""; search.dispatchEvent(new Event("input", { bubbles: true })); }
      const favCat2 = document.querySelector("#cats .cat[data-c='__fav__']");
      if (favCat2) {
        favCat2.click(); await sleep(120);
        const shown2 = Array.from(document.querySelectorAll("#tags .tag")).map(e => e.dataset.e);
        check(r, "U4 複合別名出現在我的收藏", shown2.includes("lowleg_panties/low_leg_panties"), shown2);
      }

      /* ── 跨分頁：以事件 key 合併，不整份覆寫 ── */
      const stable = {};
      ["sel", "adult", "showEn"].forEach(k => { stable[k] = localStorage.getItem(k); });
      localStorage.removeItem(K.main);
      evtKeys().forEach(k => localStorage.removeItem(k));
      allKeys().filter(k => k.indexOf(K.fav) === 0).forEach(k => localStorage.removeItem(k));
      window.Tags.syncStatsFromStorage();
      localStorage.setItem(K.evt + "simA", JSON.stringify({ at: 1000, pos: ["long hair"], neg: [] }));
      localStorage.setItem(K.evt + "simB", JSON.stringify({ at: 2000, pos: ["long hair", "blue eyes"], neg: ["short hair"] }));
      window.Tags.syncStatsFromStorage();
      check(r, "X1 同標籤並行更新合計", rec("long hair").positiveCount === 2, rec("long hair"));
      check(r, "X2 不同標籤並行更新都保留", rec("blue eyes").positiveCount === 1 && rec("short hair").negativeCount === 1,
        { blue: rec("blue eyes"), short: rec("short hair") });
      check(r, "X3 最近使用時間取最大值", rec("long hair").lastUsedAt === 2000, rec("long hair").lastUsedAt);
      localStorage.setItem(K.main, JSON.stringify({ version: 1, tags: { "long hair": { positiveCount: 0, negativeCount: 0, lastUsedAt: 1, favorite: false } } }));
      window.Tags.syncStatsFromStorage();
      check(r, "X4 舊分頁過期快照不會抹掉事件計數", rec("long hair").positiveCount === 2,
        rec("long hair"));
      localStorage.setItem(K.fav + encodeURIComponent("long hair"), JSON.stringify({ tag: "long hair", favorite: true, at: 100 }));
      localStorage.setItem(K.fav + encodeURIComponent("long hair"), JSON.stringify({ tag: "long hair", favorite: false, at: 200 }));
      window.Tags.syncStatsFromStorage();
      check(r, "X5 收藏衝突以較新時間為準", rec("long hair").favorite === false, rec("long hair"));
      localStorage.setItem(K.fav + encodeURIComponent("long hair"), JSON.stringify({ tag: "long hair", favorite: true, at: 999 }));
      localStorage.setItem(K.main, JSON.stringify({ version: 1, tags: { "long hair": { favorite: false } } }));
      fire(K.fav + encodeURIComponent("long hair"));
      check(r, "X6 storage event 觸發收藏同步", window.Tags.isFavorite("long hair") === true, window.Tags.isFavorite("long hair"));

      // ── 事件保留（不自動壓縮）與競態安全 ──
      localStorage.removeItem(K.main);
      evtKeys().forEach(k => localStorage.removeItem(k));
      allKeys().filter(k => k.indexOf(K.fav) === 0).forEach(k => localStorage.removeItem(k));
      window.Tags.syncStatsFromStorage();
      for (let i = 0; i < 305; i++) {
        localStorage.setItem(K.evt + "bulk-" + i, JSON.stringify({ at: 1000 + i, pos: ["long hair"], neg: [] }));
      }
      const beforePersist = evtKeys().length;
      window.Tags.recordGeneration({ jobId: "bulk-last", at: 2000, pos: ["long hair"], neg: [] });
      check(r, "X7 超過 300 筆事件不自動刪除", evtKeys().length === 306 && evtKeys().length >= beforePersist,
        { before: beforePersist, after: evtKeys().length });
      check(r, "X8 大量事件計數完整", rec("long hair").positiveCount === 306, rec("long hair"));
      localStorage.setItem(K.evt + "after-scan", JSON.stringify({ at: 3000, pos: ["blue eyes"], neg: [] }));
      window.Tags.syncStatsFromStorage();
      check(r, "X9 掃描後新增事件仍被計入", rec("blue eyes").positiveCount === 1 && rec("long hair").positiveCount === 306,
        { blue: rec("blue eyes"), long: rec("long hair").positiveCount });
      window.Tags.syncStatsFromStorage();
      check(r, "X10 重新載入不重複計數", rec("long hair").positiveCount === 306 && rec("blue eyes").positiveCount === 1,
        { long: rec("long hair").positiveCount, blue: rec("blue eyes").positiveCount });
      localStorage.setItem(K.fav + encodeURIComponent("long hair"), JSON.stringify({ tag: "long hair", favorite: true, at: 5000 }));
      window.Tags.syncStatsFromStorage();
      check(r, "X11 大量事件後收藏不受影響", rec("long hair").favorite === true, rec("long hair"));
      localStorage.setItem(K.evt + "tabA", JSON.stringify({ at: 6000, pos: ["long hair"], neg: [] }));
      localStorage.setItem(K.evt + "tabB", JSON.stringify({ at: 7000, pos: ["short hair"], neg: [] }));
      window.Tags.recordGeneration({ jobId: "tabC", at: 8000, pos: ["blue eyes"], neg: [] });
      check(r, "X12 多方事件並存不遺失",
        rec("long hair").positiveCount === 307 && rec("short hair").positiveCount === 1 && rec("blue eyes").positiveCount === 2,
        { long: rec("long hair").positiveCount, short: rec("short hair").positiveCount, blue: rec("blue eyes").positiveCount });

      /* ── 資料相容與損壞 ── */
      localStorage.setItem("ui.learnedTags", JSON.stringify([{ en: "legacy_arr", zh: "舊格式" }]));
      fire("ui.learnedTags");
      check(r, "C1 舊 learnedTags 陣列相容",
        JSON.parse(localStorage.getItem("ui.learnedTags"))[0].en === "legacy_arr",
        localStorage.getItem("ui.learnedTags"));
      localStorage.setItem(K.main, "{broken json");
      let threw = false;
      try { window.Tags.syncStatsFromStorage(); } catch (e) { threw = true; }
      check(r, "C2 損壞統計不造成例外", !threw, threw);
      check(r, "C3 損壞資料已備份且功能可用",
        allKeys().some(k => k.indexOf(K.broken) === 0) && Array.isArray(window.Tags.selected()),
        allKeys().filter(k => k.indexOf(K.broken) === 0));
      localStorage.setItem(K.main, JSON.stringify({ version: 99, tags: { x: {} } }));
      let threw2 = false;
      try { window.Tags.syncStatsFromStorage(); } catch (e) { threw2 = true; }
      check(r, "C4 未知版本安全降級", !threw2 && stats().version === 1, { threw2, version: stats().version });
      check(r, "C5 統計操作不改動 sel/adult/showEn",
        ["sel", "adult", "showEn"].every(k => localStorage.getItem(k) === stable[k]),
        { now: { sel: localStorage.getItem("sel"), adult: localStorage.getItem("adult"), showEn: localStorage.getItem("showEn") }, stable });
    } catch (e) {
      check(r, "例外", false, String(e && e.stack || e));
    } finally {
      restore(b);
      try {
        if (window.Tags && window.Tags.syncFromStorage) window.Tags.syncFromStorage();
        const pos = document.querySelector("#pos");
        if (pos) { pos.value = b["ui.extra"] || ""; }
        const search = document.querySelector("#search");
        if (search) { search.value = ""; search.dispatchEvent(new Event("input", { bubbles: true })); }
      } catch (e) { /* ignore */ }
    }
    return { passed: r.filter(x => x.ok).length, failed: r.filter(x => !x.ok).length, results: r };
  }

  function favKeyOf(tag) {
    return K.fav + encodeURIComponent(window.Tags.canonicalTag(tag) || tag);
  }

  window.__tagStatsTests = { unit, backup, restore, mockGenerate, canonical: () => window.Tags.canonicalTag };
})();
