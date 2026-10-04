import exifr from "exifr";
import type { PhotoMetadata } from "../types";

export type GpsFix = {
  latitude: number;
  longitude: number;
};

export async function readGps(file: File): Promise<GpsFix | null> {
  try {
    const gps = await exifr.gps(file);
    if (
      !gps ||
      !Number.isFinite(gps.latitude) ||
      !Number.isFinite(gps.longitude)
    ) {
      return null;
    }
    if (Math.abs(gps.latitude) > 90 || Math.abs(gps.longitude) > 180) {
      return null;
    }
    if (gps.latitude === 0 && gps.longitude === 0) {
      return null;
    }
    return { latitude: gps.latitude, longitude: gps.longitude };
  } catch {
    return null;
  }
}

/**
 * Per-block picks keep parsing cheap, and the GPS block only yields altitude,
 * so latitude/longitude are never read here. `mergeOutput: false` keeps EXIF,
 * IPTC and each XMP namespace apart because they reuse names like CreateDate.
 * `reviveValues: false` keeps capture times as written instead of as Dates in
 * the browser's time zone.
 */
const METADATA_OPTIONS = {
  mergeOutput: false,
  reviveValues: false,
  ifd0: { pick: ["Make", "Model", "Software", "ImageDescription"] },
  exif: {
    pick: [
      "DateTimeOriginal",
      "OffsetTimeOriginal",
      "CreateDate",
      "OffsetTimeDigitized",
      "LensModel",
    ],
  },
  gps: { pick: ["GPSAltitude", "GPSAltitudeRef"] },
  ifd1: false,
  interop: false,
  iptc: true,
  xmp: true,
  icc: false,
  jfif: false,
  ihdr: false,
};

/** Non-GPS metadata used as hints for visual guessing; undefined when the file has none. */
export async function readPhotoMetadata(file: File): Promise<PhotoMetadata | undefined> {
  try {
    return photoMetadataFromTags(await exifr.parse(file, METADATA_OPTIONS));
  } catch {
    return undefined;
  }
}

type TagBlock = Record<string, unknown>;

const MAX_TEXT = 200;

/** Descriptions some cameras write by default instead of a real caption. */
const PLACEHOLDER_CAPTION =
  /^(?:[a-z]+ )?digital (?:still )?camera$|^(?:sony dsc|dcim|default|untitled|image)$/i;

/** Maps `exifr.parse(file, METADATA_OPTIONS)` output to the fields sent to the server. */
export function photoMetadataFromTags(tags: unknown): PhotoMetadata | undefined {
  if (!tags || typeof tags !== "object") return undefined;
  const block = (name: string): TagBlock => {
    const value = (tags as Record<string, unknown>)[name];
    return value && typeof value === "object" ? (value as TagBlock) : {};
  };
  const ifd0 = block("ifd0");
  const exif = block("exif");
  const gps = block("gps");
  const iptc = block("iptc");
  const dc = block("dc");
  const photoshop = block("photoshop");
  const xmp = block("xmp");
  const iptcCore = block("Iptc4xmpCore");

  const meta: PhotoMetadata = {
    ...captureTime(exif, photoshop, xmp, iptc),
    cameraMake: text(ifd0.Make),
    cameraModel: text(ifd0.Model),
    lens: text(exif.LensModel) ?? xmpText(block("aux").Lens) ?? xmpText(block("exifEX").LensModel),
    altitudeM: altitude(gps.GPSAltitude, gps.GPSAltitudeRef),
    caption: [
      text(ifd0.ImageDescription),
      xmpText(dc.description),
      iptcText(iptc.Caption),
      iptcText(iptc.Headline),
      xmpText(dc.title),
      iptcText(iptc.ObjectName),
    ].find((value) => value && !PLACEHOLDER_CAPTION.test(value)),
    software: text(ifd0.Software) ?? xmpText(xmp.CreatorTool),
    sublocation: xmpText(iptcCore.Location) ?? iptcText(iptc.Sublocation),
    city: xmpText(photoshop.City) ?? iptcText(iptc.City),
    region: xmpText(photoshop.State) ?? iptcText(iptc.State),
    country:
      xmpText(photoshop.Country) ??
      iptcText(iptc.Country) ??
      xmpText(iptcCore.CountryCode) ??
      iptcText(iptc.CountryCode),
  };
  const entries = Object.entries(meta).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as PhotoMetadata) : undefined;
}

