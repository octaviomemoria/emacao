import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { priorMarketStats, sqrtImpactRel } from "@/lib/engine/impact";
import { DEFAULT_PREGAO, fillOrder, type DayInput, type PregaoSettings } from "@/lib/engine/pregao";
import { annualizedVolatility, historicalCvar, historicalVar, maxDrawdown, riskReport } from "@/lib/engine/risk";
import type { Candle } from "@/lib/engine/types";
import { createCarteira, getParams } from "@/lib/carteiras";
import { runPregaoJob } from "@/lib/jobs/pregao";
import { FileStore } from "@/lib/store/file";
import { DEFAULT_SETTINGS } from "@/lib/store/types";

const S: PregaoSettings = { ...DEFAULT_PREGAO, slippage: 0.001, participation: 0.05, feePct: 0.000325, fixedFee: 0 };
const bar = (o: Partial<NonNullable<DayInput["bar"]>> = {}, extra: Partial<DayInput> = {}): DayInput => ({
  bar: { open: 10, high: 10.5, low: 9.8, close: 10.2, volume: 1_000_000, ...o },
  prevClose: 10,
  hasRaw: true,
  anomaly: false,
  ...extra,
});

describe("impacto de mercado por raiz quadrada", () => {
  it("segue a fórmula eta × sigma × sqrt(Q / ADV)", () => {
    expect(sqrtImpactRel(10_000, 1_000_000, 0.02, 0.5)).toBeCloseTo(0.5 * 0.02 * Math.sqrt(0.01), 12);
    expect(sqrtImpactRel(0, 1_000_000, 0.02, 0.5)).toBe(0);
  });

  it("recusa parâmetros inválidos", () => {
    expect(() => sqrtImpactRel(10, 0, 0.02, 0.5)).toThrow();
    expect(() => sqrtImpactRel(-1, 100, 0.02, 0.5)).toThrow();
    expect(() => sqrtImpactRel(10, 100, -0.1, 0.5)).toThrow();
  });

  it("ordem a mercado de compra fica mais cara com impacto, e de venda mais barata", () => {
    const input = bar({}, { adv: 1_000_000, sigma: 0.02 }); // executa 10.000 de 50.000 (5% de 1 mi)
    const buy = fillOrder({ side: "BUY", type: "MARKET", qty: 10_000 }, input, S);
    const sell = fillOrder({ side: "SELL", type: "MARKET", qty: 10_000 }, input, S);
    const impact = 0.5 * 0.02 * Math.sqrt(10_000 / 1_000_000);
    expect(buy.price).toBeCloseTo(10 * (1 + 0.001 + impact), 9);
    expect(sell.price).toBeCloseTo(10 * (1 - 0.001 - impact), 9);
  });

  it("sem estatísticas de mercado, o preço é só o do deslizamento", () => {
    const r = fillOrder({ side: "BUY", type: "MARKET", qty: 10_000 }, bar(), S);
    expect(r.price).toBeCloseTo(10.01, 9);
  });

  it("limite não recebe impacto: o preço máximo é respeitado", () => {
    const r = fillOrder({ side: "BUY", type: "LIMIT", qty: 10_000, limitPrice: 10.2 }, bar({ open: 10 }, { adv: 1_000, sigma: 0.05 }), S);
    expect(r.status).toBe("EXECUTED");
    expect(r.price).toBeCloseTo(10, 9);
  });

  it("estatísticas usam só pregões anteriores (sem olhar o futuro)", () => {
    const candles: Candle[] = Array.from({ length: 80 }, (_, i) => ({
      date: `d${i}`, open: 10, high: 10, low: 10, close: 10 + (i % 3) * 0.1, volume: 1000 + i,
    }));
    const before = priorMarketStats(candles, 50);
    const changed = candles.map((c, i) => (i >= 50 ? { ...c, volume: 1e9, close: 999 } : c));
    expect(priorMarketStats(changed, 50)).toEqual(before);
    expect(priorMarketStats(candles.slice(0, 10), 5)).toBeNull();
  });
});

