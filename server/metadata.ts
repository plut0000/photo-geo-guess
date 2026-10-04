/**
 * Non-GPS hints read from the photo file in the browser (src/lib/exif.ts).
 * GPS coordinates are never part of this: photos with GPS skip the vision model.
 */
export type PhotoMetadata = {
  /** Camera wall-clock time, `YYYY-MM-DD HH:MM` or `YYYY-MM-DD`. */
  takenAt?: string;
  /** `±HH:MM` offset recorded with the capture time. */
  utcOffset?: string;
  cameraMake?: string;
  cameraModel?: string;
  lens?: string;
  altitudeM?: number;
  caption?: string;
  software?: string;
  sublocation?: string;
  city?: string;
  region?: string;
  country?: string;
};

const TEXT_LIMITS = {
  cameraMake: 40,
  cameraModel: 60,
  lens: 80,
  caption: 200,
  software: 60,
  sublocation: 80,
  city: 60,
  region: 60,
  country: 60,
} as const;

type TextField = keyof typeof TEXT_LIMITS;

/** Accepts untrusted request input and keeps only known, well-formed fields. */
export function sanitizePhotoMetadata(raw: unknown): PhotoMetadata | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  const meta: PhotoMetadata = {};

  for (const field of Object.keys(TEXT_LIMITS) as TextField[]) {
    const value = cleanText(input[field], TEXT_LIMITS[field]);
    if (value) meta[field] = value;
  }
  const takenAt = normalizeTakenAt(input.takenAt);
  if (takenAt) meta.takenAt = takenAt;
  const utcOffset = normalizeUtcOffset(input.utcOffset);
  if (utcOffset) meta.utcOffset = utcOffset;
  if (
    typeof input.altitudeM === "number" &&
    Number.isFinite(input.altitudeM) &&
    input.altitudeM >= -500 &&
    input.altitudeM <= 15000
  ) {
    meta.altitudeM = Math.round(input.altitudeM);
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** Prompt lines with labeled metadata hints, or "" when there is nothing useful. */
export function describePhotoMetadata(meta: PhotoMetadata | undefined): string {
  if (!meta) return "";
  const camera = cameraLabel(meta.cameraMake, meta.cameraModel);
  const location = [meta.sublocation, meta.city, meta.region, meta.country]
    .filter((part, index, parts): part is string => !!part && parts.indexOf(part) === index)
    .join(", ");
  const offset = meta.utcOffset ? formatUtcOffset(meta.utcOffset) : "";

  const hints = [
    meta.takenAt ? `taken ${meta.takenAt} ${offset || "(no time zone recorded)"}` : "",
    !meta.takenAt && offset ? `time zone ${offset}` : "",
    camera ? `camera ${camera}` : "",
    meta.lens ? `lens ${meta.lens}` : "",
    meta.altitudeM !== undefined ? `altitude ${meta.altitudeM} m` : "",
    meta.caption ? `caption "${meta.caption}"` : "",
    meta.software ? `software ${meta.software}` : "",
    location ? `location tags "${location}"` : "",
  ].filter(Boolean);
  if (hints.length === 0) return "";

  return [
    `Photo metadata: ${hints.join("; ")}.`,
    "Use this metadata only as clues: it can be missing, wrong, or edited, so base the estimate on what the image shows and say in the rationale if a metadata clue mattered.",
  ].join("\n");
}

function cleanText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/[\u0000-\u001f\u007f\\]/g, " ")
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function normalizeTakenAt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match;
  const valid =
    Number(year) >= 1900 &&
    Number(year) <= 2100 &&
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= 31 &&
    (hour === undefined || (Number(hour) <= 23 && Number(minute) <= 59));
  if (!valid) return undefined;
  const date = `${year}-${month}-${day}`;
  return hour === undefined ? date : `${date} ${hour}:${minute}`;
}

function normalizeUtcOffset(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "Z") return "+00:00";
  const match = trimmed.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!match || Number(match[2]) > 14 || Number(match[3]) > 59) return undefined;
  return `${match[1]}${match[2]}:${match[3]}`;
}

function formatUtcOffset(offset: string): string {
  return offset === "+00:00" || offset === "-00:00" ? "UTC" : `UTC${offset}`;
}

function cameraLabel(make?: string, model?: string): string {
  if (!model) return make ?? "";
  if (!make) return model;
  const brand = make.split(" ")[0].toLowerCase();
  return model.toLowerCase().startsWith(brand) ? model : `${make} ${model}`;
}
