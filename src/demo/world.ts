/**
 * Demo world: everything the console shows, generated from a variant and a seed.
 * One world per UI run; tick.ts moves it forward in time.
 */
import { CATALOG, CATALOG_BY_ID } from '../data/catalog';
import type { PermissionMode } from '../data/modes';
import type {
  AgentSession, InfraEdge, InfraGraph, InfraNode, Machine, NodeStatus, Telemetry, UiActivity, UiFinding,
} from '../state/types';
import { clamp, Rng, rng, round } from './rng';
import { ClusterSpec, ServiceSpec, Variant, VARIANTS, WasteHint } from './variants';

export type DemoIntegration = {
  id: string;
  status: 'connected' | 'auth' | 'error' | 'pending' | 'available';
  enabled: boolean;
  mode: PermissionMode;
  scope: string[];
  disabledTools: string[];
  lastSync: number | null;
  calls: { at: number; agent: string; tool: string; ms: number; ok: boolean }[];
  callCount: number;
};

export type ServiceState = {
  spec: ServiceSpec;
  cluster: ClusterSpec;
  count: number;
  unitCost: number;
  baseCpu: number | null;
  cpu: number | null;
  mem: number | null;
};

export type DemoServer = Machine & { latencyMs?: number; files: { name: string; type: 'directory' | 'file'; size: string; modified: string }[] };

export type World = {
  seed: number;
  variantIndex: number;
  variant: Variant;
  createdAt: number;
  now: number;
  tick: number;
  integrations: DemoIntegration[];
  services: Record<string, ServiceState>;
  graph: InfraGraph;
  telemetry: Record<string, Telemetry>;
  findings: UiFinding[];
  /** Findings monitoring will "discover" later in the run. */
  reserve: UiFinding[];
  sessions: AgentSession[];
  activity: UiActivity[];
  servers: DemoServer[];
  lastScanAt: number;
  scanning: string | null;
  realized: number;
  costDrift: number;
};

const HOUR = 3600_000;
const MIN = 60_000;

/* ---------- formatting helpers ---------- */

export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
export const moneyK = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2).replace(/0$/, '')}M` : n >= 1000 ? `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K` : money(n));
export const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}`;
export const short = (id: string) => CATALOG_BY_ID[id]?.short ?? id;

/** Diurnal utilization curve (0..1) for a time of day. */
const diurnal = (t: number) => {
  const h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
  return 0.5 + 0.5 * Math.sin(((h - 9) / 24) * 2 * Math.PI);
};

/* ---------- graph ---------- */

export const serviceNodeId = (clusterId: string, serviceId: string) => `svc:${clusterId}/${serviceId}`;
export const clusterNodeId = (clusterId: string) => `cl:${clusterId}`;
export const integrationNodeId = (id: string) => `int:${id}`;

const statusFor = (s: ServiceState): NodeStatus => {
  if (s.cpu == null) return s.spec.waste?.some((w) => w === 'dup' || w === 'cold' || w === 'unattached') ? 'idle' : 'healthy';
  if (s.cpu < 6) return 'idle';
  if (s.cpu > 78) return 'hot';
  return 'healthy';
};

