/**
 * Métricas de risco das carteiras (port de quantlib/risk.py e volatility.py do Vibe-Trading, MIT).
 * VaR e CVaR históricos: lidos diretamente da distribuição dos retornos passados, sem supor normalidade.
 */

const TRADING_DAYS = 252;

/** retornos diários a partir de uma curva de patrimônio */
export function returnsFromEquity(equity: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1] > 0) out.push(equity[i] / equity[i - 1] - 1);
  }
  return out;
}

/**
 * posição do quantil na amostra ordenada: ceil((1-c)·n) - 1 (convenção de quantlib/risk.py).
 * O arredondamento antes do ceil evita erro de ponto flutuante: (1 - 0,95) × 100 vale 5,000000000000004.
 */
function tailIndex(n: number, confidence: number): number {
  const q = Math.round((1 - confidence) * n * 1e9) / 1e9;
  return Math.min(Math.max(Math.ceil(q) - 1, 0), n - 1);
}

function assertConfidence(c: number) {
  if (!(c > 0 && c < 1)) throw new Error(`nível de confiança inválido: ${c}`);
}

/** VaR histórico: perda (valor positivo) que não foi superada na proporção `confidence` dos dias */
export function historicalVar(returns: number[], confidence = 0.95): number {
  assertConfidence(confidence);
  const v = returns.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  return -v[tailIndex(v.length, confidence)];
}

/** CVaR (déficit esperado): média das perdas piores que o VaR */
export function historicalCvar(returns: number[], confidence = 0.95): number {
  assertConfidence(confidence);
  const v = returns.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const tail = v.slice(0, tailIndex(v.length, confidence) + 1);
  return -(tail.reduce((a, x) => a + x, 0) / tail.length);
}

/** volatilidade anualizada (desvio-padrão dos retornos × √252) */
export function annualizedVolatility(returns: number[]): number {
  const v = returns.filter(Number.isFinite);
  if (v.length < 2) return NaN;
  const mean = v.reduce((a, x) => a + x, 0) / v.length;
  const variance = v.reduce((a, x) => a + (x - mean) ** 2, 0) / (v.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS);
}

/** queda máxima da curva (valor negativo, ex.: -0,18 para 18%) */
export function maxDrawdown(equity: number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    if (peak > 0) mdd = Math.min(mdd, e / peak - 1);
  }
  return mdd;
}

export interface RiskReport {
  days: number; // retornos diários usados
  volatility: number; // anualizada
  var95: number; // perda diária, fração do patrimônio
  var99: number;
  cvar95: number;
  maxDrawdown: number;
}

/** relatório completo a partir da curva de patrimônio; `null` quando há poucos dias para estimar */
export function riskReport(equity: number[], minDays = 20): RiskReport | null {
  const r = returnsFromEquity(equity);
  if (r.length < minDays) return null;
  return {
    days: r.length,
    volatility: annualizedVolatility(r),
    var95: historicalVar(r, 0.95),
    var99: historicalVar(r, 0.99),
    cvar95: historicalCvar(r, 0.95),
    maxDrawdown: maxDrawdown(equity),
  };
}
