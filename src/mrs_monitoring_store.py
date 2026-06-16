"""
MRS monitoring data store — implements Part VII of
Research/MRS/MRS_Methodology_and_Monitoring_Framework.md.

Builds the three canonical monthly tables every dashboard reads from:
  Research/MRS/monitoring/mrs_indicator_history.csv   (month x 13 indicators)
  Research/MRS/monitoring/mrs_pillar_history.csv      (month x 5 pillars)
  Research/MRS/monitoring/mrs_composite_history.csv   (month)
plus:
  Research/MRS/monitoring/mrs_active_flags.csv        (current-month flags, 7.4)
  Research/MRS/vintages/YYYY-MM/                      (snapshot of the 3 tables)
  Research/MRS/vintages/revision_log.csv              (confirmed-regime changes
                                                       vs the previous vintage)
  Research/MRS/MRS_Master.xlsx                        (single consolidated
                                                       workbook for paper/PPT/
                                                       dashboard consumption;
                                                       see build_master_workbook)

Derived-metric definitions (doc 7.1-7.5):
- direction_flag: sign of 3M z-change with a +/-0.10 dead-band
  -> improving / deteriorating / flat
- streak_months: consecutive months with the same direction_flag
- pctile_expanding: percentile of the current value within own scored history
- deterioration warning: deteriorating AND streak >= 3 AND 6M change < -0.25
  (improvement signal is the mirror image)
- regime-change watch: composite within 0.10 z of a threshold and moving
  toward it (3M change)
- breadth check: composite 6M move >= 0.25 is 'confirmed' if diffusion
  moved >= 15pp the same direction over 6M, else 'narrow'
- divergence: pillar direction has opposed the composite's for >= 3 months
- curve_env: bull/bear steepening / flattening on >=0.20pp 3M curve moves;
  bull steepening (front-end falling) raises a crisis-typical warning flag
- drift watch: expanding composite std vs the [0.45, 0.65] band; outside ->
  mandatory, non-discretionary threshold review (10Y rolling std is context)

Run monthly after the input panel refresh (process_mrs_inputs.py).
"""

import shutil
from pathlib import Path

import numpy as np
import pandas as pd

import mrs_proposed_framework as eng

MON_DIR = Path("outputs/monitoring")
VIN_DIR = Path("outputs/vintages")
MASTER_PATH = Path("outputs/MRS_Master.xlsx")

DEAD_BAND = 0.10        # z-units, direction-flag dead band
WARN_STREAK = 3         # months
WARN_6M = 0.25          # z-units, 6M-change magnitude for warnings
WATCH_DIST = 0.10       # z-units, distance-to-threshold watch
BREADTH_PP = 0.15       # diffusion move (fraction) confirming a composite move
DRIFT_BAND = (0.45, 0.65)  # expanding composite std; outside -> MANDATORY
                           # threshold review (doc 7.5, non-discretionary)
CURVE_MOVE = 0.20       # pp, 3M curve change that counts as steepening/flattening

PILLAR_OF = {c: p for p, cols in eng.PILLARS.items() for c in cols}
BOUNDS = sorted(eng.THRESHOLDS.values())  # [-1.0, -0.3, 0.35]


def expanding_pctile(s: pd.Series) -> pd.Series:
    """Percentile (0-100) of each value within own history up to that date."""
    v = s.dropna()
    out = v.expanding().apply(lambda w: (w <= w[-1]).mean() * 100, raw=True)
    return out.reindex(s.index)


def direction_flag(chg_3m: pd.Series) -> pd.Series:
    return pd.Series(
        np.select([chg_3m > DEAD_BAND, chg_3m < -DEAD_BAND],
                  ["improving", "deteriorating"],
                  default="flat"),
        index=chg_3m.index,
    ).where(chg_3m.notna(), "")


def streak(flags: pd.Series) -> pd.Series:
    runs = (flags != flags.shift()).cumsum()
    return flags.groupby(runs).cumcount() + 1


