import { loadJSON } from "./data.js";
import { queryParam } from "./router.js";
import { INDICATORS, PILLARS } from "./meta.js";
import { indicatorDualChart } from "./charts.js";
import { regimeGauge } from "./components.js";
import { setAppbarStatus, renderKPIs, footerText } from "./shell.js";
import { deltaGlyph, deltaTone, ordinal } from "./format.js";
import { standingWord, signed } from "./narrative.js";

const STANDING_TONE = { favorable: "pos", neutral: "neutral", soft: "warn", stressed: "neg" };

async function main() {
  const code = queryParam("id") || "g_nfp";
  const meta = INDICATORS[code];
  if (!meta) {
    document.querySelector("main").insertAdjacentHTML("afterbegin", `<p>Unknown indicator: ${code}</p>`);
    return;
  }

  const [composite, indicatorsLong, metadata] = await Promise.all([
    loadJSON("composite_history.json"),
    loadJSON("indicators_long.json"),
    loadJSON("metadata.json"),
  ]);

  const cLatest = composite[composite.length - 1];
  setAppbarStatus(cLatest, cLatest.regime_confirmed || cLatest.regime_raw, metadata);

  const pillarMeta = PILLARS[meta.pillar];
  const rows = indicatorsLong.filter((r) => r.indicator === code).sort((a, b) => a.date.localeCompare(b.date));
  const latest = rows[rows.length - 1];
  const standing = standingWord(latest.z_score);

  document.title = `MRS — ${meta.label}`;
  document.getElementById("indicator-title").textContent = meta.label;
  document.getElementById("crumb").textContent = meta.label;
  const back = document.getElementById("back-link");
  back.href = `pillar.html?id=${meta.pillar}`;
  back.textContent = `← ${pillarMeta.label} pillar`;

  renderKPIs("kpi-ribbon", [
    { tone: STANDING_TONE[standing], label: "z-score", value: signed(latest.z_score), sub: `${standing} reading` },
    { tone: deltaTone(latest.z_3m_chg), label: "3-month change", value: `${deltaGlyph(latest.z_3m_chg)} ${Math.abs(latest.z_3m_chg ?? 0).toFixed(2)}`, sub: latest.direction_flag },
    { tone: "neutral", label: "History", value: latest.pctile_expanding != null ? ordinal(Math.round(latest.pctile_expanding)) : "–", sub: "percentile of own history" },
    { tone: "neutral", label: "Raw value", value: latest.raw_value != null ? latest.raw_value.toFixed(2) : "–", sub: `as of ${latest.date}` },
    { tone: deltaTone(latest.z_3m_chg), label: "Streak", value: `${latest.streak_months ?? 0} mo`, sub: latest.direction_flag },
    { tone: "neutral", label: "Pillar", value: pillarMeta.label, sub: `${(pillarMeta.weight * 100).toFixed(0)}% of composite` },
  ]);

  document.getElementById("ind-verdict-head").innerHTML = `
    <span class="regime-badge" style="background:${pillarMeta.color}">${pillarMeta.label}</span>
    <span class="standing standing-${standing}">${standing}</span>
  `;
  document.getElementById("ind-gauge").innerHTML = regimeGauge(latest.z_score, { min: -3, max: 3, valueLabel: `${signed(latest.z_score)} z` });
  document.getElementById("ind-verdict-body").innerHTML =
    `<p>${meta.label} is ${standing} at z ${signed(latest.z_score)} — the ${latest.pctile_expanding != null ? ordinal(Math.round(latest.pctile_expanding)) : "–"} percentile of its own history — and ${latest.direction_flag} over the last 3 months.</p>`;

  indicatorDualChart("indicator-chart", indicatorsLong, code);

  const signNote =
    meta.sign === "+"
      ? "the raw-to-z transform preserves direction"
      : "the raw-to-z transform flips direction";

  document.getElementById("lineage").innerHTML = `
    <dt>Pillar</dt><dd><a href="pillar.html?id=${meta.pillar}">${pillarMeta.label}</a> · ${(pillarMeta.weight * 100).toFixed(0)}% of composite</dd>
    <dt>Source</dt><dd>${meta.source}</dd>
    <dt>Transformation</dt><dd>${meta.transform}</dd>
    <dt>Sign</dt><dd>${meta.sign} — ${signNote}, so a positive z always means a supportive reading</dd>
    <dt>Latest data date</dt><dd>${latest.date}</dd>
  `;

  document.getElementById("status-footer").textContent = footerText(metadata);
}

main().catch((err) => {
  document.body.insertAdjacentHTML("beforeend", `<p style="color:#c62828;padding:1rem;">Error: ${err.message}</p>`);
  console.error(err);
});
