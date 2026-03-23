/**
 * FHSS Signal Generation & Channel Propagation Model
 * 
 * Unified signal model:
 * s(t;T,H,B) = Σ_{k=0}^{N_f-1} A·rect((t - k·T_hop) / T_hop) · exp(j·2π·[f_0 + H_k·Δf_h + B_{k,m}·Δf_m]·t)
 * 
 * With channel: r(t) = Σ_l α_l · s(t - τ_l) · exp(j·2π·f_d·t) + n(t)
 */

export interface FHSSParams {
  sf: number;
  bw: number;           // Hz
  fc: number;           // center frequency Hz
  sampleRate: number;
  numHops: number;      // N_f — number of frequency hops
  tHop: number;         // T_hop — hop duration in seconds
  deltaFh: number;      // Δf_h — hop frequency spacing Hz
  deltaFm: number;      // Δf_m — modulation spacing Hz
  amplitude: number;    // A
}

export interface ChannelParams {
  pathLossExponent: number;   // n (2=free space, 3-4=urban)
  distance: number;           // d in meters
  refDistance: number;         // d0 reference distance
  shadowingStdDb: number;     // σ_sh log-normal shadowing std (dB)
  multipathTaps: number;      // number of multipath taps
  maxDelaySpread: number;     // max delay spread in seconds
  dopplerHz: number;          // Doppler frequency
  snrDb: number;              // target SNR in dB
  ricianK: number;            // Rician K-factor (0=Rayleigh, >0=Rician)
}

export interface FHSSSignalData {
  time: Float64Array;
  real: Float64Array;
  imag: Float64Array;
  hoppingSequence: number[];
  bitMatrix: number[][];
  instantFreq: Float64Array;
  params: FHSSParams;
  channelParams?: ChannelParams;
}

export const DEFAULT_FHSS_PARAMS: FHSSParams = {
  sf: 7,
  bw: 125e3,
  fc: 915e6,
  sampleRate: 500e3,
  numHops: 8,
  tHop: 0.001,  // 1 ms
  deltaFh: 25e3,
  deltaFm: 1e3,
  amplitude: 1.0,
};

export const DEFAULT_CHANNEL_PARAMS: ChannelParams = {
  pathLossExponent: 2.0,
  distance: 100,
  refDistance: 1,
  shadowingStdDb: 4.0,
  multipathTaps: 3,
  maxDelaySpread: 1e-6,
  dopplerHz: 10,
  snrDb: 20,
  ricianK: 0,
};

/** Generate pseudo-random FHSS hopping sequence */
function generateHoppingSequence(numHops: number, numChannels: number, seed: number = 42): number[] {
  // Simple LFSR-based pseudo-random sequence
  let state = seed;
  const seq: number[] = [];
  for (let k = 0; k < numHops; k++) {
    state = ((state * 1103515245 + 12345) & 0x7fffffff);
    seq.push(state % numChannels);
  }
  return seq;
}

/** Generate bit matrix from text */
function generateBitMatrix(text: string, numHops: number, sf: number): number[][] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1);
    }
  }
  
  const matrix: number[][] = [];
  let bitIdx = 0;
  for (let k = 0; k < numHops; k++) {
    const row: number[] = [];
    for (let m = 0; m < sf; m++) {
      row.push(bitIdx < bits.length ? bits[bitIdx++] : 0);
    }
    matrix.push(row);
  }
  return matrix;
}

/** rect(t/T) function */
function rect(t: number, T: number): number {
  return (t >= 0 && t < T) ? 1.0 : 0.0;
}

