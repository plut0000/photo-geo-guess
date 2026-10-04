import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  collectGeminiText,
  GEMINI_LOCATION_SCHEMA,
  getVisionProvider,
  guessFromImage,
  OPENAI_LOCATION_SCHEMA,
  QuotaExceededError,
} from "./vision.js";

const KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "OPENAI_MODEL",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of KEYS) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function clearKeys(): void {
  for (const key of KEYS) delete process.env[key];
}

const saved = snapshotEnv();
const realFetch = globalThis.fetch;
beforeEach(() => {
  mock.method(console, "warn", () => {});
  mock.method(console, "error", () => {});
});
afterEach(() => {
  restoreEnv(saved);
  globalThis.fetch = realFetch;
  mock.restoreAll();
});

type MockReply = { status?: number; body: unknown };
type SentRequest = { url: string; body: Record<string, any> };

/** Replies are served in order; the last one repeats. */
function mockFetch(...replies: MockReply[]): SentRequest[] {
  const sent: SentRequest[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)];
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return sent;
}

function geminiReply(text: string, finishReason = "STOP"): MockReply {
  return { body: { candidates: [{ finishReason, content: { parts: [{ text }] } }] } };
}

function openAIReply(text: string, extra: Record<string, unknown> = {}): MockReply {
  return {
    body: {
      status: "completed",
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
      ],
      usage: { output_tokens: 600, output_tokens_details: { reasoning_tokens: 520 } },
      ...extra,
    },
  };
}

const LOCATION_JSON = JSON.stringify({
  latitude: 49.3798,
  longitude: -123.0991,
  confidence: 0.7,
  placeName: "Grouse Mountain, North Vancouver",
  city: "North Vancouver",
  region: "British Columbia",
  country: "Canada",
  rationale: "Ski lift towers above a forested coastal city.",
});

/** Raw Gemini text behind the live MAX_TOKENS error (whitespace-collapsed in the error preview). */
const TRUNCATED_GEMINI_TEXT =
  '{\n  "latitude": 49.3798,\n  "longitude": -123.0991,\n  "placeName": "Grouse Mountain, North Vancouver",\n  "rationale": "The photo shows an outdoor activity area on a mountain summit featurin';

const FIELD_ORDER = [
  "latitude",
  "longitude",
  "confidence",
  "placeName",
  "city",
  "region",
  "country",
  "rationale",
];

const IMAGE = "data:image/jpeg;base64,abc123";

describe("getVisionProvider", () => {
  it("returns null when no keys are set", () => {
    clearKeys();
    assert.equal(getVisionProvider(), null);
  });

  it("selects Gemini when only GEMINI_API_KEY is set", () => {
    clearKeys();
    process.env.GEMINI_API_KEY = "test-gemini";
    assert.equal(getVisionProvider(), "gemini");
  });

  it("prefers OpenAI, then Anthropic, then Gemini", () => {
    clearKeys();
    process.env.OPENAI_API_KEY = "o";
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.GEMINI_API_KEY = "g";
    assert.equal(getVisionProvider(), "openai");
    delete process.env.OPENAI_API_KEY;
    assert.equal(getVisionProvider(), "anthropic");
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(getVisionProvider(), "gemini");
  });
});

