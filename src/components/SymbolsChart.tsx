import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, Cell
} from "recharts";

interface SymbolsChartProps {
  symbols: number[];
}

export function SymbolsChart({ symbols }: SymbolsChartProps) {
  const data = useMemo(() =>
    symbols.map((v, i) => ({ idx: i, value: v })),
    [symbols]
  );

  const histData = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const v of symbols) counts[v] = (counts[v] || 0) + 1;
    return Object.entries(counts)
      .map(([k, v]) => ({ symbol: Number(k), count: v }))
      .sort((a, b) => a.symbol - b.symbol);
  }, [symbols]);

  return (
    <div className="chart-panel flex flex-col h-full">
      <h3 className="text-xs font-mono font-semibold text-signal-magenta mb-2">
        Значения символов ({symbols.length} шт.)
      </h3>
      <div className="flex-1 min-h-0 grid grid-rows-2 gap-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 2, right: 5, left: -15, bottom: 2 }}>
            <CartesianGrid stroke="hsl(220 13% 90%)" strokeDasharray="2 4" />
            <XAxis dataKey="idx" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
            <YAxis tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} width={35} />
            <Tooltip
              contentStyle={{ background: "hsl(0 0% 100%)", border: "1px solid hsl(220 13% 87%)", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
            />
            <Bar dataKey="value" radius={[2, 2, 0, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={`hsl(${(i * 30) % 360} 65% 50%)`} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={histData} margin={{ top: 2, right: 5, left: -15, bottom: 2 }}>
            <CartesianGrid stroke="hsl(220 13% 90%)" strokeDasharray="2 4" />
            <XAxis dataKey="symbol" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} label={{ value: "Распределение", position: "bottom", offset: -2, style: { fontSize: 8, fill: "hsl(215 15% 55%)" } }} />
            <YAxis tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} width={35} />
            <Bar dataKey="count" fill="hsl(35 92% 48%)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
