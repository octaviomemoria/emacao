"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Hoje", icon: "◉" },
  { href: "/radar", label: "Radar", icon: "◎" },
  { href: "/simulacao", label: "Simulação", icon: "▤" },
  { href: "/pregao", label: "Pregão", icon: "⇅" },
  { href: "/carteira", label: "Carteira", icon: "▣" },
  { href: "/alertas", label: "Alertas", icon: "✉" },
  { href: "/backtest", label: "Backtest", icon: "↺" },
  { href: "/configuracoes", label: "Config.", icon: "⚙" },
];

export default function Nav({ unread }: { unread: number }) {
  const path = usePathname();
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  return (
    <>
      {/* desktop: barra superior */}
      <nav className="hidden gap-1 md:flex">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`relative rounded-md px-3 py-1.5 text-sm ${active(l.href) ? "bg-zinc-500/20 font-semibold" : "opacity-70 hover:opacity-100"}`}>
            {l.label}
            {l.href === "/alertas" && unread > 0 && <span className="ml-1 rounded-full bg-red-500 px-1.5 text-xs text-white">{unread}</span>}
          </Link>
        ))}
      </nav>
      {/* celular: barra inferior */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-8 border-t border-zinc-500/30 bg-[var(--background)] md:hidden">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`relative flex flex-col items-center py-2 text-[10px] ${active(l.href) ? "font-semibold" : "opacity-60"}`}>
            <span className="text-base leading-none">{l.icon}</span>
            {l.label}
            {l.href === "/alertas" && unread > 0 && <span className="absolute right-3 top-1 rounded-full bg-red-500 px-1 text-[9px] text-white">{unread}</span>}
          </Link>
        ))}
      </nav>
    </>
  );
}
