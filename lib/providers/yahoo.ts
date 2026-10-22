import type { Candle } from "@/lib/engine/types";

const BRT_OFFSET_MIN = -180;

export interface SplitEvent { date: string; ratio: number } // ratio > 1 desdobramento, < 1 grupamento

export interface YahooResult { candles: Candle[]; splits: SplitEvent[] }

/** data/hora atual em Brasília */
export function nowBRT(now = new Date()): { date: string; minutes: number } {
  const t = new Date(now.getTime() + BRT_OFFSET_MIN * 60000);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

/** descarta o candle de hoje se o pregão ainda não fechou (antes de 18h30 BRT) */
export function dropPartialToday(candles: Candle[], now = new Date()): Candle[] {
  const { date, minutes } = nowBRT(now);
  if (candles.length && candles[candles.length - 1].date === date && minutes < 18 * 60 + 30) return candles.slice(0, -1);
  return candles;
}

/**
 * Candles diários de um símbolo do Yahoo Finance via endpoint "chart": "PETR4.SA" para a B3, "AAPL" para ações
 * americanas, "BRL=X" para o câmbio. Guarda OHLC ajustado (proventos e desdobramentos, para os sinais) e o OHLC bruto
 * (para executar ordens do pregão simulado), além dos eventos de desdobramento/grupamento.
 * Fonte não oficial: por isso o provedor fica isolado aqui.
 */
export async function fetchYahoo(symbol: string, fromDate: string, now = new Date()): Promise<YahooResult> {
  const p1 = Math.floor(Date.parse(fromDate + "T00:00:00Z") / 1000);
  const p2 = Math.floor(now.getTime() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=div%7Csplit&includeAdjustedClose=true`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; bolsa-app)" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`Yahoo ${symbol}: sem dados (${json?.chart?.error?.description ?? "resposta vazia"})`);
  const off: number = r.meta?.gmtoffset ?? BRT_OFFSET_MIN * 60;
  const toDate = (ts: number) => new Date((ts + off) * 1000).toISOString().slice(0, 10);
  const q = r.indicators.quote[0];
  const adj: (number | null)[] | undefined = r.indicators.adjclose?.[0]?.adjclose;
  const out: Candle[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
    if (o == null || h == null || l == null || c == null || !(c > 0)) continue;
    const f = adj && adj[i] != null ? (adj[i] as number) / c : 1;
    out.push({
      date: toDate(r.timestamp[i]),
      open: o * f, high: h * f, low: l * f, close: c * f, volume: v ?? 0,
      raw: { open: o, high: h, low: l, close: c },
    });
  }
  // remove duplicatas de data mantendo a última
  const byDate = new Map(out.map((c) => [c.date, c]));
  const candles = dropPartialToday([...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), now);

  const splitsRaw: Record<string, { date: number; numerator: number; denominator: number }> = r.events?.splits ?? {};
  const splits: SplitEvent[] = Object.values(splitsRaw)
    .filter((s) => s.numerator > 0 && s.denominator > 0)
    .map((s) => ({ date: toDate(s.date), ratio: s.numerator / s.denominator }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { candles, splits };
}
