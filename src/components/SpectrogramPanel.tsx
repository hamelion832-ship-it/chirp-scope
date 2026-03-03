import { useRef, useEffect, useMemo } from "react";
import type { SpectrogramData } from "@/lib/lora-signal";

interface SpectrogramPanelProps {
  data: SpectrogramData;
  bw: number; // in Hz
}

// Viridis-like colormap
function viridis(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const r = Math.round(255 * (0.267004 + t * (0.003299 + t * (-0.227411 + t * (2.735674 + t * (-3.577719 + t * 1.799026))))));
  const g = Math.round(255 * (0.004874 + t * (0.849555 + t * (-0.971923 + t * (1.556498 + t * (-1.199478 + t * 0.460108))))));
  const b = Math.round(255 * (0.329415 + t * (1.015935 + t * (-2.248445 + t * (4.265174 + t * (-4.455872 + t * 1.635498))))));
  return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
}

export function SpectrogramPanel({ data, bw }: SpectrogramPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { minPower, maxPower } = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const row of data.power) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return { minPower: min, maxPower: max };
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.power.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const numTime = data.power.length;
    const numFreq = data.power[0].length;

    // Filter to show only frequencies within BW
    const bwKhz = bw / 1000;
    const freqMin = -bwKhz / 2;
    const freqMax = bwKhz / 2;
    
    const freqIndices: number[] = [];
    for (let i = 0; i < data.freqAxis.length; i++) {
      if (data.freqAxis[i] >= freqMin && data.freqAxis[i] <= freqMax) {
        freqIndices.push(i);
      }
    }
    if (freqIndices.length === 0) return;

    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.createImageData(width, height);

    const range = maxPower - minPower || 1;

    for (let px = 0; px < width; px++) {
      const tIdx = Math.floor((px / width) * numTime);
      for (let py = 0; py < height; py++) {
        // Flip Y so low freq at bottom
        const fIdxRaw = Math.floor(((height - 1 - py) / height) * freqIndices.length);
        const fIdx = freqIndices[Math.min(fIdxRaw, freqIndices.length - 1)];
        
        const val = (data.power[Math.min(tIdx, numTime - 1)][fIdx] - minPower) / range;
        const [r, g, b] = viridis(val);
        const offset = (py * width + px) * 4;
        imgData.data[offset] = r;
        imgData.data[offset + 1] = g;
        imgData.data[offset + 2] = b;
        imgData.data[offset + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }, [data, minPower, maxPower, bw]);

  const timeRange = data.timeAxis.length > 0
    ? `${data.timeAxis[0].toFixed(1)} - ${data.timeAxis[data.timeAxis.length - 1].toFixed(1)} мс`
    : "";

  return (
    <div className="chart-panel flex flex-col h-full">
      <h3 className="text-sm font-mono font-semibold text-signal-amber mb-3" style={{ textShadow: "0 0 10px hsl(40 95% 55% / 0.6)" }}>
        Спектрограмма (частотно-временное распределение)
      </h3>
      <div className="flex-1 min-h-0 relative">
        <canvas
          ref={canvasRef}
          width={400}
          height={200}
          className="w-full h-full rounded"
          style={{ imageRendering: "pixelated" }}
        />
        <div className="absolute bottom-1 left-2 text-[10px] font-mono text-muted-foreground">{timeRange}</div>
        <div className="absolute top-1 right-2 text-[10px] font-mono text-muted-foreground">±{(bw / 2000).toFixed(0)} кГц</div>
      </div>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-1">
        <span>Время (мс) →</span>
        <span>↑ Частота (кГц)</span>
      </div>
    </div>
  );
}
