"use client";
import { useActionState, useState, useTransition } from "react";
import { addTx, enablePush, login, resetSimulation, runNow, saveAssets, saveChannels, saveSettings, testNotification } from "@/app/actions";
import type { Asset, Channels, Settings } from "@/lib/store/types";

type R = { ok?: boolean; error?: string } | null;
const Msg = ({ r }: { r: R }) => (r?.error ? <span className="text-sm text-red-500">{r.error}</span> : r?.ok ? <span className="text-sm text-emerald-500">Salvo.</span> : null);
const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 text-xs"><span className="opacity-60">{label}</span>{children}</label>
);

export function LoginForm() {
  const [r, act, pending] = useActionState(login, null as R);
  return (
    <form action={act} className="mx-auto mt-24 flex max-w-xs flex-col gap-3">
      <h1 className="text-lg font-semibold">Radar de Rompimentos</h1>
      <input name="password" type="password" placeholder="Senha" autoFocus required />
      <button className="btn" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
      <Msg r={r} />
    </form>
  );
}

export function RunButton({ label = "Atualizar agora" }: { label?: string }) {
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2">
      <button className="btn" disabled={pending} onClick={() => start(async () => {
        try { const r = await runNow(); setMsg(`Fechamento ${r.refDate} · ${r.assets} ativos · ${r.newAlerts} alerta(s) novo(s)`); }
        catch (e) { setMsg(`Falhou: ${(e as Error).message}`); }
      })}>{pending ? "Baixando preços… (pode levar 1 min)" : label}</button>
      {msg && <span className="text-xs opacity-70">{msg}</span>}
    </span>
  );
}

export function TxForm() {
  const [r, act, pending] = useActionState(addTx, null as R);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={act} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4 lg:grid-cols-8">
      <L label="Data"><input name="date" type="date" defaultValue={today} required /></L>
      <L label="Ativo"><input name="ticker" placeholder="PETR4" required /></L>
      <L label="Operação"><select name="side"><option value="BUY">Compra</option><option value="SELL">Venda</option></select></L>
      <L label="Quantidade"><input name="qty" inputMode="decimal" required /></L>
      <L label="Preço (R$)"><input name="price" inputMode="decimal" required /></L>
      <L label="Taxas (R$)"><input name="fees" inputMode="decimal" defaultValue="0" /></L>
      <L label="Nota"><input name="note" /></L>
      <div className="flex items-center gap-2"><button className="btn" disabled={pending}>Registrar</button><Msg r={r} /></div>
    </form>
  );
}

export function ResetSimForm({ capital }: { capital: number }) {
  const [r, act, pending] = useActionState(resetSimulation, null as R);
  return (
    <form action={act} className="flex flex-wrap items-end gap-2">
      <L label="Capital inicial (R$)"><input name="capital" inputMode="decimal" defaultValue={capital} /></L>
      <L label="Começar a simulação em"><input name="start" type="date" /></L>
      <button className="btn ghost" disabled={pending}>{pending ? "Recalculando…" : "Reiniciar simulação"}</button>
      <Msg r={r} />
    </form>
  );
}

function C({ name, label, on }: { name: string; label: string; on: boolean }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={on} />{label}</label>;
}