/** Generate FHSS signal */
export function generateFHSSSignal(
  params: FHSSParams,
  text: string,
  channelParams?: ChannelParams
): FHSSSignalData {
  const { sf, bw, fc, sampleRate, numHops, tHop, deltaFh, deltaFm, amplitude } = params;
  const numChannels = Math.floor(bw / deltaFh);
  
  const hoppingSequence = generateHoppingSequence(numHops, numChannels);
  const bitMatrix = generateBitMatrix(text, numHops, sf);
  
  const totalDuration = numHops * tHop;
  const totalSamples = Math.floor(sampleRate * totalDuration);
  const dt = 1 / sampleRate;
  
  const time = new Float64Array(totalSamples);
  const real = new Float64Array(totalSamples);
  const imag = new Float64Array(totalSamples);
  const instantFreq = new Float64Array(totalSamples);
  
  for (let i = 0; i < totalSamples; i++) {
    const t = i * dt;
    time[i] = t;
    
    let sigReal = 0;
    let sigImag = 0;
    
    for (let k = 0; k < numHops; k++) {
      const rectVal = rect(t - k * tHop, tHop);
      if (rectVal === 0) continue;
      
      // Frequency for this hop
      const Hk = hoppingSequence[k];
      const Bkm = bitMatrix[k].reduce((a, b) => a * 2 + b, 0); // bits to value
      const freq = deltaFh * Hk + deltaFm * Bkm;
      
      // Phase accumulation within hop
      const tLocal = t - k * tHop;
      const phase = 2 * Math.PI * freq * tLocal;
      
      sigReal += amplitude * Math.cos(phase);
      sigImag += amplitude * Math.sin(phase);
      instantFreq[i] = freq;
    }
    
    real[i] = sigReal;
    imag[i] = sigImag;
  }
  
  // Apply channel if provided
  if (channelParams) {
    applyChannel(real, imag, sampleRate, channelParams);
  }
  
  return { time, real, imag, hoppingSequence, bitMatrix, instantFreq, params, channelParams };
}

/** Apply channel propagation model */
function applyChannel(
  real: Float64Array,
  imag: Float64Array,
  sampleRate: number,
  ch: ChannelParams
): void {
  const N = real.length;
  const dt = 1 / sampleRate;
  
  // 1. Path loss
  const PL_dB = 10 * ch.pathLossExponent * Math.log10(Math.max(ch.distance, 0.1) / ch.refDistance);
  const shadowing_dB = ch.shadowingStdDb * gaussianRandom();
  const totalLoss_dB = PL_dB + shadowing_dB;
  const gain = Math.pow(10, -totalLoss_dB / 20);
  
  // 2. Multipath fading
  const taps: { delay: number; realGain: number; imagGain: number }[] = [];
  for (let l = 0; l < ch.multipathTaps; l++) {
    const delay = l * ch.maxDelaySpread / ch.multipathTaps;
    const delaySamples = Math.floor(delay * sampleRate);
    const power = l === 0 && ch.ricianK > 0
      ? Math.sqrt(ch.ricianK / (ch.ricianK + 1))
      : Math.sqrt(1 / (ch.ricianK + 1)) / Math.sqrt(ch.multipathTaps);
    const phase = Math.random() * 2 * Math.PI;
    taps.push({
      delay: delaySamples,
      realGain: power * Math.cos(phase),
      imagGain: power * Math.sin(phase),
    });
  }
  
  // Apply multipath
  const outReal = new Float64Array(N);
  const outImag = new Float64Array(N);
  
  for (const tap of taps) {
    for (let i = tap.delay; i < N; i++) {
      const srcIdx = i - tap.delay;
      outReal[i] += tap.realGain * real[srcIdx] - tap.imagGain * imag[srcIdx];
      outImag[i] += tap.realGain * imag[srcIdx] + tap.imagGain * real[srcIdx];
    }
  }
  
  // 3. Doppler shift
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    const dopplerPhase = 2 * Math.PI * ch.dopplerHz * t;
    const cosD = Math.cos(dopplerPhase);
    const sinD = Math.sin(dopplerPhase);
    const r = outReal[i];
    const im = outImag[i];
    outReal[i] = r * cosD - im * sinD;
    outImag[i] = r * sinD + im * cosD;
  }
  
  // 4. Apply gain and add noise
  const signalPower = outReal.reduce((s, v, i) => s + v * v + outImag[i] * outImag[i], 0) / N;
  const noisePower = signalPower / Math.pow(10, ch.snrDb / 10);
  const noiseStd = Math.sqrt(noisePower / 2);
  
  for (let i = 0; i < N; i++) {
    real[i] = gain * outReal[i] + noiseStd * gaussianRandom();
    imag[i] = gain * outImag[i] + noiseStd * gaussianRandom();
  }
}

function gaussianRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ─── Unified Formula Types ──────────────────────────────────────

