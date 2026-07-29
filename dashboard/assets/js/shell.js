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
  const fmtMonth = (iso) => {
    const [y, m] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("default", { month: "short", year: "numeric", timeZone: "UTC" });
  };
  const refreshed = metadata.generated_at
    ? fmtMonth(metadata.generated_at.slice(0, 10))
    : "";
  return `MRS ${metadata.version} · ${metadata.n_months} months · through ${fmtMonth(metadata.data_through)}${refreshed ? ` · refreshed ${refreshed}` : ""}`;
}
