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
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <Clock className="h-4 w-4 text-violet-400" /> Délai entre publications
        </label>
        <span className="rounded-full bg-violet-600/20 border border-violet-500/30 px-3 py-1 text-xs font-bold text-violet-200">
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
      <p className="text-xs text-zinc-500">
        Le pipeline publiera une vidéo toutes les <b className="text-zinc-300">{formatDelay(value)}</b> pour espacer les uploads et éviter le spam.
      </p>
    </div>
  );
}
