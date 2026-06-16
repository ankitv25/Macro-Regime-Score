"""
Macro Regime Score (MRS) v2.1 scoring engine.

Official spec: methodology/MRS_Methodology.md.
v2.1 (2026-06-11): adds g_serv (real services PCE YoY) to Growth (13
indicators total) and moves s_vix from month-end to monthly-average
sampling. Thresholds unchanged from v2.0 calibration.

Design (per MRS redesign spec, 2026-06):
- Normalization: expanding-window z-score per indicator (min 24 months of
  history, current observation included, ddof=1), clipped to +/-3.
  This follows OFR FSI / Chicago Fed NFCI practice (standardize using all
  data "up until that date") and avoids the percentile->uniform compression
  that broke the predecessor framework.
- 13 indicators across 5 pillars, equal weight within each pillar:
    Growth (30%):    z(nfp_3m_avg), z(ipman_yoy), z(gdp_yoy), z(real_serv_pce_yoy)
    Inflation (15%): -z(|core_pce_yoy - 2|), -z(6M change core_pce_yoy)
    Liquidity (15%): -z(nfci), z(t10y2y)
    Credit (20%):    -z(ig_spread), -z(6M change ig_spread)
    Stress (20%):    -z(vixcls_avg), -z(bond_stress_proxy), z(spy drawdown)
- Composite = weighted sum of pillar scores, stays in z-units.
  Display score = 3 + z, clipped to [1, 5].
- Regimes (composite units; calibrated in backtest because averaging
  correlated z-scores compresses the composite to std ~0.55):
  Expansion >= +0.35, Neutral [-0.30, +0.35), Slowdown [-1.00, -0.30),
  Contraction < -1.00.
- Stability: a regime change is confirmed only after 2 consecutive months
  in the new regime (Conference Board-style persistence rule).

Outputs when run standalone (outputs/backtest/):
- mrs_proposed_scores.csv      indicator z's, pillar scores, composite, regime
- mrs_proposed_event_table.csv proposed vs current MRS across key macro events
Diagnostics (regime frequencies, stability, pillar contributions,
threshold/weight sensitivity) print to stdout.
"""

import numpy as np
import pandas as pd
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
INPUT = str(REPO_ROOT / "data" / "processed" / "mrs_inputs_monthly.csv")

# v1.0 comparison file — set to None since legacy outputs are not included
# in the public repo. The standalone backtest skips the v1.0 comparison
# section when CURRENT is None or the path does not exist.
CURRENT = None

OUT_DIR = str(REPO_ROOT / "outputs" / "backtest")

MIN_HISTORY = 24
Z_CLIP = 3.0

PILLAR_WEIGHTS = {
    "growth": 0.30,
    "inflation": 0.15,
    "liquidity": 0.15,
    "credit": 0.20,
    "stress": 0.20,
}

# regime thresholds in composite units (lower bound inclusive), calibrated
# to the composite's empirical scale (std ~0.55 after averaging)
THRESHOLDS = {"expansion": 0.35, "neutral": -0.30, "slowdown": -1.00}
CONFIRM_MONTHS = 2  # months in new regime before a switch is confirmed

EVENTS = [
    ("GFC", "2008-09", "2009-06"),
    ("Euro debt crisis", "2011-08", "2011-12"),
    ("China/EM 2015", "2015-08", "2016-02"),
    ("COVID crash", "2020-02", "2020-05"),
    ("2022 inflation bear", "2022-01", "2022-12"),
    ("2003-04 expansion", "2003-06", "2004-06"),
    ("2017 expansion", "2017-01", "2017-12"),
    ("2021 reopening", "2021-03", "2021-12"),
]


def expanding_z(s: pd.Series) -> pd.Series:
    """Expanding-window z-score: standardize each point against all history
    up to and including that date. Requires MIN_HISTORY observations."""
    mean = s.expanding(min_periods=MIN_HISTORY).mean()
    std = s.expanding(min_periods=MIN_HISTORY).std(ddof=1)
    z = (s - mean) / std
    return z.clip(-Z_CLIP, Z_CLIP)


def classify(z: float) -> str:
    if np.isnan(z):
        return "N/A"
    if z >= THRESHOLDS["expansion"]:
        return "Expansion"
    if z >= THRESHOLDS["neutral"]:
        return "Neutral"
    if z >= THRESHOLDS["slowdown"]:
        return "Slowdown"
    return "Contraction"


def confirm_regimes(raw: pd.Series) -> pd.Series:
    """Persistence rule: a regime switch is recognized only after the raw
    regime has spent CONFIRM_MONTHS consecutive months in the new state."""
    vals = raw.tolist()
    out = [vals[0]]
    for i in range(1, len(vals)):
        if (vals[i] != out[-1]
                and vals[i - CONFIRM_MONTHS + 1:i + 1]
                == [vals[i]] * CONFIRM_MONTHS):
            out.append(vals[i])
        else:
            out.append(out[-1])
    return pd.Series(out, index=raw.index)


