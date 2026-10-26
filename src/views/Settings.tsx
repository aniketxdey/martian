import React, { useMemo, useState } from 'react';
import { EMBED } from '../app/env';
import { Accent, ACCENTS, CHAT_FONTS, ChatFont, ChatSize, FontSize, fmtTime, Prefs, usePrefs } from '../app/prefs';
import { Link, runTransition, useRouter } from '../app/router';
import { FileEntry, ServerView, useActions, useApp } from '../app/store';
import { ChatPreview } from '../components/chat/ChatPreview';
import { VARIANTS } from '../demo/variants';
import { Page, PageHeader } from '../shell/AppShell';
import { IconAlert, IconCheck, IconFile, IconFolder, IconMonitor, IconMoon, IconPencil, IconPlus, IconRefresh, IconSun, IconTrash } from '../ui/icons';
import { Badge, Button, Card, cx, Dialog, Drawer, Field, fieldInput, LineTabs, Toggle } from '../ui/kit';

type Tab = 'servers' | 'org' | 'security' | 'appearance' | 'demo';
const OS = ['Ubuntu 22.04 LTS', 'Ubuntu 24.04 LTS', 'Rocky Linux 9', 'Red Hat Enterprise Linux 9', 'Debian 12', 'Windows Server 2019', 'Windows Server 2022'];

const StatusBadge = ({ status }: { status: string }) => {
  if (status === 'connected') return <Badge tone="ok" dot>Connected</Badge>;
  if (status === 'connecting') return <Badge tone="accent">Connecting</Badge>;
  if (status === 'error') return <Badge tone="neutral" className="!bg-danger-wash !text-danger">Can't connect</Badge>;
  return <Badge tone="warn">Needs credentials</Badge>;
};

/* ---------- Servers ---------- */

