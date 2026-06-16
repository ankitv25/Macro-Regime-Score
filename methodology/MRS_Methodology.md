# The Macro Regime Score (MRS): Official Methodology and Monitoring Framework

**Version:** 2.1 (official reference)
**Date:** 2026-06-11 (v2.0 published 2026-06-10; v2.1 changes in §5.9 and Appendix C)
**Status:** Methodology finalized and backtested; monitoring layer implemented (`Src/mrs_monitoring_store.py`)
**Implementation:** `Src/mrs_proposed_framework.py` (v2.0 engine), `Src/process_mrs_inputs.py` (input panel), `Src/pull_mrs_data.py` (data acquisition)
**Supersedes:** the v1.0 percentile framework (`Legacy/MRS_v1/build_mrs_scores.py`, retired 2026-06-14), retained for comparison only

---

## Abstract

The Macro Regime Score (MRS) is a monthly composite indicator that classifies the prevailing US macro-financial environment into one of four regimes — Expansion, Neutral, Slowdown, Contraction — from thirteen indicators organized into five economic pillars: Growth, Inflation, Liquidity/Rates, Credit, and Market Stress. Indicators are normalized with expanding-window z-scores (the institutional standard used by the OFR Financial Stress Index and the Chicago Fed NFCI), aggregated with fixed, judgment-based weights, and classified against calibrated thresholds with a two-month persistence rule.

