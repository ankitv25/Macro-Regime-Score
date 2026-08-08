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
//
// Freshness has to answer two different questions, so it states both explicitly:
//   Updated      — when this dashboard was last rebuilt (metadata.generated_at,
//                  written in UTC by src/refresh_dashboard.py on the runner)
//   Data through — the last month-end the composite actually scores
// These are NOT the same date: the refresh runs daily, but a month only closes
// once its last binding release (core PCE, ~27th of the following month) lands.
// The old footer rendered `generated_at` at month resolution ("refreshed Jul
// 2026"), which made a months-stale deployment indistinguishable from a fresh
// one — the single most misleading thing on the page.
export function footerText(metadata) {
  const fmtDay = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleString("default", {
      day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
    });
  };
  const fmtMonth = (iso) => {
    const [y, m] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("default", { month: "short", year: "numeric", timeZone: "UTC" });
  };

  const parts = [];
  if (metadata.generated_at) {
    const [date, time] = metadata.generated_at.split(" ");
    parts.push(`Updated: ${fmtDay(date)}${time ? ` ${time}` : ""} UTC`);
  }
  parts.push(`Data through: ${fmtMonth(metadata.data_through)} (month-end ${metadata.data_through})`);
  // Mirrors the cron in .github/workflows/mrs-full-refresh.yml. UTC is the
  // honest unit — GitHub cron does not shift for DST, so the ET equivalent
  // moves an hour twice a year and is given as an approximation.
  parts.push(`Scheduled refresh: daily 14:30 UTC (~10:30 AM ET)`);
  parts.push(`MRS ${metadata.version} · ${metadata.n_months} months`);
  return parts.join("  ·  ");
}
