import { loadJSON } from "./data.js";
import { PILLARS, INDICATORS } from "./meta.js";
import { REGIME_COLORS } from "./regime.js";
import { signed } from "./narrative.js";
import { footerText } from "./shell.js";

// ─── Scenario definitions (historical z-score snapshots) ───────────────────

const SCENARIOS = {
  gfc: {
    label: "GFC 2008",
    date: "2008-12-31",
    description: "December 2008 — trough month of the Global Financial Crisis",
  },
  covid: {
    label: "COVID 2020",
    date: "2020-03-31",
    description: "March 2020 — trough month of the COVID recession",
  },
};

// ─── Regime classification (mirrors mrs_proposed_framework.py thresholds) ───

function classifyRegime(z) {
  if (z >= 0.35) return "Expansion";
  if (z >= -0.30) return "Neutral";
  if (z >= -1.00) return "Slowdown";
  return "Contraction";
}

// ─── Composite computation (same logic as production model) ─────────────────
// Each pillar score = equal-weight average of its indicator z-scores.
// Composite = weighted average of pillar scores by PILLARS weight.

function computeScenario(indicatorZScores) {
  const pillarSums = {};
  const pillarCounts = {};

  for (const [code, meta] of Object.entries(INDICATORS)) {
    const z = indicatorZScores[code];
    if (z == null || isNaN(z)) continue;
    const p = meta.pillar;
    pillarSums[p] = (pillarSums[p] || 0) + +z;
    pillarCounts[p] = (pillarCounts[p] || 0) + 1;
  }

  let composite = 0;
  let totalWeight = 0;
  const pillarResults = {};

  for (const [id, meta] of Object.entries(PILLARS)) {
    const count = pillarCounts[id] || 0;
    if (count === 0) continue;
    const score = pillarSums[id] / count;
    const contribution = score * meta.weight;
    composite += contribution;
    totalWeight += meta.weight;
    pillarResults[id] = { score, contribution, label: meta.label };
  }

  if (totalWeight === 0) return null;
  const z = composite / totalWeight;
  return {
    z,
    display: +(z + 3).toFixed(2),
    regime: classifyRegime(z),
    pillars: pillarResults,
  };
}

// ─── Render helpers ──────────────────────────────────────────────────────────

function compositeHTML(result, currentZ) {
  if (!result) return `<p class="scen-na">Insufficient data</p>`;
  const regime = result.regime;
  const color = REGIME_COLORS[regime] || "#888";
  const delta = currentZ != null ? result.z - currentZ : null;
  const deltaStr = delta != null
    ? `<span class="scen-delta ${delta < 0 ? "tone-neg" : delta > 0 ? "tone-pos" : "tone-neutral"}">${delta >= 0 ? "+" : ""}${delta.toFixed(2)}z vs today</span>`
    : "";
  return `
    <div class="scen-comp-row">
      <span class="scen-z">${signed(result.z)}<span class="scen-z-unit">z</span></span>
      <span class="scen-disp">${result.display}/5</span>
      <span class="regime-badge" style="background:${color}">${regime}</span>
    </div>
    ${deltaStr}`;
}

function pillarRowsHTML(result) {
  if (!result) return "";
  return Object.entries(result.pillars)
    .sort((a, b) => b[1].contribution - a[1].contribution)
    .map(([, p]) => {
      const tone = p.contribution >= 0.03 ? "pos" : p.contribution <= -0.03 ? "neg" : "neutral";
      return `<div class="scen-pillar-row">
        <span class="scen-pillar-name">${p.label}</span>
        <span class="scen-pillar-score tone-${tone}">${signed(p.score)}</span>
        <span class="scen-pillar-contrib tone-${tone}">(${signed(p.contribution, 3)})</span>
      </div>`;
    }).join("");
}

