/**
 * Click-to-zoom: expands a graph or chart into a full-screen view with a shared-element
 * scale from where it sat on the page. Esc or the close button returns it; focus stays
 * inside while open and goes back to the trigger afterwards.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from '../ui/icons';

type ZoomState = { from: DOMRect | null; trigger: HTMLElement | null } | null;

export function useZoom() {
  const [state, setState] = useState<ZoomState>(null);
  const open = useCallback((el: HTMLElement | null) => {
    setState({ from: el?.getBoundingClientRect() ?? null, trigger: (document.activeElement as HTMLElement) ?? null });
  }, []);
  const close = useCallback(() => setState(null), []);
  return { state, open, close, isOpen: !!state };
}

const reduced = () => {
  try {
    return document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
};

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ZoomOverlay({ state, onClose, label, title, children }: {
  state: ZoomState; onClose: () => void; label: string; title?: React.ReactNode; children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);

  const flip = (el: HTMLElement, from: DOMRect) => {
    const to = el.getBoundingClientRect();
    const sx = from.width / to.width;
    const sy = from.height / to.height;
    return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`;
  };

  useLayoutEffect(() => {
    if (!state || !panel.current) return;
    closing.current = false;
    closeBtn.current?.focus({ preventScroll: true });
    if (reduced() || !state.from) return;
    panel.current.animate([{ transform: flip(panel.current, state.from), opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.16,1,.3,1)' });
    backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
  }, [state]);

  const done = useCallback(() => {
    const trigger = state?.trigger;
    onClose();
    requestAnimationFrame(() => trigger?.focus?.({ preventScroll: true }));
  }, [onClose, state]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (reduced() || !state?.from || !panel.current) { done(); return; }
    const a = panel.current.animate([{ transform: 'none', opacity: 1 }, { transform: flip(panel.current, state.from), opacity: 0.4 }], { duration: 260, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    backdrop.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: 'forwards' });
    a.onfinish = done;
  }, [done, state]);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey, true); document.body.style.overflow = prev; };
  }, [state, close]);

  if (!state) return null;
  return createPortal(
    <>
      <div ref={backdrop} className="zoom-backdrop" onClick={close} aria-hidden="true" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} className="zoom-panel flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-dialog">
        <div className="flex h-14 flex-none items-center justify-between gap-3 border-b border-line px-5">
          <div className="min-w-0 truncate text-15 font-semibold">{title ?? label}</div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-faint max-sm:hidden">Esc to close</span>
            <button ref={closeBtn} type="button" aria-label="Close full screen" onClick={close} className="ix-btn flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-fg-body">
              <IconClose size={16} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </>,
    document.body,
  );
}
