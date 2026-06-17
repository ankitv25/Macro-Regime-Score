"""
MRS Inputs — Processing and Monthly Alignment
==============================================
Purpose:
    Convert all raw FRED and Yahoo data into a clean, standardized monthly MRS
    input dataset. Applies all frequency conversions, derives all required
    transformed series, validates coverage, and produces a single processed
    monthly panel ready for scoring.

Inputs:
    data/raw/fred/fred_rates_daily.csv       — 14 daily rate/spread/stress series
    data/raw/fred/fred_macro_monthly.csv     — 10 monthly macro series
    data/raw/fred/fred_nfci_weekly.csv       — NFCI weekly
    data/raw/fred/fred_gdp_quarterly.csv     — GDPC1 quarterly
    data/raw/fred/mrs_ipman_monthly.csv      — Manufacturing IP monthly (ISM proxy)
    data/raw/fred/mrs_stlfsi2_weekly.csv     — St. Louis FSI weekly (MOVE proxy, 2000-2022)
    data/raw/fred/mrs_baa_monthly.csv        — Moody's BAA10YM (IG credit spread proxy)
    data/processed/asset_universe_returns.csv — SPY monthly total returns (MSS)

Outputs:
    data/processed/mrs_inputs_monthly.csv   — clean monthly MRS input panel
    data/processed/mrs_series_metadata.csv  — series metadata (source, freq, transform)
    methodology/mrs_validation_log.md       — data quality and coverage report

Frequency alignment methods:
    Daily → Monthly:  resample to last business day of month (month-end level)
    Weekly → Monthly: resample to monthly average
    Quarterly → Monthly: reindex + forward-fill (no interpolation between quarters)
    Monthly → Monthly: retain as-is (date aligned to YYYY-MM-01)

Proxy decisions (per methodology doc §3.2–3.3):
    ISM Manufacturing PMI → IPMAN YoY% (Manufacturing IP, NAICS, FRED)
    MOVE Index → STLFSI2 where available (2000-2022) + DGS10 30D realized vol
                 (2022+). Both included in output; spliced series also provided.
    VIX → VIXCLS (FRED) — unchanged
    IG credit spread → BAA10YM (Moody's BAA-10Y spread, FRED free, full history)
                       Note: BAMLC0A0CM limited to 2023-06+ due to ICE licensing.
    HY credit spread → BAA10YM × 1.8 historical scaling (full history)
                       + BAMLH0A0HYM2 actual (2023-06+ where available)
                       Splice documented in output.

Date written: 2026-06-04
"""

import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime

REPO_ROOT   = Path(__file__).resolve().parent.parent
FRED_DIR    = REPO_ROOT / "data" / "raw" / "fred"
PROC_DIR    = REPO_ROOT / "data" / "processed"
MRS_DIR     = REPO_ROOT / "methodology"

OUT_PANEL   = PROC_DIR / "mrs_inputs_monthly.csv"
OUT_META    = PROC_DIR / "mrs_series_metadata.csv"
OUT_LOG     = MRS_DIR  / "mrs_validation_log.md"

STUDY_START = pd.Timestamp("2000-01-01")
STUDY_END   = pd.Timestamp.today().normalize()   # always use today; was hardcoded to 2026-06-01
HY_IG_RATIO = 1.8   # historical ratio of HY OAS to BAA spread (used for 2000-2023 proxy)
MIN_OBS_SCORE = 24  # minimum monthly observations before percentile scores are meaningful


