/**
 * Multi-Protocol Modulation Engine
 * Supports: LoRa (CSS), BPSK, QPSK, 8PSK, 2FSK, 4FSK, DS-CDMA
 */

export type ModulationType = "lora" | "bpsk" | "qpsk" | "8psk" | "2fsk" | "4fsk" | "cdma";

export interface ModulationMeta {
  id: ModulationType;
  name: string;
  family: string;
  bitsPerSymbol: number;
  description: string;
}

export const MODULATION_REGISTRY: ModulationMeta[] = [
  { id: "lora", name: "LoRa (CSS)", family: "CSS", bitsPerSymbol: 7, description: "Chirp Spread Spectrum, SF7-12" },
  { id: "bpsk", name: "BPSK", family: "PSK", bitsPerSymbol: 1, description: "Binary Phase Shift Keying" },
  { id: "qpsk", name: "QPSK", family: "PSK", bitsPerSymbol: 2, description: "Quadrature Phase Shift Keying" },
  { id: "8psk", name: "8-PSK", family: "PSK", bitsPerSymbol: 3, description: "8-Phase Shift Keying" },
  { id: "2fsk", name: "2-FSK", family: "FSK", bitsPerSymbol: 1, description: "Binary Frequency Shift Keying" },
  { id: "4fsk", name: "4-FSK", family: "FSK", bitsPerSymbol: 2, description: "4-level Frequency Shift Keying" },
  { id: "cdma", name: "DS-CDMA", family: "CDMA", bitsPerSymbol: 1, description: "Direct Sequence CDMA with Walsh codes" },
];

export interface ModulationParams {
  type: ModulationType;
  sampleRate: number;
  symbolRate: number;   // symbols per second
  fc: number;           // carrier frequency
  // FSK specific
  freqDeviation?: number;
  // CDMA specific
  spreadingCode?: number; // Walsh code index
  chipRate?: number;       // chips per second
  // LoRa
  sf?: number;
  bw?: number;
}

export interface ModulatedSignal {
  time: number[];
  real: number[];
  imag: number[];
  amplitude: number[];
  symbols: number[];
  bits: number[];
  params: ModulationParams;
  bitsPerSymbol: number;
}

export const DEFAULT_MOD_PARAMS: Record<ModulationType, Partial<ModulationParams>> = {
  lora: { symbolRate: 976, sf: 7, bw: 125000 },
  bpsk: { symbolRate: 10000, sampleRate: 200000 },
  qpsk: { symbolRate: 5000, sampleRate: 200000 },
  "8psk": { symbolRate: 5000, sampleRate: 200000 },
  "2fsk": { symbolRate: 10000, sampleRate: 200000, freqDeviation: 25000 },
  "4fsk": { symbolRate: 5000, sampleRate: 200000, freqDeviation: 25000 },
  cdma: { symbolRate: 10000, sampleRate: 500000, chipRate: 100000, spreadingCode: 0 },
};

// ─── Text → Bits ───

function textToBits(text: string): number[] {
  const bytes = new TextEncoder().encode(text);
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  return bits;
}

function bitsToSymbols(bits: number[], bitsPerSym: number, maxSymbols: number): number[] {
  const symbols: number[] = [];
  for (let i = 0; i < bits.length && symbols.length < maxSymbols; i += bitsPerSym) {
    if (i + bitsPerSym <= bits.length) {
      let val = 0;
      for (let j = 0; j < bitsPerSym; j++) val = (val << 1) | bits[i + j];
      symbols.push(val);
    }
  }
  return symbols;
}

// ─── Walsh Codes for CDMA ───

function walshCode(index: number, length: number): number[] {
  let code = [1];
  while (code.length < length) {
    const n = code.length;
    const next = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      next[i] = code[i];
      next[i + n] = code[i];
    }
    // For rows > 0, flip second half
    if (index >= n) {
      for (let i = n; i < 2 * n; i++) next[i] = -next[i - n];
    }
    code = next;
    index = index % n;
  }
  return code.slice(0, length);
}

// ─── PSK Modulation ───

