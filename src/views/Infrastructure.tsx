import React, { useState } from 'react';
import type { EnvKey } from '../data/presentation';
import type { Topology } from '../state/types';
import { IconChat } from '../ui/icons';
import { SegTabs, cx } from '../ui/kit';
import { Page, PageHeading } from '../shell/AppShell';

type Tab = 'all' | EnvKey;
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'cloud', label: 'Cloud' }, { key: 'dc', label: 'Data center' }, { key: 'labs', label: 'Dev labs' }, { key: 'edge', label: 'Edge' },
];

export const Infrastructure = ({ topology, onAskAbout }: { topology: Topology; onAskAbout: (system: string) => void }) => {
  const [tab, setTab] = useState<Tab>('all');
  const INFRA_SUMMARY = topology.summary;
  const groups = topology.groups.filter((g) => tab === 'all' || g.key === tab);

  return (
    <Page>
      <PageHeading
        title="Topology"
        sub="Physical machines, virtual environments, cloud resources and lab systems in one map."
        actions={<SegTabs<Tab> items={TABS} value={tab} onChange={setTab} label="Environment" />}
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] rounded-xl border border-line bg-white">
        {INFRA_SUMMARY.map((s, i) => (
          <div key={s.label} className={cx('flex flex-col gap-1 px-[22px] py-[18px]', i < INFRA_SUMMARY.length - 1 && 'border-r border-line-soft')}>
            <span className={cx('font-mono text-2xl font-medium', s.accent && 'text-accent')}>{s.value}</span>
            <span className="text-[13px] text-fg-muted">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(440px,100%),1fr))] gap-5">
        {groups.length === 0 && <p className="m-0 text-sm text-fg-muted">Nothing here yet. Resources appear after the first scan.</p>}
        {groups.map((g) => (
          <section key={g.key} className="overflow-hidden rounded-xl border border-line bg-white">
            <div className="flex items-start justify-between gap-3 border-b border-line px-[22px] py-[18px]">
              <div className="flex flex-col gap-1">
                <h3 className="m-0 text-base font-semibold">{g.name}</h3>
                <span className="font-mono text-xs text-fg-faint">{g.where}</span>
              </div>
              <span className="font-mono text-[15px] font-medium">{g.cost}<span className="text-xs text-fg-faint">/mo</span></span>
            </div>
            <div className="flex flex-col">
              {g.systems.map((s) => (
                <div key={s.name} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_132px_44px] items-center gap-4 border-b border-line-soft px-[22px] py-3.5 max-sm:grid-cols-[minmax(0,1fr)_44px]">
                  <span className="text-sm font-medium">{s.name}</span>
                  <div className="flex flex-col gap-[3px] font-mono text-xs text-fg-body max-sm:hidden"><span>{s.a}</span><span>{s.b}</span></div>
                  <div className="flex items-center gap-2.5 max-sm:hidden">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft">
                      <span className={cx('block h-full rounded-full', (s.util ?? 0) > 80 ? 'bg-warn' : 'bg-fg-body')} style={{ width: `${s.util ?? 0}%` }} />
                    </span>
                    <span className="w-[34px] text-right font-mono text-xs text-fg-body">{s.util == null ? '—' : `${s.util}%`}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Ask Martian about ${s.name}`}
                    onClick={() => onAskAbout(s.name)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-fg-body"
                  >
                    <IconChat size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="m-0 flex items-center gap-2 text-[13px] text-fg-muted">
        <span className="h-1.5 w-[18px] rounded-full bg-warn" />Utilization above 80% · candidates for rebalancing, not removal
      </p>
    </Page>
  );
};
