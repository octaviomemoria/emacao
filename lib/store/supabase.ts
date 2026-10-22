import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Candle, SimState } from "@/lib/engine/types";
import type { FxMap } from "@/lib/engine/fx";
import {
  DEFAULT_ASSETS, DEFAULT_SETTINGS,
  type AlertItem, type Asset, type Carteira, type Channels, type JobLogEntry, type PushSub, type Settings, type Snapshot, type Store, type Tx,
} from "./types";
import { PREGAO_DEFAULT, type PregaoFill, type PregaoOrder, type PregaoState } from "@/lib/engine/pregao";

type AlertRow = { id: string; created_at: string; type: string; ticker: string | null; title: string; body: string; read: boolean; dedupe: string };
const toAlert = (r: AlertRow): AlertItem => ({
  id: r.id, createdAt: r.created_at, type: r.type as AlertItem["type"], ticker: r.ticker ?? undefined,
  title: r.title, body: r.body, read: r.read, dedupe: r.dedupe,
});

/** chave do estado de cada carteira de pregão na tabela kv */
const stateKey = (pid: string) => (pid === PREGAO_DEFAULT ? "pregao" : `pregao:${pid}`);

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
    return { ...DEFAULT_SETTINGS, ...s, params: { ...DEFAULT_SETTINGS.params, ...(s.params ?? {}) }, pregao: { ...DEFAULT_SETTINGS.pregao, ...(s.pregao ?? {}) } } as Settings;
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
  getFx() { return this.kvGet<FxMap>("fx", {}); }
  saveFx(fx: FxMap) { return this.kvSet("fx", fx); }
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

  // carteiras de pregão (padrão e simuladas)
  listCarteiras() { return this.kvGet<Carteira[]>("carteiras", []); }
  saveCarteiras(list: Carteira[]) { return this.kvSet("carteiras", list); }
  getPregao(pid = PREGAO_DEFAULT) { return this.kvGet<PregaoState | null>(stateKey(pid), null); }
  savePregao(s: PregaoState | null, pid = PREGAO_DEFAULT) { return this.kvSet(stateKey(pid), s); }
  async listOrders(pid = PREGAO_DEFAULT) {
    const { data, error } = await this.db.from("pregao_orders").select("*").eq("portfolio_id", pid).order("created_at");
    if (error) throw new Error(`pregao.orders: ${error.message}`);
    return (data ?? []).map((r) => toOrder(r as OrderRow));
  }
  async upsertOrders(list: PregaoOrder[]) {
    if (!list.length) return;
    const { error } = await this.db.from("pregao_orders").upsert(list.map(toOrderRow), { onConflict: "id" });
    if (error) throw new Error(`pregao.orders.upsert: ${error.message}`);
  }
  async listFills(pid = PREGAO_DEFAULT) {
    const { data, error } = await this.db.from("pregao_fills").select("*").eq("portfolio_id", pid).order("date");
    if (error) throw new Error(`pregao.fills: ${error.message}`);
    return (data ?? []).map((r) => toFill(r as FillRow));
  }
  async addFills(list: PregaoFill[]) {
    if (!list.length) return;
    const { error } = await this.db.from("pregao_fills").upsert(list.map(toFillRow), { onConflict: "id" });
    if (error) throw new Error(`pregao.fills.add: ${error.message}`);
  }
  async clearPregao(pid = PREGAO_DEFAULT) {
    // as execuções saem em cascata com as ordens (FK on delete cascade)
    const { error } = await this.db.from("pregao_orders").delete().eq("portfolio_id", pid);
    if (error) throw new Error(`pregao.clear: ${error.message}`);
    await this.kvSet(stateKey(pid), null);
  }
}

type OrderRow = {
  id: string; portfolio_id: string; created_at: string; created_date: string; ticker: string; side: string; type: string; qty: number;
  limit_price: number | null; stop_price: number | null; est_price: number | null; status: string; filled_qty: number; avg_price: number;
  fees: number; session_date: string | null; reason: string | null; gap: number | null;
};
type FillRow = { id: string; portfolio_id: string; order_id: string; date: string; ticker: string; side: string; qty: number; price: number; fees: number };

const toOrder = (r: OrderRow): PregaoOrder => ({
  id: r.id, portfolioId: r.portfolio_id, createdAt: r.created_at, createdDate: r.created_date, ticker: r.ticker,
  side: r.side as PregaoOrder["side"], type: r.type as PregaoOrder["type"], qty: Number(r.qty),
  limitPrice: r.limit_price != null ? Number(r.limit_price) : undefined,
  stopPrice: r.stop_price != null ? Number(r.stop_price) : undefined,
  estPrice: r.est_price != null ? Number(r.est_price) : undefined,
  status: r.status as PregaoOrder["status"], filledQty: Number(r.filled_qty), avgPrice: Number(r.avg_price), fees: Number(r.fees),
  sessionDate: r.session_date ?? undefined, reason: r.reason ?? undefined, gap: r.gap != null ? Number(r.gap) : undefined,
});
const toOrderRow = (o: PregaoOrder) => ({
  id: o.id, portfolio_id: o.portfolioId ?? PREGAO_DEFAULT, created_at: o.createdAt, created_date: o.createdDate, ticker: o.ticker,
  side: o.side, type: o.type, qty: o.qty,
  limit_price: o.limitPrice ?? null, stop_price: o.stopPrice ?? null, est_price: o.estPrice ?? null, status: o.status, filled_qty: o.filledQty,
  avg_price: o.avgPrice, fees: o.fees, session_date: o.sessionDate ?? null, reason: o.reason ?? null, gap: o.gap ?? null,
});
const toFill = (r: FillRow): PregaoFill => ({
  id: r.id, portfolioId: r.portfolio_id, orderId: r.order_id, date: r.date, ticker: r.ticker, side: r.side as PregaoFill["side"],
  qty: Number(r.qty), price: Number(r.price), fees: Number(r.fees),
});
const toFillRow = (f: PregaoFill) => ({
  id: f.id, portfolio_id: f.portfolioId ?? PREGAO_DEFAULT, order_id: f.orderId, date: f.date, ticker: f.ticker, side: f.side,
  qty: f.qty, price: f.price, fees: f.fees,
});
