import fs from "node:fs";
import path from "node:path";
import LineChart from "@/components/LineChart";
import { Card, Disclaimer, Empty, Stat } from "@/components/ui";
import { brl, dmy, num, pct, spct, tone } from "@/lib/format";
import { runUntil, simMetrics, startSim } from "@/lib/engine/simulation";
import { loadUniverse } from "@/lib/jobs/universe";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Hist { ano: number; setup: number; patrimonio: number; cdi_liq: number; bova11_bruto: number; pos_medias: number; compras: number; trades: number; acerto: number }

export default async function Backtest({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const store = (await getStore());
  const settings = await store.getSettings();
  const base = settings.params;
  const params = {
    ...base,
    N: Math.max(5, parseInt(q.N ?? "") || base.N),
    M: Math.max(2, parseInt(q.M ?? "") || base.M),
    filter: (q.filter === "up200" ? "up200" : q.filter === "none" ? "none" : base.filter) as "none" | "up200",
    maxPos: Math.max(1, parseInt(q.maxPos ?? "") || base.maxPos),
  };
  const capital = Math.max(1000, parseFloat((q.capital ?? "").replace(",", ".")) || settings.simCapital);
  const ran = q.run === "1";
  let result: React.ReactNode = null;
  if (ran) {
    const { u, cdi, bova, lastDate, firstDate } = await loadUniverse(store, params);
    if (!lastDate) result = <Empty>Sem preços salvos. Faça a primeira atualização.</Empty>;
    else {
      const want = q.start || "";
      const first = u.dates.find((d) => d >= (params.N + 5 ? firstDate : want)) ?? firstDate;
      // precisa de histórico antes do início para os sinais; usa o primeiro pregão com ≥ N+5 candles
      const startDate = want ? [...u.dates].reverse().find((d) => d <= want) ?? first : u.dates[Math.min(u.dates.length - 1, params.N + 10)];
      const sim = runUntil(startSim(u, startDate, capital, params), u, lastDate, cdi, params, bova);
      const m = simMetrics(sim);
      const curve = sim.curve.length > 500 ? sim.curve.filter((_, i) => i % Math.ceil(sim.curve.length / 500) === 0) : sim.curve;
      const years = Math.max(0.1, (Date.parse(lastDate) - Date.parse(startDate)) / (365.25 * 86400000));
      result = (
        <Card title={`Resultado: ${dmy(startDate)} → ${dmy(lastDate)}`}>
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            <Stat label="Patrimônio final" value={brl(sim.curve[sim.curve.length - 1].equity, 0)} sub={`início ${brl(capital, 0)}`} />
            <Stat label="Resultado" value={spct(m.returnTotal)} className={tone(m.returnTotal)} sub={`${pct(Math.pow(1 + m.returnTotal, 1 / years) - 1)} ao ano`} />
            <Stat label="CDI líquido" value={spct(m.cdiTotal)} sub={`${pct(Math.pow(1 + m.cdiTotal, 1 / years) - 1)} ao ano`} />
            <Stat label="Trades" value={m.trades} sub={`acerto ${pct(m.hitRate, 0)}`} />
            <Stat label="Ganho / perda médios" value={`${spct(m.avgWin)} / ${spct(m.avgLoss)}`} sub={`${num(m.avgDays)} dias`} />
            <Stat label="Queda máxima" value={pct(m.maxDrawdown)} />
          </div>
          <LineChart money height={240} series={[
            { name: "Estratégia", color: "#10b981", points: curve.map((c) => ({ x: c.date, y: c.equity })) },
            { name: "CDI líquido de IR", color: "#a1a1aa", dashed: true, points: curve.map((c) => ({ x: c.date, y: c.cdiNet })) },
          ]} />
          <p className="mt-3 text-xs opacity-60">Só cobre o período dos preços salvos (cerca de {settings.historyYears} anos). Parâmetros escolhidos olhando o passado tendem a parecer melhores do que serão: prefira mudanças pequenas e confira em períodos que você não usou para decidir.</p>
        </Card>
      );
    }
  }

  let hist: Hist[] = [];
  try { hist = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "historico_ano_a_ano.json"), "utf-8")); } catch { /* arquivo opcional */ }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Backtest</h1>
      <Card title="Rodar a estratégia sobre os preços salvos">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <input type="hidden" name="run" value="1" />
          <label className="flex flex-col gap-1 text-xs"><span className="opacity-60">Rompimento (dias)</span><input name="N" defaultValue={params.N} className="w-24" /></label>
          <label className="flex flex-col gap-1 text-xs"><span className="opacity-60">Saída: mínima de (dias)</span><input name="M" defaultValue={params.M} className="w-24" /></label>
          <label className="flex flex-col gap-1 text-xs"><span className="opacity-60">Filtro</span><select name="filter" defaultValue={params.filter}><option value="none">Nenhum</option><option value="up200">Acima da média de 200</option></select></label>
          <label className="flex flex-col gap-1 text-xs"><span className="opacity-60">Máx. posições</span><input name="maxPos" defaultValue={params.maxPos} className="w-20" /></label>
          <label className="flex flex-col gap-1 text-xs"><span className="opacity-60">Capital (R$)</span><input name="capital" defaultValue={capital} className="w-28" /></label>
          <label className="flex flex-col gap-1 text-xs"><span className="opacity-60">Início (opcional)</span><input name="start" type="date" defaultValue={q.start} /></label>
          <button className="btn">Rodar</button>
        </form>
      </Card>
      {result}

      {hist.length > 0 && (
        <Card title="Histórico 2000–2026 (pesquisa em Python, dados limpos, ano a ano)">
          <p className="mb-2 text-xs opacity-60">Rompimento 100 / saída 10, R$ 100 mil, 10% por posição, 0,20% + R$ 10/ordem, IR 15% realizado. Período em que a regra foi escolhida: não é previsão.</p>
          <div className="table-wrap"><table className="t"><thead><tr><th>Ano</th><th className="num">Compras</th><th className="num">Acerto</th><th className="num">Estratégia</th><th className="num">CDI líq.</th><th className="num">BOVA11 (preço)</th><th className="num">Pos. médias</th><th className="num">Patrimônio</th></tr></thead>
            <tbody>{hist.map((h) => (
              <tr key={h.ano}><td>{h.ano}</td><td className="num">{h.compras}</td><td className="num">{pct(h.acerto / 100, 0)}</td><td className={`num ${tone(h.setup)}`}>{spct(h.setup)}</td><td className="num">{spct(h.cdi_liq)}</td><td className="num">{spct(h.bova11_bruto)}</td><td className="num">{num(h.pos_medias, 1)}</td><td className="num">{brl(h.patrimonio, 0)}</td></tr>))}</tbody></table></div>
        </Card>
      )}
      <Disclaimer />
    </div>
  );
}
