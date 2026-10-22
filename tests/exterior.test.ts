import { describe, expect, it } from "vitest";
import { convertToBRL } from "@/lib/engine/fx";
import { taxByMarket, type RealTx } from "@/lib/engine/real";
import type { Candle } from "@/lib/engine/types";
import { isExterior, TICKER_RE, yahooSymbol } from "@/lib/tickers";

const candle = (date: string, close: number): Candle => ({
  date, open: close, high: close, low: close, close, volume: 100, raw: { open: close, high: close, low: close, close },
});

describe("câmbio das ações estrangeiras", () => {
  it("converte OHLC e bruto pelo câmbio do dia e mantém o volume", () => {
    const out = convertToBRL([candle("2024-01-02", 10)], { "2024-01-02": 4 });
    expect(out).not.toBeNull();
    expect(out![0].close).toBeCloseTo(40, 9);
    expect(out![0].raw!.close).toBeCloseTo(40, 9);
    expect(out![0].volume).toBe(100);
  });

  it("em dia sem cotação usa a última anterior, nunca a de um dia futuro", () => {
    const out = convertToBRL(
      [candle("2024-01-02", 10), candle("2024-01-03", 10), candle("2024-01-05", 10)],
      { "2024-01-02": 4, "2024-01-05": 5 },
    )!;
    expect(out.map((c) => c.close)).toEqual([40, 40, 50]);
  });

  it("descarta candles anteriores à primeira cotação de câmbio", () => {
    const out = convertToBRL([candle("2024-01-01", 10), candle("2024-01-02", 10)], { "2024-01-02": 4 })!;
    expect(out.map((c) => c.date)).toEqual(["2024-01-02"]);
  });

  it("devolve null sem nenhuma cotação de câmbio", () => {
    expect(convertToBRL([candle("2024-01-02", 10)], {})).toBeNull();
  });
});

describe("símbolos e tickers", () => {
  it("B3 usa o sufixo .SA; exterior usa o próprio ticker no Yahoo", () => {
    expect(yahooSymbol({ ticker: "PETR4" })).toBe("PETR4.SA");
    expect(yahooSymbol({ ticker: "AAPL", market: "EXT" })).toBe("AAPL");
    expect(isExterior({ market: "EXT" })).toBe(true);
    expect(isExterior({})).toBe(false);
  });

  it("aceita tickers da B3 e do exterior, e recusa símbolos de câmbio e minúsculas", () => {
    for (const t of ["PETR4", "BOVA11", "AAPL", "BRK-B"]) expect(TICKER_RE.test(t)).toBe(true);
    for (const t of ["BRL=X", "aapl", "", "PE TR4"]) expect(TICKER_RE.test(t)).toBe(false);
  });
});

describe("IR separado por mercado", () => {
  const txs: RealTx[] = [
    { id: "1", date: "2024-03-04", ticker: "AAPL", side: "BUY", qty: 10, price: 100, fees: 0 },
    { id: "2", date: "2024-03-05", ticker: "AAPL", side: "SELL", qty: 10, price: 150, fees: 0 },
    { id: "3", date: "2024-03-04", ticker: "PETR4", side: "BUY", qty: 100, price: 10, fees: 0 },
    { id: "4", date: "2024-03-05", ticker: "PETR4", side: "SELL", qty: 100, price: 5, fees: 0 },
  ];

  it("prejuízo da B3 não reduz o imposto sobre o ganho no exterior", () => {
    const t = taxByMarket(txs, new Set(["AAPL"]), { etfs: [], useExemption: true, rate: 0.15 });
    expect(t.b3[0].tax).toBe(0);
    expect(t.b3[0].lossCarryAfter).toBe(500);
    expect(t.exterior[0].taxableBase).toBeCloseTo(500, 6);
    expect(t.exterior[0].tax).toBeCloseTo(75, 6);
  });

  it("a isenção de R$ 20 mil não vale para o exterior, mesmo com a isenção ligada", () => {
    const t = taxByMarket(txs, new Set(["AAPL"]), { etfs: [], useExemption: true, rate: 0.15 });
    expect(t.exterior[0].exempt).toBe(false);
  });
});
