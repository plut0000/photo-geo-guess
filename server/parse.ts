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
      stringOrEmpty(data.rationale) ||
      "Visual cues were limited, so this is a broad regional guess.",
    confidence: Number.isFinite(confidence) ? confidence : 0.35,
  };
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | undefined {
  const text = stringOrEmpty(value);
  return text || undefined;
}
