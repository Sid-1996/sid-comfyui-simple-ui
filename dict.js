/* ============================================================
   dict.js — 中文詞 → Danbooru 標籤對照
   給「補充描述」用：直接打中文，這裡負責翻譯成模型看得懂的標籤。
   新增詞彙：照 "中文":"english tag", 的格式加一行即可。
   ============================================================ */
(function () {
  const DICT = {
"兩個女孩":"2girls","女孩":"1girl","少女":"1girl","女生":"1girl","男孩":"1boy","少年":"1boy","男生":"1boy","單人":"solo","一個人":"solo","成熟女性":"mature female","御姐":"mature female",
"長髮":"long hair","短髮":"short hair","雙馬尾":"twintails","馬尾":"ponytail","黑髮":"black hair","金髮":"blonde hair","銀髮":"silver hair","白髮":"white hair","粉紅髮":"pink hair","粉髮":"pink hair","藍髮":"blue hair","紅髮":"red hair","棕髮":"brown hair","紫髮":"purple hair","瀏海":"bangs","捲髮":"curly hair",
"藍眼":"blue eyes","紅眼":"red eyes","綠眼":"green eyes","紫眼":"purple eyes","金眼":"yellow eyes","黑眼":"black eyes","棕眼":"brown eyes",
"微笑":"smile","大笑":"laughing","臉紅":"blush","害羞":"embarrassed","生氣":"angry","哭泣":"crying","認真":"serious","閉眼":"closed eyes","眨眼":"wink","驚訝":"surprised",
"水手服":"serafuku","學生制服":"school uniform","制服":"school uniform","和服":"kimono","浴衣":"yukata","白色洋裝":"white dress","洋裝":"dress","女僕裝":"maid","泳裝":"swimsuit","比基尼":"bikini","襯衫":"white shirt","短裙":"miniskirt","裙子":"skirt","過膝襪":"thighhighs","絲襪":"thighhighs","褲襪":"pantyhose","眼鏡":"glasses","帽子":"hat","外套":"jacket","連帽衫":"hoodie","圍巾":"scarf","領結":"bowtie","睡衣":"pajamas","兔女郎":"playboy bunny","護士":"nurse","貓耳":"cat ears","狐耳":"fox ears","兔耳":"rabbit ears","尾巴":"tail","翅膀":"wings",
"成人向":"nsfw","內衣":"lingerie","內褲":"panties","半裸":"topless","裸體":"nude","乳溝":"cleavage","巨乳":"huge breasts","大胸部":"large breasts","貧乳":"small breasts",
"戶外":"outdoors","室內":"indoors","臥室":"bedroom","教室":"classroom","海灘":"beach","城市":"city","夜景":"night","夜晚":"night","白天":"day","夕陽":"sunset","下雨":"rain","下雪":"snow","森林":"forest","櫻花":"cherry blossoms","星空":"starry sky","祭典":"festival","燈籠":"lanterns","咖啡廳":"cafe","窗邊":"by the window","花朵":"flowers","天空":"sky","月亮":"moon","大海":"ocean","屋頂":"rooftop","床上":"on bed","白色背景":"white background","簡單背景":"simple background",
"全身":"full body","半身":"upper body","臉部特寫":"portrait","特寫":"close-up","俯視":"from above","仰視":"from below","側面":"from side","背面":"from behind","看向觀眾":"looking at viewer","回頭":"looking back",
"坐著":"sitting","站著":"standing","躺著":"lying","奔跑":"running","跳舞":"dancing","揮手":"waving","拿著":"holding","睡覺":"sleeping",
"水彩":"watercolor","賽博龐克":"cyberpunk","奇幻":"fantasy"
  };

  const KEYS = Object.keys(DICT).sort((a, b) => b.length - a.length);

  /** 把中文描述翻成英文標籤；keep=true 時保留翻不掉的中文（給警告用） */
  function tr(s, keep) {
    let t = String(s || "").replace(/[，、；;\n]+/g, ",");
    for (const k of KEYS) t = t.split(k).join("," + DICT[k] + ",");
    return t.split(",")
      .map(x => x.trim())
      .filter(Boolean)
      .filter(x => keep || !/[\u4e00-\u9fff]/.test(x))
      .filter((x, i, a) => a.indexOf(x) === i)
      .join(", ");
  }

  /** 回傳翻不掉的中文詞（介面用來提示換個說法） */
  function leftover(s) {
    return [...new Set(tr(s, true).match(/[\u4e00-\u9fff]+/g) || [])];
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  window.Dict = { DICT, tr, leftover, esc };
})();
