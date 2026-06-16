// Regime color palette and shading helpers shared by all dashboard pages.
// Colors must match the methodology doc Part VIII §8.1 convention:
// Expansion green / Neutral grey / Slowdown amber / Contraction red.

export const REGIME_COLORS = {
  Expansion: "#2e7d32",
  Neutral: "#9e9e9e",
  Slowdown: "#f9a825",
  Contraction: "#c62828",
};

export const REGIME_BG = {
  Expansion: "rgba(46,125,50,0.10)",
  Neutral: "rgba(158,158,158,0.10)",
  Slowdown: "rgba(249,168,37,0.14)",
  Contraction: "rgba(198,40,40,0.14)",
};

// One Plotly shape per confirmed-regime block in regime_periods.json,
// shaded across the full y-range of the chart it's applied to.
export function regimeShapes(regimePeriods, y0, y1) {
  return regimePeriods.map((p) => ({
    type: "rect",
    xref: "x",
    yref: "y",
    x0: p.start_date,
    x1: p.end_date,
    y0,
    y1,
    fillcolor: REGIME_BG[p.regime] || "rgba(0,0,0,0.04)",
    line: { width: 0 },
    layer: "below",
  }));
}

// NBER recessions (composite_history.usrec == 1), drawn as a thin dark strip
// at the bottom of the chart - the validation overlay referenced in Part VIII
// §8.2 ("clearly marked ex-post").
export function nberShapes(compositeRows, y0, y1) {
  const band = (y1 - y0) * 0.035;
  const shapes = [];
  let start = null;
  for (let i = 0; i < compositeRows.length; i++) {
    const row = compositeRows[i];
    if (row.usrec === 1 && start === null) start = row.date;
    if (row.usrec !== 1 && start !== null) {
      shapes.push(nberRect(start, compositeRows[i - 1].date, y0, y0 + band));
      start = null;
    }
  }
  if (start !== null) {
    shapes.push(nberRect(start, compositeRows[compositeRows.length - 1].date, y0, y0 + band));
  }
  return shapes;
}

function nberRect(x0, x1, y0, y1) {
  return {
    type: "rect",
    xref: "x",
    yref: "y",
    x0,
    x1,
    y0,
    y1,
    fillcolor: "rgba(0,0,0,0.45)",
    line: { width: 0 },
    layer: "above",
  };
}