# ---------------------------------------------------------------------------
# Load raw inputs
# ---------------------------------------------------------------------------
def load_raw():
    print("Loading raw inputs...")

    # Daily (rates, spreads, VIX, FX, commodities)
    daily = pd.read_csv(FRED_DIR / "fred_rates_daily.csv",
                        index_col=0, parse_dates=True)

    # Monthly macro
    macro_m = pd.read_csv(FRED_DIR / "fred_macro_monthly.csv",
                          index_col=0, parse_dates=True)

    # NFCI weekly
    nfci_w = pd.read_csv(FRED_DIR / "fred_nfci_weekly.csv",
                         index_col=0, parse_dates=True)

    # GDP quarterly
    gdp_q = pd.read_csv(FRED_DIR / "fred_gdp_quarterly.csv",
                        index_col=0, parse_dates=True)

    # Manufacturing IP (monthly)
    ipman = pd.read_csv(FRED_DIR / "mrs_ipman_monthly.csv",
                        index_col=0, parse_dates=True)

    # STLFSI2 weekly
    stlfsi_path = FRED_DIR / "mrs_stlfsi2_weekly.csv"
    stlfsi_w = (pd.read_csv(stlfsi_path, index_col=0, parse_dates=True)
                if stlfsi_path.exists() else pd.DataFrame())

    # BAA / AAA monthly
    baa_path = FRED_DIR / "mrs_baa_monthly.csv"
    baa_m = (pd.read_csv(baa_path, index_col=0, parse_dates=True)
             if baa_path.exists() else pd.DataFrame())

    # PCE services (nominal) + services deflator — v2.1 Growth input
    pces_path = FRED_DIR / "mrs_pces_monthly.csv"
    pces_m = (pd.read_csv(pces_path, index_col=0, parse_dates=True)
              if pces_path.exists() else pd.DataFrame())
    servdef_path = FRED_DIR / "mrs_pce_serv_deflator_monthly.csv"
    servdef_m = (pd.read_csv(servdef_path, index_col=0, parse_dates=True)
                 if servdef_path.exists() else pd.DataFrame())

    # SPY monthly returns (from asset universe)
    au = pd.read_csv(PROC_DIR / "asset_universe_returns.csv",
                     parse_dates=["date"]).set_index("date")[["SPY"]]

    print(f"  Daily:     {daily.shape}  {daily.index.min().date()} – {daily.index.max().date()}")
    print(f"  Monthly:   {macro_m.shape}")
    print(f"  NFCI:      {nfci_w.shape}")
    print(f"  GDP:       {gdp_q.shape}")
    print(f"  IPMAN:     {ipman.shape}")
    print(f"  STLFSI2:   {stlfsi_w.shape}")
    print(f"  BAA:       {baa_m.shape}")
    print(f"  PCES:      {pces_m.shape}")
    print(f"  ServDefl:  {servdef_m.shape}")

    return (daily, macro_m, nfci_w, gdp_q, ipman, stlfsi_w, baa_m,
            pces_m, servdef_m, au)


# ---------------------------------------------------------------------------
# Daily → Monthly (month-end level)
# ---------------------------------------------------------------------------
def daily_to_monthly_eom(daily: pd.DataFrame) -> pd.DataFrame:
    """Resample daily series to last available observation in each calendar month."""
    return daily.resample("ME").last()


# ---------------------------------------------------------------------------
# Weekly → Monthly (monthly average)
# ---------------------------------------------------------------------------
def weekly_to_monthly_avg(weekly: pd.DataFrame) -> pd.DataFrame:
    return weekly.resample("ME").mean()


# ---------------------------------------------------------------------------
# DGS10 30-day realized volatility (monthly)
# Computes 30-day rolling annualized std of daily DGS10 changes,
# then takes the month-end value as the monthly observation.
# ---------------------------------------------------------------------------
def compute_dgs10_realvol(daily: pd.DataFrame) -> pd.Series:
    dgs10_daily = daily["DGS10"].dropna()
    changes = dgs10_daily.diff()          # daily yield change in percentage points
    realvol_30d = changes.rolling(30, min_periods=15).std() * np.sqrt(252)
    monthly = realvol_30d.resample("ME").last()
    monthly.name = "dgs10_realvol"
    return monthly


# ---------------------------------------------------------------------------
# GDP: quarterly → monthly via forward-fill
# ---------------------------------------------------------------------------
def gdp_quarterly_to_monthly(gdp_q: pd.DataFrame,
                              monthly_index: pd.DatetimeIndex) -> pd.Series:
    """
    Forward-fill quarterly GDP to monthly frequency.
    GDP released ~1 month after quarter-end; fill uses the last released value.
    No interpolation between quarters.
    """
    s = gdp_q["GDPC1"].copy()
    s = s.reindex(s.index.union(monthly_index)).sort_index()
    s = s.ffill()
    s = s.reindex(monthly_index)
    s.name = "GDPC1_monthly"
    return s


