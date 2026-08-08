# MRS Update Runbook

**The refresh is automated.** In normal operation there is nothing to run and nothing to commit — this document explains what the automation does, how to tell whether it is healthy, and how to drive the pipeline by hand if it is not.

---

## 1. What runs, and when

| | |
|---|---|
| Workflow | `.github/workflows/mrs-full-refresh.yml` |
| Schedule | Daily, `cron: '30 14 * * *'` — **14:30 UTC** (~10:30 ET in EDT, ~09:30 ET in EST) |
| Entry point | `python src/mrs_gha_runner.py` |
| Publishes to | `main`, as user `MRS Agent` |
| Deploy | `.github/workflows/deploy-pages.yml` → GitHub Pages |

The daily job runs the **whole pipeline** — pull, panel build, scoring, JSON export, forecast inputs, validation — and then decides whether anything is worth committing:

- **New month** (`data_through` advanced) → writes the analyst note, advances the six binding `next_release` dates in `config/refresh_manifest.json`, commits `MRS update: YYYY-MM …`.
- **Resync** (same month, but FRED revisions or new market data) → commits `MRS resync: YYYY-MM …`.
- **No real change** → commits nothing. The workflow explicitly ignores a `generated_at`-only diff so the repo does not accumulate daily timestamp-churn commits.

### Why 14:30 UTC

The binding releases land at 08:30 ET (NFP, core PCE, GDP) and 09:15 ET (industrial production). 14:30 UTC clears all of them year-round, so a month that becomes available on day D is published on day D. GitHub cron is UTC and does not shift for DST, which is why the schedule is stated in UTC.

> This was `30 6` (06:30 UTC = 02:30 ET) until 2026-08-08 — ahead of every release, so new months always published a day late.

### Why the dashboard's date moves on two different clocks

The footer states both, because they are not the same thing:

- **`Updated:`** — when the dashboard was last rebuilt. Moves daily.
- **`Data through:`** — the last month-end the composite actually scores. Moves once a month.

A month is only scored once **all six binding indicators** have released: `g_nfp`, `g_ipman`, `g_gdp`, `g_serv`, `i_pce_dev`, `i_pce_mom`. Core PCE (~27th of the following month) is the last to arrive and is the effective gate. Until then the market-based pillars have rows for the incomplete month but the composite is correctly null — a partial month is never scored.

So for month M, expect `Data through` to advance in the **last week of month M+1**.

---

## 2. How the deploy is wired — read this before changing it

`MRS Full Refresh` pushes using the built-in `GITHUB_TOKEN`. **GitHub does not raise `push` events for commits made with that token** (it is a deliberate recursion guard). A deploy workflow listening only on `push` therefore never fires for an agent commit.

That is exactly what happened between 2026-07-29 and 2026-08-08: ten refresh runs succeeded and pushed, June data was scored and committed on 07-31, and the live site stayed frozen on May data for ten days. Every job was green.

`deploy-pages.yml` now also triggers on **`workflow_run`** of `MRS Full Refresh`, which is not suppressed. Two details matter if you touch it:

- It runs unconditionally on completion. The deploy is idempotent and ~20s, so the site self-heals if an earlier deploy was ever missed.
- `actions/checkout` is pinned to `ref: main`. On `workflow_run` the default SHA is the one the *triggering* run started from — i.e. main **before** the refresh pushed its data. Without the pin, the deploy would publish the pre-push state and look healthy while shipping stale data.

---

## 3. Health check — is the dashboard actually current?

A green workflow run is **not** evidence that the site is correct; the 2026-07-29 incident was ten green runs and a stale site. Check the published artifact itself:

```bash
# What the live site is actually serving
curl -s "https://ankitv25.github.io/Macro-Regime-Score/data/metadata.json?cb=$RANDOM"

# What main says it should be serving
git -C . show main:dashboard/data/metadata.json
```

`data_through` and `generated_at` must match. If they do not, the deploy did not run or did not publish `main` — check the Actions tab for a `Deploy MRS Dashboard to GitHub Pages` run whose event is `workflow_run`, and read its **"Show what is being deployed"** step, which prints the deployed commit and `metadata.json`.

