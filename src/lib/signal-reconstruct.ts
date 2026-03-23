/**
 * Signal Reconstruction Engine
 * 
 * Reconstructs original signal from decoded symbols using the same
 * LoRa chirp generation model used for forward encoding.
 * Also provides security/vulnerability assessment based on decoding quality.
 */

import { generateLoRaSignal, type LoRaParams, type SignalData } from "./lora-signal";

export interface ReconstructedSignal {
  time: number[];
  real: number[];
  imag: number[];
  /** Per-sample error vs original */
  errorReal: number[];
  errorImag: number[];
  /** Metrics */
  mse: number;
  snrDb: number;
  peakError: number;
  correlationCoeff: number;
}

/**
 * Reconstruct a signal from decoded symbols by re-encoding them
 * through the same LoRa chirp modulator.
 */
export function reconstructFromSymbols(
  decodedSymbols: number[],
  params: LoRaParams
): SignalData {
  const { sf, bw, sampleRate } = params;
  const M = 2 ** sf;
  const tSymbol = M / bw;
  const samplesPerSymbol = Math.floor(sampleRate * tSymbol);
  const dt = 1 / sampleRate;

  const totalSamples = decodedSymbols.length * samplesPerSymbol;
  const time: number[] = new Array(totalSamples);
  const real: number[] = new Array(totalSamples);
  const imag: number[] = new Array(totalSamples);
  const amplitude: number[] = new Array(totalSamples);

  for (let symIdx = 0; symIdx < decodedSymbols.length; symIdx++) {
    const symVal = decodedSymbols[symIdx] % M;
    const startIdx = symIdx * samplesPerSymbol;
    const freqOffset = (symVal / M) * bw;

    let phase = 0;
    for (let j = 0; j < samplesPerSymbol; j++) {
      const idx = startIdx + j;
      const tNorm = j * dt;
      const instFreq = (bw / tSymbol) * tNorm - bw / 2 + freqOffset;
      const wrappedFreq = ((instFreq + bw / 2) % bw + bw) % bw - bw / 2;
      phase += 2 * Math.PI * wrappedFreq * dt;

      time[idx] = (startIdx + j) * dt;
      real[idx] = Math.cos(phase);
      imag[idx] = Math.sin(phase);
      amplitude[idx] = 1.0;
    }
  }

  return { time, real, imag, amplitude, symbols: decodedSymbols, params };
}

/**
 * Compare original and reconstructed signals, returning error metrics
 */
export function compareSignals(
  original: { real: number[]; imag: number[]; time: number[] },
  reconstructed: { real: number[]; imag: number[]; time: number[] }
): ReconstructedSignal {
  const len = Math.min(original.real.length, reconstructed.real.length);
  const errorReal: number[] = new Array(len);
  const errorImag: number[] = new Array(len);

  let sumErr2 = 0;
  let sumOrig2 = 0;
  let peakError = 0;

  // For Pearson correlation
  let sumOR = 0, sumO = 0, sumR = 0, sumO2 = 0, sumR2 = 0;

  for (let i = 0; i < len; i++) {
    const er = original.real[i] - reconstructed.real[i];
    const ei = original.imag[i] - reconstructed.imag[i];
    errorReal[i] = er;
    errorImag[i] = ei;
    const err2 = er * er + ei * ei;
    sumErr2 += err2;
    sumOrig2 += original.real[i] ** 2 + original.imag[i] ** 2;
    peakError = Math.max(peakError, Math.sqrt(err2));

    // Correlation on real part
    sumOR += original.real[i] * reconstructed.real[i];
    sumO += original.real[i];
    sumR += reconstructed.real[i];
    sumO2 += original.real[i] ** 2;
    sumR2 += reconstructed.real[i] ** 2;
  }

  const mse = sumErr2 / (len || 1);
  const snrDb = sumErr2 > 0 ? 10 * Math.log10(sumOrig2 / sumErr2) : 100;

  const denom = Math.sqrt((len * sumO2 - sumO ** 2) * (len * sumR2 - sumR ** 2));
  const correlationCoeff = denom > 0 ? (len * sumOR - sumO * sumR) / denom : 0;

  return {
    time: original.time.slice(0, len),
    real: reconstructed.real.slice(0, len),
    imag: reconstructed.imag.slice(0, len),
    errorReal,
    errorImag,
    mse,
    snrDb,
    peakError,
    correlationCoeff,
  };
}

/**
 * Symbols → bits → text reconstruction (mirrors lora-signal encoding)
 */
export function symbolsToText(symbols: number[], sf: number): string {
  const bits: number[] = [];
  for (const sym of symbols) {
    for (let i = sf - 1; i >= 0; i--) {
      bits.push((sym >> i) & 1);
    }
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    bytes.push(byte);
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
    return decoded.replace(/[\x00-\x08\x0E-\x1F\x7F-\x9F]/g, "·");
  } catch {
    return "[decode error]";
  }
}

// ─── Security / Crack Assessment ───

export interface SecurityAssessment {
  /** Overall vulnerability score 0-100 (higher = more vulnerable) */
  vulnerabilityScore: number;
  /** Risk level */
  riskLevel: "critical" | "high" | "medium" | "low" | "minimal";
  /** Individual factor scores */
  factors: SecurityFactor[];
  /** Text summary */
  summary: string;
  /** Recommendations */
  recommendations: string[];
  /** Separate signal reconstruction quality 0-100 */
  signalRecoveryScore: number;
  /** Separate text decryption quality 0-100 */
  textDecryptionScore: number;
  /** Detected protocol class */
  protocolClass?: string;
}

