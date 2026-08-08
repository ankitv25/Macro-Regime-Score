# MRS Refresh Handoff

**Last updated:** 2026-08-08
**Live dashboard:** https://ankitv25.github.io/Macro-Regime-Score/
**Public repo:** https://github.com/ankitv25/Macro-Regime-Score
**Operational runbook:** [`UPDATING.md`](UPDATING.md) — read that first; this document covers the data contracts underneath it.

---

## Current State

Deliberately **not** restated here. A hand-maintained "current reading" table in a doc is a second copy of state that decays silently — the exact class of bug that froze the live dashboard for ten days in Jul–Aug 2026.

The single source of truth is the pipeline output:

```bash
# authoritative
cat dashboard/data/metadata.json
tail -3 outputs/monitoring/mrs_composite_history.csv
cat outputs/refresh_log.md          # summary of the last published run

# what the public is actually seeing
curl -s "https://ankitv25.github.io/Macro-Regime-Score/data/metadata.json?cb=$RANDOM"
```

The last two must agree. If they do not, the deploy is the problem, not the data — see `UPDATING.md` §2–3.

---

## Automation (the normal path)

```
GitHub Actions: .github/workflows/mrs-full-refresh.yml
  cron '30 14 * * *'  (daily, 14:30 UTC)
        ↓
  python src/mrs_gha_runner.py        ← runs Steps 1–6 below, end to end
        ↓
  new month  → commentary note + manifest advance + "MRS update: YYYY-MM"
  resync     → "MRS resync: YYYY-MM"
  no change  → commits nothing (timestamp-only diffs are discarded)
        ↓
  push to main as "MRS Agent" (GITHUB_TOKEN)
        ↓
GitHub Actions: .github/workflows/deploy-pages.yml
  triggered by workflow_run — NOT by push; GITHUB_TOKEN pushes do not raise
  push events, which is what broke the deploy for ten days in Jul–Aug 2026
        ↓
  GitHub Pages (~20s)
```

Everything below documents the pipeline the runner drives, the data contracts it must satisfy, and how to drive it by hand.

---

## Data Pipeline Map

```
Step 1  FRED + Yahoo pull
        python src/pull_mrs_data.py
        → data/raw/fred/*.csv   [GITIGNORED — must re-pull each time]

Step 2  Build monthly panel
        python src/process_mrs_inputs.py
        → data/processed/mrs_inputs_monthly.csv   [GITIGNORED]

Step 3  Score + monitoring tables
        PYTHONPATH=src python src/mrs_monitoring_store.py
        → outputs/monitoring/mrs_composite_history.csv   ← COMMITTED SOURCE OF TRUTH
        → outputs/monitoring/mrs_pillar_history.csv      ← COMMITTED SOURCE OF TRUTH
        → outputs/monitoring/mrs_indicator_history.csv   ← COMMITTED SOURCE OF TRUTH
        → outputs/monitoring/mrs_active_flags.csv        ← COMMITTED SOURCE OF TRUTH
        → outputs/MRS_Master.xlsx   [GITIGNORED — convenience workbook]
        → outputs/vintages/YYYY-MM/ [GITIGNORED — point-in-time snapshots]

Step 4a Export dashboard JSON via xlsx (ORIGINAL — requires Step 3 outputs)
        python src/export_dashboard_data.py
        → dashboard/data/*.json   ← COMMITTED, READ BY LIVE DASHBOARD

Step 4b Export dashboard JSON via CSVs (NEW — works without xlsx, full pipeline)
        python src/refresh_dashboard.py
        → dashboard/data/*.json   ← same output, reads from monitoring CSVs directly

Step 5  Regenerate forecast inputs
        python src/generate_forecast_inputs.py
        Reads:  config/refresh_manifest.json  (forecast deltas + metadata)
                outputs/monitoring/mrs_indicator_history.csv  (latest z-scores)
        Writes: dashboard/data/forecast_inputs.json

Step 6  Validate
        python src/validate_dashboard.py   → exits 1 if any check fails

Step 7  Commit + push
        git add outputs/monitoring/ outputs/refresh_log.md dashboard/data/ \
                config/refresh_manifest.json
        git commit -m "MRS update: YYYY-MM (Regime: X, z ±0.00)"
        git push origin main
        → deploy-pages.yml publishes dashboard/ to GitHub Pages (~20s)
```

