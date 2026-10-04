import { describePhotoMetadata, type PhotoMetadata } from "./metadata.js";
import {
  extractJson,
  missingJsonError,
  RATIONALE_MAX_CHARS,
  readVisionGuess,
  type VisionGuess,
} from "./parse.js";

const ANALYST_PROMPT = `You are an expert photographic geolocation analyst.
Estimate where a photo was taken, mainly from visual evidence.

Use architecture, vegetation, terrain, weather and light, road markings, language on signs, vehicles, clothing, infrastructure, and any recognizable landmarks.
Return a single most-likely center point as latitude/longitude — not a country centroid unless that is truly all you can say.

Be honest when the image is ambiguous: still give your best guess, but lower confidence so the uncertainty radius stays wide. Do not invent false precision or claim a landmark you cannot support.

Keep the rationale to at most 2 short sentences naming the key cues. Be concise and do not repeat yourself.

Confidence guide:
- 0.85–1.0 distinctive landmark or highly specific combination of cues
- 0.55–0.84 plausible city or region
- 0.25–0.54 broad regional guess
- below 0.25 very uncertain, country-scale or weaker`;

/** Anthropic gets the JSON shape in the prompt because this call has no schema-constrained output. */
const ANTHROPIC_SYSTEM_PROMPT = `${ANALYST_PROMPT}

Respond with JSON only, no markdown:
{
  "latitude": number,
  "longitude": number,
  "confidence": number between 0 and 1,
  "placeName": "short human-readable label",
  "city": "city or null",
  "region": "region/state or null",
  "country": "country or null",
  "rationale": "at most 2 short sentences naming the visual cues you used"
}`;

const LOCATION_FIELDS = [
  "latitude",
  "longitude",
  "confidence",
  "placeName",
  "city",
  "region",
  "country",
  "rationale",
];

const RATIONALE_HINT = `At most 2 short sentences (under ${RATIONALE_MAX_CHARS} characters) naming the key visual cues.`;

/**
 * Coordinates and confidence come first so a reply cut off by the token limit
 * still carries them. Every field is required and the prompt does not restate
 * the field order: Gemini's troubleshooting guide ties optional fields and
 * prompt/schema order mismatches to repeated text in structured output.
 */
export const GEMINI_LOCATION_SCHEMA = {
  type: "OBJECT",
  properties: {
    latitude: { type: "NUMBER", minimum: -90, maximum: 90 },
    longitude: { type: "NUMBER", minimum: -180, maximum: 180 },
    confidence: { type: "NUMBER", minimum: 0, maximum: 1 },
    placeName: { type: "STRING", maxLength: 100 },
    city: { type: "STRING", nullable: true, maxLength: 100 },
    region: { type: "STRING", nullable: true, maxLength: 100 },
    country: { type: "STRING", nullable: true, maxLength: 100 },
    rationale: { type: "STRING", maxLength: RATIONALE_MAX_CHARS, description: RATIONALE_HINT },
  },
  propertyOrdering: LOCATION_FIELDS,
  required: LOCATION_FIELDS,
};

/**
 * Same fields in the same order (OpenAI emits keys in schema order). Strict mode
 * does not list maxLength among supported string keywords, so the rationale cap
 * lives in the description and in clipRationale.
 */
