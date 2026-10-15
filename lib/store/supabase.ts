import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Candle, SimState } from "@/lib/engine/types";
import {
  DEFAULT_ASSETS, DEFAULT_SETTINGS,
  type AlertItem, type Asset, type Channels, type JobLogEntry, type PushSub, type Settings, type Snapshot, type Store, type Tx,
} from "./types";

type AlertRow = { id: string; created_at: string; type: string; ticker: string | null; title: string; body: string; read: boolean; dedupe: string };
const toAlert = (r: AlertRow): AlertItem => ({
  id: r.id, createdAt: r.created_at, type: r.type as AlertItem["type"], ticker: r.ticker ?? undefined,
  title: r.title, body: r.body, read: r.read, dedupe: r.dedupe,
});

export class SupabaseStore implements Store {
  private db: SupabaseClient;
  constructor() {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
    this.db = createClient(url, key, { auth: { persistSession: false } });
  }
  private async kvGet<T>(key: string, fallback: T): Promise<T> {
    const { data, error } = await this.db.from("kv").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(`kv.get ${key}: ${error.message}`);
    return (data?.value as T) ?? fallback;
  }
  private async kvSet(key: string, value: unknown) {
    const { error } = await this.db.from("kv").upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw new Error(`kv.set ${key}: ${error.message}`);
  }
  async getSettings(): Promise<Settings> {
    const s = await this.kvGet<Partial<Settings>>("settings", {});
    return { ...DEFAULT_SETTINGS, ...s, params: { ...DEFAULT_SETTINGS.params, ...(s.params ?? {}) } } as Settings;
  }
  saveSettings(s: Settings) { return this.kvSet("settings", s); }
  getAssets() { return this.kvGet<Asset[]>("assets", DEFAULT_ASSETS); }
  saveAssets(a: Asset[]) { return this.kvSet("assets", a); }
  async getPrices(t: string) {
    const { data, error } = await this.db.from("prices").select("candles").eq("ticker", t).maybeSingle();
    if (error) throw new Error(`prices.get ${t}: ${error.message}`);
    return (data?.candles as Candle[]) ?? [];
  }
  async savePrices(t: string, c: Candle[]) {
    const { error } = await this.db.from("prices").upsert({ ticker: t, candles: c, updated_at: new Date().toISOString() });
    if (error) throw new Error(`prices.save ${t}: ${error.message}`);
  }
  getCdi() { return this.kvGet<Record<string, number>>("cdi", {}); }
  saveCdi(c: Record<string, number>) { return this.kvSet("cdi", c); }
  getSnapshot() { return this.kvGet<Snapshot | null>("snapshot", null); }
  saveSnapshot(s: Snapshot) { return this.kvSet("snapshot", s); }
  getSim() { return this.kvGet<SimState | null>("sim", null); }
  saveSim(s: SimState | null) { return this.kvSet("sim", s); }
  async listTx() {
    const { data, error } = await this.db.from("transactions").select("*").order("date");
    if (error) throw new Error(`tx.list: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id, date: r.date, ticker: r.ticker, side: r.side, qty: Number(r.qty), price: Number(r.price), fees: Number(r.fees), note: r.note ?? undefined,
    })) as Tx[];
  }
  async addTx(t: Omit<Tx, "id">) {
    const { error } = await this.db.from("transactions").insert({
      date: t.date, ticker: t.ticker, side: t.side, qty: t.qty, price: t.price, fees: t.fees, note: t.note ?? null,
    });
    if (error) throw new Error(`tx.add: ${error.message}`);
  }
  async deleteTx(id: string) {
    const { error } = await this.db.from("transactions").delete().eq("id", id);
    if (error) throw new Error(`tx.delete: ${error.message}`);
  }
  async listAlerts(limit: number) {
    const { data, error } = await this.db.from("alerts").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`alerts.list: ${error.message}`);
    return (data ?? []).map((r) => toAlert(r as AlertRow));
  }
  async addAlerts(items: Omit<AlertItem, "id" | "createdAt" | "read">[]) {
    if (!items.length) return [];
    const { data, error } = await this.db
      .from("alerts")
      .upsert(items.map((i) => ({ type: i.type, ticker: i.ticker ?? null, title: i.title, body: i.body, dedupe: i.dedupe })), { onConflict: "dedupe", ignoreDuplicates: true })
      .select("*");
    if (error) throw new Error(`alerts.add: ${error.message}`);
    return (data ?? []).map((r) => toAlert(r as AlertRow));
  }
  async markAlertsRead(ids: string[] | "all") {
    const q = this.db.from("alerts").update({ read: true });
    const { error } = ids === "all" ? await q.eq("read", false) : await q.in("id", ids);
    if (error) throw new Error(`alerts.read: ${error.message}`);
  }
  getChannels() { return this.kvGet<Channels>("channels", { pushEnabled: false }); }
  saveChannels(c: Channels) { return this.kvSet("channels", c); }
  async listPushSubs() {
    const { data, error } = await this.db.from("push_subscriptions").select("*");
    if (error) throw new Error(`push.list: ${error.message}`);
    return (data ?? []).map((r) => ({ endpoint: r.endpoint, keys: r.keys })) as PushSub[];
  }
  async addPushSub(s: PushSub) {
    const { error } = await this.db.from("push_subscriptions").upsert({ endpoint: s.endpoint, keys: s.keys });
    if (error) throw new Error(`push.add: ${error.message}`);
  }
  async removePushSub(endpoint: string) { await this.db.from("push_subscriptions").delete().eq("endpoint", endpoint); }
  async appendJobLog(e: JobLogEntry) { await this.db.from("job_log").insert({ at: e.at, job: e.job, ok: e.ok, message: e.message }); }
  async listJobLog(limit: number) {
    const { data } = await this.db.from("job_log").select("*").order("at", { ascending: false }).limit(limit);
    return (data ?? []).map((r) => ({ at: r.at, job: r.job, ok: r.ok, message: r.message })) as JobLogEntry[];
  }
}
