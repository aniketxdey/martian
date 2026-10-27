/**
 * LiveStore: the console backed by the Martian API (demo data off). Polls the API,
 * keeps chat-driven agent runs locally while they stream, and maps backend shapes to
 * the same view state the demo uses.
 */
import { api, ApiError, del, patch, post } from '../api/client';
import { CATALOG, catalogFor } from '../data/catalog';
import type { PermissionMode } from '../data/modes';
import { minutesAgo } from '../demo/tick';
import { beginChatRun, chatToolEnd, chatToolStart, endChatRun, RunHost } from '../state/chatRuns';
import type { AgentSession, InfraGraph, Summary, Topology, UiActivity, UiFinding } from '../state/types';
import { Actions, AppState, AppStore, Emitter, FileEntry, initials, IntegrationView, ServerView, ToolCallView } from './store';

type ApiTool = { name: string; description: string; write: boolean; enabled: boolean };
type ApiIntegration = {
  id: string; kind: string; name: string; status: string; enabled: boolean; mode: PermissionMode; transport: string;
  config: Record<string, any>; has_secrets: boolean; tools: ApiTool[]; last_sync_at: string | null; last_error: string | null;
  external_id?: string | null; connector: IntegrationView['connector'];
};
type CatalogItem = { kind: string; config_fields?: { key: string; label: string; type: 'text' | 'list' | 'secret' }[] };

const STATE: Record<string, UiFinding['state']> = { open: 'open', approved: 'running', running: 'running', applied: 'done', failed: 'failed', dismissed: 'dismissed' };
const AREA: Record<string, string> = { scan: 'Discovery', finding: 'Findings', action: 'Changes', connector: 'Connector', integration: 'Integrations' };
const ms = (iso?: string | null) => (iso ? new Date(iso).getTime() : null);

const accountText = (a: any) => (typeof a === 'object' && a ? a.role_arn ?? a.account_id ?? '' : String(a));
const parseAccount = (v: string) => (v.startsWith('arn:') ? { role_arn: v, account_id: v.split(':')[4] ?? '' } : { account_id: v });
const fieldText = (v: unknown) => (Array.isArray(v) ? v.map(accountText).join(', ') : v == null ? '' : String(v));

const scopeOf = (i: ApiIntegration): string[] => {
  const c = i.config ?? {};
  const list = (v: any) => (Array.isArray(v) ? v.map(String) : []);
  if (i.kind === 'aws') return [...(c.accounts ?? []).map((a: any) => (typeof a === 'object' ? a.account_id : String(a))), ...list(c.regions)];
  if (i.kind === 'azure') return list(c.subscription_ids);
  if (i.kind === 'gcp') return list(c.project_ids);
  if (c.url) return [String(c.url)];
  return i.connector ? [i.connector.name] : [];
};

const toFinding = (f: any): UiFinding => ({
  id: f.id, title: f.title, description: f.description, scope: f.scope, affects: f.affects,
  impact: f.status === 'applied' ? f.realized_monthly_savings || f.est_monthly_savings : f.est_monthly_savings,
  difficulty: f.effort === 'easy' ? 'easy' : 'medium', timeToImplement: f.time_to_apply, steps: f.steps ?? [],
  state: STATE[f.status] ?? 'open', automatable: f.automatable, integration: catalogFor(f.integration_kind)?.id, nodeId: f.node_id ?? undefined,
  createdAt: ms(f.created_at) ?? undefined, realized: f.realized_monthly_savings ?? undefined,
});

export class LiveStore implements AppStore {
  private emitter = new Emitter();
  private timer: number | null = null;
  private st: AppState;
  private rows: ApiIntegration[] = [];
  private catalog: CatalogItem[] = [];
  private remoteSessions: AgentSession[] = [];
  private runs: RunHost = { now: Date.now(), sessions: [] };
  private passwords = new Map<string | number, string>();

  constructor() {
    this.st = {
      ready: false,
      mode: { live: true, demo: false, embed: false },
      auth: { signedIn: false, checking: true, loading: false, error: '', defaultEmail: 'admin@company.com', defaultPassword: 'admin123' },
      user: { name: 'Admin', email: '', initials: 'A', org: 'Your organization' },
      now: Date.now(), error: '', summary: null, findings: [], activity: [], scan: { running: false, lastScanAt: null },
      topology: { summary: [], groups: [] }, graph: { nodes: [], edges: [] }, sessions: [], integrations: [], servers: [],
    };
  }

