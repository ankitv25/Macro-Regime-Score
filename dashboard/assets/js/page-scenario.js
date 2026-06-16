import { loadJSON } from "./data.js";
import { PILLARS, INDICATORS } from "./meta.js";
import { REGIME_COLORS } from "./regime.js";
import { signed } from "./narrative.js";
import { scenarioForecastChart, scenarioPillarChart } from "./charts.js";

// ─── Historical composite paths (composite z-score, monthly) ──────────────────
// GFC: Sep 2007 through Sep 2008 (13 months; index 0 = anchor)
const GFC_PATH = [-0.317, -0.139, -0.632, -0.866, -0.826, -0.885, -1.143, -0.954, -0.617, -0.727, -0.977, -1.091, -1.285];
// COVID: Jan 2020 through Dec 2020 (12 months; index 0 = anchor)
const COVID_PATH = [0.191, -0.009, -1.512, -1.650, -1.382, -1.149, -0.336, 0.106, 0.099, -0.001, -0.134, -0.123];

// ─── Scenario definitions ──────────────────────────────────────────────────────
// pillar_deltas: additive shock to pillar SCORE at peak (+ = favorable, − = adverse)
// peak_month: month when shock reaches full magnitude (1-indexed from T+0)
// decay: "persist" | "slow_fade" (→0.5) | "fast_fade" (→0 in 4 months)

