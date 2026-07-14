// Graph builders for the unified "living ledger" view.
//   buildOverview   — the resting state: 102 agencies + category hubs, agency→category flows.
//   buildFocusGraph — a vendor/agency neighborhood (vendors bloom in), category-colored edges.
//   answerGraph     — turn a parsed Query + result into the constellation that answers it.
// Every edge carries its dominant spending category so the frontend can color it.

import { COL, type Dataset, type GraphContext, type Query, type QueryResult, type Row } from "../shared/types";

const REIMBURSEMENT = new Set(["S", "T"]);
const TOP_VENDORS_PER_AGENCY = 18;
const TOP_AGENCIES_PER_VENDOR = 20;
const DEPTH2_FANOUT = 4;
const SEP = ""; // key delimiter that never appears in names

export type NodeType = "agency" | "vendor" | "category";
export interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  value: number;
  focus?: boolean;
  isGroup?: boolean; // an agency node that is really a collapsed group (drawn with a ring)
}
export interface GraphLink {
  source: string;
  target: string;
  value: number;
  category?: string; // dominant spending category — drives edge color
}
export interface GraphData {
  focusId: string | null;
  fiscalYear: string;
  nodes: GraphNode[];
  links: GraphLink[];
  truncated: { vendorsShown: number; vendorsTotal: number } | null;
}

const nid = (type: NodeType, name: string) => `${type}:${name}`;

function catResolver(ds: Dataset): (objIdx: number) => string {
  const byIdx = ds.dims.objects.map((c) => ds.objectToCategory[c] ?? c);
  return (i) => byIdx[i];
}

/**
 * Resolve the grouping context into graph helpers (see AGENCY_GROUPS.md):
 *   displayAgency — collapse a member agency's name to its group name (relabel lens).
 *   groupNames    — set of group names, used to mark super-nodes with isGroup.
 *   scopeAgencies — member agencies of a scoped group (else null → no scope filter).
 *   scopeGroup    — the scoped group ({id,name,agencies}) or null.
 */
function graphContext(ds: Dataset, ctx: GraphContext = {}) {
  const agencyToGroup = new Map<string, string>();
  for (const g of ctx.groups ?? [])
    for (const a of g.agencies) if (!agencyToGroup.has(a)) agencyToGroup.set(a, g.name);
  const groupNames = new Set(agencyToGroup.values());
  const displayAgency = (name: string) => agencyToGroup.get(name) ?? name;
  const scopeGroup = ctx.scope ? (ctx.groups ?? []).find((g) => g.id === ctx.scope && g.agencies.length) ?? null : null;
  const scopeAgencies = scopeGroup ? new Set(scopeGroup.agencies) : null;
  return { displayAgency, groupNames, scopeAgencies, scopeGroup };
}

/**
 * Rows for a fiscal year (fyIdx = -1 means all years), excluding reimbursements. When
 * `scopeAgencies` is given, only rows whose (raw) agency is in that set pass — the scope filter.
 */
function* fyRows(ds: Dataset, fyIdx: number, scopeAgencies: Set<string> | null = null): Generator<Row> {
  for (const r of ds.rows) {
    if (fyIdx >= 0 && r[COL.FY] !== fyIdx) continue;
    if (REIMBURSEMENT.has(ds.dims.objects[r[COL.OBJECT]])) continue;
    if (scopeAgencies && !scopeAgencies.has(ds.dims.agencies[r[COL.AGENCY]])) continue;
    yield r;
  }
}

const fyIndex = (ds: Dataset, fiscalYear: string) => ds.meta.fiscalYears.indexOf(fiscalYear);

// edge accumulator that tracks the dominant category per directed edge
interface EdgeAcc {
  total: number;
  cats: Map<string, number>;
}
function bumpEdge(map: Map<string, EdgeAcc>, agency: string, vendor: string, cat: string, amt: number) {
  const key = agency + SEP + vendor;
  let e = map.get(key);
  if (!e) {
    e = { total: 0, cats: new Map() };
    map.set(key, e);
  }
  e.total += amt;
  e.cats.set(cat, (e.cats.get(cat) ?? 0) + amt);
}
const agOf = (key: string) => key.slice(0, key.indexOf(SEP));
const venOf = (key: string) => key.slice(key.indexOf(SEP) + 1);
const dominantCat = (e: EdgeAcc) => [...e.cats].sort((a, b) => b[1] - a[1])[0]?.[0];

