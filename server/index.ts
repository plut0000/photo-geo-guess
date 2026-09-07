import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer as createViteServer } from "vite";
import { reverseGeocode } from "./geocode.ts";
import { getVisionProvider, guessFromImage } from "./vision.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT) || 5173;

loadEnvFile(path.join(root, ".env"));

const app = express();
app.disable("x-powered-by");
app.use("/api", express.json({ limit: "12mb" }));

app.get("/api/status", (_req, res) => {
  const provider = getVisionProvider();
  res.json({ visionEnabled: Boolean(provider), provider });
});

app.post("/api/guess", async (req, res) => {
  try {
    const body = req.body as {
      source?: string;
      latitude?: number;
      longitude?: number;
      image?: string;
    };

    if (body.source === "exif") {
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      if (!validCoord(latitude, longitude)) {
        res.status(400).json({ error: "Those GPS coordinates look invalid." });
        return;
      }
      const place = await reverseGeocode(latitude, longitude);
      res.json({
        latitude,
        longitude,
        ...place,
        rationale:
          "This photo embeds GPS coordinates in its EXIF metadata, so the pin is taken from the camera rather than guessed from the scene.",
        confidence: 0.98,
        radiusKm: 1.7,
        source: "exif",
      });
      return;
    }

    if (body.source === "vision") {
      if (!getVisionProvider()) {
        res.status(503).json({
          error:
            "This photo has no GPS data. Add GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to a local .env file and restart the server to enable visual guessing.",
        });
        return;
      }
      if (typeof body.image !== "string" || !body.image.startsWith("data:image/")) {
        res.status(400).json({ error: "A photo is required for visual guessing." });
        return;
      }
      const guess = await guessFromImage(body.image);
      const confidence = Math.min(1, Math.max(0, guess.confidence));
      res.json({
        ...guess,
        confidence,
        radiusKm: Math.round((30 - confidence * 20) * 10) / 10,
        source: "vision",
      });
      return;
    }

    res.status(400).json({ error: "Unknown guess source." });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Something went wrong while guessing.";
    res.status(500).json({ error: message });
  }
});

if (isProd) {
  const dist = path.join(root, "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
} else {
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true, host: "0.0.0.0" },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(port, "0.0.0.0", () => {
  console.log(`Locus running at http://localhost:${port}`);
});

function validCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
