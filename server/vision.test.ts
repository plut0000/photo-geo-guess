import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getVisionProvider, guessFromImage } from "./vision.js";

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
      contents?: { parts?: { inline_data?: { mime_type?: string; data?: string } }[] }[];
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
      assert.match(requestedUrl, /gemini-2\.5-flash:generateContent/);
      assert.equal(requestedBody.contents?.[0]?.parts?.[0]?.inline_data?.mime_type, "image/jpeg");
      assert.equal(requestedBody.contents?.[0]?.parts?.[0]?.inline_data?.data, "abc123");
      assert.equal(guess.placeName, "Tokyo, Japan");
      assert.equal(guess.latitude, 35.68);
      assert.equal(guess.confidence, 0.72);
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
});