export function SettingsForm({ s }: { s: Settings }) {
  const [r, act, pending] = useActionState(saveSettings, null as R);
  const p = s.params, a = s.alertPrefs;
  return (
    <form action={act} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <L label="Rompimento de compra (dias)"><input name="N" inputMode="numeric" defaultValue={p.N} /></L>
        <L label="Saída: mínima de (dias)"><input name="M" inputMode="numeric" defaultValue={p.M} /></L>
        <L label="Filtro"><select name="filter" defaultValue={p.filter}><option value="none">Nenhum</option><option value="up200">Só acima da média de 200</option></select></L>
        <L label="% do patrimônio por posição"><input name="fracPct" inputMode="decimal" defaultValue={p.frac * 100} /></L>
        <L label="Máx. de posições"><input name="maxPos" inputMode="numeric" defaultValue={p.maxPos} /></L>
        <L label="Custo ida+volta (%)"><input name="costRoundTripPct" inputMode="decimal" defaultValue={p.costSide * 200} /></L>
        <L label="R$ por ordem"><input name="fixedFee" inputMode="decimal" defaultValue={p.fixedFee} /></L>
        <L label="IR sobre lucro (%)"><input name="taxPct" inputMode="decimal" defaultValue={p.taxRate * 100} /></L>
        <L label="Capital da simulação (R$)"><input name="simCapital" inputMode="decimal" defaultValue={s.simCapital} /></L>
        <L label="“Perto do gatilho” (%)"><input name="nearPct" inputMode="decimal" defaultValue={s.nearTriggerPct * 100} /></L>
        <L label="Teto de risco por posição (% patrim.)"><input name="riskPct" inputMode="decimal" defaultValue={s.riskCapPct * 100} /></L>
      </div>
      <C name="useExemption" label="Aplicar isenção de IR (vendas de ações até R$ 20 mil/mês) na apuração da carteira real" on={s.useExemption} />
      <div>
        <div className="mb-1 text-xs opacity-60">Alertas ativos</div>
        <div className="grid gap-1 sm:grid-cols-3">
          <C name="a_buy" label="Comprar" on={a.buy} /><C name="a_sell" label="Vender / saída acionada" on={a.sell} />
          <C name="a_simClosed" label="Posição simulada encerrada" on={a.simClosed} /><C name="a_near" label="Perto do gatilho de compra" on={a.nearTrigger} />
          <C name="a_data" label="Dado suspeito / atrasado" on={a.dataIssue} /><C name="a_div" label="Divergência simulada × real" on={a.divergence} />
        </div>
      </div>
      <div className="flex items-center gap-3"><button className="btn" disabled={pending}>Salvar parâmetros</button><Msg r={r} />
        <span className="text-xs opacity-60">Mudar a estratégia vale para as próximas rodadas; use “Reiniciar simulação” para recalcular a carteira simulada.</span></div>
    </form>
  );
}

export function ChannelsForm({ c }: { c: Channels }) {
  const [r, act, pending] = useActionState(saveChannels, null as R);
  const [test, setTest] = useState("");
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <form action={act} className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <L label="Telegram: chat id"><input name="telegramChatId" defaultValue={c.telegramChatId} placeholder="ex.: 123456789" /></L>
        <L label="E-mail"><input name="email" type="email" defaultValue={c.email} /></L>
        <div className="flex items-center gap-2"><button className="btn" disabled={pending}>Salvar canais</button><Msg r={r} /></div>
      </form>
      <div className="flex flex-wrap items-center gap-3">
        <PushButton enabled={c.pushEnabled} />
        <button className="btn ghost" disabled={busy} onClick={() => start(async () => setTest(await testNotification()))}>Enviar alerta de teste</button>
        {test && <span className="text-xs opacity-70">{test}</span>}
      </div>
    </div>
  );
}

function b64ToUint8(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushButton({ enabled }: { enabled: boolean }) {
  const [msg, setMsg] = useState(enabled ? "Notificações ligadas neste dispositivo (ou em outro)." : "");
  const [busy, start] = useTransition();
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  return (
    <span className="flex items-center gap-2">
      <button className="btn ghost" disabled={busy} onClick={() => start(async () => {
        try {
          if (!key) throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY não configurada");
          if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("este navegador não suporta notificações push");
          const perm = await Notification.requestPermission();
          if (perm !== "granted") throw new Error("permissão negada");
          const reg = await navigator.serviceWorker.register("/sw.js");
          const sub = await (await navigator.serviceWorker.ready).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(key) });
          const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
          await enablePush({ endpoint: j.endpoint, keys: j.keys });
          void reg;
          setMsg("Notificações ativadas neste dispositivo.");
        } catch (e) { setMsg(`Não foi possível ativar: ${(e as Error).message}`); }
      })}>Ativar notificações neste dispositivo</button>
      {msg && <span className="text-xs opacity-70">{msg}</span>}
    </span>
  );
}

export function AssetsForm({ assets }: { assets: Asset[] }) {
  const [r, act, pending] = useActionState(saveAssets, null as R);
  const b3 = assets.filter((a) => a.market !== "EXT");
  const ext = assets.filter((a) => a.market === "EXT");
  return (
    <form action={act} className="flex flex-col gap-3">
      <L label="B3"><textarea name="tickers" rows={4} defaultValue={b3.map((a) => a.ticker).join(" ")} className="font-mono text-xs" /></L>
      <L label="Exterior (ações americanas, em dólar; o app converte para reais pelo câmbio do dia)"><textarea name="exterior" rows={2} defaultValue={ext.map((a) => a.ticker).join(" ")} className="font-mono text-xs" placeholder="AAPL MSFT BRK-B" /></L>
      <div className="flex items-center gap-3"><button className="btn" disabled={pending}>Salvar lista</button><Msg r={r} />
        <span className="text-xs opacity-60">Separe por espaço. Ativos novos têm só o histórico baixado a partir da próxima atualização. Evite papéis ilíquidos: o backtest só cobriu os da B3 ({b3.length}).</span></div>
    </form>
  );
}
