/* ============================================================
   app.js — 互動與生成邏輯
   ・ComfyUI 狀態 / 一鍵啟動
   ・WebSocket 真實進度 + 取消
   ・結果 / 歷史 / 大圖 / 提示詞視窗
   ============================================================ */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => window.Dict.esc(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const QUALITY = "masterpiece, best quality, amazing quality, ";
  const DEFAULT_NEG = "worst quality, low quality, bad anatomy, bad hands, extra fingers, missing fingers, watermark, text, signature, blurry, child, loli, shota";

  const DEFAULTS = {
    size: "1024x1024", n: 1, quality: true, neg: DEFAULT_NEG,
    steps: 25, cfg: 6, ckpt: "", seed: -1
  };

  function loadJSON(k, d) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }
    catch (e) { return d; }
  }
  function saveJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 無痕模式 */ }
  }

  const S = {
    running: false, starting: false, cancelled: false, promptId: null, comfyUp: false,
    settings: Object.assign({}, DEFAULTS, loadJSON("ui.settings", {})),
    gallery: loadJSON("ui.gallery", []),
    results: [], lbList: [], lbIndex: 0, queue: 0,
    ws: null, t0: 0, seedUsed: null
  };
  S.gallery = Array.isArray(S.gallery) ? S.gallery.slice(0, 24) : [];

  /* ── 小工具 ────────────────────────────────────────────── */
  function toast(msg, kind, ms) {
    const el = document.createElement("div");
    el.className = "toast " + (kind || "");
    el.textContent = msg;
    $("toasts").appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 220);
    }, ms || 3200);
  }

  async function api(path, opt) {
    const r = await fetch("/comfy" + path, opt);
    if (!r.ok) {
      let t = "";
      try { t = await r.text(); } catch (e) { /* ignore */ }
      throw new Error(path + " → " + r.status + " " + t.slice(0, 300));
    }
    return r;
  }

  function translateError(e) {
    const m = String((e && e.message) || e).toLowerCase();
    if (/out of memory|allocation|oom|memory/.test(m))
      return "顯卡記憶體不夠：把尺寸改小或張數改成 1，再試一次。";
    if (/ckpt_name|value not in list|not in list/.test(m))
      return "模型沒載入：按右上角的狀態列重新連線。";
    if (/502|failed to fetch|not reachable/.test(m))
      return "ComfyUI 沒回應：按右上角狀態列把它叫起來。";
    if (/501|400/.test(m) && m.includes("prompt"))
      return "提示詞格式有問題，按「完整提示詞」看看內容。";
    return "生成失敗：" + ((e && e.message) || "未知錯誤");
  }

  /* ── ComfyUI 狀態 ──────────────────────────────────────── */
  async function checkComfy(silent) {
    if (!silent) setStatus("checking", "檢查 ComfyUI…");
    try {
      const r = await fetch("/comfy/system_stats", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      S.comfyUp = true;
      setStatus("up", "ComfyUI 已連線");
      if (!S.ws) connectWS();
      if (!$("ckpt").options.length) loadCkpts();
      return true;
    } catch (e) {
      S.comfyUp = false;
      setStatus("down", "ComfyUI 沒開 · 點我開啟");
      return false;
    }
  }

  function setStatus(state, text) {
    const p = $("statusPill");
    p.dataset.state = state === "checking" ? "" : state;
    $("statusText").textContent = text;
  }

  async function startComfy() {
    if (S.running) return false;
    setStatus("starting", "正在啟動 ComfyUI…");
    toast("正在啟動 ComfyUI，第一次要 20～40 秒…", "warn", 5000);
    try {
      const r = await fetch("/start-comfy", { method: "POST" });
      const j = await r.json();
      if (j.ok) {
        S.comfyUp = true;
        setStatus("up", "ComfyUI 已連線");
        toast("ComfyUI 啟動完成，可以開始了", "ok");
        connectWS();
        await loadCkpts();
        return true;
      }
    } catch (e) { /* 下面統一處理 */ }
    setStatus("down", "ComfyUI 開不起來 · 點我重試");
    toast("ComfyUI 啟動失敗，請看 logs/comfyui.err.log", "err", 6000);
    return false;
  }

  async function ensureComfy() {
    if (S.comfyUp) return true;
    if (await checkComfy(true)) return true;
    return startComfy();
  }

  async function loadCkpts() {
    try {
      const j = await (await api("/object_info/CheckpointLoaderSimple")).json();
      const list = (j.CheckpointLoaderSimple.input.required.ckpt_name[0]) || [];
      const sel = $("ckpt");
      sel.innerHTML = list.length
        ? list.map(x => {
            const short = x.replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, "");
            return `<option value="${esc(x)}" title="${esc(x)}">${esc(short)}</option>`;
          }).join("")
        : '<option value="">（找不到模型）</option>';
      const want = list.includes(S.settings.ckpt) ? S.settings.ckpt
        : (list.find(x => /wai|illustrious/i.test(x)) || list[0] || "");
      if (want) { sel.value = want; S.settings.ckpt = want; saveJSON("ui.settings", S.settings); }
    } catch (e) { /* 狀態列已表達 */ }
  }

  /* ── WebSocket 真實進度（經 7860 同源代理）─────────────── */
  let wsTries = 0;

  function connectWS() {
    if (S.ws) { try { S.ws.close(); } catch (e) { /* ignore */ } S.ws = null; }
    let cid;
    try { cid = crypto.randomUUID(); } catch (e) { cid = String(Math.random()).slice(2) + Date.now(); }
    let ws;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    try { ws = new WebSocket(proto + "//" + location.host + "/ws?clientId=" + cid); }
    catch (e) { return; }
    S.ws = ws;
    ws.onopen = () => { wsTries = 0; };
    ws.onmessage = ev => {
      if (typeof ev.data !== "string") return;   // 預覽圖等二進位訊息
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      onWs(m);
    };
    ws.onerror = () => { /* 交給 onclose */ };
    ws.onclose = () => {
      S.ws = null;
      if (!S.comfyUp) return;
      wsTries++;
      const delay = Math.min(30000, 2000 * wsTries);   // 失敗時退避，避免洗版
      setTimeout(() => { if (!S.ws && S.comfyUp) connectWS(); }, delay);
    };
  }

  function onWs(m) {
    if (m.type === "progress" && m.data && m.data.prompt_id === S.promptId) {
      setProgress(m.data.value, m.data.max);
    } else if (m.type === "execution_start" && m.data && m.data.prompt_id === S.promptId) {
      setProgress(0, S.settings.steps);
    } else if (m.type === "executing" && m.data && m.data.prompt_id === S.promptId && m.data.node === null) {
      setProgress(S.settings.steps, S.settings.steps);
    } else if (m.type === "status" && m.data && m.data.status && m.data.status.exec_info) {
      S.queue = m.data.status.exec_info.queue_remaining || 0;
    } else if (m.type === "execution_error" && m.data && m.data.prompt_id === S.promptId) {
      S.lastError = m.data.exception_message || m.data.exception_type || "";
    }
  }

  function setProgress(v, m) {
    const pct = m > 0 ? Math.min(100, Math.round(v / m * 100)) : 0;
    $("progPct").textContent = pct + "%";
    $("progStep").textContent = m ? `第 ${v}/${m} 步` : "準備中";
    const c = 2 * Math.PI * 52;
    $("ringFg").style.strokeDashoffset = String(c * (1 - pct / 100));
  }

  /* ── 舞台切換 ──────────────────────────────────────────── */
  function showStage(which) {
    $("stageEmpty").hidden = which !== "empty";
    $("stageProgress").hidden = which !== "progress";
    $("stageResults").hidden = which !== "results";
  }

  /* ── 隨機配一組：標籤 + 補充描述 + 種子一起換 ─────────── */
  function surpriseCombo() {
    const name = window.Tags.applyRandomCombo();
    const pos = $("pos");
    if (pos) {
      pos.value = "";
      try { localStorage.removeItem("ui.extra"); } catch (e) { /* 無痕模式 */ }
    }
    $("seed").value = String(Math.floor(Math.random() * 4294967295));
    updateWarn();
    syncGo();
    return name;
  }

  /* ── 生成 ──────────────────────────────────────────────── */
  function composePrompt() {
    const base = window.Tags.buildPrompt();
    const q = S.settings.quality ? QUALITY : "";
    return (q + base).replace(/^[,\s]+|[,\s]+$/g, "");
  }

  function wf(o) {
    return {
      "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: o.ckpt } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: o.pos, clip: ["1", 1] } },
      "3": { class_type: "CLIPTextEncode", inputs: { text: o.neg, clip: ["1", 1] } },
      "4": { class_type: "EmptyLatentImage", inputs: { width: o.w, height: o.h, batch_size: o.n } },
      "5": { class_type: "KSampler", inputs: {
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0],
        seed: o.seed, steps: o.steps, cfg: o.cfg,
        sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1 } },
      "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
      "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "ui" } }
    };
  }

  async function generate() {
    if (S.running || S.starting) return;

    // 防呆：什麼都沒選就自動配一組，不讓使用者卡住
    if (!window.Tags.hasContent()) {
      const name = surpriseCombo();
      toast(`幫你套用了「${name}」`, "ok");
    }

    // 等 ComfyUI 起床的期間也算忙碌，避免連點送出兩份
    S.starting = true;
    syncGo();
    const comfyOk = await ensureComfy();
    S.starting = false;
    if (!comfyOk) { syncGo(); return; }

    const ckpt = $("ckpt").value;
    if (!ckpt) {
      toast("模型還沒載入好，稍等幾秒再按一次", "warn");
      loadCkpts();
      syncGo();
      return;
    }

    const [w, h] = S.settings.size.split("x").map(Number);
    let seed = Number($("seed").value);
    if (!Number.isFinite(seed) || seed < 0) seed = Math.floor(Math.random() * 4294967295);
    S.seedUsed = seed;

    const o = {
      ckpt, pos: composePrompt(), neg: $("neg").value,
      w, h, n: S.settings.n, seed,
      steps: Number($("steps").value) || 25,
      cfg: Number($("cfg").value) || 6
    };
    const selSnap = window.Tags.snapshot();
    const extraSnap = ($("pos").value || "").trim();
    const negSnap = ($("neg").value || "").trim();

    S.running = true;
    S.cancelled = false;
    S.promptId = null;
    S.lastError = "";
    S.t0 = Date.now();
    S.queue = 0;
    syncGo();
    showStage("progress");
    setProgress(0, o.steps);
    $("progPct").textContent = "0%";
    $("progStep").textContent = "送出中…";

    try {
      const res = await (await api("/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: wf(o) })
      })).json();

      S.promptId = res.prompt_id;
      const hist = await waitFor(S.promptId);
      if (!hist || S.cancelled) return;

      const status = hist.status || {};
      if (status.status_str === "error") {
        throw new Error(S.lastError || "ComfyUI 回報錯誤（看 ComfyUI 視窗或 logs）");
      }
      if (o.n > 1) {
        const msgs = status.messages || [];
        const failed = msgs.find(m => m[0] === "execution_error");
        if (failed) throw new Error(failed[1].exception_message || "生成中斷");
      }

      const outs = (hist.outputs && hist.outputs["7"] && hist.outputs["7"].images) || [];
      if (!outs.length) throw new Error("沒有拿到圖片，請再試一次");

      const items = outs.map(f => ({
        url: "/comfy/view?filename=" + encodeURIComponent(f.filename) +
             "&subfolder=" + encodeURIComponent(f.subfolder || "") +
             "&type=" + (f.type || "output"),
        filename: f.filename,
        seed, w, h,
        sel: selSnap,
        extra: extraSnap,
        neg: negSnap,
        prompt: o.pos,
        at: Date.now()
      }));

      S.results = items;
      S.gallery = [...items, ...S.gallery].slice(0, 24);
      saveJSON("ui.gallery", S.gallery);
      renderResults(items);
      renderHistory();
      showStage("results");
      const secs = Math.round((Date.now() - S.t0) / 1000);
      // 標籤學習：依來源分開記錄（生成成功才學）
      try {
        const splitTok = (raw) => String(raw || "").split(",").map(t => t.trim())
          .map(t => t.replace(/^\((.*)\)$/, "$1").split(":")[0].trim())
          .filter(Boolean);
        if (window.Tags && typeof window.Tags.learn === "function") {
          window.Tags.learn(splitTok(extraSnap), "general");
          window.Tags.learn((selSnap || []).map(x => x.t), "positive");
          window.Tags.learn(splitTok(negSnap), "negative");
        }
      } catch (e) { /* 學習失敗不影響生成結果 */ }

      toast(`完成！${secs} 秒 · ${items.length} 張`, "ok");
    } catch (e) {
      if (!S.cancelled) {
        toast(translateError(e), "err", 6500);
        showStage(S.results.length ? "results" : "empty");
      }
    } finally {
      S.running = false;
      S.promptId = null;
      syncGo();
    }
  }

  async function waitFor(pid) {
    const end = Date.now() + 15 * 60 * 1000;
    while (Date.now() < end) {
      if (S.cancelled) return null;
      try {
        const hs = await (await api("/history/" + pid)).json();
        if (hs[pid]) return hs[pid];
      } catch (e) {
        if (S.cancelled) return null;
        throw e;
      }
      await sleep(700);
    }
    throw new Error("等超過 15 分鐘，先看看 ComfyUI 視窗")
  }

  async function cancel() {
    if (!S.running) return;
    S.cancelled = true;
    const hdr = { "Content-Type": "application/json" };
    try {
      if (S.promptId) await api("/queue", { method: "POST", headers: hdr, body: JSON.stringify({ delete: [S.promptId] }) });
    } catch (e) { /* 可能已經開始跑 */ }
    try { await api("/interrupt", { method: "POST", headers: hdr, body: "{}" }); } catch (e) { /* ignore */ }
    toast("已取消這次生成", "warn");
    showStage(S.results.length ? "results" : "empty");
    S.running = false;
    S.promptId = null;
    syncGo();
  }

  /* ── 結果與歷史 ────────────────────────────────────────── */
  function renderResults(items) {
    const box = $("stageResults");
    box.dataset.n = String(items.length);
    const portrait = items[0] && items[0].h > items[0].w;
    const cols = items.length === 1 ? 1 : (items.length === 4 && portrait ? 4 : 2);
    box.style.setProperty("--cols", cols);
    box.innerHTML = items.map((it, i) =>
      `<figure class="shot" data-i="${i}">
        <img src="${esc(it.url)}" alt="${esc(it.filename)}" loading="lazy">
        <div class="shot-actions">
          <button type="button" data-act="zoom">放大</button>
          <button type="button" data-act="dl">下載</button>
          <button type="button" data-act="seed">同種子</button>
          <button type="button" data-act="prompt">同提示詞</button>
          <button type="button" data-act="del" class="danger">刪除</button>
        </div>
        <figcaption class="shot-meta">${it.w}×${it.h} · 種子 ${it.seed}</figcaption>
      </figure>`
    ).join("");
    // 圖被刪掉時不要留下破圖，先藏起來再讓後台同步
    box.querySelectorAll("img").forEach(img => {
      img.addEventListener("error", () => {
        const card = img.closest(".shot");
        if (card) card.style.visibility = "hidden";
        syncGallery();
      }, { once: true });
    });
  }

  function renderHistory() {
    const has = S.gallery.length > 0;
    $("history").hidden = !has;
    $("histBar").innerHTML = has
      ? S.gallery.map((it, i) =>
        `<button type="button" class="thumb" data-i="${i}" title="${esc(it.filename)}">
          <img src="${esc(it.url)}" alt="" loading="lazy">
          <span class="thumb-del" data-del="${i}" title="刪除這張">×</span>
        </button>`).join("")
      : "";
    if (!has) return;
    $("histBar").querySelectorAll("img").forEach(img => {
      img.addEventListener("error", () => {
        const t = img.closest(".thumb");
        if (t) t.style.visibility = "hidden";
        syncGallery();
      }, { once: true });
    });
  }

  /* ── 圖片同步：使用者可能在資料夾直接刪圖 ─────────────────
     開頁 / 回到視窗 / 每 45 秒問一次後台（後台再問 ComfyUI），
     把已刪除的圖默默移掉，舞台、歷史列、燈箱一起更新，
     不留破圖也不跳錯誤。                                      */
  let syncing = false;
  async function syncGallery() {
    if (syncing || !S.gallery.length) return;
    syncing = true;
    try {
      const files = S.gallery.map(it => {
        const q = new URLSearchParams((it.url || "").split("?")[1] || "");
        return {
          filename: it.filename,
          subfolder: q.get("subfolder") || "",
          type: q.get("type") || "output"
        };
      });
      const r = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files })
      });
      if (!r.ok) return;
      const j = await r.json();
      // 後台說「ComfyUI 沒開」時不要動任何東西，避免誤刪
      if (j.comfy === false) return;
      const gone = new Set((j.missing || []).map(x => x.filename));
      if (!gone.size) return;

      const keep = S.gallery.filter(it => !gone.has(it.filename));
      const alive = new Set(keep.map(it => it.url));
      S.gallery = keep;
      saveJSON("ui.gallery", S.gallery);

      // 舞台：還在的就重畫；目前看的那批全沒了，就退回最新一批，真的沒圖才回空狀態
      S.results = S.results.filter(it => alive.has(it.url));
      if (!S.running) {
        if (!S.results.length && S.gallery.length) {
          const lastAt = S.gallery[0].at;
          S.results = S.gallery.filter(g => g.at === lastAt);
        }
        if (S.results.length) renderResults(S.results);
        else showStage("empty");
      }
      renderHistory();

      // 燈箱：正在看的那張若被刪，跳到還存在的；都沒有就關掉
      if (!$("lightbox").hidden) {
        const lb = S.lbList.filter(it => alive.has(it.url));
        if (!lb.length) closeLightbox();
        else {
          S.lbList = lb;
          S.lbIndex = Math.min(S.lbIndex, lb.length - 1);
          paintLightbox();
        }
      }
    } catch (e) {
      /* 後台靜默：後端沒開或連線失敗時什麼都不做 */
    } finally {
      syncing = false;
    }
  }

  function itemByIndex(i) { return S.gallery[i]; }

  /* ── 大圖 ──────────────────────────────────────────────── */
  function openLightbox(list, index) {
    S.lbList = list;
    S.lbIndex = index;
    $("lightbox").hidden = false;
    paintLightbox();
  }

  function paintLightbox() {
    const it = S.lbList[S.lbIndex];
    if (!it) return closeLightbox();
    $("lbImg").src = it.url;
    $("lbImg").alt = it.filename;
    $("lbCount").textContent = `${S.lbIndex + 1} / ${S.lbList.length}`;
    $("lbMeta").textContent = `${it.w}×${it.h} · 種子 ${it.seed} · ${it.filename}`;
    const many = S.lbList.length > 1;
    $("lbPrev").hidden = !many;
    $("lbNext").hidden = !many;
  }

  function lbStep(d) {
    if (S.lbList.length < 2) return;
    S.lbIndex = (S.lbIndex + d + S.lbList.length) % S.lbList.length;
    paintLightbox();
  }

  function closeLightbox() {
    $("lightbox").hidden = true;
    $("lbImg").src = "";
  }

  function download(it) {
    const a = document.createElement("a");
    a.href = it.url;
    a.download = it.filename || "image.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function reuseSeed(it) {
    $("seed").value = String(it.seed);
    S.settings.seed = it.seed;
    saveJSON("ui.settings", S.settings);
    updateAdvSummary();
    toast(`已套用種子 ${it.seed}，按生成就能重現`, "ok");
  }

  function reusePrompt(it) {
    window.Tags.restore(it.sel || []);
    $("pos").value = it.extra || "";
    try { localStorage.setItem("ui.extra", $("pos").value); } catch (e) { /* ignore */ }
    if (it.neg) { $("neg").value = it.neg; persistSettings(); }
    updateWarn();
    toast("已套用這張圖的提示詞", "ok");
  }

  /* ── 刪圖 ─────────────────────────────────────────────── */
  function confirmDelete(it) {
    if (!it) return;
    openModal("刪除這張圖？", `
      <div class="del-preview"><img src="${esc(it.url)}" alt=""></div>
      <p class="del-name">${esc(it.filename)}</p>
      <p>圖片會移到 Windows 資源回收筒（之後還能還原），歷史紀錄也會一起移除。</p>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>取消</button>
        <button type="button" class="btn btn-danger" id="btnDoDelete">刪除</button>
      </div>`);
    $("btnDoDelete").onclick = () => { closeModal(); doDelete(it); };
  }

  // 從歷史、舞台、燈箱一起移除，避免留下破圖
  function dropImages(urls) {
    const gone = new Set(urls);
    S.gallery = S.gallery.filter(it => !gone.has(it.url));
    saveJSON("ui.gallery", S.gallery);

    S.results = S.results.filter(it => !gone.has(it.url));
    if (!S.running) {
      if (!S.results.length && S.gallery.length) {
        const lastAt = S.gallery[0].at;
        S.results = S.gallery.filter(g => g.at === lastAt);
      }
      if (S.results.length) renderResults(S.results);
      else showStage("empty");
    }
    renderHistory();

    if (!$("lightbox").hidden) {
      const lb = S.lbList.filter(it => !gone.has(it.url));
      if (!lb.length) closeLightbox();
      else {
        S.lbList = lb;
        S.lbIndex = Math.min(S.lbIndex, lb.length - 1);
        paintLightbox();
      }
    }
  }

  async function doDelete(it) {
    const q = new URLSearchParams((it.url || "").split("?")[1] || "");
    try {
      const r = await fetch("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: it.filename,
          subfolder: q.get("subfolder") || "",
          type: q.get("type") || "output"
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status));
      dropImages([it.url]);
      toast(j.recycled ? "已刪除，檔案在資源回收筒" : "已刪除", "ok");
    } catch (e) {
      toast("刪不掉：" + (e.message || e) + "（檔案可能被鎖住）", "err", 5000);
    }
  }


  function openModal(title, html) {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = html;
    $("modal").hidden = false;
  }

  function closeModal() { $("modal").hidden = true; }

  function showPromptModal() {
    const p = composePrompt();
    const neg = $("neg").value.trim();
    openModal("完整提示詞", `
      <p class="meta" style="margin-bottom:8px">這就是真正送進模型的內容（正面 ${p.split(",").filter(x => x.trim()).length} 個標籤）。</p>
      <div class="prompt-box">${p ? esc(p) : "（空的）"}</div>
      ${neg ? `<h3>負面提示詞</h3><div class="prompt-box">${esc(neg)}</div>` : ""}
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>關閉</button>
        <button type="button" class="btn btn-soft" id="btnCopyPrompt">複製提示詞</button>
      </div>`);
    const cp = $("btnCopyPrompt");
    if (cp) cp.onclick = async () => {
      try {
        await navigator.clipboard.writeText(p);
        toast("已複製", "ok");
      } catch (e) {
        toast("複製失敗，請手動選取", "warn");
      }
    };
  }

  function showHelp() {
    openModal("怎麼用", `
      <div class="mascot-tip">
        <img src="/assets/mascot-happy.webp" alt="">
        <p>照下面做就好，不用記任何語法。卡住就按右上角的 <b>?</b> 再看一次。</p>
      </div>
      <h3>三步驟</h3>
      <ol>
        <li>左邊點標籤（像點菜），點 3～6 個；不確定就按 <b>隨機配一組</b>。</li>
        <li>下面會出現你選的標籤，拖曳可調順序、<kbd>＋</kbd><kbd>−</kbd> 調強度、<kbd>×</kbd> 移除。</li>
        <li>按右下角 <b>生成</b>，約 20 秒出圖；完成後點圖可放大。</li>
      </ol>
      <h3>想寫自己的描述</h3>
      <p>左下角「補充描述」可以直接打中文，例如「櫻花 夜晚 回頭」。翻不掉的中文會用橘色標出來，點一下會幫你搜尋對應標籤。</p>
      <h3>鍵盤</h3>
      <p><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 生成　<kbd>Esc</kbd> 取消／關閉　<kbd>/</kbd> 搜尋標籤　<kbd>←</kbd><kbd>→</kbd> 換圖　<kbd>?</kbd> 這份說明</p>
      <h3>常見問題</h3>
      <p><b>按生成沒反應？</b>看右上角狀態列：黃燈就是 ComfyUI 沒開，點一下會自動幫你啟動。</p>
      <p><b>顯卡記憶體不夠？</b>把尺寸改小、張數改 1，或把步數降到 20。</p>
      <p><b>圖存到哪？</b>D:\\ComfyUI_output，右上「圖片資料夾」可以直接打開。</p>
      <div class="modal-foot"><button type="button" class="btn btn-soft" data-close>知道了</button></div>`);
  }

  /* ── 設定 ──────────────────────────────────────────────── */
  function applySettings() {
    const s = S.settings;
    $("sizes").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.size === s.size));
    $("counts").querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.n === s.n));
    $("q").checked = !!s.quality;
    $("neg").value = s.neg;
    $("steps").value = s.steps;
    $("cfg").value = s.cfg;
    $("seed").value = s.seed;
    $("setHint").textContent = s.size.replace("x", " × ");
    updateAdvSummary();
  }

  function persistSettings() {
    S.settings.neg = $("neg").value;
    S.settings.steps = Number($("steps").value) || 25;
    S.settings.cfg = Number($("cfg").value) || 6;
    S.settings.seed = Number($("seed").value);
    S.settings.ckpt = $("ckpt").value || S.settings.ckpt;
    saveJSON("ui.settings", S.settings);
    updateAdvSummary();
  }

  function updateAdvSummary() {
    $("advSummary").textContent =
      `步數 ${$("steps").value || 25} · CFG ${$("cfg").value || 6} · 種子 ${$("seed").value || "-1"}`;
  }

  /* ── 按鈕狀態（單一主動作）─────────────────────────────── */
  function syncGo() {
    const go = $("go");
    if (S.running || S.starting) {
      go.disabled = true;
      go.classList.remove("is-guide");
      $("goText").textContent = S.running ? "生成中…" : "準備中…";
      return;
    }
    go.disabled = false;
    const has = window.Tags.hasContent();
    go.classList.toggle("is-guide", !has);
    $("goText").textContent = has ? "生成" : "幫我配一組";
  }

  /* ── 補充描述 ──────────────────────────────────────────── */
  function updateWarn() {
    const raw = ($("pos").value || "").trim();
    if (!raw) { $("warn").innerHTML = ""; return; }
    const left = window.Dict.leftover(raw);
    $("warn").innerHTML = left.length
      ? `<span>這些中文還沒對應標籤（點一下幫你找）：</span>` +
        left.map(w => `<button type="button" class="wchip" data-w="${esc(w)}">${esc(w)}</button>`).join("")
      : "";
  }

  function updateNegWarn() {
    const raw = ($("neg").value || "").trim();
    const el = $("negWarn");
    if (!el) return;
    if (!raw) { el.innerHTML = ""; return; }
    const left = window.Dict.leftover(raw);
    el.innerHTML = left.length
      ? `<span>這些中文還沒對應標籤：</span>` + left.map(w => `<span class="wchip">${esc(w)}</span>`).join("")
      : "";
  }

  /* ── 圖片反推（WD14 EVA02）───────────────────────────────── */
  const RV = {
    file: null, dataUrl: "", running: false,
    rating: null, general: [], character: [], timing: null,
    picked: new Set()
  };

  // 提示詞去重用的正規化：底線與空格視為同一個標籤
  function normKey(s) {
    return String(s || "").toLowerCase().trim().replace(/[_\s]+/g, " ");
  }

  function rvResetResult() {
    RV.rating = null; RV.general = []; RV.character = []; RV.timing = null;
    RV.picked = new Set();
    $("revRating").hidden = true;
    $("revGeneral").innerHTML = "";
    $("revCharacter").innerHTML = "";
    $("revGeneralCount").textContent = "";
    $("revCharCount").textContent = "";
    $("revFootMeta").textContent = "";
    rvUpdateApply();
  }

  function rvUpdateApply() {
    const n = RV.picked.size;
    $("revApply").disabled = n === 0;
    $("revApply").textContent = "加入提示詞（" + n + "）";
  }

  function rvError(msg) {
    const el = $("revError");
    el.textContent = msg;
    el.hidden = false;
  }

  function rvExplain(e) {
    const m = String((e && e.message) || e);
    // 忙碌（429）不是失敗：直接顯示後端的白話訊息，不要冠「反推失敗」
    if (/太多|等一下再試|稍等|忙碌/.test(m)) return m;
    if (/逾時/.test(m)) return "分析太久了，這次沒等到結果。按「反推標籤」再試一次，或換張小一點的圖。";
    if (/Worker|worker|503|502/.test(m)) return "反推服務沒回應，按一下 F5 重新整理再試。";
    if (/只認|格式/.test(m)) return "這個檔案格式不行，請換 PNG 或 JPG 圖片。";
    if (/太大/.test(m)) return "圖片太大囉，換小一點的再試（最長邊 1024px 會自動縮）。";
    if (/太小/.test(m)) return "這張圖太小了，看不出內容，換大一點的試試。";
    if (/壞了|空的/.test(m)) return "圖片資料有問題，重新選一次圖片就好。";
    return "反推失敗：" + m;
  }

  function rvDownscale(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const max = 1024;
        const w0 = img.naturalWidth || img.width;
        const h0 = img.naturalHeight || img.height;
        if (!w0 || !h0 || Math.max(w0, h0) <= max) { resolve(dataUrl); return; }
        const k = max / Math.max(w0, h0);
        const w = Math.max(1, Math.round(w0 * k));
        const h = Math.max(1, Math.round(h0 * k));
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(cv.toDataURL("image/png")); } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error("decode failed"));
      img.src = dataUrl;
    });
  }

  function rvPick(file) {
    if (!file) return;
    $("revError").hidden = true;
    if (!/^image\//.test(file.type || "")) {
      rvError("這不是圖片，請選 PNG、JPG 或 WebP。");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      rvError("圖片太大了（上限 20 MB），請換小一點的。");
      return;
    }
    RV.file = file;
    RV.dataUrl = "";
    rvResetResult();
    const reader = new FileReader();
    reader.onerror = () => rvError("圖片讀取失敗，換一張試試。");
    reader.onload = () => {
      rvDownscale(reader.result).then(url => {
        RV.dataUrl = url;
        $("revPreview").src = url;
        $("revPreview").hidden = false;
        $("revHint").hidden = true;
        $("revFileMeta").textContent = file.name + " · " +
          Math.max(1, Math.round(file.size / 1024)) + " KB";
        $("revRun").disabled = false;
        $("revStatus").textContent = "準備好了，按「反推標籤」開始。";
      }).catch(() => rvError("圖片讀取失敗，換一張試試。"));
    };
    reader.readAsDataURL(file);
  }

  async function rvRun() {
    if (RV.running || !RV.dataUrl) return;
    RV.running = true;
    $("revRun").disabled = true;
    $("revRun").textContent = "分析中…";
    $("revError").hidden = true;
    $("revStatus").textContent = "正在分析圖片，大約要 5～15 秒，請稍等…";
    try {
      const r = await fetch("/api/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: RV.dataUrl, threshold: 0.35, character_threshold: 0.85
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status));
      RV.rating = j.rating || null;
      RV.general = Array.isArray(j.general) ? j.general : [];
      RV.character = Array.isArray(j.character) ? j.character : [];
      RV.timing = j.timing || {};
      rvRender();
      const n = RV.general.length + RV.character.length;
      $("revStatus").textContent = n
        ? ("找到 " + n + " 個標籤，取消不要的，再按「加入提示詞」。")
        : "這張圖沒找到標籤，換一張試試。";
    } catch (e) {
      rvError(rvExplain(e));
      $("revStatus").textContent = "";
    } finally {
      RV.running = false;
      $("revRun").disabled = !RV.dataUrl;
      $("revRun").textContent = "反推標籤";
      rvUpdateApply();
    }
  }

  function rvRenderGroup(id, list, kind) {
    const el = $(id);
    if (!list.length) {
      el.innerHTML = kind === "character"
        ? "<div class=\"rev-empty\">這張圖沒有認出特定角色。</div>"
        : "<div class=\"rev-empty\">沒有一般標籤。</div>";
      return;
    }
    el.innerHTML = list.map(t => {
      const label = String(t.name || "").replace(/_/g, " ");
      const lib = window.Tags.matchTag(t.name);
      const zh = lib ? window.Tags.tagZh(lib) : "";
      const tip = zh ? (zh + " · " + t.name) : t.name;
      const adult = window.Tags.isAdult(t.name);
      return "<button type=\"button\" class=\"rev-tag" + (adult ? " adult" : "") + "\" " +
        "data-kind=\"" + kind + "\" data-name=\"" + esc(t.name) + "\" title=\"" + esc(tip) + "\">" +
        "<span>" + esc(label) + "</span><i>" + Math.round((t.score || 0) * 100) + "</i></button>";
    }).join("");
  }

  function rvRender() {
    const r = RV.rating;
    if (r && r.name) {
      $("revRating").hidden = false;
      $("revRating").innerHTML = "內容分級：<b>" + esc(r.name) + "</b>" +
        "<span class=\"meta\">（" + Math.round((r.score || 0) * 100) + "%，只供參考）</span>";
    } else {
      $("revRating").hidden = true;
    }
    $("revGeneralCount").textContent = RV.general.length ? ("（" + RV.general.length + "）") : "";
    $("revCharCount").textContent = RV.character.length ? ("（" + RV.character.length + "）") : "";
    rvRenderGroup("revGeneral", RV.general, "general");
    rvRenderGroup("revCharacter", RV.character, "character");
    // 預設全選，使用者再取消不要的
    RV.picked = new Set();
    RV.general.forEach(t => RV.picked.add(t.name));
    RV.character.forEach(t => RV.picked.add(t.name));
    document.querySelectorAll("#revModal .rev-tag").forEach(b => {
      b.classList.toggle("on", RV.picked.has(b.dataset.name));
    });
    const t = RV.timing || {};
    const bits = [];
    if (t.inference_seconds) bits.push("推論 " + t.inference_seconds + "s");
    if (t.total_seconds) bits.push("合計 " + t.total_seconds + "s");
    $("revFootMeta").textContent = bits.join(" · ");
    rvUpdateApply();
  }

  function rvToggleTag(e) {
    const b = e.target.closest(".rev-tag");
    if (!b) return;
    const name = b.dataset.name;
    if (RV.picked.has(name)) RV.picked.delete(name);
    else RV.picked.add(name);
    b.classList.toggle("on", RV.picked.has(name));
    rvUpdateApply();
  }

  function rvSetAll(kind, on) {
    const list = kind === "character" ? RV.character : RV.general;
    const el = kind === "character" ? $("revCharacter") : $("revGeneral");
    list.forEach(t => { if (on) RV.picked.add(t.name); else RV.picked.delete(t.name); });
    el.querySelectorAll(".rev-tag").forEach(b => {
      b.classList.toggle("on", RV.picked.has(b.dataset.name));
    });
    rvUpdateApply();
  }

  function rvApply() {
    if (!RV.picked.size) { toast("先勾選想加的標籤", "warn"); return; }
    const have = new Set(window.Tags.selected().map(s => normKey(s.t)));
    const posRaw = ($("pos").value || "");
    const inPos = new Set(posRaw.split(",").map(s => normKey(s)).filter(Boolean));
    const libTags = [];
    const extraTags = [];
    RV.picked.forEach(name => {
      const lib = window.Tags.matchTag(name);
      if (lib) {
        // 標籤庫有的 → 進已選標籤（不覆蓋既有選取）
        if (!have.has(normKey(lib)) && !inPos.has(normKey(lib))) libTags.push(lib);
      } else {
        // 標籤庫沒有的 → 進補充描述
        const label = String(name).replace(/_/g, " ");
        if (!inPos.has(normKey(label)) && !have.has(normKey(label))) extraTags.push(label);
      }
    });
    const addedSel = window.Tags.addTags(libTags);
    let addedExtra = 0;
    if (extraTags.length) {
      const base = posRaw.trim();
      const merged = (base ? base + ", " : "") + extraTags.join(", ");
      $("pos").value = merged;
      try { localStorage.setItem("ui.extra", merged); } catch (e) { /* 無痕模式 */ }
      addedExtra = extraTags.length;
      updateWarn();
    }
    syncGo();
    closeReverse();
    const total = addedSel + addedExtra;
    if (total) toast("已加入 " + total + " 個標籤", "ok");
    else toast("這些標籤都已經有了，沒有重複加入", "warn");
  }

  function openReverse() {
    $("revModal").hidden = false;
    $("revRun").disabled = !RV.dataUrl;
  }

  function closeReverse() { $("revModal").hidden = true; }
  /* ── 初始化 ────────────────────────────────────────────── */
  function init() {
    window.Tags.init();

    // 設定
    applySettings();
    $("sizes").onclick = e => {
      const b = e.target.closest("button");
      if (!b) return;
      S.settings.size = b.dataset.size;
      applySettings(); persistSettings();
    };
    $("counts").onclick = e => {
      const b = e.target.closest("button");
      if (!b) return;
      S.settings.n = +b.dataset.n;
      applySettings(); persistSettings();
    };
    $("q").onchange = () => {
      S.settings.quality = $("q").checked;
      persistSettings();
      syncGo();
    };
    ["neg", "steps", "cfg", "seed"].forEach(id => {
      $(id).addEventListener("change", persistSettings);
    });
    const btnNegClear = $("btnNegClear");
    if (btnNegClear) btnNegClear.onclick = () => { $("neg").value = ""; persistSettings(); toast("已清除負面提示詞", "ok"); };
    const btnNegDefault = $("btnNegDefault");
    if (btnNegDefault) btnNegDefault.onclick = () => { $("neg").value = DEFAULT_NEG; persistSettings(); toast("已套用預設負面", "ok"); };
    const btnNegCopy = $("btnNegCopy");
    if (btnNegCopy) btnNegCopy.onclick = async () => {
      try { await navigator.clipboard.writeText($("neg").value); toast("已複製負面", "ok"); }
      catch (e) { toast("複製失敗", "warn"); }
    };
    $("ckpt").onchange = persistSettings;
    $("btnDice").onclick = () => {
      $("seed").value = String(Math.floor(Math.random() * 4294967295));
      persistSettings();
    };

    // 補充描述：只還原「新版」欄位，舊版 UI 留下的整段英文提示詞不再帶入（避免偷偷塞 89 個標籤）
    try {
      const v = localStorage.getItem("ui.extra");
      if (v) { $("pos").value = v; }
    } catch (e) { /* ignore */ }
    $("pos").addEventListener("input", () => {
      try { localStorage.setItem("ui.extra", $("pos").value); } catch (e) { /* ignore */ }
      updateWarn();
      syncGo();
    });
    $("neg").addEventListener("input", () => {
      persistSettings();
      updateNegWarn();
    });
    updateNegWarn();
    $("warn").onclick = e => {
      const b = e.target.closest(".wchip");
      if (!b) return;
      const w = b.dataset.w;
      $("search").value = w;
      $("search").dispatchEvent(new Event("input"));
      toast(`已搜尋「${w}」，點標籤取代它`, "ok");
    };

    // 底列
    $("go").onclick = () => generate();
    $("btnCancel").onclick = () => cancel();
    $("btnClear").onclick = () => { window.Tags.clear(); updateWarn(); syncGo(); };
    $("btnPreview").onclick = showPromptModal;
    $("btnHelp").onclick = showHelp;
    // 圖片反推（WD14）
    $("btnReverse").onclick = openReverse;
    $("revClose").onclick = closeReverse;
    $("revClose2").onclick = closeReverse;
    $("revRun").onclick = rvRun;
    $("revApply").onclick = rvApply;
    $("revModal").onclick = e => { if (e.target.id === "revModal") closeReverse(); };
    $("revGeneral").onclick = rvToggleTag;
    $("revCharacter").onclick = rvToggleTag;
    $("revDrop").onclick = () => $("revFile").click();
    $("revDrop").onkeydown = e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("revFile").click(); }
    };
    $("revDrop").ondragover = e => { e.preventDefault(); $("revDrop").classList.add("over"); };
    $("revDrop").ondragleave = () => $("revDrop").classList.remove("over");
    $("revDrop").ondrop = e => {
      e.preventDefault();
      $("revDrop").classList.remove("over");
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      rvPick(f);
    };
    $("revFile").onchange = e => {
      const f = e.target.files && e.target.files[0];
      rvPick(f);
      e.target.value = "";
    };
    $("revModal").querySelectorAll("[data-all]").forEach(b => {
      b.onclick = () => rvSetAll(b.dataset.all, true);
    });
    $("revModal").querySelectorAll("[data-none]").forEach(b => {
      b.onclick = () => rvSetAll(b.dataset.none, false);
    });
    // 圖片拖到視窗空白處時，不要讓瀏覽器直接開圖
    window.addEventListener("dragover", e => e.preventDefault());
    window.addEventListener("drop", e => e.preventDefault());

    $("btnRandom").onclick = () => {
      const n = surpriseCombo();
      toast(`套用「${n}」`, "ok");
    };
    $("btnEmptyRandom").onclick = () => { $("btnRandom").click(); };
    const openFolder = () => fetch("/open-output").catch(() => {});
    $("btnOpenFolder").onclick = openFolder;
    $("btnOpenFolder2").onclick = openFolder;

    // 狀態列：點一下 = 檢查 / 啟動
    $("statusPill").onclick = async () => {
      const ok = await checkComfy(true);
      if (!ok) startComfy();
    };

    // 舞台事件
    $("stageResults").onclick = e => {
      const act = e.target.closest("[data-act]");
      const card = e.target.closest(".shot");
      if (!card) return;
      const it = S.results[+card.dataset.i];
      if (!it) return;
      const gIdx = S.gallery.findIndex(x => x.url === it.url);
      if (act) {
        const a = act.dataset.act;
        if (a === "zoom") openLightbox(S.gallery, gIdx < 0 ? 0 : gIdx);
        if (a === "dl") download(it);
        if (a === "seed") reuseSeed(it);
        if (a === "prompt") reusePrompt(it);
        if (a === "del") confirmDelete(it);
      } else {
        openLightbox(S.gallery, gIdx < 0 ? 0 : gIdx);
      }
    };
    $("histBar").onclick = e => {
      const del = e.target.closest(".thumb-del");
      if (del) {
        const it = S.gallery[+del.dataset.del];
        if (it) confirmDelete(it);
        return;
      }
      const t = e.target.closest(".thumb");
      if (!t) return;
      openLightbox(S.gallery, +t.dataset.i);
    };
    // 橫向捲動：把垂直滾輪轉成水平捲動（滑鼠指向時才能用滾輪）
    function enableWheelScroll(el) {
      if (!el) return;
      el.addEventListener("wheel", e => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        if (el.scrollWidth <= el.clientWidth) return;
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }, { passive: false });
    }
    enableWheelScroll($("selBar"));
    enableWheelScroll($("histBar"));

    // 大圖
    $("lbClose").onclick = closeLightbox;
    $("lbPrev").onclick = () => lbStep(-1);
    $("lbNext").onclick = () => lbStep(1);
    $("lightbox").onclick = e => { if (e.target.id === "lightbox") closeLightbox(); };
    $("lbDownload").onclick = () => download(S.lbList[S.lbIndex]);
    $("lbDel").onclick = () => confirmDelete(S.lbList[S.lbIndex]);
    $("lbSeed").onclick = () => { reuseSeed(S.lbList[S.lbIndex]); closeLightbox(); };
    $("lbPrompt").onclick = () => { reusePrompt(S.lbList[S.lbIndex]); closeLightbox(); };

    // 視窗
    $("modalClose").onclick = closeModal;
    $("modal").onclick = e => {
      if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal();
    };

    // 進階設定（彈出視窗）
    const openAdv = () => {
      $("advModal").hidden = false;
      updateAdvSummary();
    };
    const closeAdv = () => { $("advModal").hidden = true; };
    $("btnAdv").onclick = openAdv;
    $("advClose").onclick = closeAdv;
    $("advDone").onclick = closeAdv;
    $("advModal").onclick = e => { if (e.target.id === "advModal") closeAdv(); };
    ["neg", "steps", "cfg", "seed"].forEach(id => {
      $(id).addEventListener("input", persistSettings);
    });

    // 快捷鍵
    document.addEventListener("keydown", e => {
      const tag = (e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); generate(); return; }
      if (e.key === "Escape") {
        if (!$("lightbox").hidden) return closeLightbox();
        if (!$("revModal").hidden) return closeReverse();
        if (!$("advModal").hidden) return $("advClose").click();
        if (!$("modal").hidden) return closeModal();
        if (S.running) cancel();
        return;
      }
      if (!$("lightbox").hidden) {
        if (e.key === "ArrowLeft") lbStep(-1);
        if (e.key === "ArrowRight") lbStep(1);
        return;
      }
      if (typing) return;
      if (e.key === "/") { e.preventDefault(); $("search").focus(); }
      if (e.key === "?") showHelp();
    });

    // 舞台初始狀態：有上次的圖就直接顯示，不要讓人以為圖不見了
    renderHistory();
    const lastAt = S.gallery.length ? S.gallery[0].at : 0;
    const lastBatch = lastAt ? S.gallery.filter(g => g.at === lastAt) : [];
    if (lastBatch.length) {
      S.results = lastBatch;
      renderResults(lastBatch);
      showStage("results");
    } else {
      showStage("empty");
    }

    window.addEventListener("tags:change", () => { syncGo(); });
    updateWarn();
    syncGo();

    // ComfyUI 狀態：開場檢查 + 每 20 秒輕量更新
    checkComfy();
    setInterval(() => { if (!S.running) checkComfy(true); }, 20000);

    // 圖片被刪的同步：開頁一次，之後回到視窗 / 每 45 秒各一次
    $("lbImg").addEventListener("error", () => { if (!$("lightbox").hidden) syncGallery(); });
    syncGallery();
    window.addEventListener("focus", () => { if (!S.running) syncGallery(); });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !S.running) syncGallery();
    });
    setInterval(() => { if (!S.running) syncGallery(); }, 45000);
    setInterval(() => {
      if (!S.running) return;
      const secs = Math.round((Date.now() - S.t0) / 1000);
      const ahead = Math.max(0, S.queue - 1);
      $("progSub").textContent = `已用 ${secs} 秒` +
        (ahead > 0 ? ` · 還有 ${ahead} 個排隊` : "");
    }, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
