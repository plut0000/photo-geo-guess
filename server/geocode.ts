type NominatimResult = {
  display_name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    region?: string;
    country?: string;
  };
};

export type PlaceLabel = {
  placeName: string;
  city?: string;
  region?: string;
  country?: string;
};

export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<PlaceLabel> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("zoom", "12");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Locus Photo Geo Guess/1.0 (local demo; github.com/plut0000/photo-geo-guess)",
    },
  });

  if (!res.ok) {
    return fallbackPlace(latitude, longitude);
  }

  const data = (await res.json()) as NominatimResult;
  const city =
    data.address?.city ||
    data.address?.town ||
    data.address?.village ||
    data.address?.municipality;
  const region = data.address?.state || data.address?.region;
  const country = data.address?.country;
  const parts = [city, region, country].filter(Boolean) as string[];

  return {
    placeName: parts.join(", ") || data.display_name || fallbackPlace(latitude, longitude).placeName,
    city,
    region,
    country,
  };
}

function fallbackPlace(latitude: number, longitude: number): PlaceLabel {
  return {
    placeName: `${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°`,
  };
}
