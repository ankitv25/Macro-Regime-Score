"""
MRS Monthly Update Agent
========================
Single entry point for the complete monthly MRS update cycle.

Run from the repo root:
    python src/update_mrs.py                # full update
    python src/update_mrs.py --skip-pull    # skip FRED pull, use existing raw data
    python src/update_mrs.py --dry-run      # pull + process only, stop before scoring

Pipeline:
    Step 1  Pre-flight   — load current store state (last date, regime, flags)
    Step 2  Pull data    — FRED + Yahoo via pull_mrs_data.py
    Step 3  Input panel  — rebuild monthly panel via process_mrs_inputs.py
    Step 4  Score        — v2.1 engine + monitoring tables via mrs_monitoring_store.py
    Step 5  Checks       — regime change? new flags? drift watch? historical revisions?
    Step 6  Export JSON  — convert MRS_Master.xlsx → dashboard/data/ JSON
    Step 7  Summary      — print current reading + all alerts
"""

import argparse
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

# ── Paths ─────────────────────────────────────────────────────────────────────
REPO_ROOT     = Path(__file__).resolve().parent.parent
SRC_DIR       = REPO_ROOT / "src"
MON_DIR       = REPO_ROOT / "outputs" / "monitoring"
DASH_DATA_DIR = REPO_ROOT / "dashboard" / "data"
COMMENTARY    = DASH_DATA_DIR / "commentary.json"

COMPOSITE_CSV = MON_DIR / "mrs_composite_history.csv"
PILLAR_CSV    = MON_DIR / "mrs_pillar_history.csv"
FLAGS_CSV     = MON_DIR / "mrs_active_flags.csv"

# Governance constants (must match mrs_monitoring_store.py)
DRIFT_BAND  = (0.45, 0.65)   # expanding composite std band — outside = mandatory review
WATCH_DIST  = 0.10           # z-units: composite within this of a threshold = watch flag

REGIME_ORDER = ["Contraction", "Slowdown", "Neutral", "Expansion"]

# ── Console helpers ───────────────────────────────────────────────────────────
def _c(t, code): return f"\033[{code}m{t}\033[0m"
def green(t):  return _c(t, "32")
def yellow(t): return _c(t, "33")
def red(t):    return _c(t, "31")
def bold(t):   return _c(t, "1")
def dim(t):    return _c(t, "2")
def cyan(t):   return _c(t, "36")

def section(title, step=None, total=6):
    tag = f"Step {step} / {total} — " if step else ""
    print(f"\n{bold('━' * 62)}")
    print(f"  {bold(tag + title)}")
    print(bold('━' * 62))

def ok(msg):   print(green(f"  ✓  {msg}"))
def warn(msg): print(yellow(f"  ⚠  {msg}"))
def alert(msg): print(red(f"  ✗  {msg}"))
def info(msg): print(f"     {msg}")


# ── Step runner ───────────────────────────────────────────────────────────────
def run_step(label, script_path, extra_env=None):
    """Run a pipeline script as a subprocess. Exits on failure."""
    print(f"\n  {bold('▶')} {label}")
    env = os.environ.copy()
    env["PYTHONPATH"] = str(SRC_DIR)
    if extra_env:
        env.update(extra_env)
    result = subprocess.run(
        [sys.executable, str(script_path)],
        capture_output=True, text=True, env=env,
        cwd=str(REPO_ROOT),
    )
    if result.returncode != 0:
        alert(f"Script failed: {script_path.name}")
        if result.stderr:
            print(red(result.stderr[-3000:]))
        sys.exit(1)
    # Print the last 8 lines of stdout (skip empty/progress noise)
    lines = [l for l in (result.stdout or "").strip().split("\n") if l.strip()]
    for line in lines[-8:]:
        print(dim(f"    {line}"))
    print(green(f"  ✓  {script_path.name} complete"))
    return result