export function buildGraph(w: Pick<World, 'variant' | 'services' | 'integrations' | 'findings'>): InfraGraph {
  const nodes: InfraNode[] = [];
  const edges: InfraEdge[] = [];
  const connected = new Set(w.integrations.filter((i) => i.enabled && i.status === 'connected').map((i) => i.id));
  const findingsByNode = new Map<string, number>();
  for (const f of w.findings) if (f.nodeId && f.state === 'open') findingsByNode.set(f.nodeId, (findingsByNode.get(f.nodeId) ?? 0) + 1);

  const used = new Set<string>();
  for (const c of w.variant.clusters) {
    used.add(c.integration);
    for (const s of c.services) if (s.integration) used.add(s.integration);
  }
  for (const id of used) {
    const cat = CATALOG_BY_ID[id];
    nodes.push({ id: integrationNodeId(id), kind: 'integration', label: cat?.short ?? id, integration: id, status: connected.has(id) ? 'healthy' : 'degraded' });
  }
  for (const c of w.variant.clusters) {
    const services = c.services.map((s) => w.services[serviceNodeId(c.id, s.id)]);
    const cost = services.reduce((n, s) => n + s.count * s.unitCost, 0);
    const cpus = services.map((s) => s.cpu).filter((x): x is number => x != null);
    nodes.push({
      id: clusterNodeId(c.id), kind: 'cluster', label: c.name, integration: c.integration, env: c.env, location: c.location, parent: integrationNodeId(c.integration),
      monthlyCost: cost, cpu: cpus.length ? cpus.reduce((a, b) => a + b, 0) / cpus.length : null,
      count: services.reduce((n, s) => n + s.count, 0), unit: 'resources',
      findings: services.reduce((n, s) => n + (findingsByNode.get(serviceNodeId(c.id, s.spec.id)) ?? 0), 0),
      status: services.some((s) => statusFor(s) === 'hot') ? 'hot' : 'healthy',
    });
    edges.push({ from: integrationNodeId(c.integration), to: clusterNodeId(c.id), kind: 'contains' });
    for (const s of services) {
      const id = serviceNodeId(c.id, s.spec.id);
      nodes.push({
        id, kind: 'service', label: s.spec.name, integration: s.spec.integration ?? c.integration, env: c.env, parent: clusterNodeId(c.id),
        location: c.location, type: s.spec.type, count: s.count, unit: s.spec.unit, monthlyCost: s.count * s.unitCost,
        cpu: s.cpu, mem: s.mem, status: statusFor(s), findings: findingsByNode.get(id) ?? 0, tags: s.spec.tags,
      });
      edges.push({ from: clusterNodeId(c.id), to: id, kind: 'contains' });
      if (s.spec.integration && s.spec.integration !== c.integration) edges.push({ from: integrationNodeId(s.spec.integration), to: id, kind: 'contains', label: 'observes' });
    }
  }
  // Dependencies: service ids are unique within a variant, so resolve across clusters.
  const byService = new Map<string, string>();
  for (const c of w.variant.clusters) for (const s of c.services) byService.set(s.id, serviceNodeId(c.id, s.id));
  for (const c of w.variant.clusters) {
    for (const s of c.services) {
      for (const d of s.deps ?? []) {
        const to = byService.get(d);
        if (to) edges.push({ from: serviceNodeId(c.id, s.id), to, kind: s.type === 'database' && d.includes('dr') ? 'replicates' : 'depends' });
      }
    }
  }
  return { nodes, edges };
}

/* ---------- telemetry ---------- */

function initialTelemetry(s: ServiceState, r: Rng, now: number): Telemetry {
  const cpu: number[] = [];
  const mem: number[] = [];
  const cost: number[] = [];
  const rps: number[] = [];
  const latency: number[] = [];
  const base = s.baseCpu ?? 0;
  const amp = s.spec.waste?.includes('idle') ? 0.15 : 0.45;
  const memBase = s.mem ?? 0;
  for (let i = 47; i >= 0; i--) {
    const t = now - i * 30 * MIN;
    const d = diurnal(t);
    cpu.push(s.baseCpu == null ? 0 : clamp(base * (1 - amp + 2 * amp * d) + r.gauss(0, base * 0.06 + 0.4), 0, 100));
    mem.push(s.baseCpu == null ? 0 : clamp(memBase + r.gauss(0, 1.5), 0, 100));
    cost.push((s.count * s.unitCost) / (30 * 24 * 2) * (0.92 + r.next() * 0.16));
    rps.push(Math.max(0, (base * 18 + 40) * (0.4 + d) * (0.9 + r.next() * 0.2)));
    latency.push(Math.max(4, 40 + base * 0.8 + r.gauss(0, 6) + (d > 0.8 ? 25 : 0)));
  }
  return { cpu, mem, cost, rps, latency };
}

/* ---------- findings ---------- */

