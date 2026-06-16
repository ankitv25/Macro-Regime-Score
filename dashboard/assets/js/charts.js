// Plotly chart builders. Each function takes a div id and pre-computed data
// (already exported from MRS_Master.xlsx) and renders one chart. No values
// are computed here beyond simple filtering/sorting/grouping of rows that
// already exist in the data - all z-scores, contributions, flags, regimes,
// percentiles, etc. come from the monitoring store.

import { PILLARS, INDICATORS } from "./meta.js";
import { REGIME_COLORS, regimeShapes, nberShapes } from "./regime.js";

const PLOTLY_CONFIG = { responsive: true, displaylogo: false };

export const RANGE_BUTTONS = [
  { count: 1, label: "1Y", step: "year", stepmode: "backward" },
  { count: 3, label: "3Y", step: "year", stepmode: "backward" },
  { count: 5, label: "5Y", step: "year", stepmode: "backward" },
  { count: 10, label: "10Y", step: "year", stepmode: "backward" },
  { step: "all", label: "Full" },
];

// Display-score thresholds (3 + z): Expansion >= 3.35, Neutral [2.70, 3.35),
// Slowdown [2.00, 2.70), Contraction < 2.00 - methodology doc §4.4.
const THRESHOLDS = [3.35, 2.70, 2.00];

// --- Layer 1: composite MRS dashboard --------------------------------------

export function compositeChart(divId, composite, regimePeriods, opts = {}) {
  const dates = composite.map((r) => r.date);
  const scores = composite.map((r) => r.display_score);
  const last = composite[composite.length - 1];

  const traces = [
    {
      x: dates,
      y: scores,
      type: "scatter",
      mode: "lines",
      name: "MRS",
      line: { color: "#0f172a", width: 1.8 },
      hovertemplate: "%{x|%b %Y}<br>MRS %{y:.2f}<extra></extra>",
    },
    {
      x: [last.date],
      y: [last.display_score],
      type: "scatter",
      mode: "markers",
      marker: { color: REGIME_COLORS[last.regime_confirmed] || "#0f172a", size: 9, line: { color: "#fff", width: 1.5 } },
      hovertemplate: `Now: %{y:.2f}<extra></extra>`,
      showlegend: false,
    },
  ];

  // Regime threshold bands as faint horizontal fills (display scale).
  const BANDS = [
    { y0: 3.35, y1: 5.0, c: "rgba(46,125,50,0.07)" },
    { y0: 2.7, y1: 3.35, c: "rgba(158,158,158,0.06)" },
    { y0: 2.0, y1: 2.7, c: "rgba(249,168,37,0.08)" },
    { y0: 1.0, y1: 2.0, c: "rgba(198,40,40,0.08)" },
  ];

  const shapes = [
    ...BANDS.map((b) => ({ type: "rect", xref: "paper", x0: 0, x1: 1, yref: "y", y0: b.y0, y1: b.y1, fillcolor: b.c, line: { width: 0 }, layer: "below" })),
    ...regimeShapes(regimePeriods, 1, 5).map((s) => ({ ...s, layer: "below" })),
    ...(opts.showNBER ? nberShapes(composite, 1, 5) : []),
    ...THRESHOLDS.map((v) => ({ type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: v, y1: v, line: { color: "rgba(15,23,42,0.25)", width: 1, dash: "dot" } })),
  ];

  const annotations = [
    { xref: "paper", x: 0.012, y: 4.5, text: "EXPANSION", showarrow: false, font: { size: 9, color: "#2e7d32" }, xanchor: "left" },
    { xref: "paper", x: 0.012, y: 3.02, text: "NEUTRAL", showarrow: false, font: { size: 9, color: "#6b7280" }, xanchor: "left" },
    { xref: "paper", x: 0.012, y: 2.35, text: "SLOWDOWN", showarrow: false, font: { size: 9, color: "#b8860b" }, xanchor: "left" },
    { xref: "paper", x: 0.012, y: 1.5, text: "CONTRACTION", showarrow: false, font: { size: 9, color: "#c62828" }, xanchor: "left" },
  ];

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "var(--font-sans)", size: 11, color: "#475569" },
    margin: { t: 12, r: 14, b: 28, l: 34 },
    yaxis: { range: [1, 5], gridcolor: "rgba(148,163,184,0.18)", tickfont: { size: 10 }, fixedrange: true },
    xaxis: { type: "date", gridcolor: "rgba(148,163,184,0.12)", rangeselector: { buttons: RANGE_BUTTONS, bgcolor: "#f1f5f9", activecolor: "#1d4ed8", font: { size: 10 }, y: 1.02, yanchor: "bottom" } },
    shapes,
    annotations,
    showlegend: false,
  };

  Plotly.newPlot(divId, traces, layout, PLOTLY_CONFIG);
}

