/**
 * A chat turn that calls tools becomes an agent session: each tool call is a trace
 * step, grouped into agents by integration. Shared by demo and live modes.
 */
import { CATALOG_BY_ID, integrationForTool } from '../data/catalog';
import type { AgentRun, AgentSession, TraceStep } from './types';

export type RunHost = {
  now: number;
  sessions: AgentSession[];
  onCall?: (integration: string, agent: string, tool: string, ms: number, ok: boolean) => void;
};

const INTERNAL_AGENT: Record<string, string> = {
  get_overview: 'Martian', list_findings: 'Cost analyst', get_finding: 'Cost analyst', search_inventory: 'Discovery',
  describe_topology: 'Discovery', get_resource_telemetry: 'Utilization analyst', list_agent_sessions: 'Martian',
  get_agent_session: 'Martian', list_integrations: 'Access checker', approve_finding: 'Remediator', start_workflow: 'Martian',
  forecast_utilization: 'Forecaster', recommend_scaling: 'Forecaster',
};

const shortName = (id: string) => CATALOG_BY_ID[id]?.short ?? id;
export const integrationOfTool = (tool: string) =>
  integrationForTool(tool) ?? (tool.startsWith('forecast') || tool === 'recommend_scaling' ? 'martian' : undefined);

export function beginChatRun(h: RunHost, opts: { title: string; threadId?: string; by: string }) {
  const s: AgentSession = {
    id: `ses_chat_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    title: opts.title.length > 72 ? `${opts.title.slice(0, 70)}…` : opts.title, goal: opts.title,
    status: 'running', source: 'chat', startedAt: h.now, integrations: [], agents: [], fromChat: true, stream: true,
    threadId: opts.threadId, requestedBy: opts.by,
  };
  h.sessions.unshift(s);
  return s;
}

export function chatToolStart(h: RunHost, sessionId: string, call: { id: string; tool: string; args?: Record<string, unknown> }) {
  const s = h.sessions.find((x) => x.id === sessionId);
  if (!s || s.agents.some((a) => a.steps.some((x) => x.id === call.id))) return;
  const integ = integrationOfTool(call.tool);
  const name = INTERNAL_AGENT[call.tool] ?? (integ ? `${shortName(integ)} agent` : 'Martian');
  let a: AgentRun | undefined = s.agents.find((x) => x.name === name);
  if (!a) {
    a = {
      id: `agt_${call.id}`, name, role: integ && integ !== 'martian' ? `Calls ${CATALOG_BY_ID[integ]?.name ?? integ} tools` : 'Reasons over Martian data',
      status: 'running', startedAt: h.now, integrations: [], steps: [],
    };
    s.agents.push(a);
  }
  a.status = 'running';
  if (integ && integ !== 'martian' && !a.integrations.includes(integ)) a.integrations.push(integ);
  if (integ && integ !== 'martian' && !s.integrations.includes(integ)) s.integrations.push(integ);
  const args = call.args ?? {};
  const target = typeof args.node_id === 'string' ? args.node_id : typeof args.cluster === 'string' ? `cl:${args.cluster}` : undefined;
  const step: TraceStep = {
    id: call.id, agentId: a.id, at: h.now, durationMs: 0, kind: 'tool', title: call.tool.replace(/_/g, ' '), text: 'Running…',
    tool: call.tool, integration: integ ?? undefined, target, args, status: 'running',
  };
  a.steps.push(step);
}

export function chatToolEnd(h: RunHost, sessionId: string, call: { id: string; ok: boolean; seconds?: number; result?: string }) {
  const s = h.sessions.find((x) => x.id === sessionId);
  const step = s?.agents.flatMap((a) => a.steps).find((x) => x.id === call.id);
  if (!s || !step) return;
  step.status = call.ok ? 'done' : 'failed';
  step.durationMs = Math.max(100, call.seconds != null ? call.seconds * 1000 : h.now - step.at);
  step.result = call.result;
  step.text = summarizeResult(call.result, call.ok);
  if (step.integration && step.integration !== 'martian') h.onCall?.(step.integration, 'Martian', step.tool ?? '', Math.round(step.durationMs), call.ok);
  for (const a of s.agents) a.status = a.steps.every((x) => x.status === 'done' || x.status === 'failed') ? 'done' : 'running';
}

export function endChatRun(h: RunHost, sessionId: string, opts: { summary?: string; failed?: boolean; waiting?: boolean } = {}) {
  const s = h.sessions.find((x) => x.id === sessionId);
  if (!s || s.status === 'completed' || s.status === 'failed') return;
  if (opts.waiting) { s.status = 'waiting'; return; }
  if (!s.agents.length) {
    const id = `agt_${s.id}`;
    s.agents.push({
      id, name: 'Martian', role: 'Answered from conversation context', status: 'done', startedAt: s.startedAt, endedAt: h.now, integrations: [],
      steps: [{ id: `stp_${s.id}`, agentId: id, at: s.startedAt, durationMs: Math.max(200, h.now - s.startedAt), kind: 'result', title: 'Answer', text: opts.summary ?? 'Answered without calling tools.', status: 'done' }],
    });
  }
  s.status = opts.failed ? 'failed' : 'completed';
  s.endedAt = h.now;
  if (opts.summary) s.summary = opts.summary.replace(/[#*_`>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
  for (const a of s.agents) { a.status = opts.failed && a.steps.some((x) => x.status === 'failed') ? 'failed' : 'done'; a.endedAt = a.endedAt ?? h.now; }
}

export function summarizeResult(result: string | undefined, ok: boolean) {
  if (!ok) return `Failed: ${(result ?? 'tool error').slice(0, 160)}`;
  if (!result) return 'Done.';
  try {
    const data = JSON.parse(result);
    if (Array.isArray(data?.findings)) return `Returned ${data.findings.length} findings.`;
    if (Array.isArray(data?.resources)) return `Returned ${data.resources.length} resources.`;
    if (Array.isArray(data?.sessions)) return `Returned ${data.sessions.length} sessions.`;
    if (Array.isArray(data?.nodes)) return `Returned a map with ${data.nodes.length} nodes.`;
    if (data?.session?.title) return `Started “${data.session.title}”.`;
    if (data?.approved === true) return `Approved “${data.title ?? 'finding'}”.`;
    if (typeof data?.monthly_cost === 'number') return `Monthly cost $${Math.round(data.monthly_cost).toLocaleString('en-US')}, waste $${Math.round(data.waste_identified ?? 0).toLocaleString('en-US')}.`;
    if (data?.forecast || data?.p90) return 'Forecast ready.';
    const keys = Object.keys(data ?? {});
    return keys.length ? `Returned ${keys.slice(0, 4).join(', ')}.` : 'Done.';
  } catch {
    return result.replace(/\s+/g, ' ').slice(0, 160);
  }
}
