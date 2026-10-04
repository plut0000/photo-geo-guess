export type VisionGuess = {
  latitude: number;
  longitude: number;
  placeName: string;
  city?: string;
  region?: string;
  country?: string;
  rationale: string;
  confidence: number;
};

/** Prompts ask for at most ~2 sentences; anything longer is clipped to this. */
export const RATIONALE_MAX_CHARS = 300;
/** Used when a cut-off reply stopped before its confidence value. */
export const SALVAGED_CONFIDENCE = 0.4;

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1) {
    throw new Error(missingJsonError(text));
  }
  if (end === -1 || end <= start) {
    throw new Error(
      missingJsonError(text, "The JSON object was truncated or invalid."),
    );
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error(
      missingJsonError(text, "The JSON object was truncated or invalid."),
    );
  }
}

export function missingJsonError(text: string, extra?: string): string {
  const preview = (text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  const parts = ["The vision model did not return a location estimate."];
  if (extra) parts.push(extra);
  if (!preview) {
    parts.push("The model response was empty.");
  } else {
    const clipped = (text || "").trim().length > 180;
    parts.push(`Response preview: ${preview}${clipped ? "…" : ""}`);
  }
  return parts.join(" ");
}

export function normalizeVisionGuess(raw: unknown): VisionGuess {
  if (!raw || typeof raw !== "object") {
    throw new Error("The vision model returned an unreadable estimate.");
  }
  const data = raw as Record<string, unknown>;
  const latitude = Number(data.latitude);
  const longitude = Number(data.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("The vision model did not include usable coordinates.");
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error("The vision model returned invalid coordinates.");
  }

  const confidence = Number(data.confidence);
  const placeName =
    stringOrEmpty(data.placeName) ||
    [stringOrEmpty(data.city), stringOrEmpty(data.region), stringOrEmpty(data.country)]
      .filter(Boolean)
      .join(", ") ||
    "Uncertain location";

  return {
    latitude,
    longitude,
    placeName,
    city: optionalString(data.city),
    region: optionalString(data.region),
    country: optionalString(data.country),
    rationale:
      clipRationale(stringOrEmpty(data.rationale)) ||
      "Visual cues were limited, so this is a broad regional guess.",
    confidence: Number.isFinite(confidence) ? confidence : 0.35,
  };
}

/** Parses a complete JSON answer, or salvages what a cut-off answer already wrote. */
export function readVisionGuess(text: string): VisionGuess | null {
  try {
    return normalizeVisionGuess(extractJson(text));
  } catch {
    return salvageVisionGuess(text);
  }
}

/**
 * Recovers a guess from a reply that stopped mid-JSON (for example Gemini
 * finishReason=MAX_TOKENS). Only values that were completely written are used,
 * so a coordinate cut off mid-number is never trusted.
 */
export function salvageVisionGuess(text: string): VisionGuess | null {
  const latitude = completeNumber(text, "latitude");
  const longitude = completeNumber(text, "longitude");
  if (latitude === undefined || longitude === undefined) return null;
  try {
    return normalizeVisionGuess({
      latitude,
      longitude,
      confidence: completeNumber(text, "confidence") ?? SALVAGED_CONFIDENCE,
      placeName: completeString(text, "placeName"),
      city: completeString(text, "city"),
      region: completeString(text, "region"),
      country: completeString(text, "country"),
      rationale:
        partialRationale(text) ||
        "The model's answer was cut off before it explained the visual cues.",
    });
  } catch {
    return null;
  }
}

/**
 * Collapses whitespace, drops repeated sentences (a common runaway pattern),
 * and caps the length at a sentence or word boundary. `cutOff` marks text that
 * stopped mid-thought, which gets an ellipsis unless it ends on a full sentence.
 */
export function clipRationale(text: string, cutOff = false): string {
  let clean = dedupeSentences(text.replace(/\s+/g, " ").trim());
  if (cutOff) clean = clean.replace(/(?:\.{2,}|…)+$/, "").trimEnd();
  const overLimit = clean.length > RATIONALE_MAX_CHARS;
  if (!clean || (!cutOff && !overLimit)) return clean;

  const window = overLimit ? clean.slice(0, RATIONALE_MAX_CHARS + 1) : clean;
  const sentenceEnd = lastSentenceEnd(window, !overLimit);
  if (sentenceEnd >= Math.min(window.length, RATIONALE_MAX_CHARS) / 3) {
    return window.slice(0, sentenceEnd);
  }
  const wordEnd = overLimit ? window.lastIndexOf(" ") : window.length;
  const kept = window
    .slice(0, wordEnd > 0 ? wordEnd : RATIONALE_MAX_CHARS)
    .replace(/[\s,;:–—-]+$/, "");
  return /[.!?]$/.test(kept) ? kept : `${kept}…`;
}

const NUMBER_PATTERN = String.raw`-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`;

/** A number only counts when a delimiter follows it, i.e. it was not cut mid-digit. */
function completeNumber(text: string, key: string): number | undefined {
  const match = text.match(
    new RegExp(`"${key}"\\s*:\\s*"?(${NUMBER_PATTERN})(?=["\\s,}\\]])`),
  );
  return match ? Number(match[1]) : undefined;
}

function completeString(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  return match ? decodeJsonString(match[1]) : undefined;
}

function partialRationale(text: string): string {
  const match = text.match(/"rationale"\s*:\s*"((?:[^"\\]|\\.)*)(")?/);
  if (!match) return "";
  const complete = match[2] === '"';
  const body = complete ? match[1] : match[1].replace(/\\u[0-9a-fA-F]{0,3}$/, "");
  return clipRationale(decodeJsonString(body), !complete);
}

function decodeJsonString(body: string): string {
  try {
    return JSON.parse(`"${body}"`) as string;
  } catch {
    return body.replace(/\\[nrt]/g, " ").replace(/\\(.)/g, "$1");
  }
}

function dedupeSentences(text: string): string {
  const seen = new Set<string>();
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      const key = sentence.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
}

/** Index just past the last sentence-ending punctuation, or -1. */
function lastSentenceEnd(text: string, includesTextEnd: boolean): number {
  const pattern = includesTextEnd ? /[.!?](?=\s|$)/g : /[.!?](?=\s)/g;
  let end = -1;
  for (const match of text.matchAll(pattern)) end = match.index + 1;
  return end;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | undefined {
  const text = stringOrEmpty(value);
  return text || undefined;
}
