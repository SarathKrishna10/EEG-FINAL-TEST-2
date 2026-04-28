import { useState } from "react";
import { Activity, ShieldCheck, HeartPulse } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLogin, useSignUp } from "@/hooks/use-auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  
  const login = useLogin();
  const signUp = useSignUp();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    if (isLogin) {
      login.mutate({ email, password });
    } else {
      signUp.mutate({ email, password });
    }
  };

  const isPending = isLogin ? login.isPending : signUp.isPending;

  return (
    <div className="min-h-screen brand-gradient flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Background ambient orbs */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute -top-60 -right-60 w-[700px] h-[700px] rounded-full bg-primary/6 blur-[140px]" />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-primary/3 blur-[180px]" />
      </div>

      {/* Subtle grid pattern overlay */}
      <div
        className="absolute inset-0 z-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(19,236,182,1) 1px, transparent 1px), linear-gradient(90deg, rgba(19,236,182,1) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="w-full max-w-[1000px] grid md:grid-cols-2 gap-10 items-center z-10">

        {/* Left branding side */}
        <div className="hidden md:flex flex-col justify-center px-6 text-foreground">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-3 bg-primary rounded-2xl text-[#10221d] shadow-xl primary-glow">
              <Activity className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground">
              Med<span className="text-primary">Diagnostic</span>
            </h1>
          </div>

          <h2 className="text-4xl font-display font-bold leading-tight mb-5 text-foreground">
            Advanced patient analytics<br />
            <span className="text-primary">and real-time monitoring.</span>
          </h2>

          <p className="text-muted-foreground text-base mb-10 max-w-md leading-relaxed">
            Securely access live ESP32 hardware diagnostics, retrieve patient histories,
            and manage session data from one unified dashboard.
          </p>

          <div className="flex gap-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
                <ShieldCheck className="w-4 h-4 text-primary" />
              </div>
              HIPAA Compliant
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
                <HeartPulse className="w-4 h-4 text-primary" />
              </div>
              Live Telemetry
            </div>
          </div>

          {/* Decorative stat strip */}
          <div className="mt-12 grid grid-cols-3 gap-4">
            {[
              { value: "99.9%", label: "Uptime" },
              { value: "<14ms", label: "Latency" },
              { value: "256-bit", label: "Encryption" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="p-4 rounded-xl border border-primary/10 bg-primary/5 text-center"
              >
                <p className="text-lg font-bold font-display text-primary">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right login form side */}
        <div className="w-full max-w-md mx-auto">
          <div className="glass-card rounded-3xl p-8 sm:p-10">
            <div className="text-center mb-8">
              <div className="md:hidden flex justify-center mb-6">
                <div className="p-3 bg-primary text-[#10221d] rounded-2xl shadow-xl primary-glow">
                  <Activity className="w-8 h-8" />
                </div>
              </div>
              <h2 className="text-2xl font-display font-bold text-foreground mb-2">
                {isLogin ? "Welcome Back" : "Create Account"}
              </h2>
              <p className="text-muted-foreground">
                {isLogin ? "Sign in to your clinical workspace" : "Register a new clinical workspace"}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground/80 ml-1">Staff Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dr.smith@hospital.org"
                  className="h-12 bg-background/60 border-border focus:bg-background focus:border-primary transition-all rounded-xl placeholder:text-muted-foreground/40"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground/80 ml-1">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-12 bg-background/60 border-border focus:bg-background focus:border-primary transition-all rounded-xl placeholder:text-muted-foreground/40"
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={isPending}
                className="w-full h-12 text-base font-semibold rounded-xl bg-primary hover:bg-primary/90 text-[#10221d] shadow-xl primary-glow hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 mt-4"
              >
                {isPending ? "Authenticating..." : (isLogin ? "Sign In" : "Sign Up")}
              </Button>
            </form>

            <div className="mt-5 text-center">
              <button 
                type="button" 
                onClick={() => setIsLogin(!isLogin)}
                className="text-sm text-primary font-medium hover:underline"
              >
                {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
              </button>
            </div>

            <div className="mt-6 pt-6 border-t border-border/60 text-center">
              <p className="text-xs text-muted-foreground/60">
                Unauthorized access to this system is strictly prohibited under federal law.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