describe("métricas de risco", () => {
  // retornos -0,050 … +0,049 em passos de 0,001: VaR 95% = 0,046; VaR 99% = 0,050; CVaR 95% = 0,048
  const sample = Array.from({ length: 100 }, (_, i) => (i - 50) / 1000);

  it("VaR e CVaR históricos com valores conhecidos", () => {
    expect(historicalVar(sample, 0.95)).toBeCloseTo(0.046, 9);
    expect(historicalVar(sample, 0.99)).toBeCloseTo(0.05, 9);
    expect(historicalCvar(sample, 0.95)).toBeCloseTo(0.048, 9);
    expect(historicalCvar(sample, 0.95)).toBeGreaterThanOrEqual(historicalVar(sample, 0.95));
  });

  it("volatilidade anualizada e queda máxima", () => {
    expect(annualizedVolatility([0.01, 0.01, 0.01])).toBe(0);
    expect(maxDrawdown([100, 120, 90, 110])).toBeCloseTo(90 / 120 - 1, 12);
  });

  it("relatório só com pelo menos 20 retornos", () => {
    expect(riskReport([100, 101, 102])).toBeNull();
    const eq = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
    const r = riskReport(eq);
    expect(r).not.toBeNull();
    expect(r!.days).toBe(39);
    expect(r!.maxDrawdown).toBe(0);
  });
});

describe("dado suspeito no pregão", () => {
  let dir: string;
  let store: FileStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "impacto-"));
    process.env.DATA_DIR = dir;
    store = new FileStore();
    const candles: Candle[] = [
      // ajustado contínuo (o provedor ajustou o histórico pelo desdobramento) e bruto com salto de -50% no dia 04
      { date: "2024-01-02", open: 5, high: 5.1, low: 4.95, close: 5, volume: 1e6, raw: { open: 10, high: 10.2, low: 9.9, close: 10 } },
      { date: "2024-01-03", open: 5, high: 5.1, low: 4.95, close: 5.05, volume: 1e6, raw: { open: 10, high: 10.2, low: 9.9, close: 10.1 } },
      { date: "2024-01-04", open: 5.05, high: 5.1, low: 4.95, close: 5.0, volume: 1e6, raw: { open: 5.05, high: 5.1, low: 4.95, close: 5.0 } },
    ];
    fs.mkdirSync(path.join(dir, "prices"), { recursive: true });
    fs.writeFileSync(path.join(dir, "prices", "ABEV3.json"), JSON.stringify(candles));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  const run = async (splitDates: string[]) => {
    const c = await createCarteira(store, { name: "T", capital: 50_000, today: "2024-01-03" });
    await store.upsertOrders([{
      id: "o1", portfolioId: c.id, createdAt: "2024-01-03T20:00:00.000Z", createdDate: "2024-01-03", ticker: "ABEV3",
      side: "BUY", type: "MARKET", qty: 100, estPrice: 10, status: "OPEN", filledQty: 0, avgPrice: 0, fees: 0,
    }]);
    const candles = JSON.parse(fs.readFileSync(path.join(dir, "prices", "ABEV3.json"), "utf-8")) as Candle[];
    await runPregaoJob(store, {
      pid: c.id,
      data: new Map([["ABEV3", candles]]),
      splits: new Map([["ABEV3", splitDates.map((d) => ({ date: d, ratio: 2 }))]]),
      refDate: "2024-01-04",
      pregao: (await getParams(store, c.id))!,
      params: DEFAULT_SETTINGS.params,
      cdiMap: new Map(),
      now: new Date("2024-01-04T21:00:00Z"),
    });
    return (await store.listOrders(c.id))[0];
  };

  it("salto no bruto sem evento de desdobramento bloqueia a ordem", async () => {
    const o = await run([]);
    expect(o.status).toBe("BLOCKED");
    expect(o.reason).toContain("dado suspeito");
  });

  it("o mesmo salto com evento de desdobramento registrado executa normalmente", async () => {
    const o = await run(["2024-01-04"]);
    expect(o.status).toBe("EXECUTED");
    expect(o.avgPrice).toBeCloseTo(5.05 * 1.001, 6);
  });
});
