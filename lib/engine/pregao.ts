/**
 * Pregão simulado: o usuário digita ordens (a mercado, limite ou stop) e o app decide a execução
 * com base na faixa de preços do pregão seguinte (abertura, máxima, mínima e volume brutos).
 *
 * Limite: não há livro de ofertas nem fila. O preenchimento é uma ESTIMATIVA pela faixa diária:
 *  - quantidade máxima por pregão = participation × volume do dia (o restante é cancelado: validade "dia");
 *  - a execução usa preços brutos (sem ajuste por proventos), como um pregão real.
 */
import { DEFAULT_IMPACT_ETA, sqrtImpactRel } from "./impact";
import type { Candle } from "./types";

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "STOP";
export type OrderStatus = "OPEN" | "EXECUTED" | "PARTIAL" | "NOT_EXECUTED" | "BLOCKED" | "CANCELLED";

/** identificador da carteira de pregão padrão (a do menu "Pregão"); as demais são as Carteiras Simuladas */
export const PREGAO_DEFAULT = "pregao";

export interface PregaoOrder {
  id: string;
  portfolioId?: string; // PREGAO_DEFAULT quando ausente (registros anteriores às carteiras simuladas)
  createdAt: string; // ISO
  createdDate: string; // data (BRT) da digitação; a sessão é o primeiro pregão posterior
  ticker: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number; // compra: preço máximo; venda: preço mínimo
  stopPrice?: number; // só venda: dispara quando o preço cai até este nível
  estPrice?: number; // preço usado para reservar caixa/quantidade enquanto a ordem está aberta
  status: OrderStatus;
  filledQty: number;
  avgPrice: number; // 0 se não executou
  fees: number;
  sessionDate?: string; // pregão em que a ordem foi processada
  reason?: string; // motivo de NOT_EXECUTED / BLOCKED / PARTIAL
  gap?: number; // variação da abertura frente ao fechamento anterior, quando ≥ limite de gap
}

export interface PregaoFill {
  id: string;
  portfolioId?: string;
  orderId: string;
  date: string;
  ticker: string;
  side: OrderSide;
  qty: number;
  price: number;
  fees: number;
}

export interface PregaoPosition {
  ticker: string;
  qty: number;
  avgCost: number; // preço médio incluindo taxas
  entryDate: string;
  lastPrice: number; // último preço bruto conhecido (marcação a mercado)
}

export interface PregaoState {
  startDate: string;
  initialCapital: number;
  lastDate: string;
  cash: number;
  positions: PregaoPosition[];
  realizedMonth: number; // resultado realizado da B3 no mês corrente (R$, antes do IR)
  lossCarry: number; // prejuízo da B3 a compensar (R$)
  // exterior: apuração separada (sem compensação com a B3). Ausente em estados anteriores às ações estrangeiras
  realizedMonthExt?: number;
  lossCarryExt?: number;
  taxPaidTotal: number;
  feesPaidTotal: number;
  cdiIndex: number;
  curve: { date: string; equity: number; cdiNet: number }[];
}

export interface PregaoSettings {
  capital: number; // capital inicial do pregão simulado (R$)
  slippage: number; // deslizamento de spread contra o investidor (0.001 = 0,10%)
  participation: number; // máximo do volume do dia por ordem (0.05 = 5%)
  feePct: number; // emolumentos sobre o valor da operação (0.000325 = 0,0325%)
  fixedFee: number; // corretagem fixa por ordem (R$)
  gapPct: number; // alerta de abertura com gap (0.05 = 5%)
  impactEta: number; // elasticidade do impacto de mercado por raiz quadrada (η, 0,5 = padrão)
}

export const DEFAULT_PREGAO: PregaoSettings = {
  capital: 100000,
  slippage: 0.001,
  participation: 0.05,
  feePct: 0.000325,
  fixedFee: 0,
  gapPct: 0.05,
  impactEta: 0.5,
};

/** ordem de um ativo espera este número de dias corridos por um pregão com dados (feriado no mercado do ativo) */
export const MAX_WAIT_DAYS = 5;

