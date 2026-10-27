/**
 * Knowledge-graph view: positioned nodes with logos, utilization rings and badges,
 * typed edges (animated while work is in flight), hover neighborhoods, selection,
 * drag to pan, ⌘/Ctrl + scroll or pinch to zoom, and fit-to-view.
 *
 * Layout runs once per graph structure (layoutKey); live metrics only re-render
 * node decorations. Panning and zooming write the transform straight to the DOM.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asset } from '../../app/env';
import { CATALOG_BY_ID } from '../../data/catalog';
import { IconExpand } from '../../ui/icons';
import { cx } from '../../ui/kit';
import { bounds, forceLayout, ForceLink, ForceNode, levelsOf, Positioned, radialTree } from './force';

export type GNodeKind = 'session' | 'agent' | 'integration' | 'cluster' | 'service';
export type GTone = 'accent' | 'ok' | 'warn' | 'danger' | 'idle' | 'neutral' | 'info';

export type GNode = {
  id: string;
  kind: GNodeKind;
  label: string;
  sub?: string;
  /** Catalog id for a logo, or "martian". */
  logo?: string;
  r: number;
  ring?: number;
  group?: string;
  tone?: GTone;
  /** 0..100 utilization ring. */
  util?: number | null;
  badge?: number;
  pulse?: boolean;
  glyph?: string;
  /** Tree parent for the radial layout. */
  parent?: string;
};

export type GEdge = { from: string; to: string; kind: 'contains' | 'depends' | 'replicates' | 'calls' | 'handoff'; weight?: number; active?: boolean };

const TONE: Record<GTone, string> = {
  accent: 'rgb(var(--c-accent))', ok: 'rgb(var(--c-ok))', warn: 'rgb(var(--c-warn))', danger: 'rgb(var(--c-danger))',
  idle: 'rgb(var(--c-idle))', neutral: 'rgb(var(--c-line-strong))', info: 'rgb(var(--c-info))',
};

type View = { x: number; y: number; k: number };

