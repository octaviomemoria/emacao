import { NextResponse } from "next/server";
import { runDaily } from "@/lib/jobs/daily";
import { getStore, isLocalStore } from "@/lib/store";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return isLocalStore() && process.env.NODE_ENV !== "production"; // sem segredo: só em desenvolvimento local
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const store = (await getStore());
  try {
    const { searchParams } = new URL(req.url);
    const r = await runDaily(store, { notify: searchParams.get("notify") !== "0" });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    await store.appendJobLog({ at: new Date().toISOString(), job: "daily", ok: false, message: (e as Error).message }).catch(() => {});
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