def add_motion(out: pd.DataFrame, s: pd.Series, prefix: str = "") -> None:
    """Shared 7.1/7.2 derived metrics for a score series."""
    out[f"{prefix}3m_chg"] = s.diff(3)
    out[f"{prefix}6m_chg"] = s.diff(6)
    out[f"{prefix}12m_chg"] = s.diff(12)
    out[f"{prefix}trend_6m"] = s.rolling(6).mean()
    out["pctile_expanding"] = expanding_pctile(s)
    out["direction_flag"] = direction_flag(out[f"{prefix}3m_chg"])
    out["streak_months"] = streak(out["direction_flag"])
    det = ((out["direction_flag"] == "deteriorating")
           & (out["streak_months"] >= WARN_STREAK)
           & (out[f"{prefix}6m_chg"] < -WARN_6M))
    imp = ((out["direction_flag"] == "improving")
           & (out["streak_months"] >= WARN_STREAK)
           & (out[f"{prefix}6m_chg"] > WARN_6M))
    out["warning"] = np.select([det, imp],
                               ["deterioration", "improvement"], default="")


def build_tables() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    df = pd.read_csv(eng.INPUT, parse_dates=["date"]).set_index("date")
    raw = eng.build_raw_indicators(df)
    ind, pillars = eng.build_indicators(df)
    res = eng.build_composite(ind, pillars, eng.PILLAR_WEIGHTS)

    # ---- Table 1: indicator history ----
    rows = []
    for code in ind.columns:
        t = pd.DataFrame(index=ind.index)
        t["indicator"] = code
        t["pillar"] = PILLAR_OF[code]
        t["raw_value"] = raw[code]
        t["z_score"] = ind[code]
        add_motion(t, ind[code], prefix="z_")
        t["expanding_mean_raw"] = raw[code].expanding(
            min_periods=eng.MIN_HISTORY).mean()
        t["expanding_std_raw"] = raw[code].expanding(
            min_periods=eng.MIN_HISTORY).std(ddof=1)
        rows.append(t[t["z_score"].notna()])
    indicator_hist = pd.concat(rows).rename_axis("date").reset_index()

    # ---- Table 2: pillar history ----
    rows = []
    for p, cols in pillars.items():
        t = pd.DataFrame(index=res.index)
        t["pillar"] = p
        t["score"] = res[p]
        t["contribution"] = res[f"contrib_{p}"]
        add_motion(t, res[p], prefix="score_")
        t["breadth"] = (ind[cols] > 0).mean(axis=1).where(
            ind[cols].notna().all(axis=1))
        t["regime_at_obs"] = res["regime"]
        rows.append(t[t["score"].notna()])
    pillar_hist = pd.concat(rows).rename_axis("date").reset_index()

    # ---- Table 3: composite history ----
    c = pd.DataFrame(index=res.index)
    z = res["composite"]
    c["composite"] = z
    c["display_score"] = res["display_score"]
    c["regime_raw"] = res["regime_raw"]
    c["regime_confirmed"] = res["regime"]
    c["comp_1m_chg"] = z.diff(1)
    add_motion(c, z, prefix="comp_")
    runs = (c["regime_confirmed"] != c["regime_confirmed"].shift()).cumsum()
    c["months_in_regime"] = c.groupby(runs).cumcount() + 1
    c["dist_to_upgrade"] = z.map(
        lambda v: min((b - v for b in BOUNDS if b > v), default=np.nan))
    c["dist_to_downgrade"] = z.map(
        lambda v: min((v - b for b in BOUNDS if b <= v), default=np.nan))
    c["diffusion"] = (ind > 0).mean(axis=1).where(ind.notna().all(axis=1))
    contrib = res[[f"contrib_{p}" for p in eng.PILLAR_WEIGHTS]].dropna()
    c["top_drag"] = contrib.idxmin(axis=1).str.replace("contrib_", "")
    c["top_support"] = contrib.idxmax(axis=1).str.replace("contrib_", "")
    c["regime_change_watch"] = (
        ((c["dist_to_downgrade"] <= WATCH_DIST) & (c["comp_3m_chg"] < 0))
        | ((c["dist_to_upgrade"] <= WATCH_DIST) & (c["comp_3m_chg"] > 0)))
    diff6 = c["diffusion"].diff(6)
    big_move = c["comp_6m_chg"].abs() >= WARN_6M
    confirmed = big_move & (diff6 * np.sign(c["comp_6m_chg"]) >= BREADTH_PP)
    c["breadth_check"] = np.select([confirmed, big_move],
                                   ["confirmed", "narrow"], default="")
    # drift watch (doc 7.5): expanding std is the scale the thresholds were
    # calibrated to; the 10Y rolling std is informational context only
    c["comp_expanding_std"] = z.expanding(min_periods=eng.MIN_HISTORY).std()
    c["comp_rolling_std_10y"] = z.rolling(120).std()

    # yield-curve environment (doc 7.4): steepening driven by front-end cuts
    # (bull) is crisis-typical — l_curve "improvement" is then suspect
    curve3, front3 = df["t10y2y"].diff(3), df["dgs2"].diff(3)
    c["curve_env"] = np.select(
        [(curve3 > CURVE_MOVE) & (front3 < -CURVE_MOVE),
         (curve3 > CURVE_MOVE),
         (curve3 < -CURVE_MOVE)],
        ["bull_steepening", "bear_steepening", "flattening"], default="")
    c["usrec"] = df["usrec"]
    composite_hist = c[c["composite"].notna()].rename_axis(
        "date").reset_index()

    # pillar-vs-composite divergence (needs composite direction)
    comp_dir = composite_hist.set_index("date")["direction_flag"]
    opposed = {("improving", "deteriorating"), ("deteriorating", "improving")}
    div = pillar_hist.apply(
        lambda r: (r["direction_flag"],
                   comp_dir.get(r["date"], "")) in opposed, axis=1)
    runs = (div != div.shift()).cumsum()
    div_streak = div.groupby([pillar_hist["pillar"], runs]).cumcount() + 1
    pillar_hist["divergence"] = div & (div_streak >= WARN_STREAK)

    return indicator_hist, pillar_hist, composite_hist