### Orchestrators

| Command | Use |
|---|---|
| `python src/mrs_gha_runner.py` | **Steps 1–6, the one the automation runs.** Prefer this. |
| `python src/refresh_dashboard.py` | Steps 4b + 5 + 6 — rebuild JSON when the monitoring CSVs are already current |
| `python src/update_mrs.py` | Earlier full-pipeline orchestrator; superseded by `mrs_gha_runner.py` |
| `python src/mrs_smart_agent.py` | Earlier release-gated agent, driven by a claude.ai cloud routine; superseded — see Known Issues |

---

## File Map — What Does What

| File | Role | Committed? |
|---|---|---|
| `config/refresh_manifest.json` | **NEW**: Forecast assumptions (delta arrays per indicator) + indicator metadata. Edit when economic outlook changes. | Yes |
| `src/mrs_gha_runner.py` | **Pipeline orchestrator used by the daily GitHub Actions job** (Steps 1–6) + analyst note + manifest advance + `outputs/refresh_log.md`. Main entry point. | Yes |
| `src/update_mrs.py` | Earlier full-pipeline orchestrator (Steps 1–6). Superseded by `mrs_gha_runner.py`. | Yes |
| `src/mrs_smart_agent.py` | Earlier release-gated agent (cloud routine). Superseded; still writes `outputs/agent_run_log_*.md`. | Yes |
| `.github/workflows/mrs-full-refresh.yml` | Daily 14:30 UTC refresh + conditional commit. | Yes |
| `.github/workflows/deploy-pages.yml` | Publishes `dashboard/` to Pages on `workflow_run` of the refresh, on `push` to `dashboard/**`, or manually. | Yes |
| `outputs/refresh_log.md` | Human-readable summary of the last **published** run. Regenerated each run, committed only when the run publishes. | Yes |
| `src/pull_mrs_data.py` | Pull supplemental FRED series (IPMAN, BAA10YM, PCES, STLFSI2). | Yes |
| `src/process_mrs_inputs.py` | Align all raw data → monthly panel. STUDY_END now dynamic. | Yes |
| `src/mrs_monitoring_store.py` | v2.1 engine: score indicators → pillars → composite → monitoring tables + MRS_Master.xlsx. | Yes |
| `src/mrs_proposed_framework.py` | Core scoring engine (imported by monitoring_store). | Yes |
| `src/export_dashboard_data.py` | MRS_Master.xlsx → dashboard/data/*.json (requires xlsx). | Yes |
| `src/refresh_dashboard.py` | **NEW**: monitoring CSVs → dashboard/data/*.json (no xlsx needed). | Yes |
| `src/generate_forecast_inputs.py` | **NEW**: manifest + latest z-scores → forecast_inputs.json. | Yes |
| `src/validate_dashboard.py` | **NEW**: 8 validation checks on dashboard JSON files. | Yes |
| `outputs/monitoring/*.csv` | Ground-truth monitoring tables. The source of truth for the dashboard. | Yes |
| `outputs/MRS_Master.xlsx` | Consolidated workbook (rebuilt from CSVs). Convenience only. | No (gitignored) |
| `dashboard/data/*.json` | Dashboard data files (9 files). Read by live dashboard. | Yes |
| `dashboard/data/commentary.json` | Hand-authored monthly analyst notes. NOT overwritten by any script. | Yes |
| `dashboard/data/forecast_inputs.json` | 12-month forecast paths for Scenario tab + Overview table. Regenerated by `generate_forecast_inputs.py`. | Yes |
| `data/` | Raw FRED data (gitignored). Must re-pull on each new machine. | No (gitignored) |
| `UPDATING.md` | Step-by-step monthly update runbook. | Yes |

---

## Master File Discipline

### Source of Truth Hierarchy

```
Raw FRED data (data/raw/)
       ↓
Monthly panel (data/processed/mrs_inputs_monthly.csv)
       ↓
Monitoring CSVs (outputs/monitoring/*.csv)   ← THE AUTHORITATIVE SOURCE
       ↓                      ↓
Dashboard JSON              Forecast inputs
(dashboard/data/*.json)    (forecast_inputs.json via manifest)
       ↓
Live Dashboard (GitHub Pages)
```

### Monitoring CSV Schema

**`mrs_composite_history.csv`** — 26 columns, 1 row per month (2003-06 to present)
```
date, composite, display_score, regime_raw, regime_confirmed,
comp_1m_chg, comp_3m_chg, comp_6m_chg, comp_12m_chg, comp_trend_6m,
pctile_expanding, direction_flag, streak_months, warning,
months_in_regime, dist_to_upgrade, dist_to_downgrade,
diffusion, top_drag, top_support, regime_change_watch, breadth_check,
comp_expanding_std, comp_rolling_std_10y, curve_env, usrec
```

**`mrs_pillar_history.csv`** — 15 columns, long format (1 row per date × pillar)
```
date, pillar, score, contribution, score_3m_chg, score_6m_chg, score_12m_chg,
score_trend_6m, pctile_expanding, direction_flag, streak_months, warning,
breadth, regime_at_obs, divergence
```

**`mrs_indicator_history.csv`** — 15 columns, long format (1 row per date × indicator)
```
date, indicator, pillar, raw_value, z_score, z_3m_chg, z_6m_chg, z_12m_chg,
z_trend_6m, pctile_expanding, direction_flag, streak_months, warning,
expanding_mean_raw, expanding_std_raw
```

**`mrs_active_flags.csv`** — 4 columns, current month only
```
level, name, flag, magnitude
```

### Data Invariants (validated by `validate_dashboard.py`)

1. `metadata.data_through` == last date with non-null composite in `composite_history.json`
2. All 13 indicator z-score columns present in `indicators_wide.json`
3. No duplicate dates in any time-series file
4. `composite ≈ Σ(pillar_contribution)` (tolerance 0.01z)
5. `display_score = clip(composite + 3, 1, 5)` (tolerance 0.01)
6. `classify(composite) == regime_raw` for all rows
7. `forecast_inputs.json` has 13 indicators × 3 paths × 12 months each

### Guardrails on the Monitoring CSVs

- **Duplicate rows**: The monitoring_store rebuilds from scratch each run (no incremental append in the CSV). Duplicates cannot arise from a normal run.
- **Missing values**: z-scores are null for the first 24 months (MIN_HISTORY=24) when the expanding z-window is not yet reliable. This is correct — do not backfill.
- **Quarterly series (GDP)**: Forward-filled monthly. A new GDP release updates the last 3 months of g_gdp. This is expected.
- **Stale indicators**: The `data_through` in metadata is determined by the last month where all 13 indicators have data. If a late-releasing indicator (PCE) is missing, the composite for that month is null (not stale — correctly absent).
- **Drift watch**: `comp_expanding_std` must stay in [0.45, 0.65]. Outside this band → mandatory threshold review (methodology §7.5). Do not republish without a documented decision.

---

## Forecast Inputs (`config/refresh_manifest.json`)

### What it stores

For each of the 13 indicators:
- **Metadata**: label, pillar, FRED ID, frequency, transform, sign
- **Release info**: next_release, forecast_raw, source, status, in_baseline, notes
- **Delta arrays** (relative to current z-score at refresh time):
  - `baseline_deltas_z[12]`: expected z-change from current z over 12 months (base case)
  - `optimistic_deltas_z[12]`: upside scenario z-change
  - `pessimistic_deltas_z[12]`: downside scenario z-change

### How paths are computed

```
baseline_z[t-1] = clip(latest_actual_z + baseline_deltas_z[t-1], -3, 3)
```

The starting point (`latest_actual_z`) is read from the monitoring CSV at refresh time. **When a new month of data comes in, the paths automatically update their starting point.** The delta arrays encode the expected structure of the forward path from wherever the indicator is today.

### When to update the manifest

Update `forecast_as_of`, `forecast_raw`, `notes`, `status`, `next_release`, and the delta arrays when:
- A new month of actual data changes the forward picture significantly
- The Fed shifts its stance (affects liquidity/credit paths)
- Inflation or growth data surprises meaningfully
- The macro regime shifts

Typically: **review quarterly**, or immediately after a regime change or large data surprise.

---

## Dashboard Architecture

### Scenario Tab — 3 Core Lines + Stress Overlay

The Scenario tab always shows **3 permanent lines** from `forecast_inputs.json`:
1. **Baseline** (green solid): indicator-level consensus forecast paths rescored through MRS engine
2. **Optimistic** (green dashed): upside z-path per indicator, rescored
3. **Pessimistic** (red dashed): downside z-path per indicator, rescored

Plus an optional **4th dotted stress overlay** when a scenario chip is selected (historical delta-replay or named macro scenario). Click the chip again to remove the overlay.

All paths flow through the invariant:
`indicator_z → pillar_score (equal-weight within pillar) → composite (weighted avg) → display_score (composite+3, clipped [1,5])`

### Overview Tab — Forecast Inputs & Upcoming Data

Full-width section showing all 13 indicators with:
- Latest actual date + value
- Next release date
- 12-month forecast description
- Source / method (Consensus / Simulated / Market-implied badge)
- Whether used in MRS baseline
- Notes

Populated from `forecast_inputs.json` by `page-index.js`.

---

## Refresh Commands

> **Normal operation requires none of these.** The daily workflow runs the pipeline and publishes. These are for when the automation is down, or when you are changing forecast assumptions by hand.

### Standard refresh (manual fallback — the exact pipeline the workflow runs)

```bash
# Run from repo root
python src/mrs_gha_runner.py

# Optional: replace the auto-drafted analyst note with real interpretation
# vim dashboard/data/commentary.json

# Commit and publish
git add outputs/monitoring/ outputs/refresh_log.md dashboard/data/ config/refresh_manifest.json
git commit -m "MRS update: YYYY-MM (Regime: X, z ±0.00)"
git push origin main
```

### Quick dashboard rebuild (monitoring CSVs already current)

```bash
python src/refresh_dashboard.py
git add dashboard/data/
git commit -m "MRS dashboard rebuild: forecast_inputs + JSON refresh"
git push origin main
```

### Update forecast assumptions only

```bash
# 1. Edit config/refresh_manifest.json
# 2. Run:
python src/generate_forecast_inputs.py --verbose
python src/validate_dashboard.py
git add dashboard/data/forecast_inputs.json config/refresh_manifest.json
git commit -m "MRS: update forecast inputs (YYYY-MM-DD assumptions)"
git push origin main
```

### Validation only

```bash
python src/validate_dashboard.py --verbose
```

### Dry-run (see what refresh_dashboard would do without writing)

```bash
python src/refresh_dashboard.py --dry-run
```

---

## Validation Checks (via `validate_dashboard.py`)

| # | Check | What fails |
|---|---|---|
| 1 | File existence | Any of 9 required JSON files missing or invalid JSON |
| 2 | `data_through` consistency | metadata.json date ≠ last composite date |
| 3 | Indicator columns | Any of 13 `_z` columns missing from indicators_wide.json |
| 4 | No duplicate dates | Duplicate date rows in any time-series file |
| 5 | Score chain integrity | `Σ(pillar_contribution) ≠ composite` beyond 0.01z tolerance |
| 6 | Regime classification | `classify(composite) ≠ regime_raw` |
| 7 | Forecast inputs structure | Missing indicators, wrong array length, values outside [-3, 3] |
| 8 | Active flags | Unknown indicator or pillar name in flags |

Exit code 0 = all clear. Exit code 1 = at least one hard error.

---

## Known Issues

1. **Two automations write to this repo.** Alongside the GitHub Actions job, a claude.ai cloud routine (`trig_015iBHiHLBoXtDL1tjAcAZdm`, cron `0 14 6,16,25,29,1 * *`) still runs `src/mrs_smart_agent.py` and commits `outputs/agent_run_log_*.md`. Since the Actions runner took over it has produced run logs only — it has not published data — but it duplicates the decision logic and is a second potential writer to the same files. The GitHub Actions job is the system of record. **Recommendation: disable the routine** at https://claude.ai/code/routines.

2. **`outputs/refresh_log.md` lags no-op runs.** The runner regenerates it every run, but the workflow only commits when there is a real data change. Its heading says "last published run" for that reason. Committing it unconditionally would reintroduce the daily timestamp-churn commits the 2026-06-23 audit removed.

3. **`data/` is gitignored.** A fresh clone has no raw FRED data. The committed monitoring CSVs and dashboard JSON are enough to rebuild the dashboard via `refresh_dashboard.py`; a full pipeline run re-pulls from FRED.

4. **The newest month is often partial, by design.** The indicator history carries rows for market-based indicators (`s_spy_dd`, `s_vix`, `c_ig_level`, `l_curve`, …) as soon as the month closes, while the composite and pillar scores stay null until every binding indicator has released. `metadata.data_through` reflects the last **complete** month. This is correct behaviour, not staleness.

5. **Forecast paths mix vintages.** `generate_forecast_inputs.py` starts each indicator's path from its latest non-null z-score, so market indicators may start from a more recent month than fundamental ones. This is intended — paths should start from the most recent available data.

6. **`commentary.json` notes are auto-drafted, not authored.** `mrs_gha_runner.py` writes a mechanical note on a new month (regime, momentum, breadth, top drag/support, distance to boundary). Nothing overwrites an existing entry, so replacing it by hand is safe and encouraged when a month deserves real interpretation.

7. **A stale duplicate of `dashboard/` exists in the private repo** at `Research/MRS/dashboard/` (Summer_Investment_Platform). That repo's Pages site is disabled, so the copy is served nowhere and drifts from this one. This repo is the only published dashboard. Do not sync to it — treat it as dead.

---

## Next Recommended Actions

- [ ] **Disable the claude.ai cloud routine** (Known Issue 1) — removes the second writer and the run-log commit noise.
- [ ] **Watch the ~2026-08-27 refresh**, when July's core PCE releases. That is the first unattended new-month publish through the repaired deploy path: `Data through` on the live footer should advance to Jul 2026 the same day.
- [ ] **Spot-check `config/refresh_manifest.json`** after that run's auto-advance — the next_release dates are computed heuristically (first Friday / 16th / 27th).
- [ ] **Review the manifest delta arrays quarterly**, or after a regime change or large data surprise. `forecast_as_of` records when they were last set.
- [ ] **Consider a FRED API key** to remove the rate-limit retry pattern in `pull_mrs_data.py` (free).

---

## Quick-Start: Resuming in a New Session

```bash
git clone https://github.com/ankitv25/Macro-Regime-Score.git && cd Macro-Regime-Score

# 1. Is the repo healthy?
git log --oneline -5 && git status

# 2. What does the pipeline say?
cat dashboard/data/metadata.json
tail -3 outputs/monitoring/mrs_composite_history.csv
cat outputs/refresh_log.md

# 3. What is the public actually seeing? (these must agree with step 2)
curl -s "https://ankitv25.github.io/Macro-Regime-Score/data/metadata.json?cb=$RANDOM"

# 4. Is the automation running?
gh run list --workflow mrs-full-refresh.yml --limit 5
gh run list --workflow deploy-pages.yml --limit 5
```

If steps 2 and 3 disagree, the deploy is broken, not the data — `UPDATING.md` §2–3. If `data_through` is more than ~5 weeks behind the current month, the pipeline is broken — check the refresh workflow's logs.

A green workflow run is not evidence the site is correct. Verify the published artifact.

---
## Architecture Decision Log

| Decision | Rationale |
|---|---|
| Monitoring CSVs are source of truth (not MRS_Master.xlsx) | xlsx is gitignored and not present on a fresh clone; CSVs are committed and portable |
| `refresh_dashboard.py` reads CSVs (not xlsx) | Breaks the brittle xlsx dependency; enables dashboard rebuild on any machine with just git clone |
| Delta arrays in manifest (not absolute z targets) | When current z changes month-to-month, the relative forecast structure carries over correctly; absolute targets would drift |
| `generate_forecast_inputs.py` replaces manual JSON editing | Makes forecasts auditable and repeatable; delta arrays in manifest document the economic assumptions explicitly |
| `validate_dashboard.py` as separate script | Called by `refresh_dashboard.py` but also runnable standalone as a pre-commit gate |

---

*MRS v2.1 · Methodology reference: `methodology/MRS_Methodology.md` · Repo: https://github.com/ankitv25/Macro-Regime-Score*