function modulatePSK(
  symbols: number[], bitsPerSym: number, sampleRate: number, symbolRate: number, fc: number
): { time: number[]; real: number[]; imag: number[] } {
  const M = 2 ** bitsPerSym;
  const samplesPerSymbol = Math.floor(sampleRate / symbolRate);
  const totalSamples = symbols.length * samplesPerSymbol;
  const time = new Array(totalSamples);
  const real = new Array(totalSamples);
  const imag = new Array(totalSamples);
  const dt = 1 / sampleRate;

  for (let si = 0; si < symbols.length; si++) {
    const phaseOffset = (2 * Math.PI * symbols[si]) / M;
    for (let j = 0; j < samplesPerSymbol; j++) {
      const idx = si * samplesPerSymbol + j;
      const t = idx * dt;
      time[idx] = t;
      // Baseband with constellation rotation
      real[idx] = Math.cos(phaseOffset);
      imag[idx] = Math.sin(phaseOffset);
    }
  }
  return { time, real, imag };
}

// ─── FSK Modulation ───

function modulateFSK(
  symbols: number[], bitsPerSym: number, sampleRate: number, symbolRate: number, freqDev: number
): { time: number[]; real: number[]; imag: number[] } {
  const M = 2 ** bitsPerSym;
  const samplesPerSymbol = Math.floor(sampleRate / symbolRate);
  const totalSamples = symbols.length * samplesPerSymbol;
  const time = new Array(totalSamples);
  const real = new Array(totalSamples);
  const imag = new Array(totalSamples);
  const dt = 1 / sampleRate;

  let phase = 0;
  for (let si = 0; si < symbols.length; si++) {
    // Map symbol to frequency: centered around 0
    const freqIdx = symbols[si] - (M - 1) / 2;
    const freq = freqIdx * (2 * freqDev / (M - 1 || 1));
    for (let j = 0; j < samplesPerSymbol; j++) {
      const idx = si * samplesPerSymbol + j;
      time[idx] = idx * dt;
      phase += 2 * Math.PI * freq * dt;
      real[idx] = Math.cos(phase);
      imag[idx] = Math.sin(phase);
    }
  }
  return { time, real, imag };
}

// ─── CDMA Modulation ───

function modulateCDMA(
  symbols: number[], sampleRate: number, symbolRate: number, chipRate: number, codeIndex: number
): { time: number[]; real: number[]; imag: number[] } {
  const chipsPerSymbol = Math.floor(chipRate / symbolRate);
  const samplesPerChip = Math.max(1, Math.floor(sampleRate / chipRate));
  const walsh = walshCode(codeIndex, chipsPerSymbol);
  
  const totalSamples = symbols.length * chipsPerSymbol * samplesPerChip;
  const time = new Array(totalSamples);
  const real = new Array(totalSamples);
  const imag = new Array(totalSamples);
  const dt = 1 / sampleRate;

  for (let si = 0; si < symbols.length; si++) {
    // BPSK data: 0 → +1, 1 → -1
    const dataBit = symbols[si] === 0 ? 1 : -1;
    for (let ci = 0; ci < chipsPerSymbol; ci++) {
      const chipVal = dataBit * walsh[ci % walsh.length];
      for (let j = 0; j < samplesPerChip; j++) {
        const idx = (si * chipsPerSymbol + ci) * samplesPerChip + j;
        if (idx >= totalSamples) break;
        time[idx] = idx * dt;
        real[idx] = chipVal;
        imag[idx] = 0;
      }
    }
  }
  return { time, real, imag };
}

// ─── Main Generator ───

