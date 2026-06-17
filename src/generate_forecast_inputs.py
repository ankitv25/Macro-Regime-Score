"""
MRS Forecast Inputs Generator
==============================
Generates dashboard/data/forecast_inputs.json from:
  1. config/refresh_manifest.json  — per-indicator delta arrays and metadata
  2. outputs/monitoring/mrs_indicator_history.csv  — latest actual z-scores

How it works:
  - For each indicator, reads the latest non-null z-score (latest_actual_z)
  - Computes 12-month absolute z-score paths by adding the delta arrays from
    the manifest to the current z-score
  - Paths are clipped to [-3, 3] (the MRS z-score clip range)
  - Writes forecast_inputs.json for the Scenario tab and Overview table

Updating the forecast (do this when the economic outlook changes):
  1. Open config/refresh_manifest.json
  2. Update forecast_as_of, forecast_raw, notes, status, next_release per indicator
  3. Update baseline_deltas_z, optimistic_deltas_z, pessimistic_deltas_z:
     - These are RELATIVE to the current z-score (delta from today)
     - Month 1 delta ≈ 0 (current condition persists into T+1)
     - Month 12 delta reflects expected structural change over 12 months
  4. Run: python src/generate_forecast_inputs.py
  5. Verify: python src/validate_dashboard.py

Run from repo root:
  python src/generate_forecast_inputs.py
  python src/generate_forecast_inputs.py --verbose   # show per-indicator details
"""

import argparse
import json
from datetime import datetime
from pathlib import Path

import pandas as pd

REPO_ROOT   = Path(__file__).resolve().parent.parent
MANIFEST    = REPO_ROOT / "config" / "refresh_manifest.json"
IND_CSV     = REPO_ROOT / "outputs" / "monitoring" / "mrs_indicator_history.csv"
OUTPUT      = REPO_ROOT / "dashboard" / "data" / "forecast_inputs.json"

Z_CLIP = 3.0


def load_latest_z(ind_csv_path: Path) -> dict[str, float]:
    """
    For each indicator, find the most recent row where z_score is not null.
    Returns {indicator_code: z_score}.
    """
    ind = pd.read_csv(ind_csv_path)
    ind["date"] = pd.to_datetime(ind["date"])
    result = {}
    for code, grp in ind.groupby("indicator"):
        valid = grp.dropna(subset=["z_score"]).sort_values("date")
        if not valid.empty:
            last = valid.iloc[-1]
            result[str(code)] = {
                "z": float(last["z_score"]),
                "date": str(last["date"].date()),
                "raw": float(last["raw_value"]) if pd.notna(last["raw_value"]) else None,
            }
    return result


def clip(v: float) -> float:
    return max(-Z_CLIP, min(Z_CLIP, v))


def build_path(current_z: float, deltas: list[float]) -> list[float]:
    """
    Computes absolute z-score path from current z + delta array.
    Clips to [-3, 3] to match the MRS z-score clip range.
    """
    return [round(clip(current_z + d), 4) for d in deltas]


def main():
    parser = argparse.ArgumentParser(description="Generate forecast_inputs.json from manifest")
    parser.add_argument("--verbose", action="store_true", help="Print per-indicator details")
    args = parser.parse_args()

    # Guards
    if not MANIFEST.exists():
        print(f"ERROR: manifest not found at {MANIFEST.relative_to(REPO_ROOT)}")
        raise SystemExit(1)
    if not IND_CSV.exists():
        print(f"ERROR: indicator history not found at {IND_CSV.relative_to(REPO_ROOT)}")
        raise SystemExit(1)

    manifest = json.loads(MANIFEST.read_text())
    latest_z = load_latest_z(IND_CSV)

    if args.verbose:
        print(f"Manifest as-of: {manifest.get('forecast_as_of')}")
        print(f"Indicator CSV rows: {pd.read_csv(IND_CSV).shape[0]}")
        print()

    indicators_out = {}
    warnings = []

    for code, cfg in manifest["indicators"].items():
        if code not in latest_z:
            warnings.append(f"WARNING: {code} not found in indicator CSV — skipping")
            continue

        info = latest_z[code]
        current_z = info["z"]
        latest_date = info["date"]
        latest_raw  = info["raw"]

        baseline_deltas    = cfg["baseline_deltas_z"]
        optimistic_deltas  = cfg["optimistic_deltas_z"]
        pessimistic_deltas = cfg["pessimistic_deltas_z"]

        n = manifest.get("forecast_horizon_months", 12)
        if len(baseline_deltas) < n:
            warnings.append(f"WARNING: {code} baseline_deltas has {len(baseline_deltas)} elements (expected {n})")

        baseline_z    = build_path(current_z, baseline_deltas[:n])
        optimistic_z  = build_path(current_z, optimistic_deltas[:n])
        pessimistic_z = build_path(current_z, pessimistic_deltas[:n])

        if args.verbose:
            print(f"  {code:<14}  current z={current_z:+.4f}  "
                  f"baseline T+12={baseline_z[-1]:+.4f}  "
                  f"opt T+12={optimistic_z[-1]:+.4f}  "
                  f"pess T+12={pessimistic_z[-1]:+.4f}")

        indicators_out[code] = {
            "label":             cfg["label"],
            "pillar":            cfg["pillar"],
            "latest_actual_date": latest_date,
            "latest_actual_z":   round(current_z, 4),
            "latest_actual_raw": str(round(latest_raw, 4)) if latest_raw is not None else "n/a",
            "next_release":      cfg.get("next_release", ""),
            "forecast_raw":      cfg.get("forecast_raw", ""),
            "source":            cfg.get("source", ""),
            "status":            cfg.get("status", "simulated"),
            "in_baseline":       cfg.get("in_baseline", True),
            "notes":             cfg.get("notes", ""),
            "baseline_z":        baseline_z,
            "optimistic_z":      optimistic_z,
            "pessimistic_z":     pessimistic_z,
        }

    output = {
        "as_of":              manifest.get("forecast_as_of", datetime.today().strftime("%Y-%m-%d")),
        "data_through":       max(v["date"] for v in latest_z.values()) if latest_z else "",
        "generated_at":       datetime.now().strftime("%Y-%m-%d %H:%M"),
        "forecast_horizon":   "T+12 months",
        "baseline_label":     manifest.get("baseline_description", ""),
        "optimistic_label":   manifest.get("optimistic_description", ""),
        "pessimistic_label":  manifest.get("pessimistic_description", ""),
        "indicators":         indicators_out,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, indent=2))

    n_ind = len(indicators_out)
    print(f"forecast_inputs.json: {n_ind} indicators · T+{manifest.get('forecast_horizon_months', 12)} months · as_of {output['as_of']}")
    if warnings:
        for w in warnings:
            print(w)


if __name__ == "__main__":
    main()
