import { useEffect, useRef, useState } from "react";
import { ask, fetchGraph, fetchOverview, health, type AskResponse, type GraphData, type GraphNode, type HealthResponse } from "./api";
import { LedgerGraph } from "./components/LedgerGraph";
import { ResultChart } from "./components/ResultChart";
import { fmtCount, fmtCurrencyCompact, fmtPercent } from "../../shared/format";
import { CATEGORY_COLOR, NODE_COLOR } from "../../shared/categories";

const EXAMPLES = [
  "Biggest vendors in 2022",
  "Who funds Fish and Wildlife?",
  "Top vendors for Travel",
  "Spending change 2022 to 2023",
];

export function App() {
  const [info, setInfo] = useState<HealthResponse | null>(null);
  const [fy, setFy] = useState("2023");

  const [graph, setGraph] = useState<GraphData | null>(null);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // boot: load facts + the overview map
  useEffect(() => {
    health().then((h) => {
      setInfo(h);
      const y = h.facts.fiscalYears[h.facts.fiscalYears.length - 1];
      setFy(y);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadOverview(fy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fy]);

  async function loadOverview(year: string) {
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      setGraph(await fetchOverview(year));
    } catch (e) {
      setError("Could not load the overview.");
    } finally {
      setLoading(false);
    }
  }

  async function runAsk(question: string) {
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await ask(question);
      setAnswer(r);
      setGraph(r.graph);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function drill(n: GraphNode) {
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      setGraph(await fetchGraph({ focusType: n.type as "vendor" | "agency", focusName: n.name, fiscalYear: fy, depth: 1 }));
    } catch (e) {
      setError("Could not open that node.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stage">
      <LedgerGraph data={graph} loading={loading} onNodeClick={drill} />

      {/* top-left wordmark */}
      <header className="brand">
        <div className="brand-rule" />
        <h1>Follow the <em>Money</em></h1>
        <p className="brand-sub">
          Washington State vendor payments
          {info && <> · <span className="num">{fmtCount(info.facts.rowCount)}</span> records · 2021–23</>}
        </p>
      </header>

      {/* top-right controls */}
      <div className="stage-controls">
        <div className="seg dark">
          {(info?.facts.fiscalYears ?? ["2022", "2023"]).map((y) => (
            <button key={y} className={fy === y ? "on" : ""} onClick={() => setFy(y)}>FY {y}</button>
          ))}
        </div>
        <button className="ghost" onClick={() => loadOverview(fy)}>Reset map</button>
      </div>

      {/* answer card */}
      {answer && (
        <aside className="answer-card" key={answer.question}>
          <div className="ac-head">
            <span className="eyebrow">Finding</span>
            {!answer.aiEnabled && <span className="badge">fallback</span>}
            <button className="ac-close" onClick={() => setAnswer(null)}>Keep exploring the map →</button>
          </div>
          <p className="ac-insight">{answer.insight}</p>
          <div className="ac-stats num">
            <div><span className="v">{fmtCurrencyCompact(answer.result.grandTotal)}</span><span className="k">Total</span></div>
            <div><span className="v">{fmtCount(answer.result.matchedRows)}</span><span className="k">Payments</span></div>
            {answer.result.concentration ? (
              <div><span className="v">{fmtPercent(answer.result.concentration)}</span><span className="k">Top share</span></div>
            ) : null}
          </div>
          <div className="ac-chart">
            <ResultChart result={answer.result} />
          </div>
        </aside>
      )}

      {error && <div className="stage-error">{error}</div>}

      {/* bottom ask bar */}
      <div className="askbar-wrap">
        <form
          className="askbar-pill"
          onSubmit={(e) => { e.preventDefault(); runAsk(q); }}
        >
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask the ledger — e.g. who got paid the most in 2022?"
            autoFocus
          />
          <button type="submit" disabled={loading}>{loading ? "…" : "Ask"}</button>
        </form>
        <div className="askbar-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => { setQ(ex); runAsk(ex); }}>{ex}</button>
          ))}
        </div>

        <div className="legend">
          <div className="legend-line">
            <span className="lg-key"><i style={{ background: NODE_COLOR.agency }} /> Agency</span>
            <span className="lg-key"><i style={{ background: NODE_COLOR.vendor }} /> Vendor</span>
          </div>
          <div className="legend-line">
            {Object.entries(CATEGORY_COLOR)
              .filter(([k]) => !k.includes("Reimbursement"))
              .map(([k, c]) => (
                <span className="lg-key" key={k}><i style={{ background: c }} /> {shortCat(k)}</span>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function shortCat(k: string): string {
  return k
    .replace("Grants, Benefits & Client Services", "Grants & Benefits")
    .replace("Personal Service Contracts", "Service Contracts")
    .replace("Cost Of Goods Sold", "Cost of Goods");
}