export function contributionChart(divId, pillarsWide) {
  const dates = pillarsWide.map((r) => r.date);

  const traces = Object.entries(PILLARS).map(([id, meta]) => ({
    x: dates,
    y: pillarsWide.map((r) => r[`${id}_contribution`]),
    type: "scatter",
    mode: "lines",
    stackgroup: "contrib",
    name: meta.label,
    line: { width: 0.5, color: meta.color },
    hovertemplate: "%{x|%Y-%m}<br>" + meta.label + ": %{y:.3f}<extra></extra>",
  }));

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "var(--font-sans)", size: 11, color: "#475569" },
    margin: { t: 8, r: 14, b: 24, l: 44 },
    yaxis: { title: { text: "z-units", font: { size: 10 } }, zeroline: true, zerolinecolor: "rgba(15,23,42,0.35)", gridcolor: "rgba(148,163,184,0.18)", tickfont: { size: 10 } },
    xaxis: { type: "date", gridcolor: "rgba(148,163,184,0.12)", tickfont: { size: 10 } },
    legend: { orientation: "h", y: -0.18, font: { size: 10 } },
  };

  Plotly.newPlot(divId, traces, layout, PLOTLY_CONFIG);
}

// Ranked pillar contributions for the anchor month, bridging to the composite
// total - the "what's driving the score right now" cross-section (complements
// the time-series contributionChart above).
export function attributionWaterfall(divId, ranked, compositeRow) {
  const fmt = (v) => (v >= 0 ? "+" : "") + v.toFixed(3);
  const x = [...ranked.map((r) => r.label), "Composite"];
  const y = [...ranked.map((r) => r.contribution), compositeRow.composite];
  const measure = [...ranked.map(() => "relative"), "total"];

  const trace = {
    type: "waterfall",
    orientation: "v",
    x,
    y,
    measure,
    text: y.map(fmt),
    textposition: "outside",
    textfont: { size: 10, color: "#334155" },
    connector: { line: { color: "rgba(148,163,184,0.5)", width: 1, dash: "dot" } },
    increasing: { marker: { color: "#15803d" } },
    decreasing: { marker: { color: "#c62828" } },
    totals: { marker: { color: "#0f172a" } },
    hovertemplate: "%{x}<br>%{y:.3f} z<extra></extra>",
  };

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "var(--font-sans)", size: 11, color: "#475569" },
    margin: { t: 22, r: 14, b: 28, l: 40 },
    yaxis: { title: { text: "z-units", font: { size: 10 } }, zeroline: true, zerolinecolor: "rgba(15,23,42,0.35)", gridcolor: "rgba(148,163,184,0.18)", tickfont: { size: 10 } },
    xaxis: { tickfont: { size: 11 } },
    showlegend: false,
  };

  Plotly.newPlot(divId, [trace], layout, PLOTLY_CONFIG);
}

export function diffusionChart(divId, composite) {
  const dates = composite.map((r) => r.date);
  const diffusion = composite.map((r) => r.diffusion);

  const traces = [
    {
      x: dates,
      y: diffusion,
      type: "scatter",
      mode: "lines",
      fill: "tozeroy",
      fillcolor: "rgba(107,107,107,0.15)",
      line: { color: "#6b6b6b", width: 1 },
      hovertemplate: "%{x|%Y-%m}<br>%{y:.0%} of indicators positive<extra></extra>",
    },
  ];

  const layout = {
    margin: { t: 5, r: 20, b: 30, l: 50 },
    yaxis: { range: [0, 1], tickformat: ".0%" },
    xaxis: { type: "date" },
    showlegend: false,
  };

  Plotly.newPlot(divId, traces, layout, PLOTLY_CONFIG);
}

// --- Layer 2: pillar dashboards ---------------------------------------------

