import { loadJSON } from "./data.js";
import { INDICATORS, PILLARS } from "./meta.js";
import { indicatorHeatmap } from "./charts.js";
import { REGIME_COLORS } from "./regime.js";
import { setAppbarStatus, renderKPIs, footerText } from "./shell.js";
import { deltaGlyph, deltaTone, regimeTone } from "./format.js";
import { signed, pillarLabel, trendPhrase } from "./narrative.js";

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
  const marketLeadDate = indicatorsWide[indicatorsWide.length - 1]?.date;
  const hasLead = marketLeadDate && marketLeadDate > metadata.data_through;

  setAppbarStatus(latest, regime, metadata);
  renderKPIs("kpi-ribbon", [
    { tone: regimeTone(regime), label: "Regime", value: regime, sub: `${latest.months_in_regime} months`, href: "index.html" },
    { tone: activeFlags.length ? "neg" : "pos", label: "Active flags", value: `${activeFlags.length}`, sub: activeFlags.length ? "see below" : "none" },
    { tone: "neutral", label: "Breadth", value: `${(latest.diffusion * 100).toFixed(0)}%`, sub: latest.breadth_check ?? "no breadth test this month" },
    { tone: "neutral", label: "Curve environment", value: latest.curve_env ?? "–", sub: "10Y–2Y regime" },
    { tone: latest.regime_change_watch ? "warn" : "pos", label: "Regime-change watch", value: latest.regime_change_watch ? "Active" : "Clear", sub: "within 0.10 z of a boundary" },
    { tone: deltaTone(latest.comp_3m_chg), label: "Composite 3m", value: `${deltaGlyph(latest.comp_3m_chg)} ${Math.abs(latest.comp_3m_chg).toFixed(2)}`, sub: latest.direction_flag },
  ]);

  const heat = pillarHeatStats(indicatorsWide);
  const movers = moverRows(indicatorsLong);

  renderVerdict(latest, regime, activeFlags, heat, movers, metadata, hasLead ? marketLeadDate : null);
  renderFlagCards(activeFlags);
  indicatorHeatmap("heatmap", indicatorsWide);
  wireHeatmapDrill();
  renderHeatmapRead(heat, metadata, hasLead ? marketLeadDate : null);
  renderMovers(movers, marketLeadDate, metadata);
  renderTransitions(regimePeriods);

  document.getElementById("status-footer").textContent = footerText(metadata);
}

// --- pillar-level heat statistics (drives the verdict + heatmap read) ---------

function pillarHeatStats(indicatorsWide) {
  const rows = indicatorsWide.slice(-9); // last 3 months vs the prior 6
  const recent = rows.slice(-3);
  const prior = rows.slice(0, 6);
  const avg = (rs, codes) => {
    const vals = rs.flatMap((r) => codes.map((c) => r[`${c}_z`]).filter((v) => v != null));
    return vals.length ? vals.reduce((s, v) => s + +v, 0) / vals.length : null;
  };
  const stats = Object.keys(PILLARS).map((pid) => {
    const codes = Object.keys(INDICATORS).filter((c) => INDICATORS[c].pillar === pid);
    const now = avg(recent, codes);
    const before = avg(prior, codes);
    return { pillar: pid, label: pillarLabel(pid), now, chg: now != null && before != null ? now - before : null };
  }).filter((s) => s.now != null);
  stats.sort((a, b) => a.now - b.now);
  return {
    worst: stats[0],
    best: stats[stats.length - 1],
    warming: [...stats].sort((a, b) => (b.chg ?? 0) - (a.chg ?? 0))[0],
    cooling: [...stats].sort((a, b) => (a.chg ?? 0) - (b.chg ?? 0))[0],
    all: stats,
  };
}

