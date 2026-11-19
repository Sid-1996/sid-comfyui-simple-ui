/* ============================================================
   跨分页状态同步测试（浏览器内执行，不调用真实 GPU）
   用法：在页面 main world 载入本档后呼叫 window.__syncTests.unit() /
   window.__syncTests.read() / window.__syncTests.mockGenerate()
   测试结束会自动还原所有 localStorage key。
   ============================================================ */
(function () {
  const KEYS = ["sel", "combos", "adult", "showEn", "ui.learnedTags", "ui.extra", "ui.genLog", "ui.gallery", "ui.settings"];

  function backup() {
    const b = {};
    KEYS.forEach(k => { b[k] = localStorage.getItem(k); });
    return b;
  }
  function restore(b) {
    KEYS.forEach(k => {
      const v = b[k];
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    });
  }
  function fire(key, newValue) {
    // 真实跨页储存由 Chrome 自行触发；同页测试用合成事件模拟「其他分页写入」
    window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea: localStorage }));
  }
  function selOf(tags) { return tags.map(t => ({ t, w: 1 })); }
  function check(results, name, ok, detail) { results.push({ name, ok: !!ok, detail }); }

  function read() {
    const pos = document.querySelector("#pos");
    return {
      selected: window.Tags && window.Tags.selected() ? window.Tags.selected().map(s => s.t) : null,
      storedSel: JSON.parse(localStorage.getItem("sel") || "[]").map(s => s.t),
      adult: window.Tags && window.Tags.selected ? document.querySelector("#btnAdult") ? document.querySelector("#btnAdult").getAttribute("aria-pressed") : null : null,
      showEn: document.querySelector("#btnEn") ? document.querySelector("#btnEn").getAttribute("aria-pressed") : null,
      learned: JSON.parse(localStorage.getItem("ui.learnedTags") || "null"),
      extra: localStorage.getItem("ui.extra"),
      pos: pos ? pos.value : null
    };
  }

  async function mockGenerate() {
    const origFetch = window.fetch;
    const calls = [];
    window.fetch = async function (url, opt) {
      const u = String(url);
      calls.push(u);
      if (u.includes("/comfy/prompt")) {
        try { window.__mockPromptBody = opt && opt.body; } catch (e) { /* ignore */ }
        return new Response(JSON.stringify({ prompt_id: "mock-" + Date.now() }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("/comfy/history/")) {
        const pid = u.split("/").pop();
        return new Response(JSON.stringify({
          [pid]: {
            status: { status_str: "success", messages: [] },
            outputs: { "7": { images: [{ filename: "mock_test.png", subfolder: "", type: "output" }] } }
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("/comfy/system_stats")) {
        return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return origFetch.apply(this, arguments);
    };
    try {
      const beforeT = Date.now();
      document.querySelector("#go").click();
      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        const gl = JSON.parse(localStorage.getItem("ui.genLog") || "[]");
        const fresh = gl.filter(r => r.event === "result" && r.t >= beforeT);
        if (fresh.length) return { ok: true, records: gl.slice(-4), calls };
        await new Promise(r => setTimeout(r, 100));
      }
      return { ok: false, calls, genLogLen: JSON.parse(localStorage.getItem("ui.genLog") || "[]").length };
    } finally {
      window.fetch = origFetch;
    }
  }

  async function unit() {
    const b = backup();
    const results = [];
    try {
      // 1 sel storage event 更新 state（含 UI）
      localStorage.setItem("sel", JSON.stringify(selOf(["alpha", "beta"])));
      fire("sel", localStorage.getItem("sel"));
      check(results, "sel storage 更新 Tags.selected()", JSON.stringify(window.Tags.selected().map(s => s.t)) === '["alpha","beta"]', read().selected);

      // 2 adult storage event
      localStorage.setItem("adult", "1");
      fire("adult", "1");
      check(results, "adult storage 更新 18+ UI", document.querySelector("#btnAdult").getAttribute("aria-pressed") === "true", read().adult);

      // 3 showEn storage event
      localStorage.setItem("showEn", "1");
      fire("showEn", "1");
      check(results, "showEn storage 更新 EN UI", document.querySelector("#btnEn").getAttribute("aria-pressed") === "true" && document.querySelector("#tags").classList.contains("show-en"), read().showEn);

      // 4 ui.learnedTags storage event
      const learned = { general: [{ en: "unit-learned", zh: "單元學習" }], positive: [], negative: [] };
      localStorage.setItem("ui.learnedTags", JSON.stringify(learned));
      fire("ui.learnedTags", JSON.stringify(learned));
      check(results, "learnedTags storage 更新資料", JSON.stringify(read().learned) === JSON.stringify(learned), read().learned);

      // 5 ui.extra storage event 更新 #pos
      localStorage.setItem("ui.extra", "unit-extra");
      fire("ui.extra", "unit-extra");
      check(results, "ui.extra storage 更新 #pos", document.querySelector("#pos").value === "unit-extra", read().pos);

      // 6 不產生寫入迴圈（同步期間不得寫 localStorage）
      const origSet = Storage.prototype.setItem;
      const writes = [];
      Storage.prototype.setItem = function (k, v) { writes.push(k); return origSet.call(this, k, v); };
      try {
        localStorage.setItem("sel", JSON.stringify(selOf(["gamma"])));
        writes.length = 0;
        fire("sel", localStorage.getItem("sel"));
        fire("ui.extra", "unit-extra");
      } finally { Storage.prototype.setItem = origSet; }
      check(results, "storage 同步不寫回 localStorage", writes.length === 0, writes);

      // 7 newValue === null（key 被其他分頁刪除）
      localStorage.removeItem("sel");
      fire("sel", null);
      check(results, "sel key 刪除 → 空選取", window.Tags.selected().length === 0, read().selected);
      localStorage.removeItem("ui.extra");
      fire("ui.extra", null);
      check(results, "ui.extra key 刪除 → #pos 清空", document.querySelector("#pos").value === "", read().pos);

      // 8/9/10 生成前強制讀取最新 sel/ui.extra，快照 prompt 一致
      localStorage.setItem("sel", JSON.stringify(selOf(["fresh-tag"])));
      localStorage.setItem("ui.extra", "fresh-extra");
      // #pos 以 DOM 輸入為準（模擬使用者剛輸入），input listener 同步寫入 localStorage
      const posEl = document.querySelector("#pos");
      if (posEl) { posEl.value = "fresh-extra"; posEl.dispatchEvent(new Event("input", { bubbles: true })); }
      const gen = await mockGenerate();
      const trigger = gen.records && gen.records.find(r => r.event === "trigger");
      const snapshotRec = gen.records && gen.records.find(r => r.event === "snapshot");
      check(results, "mock 生成完成（無 GPU）", gen.ok === true, gen.ok ? gen.calls.length : gen);
      check(results, "生成前重讀最新 sel", !!trigger && JSON.stringify(trigger.sel) === '["fresh-tag"]', trigger && trigger.sel);
      check(results, "生成前重讀最新 ui.extra", document.querySelector("#pos").value === "fresh-extra", read().pos);
      check(results, "快照 prompt 含最新標籤與補充詞", !!snapshotRec && snapshotRec.tags && JSON.stringify(snapshotRec.tags) === '["fresh-tag"]' && snapshotRec.posLen > 0, snapshotRec && { tags: snapshotRec.tags, posLen: snapshotRec.posLen });

      // 11/12 Tags.learn() 只寫 learnedTags，不覆蓋 sel
      localStorage.setItem("sel", JSON.stringify(selOf(["keep-me"])));
      fire("sel", localStorage.getItem("sel"));
      const beforeLearn = localStorage.getItem("sel");
      const writesLearn = [];
      const origSet2 = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { writesLearn.push(k); return origSet2.call(this, k, v); };
      try { window.Tags.learn(["unit-learned-2"], "general"); }
      finally { Storage.prototype.setItem = origSet2; }
      check(results, "Tags.learn 不覆蓋 sel", localStorage.getItem("sel") === beforeLearn && writesLearn.indexOf("sel") < 0, writesLearn);
      check(results, "Tags.learn 仍保存 learnedTags", writesLearn.indexOf("ui.learnedTags") >= 0 && String(localStorage.getItem("ui.learnedTags")).includes("unit-learned-2"), writesLearn);

      // 13 單分頁原有操作：點標籤仍即時更新並保存
      const beforeClick = window.Tags.selected().length;
      const tagBtn = Array.from(document.querySelectorAll("button.tag")).find(el => el.dataset.e === "masterpiece");
      if (tagBtn) tagBtn.click();
      const afterClick = window.Tags.selected().map(s => s.t);
      check(results, "單分頁點標籤仍正常", afterClick.length === beforeClick + 1 && afterClick.includes("masterpiece") && String(localStorage.getItem("sel")).includes("masterpiece"), afterClick);

      // 14 舊格式相容：learnedTags 舊陣列 / adult,showEn 字串
      localStorage.setItem("ui.learnedTags", JSON.stringify([{ en: "legacy", zh: "舊格式" }]));
      fire("ui.learnedTags", localStorage.getItem("ui.learnedTags"));
      const lg = JSON.parse(localStorage.getItem("ui.learnedTags"));
      check(results, "舊 learnedTags 陣列格式相容", Array.isArray(lg) && lg[0].en === "legacy", lg);
      check(results, "adult/showEn 沿用 '1'/'0' 格式", ["0", "1"].includes(localStorage.getItem("adult")) && ["0", "1"].includes(localStorage.getItem("showEn")), { adult: localStorage.getItem("adult"), showEn: localStorage.getItem("showEn") });
    } catch (e) {
      check(results, "例外", false, String(e && e.stack || e));
    } finally {
      restore(b);
      // 還原後同步一次，避免測試殘留在内存 state
      if (window.Tags && typeof window.Tags.syncFromStorage === "function") window.Tags.syncFromStorage();
      try { document.querySelector("#pos").value = b["ui.extra"] || ""; } catch (e) { /* ignore */ }
    }
    return { passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
  }

  window.__syncTests = { unit, read, mockGenerate, fire, backup, restore };
})();
