/**
 * Neural Formula Fitting Engine
 * 
 * Supports multiple formula types with gradient descent optimization:
 * 1. Chirp:     y(t) = A · exp(-α·t) · cos(2π·(f₀·t + β·t²/2) + φ) + C
 * 2. DampedSine: y(t) = A · exp(-α·t) · sin(2π·f₀·t + φ) + C
 * 3. Gaussian:  y(t) = A · exp(-(t-μ)²/(2σ²)) · cos(2π·f₀·t + φ) + C
 * 4. Harmonics: y(t) = A₁sin(2πf₁t) + A₂sin(2πf₂t) + A₃sin(2πf₃t) + C
 * 5. Polynomial: y(t) = a₀ + a₁t + a₂t² + a₃t³ + a₄t⁴ + a₅t⁵
 */

export type FormulaType = 'chirp' | 'damped_sine' | 'gaussian' | 'harmonics' | 'polynomial';

export const FORMULA_TYPES: Record<FormulaType, { label: string; description: string; latex: string }> = {
  chirp: {
    label: 'Чирп (CSS)',
    description: 'Классическая модель LoRa CSS — затухающий чирп с линейной модуляцией частоты',
    latex: 'y(t) = A · e^(-αt) · cos(2π·(f₀t + βt²/2) + φ) + C',
  },
  damped_sine: {
    label: 'Затухающая синусоида',
    description: 'Экспоненциально затухающая гармоника — подходит для импульсных сигналов',
    latex: 'y(t) = A · e^(-αt) · sin(2π·f₀t + φ) + C',
  },
  gaussian: {
    label: 'Гауссов импульс',
    description: 'Гауссова модуляция косинуса — для пакетных сигналов с локализацией',
    latex: 'y(t) = A · e^(-(t-μ)²/(2σ²)) · cos(2π·f₀t + φ) + C',
  },
  harmonics: {
    label: 'Сумма гармоник',
    description: 'Три суперпозированные гармоники — для периодических многочастотных сигналов',
    latex: 'y(t) = A₁sin(2πf₁t) + A₂sin(2πf₂t) + A₃sin(2πf₃t) + C',
  },
  polynomial: {
    label: 'Полином 5-й степени',
    description: 'Полиномиальная аппроксимация — универсальное приближение для гладких кривых',
    latex: 'y(t) = a₀ + a₁t + a₂t² + a₃t³ + a₄t⁴ + a₅t⁵',
  },
};

// ─── Coefficient types per formula ────────────────────────────────

export interface ChirpCoeffs { A: number; alpha: number; f0: number; beta: number; phi: number; C: number; }
export interface DampedSineCoeffs { A: number; alpha: number; f0: number; phi: number; C: number; }
export interface GaussianCoeffs { A: number; mu: number; sigma: number; f0: number; phi: number; C: number; }
export interface HarmonicsCoeffs { A1: number; f1: number; A2: number; f2: number; A3: number; f3: number; C: number; }
export interface PolynomialCoeffs { a0: number; a1: number; a2: number; a3: number; a4: number; a5: number; }

export type FormulaCoefficients = ChirpCoeffs | DampedSineCoeffs | GaussianCoeffs | HarmonicsCoeffs | PolynomialCoeffs;

// ─── Defaults ─────────────────────────────────────────────────────

export const DEFAULT_COEFFS: Record<FormulaType, FormulaCoefficients> = {
  chirp:       { A: 1.0, alpha: 0.01, f0: 1.0, beta: 0.5, phi: 0.0, C: 0.0 },
  damped_sine: { A: 1.0, alpha: 0.01, f0: 1.0, phi: 0.0, C: 0.0 },
  gaussian:    { A: 1.0, mu: 0.5, sigma: 0.2, f0: 1.0, phi: 0.0, C: 0.0 },
  harmonics:   { A1: 1.0, f1: 1.0, A2: 0.5, f2: 2.0, A3: 0.25, f3: 3.0, C: 0.0 },
  polynomial:  { a0: 0.0, a1: 1.0, a2: 0.0, a3: 0.0, a4: 0.0, a5: 0.0 },
};

