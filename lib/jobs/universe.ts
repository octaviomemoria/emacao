import { computeSeries } from "@/lib/engine/signals";
import { buildAsset, buildUniverse, type Universe } from "@/lib/engine/simulation";
import type { Params } from "@/lib/engine/types";
import type { Store } from "@/lib/store/types";
import { isExterior } from "@/lib/tickers";

/** monta o universo (preços salvos + sinais) para simulações e backtests a partir do que está no banco; sem ações estrangeiras */
export async function loadUniverse(store: Store, params: Params): Promise<{ u: Universe; cdi: Map<string, number>; bova: Map<string, number>; lastDate: string; firstDate: string }> {
  const assets = (await store.getAssets()).filter((a) => a.enabled && !isExterior(a));
  const list = [];
  const bova = new Map<string, number>();
  for (const a of assets) {
    const c = await store.getPrices(a.ticker);
    if (c.length < params.N + 5) continue;
    if (a.ticker === "BOVA11") c.forEach((x) => bova.set(x.date, x.close));
    list.push(buildAsset(a.ticker, c, computeSeries(c, params)));
  }
  const u = buildUniverse(list);
  return { u, cdi: new Map(Object.entries(await store.getCdi())), bova, lastDate: u.dates[u.dates.length - 1] ?? "", firstDate: u.dates[0] ?? "" };
}
