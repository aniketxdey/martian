/**
 * Agent sessions and agent-by-agent traces, generated from the demo world: which
 * integrations are connected, what each cluster runs, and which findings exist.
 */
import { CATALOG_BY_ID } from '../data/catalog';
import type { AgentRun, AgentSession, SessionSource, StepKind, TraceStep, UiFinding } from '../state/types';
import { clamp, Rng, round } from './rng';
import { clusterNodeId, lcFirst, money, plural, serviceNodeId, ServiceState, short, World, writeToolFor } from './world';
import type { WasteHint } from './variants';

type StepDraft = {
  kind: StepKind; title: string; text: string; ms: number;
  tool?: string; integration?: string; target?: string; args?: Record<string, unknown>; result?: string;
  metrics?: { label: string; value: string }[];
};
type AgentDraft = { name: string; role: string; parallel?: boolean; steps: StepDraft[] };
type Draft = { title: string; goal: string; agents: AgentDraft[]; summary: string; savings?: number; findingsCount?: number; resourcesTouched?: number };

const INVENTORY: Record<string, string> = {
  aws: 'aws_inventory', azure: 'azure_inventory', gcp: 'gcp_inventory', oracle: 'oci_inventory', vmware: 'vcenter_inventory',
  nutanix: 'nutanix_inventory', proxmox: 'proxmox_inventory', kubernetes: 'k8s_inventory', openshift: 'openshift_inventory',
  netapp: 'ontap_inventory', ssh: 'ssh_inventory', snowflake: 'snowflake_warehouse_usage', databricks: 'databricks_clusters',
};
const VERIFY: Record<string, string> = { aws: 'aws_verify_access', azure: 'azure_verify_access', gcp: 'gcp_verify_access', vmware: 'vcenter_verify_access', ssh: 'ssh_verify_access' };
const SERIES: Record<string, string> = {
  aws: 'aws_get_cpu_series', azure: 'azure_inventory', gcp: 'gcp_inventory', vmware: 'vcenter_performance', nutanix: 'nutanix_vm_stats',
  proxmox: 'proxmox_rrd_stats', kubernetes: 'k8s_requests_vs_usage', openshift: 'openshift_quota_usage', ssh: 'ssh_inventory',
  snowflake: 'snowflake_warehouse_usage', databricks: 'databricks_clusters', oracle: 'oci_inventory', netapp: 'ontap_cold_data_report',
};
const OBS: Record<string, { tool: string; q: (svc: string) => string }> = {
  datadog: { tool: 'datadog_query_metrics', q: (s) => `avg:system.cpu.user{service:${s}} by {host}` },
  prometheus: { tool: 'prometheus_query_range', q: (s) => `sum(rate(http_requests_total{service="${s}"}[5m]))` },
  newrelic: { tool: 'newrelic_nrql', q: (s) => `SELECT rate(count(*), 1 minute) FROM Transaction WHERE appName = '${s}' SINCE 14 days ago` },
  dynatrace: { tool: 'dynatrace_metrics', q: (s) => `builtin:service.requestCount.total:filter(eq("dt.entity.service","${s}"))` },
  splunk: { tool: 'splunk_search', q: (s) => `index=prod sourcetype=access_combined host=${s}* earliest=-14d | stats count` },
  grafana: { tool: 'grafana_query_datasource', q: (s) => `rate(node_cpu_seconds_total{job="${s}"}[5m])` },
};
const COST: Record<string, string> = { aws: 'aws_cost_by_service', azure: 'azure_cost_by_resource_group', gcp: 'gcp_billing_export_query', oracle: 'oci_usage_report', snowflake: 'snowflake_warehouse_usage', databricks: 'databricks_job_costs' };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const connectedIds = (w: World) => w.integrations.filter((i) => i.enabled && i.status === 'connected').map((i) => i.id);
const has = (w: World, id: string) => connectedIds(w).includes(id);
const firstOf = (w: World, ids: string[]) => ids.find((id) => has(w, id));

