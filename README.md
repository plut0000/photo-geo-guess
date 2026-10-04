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

Production (local):

```bash
npm run build
npm start
```

## Deploy on Vercel

This repo is set up as a Vite frontend plus `/api` serverless functions.

1. Import the GitHub repo at [vercel.com/new](https://vercel.com/new).
2. Vercel detects Vite. Leave the defaults (`npm run build`, output `dist`).
3. Optional: in Project Settings → Environment Variables, add `GEMINI_API_KEY` (free tier), `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` (and redeploy) so photos without GPS can use visual guessing.
4. Deploy.

Or from a machine logged into Vercel CLI:

```bash
npx vercel --yes --prod
```

EXIF-based guesses work without any API key. Visual guesses stay on the server so the key never ships to the browser.

## Environment variables

Copy `.env.example` to `.env` locally, or set the same names in the Vercel project. **Do not commit secrets.**

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | For visual guesses (free tier OK) | Uses Gemini Flash via [Google AI Studio](https://aistudio.google.com/apikey). Enough for personal use; rate-limited. |
| `OPENAI_API_KEY` | Alternative | Uses `gpt-5.6-luna` (or `OPENAI_MODEL`) through the Responses API |
| `ANTHROPIC_API_KEY` | Alternative | Used if `OPENAI_API_KEY` is unset |
| `GEMINI_MODEL` | No | Defaults to `gemini-3.6-flash` (current Flash; override if Google retires this id) |
| `OPENAI_MODEL` | No | Defaults to `gpt-5.6-luna`, a reasoning model called with reasoning effort `low`. Must accept image input. |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-sonnet-4-20250514` |
| `PORT` | No | Defaults to `5173` |

If more than one key is set, the server prefers **OpenAI → Anthropic → Gemini**. A Gemini-only `.env` is enough.

Get a free Gemini key at [Google AI Studio](https://aistudio.google.com/apikey). The free tier is enough for personal use (rate-limited).

If no API key is set, EXIF-based guesses still work. Photos without GPS show a clear message that visual guessing needs a key.

## How guessing works

1. **Client EXIF** — GPS is parsed in the browser with [`exifr`](https://github.com/MikeKovarik/exifr). HEIC is converted in-browser when possible.
2. **Embedded GPS** — coordinates are reverse-geocoded through the local server via OpenStreetMap Nominatim. Confidence is high; the map circle is about **1.5–10 km** (tighter when the fix is exact).
3. **No GPS** — a compressed JPEG is sent to `/api/guess`, along with a few non-GPS metadata fields read in the browser when the file has them: capture time and UTC offset, camera make/model, lens, altitude, caption, software, and IPTC/XMP location tags (sublocation, city, region, country). The server calls OpenAI, Anthropic, or Gemini with the metadata as clearly labeled hints and asks for a center point, place label, confidence, and a rationale of at most two sentences. Radius maps linearly from **10 km** (high confidence) to **30 km** (low).

GPS coordinates are never sent this way: photos with GPS skip the vision model entirely, and the browser only reads altitude from the GPS block.

The API key never leaves the server.

### When a model reply goes wrong

- **Cut-off answers.** Gemini and OpenAI are asked for coordinates and confidence before the place name and rationale. If a reply stops early (Gemini `MAX_TOKENS`, OpenAI `max_output_tokens`), the server keeps the coordinates and any other fields that were fully written, uses a confidence of 0.4 if none was given, and shows the partial rationale.
- **No usable coordinates.** The server retries once, unless the model refused the photo or the first attempt was too slow to fit another one in the 60 s function limit.
- **Quota or rate limits.** A Gemini free-tier `429` (20 requests per day) or an OpenAI `429` / `insufficient_quota` shows a plain message, such as "The free AI quota is used up for today. Try again tomorrow, or use a photo that has GPS data." Photos with GPS keep working without any AI quota.

## Stack

- Vite + React + TypeScript
- Express for local `npm run dev` / `npm start`
- Vercel Functions for `/api/status` and `/api/guess` in production
- Leaflet + Esri World Imagery tiles (no Mapbox key)
- `exifr` for metadata, optional HEIC via `heic2any`

```bash
npm test    # radius, metadata, JSON salvage, provider requests
```
