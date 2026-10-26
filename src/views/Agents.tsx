import React, { useMemo, useState } from 'react';
import { useRouter } from '../app/router';
import { useActions, useApp } from '../app/store';
import { duration, LogoStack, StatusPill, usd } from '../components/bits';
import { Page, PageHeader, PageHeading } from '../shell/AppShell';
import type { AgentSession, SessionSource } from '../state/types';
import { IconArrowRight, IconPlus, IconSearch } from '../ui/icons';
import { Button, Card, cx, Dialog, SegTabs } from '../ui/kit';

type Filter = 'all' | 'running' | 'chat' | 'schedule' | 'changes' | 'failed';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'running', label: 'Running' }, { key: 'chat', label: 'From chat' },
  { key: 'schedule', label: 'Scheduled' }, { key: 'changes', label: 'Changes' }, { key: 'failed', label: 'Failed' },
];
const SOURCE: Record<SessionSource, string> = { chat: 'Chat', workflow: 'Workflow', schedule: 'Scheduled', scan: 'Scan', approval: 'Change' };

const IDEAS = ['Look for idle VMs in every cloud', 'Find duplicate data on our file shares', 'Check whether our databases are oversized', 'Forecast next week for the busiest services', 'Review access for every integration'];

const day = (now: number, t: number) => {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  if (t >= d0.getTime()) return 'Today';
  if (t >= d0.getTime() - 86_400_000) return 'Yesterday';
  if (t >= d0.getTime() - 6 * 86_400_000) return 'Earlier this week';
  return 'Older';
};

function progress(s: AgentSession) {
  const steps = s.agents.flatMap((a) => a.steps);
  if (!steps.length) return { pct: 4, current: 'Planning' };
  const done = steps.filter((x) => x.status === 'done' || x.status === 'failed').length;
  const cur = s.agents.flatMap((a) => a.steps.filter((x) => x.status === 'running').map((x) => `${a.name} · ${x.title}`))[0];
  return { pct: Math.max(4, Math.round((done / steps.length) * 100)), current: cur ?? (done === steps.length ? 'Wrapping up' : 'Starting the next agent') };
}

function Row({ s, now, onOpen }: { s: AgentSession; now: number; onOpen: () => void }) {
  const end = s.endedAt ?? now;
  const agents = new Set(s.agents.map((a) => a.name)).size;
  const p = s.status === 'running' ? progress(s) : null;
  const tools = s.agents.reduce((n, a) => n + a.steps.filter((x) => x.tool).length, 0);
  return (
    <li>
      <button type="button" data-cursor="Open" onClick={onOpen} className={cx('ix-row group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 border-0 border-b border-line-soft bg-transparent px-5 py-4 text-left transition-colors hover:bg-canvas', s.status === 'running' && 'bg-accent-wash/30')}>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StatusPill status={s.status} />
            <span className="min-w-0 truncate text-15 font-medium text-fg">{s.title}</span>
          </div>
          <span className="truncate text-13 text-fg-muted">
            {p ? p.current : s.summary ?? s.goal}
          </span>
          {p && (
            <span className="h-1 max-w-[420px] overflow-hidden rounded-full bg-line-soft">
              <span className="block h-full rounded-full bg-accent transition-[width] duration-700 ease-out" style={{ width: `${p.pct}%` }} />
            </span>
          )}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-fg-faint">
            <span>{SOURCE[s.source]}</span>
            <span>{new Date(s.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            <span>{duration(end - s.startedAt)}</span>
            <span>{agents} agent{agents === 1 ? '' : 's'} · {tools} tool call{tools === 1 ? '' : 's'}</span>
            {s.requestedBy && <span>by {s.requestedBy}</span>}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {s.savings ? <span className={cx('font-mono text-sm tabular-nums', s.source === 'approval' && s.status === 'completed' ? 'text-ok' : 'text-fg-2')}>{usd(s.savings)}/mo</span> : null}
          {s.integrations.length > 0 && <LogoStack ids={s.integrations} />}
          <IconArrowRight size={16} className="ix-arrow text-fg-faint group-hover:text-accent" />
        </div>
      </button>
    </li>
  );
}

function NewWorkflow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [goal, setGoal] = useState('');
  const { startWorkflow } = useActions();
  const { navigate } = useRouter();
  const go = async (g: string) => {
    if (!g.trim()) return;
    const id = await startWorkflow(g.trim());
    onClose();
    setGoal('');
    if (id) navigate(`/agents/${id}`);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      label="Start a workflow"
      width={560}
      header={<div className="flex flex-col gap-1"><h2 className="m-0 text-lg font-semibold">Start a workflow</h2><p className="m-0 text-13 text-fg-muted">Say what you want checked. Martian picks the agents and integrations, and stops for approval before any change.</p></div>}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!goal.trim()} onClick={() => void go(goal)}>Start</Button></>}
    >
      <div className="flex flex-col gap-4 p-6">
        <textarea
          autoFocus
          rows={3}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void go(goal); }}
          placeholder="e.g. Find databases we could make smaller without hurting latency"
          className="box-border w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-fg outline-none focus:border-fg-faint"
        />
        <div className="flex flex-wrap gap-2">
          {IDEAS.map((i) => <button key={i} type="button" onClick={() => setGoal(i)} className="ix-btn min-h-[34px] rounded-full border border-line bg-canvas px-3 text-13 text-fg-body hover:border-fg-faint">{i}</button>)}
        </div>
      </div>
    </Dialog>
  );
}

