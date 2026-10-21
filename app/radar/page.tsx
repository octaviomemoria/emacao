import Link from "next/link";
import LineChart from "@/components/LineChart";
import { Badge, Card, Disclaimer, Empty } from "@/components/ui";
import { brl, dmy, mi, spct } from "@/lib/format";
import { computeSeries } from "@/lib/engine/signals";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["all", "Todos"], ["new", "Rompimento novo"], ["trend", "Em tendência"], ["near", "Perto do gatilho"], ["out", "Fora"], ["exit", "Saída nova"], ["warn", "Com aviso"],
] as const;

export default async function Radar({ searchParams }: { searchParams: Promise<{ estado?: string; t?: string; q?: string }> }) {
  const { estado = "all", t, q = "" } = await searchParams;
  const store = (await getStore());
  const [snap, settings] = await Promise.all([store.getSnapshot(), store.getSettings()]);
  if (!snap) return <Empty>Sem dados ainda. Faça a primeira atualização na tela Hoje.</Empty>;
  const p = settings.params;
  let rows = snap.signals.filter((s) => s.ok);
  const match: Record<string, (s: (typeof rows)[number]) => boolean> = {
    all: () => true, new: (s) => s.isNewBreakout, trend: (s) => s.state === 1, out: (s) => s.state === 0, exit: (s) => s.isNewExit,
    near: (s) => s.state === 0 && s.distBuyPct <= settings.nearTriggerPct, warn: (s) => !!s.anomaly || !s.active,
  };
  rows = rows.filter(match[estado] ?? match.all).filter((s) => !q || s.ticker.includes(q.toUpperCase()));
  rows.sort((a, b) => b.liq60 - a.liq60);

  let chart = null;
  if (t) {
    const c = (await store.getPrices(t.toUpperCase())).slice(-260);
    if (c.length > p.N + 5) {
      const full = await store.getPrices(t.toUpperCase());
      const s = computeSeries(full, p);
      const off = full.length - c.length;
      const pts = (f: (i: number) => number) => c.map((x, i) => ({ x: x.date, y: f(off + i) })).filter((q2) => Number.isFinite(q2.y));
      chart = (
        <Card title={`${t.toUpperCase()} — fechamento e canais`}>
          <LineChart height={260} series={[
            { name: "Fechamento", color: "#0ea5e9", points: c.map((x) => ({ x: x.date, y: x.close })) },
            { name: `Máx. ${p.N} dias (compra acima)`, color: "#10b981", dashed: true, points: pts((i) => s.hh[i]) },
            { name: `Mín. ${p.M} dias (venda abaixo)`, color: "#ef4444", dashed: true, points: pts((i) => s.ll[i]) },
          ]} />
        </Card>
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Radar</h1>
        <p className="text-xs opacity-60">Fechamento de {dmy(snap.date)} · {rows.length} de {snap.signals.length} ativos · ordenado por liquidez</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={`/radar?estado=${k}`} className={`rounded-full border px-3 py-1 text-xs ${estado === k ? "border-transparent bg-zinc-500/30 font-semibold" : "border-zinc-500/30 opacity-70"}`}>{label}</Link>
        ))}
        <form className="ml-auto"><input type="hidden" name="estado" value={estado} /><input name="q" placeholder="buscar ticker" defaultValue={q} className="w-32" /></form>
      </div>
      {chart}
      <Card>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Ativo</th><th>Estado</th><th className="num">Preço</th><th className="num">Compra acima de</th><th className="num">Falta</th><th className="num">Venda abaixo de</th><th className="num">Margem</th><th className="num">Dias</th><th className="num">Liquidez/dia</th><th>Avisos</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.ticker}>
                  <td><Link href={`/ativo/${s.ticker}`} className="font-semibold hover:underline">{s.ticker}</Link></td>
                  <td>{s.isNewBreakout ? <Badge tone="blue">rompimento novo</Badge> : s.isNewExit ? <Badge tone="red">saída nova</Badge> : s.state === 1 ? <Badge tone="green">em tendência</Badge> : <Badge>fora</Badge>}</td>
                  <td className="num">{brl(s.price)}</td>
                  <td className="num">{brl(s.buyLevel)}</td><td className="num">{s.state === 1 ? "—" : spct(s.distBuyPct)}</td>
                  <td className="num">{brl(s.stopLevel)}</td><td className="num">{s.state === 1 ? spct(s.distStopPct) : "—"}</td>
                  <td className="num">{s.daysInState}</td><td className="num">{mi(s.liq60)}</td>
                  <td>{s.anomaly && <Badge tone="amber">dado suspeito</Badge>} {!s.active && <Badge tone="amber">pouca negociação</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty>Nenhum ativo neste filtro.</Empty>}
        </div>
      </Card>
      {snap.skipped.length > 0 && (
        <Card title="Ignorados nesta rodada"><ul className="text-sm opacity-80">{snap.skipped.map((k) => (<li key={k.ticker + k.reason}><b>{k.ticker}</b>: {k.reason}</li>))}</ul></Card>
      )}
      <Disclaimer />
    </div>
  );
}
