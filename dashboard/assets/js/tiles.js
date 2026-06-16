// Evidence tiles — the core "show, don't just tell" component. Each tile shows
// the current value, the recent move, a sparkline, where it sits in its own
// history, and its contribution, before any one-line label. Used for pillars on
// the overview and for member indicators on the pillar page.

import { sparkline, distBar, contribBar } from "./spark.js";
import { PILLARS, INDICATORS } from "./meta.js";
import { standingWord, signed } from "./narrative.js";
import { deltaGlyph, deltaTone, ordinal } from "./format.js";

// Pillar tile (overview). `row` = latest pillars_long row; `series` = score history.
// `opts.rankBadge` ("Top support" | "Biggest drag") flags the extremes of the
// current attribution ranking so the strongest support and biggest drag are
// identifiable at a glance, not just by reading every contribution bar.
export function pillarTileHTML(id, row, series, opts = {}) {
  const meta = PILLARS[id];
  const standing = standingWord(row.score);
  const delta = row.score_3m_chg;
  const spark = sparkline(series, { width: 200, height: 34, color: meta.color });
  const badge = opts.rankBadge ? `<span class="rank-badge rank-${opts.rankBadge.tone}">${opts.rankBadge.text}</span>` : "";
  // Dynamic note: if caller supplies an interpretation, use it; otherwise fall
  // back to the static indicator list so the tile is still useful standalone.
  const note = opts.note
    || `${meta.description} Currently <strong>${standing}</strong> (z ${signed(row.score)}, ${row.direction_flag}), with ${(row.breadth * 100).toFixed(0)}% of its indicators positive.`;

  return `<a class="ptile standing-bg-${standing}" href="pillar.html?id=${id}" style="--pc:${meta.color}">
    <div class="ptile-head">
      <span class="ptile-name">${meta.label}<i>${(meta.weight * 100).toFixed(0)}%</i></span>
      <span class="standing standing-${standing}">${standing}</span>
    </div>
    ${badge}
    <div class="ptile-metric">
      <span class="ptile-z">${signed(row.score)}</span>
      <span class="ptile-delta tone-${deltaTone(delta)}">${deltaGlyph(delta)} ${Math.abs(delta ?? 0).toFixed(2)} <i>3m</i></span>
    </div>
    <div class="ptile-spark">${spark}</div>
    <dl class="ptile-evidence">
      <div><dt>History</dt><dd>${distBar(row.pctile_expanding)}<b>${row.pctile_expanding != null ? ordinal(Math.round(row.pctile_expanding)) + " pct" : "–"}</b></dd></div>
      <div><dt>Contribution</dt><dd>${contribBar(row.contribution)}<b>${signed(row.contribution)}</b></dd></div>
      <div><dt>Breadth</dt><dd class="plain"><b>${(row.breadth * 100).toFixed(0)}%</b> of indicators positive · ${row.direction_flag}</dd></div>
    </dl>
    <p class="ptile-note">${note}</p>
  </a>`;
}

// Indicator tile (pillar page member grid). `row` = latest indicators_long row;
// `series` = z-score history.
export function indicatorTileHTML(code, row, series) {
  const meta = INDICATORS[code];
  const pColor = PILLARS[meta.pillar].color;
  const standing = standingWord(row.z_score);
  const delta = row.z_3m_chg;
  const spark = sparkline(series, { width: 200, height: 34, color: pColor });
  const signNote = meta.sign === "+" ? "higher = better" : "lower = better";

  return `<a class="ptile" href="indicator.html?id=${code}" style="--pc:${pColor}">
    <div class="ptile-head">
      <span class="ptile-name">${meta.label}</span>
      <span class="standing standing-${standing}">${standing}</span>
    </div>
    <div class="ptile-metric">
      <span class="ptile-z">${signed(row.z_score)}</span>
      <span class="ptile-delta tone-${deltaTone(delta)}">${deltaGlyph(delta)} ${Math.abs(delta ?? 0).toFixed(2)} <i>3m</i></span>
    </div>
    <div class="ptile-spark">${spark}</div>
    <dl class="ptile-evidence">
      <div><dt>History</dt><dd>${distBar(row.pctile_expanding)}<b>${row.pctile_expanding != null ? ordinal(Math.round(row.pctile_expanding)) + " pct" : "–"}</b></dd></div>
      <div><dt>Raw value</dt><dd class="plain"><b>${row.raw_value != null ? row.raw_value.toFixed(2) : "–"}</b> · ${row.direction_flag}</dd></div>
      <div><dt>Convention</dt><dd class="plain">${meta.source} · ${signNote}</dd></div>
    </dl>
    <p class="ptile-note">${meta.transform}</p>
  </a>`;
}