function moverRows(indicatorsLong, n = 10) {
  const latestDate = indicatorsLong.reduce((max, r) => (r.date > max ? r.date : max), "");
  const latestRows = indicatorsLong.filter((r) => r.date === latestDate && r.z_3m_chg != null);
  return [...latestRows].sort((a, b) => Math.abs(b.z_3m_chg) - Math.abs(a.z_3m_chg)).slice(0, n);
}

// --- the verdict: what the trend layer says this month -------------------------

function renderVerdict(latest, regime, activeFlags, heat, movers, metadata, marketLeadDate) {
  const out = [];

  out.push(`The composite is ${trendPhrase(latest)} in <strong>${regime}</strong>, with breadth at ${(latest.diffusion * 100).toFixed(0)}% of indicators positive${latest.breadth_check ? ` (${latest.breadth_check})` : ""}.`);

  if (activeFlags.length) {
    const det = activeFlags.filter((f) => f.flag.includes("deterioration"));
    const imp = activeFlags.filter((f) => f.flag.includes("improvement"));
    const name = (f) => f.level === "indicator" ? (INDICATORS[f.name]?.label ?? f.name) : `${pillarLabel(f.name)} pillar`;
    const parts = [];
    if (det.length) parts.push(`<strong>${det.length} deterioration</strong> (${det.map(name).join(", ")})`);
    if (imp.length) parts.push(`<strong>${imp.length} improvement</strong> (${imp.map(name).join(", ")})`);
    out.push(`${activeFlags.length} warning flag${activeFlags.length > 1 ? "s are" : " is"} active: ${parts.join("; ")}.`);
  } else {
    out.push(`No warning flags are active — no indicator has sustained a ±0.25z six-month move for three straight months.`);
  }

  if (heat.worst && heat.best) {
    out.push(`On the heatmap, <strong>${heat.worst.label}</strong> is the deepest-red row (3-month average z ${signed(heat.worst.now)}); <strong>${heat.best.label}</strong> is the strongest (${signed(heat.best.now)}).` +
      (heat.warming?.chg > 0.15 ? ` <strong>${heat.warming.label}</strong> is warming fastest (${signed(heat.warming.chg)} vs the prior half-year).` : "") +
      (heat.cooling?.chg < -0.15 ? ` <strong>${heat.cooling.label}</strong> is cooling fastest (${signed(heat.cooling.chg)}).` : ""));
  }

  if (movers.length) {
    const m = movers[0];
    out.push(`Biggest 3-month mover: <strong>${INDICATORS[m.indicator]?.label ?? m.indicator}</strong> at ${signed(m.z_3m_chg)}z (now ${signed(m.z_score)}z).`);
  }

  if (marketLeadDate) {
    out.push(`<span class="vintage-chip">market-lead</span> Market-priced indicators run through ${marketLeadDate.slice(0, 7)}; the confirmed composite is anchored to ${metadata.data_through.slice(0, 7)} while macro releases catch up.`);
  }

  document.getElementById("trend-verdict").innerHTML = out.map((s) => `<p>${s}</p>`).join("");
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
      const isInd = f.level === "indicator";
      const name = isInd ? INDICATORS[f.name]?.label ?? f.name : `${PILLARS[f.name]?.label ?? f.name} pillar`;
      const href = isInd ? `indicator.html?id=${f.name}` : `pillar.html?id=${f.name}`;
      return `<a class="flag-card ${improving ? "up" : "down"}" href="${href}" style="text-decoration:none;color:inherit">
        <div class="fc-top"><span class="fc-tag">${f.level}</span><span class="fc-mag">${signed(f.magnitude)}<i>6m Δz</i></span></div>
        <div class="fc-name">${name}</div>
        <div class="fc-sub">${f.flag} · click to drill in</div>
      </a>`;
    })
    .join("");
}

// --- heatmap: generated read + click-to-drill ----------------------------------

