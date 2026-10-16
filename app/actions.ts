"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkPassword, makeSession, sessionCookieName, sessionMaxAge } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import { runUntil, startSim } from "@/lib/engine/simulation";
import { newPregaoState, type PregaoOrder } from "@/lib/engine/pregao";
import { runDaily } from "@/lib/jobs/daily";
import { ensurePregaoState } from "@/lib/jobs/pregao";
import { loadUniverse } from "@/lib/jobs/universe";
import { notifyAll } from "@/lib/notify/dispatch";
import { nowBRT } from "@/lib/providers/yahoo";
import { getStore } from "@/lib/store";
import type { Asset } from "@/lib/store/types";

type FormState = { ok?: boolean; error?: string } | null;
const brlTxt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const ok = await checkPassword(String(fd.get("password") ?? ""));
  if (!ok) return { error: "Senha incorreta." };
  (await cookies()).set(sessionCookieName, await makeSession(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: sessionMaxAge, path: "/" });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(sessionCookieName);
  redirect("/login");
}

const n = (fd: FormData, k: string, d = 0) => {
  const v = parseFloat(String(fd.get(k) ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : d;
};

export async function addTx(_: FormState, fd: FormData): Promise<FormState> {
  const ticker = String(fd.get("ticker") ?? "").trim().toUpperCase().replace(/\.SA$/, "");
  const side = fd.get("side") === "SELL" ? "SELL" : "BUY";
  const date = String(fd.get("date") ?? "");
  const qty = n(fd, "qty"), price = n(fd, "price"), fees = n(fd, "fees");
  if (!/^[A-Z0-9]{4,6}$/.test(ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || qty <= 0 || price <= 0) return { error: "Confira ticker, data, quantidade e preço." };
  await (await getStore()).addTx({ date, ticker, side, qty, price, fees, note: String(fd.get("note") ?? "") || undefined });
  revalidatePath("/carteira");
  return { ok: true };
}

export async function deleteTx(id: string) {
  await (await getStore()).deleteTx(id);
  revalidatePath("/carteira");
}

export async function markRead(ids: string[] | "all") {
  await (await getStore()).markAlertsRead(ids);
  revalidatePath("/alertas");
  revalidatePath("/");
}

export async function saveSettings(_: FormState, fd: FormData): Promise<FormState> {
  const store = (await getStore());
  const s = await store.getSettings();
  s.params = {
    ...s.params,
    N: Math.max(5, Math.round(n(fd, "N", s.params.N))),
    M: Math.max(2, Math.round(n(fd, "M", s.params.M))),
    filter: fd.get("filter") === "up200" ? "up200" : "none",
    frac: Math.min(1, Math.max(0.01, n(fd, "fracPct", s.params.frac * 100) / 100)),
    maxPos: Math.max(1, Math.round(n(fd, "maxPos", s.params.maxPos))),
    costSide: Math.max(0, n(fd, "costRoundTripPct", s.params.costSide * 200) / 200),
    fixedFee: Math.max(0, n(fd, "fixedFee", s.params.fixedFee)),
    taxRate: Math.max(0, n(fd, "taxPct", s.params.taxRate * 100) / 100),
  };
  s.simCapital = Math.max(1000, n(fd, "simCapital", s.simCapital));
  s.nearTriggerPct = Math.max(0, n(fd, "nearPct", s.nearTriggerPct * 100) / 100);
  s.riskCapPct = Math.max(0, n(fd, "riskPct", s.riskCapPct * 100) / 100);
  s.useExemption = fd.get("useExemption") === "on";
  s.alertPrefs = {
    buy: fd.get("a_buy") === "on", sell: fd.get("a_sell") === "on", simClosed: fd.get("a_simClosed") === "on",
    nearTrigger: fd.get("a_near") === "on", dataIssue: fd.get("a_data") === "on", divergence: fd.get("a_div") === "on",
  };
  await store.saveSettings(s);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveChannels(_: FormState, fd: FormData): Promise<FormState> {
  const store = (await getStore());
  const c = await store.getChannels();
  await store.saveChannels({ ...c, telegramChatId: String(fd.get("telegramChatId") ?? "").trim() || undefined, email: String(fd.get("email") ?? "").trim() || undefined });
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function saveAssets(_: FormState, fd: FormData): Promise<FormState> {
  const raw = String(fd.get("tickers") ?? "");
  const tickers = [...new Set(raw.split(/[\s,;]+/).map((t) => t.trim().toUpperCase().replace(/\.SA$/, "")).filter((t) => /^[A-Z0-9]{4,6}$/.test(t)))];
  if (!tickers.length) return { error: "Informe ao menos um ticker." };
  const assets: Asset[] = tickers.map((ticker) => ({ ticker, enabled: true }));
  await (await getStore()).saveAssets(assets);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function resetSimulation(_: FormState, fd: FormData): Promise<FormState> {
  const store = (await getStore());
  const s = await store.getSettings();
  const capital = Math.max(1000, n(fd, "capital", s.simCapital));
  const start = String(fd.get("start") ?? "");
  const { u, cdi, bova, lastDate } = await loadUniverse(store, s.params);
  if (!lastDate) return { error: "Ainda não há preços salvos. Rode a atualização primeiro." };
  const startDate = [...u.dates].reverse().find((d) => d <= (start || lastDate)) ?? u.dates[0];
  let sim = startSim(u, startDate, capital, s.params);
  sim = runUntil(sim, u, lastDate, cdi, s.params, bova);
  await store.saveSim(sim);
  revalidatePath("/simulacao");
  return { ok: true };
}

export async function runNow() {
  const r = await runDaily((await getStore()), { notify: true });
  revalidatePath("/", "layout");
  return { ok: true, refDate: r.refDate, assets: r.assets, newAlerts: r.newAlerts };
}

export async function testNotification() {
  const store = (await getStore());
  const res = await notifyAll(store, [{ title: "Teste de alerta", body: "Se você recebeu isto, o canal está funcionando." }]);
  return res.length ? res.map((r) => `${r.channel}: ${r.ok ? "ok" : "falhou"} (${r.detail})`).join(" · ") : "Nenhum canal configurado.";
}

export async function enablePush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  const store = (await getStore());
  await store.addPushSub(sub);
  const c = await store.getChannels();
  await store.saveChannels({ ...c, pushEnabled: true });
  revalidatePath("/configuracoes");
}

// ---- pregão simulado ----

/** digita uma ordem no pregão simulado; valida caixa/posição considerando as ordens já abertas */
export async function placePregaoOrder(_: FormState, fd: FormData): Promise<FormState> {
  const store = await getStore();
  const s = await store.getSettings();
  const pg = s.pregao;
  const ticker = String(fd.get("ticker") ?? "").trim().toUpperCase().replace(/\.SA$/, "");
  const side = fd.get("side") === "SELL" ? "SELL" : "BUY";
  const typeRaw = String(fd.get("type") ?? "MARKET");
  const type = typeRaw === "LIMIT" ? "LIMIT" : typeRaw === "STOP" ? "STOP" : "MARKET";
  const qty = Math.floor(n(fd, "qty"));
  const limitPrice = n(fd, "limitPrice") || undefined;
  const stopPrice = n(fd, "stopPrice") || undefined;

  if (!/^[A-Z0-9]{4,6}$/.test(ticker)) return { error: "Informe um ticker válido." };
  const assets = await store.getAssets();
  if (!assets.some((a) => a.enabled && a.ticker === ticker)) return { error: `${ticker} não está na lista de ativos acompanhados (Configurações).` };
  if (!(qty > 0)) return { error: "A quantidade deve ser um número inteiro maior que zero." };
  if (type === "LIMIT" && !(limitPrice && limitPrice > 0)) return { error: "Informe o preço limite." };
  if (type === "STOP") {
    if (side !== "SELL") return { error: "Stop só existe para venda." };
    if (!(stopPrice && stopPrice > 0)) return { error: "Informe o preço de stop." };
  }

  const candles = await store.getPrices(ticker);
  const last = candles[candles.length - 1];
  if (!last) return { error: "Sem preços salvos para este ativo. Rode a atualização primeiro." };
  const ref = last.raw?.close ?? last.close;

  const today = nowBRT().date;
  const st = await ensurePregaoState(store, pg.capital, today);
  const open = (await store.listOrders()).filter((o) => o.status === "OPEN");

  // preço estimado para reservar caixa/quantidade
  const estPrice = type === "LIMIT" ? (limitPrice as number) : type === "STOP" ? (stopPrice as number)
    : side === "BUY" ? ref * (1 + pg.slippage) : ref * (1 - pg.slippage);
  const reservedCash = open.filter((o) => o.side === "BUY").reduce((a, o) => a + (o.qty * (o.estPrice ?? 0)) * (1 + pg.feePct) + pg.fixedFee, 0);
  const cashAvail = st.cash - reservedCash;
  const heldQty = st.positions.find((p) => p.ticker === ticker)?.qty ?? 0;
  const reservedSell = open.filter((o) => o.side === "SELL" && o.ticker === ticker).reduce((a, o) => a + o.qty, 0);

  if (side === "BUY") {
    const cost = qty * estPrice * (1 + pg.feePct) + pg.fixedFee;
    if (cost > cashAvail) return { error: `Saldo insuficiente: custo estimado ${brlTxt(cost)}, disponível ${brlTxt(Math.max(0, cashAvail))}.` };
  } else if (qty > heldQty - reservedSell) {
    return { error: `Você tem ${heldQty} ação(ões) de ${ticker}, sendo ${reservedSell} já reservada(s) em ordens abertas.` };
  }

  const order: PregaoOrder = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    createdDate: today,
    ticker,
    side,
    type,
    qty,
    limitPrice: type === "LIMIT" ? limitPrice : undefined,
    stopPrice: type === "STOP" ? stopPrice : undefined,
    estPrice,
    status: "OPEN",
    filledQty: 0,
    avgPrice: 0,
    fees: 0,
  };
  await store.upsertOrders([order]);
  revalidatePath("/pregao");
  return { ok: true };
}

/** cancela uma ordem enquanto ela ainda não foi processada */
export async function cancelPregaoOrder(id: string) {
  const store = await getStore();
  const o = (await store.listOrders()).find((x) => x.id === id);
  if (!o || o.status !== "OPEN") return;
  await store.upsertOrders([{ ...o, status: "CANCELLED", reason: "cancelada pelo usuário" }]);
  revalidatePath("/pregao");
}

/** parâmetros do pregão simulado (deslizamento, participação, taxas) */
export async function savePregaoSettings(_: FormState, fd: FormData): Promise<FormState> {
  const store = await getStore();
  const s = await store.getSettings();
  s.pregao = {
    ...s.pregao,
    capital: Math.max(1000, n(fd, "capital", s.pregao.capital)),
    slippage: Math.min(0.05, Math.max(0, n(fd, "slippagePct", s.pregao.slippage * 100) / 100)),
    participation: Math.min(1, Math.max(0.001, n(fd, "participationPct", s.pregao.participation * 100) / 100)),
    feePct: Math.min(0.01, Math.max(0, n(fd, "feePct", s.pregao.feePct * 100) / 100)),
    fixedFee: Math.max(0, n(fd, "fixedFee", s.pregao.fixedFee)),
    gapPct: Math.min(1, Math.max(0, n(fd, "gapPct", s.pregao.gapPct * 100) / 100)),
  };
  await store.saveSettings(s);
  revalidatePath("/pregao");
  return { ok: true };
}

/** zera o pregão simulado (estado, ordens e execuções) e recomeça com o capital informado */
export async function resetPregao(_: FormState, fd: FormData): Promise<FormState> {
  const store = await getStore();
  const s = await store.getSettings();
  const capital = Math.max(1000, n(fd, "capital", s.pregao.capital));
  s.pregao = { ...s.pregao, capital };
  await store.saveSettings(s);
  await store.clearPregao();
  await store.savePregao(newPregaoState(nowBRT().date, capital));
  revalidatePath("/pregao");
  return { ok: true };
}

