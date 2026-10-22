/** View models shared by demo and live data sources. */

export type FindingState = 'open' | 'running' | 'done' | 'failed';

export type UiFinding = {
  id: string;
  title: string;
  description: string;
  scope: string;
  affects: string;
  impact: number;
  difficulty: 'easy' | 'medium';
  timeToImplement: string;
  steps: string[];
  state: FindingState;
  automatable: boolean;
};

export type UiActivity = { agent: string; text: string; when: string; where: string; fresh?: boolean };

export type TopologySystem = { name: string; a: string; b: string; util: number | null };
export type TopologyGroup = { key: string; name: string; where: string; cost: string; systems: TopologySystem[] };
export type Topology = { summary: { value: string; label: string; accent?: boolean }[]; groups: TopologyGroup[] };

export type Summary = {
  healthScore: number;
  totalResources: number;
  totalAccounts: number;
  monthlyCost: number;
  wasteIdentified: number;
  lastScanAt?: string | null;
};

export type Machine = {
  id: number | string;
  name: string;
  ipAddress: string;
  username: string;
  password: string;
  status: string;
  description: string;
  os: string;
};
