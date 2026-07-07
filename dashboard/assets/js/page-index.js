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
  signed,
  standingWord,
  pillarLabel,
  regimeTrajectory,
  attributionRanked,
  analystSummaryCards,
} from "./narrative.js";
import { similarMonths } from "./analogue.js";

async function main() {
  const [composite, pillarsWide, pillarsLong, regimePeriods, activeFlags, metadata, commentary, forecastInputs, indicatorsWide] = await Promise.all([
    loadJSON("composite_history.json"),
    loadJSON("pillars_wide.json"),
    loadJSON("pillars_long.json"),
    loadJSON("regime_periods.json"),
    loadJSON("active_flags.json"),
    loadJSON("metadata.json"),
    loadJSON("commentary.json").catch(() => ({})),
    loadJSON("forecast_inputs.json").catch(() => null),
    loadJSON("indicators_wide.json").catch(() => null),
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
  renderDataCalendar(metadata);
  renderForecastInputs(forecastInputs);
  contributionChart("drivers-chart", pillarsWide.slice(-24));
  renderAnalogues(indicatorsWide, composite, metadata);

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
    { tone: "neutral", label: "Breadth", value: `${(latest.diffusion * 100).toFixed(0)}%`, sub: `${posCount} of 13 positive · ${latest.breadth_check ?? "n/a"}`, href: "trend.html" },
    { tone: "neutral", label: "Regime age", value: `${latest.months_in_regime} mo`, sub: `${regime} since ${since}` },
    { tone: "warn", label: "To downgrade", value: `${latest.dist_to_downgrade != null ? latest.dist_to_downgrade.toFixed(2) : "–"} z`, sub: `→ ${below}`, href: "scenario.html" },
    { tone: activeFlags.length ? "neg" : "pos", label: "Active flags", value: `${activeFlags.length}`, sub: flagSummary(activeFlags), href: "trend.html" },
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

  // Show the most recent hand-authored note at or before the anchor month
  // (carried forward at most 2 months, labelled with its own date, so a
  // fresh data month doesn't silently drop the analyst's context).
  const noteDates = Object.keys(commentary || {}).filter((d) => d <= latest.date).sort();
  const noteDate = noteDates[noteDates.length - 1];
  const monthsOld = noteDate
    ? (+latest.date.slice(0, 4) - +noteDate.slice(0, 4)) * 12 + (+latest.date.slice(5, 7) - +noteDate.slice(5, 7))
    : null;
  if (noteDate && monthsOld <= 2 && commentary[noteDate]?.analyst_note) {
    const meta = commentary[noteDate];
    const by = meta.author ? ` — ${meta.author}${meta.as_of ? `, ${meta.as_of}` : ""}` : "";
    const carried = monthsOld > 0 ? ` (written for ${noteDate.slice(0, 7)})` : "";
    const el = document.getElementById("analyst-note");
    el.innerHTML = `<span class="note-tag">Analyst note${by}${carried}</span><p>${meta.analyst_note}</p>`;
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

// --- data release countdown (simplified — calendar moved to forecast-inputs-table) ---

function renderDataCalendar(metadata) {
  const dataThrough = new Date(metadata.data_through);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pendingYear  = dataThrough.getMonth() === 11 ? dataThrough.getFullYear() + 1 : dataThrough.getFullYear();
  const pendingMonth = (dataThrough.getMonth() + 1) % 12;
  const pendingEnd   = new Date(pendingYear, pendingMonth + 1, 0);

  const nextPM  = pendingMonth === 11 ? 0 : pendingMonth + 1;
  const nextPY  = pendingMonth === 11 ? pendingYear + 1 : pendingYear;
  const nextPEnd = new Date(nextPY, nextPM + 1, 0);
  const nextPLabel = new Date(nextPY, nextPM, 1).toLocaleString("default", { month: "short", year: "numeric" });

  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function firstFriday(y, m) {
    const d = new Date(y, m, 1);
    d.setDate(1 + ((5 - d.getDay() + 7) % 7));
    return d;
  }
  function daysTo(d) { return Math.ceil((d - today) / 86400000); }

  const bindingReleases = [
    { name: `Core PCE (${new Date(pendingYear, pendingMonth, 1).toLocaleString("default", { month: "short", year: "numeric" })})`, date: addDays(pendingEnd, 28) },
    { name: `Core PCE (${nextPLabel})`, date: addDays(nextPEnd, 28) },
    { name: `NFP (${nextPLabel})`,      date: firstFriday(nextPY, nextPM) },
  ];

  const nextBinding = bindingReleases.find((r) => daysTo(r.date) > 0);
  const el = document.getElementById("update-countdown");
  if (!el) return;
  if (nextBinding) {
    const d = daysTo(nextBinding.date);
    el.textContent = `next MRS update in ${d} day${d === 1 ? "" : "s"} · ${nextBinding.name}`;
  } else {
    el.textContent = "update available — run update_mrs.py";
  }
}

// --- forecast inputs table ---------------------------------------------------

function renderForecastInputs(forecastData) {
  const el = document.getElementById("forecast-inputs-table");
  if (!el || !forecastData) return;

  const indicators = forecastData.indicators || forecastData;
  const asOf = forecastData.as_of || "";

  const PILLAR_ORDER = ["growth", "credit", "stress", "inflation", "liquidity"];
  const STATUS_LABELS = {
    consensus_forecast: "Consensus",
    simulated:          "Simulated",
    market_implied:     "Market-implied",
  };

  const fmtDate = (s) => s ? s.slice(0, 7) : "—";
  const fmtNext = (s) => {
    if (!s) return "—";
    const d = new Date(s);
    return d.toLocaleDateString("default", { month: "short", day: "numeric" });
  };

  let rows = "";
  for (const pid of PILLAR_ORDER) {
    const pillarInds = Object.entries(indicators).filter(([, v]) => v.pillar === pid);
    if (!pillarInds.length) continue;
    const meta = PILLARS[pid];
    rows += `<tr class="fi-pillar-row"><td colspan="8" style="background:color-mix(in srgb,${meta.color} 12%,#fff);color:${meta.color};font-weight:600;font-size:0.78rem;padding:0.35rem 0.6rem;letter-spacing:0.04em">${meta.label.toUpperCase()}</td></tr>`;

    for (const [code, ind] of pillarInds) {
      const statusLabel = STATUS_LABELS[ind.status] || ind.status || "—";
      const statusClass = ind.status === "consensus_forecast" ? "fi-status-consensus"
                        : ind.status === "simulated"          ? "fi-status-sim"
                        : "fi-status-market";
      const baselineBadge = ind.in_baseline
        ? `<span class="fi-badge fi-badge-yes">MRS</span>`
        : `<span class="fi-badge fi-badge-no">—</span>`;

      rows += `<tr>
        <td class="fi-ind-name">${ind.label}</td>
        <td class="num fi-actual">${fmtDate(ind.latest_actual_date)}</td>
        <td class="num fi-actual-val">${ind.latest_actual_raw || "—"}</td>
        <td class="fi-next-rel">${fmtNext(ind.next_release)}</td>
        <td class="fi-forecast">${ind.forecast_raw || "—"}</td>
        <td><span class="fi-status ${statusClass}">${statusLabel}</span></td>
        <td class="fi-baseline-col">${baselineBadge}</td>
        <td class="fi-notes">${ind.notes || ""}</td>
      </tr>`;
    }
  }

  el.innerHTML = `
    ${asOf ? `<p class="fi-as-of">Forecasts as of ${asOf} · all 12-month paths rescored through the MRS indicator → pillar → composite engine on the Scenarios tab</p>` : ""}
    <div class="fi-table-wrap">
      <table class="dtable fi-table">
        <thead><tr>
          <th>Indicator</th>
          <th class="num">Latest</th>
          <th class="num">Value</th>
          <th>Next release</th>
          <th>12m forecast</th>
          <th>Source / Method</th>
          <th>In MRS</th>
          <th>Notes</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// --- what changed ------------------------------------------------------------

function renderWhatChanged(activeFlags, pillarsLong, anchorDate) {
  document.getElementById("direction-summary").textContent = pillarDirectionSummary(pillarsLong, anchorDate);
  document.getElementById("changes-list").innerHTML = flagSentences(activeFlags)
    .map((s) => `<li>${s}</li>`)
    .join("");
}

// --- analogues ---------------------------------------------------------------
// Computed on the full 13-indicator z-vector (cosine similarity), not just the
// composite level — two months can share a composite while looking nothing
// alike underneath. Each analogue reports what actually followed it.

function renderAnalogues(indicatorsWide, composite, metadata) {
  const el = document.getElementById("analogues");
  if (!el || !indicatorsWide) return;

  const anchorRow = indicatorsWide.find((r) => r.date === metadata.data_through);
  if (!anchorRow) return;
  const currentZ = {};
  for (const [code] of Object.entries(anchorRow)) {
    if (code.endsWith("_z") && anchorRow[code] != null) currentZ[code.slice(0, -2)] = +anchorRow[code];
  }

  const fmtMonth = (d) => {
    const [y, m] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("default", { month: "short", year: "numeric", timeZone: "UTC" });
  };

  el.innerHTML = similarMonths(indicatorsWide, composite, currentZ, { n: 3 })
    .map((a) => {
      const outcome = a.fwd12 != null
        ? `Over the following 12 months the composite moved <strong>${signed(a.fwd12)}z</strong>` +
          (a.worst12 && a.worst12.composite < a.composite - 0.05 ? ` (worst point ${signed(a.worst12.composite)}z)` : "") +
          `, ending in <strong>${a.regime12}</strong>.`
        : "Less than 12 months of history followed this point.";
      const curated = a.episode ? ` ${a.episode.note}` : "";
      return `<div class="episode">
        <div class="ep-head">
          <span class="regime-badge sm" style="background:${REGIME_COLORS[a.regime] || "#999"}">${a.regime}</span>
          <strong>${fmtMonth(a.date)}${a.episode ? ` · ${a.episode.name}` : ""}</strong>
          <span class="ep-meta">${(a.sim * 100).toFixed(0)}% indicator-vector match · composite ${signed(a.composite)}z</span>
        </div>
        <p>${outcome}${curated}</p>
      </div>`;
    })
    .join("") +
    `<p class="chart-caption" style="margin-top:0.6rem">Match = cosine similarity of the full 13-indicator z-vector vs today (trailing 12 months excluded).
     <a href="scenario.html">Replay any analogue on the Scenarios tab →</a></p>`;
}

main().catch((err) => {
  document.body.insertAdjacentHTML("beforeend", `<p style="color:#c62828;padding:1rem;">Error loading dashboard: ${err.message}</p>`);
  console.error(err);
});
