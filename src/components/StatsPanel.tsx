import { useState, useEffect, useMemo } from "react";
import { BarChart2 } from "lucide-react";
import { getSignalStats } from "@/lib/signal-db";
import { PROTOCOL_CHART_COLORS } from "@/lib/protocol-classify";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Tooltip, Cell
} from "recharts";

interface StatsProps {
  refreshKey: number;
}

export function StatsPanel({ refreshKey }: StatsProps) {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getSignalStats>>>(null);

  useEffect(() => {
    getSignalStats().then(setStats);
  }, [refreshKey]);

  const sfData = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.sfCounts).map(([k, v]) => ({ name: `SF${k}`, count: v }));
  }, [stats]);

  const modData = useMemo(() => {
    if (!stats?.modTypeCounts) return [];
    return Object.entries(stats.modTypeCounts).map(([k, v]) => ({
      name: k.toUpperCase(),
      count: v,
      color: PROTOCOL_CHART_COLORS[k] ?? "hsl(215 15% 55%)",
    }));
  }, [stats]);

  if (!stats || stats.total === 0) {
    return (
      <div className="chart-panel flex flex-col items-center justify-center h-full">
        <BarChart2 className="w-8 h-8 text-muted-foreground/30 mb-2" />
        <p className="text-[11px] font-mono text-muted-foreground">Сохраните сигналы для статистики</p>
      </div>
    );
  }

  return (
    <div className="chart-panel flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2">
        <BarChart2 className="w-4 h-4 text-signal-cyan" />
        <h3 className="text-xs font-mono font-semibold text-signal-cyan">Статистика БД</h3>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <div className="bg-secondary rounded p-2 text-center">
          <div className="text-lg font-mono font-bold text-signal-green">{stats.total}</div>
          <div className="text-[9px] font-mono text-muted-foreground">Сигналов</div>
        </div>
        <div className="bg-secondary rounded p-2 text-center">
          <div className="text-lg font-mono font-bold text-signal-amber">{stats.avgLength.toFixed(0)}</div>
          <div className="text-[9px] font-mono text-muted-foreground">Ср. длина</div>
        </div>
        <div className="bg-secondary rounded p-2 text-center">
          <div className="text-lg font-mono font-bold text-signal-cyan">{Object.keys(stats.modTypeCounts).length}</div>
          <div className="text-[9px] font-mono text-muted-foreground">Протоколов</div>
        </div>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-2">
        <div>
          <p className="text-[9px] font-mono text-muted-foreground mb-1">По протоколу</p>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={modData}>
              <CartesianGrid stroke="hsl(220 13% 90%)" strokeDasharray="2 4" />
              <XAxis dataKey="name" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
              <YAxis tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} width={20} />
              <Tooltip contentStyle={{ background: "hsl(0 0% 100%)", border: "1px solid hsl(220 13% 87%)", fontSize: 10 }} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {modData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <p className="text-[9px] font-mono text-muted-foreground mb-1">По SF</p>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={sfData}>
              <CartesianGrid stroke="hsl(220 13% 90%)" strokeDasharray="2 4" />
              <XAxis dataKey="name" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
              <YAxis tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} width={20} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {sfData.map((_, i) => <Cell key={i} fill={`hsl(${142 + i * 20} 65% 45%)`} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
