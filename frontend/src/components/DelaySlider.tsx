import { Clock } from "lucide-react";
import { formatDelay } from "../stores/appStore.ts";

type Props = {
  value: number; // minutes
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
};

export default function DelaySlider({ value, onChange, min = 15, max = 48 * 60, step = 15 }: Props) {
  const now = new Date();
  const fmtTime = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const t1 = new Date(now.getTime());
  const t2 = new Date(now.getTime() + value * 60 * 1000);
  const t3 = new Date(now.getTime() + value * 2 * 60 * 1000);
  return (
    <div className="space-y-4 rounded-2xl bg-zinc-900/50 border border-zinc-800 p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-semibold text-zinc-100 font-display">
          <span className="h-7 w-7 rounded-lg bg-violet-500/15 border border-violet-500/20 grid place-items-center">
            <Clock className="h-3.5 w-3.5 text-violet-400" />
          </span>
          Délai entre publications
        </label>
        <span className="rounded-full bg-gradient-to-r from-violet-600 to-pink-500 px-3.5 py-1.5 text-xs font-bold text-white shadow-lg shadow-violet-600/20">
          {formatDelay(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        aria-label="Délai entre publications"
      />
      <div className="flex justify-between text-[11px] font-medium text-zinc-500">
        <span>15 min</span>
        <span>12h</span>
        <span>24h</span>
        <span>48h</span>
      </div>

      {/* Timeline premium - 1ère immédiate */}
      <div className="rounded-xl bg-zinc-950/60 border border-zinc-800/80 p-3.5 space-y-3">
        <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase text-violet-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Programmation YouTube
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Vidéo 1", time: fmtTime(t1), sub: "Maintenant", active: true },
            { label: "Vidéo 2", time: fmtTime(t2), sub: `+${formatDelay(value)}`, active: false },
            { label: "Vidéo 3", time: fmtTime(t3), sub: `+${formatDelay(value * 2)}`, active: false },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border p-2.5 text-center transition ${s.active ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200" : "bg-zinc-900 border-zinc-800 text-zinc-400"}`}>
              <div className="text-[11px] font-bold tracking-widest uppercase opacity-70">{s.label}</div>
              <div className="text-sm font-bold font-display">{s.time}</div>
              <div className="text-[11px] opacity-70">{s.sub}</div>
              {s.active && <div className="mt-1 inline-flex rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">DIRECT</div>}
            </div>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-zinc-400">
          <b className="text-emerald-300">1ère vidéo postée immédiatement</b>, les suivantes toutes les <b className="text-zinc-200">{formatDelay(value)}</b> via <span className="inline-flex items-center gap-1 rounded bg-red-500/15 border border-red-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-red-300">publication programmée YouTube</span> — <b className="text-violet-300">pas besoin de laisser le PC allumé</b>, YouTube publie à l'heure prévue.
        </p>
      </div>
    </div>
  );
}
