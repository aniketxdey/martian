import React, { useState } from 'react';
import type { Martian } from '../state/useMartian';
import { IconAlert, IconCheck, IconFile, IconFolder, IconPencil, IconPlus, IconTrash } from '../ui/icons';
import { Badge, Button, Card, Dialog, Drawer, Field, LineTabs, fieldInput } from '../ui/kit';
import { Page, PageHeading } from '../shell/AppShell';

type Tab = 'servers' | 'org' | 'sec';
const TABS: { key: Tab; label: string }[] = [
  { key: 'servers', label: 'Physical servers' }, { key: 'org', label: 'Organization' }, { key: 'sec', label: 'Security' },
];
const OS = ['Ubuntu 20.04 LTS', 'Ubuntu 22.04 LTS', 'CentOS 7', 'CentOS 8', 'Red Hat Enterprise Linux 8', 'Windows Server 2019', 'Windows Server 2022'];

const StatusBadge = ({ status }: { status: string }) => {
  if (status === 'connected') return <Badge tone="ok" dot>Connected</Badge>;
  if (status === 'connecting') return <Badge tone="accent">Connecting</Badge>;
  if (status === 'error') return <Badge tone="neutral" className="!bg-[#FDF2F2] !text-danger">Connection failed</Badge>;
  return <Badge tone="warn">Needs credentials</Badge>;
};

