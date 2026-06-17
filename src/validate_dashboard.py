"""
MRS Dashboard Validator
========================
Validates dashboard/data/*.json files for consistency, completeness,
and scoring-chain integrity before publishing.

Checks:
  1. Required files exist
  2. Valid JSON (parseable)
  3. data_through consistent across metadata.json, composite_history.json,
     and forecast_inputs.json
  4. All 13 expected indicators present in indicators_wide.json
  5. No duplicate dates in any time-series file
  6. Composite score ≈ Σ(pillar contributions) (score chain integrity)
  7. Display score = composite + 3, clipped [1, 5]
  8. Regime threshold logic: classify(composite) matches regime_raw
  9. forecast_inputs.json has all 13 indicators, each with 12-element arrays
 10. Active flags reference valid indicator/pillar names

Run from repo root:
  python src/validate_dashboard.py            # exits 1 if any check fails
  python src/validate_dashboard.py --verbose  # show per-check detail
"""

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DASH_DATA = REPO_ROOT / "dashboard" / "data"

REQUIRED_FILES = [
    "metadata.json",
    "composite_history.json",
    "pillars_wide.json",
    "pillars_long.json",
    "indicators_wide.json",
    "indicators_long.json",
    "regime_periods.json",
    "active_flags.json",
    "forecast_inputs.json",
]

EXPECTED_INDICATORS = [
    "g_nfp", "g_ipman", "g_gdp", "g_serv",
    "i_pce_dev", "i_pce_mom",
    "l_nfci", "l_curve",
    "c_ig_level", "c_ig_mom",
    "s_vix", "s_bond", "s_spy_dd",
]

EXPECTED_PILLARS = ["growth", "inflation", "liquidity", "credit", "stress"]

PILLAR_WEIGHTS = {
    "growth": 0.30, "inflation": 0.15, "liquidity": 0.15, "credit": 0.20, "stress": 0.20
}

THRESHOLDS = {"expansion": 0.35, "neutral": -0.30, "slowdown": -1.00}


def classify(z):
    if z is None or z != z:
        return "N/A"
    if z >= 0.35: return "Expansion"
    if z >= -0.30: return "Neutral"
    if z >= -1.00: return "Slowdown"
    return "Contraction"


def clip(v, lo=1.0, hi=5.0):
    return max(lo, min(hi, v))


