export type GuessSource = "exif" | "vision";

export type LocationGuess = {
  latitude: number;
  longitude: number;
  placeName: string;
  city?: string;
  region?: string;
  country?: string;
  rationale: string;
  confidence: number;
  radiusKm: number;
  source: GuessSource;
};

/** Non-GPS photo metadata sent with vision guesses; the server re-validates it (server/metadata.ts). */
export type PhotoMetadata = {
  /** Camera wall-clock time, `YYYY-MM-DDTHH:MM:SS` or `YYYY-MM-DD`. */
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

export type VisionStatus = {
  visionEnabled: boolean;
  provider: "openai" | "anthropic" | "gemini" | null;
};

export type AppState =
  | { status: "idle" }
  | { status: "analyzing"; previewUrl: string; phase: string }
  | { status: "result"; previewUrl: string; guess: LocationGuess; fileName: string }
  | { status: "error"; previewUrl?: string; message: string };
