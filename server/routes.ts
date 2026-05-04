import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import axios from "axios";

// ─── Service URLs ─────────────────────────────────────────────────────────────
const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || "http://127.0.0.1:9000").replace(/\/+$/, "");

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Auth ─────────────────────────────────────────────────────────────────
  app.post(api.auth.login.path, async (req, res) => {
    try {
      const input = api.auth.login.input.parse(req.body);

      let user = await storage.getUserByEmail(input.email);

      if (!user) {
        user = await storage.createUser({
          email: input.email,
          password: input.password,
        });
      }

      if (user.password !== input.password) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      res.status(200).json(user);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      console.error("[LOGIN ERROR]", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Patient Lookup ───────────────────────────────────────────────────────
  app.get(api.patient.lookup.path, async (req, res) => {
    try {
      const email = req.query.email;
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ message: "Email query parameter is required" });
      }

      const patient = await storage.getPatientByEmail(email);
      if (!patient) {
        return res.status(404).json({ message: "Patient not found" });
      }

      res.status(200).json(patient);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── ESP32 Status ─────────────────────────────────────────────────────────
  app.get(api.esp32.status.path, async (req, res) => {
    try {
      const response = await axios.get(`${AI_SERVICE_URL}/esp32/status`, { timeout: 2000 });
      res.status(200).json(response.data);
    } catch (err) {
      res.status(200).json({ connected: false });
    }
  });

  // ─── Start Session ────────────────────────────────────────────────────────
  app.post(api.session.start.path, async (req, res) => {
    try {
      const input = api.session.start.input.parse(req.body);

      const response = await axios.post(
        `${AI_SERVICE_URL}/esp32/session`,
        { patient_name: input.patientName },
        { timeout: 5000 }
      );

      res.status(200).json({ success: true, message: response.data.message });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "Failed to connect to AI service or ESP32 device" });
    }
  });

  // ─── AI Predict ───────────────────────────────────────────────────────────
  app.post(api.predict.path, async (req, res) => {
    try {
      const input = api.predict.input.parse(req.body);

      const response = await axios.post(
        `${AI_SERVICE_URL}/predict`,
        {
          patient_name: input.patientName,
          features: input.features,
          session_id: input.sessionId,
          user_id: input.userId,
        },
        { timeout: 15000 }
      );

      res.status(200).json(response.data);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      if (axios.isAxiosError(err)) {
        const status = err.response?.status ?? 503;
        const message = err.response?.data?.detail ?? "AI service unavailable";
        return res.status(status).json({ message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Diagnosis Status ─────────────────────────────────────────────────────
  app.get(api.diagnosisStatus.path, async (req, res) => {
    try {
      const response = await axios.get(`${AI_SERVICE_URL}/diagnosis/status`, { timeout: 2000 });
      res.status(200).json(response.data);
    } catch (err) {
      res.status(503).json({ message: "Diagnosis service unavailable" });
    }
  });

  // ─── Report Download ──────────────────────────────────────────────────────
  app.get(api.reportDownload.path, async (req, res) => {
    try {
      const patientName = (req.query.patientName as string) || "Patient";
      const response = await axios.get(`${AI_SERVICE_URL}/report/download`, {
        params: { patient_name: patientName },
        responseType: 'arraybuffer',
        timeout: 10000
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename=NeuroGuard_Report_${patientName}.zip`);
      res.send(Buffer.from(response.data));
    } catch (err) {
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // ─── History ──────────────────────────────────────────────────────────────
  app.get(api.history.path, async (req, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const response = await axios.get(`${AI_SERVICE_URL}/history`, {
        params: { user_id: userId },
        timeout: 5000
      });
      res.status(200).json(response.data);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch history" });
    }
  });

  // ─── Analytics ────────────────────────────────────────────────────────────
  app.get(api.analytics.path, async (req, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const response = await axios.get(`${AI_SERVICE_URL}/analytics`, {
        params: { user_id: userId },
        timeout: 5000
      });
      res.status(200).json(response.data);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  // ─── EEG Stream ───────────────────────────────────────────────────────────
  app.get(api.eegStream.path, async (req, res) => {
    try {
      const response = await axios.get(`${AI_SERVICE_URL}/eeg/stream`, {
        responseType: 'stream',
      });
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      response.data.pipe(res);
    } catch (err) {
      res.status(503).json({ message: "EEG Stream unavailable" });
    }
  });

  // ─── AI Health ────────────────────────────────────────────────────────────
  app.get(api.aiHealth.path, async (req, res) => {
    try {
      const response = await axios.get(`${AI_SERVICE_URL}/health`, { timeout: 3000 });
      res.status(200).json(response.data);
    } catch (err) {
      res.status(503).json({
        status: "offline",
        model_loaded: false,
        esp32_server_running: false,
      });
    }
  });

  // ─── ESP32 EEG Ingest (direct from hardware over HTTPS) ──────────────────
  // ESP32 posts plain text "fp1,fp2\n" batches directly to this endpoint
  // Node.js forwards to Python AI service which fills the EEG buffer
  app.post("/eeg/ingest", (req, res) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const r = await axios.post(
          `${AI_SERVICE_URL}/eeg/ingest`,
          body,
          {
            headers: { "Content-Type": "text/plain" },
            timeout: 10000,
          }
        );
        const sent = body.trim().split('\n').filter(Boolean).length;
        const accepted = (r.data && typeof r.data.accepted === "number") ? r.data.accepted : undefined;
        if (accepted !== undefined && accepted < sent) {
          console.warn(`[EEG INGEST] AI accepted ${accepted}/${sent} lines — parser may be rejecting samples`);
        }
        res.json({ ok: true, sent, accepted });
      } catch (err) {
        // Don't fail ESP32 — just log and return ok
        console.error("[EEG INGEST] AI service error:", err);
        res.json({ ok: false });
      }
    });

    req.on("error", (err) => {
      console.error("[EEG INGEST] Request error:", err);
      res.status(500).json({ ok: false });
    });
  });

  return httpServer;
}
