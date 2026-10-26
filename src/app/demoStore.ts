/**
 * DemoStore: the console backed by an in-browser demo world (src/demo).
 * New seed and a random one of five companies per UI run, unless the URL or the
 * embed build pins them. With an API (LIVE) sign-in and chat still go to the real
 * backend; the world snapshot is uploaded before each chat turn so Claude's tools
 * see the same numbers as the screen.
 */
import { api, ApiError, post } from '../api/client';
import { CATALOG, CATALOG_BY_ID } from '../data/catalog';
import type { PermissionMode } from '../data/modes';
import { localPlanner } from '../demo/planner';
import { newSeed, Rng, rng } from '../demo/rng';
import { snapshot } from '../demo/snapshot';
import {
  approveFinding as approve, connectIntegration, disconnectIntegration, dismissFinding as dismiss, logActivity, minutesAgo, runScan as scan,
  seedHistory, startWorkflow as start, tick, worldRunHost,
} from '../demo/tick';
import { VARIANTS } from '../demo/variants';
import { accountsCount, createWorld, healthScore, moneyK, monthlyCost, openWaste, resourceCount, World } from '../demo/world';
import { beginChatRun, chatToolEnd, chatToolStart, endChatRun } from '../state/chatRuns';
import type { AgentSession, Telemetry, Topology } from '../state/types';
import { EMBED, EMBED_SEED, EMBED_VARIANT, LIVE, URL_SEED, URL_VARIANT } from './env';
import { Actions, AppState, AppStore, Emitter, FileEntry, initials, IntegrationView, ServerView, ToolCallView } from './store';

const ENV_LABEL: Record<string, string> = { cloud: 'Cloud', dc: 'Data centers', labs: 'Dev and labs', edge: 'Edge sites', saas: 'Data platforms' };

type Custom = { id: string; name: string; url: string; status: 'pending' | 'connected'; mode: PermissionMode; tools: { name: string; desc: string; write: boolean }[]; disabled: string[]; addedAt: number };

export class DemoStore implements AppStore {
  private w!: World;
  private r!: Rng;
  private state!: AppState;
  private emitter = new Emitter();
  private timer: number | null = null;
  private customs: Custom[] = [];
  private auth = { signedIn: EMBED, checking: LIVE, loading: false, error: '' };
  private apiUser: { email: string } | null = null;
  private error = '';
  private dirty = true;

  constructor() {
    const asked = resolveVariant(URL_VARIANT);
    const variant = asked ?? (EMBED ? EMBED_VARIANT : Math.floor(Math.random() * VARIANTS.length));
    const seed = URL_SEED ?? (EMBED ? EMBED_SEED : newSeed());
    this.build(variant, seed);
  }

  private build(variantIndex: number, seed: number) {
    // Embed demos start at a fixed instant so they replay identically.
    const now = Date.now();
    this.r = rng(seed).fork('clock');
    this.w = createWorld(seed, variantIndex, now);
    seedHistory(this.w, rng(seed).fork('history'));
    this.customs = [];
    this.dirty = true;
    this.state = this.derive();
  }

  /* ---------- store plumbing ---------- */

  getState = () => {
    if (this.dirty) { this.state = this.derive(); this.dirty = false; }
    return this.state;
  };
  subscribe = (l: () => void) => this.emitter.subscribe(l);

  private changed() {
    this.dirty = true;
    this.emitter.emit();
  }

