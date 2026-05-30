// Loads the converted dataset into memory once at server boot (Option C — see SPEC.md §11/12).
// The .xlsx remains the source of truth; data/dataset.json is a derived cache built by
// scripts/convert_data.py.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Dataset } from "../shared/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, "../data/dataset.json");

let cached: Dataset | null = null;

export function loadDataset(): Dataset {
  if (cached) return cached;
  const t0 = Date.now();
  const raw = readFileSync(DATA_PATH, "utf-8");
  cached = JSON.parse(raw) as Dataset;
  const ms = Date.now() - t0;
  console.log(
    `[data] loaded ${cached.meta.rowCount.toLocaleString()} rows ` +
      `(${cached.meta.vendorCount.toLocaleString()} vendors, ${cached.meta.agencyCount} agencies) in ${ms}ms`,
  );
  return cached;
}

/** Small, safe summary for priming the AI / UI without shipping the whole dataset. */
export function datasetFacts(ds: Dataset) {
  return {
    fiscalYears: ds.meta.fiscalYears,
    categories: Object.values(ds.objectToCategory).sort(),
    agencyCount: ds.meta.agencyCount,
    vendorCount: ds.meta.vendorCount,
    rowCount: ds.meta.rowCount,
  };
}