function indicatorTableHTML(scenZScores, currentZScores, editable = false) {
  const codes = Object.keys(INDICATORS);
  const rows = codes.map((code) => {
    const meta = INDICATORS[code];
    const cur = currentZScores[code];
    const scen = scenZScores[code];
    const delta = (cur != null && scen != null) ? scen - cur : null;
    const dStr = delta != null
      ? `<span class="tone-${delta < -0.1 ? "neg" : delta > 0.1 ? "pos" : "neutral"}">${delta >= 0 ? "+" : ""}${delta.toFixed(2)}</span>`
      : "—";
    const scenCell = editable
      ? `<input class="scen-input" type="number" min="-3" max="3" step="0.1"
           data-code="${code}" value="${scen != null ? (+scen).toFixed(1) : ""}" />`
      : `<span class="tone-${scen != null && scen < -0.5 ? "neg" : scen != null && scen > 0.5 ? "pos" : "neutral"}">${scen != null ? (+scen).toFixed(2) : "—"}</span>`;
    return `<tr>
      <td class="scen-ind-name">${meta.label}</td>
      <td class="num">${cur != null ? (+cur).toFixed(2) : "—"}</td>
      <td class="num">${scenCell}</td>
      <td class="num">${dStr}</td>
    </tr>`;
  });
  return `<thead><tr>
    <th>Indicator</th>
    <th class="num">Today</th>
    <th class="num">${editable ? "Custom" : "Scenario"}</th>
    <th class="num">Δ</th>
  </tr></thead><tbody>${rows.join("")}</tbody>`;
}

// ─── Scenario render ─────────────────────────────────────────────────────────

function renderScenario(id, scenZScores, currentZScores, currentZ) {
  const result = computeScenario(scenZScores);
  document.getElementById(`${id}-composite`).innerHTML = compositeHTML(result, currentZ);
  document.getElementById(`${id}-pillars`).innerHTML = pillarRowsHTML(result);
  document.getElementById(`${id}-table`).innerHTML =
    indicatorTableHTML(scenZScores, currentZScores, id === "custom");
}

// ─── Custom scenario: live update on input change ────────────────────────────

function bindCustomInputs(currentZScores, currentZ) {
  const inputs = document.querySelectorAll("#custom-table .scen-input");
  const getValues = () => {
    const vals = {};
    inputs.forEach((inp) => { vals[inp.dataset.code] = parseFloat(inp.value) || 0; });
    return vals;
  };
  inputs.forEach((inp) => {
    inp.addEventListener("input", () => {
      const vals = getValues();
      const result = computeScenario(vals);
      document.getElementById("custom-composite").innerHTML = compositeHTML(result, currentZ);
      document.getElementById("custom-pillars").innerHTML = pillarRowsHTML(result);
    });
  });
}

// ─── Playground ──────────────────────────────────────────────────────────────

let playgroundValues = {};

function buildPlayground(currentZScores) {
  const codes = Object.keys(INDICATORS);
  playgroundValues = { ...currentZScores };

  const sliderHTML = codes.map((code) => {
    const meta = INDICATORS[code];
    const val = currentZScores[code] ?? 0;
    const tone = val < -0.5 ? "neg" : val > 0.5 ? "pos" : "neutral";
    return `<div class="pg-row">
      <label class="pg-label" for="pg-${code}">${meta.label}</label>
      <span class="pg-val tone-${tone}" id="pg-val-${code}">${(+val).toFixed(2)}</span>
      <input class="pg-slider" type="range" id="pg-${code}"
        min="-3" max="3" step="0.05" value="${(+val).toFixed(2)}" data-code="${code}" />
    </div>`;
  }).join("");

  document.getElementById("playground-sliders").innerHTML = sliderHTML;
  renderPlaygroundResult(currentZScores);
  bindPlaygroundSliders(currentZScores);
}

function renderPlaygroundResult(vals) {
  const result = computeScenario(vals);
  if (!result) return;
  const regime = result.regime;
  const color = REGIME_COLORS[regime] || "#888";
  const pillarRows = Object.entries(result.pillars)
    .sort((a, b) => b[1].contribution - a[1].contribution)
    .map(([, p]) => {
      const pct = Math.abs(p.contribution / result.z * 100);
      const tone = p.contribution >= 0.03 ? "pos" : p.contribution <= -0.03 ? "neg" : "neutral";
      return `<div class="pg-pillar-row">
        <span class="pg-pillar-label">${p.label}</span>
        <span class="pg-pillar-score tone-${tone}">${signed(p.score)}</span>
        <div class="pg-bar-wrap">
          <div class="pg-bar tone-${tone}" style="width:${Math.min(pct,100).toFixed(0)}%"></div>
        </div>
        <span class="pg-pillar-contrib tone-${tone}">${signed(p.contribution, 3)}</span>
      </div>`;
    }).join("");

  document.getElementById("playground-result").innerHTML = `
    <div class="pg-result-head">
      <span class="scen-z">${signed(result.z)}<span class="scen-z-unit">z</span></span>
      <span class="scen-disp">${result.display}/5</span>
      <span class="regime-badge lg" style="background:${color}">${regime}</span>
    </div>
    <div class="pg-pillars">${pillarRows}</div>`;
}

