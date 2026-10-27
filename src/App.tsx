import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api } from './api/client';
import { DemoStore } from './app/demoStore';
import { EMBED, LIVE } from './app/env';
import { LiveStore } from './app/liveStore';
import { PrefsProvider } from './app/prefs';
import { registerLoader, RouterProvider, runTransition, useRouter } from './app/router';
import { AppStore, StoreContext, useApp } from './app/store';
import { AppShell } from './shell/AppShell';
import { MartianMark } from './ui/icons';
import { Login } from './views/Login';

// Views load on demand; the router preloads a view's chunk before switching to it.
const load = {
  overview: () => import('./views/Overview'),
  chat: () => import('./views/QuickChat'),
  agents: () => import('./views/Agents'),
  session: () => import('./views/AgentSession'),
  infrastructure: () => import('./views/Infrastructure'),
  integrations: () => import('./views/Integrations'),
  settings: () => import('./views/Settings'),
};
(Object.keys(load) as (keyof typeof load)[]).forEach((k) => registerLoader(k, load[k]));
const Overview = lazy(() => load.overview().then((m) => ({ default: m.Overview })));
const QuickChat = lazy(() => load.chat().then((m) => ({ default: m.QuickChat })));
const Agents = lazy(() => load.agents().then((m) => ({ default: m.Agents })));
const AgentSession = lazy(() => load.session().then((m) => ({ default: m.AgentSession })));
const Infrastructure = lazy(() => load.infrastructure().then((m) => ({ default: m.Infrastructure })));
const Integrations = lazy(() => load.integrations().then((m) => ({ default: m.Integrations })));
const Settings = lazy(() => load.settings().then((m) => ({ default: m.Settings })));

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-8" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-48 animate-pulse rounded-md bg-line-soft" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-line-soft" />)}
      </div>
      <div className="h-80 animate-pulse rounded-xl bg-line-soft" />
    </div>
  );
}

function Routes() {
  const { route } = useRouter();
  let view: React.ReactNode;
  switch (route.key) {
    case 'chat': view = <QuickChat />; break;
    case 'agents': view = <Agents />; break;
    case 'session': view = <AgentSession key={route.param} id={route.param!} />; break;
    case 'infrastructure': view = <Infrastructure nodeId={route.param} />; break;
    case 'integrations': view = <Integrations openId={route.param} />; break;
    case 'settings': view = <Settings tab={route.param} />; break;
    default: view = <Overview />;
  }
  return (
    <div key={route.key} className="vt-page vt-enter flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<PageSkeleton />}>{view}</Suspense>
    </div>
  );
}

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink">
      <span className="animate-pulse"><MartianMark box={44} img={82} offset={-19} /></span>
    </div>
  );
}

/** Signed out → login; signed in → console. The switch is an accent wash. */
function Gate() {
  const ready = useApp((s) => s.ready);
  const signedIn = useApp((s) => s.auth.signedIn);
  const [shown, setShown] = useState(signedIn);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; setShown(signedIn); return; }
    if (signedIn !== shown) runTransition('orange', () => setShown(signedIn));
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return <Splash />;
  if (!shown) return <Login />;
  return <AppShell><Routes /></AppShell>;
}

/** Picks the data source: demo engine without an API, otherwise whatever the API says. */
function useBootStore(): AppStore | null {
  const [store, setStore] = useState<AppStore | null>(() => (!LIVE ? new DemoStore() : null));
  useEffect(() => {
    if (store) return;
    let cancelled = false;
    api<{ enabled: boolean }>('/demo/config')
      .then((c) => c.enabled, () => false)
      .then((demo) => { if (!cancelled) setStore(demo ? new DemoStore() : new LiveStore()); });
    return () => { cancelled = true; };
  }, [store]);
  useEffect(() => {
    if (!store) return;
    store.start();
    return () => store.stop();
  }, [store]);
  return store;
}

export default function App() {
  const store = useBootStore();
  return (
    <PrefsProvider>
      <RouterProvider>
        {store ? (
          <StoreContext.Provider value={store}>
            <Gate />
          </StoreContext.Provider>
        ) : <Splash />}
      </RouterProvider>
    </PrefsProvider>
  );
}

export { EMBED };
