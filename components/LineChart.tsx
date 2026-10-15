export interface Series { name: string; color: string; points: { x: string; y: number }[]; dashed?: boolean }

/** gráfico de linhas em SVG puro (sem dependências); eixo X por índice de data da série mais longa */
export default function LineChart({ series, height = 220, money = false, logScale = false }: { series: Series[]; height?: number; money?: boolean; logScale?: boolean }) {
  const all = series.flatMap((s) => s.points).filter((p) => Number.isFinite(p.y) && (!logScale || p.y > 0));
  if (!all.length) return <p className="py-8 text-center text-sm opacity-60">Sem dados para o gráfico.</p>;
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const xi = new Map(xs.map((x, i) => [x, i]));
  const tf = (y: number) => (logScale ? Math.log(y) : y);
  const ys = all.map((p) => tf(p.y));
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const W = 800, H = height, pl = 8, pr = 8, pt = 8, pb = 22;
  const X = (x: string) => pl + ((xi.get(x) ?? 0) / Math.max(1, xs.length - 1)) * (W - pl - pr);
  const Y = (y: number) => pt + (1 - (tf(y) - lo) / (hi - lo)) * (H - pt - pb);
  const fmt = (v: number) => (money ? v.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 }) : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
  const back = (v: number) => (logScale ? Math.exp(v) : v);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="gráfico de linhas">
        {[0, 0.5, 1].map((t) => {
          const y = pt + t * (H - pt - pb);
          return <line key={t} x1={pl} x2={W - pr} y1={y} y2={y} stroke="currentColor" opacity="0.12" />;
        })}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "5 4" : undefined}
            points={s.points.filter((p) => Number.isFinite(p.y) && (!logScale || p.y > 0)).map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ")} />
        ))}
        <text x={pl} y={H - 6} fontSize="11" fill="currentColor" opacity="0.6">{xs[0]}</text>
        <text x={W - pr} y={H - 6} fontSize="11" fill="currentColor" opacity="0.6" textAnchor="end">{xs[xs.length - 1]}</text>
        <text x={W - pr} y={pt + 10} fontSize="11" fill="currentColor" opacity="0.6" textAnchor="end">{fmt(back(hi))}</text>
        <text x={W - pr} y={H - pb - 4} fontSize="11" fill="currentColor" opacity="0.6" textAnchor="end">{fmt(back(lo))}</text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
