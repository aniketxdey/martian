/**
 * Turn domain data into ForceGraph nodes and edges: the infrastructure map
 * (integrations → clusters → services, plus dependencies) and the per-session map
 * (session → agents → integrations → the clusters and services they touched).
 */
import { CATALOG_BY_ID } from '../../data/catalog';
import type { AgentSession, Env, InfraGraph, InfraNode, NodeStatus } from '../../state/types';
import type { GEdge, GNode, GTone } from './ForceGraph';

const STATUS_TONE: Record<NodeStatus, GTone> = { healthy: 'ok', idle: 'idle', hot: 'warn', degraded: 'danger' };

export type InfraFilter = { env: 'all' | Env; q: string };

/** Nodes matching the search, plus everything on their path to an integration. */
export function infraMatches(g: InfraGraph, q: string): Set<string> | null {
  const qq = q.trim().toLowerCase();
  if (!qq) return null;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const hit = new Set<string>();
  for (const n of g.nodes) {
    const text = `${n.label} ${n.location ?? ''} ${n.type ?? ''} ${(n.tags ?? []).join(' ')} ${n.integration ? CATALOG_BY_ID[n.integration]?.name ?? '' : ''}`.toLowerCase();
    if (!text.includes(qq)) continue;
    let cur: InfraNode | undefined = n;
    while (cur) { hit.add(cur.id); cur = cur.parent ? byId.get(cur.parent) : undefined; }
  }
  return hit;
}

export function infraModel(g: InfraGraph, f: InfraFilter): { nodes: GNode[]; edges: GEdge[]; layoutKey: string } {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const envOf = (n: InfraNode): Env | undefined => n.env ?? (n.parent ? envOf(byId.get(n.parent)!) : undefined);
  const keep = (n: InfraNode) => {
    if (f.env === 'all') return true;
    if (n.kind === 'integration') return g.nodes.some((c) => c.parent === n.id && envOf(c) === f.env);
    return envOf(n) === f.env;
  };
  const shown = g.nodes.filter(keep);
  const ids = new Set(shown.map((n) => n.id));

  const nodes: GNode[] = shown.map((n) => {
    if (n.kind === 'integration') {
      const c = n.integration ? CATALOG_BY_ID[n.integration] : undefined;
      return { id: n.id, kind: 'integration', label: c?.short ?? n.label, logo: n.integration, r: 24, ring: 0, tone: 'neutral', badge: n.findings, parent: n.parent };
    }
    if (n.kind === 'cluster') {
      return {
        id: n.id, kind: 'cluster', label: n.label, sub: n.location, r: 22, ring: 230, group: n.id, parent: n.parent,
        tone: n.findings ? 'accent' : 'neutral', badge: n.findings, glyph: n.label.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase(),
      };
    }
    return {
      id: n.id, kind: 'service', label: n.label, sub: n.count != null ? `${n.count.toLocaleString('en-US')} ${n.unit ?? ''}`.trim() : undefined,
      r: 15 + Math.min(9, Math.log10((n.monthlyCost ?? 100) + 1) * 1.6), ring: 410, group: n.parent, parent: n.parent,
      tone: STATUS_TONE[n.status ?? 'healthy'], util: n.cpu ?? null, badge: n.findings, pulse: n.status === 'hot',
      glyph: (n.type ?? 'sv').replace(/[^a-z]/g, '').slice(0, 2).toUpperCase(),
    };
  });

  const edges: GEdge[] = [];
  for (const n of shown) if (n.parent && ids.has(n.parent)) edges.push({ from: n.parent, to: n.id, kind: 'contains' });
  for (const e of g.edges) {
    if (e.kind === 'contains' || !ids.has(e.from) || !ids.has(e.to)) continue;
    if (edges.some((x) => x.from === e.from && x.to === e.to)) continue;
    edges.push({ from: e.from, to: e.to, kind: e.kind === 'replicates' ? 'replicates' : 'depends', weight: e.kind === 'traffic' ? 3 : 1.5 });
  }
  return { nodes, edges, layoutKey: `infra:${f.env}:${shown.map((n) => n.id).join(',')}` };
}

/* ---------- session map ---------- */

const AGENT_GLYPH = (name: string) => name.split(/\s+/).filter((p) => /^[A-Za-z]/.test(p)).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || 'AG';

export type SessionModel = { nodes: GNode[]; edges: GEdge[]; layoutKey: string; agentOf: Record<string, string>; calls: Record<string, number> };

