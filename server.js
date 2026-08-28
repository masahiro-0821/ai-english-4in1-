import express from "express";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.text({ type: ["application/sdp", "text/plain"], limit: "2mb" }));
app.use(express.json({ limit: "12mb" }));
app.use(express.static("public"));

const OPENAI = "https://api.openai.com/v1";
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna";
const FAST_MODEL = process.env.OPENAI_FAST_MODEL || "gpt-5.4-nano";
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";

function apiKey() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY が設定されていません");
  return process.env.OPENAI_API_KEY;
}
function outputText(data) {
  if (data.output_text) return data.output_text;
  for (const item of data.output || []) for (const part of item.content || []) if (part.type === "output_text" && part.text) return part.text;
  return "";
}
function parseJSON(text) {
  const cleaned = String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const a = cleaned.indexOf("{"), b = cleaned.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(cleaned.slice(a, b + 1));
    throw new Error("AIのJSON応答を解析できませんでした");
  }
}
async function askJSON({ model = TEXT_MODEL, instructions, input }) {
  const r = await fetch(`${OPENAI}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, instructions, input, max_output_tokens: 2500 })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `OpenAI API error ${r.status}`);
  return parseJSON(outputText(data));
}
const safe = fn => async (req,res) => { try { res.json(await fn(req.body || {}, req)); } catch(e){ console.error(e); res.status(500).json({error:e.message}); } };
const beginnerRules = `You design English training for Japanese learners. Use short, practical, natural English. Avoid difficult vocabulary. Prioritize what the learner is actually likely to say in the specified scene. Never overload the learner with explanations. Return ONLY the requested JSON. No markdown fences.`;

app.post("/api/phrases", safe(async b => askJSON({
  instructions: beginnerRules,
  input: `場面: ${b.scene}\n本人が実際に使う可能性の高い短い英語フレーズを10個。大量暗記ではなくその場面を乗り切る最小限の英語。最重要5つだけimportant=true。\nJSON:{"scene":"...","phrases":[{"ja":"...","en":"...","kana":"日本人向けの自然なカタカナ発音","important":true}]}`
})));
app.post("/api/phrases-more", safe(async b => askJSON({
  instructions: beginnerRules,
  input: `場面:${b.scene}\n既存英文:${JSON.stringify(b.existing||[])}\n重複しない新しい実用フレーズを5個。\nJSON:{"phrases":[{"ja":"...","en":"...","kana":"...","important":false}]}`
})));
app.post("/api/listening", safe(async b => askJSON({
  instructions: beginnerRules,
  input: `場面:${b.scene}\nレベル:${b.level}\n15〜30秒の短い自然な英会話。4択3問は単語当てではなく意味・状況理解。answerは0〜3。重要チャンク最大3つ。\nJSON:{"dialogue":"音読可能な英語会話","translation":"自然な日本語訳","meaningSummary":"意味の流れを1〜2文","quiz":[{"question":"日本語","options":["","","",""],"answer":0}],"chunks":[{"en":"...","ja":"..."}]}`
})));
app.post("/api/fluency", safe(async b => askJSON({
  instructions: beginnerRules,
  input: `英文:${b.sentence}\n目的は完璧な発音ではなく考え込まず止まらず口から出すこと。自然な発話チャンクに分割し、日本人初心者が引っかかりそうな候補を最大2つ。\nJSON:{"sentence":"入力英文そのまま","japanese":"自然な日本語","chunks":["..."],"hardParts":["..."]}`
})));
app.post("/api/mission-plan", safe(async b => askJSON({
  instructions: `You design a practical beginner role-play mission.
Return exactly 3 missions.
Each mission must describe an action the USER must personally perform.
For each mission, also provide a strict criterion stating exactly what USER meaning counts as completion.
Do not make a criterion depend on what the AI says.
Return JSON only.`,
  input: `場面:${b.scene}
難易度:${b.level}
JSON:
{"scene":"...","role":"AIが演じる現実の相手役","missions":[
{"label":"ユーザー向け表示文","criterion":"ユーザー自身が何を伝える/尋ねる必要があるか"},
{"label":"...","criterion":"..."},
{"label":"...","criterion":"..."}
]}`
})));
app.post("/api/mission-progress", safe(async b => askJSON({
  model: FAST_MODEL,
  instructions: `You are a strict mission evidence checker.
Judge ONLY the latest USER utterance.
Never infer completion from the AI's words, earlier AI suggestions, future intent, or context the user did not explicitly express.
A mission is achieved only when the latest user utterance directly performs the required communicative act.
If evidence is ambiguous, do NOT mark it achieved.
If the criterion requires ASKING, a statement is not enough.
If the criterion requires TELLING, the user must actually convey that information.
If the criterion requires SHOWING/HANDING something, a natural phrase like "Here you are" may count only for that mission.
Return only newly achieved mission indexes, with an exact quote from latestUserUtterance as evidence.
Return JSON only.`,
  input: `missions:${JSON.stringify(b.missions)}
alreadyDone:${JSON.stringify(b.done)}
latestUserUtterance:${JSON.stringify(b.utterance)}

Rules:
- Ignore alreadyDone items.
- Evidence must be an exact quote from latestUserUtterance.
- Do not mark any mission without direct evidence.
- One utterance may achieve multiple missions only if it explicitly contains separate evidence for each.

JSON:
{"newlyAchieved":[{"index":0,"evidence":"exact words"}]}`
})));
app.post("/api/mission-review", safe(async b => askJSON({
  instructions: `You are a concise English coach for Japanese beginners.
During role-play there was no correction. Now, and only now, review accuracy.
NEXT must contain at most 2 points.
BETTER ENGLISH must contain at most 2 corrections.
Also identify at most 2 HIGH-FREQUENCY CHUNKS only when they are genuinely useful:
- common in everyday spoken English,
- natural and short,
- reusable across many situations,
- easier or more useful than the learner's original wording.
Do NOT force a chunk suggestion when the learner's wording is already natural.
Do NOT claim an exact corpus rank or numeric frequency.
Prefer broadly reusable chunks such as "more often", "I'm looking for...", "It depends on...", "I'm not sure if...", etc. only when contextually appropriate.
The high-frequency chunk may be a collocation, formulaic sequence, or phrasal verb.
Return JSON only.`,
  input: `場面:${b.scene}
ミッション:${JSON.stringify(b.missions)}
会話:${JSON.stringify(b.transcript)}
既存苦手:${JSON.stringify(b.weaknesses||[])}

GOODは1〜2文。
NEXT最大2。
BETTER ENGLISH最大2。
weaknesses最大3。typeはexpression/grammar/vocabulary/listening/fluency。severityHintは1〜3。

HIGH-FREQUENCY CHUNKは最大2件。
chunk = 覚える価値が高い言葉の塊そのもの。
example = 今回の会話に合わせた初心者向け自然な例文。
ja = 例文の自然な日本語。
why = 「短い・よく使う・応用しやすい」など、学ぶ価値を日本語で短く。
sourceOriginal = どのユーザー発話から提案したか。該当がなければ空文字。

JSON:
{"good":"...","next":["..."],"betterEnglish":[{"original":"...","better":"...","ja":"..."}],"highFrequencyChunks":[{"chunk":"...","example":"...","ja":"...","why":"...","sourceOriginal":"..."}],"weaknesses":[{"type":"expression","label":"...","original":"...","better":"...","ja":"...","severityHint":1}]}`
})));


// APP 5: corpus-priority Chunks & Phrasal Verbs
app.post("/api/chunk-lessons", safe(async b => askJSON({
  instructions: `You create practical chunk and phrasal-verb practice for a Japanese English learner.
The item list has already been selected by corpus/usefulness priority. Do NOT invent frequency ranks.
Keep English short, natural, reusable, and suitable for spoken communication.
For phrasal verbs with many meanings, teach ONLY the supplied target meaning in this lesson.
Personalize examples to the requested theme when natural.
Return JSON only.`,
  input: `テーマ:${b.theme || "日常・旅行・仕事"}
項目:${JSON.stringify(b.items || [])}

各itemについて:
- idは入力と同じ
- example: その表現を使う短い自然な英文
- exampleJa: 自然な日本語
- secondExample: 別場面でも使える短い例文
- writingPromptJa: 学習者がその表現を必ず使って英作文できる日本語のお題
- speakingPromptJa: 3秒以内に英語で言うための日本語
- roleplayScene: Realtime会話でその表現を自然に使えそうな場面を日本語で短く
- tip: 使い方の注意を日本語で1文。文法講義はしない

JSON:
{"lessons":[{"id":"...","example":"...","exampleJa":"...","secondExample":"...","writingPromptJa":"...","speakingPromptJa":"...","roleplayScene":"...","tip":"..."}]}`
})));

app.post("/api/chunk-check", safe(async b => askJSON({
  model: FAST_MODEL,
  instructions: `You are a gentle English coach. Judge whether the learner used the target chunk naturally enough.
Do not punish tiny grammar or punctuation issues.
If understandable but unnatural, give one short natural revision.
Return JSON only.`,
  input: `ターゲット:${b.expression}
意味:${b.meaning}
学習者の英文:${b.answer}

JSON:
{"ok":true,"feedbackJa":"短い日本語","natural":"必要なら自然な英文。直し不要なら入力英文","usedTarget":true}`
})));

app.post("/api/chunk-transcribe", async (req,res) => {
  try{
    const audio=String(req.body?.audio||""),mime=String(req.body?.mime||"audio/webm");if(!audio)return res.status(400).json({error:"audio is required"});
    const bytes=Buffer.from(audio,"base64");
    if(bytes.length<800)return res.status(400).json({error:"recorded audio is empty"});
    const ext=mime.includes("mp4")?"m4a":mime.includes("ogg")?"ogg":mime.includes("wav")?"wav":"webm";
    const fd=new FormData();fd.set("file",new Blob([bytes],{type:mime}),`speech.${ext}`);fd.set("model","gpt-4o-mini-transcribe");fd.set("language","en");
    const r=await fetch(`${OPENAI}/audio/transcriptions`,{method:"POST",headers:{Authorization:`Bearer ${apiKey()}`},body:fd});const d=await r.json();if(!r.ok)return res.status(r.status).json(d);res.json({text:d.text||""});
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});
app.post("/api/chunk-speech-check", safe(async b => askJSON({
  model:FAST_MODEL,
  instructions:`Judge a Japanese English learner's spoken attempt. The goal is fluent retrieval, not accent perfection. Accept small article, contraction, or transcription differences when the intended target sentence is clearly communicated. Return JSON only.`,
  input:`Target model:${b.target}\nTarget chunk:${b.expression}\nTranscript:${b.transcript}\nElapsed:${b.elapsed}\nTime limit:${b.targetSeconds}\nJSON:{"ok":true,"withinTime":true,"feedbackJa":"短い日本語。内容OK/不足を説明"}`
})));

