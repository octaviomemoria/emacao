import { randomUUID } from "node:crypto";
import {
  applySplit, newPregaoState, PREGAO_DEFAULT, processPregaoDay,
  type DayInput, type OrderOutcome, type PregaoFill, type PregaoSettings, type PregaoState,
} from "@/lib/engine/pregao";
import type { Candle, Params } from "@/lib/engine/types";
import type { SplitEvent } from "@/lib/providers/yahoo";
import type { Store } from "@/lib/store/types";

export interface PregaoRunResult {
  initialized: boolean;
  sessions: string[]; // pregões processados nesta rodada
  outcomes: OrderOutcome[];
  splitsApplied: { ticker: string; date: string; ratio: number }[];
}

/** Garante o estado da carteira (cria com o capital informado, se não existir). */
export async function ensurePregaoState(store: Store, capital: number, date: string, pid = PREGAO_DEFAULT): Promise<PregaoState> {
  const st = await store.getPregao(pid);
  if (st) return st;
  const created = newPregaoState(date, capital);
  await store.savePregao(created, pid);
  return created;
}

/**
 * Executa as ordens de uma carteira de pregão para cada pregão novo presente nos dados desta rodada.
 * Ordens de tickers sem dados nesta rodada continuam abertas. Ordens de tickers com dados mas sem
 * candle naquele pregão encerram como "sem negociação".
 */
export async function runPregaoJob(
  store: Store,
  args: {
    pid?: string;
    data: Map<string, Candle[]>;
    splits: Map<string, SplitEvent[]>;
    refDate: string;
    pregao: PregaoSettings;
    params: Params;
    cdiMap: Map<string, number>;
    now: Date;
  },
): Promise<PregaoRunResult> {
  const pid = args.pid ?? PREGAO_DEFAULT;
  const existed = (await store.getPregao(pid)) !== null;
  const st = await ensurePregaoState(store, args.pregao.capital, args.refDate, pid);
  const result: PregaoRunResult = { initialized: !existed, sessions: [], outcomes: [], splitsApplied: [] };

  const dateSet = new Set<string>();
  const indexOf = new Map<string, Map<string, number>>();
  for (const [ticker, candles] of args.data) {
    const idx = new Map<string, number>();
    candles.forEach((c, i) => { idx.set(c.date, i); if (c.date > st.lastDate && c.date <= args.refDate) dateSet.add(c.date); });
    indexOf.set(ticker, idx);
  }
  const sessions = [...dateSet].sort();
  if (!sessions.length) return result;

  let orders = await store.listOrders(pid);
  const fills: PregaoFill[] = [];
  const outcomes: OrderOutcome[] = [];

  for (const d of sessions) {
    // desdobramentos/grupamentos do dia ajustam posições antes das ordens
    for (const [ticker, list] of args.splits) {
      for (const s of list) {
        if (s.date !== d) continue;
        applySplit(st, ticker, s.ratio);
        result.splitsApplied.push({ ticker, date: d, ratio: s.ratio });
      }
    }

    const inputs = new Map<string, DayInput | undefined>();
    for (const [ticker, candles] of args.data) {
      const i = indexOf.get(ticker)?.get(d);
      if (i === undefined) { inputs.set(ticker, undefined); continue; }
      const c = candles[i];
      const prev = i > 0 ? candles[i - 1] : undefined;
      const prevRaw = prev ? (prev.raw?.close ?? prev.close) : 0;
      const anomaly = !!prev && prev.close > 0 && Math.abs(c.close / prev.close - 1) > args.params.anomalyLimit;
      const b = c.raw ?? { open: c.open, high: c.high, low: c.low, close: c.close };
      inputs.set(ticker, {
        bar: { open: b.open, high: b.high, low: b.low, close: b.close, volume: c.volume },
        prevClose: prevRaw,
        hasRaw: !!c.raw,
        anomaly,
      });
    }

    const r = processPregaoDay(
      st, orders, d, inputs, args.pregao,
      { cdiRate: args.cdiMap.get(d) ?? 0, cdiTaxRate: args.params.cdiTaxRate, taxRate: args.params.taxRate },
      randomUUID,
    );
    orders = r.orders;
    fills.push(...r.fills);
    outcomes.push(...r.outcomes);
    result.sessions.push(d);
  }

  await store.savePregao(st, pid);
  await store.upsertOrders(outcomes.map((o) => ({ ...o.order, portfolioId: pid })));
  await store.addFills(fills.map((f) => ({ ...f, portfolioId: pid })));
  result.outcomes = outcomes.map((o) => ({ ...o, order: { ...o.order, portfolioId: pid } }));
  return result;
}
