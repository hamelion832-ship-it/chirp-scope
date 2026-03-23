/**
 * URH-inspired (Universal Radio Hacker) decoding methods
 * + Protocol auto-classifier for DB signals
 *
 * Additional decoders:
 *  1. Manchester — decodes Manchester-encoded bit stream
 *  2. Differential — differential phase/amplitude decoding
 *  3. Zero-crossing — frequency estimation via zero-crossings
 *  4. Envelope (ASK/OOK) — amplitude envelope detector
 *  5. Preamble-sync — detects preamble & sync words, then decodes payload
 *  6. Bitslice — sliding window bit-pattern correlation
 */

import type { ModulationType } from "./modulation-engine";

// ─── Protocol Auto-Classifier ───

export interface ProtocolClassification {
  detectedType: ModulationType;
  confidence: number;
  scores: Record<ModulationType, number>;
  features: {
    amplitudeVariance: number;
    phaseVariance: number;
    zeroCrossingRate: number;
    spectralPeakCount: number;
    envelopeStdDev: number;
    chipPattern: boolean;
  };
}

/** Classify a raw IQ signal into one of the supported modulation types */
export function classifyProtocol(
  real: number[],
  imag: number[],
  sampleRate: number
): ProtocolClassification {
  const N = Math.min(real.length, 8192);

  // Feature 1: amplitude variance (constant envelope → PSK/FSK, varying → ASK/CDMA)
  let sumAmp = 0, sumAmp2 = 0;
  const amps: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = Math.sqrt(real[i] ** 2 + imag[i] ** 2);
    amps.push(a);
    sumAmp += a;
    sumAmp2 += a * a;
  }
  const meanAmp = sumAmp / N;
  const amplitudeVariance = sumAmp2 / N - meanAmp ** 2;

  // Feature 2: phase variance
  const phases: number[] = [];
  let sumPh = 0;
  for (let i = 0; i < N; i++) {
    const p = Math.atan2(imag[i], real[i]);
    phases.push(p);
    sumPh += p;
  }
  const meanPh = sumPh / N;
  let phaseVar = 0;
  for (let i = 0; i < N; i++) phaseVar += (phases[i] - meanPh) ** 2;
  phaseVar /= N;

  // Feature 3: zero-crossing rate (high → FSK/CDMA)
  let zc = 0;
  for (let i = 1; i < N; i++) if (real[i] * real[i - 1] < 0) zc++;
  const zeroCrossingRate = zc / N;

  // Feature 4: spectral peak count (simple DFT, count prominent peaks)
  const fftSize = 256;
  const bins: number[] = new Array(fftSize).fill(0);
  const len = Math.min(N, fftSize * 4);
  for (let k = 0; k < fftSize; k++) {
    let sr = 0, si = 0;
    for (let n = 0; n < len; n++) {
      const angle = -2 * Math.PI * k * n / fftSize;
      sr += real[n] * Math.cos(angle) - imag[n] * Math.sin(angle);
      si += real[n] * Math.sin(angle) + imag[n] * Math.cos(angle);
    }
    bins[k] = Math.sqrt(sr * sr + si * si);
  }
  const maxBin = Math.max(...bins);
  const threshold = maxBin * 0.3;
  let spectralPeakCount = 0;
  for (let k = 1; k < fftSize - 1; k++) {
    if (bins[k] > threshold && bins[k] > bins[k - 1] && bins[k] > bins[k + 1]) spectralPeakCount++;
  }

  // Feature 5: envelope std dev
  let envSum = 0, envSum2 = 0;
  for (const a of amps) { envSum += a; envSum2 += a * a; }
  const envelopeStdDev = Math.sqrt(envSum2 / N - (envSum / N) ** 2);

  // Feature 6: chip pattern detection (rapid transitions → CDMA)
  let rapidTransitions = 0;
  for (let i = 2; i < Math.min(N, 2000); i++) {
    if (Math.sign(real[i]) !== Math.sign(real[i - 1]) && Math.sign(real[i - 1]) !== Math.sign(real[i - 2]))
      rapidTransitions++;
  }
  const chipPattern = rapidTransitions > Math.min(N, 2000) * 0.3;

  // Score each protocol
  const scores: Record<ModulationType, number> = {
    lora: 0, bpsk: 0, qpsk: 0, "8psk": 0, "2fsk": 0, "4fsk": 0, cdma: 0,
  };

  // LoRa: chirp → moderate ZCR, moderate phase variance, constant amplitude
  scores.lora = (amplitudeVariance < 0.1 ? 25 : 5) +
    (phaseVar > 0.5 ? 25 : 10) +
    (zeroCrossingRate > 0.1 && zeroCrossingRate < 0.4 ? 25 : 5) +
    (spectralPeakCount > 3 ? 20 : 5);

  // PSK: constant envelope, discrete phase states
  const pskBase = (amplitudeVariance < 0.05 ? 30 : 5) + (envelopeStdDev < 0.1 ? 20 : 5);
  scores.bpsk = pskBase + (phaseVar > 1.5 ? 20 : 5) + (spectralPeakCount <= 2 ? 15 : 5);
  scores.qpsk = pskBase + (phaseVar > 0.8 && phaseVar < 2.0 ? 20 : 5) + (spectralPeakCount <= 3 ? 15 : 5);
  scores["8psk"] = pskBase + (phaseVar > 0.5 && phaseVar < 1.5 ? 20 : 5) + (spectralPeakCount <= 4 ? 15 : 5);

  // FSK: constant envelope, high ZCR variation, multiple spectral peaks
  const fskBase = (amplitudeVariance < 0.05 ? 25 : 5) + (zeroCrossingRate > 0.2 ? 20 : 5);
  scores["2fsk"] = fskBase + (spectralPeakCount >= 2 && spectralPeakCount <= 3 ? 25 : 5) + (phaseVar > 1.0 ? 15 : 5);
  scores["4fsk"] = fskBase + (spectralPeakCount >= 3 && spectralPeakCount <= 6 ? 25 : 5) + (phaseVar > 0.8 ? 15 : 5);

  // CDMA: rapid transitions (chip pattern), wide spectrum
  scores.cdma = (chipPattern ? 35 : 5) +
    (spectralPeakCount > 5 ? 25 : 5) +
    (zeroCrossingRate > 0.35 ? 20 : 5) +
    (amplitudeVariance > 0.05 ? 15 : 5);

  // Normalize
  const maxScore = Math.max(...Object.values(scores));
  const detectedType = (Object.entries(scores) as [ModulationType, number][])
    .sort((a, b) => b[1] - a[1])[0][0];

  return {
    detectedType,
    confidence: maxScore > 0 ? Math.min(1, maxScore / 100) : 0,
    scores,
    features: { amplitudeVariance, phaseVariance: phaseVar, zeroCrossingRate, spectralPeakCount, envelopeStdDev, chipPattern },
  };
}

