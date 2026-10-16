import { TxForm } from "@/components/forms";
import { Badge, Card, Disclaimer, Empty } from "@/components/ui";
import { deleteTx } from "@/app/actions";
import { brl, dmy, spct, tone } from "@/lib/format";
import { realPositions, taxMonths } from "@/lib/engine/real";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Carteira() {
  const store = (await getStore());
  const [txs, snap, sim, settings, pregaoFills] = await Promise.all([store.listTx(), store.getSnapshot(), store.getSim(), store.getSettings(), store.listFills()]);
  const pregaoTaxes = taxMonths(
    pregaoFills.map((f) => ({ id: f.id, date: f.date, ticker: f.ticker, side: f.side, qty: f.qty, price: f.price, fees: f.fees })),
    { etfs: settings.etfs, useExemption: settings.useExemption, rate: settings.params.taxRate },
  );
  const sig = new Map((snap?.signals ?? []).map((s) => [s.ticker, s]));
  const pos = realPositions(txs);
  const simSet = new Set((sim?.positions ?? []).map((x) => x.ticker));
  const realSet = new Set(pos.map((x) => x.ticker));
  const taxes = taxMonths(txs, { etfs: settings.etfs, useExemption: settings.useExemption, rate: settings.params.taxRate });
  const totalValue = pos.reduce((a, x) => a + x.qty * (sig.get(x.ticker)?.price ?? x.avgCost), 0);
  const totalCost = pos.reduce((a, x) => a + x.qty * x.avgCost, 0);

  const divergences: { ticker: string; kind: string; tone: "amber" | "red" | "blue" }[] = [];
  for (const x of pos) {
    const s = sig.get(x.ticker);
    if (s?.state === 0) divergences.push({ ticker: x.ticker, kind: "Você tem, mas o sinal é de SAÍDA", tone: "red" });
    else if (sim && !simSet.has(x.ticker)) divergences.push({ ticker: x.ticker, kind: "Você tem, a simulação não (fora das regras ou sem vaga)", tone: "amber" });
  }
  if (txs.length) for (const t of simSet) if (!realSet.has(t)) divergences.push({ ticker: t, kind: "A simulação tem, você não", tone: "blue" });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Minha carteira (real)</h1>
        <p className="text-xs opacity-60">Registre aqui as compras e vendas que você fez na corretora. O app calcula preço médio, resultado, divergências em relação à simulação e o IR do mês. Nada é enviado à corretora.</p>
      </div>
      <Card title="Registrar operação"><TxForm /></Card>

      <Card title={`Posições (${pos.length})`} right={pos.length ? <span className="text-xs opacity-70">Custo {brl(totalCost, 0)} · valor {brl(totalValue, 0)} · <span className={tone(totalValue - totalCost)}>{spct(totalValue / totalCost - 1)}</span></span> : undefined}>
        {pos.length ? (
          <div className="table-wrap"><table className="t"><thead><tr><th>Ativo</th><th className="num">Qtd</th><th className="num">Preço médio</th><th className="num">Atual</th><th className="num">Resultado</th><th>Sinal</th><th className="num">Sai se fechar &lt;</th></tr></thead>
            <tbody>{pos.map((x) => {
              const s = sig.get(x.ticker); const now = s?.price ?? x.avgCost; const r = now / x.avgCost - 1;
              return (<tr key={x.ticker}><td className="font-semibold">{x.ticker}</td><td className="num">{x.qty}</td><td className="num">{brl(x.avgCost)}</td><td className="num">{brl(now)}</td><td className={`num ${tone(r)}`}>{spct(r)}</td>
                <td>{!s ? <Badge>sem dados</Badge> : s.state === 1 ? <Badge tone="green">manter</Badge> : <Badge tone="red">vender</Badge>}</td><td className="num">{s ? brl(s.stopLevel) : "—"}</td></tr>);
            })}</tbody></table></div>
        ) : <Empty>Nenhuma posição registrada.</Empty>}
      </Card>

      <Card title={`Divergências com a simulação (${divergences.length})`}>
        {divergences.length ? <ul className="flex flex-col gap-2 text-sm">{divergences.map((d) => (<li key={d.ticker + d.kind}><Badge tone={d.tone}>{d.ticker}</Badge> {d.kind}</li>))}</ul> : <Empty>{txs.length ? "Sua carteira está alinhada com a simulação." : "Registre operações para comparar."}</Empty>}
      </Card>

      <Card title="Imposto de renda por mês (swing trade)">
        <p className="mb-2 text-xs opacity-60">Preço médio, {Math.round(settings.params.taxRate * 100)}% sobre o lucro líquido do mês, com compensação de prejuízos anteriores{settings.useExemption ? " e isenção de vendas de ações até R$ 20 mil/mês" : " (sem a isenção de R$ 20 mil — pior caso; ative em Configurações)"}. DARF código 6015, vence no último dia útil do mês seguinte (confira feriados). Estimativa: confirme com seu contador.</p>
        {taxes.length ? (
          <div className="table-wrap"><table className="t"><thead><tr><th>Mês</th><th className="num">Vendas ações</th><th className="num">Lucro ações</th><th className="num">Lucro ETF</th><th className="num">Prejuízo usado</th><th className="num">Base</th><th className="num">IR (DARF)</th><th>Vence</th><th>Avisos</th></tr></thead>
            <tbody>{[...taxes].reverse().map((t) => (
              <tr key={t.month}><td>{t.month}</td><td className="num">{brl(t.salesTotal, 0)}</td><td className={`num ${tone(t.gainStocks)}`}>{brl(t.gainStocks, 0)}</td><td className={`num ${tone(t.gainEtf)}`}>{brl(t.gainEtf, 0)}</td>
                <td className="num">{brl(t.lossUsed, 0)}</td><td className="num">{brl(t.taxableBase, 0)}</td><td className="num font-semibold">{brl(t.tax, 2)}</td><td>{t.tax > 0 ? dmy(t.dueDate) : "—"}</td>
                <td>{t.exempt && <Badge tone="green">isento</Badge>} {t.dayTradeWarning && <Badge tone="amber">day trade (20%): apurar à parte</Badge>}</td></tr>))}</tbody></table></div>
        ) : <Empty>Sem vendas registradas.</Empty>}
      </Card>

      <Card title="Imposto de renda do pregão simulado (estimativa)">
        <p className="mb-2 text-xs opacity-60">Mesma regra da carteira real, aplicada às execuções do pregão simulado. Não é imposto pago de verdade: serve para simular o efeito fiscal da sua estratégia.</p>
        {pregaoTaxes.length ? (
          <div className="table-wrap"><table className="t"><thead><tr><th>Mês</th><th className="num">Vendas ações</th><th className="num">Lucro ações</th><th className="num">Prejuízo usado</th><th className="num">IR</th><th>Vence</th></tr></thead>
            <tbody>{[...pregaoTaxes].reverse().map((t) => (
              <tr key={t.month}><td>{t.month}</td><td className="num">{brl(t.salesTotal, 0)}</td><td className={`num ${tone(t.gainStocks)}`}>{brl(t.gainStocks, 0)}</td>
                <td className="num">{brl(t.lossUsed, 0)}</td><td className="num font-semibold">{brl(t.tax, 2)}</td><td>{t.tax > 0 ? dmy(t.dueDate) : "—"}</td></tr>))}</tbody></table></div>
        ) : <Empty>Nenhuma execução de venda no pregão simulado.</Empty>}
      </Card>

      <Card title={`Histórico de operações (${txs.length})`}>
        {txs.length ? (
          <div className="table-wrap"><table className="t"><thead><tr><th>Data</th><th>Ativo</th><th>Op.</th><th className="num">Qtd</th><th className="num">Preço</th><th className="num">Taxas</th><th>Nota</th><th /></tr></thead>
            <tbody>{[...txs].reverse().map((t) => (
              <tr key={t.id}><td>{dmy(t.date)}</td><td className="font-semibold">{t.ticker}</td><td>{t.side === "BUY" ? "Compra" : "Venda"}</td><td className="num">{t.qty}</td><td className="num">{brl(t.price)}</td><td className="num">{brl(t.fees)}</td><td className="opacity-70">{t.note}</td>
                <td><form action={deleteTx.bind(null, t.id)}><button className="text-xs underline opacity-60 hover:opacity-100">excluir</button></form></td></tr>))}</tbody></table></div>
        ) : <Empty>Nenhuma operação registrada.</Empty>}
      </Card>
      <Disclaimer />
    </div>
  );
}
