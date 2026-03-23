/**
 * Multiple inverse decoder strategies for LoRa signal → symbols → text
 * 
 * 1. MLP (existing) — neural network
 * 2. Correlation — matched filter cross-correlation
 * 3. Energy — energy-based detection per frequency bin
 * 4. Template — nearest-neighbor in chirp template space
 */

export type DecoderType = "mlp" | "correlation" | "energy" | "template";

export interface DecoderMeta {
  id: DecoderType;
  name: string;
  description: string;
  icon: string; // lucide icon name
  needsTraining: boolean;
}

export const DECODER_REGISTRY: DecoderMeta[] = [
  { id: "mlp", name: "MLP нейросеть", description: "Обучаемый многослойный перцептрон (backprop)", icon: "Brain", needsTraining: true },
  { id: "correlation", name: "Корреляционный", description: "Кросс-корреляция с эталонными чирпами", icon: "Waves", needsTraining: false },
  { id: "energy", name: "Энергетический", description: "Детектор по энергии в частотных бинах (DFT)", icon: "Zap", needsTraining: false },
  { id: "template", name: "Шаблонный", description: "Ближайший сосед в пространстве шаблонов", icon: "Copy", needsTraining: false },
];

/** Generate a reference chirp for a given symbol value */
function generateRefChirp(symbolValue: number, M: number, samplesPerSymbol: number, bw: number, sampleRate: number): { real: number[]; imag: number[] } {
  const tSym = M / bw;
  const real: number[] = [];
  const imag: number[] = [];
  for (let i = 0; i < samplesPerSymbol; i++) {
    const t = (i / sampleRate);
    const tNorm = t % tSym;
    // Base chirp frequency
    const fBase = (bw / tSym) * tNorm - bw / 2;
    // Cyclic shift for symbol
    const fShift = (symbolValue / M) * bw;
    let f = fBase + fShift;
    if (f > bw / 2) f -= bw;
    const phase = 2 * Math.PI * f * t;
    real.push(Math.cos(phase));
    imag.push(Math.sin(phase));
  }
  return { real, imag };
}

export interface ClassicDecodedResult {
  symbols: number[];
  confidence: number[];
  decodedBits: number[];
  decodedText: string;
  scores: number[][]; // [symbolIdx][classIdx] — raw scores
  method: DecoderType;
  processingTimeMs: number;
}

/** Correlation decoder: cross-correlate received window with all M reference chirps */
export function decodeCorrelation(
  real: number[] | Float64Array,
  imag: number[] | Float64Array,
  samplesPerSymbol: number,
  sf: number,
  bw: number,
  sampleRate: number
): ClassicDecodedResult {
  const t0 = performance.now();
  const M = 2 ** sf;
  const numSymbols = Math.floor(real.length / samplesPerSymbol);
  
  // Pre-generate reference chirps (limit to avoid huge computation)
  const refs: { real: number[]; imag: number[] }[] = [];
  for (let s = 0; s < M; s++) {
    refs.push(generateRefChirp(s, M, samplesPerSymbol, bw, sampleRate));
  }
  
  const symbols: number[] = [];
  const confidence: number[] = [];
  const scores: number[][] = [];
  
  for (let si = 0; si < numSymbols; si++) {
    const start = si * samplesPerSymbol;
    const symScores: number[] = [];
    
    for (let s = 0; s < M; s++) {
      // Cross-correlation magnitude
      let corrReal = 0, corrImag = 0;
      const len = Math.min(samplesPerSymbol, real.length - start);
      for (let i = 0; i < len; i++) {
        // conjugate multiply: rx * ref*
        const rr = (real[start + i] as number) * refs[s].real[i] + (imag[start + i] as number) * refs[s].imag[i];
        const ri = (imag[start + i] as number) * refs[s].real[i] - (real[start + i] as number) * refs[s].imag[i];
        corrReal += rr;
        corrImag += ri;
      }
      symScores.push(Math.sqrt(corrReal ** 2 + corrImag ** 2));
    }
    
    const maxScore = Math.max(...symScores);
    const bestSym = symScores.indexOf(maxScore);
    const sumScores = symScores.reduce((a, b) => a + b, 0);
    
    symbols.push(bestSym);
    confidence.push(sumScores > 0 ? maxScore / sumScores : 0);
    scores.push(symScores);
  }
  
  return finalize(symbols, confidence, scores, sf, "correlation", t0);
}

