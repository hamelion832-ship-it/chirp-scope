import { useState, useEffect, useMemo, useCallback } from "react";
import { Brain, Play, RotateCcw, Settings2, BarChart3, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { fetchSignals, type StoredSignal } from "@/lib/signal-db";
import {
  trainFormula,
  generatePrediction,
  formatFormula,
  compareCoefficients,
  evaluateFormula,
  type FormulaCoefficients,
  type TrainingConfig,
  type TrainingResult,
  type SignalSample,
} from "@/lib/neural-formula";
import { generateLoRaSignal } from "@/lib/lora-signal";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const DEFAULT_CONFIG: TrainingConfig = {
  learningRate: 0.05,
  epochs: 500,
  batchSize: 64,
};

const COEFF_LABELS: Record<keyof FormulaCoefficients, string> = {
  A: "A (амплитуда)",
  alpha: "α (затухание)",
  f0: "f₀ (частота)",
  beta: "β (скорость чирпа)",
  phi: "φ (фаза)",
  C: "C (смещение)",
};

export function NeuralFormulaPanel() {
  const [signals, setSignals] = useState<StoredSignal[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [config, setConfig] = useState<TrainingConfig>(DEFAULT_CONFIG);
  const [results, setResults] = useState<Map<string, TrainingResult>>(new Map());
  const [training, setTraining] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeSignalId, setActiveSignalId] = useState<string | null>(null);
  const [editCoeffs, setEditCoeffs] = useState<FormulaCoefficients | null>(null);

  useEffect(() => {
    fetchSignals().then(setSignals);
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }, []);

  const selectAll = useCallback(() => {
    setSelected(signals.map(s => s.id));
  }, [signals]);

  /** Build signal samples from a stored signal */
  const buildSamples = useCallback((stored: StoredSignal): SignalSample[] => {
    const params = { sf: stored.sf, bw: stored.bw, fc: stored.fc, sampleRate: 500e3 };
    const sig = generateLoRaSignal(params, stored.message_text, Math.min(stored.n_symbols, 20));
    const maxPts = Math.min(sig.real.length, 400);
    const step = Math.max(1, Math.floor(sig.real.length / maxPts));
    const samples: SignalSample[] = [];
    for (let i = 0; i < sig.real.length && samples.length < maxPts; i += step) {
      samples.push({ t: sig.time[i] * 1000, y: sig.real[i] });
    }
    return samples;
  }, []);

  const handleTrain = useCallback(async () => {
    if (selected.length === 0) return;
    setTraining(true);
    setProgress(0);

    const newResults = new Map<string, TrainingResult>();
    const total = selected.length;

    for (let idx = 0; idx < total; idx++) {
      const id = selected[idx];
      const stored = signals.find(s => s.id === id);
      if (!stored) continue;

      const samples = buildSamples(stored);
      const result = trainFormula(samples, config, undefined, () => {});
      newResults.set(id, result);
      setProgress(((idx + 1) / total) * 100);

      // Yield to UI
      await new Promise(r => setTimeout(r, 10));
    }

    setResults(newResults);
    setTraining(false);
    if (selected.length > 0) setActiveSignalId(selected[0]);
  }, [selected, signals, config, buildSamples]);

  const activeResult = activeSignalId ? results.get(activeSignalId) : undefined;
  const activeStored = activeSignalId ? signals.find(s => s.id === activeSignalId) : undefined;

  // Chart: original vs predicted
  const comparisonData = useMemo(() => {
    if (!activeStored || !activeResult) return [];
    const samples = buildSamples(activeStored);
    const tMin = samples[0]?.t ?? 0;
    const tMax = samples[samples.length - 1]?.t ?? 1;
    const predicted = generatePrediction(activeResult.coefficients, tMin, tMax, samples.length);
    return samples.map((s, i) => ({
      t: s.t.toFixed(3),
      original: s.y,
      predicted: predicted[i]?.y ?? 0,
      error: Math.abs(s.y - (predicted[i]?.y ?? 0)),
    }));
  }, [activeStored, activeResult, buildSamples]);

  // Loss curve for active result
  const lossData = useMemo(() => {
    if (!activeResult) return [];
    const step = Math.max(1, Math.floor(activeResult.epochLosses.length / 200));
    return activeResult.epochLosses
      .filter((_, i) => i % step === 0)
      .map((loss, i) => ({ epoch: i * step, loss }));
  }, [activeResult]);

  // Cross-signal coefficient comparison
  const coeffComparison = useMemo(() => {
    if (results.size < 2) return null;
    const entries = Array.from(results.entries());
    const keys: (keyof FormulaCoefficients)[] = ['A', 'alpha', 'f0', 'beta', 'phi', 'C'];
    return keys.map(k => {
      const values = entries.map(([id, r]) => ({
        id: id.slice(0, 6),
        value: r.coefficients[k],
      }));
      const mean = values.reduce((s, v) => s + v.value, 0) / values.length;
      const std = Math.sqrt(values.reduce((s, v) => s + (v.value - mean) ** 2, 0) / values.length);
      return { key: k, label: COEFF_LABELS[k], mean, std, values };
    });
  }, [results]);

  const handleEditCoeff = useCallback((key: keyof FormulaCoefficients, value: number) => {
    if (!editCoeffs) return;
    setEditCoeffs({ ...editCoeffs, [key]: value });
  }, [editCoeffs]);

  const applyEditedCoeffs = useCallback(() => {
    if (!activeSignalId || !editCoeffs || !activeResult) return;
    // Recompute metrics with edited coefficients
    const stored = signals.find(s => s.id === activeSignalId);
    if (!stored) return;
    const samples = buildSamples(stored);
    const tMax = Math.max(...samples.map(s => s.t), 1e-9);
    let totalSqErr = 0, maxErr = 0, yMean = 0, ssTot = 0;
    for (const s of samples) yMean += s.y;
    yMean /= samples.length;
    for (const s of samples) {
      const pred = evaluateFormula(s.t / tMax, editCoeffs);
      totalSqErr += (pred - s.y) ** 2;
      maxErr = Math.max(maxErr, Math.abs(pred - s.y));
      ssTot += (s.y - yMean) ** 2;
    }
    const updated: TrainingResult = {
      ...activeResult,
      coefficients: { ...editCoeffs },
      mse: totalSqErr / samples.length,
      r2: ssTot > 0 ? 1 - totalSqErr / ssTot : 0,
      maxError: maxErr,
    };
    setResults(prev => new Map(prev).set(activeSignalId, updated));
    setEditCoeffs(null);
  }, [activeSignalId, editCoeffs, activeResult, signals, buildSamples]);

  return (
    <div className="space-y-3">
      {/* Training Controls */}
      <div className="chart-panel flex flex-wrap gap-4 items-end">
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
          {training ? `${progress.toFixed(0)}%` : `Обучить (${selected.length})`}
        </button>

        <button onClick={selectAll}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground underline">
          Выбрать все
        </button>
        <button onClick={() => setSelected([])}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground underline">
          Сбросить
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Signal selection list */}
        <div className="chart-panel lg:col-span-1 flex flex-col" style={{ maxHeight: 520, overflowY: "auto" }}>
          <h3 className="text-xs font-mono font-semibold text-signal-amber mb-2">Выборка сигналов</h3>
          {signals.length === 0 && (
            <p className="text-[10px] font-mono text-muted-foreground">Нет сигналов в БД</p>
          )}
          {signals.map(s => {
            const isSelected = selected.includes(s.id);
            const hasResult = results.has(s.id);
            const isActive = s.id === activeSignalId;
            return (
              <div key={s.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-mono cursor-pointer transition-colors mb-0.5
                  ${isActive ? "bg-signal-cyan/20 border border-signal-cyan/30" : "hover:bg-secondary"}`}
                onClick={() => { toggleSelect(s.id); setActiveSignalId(s.id); }}>
                <input type="checkbox" checked={isSelected} readOnly
                  className="accent-signal-cyan w-3 h-3" />
                <span className="flex-1 truncate text-foreground">{s.message_text.slice(0, 30)}</span>
                <span className="text-muted-foreground">SF{s.sf}</span>
                {hasResult && <CheckCircle2 className="w-3 h-3 text-signal-green" />}
              </div>
            );
          })}
        </div>

        {/* Results area */}
        <div className="lg:col-span-3 space-y-3">
          {activeResult && activeStored ? (
            <>
              {/* Formula display */}
              <div className="chart-panel">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-mono font-semibold text-signal-green">
                    Формула для: "{activeStored.message_text.slice(0, 40)}…"
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono ${activeResult.r2 > 0.8 ? "text-signal-green" : activeResult.r2 > 0.5 ? "text-signal-amber" : "text-signal-red"}`}>
                      R²={activeResult.r2.toFixed(4)}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      MSE={activeResult.mse.toFixed(6)}
                    </span>
                  </div>
                </div>
                <div className="bg-secondary rounded px-3 py-2 text-[11px] font-mono text-signal-cyan break-all leading-relaxed">
                  {formatFormula(activeResult.coefficients)}
                </div>
              </div>

              {/* Charts row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Original vs Predicted */}
                <div className="chart-panel" style={{ height: 260 }}>
                  <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Оригинал vs Предсказание</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <LineChart data={comparisonData.filter((_, i) => i % Math.max(1, Math.floor(comparisonData.length / 300)) === 0)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 20%)" />
                      <XAxis dataKey="t" tick={{ fontSize: 9, fill: "hsl(215 15% 50%)" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(215 15% 50%)" }} />
                      <Tooltip contentStyle={{ background: "hsl(220 18% 10%)", border: "1px solid hsl(220 15% 18%)", fontSize: 10 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line dataKey="original" stroke="hsl(220 80% 60%)" dot={false} strokeWidth={1.5} name="Оригинал" />
                      <Line dataKey="predicted" stroke="hsl(142 70% 50%)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="Формула" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Loss curve */}
                <div className="chart-panel" style={{ height: 260 }}>
                  <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Кривая обучения (MSE)</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <LineChart data={lossData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 20%)" />
                      <XAxis dataKey="epoch" tick={{ fontSize: 9, fill: "hsl(215 15% 50%)" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(215 15% 50%)" }} />
                      <Tooltip contentStyle={{ background: "hsl(220 18% 10%)", border: "1px solid hsl(220 15% 18%)", fontSize: 10 }} />
                      <Line dataKey="loss" stroke="hsl(0 80% 58%)" dot={false} strokeWidth={1.5} name="MSE" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Coefficients editor + metrics */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Coefficients table / editor */}
                <div className="chart-panel">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-mono font-semibold text-signal-amber flex items-center gap-1">
                      <Settings2 className="w-3 h-3" /> Коэффициенты
                    </h3>
                    {editCoeffs ? (
                      <div className="flex gap-1">
                        <button onClick={applyEditedCoeffs}
                          className="text-[10px] font-mono bg-signal-green/20 text-signal-green px-2 py-0.5 rounded">
                          Применить
                        </button>
                        <button onClick={() => setEditCoeffs(null)}
                          className="text-[10px] font-mono text-muted-foreground px-2 py-0.5 rounded hover:text-foreground">
                          Отмена
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setEditCoeffs({ ...activeResult.coefficients })}
                        className="text-[10px] font-mono text-signal-cyan underline hover:text-foreground">
                        Редактировать
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {(Object.keys(COEFF_LABELS) as (keyof FormulaCoefficients)[]).map(k => (
                      <div key={k} className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-muted-foreground">{COEFF_LABELS[k]}</span>
                        {editCoeffs ? (
                          <input type="number" step="0.01" value={editCoeffs[k]}
                            onChange={e => handleEditCoeff(k, Number(e.target.value))}
                            className="bg-secondary text-foreground rounded px-1.5 py-0.5 text-[11px] font-mono border border-border w-24 text-right" />
                        ) : (
                          <span className="text-foreground">{activeResult.coefficients[k].toFixed(6)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Divergence metrics */}
                <div className="chart-panel">
                  <h3 className="text-xs font-mono font-semibold text-signal-magenta flex items-center gap-1 mb-2">
                    <BarChart3 className="w-3 h-3" /> Оценка расхождений
                  </h3>
                  <div className="space-y-1.5 text-[11px] font-mono">
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
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Эпох обучено:</span>
                      <span className="text-foreground">{activeResult.epochLosses.length}</span>
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

              {/* Cross-signal comparison */}
              {coeffComparison && (
                <div className="chart-panel">
                  <h3 className="text-xs font-mono font-semibold text-signal-cyan mb-2">
                    Сравнение коэффициентов ({results.size} сигналов)
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
              <p className="text-sm font-mono text-muted-foreground">
                Выберите сигналы и запустите обучение
              </p>
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                y(t) = A · e<sup>-αt</sup> · cos(2π·(f₀t + βt²/2) + φ) + C
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