export function pillarScoreChart(divId, pillarsLong, pillarId, regimePeriods, opts = {}) {
  const rows = pillarsLong
    .filter((r) => r.pillar === pillarId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const dates = rows.map((r) => r.date);
  const scores = rows.map((r) => r.score);
  const finite = scores.filter((v) => v != null);
  const yMax = Math.max(3, ...finite);
  const yMin = Math.min(-3, ...finite);

  const traces = [
    {
      x: dates,
      y: scores,
      type: "scatter",
      mode: "lines",
      line: { color: PILLARS[pillarId].color, width: 1.8 },
      hovertemplate: "%{x|%b %Y}<br>z = %{y:.2f}<extra></extra>",
    },
  ];

  // Regime z-thresholds (+0.35 / -0.30 / -1.00) drawn as faint bands + lines,
  // so a pillar chart carries the same thresholds as the composite.
  const Z_LINES = [0.35, -0.3, -1.0];
  const zBands = [
    { y0: 0.35, y1: yMax, c: "rgba(46,125,50,0.06)" },
    { y0: -0.3, y1: 0.35, c: "rgba(158,158,158,0.05)" },
    { y0: -1.0, y1: -0.3, c: "rgba(249,168,37,0.07)" },
    { y0: yMin, y1: -1.0, c: "rgba(198,40,40,0.07)" },
  ];

  const shapes = [
    ...(opts.miniature ? [] : zBands.map((b) => ({ type: "rect", xref: "paper", x0: 0, x1: 1, yref: "y", y0: b.y0, y1: b.y1, fillcolor: b.c, line: { width: 0 }, layer: "below" }))),
    ...regimeShapes(regimePeriods, yMin, yMax).map((s) => ({ ...s, layer: "below" })),
    ...(opts.miniature ? [] : Z_LINES.map((v) => ({ type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: v, y1: v, line: { color: "rgba(15,23,42,0.18)", width: 1, dash: "dot" } }))),
  ];

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "var(--font-sans)", size: 11, color: "#475569" },
    margin: opts.miniature ? { t: 5, r: 10, b: 25, l: 35 } : { t: 10, r: 16, b: 28, l: 38 },
    yaxis: { title: opts.miniature ? "" : { text: "pillar z-score", font: { size: 10 } }, zeroline: true, zerolinecolor: "rgba(15,23,42,0.35)", gridcolor: "rgba(148,163,184,0.16)", tickfont: { size: 10 } },
    xaxis: opts.miniature
      ? { type: "date" }
      : { type: "date", gridcolor: "rgba(148,163,184,0.12)", rangeselector: { buttons: RANGE_BUTTONS, bgcolor: "#f1f5f9", activecolor: "#1d4ed8", font: { size: 10 }, y: 1.02, yanchor: "bottom" } },
    shapes,
    showlegend: false,
  };

  Plotly.newPlot(divId, traces, layout, PLOTLY_CONFIG);
}

export function regimeBoxPlot(divId, pillarsLong, pillarId) {
  const rows = pillarsLong.filter((r) => r.pillar === pillarId && r.regime_at_obs);
  const order = ["Contraction", "Slowdown", "Neutral", "Expansion"];

  const traces = order.map((regime) => ({
    y: rows.filter((r) => r.regime_at_obs === regime).map((r) => r.score),
    type: "box",
    name: regime,
    marker: { color: REGIME_COLORS[regime], size: 3 },
    boxpoints: "all",
    jitter: 0.4,
    pointpos: 0,
  }));

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "var(--font-sans)", size: 11, color: "#475569" },
    margin: { t: 10, r: 16, b: 28, l: 38 },
    yaxis: { title: { text: "pillar z-score", font: { size: 10 } }, zeroline: true, zerolinecolor: "rgba(15,23,42,0.35)", gridcolor: "rgba(148,163,184,0.16)", tickfont: { size: 10 } },
    xaxis: { tickfont: { size: 10 } },
    showlegend: false,
  };

  Plotly.newPlot(divId, traces, layout, PLOTLY_CONFIG);
}

// --- Layer 3: indicator dashboards ------------------------------------------