export const COEFF_LABELS: Record<FormulaType, Record<string, string>> = {
  chirp:       { A: 'A (амплитуда)', alpha: 'α (затухание)', f0: 'f₀ (частота)', beta: 'β (чирп)', phi: 'φ (фаза)', C: 'C (смещение)' },
  damped_sine: { A: 'A (амплитуда)', alpha: 'α (затухание)', f0: 'f₀ (частота)', phi: 'φ (фаза)', C: 'C (смещение)' },
  gaussian:    { A: 'A (амплитуда)', mu: 'μ (центр)', sigma: 'σ (ширина)', f0: 'f₀ (частота)', phi: 'φ (фаза)', C: 'C (смещение)' },
  harmonics:   { A1: 'A₁ (амп.1)', f1: 'f₁ (част.1)', A2: 'A₂ (амп.2)', f2: 'f₂ (част.2)', A3: 'A₃ (амп.3)', f3: 'f₃ (част.3)', C: 'C (смещение)' },
  polynomial:  { a0: 'a₀', a1: 'a₁', a2: 'a₂', a3: 'a₃', a4: 'a₄', a5: 'a₅' },
};

// ─── Evaluation ───────────────────────────────────────────────────

export function evaluateFormula(t: number, c: FormulaCoefficients, type: FormulaType): number {
  switch (type) {
    case 'chirp': {
      const cc = c as ChirpCoeffs;
      return cc.A * Math.exp(-cc.alpha * t) * Math.cos(2 * Math.PI * (cc.f0 * t + cc.beta * t * t / 2) + cc.phi) + cc.C;
    }
    case 'damped_sine': {
      const cc = c as DampedSineCoeffs;
      return cc.A * Math.exp(-cc.alpha * t) * Math.sin(2 * Math.PI * cc.f0 * t + cc.phi) + cc.C;
    }
    case 'gaussian': {
      const cc = c as GaussianCoeffs;
      return cc.A * Math.exp(-((t - cc.mu) ** 2) / (2 * cc.sigma ** 2)) * Math.cos(2 * Math.PI * cc.f0 * t + cc.phi) + cc.C;
    }
    case 'harmonics': {
      const cc = c as HarmonicsCoeffs;
      return cc.A1 * Math.sin(2 * Math.PI * cc.f1 * t) +
             cc.A2 * Math.sin(2 * Math.PI * cc.f2 * t) +
             cc.A3 * Math.sin(2 * Math.PI * cc.f3 * t) + cc.C;
    }
    case 'polynomial': {
      const cc = c as PolynomialCoeffs;
      return cc.a0 + cc.a1 * t + cc.a2 * t ** 2 + cc.a3 * t ** 3 + cc.a4 * t ** 4 + cc.a5 * t ** 5;
    }
  }
}

// ─── Gradients ────────────────────────────────────────────────────

function computeGradients(t: number, c: FormulaCoefficients, target: number, type: FormulaType): Record<string, number> {
  const pred = evaluateFormula(t, c, type);
  const err = pred - target;

  switch (type) {
    case 'chirp': {
      const cc = c as ChirpCoeffs;
      const expP = Math.exp(-cc.alpha * t);
      const angle = 2 * Math.PI * (cc.f0 * t + cc.beta * t * t / 2) + cc.phi;
      const cosP = Math.cos(angle);
      const sinP = Math.sin(angle);
      return {
        A: err * expP * cosP,
        alpha: err * cc.A * (-t) * expP * cosP,
        f0: err * cc.A * expP * (-sinP) * 2 * Math.PI * t,
        beta: err * cc.A * expP * (-sinP) * Math.PI * t * t,
        phi: err * cc.A * expP * (-sinP),
        C: err,
      };
    }
    case 'damped_sine': {
      const cc = c as DampedSineCoeffs;
      const expP = Math.exp(-cc.alpha * t);
      const angle = 2 * Math.PI * cc.f0 * t + cc.phi;
      const sinP = Math.sin(angle);
      const cosP = Math.cos(angle);
      return {
        A: err * expP * sinP,
        alpha: err * cc.A * (-t) * expP * sinP,
        f0: err * cc.A * expP * cosP * 2 * Math.PI * t,
        phi: err * cc.A * expP * cosP,
        C: err,
      };
    }
    case 'gaussian': {
      const cc = c as GaussianCoeffs;
      const gaussP = Math.exp(-((t - cc.mu) ** 2) / (2 * cc.sigma ** 2));
      const angle = 2 * Math.PI * cc.f0 * t + cc.phi;
      const cosP = Math.cos(angle);
      const sinP = Math.sin(angle);
      return {
        A: err * gaussP * cosP,
        mu: err * cc.A * gaussP * cosP * ((t - cc.mu) / (cc.sigma ** 2)),
        sigma: err * cc.A * gaussP * cosP * ((t - cc.mu) ** 2 / (cc.sigma ** 3)),
        f0: err * cc.A * gaussP * (-sinP) * 2 * Math.PI * t,
        phi: err * cc.A * gaussP * (-sinP),
        C: err,
      };
    }
    case 'harmonics': {
      const cc = c as HarmonicsCoeffs;
      return {
        A1: err * Math.sin(2 * Math.PI * cc.f1 * t),
        f1: err * cc.A1 * Math.cos(2 * Math.PI * cc.f1 * t) * 2 * Math.PI * t,
        A2: err * Math.sin(2 * Math.PI * cc.f2 * t),
        f2: err * cc.A2 * Math.cos(2 * Math.PI * cc.f2 * t) * 2 * Math.PI * t,
        A3: err * Math.sin(2 * Math.PI * cc.f3 * t),
        f3: err * cc.A3 * Math.cos(2 * Math.PI * cc.f3 * t) * 2 * Math.PI * t,
        C: err,
      };
    }
    case 'polynomial': {
      return {
        a0: err,
        a1: err * t,
        a2: err * t ** 2,
        a3: err * t ** 3,
        a4: err * t ** 4,
        a5: err * t ** 5,
      };
    }
  }
}

