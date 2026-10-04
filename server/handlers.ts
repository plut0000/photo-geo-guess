import { reverseGeocode } from "./geocode.js";
import { sanitizePhotoMetadata } from "./metadata.js";
import { getVisionProvider, guessFromImage, QuotaExceededError } from "./vision.js";

export type GuessRequest = {
  source?: string;
  latitude?: number;
  longitude?: number;
  image?: string;
  metadata?: unknown;
};

export function handleStatus() {
  const provider = getVisionProvider();
  return { visionEnabled: Boolean(provider), provider };
}

export async function handleGuess(
  body: GuessRequest,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (body.source === "exif") {
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!validCoord(latitude, longitude)) {
      return { status: 400, body: { error: "Those GPS coordinates look invalid." } };
    }
    const place = await reverseGeocode(latitude, longitude);
    return {
      status: 200,
      body: {
        latitude,
        longitude,
        ...place,
        rationale:
          "This photo embeds GPS coordinates in its EXIF metadata, so the pin is taken from the camera rather than guessed from the scene.",
        confidence: 0.98,
        radiusKm: 1.7,
        source: "exif",
      },
    };
  }

  if (body.source === "vision") {
    if (!getVisionProvider()) {
      return {
        status: 503,
        body: {
          error:
            "This photo has no GPS data. Add GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in a local .env file or in your Vercel project environment to enable visual guessing.",
        },
      };
    }
    if (typeof body.image !== "string" || !body.image.startsWith("data:image/")) {
      return { status: 400, body: { error: "A photo is required for visual guessing." } };
    }
    try {
      const guess = await guessFromImage(body.image, sanitizePhotoMetadata(body.metadata));
      const confidence = Math.min(1, Math.max(0, guess.confidence));
      return {
        status: 200,
        body: {
          ...guess,
          confidence,
          radiusKm: Math.round((30 - confidence * 20) * 10) / 10,
          source: "vision",
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong while guessing.";
      return {
        status: error instanceof QuotaExceededError ? 429 : 500,
        body: { error: message },
      };
    }
  }

  return { status: 400, body: { error: "Unknown guess source." } };
}

function validCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}
