import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describePhotoMetadata, sanitizePhotoMetadata } from "./metadata.js";

describe("sanitizePhotoMetadata", () => {
  it("keeps known fields and normalizes them", () => {
    assert.deepEqual(
      sanitizePhotoMetadata({
        takenAt: "2024-07-14T18:32:05",
        utcOffset: "-0700",
        cameraMake: " Apple ",
        cameraModel: "iPhone 14",
        lens: "iPhone 14 back dual wide camera 5.7mm f/1.5",
        altitudeM: 1128.4,
        caption: 'Summit "view"\nfrom the chalet',
        software: "17.5.1",
        sublocation: "Grouse Mountain",
        city: "North Vancouver",
        region: "British Columbia",
        country: "Canada",
      }),
      {
        takenAt: "2024-07-14 18:32",
        utcOffset: "-07:00",
        cameraMake: "Apple",
        cameraModel: "iPhone 14",
        lens: "iPhone 14 back dual wide camera 5.7mm f/1.5",
        altitudeM: 1128,
        caption: "Summit 'view' from the chalet",
        software: "17.5.1",
        sublocation: "Grouse Mountain",
        city: "North Vancouver",
        region: "British Columbia",
        country: "Canada",
      },
    );
  });

  it("never keeps GPS coordinates or unknown fields", () => {
    assert.deepEqual(
      sanitizePhotoMetadata({
        latitude: 49.3798,
        longitude: -123.0991,
        GPSLatitude: "49,22.788N",
        gps: { latitude: 49.3798 },
        cameraModel: "EOS R5",
      }),
      { cameraModel: "EOS R5" },
    );
  });

  it("drops malformed values", () => {
    assert.equal(
      sanitizePhotoMetadata({
        takenAt: "0000:00:00 00:00:00",
        utcOffset: "PST",
        altitudeM: "1200",
        caption: "   ",
        city: 42,
      }),
      undefined,
    );
    assert.equal(sanitizePhotoMetadata({ takenAt: "2024-13-40" }), undefined);
    assert.equal(sanitizePhotoMetadata({ altitudeM: 99999 }), undefined);
  });

  it("returns undefined for missing or non-object input", () => {
    for (const input of [undefined, null, "metadata", 42, ["Apple"]]) {
      assert.equal(sanitizePhotoMetadata(input), undefined);
    }
  });

  it("caps long text so the prompt stays small", () => {
    const caption = sanitizePhotoMetadata({ caption: "a".repeat(5000) })?.caption ?? "";
    assert.equal(caption.length, 200);
    assert.ok(caption.endsWith("…"));
  });
});

describe("describePhotoMetadata", () => {
  it("labels capture time and camera like the prompt example", () => {
    const text = describePhotoMetadata({
      takenAt: "2024-07-14 18:32",
      utcOffset: "-07:00",
      cameraMake: "Apple",
      cameraModel: "iPhone 14",
    });
    assert.match(text, /^Photo metadata: taken 2024-07-14 18:32 UTC-07:00; camera Apple iPhone 14\.\n/);
    assert.match(text, /only as clues/);
    assert.match(text, /base the estimate on what the image shows/);
  });

  it("lists every available hint", () => {
    const text = describePhotoMetadata({
      takenAt: "2024-07-14",
      utcOffset: "+00:00",
      cameraMake: "Canon",
      cameraModel: "Canon EOS R5",
      lens: "RF24-105mm F4 L IS USM",
      altitudeM: -12,
      caption: "Harbour at dusk",
      software: "Adobe Lightroom 7.4",
      sublocation: "Old Port",
      city: "Marseille",
      region: "Provence-Alpes-Côte d'Azur",
      country: "France",
    });
    assert.equal(
      text.split("\n")[0],
      'Photo metadata: taken 2024-07-14 UTC; camera Canon EOS R5; lens RF24-105mm F4 L IS USM; altitude -12 m; caption "Harbour at dusk"; software Adobe Lightroom 7.4; location tags "Old Port, Marseille, Provence-Alpes-Côte d\'Azur, France".',
    );
  });

  it("says when no time zone was recorded", () => {
    assert.match(
      describePhotoMetadata({ takenAt: "2023-01-02 03:04" }),
      /^Photo metadata: taken 2023-01-02 03:04 \(no time zone recorded\)\./,
    );
  });

  it("returns an empty string without metadata", () => {
    assert.equal(describePhotoMetadata(undefined), "");
    assert.equal(describePhotoMetadata({}), "");
  });
});
