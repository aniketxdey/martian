/**
 * Hash router with page transitions.
 *
 * Hash URLs keep deep links working when the console is hosted under a sub-path
 * (the embed build). Navigation waits for the target view's code chunk, then swaps
 * the page inside a View Transition: a short crossfade-and-lift for most pages, and
 * a quick wash through the accent color for big jumps (sign-in, opening an agent
 * session). Browsers without the API get a CSS fade. Reduce motion turns it all off.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

export type RouteKey = 'overview' | 'chat' | 'agents' | 'session' | 'infrastructure' | 'integrations' | 'settings';
export type Route = { key: RouteKey; param?: string; path: string };
export type Transition = 'page' | 'orange' | 'theme' | 'none';

export const parse = (hash: string): Route => {
  const path = hash.replace(/^#/, '') || '/overview';
  const [, a = 'overview', b] = path.split('/');
  const param = b ? decodeURIComponent(b) : undefined;
  switch (a) {
    case 'chat': return { key: 'chat', path };
    case 'agents': return param ? { key: 'session', param, path } : { key: 'agents', path };
    case 'infrastructure': return { key: 'infrastructure', param, path };
    case 'integrations': return { key: 'integrations', param, path };
    case 'settings': return { key: 'settings', param, path };
    default: return { key: 'overview', path: '/overview' };
  }
};

type Loader = () => Promise<unknown>;
const loaders: Partial<Record<RouteKey, Loader>> = {};
const loaded = new Map<RouteKey, Promise<unknown>>();

/** Views register their dynamic import so navigation can preload before swapping. */
export function registerLoader(key: RouteKey, load: Loader) {
  loaders[key] = load;
}
export function prefetch(key: RouteKey) {
  const l = loaders[key];
  if (!l) return Promise.resolve();
  if (!loaded.has(key)) loaded.set(key, l().catch(() => loaded.delete(key)));
  return loaded.get(key)!;
}

const prefersReduced = () => {
  try {
    return document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

type Ctx = { route: Route; navigate: (path: string, opts?: { transition?: Transition; replace?: boolean }) => void; back: () => void };
const RouterContext = createContext<Ctx>({ route: parse(''), navigate: () => undefined, back: () => undefined });

export function runTransition(kind: Transition, swap: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  // Page-to-page moves skip the snapshot: the new page mounts and fades up in CSS
  // (.vt-enter), which costs nothing extra. View Transitions are kept for the big
  // moments: the orange wash and the theme cross-fade.
  if (kind === 'none' || kind === 'page' || prefersReduced()) { swap(); return; }
  const root = document.documentElement;
  if (!doc.startViewTransition) {
    if (kind === 'theme') {
      root.classList.add('theme-fade');
      swap();
      window.setTimeout(() => root.classList.remove('theme-fade'), 320);
      return;
    }
    root.dataset.vtFallback = kind;
    swap();
    window.setTimeout(() => delete root.dataset.vtFallback, 450);
    return;
  }
  root.dataset.vt = kind;
  const t = doc.startViewTransition(() => flushSync(swap));
  t.finished.finally(() => { if (root.dataset.vt === kind) delete root.dataset.vt; });
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  const current = useRef(route);
  current.current = route;
  const pendingKind = useRef<Transition>('page');

  const apply = useCallback((next: Route, kind: Transition) => {
    if (next.path === current.current.path) return;
    void prefetch(next.key).then(() => runTransition(kind, () => setRoute(next)));
  }, []);

  useEffect(() => {
    const on = () => {
      const kind = pendingKind.current;
      pendingKind.current = 'page';
      apply(parse(window.location.hash), kind);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [apply]);

  const navigate = useCallback((path: string, opts: { transition?: Transition; replace?: boolean } = {}) => {
    const kind = opts.transition ?? (parse(path).key === 'session' ? 'orange' : 'page');
    if (`#${path}` === window.location.hash) return;
    pendingKind.current = kind;
    if (opts.replace) {
      window.history.replaceState(null, '', `#${path}`);
      apply(parse(path), kind);
    } else {
      window.location.hash = path;
    }
  }, [apply]);

  const back = useCallback(() => window.history.back(), []);
  const value = useMemo(() => ({ route, navigate, back }), [route, navigate, back]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export const useRouter = () => useContext(RouterContext);

/** <a> that navigates with a transition and preloads the view on hover/focus. */
export function Link({ to, transition, className, children, onClick, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; transition?: Transition }) {
  const { navigate } = useRouter();
  const key = parse(to).key;
  return (
    <a
      href={`#${to}`}
      className={className}
      onMouseEnter={() => void prefetch(key)}
      onFocus={() => void prefetch(key)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to, { transition });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