describe("guessFromImage Gemini", () => {
  it("calls generateContent and returns a normalized guess", async () => {
    clearKeys();
    process.env.GEMINI_API_KEY = "test-gemini";

    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let requestedBody: {
      contents?: {
        parts?: {
          inlineData?: { mimeType?: string; data?: string };
          inline_data?: { mime_type?: string; data?: string };
        }[];
      }[];
      generationConfig?: {
        temperature?: number;
        maxOutputTokens?: number;
        responseMimeType?: string;
        thinkingConfig?: { thinkingLevel?: string; includeThoughts?: boolean };
      };
    } = {};

    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body ?? "{}")) as typeof requestedBody;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      latitude: 35.68,
                      longitude: 139.69,
                      placeName: "Tokyo, Japan",
                      city: "Tokyo",
                      country: "Japan",
                      rationale: "Streetscape and signage look like Tokyo.",
                      confidence: 0.72,
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const guess = await guessFromImage("data:image/jpeg;base64,abc123");
      assert.match(requestedUrl, /gemini-3\.6-flash:generateContent/);
      const imagePart = requestedBody.contents?.[0]?.parts?.[0];
      assert.equal(imagePart?.inlineData?.mimeType, "image/jpeg");
      assert.equal(imagePart?.inlineData?.data, "abc123");
      assert.equal(imagePart?.inline_data, undefined);
      assert.equal(requestedBody.generationConfig?.temperature, undefined);
      assert.equal(requestedBody.generationConfig?.maxOutputTokens, 8192);
      assert.equal(requestedBody.generationConfig?.responseMimeType, "application/json");
      assert.equal(requestedBody.generationConfig?.thinkingConfig?.thinkingLevel, "minimal");
      assert.equal(requestedBody.generationConfig?.thinkingConfig?.includeThoughts, false);
      assert.equal(guess.placeName, "Tokyo, Japan");
      assert.equal(guess.latitude, 35.68);
      assert.equal(guess.confidence, 0.72);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("honors GEMINI_MODEL override", async () => {
    clearKeys();
    process.env.GEMINI_API_KEY = "test-gemini";
    process.env.GEMINI_MODEL = "gemini-3.1-flash-lite";
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = (async (input: string | URL) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      latitude: 1,
                      longitude: 2,
                      placeName: "X",
                      rationale: "cues",
                      confidence: 0.4,
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      await guessFromImage("data:image/jpeg;base64,abc");
      assert.match(requestedUrl, /gemini-3\.1-flash-lite:generateContent/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces a Gemini API error message", async () => {
    clearKeys();
    process.env.GEMINI_API_KEY = "test-gemini";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "API key not valid" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    try {
      await assert.rejects(
        () => guessFromImage("data:image/png;base64,xx"),
        /Gemini: API key not valid/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("skips thought parts and parses the JSON answer part", async () => {
    clearKeys();
    process.env.GEMINI_API_KEY = "test-gemini";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  { thought: true, text: "Considering parking lot lighting and pavement…" },
                  {
                    text: JSON.stringify({
                      latitude: 40.71,
                      longitude: -74.01,
                      placeName: "New York, USA",
                      rationale: "Night parking lot with typical US strip lighting.",
                      confidence: 0.55,
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    try {
      const guess = await guessFromImage("data:image/jpeg;base64,abc");
      assert.equal(guess.placeName, "New York, USA");
      assert.equal(guess.latitude, 40.71);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parses JSON wrapped in markdown fences from Gemini", async () => {
    clearKeys();
    process.env.GEMINI_API_KEY = "test-gemini";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "```json\n{\"latitude\":48.86,\"longitude\":2.35,\"placeName\":\"Paris, France\",\"rationale\":\"Haussmann cues\",\"confidence\":0.6}\n```",
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    try {
      const guess = await guessFromImage("data:image/jpeg;base64,abc");
      assert.equal(guess.placeName, "Paris, France");
      assert.equal(guess.longitude, 2.35);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("recovers JSON that only appears on a thought part", async () => {
    clearKeys();
    process.env.GEMINI_API_KEY = "test-gemini";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    thought: true,
                    text: JSON.stringify({
                      latitude: 51.5,
                      longitude: -0.12,
                      placeName: "London, UK",
                      rationale: "Red buses and left-hand traffic.",
                      confidence: 0.5,
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    try {
      const guess = await guessFromImage("data:image/jpeg;base64,abc");
      assert.equal(guess.placeName, "London, UK");
      assert.equal(guess.latitude, 51.5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("includes finishReason and a preview when Gemini returns no JSON", async () => {
    clearKeys();
    process.env.GEMINI_API_KEY = "test-gemini";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "MAX_TOKENS",
              content: {
                parts: [{ thought: true, text: "I am still reasoning about the scene and have not finished." }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    try {
      await assert.rejects(
        () => guessFromImage("data:image/jpeg;base64,abc"),
        /finishReason=MAX_TOKENS[\s\S]*preview:/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("collectGeminiText", () => {
  it("concatenates answer parts and skips thoughts by default", () => {
    const parts = [
      { thought: true, text: "internal" },
      { text: '{"latitude":1}' },
      { thought: true, text: "more internal" },
    ];
    assert.equal(collectGeminiText(parts), '{"latitude":1}');
    assert.equal(collectGeminiText(parts, true), 'internal\n{"latitude":1}\nmore internal');
  });
});

describe("location schemas", () => {
  it("put coordinates and confidence before the rationale for both providers", () => {
    assert.deepEqual(GEMINI_LOCATION_SCHEMA.propertyOrdering, FIELD_ORDER);
    assert.deepEqual(Object.keys(GEMINI_LOCATION_SCHEMA.properties), FIELD_ORDER);
    assert.deepEqual(GEMINI_LOCATION_SCHEMA.required, FIELD_ORDER);
    assert.deepEqual(Object.keys(OPENAI_LOCATION_SCHEMA.properties), FIELD_ORDER);
    assert.deepEqual(OPENAI_LOCATION_SCHEMA.required, FIELD_ORDER);
    assert.equal(OPENAI_LOCATION_SCHEMA.additionalProperties, false);
  });
});

describe("guessFromImage Gemini reliability", () => {
  beforeEach(() => {
    clearKeys();
    process.env.GEMINI_API_KEY = "test-gemini";
  });

  it("asks for a coordinate-first, length-capped answer without restating field order", async () => {
    const sent = mockFetch(geminiReply(LOCATION_JSON));
    await guessFromImage(IMAGE);

    const { generationConfig, systemInstruction, contents } = sent[0].body;
    assert.deepEqual(generationConfig.responseSchema.propertyOrdering, FIELD_ORDER);
    assert.equal(generationConfig.responseSchema.properties.rationale.maxLength, 300);
    assert.deepEqual(generationConfig.thinkingConfig, {
      thinkingLevel: "minimal",
      includeThoughts: false,
    });
    assert.match(systemInstruction.parts[0].text, /at most 2 short sentences/);
    assert.doesNotMatch(systemInstruction.parts[0].text, /"latitude": number/);
    assert.equal(contents[0].parts[1].text, "Estimate where this photograph was taken.");
  });

  it("adds photo metadata to the prompt as labeled hints", async () => {
    const sent = mockFetch(geminiReply(LOCATION_JSON));
    await guessFromImage(IMAGE, {
      takenAt: "2024-07-14 18:32",
      utcOffset: "-07:00",
      cameraMake: "Apple",
      cameraModel: "iPhone 14",
    });

    const prompt: string = sent[0].body.contents[0].parts[1].text;
    assert.match(
      prompt,
      /^Estimate where this photograph was taken\.\n\nPhoto metadata: taken 2024-07-14 18:32 UTC-07:00; camera Apple iPhone 14\.\n/,
    );
    assert.match(prompt, /only as clues/);
  });

  it("salvages the truncated MAX_TOKENS reply from the live error without retrying", async () => {
    const sent = mockFetch(geminiReply(TRUNCATED_GEMINI_TEXT, "MAX_TOKENS"));
    const guess = await guessFromImage(IMAGE);

    assert.equal(sent.length, 1);
    assert.equal(guess.latitude, 49.3798);
    assert.equal(guess.longitude, -123.0991);
    assert.equal(guess.placeName, "Grouse Mountain, North Vancouver");
    assert.equal(guess.confidence, 0.4);
    assert.equal(
      guess.rationale,
      "The photo shows an outdoor activity area on a mountain summit featurin…",
    );
  });

  it("retries once when a reply has no usable coordinates", async () => {
    const sent = mockFetch(
      geminiReply('{\n  "placeName": "Grouse Mount', "MAX_TOKENS"),
      geminiReply(LOCATION_JSON),
    );
    const guess = await guessFromImage(IMAGE);

    assert.equal(sent.length, 2);
    assert.equal(guess.placeName, "Grouse Mountain, North Vancouver");
    assert.equal(guess.confidence, 0.7);
  });

  it("errors with diagnostics after the retry also fails", async () => {
    const sent = mockFetch(geminiReply("", "MAX_TOKENS"));
    await assert.rejects(
      () => guessFromImage(IMAGE),
      /Gemini diagnostics: finishReason=MAX_TOKENS, attempts=2\. The model response was empty\./,
    );
    assert.equal(sent.length, 2);
  });

  it("does not retry a safety block", async () => {
    const sent = mockFetch({ body: { candidates: [{ finishReason: "SAFETY" }] } });
    await assert.rejects(() => guessFromImage(IMAGE), /finishReason=SAFETY, attempts=1/);
    assert.equal(sent.length, 1);
  });

  it("skips the retry when the first attempt already took most of the time budget", async () => {
    mock.timers.enable({ apis: ["Date"], now: 0 });
    try {
      const sent = mockFetch(geminiReply("I cannot tell.", "STOP"));
      const slowFetch = globalThis.fetch;
      globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
        mock.timers.tick(25_000);
        return slowFetch(...args);
      }) as typeof fetch;

      await assert.rejects(() => guessFromImage(IMAGE), /attempts=1/);
      assert.equal(sent.length, 1);
    } finally {
      mock.timers.reset();
    }
  });

  it("explains a used-up free daily quota in plain words", async () => {
    const sent = mockFetch({
      status: 429,
      body: {
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message:
            "You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash\nPlease retry in 7.05s.",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [
                {
                  quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                  quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                  quotaValue: "20",
                },
              ],
            },
            { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "7s" },
          ],
        },
      },
    });

    await assert.rejects(
      () => guessFromImage(IMAGE),
      (error: unknown) =>
        error instanceof QuotaExceededError &&
        error.message ===
          "The free AI quota is used up for today. Try again tomorrow, or use a photo that has GPS data.",
    );
    assert.equal(sent.length, 1);
  });

  it("asks to wait a minute when only a per-minute limit was hit", async () => {
    mockFetch({
      status: 429,
      body: {
        error: {
          status: "RESOURCE_EXHAUSTED",
          message: "Quota exceeded.",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }],
            },
          ],
        },
      },
    });
    await assert.rejects(() => guessFromImage(IMAGE), /Wait a minute and try again/);
  });

  it("falls back to the model's default thinking when it rejects thinkingLevel", async () => {
    process.env.GEMINI_MODEL = "gemini-3.8-flash";
    const sent = mockFetch(
      {
        status: 400,
        body: { error: { message: "Thinking level MINIMAL is not supported for this model." } },
      },
      geminiReply(LOCATION_JSON),
    );
    const guess = await guessFromImage(IMAGE);

    assert.equal(sent.length, 2);
    assert.equal(sent[0].body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
    assert.equal(sent[1].body.generationConfig.thinkingConfig, undefined);
    assert.equal(guess.latitude, 49.3798);
  });
});

describe("guessFromImage OpenAI", () => {
  beforeEach(() => {
    clearKeys();
    process.env.OPENAI_API_KEY = "test-openai";
  });

  it("uses the Responses API with low reasoning effort and a strict JSON schema", async () => {
    const sent = mockFetch(openAIReply(LOCATION_JSON));
    const guess = await guessFromImage(IMAGE, { cameraMake: "Apple", cameraModel: "iPhone 14" });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "https://api.openai.com/v1/responses");
    const body = sent[0].body;
    assert.equal(body.model, "gpt-5.6-luna");
    assert.deepEqual(body.reasoning, { effort: "low" });
    assert.equal(body.temperature, undefined);
    assert.equal(body.max_output_tokens, 4000);
    assert.equal(body.store, false);
    assert.match(body.instructions, /at most 2 short sentences/);
    assert.deepEqual(body.input[0].content[0], { type: "input_image", image_url: IMAGE });
    assert.equal(body.input[0].content[1].type, "input_text");
    assert.match(body.input[0].content[1].text, /Photo metadata: camera Apple iPhone 14\./);
    assert.deepEqual(body.text.format, {
      type: "json_schema",
      name: "location_estimate",
      schema: OPENAI_LOCATION_SCHEMA,
      strict: true,
    });

    assert.equal(guess.placeName, "Grouse Mountain, North Vancouver");
    assert.equal(guess.confidence, 0.7);
    assert.equal(guess.rationale, "Ski lift towers above a forested coastal city.");
  });

  it("honors OPENAI_MODEL", async () => {
    process.env.OPENAI_MODEL = "gpt-6.1-sol";
    const sent = mockFetch(openAIReply(LOCATION_JSON));
    await guessFromImage(IMAGE);
    assert.equal(sent[0].body.model, "gpt-6.1-sol");
  });

  it("stays the first choice when several provider keys are set", async () => {
    process.env.GEMINI_API_KEY = "test-gemini";
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    const sent = mockFetch(openAIReply(LOCATION_JSON));
    await guessFromImage(IMAGE);
    assert.equal(sent[0].url, "https://api.openai.com/v1/responses");
  });

  it("salvages a reply cut off by max_output_tokens", async () => {
    const sent = mockFetch(
      openAIReply(
        '{"latitude":49.3798,"longitude":-123.0991,"confidence":0.66,"placeName":"Grouse Mountain, North Vancouver","city":"North Vancouver","region":"British Columbia","country":"Canada","rationale":"Ski lift towers and',
        { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
      ),
    );
    const guess = await guessFromImage(IMAGE);

    assert.equal(sent.length, 1);
    assert.equal(guess.latitude, 49.3798);
    assert.equal(guess.confidence, 0.66);
    assert.equal(guess.city, "North Vancouver");
    assert.equal(guess.rationale, "Ski lift towers and…");
  });

  it("retries when reasoning used the whole output budget", async () => {
    const sent = mockFetch(
      {
        body: {
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [{ type: "reasoning", summary: [] }],
          usage: { output_tokens: 4000, output_tokens_details: { reasoning_tokens: 4000 } },
        },
      },
      openAIReply(LOCATION_JSON),
    );
    const guess = await guessFromImage(IMAGE);

    assert.equal(sent.length, 2);
    assert.equal(guess.latitude, 49.3798);
  });

  it("does not retry a refusal", async () => {
    const sent = mockFetch({
      body: {
        status: "completed",
        output: [
          { type: "message", content: [{ type: "refusal", refusal: "I can't help with that." }] },
        ],
      },
    });
    await assert.rejects(
      () => guessFromImage(IMAGE),
      /OpenAI diagnostics: status=completed, refusal=I can't help with that\., attempts=1/,
    );
    assert.equal(sent.length, 1);
  });

  it("explains insufficient_quota in plain words", async () => {
    const sent = mockFetch({
      status: 429,
      body: {
        error: {
          message: "You exceeded your current quota, please check your plan and billing details.",
          type: "insufficient_quota",
          param: null,
          code: "insufficient_quota",
        },
      },
    });
    await assert.rejects(
      () => guessFromImage(IMAGE),
      (error: unknown) =>
        error instanceof QuotaExceededError &&
        /quota for this site is used up/.test(error.message) &&
        /photo that has GPS data/.test(error.message),
    );
    assert.equal(sent.length, 1);
  });

  it("treats credit and spend-limit codes as quota errors", async () => {
    mockFetch({
      status: 429,
      body: { error: { message: "No credits.", type: "insufficient_quota", code: "credit_balance_exhausted" } },
    });
    await assert.rejects(() => guessFromImage(IMAGE), /quota for this site is used up/);
  });

  it("explains rate limits in plain words", async () => {
    mockFetch({
      status: 429,
      body: {
        error: {
          message: "Rate limit reached for gpt-5.6-luna on requests per min (RPM): Limit 3.",
          type: "requests",
          code: "rate_limit_exceeded",
        },
      },
    });
    await assert.rejects(
      () => guessFromImage(IMAGE),
      (error: unknown) => error instanceof QuotaExceededError && /Wait a minute/.test(error.message),
    );
  });

  it("drops the reasoning setting for a model that does not support it", async () => {
    process.env.OPENAI_MODEL = "gpt-4o";
    const sent = mockFetch(
      {
        status: 400,
        body: {
          error: {
            message: "Unsupported parameter: 'reasoning.effort' is not supported with this model.",
            type: "invalid_request_error",
            param: "reasoning.effort",
            code: "unsupported_parameter",
          },
        },
      },
      openAIReply(LOCATION_JSON),
    );
    await guessFromImage(IMAGE);

    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].body.reasoning, { effort: "low" });
    assert.equal(sent[1].body.reasoning, undefined);
  });

  it("surfaces other API errors", async () => {
    mockFetch({
      status: 401,
      body: { error: { message: "Incorrect API key provided.", type: "invalid_request_error" } },
    });
    await assert.rejects(() => guessFromImage(IMAGE), /OpenAI: Incorrect API key provided\./);
  });
});
