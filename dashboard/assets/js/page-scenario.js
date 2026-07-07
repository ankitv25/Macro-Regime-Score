import { loadJSON } from "./data.js";
import { PILLARS, INDICATORS } from "./meta.js";
import { REGIME_COLORS } from "./regime.js";
import { signed } from "./narrative.js";
import { scenarioForecastChart, scenarioPillarChart, scenarioGapWaterfall } from "./charts.js";
import { dualSparkline } from "./spark.js";
import { similarMonths } from "./analogue.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const REVERSION      = 0.08;  // per-month indicator z-score mean-reversion rate
const IND_CODES      = Object.keys(INDICATORS);
const clamp          = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ─── Historical stress windows ────────────────────────────────────────────────
// anchor: last month before the episode; end: last month of the episode.
// Delta-replay logic: today_z[code] + (hist_z[t][code] − hist_z[anchor][code])
// After the episode window closes the path continues with mean-reversion from
// the final projected z-score, keeping all series at 12 months.

const HIST_WINDOWS = {
  gfc: {
    label: "GFC 2008",
    color: "#4a148c",
    anchor: "2007-09-30",
    end:    "2008-09-30",
    headline: "Credit markets froze. Equity fell −57%. Deep Contraction in 6 months.",
    narrative_body: "The 2008–09 GFC was the most severe US recession since the Depression. The delta-replay anchors today's indicator z-scores to September 2007 and applies the actual month-by-month indicator changes through September 2008. Credit pillar implodes first (spread level, momentum), then growth collapses. Stress indicators (VIX, financial stress index, SPY drawdown) reach extreme levels simultaneously.",
    pillar_detail: {
      Growth: "Payrolls collapsed 800K/month at the nadir. IP fell 15% YoY. GDP contracted 4.3% peak-to-trough.",
      Inflation: "Core PCE rose briefly then fell sharply as demand collapsed. Deflationary risk emerged by early 2009.",
      Credit: "IG spreads exceeded 500bp. Funding markets froze. Commercial paper market seized in September 2008.",
      Liquidity: "NFCI surged to historically extreme levels. Fed cut to zero in December 2008.",
      Stress: "VIX peaked at 80. SPY fell −57%. Financial stress index hit records not seen since 1987.",
    },
  },
  covid: {
    label: "COVID 2020",
    color: "#880e4f",
    anchor: "2020-01-31",
    end:    "2020-09-30",
    headline: "Fastest recession in history — and the fastest recovery.",
    narrative_body: "COVID's MRS impact was violent but brief. The delta-replay anchors to January 2020 and applies actual indicator changes through September 2020. All growth indicators collapse simultaneously in month 2, reaching extremes not seen since the GFC. Services spending (g_serv) and payrolls (g_nfp) are the biggest movers. The recovery begins by month 5 as massive policy support fires.",
    pillar_detail: {
      Growth: "GDP fell 29% annualized in Q2 2020. Payrolls lost 22M jobs in 2 months — sharpest labor collapse in recorded history.",
      Inflation: "Initial deflation scare (demand destruction) followed by supply-chain inflation in the recovery phase.",
      Credit: "HY spreads briefly hit 1100bp. IG peaked at 373bp before the Fed's corporate bond backstop.",
      Liquidity: "Fed expanded balance sheet by $3T in 3 months. Zero rates re-imposed immediately.",
      Stress: "VIX hit 66. SPY fell −34% in 23 trading days — fastest 30%+ drawdown in market history.",
    },
  },
  inflation22: {
    label: "Inflation Shock 2022",
    color: "#e65100",
    anchor: "2021-12-31",
    end:    "2022-12-31",
    headline: "CPI hit 9.1%. Fed hiked 425bp. Worst bond bear market in decades.",
    narrative_body: "The 2022 inflation shock was driven by post-COVID demand surge, supply chain dislocation, and energy price spikes. The delta-replay anchors to December 2021 and applies actual indicator changes through December 2022. The inflation pillar (PCE deviation and momentum) is the dominant driver. Notably, growth held relatively well through most of 2022 — payrolls averaged +375K — making this a classic stagflation-adjacent shock.",
    pillar_detail: {
      Growth: "Labor market was resilient through 2022. Payrolls averaged +375K. Growth slowed but didn't collapse.",
      Inflation: "Core PCE hit 5.6%. PCE deviation from target reached historic extremes. Inflation pillar was the dominant drag.",
      Credit: "IG spreads widened 100–150bp. HY widened 300bp. Leveraged borrowers faced rising refinancing costs.",
      Liquidity: "Yield curve inverted sharply (10Y-2Y reached −80bp). NFCI tightened as rate hike expectations repriced.",
      Stress: "S&P 500 fell −25%. VIX elevated but not at crisis levels. Bonds offered no diversification.",
    },
  },
  growth15: {
    label: "Growth Slowdown 2015–16",
    color: "#1565c0",
    anchor: "2015-06-30",
    end:    "2016-02-29",
    headline: "Manufacturing contraction. Dollar surge. China devaluation shock.",
    narrative_body: "The 2015–16 growth slowdown was driven by a surging dollar (DXY +20% from 2014 lows), collapsing energy capex, and contagion from China's currency devaluation. Manufacturing contracted for 5 consecutive months. The delta-replay anchors to June 2015. Importantly, this was a moderate shock — Slowdown, not Contraction — driven primarily by credit widening and moderate market stress. Growth indicators weakened but held positive.",
    pillar_detail: {
      Growth: "Payrolls moderated but stayed positive. IP contracted 2% YoY (energy sector drag). GDP held near 2%.",
      Inflation: "Dollar strength was disinflationary. PCE stayed well below 2%. Fed paused its hiking cycle.",
      Credit: "HY spreads widened 350bp from 2014 lows, driven by energy sector distress and China contagion fears.",
      Liquidity: "NFCI tightened moderately. Yield curve flattened as the Fed signaled a longer pause.",
      Stress: "S&P 500 fell −14% (correction, not bear). VIX briefly hit 40 on the China devaluation announcement.",
    },
  },
  stress11: {
    label: "Sovereign Crisis 2011",
    color: "#00695c",
    anchor: "2011-03-31",
    end:    "2011-10-31",
    headline: "Euro sovereign debt crisis. US credit downgrade. VIX hit 48.",
    narrative_body: "The 2011 episode was driven by the European sovereign debt crisis (Greece, Italy, Spain) and the S&P downgrade of US sovereign debt in August 2011. The delta-replay anchors to March 2011 and applies actual indicator changes through October 2011. US growth fundamentals held reasonably well — the stress was primarily external. The MRS moved from near-Neutral to Slowdown, not Contraction.",
    pillar_detail: {
      Growth: "US growth was relatively stable; payrolls averaged 100–150K. The shock was external, not fundamental.",
      Inflation: "PCE was elevated on energy prices, then fell as growth fears re-emerged in Q3 2011.",
      Credit: "IG spreads widened 100bp. Eurozone peripheral sovereign yields dislocated severely.",
      Liquidity: "NFCI tightened as risk appetite fell. Yield curve flattened amid flight-to-quality.",
      Stress: "VIX hit 48. S&P fell −21%. The fear index stayed elevated from July through October 2011.",
    },
  },
  equity18: {
    label: "Q4 Equity Rout 2018–19",
    color: "#6d4c41",
    anchor: "2018-09-30",
    end:    "2019-06-28",
    headline: "Rate fears and trade war. −20% then full recovery by Q2 2019.",
    narrative_body: "The Q4 2018 episode was driven by Fed tightening fears (10 hikes since 2015) and escalating US-China trade war. SPY fell −20% peak-to-trough in December 2018. The delta-replay anchors to September 2018 and shows the stress (driven by VIX, SPY drawdown, and credit widening) followed by a self-correcting recovery as the Fed pivoted to 'insurance cuts' in 2019. This is the clearest example of a brief, financial-only shock that doesn't impair fundamentals.",
    pillar_detail: {
      Growth: "Underlying growth remained solid; payrolls were strong through late 2018. The shock was financial, not fundamental.",
      Inflation: "PCE was near-target. The Fed's pivot in early 2019 took rate hike risk off the table.",
      Credit: "HY spreads widened 200bp in Q4 2018, then recovered fully by Q2 2019.",
      Liquidity: "Yield curve near inversion; NFCI tightened. Fed's pause and cuts normalized conditions by mid-2019.",
      Stress: "VIX hit 36. SPY fell −20%, then fully recovered within 6 months as the Fed pivoted.",
    },
  },
};

