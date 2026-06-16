# The Macro Regime Score: A Transparent Composite Indicator of the US Macro-Financial Environment

**Working paper — Summer Investment Platform Research**
**Version 2.1 · June 2026**

---

## Abstract

We develop the Macro Regime Score (MRS), a monthly composite indicator that classifies the US macro-financial environment into four regimes — Expansion, Neutral, Slowdown, and Contraction — from thirteen indicators organized into five economic pillars: Growth, Inflation, Liquidity/Rates, Credit, and Market Stress. The methodology follows documented institutional practice: indicators are normalized with expanding-window z-scores (the convention of the OFR Financial Stress Index and the Chicago Fed NFCI), aggregated with fixed, economically motivated weights, and classified against calibrated thresholds with a two-month persistence rule. Every design choice favors transparency and economic interpretability over statistical optimization, a preference supported both by the out-of-sample superiority of simple weighting schemes (DeMiguel, Garlappi and Uppal, 2009) and by our own robustness results: an equal-weighted variant of the composite correlates 0.989 with the production version.

Backtested over June 2003–April 2026 (275 months), the MRS places the Global Financial Crisis (minimum −2.15 composite z) and the COVID crash (−1.65) — and only those two episodes — in Contraction; classifies the 2022 inflation bear market as Slowdown; correctly leaves the 2011 euro-area sovereign crisis and the 2015–16 EM shock, neither of which produced a US recession, in Neutral; and signals deteriorating conditions from March 2008, nine months before the NBER's recession announcement. Because pillar contributions are exactly additive, every reading decomposes into an economically coherent narrative, and distinct crisis *types* — growth-and-credit collapses versus inflationary tightening episodes — produce distinct pillar signatures. The framework replaces a percentile-scored predecessor whose worst regime was mathematically unreachable; we document that failure and its diagnosis as motivating evidence. We close with the framework's limitations, its monitoring architecture, and its intended role in regime-conditional portfolio construction.

---

## 1. Introduction

### 1.1 Motivation

Asset allocation decisions are conditional decisions: the correlation structure, factor behavior, and forward return distributions of major asset classes differ materially across macroeconomic environments. Companion studies on this research platform document, for example, that the negative equity–dollar correlation widely treated as structural is in fact a post-2000 regime phenomenon. Conditioning allocation on the macro environment therefore requires a *regime variable*: a consistent, point-in-time-honest classification of the environment that can be maintained monthly, explained to an investment committee, and audited years later.

This paper develops such a variable. The design brief imposed three requirements that jointly distinguish the MRS from both academic regime-switching models and proprietary sell-side indicators:

1. **Transparency.** Every indicator must carry a one-sentence economic justification; weights must be fixed and stated; the entire computation must be reproducible from public data (FRED, with one Yahoo Finance series).
2. **Point-in-time honesty.** The score at month *t* may use only information available at month *t*: normalization statistics expand through time, and no ex-post information — notably NBER recession dating, announced with six to twelve months' delay — enters the score.
3. **Tail preservation.** A regime indicator exists for the tails. Any transformation that compresses extreme observations defeats the purpose of the exercise.

### 1.2 An economic regime indicator, not only a stress detector

A central design decision concerns what the composite is *for*. Financial-stress indices (OFR FSI, Kansas City Fed FSI, St. Louis Fed FSI) are engineered to detect market stress, and the variables that do that best — credit spreads, volatility, funding conditions — are inherently close to market pricing and therefore reactive: they confirm drawdowns that are already visible in prices.

The MRS is intended to be an **economic regime indicator, not only a stress detector**. This is why the Growth pillar receives the largest weight (30%) even though credit and market-stress variables exhibit the strongest historical crisis discrimination in our component audit. The Growth pillar anchors the framework in the real economy and preserves upside participation: avoiding contractions is important, but a regime model that systematically underweights improving growth risks remaining too defensive during recoveries and expansions. The 30% Growth weight reflects the framework's forward-looking investment objective — to classify the economic environment early enough to support allocation decisions — rather than simply mirroring the variables with the strongest historical crisis discrimination. The empirical cost of this choice is low (Section 6 shows the composite is nearly invariant to plausible re-weightings); the conceptual benefit is a composite whose primary axis is the state of the economy, with market-stress variables acting as fast confirmation rather than as the signal itself.

