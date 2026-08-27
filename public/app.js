const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const view=$("#view"),pageTitle=$("#pageTitle"),audioPlayer=$("#audioPlayer"),remoteAudio=$("#remoteAudio");
const STORE="aiEnglishProfileV1";
const baseProfile={weaknesses:[],stats:{sessions:0,missions:0,phraseTests:0,listeningSets:0,fluencySets:0,perfectListening:0,chunkSets:0,chunkItems:0,chunkMastered:0},listeningPerfectStreak:{},chunkProgress:{},chunkCustom:[],history:[]};
let profile=loadProfile(),state={mode:"home",phrase:null,listening:null,fluency:null,mission:null,chunks:null,missionPreset:null};
let pc=null,dc=null,mic=null,missionConnected=false,transcript=[],currentAssistant="",captionOn=false,missionFinishing=false;
function loadProfile(){
  try{
    const raw=JSON.parse(localStorage.getItem(STORE)||"{}");
    return {
      ...baseProfile,...raw,
      stats:{...baseProfile.stats,...(raw.stats||{})},
      listeningPerfectStreak:{...(raw.listeningPerfectStreak||{})},
      chunkProgress:{...(raw.chunkProgress||{})},
      chunkCustom:Array.isArray(raw.chunkCustom)?raw.chunkCustom:[],
      weaknesses:Array.isArray(raw.weaknesses)?raw.weaknesses:[],
      history:Array.isArray(raw.history)?raw.history:[]
    };
  }catch{return structuredClone(baseProfile)}
}
function saveProfile(){localStorage.setItem(STORE,JSON.stringify(profile))}
function esc(v=""){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}function norm(s=""){return String(s).toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g," ").trim()}
function step(n,t){return `<div class="step"><b>STEP ${n}/${t}</b><div class="track"><div class="fill" style="width:${n/t*100}%"></div></div></div>`}function chips(a,id){return `<div class="chips">${a.map(x=>`<button class="chip" type="button" data-fill="${esc(x)}" data-target="${id}">${esc(x)}</button>`).join("")}</div>`}function loading(t){view.innerHTML=`<div class="card loading"><div class="spinner"></div><b>${esc(t)}</b></div>`}function toast(t){view.insertAdjacentHTML("afterbegin",`<div class="toast">${esc(t)}</div>`);setTimeout(()=>$(".toast")?.remove(),2200)}
async function api(path,body={}){const r=await fetch("/api/"+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json().catch(()=>({error:"Invalid response"}));if(!r.ok)throw new Error(d.error||`API error ${r.status}`);return d}
async function playTTS(text,speed=1){audioPlayer.pause();const r=await fetch("/api/tts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,speed})});if(!r.ok)return toast("音声生成に失敗しました");const blob=await r.blob(),url=URL.createObjectURL(blob);audioPlayer.src=url;await audioPlayer.play().catch(()=>{});audioPlayer.onended=()=>URL.revokeObjectURL(url)}
function addWeakness(w,source="practice"){if(!w||!w.better)return;const key=norm((w.type||"expression")+" "+w.better);let item=profile.weaknesses.find(x=>x.key===key);if(!item){item={key,type:w.type||"expression",label:w.label||w.ja||w.better,original:w.original||"",better:w.better,ja:w.ja||"",errors:0,successes:0,level:1,graduated:false,lastSeen:"",sources:[]};profile.weaknesses.push(item)}item.errors++;item.lastSeen=new Date().toISOString();if(!item.sources.includes(source))item.sources.push(source);const hinted=Number(w.severityHint||0);item.level=Math.max(hinted,item.errors>=5?3:item.errors>=3?2:1);item.graduated=false;saveProfile()}
function markWeakSuccess(text){const n=norm(text),item=profile.weaknesses.find(x=>norm(x.better)===n||norm(x.label)===n);if(!item)return;item.successes++;if(item.successes>=3&&item.successes>=item.errors){item.graduated=true;item.level=0}else if(item.successes>=2&&item.level>1)item.level--;saveProfile()}
function levelBadge(w){if(w.graduated)return `<span class="levelBadge graduated">卒業</span>`;return `<span class="levelBadge lv${w.level}">${w.level===3?"重点":w.level===2?"苦手":"要注意"}</span>`}function activeWeaknesses(){return profile.weaknesses.filter(x=>!x.graduated).sort((a,b)=>(b.level-a.level)||((b.errors-b.successes)-(a.errors-a.successes)))}
function achievements(){const s=profile.stats;return[{icon:"🌱",name:"First Step",desc:"最初の練習を完了",ok:s.sessions>=1},{icon:"🎯",name:"Mission Starter",desc:"ミッション英会話を3回完了",ok:s.missions>=3},{icon:"🗣️",name:"Voice Builder",desc:"流暢性を5セット",ok:s.fluencySets>=5},{icon:"👂",name:"Meaning Catcher",desc:"リスニング満点を3回",ok:s.perfectListening>=3},{icon:"🔥",name:"20 Sessions",desc:"累計20セット",ok:s.sessions>=20},{icon:"🏆",name:"50 Sessions",desc:"累計50セット",ok:s.sessions>=50}]}

function logSession(type,detail={}){profile.stats.sessions++;profile.history.unshift({at:new Date().toISOString(),type,...detail});profile.history=profile.history.slice(0,80);saveProfile()}

/*
 APP5 frequency/usefulness bank.
 Phrasal verb ranks are BNC ranks (Gardner & Davies list as reproduced in corpus-based studies).
 General chunks intentionally do NOT claim exact corpus ranks.
*/
const CHUNK_BANK=[{"id":"c001","expression":"I'd like ...","type":"chunk","meaning":"〜をお願いします／〜したいです","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":1},{"id":"c002","expression":"Can I ...?","type":"chunk","meaning":"〜してもいいですか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":2},{"id":"c003","expression":"Could you ...?","type":"chunk","meaning":"〜していただけますか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":3},{"id":"c004","expression":"Do you think ...?","type":"chunk","meaning":"〜だと思いますか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":4},{"id":"c005","expression":"I think ...","type":"chunk","meaning":"〜だと思います","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":5},{"id":"c006","expression":"I guess ...","type":"chunk","meaning":"たぶん〜だと思います","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":6},{"id":"c007","expression":"I'm not sure ...","type":"chunk","meaning":"〜かよく分かりません","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":7},{"id":"c008","expression":"It depends on ...","type":"chunk","meaning":"〜によります","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":8},{"id":"c009","expression":"I'm looking for ...","type":"chunk","meaning":"〜を探しています","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":9},{"id":"c010","expression":"I need to ...","type":"chunk","meaning":"〜する必要があります","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":10},{"id":"c011","expression":"I'm trying to ...","type":"chunk","meaning":"〜しようとしています","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":11},{"id":"c012","expression":"How about ...?","type":"chunk","meaning":"〜はどうですか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":12},{"id":"c013","expression":"What do you mean?","type":"chunk","meaning":"どういう意味ですか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":13},{"id":"c014","expression":"That sounds ...","type":"chunk","meaning":"それは〜そうですね","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":14},{"id":"c015","expression":"Let me ...","type":"chunk","meaning":"〜しますね／私に〜させてください","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":15},{"id":"c016","expression":"How long does it take?","type":"chunk","meaning":"どのくらい時間がかかりますか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":16},{"id":"c017","expression":"How much is it?","type":"chunk","meaning":"いくらですか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":17},{"id":"c018","expression":"What time does ...?","type":"chunk","meaning":"〜は何時ですか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":18},{"id":"c019","expression":"Where can I ...?","type":"chunk","meaning":"どこで〜できますか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":19},{"id":"c020","expression":"Is there ...?","type":"chunk","meaning":"〜はありますか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":20},{"id":"c021","expression":"Do you have ...?","type":"chunk","meaning":"〜はありますか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":21},{"id":"c022","expression":"I'd rather ...","type":"chunk","meaning":"むしろ〜したいです","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":22},{"id":"c023","expression":"I'd better ...","type":"chunk","meaning":"〜したほうがよさそうです","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":23},{"id":"c024","expression":"I'd love to ...","type":"chunk","meaning":"ぜひ〜したいです","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":24},{"id":"c025","expression":"I'd like to know ...","type":"chunk","meaning":"〜を知りたいです","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":25},{"id":"c026","expression":"Could I have ...?","type":"chunk","meaning":"〜をいただけますか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":26},{"id":"c027","expression":"Could I get ...?","type":"chunk","meaning":"〜をもらえますか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":27},{"id":"c028","expression":"Could you tell me ...?","type":"chunk","meaning":"〜を教えていただけますか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":28},{"id":"c029","expression":"Could you help me ...?","type":"chunk","meaning":"〜を手伝っていただけますか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":29},{"id":"c030","expression":"Can you show me ...?","type":"chunk","meaning":"〜を見せてもらえますか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":30},{"id":"c031","expression":"Can you say that again?","type":"chunk","meaning":"もう一度言ってもらえますか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":31},{"id":"c032","expression":"Could you speak more slowly?","type":"chunk","meaning":"もう少しゆっくり話してもらえますか？","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":32},{"id":"c033","expression":"I didn't catch that.","type":"chunk","meaning":"聞き取れませんでした","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":33},{"id":"c034","expression":"I don't understand.","type":"chunk","meaning":"分かりません","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":34},{"id":"c035","expression":"I see what you mean.","type":"chunk","meaning":"言いたいことは分かります","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":35},{"id":"c036","expression":"That makes sense.","type":"chunk","meaning":"なるほど／筋が通っています","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":36},{"id":"c037","expression":"I don't think so.","type":"chunk","meaning":"そうは思いません","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":37},{"id":"c038","expression":"I hope so.","type":"chunk","meaning":"そうだといいです","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":38},{"id":"c039","expression":"I hope not.","type":"chunk","meaning":"そうでないといいです","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":39},{"id":"c040","expression":"I'm afraid ...","type":"chunk","meaning":"残念ですが〜／心配ですが〜","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":40},{"id":"c041","expression":"As far as I know ...","type":"chunk","meaning":"私の知る限りでは〜","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":41},{"id":"c042","expression":"As far as I can tell ...","type":"chunk","meaning":"分かる範囲では〜","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":42},{"id":"c043","expression":"The thing is ...","type":"chunk","meaning":"実は〜／問題は〜","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":43},{"id":"c044","expression":"The point is ...","type":"chunk","meaning":"要するに〜","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":44},{"id":"c045","expression":"In that case ...","type":"chunk","meaning":"その場合は〜","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":45},{"id":"c046","expression":"For example ...","type":"chunk","meaning":"例えば〜","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":46},{"id":"c047","expression":"For now ...","type":"chunk","meaning":"今のところは〜","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":47},{"id":"c048","expression":"At least ...","type":"chunk","meaning":"少なくとも〜","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":48},{"id":"c049","expression":"By the way ...","type":"chunk","meaning":"ところで〜","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":49},{"id":"c050","expression":"Actually ...","type":"chunk","meaning":"実は〜","band":"CORE","basis":"spoken-use / COCA n-gram informed","priority":50},{"id":"c051","expression":"Basically ...","type":"chunk","meaning":"基本的には〜","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":51},{"id":"c052","expression":"Probably ...","type":"chunk","meaning":"おそらく〜","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":52},{"id":"c053","expression":"Maybe we can ...","type":"chunk","meaning":"〜できるかもしれません","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":53},{"id":"c054","expression":"Why don't we ...?","type":"chunk","meaning":"〜しませんか？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":54},{"id":"c055","expression":"Would you like to ...?","type":"chunk","meaning":"〜しませんか？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":55},{"id":"c056","expression":"Would it be possible to ...?","type":"chunk","meaning":"〜することは可能ですか？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":56},{"id":"c057","expression":"Is it possible to ...?","type":"chunk","meaning":"〜することは可能ですか？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":57},{"id":"c058","expression":"Is it okay if I ...?","type":"chunk","meaning":"〜しても大丈夫ですか？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":58},{"id":"c059","expression":"Do I need to ...?","type":"chunk","meaning":"〜する必要がありますか？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":59},{"id":"c060","expression":"Do I have to ...?","type":"chunk","meaning":"〜しなければなりませんか？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":60},{"id":"c061","expression":"I'm going to ...","type":"chunk","meaning":"〜するつもりです","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":61},{"id":"c062","expression":"I'm about to ...","type":"chunk","meaning":"今から〜するところです","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":62},{"id":"c063","expression":"I used to ...","type":"chunk","meaning":"以前は〜していました","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":63},{"id":"c064","expression":"I'm used to ...","type":"chunk","meaning":"〜に慣れています","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":64},{"id":"c065","expression":"I'm interested in ...","type":"chunk","meaning":"〜に興味があります","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":65},{"id":"c066","expression":"I'm good at ...","type":"chunk","meaning":"〜が得意です","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":66},{"id":"c067","expression":"I'm not good at ...","type":"chunk","meaning":"〜が苦手です","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":67},{"id":"c068","expression":"I'm worried about ...","type":"chunk","meaning":"〜が心配です","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":68},{"id":"c069","expression":"I'm happy with ...","type":"chunk","meaning":"〜に満足しています","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":69},{"id":"c070","expression":"I'm sorry about ...","type":"chunk","meaning":"〜についてすみません","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":70},{"id":"c071","expression":"Thanks for ...","type":"chunk","meaning":"〜してくれてありがとう","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":71},{"id":"c072","expression":"Sorry to ...","type":"chunk","meaning":"〜してすみません","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":72},{"id":"c073","expression":"Excuse me, ...","type":"chunk","meaning":"すみませんが〜","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":73},{"id":"c074","expression":"No problem.","type":"chunk","meaning":"問題ありません","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":74},{"id":"c075","expression":"That's okay.","type":"chunk","meaning":"大丈夫です","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":75},{"id":"c076","expression":"That's fine.","type":"chunk","meaning":"それで大丈夫です","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":76},{"id":"c077","expression":"Sounds good.","type":"chunk","meaning":"いいですね","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":77},{"id":"c078","expression":"That works for me.","type":"chunk","meaning":"私はそれで大丈夫です","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":78},{"id":"c079","expression":"It's up to you.","type":"chunk","meaning":"あなたに任せます","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":79},{"id":"c080","expression":"It's okay with me.","type":"chunk","meaning":"私はそれで構いません","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":80},{"id":"c081","expression":"I'm on my way.","type":"chunk","meaning":"今向かっています","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":81},{"id":"c082","expression":"I'll be right back.","type":"chunk","meaning":"すぐ戻ります","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":82},{"id":"c083","expression":"I'll let you know.","type":"chunk","meaning":"分かったら知らせます","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":83},{"id":"c084","expression":"Let me know.","type":"chunk","meaning":"知らせてください","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":84},{"id":"c085","expression":"Let me check.","type":"chunk","meaning":"確認します","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":85},{"id":"c086","expression":"Let me see.","type":"chunk","meaning":"ちょっと見てみます","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":86},{"id":"c087","expression":"Give me a minute.","type":"chunk","meaning":"少し時間をください","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":87},{"id":"c088","expression":"Just a moment.","type":"chunk","meaning":"少々お待ちください","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":88},{"id":"c089","expression":"Take your time.","type":"chunk","meaning":"ゆっくりで大丈夫です","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":89},{"id":"c090","expression":"Here you are.","type":"chunk","meaning":"どうぞ","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":90},{"id":"c091","expression":"That's all.","type":"chunk","meaning":"以上です／それだけです","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":91},{"id":"c092","expression":"Anything else?","type":"chunk","meaning":"ほかにありますか？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":92},{"id":"c093","expression":"What about ...?","type":"chunk","meaning":"〜はどうですか？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":93},{"id":"c094","expression":"What kind of ...?","type":"chunk","meaning":"どんな種類の〜？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":94},{"id":"c095","expression":"Which one ...?","type":"chunk","meaning":"どちら／どれ〜？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":95},{"id":"c096","expression":"How often ...?","type":"chunk","meaning":"どのくらいの頻度で〜？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":96},{"id":"c097","expression":"How far ...?","type":"chunk","meaning":"どのくらい遠いですか？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":97},{"id":"c098","expression":"How soon ...?","type":"chunk","meaning":"どのくらいですぐ〜？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":98},{"id":"c099","expression":"What happened?","type":"chunk","meaning":"何があったの？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":99},{"id":"c100","expression":"What's going on?","type":"chunk","meaning":"どうなっているの？","band":"HIGH","basis":"spoken-use / COCA n-gram informed","priority":100},{"id":"pv001","expression":"go on","type":"phrasal","meaning":"続く／続ける","band":"CORE","basis":"BNC Gardner-Davies","rank":1,"priority":1},{"id":"pv002","expression":"carry out","type":"phrasal","meaning":"実行する","band":"CORE","basis":"BNC Gardner-Davies","rank":2,"priority":2},{"id":"pv003","expression":"set up","type":"phrasal","meaning":"準備する／設置する","band":"CORE","basis":"BNC Gardner-Davies","rank":3,"priority":3},{"id":"pv004","expression":"pick up","type":"phrasal","meaning":"拾う／受け取る／迎える","band":"CORE","basis":"BNC Gardner-Davies","rank":4,"priority":4},{"id":"pv005","expression":"go back","type":"phrasal","meaning":"戻る","band":"CORE","basis":"BNC Gardner-Davies","rank":5,"priority":5},{"id":"pv006","expression":"come back","type":"phrasal","meaning":"戻ってくる","band":"CORE","basis":"BNC Gardner-Davies","rank":6,"priority":6},{"id":"pv007","expression":"go out","type":"phrasal","meaning":"外出する","band":"CORE","basis":"BNC Gardner-Davies","rank":7,"priority":7},{"id":"pv008","expression":"point out","type":"phrasal","meaning":"指摘する","band":"CORE","basis":"BNC Gardner-Davies","rank":8,"priority":8},{"id":"pv009","expression":"find out","type":"phrasal","meaning":"調べて分かる","band":"CORE","basis":"BNC Gardner-Davies","rank":9,"priority":9},{"id":"pv010","expression":"come up","type":"phrasal","meaning":"話題などが出てくる","band":"CORE","basis":"BNC Gardner-Davies","rank":10,"priority":10},{"id":"pv011","expression":"make up","type":"phrasal","meaning":"作る／構成する","band":"CORE","basis":"BNC Gardner-Davies","rank":11,"priority":11},{"id":"pv012","expression":"take over","type":"phrasal","meaning":"引き継ぐ","band":"CORE","basis":"BNC Gardner-Davies","rank":12,"priority":12},{"id":"pv013","expression":"come out","type":"phrasal","meaning":"出る／発売される","band":"CORE","basis":"BNC Gardner-Davies","rank":13,"priority":13},{"id":"pv014","expression":"come on","type":"phrasal","meaning":"始まる／さあ","band":"CORE","basis":"BNC Gardner-Davies","rank":14,"priority":14},{"id":"pv015","expression":"come in","type":"phrasal","meaning":"入ってくる","band":"CORE","basis":"BNC Gardner-Davies","rank":15,"priority":15},{"id":"pv016","expression":"go down","type":"phrasal","meaning":"下がる","band":"CORE","basis":"BNC Gardner-Davies","rank":16,"priority":16},{"id":"pv017","expression":"work out","type":"phrasal","meaning":"うまくいく／解決する","band":"CORE","basis":"BNC Gardner-Davies","rank":17,"priority":17},{"id":"pv018","expression":"set out","type":"phrasal","meaning":"出発する／着手する","band":"CORE","basis":"BNC Gardner-Davies","rank":18,"priority":18},{"id":"pv019","expression":"take up","type":"phrasal","meaning":"始める／占める","band":"CORE","basis":"BNC Gardner-Davies","rank":19,"priority":19},{"id":"pv020","expression":"get back","type":"phrasal","meaning":"戻る／取り戻す","band":"CORE","basis":"BNC Gardner-Davies","rank":20,"priority":20},{"id":"pv021","expression":"sit down","type":"phrasal","meaning":"座る","band":"CORE","basis":"BNC Gardner-Davies","rank":21,"priority":21},{"id":"pv022","expression":"turn out","type":"phrasal","meaning":"結果的に〜となる","band":"CORE","basis":"BNC Gardner-Davies","rank":22,"priority":22},{"id":"pv023","expression":"take on","type":"phrasal","meaning":"引き受ける","band":"CORE","basis":"BNC Gardner-Davies","rank":23,"priority":23},{"id":"pv024","expression":"give up","type":"phrasal","meaning":"諦める","band":"CORE","basis":"BNC Gardner-Davies","rank":24,"priority":24},{"id":"pv025","expression":"get up","type":"phrasal","meaning":"起きる／立つ","band":"CORE","basis":"BNC Gardner-Davies","rank":25,"priority":25},{"id":"pv026","expression":"look up","type":"phrasal","meaning":"調べる","band":"HIGH","basis":"BNC Gardner-Davies","rank":26,"priority":26},{"id":"pv027","expression":"carry on","type":"phrasal","meaning":"続ける","band":"HIGH","basis":"BNC Gardner-Davies","rank":27,"priority":27},{"id":"pv028","expression":"go up","type":"phrasal","meaning":"上がる","band":"HIGH","basis":"BNC Gardner-Davies","rank":28,"priority":28},{"id":"pv029","expression":"get out","type":"phrasal","meaning":"外へ出る","band":"HIGH","basis":"BNC Gardner-Davies","rank":29,"priority":29},{"id":"pv030","expression":"take out","type":"phrasal","meaning":"取り出す／持ち帰る","band":"HIGH","basis":"BNC Gardner-Davies","rank":30,"priority":30},{"id":"pv031","expression":"come down","type":"phrasal","meaning":"下がる／降りる","band":"HIGH","basis":"BNC Gardner-Davies","rank":31,"priority":31},{"id":"pv032","expression":"put down","type":"phrasal","meaning":"置く／書き留める","band":"HIGH","basis":"BNC Gardner-Davies","rank":32,"priority":32},{"id":"pv033","expression":"put up","type":"phrasal","meaning":"掲げる／泊める","band":"HIGH","basis":"BNC Gardner-Davies","rank":33,"priority":33},{"id":"pv034","expression":"turn up","type":"phrasal","meaning":"現れる／音量を上げる","band":"HIGH","basis":"BNC Gardner-Davies","rank":34,"priority":34},{"id":"pv035","expression":"get on","type":"phrasal","meaning":"乗る／うまくやる","band":"HIGH","basis":"BNC Gardner-Davies","rank":35,"priority":35},{"id":"pv036","expression":"bring up","type":"phrasal","meaning":"話題に出す／育てる","band":"HIGH","basis":"BNC Gardner-Davies","rank":36,"priority":36},{"id":"pv037","expression":"bring in","type":"phrasal","meaning":"持ち込む／導入する","band":"HIGH","basis":"BNC Gardner-Davies","rank":37,"priority":37},{"id":"pv038","expression":"look back","type":"phrasal","meaning":"振り返る","band":"HIGH","basis":"BNC Gardner-Davies","rank":38,"priority":38},{"id":"pv039","expression":"look down","type":"phrasal","meaning":"見下ろす","band":"HIGH","basis":"BNC Gardner-Davies","rank":39,"priority":39},{"id":"pv040","expression":"bring back","type":"phrasal","meaning":"持ち帰る／思い出させる","band":"HIGH","basis":"BNC Gardner-Davies","rank":40,"priority":40},{"id":"pv041","expression":"break down","type":"phrasal","meaning":"故障する／分解する","band":"HIGH","basis":"BNC Gardner-Davies","rank":41,"priority":41},{"id":"pv042","expression":"take off","type":"phrasal","meaning":"脱ぐ／離陸する","band":"HIGH","basis":"BNC Gardner-Davies","rank":42,"priority":42},{"id":"pv043","expression":"go off","type":"phrasal","meaning":"鳴る／立ち去る","band":"HIGH","basis":"BNC Gardner-Davies","rank":43,"priority":43},{"id":"pv044","expression":"bring about","type":"phrasal","meaning":"引き起こす","band":"HIGH","basis":"BNC Gardner-Davies","rank":44,"priority":44},{"id":"pv045","expression":"go in","type":"phrasal","meaning":"中に入る","band":"HIGH","basis":"BNC Gardner-Davies","rank":45,"priority":45},{"id":"pv046","expression":"set off","type":"phrasal","meaning":"出発する／作動させる","band":"HIGH","basis":"BNC Gardner-Davies","rank":46,"priority":46},{"id":"pv047","expression":"put out","type":"phrasal","meaning":"消す／出す","band":"HIGH","basis":"BNC Gardner-Davies","rank":47,"priority":47},{"id":"pv048","expression":"look out","type":"phrasal","meaning":"気をつける","band":"HIGH","basis":"BNC Gardner-Davies","rank":48,"priority":48},{"id":"pv049","expression":"take back","type":"phrasal","meaning":"返す／撤回する","band":"HIGH","basis":"BNC Gardner-Davies","rank":49,"priority":49},{"id":"pv050","expression":"hold up","type":"phrasal","meaning":"遅らせる／持ち上げる","band":"HIGH","basis":"BNC Gardner-Davies","rank":50,"priority":50},{"id":"pv051","expression":"get down","type":"phrasal","meaning":"降りる／書き留める","band":"HIGH","basis":"BNC Gardner-Davies","rank":51,"priority":51},{"id":"pv052","expression":"hold out","type":"phrasal","meaning":"持ちこたえる／差し出す","band":"HIGH","basis":"BNC Gardner-Davies","rank":52,"priority":52},{"id":"pv053","expression":"put on","type":"phrasal","meaning":"着る／つける","band":"HIGH","basis":"BNC Gardner-Davies","rank":53,"priority":53},{"id":"pv054","expression":"bring out","type":"phrasal","meaning":"引き出す／発売する","band":"HIGH","basis":"BNC Gardner-Davies","rank":54,"priority":54},{"id":"pv055","expression":"move on","type":"phrasal","meaning":"先へ進む","band":"HIGH","basis":"BNC Gardner-Davies","rank":55,"priority":55},{"id":"pv056","expression":"turn back","type":"phrasal","meaning":"引き返す","band":"HIGH","basis":"BNC Gardner-Davies","rank":56,"priority":56},{"id":"pv057","expression":"put back","type":"phrasal","meaning":"元に戻す","band":"HIGH","basis":"BNC Gardner-Davies","rank":57,"priority":57},{"id":"pv058","expression":"go round","type":"phrasal","meaning":"回る／訪ねる","band":"HIGH","basis":"BNC Gardner-Davies","rank":58,"priority":58},{"id":"pv059","expression":"break up","type":"phrasal","meaning":"別れる／解散する","band":"HIGH","basis":"BNC Gardner-Davies","rank":59,"priority":59},{"id":"pv060","expression":"come along","type":"phrasal","meaning":"一緒に来る／進む","band":"HIGH","basis":"BNC Gardner-Davies","rank":60,"priority":60},{"id":"pv061","expression":"sit up","type":"phrasal","meaning":"起き上がって座る","band":"HIGH","basis":"BNC Gardner-Davies","rank":61,"priority":61},{"id":"pv062","expression":"turn round","type":"phrasal","meaning":"振り向く／好転させる","band":"HIGH","basis":"BNC Gardner-Davies","rank":62,"priority":62},{"id":"pv063","expression":"get in","type":"phrasal","meaning":"入る／到着する","band":"HIGH","basis":"BNC Gardner-Davies","rank":63,"priority":63},{"id":"pv064","expression":"come round","type":"phrasal","meaning":"訪ねてくる／意識を戻す","band":"HIGH","basis":"BNC Gardner-Davies","rank":64,"priority":64},{"id":"pv065","expression":"make out","type":"phrasal","meaning":"理解する／見分ける","band":"HIGH","basis":"BNC Gardner-Davies","rank":65,"priority":65},{"id":"pv066","expression":"get off","type":"phrasal","meaning":"降りる","band":"HIGH","basis":"BNC Gardner-Davies","rank":66,"priority":66},{"id":"pv067","expression":"turn down","type":"phrasal","meaning":"断る／音量を下げる","band":"HIGH","basis":"BNC Gardner-Davies","rank":67,"priority":67},{"id":"pv068","expression":"bring down","type":"phrasal","meaning":"下げる／倒す","band":"HIGH","basis":"BNC Gardner-Davies","rank":68,"priority":68},{"id":"pv069","expression":"come over","type":"phrasal","meaning":"訪ねてくる","band":"HIGH","basis":"BNC Gardner-Davies","rank":69,"priority":69},{"id":"pv070","expression":"break out","type":"phrasal","meaning":"突然起こる","band":"HIGH","basis":"BNC Gardner-Davies","rank":70,"priority":70},{"id":"pv071","expression":"go over","type":"phrasal","meaning":"見直す／確認する","band":"HIGH","basis":"BNC Gardner-Davies","rank":71,"priority":71},{"id":"pv072","expression":"turn over","type":"phrasal","meaning":"ひっくり返す／引き渡す","band":"HIGH","basis":"BNC Gardner-Davies","rank":72,"priority":72},{"id":"pv073","expression":"go through","type":"phrasal","meaning":"経験する／確認する","band":"HIGH","basis":"BNC Gardner-Davies","rank":73,"priority":73},{"id":"pv074","expression":"hold on","type":"phrasal","meaning":"待つ／つかまる","band":"HIGH","basis":"BNC Gardner-Davies","rank":74,"priority":74},{"id":"pv075","expression":"pick out","type":"phrasal","meaning":"選び出す","band":"HIGH","basis":"BNC Gardner-Davies","rank":75,"priority":75},{"id":"pv076","expression":"hold back","type":"phrasal","meaning":"抑える","band":"HIGH","basis":"BNC Gardner-Davies","rank":76,"priority":76},{"id":"pv077","expression":"put in","type":"phrasal","meaning":"入れる／提出する","band":"HIGH","basis":"BNC Gardner-Davies","rank":77,"priority":77},{"id":"pv078","expression":"move in","type":"phrasal","meaning":"引っ越してくる","band":"HIGH","basis":"BNC Gardner-Davies","rank":78,"priority":78},{"id":"pv079","expression":"look around","type":"phrasal","meaning":"見て回る","band":"HIGH","basis":"BNC Gardner-Davies","rank":79,"priority":79},{"id":"pv080","expression":"take down","type":"phrasal","meaning":"取り下ろす／書き留める","band":"HIGH","basis":"BNC Gardner-Davies","rank":80,"priority":80},{"id":"pv081","expression":"put off","type":"phrasal","meaning":"延期する","band":"HIGH","basis":"BNC Gardner-Davies","rank":81,"priority":81},{"id":"pv082","expression":"come about","type":"phrasal","meaning":"起こる","band":"HIGH","basis":"BNC Gardner-Davies","rank":82,"priority":82},{"id":"pv083","expression":"go along","type":"phrasal","meaning":"進む／同行する","band":"HIGH","basis":"BNC Gardner-Davies","rank":83,"priority":83},{"id":"pv084","expression":"look round","type":"phrasal","meaning":"見て回る","band":"HIGH","basis":"BNC Gardner-Davies","rank":84,"priority":84},{"id":"pv085","expression":"set about","type":"phrasal","meaning":"取りかかる","band":"HIGH","basis":"BNC Gardner-Davies","rank":85,"priority":85},{"id":"pv086","expression":"turn off","type":"phrasal","meaning":"消す","band":"HIGH","basis":"BNC Gardner-Davies","rank":86,"priority":86},{"id":"pv087","expression":"give in","type":"phrasal","meaning":"屈する／提出する","band":"HIGH","basis":"BNC Gardner-Davies","rank":87,"priority":87},{"id":"pv088","expression":"move out","type":"phrasal","meaning":"引っ越す","band":"HIGH","basis":"BNC Gardner-Davies","rank":88,"priority":88},{"id":"pv089","expression":"come through","type":"phrasal","meaning":"切り抜ける／届く","band":"HIGH","basis":"BNC Gardner-Davies","rank":89,"priority":89},{"id":"pv090","expression":"move back","type":"phrasal","meaning":"戻る／引っ越し戻る","band":"HIGH","basis":"BNC Gardner-Davies","rank":90,"priority":90},{"id":"pv091","expression":"break off","type":"phrasal","meaning":"中断する","band":"HIGH","basis":"BNC Gardner-Davies","rank":91,"priority":91},{"id":"pv092","expression":"get through","type":"phrasal","meaning":"終える／連絡がつく","band":"HIGH","basis":"BNC Gardner-Davies","rank":92,"priority":92},{"id":"pv093","expression":"give out","type":"phrasal","meaning":"配る／尽きる","band":"HIGH","basis":"BNC Gardner-Davies","rank":93,"priority":93},{"id":"pv094","expression":"come off","type":"phrasal","meaning":"外れる／うまくいく","band":"HIGH","basis":"BNC Gardner-Davies","rank":94,"priority":94},{"id":"pv095","expression":"take in","type":"phrasal","meaning":"理解する／取り込む","band":"HIGH","basis":"BNC Gardner-Davies","rank":95,"priority":95},{"id":"pv096","expression":"give back","type":"phrasal","meaning":"返す","band":"HIGH","basis":"BNC Gardner-Davies","rank":96,"priority":96},{"id":"pv097","expression":"set down","type":"phrasal","meaning":"置く／書き留める","band":"HIGH","basis":"BNC Gardner-Davies","rank":97,"priority":97},{"id":"pv098","expression":"move up","type":"phrasal","meaning":"上がる／昇進する","band":"HIGH","basis":"BNC Gardner-Davies","rank":98,"priority":98},{"id":"pv099","expression":"turn around","type":"phrasal","meaning":"振り向く／立て直す","band":"HIGH","basis":"BNC Gardner-Davies","rank":99,"priority":99},{"id":"pv100","expression":"sit back","type":"phrasal","meaning":"くつろぐ／傍観する","band":"HIGH","basis":"BNC Gardner-Davies","rank":100,"priority":100}];

function syncHighFrequencyCustom(){
  const seen=new Set(profile.chunkCustom.map(x=>norm(x.expression)));
  for(const w of profile.weaknesses||[]){
    if(!(w.sources||[]).includes("high-frequency"))continue;
    const expression=(w.label||w.better||"").trim();
    if(!expression||seen.has(norm(expression)))continue;
    profile.chunkCustom.push({
      id:"custom_"+Date.now()+"_"+Math.random().toString(36).slice(2,7),
      expression,
      type:"chunk",
      meaning:w.ja||"会話から保存した表現",
      band:"PERSONAL",
      basis:"会話から保存",
      personal:true,
      seedExample:w.better||expression
    });
    seen.add(norm(expression));
  }
  saveProfile();
}
function allChunkItems(){syncHighFrequencyCustom();return [...profile.chunkCustom,...CHUNK_BANK]}
function chunkProg(id){return profile.chunkProgress[id]||{stage:0,seen:0,ok:0,miss:0,due:0,mastered:false,cleared:false,bestTime:null,attempts:0,lastTranscript:""}}
function saveChunkProg(id,p){profile.chunkProgress[id]=p;saveProfile()}
function isDue(item){const p=chunkProg(item.id);return !p.seen||p.due<=Date.now()}
function selectDailyChunks(){
  const all=allChunkItems();
  const due=all.filter(isDue).sort((a,b)=>{
    if(a.personal&&!b.personal)return -1;if(b.personal&&!a.personal)return 1;
    const pa=chunkProg(a.id),pb=chunkProg(b.id);
    if(pa.seen!==pb.seen)return pa.seen-pb.seen;
    const ba=a.band==="CORE"?0:a.band==="PERSONAL"?0:1,bb=b.band==="CORE"?0:b.band==="PERSONAL"?0:1;
    if(ba!==bb)return ba-bb;
    return (a.rank||999)-(b.rank||999);
  });
  const picked=[], types={chunk:0,phrasal:0};
  for(const x of due){
    if(picked.length>=5)break;
    if(x.type==="phrasal"&&types.phrasal>=2&&due.some(y=>y.type==="chunk"&&!picked.includes(y)))continue;
    picked.push(x);types[x.type]=(types[x.type]||0)+1;
  }
  for(const x of all){if(picked.length>=5)break;if(!picked.some(y=>y.id===x.id))picked.push(x)}
  return picked.slice(0,5);
}
function updateChunkResult(item,ok){
  const p=chunkProg(item.id);p.seen++;if(ok){p.ok++;p.stage=Math.min(4,(p.stage||0)+1)}else{p.miss++;p.stage=Math.max(0,(p.stage||0)-1)}
  const days=ok?[1,3,7,21,45][Math.min(4,p.stage)]||21:1;
  p.due=Date.now()+days*86400000;
  if(p.stage>=4&&!p.mastered){p.mastered=true;profile.stats.chunkMastered++}
  saveChunkProg(item.id,p);profile.stats.chunkItems++;saveProfile();
}


function chunkTargetSeconds(text){
  const words=String(text||"").replace(/[^A-Za-z0-9' -]/g," ").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(4,Math.min(14,words+1));
}
function chunkStatus(item){const p=chunkProg(item.id);return p.cleared?"clear":p.seen?"learning":"new"}
function chunkPool(kind="mixed",review=false){
  let all=allChunkItems();
  if(kind==="chunk")all=all.filter(x=>x.type==="chunk");
  if(kind==="phrasal")all=all.filter(x=>x.type==="phrasal");
  if(kind==="personal")all=all.filter(x=>x.personal);
  if(review)return all.filter(x=>chunkProg(x.id).cleared).sort((a,b)=>(chunkProg(a.id).due||0)-(chunkProg(b.id).due||0));
  return all.filter(x=>!chunkProg(x.id).cleared).sort((a,b)=>{
    if(a.personal&&!b.personal)return -1;if(b.personal&&!a.personal)return 1;
    const pa=chunkProg(a.id),pb=chunkProg(b.id);if(pa.seen!==pb.seen)return pa.seen-pb.seen;
    return (a.priority||a.rank||999)-(b.priority||b.rank||999);
  });
}
async function startChunkCourse(kind="mixed",review=false){
  const pool=chunkPool(kind,review);if(!pool.length)return toast(review?"CLEAR済みはまだありません":"このコースはすべてCLEARです");
  const items=pool.slice(0,5),theme=$("#chunkTheme")?.value.trim()||"旅行・日常・仕事";
  loading(review?"CLEAR済みから復習セットを作っています…":"次の5個を準備しています…");
  try{
    const payload=items.map(x=>({id:x.id,expression:x.expression,type:x.type,meaning:x.meaning,band:x.band,basis:x.basis,rank:x.rank||null,seedExample:x.seedExample||""}));
    const d=await api("chunk-lessons",{theme,items:payload});const byId=Object.fromEntries((d.lessons||[]).map(x=>[x.id,x]));
    state.chunks={active:true,theme,kind,review,items:items.map(x=>({...x,lesson:byId[x.id]||{}})),index:0,step:1,writing:"",writingResult:null,results:[]};renderChunkLesson();
  }catch(e){state.chunks=null;showError(e)}
}
async function blobToBase64(blob){return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(",")[1]);r.onerror=reject;r.readAsDataURL(blob)})}
async function timedChunkSpeech(item,modelText){
  const target=chunkTargetSeconds(modelText),cd=$("#chunkCD"),btn=$("#chunkCount");btn.disabled=true;
  for(let n=3;n>=1;n--){cd.textContent=n;await new Promise(r=>setTimeout(r,1000))}cd.textContent=`GO!  ${target.toFixed(1)}秒`;
  let stream,rec,chunks=[],started=performance.now(),speechStarted=false,lastVoice=started,raf,maxTimer;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const ctx=new (window.AudioContext||window.webkitAudioContext)(),src=ctx.createMediaStreamSource(stream),an=ctx.createAnalyser();an.fftSize=512;src.connect(an);const data=new Uint8Array(an.fftSize);
    rec=new MediaRecorder(stream);rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    const stopped=new Promise(resolve=>rec.onstop=resolve);rec.start();started=performance.now();lastVoice=started;
    const watch=()=>{an.getByteTimeDomainData(data);let sum=0;for(const v of data){const d=(v-128)/128;sum+=d*d}const rms=Math.sqrt(sum/data.length),now=performance.now();
      if(rms>.035){speechStarted=true;lastVoice=now}
      const elapsed=(now-started)/1000;cd.textContent=`残り ${Math.max(0,target-elapsed).toFixed(1)}秒`;
      if((speechStarted&&now-lastVoice>750&&elapsed>1.2)||elapsed>=target){if(rec.state==="recording")rec.stop();return}raf=requestAnimationFrame(watch)};watch();
    maxTimer=setTimeout(()=>{if(rec.state==="recording")rec.stop()},(target+.2)*1000);await stopped;cancelAnimationFrame(raf);clearTimeout(maxTimer);await ctx.close();stream.getTracks().forEach(t=>t.stop());
    const elapsed=Math.min(target,(performance.now()-started)/1000),blob=new Blob(chunks,{type:rec.mimeType||"audio/webm"}),audio=await blobToBase64(blob);
    cd.textContent="認識中…";const tr=await api("chunk-transcribe",{audio,mime:blob.type});const judge=await api("chunk-speech-check",{target:modelText,expression:item.expression,transcript:tr.text||"",elapsed,targetSeconds:target});
    return {...judge,transcript:tr.text||"",elapsed,targetSeconds:target};
  }catch(e){try{stream?.getTracks().forEach(t=>t.stop())}catch{};throw e}
}
function bindCommon(){$$(".chip[data-fill]").forEach(b=>b.onclick=()=>{const el=$(b.dataset.target);if(el)el.value=b.dataset.fill})}
$$('.bottomnav button').forEach(b=>b.onclick=()=>go(b.dataset.mode));$("#homeBtn").onclick=()=>go("home");
function go(mode){
  if(state.mode==="mission"&&missionConnected&&mode!=="mission")cleanupRealtime();
  state.mode=mode;
  $$('.bottomnav button').forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));
  pageTitle.textContent={
    home:"5-in-1 Trainer",
    phrase:"じぶんごとフレーズ",
    fluency:"流暢性トレーニング",
    mission:"ミッションクリア英会話",
    listening:"意味理解リスニング",
    chunks:"Chunks & Phrasal Verbs"
  }[mode]||"AI English";
  window.scrollTo({top:0,behavior:"instant"});
  ({home:renderHome,phrase:renderPhrase,fluency:renderFluency,mission:renderMission,listening:renderListening,chunks:renderChunks}[mode])();
}
function renderHome(){
  syncHighFrequencyCustom();
  const weak=activeWeaknesses().slice(0,5),ach=achievements(),unlocked=ach.filter(x=>x.ok).length;
  const learned=Object.values(profile.chunkProgress||{}).filter(p=>p.seen>0).length;
  const mastered=Object.values(profile.chunkProgress||{}).filter(p=>p.mastered).length;
  view.innerHTML=`<section class="hero"><div class="kicker">MAKE → SPEAK → USE → LISTEN → USE AGAIN</div><h2>英語で「できること」を増やす。</h2><p>自分の場面だけを学び、口に入れ、実際に使い、音から意味を取り、もう一度使う。</p></section>
  <section class="grid">
    <button class="modecard" data-go="phrase"><div class="ico">▤</div><h3>① フレーズ</h3><p>自分が使う10文を作る</p></button>
    <button class="modecard" data-go="fluency"><div class="ico">↗</div><h3>② 流暢性</h3><p>引っかかる部分だけ鍛える</p></button>
    <button class="modecard" data-go="mission"><div class="ico">◎</div><h3>③ Realtime会話</h3><p>割り込み可能な目的達成型会話</p></button>
    <button class="modecard" data-go="listening"><div class="ico">◉</div><h3>④ リスニング</h3><p>文字より先に音から意味を取る</p></button>
  </section>
  <section class="card" style="border-color:#445b95;background:linear-gradient(145deg,#152442,#111c2d)">
    <div class="kicker">CORPUS-PRIORITY</div>
    <div class="row"><div><h3 style="margin:5px 0">⑤ Chunks & Phrasal Verbs</h3><div class="note">頻出・応用範囲・あなたの苦手を優先</div></div><button id="openChunks" class="primary">学ぶ</button></div>
    <div class="stats" style="margin-top:12px"><div class="stat"><b>${learned}</b><span>学習済み</span></div><div class="stat"><b>${mastered}</b><span>定着</span></div><div class="stat"><b>${profile.chunkCustom.length}</b><span>会話から追加</span></div></div>
  </section>
  <section class="card"><div class="row"><div><b>今日の復習</b><div class="note">苦手カルテから優先</div></div><button id="startReview" class="primary" ${weak.length?"":"disabled"}>5分</button></div>${weak.length?weak.slice(0,3).map(w=>`<div class="weakrow">${levelBadge(w)} <strong>${esc(w.label)}</strong><span class="note">${esc(w.better)}</span></div>`).join(""):`<p class="muted">まだ苦手データはありません。使うほどあなた専用になります。</p>`}</section>
  <section class="card"><h3>英語カルテ</h3><div class="stats"><div class="stat"><b>${profile.stats.sessions}</b><span>累計セット</span></div><div class="stat"><b>${activeWeaknesses().length}</b><span>練習中の苦手</span></div><div class="stat"><b>${unlocked}/${ach.length}</b><span>Achievement</span></div></div>${activeWeaknesses().slice(0,6).map(w=>`<div class="weakrow">${levelBadge(w)} <strong>${esc(w.label)}</strong><div class="note">指摘 ${w.errors}回 / 成功 ${w.successes}回</div><div>${esc(w.better)}</div></div>`).join("")||'<p class="muted">要注意 → 苦手 → 重点 の3段階で見える化します。</p>'}</section>
  <section class="card"><h3>Lifetime Achievement</h3>${ach.map(a=>`<div class="achievement ${a.ok?"":"locked"}"><div class="medal">${a.icon}</div><div><b>${esc(a.name)}</b><div class="note">${esc(a.desc)}</div></div></div>`).join("")}</section>`;
  $$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  $("#openChunks").onclick=()=>go("chunks");
  $("#startReview").onclick=()=>{const w=activeWeaknesses()[0];if(!w)return;state.fluency={prefill:w.better,fromWeak:w.key};go("fluency")};
}

