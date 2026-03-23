import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip
} from "recharts";

interface ChartPanelProps {
  title: string;
  data: { x: number; y: number }[];
  xLabel: string;
  yLabel: string;
  color: string;
}

export function ChartPanel({ title, data, xLabel, yLabel, color }: ChartPanelProps) {
  const chartData = useMemo(() => {
    const maxPoints = 600;
    if (data.length <= maxPoints) return data;
    const step = Math.floor(data.length / maxPoints);
    return data.filter((_, i) => i % step === 0);
  }, [data]);

  const { xDomain, yDomain } = useMemo(() => {
    if (chartData.length === 0) return { xDomain: [0, 1] as [number, number], yDomain: [0, 1] as [number, number] };
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const d of chartData) {
      if (d.x < xMin) xMin = d.x;
      if (d.x > xMax) xMax = d.x;
      if (d.y < yMin) yMin = d.y;
      if (d.y > yMax) yMax = d.y;
    }
    const yPad = (yMax - yMin) * 0.05 || 0.1;
    const xPad = (xMax - xMin) * 0.01 || 0.01;
    return {
      xDomain: [xMin - xPad, xMax + xPad] as [number, number],
      yDomain: [yMin - yPad, yMax + yPad] as [number, number],
    };
  }, [chartData]);

  return (
    <div className="chart-panel flex flex-col h-full">
      <h3 className="text-xs font-mono font-semibold text-signal-green mb-2 truncate">{title}</h3>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 20 }}>
            <CartesianGrid stroke="hsl(220 13% 90%)" strokeDasharray="2 4" />
            <XAxis
              dataKey="x"
              stroke="hsl(215 15% 55%)"
              tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }}
              domain={xDomain}
              type="number"
              tickFormatter={(v) => typeof v === 'number' ? (Math.abs(v) >= 1000 ? (v/1000).toFixed(0) + 'k' : v.toFixed(1)) : v}
              label={{ value: xLabel, position: "bottom", offset: 5, style: { fontSize: 9, fill: "hsl(215 15% 55%)" } }}
            />
            <YAxis
              stroke="hsl(215 15% 55%)"
              tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }}
              domain={yDomain}
              tickFormatter={(v) => typeof v === 'number' ? v.toFixed(0) : v}
              width={40}
            />
            <Tooltip
              contentStyle={{ background: "hsl(0 0% 100%)", border: "1px solid hsl(220 13% 87%)", borderRadius: 6, fontSize: 10, fontFamily: "JetBrains Mono" }}
              labelStyle={{ color: "hsl(220 15% 25%)" }}
              itemStyle={{ color }}
              labelFormatter={(v) => `${typeof v === 'number' ? v.toFixed(3) : v}`}
            />
            <Line type="monotone" dataKey="y" stroke={color} dot={false} strokeWidth={1.2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