export const OPENAI_LOCATION_SCHEMA = {
  type: "object",
  properties: {
    latitude: { type: "number", minimum: -90, maximum: 90 },
    longitude: { type: "number", minimum: -180, maximum: 180 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    placeName: { type: "string" },
    city: { type: ["string", "null"] },
    region: { type: ["string", "null"] },
    country: { type: ["string", "null"] },
    rationale: { type: "string", description: RATIONALE_HINT },
  },
  required: LOCATION_FIELDS,
  additionalProperties: false,
};

const GEMINI_DAILY_QUOTA_MESSAGE =
  "The free AI quota is used up for today. Try again tomorrow, or use a photo that has GPS data.";
const OPENAI_QUOTA_MESSAGE =
  "The AI quota for this site is used up for now (OpenAI credits or spend limit reached). Try again later, or use a photo that has GPS data.";
const RATE_LIMITED_MESSAGE =
  "The AI service is getting too many requests right now. Wait a minute and try again, or use a photo that has GPS data.";

/** A provider quota or rate limit. The message is written for end users. */
export class QuotaExceededError extends Error {
  name = "QuotaExceededError";
}

export type VisionProvider = "openai" | "anthropic" | "gemini";

/** Preference: OpenAI → Anthropic → Gemini. */
export function getVisionProvider(): VisionProvider | null {
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  return null;
}

type InlineImage = { mediaType: string; base64: string };

type ModelReply = {
  provider: "OpenAI" | "Anthropic" | "Gemini";
  text: string;
  /** Provider details for logs and the error message when no coordinates can be read. */
  diagnostics: string;
  /** False when a second attempt would be refused the same way (safety blocks, refusals). */
  retryable: boolean;
};

const MAX_ATTEMPTS = 2;
/** Retry only after a quick first attempt so both fit in the 60 s Vercel function limit. */
const RETRY_WITHIN_MS = 20_000;

export async function guessFromImage(
  dataUrl: string,
  metadata?: PhotoMetadata,
): Promise<VisionGuess> {
  const provider = getVisionProvider();
  if (!provider) {
    throw new Error(
      "Visual guessing needs an API key. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY and restart the server.",
    );
  }
  const image = splitDataUrl(dataUrl);
  const prompt = ["Estimate where this photograph was taken.", describePhotoMetadata(metadata)]
    .filter(Boolean)
    .join("\n\n");
  const started = Date.now();

  for (let attempt = 1; ; attempt++) {
    const reply =
      provider === "openai"
        ? await callOpenAI(dataUrl, prompt)
        : provider === "anthropic"
          ? await callAnthropic(image, prompt)
          : await callGemini(image, prompt);
    const guess = readVisionGuess(reply.text);
    if (guess) return guess;

    const retrying =
      reply.retryable && attempt < MAX_ATTEMPTS && Date.now() - started < RETRY_WITHIN_MS;
    const log = retrying ? console.warn : console.error;
    log(`[${reply.provider.toLowerCase()}] no usable location in reply`, {
      attempt,
      retrying,
      diagnostics: reply.diagnostics,
      preview: reply.text.replace(/\s+/g, " ").trim().slice(0, 240),
    });
    if (!retrying) {
      const diagnostics = [reply.diagnostics, `attempts=${attempt}`].filter(Boolean).join(", ");
      throw new Error(
        missingJsonError(reply.text, `${reply.provider} diagnostics: ${diagnostics}.`),
      );
    }
  }
}

function splitDataUrl(dataUrl: string): InlineImage {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("The photo could not be encoded for analysis.");
  }
  return { mediaType: match[1], base64: match[2] };
}

async function readJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}

type OpenAIError = {
  message?: string;
  type?: string;
  code?: string | null;
  param?: string | null;
};

