import { useState, useEffect, useMemo, useCallback } from "react";
import { Brain, Play, Settings2, BarChart3, Loader2, CheckCircle2, AlertTriangle, Sparkles, Zap } from "lucide-react";
import { fetchSignals, type StoredSignal } from "@/lib/signal-db";
import {
  trainFormula, generatePrediction, formatFormula, evaluateFormula, autoFitBest,
  FORMULA_TYPES, DEFAULT_COEFFS, COEFF_LABELS,
  type FormulaType, type FormulaCoefficients, type TrainingConfig, type TrainingResult, type SignalSample,
} from "@/lib/neural-formula";
import { generateLoRaSignal } from "@/lib/lora-signal";
import {
  generateModulatedSignal, getMaxSymbols,
  MODULATION_REGISTRY, type ModulationType, type ModulationParams,
} from "@/lib/modulation-engine";
import { getProtocolGroup, PROTOCOL_CHART_COLORS, type ProtocolGroup } from "@/lib/protocol-classify";
import { ProtocolSelector } from "@/components/ProtocolSelector";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell,
} from "recharts";

const DEFAULT_CONFIG: TrainingConfig = { learningRate: 0.05, epochs: 500, batchSize: 64 };

interface AISuggestion { formulaType: FormulaType; confidence: number; reasoning: string; alternativeType?: FormulaType; }

// Per-protocol training result
interface ProtocolTrainingResult {
  protocol: ModulationType;
  group: ProtocolGroup;
  signalIds: string[];
  result: TrainingResult;
}