const VERB: Record<string, { stop: string; tool: Partial<Record<WasteHint, string>> }> = {
  aws: { stop: 'Stop', tool: { idle: 'aws_stop_instances', unattached: 'aws_snapshot_and_delete_volumes', snapshots: 'aws_delete_snapshots', oversized: 'aws_modify_db_instance_class', nat: 'aws_delete_nat_gateways', forecast: 'aws_set_asg_desired_capacity', cold: 'aws_apply_lifecycle_policy', suspend: 'aws_stop_cluster' } },
  azure: { stop: 'Deallocate', tool: { idle: 'azure_deallocate_vms', unattached: 'azure_snapshot_and_delete_disks', snapshots: 'azure_delete_snapshots', oversized: 'azure_scale_sql', dr: 'azure_resize_vms', forecast: 'azure_set_vmss_capacity', cold: 'azure_set_blob_tier' } },
  gcp: { stop: 'Stop', tool: { idle: 'gcp_stop_instances', unattached: 'gcp_snapshot_and_delete_disks', oversized: 'gcp_patch_sql_tier', cold: 'gcp_set_storage_class', egress: 'gcp_update_cdn_policy' } },
  vmware: { stop: 'Power off', tool: { idle: 'vcenter_power_off_vms', consolidate: 'vcenter_vmotion', snapshots: 'vcenter_remove_snapshots', oversized: 'vcenter_reconfigure_vm' } },
  nutanix: { stop: 'Power off', tool: { idle: 'nutanix_power_off_vms', dup: 'nutanix_enable_dedup' } },
  proxmox: { stop: 'Shut down', tool: { idle: 'proxmox_shutdown_guests', snapshots: 'proxmox_delete_snapshots', oversized: 'proxmox_resize_guest' } },
  kubernetes: { stop: 'Scale down', tool: { requests: 'k8s_rightsize_requests', 'gpu-idle': 'k8s_scale_node_pool', forecast: 'k8s_scale_node_pool' } },
  openshift: { stop: 'Scale down', tool: { requests: 'openshift_set_limits', 'gpu-idle': 'openshift_scale_machineset' } },
  netapp: { stop: 'Delete', tool: { dup: 'ontap_enable_dedup', snapshots: 'ontap_delete_snapshots', cold: 'ontap_enable_tiering' } },
  ssh: { stop: 'Stop', tool: { dup: 'ssh_cleanup_duplicates', consolidate: 'ssh_drain_host', 'gpu-idle': 'ssh_drain_nodes', cold: 'ssh_archive_paths' } },
  snowflake: { stop: 'Suspend', tool: { suspend: 'snowflake_resize_warehouse', cold: 'snowflake_set_retention' } },
  databricks: { stop: 'Terminate', tool: { suspend: 'databricks_terminate_cluster', forecast: 'databricks_set_autoscaling' } },
  oracle: { stop: 'Stop', tool: { oversized: 'oci_scale_autonomous_db', snapshots: 'oci_delete_backups' } },
};

export const writeToolFor = (integration: string, hint: WasteHint) => VERB[integration]?.tool[hint] ?? null;

/** Lowercase the first letter unless the word is an acronym ("BI", "GPU"). */
export const lcFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const lower = lcFirst;