  start() {
    if (LIVE && !EMBED) void this.checkSession();
    if (this.timer != null) return;
    const loop = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      tick(this.w, Date.now(), this.r);
      this.changed();
    };
    this.timer = window.setInterval(loop, 1000);
  }

  stop() {
    if (this.timer != null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /* ---------- derived view state ---------- */

  private derive(): AppState {
    const w = this.w;
    const v = w.variant;
    const cost = monthlyCost(w);
    const waste = openWaste(w);
    const email = this.apiUser?.email ?? v.admin.email;
    const name = this.apiUser ? email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : v.admin.name;
    return {
      ready: !this.auth.checking,
      mode: { live: LIVE, demo: true, embed: EMBED, variantIndex: w.variantIndex, variantKey: v.key, seed: w.seed, industry: v.org.industry },
      auth: { ...this.auth, defaultEmail: LIVE ? 'admin@company.com' : v.admin.email, defaultPassword: LIVE ? 'admin123' : 'demo' },
      user: { name, email, initials: initials(name), org: v.org.name, role: 'Owner' },
      now: w.now,
      error: this.error,
      summary: {
        healthScore: healthScore(w), totalResources: resourceCount(w), totalAccounts: accountsCount(w), monthlyCost: cost,
        wasteIdentified: waste, realizedSavings: w.realized, lastScanAt: new Date(w.lastScanAt).toISOString(),
      },
      findings: w.findings.filter((f) => f.state !== 'dismissed').map((f) => ({ ...f })),
      activity: w.activity.slice(0, 40).map((a) => ({ ...a, when: minutesAgo(w.now, a.at), fresh: !!a.at && w.now - a.at < 20_000 })),
      scan: { running: !!w.scanning, lastScanAt: w.lastScanAt, sessionId: w.scanning ?? undefined },
      topology: this.topology(),
      graph: w.graph,
      sessions: w.sessions.map(cloneSession),
      integrations: this.integrationViews(),
      servers: w.servers.map(({ files, ...s }) => ({ ...s })),
    };
  }

  private topology(): Topology {
    const w = this.w;
    const services = Object.values(w.services);
    const vms = services.filter((s) => s.spec.type === 'vm-fleet').reduce((n, s) => n + s.count, 0);
    const hosts = services.filter((s) => s.spec.type === 'host-cluster' || s.spec.type === 'gpu').reduce((n, s) => n + s.count, 0);
    const groups = (['cloud', 'dc', 'labs', 'edge', 'saas'] as const).map((env) => {
      const clusters = w.variant.clusters.filter((c) => c.env === env);
      if (!clusters.length) return null;
      const systems = clusters.flatMap((c) => c.services.map((sp) => {
        const s = w.services[`svc:${c.id}/${sp.id}`];
        return {
          name: sp.name, nodeId: `svc:${c.id}/${sp.id}`,
          a: `${s.count.toLocaleString('en-US')} ${sp.unit}`, b: `${c.name} · ${CATALOG_BY_ID[sp.integration ?? c.integration]?.short ?? c.integration}`,
          util: s.cpu == null ? null : Math.round(s.cpu),
        };
      }));
      const cost = clusters.reduce((n, c) => n + c.services.reduce((m, sp) => { const s = w.services[`svc:${c.id}/${sp.id}`]; return m + s.count * s.unitCost; }, 0), 0);
      const where = [...new Set(clusters.map((c) => CATALOG_BY_ID[c.integration]?.short ?? c.integration))].join(' · ');
      return { key: env, name: ENV_LABEL[env], where, cost: moneyK(cost), systems };
    }).filter((g): g is NonNullable<typeof g> => !!g);
    return {
      summary: [
        { value: vms.toLocaleString('en-US'), label: 'Virtual machines' },
        { value: hosts.toLocaleString('en-US'), label: 'Hosts and GPU nodes' },
        { value: String(accountsCount(w)), label: 'Cloud accounts' },
        { value: moneyK(monthlyCost(w)), label: 'Monthly cost', accent: true },
        { value: String(w.variant.clusters.length), label: 'Clusters' },
        { value: String(w.findings.filter((f) => f.state === 'open').length), label: 'Open findings' },
      ],
      groups,
    };
  }

  private integrationViews(): IntegrationView[] {
    const w = this.w;
    const views: IntegrationView[] = w.integrations.map((i) => {
      const c = CATALOG_BY_ID[i.id];
      return {
        id: i.id, catalogId: i.id, name: c.name, short: c.short, cat: c.cat, logo: c.logo, tagline: c.tagline, desc: c.desc, transport: c.transport,
        status: i.status === 'connected' && !i.enabled ? 'disabled' : i.status,
        enabled: i.enabled, mode: i.mode, scope: i.scope,
        tools: c.tools.map((t) => ({ name: t.name, desc: t.desc, write: !!t.write, on: !i.disabledTools.includes(t.name) })),
        lastSync: i.lastSync, callCount: i.callCount,
        fields: [{ key: 'scope', label: 'Scope', type: 'list', value: i.scope.join(', ') }, { key: 'credential', label: 'Credential', type: 'secret', value: '' }],
      };
    });
    for (const c of this.customs) {
      views.push({
        id: c.id, catalogId: 'custom', name: c.name, short: c.name, cat: 'custom', logo: null, tagline: c.url, desc: 'Custom MCP server added by your team.',
        transport: 'remote · https', status: c.status, enabled: true, mode: c.mode, scope: [c.url],
        tools: c.tools.map((t) => ({ ...t, on: !c.disabled.includes(t.name) })), lastSync: c.status === 'connected' ? c.addedAt : null, callCount: 0,
        fields: [{ key: 'url', label: 'Server URL', type: 'text', value: c.url }, { key: 'authorization', label: 'Authorization header', type: 'secret', value: '' }],
      });
    }
    return views;
  }

  /* ---------- auth ---------- */

  private async checkSession() {
    try {
      const me = await api<{ email: string }>('/auth/me');
      this.apiUser = me;
      this.auth = { ...this.auth, signedIn: true, checking: false };
    } catch {
      this.auth = { ...this.auth, checking: false };
    }
    this.changed();
  }

  private by() {
    return this.state?.user.name ?? this.w.variant.admin.name;
  }

  /* ---------- actions ---------- */

  actions: Actions = {
    login: async (email, password) => {
      this.auth = { ...this.auth, loading: true, error: '' };
      this.changed();
      try {
        if (LIVE) {
          await post('/auth/login', { email, password });
          this.apiUser = await api('/auth/me').catch(() => ({ email }));
        } else {
          if (!email.includes('@')) throw new Error('Enter an email address');
          if (!password) throw new Error('Enter a password');
        }
        this.auth = { ...this.auth, signedIn: true, loading: false };
      } catch (e) {
        const msg = e instanceof ApiError && e.status === 401 ? "That email and password don't match an account" : (e as Error).message;
        this.auth = { ...this.auth, loading: false, error: msg };
      }
      this.changed();
    },
    logout: () => {
      if (LIVE) void post('/auth/logout').catch(() => undefined);
      this.apiUser = null;
      this.auth = { ...this.auth, signedIn: EMBED, error: '' };
      this.changed();
    },
    setError: (message) => { this.error = message; this.changed(); },
    approveFinding: async (id) => { approve(this.w, this.r, id, this.by()); this.changed(); },
    dismissFinding: async (id) => { dismiss(this.w, id, this.by()); this.changed(); },
    runScan: async () => { scan(this.w, this.r, this.by()); this.changed(); },
    telemetry: (nodeId) => this.telemetryFor(nodeId),
    loadSession: async () => undefined,
    startWorkflow: async (goal, opts = {}) => {
      const s = start(this.w, this.r, goal, { fromChat: opts.fromChat, threadId: opts.threadId, by: this.by() });
      this.changed();
      return s.id;
    },
    chat: {
      beforeSend: async () => {
        if (!LIVE) return;
        try { await api('/demo/snapshot', { method: 'PUT', body: JSON.stringify(snapshot(this.w)) }); } catch { /* chat still works, tools fall back */ }
      },
      beginRun: (title, threadId) => {
        const s = beginChatRun(worldRunHost(this.w), { title, threadId, by: this.by() });
        this.changed();
        return s.id;
      },
      toolStart: (runId, call) => { chatToolStart(worldRunHost(this.w), runId, call); this.changed(); },
      toolEnd: (runId, call, threadId) => {
        chatToolEnd(worldRunHost(this.w), runId, call);
        this.react(call, threadId);
        this.changed();
      },
      endRun: (runId, opts) => { endChatRun(worldRunHost(this.w), runId, opts); this.changed(); },
      local: LIVE ? undefined : localPlanner(() => this.w, (goal, threadId) => start(this.w, this.r, goal, { fromChat: true, threadId, by: this.by() }).id, (id) => { approve(this.w, this.r, id, this.by()); this.changed(); }),
    },
    integrations: {
      toggle: (id) => { const i = this.findInt(id); if (i && i.status !== 'available') { i.enabled = !i.enabled; this.changed(); } },
      setMode: (id, mode) => {
        const i = this.findInt(id);
        if (i) i.mode = mode;
        const c = this.customs.find((x) => x.id === id);
        if (c) c.mode = mode;
        this.changed();
      },
      toggleTool: (id, tool) => {
        const list = this.findInt(id)?.disabledTools ?? this.customs.find((x) => x.id === id)?.disabled;
        if (!list) return;
        const k = list.indexOf(tool);
        if (k >= 0) list.splice(k, 1); else list.push(tool);
        this.changed();
      },
      turnOffWrites: (id) => {
        const i = this.findInt(id);
        if (i) for (const t of CATALOG_BY_ID[id]?.tools ?? []) if (t.write && !i.disabledTools.includes(t.name)) i.disabledTools.push(t.name);
        const c = this.customs.find((x) => x.id === id);
        if (c) for (const t of c.tools) if (t.write && !c.disabled.includes(t.name)) c.disabled.push(t.name);
        this.changed();
      },
      connect: (id) => { connectIntegration(this.w, id); this.changed(); },
      disconnect: (id) => {
        const c = this.customs.findIndex((x) => x.id === id);
        if (c >= 0) this.customs.splice(c, 1); else disconnectIntegration(this.w, id, this.by());
        this.changed();
      },
      test: async (id) => {
        await new Promise((r) => setTimeout(r, 900 + Math.random() * 700));
        const i = this.findInt(id);
        if (i?.status === 'auth') return { ok: false, error: 'The credential expired. Paste a new one and try again.' };
        if (i) { i.lastSync = this.w.now; i.calls.unshift({ at: this.w.now, agent: 'You', tool: CATALOG_BY_ID[id]?.tools[1]?.name ?? 'verify_access', ms: 412, ok: true }); this.changed(); }
        return { ok: true, error: null };
      },
      saveConnection: async (id, values) => {
        const i = this.findInt(id);
        if (i && values.scope != null) i.scope = values.scope.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
        if (i && values.credential && i.status === 'auth') { i.status = 'pending'; i.lastSync = this.w.now + 1800; }
        const c = this.customs.find((x) => x.id === id);
        if (c && values.url) c.url = values.url;
        this.changed();
      },
      recentCalls: async (id): Promise<ToolCallView[]> => (this.findInt(id)?.calls ?? []).map((c) => ({ ...c })),
      addCustom: async (name, transport, url) => {
        const c: Custom = {
          id: `custom-${this.customs.length + 1}`, name: name.trim() || 'Custom MCP server', url: url || (transport === 'stdio' ? 'local command' : 'https://'),
          status: 'pending', mode: 'read', tools: [], disabled: [], addedAt: this.w.now,
        };
        this.customs.push(c);
        this.changed();
        window.setTimeout(() => {
          c.status = 'connected';
          c.tools = [
            { name: 'lookup_service', desc: 'Find a service by name', write: false },
            { name: 'get_owner', desc: 'Owner and team for a resource', write: false },
            { name: 'get_cost_center', desc: 'Cost center for a resource', write: false },
          ];
          c.disabled = c.tools.map((t) => t.name); // new tools start off
          logActivity(this.w, { agent: 'Access checker', text: `connected ${c.name} and found 3 tools (all off until you turn them on)`, where: 'Integrations' });
          this.changed();
        }, 1600);
      },
    },
    servers: {
      add: async () => {
        const s = { id: `srv-${Date.now()}`, name: '', ipAddress: '', username: '', password: '', status: 'disconnected', description: '', os: 'Ubuntu 24.04 LTS', files: [] };
        this.w.servers.push(s);
        this.changed();
        return { ...s };
      },
      save: async (server: ServerView) => {
        const s = this.w.servers.find((x) => x.id === server.id);
        if (s) Object.assign(s, { ...server, files: s.files });
        this.changed();
      },
      remove: async (id) => { this.w.servers = this.w.servers.filter((x) => x.id !== id); this.changed(); },
      connect: async (id) => {
        const s = this.w.servers.find((x) => x.id === id);
        if (!s) return;
        s.status = 'connecting';
        this.changed();
        await new Promise((r) => setTimeout(r, 1200));
        s.status = s.ipAddress ? 'connected' : 'error';
        if (s.status === 'error') this.actions.setError(`Couldn't reach ${s.name || 'the server'}: add an IP address first`);
        if (!s.files.length) s.files = [{ name: 'home', type: 'directory', size: '', modified: '2026-09-14' }, { name: 'var', type: 'directory', size: '', modified: '2026-10-02' }];
        this.changed();
      },
      listFiles: async (id, path): Promise<FileEntry[]> => {
        const s = this.w.servers.find((x) => x.id === id);
        await new Promise((r) => setTimeout(r, 250));
        const base = path.replace(/\/$/, '');
        const seedR = rng(this.w.seed).fork(`${id}${path}`);
        const files = path === '/' || path === '/home' ? s?.files ?? [] : [
          { name: 'logs', type: 'directory' as const, size: '', modified: '2026-10-21' },
          ...['report_q3.pdf', 'report_q3 (1).pdf', 'dump.sql.gz', 'cache.bin'].map((n) => ({ name: n, type: 'file' as const, size: `${seedR.int(1, 900)} MB`, modified: `2026-0${seedR.int(1, 9)}-${String(seedR.int(10, 28))}` })),
        ];
        return [
          ...(path !== '/' ? [{ name: '..', type: 'directory' as const, size: '', modified: '', path: base.split('/').slice(0, -1).join('/') || '/' }] : []),
          ...files.map((f) => ({ ...f, path: `${base}/${f.name}`.replace('//', '/') })),
        ];
      },
    },
    demo: {
      regenerate: (variantIndex, seed) => {
        this.build(variantIndex ?? Math.floor(Math.random() * VARIANTS.length), seed ?? newSeed());
        this.changed();
      },
    },
  };

  /** Demo tools return results that the screen should act on. */
  private react(call: { tool: string; ok: boolean; result?: string }, threadId?: string) {
    if (!call.ok || !call.result) return;
    let data: any;
    try { data = JSON.parse(call.result); } catch { return; }
    if (data?.handled || data?.session_id) return; // the local planner already acted
    if (call.tool === 'approve_finding' && data?.approved && data.finding_id) {
      approve(this.w, this.r, data.finding_id, this.by());
    } else if (call.tool === 'start_workflow' && data?.started && data.goal) {
      start(this.w, this.r, String(data.goal), { fromChat: true, threadId, by: this.by() });
    }
  }

  private findInt(id: string) {
    return this.w.integrations.find((x) => x.id === id);
  }

  private telemetryFor(nodeId: string): Telemetry | null {
    const w = this.w;
    if (w.telemetry[nodeId]) return w.telemetry[nodeId];
    const kids = Object.keys(w.telemetry).filter((k) => k.startsWith(nodeId.replace(/^cl:/, 'svc:') + '/') || (nodeId.startsWith('int:') && w.services[k] && (w.services[k].spec.integration ?? w.services[k].cluster.integration) === nodeId.slice(4)));
    if (!kids.length) return null;
    const series = kids.map((k) => w.telemetry[k]);
    const withCpu = series.filter((t) => t.cpu.some((x) => x > 0));
    const avg = (pick: (t: Telemetry) => number[], src: Telemetry[]) => src[0] ? pick(src[0]).map((_, i) => src.reduce((n, t) => n + pick(t)[i], 0) / src.length) : [];
    const sum = (pick: (t: Telemetry) => number[]) => pick(series[0]).map((_, i) => series.reduce((n, t) => n + pick(t)[i], 0));
    return {
      cpu: avg((t) => t.cpu, withCpu), mem: avg((t) => t.mem, withCpu), cost: sum((t) => t.cost),
      rps: sum((t) => t.rps ?? []), latency: avg((t) => t.latency ?? [], withCpu),
    };
  }
}

const cloneSession = (s: AgentSession): AgentSession => ({
  ...s,
  integrations: [...s.integrations],
  agents: s.agents.map((a) => ({ ...a, integrations: [...a.integrations], steps: a.steps.map((x) => ({ ...x })) })),
});

export const demoCatalogIds = () => CATALOG.map((c) => c.id);

/** "2" → index 1; "helix" → its index; anything else → undefined. */
export function resolveVariant(v: string | null): number | undefined {
  if (!v) return undefined;
  const byKey = VARIANTS.findIndex((x) => x.key === v.toLowerCase());
  if (byKey >= 0) return byKey;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= VARIANTS.length ? n - 1 : undefined;
}
