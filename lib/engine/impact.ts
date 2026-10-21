/**
 * Impacto de mercado por raiz quadrada (port de quantlib/impact.py, `sqrt_impact`, do Vibe-Trading, MIT).
 *
 *   impacto relativo = eta × sigma × sqrt(Q / ADV)
 *
 * Q: quantidade executada (ações); ADV: volume médio diário (ações); sigma: volatilidade diária (decimal);
 * eta: elasticidade (0,3 a 0,8 é a faixa usual). O impacto cresce com o tamanho da ordem, mas cada ação
 * adicional custa menos que a anterior. Não é execução ótima (Almgren-Chriss): é só o termo de impacto.
 */

export const DEFAULT_IMPACT_ETA = 0.5;

export function sqrtImpactRel(qty: number, adv: number, sigma: number, eta: number): number {
  if (!Number.isFinite(qty) || qty < 0) throw new Error(`quantidade inválida: ${qty}`);
  if (!Number.isFinite(adv) || adv <= 0) throw new Error(`volume médio inválido: ${adv}`);
  if (!Number.isFinite(sigma) || sigma < 0) throw new Error(`volatilidade inválida: ${sigma}`);
  if (!Number.isFinite(eta) || eta < 0) throw new Error(`elasticidade inválida: ${eta}`);
  return eta * sigma * Math.sqrt(qty / adv);
}

/**
 * Estatísticas de mercado usadas pelo impacto, calculadas só com pregões ANTERIORES a `index`
 * (o preço de abertura é conhecido no início do pregão; o volume e o fechamento do dia, não).
 */
export function priorMarketStats(
  candles: { close: number; volume: number; raw?: { close: number } }[],
  index: number,
  windowAdv = 60,
  windowSigma = 20,
): { adv: number; sigma: number } | null {
  if (index < 1) return null;
  const from = Math.max(0, index - windowAdv);
  const vols = candles.slice(from, index).map((c) => c.volume).filter((v) => Number.isFinite(v) && v >= 0);
  if (vols.length < 20) return null;
  const adv = vols.reduce((a, v) => a + v, 0) / vols.length;

  const sFrom = Math.max(1, index - windowSigma);
  const rets: number[] = [];
  for (let j = sFrom; j < index; j++) {
    const a = candles[j - 1].raw?.close ?? candles[j - 1].close;
    const b = candles[j].raw?.close ?? candles[j].close;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 10) return null;
  const mean = rets.reduce((a, r) => a + r, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return { adv, sigma: Math.sqrt(variance) };
}
