import { loadJSON } from "./data.js";
import { queryParam } from "./router.js";
import { PILLARS, INDICATORS } from "./meta.js";
import { pillarScoreChart, regimeBoxPlot } from "./charts.js";
import { regimeGauge } from "./components.js";
import { indicatorTileHTML } from "./tiles.js";
import { setAppbarStatus, renderKPIs, footerText } from "./shell.js";
import { deltaGlyph, deltaTone, ordinal } from "./format.js";
import { pillarReadout, standingWord, signed } from "./narrative.js";

const STANDING_TONE = { favorable: "pos", neutral: "neutral", soft: "warn", stressed: "neg" };

async function main() {
  const id = queryParam("id") || "growth";
  const meta = PILLARS[id];
  if (!meta) {
    document.querySelector("main").insertAdjacentHTML("afterbegin", `<p>Unknown pillar: ${id}</p>`);
    return;
  }

  const [composite, pillarsLong, indicatorsLong, regimePeriods, metadata] = await Promise.all([
    loadJSON("composite_history.json"),
    loadJSON("pillars_long.json"),
    loadJSON("indicators_long.json"),
    loadJSON("regime_periods.json"),
    loadJSON("metadata.json"),
  ]);

  const cLatest = composite[composite.length - 1];
  setAppbarStatus(cLatest, cLatest.regime_confirmed || cLatest.regime_raw, metadata);

  document.title = `MRS — ${meta.label}`;
  document.getElementById("crumb").textContent = `${meta.label} pillar`;
  document.getElementById("pillar-title").textContent = `${meta.label} · ${(meta.weight * 100).toFixed(0)}% weight`;

  const rows = pillarsLong.filter((r) => r.pillar === id).sort((a, b) => a.date.localeCompare(b.date));
  const latest = rows[rows.length - 1];

  renderKPIsFor(latest, meta);
  renderVerdict(latest, meta);
  pillarScoreChart("pillar-chart", pillarsLong, id, regimePeriods);
  regimeBoxPlot("pillar-box", pillarsLong, id);
  renderIndicatorTiles(indicatorsLong, id);
  document.getElementById("pillar-role").textContent =
    `${meta.label} carries a ${(meta.weight * 100).toFixed(0)}% weight in the composite. ${meta.description}`;

  document.getElementById("status-footer").textContent = footerText(metadata);
}

function renderKPIsFor(latest, meta) {
  const standing = standingWord(latest.score);
  renderKPIs("kpi-ribbon", [
    { tone: STANDING_TONE[standing], label: "Pillar z-score", value: signed(latest.score), sub: `${standing} · ${(meta.weight * 100).toFixed(0)}% weight` },
    { tone: deltaTone(latest.score_3m_chg), label: "3-month change", value: `${deltaGlyph(latest.score_3m_chg)} ${Math.abs(latest.score_3m_chg ?? 0).toFixed(2)}`, sub: latest.direction_flag },
    { tone: "neutral", label: "History", value: latest.pctile_expanding != null ? ordinal(Math.round(latest.pctile_expanding)) : "–", sub: "percentile of own history" },
    { tone: "neutral", label: "Within-pillar breadth", value: `${(latest.breadth * 100).toFixed(0)}%`, sub: "of indicators positive" },
    { tone: deltaTone(latest.score_3m_chg), label: "Streak", value: `${latest.streak_months ?? 0} mo`, sub: latest.direction_flag },
    { tone: latest.contribution >= 0 ? "pos" : "neg", label: "Contribution to MRS", value: signed(latest.contribution), sub: "z-units in the composite" },
  ]);
}

function renderVerdict(latest, meta) {
  const r = pillarReadout(latest);
  document.getElementById("pillar-verdict-head").innerHTML = `
    <span class="regime-badge" style="background:${meta.color}">${meta.label}</span>
    <span class="standing standing-${r.standing}">${r.standing}</span>
  `;
  document.getElementById("pillar-gauge").innerHTML = regimeGauge(latest.score, {
    min: -2.5,
    max: 2.5,
    valueLabel: `${signed(latest.score)} z`,
  });
  document.getElementById("pillar-verdict-body").innerHTML = `<p>${r.sentence}</p>`;
}

function renderIndicatorTiles(indicatorsLong, pillarId) {
  const codes = Object.keys(INDICATORS).filter((c) => INDICATORS[c].pillar === pillarId);
  document.getElementById("indicator-tiles").innerHTML = codes
    .map((code) => {
      const series = indicatorsLong
        .filter((r) => r.indicator === code)
        .sort((a, b) => a.date.localeCompare(b.date));
      const latest = series[series.length - 1];
      return indicatorTileHTML(code, latest, series.slice(-36).map((r) => r.z_score));
    })
    .join("");
}

main().catch((err) => {
  document.body.insertAdjacentHTML("beforeend", `<p style="color:#c62828;padding:1rem;">Error: ${err.message}</p>`);
  console.error(err);
});
