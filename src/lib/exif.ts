import exifr from "exifr";

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
