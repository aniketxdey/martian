/**
 * Infrastructure: a knowledge-graph map of integrations → clusters → services with
 * their dependencies, environment filters and search, and a telemetry drawer for any
 * node. The environment cards below list every system in plain rows.
 */
import React, { useMemo, useRef, useState } from 'react';
import { useRouter } from '../app/router';
import { useActions, useApp } from '../app/store';
import { chatPrefill } from '../app/useChat';
import { IntegrationLogo, Sparkline, usd } from '../components/bits';
import { ForceGraph } from '../components/graph/ForceGraph';
import { useZoom, ZoomOverlay } from '../components/Zoom';
import { infraMatches, infraModel } from '../components/graph/models';
import { CATALOG_BY_ID } from '../data/catalog';
import { Page, PageHeader, PageHeading } from '../shell/AppShell';
import type { Env, InfraGraph, InfraNode, NodeStatus, Telemetry, UiFinding } from '../state/types';
import { IconChat, IconCheck, IconPlay, IconSearch } from '../ui/icons';
import { Badge, Button, cx, Drawer, SegTabs } from '../ui/kit';

const ENV_LABEL: Record<Env, string> = { cloud: 'Cloud', dc: 'Data center', labs: 'Dev labs', edge: 'Edge', saas: 'SaaS' };
const STATUS: Record<NodeStatus, { label: string; dot: string; text: string }> = {
  healthy: { label: 'Healthy', dot: 'bg-ok', text: 'text-ok' },
  idle: { label: 'Idle', dot: 'bg-idle', text: 'text-fg-muted' },
  hot: { label: 'Running hot', dot: 'bg-warn', text: 'text-warn-ink' },
  degraded: { label: 'Degraded', dot: 'bg-danger', text: 'text-danger' },
};
const TYPE: Record<string, string> = {
  'vm-fleet': 'VM fleet', database: 'Database', storage: 'Storage', 'object-store': 'Object store', k8s: 'Kubernetes', network: 'Network',
  cache: 'Cache', queue: 'Queue', 'host-cluster': 'Host cluster', warehouse: 'Warehouse', gpu: 'GPU pool', serverless: 'Serverless', cdn: 'CDN', analytics: 'Analytics',
};

const envOf = (byId: Map<string, InfraNode>, n: InfraNode): Env | undefined => n.env ?? (n.parent ? envOf(byId, byId.get(n.parent)!) : undefined);
const integrationOf = (byId: Map<string, InfraNode>, n: InfraNode): string | undefined => n.integration ?? (n.parent ? integrationOf(byId, byId.get(n.parent)!) : undefined);

/** Children of a node, all the way down. */
function descendants(g: InfraGraph, id: string): InfraNode[] {
  const out: InfraNode[] = [];
  const walk = (pid: string) => { for (const n of g.nodes) if (n.parent === pid) { out.push(n); walk(n.id); } };
  walk(id);
  return out;
}

function BigChart({ label, data, max, tone, unit }: { label: string; data: number[]; max?: number; tone?: string; unit: (v: number) => string }) {
  const w = typeof window !== 'undefined' ? Math.max(320, Math.min(1400, window.innerWidth - 140)) : 900;
  const h = typeof window !== 'undefined' ? Math.max(220, Math.min(460, window.innerHeight - 300)) : 360;
  const avg = data.reduce((a, b) => a + b, 0) / Math.max(1, data.length);
  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-8">
      <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
        {[['Now', data[data.length - 1] ?? 0], ['Average', avg], ['Peak', Math.max(...data)], ['Low', Math.min(...data)]].map(([k, v]) => (
          <div key={k as string} className="flex flex-col gap-0.5"><dt className="text-xs text-fg-muted">{k}</dt><dd className="m-0 font-mono text-2xl tabular-nums">{unit(v as number)}</dd></div>
        ))}
      </dl>
      <div className="flex flex-col gap-2">
        <Sparkline data={data} width={w} height={h} max={max} className={cx('w-full', tone)} label={`${label}, last 24 hours`} />
        <div className="flex justify-between font-mono text-11 text-fg-faint" style={{ width: w }}><span>24 h ago</span><span>12 h ago</span><span>now</span></div>
      </div>
      <p className="m-0 text-13 text-fg-muted">Half-hour points. The last one updates live while this is open.</p>
    </div>
  );
}