function bindPlaygroundSliders(currentZScores) {
  document.querySelectorAll(".pg-slider").forEach((slider) => {
    slider.addEventListener("input", () => {
      const code = slider.dataset.code;
      const val = parseFloat(slider.value);
      playgroundValues[code] = val;
      const tone = val < -0.5 ? "neg" : val > 0.5 ? "pos" : "neutral";
      const valEl = document.getElementById(`pg-val-${code}`);
      valEl.textContent = val.toFixed(2);
      valEl.className = `pg-val tone-${tone}`;
      renderPlaygroundResult(playgroundValues);
    });
  });

  document.getElementById("pg-reset").addEventListener("click", () => {
    loadPlaygroundValues(currentZScores, currentZScores);
  });
}

function loadPlaygroundValues(vals, currentZScores) {
  const codes = Object.keys(INDICATORS);
  codes.forEach((code) => {
    const v = vals[code] ?? 0;
    playgroundValues[code] = v;
    const slider = document.getElementById(`pg-${code}`);
    const valEl = document.getElementById(`pg-val-${code}`);
    if (slider) slider.value = (+v).toFixed(2);
    if (valEl) {
      valEl.textContent = (+v).toFixed(2);
      valEl.className = `pg-val tone-${v < -0.5 ? "neg" : v > 0.5 ? "pos" : "neutral"}`;
    }
  });
  renderPlaygroundResult(playgroundValues);
}

// ─── Extract z-scores from indicators_wide row ───────────────────────────────

function extractZ(row) {
  const vals = {};
  for (const code of Object.keys(INDICATORS)) {
    const v = row[`${code}_z`];
    vals[code] = (v != null && !isNaN(v)) ? +v : null;
  }
  return vals;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [indicatorsWide, metadata] = await Promise.all([
    loadJSON("indicators_wide.json"),
    loadJSON("metadata.json"),
  ]);

  // Current (latest) z-scores
  const currentRow = indicatorsWide.find((r) => r.date === metadata.data_through)
    || indicatorsWide[indicatorsWide.length - 1];
  const currentZ = extractZ(currentRow);
  const currentComp = computeScenario(currentZ)?.z ?? 0;

  // Historical scenario z-scores
  const gfcRow = indicatorsWide.find((r) => r.date === SCENARIOS.gfc.date);
  const covidRow = indicatorsWide.find((r) => r.date === SCENARIOS.covid.date);

  if (gfcRow) renderScenario("gfc", extractZ(gfcRow), currentZ, currentComp);
  if (covidRow) renderScenario("covid", extractZ(covidRow), currentZ, currentComp);

  // Custom: start from today's values
  renderScenario("custom", { ...currentZ }, currentZ, currentComp);
  bindCustomInputs(currentZ, currentComp);

  // Playground
  buildPlayground(currentZ);

  // Load GFC / COVID buttons in playground
  if (gfcRow) {
    document.getElementById("pg-load-gfc").addEventListener("click", () =>
      loadPlaygroundValues(extractZ(gfcRow), currentZ));
  }
  if (covidRow) {
    document.getElementById("pg-load-covid").addEventListener("click", () =>
      loadPlaygroundValues(extractZ(covidRow), currentZ));
  }

  document.getElementById("appbar-status").textContent =
    `MRS ${metadata.latest_regime_confirmed} · ${metadata.data_through?.slice(0, 7)}`;
  document.getElementById("status-footer").textContent =
    `MRS v${metadata.version} · data through ${metadata.data_through} · generated ${metadata.generated_at}`;
}

main().catch((err) => {
  document.body.insertAdjacentHTML("beforeend",
    `<p style="color:#c62828;padding:1rem;">Error: ${err.message}</p>`);
  console.error(err);
});
