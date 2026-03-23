import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Brain, Play, Loader2, CheckCircle2, AlertTriangle, RotateCcw,
  ArrowRightLeft, BarChart3, FileText, Zap, Waves, Copy, Database, Radar,
  Shield, ShieldAlert, ShieldCheck, RefreshCw, Activity,
  Binary, GitBranch, TrendingUp, ScanLine, Layers, Search,
} from "lucide-react";
import { getProtocolGroup, PROTOCOL_CHART_COLORS } from "@/lib/protocol-classify";
import { generateLoRaSignal } from "@/lib/lora-signal";
import {
  buildTrainingPairs, trainDecoder, decodeSignal, compareTexts,
  DEFAULT_DECODER_CONFIG, type DecoderConfig, type DecoderTrainingResult, type DecodedResult,
} from "@/lib/inverse-model";
import {
  DECODER_REGISTRY, type DecoderType, type ClassicDecodedResult,
  decodeCorrelation, decodeEnergy, decodeTemplate,
} from "@/lib/inverse-decoders";
import {
  reconstructFromSymbols, compareSignals, assessSecurity,
  type ReconstructedSignal, type SecurityAssessment,
} from "@/lib/signal-reconstruct";
import {
  generateModulatedSignal, decodePSK, decodeFSK, decodeCDMA,
  reconstructProtocolSignal, getMaxSymbols,
  MODULATION_REGISTRY, type ModulationType, type ModulationParams,
} from "@/lib/modulation-engine";
import {
  classifyProtocol, type ProtocolClassification,
  URH_DECODER_REGISTRY, type URHDecoderType, type URHDecodedResult,
  decodeManchesterURH, decodeDifferentialURH, decodeZeroCrossingURH,
  decodeEnvelopeURH, decodePreambleSyncURH, decodeBitsliceURH,
} from "@/lib/urh-decoders";
import { ProtocolSelector } from "@/components/ProtocolSelector";
import { SignalDBBrowser } from "@/components/SignalDBBrowser";
import { fetchSignals, type StoredSignal } from "@/lib/signal-db";
import { ENCRYPTION_REGISTRY, type EncryptionType, getEncryptionStrength } from "@/lib/encryption-engine";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar as ReRadar,
} from "recharts";

const SAMPLE_TEXTS = [
  "Философ спокойно создаёт старую книгу.",
  "Радиосигнал передаёт данные через эфир.",
  "LoRa модуляция использует CSS чирпы.",
  "Нейросеть учится декодировать сигналы.",
];

const DECODER_ICONS: Record<string, React.ElementType> = {
  Brain, Waves, Zap, Copy, Binary, GitBranch, TrendingUp, Activity, ScanLine, Layers,
};

type SignalSourceMode = "manual" | "db" | "unified";
type AnyDecoderType = DecoderType | URHDecoderType;
type AnyResult = { method: AnyDecoderType; symbols: number[]; confidence: number[]; decodedText: string; processingTimeMs?: number };

const RISK_COLORS: Record<string, string> = {
  critical: "text-red-500",
  high: "text-signal-red",
  medium: "text-signal-amber",
  low: "text-signal-green",
  minimal: "text-signal-cyan",
};
const RISK_ICONS: Record<string, React.ElementType> = {
  critical: ShieldAlert, high: ShieldAlert, medium: Shield, low: ShieldCheck, minimal: ShieldCheck,
};

const ALL_DECODERS = [
  ...DECODER_REGISTRY.map(d => ({ ...d, group: "classic" as const })),
  ...URH_DECODER_REGISTRY.map(d => ({ ...d, id: d.id as AnyDecoderType, needsTraining: false, group: "urh" as const })),
];