### 1.3 Contribution and findings

The paper makes three contributions. First, it provides a **documented negative result**: a forensic diagnosis of a percentile-scored predecessor framework (v1.0) whose lowest regime was mathematically unreachable — in 280 months spanning the GFC and COVID, the composite never came within 0.1 points of its "Contraction" threshold, and 67% of all history landed in a single regime. The mechanism (percentile ranking maps every input to a uniform distribution; the central limit theorem then collapses their weighted average toward its center) is general and applies to any composite built on rank transforms. Second, it specifies a replacement methodology assembled entirely from documented institutional practice, with an explicit audit trail from each design choice to its evidence. Third, it validates the framework across eight labeled macro episodes and documents its behavior, robustness, and limitations with the candor required for production use — including the trade-offs accepted in the v2.1 revision.

The remainder of the paper proceeds as follows. Section 2 reviews institutional practice. Section 3 describes the data. Section 4 specifies the methodology, including the economic rationale for every pillar. Section 5 presents the empirical results. Section 6 reports robustness. Section 7 states limitations. Section 8 sketches the monitoring architecture and portfolio integration path. Section 9 concludes.

---

## 2. Institutional Practice and Related Work

### 2.1 Normalization in institutional composites

No major institutional stress or conditions index uses percentile scoring. The reference constructions are:

| Index | Variables | Normalization | Aggregation |
|---|---|---|---|
| OFR Financial Stress Index | 33 | z-scores using data "up until that date" | dynamic factor ≈ first PC |
| Chicago Fed NFCI | 105 | standardized, mean 0 / std 1 since 1971 | factor model |
| Kansas City Fed FSI | 11 | standardized | first principal component |
| St. Louis Fed FSI | 18 | standardized | principal components |
| State Street MRI | vol + spreads | mapped to 0–100% | five fixed regime bands |
| Conference Board LEI | 10 | standardized components | simple average; 3Ds interpretation rule |

The expanding-window z-score — standardizing each observation against all history up to and including its own date — is the institutional standard because it preserves tail magnitude (a 5σ event scores 5σ), is point-in-time honest, and yields interpretable units. We adopt it directly.

### 2.2 Quadrant frameworks: level and momentum

Practitioner regime frameworks descended from Bridgewater's growth/inflation quadrant (Goldilocks, Reflation, Stagflation, Deflation — operationalized by FTSE Russell, Invesco, and Fidenza Macro, among others) condition on the **direction of change** in growth and inflation, not only the level: markets price surprises and turning points, and a 3% inflation print means different things arriving from 2% than from 5%. This motivates the momentum terms in our Inflation and Credit pillars.

### 2.3 Weighting

DeMiguel, Garlappi and Uppal (2009) show that 1/N equal weighting beats fourteen mean-variance-optimized alternatives out of sample because equal weights carry no estimation risk; ReSolve Asset Management reach the same conclusion in an allocation context. The Conference Board LEI has used simple averaging of standardized components for decades. We therefore weight equally *within* pillars and apply fixed, judgment-based weights *across* pillars (Section 4.4), verifying in Section 6 that the choice is not load-bearing. The statistically optimal alternative — PCA weighting, as in the Goldman Sachs CAI — was considered and rejected: PCA loadings are unstable, re-estimated each period, and uninterpretable to the decision-makers the indicator is meant to serve.

---

## 3. Data

### 3.1 Sources and panel

All inputs derive from FRED except SPY total returns (Yahoo Finance). The processed panel spans **January 2000–May 2026 (317 months, 57 columns)**; the scored composite begins **June 2003** after normalization warm-up. Indicator-level sources:

| Series | Source | Transformation |
|---|---|---|
| Nonfarm payrolls | PAYEMS | MoM change, 3-month average |
| Manufacturing IP | IPMAN | YoY % |
| Real GDP | GDPC1 (quarterly) | forward-filled, YoY % |
| Real services consumption | PCES ÷ DSERRG3M086SBEA | YoY % (v2.1) |
| Core PCE inflation | PCEPILFE | YoY %; level deviation from 2% and 6-month change |
| Financial conditions | NFCI (weekly) | monthly average |
| Yield curve | T10Y2Y (daily) | month-end level |
| IG credit spread | BAA10YM | level and 6-month change |
| Equity volatility | VIXCLS (daily) | monthly average (v2.1) |
| Bond-market stress | STLFSI2 (2000–22) ⊕ DGS10 30-day realized vol (2022–) | z-spliced |
| Equity drawdown | SPY returns | drawdown from running peak |
| NBER recession dummy | USREC | **validation only — never enters the score** |

### 3.2 Proxy choices and their costs

Three Bloomberg-only series are proxied: ISM Manufacturing PMI by manufacturing IP (hard data for a survey; slightly less timely), the MOVE index by an STLFSI2/rate-volatility splice, and ICE high-yield OAS by — nothing: the predecessor framework's HY "proxy" (IG × 1.8) was an exact duplicate of its IG input (r = 1.0000 for 253 of 294 months) and is excluded entirely. The IG spread proxy, Moody's BAA minus 10-year Treasury, embeds a duration and quality component that a true OAS would not. The dot-com recession (2001) falls inside the normalization warm-up and is unscorable — a hard data limitation shared with the predecessor.

---

## 4. Methodology

### 4.1 Normalization

Each indicator series *x* is transformed to an expanding-window z-score:

> z_t = ( x_t − mean(x₁…x_t) ) / std(x₁…x_t),  with a minimum of 24 months of history, clipped to ±3.

The clip bounds the influence of any single indicator in unprecedented events while preserving ordering. Each z-score is signed so that **higher = more favorable**: series for which high raw values are adverse (spreads, VIX, NFCI, inflation deviation) enter negatively.

The contrast with the predecessor's percentile ranks is the crux of the redesign. A percentile transform maps every marginal distribution to the uniform; a weighted average of approximately uniform variables is, by the central limit theorem, approximately normal with sharply compressed tails. In the v1.0 framework this produced a composite whose theoretical 1–5 range was never more than 57% utilized and whose "Contraction" threshold sat 2.7 standard deviations below the mean — roughly a once-in-33-years event by construction, *regardless of what the economy did*. Z-scores do not have this property: the GFC reads −2.2σ because it was a −2.2σ event.

### 4.2 Pillar structure

Thirteen indicators in five pillars, equal-weighted within each pillar. A pillar emits a score only when all member indicators are live; the composite only when all five pillars are live.

