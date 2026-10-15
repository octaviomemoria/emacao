export const brl = (v: number, digits = 2) =>
  Number.isFinite(v) ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
export const pct = (v: number, digits = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(digits).replace(".", ",")}%` : "—");
export const spct = (v: number, digits = 1) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits).replace(".", ",")}%` : "—");
export const num = (v: number, digits = 0) => (Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—");
export const mi = (v: number) => (Number.isFinite(v) ? `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : "—");
export const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
export const tone = (v: number) => (v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "");