/** barra bruta do pregão de um ativo, com o fechamento do pregão anterior */
export interface DayInput {
  bar: { open: number; high: number; low: number; close: number; volume: number } | null;
  prevClose: number;
  hasRaw: boolean; // false quando o candle não tem preços brutos salvos (não executa)
  anomaly: boolean; // dado suspeito: variação ajustada acima do limite, ou salto bruto sem evento de desdobramento
  adv?: number; // volume médio diário dos pregões anteriores (impacto de mercado)
  sigma?: number; // volatilidade diária dos pregões anteriores (impacto de mercado)
  exterior?: boolean; // ação estrangeira: o resultado entra na apuração separada do IR
}

export interface FillResult {
  status: "EXECUTED" | "PARTIAL" | "NOT_EXECUTED" | "BLOCKED";
  qty: number;
  price: number;
  reason?: string;
  gap?: number;
}

/** Decide a execução de UMA ordem contra a faixa de UM pregão. Função pura. */
export function fillOrder(
  order: Pick<PregaoOrder, "side" | "type" | "qty" | "limitPrice" | "stopPrice">,
  input: DayInput | undefined,
  s: PregaoSettings,
): FillResult {
  if (!input || !input.bar) return { status: "NOT_EXECUTED", qty: 0, price: 0, reason: "sem negociação nesta sessão" };
  if (!input.hasRaw) return { status: "BLOCKED", qty: 0, price: 0, reason: "preços brutos indisponíveis para este dia (atualize a base)" };
  if (input.anomaly) return { status: "BLOCKED", qty: 0, price: 0, reason: "dado suspeito neste pregão (variação acima do limite)" };

  const b = input.bar;
  const gap = input.prevClose > 0 ? b.open / input.prevClose - 1 : 0;
  const cap = Math.floor(b.volume * s.participation);
  if (cap < 1) return { status: "NOT_EXECUTED", qty: 0, price: 0, reason: "liquidez insuficiente nesta sessão" };

  // quantidade executada nesta sessão (limitada à participação no volume do dia)
  const qty = Math.min(order.qty, cap);
  // impacto de mercado por raiz quadrada, sobre a quantidade executada (só a mercado e stop; o limite protege o preço)
  const impact = input.adv && input.sigma !== undefined && input.adv > 0
    ? sqrtImpactRel(qty, input.adv, input.sigma, s.impactEta ?? DEFAULT_IMPACT_ETA)
    : 0;
  const adverse = s.slippage + impact;

  let price: number | null = null;
  if (order.type === "MARKET") {
    price = order.side === "BUY" ? b.open * (1 + adverse) : b.open * (1 - adverse);
  } else if (order.type === "LIMIT") {
    const lim = order.limitPrice ?? 0;
    if (order.side === "BUY" && b.low <= lim) price = Math.min(lim, b.open);
    if (order.side === "SELL" && b.high >= lim) price = Math.max(lim, b.open);
  } else if (order.type === "STOP") {
    if (order.side !== "SELL") return { status: "NOT_EXECUTED", qty: 0, price: 0, reason: "stop só existe para venda" };
    const stop = order.stopPrice ?? 0;
    if (b.low <= stop) price = (b.open <= stop ? b.open : stop) * (1 - adverse);
  }
  if (price === null) {
    return { status: "NOT_EXECUTED", qty: 0, price: 0, reason: order.type === "STOP" ? "stop não atingido" : "limite não atingido", gap };
  }
  if (!(price > 0)) return { status: "BLOCKED", qty: 0, price: 0, reason: "impacto de mercado excessivo para este volume (divida a ordem)" };
  return {
    status: qty === order.qty ? "EXECUTED" : "PARTIAL",
    qty,
    price,
    reason: qty === order.qty ? undefined : `limitado a ${(s.participation * 100).toFixed(0)}% do volume do dia`,
    gap,
  };
}

export const feeOf = (qty: number, price: number, s: PregaoSettings) => qty * price * s.feePct + s.fixedFee;

