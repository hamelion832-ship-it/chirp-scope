/**
 * Protocol classification utilities for stored signals and multi-protocol analysis.
 * Provides visual labels, colors, and grouping for protocol families.
 */

import type { ModulationType } from "./modulation-engine";
import { MODULATION_REGISTRY } from "./modulation-engine";

export interface ProtocolGroup {
  family: string;
  protocols: ModulationType[];
  color: string;         // tailwind signal color name
  colorHsl: string;      // raw hsl for charts
  label: string;
}

export const PROTOCOL_GROUPS: ProtocolGroup[] = [
  { family: "CSS", protocols: ["lora"], color: "signal-green", colorHsl: "142 70% 38%", label: "LoRa (CSS)" },
  { family: "PSK", protocols: ["bpsk", "qpsk", "8psk"], color: "signal-cyan", colorHsl: "185 85% 38%", label: "PSK" },
  { family: "FSK", protocols: ["2fsk", "4fsk"], color: "signal-amber", colorHsl: "35 92% 48%", label: "FSK" },
  { family: "CDMA", protocols: ["cdma"], color: "signal-magenta", colorHsl: "300 65% 48%", label: "CDMA" },
];

export function getProtocolGroup(modType: ModulationType): ProtocolGroup {
  return PROTOCOL_GROUPS.find(g => g.protocols.includes(modType)) ?? PROTOCOL_GROUPS[0];
}

export function getProtocolMeta(modType: ModulationType) {
  return MODULATION_REGISTRY.find(m => m.id === modType)!;
}

export function getProtocolBadgeClass(modType: ModulationType): string {
  const g = getProtocolGroup(modType);
  return `bg-${g.color}/15 text-${g.color} border-${g.color}/30`;
}

/** For per-protocol analysis: group signal IDs by their assigned protocol */
export interface ProtocolGroupedResults<T> {
  protocol: ModulationType;
  group: ProtocolGroup;
  items: T[];
}

export function groupByProtocol<T extends { protocol: ModulationType }>(
  items: T[]
): ProtocolGroupedResults<T>[] {
  const map = new Map<ModulationType, T[]>();
  for (const item of items) {
    const arr = map.get(item.protocol) ?? [];
    arr.push(item);
    map.set(item.protocol, arr);
  }
  return Array.from(map.entries()).map(([protocol, items]) => ({
    protocol,
    group: getProtocolGroup(protocol),
    items,
  }));
}

/** Color palette for chart lines per protocol */
export const PROTOCOL_CHART_COLORS: Record<string, string> = {
  lora: "hsl(142 70% 38%)",
  bpsk: "hsl(185 85% 38%)",
  qpsk: "hsl(200 85% 45%)",
  "8psk": "hsl(210 80% 50%)",
  "2fsk": "hsl(35 92% 48%)",
  "4fsk": "hsl(25 90% 50%)",
  cdma: "hsl(300 65% 48%)",
};
