import React, { useState } from 'react';
import { Link, useRouter } from '../app/router';
import { useActions, useApp } from '../app/store';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { IntegrationLogo, usd } from '../components/bits';
import { AskButton, Page, PageHeader, WastePill } from '../shell/AppShell';
import type { UiFinding } from '../state/types';
import { IconArrowRight, IconCheck, IconRefresh } from '../ui/icons';
import { Badge, Button, Card, cx, Drawer } from '../ui/kit';

const shortTime = (t: string) => t.replace('minutes', 'min').replace('minute', 'min');
const healthLabel = (s: number) => (s >= 80 ? 'Good' : s >= 60 ? 'Fair' : 'Needs work');
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
const sinceScan = (now: number, at: number | null) => {
  if (!at) return 'No scan yet';
  const m = Math.floor((now - at) / 60000);
  return m < 1 ? 'Last scan just now' : m < 120 ? `Last scan ${m} min ago` : `Last scan ${Math.floor(m / 60)} h ago`;
};

function Stats() {
  const s = useApp((st) => st.summary);
  if (!s) return null;
  const pct = s.monthlyCost ? Math.round((s.wasteIdentified / s.monthlyCost) * 100) : 0;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
      <Card className="flex flex-col gap-2.5 px-[22px] py-5">
        <span className="text-13 text-fg-muted">Health</span>
        <span className="flex items-baseline gap-1">
          <span className="font-mono text-30 font-medium tracking-[-0.02em]"><AnimatedNumber value={s.healthScore} format={(n) => String(Math.round(n))} /></span>
          <span className="text-sm text-fg-muted">/ 100 · {healthLabel(s.healthScore)}</span>
        </span>
        <span className="h-1.5 overflow-hidden rounded-full bg-line-soft" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.healthScore} aria-label="Health">
          <span className={cx('block h-full rounded-full transition-[width] duration-700', s.healthScore >= 80 ? 'bg-ok' : 'bg-warn')} style={{ width: `${s.healthScore}%` }} />
        </span>
      </Card>
      <Card className="flex flex-col gap-2.5 px-[22px] py-5">
        <span className="text-13 text-fg-muted">Monthly spend</span>
        <span className="font-mono text-30 font-medium tracking-[-0.02em]"><AnimatedNumber value={s.monthlyCost} format={usd} /></span>
        <span className="text-13 text-fg-muted">{s.totalAccounts} cloud accounts · <AnimatedNumber value={s.totalResources} format={(n) => Math.round(n).toLocaleString('en-US')} /> resources</span>
      </Card>
      <Card className="flex flex-col gap-2.5 px-[22px] py-5">
        <span className="text-13 text-fg-muted">Open waste</span>
        <span className="font-mono text-30 font-medium tracking-[-0.02em] text-accent"><AnimatedNumber value={s.wasteIdentified} format={usd} /></span>
        <span className="text-13 text-fg-muted">{pct}% of what you spend each month</span>
      </Card>
      <Card className="flex flex-col gap-2.5 px-[22px] py-5">
        <span className="text-13 text-fg-muted">Saved so far</span>
        <span className="font-mono text-30 font-medium tracking-[-0.02em] text-ok"><AnimatedNumber value={s.realizedSavings ?? 0} format={usd} /></span>
        <span className="text-13 text-fg-muted">per month, from changes you approved</span>
      </Card>
    </div>
  );
}

