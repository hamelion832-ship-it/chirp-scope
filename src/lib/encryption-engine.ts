/**
 * Signal Encryption Engine
 * Supports: None, XOR, AES-like (SubBytes+ShiftRows+MixColumns), 
 *           LFSR Scrambling, Data Whitening, Bit Interleaving
 */

export type EncryptionType = "none" | "xor" | "aes_like" | "lfsr" | "whitening" | "interleaving";

export interface EncryptionMeta {
  id: EncryptionType;
  name: string;
  category: "none" | "cipher" | "scrambler" | "coding";
  description: string;
  tooltip: string;
}

export const ENCRYPTION_REGISTRY: EncryptionMeta[] = [
  { id: "none", name: "Без шифрования", category: "none",
    description: "Данные передаются открытым текстом",
    tooltip: "Без защиты. Сигнал легко перехватить и декодировать." },
  { id: "xor", name: "XOR", category: "cipher",
    description: "Побитовое XOR с ключом",
    tooltip: "Простое симметричное шифрование. Ключ: 8-32 бит. Уязвим к частотному анализу." },
  { id: "aes_like", name: "AES-подобное", category: "cipher",
    description: "SubBytes + ShiftRows + MixColumns (упрощённый AES)",
    tooltip: "Многораундовое блочное шифрование. Блок 16 байт, 4 раунда. Высокая стойкость." },
  { id: "lfsr", name: "LFSR скремблер", category: "scrambler",
    description: "Линейный регистр сдвига с обратной связью",
    tooltip: "Типичный для радиопротоколов. Полином: x⁷+x⁶+1. Обеспечивает спектральную плоскость." },
  { id: "whitening", name: "Data Whitening", category: "scrambler",
    description: "Отбеливание данных (LoRa/FSK стандарт)",
    tooltip: "Устраняет длинные последовательности 0/1. Стандарт LoRaWAN/BLE. LFSR seed: 0x1FF." },
  { id: "interleaving", name: "Bit Interleaving", category: "coding",
    description: "Перемежение битов для защиты от пакетных ошибок",
    tooltip: "Перестановка битов по матрице NxM. Защищает от burst-ошибок в канале." },
];

export interface EncryptionConfig {
  type: EncryptionType;
  key?: number;       // for XOR (8-32 bit key)
  aesKey?: number[];   // 16 bytes for AES-like
  lfsrPoly?: number;   // LFSR polynomial
  lfsrSeed?: number;   // LFSR initial state
  interleaverRows?: number;
  interleaverCols?: number;
}

export const DEFAULT_ENCRYPTION_CONFIG: EncryptionConfig = {
  type: "none",
  key: 0xA5,
  aesKey: [0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6,
           0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf, 0x4f, 0x3c],
  lfsrPoly: 0b11000001, // x^7 + x^6 + 1
  lfsrSeed: 0x7F,
  interleaverRows: 8,
  interleaverCols: 0, // auto = ceil(bits.length / rows)
};

// ─── XOR Encryption ───

export function encryptXOR(data: number[], key: number): number[] {
  const keyBits: number[] = [];
  for (let i = 7; i >= 0; i--) keyBits.push((key >> i) & 1);
  return data.map((bit, i) => bit ^ keyBits[i % keyBits.length]);
}

export function decryptXOR(data: number[], key: number): number[] {
  return encryptXOR(data, key); // XOR is its own inverse
}

// ─── AES-like Block Cipher (simplified) ───

const SBOX: number[] = (() => {
  // Build a proper permutation via seeded Fisher-Yates shuffle
  const s = Array.from({ length: 256 }, (_, i) => i);
  let seed = 0xDEAD;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed; };
  for (let i = 255; i > 0; i--) {
    const j = rand() % (i + 1);
    [s[i], s[j]] = [s[j], s[i]];
  }
  return s;
})();

const INV_SBOX: number[] = (() => {
  const inv = new Array(256);
  for (let i = 0; i < 256; i++) inv[SBOX[i]] = i;
  return inv;
})();

function subBytes(block: number[]): number[] {
  return block.map(b => SBOX[b & 0xFF]);
}

function invSubBytes(block: number[]): number[] {
  return block.map(b => INV_SBOX[b & 0xFF]);
}