// ─── Named macro scenario definitions (indicator-level shocks) ────────────────
// indicator_deltas: additive shock to each indicator's z-score at peak.
// Positive delta = indicator moves favorably (z-score higher).
// Negative delta = indicator moves adversely (z-score lower).
// Sign conventions mirror INDICATORS in meta.js
// (e.g., i_pce_dev sign "−": favorable inflation = POSITIVE delta → deviation shrinks).

const SCENARIO_DEFS = {
  soft_landing: {
    label: "Soft Landing",
    color: "#2e7d32",
    group: "upside",
    indicator_deltas: {
      g_nfp:      +0.40,
      g_ipman:    +0.30,
      g_gdp:      +0.35,
      g_serv:     +0.40,
      i_pce_dev:  +1.20,
      i_pce_mom:  +1.00,
      l_nfci:     +0.40,
      l_curve:    +0.80,
      c_ig_level: +0.40,
      c_ig_mom:   +0.50,
      s_vix:      +0.40,
      s_bond:     +0.30,
      s_spy_dd:   +0.40,
    },
    peak_month: 6,
    decay: "persist",
    headline: "Inflation returns to 2%. Fed cuts 3×. All five pillars improve.",
    // Live readings are interpolated at render time — never hardcoded, so the
    // prose can't go stale when the data refreshes (ctx = today's pillar scores).
    narrative_body: (ctx) => `The MRS's most optimistic credible scenario. Core PCE decelerates toward 2% while GDP holds above 2%. The Fed cuts 75bp over the year, normalizing the yield curve. Credit spreads tighten from their current levels. The composite moves from ${ctx.regime} toward Expansion. The inflation pillar — currently ${signed(ctx.pillars.inflation)}z${ctx.dragPillar === "inflation" ? ", the largest drag on the composite" : ""} — is the single largest beneficiary as both PCE indicators improve substantially.`,
    pillar_detail: {
      Growth: "Payrolls re-accelerate to 175–200K/month. GDP grows 2.2–2.5%. All four growth indicators improve.",
      Inflation: (ctx) => `Core PCE decelerates from ${ctx.pceLevel ?? "its current level"} toward 2.1–2.3%. Both PCE deviation and momentum indicators improve substantially.`,
      Credit: "Spreads tighten 30–50bp as the economic outlook clears. Credit pillar builds on its current positive reading.",
      Liquidity: "Fed cuts normalize the yield curve (l_curve improves). NFCI eases (l_nfci improves). Both liquidity indicators benefit.",
      Stress: "VIX normalizes below 15. Equity makes new highs. All three stress indicators (VIX, FSI, SPY drawdown) improve.",
    },
  },
  fin_tight: {
    label: "Fin. Conditions Tightening",
    color: "#6d4c41",
    group: "stress",
    indicator_deltas: {
      g_nfp:      -0.30,
      g_ipman:    -0.20,
      g_gdp:      -0.20,
      g_serv:     -0.30,
      i_pce_dev:   0,
      i_pce_mom:   0,
      l_nfci:     -0.90,
      l_curve:    -0.40,
      c_ig_level: -0.60,
      c_ig_mom:   -0.60,
      s_vix:      -0.40,
      s_bond:     -0.40,
      s_spy_dd:   -0.50,
    },
    peak_month: 5,
    decay: "persist",
    headline: "NFCI tightens 0.8–1.0 SDs. Lending standards rise broadly.",
    narrative_body: "A gradual, broad tightening of financial conditions without an acute crisis trigger. NFCI rises 0.8–1.0 standard deviations — comparable to the 2022 tightening episode. Both liquidity and credit indicators deteriorate over 5 months. Growth slows with a lag but stays positive. Inflation pillars are unaffected. The composite moves from Neutral to Slowdown.",
    pillar_detail: {
      Growth: "Slows as tighter conditions reduce business investment and consumer credit. Payrolls moderate to 75–100K.",
      Inflation: "Tightening is neutral-to-slightly disinflationary. PCE indicators do not materially change.",
      Credit: "Both spread indicators (level and momentum) deteriorate as refinancing risk increases broadly.",
      Liquidity: "NFCI indicator (l_nfci) falls ~0.9z. Yield curve (l_curve) flattens further. Both liquidity indicators hit.",
      Stress: "Equity markets sell off 8–12% as multiples compress. VIX elevates to mid-20s. Bond stress index rises.",
    },
  },
  rates_shock: {
    label: "Rates Shock",
    color: "#00695c",
    group: "stress",
    indicator_deltas: {
      g_nfp:      -0.30,
      g_ipman:    -0.25,
      g_gdp:      -0.30,
      g_serv:     -0.40,
      i_pce_dev:  -0.30,
      i_pce_mom:  -0.20,
      l_nfci:     -0.80,
      l_curve:    -1.20,
      c_ig_level: -0.50,
      c_ig_mom:   -0.55,
      s_vix:      -0.50,
      s_bond:     -0.50,
      s_spy_dd:   -0.70,
    },
    peak_month: 4,
    decay: "slow_fade",
    headline: "10Y yields surge 150bp. Mortgage rates spike to 8%+. P/E compresses.",
    narrative_body: "Long-end yields rise sharply — driven by fiscal concerns (term premium widening) or persistent inflation. Mortgage rates spike to 8%+. The yield curve un-inverts and steepens aggressively as long rates rise. The l_curve indicator (10Y-2Y) takes the primary hit in liquidity. Growth slows 2–3 months later as housing and capex retreat. Inflation indicators also worsen modestly, implying rate rise stems from inflation persistence.",
    pillar_detail: {
      Growth: "Housing starts collapse 20%+. Capex contracts as financing costs surge. Business investment freezes.",
      Inflation: "Rate surge implies inflation persistence — PCE deviation and momentum both worsen slightly.",
      Credit: "Higher risk-free rates widen spreads mechanically. Both spread indicators (level + momentum) deteriorate.",
      Liquidity: "Yield curve (l_curve) and NFCI (l_nfci) both move adversely. Liquidity pillar takes the biggest hit.",
      Stress: "Equity reprices for higher discount rates. P/E compression of 3–5× consistent with a 150bp rate shock.",
    },
  },
  equity_dd: {
    label: "Equity Drawdown",
    color: "#c62828",
    group: "stress",
    indicator_deltas: {
      g_nfp:       0,
      g_ipman:     0,
      g_gdp:       0,
      g_serv:      0,
      i_pce_dev:   0,
      i_pce_mom:   0,
      l_nfci:     -0.20,
      l_curve:    +0.20,
      c_ig_level: -0.70,
      c_ig_mom:   -0.80,
      s_vix:      -1.80,
      s_bond:     -0.80,
      s_spy_dd:   -1.80,
    },
    peak_month: 2,
    decay: "fast_fade",
    headline: "SPY falls 25% in 60 days. VIX spikes above 40. Fundamentals intact.",
    narrative_body: "A pure market stress event — equity volatility surges but macro fundamentals remain intact. VIX spikes to 40–50 and SPY drawdown reaches −25%. Growth and inflation indicators are completely unaffected because the real economy hasn't slowed. The stress pillar (VIX z-score, financial stress index, SPY drawdown) absorbs the full shock. The MRS holds above Slowdown because three of five pillars are untouched.",
    pillar_detail: {
      Growth: "Zero fundamental impact in the short term. All four growth indicators remain unchanged.",
      Inflation: "No inflation impact from a financial market shock without demand destruction.",
      Credit: "HY spreads widen 150–200bp. IG spreads widen 80–100bp. Both credit indicators deteriorate.",
      Liquidity: "Flight to quality suppresses long yields slightly (l_curve improves mildly). NFCI tightens moderately.",
      Stress: "The full shock concentrates in the stress pillar: VIX, financial stress index, and SPY drawdown all deteriorate sharply.",
    },
  },
  growth_slowdown: {
    label: "Growth Slowdown",
    color: "#1565c0",
    group: "stress",
    indicator_deltas: {
      g_nfp:      -1.00,
      g_ipman:    -0.80,
      g_gdp:      -0.90,
      g_serv:     -0.80,
      i_pce_dev:  +0.20,
      i_pce_mom:  +0.20,
      l_nfci:     +0.10,
      l_curve:    +0.30,
      c_ig_level: -0.25,
      c_ig_mom:   -0.30,
      s_vix:      -0.40,
      s_bond:     -0.30,
      s_spy_dd:   -0.50,
    },
    peak_month: 6,
    decay: "slow_fade",
    headline: "Payrolls miss 3 consecutive months. GDP decelerates toward 0%.",
    narrative_body: "A classic mid-cycle slowdown driven by labor market weakening. Payrolls average +50K (vs +150K trend). Industrial production contracts 2% YoY. GDP decelerates to 0–0.5%. No credit crisis — financial conditions remain roughly stable. Both PCE indicators marginally benefit as demand softens (mild disinflation). The composite moves into Slowdown by month 3–4, driven entirely by the four growth indicators.",
    pillar_detail: {
      Growth: "All four growth indicators weaken significantly. NFP and GDP take the largest hits. Growth becomes the sole dominant drag.",
      Inflation: "Demand softening is mildly disinflationary. Both PCE indicators improve modestly — a rare silver lining.",
      Credit: "Spreads widen slightly as earnings outlooks worsen, but no credit event occurs.",
      Liquidity: "Yield curve steepens mildly (l_curve improves) as rate cut pricing builds. NFCI improves slightly.",
      Stress: "Equity markets sell off 10–15%. VIX moves into the 25–35 range. SPY drawdown worsens.",
    },
  },
  inflation_shock: {
    label: "Inflation Shock",
    color: "#e65100",
    group: "stress",
    indicator_deltas: {
      g_nfp:      -0.20,
      g_ipman:    -0.15,
      g_gdp:      -0.20,
      g_serv:     -0.30,
      i_pce_dev:  -1.50,
      i_pce_mom:  -1.50,
      l_nfci:     -0.50,
      l_curve:    -0.80,
      c_ig_level: -0.30,
      c_ig_mom:   -0.35,
      s_vix:      -0.30,
      s_bond:     -0.30,
      s_spy_dd:   -0.40,
    },
    peak_month: 3,
    decay: "persist",
    headline: "Core PCE re-accelerates to 4%+. Fed resumes hiking. Stagflation risk.",
    narrative_body: (ctx) => `Core PCE accelerates from ${ctx.pceLevel ?? "its current level"} to 4%+ driven by services re-inflation or tariff pass-through. Both inflation indicators (PCE deviation from target and PCE momentum) take severe additional hits — the inflation pillar, already at ${signed(ctx.pillars.inflation)}z, becomes the dominant drag. The Fed responds with 75–100bp of hikes, re-inverting the yield curve. Growth slows with a lag as real income erodes. The composite is likely to enter Slowdown.`,
    pillar_detail: {
      Growth: "Real consumption slows as inflation outpaces wage growth. Services spending contracts. All growth indicators weaken.",
      Inflation: "Both PCE indicators deteriorate severely — this is the single largest driver of the scenario. PCE deviation and momentum both worsen.",
      Credit: "Spreads widen moderately as the growth outlook deteriorates and rate risk rises.",
      Liquidity: "Yield curve re-inverts (l_curve falls). NFCI tightens (l_nfci falls) as rate hike expectations reprice.",
      Stress: "Equity reprices for higher discount rates. VIX stays elevated. SPY drawdown worsens.",
    },
  },
  credit_stress: {
    label: "Credit / Liquidity Stress",
    color: "#7b1fa2",
    group: "stress",
    indicator_deltas: {
      g_nfp:      -0.25,
      g_ipman:    -0.20,
      g_gdp:      -0.20,
      g_serv:     -0.35,
      i_pce_dev:  +0.10,
      i_pce_mom:  +0.10,
      l_nfci:     -0.80,
      l_curve:    -0.30,
      c_ig_level: -1.40,
      c_ig_mom:   -1.40,
      s_vix:      -0.80,
      s_bond:     -0.80,
      s_spy_dd:   -0.90,
    },
    peak_month: 4,
    decay: "persist",
    headline: "Credit spreads blow out 150bp+. NFCI tightens. Lending dries up.",
    narrative_body: (ctx) => `Investment-grade spreads widen 150–200bp as risk appetite deteriorates. NFCI rises 0.8 standard deviations. The credit pillar — currently ${signed(ctx.pillars.credit)}z${ctx.supportPillar === "credit" ? ", the strongest pillar in the MRS (tight spreads)" : ""} — takes the primary hit as both spread indicators deteriorate sharply. Liquidity tightens simultaneously. Growth lags 2–3 months as tighter financial conditions pass through to investment and capex.`,
    pillar_detail: {
      Growth: "Initial growth resilience gives way as capex freezes and hiring slows with a 2–3 month lag.",
      Inflation: "Credit tightening is mildly disinflationary — both PCE indicators improve marginally.",
      Credit: "Both credit indicators (spread level and spread momentum) deteriorate sharply. This is the dominant driver of the scenario.",
      Liquidity: "NFCI (l_nfci) tightens ~0.8z. Yield curve (l_curve) flattens further.",
      Stress: "VIX rises to the low 30s. SPY drawdown increases to 10–15%. Bond stress index rises.",
    },
  },
  recession: {
    label: "Mild Recession",
    color: "#546e7a",
    group: "stress",
    indicator_deltas: {
      g_nfp:      -1.30,
      g_ipman:    -1.20,
      g_gdp:      -1.20,
      g_serv:     -1.00,
      i_pce_dev:  -0.20,
      i_pce_mom:  +0.10,
      l_nfci:     -0.50,
      l_curve:    -0.25,
      c_ig_level: -0.90,
      c_ig_mom:   -0.90,
      s_vix:      -1.00,
      s_bond:     -0.90,
      s_spy_dd:   -1.00,
    },
    peak_month: 5,
    decay: "persist",
    headline: "Broad multi-pillar deterioration. Payrolls turn negative 4–6 months.",
    narrative_body: "A generalized US recession where no single trigger dominates. Growth collapses as payrolls turn negative for 4–6 months. Credit markets tighten. Market stress rises significantly. All four growth indicators deteriorate simultaneously. The composite falls below −1.0z — the Contraction threshold — by month 5. Consistent with recession episodes outside the structural extremes of GFC and COVID.",
    pillar_detail: {
      Growth: "All four growth indicators deteriorate severely. Payrolls turn negative. IP contracts. GDP falls. Services spending weakens.",
      Inflation: "Growth collapse is mildly disinflationary — demand falls, but supply-side pressures limit disinflation.",
      Credit: "IG spreads widen 100–150bp. HY spreads widen 300–400bp. Both credit indicators deteriorate.",
      Liquidity: "NFCI tightens 0.5 SDs. Yield curve flattens initially as rate cut expectations build.",
      Stress: "VIX rises to 30–40 range. SPY drawdown of 20–25%. Bond stress index rises materially.",
    },
  },
};

