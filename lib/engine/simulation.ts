/**
 * Carteira simulada (a que "deveria estar aberta"), espelhando bolsa/swing4.py::sim:
 *  - sinal no fechamento de t-1, ordem na abertura de t;
 *  - posição = frac × patrimônio do fechamento anterior, no máximo maxPos posições;
 *  - com mais sinais que vagas, entram os mais líquidos; posições abertas nunca são trocadas;
 *  - custo proporcional por lado + R$ por ordem; IR sobre lucro realizado por mês, com compensação de prejuízo;
 *  - o que não está em ações rende CDI líquido de imposto.
 * Diferença deliberada em relação ao Python: aqui as compras são em AÇÕES INTEIRAS e a posição flutua
 * (no Python a posição é um valor fixo em R$). As datas de compra/venda coincidem; o patrimônio difere pouco.
 */
import { detectAnomaly, liquidityNext } from "./signals";
import type { Candle, Params, PendingOrder, Position, SignalSeries, SimState, Trade } from "./types";

export interface AssetData {
  ticker: string;
  candles: Candle[];
  series: SignalSeries;
  idxByDate: Map<string, number>;
}

export interface Universe {
  assets: Map<string, AssetData>;
  dates: string[]; // união ordenada dos pregões
}

export function buildAsset(ticker: string, candles: Candle[], series: SignalSeries): AssetData {
  const idxByDate = new Map<string, number>();
  candles.forEach((c, i) => idxByDate.set(c.date, i));
  return { ticker, candles, series, idxByDate };
}

export function buildUniverse(list: AssetData[]): Universe {
  const set = new Set<string>();
  const assets = new Map<string, AssetData>();
  for (const a of list) {
    assets.set(a.ticker, a);
    for (const c of a.candles) set.add(c.date);
  }
  return { assets, dates: [...set].sort() };
}

export function newSimState(startDate: string, capital: number): SimState {
  return {
    startDate,
    initialCapital: capital,
    lastDate: startDate,
    cash: capital,
    positions: [],
    trades: [],
    realizedMonth: 0,
    lossCarry: 0,
    taxPaidTotal: 0,
    feesPaidTotal: 0,
    curve: [{ date: startDate, equity: capital, cdiNet: capital }],
    pending: [],
    cdiIndex: 1,
  };
}

