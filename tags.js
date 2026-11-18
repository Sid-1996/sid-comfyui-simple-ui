/* ============================================================
   tags.js — 標籤庫與「我的組合」
   資料區（CATS / COMBOS）可自行新增：|english tag:中文名稱
   ============================================================ */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => window.Dict.esc(s);

  const CATS = [
["常用","masterpiece:大師作品|best quality:最佳畫質|amazing quality:極佳畫質|very aesthetic:唯美|absurdres:超高解析|detailed:細緻|solo:單人|looking at viewer:看向觀眾|simple background:簡單背景|white background:白色背景"],
["人物","1girl:女孩|1boy:男孩|2girls:兩個女孩|multiple girls:多個女孩|couple:情侶|mature female:成熟女性|office lady:OL|maid:女僕|nurse:護士|teacher:老師|witch:女巫|idol:偶像|catgirl:貓娘|fox girl:狐娘|elf:精靈|angel:天使|demon girl:惡魔少女|vampire:吸血鬼|princess:公主|knight:騎士"],
["頭髮","long hair:長髮|short hair:短髮|medium hair:中長髮|very long hair:超長髮|twintails:雙馬尾|ponytail:馬尾|side ponytail:側馬尾|braid:辮子|twin braids:雙辮子|bob cut:鮑伯頭|hair bun:包子頭|ahoge:呆毛|bangs:瀏海|hime cut:公主切|curly hair:捲髮|wavy hair:波浪髮|straight hair:直髮|black hair:黑髮|brown hair:棕髮|blonde hair:金髮|silver hair:銀髮|white hair:白髮|pink hair:粉紅髮|blue hair:藍髮|red hair:紅髮|purple hair:紫髮|green hair:綠髮|gradient hair:漸層髮|multicolored hair:多色髮|hair ribbon:髮帶|hairband:髮箍|hair flower:髮花"],
["臉&表情","smile:微笑|light smile:淺笑|grin:露齒笑|laughing:大笑|blush:臉紅|embarrassed:害羞|angry:生氣|crying:哭泣|tears:眼淚|serious:認真|expressionless:面無表情|surprised:驚訝|open mouth:張嘴|closed mouth:閉嘴|wink:眨單眼|closed eyes:閉眼|half-closed eyes:半閉眼|tongue out:吐舌|fang:虎牙|pout:嘟嘴|sleepy:想睡|blue eyes:藍眼|red eyes:紅眼|green eyes:綠眼|purple eyes:紫眼|yellow eyes:金眼|brown eyes:棕眼|pink eyes:粉紅眼|heterochromia:異色瞳|glowing eyes:發光眼|sparkling eyes:閃亮眼|long eyelashes:長睫毛"],
["服裝","school uniform:學生制服|serafuku:水手服|kimono:和服|yukata:浴衣|dress:洋裝|white dress:白色洋裝|sundress:夏季洋裝|evening gown:晚禮服|maid outfit:女僕裝|swimsuit:泳裝|bikini:比基尼|school swimsuit:學校泳衣|white shirt:白襯衫|t-shirt:T恤|hoodie:連帽衫|jacket:外套|sweater:毛衣|cardigan:針織外套|skirt:裙子|miniskirt:短裙|pleated skirt:百褶裙|shorts:短褲|jeans:牛仔褲|china dress:旗袍|hanfu:漢服|military uniform:軍服|armor:盔甲|wedding dress:婚紗|pajamas:睡衣|apron:圍裙|off shoulder:露肩|bare shoulders:裸肩|midriff:露腰|sleeveless:無袖|turtleneck:高領"],
["配件","thighhighs:過膝襪|black thighhighs:黑色過膝襪|white thighhighs:白色過膝襪|pantyhose:褲襪|stockings:長襪|kneehighs:及膝襪|glasses:眼鏡|hat:帽子|witch hat:女巫帽|beret:貝雷帽|bowtie:領結|necktie:領帶|scarf:圍巾|gloves:手套|choker:頸圈|necklace:項鍊|earrings:耳環|ribbon:緞帶|cat ears:貓耳|fox ears:狐耳|rabbit ears:兔耳|animal ears:獸耳|tail:尾巴|wings:翅膀|halo:光環|horns:角|loafers:樂福鞋|boots:靴子|high heels:高跟鞋|sneakers:球鞋|sandals:涼鞋|barefoot:赤腳"],
["動作","sitting:坐著|standing:站著|lying:躺著|on side:側躺|kneeling:跪姿|squatting:蹲下|running:奔跑|walking:走路|jumping:跳躍|dancing:跳舞|waving:揮手|holding:拿著|hand on hip:手叉腰|arms up:雙手舉高|arms behind back:雙手背後|looking back:回頭|looking away:看向別處|looking up:仰望|leaning forward:身體前傾|hug:擁抱|peace sign:比YA|finger to mouth:手指放嘴邊|hand on own chest:手放胸前|stretching:伸展|sleeping:睡覺|eating:吃東西|drinking:喝東西|reading:閱讀|holding umbrella:撐傘|holding flower:拿著花|holding sword:拿劍|singing:唱歌"],
["構圖&光影","full body:全身|upper body:半身|cowboy shot:膝上構圖|portrait:臉部特寫|close-up:特寫|from above:俯視|from below:仰視|from side:側面|from behind:背面|dutch angle:傾斜構圖|wide shot:遠景|depth of field:景深|bokeh:散景|lens flare:鏡頭光暈|backlighting:逆光|rim light:輪廓光|cinematic lighting:電影光|soft lighting:柔光|sunlight:陽光|dramatic lighting:戲劇光|motion blur:動態模糊"],
["場景","day:白天|night:夜晚|sunset:夕陽|sunrise:日出|dusk:黃昏|rain:下雨|snow:下雪|cloudy sky:多雲|starry sky:星空|moon:月亮|full moon:滿月|outdoors:戶外|indoors:室內|classroom:教室|bedroom:臥室|kitchen:廚房|cafe:咖啡廳|library:圖書館|rooftop:屋頂|street:街道|city:城市|cityscape:城市風景|alley:小巷|beach:海灘|ocean:大海|underwater:水中|swimming pool:泳池|forest:森林|mountain:山|field:草原|flower field:花田|cherry blossoms:櫻花|autumn leaves:楓葉|shrine:神社|torii:鳥居|temple:寺廟|festival:祭典|lanterns:燈籠|fireworks:煙火|window:窗戶|curtains:窗簾|bed:床|couch:沙發|on bed:在床上"],
["風格","anime coloring:動漫上色|watercolor:水彩|oil painting:油畫|sketch:素描|flat color:平塗|cel shading:賽璐璐|pastel colors:粉彩|vibrant colors:鮮豔色彩|monochrome:單色|greyscale:灰階|retro artstyle:復古風|pixel art:像素風|chibi:Q版|cyberpunk:賽博龐克|fantasy:奇幻|steampunk:蒸汽龐克|gothic:哥德|science fiction:科幻"],
["成人向","nsfw:成人向|nude:裸體|topless:半裸|lingerie:性感內衣|bra:胸罩|panties:內褲|underwear:內衣褲|cleavage:乳溝|underboob:下乳|large breasts:大胸部|medium breasts:中等胸部|small breasts:貧乳|wet clothes:濕衣服|sweat:汗水|see-through:透視|bare back:裸背|thighs:大腿|navel:肚臍"],
  ["成人·常用組合","surrounded, multiple others, exhibitionism, audience, background characters, crowd, public humiliation:露出|partially unbuttoned:解开一部分扣子|show foot:展示足|pubic tattoo on underbelly:淫纹在小腹|spread pussy:掰开XX|ass_visible_through_thighs:透过大腿可见屁股"],
  ["成人·五官表情","naughty_face:下流的表情|endured_face:忍耐的表情|ahegao:阿黑颜|blood on face:血在脸上|saliva:唾液"],
  ["成人·身體","breasts out:露出胸部|one breast out:露出一边"],
  ["成人·服裝內衣","no bra:没胸罩|bra:胸罩|victorian:褶边文胸|frilled bra:褶边文胸|sexy lingerie:情趣内衣|transparent underwear:透明内衣|sarashi:缠胸布|bustier:胸衣|chemise:吊带胸衣|underwear:内衣|panties:内裤（前加颜色）|striped_panties:条纹内裤|no_panties:没内裤|lowleg_panties/low_leg_panties:低腰式内裤|side-tie_panties:侧系带内裤|string_panties:高腰内裤|thong:丁字裤|fundoshi:日式丁字裤|lingerie:女用贴身内衣裤"],
  ["成人·襪子腿飾","vibrator in thighhighs:长筒袜里塞跳蛋|torn pantyhose:撕裂的连裤袜"],
  ["成人·動作","all_fours:四肢趴地|symmetrical_docking:2女胸部贴在一起|undressing:脱衣服|skirt lift:掀起裙子|shirt lift:掀起上衣|adjusting_thighhigh:调整过膝袜|straddling:straddling|cowgirl position:cowgirl position|riding deeply:riding deeply|hips lowered:hips lowered|hands gripping her own thighs:hands gripping her own thighs|fingers mostly hidden behind legs:fingers mostly hidden behind legs"],
  ["成人·R18","tentacle:触手|hairjob:发交|oral/fellatio:口交|deepthroat:深喉|gokkun:吃精|gag:口塞|ballgag:球塞|bitgag:棍塞|ring_gag:扩口器|cleave_gag:用布勒住嘴|panty_gag:用内裤塞口|tapegag:胶带封口|facial:颜射|leash:宠物链|handjob:用手做|groping:摸索|areolae:乳晕|nipples:乳头|puffy_nipples:大乳头|small_nipples:小乳头|nipple_pull:啦乳头|nipple_torture:虐乳头|nipple_tweak:捏乳头|nipple_piercing:乳头穿孔|breast_grab:摸乳|lactation:哺乳（大范围）|breast_sucking/nipple_suck:吸乳（中）|breast_feeding:喂奶(小)|paizuri:乳交|multiple_paizuri:多P乳交|breast_smother:把头塞入胸|piercing:穿孔|navel_piercing:肚脐穿孔|thigh_sex:腿交|footjob:足交|mound_of_venus:腹部三角带|wide_hips:宽盆骨|masturbation:自慰|clothed_masturbation:隔着衣服自慰|penis:阳具/屌|testicles:睾丸/蛋蛋|ejaculation:射出|cum:射精|cum_inside:内射|cum_on_breast:射在胸上|cum_on_hair:射在头发上|cum_on_food:射在食物上|tamakeri:蛋疼|pussy/vaginal:阴户（前者图片远大于后者）|pubic_hair:阴毛|shaved_pussy:剃过阴毛的（无毛B）|no_pussy:没逼的|clitoris:阴蒂|fat_mons:肥逼|cameltoe:骆驼脚趾逼（俗称馒头逼）|pussy_juice:爱液|female_ejaculation:潮吹|grinding:性器摩擦|crotch_rub:胯部摩擦|facesitting:坐在脸上|cervix:子宫口|cunnilingus:舔阴|insertion:插入物|anal_insertion:菊花插入物|fruit_insertion:用水果蔬菜|large_insertion:巨大插入|penetration:异物插入|fisting:拳头插入|fingering:手插入|multiple_insertions:一穴多插|double_penetration:双穴同插|triple_penetration:三穴同插|double_vaginal:双重入穴|peeing:尿尿|have_to_pee:憋尿|ass:屁股|huge_ass:大屁股|spread_ass:用手张开屁股|buttjob:臀交|spanked:打屁股|anus:菊花|anal:爆菊|double_anal:双重爆菊|anal_fingering:手爆菊|anal_fisting:拳爆菊|anilingus:肛吻|enema:灌肠|stomach_bulge:肚子胀|x-ray/cross-section/internal_cumshot:透视人体内部|wakamezake:酒倒在阴部|public:公共场所|humiliation:羞耻play|bra_lift:胸罩拉到胸上方|panties_around_one_leg:内裤挂在一条腿上|caught:被发现|walk-in:进门被发现|body_writing:身上有字|tally:在身上计数|futanari:双性|incest:乱伦|twincest:兄弟/姐妹/姐弟/兄妹|pegging:女性使用假屌|femdom:女奸男（逆推）|ganguro:日本黑妹|bestiality:人兽|gangbang:轮奸|threesome:3P|group_sex/orgy/teamwork:群P（多男x一女/性交派队/多女x1男）|tribadism:磨豆腐|molestation:性骚扰|voyeurism:窥阴癖|exhibitionism:裸露癖|rape:强暴|about_to_be_raped:将要被强暴|sex:性爱|clothed_sex:穿着衣服做爱|happy_sex:快乐做爱|underwater_sex:水中做爱|spitroast:前后夹攻|cock_in_thighhigh:插在过膝袜里|69:69式|doggystyle:狗爬式|leg_lock/upright_straddle:跨坐式|missionary:传教士体位|girl_on_top:女上体位|cowgirl_position:女上正骑|reverse_cowgirl:女上反骑|virgin:处女/破瓜|slave:奴隶|shibari:捆绑|bondage:捆绑/奴役|bdsm:绑缚与调教/支配与臣服/施虐与受虐|pillory/stocks:枷锁|rope:绳子|bound_arms:手臂捆绑|bound_wrists:手腕捆绑|crotch_rope:胯下捆绑|hogtie:曲膝捆绑|frogtie:青蛙捆绑|suspension:悬空捆绑|spreader_bar:分腿捆绑|wooden_horse:木马|anal_beads:肛珠|dildo:假屌|cock_ring:屌环|egg_vibrator:跳蛋|artificial_vagina:人工阴道|hitachi_magic_wand:按摩棒|double_dildo:双头龙|vibrator:带振动的自慰器|vibrator_in_thighhighs:震动开关在过膝袜里|nyotaimori:女体盛|vore:吃人|amputee:截肢|transformation:肉体变形|mind_control:思想操控|censored:审核过的/有码|uncensored:未审核的/无码|asian:亚洲|faceless_male:无脸男|blood:血"],
];

  const COMBOS = [
    ["校園少女", "1girl,solo,school uniform,long hair,smile,classroom,window,sunlight"],
    ["和風祭典", "1girl,solo,yukata,festival,lanterns,night,fireworks,smile"],
    ["夏日海灘", "1girl,solo,bikini,beach,ocean,sunlight,smile,wide shot"],
    ["咖啡廳日常", "1girl,solo,sweater,cafe,sitting,drinking,indoors,soft lighting"],
    ["奇幻冒險", "1girl,solo,armor,fantasy,forest,looking at viewer,wide shot"],
    ["夜晚城市", "1girl,solo,jacket,cyberpunk,city,night,rain,looking back"],
    ["成熟優雅", "mature female,solo,evening gown,long hair,indoors,soft lighting,looking at viewer"]
  ];

  // 分類 → 圖示檔名（assets/cat-*.webp）；找不到圖時自動退回文字
  const ICONS = {
    "常用": "common", "人物": "person", "頭髮": "hair", "臉&表情": "face",
    "服裝": "clothes", "配件": "accessory", "動作": "pose",
    "構圖&光影": "camera", "場景": "scene", "風格": "style", "成人向": "adult",
    "成人·常用組合": "adult", "成人·五官表情": "adult", "成人·身體": "adult",
    "成人·服裝內衣": "adult", "成人·襪子腿飾": "adult", "成人·動作": "adult",
    "成人·R18": "adult"
  };

  const L = [], Z = {};
  CATS.forEach(([c, s]) => s.split("|").forEach(p => {
    const [e, z] = p.split(":");
    L.push({ c, e, z });
    Z[e] = z;
  }));

  const state = { sel: [], saved: [], cat: "常用", q: "", adult: false, showEn: false, moreCats: false, learned: { general: [], positive: [], negative: [] } };
  try {
    state.sel = JSON.parse(localStorage.getItem("sel") || "[]");
    state.saved = JSON.parse(localStorage.getItem("combos") || "[]");
    state.adult = localStorage.getItem("adult") === "1";
    state.showEn = localStorage.getItem("showEn") === "1";
    const _rawLearned = JSON.parse(localStorage.getItem("ui.learnedTags") || "null");
    if (Array.isArray(_rawLearned)) {
      state.learned = { general: _rawLearned, positive: [], negative: [] };
    } else if (_rawLearned && typeof _rawLearned === "object") {
      state.learned = {
        general: Array.isArray(_rawLearned.general) ? _rawLearned.general : [],
        positive: Array.isArray(_rawLearned.positive) ? _rawLearned.positive : [],
        negative: Array.isArray(_rawLearned.negative) ? _rawLearned.negative : []
      };
    } else {
      state.learned = { general: [], positive: [], negative: [] };
    }
  } catch (e) { /* 忽略壞資料 */ }

  const els = {};
  let scrollSeed = 0;

  function save() {
    try {
      localStorage.setItem("sel", JSON.stringify(state.sel));
      localStorage.setItem("combos", JSON.stringify(state.saved));
      localStorage.setItem("adult", state.adult ? "1" : "0");
      localStorage.setItem("showEn", state.showEn ? "1" : "0");
      localStorage.setItem("ui.learnedTags", JSON.stringify(state.learned || { general:[], positive:[], negative:[] }));
    } catch (e) { /* 無痕模式 */ }
  }

  function notify() {
    window.dispatchEvent(new CustomEvent("tags:change"));
  }

  /* ── 分類列 ─────────────────────────────────────────────── */
  function renderCats() {
    const counts = {};
    L.forEach(x => { counts[x.c] = (counts[x.c] || 0) + 1; });
    const isSecondary = (c) => /^成人[·向]/.test(c) || /^已學習·/.test(c);
    const primary = CATS.map(([c]) => c).filter(c => !isSecondary(c) && (!/^成人[·向]/.test(c) || state.adult));
    const secondary = CATS.map(([c]) => c).filter(c => isSecondary(c) && (!/^成人[·向]/.test(c) || state.adult));
    const renderBtn = (c) => {
      const on = !state.q && c === state.cat;
      const icon = ICONS[c]
        ? `<img src="/assets/cat-${ICONS[c]}.webp" alt="" onerror="this.replaceWith(window.Tags._initial('${esc(c)}'))">`
        : '';
      const initial = ICONS[c] ? '' : `<span class="cat-initial">${esc((c === "成人向" || c.startsWith("成人·")) ? "18" : (c.startsWith("已學習·") ? "學" : c[0]))}</span>`;
      return `<button type="button" class="cat${on ? " on" : ""}" data-c="${esc(c)}" role="tab" aria-selected="${on}">
        ${icon}${initial}<span>${esc(c)}</span><b>${counts[c] || 0}</b></button>`;
    };
    let html = primary.map(renderBtn).join("");
    if (secondary.length) {
      const expanded = state.moreCats || secondary.includes(state.cat);
      html += `<button type="button" class="cat cat-more" data-act="moreCats" aria-expanded="${expanded}">${expanded ? "收合 ▴" : "更多分類 ▾"}<b>${secondary.length}</b></button>`;
      if (expanded) html += `<div class="cats-more">${secondary.map(renderBtn).join("")}</div>`;
    }
    els.cats.innerHTML = html;
  }

  /* ── 標籤格 ─────────────────────────────────────────────── */
  function renderTags() {
    const k = state.q.toLowerCase();
    const items = L.filter(x => {
      if (!state.adult && /^成人[·向]/.test(x.c)) return false;
      if (k) return x.e.toLowerCase().includes(k) || x.z.includes(state.q) || x.c.includes(state.q);
      return x.c === state.cat;
    });
    const on = new Set(state.sel.map(s => s.t));

    if (!items.length) {
      els.tags.innerHTML = `<div class="tag-empty">找不到「${esc(state.q)}」。<br>可以在下面的補充描述直接打中文，或自己寫英文標籤。</div>`;
      return;
    }

    els.tags.innerHTML = items.map(x =>
      `<button type="button" class="tag${on.has(x.e) ? " on" : ""}" data-e="${esc(x.e)}" title="${esc(x.z)} · ${esc(x.e)}">
        ${esc(x.z)}<i>${esc(x.e)}</i>
      </button>`
    ).join("");

    els.tags.scrollTop = scrollSeed;
  }

  /* ── 已選標籤（底列）───────────────────────────────────── */
  function renderSel() {
    els.selBar.innerHTML = state.sel.length
      ? state.sel.map((s, i) =>
        `<div class="pill" draggable="true" data-i="${i}" title="${esc(s.t)}">
          <span class="pill-t">${esc(Z[s.t] || s.t)}</span>
          ${s.w !== 1 ? `<span class="pill-w">×${s.w.toFixed(1)}</span>` : ""}
          <button type="button" data-a="m" aria-label="減弱">−</button>
          <button type="button" data-a="p" aria-label="加強">＋</button>
          <button type="button" data-a="d" aria-label="移除">×</button>
        </div>`
      ).join("")
      : `<span class="sel-empty">還沒選標籤 — 從左邊點一個開始</span>`;

    els.selCount.textContent = state.sel.length
      ? `${state.sel.length} 個標籤`
      : "還沒選標籤";
  }

  function renderAll(keepScroll) {
    if (keepScroll && els.tags) scrollSeed = els.tags.scrollTop;
    renderCats();
    renderTags();
    renderSel();
    notify();
  }

  function commit() {
    save();
    renderAll(true);
  }

  /* ── 對外 API ───────────────────────────────────────────── */
  /* ── 已學習標籤 ───────────────────────────────────────── */
  function ensureLearnedCategory() {
    const srcMap = { general: "已學習·一般", positive: "已學習·正向", negative: "已學習·負面" };
    for (const src in srcMap) {
      const catName = srcMap[src];
      const items = (state.learned && state.learned[src]) || [];
      if (!items.length) {
        const ci = CATS.findIndex(c => c[0] === catName);
        if (ci >= 0) CATS.splice(ci, 1);
        for (let i = L.length - 1; i >= 0; i--) if (L[i].c === catName) L.splice(i, 1);
      }
    }
    for (const src in srcMap) {
      const catName = srcMap[src];
      const items = (state.learned && state.learned[src]) || [];
      if (!items.length) continue;
      if (!CATS.some(c => c[0] === catName)) CATS.push([catName, ""]);
      items.forEach(x => {
        const en = String(x.en || "").trim();
        if (!en) return;
        if (L.some(l => l.c === catName && l.e === en)) return;
        const zh = String(x.zh || en).trim() || en;
        L.push({ c: catName, e: en, z: zh });
        Z[en] = zh;
      });
    }
  }


  const Tags = {
    init() {
      els.cats = $("cats");
      els.tags = $("tags");
      els.selBar = $("selBar");
      els.selCount = $("selCount");
      els.search = $("search");

      // 在搜尋框旁動態加 18+ 開關，避免 index.html 塞太多東西
      const top = document.querySelector(".lib-top");
      const btnAdult = document.createElement("button");
      btnAdult.type = "button";
      btnAdult.id = "btnAdult";
      btnAdult.className = "mini-toggle" + (state.adult ? " on" : "");
      btnAdult.textContent = "18+";
      btnAdult.setAttribute("aria-pressed", String(state.adult));
      btnAdult.title = "顯示成人向標籤";
      top.appendChild(btnAdult);

      const btnEn = $("btnEn");
      btnEn.classList.toggle("on", state.showEn);
      btnEn.setAttribute("aria-pressed", String(state.showEn));
      els.tags.classList.toggle("show-en", state.showEn);

      btnEn.onclick = () => {
        state.showEn = !state.showEn;
        btnEn.classList.toggle("on", state.showEn);
        btnEn.setAttribute("aria-pressed", String(state.showEn));
        els.tags.classList.toggle("show-en", state.showEn);
        save();
      };
      btnAdult.onclick = () => {
        state.adult = !state.adult;
        btnAdult.classList.toggle("on", state.adult);
        btnAdult.setAttribute("aria-pressed", String(state.adult));
        if (!state.adult && state.cat === "成人向") state.cat = "常用";
        renderAll(true);
        save();
      };

      els.cats.onclick = e => {
        const more = e.target.closest("[data-act='moreCats']");
        if (more) {
          state.moreCats = !state.moreCats;
          renderAll();
          return;
        }
        const b = e.target.closest(".cat");
        if (!b) return;
        state.cat = b.dataset.c;
        state.q = "";
        els.search.value = "";
        scrollSeed = 0;
        renderAll();
      };

      els.tags.onclick = e => {
        const b = e.target.closest(".tag");
        if (!b) return;
        const t = b.dataset.e;
        const i = state.sel.findIndex(s => s.t === t);
        if (i >= 0) state.sel.splice(i, 1);
        else state.sel.push({ t, w: 1 });
        commit();
      };

      els.search.oninput = e => {
        state.q = e.target.value.trim();
        scrollSeed = 0;
        renderCats();
        renderTags();
      };

      // 搜尋框按 Enter：直接加入第一個結果（少一次點擊）
      els.search.onkeydown = e => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const first = els.tags.querySelector(".tag");
        if (first) {
          first.click();
          els.search.select();
        }
      };

      // 底列已選標籤：加減權重 / 移除 / 拖曳排序
      els.selBar.onclick = e => {
        const b = e.target.closest("button");
        const c = e.target.closest(".pill");
        if (!b || !c) return;
        const i = +c.dataset.i;
        const s = state.sel[i];
        if (!s) return;
        const a = b.dataset.a;
        if (a === "d") state.sel.splice(i, 1);
        else s.w = Math.min(1.5, Math.max(0.5, Math.round((s.w + (a === "p" ? 0.1 : -0.1)) * 10) / 10));
        commit();
      };

      let dragFrom = -1;
      els.selBar.ondragstart = e => {
        const c = e.target.closest(".pill");
        if (!c) return;
        dragFrom = +c.dataset.i;
        c.classList.add("dragging");
        e.dataTransfer.setData("text/plain", "x");
      };
      els.selBar.ondragend = e => {
        const c = e.target.closest(".pill");
        if (c) c.classList.remove("dragging");
      };
      els.selBar.ondragover = e => { e.preventDefault(); };
      els.selBar.ondrop = e => {
        e.preventDefault();
        const c = e.target.closest(".pill");
        if (!c || dragFrom < 0) return;
        const to = +c.dataset.i;
        const [m] = state.sel.splice(dragFrom, 1);
        state.sel.splice(to, 0, m);
        dragFrom = -1;
        commit();
      };

      ensureLearnedCategory();
      renderAll();
    },

    /** 送進模型的提示詞（不含品質標籤，品質由 app.js 加） */
    buildPrompt() {
      const tags = state.sel.map(s => s.w === 1 ? s.t : `(${s.t}:${s.w.toFixed(1)})`);
      const extra = window.Dict.tr(($("pos") && $("pos").value || "").trim());
      if (extra) tags.push(extra);
      return tags.join(", ");
    },

    selected() { return state.sel; },
    snapshot() { return JSON.parse(JSON.stringify(state.sel)); },

    restore(sel) {
      state.sel = JSON.parse(JSON.stringify(sel || []));
      commit();
    },

    clear() {
      state.sel = [];
      if ($("pos")) $("pos").value = "";
      save();
      renderAll();
      window.dispatchEvent(new Event("pos:input"));
    },

    _learnedLabel(src) { return src === "positive" ? "正向" : src === "negative" ? "負面" : "一般"; },

    learn(tags, source) {
      source = source || "general";
      if (!state.learned[source]) state.learned[source] = [];
      if (!Array.isArray(tags)) tags = [tags];
      const catName = "已學習·" + this._learnedLabel(source);
      const existing = new Set(L.filter(x => x.c === catName).map(x => x.e));
      let changed = false;
      tags.forEach(raw => {
        const t = String(raw || '').trim();
        if (!t || t.includes(',') || existing.has(t)) return;
        state.learned[source].push({ en: t, zh: t });
        existing.add(t);
        changed = true;
      });
      if (!changed) return;
      if (state.learned[source].length > 200) state.learned[source] = state.learned[source].slice(-200);
      save();
      ensureLearnedCategory();
      renderAll(true);
    },

    clearLearned(source) {
      const srcs = source ? [source] : ["general", "positive", "negative"];
      srcs.forEach(src => {
        if (!state.learned[src]) return;
        state.learned[src] = [];
        const catName = "已學習·" + this._learnedLabel(src);
        const ci = CATS.findIndex(c => c[0] === catName);
        if (ci >= 0) CATS.splice(ci, 1);
        for (let i = L.length - 1; i >= 0; i--) if (L[i].c === catName) L.splice(i, 1);
        if (state.cat === catName) state.cat = "常用";
      });
      save();
      renderAll(true);
    },

    hasContent() {
      return state.sel.length > 0 || !!($("pos") && $("pos").value.trim());
    },

    applyCombo(name) {
      const c = COMBOS.find(x => x[0] === name) || COMBOS[0];
      state.sel = c[1].split(",").map(t => ({ t: t.trim(), w: 1 })).filter(x => x.t);
      commit();
      return c[0];
    },

    applyRandomCombo() {
      const c = COMBOS[Math.floor(Math.random() * COMBOS.length)];
      state.sel = c[1].split(",").map(t => ({ t: t.trim(), w: 1 })).filter(x => x.t);
      commit();
      return c[0];
    },

    combos() { return COMBOS.map(c => c[0]); },

    /** 產生分類圖示缺圖時的文字替代 */
    _initial(c) {
      const span = document.createElement("span");
      span.className = "cat-initial";
      span.textContent = (c === "成人向" || String(c).startsWith("成人·")) ? "18"
        : (String(c).startsWith("已學習·") ? "學" : c[0]);
      return span;
    }
  };

  window.Tags = Tags;
})();
