import type { LocationGuess, PhotoMetadata, VisionStatus } from "../types";

export async function fetchVisionStatus(): Promise<VisionStatus> {
  const res = await fetch("/api/status");
  if (!res.ok) {
    return { visionEnabled: false, provider: null };
  }
  return res.json() as Promise<VisionStatus>;
}

export async function guessFromExif(
  latitude: number,
  longitude: number,
): Promise<LocationGuess> {
  const res = await fetch("/api/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "exif", latitude, longitude }),
  });
  return parseGuessResponse(res);
}

export async function guessFromVision(
  imageDataUrl: string,
  metadata?: PhotoMetadata,
): Promise<LocationGuess> {
  const res = await fetch("/api/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "vision", image: imageDataUrl, metadata }),
  });
  return parseGuessResponse(res);
}

async function parseGuessResponse(res: Response): Promise<LocationGuess> {
  const data = (await res.json()) as LocationGuess & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || "The location guess failed.");
  }
  return data;
}
