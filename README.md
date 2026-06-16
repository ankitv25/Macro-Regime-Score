# Macro Regime Score (MRS)

A transparent monthly composite indicator that classifies the US macro-financial environment into four regimes: **Expansion · Neutral · Slowdown · Contraction**.

---

**Current reading — April 2026**

| Composite z | Display | Regime | Month in regime | 3M change |
|---|---|---|---|---|
| +0.03 | 3.03 / 5 | **Neutral** | 39 | −0.23 |

Active flags: Inflation pillar deterioration (above-target, accelerating); bond stress deteriorating.

---

**[Live Dashboard →](https://ankitv25.github.io/Macro-Regime-Score/)** · [Methodology](methodology/MRS_Methodology.md) · [Research Paper](research/MRS_Research_Paper.md)

---

## What is the MRS?

The MRS scores the US macro-financial environment monthly from **13 indicators across five pillars** — Growth (30%), Credit (20%), Market Stress (20%), Inflation (15%), Liquidity/Rates (15%). Each indicator is normalized to an **expanding-window z-score** (the convention of the OFR Financial Stress Index and the Chicago Fed NFCI) and aggregated with fixed, economically-motivated weights. The composite is classified against calibrated thresholds with a two-month persistence rule.

The framework replaces a percentile-scored predecessor (v1.0) whose Contraction regime was mathematically unreachable: across 280 months including the GFC and COVID, the composite never once triggered Contraction. The mechanism — percentile scoring maps every input to a uniform distribution; the central limit theorem then collapses the weighted average toward its center — is general and documented in full in [Appendix B of the research paper](research/MRS_Research_Paper.md#appendix-b--the-v10-negative-result-in-brief).

## Key Results (backtest 2003-06 – 2026-04, 275 months)

| Episode | Composite min (z) | MRS regime | Assessment |
|---|---|---|---|
| Global Financial Crisis | **−2.15** (Dec 2008) | **Contraction** (10/10 months) | Correct; raw signal fired Mar 2008 — 9 months before NBER |
| COVID crash | **−1.65** | **Contraction** | Correct |
| 2022 inflation bear | −0.59 | **Slowdown** | Correct type — credit stayed calm |
| Euro sovereign crisis 2011 | −0.37 | Neutral | Correct — no US recession |
| EM/China shock 2015–16 | −0.26 | Neutral | Correct — no US recession |
| 2003–04 expansion | +0.80 avg | **Expansion** (12/12 months) | Correct |

Only the two genuine US contractions reach Contraction. Regime stability: **20 confirmed transitions in 23 years**, 13.1-month average duration. Equal-weight robustness: 0.989 correlation, 91.6% regime agreement with the production weights.

---

## Repo Structure

```
.
├── README.md
├── requirements.txt
│
├── methodology/
│   └── MRS_Methodology.md         Official v2.1 reference: design, data, scoring,
│                                   validation, monitoring spec (Parts I–VIII, appendices)
│
├── research/
│   └── MRS_Research_Paper.md      Working paper — motivation, method, results, limitations
│
├── src/                            Pipeline scripts — run in order
│   ├── pull_mrs_data.py           Step 1  Pull FRED series → data/raw/fred/
│   ├── process_mrs_inputs.py      Step 2  Build monthly input panel → data/processed/
│   ├── mrs_proposed_framework.py  Step 3  v2.1 scoring engine (standalone backtest)
│   ├── mrs_monitoring_store.py    Step 4  Build monitoring tables + MRS_Master.xlsx
│   └── export_dashboard_data.py   Step 5  Export JSON for the dashboard
│
├── dashboard/                      Static HTML/JS dashboard (no build step)
│   ├── index.html                 Overview: composite, regime, pillar evidence, attribution
│   ├── trend.html                 Trend & flags: heatmap, active warnings, movers
│   ├── pillar.html                Per-pillar drilldown (5 pillars, one template)
│   ├── indicator.html             Per-indicator drilldown (13 indicators, one template)
│   ├── about.html                 Methodology summary + data lineage
│   ├── assets/                    CSS + modular JS (Plotly 2.32 via CDN, no build step)
│   └── data/                      Pre-built JSON data files (current snapshot: Apr 2026)
│
└── outputs/
    └── monitoring/                 Current-snapshot monitoring tables (CSV)
        ├── mrs_composite_history.csv
        ├── mrs_pillar_history.csv
        ├── mrs_indicator_history.csv
        └── mrs_active_flags.csv
```

---

## How to Rerun the Pipeline

All inputs are from FRED (public API) and Yahoo Finance. No Bloomberg or paid data required.

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Pull raw data from FRED

```bash
python src/pull_mrs_data.py
```

Downloads the supplemental FRED series (IPMAN, STLFSI2, BAA10YM, PCES, services deflator) to `data/raw/fred/`. The main macro panel (`fred_rates_daily.csv`, `fred_macro_monthly.csv`, `fred_nfci_weekly.csv`, `fred_gdp_quarterly.csv`) should be pulled by a companion FRED pull script or placed in `data/raw/fred/` manually.

> **Data note:** All inputs are publicly available from FRED (api.stlouisfed.org) and Yahoo Finance. SPY total returns are downloaded via `yfinance`. FRED rate-limiting applies — the script includes retry logic with back-off.

### 3. Build the monthly input panel

```bash
python src/process_mrs_inputs.py
```

Aligns all series to a monthly calendar, applies frequency conversions (daily → month-end, weekly → monthly average, quarterly → forward-filled), derives all transformed inputs, and writes:
- `data/processed/mrs_inputs_monthly.csv` — 317 × 57 monthly panel, 2000-01 to present
- `outputs/mrs_validation_log.md` — data quality and coverage report

### 4. Score and build monitoring tables

```bash
PYTHONPATH=src python src/mrs_monitoring_store.py
```

Runs the v2.1 engine, computes all derived metrics (momentum, percentile, streak, flags, curve environment, drift watch), and writes:
- `outputs/monitoring/mrs_composite_history.csv` — full composite history
- `outputs/monitoring/mrs_pillar_history.csv` — full pillar history
- `outputs/monitoring/mrs_indicator_history.csv` — full indicator history
- `outputs/monitoring/mrs_active_flags.csv` — current-month flags
- `outputs/MRS_Master.xlsx` — consolidated workbook (all tables + metadata)
- `outputs/vintages/YYYY-MM/` — point-in-time snapshot for vintage tracking

> Run from the repo root. `PYTHONPATH=src` is needed so `mrs_monitoring_store.py` can import `mrs_proposed_framework` as a module.

### 5. Export dashboard JSON

```bash
python src/export_dashboard_data.py
```

Converts `outputs/MRS_Master.xlsx` into the 8 JSON files under `dashboard/data/`. Pure format conversion — no computation.

### 6. View the dashboard locally

```bash
cd dashboard && python -m http.server 8080
```

Open `http://localhost:8080` in your browser. The dashboard requires a static server (not `file://`) because it uses ES modules.

---

## Dashboard — GitHub Pages

The dashboard is hosted at **[https://ankitv25.github.io/Macro-Regime-Score/](https://ankitv25.github.io/Macro-Regime-Score/)**.

To enable or re-enable hosting on your own fork:

1. Go to **Settings → Pages** in the GitHub repo
2. Under **Build and deployment → Source**, select **GitHub Actions**
3. Save — the workflow (`.github/workflows/deploy-pages.yml`) deploys `dashboard/` automatically on every push to `main` that touches dashboard files

The dashboard is fully static — no server-side code, no build step. It reads JSON from `dashboard/data/` and renders with Plotly 2.32 (CDN) and inline SVG sparklines.

---

## Pillar Structure

| Pillar | Weight | Indicators | Key role |
|---|---|---|---|
| Growth | 30% | 4 (NFP, IP, GDP, services PCE) | Economic anchor; sized for upside participation, not just crisis detection |
| Credit | 20% | 2 (IG spread level + momentum) | Best crisis-type discriminator: benign in 2022, stressed in 2008–09 |
| Market Stress | 20% | 3 (VIX avg, bond stress, SPY drawdown) | Fastest crisis signal; bond stress = best single crisis discriminator in audit |
| Inflation | 15% | 2 (PCE deviation from 2% + 6M momentum) | Overlay, not a crisis sensor; decisive in 2021–22 tightening regime |
| Liquidity / Rates | 15% | 2 (NFCI, 10Y–2Y curve) | Broad conditions + the framework's principal leading indicator |

### Regime Thresholds (composite z-units)

| Regime | Threshold | Realized frequency |
|---|---|---|
| Expansion | ≥ +0.35 | 24.4% |
| Neutral | −0.30 to +0.35 | 61.8% |
| Slowdown | −1.00 to −0.30 | 8.4% |
| Contraction | < −1.00 | 5.5% |

Thresholds are fixed at v2.0 calibration. A mandatory review is triggered (non-discretionary) if the composite's expanding standard deviation exits [0.45, 0.65].

---

## Data Sources

All data is publicly available. No Bloomberg, no ICE licensing required.

| Series | Source | FRED ID | Role |
|---|---|---|---|
| Nonfarm payrolls | FRED | PAYEMS | Growth |
| Manufacturing IP | FRED | IPMAN | Growth (ISM proxy) |
| Real GDP | FRED | GDPC1 | Growth |
| PCE services / services deflator | FRED | PCES, DSERRG3M086SBEA | Growth (v2.1) |
| Core PCE inflation | FRED | PCEPILFE | Inflation |
| Chicago Fed NFCI | FRED | NFCI | Liquidity |
| 10Y–2Y Treasury spread | FRED | T10Y2Y | Liquidity |
| Moody's BAA–10Y spread | FRED | BAA10YM | Credit (IG proxy) |
| VIX | FRED | VIXCLS | Market Stress |
| St. Louis FSI | FRED | STLFSI2 | Market Stress (bond stress, 2000–2022) |
| 10Y Treasury yield | FRED | DGS10 | Market Stress (realized vol, 2022+) |
| SPY total return | Yahoo Finance | SPY | Market Stress (drawdown) |
| NBER recession dates | FRED | USREC | Validation only — never enters the score |

---

## Limitations

1. **In-sample thresholds.** Calibrated on the same 2003–2026 window used for evaluation. The drift rule governs re-fitting; a true out-of-sample test requires new data.
2. **Two severe episodes.** Every claim about Contraction behavior rests on n = 2 (GFC, COVID). The dot-com recession (2001) falls in the normalization warm-up and is unscorable.
3. **Early-history softness.** Expanding z-scores rest on 24–60 months of history before ~2006; the ±3 clip mitigates but does not remove this.
4. **Services signal is slow.** Real services consumption is smooth; a fast services shock reaches the score first through labor and markets.
5. **No regime-conditional return evidence yet.** The framework classifies environments; the study linking regimes to forward asset-class behavior is the next milestone.

---

## Version History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-06-04 | Original percentile framework — Contraction mathematically unreachable; 67% of history in one regime |
| 2.0 | 2026-06-10 | Full redesign: expanding z-scores, 12 indicators, calibrated thresholds, 2-month confirmation, NBER cap dropped |
| 2.1 | 2026-06-11 | `g_serv` (real services PCE) added to Growth; VIX moved to monthly-average sampling; thresholds unchanged |

---

*All data from FRED and Yahoo Finance. Methodology v2.1, June 2026.*
