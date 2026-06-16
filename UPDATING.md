# MRS Update Runbook

**Cadence:** Monthly — one full run per month, after core PCE is released (~4 weeks after month-end).
**Time to complete:** ~20 minutes once data is available.

---

## Why Monthly?

The MRS is a monthly composite. Market-based pillars (Stress, Credit, Liquidity) update daily, but the binding constraint is **core PCE** — the key inflation input, released by BEA approximately 4 weeks after month-end. Running before PCE is available produces an incomplete panel.

GDP is quarterly and forward-filled, so it does not create a monthly wait — it updates automatically in the panel when a new quarterly release lands.

---

## Data Release Calendar

Run the MRS update **after all of these are available** for the target month:

| Series | Typical release | FRED ID |
|---|---|---|
| Nonfarm payrolls | First Friday of following month | PAYEMS |
| Manufacturing IP | ~3–4 weeks after month-end | IPMAN |
| Core PCE (binding) | **~4 weeks after month-end** | PCEPILFE |
| PCE services | Same release as PCE | PCES, DSERRG3M086SBEA |
| NFCI | Weekly (Wednesday) — already current | NFCI |
| 10Y–2Y curve | Month-end level, available immediately | T10Y2Y |
| BAA10YM spread | Usually month-end, available ~2 weeks after | BAA10YM |
| VIX (monthly avg) | Available as soon as the month closes | VIXCLS |
| SPY return | Available immediately at month-end | SPY (Yahoo) |
| Real GDP | Quarterly — advance release ~4 weeks after quarter-end | GDPC1 |

**Practical schedule:** For month M, run the update in the **last week of month M+1** (e.g., April data → update in late May). Core PCE is always the last input to arrive.

---

## Step-by-Step Monthly Update

Run all commands from the **repo root**.

### Step 1 — Pull latest data

```bash
python src/pull_mrs_data.py
```

Pulls the supplemental FRED series (IPMAN, BAA10YM, PCES, services deflator, STLFSI2) into `data/raw/fred/`. Also pull the main macro panel if it has a separate pull script. Check the log at `outputs/mrs_data_pull_log.md` for any failed pulls.

> If a series fails: FRED rate-limits apply. Wait 10 minutes and retry. If STLFSI2 returns empty (it was discontinued in 2022), that is expected — the bond-stress splice uses DGS10 realized vol for post-2022 months.

### Step 2 — Rebuild the input panel

```bash
python src/process_mrs_inputs.py
```

Aligns all series to monthly frequency, applies all transformations, and writes `data/processed/mrs_inputs_monthly.csv`. Check `outputs/mrs_validation_log.md` for any new warnings (NaN gaps, coverage gaps, unexpected values).

**Expected output:** The panel should gain exactly one new month of rows. If it gains more than one or the row count looks wrong, check that the source series updated correctly.

### Step 3 — Score and build monitoring tables

```bash
PYTHONPATH=src python src/mrs_monitoring_store.py
```

This is the core step. It runs the v2.1 engine, computes all derived metrics, and writes:

- `outputs/monitoring/mrs_composite_history.csv` — updated composite history
- `outputs/monitoring/mrs_pillar_history.csv` — updated pillar history
- `outputs/monitoring/mrs_indicator_history.csv` — updated indicator history
- `outputs/monitoring/mrs_active_flags.csv` — current-month flags
- `outputs/MRS_Master.xlsx` — consolidated workbook
- `outputs/vintages/YYYY-MM/` — point-in-time snapshot for this run

**Check immediately after this step:**
- Did the regime change? If `regime_confirmed` differs from the previous month, this is a significant event — document it.
- Are there new active flags in `mrs_active_flags.csv`? What is flagging and in which direction?
- Is the composite drift watch inside [0.45, 0.65]? See the governance section below.

### Step 4 — Export dashboard JSON

```bash
python src/export_dashboard_data.py
```

Converts the updated `MRS_Master.xlsx` into the 8 JSON files under `dashboard/data/`. Pure format conversion — no new calculations. This is what the live dashboard reads.

### Step 5 — Write the analyst note (optional but recommended)

Open `dashboard/data/commentary.json`. Add an entry for the new month:

```json
{
  "2026-05-31": {
    "analyst_note": "Your plain-language interpretation here — what the score means this month, what is driving it, what to watch next.",
    "author": "Your name",
    "as_of": "2026-05-28"
  }
}
```

The dashboard surfaces this note in the Analyst Summary card. If no entry exists for the current month, the card is hidden. Keep the note to 2–4 sentences: what the regime is, what is driving it, what the key risk or watch is.

### Step 6 — Commit and publish

```bash
git add outputs/monitoring/ dashboard/data/ dashboard/data/commentary.json
git commit -m "MRS update: YYYY-MM data (Regime: X, z +/-0.00)"
git push origin main
```

The GitHub Actions workflow deploys `dashboard/` to GitHub Pages automatically on push. The live dashboard at `https://ankitv25.github.io/Macro-Regime-Score/` will reflect the new data within ~1 minute.

---

## What to Review Each Month

After Step 3, work through this checklist before publishing:

