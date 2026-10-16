import { describe, expect, it } from "vitest";
import {
  applyExecution, applySplit, DEFAULT_PREGAO, fillOrder, newPregaoState, processPregaoDay, settleTaxIfNewMonth,
  type DayInput, type PregaoOrder, type PregaoSettings,
} from "@/lib/engine/pregao";

const S: PregaoSettings = { ...DEFAULT_PREGAO, slippage: 0.001, participation: 0.05, feePct: 0.000325, fixedFee: 0 };
const RATES = { cdiRate: 0, cdiTaxRate: 0.15, taxRate: 0.15 };
let seq = 0;
const newId = () => `id-${++seq}`;

const bar = (o: Partial<DayInput["bar"] & object> = {}, extra: Partial<DayInput> = {}): DayInput => ({
  bar: { open: 10, high: 10.5, low: 9.8, close: 10.2, volume: 100000, ...o },
  prevClose: 10,
  hasRaw: true,
  anomaly: false,
  ...extra,
});

function order(p: Partial<PregaoOrder> & Pick<PregaoOrder, "side" | "type" | "qty">): PregaoOrder {
  return {
    id: newId(), createdAt: "2024-01-02T20:00:00.000Z", createdDate: "2024-01-02", ticker: "AAAA3",
    status: "OPEN", filledQty: 0, avgPrice: 0, fees: 0, ...p,
  };
}

describe("fillOrder (execução contra a faixa do pregão)", () => {
  it("a mercado: compra pela abertura com deslizamento e limitada a 5% do volume", () => {
    const r = fillOrder({ side: "BUY", type: "MARKET", qty: 1000 }, bar(), S);
    expect(r.status).toBe("EXECUTED");
    expect(r.qty).toBe(1000);
    expect(r.price).toBeCloseTo(10.01, 6);
  });

  it("a mercado: venda pela abertura com deslizamento contra o vendedor", () => {
    const r = fillOrder({ side: "SELL", type: "MARKET", qty: 100 }, bar(), S);
    expect(r.price).toBeCloseTo(9.99, 6);
  });

  it("limite de compra não tocado (mínima acima do limite) não executa", () => {
    const r = fillOrder({ side: "BUY", type: "LIMIT", qty: 100, limitPrice: 9.5 }, bar(), S);
    expect(r.status).toBe("NOT_EXECUTED");
    expect(r.reason).toBe("limite não atingido");
  });

  it("limite de compra tocado com abertura melhor: executa pela abertura", () => {
    const r = fillOrder({ side: "BUY", type: "LIMIT", qty: 100, limitPrice: 10.2 }, bar(), S);
    expect(r.status).toBe("EXECUTED");
    expect(r.price).toBeCloseTo(10.0, 6); // min(limite, abertura)
  });

  it("limite de compra tocado com abertura acima do limite: executa no limite", () => {
    const r = fillOrder({ side: "BUY", type: "LIMIT", qty: 100, limitPrice: 9.9 }, bar({ open: 10.1, low: 9.8 }), S);
    expect(r.status).toBe("EXECUTED");
    expect(r.price).toBeCloseTo(9.9, 6);
  });

  it("limite de venda: executa a partir do limite quando a máxima toca", () => {
    const r = fillOrder({ side: "SELL", type: "LIMIT", qty: 100, limitPrice: 10.4 }, bar({ open: 10.0, high: 10.5 }), S);
    expect(r.status).toBe("EXECUTED");
    expect(r.price).toBeCloseTo(10.4, 6);
  });

  it("stop de venda normal: dispara no nível do stop com deslizamento", () => {
    const r = fillOrder({ side: "SELL", type: "STOP", qty: 100, stopPrice: 10 }, bar({ open: 10.5, low: 9.9 }), S);
    expect(r.status).toBe("EXECUTED");
    expect(r.price).toBeCloseTo(9.99, 6);
  });

  it("stop de venda com gap de abertura abaixo do stop: executa na abertura", () => {
    const r = fillOrder({ side: "SELL", type: "STOP", qty: 100, stopPrice: 10 }, bar({ open: 9.5, low: 9.4 }), S);
    expect(r.status).toBe("EXECUTED");
    expect(r.price).toBeCloseTo(9.5 * 0.999, 6);
  });

  it("stop não atingido não executa", () => {
    const r = fillOrder({ side: "SELL", type: "STOP", qty: 100, stopPrice: 9 }, bar(), S);
    expect(r.status).toBe("NOT_EXECUTED");
    expect(r.reason).toBe("stop não atingido");
  });

  it("quantidade maior que 5% do volume: execução parcial", () => {
    const r = fillOrder({ side: "BUY", type: "MARKET", qty: 100 }, bar({ volume: 1000 }), S);
    expect(r.status).toBe("PARTIAL");
    expect(r.qty).toBe(50);
  });

  it("volume insuficiente para qualquer lote não executa", () => {
    const r = fillOrder({ side: "BUY", type: "MARKET", qty: 10 }, bar({ volume: 10 }), S);
    expect(r.status).toBe("NOT_EXECUTED");
    expect(r.reason).toBe("liquidez insuficiente nesta sessão");
  });

  it("dado suspeito bloqueia a execução", () => {
    const r = fillOrder({ side: "BUY", type: "MARKET", qty: 10 }, bar({}, { anomaly: true }), S);
    expect(r.status).toBe("BLOCKED");
  });

  it("preços brutos ausentes bloqueiam a execução", () => {
    const r = fillOrder({ side: "BUY", type: "MARKET", qty: 10 }, bar({}, { hasRaw: false }), S);
    expect(r.status).toBe("BLOCKED");
  });

  it("sem negociação no dia não executa", () => {
    const r = fillOrder({ side: "BUY", type: "MARKET", qty: 10 }, undefined, S);
    expect(r.status).toBe("NOT_EXECUTED");
    expect(r.reason).toBe("sem negociação nesta sessão");
  });

  it("stop de compra não existe", () => {
    const r = fillOrder({ side: "BUY", type: "STOP", qty: 10, stopPrice: 11 }, bar(), S);
    expect(r.status).toBe("NOT_EXECUTED");
  });
});

