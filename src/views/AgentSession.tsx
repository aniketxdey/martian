/**
 * One agent run, laid out like an artifact beside a chat. Left: a map of what each
 * agent touched (session → agents → integrations → clusters and services) and the full
 * step-by-step trace. Right: a chat scoped to this run, which starts fresh each visit.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LIVE } from '../app/env';
import { fmtTime, usePrefs } from '../app/prefs';
import { Link, useRouter } from '../app/router';
import { useActions, useApp } from '../app/store';
import { ChatMessage, useChat } from '../app/useChat';
import { duration, IntegrationLogo, LogoStack, StatusPill, usd } from '../components/bits';
import { Composer, Conversation } from '../components/chat/ChatPanel';
import { ForceGraph } from '../components/graph/ForceGraph';
import { useZoom, ZoomOverlay } from '../components/Zoom';
import { sessionModel } from '../components/graph/models';
import { CATALOG_BY_ID } from '../data/catalog';
import { PageHeader } from '../shell/AppShell';
import type { AgentRun, AgentSession as Session, StepKind, TraceStep } from '../state/types';
import { IconArrowLeft, IconChat, IconChevronDown, IconClose, IconFilter, IconPlay } from '../ui/icons';
import { Button, cx, SegTabs } from '../ui/kit';

const KIND: Record<StepKind, string> = { plan: 'Plan', tool: 'Tool call', observe: 'Observation', decide: 'Decision', handoff: 'Handoff', approval: 'Approval', result: 'Result' };
const SOURCE: Record<Session['source'], string> = { chat: 'From chat', workflow: 'Workflow', schedule: 'Scheduled', scan: 'Scan', approval: 'Approved change' };

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } },
};

function useWide(query = '(min-width: 1024px)') {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : true);
  const [wide, setWide] = useState(get);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return wide;
}

const offset = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const pretty = (raw: string | undefined, max = 2400) => {
  if (!raw) return '';
  try { raw = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* not JSON */ }
  return raw.length > max ? `${raw.slice(0, max)}\n… ${raw.length - max} more characters` : raw;
};

/* ---------- trace ---------- */

function StepDot({ st }: { st: TraceStep }) {
  return (
    <span className={cx(
      'relative z-[1] mt-1 flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-2 bg-surface',
      st.status === 'done' ? 'border-ok' : st.status === 'failed' ? 'border-danger' : st.status === 'running' ? 'border-accent' : 'border-line-strong',
    )}>
      <span className={cx('h-1.5 w-1.5 rounded-full', st.status === 'done' ? 'bg-ok' : st.status === 'failed' ? 'bg-danger' : st.status === 'running' ? 'animate-pulse bg-accent' : 'bg-line-strong')} />
    </span>
  );
}

