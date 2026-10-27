import React, { useEffect, useState } from 'react';
import { EMBED } from '../app/env';
import { Cursor } from '../components/Cursor';
import { Link, prefetch, RouteKey, useRouter } from '../app/router';
import { useActions, useApp } from '../app/store';
import { IconAgents, IconChat, IconClose, IconMenu, IconOverview, IconPlug, IconServer, IconSignOut, IconSliders, MartianMark } from '../ui/icons';
import { cx } from '../ui/kit';

const NAV: { key: RouteKey; to: string; label: string; Icon: (p: any) => JSX.Element }[] = [
  { key: 'overview', to: '/overview', label: 'Overview', Icon: IconOverview },
  { key: 'chat', to: '/chat', label: 'Quick Chat', Icon: IconChat },
  { key: 'agents', to: '/agents', label: 'Agents', Icon: IconAgents },
  { key: 'infrastructure', to: '/infrastructure', label: 'Infrastructure', Icon: IconServer },
  { key: 'integrations', to: '/integrations', label: 'Integrations', Icon: IconPlug },
  { key: 'settings', to: '/settings', label: 'Settings', Icon: IconSliders },
];

/** Agents working because someone asked in chat. Hidden when nothing is running. */
function RunningAgents({ onOpen }: { onOpen: () => void }) {
  const runs = useApp((s) => s.sessions
    .filter((x) => x.fromChat && (x.status === 'running' || x.status === 'waiting'))
    .map((x) => {
      const steps = x.agents.flatMap((a) => a.steps.map((st) => ({ a: a.name, st })));
      const cur = steps.find((p) => p.st.status === 'running') ?? steps.filter((p) => p.st.status === 'done').slice(-1)[0];
      const done = steps.filter((p) => p.st.status === 'done').length;
      return `${x.id}|${x.title}|${x.status}|${cur ? `${cur.a} · ${cur.st.title}` : 'Planning'}|${steps.length ? Math.round((done / steps.length) * 100) : 5}|${new Set(x.agents.map((a) => a.name)).size}`;
    }).join('\n'));
  const { navigate } = useRouter();
  if (!runs) return null;
  const items = runs.split('\n').map((r) => {
    const [id, title, status, step, pct, agents] = r.split('|');
    return { id, title, status, step, pct: Number(pct), agents: Number(agents) };
  });
  const agentCount = items.reduce((n, i) => n + Math.max(1, i.agents), 0);
  return (
    <div className="flex animate-fade-up flex-col gap-2.5 rounded-xl border border-ink-line bg-ink-2 p-3.5" aria-live="polite">
      <button type="button" onClick={onOpen} className="flex items-center justify-between border-0 bg-transparent p-0 text-left text-white">
        <span className="text-13 font-semibold">Agents</span>
        <span className="flex items-center gap-1.5 text-xs text-ok-sideText"><span className="h-[7px] w-[7px] animate-pulse rounded-full bg-ok-side" />{agentCount} working</span>
      </button>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {items.slice(0, 3).map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => navigate(`/agents/${i.id}`)} className="flex w-full flex-col gap-1.5 border-0 bg-transparent p-0 text-left">
              <span className="truncate text-xs font-medium text-white">{i.title}</span>
              <span className="truncate font-mono text-11 text-side-muted">{i.status === 'waiting' ? 'Waiting for your approval' : i.step}</span>
              <span className="h-1 overflow-hidden rounded-full bg-ink-line">
                <span className="block h-full rounded-full bg-accent-soft w-full origin-left transition-transform duration-700 ease-out" style={{ transform: `scaleX(${parseFloat(`${Math.max(6, i.pct)}%`) / 100})` }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Sidebar() {
  const { route, navigate } = useRouter();
  const user = useApp((s) => s.user);
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const active: RouteKey = route.key === 'session' ? 'agents' : route.key;
  useEffect(() => { setOpen(false); }, [route.path]);
  // Warm the most likely next pages once the browser is idle.
  useEffect(() => {
    const idle = (window as any).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 600));
    idle(() => { for (const n of NAV) void prefetch(n.key); void prefetch('session'); }, { timeout: 1200 });
  }, []);
  return (
    <aside className="box-border flex flex-[1_1_240px] flex-col gap-7 bg-ink px-3.5 py-5 text-white max-md:gap-4 max-md:py-3 md-side-h md:max-w-[260px]">
      <div className="flex items-center justify-between">
        <Link to="/overview" className="flex items-center gap-2 px-2 py-1 text-lg font-semibold text-white no-underline">
          <MartianMark />
          Martian
        </Link>
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="ix-btn hidden h-11 w-11 items-center justify-center rounded-lg border-0 bg-transparent text-side-muted max-md:flex"
        >
          {open ? <IconClose /> : <IconMenu />}
        </button>
      </div>
      <div className={cx('flex min-h-0 flex-1 flex-col gap-7', !open && 'max-md:hidden')}>
        <nav aria-label="Main" className="relative flex flex-col gap-0.5">
          {/* One pill that glides to the active item (40px rows, 2px gap). */}
          {NAV.some((n) => n.key === active) && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-10 rounded-lg bg-ink-3 transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)]"
              style={{ transform: `translateY(${NAV.findIndex((n) => n.key === active) * 42}px)` }}
            />
          )}
          {NAV.map(({ key, to, label, Icon }) => {
            const on = key === active;
            return (
              <Link
                key={key}
                to={to}
                aria-current={on ? 'page' : undefined}
                className={cx('ix-side relative flex h-10 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium no-underline transition-colors', on ? 'text-white' : 'text-side-muted hover:text-white')}
              >
                <span className="relative flex items-center gap-3"><Icon className={on ? 'text-accent-soft' : undefined} />{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-4">
          <RunningAgents onOpen={() => navigate('/agents')} />
          <div className="flex items-center gap-2.5 px-1.5 py-1">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-ink-line text-xs font-semibold">{user.initials}</span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-13 font-medium">{user.name}</span>
              <span className="truncate text-xs text-side-dim">{user.org}</span>
            </div>
            {!EMBED && (
              <button type="button" aria-label="Sign out" onClick={actions.logout} className="flex border-0 bg-transparent p-2 text-side-muted hover:text-white">
                <IconSignOut size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

export const formatK = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`);

/** Open waste, always visible in the header. */
export function WastePill() {
  const waste = useApp((s) => Math.round((s.summary?.wasteIdentified ?? 0) / 100) * 100);
  return (
    <Link to="/overview" className="ix-btn flex h-[30px] items-center gap-1.5 rounded-full border border-transparent bg-accent-wash px-3 text-13 text-accent-ink no-underline">
      Open waste <span className="font-mono font-medium tabular-nums">{formatK(waste)}</span>
    </Link>
  );
}

export function AskButton() {
  return (
    <Link to="/chat" className="ix-btn flex h-[38px] items-center gap-2.5 rounded-lg border border-line-strong bg-surface px-3 text-13 text-fg-2 no-underline hover:border-fg-faint">
      Quick Chat<span className="rounded border border-line px-[5px] py-px font-mono text-11 text-fg-muted">⌘K</span>
    </Link>
  );
}

function ErrorBar() {
  const error = useApp((s) => s.error);
  const { setError } = useActions();
  if (!error) return null;
  return (
    <div role="alert" className="flex items-center justify-between gap-3 border-b border-danger-soft bg-danger-wash px-8 py-2.5 text-sm text-danger">
      <span>{error}</span>
      <button type="button" onClick={() => setError('')} className="ix-btn h-8 rounded-md border-0 bg-transparent px-2 text-13 font-medium text-danger">Dismiss</button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { navigate } = useRouter();
  // ⌘K / Ctrl+K opens Quick Chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate('/chat');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <Cursor />
      <div className="flex min-h-0 w-full flex-1 flex-wrap bg-canvas md:flex-nowrap">
        <Sidebar />
        <div className="flex min-w-0 flex-[999_1_560px] flex-col">
          <ErrorBar />
          {children}
        </div>
      </div>
    </div>
  );
}

/** Top bar for a page. */
export function PageHeader({ title, meta, actions }: { title: string; meta?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="top-chrome sticky z-20 box-border flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface/90 px-8 py-2.5 backdrop-blur max-sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="m-0 truncate text-lg font-semibold tracking-[-0.01em]" data-page-title>{title}</h1>
        {meta}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}

/** Standard page body: 32px gutters, 1344px max. */
export const Page = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <main className={cx('box-border flex w-full max-w-[1344px] flex-col gap-6 p-8 max-sm:p-4', className)}>{children}</main>
);

export const PageHeading = ({ title, sub, size = 28, actions }: { title: string; sub?: React.ReactNode; size?: number; actions?: React.ReactNode }) => (
  <div className="flex flex-wrap items-end justify-between gap-4">
    <div className="flex max-w-[680px] flex-col gap-1.5">
      <h2 className="m-0 font-semibold tracking-[-0.025em]" style={{ fontSize: `${size / 16}rem` }}>{title}</h2>
      {sub && <p className="m-0 text-sm leading-[1.55] text-fg-muted">{sub}</p>}
    </div>
    {actions}
  </div>
);