The live footer should read:

```
Updated: <DD Mon YYYY HH:MM> UTC · Data through: <Mon YYYY> (month-end <date>)
· Scheduled refresh: daily 14:30 UTC (~10:30 AM ET) · MRS v2.1 · <N> months
```

Other things worth a glance:

- `outputs/refresh_log.md` — human-readable summary of the last **published** run. It is regenerated every run but only committed when the run publishes, so its date lags a no-op run. That is intentional (see §1).
- GitHub Pages serves with `cache-control: max-age=600`, so add a cache-busting query string when checking by hand.

---

## 4. Manual fallback

Only needed if the automation is down. Run from the repo root.

```bash
python src/mrs_gha_runner.py     # the exact pipeline the workflow runs
```

Or step by step, which is the same sequence:

```bash
python src/pull_fred_macro.py            # FRED core
python src/pull_spy_returns.py           # SPY (Yahoo)
python src/pull_mrs_data.py              # FRED supplemental
python src/process_mrs_inputs.py         # → data/processed/mrs_inputs_monthly.csv
python src/mrs_monitoring_store.py       # v2.1 engine → outputs/monitoring/*.csv
python src/refresh_dashboard.py          # → dashboard/data/*.json
python src/generate_forecast_inputs.py   # → dashboard/data/forecast_inputs.json
python src/validate_dashboard.py         # 8 checks; exits 1 on failure
```

Then publish:

```bash
git add outputs/monitoring/ outputs/refresh_log.md dashboard/data/ config/refresh_manifest.json
git commit -m "MRS update: YYYY-MM (Regime: X, z ±0.00)"
git push origin main
```

A push from a human account **does** raise a `push` event, so this deploys via the ordinary path.

> `src/mrs_smart_agent.py` and `src/update_mrs.py` are the earlier orchestrators, kept for reference. `mrs_gha_runner.py` is the one the automation uses — prefer it.

---

## 5. What to review when a new month lands

Only `MRS update:` commits need review; `MRS resync:` commits are revisions and market data.

### Composite
- [ ] Composite z-score and display value
- [ ] Did `regime_confirmed` change from the prior month?
- [ ] 3-month change direction and magnitude (`comp_3m_chg`)
- [ ] Distance to a threshold (`dist_to_upgrade`, `dist_to_downgrade`)
- [ ] Historical percentile (`pctile_expanding`) vs prior month

### Pillars
- [ ] Largest contribution and biggest drag
- [ ] Any pillar changing `direction_flag`
- [ ] Any pillar in a 3+ month streak
- [ ] Does the signature suggest a type — financial stress vs inflationary pressure vs growth softness?

### Active flags — `outputs/monitoring/mrs_active_flags.csv`
- [ ] Deterioration warnings (deteriorating ≥3 months **and** 6M change < −0.25)
- [ ] Regime-change watch (within 0.10z of a threshold and moving toward it)
- [ ] Bull-steepening warning — if set, the Liquidity pillar's curve improvement is crisis-typical; read NFCI alone for that pillar
- [ ] Breadth confirmation failures (composite moved, diffusion did not confirm)

### Drift watch (mandatory governance)
`comp_expanding_std` must stay inside **[0.45, 0.65]**. Outside the band triggers a **mandatory, non-discretionary threshold review** — open a documented version decision. The review is not optional (methodology §7.5).

### Analyst note
The runner drafts a note into `dashboard/data/commentary.json` on a new month. It is mechanical — regime, momentum, breadth, top drag/support, distance to boundary. Replace it by hand with real interpretation when the month deserves it; nothing overwrites an existing entry for a date.

---

## 6. Confirmed regime change

1. **Document it** in the commit message and the analyst note.
2. **Check the vintage** — `outputs/vintages/YYYY-MM/` holds the point-in-time snapshot; `outputs/vintages/revision_log.csv` records whether any *historical* confirmed regimes moved (they should not; data revisions can cause this).
3. **Check the pillar signature** — growth-led vs credit-led vs inflation-led.
4. **Note the lead time** if entering Slowdown or Contraction: what was `dist_to_downgrade`, and how many months was the composite approaching it?

