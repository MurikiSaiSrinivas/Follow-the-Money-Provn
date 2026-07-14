// Shared contract between server, AI, and web. The `Query` object is the heart of the app:
// both the AI parser and the manual Explorer controls emit one of these, and runQuery()
// consumes it. (See SPEC.md §11a — one engine, two entry points.)

export type Metric = "sum" | "count" | "avg";

export type GroupBy =
  | "vendor"
  | "agency"
  | "category"
  | "subcategory"
  | "fiscalYear"
  | "fiscalMonth";

export type FiscalYear = "2022" | "2023";

export interface QueryFilter {
  fiscalYear?: FiscalYear;
  agency?: string;       // exact Agency name
  category?: string;     // exact Category name
  vendor?: string;       // substring match (vendor names are long/specific)
  /**
   * Exclude Interagency / Intra-Agency Reimbursements (Object S/T) — money moving between
   * state agencies. Default TRUE: most journalist questions are about money to outside
   * vendors. See METRICS_AND_FORMATS.md §A.
   */
  excludeReimbursements?: boolean;
}

export interface Query {
  metric: Metric;
  groupBy: GroupBy;
  filter?: QueryFilter;
  sort?: "desc" | "asc";   // default "desc"
  limit?: number;          // top-N; default 10
  chart?: "bar" | "line";  // default: line for time axes, else bar
}

// ---- Agency groups (client-owned; sent with each request) ----
// A group bundles several agencies into one named "super-agency". Grouping is a deterministic
// relabel/filter lens applied by the engine and graph builders — the AI is never involved.
// See AGENCY_GROUPS.md.

export interface AgencyGroup {
  id: string;          // stable client id, e.g. "g1"
  name: string;        // display label, default "Group 1", user-renameable
  agencies: string[];  // canonical agency names (exact strings from ds.dims.agencies)
}

/** Grouping context threaded alongside a Query into runQuery() and the graph builders. */
export interface GraphContext {
  groups?: AgencyGroup[];
  scope?: string | null;   // group id in scope, or null/undefined = "All"
}

export interface ResultRow {
  label: string;
  value: number;   // the metric value for this group
  share: number;   // value / grandTotal * 100 (0 if grandTotal is 0)
}

export interface QueryResult {
  rows: ResultRow[];          // top-N groups, plus an "All others" bucket when truncated
  grandTotal: number;         // metric across ALL groups after filtering
  matchedRows: number;        // number of source payment lines matched by the filter
  totalGroups: number;        // distinct groups before top-N truncation
  metric: Metric;
  groupBy: GroupBy;
  chart: "bar" | "line";
  query: Query;               // the (normalized) query that produced this
  concentration?: number;     // share of grandTotal held by the returned top-N (excl. "All others")
}

// ---- In-memory dataset shape (produced by scripts/convert_data.py) ----

export interface DatasetMeta {
  source: string;
  rowCount: number;
  fiscalYears: string[];      // index aligns with row[0]
  rowSchema: string[];
  vendorCount: number;
  agencyCount: number;
}

/** Row tuple layout: [fyIdx, fmonth, agencyIdx, objIdx, subcatIdx, vendorIdx, amount] */
export type Row = [number, number, number, number, number, number, number];

export interface Dataset {
  meta: DatasetMeta;
  objectToCategory: Record<string, string>;
  dims: {
    vendors: string[];
    agencies: string[];
    objects: string[];
    subcategories: string[];
  };
  rows: Row[];
}

// ---- Graph shapes (kept in sync with server/graph.ts and web/src/api.ts) ----
// (The graph builders own the canonical GraphNode/GraphLink/GraphData; this note documents that
//  a group super-node is modelled as type "agency" with isGroup=true so its color is unchanged.)

// Column indices into a Row (keep in sync with convert_data.py rowSchema)
export const COL = {
  FY: 0,
  FMONTH: 1,
  AGENCY: 2,
  OBJECT: 3,
  SUBCAT: 4,
  VENDOR: 5,
  AMOUNT: 6,
} as const;
