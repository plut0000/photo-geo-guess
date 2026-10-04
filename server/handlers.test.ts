import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleGuess, handleStatus } from "./handlers.js";

const KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"] as const;

function withClearedKeys(fn: () => void | Promise<void>) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  return Promise.resolve(fn()).finally(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

function withGeminiReply(status: number, body: unknown, fn: (sent: string[]) => Promise<void>) {
  return withClearedKeys(async () => {
    process.env.GEMINI_API_KEY = "test-gemini";
    const originalFetch = globalThis.fetch;
    const originalError = console.error;
    const sent: string[] = [];
    globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
      sent.push(String(init?.body ?? ""));
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    console.error = () => {};
    try {
      await fn(sent);
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalError;
    }
  });
}

describe("handleStatus", () => {
  it("reports vision as off without an API key", async () => {
    await withClearedKeys(() => {
      assert.deepEqual(handleStatus(), { visionEnabled: false, provider: null });
    });
  });
});

describe("handleGuess", () => {
  it("rejects invalid EXIF coordinates", async () => {
    const result = await handleGuess({ source: "exif", latitude: 200, longitude: 0 });
    assert.equal(result.status, 400);
  });

  it("explains that vision guessing needs a key", async () => {
    await withClearedKeys(async () => {
      const result = await handleGuess({
        source: "vision",
        image: "data:image/jpeg;base64,xx",
      });
      assert.equal(result.status, 503);
      assert.match(String(result.body.error), /GEMINI_API_KEY/);
      assert.match(String(result.body.error), /OPENAI_API_KEY/);
    });
  });

  it("returns 429 with a friendly message when the AI quota is used up", async () => {
    await withGeminiReply(
      429,
      { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded." } },
      async () => {
        const result = await handleGuess({ source: "vision", image: "data:image/jpeg;base64,xx" });
        assert.equal(result.status, 429);
        assert.equal(
          result.body.error,
          "The free AI quota is used up for today. Try again tomorrow, or use a photo that has GPS data.",
        );
      },
    );
  });

  it("passes sanitized photo metadata to the vision prompt", async () => {
    const reply = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: '{"latitude": 49.38, "longitude": -123.08, "confidence": 0.6, "placeName": "North Vancouver", "rationale": "Coastal mountains."}',
              },
            ],
          },
        },
      ],
    };
    await withGeminiReply(200, reply, async (sent) => {
      const result = await handleGuess({
        source: "vision",
        image: "data:image/jpeg;base64,xx",
        metadata: {
          takenAt: "2024-07-14T18:32:05",
          utcOffset: "-07:00",
          cameraMake: "Apple",
          cameraModel: "iPhone 14",
          latitude: 12.3456,
          GPSLongitude: 65.4321,
        },
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.placeName, "North Vancouver");
      assert.match(sent[0], /Photo metadata: taken 2024-07-14 18:32 UTC-07:00; camera Apple iPhone 14\./);
      assert.doesNotMatch(sent[0], /12\.3456|65\.4321/);
    });
  });
});