export const Settings = ({ m, onOpenIntegrations }: { m: Martian; onOpenIntegrations: () => void }) => {
  const [tab, setTab] = useState<Tab>('servers');
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');

  const machines: any[] = m.physicalMachines;
  const editing = m.selectedMachine ? machines.find((x) => x.id === (m.selectedMachine as any).id) : null;
  const connected = machines.filter((x) => x.status === 'connected').length;
  const files: any[] = m.showFileBrowser ? m.getCurrentFiles() : [];

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    editing && m.updatePhysicalMachine(editing.id, field, e.target.value);

  return (
    <Page>
      <LineTabs<Tab> items={TABS} value={tab} onChange={setTab} label="Settings sections" />

      {tab === 'servers' && (
        <div className="flex flex-col gap-5">
          <PageHeading
            title="Physical servers"
            size={24}
            sub="On-premises machines Martian can reach over SSH or RDP."
            actions={<Button variant="primary" onClick={() => { setDialogMode('add'); m.addPhysicalMachine(); }}><IconPlus size={16} />Add server</Button>}
          />

          <p className="m-0 flex flex-wrap items-center gap-1.5 rounded-[10px] border border-line bg-white px-4 py-3 text-sm text-fg-2">
            Cloud credentials for AWS, Azure and Google Cloud now live in
            <button type="button" onClick={onOpenIntegrations} className="border-0 bg-transparent p-0 text-sm font-medium text-accent-link">Integrations</button>.
          </p>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
            <Card className="flex flex-col gap-1 px-5 py-4"><span className="text-[13px] text-fg-muted">Total servers</span><span className="font-mono text-2xl font-medium">{machines.length}</span></Card>
            <Card className="flex flex-col gap-1 px-5 py-4"><span className="text-[13px] text-fg-muted">Connected</span><span className="font-mono text-2xl font-medium text-ok">{connected}</span></Card>
            <Card className="flex flex-col gap-1 px-5 py-4"><span className="text-[13px] text-fg-muted">Need setup</span><span className="font-mono text-2xl font-medium text-warn">{machines.length - connected}</span></Card>
          </div>

          <div className="overflow-x-auto rounded-xl border border-line bg-white">
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
                {machines.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-fg-muted">No servers yet. Add one to let agents scan it.</td></tr>
                )}
                {machines.map((x) => (
                  <tr key={x.id}>
                    <td className="border-b border-line-soft px-5 py-3.5">
                      <div className="flex flex-col gap-0.5"><span className="font-medium">{x.name}</span><span className="text-[13px] text-fg-muted">{x.description || 'No description'}</span></div>
                    </td>
                    <td className="border-b border-line-soft px-3 py-3.5 text-fg-body">{x.os}</td>
                    <td className="border-b border-line-soft px-3 py-3.5 font-mono text-[13px] text-fg-body">{x.ipAddress || '—'}</td>
                    <td className="whitespace-nowrap border-b border-line-soft px-3 py-3.5"><StatusBadge status={x.status} /></td>
                    <td className="whitespace-nowrap border-b border-line-soft px-5 py-2.5 text-right">
                      <div className="inline-flex gap-1.5">
                        {x.status === 'connected'
                          ? <Button size="sm" onClick={() => m.browseFiles(x)}>Browse files</Button>
                          : <Button size="sm" disabled={x.status === 'connecting'} onClick={() => m.connectToMachine(x)}>{x.status === 'error' ? 'Retry' : 'Connect'}</Button>}
                        <button type="button" aria-label={`Edit ${x.name}`} onClick={() => { setDialogMode('edit'); m.setSelectedMachine(x); m.setShowAddMachine(true); }} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-fg-body"><IconPencil size={15} /></button>
                        <button type="button" aria-label={`Delete ${x.name}`} onClick={() => m.deletePhysicalMachine(x.id)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-danger"><IconTrash size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'org' && (
        <Card className="flex max-w-[720px] flex-col gap-[22px] p-7">
          <h2 className="m-0 text-xl font-semibold">Organization</h2>
          <Field id="org" label={<span className="text-sm">Organization name</span>}><input id="org" defaultValue="Company, Inc." className={`${fieldInput} h-11 text-[15px]`} /></Field>
          <Field id="policy" label={<span className="text-sm">Default approval policy</span>} hint="Each integration can override this on the Integrations page.">
            <select id="policy" className={`${fieldInput} h-11 text-[15px]`}>
              <option>Ask before any write</option><option>Read-only for all agents</option><option>Auto-approve quick wins under $1,000/mo</option>
            </select>
          </Field>
          <Field id="window" label={<span className="text-sm">Maintenance window</span>}><input id="window" defaultValue="Sundays 02:00–05:00 America/New_York" className={`${fieldInput} h-11 text-[15px]`} /></Field>
        </Card>
      )}

      {tab === 'sec' && (
        <div className="flex max-w-[880px] flex-col gap-4">
          <Card className="flex flex-col gap-3.5 px-7 py-6">
            <h2 className="m-0 text-xl font-semibold">Security</h2>
            <ul className="m-0 flex list-none flex-col gap-3 p-0 text-sm text-fg-2">
              <li className="flex gap-2.5"><IconCheck color="#15803D" />Credentials are encrypted at rest with AES-256</li>
              <li className="flex gap-2.5"><IconCheck color="#15803D" />Agents verify read-only access before every scan</li>
              <li className="flex gap-2.5"><IconAlert color="#B45309" />Production servers should use SSH keys or certificates, not passwords</li>
            </ul>
          </Card>
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <div className="border-b border-line px-5 py-4 text-[15px] font-semibold">Audit log</div>
            <table className="w-full min-w-[600px] border-collapse font-mono text-[13px] text-fg-2">
              <tbody>
                {[
                  ['19:52', 'admin@company.com', 'approved optimization unused-ec2'],
                  ['19:47', 'martian-3', 'ce.get_cost_and_usage · aws · ok'],
                  ['19:33', 'admin@company.com', 'signed in'],
                ].map((r, i, all) => (
                  <tr key={i}>
                    <td className={`px-5 py-3 text-fg-faint ${i < all.length - 1 ? 'border-b border-line-soft' : ''}`}>{r[0]}</td>
                    <td className={`px-3 py-3 ${i < all.length - 1 ? 'border-b border-line-soft' : ''}`}>{r[1]}</td>
                    <td className={`px-3 py-3 ${i < all.length - 1 ? 'border-b border-line-soft' : ''}`}>{r[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / edit server — fields write through updatePhysicalMachine, as before */}
      <Dialog
        open={m.showAddMachine && !!editing}
        onClose={() => { m.setShowAddMachine(false); m.setSelectedMachine(null); }}
        label={dialogMode === 'add' ? 'Add server' : 'Edit server'}
        header={<h2 className="m-0 text-lg font-semibold">{dialogMode === 'add' ? 'Add server' : 'Edit server'}</h2>}
        footer={<>
          <Button onClick={() => { m.setShowAddMachine(false); m.setSelectedMachine(null); }}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              // Same as the original "Save & Connect": connect only when IP and password are set.
              if (editing?.ipAddress && editing?.password) m.connectToMachine(editing);
              m.setShowAddMachine(false);
              m.setSelectedMachine(null);
            }}
          >
            Save and connect
          </Button>
        </>}
      >
        {editing && (
          <div className="grid grid-cols-2 gap-4 p-6 max-sm:grid-cols-1">
            <Field id="s-name" label="Server name" className="col-span-full"><input id="s-name" value={editing.name} onChange={set('name')} placeholder="e.g., Production Server 01" className={fieldInput} /></Field>
            <Field id="s-os" label="Operating system">
              <select id="s-os" value={editing.os} onChange={set('os')} className={`${fieldInput} px-2.5`}>{OS.map((o) => <option key={o}>{o}</option>)}</select>
            </Field>
            <Field id="s-ip" label="IP address"><input id="s-ip" value={editing.ipAddress} onChange={set('ipAddress')} placeholder="192.168.1.100" className={`${fieldInput} font-mono`} /></Field>
            <Field id="s-desc" label="Description" className="col-span-full"><input id="s-desc" value={editing.description} onChange={set('description')} placeholder="Brief description of this server" className={fieldInput} /></Field>
            <Field id="s-user" label="Username"><input id="s-user" value={editing.username} onChange={set('username')} className={`${fieldInput} font-mono`} /></Field>
            <Field id="s-pass" label="Password or key"><input id="s-pass" type="password" value={editing.password} onChange={set('password')} placeholder="Enter SSH/RDP password" className={fieldInput} /></Field>
            <p className="col-span-full m-0 rounded-[10px] bg-canvas px-3.5 py-3 text-[13px] leading-normal text-fg-body">
              Credentials are encrypted with AES-256. Prefer SSH keys or certificates for production, and restrict access to management ports.
            </p>
          </div>
        )}
      </Dialog>

      {/* File browser */}
      <Drawer
        open={m.showFileBrowser}
        onClose={() => m.setShowFileBrowser(false)}
        label="File browser"
        width={560}
        header={<div className="flex flex-col gap-0.5"><h2 className="m-0 text-[17px] font-semibold">{(m.selectedMachine as any)?.name}</h2><span className="font-mono text-xs text-fg-muted">{m.currentPath}</span></div>}
      >
        <div className="flex flex-col font-mono text-[13px]">
          {files.length === 0 && <p className="m-0 px-6 py-8 font-sans text-sm text-fg-muted">This folder is empty or not available.</p>}
          {files.map((f) => f.type === 'directory' ? (
            <button key={f.path + f.name} type="button" onClick={() => m.navigateToPath(f.path)} className="grid grid-cols-[22px_minmax(0,1fr)_60px_130px] items-center gap-2.5 border-0 border-b border-line-soft bg-white px-6 py-[11px] text-left text-[13px] text-fg">
              <IconFolder size={16} color="#B4361A" /><span>{f.name}</span><span className="text-fg-faint">{f.size}</span><span className="text-fg-faint">{f.modified}</span>
            </button>
          ) : (
            <div key={f.path} className="grid grid-cols-[22px_minmax(0,1fr)_60px_130px] items-center gap-2.5 border-b border-line-soft px-6 py-[11px] text-fg-2">
              <IconFile size={16} color="#6B6F76" /><span>{f.name}</span><span className="text-fg-faint">{f.size}</span><span className="text-fg-faint">{f.modified}</span>
            </div>
          ))}
        </div>
      </Drawer>
    </Page>
  );
};