Version 2.0 replaces a percentile-scored predecessor whose Contraction regime was mathematically unreachable: across 280 months including the Global Financial Crisis and COVID, the v1.0 composite never fell below 2.14 on its 1–5 scale and assigned 67% of all history to a single regime. The framework, backtested over 2003–2026 (275 months), places the GFC (minimum −2.15) and COVID (−1.65) — and only those two episodes — in Contraction, classifies the 2022 inflation bear market as Slowdown, signals deteriorating conditions from March 2008 (nine months before the NBER's recession announcement), and achieves this with better regime stability than its predecessor (20 confirmed transitions versus 30; 13.1-month average regime duration).

This document is the complete reference: design philosophy, institutional grounding, data lineage, full per-component specification with economic rationale, validation evidence, known limitations, the historical output store each score must maintain, and the dashboard architecture for ongoing monitoring and portfolio integration.

---

# Part I — Purpose and Philosophy

## 1.1 What the MRS is for

The MRS answers one question on a monthly cadence: **what kind of macro-financial environment are we in, and is it getting better or worse?** Its outputs feed three downstream uses:

1. **Portfolio construction.** Regime classification and pillar readings condition asset-allocation tilts, factor exposures, and risk budgets. The cross-asset correlation studies in this workspace (asset-universe, canonical, and benchmark correlation work) establish that correlation and beta structures are regime-dependent; the MRS supplies the regime conditioning variable.
2. **Risk monitoring.** The composite and its pillars function as a structured early-warning panel: which dimension of the environment is deteriorating, how fast, and how broadly.
3. **Research.** A consistent, point-in-time-honest regime history enables regime-conditional analysis of returns, correlations, and strategy behavior.

## 1.2 Design principles

Every methodological choice in v2.0 follows from five principles, applied in priority order:

1. **Simple, transparent, economically meaningful — over complex or statistically optimal.** Every indicator must have a one-sentence economic justification. Weights are fixed and stated, not estimated. No PCA, no dynamic factor models, no regime-switching econometrics. This is a deliberate mandate, supported by the out-of-sample evidence on simple versus optimized weighting (§2.3).
2. **Point-in-time honesty.** The score at month *t* uses only information available at month *t*. Normalization statistics expand through time rather than using full-sample parameters; no ex-post information (such as NBER recession dating) enters the score.
3. **Preserve tail information.** A regime indicator exists for the tails. Any transformation that compresses extreme observations (such as percentile ranking, which maps a 5σ event and a 2σ event to nearly the same score) defeats the purpose. This single failure accounted for most of v1.0's defects.
4. **One signal, one variable.** Near-duplicate indicators (r > 0.9) add apparent breadth but no information, while diluting the indicators that work. Redundancy is removed at the design stage, not papered over with weights.
5. **Measure conditions, not policy reactions.** Indicators must score the state of the economy and markets — not the authorities' response to that state. v1.0 scored Fed rate cuts as a positive signal, which made the Rates pillar peak in October 2008, the month after Lehman failed.

## 1.3 Scale and orientation

The composite lives in **z-score units** (standard deviations of weighted pillar conditions versus expanding history), where **higher = more favorable**. Zero is the neutral anchor. An optional display mapping, `display = 3 + composite` clipped to [1, 5], preserves continuity with the legacy 1–5 scale for dashboards; the z-unit series is canonical.

---

# Part II — Lineage and Institutional Foundations

## 2.1 The v1.0 framework and why it was replaced

v1.0 (built 2026-06-04, audited 2026-06-09) scored 13–15 indicators via expanding-window **percentile rank** mapped to a 1–5 scale, aggregated into five component scores (GS 30%, IS 20%, RLS 20%, CRS 15%, MSS 15%), with fixed thresholds at 4.0/3.0/2.0. Two audits (`MRS_Methodology_Audit.md`, `MRS_Component_Audit.md`) established, with full evidence, that the framework was not fit for purpose:

| Defect | Evidence |
|---|---|
| **Contraction regime (< 2.0) mathematically unreachable** | 0 months triggered in 280 (2002-12–2026-04) including GFC and COVID; GFC minimum 2.144 (Mar 2009). Structural floor ≈ 2.03: the Inflation and Rates components jointly contribute ≥ 1.43 during crises while the three stress components are bounded below at 0.60. |
| **No discrimination** | 67.1% of all months in "Moderate/Stable"; the GFC, COVID, the 2022 rate shock, and the 2023 banking stress all received the same label ("Slowdown/Caution", 2.1–3.0); the Euro sovereign debt crisis never left "Moderate/Stable". |
| **Distribution compression by design** | Percentile scoring maps every input to a uniform distribution; the central limit theorem then collapses the weighted average toward its center (composite std 0.509 on a 4-point scale, range utilization 57%). The architecture, not the data, prevented extreme readings. |
| **Policy-reaction indicators inverted during crises** | `rls_ff_direction` (separation between expansion and crisis means: **−1.963**, the worst of all 15 variables; 0% of crisis months below 2.0) and `rls_real_ff` (−1.258) scored Fed rate cuts as positive: the Rates component peaked at 3.84 in October 2008. |
| **Inflation component pinned high** | Fixed-band scoring (5 − |inflation − 2%|) put IS ≥ 4.0 in 80.7% of months; IS during the GFC (4.57) was indistinguishable from IS during the 2003 expansion (4.60). |
| **Near-duplicate indicators** | HY spread proxy = IG × 1.8 pre-2023 (r = 1.0000 exactly, 253 of 294 months; VIF 52); IPMAN/INDPRO r = 0.915; core PCE/core CPI r = 0.928. Nominal 15 indicators ≈ 8 independent signals. |

The audits also established what **worked**, and v2.0 is built around it. Five variables carried essentially all of v1.0's crisis-detection power (separation = expansion mean − crisis mean on the 1–5 scale; "crisis < 2.0" = share of crisis months scored in the stress zone):

| Rank | Indicator | Separation | Crisis < 2.0 | Unique info |
|---|---|---|---|---|
| 1 | bond stress proxy | **+3.331** | **95.8%** | 17.5% |
| 2 | NFCI | **+2.940** | **95.8%** | 19.6% |
| 3 | IG credit spread | +2.668 | 79.2% | 1.8% |
| 4 | VIX | +2.558 | 70.8% | 38.2% |
| 5 | Manufacturing IP YoY | +2.570 | 79.2% | 12.6% |

with `gs_nfp` (+2.550, 33% unique) and `gs_gdp` (+2.217, **68.5% unique — the most independent variable in the framework**) as secondary growth signals, and `mss_spy_3m` the most unique market variable (63.8%).

## 2.2 Institutional practice: normalization

Web-sourced review (2026-06-10) of how the major institutional regime/stress indices are constructed:

| Index | Construction | Relevance |
|---|---|---|
| **OFR Financial Stress Index** | 33 variables, each z-scored using mean/std of data *up until that date*; aggregated via dynamic factor ≈ first principal component; 5 categories (credit, equity valuation, funding, safe assets, volatility) | Expanding-window z-scores are the reference standard; category structure parallels our pillars |
| **Chicago Fed NFCI** | 105 variables standardized to mean 0 / std 1 over history since 1971 | The NFCI is itself an input to our Liquidity pillar — a composite-within-a-composite, by design |
| **Kansas City Fed FSI** | 11 standardized variables, first principal component | Confirms z-score + small-N viability |
| **St. Louis Fed FSI** | 18 standardized variables, principal components | Same |
| **State Street Market Regime Indicator** | Implied equity and currency volatility plus FI spreads mapped to a 0–100% scale; five fixed regime bands (Crisis / High Risk Aversion / Normal / Low Risk Aversion / Euphoria) | Precedent for fixed thresholds on a continuous composite |
| **Conference Board LEI** | Simple averaging of standardized components; interpretation via the 3Ds rule (duration, depth, diffusion); companion diffusion index 0–100 | Precedent for simple averaging and for breadth/diffusion as a confirmation overlay |
| **Goldman Sachs CAI** | ~24 indicators, PCA, GDP-equivalent units | The statistically-optimal end of the spectrum — explicitly *not* adopted (unstable, uninterpretable weights) |

**No major institutional index uses percentile scoring.** Expanding z-scores preserve tail magnitude, are point-in-time honest, and keep units interpretable.

Sources: financialresearch.gov (OFR WP 17-04); chicagofed.org (NFCI background/FAQ); kansascityfed.org (KCFSI); ssga.com (MRI, Q2-2024); conference-board.org (composite index methodology).

## 2.3 Institutional practice: structure and weighting

- **Growth/inflation quadrant frameworks** (Bridgewater-style: Goldilocks / Reflation / Stagflation / Deflation, as operationalized by FTSE Russell, Invesco, Fidenza Macro) condition on the **direction of change** in growth and inflation, not only the level. Markets price surprises and turning points; this motivates the momentum terms in the Inflation and Credit pillars. Sources: lseg.com (balanced macro), fidenzamacro.com (four-quadrant).
- **DeMiguel, Garlappi & Uppal (2009)**: 1/N equal weighting beats mean-variance-optimized weights out of sample, because equal weights carry no estimation risk. Corroborated by ReSolve ("simple vs optimal"). This justifies equal weighting *within* pillars and modest, fixed, judgment-based weights *across* pillars — validated by the robustness result in §5.6 (equal pillar weights produce a 0.991-correlated composite).
- **Dallas Fed trimmed-mean PCE** is the institutionally preferred robust core-inflation measure; flagged as a future substitution (§6).

---

# Part III — Data Infrastructure

## 3.1 Pipeline

```
Src/pull_mrs_data.py        FRED + Yahoo acquisition → Data/Raw/
Src/process_mrs_inputs.py   transformations, monthly panel → Data/Processed/mrs_inputs_monthly.csv
Src/mrs_proposed_framework.py  v2.1 scoring engine (imported as `eng` by
                             mrs_monitoring_store.py); standalone backtest run
                             → Research/MRS/_archive/v2_backtest/mrs_proposed_*.csv
Src/mrs_monitoring_store.py    builds monitoring tables + MRS_Master.xlsx
                             → Research/MRS/monitoring/, Research/MRS/MRS_Master.xlsx
Src/export_dashboard_data.py   converts MRS_Master.xlsx sheets to dashboard JSON
                             → Research/MRS/dashboard/data/*.json
```

Input panel: **317 monthly rows × 57 columns, 2000-01 – 2026-05**. Validation (see `mrs_validation_log.md`): 0 errors, 3 warnings (single interior NaN gaps in core CPI, CPI acceleration, real FF rate — none used by v2.0).

## 3.2 Source series and transformations (v2.0 inputs only)

| Panel column | Source (FRED unless noted) | Transformation |
|---|---|---|
| `nfp_3m_avg` | PAYEMS | MoM change in payrolls, 3-month rolling average |
| `ipman_yoy` | IPMAN | YoY % change |
| `gdp_yoy` | GDPC1 (quarterly) | forward-filled to monthly; YoY % = GDPC1ₜ/GDPCₜ₋₄ − 1 |
| `real_serv_pce_yoy` | PCES / DSERRG3M086SBEA | real services consumption (nominal PCE services ÷ services deflator), YoY % — v2.1 |
| `core_pce_yoy` | PCEPILFE | YoY % change |
| `nfci` | NFCI (weekly) | monthly average |
| `t10y2y` | T10Y2Y (daily) | month-end level |
| `ig_spread` | BAA10YM | level (Moody's BAA − 10Y Treasury) |
| `vixcls_avg` | VIXCLS (daily) | monthly average (v2.1; month-end and month-max also stored) |
| `bond_stress_proxy` | STLFSI2 (2000–2022) + DGS10 30-day realized vol (2022+) | z-score normalized splice |
| `spy_ret` | SPY (Yahoo Finance) | monthly total return |
| `usrec` | USREC | NBER recession dummy — **validation only, not in the score** |

## 3.3 Proxy substitutions and data caveats

| Intended series | Substitute | Reason | Caveat |
|---|---|---|---|
| ISM Manufacturing PMI | IPMAN YoY % | Bloomberg-only | Hard activity data rather than survey; lags diffusion-type signals slightly |
| MOVE index | STLFSI2 + DGS10 realized-vol splice | Bloomberg-only | Splice point at 2022; construction predates v2.0 and has not been independently re-audited |
| IG OAS (ICE BofA) | BAA10YM | ICE licensing truncates FRED history to 2023+ | Includes a duration/quality component OAS would not |
| HY OAS | **dropped entirely in v2.0** | pre-2023 "proxy" was IG × 1.8 — pure duplication | Genuine long-history HY OAS remains a desired future addition |

Known coverage limits: VIX begins 1990 but the panel starts 2000; the **dot-com collapse (2000–2002) falls inside the normalization warm-up and is not scored** by either framework version; `gdpc1_monthly` is an interpolated quarterly series and lags turning points by one to two quarters.

---

# Part IV — Methodology Specification (v2.0)

## 4.1 Normalization

Every indicator is transformed to an expanding-window z-score:

```
z_t = ( x_t − mean(x₁..x_t) ) / std(x₁..x_t, ddof=1)
```

- **Minimum history:** 24 months before the first score is emitted.
- **Window:** expanding (all history up to and including month *t*) — the OFR convention. No look-ahead.
- **Clipping:** ±3, to bound the influence of any single indicator in unprecedented events while preserving ordering.
- **Sign convention:** each z-score is signed so that **higher = more favorable**; series where high raw values are adverse (spreads, VIX, NFCI, inflation deviation) enter with a negative sign.

Properties this buys over v1.0's percentile ranks: tails are preserved (GFC reads −2.2σ, not "bottom decile ≈ 1.2"); early-history readings honestly reflect what was knowable; units are interpretable as standard deviations from historical norm.

## 4.2 The five pillars

Equal weight within each pillar (1/N, §2.3). A pillar emits a score only when **all** member indicators are live; the composite only when all five pillars are live. Effective scored history: **June 2003 onward**.

### Pillar 1 — Growth (weight 30%)

| Indicator | Definition | Sign |
|---|---|---|
| `g_nfp` | z(3-month average monthly payroll change) | + |
| `g_ipman` | z(manufacturing IP, YoY %) | + |
| `g_gdp` | z(real GDP, YoY %) | + |
| `g_serv` | z(real services consumption, YoY %) — v2.1 | + |

**Economic intuition.** Growth is the central organizing variable of the macro regime: it drives earnings, default rates, and policy. The four indicators deliberately span four distinct dimensions — **labor** (NFP: broad, slightly lagging, but demonstrably independent: it diverged from industrial signals in 2015–16 and 2022, correctly capturing labor-market resilience while manufacturing weakened), **industry** (IPMAN: the best growth-collapse detector in the audit, 79% of crisis months in the stress zone), **output** (GDP: the authoritative aggregate and the single most independent variable in the framework at 68.5% unique information, at the cost of one to two quarters' lag), and — since v2.1 — **services** (real services consumption: PCE services deflated by its own price index).

**The services addition (v2.1).** Services are ~70% of GDP; until v2.1 the pillar saw them only indirectly through labor — a services-led downturn that left industry untouched would have been detected late. Candidate evaluation: services *employment* fails the redundancy gate spectacularly (3-month momentum correlates **0.983** with `g_nfp` — payrolls already are mostly services); real services *consumption* passes (r = 0.41/0.54/0.21 against the three incumbent growth z-scores, crisis separation +2.15) because it measures activity, not jobs. It is the smooth, persistent member of the pillar — slow to alarm, but it covers the economy's largest blind spot.

**What was excluded and why:** INDPRO (r = 0.915 with IPMAN — same factor twice; dropping it *reduced* pillar noise); services employment (r = 0.983 with NFP, above).

### Pillar 2 — Inflation (weight 15%)

| Indicator | Definition | Sign |
|---|---|---|
| `i_pce_dev` | z( \|core PCE YoY − 2.0\| ) | − |
| `i_pce_mom` | z( 6-month change in core PCE YoY ) | − |

**Economic intuition.** The level term measures **distance from the Fed's 2% target, symmetrically**: both overheating and deflation are regime-adverse, since both force policy responses and compress risk premia. The momentum term encodes the quadrant-framework insight (§2.3): **accelerating inflation is regime-negative regardless of level**, because it raises the odds of tightening; 3% and falling is a better environment than 3% and rising. Normalizing the deviation (rather than fixed bands) lets the score reflect how unusual the deviation is historically — this is precisely what un-pins the pillar from the top of its range, the defect that floored v1.0.

**Weight rationale.** Inflation is an **overlay, not a crisis sensor** — its v1.0 separation was ≈ 0 because financial crises are not inflation events. It earns 15% for the regimes where it is decisive (2021–22), not for crisis detection.

**What was excluded:** core CPI (r = 0.928 with core PCE; the Fed targets PCE), the breakeven adjustment term (4 regime changes in 280 months — operationally inert), CPI 3-month acceleration (superseded by the cleaner 6-month PCE momentum term).

### Pillar 3 — Liquidity / Rates (weight 15%)

| Indicator | Definition | Sign |
|---|---|---|
| `l_nfci` | z(Chicago Fed NFCI, monthly avg) | − |
| `l_curve` | z(10Y–2Y Treasury spread, month-end) | + |

**Economic intuition.** NFCI is a 105-variable institutional composite of credit, leverage, and funding conditions — the broadest available *outcome* measure of financial conditions, and the second-best crisis discriminator in the audit (+2.940; 95.8% of crisis months in the stress zone). The yield curve is the canonical *forward-looking* rates signal: inversion has preceded every modern US recession; it correctly led the 2022–23 episode. The two are complementary: NFCI is coincident-to-lagging breadth, the curve is leading shape.

**The defining change from v1.0:** the real fed funds rate and the 3-month fed-funds direction are **removed**. Both scored the *policy reaction* rather than *conditions* — rate cuts during the GFC pushed both near their maxima (the pillar peaked the month after Lehman). This pillar now measures conditions only. The curve's known limitation — it *steepens* during crises as the Fed cuts — is accepted: it is one of two indicators in a pillar worth 15%, and NFCI dominates in crises; the curve earns its place as the framework's principal *leading* indicator. To prevent misreading, the monitoring layer classifies every ≥0.20pp 3-month curve move as **bull steepening** (front-end falling — crisis-typical; an active flag warns that `l_curve` "improvement" is then suspect), **bear steepening**, or **flattening** (§7.4). Validated historically: bull steepening fires in Sep–Nov 2008 and in only 16 of 275 months overall; the 2022 hiking cycle correctly reads as flattening.

### Pillar 4 — Credit (weight 20%)

| Indicator | Definition | Sign |
|---|---|---|
| `c_ig_level` | z(IG spread level, BAA10YM) | − |
| `c_ig_mom` | z(6-month change in IG spread) | − |

**Economic intuition.** Credit spreads are the market's real-time price of default risk and the audit's best *credit* stress signal (+2.668). The level term locates the regime; the **momentum term is a genuine second signal, not a duplicate** — spread *widening* is the classic pre-recession dynamic and leads the level. This level + momentum pair on one clean series replaces v1.0's fake breadth (an "HY spread" that was literally IG × 1.8 for 86% of its history, plus an adjustment term that changed 2 regime months in 26 years).

Credit also provides the framework's main **crisis-type discriminator**: in 2022, spreads stayed benign (healthy corporate balance sheets) while inflation and rates deteriorated — correctly distinguishing an inflationary bear market from a financial crisis. v1.0's audit identified this as one of its few genuinely informative behaviors; v2.0 preserves it.

**Weight rationale (20%):** credit was among the audit's best discriminators and is the pillar most directly tied to systemic stress transmission.

### Pillar 5 — Market Stress (weight 20%)

| Indicator | Definition | Sign |
|---|---|---|
| `s_vix` | z(VIX, monthly average — v2.1; month-end before) | − |
| `s_bond` | z(bond stress proxy: STLFSI2/DGS10-vol splice) | − |
| `s_spy_dd` | z(SPY drawdown from running peak of cumulative return index) | + |

**Economic intuition.** Three distinct stress channels: **equity volatility** (VIX — the fast signal; its lowest score in v1.0 history came during COVID), **bond-market stress** (the single best crisis discriminator in the audit: +3.331, 95.8% — the GFC was a funding/credit-market crisis first, and bond stress captured it better than VIX), and **realized equity damage** (drawdown from peak). The drawdown formulation deliberately replaces v1.0's trailing 3-month return: a drawdown *persists* through a bear market (it stays depressed until the loss is recovered), whereas a 3-month return mean-reverts mid-crisis and scored the GFC at a misleadingly moderate 2.3.

**VIX sampling (v2.1).** Month-end snapshots demonstrably missed intra-month stress: the month-end z-score read Volmageddon (Feb 2018, intra-month VIX 37) as 0.00, the SVB stress (Mar 2023, VIX 27) as −0.20, and the Aug 2024 unwind (VIX 39) as −0.62 — *calmer than normal* in all three. The monthly **average** (institutional convention; NFCI is itself a weekly average) corrects the sign of all three episodes. The monthly **maximum** was evaluated and rejected as the score input — a single fully-reversed spike day would dominate an entire month of a *macro regime* indicator — but it is stored in the input panel (`vixcls_max`) for dashboard context.

**Known overlap, accepted:** bond stress proxy and NFCI correlate at 0.834 across pillars. Both are kept because they were the two best discriminators in the entire audit and the pillar structure separates their roles (broad conditions vs rate-market stress); the robustness results (§5.6) show no fragility from it.

## 4.3 Composite

```
composite_t = 0.30·Growth_t + 0.15·Inflation_t + 0.15·Liquidity_t + 0.20·Credit_t + 0.20·Stress_t
```

Weights are fixed, judgment-based, and tilted toward the audit's best crisis discriminators (Credit, Stress) and the economically central pillar (Growth). They are deliberately **not** estimated: §5.6 shows the composite is nearly invariant to plausible weight changes, so estimation would add fragility without information.

**Why Growth carries the largest weight (30%).** The MRS is intended to be an *economic regime indicator*, not only a stress detector. Credit and market-stress variables are excellent at identifying drawdowns once stress is already visible, but they are inherently closer to market pricing and therefore more reactive. The Growth pillar anchors the framework in the real economy and preserves upside participation: avoiding contractions is important, but a regime model that systematically underweights improving growth risks remaining too defensive during recoveries and expansions. The 30% Growth weight therefore reflects the framework's forward-looking investment objective — to classify the economic environment early enough to support allocation decisions — rather than simply mirroring the variables with the strongest historical crisis discrimination.

`contribution_p,t = weight_p × pillar_p,t` is stored for every pillar every month — contributions are additive and sum exactly to the composite, which is what makes the decomposition dashboards (§8) possible.

## 4.4 Regime classification

Averaging thirteen correlated z-scores compresses dispersion: the composite's realized standard deviation is **0.55**, not 1.0. Rather than re-standardizing the composite (a second normalization layer, 24 more months of warm-up, more machinery), thresholds were **calibrated once to the composite's empirical scale at v2.0** and are fixed — they were deliberately *not* re-tuned for v2.1 (composite std 0.547, well inside the §7.5 band; re-fitting thresholds for a 4–6pp frequency shift would be exactly the fragility the drift rule exists to prevent):

| Regime | Composite | Realized frequency, v2.1 confirmed (2003-06 – 2026-04) |
|---|---|---|
| **Expansion** | ≥ +0.35 | 24.4% |
| **Neutral** | −0.30 to +0.35 | 61.8% |
| **Slowdown** | −1.00 to −0.30 | 8.4% |
| **Contraction** | < −1.00 | 5.5% |

**Persistence rule:** a regime switch is recognized only after **two consecutive months** in the new raw regime (Conference Board duration-style filter). Both the raw and confirmed regimes are stored. Cost-benefit: transitions fall from 44 raw to 20 confirmed; the cost is entry lag where the raw signal oscillates (one month for COVID Contraction; longer in slow-building episodes — see §5.9 on GFC entry timing).

**The NBER cap is dropped.** v1.0 capped its Growth component at 2.0 during NBER recession months — ex-post information (NBER announces with 6–12 months' delay) inside what should be a point-in-time score. The backtest shows it is also unnecessary: the composite reaches Contraction under its own power in both sample recessions, and turned raw-Contraction in March 2008, nine months before the NBER's announcement. `usrec` is retained strictly as a validation benchmark.

## 4.5 Exclusion register

Every variable removed from v1.0, with the evidence:

| Removed | Evidence |
|---|---|
| `gs_indpro` | r = 0.915 with IPMAN; VIF 8.1; removal reduced pillar noise |
| `is_core_cpi` | r = 0.928 with core PCE; VIF 12.7; slightly *wrong* direction in crises (−0.223 separation) |
| `is_t10yie_adj` | 4 regime changes in 280 months; r = 0.19 with own pillar |
| `rls_real_ff` | separation −1.258; scored crisis rate cuts as positive; r = −0.65 with IG spread (redundant across pillars) |
| `rls_ff_direction` | separation −1.963 — worst variable in the framework; 0% crisis months in stress zone; near its maximum during the GFC |
| `crs_hy_spread` | = IG × 1.8 pre-2023; r = 1.0000 exact for 253 of 294 months; VIF 52 |
| `crs_spread_adj` | 2 regime changes in 280 months |
| `mss_spy_3m` | replaced by the drawdown formulation (persistent through bear markets rather than mean-reverting); the underlying SPY series is retained |
| NBER GS cap | ex-post information; demonstrated unnecessary (§4.4) |

---

# Part V — Validation and Regime Analysis

All results from `Src/mrs_proposed_framework.py` over 2003-06 – 2026-04 (275 scored months). Comparison columns refer to v1.0 over its 280-month history. **§5.1–5.6 present the v2.0 calibration evidence (12 indicators, month-end VIX) — the basis on which the framework was accepted; §5.9 documents the v2.1 revision and its deltas, all of which are small.** §5.8 reflects the current (v2.1) reading.

## 5.1 Composite distribution

| Statistic | v2.0 composite (z-units) | v1.0 MRS (1–5 scale) |
|---|---|---|
| Mean | +0.098 | 3.397 |
| Std | 0.555 | 0.509 |
| Min | **−2.164** (Dec 2008) | 2.144 (Mar 2009) |
| Max | +0.984 | 4.434 |

The v2.0 minimum sits 4.1 standard deviations below the mean — the tail exists. v1.0's minimum sat 2.5 std below its mean, by construction near its mathematical floor of ≈ 2.03.

## 5.2 Event discrimination

| Event | Window | v2.0 mean / min | v2.0 modal regime | v1.0 mean / min | v1.0 modal regime |
|---|---|---|---|---|---|
| GFC | 2008-09 – 2009-06 | −1.73 / **−2.16** | **Contraction (10/10 months)** | 2.35 / 2.14 | Slowdown |
| Euro debt crisis | 2011-08 – 2011-12 | −0.07 / −0.36 | Neutral | 3.30 / 2.99 | Moderate |
| China/EM 2015 | 2015-08 – 2016-02 | −0.18 / −0.26 | Neutral | 2.85 / 2.71 | Slowdown |
| COVID crash | 2020-02 – 2020-05 | −1.18 / **−1.60** | **Contraction** | 2.43 / 2.18 | Slowdown |
| 2022 inflation bear | 2022-01 – 2022-12 | −0.46 / −0.59 | **Slowdown (10/12)** | 2.58 / 2.39 | Slowdown |
| 2003–04 expansion | 2003-06 – 2004-06 | +0.81 / +0.52 | **Expansion** | 4.17 / 3.89 | Expansion |
| 2017 expansion | 2017-01 – 2017-12 | +0.39 / +0.32 | Neutral 7 / Expansion 5 | 3.61 / 3.43 | Moderate |
| 2021 reopening | 2021-03 – 2021-12 | +0.16 / −0.08 | Neutral | 3.87 / 3.42 | Moderate |

Reading: the two genuine US macro contractions — and only those — reach Contraction. Euro 2011 and EM 2015 staying Neutral is **correct** for a *US* regime score (neither caused a US recession; v1.0 actually scored EM-2015 as a deeper event than the Euro crisis, an ordering artifact). 2021 reading Neutral rather than Expansion is the quadrant logic operating: growth contributed +0.27 but overheating inflation dragged −0.40 — reflation with hot inflation is not Goldilocks.

## 5.3 Severity ordering and crisis typology

The framework now produces a coherent severity scale and distinguishes crisis *types* through pillar signatures (mean pillar contributions, z-units):

| Episode | Growth | Inflation | Liquidity | Credit | Stress | Signature |
|---|---|---|---|---|---|---|
| GFC | **−0.80** | −0.02 | −0.12 | **−0.40** | **−0.40** | growth collapse + systemic credit/funding stress |
| COVID | **−0.65** | −0.02 | −0.11 | −0.19 | −0.21 | growth shock; markets stabilized fast (Fed backstop) |
| 2022 | +0.03 | **−0.28** | −0.12 | +0.04 | −0.13 | inflationary bear: credit calm, inflation/rates adverse |
| 2021 | +0.27 | **−0.40** | +0.03 | +0.14 | +0.12 | hot growth, hotter inflation |
| Full sample | +0.04 | −0.04 | −0.01 | +0.04 | +0.07 | — |

This decomposition is additive and exact — impossible under v1.0's percentile arithmetic — and is the analytical core of the contribution dashboards (§8).

## 5.4 Lead/lag behavior and NBER alignment

- Raw composite ≈ −1 (Slowdown) by **January 2008**; raw Contraction from **March 2008** (Bear Stearns) — nine months before NBER's Dec 2008 announcement, six months before Lehman.
- Of 20 NBER recession months in sample: **14 Contraction, 5 Slowdown, 1 Neutral**.
- Of 18 confirmed Contraction months: 14 inside NBER recessions; the other 4 are **May–Aug 2020**, immediately after the official April-2020 trough, when conditions remained plainly contractionary — a defensible "miss" of the official dating.
- The confirmation rule delayed Contraction entry by exactly one month in both crises (GFC: Mar→Apr 2008; COVID: Mar→Apr 2020).

## 5.5 Stability

| Metric | v2.0 (confirmed) | v1.0 |
|---|---|---|
| Regime transitions | 28 | 30 |
| Average regime duration | 9.5 months | 9.0 months |
| Mean monthly \|Δ composite\| | 0.124 z | 0.138 (1–5 units) |

The far stronger discrimination costs nothing in stability.

## 5.6 Robustness

- **Equal pillar weights (20/20/20/20/20)** vs official weights: composite correlation **0.991**, regime agreement **89.1%**. The weighting is not load-bearing.
- **Thresholds:** ±0.05 on the Expansion/Neutral boundary moves Expansion frequency by ~5pp (it cuts through the dense center of the distribution); the Slowdown and Contraction boundaries are insensitive — crisis months sit far below them. Reported, fixed, and documented; not to be re-tuned casually.
- **Confirmation rule:** raw and confirmed regime frequencies are nearly identical (within ~1pp per regime); the rule changes timing, not classification.

## 5.7 Strengths, weaknesses, observed patterns

**Strengths.**
1. Reaches the full regime scale; tail events register at tail magnitudes.
2. Point-in-time honest end to end (no NBER cap, expanding windows).
3. Exactly additive pillar decomposition — every reading is explainable.
4. Distinguishes crisis types (financial vs inflationary vs external).
5. Demonstrated lead in 2008; correct non-signals for non-US crises.
6. Robust to its own free parameters (§5.6).

**Weaknesses and honest limitations.**
1. **In-sample calibration.** Thresholds were chosen on the same 2003–2026 window they are evaluated on (chosen for frequency sanity, not event-fitting, and shown insensitive — but a true out-of-sample test requires new data).
2. **One business cycle of severe events.** Two Contraction episodes is a thin sample; the dot-com recession is unscorable (warm-up period).
3. **Month-end sampling.** VIX resolved in v2.1 (monthly average, §5.9); the curve and IG spread remain month-end/monthly snapshots — residual intra-month undersampling is possible, but those series do not spike-and-reverse the way VIX does.
4. **Early-history softness.** Expanding z-scores rest on 24–60 months of history before ~2006; clipping mitigates but does not remove this.
5. **Constructed inputs.** `bond_stress_proxy` (splice) and `gdpc1_monthly` (interpolation) predate v2.0 and were not re-audited. The splice scales its two segments with full-sample stats; the engine's expanding z is invariant to each segment's affine transform, so the residual look-ahead is confined to the segments' *relative* scaling at the 2022 joint.
6. **Composite std will drift** slowly as history accumulates; thresholds need periodic re-verification (not re-fitting) — see §7.5.
7. **Services-sector growth signal** — resolved in v2.1 (`g_serv`, §5.9). The remaining caveat: real services consumption is smooth and slow to alarm; a fast services shock still reaches the score first through labor and markets.

**Observed patterns worth tracking forward** (hypotheses for the research views, §8.7):
- Credit-momentum and curve deterioration tend to precede growth deterioration (2007–08 sequencing).
- The Inflation pillar is near-zero in financial crises and dominant in policy-tightening regimes — pillar signatures may be usable as a crisis-type classifier.
- Stress pillar recovers fastest post-trough (2009, 2020); Growth recovers slowest. Pillar-recovery sequencing may help time regime upgrades.

## 5.8 Current reading (2026-04, v2.1)

| | Value |
|---|---|
| Composite | **+0.03** (display 3.03) — **Neutral**, month 39 |
| 3-month change | −0.23 |
| Historical percentile | 31st |
| Pillars | Growth +0.02 · Inflation −0.87 · Liquidity −0.15 · Credit +0.48 · Stress +0.38 |
| Active flags | Inflation pillar deterioration warning (`i_pce_dev` −0.68, `i_pce_mom` −0.73 over 6m); `s_bond` deteriorating |

Interpretation: a mid-band Neutral reading drifting softer, with above-target/accelerating inflation as the dominant drag and calm credit/market conditions as the offset — an environment signature closer to 2021-style overheating risk than to credit-led deterioration. (v1.0 for the same month read 3.20 "Moderate/Stable", with most of the same story buried in offsetting component quirks.)

## 5.9 Version 2.1 revision (2026-06-11)

Two methodology changes, both responding to external review; full evaluation evidence in the v2.1 commit:

1. **`g_serv` added to Growth** (13 indicators total). Real services consumption = nominal PCE services ÷ services price deflator, YoY. Closes the framework's largest structural blind spot (~70% of GDP). Services employment was evaluated first and rejected: its 3-month momentum z correlates **0.983** with `g_nfp` — fake breadth of exactly the kind the v1.0 audit existed to remove. Real services consumption: r = 0.41/0.54/0.21 vs the three incumbent growth z-scores; crisis separation +2.15.
2. **`s_vix` sampling: month-end → monthly average.** Month-end snapshots scored Volmageddon (z 0.00), SVB (−0.20), and the Aug-2024 unwind (−0.62) as calm-or-better; the monthly average corrects all three signs. Month-max was evaluated and rejected for the score (one reversed spike day shouldn't drive a monthly macro regime input) but is stored for dashboards.

**Thresholds deliberately unchanged** (composite std 0.547, inside the §7.5 band). Effect on results vs §5.1–5.6:

| Metric | v2.0 | v2.1 |
|---|---|---|
| GFC min / modal | −2.16 / Contraction (10/10) | −2.15 / Contraction (10/10) |
| COVID min / modal | −1.60 / Contraction | **−1.65** / Contraction |
| 2022 modal | Slowdown | Slowdown |
| Confirmed frequencies | 28 / 58 / 7 / 7 % | 24 / 62 / 8 / 6 % |
| Confirmed transitions / avg duration | 28 / 9.5m | **20 / 13.1m** |
| Equal-weight robustness | 0.991 / 89.1% | 0.989 / 91.6% |

**One trade-off, stated plainly:** the *confirmed* GFC Contraction entry moves from Apr 2008 to **Sep 2008** (Lehman month) — services consumption genuinely held up through spring 2008, so the raw regime oscillated Contraction/Slowdown without two consecutive Contraction months until September. The **raw signal still fires in March 2008**, and the §7.4 regime-change watch flags the downgrade proximity from **February 2008** — the monitoring layer, not the confirmed label, carries the early warning. Confirmed entry remained three months ahead of the NBER announcement. NBER alignment: 11 of 20 recession months Contraction, 8 Slowdown, 1 Neutral.

---

# Part VI — Gaps and Recommended Enhancements

Listed only where they materially improve robustness, interpretability, or investment usefulness. Everything else considered and rejected stays rejected (PCA weighting, regime-switching models, daily frequency, more indicators for breadth's sake).

**Tier 1 — material, do before treating v2.0 as production:**

1. **Operationalize the monitoring store (Part VII) — done (v2.0.1)**: `Src/mrs_monitoring_store.py`.
2. **Production cutover decision.** Retire v1.0 outputs (`mrs_final_scores.csv` etc.) or clearly mark them legacy; one official score must be unambiguous.
3. **Services-sector growth indicator — resolved in v2.1**: `g_serv` = real services consumption (PCES ÷ services deflator). Services employment was evaluated and rejected (r = 0.983 with `g_nfp`). ISM Services remains the preferred upgrade if Bloomberg access ever materializes.

**Tier 2 — material, not blocking:**

4. **Genuine long-history HY OAS** (licensing permitting): would let Credit distinguish quality-tier stress; the audit showed real HY information exists post-2023 (r = 0.49 vs IG actuals).
5. **Dallas Fed trimmed-mean PCE** replacing core PCE: more robust to idiosyncratic component swings; institutional best practice.
6. **Diffusion overlay**: % of the 13 indicators above their own expanding median (LEI 3Ds breadth logic). A z>0 variant ships with the monitoring store (`diffusion`, §7.3); the median variant remains optional.
7. **Senior Loan Officer Survey (SLOOS) net tightening** as a Liquidity candidate: the audit's preferred outcome-based replacement for the removed policy variables; quarterly frequency is the main integration cost.

**Tier 3 — research agenda:**

8. **Forward-return conditioning study**: regime-conditional forward 6/12-month return and correlation behavior across the asset universe (links MRS to the correlation workstreams; prerequisite for portfolio integration §8.6).
9. **Out-of-sample protocol**: freeze spec (done), log vintages (Part VII), evaluate each new year of data against the frozen thresholds before any re-calibration discussion.
10. **Intra-month stress sampling — resolved in v2.1**: `s_vix` moved to monthly average; month-max evaluated, rejected for the score, stored as `vixcls_max` for dashboards.

---

# Part VII — Historical Output and Tracking Specification

The framework's value for monitoring depends on storing not just current scores but their full evolution. This section defines the **canonical data store** every downstream dashboard and study reads from. Three monthly tables (CSV now; same schema works in a database later), one snapshot archive, plus derived-metric definitions.

## 7.1 Table 1 — `mrs_indicator_history` (one row per month × 13 indicators)

| Field | Definition |
|---|---|
| `date`, `indicator`, `pillar` | keys (indicator codes per §4.2) |
| `raw_value` | untransformed input (for auditability) |
| `z_score` | signed, clipped expanding z (the indicator's score) |
| `z_3m_chg`, `z_6m_chg`, `z_12m_chg` | rate of change over 3/6/12 months |
| `z_trend_6m` | 6-month rolling mean of z (smoothed trend line) |
| `pctile_expanding` | percentile of current z within own scored history (0–100) |
| `direction_flag` | improving / deteriorating / flat: sign of `z_3m_chg` with ±0.10 dead-band |
| `streak_months` | consecutive months with the same `direction_flag` |
| `expanding_mean_raw`, `expanding_std_raw` | the normalization parameters used this month (drift monitoring, §7.5) |

## 7.2 Table 2 — `mrs_pillar_history` (one row per month × 5 pillars)

| Field | Definition |
|---|---|
| `date`, `pillar` | keys |
| `score` | pillar z-score |
| `contribution` | weight × score (additive; sums to composite) |
| `score_3m_chg`, `score_6m_chg`, `score_12m_chg` | momentum / rate of change |
| `score_trend_6m` | 6-month rolling mean |
| `pctile_expanding` | percentile vs own history |
| `regime_at_obs` | confirmed composite regime that month (enables regime-conditional pillar statistics) |
| `direction_flag`, `streak_months` | as in Table 1 |
| `breadth` | fraction of member indicators with z > 0 (within-pillar diffusion) |

## 7.3 Table 3 — `mrs_composite_history` (one row per month)

| Field | Definition |
|---|---|
| `date` | key |
| `composite`, `display_score` | z-units; 3 + z clipped [1,5] |
| `regime_raw`, `regime_confirmed` | per §4.4 |
| `comp_1m/3m/6m/12m_chg` | rate of change at four horizons |
| `comp_trend_6m` | 6-month rolling mean |
| `pctile_expanding` | percentile vs own history |
| `months_in_regime` | duration counter since last confirmed switch |
| `dist_to_upgrade`, `dist_to_downgrade` | gap (z-units) to the nearest threshold above/below — the "how close to a regime change" gauge |
| `diffusion` | % of all (13) indicators with z > 0 (framework-wide breadth, §6 item 6) |
| `curve_env` | yield-curve move classifier: bull_steepening / bear_steepening / flattening on ≥0.20pp 3-month curve moves; front-end direction distinguishes bull from bear |
| `top_drag`, `top_support` | pillar with most negative / most positive contribution (label fields for dashboards) |
| `usrec` | NBER dummy (validation only) |

## 7.4 Signal deterioration / improvement indicators

Standardized definitions so "deteriorating" means one thing everywhere:

- **Deterioration warning** (per indicator/pillar/composite): `direction_flag = deteriorating` AND `streak_months ≥ 3` AND `z_6m_chg < −0.25`.
- **Improvement signal**: mirror image.
- **Regime-change watch**: composite within 0.10 z of a threshold (`dist_to_*`) AND moving toward it (sign of `comp_3m_chg`).
- **Breadth confirmation**: a composite move is *confirmed* when `diffusion` moves ≥ 15pp in the same direction over the same 6 months; otherwise flagged *narrow* (driven by few indicators — historically more likely to reverse; to be validated as data accrues, §5.7).
- **Divergence flag**: any pillar whose `direction_flag` has opposed the composite's for ≥ 3 months (the 2021 inflation-vs-growth pattern; early signature of regime-type change).
- **Bull-steepening warning**: `curve_env = bull_steepening` raises an active flag — curve "improvement" driven by front-end cuts is crisis-typical (fires Sep–Nov 2008; 16 of 275 months historically), and the Liquidity pillar should be read against NFCI alone while the flag is active.

## 7.5 Vintage, revision, and drift management

- **Snapshot archive:** at each monthly run, write the three tables to `Research/MRS/vintages/YYYY-MM/`. Macro inputs revise (NFP, GDP, PCE); expanding statistics also shift history-dependent values. Vintages are what make "what did we know in month *t*" answerable — the foundation of any honest forward-looking evaluation (§6 item 9).
- **Revision log:** when a re-run changes any confirmed historical regime, log it (`date, old, new, cause`). Frequent flips would themselves be a finding.
- **Drift watch (mandatory rule):** the gauge is the composite's **expanding** std — the scale the thresholds were calibrated to (0.555 at v2.0; 0.547 at v2.1). If it exits the **[0.45, 0.65]** band, a threshold review is **mandatory and non-discretionary**: it must be opened, documented, and resolved as a version increment (the outcome may be re-affirm or re-fit, but the review itself is not optional). Inside the band, thresholds must not be touched. The trailing 10-year std is stored as context only — it runs structurally lower in crisis-free decades (0.37 at calibration) and is *not* a threshold-validity gauge; a hard band on it would have triggered a spurious mandatory review on day one.
- **Versioning:** any change to indicators, weights, thresholds, or rules increments the methodology version; series are tagged with the version that produced them.

## 7.6 Update cadence

Monthly, after month-end FRED postings (NFCI weekly and market data arrive earlier; the binding constraint is PCE, ~4 weeks after month-end). Each run: pull → rebuild panel → score → append tables → snapshot vintage → evaluate flags (§7.4) → render dashboards.

---

# Part VIII — Dashboard Architecture

Four layers, top-down: regime → composite → pillar → indicator, with overlay, integration, and research views. Every visual reads exclusively from the Part VII tables — no bespoke computation inside dashboards.

**Implementation status (2026-06-14):** Layers 0-4 (§§8.1-8.5) are built as a
static HTML/JS dashboard at `Research/MRS/dashboard/`, reading
`Research/MRS/dashboard/data/*.json` (exported from `MRS_Master.xlsx` by
`Src/export_dashboard_data.py`). Layers 5-7 (§§8.6-8.7, portfolio integration
and research/validation views) are deferred pending the conditioning studies
referenced in Part VI. See `MRS_Dashboard_Implementation_Plan.md` for the build
log and the open GitHub Pages hosting decision.

## 8.1 Layer 0 — Regime header (the one-glance answer)

Current confirmed regime (color-coded: Expansion green / Neutral grey / Slowdown amber / Contraction red), months in regime, composite value and 3-month change with directional arrow, distance to nearest threshold, active warning flags (§7.4). This header repeats on every other view.

## 8.2 Layer 1 — Composite MRS dashboard

- Full-history composite line with confirmed-regime color bands and NBER shading (validation overlay, clearly marked ex-post).
- Threshold lines at +0.35 / −0.30 / −1.00; raw vs confirmed regime strip.
- Momentum panel: 1/3/6/12-month change bars; 6-month trend line.
- Stacked contribution area chart (five pillars, additive to the composite) — the single most informative chart in the framework: it *is* §5.3 through time.
- Historical percentile gauge; diffusion line under the main chart (breadth vs level divergence is the §7.4 confirmation signal).

## 8.3 Layer 2 — Pillar dashboards (×5, one template)

- Pillar score history with composite-regime bands; member-indicator lines beneath.
- Contribution-to-composite through time; current weight.
- Momentum at 3/6/12 months; direction streak; within-pillar breadth.
- **Regime-conditional profile**: distribution of this pillar's score by confirmed regime (box/violin) — answers "is this pillar behaving as it historically does in this regime?"
- Pillar-specific annotations: e.g., Credit dashboard marks level-vs-momentum divergences (widening from tight levels — the 2007 pattern); Inflation dashboard marks the level/momentum quadrant (above/below target × accelerating/decelerating); Liquidity dashboard shades `curve_env` so bull-steepening periods are visually distinct from genuine easing.

## 8.4 Layer 3 — Indicator dashboards (×12, one template)

- Raw series and z-score, dual-axis, full history; clip events (|z| = 3) marked.
- Expanding mean/std bands on the raw series (what the normalization "believes" — makes drift visible).
- Momentum, percentile, streak; deterioration/improvement flag history.
- Data lineage block: source series, transformation, proxy caveats (§3.3), last data date — operational data-quality surface.

## 8.5 Trend & change monitoring view

The early-warning workspace, assembled entirely from §7.4 flags:

- Heatmap: 13 indicators × trailing 24 months, colored by z; one row per pillar above it. Turning points appear as color fronts.
- Active flags table (deterioration warnings, regime-change watch, divergences, narrow-move warnings), each with onset date and magnitude.
- "Movers" panel: largest 3-month z changes, both directions.
- Regime-transition diagnostics: every historical confirmed switch with the pillar contributions that drove it (which pillar "called" each turn — accumulating evidence for the §5.7 sequencing hypotheses).

## 8.6 Portfolio construction integration view

Bridges MRS to allocation work (consumes, in addition, the asset-universe correlation/beta outputs):

- Current regime + asset-class behavior conditional on that regime (forward-return and correlation tables by regime — populated by the §6 item-8 study once run).
- Pillar-signature similarity: which historical episodes most resemble the current month's pillar vector (nearest-neighbor on the 5-pillar profile) and what cross-asset behavior followed.
- Regime-overlay exports: the confirmed-regime series as a conditioning column for every other workstream (sector returns, beta studies, correlation regimes).
- Explicit caveat panel: two Contraction episodes in-sample; regime-conditional return statistics carry small-N uncertainty.

## 8.7 Research & validation view

The living version of Part V, recomputed each run:

- Event table (§5.2) auto-extended as new episodes are labeled.
- Regime frequency / duration / transition-count tracking vs the calibration baseline (§5.5 numbers frozen as reference).
- NBER alignment scorecard, updated when NBER announces.
- Threshold and weight sensitivity monitors (§5.6 re-run on accumulating data).
- Drift dashboard (§7.5): expanding-parameter paths per indicator; composite rolling std vs calibration band.
- Vintage comparison: confirmed-regime history across vintages (revision stability).

## 8.8 Build order

1. Tables 1–3 + vintage snapshots (Part VII) — everything else reads from these.
2. Layer 1 composite dashboard + Layer 0 header.
3. Trend & change monitoring (§8.5) — highest decision value per unit of build effort after the composite view.
4. Pillar dashboards, then indicator dashboards.
5. Research/validation view.
6. Portfolio integration view (after the §6 item-8 conditioning study).

---

# Appendix A — Indicator quick-reference

| Code | Pillar | Source | Transformation | Sign | Audit separation |
|---|---|---|---|---|---|
| g_nfp | Growth | PAYEMS | 3m avg of MoM change → z | + | +2.550 |
| g_ipman | Growth | IPMAN | YoY % → z | + | +2.570 |
| g_gdp | Growth | GDPC1 | quarterly ffill, YoY % → z | + | +2.217 |
| g_serv | Growth | PCES / DSERRG3M086SBEA | real services PCE, YoY % → z | + | n/a (v2.1; eval separation +2.15) |
| i_pce_dev | Inflation | PCEPILFE | \|YoY − 2\| → z | − | n/a (new form) |
| i_pce_mom | Inflation | PCEPILFE | 6m Δ of YoY → z | − | n/a (new form) |
| l_nfci | Liquidity | NFCI | monthly avg → z | − | +2.940 |
| l_curve | Liquidity | T10Y2Y | month-end level → z | + | −0.518 (leading role) |
| c_ig_level | Credit | BAA10YM | level → z | − | +2.668 |
| c_ig_mom | Credit | BAA10YM | 6m Δ → z | − | n/a (new form) |
| s_vix | Stress | VIXCLS | monthly average → z (v2.1; month-end before) | − | +2.558 |
| s_bond | Stress | STLFSI2/DGS10 splice | level → z | − | +3.331 |
| s_spy_dd | Stress | SPY (Yahoo) | drawdown from running peak → z | + | n/a (new form) |

Audit separation = expansion-mean minus crisis-mean of the v1.0 percentile score of the same underlying series (where one existed); reported for continuity of evidence.

# Appendix B — File inventory

As of the 2026-06-14 cleanup pass (Task 1, `PROJECT_STATUS.md` §10),
`Research/MRS/` holds only the current (v2.1) reference set. v1.0 is fully
retired to `Legacy/MRS_v1/` (see `CUTOVER_LOG.md` there); v2.0 redesign-process
artifacts live under `Research/MRS/_archive/`. Neither location is used by any
live pipeline.

| File | Role |
|---|---|
| `Research/MRS/MRS_Methodology_and_Monitoring_Framework.md` | **this document — official reference** |
| `Research/MRS/MRS_Research_Paper.md` | final research paper |
| `Research/MRS/MRS_Overview_Deck.pptx`, `deck_assets/*.png` | final overview deck and its chart assets |
| `Research/MRS/mrs_validation_log.md` | input-panel data validation |
| `Src/mrs_monitoring_store.py` | Part VII implementation: builds the monitoring tables, flags, vintages, revision log, and the master workbook |
| `Research/MRS/monitoring/mrs_indicator_history.csv` | Table 1 (§7.1) |
| `Research/MRS/monitoring/mrs_pillar_history.csv` | Table 2 (§7.2) |
| `Research/MRS/monitoring/mrs_composite_history.csv` | Table 3 (§7.3) |
| `Research/MRS/monitoring/mrs_active_flags.csv` | current-month §7.4 flag summary |
| `Research/MRS/vintages/YYYY-MM/`, `vintages/revision_log.csv` | monthly snapshots; confirmed-regime revision log (§7.5) |
| `Research/MRS/MRS_Master.xlsx` | consolidated workbook (Composite, Pillars_Wide/Long, Indicators_Wide/Long, Regime_Periods, Active_Flags, Metadata) — single source for paper/PPT/dashboard; rebuilt each run of `mrs_monitoring_store.py` |
| `Research/MRS/MRS_Dashboard_Implementation_Plan.md` | Part VIII implementation plan + build log: site structure, data export, refresh workflow, GitHub Pages hosting (open decision) |
| `Src/export_dashboard_data.py` | converts `MRS_Master.xlsx` sheets to `Research/MRS/dashboard/data/*.json` — final pipeline step |
| `Research/MRS/dashboard/` | the built dashboard (Phases 1-4: composite view, 5 pillar + 13 indicator drilldowns, trend/flags view, about page) — open as `index.html` via a local static server; GitHub Pages hosting not yet enabled (see implementation plan §9) |
| `Data/Processed/mrs_inputs_monthly.csv` | input panel (317 × 54, 2000-01–2026-05) |
| `Research/MRS/_archive/redesign_process/MRS_Redesign_Recommendation.md` | redesign decision record (2026-06-10) |
| `Research/MRS/_archive/redesign_process/MRS_Methodology_Audit.md`, `MRS_Component_Audit.md` | v1.0 diagnosis (2026-06-09) |
| `Research/MRS/_archive/v2_backtest/mrs_proposed_scores.csv` | v2.0 full panel: indicator z's, pillars, contributions, composite, raw + confirmed regimes |
| `Research/MRS/_archive/v2_backtest/mrs_proposed_event_table.csv`, `mrs_proposed_vs_current.csv` | v1-vs-v2.0 backtest artifacts |
| `Legacy/MRS_v1/build_mrs_scores.py` | retired v1.0 scoring pipeline (Task 1, 2026-06-14 — see `Legacy/MRS_v1/CUTOVER_LOG.md`) |
| `Legacy/MRS_v1/mrs_final_scores.csv`, `mrs_indicator_scores.csv`, `mrs_historical_series.csv`, `mrs_component_*.csv`, `mrs_regime_analysis.csv`, `mrs_event_analysis.csv`, `mrs_time_period_analysis.csv`, `mrs_research_summary.md`, `MRS_Master_v1.xlsx` | **retired v1.0 outputs — comparison only** (the `v1` panel in `build_mrs_deck.py`'s "why a redesign was necessary" chart reads `mrs_final_scores.csv` from here) |

# Appendix C — Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-06-04 | Original percentile framework (5 components, 13–15 indicators, NBER cap) |
| 1.0-audit | 2026-06-09 | Methodology + component audits; framework declared not fit for purpose |
| 2.0 | 2026-06-10 | Full redesign: expanding z-scores, 12 indicators / 5 pillars, calibrated thresholds, 2-month confirmation, NBER cap dropped; backtested; this document |
| 2.0.1 | 2026-06-11 | Part VII monitoring store implemented (`Src/mrs_monitoring_store.py`); §7.5 drift gauge corrected to expanding std (10Y rolling retained as context). No methodology change |
| 2.1 | 2026-06-11 | External-review response: `g_serv` (real services PCE) added to Growth; `s_vix` moved to monthly-average sampling; thresholds unchanged. Monitoring: `curve_env` bull/bear-steepening classifier + flag; drift rule made mandatory with [0.45, 0.65] band on expanding std. Evidence in §5.9 |