export function NeuralFormulaPanel() {
  const [signals, setSignals] = useState<StoredSignal[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [config, setConfig] = useState<TrainingConfig>(DEFAULT_CONFIG);
  const [results, setResults] = useState<Map<string, TrainingResult>>(new Map());
  const [training, setTraining] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeSignalId, setActiveSignalId] = useState<string | null>(null);
  const [editCoeffs, setEditCoeffs] = useState<FormulaCoefficients | null>(null);
  const [formulaType, setFormulaType] = useState<FormulaType>('chirp');
  const [autoFit, setAutoFit] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [unifiedMode, setUnifiedMode] = useState(false);
  // Multi-protocol: train with multiple protocols
  const [selectedProtocols, setSelectedProtocols] = useState<ModulationType[]>(["lora"]);
  const [perProtocolResults, setPerProtocolResults] = useState<ProtocolTrainingResult[]>([]);

  useEffect(() => { fetchSignals().then(setSignals); }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const toggleProtocol = useCallback((p: ModulationType) => {
    setSelectedProtocols(prev =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter(x => x !== p) : prev) : [...prev, p]
    );
  }, []);

  const buildSamples = useCallback((stored: StoredSignal, modType: ModulationType): SignalSample[] => {
    // Use stored signal's own mod_type if available, otherwise use the passed modType
    const effectiveModType = (stored.mod_type as ModulationType) || modType;
    const byteLen = new TextEncoder().encode(stored.message_text).length;
    let sig: { time: number[]; real: number[] };
    if (effectiveModType === "lora") {
      const params = { sf: stored.sf, bw: stored.bw, fc: stored.fc, sampleRate: 500e3 };
      const maxSym = Math.max(1, Math.floor((Math.min(byteLen, 1240) * 8) / stored.sf));
      sig = generateLoRaSignal(params, stored.message_text, Math.min(stored.n_symbols, maxSym));
    } else {
      const maxSym = getMaxSymbols(stored.message_text, effectiveModType);
      const modParams: ModulationParams = {
        type: effectiveModType, sampleRate: effectiveModType === "cdma" ? 500000 : 200000,
        symbolRate: 10000, fc: 915e6, freqDeviation: 25000, chipRate: 100000, spreadingCode: 0,
      };
      sig = generateModulatedSignal(modParams, stored.message_text, Math.min(stored.n_symbols, maxSym));
    }
    const maxPts = Math.min(sig.real.length, 400);
    const step = Math.max(1, Math.floor(sig.real.length / maxPts));
    const samples: SignalSample[] = [];
    for (let i = 0; i < sig.real.length && samples.length < maxPts; i += step) {
      samples.push({ t: sig.time[i] * 1000, y: sig.real[i] });
    }
    return samples;
  }, []);

  const computeSignalStats = useCallback((stored: StoredSignal, samples: SignalSample[]) => {
    const amps = samples.map(s => s.y);
    const mean = amps.reduce((a, b) => a + b, 0) / amps.length;
    const std = Math.sqrt(amps.reduce((a, b) => a + (b - mean) ** 2, 0) / amps.length);
    const max = Math.max(...amps.map(Math.abs));
    let zeroCrossings = 0;
    for (let i = 1; i < amps.length; i++) {
      if ((amps[i] >= 0) !== (amps[i - 1] >= 0)) zeroCrossings++;
    }
    const firstHalf = amps.slice(0, Math.floor(amps.length / 2));
    const secondHalf = amps.slice(Math.floor(amps.length / 2));
    const firstMean = Math.sqrt(firstHalf.reduce((a, b) => a + b * b, 0) / firstHalf.length);
    const secondMean = Math.sqrt(secondHalf.reduce((a, b) => a + b * b, 0) / secondHalf.length);
    const trend = secondMean < firstMean * 0.8 ? 'decaying' : secondMean > firstMean * 1.2 ? 'growing' : 'stable';
    return { sf: stored.sf, bw: stored.bw, duration: stored.duration, nSymbols: stored.n_symbols,
      sampleCount: samples.length, meanAmp: mean, maxAmp: max, stdAmp: std, zeroCrossings, trend };
  }, []);

  const handleAISuggest = useCallback(async () => {
    if (selected.length === 0) { toast.error("Выберите хотя бы один сигнал"); return; }
    setSuggesting(true); setAiSuggestion(null);
    try {
      const stored = signals.find(s => s.id === selected[0]);
      if (!stored) throw new Error("Signal not found");
      const samples = buildSamples(stored, selectedProtocols[0]);
      const stats = computeSignalStats(stored, samples);
      const { data, error } = await supabase.functions.invoke('suggest-formula', { body: { signalStats: stats } });
      if (error) throw error;
      setAiSuggestion(data as AISuggestion);
      toast.success("ИИ предложил формулу");
    } catch (e: unknown) {
      toast.error(`Ошибка ИИ: ${e instanceof Error ? e.message : "Ошибка"}`);
    } finally { setSuggesting(false); }
  }, [selected, signals, buildSamples, computeSignalStats, selectedProtocols]);

  const applyAISuggestion = useCallback(() => {
    if (aiSuggestion) { setFormulaType(aiSuggestion.formulaType); toast.info(`Выбрана формула: ${FORMULA_TYPES[aiSuggestion.formulaType].label}`); }
  }, [aiSuggestion]);

  const handleTrain = useCallback(async () => {
    if (selected.length === 0) return;
    setTraining(true); setProgress(0);
    const newResults = new Map<string, TrainingResult>();
    const protocolResults: ProtocolTrainingResult[] = [];
    const total = selected.length * selectedProtocols.length;
    let done = 0;

    for (const proto of selectedProtocols) {
      const group = getProtocolGroup(proto);

      if (unifiedMode && selected.length > 1) {
        let mergedSamples: SignalSample[] = [];
        for (const id of selected) {
          const stored = signals.find(s => s.id === id);
          if (!stored) continue;
          const samples = buildSamples(stored, proto);
          const offset = mergedSamples.length > 0 ? mergedSamples[mergedSamples.length - 1].t + 0.1 : 0;
          mergedSamples.push(...samples.map(s => ({ t: s.t + offset, y: s.y })));
        }
        if (mergedSamples.length === 0) continue;
        const result = autoFit
          ? autoFitBest(mergedSamples, config)
          : trainFormula(mergedSamples, config, formulaType, undefined, (ep) => setProgress((ep / config.epochs) * 100));
        const key = `__unified_${proto}__`;
        newResults.set(key, result);
        for (const id of selected) newResults.set(`${id}_${proto}`, result);
        protocolResults.push({ protocol: proto, group, signalIds: selected, result });
        done += selected.length;
        setProgress((done / total) * 100);
      } else {
        for (const id of selected) {
          const stored = signals.find(s => s.id === id);
          if (!stored) continue;
          const samples = buildSamples(stored, proto);
          const result = autoFit ? autoFitBest(samples, config) : trainFormula(samples, config, formulaType, undefined, () => {});
          newResults.set(`${id}_${proto}`, result);
          done++;
          setProgress((done / total) * 100);
          await new Promise(r => setTimeout(r, 5));
        }
        // Aggregate per-protocol
        const protoResults = selected.map(id => newResults.get(`${id}_${proto}`)).filter(Boolean) as TrainingResult[];
        if (protoResults.length > 0) {
          const avgR2 = protoResults.reduce((s, r) => s + r.r2, 0) / protoResults.length;
          protocolResults.push({ protocol: proto, group, signalIds: selected, result: { ...protoResults[0], r2: avgR2 } });
        }
      }
    }

    setResults(newResults);
    setPerProtocolResults(protocolResults);
    setTraining(false);
    // Set active to first result
    if (selected.length > 0) {
      const firstKey = unifiedMode ? `__unified_${selectedProtocols[0]}__` : `${selected[0]}_${selectedProtocols[0]}`;
      setActiveSignalId(firstKey);
    }
    toast.success(`Обучено: ${selectedProtocols.length} протокол(ов) × ${selected.length} сигнал(ов)`);
  }, [selected, signals, config, buildSamples, formulaType, autoFit, unifiedMode, selectedProtocols]);

  // Derive active result
  const activeResult = activeSignalId ? results.get(activeSignalId) : undefined;
  const isUnifiedResult = activeSignalId?.startsWith("__unified_") ?? false;
  const activeProto = activeSignalId?.includes("_") 
    ? (activeSignalId.replace("__unified_", "").replace("__", "").split("_").pop() as ModulationType || selectedProtocols[0])
    : selectedProtocols[0];
  const activeStored = useMemo(() => {
    if (!activeSignalId || isUnifiedResult) return undefined;
    const idPart = activeSignalId.split("_")[0];
    return signals.find(s => s.id === idPart);
  }, [activeSignalId, isUnifiedResult, signals]);
  const activeFormulaType = activeResult?.formulaType ?? formulaType;
  const activeCoeffLabels = COEFF_LABELS[activeFormulaType];

  const comparisonData = useMemo(() => {
    if (!activeResult) return [];
    if (isUnifiedResult) {
      let mergedSamples: SignalSample[] = [];
      for (const id of selected) {
        const stored = signals.find(s => s.id === id);
        if (!stored) continue;
        const samples = buildSamples(stored, activeProto);
        const offset = mergedSamples.length > 0 ? mergedSamples[mergedSamples.length - 1].t + 0.1 : 0;
        mergedSamples.push(...samples.map(s => ({ t: s.t + offset, y: s.y })));
      }
      if (mergedSamples.length === 0) return [];
      const predicted = generatePrediction(activeResult.coefficients, activeResult.formulaType, mergedSamples[0].t, mergedSamples[mergedSamples.length - 1].t, mergedSamples.length);
      return mergedSamples.map((s, i) => ({ t: s.t.toFixed(3), original: s.y, predicted: predicted[i]?.y ?? 0 }));
    }
    if (!activeStored) return [];
    const samples = buildSamples(activeStored, activeProto);
    const predicted = generatePrediction(activeResult.coefficients, activeResult.formulaType, samples[0]?.t ?? 0, samples[samples.length - 1]?.t ?? 1, samples.length);
    return samples.map((s, i) => ({ t: s.t.toFixed(3), original: s.y, predicted: predicted[i]?.y ?? 0 }));
  }, [activeStored, activeResult, buildSamples, isUnifiedResult, selected, signals, activeProto]);

  const lossData = useMemo(() => {
    if (!activeResult) return [];
    const step = Math.max(1, Math.floor(activeResult.epochLosses.length / 200));
    return activeResult.epochLosses.filter((_, i) => i % step === 0).map((loss, i) => ({ epoch: i * step, loss }));
  }, [activeResult]);

  const coeffComparison = useMemo(() => {
    if (results.size < 2) return null;
    const entries = Array.from(results.entries());
    const firstCoeffs = entries[0][1].coefficients as unknown as Record<string, number>;
    const keys = Object.keys(firstCoeffs);
    return keys.map(k => {
      const values = entries.map(([id, r]) => ({ id: id.slice(0, 6), value: (r.coefficients as unknown as Record<string, number>)[k] ?? 0 }));
      const mean = values.reduce((s, v) => s + v.value, 0) / values.length;
      const std = Math.sqrt(values.reduce((s, v) => s + (v.value - mean) ** 2, 0) / values.length);
      return { key: k, label: activeCoeffLabels[k] ?? k, mean, std };
    });
  }, [results, activeCoeffLabels]);

  const handleEditCoeff = useCallback((key: string, value: number) => {
    if (!editCoeffs) return;
    setEditCoeffs({ ...(editCoeffs as unknown as Record<string, number>), [key]: value } as unknown as FormulaCoefficients);
  }, [editCoeffs]);

  const applyEditedCoeffs = useCallback(() => {
    if (!activeSignalId || !editCoeffs || !activeResult) return;
    const stored = activeStored;
    if (!stored && !isUnifiedResult) return;
    const samples = stored ? buildSamples(stored, activeProto) : [];
    if (samples.length === 0) return;
    const tMax = Math.max(...samples.map(s => s.t), 1e-9);
    let totalSqErr = 0, maxErr = 0, yMean = 0, ssTot = 0;
    for (const s of samples) yMean += s.y;
    yMean /= samples.length;
    for (const s of samples) {
      const pred = evaluateFormula(s.t / tMax, editCoeffs, activeResult.formulaType);
      totalSqErr += (pred - s.y) ** 2;
      maxErr = Math.max(maxErr, Math.abs(pred - s.y));
      ssTot += (s.y - yMean) ** 2;
    }
    setResults(prev => new Map(prev).set(activeSignalId, {
      ...activeResult, coefficients: { ...editCoeffs },
      mse: totalSqErr / samples.length, r2: ssTot > 0 ? 1 - totalSqErr / ssTot : 0, maxError: maxErr,
    }));
    setEditCoeffs(null);
  }, [activeSignalId, editCoeffs, activeResult, activeStored, buildSamples, activeProto, isUnifiedResult]);

  // Per-protocol comparison chart data
  const protocolComparisonData = useMemo(() => {
    if (perProtocolResults.length <= 1) return null;
    return perProtocolResults.map(pr => ({
      protocol: pr.protocol.toUpperCase(),
      family: pr.group.family,
      r2: +pr.result.r2.toFixed(4),
      mse: +pr.result.mse.toFixed(6),
      color: PROTOCOL_CHART_COLORS[pr.protocol] ?? "hsl(0 0% 50%)",
    }));
  }, [perProtocolResults]);

  return (
    <div className="space-y-3">
      {/* Protocol selector — multi-select for training */}
      <div className="chart-panel">
        <label className="text-[10px] font-mono text-muted-foreground mb-1 block">Протоколы для обучения (множественный выбор)</label>
        <div className="flex flex-wrap gap-1">
          {MODULATION_REGISTRY.map(m => {
            const g = getProtocolGroup(m.id);
            const active = selectedProtocols.includes(m.id);
            return (
              <button key={m.id} onClick={() => toggleProtocol(m.id)}
                className={`flex items-center gap-1 font-mono text-[9px] px-1.5 py-0.5 border rounded transition-all ${
                  active ? `bg-${g.color}/20 text-${g.color} border-${g.color}/40` : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                }`}>
                {active && <CheckCircle2 className="w-2.5 h-2.5" />}
                {m.name}
              </button>
            );
          })}
        </div>
        {selectedProtocols.length > 1 && (
          <p className="text-[9px] font-mono text-signal-amber mt-1">
            Обучение будет выполнено для каждого протокола отдельно с раздельными графиками
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="chart-panel space-y-3">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-signal-cyan" />
            <span className="text-sm font-mono font-semibold text-foreground">Нейронная формула</span>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-muted-foreground">Learning Rate</label>
            <input type="number" step="0.01" min="0.001" max="1" value={config.learningRate}
              onChange={e => setConfig(c => ({ ...c, learningRate: Number(e.target.value) }))}
              className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs font-mono border border-border w-20" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-muted-foreground">Эпохи</label>
            <input type="number" step="100" min="50" max="5000" value={config.epochs}
              onChange={e => setConfig(c => ({ ...c, epochs: Number(e.target.value) }))}
              className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs font-mono border border-border w-20" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-muted-foreground">Batch</label>
            <input type="number" step="16" min="16" max="256" value={config.batchSize}
              onChange={e => setConfig(c => ({ ...c, batchSize: Number(e.target.value) }))}
              className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs font-mono border border-border w-20" />
          </div>
          <button onClick={handleTrain} disabled={training || selected.length === 0}
            className="flex items-center gap-1.5 bg-signal-cyan/20 hover:bg-signal-cyan/30 text-signal-cyan rounded px-3 py-1.5 text-xs font-mono border border-signal-cyan/30 transition-colors disabled:opacity-50">
            {training ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {training ? `${progress.toFixed(0)}%` : `Обучить (${selected.length}×${selectedProtocols.length})`}
          </button>
          <button onClick={() => { setSelected(signals.map(s => s.id)); }}
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground underline">Выбрать все</button>
          <button onClick={() => setSelected([])}
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground underline">Сбросить</button>
          <button onClick={() => setUnifiedMode(!unifiedMode)}
            className={`text-[10px] font-mono px-2.5 py-1 rounded border transition-colors flex items-center gap-1 ${
              unifiedMode ? 'bg-signal-magenta/20 text-signal-magenta border-signal-magenta/40' : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
            }`}>
            <BarChart3 className="w-3 h-3" /> Единая модель
          </button>
        </div>

        {/* Formula type selector */}
        <div className="flex flex-wrap gap-2 items-center border-t border-border pt-3">
          <span className="text-[10px] font-mono text-muted-foreground mr-1">Формула:</span>
          {(Object.keys(FORMULA_TYPES) as FormulaType[]).map(ft => (
            <button key={ft} onClick={() => { setFormulaType(ft); setAutoFit(false); }}
              className={`text-[10px] font-mono px-2.5 py-1 rounded border transition-colors ${
                !autoFit && formulaType === ft ? 'bg-signal-cyan/20 text-signal-cyan border-signal-cyan/40' : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
              }`}>{FORMULA_TYPES[ft].label}</button>
          ))}
          <button onClick={() => setAutoFit(!autoFit)}
            className={`text-[10px] font-mono px-2.5 py-1 rounded border transition-colors flex items-center gap-1 ${
              autoFit ? 'bg-signal-green/20 text-signal-green border-signal-green/40' : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
            }`}><Zap className="w-3 h-3" /> Авто-подбор</button>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={handleAISuggest} disabled={suggesting || selected.length === 0}
              className="flex items-center gap-1.5 bg-signal-magenta/20 hover:bg-signal-magenta/30 text-signal-magenta rounded px-3 py-1.5 text-xs font-mono border border-signal-magenta/30 transition-colors disabled:opacity-50">
              {suggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} ИИ подсказка
            </button>
          </div>
        </div>

        {!autoFit && (
          <div className="text-[10px] font-mono text-muted-foreground bg-secondary/50 rounded px-3 py-1.5">
            <span className="text-signal-cyan">{FORMULA_TYPES[formulaType].latex}</span>
            <span className="ml-2">— {FORMULA_TYPES[formulaType].description}</span>
          </div>
        )}
        {autoFit && (
          <div className="text-[10px] font-mono text-signal-green bg-signal-green/10 rounded px-3 py-1.5">
            Все 5 типов формул будут обучены, лучшая по R² будет выбрана автоматически
          </div>
        )}

        {aiSuggestion && (
          <div className="bg-signal-magenta/10 border border-signal-magenta/30 rounded px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-signal-magenta" />
                <span className="text-xs font-mono font-semibold text-signal-magenta">
                  Рекомендация ИИ: {FORMULA_TYPES[aiSuggestion.formulaType].label}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">({(aiSuggestion.confidence * 100).toFixed(0)}%)</span>
              </div>
              <button onClick={applyAISuggestion}
                className="text-[10px] font-mono bg-signal-magenta/20 text-signal-magenta px-2 py-0.5 rounded hover:bg-signal-magenta/30 transition-colors">Применить</button>
            </div>
            <p className="text-[10px] font-mono text-foreground/80">{aiSuggestion.reasoning}</p>
            {aiSuggestion.alternativeType && (
              <p className="text-[10px] font-mono text-muted-foreground">Альтернатива: {FORMULA_TYPES[aiSuggestion.alternativeType].label}</p>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Signal selection with protocol badges */}
        <div className="chart-panel lg:col-span-1 flex flex-col" style={{ maxHeight: 520, overflowY: "auto" }}>
          <h3 className="text-xs font-mono font-semibold text-signal-amber mb-2">Выборка сигналов</h3>

          {/* Unified results per protocol */}
          {perProtocolResults.filter(pr => pr.signalIds.length > 1).map(pr => (
            <div key={`unified_${pr.protocol}`}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-mono cursor-pointer transition-colors mb-1 ${
                activeSignalId === `__unified_${pr.protocol}__` ? `bg-${pr.group.color}/20 border border-${pr.group.color}/30` : "hover:bg-secondary border border-transparent"
              }`}
              onClick={() => setActiveSignalId(`__unified_${pr.protocol}__`)}>
              <BarChart3 className="w-3 h-3" style={{ color: PROTOCOL_CHART_COLORS[pr.protocol] }} />
              <span className="flex-1 font-semibold" style={{ color: PROTOCOL_CHART_COLORS[pr.protocol] }}>
                Единая [{pr.protocol.toUpperCase()}] ({pr.signalIds.length})
              </span>
              <span className="text-[9px] text-muted-foreground">R²={pr.result.r2.toFixed(3)}</span>
            </div>
          ))}

          {signals.length === 0 && (
            <p className="text-[10px] font-mono text-muted-foreground">Нет сигналов в БД</p>
          )}
          {signals.map(s => {
            const isSelected = selected.includes(s.id);
            const isActive = activeSignalId?.startsWith(s.id) ?? false;
            const storedMod = (s.mod_type || "lora") as ModulationType;
            const storedGroup = getProtocolGroup(storedMod);
            // Show results badges per protocol
            const signalResults = selectedProtocols
              .map(p => ({ proto: p, result: results.get(`${s.id}_${p}`) }))
              .filter(x => x.result);
            return (
              <div key={s.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-mono cursor-pointer transition-colors mb-0.5 ${
                  isActive ? "bg-signal-cyan/10 border border-signal-cyan/20" : "hover:bg-secondary"
                }`}
                onClick={() => { toggleSelect(s.id); if (signalResults.length > 0) setActiveSignalId(`${s.id}_${signalResults[0].proto}`); else setActiveSignalId(s.id); }}>
                <input type="checkbox" checked={isSelected} readOnly className="accent-signal-cyan w-3 h-3" />
                <span className="flex-1 truncate text-foreground">{s.message_text.slice(0, 22)}</span>
                <span className="text-muted-foreground text-[9px]">SF{s.sf}</span>
                {/* Stored protocol badge */}
                <span className={`text-[8px] px-1 py-0.5 rounded border bg-${storedGroup.color}/10 text-${storedGroup.color} border-${storedGroup.color}/20`}
                  title={`Сохранён как: ${storedMod}`}>
                  {storedMod.toUpperCase().slice(0, 4)}
                </span>
                {s.encryption_type && s.encryption_type !== "none" && (
                  <span className="text-[8px] px-1 py-0.5 rounded border bg-signal-amber/10 text-signal-amber border-signal-amber/20" title={`Шифр: ${s.encryption_type}`}>
                    🔒
                  </span>
                )}
                {/* Protocol result badges */}
                {signalResults.map(({ proto, result: r }) => {
                  const g = getProtocolGroup(proto);
                  return (
                    <span key={proto} className={`text-[8px] px-1 py-0.5 rounded border bg-${g.color}/10 text-${g.color} border-${g.color}/20`}
                      title={`${proto}: R²=${r!.r2.toFixed(3)}`}>
                      R²{r!.r2.toFixed(2)}
                    </span>
                  );
                })}
                {signalResults.length > 0 && <CheckCircle2 className="w-3 h-3 text-signal-green" />}
              </div>
            );
          })}
        </div>

        {/* Results */}
        <div className="lg:col-span-3 space-y-3">
          {/* Per-protocol comparison chart */}
          {protocolComparisonData && protocolComparisonData.length > 1 && (
            <div className="chart-panel">
              <h3 className="text-xs font-mono font-semibold text-foreground mb-2">Сравнение по протоколам (R²)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={protocolComparisonData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 90%)" />
                    <XAxis dataKey="protocol" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} domain={[0, 1]} />
                    <Tooltip contentStyle={{ background: "hsl(0 0% 100%)", border: "1px solid hsl(220 13% 87%)", fontSize: 10 }} />
                    <Bar dataKey="r2" name="R²" radius={[3, 3, 0, 0]}>
                      {protocolComparisonData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="space-y-1.5">
                  {perProtocolResults.map(pr => (
                    <div key={pr.protocol} className="flex items-center gap-2 text-[10px] font-mono p-1.5 rounded bg-secondary/50">
                      <div className="w-2 h-2 rounded-full" style={{ background: PROTOCOL_CHART_COLORS[pr.protocol] }} />
                      <span className="font-semibold text-foreground">{pr.protocol.toUpperCase()}</span>
                      <span className="text-muted-foreground">({pr.group.family})</span>
                      <span className="ml-auto">R²=<span className={pr.result.r2 > 0.8 ? "text-signal-green" : pr.result.r2 > 0.5 ? "text-signal-amber" : "text-signal-red"}>
                        {pr.result.r2.toFixed(4)}</span></span>
                      <span className="text-muted-foreground">MSE={pr.result.mse.toFixed(6)}</span>
                      <button onClick={() => setActiveSignalId(unifiedMode ? `__unified_${pr.protocol}__` : `${selected[0]}_${pr.protocol}`)}
                        className="text-[8px] underline text-signal-cyan">Показать</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeResult && (activeStored || isUnifiedResult) ? (
            <>
              {/* Active protocol indicator */}
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <div className="w-2 h-2 rounded-full" style={{ background: PROTOCOL_CHART_COLORS[activeProto] }} />
                <span className="text-muted-foreground">Текущий протокол:</span>
                <span className="font-semibold" style={{ color: PROTOCOL_CHART_COLORS[activeProto] }}>{activeProto.toUpperCase()}</span>
                {selectedProtocols.length > 1 && selectedProtocols.map(p => (
                  <button key={p} onClick={() => {
                    const key = isUnifiedResult ? `__unified_${p}__` : `${activeStored?.id ?? selected[0]}_${p}`;
                    setActiveSignalId(key);
                  }}
                    className={`px-1.5 py-0.5 rounded border text-[8px] transition-colors ${
                      p === activeProto ? `bg-${getProtocolGroup(p).color}/20 border-${getProtocolGroup(p).color}/30` : "bg-secondary border-border"
                    }`}>{p.toUpperCase()}</button>
                ))}
              </div>

              {/* Formula display */}
              <div className="chart-panel">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-mono font-semibold text-signal-green">
                    {FORMULA_TYPES[activeResult.formulaType].label}: {isUnifiedResult ? `Единая модель [${activeProto.toUpperCase()}] (${selected.length} сигналов)` : `"${activeStored!.message_text.slice(0, 40)}…"`}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono ${activeResult.r2 > 0.8 ? "text-signal-green" : activeResult.r2 > 0.5 ? "text-signal-amber" : "text-signal-red"}`}>
                      R²={activeResult.r2.toFixed(4)}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">MSE={activeResult.mse.toFixed(6)}</span>
                  </div>
                </div>
                <div className="bg-secondary rounded px-3 py-2 text-[11px] font-mono text-signal-cyan break-all leading-relaxed">
                  {formatFormula(activeResult.coefficients, activeResult.formulaType)}
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="chart-panel" style={{ height: 260 }}>
                  <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Оригинал vs Предсказание [{activeProto.toUpperCase()}]</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <LineChart data={comparisonData.filter((_, i) => i % Math.max(1, Math.floor(comparisonData.length / 300)) === 0)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 90%)" />
                      <XAxis dataKey="t" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                      <Tooltip contentStyle={{ background: "hsl(0 0% 100%)", border: "1px solid hsl(220 13% 87%)", fontSize: 10 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line dataKey="original" stroke={PROTOCOL_CHART_COLORS[activeProto]} dot={false} strokeWidth={1.5} name="Оригинал" />
                      <Line dataKey="predicted" stroke="hsl(142 70% 40%)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="Формула" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="chart-panel" style={{ height: 260 }}>
                  <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Кривая обучения (MSE)</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <LineChart data={lossData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 90%)" />
                      <XAxis dataKey="epoch" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                      <Tooltip contentStyle={{ background: "hsl(0 0% 100%)", border: "1px solid hsl(220 13% 87%)", fontSize: 10 }} />
                      <Line dataKey="loss" stroke="hsl(0 75% 50%)" dot={false} strokeWidth={1.5} name="MSE" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Coefficients + Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="chart-panel">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-mono font-semibold text-signal-amber flex items-center gap-1">
                      <Settings2 className="w-3 h-3" /> Коэффициенты
                    </h3>
                    {editCoeffs ? (
                      <div className="flex gap-1">
                        <button onClick={applyEditedCoeffs}
                          className="text-[10px] font-mono bg-signal-green/20 text-signal-green px-2 py-0.5 rounded">Применить</button>
                        <button onClick={() => setEditCoeffs(null)}
                          className="text-[10px] font-mono text-muted-foreground px-2 py-0.5 rounded hover:text-foreground">Отмена</button>
                      </div>
                    ) : (
                      <button onClick={() => setEditCoeffs({ ...activeResult.coefficients })}
                        className="text-[10px] font-mono text-signal-cyan underline hover:text-foreground">Редактировать</button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {Object.keys(activeCoeffLabels).map(k => (
                      <div key={k} className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-muted-foreground">{activeCoeffLabels[k]}</span>
                        {editCoeffs ? (
                          <input type="number" step="0.01"
                            value={(editCoeffs as unknown as Record<string, number>)[k] ?? 0}
                            onChange={e => handleEditCoeff(k, Number(e.target.value))}
                            className="bg-secondary text-foreground rounded px-1.5 py-0.5 text-[11px] font-mono border border-border w-24 text-right" />
                        ) : (
                          <span className="text-foreground">{((activeResult.coefficients as unknown as Record<string, number>)[k] ?? 0).toFixed(6)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="chart-panel">
                  <h3 className="text-xs font-mono font-semibold text-signal-magenta flex items-center gap-1 mb-2">
                    <BarChart3 className="w-3 h-3" /> Оценка расхождений
                  </h3>
                  <div className="space-y-1.5 text-[11px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Протокол:</span>
                      <span style={{ color: PROTOCOL_CHART_COLORS[activeProto] }}>{activeProto.toUpperCase()} ({getProtocolGroup(activeProto).family})</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Тип формулы:</span>
                      <span className="text-signal-cyan">{FORMULA_TYPES[activeResult.formulaType].label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">MSE:</span>
                      <span className="text-foreground">{activeResult.mse.toFixed(8)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">R²:</span>
                      <span className={activeResult.r2 > 0.8 ? "text-signal-green" : activeResult.r2 > 0.5 ? "text-signal-amber" : "text-signal-red"}>
                        {activeResult.r2.toFixed(6)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Max ошибка:</span>
                      <span className="text-foreground">{activeResult.maxError.toFixed(6)}</span>
                    </div>
                    <div className="border-t border-border pt-1.5 mt-2">
                      <div className="flex items-center gap-1">
                        {activeResult.r2 > 0.8 ? (
                          <><CheckCircle2 className="w-3 h-3 text-signal-green" /><span className="text-signal-green">Хорошее приближение</span></>
                        ) : activeResult.r2 > 0.5 ? (
                          <><AlertTriangle className="w-3 h-3 text-signal-amber" /><span className="text-signal-amber">Среднее приближение</span></>
                        ) : (
                          <><AlertTriangle className="w-3 h-3 text-signal-red" /><span className="text-signal-red">Слабое приближение</span></>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {coeffComparison && (
                <div className="chart-panel">
                  <h3 className="text-xs font-mono font-semibold text-signal-cyan mb-2">
                    Сравнение коэффициентов ({results.size} моделей)
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-mono">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-1 text-muted-foreground">Коэффициент</th>
                          <th className="text-right py-1 text-muted-foreground">Среднее</th>
                          <th className="text-right py-1 text-muted-foreground">Std</th>
                          <th className="text-right py-1 text-muted-foreground">Разброс</th>
                        </tr>
                      </thead>
                      <tbody>
                        {coeffComparison.map(row => (
                          <tr key={row.key} className="border-b border-border/50">
                            <td className="py-1 text-foreground">{row.label}</td>
                            <td className="text-right py-1 text-signal-green">{row.mean.toFixed(4)}</td>
                            <td className="text-right py-1 text-signal-amber">{row.std.toFixed(4)}</td>
                            <td className="text-right py-1">
                              <div className="inline-block w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                                <div className="h-full bg-signal-cyan rounded-full"
                                  style={{ width: `${Math.min(100, (row.std / (Math.abs(row.mean) + 1e-9)) * 100)}%` }} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="chart-panel flex flex-col items-center justify-center py-16 text-center">
              <Brain className="w-10 h-10 text-muted-foreground mb-3 opacity-40" />
              <p className="text-sm font-mono text-muted-foreground">Выберите сигналы и запустите обучение</p>
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                {selectedProtocols.length} протокол(ов) · 5 типов формул · Авто-подбор · ИИ рекомендации
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
