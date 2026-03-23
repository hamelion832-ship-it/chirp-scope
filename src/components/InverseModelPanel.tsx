import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Brain, Play, Loader2, CheckCircle2, AlertTriangle, RotateCcw,
  ArrowRightLeft, BarChart3, FileText, Zap, Waves, Copy, Database, Radar,
} from "lucide-react";
import { generateLoRaSignal } from "@/lib/lora-signal";
import {
  buildTrainingPairs, trainDecoder, decodeSignal, compareTexts,
  DEFAULT_DECODER_CONFIG, type DecoderConfig, type DecoderTrainingResult, type DecodedResult,
} from "@/lib/inverse-model";
import {
  DECODER_REGISTRY, type DecoderType, type ClassicDecodedResult,
  decodeCorrelation, decodeEnergy, decodeTemplate,
} from "@/lib/inverse-decoders";
import { SignalDBBrowser } from "@/components/SignalDBBrowser";
import { fetchSignals, type StoredSignal } from "@/lib/signal-db";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar, Cell,
} from "recharts";

const SAMPLE_TEXTS = [
  "Философ спокойно создаёт старую книгу.",
  "Радиосигнал передаёт данные через эфир.",
  "LoRa модуляция использует CSS чирпы.",
  "Нейросеть учится декодировать сигналы.",
];

const DECODER_ICONS: Record<string, React.ElementType> = {
  Brain, Waves, Zap, Copy,
};

type SignalSourceMode = "manual" | "db" | "unified";
type AnyResult = { method: DecoderType; symbols: number[]; confidence: number[]; decodedText: string; processingTimeMs?: number };