### Composite
- [ ] What is the composite z-score and display value?
- [ ] Did the confirmed regime change? (Check `regime_confirmed` vs prior month)
- [ ] What is the 3-month change direction and magnitude (`comp_3m_chg`)?
- [ ] Is the composite approaching a threshold? (Check `dist_to_upgrade`, `dist_to_downgrade`)
- [ ] What is the historical percentile (`pctile_expanding`)? Above or below the prior month?

### Pillars
- [ ] Which pillar had the largest contribution? Which was the biggest drag?
- [ ] Have any pillars changed `direction_flag` this month?
- [ ] Are any pillars in a streak (same direction 3+ months)?
- [ ] Does the pillar signature (which pillars are dragging) suggest a regime type — financial stress vs inflationary pressure vs growth softness?

### Active flags
Open `outputs/monitoring/mrs_active_flags.csv` and check:
- [ ] Any **deterioration warnings** (deteriorating ≥3 months AND 6M change <−0.25)?
- [ ] Any **regime-change watch** flags (composite within 0.10z of a threshold and moving toward it)?
- [ ] Any **bull-steepening warning**? (If yes: the Liquidity pillar's curve improvement is crisis-typical — read NFCI alone for that pillar this month.)
- [ ] Any **breadth confirmation failures** (composite moved but diffusion didn't confirm — "narrow" move)?

### Drift watch (mandatory governance)
Check `comp_expanding_std` in the composite history. It must remain inside **[0.45, 0.65]**:
- Inside the band → no action, thresholds unchanged
- Outside the band → **mandatory, non-discretionary threshold review**: open a documented version decision. May re-affirm or re-fit thresholds; the review itself is not optional (§7.5 of the methodology).

---

## Handling a Confirmed Regime Change

If `regime_confirmed` changes from the prior month:

1. **Document it** in the commit message and the analyst note.
2. **Check the vintage** — `outputs/vintages/YYYY-MM/` has the point-in-time snapshot. The revision log at `outputs/vintages/revision_log.csv` records whether any *historical* confirmed regimes changed (they should not; data revisions can cause this).
3. **Check the pillar signature** to understand the type of regime shift: growth-led vs credit-led vs inflation-led.
4. **Note the lead time** if entering Slowdown or Contraction: what is `dist_to_downgrade` and how many months has the composite been approaching the threshold?

---

## Partial-Month Market Reads (Between Monthly Updates)

The MRS is a monthly indicator, but the market-based pillars update continuously. For an informal mid-month read:

| Pillar | Watch daily/weekly |
|---|---|
| Market Stress | VIX level; SPY drawdown from peak; bond-stress proxy (DGS10 vol) |
| Credit | BAA10YM spread level and direction |
| Liquidity | T10Y2Y curve shape; NFCI weekly print |

If any of these move sharply, it will feed into the next monthly score. This is not a formal MRS update — use it for awareness only. Never publish a partial-month score as a confirmed reading.

---

## Versioning Protocol

| What changed | Action |
|---|---|
| New data month added, no methodology change | No version bump — just update outputs |
| Indicator added or removed | Increment minor version (v2.1 → v2.2); update methodology doc and Appendix C |
| Threshold change | Increment minor version; requires drift-watch trigger; document in revision log |
| Fundamental methodology change | Increment major version (v2.x → v3.0); full rebacktest required |

Tag each methodology version change in git:
```bash
git tag -a v2.1 -m "MRS v2.1: g_serv + VIX monthly average"
git push origin --tags
```

---

## Quick Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `process_mrs_inputs.py` fails | Missing raw file | Re-run `pull_mrs_data.py`; check `mrs_data_pull_log.md` |
| `mrs_monitoring_store.py` ImportError | `mrs_proposed_framework` not on path | Run with `PYTHONPATH=src python src/mrs_monitoring_store.py` |
| Dashboard shows "Error loading dashboard" | JSON file missing or malformed | Re-run `export_dashboard_data.py`; check `dashboard/data/` for empty files |
| Dashboard data is stale | `dashboard/data/` not committed | `git add dashboard/data/ && git commit && git push` |
| Composite std outside [0.45, 0.65] | Scale drift | Mandatory threshold review — see methodology §7.5 |
| STLFSI2 pull fails / returns nothing | Series discontinued Jan 2022 | Expected — bond stress uses DGS10 realized vol post-2022; no fix needed |
| GDP not updating monthly | GDPC1 is quarterly | Expected — forward-fill is correct; update happens on quarterly release dates |

---

## Monthly Checklist (Quick Reference)

```
Month-end + ~4 weeks:
  [ ] Core PCE is available on FRED
  [ ] python src/pull_mrs_data.py            → check outputs/mrs_data_pull_log.md
  [ ] python src/process_mrs_inputs.py       → check outputs/mrs_validation_log.md
  [ ] PYTHONPATH=src python src/mrs_monitoring_store.py
        → check regime, flags, drift watch
  [ ] python src/export_dashboard_data.py
  [ ] Update dashboard/data/commentary.json  → analyst note for this month
  [ ] git add outputs/monitoring/ dashboard/data/
  [ ] git commit -m "MRS update: YYYY-MM (Regime: X, z ±0.00)"
  [ ] git push origin main
  [ ] Verify live dashboard at https://ankitv25.github.io/Macro-Regime-Score/
```

---

*MRS v2.1 · Methodology reference: `methodology/MRS_Methodology.md` · Parts VII and VIII cover the monitoring spec and dashboard architecture in full.*
