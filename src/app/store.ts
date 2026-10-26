/**
 * The console's data layer. Two implementations share this contract:
 * DemoStore (in-browser world from src/demo) and LiveStore (the Martian API).
 * Views read with useApp(selector); a selector re-renders its component only when
 * its result changes, so the demo clock ticking every second stays cheap.
 */
import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import type { CatalogCategory } from '../data/catalog';
import type { PermissionMode } from '../data/modes';
import type { AgentSession, InfraGraph, Machine, Summary, Telemetry, Topology, UiActivity, UiFinding } from '../state/types';

export type IntegrationStatus = 'connected' | 'auth' | 'error' | 'pending' | 'offline' | 'disabled' | 'available' | 'soon';

export type IntegrationView = {
  /** Instance id: catalog id in demo mode, integration UUID in live mode. */
  id: string;
  catalogId: string;
  name: string;
  short: string;
  cat: CatalogCategory;
  logo: string | null;
  tagline: string;
  desc: string;
  transport: string;
  status: IntegrationStatus;
  enabled: boolean;
  mode: PermissionMode;
  scope: string[];
  tools: { name: string; desc: string; write: boolean; on: boolean }[];
  lastSync: number | null;
  lastError?: string | null;
  callCount: number;
  fields?: { key: string; label: string; type: 'text' | 'list' | 'secret'; value: string }[];
  externalId?: string | null;
  connector?: { id: string; name: string; status: string; sandbox: boolean } | null;
};

export type ToolCallView = { at: number; agent: string; tool: string; ms: number; ok: boolean };

export type ServerView = Machine & { latencyMs?: number };
export type FileEntry = { name: string; type: 'directory' | 'file'; size: string; modified: string; path: string };

export type User = { name: string; email: string; initials: string; org: string; role?: string };

export type AppState = {
  ready: boolean;
  mode: { live: boolean; demo: boolean; embed: boolean; variantIndex?: number; variantKey?: string; seed?: number; industry?: string };
  auth: { signedIn: boolean; checking: boolean; loading: boolean; error: string; defaultEmail: string; defaultPassword: string };
  user: User;
  now: number;
  error: string;
  summary: Summary | null;
  findings: UiFinding[];
  activity: UiActivity[];
  scan: { running: boolean; lastScanAt: number | null; sessionId?: string };
  topology: Topology;
  graph: InfraGraph;
  sessions: AgentSession[];
  integrations: IntegrationView[];
  servers: ServerView[];
};

/** Events from a chat turn, the same shape whether they come from the API or the local planner. */
export type ChatEvent =
  | { event: 'token'; data: { text: string } }
  | { event: 'tool_start'; data: { id: string; tool: string; args?: Record<string, unknown> } }
  | { event: 'tool_end'; data: { id: string; tool: string; ok: boolean; seconds?: number; result?: string } }
  | { event: 'interrupt'; data: any }
  | { event: 'error'; data: { message: string } }
  | { event: 'done'; data: { messages: any[]; pending_approval: any; run: any[] } };

export type ChatContext = { session_id?: string; session_title?: string; kind?: 'session' | 'quick' };

export type ChatBridge = {
  /** Called before each send; LIVE+demo uploads the world snapshot here. */
  beforeSend(): Promise<void>;
  beginRun(title: string, threadId?: string): string;
  toolStart(runId: string, call: { id: string; tool: string; args?: Record<string, unknown> }): void;
  toolEnd(runId: string, call: { id: string; tool: string; ok: boolean; seconds?: number; result?: string }, threadId?: string): void;
  endRun(runId: string, opts: { summary?: string; failed?: boolean; waiting?: boolean }): void;
  /** Static mode only: answers locally with the same event stream as the API. */
  local?: {
    send(threadId: string, message: string, context?: ChatContext): AsyncGenerator<ChatEvent>;
    resume(threadId: string, approved: boolean): AsyncGenerator<ChatEvent>;
  };
};

export type Actions = {
  login(email: string, password: string): Promise<void>;
  logout(): void;
  setError(message: string): void;
  approveFinding(id: string): Promise<void>;
  dismissFinding(id: string): Promise<void>;
  runScan(): Promise<void>;
  telemetry(nodeId: string): Telemetry | null;
  loadSession(id: string): Promise<void>;
  startWorkflow(goal: string, opts?: { fromChat?: boolean; threadId?: string }): Promise<string | null>;
  chat: ChatBridge;
  integrations: {
    toggle(id: string): void;
    setMode(id: string, mode: PermissionMode): void;
    toggleTool(id: string, tool: string): void;
    turnOffWrites(id: string): void;
    connect(id: string): void;
    disconnect(id: string): void;
    test(id: string): Promise<{ ok: boolean; error: string | null }>;
    saveConnection(id: string, values: Record<string, string>): Promise<void>;
    recentCalls(id: string): Promise<ToolCallView[]>;
    addCustom(name: string, transport: 'http' | 'stdio', url: string, authorization: string): Promise<void>;
  };
  servers: {
    add(): Promise<ServerView | null>;
    save(server: ServerView): Promise<void>;
    remove(id: string | number): Promise<void>;
    connect(id: string | number): Promise<void>;
    listFiles(id: string | number, path: string): Promise<FileEntry[]>;
  };
  demo?: { regenerate(variantIndex?: number, seed?: number): void };
};

export interface AppStore {
  getState(): AppState;
  subscribe(listener: () => void): () => void;
  actions: Actions;
  start(): void;
  stop(): void;
}

export const StoreContext = createContext<AppStore | null>(null);

export function useStore(): AppStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('StoreContext missing');
  return s;
}

export const useActions = () => useStore().actions;

const shallowEqual = (a: any, b: any) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is(a[k], b[k]));
};

/** Subscribe to a slice of state. Re-renders only when the slice changes (shallow). */
export function useApp<T>(selector: (s: AppState) => T, equal: (a: T, b: T) => boolean = shallowEqual): T {
  const store = useStore();
  // The selector can close over props, so always use the latest one.
  const sel = useRef(selector);
  sel.current = selector;
  const eq = useRef(equal);
  eq.current = equal;
  const last = useRef<{ state: AppState; sel: unknown; value: T } | null>(null);
  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const prev = last.current;
    if (prev && prev.state === state && prev.sel === sel.current) return prev.value;
    const value = sel.current(state);
    if (prev && eq.current(prev.value, value)) {
      last.current = { state, sel: sel.current, value: prev.value };
      return prev.value;
    }
    last.current = { state, sel: sel.current, value };
    return value;
  }, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Small emitter used by both stores. */
export class Emitter {
  private listeners = new Set<() => void>();
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  emit() {
    for (const l of [...this.listeners]) l();
  }
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'M';
