"""
Export Research/MRS/MRS_Master.xlsx to the JSON files consumed by the MRS
dashboard (Research/MRS/dashboard/).

Pure format conversion - no calculations. Every number written here already
exists in MRS_Master.xlsx, which is rebuilt by mrs_monitoring_store.py from
the Part VII monitoring tables. Run this script after mrs_monitoring_store.py
as the final step of the monthly MRS update (see methodology doc §3.1/§7.6
and MRS_Dashboard_Implementation_Plan.md §8).

Output: Research/MRS/dashboard/data/*.json (8 files)

NOTE: data/commentary.json is NOT written here. It holds the hand-authored
monthly analyst notes shown in the dashboard's verdict panel; it is maintained
by hand and must not be overwritten by this export.
"""

import json
from pathlib import Path

import pandas as pd

MASTER = Path("outputs/MRS_Master.xlsx")
OUT_DIR = Path("dashboard/data")

SHEET_TO_FILE = {
    "Composite": "composite_history.json",
    "Pillars_Wide": "pillars_wide.json",
    "Pillars_Long": "pillars_long.json",
    "Indicators_Wide": "indicators_wide.json",
    "Indicators_Long": "indicators_long.json",
    "Regime_Periods": "regime_periods.json",
    "Active_Flags": "active_flags.json",
}

# Tables at or below this many rows are written pretty-printed for readability;
# larger tables are written compact to keep file size down.
PRETTY_ROW_LIMIT = 50


def records_json(df: pd.DataFrame) -> str:
    df = df.copy()
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            df[col] = df[col].dt.strftime("%Y-%m-%d")
    float_cols = df.select_dtypes(include="float").columns
    df[float_cols] = df[float_cols].round(6)
    indent = 2 if len(df) <= PRETTY_ROW_LIMIT else None
    return df.to_json(orient="records", indent=indent)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    xl = pd.ExcelFile(MASTER)

    for sheet, fname in SHEET_TO_FILE.items():
        df = xl.parse(sheet)
        (OUT_DIR / fname).write_text(records_json(df))
        print(f"{fname}: {len(df)} rows")

    meta_df = xl.parse("Metadata")
    meta = dict(zip(meta_df["field"], meta_df["value"].astype(str)))
    (OUT_DIR / "metadata.json").write_text(json.dumps(meta, indent=2))
    print(f"metadata.json: {len(meta)} fields")

    print(f"\nWrote {len(SHEET_TO_FILE) + 1} files to {OUT_DIR}/")


if __name__ == "__main__":
    main()
