import { useState, useMemo, useCallback } from "react";
import {
  Brain, Play, Loader2, CheckCircle2, AlertTriangle, RotateCcw,
  ArrowRightLeft, BarChart3, FileText, Zap, Eye,
} from "lucide-react";
import { generateLoRaSignal } from "@/lib/lora-signal";
import {
  buildTrainingPairs,
  trainDecoder,
  decodeSignal,
  compareTexts,
  DEFAULT_DECODER_CONFIG,
  type DecoderConfig,
  type DecoderTrainingResult,
  type DecodedResult,
} from "@/lib/inverse-model";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar, Cell, ScatterChart, Scatter,
} from "recharts";

const SAMPLE_TEXTS = [
  "Философ спокойно создаёт старую книгу.",
  "Радиосигнал передаёт данные через эфир.",
  "LoRa модуляция использует CSS чирпы.",
  "Нейросеть учится декодировать сигналы.",
];

export function InverseModelPanel() {
  // Signal params
  const [sf, setSf] = useState(7);
  const [bw, setBw] = useState(125);
  const [text, setText] = useState(SAMPLE_TEXTS[0]);
  const [numSymbols, setNumSymbols] = useState(12);
  const [noiseLevel, setNoiseLevel] = useState(0);

  // Decoder config
  const [config, setConfig] = useState<DecoderConfig>(DEFAULT_DECODER_CONFIG);

  // State
  const [training, setTraining] = useState(false);
  const [progress, setProgress] = useState(0);
  const [trainResult, setTrainResult] = useState<DecoderTrainingResult | null>(null);
  const [decodeResult, setDecodeResult] = useState<DecodedResult | null>(null);
  const [textComparison, setTextComparison] = useState<ReturnType<typeof compareTexts> | null>(null);

  // Signal generation
  const signal = useMemo(() => {
    const params = { sf, bw: bw * 1000, fc: 915e6, sampleRate: 500e3 };
    return generateLoRaSignal(params, text, numSymbols);
  }, [sf, bw, text, numSymbols]);

  const noisySignal = useMemo(() => {
    if (noiseLevel === 0) return signal;
    const real = signal.real.map(v => v + (Math.random() - 0.5) * noiseLevel * 2);
    const imag = signal.imag.map(v => v + (Math.random() - 0.5) * noiseLevel * 2);
    return { ...signal, real, imag };
  }, [signal, noiseLevel]);

  const M = 2 ** sf;
  const samplesPerSymbol = Math.floor(500e3 * (M / (bw * 1000)));

  // Training
  const handleTrain = useCallback(async () => {
    setTraining(true);
    setProgress(0);
    setDecodeResult(null);
    setTextComparison(null);

    try {
      // Build training pairs from clean signal
      const pairs = buildTrainingPairs(
        signal.real, signal.imag, signal.symbols,
        samplesPerSymbol, config.windowSize
      );

      if (pairs.length === 0) {
        toast.error("Недостаточно данных для обучения");
        setTraining(false);
        return;
      }

      // Augment with multiple noise levels for robustness
      const augmentedPairs = [...pairs];
      for (const nl of [0.02, 0.05, 0.1]) {
        const noisyR = signal.real.map(v => v + (Math.random() - 0.5) * nl * 2);
        const noisyI = signal.imag.map(v => v + (Math.random() - 0.5) * nl * 2);
        const noisyPairs = buildTrainingPairs(noisyR, noisyI, signal.symbols, samplesPerSymbol, config.windowSize);
        augmentedPairs.push(...noisyPairs);
      }

      // Train
      const result = trainDecoder(augmentedPairs, config, M, (ep, loss, acc) => {
        setProgress((ep / config.epochs) * 100);
      });

      setTrainResult(result);
      toast.success(`Обучение завершено: точность ${(result.accuracy * 100).toFixed(1)}%`);

      // Auto-decode noisy signal
      const decoded = decodeSignal(noisySignal.real, noisySignal.imag, samplesPerSymbol, result, sf);
      setDecodeResult(decoded);
      const comparison = compareTexts(text, decoded.decodedText);
      setTextComparison(comparison);
    } catch (e) {
      toast.error("Ошибка обучения");
      console.error(e);
    } finally {
      setTraining(false);
    }
  }, [signal, noisySignal, samplesPerSymbol, config, M, sf, text]);

  // Re-decode with current weights
  const handleDecode = useCallback(() => {
    if (!trainResult) { toast.error("Сначала обучите декодер"); return; }
    const decoded = decodeSignal(noisySignal.real, noisySignal.imag, samplesPerSymbol, trainResult, sf);
    setDecodeResult(decoded);
    setTextComparison(compareTexts(text, decoded.decodedText));
  }, [trainResult, noisySignal, samplesPerSymbol, sf, text]);

  // Chart data
  const lossData = useMemo(() => {
    if (!trainResult) return [];
    const step = Math.max(1, Math.floor(trainResult.epochLosses.length / 150));
    return trainResult.epochLosses
      .filter((_, i) => i % step === 0)
      .map((loss, i) => ({ epoch: i * step, loss: +loss.toFixed(4) }));
  }, [trainResult]);

  const symbolCompareData = useMemo(() => {
    if (!decodeResult) return [];
    return signal.symbols.slice(0, decodeResult.symbols.length).map((orig, i) => ({
      idx: i,
      original: orig,
      decoded: decodeResult.symbols[i],
      confidence: +(decodeResult.confidence[i] * 100).toFixed(1),
      correct: orig === decodeResult.symbols[i],
    }));
  }, [signal.symbols, decodeResult]);

  const confusionData = useMemo(() => {
    if (!trainResult || trainResult.confusionSamples.length === 0) return [];
    return trainResult.confusionSamples.slice(0, 100).map((s, i) => ({
      x: s.actual,
      y: s.predicted,
      fill: s.actual === s.predicted ? "hsl(142 70% 50%)" : "hsl(0 80% 58%)",
    }));
  }, [trainResult]);

  const signalPreviewData = useMemo(() => {
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

  const symbolAccData = useMemo(() => {
    if (!trainResult) return [];
    const entries = Array.from(trainResult.symbolAccuracies.entries());
    return entries.slice(0, 20).map(([sym, acc]) => ({
      symbol: sym,
      accuracy: +(acc * 100).toFixed(1),
    }));
  }, [trainResult]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="chart-panel space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-signal-amber" />
            <span className="text-sm font-mono font-semibold text-foreground">
              Обратное преобразование: s(t) → текст
            </span>
          </div>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground bg-secondary/50 rounded px-3 py-2">
          <span className="text-signal-amber">
            {"s(t) → [MLP декодер] → символы H_k → биты B_{k,m} → UTF-8 текст"}
          </span>
          <span className="ml-2">— обучение на парах (сигнал, символы), декодирование зашумлённого сигнала</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Left — params */}
        <div className="lg:col-span-1 space-y-3">
          {/* Signal params */}
          <div className="chart-panel space-y-2">
            <h3 className="text-xs font-mono font-semibold text-signal-green flex items-center gap-1">
              <Zap className="w-3 h-3" /> Сигнал
            </h3>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-muted-foreground">SF</span>
                <select value={sf} onChange={e => setSf(Number(e.target.value))}
                  className="bg-secondary text-foreground rounded px-1.5 py-0.5 text-[10px] font-mono border border-border">
                  {[7, 8, 9, 10].map(v => <option key={v} value={v}>SF {v}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-muted-foreground">BW (кГц)</span>
                <select value={bw} onChange={e => setBw(Number(e.target.value))}
                  className="bg-secondary text-foreground rounded px-1.5 py-0.5 text-[10px] font-mono border border-border">
                  {[125, 250, 500].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-muted-foreground">Символов</span>
                <input type="range" min={4} max={30} value={numSymbols}
                  onChange={e => setNumSymbols(Number(e.target.value))}
                  className="w-20 accent-signal-green" />
                <span className="text-foreground w-6 text-right">{numSymbols}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-muted-foreground">Шум σ</span>
                <input type="range" min={0} max={50} value={noiseLevel * 100}
                  onChange={e => setNoiseLevel(Number(e.target.value) / 100)}
                  className="w-20 accent-signal-red" />
                <span className="text-foreground w-10 text-right">{(noiseLevel * 100).toFixed(0)}%</span>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground">Текст</label>
              <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
                className="w-full bg-secondary text-secondary-foreground rounded px-2 py-1 text-[10px] font-mono border border-border mt-1 resize-none" />
              <div className="flex flex-wrap gap-1 mt-1">
                {SAMPLE_TEXTS.map((t, i) => (
                  <button key={i} onClick={() => setText(t)}
                    className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground hover:text-foreground border border-border truncate max-w-[140px]">
                    {t.slice(0, 20)}…
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Decoder config */}
          <div className="chart-panel space-y-2">
            <h3 className="text-xs font-mono font-semibold text-signal-cyan flex items-center gap-1">
              <Brain className="w-3 h-3" /> Декодер (MLP)
            </h3>
            {([
              ["hiddenSize", "Нейроны", 8, 128, 8],
              ["learningRate", "LR", 0.001, 0.1, 0.005],
              ["epochs", "Эпохи", 50, 2000, 50],
              ["windowSize", "Окно (сэмплы)", 4, 64, 4],
            ] as [string, string, number, number, number][]).map(([key, label, min, max, step]) => (
              <div key={key} className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-muted-foreground">{label}</span>
                <input type="number" min={min} max={max} step={step}
                  value={config[key as keyof DecoderConfig]}
                  onChange={e => setConfig(c => ({ ...c, [key]: Number(e.target.value) }))}
                  className="bg-secondary text-foreground rounded px-1.5 py-0.5 text-[10px] font-mono border border-border w-16 text-right" />
              </div>
            ))}

            <button onClick={handleTrain} disabled={training}
              className="w-full flex items-center justify-center gap-1.5 bg-signal-cyan/20 hover:bg-signal-cyan/30 text-signal-cyan rounded px-3 py-2 text-xs font-mono border border-signal-cyan/30 transition-colors disabled:opacity-50 mt-2">
              {training ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {training ? `${progress.toFixed(0)}%` : "Обучить декодер"}
            </button>

            {trainResult && (
              <button onClick={handleDecode}
                className="w-full flex items-center justify-center gap-1.5 bg-signal-amber/20 hover:bg-signal-amber/30 text-signal-amber rounded px-3 py-1.5 text-[10px] font-mono border border-signal-amber/30 transition-colors">
                <ArrowRightLeft className="w-3 h-3" /> Перекодировать
              </button>
            )}
          </div>

          {/* Quick info */}
          <div className="chart-panel text-[10px] font-mono text-muted-foreground space-y-1">
            <div className="flex justify-between"><span>M (классов):</span><span className="text-foreground">{M}</span></div>
            <div className="flex justify-between"><span>Сэмпл/символ:</span><span className="text-foreground">{samplesPerSymbol}</span></div>
            <div className="flex justify-between"><span>Символов:</span><span className="text-foreground">{signal.symbols.length}</span></div>
            <div className="flex justify-between"><span>Вход MLP:</span><span className="text-foreground">{config.windowSize * 2}</span></div>
          </div>
        </div>

        {/* Right — results */}
        <div className="lg:col-span-3 space-y-3">
          {/* Signal preview */}
          <div className="chart-panel" style={{ height: 180 }}>
            <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">
              Сигнал{noiseLevel > 0 ? ` (σ=${(noiseLevel * 100).toFixed(0)}%)` : " (чистый)"}
            </h3>
            <ResponsiveContainer width="100%" height="88%">
              <LineChart data={signalPreviewData}>
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

          {trainResult ? (
            <>
              {/* Decoded text */}
              {decodeResult && (
                <div className="chart-panel">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-4 h-4 text-signal-green" />
                    <h3 className="text-xs font-mono font-semibold text-signal-green">Результат декодирования</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <p className="text-[9px] font-mono text-muted-foreground mb-1">Оригинал:</p>
                      <p className="text-[11px] font-mono text-foreground bg-secondary rounded px-2 py-1.5 break-all">{text}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono text-muted-foreground mb-1">Декодировано:</p>
                      <p className="text-[11px] font-mono text-signal-cyan bg-secondary rounded px-2 py-1.5 break-all">{decodeResult.decodedText.slice(0, 200)}</p>
                    </div>
                  </div>
                  {textComparison && (
                    <div className="flex flex-wrap gap-4 mt-2 text-[10px] font-mono">
                      <span className="text-muted-foreground">
                        Точность символов: <span className={textComparison.charAccuracy > 0.8 ? "text-signal-green" : textComparison.charAccuracy > 0.4 ? "text-signal-amber" : "text-signal-red"}>
                          {(textComparison.charAccuracy * 100).toFixed(1)}%
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        Совпадений: <span className="text-foreground">{textComparison.matchingChars}/{textComparison.totalChars}</span>
                      </span>
                      <span className="text-muted-foreground">
                        Edit distance: <span className="text-foreground">{textComparison.editDistance}</span>
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Charts row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Training loss */}
                <div className="chart-panel" style={{ height: 220 }}>
                  <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Кривая обучения</h3>
                  <ResponsiveContainer width="100%" height="88%">
                    <LineChart data={lossData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                      <XAxis dataKey="epoch" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                      <Line dataKey="loss" stroke="hsl(var(--signal-red))" dot={false} strokeWidth={1.5} name="Loss" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Symbol comparison */}
                <div className="chart-panel" style={{ height: 220 }}>
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
              </div>

              {/* Metrics row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Accuracy by symbol */}
                <div className="chart-panel" style={{ height: 200 }}>
                  <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Точность по символам</h3>
                  <ResponsiveContainer width="100%" height="85%">
                    <BarChart data={symbolAccData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                      <XAxis dataKey="symbol" tick={{ fontSize: 7, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                      <Bar dataKey="accuracy" name="% верно">
                        {symbolAccData.map((d, i) => (
                          <Cell key={i} fill={d.accuracy > 80 ? "hsl(142 70% 50%)" : d.accuracy > 50 ? "hsl(40 95% 55%)" : "hsl(0 80% 58%)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Confidence */}
                {decodeResult && (
                  <div className="chart-panel" style={{ height: 200 }}>
                    <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1">Уверенность декодера</h3>
                    <ResponsiveContainer width="100%" height="85%">
                      <LineChart data={symbolCompareData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                        <XAxis dataKey="idx" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} domain={[0, 100]} />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                        <Line dataKey="confidence" stroke="hsl(var(--signal-amber))" dot={false} strokeWidth={1.5} name="Уверенность %" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Metrics summary */}
                <div className="chart-panel">
                  <h3 className="text-[10px] font-mono font-semibold text-signal-magenta flex items-center gap-1 mb-2">
                    <BarChart3 className="w-3 h-3" /> Метрики
                  </h3>
                  <div className="space-y-1.5 text-[10px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Точность (train):</span>
                      <span className={trainResult.accuracy > 0.8 ? "text-signal-green" : "text-signal-amber"}>
                        {(trainResult.accuracy * 100).toFixed(1)}%
                      </span>
                    </div>
                    {decodeResult && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Символов верно:</span>
                          <span className="text-foreground">
                            {symbolCompareData.filter(d => d.correct).length}/{symbolCompareData.length}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Ср. уверенность:</span>
                          <span className="text-foreground">
                            {(decodeResult.confidence.reduce((a, b) => a + b, 0) / decodeResult.confidence.length * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">SNR (оценка):</span>
                          <span className="text-foreground">{decodeResult.estimatedParams.snrEstimate.toFixed(1)} дБ</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Final loss:</span>
                      <span className="text-foreground">{trainResult.epochLosses[trainResult.epochLosses.length - 1]?.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Шум σ:</span>
                      <span className="text-foreground">{(noiseLevel * 100).toFixed(0)}%</span>
                    </div>
                    <div className="border-t border-border pt-1.5 mt-2">
                      <div className="flex items-center gap-1">
                        {trainResult.accuracy > 0.8 ? (
                          <><CheckCircle2 className="w-3 h-3 text-signal-green" /><span className="text-signal-green">Хорошее декодирование</span></>
                        ) : trainResult.accuracy > 0.5 ? (
                          <><AlertTriangle className="w-3 h-3 text-signal-amber" /><span className="text-signal-amber">Среднее качество</span></>
                        ) : (
                          <><AlertTriangle className="w-3 h-3 text-signal-red" /><span className="text-signal-red">Слабое декодирование</span></>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="chart-panel flex flex-col items-center justify-center py-16 text-center">
              <RotateCcw className="w-10 h-10 text-muted-foreground mb-3 opacity-40" />
              <p className="text-sm font-mono text-muted-foreground">Настройте параметры и обучите декодер</p>
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                MLP декодер обучается на парах (окно сигнала → символ), затем декодирует зашумлённый сигнал в текст
              </p>
              <p className="text-[10px] font-mono text-muted-foreground/60 mt-3 max-w-md">
                Увеличьте уровень шума σ чтобы проверить робастность · Регулируйте размер окна и скрытый слой для баланса скорость/точность
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
