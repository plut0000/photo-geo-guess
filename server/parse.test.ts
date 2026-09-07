import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractJson, normalizeVisionGuess } from "./parse.js";

describe("extractJson", () => {
  it("reads a fenced JSON object", () => {
    const parsed = extractJson('Sure.\n```json\n{"latitude": 48.8, "longitude": 2.3}\n```');
    assert.deepEqual(parsed, { latitude: 48.8, longitude: 2.3 });
  });

  it("reads a raw JSON object with extra text", () => {
    const parsed = extractJson('Here you go: {"latitude": 1, "longitude": 2, "placeName": "X"} thanks');
    assert.equal((parsed as { placeName: string }).placeName, "X");
  });
});

describe("normalizeVisionGuess", () => {
  it("requires coordinates", () => {
    assert.throws(() => normalizeVisionGuess({ placeName: "Paris" }));
  });

  it("fills a place name from city/country when needed", () => {
    const guess = normalizeVisionGuess({
      latitude: 35.68,
      longitude: 139.69,
      city: "Tokyo",
      country: "Japan",
      confidence: 0.7,
    });
    assert.equal(guess.placeName, "Tokyo, Japan");
    assert.equal(guess.confidence, 0.7);
  });
});
