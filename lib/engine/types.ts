// Tipos do motor da estratégia "Rompimento N / saída M" (só comprado).

export interface Candle {
  date: string; // AAAA-MM-DD (pregão)
  open: number; // preços ajustados por proventos/desdobramentos
  high: number;
  low: number;
  close: number;
  volume: number; // volume em ações (sem ajuste)
}

export interface Params {
  N: number; // janela do rompimento de compra (maior fechamento dos N dias anteriores)
  M: number; // janela da saída (menor fechamento dos M dias anteriores)
  filter: "none" | "up200"; // up200: só mantém posição com preço acima da média de 200 dias
  frac: number; // fração do patrimônio por posição (0.10 = 10%)
  maxPos: number; // máximo de posições simultâneas
  costSide: number; // custo proporcional por lado (0.001 = 0,10%; ida+volta = 0,20%)
  fixedFee: number; // R$ por ordem de compra ou de venda
  taxRate: number; // IR sobre lucro realizado (swing trade)
  cdiTaxRate: number; // IR sobre rendimento do caixa em CDI
  anomalyLimit: number; // variação diária que marca o dado como suspeito (0.35 = 35%)
}

export const DEFAULT_PARAMS: Params = {
  N: 100,
  M: 10,
  filter: "none",
  frac: 0.1,
  maxPos: 10,
  costSide: 0.001,
  fixedFee: 10,
  taxRate: 0.15,
  cdiTaxRate: 0.15,
  anomalyLimit: 0.35,
};

/** Série diária de sinais de um ativo (todos os arrays alinhados aos candles). */
export interface SignalSeries {
  state: number[]; // 1 = em tendência (comprado), 0 = fora; decidido no fechamento do dia
  hh: number[]; // maior fechamento dos N dias anteriores (NaN até haver histórico)
  ll: number[]; // menor fechamento dos M dias anteriores
  active: boolean[]; // negociado de forma regular (menos de 10% de candles sem variação nos últimos 60)
  liq60: number[]; // volume financeiro médio dos 60 dias anteriores (R$), 0 se sem histórico
  up200: boolean[];
}

/** Situação de um ativo no último fechamento (usada no Radar e nos alertas). */
export interface AssetSignal {
  ticker: string;
  date: string; // data do último fechamento usado
  price: number;
  state: 0 | 1;
  prevState: 0 | 1;
  isNewBreakout: boolean; // virou 1 no último fechamento
  isNewExit: boolean; // virou 0 no último fechamento
  buyLevel: number; // fechamento acima disso amanhã dispara compra (maior fechamento dos últimos N)
  stopLevel: number; // fechamento abaixo disso amanhã dispara venda (menor fechamento dos últimos M)
  distBuyPct: number; // buyLevel / price - 1
  distStopPct: number; // stopLevel / price - 1 (negativo)
  daysInState: number;
  liq60: number;
  active: boolean;
  anomaly: Anomaly | null; // dado suspeito recente (bloqueia compra automática)
  ok: boolean; // dados suficientes para operar
  reason?: string; // motivo quando !ok
}

export interface Anomaly {
  date: string;
  ret: number; // variação do fechamento no dia
}

export interface Position {
  ticker: string;
  qty: number;
  entryDate: string;
  entryPrice: number; // preço de execução (abertura)
  basis: number; // custo total (compra + custos), R$
}

export interface Trade {
  ticker: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number; // lucro líquido de custos, antes do imposto
  ret: number; // pnl / basis
  days: number;
}

export type OrderSide = "BUY" | "SELL";

export interface PendingOrder {
  side: OrderSide;
  ticker: string;
  signalDate: string;
  refPrice: number; // último fechamento
  valueBRL?: number; // valor alvo da compra (frac × patrimônio)
  qtyApprox?: number;
  stopLevel?: number;
  isNew?: boolean;
  waiting?: boolean; // sinal ativo, mas sem vaga livre
}

export interface SimState {
  startDate: string;
  initialCapital: number;
  lastDate: string; // último dia processado
  cash: number;
  positions: Position[];
  trades: Trade[];
  realizedMonth: number; // lucro/prejuízo realizado no mês corrente (R$)
  lossCarry: number; // prejuízo acumulado a compensar (R$)
  taxPaidTotal: number;
  feesPaidTotal: number;
  curve: { date: string; equity: number; cdiNet: number; bova?: number }[];
  pending: PendingOrder[]; // ordens para a próxima abertura
  cdiIndex: number; // valor acumulado do CDI líquido (base 1)
}

export interface DayBar {
  open: number;
  close: number;
}