function arc(r: number, pct: number) {
  const p = Math.max(0, Math.min(99.9, pct)) / 100;
  const a = p * Math.PI * 2 - Math.PI / 2;
  const x = Math.cos(a) * r;
  const y = Math.sin(a) * r;
  return `M 0 ${-r} A ${r} ${r} 0 ${p > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
}

const NodeShape = memo(function NodeShape({ n, selected, dim, hot, show, outward, onEnter, onLeave, onClick }: {
  n: GNode; selected: boolean; dim: boolean; hot: boolean; show: boolean; outward?: number;
  onEnter: (id: string) => void; onLeave: () => void; onClick: (id: string) => void;
}) {
  const tone = TONE[n.tone ?? 'neutral'];
  const logo = n.logo === 'martian' ? asset('martian-logo.png') : n.logo ? (CATALOG_BY_ID[n.logo]?.logo ? asset(CATALOG_BY_ID[n.logo]!.logo!) : null) : null;
  const inner = n.r * 1.15;
  return (
    <g
      role="button"
      tabIndex={0}
      data-cursor-label="Open"
      aria-label={`${n.label}${n.sub ? `, ${n.sub}` : ''}`}
      className={cx('cursor-pointer outline-none transition-opacity duration-200', dim && 'opacity-25', show && 'fg-show')}
      onMouseEnter={() => onEnter(n.id)}
      onMouseLeave={onLeave}
      onFocus={() => onEnter(n.id)}
      onBlur={onLeave}
      onClick={(e) => { e.stopPropagation(); onClick(n.id); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(n.id); } }}
    >
      {n.pulse && <circle r={n.r + 6} fill="none" stroke={tone} strokeWidth={2} className="animate-fg-pulse" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />}
      {(selected || hot) && <circle r={n.r + 5} fill="none" stroke="rgb(var(--c-accent))" strokeWidth={selected ? 2.5 : 1.5} opacity={selected ? 1 : 0.6} />}
      <circle
        r={n.r}
        fill={n.kind === 'session' ? 'rgb(var(--c-ink))' : n.kind === 'integration' ? '#fff' : 'rgb(var(--c-surface))'}
        stroke={n.kind === 'integration' ? 'rgb(var(--c-line))' : tone}
        strokeWidth={n.kind === 'cluster' ? 2.2 : 1.6}
      />
      {n.util != null && n.kind === 'service' && (
        <>
          <circle r={n.r - 3.5} fill="none" stroke="rgb(var(--c-line-soft))" strokeWidth={3} />
          <path d={arc(n.r - 3.5, n.util)} fill="none" stroke={tone} strokeWidth={3} strokeLinecap="round" />
        </>
      )}
      {logo ? (
        n.logo === 'martian'
          ? (
            <>
              <clipPath id={`clip-${n.id.replace(/[^\w-]/g, '_')}`}><circle r={n.r - 1.5} /></clipPath>
              <image href={logo} x={-n.r * 1.5} y={-n.r * 1.5} width={n.r * 3} height={n.r * 3} clipPath={`url(#clip-${n.id.replace(/[^\w-]/g, '_')})`} />
            </>
          )
          : <image href={logo} x={-inner / 2} y={-inner / 2} width={inner} height={inner} preserveAspectRatio="xMidYMid meet" />
      ) : (
        <text textAnchor="middle" dominantBaseline="central" className="select-none fill-fg font-mono" style={{ fontSize: Math.max(9, n.r * 0.55), fontWeight: 600 }}>
          {n.glyph ?? n.label.slice(0, 2).toUpperCase()}
        </text>
      )}
      {!!n.badge && (
        <g transform={`translate(${n.r * 0.72}, ${-n.r * 0.72})`}>
          <circle r={8.5} fill="rgb(var(--c-accent))" stroke="rgb(var(--c-surface))" strokeWidth={2} />
          <text textAnchor="middle" dominantBaseline="central" fill="#fff" style={{ fontSize: 9.5, fontWeight: 700 }}>{n.badge > 9 ? '9+' : n.badge}</text>
        </g>
      )}
      {(() => {
        const minor = n.kind === 'service';
        const label = n.label.length > 28 ? `${n.label.slice(0, 26)}…` : n.label;
        const halo = { paintOrder: 'stroke' as const, stroke: 'rgb(var(--c-canvas))', strokeWidth: 4, strokeLinejoin: 'round' as const };
        if (outward != null) {
          // Outer ring: labels point away from the centre so neighbours don't collide.
          const c = Math.cos(outward);
          const sn = Math.sin(outward);
          const d = n.r + 7;
          const anchor = c > 0.35 ? 'start' : c < -0.35 ? 'end' : 'middle';
          const x = c * d;
          const y = sn * d + (Math.abs(c) <= 0.35 ? (sn > 0 ? 8 : -6) : 0);
          return (
            <g className={cx(minor && 'fg-minor')}>
              <text x={x} y={y} textAnchor={anchor} dominantBaseline="central" className="pointer-events-none select-none fill-fg" style={{ fontSize: 11.5, fontWeight: 500, ...halo }}>{label}</text>
              {n.sub && <text x={x} y={y + 13} textAnchor={anchor} dominantBaseline="central" className="pointer-events-none select-none fill-fg-faint font-mono" style={{ fontSize: 10, ...halo }}>{n.sub}</text>}
            </g>
          );
        }
        return (
          <g className={cx(minor && 'fg-minor')}>
            <text y={n.r + 15} textAnchor="middle" className="pointer-events-none select-none fill-fg" style={{ fontSize: n.kind === 'cluster' || n.kind === 'session' ? 12.5 : 11.5, fontWeight: n.kind === 'service' ? 500 : 600, ...halo }}>
              {label}
            </text>
            {n.sub && (
              <text y={n.r + 29} textAnchor="middle" className="pointer-events-none select-none fill-fg-faint font-mono" style={{ fontSize: 10, ...halo }}>
                {n.sub}
              </text>
            )}
          </g>
        );
      })()}
    </g>
  );
});