/**
 * Session → agents → integrations → targets. Edge weight is the number of tool calls
 * along it; edges carrying a running step animate.
 */
export function sessionModel(s: AgentSession, graph: InfraGraph | null): SessionModel {
  const nodes: GNode[] = [];
  const edges = new Map<string, GEdge>();
  const calls: Record<string, number> = {};
  const agentOf: Record<string, string> = {};
  const infra = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
  const addEdge = (from: string, to: string, kind: GEdge['kind'], active: boolean) => {
    const k = `${from}>${to}`;
    const e = edges.get(k);
    if (e) { e.weight = (e.weight ?? 1) + 1; e.active = e.active || active; } else edges.set(k, { from, to, kind, weight: 1, active });
    calls[k] = (calls[k] ?? 0) + 1;
  };

  const sessionTone: GTone = s.status === 'failed' ? 'danger' : s.status === 'waiting' ? 'warn' : s.status === 'running' ? 'accent' : 'ok';
  nodes.push({ id: 'session', kind: 'session', label: s.title.length > 34 ? `${s.title.slice(0, 32)}…` : s.title, logo: 'martian', r: 30, ring: 0, tone: sessionTone, pulse: s.status === 'running' });

  const seenInt = new Set<string>();
  const seenTarget = new Set<string>();
  s.agents.forEach((a, i) => {
    const id = `agent:${a.id}`;
    agentOf[id] = a.id;
    const running = a.status === 'running';
    nodes.push({
      id, kind: 'agent', label: a.name, sub: `${a.steps.length} step${a.steps.length === 1 ? '' : 's'}`, r: 21, ring: 165,
      tone: a.status === 'failed' ? 'danger' : running ? 'accent' : a.status === 'done' ? 'ok' : 'idle', pulse: running, glyph: AGENT_GLYPH(a.name),
    });
    edges.set(`session>${id}`, { from: 'session', to: id, kind: 'handoff', weight: 1, active: running });
    if (i > 0 && a.startedAt >= (s.agents[i - 1].endedAt ?? Infinity)) {
      // Sequential handoff between agents.
      edges.set(`agent:${s.agents[i - 1].id}>${id}`, { from: `agent:${s.agents[i - 1].id}`, to: id, kind: 'handoff', weight: 1, active: false });
    }
    for (const st of a.steps) {
      const integ = st.integration && st.integration !== 'martian' ? st.integration : null;
      const active = st.status === 'running';
      if (integ) {
        const iid = `int:${integ}`;
        if (!seenInt.has(iid)) {
          seenInt.add(iid);
          nodes.push({ id: iid, kind: 'integration', label: CATALOG_BY_ID[integ]?.short ?? integ, logo: integ, r: 22, ring: 330, tone: 'neutral' });
        }
        addEdge(id, iid, 'calls', active);
      }
      if (st.target && infra.has(st.target)) {
        const t = infra.get(st.target)!;
        if (!seenTarget.has(t.id)) {
          seenTarget.add(t.id);
          nodes.push({
            id: t.id, kind: t.kind === 'cluster' ? 'cluster' : 'service', label: t.label, sub: t.kind === 'cluster' ? t.location : t.count != null ? `${t.count.toLocaleString('en-US')} ${t.unit ?? ''}`.trim() : undefined,
            r: t.kind === 'cluster' ? 18 : 15, ring: 500, group: integ ?? undefined, tone: STATUS_TONE[t.status ?? 'healthy'], util: t.cpu ?? null,
            glyph: t.kind === 'cluster' ? t.label.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() : (t.type ?? 'sv').replace(/[^a-z]/g, '').slice(0, 2).toUpperCase(),
          });
        }
        addEdge(integ ? `int:${integ}` : id, t.id, 'contains', active);
      }
    }
  });
  // Tree parents for the radial layout: agents hang off the session, each integration off
  // the agent that called it most, each target off the integration (or agent) that reached it.
  const best = new Map<string, { from: string; n: number }>();
  for (const e of edges.values()) {
    if (e.kind === 'handoff' && e.from !== 'session') continue;
    const cur = best.get(e.to);
    if (!cur || (e.weight ?? 1) > cur.n) best.set(e.to, { from: e.from, n: e.weight ?? 1 });
  }
  for (const n of nodes) if (n.id !== 'session') n.parent = best.get(n.id)?.from ?? 'session';
  const ids = nodes.map((n) => `${n.id}<${n.parent ?? ''}`).join(',');
  return { nodes, edges: [...edges.values()], layoutKey: `ses:${s.id}:${ids}`, agentOf, calls };
}