// ─── Mutable state ────────────────────────────────────────────────────────────

let activeScenarioId = null;  // null = show 3 core lines only; non-null = add 4th stress overlay

// Custom builder uses pillar-level shocks for UX simplicity;
// internally these are distributed to each indicator in the pillar.
let CUSTOM_STATE = {
  pillar_deltas: { growth: -0.50, inflation: -0.30, liquidity: -0.40, credit: -0.60, stress: -0.50 },
  peak_month:    4,
  decay:         "persist",
};

let _currentZ             = null;   // today's indicator z-scores (last complete data row)
let _todayComposite       = null;
let _todayPillars         = null;
let _storeComposite       = null;   // monitoring-store composite (metadata) — the reference engine
let _confirmedRegime      = null;   // confirmed regime from the store (for stance projection)
let _dataThrough          = null;
let _historicalComposites = null;
let _baselinePath         = null;
let _optimisticPath       = null;
let _pessimisticPath      = null;
let _forecastInputs       = null;   // forecast_inputs.json
let _fcOffset             = 0;      // months the forecast vintage lags the data (arrays re-aligned)
let _indicatorsData       = null;   // full indicators_wide.json
let _analogues            = null;   // computed nearest historical setups
let _analogueDef          = null;   // active analogue replay definition (anchor/end/label)

// ─── Core MRS scoring ─────────────────────────────────────────────────────────
// Mirrors the production engine exactly:
// pillar_score = equal-weight mean of indicator z-scores within each pillar
// composite    = weighted average of pillar scores by PILLARS.weight
// display_score = composite + 3, clamped [1, 5]

function computePillarScores(zMap) {
  const sums = {}, counts = {};
  for (const [code, meta] of Object.entries(INDICATORS)) {
    const z = zMap[code];
    if (z == null || isNaN(z)) continue;
    sums[meta.pillar]   = (sums[meta.pillar]   || 0) + +z;
    counts[meta.pillar] = (counts[meta.pillar] || 0) + 1;
  }
  const scores = {};
  for (const id of Object.keys(PILLARS)) {
    scores[id] = counts[id] ? sums[id] / counts[id] : 0;
  }
  return scores;
}

