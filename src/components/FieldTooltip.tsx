import React from "react";
import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FieldTooltipProps {
  text: string;
  recommended?: string;
  children: React.ReactNode;
}

export function FieldTooltip({ text, recommended, children }: FieldTooltipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1">
            {children}
            <HelpCircle className="w-2.5 h-2.5 text-muted-foreground/60 hover:text-muted-foreground cursor-help shrink-0" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] text-[10px] font-mono">
          <p>{text}</p>
          {recommended && (
            <p className="mt-1 text-signal-green">💡 {recommended}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Tooltip data for all fields across panels */
export const FIELD_TOOLTIPS = {
  // LoRa params
  sf: {
    text: "Spreading Factor — определяет количество чирпов на символ (2^SF). Больше SF = дальность выше, скорость ниже.",
    recommended: "SF7 для коротких дистанций, SF12 для максимальной дальности",
  },
  bw: {
    text: "Bandwidth — полоса частот сигнала в кГц. Шире полоса = выше скорость, но ниже чувствительность.",
    recommended: "125кГц — стандарт для большинства LoRa сетей",
  },
  cr: {
    text: "Coding Rate — избыточность помехоустойчивого кода. 4/5 = минимум, 4/8 = максимум защиты.",
    recommended: "4/5 для чистого канала, 4/8 для зашумлённого",
  },

  // General
  symbolRate: {
    text: "Скорость передачи символов (бод). Определяет сколько символов передаётся в секунду.",
    recommended: "PSK: 5000-10000, FSK: 10000-20000, CDMA: 10000",
  },
  freqDeviation: {
    text: "Частотная девиация (Гц) — разнос между частотами в FSK модуляции. Влияет на помехоустойчивость и полосу.",
    recommended: "25000 Гц для стандартных условий",
  },
  chipRate: {
    text: "Скорость чипов (chips/s) в CDMA. Определяет коэффициент расширения спектра.",
    recommended: "100000 chips/s, коэффициент расширения = chipRate/symbolRate",
  },
  numSymbols: {
    text: "Количество символов для модуляции. Максимум зависит от длины текста и типа протокола.",
    recommended: "Используйте максимум для полного кодирования сообщения",
  },
  message: {
    text: "Текстовое сообщение для модуляции. Поддерживает кириллицу (UTF-8). Максимум 1240 байт.",
    recommended: "Короткие сообщения дают более чистый сигнал",
  },
  tags: {
    text: "Теги для категоризации сигналов в БД. Через запятую.",
    recommended: "Например: тест, demo, шумный",
  },
  noise: {
    text: "Уровень аддитивного белого гауссовского шума (AWGN). 0 = чистый сигнал.",
    recommended: "0.05-0.1 для реалистичного канала",
  },

  // Encryption
  encryptionType: {
    text: "Тип шифрования данных перед модуляцией. Влияет на устойчивость к перехвату.",
    recommended: "AES-подобное для максимальной защиты, LFSR для радиопротоколов",
  },
  xorKey: {
    text: "8-битный ключ XOR шифрования (0-255). Простая побитовая операция.",
    recommended: "Используйте случайное значение. Уязвим к частотному анализу.",
  },
  lfsrPoly: {
    text: "Полином LFSR в двоичном виде. Определяет последовательность скремблирования.",
    recommended: "0b11000001 (x⁷+x⁶+1) — стандарт для многих протоколов",
  },
  lfsrSeed: {
    text: "Начальное состояние регистра LFSR. Не должно быть 0.",
    recommended: "0x7F для LFSR, 0x1FF для whitening",
  },
  interleaverRows: {
    text: "Количество строк в матрице перемежения. Больше = лучшая защита от пакетных ошибок.",
    recommended: "8 для стандартных условий, 16 для сильно зашумлённого канала",
  },

  // Training
  learningRate: {
    text: "Скорость обучения нейросети. Слишком высокая = нестабильность, слишком низкая = медленная сходимость.",
    recommended: "0.01-0.05 для большинства задач",
  },
  epochs: {
    text: "Количество эпох обучения. Больше = точнее, но дольше.",
    recommended: "300-800 для большинства моделей",
  },
  batchSize: {
    text: "Размер мини-батча для SGD. Влияет на скорость и стабильность обучения.",
    recommended: "32-64 для оптимального баланса",
  },

  // FHSS
  numHops: {
    text: "Количество частотных скачков в FHSS последовательности.",
    recommended: "8-16 для типичного FHSS сигнала",
  },
  tHop: {
    text: "Длительность одного частотного скачка (мс).",
    recommended: "1-5 мс для быстрого хоппинга",
  },
  deltaFh: {
    text: "Шаг частотного хоппинга (кГц). Разнос между частотными каналами.",
    recommended: "10-50 кГц в зависимости от полосы",
  },
  deltaFm: {
    text: "Шаг частоты модуляции (кГц).",
    recommended: "1-5 кГц",
  },
} as const;
