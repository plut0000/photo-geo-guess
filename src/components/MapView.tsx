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
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <Circle
        center={center}
        radius={guess.radiusKm * 1000}
        pathOptions={{
          color: "#e8b86d",
          weight: 1.5,
          fillColor: "#e8b86d",
          fillOpacity: 0.16,
        }}
      />
      <Marker position={center} icon={pin} />
      <FitGuess guess={guess} />
    </MapContainer>
  );
}
