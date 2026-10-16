import { markRead } from "@/app/actions";
import { Badge, Card, Disclaimer, Empty } from "@/components/ui";
import { getStore } from "@/lib/store";
import type { AlertType } from "@/lib/store/types";

export const dynamic = "force-dynamic";

const LABEL: Record<AlertType, { t: string; tone: "green" | "red" | "amber" | "blue" | "gray" }> = {
  BUY: { t: "Comprar", tone: "green" }, SELL: { t: "Vender", tone: "red" }, REAL_SELL: { t: "Vender (real)", tone: "red" },
  SIM_CLOSED: { t: "Simulação encerrada", tone: "gray" }, NEAR_TRIGGER: { t: "Perto do gatilho", tone: "blue" },
  DATA_ISSUE: { t: "Dados", tone: "amber" }, DIVERGENCE: { t: "Divergência", tone: "amber" }, INFO: { t: "Aviso", tone: "gray" },
  PREGAO_EXECUTADA: { t: "Pregão: executada", tone: "green" }, PREGAO_PARCIAL: { t: "Pregão: parcial", tone: "blue" },
  PREGAO_NAO_EXECUTADA: { t: "Pregão: não executada", tone: "gray" }, PREGAO_BLOQUEADA: { t: "Pregão: bloqueada", tone: "red" },
  PREGAO_GAP: { t: "Pregão: gap", tone: "amber" },
};

export default async function Alertas() {
  const alerts = await (await getStore()).listAlerts(200);
  const unread = alerts.filter((a) => !a.read);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Alertas {unread.length > 0 && <Badge tone="red">{unread.length} novos</Badge>}</h1>
        {unread.length > 0 && <form action={markRead.bind(null, "all")}><button className="btn ghost">Marcar todos como lidos</button></form>}
      </div>
      <Card>
        {alerts.length ? (
          <ul className="divide-y divide-zinc-500/20">
            {alerts.map((a) => {
              const l = LABEL[a.type] ?? LABEL.INFO;
              return (
                <li key={a.id} className={`flex items-start justify-between gap-3 py-3 ${a.read ? "opacity-60" : ""}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><Badge tone={l.tone}>{l.t}</Badge><span className="font-medium">{a.title}</span></div>
                    {a.body && <p className="mt-1 text-sm opacity-80">{a.body}</p>}
                    <p className="mt-1 text-xs opacity-50">{new Date(a.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
                  </div>
                  {!a.read && <form action={markRead.bind(null, [a.id])}><button className="text-xs underline opacity-70 hover:opacity-100">lido</button></form>}
                </li>
              );
            })}
          </ul>
        ) : <Empty>Nenhum alerta ainda. Eles aparecem depois da primeira atualização.</Empty>}
      </Card>
      <Disclaimer />
    </div>
  );
}