/** índice do último candle com data <= d (ou -1) */
function idxAtOrBefore(a: AssetData, d: string): number {
  const exact = a.idxByDate.get(d);
  if (exact !== undefined) return exact;
  let lo = 0, hi = a.candles.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a.candles[mid].date <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function closeOn(u: Universe, ticker: string, d: string): number | null {
  const a = u.assets.get(ticker);
  if (!a) return null;
  const i = idxAtOrBefore(a, d);
  return i >= 0 ? a.candles[i].close : null;
}

export function equityAt(sim: SimState, u: Universe, d: string): number {
  let v = sim.cash;
  for (const p of sim.positions) v += p.qty * (closeOn(u, p.ticker, d) ?? p.entryPrice);
  return v;
}

/** alvo (0/1) decidido no fechamento do candle i do ativo */
function targetAt(a: AssetData, i: number): number {
  return i >= 0 && a.series.active[i] ? a.series.state[i] : 0;
}

const monthOf = (d: string) => d.slice(0, 7);

/** processa UM pregão `date` (ordens executadas na abertura; marcação a mercado no fechamento) */
export function processDay(
  prev: SimState,
  date: string,
  prevDate: string,
  u: Universe,
  cdiRate: number,
  p: Params,
  bovaClose?: number,
): SimState {
  const sim: SimState = {
    ...prev,
    positions: prev.positions.map((x) => ({ ...x })),
    trades: [...prev.trades],
    curve: [...prev.curve],
  };

  // imposto do mês anterior é pago na virada do mês
  if (monthOf(date) !== monthOf(prev.lastDate)) {
    const r = sim.realizedMonth;
    if (r > 0) {
      const use = Math.min(sim.lossCarry, r);
      sim.lossCarry -= use;
      const tax = p.taxRate * (r - use);
      sim.cash -= tax;
      sim.taxPaidTotal += tax;
    } else if (r < 0) {
      sim.lossCarry += -r;
    }
    sim.realizedMonth = 0;
  }

  const v0 = equityAt(sim, u, prevDate); // patrimônio no fechamento anterior

  // 1) saídas na abertura
  const held = new Map(sim.positions.map((x) => [x.ticker, x]));
  const remaining: Position[] = [];
  for (const pos of sim.positions) {
    const a = u.assets.get(pos.ticker);
    const i = a?.idxByDate.get(date);
    if (!a || i === undefined) { remaining.push(pos); continue; } // sem pregão: mantém
    const target = targetAt(a, i - 1);
    if (target === 0) {
      const px = a.candles[i].open;
      const gross = pos.qty * px;
      const cost = p.costSide * gross + p.fixedFee;
      sim.cash += gross - cost;
      sim.feesPaidTotal += cost;
      const pnl = gross - cost - pos.basis;
      sim.realizedMonth += pnl;
      sim.trades.push({
        ticker: pos.ticker, entryDate: pos.entryDate, exitDate: date, entryPrice: pos.entryPrice, exitPrice: px,
        qty: pos.qty, pnl, ret: pnl / pos.basis,
        days: Math.round((Date.parse(date) - Date.parse(pos.entryDate)) / 86400000),
      } satisfies Trade);
      held.delete(pos.ticker);
    } else remaining.push(pos);
  }
  sim.positions = remaining;

  // 2) entradas na abertura
  const free = p.maxPos - sim.positions.length;
  if (free > 0) {
    const cands: { a: AssetData; i: number; liq: number }[] = [];
    for (const a of u.assets.values()) {
      if (held.has(a.ticker)) continue;
      const i = a.idxByDate.get(date);
      if (i === undefined || i < 1) continue;
      if (targetAt(a, i - 1) !== 1 || !a.series.active[i]) continue;
      if (detectAnomaly(a.candles, p.anomalyLimit, p.N + 10, i)) continue; // dado suspeito: não compra
      cands.push({ a, i, liq: a.series.liq60[i] });
    }
    cands.sort((x, y) => y.liq - x.liq);
    for (const c of cands.slice(0, free)) {
      const px = c.a.candles[c.i].open;
      let qty = Math.floor((p.frac * v0) / px);
      const unit = px * (1 + p.costSide);
      const affordable = Math.floor((sim.cash - p.fixedFee) / unit);
      qty = Math.min(qty, affordable);
      if (qty < 1) continue;
      const gross = qty * px;
      const cost = p.costSide * gross + p.fixedFee;
      sim.cash -= gross + cost;
      sim.feesPaidTotal += cost;
      sim.positions.push({ ticker: c.a.ticker, qty, entryDate: date, entryPrice: px, basis: gross + cost });
    }
  }

  // 3) rendimento do caixa (CDI líquido) e marcação a mercado no fechamento
  if (sim.cash > 0) sim.cash += sim.cash * cdiRate * (1 - p.cdiTaxRate);
  sim.cdiIndex *= 1 + cdiRate * (1 - p.cdiTaxRate);
  const equity = equityAt(sim, u, date);
  sim.lastDate = date;
  sim.curve.push({ date, equity, cdiNet: sim.initialCapital * sim.cdiIndex, bova: bovaClose });
  sim.pending = computePending(sim, u, date, p);
  return sim;
}

/** ordens para a próxima abertura, com base nos sinais do fechamento `date` */
export function computePending(sim: SimState, u: Universe, date: string, p: Params): PendingOrder[] {
  const out: PendingOrder[] = [];
  const equity = equityAt(sim, u, date);
  const heldSet = new Set(sim.positions.map((x) => x.ticker));
  let sells = 0;
  for (const pos of sim.positions) {
    const a = u.assets.get(pos.ticker);
    if (!a) continue;
    const i = idxAtOrBefore(a, date);
    if (i < 0) continue;
    if (targetAt(a, i) === 0) {
      sells++;
      out.push({ side: "SELL", ticker: pos.ticker, signalDate: date, refPrice: a.candles[i].close, qtyApprox: pos.qty });
    }
  }
  const free = p.maxPos - (sim.positions.length - sells);
  const cands: { a: AssetData; i: number; liq: number; isNew: boolean }[] = [];
  for (const a of u.assets.values()) {
    if (heldSet.has(a.ticker)) continue;
    const i = a.idxByDate.get(date);
    if (i === undefined || i < 1) continue;
    if (targetAt(a, i) !== 1) continue;
    if (detectAnomaly(a.candles, p.anomalyLimit, p.N + 10, i + 1)) continue;
    cands.push({ a, i, liq: liquidityNext(a.candles, i), isNew: a.series.state[i - 1] === 0 });
  }
  cands.sort((x, y) => y.liq - x.liq);
  cands.forEach((c, k) => {
    const px = c.a.candles[c.i].close;
    let stop = Infinity;
    for (let j = Math.max(0, c.i - p.M + 1); j <= c.i; j++) stop = Math.min(stop, c.a.candles[j].close);
    const value = p.frac * equity;
    out.push({
      side: "BUY", ticker: c.a.ticker, signalDate: date, refPrice: px, valueBRL: value,
      qtyApprox: Math.floor(value / px), stopLevel: stop, isNew: c.isNew, waiting: k >= Math.max(0, free),
    });
  });
  return out;
}

/** inicia uma simulação "no fechamento de startDate" (sem posições) e já calcula as ordens da abertura seguinte */
export function startSim(u: Universe, startDate: string, capital: number, p: Params): SimState {
  const sim = newSimState(startDate, capital);
  sim.pending = computePending(sim, u, startDate, p);
  return sim;
}

/** roda dia a dia de (lastDate, endDate]; cdiByDate: taxa diária bruta (ex.: 0.0005) */
export function runUntil(
  sim0: SimState,
  u: Universe,
  endDate: string,
  cdiByDate: Map<string, number>,
  p: Params,
  bovaByDate?: Map<string, number>,
): SimState {
  let sim = sim0;
  let prevDate = sim.lastDate;
  let lastCdi = 0;
  for (const d of u.dates) {
    if (d <= sim0.lastDate) continue;
    if (d > endDate) break;
    const cdi = cdiByDate.get(d) ?? lastCdi;
    lastCdi = cdi;
    sim = processDay(sim, d, prevDate, u, cdi, p, bovaByDate?.get(d));
    prevDate = d;
  }
  return sim;
}

/** patrimônio se tudo fosse vendido hoje, depois do IR sobre o lucro não realizado */
export function equityAfterLiquidation(sim: SimState, u: Universe, p: Params): number {
  const eq = equityAt(sim, u, sim.lastDate);
  let unreal = 0;
  let fees = 0;
  for (const pos of sim.positions) {
    const px = closeOn(u, pos.ticker, sim.lastDate) ?? pos.entryPrice;
    const gross = pos.qty * px;
    const cost = p.costSide * gross + p.fixedFee;
    unreal += gross - cost - pos.basis;
    fees += cost;
  }
  const net = sim.realizedMonth + unreal;
  const taxable = Math.max(0, net - sim.lossCarry);
  return eq - fees - p.taxRate * taxable;
}

export function simMetrics(sim: SimState) {
  const t = sim.trades;
  const wins = t.filter((x) => x.ret > 0);
  const losses = t.filter((x) => x.ret <= 0);
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  let peak = -Infinity, mdd = 0;
  for (const c of sim.curve) { peak = Math.max(peak, c.equity); mdd = Math.min(mdd, c.equity / peak - 1); }
  const last = sim.curve[sim.curve.length - 1];
  return {
    trades: t.length,
    hitRate: t.length ? wins.length / t.length : 0,
    avgWin: avg(wins.map((x) => x.ret)),
    avgLoss: avg(losses.map((x) => x.ret)),
    avgDays: avg(t.map((x) => x.days)),
    maxDrawdown: mdd,
    returnTotal: last.equity / sim.initialCapital - 1,
    cdiTotal: last.cdiNet / sim.initialCapital - 1,
  };
}
