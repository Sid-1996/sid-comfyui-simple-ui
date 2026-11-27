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
    ws: null, t0: 0, seedUsed: null,
    loras: [], loraMigration: null, loraMigrationBlocked: false,
    loraList: [], loraListState: "idle", loraListError: "", loraMeta: {},
    // Civitai 作者建議的暫時狀態（錯誤/讀取中），不進 localStorage
    loraCiv: {},
    civitai: {
      ckptName: "", ckpt: null, ckptState: "idle", ckptError: "",
      query: "", sort: "Highest Rated", period: "AllTime", nsfw: false,
      items: [], nextCursor: null, state: "idle", error: "",
      statusSeq: 0, searchSeq: 0, statusReq: null, searchReq: null, debounce: null,
      // API Key 狀態只在記憶體；Key 本身永不進 localStorage／DOM 持久狀態
      key: { configured: false, username: "", tier: "", error: "", state: "idle",
             formOpen: false, busy: false, result: "", resultKind: "" }
    }
  };
  S.gallery = Array.isArray(S.gallery) ? S.gallery.slice(0, 24) : [];
  let PV = null;   // 模型詳細預覽的當前狀態（不進 localStorage）

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
        : "點右欄「設定資料夾」指定 ComfyUI 輸出資料夾，或於啟動前設定 COMFY_OUTPUT_DIR";
    }
    syncDeleteButtons();
  }

  function syncDeleteButtons() {
    document.querySelectorAll('#stageResults [data-act="del"], #histBar .thumb-del').forEach(b => {
      b.disabled = !S.outOk;
      b.title = S.outOk ? "刪除這張" : "尚未設定輸出資料夾，請到右欄輸出設定指定";
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
  function composePrompt() { return composeCurrentPrompt().pos; }

  function composeCurrentPrompt(selected) {
    const posEl = $("pos") || {};
    const negEl = $("neg") || {};
    const model = window.PromptComposer.derivePromptModel({
      sel: Array.isArray(selected) ? selected : window.Tags.snapshot(), extra: posEl.value || "", loras: S.loras,
      qualityTags: S.settings.quality === true, negativeRaw: negEl.value == null ? "" : negEl.value
    }, { Dict: window.Dict });
    return { model, result: window.PromptComposer.compose(model, { defaultNegative: DEFAULT_NEG }) };
  }

  // 生成前取「完整且一致」的快照：標籤狀態（深拷貝）+ 組裝好的提示詞 + 負面 + 設定
  // payload 與 history 記錄都從這一份出來，不在流程中混用不同時間點的狀態
  function snapshotNow() {
    const sel = window.Tags.snapshot();
    const posEl = $("pos") || {};
    const negEl = $("neg") || {};
    const composed = composeCurrentPrompt(sel);
    // LoRA 觸發詞維持獨立來源；Composer 只負責組裝，不改持久化欄位。
    const loras = loraSnapshot(S.loras);
    return {
      sel,
      pos: composed.result.pos,
      neg: composed.result.neg,
      posHash: composed.result.posHash,
      promptModel: composed.model,
      entries: composed.result.snapshotEntries,
      snapshotEntries: composed.result.snapshotEntries,
      effective: composed.result.effective,
      negativeEntries: composed.result.negativeEntries,
      effectiveNegative: composed.result.effectiveNegative,
      negativeParse: composed.result.negativeParse,
      extraRaw: posEl.value || "",
      ckpt: $("ckpt") ? $("ckpt").value : "",
      w: S.settings.size.split("x").map(Number)[0],
      h: S.settings.size.split("x").map(Number)[1],
      n: S.settings.n,
      steps: Number($("steps").value) || 25,
      cfg: Number($("cfg").value) || 6,
      seed: readSeed(),
      loras
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

  /* ==== LORA_CORE_START ====
     純資料層：不碰 DOM、localStorage、網路。
     devtools/lora_core_test.mjs 直接擷取這一段做無瀏覽器測試。  */
  const LORA_VERSION = 2;
  const LORA_DEFAULT_WEIGHT = 0.8;     // 角色 LoRA 常見起始值；兩個 strength 共用
  const LORA_UI_MIN = -2;
  const LORA_UI_MAX = 2;
  const LORA_LIMIT = 100;              // ComfyUI LoraLoader 的節點上限（-100～100）
  const LORA_MAX_TRIGGERS = 40;
  const LORA_EXT = ".safetensors";
  // 作者建議的上限；與個人觸發詞分開，避免單一異常來源撐爆介面
  const LORA_AUTHOR_GROUPS = 20;
  const LORA_AUTHOR_WORD_LEN = 200;
  const LORA_AUTHOR_ITEM_LEN = 4000;

  // 觸發詞比對：大小寫、底線、多餘空白都視為同一個
  function loraNorm(s) {
    return String(s == null ? "" : s).normalize("NFKC").toLowerCase().trim().replace(/[_\s]+/g, " ");
  }

  // 非數值一律回預設；超過節點極限才夾住，不把合理範圍限死
  function loraWeight(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return LORA_DEFAULT_WEIGHT;
    return Math.round(Math.max(-LORA_LIMIT, Math.min(LORA_LIMIT, n)) * 100) / 100;
  }

  // ComfyUI 的相對名稱（可含子資料夾）。只做格式檢查，不碰檔案系統。
  function loraNameOk(name) {
    if (typeof name !== "string") return false;
    const s = name.trim();
    if (!s || s.length > 512 || s.indexOf("\0") >= 0) return false;
    if (s.charAt(0) === "/" || s.charAt(0) === "\\" || /^[a-zA-Z]:/.test(s)) return false;
    if (s.split(/[\\/]+/).some(seg => seg === "" || seg === "..")) return false;
    return s.toLowerCase().endsWith(LORA_EXT);
  }

  function loraDisplay(name) {
    const base = String(name || "").split(/[\\/]/).pop() || "";
    return base.replace(/\.safetensors$/i, "") || base;
  }

  function loraSub(name) {
    const parts = String(name || "").split(/[\\/]/);
    parts.pop();
    return parts.join(" / ");
  }

  // 只清理與去重，不套用個人詞 40 上限；供「統計未加入數量」使用。
  function loraCleanTriggerList(list) {
    const out = [], seen = new Set();
    (Array.isArray(list) ? list : []).forEach(raw => {
      const t = String(raw == null ? "" : raw).replace(/[\r\n]+/g, " ").trim();
      if (!t || t.length > 200) return;
      const k = loraNorm(t);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(t);
    });
    return out;
  }

  // 個人詞的保存上限仍舊是 40；截斷只在這裡發生。
  function loraCleanTriggers(list) {
    return loraCleanTriggerList(list).slice(0, LORA_MAX_TRIGGERS);
  }

  // 計算「加入作者建議到個人詞」的實際結果。
  // 回報數量必須等於保存前後的差值，不能先把未受上限截斷的數量報給使用者。
  function loraAddPlan(existing, words) {
    const cur = loraCleanTriggers(existing);
    const clean = loraCleanTriggerList(words);
    const before = new Set(cur.map(loraNorm));
    const fresh = clean.filter(t => !before.has(loraNorm(t)));
    const room = Math.max(0, LORA_MAX_TRIGGERS - cur.length);
    const taking = fresh.slice(0, room);
    const next = loraCleanTriggers(cur.concat(taking));
    return {
      next,
      added: Math.max(0, next.length - cur.length),
      skipped: fresh.length - taking.length,
      room,
      duplicates: clean.length - fresh.length
    };
  }

  // ── 作者建議（只讀，永不自動注入）────────────────────────
  // 群組是 string[][]；保留「哪一組有哪些詞」的關係，不攤平成一個字串。
  function loraNormGroups(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    (raw.slice(0, LORA_AUTHOR_GROUPS)).forEach(g => {
      if (!Array.isArray(g)) return;
      const words = loraCleanTriggers(g.filter(x => typeof x === "string"));
      if (words.length) out.push(words);
    });
    return out;
  }

  // Civitai trainedWords：每個元素是一整串逗號分隔詞組。先拆詞再乾淨化。
  function loraCivitaiGroups(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    raw.slice(0, LORA_AUTHOR_GROUPS).forEach(item => {
      if (typeof item !== "string" || !item.trim() || item.length > LORA_AUTHOR_ITEM_LEN) return;
      const words = loraCleanTriggers(item.split(/[,\r\n]+/));
      if (words.length) out.push(words);
    });
    return out;
  }

  function loraFingerprint(groups, versionId) {
    const src = JSON.stringify([versionId == null ? "" : String(versionId), loraNormGroups(groups)]);
    let h = 2166136261;
    for (let i = 0; i < src.length; i++) {
      h ^= src.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function loraAuthorDefault() {
    return {
      local: { groups: [] },
      civitai: { versionId: null, groups: [], fetchedAt: null, fingerprint: null }
    };
  }

  // 白名單式解析：只接受已知欄位，壞的建議不能毀掉個人 triggers
  function loraParseAuthor(raw, fallback) {
    const a = (raw && typeof raw === "object") ? raw
      : (fallback && typeof fallback === "object" ? fallback : {});
    const local = a.local && typeof a.local === "object" ? a.local : {};
    const c = a.civitai && typeof a.civitai === "object" ? a.civitai : {};
    const n = Number(c.versionId);
    const versionId = Number.isFinite(n) && n > 0 && n <= 2147483647 ? Math.floor(n) : null;
    const t = Number(c.fetchedAt);
    const fetchedAt = Number.isFinite(t) && t > 0 ? t : null;
    return {
      local: { groups: loraNormGroups(local.groups) },
      civitai: {
        versionId,
        groups: loraNormGroups(c.groups),
        fetchedAt,
        fingerprint: typeof c.fingerprint === "string" ? c.fingerprint.slice(0, 80) : null
      }
    };
  }

  function loraSuggestionCount(item) {
    const a = loraParseAuthor(item && item.authorSuggestions);
    return a.local.groups.concat(a.civitai.groups).reduce((n, g) => n + g.length, 0);
  }

  // 非阻塞提醒的狀態判斷（純函式，供 devtools 驗證）
  function loraReminderState(item, suggestionCount) {
    if (!item || item.enabled === false) return "none";
    if (item.noTriggerNeeded === true) return "none";
    const has = Array.isArray(item.triggers) && item.triggers.length > 0;
    if (has && item.autoTrigger === false) return "autoOff";
    if (suggestionCount > 0) return "hasSuggestions";
    return has ? "none" : "missing";
  }

  function loraAdoptionRecordOk(r) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return false;
    const keys = ["adoptionId", "source", "sourceGroupId", "word", "wordKey", "adoptedAt", "via"];
    if (Object.keys(r).some(k => !keys.includes(k)) || keys.some(k => !Object.prototype.hasOwnProperty.call(r, k))) return false;
    if (typeof r.adoptionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.adoptionId)) return false;
    if (typeof r.sourceGroupId !== "string" || !/^g_(unknown_)?[0-9a-f]{8}(\.[1-9][0-9]*)?$/.test(r.sourceGroupId)) return false;
    if (typeof r.word !== "string" || !r.word.length || r.word.length > 200 || typeof r.wordKey !== "string" || !r.wordKey.length || r.wordKey.length > 200) return false;
    if (r.wordKey !== loraNorm(r.word) || !Number.isInteger(r.adoptedAt) || r.adoptedAt < 0 || !["word", "group", "all-local", "migration"].includes(r.via)) return false;
    const s = r.source;
    if (!s || typeof s !== "object" || Array.isArray(s) || Object.keys(s).some(k => !["kind", "versionId", "localFingerprint", "sourceFingerprint"].includes(k)) ||
      ["kind", "versionId", "localFingerprint", "sourceFingerprint"].some(k => !Object.prototype.hasOwnProperty.call(s, k))) return false;
    if (!["author-local", "author-civitai"].includes(s.kind) || !(s.localFingerprint === null || typeof s.localFingerprint === "string") ||
      !(s.sourceFingerprint === null || typeof s.sourceFingerprint === "string")) return false;
    return s.kind === "author-civitai"
      ? Number.isInteger(s.versionId) && s.versionId > 0 && s.versionId <= 2147483647 && s.localFingerprint === null
      : s.versionId === null;
  }

  // Parse once into usable v2 items plus explicit backup requests. Migration owns persistence.
  function loraParseState(raw) {
    const hasVersion = raw && typeof raw === "object" && Object.prototype.hasOwnProperty.call(raw, "v");
    const knownVersion = !hasVersion || raw.v === 1 || raw.v === 2;
    const src = raw && typeof raw === "object" && Array.isArray(raw.items) ? raw.items : [];
    const migration = { quarantine: [], backups: [], reason: null, needsWrite: !raw || raw.v !== 2, blocked: false };
    const inferredV2 = !knownVersion && src.some(it => it && typeof it === "object" && Object.prototype.hasOwnProperty.call(it, "personalTriggers"));
    if (!knownVersion && typeof raw.v === "number") {
      migration.reason = "unknown-version"; migration.blocked = true;
      migration.backups.push({ reason: "quarantine", itemName: null, payload: { kind: "raw-json", value: JSON.stringify(raw) }, note: "不支援的 LoRA 版本；未降級解析，原始資料已隔離保全。" });
      return { v: LORA_VERSION, items: [], migration };
    }
    if (!knownVersion) {
      migration.reason = "invalid-version";
      migration.backups.push({ reason: "quarantine", itemName: null, payload: { kind: "raw-json", value: JSON.stringify(raw) }, note: "版本欄位無法辨識；依內容推測前已保全整包原始資料。" });
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw) && !Array.isArray(raw.items)) {
      migration.reason = "quarantine"; migration.blocked = true;
      migration.backups.push({ reason: "quarantine", itemName: null, payload: { kind: "raw-json", value: JSON.stringify(raw) }, note: "LoRA 清單欄位格式錯誤；原始資料已隔離保全。" });
      return { v: LORA_VERSION, items: [], migration };
    }
    if (raw != null && (typeof raw !== "object" || Array.isArray(raw))) {
      migration.reason = "quarantine"; migration.blocked = true;
      migration.backups.push({ reason: "quarantine", itemName: null, payload: { kind: "raw-json", value: JSON.stringify(raw) }, note: "LoRA 資料外層格式錯誤；原始資料已隔離保全。" });
      return { v: LORA_VERSION, items: [], migration };
    }

    const items = [], seen = new Set();
    const quarantine = (it, name, reason, note) => {
      migration.quarantine.push({ itemName: name || null, reason, value: it });
      const isItemObject = it !== null && typeof it === "object" && !Array.isArray(it);
      migration.backups.push({ reason: reason === "type-error" ? "type-error" : "quarantine", itemName: isItemObject ? (name || null) : null,
        payload: isItemObject ? { kind: "item", value: it } : { kind: "raw-json", value: JSON.stringify(it) }, note });
      migration.reason = "quarantine";
    };
    src.forEach(it => {
      const name = it && typeof it === "object" && typeof it.name === "string" ? it.name.trim() : "";
      if (!it || typeof it !== "object" || Array.isArray(it) || !loraNameOk(name)) {
        quarantine(it, name, "quarantine", "無效 LoRA 名稱或資料列；原始資料已隔離保全。"); return;
      }
      if (seen.has(name.toLowerCase())) { quarantine(it, name, "quarantine", "重複 LoRA 資料列；原始資料已隔離保全。"); return; }
      seen.add(name.toLowerCase());
      const v2 = raw && raw.v === 2 || inferredV2;
      const hasPersonal = Object.prototype.hasOwnProperty.call(it, "personalTriggers");
      const hasLegacy = Object.prototype.hasOwnProperty.call(it, "triggers");
      const personalValid = Array.isArray(it.personalTriggers) && it.personalTriggers.every(x => typeof x === "string");
      const legacyValid = Array.isArray(it.triggers) && it.triggers.every(x => typeof x === "string");
      const adoptionValid = Array.isArray(it.adoptionRecords);
      const adoptionRows = adoptionValid ? it.adoptionRecords.filter(loraAdoptionRecordOk) : [];
      const badAdoption = adoptionValid && adoptionRows.length !== it.adoptionRecords.length;
      const author = it.authorSuggestions;
      const authorShapeOk = author == null || (typeof author === "object" && !Array.isArray(author) &&
        ["local", "civitai"].every(k => author[k] == null || (typeof author[k] === "object" && !Array.isArray(author[k]) &&
          (author[k].groups == null || (Array.isArray(author[k].groups) && author[k].groups.every(g => Array.isArray(g) && g.every(w => typeof w === "string")))))));
      const malformed = (hasPersonal && !personalValid) || (hasLegacy && !legacyValid) ||
        (v2 && Object.prototype.hasOwnProperty.call(it, "adoptionRecords") && !adoptionValid) || badAdoption || !authorShapeOk ||
        (Object.prototype.hasOwnProperty.call(it, "display") && typeof it.display !== "string") ||
        (Object.prototype.hasOwnProperty.call(it, "strength") && (typeof it.strength !== "number" || !Number.isFinite(it.strength))) ||
        (Object.prototype.hasOwnProperty.call(it, "enabled") && typeof it.enabled !== "boolean") ||
        (Object.prototype.hasOwnProperty.call(it, "autoTrigger") && typeof it.autoTrigger !== "boolean") ||
        (Object.prototype.hasOwnProperty.call(it, "noTriggerNeeded") && typeof it.noTriggerNeeded !== "boolean");
      if (malformed) quarantine(it, name, "type-error", "欄位型別或採用紀錄格式錯誤；有效資料已保留，原始資料已隔離保全。");

      const v2Words = personalValid ? loraCleanTriggerList(it.personalTriggers) : [];
      const v1Words = legacyValid ? loraCleanTriggerList(it.triggers) : [];
      let triggers;
      if (personalValid && legacyValid && v2Words.length === 0 && v1Words.length > 0) {
        // M6: an intentional v2 empty list wins; persist old words separately before writing.
        triggers = [];
        migration.backups.push({ reason: "v1-data-v2-empty", itemName: name,
          payload: { kind: "item", value: { triggers: it.triggers, personalTriggers: it.personalTriggers } },
          note: "v2 為有效空陣列；v1 舊詞已保全，不自動合回。" });
      } else if (personalValid && legacyValid && loraNormList(v2Words) !== loraNormList(v1Words)) {
        // M5: v2 order wins; append only v1 words not already present by wordKey.
        triggers = loraCleanTriggerList(v2Words.concat(v1Words));
        migration.backups.push({ reason: "dual-conflict", itemName: name,
          payload: { kind: "item", value: { triggers: it.triggers, personalTriggers: it.personalTriggers } },
          note: "v1 與 v2 觸發詞衝突；已依 wordKey 合併，原始兩欄已保全。" });
      } else if (v2 && personalValid) triggers = v2Words.slice();
      else if (personalValid) triggers = v2Words.slice();
      else if (v2 && hasPersonal) triggers = [];
      else if (legacyValid) triggers = v1Words.slice();
      else triggers = [];

      const item = {
        name, display: typeof it.display === "string" && it.display.trim() ? it.display.trim().slice(0, 200) : loraDisplay(name),
        strength: loraWeight(it.strength), triggers: loraCleanTriggerList(triggers),
        adoptionRecords: adoptionRows, autoTrigger: it.autoTrigger !== false, enabled: it.enabled !== false,
        authorSuggestions: loraParseAuthor(it.authorSuggestions), noTriggerNeeded: it.noTriggerNeeded === true
      };
      if (v2 && !Object.prototype.hasOwnProperty.call(it, "adoptionRecords")) {
        migration.needsWrite = true;
        if (!migration.reason) migration.reason = "field-missing-v2";
      }
      items.push(item);
    });
    if (inferredV2) migration.needsWrite = true;
    return { v: LORA_VERSION, items, migration };
  }

  function loraNormList(items) { return loraCleanTriggerList(items).map(loraNorm).join("\0"); }

  function loraParseItems(raw) { return loraParseState(raw).items; }

  function loraSerialize(items) {
    return {
      v: LORA_VERSION,
      items: (Array.isArray(items) ? items : []).map(it => ({
        name: it.name,
        display: it.display,
        strength: loraWeight(it.strength),
        personalTriggers: loraCleanTriggerList(it.triggers),
        adoptionRecords: Array.isArray(it.adoptionRecords) ? it.adoptionRecords : [],
        autoTrigger: !!it.autoTrigger,
        enabled: !!it.enabled,
        authorSuggestions: loraParseAuthor(it.authorSuggestions),
        noTriggerNeeded: !!it.noTriggerNeeded
      }))
    };
  }

  function loraFind(items, name) {
    const k = String(name || "").toLowerCase();
    return (Array.isArray(items) ? items : []).findIndex(it => it.name.toLowerCase() === k);
  }

  // 回傳新陣列；同名視為同一筆並合併欄位，不就地改動呼叫端資料
  function loraSet(items, name, patch) {
    const list = Array.isArray(items) ? items.slice() : [];
    const clean = typeof name === "string" ? name.trim() : "";
    if (!loraNameOk(clean)) return list;
    const i = loraFind(list, clean);
    const base = i >= 0 ? Object.assign({}, list[i]) : {
      name: clean, display: loraDisplay(clean), strength: LORA_DEFAULT_WEIGHT,
      triggers: [], autoTrigger: true, enabled: false,
      authorSuggestions: loraAuthorDefault(), noTriggerNeeded: false,
      adoptionRecords: [], migrationBackup: null
    };
    const p = patch && typeof patch === "object" ? patch : {};
    if (p.display != null) base.display = String(p.display).trim().slice(0, 200) || loraDisplay(clean);
    if (p.strength != null) base.strength = loraWeight(p.strength);
    if (p.triggers != null) base.triggers = loraCleanTriggers(p.triggers);
    if (p.autoTrigger != null) base.autoTrigger = !!p.autoTrigger;
    if (p.enabled != null) base.enabled = !!p.enabled;
    if (p.authorSuggestions != null) {
      base.authorSuggestions = loraParseAuthor(p.authorSuggestions, base.authorSuggestions);
    }
    if (p.noTriggerNeeded != null) base.noTriggerNeeded = !!p.noTriggerNeeded;
    if (i >= 0) list[i] = base; else list.push(base);
    return list;
  }

  function loraRemove(items, name) {
    return (Array.isArray(items) ? items : []).filter(
      it => it.name.toLowerCase() !== String(name || "").toLowerCase());
  }

  function loraEnabled(items) {
    return (Array.isArray(items) ? items : []).filter(it => it.enabled !== false && loraNameOk(it.name));
  }

  // 本次生成要用的固定資料（順序＝使用者加入順序＝Workflow 串接順序）
  // 職責是「完整保存個人設定」：即使 autoTrigger 關閉，觸發詞也要留在快照／歷史，
  // 才能還原。要不要放進 Prompt，由 loraTokensFromSnapshot() 單獨判斷。
  // 作者建議是「目前 LoRA 的最新 metadata」，不進快照／歷史，避免舊歷史讓它回退。
  function loraSnapshot(items) {
    return loraEnabled(items).map(it => ({
      name: it.name,
      display: it.display || loraDisplay(it.name),
      strength: loraWeight(it.strength),
      personalTriggers: loraCleanTriggerList(it.triggers),
      autoTrigger: it.autoTrigger !== false,
      noTriggerNeeded: it.noTriggerNeeded === true
    }));
  }

  // 只組合「自動加入」的 LoRA 觸發詞；跨 LoRA 去重、保持第一次出現的順序。
  // 舊快照沒有 autoTrigger 欄位時視為啟用，維持相容。
  function loraTokensFromSnapshot(list) {
    const out = [], seen = new Set();
    (Array.isArray(list) ? list : []).forEach(l => {
      if (!l || l.autoTrigger === false) return;
      const triggers = Array.isArray(l.personalTriggers) ? l.personalTriggers : (Array.isArray(l.triggers) ? l.triggers : []);
      triggers.forEach(raw => {
        const t = String(raw || "").trim();
        const k = loraNorm(t);
        if (!k || seen.has(k)) return;
        seen.add(k);
        out.push(t);
      });
    });
    return out;
  }

  // 把 LoRA 鏈接進「剛建好的」Workflow；0 個時原封不動回傳，維持與舊版完全等效
  function loraApplyToWorkflow(nodes, loras) {
    const list = (Array.isArray(loras) ? loras : []).filter(l => l && loraNameOk(l.name));
    if (!list.length) return nodes;
    const ids = Object.keys(nodes).map(Number).filter(n => Number.isFinite(n));
    let next = (ids.length ? Math.max.apply(null, ids) : 0) + 1;
    let model = ["1", 0];   // CheckpointLoaderSimple: MODEL
    let clip = ["1", 1];    // CheckpointLoaderSimple: CLIP
    list.forEach(l => {
      const id = String(next++);
      const w = loraWeight(l.strength);
      nodes[id] = { class_type: "LoraLoader", inputs: {
        model,
        clip,
        lora_name: l.name,
        strength_model: loraWeight(l.strengthModel == null ? w : l.strengthModel),
        strength_clip: loraWeight(l.strengthClip == null ? w : l.strengthClip)
      } };
      model = [id, 0];
      clip = [id, 1];
    });
    // 正面與負面共用同一條 CLIP 鏈，KSampler 用最後的 MODEL
    nodes["2"].inputs.clip = clip;
    nodes["3"].inputs.clip = clip;
    nodes["5"].inputs.model = model;
    return nodes;
  }

  function wf(o) {
    const nodes = {
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
    return loraApplyToWorkflow(nodes, o.loras);
  }
  /* ==== LORA_CORE_END ==== */

  // Migration operates on an injectable storage in tests; the application only supplies its own store here.
  const loraLoadResult = window.LoraMigration.readAndMigrate(
    localStorage, loraParseState,
    items => loraSerialize(items)
  );
  S.loras = loraLoadResult.state.items;
  S.loraMigration = loraLoadResult.state.migration || null;
  S.loraMigrationResult = loraLoadResult.result;
  S.loraMigrationBlocked = !loraLoadResult.result.ok;

  /* ==== CIVITAI_CORE_START ====
     純資料層：版本級適配分類與 Strict 排序。不碰 DOM、localStorage、網路。
     devtools/lora_explorer_core_test.mjs 直接擷取這一段做無瀏覽器測試。  */
  const CV_LEVELS = [
    { key: "exact", label: "完全適配" },
    { key: "review", label: "需要確認" },
    { key: "unknown", label: "需要確認（未知基底）" },
    { key: "bad", label: "不建議" }
  ];

  function cvText(v) { return String(v == null ? "" : v).trim(); }

  function cvIsOtherFamily(base) {
    return base === "pony" || base.indexOf("pony") === 0 ||
      /^sd (1\.|2\.|3\.)/.test(base) || base.indexOf("flux") === 0;
  }

  // 回傳 {level, key, label, reason}；level 愈小愈優先
  function cvClassify(baseModel, baseModelType, ckptBase) {
    const base = cvText(baseModel).toLowerCase();
    const btype = cvText(baseModelType).toLowerCase();
    const ckpt = cvText(ckptBase);
    if (!ckpt) return { level: 2, key: "unknown", label: "需要確認",
      reason: "目前 Checkpoint 基底無法可靠辨識" };
    if (!base) return { level: 2, key: "unknown", label: "需要確認",
      reason: "這個版本沒有基底資訊" };
    if (base === "other") return { level: 2, key: "unknown", label: "需要確認",
      reason: "Civitai 標為 Other，無法確認基底" };

    if (ckpt.toLowerCase() === "illustrious") {
      if (base === "illustrious") {
        if (btype === "standard") return { level: 0, key: "exact", label: "完全適配",
          reason: "與目前 Checkpoint 同為 Illustrious / Standard" };
        return { level: 1, key: "review", label: "需要確認",
          reason: "同為 Illustrious，但版本類型不是 Standard" };
      }
      if (base === "noobai" || base.indexOf("sdxl") === 0) {
        return { level: 1, key: "review", label: "需要確認",
          reason: "同屬 SDXL 架構家族，但基底不同於 Illustrious" };
      }
      // 「不建議」清單是針對 Illustrious 驗證過的規則，不可套用到其他 Checkpoint
      if (cvIsOtherFamily(base)) return { level: 3, key: "bad", label: "不建議",
        reason: "與 Illustrious 不同基底系列，已有明確不建議依據" };
      return { level: 2, key: "unknown", label: "需要確認",
        reason: "未建立與 Illustrious 的相容性依據" };
    }

    // Checkpoint 已知但不是 Illustrious：目前沒有可靠規則可給「完全適配」
    if (base === ckpt.toLowerCase()) return { level: 1, key: "review", label: "需要確認",
      reason: "基底名稱相同，但尚未建立此 Checkpoint 的完全適配規則" };
    return { level: 2, key: "unknown", label: "需要確認",
      reason: "與目前 Checkpoint 的相容性未知" };
  }

  // 回傳 {version, index, cls}：卡片圖片必須來自實際被選為最佳適配依據的版本。
  // 同級不替換（嚴格小於），因此保持既有穩定順序與四級規則。
  function cvBestVersionInfo(versions, ckptBase) {
    const list = Array.isArray(versions) ? versions : [];
    let best = null, index = -1;
    list.forEach((v, i) => {
      const c = cvClassify(v && v.baseModel, v && v.baseModelType, ckptBase);
      if (!best || c.level < best.level) { best = c; index = i; }
    });
    if (!best) return { version: null, index: -1, cls: cvClassify(null, null, ckptBase) };
    return { version: list[index] || null, index: index, cls: best };
  }

  function cvBestVersion(versions, ckptBase) {
    return cvBestVersionInfo(versions, ckptBase).cls;
  }

  // 成熟內容判斷（卡片縮圖、詳細預覽、切圖共用）。
  // publicSafe 由後端依官方 nsfw=false 搜尋過濾標記；不解讀 nsfwLevel 數字。
  // 明確成熟、無法判定、或模型層級 nsfw 的圖片在未開啟成熟內容時一律不顯示。
  function cvImageSafety(img, model, showMature) {
    if (!img) return false;
    if (showMature) return true;              // 沿用既有行為：成熟模式顯示全部
    if (img.mature || !img.publicSafe) return false;
    if (model && model.nsfw) return false;    // 模型層級保護維持不變
    return true;
  }

  // 穩定排序：同級內保留 Civitai API 的原始順序
  function cvSortItems(items, ckptBase) {
    return (Array.isArray(items) ? items : [])
      .map((item, i) => ({ item, i, best: cvBestVersion(item && item.versions, ckptBase) }))
      .sort((a, b) => (a.best.level - b.best.level) || (a.i - b.i))
      .map(x => x.item);
  }

  function cvStatusKey(name) { return cvText(name).toLowerCase(); }

  function cvVersionUrl(modelId, versionId) {
    const m = encodeURIComponent(String(modelId == null ? "" : modelId));
    const v = encodeURIComponent(String(versionId == null ? "" : versionId));
    return "https://civitai.com/models/" + m + "?modelVersionId=" + v;
  }
  /* ==== CIVITAI_CORE_END ==== */


  // 非阻塞提醒：只讀取狀態、不改變 Prompt、不擋生成；同一個狀態只提醒一次。
  const loraReminded = new Set();
  function loraRemindBeforeGenerate() {
    const enabled = loraEnabled(S.loras);
    if (!enabled.length) return;
    let first = "", count = 0;
    enabled.forEach(it => {
      const state = loraReminderState(it, loraSuggestionCount(it));
      if (state === "none") return;
      const key = it.name.toLowerCase() + "|" + state;
      if (loraReminded.has(key)) return;
      loraReminded.add(key);
      count++;
      if (first) return;
      const name = it.display || loraDisplay(it.name);
      first = state === "autoOff"
        ? `${name} 的觸發詞目前不會自動加入 Prompt（到右欄「角色 LoRA → 觸發詞」可開啟）`
        : state === "hasSuggestions"
          ? `${name} 有作者建議的觸發詞尚未加入，到右欄「角色 LoRA → 觸發詞」可挑選`
          : `${name} 還沒設觸發詞；若這個模型不需要，請到右欄按「這個 LoRA 不需要 Trigger Words」`;
    });
    if (first) toast(count > 1 ? `${first}（另有 ${count - 1} 個 LoRA）` : first, "warn", 6500);
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

    // ① 選了 LoRA 就先確認它還在本機清單中；無效模型不可靜默略過
    if (!(await verifySelectedLoras())) { syncGo(); return; }

    // ①b 非阻塞提醒：不檢驗 Prompt、不擋生成，也不修改任何設定
    loraRemindBeforeGenerate();

    // ② 生成前同步標籤狀態（#pos 由 snapshotNow 直接讀 DOM，不從 storage 覆蓋）
    if (window.Tags && typeof window.Tags.syncFromStorage === "function") window.Tags.syncFromStorage();

    // ③ 取快照（標籤狀態、提示詞、負面、設定、LoRA 一次進）——之後請求與紀錄同源
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
      fileTag,
      loras: snap.loras
    };
    const selSnap = snap.sel;
    const extraSnap = snap.extraRaw;
    const negSnap = snap.neg.trim();

    logGen("snapshot", { genId, posLen: snap.pos.length, negLen: snap.neg.length, posHash: hashStr(snap.pos), seed, steps: snap.steps, cfg: snap.cfg, tags: snap.sel.map(s => s.t), loras: snap.loras.map(l => l.name + "@" + l.strength) });

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
        loras: snap.loras,
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
          <button type="button" data-act="prompt"${hasPositiveSnapshot(it) ? "" : " disabled"} title="套用正向提示詞。來源：歷史圖片；寫入目前提示詞。替換正向標籤與補充描述，保留 Negative、LoRA 和生成設定。">正向套用</button>
          <button type="button" data-act="restore"${hasPositiveSnapshot(it) ? "" : " disabled"} title="還原已保存的提示詞狀態。來源：歷史圖片；生成設定保留。">狀態還原</button>
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
    const positiveReady = hasPositiveSnapshot(it);
    $("lbPrompt").disabled = !positiveReady;
    $("lbPrompt").title = positiveReady ? "來源：這張歷史圖片；寫入目前提示詞的正向標籤與補充描述。Negative、LoRA 和生成設定保留。" : "這筆舊紀錄缺少完整提示詞資料，無法安全套用。";
    $("lbRestore").disabled = !positiveReady;
    $("lbRestore").title = positiveReady ? "來源：這張歷史圖片；確認後還原已保存的提示詞狀態。尺寸、步數、CFG、Seed 和模型保留。" : "這筆舊紀錄缺少完整提示詞資料，無法安全還原。";
    $("lbApply").disabled = !Array.isArray(it.sel);
    $("lbApply").title = Array.isArray(it.sel)
      ? "基底：歷史圖片；替換來源：目前提示詞；寫入目標：目前提示詞。已選分類替換，未選分類保留歷史內容。"
      : "這筆舊紀錄缺少標籤資料，無法安全分類替換。";
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

  function buildReusePlan(it) {
    const item = it && typeof it === "object" ? it : {};
    const positiveReady = hasPositiveSnapshot(item);
    const positive = buildPositiveReusePlan(item);
    const hasLoras = Array.isArray(item.loras);
    const loraList = hasLoras ? item.loras.map(l => {
      const prev = loraItem(l && l.name);
      return {
        name: l && l.name, display: l && l.display, strength: l && l.strength,
        triggers: l && (l.personalTriggers || l.triggers), autoTrigger: l && l.autoTrigger, enabled: true,
        noTriggerNeeded: l && l.noTriggerNeeded,
        authorSuggestions: prev ? prev.authorSuggestions : null
      };
    }) : null;
    return {
      source: item,
      positiveReady,
      positiveError: positiveReady ? "" : "這筆舊紀錄缺少完整提示詞資料，無法安全套用。",
      positive,
      sel: positive ? positive.sel : null,
      extra: positive ? positive.extra : null,
      // Full restore is explicit: an existing empty neg clears, while an absent legacy field is preserved.
      negAction: Object.prototype.hasOwnProperty.call(item, "neg") && typeof item.neg === "string" ? "replace" : "keep",
      neg: typeof item.neg === "string" ? item.neg : "",
      loraAction: hasLoras ? "replace" : "keep",
      loraList,
      summary: hasLoras
        ? (loraList.length ? `會替換目前 LoRA（${loraList.length} 個）。` : "會清空目前 LoRA（這筆歷史保存的角色清單為空）。")
        : "這筆歷史沒有 LoRA 欄位，目前 LoRA 保留。"
    };
  }

  function buildPositiveReusePlan(item) {
    if (!hasPositiveSnapshot(item)) return null;
    const sel = JSON.parse(JSON.stringify(item.sel));
    const currentSel = window.Tags && typeof window.Tags.snapshot === "function"
      ? JSON.parse(JSON.stringify(window.Tags.snapshot())) : [];
    const key = e => String(e && e.t || "").toLowerCase().trim().replace(/[_\s]+/g, " ");
    const targetKeys = new Set(sel.map(key)), currentKeys = new Set(currentSel.map(key));
    const currentByKey = new Map();
    currentSel.forEach(e => { if (!currentByKey.has(key(e))) currentByKey.set(key(e), e); });
    const retained = [], weightChanges = [];
    sel.forEach(e => {
      const current = currentByKey.get(key(e));
      if (!current) return;
      const from = positiveTagWeight(current), to = positiveTagWeight(e);
      if (from === to) retained.push(e);
      else weightChanges.push({ t: e.t, from, to });
    });
    return {
      sel, extra: item.extra, currentSel,
      currentExtra: $("pos") ? String($("pos").value || "") : "",
      added: sel.filter(e => !currentKeys.has(key(e))),
      removed: currentSel.filter(e => !targetKeys.has(key(e))),
      retained, weightChanges
    };
  }

  // Match caWeight(): stored tag weights must be finite and positive; otherwise they mean 1.
  function positiveTagWeight(entry) {
    const weight = Number(entry && entry.w);
    return Number.isFinite(weight) && weight > 0 ? weight : 1;
  }

  function positiveWeightLabel(weight) { return positiveTagWeight({ w: weight }).toFixed(1); }

  function reuseDiffList(entries, empty) {
    return entries.length ? `<ul>${entries.map(e => {
      const weight = positiveTagWeight(e);
      return `<li>${esc(e.t)}${Number.isFinite(weight) && Math.abs(weight - 1) > 1e-9 ? ` × ${weight.toFixed(1)}` : ""}</li>`;
    }).join("")}</ul>` : `<p class="meta">${empty}</p>`;
  }

  function positiveLabels(entries) {
    return entries.map(e => {
      const weight = positiveTagWeight(e);
      return `${e.t}${Math.abs(weight - 1) > 1e-9 ? ` (${weight.toFixed(1)})` : ""}`;
    }).join(", ");
  }

  function positiveReusePreview(plan) {
    if (!plan) return '<p role="alert">缺少完整的正向提示詞資料，目前內容不會變更。</p>';
    return `<section class="prompt-diff" aria-label="正向提示詞差異預覽">
      <div><h3>目前 Positive</h3><pre>${esc(positiveLabels(plan.currentSel) + (plan.currentExtra ? (plan.currentSel.length ? ", " : "") + plan.currentExtra : "") || "（空的）")}</pre></div>
      <div><h3>套用後 Positive</h3><pre>${esc(positiveLabels(plan.sel) + (plan.extra ? (plan.sel.length ? ", " : "") + plan.extra : "") || "（空的）")}</pre></div>
      <div class="prompt-diff-cols">
        <section><h3>新增</h3>${reuseDiffList(plan.added, "沒有新增標籤")}</section>
        <section><h3>移除</h3>${reuseDiffList(plan.removed, "沒有移除標籤")}</section>
        <section><h3>保留</h3>${reuseDiffList(plan.retained, "沒有相同標籤")}</section>
        <section><h3>權重變更</h3>${plan.weightChanges.length
          ? `<ul>${plan.weightChanges.map(change => `<li>${esc(change.t)}：${positiveWeightLabel(change.from)} → ${positiveWeightLabel(change.to)}</li>`).join("")}</ul>`
          : '<p class="meta">沒有權重變更</p>'}</section>
      </div>
      <div><h3>補充描述</h3><p><b>目前：</b>${esc(plan.currentExtra || "（空的）")}</p><p><b>套用後：</b>${esc(plan.extra || "（空的）")}</p></div>
    </section>`;
  }

  function commitReuse(plan) {
    if (!plan || !plan.positiveReady) {
      toast("這筆舊紀錄缺少完整提示詞資料，無法安全套用", "warn");
      return false;
    }
    let nextLoras = null;
    if (plan.loraAction !== "keep") {
      nextLoras = loraParseItems({ v: 2, items: plan.loraList });
      const saved = window.LoraMigration.saveState(localStorage, { items: nextLoras }, loraSerialize);
      S.loraMigrationResult = saved;
      if (!saved.ok) { toast(saved.message, "err", 6500); return false; }
    }
    try { window.Tags.restore(plan.sel); }
    catch (e) { toast("套用失敗，目前提示詞沒有變更", "err"); return false; }
    $("pos").value = plan.extra;
    try { localStorage.setItem("ui.extra", plan.extra); } catch (e) { /* ignore */ }
    if (plan.negAction === "replace") { $("neg").value = plan.neg; persistSettings(); }
    if (plan.loraAction !== "keep") {
      S.loras = nextLoras;
      S.loraCiv = {};
      if (LORA.active && !loraItem(LORA.active)) { LORA.active = null; LORA.editing = -1; }
      renderLoraSelected(); renderLoraPick(); renderLoraTriggers();
      renderLoraBackupNotice();
    }
    updateWarn();
    toast("已還原這張圖保存的提示詞狀態；生成設定保留", "ok");
    return true;
  }

  function reusePrompt(it) {
    const plan = buildReusePlan(it);
    const currentLoras = (S.loras || []).map(l => `${esc(l.display || l.name)} × ${Number(l.strength || 0).toFixed(2)}`).join("、");
    const restoredLoras = plan.loraAction === "keep" ? currentLoras :
      (plan.loraList || []).map(l => `${esc(l.display || l.name)} × ${Number(l.strength || 0).toFixed(2)}`).join("、");
    openModal("還原已保存的提示詞狀態", `<p>來源：這張歷史圖片。寫入目標：目前提示詞。</p>
      ${plan.positiveReady ? `<p>會還原歷史保存的正向標籤與補充描述。</p>` : `<p role="alert">${esc(plan.positiveError)}目前內容不會變更。</p>`}
      ${positiveReusePreview(plan.positive)}
      <p>${esc(plan.summary)}</p>
      <section class="prompt-diff" aria-label="Negative 還原差異"><h3>Negative · ${plan.negAction === "keep" ? "保留目前內容" : plan.neg ? "取代" : "將清空"}</h3><p><b>目前：</b><pre>${esc($("neg") ? $("neg").value : "") || "（空的）"}</pre></p><p><b>還原後：</b><pre>${esc(plan.negAction === "keep" ? ($( "neg") ? $("neg").value : "") : plan.neg) || "（空的）"}</pre></p></section>
      <section class="prompt-diff" aria-label="LoRA 還原差異"><h3>LoRA · ${plan.loraAction === "keep" ? "保留目前內容" : plan.loraList.length ? "取代" : "將清空"}</h3>
        <p><b>目前：</b>${currentLoras || "（空的）"}</p>
        <p><b>還原後：</b>${plan.loraAction === "keep" ? (restoredLoras || "保留目前空清單") : restoredLoras || "將清空"}</p></section>
      <p>尺寸、步數、CFG、Seed、模型及其他生成設定都保留目前值。</p>
      ${plan.loraList && plan.loraList.length ? `<ul>${plan.loraList.map((l, i) => `<li>${esc(l.display || l.name)} × ${Number(l.strength || 0).toFixed(2)}（第 ${i + 1} 個）</li>`).join("")}</ul>` : ""}
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>取消</button>
      <button type="button" class="btn btn-primary" data-reuse="confirm"${plan.positiveReady ? "" : " disabled"}>還原已保存的提示詞狀態</button></div>`);
    const confirm = $("modalBody").querySelector('[data-reuse="confirm"]');
    confirm.onclick = () => { if (commitReuse(plan)) closeModal(); };
  }

  function reuseTextPrompt(it) {
    const item = it && typeof it === "object" ? it : {};
    const plan = buildPositiveReusePlan(item);
    if (!plan) {
      toast("這筆舊紀錄缺少完整提示詞資料，無法安全套用", "warn");
      return false;
    }
    openModal("套用正向提示詞", `<p>來源：這張歷史圖片。寫入目標：目前提示詞。</p>
      <p>將這張歷史圖片的正向標籤與補充描述套用到目前提示詞；目前 Negative、LoRA 與生成設定不會改變。</p>
      ${positiveReusePreview(plan)}
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>取消</button>
      <button type="button" class="btn btn-primary" data-positive-reuse="confirm">套用正向提示詞</button></div>`);
    const confirm = $("modalBody").querySelector('[data-positive-reuse="confirm"]');
    confirm.onclick = () => {
      try { window.Tags.restore(plan.sel); }
      catch (e) { toast("套用失敗，目前提示詞沒有變更", "err"); return; }
      $("pos").value = plan.extra;
      try { localStorage.setItem("ui.extra", plan.extra); } catch (e) { /* ignore */ }
      updateWarn();
      closeModal();
      toast("已套用歷史圖片的正向提示詞；目前 Negative、LoRA 與生成設定保留", "ok");
    };
    return true;
  }

  function hasPositiveSnapshot(item) {
    return !!item && typeof item === "object" &&
      Object.prototype.hasOwnProperty.call(item, "sel") && Array.isArray(item.sel) &&
      item.sel.every(entry => entry && typeof entry === "object" && typeof entry.t === "string") &&
      Object.prototype.hasOwnProperty.call(item, "extra") && typeof item.extra === "string";
  }

  /* ==== CATEGORY_APPLY_PLANNER_START ====
     純資料層：不碰 DOM、不碰 localStorage、不呼叫 Tags.restore。
     devtools/category_apply_test.mjs 會擷取這一段做無瀏覽器測試。  */
  const CA_CATS = ["character", "clothing", "body", "pose", "expression",
    "composition", "background", "style", "adult", "other"];

  function caNorm(s) {
    return String(s == null ? "" : s).toLowerCase().trim().replace(/[_\s]+/g, " ");
  }
  function caWeight(entry) {
    const w = Number(entry && entry.w);
    return Number.isFinite(w) && w > 0 ? w : 1;
  }
  function caInfo(entry) {
    const t = String((entry && entry.t) || "");
    const TC = window.TagCategories;
    const has = !!(TC && typeof TC.has === "function" && TC.has(t));
    const cat = has ? (TC.of(t) || "other") : "unknown";
    return { t, key: caNorm(t), has, cat, w: caWeight(entry) };
  }

  // character 分類混了大量通用外觀特徵：這些不能被當成角色專名自動換掉。
  const CA_GENERIC_CHAR = [
    /^\d+\+?\s*(boy|girl|other|male|female|people|person)s?$/,
    /\b(solo|everyone|multiple|group|couple|twins?|brothers?|sisters?|family|friends?)\b/,
    /\b(hair|bangs|braid|ponytail|twintail|ahoge|sidelocks|hairband|hairclip)\b/,
    /\b(eye|eyes|pupil|iris|eyelash|eyelashes|heterochromia)\b/,
    /\b(aged?|age|young|old|child|teen|mature|adult|baby|toddler)\b/,
    /\b(animal ears|cat ears|fox ears|rabbit ears|dog ears|tail|horns?|wings?|fang|pointy ears|antennae)\b/,
    /\b(maid|nurse|angel|demon|elf|vampire|witch|princess|knight|idol|teacher|student|ghost|doll|robot|monster|animal|dog|cat|bird|dragon)\b/,
    /\b(breasts?|ass|legs?|feet|collarbone|mole|scar|tattoo|skin|muscle)\b/,
    /^(cat ?girl|catgirl|fox girl|dragon girl|rabbit girl)\b/
  ];
  function caIsGenericChar(t) {
    const s = caNorm(t);
    return CA_GENERIC_CHAR.some(re => re.test(s));
  }
  function caHasSeries(t) { return /\([^)]+\)/.test(String(t || "")); }
  function caIsCrossClothing(t) {
    const s = caNorm(t);
    return /cosplay/.test(s) || caHasSeries(t);
  }
  // body 幾乎都是通用身體特徵；實測 737 筆只有 oripathy lesion (arknights)
  // 帶明確作品識別。排除 organ/medium 等通用消歧括號，不把 crest 類當角色名。
  const CA_GENERIC_PARENS = new Set([
    "organ", "medium", "object", "style", "weapon", "symbol", "emblem",
    "shape", "food", "chess", "creature", "animal", "flower", "plant",
    "pattern", "gemstone", "cup", "company", "phrase", "character",
    "female", "male", "bunny", "swimsuit", "casual",
    "1st costume", "2nd costume", "first ascension", "second ascension", "third ascension"
  ]);
  function caIsCrossBody(t) {
    const s = caNorm(t);
    if (!caHasSeries(s)) return false;
    const inner = ((s.match(/\(([^)]*)\)/) || [])[1] || "").trim();
    return !!inner && !CA_GENERIC_PARENS.has(inner);
  }
  function caRoleGroup(info) {
    if (info.cat !== "character") {
      if (info.cat === "clothing" && caIsCrossClothing(info.t)) return "cross-clothing";
      if (info.cat === "body" && caIsCrossBody(info.t)) return "cross-body";
      if (info.cat === "expression") return "cross-expression";
      return null;
    }
    if (caIsGenericChar(info.t)) return "generic";
    return caHasSeries(info.t) ? "name-certain" : "name-possible";
  }
  function caGroupNote(group) {
    switch (group) {
      case "name-certain": return "角色專名（含作品名，預先勾選，可取消）";
      case "name-possible": return "可能是角色名，也可能是通用詞，請確認";
      case "generic": return "通用外觀特徵（髮型／眼睛／人數／年齡等，預設不換）";
      case "cross-clothing": return "角色專屬服裝或 Cosplay，請確認是否一起換";
      case "cross-body": return "與作品／角色相關的人物設計，請確認是否一起換";
      case "cross-expression": return "表情可能影響角色辨識，請確認";
      case "other": return "已分類為「其他」，需逐項確認";
      case "unknown": return "不在分類表中的標籤，需逐項確認";
      default: return "";
    }
  }
  function caBuildCandidates(historySel, currentSel, cats, opts) {
    const want = cats instanceof Set ? new Set(cats)
      : new Set(Array.isArray(cats) ? cats : []);
    // 角色模式只有在 character 仍被選取時才有效，避免與UI狀態分離。
    const roleActive = !!(opts && opts.role) && want.has("character");
    const out = [];
    const seen = { history: new Set(), current: new Set() };
    [["history", historySel], ["current", currentSel]].forEach(pair => {
      const side = pair[0], list = pair[1];
      (Array.isArray(list) ? list : []).forEach((entry, index) => {
        if (!entry || typeof entry.t !== "string" || !entry.t.trim()) return;
        const info = caInfo(entry);
        if (!info.key || seen[side].has(info.key)) return;
        seen[side].add(info.key);
        const inCats = want.has(info.cat);
        const group = caRoleGroup(info);
        // 跨分類候選只在角色模式有效、且該分類未被使用者明確勾選時額外出現。
        const roleCross = roleActive && !inCats && !!group && group.indexOf("cross-") === 0;
        const needsOther = !info.has || info.cat === "other";
        if (needsOther && !want.has("other")) return;
        if (!inCats && !roleCross && !needsOther) return;
        let finalGroup = group || info.cat;
        let checked;
        if (needsOther) {
          finalGroup = info.has ? "other" : "unknown";
          checked = false;
        } else if (roleActive && !inCats && group) {
          finalGroup = group;
          checked = false;
        } else if (roleActive && info.cat === "character" && group) {
          // 角色模式內的 character 仍分層：專名預勾、通用特徵不勾。
          finalGroup = group;
          checked = group === "name-certain";
        } else {
          // 使用者明確勾選的分類（含手動加進來的 expression/clothing/body）
          // 一律恢復一般分類的預設行為，不沿用角色模式的預設不勾選。
          checked = true;
        }
        out.push({
          id: side + ":" + info.key, side, index,
          t: info.t, key: info.key, w: info.w, cat: info.cat, has: info.has,
          group: finalGroup, note: caGroupNote(finalGroup), checked
        });
      });
    });
    return out;
  }
  function caPlanApply(historySel, currentSel, checkedIds, candidates) {
    const checked = checkedIds instanceof Set ? checkedIds : new Set(checkedIds || []);
    const list = Array.isArray(candidates) ? candidates : [];
    const hist = (Array.isArray(historySel) ? historySel : [])
      .filter(e => e && typeof e.t === "string" && e.t.trim());
    const removeSet = new Set(), addList = [], seenAdd = new Set(), oldW = new Map();
    list.forEach(c => {
      if (!checked.has(c.id)) return;
      if (c.side === "history") {
        removeSet.add(c.key);
        if (!oldW.has(c.key)) oldW.set(c.key, c.w);
      } else if (!seenAdd.has(c.key)) {
        seenAdd.add(c.key);
        addList.push(c);
      }
    });
    const addByCat = new Map();
    addList.forEach(c => {
      if (!addByCat.has(c.cat)) addByCat.set(c.cat, []);
      addByCat.get(c.cat).push(c);
    });
    const result = [], usedCats = new Set(), addedKeys = new Set();
    // 人工取消移除的歷史標籤仍留在結果裡：目前的同 key 標籤不得再插入一次。
    const keepKeys = new Set(hist
      .filter(e => !removeSet.has(caNorm(e.t)))
      .map(e => caNorm(e.t)));
    const pushAdds = cat => {
      (addByCat.get(cat) || []).forEach(c => {
        if (keepKeys.has(c.key) || result.some(x => caNorm(x.t) === c.key)) return;
        result.push({ t: c.t, w: c.w });
        addedKeys.add(c.key);
      });
      usedCats.add(cat);
    };
    hist.forEach(entry => {
      const info = caInfo(entry);
      if (addByCat.has(info.cat) && !usedCats.has(info.cat)) pushAdds(info.cat);
      if (!removeSet.has(info.key)) result.push({ t: entry.t, w: caWeight(entry) });
    });
    addByCat.forEach((v, cat) => { if (!usedCats.has(cat)) pushAdds(cat); });
    const weightChanges = [];
    addList.forEach(c => {
      const from = oldW.get(c.key);
      if (from != null && Math.abs(from - c.w) > 1e-9) {
        weightChanges.push({ t: c.t, from, to: c.w });
      }
    });
    return {
      nextSel: result,
      remove: list.filter(c => c.side === "history" && checked.has(c.id)),
      add: list.filter(c => c.side === "current" && checked.has(c.id) && addedKeys.has(c.key)),
      stats: { removeCount: removeSet.size, addCount: addedKeys.size, weightChanges }
    };
  }
  function caPromptTokens(text) {
    const out = new Set();
    String(text == null ? "" : text).split(/[,\r\n]+/).forEach(seg => {
      let t = String(seg).trim();
      if (!t) return;
      const m = t.match(/^\(\s*([^()]*?)\s*\)$/);
      if (m) t = String(m[1]).split(":")[0].trim();
      const k = caNorm(t);
      if (k) out.add(k);
    });
    return out;
  }
  function caMergeExtra(current, history) {
    const base = String(current == null ? "" : current);
    const have = caPromptTokens(base);
    const add = [];
    String(history == null ? "" : history).split(/[,\r\n]+/).forEach(seg => {
      const s = String(seg).trim();
      if (!s) return;
      const k = caNorm(s);
      if (k && !have.has(k)) { have.add(k); add.push(s); }
    });
    return add.length ? (base.trim() ? base.trim() + ", " + add.join(", ") : add.join(", ")) : base;
  }
  function caExtraResult(mode, current, history) {
    if (mode === "replace") return String(history == null ? "" : history);
    if (mode === "merge") return caMergeExtra(current, history);
    return String(current == null ? "" : current);
  }
  /* ==== CATEGORY_APPLY_PLANNER_END ==== */

  /* ── 分類套用：UI 狀態與渲染（預覽階段完全不碰正式狀態）── */
  const CA = { it: null, cats: new Set(), checked: new Set(), candidates: [], overrides: new Map(), extraMode: "keep", role: false, presetKey: "" };
  const CA_QUICK = [
    ["role", "只換角色", ["character"], true],
    ["clothing", "只換服裝", ["clothing"], false],
    ["body", "只換人物設計", ["body"], false],
    ["pose", "只換姿勢", ["pose"], false],
    ["expression", "只換表情", ["expression"], false],
    ["composition", "只換構圖", ["composition"], false],
    ["background", "只換背景", ["background"], false],
    ["style", "只換畫風", ["style"], false]
  ];
  function caCatName(c) {
    const names = window.TagCategories && window.TagCategories.categories;
    return (names && names[c]) || c;
  }
  function caCurrentPlan() {
    return caPlanApply(CA.it && CA.it.sel, window.Tags.snapshot(), CA.checked, CA.candidates);
  }
  function caExtraPreviewValue(current) {
    return CA.extraMode === "keep" ? current : CA.extraText;
  }
  function caRebuild() {
    CA.candidates = caBuildCandidates(CA.it && CA.it.sel, window.Tags.snapshot(), CA.cats, { role: CA.role });
    // 手動勾選只是覆寫；分類或模式改變時，其餘項目一律用新的預設值。
    CA.checked = new Set(CA.candidates
      .filter(c => (CA.overrides.has(c.id) ? CA.overrides.get(c.id) : c.checked))
      .map(c => c.id));
  }
  function caOpen(it) {
    const TC = window.TagCategories;
    if (!TC || typeof TC.has !== "function" || typeof TC.of !== "function" || !TC.categories) {
      toast("分類資料沒有載入，請重新整理頁面再試；也可以用「還原已保存的提示詞狀態」。", "warn", 6000);
      return;
    }
    if (!it || !Object.prototype.hasOwnProperty.call(it, "sel") || !Array.isArray(it.sel)) {
      toast("這筆舊紀錄缺少完整標籤資料，無法安全分類替換", "warn");
      return;
    }
    CA.it = it;
    CA.cats = new Set(); CA.checked = new Set(); CA.candidates = []; CA.overrides = new Map();
    CA.extraMode = "keep"; CA.role = false; CA.presetKey = "";
    openModal("按分類替換提示詞", "");
    caRender();
    const first = $("modalBody").querySelector('[data-ca="preset"]');
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  function caRender() {
    const body = $("modalBody");
    if (!body || !CA.it) return;
    const sc = body.scrollTop;
    const hist = Array.isArray(CA.it.sel) ? CA.it.sel : [];
    const cur = window.Tags.snapshot();
    const plan = caCurrentPlan();
    // 候選不分是否被勾選都要顯示，否則使用者無法手動選取跨分類項目。
    const removeCandidates = CA.candidates.filter(c => c.side === "history");
    const addCandidates = CA.candidates.filter(c => c.side === "current");
    const countsH = {}, countsC = {};
    hist.forEach(e => { const i = caInfo(e); countsH[i.cat] = (countsH[i.cat] || 0) + 1; });
    cur.forEach(e => { const i = caInfo(e); countsC[i.cat] = (countsC[i.cat] || 0) + 1; });
    const chip = c => {
      // 即時勾選狀態只有一個來源：CA.checked。c.checked 只是建立時的預設值。
      const checked = CA.checked.has(c.id);
      const zh = window.Tags.tagZh(c.t);
      const wc = plan.stats.weightChanges.find(x => x.t === c.t);
      const weight = (c.w === 1 ? "" : " (" + c.w.toFixed(1) + ")") +
        (wc ? " <i>" + wc.from.toFixed(1) + "→" + wc.to.toFixed(1) + "</i>" : "");
      const ambiguous = c.group === "generic" || c.group === "name-possible" ||
        c.group === "other" || c.group === "unknown" || c.group.indexOf("cross-") === 0;
      const label = (ambiguous ? "⚠ " : "") + (zh ? zh + " · " + c.t : c.t) + weight;
      return '<button type="button" class="rev-tag' + (checked ? " on" : "") +
        (window.Tags.isAdult(c.t) ? " adult" : "") + '" data-ca="item" data-id="' + esc(c.id) +
        '" aria-pressed="' + checked + '" title="' + esc(c.note || c.t) + '">' + esc(label) + "</button>";
    };
    const quickHtml = CA_QUICK.map(q =>
      '<button type="button" class="btn btn-soft btn-sm rev-mode-btn' +
      (CA.presetKey === q[0] ? " on" : "") + '" data-ca="preset" data-preset="' + q[0] + '">' +
      esc(q[1]) + "</button>").join("");
    const catHtml = CA_CATS.map(c => {
      const note = c === "other" ? "（含未分類，需逐項確認）" : "";
      return '<button type="button" class="rev-cat' + (CA.cats.has(c) ? " on" : "") +
        '" data-ca="cat" data-cat="' + c + '" aria-pressed="' + CA.cats.has(c) + '">' +
        esc(caCatName(c) + note) + "<b>圖 " + (countsH[c] || 0) + " / 現在 " + (countsC[c] || 0) + "</b></button>";
    }).join("");
    const curPos = ($("pos") && $("pos").value) || "";
    const histExtra = CA.it.extra || "";
    const extraRadios = [
      ["keep", "補充描述：保留目前內容（不讀歷史文字）"],
      ["replace", "補充描述：以歷史圖片文字取代目前內容"],
      ["merge", "補充描述：目前內容＋歷史圖片文字（去重合併）"]
    ]
      .map(o => '<label><input type="radio" name="caExtra" data-ca="extra" data-mode="' + o[0] + '"' +
        (CA.extraMode === o[0] ? " checked" : "") +
        (o[0] !== "keep" && !(Object.prototype.hasOwnProperty.call(CA.it, "extra") && typeof CA.it.extra === "string") ? " disabled" : "") +
        "> " + esc(o[1]) + "</label>").join(" ");
    const extraText = CA.extraMode === "keep" ? "" :
      '<textarea id="caExtraText" class="prompt-box" rows="4" aria-label="補充描述結果">' + esc(CA.extraText) + "</textarea>";
    // 可套用與否必須同時考慮標籤與補充描述；caCommit() 早已允許只改補充描述。
    const hasTagChanges = !!(plan.stats.removeCount || plan.stats.addCount);
    const hasExtraChange = CA.extraMode !== "keep";
    const canApply = hasTagChanges || hasExtraChange;
    const hint = canApply ? "" : '<p class="meta">目前沒有可替換的項目。請先選分類，或勾選下面的候選標籤。</p>';
    const footLabel = hasTagChanges
      ? "套用（移除 " + plan.stats.removeCount + " · 加入 " + plan.stats.addCount + "）"
      : (hasExtraChange ? "套用補充描述" : "套用（移除 0 · 加入 0）");
    body.innerHTML =
      '<p class="meta">以這張歷史圖片為基底。替換來源：目前提示詞；寫入目標：目前提示詞。已選分類會用目前同分類內容取代歷史內容；未選分類保留歷史內容。</p>' +
      "<h3>快速替換（先預覽，確認後才會套用）</h3>" +
      '<div class="rev-modes">' + quickHtml + "</div>" +
      "<h3>選擇要替換的分類（可多選）</h3>" +
      '<div class="rev-cats">' + catHtml + "</div>" +
      '<div class="rev-grid">' +
        '<div class="rev-left"><div class="rev-group-head"><h3>歷史圖片中將被替換的標籤</h3><b id="caRemoveCount">' +
        plan.stats.removeCount + "</b></div>" +
        '<div id="caRemoveList" class="rev-tags">' + (removeCandidates.length ? removeCandidates.map(chip).join("") : '<span class="rev-empty">尚無</span>') + "</div>" +
        '<p class="meta">這些標籤原本屬於歷史圖片，套用後會由目前提示詞中相同分類的標籤取代。</p></div>' +
        '<div class="rev-right"><div class="rev-group-head"><h3>將從目前提示詞帶入的標籤</h3><b id="caAddCount">' +
        plan.stats.addCount + "</b></div>" +
        '<div id="caAddList" class="rev-tags">' + (addCandidates.length ? addCandidates.map(chip).join("") : '<span class="rev-empty">尚無</span>') + "</div>" +
        '<p class="meta">這些標籤會從目前提示詞帶入，取代歷史圖片中選取分類的內容。⚠ 表示需要你確認；角色專屬服裝與表情不會自動帶入。</p></div>' +
      "</div>" +
      '<section class="prompt-diff ca-final" aria-label="分類套用後 Positive"><h3>套用後 Positive（標籤與補充描述）</h3>' +
        '<p class="meta">歷史內容是基底；勾選分類採用目前內容，其他歷史標籤保留。</p>' +
        '<pre id="caFinalTags">' + esc(plan.nextSel.map(e => e.t + (Number(e.w) !== 1 ? " (" + Number(e.w).toFixed(1) + ")" : "")).join(", ") || "（沒有標籤）") + '</pre>' +
        '<p><b>補充描述結果：</b></p><pre id="caFinalExtra">' + esc(caExtraPreviewValue(curPos) || "（空的）") + '</pre>' +
      '</section>' +
      "<h3>補充描述（與上方標籤分類替換分開）</h3>" +
      (!(Object.prototype.hasOwnProperty.call(CA.it, "extra") && typeof CA.it.extra === "string") ? '<p class="meta">歷史紀錄缺少補充描述；保留目前內容，無法安全替換或合併歷史文字。</p>' : "") +
      '<div class="rev-rating">' + extraRadios + "</div>" +
      '<p class="meta">目前提示詞：' + esc(curPos || "（空的）") + "</p>" +
      '<p class="meta">歷史圖片：' + esc(histExtra || "（空的）") + "</p>" +
      extraText +
      hint +
      '<div class="modal-foot">' +
        '<button type="button" class="btn btn-ghost" data-close>取消</button>' +
        '<button type="button" class="btn btn-soft" data-ca="full">還原已保存的提示詞狀態…</button>' +
        '<button type="button" class="btn btn-primary" id="caApply" data-ca="apply"' +
        (canApply ? "" : " disabled") + ">" + esc(footLabel) + "</button>" +
      "</div>";
    body.scrollTop = sc;
  }
  function caOnClick(e) {
    const b = e.target.closest("[data-ca]");
    if (!b) return;
    const kind = b.dataset.ca;
    if (kind === "preset") {
      const p = CA_QUICK.find(x => x[0] === b.dataset.preset);
      if (!p) return;
      CA.presetKey = p[0]; CA.role = p[3]; CA.cats = new Set(p[2]); CA.overrides = new Map();
      caRebuild(); caRender();
    } else if (kind === "cat") {
      const c = b.dataset.cat;
      if (CA.cats.has(c)) CA.cats.delete(c); else CA.cats.add(c);
      // 角色模式的有效狀態跟著 character 分類走，不留下孤立的 CA.role。
      if (!CA.cats.has("character")) CA.role = false;
      CA.presetKey = "";
      caRebuild(); caRender();
    } else if (kind === "item") {
      const id = b.dataset.id;
      const next = !CA.checked.has(id);
      CA.overrides.set(id, next);
      if (next) CA.checked.add(id); else CA.checked.delete(id);
      caRender();
    } else if (kind === "full") {
      const it = CA.it;
      closeModal(); closeLightbox();
      if (it) reusePrompt(it);
    } else if (kind === "apply") {
      caCommit();
    }
  }
  function caOnChange(e) {
    const b = e.target;
    if (!b || b.dataset.ca !== "extra") return;
    if (b.dataset.mode !== "keep" && !(CA.it && Object.prototype.hasOwnProperty.call(CA.it, "extra") && typeof CA.it.extra === "string")) {
      toast("歷史紀錄缺少補充描述，無法安全替換或合併", "warn");
      return;
    }
    CA.extraMode = b.dataset.mode;
    // 文字框預填「確定後會寫入的內容」，使用者改了就以改過的為準。
    CA.extraText = caExtraResult(CA.extraMode, ($("pos") && $("pos").value) || "", CA.it.extra || "");
    caRender();
  }
  function caOnInput(e) {
    if (e.target && e.target.id === "caExtraText") {
      CA.extraText = e.target.value;
      const finalExtra = $("modalBody").querySelector("#caFinalExtra");
      if (finalExtra) finalExtra.textContent = CA.extraText || "（空的）";
    }
  }
  function caCommit() {
    if (!CA.it) return;
    const plan = caCurrentPlan();
    const changed = !!(plan.stats.removeCount || plan.stats.addCount);
    if (!changed && CA.extraMode === "keep") { toast("沒有可套用的變更", "warn"); return; }
    // 只有標籤真的變動時才提交，避免只改補充描述時連排序模式也被改掉。
    if (changed) window.Tags.restore(plan.nextSel);   // 單次提交
    if (CA.extraMode !== "keep") {
      $("pos").value = CA.extraText;
      try { localStorage.setItem("ui.extra", CA.extraText); } catch (e) { /* 無痕模式 */ }
      updateWarn();
    }
    closeModal();
    closeLightbox();
    const note = CA.extraMode === "keep" ? "" :
      "，補充描述已" + (CA.extraMode === "replace" ? "取代" : "合併");
    toast("已寫回目前提示詞：分類替換（移除 " + plan.stats.removeCount + "、加入 " + plan.stats.addCount + "）" + note, "ok");
  }

  /* ── 刪圖 ─────────────────────────────────────────────── */
  function confirmDelete(it) {
    if (!it) return;
    if (!S.outOk) {
      openModal("無法刪除圖片", `
        <p>還沒有設定輸出資料夾，所以不能刪圖（避免刪到其他資料夾）。</p>
        <p>請在右欄「輸出設定」按「設定資料夾」，指定你的 ComfyUI 輸出資料夾；也可以在啟動前設定 COMFY_OUTPUT_DIR。</p>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>知道了</button>
          <button type="button" class="btn btn-primary" id="btnGoSetOutput">去設定</button>
        </div>`);
      $("btnGoSetOutput").onclick = () => { closeModal(); openOutputDirModal(); };
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

  function closeModal() {
    if (PV) {
      const main = $("pvMain");
      if (main) { main.onerror = null; main.removeAttribute("src"); }
      const strip = $("pvStrip");
      if (strip) strip.onclick = null;
      PV = null;
    }
    closeDialog($("modal"));
  }

  // 輸出資料夾：由後端驗證並保存，前端只負責輸入完整路徑
  function openOutputDirModal() {
    openModal("設定輸出資料夾", `
      <p class="meta">貼上你的 ComfyUI 輸出資料夾完整路徑。瀏覽器無法取得本機完整路徑，請直接輸入或貼上。</p>
      <input id="outDirInput" type="text" value="${esc(S.outDir || "")}" placeholder="例如 C:\\Users\\YourName\\ComfyUI\\output" autocomplete="off" spellcheck="false">
      <p class="meta" id="outDirHint">${S.outOk
        ? "資料夾必須已存在且可寫入；設定後立即生效，若無法永久保存會明確告知。"
        : "請貼上你的 ComfyUI 輸出資料夾完整路徑；資料夾必須已存在且可寫入。設定後立即生效，若無法永久保存會明確告知。"}</p>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>取消</button>
        <button type="button" class="btn btn-primary" id="btnSaveOutputDir">儲存</button>
      </div>`);
    const input = $("outDirInput");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    const save = async () => {
      const path = input.value.trim();
      if (!path) { toast("請輸入資料夾路徑", "warn"); return; }
      const hint = $("outDirHint");
      try {
        const r = await fetch("/api/output-dir", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-SimpleUI": "1" },
          body: JSON.stringify({ path })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          hint.textContent = j.error || ("設定失敗（HTTP " + r.status + "）");
          return;
        }
        const st = await fetch("/api/status", { cache: "no-store" }).then(x => x.json());
        applyOutputStatus(st);
        if (j.persisted === false) {
          // 本次已生效，但保存失敗：不可顯示「永久保存成功」，讓使用者看到完整訊息
          hint.textContent = j.warning || "已即時生效，但無法永久保存，重新啟動後可能失效。";
          toast("輸出資料夾已即時生效，但無法永久保存（重啟後可能失效）", "warn", 6000);
          return;
        }
        closeModal();
        toast("輸出資料夾已設定並保存", "ok");
      } catch (e) {
        hint.textContent = "無法連到本機服務：" + (e.message || e);
      }
    };
    $("btnSaveOutputDir").onclick = save;
    input.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); save(); } };
  }

  function showPromptModal() {
    const composed = composeCurrentPrompt();
    const p = composed.result.pos;
    const neg = composed.result.neg;
    const loras = loraSnapshot(S.loras);
    openModal("完整提示詞", `
      <p class="meta" style="margin-bottom:8px">這就是真正送進模型的內容（正面 ${p.split(",").filter(x => x.trim()).length} 個標籤）。</p>
      ${loras.length ? `<p class="meta" style="margin-bottom:8px">角色 LoRA：${loras.map(l => esc(l.display) + " × " + l.strength.toFixed(2)).join("、")}</p>` : ""}
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

  /* ── 角色 LoRA：選取、權重、觸發詞 ─────────────────────── */
  const LORA = { filter: "", active: null, editing: -1 };
  let loraListReq = null;
  // 版本網址輸入框的暫存（重新繪製面板時不遺失），不進 localStorage
  const cvInputs = {};
  // Civitai 建議詞讀取：每個 LoRA 的請求世代序號 + 進行中請求。
  // seq 遞增辨識每次獨立操作（取消連結也會遞增），只有序號仍最新的回應才可更新狀態；
  // pending 用於防重複，避免同一 LoRA 同一版本的相同請求重複發送。皆不進 localStorage。
  const civReqSeq = {};
  const civReqPending = {};

  function loraItem(name) {
    const i = loraFind(S.loras, name);
    return i >= 0 ? S.loras[i] : null;
  }

  function loraInfo(name) {
    const k = String(name || "").toLowerCase();
    return S.loraList.find(x => x.name.toLowerCase() === k) || null;
  }

  function loraSave() {
    if (S.loraMigrationBlocked) {
      toast(S.loraMigrationResult && S.loraMigrationResult.message || "LoRA 資料尚未安全遷移，暫時無法保存。", "err", 6500);
      return false;
    }
    const saved = window.LoraMigration.saveState(localStorage, { items: S.loras }, loraSerialize);
    S.loraMigrationResult = saved;
    if (!saved.ok) toast(saved.message, "err", 6500);
    renderLoraBackupNotice();
    return saved.ok;
  }

  function renderLoraBackupNotice() {
    const box = $("loraBackupNotice");
    if (!box) return;
    const parsed = window.LoraMigration.parseBackup(localStorage);
    if (parsed.error) {
      box.hidden = false;
      box.innerHTML = `<div class="lora-backup-head">遷移備份狀態無法讀取</div><p>${esc(parsed.error.message)}</p>`;
      return;
    }
    const records = parsed.value.backups.filter(window.LoraMigration.validateRecord);
    if (!records.length) { box.hidden = true; box.replaceChildren(); return; }
    const canConfirm = !S.loraMigrationBlocked && S.loraMigrationResult && S.loraMigrationResult.ok;
    box.hidden = false;
    box.innerHTML = `<div class="lora-backup-head">LoRA 遷移備份：${records.filter(x => x.status === "pending").length} 筆待確認</div>` +
      (S.loraMigrationBlocked && S.loraMigrationResult ? `<p>${esc(S.loraMigrationResult.message)} 目前不會覆寫原始資料；重新整理可重試遷移。</p>` : "") +
      records.map(x => {
        const words = x.payload.kind === "item" && x.payload.value.triggers;
        const canRestore = canConfirm && x.status === "pending" && x.itemName && loraFind(S.loras, x.itemName) >= 0 &&
          Array.isArray(words) && words.every(w => typeof w === "string");
        return `<div class="lora-backup-row"><span><b>${x.status === "pending" ? "待確認" : x.status === "confirmed" ? "已確認" : "已捨棄"}</b> · ${esc(x.itemName || "整份資料")} · ${esc(x.reason)}</span>` +
          (x.status === "pending" && canConfirm ? `<span class="lora-backup-actions">${canRestore ? `<button type="button" class="btn btn-ghost btn-sm" data-backup-restore="${esc(x.backupId)}">還原舊詞</button>` : ""}<button type="button" class="btn btn-soft btn-sm" data-backup-confirm="${esc(x.backupId)}">保留目前結果</button></span>` : "") +
          `</div>`;
      }).join("");
  }

  function confirmLoraBackup(backupId, restoreOldWords) {
    if (S.loraMigrationBlocked || !S.loraMigrationResult || !S.loraMigrationResult.ok) {
      toast("遷移結果尚未成功保存，現在不能確認。", "err", 6500);
      return;
    }
    if (restoreOldWords) {
      const current = window.LoraMigration.parseBackup(localStorage);
      const record = current.error ? null : current.value.backups.find(x => x.backupId === backupId && x.status === "pending");
      const words = record && record.payload && record.payload.kind === "item" && record.payload.value && record.payload.value.triggers;
      const index = record && record.itemName ? loraFind(S.loras, record.itemName) : -1;
      if (!Array.isArray(words) || !words.every(w => typeof w === "string") || index < 0) {
        toast("這筆備份沒有可還原的舊詞，原設定與備份都保留。", "err", 6500);
        return;
      }
      const next = S.loras.slice();
      next[index] = Object.assign({}, next[index], { triggers: loraCleanTriggerList(next[index].triggers.concat(words)) });
      const savedState = window.LoraMigration.saveState(localStorage, { items: next }, loraSerialize);
      if (!savedState.ok || !savedState.verified) { toast(savedState.message, "err", 6500); return; }
      S.loras = next;
      S.loraMigrationResult = savedState;
      renderLoraSelected(); renderLoraPick(); renderLoraTriggers();
    }
    const saved = window.LoraMigration.confirmBackup(localStorage, backupId);
    S.loraMigrationResult = saved.ok ? S.loraMigrationResult : saved;
    renderLoraBackupNotice();
    toast(saved.ok ? "已確認目前的 LoRA 遷移結果；備份仍保留。" : saved.message, saved.ok ? "ok" : "err", 6500);
  }

  // 清單還沒載入時不亂標「找不到」，避免 ComfyUI 暫時離線就嚇使用者
  function loraAvailable(name) {
    if (S.loraListState !== "ready") return true;
    return !!loraInfo(name);
  }

  function translateLoraError(e) {
    const m = String((e && e.message) || e || "");
    if (/failed to fetch|networkerror|load failed|aborterror/i.test(m))
      return "無法連到本機生圖服務，請確認 simple_ui 還開著，再按「重新整理」。";
    return m || "讀不到 LoRA 清單，請稍後再按「重新整理」。";
  }

  // API 資料格式統一的白話訊息（HTML、invalid JSON、缺欄位或型別錯誤都用它）
  const LORA_FORMAT_ERROR = "目前無法讀取 LoRA 清單，生圖服務回傳的資料格式不正確。請重新整理；如果持續發生，請重新啟動生圖介面後再試。";

  // 不是 JSON 就只說「格式不正確」：HTML fallback 只能證明回應不是預期 JSON，
  // 不能證明是「服務版本過舊」（可能是代理、錯誤頁或其他路由回應）。
  async function loraReadJSON(r) {
    const text = await r.text();
    try { return JSON.parse(text); }
    catch (e) { throw new Error(LORA_FORMAT_ERROR); }
  }

  function loraSubLabel(name) {
    return loraSub(name) || "根目錄";
  }

  function renderLoraSelected() {
    const box = $("loraList");
    if (!box) return;
    const items = loraEnabled(S.loras);
    const count = $("loraCount");
    if (count) count.textContent = String(items.length);
    if (!items.length) {
      box.innerHTML = `<p class="lora-empty">還沒套用角色。按上面的「選擇」加入本機 LoRA。</p>`;
      return;
    }
    box.innerHTML = items.map(it => {
      const miss = !loraAvailable(it.name);
      const sug = loraSuggestionCount(it);
      const note = miss
        ? `<span class="lora-note bad">本機已找不到這個模型，生成前請移除</span>`
        : it.noTriggerNeeded
          ? `<span class="lora-note">已確認不需要觸發詞</span>`
          : !it.triggers.length && sug
            ? `<span class="lora-note">有待加入的作者建議 ${sug}</span>`
            : !it.triggers.length
              ? `<span class="lora-note">尚未確認觸發詞</span>`
              : `<span class="lora-note">${it.autoTrigger ? "觸發詞" : "觸發詞（不自動加入）"} ${it.triggers.length}</span>`;
      return `<div class="lora-row${miss ? " missing" : ""}" data-name="${esc(it.name)}">
        <div class="lora-row-top">
          <span class="lora-name" title="${esc(it.name)}">${esc(it.display)}</span>
          <button type="button" class="lora-x" data-lora-act="remove" title="移除這個角色" aria-label="移除 ${esc(it.display)}">×</button>
        </div>
        <span class="lora-sub" title="${esc(it.name)}">${esc(loraSubLabel(it.name))}</span>
        <div class="lora-row-ctl">
          <input type="range" min="${LORA_UI_MIN}" max="${LORA_UI_MAX}" step="0.05" value="${esc(it.strength)}" data-lora-act="strength" aria-label="${esc(it.display)} 權重">
          <input type="number" class="lora-num" min="${-LORA_LIMIT}" max="${LORA_LIMIT}" step="0.05" value="${esc(it.strength.toFixed(2))}" data-lora-act="strength-num" aria-label="${esc(it.display)} 權重數值">
        </div>
        ${note}
      </div>`;
    }).join("");
  }

  function loraOnListInput(e) {
    const act = e.target && e.target.dataset ? e.target.dataset.loraAct : "";
    if (act !== "strength" && act !== "strength-num") return;
    const row = e.target.closest(".lora-row");
    if (!row) return;
    const v = loraWeight(e.target.value);
    if (act === "strength") {
      const num = row.querySelector('[data-lora-act="strength-num"]');
      if (num) num.value = v.toFixed(2);
    } else {
      const rng = row.querySelector('[data-lora-act="strength"]');
      if (rng) rng.value = String(Math.max(LORA_UI_MIN, Math.min(LORA_UI_MAX, v)));
    }
    S.loras = loraSet(S.loras, row.dataset.name, { strength: v });
  }

  function loraOnListChange(e) {
    const act = e.target && e.target.dataset ? e.target.dataset.loraAct : "";
    if (act === "strength" || act === "strength-num") loraSave();
  }

  function loraOnListClick(e) {
    const btn = e.target.closest('[data-lora-act="remove"]');
    if (!btn) return;
    const row = btn.closest(".lora-row");
    if (!row) return;
    const name = row.dataset.name;
    // 移除＝停用並保留權重／觸發詞，之後重新加入不用重設
    S.loras = loraSet(S.loras, name, { enabled: false });
    if (LORA.active && LORA.active.toLowerCase() === name.toLowerCase()) {
      LORA.active = null;
      LORA.editing = -1;
    }
    loraSave();
    renderLoraSelected();
    renderLoraPick();
    renderLoraTriggers();
    toast("已移除角色；你手動輸入的描述沒有被改動", "ok", 3200);
  }

  // 取最新清單；force=true 時即使已載入也重取。回傳 Promise<boolean>
  function refreshLoraList(force) {
    if (loraListReq) return loraListReq;
    if (!force && S.loraListState === "ready") return Promise.resolve(true);
    S.loraListState = "loading";
    S.loraListError = "";
    renderLoraPick();
    loraListReq = fetch("/api/loras", { cache: "no-store" })
      .then(async r => {
        const j = await loraReadJSON(r);
        if (!r.ok || !j || typeof j !== "object" || !j.ok) {
          // 後端有明確 code 時優先用它的白話訊息；沒有時依照 error code 給可理解的指示
          throw new Error((j && j.error) || (j && j.code === "COMFY_OFFLINE"
            ? "ComfyUI 沒有連線。請確認右上角狀態列顯示已連線，再按「重新整理」。"
            : "目前無法讀取 LoRA 清單，請重新整理；如果持續發生，請重新啟動生圖介面後再試。"));
        }
        // 成功的回應必須有 loras 陣列；缺欄位或型別錯誤不可冒充「正常空清單」
        if (!Array.isArray(j.loras)) throw new Error(LORA_FORMAT_ERROR);
        const seen = new Set();
        S.loraList = j.loras
          .filter(x => x && loraNameOk(x.name))
          .map(x => ({
            name: x.name,
            display: String(x.display || loraDisplay(x.name)),
            sub: String(x.sub || loraSub(x.name))
          }))
          .filter(x => {
            const k = x.name.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        S.loraListState = "ready";
        return true;
      })
      .catch(e => {
        S.loraList = [];
        S.loraListState = "error";
        S.loraListError = translateLoraError(e);
        return false;
      })
      .finally(() => {
        loraListReq = null;
        renderLoraSelected();
        renderLoraPick();
      });
    return loraListReq;
  }

  async function verifySelectedLoras() {
    if (!loraEnabled(S.loras).length) return true;
    if (!(await refreshLoraList(true))) {
      toast("讀不到 LoRA 清單。請確認 ComfyUI 已連線（右上角狀態列），再按一次生成。", "warn", 7000);
      return false;
    }
    const missing = loraEnabled(S.loras).filter(l => !loraAvailable(l.name));
    renderLoraSelected();
    if (!missing.length) return true;
    const names = missing.map(l => l.display || loraDisplay(l.name)).join("、");
    toast(`找不到角色 LoRA：${names}。本機可能已刪除，請到右欄「角色 LoRA」移除後再生成。`, "err", 9000);
    return false;
  }

  function openLoraModal() {
    LORA.filter = "";
    $("loraSearch").value = "";
    if (!LORA.active) {
      const first = loraEnabled(S.loras)[0];
      LORA.active = first ? first.name : null;
    }
    renderLoraPick();
    renderLoraTriggers();
    openDialog($("loraModal"), closeLoraModal, $("loraSearch"));
    refreshLoraList(true);
  }

  function closeLoraModal() {
    LORA.editing = -1;
    closeDialog($("loraModal"));
  }

  /* ── LoRA 探索中心（Civitai 公開搜尋）───────────────────── */
  const CV = S.civitai;

  function cvCkptName() { return $("ckpt") ? ($("ckpt").value || "") : ""; }

  function cvTranslate(e) {
    const m = String((e && e.message) || e || "");
    if (/failed to fetch|networkerror|load failed|aborterror/i.test(m))
      return "連不到本機生圖服務，請確認簡單生圖還開著，再按一次「搜尋」。";
    return m || "搜尋失敗，請稍後再試一次。";
  }

  function cvAbort(which) {
    const key = which === "status" ? "statusReq" : "searchReq";
    try { if (CV[key]) CV[key].abort(); } catch (e) { /* ignore */ }
    CV[key] = null;
  }

  function cvLoadStatus(force) {
    const name = cvCkptName();
    if (!force && CV.ckptState === "ready" && CV.ckptName === cvStatusKey(name)) return;
    cvAbort("status");
    const seq = ++CV.statusSeq;
    CV.ckptName = cvStatusKey(name);
    CV.ckptState = "loading";
    CV.ckptError = "";
    renderExplore();
    if (!name) {
      CV.ckptState = "ready";
      CV.ckpt = { name: "", size: null, baseModel: null, confidence: "unknown", source: null, reason: "NO_CHECKPOINT" };
      renderExplore();
      return Promise.resolve();
    }
    const ctrl = new AbortController();
    CV.statusReq = ctrl;
    return fetch("/api/civitai/status?ckpt=" + encodeURIComponent(name),
                 { cache: "no-store", signal: ctrl.signal })
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status));
        return j;
      })
      .then(j => {
        if (seq !== CV.statusSeq) return;
        CV.ckpt = j.checkpoint || null;
        CV.ckptState = "ready";
        CV.ckptError = j.error || "";
        renderExplore();
      })
      .catch(e => {
        if (seq !== CV.statusSeq || (e && e.name === "AbortError")) return;
        CV.ckpt = null;
        CV.ckptState = "error";
        CV.ckptError = cvTranslate(e);
        renderExplore();
      })
      .finally(() => { if (CV.statusReq === ctrl) CV.statusReq = null; });
  }

  function cvOnCkptChange() {
    CV.items = [];
    CV.nextCursor = null;
    CV.state = "idle";
    cvLoadStatus(true);
    renderExplore();
  }

  function cvSearchParams(cursor) {
    const p = new URLSearchParams();
    p.set("q", CV.query.trim());
    p.set("sort", CV.sort);
    p.set("period", CV.period);
    p.set("nsfw", CV.nsfw ? "1" : "0");
    if (cursor) p.set("cursor", cursor);
    return p.toString();
  }

  function cvRunSearch(reset) {
    try { if (CV.debounce) clearTimeout(CV.debounce); } catch (e) { /* ignore */ }
    CV.debounce = null;
    if (!CV.query.trim()) {
      CV.items = []; CV.nextCursor = null; CV.state = "idle"; CV.error = "";
      renderExplore();
      return Promise.resolve();
    }
    if (reset) {
      cvAbort("search");
      CV.items = [];
      CV.nextCursor = null;
      CV.state = "loading";
      CV.error = "";
    } else {
      if (CV.state === "loading" || !CV.nextCursor) return Promise.resolve();
      CV.state = "loading";
      CV.error = "";
    }
    const seq = ++CV.searchSeq;
    const cursor = reset ? "" : CV.nextCursor;
    renderExplore();
    const ctrl = new AbortController();
    CV.searchReq = ctrl;
    return fetch("/api/civitai/search?" + cvSearchParams(cursor),
                 { cache: "no-store", signal: ctrl.signal })
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status));
        return j;
      })
      .then(j => {
        if (seq !== CV.searchSeq) return;
        const more = Array.isArray(j.items) ? j.items : [];
        CV.items = reset ? more : CV.items.concat(more);
        CV.nextCursor = j.nextCursor || null;
        CV.state = "ready";
        renderExplore();
      })
      .catch(e => {
        if (seq !== CV.searchSeq || (e && e.name === "AbortError")) return;
        CV.state = "error";
        CV.error = cvTranslate(e);
        renderExplore();
      })
      .finally(() => { if (CV.searchReq === ctrl) CV.searchReq = null; });
  }

  function cvQueueSearch() {
    try { if (CV.debounce) clearTimeout(CV.debounce); } catch (e) { /* ignore */ }
    CV.debounce = setTimeout(() => cvRunSearch(true), 280);
  }

  function cvOpenModal() {
    cvLoadStatus(true);
    cvKeyRefresh();          // 每次開啟都重新向後端取得 Key 狀態
    openDialog($("exploreModal"), cvCloseModal, $("cvSearch"));
    renderExplore();
  }

  function cvCloseModal() {
    cvAbort("status");
    cvAbort("search");
    try { if (CV.debounce) clearTimeout(CV.debounce); } catch (e) { /* ignore */ }
    CV.debounce = null;
    CV.key.formOpen = false;
    const ki = $("cvKeyInput");
    if (ki) ki.value = "";
    renderKeyUI();
    closeDialog($("exploreModal"));
  }

  /* ── Civitai Personal API Key（只在本機後端保存）──────────── */
  function renderKeyUI() {
    const k = CV.key;
    const status = $("cvKeyStatus"), form = $("cvKeyForm"), input = $("cvKeyInput");
    if (!status || !form) return;
    if (k.state === "loading") status.textContent = "正在讀取 Civitai API Key 狀態…";
    else if (k.configured) {
      status.textContent = "已設定 Civitai API Key" +
        (k.username ? "：" + esc(k.username) + (k.tier ? "（" + esc(k.tier) + "）" : "（尚未測試連線）") : "") +
        (k.error ? " · " + esc(k.error) : "");
    } else status.textContent = "未設定 Civitai API Key（仍可匿名搜尋公開 LoRA）";
    $("cvKeyEdit").hidden = k.formOpen;
    $("cvKeyTest").hidden = !k.configured || k.formOpen;
    $("cvKeyRemove").hidden = !k.configured || k.formOpen;
    form.hidden = !k.formOpen;
    if (input && !k.formOpen) input.value = "";
    const result = $("cvKeyResult");
    if (result) {
      result.hidden = !k.result;
      result.textContent = k.result || "";
      result.className = "cv-key-result" + (k.resultKind ? " " + k.resultKind : "");
    }
    ["cvKeyEdit", "cvKeyTest", "cvKeyRemove", "cvKeySave", "cvKeyCancel"].forEach(id => {
      const b = $(id); if (b) b.disabled = k.busy;
    });
  }

  function cvKeyPost(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SimpleUI": "1" },
      body: body ? JSON.stringify(body) : "{}"
    });
  }

  function cvKeyMsg(r, j) {
    if (j && j.error) return j.error;
    return "操作失敗（HTTP " + r.status + "），請稍後再試一次。";
  }

  function cvKeyRefresh() {
    const k = CV.key;
    k.state = "loading"; renderKeyUI();
    return fetch("/api/civitai/key/status", { cache: "no-store" })
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(cvKeyMsg(r, j));
        return j;
      })
      .then(j => {
        k.configured = !!j.configured;
        k.username = ""; k.tier = ""; k.error = j.error || "";
        k.state = "ready"; renderKeyUI();
      })
      .catch(e => {
        k.state = "error"; k.error = "讀取金鑰狀態失敗，請重新整理。"; renderKeyUI();
      });
  }

  function cvKeySave() {
    const k = CV.key, input = $("cvKeyInput");
    const value = (input && input.value || "").trim();
    if (!value) {
      k.result = "請先貼上你的 Civitai API Key。"; k.resultKind = "err"; renderKeyUI(); return;
    }
    k.busy = true; renderKeyUI();
    return cvKeyPost("/api/civitai/key", { key: value })
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(cvKeyMsg(r, j));
        k.configured = true; k.formOpen = false;
        k.result = "金鑰已儲存，建議按「測試連線」確認。"; k.resultKind = "ok";
      })
      .catch(e => { k.result = e.message || "儲存失敗，請再試一次。"; k.resultKind = "err"; })
      .finally(() => {
        k.busy = false;
        if (input) input.value = "";
        renderKeyUI();
      });
  }

  function cvKeyTest() {
    const k = CV.key;
    k.busy = true; renderKeyUI();
    return cvKeyPost("/api/civitai/key/test")
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(cvKeyMsg(r, j));
        k.username = j.username || ""; k.tier = j.tier || "";
        k.result = "連線成功：" + (k.username || "Civitai 帳號") +
          (k.tier ? "（" + k.tier + "）" : "");
        k.resultKind = "ok";
      })
      .catch(e => { k.result = e.message || "測試失敗，請稍後再試。"; k.resultKind = "err"; })
      .finally(() => { k.busy = false; renderKeyUI(); });
  }

  function cvKeyRemove() {
    const k = CV.key;
    k.busy = true; renderKeyUI();
    return cvKeyPost("/api/civitai/key/remove")
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(cvKeyMsg(r, j));
        k.configured = false; k.username = ""; k.tier = "";
        k.result = "已移除本機金鑰。若要撤銷 Civitai 端授權，請到帳號設定刪除該金鑰。";
        k.resultKind = "ok";
      })
      .catch(e => { k.result = e.message || "移除失敗，請稍後再試。"; k.resultKind = "err"; })
      .finally(() => { k.busy = false; renderKeyUI(); });
  }

  function cvBadge(cls) {
    return `<span class="cv-badge ${esc(cls.key)}">${esc(cls.label)}</span>`;
  }

  function cvCkptBase() {
    return CV.ckpt && CV.ckpt.baseModel ? CV.ckpt.baseModel : null;
  }

  // 圖片 URL 只信任 Civitai 官方圖片 CDN；任何異常直接不顯示，不組裝錯誤 URL。
  function cvImageUrl(raw) {
    if (typeof raw !== "string" || !raw) return "";
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:" || u.hostname.toLowerCase() !== "image.civitai.com") return "";
      if ((u.port && u.port !== "443") || u.username || u.password) return "";
      if (!u.pathname.startsWith("/") || u.pathname.split("/").indexOf("..") >= 0) return "";
      return u.href;
    } catch (e) { return ""; }
  }

  // URL 驗證與成熟內容判斷分離：所有入口都走同一套 cvImageSafety()。
  function cvImageVisible(img, model, showMature) {
    if (!img || !cvImageUrl(img.url)) return false;
    return cvImageSafety(img, model, showMature);
  }

  function cvPickImage(version, model, showMature) {
    const list = (version && version.images) || [];
    for (const img of list) if (cvImageVisible(img, model, showMature)) return img;
    return null;
  }

  function cvPreviewKey(item, version) {
    return String(item.modelId) + "|" + String(version && version.id);
  }

  function cvRenderCard(item, ckptBase) {
    const bestInfo = cvBestVersionInfo(item.versions, ckptBase);
    const best = bestInfo.cls;
    const cls = best ? best.key : "unknown";
    const stats = item.stats || {};
    // 圖片只取自「決定卡片等級的那個版本」，不跨版本混用。
    const cover = cvPickImage(bestInfo.version, item, CV.nsfw);
    const versions = (item.versions || []).map(v => {
      const c = cvClassify(v.baseModel, v.baseModelType, ckptBase);
      const lv = CV_LEVELS.find(x => x.key === c.key) || CV_LEVELS[2];
      const words = (v.trainedWords || []).slice(0, 8).join(", ");
      const f = (v.files || []).find(x => x.primary) || (v.files || [])[0];
      const file = f
        ? `<div class="cv-file">${esc(f.name)} · ${esc(f.format || "未知格式")} · ${esc(Math.round(f.sizeKB || 0).toLocaleString())} KB${f.primary ? " · 主要檔" : ""}</div>`
        : `<div class="cv-file">沒有可讀取的檔案資訊</div>`;
      return `<div class="cv-ver">
        <div class="cv-ver-head">${cvBadge(lv)}<b>${esc(v.name || "未命名版本")}</b></div>
        <div class="cv-meta">基底：${esc(v.baseModel || "未知")}${v.baseModelType ? " · " + esc(v.baseModelType) : ""} · ${esc(lv.label)}</div>
        <div class="cv-meta">${esc(c.reason || "")}</div>
        ${words ? `<div class="cv-words">觸發詞：${esc(words)}</div>` : ""}
        ${file}
        <a class="cv-link" href="${esc(cvVersionUrl(item.modelId, v.id))}" target="_blank" rel="noopener noreferrer">在 Civitai 開啟這個版本 ↗</a>
      </div>`;
    }).join("");
    const thumb = cover
      ? `<button type="button" class="cv-thumb" data-cv-preview="${esc(cvPreviewKey(item, bestInfo.version))}" aria-label="預覽 ${esc(item.name || "模型")} 圖片" title="看預覽圖">
           <span class="cv-thumb-ph">無預覽</span>
           <img src="${esc(cover.thumb || cover.url)}" alt="" width="64" height="80" loading="lazy" decoding="async" data-cv-fallback="${esc(cover.url)}">
         </button>`
      : `<div class="cv-thumb cv-thumb-none"><span class="cv-thumb-ph">無預覽</span></div>`;
    return `<div class="cv-card" data-level="${cls}">
      <div class="cv-card-main">
        ${thumb}
        <div class="cv-card-head">
          <div class="cv-card-title"><b>${esc(item.name || "未命名模型")}</b>
            ${item.nsfw ? `<span class="cv-nsfw">成熟內容</span>` : ""}</div>
          <div class="cv-meta">${esc(item.creator || "未知作者")} · 下載 ${esc(stats.downloadCount || 0)} · 喜歡 ${esc(stats.thumbsUpCount || 0)}</div>
          ${best && best.reason ? `<div class="cv-meta">${esc(best.reason)}</div>` : ""}
        </div>
      </div>
      <div class="cv-vers">${versions}</div>
    </div>`;
  }

  function renderExplore() {
    renderKeyUI();
    const head = $("cvCkptInfo");
    if (head) {
      const c = CV.ckpt;
      if (CV.ckptState === "loading") head.textContent = "正在辨識目前 Checkpoint…";
      else if (CV.ckptState === "error") head.textContent = "Checkpoint 辨識失敗：" + CV.ckptError;
      else if (c && c.baseModel) head.textContent =
        `目前 Checkpoint：${c.name} · 基底 ${c.baseModel}（${c.source === "civitai-exact-file" ? "已精確比對檔案" : "來源不明"}）`;
      else {
        const base = "目前 Checkpoint 基底未知；所有 LoRA 版本最高只能視為需要確認。";
        head.textContent = CV.ckptError ? base + " 辨識失敗原因：" + CV.ckptError : base;
      }
    }
    const goBtn = $("cvGo");
    if (goBtn) goBtn.disabled = CV.state === "loading";
    const moreBtn = $("cvMore");
    if (moreBtn) moreBtn.hidden = !CV.nextCursor || CV.state === "loading";
    const box = $("cvResults");
    if (!box) return;
    if (CV.state === "idle") {
      box.innerHTML = `<p class="lora-empty">輸入關鍵字搜尋 Civitai 的公開 LoRA。結果會依目前 Checkpoint 的適配程度排序，但不會隱藏任何模型。</p>`;
      return;
    }
    if (CV.state === "loading" && !CV.items.length) {
      box.innerHTML = `<p class="lora-empty">正在搜尋 Civitai…</p>`;
      return;
    }
    if (CV.state === "error" && !CV.items.length) {
      box.innerHTML = `<div class="lora-error">${esc(CV.error)}
        <div style="margin-top:6px"><button type="button" class="btn btn-ghost btn-sm" id="cvRetry">重試</button></div></div>`;
      return;
    }
    if (!CV.items.length) {
      box.innerHTML = `<p class="lora-empty">找不到符合的 LoRA。換一個關鍵字，或開啟「顯示成熟內容」再試一次。</p>`;
      return;
    }
    const ckptBase = CV.ckpt && CV.ckpt.baseModel ? CV.ckpt.baseModel : null;
    const sorted = cvSortItems(CV.items, ckptBase);
    const groups = [[], [], [], []];
    sorted.forEach(it => {
      const b = cvBestVersion(it.versions, ckptBase);
      groups[b ? b.level : 2].push(it);
    });
    box.innerHTML = groups.map((list, level) => {
      if (!list.length) return "";
      const lv = CV_LEVELS[level];
      return `<section class="cv-group">
        <h3 class="cv-group-title cv-lv-${lv.key}">${esc(lv.label)}（${list.length}）</h3>
        ${list.map(it => cvRenderCard(it, ckptBase)).join("")}
      </section>`;
    }).join("") + (CV.error ? `<div class="lora-error" style="margin-top:10px">${esc(CV.error)}</div>` : "");
    // 卡片縮圖失敗先退回原圖；原圖也失敗就隱藏，由固定佔位圖接管（不撐動版面）。
    box.querySelectorAll("img[data-cv-fallback]").forEach(img => {
      img.addEventListener("error", function () {
        if (this.dataset.fallbackDone) { this.hidden = true; return; }
        this.dataset.fallbackDone = "1";
        this.src = this.dataset.cvFallback;
      });
    });
  }

  /* ── 模型詳細預覽：沿用通用 Modal / dialogStack，不碰本機圖片燈箱 ── */
  function cvPreviewHtml() {
    return `<div class="cv-pv">
      <div class="cv-pv-stage"><img id="pvMain" class="cv-pv-main" alt="模型預覽圖"></div>
      <div class="cv-pv-info">
        <h3 id="pvName"></h3>
        <p class="cv-meta" id="pvCreator"></p>
        <p class="cv-meta" id="pvVersion"></p>
        <p class="cv-meta" id="pvBase"></p>
        <p id="pvBadge"></p>
        <p class="cv-meta" id="pvReason"></p>
        <p class="cv-words" id="pvWords"></p>
        <p class="cv-meta" id="pvCount"></p>
        <div id="pvStrip" class="cv-pv-strip"></div>
        <div class="modal-foot">
          <a id="pvLink" class="btn btn-soft btn-sm" href="#" target="_blank" rel="noopener noreferrer">在 Civitai 開啟這個版本 ↗</a>
          <button type="button" class="btn btn-ghost" data-close>關閉</button>
        </div>
      </div>
    </div>`;
  }

  function cvPreviewImageError(e) {
    const el = e.target;
    if (!el || !el.dataset) return;
    if (el.dataset.fallbackDone) {
      el.onerror = null; el.removeAttribute("src");
      const stage = el.closest(".cv-pv-stage");
      if (stage) stage.classList.add("failed");
      return;
    }
    el.dataset.fallbackDone = "1";
    el.src = el.dataset.original || "";
  }

  function cvPaintPreview() {
    if (!PV) return;
    const im = PV.images[PV.index];
    if (!im) return;
    const main = $("pvMain");
    if (main) {
      main.onerror = cvPreviewImageError;
      main.dataset.original = im.url;
      main.dataset.fallbackDone = "";
      main.src = im.thumb || im.url;
      main.alt = "預覽圖 " + (PV.index + 1);
      const stage = main.closest(".cv-pv-stage");
      if (stage) stage.classList.remove("failed");
    }
    const strip = $("pvStrip");
    if (strip) strip.innerHTML = PV.images.map((x, i) =>
      `<button type="button" class="cv-pv-thumb${i === PV.index ? " on" : ""}" data-pv-index="${i}" aria-label="第 ${i + 1} 張" aria-pressed="${i === PV.index}"><img src="${esc(x.thumb || x.url)}" alt="" width="48" height="60" loading="lazy" decoding="async" data-cv-fallback="${esc(x.url)}"></button>`).join("");
    const v = PV.version || {};
    const c = PV.cls || {};
    const words = (v.trainedWords || []).slice(0, 8).join(", ");
    if ($("pvName")) $("pvName").textContent = PV.item.name || "未命名模型";
    if ($("pvCreator")) $("pvCreator").textContent = "作者：" + (PV.item.creator || "未知作者");
    if ($("pvVersion")) $("pvVersion").textContent = "版本：" + (v.name || "未命名版本");
    if ($("pvBase")) $("pvBase").textContent = "基底：" + (v.baseModel || "未知") + (v.baseModelType ? " · " + v.baseModelType : "");
    if ($("pvBadge")) $("pvBadge").innerHTML = cvBadge(c);
    if ($("pvReason")) $("pvReason").textContent = c.reason || "";
    if ($("pvWords")) $("pvWords").textContent = words ? "觸發詞：" + words : "";
    if ($("pvCount")) $("pvCount").textContent = "圖片 " + (PV.index + 1) + " / " + PV.images.length;
    const link = $("pvLink");
    if (link) link.href = cvVersionUrl(PV.item.modelId, v.id);
  }

  function cvOpenPreview(key) {
    const parts = String(key || "").split("|");
    const item = (CV.items || []).find(x => String(x.modelId) === parts[0]);
    if (!item) return;
    const version = (item.versions || []).find(v => String(v.id) === parts[1]);
    if (!version) return;
    const images = (version.images || []).filter(im => cvImageVisible(im, item, CV.nsfw)).map(im => {
      const url = cvImageUrl(im.url);
      return { url: url, thumb: cvImageUrl(im.thumb) || url };
    });
    if (!images.length) return;
    PV = { item: item, version: version, cls: cvClassify(version.baseModel, version.baseModelType, cvCkptBase()),
           images: images, index: 0 };
    openModal("模型預覽", cvPreviewHtml());
    const strip = $("pvStrip");
    if (strip) {
      strip.onclick = e => {
        const b = e.target && e.target.closest("[data-pv-index]");
        if (!b || !PV) return;
        const i = Number(b.dataset.pvIndex);
        if (!Number.isInteger(i) || i < 0 || i >= PV.images.length) return;
        PV.index = i;
        cvPaintPreview();
      };
      // 縮圖失敗時退回原圖（同一容器只綁一次，因為 openModal 每次重建 DOM）。
      strip.addEventListener("error", e => {
        const img = e.target;
        if (!img || img.tagName !== "IMG" || img.dataset.fallbackDone) return;
        img.dataset.fallbackDone = "1";
        img.src = img.dataset.cvFallback || "";
      }, true);
    }
    cvPaintPreview();
  }

  function renderLoraPick() {
    const box = $("loraPickList");
    if (!box) return;
    const foot = $("loraFootMeta");
    if (foot) foot.textContent = `已加入 ${loraEnabled(S.loras).length} 個 · 本機 ${S.loraList.length} 個可用`;
    if (S.loraListState === "loading") {
      box.innerHTML = `<p class="lora-empty">正在讀取本機 LoRA…</p>`;
      return;
    }
    if (S.loraListState === "error") {
      box.innerHTML = `<div class="lora-error">${esc(S.loraListError)}
        <div style="margin-top:6px"><button type="button" class="btn btn-ghost btn-sm" data-lora-act="retry">重新整理</button></div></div>`;
      return;
    }
    if (!S.loraList.length) {
      // 只有「API 正常回傳空清單」才會到這裡；錯誤狀態在上面已經 return
      box.innerHTML = `<div class="lora-empty">
        <p>本機還沒有角色 LoRA。可以先到模型平台挑選喜歡的角色模型，再放進 ComfyUI 的 LoRA 資料夾。</p>
        <a class="btn btn-soft btn-sm lora-ext-link" href="https://civitai.com/models?types=LORA" target="_blank" rel="noopener noreferrer">前往 Civitai 挑選 LoRA <span class="lora-ext-mark" aria-hidden="true">↗</span></a>
        <p class="meta">這會開啟外部網站。放好模型後按下面的按鈕重新整理。</p>
        <button type="button" class="btn btn-ghost btn-sm" data-lora-act="retry">重新整理</button>
      </div>`;
      return;
    }
    const q = LORA.filter.trim().toLowerCase();
    const list = q
      ? S.loraList.filter(x => (x.display + " " + x.name + " " + x.sub).toLowerCase().indexOf(q) >= 0)
      : S.loraList;
    if (!list.length) {
      box.innerHTML = `<p class="lora-empty">找不到符合「${esc(LORA.filter.trim())}」的 LoRA。</p>`;
      return;
    }
    box.innerHTML = list.map(x => {
      const it = loraItem(x.name);
      const on = !!(it && it.enabled !== false);
      return `<div class="lora-pick${on ? " on" : ""}" data-name="${esc(x.name)}">
        <button type="button" class="lora-pick-main" data-lora-act="toggle">
          <span class="lora-pick-name">${esc(x.display)}</span>
          <span class="lora-pick-sub">${esc(loraSubLabel(x.name))} · 觸發詞 ${it ? it.triggers.length : 0}</span>
        </button>
        <span class="lora-pick-state">${on ? "已加入" : "加入"}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-lora-act="triggers">觸發詞</button>
      </div>`;
    }).join("");
  }

  function loraAuthor(name) {
    const it = loraItem(name);
    return loraParseAuthor(it && it.authorSuggestions);
  }

  function loraSetLocalGroups(name, groups) {
    const it = loraItem(name);
    if (!it) return;
    const next = loraNormGroups([Array.isArray(groups) ? groups : []]);
    if (JSON.stringify(it.authorSuggestions.local.groups) === JSON.stringify(next)) return;
    S.loras = loraSet(S.loras, name, { authorSuggestions: {
      local: { groups: next }, civitai: it.authorSuggestions.civitai
    }});
    loraSave();
  }

  function loraRenderAuthorGroups(groups, src) {
    if (!groups.length) return `<p class="lora-empty">這個來源沒有提供建議詞。</p>`;
    return groups.map((words, gi) => {
      const shown = words.slice(0, 20);
      return `<div class="lora-group">
        <div class="lora-group-head"><b>建議 ${gi + 1}（${words.length}）</b>
          <button type="button" class="btn btn-ghost btn-sm" data-lora-act="add-group" data-src="${src}" data-g="${gi}">整組加入</button>
        </div>
        <div class="lora-group-words">${shown.map((w, wi) =>
          `<button type="button" class="lora-word" data-lora-act="add-word" data-src="${src}" data-g="${gi}" data-w="${wi}" title="加入這個詞">${esc(w)} +</button>`
        ).join("")}${words.length > shown.length ? `<span class="lora-status">…還有 ${words.length - shown.length} 個</span>` : ""}</div>
      </div>`;
    }).join("");
  }

  function renderLoraTriggers(keepInput) {
    const box = $("loraTrigPanel");
    if (!box) return;
    const prev = keepInput && $("loraTrigInput") ? $("loraTrigInput").value : "";
    const it = LORA.active ? loraItem(LORA.active) : null;
    if (!it) {
      box.innerHTML = `<p class="lora-empty">選一個 LoRA（按右邊的「觸發詞」）就能管理它的觸發詞。</p>`;
      return;
    }
    const author = loraAuthor(it.name);
    const m = S.loraMeta[it.name];

    // 個人 Trigger Words：唯一會注入 Prompt 的來源
    const chips = it.triggers.length
      ? it.triggers.map((t, i) => `<span class="lora-trig-chip">
          <button type="button" data-lora-act="edit-trig" data-i="${i}" title="編輯">${esc(t)}</button>
          <button type="button" data-lora-act="del-trig" data-i="${i}" title="移除" aria-label="移除 ${esc(t)}">×</button>
        </span>`).join("")
      : `<p class="lora-empty">還沒有我的觸發詞。可以自己新增，或從下方建議詞加入。</p>`;
    const personal = `
      <section class="lora-section lora-personal">
        <h3 class="lora-section-title">我的觸發詞（只有這裡的詞會自動加入提示詞）</h3>
        <label class="switch-row">
          <input type="checkbox" id="loraAuto" ${it.autoTrigger ? "checked" : ""}>
          <span class="switch-ui" aria-hidden="true"></span>
          <span class="switch-text">自動加入提示詞<small>${it.autoTrigger ? "目前會加在描述最後面" : "目前不會自動加入提示詞"}</small></span>
        </label>
        <div class="lora-trig-input">
          <input id="loraTrigInput" type="text" placeholder="輸入觸發詞，逗號分隔可一次加多個" autocomplete="off">
          <button type="button" class="btn btn-ghost btn-sm" id="loraTrigSave">${LORA.editing >= 0 ? "更新" : "新增"}</button>
        </div>
        <div class="lora-trig-chips">${chips}</div>
        <button type="button" class="btn btn-ghost btn-sm" data-lora-act="no-trigger">${it.noTriggerNeeded ? "取消「不需要觸發詞」" : "這個模型不需要觸發詞"}</button>
        <p class="meta">${it.noTriggerNeeded
          ? "已確認不需要，生圖前不再提醒；加入任何我的觸發詞會自動取消這個確認。"
          : "還沒確認需不需要。建議詞只是參考，加入後才會生效。"}</p>
      </section>`;

    // 從模型檔案讀取的建議詞（與 Civitai 分開）
    let localHtml;
    if (!m || m.state === "loading") localHtml = `<p class="lora-status">讀取模型資訊…</p>`;
    else if (m.state === "error") localHtml = `<p class="lora-status bad">讀不到本機模型資訊：${esc(m.error || "")}</p>`;
    else if (m.state === "none") localHtml = `<p class="lora-status">這個來源沒有提供建議詞：沒有可讀取的資料，請手動新增。</p>`;
    else {
      const bits = [];
      if (m.meta.architecture) bits.push(m.meta.architecture);
      if (m.meta.networkDim) bits.push("dim " + m.meta.networkDim);
      if (m.meta.resolution) bits.push(m.meta.resolution);
      localHtml = `<p class="lora-status">${esc(bits.join(" · ") || "模型資訊")}</p>` +
        loraRenderAuthorGroups(author.local.groups, "local") +
        (author.local.groups.length
          ? `<button type="button" class="btn btn-ghost btn-sm" data-lora-act="use-meta">全部加入我的觸發詞</button>` : "");
    }

    // Civitai 指定版本建議
    const cv = author.civitai;
    const cs = S.loraCiv[it.name];
    const cvLoading = !!(cs && cs.state === "loading");
    let cvStatus;
    if (!cv.versionId) {
      cvStatus = `<p class="lora-status">還沒選版本。把下面網址貼進來，按「讀取建議」即可。</p>`;
    } else {
      const bits = ["來源：Civitai", "已選版本：" + cv.versionId];
      if (cv.fetchedAt) bits.push("上次取得：" + new Date(cv.fetchedAt).toLocaleString());
      if (cvLoading) bits.push("正在讀取，請稍候…");
      else if (cs && cs.state === "error") bits.push("取得失敗：" + cs.error + (cs.hadData ? "（仍顯示先前已取得的建議）" : ""));
      else if (cs && cs.changed) bits.push("作者建議已更新");
      else if (cs && cs.state === "ready" && !cv.groups.length) bits.push("這個版本沒有提供建議詞");
      if (cs && cs.warning) bits.push(cs.warning);
      cvStatus = `<p class="lora-status${cs && cs.state === "error" ? " bad" : ""}">${esc(bits.join(" · "))}</p>`;
    }
    const civitai = `
      <section class="lora-section">
        <h3 class="lora-section-title">Civitai 作者提供的建議詞</h3>
        <p class="meta">這是選用功能，不知道怎麼設定可以直接略過，不影響生圖。</p>
        <div class="lora-cv-help">
          <p class="meta">到模型網站找到你下載的模型，選「跟你下載的檔案相同的版本」，複製該版本的頁面網址貼在下面。選錯版本，建議詞可能不適用。</p>
          <p class="meta lora-cv-example">網址長這樣：https://civitai.com/models/2898222?modelVersionId=3276795</p>
        </div>
        <div class="lora-cv-link">
          <input id="loraCvId" type="text" placeholder="貼上版本頁面網址（也可以只貼數字）" autocomplete="off" value="${esc(cvInputs[it.name] || "")}">
          <button type="button" class="btn btn-ghost btn-sm" data-lora-act="cv-link" ${cvLoading ? "disabled" : ""}>${cv.versionId ? "重新讀取" : "讀取建議"}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-lora-act="cv-unlink" ${cv.versionId ? "" : "disabled"}>取消版本連結</button>
        </div>
        <p class="meta">取消版本連結只會移除作者建議來源，不會刪除你自己的觸發詞，也不影響生圖。</p>
        ${cvStatus}
        ${cv.versionId ? loraRenderAuthorGroups(cv.groups, "civitai") : ""}
      </section>`;

    box.innerHTML = `
      <div class="lora-trig-head">
        <b>${esc(it.display)}</b>
        <span class="lora-pick-state">${it.enabled === false ? "未加入" : "已加入"}</span>
      </div>
      ${personal}
      <section class="lora-section">
        <h3 class="lora-section-title">從模型檔案讀取的建議詞</h3>
        ${localHtml}
      </section>
      ${civitai}`;
    if (LORA.editing >= 0 && it.triggers[LORA.editing] != null) {
      $("loraTrigInput").value = it.triggers[LORA.editing];
    } else if (prev) {
      $("loraTrigInput").value = prev;
    }
    if (!m) loadLoraMeta(it.name);
    if (cv.versionId && !S.loraCiv[it.name]) loadCivMeta(it.name);
  }

  function loadLoraMeta(name) {
    if (!name || S.loraMeta[name]) return;
    S.loraMeta[name] = { state: "loading" };
    fetch("/api/lora-meta?name=" + encodeURIComponent(name), { cache: "no-store" })
      .then(async r => {
        const j = await loraReadJSON(r);
        if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status));
        S.loraMeta[name] = j.meta
          ? { state: "ready", meta: j.meta }
          : { state: "none", error: j.error || "" };
        loraSetLocalGroups(name, j.meta && j.meta.triggerWords);
      })
      .catch(e => { S.loraMeta[name] = { state: "error", error: translateLoraError(e) }; })
      .finally(() => {
        if (LORA.active === name && !$("loraModal").hidden) renderLoraTriggers(true);
      });
  }

  // 匿名公開端點：不帶 Bearer、不讀 API Key；失敗只更新暫時狀態，不清掉既有建議
  function loadCivMeta(name) {
    const it = loraItem(name);
    if (!it) return;
    const vid = it.authorSuggestions.civitai.versionId;
    if (!vid) return;
    // 防重複：同一 LoRA 同一版本已有進行中的請求就不再重複發送；
    // 已完成或失敗後 pending 會被清掉，不阻止使用者重新讀取。
    const pending = civReqPending[name];
    if (pending && pending.vid === vid) return;
    // 同一版本重新讀取時，先記得是否已有成功資料；失敗時仍保留舊建議
    const hadData = it.authorSuggestions.civitai.groups.length > 0;
    // 每次真正發起請求分配遞增序號；只有序號仍是最新的回應才允許更新狀態。
    // 不只比對 versionId：取消後重新連結相同版本是不同操作，舊請求不得污染新操作。
    const seq = (civReqSeq[name] = (civReqSeq[name] || 0) + 1);
    civReqPending[name] = { vid, seq };
    S.loraCiv[name] = { state: "loading", hadData };
    // 立刻反映「讀取中」並禁用按鈕，避免使用者重複點擊 / 測試誤判為可重試
    if (LORA.active === name && !$("loraModal").hidden) renderLoraTriggers(true);
    fetch("/api/civitai/version?id=" + encodeURIComponent(vid), { cache: "no-store" })
      .then(async r => {
        const j = await loraReadJSON(r);
        if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status));
        return j;
      })
      .then(j => {
        // 過期請求（版本已變、已取消、或同版本的新操作已開始）一律丟棄
        if (civReqSeq[name] !== seq) return;
        const cur = loraItem(name);
        if (!cur || cur.authorSuggestions.civitai.versionId !== vid) return;
        const v = j.version || {};
        const groups = loraNormGroups(v.groups);
        const fingerprint = String(v.fingerprint || "");
        const fetchedAt = Number(v.fetchedAt) || Date.now();
        const changed = !!cur.authorSuggestions.civitai.fingerprint &&
          cur.authorSuggestions.civitai.fingerprint !== fingerprint;
        // 只更新作者建議；個人 triggers / noTriggerNeeded / 本機建議完全不變
        S.loras = loraSet(S.loras, name, { authorSuggestions: {
          local: cur.authorSuggestions.local,
          civitai: { versionId: vid, groups, fetchedAt, fingerprint }
        }});
        loraSave();
        S.loraCiv[name] = { state: "ready", changed, warning: v.warning || "", hadData: groups.length > 0 };
      })
      .catch(e => {
        // 過期請求的失敗不可覆蓋新版本的狀態（成功路徑已有同樣檢查）
        if (civReqSeq[name] !== seq) return;
        const cur = loraItem(name);
        if (!cur || cur.authorSuggestions.civitai.versionId !== vid) return;
        S.loraCiv[name] = { state: "error", error: cvTranslate(e), hadData };
      })
      .finally(() => {
        // 只清自己那筆進行中請求；過期請求不重繪、不覆蓋新操作的狀態
        if (civReqPending[name] && civReqPending[name].seq === seq) delete civReqPending[name];
        if (civReqSeq[name] !== seq) return;
        if (LORA.active === name && !$("loraModal").hidden) renderLoraTriggers(true);
      });
  }

  function loraParseCvId(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    const m = s.match(/modelVersionId=(\d+)/i) || s.match(/^(\d+)$/);
    if (!m) return null;
    const id = Number(m[1]);
    return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
  }

  function loraAddAuthorWords(name, words, label) {
    const it = loraItem(name);
    if (!it) return;
    if (!loraCleanTriggerList(words).length) { toast("這個群組沒有可加入的詞", "warn"); return; }
    const plan = loraAddPlan(it.triggers, words);
    if (!plan.added) {
      toast(plan.room === 0 && plan.skipped > 0
        ? `我的觸發詞已滿（${LORA_MAX_TRIGGERS} 個），請先移除一些再加入`
        : "這些詞已經在我的觸發詞裡", "warn");
      return;
    }
    S.loras = loraSet(S.loras, name, {
      triggers: plan.next,
      noTriggerNeeded: false
    });
    loraSave();
    renderLoraSelected();
    renderLoraPick();
    renderLoraTriggers();
    const tail = plan.skipped > 0
      ? `，還有 ${plan.skipped} 個沒加入（已滿 ${LORA_MAX_TRIGGERS} 個）` : "";
    toast(`已加入 ${plan.added} 個觸發詞${label ? "（" + label + "）" : ""}${tail}`,
      plan.skipped > 0 ? "warn" : "ok", plan.skipped > 0 ? 5500 : 2200);
  }

  function loraLinkCv() {
    const it = LORA.active ? loraItem(LORA.active) : null;
    const input = $("loraCvId");
    if (!it || !input) return;
    if (S.loraCiv[it.name] && S.loraCiv[it.name].state === "loading") return;
    const raw = String(input.value || "").trim();
    const parsed = loraParseCvId(raw);
    const prev = it.authorSuggestions.civitai;
    // 只有「輸入框空白」才用已選版本直接重試；有輸入但格式不對要清楚提示且保留原文
    const id = parsed || (!raw ? prev.versionId : null);
    if (!id) {
      toast("請貼上模型頁面的網址，或只貼版本頁面上那一串數字", "warn");
      return;
    }
    cvInputs[it.name] = parsed ? input.value : (cvInputs[it.name] || String(id));
    const same = prev.versionId === id;
    S.loras = loraSet(S.loras, it.name, { authorSuggestions: {
      local: it.authorSuggestions.local,
      // 同一版本重新讀取：保留先前成功取得的建議，直到新資料回來
      civitai: {
        versionId: id,
        groups: same ? prev.groups : [],
        fetchedAt: same ? prev.fetchedAt : null,
        fingerprint: same ? prev.fingerprint : null
      }
    }});
    loraSave();
    renderLoraSelected();
    renderLoraTriggers();
    loadCivMeta(it.name);
    toast(same ? "正在更新這個版本的建議詞…" : "已選好版本，正在讀取建議詞", "ok", 2000);
  }

  function loraOnPickClick(e) {
    const t = e.target.closest("[data-lora-act]");
    if (!t) return;
    const act = t.dataset.loraAct;
    if (act === "retry") { refreshLoraList(true); return; }
    const row = t.closest(".lora-pick");
    if (!row) return;
    const name = row.dataset.name;
    if (act === "toggle") {
      const cur = loraItem(name);
      const on = !(cur && cur.enabled !== false);
      const info = loraInfo(name);
      S.loras = loraSet(S.loras, name, {
        enabled: on,
        display: info ? info.display : loraDisplay(name)
      });
      LORA.active = name;
      LORA.editing = -1;
      loraSave();
      renderLoraSelected();
      renderLoraPick();
      renderLoraTriggers();
    } else if (act === "triggers") {
      LORA.active = name;
      LORA.editing = -1;
      renderLoraTriggers();
    }
  }

  function loraOnPickInput() {
    LORA.filter = $("loraSearch").value;
    renderLoraPick();
  }

  function loraSaveTriggerInput() {
    const it = LORA.active ? loraItem(LORA.active) : null;
    const input = $("loraTrigInput");
    if (!it || !input) return;
    const parts = loraCleanTriggers(String(input.value || "").split(/[,\r\n]+/));
    if (!parts.length) { toast("請先輸入觸發詞", "warn"); return; }
    const next = it.triggers.slice();
    if (LORA.editing >= 0 && LORA.editing < next.length) next.splice(LORA.editing, 1, ...parts);
    else next.push(...parts);
    S.loras = loraSet(S.loras, it.name, { triggers: next, noTriggerNeeded: false });
    LORA.editing = -1;
    loraSave();
    renderLoraSelected();
    renderLoraPick();
    renderLoraTriggers();
    toast("已更新觸發詞", "ok", 2000);
  }

  function loraOnTriggersClick(e) {
    const t = e.target.closest("[data-lora-act]");
    if (!t) return;
    const it = LORA.active ? loraItem(LORA.active) : null;
    if (!it) return;
    const act = t.dataset.loraAct;
    if (act === "del-trig") {
      const idx = Number(t.dataset.i);
      if (!Number.isInteger(idx) || idx < 0 || idx >= it.triggers.length) return;
      const next = it.triggers.slice();
      next.splice(idx, 1);
      // 刪除個人詞不得自動設成「不需要」
      S.loras = loraSet(S.loras, it.name, { triggers: next });
      LORA.editing = -1;
      loraSave();
      renderLoraSelected();
      renderLoraPick();
      renderLoraTriggers();
    } else if (act === "edit-trig") {
      const idx = Number(t.dataset.i);
      if (!Number.isInteger(idx) || idx < 0 || idx >= it.triggers.length) return;
      LORA.editing = idx;
      renderLoraTriggers();
      const input = $("loraTrigInput");
      if (input) {
        input.focus();
        try { input.setSelectionRange(input.value.length, input.value.length); } catch (err) { /* ignore */ }
      }
    } else if (act === "use-meta") {
      const groups = it.authorSuggestions.local.groups;
      loraAddAuthorWords(it.name, groups.reduce((a, g) => a.concat(g), []));
    } else if (act === "add-group" || act === "add-word") {
      const src = t.dataset.src === "civitai" ? "civitai" : "local";
      const gi = Number(t.dataset.g);
      const groups = it.authorSuggestions[src].groups;
      if (!Number.isInteger(gi) || gi < 0 || gi >= groups.length) return;
      if (act === "add-group") loraAddAuthorWords(it.name, groups[gi], "整組");
      else {
        const wi = Number(t.dataset.w);
        if (!Number.isInteger(wi) || wi < 0 || wi >= groups[gi].length) return;
        loraAddAuthorWords(it.name, [groups[gi][wi]], "逐詞");
      }
    } else if (act === "no-trigger") {
      S.loras = loraSet(S.loras, it.name, { noTriggerNeeded: !it.noTriggerNeeded });
      loraSave();
      renderLoraSelected();
      renderLoraTriggers();
    } else if (act === "cv-link") {
      loraLinkCv();
    } else if (act === "cv-unlink") {
      S.loras = loraSet(S.loras, it.name, { authorSuggestions: {
        local: it.authorSuggestions.local,
        civitai: { versionId: null, groups: [], fetchedAt: null, fingerprint: null }
      }});
      delete S.loraCiv[it.name];
      delete cvInputs[it.name];
      // 取消連結：讓讀取中的舊請求失效（不論成功或失敗都不可回頭覆蓋），並解除防重複，
      // 之後重新連結（包含同一版本）算是全新操作。不動個人觸發詞與本機建議。
      civReqSeq[it.name] = (civReqSeq[it.name] || 0) + 1;
      delete civReqPending[it.name];
      loraSave();
      renderLoraSelected();
      renderLoraTriggers();
      toast("已取消版本連結；你自己的觸發詞都還在", "ok", 3000);
    }
  }

  function loraOnTriggersChange(e) {
    if (!e.target || e.target.id !== "loraAuto") return;
    const it = LORA.active ? loraItem(LORA.active) : null;
    if (!it) return;
    S.loras = loraSet(S.loras, it.name, { autoTrigger: e.target.checked });
    loraSave();
    renderLoraSelected();
    renderLoraPick();
  }

  function loraOnTriggersKey(e) {
    if (e.key === "Enter" && e.target && e.target.id === "loraTrigInput") {
      e.preventDefault();
      loraSaveTriggerInput();
    } else if (e.key === "Enter" && e.target && e.target.id === "loraCvId") {
      e.preventDefault();
      loraLinkCv();
    } else if (e.key === "Escape" && LORA.editing >= 0) {
      LORA.editing = -1;
      renderLoraTriggers();
    }
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
    const skippedTags = [];
    (picked || []).forEach(raw => {
      if (typeof raw !== "string" && typeof raw !== "number") return;
      const name = String(raw).replace(/_/g, " ").trim();
      if (!name) return;
      const k = normKey(name);
      if (!k) return;
      if (have.has(k)) { skipped++; skippedTags.push(name); return; }
      have.add(k);   // 同一批 picked 中重複的正規化標籤只處理一次
      const lib = resolve ? resolve(name) : null;
      if (lib) {
        const libKey = normKey(lib);
        if (libKey !== k && have.has(libKey)) { skipped++; skippedTags.push(name); return; }
        have.add(libKey);
        toBottom.push(lib);
      } else toExtra.push(name);
    });
    return { toBottom: toBottom, toExtra: toExtra, skipped: skipped, skippedTags: skippedTags };
  }

  function rvBuildApplyPlan(picked, selected, posText, resolve) {
    const split = rvSplitPicked(picked, selected, posText, resolve);
    const extra = rvMergePrompt(posText, split.toExtra, []);
    return { ...split, extraText: extra.text, extraAdded: extra.added };
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
    const plan = rvBuildApplyPlan(Array.from(RV.picked), window.Tags.selected(), $("pos").value || "",
      name => window.Tags.matchTag(name));
    const preview = $("rvApplyPreviewBody");
    if (preview) {
      const list = values => values.length
        ? `<ul>${values.map(v => `<li>${esc(v)}</li>`).join("")}</ul>`
        : '<p class="meta">（沒有）</p>';
      const changed = plan.toBottom.length + plan.extraAdded;
      preview.innerHTML = changed
        ? `<section><h4>準備新增至標籤列 · ${plan.toBottom.length}</h4>${list(plan.toBottom)}</section>
           <section><h4>準備新增至補充描述 · ${plan.extraAdded}</h4>${list(plan.toExtra)}</section>
           <section><h4>已存在、將略過 · ${plan.skipped}</h4>${list(plan.skippedTags)}</section>`
        : `<p role="status">沒有可新增內容。${plan.skipped ? `已選內容都已存在，將略過 ${plan.skipped} 個。` : "選取標籤後，這裡會顯示實際寫入位置。"}</p>
           <section><h4>已存在、將略過 · ${plan.skipped}</h4>${list(plan.skippedTags)}</section>`;
    }
    // 尚未選取時停用加入按鈕，避免空操作；選取後才允許送入提示詞。
    $("revApply").disabled = n === 0;
    $("revApply").classList.toggle("dim", n === 0);
    $("revApply").title = n === 0 ? "請先點選想加入的標籤" : "";
    $("revApply").textContent = "加入目前提示詞（" + n + "）";
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
      split = rvBuildApplyPlan(Array.from(RV.picked), window.Tags.selected(), posBefore,
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
      if (split.extraAdded) {
        $("pos").value = split.extraText;
        try { localStorage.setItem("ui.extra", split.extraText); } catch (e) { /* 無痕模式 */ }
        addedExtra = split.extraAdded;
        updateWarn();
      }
    }
    if (!addedBottom) syncGo();   // 底部路徑已由 tags:change 觸發，避免重複更新
    // RV.picked 故意不清空：使用者可以再檢查、調整，或用「清空暫存」自行清除
    closeReverse();
    const total = addedBottom + addedExtra;
    if (total) {
      toast("已加入目前提示詞：" + total + " 個標籤（底部 " + addedBottom + "、補充描述 " + addedExtra + "）" +
        (split.skipped ? "，略過 " + split.skipped + " 個重複" : ""), "ok");
    } else {
      toast("目前提示詞已包含所選標籤，沒有新增內容", "warn");
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
    $("ckpt").onchange = () => { persistSettings(); cvOnCkptChange(); };

    // LoRA 探索中心
    $("btnLoraExplore").onclick = cvOpenModal;
    $("exploreClose").onclick = cvCloseModal;
    $("cvKeyEdit").onclick = () => {
      CV.key.formOpen = true; CV.key.result = ""; CV.key.resultKind = "";
      renderKeyUI();
      const i = $("cvKeyInput"); if (i) i.focus();
    };
    $("cvKeyCancel").onclick = () => {
      CV.key.formOpen = false;
      const i = $("cvKeyInput"); if (i) i.value = "";
      renderKeyUI();
    };
    $("cvKeySave").onclick = cvKeySave;
    $("cvKeyTest").onclick = cvKeyTest;
    $("cvKeyRemove").onclick = cvKeyRemove;
    $("exploreModal").onclick = e => {
      if (e.target.id === "exploreModal" || e.target.closest("[data-close]")) cvCloseModal();
    };
    $("cvGo").onclick = () => cvRunSearch(true);
    $("cvMore").onclick = () => cvRunSearch(false);
    $("cvSearch").addEventListener("input", () => {
      CV.query = $("cvSearch").value;
      cvQueueSearch();
    });
    $("cvSearch").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); cvRunSearch(true); }
    });
    $("cvSort").onchange = () => { CV.sort = $("cvSort").value; cvRunSearch(true); };
    $("cvPeriod").onchange = () => { CV.period = $("cvPeriod").value; cvRunSearch(true); };
    $("cvNsfw").onchange = () => { CV.nsfw = !!$("cvNsfw").checked; cvRunSearch(true); };
    $("cvResults").addEventListener("click", e => {
      if (e.target && e.target.id === "cvRetry") { cvRunSearch(true); return; }
      const pv = e.target && e.target.closest("[data-cv-preview]");
      if (pv) cvOpenPreview(pv.dataset.cvPreview);
    });

    // 角色 LoRA：選取清單在主畫面，搜尋／觸發詞在視窗
    renderLoraSelected();
    $("btnLoraPick").onclick = openLoraModal;
    $("loraClose").onclick = closeLoraModal;
    $("loraModal").onclick = e => { if (e.target.id === "loraModal" || e.target.closest("[data-close]")) closeLoraModal(); };
    $("loraSearch").addEventListener("input", loraOnPickInput);
    $("loraPickList").addEventListener("click", loraOnPickClick);
    $("loraList").addEventListener("input", loraOnListInput);
    $("loraList").addEventListener("change", loraOnListChange);
    $("loraList").addEventListener("click", loraOnListClick);
    $("loraTrigPanel").addEventListener("click", loraOnTriggersClick);
    $("loraTrigPanel").addEventListener("change", loraOnTriggersChange);
    $("loraTrigPanel").addEventListener("keydown", loraOnTriggersKey);
    $("loraBackupNotice").addEventListener("click", e => {
      const restore = e.target.closest("[data-backup-restore]");
      if (restore) { confirmLoraBackup(restore.dataset.backupRestore, true); return; }
      const b = e.target.closest("[data-backup-confirm]");
      if (b) confirmLoraBackup(b.dataset.backupConfirm, false);
    });
    $("loraTrigPanel").addEventListener("click", e => {
      if (e.target && e.target.id === "loraTrigSave") loraSaveTriggerInput();
    });
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
        toast(S.outError || "尚未設定輸出資料夾，請到右欄輸出設定指定", "warn", 5000);
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
    $("btnSetOutput").onclick = openOutputDirModal;

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
        if (a === "prompt") reuseTextPrompt(it);
        if (a === "restore") reusePrompt(it);
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
    $("lbPrompt").onclick = () => { reuseTextPrompt(S.lbList[S.lbIndex]); closeLightbox(); };
    $("lbRestore").onclick = () => { reusePrompt(S.lbList[S.lbIndex]); closeLightbox(); };
    $("lbApply").onclick = () => caOpen(S.lbList[S.lbIndex]);

    // 視窗
    $("modalClose").onclick = closeModal;
    $("modal").onclick = e => {
      if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal();
    };
    // 分類套用：事件委派，重繪預覽後不需要重新綁定。
    $("modalBody").addEventListener("click", caOnClick);
    $("modalBody").addEventListener("change", caOnChange);
    $("modalBody").addEventListener("input", caOnInput);

    // 進階設定：行內收合，記住展開狀態
    const advBox = $("advBox");
    try { advBox.open = localStorage.getItem("ui.advOpen") === "1"; } catch (e) { /* ignore */ }
    window.Tags.refresh();
    advBox.addEventListener("toggle", () => {
      try { localStorage.setItem("ui.advOpen", advBox.open ? "1" : "0"); } catch (e) { /* ignore */ }
      if (window.Tags && typeof window.Tags.refresh === "function") window.Tags.refresh();
    });
    renderLoraBackupNotice();
    const startupBackups = window.LoraMigration.parseBackup(localStorage);
    if (startupBackups.error) toast(startupBackups.error.message, "err", 6500);
    else {
      const count = startupBackups.value.backups.filter(x => x && x.status === "pending").length;
      if (count) toast(`有 ${count} 筆 LoRA 遷移備份待確認；可在角色 LoRA 區查看狀態。`, "warn", 7000);
    }
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
