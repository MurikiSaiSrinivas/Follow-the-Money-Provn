// AI layer: turn a plain-English question into a structured Query, and turn computed numbers
// into a one-line insight. Two hard rules from the brief (SPEC.md §3, §4):
//   1. EVERY input sent to the model is logged via logAiInput() — the single choke-point.
//   2. The AI NEVER computes dollar figures. It only (a) parses intent into a Query and
//      (b) writes prose from numbers OUR engine already computed.

import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import OpenAI from "openai";
import type { Query, QueryResult } from "../shared/types";
import { fmtCount, fmtCurrencyCompact, fmtPercent } from "../shared/format";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = resolve(__dirname, "../logs");
const LOG_FILE = resolve(LOG_DIR, "ai-inputs.log");

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const hasKey = !!process.env.OPENAI_API_KEY;
const client = hasKey ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

/**
 * THE AI-INPUT LOGGING CHOKE-POINT (brief hard constraint #3).
 * Called immediately before every model request. In prod this would write to a real sink
 * (Datadog / BigQuery); for the POC we log to console + logs/ai-inputs.log.
 */
export function logAiInput(stage: string, userQuestion: string, payload: unknown) {
  const entry = {
    ts: new Date().toISOString(),
    stage, // "parse" | "summarize"
    model: MODEL,
    userQuestion,
    inputSentToModel: payload,
  };
  console.log(`[ai-input] ${entry.ts} stage=${stage} model=${MODEL} q=${JSON.stringify(userQuestion)}`);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (e) {
    console.error("[ai-input] failed to write log file:", e);
  }
}

export function aiAvailable(): boolean {
  return !!client;
}

// ---- Stage 1: question -> Query --------------------------------------------------------

const PARSE_SYSTEM = `You translate a journalist's plain-English question about Washington State
government vendor payments into a strict JSON query. You DO NOT compute or invent any numbers.

Output ONLY a JSON object with this shape (no prose):
{
  "metric": "sum" | "count" | "avg",
  "groupBy": "vendor" | "agency" | "category" | "subcategory" | "fiscalYear" | "fiscalMonth",
  "filter": {
    "fiscalYear"?: "2022" | "2023",
    "agency"?: string,
    "category"?: string,
    "vendor"?: string,
    "excludeReimbursements"?: boolean
  },
  "sort": "desc" | "asc",
  "limit": number,
  "chart": "bar" | "line"
}

Rules:
- "biggest/top/most/highest paid" -> metric "sum", sort "desc".
- "who are the / which / list the / show the" vendors|agencies|categories (no other metric
  word) -> rank by dollars: metric "sum", sort "desc". This is the default reading of an open
  "who/which" question.
- Default sort is "desc". Use sort "asc" ONLY for explicit "smallest/least/lowest/fewest".
- "how many payments" -> metric "count". "average/typical" -> metric "avg".
- A question about change/trend/over time/vs last year, or "from <year> to <year>" -> groupBy
  "fiscalYear" (or "fiscalMonth" if "by month"), chart "line". CRITICAL: do NOT set
  filter.fiscalYear for these — every year must be present to show the trend. Only set
  filter.fiscalYear when the user restricts to a SINGLE year (e.g. "in 2022", "during 2023").
- Use "category" only when the user names a spending category (must be one of the provided list).
- Default limit 10. Default excludeReimbursements true (money to outside vendors).
- Pick chart "line" for time axes, else "bar".`;

const VALID_CATEGORIES_NOTE = (cats: string[]) =>
  `Valid categories (exact strings): ${cats.join("; ")}.`;

export async function parseQuestion(question: string, categories: string[]): Promise<Query> {
  const messages = [
    { role: "system" as const, content: `${PARSE_SYSTEM}\n${VALID_CATEGORIES_NOTE(categories)}` },
    { role: "user" as const, content: question },
  ];

  // LOG BEFORE SENDING — every input to the model is captured here.
  logAiInput("parse", question, messages);

  if (!client) return fallbackParse(question);

  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const text = resp.choices[0]?.message?.content ?? "{}";
    return JSON.parse(text) as Query;
  } catch (e) {
    console.error("[ai] parse failed, using fallback:", e);
    return fallbackParse(question);
  }
}

// ---- Stage 2: computed numbers -> one-line insight -------------------------------------

