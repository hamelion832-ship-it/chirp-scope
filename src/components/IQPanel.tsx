import { useMemo } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import type { IQPoint } from "@/lib/lora-signal";

interface IQPanelProps {
  points: IQPoint[];
  trajectory: IQPoint[];
}

export function IQPanel({ points }: IQPanelProps) {
  const scatterData = useMemo(() =>
    points.map(p => ({ x: p.i, y: p.q })),
    [points]
  );

  return (
    <div className="chart-panel flex flex-col h-full">
      <h3 className="text-sm font-mono font-semibold text-signal-cyan mb-3">IQ диаграмма</h3>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 5, right: 10, left: 0, bottom: 20 }}>
            <CartesianGrid stroke="hsl(220 13% 90%)" strokeDasharray="2 4" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[-1.5, 1.5]}
              stroke="hsl(215 15% 55%)"
              tick={{ fontSize: 10, fill: "hsl(215 15% 55%)" }}
              label={{ value: "I (синфазная)", position: "bottom", offset: 5, style: { fontSize: 10, fill: "hsl(215 15% 55%)" } }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[-1.5, 1.5]}
              stroke="hsl(215 15% 55%)"
              tick={{ fontSize: 10, fill: "hsl(215 15% 55%)" }}
              label={{ value: "Q (квадратурная)", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 10, fill: "hsl(215 15% 55%)" } }}
            />
            <Tooltip
              contentStyle={{ background: "hsl(0 0% 100%)", border: "1px solid hsl(220 13% 87%)", borderRadius: 6, fontSize: 11 }}
            />
            <Scatter data={scatterData} fill="hsl(185 85% 38%)" r={2} opacity={0.7} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