type OpenAIResponse = {
  status?: string;
  error?: OpenAIError | null;
  incomplete_details?: { reason?: string } | null;
  output?: {
    type?: string;
    content?: { type?: string; text?: string; refusal?: string }[];
  }[];
  usage?: { output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
};

async function callOpenAI(dataUrl: string, prompt: string): Promise<ModelReply> {
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-luna";
  let res = await postOpenAI(openAIRequestBody(model, dataUrl, prompt, true));
  let data = await readJson<OpenAIResponse>(res);
  if (res.status === 400 && isReasoningParamError(data.error)) {
    // Non-reasoning models (e.g. an OPENAI_MODEL=gpt-4o override) reject `reasoning`.
    res = await postOpenAI(openAIRequestBody(model, dataUrl, prompt, false));
    data = await readJson<OpenAIResponse>(res);
  }
  if (!res.ok) throw openAIRequestError(res.status, data.error);

  const content = (data.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? []);
  const text = content
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("");
  const refusal = content.find((part) => part.type === "refusal")?.refusal;
  const reason = data.incomplete_details?.reason;
  const reasoningTokens = data.usage?.output_tokens_details?.reasoning_tokens;
  if (data.status && data.status !== "completed") {
    console.warn("[openai] response not completed", {
      status: data.status,
      reason,
      usage: data.usage,
    });
  }

  return {
    provider: "OpenAI",
    text,
    diagnostics: [
      data.status ? `status=${data.status}` : "",
      reason ? `reason=${reason}` : "",
      typeof reasoningTokens === "number" ? `reasoningTokens=${reasoningTokens}` : "",
      data.error?.message ? `error=${data.error.message}` : "",
      refusal ? `refusal=${refusal}` : "",
    ]
      .filter(Boolean)
      .join(", "),
    retryable: !refusal && reason !== "content_filter",
  };
}

function openAIRequestBody(model: string, dataUrl: string, prompt: string, reasoning: boolean) {
  return {
    model,
    instructions: ANALYST_PROMPT,
    input: [
      {
        role: "user",
        content: [
          { type: "input_image", image_url: dataUrl },
          { type: "input_text", text: prompt },
        ],
      },
    ],
    ...(reasoning ? { reasoning: { effort: "low" } } : {}),
    text: {
      format: {
        type: "json_schema",
        name: "location_estimate",
        schema: OPENAI_LOCATION_SCHEMA,
        strict: true,
      },
    },
    // Includes reasoning tokens; low effort leaves ample room for the short JSON reply.
    max_output_tokens: 4000,
    store: false,
  };
}

function postOpenAI(body: unknown): Promise<Response> {
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function isReasoningParamError(error: OpenAIError | null | undefined): boolean {
  return Boolean(
    error?.param?.startsWith("reasoning") || /\breasoning\b/i.test(error?.message ?? ""),
  );
}

/** Billing errors keep `type: insufficient_quota` while `code` names the cause (credits, spend limit, …). */
function openAIRequestError(status: number, error: OpenAIError | null | undefined): Error {
  const billing =
    error?.type === "insufficient_quota" ||
    /quota|credit|spend_limit|usage_limit|billing/i.test(error?.code ?? "");
  if (status === 429 || billing) {
    console.error("[openai] quota or rate limit", { status, type: error?.type, code: error?.code });
    return new QuotaExceededError(billing ? OPENAI_QUOTA_MESSAGE : RATE_LIMITED_MESSAGE);
  }
  return new Error(
    error?.message ? `OpenAI: ${error.message}` : `OpenAI request failed (${status}).`,
  );
}

async function callAnthropic(image: InlineImage, prompt: string): Promise<ModelReply> {
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
      system: ANTHROPIC_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: image.mediaType, data: image.base64 },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });
  const data = await readJson<{
    error?: { message?: string };
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  }>(res);
  if (!res.ok) {
    if (res.status === 429) throw new QuotaExceededError(RATE_LIMITED_MESSAGE);
    throw new Error(data.error?.message || `Anthropic request failed (${res.status}).`);
  }
  return {
    provider: "Anthropic",
    text: (data.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join(""),
    diagnostics: data.stop_reason ? `stop_reason=${data.stop_reason}` : "",
    retryable: data.stop_reason !== "refusal",
  };
}

