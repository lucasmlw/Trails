import fs from "node:fs";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { env, loadAppConfig } from "./config.js";
import { authRouter, purgeExpiredSessions, requireAuth, seedUsersFromEnv } from "./auth.js";
import tripsRouter from "./routes/trips.js";
import waypointsRouter from "./routes/waypoints.js";
import tracksRouter from "./routes/tracks.js";
import externalRouter from "./routes/external.js";

seedUsersFromEnv();
purgeExpiredSessions();

const app = express();
app.disable("x-powered-by");
if (env.trustProxy) app.set("trust proxy", 1);

app.use((req, res, next) => {
  // Allow the packaged Android app (Capacitor) to call the API with credentials.
  const origin = req.headers.origin;
  if (origin && env.corsOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/config", requireAuth, (_req, res) => res.json(loadAppConfig()));
app.use("/api/auth", authRouter());
app.use("/api/trips", tripsRouter);
app.use("/api", waypointsRouter);
app.use("/api", tracksRouter);
app.use("/api", externalRouter);

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Serve the built web app (single page application) when present.
if (fs.existsSync(env.webDist)) {
  app.use(
    express.static(env.webDist, {
      setHeaders(res, filePath) {
        if (filePath.endsWith("sw.js") || filePath.endsWith("index.html") || filePath.endsWith("manifest.webmanifest")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
  app.get("*", (_req, res) => res.sendFile(path.join(env.webDist, "index.html")));
} else {
  app.get("/", (_req, res) => res.send("Trails API is running. Build the web app (npm run build) or run the Vite dev server."));
}

app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message || "Server error" });
});

app.listen(env.port, () => {
  console.log(`Trails server listening on http://localhost:${env.port} (${env.nodeEnv})`);
  console.log(`Data directory: ${env.dataDir}`);
});