const servicesOf = (w: World) => Object.entries(w.services).map(([id, s]) => ({ id, s }));
const svcLabel = (s: ServiceState) => `${s.spec.name} (${s.cluster.name})`;

/* ---------- archetypes ---------- */

function scanDraft(w: World, r: Rng, quick = false, past = 0): Draft {
  const ints = connectedIds(w).filter((id) => INVENTORY[id]);
  const total = servicesOf(w).reduce((n, { s }) => n + s.count, 0);
  const access: AgentDraft = {
    name: 'Access checker', role: 'Verifies every credential is read-only before discovery', steps: [
      { kind: 'plan', title: 'Plan', text: `Check ${ints.length} integrations for read-only access before any inventory call.`, ms: 900 },
      ...ints.filter((id) => VERIFY[id]).map((id) => ({
        kind: 'tool' as const, title: `Verify ${short(id)} access`, tool: VERIFY[id], integration: id, ms: r.int(600, 2400),
        args: { scope: w.integrations.find((i) => i.id === id)?.scope[0] ?? 'default' },
        text: `Simulated a write against ${short(id)}; it was denied, so the identity is read-only.`, result: 'read-only confirmed',
      })),
    ],
  };
  const clusters = w.variant.clusters.filter((c) => has(w, c.integration));
  const discovery: AgentDraft = {
    name: 'Discovery', role: 'Inventories every cluster and maps dependencies', parallel: true,
    steps: clusters.map((c) => {
      const svcs = c.services.map((s) => w.services[serviceNodeId(c.id, s.id)]);
      const n = svcs.reduce((a, s) => a + s.count, 0);
      return {
        kind: 'tool' as const, title: `Inventory ${c.name}`, tool: INVENTORY[c.integration], integration: c.integration, target: clusterNodeId(c.id),
        args: { scope: c.location, include: c.services.map((s) => s.type).filter((x, i, a) => a.indexOf(x) === i) }, ms: r.int(1800, 9500),
        text: `Found ${n.toLocaleString('en-US')} resources across ${svcs.length} services: ${svcs.map((s) => `${s.count} ${s.spec.unit}`).slice(0, 3).join(', ')}.`,
        metrics: [{ label: 'resources', value: n.toLocaleString('en-US') }, { label: 'monthly', value: money(svcs.reduce((a, s) => a + s.count * s.unitCost, 0)) }],
      };
    }),
  };
  const withCpu = servicesOf(w).filter(({ s }) => s.baseCpu != null);
  const util: AgentDraft = {
    name: 'Utilization analyst', role: 'Pulls 14 days of utilization and flags idle and hot resources', steps: r.pickN(withCpu, quick ? 2 : 4).flatMap(({ id, s }) => {
      const integ = s.spec.integration ?? s.cluster.integration;
      const obs = firstOf(w, Object.keys(OBS));
      const tool = obs ? OBS[obs].tool : SERIES[integ] ?? INVENTORY[integ];
      return [{
        kind: 'tool' as const, title: `Utilization: ${s.spec.name}`, tool, integration: obs ?? integ, target: id, ms: r.int(700, 3200),
        args: obs ? { query: OBS[obs].q(slug(s.spec.name)), window: '14d' } : { resource: slug(s.spec.name), period: 3600, days: 14 },
        text: `Average ${Math.round(s.baseCpu!)}% CPU, p95 ${Math.round(clamp(s.baseCpu! * 1.9, 3, 97))}% across ${plural(s.count, s.spec.unit)}.`,
        metrics: [{ label: 'avg CPU', value: `${Math.round(s.baseCpu!)}%` }],
      }];
    }),
  };
  const forecastTargets = r.pickN(withCpu.filter(({ s }) => s.spec.waste?.includes('forecast') || s.spec.type === 'vm-fleet' || s.spec.type === 'k8s'), quick ? 1 : 2);
  const forecaster: AgentDraft = {
    name: 'Forecaster', role: 'Runs the LSTM workload model on utilization history', steps: forecastTargets.map(({ id, s }) => {
      const p50 = Math.round(clamp(s.baseCpu! * r.float(1.2, 1.8), 4, 92));
      const p90 = Math.round(clamp(p50 * r.float(1.12, 1.3), 6, 98));
      return {
        kind: 'tool' as const, title: `Forecast ${s.spec.name}`, tool: 'forecast_utilization', integration: 'martian', target: id, ms: r.int(400, 1400),
        args: { history: '168 hourly points', horizon_hours: 24 }, text: `Next 24h peak p50 ${p50}%, p90 ${p90}%; ${p90 < 40 ? 'capacity can come down' : p90 > 80 ? 'scale up before the peak' : 'current capacity fits'}.`,
        metrics: [{ label: 'p50 peak', value: `${p50}%` }, { label: 'p90 peak', value: `${p90}%` }],
      };
    }),
  };
  // Older scans saw a slightly different picture: fewer findings and a different total.
  const openNow = w.findings.filter((f) => f.state === 'open');
  const open = past ? openNow.slice(0, Math.max(1, openNow.length - r.int(0, Math.min(3, past + 1)))) : openNow;
  const waste = open.reduce((n, f) => n + f.impact, 0) * (past ? r.float(0.9, 1.08) : 1);
  const analyst: AgentDraft = {
    name: 'Cost analyst', role: 'Runs the findings rules and ranks savings by effort', steps: [
      { kind: 'decide', title: 'Run findings rules', text: `Evaluated 14 rules over ${total.toLocaleString('en-US')} resources. ${open.length} findings worth ${money(waste)}/mo; ${open.filter((f) => f.difficulty === 'easy').length} are quick wins.`, ms: 1200, metrics: [{ label: 'findings', value: String(open.length) }, { label: 'waste', value: `${money(waste)}/mo` }] },
      ...(has(w, 'slack') ? [{ kind: 'tool' as const, title: 'Post summary', tool: 'slack_post_message', integration: 'slack', args: { channel: w.integrations.find((i) => i.id === 'slack')?.scope[0] ?? '#cloud-costs' }, text: 'Posted the scan summary with the top three quick wins.', ms: 600 }] : []),
      { kind: 'result', title: 'Scan complete', text: `Mapped ${total.toLocaleString('en-US')} resources across ${clusters.length} clusters and ${ints.length} integrations.`, ms: 200 },
    ],
  };
  return {
    title: quick ? 'Discovery scan' : 'Scheduled discovery scan', goal: 'Inventory every connected integration and refresh findings from its utilization',
    agents: [access, discovery, util, forecaster, analyst].filter((a) => a.steps.length),
    summary: `Scanned ${clusters.length} clusters. ${open.length} open findings worth ${money(waste)}/mo.`, findingsCount: open.length, resourcesTouched: total,
  };
}