interface SecurityFactor {
  name: string;
  score: number; // 0-100
  weight: number;
  description: string;
}

/**
 * Assess how vulnerable the signal is to being cracked / decoded,
 * based on current decoder performance metrics.
 */
export function assessSecurity(params: {
  sf: number;
  bw: number;
  noiseLevel: number;
  decoderResults: {
    method: string;
    charAccuracy: number;
    symbolAccuracy: number;
    avgConfidence: number;
  }[];
  originalTextLength: number;
  numSymbols: number;
}): SecurityAssessment {
  const { sf, bw, noiseLevel, decoderResults, originalTextLength, numSymbols } = params;

  const factors: SecurityFactor[] = [];

  // 1. Best decoder accuracy — higher accuracy = more vulnerable
  const bestCharAcc = Math.max(0, ...decoderResults.map(r => r.charAccuracy));
  const bestSymAcc = Math.max(0, ...decoderResults.map(r => r.symbolAccuracy));
  factors.push({
    name: "Точность декодирования текста",
    score: bestCharAcc * 100,
    weight: 0.30,
    description: `Лучший декодер восстановил ${(bestCharAcc * 100).toFixed(1)}% символов текста`,
  });

  factors.push({
    name: "Точность символов LoRa",
    score: bestSymAcc * 100,
    weight: 0.25,
    description: `Лучшая точность по символам модуляции: ${(bestSymAcc * 100).toFixed(1)}%`,
  });

  // 2. Decoder confidence — high confidence = vulnerable
  const bestConf = Math.max(0, ...decoderResults.map(r => r.avgConfidence));
  factors.push({
    name: "Уверенность декодера",
    score: bestConf * 100,
    weight: 0.15,
    description: `Средняя уверенность: ${(bestConf * 100).toFixed(1)}%`,
  });

  // 3. SF protection — lower SF = less protection
  const sfProtection = Math.max(0, 100 - ((sf - 7) / 5) * 60); // SF7=100, SF12=40
  factors.push({
    name: "Защита SF (Spreading Factor)",
    score: sfProtection,
    weight: 0.10,
    description: `SF=${sf}: ${sf <= 8 ? "низкая" : sf <= 10 ? "средняя" : "высокая"} сложность перебора (M=2^${sf}=${2 ** sf})`,
  });

  // 4. Noise resistance — low noise = vulnerable
  const noiseProtection = Math.max(0, 100 - noiseLevel * 200);
  factors.push({
    name: "Шумовая маскировка",
    score: noiseProtection,
    weight: 0.10,
    description: noiseLevel > 0.2
      ? `Высокий шум (σ=${(noiseLevel * 100).toFixed(0)}%) затрудняет перехват`
      : `Низкий шум (σ=${(noiseLevel * 100).toFixed(0)}%) — сигнал легко перехватить`,
  });

  // 5. Entropy of decoded text — repetitive = easier to crack
  const consistencyAcrossDecoders = decoderResults.length > 1
    ? decoderResults.filter(r => r.charAccuracy > 0.5).length / decoderResults.length
    : 0;
  factors.push({
    name: "Консистентность декодеров",
    score: consistencyAcrossDecoders * 100,
    weight: 0.10,
    description: `${decoderResults.filter(r => r.charAccuracy > 0.5).length} из ${decoderResults.length} декодеров дали >50% точности`,
  });

  // Compute weighted vulnerability score
  const vulnerabilityScore = factors.reduce((s, f) => s + f.score * f.weight, 0);

  const riskLevel: SecurityAssessment["riskLevel"] =
    vulnerabilityScore > 80 ? "critical" :
    vulnerabilityScore > 60 ? "high" :
    vulnerabilityScore > 40 ? "medium" :
    vulnerabilityScore > 20 ? "low" : "minimal";

  const recommendations: string[] = [];
  if (sf < 10) recommendations.push(`Увеличить SF до 10-12 для усложнения перебора (текущий M=${2 ** sf}, при SF12 M=4096)`);
  if (noiseLevel < 0.1) recommendations.push("Добавить искусственный шум или использовать сигнал с более высоким SNR-порогом");
  if (bestCharAcc > 0.5) recommendations.push("Применить шифрование данных перед модуляцией (AES-128/256)");
  if (bestSymAcc > 0.7) recommendations.push("Использовать frequency hopping (FHSS) для маскировки структуры символов");
  if (consistencyAcrossDecoders > 0.5) recommendations.push("Добавить interleaving и scrambling для снижения корреляций");
  if (recommendations.length === 0) recommendations.push("Текущий уровень защиты достаточен для данных условий");

  const summary = `Уязвимость: ${vulnerabilityScore.toFixed(0)}/100 (${
    { critical: "КРИТИЧЕСКИЙ", high: "ВЫСОКИЙ", medium: "СРЕДНИЙ", low: "НИЗКИЙ", minimal: "МИНИМАЛЬНЫЙ" }[riskLevel]
  }). ${bestCharAcc > 0.5
    ? `Декодеры восстанавливают ${(bestCharAcc * 100).toFixed(0)}% текста — сигнал уязвим к перехвату.`
    : `Декодеры не могут восстановить текст (${(bestCharAcc * 100).toFixed(0)}%) — сигнал защищён.`
  }`;

  return { vulnerabilityScore, riskLevel, factors, summary, recommendations };
}
