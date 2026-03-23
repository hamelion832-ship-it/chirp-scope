import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Brain, Play, Loader2, CheckCircle2, AlertTriangle, Sparkles, Zap,
  Settings2, BarChart3, Radio, Waves, Activity, Sliders,
} from "lucide-react";
import { fetchSignals, type StoredSignal } from "@/lib/signal-db";
import { generateLoRaSignal } from "@/lib/lora-signal";
import {
  generateFHSSSignal,
  trainUnifiedFormula,
  formatUnifiedFormula,
  evaluateUnifiedFormula,
  generateUnifiedPrediction,
  DEFAULT_FHSS_PARAMS,
  DEFAULT_CHANNEL_PARAMS,
  DEFAULT_UNIFIED_COEFFS,
  UNIFIED_COEFF_LABELS,
  type FHSSParams,
  type ChannelParams,
  type UnifiedCoeffs,
  type UnifiedTrainingResult,
} from "@/lib/fhss-signal";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ScatterChart, Scatter, BarChart, Bar, Cell,
} from "recharts";

type SignalSource = "db" | "fhss";
type TrainMode = "single" | "channel_sweep";

interface ChannelSweepResult {
  paramName: string;
  paramValue: number;
  result: UnifiedTrainingResult;
}

export function UnifiedModelPanel() {
  // Signal sources
  const [signals, setSignals] = useState<StoredSignal[]>([]);
  const [selectedDbIds, setSelectedDbIds] = useState<string[]>([]);
  const [signalSource, setSignalSource] = useState<SignalSource>("fhss");

  // FHSS params
  const [fhssParams, setFhssParams] = useState<FHSSParams>(DEFAULT_FHSS_PARAMS);
  const [channelParams, setChannelParams] = useState<ChannelParams>(DEFAULT_CHANNEL_PARAMS);
  const [useChannel, setUseChannel] = useState(true);
  const [fhssText, setFhssText] = useState("Философ спокойно создаёт старую книгу.");

  // Training
  const [config, setConfig] = useState({ learningRate: 0.03, epochs: 800, batchSize: 64 });
  const [training, setTraining] = useState(false);
  const [progress, setProgress] = useState(0);
  const [trainMode, setTrainMode] = useState<TrainMode>("single");

  // Results
  const [result, setResult] = useState<UnifiedTrainingResult | null>(null);
  const [sweepResults, setSweepResults] = useState<ChannelSweepResult[]>([]);
  const [editCoeffs, setEditCoeffs] = useState<UnifiedCoeffs | null>(null);

  // AI
  const [suggesting, setSuggesting] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

  useEffect(() => { fetchSignals().then(setSignals); }, []);

  // Build samples from FHSS signal
  const buildFHSSSamples = useCallback(() => {
    const sig = generateFHSSSignal(
      fhssParams,
      fhssText,
      useChannel ? channelParams : undefined
    );
    const maxPts = Math.min(sig.real.length, 500);
    const step = Math.max(1, Math.floor(sig.real.length / maxPts));
    const samples: { t: number; y: number }[] = [];
    for (let i = 0; i < sig.real.length && samples.length < maxPts; i += step) {
      samples.push({ t: sig.time[i] * 1000, y: sig.real[i] });
    }
    return { samples, signal: sig };
  }, [fhssParams, fhssText, useChannel, channelParams]);

  // Build samples from DB signal
  const buildDbSamples = useCallback((stored: StoredSignal) => {
    const params = { sf: stored.sf, bw: stored.bw, fc: stored.fc, sampleRate: 500e3 };
    const byteLen = new TextEncoder().encode(stored.message_text).length;
    const maxSym = Math.max(1, Math.floor((Math.min(byteLen, 1240) * 8) / stored.sf));
    const sig = generateLoRaSignal(params, stored.message_text, Math.min(stored.n_symbols, maxSym));
    const maxPts = Math.min(sig.real.length, 500);
    const step = Math.max(1, Math.floor(sig.real.length / maxPts));
    const samples: { t: number; y: number }[] = [];
    for (let i = 0; i < sig.real.length && samples.length < maxPts; i += step) {
      samples.push({ t: sig.time[i] * 1000, y: sig.real[i] });
    }
    return samples;
  }, []);

  // Train
  const handleTrain = useCallback(async () => {
    setTraining(true);
    setProgress(0);

    try {
      if (trainMode === "single") {
        let samples: { t: number; y: number }[];
        if (signalSource === "fhss") {
          samples = buildFHSSSamples().samples;
        } else {
          const stored = signals.find(s => s.id === selectedDbIds[0]);
          if (!stored) { toast.error("Выберите сигнал"); setTraining(false); return; }
          samples = buildDbSamples(stored);
        }

        const res = trainUnifiedFormula(samples, config, undefined, (ep, loss) => {
          setProgress((ep / config.epochs) * 100);
        });
        setResult(res);
        toast.success(`Обучение завершено: R²=${res.r2.toFixed(4)}`);
      } else {
        // Channel sweep
        const sweepParam = "snrDb";
        const sweepValues = [5, 10, 15, 20, 25, 30];
        const results: ChannelSweepResult[] = [];

        for (let i = 0; i < sweepValues.length; i++) {
          const chParams = { ...channelParams, [sweepParam]: sweepValues[i] };
          const sig = generateFHSSSignal(fhssParams, fhssText, chParams);
          const maxPts = Math.min(sig.real.length, 400);
          const step = Math.max(1, Math.floor(sig.real.length / maxPts));
          const samples: { t: number; y: number }[] = [];
          for (let j = 0; j < sig.real.length && samples.length < maxPts; j += step) {
            samples.push({ t: sig.time[j] * 1000, y: sig.real[j] });
          }

          const res = trainUnifiedFormula(samples, config);
          results.push({ paramName: "SNR (dB)", paramValue: sweepValues[i], result: res });
          setProgress(((i + 1) / sweepValues.length) * 100);
          await new Promise(r => setTimeout(r, 10));
        }

        setSweepResults(results);
        if (results.length > 0) setResult(results[results.length - 1].result);
        toast.success(`Sweep завершён: ${results.length} конфигураций`);
      }
    } catch (e) {
      toast.error("Ошибка обучения");
    } finally {
      setTraining(false);
    }
  }, [trainMode, signalSource, buildFHSSSamples, buildDbSamples, signals, selectedDbIds, config, fhssParams, fhssText, channelParams]);

  // AI analysis
  const handleAIAnalysis = useCallback(async () => {
    if (!result) { toast.error("Сначала обучите модель"); return; }
    setSuggesting(true);
    setAiAnalysis(null);
    try {
      const { data, error } = await supabase.functions.invoke('suggest-formula', {
        body: {
          signalStats: {
            sf: fhssParams.sf,
            bw: fhssParams.bw,
            duration: fhssParams.numHops * fhssParams.tHop,
            nSymbols: fhssParams.numHops,
            sampleCount: 500,
            meanAmp: 0,
            maxAmp: result.coefficients.A,
            stdAmp: 0.5,
            zeroCrossings: Math.round(result.coefficients.f0 * 10),
            trend: result.coefficients.alpha > 0.1 ? 'decaying' : 'stable',
          },
          unifiedResult: {
            r2: result.r2,
            mse: result.mse,
            coefficients: result.coefficients,
            channelMetrics: result.channelMetrics,
          },
        },
      });
      if (error) throw error;
      setAiAnalysis(data?.reasoning || "Анализ завершён");
      toast.success("ИИ анализ получен");
    } catch (e) {
      toast.error("Ошибка ИИ анализа");
    } finally {
      setSuggesting(false);
    }
  }, [result, fhssParams]);

  // Comparison data
  const comparisonData = useMemo(() => {
    if (!result) return [];
    let samples: { t: number; y: number }[];
    if (signalSource === "fhss") {
      samples = buildFHSSSamples().samples;
    } else {
      const stored = signals.find(s => s.id === selectedDbIds[0]);
      if (!stored) return [];
      samples = buildDbSamples(stored);
    }
    const tMin = samples[0]?.t ?? 0;
    const tMax = samples[samples.length - 1]?.t ?? 1;
    const predicted = generateUnifiedPrediction(result.coefficients, tMin, tMax, samples.length);
    return samples.map((s, i) => ({
      t: +s.t.toFixed(3),
      original: +s.y.toFixed(6),
      predicted: +(predicted[i]?.y ?? 0).toFixed(6),
      error: +Math.abs(s.y - (predicted[i]?.y ?? 0)).toFixed(6),
    }));
  }, [result, signalSource, buildFHSSSamples, buildDbSamples, signals, selectedDbIds]);

  const lossData = useMemo(() => {
    if (!result) return [];
    const step = Math.max(1, Math.floor(result.epochLosses.length / 200));
    return result.epochLosses
      .filter((_, i) => i % step === 0)
      .map((loss, i) => ({ epoch: i * step, loss }));
  }, [result]);

  // FHSS signal preview
  const fhssPreview = useMemo(() => {
    const { samples, signal } = buildFHSSSamples();
    return {
      timeDomain: samples.slice(0, 300).map(s => ({ t: +s.t.toFixed(3), y: +s.y.toFixed(6) })),
      freqData: Array.from(signal.instantFreq)
        .filter((_, i) => i % Math.max(1, Math.floor(signal.instantFreq.length / 300)) === 0)
        .slice(0, 300)
        .map((f, i) => ({ t: i, freq: +((f || 0) / 1000).toFixed(2) })),
    };
  }, [buildFHSSSamples]);

  const applyEditedCoeffs = useCallback(() => {
    if (!editCoeffs || !result) return;
    // Recalculate metrics with edited coefficients
    let samples: { t: number; y: number }[];
    if (signalSource === "fhss") {
      samples = buildFHSSSamples().samples;
    } else {
      const stored = signals.find(s => s.id === selectedDbIds[0]);
      if (!stored) return;
      samples = buildDbSamples(stored);
    }
    const tMax = Math.max(...samples.map(s => s.t), 1e-9);
    let totalSqErr = 0, maxErr = 0, yMean = 0, ssTot = 0;
    for (const s of samples) yMean += s.y;
    yMean /= samples.length;
    for (const s of samples) {
      const pred = evaluateUnifiedFormula(s.t / tMax, editCoeffs);
      totalSqErr += (pred - s.y) ** 2;
      maxErr = Math.max(maxErr, Math.abs(pred - s.y));
      ssTot += (s.y - yMean) ** 2;
    }
    setResult({
      ...result,
      coefficients: { ...editCoeffs },
      mse: totalSqErr / samples.length,
      r2: ssTot > 0 ? 1 - totalSqErr / ssTot : 0,
      maxError: maxErr,
    });
    setEditCoeffs(null);
    toast.success("Коэффициенты применены");
  }, [editCoeffs, result, signalSource, buildFHSSSamples, buildDbSamples, signals, selectedDbIds]);

  return (
    <div className="space-y-3">
      {/* Header controls */}
      <div className="chart-panel space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-signal-magenta" />
            <span className="text-sm font-mono font-semibold text-foreground">
              Единая модель: s(t;Θ,Φ,Ψ)
            </span>
          </div>
          <div className="flex gap-1 ml-auto">
            <button onClick={() => setSignalSource("fhss")}
              className={`text-[10px] font-mono px-2.5 py-1 rounded border transition-colors ${
                signalSource === "fhss" ? "bg-signal-magenta/20 text-signal-magenta border-signal-magenta/40" : "bg-secondary text-muted-foreground border-border"
              }`}>FHSS генератор</button>
            <button onClick={() => setSignalSource("db")}
              className={`text-[10px] font-mono px-2.5 py-1 rounded border transition-colors ${
                signalSource === "db" ? "bg-signal-cyan/20 text-signal-cyan border-signal-cyan/40" : "bg-secondary text-muted-foreground border-border"
              }`}>Из БД</button>
          </div>
        </div>

        {/* Unified formula display */}
        <div className="text-[10px] font-mono text-muted-foreground bg-secondary/50 rounded px-3 py-2">
          <span className="text-signal-magenta">
            s(t) = Σ A·PL·α_ch · e^(-αt) · cos(2π·[f₀ + Δf·H_k + β·t_loc]·t + φ + 2π·f_d·t) + C
          </span>
          <span className="ml-2">— FHSS + канал распространения</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Left panel — params */}
        <div className="lg:col-span-1 space-y-3">
          {/* FHSS or DB selector */}
          {signalSource === "fhss" ? (
            <div className="chart-panel space-y-2">
              <h3 className="text-xs font-mono font-semibold text-signal-amber flex items-center gap-1">
                <Sliders className="w-3 h-3" /> Параметры FHSS (Φ)
              </h3>
              <div className="space-y-1.5">
                {([
                  ["numHops", "N_f (скачков)", 1, 32, 1],
                  ["tHop", "T_hop (мс)", 0.1, 10, 0.1],
                  ["deltaFh", "Δf_h (кГц)", 1, 100, 1],
                  ["deltaFm", "Δf_m (кГц)", 0.1, 10, 0.1],
                ] as [string, string, number, number, number][]).map(([key, label, min, max, step]) => (
                  <div key={key} className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-muted-foreground">{label}</span>
                    <input type="number" min={min} max={max} step={step}
                      value={key === "tHop" ? fhssParams[key] * 1000 :
                             key === "deltaFh" || key === "deltaFm" ? (fhssParams[key as keyof FHSSParams] as number) / 1000 :
                             fhssParams[key as keyof FHSSParams] as number}
                      onChange={e => {
                        const v = Number(e.target.value);
                        setFhssParams(p => ({
                          ...p,
                          [key]: key === "tHop" ? v / 1000 :
                                 key === "deltaFh" || key === "deltaFm" ? v * 1000 : v,
                        }));
                      }}
                      className="bg-secondary text-foreground rounded px-1.5 py-0.5 text-[10px] font-mono border border-border w-16 text-right" />
                  </div>
                ))}
              </div>

              {/* Channel params */}
              <div className="border-t border-border pt-2 mt-2">
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="text-[10px] font-mono font-semibold text-signal-cyan flex items-center gap-1">
                    <Waves className="w-3 h-3" /> Канал (Ψ)
                  </h4>
                  <button onClick={() => setUseChannel(!useChannel)}
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                      useChannel ? "bg-signal-green/20 text-signal-green" : "bg-secondary text-muted-foreground"
                    }`}>{useChannel ? "ON" : "OFF"}</button>
                </div>
                {useChannel && (
                  <div className="space-y-1">
                    {([
                      ["snrDb", "SNR (дБ)", -5, 40, 1],
                      ["pathLossExponent", "n (пот. потерь)", 1.5, 5, 0.1],
                      ["distance", "d (м)", 1, 10000, 10],
                      ["dopplerHz", "f_d (Гц)", 0, 200, 5],
                      ["multipathTaps", "Лучей", 1, 10, 1],
                      ["ricianK", "K (Райс)", 0, 20, 1],
                    ] as [string, string, number, number, number][]).map(([key, label, min, max, step]) => (
                      <div key={key} className="flex items-center justify-between text-[10px] font-mono">
                        <span className="text-muted-foreground">{label}</span>
                        <input type="number" min={min} max={max} step={step}
                          value={channelParams[key as keyof ChannelParams] as number}
                          onChange={e => setChannelParams(p => ({ ...p, [key]: Number(e.target.value) }))}
                          className="bg-secondary text-foreground rounded px-1.5 py-0.5 text-[10px] font-mono border border-border w-16 text-right" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Text */}
              <div className="border-t border-border pt-2 mt-2">
                <label className="text-[10px] font-mono text-muted-foreground">Текст (Θ)</label>
                <textarea value={fhssText} onChange={e => setFhssText(e.target.value)} rows={2}
                  className="w-full bg-secondary text-secondary-foreground rounded px-2 py-1 text-[10px] font-mono border border-border mt-1 resize-none" />
              </div>
            </div>
          ) : (
            <div className="chart-panel" style={{ maxHeight: 400, overflowY: "auto" }}>
              <h3 className="text-xs font-mono font-semibold text-signal-amber mb-2 flex items-center gap-2">
                Сигналы из БД
                {selectedDbIds.length > 0 && (
                  <span className="text-[9px] text-signal-green bg-signal-green/10 px-1.5 py-0.5 rounded">
                    {selectedDbIds.length} выбр.
                  </span>
                )}
              </h3>
              {signals.map(s => (
                <div key={s.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-mono cursor-pointer transition-colors mb-0.5 ${
                    selectedDbIds.includes(s.id) ? "bg-signal-cyan/20 border border-signal-cyan/30" : "hover:bg-secondary"
                  }`}
                  onClick={() => setSelectedDbIds(prev =>
                    prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id]
                  )}>
                  <input type="checkbox" checked={selectedDbIds.includes(s.id)} readOnly className="accent-signal-cyan w-3 h-3" />
                  <span className="flex-1 truncate text-foreground">{s.message_text.slice(0, 28)}</span>
                  <span className="text-muted-foreground">SF{s.sf}</span>
                </div>
              ))}
            </div>
          )}

          {/* Training controls */}
          <div className="chart-panel space-y-2">
            <h3 className="text-xs font-mono font-semibold text-signal-green flex items-center gap-1">
              <Settings2 className="w-3 h-3" /> Обучение
            </h3>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                ["learningRate", "LR", 0.001, 0.5, 0.005],
                ["epochs", "Эпохи", 100, 5000, 100],
                ["batchSize", "Batch", 16, 256, 16],
              ] as [string, string, number, number, number][]).map(([key, label, min, max, step]) => (
                <div key={key} className="flex flex-col gap-0.5">
                  <label className="text-[9px] font-mono text-muted-foreground">{label}</label>
                  <input type="number" min={min} max={max} step={step}
                    value={config[key as keyof typeof config]}
                    onChange={e => setConfig(c => ({ ...c, [key]: Number(e.target.value) }))}
                    className="bg-secondary text-foreground rounded px-1 py-0.5 text-[10px] font-mono border border-border w-full" />
                </div>
              ))}
            </div>

            <div className="flex gap-1.5">
              <button onClick={() => setTrainMode("single")}
                className={`flex-1 text-[10px] font-mono py-1 rounded border transition-colors ${
                  trainMode === "single" ? "bg-signal-green/20 text-signal-green border-signal-green/40" : "bg-secondary text-muted-foreground border-border"
                }`}>Одиночное</button>
              <button onClick={() => setTrainMode("channel_sweep")}
                className={`flex-1 text-[10px] font-mono py-1 rounded border transition-colors ${
                  trainMode === "channel_sweep" ? "bg-signal-amber/20 text-signal-amber border-signal-amber/40" : "bg-secondary text-muted-foreground border-border"
                }`}>Sweep SNR</button>
            </div>

            <button onClick={handleTrain} disabled={training}
              className="w-full flex items-center justify-center gap-1.5 bg-signal-green/20 hover:bg-signal-green/30 text-signal-green rounded px-3 py-2 text-xs font-mono border border-signal-green/30 transition-colors disabled:opacity-50">
              {training ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {training ? `${progress.toFixed(0)}%` : "Обучить единую модель"}
            </button>

            {result && (
              <button onClick={handleAIAnalysis} disabled={suggesting}
                className="w-full flex items-center justify-center gap-1.5 bg-signal-magenta/20 hover:bg-signal-magenta/30 text-signal-magenta rounded px-3 py-1.5 text-[10px] font-mono border border-signal-magenta/30 transition-colors disabled:opacity-50">
                {suggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                ИИ анализ формулы
              </button>
            )}
          </div>
        </div>

        {/* Right panel — results */}
        <div className="lg:col-span-3 space-y-3">
          {/* Signal preview */}
          {signalSource === "fhss" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="chart-panel" style={{ height: 200 }}>
                <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">FHSS сигнал (Re)</h3>
                <ResponsiveContainer width="100%" height="88%">
                  <LineChart data={fhssPreview.timeDomain}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="t" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                    <Line dataKey="y" stroke="hsl(var(--signal-magenta))" dot={false} strokeWidth={1} name="Re(s)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-panel" style={{ height: 200 }}>
                <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Частотные скачки</h3>
                <ResponsiveContainer width="100%" height="88%">
                  <LineChart data={fhssPreview.freqData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="t" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                    <Line dataKey="freq" stroke="hsl(var(--signal-amber))" dot={false} strokeWidth={1.5} name="f (кГц)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {result ? (
            <>
              {/* Formula display */}
              <div className="chart-panel">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-mono font-semibold text-signal-green">Единая формула ℱ(t,Θ,Φ,Ψ)</h3>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono ${result.r2 > 0.8 ? "text-signal-green" : result.r2 > 0.5 ? "text-signal-amber" : "text-signal-red"}`}>
                      R²={result.r2.toFixed(4)}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">MSE={result.mse.toFixed(6)}</span>
                  </div>
                </div>
                <div className="bg-secondary rounded px-3 py-2 text-[10px] font-mono text-signal-cyan break-all leading-relaxed">
                  {formatUnifiedFormula(result.coefficients)}
                </div>
              </div>

              {/* AI analysis */}
              {aiAnalysis && (
                <div className="chart-panel bg-signal-magenta/5 border-signal-magenta/20">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Sparkles className="w-4 h-4 text-signal-magenta" />
                    <span className="text-xs font-mono font-semibold text-signal-magenta">ИИ анализ</span>
                  </div>
                  <p className="text-[10px] font-mono text-foreground/80 leading-relaxed">{aiAnalysis}</p>
                </div>
              )}

              {/* Charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="chart-panel" style={{ height: 260 }}>
                  <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Оригинал vs Модель</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <LineChart data={comparisonData.filter((_, i) => i % Math.max(1, Math.floor(comparisonData.length / 300)) === 0)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                      <XAxis dataKey="t" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                      <Legend wrapperStyle={{ fontSize: 9 }} />
                      <Line dataKey="original" stroke="hsl(var(--signal-blue))" dot={false} strokeWidth={1.5} name="Оригинал" />
                      <Line dataKey="predicted" stroke="hsl(var(--signal-green))" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="Модель" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="chart-panel" style={{ height: 260 }}>
                  <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Кривая обучения</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <LineChart data={lossData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                      <XAxis dataKey="epoch" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                      <Line dataKey="loss" stroke="hsl(var(--signal-red))" dot={false} strokeWidth={1.5} name="MSE" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Coefficients + Channel metrics */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Coefficients editor */}
                <div className="chart-panel">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-mono font-semibold text-signal-amber flex items-center gap-1">
                      <Settings2 className="w-3 h-3" /> Коэффициенты Θ+Φ
                    </h3>
                    {editCoeffs ? (
                      <div className="flex gap-1">
                        <button onClick={applyEditedCoeffs}
                          className="text-[9px] font-mono bg-signal-green/20 text-signal-green px-1.5 py-0.5 rounded">OK</button>
                        <button onClick={() => setEditCoeffs(null)}
                          className="text-[9px] font-mono text-muted-foreground px-1.5 py-0.5 rounded">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setEditCoeffs({ ...result.coefficients })}
                        className="text-[9px] font-mono text-signal-cyan underline">Ред.</button>
                    )}
                  </div>
                  <div className="space-y-0.5" style={{ maxHeight: 220, overflowY: "auto" }}>
                    {Object.keys(UNIFIED_COEFF_LABELS).map(k => (
                      <div key={k} className="flex items-center justify-between text-[10px] font-mono">
                        <span className="text-muted-foreground truncate mr-1">{UNIFIED_COEFF_LABELS[k]}</span>
                        {editCoeffs ? (
                          <input type="number" step="0.01"
                            value={(editCoeffs as unknown as Record<string, number>)[k] ?? 0}
                            onChange={e => setEditCoeffs(prev => prev ? { ...prev, [k]: Number(e.target.value) } as UnifiedCoeffs : null)}
                            className="bg-secondary text-foreground rounded px-1 py-0.5 text-[10px] font-mono border border-border w-20 text-right" />
                        ) : (
                          <span className="text-foreground">
                            {((result.coefficients as unknown as Record<string, number>)[k] ?? 0).toFixed(4)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Channel metrics */}
                <div className="chart-panel">
                  <h3 className="text-[10px] font-mono font-semibold text-signal-cyan flex items-center gap-1 mb-2">
                    <Waves className="w-3 h-3" /> Канал Ψ
                  </h3>
                  <div className="space-y-1.5 text-[10px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SNR (оценка):</span>
                      <span className="text-foreground">{result.channelMetrics.snrEstimate.toFixed(1)} дБ</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Path Loss:</span>
                      <span className="text-foreground">{result.channelMetrics.pathLossDb.toFixed(1)} дБ</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Когер. полоса:</span>
                      <span className="text-foreground">{(result.channelMetrics.coherenceBandwidth / 1000).toFixed(2)} кГц</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Доплер (выч.):</span>
                      <span className="text-foreground">{result.coefficients.dopplerShift.toFixed(4)} Гц</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Замирание:</span>
                      <span className="text-foreground">{result.coefficients.fadingGain.toFixed(4)}</span>
                    </div>
                  </div>
                </div>

                {/* Quality */}
                <div className="chart-panel">
                  <h3 className="text-[10px] font-mono font-semibold text-signal-magenta flex items-center gap-1 mb-2">
                    <BarChart3 className="w-3 h-3" /> Качество модели
                  </h3>
                  <div className="space-y-1.5 text-[10px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">MSE:</span>
                      <span className="text-foreground">{result.mse.toFixed(8)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">R²:</span>
                      <span className={result.r2 > 0.8 ? "text-signal-green" : result.r2 > 0.5 ? "text-signal-amber" : "text-signal-red"}>
                        {result.r2.toFixed(6)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Max ошибка:</span>
                      <span className="text-foreground">{result.maxError.toFixed(6)}</span>
                    </div>
                    <div className="border-t border-border pt-1.5 mt-2">
                      <div className="flex items-center gap-1">
                        {result.r2 > 0.8 ? (
                          <><CheckCircle2 className="w-3 h-3 text-signal-green" /><span className="text-signal-green">Хорошая модель</span></>
                        ) : result.r2 > 0.5 ? (
                          <><AlertTriangle className="w-3 h-3 text-signal-amber" /><span className="text-signal-amber">Среднее качество</span></>
                        ) : (
                          <><AlertTriangle className="w-3 h-3 text-signal-red" /><span className="text-signal-red">Требует доработки</span></>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sweep results */}
              {sweepResults.length > 0 && (
                <div className="chart-panel">
                  <h3 className="text-xs font-mono font-semibold text-signal-amber mb-2">
                    Оптимизация канала: R² vs SNR
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={sweepResults.map(sr => ({
                        snr: sr.paramValue,
                        r2: +sr.result.r2.toFixed(4),
                        mse: +sr.result.mse.toFixed(6),
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                        <XAxis dataKey="snr" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} label={{ value: "SNR (дБ)", fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                        <Bar dataKey="r2" name="R²">
                          {sweepResults.map((sr, i) => (
                            <Cell key={i} fill={sr.result.r2 > 0.8 ? "hsl(142 70% 50%)" : sr.result.r2 > 0.5 ? "hsl(40 95% 55%)" : "hsl(0 80% 58%)"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[10px] font-mono">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-1 text-muted-foreground">SNR</th>
                            <th className="text-right py-1 text-muted-foreground">R²</th>
                            <th className="text-right py-1 text-muted-foreground">MSE</th>
                            <th className="text-right py-1 text-muted-foreground">PL (дБ)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sweepResults.map((sr, i) => (
                            <tr key={i} className="border-b border-border/50">
                              <td className="py-1 text-foreground">{sr.paramValue} дБ</td>
                              <td className={`text-right py-1 ${sr.result.r2 > 0.8 ? "text-signal-green" : "text-signal-amber"}`}>
                                {sr.result.r2.toFixed(4)}
                              </td>
                              <td className="text-right py-1 text-foreground">{sr.result.mse.toFixed(6)}</td>
                              <td className="text-right py-1 text-foreground">{sr.result.channelMetrics.pathLossDb.toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Error distribution */}
              {comparisonData.length > 0 && (
                <div className="chart-panel" style={{ height: 200 }}>
                  <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Распределение ошибки</h3>
                  <ResponsiveContainer width="100%" height="88%">
                    <LineChart data={comparisonData.filter((_, i) => i % Math.max(1, Math.floor(comparisonData.length / 300)) === 0)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                      <XAxis dataKey="t" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                      <Line dataKey="error" stroke="hsl(var(--signal-red))" dot={false} strokeWidth={1} name="|ε(t)|" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          ) : (
            <div className="chart-panel flex flex-col items-center justify-center py-16 text-center lg:col-span-3">
              <Brain className="w-10 h-10 text-muted-foreground mb-3 opacity-40" />
              <p className="text-sm font-mono text-muted-foreground">Настройте параметры и запустите обучение</p>
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                s(t;Θ,Φ,Ψ) = ℱ(текст, FHSS, канал) — единая модель сигнала
              </p>
              <p className="text-[10px] font-mono text-muted-foreground/60 mt-3 max-w-md">
                Θ — параметры текстовых данных · Φ — параметры FHSS · Ψ — параметры канала распространения
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
