import { useState } from "react";
import { PlayCircle, User, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useStartSession, useEsp32Status } from "@/hooks/use-diagnostic";

export function DiagnosticSession() {
  const [patientName, setPatientName] = useState("");
  const startSession = useStartSession();
  const { data: espStatus } = useEsp32Status();

  const isConnected = espStatus?.connected ?? false;

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientName.trim()) return;
    startSession.mutate(patientName.trim());
  };

  return (
    <Card className="relative p-6 md:p-8 bg-card border border-card-border rounded-2xl teal-glow-card overflow-hidden h-full flex flex-col">
      {/* Decorative teal glow blob */}
      <div className="absolute -right-16 -top-16 w-52 h-52 bg-primary/8 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-primary/5 rounded-full blur-2xl pointer-events-none" />

      <div className="relative z-10 flex-1">
        <div className="mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-primary/10 border border-primary/20 rounded-xl text-primary mb-5 shadow-sm">
            <PlayCircle className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-2">
            New Diagnostic Session
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed max-w-sm">
            Initialize a new live data stream from the diagnostic hardware. Ensure the
            ESP32 sensor array is connected before proceeding.
          </p>
        </div>

        <form onSubmit={handleStart} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="patientName" className="text-sm font-semibold text-foreground/80 ml-1">
              Patient Full Name
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
              <Input
                id="patientName"
                placeholder="e.g. Jane Doe"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                className="pl-10 h-12 bg-background/60 border-border focus:border-primary focus:ring-primary/20 transition-all rounded-xl placeholder:text-muted-foreground/40"
              />
            </div>
          </div>

          {!isConnected && (
            <div className="flex items-start gap-3 p-4 bg-red-500/10 text-red-400 rounded-xl border border-red-500/20 text-sm animate-in fade-in">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>
                <strong className="text-red-300">Hardware Disconnected.</strong> You cannot start
                a diagnostic session until the ESP32 device is online and transmitting.
              </p>
            </div>
          )}

          <Button
            type="submit"
            disabled={!patientName.trim() || !isConnected || startSession.isPending}
            className="w-full h-12 mt-4 text-base font-semibold rounded-xl bg-primary hover:bg-primary/90 text-[#10221d] shadow-lg primary-glow hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-40 disabled:shadow-none disabled:translate-y-0"
          >
            {startSession.isPending ? "Initializing..." : "Start Diagnostic Session"}
          </Button>
        </form>
      </div>
    </Card>
  );
}