function findingsFor(svc: ServiceState, r: Rng, now: number): UiFinding[] {
  const out: UiFinding[] = [];
  const c = svc.cluster;
  const integ = svc.spec.integration ?? c.integration;
  const cat = CATALOG_BY_ID[integ];
  const scope = `${cat?.short ?? integ} · ${c.location}`;
  const nodeId = serviceNodeId(c.id, svc.spec.id);
  const verb = VERB[integ]?.stop ?? 'Stop';
  const name = svc.spec.name;
  const total = svc.count * svc.unitCost;
  const mk = (hint: WasteHint, f: Omit<UiFinding, 'id' | 'state' | 'nodeId' | 'integration' | 'scope'> & { scope?: string }) => {
    out.push({ id: `f-${c.id}-${svc.spec.id}-${hint}`, state: 'open', nodeId, integration: integ, createdAt: now - r.int(2, 96) * HOUR, ...f, scope: f.scope ?? scope });
  };
  for (const hint of svc.spec.waste ?? []) {
    switch (hint) {
      case 'idle': {
        const n = Math.max(2, Math.round(svc.count * r.float(0.28, 0.62)));
        mk(hint, {
          title: `Idle ${lower(name)}`, description: `${plural(n, svc.spec.unit)} under 5% average CPU for 14 days`, affects: plural(n, svc.spec.unit),
          impact: round(n * svc.unitCost * r.float(0.82, 0.94), 1), difficulty: 'easy', timeToImplement: '< 5 min', automatable: true,
          steps: ['Confirm owners from tags and notify them', 'Snapshot attached storage', `${verb} the ${plural(n, svc.spec.unit)} (reversible)`, 'Report realized savings after 24 hours'],
        });
        break;
      }
      case 'oversized': {
        const n = Math.max(1, Math.round(svc.count * r.float(0.5, 1)));
        mk(hint, {
          title: `Over-provisioned ${lower(name)}`, description: `${plural(n, svc.spec.unit)} peaking at ${Math.round((svc.baseCpu ?? 10) * 1.8)}% CPU over 30 days`, affects: plural(n, svc.spec.unit),
          impact: round(n * svc.unitCost * r.float(0.32, 0.48), 1), difficulty: 'medium', timeToImplement: '15 min', automatable: true,
          steps: ['Pick a smaller class from 30 days of load and the 7-day forecast', 'Schedule each change inside the maintenance window', 'Resize and watch latency for one hour', 'Roll back automatically if p95 latency rises 20%'],
        });
        break;
      }
      case 'dup': {
        const tb = Math.max(2, Math.round(svc.count * r.float(0.07, 0.19)));
        mk(hint, {
          title: `Duplicate data on ${lower(name)}`, description: `${tb} TB of identical files across ${r.int(3, 14)} shares`, affects: `${tb} TB`,
          impact: round(tb * svc.unitCost * r.float(0.85, 1), 1), difficulty: 'medium', timeToImplement: '1 hour', automatable: integ !== 'ssh' || r.chance(0.5),
          steps: ['Hash files and group exact duplicates', 'Keep the newest copy and link the rest', 'Move duplicates to a 30-day recycle area', 'Delete after 30 days unless restored'],
        });
        break;
      }
      case 'unattached': {
        const n = Math.max(3, Math.round(svc.count * r.float(0.16, 0.36)));
        mk(hint, {
          title: `Unattached ${lower(svc.spec.unit)} in ${c.name}`, description: `${plural(n, svc.spec.unit)} detached for 7+ days (${Math.round(n * r.float(180, 520)).toLocaleString('en-US')} GB)`, affects: plural(n, svc.spec.unit),
          impact: round(n * svc.unitCost, 1), difficulty: 'easy', timeToImplement: '< 3 min', automatable: true,
          steps: ['Take a final snapshot of each volume', `Delete the ${plural(n, svc.spec.unit)}`, 'Keep snapshots for 30 days'],
        });
        break;
      }
      case 'snapshots': {
        const n = r.int(18, 96);
        mk(`snapshots`, {
          title: `Orphaned snapshots in ${c.name}`, description: `${n} snapshots older than 90 days with no source`, affects: plural(n, 'snapshots'),
          impact: round(n * r.float(3.5, 11), 1), difficulty: 'easy', timeToImplement: '< 5 min', automatable: true,
          steps: ['List snapshots older than 90 days', 'Skip any referenced by an image or backup policy', `Delete the ${n} orphaned snapshots`],
        });
        break;
      }
      case 'nat': {
        const n = r.int(1, Math.max(1, Math.min(3, svc.count - 1)));
        mk(hint, {
          title: 'Idle NAT gateways', description: `${plural(n, 'gateway')} with under 1 GB/day for 14 days`, affects: plural(n, 'gateways'),
          impact: round(n * svc.unitCost + r.float(40, 220), 1), difficulty: 'medium', timeToImplement: '20 min', automatable: true,
          steps: ['Confirm no route tables still point at them', 'Move remaining subnets to a shared gateway', `Delete ${plural(n, 'gateway')}`],
        });
        break;
      }
      case 'egress': {
        mk(hint, {
          title: `Egress costs on ${lower(name)}`, description: `Cache hit ratio ${r.int(74, 86)}% and ${r.int(9, 22)}% cross-region traffic`, affects: 'egress',
          impact: round(total * r.float(0.06, 0.13), 1), difficulty: 'medium', timeToImplement: '1 hour', automatable: false,
          steps: ['Raise cache TTLs for immutable media', 'Serve same-region traffic through private endpoints', 'Compare egress after 7 days'],
        });
        break;
      }
      case 'requests': {
        const ratio = r.float(2.1, 3.4);
        mk(hint, {
          title: `Over-requested CPU in ${lower(name)}`, description: `Requests are ${ratio.toFixed(1)}× actual usage across ${plural(svc.count, 'pods')}`, affects: plural(svc.count, 'pods'),
          impact: round(total * r.float(0.24, 0.4), 1), difficulty: 'medium', timeToImplement: '30 min', automatable: true,
          steps: ['Compute p95 usage per container over 14 days', 'Open a pull request with new requests and limits', 'Roll out with the deployment canary', 'Shrink the node pool once pods repack'],
        });
        break;
      }
      case 'suspend': {
        const n = Math.max(1, Math.round(svc.count * r.float(0.3, 0.6)));
        mk(hint, {
          title: `Always-on ${lower(name)}`, description: `${plural(n, svc.spec.unit)} running ${r.int(14, 21)} h/day with no queries`, affects: plural(n, svc.spec.unit),
          impact: round(n * svc.unitCost * r.float(0.35, 0.55), 1), difficulty: 'easy', timeToImplement: '< 5 min', automatable: true,
          steps: ['Set auto-suspend to 5 minutes', 'Enable auto-resume on query', 'Report credit savings after 7 days'],
        });
        break;
      }
      case 'consolidate': {
        const n = Math.max(4, Math.round(svc.count * r.float(0.35, 0.55)));
        const freed = Math.max(2, Math.floor(n / 2));
        mk(hint, {
          title: `Consolidate ${lower(name)}`, description: `${plural(n, svc.spec.unit)} under 20% CPU; ${freed} can be freed by rebalancing`, affects: plural(n, svc.spec.unit),
          impact: round(freed * svc.unitCost, 1), difficulty: 'medium', timeToImplement: '1–2 days', automatable: integ === 'vmware',
          steps: ['Rebalance workloads onto fewer hosts', 'Place freed hosts in maintenance mode', 'Power down or repurpose freed hosts'],
        });
        break;
      }
      case 'gpu-idle': {
        const n = Math.max(2, Math.round(svc.count * r.float(0.2, 0.4)));
        mk(hint, {
          title: `Idle GPU capacity in ${lower(name)}`, description: `${plural(n, svc.spec.unit)} idle more than 60% of the last 14 days`, affects: plural(n, svc.spec.unit),
          impact: round(n * svc.unitCost * r.float(0.55, 0.7), 1), difficulty: 'medium', timeToImplement: '30 min', automatable: true,
          steps: ['Drain jobs from the idle nodes', 'Scale the pool minimum down', 'Keep burst capacity through autoscaling'],
        });
        break;
      }
      case 'dr': {
        mk(hint, {
          title: `Over-sized DR standby in ${c.name}`, description: `Warm standby sized at 100% of production; RTO allows 40%`, affects: plural(svc.count, svc.spec.unit),
          impact: round(total * r.float(0.42, 0.58), 1), difficulty: 'medium', timeToImplement: '1 day', automatable: false,
          steps: ['Confirm RTO and RPO with the business owner', 'Resize standby to 40% and script scale-up', 'Run a failover test'],
        });
        break;
      }
      case 'forecast': {
        const peak = Math.round(clamp((svc.baseCpu ?? 30) * r.float(1.4, 2.6), 12, 93));
        const cur = Math.max(2, Math.round(svc.count * (svc.spec.unit.includes('pods') ? 0.08 : 0.3)));
        const down = peak < 45;
        const target = down ? Math.max(1, Math.round(cur * r.float(0.45, 0.7))) : Math.round(cur * r.float(1.25, 1.6));
        mk(hint, {
          title: down ? `Right-size ${lower(name)} ahead of forecast` : `Scale ${lower(name)} ahead of forecast demand`,
          description: `LSTM forecast peak ${peak}% CPU in the next 24h; ${down ? 'lower' : 'raise'} capacity ${cur} → ${target}`,
          affects: plural(cur, 'nodes'), impact: down ? round((cur - target) * svc.unitCost, 1) : 0,
          difficulty: 'easy', timeToImplement: '< 2 min', automatable: true,
          steps: ['Forecast 24h utilization with p10/p90 bands', `Set desired capacity ${cur} → ${target}`, 'Re-check the forecast every hour'],
        });
        break;
      }
      case 'cold': {
        const tb = Math.max(4, Math.round(svc.count * r.float(0.25, 0.55)));
        mk(hint, {
          title: `Cold data in ${lower(name)}`, description: `${tb} TB not read in 90 days on a hot tier`, affects: `${tb} TB`,
          impact: round(tb * Math.max(2, svc.unitCost - r.float(3, 6)), 1), difficulty: 'easy', timeToImplement: '10 min', automatable: true,
          steps: ['Add a lifecycle rule for objects untouched for 90 days', 'Move them to an infrequent-access tier', 'Report savings after the first transition'],
        });
        break;
      }
    }
  }
  return out;
}

