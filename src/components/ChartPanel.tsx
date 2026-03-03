import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";

interface ChartPanelProps {
  title: string;
  data: { x: number; y: number }[];
  xLabel: string;
  yLabel: string;
  color: string;
  xDomain?: [number, number];
}

export function ChartPanel({ title, data, xLabel, yLabel, color, xDomain }: ChartPanelProps) {
  const chartData = useMemo(() => {
    // Downsample for performance
    const maxPoints = 500;
    if (data.length <= maxPoints) return data;
    const step = Math.floor(data.length / maxPoints);
    return data.filter((_, i) => i % step === 0);
  }, [data]);

  return (
    <div className="chart-panel flex flex-col h-full">
      <h3 className="text-sm font-mono font-semibold text-signal-green glow-green mb-3">{title}</h3>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 20 }}>
            <CartesianGrid stroke="hsl(220 15% 20%)" strokeDasharray="2 4" />
            <XAxis
              dataKey="x"
              stroke="hsl(215 15% 50%)"
              tick={{ fontSize: 10, fill: "hsl(215 15% 50%)" }}
              domain={xDomain}
              label={{ value: xLabel, position: "bottom", offset: 5, style: { fontSize: 10, fill: "hsl(215 15% 50%)" } }}
              type="number"
              tickFormatter={(v) => typeof v === 'number' ? v.toFixed(1) : v}
            />
            <YAxis
              stroke="hsl(215 15% 50%)"
              tick={{ fontSize: 10, fill: "hsl(215 15% 50%)" }}
              label={{ value: yLabel, angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 10, fill: "hsl(215 15% 50%)" } }}
            />
            <Tooltip
              contentStyle={{ background: "hsl(220 18% 10%)", border: "1px solid hsl(220 15% 18%)", borderRadius: 6, fontSize: 11 }}
              labelStyle={{ color: "hsl(210 20% 90%)" }}
              itemStyle={{ color }}
              labelFormatter={(v) => `${xLabel}: ${typeof v === 'number' ? v.toFixed(3) : v}`}
            />
            <Line type="monotone" dataKey="y" stroke={color} dot={false} strokeWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