// ─── URH-Inspired Decoders ───

export type URHDecoderType = "manchester" | "differential" | "zerocross" | "envelope" | "preamble_sync" | "bitslice";

export interface URHDecoderMeta {
  id: URHDecoderType;
  name: string;
  description: string;
  icon: string;
}

export const URH_DECODER_REGISTRY: URHDecoderMeta[] = [
  { id: "manchester", name: "Манчестерский", description: "Manchester-кодирование (IEEE 802.3)", icon: "Binary" },
  { id: "differential", name: "Дифференциальный", description: "Diff-декодирование фазы/амплитуды", icon: "GitBranch" },
  { id: "zerocross", name: "Zero-crossing", description: "Оценка частоты через нуль-переходы", icon: "TrendingUp" },
  { id: "envelope", name: "Огибающая (ASK)", description: "Детектор амплитудной огибающей (OOK/ASK)", icon: "Activity" },
  { id: "preamble_sync", name: "Преамбула+Sync", description: "Детектор преамбулы и синхрослова", icon: "ScanLine" },
  { id: "bitslice", name: "Битовый срез", description: "Скользящее окно корреляции паттернов", icon: "Layers" },
];

export interface URHDecodedResult {
  symbols: number[];
  confidence: number[];
  decodedBits: number[];
  decodedText: string;
  method: URHDecoderType;
  processingTimeMs: number;
  metadata?: Record<string, unknown>;
}

/** Manchester decoder: transitions in middle of bit period encode data */
export function decodeManchesterURH(
  real: number[],
  samplesPerSymbol: number,
  _bitsPerSym: number
): URHDecodedResult {
  const t0 = performance.now();
  const halfPeriod = Math.floor(samplesPerSymbol / 2);
  const numBits = Math.floor(real.length / samplesPerSymbol);
  const bits: number[] = [];
  const confidence: number[] = [];

  for (let bi = 0; bi < numBits; bi++) {
    const start = bi * samplesPerSymbol;
    // Average of first half vs second half
    let firstHalf = 0, secondHalf = 0;
    for (let j = 0; j < halfPeriod && (start + j) < real.length; j++) firstHalf += real[start + j];
    for (let j = halfPeriod; j < samplesPerSymbol && (start + j) < real.length; j++) secondHalf += real[start + j];
    firstHalf /= halfPeriod || 1;
    secondHalf /= (samplesPerSymbol - halfPeriod) || 1;

    // Manchester: low→high = 1, high→low = 0
    const diff = secondHalf - firstHalf;
    bits.push(diff > 0 ? 1 : 0);
    confidence.push(Math.min(1, Math.abs(diff) * 2));
  }

  return finalizeURH(bits, confidence, 1, "manchester", t0);
}

