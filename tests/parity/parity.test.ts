import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeSeries } from "@/lib/engine/signals";
import { buildAsset, buildUniverse, runUntil, startSim } from "@/lib/engine/simulation";
import { DEFAULT_PARAMS, type Candle } from "@/lib/engine/types";

// Fixture gerado por bolsa/export_reference.py (backtest Python, dados limpos, 8 ativos, máx. 4 posições)
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixture.json"), "utf-8"));
const params = { ...DEFAULT_PARAMS, N: fx.params.N, M: fx.params.M, maxPos: fx.params.maxPos };

const assets = Object.entries(fx.candles as Record<string, Candle[]>).map(([t, candles]) =>
  buildAsset(t, candles, computeSeries(candles, params)),
);
const u = buildUniverse(assets);

describe("paridade com o backtest Python", () => {
  it("estado diário (sinal) idêntico para todos os ativos", () => {
    let total = 0, diffs = 0;
    const examples: string[] = [];
    for (const a of assets) {
      for (const [date, st] of fx.states[a.ticker] as [string, number][]) {
        const i = a.idxByDate.get(date);
        if (i === undefined) continue;
        const target = a.series.state[i]; // estado bruto (Python: s.target, antes da máscara de atividade)
        total++;
        if (target !== st) { diffs++; if (examples.length < 5) examples.push(`${a.ticker} ${date} ts=${target} py=${st}`); }
      }
    }
    expect(total).toBeGreaterThan(5000);
    expect(examples).toEqual([]);
    expect(diffs).toBe(0);
  });

  it("mesmas compras e vendas (ativo, data de entrada e de saída)", () => {
    const cdi = new Map<string, number>(Object.entries(fx.cdi));
    const sim0 = startSim(u, fx.startDate, fx.params.capital, params);
    const sim = runUntil(sim0, u, fx.endDate, cdi, params);
    const key = (x: { ticker: string; entry: string; exit: string }) => `${x.exit}|${x.ticker}|${x.entry}`;
    const ts = sim.trades.map((t) => key({ ticker: t.ticker, entry: t.entryDate, exit: t.exitDate })).sort();
    const py = (fx.trades as { ticker: string; entry: string; exit: string }[]).map(key).sort();
    expect(ts.length).toBe(py.length);
    expect(ts).toEqual(py);
    // posições abertas no fim
    const open = sim.positions.map((p) => `${p.ticker}|${p.entryDate}`).sort();
    const pyOpen = (fx.openPositions as { ticker: string; entry: string }[]).map((p) => `${p.ticker}|${p.entry}`).sort();
    expect(open).toEqual(pyOpen);
  });

  it("patrimônio final próximo do Python (ações inteiras vs valor fixo)", () => {
    const cdi = new Map<string, number>(Object.entries(fx.cdi));
    const sim = runUntil(startSim(u, fx.startDate, fx.params.capital, params), u, fx.endDate, cdi, params);
    const tsEq = sim.curve[sim.curve.length - 1].equity;
    const pyEq = fx.equity[fx.equity.length - 1][1];
    const rel = Math.abs(tsEq / pyEq - 1);
    console.log(`patrimônio final TS=${tsEq.toFixed(0)} Python=${pyEq.toFixed(0)} dif=${(rel * 100).toFixed(2)}%`);
    expect(rel).toBeLessThan(0.05);
  });
});
