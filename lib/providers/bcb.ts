/** CDI diário (série 12 do SGS/Banco Central), taxa do dia em fração (0,0005 = 0,05%). */
export async function fetchCdi(fromDate: string, toDate: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  let start = new Date(fromDate + "T00:00:00Z");
  const end = new Date(toDate + "T00:00:00Z");
  while (start <= end) {
    const chunkEnd = new Date(Math.min(end.getTime(), start.getTime() + 5 * 365 * 86400000));
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${br(start.toISOString().slice(0, 10))}&dataFinal=${br(chunkEnd.toISOString().slice(0, 10))}`;
    let ok = false;
    for (let k = 0; k < 3 && !ok; k++) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.status === 404) { ok = true; continue; } // o BCB responde 404 quando ainda não há dado no intervalo (CDI do dia sai no dia seguinte)
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows: { data: string; valor: string }[] = await res.json();
        for (const r of rows) out[`${r.data.slice(6, 10)}-${r.data.slice(3, 5)}-${r.data.slice(0, 2)}`] = parseFloat(r.valor) / 100;
        ok = true;
      } catch (e) {
        if (k === 2) throw new Error(`BCB CDI: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    start = new Date(chunkEnd.getTime() + 86400000);
  }
  return out;
}
