/* PromptModel v2 and the single PromptComposer entry point. */
(function (root) {
  "use strict";

  const QUALITY_WORDS = [
    "masterpiece", "best quality", "amazing quality", "very aesthetic", "absurdres",
    "ultra-detailed", "8k", "clean sharp lines", "sharp digital rendering",
    "delicate rendering", "high resolution digital illustration"
  ];
  const POSITIVE_KINDS = new Set(["tag", "lora-trigger", "freetext", "quality"]);
  const ORIGINS = new Set(["tag-db", "author-local", "author-civitai", "wd14", "freetext", "manual", "default"]);
  const normalizeText = value => String(value || "").normalize("NFKC").toLowerCase().trim().replace(/[_\s]+/g, " ");
  const promptText = value => String(value == null ? "" : value).replace(/_/g, " ").trim();
  let nextId = 0;
  const id = () => "p" + (++nextId).toString(36) + "-" + Date.now().toString(36);

  function entry(kind, owner, origin, text, weight, order, extra) {
    return Object.assign({
      id: id(), kind, owner, origin, text: String(text == null ? "" : text),
      weight: kind === "tag" ? (Number.isFinite(Number(weight)) ? Number(weight) : 1) : null,
      order, lora: null, disabled: false, raw: null, translated: [], untranslated: [],
      fragments: [], adoptionId: null
    }, extra || {});
  }

  function translateWithFragments(raw, dict) {
    const source = String(raw == null ? "" : raw);
    const fragments = [];
    source.split(/[，、；;\n]+/).forEach(seg => {
      const rawPart = seg.trim();
      if (!rawPart) return;
      const translatedText = String(dict && dict.tr ? dict.tr(rawPart) : rawPart).trim();
      const untranslated = dict && dict.leftover ? dict.leftover(rawPart) : [];
      const missing = Array.isArray(untranslated) ? untranslated.slice() : [];
      fragments.push({ raw: rawPart, translated: translatedText ? translatedText.split(/,\s*/) : [], untranslated: missing });
    });
    return fragments.map(f => ({
      raw: f.raw,
      translated: f.translated.slice(),
      untranslated: f.untranslated.slice(),
      text: f.translated.join(", "),
      fragments: [{ raw: f.raw, translated: f.translated.slice(), untranslated: f.untranslated.slice() }]
    }));
  }

  function derivePromptModel(state, deps) {
    const s = state || {}, d = deps || {};
    const positive = [];
    let order = 0;
    (Array.isArray(s.sel) ? s.sel : []).forEach(item => {
      if (!item || typeof item !== "object") return;
      positive.push(entry("tag", "user", "tag-db", promptText(item.t), item.w, order++));
    });
    translateWithFragments(s.extra, d.Dict).forEach(part => {
      positive.push(entry("freetext", "user", "freetext", part.text, null, order++, {
        raw: part.raw, translated: part.translated, untranslated: part.untranslated,
        fragments: part.fragments
      }));
    });
    (Array.isArray(s.loras) ? s.loras : []).forEach(lora => {
      if (!lora || lora.enabled === false) return;
      const words = Array.isArray(lora.personalTriggers) ? lora.personalTriggers
        : (Array.isArray(lora.triggers) ? lora.triggers : []);
      words.forEach(word => {
        const text = promptText(word);
        if (!text) return;
        positive.push(entry("lora-trigger", "user", "manual", text, null, order++, {
          lora: String(lora.name || ""), disabled: lora.autoTrigger === false
        }));
      });
    });
    if (s.qualityTags === true) {
      QUALITY_WORDS.slice(0, 3).forEach((word, i) => positive.push(
        entry("quality", "system", "default", word, null, i, { disabled: false })
      ));
    }
    // Quality is a stable prefix, followed by tags, freetext blocks, then LoRA triggers.
    const tags = positive.filter(x => x.kind === "tag");
    const free = positive.filter(x => x.kind === "freetext");
    const loras = positive.filter(x => x.kind === "lora-trigger");
    const quality = positive.filter(x => x.kind === "quality");
    let n = 0;
    quality.forEach(x => { x.order = n++; });
    tags.forEach(x => { x.order = n++; });
    free.forEach(x => { x.order = n++; });
    loras.forEach(x => { x.order = n++; });
    return { v: 2, qualityTags: s.qualityTags === true, positive, negativeRaw: String(s.negativeRaw == null ? "" : s.negativeRaw) };
  }

  function parseNegative(raw, defaultNegative) {
    const source = String(raw == null ? "" : raw);
    const origin = source === String(defaultNegative == null ? "" : defaultNegative) ? "default" : "manual";
    const owner = origin === "default" ? "system" : "user";
    const negativeEntries = [], unparsed = [], seen = new Set(), effectiveNegative = [];
    source.split(/[\r\n,]+/).forEach(tokenRaw => {
      const token = tokenRaw.trim();
      if (!token) return;
      const match = token.match(/^\((.+):([0-9]+(?:\.[0-9]+)?)\)$/);
      const text = promptText(match ? match[1] : token);
      const weight = match ? Number(match[2]) : null;
      const suspicious = !match && (/^[([]/.test(token) || /:[^)]*\)$/.test(token));
      const entryId = "n" + (negativeEntries.length + 1);
      if (suspicious) unparsed.push(token);
      negativeEntries.push({
        entryId, kind: origin === "default" ? "default" : "freetext", owner, origin, text, weight, order: negativeEntries.length,
        disabled: false, raw: token, translated: [], untranslated: [], fragments: [], lora: null, adoptionId: null
      });
      const key = normalizeText(text);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const rendered = weight == null || weight === 1 ? text : `(${text}:${weight.toFixed(1)})`;
      effectiveNegative.push({ entryId, token: rendered, order: effectiveNegative.length });
    });
    return { negativeEntries, effectiveNegative, negativeParse: { mode: "parsed", unparsed } };
  }

  function stableHash(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  const PromptComposer = {
    normalizeText,
    isQualityWord(value) { return QUALITY_WORDS.includes(normalizeText(value)); },
    qualityWords() { return QUALITY_WORDS.slice(); },
    translateWithFragments,
    derivePromptModel,
    compose(model, options) {
      const m = model || { positive: [], negativeRaw: "" };
      const sorted = (Array.isArray(m.positive) ? m.positive : []).filter(x => x && POSITIVE_KINDS.has(x.kind))
        .slice().sort((a, b) => a.order - b.order);
      const entries = sorted.map((x, i) => Object.assign({}, x, { order: i }));
      const snapshotEntries = entries.map((x, i) => {
        const out = { entryId: "e" + (i + 1) };
        Object.keys(x).forEach(key => { if (key !== "id") out[key] = Array.isArray(x[key]) ? JSON.parse(JSON.stringify(x[key])) : x[key]; });
        return out;
      });
      const seen = new Set(), effective = [];
      entries.forEach(x => {
        if (x.disabled === true || !String(x.text || "").trim()) return;
        const key = normalizeText(x.text);
        if (!key || seen.has(key)) return;
        seen.add(key);
        const weight = x.kind === "tag" ? x.weight : null;
        const token = weight == null || weight === 1 ? x.text : `(${x.text}:${Number(weight).toFixed(1)})`;
        effective.push({ entryId: snapshotEntries[entries.indexOf(x)].entryId, token, order: effective.length });
      });
      const pos = effective.map(x => x.token).join(", ");
      const negativeRaw = String(m.negativeRaw == null ? "" : m.negativeRaw);
      const parsed = parseNegative(negativeRaw, options && options.defaultNegative);
      return {
        pos, neg: negativeRaw, posHash: stableHash(pos), entries, snapshotEntries, effective,
        negativeEntries: parsed.negativeEntries, effectiveNegative: parsed.effectiveNegative,
        negativeParse: parsed.negativeParse
      };
    }
  };

  root.PromptModel = { derive: derivePromptModel, translateWithFragments };
  root.PromptComposer = PromptComposer;
})(typeof window === "object" ? window : globalThis);