const SCENARIO_DEFS = {
  soft_landing: {
    label: "Soft Landing",
    color: "#2e7d32",
    group: "upside",
    type: "macro",
    pillar_deltas: { growth: +0.30, inflation: +0.85, liquidity: +0.45, credit: +0.50, stress: +0.40 },
    peak_month: 6,
    decay: "persist",
    headline: "Inflation returns to 2%. Fed cuts 3×. All pillars improve simultaneously.",
    narrative_body: "The MRS's most optimistic credible scenario. Core PCE decelerates toward 2% while GDP holds at 2%+. The Fed cuts rates 75bp over the year. The yield curve normalizes. Credit spreads tighten. The composite, currently at Neutral (+0.03z), moves cleanly into Expansion. The inflation pillar — the primary drag at −0.87z — is the biggest beneficiary.",
    pillar_detail: {
      Growth: "Payrolls re-accelerate to 175–200K/month. GDP grows 2.2–2.5%. Growth moves from near-zero to +0.3z.",
      Inflation: "Core PCE decelerates from ~2.9% to 2.1–2.3%. Inflation pillar rises from −0.87z toward 0 — the single largest driver of MRS improvement.",
      Credit: "Spreads tighten 30–50bp as the economic outlook clears. Credit builds on its current positive reading.",
      Liquidity: "Fed cuts normalize the yield curve. NFCI eases. Liquidity improves from −0.15z to +0.3z.",
      Stress: "VIX normalizes below 15. SPY makes new highs. Stress pillar (already positive) further firms.",
      "Risk assets": "Soft landings historically produce the strongest forward equity returns — SPY +20–30% in the 12 months after confirmed signals.",
    },
  },
  fin_tight: {
    label: "Fin. Conditions Tightening",
    color: "#6d4c41",
    group: "stress",
    type: "macro",
    pillar_deltas: { growth: -0.30, inflation: 0, liquidity: -1.00, credit: -0.55, stress: -0.40 },
    peak_month: 5,
    decay: "persist",
    headline: "NFCI tightens 0.8–1.0 SDs. Dollar strengthens. Lending standards rise broadly.",
    narrative_body: "A gradual, broad tightening of financial conditions without an acute crisis trigger. NFCI rises 0.8–1.0 standard deviations — comparable to the 2022 tightening episode. The liquidity and credit pillars deteriorate over a 5-month window. Growth slows with a lag but stays positive. The composite likely moves from Neutral to Slowdown.",
    pillar_detail: {
      Growth: "Slows as tighter conditions reduce business investment and consumer credit. Payrolls moderate to 75–100K.",
      Inflation: "Tightening is neutral to slightly disinflationary — no change modeled for this pillar.",
      Credit: "Spreads widen 50–80bp as refinancing risk increases and lending standards tighten broadly.",
      Liquidity: "NFCI rises 0.8–1.0 SDs. Liquidity pillar falls from −0.15z to approximately −1.1z.",
      Stress: "Equity markets sell off 8–12% as valuation multiples compress. VIX elevates to mid-20s.",
      "Risk assets": "Conditions tightening weighs on MOIC for 6–12 months before policy easing eventually provides relief.",
    },
  },
  rates_shock: {
    label: "Rates Shock",
    color: "#00695c",
    group: "stress",
    type: "macro",
    pillar_deltas: { growth: -0.40, inflation: -0.30, liquidity: -1.30, credit: -0.45, stress: -0.50 },
    peak_month: 4,
    decay: "slow_fade",
    headline: "10Y yields surge 150bp. Mortgage rates spike. Equity P/E compresses.",
    narrative_body: "Long-end yields rise sharply — driven by fiscal concerns (term premium widening) or stubborn inflation. Mortgage rates re-hit 8%+. Housing starts collapse. The yield curve un-inverts and steepens aggressively. The liquidity pillar bears the primary hit; growth slows 2–3 months later as housing and capex retreat.",
    pillar_detail: {
      Growth: "Housing starts collapse 20%+. Capex contracts. Business investment freezes as financing costs surge.",
      Inflation: "Rate surge implies inflation persistence — marginally worsens the already-negative inflation pillar.",
      Credit: "Higher risk-free rates widen spreads mechanically. Corporate refinancing risk rises for near-term maturities.",
      Liquidity: "Yield curve (l_curve) and NFCI (l_nfci) both move adversely. Liquidity falls from −0.15z to below −1.4z.",
      Stress: "Equity reprices for higher discount rates. P/E compression of 3–5× consistent with a 150bp rate shock.",
      "Risk assets": "Rate shocks without recession historically produce 15–20% equity corrections then stabilize as growth holds.",
    },
  },
  equity_dd: {
    label: "Equity Drawdown",
    color: "#c62828",
    group: "stress",
    type: "macro",
    pillar_deltas: { growth: 0, inflation: 0, liquidity: +0.10, credit: -0.60, stress: -1.80 },
    peak_month: 2,
    decay: "fast_fade",
    headline: "SPY falls 25% in 60 days. VIX spikes above 40. Fundamentals hold intact.",
    narrative_body: "A pure market stress event — equity volatility surges but macro fundamentals remain intact. VIX spikes to 40–50, SPY drawdown reaches −25%. Growth and inflation pillars are unaffected because the real economy has not yet slowed. The stress pillar absorbs the full shock; the MRS holds above Slowdown as fundamentals anchor the composite.",
    pillar_detail: {
      Growth: "No fundamental growth impact in the short term. Wealth effect hits consumer spending with a 6-month lag.",
      Inflation: "No inflation impact from a financial market shock without demand destruction.",
      Credit: "HY spreads widen 150–200bp. IG spreads widen 80–100bp — meaningful but not crisis-level.",
      Liquidity: "Flight to quality suppresses 10Y yields slightly — mildly steepens the yield curve.",
      Stress: "The stress pillar takes the full brunt. VIX at 40+ pushes s_vix_z to −2.0 or below. Fast self-healing as volatility normalizes.",
      "Risk assets": "Pure market stress without fundamental deterioration historically resolves within 3–6 months when policy provides backstop.",
    },
  },
  growth_slowdown: {
    label: "Growth Slowdown",
    color: "#1565c0",
    group: "stress",
    type: "macro",
    pillar_deltas: { growth: -1.30, inflation: +0.20, liquidity: +0.10, credit: -0.20, stress: -0.30 },
    peak_month: 6,
    decay: "slow_fade",
    headline: "Labor market softens. Payrolls miss 3 consecutive months. GDP decelerates toward 0%.",
    narrative_body: "A classic mid-cycle slowdown driven by labor market weakening. Payrolls average +50K (vs +150K trend). Industrial production contracts 2% YoY. GDP decelerates to 0–0.5%. No credit crisis — financial conditions remain roughly stable. The inflation pillar marginally benefits as demand softens. The composite moves into Slowdown by month 3–4.",
    pillar_detail: {
      Growth: "The growth pillar falls from near-neutral to approximately −1.2z. Payrolls, IP, and real GDP all soften simultaneously.",
      Inflation: "Demand softening is mildly disinflationary — core PCE moves toward 2.5%, slightly improving the inflation pillar.",
      Credit: "Spreads widen slightly as earnings outlooks worsen, but no credit event occurs.",
      Liquidity: "Yield curve steepens mildly as rate cut pricing builds and growth expectations fall.",
      Stress: "Equity markets sell off 10–15%. VIX moves into the 25–35 range.",
      "Risk assets": "Growth slowdowns precede policy pivots — historically the 6–12 month post-slowdown period sees 15–25% equity returns as the Fed responds.",
    },
  },
  inflation_shock: {
    label: "Inflation Shock",
    color: "#e65100",
    group: "stress",
    type: "macro",
    pillar_deltas: { growth: -0.20, inflation: -1.50, liquidity: -0.50, credit: -0.30, stress: -0.25 },
    peak_month: 3,
    decay: "persist",
    headline: "Core PCE re-accelerates to 4%+. Fed resumes hiking. Stagflation risk rises.",
    narrative_body: "Core PCE accelerates from ~2.9% to 4%+ driven by services re-inflation or tariff pass-through. The MRS inflation pillar — already negative at −0.87z — takes a severe additional hit. The Fed responds with 75–100bp of hikes over 2–3 meetings. Real income erodes, financial conditions tighten, and growth slows with a lag. The composite is likely to enter Slowdown.",
    pillar_detail: {
      Growth: "Real consumption slows as inflation outpaces wage growth. Services spending (already soft) contracts.",
      Inflation: "The inflation pillar falls to below −2.0z — the most stressed reading since 2022. Both PCE deviation and momentum indicators worsen sharply.",
      Credit: "Credit spreads widen moderately as the growth outlook deteriorates and rate risk rises.",
      Liquidity: "Yield curve re-inverts. NFCI tightens as rate hike expectations reprice terminal rate higher.",
      Stress: "Equity markets reprice for higher discount rates. VIX stays elevated but below crisis levels.",
      "Risk assets": "Stagflation historically produces negative real returns across both equities and bonds — the worst allocation environment.",
    },
  },
  credit_stress: {
    label: "Credit / Liquidity Stress",
    color: "#7b1fa2",
    group: "stress",
    type: "macro",
    pillar_deltas: { growth: -0.30, inflation: +0.10, liquidity: -0.70, credit: -1.40, stress: -0.75 },
    peak_month: 4,
    decay: "persist",
    headline: "Credit spreads blow out 150bp+. NFCI tightens materially. Lending dries up.",
    narrative_body: "Investment-grade spreads widen 150–200bp as risk appetite deteriorates. NFCI rises 0.6–0.8 standard deviations. The credit pillar — currently the strongest in the MRS at +0.48z — and the liquidity pillar absorb the first shock. Growth lags 2–3 months as tighter financial conditions pass through to investment and capex. The composite is likely to fall into Slowdown or Contraction.",
    pillar_detail: {
      Growth: "Initial growth resilience gives way as capex freezes and hiring slows with a 2–3 month lag.",
      Inflation: "Credit tightening is mildly disinflationary — marginally favorable for the inflation pillar.",
      Credit: "The credit pillar falls from +0.48z to below −1.0z. This is the primary driver of the scenario shock.",
      Liquidity: "NFCI tightens ~0.7z. Yield curve flattens as flight-to-quality compresses 10Y yields.",
      Stress: "VIX rises to the low 30s. SPY drawdown increases to 10–15%. Financial stress index rises.",
      "Risk assets": "Credit stress historically gives equity markets 6–9 months of deteriorating MOIC before policy response arrives.",
    },
  },
  custom_recession: {
    label: "Custom Recession",
    color: "#546e7a",
    group: "stress",
    type: "macro",
    pillar_deltas: { growth: -1.50, inflation: -0.20, liquidity: -0.50, credit: -0.85, stress: -1.00 },
    peak_month: 5,
    decay: "persist",
    headline: "Broad multi-pillar shock — all five pillars deteriorate simultaneously.",
    narrative_body: "A generalized US recession where no single trigger dominates. Growth collapses as payrolls turn negative for 4–6 months. Credit markets tighten. Market stress rises significantly. The composite falls below −1.0z — the Contraction threshold — by month 5. Consistent with recession episodes outside the GFC and COVID structural extremes.",
    pillar_detail: {
      Growth: "Payrolls turn negative for 4–6 consecutive months. IP falls 8–10% YoY. GDP contracts 2% peak-to-trough.",
      Inflation: "Growth collapse is mildly disinflationary — demand falls, but supply-side pressures may limit disinflation.",
      Credit: "IG spreads widen 100–150bp. HY spreads widen 300–400bp. Leveraged loan markets seize up.",
      Liquidity: "NFCI tightens 0.5–0.7 SDs. Yield curve flattens initially as rate cut expectations build.",
      Stress: "VIX rises to 30–40 range. SPY drawdown of 20–25%. Financial stress index rises materially.",
      "Risk assets": "In typical recessions (ex-GFC/COVID), equity markets fall 25–35% from pre-recession peaks before bottoming with a Fed pivot.",
    },
  },
  covid: {
    label: "COVID 2020",
    color: "#880e4f",
    group: "historical",
    type: "historical",
    hist_path: COVID_PATH,
    hist_date: "2020-03-31",
    headline: "The fastest recession in history — and the fastest recovery.",
    narrative_body: "COVID's MRS impact was violent but brief. The composite fell from near Neutral to deep Contraction in just 2 months, then recovered within 6. The delta-replay shows the current reading would hit Contraction by month 2, bottoming around −1.6z, before a sharp recovery driven by unprecedented fiscal and monetary support.",
    pillar_detail: {
      Growth: "GDP fell 29% annualized in Q2 2020. Payrolls lost 22M jobs in 2 months — the sharpest labor market collapse in recorded history.",
      Inflation: "Initial deflation scare followed by supply-chain inflation that persisted through 2022.",
      Credit: "HY spreads hit 1100bp briefly. IG spreads peaked at 373bp before the Fed's corporate bond backstop.",
      Liquidity: "Fed expanded the balance sheet by $3 trillion in 3 months. Zero rates re-imposed immediately.",
      Stress: "VIX hit 66. SPY fell −34% in 23 trading days — the fastest 30%+ drawdown in history.",
      "Risk assets": "Markets bottomed March 23, 2020 — before the worst jobs data had even printed. The subsequent rally was +65% in 12 months.",
    },
  },
  gfc: {
    label: "GFC 2008",
    color: "#4a148c",
    group: "historical",
    type: "historical",
    hist_path: GFC_PATH,
    hist_date: "2008-12-31",
    headline: "Credit markets froze, equity fell −57%, Fed cut to near-zero.",
    narrative_body: "The 2008–09 GFC was the most severe US recession since the Depression. The MRS reached deep Contraction by December 2008. The delta-replay shows that if the current macro environment followed the same trajectory, the composite would fall from Neutral into Contraction within 3–4 months, reaching approximately −0.9z at 12 months.",
    pillar_detail: {
      Growth: "Payrolls collapsed by 800K/month at the nadir. IP fell 15% YoY. GDP contracted 4.3% peak-to-trough.",
      Inflation: "Core PCE briefly rose then fell as demand collapsed. Deflationary risk emerged by 2009.",
      Credit: "IG spreads exceeded 500bp. Funding markets froze. The CP market seized in September 2008.",
      Liquidity: "NFCI surged to +2 (historic extreme). Yield curve normalized only via emergency Fed cuts to zero.",
      Stress: "VIX peaked at 80. SPY fell −57%. The financial stress index hit records not seen since 1987.",
      "Risk assets": "Equities took 17 months to bottom after the first MRS regime signal in March 2008. Peak drawdown: −57%.",
    },
  },
};

