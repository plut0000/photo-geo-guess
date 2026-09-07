import type { GuessSource } from "../types";

const VISION_MIN_KM = 10;
const VISION_MAX_KM = 30;
const EXIF_MIN_KM = 1.5;
const EXIF_MAX_KM = 10;

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.4;
  return Math.min(1, Math.max(0, value));
}

/** Higher confidence → smaller circle. Vision stays in the 10–30 km band. */
export function confidenceToRadiusKm(
  confidence: number,
  source: GuessSource,
): number {
  const c = clampConfidence(confidence);
  if (source === "exif") {
    return roundKm(EXIF_MAX_KM - c * (EXIF_MAX_KM - EXIF_MIN_KM));
  }
  return roundKm(VISION_MAX_KM - c * (VISION_MAX_KM - VISION_MIN_KM));
}

function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}

export function formatCoords(lat: number, lng: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`;
}

export function formatRadius(km: number): string {
  return `±${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