# ---------------------------------------------------------------------------
# Build monthly panel
# ---------------------------------------------------------------------------
def build_monthly_panel(daily, macro_m, nfci_w, gdp_q, ipman, stlfsi_w, baa_m,
                        pces_m, servdef_m, au):
    print("\nBuilding monthly panel...")

    # 1. Convert daily rates/spreads to month-end
    daily_m = daily_to_monthly_eom(daily)

    # 2. NFCI: weekly → monthly average
    nfci_m = weekly_to_monthly_avg(nfci_w)

    # 3. STLFSI2: weekly → monthly average
    if not stlfsi_w.empty:
        stlfsi_m = weekly_to_monthly_avg(stlfsi_w)
    else:
        stlfsi_m = pd.DataFrame()

    # 4. DGS10 realized vol (MOVE proxy fallback)
    dgs10_vol_m = compute_dgs10_realvol(daily)

    # 5. Establish common monthly date index (month-end)
    monthly_idx = pd.date_range(
        start=STUDY_START, end=STUDY_END, freq="ME"
    )

    # 6. GDP forward-fill to monthly
    gdp_monthly = gdp_quarterly_to_monthly(gdp_q, monthly_idx)

    # ---- Helper: align series to monthly_idx ----
    def align(s, name=None):
        s = s.copy()
        if name:
            s.name = name
        # normalise index to month-end
        s.index = s.index.to_period("M").to_timestamp("M")
        s = s.reindex(monthly_idx)
        return s

    panel = pd.DataFrame(index=monthly_idx)
    panel.index.name = "date"

    # ---- FEDFUNDS (monthly, extracted from daily file) ----
    ff_raw = daily["FEDFUNDS"].dropna()
    ff_raw.index = ff_raw.index.to_period("M").to_timestamp("M")
    panel["fedfunds"] = ff_raw.reindex(monthly_idx)

    # ---- Rate/spread levels (month-end) ----
    for col in ["DGS2", "DGS10", "DGS30", "T10Y2Y", "T10Y3M", "DFII10",
                "T10YIE", "T5YIFR", "VIXCLS", "DTWEXBGS", "DCOILWTICO"]:
        if col in daily_m.columns:
            panel[col.lower()] = align(daily_m[col])

    # ---- BAML OAS (truncated 2023+) ----
    for col in ["BAMLH0A0HYM2", "BAMLC0A0CM"]:
        if col in daily_m.columns:
            panel[col.lower()] = align(daily_m[col])

    # ---- BAA10YM, AAA10YM ----
    if not baa_m.empty:
        for col in baa_m.columns:
            panel[col.lower()] = align(baa_m[col])

    # ---- NFCI ----
    if "NFCI" in nfci_m.columns:
        panel["nfci"] = align(nfci_m["NFCI"])

    # ---- STLFSI2 ----
    if not stlfsi_m.empty and "STLFSI2" in stlfsi_m.columns:
        panel["stlfsi2"] = align(stlfsi_m["STLFSI2"])

    # ---- DGS10 30D realized vol ----
    panel["dgs10_realvol"] = align(dgs10_vol_m)

    # ---- Monthly macro ----
    for col in macro_m.columns:
        panel[col.lower()] = align(macro_m[col])

    # ---- IPMAN ----
    if "IPMAN" in ipman.columns:
        panel["ipman"] = align(ipman["IPMAN"])

    # ---- VIX intra-month sampling (v2.1: avg replaces month-end in MSS;
    #      max retained for dashboard context) ----
    vix_daily = daily["VIXCLS"].dropna()
    panel["vixcls_avg"] = align(vix_daily.resample("ME").mean())
    panel["vixcls_max"] = align(vix_daily.resample("ME").max())

    # ---- Real services consumption (PCES / services deflator, v2.1) ----
    if not pces_m.empty and not servdef_m.empty:
        real_serv = (pces_m.iloc[:, 0].resample("ME").last()
                     / servdef_m.iloc[:, 0].resample("ME").last())
        panel["real_serv_pce"] = align(real_serv)

    # ---- GDP (monthly forward-filled from quarterly) ----
    panel["gdpc1_monthly"] = gdp_monthly.values

    # ---- SPY monthly return ----
    spy_ret = au["SPY"].copy()
    spy_ret.index = spy_ret.index.to_period("M").to_timestamp("M")
    panel["spy_ret"] = spy_ret.reindex(monthly_idx)

    return panel