export function indicatorSparkline(divId, indicatorsLong, code) {
  const rows = indicatorsLong
    .filter((r) => r.indicator === code)
    .sort((a, b) => a.date.localeCompare(b.date));
  const dates = rows.map((r) => r.date);
  const z = rows.map((r) => r.z_score);

  const traces = [
    {
      x: dates,
      y: z,
      type: "scatter",
      mode: "lines",
      line: { width: 1.25, color: PILLARS[INDICATORS[code].pillar].color },
      hoverinfo: "skip",
    },
  ];

  const layout = {
    margin: { t: 5, r: 10, b: 20, l: 30 },
    yaxis: { range: [-3.2, 3.2], zeroline: true, zerolinecolor: "rgba(0,0,0,0.4)", tickfont: { size: 9 } },
    xaxis: { type: "date", showticklabels: false },
    showlegend: false,
  };

  Plotly.newPlot(divId, traces, layout, { ...PLOTLY_CONFIG, staticPlot: true });
}

export function indicatorDualChart(divId, indicatorsLong, code) {
  const rows = indicatorsLong
    .filter((r) => r.indicator === code)
    .sort((a, b) => a.date.localeCompare(b.date));
  const dates = rows.map((r) => r.date);
  const raw = rows.map((r) => r.raw_value);
  const z = rows.map((r) => r.z_score);
  const meanRaw = rows.map((r) => r.expanding_mean_raw);
  const upper = rows.map((r) =>
    r.expanding_mean_raw != null && r.expanding_std_raw != null
      ? r.expanding_mean_raw + r.expanding_std_raw
      : null
  );
  const lower = rows.map((r) =>
    r.expanding_mean_raw != null && r.expanding_std_raw != null
      ? r.expanding_mean_raw - r.expanding_std_raw
      : null
  );

  const clipped = rows.filter((r) => r.z_score != null && Math.abs(r.z_score) >= 3);

  const traces = [
    {
      x: dates,
      y: upper,
      type: "scatter",
      mode: "lines",
      line: { width: 0 },
      showlegend: false,
      hoverinfo: "skip",
    },
    {
      x: dates,
      y: lower,
      type: "scatter",
      mode: "lines",
      fill: "tonexty",
      fillcolor: "rgba(31,119,180,0.10)",
      line: { width: 0 },
      name: "Expanding mean ± 1 std",
      hoverinfo: "skip",
    },
    {
      x: dates,
      y: meanRaw,
      type: "scatter",
      mode: "lines",
      line: { width: 1, dash: "dot", color: "#1f77b4" },
      name: "Expanding mean",
    },
    {
      x: dates,
      y: raw,
      type: "scatter",
      mode: "lines",
      line: { width: 1.5, color: "#1a1a1a" },
      name: "Raw value",
      yaxis: "y",
    },
    {
      x: dates,
      y: z,
      type: "scatter",
      mode: "lines",
      line: { width: 1.25, color: "#d62728" },
      name: "z-score",
      yaxis: "y2",
    },
    {
      x: clipped.map((r) => r.date),
      y: clipped.map((r) => r.raw_value),
      type: "scatter",
      mode: "markers",
      marker: { color: "#d62728", size: 7, symbol: "x" },
      name: "Clipped (|z| ≥ 3)",
      yaxis: "y",
    },
  ];

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "var(--font-sans)", size: 11, color: "#475569" },
    margin: { t: 10, r: 48, b: 30, l: 48 },
    xaxis: { type: "date", gridcolor: "rgba(148,163,184,0.12)", tickfont: { size: 10 }, rangeselector: { buttons: RANGE_BUTTONS, bgcolor: "#f1f5f9", activecolor: "#1d4ed8", font: { size: 10 }, y: 1.02, yanchor: "bottom" } },
    yaxis: { title: { text: "raw value", font: { size: 10 } }, gridcolor: "rgba(148,163,184,0.16)", tickfont: { size: 10 } },
    yaxis2: { title: { text: "z-score", font: { size: 10 } }, overlaying: "y", side: "right", range: [-3.5, 3.5], tickfont: { size: 10 } },
    legend: { orientation: "h", y: -0.2, font: { size: 10 } },
  };

  Plotly.newPlot(divId, traces, layout, PLOTLY_CONFIG);
}

// --- Layer 4: trend & change monitoring --------------------------------------