function computeCompositeFromPillars(pillarScores) {
  let comp = 0, w = 0;
  for (const [id, meta] of Object.entries(PILLARS)) {
    if (pillarScores[id] == null) continue;
    comp += pillarScores[id] * meta.weight;
    w    += meta.weight;
  }
  return w > 0 ? comp / w : 0;
}

function scoreIndicators(zMap) {
  const pillars      = computePillarScores(zMap);
  const composite    = computeCompositeFromPillars(pillars);
  const display_score = clamp(composite + 3, 1, 5);
  return { pillars, composite, display_score };
}

function classifyRegime(z) {
  if (z >= 0.35)  return "Expansion";
  if (z >= -0.30) return "Neutral";
  if (z >= -1.00) return "Slowdown";
  return "Contraction";
}

// ─── Date arithmetic ──────────────────────────────────────────────────────────

function addMonths(dateStr, n) {
  const parts = dateStr.split("-").map(Number);
  let [y, m] = [parts[0], parts[1] - 1 + n];
  y += Math.floor(m / 12);
  m  = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

function monthDiff(a, b) {
  return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
}

function fmtMonth(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("default", { month: "short", year: "numeric", timeZone: "UTC" });
}

// ─── Phase factor ─────────────────────────────────────────────────────────────

function phaseFactor(t, peak_month, decay) {
  if (t <= 0)          return 0;
  if (t <= peak_month) return t / peak_month;
  const post = t - peak_month;
  if (decay === "persist")    return 1.0;
  if (decay === "fast_fade")  return Math.max(0, 1 - post / 4);
  return Math.max(0.5, 1 - post / 16); // slow_fade
}

// ─── Path builders ────────────────────────────────────────────────────────────
// All builders produce the same object shape per month:
// { t, date, z, pillars, composite, display_score }
// The key invariant: z → pillars → composite → display_score always flows
// through the MRS scoring engine, never a direct composite manipulation.

// Baseline: each indicator z-score decays via exponential mean-reversion to 0.
function buildBaselinePath(currentZ, dataThrough, months = 12) {
  const path = [];
  for (let t = 1; t <= months; t++) {
    const factor = Math.pow(1 - REVERSION, t);
    const z = {};
    for (const code of IND_CODES) {
      z[code] = currentZ[code] != null ? currentZ[code] * factor : null;
    }
    const scored = scoreIndicators(z);
    path.push({ t, date: addMonths(dataThrough, t), z, ...scored });
  }
  return path;
}

// Baseline from real forecast: uses baseline_z arrays from forecast_inputs.json.
// Falls back to exponential mean-reversion for any missing indicator.
// The forecast file carries its own data_through vintage; when the live data
// has since advanced, `_fcOffset` shifts the array index so the forecast for a
// given *calendar month* stays aligned (rather than silently sliding forward).
function buildBaselineFromForecast(forecastInputs, currentZ, dataThrough, months = 12) {
  return buildForecastPath(forecastInputs, "baseline_z", currentZ, dataThrough, months);
}

// Core forecast band (optimistic or pessimistic): uses per-indicator arrays from forecast_inputs.json.
// pathKey is "optimistic_z" or "pessimistic_z". Falls back to mean-reversion.
function buildCorePath(forecastInputs, pathKey, currentZ, dataThrough, months = 12) {
  return buildForecastPath(forecastInputs, pathKey, currentZ, dataThrough, months);
}

function buildForecastPath(forecastInputs, pathKey, currentZ, dataThrough, months = 12) {
  const path = [];
  for (let t = 1; t <= months; t++) {
    const z = {};
    for (const code of IND_CODES) {
      const fi = forecastInputs[code];
      const fv = fi?.[pathKey]?.[t - 1 + _fcOffset];
      z[code] = (fv != null && !isNaN(fv)) ? fv
              : (currentZ[code] != null ? currentZ[code] * Math.pow(1 - REVERSION, t) : null);
    }
    const scored = scoreIndicators(z);
    path.push({ t, date: addMonths(dataThrough, t), z, ...scored });
  }
  return path;
}

// Named macro scenario: baseline mean-reversion + phased indicator shock.
function buildMacroPath(def, currentZ, dataThrough, months = 12) {
  const { indicator_deltas, peak_month, decay } = def;
  const path = [];
  for (let t = 1; t <= months; t++) {
    const f      = phaseFactor(t, peak_month, decay);
    const factor = Math.pow(1 - REVERSION, t);
    const z = {};
    for (const code of IND_CODES) {
      const base  = currentZ[code] != null ? currentZ[code] * factor : null;
      const delta = indicator_deltas[code] || 0;
      z[code] = base != null ? clamp(base + delta * f, -3, 3) : null;
    }
    const scored = scoreIndicators(z);
    path.push({ t, date: addMonths(dataThrough, t), z, ...scored });
  }
  return path;
}

// Historical delta-replay: today_z + (actual_hist_z[t] − actual_hist_z[anchor]).
// Within the episode window: uses actual historical indicator deltas from data.
// After the episode ends: mean-reversion from the final projected z-score.
function buildHistoricalPath(def, currentZ, dataThrough, indicatorsData, months = 12) {
  const anchorRow = indicatorsData.find(r => r.date === def.anchor);
  if (!anchorRow) return null;

  const windowRows = indicatorsData.filter(r => r.date > def.anchor && r.date <= def.end);
  if (windowRows.length === 0) return null;
  const n = Math.min(windowRows.length, months); // episode length (≤ months)

  // Precompute the final projected z at the end of the episode (for post-episode fade)
  const finalEpZ = {};
  const lastHist = windowRows[n - 1];
  for (const code of IND_CODES) {
    const histZ = lastHist[`${code}_z`];
    const ancZ  = anchorRow[`${code}_z`];
    const todZ  = currentZ[code];
    if (histZ != null && ancZ != null && todZ != null) {
      finalEpZ[code] = clamp(todZ + (histZ - ancZ), -3, 3);
    } else {
      finalEpZ[code] = todZ ?? null;
    }
  }

  const path = [];
  for (let t = 1; t <= months; t++) {
    const z = {};
    if (t <= n) {
      // Within episode: apply actual historical indicator delta
      const histRow = windowRows[t - 1];
      for (const code of IND_CODES) {
        const histZ = histRow[`${code}_z`];
        const ancZ  = anchorRow[`${code}_z`];
        const todZ  = currentZ[code];
        if (histZ != null && ancZ != null && todZ != null) {
          z[code] = clamp(todZ + (histZ - ancZ), -3, 3);
        } else {
          z[code] = todZ ?? null;
        }
      }
    } else {
      // After episode: mean-reversion from the final projected z-score
      const postT  = t - n;
      const factor = Math.pow(1 - REVERSION, postT);
      for (const code of IND_CODES) {
        z[code] = finalEpZ[code] != null ? clamp(finalEpZ[code] * factor, -3, 3) : null;
      }
    }
    const scored = scoreIndicators(z);
    path.push({ t, date: addMonths(dataThrough, t), z, ...scored });
  }
  return path;
}

// Custom builder: pillar shocks → equal distribution across indicators in that pillar.
// This preserves the invariant: pillar_shock = mean-change in all indicator z-scores.
function buildCustomPath(currentZ, dataThrough) {
  const indicator_deltas = {};
  for (const [code, meta] of Object.entries(INDICATORS)) {
    indicator_deltas[code] = CUSTOM_STATE.pillar_deltas[meta.pillar] || 0;
  }
  return buildMacroPath(
    { indicator_deltas, peak_month: CUSTOM_STATE.peak_month, decay: CUSTOM_STATE.decay },
    currentZ, dataThrough,
  );
}

// Any scenario id that replays actual history (curated windows + analogue replays).
function histDefOf(scenId) {
  if (scenId === "analogue") return _analogueDef;
  return HIST_WINDOWS[scenId] || null;
}

function getScenarioPath(scenId) {
  if (scenId === "custom")          return buildCustomPath(_currentZ, _dataThrough);
  const histDef = histDefOf(scenId);
  if (histDef)                      return buildHistoricalPath(histDef, _currentZ, _dataThrough, _indicatorsData);
  const def = SCENARIO_DEFS[scenId];
  return def ? buildMacroPath(def, _currentZ, _dataThrough) : null;
}

// Peak month of the active scenario: worst composite for history-like paths,
// the defined peak month otherwise. Shared by narrative / pillar chart /
// indicator table / waterfall so "at peak" always means the same month.
function peakIndexOf(scenPath) {
  if (histDefOf(activeScenarioId)) {
    return scenPath.reduce((best, row, i) =>
      row.composite < scenPath[best].composite ? i : best, 0);
  }
  const peakT = activeScenarioId === "custom"
    ? CUSTOM_STATE.peak_month
    : (SCENARIO_DEFS[activeScenarioId]?.peak_month || 4);
  return Math.min(peakT, scenPath.length) - 1;
}

// ─── Selector ─────────────────────────────────────────────────────────────────

function renderSelector() {
  const groups = [
    { label: "Upside",                    ids: ["soft_landing"] },
    { label: "Macro stress",              ids: ["fin_tight", "rates_shock", "equity_dd", "growth_slowdown", "inflation_shock", "credit_stress", "recession"] },
    { label: "Historical delta-replay",   ids: ["gfc", "covid", "inflation22", "growth15", "stress11", "equity18"] },
    { label: "Build your own",            ids: ["custom"] },
  ];

  const chipDef = id => {
    if (id === "custom")             return { label: "Custom Builder", color: "#546e7a" };
    if (HIST_WINDOWS[id])            return HIST_WINDOWS[id];
    return SCENARIO_DEFS[id];
  };

  const html = groups.map(g => `
    <div class="sv2-group">
      <span class="sv2-group-label">${g.label}</span>
      <div class="sv2-chips">
        ${g.ids.map(id => {
          const d = chipDef(id);
          return `<button class="sv2-chip${id === activeScenarioId ? " active" : ""}" data-scen="${id}" style="--chip-color:${d.color}">${d.label}</button>`;
        }).join("")}
      </div>
    </div>`).join("");

  document.getElementById("sv2-selector").innerHTML = html;

  document.querySelectorAll(".sv2-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      _analogueDef = null; // a chip selection replaces any analogue replay
      if (activeScenarioId === btn.dataset.scen) {
        // Toggle off — return to 3-line-only view
        activeScenarioId = null;
        document.querySelectorAll(".sv2-chip").forEach(b => b.classList.remove("active"));
      } else {
        activeScenarioId = btn.dataset.scen;
        document.querySelectorAll(".sv2-chip").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      }
      updateAll();
    });
  });
}

