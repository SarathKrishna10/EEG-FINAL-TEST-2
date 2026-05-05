/**
 * use-sessions.ts
 * ---------------
 * Live Firestore listener for the sessions collection.
 *
 * Uses onSnapshot so the Patient Registry table updates automatically
 * the moment the Python AI service writes a new document — no polling,
 * no manual refreshes.
 *
 * Maps Firestore fields → UI:
 *   verdict / mci_probability  →  "HIGH RISK" (red) | "NORMAL" (cyan)
 *   csv_url                    →  signed URL returned by the Python API
 */
import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

// ─── Shape of a session document ─────────────────────────────────────────────

export interface Session {
  id: string;
  patient_name: string;
  verdict: "HIGH RISK" | "NORMAL" | string;
  /** 0–1 float from Firestore */
  confidence: number;
  /** 0–100 percentage; maps to the badge colour */
  mci_probability: number;
  user_id: string;
  csv_url?: string;
  csv_blob_path?: string;
  heatmap_url?: string;
  created_at: any;
}

// ─── Derive badge info from either verdict or mci_probability ────────────────

export function getRiskBadge(session: Session): { label: string; isHighRisk: boolean } {
  const isHighRisk =
    session.verdict === "HIGH RISK" ||
    (typeof session.mci_probability === "number" && session.mci_probability >= 50);

  return {
    label: isHighRisk ? "HIGH RISK" : "NORMAL",
    isHighRisk,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

interface UseLiveSessionsResult {
  sessions: Session[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Subscribes to the `sessions` Firestore collection filtered by `userId`.
 * Results are automatically ordered by `created_at` descending (newest first).
 *
 * Returns:
 *  - `sessions`  — live list, updates pushed automatically
 *  - `isLoading` — true only during the very first load
 *  - `error`     — non-null if the listener fails
 */
export function useLiveSessions(userId?: string): UseLiveSessionsResult {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      setSessions([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    const q = query(
      collection(db, "sessions"),
      where("user_id", "==", userId),
      orderBy("created_at", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs: Session[] = snapshot.docs.map(
          (doc: QueryDocumentSnapshot) => {
            const data = doc.data();
            return {
              id: doc.id,
              patient_name: data.patient_name ?? "Unknown",
              verdict: data.verdict ?? "NORMAL",
              confidence: data.confidence ?? 0,
              // Prefer explicit mci_probability; fall back to confidence * 100
              mci_probability:
                typeof data.mci_probability === "number"
                  ? data.mci_probability
                  : (data.confidence ?? 0) * 100,
              user_id: data.user_id ?? "",
              csv_url: data.csv_url,
              csv_blob_path: data.csv_blob_path,
              heatmap_url: data.heatmap_url,
              created_at: data.created_at ?? null,
            } satisfies Session;
          }
        );
        setSessions(docs);
        setIsLoading(false);
      },
      (err) => {
        console.error("[useLiveSessions] Firestore error:", err);
        setError(err as Error);
        setIsLoading(false);
      }
    );

    // Clean up listener when userId changes or component unmounts
    return () => unsubscribe();
  }, [userId]);

  return { sessions, isLoading, error };
}