function renderPhrase(){if(state.phrase?.phrases)return renderPhraseList();view.innerHTML=`<div class="card"><h2>どんな場面で英語を使いたいですか？</h2><textarea id="pScene" placeholder="例：外国人に自分の仕事を説明する"></textarea>${chips(["海外旅行","ホテルでチェックイン","レストラン","仕事の会議","趣味の話"],"#pScene")}<button id="makePhrase" class="primary wide">10フレーズを作る</button><p class="note">大量暗記ではなく、その場面を乗り切る最小限の英語だけ。</p></div>`;bindCommon();$("#makePhrase").onclick=async()=>{const scene=$("#pScene").value.trim();if(!scene)return toast("場面を入力してください");loading("あなた専用の10フレーズを作っています…");try{state.phrase=await api("phrases",{scene});renderPhraseList()}catch(e){showError(e)}}}
function renderPhraseList(){const d=state.phrase;view.innerHTML=`<div class="card"><b>${esc(d.scene)}</b><div class="note">★がAIの最重要5。自分で変更できます。</div></div>${d.phrases.map((p,i)=>`<article class="card phrasecard"><button class="star ${p.important?"on":""}" data-star="${i}">★</button><div class="jp">${esc(p.ja)}</div><div class="answer hidden"><div class="en">${esc(p.en)}</div><div class="kana">${esc(p.kana)}</div><button class="audioBtn" data-say="${i}">🔊 聞く</button></div><button class="secondary wide reveal" data-reveal="${i}" style="margin-top:10px">カードを開く</button></article>`).join("")}<div class="row"><button id="pTest" class="primary">ランダムテスト</button><button id="pMore" class="secondary">＋5追加</button></div><button id="pNew" class="secondary wide" style="margin-top:9px">別の場面</button>`;$$('[data-star]').forEach(b=>b.onclick=()=>{d.phrases[+b.dataset.star].important=!d.phrases[+b.dataset.star].important;renderPhraseList()});$$('[data-reveal]').forEach(b=>b.onclick=()=>b.closest('.phrasecard').querySelector('.answer').classList.toggle('hidden'));$$('[data-say]').forEach(b=>b.onclick=()=>playTTS(d.phrases[+b.dataset.say].en));$("#pTest").onclick=phraseTest;$("#pMore").onclick=async()=>{loading("5フレーズ追加中…");try{const x=await api("phrases-more",{scene:d.scene,existing:d.phrases.map(p=>p.en)});d.phrases.push(...x.phrases);renderPhraseList()}catch(e){showError(e)}};$("#pNew").onclick=()=>{state.phrase=null;renderPhrase()}}
function phraseTest(){const d=state.phrase,pool=[...activeWeaknesses().filter(w=>w.sources.includes("phrase")).map(w=>({ja:w.ja||w.label,en:w.better,kana:""})),...d.phrases],p=pool[Math.floor(Math.random()*pool.length)];view.innerHTML=`<div class="card">${step(1,1)}<div class="big center">${esc(p.ja)}</div><p class="note center">英文を見る前に自分で声に出してください。</p><button id="showPAns" class="primary wide">答えを見る</button><div id="pAns" class="hidden"><div class="en big center">${esc(p.en)}</div><button id="pHear" class="audioBtn wide">🔊 聞く</button><div class="row" style="margin-top:12px"><button id="pYes" class="primary">言えた</button><button id="pNo" class="secondary">まだ</button></div></div></div><button id="pEnd" class="secondary wide">終了</button>`;$("#showPAns").onclick=()=>$("#pAns").classList.remove("hidden");$("#pHear").onclick=()=>playTTS(p.en);$("#pYes").onclick=()=>{markWeakSuccess(p.en);profile.stats.phraseTests++;saveProfile();phraseTest()};$("#pNo").onclick=()=>{addWeakness({type:"fluency",label:p.ja,better:p.en,ja:p.ja},"phrase");profile.stats.phraseTests++;saveProfile();phraseTest()};$("#pEnd").onclick=()=>{logSession("phrase",{scene:d.scene});renderPhraseList()}}

