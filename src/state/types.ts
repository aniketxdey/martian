/** View models shared by the demo engine and the live API adapters. */

export type FindingState = 'open' | 'running' | 'done' | 'failed' | 'dismissed';

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
  /** Catalog id of the integration the finding lives on. */
  integration?: string;
  /** Infrastructure graph node the finding is about. */
  nodeId?: string;
  createdAt?: number;
  /** 0..1 while running. */
  progress?: number;
  realized?: number;
  sessionId?: string;
  isNew?: boolean;
};

export type UiActivity = {
  id?: string;
  agent: string;
  text: string;
  when: string;
  where: string;
  fresh?: boolean;
  at?: number;
  integration?: string;
  sessionId?: string;
};

export type TopologySystem = { name: string; a: string; b: string; util: number | null; nodeId?: string };
export type TopologyGroup = { key: string; name: string; where: string; cost: string; systems: TopologySystem[] };
export type Topology = { summary: { value: string; label: string; accent?: boolean }[]; groups: TopologyGroup[] };

export type Summary = {
  healthScore: number;
  totalResources: number;
  totalAccounts: number;
  monthlyCost: number;
  wasteIdentified: number;
  realizedSavings?: number;
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

/* ---------- Infrastructure graph ---------- */

export type Env = 'cloud' | 'dc' | 'labs' | 'edge' | 'saas';

export type ServiceType =
  | 'vm-fleet' | 'database' | 'storage' | 'object-store' | 'k8s' | 'network' | 'cache' | 'queue'
  | 'host-cluster' | 'warehouse' | 'gpu' | 'serverless' | 'cdn' | 'analytics';

export type NodeStatus = 'healthy' | 'idle' | 'hot' | 'degraded';

export type InfraNode = {
  id: string;
  kind: 'integration' | 'cluster' | 'service';
  label: string;
  integration?: string;
  env?: Env;
  parent?: string;
  location?: string;
  type?: ServiceType;
  count?: number;
  unit?: string;
  monthlyCost?: number;
  cpu?: number | null;
  mem?: number | null;
  status?: NodeStatus;
  findings?: number;
  tags?: string[];
};

export type InfraEdge = { from: string; to: string; kind: 'contains' | 'depends' | 'replicates' | 'traffic'; label?: string };

export type InfraGraph = { nodes: InfraNode[]; edges: InfraEdge[] };

/** 48 points over the last 24 hours (newest last). */
export type Telemetry = { cpu: number[]; mem: number[]; cost: number[]; rps?: number[]; latency?: number[] };

/* ---------- Agent sessions ---------- */

export type SessionStatus = 'running' | 'waiting' | 'completed' | 'failed';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed';
export type StepKind = 'plan' | 'tool' | 'observe' | 'decide' | 'handoff' | 'approval' | 'result';

export type TraceStep = {
  id: string;
  agentId: string;
  /** Absolute start time (ms). */
  at: number;
  durationMs: number;
  kind: StepKind;
  title: string;
  text: string;
  tool?: string;
  integration?: string;
  target?: string;
  args?: Record<string, unknown>;
  result?: string;
  status: StepStatus;
  metrics?: { label: string; value: string }[];
};

export type AgentRun = {
  id: string;
  name: string;
  role: string;
  status: StepStatus;
  startedAt: number;
  endedAt?: number;
  integrations: string[];
  steps: TraceStep[];
};

export type SessionSource = 'chat' | 'workflow' | 'schedule' | 'scan' | 'approval';

export type AgentSession = {
  id: string;
  title: string;
  goal: string;
  status: SessionStatus;
  source: SessionSource;
  startedAt: number;
  endedAt?: number;
  integrations: string[];
  agents: AgentRun[];
  summary?: string;
  savings?: number;
  findingsCount?: number;
  resourcesTouched?: number;
  /** Chat thread this session belongs to or was opened from (live mode). */
  threadId?: string;
  /** Session started from a chat in this browser (drives the sidebar agents panel). */
  fromChat?: boolean;
  /** Steps arrive from a live chat stream instead of a planned timeline. */
  stream?: boolean;
  requestedBy?: string;
};
