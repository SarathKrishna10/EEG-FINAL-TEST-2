
import { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useDiagnosisStatus, useStartSession, useEsp32Status, useEegStream, useAnalytics } from "@/hooks/use-diagnostic";
import { usePredict } from "@/hooks/use-predict";
import { PatientLookup } from "@/components/PatientLookup";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// ─── Types ──────────────────────────────────────────────────────────────────
type NavView = "dashboard" | "history" | "analytics" | "settings";

// ─── Material Symbol helper ───────────────────────────────────────────────
function Icon({ name, className = "", style }: { name: string; className?: string; style?: React.CSSProperties }) {
  return <span className={`material-symbols-outlined select-none ${className}`} style={style}>{name}</span>;
}

// ─── Animated EEG Chart (Real-time data version) ──────────────────────────
function EEGChart({ fp1, fp2, isConnected }: { fp1: number[]; fp2: number[]; isConnected: boolean }) {
  const generatePath = useCallback((data: number[], height: number) => {
    if (data.length === 0) return "";
    const W = 500;
    const mid = height / 2;
    const points: string[] = [];

    data.forEach((val, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = mid + (val * (height * 0.4));
      points.push(i === 0 ? `M${x},${y.toFixed(1)}` : `L${x},${y.toFixed(1)}`);
    });

    return points.join(" ");
  }, []);

  const f1Path = generatePath(fp1, 100);
  const f2Path = generatePath(fp2, 100);

  return (
    <div className="relative h-[240px] w-full bg-black/20 rounded-lg overflow-hidden border border-white/5 p-4">
      <svg className="w-full h-full" viewBox="0 0 500 200" preserveAspectRatio="none">
        <defs>
          <pattern id="grid" width="50" height="40" patternUnits="userSpaceOnUse">
            <path d="M0 40 L50 40 M50 0 L50 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="500" height="200" fill="url(#grid)" />

        {/* Channel 1 (Teal) */}
        <g transform="translate(0, 100)">
          <path d={f1Path} fill="none" stroke="#13ecb6" strokeWidth="2" opacity="0.8" />
        </g>

        {/* Channel 2 (Blue/Overlay) */}
        <g transform="translate(0, 100)">
          <path d={f2Path} fill="none" stroke="#60a5fa" strokeWidth="2" opacity="0.6" />
        </g>
      </svg>

      {/* Time markers */}
      <div className="absolute bottom-3 left-0 right-0 flex justify-between px-5 text-[10px] font-bold text-[#92c9bb]">
        <span>-60s</span>
        <span>-45s</span>
        <span>-30s</span>
        <span>-15s</span>
        <span className="text-primary">NOW</span>
      </div>

      {/* Disconnected overlay */}
      {!isConnected && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="text-center text-[#92c9bb]">
            <Icon name="signal_disconnected" className="text-5xl opacity-30 block mx-auto mb-2" />
            <p className="text-xs font-semibold opacity-60">No hardware signal</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stress Gauge ────────────────────────────────────────────────────────
function StressGauge({ value = 42 }: { value?: number }) {
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative size-44 mb-4">
        <svg className="size-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
          <circle cx="50" cy="50" r={radius} fill="none" stroke="#13ecb6" strokeWidth="8" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1s ease", filter: "drop-shadow(0 0 6px #13ecb6)" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-black text-white">{value.toFixed(0)}%</span>
          <span className="text-[10px] uppercase font-bold text-[#92c9bb]">Confidence</span>
        </div>
      </div>
    </div>
  );
}

// ─── Post-Session Result View functionality has been moved to right column widget

// ─── Analytics Tab (Aggregated Trends) ────────────────────────────────────
function TrendAnalyticsView({ userId }: { userId?: string }) {
  const { data: chartData, isLoading } = useAnalytics(userId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-black tracking-tight">Analytics Trends</h2>
        <p className="text-[#92c9bb]">Loading analytics...</p>
      </div>
    );
  }

  if (!Array.isArray(chartData) || chartData.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-black tracking-tight">Analytics Trends</h2>
        <p className="text-[#92c9bb]">Not enough data yet. Complete your first session to generate trend analytics!</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      <h2 className="text-3xl font-black tracking-tight">Trend Analytics</h2>
      <p className="text-[#92c9bb]">AI Confidence & Risk Scores over all recorded sessions</p>

      <div className="h-[400px] w-full p-6 rounded-xl bg-[#162c26] border border-[#32675a]">
        {Array.isArray(chartData) && chartData.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#32675a" vertical={false} />
              <XAxis dataKey="date" stroke="#92c9bb" tick={{ fill: '#92c9bb', fontSize: 12 }} dy={10} />
              <YAxis stroke="#92c9bb" tick={{ fill: '#92c9bb', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0b1714', border: '1px solid #13ecb6', borderRadius: '8px' }}
                itemStyle={{ color: '#13ecb6' }}
                labelStyle={{ color: '#fff', fontWeight: 'bold' }}
              />
              <Line
                type="monotone"
                dataKey="confidence"
                name="Risk Confidence (%)"
                stroke="#13ecb6"
                strokeWidth={3}
                activeDot={{ r: 8, fill: '#0b1714', stroke: '#13ecb6', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function SettingsView() {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-black tracking-tight">Settings</h2>
      <p className="text-[#92c9bb]">System configuration options.</p>
    </div>
  );
}

// ─── Main Dashboard Page ──────────────────────────────────────────────────
export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeNav, setActiveNav] = useState<NavView>("dashboard");
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [patientNameInput, setPatientNameInput] = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(45);
  const [sessionPatient, setSessionPatient] = useState("Patient");
  const [showHelp, setShowHelp] = useState(false);
  const [user, setUser] = useState<any>(null);

  const getDoctorName = (email?: string) => {
    if (!email) return "Doctor";
    const prefix = email.split("@")[0];
    return prefix.charAt(0).toUpperCase() + prefix.slice(1);
  };
  const doctorName = getDoctorName(user?.email);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
    });
    return () => unsubscribe();
  }, []);

  const { data: espStatus } = useEsp32Status();
  const { data: diagnosisStatus } = useDiagnosisStatus();

  const diagData = diagnosisStatus || { verdict: "NOT_READY", confidence: 0, signal_status: "INITIALIZING", buffer_fill: 0, fp1_recent: [], fp2_recent: [], connected: false };
  const isConnected = diagData.connected || diagData.buffer_fill > 0;

  // Task 2: Connect to real-time eeg stream
  const eegStreamData = useEegStream(sessionActive && isConnected);

  const startSession = useStartSession();
  const predict = usePredict();

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (sessionActive && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
    } else if (sessionActive && timeLeft === 0) {
      setSessionActive(false);
      predict.mutate({ patientName: sessionPatient, features: [], userId: user?.uid }, {
        onSuccess: () => {
          setActiveNav("dashboard"); // Ensure we stay on dashboard to see results
        }
      });
    }
    return () => clearInterval(timer);
  }, [sessionActive, timeLeft, sessionPatient, user]);

  const triggerDownload = () => {
    window.location.href = `/api/report/download?patientName=${encodeURIComponent(sessionPatient || 'Patient')}`;
  };

  useEffect(() => {
    const progress = Math.round(diagData.buffer_fill * 100);
    if (sessionActive && progress === 100) {
      triggerDownload();
      // Ensure we don't trigger it 50 times a second if it lingers on 100
      setSessionActive(false);
      predict.mutate({ patientName: sessionPatient, features: [], userId: user?.uid }, {
        onSuccess: () => setActiveNav("dashboard")
      });
    }
  }, [diagData.buffer_fill, sessionActive]);

  const handleStartSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientNameInput.trim()) return;
    startSession.mutate(patientNameInput.trim(), {
      onSuccess: () => {
        setSessionPatient(patientNameInput.trim());
        setTimeLeft(45);
        setSessionActive(true);
        setShowSessionModal(false);
        setPatientNameInput("");
      },
    });
  };

  const handleEndSession = () => {
    setSessionActive(false);
    toast({ title: "Session Ended", description: "Diagnostic session has been closed manually." });
  };

  const handleLogout = () => {
    signOut(auth).then(() => setLocation("/login"));
  };

  const handleDownloadZip = async () => {
    try {
      if (!sessionPatient) return;
      toast({ title: "Preparing Download", description: "Generating NeuroGuard ZIP report..." });
      const response = await fetch(`/api/report/download?patientName=${encodeURIComponent(sessionPatient)}`);
      if (!response.ok) throw new Error("Failed to download report");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `NeuroGuard_Report_${sessionPatient}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: "Download Started", description: "Your report is successfully downloading." });
    } catch (err) {
      toast({ title: "Download Failed", description: "Could not bundle patient ZIP report.", variant: "destructive" });
    }
  };

  const navItems: { id: NavView; icon: string; label: string }[] = [
    { id: "dashboard", icon: "dashboard", label: "Dashboard" },
    { id: "history", icon: "history", label: "History" },
    { id: "analytics", icon: "analytics", label: "Analytics" },
    { id: "settings", icon: "settings", label: "Settings" },
  ];

  return (
    <div className="flex h-screen overflow-hidden text-white" style={{ fontFamily: "'Space Grotesk', sans-serif", background: "#10221d" }}>
      <aside className="w-64 flex flex-col shrink-0 border-r border-[#1e3d35]" style={{ background: "#0b1714" }}>
        <div className="p-6 flex flex-col h-full">
          <div className="flex items-center gap-3 mb-10">
            <div className="size-12 rounded-full border-2 shrink-0 flex items-center justify-center text-xl font-bold"
              style={{ borderColor: "#13ecb6", background: "linear-gradient(135deg, #13ecb6 0%, #0a9e7a 100%)", color: "#0b1714" }}>
              {doctorName.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0">
              <h2 className="text-sm font-bold truncate">{doctorName}</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="size-2 rounded-full shrink-0" style={{ background: isConnected ? "#13ecb6" : "#666", boxShadow: isConnected ? "0 0 6px #13ecb6" : "none", animation: isConnected ? "pulse 2s infinite" : "none" }} />
                <span className="text-xs" style={{ color: isConnected ? "#13ecb6" : "#92c9bb" }}>
                  System: {isConnected ? (sessionActive ? "Active" : "Ready") : "Offline"}
                </span>
              </div>
            </div>
          </div>

          <nav className="flex flex-col gap-1 grow">
            {navItems.map((item) => (
              <button key={item.id} onClick={() => setActiveNav(item.id)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all w-full text-left"
                style={activeNav === item.id ? { background: "rgba(19, 236, 182, 0.1)", borderLeft: "3px solid #13ecb6", color: "#13ecb6", paddingLeft: "9px" } : { color: "#92c9bb" }}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="flex flex-col gap-3 mt-auto">
            <button onClick={() => setShowSessionModal(true)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all"
              style={{ background: "#13ecb6", color: "#0b1714", boxShadow: "0 0 18px rgba(19,236,182,0.35)" }}>
              <Icon name="play_circle" />
              <span>Start Session</span>
            </button>
            <button className="bg-purple-600 text-white p-3 rounded-lg mt-4 w-full" onClick={handleDownloadZip}>
              Download NeuroGuard ZIP
            </button>
            <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2 text-red-400 text-xs font-medium rounded-lg hover:bg-red-500/5 transition-all w-full">
              <Icon name="logout" className="text-[20px]" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8" style={{ background: "#10221d" }}>
        <div className="max-w-6xl mx-auto space-y-7">
          {activeNav === "dashboard" && (
            <>
              <div className="flex flex-wrap justify-between items-end gap-4">
                <div>
                  <h1 className="text-4xl font-black tracking-tight">Welcome, {doctorName}</h1>
                  <p className="text-[#92c9bb] text-lg mt-1">{sessionActive ? "Live diagnostic session in progress." : "Select a patient to begin analysis."}</p>
                </div>
                {sessionActive && (
                  <button onClick={handleEndSession} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all bg-[#23483f] text-white">
                    <Icon name="stop_circle" className="text-[20px]" />
                    End Session ({timeLeft}s)
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 flex flex-col gap-4">
                  <div className="rounded-xl p-6 bg-[#162c26] border border-[#32675a]">
                    <div className="flex justify-between items-center mb-5">
                      <div>
                        <h3 className="text-lg font-bold">EEG Telemetry</h3>
                        <p className="text-xs text-[#92c9bb]">Live dual-channel feed</p>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase"
                        style={{ background: diagData.signal_status === "STABLE" ? "rgba(19,236,182,0.1)" : "rgba(239,68,68,0.1)", color: diagData.signal_status === "STABLE" ? "#13ecb6" : "#f87171" }}>
                        <span className="size-2 rounded-full" style={{ background: diagData.signal_status === "STABLE" ? "#13ecb6" : "#ef4444", animation: diagData.signal_status === "STABLE" ? "pulse 2s infinite" : "none" }} />
                        {diagData.signal_status}
                      </div>
                    </div>
                    {/* Use streaming data if available, fallback to recent buffer slice */}
                    <EEGChart
                      fp1={eegStreamData.fp1.length > 0 ? eegStreamData.fp1 : diagData.fp1_recent}
                      fp2={eegStreamData.fp2.length > 0 ? eegStreamData.fp2 : diagData.fp2_recent}
                      isConnected={isConnected}
                    />
                    <div className="mt-5 flex justify-between items-center">
                      <div className="flex gap-8">
                        <div>
                          <p className="text-[10px] uppercase font-bold text-[#92c9bb] tracking-wider">Buffer Fill</p>
                          <p className="text-lg font-bold">{(diagData.buffer_fill * 100).toFixed(0)}%</p>
                        </div>
                      </div>
                      <div className="text-right text-[10px] text-[#92c9bb]">
                        <p>Fp1: Teal | Fp2: Blue</p>
                        <p>Sample Rate: 128Hz</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-5">
                  <div className="p-5 rounded-xl bg-[#162c26] border border-[#32675a]">
                    <p className="text-sm font-semibold text-[#92c9bb] mb-4">Current Verdict</p>
                    <div className="px-4 py-2 rounded-lg font-bold text-base flex items-center gap-2"
                      style={{ background: diagData.verdict === "HIGH RISK" ? "rgba(239,68,68,0.15)" : "rgba(19,236,182,0.15)", color: diagData.verdict === "HIGH RISK" ? "#f87171" : "#13ecb6" }}>
                      <Icon name={diagData.verdict === "HIGH RISK" ? "warning" : "check_circle"} />
                      {diagData.verdict}
                    </div>
                  </div>
                  <div className="p-5 rounded-xl bg-[#162c26] border border-[#32675a] flex items-center justify-center flex-1">
                    <StressGauge value={diagData.confidence * 100} />
                  </div>
                  <div className="p-5 rounded-xl bg-gradient-to-br from-[#19332d] to-[#10221d] border border-[#13ecb640]">
                    <div className="flex items-center gap-2 mb-3 text-[#13ecb6]">
                      <Icon name="smart_toy" />
                      <span className="text-[10px] font-black uppercase tracking-widest">AI Insights</span>
                    </div>
                    <p className="text-white text-sm italic">"Signal quality is {diagData.signal_status.toLowerCase()}. Analysis updated every 5 seconds."</p>
                  </div>

                  {!sessionActive && predict.data && (
                    <div className="p-5 rounded-xl border border-[#32675a] bg-gradient-to-br from-[#162c26] to-[#0b1714] animate-in fade-in slide-in-from-right-4 duration-700">
                      <h3 className="text-lg font-bold mb-4 text-white">Analysis Results</h3>
                      <div className="flex flex-col gap-4">
                        <div className="flex justify-between items-center bg-black/20 p-3 rounded-lg border border-white/5">
                          <span className="text-xs font-bold text-[#92c9bb] tracking-tight uppercase">Status Text</span>
                          <span className={`text-base font-black ${predict.data.status_text === "HIGH RISK" ? "text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.4)]" : "text-[#13ecb6] drop-shadow-[0_0_8px_rgba(19,236,182,0.4)]"}`}>
                            {predict.data.status_text}
                          </span>
                        </div>
                        <div className="flex justify-between items-center bg-black/20 p-3 rounded-lg border border-white/5">
                          <span className="text-xs font-bold text-[#92c9bb] tracking-tight uppercase">MCI Probability</span>
                          <span className="text-lg font-black text-white">
                            {predict.data.mci_probability?.toFixed(1) || (predict.data.confidence * 100).toFixed(1)}%
                          </span>
                        </div>
                        {/* Download CSV — prefer signed URL from Firebase Storage, fallback to ZIP */}
                        {predict.data.csv_url ? (
                          <a
                            href={predict.data.csv_url}
                            download
                            className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all bg-[#13ecb6] text-[#0b1714] hover:bg-white hover:scale-[1.02] shadow-[0_0_15px_rgba(19,236,182,0.2)]"
                          >
                            <span className="material-symbols-outlined text-[18px]">download</span>
                            Download CSV
                          </a>
                        ) : (
                          <button
                            onClick={handleDownloadZip}
                            className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all bg-[#13ecb6] text-[#0b1714] hover:bg-white hover:scale-[1.02] shadow-[0_0_15px_rgba(19,236,182,0.2)]"
                          >
                            <span className="material-symbols-outlined text-[18px]">download</span> Download Report (ZIP)
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {activeNav === "history" && (
            <div className="space-y-6">
              <h2 className="text-3xl font-black tracking-tight">Patient History</h2>
              <PatientLookup userId={user?.uid} />
            </div>
          )}
          {activeNav === "analytics" && <TrendAnalyticsView userId={user?.uid} />}
          {activeNav === "settings" && <SettingsView />}
        </div>
      </main>

      {showSessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setShowSessionModal(false); }}>
          <div className="w-full max-w-md rounded-2xl p-7 relative bg-[#162c26] border border-[#13ecb640]">
            <button onClick={() => setShowSessionModal(false)} className="absolute top-4 right-4 text-[#92c9bb] hover:text-white"><Icon name="close" /></button>
            <h3 className="text-xl font-black mb-6">New Session</h3>
            {!isConnected && <div className="p-4 rounded-xl mb-5 bg-red-500/10 border border-red-500/20 text-red-400 text-sm">Hardware offline. Check ESP32 connection.</div>}
            <form onSubmit={handleStartSession} className="space-y-4">
              <input type="text" placeholder="Patient Name" value={patientNameInput} onChange={(e) => setPatientNameInput(e.target.value)}
                className="w-full h-12 px-4 rounded-xl bg-black/30 border border-[#13ecb640] text-white outline-none focus:border-[#13ecb6]" />
              <button type="submit" disabled={!patientNameInput.trim() || !isConnected} className="w-full h-12 rounded-xl bg-[#13ecb6] text-[#0b1714] font-black disabled:opacity-40">Start Session</button>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.1); } }
      `}</style>
    </div>
  );
}
