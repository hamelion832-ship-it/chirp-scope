import { useState, useMemo, useCallback } from "react";
import { Radio, Activity, Waves, Zap, Save, Tag, Brain, Radar } from "lucide-react";
import { ChartPanel } from "@/components/ChartPanel";
import { SpectrogramPanel } from "@/components/SpectrogramPanel";
import { IQPanel } from "@/components/IQPanel";
import { SymbolsChart } from "@/components/SymbolsChart";
import { SignalList } from "@/components/SignalList";
import { StatsPanel } from "@/components/StatsPanel";
import { NeuralFormulaPanel } from "@/components/NeuralFormulaPanel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { saveSignal, type StoredSignal } from "@/lib/signal-db";
import { toast } from "sonner";
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
  const [cr, setCr] = useState(1);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [numSymbols, setNumSymbols] = useState(20);
  const [tags, setTags] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Max symbols based on text byte length and SF
  const maxSymbols = useMemo(() => {
    const byteLen = new TextEncoder().encode(text).length;
    const clampedBytes = Math.min(byteLen, 1240);
    return Math.max(1, Math.floor((clampedBytes * 8) / sf));
  }, [text, sf]);
  const [saving, setSaving] = useState(false);

  const params = useMemo(() => ({
    sf,
    bw: bw * 1000,
    fc: 915e6,
    sampleRate: 500e3,
  }), [sf, bw]);

  const signal = useMemo(() =>
    generateLoRaSignal(params, text, numSymbols),
    [params, text, numSymbols]
  );

  const tSymbol = useMemo(() => (2 ** sf / (bw * 1000)) * 1000, [sf, bw]);
  const duration = signal.symbols.length * tSymbol / 1000; // seconds

  // Chart data with auto-scaling (domains computed inside ChartPanel)
  const timeDomainData = useMemo(() => {
    const len = signal.real.length;
    const maxPts = Math.min(len, 2000);
    const step = Math.max(1, Math.floor(len / maxPts));
    const arr: { x: number; y: number }[] = [];
    for (let i = 0; i < len && arr.length < maxPts; i += step) {
      arr.push({ x: signal.time[i] * 1000, y: signal.real[i] });
    }
    return arr;
  }, [signal]);

  const envelopeData = useMemo(() => {
    const len = signal.real.length;
    const maxPts = Math.min(len, 2000);
    const step = Math.max(1, Math.floor(len / maxPts));
    const arr: { x: number; y: number }[] = [];
    for (let i = 0; i < len && arr.length < maxPts; i += step) {
      arr.push({ x: signal.time[i] * 1000, y: Math.sqrt(signal.real[i] ** 2 + signal.imag[i] ** 2) });
    }
    return arr;
  }, [signal]);

  const spectrum = useMemo(() =>
    computeSpectrum(signal.real, signal.imag, params.sampleRate, 512),
    [signal, params.sampleRate]
  );

  const spectrumData = useMemo(() =>
    spectrum.frequencies.map((f, i) => ({ x: f, y: spectrum.power[i] })),
    [spectrum]
  );

  const rfSpectrumData = useMemo(() =>
    spectrum.frequencies.map((f, i) => ({ x: 915000 + f, y: spectrum.power[i] })),
    [spectrum]
  );

  const spectrogram = useMemo(() =>
    computeSpectrogram(signal.real, signal.imag, params.sampleRate, 64, 16),
    [signal, params.sampleRate]
  );

  const iqPoints = useMemo(() => getIQPoints(signal.real, signal.imag, 8, 300), [signal]);
  const iqTrajectory = useMemo(() => getIQTrajectory(signal.real, signal.imag, 500), [signal]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const id = await saveSignal(text, params, cr, duration, signal.symbols.length, signal.symbols, tags);
    setSaving(false);
    if (id) {
      toast.success(`Сигнал сохранён (${signal.symbols.length} символов)`);
      setRefreshKey(k => k + 1);
    } else {
      toast.error("Ошибка сохранения");
    }
  }, [text, params, cr, duration, signal.symbols, tags]);

  const handleSelectFromDB = useCallback((stored: StoredSignal) => {
    setText(stored.message_text);
    setSf(stored.sf);
    setBw(stored.bw / 1000);
    setCr(stored.cr);
    setTags(stored.tags || "");
    toast.info(`Загружен сигнал: "${stored.message_text.slice(0, 40)}..."`);
  }, []);

  return (
    <div className="min-h-screen bg-background p-3 md:p-4">
      {/* Header */}
      <header className="mb-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-secondary">
          <Radio className="w-5 h-5 text-signal-green" />
        </div>
        <div>
          <h1 className="text-lg font-mono font-bold text-foreground">
            LoRa Signal <span className="text-signal-green glow-green">System</span>
          </h1>
          <p className="text-[10px] text-muted-foreground font-mono">
            SF={sf} · BW={bw}кГц · CR=4/{4 + cr} · T<sub>sym</sub>={tSymbol.toFixed(2)}мс · {signal.symbols.length} символов · {(duration * 1000).toFixed(1)}мс
          </p>
        </div>
      </header>

      <Tabs defaultValue="dashboard" className="space-y-3">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="dashboard" className="font-mono text-xs data-[state=active]:text-signal-green">
            <Radio className="w-3 h-3 mr-1.5" /> Дашборд
          </TabsTrigger>
          <TabsTrigger value="neural" className="font-mono text-xs data-[state=active]:text-signal-cyan">
            <Brain className="w-3 h-3 mr-1.5" /> Нейронная формула
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          {/* Controls */}
          <div className="chart-panel mb-3 flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                <Zap className="w-3 h-3" /> SF
              </label>
              <select value={sf} onChange={e => setSf(Number(e.target.value))}
                className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs font-mono border border-border focus:ring-1 focus:ring-ring outline-none">
                {[7, 8, 9, 10, 11, 12].map(v => <option key={v} value={v}>SF {v}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                <Waves className="w-3 h-3" /> BW
              </label>
              <select value={bw} onChange={e => setBw(Number(e.target.value))}
                className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs font-mono border border-border focus:ring-1 focus:ring-ring outline-none">
                {[125, 250, 500].map(v => <option key={v} value={v}>{v}кГц</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono text-muted-foreground">CR</label>
              <select value={cr} onChange={e => setCr(Number(e.target.value))}
                className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs font-mono border border-border focus:ring-1 focus:ring-ring outline-none">
                {[1, 2, 3, 4].map(v => <option key={v} value={v}>4/{4 + v}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                <Activity className="w-3 h-3" /> Символы: {numSymbols} / {maxSymbols}
              </label>
              <input type="range" min={1} max={maxSymbols} value={numSymbols}
                onChange={e => setNumSymbols(Number(e.target.value))}
                className="w-28 accent-signal-green" />
            </div>

            <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
              <label className="text-[10px] font-mono text-muted-foreground">Сообщение</label>
              <textarea value={text} onChange={e => setText(e.target.value)}
                rows={2}
                className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs font-mono border border-border focus:ring-1 focus:ring-ring outline-none resize-none" />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                <Tag className="w-3 h-3" /> Теги
              </label>
              <input type="text" value={tags} onChange={e => setTags(e.target.value)}
                placeholder="тест, demo"
                className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs font-mono border border-border focus:ring-1 focus:ring-ring outline-none w-24" />
            </div>

            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1 bg-signal-green/20 hover:bg-signal-green/30 text-signal-green rounded px-3 py-1.5 text-xs font-mono border border-signal-green/30 transition-colors disabled:opacity-50">
              <Save className="w-3 h-3" />
              {saving ? "..." : "Сохранить"}
            </button>

            <div className="text-[10px] font-mono text-muted-foreground leading-relaxed">
              <span className="text-signal-green">[{signal.symbols.slice(0, 8).join(", ")}{signal.symbols.length > 8 ? "…" : ""}]</span>
            </div>
          </div>

          {/* Main Grid: Charts + DB panel */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-3" style={{ gridAutoRows: "240px" }}>
              <ChartPanel title="Временная область (Re)" data={timeDomainData} xLabel="мс" yLabel="Амп." color="hsl(220 80% 60%)" />
              <ChartPanel title="Огибающая сигнала" data={envelopeData} xLabel="мс" yLabel="Амп." color="hsl(0 80% 58%)" />
              <ChartPanel title="Спектр baseband" data={spectrumData} xLabel="кГц" yLabel="дБ" color="hsl(142 70% 50%)" />
              <ChartPanel title={`Спектр RF (fc=915МГц)`} data={rfSpectrumData} xLabel="кГц" yLabel="дБ" color="hsl(300 70% 60%)" />
              <SpectrogramPanel data={spectrogram} bw={bw * 1000} />
              <IQPanel points={iqPoints} trajectory={iqTrajectory} />
              <SymbolsChart symbols={signal.symbols} />
              <div className="chart-panel flex flex-col h-full">
                <h3 className="text-xs font-mono font-semibold text-signal-amber mb-2" style={{ textShadow: "0 0 10px hsl(40 95% 55% / 0.4)" }}>
                  Параметры сигнала
                </h3>
                <div className="flex-1 space-y-1.5 text-[11px] font-mono text-muted-foreground">
                  <div className="flex justify-between"><span>SF:</span><span className="text-foreground">{sf}</span></div>
                  <div className="flex justify-between"><span>BW:</span><span className="text-foreground">{bw} кГц</span></div>
                  <div className="flex justify-between"><span>CR:</span><span className="text-foreground">4/{4 + cr}</span></div>
                  <div className="flex justify-between"><span>fc:</span><span className="text-foreground">915 МГц</span></div>
                  <div className="flex justify-between"><span>T<sub>sym</sub>:</span><span className="text-foreground">{tSymbol.toFixed(2)} мс</span></div>
                  <div className="flex justify-between"><span>Длительность:</span><span className="text-foreground">{(duration * 1000).toFixed(2)} мс</span></div>
                  <div className="flex justify-between"><span>Символов:</span><span className="text-foreground">{signal.symbols.length}</span></div>
                  <div className="flex justify-between"><span>M (2^SF):</span><span className="text-foreground">{2 ** sf}</span></div>
                  <div className="flex justify-between"><span>Длина текста:</span><span className="text-foreground">{text.length} симв.</span></div>
                  <div className="border-t border-border pt-1.5 mt-2">
                    <p className="text-[10px] text-muted-foreground leading-relaxed break-all">
                      {text.slice(0, 150)}{text.length > 150 ? "..." : ""}
                    </p>
                  </div>
                </div>
              </div>
              <StatsPanel refreshKey={refreshKey} />
            </div>
            <div className="lg:col-span-1" style={{ minHeight: "500px" }}>
              <SignalList onSelect={handleSelectFromDB} refreshKey={refreshKey} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="neural">
          <NeuralFormulaPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Index;
