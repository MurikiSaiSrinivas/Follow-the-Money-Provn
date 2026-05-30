// Display formatters for the investigative-journalist persona.
// Definitions come straight from METRICS_AND_FORMATS.md §B. Both the chart, the KPIs, and
// the AI prose use these so numbers never look different across views.

/** Compact currency for charts/headlines/KPIs: $9.8B, $456M, $890K, $42. */
export function fmtCurrencyCompact(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

/** Full currency for detail/tooltips: $9,806,781,735 (cents dropped at/above $1,000). */
export function fmtCurrencyFull(n: number): string {
  const abs = Math.abs(n);
  const opts: Intl.NumberFormatOptions =
    abs >= 1000
      ? { maximumFractionDigits: 0 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", ...opts }).format(n);
}

/** Percentage, 1 decimal: 40.2%. */
export function fmtPercent(n: number): string {
  return `${n.toFixed(1)}%`;
}

/** Year-over-year change with neutral arrow (no green/red — "up" spending isn't "good"). */
export function fmtYoY(pct: number | "new" | "n/a"): string {
  if (pct === "new") return "new";
  if (pct === "n/a") return "n/a";
  const arrow = pct >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(pct).toFixed(0)}%`;
}

/** Fiscal year label: FY 2022. */
export function fmtFiscalYear(fy: string): string {
  return `FY ${fy}`;
}

/** Integer with thousands separators: 935,853. */
export function fmtCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/**
 * Fiscal month (1..24 continuous across the biennium) -> readable calendar-ish label.
 * WA fiscal year starts in July, so fiscal month 1 = July. See DATA_DICTIONARY.md.
 */
const FY_MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
export function fmtFiscalMonth(fmonth: number): string {
  const idx = ((fmonth - 1) % 12 + 12) % 12;
  return FY_MONTHS[idx];
}