  getState = () => this.st;
  subscribe = (l: () => void) => this.emitter.subscribe(l);
  private set(patch: Partial<AppState>) {
    this.st = { ...this.st, ...patch, now: Date.now() };
    this.emitter.emit();
  }

  start() {
    void this.checkSession();
    if (this.timer != null) return;
    this.timer = window.setInterval(() => {
      if (document.hidden || !this.st.auth.signedIn) return;
      void this.load();
    }, 6000);
  }
  stop() {
    if (this.timer != null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      this.set({ auth: { ...this.st.auth, signedIn: false, checking: false } });
      return;
    }
    this.set({ error: e instanceof Error ? e.message : String(e) });
  };

  private async checkSession() {
    try {
      const me = await api<{ email: string; org_name?: string; role?: string }>('/auth/me');
      this.setUser(me);
      this.set({ ready: true, auth: { ...this.st.auth, signedIn: true, checking: false } });
      await this.load();
    } catch {
      this.set({ ready: true, auth: { ...this.st.auth, checking: false } });
    }
  }

  private setUser(me: { email: string; org_name?: string; role?: string; name?: string }) {
    const name = me.name || me.email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    this.st = { ...this.st, user: { name, email: me.email, initials: initials(name), org: me.org_name ?? 'Your organization', role: me.role } };
  }

  private async load() {
    try {
      const [ov, fs, act, topo, servers, ints, sessions, graph] = await Promise.all([
        api('/overview'), api('/findings'), api('/activity'), api('/inventory/topology'), api('/servers'), api('/integrations'),
        api('/agents/sessions').catch(() => ({ sessions: [] })), api('/inventory/graph').catch(() => ({ nodes: [], edges: [] })),
      ]);
      this.rows = ints.integrations;
      this.catalog = ints.available;
      this.remoteSessions = (sessions.sessions ?? []) as AgentSession[];
      const summary: Summary = {
        healthScore: ov.health_score, totalResources: ov.resources, totalAccounts: ov.accounts, monthlyCost: ov.monthly_cost,
        wasteIdentified: ov.waste_identified, realizedSavings: ov.realized_savings, lastScanAt: ov.last_scan_at,
      };
      const activity: UiActivity[] = act.activity.map((a: any, i: number) => ({
        id: `a${i}`, agent: a.agent, text: a.text, at: ms(a.at) ?? undefined, when: minutesAgo(Date.now(), ms(a.at) ?? undefined), where: AREA[a.target_type] ?? 'All', fresh: i === 0,
      }));
      this.set({
        summary, findings: fs.findings.map(toFinding), activity, topology: topo as Topology, graph: graph as InfraGraph,
        servers: servers.servers.map((s: any) => ({ id: s.id, name: s.name, ipAddress: s.ipAddress, username: s.username, password: this.passwords.get(s.id) ?? '', status: s.status, description: s.description, os: s.os })),
        integrations: this.views(), sessions: this.mergedSessions(),
        scan: { running: !!ov.scan_running, lastScanAt: ms(ov.last_scan_at) },
      });
    } catch (e) {
      this.fail(e);
    }
  }

  private mergedSessions() {
    const local = this.runs.sessions.filter((s) => !this.remoteSessions.some((r) => r.id === s.id));
    return [...local, ...this.remoteSessions].sort((a, b) => b.startedAt - a.startedAt);
  }

  private views(): IntegrationView[] {
    const live = this.rows.map((i): IntegrationView => {
      const cat = catalogFor(i.kind);
      const fields = (this.catalog.find((c) => c.kind === i.kind)?.config_fields ?? []).map((f) => ({
        ...f, value: f.type === 'secret' ? '' : fieldText(i.config?.[f.key]),
      }));
      return {
        id: i.id, catalogId: cat?.id ?? 'custom', name: i.name, short: cat?.short ?? i.name, cat: cat?.cat ?? 'custom', logo: cat?.logo ?? null,
        tagline: cat?.tagline ?? (i.config?.url ? String(i.config.url) : 'Custom MCP server'), desc: cat?.desc ?? 'Custom MCP server added by your team.',
        transport: i.transport, status: (['connected', 'auth', 'error', 'pending', 'offline', 'disabled'].includes(i.status) ? i.status : 'pending') as IntegrationView['status'],
        enabled: i.enabled, mode: i.mode, scope: scopeOf(i), tools: i.tools.map((t) => ({ name: t.name, desc: t.description, write: t.write, on: t.enabled })),
        lastSync: ms(i.last_sync_at), lastError: i.last_error, callCount: 0, fields, externalId: i.external_id ?? null, connector: i.connector,
      };
    });
    const have = new Set(live.map((v) => v.catalogId));
    // Everything else in the catalog: native kinds can be added, the rest is on the roadmap.
    const rest = CATALOG.filter((c) => !have.has(c.id)).map((c): IntegrationView => ({
      id: `catalog:${c.id}`, catalogId: c.id, name: c.name, short: c.short, cat: c.cat, logo: c.logo, tagline: c.tagline, desc: c.desc, transport: c.transport,
      status: c.backendKind ? 'available' : 'soon', enabled: false, mode: 'read', scope: [], tools: c.tools.map((t) => ({ name: t.name, desc: t.desc, write: !!t.write, on: false })),
      lastSync: null, callCount: 0,
    }));
    return [...live, ...rest];
  }