function Servers() {
  const servers = useApp((s) => s.servers);
  const actions = useActions().servers;
  const [editing, setEditing] = useState<ServerView | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [browsing, setBrowsing] = useState<{ server: ServerView; path: string; files: FileEntry[]; loading: boolean } | null>(null);
  const connected = servers.filter((x) => x.status === 'connected').length;

  const add = async () => {
    const s = await actions.add();
    if (s) { setIsNew(true); setEditing(s); }
  };
  const close = async () => {
    // A new server that was never filled in is dropped.
    if (isNew && editing && !editing.name && !editing.ipAddress) await actions.remove(editing.id);
    setEditing(null); setIsNew(false);
  };
  const save = async () => {
    if (!editing) return;
    const s = editing;
    setEditing(null); setIsNew(false);
    await actions.save(s);
    if (s.ipAddress) await actions.connect(s.id);
  };
  const browse = async (server: ServerView, path = '/') => {
    setBrowsing({ server, path, files: browsing?.server.id === server.id ? browsing.files : [], loading: true });
    const files = await actions.listFiles(server.id, path).catch(() => []);
    setBrowsing({ server, path, files, loading: false });
  };
  const set = (field: keyof ServerView) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditing((x) => (x ? { ...x, [field]: e.target.value } : x));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-[680px] flex-col gap-1.5">
          <h2 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Physical servers</h2>
          <p className="m-0 text-sm text-fg-muted">On-premises machines Martian reaches over SSH or RDP. Cloud accounts live in <Link to="/integrations" className="font-medium text-accent-link">Integrations</Link>.</p>
        </div>
        <Button variant="primary" onClick={() => void add()}><IconPlus size={16} />Add server</Button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        <Card className="flex flex-col gap-1 px-5 py-4"><span className="text-13 text-fg-muted">Servers</span><span className="font-mono text-2xl font-medium">{servers.length}</span></Card>
        <Card className="flex flex-col gap-1 px-5 py-4"><span className="text-13 text-fg-muted">Connected</span><span className="font-mono text-2xl font-medium text-ok">{connected}</span></Card>
        <Card className="flex flex-col gap-1 px-5 py-4"><span className="text-13 text-fg-muted">Need setup</span><span className="font-mono text-2xl font-medium text-warn">{servers.length - connected}</span></Card>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-fg-muted">
              <th scope="col" className="border-b border-line px-5 py-3 font-medium">Server</th>
              <th scope="col" className="border-b border-line px-3 py-3 font-medium">Operating system</th>
              <th scope="col" className="border-b border-line px-3 py-3 font-medium">Address</th>
              <th scope="col" className="border-b border-line px-3 py-3 font-medium">Status</th>
              <th scope="col" className="border-b border-line px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {servers.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-fg-muted">No servers yet. Add one so agents can scan it.</td></tr>}
            {servers.map((x) => (
              <tr key={x.id}>
                <td className="border-b border-line-soft px-5 py-3.5">
                  <div className="flex flex-col gap-0.5"><span className="font-medium">{x.name || 'Untitled server'}</span><span className="text-13 text-fg-muted">{x.description || 'No description'}</span></div>
                </td>
                <td className="border-b border-line-soft px-3 py-3.5 text-fg-body">{x.os}</td>
                <td className="border-b border-line-soft px-3 py-3.5 font-mono text-13 text-fg-body">{x.ipAddress || 'Not set'}</td>
                <td className="whitespace-nowrap border-b border-line-soft px-3 py-3.5"><StatusBadge status={x.status} /></td>
                <td className="whitespace-nowrap border-b border-line-soft px-5 py-2.5 text-right">
                  <div className="inline-flex gap-1.5">
                    {x.status === 'connected'
                      ? <Button size="sm" onClick={() => void browse(x)}>Browse files</Button>
                      : <Button size="sm" disabled={x.status === 'connecting'} onClick={() => void actions.connect(x.id)}>{x.status === 'error' ? 'Retry' : 'Connect'}</Button>}
                    <button type="button" aria-label={`Edit ${x.name}`} onClick={() => { setIsNew(false); setEditing({ ...x }); }} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-fg-body hover:border-fg-faint"><IconPencil size={15} /></button>
                    <button type="button" aria-label={`Delete ${x.name}`} onClick={() => void actions.remove(x.id)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-danger hover:border-danger-soft"><IconTrash size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog
        open={!!editing}
        onClose={() => void close()}
        label={isNew ? 'Add server' : 'Edit server'}
        header={<h2 className="m-0 text-lg font-semibold">{isNew ? 'Add server' : 'Edit server'}</h2>}
        footer={<><Button onClick={() => void close()}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save and connect</Button></>}
      >
        {editing && (
          <div className="grid grid-cols-2 gap-4 p-6 max-sm:grid-cols-1">
            <Field id="s-name" label="Server name" className="col-span-full"><input id="s-name" value={editing.name} onChange={set('name')} placeholder="e.g. build-runner-01" className={fieldInput} /></Field>
            <Field id="s-os" label="Operating system">
              <select id="s-os" value={editing.os} onChange={set('os')} className={`${fieldInput} px-2.5`}>{[...new Set([editing.os, ...OS])].map((o) => <option key={o}>{o}</option>)}</select>
            </Field>
            <Field id="s-ip" label="IP address"><input id="s-ip" value={editing.ipAddress} onChange={set('ipAddress')} placeholder="10.0.0.12" className={`${fieldInput} font-mono`} /></Field>
            <Field id="s-desc" label="Description" className="col-span-full"><input id="s-desc" value={editing.description} onChange={set('description')} placeholder="What runs on it" className={fieldInput} /></Field>
            <Field id="s-user" label="Username"><input id="s-user" value={editing.username} onChange={set('username')} className={`${fieldInput} font-mono`} /></Field>
            <Field id="s-pass" label="Password or key"><input id="s-pass" type="password" autoComplete="off" value={editing.password} onChange={set('password')} placeholder="Stored encrypted" className={fieldInput} /></Field>
            <p className="col-span-full m-0 rounded-[10px] bg-canvas px-3.5 py-3 text-13 leading-normal text-fg-body">
              Credentials are encrypted with AES-256. Use SSH keys or certificates for production machines, and keep management ports off the public internet.
            </p>
          </div>
        )}
      </Dialog>

      <Drawer
        open={!!browsing}
        onClose={() => setBrowsing(null)}
        label="File browser"
        width={560}
        header={<div className="flex flex-col gap-0.5"><h2 className="m-0 text-17 font-semibold">{browsing?.server.name}</h2><span className="font-mono text-xs text-fg-muted">{browsing?.path}</span></div>}
      >
        <div className={cx('flex flex-col font-mono text-13 transition-opacity', browsing?.loading && 'opacity-50')}>
          {browsing && !browsing.loading && browsing.files.length === 0 && <p className="m-0 px-6 py-8 font-sans text-sm text-fg-muted">This folder is empty or can't be read.</p>}
          {browsing?.files.map((f) => f.type === 'directory' ? (
            <button key={f.path + f.name} type="button" onClick={() => void browse(browsing.server, f.path)} className="grid grid-cols-[22px_minmax(0,1fr)_60px_110px] items-center gap-2.5 border-0 border-b border-line-soft bg-surface px-6 py-[11px] text-left text-13 text-fg hover:bg-canvas">
              <IconFolder size={16} className="text-accent-link" /><span className="truncate">{f.name}</span><span className="text-fg-faint">{f.size}</span><span className="text-fg-faint">{f.modified}</span>
            </button>
          ) : (
            <div key={f.path} className="grid grid-cols-[22px_minmax(0,1fr)_60px_110px] items-center gap-2.5 border-b border-line-soft px-6 py-[11px] text-fg-2">
              <IconFile size={16} className="text-fg-faint" /><span className="truncate">{f.name}</span><span className="text-fg-faint">{f.size}</span><span className="text-fg-faint">{f.modified}</span>
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}

/* ---------- Organization ---------- */

function Organization() {
  const org = useApp((s) => s.user.org);
  const [saved, setSaved] = useState(false);
  return (
    <Card className="flex max-w-[720px] flex-col gap-[22px] p-7">
      <h2 className="m-0 text-xl font-semibold">Organization</h2>
      <Field id="org" label={<span className="text-sm">Organization name</span>}><input id="org" defaultValue={org} onChange={() => setSaved(false)} className={`${fieldInput} h-11 text-15`} /></Field>
      <Field id="policy" label={<span className="text-sm">Default approval policy</span>} hint="Each integration can override this on the Integrations page.">
        <select id="policy" onChange={() => setSaved(false)} className={`${fieldInput} h-11 text-15`}>
          <option>Ask before any write</option><option>Read-only for every agent</option><option>Auto-approve changes under $1,000/mo</option>
        </select>
      </Field>
      <Field id="window" label={<span className="text-sm">Maintenance window</span>} hint="Approved changes that need downtime wait for this window."><input id="window" defaultValue="Sundays 02:00–05:00 America/New_York" onChange={() => setSaved(false)} className={`${fieldInput} h-11 text-15`} /></Field>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => setSaved(true)}>Save</Button>
        {saved && <span className="inline-flex items-center gap-1.5 text-13 text-ok"><IconCheck size={15} />Saved</span>}
      </div>
    </Card>
  );
}

/* ---------- Security ---------- */

function Security() {
  const activity = useApp((s) => s.activity);
  const { prefs } = usePrefs();
  return (
    <div className="flex max-w-[960px] flex-col gap-4">
      <Card className="flex flex-col gap-3.5 px-7 py-6">
        <h2 className="m-0 text-xl font-semibold">Security</h2>
        <ul className="m-0 flex list-none flex-col gap-3 p-0 text-sm text-fg-2">
          <li className="flex gap-2.5"><IconCheck className="flex-none text-ok" />Credentials are encrypted at rest with AES-256.</li>
          <li className="flex gap-2.5"><IconCheck className="flex-none text-ok" />Agents confirm they have read-only access before every scan.</li>
          <li className="flex gap-2.5"><IconCheck className="flex-none text-ok" />Every write waits for approval unless an integration allows small changes on its own.</li>
          <li className="flex gap-2.5"><IconAlert className="flex-none text-warn" />Use SSH keys or certificates for production servers, not passwords.</li>
        </ul>
      </Card>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <span className="text-15 font-semibold">Audit log</span>
          <span className="text-xs text-fg-muted">Newest first · every agent action and approval</span>
        </div>
        <table className="w-full min-w-[640px] border-collapse font-mono text-13 text-fg-2">
          <tbody>
            {activity.length === 0 && <tr><td className="px-5 py-6 text-fg-muted">Nothing logged yet.</td></tr>}
            {activity.slice(0, 16).map((a, i) => (
              <tr key={a.id ?? i} className={cx(a.fresh && 'bg-accent-wash/40')}>
                <td className="whitespace-nowrap border-b border-line-soft px-5 py-3 text-fg-faint">{a.at ? fmtTime(a.at, prefs.clock) : a.when}</td>
                <td className="whitespace-nowrap border-b border-line-soft px-3 py-3">{a.agent}</td>
                <td className="border-b border-line-soft px-3 py-3 font-sans text-fg-body">{a.text}</td>
                <td className="whitespace-nowrap border-b border-line-soft px-5 py-3 text-right text-fg-faint">{a.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Appearance ---------- */

function Row({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,260px)_minmax(0,1fr)] items-start gap-x-8 gap-y-3 border-b border-line-soft py-5 last:border-b-0 max-md:grid-cols-1">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-fg">{title}</span>
        {help && <span className="text-13 leading-normal text-fg-muted">{help}</span>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Choice<K extends string>({ items, value, onChange, label }: { items: { key: K; label: React.ReactNode }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-[10px] border border-line bg-canvas p-1">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="radio"
          aria-checked={value === it.key}
          onClick={() => onChange(it.key)}
          className={cx('min-h-9 rounded-md border-0 px-3 text-13 transition-colors', value === it.key ? 'bg-surface font-medium text-fg shadow-tab' : 'bg-transparent text-fg-body hover:text-fg')}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

const ThemeCard = ({ k, active, onClick }: { k: Prefs['theme']; active: boolean; onClick: () => void }) => {
  const Icon = k === 'light' ? IconSun : k === 'dark' ? IconMoon : IconMonitor;
  const pane = (dark: boolean) => (
    <span className={cx('flex h-full flex-1 flex-col gap-1 p-1.5', dark ? 'bg-[#16171A]' : 'bg-[#F7F7F5]')}>
      <span className={cx('h-1.5 w-8 rounded-full', dark ? 'bg-[#3A3C42]' : 'bg-[#D9D9D5]')} />
      <span className={cx('h-1.5 w-12 rounded-full', dark ? 'bg-[#2A2C31]' : 'bg-[#E7E7E3]')} />
      <span className="mt-auto h-2 w-6 rounded-full bg-accent" />
    </span>
  );
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onClick} className={cx('flex w-[140px] flex-col gap-2 rounded-xl border bg-surface p-2 text-left transition-colors', active ? 'border-accent ring-2 ring-accent/25' : 'border-line hover:border-line-strong')}>
      <span className="flex h-[68px] overflow-hidden rounded-md border border-line">
        {k === 'system' ? <>{pane(false)}{pane(true)}</> : pane(k === 'dark')}
      </span>
      <span className="flex items-center gap-1.5 px-1 pb-0.5 text-13 font-medium text-fg"><Icon size={14} />{k === 'light' ? 'Light' : k === 'dark' ? 'Dark' : 'Match system'}</span>
    </button>
  );
};

function Appearance() {
  const { prefs, set, reset } = usePrefs();
  const setTheme = (t: Prefs['theme']) => runTransition('theme', () => set('theme', t));
  return (
    <div className="flex max-w-[960px] flex-col gap-6">
      <Card className="flex flex-col px-7 py-2">
        <h2 className="m-0 pb-1 pt-5 text-xl font-semibold">Interface</h2>
        <Row title="Theme" help="Match system follows your computer's light or dark setting.">
          <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-3">
            {(['light', 'dark', 'system'] as const).map((k) => <ThemeCard key={k} k={k} active={prefs.theme === k} onClick={() => setTheme(k)} />)}
          </div>
        </Row>
        <Row title="Accent color" help="Used for buttons and charts, and for the glow on running agents.">
          <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-2.5">
            {(Object.keys(ACCENTS) as Accent[]).map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={prefs.accent === a}
                aria-label={ACCENTS[a].label}
                title={ACCENTS[a].label}
                onClick={() => set('accent', a)}
                className={cx('flex h-9 w-9 items-center justify-center rounded-full border-2 transition-transform hover:scale-105', prefs.accent === a ? 'border-fg' : 'border-transparent')}
              >
                <span className="h-6 w-6 rounded-full" style={{ background: ACCENTS[a].swatch }} />
              </button>
            ))}
          </div>
        </Row>
        <Row title="Text size" help="Scales the whole console.">
          <Choice<FontSize>
            label="Text size"
            value={prefs.fontSize}
            onChange={(v) => set('fontSize', v)}
            items={[{ key: 'xs', label: 'Smallest' }, { key: 'sm', label: 'Small' }, { key: 'md', label: 'Default' }, { key: 'lg', label: 'Large' }, { key: 'xl', label: 'Largest' }]}
          />
        </Row>
        <Row title="Density" help="Compact fits more rows on screen.">
          <Choice<Prefs['density']> label="Density" value={prefs.density} onChange={(v) => set('density', v)} items={[{ key: 'comfortable', label: 'Comfortable' }, { key: 'compact', label: 'Compact' }]} />
        </Row>
        <Row title="Clock" help="Applies to every time shown, including the audit log.">
          <Choice<Prefs['clock']> label="Clock" value={prefs.clock} onChange={(v) => set('clock', v)} items={[{ key: '12h', label: fmtTime(new Date(2026, 9, 26, 14, 5), '12h') }, { key: '24h', label: fmtTime(new Date(2026, 9, 26, 14, 5), '24h') }]} />
        </Row>
      </Card>

      <Card className="flex flex-col px-7 py-2">
        <h2 className="m-0 pb-1 pt-5 text-xl font-semibold">Chat</h2>
        <Row title="Chat font" help="Used for messages in Quick Chat and beside agent runs.">
          <div role="radiogroup" aria-label="Chat font" className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {(Object.keys(CHAT_FONTS) as ChatFont[]).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={prefs.chatFont === f}
                onClick={() => set('chatFont', f)}
                className={cx('flex flex-col gap-1 rounded-[10px] border px-3 py-2.5 text-left transition-colors', prefs.chatFont === f ? 'border-accent bg-accent-wash' : 'border-line bg-surface hover:border-line-strong')}
              >
                <span className="text-xl text-fg" style={{ fontFamily: CHAT_FONTS[f].stack }}>Aa</span>
                <span className="text-xs text-fg-body">{CHAT_FONTS[f].label}</span>
              </button>
            ))}
          </div>
        </Row>
        <Row title="Chat text size">
          <Choice<ChatSize> label="Chat text size" value={prefs.chatSize} onChange={(v) => set('chatSize', v)} items={[{ key: 'sm', label: 'Small' }, { key: 'md', label: 'Default' }, { key: 'lg', label: 'Large' }]} />
        </Row>
        <Row title="Sending" help="The other combination adds a new line.">
          <Choice<'enter' | 'mod'>
            label="Send with"
            value={prefs.enterToSend ? 'enter' : 'mod'}
            onChange={(v) => set('enterToSend', v === 'enter')}
            items={[{ key: 'enter', label: <>Enter sends</> }, { key: 'mod', label: <>⌘/Ctrl + Enter sends</> }]}
          />
        </Row>
        <Row title="Follow-up suggestions" help="Short replies Martian offers under an answer.">
          <Toggle on={prefs.showSuggestions} onChange={() => set('showSuggestions', !prefs.showSuggestions)} label="Show follow-up suggestions" />
        </Row>
        <Row title="Tool calls in chat" help="Shows each tool an agent called above its answer.">
          <Toggle on={prefs.showToolCalls} onChange={() => set('showToolCalls', !prefs.showToolCalls)} label="Show tool calls in chat" />
        </Row>
        <Row title="Preview">
          <ChatPreview />
        </Row>
      </Card>

      <Card className="flex flex-col px-7 py-2">
        <h2 className="m-0 pb-1 pt-5 text-xl font-semibold">Accessibility</h2>
        <Row title="Reduce motion" help="Turns off page transitions, pulsing dots and animated graph edges.">
          <Toggle on={prefs.reduceMotion} onChange={() => set('reduceMotion', !prefs.reduceMotion)} label="Reduce motion" />
        </Row>
        <Row title="Increase contrast" help="Darker secondary text and stronger borders.">
          <Toggle on={prefs.highContrast} onChange={() => set('highContrast', !prefs.highContrast)} label="Increase contrast" />
        </Row>
      </Card>
      <div>
        <Button onClick={() => runTransition('theme', reset)}><IconRefresh size={15} />Reset appearance</Button>
      </div>
    </div>
  );
}

/* ---------- Demo data ---------- */

function DemoData() {
  const mode = useApp((s) => s.mode);
  const actions = useActions();
  const { navigate } = useRouter();
  const [seed, setSeed] = useState('');
  const regenerate = (variant?: number, s?: number) => {
    runTransition('orange', () => actions.demo?.regenerate(variant, s));
    navigate('/overview', { transition: 'none' });
  };
  const current = mode.variantIndex ?? 0;
  const share = useMemo(() => `${window.location.origin}${window.location.pathname}?seed=${mode.seed}&variant=${current + 1}`, [mode.seed, current]);
  if (!mode.demo || !actions.demo) {
    return <Card className="max-w-[720px] p-7 text-sm text-fg-body">Demo data is off. Set <code className="font-mono">MARTIAN_DEMO_MODE=true</code> in <code className="font-mono">.env</code> to use generated data.</Card>;
  }
  return (
    <div className="flex max-w-[960px] flex-col gap-6">
      <Card className="flex flex-col gap-4 px-7 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-xl font-semibold">Demo data</h2>
            <p className="m-0 max-w-[560px] text-sm leading-normal text-fg-muted">
              Every visit generates a new company from one of five templates and a random seed. The numbers keep moving while you watch, and agents keep finding things. Nothing here touches real infrastructure.
            </p>
          </div>
          <Button variant="primary" disabled={EMBED} onClick={() => regenerate(current)}><IconRefresh size={15} />New seed</Button>
        </div>
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          <div className="flex flex-col gap-0.5 rounded-[10px] bg-canvas px-4 py-3"><dt className="text-xs text-fg-muted">Company</dt><dd className="m-0 text-sm font-medium">{VARIANTS[current].org.name}</dd></div>
          <div className="flex flex-col gap-0.5 rounded-[10px] bg-canvas px-4 py-3"><dt className="text-xs text-fg-muted">Industry</dt><dd className="m-0 text-sm font-medium">{mode.industry}</dd></div>
          <div className="flex flex-col gap-0.5 rounded-[10px] bg-canvas px-4 py-3"><dt className="text-xs text-fg-muted">Seed</dt><dd className="m-0 font-mono text-sm">{mode.seed}</dd></div>
          <div className="flex flex-col gap-0.5 rounded-[10px] bg-canvas px-4 py-3"><dt className="text-xs text-fg-muted">Data source</dt><dd className="m-0 text-sm font-medium">{mode.embed ? 'Embedded demo' : mode.live ? 'Generated, with live chat' : 'Generated in your browser'}</dd></div>
        </dl>
        <p className="m-0 break-all text-xs text-fg-muted">Link to this exact world: <code className="font-mono text-fg-body">{share}</code></p>
        {EMBED && <p className="m-0 text-13 text-fg-muted">The embedded demo uses a fixed seed so it plays the same way every time.</p>}
      </Card>

      <Card className="flex flex-col gap-4 px-7 py-6">
        <h3 className="m-0 text-15 font-semibold">Choose a company</h3>
        <div role="radiogroup" aria-label="Demo company" className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-3">
          {VARIANTS.map((v, i) => (
            <button
              key={v.key}
              type="button"
              role="radio"
              aria-checked={i === current}
              disabled={EMBED}
              onClick={() => regenerate(i)}
              className={cx('flex flex-col gap-1 rounded-xl border px-4 py-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60', i === current ? 'border-accent bg-accent-wash' : 'border-line bg-surface hover:border-line-strong')}
            >
              <span className="text-sm font-semibold text-fg">{v.org.name}</span>
              <span className="text-13 text-fg-body">{v.org.industry} · {v.org.hq}</span>
              <span className="font-mono text-xs text-fg-muted">{v.integrations.length} integrations · {v.clusters.length} clusters</span>
            </button>
          ))}
        </div>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const n = Number(seed); if (Number.isFinite(n) && seed.trim()) regenerate(current, Math.abs(Math.floor(n))); }}>
          <Field id="seed" label="Use a specific seed" className="w-[220px]">
            <input id="seed" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^\d]/g, ''))} placeholder={String(mode.seed ?? '')} disabled={EMBED} className={`${fieldInput} font-mono`} />
          </Field>
          <Button type="submit" disabled={EMBED || !seed.trim()}>Apply</Button>
        </form>
      </Card>
    </div>
  );
}

/* ---------- page ---------- */

export const Settings = ({ tab: tabParam }: { tab?: string | null }) => {
  const demo = useApp((s) => s.mode.demo);
  const { navigate } = useRouter();
  const tabs: { key: Tab; label: string }[] = [
    { key: 'servers', label: 'Physical servers' }, { key: 'org', label: 'Organization' }, { key: 'security', label: 'Security' },
    { key: 'appearance', label: 'Appearance' }, ...(demo ? [{ key: 'demo' as Tab, label: 'Demo data' }] : []),
  ];
  const tab: Tab = tabs.some((t) => t.key === tabParam) ? (tabParam as Tab) : 'servers';
  return (
    <>
      <PageHeader title="Settings" />
      <Page>
        <LineTabs<Tab> items={tabs} value={tab} onChange={(t) => navigate(`/settings/${t}`, { replace: true, transition: 'none' })} label="Settings sections" />
        {tab === 'servers' && <Servers />}
        {tab === 'org' && <Organization />}
        {tab === 'security' && <Security />}
        {tab === 'appearance' && <Appearance />}
        {tab === 'demo' && <DemoData />}
      </Page>
    </>
  );
};
