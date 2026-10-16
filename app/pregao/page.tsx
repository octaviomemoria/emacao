import PregaoView from "@/components/PregaoView";
import { cancelOrderAction, placeOrderAction, resetAction, saveParamsAction } from "@/app/carteiras/actions";
import { PREGAO_DEFAULT } from "@/lib/engine/pregao";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Pregao() {
  const store = await getStore();
  const [settings, st, orders, fills, assets, snap] = await Promise.all([
    store.getSettings(), store.getPregao(PREGAO_DEFAULT), store.listOrders(PREGAO_DEFAULT), store.listFills(PREGAO_DEFAULT), store.getAssets(), store.getSnapshot(),
  ]);
  const tickers = assets.filter((a) => a.enabled).map((a) => a.ticker).sort();
  const refPrices = Object.fromEntries((snap?.signals ?? []).map((s) => [s.ticker, s.price]));

  return (
    <PregaoView
      pid={PREGAO_DEFAULT}
      title="Pregão simulado"
      intro="Você digita as ordens e o app decide a execução com a faixa de preços do pregão seguinte (abertura, máxima, mínima e volume brutos). Não há livro de ofertas nem fila: o preenchimento é uma estimativa. Esta carteira é separada da regra automática e da sua carteira real. Para carteiras com outros capitais e parâmetros, use Simuladas."
      st={st}
      orders={orders}
      fills={fills}
      pg={settings.pregao}
      tickers={tickers}
      refPrices={refPrices}
      actions={{ place: placeOrderAction, params: saveParamsAction, reset: resetAction, cancel: cancelOrderAction }}
    />
  );
}
