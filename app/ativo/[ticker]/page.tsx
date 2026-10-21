import Link from "next/link";
import { notFound } from "next/navigation";
import LineChart from "@/components/LineChart";
import { NegociarTicket, type NegociarPool } from "@/components/NegociarTicket";
import { Badge, Card, Disclaimer, Empty, Stat } from "@/components/ui";
import { brl, dmy, mi, pct, spct, tone } from "@/lib/format";
import { computeSeries } from "@/lib/engine/signals";
import { PREGAO_DEFAULT, pregaoEquity } from "@/lib/engine/pregao";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Ativo({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const T = raw.toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(T)) notFound();

  const store = await getStore();
  const [snap, settings, carteiras, candles] = await Promise.all([
    store.getSnapshot(), store.getSettings(), store.listCarteiras(), store.getPrices(T),
  ]);
  const sig = snap?.signals.find((s) => s.ticker === T);
  if (!sig && !candles.length) notFound();
  const p = settings.params;
  const last = candles[candles.length - 1];
  const refPrice = last ? (last.raw?.close ?? last.close) : sig?.price ?? 0;

  // carteiras de pregão disponíveis para negociar este ativo
  const pools = [
    { id: PREGAO_DEFAULT, name: "Pregão simulado (padrão)", params: settings.pregao },
    ...carteiras.map((c) => ({ id: c.id, name: c.name, params: c.params })),
  ];
  const details = await Promise.all(pools.map(async (pool) => {
    const st = await store.getPregao(pool.id);
    const orders = await store.listOrders(pool.id);
    const open = orders.filter((o) => o.status === "OPEN");
    const reservedCash = open.filter((o) => o.side === "BUY").reduce((a, o) => a + o.qty * (o.estPrice ?? 0) * (1 + pool.params.feePct) + pool.params.fixedFee, 0);
    const pos = st?.positions.find((x) => x.ticker === T);
    const reservedSell = open.filter((o) => o.side === "SELL" && o.ticker === T).reduce((a, o) => a + o.qty, 0);
    return {
      ...pool,
      st,
      orders: orders.filter((o) => o.ticker === T),
      equity: st ? pregaoEquity(st) : pool.params.capital,
      capital: st?.initialCapital ?? pool.params.capital,
      cashAvail: (st?.cash ?? pool.params.capital) - reservedCash,
      held: pos?.qty ?? 0,
      avgCost: pos?.avgCost ?? 0,
      lastPrice: pos?.lastPrice ?? refPrice,
      reservedSell,
    };
  }));
  const negPools: NegociarPool[] = details.map((d) => ({
    id: d.id, name: d.name, params: d.params, cashAvail: d.cashAvail, held: d.held, reservedSell: d.reservedSell,
  }));
  const holdings = details.filter((d) => d.held > 0);
  const allOrders = details.flatMap((d) => d.orders.map((o) => ({ ...o, carteira: d.name })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25);

  // gráfico: fechamento e canais de Donchian dos últimos 260 pregões
  let chart = <Empty>Sem histórico suficiente para o gráfico.</Empty>;
  if (candles.length > p.N + 5) {
    const s = computeSeries(candles, p);
    const c = candles.slice(-260);
    const off = candles.length - c.length;
    const pts = (f: (i: number) => number) => c.map((x, i) => ({ x: x.date, y: f(off + i) })).filter((q) => Number.isFinite(q.y));
    chart = (
      <LineChart height={260} series={[
        { name: "Fechamento", color: "#0ea5e9", points: c.map((x) => ({ x: x.date, y: x.close })) },
        { name: `Máx. ${p.N} dias (compra acima)`, color: "#10b981", dashed: true, points: pts((i) => s.hh[i]) },
        { name: `Mín. ${p.M} dias (venda abaixo)`, color: "#ef4444", dashed: true, points: pts((i) => s.ll[i]) },
      ]} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{T}</h1>
          <p className="text-xs opacity-60">
            {last ? <>Último pregão {dmy(last.date)} · preço bruto {brl(refPrice)}</> : "Sem preços salvos"}
          </p>
        </div>
        <Link href="/radar" className="text-xs underline">← voltar ao Radar</Link>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          <Stat label="Estado" value={sig ? (sig.isNewBreakout ? "rompimento novo" : sig.isNewExit ? "saída nova" : sig.state === 1 ? "em tendência" : "fora") : "—"} />
          <Stat label="Compra acima de" value={sig ? brl(sig.buyLevel) : "—"} sub={sig && sig.state !== 1 ? `falta ${spct(sig.distBuyPct)}` : undefined} />
          <Stat label="Venda abaixo de" value={sig ? brl(sig.stopLevel) : "—"} sub={sig && sig.state === 1 ? `distância ${spct(sig.distStopPct)}` : undefined} />
          <Stat label="Dias no estado" value={sig?.daysInState ?? "—"} />
          <Stat label="Liquidez/dia" value={sig ? mi(sig.liq60) : "—"} />
          <Stat label="Aviso" value={sig?.anomaly ? "dado suspeito" : sig && !sig.active ? "pouca negociação" : "nenhum"} className={sig?.anomaly || (sig && !sig.active) ? "text-amber-500" : ""} />
        </div>
        <p className="mt-3 text-xs opacity-60">
          Regra do setup: compra quando o fechamento supera a máxima dos últimos {p.N} pregões; venda quando cai abaixo da mínima dos últimos {p.M}. Os níveis valem para o próximo pregão.
        </p>
      </Card>

      <Card title="Gráfico">{chart}</Card>

      <Card title="Negociar">
        {negPools.length ? (
          <NegociarTicket ticker={T} refPrice={refPrice} pools={negPools} />
        ) : <Empty>Nenhuma carteira disponível.</Empty>}
      </Card>

      <Card title={`Posições em ${T} (${holdings.length} carteira(s))`}>
        {holdings.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Carteira</th><th className="num">Qtd</th><th className="num">Preço médio</th><th className="num">Último</th><th className="num">Valor</th><th className="num">Resultado</th></tr></thead>
            <tbody>{holdings.map((d) => (
              <tr key={d.id}><td>{d.name}</td><td className="num">{d.held}</td><td className="num">{brl(d.avgCost)}</td><td className="num">{brl(d.lastPrice)}</td>
                <td className="num">{brl(d.held * d.lastPrice, 0)}</td><td className={`num ${tone(d.lastPrice / d.avgCost - 1)}`}>{spct(d.lastPrice / d.avgCost - 1)}</td></tr>))}</tbody></table></div>
        ) : <Empty>Você não tem {T} em nenhuma carteira simulada.</Empty>}
      </Card>

      <Card title={`Ordens em ${T} (últimas ${allOrders.length})`}>
        {allOrders.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Digitada</th><th>Carteira</th><th>Op.</th><th>Tipo</th><th className="num">Qtd</th><th>Status</th><th className="num">Executada</th><th className="num">Preço</th></tr></thead>
            <tbody>{allOrders.map((o) => (
              <tr key={o.id}><td>{dmy(o.createdDate)}</td><td>{o.carteira}</td><td>{o.side === "BUY" ? "Compra" : "Venda"}</td>
                <td>{o.type === "MARKET" ? "a mercado" : o.type === "LIMIT" ? `limite ${brl(o.limitPrice ?? 0)}` : `stop ${brl(o.stopPrice ?? 0)}`}</td>
                <td className="num">{o.qty}</td><td><Badge tone={o.status === "EXECUTED" ? "green" : o.status === "OPEN" ? "amber" : o.status === "BLOCKED" ? "red" : "gray"}>{o.status === "OPEN" ? "aberta" : o.status === "EXECUTED" ? "executada" : o.status === "PARTIAL" ? "parcial" : o.status === "BLOCKED" ? "bloqueada" : o.status === "CANCELLED" ? "cancelada" : "não executada"}</Badge></td>
                <td className="num">{o.filledQty || "—"}</td><td className="num">{o.avgPrice ? brl(o.avgPrice) : "—"}</td></tr>))}</tbody></table></div>
        ) : <Empty>Nenhuma ordem em {T} ainda.</Empty>}
      </Card>
      <p className="text-xs opacity-50">Carteira padrão: {pct(settings.pregao.slippage, 2)} de deslizamento · as carteiras simuladas têm parâmetros próprios.</p>
      <Disclaimer />
    </div>
  );
}
