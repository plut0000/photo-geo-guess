import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampConfidence, confidenceToRadiusKm } from "./radius.ts";

describe("confidenceToRadiusKm", () => {
  it("maps vision confidence into the 10–30 km band", () => {
    assert.equal(confidenceToRadiusKm(1, "vision"), 10);
    assert.equal(confidenceToRadiusKm(0, "vision"), 30);
    const mid = confidenceToRadiusKm(0.5, "vision");
    assert.ok(mid > 10 && mid < 30);
  });

  it("uses a tighter EXIF radius when coordinates are exact", () => {
    const tight = confidenceToRadiusKm(1, "exif");
    assert.ok(tight <= 2);
    assert.ok(confidenceToRadiusKm(0.2, "exif") <= 10);
  });

  it("clamps invalid confidence", () => {
    assert.equal(clampConfidence(2), 1);
    assert.equal(clampConfidence(-1), 0);
    assert.equal(clampConfidence(Number.NaN), 0.4);
  });
});