export function InverseModelPanel() {
  const [sf, setSf] = useState(7);
  const [bw, setBw] = useState(125);
  const [text, setText] = useState(SAMPLE_TEXTS[0]);
  const [numSymbols, setNumSymbols] = useState(20);
  const [noiseLevel, setNoiseLevel] = useState(0);

  // Max symbols based on UTF-8 byte length and SF
  const maxSymbols = useMemo(() => {
    const byteLen = new TextEncoder().encode(text).length;
    const clampedBytes = Math.min(byteLen, 1240);
    return Math.max(1, Math.floor((clampedBytes * 8) / sf));
  }, [text, sf]);

  // Clamp numSymbols when maxSymbols changes
  useEffect(() => {
    setNumSymbols(prev => Math.min(prev, maxSymbols));
  }, [maxSymbols]);

  const [activeDecoder, setActiveDecoder] = useState<DecoderType>("mlp");
  const [config, setConfig] = useState<DecoderConfig>(DEFAULT_DECODER_CONFIG);
  const [training, setTraining] = useState(false);
  const [progress, setProgress] = useState(0);

  // Results per decoder type
  const [mlpTrain, setMlpTrain] = useState<DecoderTrainingResult | null>(null);
  const [mlpResult, setMlpResult] = useState<DecodedResult | null>(null);
  const [classicResults, setClassicResults] = useState<Record<string, ClassicDecodedResult>>({});
  const [textComparison, setTextComparison] = useState<Record<string, ReturnType<typeof compareTexts>>>({});

  // DB selection — multi-select
  const [dbSignals, setDbSignals] = useState<StoredSignal[]>([]);
  const [dbSelectedIds, setDbSelectedIds] = useState<string[]>([]);
  const [showDB, setShowDB] = useState(false);
  const [signalSourceMode, setSignalSourceMode] = useState<SignalSourceMode>("manual");

  // Load DB signals for unified model source
  useEffect(() => {
    fetchSignals().then(setDbSignals);
  }, []);

  const handleToggleDbSignal = useCallback((stored: StoredSignal) => {
    setDbSelectedIds(prev =>
      prev.includes(stored.id) ? prev.filter(x => x !== stored.id) : [...prev, stored.id]
    );
  }, []);

  // When DB signals selected, use first one's params for signal generation
  const activeDbSignal = useMemo(() => {
    if (signalSourceMode !== "db" || dbSelectedIds.length === 0) return null;
    return dbSignals.find(s => dbSelectedIds.includes(s.id)) ?? null;
  }, [signalSourceMode, dbSelectedIds, dbSignals]);

  // Apply first selected DB signal params
  useEffect(() => {
    if (activeDbSignal) {
      setText(activeDbSignal.message_text);
      setSf(activeDbSignal.sf);
      setBw(activeDbSignal.bw / 1000);
      const storedMax = Math.max(1, Math.floor((Math.min(new TextEncoder().encode(activeDbSignal.message_text).length, 1240) * 8) / activeDbSignal.sf));
      setNumSymbols(Math.min(activeDbSignal.n_symbols, storedMax));
    }
  }, [activeDbSignal]);

  // Signal generation — merge multiple DB signals for training
  const signal = useMemo(() => {
    const params = { sf, bw: bw * 1000, fc: 915e6, sampleRate: 500e3 };
    return generateLoRaSignal(params, text, numSymbols);
  }, [sf, bw, text, numSymbols]);

  // Build merged training signal from multiple DB entries
  const mergedTrainingSignals = useMemo(() => {
    if (signalSourceMode !== "db" || dbSelectedIds.length <= 1) return null;
    return dbSelectedIds.map(id => {
      const stored = dbSignals.find(s => s.id === id);
      if (!stored) return null;
      const params = { sf: stored.sf, bw: stored.bw, fc: stored.fc, sampleRate: 500e3 };
      const byteLen = new TextEncoder().encode(stored.message_text).length;
      const maxSym = Math.max(1, Math.floor((Math.min(byteLen, 1240) * 8) / stored.sf));
      return {
        signal: generateLoRaSignal(params, stored.message_text, Math.min(stored.n_symbols, maxSym)),
        text: stored.message_text,
        sf: stored.sf,
        bw: stored.bw,
      };
    }).filter(Boolean) as { signal: ReturnType<typeof generateLoRaSignal>; text: string; sf: number; bw: number }[];
  }, [signalSourceMode, dbSelectedIds, dbSignals]);

  const noisySignal = useMemo(() => {
    if (noiseLevel === 0) return signal;
    const real = signal.real.map(v => v + (Math.random() - 0.5) * noiseLevel * 2);
    const imag = signal.imag.map(v => v + (Math.random() - 0.5) * noiseLevel * 2);
    return { ...signal, real, imag };
  }, [signal, noiseLevel]);

  const M = 2 ** sf;
  const samplesPerSymbol = Math.floor(500e3 * (M / (bw * 1000)));

  const handleTrainMLP = useCallback(async () => {
    setTraining(true);
    setProgress(0);
    try {
      const pairs = buildTrainingPairs(signal.real, signal.imag, signal.symbols, samplesPerSymbol, config.windowSize);
      if (pairs.length === 0) { toast.error("Недостаточно данных"); setTraining(false); return; }
      const augmented = [...pairs];
      for (const nl of [0.02, 0.05, 0.1]) {
        const nR = signal.real.map(v => v + (Math.random() - 0.5) * nl * 2);
        const nI = signal.imag.map(v => v + (Math.random() - 0.5) * nl * 2);
        augmented.push(...buildTrainingPairs(nR, nI, signal.symbols, samplesPerSymbol, config.windowSize));
      }
      const result = trainDecoder(augmented, config, M, (ep) => setProgress((ep / config.epochs) * 100));
      setMlpTrain(result);
      const decoded = decodeSignal(noisySignal.real, noisySignal.imag, samplesPerSymbol, result, sf);
      setMlpResult(decoded);
      setTextComparison(prev => ({ ...prev, mlp: compareTexts(text, decoded.decodedText) }));
      toast.success(`MLP: точность ${(result.accuracy * 100).toFixed(1)}%`);
    } catch (e) {
      toast.error("Ошибка обучения MLP");
      console.error(e);
    } finally { setTraining(false); }
  }, [signal, noisySignal, samplesPerSymbol, config, M, sf, text]);

  // Classic decoders
  const runClassicDecoder = useCallback((type: DecoderType) => {
    try {
      let result: ClassicDecodedResult;
      const bwHz = bw * 1000;
      const sr = 500e3;
      switch (type) {
        case "correlation":
          result = decodeCorrelation(noisySignal.real, noisySignal.imag, samplesPerSymbol, sf, bwHz, sr);
          break;
        case "energy":
          result = decodeEnergy(noisySignal.real, noisySignal.imag, samplesPerSymbol, sf);
          break;
        case "template":
          result = decodeTemplate(noisySignal.real, noisySignal.imag, samplesPerSymbol, sf, bwHz, sr);
          break;
        default: return;
      }
      setClassicResults(prev => ({ ...prev, [type]: result }));
      setTextComparison(prev => ({ ...prev, [type]: compareTexts(text, result.decodedText) }));
      toast.success(`${DECODER_REGISTRY.find(d => d.id === type)?.name}: ${(result.processingTimeMs).toFixed(0)}мс`);
    } catch (e) {
      toast.error(`Ошибка ${type}`);
      console.error(e);
    }
  }, [noisySignal, samplesPerSymbol, sf, bw, text]);

  // Run all decoders at once
  const runAll = useCallback(async () => {
    setTraining(true);
    await handleTrainMLP();
    runClassicDecoder("correlation");
    runClassicDecoder("energy");
    runClassicDecoder("template");
    setTraining(false);
  }, [handleTrainMLP, runClassicDecoder]);

  // Gather all available results for comparison
  const allResults = useMemo(() => {
    const res: AnyResult[] = [];
    if (mlpResult) res.push({ method: "mlp", symbols: mlpResult.symbols, confidence: mlpResult.confidence, decodedText: mlpResult.decodedText, processingTimeMs: undefined });
    for (const [key, val] of Object.entries(classicResults)) {
      res.push({ method: key as DecoderType, symbols: val.symbols, confidence: val.confidence, decodedText: val.decodedText, processingTimeMs: val.processingTimeMs });
    }
    return res;
  }, [mlpResult, classicResults]);

  // Active result
  const activeResult = useMemo(() => allResults.find(r => r.method === activeDecoder), [allResults, activeDecoder]);
  const activeComparison = textComparison[activeDecoder];

  // Chart data
  const signalPreview = useMemo(() => {
    const maxPts = 400;
    const step = Math.max(1, Math.floor(noisySignal.real.length / maxPts));
    const data: { t: number; clean: number; noisy: number }[] = [];
    for (let i = 0; i < noisySignal.real.length && data.length < maxPts; i += step) {
      data.push({
        t: +(signal.time[i] * 1000).toFixed(3),
        clean: +signal.real[i].toFixed(4),
        noisy: +noisySignal.real[i].toFixed(4),
      });
    }
    return data;
  }, [signal, noisySignal]);

  const symbolCompareData = useMemo(() => {
    if (!activeResult) return [];
    return signal.symbols.slice(0, activeResult.symbols.length).map((orig, i) => ({
      idx: i, original: orig, decoded: activeResult.symbols[i],
      confidence: +(activeResult.confidence[i] * 100).toFixed(1),
      correct: orig === activeResult.symbols[i],
    }));
  }, [signal.symbols, activeResult]);

  const lossData = useMemo(() => {
    if (!mlpTrain) return [];
    const step = Math.max(1, Math.floor(mlpTrain.epochLosses.length / 150));
    return mlpTrain.epochLosses.filter((_, i) => i % step === 0).map((loss, i) => ({ epoch: i * step, loss: +loss.toFixed(4) }));
  }, [mlpTrain]);

  const comparisonTable = useMemo(() => {
    return DECODER_REGISTRY.map(d => {
      const comp = textComparison[d.id];
      const res = allResults.find(r => r.method === d.id);
      return {
        id: d.id, name: d.name,
        charAcc: comp ? (comp.charAccuracy * 100).toFixed(1) : "—",
        editDist: comp ? comp.editDistance : "—",
        symCorrect: res ? `${signal.symbols.slice(0, res.symbols.length).filter((s, i) => s === res.symbols[i]).length}/${res.symbols.length}` : "—",
        time: res?.processingTimeMs != null ? `${res.processingTimeMs.toFixed(0)}мс` : (d.id === "mlp" && mlpTrain ? "обуч." : "—"),
        done: !!res,
      };
    });
  }, [textComparison, allResults, signal.symbols, mlpTrain]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="chart-panel space-y-2">
        <div className="flex flex-wrap gap-3 items-center">
          <RotateCcw className="w-5 h-5 text-signal-amber" />
          <span className="text-sm font-mono font-semibold text-foreground">
            Обратное преобразование: s(t) → текст
          </span>
          <button onClick={() => setShowDB(!showDB)}
            className="ml-auto flex items-center gap-1 text-[10px] font-mono text-signal-amber hover:text-foreground transition-colors px-2 py-1 rounded border border-border hover:border-signal-amber/30">
            <Database className="w-3 h-3" /> {showDB ? "Скрыть БД" : "Из базы данных"}
          </button>
        </div>
        {/* Decoder type selector */}
        <div className="flex flex-wrap gap-1.5">
          {DECODER_REGISTRY.map(d => {
            const Icon = DECODER_ICONS[d.icon] || Brain;
            return (
              <button key={d.id} onClick={() => setActiveDecoder(d.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-mono border transition-all ${
                  activeDecoder === d.id
                    ? "border-signal-cyan/50 bg-signal-cyan/10 text-signal-cyan"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-border"
                }`}>
                <Icon className="w-3 h-3" />
                {d.name}
                {allResults.find(r => r.method === d.id) && <CheckCircle2 className="w-2.5 h-2.5 text-signal-green" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* Left column — params + DB */}
        <div className={`space-y-3 ${showDB ? "lg:col-span-2" : "lg:col-span-1"}`}>
          <div className={showDB ? "grid grid-cols-2 gap-3" : ""}>
            {/* Signal params */}
            <div className="chart-panel space-y-2">
              <h3 className="text-xs font-mono font-semibold text-signal-green flex items-center gap-1">
                <Zap className="w-3 h-3" /> Сигнал
              </h3>
              <div className="space-y-1.5">
                {([
                  ["SF", sf, (v: number) => setSf(v), [7, 8, 9, 10]],
                  ["BW кГц", bw, (v: number) => setBw(v), [125, 250, 500]],
                ] as [string, number, (v: number) => void, number[]][]).map(([label, val, setter, opts]) => (
                  <div key={label} className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-muted-foreground">{label}</span>
                    <select value={val} onChange={e => setter(Number(e.target.value))}
                      className="bg-secondary text-foreground rounded px-1.5 py-0.5 text-[10px] font-mono border border-border">
                      {opts.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                ))}
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-muted-foreground">Символов: {numSymbols}/{maxSymbols}</span>
                  <input type="range" min={1} max={maxSymbols} value={Math.min(numSymbols, maxSymbols)}
                    onChange={e => setNumSymbols(Number(e.target.value))} className="w-16 accent-signal-green" />
                  <span className="text-foreground w-8 text-right">{numSymbols}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-muted-foreground">Шум σ</span>
                  <input type="range" min={0} max={50} value={noiseLevel * 100}
                    onChange={e => setNoiseLevel(Number(e.target.value) / 100)} className="w-16 accent-signal-red" />
                  <span className="text-foreground w-8 text-right">{(noiseLevel * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono text-muted-foreground">Текст</label>
                <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
                  className="w-full bg-secondary text-secondary-foreground rounded px-2 py-1 text-[10px] font-mono border border-border mt-1 resize-none" />
                <div className="flex flex-wrap gap-1 mt-1">
                  {SAMPLE_TEXTS.map((t, i) => (
                    <button key={i} onClick={() => setText(t)}
                      className="text-[8px] font-mono px-1 py-0.5 rounded bg-secondary text-muted-foreground hover:text-foreground border border-border truncate max-w-[120px]">
                      {t.slice(0, 18)}…
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* DB browser */}
            {showDB && (
              <div style={{ minHeight: 300 }}>
                <SignalDBBrowser onSelectSignal={handleSelectFromDB} selectedId={dbSignalId} />
              </div>
            )}
          </div>

          {/* Decoder config (MLP only) */}
          {activeDecoder === "mlp" && (
            <div className="chart-panel space-y-2">
              <h3 className="text-xs font-mono font-semibold text-signal-cyan flex items-center gap-1">
                <Brain className="w-3 h-3" /> Конфигурация MLP
              </h3>
              {([
                ["hiddenSize", "Нейроны", 8, 128, 8],
                ["learningRate", "LR", 0.001, 0.1, 0.005],
                ["epochs", "Эпохи", 50, 2000, 50],
                ["windowSize", "Окно", 4, 64, 4],
              ] as [string, string, number, number, number][]).map(([key, label, min, max, step]) => (
                <div key={key} className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-muted-foreground">{label}</span>
                  <input type="number" min={min} max={max} step={step}
                    value={config[key as keyof DecoderConfig]}
                    onChange={e => setConfig(c => ({ ...c, [key]: Number(e.target.value) }))}
                    className="bg-secondary text-foreground rounded px-1.5 py-0.5 text-[10px] font-mono border border-border w-16 text-right" />
                </div>
              ))}
            </div>
          )}

          {/* Run buttons */}
          <div className="chart-panel space-y-2">
            {activeDecoder === "mlp" ? (
              <button onClick={handleTrainMLP} disabled={training}
                className="w-full flex items-center justify-center gap-1.5 bg-signal-cyan/20 hover:bg-signal-cyan/30 text-signal-cyan rounded px-3 py-2 text-xs font-mono border border-signal-cyan/30 transition-colors disabled:opacity-50">
                {training ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                {training ? `${progress.toFixed(0)}%` : "Обучить MLP"}
              </button>
            ) : (
              <button onClick={() => runClassicDecoder(activeDecoder)}
                className="w-full flex items-center justify-center gap-1.5 bg-signal-cyan/20 hover:bg-signal-cyan/30 text-signal-cyan rounded px-3 py-2 text-xs font-mono border border-signal-cyan/30 transition-colors">
                <Play className="w-3 h-3" />
                Декодировать ({DECODER_REGISTRY.find(d => d.id === activeDecoder)?.name})
              </button>
            )}
            <button onClick={runAll} disabled={training}
              className="w-full flex items-center justify-center gap-1.5 bg-signal-magenta/20 hover:bg-signal-magenta/30 text-signal-magenta rounded px-3 py-1.5 text-[10px] font-mono border border-signal-magenta/30 transition-colors disabled:opacity-50">
              <ArrowRightLeft className="w-3 h-3" />
              Запустить все декодеры
            </button>
          </div>

          {/* Comparison table */}
          {allResults.length > 0 && (
            <div className="chart-panel">
              <h3 className="text-[10px] font-mono font-semibold text-signal-magenta flex items-center gap-1 mb-2">
                <BarChart3 className="w-3 h-3" /> Сравнение декодеров
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[9px] font-mono">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1 text-muted-foreground font-normal">Метод</th>
                      <th className="text-right py-1 text-muted-foreground font-normal">Символы</th>
                      <th className="text-right py-1 text-muted-foreground font-normal">Текст %</th>
                      <th className="text-right py-1 text-muted-foreground font-normal">Edit</th>
                      <th className="text-right py-1 text-muted-foreground font-normal">Время</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonTable.map(row => (
                      <tr key={row.id}
                        onClick={() => setActiveDecoder(row.id as DecoderType)}
                        className={`border-b border-border/30 cursor-pointer transition-colors ${
                          activeDecoder === row.id ? "bg-signal-cyan/5" : "hover:bg-secondary/50"
                        }`}>
                        <td className={`py-1 ${row.done ? "text-foreground" : "text-muted-foreground"}`}>{row.name}</td>
                        <td className="text-right py-1 text-foreground">{row.symCorrect}</td>
                        <td className="text-right py-1">
                          <span className={
                            row.charAcc !== "—" && parseFloat(row.charAcc) > 80 ? "text-signal-green" :
                            row.charAcc !== "—" && parseFloat(row.charAcc) > 40 ? "text-signal-amber" :
                            row.charAcc !== "—" ? "text-signal-red" : "text-muted-foreground"
                          }>{row.charAcc}%</span>
                        </td>
                        <td className="text-right py-1 text-foreground">{row.editDist}</td>
                        <td className="text-right py-1 text-muted-foreground">{row.time}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right — results */}
        <div className={`space-y-3 ${showDB ? "lg:col-span-3" : "lg:col-span-4"}`}>
          {/* Signal preview */}
          <div className="chart-panel" style={{ height: 170 }}>
            <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">
              Сигнал{noiseLevel > 0 ? ` (σ=${(noiseLevel * 100).toFixed(0)}%)` : " (чистый)"}
              {dbSignalId && <span className="text-signal-amber ml-2">[из БД]</span>}
            </h3>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={signalPreview}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis dataKey="t" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
                {noiseLevel > 0 && <Line dataKey="noisy" stroke="hsl(var(--signal-red))" dot={false} strokeWidth={0.8} name="Зашумлённый" opacity={0.6} />}
                <Line dataKey="clean" stroke="hsl(var(--signal-blue))" dot={false} strokeWidth={1.2} name="Чистый" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {activeResult ? (
            <>
              {/* Decoded text */}
              <div className="chart-panel">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-signal-green" />
                  <h3 className="text-xs font-mono font-semibold text-signal-green">
                    Результат: {DECODER_REGISTRY.find(d => d.id === activeDecoder)?.name}
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[9px] font-mono text-muted-foreground mb-1">Оригинал:</p>
                    <p className="text-[11px] font-mono text-foreground bg-secondary rounded px-2 py-1.5 break-all">{text}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-muted-foreground mb-1">Декодировано:</p>
                    <p className="text-[11px] font-mono text-signal-cyan bg-secondary rounded px-2 py-1.5 break-all">
                      {activeResult.decodedText.slice(0, 200)}
                    </p>
                  </div>
                </div>
                {activeComparison && (
                  <div className="flex flex-wrap gap-4 mt-2 text-[10px] font-mono">
                    <span className="text-muted-foreground">
                      Точность: <span className={activeComparison.charAccuracy > 0.8 ? "text-signal-green" : activeComparison.charAccuracy > 0.4 ? "text-signal-amber" : "text-signal-red"}>
                        {(activeComparison.charAccuracy * 100).toFixed(1)}%
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      Совпадений: <span className="text-foreground">{activeComparison.matchingChars}/{activeComparison.totalChars}</span>
                    </span>
                    <span className="text-muted-foreground">
                      Edit dist: <span className="text-foreground">{activeComparison.editDistance}</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Symbol comparison */}
                <div className="chart-panel" style={{ height: 210 }}>
                  <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Символы: оригинал vs декод</h3>
                  <ResponsiveContainer width="100%" height="88%">
                    <BarChart data={symbolCompareData.slice(0, 20)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                      <XAxis dataKey="idx" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                      <Legend wrapperStyle={{ fontSize: 9 }} />
                      <Bar dataKey="original" fill="hsl(var(--signal-blue))" name="Оригинал" opacity={0.6} />
                      <Bar dataKey="decoded" name="Декод">
                        {symbolCompareData.slice(0, 20).map((d, i) => (
                          <Cell key={i} fill={d.correct ? "hsl(142 70% 50%)" : "hsl(0 80% 58%)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Confidence */}
                <div className="chart-panel" style={{ height: 210 }}>
                  <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Уверенность декодера</h3>
                  <ResponsiveContainer width="100%" height="88%">
                    <LineChart data={symbolCompareData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                      <XAxis dataKey="idx" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                      <Line dataKey="confidence" stroke="hsl(var(--signal-amber))" dot={false} strokeWidth={1.5} name="Уверенность %" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* MLP-specific: training loss */}
              {activeDecoder === "mlp" && mlpTrain && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="chart-panel" style={{ height: 200 }}>
                    <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Кривая обучения MLP</h3>
                    <ResponsiveContainer width="100%" height="85%">
                      <LineChart data={lossData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                        <XAxis dataKey="epoch" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                        <Line dataKey="loss" stroke="hsl(var(--signal-red))" dot={false} strokeWidth={1.5} name="Loss" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="chart-panel">
                    <h3 className="text-[10px] font-mono font-semibold text-signal-magenta flex items-center gap-1 mb-2">
                      <BarChart3 className="w-3 h-3" /> Метрики MLP
                    </h3>
                    <div className="space-y-1.5 text-[10px] font-mono">
                      <div className="flex justify-between"><span className="text-muted-foreground">Точность (train):</span>
                        <span className={mlpTrain.accuracy > 0.8 ? "text-signal-green" : "text-signal-amber"}>{(mlpTrain.accuracy * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Final loss:</span>
                        <span className="text-foreground">{mlpTrain.epochLosses[mlpTrain.epochLosses.length - 1]?.toFixed(4)}</span>
                      </div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Эпох:</span>
                        <span className="text-foreground">{mlpTrain.epochLosses.length}</span>
                      </div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Классов (M):</span>
                        <span className="text-foreground">{M}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="chart-panel flex flex-col items-center justify-center py-16 text-center">
              <RotateCcw className="w-10 h-10 text-muted-foreground mb-3 opacity-40" />
              <p className="text-sm font-mono text-muted-foreground">Выберите декодер и запустите</p>
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                4 типа декодеров: MLP (обучаемый), корреляционный, энергетический, шаблонный
              </p>
              <p className="text-[10px] font-mono text-muted-foreground/60 mt-3 max-w-md">
                Загрузите сигнал из БД или введите текст · Нажмите «Запустить все» для сравнения
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
