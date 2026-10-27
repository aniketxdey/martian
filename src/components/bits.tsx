/** Small shared components: integration logos, sparklines, status pills. */
import React, { memo } from 'react';
import { asset } from '../app/env';
import { CATALOG_BY_ID } from '../data/catalog';
import type { SessionStatus } from '../state/types';
import { cx } from '../ui/kit';

/** Martian's own mark (used for forecast and internal tools). */
export const MartianGlyph = ({ size = 18 }: { size?: number }) => (
  <span className="flex flex-none items-center justify-center" style={{ width: size, height: size }}>
    <img src={asset('martian-mark.svg')} alt="" className="block h-full w-auto" />
  </span>
);

const ServerGlyph = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" className="text-fg-body">
    <rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" />
  </svg>
);
const McpGlyph = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-fg-body">
    <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" />
  </svg>
);

/** Integration logo on a white tile (logos are designed for light backgrounds). */
export const IntegrationLogo = memo(function IntegrationLogo({ id, size = 40, className, title }: { id: string; size?: number; className?: string; title?: string }) {
  const c = CATALOG_BY_ID[id];
  const inner = Math.round(size * 0.62);
  return (
    <span
      title={title ?? c?.name}
      className={cx('flex flex-none items-center justify-center rounded-[22%] border border-line bg-[#fff] dark:border-transparent', className)}
      style={{ width: size, height: size }}
    >
      {id === 'martian' ? <MartianGlyph size={inner} />
        : c?.logo ? <img src={asset(c.logo)} alt="" loading="lazy" decoding="async" className="block object-contain" style={{ maxWidth: inner, maxHeight: inner }} />
          : id === 'ssh' ? <ServerGlyph size={inner} /> : <McpGlyph size={inner} />}
    </span>
  );
});

/** Overlapping logo stack. */
export const LogoStack = ({ ids, size = 22, max = 5 }: { ids: string[]; size?: number; max?: number }) => (
  <span className="flex items-center">
    {ids.slice(0, max).map((id, i) => <IntegrationLogo key={id} id={id} size={size} className={cx(i > 0 && '-ml-1.5', 'shadow-[0_0_0_2px_rgb(var(--c-surface))]')} />)}
    {ids.length > max && <span className="ml-1 font-mono text-xs text-fg-faint">+{ids.length - max}</span>}
  </span>
);

/** Inline SVG sparkline; the last point is the live value. */
export const Sparkline = memo(function Sparkline({ data, width = 160, height = 36, max, className, fill = true, label }: { data: number[]; width?: number; height?: number; max?: number; className?: string; fill?: boolean; label?: string }) {
  if (!data.length) return <span className="text-xs text-fg-faint">No data</span>;
  const hi = max ?? Math.max(1, ...data) * 1.08;
  const lo = max != null ? 0 : Math.min(...data) * 0.92;
  const span = Math.max(1e-6, hi - lo);
  const step = width / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => [i * step, height - ((v - lo) / span) * (height - 4) - 2] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cx('block overflow-visible text-accent', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {fill && <path d={`${d} L${width} ${height} L0 ${height} Z`} fill="currentColor" opacity={0.09} />}
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.6} fill="currentColor" />
    </svg>
  );
});

const STATUS: Record<SessionStatus | 'pending', { label: string; cls: string; dot: string }> = {
  running: { label: 'Running', cls: 'bg-accent-wash text-accent-ink', dot: 'bg-accent animate-pulse' },
  waiting: { label: 'Needs approval', cls: 'bg-warn-wash text-warn-ink', dot: 'bg-warn' },
  completed: { label: 'Done', cls: 'bg-ok-wash text-ok', dot: 'bg-ok' },
  failed: { label: 'Failed', cls: 'bg-danger-wash text-danger', dot: 'bg-danger' },
  pending: { label: 'Queued', cls: 'bg-line-soft text-fg-body', dot: 'bg-idle' },
};

export const StatusPill = ({ status, className }: { status: SessionStatus | 'pending'; className?: string }) => {
  const s = STATUS[status];
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium', s.cls, className)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
};

export const duration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

export const ago = (now: number, at?: number | null) => {
  if (!at) return 'never';
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
};

export const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
