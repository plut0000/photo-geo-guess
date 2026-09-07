import { lazy, Suspense } from "react";
import type { LocationGuess } from "../types";
import { formatCoords, formatRadius } from "../lib/radius";

const MapView = lazy(() => import("./MapView"));

type Props = {
  previewUrl: string;
  fileName: string;
  guess: LocationGuess;
  onReset: () => void;
};

export function ResultView({ previewUrl, fileName, guess, onReset }: Props) {
  const sourceLabel =
    guess.source === "exif" ? "Embedded GPS" : "Visual estimate";
  const confidencePct = Math.round(guess.confidence * 100);

  return (
    <section className="result">
      <aside className="result-card">
        <div className="result-photo">
          <img src={previewUrl} alt={fileName || "Analyzed photo"} />
        </div>
        <p className="eyebrow">{sourceLabel}</p>
        <h2>{guess.placeName}</h2>
        <p className="coords">{formatCoords(guess.latitude, guess.longitude)}</p>
        <div className="meta-row">
          <span className="chip">{formatRadius(guess.radiusKm)} radius</span>
          <span className="chip">{confidencePct}% confidence</span>
        </div>
        <div className="confidence-track" aria-hidden="true">
          <div className="confidence-fill" style={{ width: `${confidencePct}%` }} />
        </div>
        <p className="rationale">{guess.rationale}</p>
        <button type="button" className="btn" onClick={onReset}>
          Try another photo
        </button>
      </aside>
      <div className="result-map">
        <Suspense fallback={<div className="map-fallback">Loading map…</div>}>
          <MapView guess={guess} />
        </Suspense>
      </div>
    </section>
  );
}
