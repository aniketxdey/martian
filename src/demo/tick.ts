/**
 * Moves a demo world forward in time and applies user actions. Everything the
 * console shows changes in a plausible way: utilization drifts with a daily cycle,
 * fleets autoscale, costs drift, scans and workflows progress step by step, approved
 * findings run through a remediation pipeline, and monitoring keeps finding waste.
 */
import { CATALOG_BY_ID } from '../data/catalog';
import type { AgentSession, UiActivity } from '../state/types';
import { clamp, Rng, round } from './rng';
import { applyWorkflow, connectedIds, initialSessions, SCHEDULED_GOALS, sessionEnd, shiftSession, workflowFor } from './sessions';
import { buildGraph, lcFirst, money, plural, short, World } from './world';

const MIN = 60_000;

let actSeq = 0;
export function logActivity(w: World, a: Omit<UiActivity, 'when' | 'id' | 'at'> & { at?: number }) {
  w.activity.unshift({ ...a, id: `act-${actSeq++}`, at: a.at ?? w.now, when: '' });
  if (w.activity.length > 120) w.activity.length = 120;
}

function logCall(w: World, integration: string, agent: string, tool: string, ms: number, ok = true) {
  const i = w.integrations.find((x) => x.id === integration);
  if (!i) return;
  i.calls.unshift({ at: w.now, agent, tool, ms, ok });
  if (i.calls.length > 25) i.calls.length = 25;
  i.callCount += 1;
  if (ok) i.lastSync = w.now;
}

/** Seed history once: past sessions, the activity they produced, and recent tool calls. */
export function seedHistory(w: World, r: Rng) {
  w.sessions = initialSessions(w, r.fork('sessions'));
  const events: UiActivity[] = [];
  for (const s of w.sessions) {
    const end = s.endedAt ?? sessionEnd(s);
    const lead = s.agents[s.agents.length - 1];
    events.push({
      id: `act-${actSeq++}`, agent: lead?.name ?? 'Martian', at: end, when: '', sessionId: s.id, integration: s.integrations[0],
      text: s.status === 'failed' ? `couldn't finish “${s.title}”: ${lcFirst(s.summary ?? 'see the trace')}` : `finished “${s.title}”. ${s.summary ?? ''}`.trim(),
      where: s.source === 'schedule' ? 'Scheduled' : s.source === 'approval' ? 'Changes' : s.source === 'chat' ? 'Chat' : 'Workflows',
    });
    for (const a of s.agents) for (const st of a.steps) if (st.tool && st.integration && st.integration !== 'martian') {
      const i = w.integrations.find((x) => x.id === st.integration);
      if (i && st.at > w.now - 6 * 3600_000) i.calls.push({ at: st.at, agent: a.name, tool: st.tool, ms: Math.round(st.durationMs), ok: st.status !== 'failed' });
    }
  }
  for (const i of w.integrations) { i.calls.sort((a, b) => b.at - a.at); i.calls = i.calls.slice(0, 25); }
  w.activity = events.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 60);
  // Open on a run that's already underway, so the Agents page has something moving.
  const live = workflowFor(w, r.fork('live'), r.fork('goal').pick(SCHEDULED_GOALS), { source: 'schedule', requestedBy: 'Scheduler', speed: 0.5 });
  shiftSession(live, -r.int(6, 18) * 1000);
  w.sessions.unshift(live);
}

/* ---------- step clock ---------- */

function advanceSession(w: World, s: AgentSession, r: Rng) {
  if (s.status !== 'running') return;
  if (s.stream) return; // live chat runs are driven by stream events
  for (const a of s.agents) {
    let started = false;
    let allDone = true;
    for (const st of a.steps) {
      const prev = st.status;
      st.status = w.now >= st.at + st.durationMs ? 'done' : w.now >= st.at ? 'running' : 'pending';
      if (prev !== 'done' && st.status === 'done' && st.tool && st.integration && st.integration !== 'martian') logCall(w, st.integration, a.name, st.tool, Math.round(st.durationMs));
      if (st.status !== 'pending') started = true;
      if (st.status !== 'done') allDone = false;
    }
    const prevStatus = a.status;
    a.status = allDone ? 'done' : started ? 'running' : 'pending';
    if (a.status === 'running' && prevStatus === 'pending') {
      logActivity(w, { agent: a.name, text: `started on “${s.title}”: ${lcFirst(a.role)}`, where: s.fromChat ? 'Chat' : 'Workflows', sessionId: s.id, integration: a.integrations[0] });
    }
    if (a.status === 'done' && !a.endedAt) a.endedAt = w.now;
  }
  if (s.agents.every((a) => a.status === 'done')) completeSession(w, s, r);
}

