// Shared app shell: the dark command bar (with live global MRS status) and the
// KPI ribbon. Every page mounts the same shell so the product feels coherent.

import { REGIME_COLORS } from "./regime.js";
import { signed } from "./narrative.js";
import { deltaGlyph } from "./format.js";

// Fills the #appbar-status element with the global regime/score read.
export function setAppbarStatus(latest, regime, metadata) {
  const el = document.getElementById("appbar-status");
  if (!el) return;
  el.innerHTML = `
    <span class="ab-badge" style="background:${REGIME_COLORS[regime] || "#999"}">${regime}</span>
    <span class="ab-metric"><b>${latest.display_score.toFixed(2)}</b><i>/5</i></span>
    <span class="ab-sub">z ${signed(latest.composite)} · 3m ${deltaGlyph(latest.comp_3m_chg)} ${signed(latest.comp_3m_chg)}</span>
    <span class="ab-sub muted">data through ${metadata.data_through}</span>
  `;
}

// Renders a KPI ribbon from [{tone,label,value,sub,href?}] into the given
// container id. Tiles with an href become links (aggregate → drill-down).
export function renderKPIs(containerId, tiles) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = tiles
    .map((t) => {
      const inner = `
        <div class="kpi-label">${t.label}</div>
        <div class="kpi-value">${t.value}</div>
        <div class="kpi-sub">${t.sub ?? ""}</div>`;
      return t.href
        ? `<a class="kpi tone-${t.tone} kpi-link" href="${t.href}">${inner}</a>`
        : `<div class="kpi tone-${t.tone}">${inner}</div>`;
    })
    .join("");
}

// Standard footer string.
export function footerText(metadata) {
  return `MRS ${metadata.version} · ${metadata.n_months} months (${metadata.data_from} → ${metadata.data_through}) · generated ${metadata.generated_at}`;
}
