import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cancelOrder, createCarteira, deleteCarteira, getParams, placeOrder, resetCarteira, saveParams } from "@/lib/carteiras";
import { PREGAO_DEFAULT } from "@/lib/engine/pregao";
import type { Candle } from "@/lib/engine/types";
import { runPregaoJob } from "@/lib/jobs/pregao";
import { FileStore } from "@/lib/store/file";
import { DEFAULT_SETTINGS } from "@/lib/store/types";

let dir: string;
let store: FileStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "carteiras-"));
  process.env.DATA_DIR = dir;
  store = new FileStore();
  // preços de ABEV3 com preços brutos: pregão de 03/01/2024 com abertura de 10,20
  const candles: Candle[] = [
    { date: "2024-01-02", open: 10, high: 10.5, low: 9.8, close: 10.2, volume: 1_000_000, raw: { open: 10, high: 10.5, low: 9.8, close: 10.2 } },
    { date: "2024-01-03", open: 10.2, high: 10.6, low: 10.0, close: 10.4, volume: 1_000_000, raw: { open: 10.2, high: 10.6, low: 10.0, close: 10.4 } },
  ];
  fs.mkdirSync(path.join(dir, "prices"), { recursive: true });
  fs.writeFileSync(path.join(dir, "prices", "ABEV3.json"), JSON.stringify(candles));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

const ABEV3_DATA = () => new Map([["ABEV3", JSON.parse(fs.readFileSync(path.join(dir, "prices", "ABEV3.json"), "utf-8")) as Candle[]]]);
const runFor = async (pid: string, refDate = "2024-01-03") =>
  runPregaoJob(store, {
    pid,
    data: ABEV3_DATA(),
    splits: new Map(),
    refDate,
    pregao: (await getParams(store, pid))!,
    params: DEFAULT_SETTINGS.params,
    cdiMap: new Map(),
    now: new Date("2024-01-03T21:00:00Z"),
  });