export function generateModulatedSignal(
  params: ModulationParams,
  text: string,
  numSymbols: number
): ModulatedSignal {
  const meta = MODULATION_REGISTRY.find(m => m.id === params.type)!;
  const bitsPerSym = params.type === "lora" ? (params.sf || 7) : meta.bitsPerSymbol;
  
  // For LoRa, delegate to existing engine
  if (params.type === "lora") {
    // Import handled externally — this function won't be called for LoRa
    throw new Error("Use generateLoRaSignal for LoRa");
  }

  const allBits = textToBits(text);
  const symbols = bitsToSymbols(allBits, bitsPerSym, numSymbols);
  const sr = params.sampleRate || 200000;

  let result: { time: number[]; real: number[]; imag: number[] };

  switch (params.type) {
    case "bpsk":
    case "qpsk":
    case "8psk":
      result = modulatePSK(symbols, bitsPerSym, sr, params.symbolRate || 10000, params.fc);
      break;
    case "2fsk":
    case "4fsk":
      result = modulateFSK(symbols, bitsPerSym, sr, params.symbolRate || 10000, params.freqDeviation || 25000);
      break;
    case "cdma":
      result = modulateCDMA(symbols, sr, params.symbolRate || 10000, params.chipRate || 100000, params.spreadingCode || 0);
      break;
    default:
      throw new Error(`Unsupported modulation: ${params.type}`);
  }

  const amplitude = result.real.map((r, i) => Math.sqrt(r * r + result.imag[i] * result.imag[i]));

  return {
    ...result,
    amplitude,
    symbols,
    bits: allBits.slice(0, symbols.length * bitsPerSym),
    params,
    bitsPerSymbol: bitsPerSym,
  };
}

// ─── Protocol-specific decoders ───

export interface ProtocolDecodedResult {
  symbols: number[];
  confidence: number[];
  decodedText: string;
  method: string;
  processingTimeMs: number;
}

/** PSK decoder: phase detection */
export function decodePSK(
  real: number[], imag: number[], samplesPerSymbol: number, bitsPerSym: number
): ProtocolDecodedResult {
  const t0 = performance.now();
  const M = 2 ** bitsPerSym;
  const numSymbols = Math.floor(real.length / samplesPerSymbol);
  const symbols: number[] = [];
  const confidence: number[] = [];

  for (let si = 0; si < numSymbols; si++) {
    const start = si * samplesPerSymbol;
    // Average I/Q over symbol period
    let avgI = 0, avgQ = 0;
    const len = Math.min(samplesPerSymbol, real.length - start);
    for (let j = 0; j < len; j++) {
      avgI += real[start + j];
      avgQ += imag[start + j];
    }
    avgI /= len;
    avgQ /= len;

    // Phase → nearest constellation point
    let phase = Math.atan2(avgQ, avgI);
    if (phase < 0) phase += 2 * Math.PI;
    const symIdx = Math.round((phase * M) / (2 * Math.PI)) % M;
    const mag = Math.sqrt(avgI * avgI + avgQ * avgQ);
    symbols.push(symIdx);
    confidence.push(Math.min(1, mag));
  }

  return finalizeProtocol(symbols, confidence, bitsPerSym, `${M}-PSK`, t0);
}

/** FSK decoder: frequency estimation */
export function decodeFSK(
  real: number[], imag: number[], samplesPerSymbol: number, bitsPerSym: number, sampleRate: number, freqDev: number
): ProtocolDecodedResult {
  const t0 = performance.now();
  const M = 2 ** bitsPerSym;
  const numSymbols = Math.floor(real.length / samplesPerSymbol);
  const symbols: number[] = [];
  const confidence: number[] = [];

  for (let si = 0; si < numSymbols; si++) {
    const start = si * samplesPerSymbol;
    const len = Math.min(samplesPerSymbol, real.length - start);
    
    // Estimate frequency via phase difference
    let freqEst = 0;
    let count = 0;
    for (let j = 1; j < len; j++) {
      const p1 = Math.atan2(imag[start + j], real[start + j]);
      const p0 = Math.atan2(imag[start + j - 1], real[start + j - 1]);
      let dp = p1 - p0;
      if (dp > Math.PI) dp -= 2 * Math.PI;
      if (dp < -Math.PI) dp += 2 * Math.PI;
      freqEst += dp / (2 * Math.PI / sampleRate);
      count++;
    }
    freqEst /= count;

    // Map frequency to symbol
    const freqStep = 2 * freqDev / (M - 1 || 1);
    const symFloat = (freqEst / freqStep) + (M - 1) / 2;
    const sym = Math.max(0, Math.min(M - 1, Math.round(symFloat)));
    symbols.push(sym);
    confidence.push(Math.min(1, Math.abs(Math.round(symFloat) - symFloat) < 0.3 ? 0.9 : 0.5));
  }

  return finalizeProtocol(symbols, confidence, bitsPerSym, `${M}-FSK`, t0);
}

