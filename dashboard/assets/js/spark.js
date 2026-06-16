// Tiny dependency-free inline-SVG charts for dense card layouts. Crisper and
// far lighter than a Plotly instance per tile. Pure: values in, SVG string out.

// A line sparkline with an optional zero baseline, area fill, and a dot on the
// latest point. values may contain nulls (gaps are skipped).
export function sparkline(values, opts = {}) {
  const width = opts.width ?? 150;
  const height = opts.height ?? 34;
  const color = opts.color ?? "#1d4ed8";
  const v = values.filter((x) => x != null);
  if (!v.length) return "";

  const lo = opts.min ?? Math.min(...v);
  const hi = opts.max ?? Math.max(...v);
  const range = hi - lo || 1;
  const n = values.length;
  const px = (i) => (n === 1 ? width / 2 : (i / (n - 1)) * width);
  const py = (val) => height - ((val - lo) / range) * (height - 4) - 2;

  let d = "";
  values.forEach((val, i) => {
    if (val == null) return;
    d += (d ? "L" : "M") + px(i).toFixed(1) + " " + py(val).toFixed(1) + " ";
  });

  const zero =
    opts.zeroLine !== false && lo < 0 && hi > 0
      ? `<line x1="0" x2="${width}" y1="${py(0).toFixed(1)}" y2="${py(0).toFixed(1)}" stroke="#cbd5e1" stroke-width="0.75" stroke-dasharray="2 2"/>`
      : "";

  const area = opts.fill !== false
    ? `<path d="${d}L ${width} ${height} L 0 ${height} Z" fill="${color}" opacity="0.07"/>`
    : "";

  let li = -1;
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) { li = i; break; }
  const dot = li >= 0 ? `<circle cx="${px(li).toFixed(1)}" cy="${py(values[li]).toFixed(1)}" r="2.2" fill="${color}"/>` : "";

  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none">${zero}${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>${dot}</svg>`;
}

// A horizontal "where it sits in history" bar: a track from the historical min
// to max with a marker at the current percentile, and a faint neutral midline.
export function distBar(percentile) {
  const p = Math.max(0, Math.min(100, percentile ?? 50));
  return `<div class="distbar"><span class="distbar-mid"></span><i class="distbar-mark" style="left:${p.toFixed(1)}%"></i></div>`;
}

// A centre-anchored contribution bar (z-units): fills right (positive) or left
// (negative) from the middle, scaled to ±scale.
export function contribBar(value, scale = 0.3) {
  const v = value ?? 0;
  const w = Math.min(50, (Math.abs(v) / scale) * 50);
  const side = v >= 0
    ? `left:50%;width:${w.toFixed(1)}%;background:var(--pos)`
    : `right:50%;width:${w.toFixed(1)}%;background:var(--neg)`;
  return `<div class="cbar"><span class="cbar-mid"></span><i style="${side}"></i></div>`;
}
