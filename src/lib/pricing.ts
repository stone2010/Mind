import type { AppSettings, UsageLogEntry } from "../types";

export const DEFAULT_USD_CNY = 6.6793;

/**
 * DeepSeek official USD prices per 1M tokens at off-peak rates.
 * Peak rates are exactly 2×. Cache hit/miss and output are separate rows.
 * Source: https://api-docs.deepseek.com/quick_start/pricing (checked 2026-11-17)
 */
const DEEPSEEK_USD = {
  flash: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
  pro: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
} as const;

export const DEEPSEEK_PEAK_LABEL =
  "工作日 09:00–12:00、14:00–18:00（北京时间）";

function beijingParts(timestamp: number): { day: number; minutes: number } {
  const local = new Date(timestamp);
  const beijing = new Date(
    timestamp + (local.getTimezoneOffset() + 480) * 60_000,
  );
  return {
    day: beijing.getDay(),
    minutes: beijing.getHours() * 60 + beijing.getMinutes(),
  };
}

/** Official DeepSeek peak windows, converted to Beijing time. Holidays are not modeled. */
export function isPeakTime(timestamp: number): boolean {
  const { day, minutes } = beijingParts(timestamp);
  if (day === 0 || day === 6) return false;
  return (
    (minutes >= 9 * 60 && minutes < 12 * 60) ||
    (minutes >= 14 * 60 && minutes < 18 * 60)
  );
}

export function modelPriceKey(providerId?: string | null, modelId?: string | null) {
  return `${providerId ?? ""}::${modelId ?? ""}`;
}

function deepseekRates(modelId?: string | null) {
  return /pro/i.test(modelId ?? "") ? DEEPSEEK_USD.pro : DEEPSEEK_USD.flash;
}

export function isDeepSeekLog(log: UsageLogEntry): boolean {
  return (
    log.providerId === "deepseek" ||
    (!log.providerId && String(log.modelId ?? "").startsWith("deepseek"))
  );
}

export interface LogCost {
  yuan: number;
  known: boolean;
  peak: boolean;
}

export function priceForLog(log: UsageLogEntry, settings: AppSettings): LogCost {
  const peak = isPeakTime(log.createdAt);
  const tokens = log.totalTokens || log.promptTokens + log.completionTokens;
  if (tokens <= 0) return { yuan: 0, known: true, peak };

  if (isDeepSeekLog(log)) {
    const multiplier = peak ? 2 : 1;
    const fx =
      Number.isFinite(settings.usdCnyRate) && settings.usdCnyRate > 0
        ? settings.usdCnyRate
        : DEFAULT_USD_CNY;
    const rates = deepseekRates(log.modelId);
    const hit = Math.max(0, log.promptCacheHitTokens ?? 0);
    const miss = Math.max(0, log.promptCacheMissTokens ?? 0);
    const hasBreakdown = hit + miss > 0;
    const missTokens = hasBreakdown ? miss : Math.max(0, log.promptTokens);
    const hitTokens = hasBreakdown ? hit : 0;
    const yuan =
      ((hitTokens * rates.cacheHit +
        missTokens * rates.cacheMiss +
        Math.max(0, log.completionTokens) * rates.output) *
        multiplier *
        fx) /
      1_000_000;
    return { yuan, known: true, peak };
  }

  const price = settings.modelPrices?.[modelPriceKey(log.providerId, log.modelId)];
  const input = peak ? price?.peakInput ?? 0 : price?.offpeakInput ?? 0;
  const output = peak ? price?.peakOutput ?? 0 : price?.offpeakOutput ?? 0;
  const known = !!price && (input > 0 || output > 0);
  const yuan =
    (Math.max(0, log.promptTokens) * input +
      Math.max(0, log.completionTokens) * output) /
    1_000_000;
  return { yuan, known, peak };
}

export interface UsageCostSummary {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  peakTokens: number;
  offpeakTokens: number;
  peakCost: number;
  offpeakCost: number;
  totalCost: number;
  hasUnknownModel: boolean;
  compactTokens: number;
  memoryTokens: number;
}

export function summarizeUsage(
  logs: UsageLogEntry[],
  settings: AppSettings,
): UsageCostSummary {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let peakTokens = 0;
  let offpeakTokens = 0;
  let peakCost = 0;
  let offpeakCost = 0;
  let hasUnknownModel = false;
  let compactTokens = 0;
  let memoryTokens = 0;

  for (const log of logs) {
    const tokens = log.totalTokens || log.promptTokens + log.completionTokens;
    const cost = priceForLog(log, settings);
    promptTokens += log.promptTokens;
    completionTokens += log.completionTokens;
    totalTokens += tokens;
    if (cost.peak) peakTokens += tokens;
    else offpeakTokens += tokens;
    if (cost.peak) peakCost += cost.yuan;
    else offpeakCost += cost.yuan;
    if (!cost.known && tokens > 0) hasUnknownModel = true;
    if (log.kind === "compact") compactTokens += tokens;
    if (log.kind === "memory") memoryTokens += tokens;
  }

  return {
    totalTokens,
    promptTokens,
    completionTokens,
    peakTokens,
    offpeakTokens,
    peakCost,
    offpeakCost,
    totalCost: peakCost + offpeakCost,
    hasUnknownModel,
    compactTokens,
    memoryTokens,
  };
}

export function formatFen(yuan: number): string {
  const fen = yuan * 100;
  if (!Number.isFinite(fen) || fen <= 0) return "0 分";
  if (fen < 0.01) return "<0.01 分";
  if (fen < 1) return `${fen.toFixed(2)} 分`;
  return `${fen.toFixed(1)} 分`;
}

export function deepseekCnyRows(settings: AppSettings) {
  const fx =
    Number.isFinite(settings.usdCnyRate) && settings.usdCnyRate > 0
      ? settings.usdCnyRate
      : DEFAULT_USD_CNY;
  return [
    {
      label: "Flash",
      offpeakInput: DEEPSEEK_USD.flash.cacheMiss * fx,
      peakInput: DEEPSEEK_USD.flash.cacheMiss * 2 * fx,
      offpeakOutput: DEEPSEEK_USD.flash.output * fx,
      peakOutput: DEEPSEEK_USD.flash.output * 2 * fx,
      offpeakCacheHit: DEEPSEEK_USD.flash.cacheHit * fx,
    },
    {
      label: "V4 Pro",
      offpeakInput: DEEPSEEK_USD.pro.cacheMiss * fx,
      peakInput: DEEPSEEK_USD.pro.cacheMiss * 2 * fx,
      offpeakOutput: DEEPSEEK_USD.pro.output * fx,
      peakOutput: DEEPSEEK_USD.pro.output * 2 * fx,
      offpeakCacheHit: DEEPSEEK_USD.pro.cacheHit * fx,
    },
  ];
}