export function InverseModelPanel() {
  const [modType, setModType] = useState<ModulationType>("lora");
  const [autoDetect, setAutoDetect] = useState(false);
  const [classification, setClassification] = useState<ProtocolClassification | null>(null);
  const isLoRa = modType === "lora";
  const [sf, setSf] = useState(7);
  const [bw, setBw] = useState(125);
  const [text, setText] = useState(SAMPLE_TEXTS[0]);
  const [numSymbols, setNumSymbols] = useState(20);
  const [noiseLevel, setNoiseLevel] = useState(0);
  const [symbolRate, setSymbolRate] = useState(10000);
  const [freqDeviation, setFreqDeviation] = useState(25000);
  const [chipRate, setChipRate] = useState(100000);
  const [encType, setEncType] = useState<EncryptionType>("none");

  const maxSymbols = useMemo(() => getMaxSymbols(text, modType, sf), [text, modType, sf]);
  useEffect(() => { setNumSymbols(prev => Math.min(prev, maxSymbols)); }, [maxSymbols]);

  const [activeDecoder, setActiveDecoder] = useState<AnyDecoderType>("mlp");
  const [config, setConfig] = useState<DecoderConfig>(DEFAULT_DECODER_CONFIG);
  const [training, setTraining] = useState(false);
  const [progress, setProgress] = useState(0);

  const [mlpTrain, setMlpTrain] = useState<DecoderTrainingResult | null>(null);
  const [mlpResult, setMlpResult] = useState<DecodedResult | null>(null);
  const [classicResults, setClassicResults] = useState<Record<string, ClassicDecodedResult>>({});
  const [urhResults, setUrhResults] = useState<Record<string, URHDecodedResult>>({});
  const [textComparison, setTextComparison] = useState<Record<string, ReturnType<typeof compareTexts>>>({});

  const [reconstruction, setReconstruction] = useState<ReconstructedSignal | null>(null);
  const [securityReport, setSecurityReport] = useState<SecurityAssessment | null>(null);

  const [dbSignals, setDbSignals] = useState<StoredSignal[]>([]);
  const [dbSelectedIds, setDbSelectedIds] = useState<string[]>([]);
  const [showDB, setShowDB] = useState(false);
  const [signalSourceMode, setSignalSourceMode] = useState<SignalSourceMode>("manual");

  useEffect(() => { fetchSignals().then(setDbSignals); }, []);

  const handleToggleDbSignal = useCallback((stored: StoredSignal) => {
    setDbSelectedIds(prev =>
      prev.includes(stored.id) ? prev.filter(x => x !== stored.id) : [...prev, stored.id]
    );
  }, []);

  const activeDbSignal = useMemo(() => {
    if (signalSourceMode !== "db" || dbSelectedIds.length === 0) return null;
    return dbSignals.find(s => dbSelectedIds.includes(s.id)) ?? null;
  }, [signalSourceMode, dbSelectedIds, dbSignals]);

  useEffect(() => {
    if (activeDbSignal) {
      setText(activeDbSignal.message_text);
      setSf(activeDbSignal.sf);
      setBw(activeDbSignal.bw / 1000);
      if (activeDbSignal.mod_type) {
        setModType(activeDbSignal.mod_type as ModulationType);
      }
      const storedModType = (activeDbSignal.mod_type || "lora") as ModulationType;
      const storedMax = storedModType === "lora"
        ? Math.max(1, Math.floor((Math.min(new TextEncoder().encode(activeDbSignal.message_text).length, 1240) * 8) / activeDbSignal.sf))
        : getMaxSymbols(activeDbSignal.message_text, storedModType);
      setNumSymbols(Math.min(activeDbSignal.n_symbols, storedMax));
    }
  }, [activeDbSignal]);

  const signal = useMemo(() => {
    if (isLoRa) {
      const params = { sf, bw: bw * 1000, fc: 915e6, sampleRate: 500e3 };
      return generateLoRaSignal(params, text, numSymbols);
    }
    const modParams: ModulationParams = {
      type: modType, sampleRate: modType === "cdma" ? 500000 : 200000,
      symbolRate, fc: 915e6, freqDeviation, chipRate, spreadingCode: 0,
    };
    const mod = generateModulatedSignal(modParams, text, numSymbols);
    return { time: mod.time, real: mod.real, imag: mod.imag, amplitude: mod.amplitude, symbols: mod.symbols, params: { sf, bw: bw * 1000, fc: 915e6, sampleRate: modParams.sampleRate } };
  }, [isLoRa, modType, sf, bw, text, numSymbols, symbolRate, freqDeviation, chipRate]);

  // Auto-classify protocol
  useEffect(() => {
    if (autoDetect && signal.real.length > 0) {
      const sr = isLoRa ? 500e3 : (modType === "cdma" ? 500000 : 200000);
      const cls = classifyProtocol(signal.real, signal.imag, sr);
      setClassification(cls);
    }
  }, [autoDetect, signal, isLoRa, modType]);

  const noisySignal = useMemo(() => {
    if (noiseLevel === 0) return signal;
    const real = signal.real.map(v => v + (Math.random() - 0.5) * noiseLevel * 2);
    const imag = signal.imag.map(v => v + (Math.random() - 0.5) * noiseLevel * 2);
    return { ...signal, real, imag };
  }, [signal, noiseLevel]);

  const meta = MODULATION_REGISTRY.find(m => m.id === modType)!;
  const bitsPerSym = isLoRa ? sf : meta.bitsPerSymbol;
  const M = isLoRa ? 2 ** sf : 2 ** bitsPerSym;
  const sampleRate = isLoRa ? 500e3 : (modType === "cdma" ? 500000 : 200000);
  const samplesPerSymbol = isLoRa
    ? Math.floor(500e3 * (M / (bw * 1000)))
    : Math.floor(sampleRate / symbolRate);

  const runReconstruction = useCallback((decodedSymbols: number[]) => {
    if (isLoRa) {
      const params = { sf, bw: bw * 1000, fc: 915e6, sampleRate: 500e3 };
      const recon = reconstructFromSymbols(decodedSymbols, params);
      const cmp = compareSignals(signal, recon);
      setReconstruction(cmp);
      return cmp;
    }
    const modParams: ModulationParams = {
      type: modType, sampleRate, symbolRate, fc: 915e6, freqDeviation, chipRate, spreadingCode: 0,
    };
    const recon = reconstructProtocolSignal(decodedSymbols, modParams);
    const len = Math.min(signal.real.length, recon.real.length);
    const errorReal = new Array(len);
    const errorImag = new Array(len);
    let sumErr2 = 0, sumOrig2 = 0, peakError = 0;
    let sumOR = 0, sumO = 0, sumR = 0, sumO2 = 0, sumR2 = 0;
    for (let i = 0; i < len; i++) {
      const er = signal.real[i] - recon.real[i];
      const ei = signal.imag[i] - recon.imag[i];
      errorReal[i] = er; errorImag[i] = ei;
      sumErr2 += er*er + ei*ei;
      sumOrig2 += signal.real[i]**2 + signal.imag[i]**2;
      peakError = Math.max(peakError, Math.sqrt(er*er + ei*ei));
      sumOR += signal.real[i]*recon.real[i]; sumO += signal.real[i]; sumR += recon.real[i];
      sumO2 += signal.real[i]**2; sumR2 += recon.real[i]**2;
    }
    const mse = sumErr2 / (len || 1);
    const snrDb = sumErr2 > 0 ? 10*Math.log10(sumOrig2/sumErr2) : 100;
    const denom = Math.sqrt((len*sumO2-sumO**2)*(len*sumR2-sumR**2));
    const correlationCoeff = denom > 0 ? (len*sumOR-sumO*sumR)/denom : 0;
    const reconResult: ReconstructedSignal = { time: signal.time.slice(0,len), real: recon.real.slice(0,len), imag: recon.imag.slice(0,len), errorReal, errorImag, mse, snrDb, peakError, correlationCoeff };
    setReconstruction(reconResult);
    return reconResult;
  }, [isLoRa, modType, sf, bw, signal, sampleRate, symbolRate, freqDeviation, chipRate]);

  const runSecurityAssessment = useCallback(() => {
    const results: { method: string; charAccuracy: number; symbolAccuracy: number; avgConfidence: number }[] = [];
    
    const allRes = [
      ...Object.entries(textComparison).map(([key, comp]) => {
        const res = key === "mlp" ? mlpResult
          : classicResults[key] ? classicResults[key]
          : urhResults[key] ? urhResults[key]
          : null;
        return { key, comp, res };
      }),
    ].filter(x => x.res && x.comp);

    for (const { key, comp, res } of allRes) {
      if (!res || !comp) continue;
      const symAcc = signal.symbols.slice(0, res.symbols.length)
        .filter((s, i) => s === res.symbols[i]).length / (res.symbols.length || 1);
      const avgConf = res.confidence.reduce((a, b) => a + b, 0) / (res.confidence.length || 1);
      results.push({ method: key, charAccuracy: comp.charAccuracy, symbolAccuracy: symAcc, avgConfidence: avgConf });
    }

    if (results.length === 0) return;

    const report = assessSecurity({
      sf, bw: bw * 1000, noiseLevel,
      decoderResults: results,
      originalTextLength: text.length,
      numSymbols,
      protocolClass: autoDetect && classification ? classification.detectedType : modType,
      signalReconstructionMetrics: reconstruction ? {
        mse: reconstruction.mse, snrDb: reconstruction.snrDb, correlationCoeff: reconstruction.correlationCoeff,
      } : undefined,
    });
    setSecurityReport(report);
  }, [textComparison, mlpResult, classicResults, urhResults, signal.symbols, sf, bw, noiseLevel, text.length, numSymbols, modType, autoDetect, classification, reconstruction]);

  useEffect(() => {
    if (Object.keys(textComparison).length > 0) runSecurityAssessment();
  }, [textComparison, runSecurityAssessment]);

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
      runReconstruction(decoded.symbols);
      toast.success(`MLP: точность ${(result.accuracy * 100).toFixed(1)}%`);
    } catch (e) {
      toast.error("Ошибка обучения MLP");
      console.error(e);
    } finally { setTraining(false); }
  }, [signal, noisySignal, samplesPerSymbol, config, M, sf, text, runReconstruction]);

  const runClassicDecoder = useCallback((type: DecoderType) => {
    try {
      if (!isLoRa) {
        let protResult: import("@/lib/modulation-engine").ProtocolDecodedResult;
        const sr = sampleRate;
        if (["bpsk", "qpsk", "8psk"].includes(modType)) {
          protResult = decodePSK(noisySignal.real, noisySignal.imag, samplesPerSymbol, bitsPerSym);
        } else if (["2fsk", "4fsk"].includes(modType)) {
          protResult = decodeFSK(noisySignal.real, noisySignal.imag, samplesPerSymbol, bitsPerSym, sr, freqDeviation);
        } else {
          const chipsPerSym = Math.floor(chipRate / symbolRate);
          const sampPerChip = Math.max(1, Math.floor(sr / chipRate));
          protResult = decodeCDMA(noisySignal.real, sampPerChip, chipsPerSym, 0);
        }
        const fakeResult: ClassicDecodedResult = {
          symbols: protResult.symbols, confidence: protResult.confidence,
          decodedBits: [], decodedText: protResult.decodedText, scores: [],
          method: type, processingTimeMs: protResult.processingTimeMs,
        };
        setClassicResults(prev => ({ ...prev, [type]: fakeResult }));
        setTextComparison(prev => ({ ...prev, [type]: compareTexts(text, protResult.decodedText) }));
        runReconstruction(protResult.symbols);
        toast.success(`${protResult.method}: ${protResult.processingTimeMs.toFixed(0)}мс`);
        return;
      }
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
      runReconstruction(result.symbols);
      toast.success(`${DECODER_REGISTRY.find(d => d.id === type)?.name}: ${(result.processingTimeMs).toFixed(0)}мс`);
    } catch (e) {
      toast.error(`Ошибка ${type}`);
      console.error(e);
    }
  }, [isLoRa, modType, noisySignal, samplesPerSymbol, sf, bw, bitsPerSym, sampleRate, symbolRate, freqDeviation, chipRate, text, runReconstruction]);

  const runURHDecoder = useCallback((type: URHDecoderType) => {
    try {
      let result: URHDecodedResult;
      const sr = isLoRa ? 500e3 : sampleRate;
      switch (type) {
        case "manchester":
          result = decodeManchesterURH(noisySignal.real, samplesPerSymbol, bitsPerSym);
          break;
        case "differential":
          result = decodeDifferentialURH(noisySignal.real, noisySignal.imag, samplesPerSymbol, bitsPerSym);
          break;
        case "zerocross":
          result = decodeZeroCrossingURH(noisySignal.real, samplesPerSymbol, bitsPerSym, sr);
          break;
        case "envelope":
          result = decodeEnvelopeURH(noisySignal.real, noisySignal.imag, samplesPerSymbol, bitsPerSym);
          break;
        case "preamble_sync":
          result = decodePreambleSyncURH(noisySignal.real, noisySignal.imag, samplesPerSymbol, bitsPerSym);
          break;
        case "bitslice":
          result = decodeBitsliceURH(noisySignal.real, samplesPerSymbol, bitsPerSym);
          break;
        default: return;
      }
      setUrhResults(prev => ({ ...prev, [type]: result }));
      setTextComparison(prev => ({ ...prev, [type]: compareTexts(text, result.decodedText) }));
      runReconstruction(result.symbols);
      toast.success(`${URH_DECODER_REGISTRY.find(d => d.id === type)?.name}: ${result.processingTimeMs.toFixed(0)}мс`);
    } catch (e) {
      toast.error(`Ошибка ${type}`);
      console.error(e);
    }
  }, [noisySignal, samplesPerSymbol, bitsPerSym, isLoRa, sampleRate, text, runReconstruction]);

  const runAll = useCallback(async () => {
    setTraining(true);
    await handleTrainMLP();
    for (const d of DECODER_REGISTRY) if (d.id !== "mlp") runClassicDecoder(d.id);
    for (const d of URH_DECODER_REGISTRY) runURHDecoder(d.id);
    setTraining(false);
  }, [handleTrainMLP, runClassicDecoder, runURHDecoder]);

  const allResults = useMemo(() => {
    const res: AnyResult[] = [];
    if (mlpResult) res.push({ method: "mlp", symbols: mlpResult.symbols, confidence: mlpResult.confidence, decodedText: mlpResult.decodedText });
    for (const [key, val] of Object.entries(classicResults)) {
      res.push({ method: key as DecoderType, symbols: val.symbols, confidence: val.confidence, decodedText: val.decodedText, processingTimeMs: val.processingTimeMs });
    }
    for (const [key, val] of Object.entries(urhResults)) {
      res.push({ method: key as URHDecoderType, symbols: val.symbols, confidence: val.confidence, decodedText: val.decodedText, processingTimeMs: val.processingTimeMs });
    }
    return res;
  }, [mlpResult, classicResults, urhResults]);

  const activeResult = useMemo(() => allResults.find(r => r.method === activeDecoder), [allResults, activeDecoder]);
  const activeComparison = textComparison[activeDecoder];

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

  const reconstructionPreview = useMemo(() => {
    if (!reconstruction || !activeResult) return [];
    const maxPts = 400;
    const len = Math.min(signal.real.length, reconstruction.real.length);
    const step = Math.max(1, Math.floor(len / maxPts));
    const data: { t: number; original: number; reconstructed: number; error: number }[] = [];
    for (let i = 0; i < len && data.length < maxPts; i += step) {
      data.push({
        t: +(signal.time[i] * 1000).toFixed(3),
        original: +signal.real[i].toFixed(4),
        reconstructed: +reconstruction.real[i].toFixed(4),
        error: +reconstruction.errorReal[i].toFixed(4),
      });
    }
    return data;
  }, [signal, reconstruction, activeResult]);

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
    return ALL_DECODERS.map(d => {
      const comp = textComparison[d.id];
      const res = allResults.find(r => r.method === d.id);
      return {
        id: d.id, name: d.name, group: d.group,
        charAcc: comp ? (comp.charAccuracy * 100).toFixed(1) : "—",
        editDist: comp ? comp.editDistance : "—",
        symCorrect: res ? `${signal.symbols.slice(0, res.symbols.length).filter((s, i) => s === res.symbols[i]).length}/${res.symbols.length}` : "—",
        time: res?.processingTimeMs != null ? `${res.processingTimeMs.toFixed(0)}мс` : (d.id === "mlp" && mlpTrain ? "обуч." : "—"),
        done: !!res,
      };
    });
  }, [textComparison, allResults, signal.symbols, mlpTrain]);

  const securityRadarData = useMemo(() => {
    if (!securityReport) return [];
    return securityReport.factors.map(f => ({
      factor: f.name.split(" ").slice(0, 2).join(" "),
      score: +f.score.toFixed(0),
      fullMark: 100,
    }));
  }, [securityReport]);

  return (
    <div className="space-y-3">
      {/* Protocol selector + auto-detect */}
      <div className="chart-panel">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-[10px] font-mono text-muted-foreground mb-1 block">Протокол модуляции</label>
            <ProtocolSelector value={modType} onChange={setModType} compact />
          </div>
          <div className="flex flex-col items-center gap-1">
            <label className="text-[8px] font-mono text-muted-foreground">Автоопр.</label>
            <button onClick={() => setAutoDetect(!autoDetect)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono border transition-colors ${
                autoDetect ? "bg-signal-amber/20 text-signal-amber border-signal-amber/40" : "bg-secondary text-muted-foreground border-border"
              }`}>
              <Search className="w-3 h-3" />
              {autoDetect ? "ON" : "OFF"}
            </button>
          </div>
        </div>
        {autoDetect && classification && (
          <div className="mt-2 p-2 rounded bg-secondary border border-border space-y-1">
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <Search className="w-3 h-3 text-signal-amber" />
              <span className="text-muted-foreground">Классификация:</span>
              <span className="text-signal-amber font-semibold">{classification.detectedType.toUpperCase()}</span>
              <span className="text-muted-foreground">({(classification.confidence * 100).toFixed(0)}%)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(classification.scores) as [ModulationType, number][])
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([proto, score]) => (
                  <span key={proto} className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${
                    proto === classification.detectedType ? "bg-signal-amber/20 text-signal-amber border-signal-amber/30" : "bg-secondary text-muted-foreground border-border"
                  }`}>
                    {proto}: {score.toFixed(0)}
                  </span>
                ))}
            </div>
            <div className="flex flex-wrap gap-2 text-[8px] font-mono text-muted-foreground">
              <span>AmpVar: {classification.features.amplitudeVariance.toFixed(3)}</span>
              <span>PhaseVar: {classification.features.phaseVariance.toFixed(2)}</span>
              <span>ZCR: {classification.features.zeroCrossingRate.toFixed(3)}</span>
              <span>Peaks: {classification.features.spectralPeakCount}</span>
              <span>Chip: {classification.features.chipPattern ? "✓" : "✗"}</span>
            </div>
          </div>
        )}
      </div>

      {/* Header */}
      <div className="chart-panel space-y-2">
        <div className="flex flex-wrap gap-3 items-center">
          <RotateCcw className="w-5 h-5 text-signal-amber" />
          <span className="text-sm font-mono font-semibold text-foreground">
            Обратное преобразование: s(t) → текст → s'(t)
          </span>
          <div className="ml-auto flex gap-1">
            {([
              ["manual", "Ручной ввод", "signal-green"],
              ["db", "Из БД", "signal-amber"],
              ["unified", "Единая модель", "signal-magenta"],
            ] as [SignalSourceMode, string, string][]).map(([mode, label, color]) => (
              <button key={mode}
                onClick={() => { setSignalSourceMode(mode); setShowDB(mode === "db"); }}
                className={`flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                  signalSourceMode === mode
                    ? `bg-${color}/20 text-${color} border-${color}/40`
                    : "bg-secondary text-muted-foreground border-border"
                }`}>
                {mode === "db" && <Database className="w-3 h-3" />}
                {mode === "unified" && <Radar className="w-3 h-3" />}
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Decoder tabs - two groups */}
        <div className="space-y-1">
          <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider">Классические декодеры</p>
          <div className="flex flex-wrap gap-1">
            {DECODER_REGISTRY.map(d => {
              const Icon = DECODER_ICONS[d.icon] || Brain;
              return (
                <button key={d.id} onClick={() => setActiveDecoder(d.id)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono border transition-all ${
                    activeDecoder === d.id
                      ? "border-signal-cyan/50 bg-signal-cyan/10 text-signal-cyan"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}>
                  <Icon className="w-3 h-3" />
                  {d.name}
                  {allResults.find(r => r.method === d.id) && <CheckCircle2 className="w-2.5 h-2.5 text-signal-green" />}
                </button>
              );
            })}
          </div>
          <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider mt-1">URH-декодеры</p>
          <div className="flex flex-wrap gap-1">
            {URH_DECODER_REGISTRY.map(d => {
              const Icon = DECODER_ICONS[d.icon] || Brain;
              return (
                <button key={d.id} onClick={() => setActiveDecoder(d.id)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono border transition-all ${
                    activeDecoder === d.id
                      ? "border-signal-magenta/50 bg-signal-magenta/10 text-signal-magenta"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}>
                  <Icon className="w-3 h-3" />
                  {d.name}
                  {allResults.find(r => r.method === d.id) && <CheckCircle2 className="w-2.5 h-2.5 text-signal-green" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* Left column */}
        <div className={`space-y-3 ${showDB ? "lg:col-span-2" : "lg:col-span-1"}`}>
          <div className={showDB ? "grid grid-cols-2 gap-3" : ""}>
            <div className="chart-panel space-y-2">
              <h3 className="text-xs font-mono font-semibold text-signal-green flex items-center gap-1">
                <Zap className="w-3 h-3" /> Сигнал
              </h3>
              <div className="space-y-1.5">
                {isLoRa && ([
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
                {!isLoRa && (
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-muted-foreground">Symbol Rate</span>
                    <select value={symbolRate} onChange={e => setSymbolRate(Number(e.target.value))}
                      className="bg-secondary text-foreground rounded px-1.5 py-0.5 text-[10px] font-mono border border-border">
                      {[1000, 5000, 10000, 20000].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                )}
                {["2fsk", "4fsk"].includes(modType) && (
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-muted-foreground">Девиация</span>
                    <input type="number" value={freqDeviation} onChange={e => setFreqDeviation(Number(e.target.value))}
                      className="bg-secondary text-foreground rounded px-1.5 py-0.5 text-[10px] font-mono border border-border w-20 text-right" />
                  </div>
                )}
                {modType === "cdma" && (
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-muted-foreground">Chip Rate</span>
                    <input type="number" value={chipRate} onChange={e => setChipRate(Number(e.target.value))}
                      className="bg-secondary text-foreground rounded px-1.5 py-0.5 text-[10px] font-mono border border-border w-20 text-right" />
                  </div>
                )}
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

            {showDB && (
              <div style={{ minHeight: 300 }}>
                <SignalDBBrowser multiSelect selectedIds={dbSelectedIds} onToggleSignal={handleToggleDbSignal} />
              </div>
            )}
          </div>

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
            ) : DECODER_REGISTRY.find(d => d.id === activeDecoder) ? (
              <button onClick={() => runClassicDecoder(activeDecoder as DecoderType)}
                className="w-full flex items-center justify-center gap-1.5 bg-signal-cyan/20 hover:bg-signal-cyan/30 text-signal-cyan rounded px-3 py-2 text-xs font-mono border border-signal-cyan/30 transition-colors">
                <Play className="w-3 h-3" />
                Декодировать ({DECODER_REGISTRY.find(d => d.id === activeDecoder)?.name})
              </button>
            ) : (
              <button onClick={() => runURHDecoder(activeDecoder as URHDecoderType)}
                className="w-full flex items-center justify-center gap-1.5 bg-signal-magenta/20 hover:bg-signal-magenta/30 text-signal-magenta rounded px-3 py-2 text-xs font-mono border border-signal-magenta/30 transition-colors">
                <Play className="w-3 h-3" />
                Декодировать ({URH_DECODER_REGISTRY.find(d => d.id === activeDecoder)?.name})
              </button>
            )}
            <button onClick={runAll} disabled={training}
              className="w-full flex items-center justify-center gap-1.5 bg-signal-magenta/20 hover:bg-signal-magenta/30 text-signal-magenta rounded px-3 py-1.5 text-[10px] font-mono border border-signal-magenta/30 transition-colors disabled:opacity-50">
              <ArrowRightLeft className="w-3 h-3" />
              Запустить все декодеры ({ALL_DECODERS.length})
            </button>
          </div>

          {/* Comparison table */}
          {allResults.length > 0 && (
            <div className="chart-panel">
              <h3 className="text-[10px] font-mono font-semibold text-signal-magenta flex items-center gap-1 mb-2">
                <BarChart3 className="w-3 h-3" /> Сравнение декодеров ({allResults.length}/{ALL_DECODERS.length})
              </h3>
              <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
                <table className="w-full text-[9px] font-mono">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border">
                      <th className="text-left py-1 text-muted-foreground font-normal">Метод</th>
                      <th className="text-right py-1 text-muted-foreground font-normal">Символы</th>
                      <th className="text-right py-1 text-muted-foreground font-normal">Текст %</th>
                      <th className="text-right py-1 text-muted-foreground font-normal">Edit</th>
                      <th className="text-right py-1 text-muted-foreground font-normal">Время</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonTable.filter(r => r.done).map(row => (
                      <tr key={row.id}
                        onClick={() => setActiveDecoder(row.id as AnyDecoderType)}
                        className={`border-b border-border/30 cursor-pointer transition-colors ${
                          activeDecoder === row.id ? "bg-signal-cyan/5" : "hover:bg-secondary/50"
                        }`}>
                        <td className="py-1 text-foreground flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${row.group === "urh" ? "bg-signal-magenta" : "bg-signal-cyan"}`} />
                          {row.name}
                        </td>
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

          {/* Security Assessment */}
          {securityReport && (
            <div className="chart-panel space-y-2">
              <h3 className="text-xs font-mono font-semibold flex items-center gap-1.5">
                {(() => { const Icon = RISK_ICONS[securityReport.riskLevel]; return <Icon className={`w-4 h-4 ${RISK_COLORS[securityReport.riskLevel]}`} />; })()}
                <span className={RISK_COLORS[securityReport.riskLevel]}>
                  Оценка взлома: {securityReport.vulnerabilityScore.toFixed(0)}/100
                </span>
                {securityReport.protocolClass && (
                  <span className="text-[9px] text-muted-foreground ml-1">[{securityReport.protocolClass.toUpperCase()}]</span>
                )}
              </h3>

              {/* Separate signal vs text scores */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded bg-secondary border border-border">
                  <p className="text-[8px] font-mono text-muted-foreground">Восстановление сигнала</p>
                  <p className={`text-lg font-mono font-bold ${
                    securityReport.signalRecoveryScore > 70 ? "text-signal-red" :
                    securityReport.signalRecoveryScore > 40 ? "text-signal-amber" : "text-signal-green"
                  }`}>{securityReport.signalRecoveryScore.toFixed(0)}%</p>
                  <p className="text-[7px] font-mono text-muted-foreground">s(t) → s'(t) корреляция</p>
                </div>
                <div className="p-2 rounded bg-secondary border border-border">
                  <p className="text-[8px] font-mono text-muted-foreground">Расшифровка текста</p>
                  <p className={`text-lg font-mono font-bold ${
                    securityReport.textDecryptionScore > 70 ? "text-signal-red" :
                    securityReport.textDecryptionScore > 40 ? "text-signal-amber" : "text-signal-green"
                  }`}>{securityReport.textDecryptionScore.toFixed(0)}%</p>
                  <p className="text-[7px] font-mono text-muted-foreground">text → text' совпадение</p>
                </div>
              </div>

              <p className="text-[9px] font-mono text-muted-foreground">{securityReport.summary}</p>

              {/* Factor breakdown */}
              <div className="space-y-1">
                {securityReport.factors.map((f, i) => (
                  <div key={i} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[9px] font-mono">
                      <span className="text-muted-foreground truncate max-w-[160px]">{f.name}</span>
                      <span className={f.score > 70 ? "text-signal-red" : f.score > 40 ? "text-signal-amber" : "text-signal-green"}>
                        {f.score.toFixed(0)}%
                      </span>
                    </div>
                    <div className="w-full h-1 bg-secondary rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${
                        f.score > 70 ? "bg-signal-red" : f.score > 40 ? "bg-signal-amber" : "bg-signal-green"
                      }`} style={{ width: `${f.score}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-2 mt-2">
                <p className="text-[9px] font-mono font-semibold text-muted-foreground mb-1">Рекомендации:</p>
                <ul className="space-y-0.5">
                  {securityReport.recommendations.map((r, i) => (
                    <li key={i} className="text-[8px] font-mono text-muted-foreground flex gap-1">
                      <span className="text-signal-amber">•</span><span>{r}</span>
                    </li>
                  ))}
                </ul>
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
              {autoDetect && classification && (
                <span className="text-signal-amber ml-2">[авто: {classification.detectedType.toUpperCase()}]</span>
              )}
              {dbSelectedIds.length > 0 && <span className="text-signal-amber ml-2">[БД: {dbSelectedIds.length}]</span>}
            </h3>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={signalPreview}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis dataKey="t" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
                {noiseLevel > 0 && <Line dataKey="noisy" stroke="hsl(var(--signal-red))" dot={false} strokeWidth={0.8} name="Зашумлённый" opacity={0.6} />}
                <Line dataKey="clean" stroke="hsl(var(--signal-blue))" dot={false} strokeWidth={1.2} name="Оригинал" />
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
                    Результат: {ALL_DECODERS.find(d => d.id === activeDecoder)?.name}
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[9px] font-mono text-muted-foreground mb-1">Оригинал:</p>
                    <p className="text-[11px] font-mono text-foreground bg-secondary rounded px-2 py-1.5 break-all max-h-24 overflow-y-auto">{text}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-muted-foreground mb-1">Декодировано:</p>
                    <p className="text-[11px] font-mono text-signal-cyan bg-secondary rounded px-2 py-1.5 break-all max-h-24 overflow-y-auto">
                      {activeResult.decodedText || "[пусто]"}
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

              {/* Reconstructed signal comparison */}
              {reconstruction && (
                <div className="chart-panel" style={{ height: 200 }}>
                  <div className="flex items-center gap-2 mb-1">
                    <RefreshCw className="w-3.5 h-3.5 text-signal-magenta" />
                    <h3 className="text-[10px] font-mono font-semibold text-signal-magenta">
                      Обратная генерация: s'(t) из декодированных символов
                    </h3>
                    <div className="ml-auto flex gap-3 text-[9px] font-mono">
                      <span className="text-muted-foreground">MSE: <span className="text-foreground">{reconstruction.mse.toExponential(2)}</span></span>
                      <span className="text-muted-foreground">SNR: <span className="text-foreground">{reconstruction.snrDb.toFixed(1)} дБ</span></span>
                      <span className="text-muted-foreground">r: <span className={
                        reconstruction.correlationCoeff > 0.9 ? "text-signal-green" :
                        reconstruction.correlationCoeff > 0.5 ? "text-signal-amber" : "text-signal-red"
                      }>{reconstruction.correlationCoeff.toFixed(4)}</span></span>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height="85%">
                    <LineChart data={reconstructionPreview}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                      <XAxis dataKey="t" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 9 }} />
                      <Legend wrapperStyle={{ fontSize: 9 }} />
                      <Line dataKey="original" stroke="hsl(var(--signal-blue))" dot={false} strokeWidth={1.2} name="Оригинал s(t)" />
                      <Line dataKey="reconstructed" stroke="hsl(var(--signal-magenta))" dot={false} strokeWidth={1} name="Реконструкция s'(t)" opacity={0.8} />
                      <Line dataKey="error" stroke="hsl(var(--signal-red))" dot={false} strokeWidth={0.7} name="Ошибка" opacity={0.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

              {/* Security radar + reconstruction metrics */}
              {securityReport && securityRadarData.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="chart-panel" style={{ height: 240 }}>
                    <h3 className="text-[10px] font-mono font-semibold text-foreground mb-1 flex items-center gap-1">
                      <Activity className="w-3 h-3 text-signal-red" /> Радар уязвимостей
                    </h3>
                    <ResponsiveContainer width="100%" height="90%">
                      <RadarChart data={securityRadarData}>
                        <PolarGrid stroke="hsl(var(--border))" />
                        <PolarAngleAxis dataKey="factor" tick={{ fontSize: 7, fill: "hsl(var(--muted-foreground))" }} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 7, fill: "hsl(var(--muted-foreground))" }} />
                        <ReRadar name="Уязвимость" dataKey="score" stroke="hsl(var(--signal-red))" fill="hsl(var(--signal-red))" fillOpacity={0.2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>

                  {reconstruction && (
                    <div className="chart-panel space-y-2">
                      <h3 className="text-[10px] font-mono font-semibold text-signal-magenta flex items-center gap-1">
                        <RefreshCw className="w-3 h-3" /> Метрики реконструкции (сигнал)
                      </h3>
                      <div className="space-y-1.5 text-[10px] font-mono">
                        <div className="flex justify-between"><span className="text-muted-foreground">MSE (ср. квадр. ошибка):</span>
                          <span className="text-foreground">{reconstruction.mse.toExponential(3)}</span>
                        </div>
                        <div className="flex justify-between"><span className="text-muted-foreground">SNR реконструкции:</span>
                          <span className={reconstruction.snrDb > 20 ? "text-signal-green" : reconstruction.snrDb > 5 ? "text-signal-amber" : "text-signal-red"}>
                            {reconstruction.snrDb.toFixed(1)} дБ
                          </span>
                        </div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Пиковая ошибка:</span>
                          <span className="text-foreground">{reconstruction.peakError.toFixed(4)}</span>
                        </div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Корреляция Пирсона:</span>
                          <span className={
                            reconstruction.correlationCoeff > 0.95 ? "text-signal-green" :
                            reconstruction.correlationCoeff > 0.7 ? "text-signal-amber" : "text-signal-red"
                          }>{reconstruction.correlationCoeff.toFixed(4)}</span>
                        </div>
                      </div>
                      {activeComparison && (
                        <>
                          <h3 className="text-[10px] font-mono font-semibold text-signal-cyan flex items-center gap-1 pt-2 border-t border-border">
                            <FileText className="w-3 h-3" /> Метрики расшифровки (текст)
                          </h3>
                          <div className="space-y-1.5 text-[10px] font-mono">
                            <div className="flex justify-between"><span className="text-muted-foreground">Точность символов:</span>
                              <span className={activeComparison.charAccuracy > 0.8 ? "text-signal-green" : activeComparison.charAccuracy > 0.4 ? "text-signal-amber" : "text-signal-red"}>
                                {(activeComparison.charAccuracy * 100).toFixed(1)}%
                              </span>
                            </div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Совпадений:</span>
                              <span className="text-foreground">{activeComparison.matchingChars}/{activeComparison.totalChars}</span>
                            </div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Edit distance:</span>
                              <span className="text-foreground">{activeComparison.editDistance}</span>
                            </div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Символов декод./ориг.:</span>
                              <span className="text-foreground">
                                {activeResult ? `${signal.symbols.slice(0, activeResult.symbols.length).filter((s, i) => s === activeResult.symbols[i]).length}/${activeResult.symbols.length}` : "—"}
                              </span>
                            </div>
                          </div>
                        </>
                      )}
                      <div className="border-t border-border pt-2 text-[9px] font-mono text-muted-foreground">
                        Полный цикл: текст → символы → s(t) → декодер → символы' → s'(t) → текст'
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* MLP-specific */}
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
                {ALL_DECODERS.length} декодеров · обратная генерация s'(t) · оценка уязвимости
              </p>
              <p className="text-[10px] font-mono text-muted-foreground/60 mt-3 max-w-md">
                Классические: MLP, корреляция, DFT, шаблоны · URH: Манчестер, дифференциальный, ZCR, огибающая, преамбула, битовый срез
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