function completeSession(w: World, s: AgentSession, r: Rng) {
  s.status = 'completed';
  s.endedAt = w.now;
  if (s.source === 'approval') {
    const f = w.findings.find((x) => x.sessionId === s.id);
    if (f) {
      f.state = 'done';
      f.progress = 1;
      f.realized = round(f.impact * r.float(0.92, 1.05), 1);
      w.realized += f.realized;
      s.savings = f.realized;
      s.summary = `Applied. Realized ${money(f.realized)}/mo.`;
      // The resources really change: fewer instances, less cost.
      const svc = f.nodeId ? w.services[f.nodeId] : undefined;
      if (svc && svc.unitCost > 0) {
        const removed = Math.min(svc.count - 1, Math.round(f.realized / svc.unitCost));
        if (removed > 0 && !['TB', 'TB/mo'].includes(svc.spec.unit)) svc.count -= removed;
        else svc.unitCost = Math.max(1, svc.unitCost - f.realized / Math.max(1, svc.count));
      }
      logActivity(w, { agent: 'Auditor', text: `applied “${f.title}”, saving ${money(f.realized)}/mo`, where: 'Changes', sessionId: s.id, integration: f.integration });
    }
  } else if (s.source === 'scan' || s.source === 'schedule') {
    w.lastScanAt = w.now;
    if (w.scanning === s.id) w.scanning = null;
    const found = revealFindings(w, r, r.int(0, 2));
    const open = w.findings.filter((f) => f.state === 'open');
    s.findingsCount = open.length;
    s.summary = `Scanned ${w.variant.clusters.length} clusters. ${open.length} open findings${found ? `, ${found} new` : ''}.`;
    logActivity(w, { agent: 'Cost analyst', text: `found ${found ? `${found} new optimization${found > 1 ? 's' : ''}` : 'no new waste'} in the latest scan (${open.length} open, ${money(open.reduce((n, f) => n + f.impact, 0))}/mo)`, where: 'Discovery', sessionId: s.id });
  } else {
    const last = s.agents[s.agents.length - 1]?.steps.slice(-1)[0];
    s.summary = s.summary ?? last?.text;
    logActivity(w, { agent: s.agents[s.agents.length - 1]?.name ?? 'Martian', text: `finished “${s.title}”. ${s.summary ?? ''}`.trim(), where: s.fromChat ? 'Chat' : 'Workflows', sessionId: s.id, integration: s.integrations[0] });
  }
}

function revealFindings(w: World, r: Rng, n: number) {
  let found = 0;
  for (let i = 0; i < n && w.reserve.length; i++) {
    const f = w.reserve.shift()!;
    f.createdAt = w.now;
    f.isNew = true;
    w.findings.push(f);
    found++;
  }
  w.findings.sort((a, b) => (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1) || b.impact - a.impact);
  return found;
}

/* ---------- tick ---------- */

