"""
MRS Dashboard Refresh
=====================
Regenerates all dashboard JSON files directly from committed monitoring CSVs.
Does NOT require MRS_Master.xlsx, the raw /data/ folder, or the full pipeline.

Use this script whenever:
  - The monitoring CSVs have new data (after a full pipeline run)
  - You need to rebuild dashboard JSON without running the full pipeline
  - MRS_Master.xlsx is unavailable (it's gitignored — not present on a fresh clone)

Pipeline it replaces:
  outputs/monitoring/*.csv  →  (this script)  →  dashboard/data/*.json

Full pipeline (run first if data needs updating):
  python src/update_mrs.py    (requires raw FRED data in data/)

Run from repo root:
  python src/refresh_dashboard.py
  python src/refresh_dashboard.py --skip-forecast   # skip forecast_inputs.json
  python src/refresh_dashboard.py --skip-validate   # skip post-write validation
  python src/refresh_dashboard.py --dry-run         # report only, write nothing

Output:
  dashboard/data/composite_history.json
  dashboard/data/pillars_wide.json
  dashboard/data/pillars_long.json
  dashboard/data/indicators_wide.json
  dashboard/data/indicators_long.json
  dashboard/data/regime_periods.json
  dashboard/data/active_flags.json
  dashboard/data/metadata.json
  dashboard/data/forecast_inputs.json  (via generate_forecast_inputs.py)
  outputs/refresh_log.md
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT     = Path(__file__).resolve().parent.parent
MON_DIR       = REPO_ROOT / "outputs" / "monitoring"
DASH_DATA_DIR = REPO_ROOT / "dashboard" / "data"
LOG_PATH      = REPO_ROOT / "outputs" / "refresh_log.md"

COMPOSITE_CSV = MON_DIR / "mrs_composite_history.csv"
PILLAR_CSV    = MON_DIR / "mrs_pillar_history.csv"
IND_CSV       = MON_DIR / "mrs_indicator_history.csv"
FLAGS_CSV     = MON_DIR / "mrs_active_flags.csv"

PILLAR_ORDER = ["growth", "inflation", "liquidity", "credit", "stress"]
IND_ORDER = [
    "g_nfp", "g_ipman", "g_gdp", "g_serv",
    "i_pce_dev", "i_pce_mom",
    "l_nfci", "l_curve",
    "c_ig_level", "c_ig_mom",
    "s_vix", "s_bond", "s_spy_dd",
]

PRETTY_ROW_LIMIT = 50


# ── Console helpers ───────────────────────────────────────────────────────────
def _c(t, code): return f"\033[{code}m{t}\033[0m"
def ok(msg):     print(_c(f"  ✓  {msg}", "32"))
def warn(msg):   print(_c(f"  ⚠  {msg}", "33"))
def fail(msg):   print(_c(f"  ✗  {msg}", "31"))
def info(msg):   print(f"     {msg}")
def bold(t):     return _c(t, "1")
def section(t):  print(f"\n{bold('─' * 60)}\n  {bold(t)}\n{bold('─' * 60)}")


# ── Serialization helpers (matches export_dashboard_data.py format) ───────────
def records_json(df: pd.DataFrame, *, sort_dates: bool = True) -> str:
    df = df.copy()
    if sort_dates and "date" in df.columns:
        df = df.sort_values("date").reset_index(drop=True)
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            df[col] = df[col].dt.strftime("%Y-%m-%d")
        elif df[col].dtype == object:
            df[col] = df[col].where(df[col].notna(), None)
    float_cols = df.select_dtypes(include="float").columns
    df[float_cols] = df[float_cols].round(6)
    # Replace NaN/inf with None for clean JSON
    df = df.replace({float("nan"): None, float("inf"): None, float("-inf"): None})
    indent = 2 if len(df) <= PRETTY_ROW_LIMIT else None
    return df.to_json(orient="records", indent=indent, default_handler=str)


def write_json(path: Path, content: str, label: str, dry_run: bool = False) -> None:
    if dry_run:
        info(f"[dry-run] Would write {label} → {path.name}")
        return
    path.write_text(content)
    size_kb = len(content) / 1024
    ok(f"{label} → {path.name} ({size_kb:.1f} KB)")


# ── Regime periods (same logic as mrs_monitoring_store.py) ────────────────────
def derive_regime_periods(comp_h: pd.DataFrame) -> pd.DataFrame:
    df = comp_h.loc[
        comp_h["regime_confirmed"].notna() & (comp_h["regime_confirmed"] != "N/A"),
        ["date", "regime_confirmed"]
    ].copy()
    df["date"] = pd.to_datetime(df["date"])
    runs = (df["regime_confirmed"] != df["regime_confirmed"].shift()).cumsum()
    return (
        df.groupby(runs)
          .agg(
              regime=("regime_confirmed", "first"),
              start_date=("date", "first"),
              end_date=("date", "last"),
              n_months=("date", "size"),
          )
          .reset_index(drop=True)
    )


# ── Main refresh steps ────────────────────────────────────────────────────────
def check_inputs() -> bool:
    missing = [p for p in [COMPOSITE_CSV, PILLAR_CSV, IND_CSV, FLAGS_CSV] if not p.exists()]
    if missing:
        for p in missing:
            fail(f"Missing: {p.relative_to(REPO_ROOT)}")
        return False
    ok(f"All 4 monitoring CSVs present in {MON_DIR.relative_to(REPO_ROOT)}/")
    return True


def build_composite_json(dry_run: bool) -> pd.DataFrame:
    comp = pd.read_csv(COMPOSITE_CSV)
    write_json(DASH_DATA_DIR / "composite_history.json", records_json(comp), "composite_history", dry_run)
    return comp


def build_pillar_jsons(dry_run: bool) -> pd.DataFrame:
    pil = pd.read_csv(PILLAR_CSV)
    pil["date"] = pd.to_datetime(pil["date"])

    # Long format: write as-is
    write_json(DASH_DATA_DIR / "pillars_long.json", records_json(pil), "pillars_long", dry_run)

    # Wide format: pivot score and contribution per pillar
    # Ensure pillar column values match PILLAR_ORDER (may have fewer pillars early)
    available_pillars = [p for p in PILLAR_ORDER if p in pil["pillar"].unique()]
    piv_score   = pil.pivot(index="date", columns="pillar", values="score")
    piv_contrib = pil.pivot(index="date", columns="pillar", values="contribution")
    score_cols   = [p for p in PILLAR_ORDER if p in piv_score.columns]
    contrib_cols = [p for p in PILLAR_ORDER if p in piv_contrib.columns]
    pillars_wide = pd.concat(
        [
            piv_score[score_cols].add_suffix("_score"),
            piv_contrib[contrib_cols].add_suffix("_contribution"),
        ],
        axis=1,
    ).reset_index()

    write_json(DASH_DATA_DIR / "pillars_wide.json", records_json(pillars_wide), "pillars_wide", dry_run)
    return pil


def build_indicator_jsons(dry_run: bool) -> pd.DataFrame:
    ind = pd.read_csv(IND_CSV)
    ind["date"] = pd.to_datetime(ind["date"])

    # Long format: write as-is
    write_json(DASH_DATA_DIR / "indicators_long.json", records_json(ind), "indicators_long", dry_run)

    # Wide format: pivot raw_value and z_score per indicator
    # Only include indicators present in data (may have fewer early)
    available_codes = [c for c in IND_ORDER if c in ind["indicator"].unique()]
    piv_raw = ind.pivot(index="date", columns="indicator", values="raw_value")
    piv_z   = ind.pivot(index="date", columns="indicator", values="z_score")
    raw_cols = [c for c in IND_ORDER if c in piv_raw.columns]
    z_cols   = [c for c in IND_ORDER if c in piv_z.columns]
    indicators_wide = pd.concat(
        [
            piv_raw[raw_cols].add_suffix("_raw"),
            piv_z[z_cols].add_suffix("_z"),
        ],
        axis=1,
    ).reset_index()

    write_json(DASH_DATA_DIR / "indicators_wide.json", records_json(indicators_wide), "indicators_wide", dry_run)
    return ind


def build_regime_periods_json(comp: pd.DataFrame, dry_run: bool) -> None:
    rp = derive_regime_periods(comp)
    write_json(DASH_DATA_DIR / "regime_periods.json", records_json(rp), "regime_periods", dry_run)


def build_flags_json(dry_run: bool) -> None:
    flags = pd.read_csv(FLAGS_CSV)
    write_json(DASH_DATA_DIR / "active_flags.json", records_json(flags), "active_flags", dry_run)


def build_metadata_json(comp: pd.DataFrame, dry_run: bool) -> None:
    comp["date"] = pd.to_datetime(comp["date"])
    last = comp.dropna(subset=["composite"]).iloc[-1]
    meta = {
        "version": "v2.1",
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "data_from": str(comp["date"].min().date()),
        "data_through": str(last["date"].date()),
        "n_months": str(int(comp["composite"].notna().sum())),
        "latest_regime_confirmed": str(last["regime_confirmed"]),
        "latest_composite_z": str(round(float(last["composite"]), 4)),
        "latest_display_score": str(round(float(last["display_score"]), 4)),
        "source": "src/refresh_dashboard.py → outputs/monitoring/",
    }
    content = json.dumps(meta, indent=2)
    if dry_run:
        info(f"[dry-run] Would write metadata.json")
        return
    (DASH_DATA_DIR / "metadata.json").write_text(content)
    ok(f"metadata → metadata.json  (data_through={meta['data_through']}, regime={meta['latest_regime_confirmed']})")


# ── Forecast inputs ───────────────────────────────────────────────────────────
def run_forecast_inputs(dry_run: bool) -> bool:
    script = REPO_ROOT / "src" / "generate_forecast_inputs.py"
    if not script.exists():
        warn("generate_forecast_inputs.py not found — skipping forecast_inputs.json update")
        return False
    if dry_run:
        info("[dry-run] Would run generate_forecast_inputs.py")
        return True
    result = subprocess.run(
        [sys.executable, str(script)],
        capture_output=True, text=True, cwd=str(REPO_ROOT),
    )
    if result.returncode != 0:
        fail(f"generate_forecast_inputs.py failed:\n{result.stderr[-2000:]}")
        return False
    ok("generate_forecast_inputs.py → dashboard/data/forecast_inputs.json")
    return True


# ── Validation ────────────────────────────────────────────────────────────────
def run_validation() -> bool:
    script = REPO_ROOT / "src" / "validate_dashboard.py"
    if not script.exists():
        warn("validate_dashboard.py not found — skipping")
        return True
    result = subprocess.run(
        [sys.executable, str(script)],
        capture_output=True, text=True, cwd=str(REPO_ROOT),
    )
    lines = (result.stdout or "").strip().split("\n")
    for line in lines:
        print(f"     {line}")
    if result.returncode != 0:
        fail("Validation FAILED — do not commit until issues are resolved")
        return False
    ok("Validation passed")
    return True


# ── Refresh log ───────────────────────────────────────────────────────────────
def write_log(comp: pd.DataFrame, details: list[str]) -> None:
    comp["date"] = pd.to_datetime(comp["date"])
    last = comp.dropna(subset=["composite"]).iloc[-1]
    lines = [
        "# MRS Dashboard Refresh Log",
        "",
        f"**Run:** {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"**Script:** `src/refresh_dashboard.py`",
        f"**Data through:** {str(last['date'].date())}",
        f"**Composite z:** {float(last['composite']):+.4f}  "
        f"(display {float(last['display_score']):.2f}/5)",
        f"**Regime:** {last['regime_confirmed']}  "
        f"(month {int(last['months_in_regime'])})",
        f"**3M change:** {float(last['comp_3m_chg']):+.4f}z  "
        f"(direction: {last['direction_flag']})",
        "",
        "## Files written",
        "",
    ] + [f"- {d}" for d in details] + [
        "",
        "## Next steps",
        "",
        "```bash",
        "# After running refresh_dashboard.py, optionally update the analyst note:",
        "# vim dashboard/data/commentary.json",
        "",
        "# Commit and publish:",
        "git add outputs/monitoring/ dashboard/data/",
        "git commit -m \"MRS update: "
        f"{str(last['date'])[:7]} (Regime: {last['regime_confirmed']}, "
        f"z {float(last['composite']):+.3f})\"",
        "git push origin main",
        "```",
        "",
    ]
    LOG_PATH.write_text("\n".join(lines))
    ok(f"Refresh log → {LOG_PATH.relative_to(REPO_ROOT)}")


# ── Entry point ───────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="MRS Dashboard Refresh — CSV → JSON")
    parser.add_argument("--skip-forecast", action="store_true",
                        help="Skip regenerating forecast_inputs.json")
    parser.add_argument("--skip-validate", action="store_true",
                        help="Skip post-write validation")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report what would be written without writing")
    args = parser.parse_args()

    if not (REPO_ROOT / "src" / "update_mrs.py").exists():
        fail("Run from repo root: python src/refresh_dashboard.py")
        sys.exit(1)

    section(f"MRS DASHBOARD REFRESH  ·  {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    if args.dry_run:
        warn("DRY RUN — nothing will be written")

    # Step 1: Check monitoring CSVs exist
    section("Step 1 / 6  —  Check monitoring CSVs")
    if not check_inputs():
        fail("Cannot proceed — run the full pipeline first: python src/update_mrs.py")
        sys.exit(1)

    # Step 2: Build JSON files
    section("Step 2 / 6  —  Build dashboard JSON files")
    DASH_DATA_DIR.mkdir(parents=True, exist_ok=True)

    comp = build_composite_json(args.dry_run)
    build_pillar_jsons(args.dry_run)
    build_indicator_jsons(args.dry_run)
    build_regime_periods_json(comp, args.dry_run)
    build_flags_json(args.dry_run)
    build_metadata_json(comp, args.dry_run)

    commentary = DASH_DATA_DIR / "commentary.json"
    if not commentary.exists():
        if not args.dry_run:
            commentary.write_text("{}")
            ok("commentary.json initialised (empty — add analyst notes manually)")
    else:
        ok(f"commentary.json preserved (not overwritten)")

    # Step 3: Forecast inputs
    section("Step 3 / 6  —  Regenerate forecast_inputs.json")
    if args.skip_forecast:
        warn("Skipped (--skip-forecast)")
    else:
        run_forecast_inputs(args.dry_run)

    # Step 4: Validate
    section("Step 4 / 6  —  Validate dashboard data")
    if args.skip_validate:
        warn("Skipped (--skip-validate)")
    elif not args.dry_run:
        passed = run_validation()
        if not passed:
            sys.exit(1)

    # Step 5: Write refresh log
    section("Step 5 / 6  —  Write refresh log")
    if not args.dry_run:
        details = [
            "dashboard/data/composite_history.json",
            "dashboard/data/pillars_wide.json",
            "dashboard/data/pillars_long.json",
            "dashboard/data/indicators_wide.json",
            "dashboard/data/indicators_long.json",
            "dashboard/data/regime_periods.json",
            "dashboard/data/active_flags.json",
            "dashboard/data/metadata.json",
            "dashboard/data/forecast_inputs.json  (via generate_forecast_inputs.py)",
        ]
        write_log(comp, details)

    # Step 6: Next steps
    section("Step 6 / 6  —  Done")
    last = pd.read_csv(COMPOSITE_CSV).dropna(subset=["composite"]).iloc[-1]
    last_date     = str(last["date"])[:7]
    last_comp     = float(last["composite"])
    last_disp     = float(last["display_score"])
    last_regime   = str(last["regime_confirmed"])
    last_month_in = int(last["months_in_regime"])
    print(f"\n  Data through: {bold(last_date)}")
    print(f"  Composite z:  {bold(f'{last_comp:+.3f}')}  (display {last_disp:.2f}/5)")
    print(f"  Regime:       {bold(last_regime)}  (month {last_month_in})")
    print(f"\n  Next: git add outputs/monitoring/ dashboard/data/")
    print(f"        git commit -m \"MRS update: {last_date} (Regime: {last_regime}, z {last_comp:+.3f})\"")
    print(f"        git push origin main\n")


if __name__ == "__main__":
    main()
