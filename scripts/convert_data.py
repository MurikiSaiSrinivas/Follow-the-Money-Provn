"""
Convert Vendor-Payments_2021-23.xlsx -> compact dictionary-encoded JSON.

Why: the xlsx is 49MB and slow to parse on every server boot. We convert once to a
columnar, integer-indexed JSON so the Node server loads it in ~1s and holds ~936K rows
in memory cheaply.

Output: data/dataset.json
  {
    meta: { generatedRows, fiscalYears, ... },
    dims: { vendors:[...], agencies:[...], categories:[...], subcategories:[...] },
    objectToCategory: { "N": "Grants, Benefits & Client Services", ... },
    # rows are arrays: [fyIdx, fmonth, agencyIdx, objIdx, subcatIdx, vendorIdx, amount]
    rows: [[...], ...]
  }
Strings are trimmed (fixed-width padding removed). Constant `Bien` column is dropped.
"""
import json, sys, os
import openpyxl

SRC = "Vendor-Payments_2021-23.xlsx"
OUT = os.path.join("data", "dataset.json")
COLS = ['Bien','FY','FMonth','Agy','Agency','Object','Category','Subobj','SubCategory','Vendor','Amount']

def main():
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)

    fiscal_years = []                      # e.g. ["2022","2023"] -> index
    vendors, v_idx = [], {}
    agencies, a_idx = [], {}
    objects, o_idx = [], {}                # 1-char object code
    subcats, s_idx = [], {}                # SubCategory name
    obj_to_cat = {}                        # object code -> Category name
    rows = []

    def intern(name, arr, idx):
        i = idx.get(name)
        if i is None:
            i = len(arr); arr.append(name); idx[name] = i
        return i

    for ws in wb.worksheets:
        for r in ws.iter_rows(min_row=2, values_only=True):
            d = dict(zip(COLS, r))
            fy = d['FY'].strip()
            if fy not in fiscal_years:
                fiscal_years.append(fy)
            fy_i = fiscal_years.index(fy)
            obj = d['Object'].strip()
            obj_to_cat.setdefault(obj, d['Category'].strip())
            rows.append([
                fy_i,
                int(d['FMonth']),                                   # fiscal month (1..24)
                intern(d['Agency'].strip(), agencies, a_idx),
                intern(obj, objects, o_idx),
                intern(d['SubCategory'].strip(), subcats, s_idx),
                intern(d['Vendor'].strip(), vendors, v_idx),
                round(float(d['Amount']), 2),
            ])

    os.makedirs("data", exist_ok=True)
    out = {
        "meta": {
            "source": SRC,
            "rowCount": len(rows),
            "fiscalYears": fiscal_years,
            "rowSchema": ["fyIdx","fmonth","agencyIdx","objIdx","subcatIdx","vendorIdx","amount"],
            "vendorCount": len(vendors),
            "agencyCount": len(agencies),
        },
        "objectToCategory": obj_to_cat,
        "dims": {
            "vendors": vendors,
            "agencies": agencies,
            "objects": objects,
            "subcategories": subcats,
        },
        "rows": rows,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    size = os.path.getsize(OUT) / 1e6
    print(f"Wrote {OUT}: {len(rows):,} rows, {len(vendors):,} vendors, "
          f"{len(agencies)} agencies, {len(objects)} objects, {len(subcats)} subcats. "
          f"Size {size:.1f} MB")

if __name__ == "__main__":
    main()
