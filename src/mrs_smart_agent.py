"""
MRS Smart Refresh Agent
=======================
Single autonomous entry-point for the complete MRS refresh lifecycle.

The agent inspects the current store state, checks data availability against
the indicator release schedule, picks the right execution path, validates all
outputs, runs boundary checks, and writes a timestamped handoff log — every
single run, without any user decisions required mid-flow.

Decision paths
--------------
  FULL_UPDATE    — binding indicators have new data beyond data_through
                   → update_mrs.py (FRED pull → process → score → export)
  REBUILD_ONLY   — no binding data yet but JSON may be stale
                   → refresh_dashboard.py (CSV → JSON, no FRED pull)
  NO_ACTION      — JSON matches monitoring CSVs and nothing is past due
                   → boundary checks + handoff only

Boundary checks (always run regardless of path)
-------------------------------------------------
  • Drift watch: expanding std ∈ [0.45, 0.65]
  • Regime proximity: dist_to_downgrade/upgrade < 0.10z → critical, < 0.30z → watch
  • Confirmation window: regime_raw ≠ regime_confirmed → report month 1 or 2
  • 2-month rule: confirm_month flag active
  • Forecast staleness: manifest as_of > 60 days → warn; > 90 days → alert
  • Overdue indicators: next_release date in manifest is past due by > 14 days
  • Commentary gap: no analyst note for the current data month

Usage
-----
  python src/mrs_smart_agent.py                   # auto-detect path
  python src/mrs_smart_agent.py --force-full      # force FRED pull + full pipeline
  python src/mrs_smart_agent.py --force-rebuild   # force JSON rebuild from CSVs
  python src/mrs_smart_agent.py --dry-run         # check only, write nothing
  python src/mrs_smart_agent.py --check-fred      # try a live FRED ping
  python src/mrs_smart_agent.py --no-git          # skip git status reporting
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd

# ── Repo layout ───────────────────────────────────────────────────────────────
REPO_ROOT     = Path(__file__).resolve().parent.parent
SRC_DIR       = REPO_ROOT / "src"
MON_DIR       = REPO_ROOT / "outputs" / "monitoring"
DASH_DATA_DIR = REPO_ROOT / "dashboard" / "data"
CONFIG_DIR    = REPO_ROOT / "config"
OUTPUTS_DIR   = REPO_ROOT / "outputs"

COMPOSITE_CSV = MON_DIR / "mrs_composite_history.csv"
PILLAR_CSV    = MON_DIR / "mrs_pillar_history.csv"
IND_CSV       = MON_DIR / "mrs_indicator_history.csv"
FLAGS_CSV     = MON_DIR / "mrs_active_flags.csv"
MANIFEST      = CONFIG_DIR / "refresh_manifest.json"
METADATA_JSON = DASH_DATA_DIR / "metadata.json"
COMMENTARY    = DASH_DATA_DIR / "commentary.json"

# ── MRS constants (must match mrs_monitoring_store.py) ───────────────────────
DRIFT_BAND        = (0.45, 0.65)
REGIME_THRESHOLDS = {"expansion": 0.35, "neutral": -0.30, "slowdown": -1.00}
REGIME_ORDER      = ["Contraction", "Slowdown", "Neutral", "Expansion"]
ALL_INDICATORS    = [
    "g_nfp", "g_ipman", "g_gdp", "g_serv",
    "i_pce_dev", "i_pce_mom",
    "l_nfci", "l_curve",
    "c_ig_level", "c_ig_mom",
    "s_vix", "s_bond", "s_spy_dd",
]
ALL_PILLARS = ["growth", "inflation", "liquidity", "credit", "stress"]

# Binding indicators: require a FRED pull and monthly scoring run before the
# composite for a new month can be computed.  Market indicators update with
# each month-end market close and are picked up without a formal FRED pull.
BINDING_INDICATORS  = {"g_nfp", "g_ipman", "g_gdp", "g_serv", "i_pce_dev", "i_pce_mom"}
MARKET_INDICATORS   = {"l_nfci", "l_curve", "c_ig_level", "c_ig_mom", "s_vix", "s_bond", "s_spy_dd"}

FORECAST_STALE_WARN  = 60   # days — warn if manifest as_of is older than this
FORECAST_STALE_ALERT = 90   # days — alert if older than this
OVERDUE_GRACE        = 14   # days — flag an indicator as overdue after this many days past next_release
PROXIMITY_CRITICAL   = 0.10 # z — dist to threshold: immediate watch
PROXIMITY_WATCH      = 0.30 # z — dist to threshold: elevated watch

# ── Console formatting ────────────────────────────────────────────────────────
def _c(t, code): return f"\033[{code}m{t}\033[0m"
def green(t):   return _c(t, "32")
def yellow(t):  return _c(t, "33")
def red(t):     return _c(t, "31")
def bold(t):    return _c(t, "1")
def dim(t):     return _c(t, "2")
def cyan(t):    return _c(t, "36")
def magenta(t): return _c(t, "35")

def _section(title: str):
    bar = "━" * 65
    print(f"\n{bold(bar)}")
    print(f"  {bold(title)}")
    print(bold(bar))

def _ok(msg):    print(green(f"  ✓  {msg}"))
def _warn(msg):  print(yellow(f"  ⚠  {msg}"))
def _alert(msg): print(red(f"  ✗  {msg}"))
def _info(msg):  print(f"     {msg}")
def _step(msg):  print(f"\n  {bold('▶')}  {msg}")


# ═══════════════════════════════════════════════════════════════════════════════
#  Phase 1 — AWARENESS: read current store state
# ═══════════════════════════════════════════════════════════════════════════════

class StoreState:
    """Snapshot of current monitoring CSV state."""
    data_through: str | None     = None
    composite: float | None      = None
    regime_raw: str | None       = None
    regime_confirmed: str | None = None
    display_score: float | None  = None
    months_in_regime: int | None = None
    comp_expanding_std: float | None = None
    dist_to_downgrade: float | None  = None
    dist_to_upgrade: float | None    = None
    comp_3m_chg: float | None    = None
    direction_flag: str | None   = None
    n_scored_months: int         = 0
    n_active_flags: int          = 0
    flag_detail: list            = []
    json_data_through: str | None = None
    json_generated_at: str | None = None
    manifest_as_of: str | None   = None


def load_store_state() -> StoreState:
    s = StoreState()
    if not COMPOSITE_CSV.exists():
        return s

    comp = pd.read_csv(COMPOSITE_CSV, parse_dates=["date"])
    scored = comp.dropna(subset=["composite"])
    s.n_scored_months = len(scored)
    if scored.empty:
        return s

    last = scored.iloc[-1]
    s.data_through        = str(last["date"])[:10]
    s.composite           = _safe_float(last.get("composite"))
    s.regime_raw          = str(last.get("regime_raw", ""))
    s.regime_confirmed    = str(last.get("regime_confirmed", ""))
    s.display_score       = _safe_float(last.get("display_score"))
    s.months_in_regime    = _safe_int(last.get("months_in_regime"))
    s.comp_expanding_std  = _safe_float(last.get("comp_expanding_std"))
    s.dist_to_downgrade   = _safe_float(last.get("dist_to_downgrade"))
    s.dist_to_upgrade     = _safe_float(last.get("dist_to_upgrade"))
    s.comp_3m_chg         = _safe_float(last.get("comp_3m_chg"))
    s.direction_flag      = str(last.get("direction_flag", ""))

    if FLAGS_CSV.exists():
        flags = pd.read_csv(FLAGS_CSV)
        s.n_active_flags = len(flags)
        s.flag_detail    = flags.to_dict("records")

    if METADATA_JSON.exists():
        try:
            meta = json.loads(METADATA_JSON.read_text())
            s.json_data_through = meta.get("data_through")
            s.json_generated_at = meta.get("generated_at")
        except Exception:
            pass

    if MANIFEST.exists():
        try:
            man = json.loads(MANIFEST.read_text())
            s.manifest_as_of = man.get("forecast_as_of")
        except Exception:
            pass

    return s


def _safe_float(v) -> float | None:
    try:
        f = float(v)
        return None if pd.isna(f) else f
    except (TypeError, ValueError):
        return None


def _safe_int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# ═══════════════════════════════════════════════════════════════════════════════
#  Phase 2 — DATA AVAILABILITY: what's new since the last run?
# ═══════════════════════════════════════════════════════════════════════════════

class DataAvailability:
    path: str              = "NO_ACTION"   # FULL_UPDATE | REBUILD_ONLY | NO_ACTION
    reason: str            = ""
    next_month: str        = ""            # YYYY-MM of the month we want to add
    binding_due: list      = []            # binding indicators past next_release today
    binding_pending: list  = []            # binding indicators not yet released
    market_due: list       = []            # market indicators past next_release
    overdue: list          = []            # indicators past their release by > grace period
    manifest_loaded: bool  = False


def check_data_availability(state: StoreState, check_fred: bool = False) -> DataAvailability:
    da = DataAvailability()

    if state.data_through is None:
        da.path   = "FULL_UPDATE"
        da.reason = "No monitoring data found — initial build"
        return da

    today = date.today()
    data_through_d = date.fromisoformat(state.data_through)

    # What month comes next?
    if data_through_d.month == 12:
        next_m_year, next_m_month = data_through_d.year + 1, 1
    else:
        next_m_year, next_m_month = data_through_d.year, data_through_d.month + 1
    da.next_month = f"{next_m_year:04d}-{next_m_month:02d}"

    # Load manifest release schedule
    if not MANIFEST.exists():
        da.path   = "REBUILD_ONLY"
        da.reason = "No manifest found — running JSON rebuild from existing CSVs"
        return da

    try:
        manifest = json.loads(MANIFEST.read_text())
        da.manifest_loaded = True
    except Exception:
        da.path   = "REBUILD_ONLY"
        da.reason = "Manifest parse error — running JSON rebuild from existing CSVs"
        return da

    indicators = manifest.get("indicators", {})
    for code, cfg in indicators.items():
        nr = cfg.get("next_release", "")
        if not nr:
            continue
        try:
            nr_d = date.fromisoformat(nr)
        except ValueError:
            continue

        is_binding = code in BINDING_INDICATORS
        past_due   = nr_d <= today
        overdue    = (today - nr_d).days > OVERDUE_GRACE

        if past_due:
            if is_binding:
                da.binding_due.append(code)
            else:
                da.market_due.append(code)
            if overdue:
                da.overdue.append((code, nr, (today - nr_d).days))
        else:
            if is_binding:
                da.binding_pending.append(code)

    # Decision logic
    all_binding_due = len(da.binding_pending) == 0 and len(da.binding_due) >= len(BINDING_INDICATORS)

    if check_fred:
        fred_confirms = _ping_fred_for_new_data(state.data_through)
    else:
        fred_confirms = None  # not checked

    if all_binding_due:
        if fred_confirms is False:
            # Release dates are past but FRED doesn't have the data yet
            da.path   = "REBUILD_ONLY"
            da.reason = (
                f"All binding indicator release dates have passed "
                f"but FRED ping found no data beyond {state.data_through} — "
                f"running JSON rebuild only; retry full update tomorrow"
            )
        else:
            da.path   = "FULL_UPDATE"
            da.reason = (
                f"All {len(da.binding_due)} binding indicators are past their release "
                f"dates for month {da.next_month} — full pipeline warranted"
            )
    elif len(da.binding_due) > 0:
        da.path   = "REBUILD_ONLY"
        da.reason = (
            f"{len(da.binding_due)} binding indicator(s) released "
            f"({', '.join(da.binding_due)}) but {len(da.binding_pending)} pending "
            f"({', '.join(da.binding_pending)}) — rebuilding JSON from existing CSVs; "
            f"full update available once all binding indicators release"
        )
    else:
        # Check if JSON is stale vs monitoring CSVs
        csv_through = state.data_through
        json_through = state.json_data_through
        if json_through is None or json_through < csv_through:
            da.path   = "REBUILD_ONLY"
            da.reason = (
                f"Dashboard JSON (data_through={json_through}) is behind "
                f"monitoring CSVs ({csv_through}) — rebuilding JSON"
            )
        else:
            da.path   = "NO_ACTION"
            da.reason = (
                f"No binding indicators released yet for {da.next_month} "
                f"and dashboard JSON is current (data_through={json_through})"
            )

    return da


def _ping_fred_for_new_data(current_data_through: str) -> bool | None:
    """
    Lightweight FRED ping: pull latest NFCI weekly value.
    Returns True if newer data exists, False if not, None if ping fails.
    NFCI is a good canary: it's released weekly and is one of our indicators.
    """
    try:
        import pandas_datareader.data as web
        dt = date.fromisoformat(current_data_through)
        # NFCI is weekly; if any data is available after data_through, new month is likely ready
        start = (dt + timedelta(days=1)).strftime("%Y-%m-%d")
        end   = date.today().strftime("%Y-%m-%d")
        s = web.DataReader("NFCI", "fred", start, end)
        return len(s) > 0
    except ImportError:
        return None
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════════════════════════
#  Phase 3 — EXECUTION: run the right pipeline path
# ═══════════════════════════════════════════════════════════════════════════════

class RunResult:
    path_taken: str = ""
    steps_run: list = []
    new_months: list = []
    success: bool = False
    errors: list = []
    warnings: list = []
    state_before: StoreState | None = None
    state_after: StoreState | None  = None
    validate_passed: bool = False
    validate_output: str = ""
    validation_errors: list = []
    validation_warnings: list = []


def run_script(name: str, script: Path, args: list[str] | None = None,
               dry_run: bool = False) -> tuple[bool, str]:
    """Run a pipeline script via subprocess. Returns (success, output)."""
    cmd = [sys.executable, str(script)] + (args or [])
    _step(f"Running {name}")
    _info(" ".join(str(c) for c in cmd))

    if dry_run:
        _warn("  --dry-run: skipping actual execution")
        return True, "(dry-run — not executed)"

    env = os.environ.copy()
    env["PYTHONPATH"] = str(SRC_DIR)
    t0 = time.time()
    result = subprocess.run(
        cmd, capture_output=True, text=True, env=env, cwd=str(REPO_ROOT)
    )
    elapsed = time.time() - t0

    output = ((result.stdout or "") + (result.stderr or "")).strip()
    lines  = [l for l in output.split("\n") if l.strip()]

    for line in lines[-12:]:
        print(dim(f"    {line}"))

    if result.returncode == 0:
        _ok(f"{name} — OK ({elapsed:.1f}s)")
        return True, output
    else:
        _alert(f"{name} — FAILED (exit {result.returncode})")
        return False, output


def execute_full_update(dry_run: bool) -> RunResult:
    """Full pipeline: FRED pull → process → score → export → forecast."""
    result = RunResult()
    result.path_taken = "FULL_UPDATE"

    scripts = [
        ("FRED data pull",       SRC_DIR / "pull_mrs_data.py",     None),
        ("Monthly panel build",  SRC_DIR / "process_mrs_inputs.py", None),
        ("MRS v2.1 engine",      SRC_DIR / "mrs_monitoring_store.py", None),
        ("Dashboard JSON export",SRC_DIR / "refresh_dashboard.py",  ["--skip-validate"]),
        ("Forecast inputs",      SRC_DIR / "generate_forecast_inputs.py", None),
    ]

    for label, path, extra_args in scripts:
        ok_, output = run_script(label, path, extra_args, dry_run=dry_run)
        result.steps_run.append(label)
        if not ok_:
            result.errors.append(f"{label} failed")
            _alert(f"Pipeline halted at: {label}")
            # Attempt fallback to rebuild if scoring fails
            if "export" in label.lower() or "forecast" in label.lower():
                continue  # non-fatal — try to keep going
            else:
                result.success = False
                return result

    result.success = True
    return result


def execute_rebuild_only(dry_run: bool) -> RunResult:
    """Rebuild dashboard JSON from existing monitoring CSVs."""
    result = RunResult()
    result.path_taken = "REBUILD_ONLY"

    scripts = [
        ("Dashboard JSON rebuild",  SRC_DIR / "refresh_dashboard.py",         ["--skip-validate"]),
        ("Forecast inputs refresh", SRC_DIR / "generate_forecast_inputs.py",  None),
    ]

    for label, path, extra_args in scripts:
        ok_, output = run_script(label, path, extra_args, dry_run=dry_run)
        result.steps_run.append(label)
        if not ok_:
            result.errors.append(f"{label} failed")
            result.success = False
            return result

    result.success = True
    return result


def execute_no_action(dry_run: bool) -> RunResult:
    """Nothing to update — still regenerate forecast inputs to stay current."""
    result = RunResult()
    result.path_taken = "NO_ACTION"

    _info("JSON is current — regenerating forecast inputs only")
    ok_, _ = run_script(
        "Forecast inputs refresh", SRC_DIR / "generate_forecast_inputs.py",
        None, dry_run=dry_run
    )
    result.steps_run.append("Forecast inputs refresh")
    result.success = ok_
    if not ok_:
        result.errors.append("Forecast inputs refresh failed")
    return result


# ═══════════════════════════════════════════════════════════════════════════════
#  Phase 4 — VALIDATION
# ═══════════════════════════════════════════════════════════════════════════════

def run_validation(run_result: RunResult, dry_run: bool) -> None:
    _step("Running validation gate")
    if dry_run:
        _warn("--dry-run: skipping validation")
        run_result.validate_passed = True
        run_result.validate_output = "(dry-run)"
        return

    env  = os.environ.copy()
    env["PYTHONPATH"] = str(SRC_DIR)
    res  = subprocess.run(
        [sys.executable, str(SRC_DIR / "validate_dashboard.py"), "--verbose"],
        capture_output=True, text=True, env=env, cwd=str(REPO_ROOT)
    )
    output = ((res.stdout or "") + (res.stderr or "")).strip()
    run_result.validate_output = output

    for line in output.split("\n"):
        if line.strip():
            print(dim(f"    {line}"))

    if res.returncode == 0:
        run_result.validate_passed = True
        _ok("Validation passed")
    else:
        run_result.validate_passed = False
        _alert("Validation FAILED — do not publish until resolved")
        run_result.errors.append("Validation failed")


# ═══════════════════════════════════════════════════════════════════════════════
#  Phase 5 — BOUNDARY CHECKS
# ═══════════════════════════════════════════════════════════════════════════════

class BoundaryReport:
    critical: list = []   # must address before publishing
    watch: list    = []   # monitor; not blocking
    clear: list    = []   # explicitly all-clear items


def run_boundary_checks(state: StoreState, da: DataAvailability) -> BoundaryReport:
    br = BoundaryReport()
    br.critical = []
    br.watch    = []
    br.clear    = []
    today = date.today()

    # ── 1. Drift watch ────────────────────────────────────────────────────────
    std = state.comp_expanding_std
    if std is not None:
        lo, hi = DRIFT_BAND
        if lo <= std <= hi:
            br.clear.append(f"Drift watch OK: expanding std {std:.3f} ∈ [{lo}, {hi}]")
        elif std < lo:
            br.critical.append(
                f"DRIFT ALERT: expanding std {std:.3f} < {lo} (too compressed) — "
                f"mandatory threshold review (methodology §7.5)"
            )
        else:
            br.critical.append(
                f"DRIFT ALERT: expanding std {std:.3f} > {hi} (too dispersed) — "
                f"mandatory threshold review (methodology §7.5)"
            )
    else:
        br.watch.append("Expanding std unavailable — cannot confirm drift watch")

    # ── 2. Regime threshold proximity ────────────────────────────────────────
    dist_d = state.dist_to_downgrade
    dist_u = state.dist_to_upgrade
    if dist_d is not None:
        if dist_d < PROXIMITY_CRITICAL:
            br.critical.append(
                f"DOWNGRADE CRITICAL: {dist_d:.3f}z from downgrade threshold — "
                f"2-month confirmation clock likely to start next reading"
            )
        elif dist_d < PROXIMITY_WATCH:
            br.watch.append(
                f"Downgrade watch: {dist_d:.3f}z from threshold (alert at {PROXIMITY_CRITICAL}z)"
            )
        else:
            br.clear.append(f"No downgrade risk: {dist_d:.3f}z from threshold")

    if dist_u is not None:
        if dist_u < PROXIMITY_CRITICAL:
            br.watch.append(
                f"Upgrade proximity: {dist_u:.3f}z from upgrade threshold"
            )
        elif dist_u < PROXIMITY_WATCH:
            br.watch.append(
                f"Upgrade watch: {dist_u:.3f}z from threshold (alert at {PROXIMITY_CRITICAL}z)"
            )

    # ── 3. 2-month confirmation rule ─────────────────────────────────────────
    r_raw  = state.regime_raw
    r_conf = state.regime_confirmed
    if r_raw and r_conf and r_raw != r_conf:
        br.watch.append(
            f"CONFIRMATION WINDOW ACTIVE: regime_raw={r_raw} ≠ regime_confirmed={r_conf} — "
            f"this is month 1 of a potential regime change; needs 2 consecutive months to confirm"
        )
    elif r_raw and r_conf and r_raw == r_conf:
        br.clear.append(f"Regime confirmed: {r_conf} (raw agrees — no pending change)")

    # ── 4. Direction + momentum ───────────────────────────────────────────────
    chg = state.comp_3m_chg
    if chg is not None:
        if chg <= -0.20:
            br.watch.append(f"Momentum deteriorating: 3M Δ = {chg:+.3f}z — pace of slowdown elevated")
        elif chg >= 0.20:
            br.watch.append(f"Momentum improving: 3M Δ = {chg:+.3f}z — pace of expansion elevated")
        else:
            br.clear.append(f"Momentum neutral: 3M Δ = {chg:+.3f}z")

    # ── 5. Forecast staleness ────────────────────────────────────────────────
    if state.manifest_as_of:
        try:
            as_of_d = date.fromisoformat(state.manifest_as_of)
            age = (today - as_of_d).days
            if age > FORECAST_STALE_ALERT:
                br.critical.append(
                    f"FORECAST STALE: manifest as_of = {state.manifest_as_of} ({age} days ago) — "
                    f"update config/refresh_manifest.json and rerun generate_forecast_inputs.py"
                )
            elif age > FORECAST_STALE_WARN:
                br.watch.append(
                    f"Forecast aging: manifest as_of = {state.manifest_as_of} ({age} days ago) — "
                    f"consider reviewing delta arrays in refresh_manifest.json"
                )
            else:
                br.clear.append(f"Forecast current: manifest as_of = {state.manifest_as_of} ({age} days ago)")
        except ValueError:
            br.watch.append(f"Cannot parse manifest as_of: {state.manifest_as_of}")
    else:
        br.watch.append("Manifest not loaded — forecast staleness cannot be confirmed")

    # ── 6. Overdue indicator releases ────────────────────────────────────────
    if da.manifest_loaded and da.overdue:
        for code, nr, days_late in da.overdue:
            if code in BINDING_INDICATORS:
                br.critical.append(
                    f"OVERDUE BINDING: {code} next_release was {nr} ({days_late} days ago) — "
                    f"update manifest next_release date or trigger full update"
                )
            else:
                br.watch.append(
                    f"Overdue market indicator: {code} next_release was {nr} ({days_late} days ago)"
                )
    elif da.manifest_loaded and not da.overdue:
        br.clear.append("All indicator release dates current (none overdue)")

    # ── 7. Active flags ───────────────────────────────────────────────────────
    n_flags = state.n_active_flags
    if n_flags == 0:
        br.clear.append("No active MRS flags")
    elif n_flags <= 2:
        br.watch.append(f"{n_flags} active flag(s) — monitor for escalation")
    else:
        br.critical.append(
            f"{n_flags} active flags — review pillar detail; "
            f"composite may be obscuring cross-pillar deterioration"
        )

    # ── 8. Commentary gap ────────────────────────────────────────────────────
    if COMMENTARY.exists() and state.data_through:
        try:
            notes = json.loads(COMMENTARY.read_text())
            month_key = state.data_through[:7]
            has_note  = any(k.startswith(month_key) for k in notes)
            if not has_note:
                br.watch.append(
                    f"No analyst note for {month_key} in commentary.json — "
                    f"add an entry before publishing"
                )
            else:
                br.clear.append(f"Analyst note present for {month_key}")
        except Exception:
            br.watch.append("commentary.json unreadable — verify format")

    return br


# ═══════════════════════════════════════════════════════════════════════════════
#  Phase 6 — HANDOFF FILE
# ═══════════════════════════════════════════════════════════════════════════════

def write_handoff(
    state: StoreState,
    da: DataAvailability,
    run_result: RunResult,
    br: BoundaryReport,
    dry_run: bool,
) -> Path:
    now  = datetime.now()
    slug = now.strftime("%Y-%m-%d_%H%M%S")
    out  = OUTPUTS_DIR / f"agent_run_log_{slug}.md"

    def yn(v): return "Yes" if v else "No"
    def na(v): return str(v) if v is not None else "N/A"

    lines = [
        f"# MRS Agent Run — {now.strftime('%Y-%m-%d %H:%M')}",
        "",
        "---",
        "",
        "## Run Summary",
        "",
        f"| Field | Value |",
        f"|---|---|",
        f"| Run time | {now.strftime('%Y-%m-%d %H:%M:%S')} |",
        f"| Dry run | {yn(dry_run)} |",
        f"| Decision path | **{run_result.path_taken}** |",
        f"| Path reason | {da.reason} |",
        f"| Steps executed | {', '.join(run_result.steps_run) or 'None'} |",
        f"| Execution success | {yn(run_result.success)} |",
        f"| Validation passed | {yn(run_result.validate_passed)} |",
        "",
        "---",
        "",
        "## Current MRS State (post-run)",
        "",
        f"| Field | Value |",
        f"|---|---|",
        f"| Data through | {na(state.data_through)} |",
        f"| Composite z | {f'{state.composite:+.4f}' if state.composite is not None else 'N/A'} |",
        f"| Display score | {f'{state.display_score:.2f}/5' if state.display_score is not None else 'N/A'} |",
        f"| Regime confirmed | **{na(state.regime_confirmed)}** |",
        f"| Regime raw | {na(state.regime_raw)} |",
        f"| Months in regime | {na(state.months_in_regime)} |",
        f"| 3M Δ composite | {f'{state.comp_3m_chg:+.3f}z' if state.comp_3m_chg is not None else 'N/A'} |",
        f"| Direction | {na(state.direction_flag)} |",
        f"| Expanding std | {f'{state.comp_expanding_std:.3f}' if state.comp_expanding_std is not None else 'N/A'} |",
        f"| Dist to downgrade | {f'{state.dist_to_downgrade:.3f}z' if state.dist_to_downgrade is not None else 'N/A'} |",
        f"| Dist to upgrade | {f'{state.dist_to_upgrade:.3f}z' if state.dist_to_upgrade is not None else 'N/A'} |",
        f"| Active flags | {state.n_active_flags} |",
        f"| Forecast as-of | {na(state.manifest_as_of)} |",
        f"| Dashboard JSON through | {na(state.json_data_through)} |",
        "",
        "---",
        "",
        "## Data Availability",
        "",
        f"- Next month target: **{da.next_month}**",
        f"- Binding indicators released: {', '.join(da.binding_due) or 'None'}",
        f"- Binding indicators pending:  {', '.join(da.binding_pending) or 'None'}",
        f"- Market indicators released:  {', '.join(da.market_due) or 'None'}",
    ]

    if da.overdue:
        lines.append("")
        lines.append("### Overdue Indicators")
        for code, nr, days_late in da.overdue:
            lines.append(f"- `{code}`: next_release was {nr} ({days_late} days ago)")

    lines += [
        "",
        "---",
        "",
        "## Boundary Checks",
        "",
    ]

    if br.critical:
        lines.append("### Critical (must address before next publish)")
        for c in br.critical:
            lines.append(f"- ✗ {c}")
        lines.append("")

    if br.watch:
        lines.append("### Watch (monitor)")
        for w in br.watch:
            lines.append(f"- ⚠ {w}")
        lines.append("")

    if br.clear:
        lines.append("### Clear")
        for cl in br.clear:
            lines.append(f"- ✓ {cl}")
        lines.append("")

    lines += [
        "---",
        "",
        "## Validation Output",
        "",
        "```",
    ]
    for line in run_result.validate_output.split("\n"):
        lines.append(line)
    lines += [
        "```",
        "",
        "---",
        "",
        "## Next Steps",
        "",
    ]

    # Derive next steps
    next_steps = _derive_next_steps(state, da, run_result, br)
    for i, step in enumerate(next_steps, 1):
        lines.append(f"{i}. {step}")

    lines += [
        "",
        "---",
        "",
        "## Refresh Commands Reference",
        "",
        "```bash",
        "# Auto-detect and run (recommended):",
        "python src/mrs_smart_agent.py",
        "",
        "# Force full pipeline (FRED pull + score + export):",
        "python src/mrs_smart_agent.py --force-full",
        "",
        "# Force JSON rebuild from monitoring CSVs (no FRED pull):",
        "python src/mrs_smart_agent.py --force-rebuild",
        "",
        "# Validate only:",
        "python src/validate_dashboard.py --verbose",
        "",
        "# Full pipeline manually:",
        "python src/update_mrs.py",
        "```",
        "",
        "---",
        "",
        f"*MRS v2.1 · Agent run by mrs_smart_agent.py · {now.strftime('%Y-%m-%d %H:%M')}*",
    ]

    if not dry_run:
        OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
        out.write_text("\n".join(lines))

    return out


def _derive_next_steps(
    state: StoreState,
    da: DataAvailability,
    run_result: RunResult,
    br: BoundaryReport,
) -> list[str]:
    steps = []

    # Errors first
    if run_result.errors:
        steps.append(f"**Fix errors**: {'; '.join(run_result.errors)}")

    if not run_result.validate_passed:
        steps.append(
            "**Resolve validation failures** — run `python src/validate_dashboard.py --verbose` "
            "and address each ✗ before publishing"
        )

    # Critical boundary items
    for c in br.critical:
        steps.append(f"**Address critical**: {c[:120]}")

    # Data availability next action
    if da.path == "FULL_UPDATE" and run_result.success:
        month_key = state.data_through or "YYYY-MM"
        steps.append(
            f"Add analyst note to `dashboard/data/commentary.json` for month {month_key[:7]}"
        )
        steps.append(
            f"Commit and push: "
            f"`git add outputs/monitoring/ dashboard/data/ && "
            f"git commit -m 'MRS update: {month_key[:7]}' && git push origin main`"
        )
        steps.append("Dashboard deploys automatically via GitHub Actions (~60s)")

    elif da.path == "REBUILD_ONLY" and run_result.success:
        if da.binding_pending:
            pending_str = ", ".join(da.binding_pending)
            steps.append(
                f"Await remaining binding indicator(s): {pending_str} — "
                f"then rerun `python src/mrs_smart_agent.py` for full update"
            )
        steps.append(
            f"Commit JSON rebuild if you want to publish updated forecast paths: "
            f"`git add dashboard/data/ && git commit -m 'MRS JSON rebuild' && git push origin main`"
        )

    elif da.path == "NO_ACTION":
        if da.binding_pending:
            pending_str = ", ".join(da.binding_pending)
            steps.append(
                f"Await binding indicator releases ({pending_str}) then rerun the agent"
            )
        else:
            steps.append("No data action needed — check back after next indicator releases")

    # Watch items
    for w in br.watch:
        if "commentary" in w.lower():
            steps.append(f"Add analyst note: {w[:100]}")
        elif "confirmation" in w.lower():
            steps.append(f"Monitor next month carefully: {w[:120]}")
        elif "manifest" in w.lower() or "forecast" in w.lower():
            steps.append(f"Update forecast assumptions: `config/refresh_manifest.json` → rerun `generate_forecast_inputs.py`")

    if not steps:
        steps.append("Nothing required — system is current and all checks clear")

    return steps


# ═══════════════════════════════════════════════════════════════════════════════
#  Phase 7 — GIT STATUS
# ═══════════════════════════════════════════════════════════════════════════════

def print_git_status():
    try:
        result = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "status", "--short"],
            capture_output=True, text=True
        )
        if result.returncode == 0 and result.stdout.strip():
            _info("Uncommitted changes:")
            for line in result.stdout.strip().split("\n"):
                _info(f"  {line}")
        else:
            _ok("Working tree clean")

        log = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "log", "--oneline", "-3"],
            capture_output=True, text=True
        )
        if log.returncode == 0:
            _info("Recent commits:")
            for line in log.stdout.strip().split("\n"):
                _info(f"  {line}")
    except Exception:
        _warn("Could not read git status")


# ═══════════════════════════════════════════════════════════════════════════════
#  Console summary
# ═══════════════════════════════════════════════════════════════════════════════

def print_summary(
    state: StoreState,
    da: DataAvailability,
    run_result: RunResult,
    br: BoundaryReport,
    handoff_path: Path,
):
    _section("MRS AGENT — FINAL SUMMARY")

    # Current state block
    if state.composite is not None:
        comp_col = (green if state.composite >= 0.35
                    else red if state.composite < -0.30 else yellow)
        print(f"\n  {bold('Composite:')}    {comp_col(f'{state.composite:+.3f} z')}  "
              f"(display {state.display_score:.2f}/5)")
        print(f"  {bold('Regime:')}       {bold(str(state.regime_confirmed))}  "
              f"·  month {state.months_in_regime}  ·  {state.direction_flag}")
        if state.comp_3m_chg is not None:
            chg_col = green if state.comp_3m_chg > 0 else red
            print(f"  {bold('3M Δ:')}         {chg_col(f'{state.comp_3m_chg:+.3f} z')}")
        print(f"  {bold('Data through:')} {state.data_through}")
        print(f"  {bold('Active flags:')} {state.n_active_flags}")

    # Run result
    print()
    path_col = green if run_result.success else red
    print(f"  {bold('Path taken:')}   {path_col(run_result.path_taken)}")
    print(f"  {bold('Steps run:')}    {', '.join(run_result.steps_run) or 'None'}")
    print(f"  {bold('Validated:')}    {'✓ PASS' if run_result.validate_passed else '✗ FAIL'}")

    # Boundary summary
    print()
    if br.critical:
        print(f"  {bold(red(f'⚑ {len(br.critical)} CRITICAL'))} boundary check(s):")
        for c in br.critical:
            _alert(f"    {c[:90]}")
    if br.watch:
        print(f"  {bold(yellow(f'⚠ {len(br.watch)} WATCH'))} item(s):")
        for w in br.watch:
            _warn(f"    {w[:90]}")
    if not br.critical and not br.watch:
        _ok("All boundary checks clear")

    # Data availability
    print()
    if da.binding_pending:
        _warn(f"Pending binding indicator(s): {', '.join(da.binding_pending)}")
        _info(f"Next full update available after release of: "
              f"{', '.join(da.binding_pending)}")
    elif da.path == "FULL_UPDATE":
        _ok(f"Full update completed through {state.data_through}")

    # Errors
    if run_result.errors:
        print()
        for e in run_result.errors:
            _alert(e)

    # Handoff
    print()
    if handoff_path.exists():
        _ok(f"Handoff log: {handoff_path.relative_to(REPO_ROOT)}")
    print()


# ═══════════════════════════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="MRS Smart Refresh Agent — autonomous end-to-end refresh",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Decision paths:
  FULL_UPDATE   — all binding indicators released → FRED pull + score + export
  REBUILD_ONLY  — JSON may be stale, no new binding data → CSV → JSON rebuild
  NO_ACTION     — everything current → forecast inputs refresh + boundary check

Examples:
  python src/mrs_smart_agent.py                 Auto-detect (recommended)
  python src/mrs_smart_agent.py --force-full    Force FRED pull + full pipeline
  python src/mrs_smart_agent.py --force-rebuild Force JSON rebuild from CSVs
  python src/mrs_smart_agent.py --dry-run       Audit only — write nothing
  python src/mrs_smart_agent.py --check-fred    Ping FRED to confirm data
  python src/mrs_smart_agent.py --no-git        Skip git status output
        """,
    )
    parser.add_argument("--force-full",    action="store_true",
                        help="Force full pipeline regardless of data availability")
    parser.add_argument("--force-rebuild", action="store_true",
                        help="Force JSON rebuild from monitoring CSVs only")
    parser.add_argument("--dry-run",       action="store_true",
                        help="Run all checks and decision logic but write nothing")
    parser.add_argument("--check-fred",    action="store_true",
                        help="Attempt live FRED ping to confirm data availability")
    parser.add_argument("--no-git",        action="store_true",
                        help="Skip git status reporting")
    args = parser.parse_args()

    if args.force_full and args.force_rebuild:
        print(red("Error: --force-full and --force-rebuild are mutually exclusive"))
        sys.exit(1)

    # ── Banner ─────────────────────────────────────────────────────────────────
    _section(f"MRS SMART REFRESH AGENT  ·  {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    _info(f"Repo:  {REPO_ROOT}")
    _info(f"Flags: dry-run={args.dry_run}  force-full={args.force_full}  "
          f"force-rebuild={args.force_rebuild}  check-fred={args.check_fred}")

    # ── Phase 1: Awareness ─────────────────────────────────────────────────────
    _section("Phase 1 — Store Awareness")
    state = load_store_state()

    if state.data_through:
        _ok(f"Store: {state.n_scored_months} months  ·  data through {state.data_through}")
        _info(f"Composite: {state.composite:+.4f}z  ·  display {state.display_score:.2f}/5")
        _info(f"Regime: {state.regime_confirmed}  ·  month {state.months_in_regime}")
        _info(f"Active flags: {state.n_active_flags}")
        _info(f"Dashboard JSON through: {state.json_data_through or 'unknown'}")
        _info(f"Manifest as-of: {state.manifest_as_of or 'unknown'}")
    else:
        _warn("No monitoring data found — will attempt initial build")

    # ── Phase 2: Data availability ─────────────────────────────────────────────
    _section("Phase 2 — Data Availability Check")

    if args.force_full:
        da = DataAvailability()
        da.path   = "FULL_UPDATE"
        da.reason = "--force-full flag: skipping availability check"
        _warn("Forced full update — bypassing availability check")
    elif args.force_rebuild:
        da = DataAvailability()
        da.path   = "REBUILD_ONLY"
        da.reason = "--force-rebuild flag: JSON rebuild from monitoring CSVs"
        _warn("Forced rebuild — bypassing availability check")
    else:
        da = check_data_availability(state, check_fred=args.check_fred)

    path_labels = {
        "FULL_UPDATE":  green("FULL_UPDATE — run full pipeline"),
        "REBUILD_ONLY": yellow("REBUILD_ONLY — JSON rebuild from CSVs"),
        "NO_ACTION":    cyan("NO_ACTION — forecast refresh + boundary checks only"),
    }
    print(f"\n  Decision: {path_labels.get(da.path, da.path)}")
    _info(f"Reason:   {da.reason}")

    if da.binding_pending:
        _warn(f"Binding indicators not yet released: {', '.join(da.binding_pending)}")
    if da.binding_due:
        _ok(f"Binding indicators released:         {', '.join(da.binding_due)}")
    if da.overdue:
        for code, nr, days in da.overdue:
            _warn(f"Overdue: {code} (next_release={nr}, {days} days late)")

    # ── Phase 3: Execute ───────────────────────────────────────────────────────
    _section("Phase 3 — Execute")

    if da.path == "FULL_UPDATE":
        run_result = execute_full_update(dry_run=args.dry_run)
    elif da.path == "REBUILD_ONLY":
        run_result = execute_rebuild_only(dry_run=args.dry_run)
    else:
        run_result = execute_no_action(dry_run=args.dry_run)

    # Reload state after run (metrics may have changed)
    state = load_store_state()

    # ── Phase 4: Validate ──────────────────────────────────────────────────────
    _section("Phase 4 — Validate")
    run_validation(run_result, dry_run=args.dry_run)

    # ── Phase 5: Boundary checks ───────────────────────────────────────────────
    _section("Phase 5 — Boundary Checks")
    br = run_boundary_checks(state, da)

    if br.critical:
        for c in br.critical:
            _alert(c)
    if br.watch:
        for w in br.watch:
            _warn(w)
    if br.clear:
        for cl in br.clear:
            _ok(cl)

    # ── Git status ─────────────────────────────────────────────────────────────
    if not args.no_git:
        _section("Git Status")
        print_git_status()

    # ── Phase 6: Handoff ───────────────────────────────────────────────────────
    _section("Phase 6 — Handoff")
    handoff_path = write_handoff(state, da, run_result, br, dry_run=args.dry_run)
    if not args.dry_run and handoff_path.exists():
        _ok(f"Handoff written: {handoff_path.relative_to(REPO_ROOT)}")
    elif args.dry_run:
        _warn(f"--dry-run: handoff not written (would be: {handoff_path.relative_to(REPO_ROOT)})")

    # Also update the rolling refresh_log.md (human-readable latest run)
    if not args.dry_run:
        _update_rolling_log(state, da, run_result, br, handoff_path)
        _ok(f"Rolling log updated: outputs/refresh_log.md")

    # ── Final summary ──────────────────────────────────────────────────────────
    print_summary(state, da, run_result, br, handoff_path)

    # Exit code
    if not run_result.success or not run_result.validate_passed:
        sys.exit(1)
    sys.exit(0)


def _update_rolling_log(
    state: StoreState,
    da: DataAvailability,
    run_result: RunResult,
    br: BoundaryReport,
    handoff_path: Path,
):
    """Overwrite outputs/refresh_log.md with a summary of the latest agent run."""
    now = datetime.now()
    lines = [
        f"# MRS Refresh Log — last run {now.strftime('%Y-%m-%d %H:%M')}",
        "",
        f"**Path:** {run_result.path_taken}  |  "
        f"**Success:** {'Yes' if run_result.success else 'No'}  |  "
        f"**Validated:** {'Yes' if run_result.validate_passed else 'No'}",
        "",
        f"**Data through:** {state.data_through}  |  "
        f"**Regime:** {state.regime_confirmed}  |  "
        f"**Composite:** {f'{state.composite:+.4f}z' if state.composite is not None else 'N/A'}",
        "",
        f"**Reason:** {da.reason}",
        "",
    ]
    if br.critical:
        lines.append(f"**Critical:** {len(br.critical)} item(s)")
        for c in br.critical:
            lines.append(f"- {c}")
        lines.append("")
    if br.watch:
        lines.append(f"**Watch:** {len(br.watch)} item(s)")
        for w in br.watch:
            lines.append(f"- {w}")
        lines.append("")
    if not br.critical and not br.watch:
        lines.append("**Boundary checks:** All clear")
        lines.append("")
    lines.append(f"Full log: `{handoff_path.name}`")

    (OUTPUTS_DIR / "refresh_log.md").write_text("\n".join(lines))


if __name__ == "__main__":
    main()