export function tick(w: World, now: number, r: Rng) {
  const dt = Math.max(0, now - w.now);
  w.now = now;
  w.tick += 1;
  const h = new Date(now).getHours() + new Date(now).getMinutes() / 60;
  const d = 0.5 + 0.5 * Math.sin(((h - 9) / 24) * 2 * Math.PI);

  // Utilization, memory and fleet sizes.
  for (const [id, s] of Object.entries(w.services)) {
    const t = w.telemetry[id];
    if (s.baseCpu != null && s.cpu != null) {
      const idle = s.spec.waste?.includes('idle');
      const target = s.baseCpu * (idle ? 1 : 0.7 + 0.6 * d);
      s.cpu = clamp(s.cpu + (target - s.cpu) * 0.18 + r.gauss(0, Math.max(0.3, s.baseCpu * 0.05)), 0.2, 99);
      s.mem = clamp((s.mem ?? 30) + r.gauss(0, 0.35), 3, 96);
      t.cpu[t.cpu.length - 1] = s.cpu;
      t.mem[t.mem.length - 1] = s.mem;
      if (t.rps) t.rps[t.rps.length - 1] = Math.max(0, (s.cpu * 18 + 40) * (0.6 + d * 0.8) * (0.95 + r.next() * 0.1));
      if (t.latency) t.latency[t.latency.length - 1] = Math.max(4, 38 + s.cpu * 0.9 + r.gauss(0, 4));
    }
    const elastic = s.spec.tags?.includes('asg') || s.spec.waste?.includes('forecast') || s.spec.type === 'k8s';
    if (elastic && r.chance(0.025)) {
      const init = (s.spec.count[0] + s.spec.count[1]) / 2;
      s.count = Math.round(clamp(s.count + (r.chance(0.5 + (d - 0.5) * 0.6) ? 1 : -1) * r.int(1, 3), init * 0.85, init * 1.2));
    }
    t.cost[t.cost.length - 1] = (s.count * s.unitCost) / 1440 * (0.95 + r.next() * 0.1);
  }
  // New telemetry point roughly every minute.
  if (w.tick % 30 === 0) for (const t of Object.values(w.telemetry)) for (const k of ['cpu', 'mem', 'cost', 'rps', 'latency'] as const) {
    const arr = t[k];
    if (arr) { arr.push(arr[arr.length - 1]); arr.shift(); }
  }
  w.costDrift = clamp(w.costDrift + r.gauss(0, 0.0006), -0.015, 0.02);

  // Sessions and findings in flight.
  for (const s of w.sessions) advanceSession(w, s, r);
  for (const f of w.findings) {
    if (f.state === 'running' && f.sessionId) {
      const s = w.sessions.find((x) => x.id === f.sessionId);
      if (s) {
        const total = sessionEnd(s) - s.startedAt;
        f.progress = clamp((w.now - s.startedAt) / Math.max(1, total), 0, 0.99);
      }
    }
    if (f.isNew && f.createdAt && w.now - f.createdAt > 90_000) f.isNew = false;
  }

  // Integrations being connected.
  for (const i of w.integrations) {
    if (i.status === 'pending' && i.lastSync && w.now >= i.lastSync) {
      i.status = 'connected';
      i.enabled = true;
      logActivity(w, { agent: 'Access checker', text: `connected ${CATALOG_BY_ID[i.id]?.name ?? i.id} and verified read-only access`, where: 'Integrations', integration: i.id });
    }
  }

  // Background monitoring (read-only).
  if (dt > 0 && r.chance(dt / (32 * 1000))) {
    const ints = connectedIds(w).filter((id) => w.variant.clusters.some((c) => c.integration === id));
    const id = ints.length ? r.pick(ints) : null;
    const c = id ? r.pick(w.variant.clusters.filter((x) => x.integration === id)) : null;
    if (id && c) {
      const n = c.services.reduce((acc, sp) => acc + (w.services[`svc:${c.id}/${sp.id}`]?.count ?? 0), 0);
      const tool = CATALOG_BY_ID[id]?.tools[0]?.name ?? `${id}_inventory`;
      logCall(w, id, 'Monitor', tool, r.int(300, 2400));
      const hot = c.services.map((sp) => w.services[`svc:${c.id}/${sp.id}`]).find((s) => (s?.cpu ?? 0) > 75);
      logActivity(w, {
        agent: 'Monitor', integration: id, where: short(id),
        text: hot ? `saw ${hot.spec.name} at ${Math.round(hot.cpu!)}% CPU in ${c.name}; watching the forecast` : `re-checked ${plural(n, 'resources')} in ${c.name}`,
      });
    }
  }
  // The scheduler starts background work every few minutes when nothing else is running.
  if (dt > 0 && !w.sessions.some((s) => s.status === 'running' && !s.fromChat) && r.chance(dt / (100 * 1000))) {
    const s = workflowFor(w, r, r.pick(SCHEDULED_GOALS), { source: 'schedule', requestedBy: 'Scheduler', speed: 0.5 });
    w.sessions.unshift(s);
    logActivity(w, { agent: 'Scheduler', text: `started “${s.title}”`, where: 'Scheduled', sessionId: s.id, integration: s.integrations[0] });
  }
  if (dt > 0 && w.reserve.length && r.chance(dt / (150 * 1000))) {
    const before = w.findings.length;
    revealFindings(w, r, 1);
    const f = w.findings.find((x) => x.isNew && w.findings.length > before);
    if (f) logActivity(w, { agent: 'Monitor', text: `found “${f.title}” worth ${money(f.impact)}/mo`, where: short(f.integration ?? ''), integration: f.integration });
  }

  if (w.sessions.length > 100) w.sessions.length = 100;
  w.graph = buildGraph(w);
}

