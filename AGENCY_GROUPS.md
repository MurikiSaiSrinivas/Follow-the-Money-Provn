# Agency Groups — design & implementation plan

Status: **proposed** (not yet implemented). Branch: `feature/new-feature`.

## 1. Goal

Let a journalist bundle several agencies into a named **group** and treat that group as a
single "super-agency." Once groups exist:

- an agency-level answer **labels grouped agencies by their group name**, shown mixed with the
  ungrouped agencies (e.g. `Universities`, `Health cluster`, `Dept of Transportation`, …);
- the money map **collapses** each group's member agencies into one node (same agency color,
  distinguished only by a ring);
- a **scope selector** (`All · Group 1 · Group 2 · …`) lets the user point a question at one
  group; the map transitions to that group's neighborhood.

Each agency belongs to **at most one group**. Multiple groups are supported and are the whole
point of the feature.

## 2. Design principles we keep

These are the existing invariants (see `SYSTEM_DESIGN.md`) and the feature must not break them:

1. **One engine, two entry points.** Groups are applied inside `runQuery` and the graph
   builders, so both the AI path (`/api/ask`) and the manual path (`/api/query`) honor them for
   free.
2. **The AI never computes numbers** — and for this feature, **the AI is not changed at all.**
   Grouping is a deterministic relabel/filter lens driven entirely by code and the UI. This means
   zero hallucination risk and identical behavior with or without an API key.
3. **Graceful with no key.** Because the AI is untouched, the fallback parser keeps working
   unchanged.

## 3. The two behaviors (mental model)

Groups drive **two independent** behaviors, both computed by our code:

| Behavior | Trigger | What it does |
|---|---|---|
| **Relabel lens** | any groups defined | Wherever an agency name becomes a label or a graph node, map it to its group name if grouped, else leave it as-is. Grouped agencies collapse; ungrouped stay individual (the "mixed" result). Always on. |
| **Scope filter** | scope chip ≠ `All` | Restrict all rows to the selected group's member agencies, and focus the map on that group. |

The scope selector does double duty: `All` = relabel lens only, no filter; `Group N` = filter to
that group **and** focus the view on it.

## 4. Data model

A group is client-owned state, sent to the server with every request. Nothing is persisted
server-side.

```ts
// shared/types.ts  (new)
export interface AgencyGroup {
  id: string;         // stable client id, e.g. "g1"
  name: string;       // display label, default "Group 1", user-renameable
  agencies: string[]; // canonical agency names (exact strings from ds.dims.agencies)
}

// The grouping context threaded alongside a Query.
export interface GraphContext {
  groups?: AgencyGroup[];
  scope?: string | null;   // group id in scope, or null/undefined = "All"
}
```

A group **node** on the map is NOT a new node type — it stays `type: "agency"` so the color is
unchanged. We add one flag:

```ts
export interface GraphNode {
  id: string;
  name: string;          // the group name when isGroup
  type: NodeType;        // "agency" for a group super-node
  value: number;
  focus?: boolean;
  isGroup?: boolean;     // NEW — draw a ring, tooltip shows member count
}
```

### 4a. How groups are created and stored (the part to get right)

**Storage.** An ordered `AgencyGroup[]` lives in React state in `App.tsx`, mirrored to
`localStorage` so groups survive a refresh. The array *is* the source of truth for "how many
groups exist" — supporting N groups is just supporting an array of length N.

**Creating multiple groups.** In the group-builder panel:

1. "New group" appends an empty `AgencyGroup` (`{ id: "g"+n, name: "Group "+n, agencies: [] }`).
2. The user searches the full agency list (reusing the existing `/api/search?type=agency`
   endpoint) and clicks agencies to add them to the *currently-edited* group.
3. "New group" again creates Group 2, and so on — the array grows. The scope chip row and every
   downstream relabel automatically reflect all groups because they read the array.

**Single-membership enforcement (client-side, by construction).** Derive one set:

```ts
const assigned = new Set(groups.flatMap(g => g.agencies));
```

The builder's agency picker hides / disables any agency already in `assigned` (optionally with a
"move here" affordance that removes it from its old group first). Because the picker can't add an
already-assigned agency, the `agency → group` map the engine builds is always unambiguous.