describe("caixa, posição e preço médio", () => {
  it("compra com taxas forma preço médio incluindo as taxas", () => {
    const st = newPregaoState("2024-01-02", 100000);
    applyExecution(st, { ticker: "AAAA3", side: "BUY", qty: 100, price: 10, date: "2024-01-03" }, S);
    const pos = st.positions[0];
    const fee = 100 * 10 * 0.000325;
    expect(st.cash).toBeCloseTo(100000 - 1000 - fee, 6);
    expect(pos.avgCost).toBeCloseTo((1000 + fee) / 100, 6);
  });

  it("venda registra resultado realizado líquido de taxas", () => {
    const st = newPregaoState("2024-01-02", 100000);
    applyExecution(st, { ticker: "AAAA3", side: "BUY", qty: 100, price: 10, date: "2024-01-03" }, S);
    const r = applyExecution(st, { ticker: "AAAA3", side: "SELL", qty: 100, price: 12, date: "2024-01-10" }, S);
    expect(r.realized).toBeGreaterThan(190);
    expect(r.realized).toBeLessThan(200);
    expect(st.positions).toHaveLength(0);
  });

  it("desdobramento dobra a quantidade e divide o preço médio", () => {
    const st = newPregaoState("2024-01-02", 100000);
    applyExecution(st, { ticker: "AAAA3", side: "BUY", qty: 100, price: 10, date: "2024-01-03" }, S);
    const before = st.positions[0].avgCost;
    applySplit(st, "AAAA3", 2);
    expect(st.positions[0].qty).toBe(200);
    expect(st.positions[0].avgCost).toBeCloseTo(before / 2, 6);
  });
});