/** Differential decoder: decode based on changes between consecutive symbols */
export function decodeDifferentialURH(
  real: number[],
  imag: number[],
  samplesPerSymbol: number,
  bitsPerSym: number
): URHDecodedResult {
  const t0 = performance.now();
  const M = 2 ** bitsPerSym;
  const numSymbols = Math.floor(real.length / samplesPerSymbol);
  const symbols: number[] = [];
  const confidence: number[] = [];

  let prevPhase = 0;
  for (let si = 0; si < numSymbols; si++) {
    const start = si * samplesPerSymbol;
    let avgI = 0, avgQ = 0;
    const len = Math.min(samplesPerSymbol, real.length - start);
    for (let j = 0; j < len; j++) { avgI += real[start + j]; avgQ += imag[start + j]; }
    avgI /= len; avgQ /= len;

    let phase = Math.atan2(avgQ, avgI);
    let dp = phase - prevPhase;
    // Unwrap
    while (dp > Math.PI) dp -= 2 * Math.PI;
    while (dp < -Math.PI) dp += 2 * Math.PI;

    // Map delta-phase to symbol
    const normalized = ((dp / (2 * Math.PI)) * M + M) % M;
    const sym = Math.round(normalized) % M;
    symbols.push(sym);
    confidence.push(Math.min(1, Math.sqrt(avgI * avgI + avgQ * avgQ)));
    prevPhase = phase;
  }

  return finalizeURH(symbols.slice(1), confidence.slice(1), bitsPerSym, "differential", t0);
}

/** Zero-crossing decoder: estimate instantaneous frequency via zero-crossings */
export function decodeZeroCrossingURH(
  real: number[],
  samplesPerSymbol: number,
  bitsPerSym: number,
  sampleRate: number
): URHDecodedResult {
  const t0 = performance.now();
  const M = 2 ** bitsPerSym;
  const numSymbols = Math.floor(real.length / samplesPerSymbol);
  const symbols: number[] = [];
  const confidence: number[] = [];

  // Collect all symbol frequencies to normalize
  const freqs: number[] = [];
  for (let si = 0; si < numSymbols; si++) {
    const start = si * samplesPerSymbol;
    const len = Math.min(samplesPerSymbol, real.length - start);
    let crossings = 0;
    for (let j = 1; j < len; j++) {
      if (real[start + j] * real[start + j - 1] < 0) crossings++;
    }
    const freq = (crossings / 2) * (sampleRate / len);
    freqs.push(freq);
  }

  const minFreq = Math.min(...freqs);
  const maxFreq = Math.max(...freqs);
  const freqRange = maxFreq - minFreq || 1;

  for (let si = 0; si < numSymbols; si++) {
    const normalized = (freqs[si] - minFreq) / freqRange;
    const sym = Math.round(normalized * (M - 1));
    symbols.push(Math.max(0, Math.min(M - 1, sym)));
    // Confidence based on how close to a discrete level
    const quantized = sym / (M - 1);
    confidence.push(Math.min(1, 1 - Math.abs(normalized - quantized) * M));
  }

  return finalizeURH(symbols, confidence, bitsPerSym, "zerocross", t0);
}

/** Envelope/ASK decoder: amplitude-based detection (OOK/ASK) */
export function decodeEnvelopeURH(
  real: number[],
  imag: number[],
  samplesPerSymbol: number,
  bitsPerSym: number
): URHDecodedResult {
  const t0 = performance.now();
  const M = 2 ** bitsPerSym;
  const numSymbols = Math.floor(real.length / samplesPerSymbol);
  const symbols: number[] = [];
  const confidence: number[] = [];

  // Compute all envelopes first
  const envs: number[] = [];
  for (let si = 0; si < numSymbols; si++) {
    const start = si * samplesPerSymbol;
    let sum = 0;
    const len = Math.min(samplesPerSymbol, real.length - start);
    for (let j = 0; j < len; j++) {
      sum += Math.sqrt(real[start + j] ** 2 + imag[start + j] ** 2);
    }
    envs.push(sum / len);
  }

  const minEnv = Math.min(...envs);
  const maxEnv = Math.max(...envs);
  const range = maxEnv - minEnv || 1;

  for (let si = 0; si < numSymbols; si++) {
    const normalized = (envs[si] - minEnv) / range;
    const sym = Math.round(normalized * (M - 1));
    symbols.push(Math.max(0, Math.min(M - 1, sym)));
    confidence.push(Math.min(1, envs[si] / (maxEnv || 1)));
  }

  return finalizeURH(symbols, confidence, bitsPerSym, "envelope", t0);
}