# ---------------------------------------------------------------------------
# Compute derived / transformed series
# ---------------------------------------------------------------------------
def compute_derived(panel: pd.DataFrame) -> pd.DataFrame:
    print("Computing derived series...")
    p = panel.copy()

    # GDP YoY% (quarterly series, forward-filled to monthly)
    p["gdp_yoy"] = (p["gdpc1_monthly"] / p["gdpc1_monthly"].shift(4) - 1) * 100

    # NFP: MoM change (thousands) and 3M rolling average
    p["nfp_mom"]    = p["payems"].diff()
    p["nfp_3m_avg"] = p["nfp_mom"].rolling(3, min_periods=2).mean()

    # YoY% transformations
    for src, dst in [
        ("indpro",   "indpro_yoy"),
        ("ipman",    "ipman_yoy"),
        ("cpiaucsl", "cpi_yoy"),
        ("cpilfesl", "core_cpi_yoy"),
        ("pcepi",    "pce_yoy"),
        ("pcepilfe", "core_pce_yoy"),
        ("rsafs",    "rsafs_yoy"),
        ("dcoilwtico","oil_yoy"),
    ]:
        if src in p.columns:
            p[dst] = (p[src] / p[src].shift(12) - 1) * 100

    # Real services consumption YoY% (v2.1 Growth input)
    if "real_serv_pce" in p.columns:
        p["real_serv_pce_yoy"] = (
            p["real_serv_pce"] / p["real_serv_pce"].shift(12) - 1) * 100

    # Real Fed Funds Rate = nominal FF rate minus Core CPI YoY
    p["real_ff_rate"] = p["fedfunds"] - p["core_cpi_yoy"]

    # Fed direction: 3M change in Fed Funds Rate
    p["ff_direction_3m"] = p["fedfunds"] - p["fedfunds"].shift(3)

    # 10Y Breakeven 3M change
    if "t10yie" in p.columns:
        p["t10yie_3m_change"] = p["t10yie"] - p["t10yie"].shift(3)

    # CPI YoY 3M acceleration
    if "cpi_yoy" in p.columns:
        p["cpi_3m_accel"] = p["cpi_yoy"] - p["cpi_yoy"].shift(3)

    # Credit spread: BAA10YM (IG proxy)
    if "baa10ym" in p.columns:
        p["ig_spread"] = p["baa10ym"]  # IG credit spread proxy

    # HY spread proxy: BAA10YM × HY_IG_RATIO for pre-2023; BAML actual after
    if "baa10ym" in p.columns:
        p["hy_spread_proxy"] = p["baa10ym"] * HY_IG_RATIO
        # Overlay actual BAML HY where available
        if "bamlh0a0hym2" in p.columns:
            actual_hy = p["bamlh0a0hym2"].dropna()
            p.loc[actual_hy.index, "hy_spread_proxy"] = actual_hy
        p["hy_spread_source"] = "BAA×1.8 proxy"
        if "bamlh0a0hym2" in p.columns:
            mask = p["bamlh0a0hym2"].notna()
            p.loc[mask, "hy_spread_source"] = "BAML actual"

    # Credit spread 3M direction
    if "ig_spread" in p.columns:
        p["ig_spread_3m_change"] = p["ig_spread"] - p["ig_spread"].shift(3)
    if "hy_spread_proxy" in p.columns:
        p["hy_spread_3m_change"] = p["hy_spread_proxy"] - p["hy_spread_proxy"].shift(3)

    # SPY 3M cumulative return
    p["spy_3m_return"] = (1 + p["spy_ret"]).rolling(3, min_periods=2).apply(
        lambda x: x.prod() - 1, raw=True
    )

    # STLFSI2 / DGS10-vol splice for MSS bond stress proxy
    # Normalise both to z-score (using their respective full-period stats)
    # then splice: STLFSI2 where available (ends 2022-01), DGS10 vol thereafter
    if "stlfsi2" in p.columns and "dgs10_realvol" in p.columns:
        # z-score both series
        stlfsi_vals = p["stlfsi2"].dropna()
        vol_vals    = p["dgs10_realvol"].dropna()
        if len(stlfsi_vals) > 0:
            z_stlfsi = (p["stlfsi2"] - stlfsi_vals.mean()) / stlfsi_vals.std()
            z_vol    = (p["dgs10_realvol"] - vol_vals.mean()) / vol_vals.std()
            splice   = z_stlfsi.combine_first(z_vol)   # prefer STLFSI2 where available
            p["bond_stress_proxy"] = splice
            p["bond_stress_source"] = "STLFSI2"
            mask_vol = p["stlfsi2"].isna() & p["dgs10_realvol"].notna()
            p.loc[mask_vol, "bond_stress_source"] = "DGS10_RealVol"
    elif "dgs10_realvol" in p.columns:
        vol_vals = p["dgs10_realvol"].dropna()
        p["bond_stress_proxy"] = (p["dgs10_realvol"] - vol_vals.mean()) / vol_vals.std()
        p["bond_stress_source"] = "DGS10_RealVol"

    return p


