import { useEffect, useRef, useState } from "react";
import { searchEntities, type SearchHit } from "../api";
import { fmtCurrencyCompact } from "../../../shared/format";

// Typeahead to pick a focus vendor or agency for the Money Map. Ranked by total dollars.
export function SearchBox({
  typeFilter,
  onPick,
}: {
  typeFilter: "vendor" | "agency" | "all";
  onPick: (hit: SearchHit) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const res = await searchEntities(q, typeFilter).catch(() => []);
      if (alive) {
        setHits(res);
        setActive(0);
      }
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, typeFilter]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(h: SearchHit) {
    onPick(h);
    setQ(h.name);
    setOpen(false);
  }

  return (
    <div className="searchbox" ref={boxRef}>
      <input
        value={q}
        placeholder="Search a vendor or agency…"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && hits[active]) choose(hits[active]);
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && hits.length > 0 && (
        <ul className="suggest">
          {hits.map((h, i) => (
            <li
              key={`${h.type}:${h.name}`}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(h);
              }}
            >
              <span className={`pill ${h.type}`}>{h.type}</span>
              <span className="nm">{h.name}</span>
              <span className="tot">{fmtCurrencyCompact(h.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
