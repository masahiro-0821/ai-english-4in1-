
import express from "express";
import dotenv from "dotenv";
dotenv.config();

const app=express();
app.use(express.json({limit:"1mb"}));
app.use(express.static("public"));
const URL="https://api.openai.com/v1/responses";

function outputText(d){
  if(d.output_text) return d.output_text;
  for(const item of d.output||[]) for(const c of item.content||[]) if(c.type==="output_text"&&c.text) return c.text;
  return "";
}
function parseJSON(t){
  t=t.replace(/^```json\s*/i,"").replace(/```$/,"").trim();
  try{return JSON.parse(t)}catch{
    const a=t.indexOf("{"), b=t.lastIndexOf("}");
    if(a>=0&&b>a)return JSON.parse(t.slice(a,b+1));
    throw new Error("AIの応答をJSONとして解析できませんでした");
  }
}
async function ask(model,instructions,input){
  if(!process.env.OPENAI_API_KEY)throw new Error("OPENAI_API_KEY が設定されていません");
  const r=await fetch(URL,{
    method:"POST",
    headers:{"content-type":"application/json","authorization":`Bearer ${process.env.OPENAI_API_KEY}`},
    body:JSON.stringify({model:model||process.env.OPENAI_MODEL||"gpt-5.4-mini",instructions,input})
  });
  const d=await r.json();
  if(!r.ok)throw new Error(d?.error?.message||`OpenAI API error ${r.status}`);
  return outputText(d);
}
const wrap=fn=>async(req,res)=>{try{res.json(await fn(req.body))}catch(e){res.status(500).json({error:e.message})}};
const common=`あなたは日本人の英語初心者向け教材設計者です。難しい英語を避け、実際の場面で目的を達成できる短く自然な英語を優先してください。説明は簡潔にしてください。指定されたJSONだけを返し、Markdownコードフェンスを付けないでください。`;

app.post("/api/phrases",wrap(async b=>parseJSON(await ask(b.model,common,`場面: ${b.scene}
その場面で本人が実際に言う可能性が高い短い英語フレーズを10個作ってください。最重要5つにimportant=true。
JSON:
{"scene":"場面","phrases":[{"ja":"日本語","en":"英語","kana":"自然なカタカナ発音","important":true}]}`))));

app.post("/api/phrases-more",wrap(async b=>parseJSON(await ask(b.model,common,`場面:${b.scene}
既存英文:${JSON.stringify(b.existing)}
重複しない新しいフレーズを5個。
JSON: {"phrases":[{"ja":"日本語","en":"英語","kana":"カタカナ","important":false}]}`))));

app.post("/api/mission-start",wrap(async b=>parseJSON(await ask(b.model,common,`場面:${b.scene}
難易度:${b.level}
英語で目的を達成する具体的なミッションを3つ作る。
JSON: {"missions":["ミッション1","ミッション2","ミッション3"],"role":"AIが演じる相手役"}`))));

app.post("/api/mission-turn",wrap(async b=>{
  const rules=common+`
あなたは英会話ロールプレイの相手役です。会話中は教師にならないでください。
文法・単語・不自然な表現があっても、意味が通じている限り訂正しません。
各ミッションを意味として達成したらdoneをtrueにしてください。
3つすべて達成した場合だけcomplete=trueにし、その時だけGOOD/NEXT/BETTER ENGLISHを返してください。
毎回同じ展開にせず、初心者でも対応できる軽い想定外を時々入れてください。`;
  return parseJSON(await ask(b.model,rules,`場面:${b.scene}
難易度:${b.level}
ミッション:${JSON.stringify(b.missions)}
会話履歴:${(b.history||[]).map(x=>`${x.role}: ${x.text}`).join("\n")||"(まだなし)"}
first:${!!b.first}
JSON:
{"reply":"相手役としての短い英語","done":[false,false,false],"complete":false,"feedback":{"good":"","next":["",""],"betterEnglish":""}}`));
}));

app.post("/api/listening",wrap(async b=>parseJSON(await ask(b.model,common,`場面:${b.scene}
レベル:${b.level}
15〜30秒程度の短い自然な英会話を作ってください。
内容理解を問う日本語4択クイズを3問。単語当てではなく意味・状況理解。answerは0〜3。
重要チャンクは最大3つ。
JSON:
{"dialogue":"英語会話全文","translation":"自然な日本語訳","meaningSummary":"短い意味解説","quiz":[{"question":"日本語の質問","options":["A","B","C","D"],"answer":0}],"chunks":[{"en":"英語チャンク","ja":"意味"}]}`))));

app.post("/api/fluency",wrap(async b=>parseJSON(await ask(b.model,common,`英文:${b.sentence}
自然な発話チャンクに分割し、日本人初心者が言いにくそうな部分を最大2つ選んでください。
精密な発音矯正ではなく、止まらずスムーズに言えることが目的。
JSON:
{"sentence":"入力英文","japanese":"自然な日本語訳","chunks":["チャンク"],"hardParts":["言いにくい部分"]}`))));

const port=process.env.PORT||3000;
app.listen(port,()=>console.log(`AI English 4-in-1: http://localhost:${port}`));