export function ForceGraph({
  nodes, edges, layoutKey, selected, onSelect, highlight, height = 520, ariaLabel, layout, className, toolbar, onExpand,
}: {
  nodes: GNode[]; edges: GEdge[]; layoutKey: string; selected?: string | null; onSelect?: (id: string | null) => void;
  highlight?: Set<string> | null; height?: number | string; ariaLabel: string; className?: string; toolbar?: React.ReactNode;
  /** Shows an Expand button that opens the graph full screen. */
  onExpand?: () => void;
  layout?: { mode?: 'force' | 'radial'; stretch?: number; hideMinorBelow?: number; minRadius?: number; ringStrength?: number; charge?: number; groupStrength?: number; iterations?: number; gap?: number; step?: number; lengths?: Partial<Record<GEdge['kind'], number>> };
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const g = useRef<SVGGElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const hideBelow = layout?.hideMinorBelow ?? 0;
  const [hover, setHover] = useState<string | null>(null);

  // Layout once per structure.
  const radial = layout?.mode === 'radial';
  const { pos, angle, outer } = useMemo(() => {
    if (radial) {
      const tn = nodes.map((n) => ({ id: n.id, r: n.r, level: 0, parent: n.parent }));
      const lv = levelsOf(tn);
      const res = radialTree(tn, { gap: layout?.gap, step: layout?.step, minRadius: layout?.minRadius });
      // Wide containers: spread the circle into an ellipse.
      const k = layout?.stretch ?? 1;
      if (k !== 1) for (const id in res.pos) res.pos[id] = { x: res.pos[id].x * k, y: res.pos[id].y };
      const maxL = Math.max(0, ...lv.values());
      return { pos: res.pos, angle: res.angle, outer: new Set(nodes.filter((n) => (lv.get(n.id) ?? 0) === maxL && maxL > 0).map((n) => n.id)) };
    }
    const L = { contains: 110, depends: 210, replicates: 230, calls: 150, handoff: 120, ...(layout?.lengths ?? {}) };
    const fn: ForceNode[] = nodes.map((n) => ({ id: n.id, r: n.r, ring: n.ring, group: n.group }));
    const fl: ForceLink[] = edges.map((e) => ({ source: e.from, target: e.to, length: L[e.kind], strength: e.kind === 'depends' || e.kind === 'replicates' ? 0.015 : e.kind === 'handoff' ? 0.01 : 0.07 }));
    return { pos: forceLayout(fn, fl, layout) as Positioned, angle: {} as Record<string, number>, outer: new Set<string>() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  const apply = useCallback(() => {
    const v = view.current;
    g.current?.setAttribute('transform', `translate(${v.x.toFixed(1)} ${v.y.toFixed(1)}) scale(${v.k.toFixed(4)})`);
    // Zoomed far out, minor labels hide until hovered (semantic zoom).
    if (wrap.current) { if (hideBelow && v.k < hideBelow) wrap.current.dataset.far = ''; else delete wrap.current.dataset.far; }
  }, [hideBelow]);

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    // Radial labels point outward, so leave more room left and right than above and below.
    const b = radial ? bounds(pos, 130, 56) : bounds(pos, 70);
    const w = el.clientWidth;
    const h = el.clientHeight;
    const k = Math.max(0.25, Math.min(1.35, Math.min(w / b.w, h / b.h)));
    view.current = { k, x: w / 2 - (b.x + b.w / 2) * k, y: h / 2 - (b.y + b.h / 2) * k };
    apply();
  }, [pos, apply, radial]);

  useEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    const v = view.current;
    const k = Math.max(0.2, Math.min(3.2, v.k * factor));
    const f = k / v.k;
    view.current = { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    apply();
  }, [apply]);

  // ⌘/Ctrl + wheel (and trackpad pinch) zooms; a plain wheel keeps scrolling the page.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('[role="button"]')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    view.current = { ...view.current, x: d.vx + dx, y: d.vy + dy };
    apply();
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onSelect?.(null);
  };

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!m.has(e.from)) m.set(e.from, new Set());
      if (!m.has(e.to)) m.set(e.to, new Set());
      m.get(e.from)!.add(e.to);
      m.get(e.to)!.add(e.from);
    }
    return m;
  }, [edges]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const focus = hover ?? selected ?? null;
  const near = focus ? new Set([focus, ...(neighbors.get(focus) ?? [])]) : null;
  const onEnter = useCallback((id: string) => setHover(id), []);
  const onLeave = useCallback(() => setHover(null), []);
  const onClick = useCallback((id: string) => onSelect?.(id), [onSelect]);

  return (
    <div ref={wrap} data-cursor="Drag" className={cx('relative overflow-hidden rounded-xl border border-line bg-canvas', className)} style={{ height }}>
      <svg
        role="img"
        aria-label={ariaLabel}
        className="block h-full w-full touch-none select-none [background-image:radial-gradient(rgb(var(--c-line))_1px,transparent_1px)] [background-size:22px_22px]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={(e) => { const r = wrap.current!.getBoundingClientRect(); zoomAt(1.5, e.clientX - r.left, e.clientY - r.top); }}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(var(--c-accent))" opacity="0.7" />
          </marker>
        </defs>
        <g ref={g}>
          {edges.map((e, i) => {
            const a = pos[e.from];
            const b = pos[e.to];
            if (!a || !b) return null;
            const nb = byId.get(e.to);
            const na = byId.get(e.from);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            const ax = a.x + (dx / d) * (na?.r ?? 0);
            const ay = a.y + (dy / d) * (na?.r ?? 0);
            const bx = b.x - (dx / d) * ((nb?.r ?? 0) + 4);
            const by = b.y - (dy / d) * ((nb?.r ?? 0) + 4);
            const tree = radial && (byId.get(e.to)?.parent === e.from || byId.get(e.from)?.parent === e.to);
            const curved = radial ? !tree : e.kind !== 'contains';
            // Radial: cross links bend toward the centre, like bundled edges.
            const mx = radial ? ((ax + bx) / 2) * 0.42 : (ax + bx) / 2 - (dy / d) * (curved ? d * 0.12 : 0);
            const my = radial ? ((ay + by) / 2) * 0.42 : (ay + by) / 2 + (dx / d) * (curved ? d * 0.12 : 0);
            const path = curved ? `M${ax} ${ay} Q${mx} ${my} ${bx} ${by}` : `M${ax} ${ay} L${bx} ${by}`;
            const dimmed = near && !(near.has(e.from) && near.has(e.to));
            const lit = !!near && !dimmed;
            const accent = e.kind === 'depends' || e.kind === 'calls' || e.kind === 'replicates';
            return (
              <path
                key={`${e.from}-${e.to}-${i}`}
                d={path}
                fill="none"
                stroke={accent ? 'rgb(var(--c-accent))' : 'rgb(var(--c-line-strong))'}
                strokeOpacity={dimmed ? 0.08 : lit ? 0.95 : accent ? 0.45 : 0.75}
                strokeWidth={Math.min(5, 1.1 + (e.weight ?? 1) * 0.45) * (lit ? 1.3 : 1)}
                strokeDasharray={e.active || e.kind === 'replicates' ? '6 6' : e.kind === 'handoff' ? '2 5' : undefined}
                className={cx(e.active && 'animate-flow')}
                markerEnd={e.kind === 'depends' || e.kind === 'calls' ? 'url(#arrow)' : undefined}
              />
            );
          })}
          {nodes.map((n) => {
            const p = pos[n.id];
            if (!p) return null;
            const dim = (!!near && !near.has(n.id)) || (!!highlight && highlight.size > 0 && !highlight.has(n.id));
            return (
              <g key={n.id} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
                <NodeShape
                  n={n} selected={selected === n.id} dim={dim} hot={!!highlight?.has(n.id)}
                  show={selected === n.id || (!!near && near.has(n.id)) || (!!highlight && highlight.has(n.id))}
                  outward={outer.has(n.id) ? angle[n.id] : undefined}
                  onEnter={onEnter} onLeave={onLeave} onClick={onClick}
                />
              </g>
            );
          })}
        </g>
      </svg>
      <div data-cursor-off className="absolute right-3 top-3 flex items-center gap-1 rounded-lg border border-line bg-surface p-1 shadow-tab">
        {toolbar}
        {onExpand && (
          <button type="button" aria-label="Open full screen" title="Full screen" onClick={onExpand} className="ix-btn flex h-8 w-8 items-center justify-center rounded-md border border-transparent bg-transparent text-fg-body">
            <IconExpand size={15} />
          </button>
        )}
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.25, (wrap.current?.clientWidth ?? 0) / 2, (wrap.current?.clientHeight ?? 0) / 2)} className="ix-btn flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-fg-body hover:bg-chip">+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(0.8, (wrap.current?.clientWidth ?? 0) / 2, (wrap.current?.clientHeight ?? 0) / 2)} className="ix-btn flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-fg-body hover:bg-chip">−</button>
        <button type="button" onClick={fit} className="ix-btn h-8 rounded-md border-0 bg-transparent px-2 text-xs font-medium text-fg-body hover:bg-chip">Fit</button>
      </div>
      <p className="pointer-events-none absolute bottom-2.5 left-3 m-0 text-11 text-fg-faint">Drag to move · ⌘ or Ctrl + scroll to zoom · click a node for details</p>
    </div>
  );
}