# sign convention: +1 if high raw values are favorable, -1 if adverse
SIGNS = {
    "g_nfp": 1, "g_ipman": 1, "g_gdp": 1, "g_serv": 1,
    "i_pce_dev": -1, "i_pce_mom": -1,
    "l_nfci": -1, "l_curve": 1,
    "c_ig_level": -1, "c_ig_mom": -1,
    "s_vix": -1, "s_bond": -1, "s_spy_dd": 1,
}

PILLARS = {
    "growth": ["g_nfp", "g_ipman", "g_gdp", "g_serv"],
    "inflation": ["i_pce_dev", "i_pce_mom"],
    "liquidity": ["l_nfci", "l_curve"],
    "credit": ["c_ig_level", "c_ig_mom"],
    "stress": ["s_vix", "s_bond", "s_spy_dd"],
}


def build_raw_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Untransformed (pre-z) indicator series, one column per indicator."""
    raw = pd.DataFrame(index=df.index)

    # Growth (g_serv added v2.1: real services consumption — services are
    # ~70% of GDP and were previously unrepresented)
    raw["g_nfp"] = df["nfp_3m_avg"]
    raw["g_ipman"] = df["ipman_yoy"]
    raw["g_gdp"] = df["gdp_yoy"]
    raw["g_serv"] = df["real_serv_pce_yoy"]

    # Inflation — deviation from 2% target (level) and 6M momentum
    raw["i_pce_dev"] = (df["core_pce_yoy"] - 2.0).abs()
    raw["i_pce_mom"] = df["core_pce_yoy"].diff(6)

    # Liquidity / rates
    raw["l_nfci"] = df["nfci"]
    raw["l_curve"] = df["t10y2y"]

    # Credit — level and 6M momentum of IG spread
    raw["c_ig_level"] = df["ig_spread"]
    raw["c_ig_mom"] = df["ig_spread"].diff(6)

    # Market stress (s_vix on monthly average since v2.1: month-end snapshots
    # scored Volmageddon/SVB/Aug-24 intra-month stress as calm)
    raw["s_vix"] = df["vixcls_avg"]
    raw["s_bond"] = df["bond_stress_proxy"]
    cum = (1.0 + df["spy_ret"].fillna(0)).cumprod()
    raw["s_spy_dd"] = cum / cum.cummax() - 1.0

    return raw


def build_indicators(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    raw = build_raw_indicators(df)
    ind = pd.DataFrame(
        {c: SIGNS[c] * expanding_z(raw[c]) for c in raw.columns},
        index=raw.index,
    )
    return ind, PILLARS


def build_composite(ind: pd.DataFrame, pillars: dict,
                    weights: dict) -> pd.DataFrame:
    out = pd.DataFrame(index=ind.index)
    for name, cols in pillars.items():
        out[name] = ind[cols].mean(axis=1, skipna=True)
        # require every indicator in the pillar before the pillar goes live
        out.loc[ind[cols].isna().any(axis=1), name] = np.nan
    contrib = pd.DataFrame(
        {n: out[n] * w for n, w in weights.items()}, index=out.index
    )
    out["composite"] = contrib.sum(axis=1, min_count=len(weights))
    out.loc[out[list(weights)].isna().any(axis=1), "composite"] = np.nan
    for n in weights:
        out[f"contrib_{n}"] = contrib[n]
    out["display_score"] = (3.0 + out["composite"]).clip(1.0, 5.0)
    out["regime_raw"] = out["composite"].map(classify)
    out["regime"] = confirm_regimes(out["regime_raw"])
    return out


def regime_stats(series: pd.Series, label: str) -> None:
    valid = series[series != "N/A"]
    print(f"\n--- Regime frequencies ({label}, n={len(valid)}) ---")
    freq = valid.value_counts(normalize=True)
    for r in ["Expansion", "Neutral", "Slowdown", "Contraction"]:
        print(f"  {r:<12} {freq.get(r, 0.0):6.1%}")
    transitions = int((valid != valid.shift()).sum() - 1)
    runs = (valid != valid.shift()).cumsum()
    avg_dur = valid.groupby(runs).size().mean()
    print(f"  transitions: {transitions}, avg regime duration: "
          f"{avg_dur:.1f} months")


def main() -> None:
    df = pd.read_csv(INPUT, parse_dates=["date"]).set_index("date")
    ind, pillars = build_indicators(df)
    res = build_composite(ind, pillars, PILLAR_WEIGHTS)
    res["usrec"] = df["usrec"]

    # v1.0 comparison — only runs when CURRENT is set and the file exists
    has_v1 = (CURRENT is not None and Path(CURRENT).exists())
    if has_v1:
        cur = pd.read_csv(CURRENT, parse_dates=["date"]).set_index("date")
        res["mrs_current"] = cur["MRS"]
        res["regime_current"] = cur["regime"]

    valid = res.dropna(subset=["composite"])
    print(f"Composite coverage: {valid.index.min():%Y-%m} .. "
          f"{valid.index.max():%Y-%m} ({len(valid)} months)")

    # --- distribution ---
    print("\n--- Composite distribution (z-units) ---")
    print(valid["composite"].describe().round(3).to_string())

    regime_stats(res["regime_raw"], "proposed, raw")
    regime_stats(res["regime"], "proposed, 2m-confirmed")
    if has_v1:
        regime_stats(res["regime_current"].fillna("N/A"), "current (v1)")

    print("\n--- Contraction entry lag from confirmation rule ---")
    for label, a, b in [("GFC", "2008-01", "2009-12"),
                        ("COVID", "2020-01", "2020-12")]:
        r = res.loc[a:b]
        raw_first = r.index[r["regime_raw"] == "Contraction"].min()
        conf_first = r.index[r["regime"] == "Contraction"].min()
        print(f"  {label}: raw {raw_first:%Y-%m}, confirmed {conf_first:%Y-%m}")

    # --- monthly volatility ---
    print(f"\nMoM |change| of composite: "
          f"{valid['composite'].diff().abs().mean():.3f} z")

    # --- crisis minimums ---
    print("\n--- Crisis minimums ---")
    for name, start, end in EVENTS[:5]:
        w = valid.loc[start:end]
        if w.empty:
            continue
        i = w["composite"].idxmin()
        print(f"  {name:<22} min z {w['composite'].min():+.2f} "
              f"({i:%Y-%m}, regime {w.loc[i, 'regime']})")

    # --- event table ---
    rows = []
    for name, start, end in EVENTS:
        w = valid.loc[start:end]
        if w.empty:
            continue
        rows.append({
            "event": name, "start": start, "end": end,
            "proposed_mean_z": round(w["composite"].mean(), 2),
            "proposed_min_z": round(w["composite"].min(), 2),
            "proposed_modal_regime": w["regime"].mode().iat[0],
            "pct_contraction": round((w["regime"] == "Contraction").mean(), 2),
        })
    events = pd.DataFrame(rows)
    print("\n--- Event table ---")
    print(events.to_string(index=False))

    # --- NBER alignment ---
    rec = valid[valid["usrec"] == 1]
    print(f"\nNBER recession months in sample: {len(rec)}; "
          f"proposed regime during recessions: "
          f"{rec['regime'].value_counts().to_dict()}")
    contr = valid[valid["regime"] == "Contraction"]
    print(f"Contraction months: {len(contr)}; of those in NBER recession: "
          f"{int((contr['usrec'] == 1).sum())}")

    # --- pillar contributions in crises ---
    print("\n--- Mean pillar contribution to composite (z-units) ---")
    contrib_cols = [f"contrib_{n}" for n in PILLAR_WEIGHTS]
    crisis = valid.loc["2008-09":"2009-06"]
    covid = valid.loc["2020-02":"2020-05"]
    summary = pd.DataFrame({
        "full_sample": valid[contrib_cols].mean(),
        "GFC": crisis[contrib_cols].mean(),
        "COVID": covid[contrib_cols].mean(),
    }).round(3)
    print(summary.to_string())

    # --- sensitivity: equal pillar weights ---
    eq = build_composite(ind, pillars, {n: 0.2 for n in PILLAR_WEIGHTS})
    both = pd.concat([res["composite"], eq["composite"]], axis=1).dropna()
    both.columns = ["proposed", "equal"]
    agree = (res.loc[both.index, "regime"]
             == eq.loc[both.index, "regime"]).mean()
    print(f"\nEqual-weight sensitivity: corr "
          f"{both['proposed'].corr(both['equal']):.3f}, "
          f"regime agreement {agree:.1%}")
    regime_stats(eq.loc[both.index, "regime"], "equal-weight")

    # --- threshold sensitivity ---
    print("\n--- Threshold sensitivity (frequencies) ---")
    for hi, mid, lo in [(0.35, -0.30, -1.00), (0.40, -0.30, -1.00),
                        (0.30, -0.30, -1.00), (0.35, -0.25, -0.90),
                        (0.50, -0.50, -1.50)]:
        z = valid["composite"]
        f = [
            (z >= hi).mean(),
            ((z >= mid) & (z < hi)).mean(),
            ((z >= lo) & (z < mid)).mean(),
            (z < lo).mean(),
        ]
        print(f"  exp>={hi:+.2f} / slow<{mid:+.2f} / contr<{lo:+.2f}:  "
              f"Exp {f[0]:.1%}  Neu {f[1]:.1%}  Slow {f[2]:.1%}  "
              f"Contr {f[3]:.1%}")

    # --- outputs ---
    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    drop_cols = []
    if has_v1:
        drop_cols = ["mrs_current", "regime_current"]
    scores = pd.concat([ind, res.drop(columns=drop_cols)], axis=1)
    scores.round(4).to_csv(f"{OUT_DIR}/mrs_proposed_scores.csv")
    events.to_csv(f"{OUT_DIR}/mrs_proposed_event_table.csv", index=False)
    print(f"\nWrote outputs to {OUT_DIR}/")


if __name__ == "__main__":
    main()
