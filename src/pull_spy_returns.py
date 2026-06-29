"""
SPY monthly returns — the 5th core input
========================================
Writes `data/processed/asset_universe_returns.csv` with `date,SPY` (SPY monthly
total returns). The panel build (`process_mrs_inputs.py`) reads only the `SPY`
column from this file to compute the 3-month cumulative return that feeds the
Market Stress Score.

Robustness (this file is gitignored under /data/ and the cloud routine runs
from a fresh clone, so it must always be (re)creatable):
  1. Start from the committed seed `src/data_seeds/spy_monthly_returns.csv`
     (full history back to the 1990s) — guarantees the file always exists with
     full history even if every network call fails.
  2. Refresh the tail from yfinance (auto-adjusted monthly close → pct change);
     this reproduces the seed's methodology exactly for closed months.
  3. If yfinance is unavailable, fall back to FRED `SP500` (price return, ~10y
     history, on the same proven pandas_datareader path as the rest of the
     pipeline) to extend the tail.
  4. Merge: seed history + freshest available tail; never lose history.

A failure to fetch fresh data degrades to "seed only" (slightly stale tail),
which keeps the pipeline running rather than crashing — validation and the
routine's churn guard catch a no-op.
"""

from __future__ import annotations

import sys
import warnings
import pandas as pd
from pathlib import Path

warnings.filterwarnings("ignore")

REPO_ROOT = Path(__file__).resolve().parent.parent
SEED      = REPO_ROOT / "src" / "data_seeds" / "spy_monthly_returns.csv"
OUT       = REPO_ROOT / "data" / "processed" / "asset_universe_returns.csv"


def _to_month_start(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    return idx.to_period("M").to_timestamp()  # month-start, matches the seed


def fetch_yfinance() -> pd.Series | None:
    try:
        import yfinance as yf
        px = yf.download("SPY", start="1993-01-01", interval="1mo",
                         auto_adjust=True, progress=False)["Close"]
        if isinstance(px, pd.DataFrame):
            px = px.iloc[:, 0]
        ret = px.pct_change().dropna()
        ret.index = _to_month_start(ret.index)
        return ret.rename("SPY") if len(ret) else None
    except Exception as e:
        print(f"  yfinance unavailable: {str(e).splitlines()[0][:120]}")
        return None


def fetch_fred_sp500() -> pd.Series | None:
    try:
        import pandas_datareader.data as web
        from datetime import datetime
        px = web.DataReader("SP500", "fred", "2010-01-01",
                            datetime.today().strftime("%Y-%m-%d"))["SP500"]
        m = px.resample("MS").last().dropna()  # month-start last obs
        ret = m.pct_change().dropna()
        return ret.rename("SPY") if len(ret) else None
    except Exception as e:
        print(f"  FRED SP500 fallback unavailable: {str(e).splitlines()[0][:120]}")
        return None


def main() -> int:
    print("=" * 65)
    print("SPY monthly returns — core input refresh")
    print("=" * 65)

    if not SEED.exists():
        print(f"  ERROR: seed missing: {SEED}")
        return 1
    seed = pd.read_csv(SEED, parse_dates=["date"]).set_index("date")["SPY"].dropna()
    print(f"  Seed: {len(seed)} months, through {seed.index.max().date()}")

    fresh = fetch_yfinance()
    src = "yfinance"
    if fresh is None or fresh.empty:
        fresh = fetch_fred_sp500()
        src = "FRED SP500 (price return)"

    merged = seed.copy()
    if fresh is not None and not fresh.empty:
        # Fresh source wins where it overlaps; extends the tail with new months.
        merged = fresh.combine_first(seed).sort_index()
        # Keep seed values for history; only let fresh override the recent tail
        # to avoid re-pricing decades of history from a different vendor.
        cutoff = seed.index.max() - pd.DateOffset(months=2)
        merged.loc[:cutoff] = seed.reindex(merged.index).loc[:cutoff]
        merged = merged.dropna()
        print(f"  Refreshed tail from {src}; now through {merged.index.max().date()} "
              f"({len(merged)} months)")
    else:
        print("  No fresh source reachable — using seed only (tail may be stale)")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    out = merged.rename("SPY").reset_index()
    out.columns = ["date", "SPY"]
    out.to_csv(OUT, index=False)
    print(f"  Wrote {OUT.relative_to(REPO_ROOT)} ({len(out)} rows)")
    print("=" * 65)
    return 0


if __name__ == "__main__":
    sys.exit(main())
