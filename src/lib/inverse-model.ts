/**
 * Inverse Signal Decoder Engine
 * 
 * Given a received waveform s(t), recover:
 *   - Original symbols (H_k hopping sequence, B_{k,m} bit matrix)
 *   - Decoded text message
 *   - Estimated signal parameters (SF, BW, f0, channel state)
 * 
 * Approach: MLP-style learnable decoder trained via gradient descent
 * on paired (signal_samples → symbols) data, then symbols → text.
 */

export interface DecoderConfig {
  hiddenSize: number;    // neurons in hidden layer
  learningRate: number;
  epochs: number;
  windowSize: number;    // samples per input window
}

export const DEFAULT_DECODER_CONFIG: DecoderConfig = {
  hiddenSize: 32,
  learningRate: 0.01,
  epochs: 300,
  windowSize: 16,
};

/** Simple single-hidden-layer MLP weights */
interface MLPWeights {
  W1: number[][];   // [hiddenSize][inputSize]
  b1: number[];     // [hiddenSize]
  W2: number[][];   // [outputSize][hiddenSize]
  b2: number[];     // [outputSize]
}

function initWeights(inputSize: number, hiddenSize: number, outputSize: number): MLPWeights {
  const scale1 = Math.sqrt(2 / inputSize);
  const scale2 = Math.sqrt(2 / hiddenSize);
  return {
    W1: Array.from({ length: hiddenSize }, () =>
      Array.from({ length: inputSize }, () => (Math.random() - 0.5) * scale1 * 2)
    ),
    b1: new Array(hiddenSize).fill(0),
    W2: Array.from({ length: outputSize }, () =>
      Array.from({ length: hiddenSize }, () => (Math.random() - 0.5) * scale2 * 2)
    ),
    b2: new Array(outputSize).fill(0),
  };
}

function relu(x: number): number { return x > 0 ? x : 0; }
function reluDeriv(x: number): number { return x > 0 ? 1 : 0; }

/** Forward pass through MLP */
function forward(input: number[], w: MLPWeights): { hidden: number[]; output: number[]; preHidden: number[] } {
  const preHidden = w.b1.map((b, i) =>
    b + input.reduce((s, x, j) => s + w.W1[i][j] * x, 0)
  );
  const hidden = preHidden.map(relu);
  const output = w.b2.map((b, i) =>
    b + hidden.reduce((s, h, j) => s + w.W2[i][j] * h, 0)
  );
  return { hidden, output, preHidden };
}

