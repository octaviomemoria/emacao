import Link from "next/link";
import { CarteiraCreateForm } from "@/components/CarteiraForms";
import { Badge, Card, Disclaimer, Empty, Stat } from "@/components/ui";
import { brl, dmy, pct, spct, tone } from "@/lib/format";
import { pregaoEquity, PREGAO_DEFAULT, type PregaoState } from "@/lib/engine/pregao";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Carteiras() {
  const store = await getStore();
  const [list, settings] = await Promise.all([store.listCarteiras(), store.getSettings()]);
  const rows = await Promise.all(list.map(async (c) => ({
    c,
    st: await store.getPregao(c.id),
    open: (await store.listOrders(c.id)).filter((o) => o.status === "OPEN").length,
  })));
  const defaultSt = await store.getPregao(PREGAO_DEFAULT);
  const defaultOpen = (await store.listOrders(PREGAO_DEFAULT)).filter((o) => o.status === "OPEN").length;

  const summary = (st: PregaoState | null, capital: number) => {
    const equity = st ? pregaoEquity(st) : capital;
    const cdi = st ? st.curve[st.curve.length - 1].cdiNet / capital - 1 : 0;
    return { equity, ret: equity / capital - 1, cdi };
  };
  const dflt = summary(defaultSt, settings.pregao.capital);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Carteiras simuladas</h1>
        <p className="text-xs opacity-60">
          Crie quantas carteiras quiser para testar cenários. Cada uma tem nome, capital inicial e parâmetros próprios
          (custos, deslizamento e participação no volume). Elas operam como o pregão simulado e são independentes umas das outras e da sua carteira real.
        </p>
      </div>

      <Card title="Nova carteira simulada">
        <CarteiraCreateForm defaults={{
          slippagePct: +(settings.pregao.slippage * 100).toFixed(4),
          participationPct: +(settings.pregao.participation * 100).toFixed(4),
          feePct: +(settings.pregao.feePct * 100).toFixed(5),
          fixedFee: settings.pregao.fixedFee,
          gapPct: +(settings.pregao.gapPct * 100).toFixed(4),
          impactEta: settings.pregao.impactEta,
          capital: 100000,
        }} />
      </Card>

      <Card title={`Carteiras (${list.length})`}>
        {rows.length ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {rows.map(({ c, st, open }) => {
              const s = summary(st, c.capital);
              return (
                <Link key={c.id} href={`/carteiras/${c.id}`} className="rounded-xl border border-zinc-500/20 p-4 hover:bg-zinc-500/5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-semibold">{c.name}</span>
                    <Badge tone={open ? "amber" : "gray"}>{open} aberta(s)</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Patrimônio" value={brl(s.equity, 0)} sub={`capital ${brl(c.capital, 0)}`} />
                    <Stat label="Resultado" value={spct(s.ret)} className={tone(s.ret)} sub={`CDI líq. ${spct(s.cdi)}`} />
                  </div>
                  <div className="mt-2 text-xs opacity-60">criada em {dmy(c.createdAt.slice(0, 10))} · deslizamento {pct(c.params.slippage, 2)}</div>
                </Link>
              );
            })}
          </div>
        ) : <Empty>Nenhuma carteira simulada ainda. Crie a primeira acima.</Empty>}
      </Card>

      <Card title="Pregão simulado (carteira padrão)">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>Capital {brl(settings.pregao.capital, 0)} · patrimônio {brl(dflt.equity, 0)} · resultado <span className={tone(dflt.ret)}>{spct(dflt.ret)}</span> · {defaultOpen} ordem(ns) aberta(s)</span>
          <Link href="/pregao" className="text-xs underline">abrir o pregão →</Link>
        </div>
      </Card>
      <Disclaimer />
    </div>
  );
}
