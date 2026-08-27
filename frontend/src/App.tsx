import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar.tsx";
import SetupWizard from "./pages/SetupWizard.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Settings from "./pages/Settings.tsx";
import { useAppStore } from "./stores/appStore.ts";
import { X, CheckCircle, AlertTriangle, Info } from "lucide-react";

function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts);
  const removeToast = useAppStore((s) => s.removeToast);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-xl backdrop-blur-xl text-sm font-medium ${
            t.type === "success"
              ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-100"
              : t.type === "error"
                ? "bg-red-500/15 border-red-500/30 text-red-100"
                : "bg-zinc-800 border-zinc-700 text-zinc-100"
          }`}
          role="alert"
        >
          <span className="mt-0.5">
            {t.type === "success" ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : t.type === "error" ? <AlertTriangle className="h-4 w-4 text-red-400" /> : <Info className="h-4 w-4 text-zinc-400" />}
          </span>
          <span className="flex-1 leading-snug">{t.message}</span>
          <button onClick={() => removeToast(t.id)} className="text-zinc-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-zinc-800/50 py-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-zinc-500">
        <span>© 2026 TikTub • Automatisation TikTok → YouTube Shorts</span>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> API: <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-300">/api</code> → 3001
        </span>
      </div>
    </footer>
  );
}

export default function App() {
  const location = useLocation();
  // background gradients
  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* bg gradients */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 -right-32 h-[480px] w-[480px] rounded-full blur-[120px] opacity-20" style={{ background: "radial-gradient(circle at center, #7c3aed 0%, transparent 70%)" }} />
        <div className="absolute -bottom-32 -left-32 h-[520px] w-[520px] rounded-full blur-[120px] opacity-15" style={{ background: "radial-gradient(circle at center, #ec4899 0%, transparent 70%)" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[800px] rounded-full blur-[140px] opacity-[0.07]" style={{ background: "radial-gradient(circle at center, #f59e0b 0%, transparent 70%)" }} />
      </div>

      <Navbar />
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Routes>
          <Route path="/" element={<SetupWizard />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace state={{ from: location }} />} />
        </Routes>
      </main>
      <Footer />
      <ToastContainer />
    </div>
  );
}
