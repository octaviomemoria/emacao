import LineChart from "@/components/LineChart";
import { PregaoResetForm, PregaoSettingsForm, PregaoTicket } from "@/components/PregaoForms";
import { Badge, Card, Disclaimer, Empty, Stat } from "@/components/ui";
import { cancelPregaoOrder } from "@/app/actions";
import { brl, dmy, num, spct, tone } from "@/lib/format";
import { pregaoEquity, type OrderStatus, type PregaoOrder } from "@/lib/engine/pregao";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const STATUS: Record<OrderStatus, { t: string; tone: "amber" | "green" | "blue" | "gray" | "red" }> = {
  OPEN: { t: "aberta", tone: "amber" },
  EXECUTED: { t: "executada", tone: "green" },
  PARTIAL: { t: "parcial", tone: "blue" },
  NOT_EXECUTED: { t: "não executada", tone: "gray" },
  BLOCKED: { t: "bloqueada", tone: "red" },
  CANCELLED: { t: "cancelada", tone: "gray" },
};

const typeTxt = (o: PregaoOrder) =>
  o.type === "MARKET" ? "a mercado" : o.type === "LIMIT" ? `limite ${brl(o.limitPrice ?? 0)}` : `stop ${brl(o.stopPrice ?? 0)}`;

export default async function Pregao() {
  const store = await getStore();
  const [settings, st, orders, fills, assets, snap] = await Promise.all([
    store.getSettings(), store.getPregao(), store.listOrders(), store.listFills(), store.getAssets(), store.getSnapshot(),
  ]);
  const pg = settings.pregao;
  const tickers = assets.filter((a) => a.enabled).map((a) => a.ticker).sort();
  const refPrices = Object.fromEntries((snap?.signals ?? []).map((s) => [s.ticker, s.price]));

  const open = orders.filter((o) => o.status === "OPEN");
  const reservedCash = open.filter((o) => o.side === "BUY").reduce((a, o) => a + o.qty * (o.estPrice ?? 0) * (1 + pg.feePct) + pg.fixedFee, 0);
  const cash = st?.cash ?? pg.capital;
  const equity = st ? pregaoEquity(st) : pg.capital;
  const capital = st?.initialCapital ?? pg.capital;
  const cdiNet = st ? st.curve[st.curve.length - 1].cdiNet / capital - 1 : 0;
  const ret = equity / capital - 1;
  const curve = st && st.curve.length > 400 ? st.curve.filter((_, i) => i % Math.ceil(st.curve.length / 400) === 0 || i === st.curve.length - 1) : st?.curve ?? [];
  const recent = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60);
  const recentFills = [...fills].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Pregão simulado</h1>
        <p className="text-xs opacity-60">
          Você digita as ordens e o app decide a execução com a faixa de preços do pregão seguinte (abertura, máxima, mínima e volume brutos).
          Não há livro de ofertas nem fila: o preenchimento é uma estimativa. Esta carteira é separada da regra automática e da sua carteira real.
        </p>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          <Stat label="Patrimônio" value={brl(equity, 0)} sub={`capital ${brl(capital, 0)}`} />
          <Stat label="Resultado" value={spct(ret)} className={tone(ret)} sub={`CDI líq. ${spct(cdiNet)}`} />
          <Stat label="Caixa" value={brl(cash, 0)} sub={`reservado em ordens: ${brl(reservedCash, 0)}`} />
          <Stat label="Ordens abertas" value={open.length} />
          <Stat label="Posições" value={st?.positions.length ?? 0} />
          <Stat label="Taxas pagas" value={brl(st?.feesPaidTotal ?? 0, 0)} sub={`IR pago ${brl(st?.taxPaidTotal ?? 0, 0)}`} />
        </div>
        {!st && <p className="mt-3 text-xs opacity-70">O pregão ainda não começou. Ele inicia com a primeira ordem ou na próxima atualização.</p>}
      </Card>

      <Card title="Nova ordem">
        {tickers.length ? (
          <PregaoTicket tickers={tickers} refPrices={refPrices} pg={pg} cashAvail={cash - reservedCash} />
        ) : <Empty>Nenhum ativo acompanhado. Configure a lista em Configurações.</Empty>}
      </Card>

      <Card title={`Ordens (${open.length} abertas)`}>
        {recent.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Digitada</th><th>Ativo</th><th>Op.</th><th>Tipo</th><th className="num">Qtd</th><th>Status</th><th className="num">Executada</th><th className="num">Preço médio</th><th className="num">Taxas</th><th>Pregão</th><th>Motivo</th><th /></tr></thead>
            <tbody>{recent.map((o) => (
              <tr key={o.id}>
                <td>{dmy(o.createdDate)}</td><td className="font-semibold">{o.ticker}</td><td>{o.side === "BUY" ? "Compra" : "Venda"}</td><td>{typeTxt(o)}</td>
                <td className="num">{o.qty}</td><td><Badge tone={STATUS[o.status].tone}>{STATUS[o.status].t}</Badge></td>
                <td className="num">{o.filledQty || "—"}</td><td className="num">{o.avgPrice ? brl(o.avgPrice) : "—"}</td><td className="num">{o.fees ? brl(o.fees) : "—"}</td>
                <td>{o.sessionDate ? dmy(o.sessionDate) : "—"}</td><td className="max-w-xs whitespace-normal text-xs opacity-70">{o.reason ?? ""}</td>
                <td>{o.status === "OPEN" && (
                  <form action={cancelPregaoOrder.bind(null, o.id)}><button className="text-xs underline opacity-70 hover:opacity-100">cancelar</button></form>
                )}</td>
              </tr>))}</tbody></table></div>
        ) : <Empty>Nenhuma ordem digitada.</Empty>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Posições (${st?.positions.length ?? 0})`}>
          {st?.positions.length ? (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Ativo</th><th className="num">Qtd</th><th className="num">Preço médio</th><th className="num">Último</th><th className="num">Valor</th><th className="num">Resultado</th></tr></thead>
              <tbody>{st.positions.map((p) => (
                <tr key={p.ticker}><td className="font-semibold">{p.ticker}</td><td className="num">{p.qty}</td><td className="num">{brl(p.avgCost)}</td><td className="num">{brl(p.lastPrice)}</td>
                  <td className="num">{brl(p.qty * p.lastPrice, 0)}</td><td className={`num ${tone(p.lastPrice / p.avgCost - 1)}`}>{spct(p.lastPrice / p.avgCost - 1)}</td></tr>))}</tbody></table></div>
          ) : <Empty>Nenhuma posição.</Empty>}
        </Card>
        <Card title="Evolução (R$)">
          {curve.length > 1 ? (
            <LineChart money height={220} series={[
              { name: "Pregão simulado", color: "#10b981", points: curve.map((c) => ({ x: c.date, y: c.equity })) },
              { name: "CDI líquido", color: "#a1a1aa", dashed: true, points: curve.map((c) => ({ x: c.date, y: c.cdiNet })) },
            ]} />
          ) : <Empty>A curva aparece depois do primeiro pregão processado.</Empty>}
        </Card>
      </div>

      <Card title={`Execuções (${fills.length})`}>
        {recentFills.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Data</th><th>Ativo</th><th>Op.</th><th className="num">Qtd</th><th className="num">Preço</th><th className="num">Taxas</th><th className="num">Valor</th></tr></thead>
            <tbody>{recentFills.map((f) => (
              <tr key={f.id}><td>{dmy(f.date)}</td><td className="font-semibold">{f.ticker}</td><td>{f.side === "BUY" ? "Compra" : "Venda"}</td><td className="num">{num(f.qty)}</td>
                <td className="num">{brl(f.price)}</td><td className="num">{brl(f.fees)}</td><td className="num">{brl(f.qty * f.price, 0)}</td></tr>))}</tbody></table></div>
        ) : <Empty>Nenhuma execução ainda.</Empty>}
      </Card>

      <Card title="Parâmetros do pregão simulado">
        <p className="mb-3 text-xs opacity-70">
          Deslizamento: preço pior que o da faixa em ordens a mercado e stop. Participação: a execução não passa desse percentual do volume do pregão; o restante é cancelado (validade do dia).
          Emolumentos e corretagem: custo por operação. Mudanças valem para as próximas execuções.
        </p>
        <PregaoSettingsForm pg={pg} />
      </Card>

      <Card title="Zerar o pregão simulado">
        <p className="mb-2 text-xs opacity-70">Apaga ordens, execuções e posições e recomeça com o capital informado.</p>
        <PregaoResetForm capital={pg.capital} />
      </Card>
      <Disclaimer />
    </div>
  );
}
