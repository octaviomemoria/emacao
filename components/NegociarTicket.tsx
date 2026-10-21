"use client";
import { useActionState, useState } from "react";
import { placeOrderAction } from "@/app/carteiras/actions";
import type { PregaoSettings } from "@/lib/engine/pregao";

type R = { ok?: boolean; error?: string } | null;

export interface NegociarPool {
  id: string;
  name: string;
  params: PregaoSettings;
  cashAvail: number; // caixa livre (sem reservas de ordens abertas)
  held: number; // ações do ativo na carteira
  reservedSell: number; // ações do ativo já reservadas em venda aberta
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 text-xs"><span className="opacity-60">{label}</span>{children}</label>
);

/** tela de negociação de um ativo: escolhe a carteira, digita a ordem e vê a estimativa */
export function NegociarTicket({ ticker, refPrice, pools }: { ticker: string; refPrice: number; pools: NegociarPool[] }) {
  const [r, act, pending] = useActionState(placeOrderAction, null as R);
  const [pid, setPid] = useState(pools[0]?.id ?? "");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [type, setType] = useState<"MARKET" | "LIMIT" | "STOP">("MARKET");
  const [qty, setQty] = useState(100);
  const [limit, setLimit] = useState<number | "">("");
  const [stop, setStop] = useState<number | "">("");

  const pool = pools.find((p) => p.id === pid) ?? pools[0];
  const pg = pool.params;
  const effectiveType = side === "SELL" ? type : type === "STOP" ? "MARKET" : type;
  const est = effectiveType === "LIMIT" ? Number(limit) || 0 : effectiveType === "STOP" ? Number(stop) || 0
    : side === "BUY" ? refPrice * (1 + pg.slippage) : refPrice * (1 - pg.slippage);
  const gross = qty * est;
  const fees = gross * pg.feePct + pg.fixedFee;
  const total = side === "BUY" ? gross + fees : gross - fees;
  const sellAvail = Math.max(0, pool.held - pool.reservedSell);

  return (
    <form action={act} className="flex flex-col gap-3">
      <input type="hidden" name="ticker" value={ticker} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <L label="Carteira">
          <select name="pid" value={pid} onChange={(e) => setPid(e.target.value)}>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
        <div>Referência (último fechamento): <b>{refPrice ? brl(refPrice) : "—"}</b> · valor estimado: <b>{gross ? brl(gross) : "—"}</b> · taxas estimadas: <b>{fees ? brl(fees) : "—"}</b></div>
        <div className="opacity-70">
          {side === "BUY"
            ? <>Custo estimado: <b>{total ? brl(total) : "—"}</b> · caixa livre na carteira: {brl(Math.max(0, pool.cashAvail))}</>
            : <>Recebimento estimado: <b>{total ? brl(total) : "—"}</b> · você pode vender até {sellAvail} ação(ões) de {ticker}</>}
        </div>
        <div className="mt-1 text-xs opacity-60">
          Executa no próximo pregão, com a faixa daquele dia. Ordens digitadas hoje não executam hoje. É uma estimativa com a faixa diária, não a fila real.
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Enviando…" : "Enviar ordem"}</button>
        {r?.error && <span className="text-sm text-red-500">{r.error}</span>}
        {r?.ok && <span className="text-sm text-emerald-500">Ordem registrada. Ela executa no próximo pregão.</span>}
      </div>
    </form>
  );
}