// ─── Training config & result ─────────────────────────────────────

export interface TrainingConfig {
  learningRate: number;
  epochs: number;
  batchSize: number;
}

export interface TrainingResult {
  coefficients: FormulaCoefficients;
  formulaType: FormulaType;
  mse: number;
  r2: number;
  maxError: number;
  epochLosses: number[];
}

export interface SignalSample { t: number; y: number; }

// ─── Training ─────────────────────────────────────────────────────

function clipGrad(g: number, maxVal = 5.0): number {
  return Math.max(-maxVal, Math.min(maxVal, g));
}

export function trainFormula(
  samples: SignalSample[],
  config: TrainingConfig,
  formulaType: FormulaType = 'chirp',
  initialCoeffs?: Partial<FormulaCoefficients>,
  onEpoch?: (epoch: number, loss: number) => void
): TrainingResult {
  const c: Record<string, number> = { ...(DEFAULT_COEFFS[formulaType] as Record<string, number>), ...initialCoeffs };
  const lr = config.learningRate;
  const epochLosses: number[] = [];
  const n = samples.length;

  if (n === 0) {
    return { coefficients: c as unknown as FormulaCoefficients, formulaType, mse: 0, r2: 0, maxError: 0, epochLosses: [] };
  }

  const tMax = Math.max(...samples.map(s => s.t), 1e-9);
  const normalized = samples.map(s => ({ t: s.t / tMax, y: s.y }));
  const keys = Object.keys(c);

  for (let epoch = 0; epoch < config.epochs; epoch++) {
    let totalLoss = 0;
    const batchSize = Math.min(config.batchSize, n);
    const indices = Array.from({ length: batchSize }, () => Math.floor(Math.random() * n));

    const gAcc: Record<string, number> = {};
    for (const k of keys) gAcc[k] = 0;

    for (const idx of indices) {
      const s = normalized[idx];
      const g = computeGradients(s.t, c as unknown as FormulaCoefficients, s.y, formulaType);
      for (const k of keys) gAcc[k] += g[k] ?? 0;
      const pred = evaluateFormula(s.t, c as unknown as FormulaCoefficients, formulaType);
      totalLoss += (pred - s.y) ** 2;
    }

    const scale = lr / batchSize;
    for (const k of keys) {
      const lrScale = (k === 'alpha' || k === 'sigma') ? 0.1 : 1;
      c[k] -= clipGrad(gAcc[k]) * scale * lrScale;
    }

    // Constraints
    if ('alpha' in c) c.alpha = Math.max(0, c.alpha);
    if ('sigma' in c) c.sigma = Math.max(0.01, c.sigma);

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
    const pred = evaluateFormula(s.t, c as unknown as FormulaCoefficients, formulaType);
    const err = Math.abs(pred - s.y);
    totalSqErr += err ** 2;
    maxErr = Math.max(maxErr, err);
    ssTot += (s.y - yMean) ** 2;
  }

  return {
    coefficients: c as unknown as FormulaCoefficients,
    formulaType,
    mse: totalSqErr / n,
    r2: ssTot > 0 ? 1 - totalSqErr / ssTot : 0,
    maxError: maxErr,
    epochLosses,
  };
}

