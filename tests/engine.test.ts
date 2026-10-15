import { describe, expect, it } from "vitest";
import { computeSeries, detectAnomaly, lastSignal } from "@/lib/engine/signals";
import { buildAsset, buildUniverse, equityAt, processDay, startSim } from "@/lib/engine/simulation";
import { realPositions, taxMonths } from "@/lib/engine/real";
import { DEFAULT_PARAMS, type Candle } from "@/lib/engine/types";

const P = { ...DEFAULT_PARAMS, N: 20, M: 5, maxPos: 3 };

function day(i: number): string {
  return new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10);
}
/** série sintética: lateral e depois rompimento de alta, com o preço dado por f(i) */
function make(n: number, f: (i: number) => number, vol = 1e6): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return { date: day(i), open: c * 0.999, high: c * 1.01, low: c * 0.99, close: c, volume: vol };
  });
}

describe("sinais", () => {
  it("entra no rompimento e sai na mínima de M dias", () => {
    const c = make(80, (i) => (i < 40 ? 10 + 0.01 * (i % 3) : i < 60 ? 10 + (i - 39) * 0.3 : 16 - (i - 59) * 0.8));
    const s = computeSeries(c, P);
    expect(s.state[30]).toBe(0);
    expect(s.state[45]).toBe(1);
    expect(s.state[79]).toBe(0);
  });

  it("marca dado suspeito (salto > 35%) e bloqueia a compra automática", () => {
    const base = (i: number) => (i < 40 ? 10 : 10 + (i - 39) * 0.2);
    const bad = make(70, (i) => (i < 55 ? base(i) : base(i) * 0.4)); // queda falsa de 60% (desdobramento mal ajustado)
    expect(detectAnomaly(bad, 0.35, 110)?.date).toBe(day(55));
    const sig = lastSignal("XXXX3", bad, computeSeries(bad, P), P);
    expect(sig.anomaly).not.toBeNull();
    const ok = make(70, base);
    expect(lastSignal("YYYY3", ok, computeSeries(ok, P), P).anomaly).toBeNull();
  });
});

describe("simulação", () => {
  it("compra na abertura seguinte ao sinal, com 10% do patrimônio, e cobra custos", () => {
    const c = make(80, (i) => (i < 40 ? 10 : 10 + (i - 39) * 0.3));
    const u = buildUniverse([buildAsset("AAAA3", c, computeSeries(c, P))]);
    const sigDay = u.dates.find((d, i) => computeSeries(c, P).state[i] === 1)!; // primeiro fechamento com sinal
    const prev = u.dates[u.dates.indexOf(sigDay)];
    const next = u.dates[u.dates.indexOf(sigDay) + 1];
    let sim = startSim(u, prev, 100000, P);
    expect(sim.pending.find((o) => o.side === "BUY")?.ticker).toBe("AAAA3");
    sim = processDay(sim, next, prev, u, 0, P);
    expect(sim.positions).toHaveLength(1);
    const pos = sim.positions[0];
    expect(pos.entryDate).toBe(next);
    const nextOpen = c[u.dates.indexOf(next)].open;
    expect(pos.entryPrice).toBeCloseTo(nextOpen, 6);
    expect(pos.basis / 100000).toBeGreaterThan(0.0995); // ~10% (+ custos)
    expect(pos.basis / 100000).toBeLessThan(0.1005);
    expect(sim.feesPaidTotal).toBeGreaterThan(10);
    expect(equityAt(sim, u, next)).toBeLessThan(100000 + 5000);
  });

  it("não compra ativo com dado suspeito", () => {
    const base = (i: number) => (i < 40 ? 10 : 10 + (i - 39) * 0.3);
    const c = make(80, (i) => (i < 60 ? base(i) : base(i) * 0.5)); // salto falso recente
    const u = buildUniverse([buildAsset("BBBB3", c, computeSeries(c, P))]);
    const sim = startSim(u, u.dates[70], 100000, P);
    expect(sim.pending.filter((o) => o.side === "BUY")).toHaveLength(0);
  });
});

describe("carteira real e IR", () => {
  const tx = (date: string, ticker: string, side: "BUY" | "SELL", qty: number, price: number, fees = 0) => ({ id: date + ticker + side, date, ticker, side, qty, price, fees });

  it("preço médio e posição", () => {
    const pos = realPositions([tx("2024-01-02", "PETR4", "BUY", 100, 30), tx("2024-01-10", "PETR4", "BUY", 100, 40), tx("2024-02-01", "PETR4", "SELL", 50, 50)]);
    expect(pos).toHaveLength(1);
    expect(pos[0].qty).toBe(150);
    expect(pos[0].avgCost).toBeCloseTo(35, 6);
  });

  it("IR de 15% com compensação de prejuízo e vencimento no último dia útil do mês seguinte", () => {
    const m = taxMonths(
      [
        tx("2024-01-02", "AAAA3", "BUY", 1000, 10), tx("2024-01-20", "AAAA3", "SELL", 1000, 9), // jan: prejuízo de 1.000
        tx("2024-02-02", "BBBB3", "BUY", 1000, 10), tx("2024-02-20", "BBBB3", "SELL", 1000, 13), // fev: lucro de 3.000
      ],
      { etfs: ["BOVA11"], useExemption: false, rate: 0.15 },
    );
    expect(m[0].tax).toBe(0);
    expect(m[0].lossCarryAfter).toBeCloseTo(1000, 6);
    expect(m[1].lossUsed).toBeCloseTo(1000, 6);
    expect(m[1].taxableBase).toBeCloseTo(2000, 6);
    expect(m[1].tax).toBeCloseTo(300, 6);
    expect(m[1].dueDate).toBe("2024-03-29"); // 31/03/2024 é domingo → sexta 29/03
  });

  it("isenção de R$ 20 mil vale para ações, não para ETF", () => {
    const base = [tx("2024-03-01", "CCCC3", "BUY", 1000, 10), tx("2024-03-20", "CCCC3", "SELL", 1000, 12), tx("2024-03-01", "BOVA11", "BUY", 100, 100), tx("2024-03-20", "BOVA11", "SELL", 100, 110)];
    const [m] = taxMonths(base, { etfs: ["BOVA11"], useExemption: true, rate: 0.15 });
    expect(m.exempt).toBe(true); // vendas de ações = R$ 12 mil
    expect(m.tax).toBeCloseTo(150, 6); // só o ganho do ETF (R$ 1.000) é tributado
  });
});
