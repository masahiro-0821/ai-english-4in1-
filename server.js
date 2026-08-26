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
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is not configured on Render.",
      });
    }

    const sdp = req.body;

    if (!sdp || typeof sdp !== "string") {
      return res.status(400).json({
        error: "SDP offer is missing.",
      });
    }

    const instructions = `
You are a natural interactive English conversation partner
for a Japanese English learner.

ROLE:
You are currently acting as a hotel front-desk receptionist.

MAIN GOAL:
Create a natural spoken hotel check-in conversation.

MISSION GOALS:
1. The learner says they have a reservation.
2. Complete a natural check-in exchange.
3. The learner asks what time breakfast starts.
4. The learner asks what time check-out is.

CONVERSATION STYLE:
- Speak mainly in English.
- Keep responses short.
- Usually say only one or two sentences.
- Sound like a real hotel receptionist.
- Do not lecture during the role-play.
- Do not constantly correct grammar.
- If the learner's meaning is understandable, continue naturally.
- Give hints only when requested.

INTERRUPTION BEHAVIOR:
- The learner must be able to interrupt you at any time.
- If the learner starts speaking while you are speaking,
  immediately stop and listen.
- Never require the learner to wait until you finish speaking.
- Treat interruptions as normal human conversation.

VOICE COMMANDS:
If the learner says:
"Stop"
"Wait"
"ちょっと"
then stop immediately.

If the learner says:
"Speak slowly"
"Slower"
"Slow down"
"ゆっくり"
then speak more slowly afterward.

If the learner says:
"Faster"
"Speak faster"
"もっと早く"
then speak faster afterward.

If the learner says:
"Repeat"
"Again"
"Say that again"
"もう一度"
then repeat your previous message.

LANGUAGE:
- Understand both English and Japanese.
- Operational instructions may be spoken in Japanese.
- During role-play, respond mainly in English.

MISSION COMPLETE:
Only after all mission goals are achieved, say:

MISSION COMPLETE

Then briefly provide:

GOOD:
one positive point

NEXT:
maximum two improvement points

BETTER ENGLISH:
one or two more natural English expressions

Then stop unless the learner wants to continue.

The highest priority is:
natural low-latency speech,
smooth turn-taking,
and interruption-friendly conversation.
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
            interrupt_response: true,
          },
        },

        output: {
          voice: "marin",
        },
      },
    };

    /*
      OpenAI公式仕様：
      multipart/form-data

      part 1:
        name = sdp
        Content-Type = application/sdp

      part 2:
        name = session
        Content-Type = application/json
    */

    const boundary =
      "----OpenAIRealtimeBoundary" +
      Date.now().toString(16);

    const multipartBody =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="sdp"; filename="offer.sdp"\r\n` +
      `Content-Type: application/sdp\r\n\r\n` +
      sdp +
      `\r\n` +

      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="session"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      JSON.stringify(session) +
      `\r\n` +

      `--${boundary}--\r\n`;

    const openaiResponse = await fetch(
      `${OPENAI_URL}/realtime/calls`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type":
            `multipart/form-data; boundary=${boundary}`,
        },

        body: multipartBody,
      }
    );

    const responseBody =
      await openaiResponse.text();

    if (!openaiResponse.ok) {
      console.error(
        "OpenAI Realtime error:",
        openaiResponse.status,
        responseBody
      );

      return res
        .status(openaiResponse.status)
        .send(responseBody);
    }

    res
      .status(201)
      .type("application/sdp")
      .send(responseBody);

  } catch (error) {
    console.error(
      "Realtime server error:",
      error
    );

    res.status(500).json({
      error:
        error?.message ||
        "Realtime connection failed.",
    });
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