/** CDMA decoder: despreading with Walsh code */
export function decodeCDMA(
  real: number[], samplesPerChip: number, chipsPerSymbol: number, codeIndex: number
): ProtocolDecodedResult {
  const t0 = performance.now();
  const walsh = walshCode(codeIndex, chipsPerSymbol);
  const samplesPerSymbol = chipsPerSymbol * samplesPerChip;
  const numSymbols = Math.floor(real.length / samplesPerSymbol);
  const symbols: number[] = [];
  const confidence: number[] = [];

  for (let si = 0; si < numSymbols; si++) {
    let corr = 0;
    for (let ci = 0; ci < chipsPerSymbol; ci++) {
      let chipAvg = 0;
      for (let j = 0; j < samplesPerChip; j++) {
        const idx = (si * chipsPerSymbol + ci) * samplesPerChip + j;
        if (idx < real.length) chipAvg += real[idx];
      }
      chipAvg /= samplesPerChip;
      corr += chipAvg * walsh[ci % walsh.length];
    }
    corr /= chipsPerSymbol;
    symbols.push(corr > 0 ? 0 : 1);
    confidence.push(Math.min(1, Math.abs(corr)));
  }

  return finalizeProtocol(symbols, confidence, 1, "DS-CDMA", t0);
}

/** Reconstruct signal from decoded symbols for any protocol */
export function reconstructProtocolSignal(
  symbols: number[], params: ModulationParams, numSymbols?: number
): ModulatedSignal {
  const meta = MODULATION_REGISTRY.find(m => m.id === params.type)!;
  const bitsPerSym = meta.bitsPerSymbol;
  // Convert symbols back to bits, then to text, then re-modulate
  const bits: number[] = [];
  for (const sym of symbols.slice(0, numSymbols)) {
    for (let i = bitsPerSym - 1; i >= 0; i--) bits.push((sym >> i) & 1);
  }

  const sr = params.sampleRate || 200000;
  let result: { time: number[]; real: number[]; imag: number[] };

  switch (params.type) {
    case "bpsk": case "qpsk": case "8psk":
      result = modulatePSK(symbols, bitsPerSym, sr, params.symbolRate || 10000, params.fc);
      break;
    case "2fsk": case "4fsk":
      result = modulateFSK(symbols, bitsPerSym, sr, params.symbolRate || 10000, params.freqDeviation || 25000);
      break;
    case "cdma":
      result = modulateCDMA(symbols, sr, params.symbolRate || 10000, params.chipRate || 100000, params.spreadingCode || 0);
      break;
    default:
      throw new Error(`Unsupported: ${params.type}`);
  }

  return {
    ...result,
    amplitude: result.real.map((r, i) => Math.sqrt(r * r + result.imag[i] * result.imag[i])),
    symbols,
    bits,
    params,
    bitsPerSymbol: bitsPerSym,
  };
}

function finalizeProtocol(
  symbols: number[], confidence: number[], bitsPerSym: number, method: string, t0: number
): ProtocolDecodedResult {
  const bits: number[] = [];
  for (const sym of symbols) {
    for (let i = bitsPerSym - 1; i >= 0; i--) bits.push((sym >> i) & 1);
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    bytes.push(byte);
  }
  let decodedText = "";
  try {
    decodedText = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
    decodedText = decodedText.replace(/[\x00-\x08\x0E-\x1F\x7F-\x9F]/g, "·");
  } catch { decodedText = "[error]"; }

  return { symbols, confidence, decodedText, method, processingTimeMs: performance.now() - t0 };
}

/** Calculate max symbols for text given modulation type */
export function getMaxSymbols(text: string, modType: ModulationType, sf?: number): number {
  const byteLen = new TextEncoder().encode(text).length;
  const clamped = Math.min(byteLen, 1240);
  const meta = MODULATION_REGISTRY.find(m => m.id === modType)!;
  const bps = modType === "lora" ? (sf || 7) : meta.bitsPerSymbol;
  return Math.max(1, Math.floor((clamped * 8) / bps));
}