export interface UnifiedCoeffs {
  A: number;       // amplitude
  alpha: number;   // decay
  f0: number;      // base frequency
  beta: number;    // chirp rate
  phi: number;     // phase
  C: number;       // offset
  // FHSS params
  deltaF: number;  // frequency hop magnitude
  tHop: number;    // hop duration
  nHops: number;   // number of hops
  // Channel params
  pathLoss: number;
  fadingGain: number;
  dopplerShift: number;
}

export const DEFAULT_UNIFIED_COEFFS: UnifiedCoeffs = {
  A: 1.0, alpha: 0.01, f0: 1.0, beta: 0.5, phi: 0.0, C: 0.0,
  deltaF: 0.1, tHop: 0.5, nHops: 4,
  pathLoss: 0.9, fadingGain: 1.0, dopplerShift: 0.0,
};

export const UNIFIED_COEFF_LABELS: Record<string, string> = {
  A: 'A (амплитуда)', alpha: 'α (затухание)', f0: 'f₀ (базовая частота)',
  beta: 'β (чирп)', phi: 'φ (фаза)', C: 'C (смещение)',
  deltaF: 'Δf (скачок)', tHop: 'T_hop (длит. скачка)', nHops: 'N_f (скачков)',
  pathLoss: 'PL (потери)', fadingGain: 'α_ch (замирание)', dopplerShift: 'f_d (Доплер)',
};

/** Evaluate the unified FHSS+Channel formula */
export function evaluateUnifiedFormula(t: number, c: UnifiedCoeffs): number {
  // Determine which hop we're in
  const hopIdx = Math.floor(t / Math.max(c.tHop, 0.01)) % Math.max(1, Math.round(c.nHops));
  
  // Frequency for this hop (pseudo-random offset)
  const hopFreqOffset = c.deltaF * ((hopIdx * 7 + 3) % Math.max(1, Math.round(c.nHops)));
  
  // Chirp within hop
  const tLocal = t - hopIdx * c.tHop;
  const freq = c.f0 + hopFreqOffset + c.beta * tLocal;
  
  // Signal with decay
  const envelope = c.A * Math.exp(-c.alpha * t) * c.pathLoss * c.fadingGain;
  
  // Doppler
  const dopplerPhase = 2 * Math.PI * c.dopplerShift * t;
  
  return envelope * Math.cos(2 * Math.PI * freq * tLocal + c.phi + dopplerPhase) + c.C;
}

/** Compute gradients for unified formula */
export function computeUnifiedGradients(t: number, c: UnifiedCoeffs, target: number): Record<string, number> {
  const pred = evaluateUnifiedFormula(t, c);
  const err = pred - target;
  const eps = 1e-6;
  
  // Numerical gradients for complex formula
  const grads: Record<string, number> = {};
  const keys = Object.keys(c) as (keyof UnifiedCoeffs)[];
  
  for (const k of keys) {
    const cPlus = { ...c, [k]: (c[k] as number) + eps };
    const predPlus = evaluateUnifiedFormula(t, cPlus);
    grads[k] = err * (predPlus - pred) / eps;
  }
  
  return grads;
}

/** Train unified formula */
export interface UnifiedTrainingResult {
  coefficients: UnifiedCoeffs;
  mse: number;
  r2: number;
  maxError: number;
  epochLosses: number[];
  channelMetrics: {
    snrEstimate: number;
    pathLossDb: number;
    coherenceBandwidth: number;
  };
}