function accessDraft(w: World, r: Rng): Draft {
  const ints = connectedIds(w);
  return {
    title: 'Access and permissions review', goal: 'Confirm every integration uses least-privilege, read-only credentials',
    agents: [{
      name: 'Access checker', role: 'Audits identities, scopes and write permissions', steps: [
        { kind: 'plan', title: 'Plan', text: `Review credentials for ${ints.length} integrations and flag anything broader than read-only.`, ms: 800 },
        ...ints.map((id) => ({
          kind: 'tool' as const, title: `Review ${short(id)}`, tool: VERIFY[id] ?? INVENTORY[id] ?? `${id}_inventory`, integration: id, ms: r.int(500, 1900),
          args: { dry_run: true }, text: w.integrations.find((i) => i.id === id)?.mode === 'read' ? 'Read-only. Write tools are disabled for this integration.' : 'Read-only for discovery; write tools require approval.',
        })),
        { kind: 'result', title: 'Review complete', text: `All ${ints.length} integrations pass. No standing write access outside approved changes.`, ms: 300 },
      ],
    }],
    summary: `${ints.length} integrations reviewed, all least-privilege.`,
  };
}

function costReportDraft(w: World, r: Rng): Draft {
  const clouds = connectedIds(w).filter((id) => COST[id]);
  const open = w.findings.filter((f) => f.state === 'open');
  const top = [...open].sort((a, b) => b.impact - a.impact).slice(0, 3);
  return {
    title: 'Weekly cost report', goal: 'Summarize where the money goes and what has already been saved, for finance',
    agents: [
      {
        name: 'Cost analyst', role: 'Pulls billing data and compares week over week', steps: clouds.map((id) => ({
          kind: 'tool' as const, title: `${short(id)} spend`, tool: COST[id], integration: id, ms: r.int(900, 3600), args: { granularity: 'DAILY', days: 30 },
          text: `Spend ${r.chance(0.6) ? 'down' : 'up'} ${r.float(0.8, 6.4).toFixed(1)}% week over week; largest line item ${r.pick(['compute', 'storage', 'data transfer', 'database'])}.`,
        })),
      },
      {
        name: 'Reporter', role: 'Writes the executive summary', steps: [
          { kind: 'decide', title: 'Draft summary', text: `Top opportunities: ${top.map((f) => `${f.title} (${money(f.impact)}/mo)`).join('; ')}.`, ms: 1800 },
          ...(has(w, 'slack') ? [{ kind: 'tool' as const, title: 'Share report', tool: 'slack_post_message', integration: 'slack', args: { channel: '#finance' }, text: 'Shared the report with finance and the platform team.', ms: 500 }] : []),
          { kind: 'result', title: 'Report ready', text: `Realized savings to date ${money(w.realized)}/mo; ${money(open.reduce((n, f) => n + f.impact, 0))}/mo still open.`, ms: 200 },
        ],
      },
    ],
    summary: 'Weekly report delivered to finance.',
  };
}