function shiftRows(block: number[]): number[] {
  // Treat as 4x4 matrix, shift row i left by i positions
  const out = [...block];
  for (let row = 1; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      out[row * 4 + col] = block[row * 4 + ((col + row) % 4)];
    }
  }
  return out;
}

function invShiftRows(block: number[]): number[] {
  const out = [...block];
  for (let row = 1; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      out[row * 4 + ((col + row) % 4)] = block[row * 4 + col];
    }
  }
  return out;
}

/** GF(2^8) multiply for AES MixColumns */
function gmul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xFF;
    if (hi) a ^= 0x1B; // x^8 + x^4 + x^3 + x + 1
    b >>= 1;
  }
  return p;
}

function mixColumns(block: number[]): number[] {
  const out = [...block];
  for (let col = 0; col < 4; col++) {
    const a = block[col], b = block[4 + col], c = block[8 + col], d = block[12 + col];
    out[col]       = gmul(2,a) ^ gmul(3,b) ^ c ^ d;
    out[4 + col]   = a ^ gmul(2,b) ^ gmul(3,c) ^ d;
    out[8 + col]   = a ^ b ^ gmul(2,c) ^ gmul(3,d);
    out[12 + col]  = gmul(3,a) ^ b ^ c ^ gmul(2,d);
  }
  return out;
}

function invMixColumns(block: number[]): number[] {
  const out = [...block];
  for (let col = 0; col < 4; col++) {
    const a = block[col], b = block[4 + col], c = block[8 + col], d = block[12 + col];
    out[col]       = gmul(14,a) ^ gmul(11,b) ^ gmul(13,c) ^ gmul(9,d);
    out[4 + col]   = gmul(9,a) ^ gmul(14,b) ^ gmul(11,c) ^ gmul(13,d);
    out[8 + col]   = gmul(13,a) ^ gmul(9,b) ^ gmul(14,c) ^ gmul(11,d);
    out[12 + col]  = gmul(11,a) ^ gmul(13,b) ^ gmul(9,c) ^ gmul(14,d);
  }
  return out;
}

function addRoundKey(block: number[], key: number[]): number[] {
  return block.map((b, i) => b ^ key[i % key.length]);
}

export function encryptAESLike(data: number[], key: number[]): number[] {
  // Convert bits to bytes, pad to 16-byte blocks
  const bytes: number[] = [];
  for (let i = 0; i < data.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8 && i + j < data.length; j++) {
      byte = (byte << 1) | (data[i + j] & 1);
    }
    bytes.push(byte);
  }
  // Pad to multiple of 16
  while (bytes.length % 16 !== 0) bytes.push(0);

  const result: number[] = [];
  for (let blockStart = 0; blockStart < bytes.length; blockStart += 16) {
    let block = bytes.slice(blockStart, blockStart + 16);
    block = addRoundKey(block, key);
    for (let round = 0; round < 4; round++) {
      block = subBytes(block);
      block = shiftRows(block);
      if (round < 3) block = mixColumns(block);
      block = addRoundKey(block, key.map((k, i) => k ^ (round * 16 + i)));
    }
    result.push(...block);
  }

  // Convert back to bits
  const bits: number[] = [];
  for (const byte of result) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  return bits.slice(0, data.length);
}

export function decryptAESLike(data: number[], key: number[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < data.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8 && i + j < data.length; j++) {
      byte = (byte << 1) | (data[i + j] & 1);
    }
    bytes.push(byte);
  }
  while (bytes.length % 16 !== 0) bytes.push(0);

  const result: number[] = [];
  for (let blockStart = 0; blockStart < bytes.length; blockStart += 16) {
    let block = bytes.slice(blockStart, blockStart + 16);
    for (let round = 3; round >= 0; round--) {
      block = addRoundKey(block, key.map((k, i) => k ^ (round * 16 + i)));
      if (round < 3) block = invMixColumns(block);
      block = invShiftRows(block);
      block = invSubBytes(block);
    }
    block = addRoundKey(block, key);
    result.push(...block);
  }

  const bits: number[] = [];
  for (const byte of result) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  return bits.slice(0, data.length);
}

