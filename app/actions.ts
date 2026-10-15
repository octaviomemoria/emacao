"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkPassword, makeSession, sessionCookieName, sessionMaxAge } from "@/lib/auth";
import { runUntil, startSim } from "@/lib/engine/simulation";
import { runDaily } from "@/lib/jobs/daily";
import { loadUniverse } from "@/lib/jobs/universe";
import { notifyAll } from "@/lib/notify/dispatch";
import { getStore } from "@/lib/store";
import type { Asset } from "@/lib/store/types";

type FormState = { ok?: boolean; error?: string } | null;

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

