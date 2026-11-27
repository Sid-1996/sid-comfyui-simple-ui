/* ============================================================
   tags.js — 標籤庫與「我的組合」
   資料區（CATS）可自行新增：|english tag:中文名稱
   ============================================================ */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => window.Dict.esc(s);

  const CATS = [
    ["常用","masterpiece:大師作品|best quality:最佳畫質|amazing quality:極佳畫質|very aesthetic:唯美|absurdres:超高解析|detailed:細緻|solo:單人|looking at viewer:看向觀眾|simple background:簡單背景|white background:白色背景|ultra-detailed:ultra-detailed|8k:8k|clean sharp lines:clean sharp lines|sharp digital rendering:sharp digital rendering|delicate rendering:delicate rendering|high resolution digital illustration:high resolution digital illustration"],
    ["人物","1girl:女孩|1boy:男孩|2girls:兩個女孩|multiple girls:多個女孩|couple:情侶|mature female:成熟女性|office lady:OL|maid:女僕|nurse:護士|teacher:老師|witch:女巫|idol:偶像|cat_girl:貓娘|fox girl:狐娘|elf:精靈|angel:天使|demon girl:惡魔少女|vampire:吸血鬼|princess:公主|knight:騎士|petite:嬌小|rabbit girl:兔女孩|usada pekora:兔田佩克拉|usada pekora (1st costume):兔田佩克拉（初期服裝）|don-chan (usada pekora):咚醬（兔田佩克拉）|virtual youtuber:虛擬主播|collarbone:collarbone|mole_under_eye:mole_under_eye|mole:mole|feet:feet|soles:soles|toes:toes|legs:legs|bare_legs:bare_legs|pointy_ears:pointy_ears|hetero:hetero|dragon_girl:dragon_girl|dragon_horns:dragon_horns|dragon_tail:dragon_tail|stomach:stomach|toenails:toenails|plana_(blue_archive):plana_(blue_archive)|oozora_subaru_(1st_costume):oozora_subaru_(1st_costume)|oozora_subaru:oozora_subaru|flat_chest:flat_chest|skin_fang:skin_fang|nail_polish:nail_polish|dog:dog|animal:animal|fake_tail:fake_tail|rabbit_tail:rabbit_tail|v-shaped_eyebrows:v-shaped_eyebrows|bare_arms:bare_arms|covered_navel:covered_navel|back:back|thigh_gap:thigh_gap"],
    ["頭髮","long hair:長髮|short hair:短髮|medium hair:中長髮|very long hair:超長髮|twintails:雙馬尾|ponytail:馬尾|side ponytail:側馬尾|braid:辮子|twin braids:雙辮子|bob cut:鮑伯頭|hair bun:包子頭|ahoge:呆毛|bangs:瀏海|hime cut:公主切|curly hair:捲髮|wavy hair:波浪髮|straight hair:直髮|black hair:黑髮|brown hair:棕髮|blonde hair:金髮|silver hair:銀髮|white hair:白髮|pink hair:粉紅髮|blue hair:藍髮|red hair:紅髮|purple hair:紫髮|green hair:綠髮|gradient hair:漸層髮|multicolored hair:多色髮|hair ribbon:髮帶|hairband:髮箍|hair flower:髮花|drill hair:drill hair|one side up:one side up|single side bun:single side bun|black hairband:black hairband|sidelocks:鬢髮|split-color hair:分色髮|two-tone hair:雙色髮|streaked hair:挑染髮|blunt_bangs:blunt_bangs|hair_between_eyes:hair_between_eyes|low_twintails:low_twintails|grey_hair:grey_hair|hair_intakes:hair_intakes|hair_over_one_eye:hair_over_one_eye|colored_inner_hair:colored_inner_hair|crossed_bangs:crossed_bangs"],
    ["臉&表情","smile:微笑|light smile:淺笑|grin:露齒笑|laughing:大笑|blush:臉紅|embarrassed:害羞|angry:生氣|crying:哭泣|tears:眼淚|serious:認真|expressionless:面無表情|surprised:驚訝|open mouth:張嘴|closed mouth:閉嘴|one_eye_closed:眨單眼|closed eyes:閉眼|half-closed eyes:半閉眼|tongue out:吐舌|fang:虎牙|pout:嘟嘴|sleepy:想睡|blue eyes:藍眼|red eyes:紅眼|green eyes:綠眼|purple eyes:紫眼|yellow eyes:金眼|brown eyes:棕眼|pink eyes:粉紅眼|heterochromia:異色瞳|glowing eyes:發光眼|sparkling eyes:閃亮眼|long eyelashes:長睫毛|puffy cheeks:puffy cheeks|delicate eyelashes:delicate eyelashes|glossy lips:glossy lips|light blush:slight blush|drooling:heavy drooling|rolling eyes:rolling eyes|flushed face:flushed face|constricted pupils:瞳孔收縮|red pupils:紅瞳孔|frown:皺眉|short eyebrows:短眉|sweatdrop:汗滴|thick eyebrows:粗眉"],
    ["服裝","school uniform:學生制服|serafuku:水手服|kimono:和服|yukata:浴衣|dress:洋裝|white dress:白色洋裝|sundress:夏季洋裝|evening gown:晚禮服|swimsuit:泳裝|bikini:比基尼|school swimsuit:學校泳衣|white shirt:白襯衫|t-shirt:T恤|hoodie:連帽衫|jacket:外套|sweater:毛衣|cardigan:針織外套|skirt:裙子|miniskirt:短裙|pleated skirt:百褶裙|shorts:短褲|jeans:牛仔褲|china dress:旗袍|hanfu:漢服|military uniform:軍服|armor:盔甲|wedding dress:婚紗|pajamas:睡衣|apron:圍裙|off shoulder:露肩|bare shoulders:裸肩|midriff:露腰|sleeveless:無袖|turtleneck:高領|black leotard:黑色緊身衣|detached sleeves:分離袖|leotard:緊身衣|puffy short sleeves:泡泡短袖|puffy sleeves:泡泡袖|shirt:襯衫|short sleeves:短袖|strapless:無肩帶|strapless dress:無肩帶洋裝|white sleeves:白色袖子|black_serafuku:black_serafuku|sailor_collar:sailor_collar|white_sailor_collar:white_sailor_collar|long_sleeves:long_sleeves|playboy_bunny:playboy_bunny|strapless_leotard:strapless_leotard|highleg_leotard:highleg_leotard|highleg:highleg|black_shorts:black_shorts|hood_down:hood_down|yellow_hoodie:yellow_hoodie|short_shorts:short_shorts|drawstring:drawstring|yellow_jacket:yellow_jacket|strap_slip:strap_slip|sleeveless_dress:sleeveless_dress|see-through_dress:see-through_dress|gym_uniform:gym_uniform|gym_shirt:gym_shirt|blue_shorts:blue_shorts|blue_leotard:blue_leotard|white_collar:white_collar|black_jacket:black_jacket|black_cardigan:black_cardigan|puffy_long_sleeves:puffy_long_sleeves|sleeves_past_wrists:sleeves_past_wrists|black_skirt:black_skirt|white_jacket:white_jacket|white_cardigan:white_cardigan|backless_leotard:backless_leotard"],
    ["配件","thighhighs:過膝襪|black thighhighs:黑色過膝襪|white thighhighs:白色過膝襪|pantyhose:褲襪|kneehighs:及膝襪|glasses:眼鏡|hat:帽子|witch hat:女巫帽|beret:貝雷帽|bowtie:領結|necktie:領帶|scarf:圍巾|gloves:手套|choker:頸圈|necklace:項鍊|earrings:耳環|ribbon:緞帶|cat ears:貓耳|fox ears:狐耳|rabbit ears:兔耳|animal ears:獸耳|tail:尾巴|wings:翅膀|halo:光環|horns:角|loafers:樂福鞋|boots:靴子|high heels:高跟鞋|sneakers:球鞋|sandals:涼鞋|barefoot:赤腳|jewelry:jewelry|bracelet:bracelet|hair ornament:hair ornament|animal ear fluff:獸耳絨毛|carrot hair ornament:胡蘿蔔髮飾|food-themed hair ornament:食物造型髮飾|fur scarf:毛茸圍巾|heart hair ornament:愛心髮飾|white scarf:白色圍巾|ring:ring|red_ribbon:red_ribbon|black_choker:black_choker|bow:bow|black_gloves:black_gloves|fake_animal_ears:fake_animal_ears|blue_bow:blue_bow|black_footwear:black_footwear|blue_bowtie:blue_bowtie|shoes:shoes|headphones:headphones|animal_ear_headphones:animal_ear_headphones|hood:hood|computer_keyboard:computer_keyboard|cat_ear_headphones:cat_ear_headphones|hairclip:hairclip|computer_mouse:computer_mouse|black_pantyhose:black_pantyhose|x_hair_ornament:x_hair_ornament|bottle:bottle|holding_bottle:holding_bottle|water_bottle:water_bottle|wrist_cuffs:wrist_cuffs|white_wrist_cuffs:white_wrist_cuffs|arm_strap:arm_strap|anklet:anklet|toe_ring:toe_ring|veil:veil|mouth_veil:mouth_veil|socks:socks|white_socks:white_socks|food:food|collar:collar|bell:bell|hair_bow:hair_bow|black_ribbon:black_ribbon|grey_pantyhose:grey_pantyhose|card:card|half_gloves:half_gloves|playing_card:playing_card|no_shoes:no_shoes|single_glove:single_glove|thigh_strap:thigh_strap"],
    ["動作","sitting:坐著|standing:站著|lying:躺著|on side:側躺|kneeling:跪姿|squatting:蹲下|running:奔跑|walking:走路|jumping:跳躍|dancing:跳舞|waving:揮手|holding:拿著|hand_on_own_hip:手叉腰|arms up:雙手舉高|arms behind back:雙手背後|looking back:回頭|looking away:看向別處|looking up:仰望|leaning forward:身體前傾|hug:擁抱|v:比YA|finger to mouth:手指放嘴邊|hand on own chest:手放胸前|stretching:伸展|sleeping:睡覺|eating:吃東西|drinking:喝東西|reading:閱讀|holding umbrella:撐傘|holding flower:拿著花|holding sword:拿劍|singing:唱歌|bent over:彎腰|knees up:抬膝|on back:仰躺|pillow grab:抓枕頭|sheet grab:抓床單|hands_on_own_knees:hands_on_own_knees|head_tilt:head_tilt|feet_out_of_frame:feet_out_of_frame|legs_up:legs_up|leg_grab:leg_grab|crossed_legs:crossed_legs|index_finger_raised:index_finger_raised|hand_on_own_face:hand_on_own_face|hand_on_own_cheek:hand_on_own_cheek|parted_lips:parted_lips|hand_on_own_stomach:hand_on_own_stomach|hand_up:hand_up|on_stomach:on_stomach|knees_together_feet_apart:knees_together_feet_apart"],
    ["構圖&光影","full body:全身|upper body:半身|cowboy shot:膝上構圖|portrait:臉部特寫|close-up:特寫|from above:俯視|from below:仰視|from side:側面|from behind:背面|dutch angle:傾斜構圖|wide shot:遠景|depth of field:景深|bokeh:散景|lens flare:鏡頭光暈|backlighting:逆光|rim light:輪廓光|cinematic lighting:電影光|soft lighting:柔光|sunlight:陽光|dramatic lighting:戲劇光|motion blur:動態模糊|soft volumetric lighting:soft volumetric lighting|delicate shadows:delicate shadows|soft glow:soft glow|sparkle:sparkles|ass focus:臀特寫|blurry background:模糊背景|solo_focus:solo_focus"],
    ["場景","day:白天|night:夜晚|sunset:夕陽|sunrise:日出|dusk:黃昏|rain:下雨|snow:下雪|cloudy sky:多雲|starry sky:星空|moon:月亮|full moon:滿月|outdoors:戶外|indoors:室內|classroom:教室|bedroom:臥室|kitchen:廚房|cafe:咖啡廳|library:圖書館|rooftop:屋頂|street:街道|city:城市|cityscape:城市風景|alley:小巷|beach:海灘|ocean:大海|underwater:水中|pool:泳池|forest:森林|mountain:山|field:草原|flower field:花田|cherry blossoms:櫻花|autumn leaves:楓葉|shrine:神社|torii:鳥居|temple:寺廟|festival:祭典|lantern:燈籠|fireworks:煙火|window:窗戶|curtains:窗簾|bed:床|couch:沙發|on bed:在床上|chair:chair|swivel_chair:swivel_chair|on_chair:on_chair|gaming_chair:gaming_chair|monitor:monitor|office_chair:office_chair|mosaic_censoring:mosaic_censoring|motion_lines:motion_lines|bookshelf:bookshelf|see-through_silhouette:see-through_silhouette|sliding_doors:sliding_doors|tatami:tatami|wind:wind|flower:flower|black_background:black_background|building:building|fountain:fountain|sky:sky|cloud:cloud|blue_sky:blue_sky|dakimakura_(medium):dakimakura_(medium)|multiple_views:multiple_views|sample_watermark:sample_watermark|detached_collar:detached_collar|bed_sheet:bed_sheet"],
    ["風格","anime coloring:動漫上色|watercolor_(medium):水彩|oil_painting_(medium):油畫|sketch:素描|flat color:平塗|cel shading:賽璐璐|pastel colors:粉彩|vibrant colors:鮮豔色彩|monochrome:單色|greyscale:灰階|retro artstyle:復古風|pixel art:像素風|chibi:Q版|cyberpunk:賽博龐克|fantasy:奇幻|steampunk:蒸汽龐克|goth_fashion:哥德|science fiction:科幻|semi-realistic anime:semi-realistic anime|subsurface scattering:beautiful subsurface scattering|glossy highlights:glossy highlights|wet shiny skin:wet shiny skin|wet reflective skin:wet reflective skin"],
    ["成人向","nsfw:成人向|nude:裸體|topless:半裸|lingerie:性感內衣|bra:胸罩|panties:內褲|underwear:內衣褲|cleavage:乳溝|underboob:下乳|large breasts:大胸部|medium breasts:中等胸部|small breasts:貧乳|wet clothes:濕衣服|sweat:汗水|see-through_clothes:透視|bare back:裸背|thighs:大腿|navel:肚臍|breasts:胸部|completely nude:全裸|naked shirt:裸襯衫"],
    ["成人·身體服裝","ass_visible_through_thighs:透过大腿可见屁股|naughty_face:下流的表情|ahegao:阿黑颜|blood on face:血在脸上|saliva:唾液|breasts out:露出胸部|one breast out:露出一边|no bra:没胸罩|victorian:褶边文胸|frilled bra:褶边文胸|sarashi:缠胸布|bustier:胸衣|chemise:吊带胸衣|striped_panties:条纹内裤|no_panties:没内裤|lowleg_panties/low_leg_panties:低腰式内裤|side-tie_panties:侧系带内裤|string_panties:高腰内裤|thong:丁字裤|fundoshi:日式丁字裤|vibrator in thighhighs:长筒袜里塞跳蛋|torn pantyhose:撕裂的连裤袜|black_panties:black_panties|sideboob:sideboob|huge_breasts:huge_breasts"],
    ["成人·動作","partially unbuttoned:解开一部分扣子|all_fours:四肢趴地|symmetrical_docking:2女胸部贴在一起|undressing:脱衣服|skirt lift:掀起裙子|shirt lift:掀起上衣|adjusting_legwear:调整过膝袜|straddling:straddling|cowgirl position:cowgirl position|m legs:M腿|spread legs:張開雙腿|wide spread legs:大幅張開雙腿|wariza:wariza"],
    ["成人·R18","spread pussy:掰开XX|tentacles:触手|hairjob:发交|oral/fellatio:口交|deepthroat:深喉|gokkun:吃精|gag:口塞|ball_gag:球塞|bit_gag:棍塞|ring_gag:扩口器|cleave_gag:用布勒住嘴|panty_gag:用内裤塞口|tape_gag:胶带封口|facial:颜射|leash:宠物链|handjob:用手做|groping:摸索|areolae:乳晕|nipples:乳头|puffy_nipples:大乳头|small_nipples:小乳头|nipple_pull:啦乳头|nipple_torture:虐乳头|nipple_tweak:捏乳头|nipple_piercing:乳头穿孔|grabbing_another's_breast:摸乳|lactation:哺乳（大范围）|breast_sucking/nipple_suck:吸乳（中）|breastfeeding:喂奶(小)|paizuri:乳交|cooperative_paizuri:多P乳交|breast_smother:把头塞入胸|piercing:穿孔|navel_piercing:肚脐穿孔|thigh_sex:腿交|footjob:足交|groin:腹部三角带|wide_hips:宽盆骨|masturbation:自慰|clothed_masturbation:隔着衣服自慰|penis:阳具/屌|testicles:睾丸/蛋蛋|ejaculation:射出|cum:射精|cum_in_pussy:内射|cum_on_hair:射在头发上|cum_on_food:射在食物上|ball_busting:蛋疼|pussy/vaginal:阴户（前者图片远大于后者）|pubic_hair:阴毛|no_pussy:没逼的|clitoris:阴蒂|fat_mons:肥逼|cameltoe:骆驼脚趾逼（俗称馒头逼）|pussy_juice:爱液|female_ejaculation:潮吹|grinding:性器摩擦|crotch_rub:胯部摩擦|sitting_on_face:坐在脸上|cervix:子宫口|cunnilingus:舔阴|object_insertion:插入物|anal_insertion:菊花插入物|large_insertion:巨大插入|fisting:拳头插入|fingering:手插入|multiple_insertions:一穴多插|double_penetration:双穴同插|triple_penetration:三穴同插|double_vaginal:双重入穴|peeing:尿尿|have_to_pee:憋尿|ass:屁股|huge_ass:大屁股|spread_ass:用手张开屁股|buttjob:臀交|spanked:打屁股|anus:菊花|anal:爆菊|double_anal:双重爆菊|anal_fingering:手爆菊|anal_fisting:拳爆菊|anilingus:肛吻|enema:灌肠|stomach_bulge:肚子胀|x-ray/cross-section/internal_cumshot:透视人体内部|wakamezake:酒倒在阴部|public_indecency:公共场所|humiliation:羞耻play|bra_lift:胸罩拉到胸上方|panties_around_one_leg:内裤挂在一条腿上|caught:被发现|walk-in:进门被发现|body_writing:身上有字|tally:在身上计数|futanari:双性|incest:乱伦|twincest:兄弟/姐妹/姐弟/兄妹|pegging:女性使用假屌|femdom:女奸男（逆推）|ganguro:日本黑妹|bestiality:人兽|gangbang:轮奸|threesome:3P|group_sex/orgy/teamwork:群P（多男x一女/性交派队/多女x1男）|tribadism:磨豆腐|molestation:性骚扰|voyeurism:窥阴癖|exhibitionism:裸露癖|rape:强暴|imminent_rape:将要被强暴|sex:性爱|clothed_sex:穿着衣服做爱|happy_sex:快乐做爱|underwater_sex:水中做爱|spitroast:前后夹攻|penis_in_thighhigh:插在过膝袜里|69:69式|doggystyle:狗爬式|leg_lock/upright_straddle:跨坐式|missionary:传教士体位|girl_on_top:女上体位|reverse_cowgirl_position:女上反骑|virgin:处女/破瓜|slave:奴隶|shibari:捆绑|bondage:捆绑/奴役|bdsm:绑缚与调教/支配与臣服/施虐与受虐|pillory/stocks:枷锁|rope:绳子|bound_arms:手臂捆绑|bound_wrists:手腕捆绑|crotch_rope:胯下捆绑|hogtie:曲膝捆绑|frogtie:青蛙捆绑|suspension:悬空捆绑|spreader_bar:分腿捆绑|wooden_horse:木马|anal_beads:肛珠|dildo:假屌|cock_ring:屌环|egg_vibrator:跳蛋|artificial_vagina:人工阴道|hitachi_magic_wand:按摩棒|double_dildo:双头龙|vibrator:带振动的自慰器|nyotaimori:女体盛|vore:吃人|amputee:截肢|transformation:肉体变形|mind_control:思想操控|censored:审核过的/有码|uncensored:未审核的/无码|asian:亚洲|faceless_male:无脸男|blood:血|asphyxiation:窒息|pinned:被壓制|puckered anus:皺縮菊花|pussy juice trail:愛液痕跡|restrained:被束縛|spread anus:張開菊花|reverse_suspended_congress:reverse_suspended_congress"]
  ];

  // 分類 → 圖示檔名（assets/cat-*.webp）；找不到圖時自動退回文字
  const ICONS = {
    "常用": "common", "人物": "person", "頭髮": "hair", "臉&表情": "face",
    "服裝": "clothes", "配件": "accessory", "動作": "pose",
    "構圖&光影": "camera", "場景": "scene", "風格": "style", "成人向": "adult",
    "成人·身體服裝": "adult", "成人·動作": "adult", "成人·R18": "adult"
  };

  const L = [], Z = {};
  CATS.forEach(([c, s]) => s.split("|").forEach(p => {
    const [e, z] = p.split(":");
    L.push({ c, e, z });
    Z[e] = z;
  }));

  /* ── 個人標籤統計（Phase 1）─────────────────────────────────
     資料品質：權威正規化「只」認內建 CATS 與 dict.js，不認 L。
     L 在執行期會被 ensureLearnedCategory() 塞入個人學習標籤，
     拿 matchTag() 當權威會把舊的錯誤學習資料當成標準標籤。
     跨分頁：每次成功生成寫一個專屬 evt key（jobId 唯一）；
     收藏只寫該標籤的 fav key；ui.tagStats 是可重建的物化快照。 */
  const STATS_KEY = "ui.tagStats";
  const EVT_PREFIX = "ui.tagStats.evt.";
  const FAV_PREFIX = "ui.tagStats.fav.";
  const BROKEN_PREFIX = "ui.tagStats.broken.";
  const STATS_VERSION = 1;
  // 不自動壓縮 evt key：localStorage 沒有 atomic compare-and-set，
  // 兩分頁同時折入事件再刪除 key 會永久遺失計數。詳見 devtools/reports/
  // tag-learning-phase1-review-fixes.md。事件一律保留，由重建加總。

  const CANON_ALT = Object.create(null);   // 正規化 alt → CATS canonical
  const CANON_ZH = Object.create(null);    // 已知中文 → CATS canonical
  const CANON_ONLY = Object.create(null);  // canonical 集合（供個人分類計數）
  CATS.forEach(([cat, blob]) => {
    if (/^已學習·/.test(cat)) return;       // 動態學習資料不得成為權威
    blob.split("|").forEach(p => {
      if (!p) return;
      const parts = p.split(":");
      const enField = parts[0] || "";
      const canonical = enField.split("/")[0].trim();
      if (!canonical) return;
      CANON_ONLY[canonical] = true;
      enField.split("/").forEach(alt => {
        const k = norm(alt);
        if (k && !CANON_ALT[k]) CANON_ALT[k] = canonical;
      });
      // CATS 明確存在的完整複合別名（a/b）也要能整串輸入。
      // 只登錄 CATS 寫死的組合，绝不拆開使用者任意輸入的 foo/bar 猜測。
      if (enField.indexOf("/") >= 0) {
        const full = norm(enField);
        if (full && !CANON_ALT[full]) CANON_ALT[full] = canonical;
      }
      const zh = (parts[1] || "").trim();
      if (/[\u4e00-\u9fff]/.test(zh) && norm(zh) !== norm(canonical) && !CANON_ZH[zh]) {
        CANON_ZH[zh] = canonical;
      }
    });
  });
  if (window.Dict && window.Dict.DICT) {
    Object.keys(window.Dict.DICT).forEach(zh => {
      const c = CANON_ALT[norm(window.Dict.DICT[zh])];
      if (c && !CANON_ZH[zh]) CANON_ZH[zh] = c;
    });
  }

  /** prompt token → 權威標準標籤；認不出來回 null，不猜測、不統計。 */
  function canonicalTag(raw) {
    let s = String(raw == null ? "" : raw).trim();
    if (!s) return null;
    const wrapped = s.match(/^\((.*)\)$/);
    if (wrapped) s = wrapped[1].trim();
    const ci = s.indexOf(":");
    if (ci >= 0) s = s.slice(0, ci).trim();
    if (!s || /[,\r\n]/.test(s)) return null;
    const n = norm(s);
    if (CANON_ALT[n]) return CANON_ALT[n];
    if (CANON_ZH[s]) return CANON_ZH[s];
    if (CANON_ZH[n]) return CANON_ZH[n];
    return null;
  }

  let stats = { version: STATS_VERSION, tags: {}, updatedAt: 0 };

  function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }
  function safeParse(raw) { try { return JSON.parse(raw); } catch (e) { return undefined; } }
  function keysWith(prefix) {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) out.push(k);
      }
    } catch (e) { /* 無痕模式 */ }
    return out;
  }
  function newRecord() { return { positiveCount: 0, negativeCount: 0, lastUsedAt: 0, favorite: false }; }
  function recOf(tags, key) { if (!tags[key]) tags[key] = newRecord(); return tags[key]; }

  function readSnapshot() {
    let raw = null;
    try { raw = localStorage.getItem(STATS_KEY); } catch (e) { return {}; }
    if (!raw) return {};
    const o = safeParse(raw);
    const bad = !o || typeof o !== "object" || Array.isArray(o) ||
      o.version !== STATS_VERSION || !o.tags || typeof o.tags !== "object" || Array.isArray(o.tags);
    if (bad) {
      // 損壞／未知版本：先原樣備份再移除，绝不直接覆蓋掉使用者的原始資料
      try {
        localStorage.setItem(BROKEN_PREFIX + Date.now(), raw);
        localStorage.removeItem(STATS_KEY);
      } catch (e) { /* 配額不足就放棄備份，仍需能繼續使用 */ }
      return {};
    }
    return o.tags;
  }

  /** 由 snapshot + evt keys + fav keys 重建統計；結果是確定性的，並行寫入也收斂。 */
  function rebuildStats(persist) {
    const base = readSnapshot();
    const tags = Object.create(null);
    Object.keys(base).forEach(k => {
      const r = base[k];
      if (!r || typeof r !== "object") return;
      tags[k] = {
        positiveCount: num(r.positiveCount),
        negativeCount: num(r.negativeCount),
        lastUsedAt: num(r.lastUsedAt),
        favorite: !!r.favorite
      };
    });
    // 每個成功生成一個 evt key；同一任務的標籤在寫入時已去重
    keysWith(EVT_PREFIX).forEach(k => {
      const ev = safeParse(localStorage.getItem(k));
      if (!ev || typeof ev !== "object") return;
      const at = num(ev.at) || Date.now();
      [["pos", "positiveCount"], ["neg", "negativeCount"]].forEach(pair => {
        const arr = Array.isArray(ev[pair[0]]) ? ev[pair[0]] : [];
        const seen = Object.create(null);
        arr.forEach(raw => {
          const c = canonicalTag(raw);
          if (!c || seen[c]) return;
          seen[c] = true;
          const r = recOf(tags, c);
          r[pair[1]] += 1;
          if (at > r.lastUsedAt) r.lastUsedAt = at;
        });
      });
    });
    // 收藏：一標籤一 key；以 at 判新舊，同一時間點以「取消」為準（保守）
    const favAt = Object.create(null);
    keysWith(FAV_PREFIX).forEach(k => {
      const f = safeParse(localStorage.getItem(k));
      if (!f || typeof f !== "object") return;
      const c = canonicalTag(f.tag);
      if (!c) return;
      const r = recOf(tags, c);
      const at = num(f.at);
      const prev = favAt[c];
      if (prev === undefined || at > prev || (at === prev && f.favorite === false)) {
        r.favorite = !!f.favorite;
        favAt[c] = at;
      }
    });
    stats = { version: STATS_VERSION, tags, updatedAt: Date.now() };
    if (persist) {
      // 重要：ui.tagStats 存的是「已折入的 base」，絕不能把 live evt 的計數也寫進去，
      // 否則下次重建會 base + evt 再算一次（舊分頁快照覆蓋也是同一個坑）。
      const baseOut = {};
      Object.keys(base).forEach(k => {
        const r = base[k];
        if (!r || typeof r !== "object") return;
        baseOut[k] = {
          positiveCount: num(r.positiveCount),
          negativeCount: num(r.negativeCount),
          lastUsedAt: num(r.lastUsedAt),
          favorite: !!r.favorite
        };
      });
      try {
        localStorage.setItem(STATS_KEY, JSON.stringify({ version: STATS_VERSION, tags: baseOut, updatedAt: Date.now() }));
      } catch (e) { /* 配額不足不影響生圖 */ }
      // 刻意不壓縮 evt：保留所有事件，重建永遠是 base + 全部 evt + fav。
      // 這樣「掃描後又有新事件」與「兩分頁同時壓縮」都不可能發生，
      // 也不會因為過期 base 覆寫而永久遺失計數。
    }
    return true;
  }

  /** 成功生成呼叫一次；jobId 必須是該任務唯一值（app.js 用 fileTag UUID）。 */
  function recordGeneration(o) {
    o = o || {};
    const id = String(o.jobId || (Date.now() + "-" + Math.random().toString(36).slice(2)));
    const key = EVT_PREFIX + id;
    const uniq = arr => {
      const out = [], seen = Object.create(null);
      (Array.isArray(arr) ? arr : []).forEach(raw => {
        const c = canonicalTag(raw);
        if (!c || seen[c]) return;
        seen[c] = true;
        out.push(c);
      });
      return out;
    };
    try {
      if (localStorage.getItem(key) !== null) return false;   // 同一任務不重複計
      localStorage.setItem(key, JSON.stringify({
        v: 1, at: num(o.at) || Date.now(), pos: uniq(o.pos), neg: uniq(o.neg)
      }));
    } catch (e) { return false; }
    rebuildStats(true);
    return true;
  }

  /** 收藏由使用者主動觸發；只寫所屬標籤的 key，不碰別的標籤。 */
  function toggleFavorite(raw, force) {
    const c = canonicalTag(raw);
    if (!c) return null;
    const key = FAV_PREFIX + encodeURIComponent(c);
    let cur = null;
    try { cur = safeParse(localStorage.getItem(key)); } catch (e) { /* ignore */ }
    const next = typeof force === "boolean" ? force : !(cur && cur.favorite === true);
    try { localStorage.setItem(key, JSON.stringify({ tag: c, favorite: next, at: Date.now() })); }
    catch (e) { return null; }
    rebuildStats(true);
    renderAll(true);   // 立刻反映星號 gold 狀態與「我的收藏」計數
    return next;
  }
  function isFavorite(raw) {
    const c = canonicalTag(raw);
    return !!(c && stats.tags[c] && stats.tags[c].favorite);
  }
  function statsSnapshot() { return JSON.parse(JSON.stringify(stats)); }
  function statsSignature() { return JSON.stringify(stats.tags); }

  const state = { sel: [], saved: [], cat: "常用", q: "", adult: false, showEn: false, moreCats: false, sortMode: "auto", learned: { general: [], positive: [], negative: [] } };
  try {
    state.sel = JSON.parse(localStorage.getItem("sel") || "[]");
    state.saved = JSON.parse(localStorage.getItem("combos") || "[]");
    state.adult = localStorage.getItem("adult") === "1";
    state.showEn = localStorage.getItem("showEn") === "1";
    state.moreCats = localStorage.getItem("ui.moreCats") === "1";
    state.sortMode = localStorage.getItem("ui.selSortMode") === "manual" ? "manual" : "auto";
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
  let syncCatArrows = () => {};   // init() 後接上分類導航的左右鍵狀態

  // 標籤比對用的正規化：底線與空格互通、大小寫不拘、空白收斂
  // 有些分類用「a/b」表示兩個同義標籤，比對時拆開看
  function tagAlts(s) {
    return String(s || "").toLowerCase().split("/")
      .map(x => x.trim().replace(/[_\s]+/g, " ").trim())
      .filter(Boolean);
  }

  function save() {
    try {
      localStorage.setItem("sel", JSON.stringify(state.sel));
      localStorage.setItem("combos", JSON.stringify(state.saved));
      localStorage.setItem("adult", state.adult ? "1" : "0");
      localStorage.setItem("showEn", state.showEn ? "1" : "0");
      localStorage.setItem("ui.moreCats", state.moreCats ? "1" : "0");
      localStorage.setItem("ui.selSortMode", state.sortMode);
      localStorage.setItem("ui.learnedTags", JSON.stringify(state.learned || { general:[], positive:[], negative:[] }));
    } catch (e) { /* 無痕模式 */ }
  }

  // 只保存學習標籤：learn()/clearLearned() 不得順手把本分頁（可能已過期）的 sel/adult/showEn 寫回
  function saveLearned() {
    try {
      localStorage.setItem("ui.learnedTags", JSON.stringify(state.learned || { general: [], positive: [], negative: [] }));
    } catch (e) { /* 無痕模式 */ }
  }

  function notify() {
    window.dispatchEvent(new CustomEvent("tags:change"));
  }

  /* ── 分類列 ─────────────────────────────────────────────── */
  function renderCats() {
    const counts = {};
    L.forEach(x => { counts[x.c] = (counts[x.c] || 0) + 1; });
    const advanced = !!(document.getElementById("advBox") && document.getElementById("advBox").open);
    const isQualityWord = window.PromptComposer.isQualityWord;
    const availableCount = c => advanced || c === "__fav__" || c === "__top__"
      ? (counts[c] || 0) : L.filter(x => x.c === c && !isQualityWord(x.e)).length;
    // 個人分類是 virtual：不進 CATS、不進 L，只從統計物化快照計數
    let favN = 0, usedN = 0;
    Object.keys(stats.tags).forEach(k => {
      const r = stats.tags[k];
      if (!r || !CANON_ONLY[k] || (!advanced && isQualityWord(k))) return;
      if (r.favorite) favN++;
      if (r.positiveCount + r.negativeCount > 0) usedN++;
    });
    counts["__fav__"] = favN;
    counts["__top__"] = usedN;
    const personal = ["__fav__"];
    if (usedN > 0) personal.push("__top__");
    // 成人分類在 18+ 開啟時直接顯示為主要分類，不再收合
    const isSecondary = (c) => /^已學習·/.test(c);
    const primary = personal.concat(CATS.map(([c]) => c).filter(c => !isSecondary(c) && (!/^成人[·向]/.test(c) || state.adult)));
    const secondary = CATS.map(([c]) => c).filter(c => isSecondary(c) && (!/^成人[·向]/.test(c) || state.adult));
    const renderBtn = (c) => {
      const on = !state.q && c === state.cat;
      const virt = c === "__fav__" || c === "__top__";
      const icon = virt
        ? `<span class="cat-vicon"><svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/></svg></span>`
        : (ICONS[c]
          ? `<img src="/assets/cat-${ICONS[c]}.webp" alt="" onerror="this.replaceWith(window.Tags._initial('${esc(c)}'))">`
          : '');
      const initial = (virt || ICONS[c]) ? '' : `<span class="cat-initial">${esc((c === "成人向" || c.startsWith("成人·")) ? "成" : (c.startsWith("已學習·") ? "學" : c[0]))}</span>`;
      return `<button type="button" class="cat${on ? " on" : ""}" data-c="${esc(c)}" role="tab" aria-selected="${on}">
        ${icon}${initial}<span>${esc(c === "__fav__" ? "我的收藏" : c === "__top__" ? "我的常用" : c)}</span><b>${advanced ? "全部 " : "可選 "}${availableCount(c)}</b></button>`;
    };
    let html = primary.map(renderBtn).join("");
    if (secondary.length) {
      const expanded = state.moreCats || secondary.includes(state.cat);
      html += `<button type="button" class="cat cat-more" data-act="moreCats" aria-expanded="${expanded}">${expanded ? "收合 ▴" : "更多分類 ▾"}<b>${secondary.length}</b></button>`;
      if (expanded) html += `<div class="cats-more">${secondary.map(renderBtn).join("")}</div>`;
    }
    els.cats.innerHTML = html;
    syncCatArrows();
  }

  /* ── 標籤分組（依既有分類 / TagCategories 資料推導，不硬編碼標籤）── */
  const GROUP_ICONS = {
    star:  '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 5-5 3 3 3-3 5 5"/></svg>',
    cube:  '<svg viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>',
    warn:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
    tag:   '<svg viewBox="0 0 24 24"><path d="M4 5h7l9 9-7 7-9-9V5Z"/><circle cx="8" cy="9" r="1"/></svg>',
    bolt:  '<svg viewBox="0 0 24 24"><path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z"/></svg>'
  };

  function groupItems(items) {
    const buckets = new Map();
    const add = (key, x, meta) => {
      let g = buckets.get(key);
      if (!g) { g = Object.assign({ key, items: [], seen: new Set(), order: 50 }, meta); buckets.set(key, g); }
      if (g.seen.has(x.e)) return;   // 同名標籤出現在多個成人分類時只顯示一次
      g.seen.add(x.e);
      g.items.push(x);
    };
    // 「常用」分類前五筆（沿用資料自帶順序）即核心品質標籤
    let core = new Set();
    const common = CATS.find(c => c[0] === "常用");
    if (common) common[1].split("|").slice(0, 5).forEach(p => core.add(norm(p.split(":")[0])));
    const hasTC = !!(window.TagCategories && window.TagCategories.of);
    const kind = e => hasTC ? window.TagCategories.of(e) : "";

    items.forEach(x => {
      if (x.c === "__fav__" || x.c === "__top__") {
        return add("personal:" + x.c, x, {
          title: x.c === "__fav__" ? "我的收藏" : "我的常用",
          icon: GROUP_ICONS.star,
          order: x.c === "__fav__" ? 5 : 6
        });
      }
      if (isAdultCat(x.c)) {
        // 選「成人向」是全部；選「成人·XX」時標題跟著子分類，讓切換看得見差異
        const title = isAdultCat(state.cat) && state.cat !== "成人向" ? state.cat : "成人內容";
        return add("adult", x, { title, icon: GROUP_ICONS.warn, order: 90, badge: "18+", adult: true });
      }
      if (state.q) {
        return add("search", x, { title: "搜尋結果", icon: GROUP_ICONS.tag, order: 0, hint: state.q });
      }
      if (x.c === "常用") {
        if (core.has(norm(x.e))) return add("fav", x, { title: "常用標籤", icon: GROUP_ICONS.star, order: 0, action: true });
        if (kind(x.e) === "style") return add("quality", x, { title: "畫質與細節", icon: GROUP_ICONS.image, order: 1 });
        if (["composition", "background", "character"].indexOf(kind(x.e)) >= 0)
          return add("view", x, { title: "構圖與視角", icon: GROUP_ICONS.cube, order: 2 });
        return add("fav", x, { title: "常用標籤", icon: GROUP_ICONS.star, order: 0, action: true });
      }
      const ci = CATS.findIndex(c => c[0] === x.c);
      return add("cat:" + x.c, x, {
        title: x.c, icon: GROUP_ICONS.tag,
        order: /^已學習·/.test(x.c) ? 80 : (10 + (ci < 0 ? 99 : ci))
      });
    });
    return Array.from(buckets.values()).sort((a, b) => a.order - b.order);
  }

  /* ── 標籤格 ─────────────────────────────────────────────── */
  function renderTags() {
    const k = state.q.toLowerCase();
    const personal = !k && (state.cat === "__fav__" || state.cat === "__top__");
    const usage = x => {
      const r = stats.tags[canonicalTag(x.e)];
      return r ? r.positiveCount + r.negativeCount : 0;
    };
    const items = L.filter(x => {
      // 同一 Quality 判定先於搜尋、個人分類與排序，涵蓋所有新增入口。
      if (!(document.getElementById("advBox") && document.getElementById("advBox").open) && window.PromptComposer.isQualityWord(x.e)) return false;
      // 18+ 關閉：成人標籤完全不出現（存取限制不變）
      if (!state.adult && isAdultCat(x.c)) return false;
      // 搜尋：维持原本比對，命中才納入
      if (k) return x.e.toLowerCase().includes(k) || x.z.includes(state.q) || x.c.includes(state.q);
      // 18+ 開啟：成人標籤只在成人分類被選時顯示（「成人向」= 全部，子分類 = 各自那份）
      // 普通分類不混入成人標籤，否則底下一整包 232 張會蓋過目前分類
      if (isAdultCat(x.c)) {
        if (state.cat === "成人向") return true;
        return isAdultCat(state.cat) && x.c === state.cat;
      }
      if (state.cat === "__fav__") {
        const r = stats.tags[canonicalTag(x.e)];
        return !!(r && r.favorite);
      }
      if (state.cat === "__top__") return usage(x) > 0;
      return x.c === state.cat;
    });
    let view = items;
    if (!k && state.cat === "__top__") {
      view = items.slice().sort((a, b) => usage(b) - usage(a) || a.e.localeCompare(b.e)).slice(0, 20);
    }
    if (personal) view = view.map(x => Object.assign({}, x, { c: state.cat }));
    const on = new Set(state.sel.map(s => s.t));

    if (!view.length) {
      const msg = state.cat === "__fav__" ? "還沒有收藏標籤。<br>在標籤上點一下 ★ 就能收藏。"
        : state.cat === "__top__" ? "還沒有使用記錄。<br>先生成幾張圖，這裡會出現常用標籤。"
        : `找不到「${esc(state.q)}」。<br>可以在下面的補充描述直接打中文，或自己寫英文標籤。`;
      els.tags.innerHTML = `<div class="tag-empty">${msg}</div>`;
      return;
    }

    els.tags.innerHTML = groupItems(view).map(g => `
      <section class="tag-group${g.adult ? " adult" : ""}">
        <div class="tag-group-head">
          <span class="tag-group-icon">${g.icon}</span>
          <h3 class="tag-group-title">${esc(g.title)}</h3>
          <span class="tag-group-count">${g.items.length}</span>
          ${g.badge ? `<span class="tag-group-badge">${g.badge}</span>` : ""}
          ${g.hint ? `<span class="prompt-hint">「${esc(g.hint)}」</span>` : ""}
          ${g.action ? `<button type="button" class="tag-group-action" data-grp-act="quick">${GROUP_ICONS.bolt}快速選擇</button>` : ""}
        </div>
        <div class="tag-group-items">${g.items.map(x => {
          const fav = isFavorite(x.e);
          const n = !k && state.cat === "__top__" ? usage(x) : 0;
          return `<button type="button" class="tag${on.has(x.e) ? " on" : ""}${/^成人[·向]/.test(x.c) ? " adult" : ""}" data-e="${esc(x.e)}" aria-pressed="${on.has(x.e)}" title="${esc(x.z)} · ${esc(x.e)}${n ? " · 使用 " + n + " 次" : ""}（點 ★ ${fav ? "取消收藏" : "收藏"}）">
            <span class="tag-fav${fav ? " on" : ""}" data-fav="${esc(x.e)}">★</span>
            <span class="tag-zh">${esc(x.z)}</span><i>${esc(x.e)}</i>
          </button>`;
        }).join("")}</div>
      </section>`
    ).join("");

    els.tags.scrollTop = scrollSeed;
  }

  /* ── 已選標籤排序 ─────────────────────────────────────────
     查找表直接由既有 CATS 推導，不另建一份分類資料。
     同一標籤出現在多個分類時取最前面（最小 order），成人／學習分類排在最後；
     找不到的標籤放最後。排序以原始索引作第二鍵，保證穩定。 */
  function tagOrderMap() {
    const m = new Map();
    CATS.forEach(([c, s], ci) => {
      const tail = /^成人[·向]/.test(c) || /^已學習·/.test(c);
      const order = tail ? 100 + ci : ci;
      s.split("|").forEach(p => {
        // p = "english tag:中文名稱"；部分標籤用 a/b 表示同義詞，拆開一起登錄
        tagAlts(p.split(":")[0]).forEach(k => {
          if (!m.has(k) || order < m.get(k)) m.set(k, order);
        });
      });
    });
    return m;
  }

  function sortSel(list) {
    const orders = tagOrderMap();
    const rank = t => {
      let best = 1e6;
      tagAlts(t).forEach(k => {
        const v = orders.get(k);
        if (v !== undefined && v < best) best = v;
      });
      return best;
    };
    return list.map((s, i) => ({ s, i }))
      .sort((a, b) => rank(a.s.t) - rank(b.s.t) || a.i - b.i)
      .map(x => x.s);
  }

  let sortFbTimer = 0;
  function sortFeedback(text) {
    const el = $("sortMode");
    if (!el) return;
    el.textContent = text;
    clearTimeout(sortFbTimer);
    sortFbTimer = setTimeout(() => {
      const n = $("sortMode");
      if (n) n.textContent = state.sortMode === "manual" ? "手動排序 · 恢復自動" : "自動排序";
    }, 1400);
  }

  function restoreAutoSort() {
    if (state.sortMode === "auto") return;
    state.sortMode = "auto";
    state.sel = sortSel(state.sel);
    commit();
    sortFeedback("已恢復自動排序");
  }

  /* ── 已選標籤（底列）───────────────────────────────────── */
  function renderSel() {
    els.selBar.innerHTML = state.sel.length
      ? state.sel.map((s, i) =>
        `<div class="pill${s.w !== 1 ? " weighted" : ""}" draggable="true" data-i="${i}" title="${esc(s.t)}">
          <span class="pill-t">${esc(Z[s.t] || s.t)}</span>
          <span class="pill-w">×${s.w.toFixed(1)}</span>
          <button type="button" data-a="m" aria-label="減弱 ${esc(Z[s.t] || s.t)}">−</button>
          <button type="button" data-a="p" aria-label="加強 ${esc(Z[s.t] || s.t)}">＋</button>
          <button type="button" data-a="d" aria-label="移除 ${esc(Z[s.t] || s.t)}">×</button>
        </div>`
      ).join("")
      : `<span class="sel-empty">還沒選標籤 — 從左邊點一個開始</span>`;

    els.selCount.className = "sel-count" + (state.sel.length ? " has-tags" : "");
    els.selCount.innerHTML = state.sel.length
      ? `<b class="sel-num">${state.sel.length}</b><span class="sel-label">個標籤</span>`
      : `<span class="sel-label">還沒選標籤</span>`;

    // 模式提示：自動是純資訊；手動時同一位置變成「恢復自動排序」入口
    if (els.sortModeWrap) {
      els.sortModeWrap.innerHTML = state.sortMode === "manual"
        ? `<button type="button" id="sortMode" class="sort-mode manual" data-act="autoSort" title="恢復自動排序">手動排序 · 恢復自動</button>`
        : `<span id="sortMode" class="sort-mode" role="status">自動排序</span>`;
    }
  }

  // 重繪會把所有按鈕換掉；記下目前焦點，重繪後放回同一顆，鍵盤操作才不會每按一次就掉焦點
  function focusKey() {
    const a = document.activeElement;
    if (!a || a === document.body || !a.dataset) return null;
    const q = v => (window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/"/g, '\\"');
    if (els.tags && els.tags.contains(a) && a.dataset.e) return { root: els.tags, sel: '.tag[data-e="' + q(a.dataset.e) + '"]' };
    if (els.cats && els.cats.contains(a) && a.dataset.c) return { root: els.cats, sel: '.cat[data-c="' + q(a.dataset.c) + '"]' };
    if (els.selBar && els.selBar.contains(a) && a.dataset.a) {
      const p = a.closest(".pill");
      if (p) return { root: els.selBar, sel: '.pill[data-i="' + p.dataset.i + '"] button[data-a="' + a.dataset.a + '"]' };
    }
    return null;
  }
  function restoreFocus(k) {
    if (!k) return;
    const n = k.root.querySelector(k.sel);
    if (n) { try { n.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  // 搜尋中的可辨識狀態：輸入框高亮 + 工具列的「搜尋中」膠囊（可按它清除）
  function syncSearchState() {
    const active = !!state.q;
    const wrap = els.search && els.search.closest(".search");
    if (wrap) wrap.classList.toggle("active", active);
    if (els.searchState) els.searchState.hidden = !active;
    if (els.searchTerm) els.searchTerm.textContent = state.q;
  }

  function renderAll(keepScroll) {
    const fk = focusKey();
    if (keepScroll && els.tags) scrollSeed = els.tags.scrollTop;
    renderCats();
    renderTags();
    renderSel();
    restoreFocus(fk);
    notify();
  }

  function commit() {
    // 自動模式下所有改變（點選、加減、移除、反推加入、隨機）都走同一套排序；
    // 手動模式保留使用者順序，新增只會由 addTags 追加到尾端。
    if (state.sortMode === "auto") state.sel = sortSel(state.sel);
    save();
    renderAll(true);
    try {
      console.log("[tags] t=" + Date.now().toString(36) +
                  " n=" + state.sel.length +
                  " sel=" + state.sel.map(s => s.t).join("|"));
    } catch (e) { /* ignore */ }
  }

  /* ── 隨機配對：分類 slot 產生器 ─────────────────────────── */
  // 正規化：底線／空白互通、大小寫不拘（比對用）
  function norm(s) { return String(s || "").toLowerCase().replace(/[_\s]+/g, " ").trim(); }
  function exactIn(e, list) { const n = norm(e); return list.some(x => norm(x) === n); }
  function isAdultCat(c) { return /^成人[·向]/.test(c); }

  // 名義上放在一般分類、內容其實是成人的標籤。
  // 不靠 isAdult()：它抓 L 裡第一個同名分類，同時出現在一般與成人分類時會誤判。
  const ADULTISH = new Set([
    "ahegao", "extreme ahegao", "tongue out long", "heavy drooling", "rolling eyes",
    "mind break expression", "mind broken pleasure expression", "naughty_face",
    "cute seductive expression", "cute yet seductive expression", "flushed face",
    "no panties", "completely nude from waist down", "sexy lingerie",
    "sundress pulled down to waist",
    "straddling", "cowgirl position", "riding deeply", "hips lowered",
    "hands gripping her own thighs", "fingers mostly hidden behind legs"
  ].map(norm));

  const HAIR_COLORS = ["black", "brown", "blonde", "silver", "white", "pink", "blue", "red", "purple", "green", "gradient", "multicolored"];
  const HAIR_ORNAMENT = ["hair ribbon", "hairband", "hair flower", "hair ornament", "black hairband", "one side up", "single side bun"];
  const EYE_COLORS = ["blue eyes", "red eyes", "green eyes", "purple eyes", "yellow eyes", "brown eyes", "pink eyes", "heterochromia"];
  const NOT_EYE = ["closed eyes", "half-closed eyes", "glowing eyes", "sparkling eyes", "long eyelashes", "delicate eyelashes"];
  const FOOTWEAR = ["thighhighs", "pantyhose", "stockings", "kneehighs", "loafers", "boots", "high heels", "sneakers", "sandals", "barefoot"];
  const COMPOSITION = ["full body", "upper body", "cowboy shot", "portrait", "close-up", "from above", "from below", "from side", "from behind", "dutch angle", "wide shot"];
  const LIGHTING = ["depth of field", "bokeh", "lens flare", "backlighting", "rim light", "cinematic lighting", "soft lighting", "sunlight", "dramatic lighting", "motion blur", "dramatic rim lighting", "soft volumetric lighting", "delicate shadows", "stunning light and shadow", "soft glow", "sparkles", "beautiful caustics"];
  // 場景抽兩個時要避免的矛盾（室內/室外、白天/夜晚）
  const SCENE_EXCL = [["outdoors", "indoors"], ["day", "night", "sunset", "sunrise", "dusk"]];
  // 成人池權重：軟性分類高、R18 低（R18 標籤數量壓倒性，均抽會每次都中它）
  const ADULT_WEIGHT = { "成人向": 5, "成人·服裝內衣": 4, "成人·動作": 4, "成人·五官表情": 3, "成人·身體": 3, "成人·襪子腿飾": 2, "成人·常用組合": 2, "成人·R18": 1 };

  // 把標籤庫切成互不衝突的 family（一個 family 就是一個 slot）
  function buildPools() {
    const p = {};
    const add = (k, e) => { (p[k] || (p[k] = [])).push(e); };
    L.forEach(x => {
      const e = x.e, n = norm(e);
      if (isAdultCat(x.c) || ADULTISH.has(n)) return; // 成人統一由 adult slot 處理
      if (x.c === "常用" || /^已學習·/.test(x.c)) return; // 品質標籤／反推雜訊不進池
      switch (x.c) {
        case "人物":
          if (n !== "solo" && n !== "denia") add("char", e);
          break;
        case "頭髮":
          if (exactIn(e, HAIR_ORNAMENT)) add("hairOrna", e);
          else if (HAIR_COLORS.some(k => n.includes(k))) add("hairColor", e);
          else add("hairStyle", e);
          break;
        case "臉&表情":
          if (exactIn(e, EYE_COLORS)) add("eyes", e);
          else if (!exactIn(e, NOT_EYE) && !n.includes("eyes") && !n.includes("eyelashes")) add("face", e);
          break;
        case "服裝": add("outfit", e); break;
        case "配件":
          if (FOOTWEAR.some(k => n.includes(k))) add("foot", e);
          else add("acc", e);
          break;
        case "動作": add("pose", e); break;
        case "構圖&光影":
          if (exactIn(e, COMPOSITION)) add("comp", e);
          else if (exactIn(e, LIGHTING)) add("light", e);
          break;
        case "場景": add("scene", e); break;
        case "風格": add("style", e); break;
      }
    });
    return p;
  }

  function pickAdultTag() {
    const groups = {};
    L.forEach(x => {
      const c = isAdultCat(x.c) ? x.c : (ADULTISH.has(norm(x.e)) ? "成人向" : null);
      if (c) (groups[c] || (groups[c] = [])).push(x.e);
    });
    const names = Object.keys(groups);
    if (!names.length) return null;
    const weights = names.map(c => ADULT_WEIGHT[c] || 2);
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let ci = 0;
    for (; ci < weights.length; ci++) { r -= weights[ci]; if (r < 0) break; }
    const pool = groups[names[Math.min(ci, names.length - 1)]];
    return pool[Math.floor(Math.random() * pool.length)];
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
        // 既有中文翻譯不得被學習流程覆寫：Z 以「首次建立者」為準
        if (!Object.prototype.hasOwnProperty.call(Z, en)) Z[en] = zh;
      });
    }
  }

  /* ── 跨分頁同步 ─────────────────────────────────────────
     storage event 只會通知「其他」分頁；本分頁的按鈕/輸入仍即時更新 state。
     此處只讀取 localStorage → 更新記憶體 state → 渲染 UI，不呼叫 save()，
     避免把本分頁可能已過期的 state 寫回，也不會產生 storage 寫入迴圈。 */
  function readStoredLearned() {
    try {
      const raw = JSON.parse(localStorage.getItem("ui.learnedTags") || "null");
      if (Array.isArray(raw)) return { general: raw, positive: [], negative: [] };  // 舊格式相容
      if (raw && typeof raw === "object") return {
        general: Array.isArray(raw.general) ? raw.general : [],
        positive: Array.isArray(raw.positive) ? raw.positive : [],
        negative: Array.isArray(raw.negative) ? raw.negative : []
      };
    } catch (e) { /* 壞資料視為空 */ }
    return { general: [], positive: [], negative: [] };
  }

  function syncFromStorage() {
    let changed = false;
    // 統計是唯讀重建：不寫回（破損資料的備份除外），避免同步寫入迴圈
    const statsBefore = statsSignature();
    rebuildStats(false);
    if (statsSignature() !== statsBefore) changed = true;
    // 先讀模式：要不要整理讀入順序取決於它，必須在比較 sel 之前決定
    const mode = localStorage.getItem("ui.selSortMode") === "manual" ? "manual" : "auto";
    if (state.sortMode !== mode) { state.sortMode = mode; changed = true; }
    let storedSel = [];
    try {
      const v = JSON.parse(localStorage.getItem("sel") || "[]");
      if (Array.isArray(v)) {
        // 自動模式：把舊版／他頁可能亂序的 sel 正規化後才比較、採用；
        // 手動模式：來源順序就是使用者指定的順序，原樣保留。
        storedSel = mode === "auto" ? sortSel(v) : v;
      }
    } catch (e) { /* 壞資料保留現有 state */ }
    if (JSON.stringify(storedSel) !== JSON.stringify(state.sel)) {
      state.sel = storedSel;
      changed = true;
    }
    const adult = localStorage.getItem("adult") === "1";
    if (state.adult !== adult) { state.adult = adult; changed = true; }
    const showEn = localStorage.getItem("showEn") === "1";
    if (state.showEn !== showEn) { state.showEn = showEn; changed = true; }
    const learned = readStoredLearned();
    if (JSON.stringify(learned) !== JSON.stringify(state.learned)) {
      state.learned = learned;
      changed = true;
    }
    if (!changed) return false;

    if (!state.adult && isAdultCat(state.cat)) state.cat = "常用";
    const btnEn = $("btnEn");
    if (btnEn) {
      btnEn.classList.toggle("on", state.showEn);
      btnEn.setAttribute("aria-pressed", String(state.showEn));
    }
    if (els.tags) els.tags.classList.toggle("show-en", state.showEn);
    const btnAdult = $("btnAdult");
    if (btnAdult) {
      btnAdult.className = "tool-btn" + (state.adult ? " on" : "");
      btnAdult.setAttribute("aria-pressed", String(state.adult));
    }
    ensureLearnedCategory();
    renderAll(true);   // 只渲染並發 tags:change；不寫 localStorage
    return true;
  }

  const Tags = {
    refresh() { renderAll(true); },
    init() {
      els.cats = $("cats");
      els.tags = $("tags");
      els.selBar = $("selBar");
      els.selCount = $("selCount");
      els.sortModeWrap = $("sortModeWrap");
      els.search = $("search");
      els.searchState = $("searchState");
      els.searchTerm = $("searchTerm");

      // 分類導航左右鍵：只捲動 #cats，不改任何分類狀態或資料
      syncCatArrows = () => {
        const prev = $("catsPrev"), next = $("catsNext");
        if (!prev || !next || !els.cats) return;
        prev.disabled = els.cats.scrollLeft <= 2;
        next.disabled = els.cats.scrollLeft + els.cats.clientWidth >= els.cats.scrollWidth - 2;
      };
      const navCats = dir => {
        if (!els.cats) return;
        els.cats.scrollBy({ left: dir * Math.max(160, Math.round(els.cats.clientWidth * .8)), behavior: "instant" });
      };
      const prev = $("catsPrev"), next = $("catsNext");
      if (prev) prev.onclick = () => navCats(-1);
      if (next) next.onclick = () => navCats(1);
      if (els.cats) els.cats.addEventListener("scroll", syncCatArrows, { passive: true });
      // 滾輪（垂直或水平）直接捲動分類列；到兩端時不攔截，交還給頁面
      const catsWrap = els.cats && els.cats.parentElement;
      if (catsWrap) catsWrap.addEventListener("wheel", e => {
        if (!els.cats) return;
        const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        const max = els.cats.scrollWidth - els.cats.clientWidth;
        if (!d || max <= 1) return;
        if ((d < 0 && els.cats.scrollLeft <= 0) || (d > 0 && els.cats.scrollLeft >= max)) return;
        e.preventDefault();
        els.cats.scrollLeft += d;
      }, { passive: false });
      window.addEventListener("resize", syncCatArrows);

      // 18+ 開關仍由本檔建立（存取邏輯不變），但放進工具列與 EN／隨機成組
      const tools = $("libTools") || document.querySelector(".lib-top");
      const btnAdult = document.createElement("button");
      btnAdult.type = "button";
      btnAdult.id = "btnAdult";
      btnAdult.className = "tool-btn" + (state.adult ? " on" : "");
      btnAdult.textContent = "18+";
      btnAdult.setAttribute("aria-pressed", String(state.adult));
      btnAdult.title = "顯示成人向標籤";
      tools.insertBefore(btnAdult, $("btnRandom") || null);

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
        // 任何成人分類都可能被選（成人向 / 成人·R18 …），關掉 18+ 時一律退回常用，
        // 否則分類列沒有亮著的按鈕，畫面會卡在「找不到」空狀態
        if (isAdultCat(state.cat)) state.cat = "常用";
        renderAll(true);
        save();
      };

      // 排序模式入口用事件委派，renderSel 重繪後不必重新綁定
      if (els.sortModeWrap) els.sortModeWrap.onclick = e => {
        if (e.target.closest("[data-act='autoSort']")) restoreAutoSort();
      };

      // 「搜尋中」膠囊本身就是清除搜尋的入口
      if (els.searchState) els.searchState.onclick = () => {
        state.q = "";
        els.search.value = "";
        scrollSeed = 0;
        syncSearchState();
        renderCats();
        renderTags();
        els.search.focus();
      };

      els.cats.onclick = e => {
        const more = e.target.closest("[data-act='moreCats']");
        if (more) {
          state.moreCats = !state.moreCats;
          save();
          renderAll();
          return;
        }
        const b = e.target.closest(".cat");
        if (!b) return;
        state.cat = b.dataset.c;
        state.q = "";
        els.search.value = "";
        scrollSeed = 0;
        syncSearchState();
        renderAll();
      };

      els.tags.onclick = e => {
        // 收藏優先：點星星只改收藏，绝不連動標籤選取
        const fav = e.target.closest(".tag-fav");
        if (fav) {
          e.preventDefault();
          e.stopPropagation();
          toggleFavorite(fav.dataset.fav);
          return;
        }
        // 分組標題的「快速選擇」沿用既有隨機配一組邏輯
        const act = e.target.closest("[data-grp-act]");
        if (act) {
          if (act.dataset.grpAct === "quick") Tags.applyRandomCombo();
          return;
        }
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
        syncSearchState();
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
      const clearDrag = () => {
        dragFrom = -1;
        if (!els.selBar) return;
        [...els.selBar.querySelectorAll(".pill.dragging")].forEach(p => p.classList.remove("dragging"));
      };
      els.selBar.ondragstart = e => {
        const c = e.target.closest(".pill");
        if (!c) return;
        dragFrom = +c.dataset.i;
        c.classList.add("dragging");
        e.dataTransfer.setData("text/plain", "x");
        e.dataTransfer.effectAllowed = "move";
      };
      // 放手、按 Esc 取消、拖到外面都會觸發 dragend，統一清理狀態
      els.selBar.ondragend = clearDrag;
      els.selBar.ondragover = e => { e.preventDefault(); };
      els.selBar.ondrop = e => {
        e.preventDefault();
        const c = e.target.closest(".pill");
        if (!c || dragFrom < 0) { clearDrag(); return; }
        const to = +c.dataset.i;
        if (to === dragFrom) { clearDrag(); return; }   // 拖到自己：順序不變，也不切模式
        const before = state.sel.map(s => s.t).join("\u0000");
        const [m] = state.sel.splice(dragFrom, 1);
        // 插入點以「放到目標之前」為準；從前往後拖時移除會讓目標索引左移一格
        state.sel.splice(dragFrom < to ? to - 1 : to, 0, m);
        clearDrag();
        if (state.sel.map(s => s.t).join("\u0000") === before) return;
        state.sortMode = "manual";   // 只有真正完成排序才切換
        commit();
      };

      rebuildStats(false);   // 統計只讀重建；開頁不寫回任何統計 key
      ensureLearnedCategory();
      // 舊資料／換頁還原：自動模式下先整理成分類順序；手動模式原樣保留
      if (state.sortMode === "auto") state.sel = sortSel(state.sel);
      renderAll();
      syncSearchState();
    },

    /** 送進模型的提示詞（不含品質標籤，品質由 app.js 加） */
    buildPrompt() {
      const tags = state.sel.map(s => s.w === 1 ? s.t : `(${s.t}:${s.w.toFixed(1)})`);
      const extra = window.Dict.tr(($("pos") && $("pos").value || "").trim());
      if (extra) tags.push(extra);
      return tags.join(", ");
    },

    /** 跨分頁 / 生成前同步：只讀 localStorage 更新狀態與 UI，不寫回 */
    syncFromStorage,

    /* ── Phase 1 個人統計 API（供 app.js 與測試使用）──────── */
    canonicalTag,
    recordGeneration,
    toggleFavorite,
    isFavorite,
    statsSnapshot,
    syncStatsFromStorage() { rebuildStats(false); return true; },
    statsKeys() { return { main: STATS_KEY, evt: EVT_PREFIX, fav: FAV_PREFIX, broken: BROKEN_PREFIX, version: STATS_VERSION }; },

    selected() { return state.sel; },
    snapshot() { return JSON.parse(JSON.stringify(state.sel)); },

    restore(sel) {
      state.sel = JSON.parse(JSON.stringify(sel || []));
      // 歷史快照是需要重現的明確順序：保留原樣並切到手動，
      // 之後新增標籤只會往尾端加，不會被自動排序改寫。
      state.sortMode = "manual";
      commit();
      sortFeedback("已還原原本順序");
    },

    /** 增量加入標籤：不清空、不替換既有選取。回傳實際加入的數量。 */
    addTags(tags) {
      const list = Array.isArray(tags) ? tags : (tags ? [tags] : []);
      let added = 0;
      list.forEach(raw => {
        const t = String(raw || "").trim();
        if (!t || t.includes(",")) return;
        if (state.sel.some(s => s.t === t)) return;
        state.sel.push({ t, w: 1 });
        added++;
      });
      if (added) commit();
      return added;
    },

    /** 反推標籤（底線形式）對應標籤庫裡的英文標籤；找不到回 null。 */
    matchTag(tag) {
      const want = tagAlts(tag);
      if (!want.length) return null;
      for (const x of L) {
        if (tagAlts(x.e).some(h => want.includes(h))) return x.e;
      }
      return null;
    },

    /** 標籤庫裡的中文名（沒有就回空字串） */
    tagZh(tag) { return Z[tag] || ""; },

    /** 這個標籤在標籤庫裡是不是成人向分類 */
    isAdult(tag) {
      const e = this.matchTag(tag) || tag;
      for (const x of L) if (x.e === e) return /^成人[·向]/.test(x.c);
      return false;
    },

    clear() {
      state.sel = [];
      if ($("pos")) $("pos").value = "";
      try { localStorage.removeItem("ui.extra"); } catch (e) { /* 無痕模式：與 surpriseCombo 一致 */ }
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
      let changed = false;
      tags.forEach(raw => {
        const t = String(raw || '').trim();
        if (!t || t.includes(',')) return;
        // 已知中文名優先（Z 是中英對照表），不要用英文覆蓋掉既有翻譯
        const zh = Z[t] || t;
        const idx = state.learned[source].findIndex(x => x.en === t);
        if (idx >= 0) {
          // 已經學過：只補回正確的中文名，不重複新增
          if (state.learned[source][idx].zh !== zh) {
            state.learned[source][idx].zh = zh;
            changed = true;
          }
          return;
        }
        state.learned[source].push({ en: t, zh });
        changed = true;
      });
      if (!changed) return;
      if (state.learned[source].length > 200) state.learned[source] = state.learned[source].slice(-200);
      saveLearned();   // 只寫 ui.learnedTags，不覆蓋其他分頁最新的 sel/adult/showEn
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
      saveLearned();   // 同上：清空學習標籤也不動 sel/adult/showEn
      renderAll(true);
    },

    hasContent() {
      return state.sel.length > 0 || !!($("pos") && $("pos").value.trim());
    },

    applyRandomCombo() {
      const p = buildPools();
      const out = [];
      const conflicts = (t, groups) => groups.some(g =>
        g.some(x => norm(x) === norm(t)) && out.some(c => g.some(x => norm(x) === norm(c))));
      // 從一個 family 不重複抽 n 個；groups 可排除既有衝突（例如室內 + 室外）
      const take = (key, n, groups) => {
        const copy = (p[key] || []).slice();
        let got = 0;
        while (got < n && copy.length) {
          const t = copy.splice(Math.floor(Math.random() * copy.length), 1)[0];
          if (groups && conflicts(t, groups)) continue;
          out.push(t);
          got++;
        }
      };

      // 骨架：每個 family 只抽一次 → 天然避開長髮+短髮、藍眼+紅眼、制服+和服等矛盾
      take("char", 1);
      take("hairStyle", 1);
      take("hairColor", 1);
      take("face", 1);
      take("eyes", Math.random() < 0.7 ? 1 : 0);
      take("outfit", 1);
      take("foot", Math.random() < 0.5 ? 1 : 0);
      take("acc", Math.random() < 0.5 ? 1 : 0);
      take("pose", 1);
      take("comp", 1);
      take("light", Math.random() < 0.7 ? 1 : 0);
      take("scene", 1 + (Math.random() < 0.4 ? 1 : 0), SCENE_EXCL);
      take("style", Math.random() < 0.6 ? 1 : 0);

      // 成人：完全跟著 18+ 開關；開時抽 1~2 個，軟性分類權重較高
      if (state.adult) {
        const n = 1 + (Math.random() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const t = pickAdultTag();
          if (t) out.push(t);
        }
      }

      // 去重（同名標籤可能同時出現在不同分類），並維持既有 {t, w} 格式
      const seen = new Set();
      state.sel = out.map(t => String(t).trim()).filter(t => {
        const k = norm(t);
        if (!t || seen.has(k)) return false;
        seen.add(k);
        return true;
      }).map(t => ({ t, w: 1 }));
      // 隨機是整組重選，沿用自動分類排序（即使原本是手動模式）
      state.sortMode = "auto";
      commit();
      return state.adult ? "隨機組合（18+）" : "隨機組合";
    },

    /** 產生分類圖示缺圖時的文字替代 */
    _initial(c) {
      const span = document.createElement("span");
      span.className = "cat-initial";
      span.textContent = (c === "成人向" || String(c).startsWith("成人·")) ? "成"
        : (String(c).startsWith("已學習·") ? "學" : c[0]);
      return span;
    }
  };

  window.Tags = Tags;
})();