// Definition of whatever is currently active, regardless of family.
function activeDef() {
  if (!activeScenarioId) return null;
  if (activeScenarioId === "custom") return { label: "Custom Builder", color: "#546e7a" };
  return histDefOf(activeScenarioId) || SCENARIO_DEFS[activeScenarioId] || null;
}

// Context handed to narrative templates so live readings are generated, not
// hardcoded: today's pillar scores, the biggest drag/support (by weighted
// contribution), and the latest core-PCE reading from the forecast inputs.
function narrativeCtx() {
  const contribs = Object.entries(PILLARS).map(([id, m]) => [id, (_todayPillars?.[id] ?? 0) * m.weight]);
  contribs.sort((a, b) => a[1] - b[1]);
  const pceRaw = (_forecastInputs?.indicators || _forecastInputs)?.i_pce_dev?.latest_actual_raw || "";
  const pceMatch = pceRaw.match(/([\d.]+\s?%)/);
  return {
    pillars: _todayPillars || {},
    comp: _todayComposite,
    regime: classifyRegime(_todayComposite),
    dragPillar: contribs[0]?.[0],
    supportPillar: contribs[contribs.length - 1]?.[0],
    pceLevel: pceMatch ? `${pceMatch[1].replace(" ", "")} core PCE` : null,
  };
}

const resolveText = (v, ctx) => (typeof v === "function" ? v(ctx) : (v || ""));

// ─── Forecast chart ───────────────────────────────────────────────────────────

function renderForecastChart(stressPath) {
  // The 3 permanent core lines come from real forecast data (forecast_inputs.json).
  const corePaths = [
    { label: "Baseline forecast", color: "#2e7d32", path: _baselinePath,   style: "solid", width: 2.5 },
    { label: "Optimistic",        color: "#66bb6a", path: _optimisticPath,  style: "dash",  width: 2.0 },
    { label: "Pessimistic",       color: "#ef5350", path: _pessimisticPath, style: "dash",  width: 2.0 },
  ];

  // Optional 4th overlay: the selected stress/historical/custom/analogue scenario.
  const scenarioPaths = [...corePaths];
  if (stressPath && activeScenarioId) {
    const def = activeDef();
    scenarioPaths.push({ label: def.label, color: def.color, path: stressPath, style: "dot", width: 2.0, markers: false });
  }

  scenarioForecastChart(
    "sv2-forecast-chart",
    _historicalComposites,
    {
      date:          _dataThrough,
      display_score: clamp(_todayComposite + 3, 1, 5),
      regime:        classifyRegime(_todayComposite),
    },
    null,           // no legacy dotted baseline; baseline is the first entry in scenarioPaths
    scenarioPaths,
  );
}

// ─── Narrative ────────────────────────────────────────────────────────────────