# ── Step 1: Pre-flight ────────────────────────────────────────────────────────
def preflight():
    """
    Load the existing composite + flags tables so we can compare before/after.
    Returns (composite_df, pillar_df, flags_df) — all None if store is empty.
    """
    if not COMPOSITE_CSV.exists():
        warn("No existing composite history found — this will be a full initial build.")
        return None, None, None

    comp  = pd.read_csv(COMPOSITE_CSV, parse_dates=["date"])
    pillar = pd.read_csv(PILLAR_CSV, parse_dates=["date"]) if PILLAR_CSV.exists() else pd.DataFrame()
    flags  = pd.read_csv(FLAGS_CSV) if FLAGS_CSV.exists() else pd.DataFrame()

    last = comp.iloc[-1]
    regime    = last.get("regime_confirmed", "N/A")
    composite = last.get("composite", float("nan"))
    n_months  = len(comp.dropna(subset=["composite"]))

    info(f"Store ends: {bold(str(last['date'])[:7])}  ({n_months} scored months)")
    info(f"Regime:     {bold(str(regime))}  |  composite z = {bold(f'{composite:+.3f}')}")
    info(f"Active flags in store: {bold(str(len(flags)))}")

    return comp, pillar, flags


# ── Step 5: Post-run checks ───────────────────────────────────────────────────
def post_checks(before_comp, before_flags, after_comp, after_flags):
    """
    Compare the before and after store state. Returns (highlights, alerts).
    highlights = things that look fine / positive.
    alerts     = things requiring attention.
    """
    highlights = []
    alerts     = []

    last = after_comp.iloc[-1]

    # ── New months added ──────────────────────────────────────────────────────
    if before_comp is not None:
        before_dates = set(before_comp["date"].dt.strftime("%Y-%m"))
        after_dates  = set(after_comp["date"].dt.strftime("%Y-%m"))
        new_months   = sorted(after_dates - before_dates)
    else:
        new_months = list(after_comp["date"].dt.strftime("%Y-%m").dropna())

    if new_months:
        highlights.append(green(f"New month(s) appended: {', '.join(new_months)}"))
    else:
        alerts.append(yellow("No new months added — data may not be available yet for this month"))

    # ── Regime change ─────────────────────────────────────────────────────────
    if before_comp is not None and new_months:
        prev_regime = before_comp.iloc[-1].get("regime_confirmed")
        curr_regime = last.get("regime_confirmed")
        if curr_regime != prev_regime:
            prev_idx = REGIME_ORDER.index(str(prev_regime)) if str(prev_regime) in REGIME_ORDER else -1
            curr_idx = REGIME_ORDER.index(str(curr_regime)) if str(curr_regime) in REGIME_ORDER else -1
            direction = "↑ UPGRADE" if curr_idx > prev_idx else "↓ DOWNGRADE"
            alerts.append(red(f"REGIME CHANGE {direction}: {prev_regime} → {curr_regime}"))
        else:
            months_in = last.get("months_in_regime", "?")
            highlights.append(green(f"Regime unchanged: {curr_regime} (month {months_in})"))

    # ── Historical revision check ─────────────────────────────────────────────
    if before_comp is not None:
        common = set(before_comp["date"]).intersection(set(after_comp["date"]))
        b_reg = before_comp.set_index("date")["regime_confirmed"]
        a_reg = after_comp.set_index("date")["regime_confirmed"]
        revisions = [
            d.strftime("%Y-%m") for d in sorted(common)
            if pd.notna(b_reg.get(d)) and pd.notna(a_reg.get(d))
            and b_reg.get(d) != a_reg.get(d)
        ]
        if revisions:
            alerts.append(yellow(f"Historical regime revision(s) detected: {revisions}"))
            alerts.append(yellow("  → Check outputs/vintages/revision_log.csv"))
        else:
            highlights.append(green("No historical regime revisions"))

    # ── Drift watch ───────────────────────────────────────────────────────────
    exp_std = last.get("comp_expanding_std")
    if pd.notna(exp_std):
        lo, hi = DRIFT_BAND
        if lo <= float(exp_std) <= hi:
            highlights.append(green(f"Drift watch OK: expanding std {exp_std:.3f} ∈ [{lo}, {hi}]"))
        else:
            alerts.append(red(f"DRIFT ALERT: expanding std {exp_std:.3f} outside [{lo}, {hi}]"))
            alerts.append(red("  MANDATORY threshold review — methodology §7.5 (non-discretionary)"))

    # ── Threshold proximity ───────────────────────────────────────────────────
    dist_down = last.get("dist_to_downgrade")
    dist_up   = last.get("dist_to_upgrade")
    if pd.notna(dist_down) and float(dist_down) < WATCH_DIST:
        alerts.append(yellow(f"DOWNGRADE WATCH: {float(dist_down):.3f}z from downgrade threshold"))
    if pd.notna(dist_up) and float(dist_up) < WATCH_DIST:
        alerts.append(yellow(f"UPGRADE WATCH: {float(dist_up):.3f}z from upgrade threshold"))

    # ── Active flags ──────────────────────────────────────────────────────────
    n_before = len(before_flags) if before_flags is not None else 0
    n_after  = len(after_flags)
    delta    = n_after - n_before
    if delta > 0:
        alerts.append(yellow(f"{delta} new flag(s) raised (total {n_after})"))
    elif delta < 0:
        highlights.append(green(f"{abs(delta)} flag(s) cleared (total {n_after})"))
    else:
        if n_after == 0:
            highlights.append(green("No active flags"))
        else:
            highlights.append(yellow(f"{n_after} active flag(s) unchanged"))

    # ── Breadth check ─────────────────────────────────────────────────────────
    breadth_check = last.get("breadth_check")
    if str(breadth_check) == "narrow":
        alerts.append(yellow("Breadth check: NARROW — composite move not confirmed by diffusion"))

    # ── Curve environment ─────────────────────────────────────────────────────
    curve_env = last.get("curve_env")
    if str(curve_env) == "bull_steepening":
        alerts.append(yellow("Curve: BULL STEEPENING — front-end falling (crisis-typical pattern)"))
        alerts.append(yellow("  → Read Liquidity pillar via NFCI alone this month"))

    return highlights, alerts


