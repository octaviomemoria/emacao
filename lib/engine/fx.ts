import type { Candle } from "./types";

/** câmbio diário: data (AAAA-MM-DD) → reais por dólar (fechamento do pregão de câmbio) */
export type FxMap = Record<string, number>;

/**
 * Converte candles de dólar para reais com o câmbio do dia. Em dias sem cotação de câmbio (feriado no Brasil,
 * por exemplo), usa a última cotação anterior: nunca a de um dia futuro. Candles anteriores à primeira cotação
 * são descartados. Volume não muda. Devolve `null` se nada puder ser convertido.
 */
export function convertToBRL(candles: Candle[], fx: FxMap): Candle[] | null {
  const dates = Object.keys(fx).sort();
  if (!dates.length) return null;
  const out: Candle[] = [];
  let k = -1;
  for (const c of candles) {
    while (k + 1 < dates.length && dates[k + 1] <= c.date) k++;
    if (k < 0) continue; // sem câmbio conhecido até esta data
    const rate = fx[dates[k]];
    if (!(rate > 0)) continue;
    out.push({
      date: c.date,
      open: c.open * rate,
      high: c.high * rate,
      low: c.low * rate,
      close: c.close * rate,
      volume: c.volume,
      raw: c.raw ? { open: c.raw.open * rate, high: c.raw.high * rate, low: c.raw.low * rate, close: c.raw.close * rate } : undefined,
    });
  }
  return out.length ? out : null;
}
