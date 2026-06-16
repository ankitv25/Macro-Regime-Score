// Static reference data (methodology constants - weights, descriptions,
// data lineage) that does not change month to month and therefore does not
// belong in the JSON data export. Source: methodology doc §4.2 and Appendix A.

export const PILLARS = {
  growth: {
    label: "Growth",
    weight: 0.30,
    color: "#1f77b4",
    description: "Labor market, industrial production, GDP, and services activity.",
  },
  inflation: {
    label: "Inflation",
    weight: 0.15,
    color: "#ff7f0e",
    description: "Core PCE deviation from the 2% target and its 6-month momentum.",
  },
  liquidity: {
    label: "Liquidity / Rates",
    weight: 0.15,
    color: "#2ca02c",
    description: "Financial conditions (NFCI) and the 10Y-2Y yield curve.",
  },
  credit: {
    label: "Credit",
    weight: 0.20,
    color: "#9467bd",
    description: "Investment-grade credit spread level and 6-month momentum.",
  },
  stress: {
    label: "Market Stress",
    weight: 0.20,
    color: "#d62728",
    description: "Equity volatility (VIX), financial stress index, and SPY drawdown.",
  },
};

export const INDICATORS = {
  g_nfp: {
    label: "Nonfarm Payrolls (3m avg MoM)",
    pillar: "growth",
    source: "PAYEMS (FRED)",
    transform: "3-month average of month-over-month change → z-score",
    sign: "+",
  },
  g_ipman: {
    label: "Industrial Production (YoY)",
    pillar: "growth",
    source: "IPMAN (FRED)",
    transform: "Year-over-year % change → z-score",
    sign: "+",
  },
  g_gdp: {
    label: "Real GDP (YoY)",
    pillar: "growth",
    source: "GDPC1 (FRED)",
    transform: "Quarterly, forward-filled monthly; YoY % change → z-score",
    sign: "+",
  },
  g_serv: {
    label: "Real Services Spending (YoY)",
    pillar: "growth",
    source: "PCES / DSERRG3M086SBEA (FRED)",
    transform: "Real services PCE, YoY % change → z-score",
    sign: "+",
  },
  i_pce_dev: {
    label: "Core PCE Deviation from Target",
    pillar: "inflation",
    source: "PCEPILFE (FRED)",
    transform: "|YoY% − 2%| → z-score",
    sign: "−",
  },
  i_pce_mom: {
    label: "Core PCE Momentum (decel. = green)",
    pillar: "inflation",
    source: "PCEPILFE (FRED)",
    transform: "6-month change in YoY% → z-score",
    sign: "−",
  },
  l_nfci: {
    label: "Financial Conditions Index",
    pillar: "liquidity",
    source: "NFCI (FRED)",
    transform: "Monthly average → z-score",
    sign: "−",
  },
  l_curve: {
    label: "Yield Curve (10Y-2Y)",
    pillar: "liquidity",
    source: "T10Y2Y (FRED)",
    transform: "Month-end level → z-score",
    sign: "+",
  },
  c_ig_level: {
    label: "Credit Spread Level",
    pillar: "credit",
    source: "BAA10YM (FRED)",
    transform: "Level → z-score",
    sign: "−",
  },
  c_ig_mom: {
    label: "Credit Spread Momentum",
    pillar: "credit",
    source: "BAA10YM (FRED)",
    transform: "6-month change → z-score",
    sign: "−",
  },
  s_vix: {
    label: "VIX (monthly average)",
    pillar: "stress",
    source: "VIXCLS (FRED)",
    transform: "Monthly average → z-score",
    sign: "−",
  },
  s_bond: {
    label: "Financial Stress Index",
    pillar: "stress",
    source: "STLFSI2 / DGS10 splice (FRED)",
    transform: "Level → z-score",
    sign: "−",
  },
  s_spy_dd: {
    label: "Equity Drawdown (SPY)",
    pillar: "stress",
    source: "SPY (Yahoo Finance)",
    transform: "Drawdown from running peak → z-score",
    sign: "+",
  },
};
