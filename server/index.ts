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
import type { Query } from "../shared/types";

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
    const result = runQuery(ds, req.body as Query);
    res.json(result);
  } catch (e) {
    console.error("[/api/query] error:", e);
    res.status(400).json({ error: "Could not run that query." });
  }
});

app.post("/api/ask", async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) return res.status(400).json({ error: "Missing question." });
  try {
    // 1) AI parses intent into a Query (input logged inside parseQuestion).
    const query = await parseQuestion(question, facts.categories);
    // 2) OUR engine computes the numbers — never the AI.
    const result = runQuery(ds, query);
    // 3) AI writes one sentence FROM the computed numbers (input logged inside summarize).
    const insight = await summarize(question, result);
    // 4) Build the constellation that answers the question (numbers still computed by code).
    const graph = answerGraph(ds, query, result);
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
app.get("/api/overview", (req, res) => {
  const fiscalYear = String(req.query.fiscalYear ?? facts.fiscalYears[facts.fiscalYears.length - 1]);
  try {
    res.json(buildOverview(ds, fiscalYear));
  } catch (e) {
    console.error("[/api/overview] error:", e);
    res.status(500).json({ error: "Could not build the overview." });
  }
});

// A focused neighborhood (click-to-drill on a node).
app.get("/api/graph", (req, res) => {
  const focusType = String(req.query.focusType ?? "agency") as "vendor" | "agency";
  const focusName = String(req.query.focusName ?? "");
  const fiscalYear = String(req.query.fiscalYear ?? facts.fiscalYears[facts.fiscalYears.length - 1]);
  const depth = (Number(req.query.depth ?? 1) === 2 ? 2 : 1) as 1 | 2;
  if (!focusName) return res.status(400).json({ error: "Missing focusName." });
  try {
    res.json(buildFocusGraph(ds, { focusType, focusName, fiscalYear, depth }));
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