function Metric({ label, value, data, max, tone, unit }: { label: string; value: string; data: number[]; max?: number; tone?: string; unit: (v: number) => string }) {
  const zoom = useZoom();
  const box = useRef<HTMLDivElement>(null);
  return (
    <>
      <div
        ref={box}
        role="button"
        tabIndex={0}
        data-cursor="Zoom"
        aria-label={`${label}: ${value}. Open full screen`}
        onClick={() => zoom.open(box.current)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoom.open(box.current); } }}
        className="ix-card flex cursor-zoom-in flex-col gap-2 rounded-[10px] border border-line bg-surface px-3.5 py-3 outline-none focus-visible:border-accent"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-fg-muted">{label}</span>
          <span className="font-mono text-sm font-medium tabular-nums text-fg">{value}</span>
        </div>
        <Sparkline data={data} width={210} height={34} max={max} className={cx('w-full', tone)} label={`${label}, last 24 hours`} />
      </div>
      <ZoomOverlay state={zoom.state} onClose={zoom.close} label={`${label}, last 24 hours`}>
        <BigChart label={label} data={data} max={max} tone={tone} unit={unit} />
      </ZoomOverlay>
    </>
  );
}

function NodeDrawer({ id, onClose, onSelect }: { id: string | null; onClose: () => void; onSelect: (id: string) => void }) {
  const graph = useApp((s) => s.graph);
  // Re-render with each tick so the sparklines stay live.
  useApp((s) => s.now);
  const findings = useApp((s) => s.findings);
  const actions = useActions();
  const { navigate } = useRouter();
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const n = id ? byId.get(id) : undefined;
  const [approving, setApproving] = useState<string | null>(null);
  if (!n) return <Drawer open={false} onClose={onClose} label="Node" header={null}>{null}</Drawer>;

  const t: Telemetry | null = actions.telemetry(n.id);
  const kids = n.kind === 'service' ? [] : descendants(graph, n.id);
  const scope = new Set([n.id, ...kids.map((k) => k.id)]);
  const mine = findings.filter((f: UiFinding) => f.nodeId && scope.has(f.nodeId) && f.state !== 'dismissed');
  const deps = graph.edges.filter((e) => e.kind !== 'contains' && (e.from === n.id || e.to === n.id));
  const integ = integrationOf(byId, n);
  const env = envOf(byId, n);
  const cost = n.kind === 'service' ? n.monthlyCost ?? 0 : kids.filter((k) => k.kind === 'service').reduce((s, k) => s + (k.monthlyCost ?? 0), 0);
  const last = (xs?: number[]) => (xs && xs.length ? xs[xs.length - 1] : null);
  const subject = n.kind === 'integration' ? CATALOG_BY_ID[n.integration ?? '']?.name ?? n.label : n.label;

  const ask = () => {
    chatPrefill.set(`Tell me about ${subject}${n.location ? ` in ${n.location}` : ''}. Is it sized right, and what does it depend on?`);
    navigate('/chat');
  };
  const workflow = async () => {
    const sid = await actions.startWorkflow(`Check ${subject} for waste and right-size it`);
    if (sid) navigate(`/agents/${sid}`);
  };

  return (
    <Drawer
      open
      onClose={onClose}
      label={`${subject} details`}
      width={520}
      header={
        <div className="flex items-center gap-3">
          {integ ? <IntegrationLogo id={integ} size={40} /> : null}
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="m-0 truncate text-lg font-semibold">{subject}</h2>
            <span className="truncate font-mono text-xs text-fg-faint">
              {n.kind === 'integration' ? 'Integration' : n.kind === 'cluster' ? 'Cluster' : TYPE[n.type ?? ''] ?? 'Service'}
              {n.location ? ` · ${n.location}` : ''}{env ? ` · ${ENV_LABEL[env]}` : ''}
            </span>
          </div>
        </div>
      }
      footer={<>
        <Button onClick={ask}><IconChat size={15} />Ask about this</Button>
        <Button variant="primary" onClick={() => void workflow()}><IconPlay size={13} />Start workflow</Button>
      </>}
    >
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-13">
          {n.status && <span className={cx('inline-flex items-center gap-1.5 font-medium', STATUS[n.status].text)}><span className={cx('h-2 w-2 rounded-full', STATUS[n.status].dot)} />{STATUS[n.status].label}</span>}
          {n.count != null && <span className="font-mono text-fg-2">{n.count.toLocaleString('en-US')} {n.unit}</span>}
          {cost > 0 && <span className="font-mono text-fg-2">{usd(cost)}/mo</span>}
          {(n.tags ?? []).map((tg) => <span key={tg} className="rounded-md bg-chip px-1.5 py-0.5 font-mono text-11 text-fg-body">{tg}</span>)}
        </div>

        <section className="flex flex-col gap-3">
          <h3 className="m-0 text-sm font-semibold">Last 24 hours <span className="font-normal text-fg-muted">· live</span></h3>
          {t ? (
            <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
              {t.cpu.some((x) => x > 0) && <Metric label="CPU" value={`${Math.round(last(t.cpu) ?? 0)}%`} data={t.cpu} max={100} unit={(v) => `${Math.round(v)}%`} />}
              {t.mem.some((x) => x > 0) && <Metric label="Memory" value={`${Math.round(last(t.mem) ?? 0)}%`} data={t.mem} max={100} tone="text-info" unit={(v) => `${Math.round(v)}%`} />}
              <Metric label="Cost per hour" value={`$${(last(t.cost) ?? 0).toFixed(2)}`} data={t.cost} tone="text-ok" unit={(v) => `$${v.toFixed(2)}`} />
              {t.rps && t.rps.some((x) => x > 0) && <Metric label="Requests per second" value={Math.round(last(t.rps) ?? 0).toLocaleString('en-US')} data={t.rps} tone="text-fg-2" unit={(v) => Math.round(v).toLocaleString('en-US')} />}
              {t.latency && t.latency.some((x) => x > 0) && <Metric label="p95 latency" value={`${Math.round(last(t.latency) ?? 0)} ms`} data={t.latency} tone="text-warn" unit={(v) => `${Math.round(v)} ms`} />}
            </div>
          ) : (
            <p className="m-0 rounded-[10px] bg-canvas px-3.5 py-3 text-13 text-fg-muted">
              {n.cpu != null ? `CPU is at ${Math.round(n.cpu)}%${n.mem != null ? ` and memory at ${Math.round(n.mem)}%` : ''}. History appears after the next scan.` : 'No utilization metrics for this node yet.'}
            </p>
          )}
        </section>

        {mine.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <h3 className="m-0 text-sm font-semibold">Findings <span className="font-normal text-fg-muted">· {mine.length}</span></h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {mine.map((f) => (
                <li key={f.id} className="flex flex-col gap-2 rounded-[10px] border border-line px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-13 font-medium text-fg">{f.title}</span>
                    <span className="flex-none font-mono text-13 text-ok">{usd(f.impact)}/mo</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-fg-muted">{f.difficulty === 'easy' ? 'Quick win' : 'Needs planning'} · {f.timeToImplement}</span>
                    {f.state === 'open' && f.automatable && (
                      approving === f.id
                        ? <span className="flex gap-1.5"><Button size="sm" onClick={() => setApproving(null)}>Cancel</Button><Button size="sm" variant="primary" onClick={() => { void actions.approveFinding(f.id); setApproving(null); }}>Approve change</Button></span>
                        : <Button size="sm" onClick={() => setApproving(f.id)}>Review and approve</Button>
                    )}
                    {f.state === 'running' && <Badge tone="accent">Applying · {Math.round((f.progress ?? 0) * 100)}%</Badge>}
                    {f.state === 'done' && <Badge tone="ok"><IconCheck size={12} />Applied</Badge>}
                    {f.state === 'failed' && <Badge tone="warn">Failed</Badge>}
                    {f.state === 'open' && !f.automatable && <span className="text-xs text-fg-faint">Manual change</span>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {deps.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <h3 className="m-0 text-sm font-semibold">Dependencies</h3>
            <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[10px] border border-line p-0">
              {deps.map((e, i) => {
                const other = byId.get(e.from === n.id ? e.to : e.from);
                if (!other) return null;
                const out = e.from === n.id;
                return (
                  <li key={i} className="border-b border-line-soft last:border-b-0">
                    <button type="button" onClick={() => onSelect(other.id)} className="flex w-full items-center gap-3 border-0 bg-transparent px-3.5 py-2.5 text-left text-13 hover:bg-canvas">
                      <span className="w-[86px] flex-none font-mono text-11 text-fg-faint">{e.kind === 'replicates' ? 'replicates' : out ? 'depends on' : 'used by'}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-fg">{other.label}</span>
                      {e.label && <span className="flex-none font-mono text-11 text-fg-muted">{e.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {kids.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <h3 className="m-0 text-sm font-semibold">{n.kind === 'integration' ? 'Clusters and services' : 'Services'} <span className="font-normal text-fg-muted">· {kids.length}</span></h3>
            <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[10px] border border-line p-0">
              {kids.map((k) => (
                <li key={k.id} className="border-b border-line-soft last:border-b-0">
                  <button type="button" onClick={() => onSelect(k.id)} className={cx('flex w-full items-center gap-3 border-0 bg-transparent py-2.5 pr-3.5 text-left text-13 hover:bg-canvas', k.kind === 'cluster' ? 'pl-3.5 font-medium' : 'pl-7')}>
                    {k.status && <span className={cx('h-2 w-2 flex-none rounded-full', STATUS[k.status].dot)} />}
                    <span className="min-w-0 flex-1 truncate text-fg">{k.label}</span>
                    {k.cpu != null && (
                      <span className="flex w-[90px] flex-none items-center gap-2">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-line-soft"><span className="block h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.round(k.cpu)}%` }} /></span>
                        <span className="w-8 text-right font-mono text-11 tabular-nums text-fg-muted">{Math.round(k.cpu)}%</span>
                      </span>
                    )}
                    {k.kind === 'service' && k.monthlyCost != null && <span className="w-[72px] flex-none text-right font-mono text-11 text-fg-muted">{usd(k.monthlyCost)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Drawer>
  );
}

export const Infrastructure = ({ nodeId }: { nodeId?: string | null }) => {
  const topology = useApp((s) => s.topology);
  const graph = useApp((s) => s.graph);
  const { navigate } = useRouter();
  const [env, setEnv] = useState<'all' | Env>('all');
  const [q, setQ] = useState('');
  const selected = nodeId ?? null;
  const select = (id: string | null) => navigate(id ? `/infrastructure/${encodeURIComponent(id)}` : '/infrastructure', { replace: true, transition: 'none' });

  const envs = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const set = new Set(graph.nodes.map((n) => envOf(byId, n)).filter((x): x is Env => !!x));
    return (['cloud', 'dc', 'labs', 'edge', 'saas'] as Env[]).filter((e) => set.has(e));
  }, [graph]);
  const model = useMemo(() => infraModel(graph, { env, q }), [graph, env, q]);
  const hits = useMemo(() => infraMatches(graph, q), [graph, q]);
  const groups = topology.groups.filter((g) => env === 'all' || g.key === env);
  const zoom = useZoom();
  const graphBox = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => {
    const c: Record<NodeStatus, number> = { healthy: 0, idle: 0, hot: 0, degraded: 0 };
    for (const n of graph.nodes) if (n.kind === 'service' && n.status) c[n.status] += 1;
    return c;
  }, [graph]);

  return (
    <>
      <PageHeader title="Infrastructure" />
      <Page>
        <PageHeading title="Topology" sub="Everything Martian can see, grouped by integration and cluster, with the dependencies between services. Click any node for live metrics." />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] rounded-xl border border-line bg-surface">
          {topology.summary.map((s, i) => (
            <div key={s.label} className={cx('flex flex-col gap-1 px-[22px] py-[18px]', i < topology.summary.length - 1 && 'border-r border-line-soft')}>
              <span className={cx('font-mono text-2xl font-medium tabular-nums', s.accent && 'text-accent')}>{s.value}</span>
              <span className="text-13 text-fg-muted">{s.label}</span>
            </div>
          ))}
        </div>

        <section aria-label="Infrastructure map" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegTabs<'all' | Env> items={[{ key: 'all', label: 'All' }, ...envs.map((e) => ({ key: e, label: ENV_LABEL[e] }))]} value={env} onChange={setEnv} label="Environment" />
            <label className="box-border flex h-10 w-[300px] max-w-full items-center gap-2 rounded-lg border border-line-strong bg-surface px-3">
              <IconSearch size={16} className="text-fg-faint" />
              <span className="sr-only-clip">Search the map</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search services, clusters, tags" className="min-w-0 flex-1 border-0 bg-transparent text-sm text-fg outline-none" />
              {hits && <span className="flex-none font-mono text-xs text-fg-faint">{[...hits].filter((h) => graph.nodes.find((n) => n.id === h)?.kind === 'service').length} found</span>}
            </label>
          </div>
          <div ref={graphBox}>
            <ForceGraph
              nodes={model.nodes}
              edges={model.edges}
              layoutKey={model.layoutKey}
              selected={selected}
              onSelect={select}
              highlight={hits}
              height="min(720px, 78vh)"
              ariaLabel="Map of integrations, clusters and services"
              layout={{ mode: 'radial', gap: 14, step: 116, stretch: 1.35, hideMinorBelow: 0.62 }}
              onExpand={() => zoom.open(graphBox.current)}
            />
          </div>
          <ZoomOverlay state={zoom.state} onClose={zoom.close} label="Infrastructure map">
            <ForceGraph
              nodes={model.nodes}
              edges={model.edges}
              layoutKey={`${model.layoutKey}:full`}
              selected={selected}
              onSelect={(id) => { zoom.close(); select(id); }}
              highlight={hits}
              height="100%"
              className="rounded-none border-0"
              ariaLabel="Map of integrations, clusters and services, full screen"
              layout={{ mode: 'radial', gap: 14, step: 116, stretch: 1.6, hideMinorBelow: 0.5 }}
            />
          </ZoomOverlay>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg-muted">
            {(Object.keys(STATUS) as NodeStatus[]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5"><span className={cx('h-2 w-2 rounded-full', STATUS[k].dot)} />{STATUS[k].label} <span className="font-mono text-fg-faint">{counts[k]}</span></span>
            ))}
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent/60" />depends on</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-accent" />replicates</span>
            <span className="inline-flex items-center gap-1.5">Ring = CPU · badge = open findings</span>
          </div>
        </section>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(380px,100%),1fr))] gap-4">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.name} className="ix-card flex flex-col rounded-xl border border-line bg-surface">
              <header className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h3 className="m-0 text-15 font-semibold">{g.name}</h3>
                  <span className="truncate text-xs text-fg-muted">{g.where}</span>
                </div>
                <span className="flex-none font-mono text-sm text-fg-2">{g.cost}/mo</span>
              </header>
              <ul className="m-0 flex list-none flex-col p-0">
                {g.systems.map((s) => (
                  <li key={s.nodeId ?? s.name} className="border-b border-line-soft last:border-b-0">
                    <button type="button" onClick={() => s.nodeId && select(s.nodeId)} className="grid w-full grid-cols-[minmax(0,1fr)_96px] items-center gap-3 border-0 bg-transparent px-5 py-3 text-left hover:bg-canvas">
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium text-fg">{s.name}</span>
                        <span className="truncate font-mono text-xs text-fg-muted">{s.a} · {s.b}</span>
                      </span>
                      {s.util != null ? (
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft">
                            <span className={cx('block h-full rounded-full transition-[width] duration-700', s.util < 10 ? 'bg-idle' : s.util > 78 ? 'bg-warn' : 'bg-ok')} style={{ width: `${Math.max(2, s.util)}%` }} />
                          </span>
                          <span className="w-9 text-right font-mono text-xs tabular-nums text-fg-body">{s.util}%</span>
                        </span>
                      ) : <span className="text-right font-mono text-xs text-fg-faint">no CPU</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Page>
      <NodeDrawer id={selected} onClose={() => select(null)} onSelect={select} />
    </>
  );
};