# ---------------------------------------------------------------------------
# Validate coverage
# ---------------------------------------------------------------------------
def validate_coverage(panel: pd.DataFrame) -> dict:
    issues = []
    summary = {}

    # Core MRS input columns
    core_cols = {
        "Growth Score": ["ipman_yoy", "nfp_3m_avg", "gdp_yoy", "indpro_yoy",
                         "real_serv_pce_yoy"],
        "Inflation Score": ["core_pce_yoy", "core_cpi_yoy", "t10yie_3m_change", "cpi_3m_accel"],
        "Rate/Liquidity Score": ["t10y2y", "real_ff_rate", "nfci", "ff_direction_3m"],
        "Credit/Risk Score": ["ig_spread", "hy_spread_proxy", "hy_spread_3m_change"],
        "Market Stress Score": ["vixcls", "vixcls_avg", "bond_stress_proxy",
                                "spy_3m_return"],
    }

    for component, cols in core_cols.items():
        comp_summary = {}
        for col in cols:
            if col not in panel.columns:
                issues.append({
                    "severity": "ERROR",
                    "component": component,
                    "series": col,
                    "issue": "Column missing from panel entirely"
                })
                comp_summary[col] = {"obs": 0, "first": None, "last": None, "gap": "MISSING"}
            else:
                valid = panel[col].dropna()
                n = len(valid)
                gap = panel[col].isna().sum()
                interior_gap = 0
                if n > 0:
                    first_i = panel[col].first_valid_index()
                    last_i  = panel[col].last_valid_index()
                    interior_gap = panel.loc[first_i:last_i, col].isna().sum()
                comp_summary[col] = {
                    "obs": n,
                    "first": valid.index.min().date() if n > 0 else None,
                    "last":  valid.index.max().date() if n > 0 else None,
                    "interior_nans": interior_gap,
                }
                if n < MIN_OBS_SCORE:
                    issues.append({
                        "severity": "WARNING",
                        "component": component,
                        "series": col,
                        "issue": f"Only {n} obs — fewer than {MIN_OBS_SCORE} minimum for reliable scoring"
                    })
                if interior_gap > 0:
                    issues.append({
                        "severity": "WARNING",
                        "component": component,
                        "series": col,
                        "issue": f"{interior_gap} interior NaN gaps"
                    })
        summary[component] = comp_summary

    return {"summary": summary, "issues": issues}


