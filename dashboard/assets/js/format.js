// Shared formatting helpers used across every page.

export function deltaGlyph(x) {
  if (x == null || Math.abs(x) < 0.05) return "▬";
  return x > 0 ? "▲" : "▼";
}

export function deltaTone(x) {
  if (x == null || Math.abs(x) < 0.05) return "neutral";
  return x > 0 ? "pos" : "neg";
}

export function regimeTone(regime) {
  return { Expansion: "pos", Neutral: "neutral", Slowdown: "warn", Contraction: "neg" }[regime] || "neutral";
}

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
