import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { collectGeminiText, getVisionProvider, guessFromImage } from "./vision.js";

const KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GEMINI_MODEL"] as const;

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
afterEach(() => restoreEnv(saved));

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