const HINT_OF = (f: UiFinding) => (f.id.split('-').pop() ?? 'idle') as WasteHint;

function findingDraft(w: World, r: Rng, f: UiFinding, apply: boolean): Draft {
  const s = f.nodeId ? w.services[f.nodeId] : undefined;
  const integ = f.integration ?? s?.cluster.integration ?? 'aws';
  const hint = HINT_OF(f);
  const obs = firstOf(w, Object.keys(OBS));
  const ticket = firstOf(w, ['jira']);
  const repo = firstOf(w, ['github', 'gitlab']);
  const chat = firstOf(w, ['slack']);
  const pager = firstOf(w, ['pagerduty']);
  const svcName = s?.spec.name ?? f.title;
  const count = parseInt(f.affects.replace(/[^\d]/g, ''), 10) || s?.count || 1;
  const write = writeToolFor(integ, hint);
  const viaRepo = (hint === 'requests' || hint === 'oversized') && repo && r.chance(0.6);

  const discovery: AgentDraft = {
    name: 'Discovery', role: `Reads ${short(integ)} inventory for the affected resources`, steps: [
      { kind: 'plan', title: 'Plan', text: `Confirm "${f.title}" is real before anyone changes anything: inventory, utilization, owners, then a reversible change.`, ms: 900 },
      {
        kind: 'tool', title: `Inventory ${s?.cluster.name ?? short(integ)}`, tool: INVENTORY[integ] ?? `${integ}_inventory`, integration: integ, target: f.nodeId,
        args: { scope: s?.cluster.location ?? 'all', filter: slug(svcName) }, ms: r.int(1500, 6500),
        text: `${plural(s?.count ?? count, s?.spec.unit ?? 'resources')} in ${svcName}; ${lcFirst(f.description)}.`,
      },
    ],
  };
  const verifier: AgentDraft = {
    name: 'Verifier', role: 'Cross-checks with observability data so nothing in use is touched', steps: [
      obs ? {
        kind: 'tool', title: `Check traffic in ${short(obs)}`, tool: OBS[obs].tool, integration: obs, target: f.nodeId, args: { query: OBS[obs].q(slug(svcName)), window: '14d' }, ms: r.int(900, 4200),
        text: hint === 'idle' || hint === 'gpu-idle' ? `No meaningful traffic on ${Math.max(1, count - r.int(0, 2))} of ${count}; ${r.int(0, 2)} run a nightly job and stay.` : `Usage confirms the pattern: p95 ${Math.round(clamp((s?.baseCpu ?? 20) * 1.7, 3, 95))}% over 14 days.`,
      } : {
        kind: 'tool', title: 'Check utilization history', tool: SERIES[integ] ?? INVENTORY[integ], integration: integ, target: f.nodeId, args: { days: 14 }, ms: r.int(900, 3000),
        text: `Utilization history matches the finding across all ${count} items.`,
      },
      ...(['forecast', 'oversized', 'requests', 'gpu-idle'].includes(hint) ? [{
        kind: 'tool' as const, title: 'Forecast demand', tool: hint === 'forecast' ? 'recommend_scaling' : 'forecast_utilization', integration: 'martian', target: f.nodeId,
        args: { horizon_hours: 24, target_utilization: 0.6 }, ms: r.int(400, 1200),
        text: f.description.includes('forecast') ? f.description : `24h forecast keeps p90 under ${r.int(38, 62)}% after the change.`,
      }] : []),
      ...(pager ? [{ kind: 'tool' as const, title: 'Check on-call and incidents', tool: 'pagerduty_incidents', integration: pager, args: { service: slug(svcName) }, ms: r.int(400, 1200), text: `No open incidents on ${svcName}; on-call notified.` }] : []),
      { kind: 'decide', title: 'Decision', text: f.automatable ? `Safe to change. Expected savings ${money(f.impact)}/mo.` : `Needs a person: ${lcFirst(f.steps[0])}.`, ms: 700 },
    ],
  };
  const agents: AgentDraft[] = [discovery, verifier];
  if (apply && f.automatable) {
    agents.push({
      name: 'Remediator', role: 'Applies the approved change with rollback', steps: [
        { kind: 'approval', title: 'Approval', text: `Approved by ${w.variant.admin.name}: ${f.steps[Math.min(2, f.steps.length - 1)]}.`, ms: r.int(30_000, 240_000) },
        viaRepo ? {
          kind: 'tool', title: 'Open pull request', tool: repo === 'github' ? 'github_open_pr' : 'gitlab_open_mr', integration: repo!, args: { title: f.title, branch: `martian/${slug(f.title)}` }, ms: r.int(1200, 3000),
          text: `Opened a change with new settings for ${svcName}; CI passed and it merged after review.`,
        } : {
          kind: 'tool', title: f.steps[Math.min(2, f.steps.length - 1)], tool: write ?? `${integ}_apply_change`, integration: integ, target: f.nodeId,
          args: { resources: count, dry_run: false }, ms: r.int(2500, 14000), text: `Done on ${plural(count, s?.spec.unit ?? 'resources')}. Rollback arguments saved.`,
        },
        ...(chat ? [{ kind: 'tool' as const, title: 'Notify owners', tool: 'slack_post_message', integration: chat, args: { channel: w.integrations.find((i) => i.id === 'slack')?.scope[0] ?? '#ops' }, text: 'Told owners what changed and how to undo it.', ms: 500 }] : []),
      ],
    });
    agents.push({
      name: 'Auditor', role: 'Re-reads the resources and records realized savings', steps: [
        { kind: 'tool', title: 'Verify change', tool: INVENTORY[integ] ?? `${integ}_inventory`, integration: integ, target: f.nodeId, args: { filter: slug(svcName) }, ms: r.int(1200, 4000), text: 'State matches the plan; no alarms fired.' },
        { kind: 'result', title: 'Savings recorded', text: `Realized ${money(f.realized ?? f.impact)}/mo, logged to the audit trail.`, ms: 200, metrics: [{ label: 'realized', value: `${money(f.realized ?? f.impact)}/mo` }] },
      ],
    });
  } else {
    agents.push({
      name: 'Planner', role: 'Turns the verified finding into a plan someone can approve', steps: [
        { kind: 'decide', title: 'Plan', text: f.steps.map((x, i) => `${i + 1}. ${x}`).join(' '), ms: 1500 },
        ...(ticket && !f.automatable ? [{ kind: 'tool' as const, title: 'Open ticket', tool: 'jira_create_issue', integration: ticket, args: { project: w.integrations.find((i) => i.id === 'jira')?.scope[0] ?? 'OPS', summary: f.title }, ms: 900, text: `Opened ${w.integrations.find((i) => i.id === 'jira')?.scope[0] ?? 'OPS'}-${r.int(120, 980)} for the owning team.` }] : []),
        { kind: 'result', title: 'Ready for approval', text: `${f.title}: ${money(f.impact)}/mo. Waiting on Overview for approval.`, ms: 200 },
      ],
    });
  }
  return {
    title: apply ? `Apply: ${f.title}` : `Investigate: ${f.title}`,
    goal: apply ? `Verify and apply "${f.title}"` : `Verify "${f.title}" and prepare a change`,
    agents, summary: apply ? `Applied. Realized ${money(f.realized ?? f.impact)}/mo.` : `Verified ${money(f.impact)}/mo; ready for approval.`,
    savings: apply ? f.realized ?? f.impact : f.impact, findingsCount: 1, resourcesTouched: count,
  };
}

