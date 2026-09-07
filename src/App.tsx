import { useEffect, useRef, useState } from "react";
import { Analyzing } from "./components/Analyzing";
import { Dropzone } from "./components/Dropzone";
import { ErrorState } from "./components/ErrorState";
import { ResultView } from "./components/ResultView";
import { fetchVisionStatus, guessFromExif, guessFromVision } from "./lib/api";
import { readGps } from "./lib/exif";
import { compressForVision, fileToPreviewFile, isAcceptedImage } from "./lib/image";
import type { AppState, VisionStatus } from "./types";

const PHASES = [
  "Looking for GPS metadata…",
  "Reading architecture and materials…",
  "Checking vegetation and terrain…",
  "Scanning signs, language, and vehicles…",
  "Estimating a region…",
];

export default function App() {
  const [state, setState] = useState<AppState>({ status: "idle" });
  const [status, setStatus] = useState<VisionStatus | null>(null);
  const previewRef = useRef<string | null>(null);
  const phaseTimer = useRef<number | null>(null);

  useEffect(() => {
    fetchVisionStatus().then(setStatus).catch(() => {
      setStatus({ visionEnabled: false, provider: null });
    });
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      if (phaseTimer.current) window.clearInterval(phaseTimer.current);
    };
  }, []);

  function reset() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    if (phaseTimer.current) window.clearInterval(phaseTimer.current);
    setState({ status: "idle" });
  }

  function startPhases(previewUrl: string, first = PHASES[0]) {
    let i = 0;
    setState({ status: "analyzing", previewUrl, phase: first });
    phaseTimer.current = window.setInterval(() => {
      i = Math.min(i + 1, PHASES.length - 1);
      setState((prev) =>
        prev.status === "analyzing" ? { ...prev, phase: PHASES[i] } : prev,
      );
    }, 1600);
  }

  async function handleFile(file: File) {
    if (!isAcceptedImage(file)) {
      setState({
        status: "error",
        message: "Please drop a JPEG, PNG, WebP, or HEIC photo.",
      });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setState({
        status: "error",
        message: "That file is over 20 MB. Try a smaller photo.",
      });
      return;
    }

    if (previewRef.current) URL.revokeObjectURL(previewRef.current);

    try {
      const gps = await readGps(file);
      const previewFile = await fileToPreviewFile(file);
      const previewUrl = URL.createObjectURL(previewFile);
      previewRef.current = previewUrl;
      startPhases(previewUrl, gps ? "Reading embedded GPS…" : PHASES[0]);

      if (gps) {
        const guess = await guessFromExif(gps.latitude, gps.longitude);
        if (phaseTimer.current) window.clearInterval(phaseTimer.current);
        setState({ status: "result", previewUrl, guess, fileName: file.name });
        return;
      }

      if (status && !status.visionEnabled) {
        if (phaseTimer.current) window.clearInterval(phaseTimer.current);
        setState({
          status: "error",
          previewUrl,
          message:
            "This photo has no GPS data. Visual guessing needs a GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in a local .env file or Vercel project environment.",
        });
        return;
      }

      const image = await compressForVision(previewFile);
      const guess = await guessFromVision(image);
      if (phaseTimer.current) window.clearInterval(phaseTimer.current);
      setState({ status: "result", previewUrl, guess, fileName: file.name });
    } catch (error) {
      if (phaseTimer.current) window.clearInterval(phaseTimer.current);
      setState({
        status: "error",
        previewUrl: previewRef.current ?? undefined,
        message:
          error instanceof Error
            ? error.message
            : "We couldn’t analyze that photo.",
      });
    }
  }

  return (
    <div className="app">
      <div className="glow glow-a" />
      <div className="glow glow-b" />
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <p className="wordmark">Locus</p>
            <p className="tag">Photo geolocation</p>
          </div>
        </div>
        {status && !status.visionEnabled ? (
          <p className="status-pill">EXIF only — add an API key for visual guesses</p>
        ) : null}
        {status?.visionEnabled ? (
          <p className="status-pill on">Visual guessing via {status.provider}</p>
        ) : null}
      </header>

      <main>
        {state.status === "idle" ? (
          <section className="hero">
            <p className="eyebrow">Best guess, honest uncertainty</p>
            <h1>Where was this taken?</h1>
            <p className="lede">
              Drop a photo. If it carries GPS, we pin that spot. If not, we read
              the scene and draw a 10–30 km circle around a best guess.
            </p>
            <Dropzone onFile={handleFile} />
          </section>
        ) : null}

        {state.status === "analyzing" ? (
          <Analyzing previewUrl={state.previewUrl} phase={state.phase} />
        ) : null}

        {state.status === "result" ? (
          <ResultView
            previewUrl={state.previewUrl}
            fileName={state.fileName}
            guess={state.guess}
            onReset={reset}
          />
        ) : null}

        {state.status === "error" ? (
          <ErrorState
            message={state.message}
            previewUrl={state.previewUrl}
            onReset={reset}
          />
        ) : null}
      </main>

      <footer>
        Photos stay in your browser first. Images are sent to a vision model only
        when no GPS is found. Coordinates from EXIF are reverse-geocoded via
        OpenStreetMap Nominatim.
      </footer>
    </div>
  );
}
