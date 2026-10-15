// Carteira REAL do usuário: posições por preço médio e apuração mensal de IR (swing trade, 15%).
export interface RealTx { id: string; date: string; ticker: string; side: "BUY" | "SELL"; qty: number; price: number; fees: number }

export interface RealPosition { ticker: string; qty: number; avgCost: number; firstBuy: string }

export interface TaxMonth {
  month: string; // AAAA-MM
  salesTotal: number; // vendas de ações (sem ETFs)
  salesEtf: number;
  gainStocks: number; // lucro/prejuízo realizado em ações
  gainEtf: number;
  exempt: boolean; // vendas de ações <= R$ 20 mil e isenção ligada
  taxableBase: number; // base depois de isenção e compensação
  lossUsed: number;
  lossCarryAfter: number;
  tax: number;
  dueDate: string; // vencimento do DARF (último dia útil do mês seguinte, aproximado)
  dayTradeWarning: boolean; // compra e venda do mesmo ativo no mesmo dia (day trade tem outra regra: 20%)
}

export function realPositions(txs: RealTx[]): RealPosition[] {
  const m = new Map<string, { qty: number; cost: number; first: string }>();
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    const p = m.get(t.ticker) ?? { qty: 0, cost: 0, first: t.date };
    if (t.side === "BUY") {
      if (p.qty <= 0) p.first = t.date;
      p.qty += t.qty;
      p.cost += t.qty * t.price + t.fees;
    } else {
      const avg = p.qty > 0 ? p.cost / p.qty : 0;
      const q = Math.min(t.qty, p.qty);
      p.qty -= q;
      p.cost -= avg * q;
    }
    m.set(t.ticker, p);
  }
  return [...m.entries()]
    .filter(([, p]) => p.qty > 1e-9)
    .map(([ticker, p]) => ({ ticker, qty: p.qty, avgCost: p.cost / p.qty, firstBuy: p.first }));
}

function lastWeekdayOfNextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m + 1, 0)); // último dia do mês seguinte
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function taxMonths(txs: RealTx[], opts: { etfs: string[]; useExemption: boolean; rate: number }): TaxMonth[] {
  const state = new Map<string, { qty: number; cost: number }>();
  const months = new Map<string, { salesStock: number; salesEtf: number; gainStock: number; gainEtf: number; dt: boolean }>();
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  const boughtToday = new Set<string>();
  for (const t of sorted) {
    const p = state.get(t.ticker) ?? { qty: 0, cost: 0 };
    const key = t.date.slice(0, 7);
    const mo = months.get(key) ?? { salesStock: 0, salesEtf: 0, gainStock: 0, gainEtf: 0, dt: false };
    if (t.side === "BUY") {
      p.qty += t.qty;
      p.cost += t.qty * t.price + t.fees;
      boughtToday.add(`${t.date}|${t.ticker}`);
    } else {
      const avg = p.qty > 0 ? p.cost / p.qty : t.price;
      const q = Math.min(t.qty, Math.max(p.qty, t.qty));
      const proceeds = q * t.price - t.fees;
      const gain = proceeds - avg * q;
      p.qty = Math.max(0, p.qty - q);
      p.cost = Math.max(0, p.cost - avg * q);
      const isEtf = opts.etfs.includes(t.ticker);
      if (isEtf) { mo.salesEtf += q * t.price; mo.gainEtf += gain; } else { mo.salesStock += q * t.price; mo.gainStock += gain; }
      if (boughtToday.has(`${t.date}|${t.ticker}`)) mo.dt = true;
    }
    state.set(t.ticker, p);
    months.set(key, mo);
  }
  const out: TaxMonth[] = [];
  let loss = 0;
  for (const month of [...months.keys()].sort()) {
    const m = months.get(month)!;
    const exempt = opts.useExemption && m.salesStock <= 20000;
    // em mês isento, o lucro de ações não é tributado; prejuízo continua contando
    const stockPart = exempt && m.gainStock > 0 ? 0 : m.gainStock;
    const net = stockPart + m.gainEtf;
    let used = 0, tax = 0, base = 0;
    if (net > 0) {
      used = Math.min(loss, net);
      loss -= used;
      base = net - used;
      tax = base * opts.rate;
    } else {
      loss += -net;
    }
    out.push({
      month, salesTotal: m.salesStock, salesEtf: m.salesEtf, gainStocks: m.gainStock, gainEtf: m.gainEtf, exempt,
      taxableBase: base, lossUsed: used, lossCarryAfter: loss, tax, dueDate: lastWeekdayOfNextMonth(month), dayTradeWarning: m.dt,
    });
  }
  return out;
}
