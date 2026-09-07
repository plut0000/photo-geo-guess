# Locus — photo geo guess

Drop a photo and get a best-guess location on an interactive map, with an uncertainty circle of about **10–30 km**.

Locus first reads **EXIF GPS** from the file. If the photo has coordinates, those are treated as high confidence and drawn with a tighter radius. If not, a vision model estimates a place from architecture, vegetation, signs, vehicles, light, and terrain — and stays honest when the scene is ambiguous.

## Run locally

```bash
npm install
cp .env.example .env   # optional; only needed for visual guesses
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Production:

```bash
npm run build
npm start
```

## Environment variables

Copy `.env.example` to `.env`. **Do not commit secrets.**

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | For visual guesses | Uses GPT-4o (or `OPENAI_MODEL`) to geolocate photos without GPS |
| `ANTHROPIC_API_KEY` | Alternative to OpenAI | Used only if `OPENAI_API_KEY` is unset |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o` |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-sonnet-4-20250514` |
| `PORT` | No | Defaults to `5173` |

If neither API key is set, EXIF-based guesses still work. Photos without GPS show a clear message that visual guessing needs a key.

## How guessing works

1. **Client EXIF** — GPS is parsed in the browser with [`exifr`](https://github.com/MikeKovarik/exifr). HEIC is converted in-browser when possible.
2. **Embedded GPS** — coordinates are reverse-geocoded through the local server via OpenStreetMap Nominatim. Confidence is high; the map circle is about **1.5–10 km** (tighter when the fix is exact).
3. **No GPS** — a compressed JPEG is sent to `/api/guess`. The server calls OpenAI or Anthropic and asks for a center point, place label, 1–3 sentence rationale, and confidence. Radius maps linearly from **10 km** (high confidence) to **30 km** (low).

The API key never leaves the server.

## Stack

- Vite + React + TypeScript
- Express (API + Vite middleware in development, static files in production)
- Leaflet + Esri World Imagery tiles (no Mapbox key)
- `exifr` for metadata, optional HEIC via `heic2any`

```bash
npm test    # radius + JSON parsing
```
