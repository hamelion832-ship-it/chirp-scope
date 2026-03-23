import { MODULATION_REGISTRY, type ModulationType } from "@/lib/modulation-engine";
import { Radio } from "lucide-react";

interface Props {
  value: ModulationType;
  onChange: (v: ModulationType) => void;
  compact?: boolean;
}

const FAMILY_COLORS: Record<string, string> = {
  CSS: "signal-green",
  PSK: "signal-cyan",
  FSK: "signal-amber",
  CDMA: "signal-magenta",
};

export function ProtocolSelector({ value, onChange, compact }: Props) {
  return (
    <div className="flex flex-wrap gap-1">
      {MODULATION_REGISTRY.map(m => {
        const color = FAMILY_COLORS[m.family] || "signal-green";
        const active = value === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            title={m.description}
            className={`flex items-center gap-1 font-mono border rounded transition-all ${
              compact ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-1"
            } ${
              active
                ? `bg-${color}/20 text-${color} border-${color}/40`
                : "bg-secondary text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {!compact && <Radio className="w-2.5 h-2.5" />}
            {m.name}
          </button>
        );
      })}
    </div>
  );
}