function renderHeatmapRead(heat, metadata, marketLeadDate) {
  const el = document.getElementById("heatmap-read");
  if (!el || !heat.worst) return;
  const rank = heat.all.map((s) => `${s.label} ${signed(s.now)}`).join(" · ");
  el.innerHTML =
    `Reading the rows (3-month average z): ${rank}. ` +
    `<strong>${heat.worst.label}</strong> is carrying the red; <strong>${heat.best.label}</strong> the green.` +
    (marketLeadDate ? ` Columns after ${metadata.data_through.slice(0, 7)} are market-lead — macro rows (GDP, PCE, payrolls-adjacent) are blank there until released.` : "");
}

function wireHeatmapDrill() {
  const div = document.getElementById("heatmap");
  if (!div || !div.on) return;
  const codeByLabel = Object.fromEntries(Object.entries(INDICATORS).map(([code, m]) => [m.label, code]));
  div.on("plotly_click", (ev) => {
    const label = ev.points?.[0]?.y;
    const code = codeByLabel[label];
    if (code) window.location.href = `indicator.html?id=${code}`;
  });
}

// --- movers ---------------------------------------------------------------------

function renderMovers(sorted, anchorDate, metadata) {
  const rows = sorted
    .map(
      (r) => `<tr>
        <td><a href="indicator.html?id=${r.indicator}">${INDICATORS[r.indicator]?.label ?? r.indicator}</a></td>
        <td><a href="pillar.html?id=${r.pillar}" style="color:inherit">${PILLARS[r.pillar]?.label ?? r.pillar}</a></td>
        <td class="num tone-${deltaTone(r.z_3m_chg)}">${deltaGlyph(r.z_3m_chg)} ${signed(r.z_3m_chg)}</td>
        <td class="num">${r.z_score != null ? signed(r.z_score) : "–"}</td>
      </tr>`
    )
    .join("");
  document.getElementById("movers-table").innerHTML =
    `<tr><th>Indicator</th><th>Pillar</th><th class="num">3m Δz</th><th class="num">Current z</th></tr>${rows}`;

  const sub = document.getElementById("movers-sub");
  if (sub && anchorDate) {
    sub.innerHTML = `largest 3-month z-score changes · as of ${anchorDate.slice(0, 7)}` +
      (anchorDate > metadata.data_through ? `<span class="vintage-chip">market-lead</span>` : "");
  }

  const read = document.getElementById("movers-read");
  if (read && sorted.length) {
    const up = sorted.filter((r) => r.z_3m_chg > 0.1).length;
    const down = sorted.filter((r) => r.z_3m_chg < -0.1).length;
    const m = sorted[0];
    read.innerHTML = `Of the ten largest moves, <strong>${down} deteriorated</strong> and <strong>${up} improved</strong>. ` +
      `<strong>${INDICATORS[m.indicator]?.label ?? m.indicator}</strong> leads (${signed(m.z_3m_chg)}z in 3 months) — click any row to see the raw series behind the move.`;
  }
}

// --- regime transitions -----------------------------------------------------------

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

  const read = document.getElementById("transitions-read");
  if (read && regimePeriods.length > 1) {
    const cur = regimePeriods[regimePeriods.length - 1];
    const lens = regimePeriods.map((p) => p.n_months).sort((a, b) => a - b);
    const median = lens[Math.floor(lens.length / 2)];
    const longer = regimePeriods.filter((p) => p.n_months > cur.n_months).length;
    read.innerHTML = `The current <strong>${cur.regime}</strong> spell is <strong>${cur.n_months} months</strong> old — ` +
      (longer === 0 ? `the longest of the ${regimePeriods.length} spells in the sample` : `longer than all but ${longer} of the ${regimePeriods.length} spells in the sample`) +
      ` (median spell: ${median} months). Long spells end on evidence, not age — see the regime-change watch in the ribbon above.`;
  }
}

main().catch((err) => {
  document.body.insertAdjacentHTML("beforeend", `<p style="color:#c62828;padding:1rem;">Error: ${err.message}</p>`);
  console.error(err);
});
