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
});
