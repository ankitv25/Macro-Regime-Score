"""
MRS Full Pipeline Runner — GitHub Actions entry point
=====================================================
Runs the complete MRS pipeline in an environment where FRED is reachable
(i.e. GitHub Actions). On success with a new month, writes the analyst note
to commentary.json and advances the six binding-indicator next_release dates
in config/refresh_manifest.json.

Exit codes:
  0  — pipeline ran successfully (new month or resync); workflow diff-check decides commit
  1  — pipeline error; do not publish

Run from repo root:
  python src/mrs_gha_runner.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from calendar import monthrange
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

REPO_ROOT   = Path(__file__).resolve().parent.parent
SRC_DIR     = REPO_ROOT / "src"
DASH_DATA   = REPO_ROOT / "dashboard" / "data"
MONITORING  = REPO_ROOT / "outputs" / "monitoring"
CONFIG_DIR  = REPO_ROOT / "config"
MANIFEST    = CONFIG_DIR / "refresh_manifest.json"
COMMENTARY  = DASH_DATA / "commentary.json"
METADATA    = DASH_DATA / "metadata.json"
COMP_CSV    = MONITORING / "mrs_composite_history.csv"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run(label: str, script: Path, extra_args: list[str] | None = None) -> bool:
    cmd = [sys.executable, str(script)] + (extra_args or [])
    print(f"\n▶  {label}", flush=True)
    result = subprocess.run(cmd, cwd=str(REPO_ROOT))
    if result.returncode != 0:
        print(f"✗  {label} FAILED (exit {result.returncode})", flush=True)
        return False
    print(f"✓  {label} OK", flush=True)
    return True


def _first_friday(year: int, month: int) -> date:
    d = date(year, month, 1)
    days = (4 - d.weekday()) % 7
    return d + timedelta(days=days)


# ── Analyst note generator ────────────────────────────────────────────────────

def _generate_note(meta: dict, row: dict) -> str:
    regime      = meta["latest_regime_confirmed"]
    comp_z      = float(meta["latest_composite_z"])
    display     = float(meta["latest_display_score"])
    months      = int(float(row.get("months_in_regime", 0)))
    mom_3m      = float(row.get("comp_3m_chg", 0.0))
    dist_up     = float(row.get("dist_to_upgrade", 0.5))
    dist_dn     = float(row.get("dist_to_downgrade", 0.5))
    diffusion   = float(row.get("diffusion", 0.5))
    top_drag    = str(row.get("top_drag", "unknown"))
    top_support = str(row.get("top_support", "unknown"))

    if mom_3m > 0.05:
        mom_str = f"improving 3-month momentum ({mom_3m:+.3f}z)"
    elif mom_3m < -0.05:
        mom_str = f"softening 3-month momentum ({mom_3m:+.3f}z)"
    else:
        mom_str = f"broadly flat 3-month momentum ({mom_3m:+.3f}z)"

    closer_boundary = "upgrade" if dist_up < dist_dn else "downgrade"
    closer_dist     = min(dist_up, dist_dn)

    note = (
        f"{regime} confirmed for month {months} (composite {comp_z:+.3f}z, "
        f"display {display:.1f}/5) with {mom_str}. "
        f"Breadth at {diffusion * 100:.0f}%: primary drag is "
        f"<strong>{top_drag}</strong>, main support from "
        f"<strong>{top_support}</strong>. "
        f"The composite sits {closer_dist:.2f}z from the {closer_boundary} "
        f"boundary; the more likely regime change — if it comes — would arrive "
        f"through the {top_drag} pillar rather than a broad deterioration."
    )
    return note


# ── Manifest advance ──────────────────────────────────────────────────────────

def _advance_manifest(manifest: dict, data_through: str) -> dict:
    dt = date.fromisoformat(data_through)

    # Release month = two calendar months after data_through
    rel_month = dt.month + 2
    rel_year  = dt.year
    if rel_month > 12:
        rel_month -= 12
        rel_year  += 1

    nfp_date = _first_friday(rel_year, rel_month).isoformat()
    ip_date  = date(rel_year, rel_month, 16).isoformat()
    pce_date = date(rel_year, rel_month, 27).isoformat()

    binding = {
        "g_nfp":     nfp_date,
        "g_ipman":   ip_date,
        "g_gdp":     pce_date,
        "g_serv":    pce_date,
        "i_pce_dev": pce_date,
        "i_pce_mom": pce_date,
    }
    for key, dt_str in binding.items():
        manifest["indicators"][key]["next_release"] = dt_str
        print(f"   {key}.next_release → {dt_str}")

    return manifest


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    # Record current data_through before the run
    prev_through = None
    if METADATA.exists():
        prev_through = json.loads(METADATA.read_text()).get("data_through")
    print(f"\n▶  Current data_through: {prev_through or 'unknown'}")

    # ── Data pulls ────────────────────────────────────────────────────────────
    pulls = [
        ("FRED core pull",          SRC_DIR / "pull_fred_macro.py",   None),
        ("SPY returns refresh",     SRC_DIR / "pull_spy_returns.py",  None),
        ("FRED supplemental pull",  SRC_DIR / "pull_mrs_data.py",     None),
    ]
    for label, script, args in pulls:
        if not _run(label, script, args):
            print("\n✗  Pipeline halted at data-pull stage.", flush=True)
            return 1

    # ── Processing pipeline ───────────────────────────────────────────────────
    builds = [
        ("Monthly panel build",    SRC_DIR / "process_mrs_inputs.py",       None),
        ("MRS v2.1 scoring engine",SRC_DIR / "mrs_monitoring_store.py",     None),
        ("Dashboard JSON export",  SRC_DIR / "refresh_dashboard.py",        ["--skip-validate"]),
        ("Forecast inputs",        SRC_DIR / "generate_forecast_inputs.py", None),
    ]
    for label, script, args in builds:
        if not _run(label, script, args):
            print(f"\n✗  Pipeline halted at: {label}", flush=True)
            return 1

    # ── Validation ────────────────────────────────────────────────────────────
    if not _run("Dashboard validation", SRC_DIR / "validate_dashboard.py"):
        print("\n✗  Validation FAILED — not publishing.", flush=True)
        return 1

    # ── Check if data advanced or if revisions exist ─────────────────────────
    new_meta     = json.loads(METADATA.read_text())
    new_through  = new_meta.get("data_through")
    is_new_month = new_through != prev_through

    if is_new_month:
        print(f"\n✓  data_through advanced: {prev_through} → {new_through}", flush=True)
    else:
        print(f"\n⊘  Same month ({new_through}) — checking for historical revisions or"
              f" market-data updates to publish.", flush=True)

    # Write result type to GITHUB_OUTPUT so the workflow can choose the commit message
    gha_out = os.environ.get("GITHUB_OUTPUT")
    if gha_out:
        with open(gha_out, "a") as f:
            f.write(f"result={'new_month' if is_new_month else 'resync'}\n")
            f.write(f"data_through={new_through}\n")

    if not is_new_month:
        # No new month: no note, no manifest advance.
        # Return 0 so the workflow diff-check runs and commits revisions if any.
        print("▶  Skipping note/manifest advance (same month).", flush=True)
        return 0

    # ── Analyst note ──────────────────────────────────────────────────────────
    comp_df  = pd.read_csv(COMP_CSV)
    latest   = comp_df.iloc[-1].to_dict()
    note     = _generate_note(new_meta, latest)
    today    = date.today().isoformat()

    commentary = json.loads(COMMENTARY.read_text()) if COMMENTARY.exists() else {}
    if new_through not in commentary:
        commentary[new_through] = {
            "analyst_note": note,
            "author":       "MRS Agent",
            "as_of":        today,
        }
        COMMENTARY.write_text(json.dumps(commentary, indent=2) + "\n")
        print(f"✓  Analyst note written for {new_through}", flush=True)
        print(f"   Note: {note[:120]}…", flush=True)
    else:
        print(f"⊘  Analyst note for {new_through} already present — skipping.", flush=True)

    # ── Advance manifest ──────────────────────────────────────────────────────
    print("\n▶  Advancing refresh_manifest.json binding dates:", flush=True)
    manifest = json.loads(MANIFEST.read_text())
    manifest = _advance_manifest(manifest, new_through)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print("✓  Manifest advanced.", flush=True)

    # ── Final summary ─────────────────────────────────────────────────────────
    regime = new_meta["latest_regime_confirmed"]
    comp_z = float(new_meta["latest_composite_z"])
    disp   = float(new_meta["latest_display_score"])
    print(
        f"\n{'='*60}\n"
        f"  MRS GHA RUNNER COMPLETE\n"
        f"  Data through : {new_through}\n"
        f"  Regime       : {regime}\n"
        f"  Composite z  : {comp_z:+.4f}\n"
        f"  Display score: {disp:.2f}/5\n"
        f"{'='*60}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
