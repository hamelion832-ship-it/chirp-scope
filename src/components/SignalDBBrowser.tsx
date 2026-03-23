import { useState, useEffect, useCallback } from "react";
import { Database, Search, RefreshCw, Check, ChevronRight } from "lucide-react";
import { fetchSignals, type StoredSignal } from "@/lib/signal-db";
import { getProtocolGroup } from "@/lib/protocol-classify";
import type { ModulationType } from "@/lib/modulation-engine";

interface SignalDBBrowserProps {
  onSelectSignal?: (signal: StoredSignal) => void;
  selectedId?: string;
  multiSelect?: boolean;
  selectedIds?: string[];
  onToggleSignal?: (signal: StoredSignal) => void;
}

export function SignalDBBrowser({ onSelectSignal, selectedId, multiSelect, selectedIds, onToggleSignal }: SignalDBBrowserProps) {
  const [signals, setSignals] = useState<StoredSignal[]>([]);
  const [search, setSearch] = useState("");
  const [sfFilter, setSfFilter] = useState<number | undefined>();
  const [modFilter, setModFilter] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchSignals(search || undefined, sfFilter, modFilter);
    setSignals(data);
    setLoading(false);
  }, [search, sfFilter, modFilter]);

  useEffect(() => { load(); }, [load]);

  const isSelected = (id: string) => {
    if (multiSelect) return selectedIds?.includes(id) ?? false;
    return selectedId === id;
  };

  const handleClick = (sig: StoredSignal) => {
    if (multiSelect && onToggleSignal) {
      onToggleSignal(sig);
    } else if (onSelectSignal) {
      onSelectSignal(sig);
    }
  };

  return (
    <div className="chart-panel flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2">
        <Database className="w-4 h-4 text-signal-amber" />
        <h3 className="text-xs font-mono font-semibold text-signal-amber">
          {multiSelect ? "Выбор сигналов из БД" : "Выбор сигнала из БД"}
        </h3>
        {multiSelect && selectedIds && selectedIds.length > 0 && (
          <span className="text-[9px] font-mono text-signal-green bg-signal-green/10 px-1.5 py-0.5 rounded">
            {selectedIds.length} выбр.
          </span>
        )}
        {multiSelect && (
          <>
            <button onClick={() => { signals.forEach(sig => { if (!selectedIds?.includes(sig.id)) onToggleSignal?.(sig); }); }}
              className="text-[9px] font-mono text-muted-foreground hover:text-foreground underline ml-auto">Все</button>
            <button onClick={() => { signals.forEach(sig => { if (selectedIds?.includes(sig.id)) onToggleSignal?.(sig); }); }}
              className="text-[9px] font-mono text-muted-foreground hover:text-foreground underline">Сброс</button>
          </>
        )}
        <button onClick={load} className={`${!multiSelect ? 'ml-auto' : ''} p-1 rounded hover:bg-secondary transition-colors`}>
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
          className="bg-secondary text-secondary-foreground rounded px-1.5 py-1 text-[10px] font-mono border border-border">
          <option value="">SF</option>
          {[7, 8, 9, 10, 11, 12].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={modFilter ?? ""} onChange={e => setModFilter(e.target.value || undefined)}
          className="bg-secondary text-secondary-foreground rounded px-1.5 py-1 text-[10px] font-mono border border-border">
          <option value="">Все</option>
          {["lora", "bpsk", "qpsk", "8psk", "2fsk", "4fsk", "cdma"].map(v => (
            <option key={v} value={v}>{v.toUpperCase()}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
        {signals.length === 0 && (
          <p className="text-[10px] text-muted-foreground text-center py-4 font-mono">
            {loading ? "Загрузка..." : "Нет сигналов"}
          </p>
        )}
        {signals.map(sig => {
          const mt = (sig.mod_type || "lora") as ModulationType;
          const g = getProtocolGroup(mt);
          const isLoRa = mt === "lora";
          return (
            <div key={sig.id}
              onClick={() => handleClick(sig)}
              className={`group flex items-center gap-2 p-1.5 rounded border cursor-pointer transition-all text-[10px] font-mono ${
                isSelected(sig.id)
                  ? "border-signal-green/50 bg-signal-green/10"
                  : "border-border/50 hover:border-signal-cyan/30 hover:bg-secondary/50"
              }`}>
              {multiSelect ? (
                <input type="checkbox" checked={isSelected(sig.id)} readOnly className="accent-signal-green w-3 h-3 shrink-0" />
              ) : isSelected(sig.id) ? (
                <Check className="w-3 h-3 text-signal-green shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-foreground truncate">{sig.message_text}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className={`text-[8px] px-1 py-0.5 rounded border bg-${g.color}/10 text-${g.color} border-${g.color}/20 uppercase`}>
                    {mt}
                  </span>
                  {isLoRa && (
                    <span className="text-[8px] text-muted-foreground">SF{sig.sf} · {sig.bw / 1000}кГц</span>
                  )}
                  <span className="text-[8px] text-muted-foreground">{sig.n_symbols}сим</span>
                  {sig.encryption_type && sig.encryption_type !== "none" && (
                    <span className="text-[8px] px-1 py-0.5 rounded border bg-signal-amber/10 text-signal-amber border-signal-amber/20">
                      🔒{sig.encryption_type}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 text-[8px] font-mono text-muted-foreground text-center">
        {signals.length} сигналов
      </div>
    </div>
  );
}