/* ---------- servers ---------- */

const FILES = ['etc', 'home', 'opt', 'srv', 'var'];
function serverFiles(r: Rng) {
  return [
    ...FILES.map((n) => ({ name: n, type: 'directory' as const, size: '', modified: `2026-${String(r.int(1, 10)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}` })),
    ...['backup-2024-11.tar.gz', 'export_final_v2.csv', 'export_final_v2 (copy).csv', 'core.21847'].map((n) => ({ name: n, type: 'file' as const, size: `${r.int(2, 900)} MB`, modified: `2025-${String(r.int(1, 12)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}` })),
  ];
}

/* ---------- world ---------- */

export function createWorld(seed: number, variantIndex: number, now = Date.now()): World {
  const variant = VARIANTS[variantIndex % VARIANTS.length];
  const r = rng(seed).fork(variant.key);

  const specFor = new Map(variant.integrations.map((i) => [i.id, i]));
  const integrations: DemoIntegration[] = CATALOG.map((c) => {
    const spec = specFor.get(c.id);
    const status = spec ? spec.status ?? 'connected' : 'available';
    return {
      id: c.id, status, enabled: !!spec && status !== 'auth', mode: spec?.mode ?? 'read', scope: spec?.scope ?? [],
      disabledTools: [], lastSync: status === 'connected' ? now - r.int(1, 14) * MIN : null, calls: [], callCount: status === 'connected' ? r.int(400, 9000) : 0,
    };
  });

  const services: Record<string, ServiceState> = {};
  for (const c of variant.clusters) {
    for (const s of c.services) {
      const count = r.int(s.count[0], s.count[1]);
      const baseCpu = s.cpu ? r.float(s.cpu[0], s.cpu[1]) : null;
      services[serviceNodeId(c.id, s.id)] = {
        spec: s, cluster: c, count, unitCost: r.float(s.unitCost[0], s.unitCost[1]), baseCpu,
        cpu: baseCpu, mem: baseCpu == null ? null : clamp(baseCpu * r.float(1.1, 1.9) + r.float(8, 20), 4, 92),
      };
    }
  }

  // Findings: most are visible at start; the rest are discovered while the UI runs.
  const all = Object.values(services).flatMap((s) => findingsFor(s, r.fork(s.spec.id), now));
  const shuffled = r.pickN(all, all.length);
  const visibleCount = Math.max(6, Math.round(all.length * r.float(0.68, 0.8)));
  const findings = shuffled.slice(0, visibleCount);
  const reserve = shuffled.slice(visibleCount);
  // A couple were already applied in earlier sessions.
  let realized = 0;
  for (const f of r.pickN(findings.filter((x) => x.automatable && x.impact > 0), r.int(1, 3))) {
    f.state = 'done';
    f.realized = round(f.impact * r.float(0.9, 1.04), 1);
    realized += f.realized;
  }
  findings.sort((a, b) => b.impact - a.impact);

  const telemetry: Record<string, Telemetry> = {};
  for (const [id, s] of Object.entries(services)) telemetry[id] = initialTelemetry(s, r.fork(id), now);

  const servers: DemoServer[] = variant.servers.map((s, i) => ({
    id: `srv-${i + 1}`, name: s.name, ipAddress: s.ip, username: s.user, password: '', status: i === 0 || r.chance(0.6) ? 'connected' : 'disconnected',
    description: s.description, os: s.os, latencyMs: r.int(2, 18), files: serverFiles(r.fork(s.name)),
  }));

  const world: World = {
    seed, variantIndex: variantIndex % VARIANTS.length, variant, createdAt: now, now, tick: 0,
    integrations, services, graph: { nodes: [], edges: [] }, telemetry, findings, reserve,
    sessions: [], activity: [], servers, lastScanAt: now - r.int(6, 52) * MIN, scanning: null, realized, costDrift: 0,
  };
  world.graph = buildGraph(world);
  return world;
}

/* ---------- derived values ---------- */

export const monthlyCost = (w: World) => Object.values(w.services).reduce((n, s) => n + s.count * s.unitCost, 0) * (1 + w.costDrift);
export const resourceCount = (w: World) => Object.values(w.services).reduce((n, s) => n + (s.spec.unit === 'TB' || s.spec.unit.includes('/') ? 0 : s.count), 0);
export const openWaste = (w: World) => w.findings.filter((f) => f.state === 'open').reduce((n, f) => n + f.impact, 0);

export function healthScore(w: World) {
  const cost = monthlyCost(w);
  const waste = openWaste(w);
  const ratio = cost ? waste / cost : 0;
  const hot = w.graph.nodes.filter((n) => n.kind === 'service' && n.status === 'hot').length;
  const bad = w.integrations.filter((i) => i.enabled && i.status !== 'connected').length;
  return Math.round(clamp(100 - ratio * 210 - hot * 3 - bad * 2, 35, 98));
}

export const accountsCount = (w: World) =>
  w.integrations.filter((i) => i.enabled && ['aws', 'azure', 'gcp', 'oracle'].includes(i.id)).reduce((n, i) => n + Math.max(1, i.scope.length), 0);