export function trainUnifiedFormula(
  samples: { t: number; y: number }[],
  config: { learningRate: number; epochs: number; batchSize: number },
  initialCoeffs?: Partial<UnifiedCoeffs>,
  onEpoch?: (epoch: number, loss: number) => void
): UnifiedTrainingResult {
  const c: Record<string, number> = { ...DEFAULT_UNIFIED_COEFFS, ...initialCoeffs };
  const n = samples.length;
  if (n === 0) {
    return {
      coefficients: c as unknown as UnifiedCoeffs,
      mse: 0, r2: 0, maxError: 0, epochLosses: [],
      channelMetrics: { snrEstimate: 0, pathLossDb: 0, coherenceBandwidth: 0 },
    };
  }
  
  const tMax = Math.max(...samples.map(s => s.t), 1e-9);
  const normalized = samples.map(s => ({ t: s.t / tMax, y: s.y }));
  const keys = Object.keys(c);
  const epochLosses: number[] = [];
  
  // Learning rate schedules for different parameter groups
  const lrScales: Record<string, number> = {
    alpha: 0.1, pathLoss: 0.5, fadingGain: 0.5, dopplerShift: 0.1,
    nHops: 0.05, tHop: 0.1,
  };
  
  for (let epoch = 0; epoch < config.epochs; epoch++) {
    let totalLoss = 0;
    const batchSize = Math.min(config.batchSize, n);
    const indices = Array.from({ length: batchSize }, () => Math.floor(Math.random() * n));
    
    const gAcc: Record<string, number> = {};
    for (const k of keys) gAcc[k] = 0;
    
    for (const idx of indices) {
      const s = normalized[idx];
      const g = computeUnifiedGradients(s.t, c as unknown as UnifiedCoeffs, s.y);
      for (const k of keys) gAcc[k] += g[k] ?? 0;
      const pred = evaluateUnifiedFormula(s.t, c as unknown as UnifiedCoeffs);
      totalLoss += (pred - s.y) ** 2;
    }
    
    const scale = config.learningRate / batchSize;
    for (const k of keys) {
      const lr = lrScales[k] ?? 1.0;
      const grad = Math.max(-5, Math.min(5, gAcc[k]));
      c[k] -= grad * scale * lr;
    }
    
    // Constraints
    c.alpha = Math.max(0, c.alpha);
    c.pathLoss = Math.max(0.01, Math.min(2.0, c.pathLoss));
    c.fadingGain = Math.max(0.01, Math.min(2.0, c.fadingGain));
    c.nHops = Math.max(1, Math.round(c.nHops));
    c.tHop = Math.max(0.01, c.tHop);
    
    const mse = totalLoss / batchSize;
    epochLosses.push(mse);
    
    if (onEpoch && epoch % Math.max(1, Math.floor(config.epochs / 100)) === 0) {
      onEpoch(epoch, mse);
    }
  }
  
  // Final metrics
  let totalSqErr = 0, maxErr = 0, yMean = 0, ssTot = 0;
  for (const s of normalized) yMean += s.y;
  yMean /= n;
  for (const s of normalized) {
    const pred = evaluateUnifiedFormula(s.t, c as unknown as UnifiedCoeffs);
    const err = Math.abs(pred - s.y);
    totalSqErr += err ** 2;
    maxErr = Math.max(maxErr, err);
    ssTot += (s.y - yMean) ** 2;
  }
  
  // Derive channel metrics
  const pathLossDb = -20 * Math.log10(Math.max(c.pathLoss, 1e-9));
  const signalVar = normalized.reduce((s, v) => s + v.y ** 2, 0) / n;
  const noiseVar = totalSqErr / n;
  const snrEstimate = 10 * Math.log10(Math.max(signalVar / (noiseVar + 1e-12), 1e-12));
  
  return {
    coefficients: c as unknown as UnifiedCoeffs,
    mse: totalSqErr / n,
    r2: ssTot > 0 ? 1 - totalSqErr / ssTot : 0,
    maxError: maxErr,
    epochLosses,
    channelMetrics: {
      snrEstimate,
      pathLossDb,
      coherenceBandwidth: 1 / (2 * Math.PI * (c.dopplerShift || 0.01)),
    },
  };
}

/** Format unified formula string */
export function formatUnifiedFormula(c: UnifiedCoeffs): string {
  const f = (v: number) => v.toFixed(4);
  return `s(t) = ${f(c.A)} · PL(${f(c.pathLoss)}) · α(${f(c.fadingGain)}) · e^(-${f(c.alpha)}t) · cos(2π·[${f(c.f0)} + Δf·H_k(${f(c.deltaF)}) + ${f(c.beta)}·t_loc]·t + ${f(c.phi)} + 2π·${f(c.dopplerShift)}·t) + ${f(c.C)}`;
}

/** Generate prediction from unified coefficients */
export function generateUnifiedPrediction(
  c: UnifiedCoeffs,
  tStart: number,
  tEnd: number,
  numPoints: number
): { t: number; y: number }[] {
  const tMax = tEnd - tStart || 1;
  const result: { t: number; y: number }[] = [];
  for (let i = 0; i < numPoints; i++) {
    const t = tStart + (i / (numPoints - 1)) * (tEnd - tStart);
    const tNorm = (t - tStart) / tMax;
    result.push({ t, y: evaluateUnifiedFormula(tNorm, c) });
  }
  return result;
}
