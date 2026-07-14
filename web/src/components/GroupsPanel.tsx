import { useEffect, useMemo, useState } from "react";
import { searchEntities, type AgencyGroup, type SearchHit } from "../api";
import { fmtCurrencyCompact } from "../../../shared/format";

// Build named groups of agencies. Each agency belongs to at most one group — already-assigned
// agencies are hidden from the search results, so membership is unambiguous by construction.
// The group array is the source of truth for "how many groups exist"; see AGENCY_GROUPS.md.

let seq = 0;
const newId = () => `g${Date.now().toString(36)}${(seq++).toString(36)}`;

export function GroupsPanel({
  groups,
  onChange,
  onClose,
}: {
  groups: AgencyGroup[];
  onChange: (g: AgencyGroup[]) => void;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(groups[0]?.id ?? null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  const assigned = useMemo(() => new Set(groups.flatMap((g) => g.agencies)), [groups]);
  const editing = groups.find((g) => g.id === editingId) ?? null;

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const res = q ? await searchEntities(q, "agency").catch(() => []) : [];
      if (alive) setHits(res);
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  function addGroup() {
    const g: AgencyGroup = { id: newId(), name: `Group ${groups.length + 1}`, agencies: [] };
    onChange([...groups, g]);
    setEditingId(g.id);
    setQ("");
  }
  const rename = (id: string, name: string) => onChange(groups.map((g) => (g.id === id ? { ...g, name } : g)));
  function remove(id: string) {
    onChange(groups.filter((g) => g.id !== id));
    if (editingId === id) setEditingId(null);
  }
  function addAgency(name: string) {
    if (!editing || assigned.has(name)) return; // single membership
    onChange(groups.map((g) => (g.id === editing.id ? { ...g, agencies: [...g.agencies, name] } : g)));
  }
  function removeAgency(name: string) {
    if (!editing) return;
    onChange(groups.map((g) => (g.id === editing.id ? { ...g, agencies: g.agencies.filter((a) => a !== name) } : g)));
  }

  const available = hits.filter((h) => !assigned.has(h.name)); // enforce single membership in the picker

  return (
    <aside className="groups-panel">
      <div className="gp-head">
        <span className="eyebrow">Agency groups</span>
        <button className="gp-close" onClick={onClose}>Done</button>
      </div>

      <ul className="gp-list">
        {groups.map((g) => (
          <li key={g.id} className={g.id === editingId ? "on" : ""}>
            <button className="gp-select" onClick={() => setEditingId(g.id)}>
              <span className="gp-ring" /> <span className="gp-nm">{g.name}</span>
              <span className="gp-count">{g.agencies.length}</span>
            </button>
            <button className="gp-del" title="Delete group" onClick={() => remove(g.id)}>×</button>
          </li>
        ))}
        {groups.length === 0 && <li className="gp-hint">No groups yet. Create one to bundle agencies.</li>}
      </ul>
      <button className="gp-add" onClick={addGroup}>+ New group</button>

      {editing && (
        <div className="gp-edit">
          <input
            className="gp-name"
            value={editing.name}
            onChange={(e) => rename(editing.id, e.target.value)}
            aria-label="Group name"
          />
          <div className="gp-chips">
            {editing.agencies.map((a) => (
              <span key={a} className="gp-chip">
                {a}
                <button onClick={() => removeAgency(a)} title="Remove">×</button>
              </span>
            ))}
            {editing.agencies.length === 0 && <span className="gp-empty">No agencies yet — search below.</span>}
          </div>
          <input
            className="gp-search"
            value={q}
            placeholder="Search an agency to add…"
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <ul className="gp-suggest">
              {available.length === 0 && <li className="gp-none">No unassigned agencies match.</li>}
              {available.slice(0, 8).map((h) => (
                <li key={h.name} onMouseDown={(e) => { e.preventDefault(); addAgency(h.name); }}>
                  <span className="nm">{h.name}</span>
                  <span className="tot">{fmtCurrencyCompact(h.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
