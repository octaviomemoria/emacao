import { computeSeries, lastSignal } from "@/lib/engine/signals";
import { buildAsset, buildUniverse, runUntil, startSim, equityAt } from "@/lib/engine/simulation";
import { realPositions } from "@/lib/engine/real";
import type { AssetSignal, Candle } from "@/lib/engine/types";
import { fetchCdi } from "@/lib/providers/bcb";
import { fetchYahoo, nowBRT, type SplitEvent } from "@/lib/providers/yahoo";
import { notifyAll, type NotifyResult } from "@/lib/notify/dispatch";
import type { AlertItem, Store } from "@/lib/store/types";
import { runPregaoJob } from "@/lib/jobs/pregao";
import type { OrderOutcome } from "@/lib/engine/pregao";

type NewAlert = Omit<AlertItem, "id" | "createdAt" | "read">;

export interface DailyResult {
  refDate: string;
  assets: number;
  skipped: { ticker: string; reason: string }[];
  newAlerts: number;
  notify: NotifyResult[];
  simEquity: number;
  pregao: { sessions: number; executed: number; closedWithoutFill: number };
}

/** alertas das ordens do pregão simulado processadas nesta rodada */
function pregaoAlerts(outcomes: OrderOutcome[], gapPct: number, prefix = ""): NewAlert[] {
  const out: NewAlert[] = [];
  for (const { order: o } of outcomes) {
    const tipo = o.type === "MARKET" ? "a mercado" : o.type === "LIMIT" ? `limite ${brl(o.limitPrice ?? 0)}` : `stop ${brl(o.stopPrice ?? 0)}`;
    const head = `${prefix}${o.side === "BUY" ? "Compra" : "Venda"} ${o.ticker} (${tipo}, ${o.qty} ações)`;
    const sess = o.sessionDate ?? "";
    if (o.status === "EXECUTED" || o.status === "PARTIAL") {
      out.push({
        type: o.status === "EXECUTED" ? "PREGAO_EXECUTADA" : "PREGAO_PARCIAL", ticker: o.ticker, dedupe: `PREG:${o.id}:${o.status}`,
        title: `${head}: ${o.filledQty} executada(s) a ${brl(o.avgPrice)}`,
        body: `pregão ${sess} · taxas ${brl(o.fees)}${o.reason ? ` · ${o.reason}` : ""}`,
      });
    } else if (o.status === "BLOCKED") {
      out.push({ type: "PREGAO_BLOQUEADA", ticker: o.ticker, dedupe: `PREG:${o.id}:BLOCKED`, title: `${head}: bloqueada`, body: `pregão ${sess} · ${o.reason ?? ""}` });
    } else if (o.status === "NOT_EXECUTED") {
      out.push({ type: "PREGAO_NAO_EXECUTADA", ticker: o.ticker, dedupe: `PREG:${o.id}:NOT`, title: `${head}: não executada`, body: `pregão ${sess} · ${o.reason ?? ""} · validade do dia encerrada` });
    }
    if (o.type === "MARKET" && o.gap !== undefined && Math.abs(o.gap) >= gapPct) {
      out.push({ type: "PREGAO_GAP", ticker: o.ticker, dedupe: `PGAP:${o.id}`, title: `${prefix}${o.ticker}: abertura com gap de ${pct(o.gap)}`, body: `pregão ${sess} · a execução a mercado pode ter ficado distante do fechamento anterior` });
    }
  }
  return out;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d).replace(".", ",")}%`;

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

/** Rotina noturna: baixa preços, calcula sinais, avança a carteira simulada, gera e envia alertas. */
export async function runDaily(store: Store, opts: { now?: Date; notify?: boolean } = {}): Promise<DailyResult> {
  const now = opts.now ?? new Date();
  const settings = await store.getSettings();
  const p = settings.params;
  const assets = (await store.getAssets()).filter((a) => a.enabled);
  const from = new Date(now.getTime() - settings.historyYears * 365.25 * 86400000).toISOString().slice(0, 10);

  // 1) preços (re-baixa o período inteiro: os ajustes por proventos mudam o histórico)
  const skipped: { ticker: string; reason: string }[] = [];
  const data = new Map<string, Candle[]>();
  const splits = new Map<string, SplitEvent[]>();
  await pool(assets, 6, async (a) => {
    try {
      const r = await fetchYahoo(a.ticker, from, now);
      const c = r.candles;
      if (c.length) { data.set(a.ticker, c); splits.set(a.ticker, r.splits); await store.savePrices(a.ticker, c); return; }
      throw new Error("sem candles");
    } catch (e) {
      const stored = await store.getPrices(a.ticker);
      if (stored.length) { data.set(a.ticker, stored); skipped.push({ ticker: a.ticker, reason: `download falhou, usando dados salvos (${(e as Error).message})` }); }
      else skipped.push({ ticker: a.ticker, reason: `sem dados (${(e as Error).message})` });
    }
  });

  // 2) CDI
  let cdi = await store.getCdi();
  try {
    const last = Object.keys(cdi).sort().pop();
    const start = last ? new Date(Date.parse(last) + 86400000).toISOString().slice(0, 10) : from;
    const today = nowBRT(now).date;
    if (start <= today) {
      cdi = { ...cdi, ...(await fetchCdi(start, today)) };
      await store.saveCdi(cdi);
    }
  } catch (e) {
    skipped.push({ ticker: "CDI", reason: `falha ao baixar CDI (${(e as Error).message})` });
  }
  const cdiMap = new Map(Object.entries(cdi));

  // 3) sinais
  const dates = [...data.values()].map((c) => c[c.length - 1].date).sort();
  const refDate = dates.length ? dates[dates.length - 1] : "";
  if (!refDate) throw new Error("nenhum dado de preço disponível");
  const signals: AssetSignal[] = [];
  const valid = [];
  for (const a of assets) {
    const c = data.get(a.ticker);
    if (!c) continue;
    const staleDays = (Date.parse(refDate) - Date.parse(c[c.length - 1].date)) / 86400000;
    if (staleDays > settings.maxStaleDays) { skipped.push({ ticker: a.ticker, reason: `desatualizado (último candle ${c[c.length - 1].date})` }); continue; }
    if (c.length < p.N + 5) { skipped.push({ ticker: a.ticker, reason: "histórico curto" }); continue; }
    const series = computeSeries(c, p);
    signals.push(lastSignal(a.ticker, c, series, p));
    valid.push(buildAsset(a.ticker, c, series));
  }
  const u = buildUniverse(valid);
  await store.saveSnapshot({ date: refDate, generatedAt: new Date().toISOString(), signals, skipped });

  // 4) carteira simulada
  const bova = data.get("BOVA11");
  const bovaByDate = bova ? new Map(bova.map((c) => [c.date, c.close])) : undefined;
  let sim = await store.getSim();
  if (!sim) sim = startSim(u, refDate, settings.simCapital, p);
  else sim = runUntil(sim, u, refDate, cdiMap, p, bovaByDate);
  await store.saveSim(sim);
  const equity = equityAt(sim, u, refDate);

  // 4b) pregão simulado: executa as ordens digitadas pelo usuário contra a faixa do pregão
  const pregaoRun = await runPregaoJob(store, { data, splits, refDate, pregao: settings.pregao, params: p, cdiMap, now });
  const pregaoSummary = {
    sessions: pregaoRun.sessions.length,
    executed: pregaoRun.outcomes.filter((o) => o.order.status === "EXECUTED" || o.order.status === "PARTIAL").length,
    closedWithoutFill: pregaoRun.outcomes.filter((o) => o.order.status === "NOT_EXECUTED" || o.order.status === "BLOCKED").length,
  };

  // 4c) carteiras simuladas: a mesma regra de execução, com capital e parâmetros de cada carteira
  const carteiras = await store.listCarteiras();
  const carteiraRuns: { name: string; params: typeof settings.pregao; outcomes: OrderOutcome[] }[] = [];
  for (const c of carteiras) {
    const r = await runPregaoJob(store, { pid: c.id, data, splits, refDate, pregao: c.params, params: p, cdiMap, now });
    carteiraRuns.push({ name: c.name, params: c.params, outcomes: r.outcomes });
  }

  // 5) alertas
  const prefs = settings.alertPrefs;
  const items: NewAlert[] = [];
  const sigBy = new Map(signals.map((s) => [s.ticker, s]));
  for (const o of sim.pending) {
    if (o.side === "BUY" && !o.waiting && prefs.buy) {
      const lossPct = o.stopLevel && o.valueBRL ? (o.valueBRL * (1 - o.stopLevel / o.refPrice)) / equity : 0;
      items.push({
        type: "BUY", ticker: o.ticker, dedupe: `BUY:${o.ticker}:${refDate}`,
        title: `COMPRAR ${o.ticker} na abertura${o.isNew ? " (rompimento novo)" : ""}`,
        body: `ref. ${brl(o.refPrice)} · 10% ≈ ${brl(o.valueBRL ?? 0)} (~${o.qtyApprox} ações) · sai se fechar < ${brl(o.stopLevel ?? 0)} (perda até lá ≈ ${pct(lossPct)} do patrimônio${lossPct > settings.riskCapPct ? " ⚠ acima do teto" : ""})`,
      });
    }
    if (o.side === "SELL" && prefs.sell) {
      items.push({ type: "SELL", ticker: o.ticker, dedupe: `SELL:${o.ticker}:${refDate}`, title: `VENDER ${o.ticker} na abertura (saída acionada)`, body: `fechou em ${brl(o.refPrice)}, abaixo da mínima de ${p.M} dias (carteira simulada)` });
    }
  }
  if (prefs.simClosed) {
    for (const t of sim.trades.filter((x) => x.exitDate === refDate)) {
      items.push({ type: "SIM_CLOSED", ticker: t.ticker, dedupe: `SIMC:${t.ticker}:${t.exitDate}`, title: `Simulação: ${t.ticker} encerrada (${t.ret >= 0 ? "+" : ""}${pct(t.ret)})`, body: `entrada ${t.entryDate} a ${brl(t.entryPrice)} · saída ${t.exitDate} a ${brl(t.exitPrice)} · ${t.days} dias` });
    }
  }
  const txs = await store.listTx();
  const real = realPositions(txs);
  if (prefs.sell) {
    for (const rp of real) {
      const s = sigBy.get(rp.ticker);
      if (s && s.state === 0) items.push({ type: "REAL_SELL", ticker: rp.ticker, dedupe: `REAL:${rp.ticker}:${refDate}`, title: `VENDER ${rp.ticker} (sua carteira)`, body: `sinal de saída: fechou abaixo da mínima de ${p.M} dias (R$ ${s.stopLevel.toFixed(2)}) · você tem ${rp.qty} a preço médio ${brl(rp.avgCost)}` });
    }
  }
  if (prefs.divergence && txs.length) {
    const realSet = new Set(real.map((r) => r.ticker));
    for (const pos of sim.positions) {
      if (!realSet.has(pos.ticker)) items.push({ type: "DIVERGENCE", ticker: pos.ticker, dedupe: `DIV:${pos.ticker}:${pos.entryDate}`, title: `Divergência: a simulação tem ${pos.ticker}, você não`, body: `simulada desde ${pos.entryDate} a ${brl(pos.entryPrice)}` });
    }
  }
  if (prefs.nearTrigger) {
    for (const s of signals) {
      if (s.state === 0 && s.ok && s.distBuyPct <= settings.nearTriggerPct && s.active) {
        items.push({ type: "NEAR_TRIGGER", ticker: s.ticker, dedupe: `NEAR:${s.ticker}:${refDate}`, title: `${s.ticker} perto do gatilho (+${pct(s.distBuyPct)})`, body: `comprar se fechar acima de ${brl(s.buyLevel)}` });
      }
    }
  }
  if (prefs.dataIssue) {
    for (const s of signals) {
      if (s.anomaly) items.push({ type: "DATA_ISSUE", ticker: s.ticker, dedupe: `ANOM:${s.ticker}:${s.anomaly.date}`, title: `Dado suspeito em ${s.ticker}`, body: `variação de ${pct(s.anomaly.ret)} em ${s.anomaly.date}: possível desdobramento/grupamento mal ajustado. Compras automáticas dele ficam bloqueadas por ${p.N + 10} pregões.` });
    }
    for (const k of skipped) items.push({ type: "DATA_ISSUE", ticker: k.ticker, dedupe: `DATA:${k.ticker}:${k.reason.slice(0, 20)}:${refDate.slice(0, 7)}`, title: `Dados de ${k.ticker}: ${k.reason}`, body: "ativo ignorado ou com dados antigos nesta rodada" });
  }
  items.push(...pregaoAlerts(pregaoRun.outcomes, settings.pregao.gapPct));
  for (const cr of carteiraRuns) items.push(...pregaoAlerts(cr.outcomes, cr.params.gapPct, `[${cr.name}] `));
  const fresh = await store.addAlerts(items);
  const sent = opts.notify === false ? [] : await notifyAll(store, fresh);
  const carteiraExec = carteiraRuns.reduce((a, cr) => a + cr.outcomes.filter((o) => o.order.status === "EXECUTED" || o.order.status === "PARTIAL").length, 0);
  const pregaoTxt = pregaoSummary.sessions ? ` · pregão simulado: ${pregaoSummary.sessions} sessão(ões), ${pregaoSummary.executed} execução(ões)` : "";
  const carteiraTxt = carteiras.length ? ` · carteiras simuladas: ${carteiras.length}, ${carteiraExec} execução(ões)` : "";
  await store.appendJobLog({ at: new Date().toISOString(), job: "daily", ok: true, message: `ref ${refDate} · ${valid.length} ativos · ${fresh.length} alertas novos · patrimônio simulado ${brl(equity)}${pregaoTxt}${carteiraTxt}` });
  return { refDate, assets: valid.length, skipped, newAlerts: fresh.length, notify: sent, simEquity: equity, pregao: pregaoSummary };
}

/** Lembrete da manhã: lista o que a rotina noturna deixou pendente para a abertura de hoje. */
export async function runMorning(store: Store, now = new Date()): Promise<{ sent: number; notify: NotifyResult[] }> {
  const sim = await store.getSim();
  const snap = await store.getSnapshot();
  const today = nowBRT(now).date;
  const dow = new Date(today + "T12:00:00Z").getUTCDay();
  if (!sim || !snap || dow === 0 || dow === 6 || snap.date >= today) return { sent: 0, notify: [] };
  const buys = sim.pending.filter((o) => o.side === "BUY" && !o.waiting);
  const sells = sim.pending.filter((o) => o.side === "SELL");
  if (!buys.length && !sells.length) return { sent: 0, notify: [] };
  const lines = [...sells.map((o) => `VENDER ${o.ticker}`), ...buys.map((o) => `COMPRAR ${o.ticker} (~${o.qtyApprox} ações)`)];
  const [item] = await store.addAlerts([{ type: "INFO", dedupe: `MORNING:${today}`, title: `Hoje na abertura (${snap.date}): ${lines.length} ordem(ns)`, body: lines.join(" · ") }]);
  if (!item) return { sent: 0, notify: [] };
  return { sent: 1, notify: await notifyAll(store, [item]) };
}
