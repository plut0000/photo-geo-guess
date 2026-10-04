import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clipRationale,
  extractJson,
  normalizeVisionGuess,
  RATIONALE_MAX_CHARS,
  readVisionGuess,
  SALVAGED_CONFIDENCE,
  salvageVisionGuess,
} from "./parse.js";

/** Response preview quoted in the bug report (Gemini finishReason=MAX_TOKENS on the live site). */
const REPORTED_PREVIEW =
  '{ "latitude": 49.3798, "longitude": -123.0991, "placeName": "Grouse Mountain, North Vancouver", "rationale": "The photo shows an outdoor...';

/** The same error as shown in the screenshot: the 180-character preview plus its clip marker. */
const SCREENSHOT_PREVIEW =
  '{ "latitude": 49.3798, "longitude": -123.0991, "placeName": "Grouse Mountain, North Vancouver", "rationale": "The photo shows an outdoor activity area on a mountain summit featurin…';

describe("extractJson", () => {
  it("reads a fenced JSON object", () => {
    const parsed = extractJson('Sure.\n```json\n{"latitude": 48.8, "longitude": 2.3}\n```');
    assert.deepEqual(parsed, { latitude: 48.8, longitude: 2.3 });
  });

  it("reads a raw JSON object with extra text", () => {
    const parsed = extractJson('Here you go: {"latitude": 1, "longitude": 2, "placeName": "X"} thanks');
    assert.equal((parsed as { placeName: string }).placeName, "X");
  });

  it("surfaces a preview when the model returns prose without JSON", () => {
    assert.throws(
      () => extractJson("I cannot determine the location from this night photo."),
      /Response preview: I cannot determine the location/,
    );
  });

  it("explains truncated JSON", () => {
    assert.throws(
      () => extractJson('{"latitude": 40.7, "longitude":'),
      /truncated or invalid/,
    );
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

  it("clips a rationale that runs far past two sentences", () => {
    const guess = normalizeVisionGuess({
      latitude: 1,
      longitude: 2,
      rationale: "Cue one is visible. ".repeat(3) + "x".repeat(600),
    });
    assert.ok(guess.rationale.length <= RATIONALE_MAX_CHARS);
    assert.equal(guess.rationale, "Cue one is visible.");
  });
});

describe("salvageVisionGuess", () => {
  it("recovers the truncated reply quoted in the bug report", () => {
    assert.deepEqual(salvageVisionGuess(REPORTED_PREVIEW), {
      latitude: 49.3798,
      longitude: -123.0991,
      placeName: "Grouse Mountain, North Vancouver",
      city: undefined,
      region: undefined,
      country: undefined,
      rationale: "The photo shows an outdoor…",
      confidence: SALVAGED_CONFIDENCE,
    });
  });

  it("recovers the truncated reply shown in the screenshot", () => {
    const guess = salvageVisionGuess(SCREENSHOT_PREVIEW);
    assert.equal(guess?.latitude, 49.3798);
    assert.equal(guess?.longitude, -123.0991);
    assert.equal(guess?.placeName, "Grouse Mountain, North Vancouver");
    assert.equal(guess?.confidence, 0.4);
    assert.equal(
      guess?.rationale,
      "The photo shows an outdoor activity area on a mountain summit featurin…",
    );
  });

  it("reads the raw multi-line reply that those previews were collapsed from", () => {
    const raw =
      '{\n  "latitude": 49.3798,\n  "longitude": -123.0991,\n  "placeName": "Grouse Mountain, North Vancouver",\n  "rationale": "The photo shows an outdoor activity area on a mountain summit. Ski lift towers and dense conifers sugg';
    const guess = salvageVisionGuess(raw);
    assert.equal(guess?.latitude, 49.3798);
    assert.equal(guess?.rationale, "The photo shows an outdoor activity area on a mountain summit.");
  });

  it("keeps confidence and location fields written before the cut", () => {
    const guess = salvageVisionGuess(
      '{"latitude": 48.8584, "longitude": 2.2945, "confidence": 0.82, "placeName": "Eiffel Tower, Paris", "city": "Paris", "region": null, "country": "France", "rationale": "Wrought-iron lattice tower. Seine riverba',
    );
    assert.equal(guess?.confidence, 0.82);
    assert.equal(guess?.city, "Paris");
    assert.equal(guess?.region, undefined);
    assert.equal(guess?.country, "France");
    assert.equal(guess?.rationale, "Wrought-iron lattice tower.");
  });

  it("collapses a rationale that repeats until the token limit", () => {
    const guess = salvageVisionGuess(
      `{"latitude": 49.38, "longitude": -123.08, "confidence": 0.6, "placeName": "North Vancouver", "rationale": "${"Snowy peaks over a city. ".repeat(300)}`,
    );
    assert.equal(guess?.rationale, "Snowy peaks over a city.");
  });

  it("ignores a coordinate that was cut off mid-number", () => {
    assert.equal(salvageVisionGuess('{"latitude": 49.3798, "longitude": -12'), null);
  });

  it("returns null when no coordinates were written", () => {
    assert.equal(salvageVisionGuess('{"placeName": "Grouse Mountain", "rationale": "The photo'), null);
    assert.equal(salvageVisionGuess(""), null);
  });

  it("rejects out-of-range coordinates", () => {
    assert.equal(salvageVisionGuess('{"latitude": 149.3, "longitude": -123.1, "rationale": "x'), null);
  });
});

describe("readVisionGuess", () => {
  it("uses the complete JSON answer when there is one", () => {
    const guess = readVisionGuess(
      '{"latitude": 35.68, "longitude": 139.69, "confidence": 0.7, "placeName": "Tokyo", "rationale": "Dense signage in Japanese."}',
    );
    assert.equal(guess?.placeName, "Tokyo");
    assert.equal(guess?.confidence, 0.7);
    assert.equal(guess?.rationale, "Dense signage in Japanese.");
  });

  it("salvages a cut-off answer", () => {
    assert.equal(readVisionGuess(REPORTED_PREVIEW)?.latitude, 49.3798);
  });

  it("returns null for prose without coordinates", () => {
    assert.equal(readVisionGuess("I cannot tell where this is."), null);
  });
});

describe("clipRationale", () => {
  it("leaves a short complete rationale alone", () => {
    assert.equal(clipRationale("  Red buses and\nleft-hand traffic. "), "Red buses and left-hand traffic.");
  });

  it("cuts long text at a sentence boundary", () => {
    const first = `${"Alpine meadow with granite peaks ".repeat(4).trim()}.`;
    const clipped = clipRationale(`${first} ${"More detail follows here ".repeat(20)}`);
    assert.equal(clipped, first);
  });

  it("cuts long text without sentence breaks at a word boundary", () => {
    const clipped = clipRationale("word ".repeat(100));
    assert.ok(clipped.length <= RATIONALE_MAX_CHARS);
    assert.match(clipped, /word…$/);
  });
});
