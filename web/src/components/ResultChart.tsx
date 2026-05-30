import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { QueryResult } from "../../../shared/types";
import { fmtCurrencyCompact, fmtCurrencyFull, fmtFiscalMonth } from "../../../shared/format";

const INK = "#221f18";
const BRASS = "#9c7a3c";
const RULE = "#d9d1be";

export function ResultChart({ result }: { result: QueryResult }) {
  if (result.chart === "line") return <TrendLine result={result} />;
  return <LedgerRows result={result} />;
}

// ---- Ranking → an elegant ledger (name · hairline bar · right-aligned figure) ----
function LedgerRows({ result }: { result: QueryResult }) {
  const isCurrency = result.metric !== "count";
  const max = Math.max(...result.rows.map((r) => r.value), 1);
  const fmtVal = (v: number) => (isCurrency ? fmtCurrencyCompact(v) : v.toLocaleString());

  return (
    <div className="ledger-rows num">
      <div className="lr-caption">
        {result.metric === "avg" ? "Average payment" : result.metric === "count" ? "Number of payments" : "Total paid"}
        {" — ranked"}
      </div>
      {result.rows.map((r, i) => {
        const others = r.label === "All others";
        const lead = i === 0 && !others;
        return (
          <div className={`ledger-row${lead ? " lead" : ""}${others ? " others" : ""}`} key={r.label}>
            <span className="rank">{others ? "" : String(i + 1).padStart(2, "0")}</span>
            <div className="body">
              <span className="name" title={r.label}>{labelOf(result, r.label)}</span>
              <div className="track">
                <div
                  className="fill"
                  style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, animationDelay: `${i * 55}ms` }}
                />
              </div>
            </div>
            <div className="figure">
              <span className="amt">{fmtVal(r.value)}</span>
              {isCurrency && <span className="pct">{r.share.toFixed(1)}%</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Trend → restrained ink line on hairline grid ----
function TrendLine({ result }: { result: QueryResult }) {
  const isCurrency = result.metric !== "count";
  const data = result.rows.map((r) => ({
    label: result.groupBy === "fiscalMonth" ? fmtFiscalMonth(Number(r.label)) : `FY ${r.label}`,
    value: r.value,
  }));
  const fmtVal = (v: number) => (isCurrency ? fmtCurrencyCompact(v) : v.toLocaleString());

  return (
    <div className="trend-wrap num">
      <div className="lr-caption">{result.groupBy === "fiscalMonth" ? "By fiscal month" : "Year over year"}</div>
      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 10, right: 28, bottom: 4, left: 6 }}>
            <CartesianGrid stroke={RULE} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 13, fill: INK, fontFamily: "Spectral, serif" }}
              axisLine={{ stroke: INK }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={fmtVal}
              width={64}
              tick={{ fontSize: 12, fill: "#5c564a", fontFamily: "Spectral, serif" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(v: number) => (isCurrency ? fmtCurrencyFull(v) : v.toLocaleString())}
              contentStyle={{
                background: "#fbf8f1",
                border: "1px solid #d9d1be",
                borderRadius: 0,
                fontFamily: "Spectral, serif",
                fontSize: 13,
              }}
            />
            <Line type="monotone" dataKey="value" stroke={BRASS} strokeWidth={2} dot={{ r: 3, fill: INK, stroke: INK }} activeDot={{ r: 5, fill: BRASS }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function labelOf(result: QueryResult, raw: string): string {
  if (result.groupBy === "fiscalMonth") return `Month ${raw}`;
  if (result.groupBy === "fiscalYear") return `FY ${raw}`;
  return raw;
}