export function indicatorHeatmap(divId, indicatorsWide, months = 24) {
  const codes = Object.keys(INDICATORS);
  const rows = indicatorsWide.slice(-months);
  const dates = rows.map((r) => r.date);
  // Coerce undefined/null to null so Plotly renders missing cells as gaps,
  // not as yellow (midpoint color) that would result from implicit 0/NaN.
  const z = codes.map((code) =>
    rows.map((r) => {
      const v = r[`${code}_z`];
      return v === undefined || v === null ? null : +v;
    })
  );
  const labels = codes.map((c) => INDICATORS[c].label);

  const traces = [
    {
      z,
      x: dates,
      y: labels,
      type: "heatmap",
      colorscale: [
        [0,    "#c62828"],
        [0.33, "#ef9a9a"],
        [0.5,  "#f5f5f5"],
        [0.67, "#a5d6a7"],
        [1,    "#2e7d32"],
      ],
      zmid: 0,
      zmin: -3,
      zmax: 3,
      colorbar: { title: "z-score", tickfont: { size: 10 } },
      hovertemplate: "%{x|%Y-%m}<br>%{y}: %{z:.2f}<extra></extra>",
    },
  ];

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "var(--font-sans)", size: 11, color: "#475569" },
    margin: { t: 10, r: 16, b: 40, l: 230 },
    xaxis: { type: "date", tickfont: { size: 10 } },
    // reversed: Growth at top, Stress at bottom — matches pillar reading order
    yaxis: { tickfont: { size: 10 }, autorange: "reversed" },
  };

  const el = document.getElementById(divId);
  el.style.height = `${30 * codes.length + 80}px`;

  Plotly.newPlot(divId, traces, layout, PLOTLY_CONFIG);
}

// ─── Scenario: 12-month forecast overlay chart ──────────────────────────────
export function scenarioForecastChart(divId, historical, todayMark, baseline, scenarioPaths) {
  const lastBaseline = baseline[baseline.length - 1];

  // Shaded forecast zone
  const forecastZone = {
    type: "rect", xref: "x", yref: "paper",
    x0: todayMark.date, x1: lastBaseline.date,
    y0: 0, y1: 1,
    fillcolor: "rgba(0,0,0,0.03)",
    line: { width: 0 }, layer: "below",
  };

  // Threshold dotted lines
  const thresholds = [3.35, 2.70, 2.00].map(y => ({
    type: "line", xref: "paper", yref: "y",
    x0: 0, x1: 1, y0: y, y1: y,
    line: { color: "#cbd5e1", width: 1, dash: "dot" },
  }));

  const traces = [];

  // Historical line
  traces.push({
    x: historical.map(r => r.date),
    y: historical.map(r => r.display_score),
    type: "scatter", mode: "lines",
    name: "MRS historical",
    line: { color: "#0f172a", width: 1.8 },
    hovertemplate: "%{x|%b %Y}<br>MRS %{y:.2f}<extra></extra>",
  });

  // Baseline (dotted)
  traces.push({
    x: [todayMark.date, ...baseline.map(r => r.date)],
    y: [todayMark.display_score, ...baseline.map(r => r.display_score)],
    type: "scatter", mode: "lines",
    name: "Baseline (no shock)",
    line: { color: "#94a3b8", width: 1.5, dash: "dot" },
    hovertemplate: "Baseline<br>%{x|%b %Y}: %{y:.2f}<extra></extra>",
  });

  // Scenario paths
  for (const { label, color, path } of scenarioPaths) {
    traces.push({
      x: [todayMark.date, ...path.map(r => r.date)],
      y: [todayMark.display_score, ...path.map(r => r.display_score)],
      type: "scatter", mode: "lines+markers",
      name: label,
      line: { color, width: 2.5 },
      marker: { size: 5, color },
      hovertemplate: `${label}<br>%{x|%b %Y}: %{y:.2f}<extra></extra>`,
    });
  }

  // Today marker (on top)
  traces.push({
    x: [todayMark.date],
    y: [todayMark.display_score],
    type: "scatter", mode: "markers",
    name: "Today",
    marker: {
      color: REGIME_COLORS[todayMark.regime] || "#0f172a",
      size: 11, symbol: "circle",
      line: { color: "#fff", width: 2 },
    },
    hovertemplate: `Today · MRS ${todayMark.display_score?.toFixed(2)}<extra></extra>`,
    showlegend: false,
  });

  const layout = {
    margin: { t: 10, r: 90, b: 50, l: 45 },
    height: 420,
    shapes: [forecastZone, ...thresholds],
    annotations: [
      { xref: "paper", yref: "y", x: 1.01, y: 3.35, text: "Expansion",   showarrow: false, xanchor: "left", font: { size: 9, color: "#64748b" } },
      { xref: "paper", yref: "y", x: 1.01, y: 2.70, text: "Neutral",     showarrow: false, xanchor: "left", font: { size: 9, color: "#64748b" } },
      { xref: "paper", yref: "y", x: 1.01, y: 2.00, text: "Slowdown",    showarrow: false, xanchor: "left", font: { size: 9, color: "#64748b" } },
      { xref: "paper", yref: "y", x: 1.01, y: 1.55, text: "Contraction", showarrow: false, xanchor: "left", font: { size: 9, color: "#64748b" } },
      { xref: "x", yref: "paper", x: todayMark.date, y: 1.0, text: "Today",
        showarrow: false, xanchor: "center", yanchor: "bottom", font: { size: 9, color: "#475569" }, yshift: 4 },
    ],
    xaxis: { type: "date", tickformat: "%b '%y", showgrid: false, tickfont: { size: 10 } },
    yaxis: {
      range: [1, 5],
      tickvals: [1.0, 2.00, 2.70, 3.35, 5.0],
      ticktext: ["1", "2.0", "2.7", "3.35", "5"],
      showgrid: true, gridcolor: "#f1f5f9", tickfont: { size: 10 },
    },
    legend: { orientation: "h", x: 0, y: -0.18, font: { size: 10 } },
    plot_bgcolor: "#ffffff",
    paper_bgcolor: "#ffffff",
    font: { family: "var(--font-sans)", size: 11, color: "#1e293b" },
  };

  Plotly.react(divId, traces, layout, PLOTLY_CONFIG);
}

