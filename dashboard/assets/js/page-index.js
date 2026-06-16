import { loadJSON } from "./data.js";
import { REGIME_COLORS } from "./regime.js";
import { compositeChart, contributionChart } from "./charts.js";
import { regimeGauge, regimeLegend, momentumStrip, thresholdReadout } from "./components.js";
import { pillarTileHTML } from "./tiles.js";
import { setAppbarStatus, renderKPIs, footerText } from "./shell.js";
import { deltaGlyph, deltaTone, regimeTone, ordinal } from "./format.js";
import { distBar } from "./spark.js";
import { PILLARS } from "./meta.js";
import {
  REGIME_DEFS,
  REGIME_BELOW,
  verdictSentences,
  flagSentences,
  pillarDirectionSummary,
  nearestEpisodes,
  signed,
  standingWord,
  pillarLabel,
  regimeTrajectory,
  attributionRanked,
  analystSummaryCards,
} from "./narrative.js";

async function main() {
  const [composite, pillarsWide, pillarsLong, regimePeriods, activeFlags, metadata, commentary] = await Promise.all([
    loadJSON("composite_history.json"),
    loadJSON("pillars_wide.json"),
    loadJSON("pillars_long.json"),
    loadJSON("regime_periods.json"),
    loadJSON("active_flags.json"),
    loadJSON("metadata.json"),
    loadJSON("commentary.json").catch(() => ({})),
  ]);

  const latest = composite[composite.length - 1];
  const regime = latest.regime_confirmed || latest.regime_raw;
  const currentPeriod = regimePeriods[regimePeriods.length - 1];
  const ranked = attributionRanked(pillarsLong, latest.date);

  setAppbarStatus(latest, regime, metadata);
  renderOverviewKPIs(latest, regime, currentPeriod, activeFlags);

  // Composite anchor: score/regime/momentum header, the chart itself, then a
  // foot row of percentile / breadth / distance-to-threshold evidence.
  renderCompositeReadout(latest, regime, currentPeriod);
  compositeChart("composite-chart", composite, regimePeriods, { showNBER: true });
  renderCompositeFoot(latest, regime);

  // Regime status: gauge + plain-language interpretation of the regime itself.
  renderRegimeStatus(latest, regime);

  // Pillar movement & attribution: contribution + multi-horizon momentum per pillar.
  renderPillarMovement(pillarsLong, latest.date, ranked);

  // Analyst summary: structured, data-grounded bullets + the hand-authored note.
  renderAnalystSummary(latest, pillarsLong, activeFlags, regime, commentary);

  renderPillarTiles(pillarsLong, latest.date, ranked);
  renderWhatChanged(activeFlags, pillarsLong, latest.date);
  contributionChart("drivers-chart", pillarsWide.slice(-24));
  renderAnalogues(latest.composite);

  document.getElementById("status-footer").textContent = footerText(metadata);
}

// --- KPI ribbon --------------------------------------------------------------

function renderOverviewKPIs(latest, regime, period, activeFlags) {
  const since = period ? period.start_date.slice(0, 7) : "–";
  const posCount = Math.round((latest.diffusion || 0) * 13);
  const below = REGIME_BELOW[regime] || "—";

  renderKPIs("kpi-ribbon", [
    { tone: regimeTone(regime), label: "Composite MRS", value: latest.display_score.toFixed(2), sub: `z ${signed(latest.composite)} · ${regime}` },
    { tone: deltaTone(latest.comp_3m_chg), label: "3-month change", value: `${deltaGlyph(latest.comp_3m_chg)} ${Math.abs(latest.comp_3m_chg).toFixed(2)}`, sub: latest.direction_flag },
    { tone: "neutral", label: "Breadth", value: `${(latest.diffusion * 100).toFixed(0)}%`, sub: `${posCount} of 13 positive · ${latest.breadth_check ?? "n/a"}` },
    { tone: "neutral", label: "Regime age", value: `${latest.months_in_regime} mo`, sub: `${regime} since ${since}` },
    { tone: "warn", label: "To downgrade", value: `${latest.dist_to_downgrade != null ? latest.dist_to_downgrade.toFixed(2) : "–"} z`, sub: `→ ${below}` },
    { tone: activeFlags.length ? "neg" : "pos", label: "Active flags", value: `${activeFlags.length}`, sub: flagSummary(activeFlags) },
  ]);
}

function flagSummary(flags) {
  if (!flags.length) return "none";
  const names = flags.map((f) => f.name.replace(/_/g, " ")).slice(0, 3);
  return names.join(", ") + (flags.length > 3 ? "…" : "");
}

// --- composite anchor: readout + foot ----------------------------------------