**Growth (30%)** — z(NFP 3m avg), z(manufacturing IP YoY), z(real GDP YoY), z(real services consumption YoY). Four deliberately distinct dimensions of real activity: labor (broad, slightly lagging, demonstrably independent — payrolls diverged correctly from industrial signals in 2015–16 and 2022), industry (the audit's best growth-collapse detector), output (the authoritative aggregate and the framework's most unique variable at 68.5% unique information, at the cost of one to two quarters' lag), and services (~70% of GDP, added in v2.1; see Section 6.3). Total industrial production was excluded as a near-duplicate of manufacturing IP (r = 0.915); services *employment* was evaluated for the v2.1 addition and rejected (r = 0.983 with the payrolls indicator — payrolls already are mostly services).

**Inflation (15%)** — −z(|core PCE YoY − 2|), −z(Δ6m core PCE YoY). The level term penalizes deviation from the Federal Reserve's target *symmetrically* — overheating and deflation are both regime-adverse. The momentum term encodes the quadrant-framework insight: accelerating inflation is regime-negative regardless of level. Normalizing the deviation, rather than scoring it on fixed bands as the predecessor did, lets the score reflect how historically unusual a deviation is — the fixed-band design had pinned the predecessor's inflation component above 4.0 (on 1–5) in 80.7% of all months, rendering it a permanent upward bias except in 2021–22. Inflation is an overlay, not a crisis sensor — its crisis-versus-expansion separation is approximately zero because financial crises are not inflation events — and its 15% weight reflects that role.

**Liquidity/Rates (15%)** — −z(NFCI), z(10Y–2Y spread). The NFCI is itself a 105-variable institutional composite — the broadest available *outcome* measure of financial conditions and the second-best crisis discriminator in the component audit. The yield curve is the canonical forward-looking rates signal and the framework's principal *leading* indicator. The defining change from the predecessor: the real federal funds rate and the funds-rate direction are **removed**. Both scored the *policy reaction* rather than *conditions* — during the GFC, aggressive rate cuts pushed both near their score maxima, and the predecessor's rates component peaked in October 2008, the month after Lehman Brothers failed. The curve's known crisis-time limitation (it bull-steepens when the front end is cut) is accepted and managed at the monitoring layer, which classifies every material curve move as bull steepening, bear steepening, or flattening and raises a warning flag in the first case (the flag fires in September–November 2008 and in only 16 of 275 months overall).

**Credit (20%)** — −z(IG spread level), −z(Δ6m IG spread). Credit spreads are the market's real-time price of default risk. Level locates the regime; momentum is a genuine second signal — spread *widening* is the classic pre-recession dynamic and leads the level. Credit is also the framework's principal crisis-*type* discriminator: in 2022 spreads stayed benign while inflation and rates deteriorated, correctly distinguishing an inflationary bear market from a financial crisis.

**Market Stress (20%)** — −z(VIX monthly average), −z(bond-stress splice), z(SPY drawdown from peak). Three channels: equity volatility (the fast signal), bond-market stress (the single best crisis discriminator in the audit — the GFC was a funding-market crisis first), and realized equity damage. The drawdown formulation replaces the predecessor's trailing 3-month return because a drawdown *persists* through a bear market while a trailing return mean-reverts mid-crisis. The VIX enters as a monthly average as of v2.1: month-end sampling demonstrably mis-scored fast intra-month stress events (Section 6.3).

### 4.3 Composite

> MRS_t = 0.30·Growth + 0.15·Inflation + 0.15·Liquidity + 0.20·Credit + 0.20·Stress

Pillar contributions (weight × pillar score) are exactly additive, which makes every monthly reading decomposable — the property underlying both the interpretability results in Section 5.3 and the monitoring dashboards.

**Weighting rationale.** Within pillars, 1/N (Section 2.3). Across pillars, fixed judgment weights with one deliberate asymmetry: Growth receives the largest weight (30%) for the forward-looking investment reasons set out in Section 1.2, with Credit and Stress (20% each) as the fast crisis-confirmation channels and Inflation and Liquidity (15% each) as overlays. The weights are not estimated from data, and Section 6 shows the composite is nearly invariant to replacing them with equal weights — the structure, not the weighting, carries the framework.

### 4.4 Regime classification

Averaging thirteen correlated z-scores compresses dispersion: the composite's realized standard deviation is 0.55, not 1.0. Rather than re-standardize the composite (a second normalization layer and another 24 months of warm-up), thresholds are calibrated once to the composite's empirical scale and fixed:

| Regime | Composite range | Realized frequency (2003-06–2026-04, confirmed) |
|---|---|---|
| Expansion | ≥ +0.35 | 24.4% |
| Neutral | −0.30 to +0.35 | 61.8% |
| Slowdown | −1.00 to −0.30 | 8.4% |
| Contraction | < −1.00 | 5.5% |

A **two-month persistence rule** (a switch is recognized only after two consecutive months in the new raw regime — a Conference Board-style duration filter) reduces transitions from 44 raw to 20 confirmed at the cost of bounded entry lag. Both raw and confirmed regimes are retained: the raw series and a distance-to-threshold watch flag carry the early-warning function, the confirmed series carries the classification function.

A guard rail governs threshold validity through time: if the composite's expanding standard deviation (0.547 at v2.1) exits the band [0.45, 0.65], a threshold review is mandatory and non-discretionary; inside the band, thresholds may not be touched. This converts the main fragility of fixed thresholds — silent scale drift — into a governed, versioned event.

The predecessor's NBER recession cap (its growth component was capped during NBER-dated recession months) is **dropped**: it injected ex-post information into a nominally point-in-time score, and the backtest shows it is unnecessary — the composite reaches Contraction under its own power in both sample recessions.

---

## 5. Empirical Results

### 5.1 Distribution and discrimination

Over 275 scored months the composite has mean +0.09, standard deviation 0.55, maximum +0.99, and minimum **−2.15 (December 2008)** — 4.1 standard deviations below the mean. The predecessor's minimum sat 2.5 of its standard deviations below its mean, within 0.12 points of its mathematical floor. Tails now exist because nothing in the construction removes them.

### 5.2 Event study

Eight labeled episodes, spanning two genuine US macro contractions, three external/financial shocks that did *not* produce US recessions, one inflationary bear market, and three expansion phases:

| Episode | Window | Mean / min (z) | Modal regime | Assessment |
|---|---|---|---|---|
| GFC | 2008-09–2009-06 | −1.71 / **−2.15** | **Contraction** (10/10 months) | correct, full severity |
| COVID crash | 2020-02–2020-05 | −1.14 / **−1.65** | **Contraction** | correct |
| 2022 inflation bear | 2022-01–2022-12 | −0.39 / −0.59 | **Slowdown** | correct type and depth |
| Euro sovereign crisis | 2011-08–2011-12 | −0.17 / −0.37 | Neutral | correct — no US recession |
| China/EM 2015–16 | 2015-08–2016-02 | −0.17 / −0.26 | Neutral | correct — no US recession |
| 2003–04 expansion | 2003-06–2004-06 | +0.80 / +0.51 | **Expansion** (12/12 confirmed) | correct |
| 2017 expansion | 2017-01–2017-12 | +0.37 / +0.28 | Neutral (8) / Expansion (4) | borderline, defensible |
| 2021 reopening | 2021-03–2021-12 | +0.28 / +0.07 | Neutral | correct — see §5.3 |

The two genuine US contractions — and only those — reach Contraction. The predecessor assigned the GFC, COVID, the 2022 shock, and the 2023 banking stress the *same* label, and scored the euro crisis as "Moderate/Stable" while scoring the milder (for the US) 2015 EM shock *worse* — ordering failures the new framework does not reproduce.

### 5.3 Pillar signatures: crisis typology

Because contributions are additive, each episode decomposes exactly (mean contribution to the composite, z-units):

| Episode | Growth | Inflation | Liquidity | Credit | Stress | Reading |
|---|---|---|---|---|---|---|
| GFC | **−0.78** | −0.02 | −0.12 | **−0.40** | **−0.40** | growth collapse + systemic credit/funding stress |
| COVID | **−0.64** | −0.02 | −0.11 | −0.19 | −0.19 | growth shock; markets stabilized fast under the Fed backstop |
| 2021 reopening | +0.39 | **−0.40** | +0.03 | +0.14 | +0.12 | hot growth fully offset by hotter inflation — reflation, not Goldilocks |
| 2022 bear | +0.10 | **−0.28** | −0.12 | +0.04 | −0.13 | inflationary tightening: credit calm, inflation/rates/vol adverse |

The 2021 row illustrates the quadrant logic operating inside a single composite: a naive growth tracker would have read 2021 as a strong Expansion; the MRS reads it as Neutral because the inflation pillar correctly recognized overheating. The GFC-versus-2022 contrast shows the credit pillar discriminating crisis types: wide and widening in 2008–09, benign through 2022.

### 5.4 Lead–lag behavior and NBER alignment

The raw composite breached the Slowdown boundary in late 2007, stood near −1 by January 2008, and first printed raw Contraction in **March 2008** — six months before Lehman and nine months before the NBER's announcement of the recession's start. The monitoring layer's distance-to-threshold watch flags the approaching downgrade from **February 2008**. Of 20 NBER recession months in sample, the confirmed regime is Contraction in 11 and Slowdown in 8; of 15 confirmed Contraction months, 11 fall inside NBER recessions and the remaining 4 are May–August 2020, immediately after the official April 2020 trough, when conditions were still plainly contractionary.

### 5.5 Stability

Twenty confirmed transitions in 23 years (13.1-month average regime duration) against the predecessor's 30 transitions (9.0 months) — the sharper discrimination costs nothing in stability; it improves it. Mean month-over-month composite change is 0.118 z.

---

## 6. Robustness

### 6.1 Weights

Replacing the production weights with equal pillar weights (20% each) yields a composite correlated **0.989** with production and 91.6% regime agreement. The weighting is an economic statement (Section 1.2), not a fitted parameter — and the data confirm it is not load-bearing.

### 6.2 Thresholds and the persistence rule

The Slowdown and Contraction boundaries are insensitive to perturbation — crisis months sit far below them. The Expansion/Neutral boundary is the sensitive one (±0.05 moves Expansion frequency by roughly 5pp) because it cuts through the dense center of the distribution; this is disclosed, and the boundary is governed by the drift rule rather than re-tuned. The persistence rule changes timing, not classification: raw and confirmed regime frequencies agree within a percentage point per regime.

### 6.3 The v2.1 revision as an out-of-design test

Version 2.1 (June 2026) made two changes in response to external review — adding the services indicator and re-sampling the VIX from month-end to monthly average — *without touching thresholds*. Both changes are individually well-evidenced: services consumption is the economy's largest previously-unrepresented block, and month-end VIX sampling had scored the February 2018 Volmageddon at z = 0.00, the March 2023 SVB stress at −0.20, and the August 2024 volatility unwind at −0.62 — *calmer than normal* in all three cases, signs all corrected by the monthly average. The composite that results correlates 0.99 with v2.0, all eight event classifications are unchanged, and stability improves (20 confirmed transitions versus 28).

One trade-off is reported plainly: the *confirmed* GFC Contraction entry moves from April to September 2008, because services consumption genuinely held up through spring 2008 and the raw regime oscillated without two consecutive Contraction months until September. The raw signal still fires in March 2008 and the watch flag in February 2008; confirmed entry remained three months ahead of the NBER announcement. We regard a framework whose revisions produce small, explainable, economically sensible deltas as evidence of structural soundness rather than fragility.

---

## 7. Limitations

1. **In-sample threshold calibration.** Thresholds were chosen on the same 2003–2026 window on which they are evaluated. They were set for frequency sanity rather than event-fitting, and the drift rule freezes them pending genuinely new data — but a true out-of-sample test requires the future.
2. **Two severe episodes.** The sample contains one business cycle's worth of contractions. Every claim about crisis behavior rests on n = 2; the dot-com recession is unscorable (normalization warm-up).
3. **Early-history softness.** Expanding z-scores rest on 24–60 months of history before roughly 2006; the ±3 clip mitigates but does not remove this.
4. **Residual month-end sampling.** The curve and credit spread are month-end/monthly snapshots; unlike the VIX they do not typically spike and fully reverse within a month, but the residual risk is nonzero.
5. **Constructed inputs.** The bond-stress splice and the monthly GDP interpolation predate this framework and were not re-audited; the splice's two segments are scaled with full-sample statistics (the engine's expanding z-score is invariant to each segment's affine transform, so the leak is confined to their relative scaling at the 2022 joint).
6. **Smooth services signal.** The v2.1 services indicator is consumption-based and slow to alarm; a fast services shock reaches the score first through labor and markets.
7. **No regime-conditional return evidence yet.** The framework classifies environments; the study linking regimes to forward asset-class behavior — the portfolio construction bridge — is specified but not yet executed.

---

## 8. Monitoring and Implementation

The production framework is fully specified in the companion document (*MRS Methodology and Monitoring Framework*, v2.1), which this paper summarizes. Implementation comprises a scoring engine (`mrs_proposed_framework.py`), an input pipeline from FRED, and a monitoring store (`mrs_monitoring_store.py`) that maintains three canonical history tables (indicator, pillar, composite) with momentum, trend, expanding-percentile, and streak fields; standardized deterioration/improvement warnings; a regime-change watch; breadth confirmation; the curve-environment classifier; monthly vintage snapshots; and a revision log. As of April 2026 the framework reads **Neutral (month 39, composite +0.03, 31st percentile)** with an active deterioration warning on the Inflation pillar — an overheating-tilted Neutral, not a credit-led one.

The intended portfolio integration is regime-conditional: forward return and correlation behavior of the platform's asset universe conditioned on the confirmed regime and on nearest-neighbor pillar signatures, with explicit small-sample caveats. That study is the framework's next milestone.

---

## 9. Conclusion

A regime indicator earns its keep twice: in the tails, where it must register severity at full magnitude and in time to matter; and in the long middle, where it must remain stable, interpretable, and honest about what it knows. The MRS achieves both with deliberately unfashionable ingredients — public data, z-scores, fixed weights, fixed thresholds, and a persistence rule — assembled on the template of the institutional indices that have survived decades of production use. The framework's distinguishing commitments are economic rather than statistical: a Growth anchor sized for upside participation rather than crisis fit, momentum terms that encode how practitioners actually read inflation and credit, and an exactly additive decomposition that makes every reading an explanation rather than a number.

---

## References

- Chicago Fed. *National Financial Conditions Index: background and FAQ.* chicagofed.org.
- Conference Board. *Calculating the Composite Indexes.* conference-board.org.
- DeMiguel, V., L. Garlappi and R. Uppal (2009). "Optimal versus Naive Diversification: How Inefficient is the 1/N Portfolio Strategy?" *Review of Financial Studies* 22(5).
- Fidenza Macro. *The Four-Quadrant Framework.* fidenzamacro.com.
- FTSE Russell / LSEG. *Balanced macro factor analysis.* lseg.com.
- Kansas City Fed. *Kansas City Financial Stress Index.* kansascityfed.org.
- Office of Financial Research. *OFR Financial Stress Index* (Working Paper 17-04). financialresearch.gov.
- ReSolve Asset Management. *Simple versus Optimal Methods.* investresolve.com.
- State Street Global Advisors. *Market Regime Indicator, Q2 2024.* ssga.com.
- Internal: *MRS Methodology Audit* (2026-06-09); *MRS Component Audit* (2026-06-09); *MRS Redesign Recommendation* (2026-06-10); *MRS Methodology and Monitoring Framework v2.1* (2026-06-11).

---

## Appendix A — Indicator definitions (v2.1)

| Code | Pillar | Source | Transformation | Sign |
|---|---|---|---|---|
| g_nfp | Growth | PAYEMS | 3m avg MoM change → z | + |
| g_ipman | Growth | IPMAN | YoY % → z | + |
| g_gdp | Growth | GDPC1 | quarterly ffill, YoY % → z | + |
| g_serv | Growth | PCES ÷ DSERRG3M086SBEA | real services PCE YoY % → z | + |
| i_pce_dev | Inflation | PCEPILFE | \|YoY − 2\| → z | − |
| i_pce_mom | Inflation | PCEPILFE | Δ6m of YoY → z | − |
| l_nfci | Liquidity | NFCI | monthly avg → z | − |
| l_curve | Liquidity | T10Y2Y | month-end → z | + |
| c_ig_level | Credit | BAA10YM | level → z | − |
| c_ig_mom | Credit | BAA10YM | Δ6m → z | − |
| s_vix | Stress | VIXCLS | monthly avg → z | − |
| s_bond | Stress | STLFSI2 ⊕ DGS10 vol | spliced level → z | − |
| s_spy_dd | Stress | SPY | drawdown from peak → z | + |

## Appendix B — The v1.0 negative result, in brief

The predecessor scored 13–15 indicators by expanding percentile rank mapped to 1–5, averaged into five components (30/20/20/15/15), with fixed thresholds at 4.0/3.0/2.0 and an NBER cap on growth. Audit findings: Contraction (< 2.0) unreachable (structural floor ≈ 2.03; GFC minimum 2.144); 67.1% of months in one regime; inflation component ≥ 4.0 in 80.7% of months; the rates component *peaked* in October 2008 because rate cuts scored as positive (its two policy-direction variables had crisis-versus-expansion separations of −1.96 and −1.26 — the two worst in the framework); the HY credit input was the IG input times 1.8 (r = 1.0000 pre-2023); and three further indicator pairs exceeded r = 0.91. Five variables carried essentially all crisis detection: bond stress (+3.33 separation), NFCI (+2.94), IG spread (+2.67), VIX (+2.56), and manufacturing IP (+2.57) — all retained, with corrected roles, in the present framework.
