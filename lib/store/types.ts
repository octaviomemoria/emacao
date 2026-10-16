import type { AssetSignal, Candle, Params, SimState } from "@/lib/engine/types";
import { DEFAULT_PARAMS } from "@/lib/engine/types";
import { DEFAULT_PREGAO, type PregaoFill, type PregaoOrder, type PregaoSettings, type PregaoState } from "@/lib/engine/pregao";

export interface Asset { ticker: string; name?: string; sector?: string; enabled: boolean }

export interface Settings {
  params: Params;
  pregao: PregaoSettings;
  simCapital: number;
  historyYears: number; // anos de histórico baixados
  maxStaleDays: number; // ativo sem candle há mais dias que isso é ignorado
  alertPrefs: { buy: boolean; sell: boolean; simClosed: boolean; nearTrigger: boolean; dataIssue: boolean; divergence: boolean };
  nearTriggerPct: number; // "perto do gatilho": distância máxima até o rompimento (0.02 = 2%)
  riskCapPct: number; // alerta se a perda até o nível de saída passar desse % do patrimônio
  etfs: string[]; // vendas de ETFs não têm a isenção de R$ 20 mil
  useExemption: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  params: DEFAULT_PARAMS,
  pregao: DEFAULT_PREGAO,
  simCapital: 100000,
  historyYears: 3,
  maxStaleDays: 4,
  alertPrefs: { buy: true, sell: true, simClosed: true, nearTrigger: false, dataIssue: true, divergence: true },
  nearTriggerPct: 0.02,
  riskCapPct: 0.03,
  etfs: ["BOVA11"],
  useExemption: false,
};

const T =
  "PETR4 VALE3 BOVA11 ITUB4 BBDC4 BBAS3 GGBR4 CSNA3 USIM5 CMIG4 BRKM5 GOAU4 LREN3 SBSP3 VIVT3 CYRE3 CSAN3 KLBN4 RADL3 WEGE3 TIMS3 SUZB3 RENT3 EQTL3 MGLU3 BRAP4 CPFE3 AMER3 SANB11 ABEV3 PETR3 BBDC3 ITSA4 NATU3 B3SA3 CVCB3 EZTC3 MRVE3 LIGT3 COGN3 ALPA4 TOTS3";
export const DEFAULT_ASSETS: Asset[] = T.split(" ").map((ticker) => ({ ticker, enabled: true }));

export interface Tx { id: string; date: string; ticker: string; side: "BUY" | "SELL"; qty: number; price: number; fees: number; note?: string }

export type AlertType =
  | "BUY" | "SELL" | "REAL_SELL" | "SIM_CLOSED" | "NEAR_TRIGGER" | "DATA_ISSUE" | "DIVERGENCE" | "INFO"
  | "PREGAO_EXECUTADA" | "PREGAO_PARCIAL" | "PREGAO_NAO_EXECUTADA" | "PREGAO_BLOQUEADA" | "PREGAO_GAP";
export interface AlertItem { id: string; createdAt: string; type: AlertType; ticker?: string; title: string; body: string; read: boolean; dedupe: string }

export interface Channels { telegramChatId?: string; email?: string; pushEnabled: boolean }

export interface Snapshot { date: string; generatedAt: string; signals: AssetSignal[]; skipped: { ticker: string; reason: string }[] }

export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }

export interface JobLogEntry { at: string; job: string; ok: boolean; message: string }

export interface Store {
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  getAssets(): Promise<Asset[]>;
  saveAssets(a: Asset[]): Promise<void>;
  getPrices(ticker: string): Promise<Candle[]>;
  savePrices(ticker: string, c: Candle[]): Promise<void>;
  getCdi(): Promise<Record<string, number>>;
  saveCdi(c: Record<string, number>): Promise<void>;
  getSnapshot(): Promise<Snapshot | null>;
  saveSnapshot(s: Snapshot): Promise<void>;
  getSim(): Promise<SimState | null>;
  saveSim(s: SimState | null): Promise<void>;
  listTx(): Promise<Tx[]>;
  addTx(t: Omit<Tx, "id">): Promise<void>;
  deleteTx(id: string): Promise<void>;
  listAlerts(limit: number): Promise<AlertItem[]>;
  /** grava só os alertas cujo `dedupe` ainda não existe; devolve os novos */
  addAlerts(items: Omit<AlertItem, "id" | "createdAt" | "read">[]): Promise<AlertItem[]>;
  markAlertsRead(ids: string[] | "all"): Promise<void>;
  getChannels(): Promise<Channels>;
  saveChannels(c: Channels): Promise<void>;
  listPushSubs(): Promise<PushSub[]>;
  addPushSub(s: PushSub): Promise<void>;
  removePushSub(endpoint: string): Promise<void>;
  appendJobLog(e: JobLogEntry): Promise<void>;
  listJobLog(limit: number): Promise<JobLogEntry[]>;
  // carteiras de pregão: a padrão ("pregao") e as carteiras simuladas (pid = id da carteira)
  listCarteiras(): Promise<Carteira[]>;
  saveCarteiras(list: Carteira[]): Promise<void>;
  getPregao(pid?: string): Promise<PregaoState | null>;
  savePregao(s: PregaoState | null, pid?: string): Promise<void>;
  listOrders(pid?: string): Promise<PregaoOrder[]>;
  /** insere ou atualiza ordens pelo id (cada ordem leva o seu portfolioId) */
  upsertOrders(list: PregaoOrder[]): Promise<void>;
  listFills(pid?: string): Promise<PregaoFill[]>;
  addFills(list: PregaoFill[]): Promise<void>;
  /** apaga o estado, as ordens e as execuções de uma carteira */
  clearPregao(pid?: string): Promise<void>;
}

/** carteira simulada criada pelo usuário, com capital inicial e parâmetros próprios */
export interface Carteira {
  id: string;
  name: string;
  createdAt: string;
  capital: number;
  params: PregaoSettings;
}