/** Train all formula types and return the best one */
export function autoFitBest(
  samples: SignalSample[],
  config: TrainingConfig,
): TrainingResult {
  const types: FormulaType[] = ['chirp', 'damped_sine', 'gaussian', 'harmonics', 'polynomial'];
  let best: TrainingResult | null = null;
  for (const ft of types) {
    const result = trainFormula(samples, config, ft);
    if (!best || result.r2 > best.r2) {
      best = result;
    }
  }
  return best!;
}

// ─── Prediction & formatting ──────────────────────────────────────

export function generatePrediction(
  coefficients: FormulaCoefficients,
  formulaType: FormulaType,
  tStart: number,
  tEnd: number,
  numPoints: number
): SignalSample[] {
  const tMax = tEnd - tStart || 1;
  const result: SignalSample[] = [];
  for (let i = 0; i < numPoints; i++) {
    const t = tStart + (i / (numPoints - 1)) * (tEnd - tStart);
    const tNorm = (t - tStart) / tMax;
    result.push({ t, y: evaluateFormula(tNorm, coefficients, formulaType) });
  }
  return result;
}

export function formatFormula(c: FormulaCoefficients, type: FormulaType): string {
  const f = (v: number) => v.toFixed(4);
  const sign = (v: number) => v >= 0 ? '+' : '';
  switch (type) {
    case 'chirp': {
      const cc = c as ChirpCoeffs;
      return `y(t) = ${f(cc.A)} · e^(-${f(cc.alpha)}·t) · cos(2π·(${f(cc.f0)}·t ${sign(cc.beta)}${f(cc.beta)}·t²/2) ${sign(cc.phi)}${f(cc.phi)}) ${sign(cc.C)}${f(cc.C)}`;
    }
    case 'damped_sine': {
      const cc = c as DampedSineCoeffs;
      return `y(t) = ${f(cc.A)} · e^(-${f(cc.alpha)}·t) · sin(2π·${f(cc.f0)}·t ${sign(cc.phi)}${f(cc.phi)}) ${sign(cc.C)}${f(cc.C)}`;
    }
    case 'gaussian': {
      const cc = c as GaussianCoeffs;
      return `y(t) = ${f(cc.A)} · e^(-(t-${f(cc.mu)})²/(2·${f(cc.sigma)}²)) · cos(2π·${f(cc.f0)}·t ${sign(cc.phi)}${f(cc.phi)}) ${sign(cc.C)}${f(cc.C)}`;
    }
    case 'harmonics': {
      const cc = c as HarmonicsCoeffs;
      return `y(t) = ${f(cc.A1)}·sin(2π·${f(cc.f1)}·t) ${sign(cc.A2)}${f(cc.A2)}·sin(2π·${f(cc.f2)}·t) ${sign(cc.A3)}${f(cc.A3)}·sin(2π·${f(cc.f3)}·t) ${sign(cc.C)}${f(cc.C)}`;
    }
    case 'polynomial': {
      const cc = c as PolynomialCoeffs;
      return `y(t) = ${f(cc.a0)} ${sign(cc.a1)}${f(cc.a1)}·t ${sign(cc.a2)}${f(cc.a2)}·t² ${sign(cc.a3)}${f(cc.a3)}·t³ ${sign(cc.a4)}${f(cc.a4)}·t⁴ ${sign(cc.a5)}${f(cc.a5)}·t⁵`;
    }
  }
}

export function compareCoefficients(
  a: FormulaCoefficients,
  b: FormulaCoefficients
): Record<string, number> {
  const aRec = a as Record<string, number>;
  const bRec = b as Record<string, number>;
  const keys = Object.keys(aRec);
  const result: Record<string, number> = {};
  for (const k of keys) {
    const denom = Math.max(Math.abs(aRec[k]), Math.abs(bRec[k] ?? 0), 1e-9);
    result[k] = Math.abs(aRec[k] - (bRec[k] ?? 0)) / denom;
  }
  return result;
}