function FindingRow({ f, onReview }: { f: UiFinding; onReview: (id: string) => void }) {
  return (
    <tr className={cx('transition-colors', f.isNew && 'animate-fade-up bg-accent-wash/40')}>
      <td className="border-b border-line-soft px-[22px] py-4">
        <div className="flex items-start gap-3">
          {f.integration && <IntegrationLogo id={f.integration} size={30} className="mt-0.5" />}
          <div className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2 font-medium">{f.title}{f.isNew && <Badge tone="accent">New</Badge>}</span>
            <span className="text-13 text-fg-muted">{f.description}</span>
            <span className="font-mono text-xs text-fg-faint">{f.scope}</span>
          </div>
        </div>
      </td>
      <td className="whitespace-nowrap border-b border-line-soft px-3 py-4">
        {f.difficulty === 'easy' ? <Badge tone="ok">Quick win</Badge> : <Badge tone="warn">Needs review</Badge>}
      </td>
      <td className="whitespace-nowrap border-b border-line-soft px-3 py-4 font-mono text-13 text-fg-body">{shortTime(f.timeToImplement)}</td>
      <td className="whitespace-nowrap border-b border-line-soft px-3 py-4 text-right font-mono font-medium tabular-nums">{f.impact > 0 ? usd(f.state === 'done' ? f.realized ?? f.impact : f.impact) : <span className="font-sans text-xs font-normal text-fg-faint">No saving</span>}</td>
      <td className="whitespace-nowrap border-b border-line-soft px-[22px] py-4 text-right">
        {f.state === 'open' && <Button size="sm" onClick={() => onReview(f.id)}>Review</Button>}
        {f.state === 'running' && (
          <Link to={f.sessionId ? `/agents/${f.sessionId}` : '/agents'} className="inline-flex min-w-[120px] flex-col items-end gap-1.5 text-13 text-accent-ink no-underline">
            <span className="inline-flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />Applying</span>
            <span className="h-1 w-full overflow-hidden rounded-full bg-line-soft"><span className="block h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.round((f.progress ?? 0.05) * 100)}%` }} /></span>
          </Link>
        )}
        {f.state === 'done' && (
          <Link to={f.sessionId ? `/agents/${f.sessionId}` : '/agents'} className="inline-flex items-center gap-1.5 text-13 text-ok no-underline"><IconCheck size={16} />Applied</Link>
        )}
        {f.state === 'failed' && <span className="text-13 text-danger">Failed, rolled back</span>}
      </td>
    </tr>
  );
}

