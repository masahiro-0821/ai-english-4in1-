
import express from "express";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.text({ type: ["text/plain", "application/sdp"], limit: "2mb" }));
app.use(express.static("public"));

const OPENAI = "https://api.openai.com/v1";

app.post("/api/realtime-call", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY が設定されていません");

    const sdp = typeof req.body === "string" ? req.body : req.body?.sdp;
    const scene = String(req.query.scene || "hotel check-in").slice(0, 300);
    const level = String(req.query.level || "NORMAL").slice(0, 30);
    if (!sdp) return res.status(400).send("SDP offer is required");

    const instructions = `
You are an interactive English conversation partner for a Japanese beginner.
Current role-play scene: ${scene}
Difficulty: ${level}

ABSOLUTE RULES:
- Stay in character during role-play. For hotel check-in, act as hotel front-desk staff.
- Speak mostly in English during role-play.
- Do NOT correct grammar while role-play is active if meaning is understandable.
- Keep replies short and conversational, usually 1-2 sentences.
- Let the user interrupt you naturally. If the user starts speaking while you are talking, stop and listen.
- If the user says "stop", "wait", "ちょっと", or similar, stop immediately and wait.
- If the user says "slower", "speak slowly", or "ゆっくり", speak more slowly from then on.
- If the user says "faster", "more faster", or "もっと早く", increase speaking speed naturally.
- If the user says "repeat", "say that again", or "もう一度", repeat your previous point.
- Never lecture unless the user explicitly asks for feedback.
- For hotel check-in, naturally help the user complete:
  1) state that they have a reservation,
  2) ask breakfast time,
  3) ask check-out time.
- Once all goals are achieved, briefly say "MISSION COMPLETE", then only:
  GOOD: one short strength
  NEXT: at most two points
  BETTER ENGLISH: one or two improved phrases
- Understand Japanese operational instructions.
- Prioritize smooth turn-taking and low latency.
`;

    const session = {
      type: "realtime",
      model: "gpt-realtime-2.1-mini",
      output_modalities: ["audio"],
      instructions,
      max_output_tokens: 700,
      audio: {
        input: {
          turn_detection: {
            type: "semantic_vad",
            create_response: true,
            interrupt_response: true
          }
        },
        output: { voice: "marin" }
      }
    };

    const r = await fetch(`${OPENAI}/realtime/calls`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sdp, session })
    });

    const answer = await r.text();
    if (!r.ok) return res.status(r.status).send(answer);
    res.type("application/sdp").send(answer);
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, realtimeModel: "gpt-realtime-2.1-mini" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AI English Realtime running on ${port}`));
