import { supabase } from "@/integrations/supabase/client";
import type { LoRaParams } from "./lora-signal";

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

export async function saveSignal(
  text: string,
  params: LoRaParams,
  cr: number,
  duration: number,
  nSymbols: number,
  symbols: number[],
  tags: string = "",
  modType: string = "lora"
): Promise<string | null> {
  const signalHash = hashString(text + JSON.stringify(params) + modType);

  const { data, error } = await supabase
    .from("signals")
    .upsert({
      signal_hash: signalHash,
      message_text: text.slice(0, 1000),
      message_length: text.length,
      sf: params.sf,
      bw: params.bw,
      cr,
      fc: params.fc,
      duration,
      n_symbols: nSymbols,
      symbols_preview: symbols.slice(0, 20),
      tags,
      mod_type: modType,
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
  sfFilter?: number
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
    .select("sf, bw, message_length, created_at");

  if (!signals || signals.length === 0) return null;

  const sfCounts: Record<number, number> = {};
  const bwCounts: Record<number, number> = {};
  let totalLength = 0;

  for (const s of signals) {
    sfCounts[s.sf] = (sfCounts[s.sf] || 0) + 1;
    bwCounts[s.bw] = (bwCounts[s.bw] || 0) + 1;
    totalLength += s.message_length;
  }

  return {
    total: signals.length,
    avgLength: totalLength / signals.length,
    sfCounts,
    bwCounts,
  };
}
