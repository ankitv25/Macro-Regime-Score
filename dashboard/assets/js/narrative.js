// Narrative layer: turns the monitoring data into plain-English interpretation.
// This is the part of the dashboard that explains what the numbers MEAN. Every
// function here is pure (data in, string/array out) and grounds its wording in
// the methodology doc (regime thresholds §4.4, pillar intuition §4.2-4.3, event
// history §5, current-reading narrative §7.6). No DOM, no fetching.

import { PILLARS, INDICATORS } from "./meta.js";
import { ordinal } from "./format.js";

// Regime ordering and the z-thresholds that separate them (methodology §4.4).
export const REGIME_ORDER = ["Contraction", "Slowdown", "Neutral", "Expansion"];
export const REGIME_BELOW = { Expansion: "Neutral", Neutral: "Slowdown", Slowdown: "Contraction", Contraction: null };
export const REGIME_ABOVE = { Contraction: "Slowdown", Slowdown: "Neutral", Neutral: "Expansion", Expansion: null };

// z-score boundaries between regimes; current composite is in z-units.
export const Z_BOUNDARIES = [-1.0, -0.3, 0.35]; // Contraction|Slowdown|Neutral|Expansion

export const REGIME_DEFS = {
  Expansion: { z: "≥ +0.35", plain: "Broadly favorable macro conditions — growth and risk appetite supportive." },
  Neutral: { z: "−0.30 to +0.35", plain: "Mixed, late-cycle-style conditions with no decisive direction." },
  Slowdown: { z: "−1.00 to −0.30", plain: "Deteriorating conditions — growth softening or stress building, but not yet crisis." },
  Contraction: { z: "< −1.00", plain: "Recession-grade stress — the score only reaches here in genuine US downturns (GFC, COVID)." },
};

// Historical episodes from the v2.1 backtest (methodology §5.5 / §5.9 event
// table) — used to anchor today's reading in precedent.
export const EPISODES = [
  { name: "2008–09 Global Financial Crisis", period: "2008-09 – 2009-06", regime: "Contraction", mean: -1.73, note: "The deepest reading in the sample; raw Contraction fired in March 2008, nine months before NBER's recession call." },
  { name: "COVID crash", period: "2020-02 – 2020-05", regime: "Contraction", mean: -1.18, note: "The only other Contraction episode — a sharp, short collapse in growth and a spike in market stress." },
  { name: "2022 inflation bear market", period: "2022-01 – 2022-12", regime: "Slowdown", mean: -0.46, note: "Classified Slowdown, not Contraction — a rate/valuation shock without a credit-led recession." },
  { name: "China / EM stress", period: "2015-08 – 2016-02", regime: "Neutral", mean: -0.18, note: "Stayed Neutral — correctly, since it never caused a US recession." },
  { name: "Euro sovereign-debt crisis", period: "2011-08 – 2011-12", regime: "Neutral", mean: -0.07, note: "An overseas crisis that left US macro conditions only marginally soft." },
  { name: "2021 reopening", period: "2021-03 – 2021-12", regime: "Neutral", mean: 0.16, note: "Reading Neutral despite strong growth — overheating inflation dragged the score down (the quadrant logic at work)." },
  { name: "2017 expansion", period: "2017-01 – 2017-12", regime: "Neutral → Expansion", mean: 0.39, note: "A clean, low-stress expansion that drifted between Neutral and Expansion." },
  { name: "2003–04 expansion", period: "2003-06 – 2004-06", regime: "Expansion", mean: 0.81, note: "The strongest expansion reading in the sample — supportive growth, low stress, contained inflation." },
];

// --- small formatters --------------------------------------------------------

export function signed(x, dp = 2) {
  if (x == null) return "–";
  return (x >= 0 ? "+" : "") + x.toFixed(dp);
}

export function pillarLabel(id) {
  return PILLARS[id]?.label ?? id;
}

