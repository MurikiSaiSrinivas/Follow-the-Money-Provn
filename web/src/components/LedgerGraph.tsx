import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { GraphData, GraphNode } from "../api";
import { NODE_COLOR, categoryColor } from "../../../shared/categories";
import { fmtCurrencyCompact, fmtCurrencyFull } from "../../../shared/format";

const BRASS = "#cda35a";
const CREAM = "#efe9da";
const getId = (e: any): string => (typeof e === "object" ? e.id : e);
const colorOf = (n: GraphNode) => (n.type === "category" ? categoryColor(n.name) : NODE_COLOR[n.type]);

interface Flow { in: number; out: number; deg: number }

export function LedgerGraph({
  data,
  loading,
  onNodeClick,
}: {
  data: GraphData | null;
  loading: boolean;
  onNodeClick: (n: GraphNode) => void;
}) {
  const fgRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: 0, y: 0 });
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [dims, setDims] = useState({ w: 1000, h: 700 });

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((e) => {
      const r = e[0].contentRect;
      setDims({ w: Math.max(320, r.width), h: Math.max(360, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const flow = useMemo(() => {
    const m = new Map<string, Flow>();
    const g = (id: string) => m.get(id) ?? (m.set(id, { in: 0, out: 0, deg: 0 }).get(id) as Flow);
    data?.links.forEach((l) => {
      const s = getId(l.source);
      const t = getId(l.target);
      g(s).out += l.value;
      g(s).deg++;
      g(t).in += l.value;
      g(t).deg++;
    });
    return m;
  }, [data]);

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    data?.links.forEach((l) => {
      const a = getId(l.source);
      const b = getId(l.target);
      (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
      (m.get(b) ?? m.set(b, new Set()).get(b)!).add(a);
    });
    return m;
  }, [data]);

  const graphData = useMemo(
    () => (data ? { nodes: data.nodes.map((n) => ({ ...n })), links: data.links.map((l) => ({ ...l })) } : { nodes: [], links: [] }),
    [data],
  );
  const maxLink = useMemo(() => Math.max(1, ...(data?.links.map((l) => l.value) ?? [1])), [data]);
  const nodeCount = data?.nodes.length ?? 0;

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !data) return;
    fg.d3Force("charge")?.strength(nodeCount > 60 ? -90 : -170).distanceMax(420);
    fg.d3Force("link")?.distance((l: any) => 50 + 55 * (1 - Math.sqrt(l.value / maxLink)));
    fg.d3ReheatSimulation?.();
  }, [data, maxLink, nodeCount]);

  // uniform pin-heads (focus a touch larger); category hubs always labelled
  const radiusOf = (n: GraphNode) => (n.focus ? 7 : 4.5);
  const isDimmed = (id: string) =>
    hoverNode ? id !== hoverNode.id && !(neighbors.get(hoverNode.id)?.has(id) ?? false) : false;
  const edgeColor = (l: any) => categoryColor(l.category);

  return (
    <div
      className="lg-canvas"
      ref={wrapRef}
      onMouseMove={(e) => {
        const r = wrapRef.current!.getBoundingClientRect();
        mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (hoverNode) setTip({ ...mouse.current });
      }}
    >
      <ForceGraph2D
        ref={fgRef}
        width={dims.w}
        height={dims.h}
        graphData={graphData}
        backgroundColor="#181610"
        cooldownTicks={nodeCount > 60 ? 90 : 140}
        onEngineStop={() => fgRef.current?.zoomToFit(500, 70)}
        nodeRelSize={1}
        nodeVal={(n: any) => Math.max(1, (radiusOf(n) * radiusOf(n)) / 4)}
        onNodeHover={(n: any) => {
          setHoverNode(n || null);
          setTip(n ? { ...mouse.current } : null);
          if (wrapRef.current) wrapRef.current.style.cursor = n && n.type !== "category" ? "pointer" : "default";
        }}
        onNodeClick={(n: any) => {
          if (n.type !== "category") onNodeClick(n);
        }}
        linkCurvature={0.12}
        linkColor={(l: any) => {
          const on = !hoverNode || getId(l.source) === hoverNode.id || getId(l.target) === hoverNode.id;
          const c = edgeColor(l);
          return on ? hexA(c, 0.85) : hexA(c, 0.12);
        }}
        linkWidth={(l: any) => 0.4 + 4 * Math.sqrt(l.value / maxLink)}
        linkDirectionalParticles={(l: any) =>
          hoverNode && (getId(l.source) === hoverNode.id || getId(l.target) === hoverNode.id) ? 4 : 0
        }
        linkDirectionalParticleWidth={(l: any) => 1.4 + 2.4 * Math.sqrt(l.value / maxLink)}
        linkDirectionalParticleSpeed={() => 0.006}
        linkDirectionalParticleColor={(l: any) => edgeColor(l)}
        nodePointerAreaPaint={(n: any, color: string, ctx: CanvasRenderingContext2D) => {
          if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x, n.y, radiusOf(n) + 4, 0, 2 * Math.PI);
          ctx.fill();
        }}
        nodeCanvasObject={(n: any, ctx: CanvasRenderingContext2D, scale: number) => {
          if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return; // positions not laid out yet
          const r = radiusOf(n);
          const dim = isDimmed(n.id);
          const col = colorOf(n);
          ctx.globalAlpha = dim ? 0.12 : 1;

          // soft halo
          const halo = ctx.createRadialGradient(n.x, n.y, r * 0.4, n.x, n.y, r * 2.6);
          halo.addColorStop(0, hexA(col, 0.5));
          halo.addColorStop(1, hexA(col, 0));
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 2.6, 0, 2 * Math.PI);
          ctx.fill();

          // pin-head
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = col;
          ctx.fill();
          if (n.focus) {
            ctx.lineWidth = 2 / scale;
            ctx.strokeStyle = BRASS;
            ctx.stroke();
          }

          const showLabel = n.focus || n.type === "category" || n.id === hoverNode?.id;
          if (showLabel && !dim) {
            const fontSize = Math.min(14, 11.5 / scale);
            ctx.font = `${n.focus || n.type === "category" ? "600 " : "400 "}${fontSize}px Spectral, Georgia, serif`;
            ctx.fillStyle = n.type === "category" ? col : CREAM;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            const label = n.name.length > 30 ? n.name.slice(0, 29) + "…" : n.name;
            ctx.fillText(label, n.x, n.y + r + 3 / scale);
          }
          ctx.globalAlpha = 1;
        }}
      />

      {loading && <div className="lg-loading">Tracing flows…</div>}
      {hoverNode && tip && <Tooltip node={hoverNode} flow={flow.get(hoverNode.id)} x={tip.x} y={tip.y} />}
    </div>
  );
}

function Tooltip({ node, flow, x, y }: { node: GraphNode; flow?: Flow; x: number; y: number }) {
  return (
    <div className="lg-tooltip" style={{ left: x + 14, top: y + 14 }}>
      <div className="tt-type">{node.type}</div>
      <div className="tt-name">{node.name}</div>
      <dl className="tt-rows num">
        {flow && flow.in > 0 && <div><dt>{node.type === "category" ? "Spent here" : "Money in"}</dt><dd>{fmtCurrencyFull(flow.in)}</dd></div>}
        {flow && flow.out > 0 && <div><dt>Money out</dt><dd>{fmtCurrencyFull(flow.out)}</dd></div>}
        {node.value > 0 && <div><dt>Total flow</dt><dd>{fmtCurrencyCompact(node.value)}</dd></div>}
        {flow && <div><dt>Connections</dt><dd>{flow.deg}</dd></div>}
      </dl>
      {node.type !== "category" && <div className="tt-hint">click to follow the money</div>}
    </div>
  );
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
