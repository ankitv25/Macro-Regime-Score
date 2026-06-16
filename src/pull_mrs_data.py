"""
MRS Data Pull — Supplemental and Re-pull
=========================================
Purpose:
    Pull the additional FRED series needed for MRS construction that were either
    missing from or truncated in the original FRED pull (src/pull_mrs_data.py).

Series pulled:
    IPMAN        Monthly  Industrial Production: Manufacturing (NAICS)
                          → proxy for ISM Manufacturing PMI (Bloomberg unavailable)
    STLFSI2      Weekly   St. Louis Fed Financial Stress Index v2
                          → proxy for MOVE Index (Bloomberg unavailable)
                          Note: available 1993–2022; superseded by NFCI/DGS10 vol after
    BAA10YM      Monthly  Moody's Baa Corp Bond Yield Minus 10Y Treasury
                          → IG credit spread proxy (free FRED alternative to BAML series)
                          BAMLC0A0CM limited to 2023+ due to ICE licensing — BAA10YM covers 2000+
    BAA          Monthly  Moody's Baa Corporate Bond Yield (level)
    AAA          Monthly  Moody's Aaa Corporate Bond Yield (level, for IG reference)

Not re-pulled (issues documented):
    BAMLH0A0HYM2 / BAMLC0A0CM: ICE BofA FRED series truncated to 2023-06 due to
                                 ICE licensing change. Full history requires Bloomberg or
                                 FRED API key. FRED public access now limited to recent data.
    GOLDAMGBD228NLBM: FRED access blocked. Use gold_daily_yahoo.csv (GC=F) as substitute.

Outputs:
    data/raw/fred/mrs_ipman_monthly.csv     — Manufacturing IP monthly
    data/raw/fred/mrs_stlfsi2_weekly.csv    — St. Louis FSI weekly
    data/raw/fred/mrs_baa_monthly.csv       — Moody's BAA/AAA yields + spread
    outputs/mrs_data_pull_log.md            — pull summary and coverage

Date written: 2026-06-04
"""

import time
import numpy as np
import pandas as pd
import pandas_datareader.data as web
from pathlib import Path
from datetime import datetime

REPO_ROOT  = Path(__file__).resolve().parent.parent
FRED_DIR   = REPO_ROOT / "data" / "raw" / "fred"
OUTPUT_LOG = REPO_ROOT / "outputs" / "mrs_data_pull_log.md"

PULL_START = "2000-01-01"
PULL_END   = datetime.today().strftime("%Y-%m-%d")
TIMEOUT    = 60   # seconds
MAX_RETRY  = 3


def pull_fred(series_id: str, start: str = PULL_START, end: str = PULL_END,
              retries: int = MAX_RETRY):
    for attempt in range(1, retries + 1):
        try:
            s = web.DataReader(series_id, "fred", start, end)
            return s[series_id]
        except Exception as e:
            if attempt < retries:
                time.sleep(3)
            else:
                print(f"  FAILED {series_id} after {retries} attempts: {str(e)[:80]}")
                return None


