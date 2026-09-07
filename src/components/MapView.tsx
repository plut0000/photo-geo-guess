import { useEffect } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LocationGuess } from "../types";

const pin = L.divIcon({
  className: "locus-pin",
  html: '<span class="locus-pin-core"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function FitGuess({ guess }: { guess: LocationGuess }) {
  const map = useMap();
  useEffect(() => {
    const bounds = L.latLng(guess.latitude, guess.longitude).toBounds(
      guess.radiusKm * 1000 * 2.15,
    );
    map.fitBounds(bounds, { padding: [36, 36], animate: true });
  }, [guess, map]);
  return null;
}

export default function MapView({ guess }: { guess: LocationGuess }) {
  const center: [number, number] = [guess.latitude, guess.longitude];
  return (
    <MapContainer
      center={center}
      zoom={10}
      className="map"
      scrollWheelZoom
      zoomControl
    >
      <TileLayer
        attribution='Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      />
      <Circle
        center={center}
        radius={guess.radiusKm * 1000}
        pathOptions={{
          color: "#e8b86d",
          weight: 2,
          fillColor: "#e8b86d",
          fillOpacity: 0.22,
        }}
      />
      <Marker position={center} icon={pin} />
      <FitGuess guess={guess} />
    </MapContainer>
  );
}
