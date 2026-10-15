import { logout } from "@/app/actions";
import { AssetsForm, ChannelsForm, SettingsForm } from "@/components/forms";
import { Badge, Card, Disclaimer } from "@/components/ui";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Config() {
  const store = (await getStore());
  const [settings, channels, assets, log] = await Promise.all([store.getSettings(), store.getChannels(), store.getAssets(), store.listJobLog(8)]);
  const env = (k: string) => !!process.env[k];
  const rows: [string, boolean][] = [
    ["Telegram (TELEGRAM_BOT_TOKEN)", env("TELEGRAM_BOT_TOKEN")],
    ["E-mail (SMTP_HOST, SMTP_USER, SMTP_PASS)", env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS")],
    ["Notificações push (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY)", env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY") && env("NEXT_PUBLIC_VAPID_PUBLIC_KEY")],
    ["Rotina agendada protegida (CRON_SECRET)", env("CRON_SECRET")],
    ["Senha de acesso (APP_PASSWORD, SESSION_SECRET)", env("APP_PASSWORD") && env("SESSION_SECRET")],
  ];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Configurações</h1>
      <Card title="Estratégia, custos e alertas"><SettingsForm s={settings} /></Card>
      <Card title="Canais de alerta"><ChannelsForm c={channels} /></Card>
      <Card title={`Ativos acompanhados (${assets.length})`}><AssetsForm assets={assets} /></Card>
      <Card title="Chaves e integrações (definidas nas variáveis de ambiente do servidor)">
        <ul className="flex flex-col gap-1 text-sm">{rows.map(([k, ok]) => (<li key={k} className="flex items-center gap-2"><Badge tone={ok ? "green" : "amber"}>{ok ? "configurado" : "falta"}</Badge>{k}</li>))}</ul>
        <p className="mt-2 text-xs opacity-60">Os valores nunca aparecem no app. Cadastre-os no painel da Vercel (Settings → Environment Variables) ou no arquivo .env.local no seu computador.</p>
      </Card>
      <Card title="Últimas rotinas">
        {log.length ? <ul className="text-sm">{log.map((l, i) => (<li key={i} className="py-1"><Badge tone={l.ok ? "green" : "red"}>{l.ok ? "ok" : "erro"}</Badge> <span className="opacity-60">{new Date(l.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span> · {l.job} · {l.message}</li>))}</ul> : <p className="text-sm opacity-60">Nenhuma rotina executada ainda.</p>}
      </Card>
      <form action={logout}><button className="btn ghost">Sair</button></form>
      <Disclaimer />
    </div>
  );
}
