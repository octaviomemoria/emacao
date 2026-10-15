// Envio de alertas: Telegram, e-mail (SMTP) e Web Push (notificação no navegador/celular).
// Chaves só em variáveis de ambiente: TELEGRAM_BOT_TOKEN, SMTP_HOST/PORT/USER/PASS/MAIL_FROM, VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT.
import nodemailer from "nodemailer";
import webpush from "web-push";
import type { AlertItem } from "@/lib/store/types";
import type { Store } from "@/lib/store/types";

export interface NotifyResult { channel: string; ok: boolean; detail: string }

function digest(items: Pick<AlertItem, "title" | "body">[]): { subject: string; text: string } {
  const lines = items.slice(0, 25).map((a) => `• ${a.title}${a.body ? ` — ${a.body}` : ""}`);
  if (items.length > 25) lines.push(`… e mais ${items.length - 25} alerta(s) no app.`);
  return {
    subject: `Bolsa: ${items.length} alerta(s)`,
    text: `${lines.join("\n")}\n\nSimulação histórica, não é recomendação de investimento. Confira os preços na corretora antes de operar.`,
  };
}

export async function sendTelegram(chatId: string, text: string): Promise<NotifyResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { channel: "telegram", ok: false, detail: "TELEGRAM_BOT_TOKEN não configurado" };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
  });
  return { channel: "telegram", ok: res.ok, detail: res.ok ? "enviado" : `HTTP ${res.status}` };
}

export async function sendEmail(to: string, subject: string, text: string): Promise<NotifyResult> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return { channel: "email", ok: false, detail: "SMTP não configurado" };
  try {
    const tr = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT ?? 587), secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
    await tr.sendMail({ from: MAIL_FROM ?? SMTP_USER, to, subject, text });
    return { channel: "email", ok: true, detail: "enviado" };
  } catch (e) {
    return { channel: "email", ok: false, detail: (e as Error).message };
  }
}

export async function sendPush(store: Store, title: string, body: string, url = "/alertas"): Promise<NotifyResult> {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return { channel: "push", ok: false, detail: "VAPID não configurado" };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", pub, priv);
  const subs = await store.listPushSubs();
  if (!subs.length) return { channel: "push", ok: false, detail: "nenhum dispositivo inscrito" };
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(s, JSON.stringify({ title, body, url }));
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await store.removePushSub(s.endpoint);
    }
  }
  return { channel: "push", ok: ok > 0, detail: `${ok}/${subs.length} dispositivo(s)` };
}

/** envia um resumo dos alertas novos por todos os canais configurados */
export async function notifyAll(store: Store, items: Pick<AlertItem, "title" | "body">[]): Promise<NotifyResult[]> {
  if (!items.length) return [];
  const ch = await store.getChannels();
  const d = digest(items);
  const out: NotifyResult[] = [];
  if (ch.telegramChatId) out.push(await sendTelegram(ch.telegramChatId, `${d.subject}\n\n${d.text}`));
  if (ch.email) out.push(await sendEmail(ch.email, d.subject, d.text));
  if (ch.pushEnabled) out.push(await sendPush(store, d.subject, items.slice(0, 3).map((i) => i.title).join(" · ")));
  return out;
}
