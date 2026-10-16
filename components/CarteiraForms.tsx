"use client";
import { useActionState } from "react";
import { createCarteiraAction, deleteCarteiraAction } from "@/app/carteiras/actions";

type R = { ok?: boolean; error?: string } | null;
const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 text-xs"><span className="opacity-60">{label}</span>{children}</label>
);

/** cria uma carteira simulada com nome, capital inicial e parâmetros próprios */
export function CarteiraCreateForm({ defaults }: {
  defaults: { slippagePct: number; participationPct: number; feePct: number; fixedFee: number; gapPct: number; capital: number };
}) {
  const [r, act, pending] = useActionState(createCarteiraAction, null as R);
  return (
    <form action={act} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
      <L label="Nome da carteira"><input name="name" placeholder="ex.: Teste conservador" required /></L>
      <L label="Capital inicial (R$)"><input name="capital" inputMode="decimal" defaultValue={defaults.capital} required /></L>
      <L label="Deslizamento (%)"><input name="slippagePct" inputMode="decimal" defaultValue={defaults.slippagePct} /></L>
      <L label="Máx. do volume do dia (%)"><input name="participationPct" inputMode="decimal" defaultValue={defaults.participationPct} /></L>
      <L label="Emolumentos (%)"><input name="feePct" inputMode="decimal" defaultValue={defaults.feePct} /></L>
      <L label="Corretagem (R$ por ordem)"><input name="fixedFee" inputMode="decimal" defaultValue={defaults.fixedFee} /></L>
      <L label="Alerta de gap (%)"><input name="gapPct" inputMode="decimal" defaultValue={defaults.gapPct} /></L>
      <div className="flex items-center gap-2">
        <button className="btn" disabled={pending}>{pending ? "Criando…" : "Criar carteira"}</button>
        {r?.error && <span className="text-sm text-red-500">{r.error}</span>}
      </div>
    </form>
  );
}

/** apaga a carteira simulada depois de confirmar */
export function DeleteCarteiraButton({ pid }: { pid: string }) {
  const action = deleteCarteiraAction.bind(null, pid);
  return (
    <form action={action} onSubmit={(e) => { if (!confirm("Excluir esta carteira? Ordens, execuções e posições serão apagadas.")) e.preventDefault(); }}>
      <button className="btn ghost">Excluir carteira</button>
    </form>
  );
}
