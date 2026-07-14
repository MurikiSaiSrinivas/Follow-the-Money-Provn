// Express API. Holds the data in memory and the OpenAI key server-side (never in the browser).
// Routes:
//   GET  /api/health   -> liveness + dataset facts
//   POST /api/query    -> run a structured Query (used by the Explorer controls)
//   POST /api/ask      -> the AI path: question -> Query -> compute -> chart data + insight

import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import express from "express";
import cors from "cors";
import { loadDataset, datasetFacts } from "./data";
import { runQuery } from "./engine";
import { aiAvailable, parseQuestion, summarize } from "./ai";
import { answerGraph, buildFocusGraph, buildOverview } from "./graph";
import { search } from "./search";
import type { GraphContext, Query } from "../shared/types";

/** Pull the client-supplied grouping context out of a request body (see AGENCY_GROUPS.md). */
function readContext(body: any): GraphContext {
  return {
    groups: Array.isArray(body?.groups) ? body.groups : undefined,
    scope: body?.scope ?? null,
  };
}

const app = express();
app.use(cors());
app.use(express.json());

const ds = loadDataset();
const facts = datasetFacts(ds);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, aiEnabled: aiAvailable(), facts });
});

app.post("/api/query", (req, res) => {
  try {
    const result = runQuery(ds, req.body as Query, readContext(req.body));
    res.json(result);
  } catch (e) {
    console.error("[/api/query] error:", e);
    res.status(400).json({ error: "Could not run that query." });
  }
});

app.post("/api/ask", async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) return res.status(400).json({ error: "Missing question." });
  const context = readContext(req.body);
  try {
    // 1) AI parses intent into a Query (input logged inside parseQuestion). The AI is group-unaware.
    const query = await parseQuestion(question, facts.categories);
    // 2) OUR engine computes the numbers — never the AI. Grouping context relabels/scopes here.
    const result = runQuery(ds, query, context);
    // 3) AI writes one sentence FROM the computed numbers (input logged inside summarize).
    const insight = await summarize(question, result);
    // 4) Build the constellation that answers the question (numbers still computed by code).
    const graph = answerGraph(ds, query, result, context);
    res.json({ question, query, result, insight, graph, aiEnabled: aiAvailable() });
  } catch (e) {
    console.error("[/api/ask] error:", e);
    res.status(500).json({ error: "Something went wrong answering that." });
  }
});

// Typeahead for the focus picker.
app.get("/api/search", (req, res) => {
  const q = String(req.query.q ?? "");
  const type = String(req.query.type ?? "all") as "vendor" | "agency" | "all";
  res.json({ hits: search(ds, q, type, 15) });
});

// The resting "whole system" map: agencies × the categories they spend in.
// POST so the (potentially large) grouping context travels in the body. Grouped agencies collapse
// into super-nodes; a scoped group focuses the map on that group.
app.post("/api/overview", (req, res) => {
  const fiscalYear = String(req.body?.fiscalYear ?? facts.fiscalYears[facts.fiscalYears.length - 1]);
  const context = readContext(req.body);
  try {
    // A scoped group turns the overview into that group's neighborhood.
    const scoped = context.scope ? (context.groups ?? []).find((g) => g.id === context.scope && g.agencies.length) : null;
    res.json(scoped ? buildFocusGraph(ds, { focusType: "group", focusName: scoped.name, fiscalYear, depth: 1 }, context) : buildOverview(ds, fiscalYear, context));
  } catch (e) {
    console.error("[/api/overview] error:", e);
    res.status(500).json({ error: "Could not build the overview." });
  }
});

// A focused neighborhood (click-to-drill on a node). focusType "group" drills into a collapsed group.
app.post("/api/graph", (req, res) => {
  const focusType = String(req.body?.focusType ?? "agency") as "vendor" | "agency" | "group";
  const focusName = String(req.body?.focusName ?? "");
  const fiscalYear = String(req.body?.fiscalYear ?? facts.fiscalYears[facts.fiscalYears.length - 1]);
  const depth = (Number(req.body?.depth ?? 1) === 2 ? 2 : 1) as 1 | 2;
  if (!focusName) return res.status(400).json({ error: "Missing focusName." });
  try {
    res.json(buildFocusGraph(ds, { focusType, focusName, fiscalYear, depth }, readContext(req.body)));
  } catch (e) {
    console.error("[/api/graph] error:", e);
    res.status(500).json({ error: "Could not build the graph." });
  }
});

// In production (e.g. on Render) the same server serves the built React app. In dev, Vite
// serves the frontend on :5173 and proxies /api here, so this block is skipped.
if (process.env.NODE_ENV === "production") {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dist = resolve(__dirname, "../dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(resolve(dist, "index.html")));
  console.log(`[server] serving static frontend from ${dist}`);
}

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}  (AI ${aiAvailable() ? "ON" : "OFF — using fallback"})`);
});
