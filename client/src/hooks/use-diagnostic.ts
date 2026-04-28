import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { api, buildUrl } from "@shared/routes";
import { z } from "zod";
import axios, { AxiosError } from "axios";
import { useToast } from "@/hooks/use-toast";

// Fetch ESP32 Status
export function useEsp32Status() {
  return useQuery({
    queryKey: [api.esp32.status.path],
    queryFn: async () => {
      try {
        const res = await axios.get(api.esp32.status.path);
        return api.esp32.status.responses[200].parse(res.data);
      } catch (error) {
        console.error("ESP32 status check failed", error);
        return { connected: false };
      }
    },
    refetchInterval: 3000, // Poll every 3 seconds
  });
}

// Start Diagnostic Session
export function useStartSession() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (patientName: string) => {
      try {
        const payload = { patientName: patientName };
        const res = await axios.post("/api/session/start", payload);
        return res.data;
      } catch (error) {
        throw new Error("Failed to start session. Ensure ESP32 is connected.");
      }
    },
    onSuccess: (data) => {
      toast({
        title: "Session Started",
        description: data.message || "Diagnostic session initiated successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Session Error",
        description: error.message,
        variant: "destructive",
      });
    }
  });
}

/**
 * Real-time EEG Stream hook (SSE)
 */
export function useEegStream(enabled: boolean) {
  const [data, setData] = useState<{ fp1: number[]; fp2: number[] }>({ fp1: [], fp2: [] });
  const maxWindow = 500; 

  useEffect(() => {
    if (!enabled) {
      // Clear data if disabled
      setData({ fp1: [], fp2: [] });
      return;
    }

    const eventSource = new EventSource("/api/eeg/stream");

    eventSource.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);
        if (!Array.isArray(raw) || raw.length === 0) return;

        setData((prev) => {
          const nextFp1 = [...prev.fp1, ...raw.map((s: [number, number]) => s[0])].slice(-maxWindow);
          const nextFp2 = [...prev.fp2, ...raw.map((s: [number, number]) => s[1])].slice(-maxWindow);
          return { fp1: nextFp1, fp2: nextFp2 };
        });
      } catch (err) {
        console.error("EEG Stream Parse Error:", err);
      }
    };

    eventSource.onerror = () => {
      console.warn("EEG Stream connection lost. Retrying...");
      eventSource.close();
    };

    return () => eventSource.close();
  }, [enabled]);

  return data;
}

// Fetch Diagnosis Status (Near producing level telemetry)
export function useDiagnosisStatus() {
  return useQuery({
    queryKey: ['diagnosisStatus_direct'],
    queryFn: async () => {
      try {
        const res = await axios.get("/api/diagnosis/status");
        return res.data;
      } catch (error) {
        console.error("Diagnosis status retrieval failed", error);
        throw error;
      }
    },
    refetchInterval: 1000, 
  });
}

// Lookup Patient
export function usePatientLookup(email: string) {
  return useQuery({
    queryKey: [api.patient.lookup.path, email],
    queryFn: async () => {
      if (!email) return null;
      try {
        const res = await axios.get(`${api.patient.lookup.path}?email=${encodeURIComponent(email)}`);
        return api.patient.lookup.responses[200].parse(res.data);
      } catch (error) {
        if (error instanceof AxiosError && error.response?.status === 404) {
          throw new Error("Patient not found");
        }
        throw new Error("Error fetching patient details");
      }
    },
    enabled: false, // Only run manually
    retry: false,
  });
}

// History Hook
export function useHistory(userId?: string) {
  return useQuery({
    queryKey: [api.history.path, userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        const res = await axios.get(`${api.history.path}?userId=${userId}`);
        const data = res.data;
        return Array.isArray(data) ? data : (data?.data || []);
      } catch (error) {
        console.error("History fetch failed", error);
        throw error;
      }
    },
    enabled: !!userId,
  });
}

// Analytics Hook
export function useAnalytics(userId?: string) {
  return useQuery({
    queryKey: [api.analytics.path, userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        const res = await axios.get(`${api.analytics.path}?userId=${userId}`);
        const data = res.data;
        return Array.isArray(data) ? data : (data?.data || []);
      } catch (error) {
        console.error("Analytics fetch failed", error);
        throw error;
      }
    },
    enabled: !!userId,
  });
}