/* ---------- materialize ---------- */

let seq = 0;
const nextId = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Lay out a draft on a timeline. speed < 1 compresses durations (live workflows). */
export function materialize(d: Draft, opts: { start: number; source: SessionSource; speed?: number; done?: boolean; requestedBy?: string; fromChat?: boolean; threadId?: string }): AgentSession {
  const speed = opts.speed ?? 1;
  let cursor = opts.start + 400 * speed;
  const agents: AgentRun[] = [];
  const ints = new Set<string>();
  let lastParallelEnd = cursor;
  for (const a of d.agents) {
    const id = nextId('agt');
    const agentStart = cursor;
    const steps: TraceStep[] = [];
    let local = agentStart;
    let maxEnd = agentStart;
    for (const s of a.steps) {
      const dur = Math.max(150, s.ms * speed);
      const at = a.parallel ? agentStart + (steps.length % 3) * 250 * speed + Math.floor(steps.length / 3) * dur * 0.6 : local;
      steps.push({
        id: nextId('stp'), agentId: id, at, durationMs: dur, kind: s.kind, title: s.title, text: s.text, tool: s.tool, integration: s.integration,
        target: s.target, args: s.args, result: s.result, status: opts.done ? 'done' : 'pending', metrics: s.metrics,
      });
      if (s.integration && s.integration !== 'martian') ints.add(s.integration);
      local = at + dur + 120 * speed;
      maxEnd = Math.max(maxEnd, at + dur);
    }
    const end = Math.max(maxEnd, local);
    agents.push({ id, name: a.name, role: a.role, status: opts.done ? 'done' : 'pending', startedAt: agentStart, endedAt: opts.done ? end : undefined, integrations: [...new Set(a.steps.map((x) => x.integration).filter((x): x is string => !!x && x !== 'martian'))], steps });
    cursor = end + 300 * speed;
    lastParallelEnd = Math.max(lastParallelEnd, cursor);
  }
  return {
    id: nextId('ses'), title: d.title, goal: d.goal, status: opts.done ? 'completed' : 'running', source: opts.source, startedAt: opts.start,
    endedAt: opts.done ? lastParallelEnd : undefined, integrations: [...ints], agents, summary: opts.done ? d.summary : undefined,
    savings: d.savings, findingsCount: d.findingsCount, resourcesTouched: d.resourcesTouched, requestedBy: opts.requestedBy,
    fromChat: opts.fromChat, threadId: opts.threadId,
  };
}

