import { extractJson, normalizeVisionGuess, type VisionGuess } from "./parse.js";

const SYSTEM_PROMPT = `You are an expert photographic geolocation analyst.
Estimate where a photo was taken from visual evidence only.

Use architecture, vegetation, terrain, weather and light, road markings, language on signs, vehicles, clothing, infrastructure, and any recognizable landmarks.
Return a single most-likely center point as latitude/longitude — not a country centroid unless that is truly all you can say.

Be honest when the image is ambiguous: still give your best guess, but lower confidence so the uncertainty radius stays wide. Do not invent false precision or claim a landmark you cannot support.

Respond with JSON only, no markdown:
{
  "latitude": number,
  "longitude": number,
  "placeName": "short human-readable label",
  "city": "city or null",
  "region": "region/state or null",
  "country": "country or null",
  "rationale": "1-3 sentences naming the visual cues you used",
  "confidence": number between 0 and 1
}

Confidence guide:
- 0.85–1.0 distinctive landmark or highly specific combination of cues
- 0.55–0.84 plausible city or region
- 0.25–0.54 broad regional guess
- below 0.25 very uncertain, country-scale or weaker`;

export type VisionProvider = "openai" | "anthropic" | "gemini";

/** Preference: OpenAI → Anthropic → Gemini. */
export function getVisionProvider(): VisionProvider | null {
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  return null;
}

export async function guessFromImage(dataUrl: string): Promise<VisionGuess> {
  const provider = getVisionProvider();
  if (!provider) {
    throw new Error(
      "Visual guessing needs an API key. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY and restart the server.",
    );
  }
  const { mediaType, base64 } = splitDataUrl(dataUrl);
  const text =
    provider === "openai"
      ? await callOpenAI(dataUrl)
      : provider === "anthropic"
        ? await callAnthropic(mediaType, base64)
        : await callGemini(mediaType, base64);
  return normalizeVisionGuess(extractJson(text));
}

function splitDataUrl(dataUrl: string): { mediaType: string; base64: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("The photo could not be encoded for analysis.");
  }
  return { mediaType: match[1], base64: match[2] };
}

async function callOpenAI(dataUrl: string): Promise<string> {
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Estimate where this photograph was taken.",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  const data = (await res.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI request failed (${res.status}).`);
  }
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned an empty response.");
  return text;
}

async function callAnthropic(mediaType: string, base64: string): Promise<string> {
  const model =
    process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: "Estimate where this photograph was taken." },
          ],
        },
      ],
    }),
  });
  const data = (await res.json()) as {
    error?: { message?: string };
    content?: { type: string; text?: string }[];
  };
  if (!res.ok) {
    throw new Error(data.error?.message || `Anthropic request failed (${res.status}).`);
  }
  const text = data.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Anthropic returned an empty response.");
  return text;
}

function geminiModelId(): string {
  const raw = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  return raw.replace(/^models\//, "");
}

async function callGemini(mediaType: string, base64: string): Promise<string> {
  const model = geminiModelId();
  const key = process.env.GEMINI_API_KEY?.trim() ?? "";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: "Estimate where this photograph was taken." },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    }),
  });
  const data = (await res.json()) as {
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
    candidates?: {
      finishReason?: string;
      content?: { parts?: { text?: string }[] };
    }[];
  };
  if (!res.ok) {
    throw new Error(
      data.error?.message
        ? `Gemini: ${data.error.message}`
        : `Gemini request failed (${res.status}).`,
    );
  }
  const block = data.promptFeedback?.blockReason;
  if (block) {
    throw new Error(`Gemini blocked the photo (${block}).`);
  }
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter(Boolean)
    .join("\n");
  if (!text) {
    const reason = data.candidates?.[0]?.finishReason;
    throw new Error(
      reason
        ? `Gemini returned an empty response (${reason}).`
        : "Gemini returned an empty response.",
    );
  }
  return text;
}
