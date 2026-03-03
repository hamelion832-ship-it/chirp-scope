import { useState, useEffect, useMemo } from "react";
import { BarChart2 } from "lucide-react";
import { getSignalStats } from "@/lib/signal-db";
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

  const bwData = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.bwCounts).map(([k, v]) => ({ name: `${Number(k) / 1000}к`, count: v }));
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
        <h3 className="text-xs font-mono font-semibold text-signal-cyan glow-cyan">Статистика БД</h3>
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
          <div className="text-lg font-mono font-bold text-signal-cyan">{Object.keys(stats.sfCounts).length}</div>
          <div className="text-[9px] font-mono text-muted-foreground">SF режимов</div>
        </div>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-2">
        <div>
          <p className="text-[9px] font-mono text-muted-foreground mb-1">По SF</p>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={sfData}>
              <CartesianGrid stroke="hsl(220 15% 20%)" strokeDasharray="2 4" />
              <XAxis dataKey="name" tick={{ fontSize: 8, fill: "hsl(215 15% 50%)" }} />
              <YAxis tick={{ fontSize: 8, fill: "hsl(215 15% 50%)" }} width={20} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {sfData.map((_, i) => <Cell key={i} fill={`hsl(${142 + i * 20} 70% 50%)`} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <p className="text-[9px] font-mono text-muted-foreground mb-1">По BW</p>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={bwData}>
              <CartesianGrid stroke="hsl(220 15% 20%)" strokeDasharray="2 4" />
              <XAxis dataKey="name" tick={{ fontSize: 8, fill: "hsl(215 15% 50%)" }} />
              <YAxis tick={{ fontSize: 8, fill: "hsl(215 15% 50%)" }} width={20} />
              <Bar dataKey="count" fill="hsl(40 95% 55%)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
