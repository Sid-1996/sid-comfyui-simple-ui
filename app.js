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
  const DEFAULT_NEG = "worst quality, low quality, bad anatomy, bad hands, extra fingers, missing fingers, deformed hands, mutated hands, fused fingers, watermark, text, signature, blurry, child, loli, shota";

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
    running: false, starting: false, cancelled: false, promptId: null, comfyUp: false, external: false,
    outDir: "", outOk: false, outError: "",
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

  // 圖片 complete key：filename + subfolder + type，相容舊版只存 url/filename 的紀錄
  function itemQuery(it) {
    return new URLSearchParams(((it && it.url) || "").split("?")[1] || "");
  }
  function fileKey(it) {
    const q = itemQuery(it);
    const name = String(it && it.filename != null ? it.filename : (q.get("filename") || ""));
    const sub = String(it && it.subfolder != null ? it.subfolder : (q.get("subfolder") || "")) || "";
    const typ = String(it && it.type != null ? it.type : (q.get("type") || "output")) || "output";
    return name + "\u0000" + sub + "\u0000" + typ;
  }

  function applyOutputStatus(j) {
    if (!j) return;
    S.outOk = typeof j.output_ok === "boolean" ? j.output_ok : !!j.output;
    S.outError = j.output_error || "";
    S.outDir = j.output || "";
    const label = $("outPath");
    if (label) {
      label.textContent = S.outOk ? "圖片存到 " + S.outDir
        : (S.outError || "輸出目錄未設定 · 刪圖已停用");
      label.title = S.outOk ? S.outDir
        : "請在啟動 server.py 前設定 COMFY_OUTPUT_DIR 為你的 ComfyUI 輸出資料夾";
    }
    syncDeleteButtons();
  }

  function syncDeleteButtons() {
    document.querySelectorAll('#stageResults [data-act="del"], #histBar .thumb-del').forEach(b => {
      b.disabled = !S.outOk;
      b.title = S.outOk ? "刪除這張" : "尚未設定有效的 COMFY_OUTPUT_DIR，無法刪除圖片";
    });
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

  /* ── 對話框管理：焦點、背景 inert、Esc 疊層 ─────────────── */
  const dialogStack = [];   // { el, close, opener }，最後一個是最上層
  let lastEscAt = 0;
  function topDialog() { return dialogStack.length ? dialogStack[dialogStack.length - 1] : null; }
  function refreshInert() {
    dialogStack.forEach((d, i) => { d.el.inert = i !== dialogStack.length - 1; });
    const app = document.querySelector(".app");
    if (app) app.inert = dialogStack.length > 0;
  }
  function openDialog(el, close, focusEl) {
    if (!el || dialogStack.some(d => d.el === el)) return;
    dialogStack.push({ el, close, opener: document.activeElement });
    el.hidden = false;
    refreshInert();
    const target = focusEl ||
      el.querySelector("button:not([hidden]):not([disabled]), input:not([disabled]), select, textarea");
    if (target) { try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  function closeDialog(el) {
    if (!el) return;
    el.hidden = true;
    const i = dialogStack.findIndex(d => d.el === el);
    if (i < 0) return;
    const d = dialogStack.splice(i, 1)[0];
    el.inert = false;
    refreshInert();
    const op = d.opener;
    if (op && op !== document.body && document.contains(op) && !op.closest("[hidden]") && !op.closest("[inert]")) {
      try { op.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }

  /* ── ComfyUI 狀態 ──────────────────────────────────────── */
  async function checkComfy(silent) {
    if (!silent) setStatus("checking", "檢查 ComfyUI…");
    // 外部模式由後端 /api/status 提供；即使 ComfyUI 檢查失敗也要先知道，避免顯示錯誤的「點我開啟」
    try {
      const st = await fetch("/api/status", { cache: "no-store" }).then(r => r.json());
      if (st && typeof st.external === "boolean") S.external = st.external;
      applyOutputStatus(st);
    } catch (e) { /* 保持前一次已知狀態 */ }
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
      setStatus("down", S.external ? "ComfyUI 未連線 · 外部模式" : "ComfyUI 沒開 · 點我開啟");
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
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        S.comfyUp = true;
        setStatus("up", "ComfyUI 已連線");
        toast("ComfyUI 啟動完成，可以開始了", "ok");
        connectWS();
        await loadCkpts();
        return true;
      }
      // 外部連線模式：後端拒絕代啟動，直接顯示原因，不重試、不誤導去看 logs
      if (j.code === "EXTERNAL_COMFY") {
        S.comfyUp = false;
        setStatus("down", "ComfyUI 未連線 · 外部模式");
        toast(j.error || "目前是外部連線模式，請自行啟動 ComfyUI", "warn", 6000);
        return false;
      }
      // 沒有明確啟動設定時，後端不會猜開發者路徑；直接把白話原因顯示給使用者
      if (j.code && j.error) {
        S.comfyUp = false;
        setStatus("down", "ComfyUI 未連線 · 請自行啟動");
        toast(j.error, "warn", 6000);
        return false;
      }
    } catch (e) { /* 下面統一處理 */ }
    setStatus("down", "ComfyUI 開不起來 · 點我重試");
    toast("ComfyUI 啟動失敗，請看 logs/comfyui.err.log", "err", 6000);
    return false;
  }

  async function ensureComfy() {
    if (S.comfyUp) return true;
    if (await checkComfy(true)) return true;
    if (S.external) return false;   // 外部模式不代啟動，交給使用者
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

  /* ── 隨機配一組：標籤 + 補充描述一起換（不動種子，避免偷偷鎖死）── */
  function surpriseCombo() {
    const name = window.Tags.applyRandomCombo();
    const pos = $("pos");
    if (pos) {
      pos.value = "";
      try { localStorage.removeItem("ui.extra"); } catch (e) { /* 無痕模式 */ }
    }
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

  // 生成前取「完整且一致」的快照：標籤狀態（深拷貝）+ 組裝好的提示詞 + 負面 + 設定
  // payload 與 history 記錄都從這一份出來，不在流程中混用不同時間點的狀態
  function snapshotNow() {
    const sel = window.Tags.snapshot();
    const posEl = $("pos") || {};
    const negEl = $("neg") || {};
    const extra = window.Dict.tr(posEl.value || "").trim();
    const pos = ((S.settings.quality ? QUALITY : "") +
      sel.map(s => s.w === 1 ? s.t : `(${s.t}:${s.w.toFixed(1)})`).concat(extra ? [extra] : []).join(", "))
      .replace(/^[,\s]+|[,\s]+$/g, "");
    return {
      sel,
      pos,
      neg: negEl.value || "",
      extraRaw: (posEl.value || "").trim(),
      ckpt: $("ckpt") ? $("ckpt").value : "",
      w: S.settings.size.split("x").map(Number)[0],
      h: S.settings.size.split("x").map(Number)[1],
      n: S.settings.n,
      steps: Number($("steps").value) || 25,
      cfg: Number($("cfg").value) || 6,
      seed: readSeed()
    };
  }

  // ── 生成診斷紀錄（request_id 對應前後端紀錄）────────────
  let genSeq = 0;
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h.toString(36); }
  function logGen(event, obj) {
    const rec = Object.assign({ t: Date.now(), event }, obj || {});
    const arr = loadJSON("ui.genLog", []);
    arr.push(rec);
    if (arr.length > 50) arr.splice(0, arr.length - 50);
    saveJSON("ui.genLog", arr);
    console.log("[gen]", JSON.stringify(rec));
  }

  // ── 跨分頁狀態同步 ─────────────────────────────────────
  // storage event 只通知「其他」分頁；本分頁的按鈕/輸入仍即時更新 state。
  // 下列函式只讀取 localStorage → 更新記憶體/UI，不寫回，避免寫入迴圈與覆蓋他人選擇。
  const SHARED_KEYS = new Set(["sel", "adult", "showEn", "ui.learnedTags", "ui.extra", "ui.selSortMode"]);

  function syncExtraFromStorage() {
    const el = $("pos");
    if (!el) return;
    // 編輯中保護：#pos 正在被使用者輸入時，不可被其他分頁的 ui.extra 靜默覆蓋，
    // 否則會丟失尚未完成的輸入。失焦後的下一次同步（focus/手動）會再對齊。
    if (document.activeElement === el) return;
    let v = null;
    try { v = localStorage.getItem("ui.extra"); } catch (e) { return; }
    const next = v || "";   // key 被刪除時，與初始化規則一致：補充描述為空
    if (el.value === next) return;
    el.value = next;        // 程式化設定不觸發 input/change，因此不會寫回
    updateWarn();
    syncGo();
  }

  // storage event、window.focus、generate 前共用同一套同步邏輯
  function syncSharedState() {
    if (window.Tags && typeof window.Tags.syncFromStorage === "function") window.Tags.syncFromStorage();
    syncExtraFromStorage();
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
      "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "ui_" + o.fileTag } }
    };
  }

  async function generate() {
    if (S.running || S.starting) return;

    // 先同步最新持久化狀態（標籤）：若本分頁記憶體是過期的空值，下面會誤觸發「幫我配一組」並覆蓋其他分頁的選擇
    // #pos 不在此同步：snapshotNow() 直接讀 DOM，避免生成前被其他分頁的 ui.extra 覆蓋正在編輯的內容
    if (window.Tags && typeof window.Tags.syncFromStorage === "function") window.Tags.syncFromStorage();

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

    // ① 生成前同步標籤狀態（#pos 由 snapshotNow 直接讀 DOM，不從 storage 覆蓋）
    if (window.Tags && typeof window.Tags.syncFromStorage === "function") window.Tags.syncFromStorage();

    // ② 取快照（標籤狀態、提示詞、負面、設定一次進）——之後請求與紀錄同源
    const snap = snapshotNow();
    const genId = "G" + (++genSeq) + "-" + Date.now().toString(36);
    // 檔名專用 tag：ComfyUI 用「目前目錄最大編號 + 1」產生檔名，刪除最新版後
    // 下一次生成會重用同名檔。每次生成給一個 UUID（只有 hex 與 -，Windows/ComfyUI 都安全），
    // 讓舊圖即使被刪也不會與新圖身份碰撞；與 genId 分開，後者仍供診斷追蹤用。
    let fileTag;
    try { fileTag = crypto.randomUUID(); }
    catch (e) { fileTag = Date.now().toString(36) + "-" + Math.floor(Math.random() * 4294967295).toString(36); }
    logGen("trigger", { genId, fileTag, sel: snap.sel.map(s => s.t) });

    const ckpt = snap.ckpt;
    if (!ckpt) {
      toast("模型還沒載入好，稍等幾秒再按一次", "warn");
      loadCkpts();
      syncGo();
      return;
    }

    const w = snap.w, h = snap.h;
    let seed = snap.seed;
    if (!Number.isFinite(seed) || seed < 0) seed = Math.floor(Math.random() * 4294967295);
    S.seedUsed = seed;

    const o = {
      ckpt, pos: snap.pos, neg: snap.neg,
      w, h, n: snap.n, seed,
      steps: snap.steps, cfg: snap.cfg,
      fileTag
    };
    const selSnap = snap.sel;
    const extraSnap = snap.extraRaw;
    const negSnap = snap.neg.trim();

    logGen("snapshot", { genId, posLen: snap.pos.length, negLen: snap.neg.length, posHash: hashStr(snap.pos), seed, steps: snap.steps, cfg: snap.cfg, tags: snap.sel.map(s => s.t) });

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
        headers: { "Content-Type": "application/json", "X-Request-Id": genId },
        body: JSON.stringify({ prompt: wf(o) })
      })).json();

      const pid = res.prompt_id;
      S.promptId = pid;
      logGen("submit", { genId, promptId: pid || "", posHash: hashStr(o.pos) });

      // 取消發生在「已送出、尚未登記 prompt_id」之間：把剛送出的 job 刪掉，不要讓它自己跑
      if (S.cancelled) {
        try {
          await api("/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [pid] }) });
        } catch (e) { /* 可能已經開始執行 */ }
        try { await api("/interrupt", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch (e) { /* ignore */ }
        return;
      }

      const hist = await waitFor(pid);
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
      logGen("result", { genId, promptId: pid || "", outs: outs.length, posHash: hashStr(o.pos) });

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
      // 標籤學習與統計：只在拿到 validate 過的輸出後執行（失敗／取消／讀歷史都不會到這裡）
      const splitTok = (raw) => String(raw || "").split(",").map(t => t.trim())
        .map(t => t.replace(/^\((.*)\)$/, "$1").split(":")[0].trim())
        .filter(Boolean);
      try {
        if (window.Tags && typeof window.Tags.learn === "function") {
          window.Tags.learn(splitTok(extraSnap), "general");
          window.Tags.learn((selSnap || []).map(x => x.t), "positive");
          window.Tags.learn(splitTok(negSnap), "negative");
        }
      } catch (e) { /* 學習失敗不影響生成結果 */ }
      // 統計：一次任務一筆（fileTag 是 UUID），多張圖片不重複計；寫入失敗也不影響生圖
      try {
        if (window.Tags && typeof window.Tags.recordGeneration === "function") {
          window.Tags.recordGeneration({
            jobId: fileTag, at: Date.now(),
            pos: splitTok(o.pos), neg: splitTok(o.neg)
          });
        }
      } catch (e) { /* 統計失敗不影響生成結果 */ }

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
    syncDeleteButtons();
  }

  function renderHistory() {
    const has = S.gallery.length > 0;
    $("history").hidden = !has;
    $("histBar").innerHTML = has
      ? S.gallery.map((it, i) =>
        `<div class="thumb-wrap">
          <button type="button" class="thumb" data-i="${i}" title="${esc(it.filename)}" aria-label="檢視第 ${i + 1} 張">
            <img src="${esc(it.url)}" alt="" loading="lazy">
          </button>
          <button type="button" class="thumb-del" data-del="${i}" title="刪除這張" aria-label="刪除第 ${i + 1} 張">×</button>
        </div>`).join("")
      : "";
    syncDeleteButtons();
    if (!has) return;
    $("histBar").querySelectorAll("img").forEach(img => {
      img.addEventListener("error", () => {
        const t = img.closest(".thumb-wrap");
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
        const q = itemQuery(it);
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
      const gone = new Set((j.missing || []).map(fileKey));
      if (!gone.size) return;

      const keep = S.gallery.filter(it => !gone.has(fileKey(it)));
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
    openDialog($("lightbox"), closeLightbox, $("lightbox"));
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
    closeDialog($("lightbox"));
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
    if (!S.outOk) {
      openModal("無法刪除圖片", `
        <p>還沒有設定有效的 COMFY_OUTPUT_DIR，所以不能刪圖（避免刪到其他資料夾）。</p>
        <p>請在啟動 server.py 前設定為你的 ComfyUI 輸出資料夾，再重新開啟介面。</p>
        <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>知道了</button></div>`);
      return;
    }
    openModal("刪除這張圖？", `
      <div class="del-preview"><img src="${esc(it.url)}" alt=""></div>
      <p class="del-name">${esc(it.filename)}</p>
      <p>圖片會移到 Windows 資源回收筒（之後還能還原），歷史紀錄也會一起移除。若回收筒失敗，圖片與紀錄都會保留。</p>
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
    const q = itemQuery(it);
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
      if (!r.ok || j.ok !== true) throw new Error(j.error || ("HTTP " + r.status));
      if (j.status !== "deleted" && j.status !== "already_gone")
        throw new Error(j.error || "後端沒有明確回報刪除結果");
      dropImages([it.url]);
      toast(j.status === "already_gone" ? "圖片已不存在，已從紀錄移除"
        : (j.recycled ? "已刪除，檔案在資源回收筒" : "已刪除"), "ok");
    } catch (e) {
      toast("刪不掉：" + (e.message || e) + "。圖片與紀錄都保留。", "err", 5000);
    }
  }


  function openModal(title, html) {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = html;
    openDialog($("modal"), closeModal, $("modalBody").querySelector("button"));
  }

  function closeModal() { closeDialog($("modal")); }

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
      <p><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 生成　<kbd>Esc</kbd> 關閉視窗（生成中連按兩次＝取消）　<kbd>/</kbd> 搜尋標籤　<kbd>←</kbd><kbd>→</kbd> 換圖　<kbd>?</kbd> 這份說明</p>
      <h3>常見問題</h3>
      <p><b>按生成沒反應？</b>看右上角狀態列：黃燈就是 ComfyUI 沒開，點一下會自動幫你啟動。</p>
      <p><b>顯卡記憶體不夠？</b>把尺寸改小、張數改 1，或把步數降到 20。</p>
      <p><b>圖存到哪？</b>${esc(S.outDir || "輸出資料夾")}，右上「圖片資料夾」可以直接打開。</p>
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
    updateNegSummary();
  }

  function persistSettings() {
    S.settings.neg = $("neg").value;
    S.settings.steps = Number($("steps").value) || 25;
    S.settings.cfg = Number($("cfg").value) || 6;
    S.settings.seed = readSeed();
    S.settings.ckpt = $("ckpt").value || S.settings.ckpt;
    saveJSON("ui.settings", S.settings);
    updateAdvSummary();
    updateNegSummary();
  }

  // 種子：空白或非數字一律視為 -1（每次隨機），避免 Number("") 變成 0 而悄悄鎖死
  function readSeed() {
    const v = String($("seed").value == null ? "" : $("seed").value).trim();
    if (v === "") return -1;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : -1;
  }

  function updateAdvSummary() {
    const sd = readSeed();
    $("advSummary").textContent =
      `步數 ${$("steps").value || 25} · CFG ${$("cfg").value || 6} · 種子 ${sd < 0 ? "隨機" : sd}`;
    updateSeedLock();
  }

  // 種子固定時，在底列顯示提醒與一鍵解除
  function updateSeedLock() {
    const b = $("seedLock");
    if (!b) return;
    const sd = readSeed();
    b.hidden = sd < 0;
    if (sd >= 0) $("seedLockText").textContent = "種子固定 " + sd;
  }

  function updateNegSummary() {
    const el = $("negSummary");
    if (!el) return;
    const v = ($("neg").value || "").trim();
    el.textContent = !v ? "未設定" : (v === DEFAULT_NEG ? "預設" : "已自訂");
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
    model: "eva02",   // "eva02"（預設，高品質）或 "vit"（快速）
    rating: null, general: [], character: [], timing: null,
    picked: new Set(),
    // 分類瀏覽：cat="*" 表示目前模式下的全部；mode="all" 表示不過濾
    cat: "*", mode: "all", catsReady: !!(window.TagCategories && window.TagCategories.of)
  };
  // 與後端 sniff_image() 一致：只收這四種，其餘 mime 不當成成功載入
  const RV_MIME = /^image\/(png|jpe?g|webp|gif)$/i;
  let rvLoadSeq = 0;

  // 提示詞去重用的正規化：底線與空格視為同一個標籤
  function normKey(s) {
    return String(s || "").toLowerCase().trim().replace(/[_\s]+/g, " ");
  }

  // 從 prompt 取出「完整標籤」：逗號／換行分隔，並拆解 (tag:1.2) 權重外框。
  // 只用於比對，不重寫原始文字。
  function rvPromptTokens(text) {
    const out = new Set();
    String(text == null ? "" : text).split(/[,\r\n]+/).forEach(seg => {
      let t = String(seg).trim();
      if (!t) return;
      const m = t.match(/^\(\s*([^()]*?)\s*\)$/);
      if (m) t = String(m[1]).split(":")[0].trim();
      const k = normKey(t);
      if (k) out.add(k);
    });
    return out;
  }

  /**
   * 增量合併正向提示詞：只回傳新文字與統計，不碰 negative、不重寫原有內容。
   * picked 內是 WD14 英文 tag（可能含底線）；寫入時轉成專案慣用的空格英文名稱。
   * existing 是已在底部列的標籤，視為「已存在」以免重複。
   */
  function rvMergePrompt(promptText, picked, existing) {
    const have = new Set((existing || []).map(x => normKey(x)));
    rvPromptTokens(promptText).forEach(k => have.add(k));
    const add = [];
    let skipped = 0;
    (picked || []).forEach(raw => {
      if (typeof raw !== "string" && typeof raw !== "number") return;
      const name = String(raw).replace(/_/g, " ").trim();
      if (!name) return;
      const k = normKey(name);
      if (!k) return;
      if (have.has(k)) { skipped++; return; }
      have.add(k);
      add.push(name);
    });
    const base = String(promptText == null ? "" : promptText);
    const text = add.length
      ? (base.trim() ? base + ", " + add.join(", ") : add.join(", "))
      : base;
    return { text: text, added: add.length, skipped: skipped };
  }

  /**
   * 雙路徑分流：只處理明確選取的標籤，並跨「底部標籤列」與「#pos」整體去重。
   * resolve(tag) 由 Tags.matchTag 提供：回傳 CATS 正名代表已知，回傳 null 代表未知。
   * 注意：CATS 分類為 other 的標籤仍可能被 matchTag 找到，仍屬已知，走底部列。
   */
  function rvSplitPicked(picked, selected, posText, resolve) {
    const have = new Set((selected || []).map(s =>
      normKey(typeof s === "string" ? s : (s && s.t))));
    rvPromptTokens(posText).forEach(k => have.add(k));
    const toBottom = [], toExtra = [];
    let skipped = 0;
    (picked || []).forEach(raw => {
      if (typeof raw !== "string" && typeof raw !== "number") return;
      const name = String(raw).replace(/_/g, " ").trim();
      if (!name) return;
      const k = normKey(name);
      if (!k) return;
      if (have.has(k)) { skipped++; return; }
      have.add(k);   // 同一批 picked 中重複的正規化標籤只處理一次
      const lib = resolve ? resolve(name) : null;
      if (lib) toBottom.push(lib);
      else toExtra.push(name);
    });
    return { toBottom: toBottom, toExtra: toExtra, skipped: skipped };
  }

  function rvResetResult() {
    RV.rating = null; RV.general = []; RV.character = []; RV.timing = null;
    RV.picked = new Set();
    RV.cat = "*"; RV.mode = "all";
    $("revRating").hidden = true;
    $("revTags").innerHTML = "";
    $("revSelList").innerHTML = "";
    $("revTagCount").textContent = "";
    $("revSelCount").textContent = "已選 0 個";
    rvRenderPicked();
    $("revFootMeta").textContent = "";
    rvUpdateApply();
  }

  function rvUpdateApply() {
    const n = RV.picked.size;
    // 尚未選取時停用加入按鈕，避免空操作；選取後才允許送入提示詞。
    $("revApply").disabled = n === 0;
    $("revApply").classList.toggle("dim", n === 0);
    $("revApply").title = n === 0 ? "請先點選想加入的標籤" : "";
    $("revApply").textContent = "加入提示詞（" + n + "）";
    $("revSelCount").textContent = "已選 " + n + " 個";
    $("revClear").disabled = n === 0;
    rvUpdateSelectionActions();
  }

  /* ── 分類瀏覽（分類依 TagCategories，成人標記依 Tags.isAdult）── */
  const RV_MODE_CATS = {
    all: null,
    character: new Set(["character", "expression"]),
    clothing: new Set(["clothing"]),
    body: new Set(["body"]),
    pose: new Set(["pose"]),
    composition: new Set(["composition"])
  };
  const RV_CAT_ORDER = ["character", "clothing", "body", "pose", "expression",
    "composition", "background", "style", "adult", "other"];

  function rvCatOf(name) {
    // 分類資料缺失時安全退回 other，不影響原有反推與加入提示詞流程
    if (!RV.catsReady) return "other";
    try { return window.TagCategories.of(name) || "other"; }
    catch (e) { return "other"; }
  }
  function rvCatName(id) {
    const c = RV.catsReady && window.TagCategories.categories;
    return (c && c[id]) || id;
  }
  function rvItems() {
    const out = [], seen = new Set();
    (RV.general || []).concat(RV.character || []).forEach(t => {
      const name = String((t && t.name) || "");
      if (!name || seen.has(name)) return;
      seen.add(name);
      const lib = window.Tags.matchTag(name);
      out.push({
        name: name,
        label: name.replace(/_/g, " "),
        zh: lib ? window.Tags.tagZh(lib) : "",
        score: (t && t.score) || 0,
        cat: rvCatOf(name),
        adult: window.Tags.isAdult(name)
      });
    });
    return out;
  }
  function rvAllowed() { return RV_MODE_CATS[RV.mode] || null; }
  function rvVisible() {
    const allow = rvAllowed();
    return rvItems().filter(it =>
      (!allow || allow.has(it.cat)) && (RV.cat === "*" || it.cat === RV.cat));
  }
  function rvRenderCats() {
    const allow = rvAllowed();
    const all = rvItems();
    const counts = {};
    RV_CAT_ORDER.forEach(c => { counts[c] = all.filter(it => it.cat === c &&
      (!allow || allow.has(c))).length; });
    $("revCats").innerHTML = RV_CAT_ORDER.map(c => {
      const on = RV.cat === c;
      const dim = allow && !allow.has(c) ? " dim" : "";
      return '<button type="button" class="rev-cat' + (on ? " on" : "") + dim +
        '" data-cat="' + esc(c) + '" role="tab" aria-selected="' + on + '">' +
        esc(rvCatName(c)) + '<b>' + counts[c] + '</b></button>';
    }).join("");
    $("revCatWarn").hidden = RV.catsReady;
  }
  function rvRenderModes() {
    document.querySelectorAll("#revModes .rev-mode-btn").forEach(b => {
      b.classList.toggle("on", b.dataset.mode === RV.mode);
    });
  }
  function rvRenderPicked() {
    const names = Array.from(RV.picked);
    $("revSelCount").textContent = "已選 " + names.length + " 個";
    if (!names.length) {
      $("revSelList").innerHTML = '<span class="rev-empty">尚未選取，點選上方標籤即可加入暫存</span>';
      return;
    }
    const byName = {};
    rvItems().forEach(it => { byName[it.name] = it; });
    $("revSelList").innerHTML = names.map(n => {
      const it = byName[n] || { label: String(n).replace(/_/g, " ") };
      const text = it.zh ? (it.zh + " · " + it.label) : it.label;
      return '<button type="button" class="rev-chip" data-drop="' + esc(n) +
        '" title="點一下取消">' + esc(text) + '<span>✕</span></button>';
    }).join("");
  }

  function rvError(msg) {
    const el = $("revError");
    el.textContent = msg;
    el.hidden = false;
  }

  function rvExplain(e) {
    const m = String((e && e.message) || e);
    const code = (e && e.code) || "";
    const status = e && e.status;
    // 後端 /api/reverse 的 WORKER_ERROR 包含「資源不存在」與「服務暫時失敗」：
    // 先用 code 判斷大類，再從 error 內容區分是否為找不到 Worker（server.py 找不到 WD14 Python/Worker）。
    if (code === "WD14_NOT_CONFIGURED" ||
        (code === "WORKER_ERROR" && /找不到 WD14|未安裝|not found/i.test(m)))
      return "WD14 反推功能尚未安裝或未完成設定，所以這張圖沒有分析了。基本生圖不受影響，可以繼續用；若要啟用反推，請先準備 WD14 的 Worker、模型與 Python 環境。";
    if (code === "WORKER_ERROR")
      return "反推服務暫時沒回應，按一下 F5 重新整理再試；基本生圖不受影響。";
    // 忙碌（429）不是失敗：直接顯示後端的白話訊息，不要冠「反推失敗」
    if (code === "BUSY" || /太多|等一下再試|稍等|忙碌/.test(m)) return m;
    if (code === "TMP_FAIL") return "暫存圖片失敗，請重新選一次圖片再試。";
    if (/逾時/.test(m)) return "分析太久了，這次沒等到結果。按「反推標籤」再試一次，或換張小一點的圖。";
    if (status === 502 || status === 503 || /Failed to fetch|network error/i.test(m))
      return "反推服務沒回應，按一下 F5 重新整理再試。";
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
    if (RV.running) {
      toast("正在分析中，請等分析完成再更換圖片", "warn");
      return;
    }
    $("revError").hidden = true;
    if (!RV_MIME.test(file.type || "")) {
      rvError("這不是圖片，請選 PNG、JPG、WebP 或 GIF。");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      rvError("圖片太大了（上限 20 MB），請換小一點的。");
      return;
    }
    const seq = ++rvLoadSeq;
    const prevFile = RV.file, prevUrl = RV.dataUrl;
    // 失敗（含被更新的貼上取代）時不要動到已經成功的圖片與狀態
    const fail = msg => {
      if (seq !== rvLoadSeq) return;
      RV.file = prevFile;
      RV.dataUrl = prevUrl;
      $("revRun").disabled = !RV.dataUrl;
      rvError(msg);
    };
    RV.file = file;
    RV.dataUrl = "";
    $("revRun").disabled = true;
    const reader = new FileReader();
    reader.onerror = () => fail("圖片讀取失敗，換一張試試。");
    reader.onload = () => {
      if (seq !== rvLoadSeq) return;
      rvDownscale(reader.result).then(url => {
        if (seq !== rvLoadSeq) return;
        rvResetResult();
        RV.dataUrl = url;
        $("revPreview").src = url;
        $("revPreview").hidden = false;
        $("revHint").hidden = true;
        $("revFileMeta").textContent = (file.name || "貼上的圖片") + " · " +
          Math.max(1, Math.round(file.size / 1024)) + " KB";
        $("revRun").disabled = false;
        $("revStatus").textContent = "準備好了，按「反推標籤」開始。";
      }).catch(() => fail("圖片讀取失敗，換一張試試。"));
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
          image: RV.dataUrl, threshold: 0.35, character_threshold: 0.85,
          model: RV.model
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        // 保留後端錯誤碼與 HTTP status，讓 rvExplain 用 code 判斷，而不是只猜訊息文字
        const err = new Error(j.error || ("HTTP " + r.status));
        err.code = j.code || "";
        err.status = r.status;
        throw err;
      }
      RV.rating = j.rating || null;
      RV.general = Array.isArray(j.general) ? j.general : [];
      RV.character = Array.isArray(j.character) ? j.character : [];
      RV.timing = j.timing || {};
      rvRender();
      const n = RV.general.length + RV.character.length;
      $("revStatus").textContent = n
        ? ("找到 " + n + " 個候選標籤，點選想加入的項目；也可批次選取目前顯示的標籤。")
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

  function rvRenderTags() {
    const list = rvVisible();
    const el = $("revTags");
    $("revTagCount").textContent = list.length ? ("（" + list.length + "）") : "";
    if (!list.length) {
      el.innerHTML = '<div class="rev-empty">這個分類沒有標籤，換一個分類或模式看看。</div>';
      rvUpdateSelectionActions();
      return;
    }
    el.innerHTML = list.map(it => {
      const tip = it.zh ? (it.zh + " · " + it.name) : it.name;
      const text = it.zh ? (it.zh + " · " + it.label) : it.label;
      return '<button type="button" class="rev-tag' + (it.adult ? " adult" : "") +
        (RV.picked.has(it.name) ? " on" : "") + '" data-name="' + esc(it.name) +
        '" title="' + esc(tip) + '"><span>' + esc(text) + '</span><i>' +
        Math.round(it.score * 100) + '</i></button>';
    }).join("");
    rvUpdateSelectionActions();
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
    // 反推結果只作候選清單；必須由使用者明確點選，才會進入暫存區。
    RV.picked = new Set();
    rvRenderCats();
    rvRenderModes();
    rvRenderTags();
    rvRenderPicked();
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
    rvRenderPicked();
    rvUpdateApply();
  }

  function rvDropChip(e) {
    const b = e.target.closest(".rev-chip");
    if (!b) return;
    RV.picked.delete(b.dataset.drop);
    rvRenderPicked();
    rvRenderTags();
    rvUpdateApply();
  }

  // 批次操作只作用於目前畫面實際顯示的標籤，跨分類已選項目不受影響。
  function rvSetVisible(on) {
    rvVisible().forEach(it => { if (on) RV.picked.add(it.name); else RV.picked.delete(it.name); });
    rvRenderTags();
    rvRenderPicked();
    rvUpdateApply();
  }

  function rvUpdateSelectionActions() {
    const visible = rvVisible();
    const selected = visible.reduce((n, it) => n + (RV.picked.has(it.name) ? 1 : 0), 0);
    $("revSelAll").disabled = !visible.length || selected === visible.length;
    $("revSelNone").disabled = selected === 0;
  }

  function rvPickCat(cat) {
    const allow = rvAllowed();
    if (allow && !allow.has(cat)) RV.mode = "all";
    RV.cat = (RV.cat === cat) ? "*" : cat;
    rvRenderCats();
    rvRenderModes();
    rvRenderTags();
  }

  function rvPickMode(mode) {
    RV.mode = mode;
    RV.cat = "*";   // 讓該模式的所有分類一次顯示（角色模式含 character + expression）
    rvRenderCats();
    rvRenderModes();
    rvRenderTags();
  }

  function rvApply() {
    if (!RV.picked.size) { toast("請先勾選想加的標籤", "warn"); return; }
    const posBefore = ($("pos").value || "");
    let split;
    try {
      split = rvSplitPicked(Array.from(RV.picked), window.Tags.selected(), posBefore,
        name => window.Tags.matchTag(name));
    } catch (e) {
      toast("加入失敗，原提示詞未變更", "warn");
      return;
    }
    // 路徑一：CATS 已知 → 底部標籤列（addTags 自帶去重並透過 tags:change 更新 UI）
    const addedBottom = split.toBottom.length ? window.Tags.addTags(split.toBottom) : 0;
    // 路徑二：CATS 未知 → 正向提示詞欄位（增量合併，保留原始格式）
    let addedExtra = 0;
    if (split.toExtra.length) {
      const merged = rvMergePrompt(posBefore, split.toExtra, []);
      if (merged.added) {
        $("pos").value = merged.text;
        try { localStorage.setItem("ui.extra", merged.text); } catch (e) { /* 無痕模式 */ }
        addedExtra = merged.added;
        updateWarn();
      }
    }
    if (!addedBottom) syncGo();   // 底部路徑已由 tags:change 觸發，避免重複更新
    // RV.picked 故意不清空：使用者可以再檢查、調整，或用「清空暫存」自行清除
    closeReverse();
    const total = addedBottom + addedExtra;
    if (total) {
      toast("已加入 " + total + " 個標籤（底部 " + addedBottom + "、補充描述 " + addedExtra + "）" +
        (split.skipped ? "，略過 " + split.skipped + " 個重複" : ""), "ok");
    } else {
      toast("選取的標籤都已存在", "warn");
    }
  }

  function openReverse() {
    $("revRun").disabled = !RV.dataUrl;
    openDialog($("revModal"), closeReverse, $("revDrop"));   // 打開就能直接 Ctrl+V，不必先點反推區
  }

  function closeReverse() { closeDialog($("revModal")); }
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
    // 反推模型切換（EVA02 預設 / ViT 快速）
    const revModelBtns = $("revModal").querySelectorAll(".rev-model-btn");
    revModelBtns.forEach(b => {
      b.onclick = () => {
        RV.model = b.dataset.model;
        revModelBtns.forEach(x => x.classList.toggle("on", x === b));
      };
    });
    $("revModal").onclick = e => { if (e.target.id === "revModal") closeReverse(); };
    $("revTags").onclick = rvToggleTag;
    $("revSelList").onclick = rvDropChip;
    $("revCats").onclick = e => {
      const b = e.target.closest(".rev-cat");
      if (b) rvPickCat(b.dataset.cat);
    };
    $("revModes").onclick = e => {
      const b = e.target.closest(".rev-mode-btn");
      if (b) rvPickMode(b.dataset.mode);
    };
    $("revSelAll").onclick = () => rvSetVisible(true);
    $("revSelNone").onclick = () => rvSetVisible(false);
    $("revClear").onclick = () => { RV.picked.clear(); rvRenderTags(); rvRenderPicked(); rvUpdateApply(); };
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
    // 只在反推區貼上：從 clipboard 取第一個 image/* 檔案，其餘（含文字）完全不碰
    $("revDrop").addEventListener("paste", e => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      let file = null;
      for (const it of Array.from(items)) {
        if (it.kind === "file" && /^image\//i.test(it.type || "")) {
          file = it.getAsFile();
          if (file) break;
        }
      }
      if (!file) return;
      e.preventDefault();
      rvPick(file);   // 格式/容量檢查、縮圖、預覽都交給既有流程
    });
    // 圖片拖到視窗空白處時，不要讓瀏覽器直接開圖
    window.addEventListener("dragover", e => e.preventDefault());
    window.addEventListener("drop", e => e.preventDefault());

    $("btnRandom").onclick = () => {
      const n = surpriseCombo();
      toast(`套用「${n}」`, "ok");
    };
    $("btnEmptyRandom").onclick = () => { $("btnRandom").click(); };
    const openFolder = async () => {
      if (!S.outOk) {
        toast(S.outError || "尚未設定有效的 COMFY_OUTPUT_DIR，無法開啟圖片資料夾", "warn", 5000);
        return;
      }
      try {
        const r = await fetch("/open-output");
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status));
      } catch (e) {
        toast("無法開啟資料夾：" + (e.message || e), "err", 5000);
      }
    };
    $("btnOpenFolder").onclick = openFolder;

    // 輸出設定收合／展開：只改 class 與可及性，不碰任何設定值或 localStorage
    const settingsPanel = document.querySelector(".settings");
    const setCollapsed = on => {
      const ws = document.querySelector(".workspace");
      const rail = $("settingsRail");
      if (!ws || !settingsPanel || !rail) return;
      ws.classList.toggle("settings-collapsed", on);
      settingsPanel.classList.toggle("collapsed", on);
      settingsPanel.querySelectorAll(".set-head, .set-body, .set-foot").forEach(el => {
        el.inert = on;
        if (on) el.setAttribute("aria-hidden", "true");
        else el.removeAttribute("aria-hidden");
      });
      rail.hidden = !on;
    };
    $("btnSettingsCollapse").onclick = () => setCollapsed(true);
    $("settingsRail").onclick = () => setCollapsed(false);
    window.addEventListener("resize", () => {
      if (innerWidth <= 1100 && settingsPanel.classList.contains("collapsed")) setCollapsed(false);
    });

    // 狀態列：點一下 = 檢查 / 啟動（外部模式只提示，不代啟動）
    $("statusPill").onclick = async () => {
      const ok = await checkComfy(true);
      if (ok) return;
      if (S.external) {
        toast("目前是外部連線模式，請自行啟動 ComfyUI，或檢查 COMFY_URL 的設定。", "warn", 6000);
        return;
      }
      startComfy();
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

    // 進階設定：行內收合，記住展開狀態
    const advBox = $("advBox");
    try { advBox.open = localStorage.getItem("ui.advOpen") === "1"; } catch (e) { /* ignore */ }
    advBox.addEventListener("toggle", () => {
      try { localStorage.setItem("ui.advOpen", advBox.open ? "1" : "0"); } catch (e) { /* ignore */ }
    });
    $("seedLock").onclick = () => {
      $("seed").value = "-1";
      persistSettings();
      toast("種子已改回每次隨機", "ok");
    };
    ["neg", "steps", "cfg", "seed"].forEach(id => {
      $(id).addEventListener("input", persistSettings);
    });

    // 快捷鍵
    document.addEventListener("keydown", e => {
      const tag = (e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); if (!topDialog()) generate(); return; }
      if (e.key === "Escape") {
        const td = topDialog();
        if (td) { td.close(); return; }   // 最上層的視窗先關（刪除確認會浮在燈箱上）
        if (S.running) {
          // 生成中誤按 Esc 很容易：連按兩次才真的取消
          const now = Date.now();
          if (now - lastEscAt < 1500) { lastEscAt = 0; cancel(); }
          else { lastEscAt = now; toast("再按一次 Esc 取消生成", "warn", 1500); }
        }
        return;
      }
      const td = topDialog();
      if (td && td.el === $("lightbox")) {
        if (e.key === "ArrowLeft") lbStep(-1);
        if (e.key === "ArrowRight") lbStep(1);
        return;
      }
      if (td) return;
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
    window.addEventListener("storage", (e) => {
      if (!e || !e.key) return;
      // 統計的 main/evt/fav/broken key 都要觸發重建，但重建是唯讀，不會產生寫入迴圈
      if (SHARED_KEYS.has(e.key) || e.key.indexOf("ui.tagStats") === 0) syncSharedState();
    });
    updateWarn();
    syncGo();

    // 輸出資料夾：由後端回報，不在前端寫死路徑
    fetch("/api/status", { cache: "no-store" }).then(r => r.json()).then(j => {
      applyOutputStatus(j);
      if (j && typeof j.external === "boolean") S.external = j.external;
    }).catch(() => { /* 保持預設文字 */ });

    // ComfyUI 狀態：開場檢查 + 每 20 秒輕量更新
    checkComfy();
    setInterval(() => { if (!S.running) checkComfy(true); }, 20000);

    // 圖片被刪的同步：開頁一次，之後回到視窗 / 每 45 秒各一次
    $("lbImg").addEventListener("error", () => { if (!$("lightbox").hidden) syncGallery(); });
    syncGallery();
    window.addEventListener("focus", () => {
      if (!S.running) syncGallery();
      syncSharedState();   // 與 storage event 共用同一套同步邏輯
    });
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
