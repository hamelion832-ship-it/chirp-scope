// LoRa Signal Generation Engine
// Port of the Python LoRa signal model to TypeScript

export interface LoRaParams {
  sf: number;       // Spreading Factor (7-12)
  bw: number;       // Bandwidth in Hz
  fc: number;       // Center frequency in Hz
  sampleRate: number;
}

export interface SignalData {
  time: number[];
  real: number[];
  imag: number[];
  amplitude: number[];
  symbols: number[];
  params: LoRaParams;
}

export interface SpectrumData {
  frequencies: number[];
  power: number[];
}

export interface SpectrogramData {
  timeAxis: number[];
  freqAxis: number[];
  power: number[][];  // [freq][time]
}

export interface IQPoint {
  i: number;
  q: number;
}

function textToBits(text: string): number[] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1);
    }
  }
  return bits;
}

function bitsToSymbols(bits: number[], sf: number, maxSymbols: number): number[] {
  const symbols: number[] = [];
  for (let i = 0; i < Math.min(bits.length, sf * maxSymbols); i += sf) {
    if (i + sf <= bits.length) {
      let value = 0;
      for (let j = 0; j < sf; j++) {
        value = (value << 1) | bits[i + j];
      }
      symbols.push(value);
    }
  }
  return symbols.slice(0, maxSymbols);
}

export function generateLoRaSignal(
  params: LoRaParams,
  text: string,
  numSymbols = 10
): SignalData {
  const { sf, bw, sampleRate } = params;
  const M = 2 ** sf;
  const tSymbol = M / bw;
  const samplesPerSymbol = Math.floor(sampleRate * tSymbol);

  const bits = textToBits(text);
  const symbols = bitsToSymbols(bits, sf, numSymbols);
  const actualSymbols = symbols.length || [0];

  const totalSamples = symbols.length * samplesPerSymbol;
  const dt = 1 / sampleRate;

  const time: number[] = new Array(totalSamples);
  const real: number[] = new Array(totalSamples);
  const imag: number[] = new Array(totalSamples);
  const amplitude: number[] = new Array(totalSamples);

  for (let symIdx = 0; symIdx < symbols.length; symIdx++) {
    const symVal = symbols[symIdx];
    const startIdx = symIdx * samplesPerSymbol;
    // Frequency offset for this symbol
    const freqOffset = (symVal / M) * bw;

    let phase = 0;
    for (let j = 0; j < samplesPerSymbol; j++) {
      const idx = startIdx + j;
      const tNorm = j * dt;
      // Instantaneous frequency: linear chirp + cyclic shift
      const instFreq = (bw / tSymbol) * tNorm - bw / 2 + freqOffset;
      // Wrap frequency within [-bw/2, bw/2]
      const wrappedFreq = ((instFreq + bw / 2) % bw + bw) % bw - bw / 2;
      
      phase += 2 * Math.PI * wrappedFreq * dt;
      
      time[idx] = (startIdx + j) * dt;
      real[idx] = Math.cos(phase);
      imag[idx] = Math.sin(phase);
      amplitude[idx] = 1.0; // Constant envelope for LoRa
    }
  }

  return { time, real, imag, amplitude, symbols, params };
}

// Simple DFT for spectrum (we use a subset of samples for performance)
export function computeSpectrum(
  real: number[],
  imag: number[],
  sampleRate: number,
  maxPoints = 1024
): SpectrumData {
  const N = Math.min(real.length, maxPoints);
  // Use first N samples
  const frequencies: number[] = [];
  const power: number[] = [];

  for (let k = 0; k < N; k++) {
    let sumReal = 0;
    let sumImag = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      sumReal += real[n] * Math.cos(angle) + imag[n] * Math.sin(angle);
      sumImag += -real[n] * Math.sin(angle) + imag[n] * Math.cos(angle);
    }
    const magnitude = Math.sqrt(sumReal * sumReal + sumImag * sumImag) / N;
    const powerDb = 20 * Math.log10(magnitude + 1e-12);
    
    // Shift frequency to centered
    let freq = (k < N / 2) ? k * sampleRate / N : (k - N) * sampleRate / N;
    frequencies.push(freq / 1000); // kHz
    power.push(powerDb);
  }

  // Sort by frequency for proper display
  const combined = frequencies.map((f, i) => ({ f, p: power[i] }));
  combined.sort((a, b) => a.f - b.f);

  return {
    frequencies: combined.map(c => c.f),
    power: combined.map(c => c.p),
  };
}

// Simple STFT for spectrogram
export function computeSpectrogram(
  real: number[],
  imag: number[],
  sampleRate: number,
  windowSize = 128,
  hopSize = 32
): SpectrogramData {
  const numWindows = Math.floor((real.length - windowSize) / hopSize);
  const timeAxis: number[] = [];
  const freqAxis: number[] = [];
  const power: number[][] = [];

  // Build frequency axis (centered)
  for (let k = 0; k < windowSize; k++) {
    const freq = k < windowSize / 2
      ? (k * sampleRate) / windowSize
      : ((k - windowSize) * sampleRate) / windowSize;
    freqAxis.push(freq / 1000); // kHz
  }

  // Sort freq axis indices
  const freqIndices = freqAxis.map((f, i) => ({ f, i }));
  freqIndices.sort((a, b) => a.f - b.f);
  const sortedFreqAxis = freqIndices.map(fi => fi.f);

  const maxWindows = Math.min(numWindows, 200); // Limit for performance

  for (let w = 0; w < maxWindows; w++) {
    const start = w * hopSize;
    timeAxis.push((start + windowSize / 2) / sampleRate * 1000); // ms

    const windowPower: number[] = new Array(windowSize);
    
    for (let k = 0; k < windowSize; k++) {
      let sumR = 0, sumI = 0;
      for (let n = 0; n < windowSize; n++) {
        // Hann window
        const hann = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (windowSize - 1)));
        const angle = (2 * Math.PI * k * n) / windowSize;
        sumR += (real[start + n] * hann) * Math.cos(angle) + (imag[start + n] * hann) * Math.sin(angle);
        sumI += -(real[start + n] * hann) * Math.sin(angle) + (imag[start + n] * hann) * Math.cos(angle);
      }
      const mag = Math.sqrt(sumR * sumR + sumI * sumI) / windowSize;
      windowPower[k] = 20 * Math.log10(mag + 1e-12);
    }

    // Reorder by sorted frequency
    const sorted = freqIndices.map(fi => windowPower[fi.i]);
    power.push(sorted);
  }

  return { timeAxis, freqAxis: sortedFreqAxis, power };
}

export function getIQPoints(real: number[], imag: number[], step = 4, maxPoints = 200): IQPoint[] {
  const points: IQPoint[] = [];
  for (let i = 0; i < Math.min(real.length, maxPoints * step); i += step) {
    points.push({ i: real[i], q: imag[i] });
  }
  return points;
}

export function getIQTrajectory(real: number[], imag: number[], maxPoints = 500): IQPoint[] {
  const step = Math.max(1, Math.floor(real.length / maxPoints));
  const points: IQPoint[] = [];
  for (let i = 0; i < real.length && points.length < maxPoints; i += step) {
    points.push({ i: real[i], q: imag[i] });
  }
  return points;
}