// ─── LFSR Scrambler ───

function lfsrStep(state: number, poly: number, bits: number): [number, number] {
  // Returns [output_bit, new_state]
  const out = state & 1;
  let feedback = 0;
  let tmp = state & poly;
  while (tmp) { feedback ^= tmp & 1; tmp >>= 1; }
  state = ((state >>> 1) | (feedback << (bits - 1))) & ((1 << bits) - 1);
  return [out, state];
}

export function scrambleLFSR(data: number[], poly: number, seed: number): number[] {
  const bits = Math.max(7, Math.floor(Math.log2(poly)) + 1);
  let state = seed & ((1 << bits) - 1);
  if (state === 0) state = 1;
  return data.map(bit => {
    const [lfsrBit, newState] = lfsrStep(state, poly, bits);
    state = newState;
    return bit ^ lfsrBit;
  });
}

export function descrambleLFSR(data: number[], poly: number, seed: number): number[] {
  return scrambleLFSR(data, poly, seed); // same operation
}

// ─── Data Whitening (LoRa/BLE standard) ───

export function whiten(data: number[], seed: number = 0x1FF): number[] {
  // 9-bit LFSR: polynomial x^9 + x^5 + 1 (standard for BLE/LoRa)
  const POLY = 0b100100001; // x^9 + x^5 + 1
  let state = seed & 0x1FF;
  if (state === 0) state = 0x1FF;
  return data.map(bit => {
    const out = state & 1;
    let fb = 0;
    let t = state & POLY;
    while (t) { fb ^= t & 1; t >>= 1; }
    state = ((state >>> 1) | (fb << 8)) & 0x1FF;
    return bit ^ out;
  });
}

export function dewhiten(data: number[], seed: number = 0x1FF): number[] {
  return whiten(data, seed);
}

// ─── Bit Interleaving ───

export function interleave(data: number[], rows: number): number[] {
  const cols = Math.ceil(data.length / rows);
  const padded = [...data];
  while (padded.length < rows * cols) padded.push(0);

  // Write by rows, read by columns
  const result: number[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      result.push(padded[r * cols + c]);
    }
  }
  return result.slice(0, data.length);
}

export function deinterleave(data: number[], rows: number): number[] {
  const cols = Math.ceil(data.length / rows);
  const padded = [...data];
  while (padded.length < rows * cols) padded.push(0);

  // Write by columns, read by rows
  const result: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      result.push(padded[c * rows + r]);
    }
  }
  return result.slice(0, data.length);
}

// ─── Unified encrypt/decrypt ───

export function encryptBits(data: number[], config: EncryptionConfig): number[] {
  switch (config.type) {
    case "none": return [...data];
    case "xor": return encryptXOR(data, config.key ?? 0xA5);
    case "aes_like": return encryptAESLike(data, config.aesKey ?? DEFAULT_ENCRYPTION_CONFIG.aesKey!);
    case "lfsr": return scrambleLFSR(data, config.lfsrPoly ?? 0b11000001, config.lfsrSeed ?? 0x7F);
    case "whitening": return whiten(data, config.lfsrSeed ?? 0x1FF);
    case "interleaving": return interleave(data, config.interleaverRows ?? 8);
  }
}

export function decryptBits(data: number[], config: EncryptionConfig): number[] {
  switch (config.type) {
    case "none": return [...data];
    case "xor": return decryptXOR(data, config.key ?? 0xA5);
    case "aes_like": return decryptAESLike(data, config.aesKey ?? DEFAULT_ENCRYPTION_CONFIG.aesKey!);
    case "lfsr": return descrambleLFSR(data, config.lfsrPoly ?? 0b11000001, config.lfsrSeed ?? 0x7F);
    case "whitening": return dewhiten(data, config.lfsrSeed ?? 0x1FF);
    case "interleaving": return deinterleave(data, config.interleaverRows ?? 8);
  }
}

/** Get encryption strength score 0-100 */
export function getEncryptionStrength(type: EncryptionType): number {
  switch (type) {
    case "none": return 0;
    case "xor": return 15;
    case "lfsr": return 25;
    case "whitening": return 20;
    case "interleaving": return 10;
    case "aes_like": return 75;
  }
}