export function newPregaoState(startDate: string, capital: number): PregaoState {
  return {
    startDate,
    initialCapital: capital,
    lastDate: startDate,
    cash: capital,
    positions: [],
    realizedMonth: 0,
    lossCarry: 0,
    realizedMonthExt: 0,
    lossCarryExt: 0,
    taxPaidTotal: 0,
    feesPaidTotal: 0,
    cdiIndex: 1,
    curve: [{ date: startDate, equity: capital, cdiNet: capital }],
  };
}

/** aplica uma execução ao estado (caixa, posição, preço médio, resultado realizado) */
export function applyExecution(
  st: PregaoState,
  o: { ticker: string; side: OrderSide; qty: number; price: number; date: string; exterior?: boolean },
  s: PregaoSettings,
): { fee: number; realized: number } {
  const gross = o.qty * o.price;
  const fee = feeOf(o.qty, o.price, s);
  st.feesPaidTotal += fee;
  const pos = st.positions.find((p) => p.ticker === o.ticker);
  if (o.side === "BUY") {
    st.cash -= gross + fee;
    if (pos) {
      const newQty = pos.qty + o.qty;
      pos.avgCost = (pos.avgCost * pos.qty + gross + fee) / newQty;
      pos.qty = newQty;
      pos.lastPrice = o.price;
    } else {
      st.positions.push({ ticker: o.ticker, qty: o.qty, avgCost: (gross + fee) / o.qty, entryDate: o.date, lastPrice: o.price });
    }
    return { fee, realized: 0 };
  }
  const proceeds = gross - fee;
  const realized = pos ? proceeds - pos.avgCost * o.qty : 0;
  st.cash += proceeds;
  if (o.exterior) st.realizedMonthExt = (st.realizedMonthExt ?? 0) + realized;
  else st.realizedMonth += realized;
  if (pos) {
    pos.qty -= o.qty;
    pos.lastPrice = o.price;
    if (pos.qty <= 0) st.positions = st.positions.filter((p) => p.ticker !== o.ticker);
  }
  return { fee, realized };
}

/** desdobramento (ratio > 1) ou grupamento (ratio < 1): quantidade e preço médio, sem fração */
export function applySplit(st: PregaoState, ticker: string, ratio: number) {
  const pos = st.positions.find((p) => p.ticker === ticker);
  if (!pos || !(ratio > 0) || ratio === 1) return;
  pos.qty = Math.floor(pos.qty * ratio);
  pos.avgCost = pos.avgCost / ratio;
  pos.lastPrice = pos.lastPrice / ratio;
}

/** um mercado num mês: lucro é tributado depois de usar o prejuízo acumulado; prejuízo vai para a compensação */
function settleMarket(realized: number, carry: number, rate: number): { carry: number; tax: number } {
  if (realized > 0) {
    const use = Math.min(carry, realized);
    return { carry: carry - use, tax: rate * (realized - use) };
  }
  return { carry: carry + Math.max(0, -realized), tax: 0 };
}

/** IR mensal sobre o resultado realizado de cada mercado, com compensação separada (B3 e exterior não se compensam) */
export function settleTaxIfNewMonth(st: PregaoState, date: string, taxRate: number, foreignTaxRate = taxRate) {
  const m = (d: string) => d.slice(0, 7);
  if (m(date) === m(st.lastDate)) return;
  const b3 = settleMarket(st.realizedMonth, st.lossCarry, taxRate);
  const ext = settleMarket(st.realizedMonthExt ?? 0, st.lossCarryExt ?? 0, foreignTaxRate);
  const tax = b3.tax + ext.tax;
  st.lossCarry = b3.carry;
  st.lossCarryExt = ext.carry;
  st.cash -= tax;
  st.taxPaidTotal += tax;
  st.realizedMonth = 0;
  st.realizedMonthExt = 0;
}

export interface OrderOutcome {
  order: PregaoOrder;
  fills: PregaoFill[];
  fill: FillResult;
}

/**
 * Processa as ordens cuja sessão é `date`: executa contra a barra do dia, respeitando caixa e posição,
 * e fecha as ordens (validade "dia"). Muta `st` e devolve os resultados por ordem.
 * `inputs`: barra por ticker (undefined quando o ticker não tem dados nesta rodada: a ordem fica aberta).
 */