function renderCompositeReadout(latest, regime, period) {
  const traj = regimeTrajectory(latest);
  const since = period ? period.start_date.slice(0, 7) : "–";

  document.getElementById("composite-readout").innerHTML = `
    <div class="cr-main">
      <div class="cr-score">
        <span class="cr-value">${latest.display_score.toFixed(2)}</span><span class="cr-unit">/5</span>
        <span class="cr-z">z ${signed(latest.composite)}</span>
      </div>
      <div class="cr-regime">
        <span class="regime-badge" style="background:${REGIME_COLORS[regime] || "#999"}">${regime}</span>
        <span class="cr-traj tone-${traj.tone}">${traj.glyph} ${traj.word}</span>
        <span class="cr-age">month ${latest.months_in_regime} of this regime · since ${since}</span>
      </div>
    </div>
    <div class="cr-momentum">
      <div class="cr-momentum-label">Momentum (z-chg)</div>
      <div class="momentum-strip">${momentumStrip(latest)}</div>
    </div>
  `;
}

function renderCompositeFoot(latest, regime) {
  const posCount = Math.round((latest.diffusion || 0) * 13);
  const breadthNote = latest.breadth_check === "confirmed" ? "confirmed" : latest.breadth_check === "narrow" ? "narrow" : "n/a";

  document.getElementById("composite-foot").innerHTML = `
    <div class="cf-item">
      <div class="cf-label">History percentile</div>
      <div class="cf-row">${distBar(latest.pctile_expanding)}<b>${latest.pctile_expanding != null ? ordinal(Math.round(latest.pctile_expanding)) + " pct" : "–"}</b></div>
    </div>
    <div class="cf-item">
      <div class="cf-label">Breadth (diffusion)</div>
      <div class="cf-row">${distBar(latest.diffusion * 100)}<b>${(latest.diffusion * 100).toFixed(0)}%</b></div>
      <div class="cf-sub">${posCount} of 13 indicators positive · ${breadthNote}</div>
    </div>
    <div class="cf-item cf-thresholds">
      <div class="cf-label">Distance to next regime</div>
      <div class="thr-row">${thresholdReadout(latest, regime)}</div>
    </div>
  `;
}

// --- regime status (interpretation) -------------------------------------------

function renderRegimeStatus(latest, regime) {
  const traj = regimeTrajectory(latest);

  document.getElementById("verdict-head").innerHTML = `
    <span class="regime-badge" style="background:${REGIME_COLORS[regime] || "#999"}">${regime}</span>
    <span class="cr-traj tone-${traj.tone}">${traj.glyph} ${traj.word}</span>
    <span class="vh-plain">${REGIME_DEFS[regime].plain}</span>
  `;

  document.getElementById("hero-gauge").innerHTML = regimeGauge(latest.composite, {
    min: -2.2,
    max: 1.3,
    valueLabel: `${signed(latest.composite)} z`,
  });

  document.getElementById("verdict-body").innerHTML = verdictSentences(latest)
    .map((s) => `<p>${s}</p>`)
    .join("");

  document.getElementById("regime-legend").innerHTML = regimeLegend(REGIME_DEFS, regime);
}

// --- pillar movement & attribution --------------------------------------------

