import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(
  express.text({
    type: ["application/sdp", "text/plain"],
    limit: "2mb",
  })
);

app.use(express.static("public"));

const OPENAI_URL = "https://api.openai.com/v1";

app.post("/api/realtime-call", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).send(
        "OPENAI_API_KEY is not configured."
      );
    }

    const sdp = req.body;

    if (!sdp || typeof sdp !== "string") {
      return res.status(400).send(
        "SDP offer is missing."
      );
    }

    const instructions = `
You are a natural interactive English conversation partner
for a Japanese English learner.

ROLE:
You are a hotel front-desk receptionist.

MAIN GOAL:
Run a natural spoken hotel check-in role-play.

MISSION GOALS:
1. The learner says they have a reservation.
2. Complete a natural check-in exchange.
3. The learner asks what time breakfast starts.
4. The learner asks what time check-out is.

CONVERSATION STYLE:
- Speak mainly in English.
- Keep replies short, usually 1 or 2 sentences.
- Sound like a real hotel receptionist.
- Do not lecture during role-play.
- Do not constantly correct grammar.
- If the learner is understandable, continue naturally.

INTERRUPTION:
- The learner can interrupt you at any time.
- If the learner begins speaking while you are speaking, stop and listen.
- Treat interruptions as normal conversation.

VOICE COMMANDS:
- "Stop", "Wait", "ちょっと" → stop immediately.
- "Speak slowly", "Slower", "ゆっくり" → speak more slowly.
- "Faster", "Speak faster", "もっと早く" → speak faster.
- "Repeat", "Again", "Say that again", "もう一度" → repeat your previous message.

LANGUAGE:
- Understand Japanese and English.
- Operational instructions can be in Japanese.
- During role-play, respond mainly in English.

MISSION COMPLETE:
After all goals are achieved, briefly say:
MISSION COMPLETE

Then give only:
GOOD: one positive point
NEXT: maximum two improvement points
BETTER ENGLISH: one or two natural expressions

Prioritize low latency, natural turn-taking,
and interruption-friendly conversation.
`;

    const sessionConfig = JSON.stringify({
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
            interrupt_response: true,
          },
        },
        output: {
          voice: "marin",
        },
      },
    });

    // OpenAI公式のNode例と同じ方式
    const fd = new FormData();

    fd.set("sdp", sdp);
    fd.set("session", sessionConfig);

    const openaiResponse = await fetch(
      `${OPENAI_URL}/realtime/calls`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: fd,
      }
    );

    const answerSdp =
      await openaiResponse.text();

    if (!openaiResponse.ok) {
      console.error(
        "OpenAI Realtime API error:",
        openaiResponse.status,
        answerSdp
      );

      return res
        .status(openaiResponse.status)
        .send(answerSdp);
    }

    res
      .type("application/sdp")
      .send(answerSdp);

  } catch (error) {
    console.error(
      "Realtime server error:",
      error
    );

    res
      .status(500)
      .send(
        error?.message ||
        "Realtime connection failed."
      );
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    model: "gpt-realtime-2.1-mini",
    realtime: true,
  });
});

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `AI English Realtime running on port ${PORT}`
  );
});