# ---------------------------------------------------------------------------
# Write validation log
# ---------------------------------------------------------------------------
def write_validation_log(panel: pd.DataFrame, val: dict) -> None:
    issues = val["issues"]
    summary = val["summary"]
    errors   = [i for i in issues if i["severity"] == "ERROR"]
    warnings = [i for i in issues if i["severity"] == "WARNING"]

    today = datetime.today().strftime("%Y-%m-%d")
    lines = [
        "# MRS Inputs — Data Validation Log",
        "",
        f"**Created**: {today}",
        f"**Script**: `src/process_mrs_inputs.py`",
        f"**Study period**: {panel.index.min().date()} to {panel.index.max().date()}",
        f"**Panel shape**: {panel.shape[0]} monthly rows × {panel.shape[1]} columns",
        "",
        "---",
        "",
        "## Summary",
        f"- Errors: {len(errors)}",
        f"- Warnings: {len(warnings)}",
        "",
        "---",
        "",
        "## Core MRS Input Coverage",
        "",
    ]

    for component, comp_cols in summary.items():
        lines += [f"### {component}", ""]
        lines += ["| Series | Obs | First Date | Last Date | Interior NaN |",
                  "|---|---|---|---|---|"]
        for col, s in comp_cols.items():
            lines.append(
                f"| {col} | {s['obs']} | {s['first'] or '—'} | {s['last'] or '—'} "
                f"| {s.get('interior_nans', s.get('gap','—'))} |"
            )
        lines.append("")

    if errors:
        lines += ["---", "", "## Errors", ""]
        for i in errors:
            lines.append(f"- **{i['component']}** | {i['series']}: {i['issue']}")
        lines.append("")

    if warnings:
        lines += ["---", "", "## Warnings", ""]
        for i in warnings:
            lines.append(f"- **{i['component']}** | {i['series']}: {i['issue']}")
        lines.append("")

    lines += [
        "---",
        "",
        "## Proxy and Data Issue Notes",
        "",
        "| Series | Issue | Resolution Used |",
        "|---|---|---|",
        "| ISM Manufacturing PMI | Bloomberg-only | IPMAN YoY% (Manufacturing IP, FRED IPMAN) |",
        "| MOVE Index | Bloomberg-only | STLFSI2 (2000-2022) spliced with DGS10 30D realized vol (2022+) |",
        "| BAMLH0A0HYM2 (HY OAS) | ICE licensing: FRED truncated to 2023+ | BAA10YM × 1.8 scaling (2000-2023) + BAML actual (2023+) |",
        "| BAMLC0A0CM (IG OAS) | ICE licensing: FRED truncated to 2023+ | BAA10YM (Moody's BAA-10Y spread) used as primary IG proxy |",
        "| VIX | Available via FRED VIXCLS | No proxy needed |",
        "",
        "---",
        "",
        "## Transformation Reference",
        "",
        "| Output Column | Source | Transformation |",
        "|---|---|---|",
        "| gdp_yoy | GDPC1 (quarterly) | Forward-filled to monthly; YoY% = (GDPC1_t/GDPC1_{t-4})-1 |",
        "| nfp_mom | PAYEMS (monthly) | MoM change from level |",
        "| nfp_3m_avg | nfp_mom | 3-month rolling average |",
        "| ipman_yoy | IPMAN (monthly) | YoY% = (val_t/val_{t-12})-1 |",
        "| core_pce_yoy | PCEPILFE (monthly) | YoY% |",
        "| core_cpi_yoy | CPILFESL (monthly) | YoY% |",
        "| t10y2y | T10Y2Y (daily) | Month-end level |",
        "| real_ff_rate | FEDFUNDS - core_cpi_yoy | Level minus YoY inflation |",
        "| nfci | NFCI (weekly) | Monthly average |",
        "| ig_spread | BAA10YM (monthly) | Level (Moody's BAA-10Y) |",
        "| vixcls | VIXCLS (daily) | Month-end level |",
        "| vixcls_avg | VIXCLS (daily) | Monthly average (v2.1 MSS input) |",
        "| vixcls_max | VIXCLS (daily) | Monthly maximum (dashboard context) |",
        "| real_serv_pce_yoy | PCES / DSERRG3M086SBEA | Real services consumption index, YoY% (v2.1 Growth input) |",
        "| bond_stress_proxy | STLFSI2 + DGS10 realvol | Z-score normalized; STLFSI2 primary |",
        "| spy_3m_return | SPY (monthly returns) | 3-month cumulative return |",
        "",
    ]

    MRS_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_LOG, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"  Validation log: {OUT_LOG.relative_to(REPO_ROOT)}")


