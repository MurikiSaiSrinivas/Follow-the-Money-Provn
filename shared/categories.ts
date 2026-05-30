// Shared visual vocabulary for the graph. There are exactly 9 spending categories
// (Object -> Category), so we can color edges by category with a clean legend.

export const CATEGORY_COLOR: Record<string, string> = {
  "Grants, Benefits & Client Services": "#5fb0a3", // teal
  "Goods and Services": "#d9a24e", // amber
  "Capital Outlays": "#cf7a52", // terracotta
  "Personal Service Contracts": "#9a8fc0", // lavender
  Travel: "#cf6f8f", // rose
  "Debt Service": "#6f9fcf", // blue
  "Cost Of Goods Sold": "#a9b06a", // olive
  "Interagency Reimbursements": "#8a8478", // warm grey
  "Intra-Agency Reimbursements": "#6f6a5f", // dark grey
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_COLOR);

export const FALLBACK_EDGE = "rgba(201,177,118,0.30)";

export function categoryColor(name?: string): string {
  return (name && CATEGORY_COLOR[name]) || "#b7ad97";
}

// Node colors by type — deliberately neutral so the category-colored edges carry the hue.
export const NODE_COLOR = {
  agency: "#ddd0b0", // warm sand — the actors
  vendor: "#8b93a0", // cool grey — the payees
} as const;
