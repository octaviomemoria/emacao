import type { ReactNode } from "react";

export function Card({ title, right, children, className = "" }: { title?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-zinc-500/20 bg-zinc-500/5 p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold tracking-wide">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, className = "" }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs opacity-60">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${className}`}>{value}</div>
      {sub && <div className="text-xs opacity-60">{sub}</div>}
    </div>
  );
}

const tones = {
  green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  red: "bg-red-500/15 text-red-600 dark:text-red-400",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  gray: "bg-zinc-500/15",
  blue: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
};
export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: keyof typeof tones }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm opacity-60">{children}</p>;
}

export function Disclaimer() {
  return <p className="mt-8 text-center text-xs opacity-50">Simulação histórica e sinais de uma regra de análise técnica. Não é recomendação de investimento e o app não envia ordens: confira preços e decida na sua corretora.</p>;
}