function Findings() {
  const findings = useApp((s) => s.findings);
  const [selected, setSelected] = useState<string | null>(null);
  const { approveFinding, dismissFinding } = useActions();
  const open = findings.filter((r) => r.state === 'open');
  const openSavings = open.reduce((n, r) => n + r.impact, 0);
  const sel = findings.find((o) => o.id === selected && o.state === 'open') ?? null;

  return (
    <section className="min-w-0 flex-[2_1_640px] overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-[22px] py-[18px]">
        <h3 className="m-0 text-base font-semibold">Findings</h3>
        <span className="text-13 text-fg-muted">{open.length} open · <span className="font-mono text-fg tabular-nums">{usd(openSavings)}/mo</span> you could save</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-fg-muted">
              <th scope="col" className="border-b border-line px-[22px] py-2.5 font-medium">Finding</th>
              <th scope="col" className="border-b border-line px-3 py-2.5 font-medium">Effort</th>
              <th scope="col" className="border-b border-line px-3 py-2.5 font-medium">Time</th>
              <th scope="col" className="whitespace-nowrap border-b border-line px-3 py-2.5 text-right font-medium">Per month</th>
              <th scope="col" className="border-b border-line px-[22px] py-2.5 text-right font-medium"><span className="sr-only-clip">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {findings.length === 0 && (
              <tr><td colSpan={5} className="ambient-glow px-[22px] py-10 text-center text-sm text-fg-muted">Nothing yet. Connect an integration and run a scan; findings show up here as agents find them.</td></tr>
            )}
            {findings.map((f) => <FindingRow key={f.id} f={f} onReview={setSelected} />)}
          </tbody>
        </table>
      </div>

      <Drawer
        open={!!sel}
        onClose={() => setSelected(null)}
        label="Review finding"
        header={<span className="flex items-center gap-2 font-mono text-xs text-fg-muted">{sel?.integration && <IntegrationLogo id={sel.integration} size={22} />}{sel?.scope}</span>}
        footer={<>
          <Button variant="ghost" onClick={() => { if (sel) void dismissFinding(sel.id); setSelected(null); }}>Dismiss</Button>
          <Button onClick={() => setSelected(null)}>Cancel</Button>
          <Button variant="primary" disabled={!sel?.automatable} onClick={() => { if (sel) void approveFinding(sel.id); setSelected(null); }}>{sel && !sel.automatable ? 'Needs a person' : 'Approve and run'}</Button>
        </>}
      >
        {sel && (
          <div className="flex flex-col gap-[22px] p-6">
            <div className="flex flex-col gap-2">
              <h2 className="m-0 text-22 font-semibold tracking-[-0.02em]">{sel.title}</h2>
              <p className="m-0 text-15 leading-[1.55] text-fg-body">{sel.description}</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { l: 'Per month', v: sel.impact > 0 ? usd(sel.impact) : 'No saving', c: 'text-accent' },
                { l: 'Time to apply', v: shortTime(sel.timeToImplement) },
                { l: 'Affects', v: sel.affects || 'Not listed' },
              ].map((x) => (
                <div key={x.l} className="flex flex-col gap-1 rounded-[10px] bg-canvas px-3.5 py-3">
                  <span className="text-xs text-fg-muted">{x.l}</span>
                  <span className={cx('font-mono font-medium', x.c)}>{x.v}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="m-0 text-sm font-semibold">What the agents will do</h3>
              <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
                {sel.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-normal text-fg-2">
                    <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-md bg-accent-wash font-mono text-xs text-accent-ink">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
            <p className="m-0 rounded-[10px] bg-canvas px-3.5 py-3 text-13 leading-[1.55] text-fg-muted">
              {sel.automatable
                ? 'Each step goes in the audit log with your name and the arguments needed to undo it. If a step fails, the ones before it roll back.'
                : "This one needs a person to make the change. Martian keeps it here and checks on the next scan whether the money stopped going out."}
            </p>
          </div>
        )}
      </Drawer>
    </section>
  );
}

function Activity() {
  const activity = useApp((s) => s.activity.slice(0, 9));
  const running = useApp((s) => s.sessions.filter((x) => x.status === 'running').length);
  return (
    <section className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-xl border border-line bg-surface px-[22px] py-[18px]">
      <div className="flex items-center justify-between">
        <Link to="/agents" className="ix-underline group flex items-center gap-1.5 text-base font-semibold text-fg no-underline">
          Agent activity <IconArrowRight size={15} className="ix-arrow text-fg-faint group-hover:text-accent" />
        </Link>
        <span className="flex items-center gap-1.5 text-xs text-ok">
          <span className={cx('h-[7px] w-[7px] rounded-full bg-ok-dot', running > 0 && 'animate-pulse')} />
          {running > 0 ? `${running} running` : 'Watching'}
        </span>
      </div>
      <ol className="m-0 flex list-none flex-col p-0">
        {activity.length === 0 && <li className="border-t border-line-soft py-3 text-sm text-fg-muted">Agents report here once the first scan runs.</li>}
        {activity.map((a, i) => {
          const body = (
            <>
              <span className={cx('mt-1.5 h-2 w-2 flex-none rounded-full transition-colors', a.fresh ? 'bg-accent' : 'bg-idle')} />
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="text-sm leading-[1.45] text-fg-2"><b className="font-semibold text-fg">{a.agent}</b> {a.text}</span>
                <span className="font-mono text-xs text-fg-faint">{a.when} · {a.where}</span>
              </div>
              {a.integration && <IntegrationLogo id={a.integration} size={22} className="mt-0.5" />}
            </>
          );
          return (
            <li key={a.id ?? i} className={cx('border-t border-line-soft', a.fresh && 'animate-fade-up')}>
              {a.sessionId
                ? <Link to={`/agents/${a.sessionId}`} className="-mx-2 flex gap-3 rounded-lg px-2 py-3 text-inherit no-underline hover:bg-canvas">{body}</Link>
                : <div className="flex gap-3 py-3">{body}</div>}
            </li>
          );
        })}
      </ol>
      <Link to="/agents" className="ix-underline ix-link mt-auto text-13 font-medium text-accent-link no-underline hover:underline">See every agent run</Link>
    </section>
  );
}

export const Overview = () => {
  const user = useApp((s) => s.user.name.split(' ')[0]);
  const scan = useApp((s) => s.scan);
  const now = useApp((s) => Math.floor(s.now / 30000) * 30000);
  const { runScan } = useActions();
  const { navigate } = useRouter();

  return (
    <>
      <PageHeader title="Overview" actions={<><AskButton /><WastePill /></>} />
      <Page>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 className="m-0 text-28 font-semibold tracking-[-0.025em]">{greeting()}, {user}</h2>
            <p className="m-0 text-sm text-fg-muted">{scan.running ? 'Scanning now. Agents are reading every connected integration.' : sinceScan(now, scan.lastScanAt)}</p>
          </div>
          <div className="flex gap-2.5">
            <Button onClick={() => (scan.running && scan.sessionId ? navigate(`/agents/${scan.sessionId}`) : void runScan())}>
              <IconRefresh size={16} className={cx(scan.running && 'animate-spin')} />{scan.running ? 'Watch the scan' : 'Run a scan'}
            </Button>
            <Button variant="primary" onClick={() => navigate('/chat')}>Ask Martian</Button>
          </div>
        </div>
        <Stats />
        <div className="flex flex-wrap items-start gap-6">
          <Findings />
          <Activity />
        </div>
      </Page>
    </>
  );
};