type CaptureTime = Pick<PhotoMetadata, "takenAt" | "utcOffset">;

function captureTime(
  exif: TagBlock,
  photoshop: TagBlock,
  xmp: TagBlock,
  iptc: TagBlock,
): CaptureTime {
  return (
    parseDateTime(exif.DateTimeOriginal, exif.OffsetTimeOriginal) ??
    parseDateTime(photoshop.DateCreated) ??
    parseDateTime(exif.CreateDate, exif.OffsetTimeDigitized) ??
    parseDateTime(xmp.CreateDate) ??
    parseIptcDateTime(iptc.DateCreated, iptc.TimeCreated) ??
    {}
  );
}

/** EXIF `2024:07:14 18:32:05` or XMP `2024-07-14T18:32:05-07:00`. */
function parseDateTime(value: unknown, offsetTag?: unknown): CaptureTime | undefined {
  if (typeof value !== "string") return undefined;
  const match = value
    .trim()
    .match(
      /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    );
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second = "00", zone] = match;
  return buildCaptureTime(year, month, day, hour, minute, second, zone ?? offsetTag);
}

/** IPTC `20240714` plus `183205-0700`. */
function parseIptcDateTime(date: unknown, time: unknown): CaptureTime | undefined {
  const day = typeof date === "string" ? date.match(/^(\d{4})(\d{2})(\d{2})$/) : null;
  if (!day) return undefined;
  const clock =
    typeof time === "string" ? time.match(/^(\d{2})(\d{2})(\d{2})([+-]\d{4})?$/) : null;
  return buildCaptureTime(day[1], day[2], day[3], clock?.[1], clock?.[2], clock?.[3], clock?.[4]);
}

function buildCaptureTime(
  year: string,
  month: string,
  day: string,
  hour: string | undefined,
  minute: string | undefined,
  second: string | undefined,
  zone: unknown,
): CaptureTime | undefined {
  const validDate =
    Number(year) >= 1900 &&
    Number(year) <= 2100 &&
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= 31;
  if (!validDate) return undefined;
  const validClock =
    hour !== undefined && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
  const takenAt = validClock
    ? `${year}-${month}-${day}T${hour}:${minute}:${second}`
    : `${year}-${month}-${day}`;
  const utcOffset = validClock ? normalizeOffset(zone) : undefined;
  return utcOffset ? { takenAt, utcOffset } : { takenAt };
}

function normalizeOffset(zone: unknown): string | undefined {
  if (zone === "Z") return "+00:00";
  if (typeof zone !== "string") return undefined;
  const match = zone.trim().match(/^([+-])(\d{2}):?(\d{2})$/);
  return match ? `${match[1]}${match[2]}:${match[3]}` : undefined;
}

function altitude(value: unknown, ref: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const refValue = ref instanceof Uint8Array || Array.isArray(ref) ? ref[0] : ref;
  return Math.round(Number(refValue) === 1 ? -value : value);
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const clean = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return undefined;
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1).trimEnd()}…` : clean;
}

/** XMP values keep XML entities and may be language alternatives (`{ lang, value }`). */
function xmpText(value: unknown): string | undefined {
  const item = Array.isArray(value)
    ? (value.find((entry) => (entry as { lang?: unknown })?.lang === "x-default") ?? value[0])
    : value;
  const raw = item && typeof item === "object" ? (item as { value?: unknown }).value : item;
  return typeof raw === "string" ? text(decodeXmlEntities(raw)) : text(raw);
}

/** exifr reads IPTC as Latin-1, which garbles the UTF-8 most files use ("ZÃ¼rich"). */
function iptcText(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/[\u0080-\u00ff]/.test(raw) || /[^\u0000-\u00ff]/.test(raw)) {
    return text(raw);
  }
  try {
    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    return text(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return text(raw);
  }
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith("#")) {
      const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : Number(lower.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return XML_ENTITIES[lower] ?? entity;
  });
}
