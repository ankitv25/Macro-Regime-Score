import { loadJSON } from "./data.js";
import { INDICATORS, PILLARS } from "./meta.js";
import { indicatorHeatmap } from "./charts.js";
import { REGIME_COLORS } from "./regime.js";
import { setAppbarStatus, renderKPIs, footerText } from "./shell.js";
import { deltaGlyph, deltaTone, regimeTone } from "./format.js";
import { signed } from "./narrative.js";

async function main() {
  const [indicatorsLong, indicatorsWide, activeFlags, regimePeriods, composite, metadata] = await Promise.all([
    loadJSON("indicators_long.json"),
    loadJSON("indicators_wide.json"),
    loadJSON("active_flags.json"),
    loadJSON("regime_periods.json"),
    loadJSON("composite_history.json"),
    loadJSON("metadata.json"),
  ]);

  const latest = composite[composite.length - 1];
  const regime = latest.regime_confirmed || latest.regime_raw;

  setAppbarStatus(latest, regime, metadata);
  renderKPIs("kpi-ribbon", [
    { tone: regimeTone(regime), label: "Regime", value: regime, sub: `${latest.months_in_regime} months` },
    { tone: activeFlags.length ? "neg" : "pos", label: "Active flags", value: `${activeFlags.length}`, sub: activeFlags.length ? "see below" : "none" },
    { tone: "neutral", label: "Breadth", value: `${(latest.diffusion * 100).toFixed(0)}%`, sub: `${latest.breadth_check}` },
    { tone: "neutral", label: "Curve environment", value: latest.curve_env ?? "–", sub: "10Y–2Y regime" },
    { tone: latest.regime_change_watch ? "warn" : "pos", label: "Regime-change watch", value: latest.regime_change_watch ? "Active" : "Clear", sub: "within 0.10 z of a boundary" },
    { tone: deltaTone(latest.comp_3m_chg), label: "Composite 3m", value: `${deltaGlyph(latest.comp_3m_chg)} ${Math.abs(latest.comp_3m_chg).toFixed(2)}`, sub: latest.direction_flag },
  ]);

  renderFlagCards(activeFlags);
  indicatorHeatmap("heatmap", indicatorsWide);
  renderMovers(indicatorsLong);
  renderTransitions(regimePeriods);

  document.getElementById("status-footer").textContent = footerText(metadata);
}

function renderFlagCards(activeFlags) {
  const wrap = document.getElementById("flag-cards");
  if (!activeFlags.length) {
    wrap.innerHTML = `<div class="flag-card ok"><div class="fc-name">No active flags</div><div class="fc-sub">All 13 indicators are steady this month — no deterioration or improvement warnings.</div></div>`;
    return;
  }
  wrap.innerHTML = activeFlags
    .map((f) => {
      const improving = f.flag.includes("improvement");
      const name = f.level === "indicator" ? INDICATORS[f.name]?.label ?? f.name : `${PILLARS[f.name]?.label ?? f.name} pillar`;
      return `<div class="flag-card ${improving ? "up" : "down"}">
        <div class="fc-top"><span class="fc-tag">${f.level}</span><span class="fc-mag">${signed(f.magnitude)}<i>6m Δz</i></span></div>
        <div class="fc-name">${name}</div>
        <div class="fc-sub">${f.flag}</div>
      </div>`;
    })
    .join("");
}

function renderMovers(indicatorsLong, n = 10) {
  const latestDate = indicatorsLong.reduce((max, r) => (r.date > max ? r.date : max), "");
  const latestRows = indicatorsLong.filter((r) => r.date === latestDate && r.z_3m_chg != null);
  const sorted = [...latestRows].sort((a, b) => Math.abs(b.z_3m_chg) - Math.abs(a.z_3m_chg)).slice(0, n);

  const rows = sorted
    .map(
      (r) => `<tr>
        <td><a href="indicator.html?id=${r.indicator}">${INDICATORS[r.indicator]?.label ?? r.indicator}</a></td>
        <td>${PILLARS[r.pillar]?.label ?? r.pillar}</td>
        <td class="num tone-${deltaTone(r.z_3m_chg)}">${deltaGlyph(r.z_3m_chg)} ${signed(r.z_3m_chg)}</td>
        <td class="num">${r.z_score != null ? signed(r.z_score) : "–"}</td>
      </tr>`
    )
    .join("");
  document.getElementById("movers-table").innerHTML =
    `<tr><th>Indicator</th><th>Pillar</th><th class="num">3m Δz</th><th class="num">Current z</th></tr>${rows}`;
}

function renderTransitions(regimePeriods) {
  const rows = regimePeriods
    .slice()
    .reverse()
    .map(
      (p) => `<tr>
        <td><span class="regime-badge sm" style="background:${REGIME_COLORS[p.regime] || "#999"}">${p.regime}</span></td>
        <td>${p.start_date}</td><td>${p.end_date}</td><td class="num">${p.n_months}</td>
      </tr>`
    )
    .join("");
  document.getElementById("transitions-table").innerHTML =
    `<tr><th>Regime</th><th>Start</th><th>End</th><th class="num">Months</th></tr>${rows}`;
}

main().catch((err) => {
  document.body.insertAdjacentHTML("beforeend", `<p style="color:#c62828;padding:1rem;">Error: ${err.message}</p>`);
  console.error(err);
});