// ============================================================================
// Overview — the whole system: agencies × the spending categories they use.
// ============================================================================
export function buildOverview(ds: Dataset, fiscalYear: string, context: GraphContext = {}): GraphData {
  const fyIdx = fyIndex(ds, fiscalYear);
  const catOf = catResolver(ds);
  const { displayAgency, groupNames, scopeAgencies } = graphContext(ds, context);
  const agencyCat = new Map<string, number>(); // `${agency}${SEP}${cat}` -> $
  const agencyTotal = new Map<string, number>();
  const catTotal = new Map<string, number>();

  for (const r of fyRows(ds, fyIdx, scopeAgencies)) {
    const ag = displayAgency(ds.dims.agencies[r[COL.AGENCY]]); // relabel lens: grouped agencies collapse
    const cat = catOf(r[COL.OBJECT]);
    const amt = r[COL.AMOUNT];
    agencyCat.set(ag + SEP + cat, (agencyCat.get(ag + SEP + cat) ?? 0) + amt);
    agencyTotal.set(ag, (agencyTotal.get(ag) ?? 0) + amt);
    catTotal.set(cat, (catTotal.get(cat) ?? 0) + amt);
  }

  const nodes: GraphNode[] = [];
  for (const [ag, v] of agencyTotal)
    nodes.push({ id: nid("agency", ag), name: ag, type: "agency", value: v, isGroup: groupNames.has(ag) });
  for (const [cat, v] of catTotal) nodes.push({ id: nid("category", cat), name: cat, type: "category", value: v });

  const links: GraphLink[] = [];
  for (const [key, v] of agencyCat) {
    if (v <= 0) continue;
    const ag = agOf(key);
    const cat = venOf(key);
    links.push({ source: nid("agency", ag), target: nid("category", cat), value: v, category: cat });
  }
  return { focusId: null, fiscalYear, nodes, links, truncated: null };
}