def main():
    print("=" * 65)
    print("MRS Data Pull — Supplemental Series")
    print("=" * 65)
    FRED_DIR.mkdir(parents=True, exist_ok=True)

    results = {}

    # ----- IPMAN: Manufacturing Industrial Production -----
    print("\nPulling IPMAN (Manufacturing IP)...")
    s = pull_fred("IPMAN")
    if s is not None:
        df = s.to_frame("IPMAN")
        df.index.name = "date"
        df.to_csv(FRED_DIR / "mrs_ipman_monthly.csv")
        s_clean = s.dropna()
        print(f"  Saved: {len(s_clean)} obs  {s_clean.index.min().date()} to {s_clean.index.max().date()}")
        results["IPMAN"] = {"status": "pulled", "obs": len(s_clean),
                            "start": str(s_clean.index.min().date()),
                            "end":   str(s_clean.index.max().date())}
    else:
        results["IPMAN"] = {"status": "failed"}

    # ----- STLFSI2: St. Louis Financial Stress Index -----
    print("\nPulling STLFSI2 (St. Louis Financial Stress Index)...")
    s = pull_fred("STLFSI2")
    if s is not None:
        df = s.to_frame("STLFSI2")
        df.index.name = "date"
        df.to_csv(FRED_DIR / "mrs_stlfsi2_weekly.csv")
        s_clean = s.dropna()
        print(f"  Saved: {len(s_clean)} obs  {s_clean.index.min().date()} to {s_clean.index.max().date()}")
        results["STLFSI2"] = {"status": "pulled", "obs": len(s_clean),
                              "start": str(s_clean.index.min().date()),
                              "end":   str(s_clean.index.max().date()),
                              "note": "Discontinued 2022-01-07. Use DGS10 realized vol post-2022."}
    else:
        results["STLFSI2"] = {"status": "failed"}

    # ----- BAA10YM: Moody's BAA minus 10Y (IG spread proxy) -----
    print("\nPulling Moody's BAA and AAA series (IG credit spread proxy)...")
    series_map = {
        "BAA10YM": "Moody BAA-10Y spread (IG credit proxy)",
        "AAA10YM": "Moody AAA-10Y spread (AAA reference)",
        "BAA":     "Moody BAA Corporate Bond Yield (level)",
        "AAA":     "Moody AAA Corporate Bond Yield (level)",
    }
    baa_frames = {}
    for sid, label in series_map.items():
        sv = pull_fred(sid)
        if sv is not None:
            sv_clean = sv.dropna()
            baa_frames[sid] = sv
            print(f"  {sid}: {len(sv_clean)} obs  {sv_clean.index.min().date()} to {sv_clean.index.max().date()}")
            results[sid] = {"status": "pulled", "label": label,
                            "obs": len(sv_clean),
                            "start": str(sv_clean.index.min().date()),
                            "end":   str(sv_clean.index.max().date())}
        else:
            results[sid] = {"status": "failed", "label": label}

    if baa_frames:
        baa_df = pd.DataFrame(baa_frames)
        baa_df.index.name = "date"
        baa_df.to_csv(FRED_DIR / "mrs_baa_monthly.csv")
        print(f"  Saved mrs_baa_monthly.csv: {baa_df.shape}")

    # ----- PCE services + services deflator (v2.1 g_serv input) -----
    print("\nPulling PCE services + services deflator (v2.1 Growth input)...")
    for sid, fname, label in [
        ("PCES", "mrs_pces_monthly.csv",
         "PCE services, nominal (monthly)"),
        ("DSERRG3M086SBEA", "mrs_pce_serv_deflator_monthly.csv",
         "PCE services price index (monthly)"),
    ]:
        sv = pull_fred(sid)
        if sv is not None:
            sv_clean = sv.dropna()
            out = sv.to_frame(sid)
            out.index.name = "observation_date"
            out.to_csv(FRED_DIR / fname)
            print(f"  {sid}: {len(sv_clean)} obs → {fname}")
            results[sid] = {"status": "pulled", "label": label,
                            "obs": len(sv_clean),
                            "start": str(sv_clean.index.min().date()),
                            "end":   str(sv_clean.index.max().date())}
        else:
            results[sid] = {"status": "failed", "label": label}

    # ----- Write pull log -----
    log_lines = [
        "# MRS Data Pull Log",
        "",
        f"**Run date**: {datetime.today().strftime('%Y-%m-%d %H:%M')}",
        f"**Script**: `src/pull_mrs_data.py`",
        f"**Pull window**: {PULL_START} to {PULL_END}",
        "",
        "---",
        "",
        "## Pull Results",
        "",
        "| Series | Label | Status | Obs | Start | End | Note |",
        "|---|---|---|---|---|---|---|",
    ]
    for sid, r in results.items():
        note = r.get("note", "")
        label = r.get("label", "")
        if r["status"] == "pulled":
            log_lines.append(
                f"| {sid} | {label} | Pulled | {r['obs']} "
                f"| {r['start']} | {r['end']} | {note} |"
            )
        else:
            log_lines.append(f"| {sid} | {label} | Failed | — | — | — | {note} |")

    log_lines += [
        "",
        "---",
        "",
        "## Known Data Issues (not resolved by this pull)",
        "",
        "| Series | Issue | Resolution |",
        "|---|---|---|",
        "| BAMLH0A0HYM2 (HY OAS) | ICE licensing: FRED access truncated to 2023-06+ | "
        "Use BAA10YM × HY scaling as proxy for 2000-2023; BAML for 2023+ |",
        "| BAMLC0A0CM (IG OAS) | Same ICE licensing issue | "
        "Use BAA10YM as primary IG spread proxy |",
        "| GOLDAMGBD228NLBM | FRED HTTP blocked | "
        "Use existing data/raw/fred/gold_daily_yahoo.csv (GC=F) |",
        "| STLFSI2 | Discontinued 2022-01-07 | "
        "Use DGS10 30-day realized vol for MSS post-2022 |",
        "| ISM Manufacturing PMI | Bloomberg-only | "
        "Use IPMAN YoY% (Manufacturing IP) as proxy per user instruction |",
        "| MOVE Index | Bloomberg-only | "
        "Use STLFSI2 (2000-2022) + DGS10 realized vol (2022+) per user instruction |",
        "",
    ]

    OUTPUT_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_LOG, "w") as fh:
        fh.write("\n".join(log_lines) + "\n")
    print(f"\nLog: {OUTPUT_LOG.relative_to(REPO_ROOT)}")
    print("Done.")


if __name__ == "__main__":
    main()
