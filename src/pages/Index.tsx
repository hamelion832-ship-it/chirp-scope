import { useState, useMemo, useCallback } from "react";
import { Radio, Activity, Waves, Zap } from "lucide-react";
import { ChartPanel } from "@/components/ChartPanel";
import { SpectrogramPanel } from "@/components/SpectrogramPanel";
import { IQPanel } from "@/components/IQPanel";
import {
  generateLoRaSignal,
  computeSpectrum,
  computeSpectrogram,
  getIQPoints,
  getIQTrajectory,
} from "@/lib/lora-signal";

const DEFAULT_TEXT = "Философ спокойно создаёт старую книгу.";

const Index = () => {
  const [sf, setSf] = useState(7);
  const [bw, setBw] = useState(125);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [numSymbols, setNumSymbols] = useState(8);

  const params = useMemo(() => ({
    sf,
    bw: bw * 1000,
    fc: 915e6,
    sampleRate: 500e3, // Lower for browser performance
  }), [sf, bw]);

  const signal = useMemo(() =>
    generateLoRaSignal(params, text, numSymbols),
    [params, text, numSymbols]
  );

  const timeDomainData = useMemo(() => {
    const maxPts = Math.min(signal.real.length, 2000);
    return Array.from({ length: maxPts }, (_, i) => ({
      x: signal.time[i] * 1000, // ms
      y: signal.real[i],
    }));
  }, [signal]);

  const envelopeData = useMemo(() => {
    const maxPts = Math.min(signal.real.length, 3000);
    return Array.from({ length: maxPts }, (_, i) => ({
      x: signal.time[i] * 1000,
      y: Math.sqrt(signal.real[i] ** 2 + signal.imag[i] ** 2),
    }));
  }, [signal]);

  const spectrum = useMemo(() =>
    computeSpectrum(signal.real, signal.imag, params.sampleRate, 512),
    [signal, params.sampleRate]
  );

  const spectrumData = useMemo(() =>
    spectrum.frequencies.map((f, i) => ({ x: f, y: spectrum.power[i] })),
    [spectrum]
  );

  const spectrogram = useMemo(() =>
    computeSpectrogram(signal.real, signal.imag, params.sampleRate, 64, 16),
    [signal, params.sampleRate]
  );

  const iqPoints = useMemo(() => getIQPoints(signal.real, signal.imag, 8, 300), [signal]);
  const iqTrajectory = useMemo(() => getIQTrajectory(signal.real, signal.imag, 500), [signal]);

  const tSymbol = useMemo(() => (2 ** sf / (bw * 1000)) * 1000, [sf, bw]);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      {/* Header */}
      <header className="mb-6 flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-secondary">
          <Radio className="w-5 h-5 text-signal-green" />
        </div>
        <div>
          <h1 className="text-xl font-mono font-bold text-foreground">
            LoRa Signal <span className="text-signal-green glow-green">Visualizer</span>
          </h1>
          <p className="text-xs text-muted-foreground font-mono">
            SF={sf} · BW={bw} кГц · T<sub>sym</sub>={tSymbol.toFixed(2)} мс · {signal.symbols.length} символов
          </p>
        </div>
      </header>

      {/* Controls */}
      <div className="chart-panel mb-4 flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-mono text-muted-foreground flex items-center gap-1">
            <Zap className="w-3 h-3" /> Spreading Factor
          </label>
          <select
            value={sf}
            onChange={e => setSf(Number(e.target.value))}
            className="bg-secondary text-secondary-foreground rounded px-3 py-1.5 text-sm font-mono border border-border focus:ring-1 focus:ring-ring outline-none"
          >
            {[7, 8, 9, 10, 11, 12].map(v => (
              <option key={v} value={v}>SF {v}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-mono text-muted-foreground flex items-center gap-1">
            <Waves className="w-3 h-3" /> Bandwidth (кГц)
          </label>
          <select
            value={bw}
            onChange={e => setBw(Number(e.target.value))}
            className="bg-secondary text-secondary-foreground rounded px-3 py-1.5 text-sm font-mono border border-border focus:ring-1 focus:ring-ring outline-none"
          >
            {[125, 250, 500].map(v => (
              <option key={v} value={v}>{v} кГц</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-mono text-muted-foreground flex items-center gap-1">
            <Activity className="w-3 h-3" /> Символы
          </label>
          <input
            type="range"
            min={2}
            max={14}
            value={numSymbols}
            onChange={e => setNumSymbols(Number(e.target.value))}
            className="w-24 accent-signal-green"
          />
          <span className="text-[10px] font-mono text-muted-foreground text-center">{numSymbols}</span>
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label className="text-xs font-mono text-muted-foreground">Текст для кодирования</label>
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            className="bg-secondary text-secondary-foreground rounded px-3 py-1.5 text-sm font-mono border border-border focus:ring-1 focus:ring-ring outline-none"
            placeholder="Введите текст..."
          />
        </div>

        <div className="text-xs font-mono text-muted-foreground leading-relaxed">
          <div>Символы: <span className="text-signal-green">[{signal.symbols.join(", ")}]</span></div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ gridAutoRows: "280px" }}>
        {/* 1. Time domain */}
        <ChartPanel
          title="Временная область (действительная часть)"
          data={timeDomainData}
          xLabel="Время (мс)"
          yLabel="Амплитуда"
          color="hsl(220 80% 60%)"
        />

        {/* 2. Envelope */}
        <ChartPanel
          title="Огибающая сигнала (амплитуда)"
          data={envelopeData}
          xLabel="Время (мс)"
          yLabel="Амплитуда"
          color="hsl(0 80% 58%)"
        />

        {/* 3. Spectrum */}
        <ChartPanel
          title="Спектр модулирующего сигнала (baseband)"
          data={spectrumData}
          xLabel="Частота (кГц)"
          yLabel="Мощность (дБ)"
          color="hsl(142 70% 50%)"
          xDomain={[-(bw + 50), bw + 50]}
        />

        {/* 4. RF Spectrum placeholder - show shifted */}
        <ChartPanel
          title={`Спектр RF сигнала (fc = 915 МГц)`}
          data={spectrumData.map(d => ({ x: d.x + 915000, y: d.y }))}
          xLabel="Частота (кГц от 0)"
          yLabel="Мощность (дБ)"
          color="hsl(300 70% 60%)"
        />

        {/* 5. Spectrogram */}
        <SpectrogramPanel data={spectrogram} bw={bw * 1000} />

        {/* 6. IQ Diagram */}
        <IQPanel points={iqPoints} trajectory={iqTrajectory} />
      </div>

      {/* Info footer */}
      <div className="mt-4 chart-panel">
        <h3 className="text-sm font-mono font-semibold text-signal-amber mb-2" style={{ textShadow: "0 0 10px hsl(40 95% 55% / 0.4)" }}>
          Как интерпретировать спектрограмму
        </h3>
        <p className="text-xs text-muted-foreground font-mono leading-relaxed max-w-3xl">
          На спектрограмме LoRa сигнала: ось X — время, ось Y — частота, цвет — мощность.
          Каждый наклонный «след» — один символ (chirp). Начальная частота каждого чирпа кодирует SF={sf} бит информации.
          Для SF={sf} и BW={bw} кГц: длительность символа {tSymbol.toFixed(2)} мс, {2**sf} возможных значений символа.
        </p>
      </div>
    </div>
  );
};

export default Index;