function renderListening(){if(state.listening?.step)return renderListeningStep();view.innerHTML=`<div class="card"><h2>意味を取りに行くリスニング</h2><input id="lScene" placeholder="例：ホテルのチェックイン">${chips(["カフェ","ホテル","レストラン","買い物","外国人との雑談","英語の会議"],"#lScene")}<label>レベル</label><select id="lLevel"><option>やさしい</option><option selected>ふつう</option><option>むずかしい</option></select><button id="lStart" class="primary wide">トレーニング開始</button></div>`;bindCommon();$("#lStart").onclick=async()=>{const scene=$("#lScene").value.trim(),level=$("#lLevel").value;if(!scene)return toast("場面を入力してください");loading("音から意味を取る会話を作っています…");try{state.listening={...(await api("listening",{scene,level})),scene,level,step:1,answers:[]};renderListeningStep()}catch(e){showError(e)}}}
function renderListeningStep(){const d=state.listening,s=d.step;if(s===1)view.innerHTML=`${step(1,5)}<div class="card"><div class="big center">全部聞き取らなくてOK<br>「何が起きているか」を考えよう</div><button id="listenPlay" class="primary wide">🔊 音だけを聞く</button><button id="listenAgain" class="secondary wide" style="margin-top:8px">もう一度聞く</button><button id="toQuiz" class="secondary wide" style="margin-top:8px">内容理解クイズへ</button></div>`;else if(s===2)view.innerHTML=`${step(2,5)}<div class="card"><h2>内容理解クイズ</h2>${d.quiz.map((q,qi)=>`<div style="margin:18px 0"><b>${qi+1}. ${esc(q.question)}</b>${q.options.map((o,oi)=>`<button class="option" data-q="${qi}" data-o="${oi}">${esc(o)}</button>`).join("")}</div>`).join("")}<button id="scoreL" class="primary wide">採点</button></div>`;else if(s===3){const n=d.quiz.reduce((a,q,i)=>a+(d.answers[i]===q.answer),0);view.innerHTML=`${step(3,5)}<div class="card"><div class="big center">${n} / 3</div><p>${esc(d.meaningSummary)}</p><button id="toText" class="primary wide">ここで初めて英文を見る</button></div>`}else if(s===4)view.innerHTML=`${step(4,5)}<div class="card"><h2>英文・意味を確認</h2><div class="en" style="white-space:pre-line">${esc(d.dialogue)}</div><hr><div class="jp">${esc(d.translation)}</div><div class="card compact"><b>重要チャンク（最大3つ）</b>${d.chunks.map(c=>`<p><b>${esc(c.en)}</b><br><span class="muted">${esc(c.ja)}</span></p>`).join("")}</div><button id="hideJP" class="primary wide">日本語を隠す</button></div>`;else view.innerHTML=`${step(5,5)}<div class="card"><div class="big center">日本語を考えず<br>場面をイメージして聞く</div><button id="lastListen" class="primary wide">🔊 再リスニング</button><button id="reviewAdd" class="secondary wide" style="margin-top:8px">復習に追加</button><button id="nextListen" class="secondary wide" style="margin-top:8px">次のセット</button></div>`;if(s===1){$("#listenPlay").onclick=$("#listenAgain").onclick=()=>playTTS(d.dialogue);$("#toQuiz").onclick=()=>{d.step=2;renderListeningStep()}}if(s===2){$$('.option').forEach(b=>b.onclick=()=>{d.answers[+b.dataset.q]=+b.dataset.o;b.parentElement.querySelectorAll('.option').forEach(x=>x.classList.remove('sel'));b.classList.add('sel')});$("#scoreL").onclick=()=>{if(d.answers.filter(x=>x!==undefined).length<3)return toast("3問すべて答えてください");const n=d.quiz.reduce((a,q,i)=>a+(d.answers[i]===q.answer),0);profile.stats.listeningSets++;if(n===3){profile.stats.perfectListening++;profile.listeningPerfectStreak[d.level]=(profile.listeningPerfectStreak[d.level]||0)+1}else{profile.listeningPerfectStreak[d.level]=0;d.chunks.forEach(c=>addWeakness({type:"listening",label:c.ja,better:c.en,ja:c.ja,original:"聞き取り"},"listening"))}saveProfile();d.step=3;renderListeningStep()}}if(s===3)$("#toText").onclick=()=>{d.step=4;renderListeningStep()};if(s===4)$("#hideJP").onclick=()=>{d.step=5;renderListeningStep()};if(s===5){$("#lastListen").onclick=()=>playTTS(d.dialogue);$("#reviewAdd").onclick=()=>{d.chunks.forEach(c=>addWeakness({type:"listening",label:c.ja,better:c.en,ja:c.ja},"listening"));toast("今日の復習に追加しました")};$("#nextListen").onclick=()=>{const streak=profile.listeningPerfectStreak[d.level]||0;logSession("listening",{scene:d.scene,score:d.quiz.reduce((a,q,i)=>a+(d.answers[i]===q.answer),0)});state.listening=null;if(streak>=3)alert("3問正解が3回続きました。レベルを上げてみますか？ 自動では上げません。");renderListening()}}}
function renderFluency(){if(state.fluency?.step)return renderFluencyStep();const pre=state.fluency?.prefill||"";view.innerHTML=`<div class="card"><h2>言えるようになりたい英文</h2><textarea id="fSentence" placeholder="What do you recommend?">${esc(pre)}</textarea>${chips(["What do you recommend?","Can I get a coffee?","I'd like to check in.","Could you say that again?"],"#fSentence")}<button id="fStart" class="primary wide">練習開始</button><p class="note">完璧な発音ではなく、止まらず口から出ることが目標。</p></div>`;bindCommon();$("#fStart").onclick=async()=>{const sentence=$("#fSentence").value.trim();if(!sentence)return toast("英文を入力してください");loading("自然なチャンクを作っています…");try{const old=state.fluency||{};state.fluency={...(await api("fluency",{sentence})),fromWeak:old.fromWeak,step:1,reps:0,beforeUrl:null,afterUrl:null};renderFluencyStep()}catch(e){showError(e)}}}
function renderFluencyStep(){const d=state.fluency,s=d.step;if(s===1)view.innerHTML=`${step(1,7)}<div class="card"><div class="en big center">${esc(d.sentence)}</div><button id="fModel" class="primary wide">🔊 お手本を聞く</button><p class="center muted">まず1回、そのまま言ってみましょう。</p><button id="beforeRec" class="secondary wide">● BEFOREを5秒録音</button><button id="fNext2" class="secondary wide" style="margin-top:8px">次へ</button></div>`;else if(s===2)view.innerHTML=`${step(2,7)}<div class="card"><h2>引っかかる部分を選ぶ</h2><p class="note">AI候補：${d.hardParts.map(esc).join(" / ")}</p><div class="chips">${d.chunks.map(c=>`<button class="chip part" data-part="${esc(c)}">${esc(c)}</button>`).join("")}</div></div>`;else if(s===3)view.innerHTML=`${step(3,7)}<div class="card"><div class="big center">${esc(d.selected)}</div><button id="partHear" class="secondary wide">🔊 お手本</button><div class="dots">${Array.from({length:5},(_,i)=>i<d.reps?"●":"○").join(" ")}</div><button id="repDone" class="primary wide">1回言えた</button></div>`;else if(s===4)view.innerHTML=`${step(4,7)}<div class="card"><h2>少しずつ広げる</h2>${d.expansion.map(x=>`<div class="weakrow"><b>${esc(x)}</b> <button class="audioBtn expandHear" data-text="${esc(x)}">🔊</button></div>`).join("")}<button id="toRhythm" class="primary wide" style="margin-top:10px">全文へ戻る</button></div>`;else if(s===5)view.innerHTML=`${step(5,7)}<div class="card"><div class="en big center">${esc(d.sentence)}</div><p class="center muted">全文を3回。速度を選んでください。</p><div class="row"><button class="secondary speed" data-speed=".78">ゆっくり</button><button class="primary speed" data-speed="1">普通</button><button class="secondary speed" data-speed="1.18">自然</button></div><button id="toAfter" class="primary wide" style="margin-top:10px">AFTERへ</button></div>`;else if(s===6)view.innerHTML=`${step(6,7)}<div class="card"><h2>AFTER</h2><p>今度はお手本なし。止まらず全文を言います。</p><button id="afterRec" class="primary wide">● AFTERを5秒録音</button>${d.beforeUrl?'<button id="playBefore" class="secondary wide" style="margin-top:8px">▶ BEFORE</button>':""}${d.afterUrl?'<button id="playAfter" class="secondary wide" style="margin-top:8px">▶ AFTER</button>':""}<button id="toFinal" class="secondary wide" style="margin-top:8px">日本語→英語へ</button></div>`;else view.innerHTML=`${step(7,7)}<div class="card"><div class="big center">${esc(d.japanese)}</div><button id="startCount" class="primary wide">3秒カウントダウン</button><div id="cd" class="countdown"></div><div id="fAnswer" class="en big center hidden">${esc(d.sentence)}</div><div id="finalJudge" class="row hidden"><button id="fCan" class="primary">言えた</button><button id="fStill" class="secondary">まだ</button></div></div>`;if(s===1){$("#fModel").onclick=()=>playTTS(d.sentence);$("#beforeRec").onclick=()=>recordFive("before");$("#fNext2").onclick=()=>{d.step=2;renderFluencyStep()}}if(s===2)$$('.part').forEach(b=>b.onclick=()=>{d.selected=b.dataset.part;d.reps=0;d.expansion=buildExpansion(d.sentence,d.selected);d.step=3;renderFluencyStep()});if(s===3){$("#partHear").onclick=()=>playTTS(d.selected);$("#repDone").onclick=()=>{d.reps++;if(d.reps>=5)d.step=4;renderFluencyStep()}}if(s===4){$$('.expandHear').forEach(b=>b.onclick=()=>playTTS(b.dataset.text));$("#toRhythm").onclick=()=>{d.step=5;renderFluencyStep()}}if(s===5){$$('.speed').forEach(b=>b.onclick=()=>playThree(d.sentence,+b.dataset.speed));$("#toAfter").onclick=()=>{d.step=6;renderFluencyStep()}}if(s===6){$("#afterRec").onclick=()=>recordFive("after");$("#playBefore")?.addEventListener("click",()=>new Audio(d.beforeUrl).play());$("#playAfter")?.addEventListener("click",()=>new Audio(d.afterUrl).play());$("#toFinal").onclick=()=>{d.step=7;renderFluencyStep()}}if(s===7)$("#startCount").onclick=countdownFluency}
function buildExpansion(sentence,part){const w=sentence.replace(/[?.!]/g,"").split(/\s+/),p=part.replace(/[?.!]/g,"").split(/\s+/);let i=w.findIndex(x=>part.toLowerCase().startsWith(x.toLowerCase()));if(i<0)i=0;return [...new Set([part,w.slice(Math.max(0,i-1),Math.min(w.length,i+p.length+1)).join(" "),w.slice(Math.max(0,i-2),Math.min(w.length,i+p.length+2)).join(" "),sentence])]}
async function recordFive(which){try{const stream=await navigator.mediaDevices.getUserMedia({audio:true}),chunks=[],rec=new MediaRecorder(stream);rec.ondataavailable=e=>chunks.push(e.data);rec.onstop=()=>{const url=URL.createObjectURL(new Blob(chunks,{type:"audio/webm"}));state.fluency[which+"Url"]=url;stream.getTracks().forEach(t=>t.stop());toast(which.toUpperCase()+"を保存しました");renderFluencyStep()};rec.start();toast("5秒録音します…");setTimeout(()=>{if(rec.state==="recording")rec.stop()},5000)}catch{toast("録音を許可できませんでした")}}
async function playThree(text,speed){for(let i=0;i<3;i++){await playTTSWait(text,speed);await new Promise(r=>setTimeout(r,250))}}async function playTTSWait(text,speed){const r=await fetch("/api/tts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,speed})});if(!r.ok)return;const blob=await r.blob(),url=URL.createObjectURL(blob);audioPlayer.src=url;await audioPlayer.play().catch(()=>{});await new Promise(resolve=>{audioPlayer.onended=()=>{URL.revokeObjectURL(url);resolve()}})}
function countdownFluency(){let n=3;$("#cd").textContent=n;const t=setInterval(()=>{n--;$("#cd").textContent=n>0?n:"GO!";if(n<=0){clearInterval(t);setTimeout(()=>{$("#fAnswer").classList.remove("hidden");$("#finalJudge").classList.remove("hidden");$("#fCan").onclick=()=>finishFluency(true);$("#fStill").onclick=()=>finishFluency(false)},1700)}},1000)}function finishFluency(ok){const d=state.fluency;profile.stats.fluencySets++;if(ok)markWeakSuccess(d.sentence);else addWeakness({type:"fluency",label:d.japanese,better:d.sentence,ja:d.japanese,original:"詰まる"},"fluency");saveProfile();logSession("fluency",{sentence:d.sentence,ok});state.fluency=null;renderHome()}

function renderMission(){if(state.mission?.plan)return renderMissionReady();const preset=state.missionPreset?.scene||"";view.innerHTML=`<div class="card"><h2>今日はどんな場面を練習しますか？</h2>${state.missionPreset?.target?`<div class="toast">今日のターゲット：${esc(state.missionPreset.target)}</div>`:""}<textarea id="mScene" placeholder="例：海外のホテルにチェックインする">${esc(preset)}</textarea>${chips(["ホテルにチェックイン","海外のカフェで注文","レストランで要望を伝える","外国人に道を聞く","仕事の進捗報告"],"#mScene")}<label>難易度</label><select id="mLevel"><option>EASY</option><option selected>NORMAL</option><option>CHALLENGE</option></select><button id="makeMission" class="primary wide">3つのミッションを作る</button></div>`;bindCommon();$("#makeMission").onclick=async()=>{const scene=$("#mScene").value.trim(),level=$("#mLevel").value;if(!scene)return toast("場面を入力してください");loading("目的達成型ミッションを作っています…");try{
  const plan=await api("mission-plan",{scene,level});
  plan.missions=(plan.missions||[]).map(m=>typeof m==="string"?{label:m,criterion:m}:m);
  state.mission={plan,scene,level,done:[false,false,false]};
  renderMissionReady()
}catch(e){showError(e)}}}
function renderMissionReady(){const m=state.mission;view.innerHTML=`<div class="card"><div class="kicker">${esc(m.plan.role||"ROLE PLAY")}</div><h2>${esc(m.scene)}</h2>${m.plan.missions.map((x,i)=>`<div class="mission ${m.done[i]?"done":""}" data-mi="${i}">${m.done[i]?"✅":"□"} ${esc(x.label||x)}</div>`).join("")}</div><section class="card center"><div id="orb" class="orb"><div class="orbcore"></div><div class="orbring"></div></div><div id="voiceState" class="voiceState">タップして会話を開始</div><div id="voiceSub" class="voiceSub">普通のロールプレイです。会話中は訂正せず、終了後だけおさらいします。</div><button id="startRealtime" class="primary">会話を開始</button><button id="finishRealtime" class="danger hidden">会話終了 → おさらい</button><div class="toolbar" style="margin-top:12px"><button id="captionBtn" class="tool ${captionOn?"on":""}">字幕 ${captionOn?"ON":"OFF"}</button><button id="slowHint" class="tool">“Slower”</button><button id="repeatHint" class="tool">“Repeat”</button></div><div id="liveCaption" class="liveCaption ${captionOn?"":"hidden"}"></div></section><section id="transcriptCard" class="card ${captionOn?"":"hidden"}"><b>文字起こし</b><div id="transcript" class="transcript">${transcript.map(lineHtml).join("")}</div></section>`;$("#startRealtime").onclick=startRealtime;$("#finishRealtime").onclick=()=>finishMission(false);$("#captionBtn").onclick=()=>{captionOn=!captionOn;renderMissionReady()};$("#slowHint").onclick=()=>toast('会話中に "Speak slower" と言えば速度を落とします');$("#repeatHint").onclick=()=>toast('会話中に "Say that again" で繰り返します');if(missionConnected){$("#startRealtime").classList.add("hidden");$("#finishRealtime").classList.remove("hidden");$("#orb").className="orb live";$("#voiceState").textContent="会話中";$("#voiceSub").textContent="普通に話してください。AIの途中でも割り込みOK。"}}
function lineHtml(x){return `<div class="line ${x.role==="assistant"?"ai":"user"}"><div class="speaker">${x.role==="assistant"?"AI":"YOU"}</div>${esc(x.text)}</div>`}function setVoice(kind,title,sub=""){const o=$("#orb");if(o)o.className="orb "+kind;if($("#voiceState"))$("#voiceState").textContent=title;if($("#voiceSub"))$("#voiceSub").textContent=sub}function updateCaption(text){if(captionOn&&$("#liveCaption"))$("#liveCaption").textContent=text}function refreshTranscript(){const el=$("#transcript");if(el){el.innerHTML=transcript.map(lineHtml).join("");el.scrollTop=el.scrollHeight}}
async function startRealtime(){if(missionConnected)return;const m=state.mission;transcript=[];currentAssistant="";missionFinishing=false;$("#startRealtime").disabled=true;setVoice("connecting","接続しています…","最初だけマイク許可が必要です");try{
    const openerData=await api("roleplay-opener",{scene:m.scene,role:m.plan.role||"",level:m.level});
    m.opener=openerData.opener||"Hello.";
    mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});pc=new RTCPeerConnection();pc.ontrack=e=>{remoteAudio.srcObject=e.streams[0];remoteAudio.play().catch(()=>{})};mic.getTracks().forEach(t=>pc.addTrack(t,mic));dc=pc.createDataChannel("oai-events");dc.onopen=()=>{
      const opener=m.opener||"Hello.";
      dc.send(JSON.stringify({
        type:"response.create",
        response:{instructions:`Say exactly this line, and nothing else: ${JSON.stringify(opener)}`}
      }));
    };dc.onmessage=handleRealtimeEvent;pc.onconnectionstatechange=()=>{if(pc.connectionState==="connected"){missionConnected=true;$("#startRealtime")?.classList.add("hidden");$("#finishRealtime")?.classList.remove("hidden");setVoice("live","会話中","普通に話してください。途中で割り込めます。")}if(["failed","closed"].includes(pc.connectionState)&&missionConnected&&!missionFinishing)cleanupRealtime()};const offer=await pc.createOffer();await pc.setLocalDescription(offer);const qs=new URLSearchParams({scene:m.scene,level:m.level,role:m.plan.role||"",missions:JSON.stringify(m.plan.missions.map(x=>x.label||x))}),r=await fetch("/api/realtime-call?"+qs.toString(),{method:"POST",headers:{"Content-Type":"application/sdp"},body:offer.sdp}),answer=await r.text();if(!r.ok)throw new Error(answer);await pc.setRemoteDescription({type:"answer",sdp:answer})}catch(e){console.error(e);cleanupRealtime();showError(e)}}