def active_flags(ind_h, pil_h, comp_h) -> pd.DataFrame:
    """Current-month flag summary across all three levels (doc 7.4)."""
    last = comp_h["date"].max()
    flags = []

    c = comp_h[comp_h["date"] == last].iloc[0]
    if c["warning"]:
        flags.append(("composite", "MRS", f"{c['warning']} warning",
                      round(c["comp_6m_chg"], 3)))
    if c["regime_change_watch"]:
        nearest = ("downgrade" if c["dist_to_downgrade"]
                   <= c["dist_to_upgrade"] else "upgrade")
        flags.append(("composite", "MRS", f"regime-change watch ({nearest})",
                      round(min(c["dist_to_downgrade"],
                                c["dist_to_upgrade"]), 3)))
    if c["breadth_check"] == "narrow":
        flags.append(("composite", "MRS", "narrow move (low breadth)",
                      round(c["comp_6m_chg"], 3)))
    if c["curve_env"] == "bull_steepening":
        flags.append(("composite", "MRS",
                      "bull steepening — l_curve improvement is crisis-typical,"
                      " interpret liquidity pillar with caution", None))

    for _, r in pil_h[pil_h["date"] == last].iterrows():
        if r["warning"]:
            flags.append(("pillar", r["pillar"], f"{r['warning']} warning",
                          round(r["score_6m_chg"], 3)))
        if r["divergence"]:
            flags.append(("pillar", r["pillar"], "diverging from composite",
                          round(r["score_3m_chg"], 3)))

    for _, r in ind_h[ind_h["date"] == last].iterrows():
        if r["warning"]:
            flags.append(("indicator", r["indicator"],
                          f"{r['warning']} warning",
                          round(r["z_6m_chg"], 3)))

    return pd.DataFrame(flags, columns=["level", "name", "flag", "magnitude"])