describe("carteiras simuladas", () => {
  it("cada carteira começa com o capital informado e os próprios parâmetros", async () => {
    const a = await createCarteira(store, { name: "A", capital: 50_000, today: "2024-01-02" });
    const b = await createCarteira(store, { name: "B", capital: 200_000, params: { slippage: 0.005 }, today: "2024-01-02" });
    expect((await store.getPregao(a.id))!.cash).toBe(50_000);
    expect((await store.getPregao(b.id))!.cash).toBe(200_000);
    expect((await getParams(store, b.id))!.slippage).toBe(0.005);
    expect((await getParams(store, a.id))!.slippage).toBe(DEFAULT_SETTINGS.pregao.slippage);
    expect(await store.getPregao(PREGAO_DEFAULT)).toBeNull();
  });

  it("ordem em uma carteira só executa nela e não toca na outra", async () => {
    const a = await createCarteira(store, { name: "A", capital: 50_000, today: "2024-01-02" });
    const b = await createCarteira(store, { name: "B", capital: 200_000, today: "2024-01-02" });
    const err = await placeOrder(store, a.id, (await getParams(store, a.id))!, { ticker: "ABEV3", side: "BUY", type: "MARKET", qty: 100 }, "2024-01-02");
    expect(err).toBeNull();

    await runFor(a.id);
    const ordersA = await store.listOrders(a.id);
    expect(ordersA).toHaveLength(1);
    expect(ordersA[0].status).toBe("EXECUTED");
    expect(ordersA[0].avgPrice).toBeCloseTo(10.2 * 1.001, 6);
    expect((await store.getPregao(a.id))!.positions[0].qty).toBe(100);

    expect(await store.listOrders(b.id)).toHaveLength(0);
    expect((await store.getPregao(b.id))!.cash).toBe(200_000);
    expect(await store.listFills(b.id)).toHaveLength(0);
    expect(await store.listFills(a.id)).toHaveLength(1);
  });

  it("recusa compra acima do caixa da carteira", async () => {
    const a = await createCarteira(store, { name: "A", capital: 50_000, today: "2024-01-02" });
    const err = await placeOrder(store, a.id, (await getParams(store, a.id))!, { ticker: "ABEV3", side: "BUY", type: "MARKET", qty: 10_000 }, "2024-01-02");
    expect(err).toContain("Saldo insuficiente");
    expect(await store.listOrders(a.id)).toHaveLength(0);
  });

  it("recusa venda sem posição e cancela ordem aberta", async () => {
    const a = await createCarteira(store, { name: "A", capital: 50_000, today: "2024-01-02" });
    const pg = (await getParams(store, a.id))!;
    expect(await placeOrder(store, a.id, pg, { ticker: "ABEV3", side: "SELL", type: "MARKET", qty: 10 }, "2024-01-02")).toContain("Você tem 0");
    expect(await placeOrder(store, a.id, pg, { ticker: "ABEV3", side: "BUY", type: "LIMIT", qty: 10, limitPrice: 5 }, "2024-01-02")).toBeNull();
    const [o] = await store.listOrders(a.id);
    await cancelOrder(store, a.id, o.id);
    expect((await store.listOrders(a.id))[0].status).toBe("CANCELLED");
  });

  it("alterar parâmetros de uma carteira não muda as outras", async () => {
    const a = await createCarteira(store, { name: "A", capital: 50_000, today: "2024-01-02" });
    const b = await createCarteira(store, { name: "B", capital: 50_000, today: "2024-01-02" });
    await saveParams(store, a.id, { slippage: 0.01, fixedFee: 7 });
    expect((await getParams(store, a.id))!.slippage).toBe(0.01);
    expect((await getParams(store, a.id))!.fixedFee).toBe(7);
    expect((await getParams(store, b.id))!.slippage).toBe(DEFAULT_SETTINGS.pregao.slippage);
    expect((await getParams(store, a.id))!.capital).toBe(50_000);
  });

  it("zerar recomeça a carteira com o novo capital e apaga o histórico só dela", async () => {
    const a = await createCarteira(store, { name: "A", capital: 50_000, today: "2024-01-02" });
    const b = await createCarteira(store, { name: "B", capital: 50_000, today: "2024-01-02" });
    await placeOrder(store, a.id, (await getParams(store, a.id))!, { ticker: "ABEV3", side: "BUY", type: "MARKET", qty: 10 }, "2024-01-02");
    await placeOrder(store, b.id, (await getParams(store, b.id))!, { ticker: "ABEV3", side: "BUY", type: "MARKET", qty: 10 }, "2024-01-02");
    await resetCarteira(store, a.id, 80_000, "2024-01-02");
    expect((await store.getPregao(a.id))!.initialCapital).toBe(80_000);
    expect((await store.getPregao(a.id))!.cash).toBe(80_000);
    expect(await store.listOrders(a.id)).toHaveLength(0);
    expect(await store.listOrders(b.id)).toHaveLength(1);
    expect((await getParams(store, a.id))!.capital).toBe(80_000);
  });

  it("excluir remove a carteira e tudo o que ela registrou", async () => {
    const a = await createCarteira(store, { name: "A", capital: 50_000, today: "2024-01-02" });
    const b = await createCarteira(store, { name: "B", capital: 50_000, today: "2024-01-02" });
    await placeOrder(store, a.id, (await getParams(store, a.id))!, { ticker: "ABEV3", side: "BUY", type: "MARKET", qty: 10 }, "2024-01-02");
    await deleteCarteira(store, a.id);
    expect((await store.listCarteiras()).map((c) => c.id)).toEqual([b.id]);
    expect(await store.getPregao(a.id)).toBeNull();
    expect(await store.listOrders(a.id)).toHaveLength(0);
  });

  it("ordens antigas sem identificador de carteira pertencem ao pregão padrão", async () => {
    fs.writeFileSync(path.join(dir, "pregao_orders.json"), JSON.stringify([
      { id: "antiga", createdAt: "2024-01-02T20:00:00.000Z", createdDate: "2024-01-02", ticker: "ABEV3", side: "BUY", type: "MARKET", qty: 1, status: "OPEN", filledQty: 0, avgPrice: 0, fees: 0 },
    ]));
    const a = await createCarteira(store, { name: "A", capital: 50_000, today: "2024-01-02" });
    expect((await store.listOrders()).map((o) => o.id)).toEqual(["antiga"]);
    expect(await store.listOrders(a.id)).toHaveLength(0);
  });
});
