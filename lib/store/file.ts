// Armazenamento em arquivos JSON para desenvolvimento local (STORE=file). Não funciona na Vercel.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Candle, SimState } from "@/lib/engine/types";
import type { PregaoFill, PregaoOrder, PregaoState } from "@/lib/engine/pregao";
import {
  DEFAULT_ASSETS, DEFAULT_SETTINGS,
  type AlertItem, type Asset, type Channels, type JobLogEntry, type PushSub, type Settings, type Snapshot, type Store, type Tx,
} from "./types";

const dir = () => path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? ".data");

async function read<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(path.join(/* turbopackIgnore: true */ dir(), file), "utf-8")) as T; } catch { return fallback; }
}
async function write(file: string, data: unknown) {
  const p = path.join(/* turbopackIgnore: true */ dir(), file);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data));
}

export class FileStore implements Store {
  async getSettings(): Promise<Settings> {
    const s = await read<Partial<Settings>>("settings.json", {});
    return { ...DEFAULT_SETTINGS, ...s, params: { ...DEFAULT_SETTINGS.params, ...(s.params ?? {}) }, pregao: { ...DEFAULT_SETTINGS.pregao, ...(s.pregao ?? {}) } } as Settings;
  }
  saveSettings(s: Settings) { return write("settings.json", s); }
  getAssets() { return read<Asset[]>("assets.json", DEFAULT_ASSETS); }
  saveAssets(a: Asset[]) { return write("assets.json", a); }
  getPrices(t: string) { return read<Candle[]>(`prices/${t}.json`, []); }
  savePrices(t: string, c: Candle[]) { return write(`prices/${t}.json`, c); }
  getCdi() { return read<Record<string, number>>("cdi.json", {}); }
  saveCdi(c: Record<string, number>) { return write("cdi.json", c); }
  getSnapshot() { return read<Snapshot | null>("snapshot.json", null); }
  saveSnapshot(s: Snapshot) { return write("snapshot.json", s); }
  getSim() { return read<SimState | null>("sim.json", null); }
  saveSim(s: SimState | null) { return write("sim.json", s); }
  async listTx() { return (await read<Tx[]>("tx.json", [])).sort((x, y) => x.date.localeCompare(y.date)); }
  async addTx(t: Omit<Tx, "id">) { const a = await read<Tx[]>("tx.json", []); a.push({ ...t, id: randomUUID() }); await write("tx.json", a); }
  async deleteTx(id: string) { const a = await read<Tx[]>("tx.json", []); await write("tx.json", a.filter((x) => x.id !== id)); }
  async listAlerts(limit: number) {
    return (await read<AlertItem[]>("alerts.json", [])).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async addAlerts(items: Omit<AlertItem, "id" | "createdAt" | "read">[]) {
    const all = await read<AlertItem[]>("alerts.json", []);
    const seen = new Set(all.map((a) => a.dedupe));
    const fresh: AlertItem[] = [];
    for (const it of items) {
      if (seen.has(it.dedupe)) continue;
      seen.add(it.dedupe);
      fresh.push({ ...it, id: randomUUID(), createdAt: new Date().toISOString(), read: false });
    }
    await write("alerts.json", [...all, ...fresh].slice(-2000));
    return fresh;
  }
  async markAlertsRead(ids: string[] | "all") {
    const all = await read<AlertItem[]>("alerts.json", []);
    await write("alerts.json", all.map((a) => (ids === "all" || ids.includes(a.id) ? { ...a, read: true } : a)));
  }
  getChannels() { return read<Channels>("channels.json", { pushEnabled: false }); }
  saveChannels(c: Channels) { return write("channels.json", c); }
  listPushSubs() { return read<PushSub[]>("push.json", []); }
  async addPushSub(s: PushSub) {
    const a = (await read<PushSub[]>("push.json", [])).filter((x) => x.endpoint !== s.endpoint);
    a.push(s);
    await write("push.json", a);
  }
  async removePushSub(e: string) { const a = await read<PushSub[]>("push.json", []); await write("push.json", a.filter((x) => x.endpoint !== e)); }
  async appendJobLog(e: JobLogEntry) { const a = await read<JobLogEntry[]>("joblog.json", []); a.push(e); await write("joblog.json", a.slice(-200)); }
  async listJobLog(limit: number) { return (await read<JobLogEntry[]>("joblog.json", [])).slice(-limit).reverse(); }

  // pregão simulado
  getPregao() { return read<PregaoState | null>("pregao.json", null); }
  savePregao(s: PregaoState | null) { return write("pregao.json", s); }
  listOrders() { return read<PregaoOrder[]>("pregao_orders.json", []); }
  async upsertOrders(list: PregaoOrder[]) {
    const byId = new Map((await read<PregaoOrder[]>("pregao_orders.json", [])).map((o) => [o.id, o]));
    for (const o of list) byId.set(o.id, o);
    await write("pregao_orders.json", [...byId.values()]);
  }
  listFills() { return read<PregaoFill[]>("pregao_fills.json", []); }
  async addFills(list: PregaoFill[]) {
    if (!list.length) return;
    await write("pregao_fills.json", [...(await read<PregaoFill[]>("pregao_fills.json", [])), ...list]);
  }
  async clearPregao() {
    await write("pregao.json", null);
    await write("pregao_orders.json", []);
    await write("pregao_fills.json", []);
  }
}
