import { randomUUID } from "node:crypto";
import { DEFAULT_PREGAO, newPregaoState, PREGAO_DEFAULT, type PregaoOrder, type PregaoSettings } from "@/lib/engine/pregao";
import { ensurePregaoState } from "@/lib/jobs/pregao";
import { nowBRT } from "@/lib/providers/yahoo";
import type { Carteira, Store } from "@/lib/store/types";

export const brlTxt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface OrderInput {
  ticker: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP";
  qty: number;
  limitPrice?: number;
  stopPrice?: number;
}

/** parâmetros da carteira: os da carteira padrão (Pregão) ou os da carteira simulada */
export async function getParams(store: Store, pid: string): Promise<PregaoSettings | null> {
  if (pid === PREGAO_DEFAULT) return (await store.getSettings()).pregao;
  const c = (await store.listCarteiras()).find((x) => x.id === pid);
  // carteiras criadas antes de um parâmetro existir recebem o padrão para ele
  return c ? { ...DEFAULT_PREGAO, ...c.params } : null;
}

/** valida e registra uma ordem; devolve a mensagem de erro, ou null se registrou */
export async function placeOrder(store: Store, pid: string, pg: PregaoSettings, input: OrderInput, today = nowBRT().date): Promise<string | null> {
  const { ticker, side, type, qty, limitPrice, stopPrice } = input;
  if (!/^[A-Z0-9]{4,6}$/.test(ticker)) return "Informe um ticker válido.";
  const assets = await store.getAssets();
  if (!assets.some((a) => a.enabled && a.ticker === ticker)) return `${ticker} não está na lista de ativos acompanhados (Configurações).`;
  if (!(qty > 0)) return "A quantidade deve ser um número inteiro maior que zero.";
  if (type === "LIMIT" && !(limitPrice && limitPrice > 0)) return "Informe o preço limite.";
  if (type === "STOP") {
    if (side !== "SELL") return "Stop só existe para venda.";
    if (!(stopPrice && stopPrice > 0)) return "Informe o preço de stop.";
  }

  const candles = await store.getPrices(ticker);
  const last = candles[candles.length - 1];
  if (!last) return "Sem preços salvos para este ativo. Rode a atualização primeiro.";
  const ref = last.raw?.close ?? last.close;

  const st = await ensurePregaoState(store, pg.capital, today, pid);
  const open = (await store.listOrders(pid)).filter((o) => o.status === "OPEN");

  // preço estimado para reservar caixa/quantidade
  const estPrice = type === "LIMIT" ? (limitPrice as number) : type === "STOP" ? (stopPrice as number)
    : side === "BUY" ? ref * (1 + pg.slippage) : ref * (1 - pg.slippage);
  const reservedCash = open.filter((o) => o.side === "BUY").reduce((a, o) => a + (o.qty * (o.estPrice ?? 0)) * (1 + pg.feePct) + pg.fixedFee, 0);
  const cashAvail = st.cash - reservedCash;
  const heldQty = st.positions.find((p) => p.ticker === ticker)?.qty ?? 0;
  const reservedSell = open.filter((o) => o.side === "SELL" && o.ticker === ticker).reduce((a, o) => a + o.qty, 0);

  if (side === "BUY") {
    const cost = qty * estPrice * (1 + pg.feePct) + pg.fixedFee;
    if (cost > cashAvail) return `Saldo insuficiente: custo estimado ${brlTxt(cost)}, disponível ${brlTxt(Math.max(0, cashAvail))}.`;
  } else if (qty > heldQty - reservedSell) {
    return `Você tem ${heldQty} ação(ões) de ${ticker}, sendo ${reservedSell} já reservada(s) em ordens abertas.`;
  }

  const order: PregaoOrder = {
    id: randomUUID(),
    portfolioId: pid,
    createdAt: new Date().toISOString(),
    createdDate: today,
    ticker,
    side,
    type,
    qty,
    limitPrice: type === "LIMIT" ? limitPrice : undefined,
    stopPrice: type === "STOP" ? stopPrice : undefined,
    estPrice,
    status: "OPEN",
    filledQty: 0,
    avgPrice: 0,
    fees: 0,
  };
  await store.upsertOrders([order]);
  return null;
}

/** cancela uma ordem enquanto ela ainda não foi processada */
export async function cancelOrder(store: Store, pid: string, id: string) {
  const o = (await store.listOrders(pid)).find((x) => x.id === id);
  if (!o || o.status !== "OPEN") return;
  await store.upsertOrders([{ ...o, portfolioId: pid, status: "CANCELLED", reason: "cancelada pelo usuário" }]);
}

/** cria uma carteira simulada com capital e parâmetros próprios */
export async function createCarteira(
  store: Store,
  args: { name: string; capital: number; params?: Partial<PregaoSettings>; today?: string },
): Promise<Carteira> {
  const id = randomUUID();
  const capital = args.capital;
  const params: PregaoSettings = { ...DEFAULT_PREGAO, ...(args.params ?? {}), capital };
  const c: Carteira = { id, name: args.name, createdAt: new Date().toISOString(), capital, params };
  await store.saveCarteiras([...(await store.listCarteiras()), c]);
  await store.savePregao(newPregaoState(args.today ?? nowBRT().date, capital), id);
  return c;
}

/** altera os parâmetros de uma carteira (o capital não muda aqui: use zerar) */
export async function saveParams(store: Store, pid: string, patch: Partial<PregaoSettings>) {
  if (pid === PREGAO_DEFAULT) {
    const s = await store.getSettings();
    s.pregao = { ...s.pregao, ...patch, capital: s.pregao.capital };
    await store.saveSettings(s);
    return;
  }
  const list = await store.listCarteiras();
  const c = list.find((x) => x.id === pid);
  if (!c) return;
  c.params = { ...c.params, ...patch, capital: c.capital };
  await store.saveCarteiras(list);
}

/** zera uma carteira: apaga ordens, execuções e posições e recomeça com o capital informado */
export async function resetCarteira(store: Store, pid: string, capital: number, today = nowBRT().date) {
  if (pid === PREGAO_DEFAULT) {
    const s = await store.getSettings();
    s.pregao = { ...s.pregao, capital };
    await store.saveSettings(s);
  } else {
    const list = await store.listCarteiras();
    const c = list.find((x) => x.id === pid);
    if (!c) return;
    c.capital = capital;
    c.params = { ...c.params, capital };
    await store.saveCarteiras(list);
  }
  await store.clearPregao(pid);
  await store.savePregao(newPregaoState(today, capital), pid);
}

/** apaga uma carteira simulada e tudo o que ela registrou */
export async function deleteCarteira(store: Store, pid: string) {
  if (pid === PREGAO_DEFAULT) return;
  await store.clearPregao(pid);
  await store.saveCarteiras((await store.listCarteiras()).filter((c) => c.id !== pid));
}
