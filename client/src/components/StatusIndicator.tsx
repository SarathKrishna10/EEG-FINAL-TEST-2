import { Activity } from "lucide-react";
import { useEsp32Status } from "@/hooks/use-diagnostic";
import { Skeleton } from "@/components/ui/skeleton";

export function StatusIndicator() {
  const { data, isLoading } = useEsp32Status();

  const isConnected = data?.connected ?? false;

  return (
    <div className="flex items-center gap-3 bg-background/50 border border-primary/10 px-4 py-2 rounded-full backdrop-blur-sm transition-all">
      <div className="flex items-center justify-center p-1.5 bg-primary/10 rounded-full">
        <Activity className="w-4 h-4 text-primary" />
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Device Status
        </span>
        <div className="flex items-center gap-2">
          {isLoading ? (
            <Skeleton className="h-3 w-16 bg-muted/40" />
          ) : (
            <>
              <div
                className={`w-2.5 h-2.5 rounded-full ${isConnected
                    ? "bg-primary status-pulse"
                    : "bg-red-500"
                  }`}
              />
              <span
                className={`text-sm font-semibold ${isConnected ? "text-primary" : "text-red-400"
                  }`}
              >
                {isConnected ? "Connected" : "Disconnected"}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