export function processPregaoDay(
  st: PregaoState,
  orders: PregaoOrder[],
  date: string,
  inputs: Map<string, DayInput | undefined>,
  s: PregaoSettings,
  rates: { cdiRate: number; cdiTaxRate: number; taxRate: number; foreignTaxRate?: number },
  newId: () => string,
): { orders: PregaoOrder[]; fills: PregaoFill[]; outcomes: OrderOutcome[] } {
  settleTaxIfNewMonth(st, date, rates.taxRate, rates.foreignTaxRate ?? rates.taxRate);

  const outcomes: OrderOutcome[] = [];
  const allFills: PregaoFill[] = [];
  const eligible = orders
    .filter((o) => o.status === "OPEN" && o.createdDate < date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const o of eligible) {
    if (!inputs.has(o.ticker)) continue; // sem dados do ativo nesta rodada: fica aberta
    const input = inputs.get(o.ticker);
    // sem candle nesta sessão (feriado no mercado do ativo): a ordem espera por um pregão com dados
    const noBar = !input?.bar;
    if (noBar && calendarDays(o.createdDate, date) <= MAX_WAIT_DAYS) continue;
    let fill = fillOrder(o, input, s);
    if (noBar) fill = { ...fill, reason: `sem negociação por mais de ${MAX_WAIT_DAYS} dias` };
    let qty = fill.qty;
    const fills: PregaoFill[] = [];

    if (qty > 0 && o.side === "BUY") {
      const unit = fill.price * (1 + s.feePct);
      const affordable = Math.max(0, Math.floor((st.cash - s.fixedFee) / unit));
      if (affordable < qty) {
        qty = affordable;
        fill = { ...fill, qty, status: qty === 0 ? "NOT_EXECUTED" : "PARTIAL", reason: "caixa insuficiente no pregão" };
      }
    } else if (qty > 0 && o.side === "SELL") {
      const held = st.positions.find((p) => p.ticker === o.ticker)?.qty ?? 0;
      if (held < qty) {
        qty = held;
        fill = { ...fill, qty, status: qty === 0 ? "NOT_EXECUTED" : "PARTIAL", reason: "posição insuficiente no pregão" };
      }
    }

    if (qty > 0 && input?.bar) {
      applyExecution(st, { ticker: o.ticker, side: o.side, qty, price: fill.price, date, exterior: input.exterior }, s);
      const fee = feeOf(qty, fill.price, s);
      fills.push({ id: newId(), orderId: o.id, date, ticker: o.ticker, side: o.side, qty, price: fill.price, fees: fee });
    }

    const updated: PregaoOrder = {
      ...o,
      status: fill.status,
      filledQty: qty,
      avgPrice: qty > 0 ? fill.price : 0,
      fees: fills.reduce((x, f) => x + f.fees, 0),
      sessionDate: date,
      reason: fill.reason,
      gap: fill.gap,
    };
    allFills.push(...fills);
    outcomes.push({ order: updated, fills, fill });
  }

  // marcação: preço bruto do dia para as posições com barra; caixa rende CDI líquido
  for (const pos of st.positions) {
    const inp = inputs.get(pos.ticker);
    if (inp?.bar) pos.lastPrice = inp.bar.close;
  }
  if (st.cash > 0) st.cash += st.cash * rates.cdiRate * (1 - rates.cdiTaxRate);
  st.cdiIndex *= 1 + rates.cdiRate * (1 - rates.cdiTaxRate);
  const equity = pregaoEquity(st);
  st.lastDate = date;
  st.curve.push({ date, equity, cdiNet: st.initialCapital * st.cdiIndex });

  const updatedById = new Map(outcomes.map((x) => [x.order.id, x.order]));
  return {
    orders: orders.map((o) => updatedById.get(o.id) ?? o),
    fills: allFills,
    outcomes,
  };
}

export const pregaoEquity = (st: PregaoState) => st.cash + st.positions.reduce((a, p) => a + p.qty * p.lastPrice, 0);

const calendarDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86400000;

/** candle bruto mais recente anterior a `date` (para estimativas na tela) */
export function lastRawClose(candles: Candle[]): number {
  const c = candles[candles.length - 1];
  return c ? (c.raw?.close ?? c.close) : 0;
}