**Deriving the lookup (server + graph).** From the array, build once per request:

```ts
const agencyToGroup = new Map<string, string>();      // agencyName -> group NAME
for (const g of groups ?? [])
  for (const a of g.agencies)
    if (!agencyToGroup.has(a)) agencyToGroup.set(a, g.name);  // first wins (defensive)
```

`scope` (a group id) resolves to that group's `agencies` array for the filter.

## 5. Request / response contract

The request body carries the grouping context next to the question/query. Response shapes are
unchanged except graph nodes may now carry `isGroup`.

```
POST /api/ask     { question, groups?, scope? }
POST /api/query   { ...Query, groups?, scope? }        // groups/scope as sibling fields
GET  /api/overview?fiscalYear=…                          // groups/scope moved to POST body OR
GET  /api/graph?…                                        //   query params (see §7 note)
```

Note: `/api/overview` and `/api/graph` are currently GET. Because groups can be large, we switch
the map fetches to `POST` (body = `{ fiscalYear, groups, scope, … }`) rather than cramming JSON
into the query string. This is an internal API, so the change is contained to `server/index.ts`
and `web/src/api.ts`.

## 6. Server changes

### 6a. `server/engine.ts` (~15 lines)

- Build `agencyToGroup` from `context.groups`.
- **Relabel** in `keyFn` for `groupBy: "agency"`:
  `label = agencyToGroup.get(agencyName) ?? agencyName`.
- **Scope filter** in `makePredicate`: if `scope` set, resolve to the group's agency set and pass
  only rows whose agency is in that set. (Composes with the existing `filter.agency`, fiscal year,
  reimbursement filters.)
- `runQuery(ds, rawQuery, context?)` — new optional third arg; default `{}` keeps every existing
  caller working.

### 6b. `server/graph.ts` (the substantive work)

Introduce one mapper and apply it wherever an agency name becomes a node/edge key:

```ts
const displayAgency = (name: string) => agencyToGroup.get(name) ?? name;
const isGroupName   = (name: string) => groupNames.has(name);
```

- `buildOverview` — relabel the agency side of each edge through `displayAgency` before
  accumulating; grouped agencies' category edges sum into one super-node. Mark nodes `isGroup`
  when their name is a group name.
- `constellation` / `answerGraph` — same relabel; a result row whose label is a group name
  resolves to the group super-node.
- `buildFocusGraph` — new **group-drill** path: when the focus is a group (scope = Group N, or a
  click on a group super-node), iterate the group's member agencies, union their vendor edges, and
  merge into a single focus super-node (`isGroup: true, focus: true`).
- Edge keys already use `agency<SEP>vendor`; relabeling the agency half **before** `bumpEdge`
  makes the merge automatic — no change to the edge accumulator.
- Reimbursement (`S`/`T`) rows stay excluded, so transfers **between two agencies inside the same
  group** are not counted as intra-group flow. Documented, no special-casing needed.

### 6c. `server/index.ts`

- Read `groups`/`scope` from the request body on `/api/ask` and `/api/query`; pass into
  `runQuery` and `answerGraph`.
- Convert `/api/overview` and `/api/graph` to POST (or add POST variants) so they receive
  `groups`/`scope`; pass into the graph builders.

### 6d. `server/search.ts`

No change. The existing agency typeahead is exactly what the group-builder needs.

## 7. Frontend changes

### 7a. `web/src/api.ts`
- Thread `groups`/`scope` into `ask`, `fetchOverview`, `fetchGraph` request bodies.
- Add `isGroup?: boolean` to the `GraphNode` type.

### 7b. New: group-builder panel + scope chips (`App.tsx` + a new component)
- **Group builder** (collapsible panel): list/search agencies via `searchEntities(q,"agency")`,
  multiselect into the current group, single-membership enforced by hiding assigned agencies,
  rename group, delete group, "New group" to add more. Persist `groups` to `localStorage`.
- **Scope chip row**: `All · Group 1 · Group 2 · …`. Selecting a chip sets `scope`, re-runs the
  current view (overview or last question) with that scope, and shows an "Asking about: Group N"
  hint near the ask bar so the user frames questions relative to the scope (since the AI is
  group-unaware, they should not type the group name into the ask bar).