# ---------------------------------------------------------------------------
# Build series metadata table
# ---------------------------------------------------------------------------
def build_metadata(panel: pd.DataFrame) -> pd.DataFrame:
    meta_map = {
        "gdp_yoy":          ("GDPC1", "Quarterly→Monthly", "YoY%", "FRED", "Growth Score"),
        "nfp_mom":          ("PAYEMS","Monthly",           "MoM change (thousands)", "FRED", "Growth Score"),
        "nfp_3m_avg":       ("PAYEMS","Monthly",           "3M rolling avg of MoM", "Derived", "Growth Score"),
        "indpro_yoy":       ("INDPRO","Monthly",           "YoY%", "FRED", "Growth Score"),
        "ipman_yoy":        ("IPMAN", "Monthly",           "YoY%", "FRED", "Growth Score"),
        "core_pce_yoy":     ("PCEPILFE","Monthly",         "YoY%", "FRED", "Inflation Score"),
        "core_cpi_yoy":     ("CPILFESL","Monthly",         "YoY%", "FRED", "Inflation Score"),
        "cpi_yoy":          ("CPIAUCSL","Monthly",         "YoY%", "FRED", "Inflation Score"),
        "t10yie":           ("T10YIE","Daily→Monthly",     "Month-end level", "FRED", "Inflation Score"),
        "t10yie_3m_change": ("T10YIE","Monthly",           "3M change in level", "Derived", "Inflation Score"),
        "cpi_3m_accel":     ("CPIAUCSL","Monthly",         "3M change in YoY%", "Derived", "Inflation Score"),
        "t10y2y":           ("T10Y2Y","Daily→Monthly",     "Month-end level (bps)", "FRED", "Rate/Liquidity Score"),
        "real_ff_rate":     ("FEDFUNDS+CPILFESL","Monthly","FEDFUNDS minus CoreCPI YoY", "Derived", "Rate/Liquidity Score"),
        "nfci":             ("NFCI","Weekly→Monthly",      "Monthly average", "FRED", "Rate/Liquidity Score"),
        "ff_direction_3m":  ("FEDFUNDS","Monthly",         "3M change in rate", "Derived", "Rate/Liquidity Score"),
        "fedfunds":         ("FEDFUNDS","Monthly",         "Level", "FRED", "Rate/Liquidity Score"),
        "ig_spread":        ("BAA10YM","Monthly",          "Level (%) — IG proxy (Moody's BAA-10Y)", "FRED proxy", "Credit/Risk Score"),
        "hy_spread_proxy":  ("BAA10YM + BAMLH0A0HYM2","Monthly","Spliced: BAA×1.8 pre-2023, BAML actual 2023+", "FRED/ICE proxy", "Credit/Risk Score"),
        "hy_spread_3m_change":("hy_spread_proxy","Monthly","3M change in HY proxy", "Derived", "Credit/Risk Score"),
        "vixcls":           ("VIXCLS","Daily→Monthly",     "Month-end level", "FRED", "Market Stress Score"),
        "vixcls_avg":       ("VIXCLS","Daily→Monthly",     "Monthly average (v2.1 MSS input)", "FRED", "Market Stress Score"),
        "vixcls_max":       ("VIXCLS","Daily→Monthly",     "Monthly maximum (context)", "FRED", "Market Stress Score"),
        "real_serv_pce_yoy":("PCES/DSERRG3M086SBEA","Monthly","Real services consumption YoY%", "Derived", "Growth Score"),
        "bond_stress_proxy":("STLFSI2+DGS10","Weekly+Daily","Z-score; STLFSI2 primary 2000-2022", "FRED spliced", "Market Stress Score"),
        "spy_3m_return":    ("SPY","Monthly",              "3M cumulative return", "Yahoo Finance", "Market Stress Score"),
        "usrec":            ("USREC","Monthly",            "Binary 0/1", "FRED/NBER", "All Components (cap)"),
    }

    rows = []
    for col, (source, freq, transform, data_source, component) in meta_map.items():
        if col in panel.columns:
            valid = panel[col].dropna()
            rows.append({
                "column":        col,
                "source_series": source,
                "source_tier":   data_source,
                "frequency_original": freq,
                "transformation": transform,
                "mrs_component":  component,
                "obs_count":      len(valid),
                "first_date":     valid.index.min().date() if len(valid) > 0 else None,
                "last_date":      valid.index.max().date() if len(valid) > 0 else None,
                "pct_missing":    round(panel[col].isna().mean() * 100, 1),
            })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 65)
    print("MRS Inputs — Processing and Monthly Alignment")
    print("=" * 65)

    (daily, macro_m, nfci_w, gdp_q, ipman, stlfsi_w, baa_m,
     pces_m, servdef_m, au) = load_raw()

    panel = build_monthly_panel(daily, macro_m, nfci_w, gdp_q, ipman,
                                stlfsi_w, baa_m, pces_m, servdef_m, au)
    panel = compute_derived(panel)

    print("\nDerived series computed:")
    derived_cols = ["gdp_yoy","nfp_mom","nfp_3m_avg","indpro_yoy","ipman_yoy",
                    "core_pce_yoy","core_cpi_yoy","real_ff_rate","ff_direction_3m",
                    "t10yie_3m_change","cpi_3m_accel","ig_spread","hy_spread_proxy",
                    "hy_spread_3m_change","bond_stress_proxy","spy_3m_return",
                    "real_serv_pce_yoy","vixcls_avg"]
    for c in derived_cols:
        if c in panel.columns:
            n = panel[c].notna().sum()
            first = panel[c].dropna().index.min().date() if n > 0 else "—"
            print(f"  {c:<26} {n:>3} obs  from {first}")

    # Validate
    val = validate_coverage(panel)
    issues = val["issues"]
    errors   = [i for i in issues if i["severity"] == "ERROR"]
    warnings = [i for i in issues if i["severity"] == "WARNING"]
    print(f"\nValidation: {len(errors)} errors, {len(warnings)} warnings")
    for i in errors + warnings:
        print(f"  [{i['severity']}] {i['component']} | {i['series']}: {i['issue']}")

    # Save outputs
    PROC_DIR.mkdir(parents=True, exist_ok=True)
    MRS_DIR.mkdir(parents=True, exist_ok=True)

    # Drop text/source columns from main CSV (keep only numeric + date)
    string_cols = [c for c in panel.columns
                   if panel[c].dtype == object and c != "date"]
    panel_numeric = panel.drop(columns=string_cols)
    panel_numeric.to_csv(OUT_PANEL)
    print(f"\nSaved: {OUT_PANEL.relative_to(REPO_ROOT)}  {panel_numeric.shape}")

    meta_df = build_metadata(panel)
    meta_df.to_csv(OUT_META, index=False)
    print(f"Saved: {OUT_META.relative_to(REPO_ROOT)}  {meta_df.shape}")

    write_validation_log(panel, val)

    # Final validation block
    print("\n--- Output Validation ---")
    loaded = pd.read_csv(OUT_PANEL, index_col=0, parse_dates=True)
    assert "core_pce_yoy" in loaded.columns, "Core PCE missing"
    assert "t10y2y" in loaded.columns, "Yield curve spread missing"
    assert "ig_spread" in loaded.columns, "IG spread missing"
    assert "vixcls" in loaded.columns, "VIX missing"
    assert "spy_3m_return" in loaded.columns, "SPY return missing"
    print(f"  Panel: {loaded.shape} OK")
    print(f"  Date range: {loaded.index.min().date()} to {loaded.index.max().date()} OK")
    print("--- End Validation ---")
    print("\nDone. Proceed to mrs_monitoring_store.py")


if __name__ == "__main__":
    main()
