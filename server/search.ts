// Typeahead search for the Money Map focus picker. Returns vendors/agencies matching a query,
// ranked by total dollars (biggest first — what a journalist wants). A totals index is built
// once per dataset and cached.

import { COL, type Dataset } from "../shared/types";

const REIMBURSEMENT = new Set(["S", "T"]);

interface TotalsIndex {
  vendorTotals: Map<string, number>;
  agencyTotals: Map<string, number>;
}
let cache: TotalsIndex | null = null;

function index(ds: Dataset): TotalsIndex {
  if (cache) return cache;
  const vendorTotals = new Map<string, number>();
  const agencyTotals = new Map<string, number>();
  for (const r of ds.rows) {
    if (REIMBURSEMENT.has(ds.dims.objects[r[COL.OBJECT]])) continue;
    const v = ds.dims.vendors[r[COL.VENDOR]];
    const a = ds.dims.agencies[r[COL.AGENCY]];
    vendorTotals.set(v, (vendorTotals.get(v) ?? 0) + r[COL.AMOUNT]);
    agencyTotals.set(a, (agencyTotals.get(a) ?? 0) + r[COL.AMOUNT]);
  }
  cache = { vendorTotals, agencyTotals };
  return cache;
}

export interface SearchHit {
  name: string;
  type: "vendor" | "agency";
  total: number;
}

export function search(ds: Dataset, q: string, type: "vendor" | "agency" | "all", limit = 15): SearchHit[] {
  const idx = index(ds);
  const needle = q.trim().toLowerCase();
  if (!needle) {
    // No query: return the biggest agencies (handy default for the picker).
    if (type === "vendor") return rank(idx.vendorTotals, () => true, "vendor", limit);
    return rank(idx.agencyTotals, () => true, "agency", limit);
  }
  const match = (name: string) => name.toLowerCase().includes(needle);
  const hits: SearchHit[] = [];
  if (type === "agency" || type === "all") hits.push(...rank(idx.agencyTotals, match, "agency", limit));
  if (type === "vendor" || type === "all") hits.push(...rank(idx.vendorTotals, match, "vendor", limit));
  // Prefix matches first, then by total desc.
  return hits
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
      return ap - bp || b.total - a.total;
    })
    .slice(0, limit);
}

function rank(
  totals: Map<string, number>,
  pred: (name: string) => boolean,
  type: "vendor" | "agency",
  limit: number,
): SearchHit[] {
  const out: SearchHit[] = [];
  for (const [name, total] of totals) if (pred(name)) out.push({ name, type, total });
  return out.sort((a, b) => b.total - a.total).slice(0, limit);
}
