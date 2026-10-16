"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cancelOrder, createCarteira, deleteCarteira, getParams, placeOrder, resetCarteira, saveParams, type OrderInput } from "@/lib/carteiras";
import { DEFAULT_PREGAO, PREGAO_DEFAULT, type PregaoSettings } from "@/lib/engine/pregao";
import { getStore } from "@/lib/store";

type FormState = { ok?: boolean; error?: string } | null;

const n = (fd: FormData, k: string, d = 0) => {
  const v = parseFloat(String(fd.get(k) ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : d;
};
const pidOf = (fd: FormData) => String(fd.get("pid") || PREGAO_DEFAULT);
const pathOf = (pid: string) => (pid === PREGAO_DEFAULT ? "/pregao" : `/carteiras/${pid}`);

/** lê os parâmetros do formulário, usando `base` para os campos que não vieram */
function paramsFrom(fd: FormData, base: PregaoSettings): Partial<PregaoSettings> {
  return {
    slippage: Math.min(0.05, Math.max(0, n(fd, "slippagePct", base.slippage * 100) / 100)),
    participation: Math.min(1, Math.max(0.001, n(fd, "participationPct", base.participation * 100) / 100)),
    feePct: Math.min(0.01, Math.max(0, n(fd, "feePct", base.feePct * 100) / 100)),
    fixedFee: Math.max(0, n(fd, "fixedFee", base.fixedFee)),
    gapPct: Math.min(1, Math.max(0, n(fd, "gapPct", base.gapPct * 100) / 100)),
  };
}

/** digita uma ordem em uma carteira (pregão padrão ou carteira simulada) */
export async function placeOrderAction(_: FormState, fd: FormData): Promise<FormState> {
  const store = await getStore();
  const pid = pidOf(fd);
  const pg = await getParams(store, pid);
  if (!pg) return { error: "Carteira não encontrada." };
  const typeRaw = String(fd.get("type") ?? "MARKET");
  const input: OrderInput = {
    ticker: String(fd.get("ticker") ?? "").trim().toUpperCase().replace(/\.SA$/, ""),
    side: fd.get("side") === "SELL" ? "SELL" : "BUY",
    type: typeRaw === "LIMIT" ? "LIMIT" : typeRaw === "STOP" ? "STOP" : "MARKET",
    qty: Math.floor(n(fd, "qty")),
    limitPrice: n(fd, "limitPrice") || undefined,
    stopPrice: n(fd, "stopPrice") || undefined,
  };
  const err = await placeOrder(store, pid, pg, input);
  if (err) return { error: err };
  revalidatePath(pathOf(pid));
  revalidatePath("/carteiras");
  return { ok: true };
}

/** cancela uma ordem aberta */
export async function cancelOrderAction(pid: string, id: string) {
  await cancelOrder(await getStore(), pid, id);
  revalidatePath(pathOf(pid));
}

/** altera os parâmetros de uma carteira (custos, deslizamento, participação e gap) */
export async function saveParamsAction(_: FormState, fd: FormData): Promise<FormState> {
  const store = await getStore();
  const pid = pidOf(fd);
  const base = await getParams(store, pid);
  if (!base) return { error: "Carteira não encontrada." };
  await saveParams(store, pid, paramsFrom(fd, base));
  revalidatePath(pathOf(pid));
  return { ok: true };
}

/** zera uma carteira e recomeça com o capital informado */
export async function resetAction(_: FormState, fd: FormData): Promise<FormState> {
  const store = await getStore();
  const pid = pidOf(fd);
  const base = await getParams(store, pid);
  if (!base) return { error: "Carteira não encontrada." };
  const capital = Math.max(1000, n(fd, "capital", base.capital));
  await resetCarteira(store, pid, capital);
  revalidatePath(pathOf(pid));
  revalidatePath("/carteiras");
  return { ok: true };
}

/** cria uma carteira simulada e abre a tela dela */
export async function createCarteiraAction(_: FormState, fd: FormData): Promise<FormState> {
  const name = String(fd.get("name") ?? "").trim();
  if (!name || name.length > 40) return { error: "Dê um nome à carteira (até 40 caracteres)." };
  const capital = n(fd, "capital", 0);
  if (!(capital >= 1000)) return { error: "O capital inicial deve ser de pelo menos R$ 1.000." };
  const store = await getStore();
  const c = await createCarteira(store, { name, capital, params: paramsFrom(fd, DEFAULT_PREGAO) });
  revalidatePath("/carteiras");
  redirect(`/carteiras/${c.id}`);
}

/** apaga uma carteira simulada e tudo o que ela registrou */
export async function deleteCarteiraAction(pid: string) {
  await deleteCarteira(await getStore(), pid);
  revalidatePath("/carteiras");
  redirect("/carteiras");
}
