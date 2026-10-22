import React, { useEffect, useState } from 'react';
import type { AppData } from '../state/useMockData';
import type { UiFinding } from '../state/types';
import { IconCheck, IconRefresh } from '../ui/icons';
import { Badge, Button, Card, Drawer, Stat } from '../ui/kit';
import { Page } from '../shell/AppShell';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const shortTime = (t: string) => t.replace('minutes', 'min').replace('minute', 'min');
const healthLabel = (s: number) => (s >= 80 ? 'Good' : s >= 50 ? 'Fair' : 'Poor');
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export const Overview = ({ m, onAsk }: { m: AppData; onAsk: () => void }) => {
  const summary = m.summary;
  const rows: UiFinding[] = m.findings;

  const [selected, setSelected] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState(() => Date.now());
  const [scanning, setScanning] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { if (summary?.lastScanAt) setScannedAt(new Date(summary.lastScanAt).getTime()); }, [summary?.lastScanAt]);

  const open = rows.filter((r) => r.state === 'open');
  const openSavings = open.reduce((n, r) => n + r.impact, 0);
  const sel = rows.find((o) => o.id === selected && o.state === 'open') || null;
  const mins = Math.floor((now - scannedAt) / 60000);
  const lastScan = summary && m.live && !summary.lastScanAt ? 'never' : mins < 1 ? 'just now' : mins < 120 ? `${mins} minute${mins === 1 ? '' : 's'} ago` : `${Math.floor(mins / 60)} hours ago`;

  const approve = (o: UiFinding) => {
    setSelected(null);
    void m.approveFinding(o.id);
  };

  const runScan = async () => {
    setScanning(true);
    await m.runScan();
    setScanning(false);
    setScannedAt(Date.now());
    setNow(Date.now());
  };

  if (!summary) return null;

  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="m-0 text-[28px] font-semibold tracking-[-0.025em]">{greeting()}, Admin</h2>
          <p className="m-0 text-sm text-fg-muted">
            Last scan {scanning ? 'running now' : lastScan} · {summary.totalAccounts} accounts · {summary.totalResources.toLocaleString('en-US')} resources
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button onClick={() => void runScan()} disabled={scanning}><IconRefresh size={16} />{scanning ? 'Scanning…' : 'Run scan'}</Button>
          <Button variant="primary" onClick={onAsk}>Ask Martian</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Card className="flex flex-col gap-2.5 px-[22px] py-5">
          <span className="text-[13px] text-fg-muted">Infrastructure health</span>
          <span className="flex items-baseline gap-1">
            <span className="font-mono text-[30px] font-medium tracking-[-0.02em]">{summary.healthScore}</span>
            <span className="text-sm text-fg-muted">/ 100 · {healthLabel(summary.healthScore)}</span>
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-line-soft" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.healthScore} aria-label="Infrastructure health">
            <span className="block h-full rounded-full bg-warn" style={{ width: `${summary.healthScore}%` }} />
          </span>
        </Card>
        <Stat label="Monthly cost" value={money(summary.monthlyCost)} sub={`Across ${summary.totalAccounts} cloud accounts`} />
        <Stat label="Waste identified" value={money(summary.wasteIdentified)} valueClass="text-accent" sub={`${summary.monthlyCost ? Math.round((summary.wasteIdentified / summary.monthlyCost) * 100) : 0}% of monthly spend`} />
        <Stat label="Resources" value={summary.totalResources.toLocaleString('en-US')} sub="Cloud and on-premises" />
      </div>

      <div className="flex flex-wrap items-start gap-6">
        {/* Findings */}
        <section className="min-w-0 flex-[2_1_640px] overflow-hidden rounded-xl border border-line bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-[22px] py-[18px]">
            <h3 className="m-0 text-base font-semibold">Findings</h3>
            <span className="text-[13px] text-fg-muted">
              {open.length} open · <span className="font-mono text-fg">{money(openSavings)}/mo</span> potential savings
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-fg-muted">
                  <th scope="col" className="border-b border-line px-[22px] py-2.5 font-medium">Finding</th>
                  <th scope="col" className="border-b border-line px-3 py-2.5 font-medium">Effort</th>
                  <th scope="col" className="border-b border-line px-3 py-2.5 font-medium">Time</th>
                  <th scope="col" className="whitespace-nowrap border-b border-line px-3 py-2.5 text-right font-medium">Savings / mo</th>
                  <th scope="col" className="border-b border-line px-[22px] py-2.5 text-right font-medium"><span className="sr-only-clip">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="px-[22px] py-8 text-center text-sm text-fg-muted">{m.live ? 'No findings yet. Connect an integration and run a scan.' : 'No findings.'}</td></tr>
                )}
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td className="border-b border-line-soft px-[22px] py-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{f.title}</span>
                        <span className="text-[13px] text-fg-muted">{f.description}</span>
                        <span className="font-mono text-xs text-fg-faint">{f.scope}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap border-b border-line-soft px-3 py-4">
                      {f.difficulty === 'easy' ? <Badge tone="ok">Quick win</Badge> : <Badge tone="warn">Review needed</Badge>}
                    </td>
                    <td className="whitespace-nowrap border-b border-line-soft px-3 py-4 font-mono text-[13px] text-fg-body">{shortTime(f.timeToImplement)}</td>
                    <td className="whitespace-nowrap border-b border-line-soft px-3 py-4 text-right font-mono font-medium">{money(f.impact)}</td>
                    <td className="whitespace-nowrap border-b border-line-soft px-[22px] py-4 text-right">
                      {f.state === 'open' && <Button size="sm" onClick={() => setSelected(f.id)}>Review</Button>}
                      {f.state === 'running' && (
                        <span className="inline-flex items-center gap-2 text-[13px] text-accent-ink"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />Running</span>
                      )}
                      {f.state === 'done' && <span className="inline-flex items-center gap-1.5 text-[13px] text-ok"><IconCheck size={16} />Applied</span>}
                      {f.state === 'failed' && <span className="text-[13px] text-danger">Failed · rolled back</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Activity */}
        <section className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 rounded-xl border border-line bg-white px-[22px] py-[18px]">
          <div className="flex items-center justify-between">
            <h3 className="m-0 text-base font-semibold">Agent activity</h3>
            <span className="flex items-center gap-1.5 text-xs text-ok"><span className="h-[7px] w-[7px] rounded-full bg-ok-dot" />Live</span>
          </div>
          <ol className="m-0 flex list-none flex-col p-0">
            {m.activity.length === 0 && <li className="border-t border-line-soft py-3 text-sm text-fg-muted">Agents will report here once the first scan runs.</li>}
            {m.activity.map((a, i) => (
              <li key={i} className="flex gap-3 border-t border-line-soft py-3">
                <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${a.fresh ? 'bg-accent' : 'bg-[#C9CBD0]'}`} />
                <div className="flex flex-1 flex-col gap-[3px]">
                  <span className="text-sm leading-[1.45]"><b className="font-semibold">{a.agent}</b> {a.text}</span>
                  <span className="font-mono text-xs text-fg-faint">{a.when} · {a.where}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* Review drawer */}
      <Drawer
        open={!!sel}
        onClose={() => setSelected(null)}
        label="Review finding"
        header={<span className="font-mono text-xs text-fg-muted">{sel?.scope}</span>}
        footer={<>
          <Button onClick={() => setSelected(null)}>Cancel</Button>
          <Button variant="primary" disabled={!sel?.automatable} onClick={() => sel && approve(sel)}>{sel && !sel.automatable ? 'Manual change only' : 'Approve and run'}</Button>
        </>}
      >
        {sel && (
          <div className="flex flex-col gap-[22px] p-6">
            <div className="flex flex-col gap-2">
              <h2 className="m-0 text-[22px] font-semibold tracking-[-0.02em]">{sel.title}</h2>
              <p className="m-0 text-[15px] leading-[1.55] text-fg-body">{sel.description}</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { l: 'Savings / mo', v: money(sel.impact), c: 'text-accent' },
                { l: 'Time to apply', v: shortTime(sel.timeToImplement) },
                { l: 'Affects', v: sel.affects || '—' },
              ].map((x) => (
                <div key={x.l} className="flex flex-col gap-1 rounded-[10px] bg-canvas px-3.5 py-3">
                  <span className="text-xs text-fg-muted">{x.l}</span>
                  <span className={`font-mono font-medium ${x.c ?? ''}`}>{x.v}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="m-0 text-sm font-semibold">What Martian will do</h3>
              <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
                {sel.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-normal text-fg-2">
                    <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-md bg-accent-wash font-mono text-xs text-accent-ink">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
            <p className="m-0 rounded-[10px] bg-canvas px-3.5 py-3 text-[13px] leading-[1.55] text-fg-muted">
              {sel.automatable ? 'Every step is logged to the audit trail with your name and records how to undo it. If a step fails, the steps before it roll back.' : 'This change needs a person to carry it out. Martian tracks it here and confirms the savings on the next scan.'}
            </p>
          </div>
        )}
      </Drawer>
    </Page>
  );
};