function handleRealtimeEvent(e){let x;try{x=JSON.parse(e.data)}catch{return}const type=x.type||"";if(type==="input_audio_buffer.speech_started"){setVoice("live","聞いています…","そのまま話してください");updateCaption("…")}if(type==="input_audio_buffer.speech_stopped")setVoice("live","考えています…","");if(type==="conversation.item.input_audio_transcription.completed"){const text=x.transcript||x.text||"";if(text){transcript.push({role:"user",text});updateCaption(text);refreshTranscript();evaluateMissionProgress(text)}}if(type==="response.output_audio_transcript.delta"||type==="response.audio_transcript.delta"){
    currentAssistant+=(x.delta||"");
    setVoice("speaking","AIが話しています","途中でもそのまま話しかけてOK");
    updateCaption(currentAssistant);
  }if(type==="response.output_audio_transcript.done"||type==="response.audio_transcript.done"){
    const text=x.transcript||x.text||currentAssistant;
    if(text){
      if(!transcript.some(t=>t.role==="assistant"&&t.text===text))transcript.push({role:"assistant",text});
      refreshTranscript();
      updateCaption(text);
      if(/MISSION COMPLETE\.?/i.test(text)&&!missionFinishing)setTimeout(()=>finishMission(true),500);
    }
    currentAssistant="";
  }if(type==="response.done")setVoice("live","あなたの番です","普通に話してください");if(type==="error"){console.error(x);toast(x.error?.message||"Realtime error")}}
