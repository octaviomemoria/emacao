"use client";
import { useActionState, useState } from "react";
import { placePregaoOrder, resetPregao, savePregaoSettings } from "@/app/actions";
import type { PregaoSettings } from "@/lib/engine/pregao";

type R = { ok?: boolean; error?: string } | null;
const Msg = ({ r }: { r: R }) => (r?.error ? <span className="text-sm text-red-500">{r.error}</span> : r?.ok ? <span className="text-sm text-emerald-500">Feito.</span> : null);
const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 text-xs"><span className="opacity-60">{label}</span>{children}</label>
);
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** formulário de ordem do pregão simulado, com estimativa pelo último fechamento */
export function PregaoTicket({ tickers, refPrices, pg, cashAvail }: { tickers: string[]; refPrices: Record<string, number>; pg: PregaoSettings; cashAvail: number }) {
  const [r, act, pending] = useActionState(placePregaoOrder, null as R);
  const [ticker, setTicker] = useState(tickers[0] ?? "");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [type, setType] = useState<"MARKET" | "LIMIT" | "STOP">("MARKET");
  const [qty, setQty] = useState(100);
  const [limit, setLimit] = useState<number | "">("");
  const [stop, setStop] = useState<number | "">("");

  const ref = refPrices[ticker] ?? 0;
  const est = type === "LIMIT" ? Number(limit) || 0 : type === "STOP" ? Number(stop) || 0
    : side === "BUY" ? ref * (1 + pg.slippage) : ref * (1 - pg.slippage);
  const gross = qty * est;
  const fees = gross * pg.feePct + pg.fixedFee;
  const total = side === "BUY" ? gross + fees : gross - fees;
  const effectiveType = side === "SELL" ? type : type === "STOP" ? "MARKET" : type;

  return (
    <form action={act} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <L label="Ativo">
          <select name="ticker" value={ticker} onChange={(e) => setTicker(e.target.value)}>
            {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </L>
        <L label="Operação">
          <select name="side" value={side} onChange={(e) => { const v = e.target.value as "BUY" | "SELL"; setSide(v); if (v === "BUY" && type === "STOP") setType("MARKET"); }}>
            <option value="BUY">Compra</option>
            <option value="SELL">Venda</option>
          </select>
        </L>
        <L label="Tipo de ordem">
          <select name="type" value={type} onChange={(e) => setType(e.target.value as "MARKET" | "LIMIT" | "STOP")}>
            <option value="MARKET">A mercado</option>
            <option value="LIMIT">Limite</option>
            {side === "SELL" && <option value="STOP">Stop (venda)</option>}
          </select>
        </L>
        <L label="Quantidade (ações)">
          <input name="qty" inputMode="numeric" value={qty} onChange={(e) => setQty(Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0))} />
        </L>
        {effectiveType === "LIMIT" && (
          <L label={side === "BUY" ? "Preço máximo (R$)" : "Preço mínimo (R$)"}>
            <input name="limitPrice" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value === "" ? "" : Number(e.target.value.replace(",", ".")))} />
          </L>
        )}
        {type === "STOP" && side === "SELL" && (
          <L label="Preço de stop (R$)">
            <input name="stopPrice" inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value === "" ? "" : Number(e.target.value.replace(",", ".")))} />
          </L>
        )}
      </div>
      <div className="rounded-lg border border-zinc-500/20 p-3 text-sm">
        <div>Referência (último fechamento): <b>{ref ? brl(ref) : "—"}</b> · valor estimado da operação: <b>{gross ? brl(gross) : "—"}</b> · taxas estimadas: <b>{fees ? brl(fees) : "—"}</b></div>
        <div className="opacity-70">
          {side === "BUY" ? "Custo estimado" : "Recebimento estimado"}: <b>{total ? brl(total) : "—"}</b> · caixa disponível para novas compras: {brl(Math.max(0, cashAvail))}
        </div>
        <div className="mt-1 text-xs opacity-60">
          Executa no próximo pregão, com a faixa daquele dia. Ordens digitadas hoje não executam hoje. Esta é uma estimativa com a faixa diária, não a fila real do pregão.
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Enviando…" : "Enviar ordem"}</button>
        <Msg r={r} />
      </div>
    </form>
  );
}

export function PregaoSettingsForm({ pg }: { pg: PregaoSettings }) {
  const [r, act, pending] = useActionState(savePregaoSettings, null as R);
  return (
    <form action={act} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3">
      <L label="Capital do pregão (R$)"><input name="capital" inputMode="decimal" defaultValue={pg.capital} /></L>
      <L label="Deslizamento (%)"><input name="slippagePct" inputMode="decimal" defaultValue={+(pg.slippage * 100).toFixed(4)} /></L>
      <L label="Máx. do volume do dia (%)"><input name="participationPct" inputMode="decimal" defaultValue={+(pg.participation * 100).toFixed(4)} /></L>
      <L label="Emolumentos (%)"><input name="feePct" inputMode="decimal" defaultValue={+(pg.feePct * 100).toFixed(5)} /></L>
      <L label="Corretagem (R$ por ordem)"><input name="fixedFee" inputMode="decimal" defaultValue={pg.fixedFee} /></L>
      <L label="Alerta de gap na abertura (%)"><input name="gapPct" inputMode="decimal" defaultValue={+(pg.gapPct * 100).toFixed(4)} /></L>
      <div className="flex items-center gap-2 sm:col-span-3">
        <button className="btn" disabled={pending}>{pending ? "Salvando…" : "Salvar parâmetros"}</button>
        <Msg r={r} />
      </div>
    </form>
  );
}

export function PregaoResetForm({ capital }: { capital: number }) {
  const [r, act, pending] = useActionState(resetPregao, null as R);
  return (
    <form action={act} className="flex flex-wrap items-end gap-2" onSubmit={(e) => { if (!confirm("Zerar o pregão simulado? Ordens, execuções e posições serão apagadas.")) e.preventDefault(); }}>
      <L label="Capital inicial (R$)"><input name="capital" inputMode="decimal" defaultValue={capital} /></L>
      <button className="btn ghost" disabled={pending}>{pending ? "Zerando…" : "Zerar pregão"}</button>
      <Msg r={r} />
    </form>
  );
}