// score (z) -> qualitative standing word, aligned to the regime bands.
export function standingWord(z) {
  if (z == null) return "n/a";
  if (z >= 0.35) return "favorable";
  if (z >= -0.3) return "neutral";
  if (z >= -1.0) return "soft";
  return "stressed";
}

// --- the verdict: the five-minute takeaway ----------------------------------

export function trendPhrase(latest) {
  const chg = latest.comp_3m_chg;
  if (latest.direction_flag === "deteriorating") return `drifting softer (3-month change ${signed(chg)} z)`;
  if (latest.direction_flag === "improving") return `firming (3-month change ${signed(chg)} z)`;
  return `broadly stable (3-month change ${signed(chg)} z)`;
}

export function verdictSentences(latest) {
  const regime = latest.regime_confirmed || latest.regime_raw;
  const below = REGIME_BELOW[regime];
  const above = REGIME_ABOVE[regime];
  const out = [];

  out.push(
    `The US macro environment is in <strong>${regime}</strong> — month ${latest.months_in_regime} of this regime — and ${trendPhrase(latest)}.`
  );
  out.push(
    `The largest drag on the composite is <strong>${pillarLabel(latest.top_drag)}</strong>; the largest support is <strong>${pillarLabel(latest.top_support)}</strong>. Breadth is ${(latest.diffusion * 100).toFixed(0)}% of the 13 indicators positive${latest.breadth_check ? ` (${latest.breadth_check})` : ""}.`
  );

  const moves = [];
  if (below && latest.dist_to_downgrade != null)
    moves.push(`a ${latest.dist_to_downgrade.toFixed(2)} z decline would drop it into <strong>${below}</strong>`);
  if (above && latest.dist_to_upgrade != null)
    moves.push(`a ${latest.dist_to_upgrade.toFixed(2)} z rise would lift it to <strong>${above}</strong>`);
  if (moves.length) out.push(`From here, ${moves.join(", and ")}.`);

  if (latest.regime_change_watch)
    out.push(`<span class="warn">⚠ Regime-change watch is active</span> — the score is within 0.10 z of a boundary and moving toward it.`);

  return out;
}

// --- what changed this month -------------------------------------------------

export function flagSentences(activeFlags) {
  if (!activeFlags.length) return ["No deterioration or improvement flags are active this month — conditions are steady across all 13 indicators."];
  return activeFlags.map((f) => {
    const name = f.level === "indicator" ? (INDICATORS[f.name]?.label ?? f.name) : `${pillarLabel(f.name)} pillar`;
    const verb = f.flag.includes("deterioration") ? "deteriorating" : "improving";
    return `<strong>${name}</strong> — ${verb} (6-month z-change ${signed(f.magnitude)}).`;
  });
}

export function pillarDirectionSummary(pillarsLong, anchorDate) {
  const latestDate = anchorDate ?? pillarsLong.reduce((m, r) => (r.date > m ? r.date : m), "");
  const rows = pillarsLong.filter((r) => r.date === latestDate);
  const improving = rows.filter((r) => r.direction_flag === "improving").map((r) => pillarLabel(r.pillar));
  const deteriorating = rows.filter((r) => r.direction_flag === "deteriorating").map((r) => pillarLabel(r.pillar));
  const parts = [];
  if (improving.length) parts.push(`improving: ${improving.join(", ")}`);
  if (deteriorating.length) parts.push(`deteriorating: ${deteriorating.join(", ")}`);
  if (!parts.length) return "All five pillars are holding broadly flat this month.";
  return `Pillar direction this month — ${parts.join("; ")}. The rest are flat.`;
}

// --- pillar scorecard interpretation ----------------------------------------

