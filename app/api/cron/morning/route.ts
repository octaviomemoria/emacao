import { NextResponse } from "next/server";
import { runMorning } from "@/lib/jobs/daily";
import { getStore, isLocalStore } from "@/lib/store";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return isLocalStore() && process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runMorning((await getStore()))) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