// ─── Mutable state ─────────────────────────────────────────────────────────────
let activeScenarioId = "soft_landing";

let CUSTOM_STATE = {
  pillar_deltas: { growth: -0.50, inflation: -0.30, liquidity: -0.40, credit: -0.60, stress: -0.50 },
  peak_month: 4,
  decay: "persist",
};

let _currentIndicatorZ   = null;
let _currentPillarScores = null;
let _todayComposite      = null;
let _dataThrough         = null;
let _historicalComposites = null;
let _baselinePath        = null;
let _indicatorsWide      = null;

// ─── Computation helpers ───────────────────────────────────────────────────────
function classifyRegime(z) {
  if (z >= 0.35)  return "Expansion";
  if (z >= -0.30) return "Neutral";
  if (z >= -1.00) return "Slowdown";
  return "Contraction";
}

function computePillarScores(indicatorZ) {
  const sums = {}, counts = {};
  for (const [code, meta] of Object.entries(INDICATORS)) {
    const z = indicatorZ[code];
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

function extractIndicatorZ(row) {
  const out = {};
  for (const code of Object.keys(INDICATORS)) {
    const v = row[`${code}_z`];
    out[code] = (v != null && !isNaN(+v)) ? +v : null;
  }
  return out;
}

function addMonths(dateStr, n) {
  const parts = dateStr.split("-").map(Number);
  let [y, m] = [parts[0], parts[1] - 1 + n];
  y += Math.floor(m / 12);
  m  = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

// Phase factor: builds 0→1 over peak_month, then decays per decay type
function phaseFactor(t, peak_month, decay) {
  if (t <= 0) return 0;
  if (t <= peak_month) return t / peak_month;
  const post = t - peak_month;
  if (decay === "persist")   return 1.0;
  if (decay === "fast_fade") return Math.max(0, 1 - post / 4);
  return Math.max(0.5, 1 - post / 16); // slow_fade
}

// ─── Path builders ──────────────────────────────────────────────────────────────
function buildBaselinePath(currentPillarScores, dataThrough, months = 12) {
  const REVERSION = 0.08;
  let pillars = { ...currentPillarScores };
  const path = [];
  for (let t = 1; t <= months; t++) {
    const next = {};
    for (const id of Object.keys(PILLARS)) next[id] = (pillars[id] || 0) * (1 - REVERSION);
    pillars = next;
    const composite = computeCompositeFromPillars(pillars);
    path.push({
      t,
      date: addMonths(dataThrough, t),
      pillars: { ...pillars },
      composite,
      display_score: Math.min(5, Math.max(1, composite + 3)),
    });
  }
  return path;
}

function buildMacroScenarioPath(scenId, baselinePath) {
  const def = scenId === "custom" ? CUSTOM_STATE : SCENARIO_DEFS[scenId];
  const { pillar_deltas, peak_month, decay } = def;
  return baselinePath.map(({ t, date, pillars: basePillars }) => {
    const f = phaseFactor(t, peak_month, decay);
    const sp = {};
    for (const id of Object.keys(PILLARS)) {
      sp[id] = (basePillars[id] || 0) + (pillar_deltas[id] || 0) * f;
    }
    const composite = computeCompositeFromPillars(sp);
    return {
      t, date, pillars: sp, composite,
      display_score: Math.min(5, Math.max(1, composite + 3)),
      regime: classifyRegime(composite),
    };
  });
}

function buildHistoricalReplayPath(histPath, todayComposite, dataThrough) {
  const anchor = histPath[0];
  return histPath.slice(1).map((comp, i) => {
    const composite = todayComposite + (comp - anchor);
    return {
      t: i + 1,
      date: addMonths(dataThrough, i + 1),
      composite,
      display_score: Math.min(5, Math.max(1, composite + 3)),
      regime: classifyRegime(composite),
    };
  });
}

function getScenarioPath(scenId) {
  if (scenId === "custom") return buildMacroScenarioPath("custom", _baselinePath);
  const def = SCENARIO_DEFS[scenId];
  if (!def) return null;
  if (def.type === "historical") {
    return buildHistoricalReplayPath(def.hist_path, _todayComposite, _dataThrough);
  }
  return buildMacroScenarioPath(scenId, _baselinePath);
}

// ─── Indicator-level helpers ───────────────────────────────────────────────────
function indicatorBaselineZ(currentZ, t) {
  const factor = Math.pow(1 - 0.08, t);
  const out = {};
  for (const code of Object.keys(INDICATORS)) {
    out[code] = currentZ[code] != null ? currentZ[code] * factor : null;
  }
  return out;
}

function indicatorScenarioZ(baselineZ, pillarDeltas) {
  const counts = {};
  for (const [, meta] of Object.entries(INDICATORS)) {
    counts[meta.pillar] = (counts[meta.pillar] || 0) + 1;
  }
  const out = {};
  for (const [code, meta] of Object.entries(INDICATORS)) {
    const base = baselineZ[code];
    if (base == null) { out[code] = null; continue; }
    out[code] = base + (pillarDeltas[meta.pillar] || 0) / counts[meta.pillar];
  }
  return out;
}

// ─── Selector ──────────────────────────────────────────────────────────────────
function renderSelector() {
  const groups = [
    { label: "Upside",                    ids: ["soft_landing"] },
    { label: "Macro stress",              ids: ["fin_tight", "rates_shock", "equity_dd", "growth_slowdown", "inflation_shock", "credit_stress", "custom_recession"] },
    { label: "Historical (delta-replay)", ids: ["covid", "gfc"] },
    { label: "Build your own",            ids: ["custom"] },
  ];

  const getChipDef = id => id === "custom"
    ? { label: "Custom Builder", color: "#546e7a" }
    : SCENARIO_DEFS[id];

  const html = groups.map(g => `
    <div class="sv2-group">
      <span class="sv2-group-label">${g.label}</span>
      <div class="sv2-chips">
        ${g.ids.map(id => {
          const d = getChipDef(id);
          return `<button class="sv2-chip${id === activeScenarioId ? " active" : ""}" data-scen="${id}" style="--chip-color:${d.color}">${d.label}</button>`;
        }).join("")}
      </div>
    </div>`).join("");

  document.getElementById("sv2-selector").innerHTML = html;
  document.querySelectorAll(".sv2-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      activeScenarioId = btn.dataset.scen;
      document.querySelectorAll(".sv2-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      updateAll();
    });
  });
}

// ─── Forecast chart ────────────────────────────────────────────────────────────
function renderForecastChart(scenPath) {
  const isCustom = activeScenarioId === "custom";
  const def = isCustom ? { label: "Custom", color: "#546e7a" } : SCENARIO_DEFS[activeScenarioId];
  scenarioForecastChart(
    "sv2-forecast-chart",
    _historicalComposites,
    { date: _dataThrough, display_score: Math.min(5, Math.max(1, _todayComposite + 3)), regime: classifyRegime(_todayComposite) },
    _baselinePath,
    [{ label: def.label, color: def.color, path: scenPath }],
  );
}

// ─── Narrative ─────────────────────────────────────────────────────────────────
function renderNarrative(scenPath) {
  const isCustom = activeScenarioId === "custom";
  const def = isCustom ? null : SCENARIO_DEFS[activeScenarioId];

  document.getElementById("sv2-active-label").textContent =
    isCustom ? "Custom Builder" : (def?.label || "");

  if (isCustom) {
    document.getElementById("sv2-narrative").innerHTML = `
      <p class="sv2-headline">User-defined stress scenario.</p>
      <p class="sv2-body">Adjust the pillar sliders in the Custom Builder section below.
      The chart and indicator table update live. Positive = favorable, negative = adverse.</p>`;
    return;
  }

  const peakT    = def.type === "historical" ? (def.hist_path.length - 2) : (def.peak_month || 4);
  const peakIdx  = Math.min(peakT, scenPath.length) - 1;
  const peakPt   = scenPath[peakIdx] || scenPath[scenPath.length - 1];
  const endPt    = scenPath[scenPath.length - 1];
  const peakZ    = peakPt?.composite ?? _todayComposite;
  const endZ     = endPt?.composite  ?? _todayComposite;
  const peakReg  = classifyRegime(peakZ);
  const color    = REGIME_COLORS[peakReg] || "#888";
  const delta12  = endZ - _todayComposite;

  const pillarRows = def.pillar_detail
    ? Object.entries(def.pillar_detail).map(([k, v]) =>
        `<div class="sv2-pillar-line"><strong class="sv2-pillar-key">${k}</strong><span class="sv2-pillar-text">${v}</span></div>`
      ).join("")
    : "";

  document.getElementById("sv2-narrative").innerHTML = `
    <p class="sv2-headline">${def.headline || ""}</p>
    <div class="sv2-result-row">
      <span class="sv2-comp-z">${signed(peakZ)}<span class="sv2-comp-unit">z</span></span>
      <span class="sv2-comp-disp">${Math.min(5, Math.max(1, peakZ + 3)).toFixed(2)}/5</span>
      <span class="regime-badge" style="background:${color}">${peakReg}</span>
      <span class="sv2-peak-label">at peak · T+${peakIdx + 1}</span>
    </div>
    <span class="sv2-delta-tag ${delta12 < 0 ? "tone-neg" : "tone-pos"}">${signed(delta12)} vs today at T+12</span>
    <p class="sv2-body">${def.narrative_body || ""}</p>
    ${pillarRows ? `<div class="sv2-pillar-detail">${pillarRows}</div>` : ""}`;
}

// ─── Pillar chart ───────────────────────────────────────────────────────────────
function renderPillarChart(scenPath) {
  const isCustom = activeScenarioId === "custom";
  const def      = isCustom ? null : SCENARIO_DEFS[activeScenarioId];
  const color    = isCustom ? "#546e7a" : (def?.color || "#546e7a");

  const pillarsBaseline6 = _baselinePath[5]?.pillars || _currentPillarScores;

  let pillarsScenario;
  if (def?.type === "historical") {
    const histRow = _indicatorsWide.find(r => r.date === def.hist_date);
    pillarsScenario = histRow ? computePillarScores(extractIndicatorZ(histRow)) : pillarsBaseline6;
  } else {
    const peakT   = (isCustom ? CUSTOM_STATE.peak_month : def?.peak_month) || 4;
    const peakIdx = Math.min(peakT, scenPath.length) - 1;
    pillarsScenario = scenPath[peakIdx]?.pillars || pillarsBaseline6;
  }

  scenarioPillarChart("sv2-pillar-chart", _currentPillarScores, pillarsBaseline6, pillarsScenario, color);
}

// ─── Indicator table ────────────────────────────────────────────────────────────
function renderIndicatorTable() {
  const isCustom = activeScenarioId === "custom";
  const def      = isCustom ? null : SCENARIO_DEFS[activeScenarioId];

  const baseline6Z = indicatorBaselineZ(_currentIndicatorZ, 6);

  let scenarioZ, caption;
  if (def?.type === "historical") {
    const histRow = _indicatorsWide.find(r => r.date === def.hist_date);
    scenarioZ = histRow ? extractIndicatorZ(histRow) : baseline6Z;
    caption = `Scenario = actual z-scores recorded in ${def.hist_date.slice(0, 7)} (${def.label}).`;
  } else {
    const pillarDeltas = isCustom ? CUSTOM_STATE.pillar_deltas : (def?.pillar_deltas || {});
    const peakT        = (isCustom ? CUSTOM_STATE.peak_month : def?.peak_month) || 4;
    scenarioZ = indicatorScenarioZ(baseline6Z, pillarDeltas);
    caption = `Scenario = baseline T+6 + pillar shock at peak (T+${peakT}), distributed equally within each pillar.`;
  }

  const PILLAR_ORDER = ["growth", "credit", "stress", "liquidity", "inflation"];
  const fmt  = v => v != null ? (+v).toFixed(2) : "—";
  const tone = v => v == null ? "" : v > 0.3 ? "tone-pos" : v < -0.3 ? "tone-neg" : "tone-neutral";

  const rows = PILLAR_ORDER.flatMap(pid => {
    return Object.keys(INDICATORS).filter(c => INDICATORS[c].pillar === pid).map(code => {
      const meta  = INDICATORS[code];
      const cur   = _currentIndicatorZ[code];
      const bl    = baseline6Z[code];
      const scen  = scenarioZ?.[code];
      const delta = scen != null && cur != null ? scen - cur : null;
      return `<tr>
        <td class="sv2-ind-name">
          <span class="sv2-pillar-dot" style="background:${PILLARS[pid].color}"></span>${meta.label}
        </td>
        <td class="num ${tone(cur)}">${fmt(cur)}</td>
        <td class="num ${tone(bl)}">${fmt(bl)}</td>
        <td class="num ${tone(scen)}">${fmt(scen)}</td>
        <td class="num ${delta == null ? "" : delta < -0.1 ? "tone-neg" : delta > 0.1 ? "tone-pos" : "tone-neutral"}">
          ${delta != null ? (delta >= 0 ? "+" : "") + delta.toFixed(2) : "—"}
        </td>
      </tr>`;
    });
  });

  document.getElementById("sv2-ind-tbody").innerHTML = rows.join("");
  document.getElementById("sv2-table-caption").textContent = caption;
}

// ─── Custom builder ─────────────────────────────────────────────────────────────
function renderCustomBuilder() {
  const sliderHTML = Object.entries(PILLARS).map(([id, meta]) => {
    const val = CUSTOM_STATE.pillar_deltas[id] || 0;
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
      <div class="sv2-timing-head">Timing</div>
      <div class="sv2-timing-row">
        <span class="sv2-timing-label">Months to peak</span>
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
      <button class="pg-btn" id="sv2-cust-reset" style="margin-top:1rem">Reset to defaults</button>
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

// ─── Master update ──────────────────────────────────────────────────────────────
function updateAll() {
  const scenPath = getScenarioPath(activeScenarioId);
  if (!scenPath) return;

  renderForecastChart(scenPath);
  renderNarrative(scenPath);
  renderPillarChart(scenPath);
  renderIndicatorTable();

  document.getElementById("sv2-custom-section").style.display =
    activeScenarioId === "custom" ? "" : "none";
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const [indicatorsWide, compositeHistory, metadata] = await Promise.all([
    loadJSON("indicators_wide.json"),
    loadJSON("composite_history.json"),
    loadJSON("metadata.json"),
  ]);

  _indicatorsWide = indicatorsWide;
  _dataThrough    = metadata.data_through;

  // Latest complete month (prefer data_through row; fall back to last row with full data)
  const latestRow = indicatorsWide.find(r => r.date === _dataThrough)
    || indicatorsWide.slice().reverse().find(r => r.g_nfp_z != null);

  _currentIndicatorZ   = extractIndicatorZ(latestRow);
  _currentPillarScores = computePillarScores(_currentIndicatorZ);
  _todayComposite      = computeCompositeFromPillars(_currentPillarScores);

  // Last 5 years of composite history for the main chart
  const cutoff = addMonths(_dataThrough, -60);
  _historicalComposites = compositeHistory.filter(r => r.date >= cutoff);

  _baselinePath = buildBaselinePath(_currentPillarScores, _dataThrough, 12);

  renderSelector();
  renderCustomBuilder();
  updateAll();

  const regime = metadata.latest_regime_confirmed;
  document.getElementById("appbar-status").textContent =
    `MRS ${regime} · ${_dataThrough?.slice(0, 7)} · ${metadata.version}`;
  document.getElementById("status-footer").textContent =
    `MRS ${metadata.version} · data through ${_dataThrough} · generated ${metadata.generated_at}`;
}

main().catch(err => {
  document.body.insertAdjacentHTML("beforeend",
    `<p style="color:#c62828;padding:1rem">Error: ${err.message}</p>`);
  console.error(err);
});
