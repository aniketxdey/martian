import React, { useEffect, useState } from 'react';
import { LIVE } from '../api/client';
import { CATEGORIES, Integration, IntegrationStatus, MODE_LABEL, MODES } from '../data/integrations';
import { Transport, useIntegrations } from '../state/useIntegrations';
import { ToolCall, useIntegrationsLive } from '../state/useIntegrationsLive';

// Chosen once per build: the live API when VITE_API_URL is set, demo fixtures otherwise.
const useIg = LIVE ? useIntegrationsLive : useIntegrations;
import { IconCheck, IconCode, IconPlus, IconSearch } from '../ui/icons';
import { Badge, Button, Card, Dialog, Drawer, Field, SegTabs, Toggle, cx, fieldInput } from '../ui/kit';
import { Page, PageHeading } from '../shell/AppShell';

type Cat = (typeof CATEGORIES)[number]['key'];

const MonoTile = ({ text }: { text: string }) => (
  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] border border-line bg-chip font-mono text-xs font-medium text-fg-2">{text}</span>
);

const StatusBadge = ({ status }: { status: IntegrationStatus }) => {
  if (status === 'connected') return <Badge tone="ok" dot>Connected</Badge>;
  if (status === 'auth') return <Badge tone="warn">Needs auth</Badge>;
  if (status === 'error') return <Badge tone="warn">Error</Badge>;
  if (status === 'offline') return <Badge tone="warn">Connector offline</Badge>;
  if (status === 'pending') return <Badge tone="neutral">Pending</Badge>;
  if (status === 'disabled') return <Badge tone="neutral">Disabled</Badge>;
  return <Badge tone="soon">Coming soon</Badge>;
};

function RadioCard({ active, onClick, title, help }: { active: boolean; onClick: () => void; title: string; help: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cx('flex items-start gap-3 rounded-[10px] px-3.5 py-3 text-left', active ? 'border-[1.5px] border-accent bg-accent-wash' : 'border border-line bg-white')}
    >
      <span className={cx('mt-0.5 box-border h-4 w-4 flex-none rounded-full bg-white', active ? 'border-[5px] border-accent' : 'border-[1.5px] border-side-muted')} />
      <span className="flex flex-col gap-0.5">
        <span className={cx('text-sm text-fg', active ? 'font-semibold' : 'font-medium')}>{title}</span>
        <span className={cx('text-[13px]', active ? 'text-fg-body' : 'text-fg-muted')}>{help}</span>
      </span>
    </button>
  );
}