// ============================================================================
// Focused neighborhood — vendor or agency, category-colored agency→vendor edges.
// ============================================================================
export function buildFocusGraph(
  ds: Dataset,
  opts: { focusType: "vendor" | "agency" | "group"; focusName: string; fiscalYear: string; depth: 1 | 2 },
  context: GraphContext = {},
): GraphData {
  const fyIdx = fyIndex(ds, opts.fiscalYear);
  const catOf = catResolver(ds);
  const { displayAgency, groupNames } = graphContext(ds, context);
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, EdgeAcc>();
  let truncated: GraphData["truncated"] = null;

  // Agency focus and group focus share a path: a group focus keeps ALL of the group's member
  // agencies' rows and collapses them under the single group name (a super-node).
  if (opts.focusType === "agency" || opts.focusType === "group") {
    const grp =
      opts.focusType === "group"
        ? (context.groups ?? []).find((g) => g.name === opts.focusName || g.id === opts.focusName)
        : undefined;
    const focusName = grp ? grp.name : resolveAgency(ds, opts.focusName);
    const members = grp ? new Set(grp.agencies) : null; // null => match a single agency by name
    const isFocus = (rawAgency: string) => (members ? members.has(rawAgency) : rawAgency === focusName);

    for (const r of fyRows(ds, fyIdx)) {
      if (!isFocus(ds.dims.agencies[r[COL.AGENCY]])) continue;
      bumpEdge(edges, focusName, ds.dims.vendors[r[COL.VENDOR]], catOf(r[COL.OBJECT]), r[COL.AMOUNT]);
    }
    const ranked = [...edges.entries()].sort((a, b) => b[1].total - a[1].total);
    const top = ranked.slice(0, TOP_VENDORS_PER_AGENCY);
    truncated = ranked.length > top.length ? { vendorsShown: top.length, vendorsTotal: ranked.length } : null;
    const keep = new Set(top.map(([k]) => k));
    for (const k of [...edges.keys()]) if (!keep.has(k)) edges.delete(k);

    const topVendors = new Set(top.map(([k]) => venOf(k)));
    addNode(nodes, "agency", focusName, 0, true);
    for (const [k, e] of edges) addNode(nodes, "vendor", venOf(k), e.total);

    if (opts.depth === 2) {
      const d2 = new Map<string, EdgeAcc>();
      for (const r of fyRows(ds, fyIdx)) {
        const v = ds.dims.vendors[r[COL.VENDOR]];
        if (!topVendors.has(v)) continue;
        if (isFocus(ds.dims.agencies[r[COL.AGENCY]])) continue; // skip the focus (agency or group)
        const ag = displayAgency(ds.dims.agencies[r[COL.AGENCY]]); // other agencies collapse to their group
        bumpEdge(d2, ag, v, catOf(r[COL.OBJECT]), r[COL.AMOUNT]);
      }
      pruneFanout(d2, "vendor", DEPTH2_FANOUT);
      for (const [k, e] of d2) {
        addNode(nodes, "agency", agOf(k), e.total);
        edges.set(k, e);
      }
    }
    return finalize(nid("agency", focusName), opts.fiscalYear, nodes, edges, truncated, groupNames);
  }

  // vendor focus — agencies paying this vendor collapse to their group where grouped.
  const focusName = resolveVendor(ds, opts.focusName);
  for (const r of fyRows(ds, fyIdx)) {
    if (ds.dims.vendors[r[COL.VENDOR]] !== focusName) continue;
    bumpEdge(edges, displayAgency(ds.dims.agencies[r[COL.AGENCY]]), focusName, catOf(r[COL.OBJECT]), r[COL.AMOUNT]);
  }
  const rankedA = [...edges.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, TOP_AGENCIES_PER_VENDOR);
  edges.clear();
  rankedA.forEach(([k, e]) => edges.set(k, e));
  const agencySet = new Set(rankedA.map(([k]) => agOf(k))); // display names (group or agency)
  addNode(nodes, "vendor", focusName, 0, true);
  for (const [k, e] of edges) addNode(nodes, "agency", agOf(k), e.total);

  if (opts.depth === 2) {
    const d2 = new Map<string, EdgeAcc>();
    for (const r of fyRows(ds, fyIdx)) {
      const ag = displayAgency(ds.dims.agencies[r[COL.AGENCY]]);
      if (!agencySet.has(ag)) continue;
      const v = ds.dims.vendors[r[COL.VENDOR]];
      if (v === focusName) continue;
      bumpEdge(d2, ag, v, catOf(r[COL.OBJECT]), r[COL.AMOUNT]);
    }
    pruneFanout(d2, "agency", DEPTH2_FANOUT);
    for (const [k, e] of d2) {
      addNode(nodes, "vendor", venOf(k), e.total);
      edges.set(k, e);
    }
  }
  return finalize(nid("vendor", focusName), opts.fiscalYear, nodes, edges, truncated, groupNames);
}

// ============================================================================
// Answer graph — the constellation that answers a parsed question.
// ============================================================================
export function answerGraph(ds: Dataset, query: Query, result: QueryResult, context: GraphContext = {}): GraphData {
  const { scopeGroup } = graphContext(ds, context);
  const fy = query.filter?.fiscalYear ?? "all";
  // Scoped to a group → the map shows that group's neighborhood (its top vendors), collapsed.
  if (scopeGroup) return buildFocusGraph(ds, { focusType: "group", focusName: scopeGroup.name, fiscalYear: fy, depth: 1 }, context);
  if (query.filter?.vendor) return buildFocusGraph(ds, { focusType: "vendor", focusName: query.filter.vendor, fiscalYear: fy, depth: 1 }, context);
  if (query.filter?.agency) return buildFocusGraph(ds, { focusType: "agency", focusName: query.filter.agency, fiscalYear: fy, depth: 1 }, context);

  const names = result.rows.filter((r) => r.label !== "All others").map((r) => r.label).slice(0, 8);
  if (query.groupBy === "vendor") return constellation(ds, fy, "vendor", names, context);
  if (query.groupBy === "agency") return constellation(ds, fy, "agency", names, context);
  return buildOverview(ds, fy === "all" ? ds.meta.fiscalYears[ds.meta.fiscalYears.length - 1] : fy, context);
}

