/** Demo data source: the original app logic (useMartian, unchanged) plus derived view models. */
import { useMemo, useState } from 'react';
import { AGENT_ACTIVITY, FINDING_DETAILS, INFRA_GROUPS, INFRA_SUMMARY } from '../data/presentation';
import { useMartian } from './useMartian';
import type { Summary, Topology, UiFinding } from './types';

type Optimization = { id: string; title: string; description: string; impact: number; difficulty: string; timeToImplement: string };

export const useMockData = () => {
  const m = useMartian();
  // Approved findings stay visible as "Applied" after optimizeResource() removes them.
  const [applied, setApplied] = useState<Record<string, Optimization>>({});
  const optimizations: Optimization[] = m.discoveryData?.optimizations ?? [];

  const findings: UiFinding[] = useMemo(() => {
    const toUi = (o: Optimization, state: UiFinding['state']): UiFinding => ({
      id: o.id, title: o.title, description: o.description, impact: o.impact, timeToImplement: o.timeToImplement,
      difficulty: o.difficulty === 'easy' ? 'easy' : 'medium', state, automatable: true,
      scope: FINDING_DETAILS[o.id]?.scope ?? '', affects: FINDING_DETAILS[o.id]?.count ?? '', steps: FINDING_DETAILS[o.id]?.steps ?? [],
    });
    const live = optimizations.map((o) => toUi(o, (m.optimizationProgress as Record<string, boolean>)[o.id] ? 'running' : 'open'));
    const done = Object.values(applied).filter((o) => !optimizations.some((x) => x.id === o.id)).map((o) => toUi(o, 'done'));
    return [...live, ...done].sort((a, b) => b.impact - a.impact);
  }, [optimizations, applied, m.optimizationProgress]);

  const summary: Summary | null = m.discoveryData?.summary ?? null;
  const topology: Topology = useMemo(() => ({ summary: INFRA_SUMMARY, groups: INFRA_GROUPS }), []);

  return {
    ...m,
    live: false as const,
    summary,
    findings,
    activity: AGENT_ACTIVITY,
    topology,
    approveFinding: async (id: string) => {
      const o = optimizations.find((x) => x.id === id);
      if (o) setApplied((prev) => ({ ...prev, [id]: o }));
      await m.optimizeResource(id);
    },
    runScan: () => new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    saveMachine: async (_machine: any) => undefined,
  };
};

export type AppData = ReturnType<typeof useMockData>;
