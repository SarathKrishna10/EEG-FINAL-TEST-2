import { useMutation } from "@tanstack/react-query";
import { api } from "@shared/routes";
import axios, { AxiosError } from "axios";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

type PredictInput = z.infer<typeof api.predict.input>;
type PredictResponse = z.infer<typeof api.predict.responses[200]>;

/**
 * Hook to call the AI diagnostic prediction endpoint.
 *
 * Usage:
 *   const predict = usePredict();
 *   predict.mutate({ patientName: "Jane Doe", features: [0.1, 0.3, ...] });
 *
 * On success:
 *   predict.data.prediction  → "Normal" | "Alzheimer's Detected" | ...
 *   predict.data.confidence  → 0.0 – 1.0
 */
export function usePredict() {
    const { toast } = useToast();

    return useMutation<PredictResponse, Error, PredictInput>({
        mutationFn: async (input: PredictInput) => {
            try {
                const validated = api.predict.input.parse(input);
                const res = await axios.post("/api/predict", validated);
                return api.predict.responses[200].parse(res.data);
            } catch (error) {
                if (error instanceof AxiosError) {
                    const status = error.response?.status;
                    if (status === 503) {
                        throw new Error("AI service is not running. Start ai_service.py first.");
                    }
                    if (status === 422) {
                        throw new Error(error.response?.data?.message ?? "Invalid input features.");
                    }
                    throw new Error(error.response?.data?.message ?? "Prediction request failed.");
                }
                throw error;
            }
        },
        onSuccess: (data) => {
            const pct = (data.confidence * 100).toFixed(1);
            toast({
                title: "AI Prediction Complete",
                description: `${data.prediction} (${pct}% confidence)`,
            });
        },
        onError: (error) => {
            toast({
                title: "Prediction Failed",
                description: error.message,
                variant: "destructive",
            });
        },
    });
}