async function evaluateMissionProgress(utterance){
  const m=state.mission;
  if(!m || !utterance?.trim()) return;

  try{
    const d=await api("mission-progress",{
      missions:m.plan.missions,
      done:m.done,
      utterance
    });

    const newly=Array.isArray(d.newlyAchieved)?d.newlyAchieved:[];
    for(const hit of newly){
      const i=Number(hit.index);
      if(Number.isInteger(i) && i>=0 && i<m.done.length){
        m.done[i]=true; // one-way latch only
      }
    }

    $$('[data-mi]').forEach((el,i)=>{
      el.classList.toggle("done",!!m.done[i]);
      el.textContent=(m.done[i]?"✅ ":"□ ")+(m.plan.missions[i]?.label||m.plan.missions[i]);
    });
  }catch(e){
    console.warn("mission progress check failed",e);
  }
}
async function cleanupRealtime(){try{dc?.close()}catch{}try{pc?.close()}catch{}try{mic?.getTracks().forEach(t=>t.stop())}catch{}dc=null;pc=null;mic=null;missionConnected=false;remoteAudio.srcObject=null}
async function finishMission(auto){
  if(missionFinishing)return;
  missionFinishing=true;
  const m=state.mission;
  await cleanupRealtime();
  loading("会話が終わりました。ここで初めておさらいします…");try{const r=await api("mission-review",{scene:m.scene,missions:m.plan.missions.map(x=>x.label||x),transcript,weaknesses:activeWeaknesses().slice(0,20)});(r.weaknesses||[]).forEach(w=>addWeakness(w,"mission"));profile.stats.missions++;saveProfile();logSession("mission",{scene:m.scene,complete:auto||m.done.every(Boolean)});renderMissionReview(r)}catch(e){missionFinishing=false;showError(e)}}