  private row(id: string) {
    return this.rows.find((r) => r.id === id);
  }

  private async update(id: string, body: Record<string, unknown>) {
    this.rows = this.rows.map((r) => (r.id === id ? ({ ...r, ...body } as ApiIntegration) : r));
    this.set({ integrations: this.views() });
    try { await patch(`/integrations/${id}`, body); } catch (e) { this.fail(e); }
    await this.load();
  }

  private disabledTools(id: string) {
    return (this.row(id)?.tools ?? []).filter((t) => !t.enabled).map((t) => t.name);
  }

  private host(): RunHost {
    this.runs.now = Date.now();
    return this.runs;
  }

  actions: Actions = {
    login: async (email, password) => {
      this.set({ auth: { ...this.st.auth, loading: true, error: '' } });
      try {
        await post('/auth/login', { email, password });
        const me = await api('/auth/me').catch(() => ({ email }));
        this.setUser(me);
        this.set({ auth: { ...this.st.auth, signedIn: true, loading: false } });
        await this.load();
      } catch (e) {
        this.set({ auth: { ...this.st.auth, loading: false, error: e instanceof ApiError && e.status === 401 ? "That email and password don't match an account" : (e as Error).message } });
      }
    },
    logout: () => {
      void post('/auth/logout').catch(() => undefined);
      this.set({ auth: { ...this.st.auth, signedIn: false }, summary: null });
    },
    setError: (message) => this.set({ error: message }),
    approveFinding: async (id) => {
      this.set({ findings: this.st.findings.map((f) => (f.id === id ? { ...f, state: 'running' } : f)) });
      try { await post(`/findings/${id}/approve`); } catch (e) { this.fail(e); }
      void this.load();
    },
    dismissFinding: async (id) => {
      try { await post(`/findings/${id}/dismiss`); } catch (e) { this.fail(e); }
      void this.load();
    },
    runScan: async () => {
      this.set({ scan: { ...this.st.scan, running: true } });
      try { await post('/scans'); } catch (e) { this.fail(e); }
      window.setTimeout(() => void this.load(), 2500);
    },
    telemetry: () => null,
    loadSession: async (id) => {
      if (id.startsWith('ses_chat_')) return;
      try {
        const s = await api<AgentSession>(`/agents/sessions/${encodeURIComponent(id)}`);
        this.remoteSessions = [s, ...this.remoteSessions.filter((x) => x.id !== s.id)];
        this.set({ sessions: this.mergedSessions() });
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) this.fail(e);
      }
    },
    startWorkflow: async (goal) => {
      try {
        const r = await post<{ session_id: string }>('/agents/workflows', { goal });
        void this.load();
        return r.session_id;
      } catch (e) {
        this.fail(e);
        return null;
      }
    },
    chat: {
      beforeSend: async () => undefined,
      beginRun: (title, threadId) => {
        const s = beginChatRun(this.host(), { title, threadId, by: this.st.user.name });
        this.set({ sessions: this.mergedSessions() });
        return s.id;
      },
      toolStart: (runId, call) => { chatToolStart(this.host(), runId, call); this.set({ sessions: this.mergedSessions() }); },
      toolEnd: (runId, call) => { chatToolEnd(this.host(), runId, call); this.set({ sessions: this.mergedSessions() }); },
      endRun: (runId, opts) => {
        endChatRun(this.host(), runId, opts);
        this.set({ sessions: this.mergedSessions() });
        if (!opts.waiting) window.setTimeout(() => void this.load(), 800);
      },
    },
    integrations: {
      toggle: (id) => { const r = this.row(id); if (r) void this.update(id, { enabled: !r.enabled }); },
      setMode: (id, mode) => void this.update(id, { mode }),
      toggleTool: (id, tool) => {
        const off = new Set(this.disabledTools(id));
        if (off.has(tool)) off.delete(tool); else off.add(tool);
        this.rows = this.rows.map((r) => (r.id === id ? { ...r, tools: r.tools.map((t) => ({ ...t, enabled: !off.has(t.name) })) } : r));
        this.set({ integrations: this.views() });
        void patch(`/integrations/${id}`, { disabled_tools: [...off] }).then(() => this.load(), this.fail);
      },
      turnOffWrites: (id) => {
        const off = new Set([...this.disabledTools(id), ...(this.row(id)?.tools ?? []).filter((t) => t.write).map((t) => t.name)]);
        void patch(`/integrations/${id}`, { disabled_tools: [...off] }).then(() => this.load(), this.fail);
      },
      connect: (id) => {
        const kind = catalogFor(id.replace(/^catalog:/, ''))?.backendKind;
        if (!kind) return;
        void post('/integrations', { kind, mode: 'read' }).then(() => this.load(), this.fail);
      },
      disconnect: (id) => {
        this.rows = this.rows.filter((r) => r.id !== id);
        this.set({ integrations: this.views() });
        void del(`/integrations/${id}`).then(() => this.load(), this.fail);
      },
      test: async (id) => {
        const r = await post<{ ok: boolean; error: string | null }>(`/integrations/${id}/test`);
        void this.load();
        return r;
      },
      saveConnection: async (id, values) => {
        const view = this.st.integrations.find((v) => v.id === id);
        const config: Record<string, unknown> = { ...(this.row(id)?.config ?? {}) };
        const secrets: Record<string, string> = {};
        for (const f of view?.fields ?? []) {
          const v = values[f.key];
          if (v === undefined) continue;
          if (f.type === 'secret') { if (v) secrets[f.key] = v; } else if (f.type === 'list') {
            const items = v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
            config[f.key] = f.key === 'accounts' ? items.map(parseAccount) : items;
          } else config[f.key] = v.trim();
        }
        await patch(`/integrations/${id}`, { config, ...(Object.keys(secrets).length ? { secrets } : {}) });
        await this.load();
      },
      recentCalls: async (id): Promise<ToolCallView[]> => {
        try {
          const r = await api(`/integrations/${id}`);
          return r.recent_calls.map((x: any) => ({ at: ms(x.at) ?? Date.now(), agent: x.agent, tool: x.tool, ms: 0, ok: x.status !== 'failed' }));
        } catch {
          return [];
        }
      },
      addCustom: async (name, transport, url, authorization) => {
        try {
          const i = await post<{ id: string }>('/integrations', {
            kind: 'custom', name: name.trim() || 'Custom MCP server', mode: 'read',
            config: transport === 'http' ? { url } : { transport: 'stdio', command: url }, secrets: authorization ? { authorization } : {},
          });
          await this.load();
          if (transport === 'http' && url) await this.actions.integrations.test(i.id).catch(() => undefined);
        } catch (e) { this.fail(e); }
      },
    },
    servers: {
      add: async () => {
        try {
          const s = await post('/servers', {});
          await this.load();
          return { ...s, password: '' } as ServerView;
        } catch (e) { this.fail(e); return null; }
      },
      save: async (m) => {
        if (m.password) this.passwords.set(m.id, m.password);
        try {
          await patch(`/servers/${m.id}`, { name: m.name, os: m.os, ipAddress: m.ipAddress, username: m.username, description: m.description, ...(m.password ? { password: m.password } : {}) });
        } catch (e) { this.fail(e); }
        await this.load();
      },
      remove: async (id) => {
        try { await del(`/servers/${id}`); } catch (e) { this.fail(e); }
        await this.load();
      },
      connect: async (id) => {
        this.set({ servers: this.st.servers.map((s) => (s.id === id ? { ...s, status: 'connecting' } : s)) });
        try {
          const s = await post(`/servers/${id}/connect`);
          if (s.status !== 'connected') this.set({ error: `Couldn't connect to ${s.name}: ${s.lastError ?? 'connection failed'}` });
        } catch (e) { this.fail(e); }
        await this.load();
      },
      listFiles: async (id, path): Promise<FileEntry[]> => {
        try {
          const r = await api(`/servers/${id}/files?path=${encodeURIComponent(path)}`);
          return (r.files ?? []).map((f: any) => ({ name: f.name, type: f.type, size: f.size ?? '', modified: f.modified ?? '', path: f.path ?? `${path.replace(/\/$/, '')}/${f.name}` }));
        } catch (e) { this.fail(e); return []; }
      },
    },
  };
}
