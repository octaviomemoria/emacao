import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName, verifySession } from "@/lib/auth";

// Tudo exige login, exceto a página de login, os arquivos públicos do PWA e as rotas de cron
// (que se autenticam sozinhas com CRON_SECRET).
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/cron/") || pathname === "/sw.js" || pathname === "/manifest.webmanifest" || pathname.startsWith("/icons/")) {
    return NextResponse.next();
  }
  if (await verifySession(req.cookies.get(sessionCookieName)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
