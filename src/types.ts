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

export type VisionStatus = {
  visionEnabled: boolean;
  provider: "openai" | "anthropic" | null;
};

export type AppState =
  | { status: "idle" }
  | { status: "analyzing"; previewUrl: string; phase: string }
  | { status: "result"; previewUrl: string; guess: LocationGuess; fileName: string }
  | { status: "error"; previewUrl?: string; message: string };
