import { notFound } from "next/navigation";
import PregaoView from "@/components/PregaoView";
import { DeleteCarteiraButton } from "@/components/CarteiraForms";
import { Card } from "@/components/ui";
import { cancelOrderAction, placeOrderAction, resetAction, saveParamsAction } from "@/app/carteiras/actions";
import { brl, dmy } from "@/lib/format";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function CarteiraSimulada({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  const carteira = (await store.listCarteiras()).find((c) => c.id === id);
  if (!carteira) notFound();
  const [st, orders, fills, assets, snap] = await Promise.all([
    store.getPregao(id), store.listOrders(id), store.listFills(id), store.getAssets(), store.getSnapshot(),
  ]);
  const tickers = assets.filter((a) => a.enabled).map((a) => a.ticker).sort();
  const refPrices = Object.fromEntries((snap?.signals ?? []).map((s) => [s.ticker, s.price]));

  return (
    <PregaoView
      pid={id}
      title={carteira.name}
      intro={`Carteira simulada criada em ${dmy(carteira.createdAt.slice(0, 10))} com capital inicial de ${brl(carteira.capital, 0)}. Você digita as ordens e o app decide a execução com a faixa de preços do pregão seguinte. Os custos e o deslizamento são os desta carteira.`}
      st={st}
      orders={orders}
      fills={fills}
      pg={carteira.params}
      tickers={tickers}
      refPrices={refPrices}
      actions={{ place: placeOrderAction, params: saveParamsAction, reset: resetAction, cancel: cancelOrderAction }}
      extra={
        <Card title="Excluir carteira">
          <p className="mb-2 text-xs opacity-70">Remove a carteira e tudo o que ela registrou. Essa ação não pode ser desfeita.</p>
          <DeleteCarteiraButton pid={id} />
        </Card>
      }
    />
  );
}
