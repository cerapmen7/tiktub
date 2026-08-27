type Props = {
  current: number; // 1-indexed
  total: number;
  className?: string;
};

export default function ProgressBar({ current, total, className }: Props) {
  const pct = Math.round((current / total) * 100);
  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-zinc-400">
          Étape {current} / {total}
        </span>
        <span className="text-xs font-semibold text-violet-300">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #7c3aed 0%, #ec4899 100%)",
          }}
        />
      </div>
      <div className="mt-3 flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => {
          const active = i + 1 <= current;
          const isCurrent = i + 1 === current;
          return (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-all ${
                active ? "bg-violet-500" : "bg-zinc-800"
              } ${isCurrent ? "ring-2 ring-violet-500/30 ring-offset-1 ring-offset-[#0a0a0f]" : ""}`}
            />
          );
        })}
      </div>
    </div>
  );
}
