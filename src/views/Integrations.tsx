import React, { useEffect, useMemo, useState } from 'react';
import { Link, useRouter } from '../app/router';
import { IntegrationStatus, IntegrationView, ToolCallView, useActions, useApp } from '../app/store';
import { ago, IntegrationLogo } from '../components/bits';
import { CATEGORIES } from '../data/catalog';
import { MODE_LABEL, MODES } from '../data/modes';
import { Page, PageHeader, PageHeading } from '../shell/AppShell';
import { IconCheck, IconCode, IconSearch } from '../ui/icons';
import { Badge, Button, Card, cx, Dialog, Drawer, Field, fieldInput, SegTabs, Toggle } from '../ui/kit';

type Cat = (typeof CATEGORIES)[number]['key'];
type Transport = 'http' | 'stdio';

const RANK: Record<IntegrationStatus, number> = { connected: 0, auth: 1, error: 1, offline: 1, pending: 1, disabled: 2, available: 3, soon: 4 };

const StatusBadge = ({ status }: { status: IntegrationStatus }) => {
  if (status === 'connected') return <Badge tone="ok" dot>Connected</Badge>;
  if (status === 'auth') return <Badge tone="warn">Needs sign-in</Badge>;
  if (status === 'error') return <Badge tone="warn">Error</Badge>;
  if (status === 'offline') return <Badge tone="warn">Connector offline</Badge>;
  if (status === 'pending') return <Badge tone="neutral">Connecting</Badge>;
  if (status === 'disabled') return <Badge tone="neutral">Off</Badge>;
  if (status === 'available') return <Badge tone="neutral">Available</Badge>;
  return <Badge tone="soon">Coming soon</Badge>;
};

function RadioCard({ active, onClick, title, help }: { active: boolean; onClick: () => void; title: string; help: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cx('flex items-start gap-3 rounded-[10px] px-3.5 py-3 text-left', active ? 'border-[1.5px] border-accent bg-accent-wash' : 'border border-line bg-surface')}
    >
      <span className={cx('mt-0.5 box-border h-4 w-4 flex-none rounded-full bg-surface', active ? 'border-[5px] border-accent' : 'border-[1.5px] border-side-muted')} />
      <span className="flex flex-col gap-0.5">
        <span className={cx('text-sm text-fg', active ? 'font-semibold' : 'font-medium')}>{title}</span>
        <span className={cx('text-13', active ? 'text-fg-body' : 'text-fg-muted')}>{help}</span>
      </span>
    </button>
  );
}

const Logo = ({ c, size }: { c: IntegrationView; size: number }) => <IntegrationLogo id={c.catalogId === 'custom' ? 'custom' : c.catalogId} size={size} title={c.name} />;

