/**
 * Compact copy of the demo world for the backend's demo tools (PUT /demo/snapshot).
 * Claude reads this through get_overview, list_findings, describe_topology and the
 * rest, so its answers match what's on screen.
 */
import { CATALOG_BY_ID } from '../data/catalog';
import { accountsCount, healthScore, monthlyCost, openWaste, resourceCount, World } from './world';

const r1 = (x: number) => Math.round(x * 10) / 10;

export function snapshot(w: World) {
  const cost = monthlyCost(w);
  return {
    version: 1,
    taken_at: new Date(w.now).toISOString(),
    org: { name: w.variant.org.name, industry: w.variant.org.industry, hq: w.variant.org.hq },
    overview: {
      health_score: healthScore(w), monthly_cost: Math.round(cost), waste_identified: Math.round(openWaste(w)), realized_savings: Math.round(w.realized),
      resources: resourceCount(w), accounts: accountsCount(w), last_scan_at: new Date(w.lastScanAt).toISOString(),
      open_findings: w.findings.filter((f) => f.state === 'open').length,
    },
    integrations: w.integrations.filter((i) => i.status !== 'available').map((i) => ({
      id: i.id, name: CATALOG_BY_ID[i.id]?.name ?? i.id, status: i.status, enabled: i.enabled, mode: i.mode, scope: i.scope,
      write_tools: (CATALOG_BY_ID[i.id]?.tools ?? []).filter((t) => t.write && !i.disabledTools.includes(t.name)).map((t) => t.name),
    })),
    clusters: w.variant.clusters.map((c) => ({
      id: c.id, node_id: `cl:${c.id}`, name: c.name, integration: c.integration, env: c.env, location: c.location,
      services: c.services.map((sp) => {
        const s = w.services[`svc:${c.id}/${sp.id}`];
        return {
          id: sp.id, node_id: `svc:${c.id}/${sp.id}`, name: sp.name, type: sp.type, integration: sp.integration ?? c.integration,
          count: s.count, unit: sp.unit, monthly_cost: Math.round(s.count * s.unitCost), cpu: s.cpu == null ? null : r1(s.cpu), mem: s.mem == null ? null : r1(s.mem),
          depends_on: sp.deps ?? [], tags: sp.tags ?? [],
        };
      }),
    })),
    telemetry: Object.fromEntries(Object.entries(w.telemetry).filter(([, t]) => t.cpu.some((x) => x > 0)).map(([id, t]) => [id, { cpu_24h: t.cpu.map(r1), mem_24h: t.mem.map(r1) }])),
    findings: w.findings.filter((f) => f.state !== 'dismissed').map((f) => ({
      id: f.id, title: f.title, description: f.description, scope: f.scope, affects: f.affects, est_monthly_savings: Math.round(f.impact),
      effort: f.difficulty, time_to_apply: f.timeToImplement, status: f.state === 'done' ? 'applied' : f.state, automatable: f.automatable,
      integration: f.integration, node_id: f.nodeId, steps: f.steps, realized_monthly_savings: f.realized ? Math.round(f.realized) : null,
    })),
    sessions: w.sessions.slice(0, 30).map((s) => ({
      id: s.id, title: s.title, goal: s.goal, status: s.status, source: s.source, started_at: new Date(s.startedAt).toISOString(),
      ended_at: s.endedAt ? new Date(s.endedAt).toISOString() : null, integrations: s.integrations, summary: s.summary ?? null,
      savings: s.savings ? Math.round(s.savings) : null,
      agents: s.agents.map((a) => ({
        name: a.name, role: a.role, status: a.status,
        steps: a.steps.map((x) => ({ kind: x.kind, title: x.title, text: x.text, tool: x.tool ?? null, integration: x.integration ?? null, status: x.status })),
      })),
    })),
    activity: w.activity.slice(0, 30).map((a) => ({ at: a.at ? new Date(a.at).toISOString() : null, agent: a.agent, text: a.text })),
  };
}

export type Snapshot = ReturnType<typeof snapshot>;
