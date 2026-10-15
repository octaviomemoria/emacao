import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import { getStore } from "@/lib/store";
import { cookies } from "next/headers";
import { sessionCookieName, verifySession } from "@/lib/auth";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Radar de Rompimentos",
  description: "Rastreia ativos aptos à compra pela estratégia Rompimento 100/10, simula a carteira e avisa quando abrir ou fechar posições.",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { themeColor: "#09090b", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const logged = await verifySession((await cookies()).get(sessionCookieName)?.value);
  let unread = 0;
  if (logged) {
    try { unread = (await (await getStore()).listAlerts(100)).filter((a) => !a.read).length; } catch { /* sem armazenamento configurado */ }
  }
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        {logged && (
          <header className="sticky top-0 z-10 border-b border-zinc-500/20 bg-[var(--background)]/90 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
              <span className="font-semibold">Radar de Rompimentos</span>
              <Nav unread={unread} />
            </div>
          </header>
        )}
        <main className="mx-auto max-w-6xl px-4 pb-24 pt-4 md:pb-8">{children}</main>
      </body>
    </html>
  );
}