function renderPillarMovement(pillarsLong, anchorDate, ranked) {
  const byId = Object.fromEntries(
    pillarsLong.filter((r) => r.date === anchorDate).map((r) => [r.pillar, r])
  );

  const delta = (v) => {
    if (v == null) return `<span class="tone-neutral">–</span>`;
    return `<span class="tone-${deltaTone(v)}">${deltaGlyph(v)} ${Math.abs(v).toFixed(2)}</span>`;
  };

  const rows = ranked
    .filter((r) => byId[r.pillar])
    .map((r) => {
      const row = byId[r.pillar];
      const meta = PILLARS[r.pillar];
      const standing = standingWord(row.score);
      const streak = row.streak_months > 1 ? ` <span class="tbl-streak">${row.streak_months}mo</span>` : "";
      return `<tr>
        <td><strong>${meta.label}</strong> <span class="tbl-weight">${(meta.weight * 100).toFixed(0)}%</span></td>
        <td><span class="standing standing-${standing}">${standing}</span></td>
        <td class="num">${signed(row.score)}</td>
        <td class="num tone-${deltaTone(row.contribution)}">${signed(row.contribution, 3)}</td>
        <td class="num">${delta(row.score_3m_chg)}</td>
        <td class="num">${delta(row.score_6m_chg)}</td>
        <td class="num">${delta(row.score_12m_chg)}</td>
        <td><span class="tbl-dir dir-${row.direction_flag}">${row.direction_flag}</span>${streak}</td>
      </tr>`;
    })
    .join("");

  document.getElementById("attribution-chart").innerHTML = `
    <table class="dtable pmov-table">
      <thead><tr>
        <th>Pillar</th>
        <th>Standing</th>
        <th class="num">Score</th>
        <th class="num">Contribution</th>
        <th class="num">3M Δ</th>
        <th class="num">6M Δ</th>
        <th class="num">12M Δ</th>
        <th>Trend</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  const support = ranked.find((r) => byId[r.pillar] && r.contribution > 0);
  const drag = [...ranked].reverse().find((r) => byId[r.pillar] && r.contribution < 0);
  const parts = [];
  if (support) parts.push(`<strong>${support.label}</strong> is the largest support (${signed(support.contribution, 3)} z)`);
  if (drag) parts.push(`<strong>${drag.label}</strong> is the largest drag (${signed(drag.contribution, 3)} z)`);
  document.getElementById("attribution-caption").innerHTML =
    `Ranked by contribution this month · 3M/6M/12M = change in pillar z-score. ` +
    (parts.length ? parts.join("; ") + "." : "");
}

// --- analyst summary -------------------------------------------------------------

function renderAnalystSummary(latest, pillarsLong, activeFlags, regime, commentary) {
  document.getElementById("summary-date").textContent = latest.date.slice(0, 7);

  const cards = analystSummaryCards(latest, pillarsLong, activeFlags, regime, latest.date);
  document.getElementById("summary-grid").innerHTML = cards
    .map((c) => `<div class="sum-card"><h3>${c.title}</h3><ul>${c.items.map((i) => `<li>${i}</li>`).join("")}</ul></div>`)
    .join("");

  const note = commentary?.[latest.date]?.analyst_note;
  if (note) {
    const meta = commentary[latest.date];
    const by = meta.author ? ` — ${meta.author}${meta.as_of ? `, ${meta.as_of}` : ""}` : "";
    const el = document.getElementById("analyst-note");
    el.innerHTML = `<span class="note-tag">Analyst note${by}</span><p>${note}</p>`;
    el.hidden = false;
  }
}

// --- pillar evidence tiles ---------------------------------------------------

function renderPillarTiles(pillarsLong, anchorDate, ranked) {
  const rows = pillarsLong.filter((r) => r.date === anchorDate);
  const byId = Object.fromEntries(rows.map((r) => [r.pillar, r]));
  const order = ranked.map((r) => r.pillar).filter((id) => byId[id]);

  document.getElementById("pillar-tiles").innerHTML = order
    .map((id, i) => {
      let rankBadge = null;
      if (i === 0 && byId[id].contribution > 0) rankBadge = { text: "Top support", tone: "pos" };
      else if (i === order.length - 1 && byId[id].contribution < 0) rankBadge = { text: "Biggest drag", tone: "neg" };
      return pillarTileHTML(id, byId[id], seriesFor(pillarsLong, id, 36), { rankBadge });
    })
    .join("");

  if (order.length) {
    const top = byId[order[0]];
    const bottom = byId[order[order.length - 1]];
    document.getElementById("pillar-evidence-sub").innerHTML =
      `ranked by contribution this month — <strong>${pillarLabel(order[0])}</strong> ${signed(top.contribution, 3)} (top support) ` +
      `→ <strong>${pillarLabel(order[order.length - 1])}</strong> ${signed(bottom.contribution, 3)} (biggest drag)`;
  }
}

function seriesFor(pillarsLong, id, n) {
  return pillarsLong
    .filter((r) => r.pillar === id)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-n)
    .map((r) => r.score);
}

// --- what changed ------------------------------------------------------------

function renderWhatChanged(activeFlags, pillarsLong, anchorDate) {
  document.getElementById("direction-summary").textContent = pillarDirectionSummary(pillarsLong, anchorDate);
  document.getElementById("changes-list").innerHTML = flagSentences(activeFlags)
    .map((s) => `<li>${s}</li>`)
    .join("");
}

// --- analogues ---------------------------------------------------------------

function renderAnalogues(currentComposite) {
  document.getElementById("analogues").innerHTML = nearestEpisodes(currentComposite, 3)
    .map(
      (e) => `<div class="episode">
        <div class="ep-head">
          <span class="regime-badge sm" style="background:${REGIME_COLORS[e.regime.split(" ")[0]] || "#999"}">${e.regime}</span>
          <strong>${e.name}</strong>
          <span class="ep-meta">${e.period} · z ${signed(e.mean)}</span>
        </div>
        <p>${e.note}</p>
      </div>`
    )
    .join("");
}

main().catch((err) => {
  document.body.insertAdjacentHTML("beforeend", `<p style="color:#c62828;padding:1rem;">Error loading dashboard: ${err.message}</p>`);
  console.error(err);
});