// ─── Scenario: pillar comparison bar chart ───────────────────────────────────
export function scenarioPillarChart(divId, pillarsToday, pillarsBaseline6, pillarsScenario, scenColor) {
  const ORDER  = ["growth", "credit", "stress", "liquidity", "inflation"];
  const labels = ORDER.map(id => PILLARS[id].label);
  const toArr  = pMap => ORDER.map(id => pMap?.[id] != null ? +pMap[id] : 0);

  // Convert hex to rgba
  const hexToRgba = (hex, a) => {
    const n = parseInt(hex.replace("#", ""), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const scenRgba = scenColor?.startsWith("#") ? hexToRgba(scenColor, 0.85) : (scenColor || "rgba(198,40,40,0.85)");

  const traces = [
    {
      type: "bar", orientation: "h", name: "Today",
      x: toArr(pillarsToday), y: labels,
      marker: { color: "rgba(148,163,184,0.55)", line: { width: 0 } },
      hovertemplate: "%{y}: %{x:.2f}z<extra>Today</extra>",
    },
    {
      type: "bar", orientation: "h", name: "Baseline T+6",
      x: toArr(pillarsBaseline6), y: labels,
      marker: { color: "rgba(14,165,233,0.55)", line: { width: 0 } },
      hovertemplate: "%{y}: %{x:.2f}z<extra>Baseline T+6</extra>",
    },
    {
      type: "bar", orientation: "h", name: "Scenario",
      x: toArr(pillarsScenario), y: labels,
      marker: { color: scenRgba, line: { width: 0 } },
      hovertemplate: "%{y}: %{x:.2f}z<extra>Scenario</extra>",
    },
  ];

  const layout = {
    barmode: "overlay",
    margin: { t: 5, r: 20, b: 40, l: 130 },
    height: 220,
    xaxis: {
      range: [-3, 3],
      zeroline: true, zerolinecolor: "#94a3b8", zerolinewidth: 1.5,
      showgrid: true, gridcolor: "#f1f5f9",
      tickformat: ".1f", tickfont: { size: 10 },
    },
    yaxis: { automargin: true, tickfont: { size: 10 } },
    legend: { orientation: "h", x: 0, y: -0.3, font: { size: 10 } },
    bargap: 0.4,
    plot_bgcolor: "#ffffff",
    paper_bgcolor: "#ffffff",
    font: { family: "var(--font-sans)", size: 11, color: "#1e293b" },
  };

  Plotly.react(divId, traces, layout, PLOTLY_CONFIG);
}