function constellation(
  ds: Dataset,
  fiscalYear: string,
  kind: "vendor" | "agency",
  names: string[],
  context: GraphContext = {},
): GraphData {
  const fyIdx = fyIndex(ds, fiscalYear);
  const catOf = catResolver(ds);
  const { displayAgency, groupNames, scopeAgencies } = graphContext(ds, context);
  const want = new Set(names); // for an agency question these labels may be GROUP names
  const edges = new Map<string, EdgeAcc>();
  for (const r of fyRows(ds, fyIdx, scopeAgencies)) {
    const ag = displayAgency(ds.dims.agencies[r[COL.AGENCY]]); // relabel before matching/keying
    const v = ds.dims.vendors[r[COL.VENDOR]];
    if (kind === "vendor" ? want.has(v) : want.has(ag)) bumpEdge(edges, ag, v, catOf(r[COL.OBJECT]), r[COL.AMOUNT]);
  }
  pruneFanout(edges, kind, kind === "vendor" ? 4 : 6);

  const nodes = new Map<string, GraphNode>();
  for (const [k, e] of edges) {
    addNode(nodes, "agency", agOf(k), e.total, kind === "agency" && want.has(agOf(k)));
    addNode(nodes, "vendor", venOf(k), e.total, kind === "vendor" && want.has(venOf(k)));
  }
  return finalize(null, fiscalYear, nodes, edges, null, groupNames);
}

// ---- helpers ----
function addNode(nodes: Map<string, GraphNode>, type: NodeType, name: string, value: number, focus = false) {
  const id = nid(type, name);
  const ex = nodes.get(id);
  if (ex) {
    ex.value += value;
    if (focus) ex.focus = true;
  } else nodes.set(id, { id, name, type, value, focus });
}

/** Keep only the top `fanout` edges per vendor (or per agency). */
function pruneFanout(edges: Map<string, EdgeAcc>, per: "vendor" | "agency", fanout: number) {
  const groups = new Map<string, [string, EdgeAcc][]>();
  for (const [k, e] of edges) {
    const g = per === "vendor" ? venOf(k) : agOf(k);
    (groups.get(g) ?? groups.set(g, []).get(g)!).push([k, e]);
  }
  edges.clear();
  for (const list of groups.values())
    list.sort((a, b) => b[1].total - a[1].total).slice(0, fanout).forEach(([k, e]) => edges.set(k, e));
}

function finalize(
  focusId: string | null,
  fiscalYear: string,
  nodes: Map<string, GraphNode>,
  edges: Map<string, EdgeAcc>,
  truncated: GraphData["truncated"],
  groupNames: Set<string> = new Set(),
): GraphData {
  const links: GraphLink[] = [];
  for (const [k, e] of edges)
    links.push({ source: nid("agency", agOf(k)), target: nid("vendor", venOf(k)), value: e.total, category: dominantCat(e) });
  // Mark collapsed super-nodes so the frontend draws them with a ring (color stays agency).
  if (groupNames.size) for (const n of nodes.values()) if (n.type === "agency" && groupNames.has(n.name)) n.isGroup = true;
  return { focusId, fiscalYear, nodes: [...nodes.values()], links, truncated };
}

// ---- name resolution ----
const STOP = new Set(["the", "of", "for", "and", "dept", "department"]);
const toks = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((t) => t && !STOP.has(t));

export function resolveAgency(ds: Dataset, q: string): string {
  if (ds.dims.agencies.includes(q)) return q;
  const qt = new Set(toks(q));
  let best = q;
  let bestInter = 0;
  for (const c of ds.dims.agencies) {
    const ct = toks(c);
    const inter = ct.filter((t) => qt.has(t)).length;
    if (inter && (inter === ct.length || inter === qt.size) && inter > bestInter) {
      bestInter = inter;
      best = c;
    }
  }
  return best;
}
export function resolveVendor(ds: Dataset, q: string): string {
  if (ds.dims.vendors.includes(q)) return q;
  const lq = q.toLowerCase();
  return ds.dims.vendors.find((v) => v.toLowerCase().includes(lq)) ?? q;
}
