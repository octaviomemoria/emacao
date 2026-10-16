import Link from "next/link";
import { Badge, Card, Disclaimer, Empty, Stat } from "@/components/ui";
import { RunButton } from "@/components/forms";
import { brl, dmy, pct, spct, tone } from "@/lib/format";
import { realPositions } from "@/lib/engine/real";
import { simMetrics } from "@/lib/engine/simulation";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Hoje() {
  const store = (await getStore());
  const [snap, sim, settings, alerts, txs, pregaoOrders] = await Promise.all([store.getSnapshot(), store.getSim(), store.getSettings(), store.listAlerts(8), store.listTx(), store.listOrders()]);
  if (!snap || !sim) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="mb-2 text-xl font-semibold">Bem-vindo</h1>
        <p className="mb-6 text-sm opacity-70">Ainda não há dados. A primeira atualização baixa o histórico dos ativos e do CDI, calcula os sinais e inicia a carteira simulada.</p>
        <RunButton label="Fazer a primeira atualização" />
        <Disclaimer />
      </div>
    );
  }
  const p = settings.params;
  const buys = sim.pending.filter((o) => o.side === "BUY" && !o.waiting);
  const waiting = sim.pending.filter((o) => o.side === "BUY" && o.waiting);
  const sells = sim.pending.filter((o) => o.side === "SELL");
  const sigBy = new Map(snap.signals.map((s) => [s.ticker, s]));
  const real = realPositions(txs);
  const realSell = real.filter((r) => sigBy.get(r.ticker)?.state === 0);
  const m = simMetrics(sim);
  const last = sim.curve[sim.curve.length - 1];
  const unread = alerts.filter((a) => !a.read);
  const trend = snap.signals.filter((s) => s.state === 1).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Hoje</h1>
          <p className="text-xs opacity-60">Sinais do fechamento de {dmy(snap.date)} · ordens valem para a abertura do próximo pregão · estratégia: rompimento de {p.N} dias, saída na mínima de {p.M}</p>
        </div>
        <RunButton />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={`Comprar na abertura (${buys.length})`} right={<Badge tone="green">{sim.positions.length}/{p.maxPos} posições na simulação</Badge>}>
          {buys.length ? (
            <div className="table-wrap"><table className="t"><thead><tr><th>Ativo</th><th className="num">Preço ref.</th><th className="num">{pct(p.frac, 0)} ≈</th><th className="num">Ações</th><th className="num">Sai se fechar &lt;</th></tr></thead>
              <tbody>{buys.map((o) => (
                <tr key={o.ticker}><td><Link className="font-semibold underline-offset-2 hover:underline" href={`/radar?t=${o.ticker}`}>{o.ticker}</Link> {o.isNew && <Badge tone="blue">novo</Badge>}</td>
                  <td className="num">{brl(o.refPrice)}</td><td className="num">{brl(o.valueBRL ?? 0, 0)}</td><td className="num">~{o.qtyApprox}</td>
                  <td className="num">{brl(o.stopLevel ?? 0)} <span className="opacity-60">({spct((o.stopLevel ?? 0) / o.refPrice - 1)})</span></td></tr>
              ))}</tbody></table></div>
          ) : <Empty>{sim.positions.length >= p.maxPos ? "Carteira simulada cheia." : "Nenhum ativo com sinal de compra e vaga livre."}</Empty>}
          {waiting.length > 0 && <p className="mt-2 text-xs opacity-60">Lista de espera (sinal ativo, sem vaga): {waiting.map((o) => o.ticker).join(", ")}</p>}
        </Card>

        <Card title={`Vender na abertura (${sells.length + realSell.length})`}>
          {sells.length + realSell.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {sells.map((o) => (<li key={"s" + o.ticker} className="flex items-center justify-between"><span><b>{o.ticker}</b> <Badge tone="red">simulação</Badge></span><span className="opacity-70">fechou {brl(o.refPrice)}, abaixo da mínima de {p.M} dias</span></li>))}
              {realSell.map((r) => (<li key={"r" + r.ticker} className="flex items-center justify-between"><span><b>{r.ticker}</b> <Badge tone="amber">sua carteira</Badge></span><span className="opacity-70">{r.qty} ações · PM {brl(r.avgCost)}</span></li>))}
            </ul>
          ) : <Empty>Nenhuma saída acionada.</Empty>}
        </Card>
      </div>

      <Card title="Pregão simulado" right={<Link href="/pregao" className="text-xs underline">abrir o pregão →</Link>}>
        {(() => {
          const done = pregaoOrders.filter((o) => o.sessionDate === snap.date && o.status !== "OPEN");
          const openN = pregaoOrders.filter((o) => o.status === "OPEN").length;
          return (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-xs opacity-60">Ordens executadas no pregão de {dmy(snap.date)}: {done.length} · ordens abertas aguardando o próximo pregão: {openN}</p>
              {done.length ? (
                <ul className="flex flex-col gap-1">
                  {done.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2">
                      <Badge tone={o.status === "EXECUTED" ? "green" : o.status === "PARTIAL" ? "blue" : o.status === "BLOCKED" ? "red" : "gray"}>
                        {o.status === "EXECUTED" ? "executada" : o.status === "PARTIAL" ? "parcial" : o.status === "BLOCKED" ? "bloqueada" : "não executada"}
                      </Badge>
                      <b>{o.side === "BUY" ? "Compra" : "Venda"} {o.ticker}</b>
                      <span className="opacity-70">{o.filledQty ? `${o.filledQty} a ${brl(o.avgPrice)}` : o.reason ?? ""}</span>
                    </li>
                  ))}
                </ul>
              ) : <Empty>Nenhuma ordem do pregão processada neste pregão.</Empty>}
            </div>
          );
        })()}
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Carteira simulada">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Patrimônio" value={brl(last.equity, 0)} sub={`desde ${dmy(sim.startDate)}`} />
            <Stat label="Resultado" value={spct(m.returnTotal)} className={tone(m.returnTotal)} sub={`CDI líq. ${spct(m.cdiTotal)}`} />
            <Stat label="Trades" value={m.trades} sub={`acerto ${pct(m.hitRate, 0)}`} />
            <Stat label="Queda máx." value={pct(m.maxDrawdown)} />
          </div>
          <Link href="/simulacao" className="mt-3 inline-block text-xs underline">ver simulação completa →</Link>
        </Card>
        <Card title="Mercado agora">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Em tendência" value={`${trend} de ${snap.signals.length}`} />
            <Stat label="Rompimentos novos" value={snap.signals.filter((s) => s.isNewBreakout).length} />
            <Stat label="Saídas novas" value={snap.signals.filter((s) => s.isNewExit).length} />
            <Stat label="Dados com aviso" value={snap.skipped.length + snap.signals.filter((s) => s.anomaly).length} />
          </div>
          <Link href="/radar" className="mt-3 inline-block text-xs underline">abrir o Radar →</Link>
        </Card>
        <Card title={`Alertas${unread.length ? ` (${unread.length} novos)` : ""}`}>
          {alerts.length ? (
            <ul className="flex flex-col gap-2 text-sm">{alerts.slice(0, 5).map((a) => (<li key={a.id} className={a.read ? "opacity-60" : ""}>{a.title}</li>))}</ul>
          ) : <Empty>Sem alertas ainda.</Empty>}
          <Link href="/alertas" className="mt-3 inline-block text-xs underline">ver todos →</Link>
        </Card>
      </div>
      <Disclaimer />
    </div>
  );
}
