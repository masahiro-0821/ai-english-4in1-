import express from "express";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.text({ type: ["application/sdp", "text/plain"], limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
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
  instructions: beginnerRules,
  input: `場面:${b.scene}\n難易度:${b.level}\n自由会話ではなく英語で目的を達成するゲーム。具体的なミッションを3つ。初心者が5〜10分で達成可能。\nJSON:{"scene":"...","role":"AIが演じる相手役","missions":["...","...","..."]}`
})));
app.post("/api/mission-progress", safe(async b => askJSON({
  model: FAST_MODEL,
  instructions: "Judge whether each practical conversation goal has been achieved from meaning, not grammar. Return JSON only.",
  input: `ミッション:${JSON.stringify(b.missions)}\n現在:${JSON.stringify(b.done)}\n最新ユーザー発話:${b.utterance}\n一度trueになったものはfalseに戻さない。JSON:{"done":[false,false,false]}`
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

app.post("/api/tts", async (req,res) => {
  try {
    const text=String(req.body?.text||"").slice(0,7000), speed=Math.max(.7,Math.min(1.3,Number(req.body?.speed||1)));
    if(!text) return res.status(400).json({error:"text is required"});
    const r=await fetch(`${OPENAI}/audio/speech`,{method:"POST",headers:{Authorization:`Bearer ${apiKey()}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4o-mini-tts",voice:"alloy",input:text,speed,response_format:"mp3"})});
    if(!r.ok) return res.status(r.status).send(await r.text());
    res.setHeader("Content-Type","audio/mpeg"); res.setHeader("Cache-Control","no-store"); res.send(Buffer.from(await r.arrayBuffer()));
  } catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});

app.post("/api/realtime-call", async (req,res) => {
  try {
    const sdp=req.body; if(!sdp||typeof sdp!=="string") return res.status(400).send("SDP offer is missing.");
    const scene=decodeURIComponent(String(req.query.scene||"hotel check-in")).slice(0,500), level=String(req.query.level||"NORMAL").slice(0,30);
    let missions=[]; try{missions=JSON.parse(decodeURIComponent(String(req.query.missions||"[]")));}catch{}
    const instructions=`You are a natural interactive English conversation partner for a Japanese learner.\nSCENE:${scene}\nDIFFICULTY:${level}\nMISSIONS:${JSON.stringify(missions)}\nRULES:\n- This is a mission game, not free talk. Stay in character.\n- During conversation NEVER correct grammar, vocabulary, pronunciation, or unnatural wording if meaning is understandable.\n- Conversation time = meaning and goals. Accuracy feedback happens only AFTER the conversation in the app.\n- Keep replies short, usually 1-2 sentences.\n- Let learner interrupt naturally; if they begin speaking while you speak, stop and listen.\n- Stop/Wait/ちょっと => stop. Slower/ゆっくり => slower. Faster/もっと早く => faster. Repeat/もう一度 => repeat.\n- Understand Japanese operational instructions.\n- Add occasional beginner-friendly unexpected turns appropriate to difficulty. EASY shorter/clearer; CHALLENGE slightly more unexpected turns.\n- Do not give exact English lines unless learner asks for a hint.\n- When all missions are clearly complete, say exactly \"MISSION COMPLETE.\" and then STOP. Do not coach.\n- Prioritize low latency, natural turn-taking, and interruption-friendly speech.`;
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
app.listen(PORT,()=>console.log(`AI English 4-in-1 running on port ${PORT}`));
