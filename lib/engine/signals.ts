import type { Anomaly, AssetSignal, Candle, Params, SignalSeries } from "./types";

const NaNv = Number.NaN;

/** maior valor dos n fechamentos ANTERIORES ao dia i (NaN enquanto não há n dias) */
export function rollingMaxPrev(c: number[], n: number): number[] {
  const out = new Array<number>(c.length).fill(NaNv);
  for (let i = n; i < c.length; i++) {
    let m = -Infinity;
    for (let j = i - n; j < i; j++) if (c[j] > m) m = c[j];
    out[i] = m;
  }
  return out;
}

export function rollingMinPrev(c: number[], n: number): number[] {
  const out = new Array<number>(c.length).fill(NaNv);
  for (let i = n; i < c.length; i++) {
    let m = Infinity;
    for (let j = i - n; j < i; j++) if (c[j] < m) m = c[j];
    out[i] = m;
  }
  return out;
}

/** média móvel simples (inclui o dia i); NaN até haver n observações */
export function sma(c: number[], n: number): number[] {
  const out = new Array<number>(c.length).fill(NaNv);
  let sum = 0;
  for (let i = 0; i < c.length; i++) {
    sum += c[i];
    if (i >= n) sum -= c[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Série de sinais, igual à do backtest (swing2.py: state() + família "donchian"). */
export function computeSeries(candles: Candle[], p: Params): SignalSeries {
  const n = candles.length;
  const close = candles.map((c) => c.close);
  const hh = rollingMaxPrev(close, p.N);
  const ll = rollingMinPrev(close, p.M);
  const s200 = sma(close, 200);
  const up200 = close.map((c, i) => !Number.isNaN(s200[i]) && c > s200[i]);

  const state = new Array<number>(n).fill(0);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const entry = !Number.isNaN(hh[i]) && close[i] > hh[i];
    const exit = !Number.isNaN(ll[i]) && close[i] < ll[i];
    if (entry) s = 1;
    else if (exit) s = 0;
    state[i] = p.filter === "up200" ? (s && up200[i] ? 1 : 0) : s;
  }

  // ativo regular: menos de 10% de candles sem variação (máxima == mínima) nos últimos 60 (mín. 20 observações)
  const active = new Array<boolean>(n).fill(false);
  {
    const flat = candles.map((c) => (c.high === c.low ? 1 : 0));
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += flat[i];
      if (i >= 60) sum -= flat[i - 60];
      const cnt = Math.min(i + 1, 60);
      active[i] = cnt >= 20 ? sum / cnt < 0.1 : false;
    }
  }

  // liquidez: média de close*volume dos 60 dias ANTERIORES (mín. 20), 0 se não há histórico
  const liq60 = new Array<number>(n).fill(0);
  {
    const v = candles.map((c) => c.close * c.volume);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      // janela [i-60, i-1]
      if (i >= 1) sum += v[i - 1];
      if (i >= 61) sum -= v[i - 61];
      const cnt = Math.min(i, 60);
      liq60[i] = cnt >= 20 ? sum / cnt : 0;
    }
  }
  return { state, hh, ll, active, liq60, up200 };
}

/** liquidez que valerá no pregão seguinte ao último candle (média dos últimos 60 dias, inclusive o último) */
export function liquidityNext(candles: Candle[], i: number): number {
  const from = Math.max(0, i - 59);
  const cnt = i - from + 1;
  if (cnt < 20) return 0;
  let sum = 0;
  for (let j = from; j <= i; j++) sum += candles[j].close * candles[j].volume;
  return sum / cnt;
}

/** saltos diários acima do limite nos últimos `lookback` candles (provável desdobramento/grupamento mal ajustado) */
export function detectAnomaly(candles: Candle[], limit: number, lookback: number, end = candles.length): Anomaly | null {
  let found: Anomaly | null = null;
  for (let i = Math.max(1, end - lookback); i < end; i++) {
    const r = candles[i].close / candles[i - 1].close - 1;
    if (Math.abs(r) > limit) found = { date: candles[i].date, ret: r };
  }
  return found;
}

export function lastSignal(ticker: string, candles: Candle[], series: SignalSeries, p: Params): AssetSignal {
  const n = candles.length;
  const base = {
    ticker,
    date: n ? candles[n - 1].date : "",
    price: n ? candles[n - 1].close : 0,
    state: 0 as 0 | 1,
    prevState: 0 as 0 | 1,
    isNewBreakout: false,
    isNewExit: false,
    buyLevel: NaNv,
    stopLevel: NaNv,
    distBuyPct: NaNv,
    distStopPct: NaNv,
    daysInState: 0,
    liq60: 0,
    active: false,
    anomaly: null as Anomaly | null,
  };
  if (n < p.N + 5) return { ...base, ok: false, reason: "histórico curto" };
  const i = n - 1;
  const state = series.state[i] as 0 | 1;
  const prevState = series.state[i - 1] as 0 | 1;
  const last = candles[i].close;
  let buyLevel = -Infinity;
  for (let j = i - p.N + 1; j <= i; j++) buyLevel = Math.max(buyLevel, candles[j].close);
  let stopLevel = Infinity;
  for (let j = i - p.M + 1; j <= i; j++) stopLevel = Math.min(stopLevel, candles[j].close);
  let days = 1;
  for (let j = i - 1; j >= 0 && series.state[j] === state; j--) days++;
  const anomaly = detectAnomaly(candles, p.anomalyLimit, p.N + 10);
  return {
    ...base,
    state,
    prevState,
    isNewBreakout: state === 1 && prevState === 0,
    isNewExit: state === 0 && prevState === 1,
    buyLevel,
    stopLevel,
    distBuyPct: buyLevel / last - 1,
    distStopPct: stopLevel / last - 1,
    daysInState: days,
    liq60: liquidityNext(candles, i),
    active: series.active[i],
    anomaly,
    ok: true,
  };
}