- Re-fetch overview whenever `groups` change so the map reflects new/edited groups immediately.

### 7c. `web/src/components/LedgerGraph.tsx` (the ring)
- In `nodeCanvasObject`, after drawing the pin-head, if `n.isGroup` draw a **ring** around it
  (e.g. a stroked circle at `r + 2.5/scale`, CREAM or BRASS, distinct from the solid `focus`
  stroke). Color of the node itself stays the agency color — no `NODE_COLOR`/`colorOf` change.
- Tooltip: when `node.isGroup`, show member-agency count.

### 7d. `shared/categories.ts`
No change — because a group keeps the agency color, we do **not** add a group color.

## 8. Edge cases & decisions

- **Ungrouped agencies:** shown individually alongside groups ("mixed"). No "Ungrouped" bucket.
- **Scope = Group N with an agency-axis question:** only that one group matches; the finding text
  gets a code-composed "within {group}" qualifier. Group scope pairs most naturally with
  vendor/category questions ("who does this group pay?").
- **Empty group** (no agencies yet): ignored by the engine (contributes nothing); the chip is
  disabled until it has ≥1 member.
- **Agency name drift:** groups store canonical `ds.dims.agencies` strings chosen from search, so
  no fuzzy resolution is needed for membership.
- **Concentration / shares:** computed after relabeling, so a group's share is the sum of its
  members' — correct by construction.

## 9. Phased implementation plan

**Phase 1 — engine + contract (server-only, curl-verifiable)**
1. `shared/types.ts`: add `AgencyGroup`, `GraphContext`, `isGroup` on `GraphNode`.
2. `server/engine.ts`: `agencyToGroup`, relabel in `keyFn`, scope filter in `makePredicate`,
   new `context` arg on `runQuery`.
3. `server/index.ts`: accept `groups`/`scope` on `/api/ask` and `/api/query`; thread through.
4. Verify with curl: post a fake 2-agency group, confirm the finding + result rows label by
   group and that scope filters correctly.

**Phase 2 — graph collapse + ring**
5. `server/graph.ts`: `displayAgency` relabel in `buildOverview`, `constellation`/`answerGraph`;
   group-drill path in `buildFocusGraph`; mark `isGroup`.
6. `server/index.ts`: POST variants of `/api/overview` and `/api/graph`, threading `groups`/`scope`.
7. `web/src/api.ts`: switch those fetches to POST; add `isGroup`.
8. `LedgerGraph.tsx`: draw the ring for `isGroup`; tooltip member count.
9. Verify: overview shows collapsed super-nodes with rings; clicking one drills into the group.

**Phase 3 — group-builder UI + scope chips**
10. New builder component: search + multiselect + single-membership + rename/delete + "New group".
11. `localStorage` persistence of `groups`.
12. Scope chip row + "Asking about" hint; re-run current view on scope/groups change.
13. End-to-end verify: create Group 1, ask; create Group 2, scope to it, ask; refresh, groups
    persist.

## 10. Out of scope (for now)

- Teaching the AI about group names (typing "compare group 1 vs group 2" in prose). The UI scope
  selector covers targeting; AI-awareness can be layered later without reworking the engine.
- Server-side persistence / sharing of groups across users.
- Nested groups or an agency in multiple groups.

## 11. File-change summary

| File | Change | Phase |
|---|---|---|
| `shared/types.ts` | `AgencyGroup`, `GraphContext`, `isGroup` | 1 |
| `server/engine.ts` | relabel + scope filter, `context` arg | 1 |
| `server/index.ts` | thread groups/scope; POST map routes | 1, 2 |
| `server/graph.ts` | `displayAgency` collapse, group-drill, `isGroup` | 2 |
| `web/src/api.ts` | POST bodies, `isGroup` type | 2 |
| `web/src/components/LedgerGraph.tsx` | ring for `isGroup`, tooltip | 2 |
| `web/src/App.tsx` + new component | group builder, scope chips, persistence | 3 |
| `shared/categories.ts` | none (color unchanged) | — |