function renderMissionReview(r){
  const m=state.mission;
  const chunks=(r.highFrequencyChunks||[]).slice(0,2);
  view.innerHTML=`<div class="card">
    <div class="complete">MISSION COMPLETE</div>
    <h3>GOOD</h3>
    <p>${esc(r.good)}</p>

    <h3>NEXT</h3>
    ${(r.next||[]).slice(0,2).map(x=>`<p>• ${esc(x)}</p>`).join("")||"<p>—</p>"}

    <h3>BETTER ENGLISH</h3>
    ${(r.betterEnglish||[]).slice(0,2).map(x=>`<div class="weakrow">
      <div class="muted">${esc(x.original)}</div>
      <div class="en">${esc(x.better)}</div>
      <div class="note">${esc(x.ja||"")}</div>
      <button class="audioBtn betterHear" data-text="${esc(x.better)}">🔊 聞く</button>
    </div>`).join("")||"<p>大きな修正はありません。</p>"}

    ${chunks.length?`<h3>HIGH-FREQUENCY CHUNK ⭐</h3>
      <p class="note">短く、自然で、別の場面にも使いやすい表現だけを提案します。</p>
      ${chunks.map((x,i)=>`<div class="weakrow hfChunk" data-hf="${i}">
        <div class="kicker">USEFUL CHUNK</div>
        <div class="en">${esc(x.chunk)}</div>
        <div style="margin-top:8px">${esc(x.example)}</div>
        <div class="note">${esc(x.ja||"")}</div>
        <div class="note" style="margin-top:5px">💡 ${esc(x.why||"応用しやすい自然な表現")}</div>
        <button class="audioBtn hfHear" data-i="${i}">🔊 聞く</button>
        <div class="row" style="margin-top:10px">
          <button class="primary hfPractice" data-i="${i}">今すぐ練習</button>
          <button class="secondary hfSave" data-i="${i}">苦手カルテに保存</button>
        </div>
        <button class="secondary wide hfSkip" data-i="${i}" style="margin-top:8px">今回はしない</button>
      </div>`).join("")}`:""}
  </div>

  <div class="row">
    <button id="revenge" class="primary">もう一度挑戦</button>
    <button id="toHome" class="secondary">ホーム</button>
  </div>

  <div class="card">
    <b>会話全文</b>
    <div class="transcript">${transcript.map(lineHtml).join("")}</div>
  </div>`;

  $$(".betterHear").forEach(b=>b.onclick=()=>playTTS(b.dataset.text));

  $$(".hfHear").forEach(b=>b.onclick=()=>{
    const x=chunks[+b.dataset.i];
    playTTS(x.example||x.chunk);
  });

  $$(".hfPractice").forEach(b=>b.onclick=()=>{
    const x=chunks[+b.dataset.i];
    addWeakness({
      type:"fluency",
      label:x.chunk,
      original:x.sourceOriginal||"",
      better:x.example||x.chunk,
      ja:x.ja||"",
      severityHint:1
    },"high-frequency");
    state.fluency={
      prefill:x.example||x.chunk,
      fromWeak:norm("fluency "+(x.example||x.chunk))
    };
    state.mission=null;
    missionFinishing=false;
    transcript=[];
    go("fluency");
  });

  $$(".hfSave").forEach(b=>b.onclick=()=>{
    const i=+b.dataset.i,x=chunks[i];
    addWeakness({
      type:"expression",
      label:x.chunk,
      original:x.sourceOriginal||"",
      better:x.example||x.chunk,
      ja:x.ja||"",
      severityHint:1
    },"high-frequency");
    b.textContent="保存しました ✓";
    b.disabled=true;
    toast("苦手カルテに保存しました");
  });

  $$(".hfSkip").forEach(b=>b.onclick=()=>{
    const box=b.closest(".hfChunk");
    if(box) box.style.opacity=".42";
    b.textContent="今回はスキップ";
    b.disabled=true;
  });

  $("#revenge").onclick=()=>{
    m.done=[false,false,false];
    missionFinishing=false;
    transcript=[];
    renderMissionReady();
  };

  $("#toHome").onclick=()=>{
    state.mission=null;
    missionFinishing=false;
    transcript=[];
    go("home");
  };
}

