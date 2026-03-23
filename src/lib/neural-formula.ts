/**
 * Neural Formula Fitting Engine
 * 
 * Fits a universal parametric chirp formula to LoRa signal data:
 *   y(t) = A · exp(-α·t) · cos(2π·(f₀·t + β·t²/2) + φ) + C
 * 
 * Coefficients: A (amplitude), α (decay), f₀ (base freq), β (chirp rate), φ (phase), C (offset)
 */

export interface FormulaCoefficients {
  A: number;   // amplitude
  alpha: number; // decay rate
  f0: number;  // base frequency (normalized)
  beta: number; // chirp rate
  phi: number; // phase offset
  C: number;   // DC offset
}

export interface TrainingConfig {
  learningRate: number;
  epochs: number;
  batchSize: number;
}

export interface TrainingResult {
  coefficients: FormulaCoefficients;
  mse: number;
  r2: number;
  maxError: number;
  epochLosses: number[];
}

export interface SignalSample {
  t: number;
  y: number;
}

const DEFAULT_COEFFS: FormulaCoefficients = {
  A: 1.0,
  alpha: 0.01,
  f0: 1.0,
  beta: 0.5,
  phi: 0.0,
  C: 0.0,
};

/** Evaluate the universal formula at time t */
export function evaluateFormula(t: number, c: FormulaCoefficients): number {
  return c.A * Math.exp(-c.alpha * t) * Math.cos(2 * Math.PI * (c.f0 * t + c.beta * t * t / 2) + c.phi) + c.C;
}

/** Compute partial derivatives for gradient descent */
function gradients(t: number, c: FormulaCoefficients, target: number): FormulaCoefficients {
  const pred = evaluateFormula(t, c);
  const err = pred - target;
  
  const expPart = Math.exp(-c.alpha * t);
  const angle = 2 * Math.PI * (c.f0 * t + c.beta * t * t / 2) + c.phi;
  const cosPart = Math.cos(angle);
  const sinPart = Math.sin(angle);
  
  return {
    A: err * expPart * cosPart,
    alpha: err * c.A * (-t) * expPart * cosPart,
    f0: err * c.A * expPart * (-sinPart) * 2 * Math.PI * t,
    beta: err * c.A * expPart * (-sinPart) * 2 * Math.PI * t * t / 2,
    phi: err * c.A * expPart * (-sinPart),
    C: err,
  };
}

/** Clip gradient values to prevent explosion */
function clipGrad(g: number, maxVal = 5.0): number {
  return Math.max(-maxVal, Math.min(maxVal, g));
}

/** Fit formula to signal samples using gradient descent */
export function trainFormula(
  samples: SignalSample[],
  config: TrainingConfig,
  initialCoeffs?: Partial<FormulaCoefficients>,
  onEpoch?: (epoch: number, loss: number) => void
): TrainingResult {
  const c: FormulaCoefficients = { ...DEFAULT_COEFFS, ...initialCoeffs };
  const lr = config.learningRate;
  const epochLosses: number[] = [];
  const n = samples.length;
  
  if (n === 0) {
    return { coefficients: c, mse: 0, r2: 0, maxError: 0, epochLosses: [] };
  }

  // Normalize time to [0, 1]
  const tMax = Math.max(...samples.map(s => s.t), 1e-9);
  const normalized = samples.map(s => ({ t: s.t / tMax, y: s.y }));

  for (let epoch = 0; epoch < config.epochs; epoch++) {
    let totalLoss = 0;
    
    // Accumulate gradients over mini-batch or full batch
    const batchSize = Math.min(config.batchSize, n);
    const indices = Array.from({ length: batchSize }, () => Math.floor(Math.random() * n));

    const gAcc: FormulaCoefficients = { A: 0, alpha: 0, f0: 0, beta: 0, phi: 0, C: 0 };

    for (const idx of indices) {
      const s = normalized[idx];
      const g = gradients(s.t, c, s.y);
      gAcc.A += g.A;
      gAcc.alpha += g.alpha;
      gAcc.f0 += g.f0;
      gAcc.beta += g.beta;
      gAcc.phi += g.phi;
      gAcc.C += g.C;

      const pred = evaluateFormula(s.t, c);
      totalLoss += (pred - s.y) ** 2;
    }

    // Update coefficients
    const scale = lr / batchSize;
    c.A -= clipGrad(gAcc.A) * scale;
    c.alpha -= clipGrad(gAcc.alpha) * scale * 0.1; // slower for stability
    c.f0 -= clipGrad(gAcc.f0) * scale;
    c.beta -= clipGrad(gAcc.beta) * scale;
    c.phi -= clipGrad(gAcc.phi) * scale;
    c.C -= clipGrad(gAcc.C) * scale;

    // Keep alpha non-negative
    c.alpha = Math.max(0, c.alpha);

    const mse = totalLoss / batchSize;
    epochLosses.push(mse);
    
    if (onEpoch && epoch % Math.max(1, Math.floor(config.epochs / 100)) === 0) {
      onEpoch(epoch, mse);
    }
  }

  // Compute final metrics on all data
  let totalSqErr = 0;
  let maxErr = 0;
  let yMean = 0;
  for (const s of normalized) yMean += s.y;
  yMean /= n;
  
  let ssTot = 0;
  for (const s of normalized) {
    const pred = evaluateFormula(s.t, c);
    const err = Math.abs(pred - s.y);
    totalSqErr += err ** 2;
    maxErr = Math.max(maxErr, err);
    ssTot += (s.y - yMean) ** 2;
  }

  const mse = totalSqErr / n;
  const r2 = ssTot > 0 ? 1 - totalSqErr / ssTot : 0;

  return { coefficients: c, mse, r2, maxError: maxErr, epochLosses };
}

/** Generate predicted signal from formula */
export function generatePrediction(
  coefficients: FormulaCoefficients,
  tStart: number,
  tEnd: number,
  numPoints: number
): SignalSample[] {
  const tMax = tEnd - tStart || 1;
  const result: SignalSample[] = [];
  for (let i = 0; i < numPoints; i++) {
    const t = tStart + (i / (numPoints - 1)) * (tEnd - tStart);
    const tNorm = (t - tStart) / tMax;
    result.push({ t, y: evaluateFormula(tNorm, coefficients) });
  }
  return result;
}

/** Format formula as LaTeX-like string */
export function formatFormula(c: FormulaCoefficients): string {
  const sign = (v: number) => v >= 0 ? '+' : '';
  return `y(t) = ${c.A.toFixed(4)} · e^(-${c.alpha.toFixed(4)}·t) · cos(2π·(${c.f0.toFixed(4)}·t ${sign(c.beta)}${c.beta.toFixed(4)}·t²/2) ${sign(c.phi)}${c.phi.toFixed(4)}) ${sign(c.C)}${c.C.toFixed(4)}`;
}

/** Compare two coefficient sets and return relative differences */
export function compareCoefficients(
  a: FormulaCoefficients,
  b: FormulaCoefficients
): Record<keyof FormulaCoefficients, number> {
  const keys: (keyof FormulaCoefficients)[] = ['A', 'alpha', 'f0', 'beta', 'phi', 'C'];
  const result = {} as Record<keyof FormulaCoefficients, number>;
  for (const k of keys) {
    const denom = Math.max(Math.abs(a[k]), Math.abs(b[k]), 1e-9);
    result[k] = Math.abs(a[k] - b[k]) / denom;
  }
  return result;
}
