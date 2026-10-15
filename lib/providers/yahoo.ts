import type { Candle } from "@/lib/engine/types";

const BRT_OFFSET_MIN = -180;

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
 * Candles diários ajustados (proventos e desdobramentos) de um ticker da B3 via endpoint "chart" do Yahoo Finance.
 * Fonte não oficial: pode mudar ou limitar acessos — por isso o provedor fica isolado aqui.
 */
export async function fetchYahoo(ticker: string, fromDate: string, now = new Date()): Promise<Candle[]> {
  const p1 = Math.floor(Date.parse(fromDate + "T00:00:00Z") / 1000);
  const p2 = Math.floor(now.getTime() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.SA?period1=${p1}&period2=${p2}&interval=1d&events=div%7Csplit&includeAdjustedClose=true`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; bolsa-app)" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Yahoo ${ticker}: HTTP ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`Yahoo ${ticker}: sem dados (${json?.chart?.error?.description ?? "resposta vazia"})`);
  const off: number = r.meta?.gmtoffset ?? BRT_OFFSET_MIN * 60;
  const q = r.indicators.quote[0];
  const adj: (number | null)[] | undefined = r.indicators.adjclose?.[0]?.adjclose;
  const out: Candle[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
    if (o == null || h == null || l == null || c == null || !(c > 0)) continue;
    const f = adj && adj[i] != null ? (adj[i] as number) / c : 1;
    out.push({
      date: new Date((r.timestamp[i] + off) * 1000).toISOString().slice(0, 10),
      open: o * f, high: h * f, low: l * f, close: c * f, volume: v ?? 0,
    });
  }
  // remove duplicatas de data mantendo a última
  const byDate = new Map(out.map((c) => [c.date, c]));
  return dropPartialToday([...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), now);
}
