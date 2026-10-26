/**
 * Local, deterministic chat for the static demo and the embed build (no API).
 * It answers from the demo world with the same event stream the API sends: tool
 * calls, tokens, approval pauses and a final view of the conversation.
 */
import type { ChatContext, ChatEvent } from '../app/store';
import { CATALOG_BY_ID } from '../data/catalog';
import type { UiFinding } from '../state/types';
import { accountsCount, healthScore, money, monthlyCost, openWaste, resourceCount, World } from './world';

type Msg = { id: string; type: 'user' | 'ai'; content: string; timestamp: string; quickActions?: { text: string; action: string }[] };
type Thread = { messages: Msg[]; run: any[]; pending: null | { findingId: string; callId: string; title: string; impact: number; integration?: string } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const id = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

const QUICK = (labels: string[]) => labels.map((t) => ({ text: t, action: t }));

const FINDING_WORDS: [RegExp, (f: UiFinding) => boolean][] = [
  [/idle|unused|asleep|nobody/i, (f) => /idle|always-on/i.test(f.title)],
  [/duplicate|dedup|copies/i, (f) => /duplicate/i.test(f.title)],
  [/database|db\b|sql|rds|aurora|oracle|exadata/i, (f) => /database|sql|aurora|rds|exadata|historian|db/i.test(f.title)],
  [/kubernetes|k8s|pods?|requests|gke|eks|aks/i, (f) => /requested|pods/i.test(f.title + f.description)],
  [/gpu/i, (f) => /gpu/i.test(f.title)],
  [/snapshot/i, (f) => /snapshot/i.test(f.title)],
  [/volume|disk|ebs/i, (f) => /unattached/i.test(f.title)],
  [/storage|cold|archive|tier/i, (f) => /cold|duplicate|unattached/i.test(f.title)],
  [/network|nat|egress|cdn/i, (f) => /nat|egress/i.test(f.title)],
  [/forecast|scale|scaling|peak/i, (f) => /forecast/i.test(f.title)],
];

function matchFindings(w: World, text: string) {
  const open = w.findings.filter((f) => f.state === 'open');
  const tests = FINDING_WORDS.filter(([re]) => re.test(text)).map(([, t]) => t);
  const byName = open.filter((f) => {
    const integ = CATALOG_BY_ID[f.integration ?? ''];
    return [integ?.short, integ?.name].some((n) => n && text.toLowerCase().includes(n.toLowerCase()));
  });
  let hits = tests.length ? open.filter((f) => tests.some((t) => t(f))) : open;
  if (byName.length) hits = hits.filter((f) => byName.includes(f)).length ? hits.filter((f) => byName.includes(f)) : byName;
  return [...hits].sort((a, b) => b.impact - a.impact);
}

export function localPlanner(getWorld: () => World, startWorkflow: (goal: string, threadId: string) => string, approve: (findingId: string) => void) {
  const threads = new Map<string, Thread>();
  const thread = (tid: string) => {
    if (!threads.has(tid)) threads.set(tid, { messages: [], run: [], pending: null });
    return threads.get(tid)!;
  };

  async function* tool(t: Thread, name: string, args: Record<string, unknown>, result: unknown, ms = 600): AsyncGenerator<ChatEvent> {
    const callId = id('call');
    t.run.push({ tool: name, title: name.replace(/_/g, ' '), detail: Object.entries(args).slice(0, 2).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') || 'no arguments', status: 'pending' });
    yield { event: 'tool_start', data: { id: callId, tool: name, args } };
    await sleep(ms);
    t.run[t.run.length - 1].status = 'done';
    yield { event: 'tool_end', data: { id: callId, tool: name, ok: true, seconds: Math.round(ms / 100) / 10, result: JSON.stringify(result).slice(0, 6000) } };
  }

  async function* say(t: Thread, text: string, quick: string[]): AsyncGenerator<ChatEvent> {
    const words = text.split(/(\s+)/);
    for (let i = 0; i < words.length; i += 6) {
      yield { event: 'token', data: { text: words.slice(i, i + 6).join('') } };
      await sleep(18);
    }
    t.messages.push({ id: id('m'), type: 'ai', content: text, timestamp: new Date().toISOString(), quickActions: QUICK(quick) });
  }

  const done = (t: Thread): ChatEvent => ({
    event: 'done',
    data: {
      messages: t.messages,
      pending_approval: t.pending ? { type: 'approval', actions: [{ tool_call_id: t.pending.callId, tool: 'approve_finding', args: { finding_id: t.pending.findingId }, integration: CATALOG_BY_ID[t.pending.integration ?? '']?.name ?? null }] } : null,
      run: t.run,
    },
  });

  async function* send(tid: string, message: string, context?: ChatContext): AsyncGenerator<ChatEvent> {
    const w = getWorld();
    const t = thread(tid);
    t.run = [];
    t.messages.push({ id: id('u'), type: 'user', content: message, timestamp: new Date().toISOString() });
    const m = message.toLowerCase();
    await sleep(250);

    // A chat opened from an agent session starts from that session.
    const session = context?.session_id ? w.sessions.find((s) => s.id === context.session_id) : undefined;
    if (session && !/approve|apply|start|run |launch|spin|kick off/.test(m)) {
      yield* tool(t, 'get_agent_session', { session_id: session.id }, { title: session.title, status: session.status, agents: session.agents.map((a) => a.name) });
      const steps = session.agents.flatMap((a) => a.steps.map((s) => ({ a: a.name, s })));
      const toolsUsed = steps.filter((x) => x.s.tool).length;
      const failed = steps.find((x) => x.s.status === 'failed');
      const lines = session.agents.map((a) => `- **${a.name}**: ${a.steps.filter((s) => s.kind !== 'plan').slice(-1)[0]?.text ?? a.role}`);
      const integrations = session.integrations.map((i) => CATALOG_BY_ID[i]?.short ?? i).join(', ') || 'Martian data only';
      const text = `“${session.title}” ${session.status === 'running' ? 'is still running.' : session.status === 'failed' ? `failed${failed ? ` at “${failed.s.title}”` : ''}.` : 'finished.'} ${session.agents.length} agents made ${toolsUsed} tool calls across ${integrations}.\n\n${lines.join('\n')}\n\n${session.summary ? `Outcome: ${session.summary}` : ''}`;
      yield* say(t, text.trim(), ['What should I do next?', 'Start a follow-up investigation']);
      yield done(t);
      return;
    }

    // "Approve X" is a request; "what can I approve?" is a question and gets a list instead.
    const question = /^(what|which|how|can|could|should|show|is|are)\b/.test(m.trim()) || m.trim().endsWith('?');
    if (/approve|apply|go ahead|do it/.test(m) && !question) {
      let hits = matchFindings(w, m).filter((f) => f.automatable);
      if (/quick win/.test(m)) hits = hits.filter((f) => f.difficulty === 'easy').length ? hits.filter((f) => f.difficulty === 'easy') : hits;
      yield* tool(t, 'list_findings', { status: 'open' }, { findings: hits.slice(0, 5).map((f) => ({ id: f.id, title: f.title, est_monthly_savings: Math.round(f.impact) })) });
      const f = hits[0];
      if (!f) {
        yield* say(t, "I couldn't find an open finding I can apply for that. The ones left need a person to make the change, or they've already been applied.", ['Show open findings']);
        yield done(t);
        return;
      }
      const callId = id('call');
      t.pending = { findingId: f.id, callId, title: f.title, impact: f.impact, integration: f.integration };
      t.run.push({ tool: 'approve_finding', title: 'approve finding', detail: `finding_id=${f.id}`, status: 'pending' });
      yield { event: 'tool_start', data: { id: callId, tool: 'approve_finding', args: { finding_id: f.id } } };
      yield { event: 'interrupt', data: { type: 'approval', actions: [{ tool_call_id: callId, tool: 'approve_finding', args: { finding_id: f.id }, integration: CATALOG_BY_ID[f.integration ?? '']?.name ?? null }] } };
      yield done(t);
      return;
    }

    if (/\b(start|run|launch|spin|kick off|investigate|scan|look into|dig into)\b/.test(m)) {
      const goal = message.replace(/^(please |can you |could you )/i, '').trim();
      const sessionId = startWorkflow(goal, tid);
      const s = getWorld().sessions.find((x) => x.id === sessionId);
      yield* tool(t, 'start_workflow', { goal }, { started: true, session_id: sessionId, session: { title: s?.title, agents: s?.agents.map((a) => a.name) } }, 500);
      yield* say(t, `Started “${s?.title ?? goal}”. ${s?.agents.length ?? 0} agents are on it: ${s?.agents.map((a) => a.name).join(', ')}. You can watch each step on the Agents page; it usually takes under a minute.`, ['What did it find?', 'Show open findings']);
      yield done(t);
      return;
    }

    if (/forecast|predict|peak|next week|tomorrow|scale/.test(m)) {
      const svc = Object.entries(w.services).filter(([, s]) => s.cpu != null).sort((a, b) => (b[1].cpu ?? 0) - (a[1].cpu ?? 0)).slice(0, 3);
      yield* tool(t, 'get_resource_telemetry', { node_ids: svc.map(([k]) => k) }, { services: svc.map(([k, s]) => ({ id: k, cpu: Math.round(s.cpu ?? 0) })) });
      yield* tool(t, 'forecast_utilization', { horizon_hours: 24, series: svc.length }, { ok: true }, 800);
      const rows = svc.map(([, s]) => {
        const p50 = Math.min(97, Math.round((s.baseCpu ?? 20) * 1.45));
        const p90 = Math.min(99, Math.round(p50 * 1.2));
        return `| ${s.spec.name} | ${Math.round(s.cpu ?? 0)}% | ${p50}% | ${p90}% | ${p90 > 80 ? 'Add capacity before the peak' : p90 < 35 ? 'Room to scale down' : 'Fine as is'} |`;
      });
      yield* say(t, `Projected peaks for the next 24 hours on your three busiest services:\n\n| Service | Now | Peak p50 | Peak p90 | Call |\n|---|--:|--:|--:|---|\n${rows.join('\n')}\n\nPlan around the p90 column; it's the peak you'd only pass about one day in ten.`, ['Start a scaling review', 'Show open findings']);
      yield done(t);
      return;
    }

    if (/topolog|what do we run|infrastructure|clusters?|inventory|map/.test(m)) {
      yield* tool(t, 'describe_topology', {}, { nodes: w.graph.nodes.length });
      const rows = w.variant.clusters.map((c) => {
        const svcs = c.services.map((sp) => w.services[`svc:${c.id}/${sp.id}`]);
        return `| ${c.name} | ${CATALOG_BY_ID[c.integration]?.short} | ${c.location} | ${money(svcs.reduce((n, s) => n + s.count * s.unitCost, 0))} |`;
      });
      yield* say(t, `${w.variant.org.name} runs ${w.variant.clusters.length} clusters that Martian can see.\n\n| Cluster | Through | Where | Monthly |\n|---|---|---|---|\n${rows.join('\n')}\n\nThe Infrastructure page has the full map with dependencies and live telemetry.`, ['Where is the most waste?', 'Forecast the next 24 hours']);
      yield done(t);
      return;
    }

    if (/integration|connected|connector|tools/.test(m)) {
      const ints = w.integrations.filter((i) => i.status !== 'available');
      yield* tool(t, 'list_integrations', {}, { integrations: ints.map((i) => i.id) });
      const lines = ints.map((i) => `- **${CATALOG_BY_ID[i.id]?.name}**: ${i.status === 'connected' ? (i.mode === 'read' ? 'connected, read-only' : i.mode === 'ask' ? 'connected, asks before writes' : 'connected, auto-approves small fixes') : 'needs new credentials'}`);
      yield* say(t, `You have ${ints.length} integrations set up.\n\n${lines.join('\n')}`, ['Where are we wasting money?']);
      yield done(t);
      return;
    }

    if (/agent|session|history|what happened|ran today|workflows?/.test(m)) {
      const recent = w.sessions.slice(0, 6);
      yield* tool(t, 'list_agent_sessions', { limit: 6 }, { sessions: recent.map((s) => s.id) });
      const lines = recent.map((s) => `- ${s.status === 'running' ? 'Running' : s.status === 'failed' ? 'Failed' : 'Done'}: **${s.title}**${s.summary ? `. ${s.summary}` : ''}`);
      yield* say(t, `The six most recent agent runs:\n\n${lines.join('\n')}\n\nOpen any of them on the Agents page for the full trace.`, ['Where are we wasting money?']);
      yield done(t);
      return;
    }

    const hits = matchFindings(w, m);
    const filtered = hits.length !== w.findings.filter((f) => f.state === 'open').length;
    if (/cost|waste|sav|spend|idle|duplicate|database|storage|gpu|snapshot|volume|kubernetes|network|cheaper|money|approve/.test(m) || filtered) {
      yield* tool(t, 'list_findings', { status: 'open' }, { findings: hits.map((f) => ({ id: f.id, title: f.title, est_monthly_savings: Math.round(f.impact) })) });
      if (!hits.length) {
        yield* say(t, "Nothing open matches that right now. Monitoring checks again every few minutes, and new waste lands on Overview as soon as it's found.", ['Show everything open']);
        yield done(t);
        return;
      }
      const total = hits.reduce((n, f) => n + f.impact, 0);
      const quick = hits.filter((f) => f.difficulty === 'easy');
      const rows = hits.slice(0, 6).map((f) => `| ${f.title} | ${f.scope} | ${money(f.impact)} | ${f.difficulty === 'easy' ? 'Quick win' : 'Needs review'} |`);
      const top = hits[0];
      yield* say(t, `${filtered ? `${hits.length} open finding${hits.length > 1 ? 's' : ''} match, worth **${money(total)}/mo**.` : `You could save **${money(total)}/mo** across ${hits.length} open findings.`} ${quick.length ? `${quick.length} of them are quick wins you could apply today.` : 'None of them are quick wins, so each needs a review.'}\n\n| Finding | Where | Per month | Effort |\n|---|---|--:|---|\n${rows.join('\n')}\n\nI'd start with **${top.title}**. ${top.description} ${top.automatable ? 'Say "approve it" and I\'ll show you the change before anything runs.' : 'It needs a person to make the change, so I can open a ticket instead.'}`,
        ['Approve the top quick win', 'Start an investigation', 'Forecast the next 24 hours']);
      yield done(t);
      return;
    }

    // Default: the overview.
    yield* tool(t, 'get_overview', {}, { monthly_cost: Math.round(monthlyCost(w)), waste_identified: Math.round(openWaste(w)) });
    yield* say(t, `${w.variant.org.name} spends **${money(monthlyCost(w))}/mo** on ${resourceCount(w).toLocaleString('en-US')} resources in ${accountsCount(w)} cloud accounts, plus ${w.variant.clusters.filter((c) => c.env !== 'cloud').length} on-prem or edge clusters. Health is ${healthScore(w)} out of 100, and **${money(openWaste(w))}/mo** sits in open findings.\n\nAsk where the waste is or what a service will need tomorrow, and I'll send agents to check.`,
      ['Where are we wasting money?', 'What do we run?', 'Forecast the next 24 hours']);
    yield done(t);
  }

  async function* resume(tid: string, approved: boolean): AsyncGenerator<ChatEvent> {
    const t = thread(tid);
    const p = t.pending;
    t.pending = null;
    t.run = [];
    if (!p) { yield done(t); return; }
    if (approved) {
      approve(p.findingId);
      t.run.push({ tool: 'approve_finding', title: 'approve finding', detail: `finding_id=${p.findingId}`, status: 'done' });
      yield { event: 'tool_end', data: { id: p.callId, tool: 'approve_finding', ok: true, seconds: 0.4, result: JSON.stringify({ approved: true, finding_id: p.findingId, title: p.title, status: 'queued', handled: true }) } };
      yield* say(t, `Approved “${p.title}”. The remediation agents are applying it now, and the saving (about ${money(p.impact)}/mo) moves to realized savings on Overview when they finish.`, ['What else can I approve?', 'Show open findings']);
    } else {
      yield { event: 'tool_end', data: { id: p.callId, tool: 'approve_finding', ok: false, seconds: 0, result: 'declined' } };
      yield* say(t, `I left “${p.title}” alone. It stays open on Overview if you change your mind.`, ['Show open findings']);
    }
    yield done(t);
  }

  return { send, resume };
}