const Step = React.memo(function Step({ st, start, now, label }: { st: TraceStep; start: number; now: number; label: (id: string) => string | null }) {
  const { prefs } = usePrefs();
  const ms = st.status === 'running' ? now - st.at : st.durationMs;
  const target = st.target ? label(st.target) : null;
  const pending = st.status === 'pending';
  return (
    <li className={cx('relative flex gap-3.5 pb-5 last:pb-1', pending && 'opacity-55')}>
      <span aria-hidden="true" className="absolute bottom-0 left-[8.5px] top-6 w-px bg-line last-of-type:hidden" />
      <StepDot st={st} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-sm font-medium text-fg">{st.title}</span>
          <span className="rounded bg-chip px-1.5 py-px font-mono text-11 text-fg-body">{KIND[st.kind]}</span>
          <span className="ml-auto flex-none font-mono text-xs tabular-nums text-fg-faint" title={fmtTime(st.at, prefs.clock)}>
            {offset(st.at - start)}{!pending && ` · ${duration(Math.max(0, ms))}`}
          </span>
        </div>
        {(st.tool || target) && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {st.integration && <IntegrationLogo id={st.integration} size={18} />}
            {st.tool && <code className="font-mono text-fg-2">{st.tool}</code>}
            {target && <span className="text-fg-muted">on {target}</span>}
          </div>
        )}
        <p className="m-0 text-13 leading-relaxed text-fg-body">{st.status === 'running' && !st.result ? (st.text === 'Running…' ? 'Running' : st.text) : st.text}</p>
        {st.metrics && st.metrics.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {st.metrics.map((m) => (
              <span key={m.label} className="rounded-md border border-line-soft bg-canvas px-2 py-0.5 font-mono text-11 text-fg-2">
                <span className="text-fg-faint">{m.label}</span> {m.value}
              </span>
            ))}
          </div>
        )}
        {(st.args && Object.keys(st.args).length > 0) || st.result ? (
          <div className="flex flex-col gap-1">
            {st.args && Object.keys(st.args).length > 0 && (
              <details className="group rounded-md border border-line-soft bg-canvas">
                <summary className="cursor-pointer list-none px-2.5 py-1.5 font-mono text-11 text-fg-muted marker:hidden hover:text-fg">Arguments</summary>
                <pre className="m-0 max-h-64 overflow-auto border-t border-line-soft px-2.5 py-2 font-mono text-11 leading-relaxed text-fg-2">{JSON.stringify(st.args, null, 2)}</pre>
              </details>
            )}
            {st.result && (
              <details className="group rounded-md border border-line-soft bg-canvas">
                <summary className="cursor-pointer list-none px-2.5 py-1.5 font-mono text-11 text-fg-muted marker:hidden hover:text-fg">Result</summary>
                <pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-line-soft px-2.5 py-2 font-mono text-11 leading-relaxed text-fg-2">{pretty(st.result)}</pre>
              </details>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
});

function AgentBlock({ a, start, now, steps, label, open, onToggle }: {
  a: AgentRun; start: number; now: number; steps: TraceStep[]; label: (id: string) => string | null; open: boolean; onToggle: () => void;
}) {
  const end = a.endedAt ?? (a.status === 'running' ? now : Math.max(a.startedAt, ...a.steps.map((x) => x.at + x.durationMs)));
  const status = a.status === 'done' ? 'completed' : a.status === 'failed' ? 'failed' : a.status === 'running' ? 'running' : 'pending';
  const calls = a.steps.filter((x) => x.tool).length;
  return (
    <section aria-label={a.name} className={cx('rounded-xl border bg-surface', a.status === 'running' ? 'border-accent/60' : 'border-line')}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3.5 text-left">
        <span className={cx('flex h-8 w-8 flex-none items-center justify-center rounded-lg font-mono text-xs font-semibold', a.status === 'running' ? 'bg-accent text-white' : 'bg-chip text-fg-2')}>
          {a.name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-15 font-semibold text-fg">{a.name}</span>
            <StatusPill status={status} />
          </span>
          <span className="truncate text-13 text-fg-muted">{a.role}</span>
        </span>
        <span className="flex flex-none items-center gap-3 max-sm:hidden">
          {a.integrations.length > 0 && <LogoStack ids={a.integrations} size={20} />}
          <span className="font-mono text-xs tabular-nums text-fg-faint">{calls} call{calls === 1 ? '' : 's'} · {duration(Math.max(0, end - a.startedAt))}</span>
        </span>
        <IconChevronDown size={16} className={cx('flex-none text-fg-faint transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <ol className="m-0 list-none border-t border-line-soft px-4 pb-3 pt-4">
          {steps.length === 0
            ? <li className="pb-2 text-13 text-fg-muted">No steps match the filter.</li>
            : steps.map((st) => <Step key={st.id} st={st} start={start} now={now} label={label} />)}
        </ol>
      )}
    </section>
  );
}

/* ---------- left pane ---------- */

function RunPane({ s }: { s: Session }) {
  const graph = useApp((st) => st.graph);
  const now = useApp((st) => st.now);
  const [sel, setSel] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const model = useMemo(() => sessionModel(s, graph), [s, graph]);
  const labels = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.label])), [graph]);
  const label = useCallback((id: string) => labels.get(id) ?? null, [labels]);

  // A selected node narrows the trace to the steps that touched it.
  const match = useCallback((a: AgentRun, st: TraceStep) => {
    if (!sel || sel === 'session') return true;
    if (sel.startsWith('agent:')) return `agent:${a.id}` === sel;
    if (sel.startsWith('int:')) return st.integration === sel.slice(4);
    return st.target === sel;
  }, [sel]);
  const agents = s.agents.filter((a) => a.steps.some((st) => match(a, st)) || (sel === `agent:${a.id}`));
  const selLabel = sel && sel !== 'session' ? model.nodes.find((n) => n.id === sel)?.label : null;

  const steps = s.agents.flatMap((a) => a.steps);
  const calls = steps.filter((x) => x.tool).length;
  const end = s.endedAt ?? now;
  const traceRef = useRef<HTMLDivElement>(null);
  const zoom = useZoom();
  const mapBox = useRef<HTMLDivElement>(null);
  const onSelect = (id: string | null) => {
    setSel(id);
    if (id && id !== 'session') {
      if (id.startsWith('agent:')) setClosed((c) => { const n = new Set(c); n.delete(id.slice(6)); return n; });
      requestAnimationFrame(() => traceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  return (
    <div className="box-border flex flex-col gap-5 p-6 max-sm:p-4">
      <div className="flex flex-col gap-2">
        <p className="m-0 text-13 leading-relaxed text-fg-muted"><span className="font-medium text-fg-body">Goal.</span> {s.goal}</p>
        {s.summary && <p className="m-0 text-sm leading-relaxed text-fg-2">{s.summary}</p>}
      </div>
      <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] overflow-hidden rounded-xl border border-line bg-surface">
        {[
          { l: 'Agents', v: String(s.agents.length) },
          { l: 'Tool calls', v: String(calls) },
          { l: 'Duration', v: duration(Math.max(0, end - s.startedAt)) },
          { l: 'Integrations', v: String(s.integrations.length) },
          ...(s.savings ? [{ l: s.source === 'approval' ? 'Saves' : 'Found', v: `${usd(s.savings)}/mo`, c: 'text-ok' }] : []),
          ...(s.resourcesTouched ? [{ l: 'Resources', v: s.resourcesTouched.toLocaleString('en-US') }] : []),
        ].map((x, i, arr) => (
          <div key={x.l} className={cx('flex flex-col gap-0.5 px-4 py-3', i < arr.length - 1 && 'border-r border-line-soft')}>
            <dt className="text-xs text-fg-muted">{x.l}</dt>
            <dd className={cx('m-0 font-mono text-lg font-medium tabular-nums', (x as { c?: string }).c)}>{x.v}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-15 font-semibold">Map</h2>
          <span className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent/70" />tool calls (thicker = more)</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-accent" />running now</span>
          </span>
        </div>
        <div ref={mapBox}>
          <ForceGraph
            nodes={model.nodes}
            edges={model.edges}
            layoutKey={model.layoutKey}
            selected={sel}
            onSelect={onSelect}
            height={500}
            ariaLabel={`Map of agent run ${s.title}`}
            layout={{ mode: 'radial', gap: 22, step: 92, minRadius: 84 }}
            onExpand={() => zoom.open(mapBox.current)}
          />
        </div>
        <ZoomOverlay state={zoom.state} onClose={zoom.close} label={`Map of ${s.title}`}>
          <ForceGraph
            nodes={model.nodes}
            edges={model.edges}
            layoutKey={`${model.layoutKey}:full`}
            selected={sel}
            onSelect={(id) => { zoom.close(); onSelect(id); }}
            height="100%"
            className="rounded-none border-0"
            ariaLabel={`Map of agent run ${s.title}, full screen`}
            layout={{ mode: 'radial', gap: 26, step: 120, minRadius: 100, stretch: 1.4 }}
          />
        </ZoomOverlay>
      </div>

      <div ref={traceRef} className="flex scroll-mt-20 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-15 font-semibold">Trace</h2>
          <div className="flex items-center gap-2">
            {selLabel && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent bg-accent-wash py-1 pl-2.5 pr-1 text-xs text-accent-ink">
                <IconFilter size={12} />{selLabel}
                <button type="button" aria-label="Clear filter" onClick={() => setSel(null)} className="ix-btn flex h-5 w-5 items-center justify-center rounded-full border-0 bg-transparent text-accent-ink hover:bg-accent/15"><IconClose size={12} /></button>
              </span>
            )}
            <button type="button" onClick={() => setClosed(closed.size ? new Set() : new Set(s.agents.map((a) => a.id)))} className="ix-btn h-8 rounded-md border border-line bg-surface px-2.5 text-xs text-fg-body hover:border-fg-faint">
              {closed.size ? 'Expand all' : 'Collapse all'}
            </button>
          </div>
        </div>
        {agents.length === 0 && <p className="m-0 rounded-xl border border-line bg-surface px-4 py-6 text-center text-13 text-fg-muted">{s.status === 'running' ? 'Agents are starting.' : 'No steps touched this node.'}</p>}
        {agents.map((a) => (
          <AgentBlock
            key={a.id} a={a} start={s.startedAt} now={now} label={label}
            steps={a.steps.filter((st) => match(a, st))}
            open={!closed.has(a.id)}
            onToggle={() => setClosed((c) => { const n = new Set(c); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------- right pane ---------- */

function ChatPane({ s, onClose }: { s: Session; onClose?: () => void }) {
  const welcome = useMemo<ChatMessage>(() => {
    const calls = s.agents.reduce((n, a) => n + a.steps.filter((x) => x.tool).length, 0);
    const ints = s.integrations.map((i) => CATALOG_BY_ID[i]?.short ?? i);
    const state = s.status === 'running' ? 'is still running' : s.status === 'waiting' ? 'is waiting for an approval' : s.status === 'failed' ? 'failed' : 'finished';
    return {
      id: 'welcome', type: 'ai', at: Date.now(),
      content: `This run ${state}. ${s.agents.length} agent${s.agents.length === 1 ? '' : 's'} made ${calls} tool call${calls === 1 ? '' : 's'}${ints.length ? ` across ${ints.slice(0, 4).join(', ')}${ints.length > 4 ? ` and ${ints.length - 4} more` : ''}` : ''}.\n\nAsk why an agent made a call, what a result means, or what to do next. I can also start a follow-up workflow from here.`,
      quickActions: [
        { text: 'Summarize this run', action: 'Summarize this run' },
        { text: 'What should I do next?', action: 'Based on this run, what should I do next?' },
        { text: 'Run it again', action: `Start a workflow: ${s.goal}` },
      ],
    };
    // Built once per visit; the chat starts fresh each time the session opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id]);
  const chat = useChat({ context: { session_id: s.id, session_title: s.title, kind: 'session' }, welcome });
  return (
    <section aria-label="Chat about this run" className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-12 flex-none items-center justify-between gap-2 border-b border-line px-5">
        <span className="flex items-center gap-2 text-sm font-semibold"><IconChat size={16} className="text-accent" />Ask about this run</span>
        <span className="flex items-center gap-1">
          <button type="button" onClick={chat.reset} className="ix-btn h-8 rounded-md border-0 bg-transparent px-2 text-xs text-fg-muted hover:bg-chip hover:text-fg">Clear</button>
          {onClose && <button type="button" aria-label="Hide chat" onClick={onClose} className="ix-btn flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-fg-muted hover:bg-chip"><IconClose size={15} /></button>}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <Conversation chat={chat} compact />
      </div>
      <div className="flex-none border-t border-line px-4 pb-4 pt-3">
        <Composer chat={chat} compact placeholder="Ask about this run…" scope={`Scoped to ${s.id.slice(0, 14)}`} />
      </div>
    </section>
  );
}

/* ---------- page ---------- */

const MIN_CHAT = 340;

export const AgentSession = ({ id }: { id: string }) => {
  const s = useApp((st) => st.sessions.find((x) => x.id === id) ?? null);
  const live = useApp((st) => st.mode.live);
  const { loadSession, startWorkflow } = useActions();
  const { navigate } = useRouter();
  const wide = useWide();
  const [tab, setTab] = useState<'run' | 'chat'>('run');
  const [chatOpen, setChatOpen] = useState(true);
  const [width, setWidth] = useState(() => Number(store.get('martian.session.chat')) || 440);
  const [loading, setLoading] = useState(LIVE && !s);
  const box = useRef<HTMLDivElement>(null);

  // Live mode: fetch the full trace, and keep polling while the run is moving.
  const running = s?.status === 'running' || s?.status === 'waiting';
  useEffect(() => {
    if (!live) return;
    let stop = false;
    void loadSession(id).finally(() => { if (!stop) setLoading(false); });
    const t = running ? window.setInterval(() => void loadSession(id), 3000) : null;
    return () => { stop = true; if (t) window.clearInterval(t); };
  }, [id, live, running, loadSession]);

  const drag = useRef<{ x: number; w: number } | null>(null);
  const clampW = (w: number) => {
    const total = box.current?.clientWidth ?? 1200;
    return Math.round(Math.max(MIN_CHAT, Math.min(total * 0.6, w)));
  };
  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, w: width };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setWidth(clampW(drag.current.w + (drag.current.x - e.clientX)));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    store.set('martian.session.chat', String(width));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 80 : 24;
    if (e.key === 'ArrowLeft') { e.preventDefault(); const w = clampW(width + step); setWidth(w); store.set('martian.session.chat', String(w)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); const w = clampW(width - step); setWidth(w); store.set('martian.session.chat', String(w)); }
  };

  if (!s) {
    return (
      <>
        <PageHeader title="Agent run" meta={<Link to="/agents" className="text-13 text-fg-muted no-underline hover:text-fg">All runs</Link>} />
        <div className="ambient-glow flex flex-1 flex-col items-center justify-center gap-3 p-16 text-center">
          {loading ? <p className="m-0 text-sm text-fg-muted">Loading the run…</p> : (
            <>
              <h2 className="m-0 text-lg font-semibold">This run isn't here</h2>
              <p className="m-0 max-w-[420px] text-sm text-fg-muted">It may belong to another workspace, or the demo data was regenerated since you opened the link.</p>
              <Button onClick={() => navigate('/agents')}>Back to all runs</Button>
            </>
          )}
        </div>
      </>
    );
  }

  const again = async () => {
    const nid = await startWorkflow(s.goal);
    if (nid) navigate(`/agents/${nid}`);
  };
  const showChat = wide ? chatOpen : tab === 'chat';

  return (
    <>
      <PageHeader
        title={s.title}
        meta={<>
          <StatusPill status={s.status} />
          <span className="font-mono text-xs text-fg-muted max-md:hidden">{SOURCE[s.source]} · {new Date(s.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{s.requestedBy ? ` · ${s.requestedBy}` : ''}</span>
        </>}
        actions={<>
          <Link to="/agents" className="ix-btn flex h-[38px] items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-13 text-fg-2 no-underline hover:border-fg-faint"><IconArrowLeft size={14} />All runs</Link>
          {s.source !== 'approval' && <button type="button" onClick={() => void again()} className="ix-btn flex h-[38px] items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-13 text-fg-2 hover:border-fg-faint"><IconPlay size={13} />Run again</button>}
          {wide && !chatOpen && <button type="button" onClick={() => setChatOpen(true)} className="ix-btn-primary flex h-[38px] items-center gap-1.5 rounded-lg border-0 bg-accent px-3 text-13 font-medium text-white"><IconChat size={15} />Ask about this run</button>}
        </>}
      />
      {!wide && (
        <div className="sticky top-16 z-10 flex justify-center border-b border-line bg-surface px-4 py-2">
          <SegTabs<'run' | 'chat'> items={[{ key: 'run', label: 'Run' }, { key: 'chat', label: 'Chat' }]} value={tab} onChange={setTab} label="View" />
        </div>
      )}
      <div ref={box} className="flex min-w-0 flex-1 lg-app-h lg:flex-none">
        {(wide || tab === 'run') && (
          <div className="min-w-0 flex-1 overflow-y-auto scrollbar-thin bg-canvas">
            <div className="mx-auto max-w-[1100px]">
              <RunPane s={s} />
            </div>
          </div>
        )}
        {showChat && wide && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat"
            aria-valuenow={width}
            aria-valuemin={MIN_CHAT}
            tabIndex={0}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onKeyDown={onKey}
            onDoubleClick={() => { setWidth(440); store.set('martian.session.chat', '440'); }}
            className="group relative w-px flex-none cursor-col-resize bg-line outline-none focus-visible:bg-accent"
          >
            <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
            <span className="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
          </div>
        )}
        {showChat && (
          <div className={cx('min-w-0', wide ? 'flex-none' : 'flex h-[calc(100dvh-7.5rem)] flex-1 flex-col')} style={wide ? { width } : undefined}>
            <ChatPane key={s.id} s={s} onClose={wide ? () => setChatOpen(false) : undefined} />
          </div>
        )}
      </div>
    </>
  );
};