function renderNarrative(scenPath) {
  const isCustom = activeScenarioId === "custom";
  const isHist   = !!histDefOf(activeScenarioId);
  const def      = isCustom ? null : activeDef();
  const ctx      = narrativeCtx();

  document.getElementById("sv2-active-label").textContent =
    isCustom ? "Custom Builder" : (def?.label || "");

  if (isCustom) {
    document.getElementById("sv2-narrative").innerHTML = `
      <p class="sv2-headline">User-defined pillar shock scenario.</p>
      <p class="sv2-body">Adjust the pillar sliders in the Custom Builder section below.
      Each pillar's shock is distributed equally to all indicators within it, then flows
      through the MRS scoring engine. Positive = favorable, negative = adverse.</p>`;
    return;
  }

  const peakIdx = peakIndexOf(scenPath);
  const peakPt  = scenPath[peakIdx] || scenPath[scenPath.length - 1];
  const endPt   = scenPath[scenPath.length - 1];
  const peakZ   = peakPt?.composite ?? _todayComposite;
  const endZ    = endPt?.composite  ?? _todayComposite;
  const peakReg = classifyRegime(peakZ);
  const color   = REGIME_COLORS[peakReg] || "#888";
  const delta12 = endZ - _todayComposite;
  const deltaP  = peakZ - _todayComposite;

  const pillarRows = def?.pillar_detail
    ? Object.entries(def.pillar_detail).map(([k, v]) =>
        `<div class="sv2-pillar-line">
           <strong class="sv2-pillar-key">${k}</strong>
           <span class="sv2-pillar-text">${resolveText(v, ctx)}</span>
         </div>`).join("")
    : "";

  // For historical: show the top 3 indicator movers dynamically
  let moversHtml = "";
  if (isHist && peakPt?.z) {
    const moves = IND_CODES
      .filter(c => _currentZ[c] != null && peakPt.z[c] != null)
      .map(c => ({ code: c, delta: peakPt.z[c] - _currentZ[c], label: INDICATORS[c].label, pillar: INDICATORS[c].pillar }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 5);
    moversHtml = `
      <div class="sv2-movers">
        <div class="sv2-movers-head">Largest indicator moves at worst point (T+${peakIdx + 1})</div>
        ${moves.map(m => `
          <div class="sv2-mover-row">
            <span class="sv2-pillar-dot" style="background:${PILLARS[m.pillar].color}"></span>
            <span class="sv2-mover-label">${m.label}</span>
            <span class="sv2-mover-delta ${m.delta < 0 ? "tone-neg" : "tone-pos"}">${m.delta >= 0 ? "+" : ""}${m.delta.toFixed(2)}z</span>
          </div>`).join("")}
      </div>`;
  }

  document.getElementById("sv2-narrative").innerHTML = `
    <p class="sv2-headline">${def?.headline || ""}</p>
    <div class="sv2-result-row">
      <span class="sv2-comp-z">${signed(peakZ)}<span class="sv2-comp-unit">z</span></span>
      <span class="sv2-comp-disp">${clamp(peakZ + 3, 1, 5).toFixed(2)}/5</span>
      <span class="regime-badge" style="background:${color}">${peakReg}</span>
      <span class="sv2-peak-label">at ${isHist ? "worst · T+" + (peakIdx + 1) : "peak · T+" + (peakIdx + 1)}</span>
    </div>
    <div class="sv2-delta-row">
      <span class="sv2-delta-tag ${deltaP < 0 ? "tone-neg" : "tone-pos"}">${signed(deltaP)} vs today at peak</span>
      <span class="sv2-delta-tag ${delta12 < 0 ? "tone-neg" : "tone-pos"}">${signed(delta12)} vs today at T+12</span>
    </div>
    <p class="sv2-body">${resolveText(def?.narrative_body, ctx)}</p>
    ${moversHtml}
    ${pillarRows ? `<div class="sv2-pillar-detail">${pillarRows}</div>` : ""}`;
}

// ─── Pillar chart ─────────────────────────────────────────────────────────────

function renderPillarChart(scenPath) {
  const color   = activeDef()?.color || "#546e7a";
  const peakIdx = peakIndexOf(scenPath);

  // All pillar scores are computed via the indicator → pillar chain
  const baseline6Pillars = _baselinePath[5]?.pillars || _todayPillars;
  const scenPeakPillars  = scenPath[peakIdx]?.pillars || baseline6Pillars;

  scenarioPillarChart("sv2-pillar-chart", _todayPillars, baseline6Pillars, scenPeakPillars, color);
}

// ─── Indicator table ──────────────────────────────────────────────────────────
// Shows actual indicator z-scores from the scenario path — no estimation or
// approximation. The z-scores here are exactly what fed into the pillar/composite.

function renderIndicatorTable(scenPath) {
  const isHist  = !!histDefOf(activeScenarioId);
  const peakIdx = peakIndexOf(scenPath);
  const scenZ  = scenPath[peakIdx]?.z || {};
  const base6Z = _baselinePath[5]?.z || {};

  const PILLAR_ORDER = ["growth", "credit", "stress", "liquidity", "inflation"];
  const fmt  = v => v != null ? (+v).toFixed(2) : "—";
  const tone = v => v == null ? "" : v > 0.3 ? "tone-pos" : v < -0.3 ? "tone-neg" : "tone-neutral";
  const dtone = v => v == null ? "" : v < -0.10 ? "tone-neg" : v > 0.10 ? "tone-pos" : "tone-neutral";

  const rows = PILLAR_ORDER.flatMap(pid => {
    const indCodes = IND_CODES.filter(c => INDICATORS[c].pillar === pid);
    return indCodes.map(code => {
      const meta  = INDICATORS[code];
      const cur   = _currentZ[code];
      const bl    = base6Z[code];
      const scen  = scenZ[code];
      const delta = scen != null && cur != null ? scen - cur : null;
      return `<tr>
        <td class="sv2-ind-name">
          <span class="sv2-pillar-dot" style="background:${PILLARS[pid].color}"></span>
          <span class="sv2-ind-label">${meta.label}</span>
        </td>
        <td class="num ${tone(cur)}">${fmt(cur)}</td>
        <td class="num ${tone(bl)}">${fmt(bl)}</td>
        <td class="num ${tone(scen)}">${fmt(scen)}</td>
        <td class="num ${dtone(delta)}">${delta != null ? (delta >= 0 ? "+" : "") + delta.toFixed(2) : "—"}</td>
      </tr>`;
    });
  });

  document.getElementById("sv2-ind-tbody").innerHTML = rows.join("");

  const peakLabel = `T+${peakIdx + 1}${isHist ? " (worst)" : " (peak)"}`;
  const captEl = document.getElementById("sv2-table-caption");
  if (captEl) captEl.textContent = isHist
    ? `Scenario = today's z-scores + actual indicator deltas from ${histDefOf(activeScenarioId).label} episode at ${peakLabel}. Z-scores flow through pillar → composite scoring as normal.`
    : `Scenario = today's z-scores + indicator shock at ${peakLabel}. Values shown are the actual indicator z-scores that produced the pillar scores above and the composite path in the chart.`;
}

// ─── Decomposition waterfall: why the scenario differs from baseline ─────────

function renderWaterfall(scenPath) {
  const peakIdx = peakIndexOf(scenPath);
  const scenPt  = scenPath[peakIdx];
  const basePt  = _baselinePath[peakIdx];
  if (!scenPt || !basePt) return;

  const ORDER = ["growth", "credit", "stress", "liquidity", "inflation"];
  const items = ORDER.map(id => ({
    id,
    label: PILLARS[id].label,
    value: PILLARS[id].weight * ((scenPt.pillars[id] ?? 0) - (basePt.pillars[id] ?? 0)),
  })).sort((a, b) => a.value - b.value);

  scenarioGapWaterfall("sv2-waterfall", items, basePt.composite, scenPt.composite, {
    base: `Baseline T+${peakIdx + 1}`,
    scen: `${activeDef()?.label || "Scenario"} T+${peakIdx + 1}`,
  });

  const gap = scenPt.composite - basePt.composite;
  const ranked = [...items].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const top2 = ranked.slice(0, 2);
  const top2Share = gap !== 0 ? Math.min(999, Math.round((top2.reduce((s, r) => s + r.value, 0) / gap) * 100)) : 0;
  const el = document.getElementById("sv2-waterfall-read");
  if (el) el.innerHTML =
    `At the ${histDefOf(activeScenarioId) ? "worst point" : "peak"} (T+${peakIdx + 1}) the scenario sits ` +
    `<strong>${signed(gap)}z</strong> ${gap < 0 ? "below" : "above"} the baseline forecast. ` +
    `<strong>${top2[0].label}</strong> (${signed(top2[0].value, 3)}) and <strong>${top2[1].label}</strong> ` +
    `(${signed(top2[1].value, 3)}) explain ${top2Share}% of the gap — each bar = pillar weight × pillar-score gap, so the bars are exactly additive.`;
}

// ─── Indicator z-score paths: which indicators drive the path ─────────────────

function renderIndicatorPaths(scenPath) {
  const wrap = document.getElementById("sv2-ipaths");
  if (!wrap) return;

  const PILLAR_ORDER = ["growth", "credit", "stress", "liquidity", "inflation"];
  const endIdx = scenPath.length - 1;

  wrap.innerHTML = PILLAR_ORDER.flatMap(pid =>
    IND_CODES.filter(c => INDICATORS[c].pillar === pid).map(code => {
      const today = _currentZ[code];
      const ref   = [today, ..._baselinePath.map(p => p.z[code])];
      const main  = [today, ...scenPath.map(p => p.z[code])];
      const dEnd  = (scenPath[endIdx]?.z[code] != null && _baselinePath[endIdx]?.z[code] != null)
        ? scenPath[endIdx].z[code] - _baselinePath[endIdx].z[code] : null;
      const tone  = dEnd == null ? "tone-neutral" : dEnd < -0.1 ? "tone-neg" : dEnd > 0.1 ? "tone-pos" : "tone-neutral";
      return `<a class="ipath-cell" href="indicator.html?id=${code}" title="Open ${INDICATORS[code].label}">
        <div class="ipath-head">
          <span class="sv2-pillar-dot" style="background:${PILLARS[pid].color}"></span>
          <span class="ipath-label">${INDICATORS[code].label}</span>
          <span class="ipath-delta ${tone}">${dEnd != null ? signed(dEnd) : "–"}</span>
        </div>
        ${dualSparkline(ref, main, { color: PILLARS[pid].color, min: -3, max: 3 })}
      </a>`;
    })
  ).join("");
}

// ─── Portfolio stance projection ──────────────────────────────────────────────
// Maps the projected composite path to the portfolio's allocation stance using
// the same rules as the PC regime overlay: 2-month confirmation before a
// regime flips, and a 3-month Recovery pass-through on upgrades out of
// Slowdown/Contraction. Stance labels only — the weights live on the
// portfolio platform (one engine, one number).

const REGIME_TO_STANCE = { Expansion: "Growth", Neutral: "Neutral", Slowdown: "Defensive", Contraction: "Max Defensive" };
const REGIME_RANK = { Contraction: 0, Slowdown: 1, Neutral: 2, Expansion: 3 };

function projectStance(path, startConfirmed) {
  let confirmed = startConfirmed, pendRaw = null, pendCount = 0, recovery = 0;
  return path.map(pt => {
    const raw = classifyRegime(pt.composite);
    if (raw === confirmed) { pendRaw = null; pendCount = 0; }
    else if (raw === pendRaw) {
      pendCount += 1;
      if (pendCount >= 2) {
        const fromLow = REGIME_RANK[confirmed] <= 1;
        const isUpgrade = REGIME_RANK[raw] > REGIME_RANK[confirmed];
        if (fromLow && isUpgrade) recovery = 3;
        confirmed = raw; pendRaw = null; pendCount = 0;
      }
    } else { pendRaw = raw; pendCount = 1; }
    let stance = REGIME_TO_STANCE[confirmed];
    if (recovery > 0) { stance = "Recovery"; recovery -= 1; }
    return { t: pt.t, date: pt.date, raw, confirmed, stance };
  });
}

function renderStancePath(activePath) {
  const el = document.getElementById("sv2-stance");
  if (!el) return;

  const path  = activePath || _baselinePath;
  const label = activePath ? (activeDef()?.label || "scenario") : "baseline forecast";
  const seq   = projectStance(path, _confirmedRegime);

  const cells = seq.map(s => `
    <div class="stance-cell" style="--rc:${REGIME_COLORS[s.confirmed] || "#9e9e9e"}" title="${s.date} · raw ${s.raw} · confirmed ${s.confirmed} · stance ${s.stance}">
      <span class="stance-month">${fmtMonth(s.date).split(" ")[0]}</span>
      <span class="stance-regime">${s.confirmed.slice(0, 4)}</span>
      <span class="stance-name">${s.stance}</span>
    </div>`).join("");

  const firstChange = seq.find(s => s.confirmed !== _confirmedRegime);
  const stances = [...new Set(seq.map(s => s.stance))];
  const read = firstChange
    ? `Under the <strong>${label}</strong> path, the confirmed regime flips to <strong>${firstChange.confirmed}</strong> at ` +
      `${fmtMonth(firstChange.date)} (T+${firstChange.t}) after the 2-month confirmation rule — the allocation stance moves ` +
      `<strong>${REGIME_TO_STANCE[_confirmedRegime]} → ${firstChange.stance}</strong>` +
      (stances.includes("Recovery") ? ", with a 3-month Recovery pass-through on the way back up" : "") + "."
    : `Under the <strong>${label}</strong> path, the confirmed regime stays <strong>${_confirmedRegime}</strong> for all 12 months — no stance change; the 2-month confirmation rule filters the wobble.`;

  el.innerHTML = `
    <div class="stance-strip">${cells}</div>
    <p class="chart-caption" style="margin-top:0.45rem">${read}
      Stance mapping (PC regime overlay): Expansion → Growth · Neutral → Neutral · Slowdown → Defensive · Contraction → Max Defensive.
      Sleeve weights per stance live on the <a href="https://ankitv25.github.io/Asset-Allocation/" target="_blank" rel="noopener">portfolio platform ↗</a>.</p>`;
}

// ─── Historical analogue finder ───────────────────────────────────────────────

function renderAnalogues() {
  const el = document.getElementById("sv2-analogues");
  if (!el || !_analogues) return;

  el.innerHTML = _analogues.map((a, i) => {
    const outcome = a.fwd12 != null
      ? `Over the following 12 months the composite moved <strong>${signed(a.fwd12)}z</strong>` +
        (a.worst12 ? ` (worst point ${signed(a.worst12.composite)}z in ${fmtMonth(a.worst12.date)})` : "") +
        `, ending in <strong>${a.regime12}</strong>.`
      : "Less than 12 months of history followed this point.";
    const curated = a.episode ? `<p class="ana-episode">Falls inside <strong>${a.episode.name}</strong>: ${a.episode.note}</p>` : "";
    return `<div class="ana-card">
      <div class="ana-head">
        <span class="ana-rank">#${i + 1}</span>
        <strong>${fmtMonth(a.date)}</strong>
        <span class="regime-badge sm" style="background:${REGIME_COLORS[a.regime] || "#999"}">${a.regime}</span>
        <span class="ana-sim">${(a.sim * 100).toFixed(0)}% match</span>
        <span class="ep-meta">composite ${signed(a.composite)}z</span>
      </div>
      <p class="ana-outcome">${outcome}</p>
      ${curated}
      <button class="pg-btn pg-btn-secondary ana-replay" data-anchor="${a.date}" data-sim="${(a.sim * 100).toFixed(0)}">Replay the 12 months that followed →</button>
    </div>`;
  }).join("");

  el.querySelectorAll(".ana-replay").forEach(btn => {
    btn.addEventListener("click", () => {
      const anchor = btn.dataset.anchor;
      const a = _analogues.find(x => x.date === anchor);
      _analogueDef = {
        label: `Analogue replay · ${fmtMonth(anchor)}`,
        color: "#0ea5e9",
        anchor,
        end: addMonths(anchor, 12),
        headline: `The ${btn.dataset.sim}% match: what followed ${fmtMonth(anchor)}, replayed onto today's readings.`,
        narrative_body: `This path applies the actual month-by-month indicator changes that followed ${fmtMonth(anchor)} — the closest historical setup to today's 13-indicator vector (cosine similarity ${btn.dataset.sim}%) — on top of today's z-scores, rescored through the full MRS engine. Back then the composite moved ${signed(a?.fwd12 ?? 0)}z over the following year${a?.regime12 ? `, ending in ${a.regime12}` : ""}. A high match on levels does not guarantee the same dynamics — treat this as one evidence-grade prior, not a forecast.`,
      };
      activeScenarioId = "analogue";
      document.querySelectorAll(".sv2-chip").forEach(b => b.classList.remove("active"));
      updateAll();
      document.getElementById("sv2-forecast-chart")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCSV() {
  const scenPath = activeScenarioId ? getScenarioPath(activeScenarioId) : null;
  const stanceSeq = projectStance(scenPath || _baselinePath, _confirmedRegime);
  const ORDER = ["growth", "credit", "stress", "liquidity", "inflation"];

  const head = ["t", "date", "baseline_composite_z", "baseline_display", "optimistic_display", "pessimistic_display"];
  if (scenPath) head.push("scenario_composite_z", "scenario_display", "scenario_regime_raw", ...ORDER.map(p => `scenario_${p}_z`));
  head.push("projected_confirmed_regime", "projected_stance");

  const rows = _baselinePath.map((b, i) => {
    const row = [b.t, b.date, b.composite.toFixed(4), b.display_score.toFixed(3),
      _optimisticPath[i]?.display_score.toFixed(3) ?? "", _pessimisticPath[i]?.display_score.toFixed(3) ?? ""];
    if (scenPath) {
      const s = scenPath[i];
      row.push(s.composite.toFixed(4), s.display_score.toFixed(3), classifyRegime(s.composite),
        ...ORDER.map(p => (s.pillars[p] ?? 0).toFixed(4)));
    }
    row.push(stanceSeq[i]?.confirmed ?? "", stanceSeq[i]?.stance ?? "");
    return row.join(",");
  });

  const meta = `# MRS scenario export · generated ${new Date().toISOString().slice(0, 10)} · data through ${_dataThrough} · scenario: ${activeScenarioId ? (activeDef()?.label || activeScenarioId) : "none (core forecasts only)"}`;
  const csv = [meta, head.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mrs_scenario_${activeScenarioId || "core"}_${_dataThrough}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Engine reconciliation check ──────────────────────────────────────────────
// The scenario engine recomputes today's composite from indicator z-scores.
// That number must equal the monitoring store's composite — if it ever
// doesn't, the divergence is surfaced instead of silently shipping two
// engines' numbers (one engine, one number).

function renderEngineCheck() {
  const el = document.getElementById("sv2-engine-check");
  if (!el || _storeComposite == null) return;
  const diff = Math.abs(_todayComposite - _storeComposite);
  if (diff <= 0.01) {
    el.innerHTML = `<span class="engine-check ok" title="Scenario engine recompute matches the monitoring store">✓ engine check: recomputed ${signed(_todayComposite)}z = store ${signed(_storeComposite)}z</span>`;
  } else {
    el.innerHTML = `<span class="engine-check bad">⚠ engine mismatch: scenario engine ${signed(_todayComposite)}z vs monitoring store ${signed(_storeComposite)}z — investigate before trusting scenario paths</span>`;
  }
}

// ─── Custom builder ───────────────────────────────────────────────────────────

function renderCustomBuilder() {
  const PILLAR_ORDER_CUSTOM = ["growth", "inflation", "liquidity", "credit", "stress"];

  const sliderHTML = PILLAR_ORDER_CUSTOM.map(id => {
    const meta = PILLARS[id];
    const val  = CUSTOM_STATE.pillar_deltas[id] || 0;
    return `<div class="sv2-cust-row">
      <label class="sv2-cust-label" for="cust-p-${id}">
        <span class="sv2-pillar-dot" style="background:${meta.color}"></span>${meta.label}
      </label>
      <span class="sv2-cust-val" id="cust-val-${id}">${(+val).toFixed(2)}</span>
      <input class="sv2-cust-slider" type="range" id="cust-p-${id}"
        min="-3" max="3" step="0.05" value="${(+val).toFixed(2)}" data-pillar="${id}" />
      <span class="sv2-cust-hint" id="cust-hint-${id}">${val >= 0 ? "favorable" : "adverse"}</span>
    </div>`;
  }).join("");

  const timingHTML = `
    <div class="sv2-timing-block">
      <div class="sv2-timing-head">Months to peak</div>
      <div class="sv2-timing-row">
        <span class="sv2-timing-label">Peak month</span>
        <span class="sv2-cust-val" id="cust-val-peak">${CUSTOM_STATE.peak_month}</span>
      </div>
      <input class="sv2-cust-slider" type="range" id="cust-peak-month" min="1" max="12" step="1"
        value="${CUSTOM_STATE.peak_month}" style="width:100%;margin-bottom:1rem" />
      <div class="sv2-timing-head" style="margin-top:0.5rem">Post-peak behavior</div>
      <div class="sv2-decay-options">
        <label><input type="radio" name="cust-decay" value="persist"   ${CUSTOM_STATE.decay === "persist"   ? "checked" : ""}> Persist</label>
        <label><input type="radio" name="cust-decay" value="slow_fade" ${CUSTOM_STATE.decay === "slow_fade" ? "checked" : ""}> Slow fade (→50%)</label>
        <label><input type="radio" name="cust-decay" value="fast_fade" ${CUSTOM_STATE.decay === "fast_fade" ? "checked" : ""}> Fast fade (→0)</label>
      </div>
      <p class="sv2-cust-desc" style="margin-top:0.75rem;font-size:0.78rem">
        Each pillar shock is distributed equally across the pillar's indicators,
        then flows through the MRS scoring engine (indicator → pillar → composite).
      </p>
      <button class="pg-btn" id="sv2-cust-reset" style="margin-top:0.75rem">Reset to defaults</button>
    </div>`;

  document.getElementById("sv2-custom-sliders").innerHTML = sliderHTML;
  document.getElementById("sv2-custom-timing").innerHTML  = timingHTML;

  document.querySelectorAll(".sv2-cust-slider[data-pillar]").forEach(slider => {
    slider.addEventListener("input", () => {
      const id  = slider.dataset.pillar;
      const val = parseFloat(slider.value);
      CUSTOM_STATE.pillar_deltas[id] = val;
      const valEl  = document.getElementById(`cust-val-${id}`);
      const hintEl = document.getElementById(`cust-hint-${id}`);
      if (valEl)  valEl.textContent  = val.toFixed(2);
      if (hintEl) hintEl.textContent = val >= 0 ? "favorable" : "adverse";
      if (activeScenarioId === "custom") updateAll();
    });
  });

  document.getElementById("cust-peak-month").addEventListener("input", e => {
    CUSTOM_STATE.peak_month = parseInt(e.target.value);
    document.getElementById("cust-val-peak").textContent = CUSTOM_STATE.peak_month;
    if (activeScenarioId === "custom") updateAll();
  });

  document.querySelectorAll('input[name="cust-decay"]').forEach(radio => {
    radio.addEventListener("change", e => {
      CUSTOM_STATE.decay = e.target.value;
      if (activeScenarioId === "custom") updateAll();
    });
  });

  document.getElementById("sv2-cust-reset").addEventListener("click", () => {
    CUSTOM_STATE = {
      pillar_deltas: { growth: -0.50, inflation: -0.30, liquidity: -0.40, credit: -0.60, stress: -0.50 },
      peak_month: 4,
      decay: "persist",
    };
    renderCustomBuilder();
    if (activeScenarioId === "custom") updateAll();
  });
}

// ─── Master update ────────────────────────────────────────────────────────────

function updateAll() {
  // Stress path is optional — null when no scenario is selected (3-line-only view).
  const stressPath = activeScenarioId ? getScenarioPath(activeScenarioId) : null;

  renderForecastChart(stressPath);
  renderStancePath(stressPath && stressPath.length ? stressPath : null);

  const decompSection = document.getElementById("sv2-decomp-section");

  if (stressPath && stressPath.length > 0) {
    renderNarrative(stressPath);
    renderPillarChart(stressPath);
    renderIndicatorTable(stressPath);
    renderWaterfall(stressPath);
    renderIndicatorPaths(stressPath);
    if (decompSection) decompSection.style.display = "";
  } else {
    // Reset panels to placeholder state
    document.getElementById("sv2-active-label").textContent = "Select a scenario above";
    document.getElementById("sv2-narrative").innerHTML =
      `<p class="sv2-placeholder">Select a scenario chip above to overlay a stress path and see the macro thesis, pillar-level impact, and risk-asset implications.</p>`;
    document.getElementById("sv2-ind-tbody").innerHTML =
      `<tr><td colspan="5" class="sv2-placeholder" style="padding:1rem 0.55rem">Select a scenario to populate this table.</td></tr>`;
    const captEl = document.getElementById("sv2-table-caption");
    if (captEl) captEl.textContent = "";
    if (decompSection) decompSection.style.display = "none";
  }

  document.getElementById("sv2-custom-section").style.display =
    activeScenarioId === "custom" ? "" : "none";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [indicatorsWide, compositeHistory, metadata, forecastInputs] = await Promise.all([
    loadJSON("indicators_wide.json"),
    loadJSON("composite_history.json"),
    loadJSON("metadata.json"),
    loadJSON("forecast_inputs.json"),
  ]);

  _indicatorsData  = indicatorsWide;
  _forecastInputs  = forecastInputs;
  _dataThrough     = metadata.data_through;
  _storeComposite  = metadata.latest_composite_z != null ? +metadata.latest_composite_z : null;
  _confirmedRegime = metadata.latest_regime_confirmed || "Neutral";

  // Anchor strictly to the store's composite month. Market-lead rows after
  // data_through are missing the macro indicators — falling back to them would
  // score a partial vector and disagree with the monitoring store.
  const isComplete = r => IND_CODES.every(c => r[`${c}_z`] != null && !isNaN(+r[`${c}_z`]));
  const latestRow = indicatorsWide.find(r => r.date === _dataThrough)
    || indicatorsWide.slice().reverse().find(isComplete);

  // Extract current indicator z-scores
  _currentZ = {};
  for (const code of IND_CODES) {
    const v = latestRow?.[`${code}_z`];
    _currentZ[code] = (v != null && !isNaN(+v)) ? +v : null;
  }

  // Compute today's composite via the scoring engine, then reconcile it
  // against the monitoring store's number (renderEngineCheck surfaces both).
  _todayPillars   = computePillarScores(_currentZ);
  _todayComposite = computeCompositeFromPillars(_todayPillars);

  // Build the 3 core forecast paths from forecast_inputs.json indicator-level
  // arrays, re-aligned if the forecast vintage lags the live data.
  const fcInd = forecastInputs.indicators || forecastInputs;
  _fcOffset = forecastInputs.data_through
    ? Math.max(0, monthDiff(forecastInputs.data_through, _dataThrough)) : 0;
  _baselinePath    = buildBaselineFromForecast(fcInd, _currentZ, _dataThrough, 12);
  _optimisticPath  = buildCorePath(fcInd, "optimistic_z",  _currentZ, _dataThrough, 12);
  _pessimisticPath = buildCorePath(fcInd, "pessimistic_z", _currentZ, _dataThrough, 12);

  // Last 5 years of composite history for the main chart
  const cutoff = addMonths(_dataThrough, -60);
  _historicalComposites = compositeHistory.filter(r => r.date >= cutoff);

  // Nearest historical setups to today's full indicator vector
  _analogues = similarMonths(indicatorsWide, compositeHistory, _currentZ, { n: 3 });

  // Deep link: ?scen=<id> pre-selects a scenario chip (shareable stress views)
  const preset = new URLSearchParams(window.location.search).get("scen");
  if (preset && (SCENARIO_DEFS[preset] || HIST_WINDOWS[preset] || preset === "custom")) {
    activeScenarioId = preset;
  }

  renderSelector();
  renderCustomBuilder();
  renderEngineCheck();
  renderAnalogues();
  document.getElementById("sv2-export")?.addEventListener("click", exportCSV);
  const vintageEl = document.getElementById("sv2-forecast-vintage");
  if (vintageEl && forecastInputs.as_of) {
    vintageEl.textContent = `Forecast vintage ${forecastInputs.as_of}` +
      (_fcOffset > 0 ? ` · re-aligned +${_fcOffset} month${_fcOffset > 1 ? "s" : ""} to data through ${_dataThrough}` : "");
  }
  updateAll();

  const regime = metadata.latest_regime_confirmed;
  const el = document.getElementById("appbar-status");
  if (el) el.textContent = `MRS ${regime} · ${_dataThrough?.slice(0, 7)} · ${metadata.version}`;
  document.getElementById("status-footer").textContent =
    `MRS ${metadata.version} · data through ${_dataThrough} · generated ${metadata.generated_at}`;
}

main().catch(err => {
  const p = document.createElement("p");
  p.style.cssText = "color:#c62828;padding:1rem;font-weight:600";
  p.textContent   = `Scenario engine error: ${err.message}`;
  document.querySelector("main")?.prepend(p);
  console.error("[page-scenario]", err);
});
