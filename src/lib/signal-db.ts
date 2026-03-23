import { supabase } from "@/integrations/supabase/client";
import type { LoRaParams } from "./lora-signal";
import type { EncryptionType } from "./encryption-engine";

export interface StoredSignal {
  id: string;
  signal_hash: string;
  message_text: string;
  message_length: number;
  sf: number;
  bw: number;
  cr: number;
  fc: number;
  duration: number;
  n_symbols: number;
  symbols_preview: number[];
  tags: string;
  mod_type: string;
  symbol_rate: number;
  freq_deviation: number;
  chip_rate: number;
  sample_rate: number;
  encryption_type: string;
  encryption_key: string | null;
  bits_per_symbol: number;
  snr_db: number | null;
  created_at: string;
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0') + 
         str.length.toString(16).padStart(4, '0');
}

export interface SaveSignalParams {
  text: string;
  sf: number;
  bw: number;
  cr: number;
  fc: number;
  duration: number;
  nSymbols: number;
  symbols: number[];
  tags?: string;
  modType: string;
  symbolRate: number;
  freqDeviation: number;
  chipRate: number;
  sampleRate: number;
  encryptionType?: EncryptionType;
  encryptionKey?: string;
  bitsPerSymbol: number;
  snrDb?: number;
}

export async function saveSignal(params: SaveSignalParams): Promise<string | null> {
  const signalHash = hashString(params.text + params.modType + params.sf + params.bw + params.encryptionType);

  const { data, error } = await supabase
    .from("signals")
    .upsert({
      signal_hash: signalHash,
      message_text: params.text.slice(0, 1000),
      message_length: params.text.length,
      sf: params.sf,
      bw: params.bw,
      cr: params.cr,
      fc: params.fc,
      duration: params.duration,
      n_symbols: params.nSymbols,
      symbols_preview: params.symbols.slice(0, 20),
      tags: params.tags || "",
      mod_type: params.modType,
      symbol_rate: params.symbolRate,
      freq_deviation: params.freqDeviation,
      chip_rate: params.chipRate,
      sample_rate: params.sampleRate,
      encryption_type: params.encryptionType || "none",
      encryption_key: params.encryptionKey || null,
      bits_per_symbol: params.bitsPerSymbol,
      snr_db: params.snrDb ?? null,
    } as any, { onConflict: "signal_hash" })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Save error:", error);
    return null;
  }
  return data?.id ?? null;
}

export async function fetchSignals(
  search?: string,
  sfFilter?: number,
  modTypeFilter?: string,
  encryptionFilter?: string
): Promise<StoredSignal[]> {
  let query = supabase
    .from("signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (search) {
    query = query.ilike("message_text", `%${search}%`);
  }
  if (sfFilter) {
    query = query.eq("sf", sfFilter);
  }
  if (modTypeFilter) {
    query = query.eq("mod_type", modTypeFilter);
  }
  if (encryptionFilter) {
    query = query.eq("encryption_type", encryptionFilter);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Fetch error:", error);
    return [];
  }
  return (data ?? []) as StoredSignal[];
}

export async function deleteSignal(id: string): Promise<boolean> {
  const { error } = await supabase.from("signals").delete().eq("id", id);
  return !error;
}

export async function getSignalStats() {
  const { data: signals } = await supabase
    .from("signals")
    .select("sf, bw, message_length, created_at, mod_type, encryption_type, symbol_rate, bits_per_symbol");

  if (!signals || signals.length === 0) return null;

  const sfCounts: Record<number, number> = {};
  const bwCounts: Record<number, number> = {};
  const modTypeCounts: Record<string, number> = {};
  const encryptionCounts: Record<string, number> = {};
  let totalLength = 0;

  for (const s of signals) {
    sfCounts[s.sf] = (sfCounts[s.sf] || 0) + 1;
    bwCounts[s.bw] = (bwCounts[s.bw] || 0) + 1;
    const mt = (s as any).mod_type || "lora";
    modTypeCounts[mt] = (modTypeCounts[mt] || 0) + 1;
    const et = (s as any).encryption_type || "none";
    encryptionCounts[et] = (encryptionCounts[et] || 0) + 1;
    totalLength += s.message_length;
  }

  return {
    total: signals.length,
    avgLength: totalLength / signals.length,
    sfCounts,
    bwCounts,
    modTypeCounts,
    encryptionCounts,
  };
}