# ── Step 7: Print summary ─────────────────────────────────────────────────────
def print_summary(after_comp, after_pillar, after_flags, highlights, alerts):
    last = after_comp.iloc[-1]

    section("UPDATE COMPLETE — CURRENT READING")

    # Composite block
    composite     = last.get("composite", float("nan"))
    display       = last.get("display_score", float("nan"))
    regime        = last.get("regime_confirmed", "–")
    months_in     = last.get("months_in_regime", "–")
    pctile        = last.get("pctile_expanding")
    chg_3m        = last.get("comp_3m_chg")
    chg_6m        = last.get("comp_6m_chg")
    chg_12m       = last.get("comp_12m_chg")
    diffusion     = last.get("diffusion")
    top_drag      = last.get("top_drag", "–")
    top_support   = last.get("top_support", "–")
    direction     = last.get("direction_flag", "–")
    dist_down     = last.get("dist_to_downgrade")
    dist_up       = last.get("dist_to_upgrade")

    print(f"\n  {bold('Date:')}      {str(last['date'])[:7]}")
    print(f"  {bold('Composite:')} {bold(f'{composite:+.3f} z')}  (display {display:.2f} / 5)")
    print(f"  {bold('Regime:')}    {bold(str(regime))}  ·  month {months_in}  ·  {direction}")
    if pd.notna(pctile):
        print(f"  {bold('History:')}   {pctile:.0f}th percentile (expanding)")
    if pd.notna(diffusion):
        pos_indicators = round(float(diffusion) * 13)
        print(f"  {bold('Breadth:')}   {float(diffusion)*100:.0f}% positive  ({pos_indicators} of 13 indicators)")

    # Momentum
    def _delta(v, label):
        if pd.isna(v): return f"  {dim(label + ':')}  –"
        sym = "▲" if v > 0 else "▼"
        col = green if v > 0 else red
        return f"  {bold(label + ':')}  {col(f'{sym} {v:+.3f} z')}"
    print()
    print(_delta(chg_3m,  "3M Δ"))
    print(_delta(chg_6m,  "6M Δ"))
    print(_delta(chg_12m, "12M Δ"))

    # Pillar attribution
    print(f"\n  {bold('Attribution (this month):')}")
    if not after_pillar.empty:
        latest_date = after_comp.iloc[-1]["date"]
        pil = after_pillar[after_pillar["date"] == latest_date].copy()
        if not pil.empty:
            pil = pil.sort_values("contribution", ascending=False)
            for _, row in pil.iterrows():
                pillar_name = str(row.get("pillar", "–")).capitalize()
                contrib     = row.get("contribution", float("nan"))
                score       = row.get("score", float("nan"))
                flag        = row.get("direction_flag", "")
                bar_char    = "█" if contrib >= 0 else "░"
                bar_len     = min(int(abs(float(contrib)) * 80), 12)
                bar         = bar_char * bar_len
                col         = green if contrib >= 0 else red
                print(f"    {pillar_name:<16} {col(f'{contrib:+.3f}')}  z={score:+.3f}  {dim(bar)}  {dim(flag)}")
    else:
        print(f"    Top support: {green(str(top_support))}")
        print(f"    Biggest drag: {red(str(top_drag))}")

    # Threshold distances
    print(f"\n  {bold('Threshold distances:')}")
    if pd.notna(dist_down) and dist_down is not None:
        col = red if float(dist_down) < 0.20 else yellow if float(dist_down) < 0.50 else (lambda x: x)
        print(f"    To downgrade: {col(f'{float(dist_down):.3f} z')}")
    if pd.notna(dist_up) and dist_up is not None:
        col = green if float(dist_up) < 0.20 else (lambda x: x)
        print(f"    To upgrade:   {col(f'{float(dist_up):.3f} z')}" if pd.notna(dist_up) else "")

    # Active flags
    if not after_flags.empty:
        print(f"\n  {bold('Active flags:')}")
        for _, row in after_flags.iterrows():
            ftype   = str(row.get("flag_type", row.get("type", "flag")))
            subject = str(row.get("pillar_or_indicator", row.get("indicator", row.get("pillar", ""))))
            onset   = str(row.get("onset_date", row.get("date", "")))[:7]
            print(f"    {yellow('⚑')} {ftype:<30}  {subject}  {dim(onset)}")

    # Checks summary
    print(f"\n  {bold('Checks:')}")
    for h in highlights:
        print(f"    {h}")
    if alerts:
        print(f"\n  {bold('Alerts:')}")
        for a in alerts:
            print(f"    {a}")

    # Next steps
    print(f"\n{bold('━' * 62)}")
    print(f"  {bold('Next steps:')}")
    print(f"  1. {dim('Review alerts above')}")
    print(f"  2. {dim('Add analyst note to dashboard/data/commentary.json')}")
    print(f"     {dim('(key: YYYY-MM-DD for month-end, fields: analyst_note, author, as_of)')}")
    print(f"  3. {dim('git add outputs/monitoring/ dashboard/data/')}")
    print(f"     {dim('git commit -m \"MRS update: YYYY-MM (Regime: X, z ±0.00)\"')}")
    print(f"     {dim('git push origin main')}")
    print(f"  4. {dim('Dashboard auto-deploys → https://ankitv25.github.io/Macro-Regime-Score/')}")
    print(bold("━" * 62) + "\n")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="MRS Monthly Update Agent — runs the full update pipeline.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python src/update_mrs.py                  Full update (pull + process + score + export)
  python src/update_mrs.py --skip-pull      Skip FRED pull (data already in data/raw/fred/)
  python src/update_mrs.py --dry-run        Pull + process only, stop before writing tables
        """,
    )
    parser.add_argument("--skip-pull", action="store_true",
                        help="Skip FRED data pull, use existing raw files")
    parser.add_argument("--dry-run", action="store_true",
                        help="Pull and process inputs only — no scoring, no dashboard export")
    args = parser.parse_args()

    # Guard: must run from repo root
    if not (REPO_ROOT / "src" / "mrs_proposed_framework.py").exists():
        print(red("Run this script from the repo root: python src/update_mrs.py"))
        sys.exit(1)

    section(f"MRS MONTHLY UPDATE AGENT  ·  {datetime.now().strftime('%Y-%m-%d %H:%M')}")

    # ── Step 1: Pre-flight ────────────────────────────────────────────────────
    section("Pre-flight check", step=1)
    before_comp, before_pillar, before_flags = preflight()

    # ── Step 2: Pull data ─────────────────────────────────────────────────────
    section("Pull FRED data", step=2)
    if args.skip_pull:
        print(dim("  Skipped (--skip-pull). Using existing files in data/raw/fred/"))
    else:
        run_step("Pulling supplemental FRED series", SRC_DIR / "pull_mrs_data.py")
        pull_log = REPO_ROOT / "outputs" / "mrs_data_pull_log.md"
        if pull_log.exists():
            info(f"Pull log written to {pull_log.relative_to(REPO_ROOT)}")

    # ── Step 3: Input panel ───────────────────────────────────────────────────
    section("Rebuild input panel", step=3)
    run_step("Aligning and transforming all series", SRC_DIR / "process_mrs_inputs.py")
    panel = REPO_ROOT / "data" / "processed" / "mrs_inputs_monthly.csv"
    if panel.exists():
        df = pd.read_csv(panel, parse_dates=["date"])
        ok(f"Panel: {len(df)} months  "
           f"({df['date'].min().strftime('%Y-%m')} → {df['date'].max().strftime('%Y-%m')})")
    val_log = REPO_ROOT / "outputs" / "mrs_validation_log.md"
    if val_log.exists():
        info(f"Validation log: {val_log.relative_to(REPO_ROOT)}")

    if args.dry_run:
        warn("--dry-run: stopping here. No monitoring tables written.")
        return

    # ── Step 4: Score + monitoring store ─────────────────────────────────────
    section("Score + build monitoring tables", step=4)
    run_step("Running v2.1 engine + building monitoring tables + MRS_Master.xlsx",
             SRC_DIR / "mrs_monitoring_store.py")

    # Verify outputs
    for csv in [COMPOSITE_CSV, PILLAR_CSV, FLAGS_CSV]:
        if csv.exists():
            df = pd.read_csv(csv)
            ok(f"{csv.name}: {len(df)} rows")
        else:
            alert(f"Missing expected output: {csv.name}")

    master = REPO_ROOT / "outputs" / "MRS_Master.xlsx"
    if master.exists():
        ok(f"MRS_Master.xlsx updated")

    # ── Step 5: Post-run checks ───────────────────────────────────────────────
    section("Post-run checks", step=5)
    after_comp   = pd.read_csv(COMPOSITE_CSV, parse_dates=["date"])
    after_pillar = pd.read_csv(PILLAR_CSV, parse_dates=["date"]) if PILLAR_CSV.exists() else pd.DataFrame()
    after_flags  = pd.read_csv(FLAGS_CSV) if FLAGS_CSV.exists() else pd.DataFrame()

    highlights, alerts_ = post_checks(before_comp, before_flags, after_comp, after_flags)
    for h in highlights: print(f"  {h}")
    for a in alerts_:    print(f"  {a}")

    # ── Step 6: Export dashboard JSON ─────────────────────────────────────────
    section("Export dashboard JSON", step=6)
    run_step("Converting MRS_Master.xlsx → dashboard/data/*.json",
             SRC_DIR / "export_dashboard_data.py")
    json_files = list(DASH_DATA_DIR.glob("*.json"))
    ok(f"{len(json_files)} JSON files written to dashboard/data/")

    # Commentary reminder
    if COMMENTARY.exists():
        import json
        with open(COMMENTARY) as f:
            existing_notes = json.load(f)
        last_date = after_comp.iloc[-1]["date"]
        month_key = last_date.strftime("%Y-%m")
        has_note  = any(k.startswith(month_key) for k in existing_notes)
        if not has_note:
            warn(f"No analyst note found for {month_key} in commentary.json — consider adding one")
        else:
            ok(f"Analyst note found for {month_key}")

    # ── Step 7: Summary ───────────────────────────────────────────────────────
    print_summary(after_comp, after_pillar, after_flags, highlights, alerts_)


if __name__ == "__main__":
    main()
