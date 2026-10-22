import React, { useEffect, useState } from 'react';
import { IconChat, IconChevronDown, IconClose, IconMenu, IconOverview, IconPlug, IconServer, IconSignOut, IconSliders, MartianMark } from '../ui/icons';
import { cx } from '../ui/kit';

export type ViewKey = 'dashboard' | 'infrastructure' | 'chat' | 'integrations' | 'setup';

const NAV: { key: ViewKey; label: string; Icon: (p: any) => JSX.Element }[] = [
  { key: 'dashboard', label: 'Overview', Icon: IconOverview },
  { key: 'infrastructure', label: 'Infrastructure', Icon: IconServer },
  { key: 'chat', label: 'Ask Martian', Icon: IconChat },
  { key: 'integrations', label: 'Integrations', Icon: IconPlug },
  { key: 'setup', label: 'Settings', Icon: IconSliders },
];

const AGENTS = ['Martian 1 · access checks', 'Martian 2 · discovery', 'Martian 3 · cost analysis', 'Martian 4 · monitoring'];

const Sidebar = ({ current, onNavigate, onLogout }: { current: ViewKey; onNavigate: (v: ViewKey) => void; onLogout: () => void }) => {
  // Below md the sidebar collapses to a header row with a menu button.
  const [open, setOpen] = useState(false);
  const go = (v: ViewKey) => { setOpen(false); onNavigate(v); };
  return (
  <aside className="box-border flex flex-[1_1_240px] flex-col gap-7 bg-ink px-3.5 py-5 text-white max-md:gap-4 max-md:py-3">
    <div className="flex items-center justify-between">
      <button type="button" onClick={() => go('dashboard')} className="flex items-center gap-2 border-0 bg-transparent px-2 py-1 text-left text-lg font-semibold text-white">
        <MartianMark />
        Martian
      </button>
      <button
        type="button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="hidden h-11 w-11 items-center justify-center rounded-lg border-0 bg-transparent text-side-muted max-md:flex"
      >
        {open ? <IconClose /> : <IconMenu />}
      </button>
    </div>
    <div className={cx('flex flex-1 flex-col gap-7', !open && 'max-md:hidden')}>
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ key, label, Icon }) => {
        const active = key === current;
        return (
          <button
            key={key}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => go(key)}
            className={cx('flex h-10 items-center gap-3 rounded-lg border-0 px-3 text-left text-sm font-medium', active ? 'bg-ink-3 text-white' : 'bg-transparent text-side-muted hover:text-white')}
          >
            <Icon color={active ? '#FF6B3D' : 'currentColor'} />
            {label}
          </button>
        );
      })}
    </nav>
    <div className="mt-auto flex flex-col gap-4">
      <div className="flex flex-col gap-2.5 rounded-xl border border-ink-line bg-ink-2 p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">Agents</span>
          <span className="flex items-center gap-1.5 text-xs text-ok-sideText"><span className="h-[7px] w-[7px] rounded-full bg-ok-side" />4 active</span>
        </div>
        <div className="flex flex-col gap-1.5 font-mono text-xs text-side-muted">
          {AGENTS.map((a) => <span key={a}>{a}</span>)}
        </div>
      </div>
      <div className="flex items-center gap-2.5 px-1.5 py-1">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-ink-line text-xs font-semibold">AD</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] font-medium">Admin</span>
          <span className="truncate text-xs text-side-dim">admin@company.com</span>
        </div>
        <button type="button" aria-label="Sign out" onClick={onLogout} className="flex border-0 bg-transparent p-2 text-side-muted hover:text-white">
          <IconSignOut size={16} />
        </button>
      </div>
    </div>
    </div>
  </aside>
  );
};

export const formatK = (n: number) => `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;

export const WastePill = ({ amount }: { amount: number }) => (
  <span className="flex h-[30px] items-center gap-1.5 rounded-full bg-accent-wash px-3 text-[13px] text-accent-ink">
    Waste identified <span className="font-mono font-medium">{formatK(amount)}</span>
  </span>
);

/** Top bar tools shown on Overview and Infrastructure. */
export const TopBarTools = ({ waste, onAsk }: { waste: number; onAsk: () => void }) => (
  <>
    <button type="button" className="flex h-[38px] items-center gap-2 rounded-lg border border-line-strong bg-white px-3 font-mono text-[13px] text-fg-2">
      All environments<IconChevronDown size={14} />
    </button>
    <button type="button" onClick={onAsk} className="flex h-[38px] items-center gap-2.5 rounded-lg border border-line-strong bg-white px-3 text-[13px] text-fg-2">
      Ask Martian<span className="rounded border border-line px-[5px] py-px font-mono text-[11px] text-fg-muted">⌘K</span>
    </button>
    <WastePill amount={waste} />
  </>
);

export const AppShell = ({
  current, onNavigate, onLogout, title, titleMeta, actions, error, onDismissError, background = 'canvas', children,
}: {
  current: ViewKey; onNavigate: (v: ViewKey) => void; onLogout: () => void;
  title: string; titleMeta?: React.ReactNode; actions?: React.ReactNode;
  error?: string; onDismissError?: () => void; background?: 'canvas' | 'white'; children: React.ReactNode;
}) => {
  // ⌘K / Ctrl+K opens Ask Martian.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onNavigate('chat');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNavigate]);

  return (
    <div className={cx('flex min-h-screen w-full flex-wrap', background === 'white' ? 'bg-white' : 'bg-canvas')}>
      <Sidebar current={current} onNavigate={onNavigate} onLogout={onLogout} />
      <div className="flex min-w-0 flex-[999_1_560px] flex-col">
        <header className="box-border flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-8 py-2.5">
          <div className="flex items-center gap-3">
            <h1 className="m-0 text-lg font-semibold tracking-[-0.01em]">{title}</h1>
            {titleMeta}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
        </header>
        {error && (
          <div role="alert" className="flex items-center justify-between gap-3 border-b border-danger-soft bg-[#FDF2F2] px-8 py-2.5 text-sm text-danger">
            <span>{error}</span>
            {onDismissError && (
              <button type="button" onClick={onDismissError} className="h-8 rounded-md border-0 bg-transparent px-2 text-[13px] font-medium text-danger">Dismiss</button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
};

/** Standard page body: 32px gutters, 1344px max. */
export const Page = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <main className={cx('box-border flex w-full max-w-[1344px] flex-col gap-6 p-8', className)}>{children}</main>
);

export const PageHeading = ({ title, sub, size = 28, actions }: { title: string; sub?: React.ReactNode; size?: number; actions?: React.ReactNode }) => (
  <div className="flex flex-wrap items-end justify-between gap-4">
    <div className="flex max-w-[640px] flex-col gap-1.5">
      <h2 className="m-0 font-semibold tracking-[-0.025em]" style={{ fontSize: size }}>{title}</h2>
      {sub && <p className="m-0 text-sm leading-[1.55] text-fg-muted">{sub}</p>}
    </div>
    {actions}
  </div>
);