// APP 5: Chunks & Phrasal Verbs
function renderChunks(){
  syncHighFrequencyCustom();if(state.chunks?.active)return renderChunkLesson();
  const all=allChunkItems(),cleared=all.filter(x=>chunkProg(x.id).cleared).length,chunkClear=all.filter(x=>x.type==="chunk"&&chunkProg(x.id).cleared).length,pvClear=all.filter(x=>x.type==="phrasal"&&chunkProg(x.id).cleared).length,personal=all.filter(x=>x.personal&&!chunkProg(x.id).cleared).length;
  view.innerHTML=`<section class="hero"><div class="kicker">APP 5 · SPEAK UNTIL AUTOMATIC</div><h2>Chunks & Phrasal Verbs</h2><p>学ぶ → 作る → 実際に声で言う → 時間内に言い切る → CLEAR → 忘れる前に復習。</p></section>
  <section class="card"><div class="stats"><div class="stat"><b>${chunkClear}/100</b><span>Chunks CLEAR</span></div><div class="stat"><b>${pvClear}/100</b><span>Phrasal CLEAR</span></div><div class="stat"><b>${cleared}</b><span>合計CLEAR</span></div></div><label>例文テーマ</label><input id="chunkTheme" value="旅行・日常・仕事"><div class="chips"><button id="courseWeak" class="chip">MY WEAKNESS ${personal}</button><button id="courseChunks" class="chip">重要100 CHUNKS</button><button id="coursePV" class="chip">BNC TOP 100 PHRASAL VERBS</button></div><button id="courseAuto" class="primary wide">今日のおすすめ5個</button><button id="courseReview" class="secondary wide" style="margin-top:8px">✅ CLEAR済みを復習</button></section>
  <section class="card"><h3>音声CLEARの条件</h3><p>3 → 2 → 1 → GO の後、マイクが実際の発話を聞きます。<b>内容が通じること＋目標時間内</b>でCLEAR。</p><p class="note">目標時間は基本「英単語数＋1秒」。例：I'd like a coffee, please. → 約6秒。CLEAR後の復習では記録とベストタイムも残します。</p></section>
  <section class="card"><h3>学習の優先順位</h3><div class="weakrow"><b>① あなたの苦手</b><div class="note">会話・訂正から自動追加</div></div><div class="weakrow"><b>② 重要100 Chunks</b><div class="note">日常会話で再利用しやすい定型表現</div></div><div class="weakrow"><b>③ BNC Top 100 Phrasal Verbs</b><div class="note">Gardner & Davies の頻度リスト。上位25を特に優先</div></div></section>`;
  $("#courseAuto").onclick=()=>startChunkCourse("mixed",false);$("#courseChunks").onclick=()=>startChunkCourse("chunk",false);$("#coursePV").onclick=()=>startChunkCourse("phrasal",false);$("#courseWeak").onclick=()=>startChunkCourse("personal",false);$("#courseReview").onclick=()=>startChunkCourse("mixed",true);
}
async function startDailyChunks(){return startChunkCourse("mixed",false)}
function renderChunkLesson(){
  const s=state.chunks;if(!s?.active)return renderChunks();
  if(s.index>=s.items.length)return renderChunkSummary();
  const item=s.items[s.index],l=item.lesson||{},p=chunkProg(item.id);
  const badge=item.personal?"PERSONAL":item.type==="phrasal"&&item.rank?`BNC #${item.rank}`:item.band;
  const head=`${step(s.index+1,s.items.length)}<div class="card"><div class="row"><span class="levelBadge ${item.personal?"graduated":"lv1"}">${esc(badge)}</span><span class="note">${item.type==="phrasal"?"PHRASAL VERB":"CHUNK"}</span></div><div class="en big center">${esc(item.expression)}</div></div>`;
  if(s.step===1)view.innerHTML=head+`<div class="card center"><p class="muted">まず音を聞いて、意味を思い出す。</p><button id="clHear" class="primary wide">🔊 聞く</button><button id="clMeaning" class="secondary wide" style="margin-top:8px">意味・例文を見る</button></div>`;
  else if(s.step===2)view.innerHTML=head+`<div class="card"><h3>${esc(item.meaning)}</h3><div class="en">${esc(l.example||item.seedExample||item.expression)}</div><div class="jp">${esc(l.exampleJa||"")}</div><button id="clExampleHear" class="audioBtn">🔊 例文を聞く</button>${l.secondExample?`<div class="weakrow"><b>別の場面</b><div>${esc(l.secondExample)}</div></div>`:""}${l.tip?`<p class="note">💡 ${esc(l.tip)}</p>`:""}<button id="clWriteNext" class="primary wide">自分で1文作る</button></div>`;
  else if(s.step===3)view.innerHTML=head+`<div class="card"><h3>自分で作文</h3><div class="jp">${esc(l.writingPromptJa||"この表現を使って、自分のことを1文書いてください。")}</div><textarea id="chunkWriting" placeholder="${esc(item.expression)} を使って英文を作る">${esc(s.writing||"")}</textarea><button id="checkWriting" class="primary wide">チェック</button>${s.writingResult?`<div class="weakrow"><b>${s.writingResult.ok?"✅ 通じています":"🔧 ここだけ自然に"}</b><div class="note">${esc(s.writingResult.feedbackJa||"")}</div><div class="en">${esc(s.writingResult.natural||"")}</div></div><button id="toChunkSpeak" class="secondary wide">発話へ</button>`:""}</div>`;
  else if(s.step===4){const model=l.example||item.expression,target=chunkTargetSeconds(model);view.innerHTML=head+`<div class="card center"><h3>声でCLEAR</h3><div class="big">${esc(l.speakingPromptJa||item.meaning)}</div><p class="note">3・2・1の後に話してください。マイクが内容と時間を確認します。</p><div class="en">目標：${target}秒以内</div><button id="chunkCount" class="primary wide">🎙️ 3・2・1 → 話す</button><div id="chunkCD" class="countdown"></div><div id="speechResult"></div><div id="chunkModel" class="hidden"><div class="en big">${esc(model)}</div><button id="chunkModelHear" class="audioBtn">🔊 模範を聞く</button><button id="chunkRetry" class="secondary wide" style="margin-top:8px">もう一度</button><button id="chunkNext" class="primary wide hidden" style="margin-top:8px">CLEAR → 次へ</button></div></div>`;}
  if(s.step===1){$("#clHear").onclick=()=>playTTS(item.expression);$("#clMeaning").onclick=()=>{s.step=2;renderChunkLesson()}}
  if(s.step===2){$("#clExampleHear").onclick=()=>playTTS(l.example||item.seedExample||item.expression);$("#clWriteNext").onclick=()=>{s.step=3;renderChunkLesson()}}
  if(s.step===3){
    $("#checkWriting").onclick=async()=>{const answer=$("#chunkWriting").value.trim();if(!answer)return toast("英文を1文作ってください");s.writing=answer;$("#checkWriting").disabled=true;try{s.writingResult=await api("chunk-check",{expression:item.expression,meaning:item.meaning,answer});renderChunkLesson()}catch(e){showError(e)}};
    $("#toChunkSpeak")?.addEventListener("click",()=>{s.step=4;renderChunkLesson()});
  }
  if(s.step===4){
    const model=l.example||item.expression;
    const run=async()=>{try{const r=await timedChunkSpeech(item,model),p=chunkProg(item.id);p.attempts=(p.attempts||0)+1;p.lastTranscript=r.transcript;p.bestTime=p.bestTime==null?r.elapsed:Math.min(p.bestTime,r.elapsed);saveChunkProg(item.id,p);$("#chunkModel").classList.remove("hidden");const pass=!!r.ok&&!!r.withinTime;$("#speechResult").innerHTML=`<div class="weakrow"><b>${pass?"✅ CLEAR":"🔁 もう一度"}</b><div>認識：${esc(r.transcript||"（認識できませんでした）")}</div><div class="note">${r.elapsed.toFixed(1)}秒 / 目標 ${r.targetSeconds.toFixed(1)}秒　${esc(r.feedbackJa||"")}</div></div>`;$("#chunkNext").classList.toggle("hidden",!pass);if(pass)$("#chunkNext").onclick=()=>finishChunkItem(true);$("#chunkRetry").onclick=run;$("#chunkCount").disabled=false}catch(e){toast("音声認識に失敗しました。もう一度試してください");$("#chunkCount").disabled=false}};
    $("#chunkCount").onclick=run;$("#chunkModelHear").onclick=()=>playTTS(model);$("#chunkRetry").onclick=run;
  }
}
function finishChunkItem(ok){
  const s=state.chunks,item=s.items[s.index];
  updateChunkResult(item,ok);
  if(ok){const p=chunkProg(item.id);p.cleared=true;p.clearedAt=new Date().toISOString();p.due=Date.now()+3*86400000;saveChunkProg(item.id,p);markWeakSuccess(item.expression);}
  else addWeakness({type:"fluency",label:item.expression,better:item.lesson?.example||item.expression,ja:item.meaning,original:"3秒で出なかった",severityHint:1},"chunks");
  s.results.push({id:item.id,expression:item.expression,ok,scene:item.lesson?.roleplayScene||""});
  s.index++;s.step=1;s.writing="";s.writingResult=null;
  renderChunkLesson();
}
function renderChunkSummary(){
  const s=state.chunks,ok=s.results.filter(x=>x.ok).length;
  profile.stats.chunkSets++;saveProfile();logSession("chunks",{theme:s.theme,score:ok,total:s.results.length});
  const target=s.results.find(x=>!x.ok)||s.results[0];
  view.innerHTML=`<div class="card center"><div class="complete">${ok} / ${s.results.length}</div><h2>今日の5個 完了</h2><p class="muted">覚えたら終わりではなく、会話で使って定着させます。</p></div>
  <div class="card">${s.results.map(x=>`<div class="weakrow"><b>${x.ok?"✅":"🔁"} ${esc(x.expression)}</b></div>`).join("")}</div>
  ${target?`<div class="card"><h3>実戦へ</h3><p><b>${esc(target.expression)}</b> をRealtime会話で使ってみます。</p><button id="chunkRealtime" class="primary wide">Realtimeで使う</button></div>`:""}
  <button id="chunksHome" class="secondary wide">APP5トップへ</button>`;
  $("#chunkRealtime")?.addEventListener("click",()=>{
    const item=s.items.find(x=>x.id===target.id),scene=target.scene||`日常会話で ${target.expression} を自然に使う`;
    state.missionPreset={scene:`${scene}。今日のターゲット表現「${target.expression}」を自然に使う練習。`,target:target.expression};
    state.mission=null;state.chunks=null;go("mission");
  });
  $("#chunksHome").onclick=()=>{state.chunks=null;renderChunks()};
}

function showError(e){view.innerHTML=`<div class="card"><h2>エラー</h2><p style="word-break:break-word">${esc(e.message||String(e))}</p><button id="errBack" class="secondary wide">戻る</button></div>`;$("#errBack").onclick=()=>go(state.mode)}
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").then(r=>r.update()).catch(()=>{});go("home");
