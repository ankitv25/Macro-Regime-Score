"""
FRED Macro, Rates, and Credit Data Pull (core puller)
=====================================================
Pulls the CORE FRED-sourced series that the monthly panel build
(`process_mrs_inputs.py`) hard-requires, and writes them under
`data/raw/fred/`. This is the companion to `pull_mrs_data.py`, which only
refreshes a handful of *supplemental* series — between them they regenerate
every raw input the pipeline needs from a clean checkout.

Why this exists in the public repo
-----------------------------------
The FULL_UPDATE pipeline reads five core raw files that no other public-repo
script produced, while `/data/` is gitignored. A fresh clone (e.g. the cloud
refresh routine, which runs with persist_session=false) therefore had none of
them and crashed at `process_mrs_inputs.py` with
`FileNotFoundError: data/raw/fred/fred_rates_daily.csv`. Porting this puller
into the public repo and running it as the first FULL_UPDATE step makes a
clean clone self-sufficient. (SPY/`asset_universe_returns.csv` — the 5th core
file — is handled by `pull_spy_returns.py`.)

Outputs
-------
    data/raw/fred/fred_rates_daily.csv     — 15 daily rate/spread/stress series
    data/raw/fred/fred_macro_monthly.csv   — 10 monthly macro series (NFP, core PCE, ...)
    data/raw/fred/fred_nfci_weekly.csv     — NFCI weekly
    data/raw/fred/fred_gdp_quarterly.csv   — GDPC1 quarterly

Source: pandas_datareader.data.DataReader(series_id, 'fred', ...). No API key
required. Per-series failures are warned and skipped (e.g. GOLDAMGBD228NLBM is
FRED-blocked and STLFSI2 is discontinued) so one bad optional series can never
abort the run.

Ported from the private workspace `Src/pull_fred_macro.py`; the Excel
variable-map step (a documentation-only side output) was dropped so this has no
dependency outside the repo.
"""

import sys
import pandas as pd
import pandas_datareader.data as web
from pathlib import Path
from datetime import datetime

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
FRED_DIR  = REPO_ROOT / "data" / "raw" / "fred"
LOG_PATH  = REPO_ROOT / "outputs" / "fred_macro_pull_log.md"

PULL_START = "2000-01-01"
PULL_END   = datetime.today().strftime("%Y-%m-%d")

# ---------------------------------------------------------------------------
# FRED series definitions, grouped by native frequency.
# (id -> human label, for the coverage log only.)
# ---------------------------------------------------------------------------
FRED_DAILY = {
    "DGS2": "2-Year Treasury Yield",
    "DGS10": "10-Year Treasury Yield",
    "DGS30": "30-Year Treasury Yield",
    "T10Y2Y": "10Y-2Y Yield Curve Spread",
    "T10Y3M": "10Y-3M Yield Curve Spread",
    "DFII10": "10Y TIPS Real Yield",
    "FEDFUNDS": "Federal Funds Effective Rate",
    "T10YIE": "10Y Breakeven Inflation",
    "T5YIFR": "5Y5Y Forward Breakeven",
    "BAMLH0A0HYM2": "HY OAS (ICE BofA)",
    "BAMLC0A0CM": "IG OAS (ICE BofA)",
    "VIXCLS": "VIX — CBOE Volatility Index",
    "DTWEXBGS": "Trade-Weighted Dollar Index",
    "DCOILWTICO": "WTI Crude Oil Spot",
    "GOLDAMGBD228NLBM": "Gold London PM Fix (often FRED-blocked)",
}

FRED_MONTHLY = {
    "CPIAUCSL": "CPI All Items",
    "CPILFESL": "Core CPI (ex Food & Energy)",
    "PCEPI": "PCE Price Index",
    "PCEPILFE": "Core PCE (Fed target)",
    "PAYEMS": "Nonfarm Payrolls (Level)",
    "UNRATE": "Unemployment Rate",
    "INDPRO": "Industrial Production Index",
    "RSAFS": "Retail Sales",
    "UMCSENT": "Consumer Sentiment (Michigan)",
    "USREC": "NBER Recession Indicator",
}

