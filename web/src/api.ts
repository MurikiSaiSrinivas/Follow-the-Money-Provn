import type { Query, QueryResult } from "../../shared/types";

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

export async function ask(question: string): Promise<AskResponse> {
  const r = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
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

export async function fetchOverview(fiscalYear: string): Promise<GraphData> {
  const r = await fetch(`/api/overview?fiscalYear=${encodeURIComponent(fiscalYear)}`);
  if (!r.ok) throw new Error("Overview failed");
  return r.json();
}

export async function searchEntities(q: string, type: "vendor" | "agency" | "all"): Promise<SearchHit[]> {
  const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=${type}`);
  return (await r.json()).hits as SearchHit[];
}

export interface GraphParams {
  focusType: "vendor" | "agency";
  focusName: string;
  fiscalYear: string;
  depth: 1 | 2;
}

export async function fetchGraph(p: GraphParams): Promise<GraphData> {
  const qs = new URLSearchParams({
    focusType: p.focusType,
    focusName: p.focusName,
    fiscalYear: p.fiscalYear,
    depth: String(p.depth),
  });
  const r = await fetch(`/api/graph?${qs}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Graph failed");
  return r.json();
}
