import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    // Frontend wasn't bundled into this deploy (e.g. SKIP_CLIENT_BUILD=1
    // because Vercel is hosting the React client). Serve a tiny info page
    // at the root so the URL doesn't 404, and let API routes work normally.
    console.warn(
      `[static] No build directory at ${distPath} — running API-only mode.`,
    );
    app.get("/", (_req, res) => {
      res.type("text/plain").send(
        "NeuroGuard API server. Frontend is hosted separately. " +
          "Try /api/... routes or POST /eeg/ingest.",
      );
    });
    return;
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