FRED_WEEKLY    = {"NFCI": "Chicago Fed NFCI"}
FRED_QUARTERLY = {"GDPC1": "Real GDP (Chain-Weighted)"}

# Optional series allowed to fail without warning escalation.
KNOWN_FLAKY = {"GOLDAMGBD228NLBM"}  # FRED HTTP-blocked; gold sourced elsewhere


# ---------------------------------------------------------------------------
# Pull
# ---------------------------------------------------------------------------
def pull_bucket(series_dict: dict, label: str) -> tuple[pd.DataFrame, list, list]:
    pulled, failed, frames = [], [], {}
    for sid in series_dict:
        try:
            frames[sid] = web.DataReader(sid, "fred", PULL_START, PULL_END)[sid]
            pulled.append(sid)
        except Exception as e:
            note = " (known-flaky, ignored)" if sid in KNOWN_FLAKY else ""
            print(f"    WARN {sid}: {str(e).splitlines()[0][:120]}{note}")
            failed.append(sid)
    df = pd.DataFrame(frames) if frames else pd.DataFrame()
    df.index.name = "date"
    print(f"  {label}: {len(pulled)} pulled, {len(failed)} failed")
    return df, pulled, failed


def main() -> int:
    print("=" * 65)
    print("FRED Macro / Rates / Credit — core data pull")
    print("=" * 65)
    print(f"Window: {PULL_START} → {PULL_END}")

    FRED_DIR.mkdir(parents=True, exist_ok=True)

    buckets = {
        "daily":     (FRED_DAILY,     FRED_DIR / "fred_rates_daily.csv"),
        "monthly":   (FRED_MONTHLY,   FRED_DIR / "fred_macro_monthly.csv"),
        "weekly":    (FRED_WEEKLY,    FRED_DIR / "fred_nfci_weekly.csv"),
        "quarterly": (FRED_QUARTERLY, FRED_DIR / "fred_gdp_quarterly.csv"),
    }
    bucket_labels = {
        "daily": "Daily   (rates/credit/stress)", "monthly": "Monthly (macro)",
        "weekly": "Weekly  (NFCI)", "quarterly": "Quarterly (GDP)",
    }

    results = {}
    hard_fail = False
    for key, (series_dict, path) in buckets.items():
        df, pulled, failed = pull_bucket(series_dict, bucket_labels[key])
        results[key] = {"pulled": pulled, "failed": failed, "rows": len(df),
                        "path": path}
        if df.empty:
            # An empty core file means the panel build will crash — fail loud.
            print(f"  ERROR {path.name}: no data pulled (network blocked?)")
            hard_fail = True
            continue
        df.to_csv(path)
        last = df.dropna(how="all").index.max()
        print(f"  Saved {path.relative_to(REPO_ROOT)}  "
              f"({df.shape[0]}×{df.shape[1]}, through {str(last)[:10]})")

    _write_log(results)

    total_pulled = sum(len(r["pulled"]) for r in results.values())
    total_failed = sum(len(r["failed"]) for r in results.values())
    print("=" * 65)
    print(f"Done.  {total_pulled} pulled  |  {total_failed} failed/skipped")
    print("=" * 65)
    # Non-zero exit only if a whole bucket came back empty (genuinely broken).
    return 1 if hard_fail else 0


def _write_log(results: dict) -> None:
    now = datetime.today().strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        "# FRED Core Macro Pull — Log", "",
        f"**Run:** {now}  ·  **Window:** {PULL_START} → {PULL_END}  ·  "
        f"**Script:** `src/pull_fred_macro.py`", "",
        "| File | Cols pulled | Failed/skipped | Rows |", "|---|---|---|---|",
    ]
    for key, r in results.items():
        failed = ", ".join(r["failed"]) or "—"
        lines.append(f"| {r['path'].name} | {len(r['pulled'])} | {failed} | {r['rows']} |")
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOG_PATH.write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    sys.exit(main())