/** Energy decoder: DFT each symbol window, pick peak frequency bin → symbol */
export function decodeEnergy(
  real: number[] | Float64Array,
  imag: number[] | Float64Array,
  samplesPerSymbol: number,
  sf: number
): ClassicDecodedResult {
  const t0 = performance.now();
  const M = 2 ** sf;
  const numSymbols = Math.floor(real.length / samplesPerSymbol);
  const symbols: number[] = [];
  const confidence: number[] = [];
  const scores: number[][] = [];
  
  for (let si = 0; si < numSymbols; si++) {
    const start = si * samplesPerSymbol;
    const len = Math.min(samplesPerSymbol, real.length - start);
    
    // Simple DFT with M bins
    const binScores: number[] = [];
    for (let k = 0; k < M; k++) {
      let sumR = 0, sumI = 0;
      for (let n = 0; n < len; n++) {
        const angle = -2 * Math.PI * k * n / M;
        sumR += (real[start + n] as number) * Math.cos(angle) - (imag[start + n] as number) * Math.sin(angle);
        sumI += (real[start + n] as number) * Math.sin(angle) + (imag[start + n] as number) * Math.cos(angle);
      }
      binScores.push(Math.sqrt(sumR ** 2 + sumI ** 2));
    }
    
    const maxVal = Math.max(...binScores);
    const bestBin = binScores.indexOf(maxVal);
    const totalEnergy = binScores.reduce((a, b) => a + b, 0);
    
    symbols.push(bestBin);
    confidence.push(totalEnergy > 0 ? maxVal / totalEnergy : 0);
    scores.push(binScores);
  }
  
  return finalize(symbols, confidence, scores, sf, "energy", t0);
}

/** Template decoder: compare signal snippet statistics with precomputed templates */
export function decodeTemplate(
  real: number[] | Float64Array,
  imag: number[] | Float64Array,
  samplesPerSymbol: number,
  sf: number,
  bw: number,
  sampleRate: number
): ClassicDecodedResult {
  const t0 = performance.now();
  const M = 2 ** sf;
  const numSymbols = Math.floor(real.length / samplesPerSymbol);
  
  // Build feature templates: mean amplitude, phase slope, energy
  const templates: number[][] = [];
  for (let s = 0; s < M; s++) {
    const ref = generateRefChirp(s, M, samplesPerSymbol, bw, sampleRate);
    const feat = extractFeatures(ref.real, ref.imag, samplesPerSymbol);
    templates.push(feat);
  }
  
  const symbols: number[] = [];
  const confidence: number[] = [];
  const scores: number[][] = [];
  
  for (let si = 0; si < numSymbols; si++) {
    const start = si * samplesPerSymbol;
    const len = Math.min(samplesPerSymbol, real.length - start);
    const segR = Array.from(real).slice(start, start + len);
    const segI = Array.from(imag).slice(start, start + len);
    const feat = extractFeatures(segR, segI, len);
    
    // Euclidean distance to each template
    const dists: number[] = templates.map(tmpl => {
      let d = 0;
      for (let i = 0; i < feat.length; i++) d += (feat[i] - tmpl[i]) ** 2;
      return Math.sqrt(d);
    });
    
    // Convert distances to similarity scores (inverse)
    const maxDist = Math.max(...dists) + 1e-9;
    const simScores = dists.map(d => maxDist - d);
    const sumSim = simScores.reduce((a, b) => a + b, 0);
    
    const bestSym = simScores.indexOf(Math.max(...simScores));
    symbols.push(bestSym);
    confidence.push(sumSim > 0 ? simScores[bestSym] / sumSim : 0);
    scores.push(simScores);
  }
  
  return finalize(symbols, confidence, scores, sf, "template", t0);
}

/** Extract simple statistical features from a signal segment */
function extractFeatures(real: number[], imag: number[], len: number): number[] {
  let energy = 0, meanPhase = 0, phaseVar = 0;
  const phases: number[] = [];
  const N = Math.min(len, real.length);
  
  for (let i = 0; i < N; i++) {
    energy += real[i] ** 2 + imag[i] ** 2;
    const phase = Math.atan2(imag[i], real[i]);
    phases.push(phase);
    meanPhase += phase;
  }
  energy /= N;
  meanPhase /= N;
  
  for (const p of phases) phaseVar += (p - meanPhase) ** 2;
  phaseVar /= N;
  
  // Phase slope (linear fit)
  let sumXY = 0, sumX2 = 0;
  for (let i = 0; i < N; i++) {
    sumXY += i * phases[i];
    sumX2 += i * i;
  }
  const slope = sumX2 > 0 ? sumXY / sumX2 : 0;
  
  // Zero-crossing rate
  let zc = 0;
  for (let i = 1; i < N; i++) {
    if (real[i] * real[i - 1] < 0) zc++;
  }
  
  return [energy, meanPhase, phaseVar, slope, zc / N];
}

/** Convert symbols → bits → text and package result */
function finalize(
  symbols: number[],
  confidence: number[],
  scores: number[][],
  sf: number,
  method: DecoderType,
  t0: number
): ClassicDecodedResult {
  const decodedBits: number[] = [];
  for (const sym of symbols) {
    for (let i = sf - 1; i >= 0; i--) {
      decodedBits.push((sym >> i) & 1);
    }
  }
  
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
    symbols, confidence, decodedBits, decodedText, scores, method,
    processingTimeMs: performance.now() - t0,
  };
}