def snapshot_and_revision_log(tables: dict, vintage: str) -> None:
    prior = sorted(d.name for d in VIN_DIR.iterdir()
                   if d.is_dir() and d.name < vintage) if VIN_DIR.exists() \
        else []
    vdir = VIN_DIR / vintage
    vdir.mkdir(parents=True, exist_ok=True)
    for name, path in tables.items():
        shutil.copy2(path, vdir / Path(path).name)

    if not prior:
        print(f"Vintage {vintage} written (first vintage; no revision check)")
        return
    prev = prior[-1]
    old = pd.read_csv(VIN_DIR / prev / "mrs_composite_history.csv",
                      usecols=["date", "regime_confirmed"])
    new = pd.read_csv(tables["composite"],
                      usecols=["date", "regime_confirmed"])
    merged = old.merge(new, on="date", suffixes=("_old", "_new"))
    changed = merged[merged["regime_confirmed_old"]
                     != merged["regime_confirmed_new"]]
    if not changed.empty:
        log = changed.assign(vintage_old=prev, vintage_new=vintage)
        log_path = VIN_DIR / "revision_log.csv"
        log.to_csv(log_path, mode="a", header=not log_path.exists(),
                   index=False)
    print(f"Vintage {vintage} written; {len(changed)} confirmed-regime "
          f"revisions vs {prev}")


def regime_periods(comp_h: pd.DataFrame) -> pd.DataFrame:
    """Contiguous confirmed-regime blocks, for chart shading/legends."""
    df = comp_h.loc[comp_h["regime_confirmed"].notna()
                     & (comp_h["regime_confirmed"] != "N/A"),
                     ["date", "regime_confirmed"]]
    runs = (df["regime_confirmed"] != df["regime_confirmed"].shift()).cumsum()
    return (df.groupby(runs)
              .agg(regime=("regime_confirmed", "first"),
                   start_date=("date", "first"),
                   end_date=("date", "last"),
                   n_months=("date", "size"))
              .reset_index(drop=True))


def build_master_workbook(ind_h: pd.DataFrame, pil_h: pd.DataFrame,
                           comp_h: pd.DataFrame, flags: pd.DataFrame) -> None:
    """Consolidate the monitoring tables into one workbook (Appendix B):
      Composite       - mrs_composite_history, one row per month
      Pillars_Wide    - one row per month, score + contribution per pillar
      Pillars_Long    - mrs_pillar_history (long form, all derived fields)
      Indicators_Wide - one row per month, raw value + z-score per indicator
      Indicators_Long - mrs_indicator_history (long form, all derived fields)
      Regime_Periods  - contiguous confirmed-regime blocks for shading
      Active_Flags    - current-month 7.4 flag summary
      Metadata        - version, refresh timestamp, data coverage
    """
    pillar_order = list(eng.PILLAR_WEIGHTS)
    piv_score = pil_h.pivot(index="date", columns="pillar", values="score")
    piv_contrib = pil_h.pivot(index="date", columns="pillar",
                               values="contribution")
    pillars_wide = pd.concat(
        [piv_score[pillar_order].add_suffix("_score"),
         piv_contrib[pillar_order].add_suffix("_contribution")], axis=1,
    ).reset_index()

    ind_order = [c for cols in eng.PILLARS.values() for c in cols]
    piv_raw = ind_h.pivot(index="date", columns="indicator",
                           values="raw_value")
    piv_z = ind_h.pivot(index="date", columns="indicator", values="z_score")
    indicators_wide = pd.concat(
        [piv_raw[ind_order].add_suffix("_raw"),
         piv_z[ind_order].add_suffix("_z")], axis=1,
    ).reset_index()

    last = comp_h.iloc[-1]
    metadata = pd.DataFrame([
        ("version", "v2.1"),
        ("generated_at", pd.Timestamp.now().strftime("%Y-%m-%d %H:%M")),
        ("data_from", str(comp_h["date"].min().date())),
        ("data_through", str(comp_h["date"].max().date())),
        ("n_months", len(comp_h)),
        ("latest_regime_confirmed", last["regime_confirmed"]),
        ("latest_composite_z", round(last["composite"], 4)),
        ("latest_display_score", round(last["display_score"], 4)),
        ("source", "Src/mrs_monitoring_store.py"),
    ], columns=["field", "value"])

    with pd.ExcelWriter(MASTER_PATH, engine="openpyxl") as writer:
        comp_h.round(4).to_excel(writer, sheet_name="Composite", index=False)
        pillars_wide.round(4).to_excel(writer, sheet_name="Pillars_Wide",
                                        index=False)
        pil_h.round(4).to_excel(writer, sheet_name="Pillars_Long", index=False)
        indicators_wide.round(4).to_excel(writer, sheet_name="Indicators_Wide",
                                           index=False)
        ind_h.round(4).to_excel(writer, sheet_name="Indicators_Long",
                                 index=False)
        regime_periods(comp_h).to_excel(writer, sheet_name="Regime_Periods",
                                         index=False)
        flags.to_excel(writer, sheet_name="Active_Flags", index=False)
        metadata.to_excel(writer, sheet_name="Metadata", index=False)


