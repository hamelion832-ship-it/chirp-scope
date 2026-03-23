import { useState, useEffect, useCallback, useMemo } from "react";
import { Database, Search, RefreshCw, Trash2, Edit3, Save, X, BarChart3, PieChart, TrendingUp, FileText, AlertTriangle, Check, Lock } from "lucide-react";
import { fetchSignals, deleteSignal, getSignalStats, type StoredSignal } from "@/lib/signal-db";
import { getProtocolGroup, PROTOCOL_CHART_COLORS } from "@/lib/protocol-classify";
import type { ModulationType } from "@/lib/modulation-engine";
import { ENCRYPTION_REGISTRY } from "@/lib/encryption-engine";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart as RPieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";

const COLORS = [
  "hsl(142 70% 38%)", "hsl(185 85% 38%)", "hsl(35 92% 48%)",
  "hsl(300 65% 48%)", "hsl(220 80% 50%)", "hsl(0 80% 50%)",
];

export function DatabasePanel() {
  const [signals, setSignals] = useState<StoredSignal[]>([]);
  const [search, setSearch] = useState("");
  const [sfFilter, setSfFilter] = useState<number | undefined>();
  const [modFilter, setModFilter] = useState<string | undefined>();
  const [encFilter, setEncFilter] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<StoredSignal>>({});
  const [view, setView] = useState<"table" | "stats">("table");
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getSignalStats>>>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const [data, s] = await Promise.all([
      fetchSignals(search || undefined, sfFilter, modFilter, encFilter),
      getSignalStats(),
    ]);
    setSignals(data);
    setStats(s);
    setLoading(false);
  }, [search, sfFilter, modFilter, encFilter]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Удалить сигнал?")) return;
    const ok = await deleteSignal(id);
    if (ok) { toast.success("Удалено"); load(); }
    else toast.error("Ошибка удаления");
  }, [load]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Удалить ${selectedIds.size} сигналов?`)) return;
    let ok = 0;
    for (const id of selectedIds) {
      if (await deleteSignal(id)) ok++;
    }
    toast.success(`Удалено: ${ok}`);
    setSelectedIds(new Set());
    load();
  }, [selectedIds, load]);

  const startEdit = (sig: StoredSignal) => {
    setEditingId(sig.id);
    setEditData({ message_text: sig.message_text, tags: sig.tags, sf: sig.sf, bw: sig.bw, cr: sig.cr, mod_type: sig.mod_type });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const { error } = await supabase.from("signals").update({
      message_text: editData.message_text,
      tags: editData.tags,
      sf: editData.sf,
      bw: editData.bw,
      cr: editData.cr,
      mod_type: editData.mod_type,
    } as any).eq("id", editingId);
    if (error) { toast.error("Ошибка: " + error.message); return; }
    toast.success("Обновлено");
    setEditingId(null);
    load();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const selectAll = () => setSelectedIds(new Set(signals.map(s => s.id)));
  const deselectAll = () => setSelectedIds(new Set());

  // Stats data
  const sfData = useMemo(() => {
    if (!stats?.sfCounts) return [];
    return Object.entries(stats.sfCounts).map(([k, v]) => ({ name: `SF${k}`, count: v }));
  }, [stats]);

  const bwData = useMemo(() => {
    if (!stats?.bwCounts) return [];
    return Object.entries(stats.bwCounts).map(([k, v]) => ({ name: `${Number(k) / 1000}к`, count: v }));
  }, [stats]);

  const modTypeData = useMemo(() => {
    if (!stats?.modTypeCounts) return [];
    return Object.entries(stats.modTypeCounts).map(([k, v]) => ({
      name: k.toUpperCase(),
      count: v,
      color: PROTOCOL_CHART_COLORS[k] ?? "hsl(215 15% 55%)",
    }));
  }, [stats]);

  const encTypeData = useMemo(() => {
    if (!stats?.encryptionCounts) return [];
    return Object.entries(stats.encryptionCounts).map(([k, v]) => ({
      name: ENCRYPTION_REGISTRY.find(e => e.id === k)?.name ?? k,
      count: v,
    }));
  }, [stats]);

  const tagData = useMemo(() => {
    const tc: Record<string, number> = {};
    for (const sig of signals) {
      const t = sig.tags?.trim();
      if (t) {
        t.split(",").forEach(tag => {
          const k = tag.trim();
          if (k) tc[k] = (tc[k] || 0) + 1;
        });
      } else {
        tc["без тегов"] = (tc["без тегов"] || 0) + 1;
      }
    }
    return Object.entries(tc).map(([name, value]) => ({ name, value }));
  }, [signals]);

  const lengthDistribution = useMemo(() => {
    const buckets: Record<string, number> = { "1-10": 0, "11-50": 0, "51-200": 0, "201-500": 0, "500+": 0 };
    for (const s of signals) {
      if (s.message_length <= 10) buckets["1-10"]++;
      else if (s.message_length <= 50) buckets["11-50"]++;
      else if (s.message_length <= 200) buckets["51-200"]++;
      else if (s.message_length <= 500) buckets["201-500"]++;
      else buckets["500+"]++;
    }
    return Object.entries(buckets).map(([name, count]) => ({ name, count }));
  }, [signals]);

  const durationStats = useMemo(() => {
    if (signals.length === 0) return [];
    return signals.slice(0, 50).map((s, i) => ({
      idx: i + 1,
      duration: +(s.duration * 1000).toFixed(1),
      symbols: s.n_symbols,
    }));
  }, [signals]);

  const chartLabelStyle = { fontSize: 10, fontFamily: "monospace", fill: "hsl(215 15% 55%)" };
  const chartGridColor = "hsl(220 13% 90%)";

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="chart-panel flex flex-wrap items-center gap-2">
        <Database className="w-4 h-4 text-signal-green" />
        <h3 className="text-xs font-mono font-semibold text-foreground mr-2">База данных сигналов</h3>

        <div className="flex gap-1 bg-secondary rounded-md p-0.5 border border-border">
          <button onClick={() => setView("table")}
            className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${view === "table" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <FileText className="w-3 h-3 inline mr-1" />Таблица
          </button>
          <button onClick={() => setView("stats")}
            className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${view === "stats" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <BarChart3 className="w-3 h-3 inline mr-1" />Статистика
          </button>
        </div>

        <div className="flex-1" />

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по тексту..."
            className="bg-secondary text-secondary-foreground rounded pl-7 pr-2 py-1 text-[10px] font-mono border border-border focus:ring-1 focus:ring-ring outline-none w-48" />
        </div>

        <select value={sfFilter ?? ""} onChange={e => setSfFilter(e.target.value ? Number(e.target.value) : undefined)}
          className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-[10px] font-mono border border-border">
          <option value="">Все SF</option>
          {[7, 8, 9, 10, 11, 12].map(v => <option key={v} value={v}>SF{v}</option>)}
        </select>

        <select value={modFilter ?? ""} onChange={e => setModFilter(e.target.value || undefined)}
          className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-[10px] font-mono border border-border">
          <option value="">Все протоколы</option>
          {["lora", "bpsk", "qpsk", "8psk", "2fsk", "4fsk", "cdma"].map(v => (
            <option key={v} value={v}>{v.toUpperCase()}</option>
          ))}
        </select>

        <select value={encFilter ?? ""} onChange={e => setEncFilter(e.target.value || undefined)}
          className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-[10px] font-mono border border-border">
          <option value="">Все шифр.</option>
          {ENCRYPTION_REGISTRY.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>

        <button onClick={load} className="p-1.5 rounded hover:bg-secondary transition-colors border border-border">
          <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
        </button>

        {selectedIds.size > 0 && (
          <button onClick={handleBulkDelete}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono bg-destructive/10 text-destructive border border-destructive/30 rounded hover:bg-destructive/20 transition-colors">
            <Trash2 className="w-3 h-3" /> Удалить ({selectedIds.size})
          </button>
        )}
      </div>

      {view === "table" && (
        <div className="chart-panel">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={selectedIds.size === signals.length ? deselectAll : selectAll}
              className="text-[9px] font-mono text-muted-foreground hover:text-foreground underline">
              {selectedIds.size === signals.length ? "Снять все" : "Выбрать все"}
            </button>
            <span className="text-[9px] font-mono text-muted-foreground">{signals.length} записей</span>
          </div>

          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-[10px] font-mono border-collapse">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  <th className="p-1.5 text-left text-muted-foreground font-medium w-8">
                    <input type="checkbox" checked={selectedIds.size === signals.length && signals.length > 0}
                      onChange={() => selectedIds.size === signals.length ? deselectAll() : selectAll()}
                      className="accent-signal-green w-3 h-3" />
                  </th>
                  <th className="p-1.5 text-left text-muted-foreground font-medium">Текст</th>
                  <th className="p-1.5 text-left text-muted-foreground font-medium">Протокол</th>
                  <th className="p-1.5 text-left text-muted-foreground font-medium">SF</th>
                  <th className="p-1.5 text-left text-muted-foreground font-medium">BW</th>
                  <th className="p-1.5 text-left text-muted-foreground font-medium">CR</th>
                  <th className="p-1.5 text-left text-muted-foreground font-medium">Шифр.</th>
                  <th className="p-1.5 text-left text-muted-foreground font-medium">Симв.</th>
                  <th className="p-1.5 text-left text-muted-foreground font-medium">Длит. мс</th>
                  <th className="p-1.5 text-left text-muted-foreground font-medium">Теги</th>
                  <th className="p-1.5 text-left text-muted-foreground font-medium">Дата</th>
                  <th className="p-1.5 text-center text-muted-foreground font-medium w-16">Действия</th>
                </tr>
              </thead>
              <tbody>
                {signals.length === 0 && (
                  <tr><td colSpan={12} className="text-center text-muted-foreground py-8">
                    {loading ? "Загрузка..." : "Нет данных"}
                  </td></tr>
                )}
                {signals.map(sig => (
                  <tr key={sig.id}
                    className={`border-b border-border/50 hover:bg-secondary/50 transition-colors ${selectedIds.has(sig.id) ? "bg-signal-green/5" : ""}`}>
                    <td className="p-1.5">
                      <input type="checkbox" checked={selectedIds.has(sig.id)}
                        onChange={() => toggleSelect(sig.id)}
                        className="accent-signal-green w-3 h-3" />
                    </td>
                    {editingId === sig.id ? (
                      <>
                        <td className="p-1.5">
                          <input value={editData.message_text ?? ""} onChange={e => setEditData(d => ({ ...d, message_text: e.target.value }))}
                            className="bg-secondary border border-border rounded px-1 py-0.5 w-full text-[10px]" />
                        </td>
                        <td className="p-1.5">
                          <select value={editData.mod_type ?? "lora"} onChange={e => setEditData(d => ({ ...d, mod_type: e.target.value }))}
                            className="bg-secondary border border-border rounded px-1 py-0.5 text-[10px] w-16">
                            {["lora", "bpsk", "qpsk", "8psk", "2fsk", "4fsk", "cdma"].map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
                          </select>
                        </td>
                        <td className="p-1.5">
                          <select value={editData.sf} onChange={e => setEditData(d => ({ ...d, sf: Number(e.target.value) }))}
                            className="bg-secondary border border-border rounded px-1 py-0.5 text-[10px] w-12">
                            {[7, 8, 9, 10, 11, 12].map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </td>
                        <td className="p-1.5">
                          <select value={editData.bw} onChange={e => setEditData(d => ({ ...d, bw: Number(e.target.value) }))}
                            className="bg-secondary border border-border rounded px-1 py-0.5 text-[10px] w-16">
                            {[125000, 250000, 500000].map(v => <option key={v} value={v}>{v / 1000}к</option>)}
                          </select>
                        </td>
                        <td className="p-1.5">
                          <select value={editData.cr} onChange={e => setEditData(d => ({ ...d, cr: Number(e.target.value) }))}
                            className="bg-secondary border border-border rounded px-1 py-0.5 text-[10px] w-12">
                            {[1, 2, 3, 4].map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </td>
                        <td className="p-1.5 text-muted-foreground text-[9px]">{sig.encryption_type ?? "none"}</td>
                        <td className="p-1.5 text-muted-foreground">{sig.n_symbols}</td>
                        <td className="p-1.5 text-muted-foreground">{(sig.duration * 1000).toFixed(1)}</td>
                        <td className="p-1.5">
                          <input value={editData.tags ?? ""} onChange={e => setEditData(d => ({ ...d, tags: e.target.value }))}
                            className="bg-secondary border border-border rounded px-1 py-0.5 w-full text-[10px]" />
                        </td>
                        <td className="p-1.5 text-muted-foreground">{new Date(sig.created_at).toLocaleDateString()}</td>
                        <td className="p-1.5 text-center">
                          <div className="flex gap-1 justify-center">
                            <button onClick={saveEdit} className="p-0.5 text-signal-green hover:bg-signal-green/10 rounded"><Check className="w-3 h-3" /></button>
                            <button onClick={() => setEditingId(null)} className="p-0.5 text-muted-foreground hover:bg-secondary rounded"><X className="w-3 h-3" /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="p-1.5 text-foreground max-w-[200px] truncate" title={sig.message_text}>{sig.message_text}</td>
                        <td className="p-1.5">
                          {(() => {
                            const mt = (sig.mod_type || 'lora') as ModulationType;
                            const g = getProtocolGroup(mt);
                            return <span className={`px-1 py-0.5 rounded text-[9px] uppercase bg-${g.color}/10 text-${g.color} border border-${g.color}/20`}>{mt}</span>;
                          })()}
                        </td>
                        <td className="p-1.5">
                          {(sig.mod_type || 'lora') === 'lora' 
                            ? <span className="px-1 py-0.5 bg-signal-green/10 text-signal-green rounded text-[9px]">SF{sig.sf}</span>
                            : <span className="text-muted-foreground/50">—</span>
                          }
                        </td>
                        <td className="p-1.5 text-muted-foreground">
                          {(sig.mod_type || 'lora') === 'lora' ? `${sig.bw / 1000}к` : '—'}
                        </td>
                        <td className="p-1.5 text-muted-foreground">
                          {(sig.mod_type || 'lora') === 'lora' ? sig.cr : '—'}
                        </td>
                        <td className="p-1.5">
                          {sig.encryption_type && sig.encryption_type !== "none" ? (
                            <span className="px-1 py-0.5 bg-signal-amber/10 text-signal-amber rounded text-[8px] border border-signal-amber/20">🔒{sig.encryption_type}</span>
                          ) : <span className="text-muted-foreground/50 text-[9px]">нет</span>}
                        </td>
                        <td className="p-1.5 text-muted-foreground">{sig.n_symbols}</td>
                        <td className="p-1.5 text-muted-foreground">{(sig.duration * 1000).toFixed(1)}</td>
                        <td className="p-1.5">
                          {sig.tags ? (
                            <div className="flex flex-wrap gap-0.5">
                              {sig.tags.split(",").map((t, i) => (
                                <span key={i} className="px-1 py-0.5 bg-signal-amber/10 text-signal-amber rounded text-[8px]">{t.trim()}</span>
                              ))}
                            </div>
                          ) : <span className="text-muted-foreground/50">—</span>}
                        </td>
                        <td className="p-1.5 text-muted-foreground">{new Date(sig.created_at).toLocaleDateString()}</td>
                        <td className="p-1.5 text-center">
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => startEdit(sig)} className="p-0.5 text-signal-cyan hover:bg-signal-cyan/10 rounded"><Edit3 className="w-3 h-3" /></button>
                            <button onClick={() => handleDelete(sig.id)} className="p-0.5 text-destructive hover:bg-destructive/10 rounded"><Trash2 className="w-3 h-3" /></button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "stats" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {/* Summary cards */}
          <div className="chart-panel">
            <h4 className="text-xs font-mono font-semibold text-foreground mb-3 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-signal-green" /> Общая статистика
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Всего сигналов", value: stats?.total ?? 0, color: "text-signal-green" },
                { label: "Ср. длина текста", value: stats?.avgLength?.toFixed(0) ?? "—", color: "text-signal-cyan" },
                { label: "Протоколов", value: stats?.modTypeCounts ? Object.keys(stats.modTypeCounts).length : 0, color: "text-signal-amber" },
                { label: "Типов шифр.", value: stats?.encryptionCounts ? Object.keys(stats.encryptionCounts).length : 0, color: "text-signal-magenta" },
              ].map((item, i) => (
                <div key={i} className="bg-secondary rounded-lg p-2.5 border border-border">
                  <p className="text-[9px] font-mono text-muted-foreground">{item.label}</p>
                  <p className={`text-lg font-mono font-bold ${item.color}`}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Protocol distribution */}
          <div className="chart-panel">
            <h4 className="text-xs font-mono font-semibold text-foreground mb-2">Распределение по протоколу</h4>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={modTypeData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="name" tick={chartLabelStyle} />
                <YAxis tick={chartLabelStyle} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 10, fontFamily: "monospace", background: "hsl(0 0% 98%)", border: "1px solid hsl(220 13% 90%)" }} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {modTypeData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* SF distribution bar chart */}
          <div className="chart-panel">
            <h4 className="text-xs font-mono font-semibold text-foreground mb-2">Распределение по SF</h4>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={sfData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="name" tick={chartLabelStyle} />
                <YAxis tick={chartLabelStyle} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 10, fontFamily: "monospace", background: "hsl(0 0% 98%)", border: "1px solid hsl(220 13% 90%)" }} />
                <Bar dataKey="count" fill="hsl(142 70% 38%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* BW distribution */}
          <div className="chart-panel">
            <h4 className="text-xs font-mono font-semibold text-foreground mb-2">Распределение по BW</h4>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={bwData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="name" tick={chartLabelStyle} />
                <YAxis tick={chartLabelStyle} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 10, fontFamily: "monospace", background: "hsl(0 0% 98%)", border: "1px solid hsl(220 13% 90%)" }} />
                <Bar dataKey="count" fill="hsl(185 85% 38%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Tags pie chart */}
          <div className="chart-panel">
            <h4 className="text-xs font-mono font-semibold text-foreground mb-2">Теги</h4>
            <ResponsiveContainer width="100%" height={180}>
              <RPieChart>
                <Pie data={tagData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false} style={{ fontSize: 8, fontFamily: "monospace" }}>
                  {tagData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 10, fontFamily: "monospace", background: "hsl(0 0% 98%)", border: "1px solid hsl(220 13% 90%)" }} />
              </RPieChart>
            </ResponsiveContainer>
          </div>

          {/* Message length distribution */}
          <div className="chart-panel">
            <h4 className="text-xs font-mono font-semibold text-foreground mb-2">Длина сообщений (символы)</h4>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={lengthDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="name" tick={chartLabelStyle} />
                <YAxis tick={chartLabelStyle} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 10, fontFamily: "monospace", background: "hsl(0 0% 98%)", border: "1px solid hsl(220 13% 90%)" }} />
                <Bar dataKey="count" fill="hsl(35 92% 48%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Duration vs symbols scatter */}
          <div className="chart-panel">
            <h4 className="text-xs font-mono font-semibold text-foreground mb-2">Длительность и символы (последние 50)</h4>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={durationStats}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="idx" tick={chartLabelStyle} label={{ value: "#", style: chartLabelStyle, position: "insideBottomRight", offset: -5 }} />
                <YAxis yAxisId="dur" tick={chartLabelStyle} />
                <YAxis yAxisId="sym" orientation="right" tick={chartLabelStyle} />
                <Tooltip contentStyle={{ fontSize: 10, fontFamily: "monospace", background: "hsl(0 0% 98%)", border: "1px solid hsl(220 13% 90%)" }} />
                <Legend wrapperStyle={{ fontSize: 9, fontFamily: "monospace" }} />
                <Line yAxisId="dur" type="monotone" dataKey="duration" stroke="hsl(300 65% 48%)" dot={false} name="Длит. мс" strokeWidth={1.5} />
                <Line yAxisId="sym" type="monotone" dataKey="symbols" stroke="hsl(142 70% 38%)" dot={false} name="Символы" strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