/* ---------- actions ---------- */

export function approveFinding(w: World, r: Rng, id: string, by: string) {
  const f = w.findings.find((x) => x.id === id);
  if (!f || f.state !== 'open') return null;
  f.state = 'running';
  f.progress = 0;
  const s = applyWorkflow(w, r, f, by);
  f.sessionId = s.id;
  w.sessions.unshift(s);
  logActivity(w, { agent: by, text: `approved “${f.title}” (${money(f.impact)}/mo)`, where: 'Changes', sessionId: s.id, integration: f.integration });
  return s;
}

export function dismissFinding(w: World, id: string, by: string) {
  const f = w.findings.find((x) => x.id === id);
  if (!f || f.state !== 'open') return;
  f.state = 'dismissed';
  logActivity(w, { agent: by, text: `dismissed “${f.title}”`, where: 'Findings', integration: f.integration });
}

export function runScan(w: World, r: Rng, by: string) {
  if (w.scanning) return w.sessions.find((s) => s.id === w.scanning) ?? null;
  const s = workflowFor(w, r, 'Full discovery scan', { source: 'scan', requestedBy: by, speed: 0.22 });
  s.title = 'Discovery scan';
  w.scanning = s.id;
  w.sessions.unshift(s);
  logActivity(w, { agent: by, text: 'started a discovery scan', where: 'Discovery', sessionId: s.id });
  return s;
}

export function startWorkflow(w: World, r: Rng, goal: string, opts: { fromChat?: boolean; threadId?: string; by: string }) {
  const s = workflowFor(w, r, goal, { source: opts.fromChat ? 'chat' : 'workflow', fromChat: opts.fromChat, threadId: opts.threadId, requestedBy: opts.by });
  w.sessions.unshift(s);
  logActivity(w, { agent: opts.by, text: `started “${s.title}”`, where: opts.fromChat ? 'Chat' : 'Workflows', sessionId: s.id, integration: s.integrations[0] });
  return s;
}

/* ---------- live chat runs: see state/chatRuns.ts ---------- */

export const worldRunHost = (w: World) => ({
  get now() { return w.now; },
  sessions: w.sessions,
  onCall: (integration: string, agent: string, tool: string, ms: number, ok: boolean) => logCall(w, integration, agent, tool, ms, ok),
});

/* ---------- integrations and servers ---------- */

export function connectIntegration(w: World, id: string) {
  const i = w.integrations.find((x) => x.id === id);
  if (!i) return;
  i.status = 'pending';
  i.enabled = true;
  i.lastSync = w.now + 2600;
  if (!i.scope.length) i.scope = ['default'];
}

export function disconnectIntegration(w: World, id: string, by: string) {
  const i = w.integrations.find((x) => x.id === id);
  if (!i) return;
  i.status = 'available';
  i.enabled = false;
  logActivity(w, { agent: by, text: `disconnected ${CATALOG_BY_ID[id]?.name ?? id}`, where: 'Integrations', integration: id });
}

export const minutesAgo = (now: number, at?: number) => {
  if (!at) return 'never';
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
};

export { MIN };
