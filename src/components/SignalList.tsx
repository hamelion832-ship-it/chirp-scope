import { useState, useEffect } from "react";
import { Search, Trash2, Database, RefreshCw } from "lucide-react";
import { fetchSignals, deleteSignal, type StoredSignal } from "@/lib/signal-db";
import { getProtocolGroup } from "@/lib/protocol-classify";
import type { ModulationType } from "@/lib/modulation-engine";

interface SignalListProps {
  onSelect: (signal: StoredSignal) => void;
  refreshKey: number;
}

export function SignalList({ onSelect, refreshKey }: SignalListProps) {
  const [signals, setSignals] = useState<StoredSignal[]>([]);
  const [search, setSearch] = useState("");
  const [sfFilter, setSfFilter] = useState<number | undefined>();
  const [modFilter, setModFilter] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await fetchSignals(search || undefined, sfFilter, modFilter);
    setSignals(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [search, sfFilter, modFilter, refreshKey]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Удалить сигнал?")) {
      await deleteSignal(id);
      load();
    }
  };

  return (
    <div className="chart-panel flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <Database className="w-4 h-4 text-signal-amber" />
        <h3 className="text-xs font-mono font-semibold text-signal-amber">
          База данных сигналов
        </h3>
        <button onClick={load} className="ml-auto p-1 rounded hover:bg-secondary transition-colors">
          <RefreshCw className={`w-3 h-3 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex gap-1.5 mb-2 flex-wrap">
        <div className="flex-1 relative min-w-[100px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск..."
            className="w-full bg-secondary text-secondary-foreground rounded pl-7 pr-2 py-1 text-[11px] font-mono border border-border focus:ring-1 focus:ring-ring outline-none"
          />
        </div>
        <select
          value={sfFilter ?? ""}
          onChange={e => setSfFilter(e.target.value ? Number(e.target.value) : undefined)}
          className="bg-secondary text-secondary-foreground rounded px-1.5 py-1 text-[10px] font-mono border border-border"
        >
          <option value="">SF</option>
          {[7, 8, 9, 10, 11, 12].map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <select
          value={modFilter ?? ""}
          onChange={e => setModFilter(e.target.value || undefined)}
          className="bg-secondary text-secondary-foreground rounded px-1.5 py-1 text-[10px] font-mono border border-border"
        >
          <option value="">Все</option>
          {["lora", "bpsk", "qpsk", "8psk", "2fsk", "4fsk", "cdma"].map(v => (
            <option key={v} value={v}>{v.toUpperCase()}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
        {signals.length === 0 && (
          <p className="text-[10px] text-muted-foreground text-center py-4 font-mono">
            {loading ? "Загрузка..." : "Нет сохранённых сигналов"}
          </p>
        )}
        {signals.map(sig => {
          const mt = (sig.mod_type || "lora") as ModulationType;
          const g = getProtocolGroup(mt);
          const isLoRa = mt === "lora";
          return (
            <div
              key={sig.id}
              className="group flex items-start gap-2 p-2 rounded border border-border/50 hover:border-signal-green/30 hover:bg-secondary/50 cursor-pointer transition-all"
              onClick={() => onSelect(sig)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-mono text-foreground truncate">{sig.message_text}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-[8px] font-mono px-1 py-0.5 rounded border bg-${g.color}/10 text-${g.color} border-${g.color}/20 uppercase`}>
                    {mt}
                  </span>
                  {isLoRa && (
                    <span className="text-[9px] font-mono text-muted-foreground">
                      SF{sig.sf} · {sig.bw / 1000}кГц
                    </span>
                  )}
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {sig.n_symbols}сим · {(sig.duration * 1000).toFixed(1)}мс
                  </span>
                  {sig.encryption_type && sig.encryption_type !== "none" && (
                    <span className="text-[8px] font-mono px-1 py-0.5 rounded border bg-signal-amber/10 text-signal-amber border-signal-amber/20">
                      🔒{sig.encryption_type}
                    </span>
                  )}
                  {sig.tags && <span className="text-[8px] text-signal-cyan">#{sig.tags}</span>}
                </div>
              </div>
              <button
                onClick={e => handleDelete(sig.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/20 transition-all"
              >
                <Trash2 className="w-3 h-3 text-destructive" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[9px] font-mono text-muted-foreground text-center">
        {signals.length} сигналов в базе
      </div>
    </div>
  );
}
