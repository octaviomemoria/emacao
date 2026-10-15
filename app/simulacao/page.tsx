import LineChart from "@/components/LineChart";
import { ResetSimForm } from "@/components/forms";
import { Badge, Card, Disclaimer, Empty, Stat } from "@/components/ui";
import { brl, dmy, num, pct, spct, tone } from "@/lib/format";
import { simMetrics } from "@/lib/engine/simulation";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Simulacao() {
  const store = (await getStore());
  const [sim, snap, settings] = await Promise.all([store.getSim(), store.getSnapshot(), store.getSettings()]);
  if (!sim || !snap) return <Empty>Sem simulação ainda. Faça a primeira atualização na tela Hoje.</Empty>;
  const p = settings.params;
  const price = new Map(snap.signals.map((s) => [s.ticker, s]));
  const m = simMetrics(sim);
  const last = sim.curve[sim.curve.length - 1];
  const invested = sim.positions.reduce((a, x) => a + x.qty * (price.get(x.ticker)?.price ?? x.entryPrice), 0);
  const base = sim.curve[0];
  const bova0 = sim.curve.find((c) => c.bova)?.bova;
  const curve = sim.curve.length > 400 ? sim.curve.filter((_, i) => i % Math.ceil(sim.curve.length / 400) === 0 || i === sim.curve.length - 1) : sim.curve;
  const pending = sim.pending.filter((o) => !o.waiting);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Simulação — o que deveria estar aberto</h1>
        <p className="text-xs opacity-60">Carteira que segue a regra à risca desde {dmy(sim.startDate)}, atualizada até {dmy(sim.lastDate)}. Compras em ações inteiras na abertura, custos de {pct(p.costSide * 2, 2)} + {brl(p.fixedFee, 0)}/ordem, IR de {pct(p.taxRate, 0)} sobre o lucro realizado e caixa em CDI líquido.</p>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          <Stat label="Patrimônio" value={brl(last.equity, 0)} sub={`início ${brl(sim.initialCapital, 0)}`} />
          <Stat label="Resultado" value={spct(m.returnTotal)} className={tone(m.returnTotal)} sub={`CDI líq. ${spct(m.cdiTotal)}`} />
          <Stat label="Em ações" value={brl(invested, 0)} sub={`${sim.positions.length}/${p.maxPos} posições · caixa ${brl(sim.cash, 0)}`} />
          <Stat label="Trades encerrados" value={m.trades} sub={`acerto ${pct(m.hitRate, 0)}`} />
          <Stat label="Ganho / perda médios" value={`${spct(m.avgWin)} / ${spct(m.avgLoss)}`} sub={`${num(m.avgDays)} dias por trade`} />
          <Stat label="Queda máxima" value={pct(m.maxDrawdown)} sub={`IR pago ${brl(sim.taxPaidTotal, 0)} · taxas ${brl(sim.feesPaidTotal, 0)}`} />
        </div>
      </Card>

      <Card title="Evolução do patrimônio (R$)">
        <LineChart money height={240} series={[
          { name: "Estratégia (simulada)", color: "#10b981", points: curve.map((c) => ({ x: c.date, y: c.equity })) },
          { name: "CDI líquido de IR", color: "#a1a1aa", dashed: true, points: curve.map((c) => ({ x: c.date, y: c.cdiNet })) },
          ...(bova0 ? [{ name: "BOVA11 (preço)", color: "#0ea5e9", points: curve.filter((c) => c.bova).map((c) => ({ x: c.date, y: (c.bova! / bova0) * base.equity })) }] : []),
        ]} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Posições abertas (${sim.positions.length})`}>
          {sim.positions.length ? (
            <div className="table-wrap"><table className="t"><thead><tr><th>Ativo</th><th>Entrada</th><th className="num">Qtd</th><th className="num">PM</th><th className="num">Atual</th><th className="num">Resultado</th><th className="num">Sai se &lt;</th></tr></thead>
              <tbody>{sim.positions.map((x) => {
                const s = price.get(x.ticker); const now = s?.price ?? x.entryPrice; const r = (x.qty * now) / x.basis - 1;
                return (<tr key={x.ticker}><td className="font-semibold">{x.ticker}</td><td>{dmy(x.entryDate)}</td><td className="num">{x.qty}</td><td className="num">{brl(x.entryPrice)}</td><td className="num">{brl(now)}</td>
                  <td className={`num ${tone(r)}`}>{spct(r)}</td><td className="num">{s ? brl(s.stopLevel) : "—"}</td></tr>);
              })}</tbody></table></div>
          ) : <Empty>Nenhuma posição aberta.</Empty>}
        </Card>
        <Card title="Ordens pendentes para a próxima abertura">
          {pending.length ? (
            <ul className="flex flex-col gap-2 text-sm">{pending.map((o) => (
              <li key={o.side + o.ticker} className="flex items-center justify-between gap-2">
                <span><Badge tone={o.side === "BUY" ? "green" : "red"}>{o.side === "BUY" ? "COMPRAR" : "VENDER"}</Badge> <b>{o.ticker}</b>{o.isNew ? " · novo" : ""}</span>
                <span className="opacity-70">{o.side === "BUY" ? `≈ ${brl(o.valueBRL ?? 0, 0)} (~${o.qtyApprox} ações)` : `${o.qtyApprox} ações`}</span>
              </li>))}</ul>
          ) : <Empty>Nenhuma ordem pendente.</Empty>}
        </Card>
      </div>

      <Card title={`Últimos trades (${Math.min(40, sim.trades.length)} de ${sim.trades.length})`}>
        {sim.trades.length ? (
          <div className="table-wrap"><table className="t"><thead><tr><th>Ativo</th><th>Entrada</th><th>Saída</th><th className="num">Dias</th><th className="num">Preço entrada</th><th className="num">Preço saída</th><th className="num">Resultado</th><th className="num">Lucro (R$)</th></tr></thead>
            <tbody>{[...sim.trades].reverse().slice(0, 40).map((t, i) => (
              <tr key={i}><td className="font-semibold">{t.ticker}</td><td>{dmy(t.entryDate)}</td><td>{dmy(t.exitDate)}</td><td className="num">{t.days}</td><td className="num">{brl(t.entryPrice)}</td><td className="num">{brl(t.exitPrice)}</td>
                <td className={`num ${tone(t.ret)}`}>{spct(t.ret)}</td><td className={`num ${tone(t.pnl)}`}>{brl(t.pnl, 0)}</td></tr>))}</tbody></table></div>
        ) : <Empty>Ainda não houve trades encerrados.</Empty>}
      </Card>

      <Card title="Reiniciar a simulação">
        <p className="mb-2 text-xs opacity-70">Recalcula a carteira simulada a partir de uma data, usando os preços salvos (cobrem cerca de {settings.historyYears} anos). Sem data, começa no último fechamento.</p>
        <ResetSimForm capital={sim.initialCapital} />
      </Card>
      <Disclaimer />
    </div>
  );
}
