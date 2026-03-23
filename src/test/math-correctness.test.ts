import { describe, it, expect } from 'vitest';
import {
  encryptXOR, decryptXOR,
  encryptAESLike, decryptAESLike,
  scrambleLFSR, descrambleLFSR,
  whiten, dewhiten,
  interleave, deinterleave,
  DEFAULT_ENCRYPTION_CONFIG,
} from '../lib/encryption-engine';
import {
  evaluateFormula, trainFormula,
  type FormulaType, DEFAULT_COEFFS,
} from '../lib/neural-formula';

describe('Encryption roundtrip correctness', () => {
  const testData = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1,
                    0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1];

  it('XOR encrypt/decrypt roundtrip', () => {
    const key = 0xA5;
    const encrypted = encryptXOR(testData, key);
    const decrypted = decryptXOR(encrypted, key);
    expect(decrypted).toEqual(testData);
  });

  it('AES-like encrypt/decrypt roundtrip', () => {
    const key = DEFAULT_ENCRYPTION_CONFIG.aesKey!;
    const encrypted = encryptAESLike(testData, key);
    const decrypted = decryptAESLike(encrypted, key);
    // Block cipher pads to 128-bit blocks; first N bits must match
    expect(decrypted.slice(0, testData.length)).toEqual(testData);
  });

  it('AES-like produces different output than input', () => {
    const key = DEFAULT_ENCRYPTION_CONFIG.aesKey!;
    const encrypted = encryptAESLike(testData, key);
    const isDifferent = encrypted.some((b, i) => b !== testData[i]);
    expect(isDifferent).toBe(true);
  });

  it('LFSR scramble/descramble roundtrip', () => {
    const poly = 0b11000001;
    const seed = 0x7F;
    const scrambled = scrambleLFSR(testData, poly, seed);
    const descrambled = descrambleLFSR(scrambled, poly, seed);
    expect(descrambled).toEqual(testData);
  });

  it('Whitening roundtrip', () => {
    const whitened = whiten(testData);
    const dewhitened = dewhiten(whitened);
    expect(dewhitened).toEqual(testData);
  });

  it('Interleaving roundtrip', () => {
    const interleaved = interleave(testData, 8);
    const deinterleaved = deinterleave(interleaved, 8);
    expect(deinterleaved).toEqual(testData);
  });
});

describe('Formula evaluation correctness', () => {
  const types: FormulaType[] = ['chirp', 'damped_sine', 'gaussian', 'harmonics', 'polynomial', 'lorentzian', 'fm', 'exp_rise'];

  for (const ft of types) {
    it(`${ft}: evaluateFormula returns finite numbers`, () => {
      const c = DEFAULT_COEFFS[ft];
      for (let t = 0; t <= 1; t += 0.1) {
        const val = evaluateFormula(t, c, ft);
        expect(isFinite(val)).toBe(true);
      }
    });
  }

  it('polynomial: correct evaluation', () => {
    const c = { a0: 1, a1: 2, a2: 3, a3: 0, a4: 0, a5: 0 };
    // y(2) = 1 + 2*2 + 3*4 = 1 + 4 + 12 = 17
    expect(evaluateFormula(2, c, 'polynomial')).toBeCloseTo(17, 10);
  });

  it('chirp at t=0: y(0) = A*cos(phi) + C', () => {
    const c = { A: 2, alpha: 0.1, f0: 1, beta: 0.5, phi: 0, C: 1 };
    // exp(0)=1, cos(0)=1 → y = 2*1*1 + 1 = 3
    expect(evaluateFormula(0, c, 'chirp')).toBeCloseTo(3, 10);
  });
});

describe('Formula training convergence', () => {
  it('polynomial fits quadratic data', () => {
    const samples = Array.from({ length: 50 }, (_, i) => {
      const t = i / 49;
      return { t, y: 1 + 2 * t + 3 * t * t };
    });
    const result = trainFormula(samples, { learningRate: 0.1, epochs: 500, batchSize: 50 }, 'polynomial');
    expect(result.r2).toBeGreaterThan(0.9);
  });

  it('damped_sine fits sine data', () => {
    const samples = Array.from({ length: 100 }, (_, i) => {
      const t = i / 99;
      return { t, y: Math.sin(2 * Math.PI * t) };
    });
    const result = trainFormula(samples, { learningRate: 0.05, epochs: 300, batchSize: 50 }, 'damped_sine');
    expect(result.r2).toBeGreaterThan(0.5);
  });
});