# ── Validator class ────────────────────────────────────────────────────────────
class Validator:
    def __init__(self, verbose: bool):
        self.verbose = verbose
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.data: dict = {}

    def error(self, msg: str):
        self.errors.append(msg)
        if self.verbose: print(f"  ✗  {msg}")

    def warning(self, msg: str):
        self.warnings.append(msg)
        if self.verbose: print(f"  ⚠  {msg}")

    def ok(self, msg: str):
        if self.verbose: print(f"  ✓  {msg}")

    # ── Check 1: File existence ───────────────────────────────────────────────
    def check_files(self):
        for fname in REQUIRED_FILES:
            p = DASH_DATA / fname
            if not p.exists():
                self.error(f"Missing: {fname}")
            else:
                try:
                    self.data[fname] = json.loads(p.read_text())
                    self.ok(f"{fname} exists and is valid JSON")
                except json.JSONDecodeError as e:
                    self.error(f"{fname} is not valid JSON: {e}")

    # ── Check 2: data_through consistency ─────────────────────────────────────
    def check_data_through(self):
        meta = self.data.get("metadata.json")
        if not meta: return
        meta_dt = meta.get("data_through", "")

        comp = self.data.get("composite_history.json", [])
        if comp:
            comp_dates = sorted(r["date"] for r in comp if r.get("composite") is not None)
            if comp_dates:
                last_comp_date = comp_dates[-1][:10]
                if last_comp_date != meta_dt:
                    self.error(f"data_through mismatch: metadata={meta_dt}, composite_history last={last_comp_date}")
                else:
                    self.ok(f"data_through consistent: {meta_dt}")

        fc = self.data.get("forecast_inputs.json")
        if fc:
            fc_dt = fc.get("data_through", "")
            if fc_dt and fc_dt[:7] < meta_dt[:7]:
                self.warning(f"forecast_inputs.data_through ({fc_dt}) is behind metadata ({meta_dt}) — update manifest and re-run generate_forecast_inputs.py")

    # ── Check 3: Indicators present ───────────────────────────────────────────
    def check_indicators(self):
        iw = self.data.get("indicators_wide.json", [])
        if not iw: return
        sample = iw[-1]  # last row
        for code in EXPECTED_INDICATORS:
            if f"{code}_z" not in sample:
                self.error(f"indicators_wide missing column: {code}_z")
        self.ok(f"All {len(EXPECTED_INDICATORS)} indicator z-score columns present")

    # ── Check 4: No duplicate dates ───────────────────────────────────────────
    def check_no_dupes(self):
        for fname in ["composite_history.json", "pillars_wide.json", "indicators_wide.json"]:
            data = self.data.get(fname, [])
            if not data: continue
            dates = [r.get("date") for r in data]
            dupes = [d for d in set(dates) if dates.count(d) > 1]
            if dupes:
                self.error(f"{fname} has duplicate dates: {dupes[:5]}")
            else:
                self.ok(f"{fname}: no duplicate dates ({len(dates)} rows)")

    # ── Check 5: Score chain integrity ────────────────────────────────────────
    def check_score_chain(self):
        pw = self.data.get("pillars_wide.json", [])
        comp = self.data.get("composite_history.json", [])
        if not pw or not comp: return

        # Index composite by date
        comp_by_date = {r["date"]: r for r in comp if r.get("composite") is not None}
        errors_found = 0
        tol = 0.01  # z-unit tolerance for float rounding

        for row in pw[-12:]:  # check last 12 months (spot check)
            date = row.get("date")
            if date not in comp_by_date: continue
            c = comp_by_date[date]

            # Recompute composite from pillar contributions
            contrib_sum = sum(
                row.get(f"{p}_contribution") or 0
                for p in EXPECTED_PILLARS
            )
            composite = c.get("composite")
            if composite is not None and abs(contrib_sum - composite) > tol:
                self.error(f"Score chain fail at {date}: "
                           f"Σcontrib={contrib_sum:.4f} ≠ composite={composite:.4f}")
                errors_found += 1

            # Check display_score = clip(composite + 3, 1, 5)
            display = c.get("display_score")
            if composite is not None and display is not None:
                expected_disp = clip(composite + 3.0)
                if abs(display - expected_disp) > tol:
                    self.error(f"display_score fail at {date}: "
                               f"got {display:.4f}, expected {expected_disp:.4f}")
                    errors_found += 1

        if errors_found == 0:
            self.ok(f"Score chain integrity passed (checked last 12 months)")

    # ── Check 6: Regime classification ───────────────────────────────────────
    def check_regime_logic(self):
        comp = self.data.get("composite_history.json", [])
        if not comp: return
        errors_found = 0
        for row in comp[-24:]:  # last 24 months
            z = row.get("composite")
            regime_raw = row.get("regime_raw")
            if z is None or regime_raw is None: continue
            expected = classify(z)
            if expected != regime_raw:
                self.error(f"Regime mismatch at {row.get('date')}: "
                           f"classify({z:.4f})={expected} ≠ regime_raw={regime_raw}")
                errors_found += 1
        if errors_found == 0:
            self.ok(f"Regime classification logic correct (checked last 24 months)")

    # ── Check 7: Forecast inputs structure ────────────────────────────────────
    def check_forecast_inputs(self):
        fc = self.data.get("forecast_inputs.json")
        if not fc: return

        inds = fc.get("indicators", {})
        missing_inds = [c for c in EXPECTED_INDICATORS if c not in inds]
        if missing_inds:
            self.error(f"forecast_inputs.json missing indicators: {missing_inds}")
        else:
            self.ok(f"forecast_inputs.json has all {len(EXPECTED_INDICATORS)} indicators")

        for code in EXPECTED_INDICATORS:
            ind = inds.get(code, {})
            for key in ["baseline_z", "optimistic_z", "pessimistic_z"]:
                arr = ind.get(key, [])
                if len(arr) != 12:
                    self.error(f"forecast_inputs[{code}][{key}] has {len(arr)} elements (expected 12)")
                for v in arr:
                    if v is not None and abs(v) > 3.001:
                        self.warning(f"forecast_inputs[{code}][{key}] has value {v:.4f} outside [-3, 3] clip range")

    # ── Check 8: Active flags reference valid names ───────────────────────────
    def check_flags(self):
        flags = self.data.get("active_flags.json", [])
        if not flags: return
        for f in flags:
            name = f.get("name", "")
            level = f.get("level", "")
            if level == "indicator" and name not in EXPECTED_INDICATORS:
                self.warning(f"active_flags: unknown indicator '{name}'")
            if level == "pillar" and name not in EXPECTED_PILLARS:
                self.warning(f"active_flags: unknown pillar '{name}'")
        self.ok(f"Active flags validated ({len(flags)} flags)")

    def run(self) -> bool:
        checks = [
            ("File existence & JSON validity", self.check_files),
            ("data_through consistency",       self.check_data_through),
            ("Indicator columns",               self.check_indicators),
            ("Duplicate dates",                 self.check_no_dupes),
            ("Score chain integrity",           self.check_score_chain),
            ("Regime classification logic",     self.check_regime_logic),
            ("Forecast inputs structure",       self.check_forecast_inputs),
            ("Active flags",                    self.check_flags),
        ]

        for label, fn in checks:
            if self.verbose: print(f"\n  [{label}]")
            try:
                fn()
            except Exception as e:
                self.error(f"{label} — unexpected error: {e}")

        print()
        if self.errors:
            print(f"VALIDATION FAILED: {len(self.errors)} error(s), {len(self.warnings)} warning(s)")
            for e in self.errors:
                print(f"  ✗  {e}")
            for w in self.warnings:
                print(f"  ⚠  {w}")
            return False
        elif self.warnings:
            print(f"VALIDATION PASSED with {len(self.warnings)} warning(s)")
            for w in self.warnings:
                print(f"  ⚠  {w}")
            return True
        else:
            print(f"VALIDATION PASSED — all {len(checks)} checks clean")
            return True


def main():
    parser = argparse.ArgumentParser(description="Validate MRS dashboard JSON files")
    parser.add_argument("--verbose", action="store_true", help="Show per-check detail")
    args = parser.parse_args()
    v = Validator(verbose=args.verbose)
    passed = v.run()
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