def main() -> None:
    MON_DIR.mkdir(parents=True, exist_ok=True)
    ind_h, pil_h, comp_h = build_tables()

    paths = {
        "indicator": MON_DIR / "mrs_indicator_history.csv",
        "pillar": MON_DIR / "mrs_pillar_history.csv",
        "composite": MON_DIR / "mrs_composite_history.csv",
    }
    ind_h.round(4).to_csv(paths["indicator"], index=False)
    pil_h.round(4).to_csv(paths["pillar"], index=False)
    comp_h.round(4).to_csv(paths["composite"], index=False)

    flags = active_flags(ind_h, pil_h, comp_h)
    flags.to_csv(MON_DIR / "mrs_active_flags.csv", index=False)

    last = comp_h.iloc[-1]
    vintage = pd.Timestamp(last["date"]).strftime("%Y-%m")
    snapshot_and_revision_log({k: str(v) for k, v in paths.items()}, vintage)

    build_master_workbook(ind_h, pil_h, comp_h, flags)
    print(f"\n=== MRS monitoring store — {vintage} ===")
    print(f"Master workbook: {MASTER_PATH}")
    print(f"Tables: {len(ind_h)} indicator rows, {len(pil_h)} pillar rows, "
          f"{len(comp_h)} composite rows")
    print(f"Regime: {last['regime_confirmed']} "
          f"(month {int(last['months_in_regime'])}), composite "
          f"{last['composite']:+.3f}, 3m chg {last['comp_3m_chg']:+.3f}, "
          f"pctile {last['pctile_expanding']:.0f}, "
          f"diffusion {last['diffusion']:.0%}")
    print(f"Top drag: {last['top_drag']}, top support: "
          f"{last['top_support']}")
    std_exp = last["comp_expanding_std"]
    drift = "OK" if DRIFT_BAND[0] <= std_exp <= DRIFT_BAND[1] else "REVIEW"
    print(f"Drift watch: expanding composite std {std_exp:.3f} "
          f"[band {DRIFT_BAND[0]}-{DRIFT_BAND[1]}] -> {drift} "
          f"(10Y rolling: {last['comp_rolling_std_10y']:.3f}, context only)")
    print(f"\nActive flags ({len(flags)}):")
    print(flags.to_string(index=False) if len(flags) else "  none")


if __name__ == "__main__":
    main()