app.post("/api/tts", async (req,res) => {
  try {
    const text=String(req.body?.text||"").slice(0,7000), speed=Math.max(.7,Math.min(1.3,Number(req.body?.speed||1)));
    if(!text) return res.status(400).json({error:"text is required"});
    const r=await fetch(`${OPENAI}/audio/speech`,{method:"POST",headers:{Authorization:`Bearer ${apiKey()}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4o-mini-tts",voice:"alloy",input:text,speed,response_format:"mp3"})});
    if(!r.ok) return res.status(r.status).send(await r.text());
    res.setHeader("Content-Type","audio/mpeg"); res.setHeader("Cache-Control","no-store"); res.send(Buffer.from(await r.arrayBuffer()));
  } catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});


app.post("/api/roleplay-opener", safe(async b => {
  const scene=String(b.scene||"").toLowerCase();
  const role=String(b.role||"").toLowerCase();
  const s=scene+" "+role;

  let opener="Hello. How can I help you?";

  // Natural first-contact lines by situation. These are intentionally deterministic:
  // the Realtime model does not get a chance to introduce itself as a teacher.
  if(/cafe|coffee|barista|カフェ|コーヒー|喫茶/.test(s))
    opener="Hi! Welcome. What can I get for you?";
  else if(/hotel|front desk|reception|check.?in|ホテル|フロント|チェックイン/.test(s))
    opener="Good evening. Welcome. How can I help you?";
  else if(/restaurant|server|waiter|waitress|レストラン|飲食店/.test(s))
    opener="Good evening. Welcome. Are you ready to order?";
  else if(/shop|store|clerk|shopping|買い物|ショップ|店員/.test(s))
    opener="Hi! Welcome. Can I help you find something?";
  else if(/airport|airline|check.?in counter|空港|航空/.test(s))
    opener="Good afternoon. May I see your passport, please?";
  else if(/immigration|passport control|入国審査/.test(s))
    opener="Good afternoon. May I see your passport, please?";
  else if(/taxi|cab|タクシー/.test(s))
    opener="Hi. Where would you like to go?";
  else if(/direction|street|道を聞|道案内|通行人/.test(s))
    opener="Hi. Can I help you?";
  else if(/meeting|coworker|colleague|progress|会議|同僚|進捗/.test(s))
    opener="Hi. Shall we get started?";
  else if(/office|receptionist|受付|オフィス/.test(s))
    opener="Good morning. How can I help you?";
  else if(/doctor|clinic|hospital|医者|病院|クリニック/.test(s))
    opener="Hello. What brings you in today?";
  else if(/phone|telephone|call|電話/.test(s))
    opener="Hello. How can I help you?";
  else if(/friend|casual|友人|友達/.test(s))
    opener="Hey! How's it going?";

  return {opener};
}));

app.post("/api/realtime-call", async (req,res) => {
  try {
    const sdp=req.body; if(!sdp||typeof sdp!=="string") return res.status(400).send("SDP offer is missing.");
    const scene=decodeURIComponent(String(req.query.scene||"hotel check-in")).slice(0,500);
    const level=String(req.query.level||"NORMAL").slice(0,30);
    const role=decodeURIComponent(String(req.query.role||"the real-world counterpart in this scene")).slice(0,300);
    let missions=[]; try{missions=JSON.parse(decodeURIComponent(String(req.query.missions||"[]")));}catch{}
    const instructions=`STRICT ROLEPLAY MODE — ABSOLUTE PRIORITY

SCENE:
${scene}

YOUR REAL-WORLD ROLE:
${role}

MISSION GOALS:
${JSON.stringify(missions)}

DIFFICULTY:
${level}

SYSTEM BEHAVIOR:
You are not a teacher.
You are not a coach.
You are not a guide.
You are not a language-learning assistant.
You are not a narrator.
You are not a chatbot explaining the exercise.

You are ONLY the real-world person in the role above.

BEHAVIOR DURING ROLEPLAY:
- Speak exactly as that real person would speak in the scene.
- Never mention language practice, English practice, learning, training, exercise, mission, goal, learner, grammar, vocabulary, pronunciation, correction, feedback, coaching, lesson, guide, or similar concepts.
- Never praise or evaluate the user's English.
- Do not use teacher-like approval such as "Nice", "Awesome", "Good question", "Perfect", or "Great job". Use neutral, role-appropriate transaction language instead.
- Never tell the user what they should say.
- Never give example sentences unless the user explicitly asks for a hint.
- Never explain why a sentence is right or wrong.
- Never paraphrase the user's English as a lesson.
- Never narrate your reasoning.
- Never say "let me think it aloud", "let's keep it rolling", "we'll practice", "we'll add", or similar coaching language.
- Never mention that you cannot access a live menu, real prices, real hotel data, or external systems.
- Treat the scene as a fictional but internally real world.
- If asked for a price, total, room number, breakfast time, opening hour, availability, or similar detail, invent a simple plausible value and answer in character.
- If the user's meaning is understandable, continue the transaction naturally without correction.
- If the user's meaning is unclear, ask exactly ONE short in-character clarification question.
- Never silently change an unclear request into a different item.
- Keep every reply short: normally 1 sentence; at most 2.
- Do not add unnecessary questions.
- Do not upsell unless it is one of the mission goals or absolutely natural in context.
- Do not introduce unrelated small talk.
- Do not lengthen the conversation artificially.

ROLEPLAY FLOW:
1. The app supplies the opening line. Continue from it as the real-world role; never introduce yourself as a language buddy, teacher, guide, or learning assistant.
2. Let the user respond.
3. Respond only to what a real person in this scene would respond to.
4. Move the transaction/conversation naturally toward the mission goals.
5. Once the mission goals are complete, close the real-world interaction naturally in one short line.
6. Then say exactly:
MISSION COMPLETE.
7. Stop speaking immediately after that.

TURN-TAKING:
- Let the user finish.
- Do not interrupt the user with teaching or corrections.
- The user may interrupt YOU at any time. If the user starts speaking while you speak, stop and listen.
- "Stop", "Wait", "ちょっと" => stop immediately.
- "Slower", "Speak slowly", "ゆっくり" => speak more slowly afterward.
- "Faster", "Speak faster", "もっと早く" => speak faster afterward.
- "Repeat", "Again", "Say that again", "もう一度" => repeat your previous in-character line.

DIFFICULTY:
- EASY: direct, predictable, very short.
- NORMAL: direct and realistic; only one brief clarification/follow-up if needed.
- CHALLENGE: slightly more realistic follow-ups, still beginner-friendly.

ABSOLUTE END RULE:
After MISSION COMPLETE, do NOT give GOOD, NEXT, BETTER ENGLISH, HIGH-FREQUENCY CHUNK, or any teaching verbally.
The app handles all review only after the roleplay ends.

Think silently, speak only as the role.`;
    const sessionConfig=JSON.stringify({
      type:"realtime",model:REALTIME_MODEL,output_modalities:["audio"],instructions,max_output_tokens:700,
      audio:{input:{transcription:{model:"gpt-4o-mini-transcribe"},turn_detection:{type:"semantic_vad",create_response:true,interrupt_response:true}},output:{voice:"marin"}}
    });
    const fd=new FormData(); fd.set("sdp",sdp); fd.set("session",sessionConfig);
    const r=await fetch(`${OPENAI}/realtime/calls`,{method:"POST",headers:{Authorization:`Bearer ${apiKey()}`},body:fd});
    const answer=await r.text(); if(!r.ok){console.error("Realtime error",r.status,answer);return res.status(r.status).send(answer);} res.type("application/sdp").send(answer);
  } catch(e){console.error(e);res.status(500).send(e.message);}
});

app.get("/api/health",(req,res)=>res.json({ok:true,realtimeModel:REALTIME_MODEL,textModel:TEXT_MODEL,fastModel:FAST_MODEL}));
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`AI English 5-in-1 running on port ${PORT}`));