---

## 7. Data release calendar

| Series | Typical release | FRED ID | Binding? |
|---|---|---|---|
| Nonfarm payrolls | First Friday of following month | PAYEMS | **Yes** |
| Manufacturing IP | ~16th | IPMAN | **Yes** |
| Core PCE | **~27th — the gate** | PCEPILFE | **Yes** |
| PCE services | Same release as PCE | PCES, DSERRG3M086SBEA | **Yes** |
| Real GDP | Quarterly, ~4 weeks after quarter-end | GDPC1 | **Yes** (forward-filled) |
| NFCI | Weekly (Wednesday) | NFCI | No |
| 10Y–2Y curve | Month-end level, immediate | T10Y2Y | No |
| BAA10YM spread | ~2 weeks after month-end | BAA10YM | No |
| VIX (monthly avg) | At month close | VIXCLS | No |
| SPY drawdown | At month close | SPY (Yahoo) | No |

GDP is quarterly and forward-filled. It is in the binding set but its `next_release` is pinned to the 27th each month so it never blocks the monthly trigger — the real quarterly value is picked up by the fresh FRED pull. This is deliberate; do not "fix" GDP into a blocker.

---

## 8. Versioning protocol

| What changed | Action |
|---|---|
| New data month, no methodology change | No version bump |
| Indicator added or removed | Minor bump (v2.1 → v2.2); update methodology doc and Appendix C |
| Threshold change | Minor bump; requires drift-watch trigger; document in revision log |
| Fundamental methodology change | Major bump (v2.x → v3.0); full rebacktest required |

```bash
git tag -a v2.1 -m "MRS v2.1: g_serv + VIX monthly average"
git push origin --tags
```

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| **Site stale, workflows green** | Deploy not triggered by the agent's push | Check for a `workflow_run` deploy run; see §2. `workflow_dispatch` the deploy to recover immediately. |
| Site stale right after a deploy | Pages CDN (`max-age=600`) | Re-fetch with a cache-busting query string |
| `Data through` not advancing | A binding indicator has not released | Expected until ~27th of M+1; confirm against `config/refresh_manifest.json` |
| Composite null for the newest month | Partial month | Correct behaviour — a partial month is never scored |
| Refresh job fails at data-pull | FRED rate limit or outage | Re-run the workflow; FRED rate-limits apply |
| `mrs_monitoring_store.py` ImportError | `mrs_proposed_framework` not on path | `PYTHONPATH=src python src/mrs_monitoring_store.py` |
| Dashboard shows "Error loading dashboard" | JSON missing or malformed | Re-run `refresh_dashboard.py`; check `dashboard/data/` for empty files |
| STLFSI2 pull returns nothing | Series discontinued Jan 2022 | Expected — bond stress splices to DGS10 realized vol post-2022 |
| GDP not updating monthly | GDPC1 is quarterly | Expected — forward-fill is correct |
| Composite std outside [0.45, 0.65] | Scale drift | Mandatory threshold review — methodology §7.5 |

---

## 10. Known operational issues

**Two automations write to this repo.** Besides the GitHub Actions job, a claude.ai cloud routine (`trig_015iBHiHLBoXtDL1tjAcAZdm`, cron `0 14 6,16,25,29,1 * *`) still runs `src/mrs_smart_agent.py` and commits `outputs/agent_run_log_*.md`. It has produced only run logs since the GitHub Actions runner took over — it does not currently publish data — but it duplicates the decision logic and is a second potential writer. The GitHub Actions job is the system of record. **Recommendation: disable the routine** at https://claude.ai/code/routines.

**`data/` is gitignored.** A fresh clone has no raw FRED data. The committed monitoring CSVs and dashboard JSON are sufficient to rebuild the dashboard via `refresh_dashboard.py`; a full pipeline run re-pulls from FRED.

---

*MRS v2.1 · Methodology: `methodology/MRS_Methodology.md` (Parts VII–VIII cover the monitoring spec and dashboard architecture) · Live: https://ankitv25.github.io/Macro-Regime-Score/*
