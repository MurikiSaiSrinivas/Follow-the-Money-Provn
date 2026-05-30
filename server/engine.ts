// The query engine — the ONE place numbers are computed (never the AI; see SPEC.md §4).
// Pure functions over the in-memory Dataset. The AI and the manual controls both produce a
// Query; this turns a Query into a QueryResult.

import {
  COL,
  type Dataset,
  type GroupBy,
  type Query,
  type QueryResult,
  type ResultRow,
  type Row,
} from "../shared/types";

const REIMBURSEMENT_OBJECTS = new Set(["S", "T"]); // Inter/Intra-agency reimbursements

/** Resolve, per dataset, the category name for a given Object index (cached on the dataset). */
function categoryResolver(ds: Dataset): (objIdx: number) => string {
  const byIdx = ds.dims.objects.map((code) => ds.objectToCategory[code] ?? code);
  return (objIdx) => byIdx[objIdx];
}

/** Build the group-key extractor for a row, returning a human-readable label. */
function keyFn(ds: Dataset, groupBy: GroupBy, catOf: (i: number) => string): (r: Row) => string {
  switch (groupBy) {
    case "vendor":
      return (r) => ds.dims.vendors[r[COL.VENDOR]];
    case "agency":
      return (r) => ds.dims.agencies[r[COL.AGENCY]];
    case "category":
      return (r) => catOf(r[COL.OBJECT]);
    case "subcategory":
      return (r) => ds.dims.subcategories[r[COL.SUBCAT]];
    case "fiscalYear":
      return (r) => ds.meta.fiscalYears[r[COL.FY]];
    case "fiscalMonth":
      return (r) => String(r[COL.FMONTH]);
  }
}

// Connector / org-suffix words that carry no distinguishing signal for matching agency names.
const STOP = new Set(["the", "of", "for", "and", "dept", "department"]);
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}

/**
 * Resolve an AI-provided value (e.g. "Dept of Fish & Wildlife") to the actual canonical name in
 * the data ("Fish and Wildlife"), so an exact-string mismatch doesn't silently return 0 rows.
 * Token-based: matches when one name's significant tokens fully cover the other's. Picks the
 * candidate with the most overlapping tokens; returns undefined if nothing covers cleanly.
 */
function resolveValue(candidates: string[], query: string): string | undefined {
  const qt = tokenize(query);
  if (!qt.length) return undefined;
  const qset = new Set(qt);
  let best: string | undefined;
  let bestInter = 0;
  for (const c of candidates) {
    const ct = tokenize(c);
    if (!ct.length) continue;
    const inter = ct.filter((t) => qset.has(t)).length;
    if (inter === 0) continue;
    const candidateCovered = inter === ct.length; // query contains all of candidate's words
    const queryCovered = inter === qt.length; // candidate contains all of query's words
    if ((candidateCovered || queryCovered) && inter > bestInter) {
      bestInter = inter;
      best = c;
    }
  }
  return best;
}

/** Whether a row passes the query filter. */
function makePredicate(ds: Dataset, q: Query, catOf: (i: number) => string): (r: Row) => boolean {
  const f = q.filter ?? {};
  const excludeReimb = f.excludeReimbursements ?? true; // default: exclude S/T
  const fyIdx = f.fiscalYear ? ds.meta.fiscalYears.indexOf(f.fiscalYear) : -1;
  const vendorNeedle = f.vendor?.trim().toLowerCase();

  // Resolve agency/category to canonical names (fall back to the raw value if no match).
  const agency = f.agency ? resolveValue(ds.dims.agencies, f.agency) ?? f.agency : undefined;
  const category = f.category
    ? resolveValue([...new Set(Object.values(ds.objectToCategory))], f.category) ?? f.category
    : undefined;

  return (r) => {
    if (excludeReimb && REIMBURSEMENT_OBJECTS.has(ds.dims.objects[r[COL.OBJECT]])) return false;
    if (fyIdx >= 0 && r[COL.FY] !== fyIdx) return false;
    if (agency && ds.dims.agencies[r[COL.AGENCY]] !== agency) return false;
    if (category && catOf(r[COL.OBJECT]) !== category) return false;
    if (vendorNeedle && !ds.dims.vendors[r[COL.VENDOR]].toLowerCase().includes(vendorNeedle)) return false;
    return true;
  };
}

export function runQuery(ds: Dataset, rawQuery: Query): QueryResult {
  const q = normalizeQuery(rawQuery);
  const catOf = categoryResolver(ds);
  const pass = makePredicate(ds, q, catOf);
  const key = keyFn(ds, q.groupBy, catOf);

  // Accumulate sum + count per group in a single pass.
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();
  let matchedRows = 0;

  for (const r of ds.rows) {
    if (!pass(r)) continue;
    matchedRows++;
    const k = key(r);
    sums.set(k, (sums.get(k) ?? 0) + r[COL.AMOUNT]);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  // Reduce each group to the chosen metric.
  const valueOf = (k: string): number => {
    const s = sums.get(k) ?? 0;
    const c = counts.get(k) ?? 0;
    if (q.metric === "count") return c;
    if (q.metric === "avg") return c ? s / c : 0;
    return s; // sum
  };

  let groups: ResultRow[] = [...sums.keys()].map((k) => ({ label: k, value: valueOf(k), share: 0 }));
  const totalGroups = groups.length;

  // grandTotal is the metric across ALL groups (used for shares + concentration).
  const grandTotal =
    q.metric === "count"
      ? matchedRows
      : q.metric === "avg"
      ? (matchedRows ? sumAll(sums) / matchedRows : 0)
      : sumAll(sums);

  const isTimeAxis = q.groupBy === "fiscalYear" || q.groupBy === "fiscalMonth";
  let topN: ResultRow[];
  let othersValue = 0;

  if (isTimeAxis) {
    // Time series: order chronologically (by numeric label), never truncate / bucket.
    groups.sort((a, b) => Number(a.label) - Number(b.label));
    topN = groups;
  } else {
    // Ranking: sort by value, keep top-N, fold the rest into "All others".
    groups.sort((a, b) => (q.sort === "asc" ? a.value - b.value : b.value - a.value));
    const limit = q.limit ?? 10;
    topN = groups.slice(0, limit);
    if (q.metric !== "avg" && groups.length > limit) {
      othersValue = groups.slice(limit).reduce((s, g) => s + g.value, 0);
    }
  }

  const concentration = grandTotal ? (topN.reduce((s, g) => s + g.value, 0) / grandTotal) * 100 : 0;

  const rows: ResultRow[] = topN.map((g) => ({
    ...g,
    share: grandTotal ? (g.value / grandTotal) * 100 : 0,
  }));
  if (othersValue > 0) {
    rows.push({ label: "All others", value: othersValue, share: grandTotal ? (othersValue / grandTotal) * 100 : 0 });
  }

  return {
    rows,
    grandTotal,
    matchedRows,
    totalGroups,
    metric: q.metric,
    groupBy: q.groupBy,
    chart: q.chart!,
    query: q,
    concentration,
  };
}

function sumAll(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

/** Fill defaults + pick a sensible chart type. */
export function normalizeQuery(q: Query): Query {
  const isTimeAxis = q.groupBy === "fiscalYear" || q.groupBy === "fiscalMonth";
  return {
    metric: q.metric ?? "sum",
    groupBy: q.groupBy ?? "vendor",
    filter: { excludeReimbursements: true, ...(q.filter ?? {}) },
    sort: q.sort ?? "desc",
    limit: q.limit ?? 10,
    chart: q.chart ?? (isTimeAxis ? "line" : "bar"),
  };
}