/** Softmax for classification */
function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map(l => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

export interface TrainingPair {
  input: number[];     // windowed signal samples [windowSize * 2] (real + imag)
  targetSymbol: number; // target symbol value
}

export interface DecoderTrainingResult {
  weights: MLPWeights;
  config: DecoderConfig;
  outputSize: number;
  epochLosses: number[];
  accuracy: number;
  symbolAccuracies: Map<number, number>;
  confusionSamples: { predicted: number; actual: number }[];
}

export interface DecodedResult {
  symbols: number[];
  confidence: number[];
  decodedBits: number[];
  decodedText: string;
  estimatedParams: {
    sf: number;
    bwEstimate: number;
    snrEstimate: number;
  };
  symbolProbabilities: number[][];  // [symbolIdx][classIdx] 
}

/** Build training pairs from signal data */
export function buildTrainingPairs(
  real: number[] | Float64Array,
  imag: number[] | Float64Array,
  symbols: number[],
  samplesPerSymbol: number,
  windowSize: number
): TrainingPair[] {
  const pairs: TrainingPair[] = [];
  
  for (let symIdx = 0; symIdx < symbols.length; symIdx++) {
    const symStart = symIdx * samplesPerSymbol;
    const symEnd = Math.min(symStart + samplesPerSymbol, real.length);
    
    // Extract windows from within this symbol
    const numWindows = Math.floor((symEnd - symStart) / windowSize);
    const step = Math.max(1, Math.floor(numWindows / 3)); // ~3 windows per symbol
    
    for (let w = 0; w < numWindows; w += step) {
      const wStart = symStart + w * windowSize;
      if (wStart + windowSize > real.length) break;
      
      const input: number[] = [];
      for (let j = 0; j < windowSize; j++) {
        input.push(real[wStart + j]);
        input.push(imag[wStart + j]);
      }
      
      pairs.push({ input, targetSymbol: symbols[symIdx] });
    }
  }
  
  return pairs;
}

/** Train the decoder MLP */
export function trainDecoder(
  pairs: TrainingPair[],
  config: DecoderConfig,
  numClasses: number,
  onEpoch?: (epoch: number, loss: number, acc: number) => void
): DecoderTrainingResult {
  const inputSize = config.windowSize * 2;
  const w = initWeights(inputSize, config.hiddenSize, numClasses);
  const epochLosses: number[] = [];
  
  if (pairs.length === 0) {
    return {
      weights: w, config, outputSize: numClasses,
      epochLosses: [], accuracy: 0,
      symbolAccuracies: new Map(), confusionSamples: [],
    };
  }
  
  const lr = config.learningRate;
  
  for (let epoch = 0; epoch < config.epochs; epoch++) {
    let totalLoss = 0;
    let correct = 0;
    
    // Shuffle indices
    const indices = Array.from({ length: pairs.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    const batchSize = Math.min(32, pairs.length);
    const batchIndices = indices.slice(0, batchSize);
    
    // Accumulate gradients
    const dW1 = w.W1.map(r => r.map(() => 0));
    const db1 = w.b1.map(() => 0);
    const dW2 = w.W2.map(r => r.map(() => 0));
    const db2 = w.b2.map(() => 0);
    
    for (const idx of batchIndices) {
      const pair = pairs[idx];
      const { hidden, output, preHidden } = forward(pair.input, w);
      const probs = softmax(output);
      
      // Cross-entropy loss
      const targetProb = Math.max(probs[pair.targetSymbol] ?? 1e-12, 1e-12);
      totalLoss += -Math.log(targetProb);
      
      const predicted = probs.indexOf(Math.max(...probs));
      if (predicted === pair.targetSymbol) correct++;
      
      // Backprop: output gradient (softmax + cross-entropy)
      const dOutput = probs.map((p, i) => p - (i === pair.targetSymbol ? 1 : 0));
      
      // Gradients for W2, b2
      for (let i = 0; i < numClasses; i++) {
        db2[i] += dOutput[i];
        for (let j = 0; j < config.hiddenSize; j++) {
          dW2[i][j] += dOutput[i] * hidden[j];
        }
      }
      
      // Gradients for hidden layer
      const dHidden = new Array(config.hiddenSize).fill(0);
      for (let j = 0; j < config.hiddenSize; j++) {
        for (let i = 0; i < numClasses; i++) {
          dHidden[j] += dOutput[i] * w.W2[i][j];
        }
        dHidden[j] *= reluDeriv(preHidden[j]);
      }
      
      // Gradients for W1, b1
      for (let i = 0; i < config.hiddenSize; i++) {
        db1[i] += dHidden[i];
        for (let j = 0; j < inputSize; j++) {
          dW1[i][j] += dHidden[i] * pair.input[j];
        }
      }
    }
    
    // Update weights
    const scale = lr / batchSize;
    for (let i = 0; i < config.hiddenSize; i++) {
      w.b1[i] -= db1[i] * scale;
      for (let j = 0; j < inputSize; j++) {
        w.W1[i][j] -= Math.max(-5, Math.min(5, dW1[i][j])) * scale;
      }
    }
    for (let i = 0; i < numClasses; i++) {
      w.b2[i] -= db2[i] * scale;
      for (let j = 0; j < config.hiddenSize; j++) {
        w.W2[i][j] -= Math.max(-5, Math.min(5, dW2[i][j])) * scale;
      }
    }
    
    const avgLoss = totalLoss / batchSize;
    epochLosses.push(avgLoss);
    
    if (onEpoch && epoch % Math.max(1, Math.floor(config.epochs / 50)) === 0) {
      onEpoch(epoch, avgLoss, correct / batchSize);
    }
  }
  
  // Final evaluation
  let totalCorrect = 0;
  const symbolCorrect = new Map<number, number>();
  const symbolTotal = new Map<number, number>();
  const confusionSamples: { predicted: number; actual: number }[] = [];
  
  for (const pair of pairs) {
    const { output } = forward(pair.input, w);
    const probs = softmax(output);
    const predicted = probs.indexOf(Math.max(...probs));
    
    if (predicted === pair.targetSymbol) totalCorrect++;
    symbolCorrect.set(pair.targetSymbol, (symbolCorrect.get(pair.targetSymbol) ?? 0) + (predicted === pair.targetSymbol ? 1 : 0));
    symbolTotal.set(pair.targetSymbol, (symbolTotal.get(pair.targetSymbol) ?? 0) + 1);
    
    if (confusionSamples.length < 200) {
      confusionSamples.push({ predicted, actual: pair.targetSymbol });
    }
  }
  
  const symbolAccuracies = new Map<number, number>();
  for (const [sym, total] of symbolTotal.entries()) {
    symbolAccuracies.set(sym, (symbolCorrect.get(sym) ?? 0) / total);
  }
  
  return {
    weights: w, config, outputSize: numClasses,
    epochLosses,
    accuracy: totalCorrect / pairs.length,
    symbolAccuracies,
    confusionSamples,
  };
}

/** Decode a signal using trained weights */
export function decodeSignal(
  real: number[] | Float64Array,
  imag: number[] | Float64Array,
  samplesPerSymbol: number,
  trained: DecoderTrainingResult,
  sf: number
): DecodedResult {
  const numSymbols = Math.floor(real.length / samplesPerSymbol);
  const symbols: number[] = [];
  const confidence: number[] = [];
  const symbolProbabilities: number[][] = [];
  
  for (let symIdx = 0; symIdx < numSymbols; symIdx++) {
    const symStart = symIdx * samplesPerSymbol;
    
    // Collect votes from windows within this symbol
    const votes = new Array(trained.outputSize).fill(0);
    let windowCount = 0;
    
    const numWindows = Math.floor(samplesPerSymbol / trained.config.windowSize);
    for (let w = 0; w < numWindows; w++) {
      const wStart = symStart + w * trained.config.windowSize;
      if (wStart + trained.config.windowSize > real.length) break;
      
      const input: number[] = [];
      for (let j = 0; j < trained.config.windowSize; j++) {
        input.push(real[wStart + j] as number);
        input.push(imag[wStart + j] as number);
      }
      
      const { output } = forward(input, trained.weights);
      const probs = softmax(output);
      for (let i = 0; i < probs.length; i++) votes[i] += probs[i];
      windowCount++;
    }
    
    // Average votes
    if (windowCount > 0) {
      for (let i = 0; i < votes.length; i++) votes[i] /= windowCount;
    }
    
    const predicted = votes.indexOf(Math.max(...votes));
    symbols.push(predicted);
    confidence.push(votes[predicted] ?? 0);
    symbolProbabilities.push([...votes]);
  }
  
  // Symbols → bits → text
  const decodedBits: number[] = [];
  for (const sym of symbols) {
    for (let i = sf - 1; i >= 0; i--) {
      decodedBits.push((sym >> i) & 1);
    }
  }
  
  // Bits → bytes → text
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= decodedBits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | decodedBits[i + j];
    }
    bytes.push(byte);
  }
  
  let decodedText = "";
  try {
    decodedText = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
    // Clean up non-printable characters
    decodedText = decodedText.replace(/[\x00-\x08\x0E-\x1F\x7F-\x9F]/g, "·");
  } catch {
    decodedText = "[decode error]";
  }
  
  // Estimate params from signal characteristics
  const avgConfidence = confidence.reduce((a, b) => a + b, 0) / (confidence.length || 1);
  const signalPower = Array.from(real).reduce((s, v, i) => s + v * v + (imag[i] as number) ** 2, 0) / real.length;
  
  return {
    symbols,
    confidence,
    decodedBits,
    decodedText,
    estimatedParams: {
      sf,
      bwEstimate: samplesPerSymbol > 0 ? (2 ** sf) / (samplesPerSymbol / 500e3) : 125e3,
      snrEstimate: 10 * Math.log10(signalPower / (1 - avgConfidence + 1e-9)),
    },
    symbolProbabilities,
  };
}

/** Compare original and decoded text, return similarity metrics */
export function compareTexts(original: string, decoded: string): {
  charAccuracy: number;
  editDistance: number;
  matchingChars: number;
  totalChars: number;
} {
  const minLen = Math.min(original.length, decoded.length);
  const maxLen = Math.max(original.length, decoded.length);
  let matching = 0;
  for (let i = 0; i < minLen; i++) {
    if (original[i] === decoded[i]) matching++;
  }
  
  // Simple Levenshtein approximation
  const editDistance = maxLen - matching;
  
  return {
    charAccuracy: maxLen > 0 ? matching / maxLen : 0,
    editDistance,
    matchingChars: matching,
    totalChars: maxLen,
  };
}