export async function summarize(question: string, result: QueryResult): Promise<string> {
  // The factual sentence is composed by CODE (owns the numbers AND what each one means).
  // The AI only rephrases it for readability and may NOT change/add any number — so it
  // cannot misattribute a figure (e.g. claim the top-N equals the grand total).
  const factual = composeSummary(result);

  const messages = [
    {
      role: "system" as const,
      content:
        "Rewrite the given factual finding as ONE natural, concise sentence (max ~30 words) for " +
        "a journalist. Keep EVERY number, name, percentage and direction EXACTLY as given. Do " +
        "not add, remove, round, or recompute any figure. Neutral tone. Return only the sentence.",
    },
    { role: "user" as const, content: `Question: ${question}\nFinding: ${factual}` },
  ];

  // The input we send is the already-correct sentence — logged like every other AI input.
  logAiInput("summarize", question, messages);

  if (!client) return factual;
  try {
    const resp = await client.chat.completions.create({ model: MODEL, messages, temperature: 0.3 });
    return resp.choices[0]?.message?.content?.trim() || factual;
  } catch (e) {
    console.error("[ai] summarize failed, using composed sentence:", e);
    return factual;
  }
}

// ---- Deterministic fallbacks (no key / API error) --------------------------------------

/** Tiny keyword parser shaped exactly like the real Query, so the app works with no API key. */
export function fallbackParse(q: string): Query {
  const s = q.toLowerCase();
  const metric: Query["metric"] = /how many|number of|count/.test(s)
    ? "count"
    : /average|typical|mean/.test(s)
    ? "avg"
    : "sum";
  const isTime = /trend|over time|by month|change|grew|rose|fell|vs last year|year over year|year-over-year/.test(s);
  const groupBy: Query["groupBy"] = isTime
    ? /month/.test(s)
      ? "fiscalMonth"
      : "fiscalYear"
    : /agenc/.test(s)
    ? "agency"
    : /categor/.test(s)
    ? "category"
    : "vendor";
  // Only filter to a single year when exactly ONE year is named — otherwise a "2022 vs 2023"
  // trend would collapse to one point.
  const m2022 = /2022|fy22/.test(s);
  const m2023 = /2023|fy23/.test(s);
  const fiscalYear: "2022" | "2023" | undefined =
    m2022 === m2023 ? undefined : m2022 ? "2022" : "2023";
  return {
    metric,
    groupBy,
    filter: { fiscalYear, excludeReimbursements: true },
    sort: /smallest|least|lowest|fewest/.test(s) ? "asc" : "desc",
    limit: 10,
    chart: isTime ? "line" : "bar",
  };
}

/**
 * Compose an accurate one-line finding from a QueryResult. CODE owns both the numbers and
 * their meaning here — the AI only rephrases this (see summarize). Used directly when no key.
 */
export function composeSummary(result: QueryResult): string {
  const shown = result.rows.filter((r) => r.label !== "All others");
  if (shown.length === 0) return "No matching payments were found for that question.";

  const money = (n: number) => fmtCurrencyCompact(n);
  const labelOf = (raw: string) =>
    result.groupBy === "fiscalYear" ? `FY ${raw}` : result.groupBy === "fiscalMonth" ? `month ${raw}` : raw;

  // Time trend: describe change from first to last point.
  if ((result.groupBy === "fiscalYear" || result.groupBy === "fiscalMonth") && shown.length >= 2) {
    const a = shown[0];
    const b = shown[shown.length - 1];
    const pct = a.value ? ((b.value - a.value) / a.value) * 100 : 0;
    const dir = b.value >= a.value ? "rose" : "fell";
    return `Spending ${dir} ${fmtPercent(Math.abs(pct))} from ${money(a.value)} in ${labelOf(a.label)} to ${money(b.value)} in ${labelOf(b.label)}.`;
  }

  const top = shown[0];

  // Count metric.
  if (result.metric === "count") {
    return `${labelOf(top.label)} had the most payments (${fmtCount(top.value)} of ${fmtCount(result.matchedRows)} total).`;
  }

  // Ranking (sum / avg).
  let s = `${labelOf(top.label)} leads with ${money(top.value)} — ${fmtPercent(top.share)} of the ${money(result.grandTotal)} total.`;
  // "Top-N concentration" only makes sense for a descending ranking, not "smallest first".
  if (result.concentration && shown.length > 1 && result.query.sort !== "asc") {
    s += ` The top ${shown.length} together make up ${fmtPercent(result.concentration)}.`;
  }
  return s;
}