export const Agents = () => {
  const sessions = useApp((s) => s.sessions);
  const now = useApp((s) => Math.floor(s.now / 5000) * 5000);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { navigate } = useRouter();

  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return sessions.filter((s) => {
      if (filter === 'running' && !(s.status === 'running' || s.status === 'waiting')) return false;
      if (filter === 'chat' && s.source !== 'chat') return false;
      if (filter === 'schedule' && !(s.source === 'schedule' || s.source === 'scan')) return false;
      if (filter === 'changes' && s.source !== 'approval') return false;
      if (filter === 'failed' && s.status !== 'failed') return false;
      if (qq && !`${s.title} ${s.goal} ${s.summary ?? ''} ${s.integrations.join(' ')}`.toLowerCase().includes(qq)) return false;
      return true;
    }).sort((a, b) => b.startedAt - a.startedAt);
  }, [sessions, filter, q]);

  const groups = useMemo(() => {
    const m = new Map<string, AgentSession[]>();
    for (const s of shown) {
      const k = s.status === 'running' || s.status === 'waiting' ? 'Running now' : day(now, s.startedAt);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [shown, now]);

  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const running = sessions.filter((s) => s.status === 'running').length;
  const doneToday = sessions.filter((s) => s.status === 'completed' && (s.endedAt ?? 0) >= today.getTime()).length;
  const calls = sessions.filter((s) => s.startedAt >= today.getTime()).reduce((n, s) => n + s.agents.reduce((m, a) => m + a.steps.filter((x) => x.tool).length, 0), 0);
  const saved = sessions.filter((s) => s.source === 'approval' && s.status === 'completed').reduce((n, s) => n + (s.savings ?? 0), 0);

  return (
    <>
      <PageHeader title="Agents" actions={<Button variant="primary" size="sm" onClick={() => setCreating(true)}><IconPlus size={15} />New workflow</Button>} />
      <Page>
        <PageHeading title="Agent runs" sub="Every agent run, newest first. Open one for a map of what each agent touched and the full step-by-step trace." />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
          {[
            { l: 'Running now', v: String(running), c: running ? 'text-accent' : '' },
            { l: 'Finished today', v: String(doneToday) },
            { l: 'Tool calls today', v: calls.toLocaleString('en-US') },
            { l: 'Saved by approved changes', v: `${usd(saved)}/mo`, c: 'text-ok' },
          ].map((x) => (
            <Card key={x.l} className="flex flex-col gap-1 px-5 py-4">
              <span className="text-13 text-fg-muted">{x.l}</span>
              <span className={cx('font-mono text-26 font-medium tabular-nums', x.c)}>{x.v}</span>
            </Card>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegTabs<Filter> items={FILTERS} value={filter} onChange={setFilter} label="Filter runs" />
          <label className="box-border flex h-10 w-[280px] max-w-full items-center gap-2 rounded-lg border border-line-strong bg-surface px-3">
            <IconSearch size={16} className="text-fg-faint" />
            <span className="sr-only-clip">Search runs</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search runs" className="min-w-0 flex-1 border-0 bg-transparent text-sm text-fg outline-none" />
          </label>
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {groups.length === 0 && <p className="ambient-glow m-0 px-5 py-12 text-center text-sm text-fg-muted">No runs match. Try another filter, or start a workflow.</p>}
          {groups.map(([label, list]) => (
            <section key={label} aria-label={label}>
              <h3 className="m-0 border-b border-line-soft bg-canvas px-5 py-2 font-mono text-11 font-medium uppercase tracking-[0.06em] text-fg-faint">{label} · {list.length}</h3>
              <ul className="m-0 list-none p-0">
                {list.map((s) => <Row key={s.id} s={s} now={now} onOpen={() => navigate(`/agents/${s.id}`)} />)}
              </ul>
            </section>
          ))}
        </div>
      </Page>
      <NewWorkflow open={creating} onClose={() => setCreating(false)} />
    </>
  );
};
