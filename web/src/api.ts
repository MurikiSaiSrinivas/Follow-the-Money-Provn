import type { AgencyGroup, Query, QueryResult } from "../../shared/types";

export type { AgencyGroup };

/** Grouping context sent with every data request (see AGENCY_GROUPS.md). */
export interface GroupCtx {
  groups?: AgencyGroup[];
  scope?: string | null;
}

export interface AskResponse {
  question: string;
  query: Query;
  result: QueryResult;
  insight: string;
  graph: GraphData;
  aiEnabled: boolean;
}

export interface HealthResponse {
  ok: boolean;
  aiEnabled: boolean;
  facts: {
    fiscalYears: string[];
    categories: string[];
    agencyCount: number;
    vendorCount: number;
    rowCount: number;
  };
}

export async function ask(question: string, ctx: GroupCtx = {}): Promise<AskResponse> {
  const r = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, ...ctx }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Request failed");
  return r.json();
}

export async function health(): Promise<HealthResponse> {
  const r = await fetch("/api/health");
  return r.json();
}

// ---- Money Map ----

export interface SearchHit {
  name: string;
  type: "vendor" | "agency";
  total: number;
}

export interface GraphNode {
  id: string;
  name: string;
  type: "agency" | "vendor" | "category";
  value: number;
  focus?: boolean;
  isGroup?: boolean; // collapsed agency group — drawn with a ring
}
export interface GraphLink {
  source: string;
  target: string;
  value: number;
  category?: string;
}
export interface GraphData {
  focusId: string | null;
  fiscalYear: string;
  nodes: GraphNode[];
  links: GraphLink[];
  truncated: { vendorsShown: number; vendorsTotal: number } | null;
}

export async function fetchOverview(fiscalYear: string, ctx: GroupCtx = {}): Promise<GraphData> {
  const r = await fetch("/api/overview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fiscalYear, ...ctx }),
  });
  if (!r.ok) throw new Error("Overview failed");
  return r.json();
}

export async function searchEntities(q: string, type: "vendor" | "agency" | "all"): Promise<SearchHit[]> {
  const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=${type}`);
  return (await r.json()).hits as SearchHit[];
}

export interface GraphParams {
  focusType: "vendor" | "agency" | "group";
  focusName: string;
  fiscalYear: string;
  depth: 1 | 2;
}

export async function fetchGraph(p: GraphParams, ctx: GroupCtx = {}): Promise<GraphData> {
  const r = await fetch("/api/graph", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...p, ...ctx }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Graph failed");
  return r.json();
}