function geminiModelId(): string {
  const raw = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  return raw.replace(/^models\//, "");
}

export type GeminiPart = {
  text?: string;
  thought?: boolean;
};

type GeminiError = {
  message?: string;
  status?: string;
  details?: { "@type"?: string; violations?: { quotaId?: string }[] }[];
};

export type GeminiGenerateResponse = {
  error?: GeminiError;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    thoughtsTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  candidates?: {
    finishReason?: string;
    finishMessage?: string;
    safetyRatings?: { category?: string; probability?: string; blocked?: boolean }[];
    content?: { parts?: GeminiPart[] };
  }[];
};

/** Skip thought/reasoning parts; they often consume the token budget on Gemini 3. */
export function collectGeminiText(
  parts: GeminiPart[] | undefined,
  includeThoughts = false,
): string {
  if (!parts?.length) return "";
  return parts
    .filter((part) => includeThoughts || part.thought !== true)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter((text) => text.trim().length > 0)
    .join("\n")
    .trim();
}

function looksLikeJsonObject(text: string): boolean {
  if (!text.trim()) return false;
  try {
    extractJson(text);
    return true;
  } catch {
    return false;
  }
}

/** Prefer visible answer text; fall back to thought parts if they contain JSON. */
export function geminiTextForParse(parts: GeminiPart[] | undefined): string {
  const answer = collectGeminiText(parts, false);
  if (looksLikeJsonObject(answer)) return answer;
  const withThoughts = collectGeminiText(parts, true);
  if (looksLikeJsonObject(withThoughts)) return withThoughts;
  return answer || withThoughts;
}

/** Content blocks that a second attempt would hit again. */
const UNRETRYABLE_FINISH_REASONS = new Set([
  "SAFETY",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "ESCALATION",
  "PUP_LIMITED_DISABLED",
]);

async function callGemini(image: InlineImage, prompt: string): Promise<ModelReply> {
  const model = geminiModelId();
  let res = await postGemini(model, geminiRequestBody(image, prompt, true));
  let data = await readJson<GeminiGenerateResponse>(res);
  if (res.status === 400 && /thinking/i.test(data.error?.message ?? "")) {
    // `minimal` is an error on some models (Gemini 3.7/3.8 Flash, 3.1 Pro); use the model default.
    res = await postGemini(model, geminiRequestBody(image, prompt, false));
    data = await readJson<GeminiGenerateResponse>(res);
  }
  if (!res.ok) throw geminiRequestError(res.status, data.error);

  const block = data.promptFeedback?.blockReason;
  if (block) {
    throw new Error(`Gemini blocked the photo (${block}).`);
  }

  const candidate = data.candidates?.[0];
  const finishReason = candidate?.finishReason ?? "";
  if (finishReason && finishReason !== "STOP") {
    console.warn("[gemini] reply did not finish normally", {
      finishReason,
      usage: data.usageMetadata,
    });
  }
  return {
    provider: "Gemini",
    text: geminiTextForParse(candidate?.content?.parts),
    diagnostics: geminiFailureExtras(data, candidate),
    retryable: !UNRETRYABLE_FINISH_REASONS.has(finishReason),
  };
}

function geminiRequestBody(image: InlineImage, prompt: string, thinking: boolean) {
  return {
    systemInstruction: {
      parts: [{ text: ANALYST_PROMPT }],
    },
    contents: [
      {
        parts: [
          { inlineData: { mimeType: image.mediaType, data: image.base64 } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: GEMINI_LOCATION_SCHEMA,
      ...(thinking
        ? { thinkingConfig: { thinkingLevel: "minimal", includeThoughts: false } }
        : {}),
    },
  };
}

function postGemini(model: string, body: unknown): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": process.env.GEMINI_API_KEY?.trim() ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function geminiRequestError(status: number, error: GeminiError | undefined): Error {
  if (status === 429 || error?.status === "RESOURCE_EXHAUSTED") {
    console.error("[gemini] quota or rate limit", { status, message: error?.message });
    return new QuotaExceededError(
      geminiQuotaIsPerMinute(error) ? RATE_LIMITED_MESSAGE : GEMINI_DAILY_QUOTA_MESSAGE,
    );
  }
  return new Error(
    error?.message ? `Gemini: ${error.message}` : `Gemini request failed (${status}).`,
  );
}

/** 429 details name the exhausted quota, e.g. GenerateRequestsPerDayPerProjectPerModel-FreeTier. */
function geminiQuotaIsPerMinute(error: GeminiError | undefined): boolean {
  const quotaIds = (error?.details ?? [])
    .flatMap((detail) => detail.violations ?? [])
    .map((violation) => violation.quotaId ?? "");
  return quotaIds.length > 0 && quotaIds.every((id) => /PerMinute/i.test(id));
}

function geminiFailureExtras(
  data: GeminiGenerateResponse,
  candidate: NonNullable<GeminiGenerateResponse["candidates"]>[number] | undefined,
): string {
  const blocked = candidate?.safetyRatings
    ?.filter((rating) => rating.blocked)
    .map((rating) => rating.category)
    .filter(Boolean);
  return [
    candidate?.finishReason ? `finishReason=${candidate.finishReason}` : "",
    candidate?.finishMessage ? `finishMessage=${candidate.finishMessage}` : "",
    data.promptFeedback?.blockReason
      ? `blockReason=${data.promptFeedback.blockReason}`
      : "",
    blocked?.length ? `safetyBlocked=${blocked.join("|")}` : "",
    typeof data.usageMetadata?.thoughtsTokenCount === "number"
      ? `thoughtsTokenCount=${data.usageMetadata.thoughtsTokenCount}`
      : "",
    typeof data.usageMetadata?.candidatesTokenCount === "number"
      ? `outputTokenCount=${data.usageMetadata.candidatesTokenCount}`
      : "",
    !candidate ? "no candidates" : "",
  ]
    .filter(Boolean)
    .join(", ");
}
