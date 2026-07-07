// Historical analogue finder: ranks past months by how similar their full
// 13-indicator z-vector was to today's, then reports what actually followed.
// This replaces eyeballing "which episode feels like now" with a computed
// match on the same indicator vector the MRS engine scores — and it makes the
// answer verifiable (each analogue links to the composite history that
// followed it). Cosine similarity is used because the *shape* of the setup
// (which pillars are stretched, which way) matters more than its overall
// magnitude.

import { INDICATORS } from "./meta.js";
import { EPISODES } from "./narrative.js";

const IND_CODES = Object.keys(INDICATORS);

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function monthDiff(a, b) {
  // months from a to b, YYYY-MM-DD strings
  return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
}

// Returns the top-n most similar historical months to `currentZ`, each with
// the forward outcome that followed (from the composite history):
// { date, sim, regime, composite, fwd6, fwd12, worst12, regime12, episode }
// - excludes the trailing `excludeMonths` (an analogue that overlaps today's
//   own data isn't an analogue) and de-duplicates matches within 6 months of
//   a better one, so the list spans distinct historical setups.
export function similarMonths(indicatorsWide, compositeHistory, currentZ, opts = {}) {
  const n = opts.n ?? 3;
  const excludeMonths = opts.excludeMonths ?? 12;
  const codes = IND_CODES.filter((c) => currentZ[c] != null);
  const vNow = codes.map((c) => +currentZ[c]);

  const compByDate = new Map(compositeHistory.map((r, i) => [r.date, i]));
  const lastDate = compositeHistory[compositeHistory.length - 1].date;

  const scored = [];
  for (const row of indicatorsWide) {
    if (monthDiff(row.date, lastDate) < excludeMonths) continue;
    if (!compByDate.has(row.date)) continue; // needs a scored composite month
    const v = codes.map((c) => row[`${c}_z`]);
    if (v.some((x) => x == null || isNaN(+x))) continue;
    scored.push({ date: row.date, sim: cosine(vNow, v.map(Number)) });
  }
  scored.sort((a, b) => b.sim - a.sim);

  const picked = [];
  for (const cand of scored) {
    if (picked.some((p) => Math.abs(monthDiff(p.date, cand.date)) < 6)) continue;
    picked.push(cand);
    if (picked.length >= n) break;
  }

  return picked.map((p) => {
    const i = compByDate.get(p.date);
    const at = compositeHistory[i];
    const at6 = compositeHistory[i + 6];
    const at12 = compositeHistory[i + 12];
    const next12 = compositeHistory.slice(i + 1, i + 13);
    const worst = next12.length
      ? next12.reduce((m, r) => (r.composite < m.composite ? r : m), next12[0])
      : null;
    return {
      date: p.date,
      sim: p.sim,
      regime: at.regime_confirmed || at.regime_raw,
      composite: at.composite,
      fwd6: at6 ? at6.composite - at.composite : null,
      fwd12: at12 ? at12.composite - at.composite : null,
      worst12: worst ? { composite: worst.composite, date: worst.date, regime: worst.regime_confirmed } : null,
      regime12: at12 ? (at12.regime_confirmed || at12.regime_raw) : null,
      episode: episodeContaining(p.date),
    };
  });
}

// If the analogue month falls inside one of the curated backtest episodes,
// return it so the card can carry the curated context alongside the numbers.
function episodeContaining(date) {
  const ym = date.slice(0, 7);
  return EPISODES.find((e) => {
    const [start, end] = e.period.split("–").map((s) => s.trim());
    return ym >= start && ym <= end;
  }) || null;
}