function ConfigureDrawer({ cur, onClose }: { cur: IntegrationView | null; onClose: () => void }) {
  const ig = useActions().integrations;
  const now = useApp((s) => Math.floor(s.now / 10000) * 10000);
  const servers = useApp((s) => s.servers);
  const [values, setValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<boolean | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [calls, setCalls] = useState<ToolCallView[]>([]);
  const id = cur?.id ?? null;

  useEffect(() => {
    if (!cur) return;
    setValues(Object.fromEntries((cur.fields ?? []).map((f) => [f.key, f.value])));
    setTested(cur.status === 'connected' ? true : null);
    setTestError(cur.lastError ?? null);
    setConfirming(false);
    let stop = false;
    ig.recentCalls(cur.id).then((r) => { if (!stop) setCalls(r); }).catch(() => setCalls([]));
    return () => { stop = true; };
    // Reset only when a different integration opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // Keep recent calls fresh while the drawer is open.
  const callCount = cur?.callCount ?? 0;
  useEffect(() => {
    if (!id) return;
    let stop = false;
    ig.recentCalls(id).then((r) => { if (!stop) setCalls(r); }).catch(() => undefined);
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callCount]);

  if (!cur) return null;
  const test = async () => {
    setTesting(true); setTested(null); setTestError(null);
    try {
      await ig.saveConnection(cur.id, values);
      const r = await ig.test(cur.id);
      setTested(r.ok); setTestError(r.error);
    } catch (e) {
      setTestError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };
  const save = async () => {
    try { await ig.saveConnection(cur.id, values); onClose(); } catch (e) { setTestError((e as Error).message); }
  };
  const on = cur.tools.filter((t) => t.on).length;
  const reachable = servers.filter((s) => s.status === 'connected').length;

  return (
    <Drawer
      open
      onClose={onClose}
      label={`Configure ${cur.name}`}
      width={580}
      header={
        <div className="flex items-center gap-3">
          <Logo c={cur} size={44} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="m-0 truncate text-lg font-semibold">{cur.name}</h2>
            <span className="truncate font-mono text-xs text-fg-faint">MCP server · {cur.transport}</span>
          </div>
        </div>
      }
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save changes</Button></>}
    >
      <div className="flex flex-col gap-7 p-6">
        <section className="flex flex-col gap-2">
          <p className="m-0 text-sm leading-relaxed text-fg-2">{cur.desc}</p>
          <p className="m-0 text-xs text-fg-faint">{cur.status === 'connected' ? `Last sync ${ago(now, cur.lastSync)} · ${cur.callCount.toLocaleString('en-US')} tool calls` : <StatusBadge status={cur.status} />}</p>
        </section>

        <section className="flex flex-col gap-3.5">
          <h3 className="m-0 text-sm font-semibold">Connection</h3>
          {cur.connector && (
            <p className="m-0 text-13 text-fg-muted">
              Runs on connector <b className="font-medium text-fg">{cur.connector.name}</b>{cur.connector.sandbox ? ' · sandbox' : ''} · {cur.connector.status}
            </p>
          )}
          {cur.catalogId === 'ssh' && (
            <p className="m-0 rounded-[10px] bg-canvas px-3.5 py-3 text-13 leading-normal text-fg-body">
              {reachable} of {servers.length} servers reachable. Add or edit servers in <Link to="/settings/servers" className="font-medium text-accent-link">Settings</Link>.
            </p>
          )}
          {(cur.fields ?? []).length > 0 ? (
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              {(cur.fields ?? []).map((f) => (
                <Field key={f.key} id={`c-${f.key}`} label={f.label}>
                  <input
                    id={`c-${f.key}`} type={f.type === 'secret' ? 'password' : 'text'} value={values[f.key] ?? ''} autoComplete="off"
                    placeholder={f.type === 'secret' ? 'Stored encrypted. Leave blank to keep it.' : f.type === 'list' ? 'Comma separated' : ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className={`${fieldInput} h-10 font-mono text-13`}
                  />
                </Field>
              ))}
            </div>
          ) : cur.catalogId !== 'ssh' && <p className="m-0 text-13 text-fg-muted">Nothing to set here. Credentials live on the connector.</p>}
          {cur.externalId && (
            <p className="m-0 rounded-[10px] bg-canvas px-3.5 py-3 text-13 leading-normal text-fg-body">
              Use external ID <code className="font-mono text-fg">{cur.externalId}</code> in each role's trust policy. The CloudFormation template in <code className="font-mono">deploy/onboarding/aws</code> sets it up.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" className="h-[38px]" onClick={() => void test()} disabled={testing}>Save and test</Button>
            {testing && <span className="text-13 text-fg-muted">Testing…</span>}
            {!testing && tested && <span className="inline-flex items-center gap-1.5 text-13 text-ok"><IconCheck size={15} />Connected. Access checked.</span>}
            {!testing && testError && <span className="text-13 text-danger">{testError}</span>}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="m-0 text-sm font-semibold">Permissions</h3>
          <div role="radiogroup" aria-label="Permission mode" className="flex flex-col gap-2">
            {MODES.map((md) => <RadioCard key={md.key} active={cur.mode === md.key} onClick={() => ig.setMode(cur.id, md.key)} title={md.label} help={md.help} />)}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="m-0 text-sm font-semibold">Tools <span className="font-normal text-fg-muted">· {on} of {cur.tools.length} on</span></h3>
            {cur.tools.some((t) => t.write && t.on) && <button type="button" onClick={() => ig.turnOffWrites(cur.id)} className="h-9 border-0 bg-transparent px-1 text-13 font-medium text-accent-link">Turn off write tools</button>}
          </div>
          <div className="overflow-hidden rounded-[10px] border border-line">
            {cur.tools.length === 0 && <p className="m-0 px-3.5 py-4 text-13 text-fg-muted">Looking for tools…</p>}
            {cur.tools.map((t) => (
              <div key={t.name} className="flex items-center gap-3 border-b border-line-soft py-1.5 pl-3.5 pr-2 last:border-b-0">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-mono text-13 text-fg">{t.name}</span>
                  <span className="text-xs text-fg-muted">{t.desc}</span>
                </div>
                <span className={cx('rounded px-1.5 py-0.5 text-11 font-semibold', t.write ? 'bg-accent-wash text-accent-ink' : 'bg-line-soft text-fg-body')}>{t.write ? 'WRITE' : 'READ'}</span>
                <Toggle small on={t.on} onChange={() => ig.toggleTool(cur.id, t.name)} label={`Turn on ${t.name}`} />
              </div>
            ))}
          </div>
        </section>

        {cur.scope.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <h3 className="m-0 text-sm font-semibold">Scope</h3>
            <div className="flex flex-wrap gap-1.5 font-mono text-xs">
              {cur.scope.map((s) => <span key={s} className="rounded-md border border-line bg-canvas px-2 py-[5px]">{s}</span>)}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2.5">
          <h3 className="m-0 text-sm font-semibold">Recent tool calls</h3>
          <div className="overflow-x-auto rounded-[10px] border border-line">
            <table className="w-full min-w-[460px] border-collapse font-mono text-xs">
              <tbody>
                {calls.length === 0 && <tr><td className="px-3 py-[9px] text-fg-faint">No tool calls yet</td></tr>}
                {calls.slice(0, 12).map((l, i) => (
                  <tr key={`${l.at}-${i}`}>
                    <td className="border-b border-line-soft px-3 py-[9px] text-fg-faint">{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                    <td className="border-b border-line-soft px-3 py-[9px] text-fg-body">{l.agent}</td>
                    <td className="border-b border-line-soft px-3 py-[9px] text-fg">{l.tool}</td>
                    <td className={cx('border-b border-line-soft px-3 py-[9px] text-right', l.ok ? 'text-ok' : 'text-danger')}>{l.ok ? 'ok' : 'failed'} · {l.ms >= 1000 ? `${(l.ms / 1000).toFixed(1)}s` : `${l.ms}ms`}</td>
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
              <span className="text-13 text-fg-body">Agents lose access to {cur.short} right away.</span>
              <Button size="sm" variant="dangerOutline" className="h-[38px]" onClick={() => setConfirming(true)}>Disconnect</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-13 font-medium text-fg">Disconnect {cur.name}?</span>
              <div className="flex gap-2">
                <Button size="sm" className="h-[38px]" onClick={() => setConfirming(false)}>Cancel</Button>
                <Button size="sm" variant="danger" className="h-[38px]" onClick={() => { ig.disconnect(cur.id); onClose(); }}>Disconnect</Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function CustomDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const ig = useActions().integrations;
  const [transport, setTransport] = useState<Transport>('http');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [auth, setAuth] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    try {
      await ig.addCustom(name, transport, url, auth);
      setName(''); setUrl(''); setAuth(''); setError(null);
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      label="Add custom MCP server"
      width={580}
      header={<div className="flex flex-col gap-1">
        <h2 className="m-0 text-lg font-semibold">Add a custom MCP server</h2>
        <p className="m-0 text-13 text-fg-muted">Martian lists the server's tools once you authorize it. New tools start off.</p>
      </div>}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!url.trim()} onClick={() => void add()}>Add server</Button></>}
    >
      <div className="flex flex-col gap-4 p-6">
        <Field id="m-name" label="Name"><input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Internal CMDB" className={fieldInput} /></Field>
        <div role="radiogroup" aria-label="Transport" className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
          <RadioCard active={transport === 'http'} onClick={() => setTransport('http')} title="Streamable HTTP" help="A remote server at an https URL" />
          <RadioCard active={transport === 'stdio'} onClick={() => setTransport('stdio')} title="stdio" help="A local command on a Martian connector" />
        </div>
        <Field id="m-url" label={transport === 'http' ? 'Server URL' : 'Command'}>
          <input id="m-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={transport === 'http' ? 'https://mcp.internal.example.com/mcp' : 'npx -y @example/cmdb-mcp'} className={`${fieldInput} font-mono text-13`} />
        </Field>
        <Field id="m-auth" label={<>Authorization header <span className="font-normal text-fg-muted">· optional</span></>}>
          <input id="m-auth" type="password" autoComplete="off" value={auth} onChange={(e) => setAuth(e.target.value)} placeholder="Bearer …" className={`${fieldInput} font-mono text-13`} />
        </Field>
        {error && <p role="alert" className="m-0 text-13 text-danger">{error}</p>}
        <p className="m-0 rounded-[10px] bg-canvas px-3.5 py-3 text-13 leading-normal text-fg-body">
          Custom servers start read-only. Only connect servers your team runs or trusts.
        </p>
      </div>
    </Dialog>
  );
}

export const Integrations = ({ openId }: { openId?: string | null }) => {
  const all = useApp((s) => s.integrations);
  const now = useApp((s) => Math.floor(s.now / 10000) * 10000);
  const ig = useActions().integrations;
  const { navigate } = useRouter();
  const [cat, setCat] = useState<Cat>('all');
  const [query, setQuery] = useState('');
  const open = (id: string | null) => navigate(id ? `/integrations/${encodeURIComponent(id)}` : '/integrations', { replace: true, transition: 'none' });

  const q = query.trim().toLowerCase();
  const cards = useMemo(() => all
    .filter((c) => (cat === 'all' || c.cat === cat) && (!q || `${c.name} ${c.short} ${c.tagline}`.toLowerCase().includes(q)))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name)), [all, cat, q]);
  const counts = useMemo(() => {
    const live = all.filter((c) => c.status !== 'available' && c.status !== 'soon');
    return {
      connected: all.filter((c) => c.status === 'connected').length,
      attention: all.filter((c) => RANK[c.status] === 1).length,
      tools: live.reduce((n, c) => n + c.tools.filter((t) => t.on).length, 0),
      writes: live.reduce((n, c) => n + c.tools.filter((t) => t.on && t.write).length, 0),
      available: all.filter((c) => c.status === 'available').length,
    };
  }, [all]);
  const cur = openId && openId !== 'custom' ? all.find((c) => c.id === openId) ?? null : null;

  return (
    <>
      <PageHeader title="Integrations" actions={<Button size="sm" onClick={() => open('custom')}><IconCode size={15} />Add custom MCP server</Button>} />
      <Page>
        <PageHeading
          title="Integrations"
          sub="Each integration is an MCP server your agents can call. You pick which tools they can use and which changes wait for approval."
        />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          {[
            { l: 'Connected', v: counts.connected },
            { l: 'Needs attention', v: counts.attention, c: counts.attention ? 'text-warn' : '' },
            { l: 'Tools on', v: counts.tools },
            { l: 'Write tools (ask first)', v: counts.writes, c: 'text-accent' },
          ].map((s) => (
            <Card key={s.l} className="flex flex-col gap-1 px-5 py-4">
              <span className="text-13 text-fg-muted">{s.l}</span>
              <span className={cx('font-mono text-26 font-medium tabular-nums', s.c)}>{s.v}</span>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegTabs<Cat> items={CATEGORIES} value={cat} onChange={setCat} label="Category" />
          <label className="box-border flex h-10 w-[280px] max-w-full items-center gap-2 rounded-lg border border-line-strong bg-surface px-3">
            <IconSearch size={16} className="text-fg-faint" />
            <span className="sr-only-clip">Search integrations</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search integrations" className="min-w-0 flex-1 border-0 bg-transparent text-sm text-fg outline-none" />
          </label>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4">
          {cards.length === 0 && <p className="m-0 text-sm text-fg-muted">Nothing matches “{query}”.</p>}
          {cards.map((c) => {
            const soon = c.status === 'soon';
            const available = c.status === 'available';
            const live = !soon && !available;
            const tools = c.tools.filter((t) => t.on).length;
            const writes = c.tools.filter((t) => t.write).length;
            return (
              <article key={c.id} className={cx('flex flex-col gap-3.5 rounded-xl border border-line bg-surface p-5 transition-colors', live && 'hover:border-line-strong', soon && 'opacity-75')}>
                <div className="flex items-start gap-3">
                  <Logo c={c} size={44} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <h3 className="m-0 truncate text-15 font-semibold">{c.name}</h3>
                    <span className="truncate font-mono text-xs text-fg-faint">{c.transport}</span>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                <p className="m-0 text-sm leading-normal text-fg-body">{c.tagline}</p>
                <div className="flex flex-wrap gap-1.5 font-mono text-xs">
                  <span className="rounded-md border border-line-soft bg-canvas px-2 py-[3px] text-fg-2">{live ? `${tools} of ${c.tools.length} tools on` : `${c.tools.length} tools · ${writes} write`}</span>
                  {live && <span className="rounded-md border border-line-soft bg-canvas px-2 py-[3px] text-fg-2">{MODE_LABEL[c.mode]}</span>}
                  {c.status === 'connected' && <span className="px-0.5 py-[3px] text-fg-faint">synced {ago(now, c.lastSync)}</span>}
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-line-soft pt-3">
                  {soon ? <span className="text-13 text-fg-faint">Planned for a later release</span>
                    : available ? <Button size="sm" variant="primary" onClick={() => { ig.connect(c.id); }}>Connect</Button>
                      : <Button size="sm" onClick={() => open(c.id)}>{c.status === 'auth' ? 'Reconnect' : 'Configure'}</Button>}
                  {live && <Toggle on={c.enabled} onChange={() => ig.toggle(c.id)} label={`Turn ${c.enabled ? 'off' : 'on'} ${c.name}`} />}
                </div>
              </article>
            );
          })}
        </div>
        {counts.available > 0 && cat === 'all' && !q && (
          <p className="m-0 text-13 text-fg-muted">{counts.available} more integrations are ready to connect. Each one starts read-only.</p>
        )}
      </Page>

      <ConfigureDrawer cur={cur} onClose={() => open(null)} />
      <CustomDialog open={openId === 'custom'} onClose={() => open(null)} onAdded={() => { setCat('custom'); open(null); }} />
    </>
  );
};
