import { useState, useEffect, useCallback } from "react";
import { Database, Search, RefreshCw, Check, ChevronRight } from "lucide-react";
import { fetchSignals, type StoredSignal } from "@/lib/signal-db";

interface SignalDBBrowserProps {
  onSelectSignal: (signal: StoredSignal) => void;
  selectedId?: string;
}

export function SignalDBBrowser({ onSelectSignal, selectedId }: SignalDBBrowserProps) {
  const [signals, setSignals] = useState<StoredSignal[]>([]);
  const [search, setSearch] = useState("");
  const [sfFilter, setSfFilter] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchSignals(search || undefined, sfFilter);
    setSignals(data);
    setLoading(false);
  }, [search, sfFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="chart-panel flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2">
        <Database className="w-4 h-4 text-signal-amber" />
        <h3 className="text-xs font-mono font-semibold text-signal-amber">
          Выбор сигнала из БД
        </h3>
        <button onClick={load} className="ml-auto p-1 rounded hover:bg-secondary transition-colors">
          <RefreshCw className={`w-3 h-3 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex gap-1.5 mb-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск..."
            className="w-full bg-secondary text-secondary-foreground rounded pl-7 pr-2 py-1 text-[10px] font-mono border border-border focus:ring-1 focus:ring-ring outline-none" />
        </div>
        <select value={sfFilter ?? ""} onChange={e => setSfFilter(e.target.value ? Number(e.target.value) : undefined)}
          className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-[10px] font-mono border border-border">
          <option value="">SF</option>
          {[7, 8, 9, 10, 11, 12].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
        {signals.length === 0 && (
          <p className="text-[10px] text-muted-foreground text-center py-4 font-mono">
            {loading ? "Загрузка..." : "Нет сигналов"}
          </p>
        )}
        {signals.map(sig => (
          <div key={sig.id}
            onClick={() => onSelectSignal(sig)}
            className={`group flex items-center gap-2 p-1.5 rounded border cursor-pointer transition-all text-[10px] font-mono ${
              selectedId === sig.id
                ? "border-signal-green/50 bg-signal-green/10"
                : "border-border/50 hover:border-signal-cyan/30 hover:bg-secondary/50"
            }`}>
            {selectedId === sig.id ? (
              <Check className="w-3 h-3 text-signal-green shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-foreground truncate">{sig.message_text}</p>
              <p className="text-[8px] text-muted-foreground">
                SF{sig.sf} · {sig.bw / 1000}кГц · {sig.n_symbols}сим · {(sig.duration * 1000).toFixed(1)}мс
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 text-[8px] font-mono text-muted-foreground text-center">
        {signals.length} сигналов
      </div>
    </div>
  );
}