describe("processamento de um pregão", () => {
  it("ordem digitada em um dia só executa no pregão seguinte", () => {
    const st = newPregaoState("2024-01-02", 100000);
    const o = order({ side: "BUY", type: "MARKET", qty: 100 });
    const inputs = new Map([["AAAA3", bar()]]);
    // mesmo dia da digitação: não executa
    const same = processPregaoDay(st, [o], "2024-01-02", new Map([["AAAA3", bar()]]), S, RATES, newId);
    expect(same.orders[0].status).toBe("OPEN");
    // pregão seguinte: executa
    const next = processPregaoDay(st, same.orders, "2024-01-03", inputs, S, RATES, newId);
    expect(next.orders[0].status).toBe("EXECUTED");
    expect(next.orders[0].sessionDate).toBe("2024-01-03");
    expect(next.fills).toHaveLength(1);
    expect(st.positions[0].qty).toBe(100);
  });

  it("compra limitada ao caixa disponível e marcada como parcial", () => {
    const st = newPregaoState("2024-01-02", 5000);
    const o = order({ side: "BUY", type: "MARKET", qty: 1000 });
    const r = processPregaoDay(st, [o], "2024-01-03", new Map([["AAAA3", bar()]]), S, RATES, newId);
    expect(r.orders[0].status).toBe("PARTIAL");
    expect(r.orders[0].reason).toBe("caixa insuficiente no pregão");
    expect(r.orders[0].filledQty).toBeLessThan(1000);
    expect(st.cash).toBeGreaterThanOrEqual(0);
  });

  it("venda acima da posição é limitada à quantidade em carteira", () => {
    const st = newPregaoState("2024-01-02", 100000);
    applyExecution(st, { ticker: "AAAA3", side: "BUY", qty: 50, price: 10, date: "2024-01-02" }, S);
    const o = order({ side: "SELL", type: "MARKET", qty: 100 });
    const r = processPregaoDay(st, [o], "2024-01-03", new Map([["AAAA3", bar()]]), S, RATES, newId);
    expect(r.orders[0].status).toBe("PARTIAL");
    expect(r.orders[0].filledQty).toBe(50);
    expect(st.positions).toHaveLength(0);
  });

  it("ordem de ticker sem dados nesta rodada fica aberta", () => {
    const st = newPregaoState("2024-01-02", 100000);
    const o = order({ side: "BUY", type: "MARKET", qty: 100 });
    const r = processPregaoDay(st, [o], "2024-01-03", new Map(), S, RATES, newId);
    expect(r.orders[0].status).toBe("OPEN");
  });

  it("ticker com dados mas sem candle no pregão encerra a ordem como não executada", () => {
    const st = newPregaoState("2024-01-02", 100000);
    const o = order({ side: "BUY", type: "MARKET", qty: 100 });
    const r = processPregaoDay(st, [o], "2024-01-03", new Map([["AAAA3", undefined]]), S, RATES, newId);
    expect(r.orders[0].status).toBe("NOT_EXECUTED");
    expect(r.orders[0].reason).toBe("sem negociação nesta sessão");
  });

  it("marca o patrimônio com o preço bruto do dia e rende o CDI líquido sobre o caixa", () => {
    const st = newPregaoState("2024-01-02", 100000);
    const rates = { ...RATES, cdiRate: 0.001 };
    processPregaoDay(st, [], "2024-01-03", new Map(), S, rates, newId);
    expect(st.cash).toBeCloseTo(100000 * (1 + 0.001 * 0.85), 6);
    expect(st.curve[st.curve.length - 1].equity).toBeCloseTo(st.cash, 6);
  });
});

describe("imposto do pregão", () => {
  it("lucro do mês é tributado na virada do mês", () => {
    const st = newPregaoState("2024-01-02", 100000);
    st.realizedMonth = 1000;
    st.lastDate = "2024-01-31";
    const before = st.cash;
    settleTaxIfNewMonth(st, "2024-02-01", 0.15);
    expect(st.cash).toBeCloseTo(before - 150, 6);
    expect(st.realizedMonth).toBe(0);
  });

  it("prejuízo é compensado no lucro do mês seguinte", () => {
    const st = newPregaoState("2024-01-02", 100000);
    st.realizedMonth = -500;
    st.lastDate = "2024-01-31";
    settleTaxIfNewMonth(st, "2024-02-01", 0.15);
    expect(st.lossCarry).toBe(500);
    st.realizedMonth = 1000;
    st.lastDate = "2024-02-29";
    const before = st.cash;
    settleTaxIfNewMonth(st, "2024-03-01", 0.15);
    expect(st.cash).toBeCloseTo(before - 0.15 * 500, 6);
    expect(st.lossCarry).toBe(0);
  });
});
