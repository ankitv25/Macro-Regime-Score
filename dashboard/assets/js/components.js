// Reusable UI components that render interpretation, not just charts. The
// regime gauge is the key one: a horizontal scale with the four regime bands
// drawn explicitly and a needle at the current value — so "where does this
// sit" is answerable at a glance, for the composite AND for each pillar.

import { Z_BOUNDARIES, momentumSeries, thresholdProximity } from "./narrative.js";
import { deltaGlyph, deltaTone } from "./format.js";

const REGIME_BAND_COLORS = [
  "rgba(198,40,40,0.80)",  // Contraction
  "rgba(249,168,37,0.85)", // Slowdown
  "rgba(158,158,158,0.55)",// Neutral
  "rgba(46,125,50,0.78)",  // Expansion
];

// value: current z-score. Renders the four regime bands across [min,max] with
// boundary ticks and a labelled needle. Returns an HTML string.
export function regimeGauge(value, opts = {}) {
  const min = opts.min ?? -2.0;
  const max = opts.max ?? 1.2;
  const boundaries = opts.boundaries ?? Z_BOUNDARIES;
  const valueLabel = opts.valueLabel ?? (value >= 0 ? "+" : "") + value.toFixed(2);
  const showAxis = opts.showAxis !== false;

  const pct = (v) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const stops = [min, ...boundaries, max];

  let bands = "";
  for (let i = 0; i < REGIME_BAND_COLORS.length; i++) {
    const l = pct(stops[i]);
    const w = pct(stops[i + 1]) - l;
    bands += `<div class="gauge-band" style="left:${l}%;width:${w}%;background:${REGIME_BAND_COLORS[i]}"></div>`;
  }

  const needle = `<div class="gauge-needle" style="left:${pct(value)}%"><span class="gauge-val">${valueLabel}</span></div>`;

  const axis = showAxis
    ? `<div class="gauge-axis">` +
      boundaries.map((b) => `<span class="gauge-tick" style="left:${pct(b)}%">${b > 0 ? "+" : ""}${b}</span>`).join("") +
      `</div>`
    : "";

  return `<div class="gauge"><div class="gauge-track">${bands}${needle}</div>${axis}</div>`;
}

// 1/3/6/12-month momentum chips for the composite anchor (§8.2 momentum panel).
export function momentumStrip(latest) {
  return momentumSeries(latest)
    .map((m) => {
      const v = m.value;
      return `<div class="mom-item">
        <span class="mom-label">${m.label}</span>
        <span class="mom-value tone-${deltaTone(v)}">${deltaGlyph(v)} ${v != null ? Math.abs(v).toFixed(2) : "–"}</span>
      </div>`;
    })
    .join("");
}

// "Distance to next regime" chips - one per neighboring regime, with the
// nearer boundary highlighted. Pairs with the percentile/breadth bars in the
// composite-foot row.
export function thresholdReadout(latest, regime) {
  const proximity = thresholdProximity(latest, regime);
  if (!proximity.length) return "<div class=\"thr-item\"><span class=\"thr-target\">Contraction</span><span class=\"thr-dist\">floor of scale</span></div>";
  const nearest = Math.min(...proximity.map((p) => p.dist));
  return proximity
    .map((p) => {
      const arrow = p.dir === "down" ? "▼" : "▲";
      const near = p.dist === nearest ? " near" : "";
      return `<div class="thr-item${near}">
        <span class="thr-arrow tone-${p.dir === "down" ? "neg" : "pos"}">${arrow}</span>
        <span class="thr-target">${p.target}</span>
        <span class="thr-dist">${p.dist.toFixed(2)} z</span>
      </div>`;
    })
    .join("");
}

// The four-regime legend strip (what each band means), shown once under the
// hero gauge so a cold visitor learns the scale immediately.
export function regimeLegend(defs, currentRegime) {
  return (
    `<div class="scale-legend">` +
    ["Contraction", "Slowdown", "Neutral", "Expansion"]
      .map((r) => {
        const active = r === currentRegime ? " active" : "";
        return `<div class="legend-item${active}"><span class="legend-swatch regime-${r.toLowerCase()}"></span><strong>${r}</strong> <span class="legend-z">${defs[r].z}</span><div class="legend-plain">${defs[r].plain}</div></div>`;
      })
      .join("") +
    `</div>`
  );
}
