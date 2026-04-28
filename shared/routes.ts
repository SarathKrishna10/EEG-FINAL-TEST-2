import { z } from 'zod';
import { insertUserSchema, users, patients } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  auth: {
    login: {
      method: 'POST' as const,
      path: '/api/login' as const,
      input: insertUserSchema,
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.unauthorized,
      }
    }
  },
  patient: {
    lookup: {
      method: 'GET' as const,
      path: '/api/patient' as const,
      input: z.object({ email: z.string() }).optional(),
      responses: {
        200: z.custom<typeof patients.$inferSelect>(),
        404: errorSchemas.notFound,
      }
    }
  },
  esp32: {
    status: {
      method: 'GET' as const,
      path: '/api/esp32/status' as const,
      responses: {
        200: z.object({ connected: z.boolean() }),
        500: errorSchemas.internal,
      }
    }
  },
  session: {
    start: {
      method: 'POST' as const,
      path: '/api/session/start' as const,
      input: z.object({ patientName: z.string() }),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: errorSchemas.internal,
      }
    }
  },

  // ─── NEW: AI Prediction endpoint ─────────────────────────────────────────
  predict: {
    method: 'POST' as const,
    path: '/api/predict' as const,
    input: z.object({
      patientName: z.string().min(1, 'Patient name is required'),
      features: z.array(z.number()).optional().default([]),
      sessionId: z.string().optional(),
      userId: z.string().optional(),
    }),
    responses: {
      200: z.object({
        patient_name: z.string(),
        prediction: z.string(),
        confidence: z.number(),
        status_text: z.string(),
        mci_probability: z.number(),
        raw_scores: z.array(z.number()),
        session_id: z.string().optional().nullable(),
        model_loaded: z.boolean(),
        csv_url: z.string().optional().nullable(),
        heatmap_url: z.string().optional().nullable(),
        heatmap_data: z.any().optional().nullable(),
      }),
      422: errorSchemas.validation,
      503: errorSchemas.internal,
    }
  },

  // ─── NEW: AI Service health passthrough ───────────────────────────────────
  aiHealth: {
    method: 'GET' as const,
    path: '/api/ai/health' as const,
    responses: {
      200: z.object({
        status: z.string(),
        model_loaded: z.boolean(),
        model_path: z.string(),
        esp32_server_running: z.boolean(),
        esp32_port: z.number(),
        service_port: z.number(),
      }),
      503: z.object({ status: z.string(), model_loaded: z.boolean(), esp32_server_running: z.boolean() }),
    }
  },

  // ─── NEW: Deep EEG Analysis Status ──────────────────────────────────────
  diagnosisStatus: {
    method: 'GET' as const,
    path: '/api/diagnosis/status' as const,
    responses: {
      200: z.object({
        verdict: z.string(),
        confidence: z.number(),
        signal_status: z.string(),
        buffer_fill: z.number(),
        fp1_recent: z.array(z.number()),
        fp2_recent: z.array(z.number()),
      }),
    }
  },
  eegStream: {
    method: 'GET' as const,
    path: '/api/eeg/stream' as const,
  },

  // ─── NEW: Report Download ───────────────────────────────────────────────
  reportDownload: {
    method: 'GET' as const,
    path: '/api/report/download' as const,
    input: z.object({ patientName: z.string() }),
  },
  
  // ─── NEW: History & Analytics ─────────────────────────────────────────────
  history: {
    method: 'GET' as const,
    path: '/api/history' as const,
  },
  analytics: {
    method: 'GET' as const,
    path: '/api/analytics' as const,
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