/** Planned end of a session (last step end). */
export const sessionEnd = (s: AgentSession) => Math.max(s.startedAt, ...s.agents.flatMap((a) => a.steps.map((x) => x.at + x.durationMs)));

/* ---------- history and new workflows ---------- */

const H = 3600_000;

export function initialSessions(w: World, r: Rng): AgentSession[] {
  const out: AgentSession[] = [];
  const now = w.now;
  // Scheduled scans every few hours; the latest one matches lastScanAt.
  const scans = r.int(3, 5);
  for (let i = 0; i < scans; i++) {
    const start = i === 0 ? w.lastScanAt - r.int(60_000, 180_000) : now - (i * r.float(5, 9) + r.float(0, 2)) * H;
    out.push(materialize(scanDraft(w, r.fork(`scan${i}`), false, i), { start, source: 'schedule', done: true, requestedBy: 'Scheduler' }));
  }
  out.push(materialize(accessDraft(w, r.fork('access')), { start: now - r.float(20, 40) * H, source: 'schedule', done: true, requestedBy: 'Scheduler' }));
  out.push(materialize(costReportDraft(w, r.fork('cost')), { start: now - r.float(30, 70) * H, source: 'schedule', done: true, requestedBy: 'Scheduler' }));
  // Applied findings get their remediation sessions.
  for (const f of w.findings.filter((x) => x.state === 'done')) {
    const ses = materialize(findingDraft(w, r.fork(f.id), f, true), { start: now - r.float(4, 60) * H, source: 'approval', done: true, requestedBy: w.variant.admin.name });
    f.sessionId = ses.id;
    out.push(ses);
  }
  // A few investigations people asked for in chat.
  const open = w.findings.filter((f) => f.state === 'open');
  for (const f of r.pickN(open, r.int(2, 4))) {
    const ses = materialize(findingDraft(w, r.fork(`inv-${f.id}`), f, false), { start: now - r.float(1, 90) * H, source: 'chat', done: true, requestedBy: w.variant.admin.name });
    out.push(ses);
  }
  // One that failed, to show error traces.
  const failInt = r.pick(connectedIds(w).filter((id) => INVENTORY[id]));
  if (failInt) {
    const c = w.variant.clusters.find((x) => x.integration === failInt);
    const failed = materialize({
      title: `Inventory refresh: ${short(failInt)}`, goal: `Refresh ${CATALOG_BY_ID[failInt]?.name ?? failInt} inventory`,
      agents: [{ name: 'Discovery', role: 'Inventories every cluster', steps: [
        { kind: 'tool', title: `Inventory ${c?.name ?? short(failInt)}`, tool: INVENTORY[failInt], integration: failInt, target: c ? clusterNodeId(c.id) : undefined, args: { scope: c?.location ?? 'all' }, ms: 30_000, text: 'Timed out after 30s waiting for the API; the connector retried twice.' },
        { kind: 'result', title: 'Failed', text: 'Will retry on the next scheduled scan. No changes were made.', ms: 100 },
      ] }], summary: 'Timed out; retried on the next scan.',
    }, { start: now - r.float(10, 50) * H, source: 'schedule', done: true, requestedBy: 'Scheduler' });
    failed.status = 'failed';
    failed.agents[0].status = 'failed';
    failed.agents[0].steps[0].status = 'failed';
    out.push(failed);
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

const KEYWORDS: [RegExp, WasteHint[]][] = [
  [/idle|unused|stop|shut|deallocate|power off/i, ['idle']],
  [/duplicate|dedup|copies/i, ['dup']],
  [/database|db|sql|rds|aurora|oracle|exadata|rightsiz|right-siz|over.?provision/i, ['oversized']],
  [/kubernetes|k8s|pod|request|limit|gke|eks|aks|openshift/i, ['requests']],
  [/gpu|a100|l4|encoder/i, ['gpu-idle']],
  [/forecast|predict|scal|peak|capacity|autoscal/i, ['forecast']],
  [/snapshot/i, ['snapshots']],
  [/volume|disk|ebs|unattached/i, ['unattached']],
  [/cold|tier|archive|lifecycle|storage|s3|gcs|blob/i, ['cold', 'dup']],
  [/warehouse|snowflake|databricks|cluster.*idle|suspend/i, ['suspend']],
  [/nat|egress|network|cdn|transfer/i, ['nat', 'egress']],
  [/host|consolidat|vmware|esxi|vmotion/i, ['consolidate']],
  [/dr\b|disaster|standby|failover/i, ['dr']],
];

/** Move a session's timeline (used to start the demo with a run already in progress). */
export function shiftSession(s: AgentSession, ms: number) {
  s.startedAt += ms;
  if (s.endedAt) s.endedAt += ms;
  for (const a of s.agents) {
    a.startedAt += ms;
    if (a.endedAt) a.endedAt += ms;
    for (const st of a.steps) st.at += ms;
  }
}

/** Background work the scheduler starts on its own while the demo runs. */
export const SCHEDULED_GOALS = [
  'Utilization sweep across every cluster',
  'Check for idle VMs in every cloud',
  'Look for unattached volumes and old snapshots',
  'Refresh the cost report',
  'Verify read-only access for each integration',
  'Forecast the busiest services for tomorrow',
];

/** Pick the best workflow for a free-text goal and lay it out to run now. */
export function workflowFor(w: World, r: Rng, goal: string, opts: { source: SessionSource; fromChat?: boolean; threadId?: string; requestedBy?: string; speed?: number }): AgentSession {
  const g = goal.toLowerCase();
  const speed = opts.speed ?? 0.35;
  const base = { start: w.now, source: opts.source, speed, fromChat: opts.fromChat, threadId: opts.threadId, requestedBy: opts.requestedBy ?? w.variant.admin.name };
  let draft: Draft;
  if (/scan|discover|inventory|map|everything|full/i.test(g)) draft = scanDraft(w, r, true);
  else if (/access|permission|credential|iam|least.?priv/i.test(g)) draft = accessDraft(w, r);
  else if (/report|summary|executive|finance|weekly|spend/i.test(g)) draft = costReportDraft(w, r);
  else {
    const hints = KEYWORDS.filter(([re]) => re.test(g)).flatMap(([, h]) => h);
    const open = w.findings.filter((f) => f.state === 'open');
    const mentions = (f: UiFinding) => {
      const s = f.nodeId ? w.services[f.nodeId] : undefined;
      const words = [f.title, s?.spec.name, s?.cluster.name, CATALOG_BY_ID[f.integration ?? '']?.name, CATALOG_BY_ID[f.integration ?? '']?.short].filter(Boolean).join(' ').toLowerCase();
      return g.split(/\W+/).filter((t) => t.length > 3 && words.includes(t)).length;
    };
    const scored = open.map((f) => ({ f, score: (hints.includes(HINT_OF(f)) ? 3 : 0) + mentions(f) * 2 + f.impact / 1e5 })).sort((a, b) => b.score - a.score);
    const pick = scored[0]?.f;
    draft = pick ? findingDraft(w, r, pick, false) : scanDraft(w, r, true);
    if (pick) draft.title = goal.length < 64 ? goal.charAt(0).toUpperCase() + goal.slice(1) : draft.title;
  }
  draft.goal = goal;
  return materialize(draft, base);
}

/** Remediation pipeline started by approving a finding. */
export function applyWorkflow(w: World, r: Rng, f: UiFinding, requestedBy: string): AgentSession {
  const d = findingDraft(w, r, f, true);
  // Approval already happened in the UI; keep the step but make it instant.
  for (const a of d.agents) for (const s of a.steps) if (s.kind === 'approval') { s.ms = 600; s.text = `Approved by ${requestedBy} on Overview.`; }
  return materialize(d, { start: w.now, source: 'approval', speed: 0.45, requestedBy });
}

export const sessionTargetsSavings = (s: AgentSession) => round(s.savings ?? 0, 1);