export const Integrations = ({
  machines, onOpenSettings, initialPanel = null,
}: { machines: any[]; onOpenSettings: () => void; initialPanel?: string | null }) => {
  const ig = useIg();
  const [cat, setCat] = useState<Cat>('all');
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<string | null>(initialPanel);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [transport, setTransport] = useState<Transport>('http');
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customAuth, setCustomAuth] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [testError, setTestError] = useState<string | null>(null);
  const [calls, setCalls] = useState<ToolCall[]>([]);

  const reachable = machines.filter((x) => x.status === 'connected').length;
  const syncOf = (c: Integration) => (c.id === 'ssh' ? `${reachable} of ${machines.length} servers reachable` : c.sync ?? '');
  const statusOf = (c: Integration) => (c.status === 'soon' ? 'soon' : !ig.isOn(c) ? 'disabled' : c.status);

  const q = query.trim().toLowerCase();
  const cards = ig.all.filter((c) => (cat === 'all' || c.cat === cat) && (!q || c.name.toLowerCase().includes(q)));

  const cur = ig.all.find((c) => c.id === panel);
  const drawerOpen = !!cur;
  const curTools = cur ? ig.toolsOf(cur) : [];

  const openConfigure = (c: Integration) => {
    setPanel(c.id); setConfirming(false); setTested(c.status === 'connected'); setTestError(c.lastError ?? null);
    setValues(Object.fromEntries((c.fields ?? []).map((f) => [f.key, f.value])));
  };
  const close = () => { setPanel(null); setConfirming(false); };
  const test = async () => {
    if (!cur) return;
    setTesting(true); setTested(false); setTestError(null);
    try {
      if (ig.live) await ig.saveConnection(cur, values);
      const r = await ig.test(cur.id);
      setTested(r.ok); setTestError(r.error);
    } catch (e) {
      setTestError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };
  const save = async () => { if (cur && ig.live) await ig.saveConnection(cur, values).catch((e) => setTestError((e as Error).message)); close(); };

  useEffect(() => {
    if (!panel || panel === 'custom') return;
    let stop = false;
    ig.recentCalls(panel).then((r) => { if (!stop) setCalls(r); }).catch(() => setCalls([]));
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  return (
    <Page>
      <PageHeading
        title="Integrations"
        sub="Connect clouds and tools as MCP servers your agents can use. You choose which tools each agent can call, and which actions need your approval."
        actions={
          <div className="flex flex-wrap gap-2.5">
            <Button onClick={() => setPanel('custom')}><IconCode size={16} />Add custom MCP server</Button>
            <Button variant="primary" onClick={() => setCat('cloud')}><IconPlus size={16} />Add integration</Button>
          </div>
        }
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        {[
          { l: 'Connected', v: ig.summary.connected },
          { l: 'Needs attention', v: ig.summary.attention, c: 'text-warn' },
          { l: 'Tools enabled', v: ig.summary.tools },
          { l: 'Write tools · ask first', v: ig.summary.writes, c: 'text-accent' },
        ].map((s) => (
          <Card key={s.l} className="flex flex-col gap-1 px-5 py-4">
            <span className="text-[13px] text-fg-muted">{s.l}</span>
            <span className={cx('font-mono text-[26px] font-medium', s.c)}>{s.v}</span>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegTabs<Cat> items={CATEGORIES} value={cat} onChange={setCat} label="Category" />
        <label className="box-border flex h-10 w-[280px] max-w-full items-center gap-2 rounded-lg border border-line-strong bg-white px-3">
          <IconSearch size={16} color="#6B6F76" />
          <span className="sr-only-clip">Search integrations</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search integrations" className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" />
        </label>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4">
        {cards.length === 0 && <p className="m-0 text-sm text-fg-muted">No integrations match "{query}".</p>}
        {cards.map((c) => {
          const st = statusOf(c);
          const tools = ig.toolsOf(c);
          const soon = st === 'soon';
          return (
            <article key={c.id} className="flex flex-col gap-3.5 rounded-xl border border-line bg-white p-5">
              <div className="flex items-start gap-3">
                <MonoTile text={c.mono} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <h3 className="m-0 text-[15px] font-semibold">{c.name}</h3>
                  <span className="font-mono text-xs text-fg-faint">{c.transport}</span>
                </div>
                <StatusBadge status={st} />
              </div>
              <p className="m-0 text-sm leading-normal text-fg-body">
                {c.id === 'ssh'
                  ? <>SSH and RDP access to on-premises machines. Servers are managed in <button type="button" onClick={onOpenSettings} className="border-0 bg-transparent p-0 text-sm font-medium text-accent-link">Settings</button>.</>
                  : c.desc}
              </p>
              <div className="flex flex-wrap gap-1.5 font-mono text-xs">
                <span className="rounded-md border border-line-soft bg-canvas px-2 py-[3px] text-fg-2">{soon ? 'MCP server' : `${tools.length} tools · ${tools.filter((t) => t.write).length} write`}</span>
                <span className="rounded-md border border-line-soft bg-canvas px-2 py-[3px] text-fg-2">{soon ? 'Read-only' : MODE_LABEL[ig.modeOf(c)]}</span>
                {!soon && <span className="px-0.5 py-[3px] text-fg-faint">{syncOf(c)}</span>}
              </div>
              <div className="mt-auto flex items-center justify-between border-t border-line-soft pt-3">
                {soon
                  ? <span className="text-[13px] text-fg-faint">Proposed for a later release</span>
                  : <Button size="sm" onClick={() => openConfigure(c)}>{st === 'auth' ? 'Reconnect' : 'Configure'}</Button>}
                <Toggle on={ig.isOn(c)} disabled={soon} onChange={() => ig.toggleIntegration(c.id)} label={`Enable ${c.name}`} />
              </div>
            </article>
          );
        })}
      </div>

      {/* Configure drawer */}
      <Drawer
        open={drawerOpen}
        onClose={close}
        label={`Configure ${cur?.name ?? ''}`}
        width={560}
        header={cur && (
          <div className="flex items-center gap-3">
            <MonoTile text={cur.mono} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="m-0 text-lg font-semibold">{cur.name}</h2>
              <span className="font-mono text-xs text-fg-faint">MCP server · {cur.transport}</span>
            </div>
          </div>
        )}
        footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save changes</Button></>}
      >
        {cur && (
          <div className="flex flex-col gap-7 p-6">
            {/* Connection — AWS/Azure inputs replace the old Setup credential forms (uncontrolled, as before) */}
            <section className="flex flex-col gap-3.5">
              <h3 className="m-0 text-sm font-semibold">Connection</h3>
              {cur.connector && (
                <p className="m-0 text-[13px] text-fg-muted">
                  Runs on connector <b className="font-medium text-fg">{cur.connector.name}</b>
                  {cur.connector.sandbox ? ' · sandbox' : ''} · {cur.connector.status}
                </p>
              )}
              {ig.live ? (
                (cur.fields ?? []).length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                    {(cur.fields ?? []).map((f) => (
                      <Field key={f.key} id={`c-${f.key}`} label={f.label}>
                        <input
                          id={`c-${f.key}`} type={f.type === 'secret' ? 'password' : 'text'} value={values[f.key] ?? ''}
                          placeholder={f.type === 'secret' ? 'Stored encrypted · leave blank to keep' : f.type === 'list' ? 'Comma separated' : ''}
                          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                          className={`${fieldInput} h-10 font-mono text-[13px]`}
                        />
                      </Field>
                    ))}
                  </div>
                ) : <p className="m-0 text-[13px] text-fg-muted">No settings here. {cur.mono === 'SSH' ? 'Servers are managed in Settings.' : 'Credentials live on the connector.'}</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                  <Field id="c-a" label={cur.f1 ?? 'Endpoint'}><input id="c-a" defaultValue={cur.v1} className={`${fieldInput} h-10 font-mono text-[13px]`} /></Field>
                  <Field id="c-b" label={cur.f2 ?? 'Secret'}><input id="c-b" type="password" defaultValue={cur.status === 'auth' ? '' : 'secretvalue'} className={`${fieldInput} h-10 font-mono text-[13px]`} /></Field>
                </div>
              )}
              {cur.externalId && (
                <p className="m-0 rounded-[10px] bg-canvas px-3.5 py-3 text-[13px] leading-normal text-fg-body">
                  Use external ID <code className="font-mono text-fg">{cur.externalId}</code> in each role's trust policy. The CloudFormation template in <code className="font-mono">deploy/onboarding/aws</code> sets it up.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" className="h-[38px]" onClick={() => void test()}>Test connection</Button>
                {testing && <span className="text-[13px] text-fg-muted">Testing…</span>}
                {!testing && tested && <span className="inline-flex items-center gap-1.5 text-[13px] text-ok"><IconCheck size={15} />Connected · access verified</span>}
                {!testing && testError && <span className="text-[13px] text-danger">{testError}</span>}
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="m-0 text-sm font-semibold">Permissions</h3>
              <div role="radiogroup" aria-label="Permission mode" className="flex flex-col gap-2">
                {MODES.map((md) => (
                  <RadioCard key={md.key} active={ig.modeOf(cur) === md.key} onClick={() => ig.setMode(cur.id, md.key)} title={md.label} help={md.help} />
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="m-0 text-sm font-semibold">Tools <span className="font-normal text-fg-muted">· {curTools.filter((t) => t.on).length} of {curTools.length} enabled</span></h3>
                <button type="button" onClick={() => ig.turnOffWrites(cur)} className="h-9 border-0 bg-transparent px-1 text-[13px] font-medium text-accent-link">Turn off write tools</button>
              </div>
              <div className="overflow-hidden rounded-[10px] border border-line">
                {curTools.length === 0 && <p className="m-0 px-3.5 py-4 text-[13px] text-fg-muted">Discovering tools…</p>}
                {curTools.map((t) => (
                  <div key={t.name} className="flex items-center gap-3 border-b border-line-soft py-1.5 pl-3.5 pr-2 last:border-b-0">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-mono text-[13px] text-fg">{t.name}</span>
                      <span className="text-xs text-fg-muted">{t.desc}</span>
                    </div>
                    <span className={cx('rounded px-1.5 py-0.5 text-[11px] font-semibold', t.write ? 'bg-accent-wash text-accent-ink' : 'bg-line-soft text-fg-body')}>{t.write ? 'WRITE' : 'READ'}</span>
                    <Toggle small on={t.on} onChange={() => ig.toggleTool(cur.id, t.name)} label={`Enable ${t.name}`} />
                  </div>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-2.5">
              <h3 className="m-0 text-sm font-semibold">Scope</h3>
              <div className="flex flex-wrap gap-1.5 font-mono text-xs">
                {(cur.scope ?? []).map((s) => <span key={s} className="rounded-md border border-line bg-canvas px-2 py-[5px]">{s}</span>)}
                <button type="button" className="rounded-md border border-dashed border-[#C8C9C6] bg-white px-2 py-[5px] font-mono text-xs text-fg-body">+ Add</button>
              </div>
            </section>

            <section className="flex flex-col gap-2.5">
              <h3 className="m-0 text-sm font-semibold">Recent tool calls</h3>
              <div className="overflow-x-auto rounded-[10px] border border-line">
                <table className="w-full min-w-[460px] border-collapse font-mono text-xs">
                  <tbody>
                    {calls.length === 0 && <tr><td className="px-3 py-[9px] text-fg-faint">No tool calls yet</td></tr>}
                    {calls.map((l, i) => (
                      <tr key={i}>
                        <td className="border-b border-line-soft px-3 py-[9px] text-fg-faint">{l.t}</td>
                        <td className="border-b border-line-soft px-3 py-[9px] text-fg-body">{l.agent}</td>
                        <td className="border-b border-line-soft px-3 py-[9px] text-fg">{l.tool}</td>
                        <td className="border-b border-line-soft px-3 py-[9px] text-right text-ok">{l.res}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="flex flex-col gap-2.5 rounded-[10px] border border-danger-soft p-4">
              <h3 className="m-0 text-sm font-semibold text-danger">Disconnect</h3>
              {!confirming ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[13px] text-fg-body">Agents lose access to this integration immediately.</span>
                  <Button size="sm" variant="dangerOutline" className="h-[38px]" onClick={() => setConfirming(true)}>Disconnect</Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[13px] font-medium text-fg">Disconnect {cur.name}?</span>
                  <div className="flex gap-2">
                    <Button size="sm" className="h-[38px]" onClick={() => setConfirming(false)}>Cancel</Button>
                    <Button size="sm" variant="danger" className="h-[38px]" onClick={() => { ig.disconnect(cur.id); close(); }}>Yes, disconnect</Button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </Drawer>

      {/* Add custom MCP server */}
      <Dialog
        open={panel === 'custom'}
        onClose={close}
        label="Add custom MCP server"
        width={580}
        header={<div className="flex flex-col gap-1">
          <h2 className="m-0 text-lg font-semibold">Add custom MCP server</h2>
          <p className="m-0 text-[13px] text-fg-muted">Martian will discover the server's tools after you authorize it. New tools start disabled.</p>
        </div>}
        footer={<>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => { ig.addCustom(customName, transport, customUrl, customAuth); setCustomName(''); setCustomUrl(''); setCustomAuth(''); setCat('custom'); close(); }}>Add server</Button>
        </>}
      >
        <div className="flex flex-col gap-4 p-6">
          <Field id="m-name" label="Name"><input id="m-name" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g., Internal CMDB" className={fieldInput} /></Field>
          <div role="radiogroup" aria-label="Transport" className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
            <RadioCard active={transport === 'http'} onClick={() => setTransport('http')} title="Streamable HTTP" help="Remote server at an https URL" />
            <RadioCard active={transport === 'stdio'} onClick={() => setTransport('stdio')} title="stdio" help="Local command on a Martian runner" />
          </div>
          <Field id="m-url" label={transport === 'http' ? 'Server URL' : 'Command'}>
            <input id="m-url" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder={transport === 'http' ? 'https://mcp.internal.company.com/mcp' : 'npx -y @company/cmdb-mcp'} className={`${fieldInput} font-mono text-[13px]`} />
          </Field>
          <Field id="m-auth" label={<>Authorization header <span className="font-normal text-fg-muted">· optional</span></>}>
            <input id="m-auth" type="password" value={customAuth} onChange={(e) => setCustomAuth(e.target.value)} placeholder="Bearer …" className={`${fieldInput} font-mono text-[13px]`} />
          </Field>
          <Field id="m-desc" label="What should agents use it for?">
            <textarea id="m-desc" rows={2} placeholder="e.g., Look up service owners and cost centers" className="box-border resize-y rounded-lg border border-line-strong px-3 py-2.5 text-sm outline-none" />
          </Field>
          <p className="m-0 rounded-[10px] bg-canvas px-3.5 py-3 text-[13px] leading-normal text-fg-body">
            Custom servers start in <b className="font-semibold">Read-only</b> mode. Only connect servers your team operates or trusts.
          </p>
        </div>
      </Dialog>
    </Page>
  );
};
