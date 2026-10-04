import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { photoMetadataFromTags } from "./exif.js";

/** exifr output for a JPEG written by exiftool with EXIF, IPTC (UTF-8) and XMP, using METADATA_OPTIONS. */
const RICH_TAGS = {
  iptc: {
    DateCreated: "20240714",
    TimeCreated: "183205-0700",
    City: "ZÃ¼rich",
    Sublocation: "Grouse Mountain",
    State: "BC",
    CountryCode: "CAN",
    Country: "Canada",
    Headline: "Grouse",
    Caption: "Summit view from the chalet",
  },
  Iptc4xmpCore: { CountryCode: "CA", Location: "Grouse Mountain" },
  aux: { Lens: "iPhone lens" },
  dc: {
    description: { lang: "x-default", value: "Summit view, with a &quot;quoted&quot; word" },
    title: { lang: "x-default", value: "Peak" },
  },
  photoshop: {
    City: "North Vancouver",
    Country: "Canada",
    DateCreated: "2024-07-14T18:32:05-07:00",
    State: "British Columbia",
  },
  xmp: { CreatorTool: "Adobe Lightroom 7.4" },
  ifd0: { ImageDescription: "Summit view", Make: "Apple", Model: "iPhone 14", Software: "17.5.1" },
  exif: {
    DateTimeOriginal: "2024:07:14 18:32:05",
    CreateDate: "2024:07:14 18:32:05",
    OffsetTimeOriginal: "-07:00",
    LensModel: "iPhone 14 back dual wide camera 5.7mm f/1.5",
  },
  gps: { GPSAltitudeRef: new Uint8Array([0]), GPSAltitude: 1128.4 },
};

describe("photoMetadataFromTags", () => {
  it("maps EXIF, IPTC and XMP tags to metadata hints", () => {
    assert.deepEqual(photoMetadataFromTags(RICH_TAGS), {
      takenAt: "2024-07-14T18:32:05",
      utcOffset: "-07:00",
      cameraMake: "Apple",
      cameraModel: "iPhone 14",
      lens: "iPhone 14 back dual wide camera 5.7mm f/1.5",
      altitudeM: 1128,
      caption: "Summit view",
      software: "17.5.1",
      sublocation: "Grouse Mountain",
      city: "North Vancouver",
      region: "British Columbia",
      country: "Canada",
    });
  });

  it("never passes GPS coordinates through", () => {
    const meta = photoMetadataFromTags({
      ifd0: { Make: "Canon", Model: "EOS R5" },
      // XMP exif:GPSLatitude lands in the exif block; the GPS block is limited to altitude by `pick`,
      // but the mapping must ignore coordinates even if they show up.
      exif: { GPSLatitude: "49,22.788N", GPSLongitude: "123,5.946W" },
      gps: {
        latitude: 49.3798,
        longitude: -123.0991,
        GPSLatitude: [49, 22, 47.28],
        GPSAltitude: 12.2,
        GPSAltitudeRef: new Uint8Array([1]),
      },
    });
    assert.deepEqual(meta, { cameraMake: "Canon", cameraModel: "EOS R5", altitudeM: -12 });
  });

  it("repairs IPTC UTF-8, decodes XMP entities, and skips placeholder captions", () => {
    const meta = photoMetadataFromTags({
      ifd0: { ImageDescription: "OLYMPUS DIGITAL CAMERA" },
      iptc: { City: "ZÃ¼rich", Caption: "CafÃ© terrace", Country: "Schweiz" },
      dc: {
        description: [
          { lang: "de", value: "See &amp; Berge" },
          { lang: "x-default", value: "Lake &amp; mountains &#x26C5;" },
        ],
      },
    });
    assert.deepEqual(meta, {
      caption: "Lake & mountains ⛅",
      city: "Zürich",
      country: "Schweiz",
    });
  });

  it("falls back to XMP and IPTC capture times", () => {
    assert.deepEqual(
      photoMetadataFromTags({
        exif: { DateTimeOriginal: "0000:00:00 00:00:00" },
        photoshop: { DateCreated: "2024-07-14T18:32:05Z" },
      }),
      { takenAt: "2024-07-14T18:32:05", utcOffset: "+00:00" },
    );
    assert.deepEqual(
      photoMetadataFromTags({ iptc: { DateCreated: "20240714", TimeCreated: "183205-0700" } }),
      { takenAt: "2024-07-14T18:32:05", utcOffset: "-07:00" },
    );
    assert.deepEqual(photoMetadataFromTags({ photoshop: { DateCreated: "2024-07-14" } }), {
      takenAt: "2024-07-14",
    });
  });

  it("returns undefined when the file has no usable metadata", () => {
    assert.equal(photoMetadataFromTags(undefined), undefined);
    assert.equal(photoMetadataFromTags({ ifd0: { ImageDescription: "   " } }), undefined);
  });
});
