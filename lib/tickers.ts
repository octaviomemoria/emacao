import type { Asset } from "@/lib/store/types";

/** ticker digitado: da B3 (PETR4, BOVA11) ou do exterior (AAPL, BRK-B) */
export const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

/** ações estrangeiras: cotação em dólar convertida para reais pelo câmbio do dia */
export const isExterior = (a: { market?: string }) => a.market === "EXT";

/** símbolo no Yahoo: a B3 usa o sufixo .SA; as ações estrangeiras usam o próprio ticker */
export const yahooSymbol = (a: Pick<Asset, "ticker" | "market">) => (isExterior(a) ? a.ticker : `${a.ticker}.SA`);
