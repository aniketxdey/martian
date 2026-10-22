import React, { useEffect } from 'react';
import { IconClose } from './icons';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

/* ---------- Buttons ---------- */

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerOutline';
type BtnSize = 'sm' | 'md' | 'lg';

const btnVariant: Record<BtnVariant, string> = {
  primary: 'bg-accent text-white font-semibold border-0',
  secondary: 'bg-white text-fg font-medium border border-line-strong',
  ghost: 'bg-transparent text-fg-body font-medium border-0',
  danger: 'bg-danger text-white font-semibold border-0',
  dangerOutline: 'bg-white text-danger font-medium border border-danger-line',
};
const btnSize: Record<BtnSize, string> = {
  sm: 'h-9 px-3.5 text-[13px] rounded-lg',
  md: 'h-11 px-4 text-sm rounded-lg',
  lg: 'h-12 px-4 text-[15px] rounded-lg',
};

export const Button = ({
  variant = 'secondary', size = 'md', className, children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) => (
  <button
    type="button"
    {...rest}
    className={cx('inline-flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50', btnVariant[variant], btnSize[size], className)}
  >
    {children}
  </button>
);

export const IconButton = ({ label, className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) => (
  <button
    type="button"
    aria-label={label}
    {...rest}
    className={cx('flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-transparent text-fg-body', className)}
  >
    {children}
  </button>
);

/* ---------- Badges ---------- */

type BadgeTone = 'ok' | 'warn' | 'accent' | 'neutral' | 'soon';
const badgeTone: Record<BadgeTone, string> = {
  ok: 'text-ok bg-ok-wash',
  warn: 'text-warn-ink bg-warn-wash',
  accent: 'text-accent-ink bg-accent-wash',
  neutral: 'text-fg-body bg-line-soft',
  soon: 'text-fg-body border border-dashed border-[#C8C9C6] !py-[3px] !px-[9px]',
};
export const Badge = ({ tone, dot, children, className }: { tone: BadgeTone; dot?: boolean; children: React.ReactNode; className?: string }) => (
  <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium', badgeTone[tone], className)}>
    {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
    {children}
  </span>
);

/* ---------- Toggle ---------- */

export const Toggle = ({
  on, onChange, label, disabled, small,
}: { on: boolean; onChange: () => void; label: string; disabled?: boolean; small?: boolean }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={onChange}
    className="flex h-11 w-11 flex-none items-center justify-center border-0 bg-transparent p-0 disabled:cursor-not-allowed"
  >
    <span
      className={cx('box-border flex rounded-full p-0.5', on ? 'justify-end bg-accent' : 'justify-start bg-line-strong', small ? 'h-5 w-[34px]' : 'h-[22px] w-[38px]')}
    >
      <span className={cx('rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)]', small ? 'h-4 w-4' : 'h-[18px] w-[18px]')} />
    </span>
  </button>
);

/* ---------- Tabs ---------- */

export type TabItem<K extends string> = { key: K; label: string };

/** Segmented control (Infrastructure, Integrations). */
export function SegTabs<K extends string>({ items, value, onChange, label }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 rounded-[10px] bg-line-soft p-1">
      {items.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cx('h-[34px] rounded-[7px] border-0 px-3.5 text-[13px] font-medium', active ? 'bg-white text-fg shadow-tab' : 'bg-transparent text-fg-body')}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Underline tabs (Settings). */
export function LineTabs<K extends string>({ items, value, onChange, label }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-6 border-b border-line">
      {items.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cx('-mb-px h-11 border-0 border-b-2 bg-transparent px-0.5 text-sm', active ? 'border-accent font-semibold text-fg' : 'border-transparent font-medium text-fg-muted')}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Cards and stats ---------- */

export const Card = ({ className, children, as: Tag = 'div' }: { className?: string; children: React.ReactNode; as?: any }) => (
  <Tag className={cx('rounded-xl border border-line bg-white', className)}>{children}</Tag>
);

export const Stat = ({ label, value, sub, valueClass, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; valueClass?: string; children?: React.ReactNode }) => (
  <Card className="flex flex-col gap-2.5 px-[22px] py-5">
    <span className="text-[13px] text-fg-muted">{label}</span>
    <span className={cx('font-mono text-[30px] font-medium tracking-[-0.02em]', valueClass)}>{value}</span>
    {sub && <span className="text-[13px] text-fg-muted">{sub}</span>}
    {children}
  </Card>
);

/* ---------- Form fields ---------- */

export const fieldInput = 'box-border h-[42px] w-full rounded-lg border border-line-strong bg-white px-3 text-sm text-fg outline-none';

export const Field = ({ id, label, hint, className, children }: { id: string; label: React.ReactNode; hint?: React.ReactNode; className?: string; children: React.ReactNode }) => (
  <div className={cx('flex flex-col gap-1.5', className)}>
    <label htmlFor={id} className="text-[13px] font-medium">{label}</label>
    {children}
    {hint && <span className="text-[13px] text-fg-muted">{hint}</span>}
  </div>
);

/* ---------- Overlays ---------- */

const useEscape = (open: boolean, onClose: () => void) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
};

export const Drawer = ({
  open, onClose, label, width = 480, header, footer, children,
}: { open: boolean; onClose: () => void; label: string; width?: number; header: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode }) => {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[rgba(10,10,11,0.32)]">
      <button type="button" aria-label={`Close ${label}`} onClick={onClose} className="flex-1 cursor-default border-0 bg-transparent" />
      <section role="dialog" aria-modal="true" aria-label={label} className="flex max-w-full flex-col overflow-y-auto bg-white shadow-drawer" style={{ width }}>
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-white px-6 py-[18px]">
          <div className="min-w-0 flex-1">{header}</div>
          <IconButton label="Close" onClick={onClose}><IconClose /></IconButton>
        </div>
        <div className="flex-1">{children}</div>
        {footer && <div className="sticky bottom-0 mt-auto flex justify-end gap-2.5 border-t border-line bg-white px-6 py-4">{footer}</div>}
      </section>
    </div>
  );
};

export const Dialog = ({
  open, onClose, label, width = 560, header, footer, children,
}: { open: boolean; onClose: () => void; label: string; width?: number; header: React.ReactNode; footer: React.ReactNode; children: React.ReactNode }) => {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[rgba(10,10,11,0.4)] px-4 py-24">
      <section role="dialog" aria-modal="true" aria-label={label} className="flex max-w-full flex-col rounded-2xl bg-white shadow-dialog" style={{ width }}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
          <div className="min-w-0 flex-1">{header}</div>
          <IconButton label="Close" onClick={onClose} className="flex-none"><IconClose /></IconButton>
        </div>
        {children}
        <div className="flex justify-end gap-2.5 border-t border-line px-6 py-4">{footer}</div>
      </section>
    </div>
  );
};