export function pillarReadout(row) {
  const meta = PILLARS[row.pillar];
  const standing = standingWord(row.score);
  return {
    id: row.pillar,
    label: meta.label,
    weight: meta.weight,
    score: row.score,
    standing,
    direction: row.direction_flag,
    breadth: row.breadth,
    sentence: `${meta.description} Currently <strong>${standing}</strong> (z ${signed(row.score)}, ${row.direction_flag}), with ${(row.breadth * 100).toFixed(0)}% of its indicators positive.`,
  };
}

// --- historical analogue ranking --------------------------------------------

export function nearestEpisodes(currentComposite, n = 3) {
  return [...EPISODES]
    .map((e) => ({ ...e, dist: Math.abs(e.mean - currentComposite) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n);
}

// --- multi-horizon momentum (composite §8.2 momentum panel) -----------------

export function momentumSeries(latest) {
  return [
    { label: "1M", value: latest.comp_1m_chg },
    { label: "3M", value: latest.comp_3m_chg },
    { label: "6M", value: latest.comp_6m_chg },
    { label: "12M", value: latest.comp_12m_chg },
  ];
}

// --- regime trajectory (direction of travel, §7.1 direction_flag) -----------

export const TRAJECTORY = {
  improving: { word: "Improving", glyph: "▲", tone: "pos" },
  deteriorating: { word: "Weakening", glyph: "▼", tone: "neg" },
  flat: { word: "Stable", glyph: "▬", tone: "neutral" },
};

export function regimeTrajectory(latest) {
  return TRAJECTORY[latest.direction_flag] || TRAJECTORY.flat;
}

// --- threshold proximity, framed against the 10y rolling std (§7.3) ---------
// "X.X of a typical month's move" is a distance-based confidence proxy, not a
// probability - deliberately avoids inventing precision the methodology
// doesn't support.

export function thresholdProximity(latest, regime) {
  const std = latest.comp_rolling_std_10y;
  const out = [];
  const below = REGIME_BELOW[regime];
  const above = REGIME_ABOVE[regime];
  if (below && latest.dist_to_downgrade != null) {
    out.push({
      dir: "down",
      target: below,
      dist: latest.dist_to_downgrade,
      ratio: std ? latest.dist_to_downgrade / std : null,
    });
  }
  if (above && latest.dist_to_upgrade != null) {
    out.push({
      dir: "up",
      target: above,
      dist: latest.dist_to_upgrade,
      ratio: std ? latest.dist_to_upgrade / std : null,
    });
  }
  return out;
}

// --- composite attribution: pillar contributions ranked for the anchor month -

export function attributionRanked(pillarsLong, anchorDate) {
  return pillarsLong
    .filter((r) => r.date === anchorDate && r.contribution != null)
    .map((r) => ({ ...r, label: pillarLabel(r.pillar), color: PILLARS[r.pillar].color }))
    .sort((a, b) => b.contribution - a.contribution);
}

// --- analyst summary: structured, data-grounded bullets ---------------------
// Replaces a paragraph-style note with six short blocks, each tying directly
// to a number shown elsewhere on the dashboard (score movement, breadth,
// attribution, positives, risks, regime implication).

export function analystSummaryCards(latest, pillarsLong, activeFlags, regime, anchorDate) {
  const ranked = attributionRanked(pillarsLong, anchorDate);
  const positives = ranked.filter((r) => r.contribution > 0);
  const drags = [...ranked].reverse().filter((r) => r.contribution < 0);

  const cards = [];

  // 1. Score movement
  const trendGap = latest.comp_trend_6m - latest.composite;
  let trendNote;
  if (trendGap > 0.05) trendNote = `Below its 6-month trend average (${signed(latest.comp_trend_6m)} z) — recent months have softened relative to trend.`;
  else if (trendGap < -0.05) trendNote = `Above its 6-month trend average (${signed(latest.comp_trend_6m)} z) — recent months have improved relative to trend.`;
  else trendNote = `In line with its 6-month trend average (${signed(latest.comp_trend_6m)} z).`;
  cards.push({
    title: "Score movement",
    items: [
      `Composite ${signed(latest.composite)} z (display ${latest.display_score.toFixed(2)}/5) — 1M ${signed(latest.comp_1m_chg)}, 3M ${signed(latest.comp_3m_chg)}, 6M ${signed(latest.comp_6m_chg)}, 12M ${signed(latest.comp_12m_chg)}.`,
      trendNote,
    ],
  });

  // 2. Breadth confirmation
  const posCount = Math.round((latest.diffusion || 0) * 13);
  const breadthItems = [`${(latest.diffusion * 100).toFixed(0)}% of indicators positive (${posCount} of 13).`];
  if (latest.breadth_check === "confirmed") breadthItems.push("Breadth-confirmed — diffusion moved with the composite over the last 6 months.");
  else if (latest.breadth_check === "narrow") breadthItems.push("Breadth-narrow — this move is driven by a few indicators, historically more prone to reversing.");
  else breadthItems.push("No breadth-confirmation signal this month (move too small to test).");
  cards.push({ title: "Breadth confirmation", items: breadthItems });

  // 3. Attribution drivers
  const rankLine = ranked.map((r) => `${r.label} ${signed(r.contribution, 3)}`).join(", ");
  cards.push({
    title: "Attribution drivers",
    items: [
      `<strong>${ranked[0].label}</strong> (${signed(ranked[0].contribution, 3)}) is the largest support; <strong>${ranked[ranked.length - 1].label}</strong> (${signed(ranked[ranked.length - 1].contribution, 3)}) is the largest drag.`,
      `Ranked, high to low: ${rankLine}.`,
    ],
  });

  // 4. Key positives
  cards.push({
    title: "Key positives",
    items: positives.length
      ? positives.slice(0, 3).map((r) => `<strong>${r.label}</strong> — z ${signed(r.score)}, ${ordinal(Math.round(r.pctile_expanding))} pct, ${r.direction_flag}, contributing ${signed(r.contribution, 3)}.`)
      : ["No pillar is currently a net positive contributor."],
  });

  // 5. Key risks
  const riskItems = drags.slice(0, 2).map((r) => `<strong>${r.label}</strong> — z ${signed(r.score)}, ${ordinal(Math.round(r.pctile_expanding))} pct, ${r.direction_flag}${r.streak_months > 1 ? ` for ${r.streak_months} months` : ""}, contributing ${signed(r.contribution, 3)}.`);
  const indicatorFlags = activeFlags.filter((f) => f.level === "indicator");
  if (indicatorFlags.length) {
    riskItems.push(
      `Active deterioration flags: ${indicatorFlags.map((f) => `${INDICATORS[f.name]?.label ?? f.name} (${signed(f.magnitude)})`).join(", ")}.`
    );
  }
  cards.push({ title: "Key risks", items: riskItems.length ? riskItems : ["No pillar is currently a net drag and no flags are active."] });

  // 6. Regime implication
  const traj = regimeTrajectory(latest);
  const proximity = thresholdProximity(latest, regime);
  const regimeItems = [`<strong>${regime}</strong>, month ${latest.months_in_regime} — trajectory: <strong>${traj.word.toLowerCase()}</strong> (${trendPhrase(latest)}).`];
  proximity.forEach((p) => {
    const ratioTxt = p.ratio != null ? ` — about ${p.ratio.toFixed(1)}× a typical month's move (10y std ${latest.comp_rolling_std_10y.toFixed(2)} z)` : "";
    regimeItems.push(`A ${p.dist.toFixed(2)} z ${p.dir === "down" ? "decline" : "rise"} would move it to <strong>${p.target}</strong>${ratioTxt}.`);
  });
  regimeItems.push(latest.regime_change_watch ? "<span class=\"warn\">⚠ Regime-change watch is active.</span>" : "Regime-change watch: not active.");
  cards.push({ title: "Regime implication", items: regimeItems });

  return cards;
}
