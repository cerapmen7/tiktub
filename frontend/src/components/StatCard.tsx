import type { ReactNode } from "react";

type Props = {
  icon: ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string; // tailwind gradient
};

export default function StatCard({ icon, label, value, sub, accent }: Props) {
  return (
    <div className="card relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.06]" style={{ background: accent || "linear-gradient(135deg,#7c3aed,#ec4899)" }} />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest uppercase text-zinc-500">{label}</p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-white">{value}</p>
          {sub && <p className="mt-1 text-xs text-zinc-400">{sub}</p>}
        </div>
        <div className="h-10 w-10 rounded-xl bg-zinc-800 border border-zinc-700 grid place-items-center text-zinc-300">
          {icon}
        </div>
      </div>
    </div>
  );
}