/** Preamble + sync word detector, then payload extraction */
export function decodePreambleSyncURH(
  real: number[],
  imag: number[],
  samplesPerSymbol: number,
  bitsPerSym: number
): URHDecodedResult {
  const t0 = performance.now();
  const M = 2 ** bitsPerSym;

  // Step 1: detect preamble (repeating pattern)
  const windowSize = samplesPerSymbol * 2;
  let bestCorr = 0, preambleEnd = 0;
  const searchLen = Math.min(real.length, samplesPerSymbol * 20);
  for (let offset = samplesPerSymbol; offset < searchLen - windowSize; offset += Math.floor(samplesPerSymbol / 2)) {
    let corr = 0;
    for (let j = 0; j < samplesPerSymbol && j + offset < real.length; j++) {
      corr += real[j] * real[j + offset] + imag[j] * imag[j + offset];
    }
    corr = Math.abs(corr) / samplesPerSymbol;
    if (corr > bestCorr) {
      bestCorr = corr;
      preambleEnd = offset + samplesPerSymbol;
    }
  }

  // Step 2: decode payload after preamble
  const payloadStart = Math.min(preambleEnd, real.length - samplesPerSymbol);
  const numSymbols = Math.floor((real.length - payloadStart) / samplesPerSymbol);
  const symbols: number[] = [];
  const confidence: number[] = [];

  for (let si = 0; si < numSymbols; si++) {
    const start = payloadStart + si * samplesPerSymbol;
    let avgI = 0, avgQ = 0;
    const len = Math.min(samplesPerSymbol, real.length - start);
    for (let j = 0; j < len; j++) { avgI += real[start + j]; avgQ += imag[start + j]; }
    avgI /= len; avgQ /= len;

    let phase = Math.atan2(avgQ, avgI);
    if (phase < 0) phase += 2 * Math.PI;
    const sym = Math.round((phase * M) / (2 * Math.PI)) % M;
    symbols.push(sym);
    confidence.push(Math.min(1, Math.sqrt(avgI * avgI + avgQ * avgQ)));
  }

  return finalizeURH(symbols, confidence, bitsPerSym, "preamble_sync", t0, {
    preambleEnd, preambleCorrelation: bestCorr,
  });
}

/** Bitslice decoder: sliding correlation with bit templates */
export function decodeBitsliceURH(
  real: number[],
  samplesPerSymbol: number,
  bitsPerSym: number
): URHDecodedResult {
  const t0 = performance.now();
  const M = 2 ** bitsPerSym;
  const numSymbols = Math.floor(real.length / samplesPerSymbol);
  const symbols: number[] = [];
  const confidence: number[] = [];

  // Generate templates for each symbol value: simple level-based
  const templates: number[][] = [];
  for (let s = 0; s < M; s++) {
    const tmpl: number[] = [];
    for (let j = 0; j < samplesPerSymbol; j++) {
      const level = (2 * s / (M - 1 || 1)) - 1; // [-1, +1]
      tmpl.push(level);
    }
    templates.push(tmpl);
  }

  for (let si = 0; si < numSymbols; si++) {
    const start = si * samplesPerSymbol;
    const scores: number[] = [];
    for (let s = 0; s < M; s++) {
      let corr = 0;
      const len = Math.min(samplesPerSymbol, real.length - start);
      for (let j = 0; j < len; j++) corr += real[start + j] * templates[s][j];
      scores.push(corr / len);
    }
    const maxScore = Math.max(...scores);
    const bestSym = scores.indexOf(maxScore);
    const sumAbs = scores.reduce((a, b) => a + Math.abs(b), 0);
    symbols.push(bestSym);
    confidence.push(sumAbs > 0 ? Math.abs(maxScore) / sumAbs : 0);
  }

  return finalizeURH(symbols, confidence, bitsPerSym, "bitslice", t0);
}

// ─── Finalize ───

function finalizeURH(
  symbolsOrBits: number[],
  confidence: number[],
  bitsPerSym: number,
  method: URHDecoderType,
  t0: number,
  metadata?: Record<string, unknown>
): URHDecodedResult {
  // Convert symbols → bits
  const decodedBits: number[] = [];
  for (const sym of symbolsOrBits) {
    for (let i = bitsPerSym - 1; i >= 0; i--) {
      decodedBits.push((sym >> i) & 1);
    }
  }

  // Bits → bytes → text
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= decodedBits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | decodedBits[i + j];
    bytes.push(byte);
  }

  let decodedText = "";
  try {
    decodedText = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
    decodedText = decodedText.replace(/[\x00-\x08\x0E-\x1F\x7F-\x9F]/g, "·");
  } catch {
    decodedText = "[decode error]";
  }

  return {
    symbols: symbolsOrBits,
    confidence,
    decodedBits,
    decodedText,
    method,
    processingTimeMs: performance.now() - t0,
    metadata,
  };
}
