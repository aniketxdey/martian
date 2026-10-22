/**
 * Sandbox mode: deterministic demo environments behind the exact tool contracts of
 * the real providers (same names, descriptions and input schemas). Write tools
 * mutate in-memory state, so a stopped instance shows up stopped on the next scan.
 */
import { ALB_MONTH, downsizeClass, ebsMonthly, ec2Monthly, NAT_MONTH, rdsMonthly, round2, SNAPSHOT_GB_MONTH, azureVmMonthly, diskMonthly, gcpVmMonthly } from "../core/pricing.js";
import type { IntegrationSpec, Provider, Resource, ToolDef } from "../core/types.js";
import { round1, rng } from "../core/util.js";
import { AwsProvider } from "./aws.js";
import { AzureProvider } from "./azure.js";
import { GcpProvider } from "./gcp.js";
import type { Host } from "./ssh.js";
import { SshProvider } from "./ssh.js";
import { VCenterProvider } from "./vcenter.js";

type World = Map<string, Resource>;

const base = (account: string, region: string, environment: Resource["environment"] = "cloud") => ({ account, region, environment });

function vm(r: () => number, id: string, name: string, type: string, idle: boolean, extra: Partial<Resource> & { cost: (t: string) => number }): Resource {
  const cpuAvg = idle ? round1(0.4 + r() * 3.8) : round1(18 + r() * 55);
  const { cost, ...rest } = extra;
  return {
    resource_id: id, resource_type: "vm", name, state: "running", monthly_cost: round2(cost(type)),
    attributes: { instance_type: type }, tags: {}, metrics: { cpu_avg_14d: cpuAvg, cpu_p95_14d: round1(idle ? cpuAvg * 2.2 : Math.min(98, cpuAvg * 1.6)) },
    account: "", region: "", environment: "cloud", ...rest,
  };
}

/** Hourly CPU for 14 days: daily cycle, weekday bump and a growth trend. */
function asgSeries(r: () => number, base: number, amp: number, trend: number): number[] {
  return Array.from({ length: 14 * 24 }, (_, h) => {
    const day = Math.floor(h / 24);
    const daily = Math.sin(((h % 24) - 8) / 24 * 2 * Math.PI);
    const weekday = day % 7 < 5 ? 1 : 0.7;
    return round1(Math.max(1, Math.min(99, base + amp * daily * weekday + trend * h + (r() - 0.5) * 4)));
  });
}

function awsWorld(spec: IntegrationSpec): World {
  const r = rng(42);
  const account = (spec.config.accounts?.[0]?.account_id as string) ?? "123456789012";
  const out: Resource[] = [];
  const systems: [string, string, number, number][] = [
    ["AWS Production", "t3.large", 15, 0], ["Payments API", "m5.xlarge", 30, 9], ["Batch", "c5.2xlarge", 20, 12],
    ["Analytics", "r5.xlarge", 20, 8], ["Internal tools", "m5.large", 41, 12], ["CI runners", "c5.xlarge", 30, 6],
  ];
  let n = 0;
  for (const [system, type, count, idle] of systems) {
    for (let i = 0; i < count; i++) {
      const id = `i-0${(0x5a1c0000 + n++).toString(16)}`;
      const res = vm(r, id, `${system.toLowerCase().replace(/ /g, "-")}-${i + 1}`, type, i < idle, { ...base(account, "us-east-1"), cost: ec2Monthly });
      res.attributes.system = system;
      res.tags = { System: system, Team: system.split(" ")[0] };
      out.push(res);
    }
  }
  for (let i = 0; i < 20; i++) {
    const res = vm(r, `i-0dr${i.toString(16).padStart(5, "0")}`, `dr-replica-${i + 1}`, "m5.large", false, { ...base(account, "us-west-2"), cost: ec2Monthly });
    res.attributes.system = "Disaster recovery";
    out.push(res);
  }
  for (let i = 0; i < 89; i++) {
    const unattached = i < 23;
    const size = [100, 200, 500, 1000, 1500][Math.floor(r() * 5)];
    out.push({
      resource_id: `vol-0${(0xa0b0000 + i).toString(16)}`, resource_type: "volume", name: unattached ? `old-data-${i}` : `root-${i}`,
      ...base(account, "us-east-1"), state: unattached ? "available" : "in-use", monthly_cost: round2(ebsMonthly("gp2", size)),
      attributes: { size_gb: size, volume_type: "gp2", attached: !unattached, unattached_days: unattached ? 10 + Math.floor(r() * 200) : 0 },
      tags: {}, metrics: {},
    });
  }
  for (let i = 0; i < 60; i++) {
    const size = [50, 100, 500][i % 3];
    out.push({
      resource_id: `snap-0${(0xc0d0000 + i).toString(16)}`, resource_type: "snapshot", name: `backup-${i}`, ...base(account, "us-east-1"),
      state: "completed", monthly_cost: round2(size * SNAPSHOT_GB_MONTH),
      attributes: { size_gb: size, age_days: i < 18 ? 120 + i * 9 : 5 + i, in_use_by_image: i === 3 }, tags: {}, metrics: {},
    });
  }
  for (let i = 0; i < 12; i++) {
    const over = i < 8;
    const cls = over ? "db.r5.2xlarge" : "db.r5.large";
    const cpu = over ? round1(3 + r() * 9) : round1(35 + r() * 30);
    out.push({
      resource_id: `orders-db-${i + 1}`, resource_type: "database", name: `orders-db-${i + 1}`, ...base(account, "us-east-1"),
      state: "available", monthly_cost: round2(rdsMonthly(cls)),
      attributes: { instance_class: cls, downsize_to: downsizeClass(cls), engine: "postgres", system: "AWS Production" },
      tags: {}, metrics: { cpu_avg_14d: cpu, cpu_p95_14d: round1(cpu * 2.1) },
    });
  }
  for (let i = 0; i < 15; i++) {
    out.push({
      resource_id: `arn:aws:elasticloadbalancing:us-east-1:${account}:loadbalancer/app/lb-${i + 1}/${(0xabc000 + i).toString(16)}`,
      resource_type: "load_balancer", name: `lb-${i + 1}`, ...base(account, "us-east-1"), state: "active", monthly_cost: round2(ALB_MONTH),
      attributes: { type: "application", age_days: 200 }, tags: {}, metrics: { traffic_14d: i < 5 ? 0 : 1_000_000 + i * 1000 },
    });
  }
  for (let i = 0; i < 6; i++) {
    out.push({
      resource_id: `nat-0${(0xe0f000 + i).toString(16)}`, resource_type: "nat_gateway", name: `nat-${i + 1}`, ...base(account, "us-east-1"),
      state: "available", monthly_cost: NAT_MONTH, attributes: { age_days: 300 }, tags: {}, metrics: { traffic_14d: i < 2 ? 0 : 5e10 },
    });
  }
  const web = asgSeries(r, 52, 22, 0.03); // growing: forecast should pre-scale
  const batch = asgSeries(r, 13, 4, 0); // over-provisioned: forecast should right-size
  out.push({
    resource_id: "web-asg", resource_type: "asg", name: "web-asg", ...base(account, "us-east-1"), state: "active",
    monthly_cost: round2(6 * ec2Monthly("m5.xlarge")), attributes: { desired: 6, min: 2, max: 16, instance_types: ["m5.xlarge"], system: "AWS Production" },
    tags: {}, metrics: { cpu_series: web },
  });
  out.push({
    resource_id: "batch-asg", resource_type: "asg", name: "batch-asg", ...base(account, "us-east-1"), state: "active",
    monthly_cost: round2(10 * ec2Monthly("c5.2xlarge")), attributes: { desired: 10, min: 2, max: 20, instance_types: ["c5.2xlarge"], system: "Batch" },
    tags: {}, metrics: { cpu_series: batch },
  });
  return new Map(out.map((x) => [x.resource_id, x]));
}

function azureWorld(spec: IntegrationSpec): World {
  const r = rng(7);
  const sub = (spec.config.subscription_ids?.[0] as string) ?? "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const rg = (n: string) => `/subscriptions/${sub}/resourceGroups/prod-eastus/providers/Microsoft.Compute/${n}`;
  const out: Resource[] = [];
  for (let i = 0; i < 98; i++) {
    const res = vm(r, rg(`virtualMachines/app-vm-${i + 1}`), `app-vm-${i + 1}`, i % 3 ? "Standard_D4s_v3" : "Standard_D2s_v3", i < 28,
      { ...base(sub, "eastus"), cost: azureVmMonthly });
    res.attributes.system = i < 60 ? "Azure Production" : "AKS cluster";
    out.push(res);
  }
  for (let i = 0; i < 145; i++) {
    const unattached = i < 34;
    const size = [128, 256, 512, 1024][i % 4];
    out.push({
      resource_id: rg(`disks/disk-${i + 1}`), resource_type: "volume", name: `disk-${i + 1}`, ...base(sub, "eastus"),
      state: unattached ? "Unattached" : "Attached", monthly_cost: round2(diskMonthly(size, i % 2 === 0)),
      attributes: { size_gb: size, attached: !unattached, unattached_days: unattached ? 15 + Math.floor(r() * 120) : 0 }, tags: {}, metrics: {},
    });
  }
  return new Map(out.map((x) => [x.resource_id, x]));
}

function gcpWorld(spec: IntegrationSpec): World {
  const r = rng(11);
  const project = (spec.config.project_ids?.[0] as string) ?? "enterprise-project-384721";
  const out: Resource[] = [];
  for (let i = 0; i < 73; i++) {
    const res = vm(r, `projects/${project}/zones/us-central1-a/instances/compute-${i + 1}`, `compute-${i + 1}`, "n2-standard-4", i < 19,
      { ...base(project, "us-central1-a"), cost: gcpVmMonthly });
    res.attributes.system = "Google Cloud";
    out.push(res);
  }
  for (let i = 0; i < 112; i++) {
    const unattached = i < 27;
    out.push({
      resource_id: `projects/${project}/zones/us-central1-a/disks/pd-${i + 1}`, resource_type: "volume", name: `pd-${i + 1}`,
      ...base(project, "us-central1-a"), state: unattached ? "unattached" : "in-use", monthly_cost: round2(diskMonthly(500, i % 3 === 0)),
      attributes: { size_gb: 500, attached: !unattached, unattached_days: unattached ? 20 + i : 0 }, tags: {}, metrics: {},
    });
  }
  return new Map(out.map((x) => [x.resource_id, x]));
}

function vcenterWorld(spec: IntegrationSpec): World {
  const r = rng(99);
  const url = (spec.config.url as string) ?? "https://vcenter.corp.local";
  const sites: [string, Resource["environment"], number, number, number][] = [
    // system, environment, hosts, VMs per host, monthly cost per host (power, cooling, support)
    ["Rack 1 · Production", "dc", 10, 8, 450], ["Database cluster", "dc", 8, 6, 520], ["Storage", "dc", 6, 4, 380],
    ["AI/ML research", "labs", 6, 5, 900], ["DevOps testing", "labs", 5, 8, 300], ["Security and QA", "labs", 4, 8, 300],
    ["Branch office NYC", "edge", 3, 6, 200], ["IoT and CDN", "edge", 2, 6, 180], ["Remote work", "edge", 1, 6, 220],
  ];
  const out: Resource[] = [];
  let h = 0, v = 0, under = 0;
  for (const [system, env, hosts, perHost, cost] of sites) {
    for (let i = 0; i < hosts; i++) {
      const low = under < 18 && r() < 0.55;
      if (low) under++;
      const cpu = low ? round1(6 + r() * 12) : round1(35 + r() * 50);
      out.push({
        resource_id: `host-${++h}`, resource_type: "host", name: `esx-${String(h).padStart(2, "0")}.corp.local`, account: url, region: "",
        state: "POWERED_ON", environment: env, monthly_cost: cost, attributes: { system, size: "2× Xeon Gold" }, tags: {},
        metrics: { cpu_avg_14d: cpu, cpu_p95_14d: round1(cpu * 1.5) },
      });
      for (let j = 0; j < perHost; j++) {
        out.push({
          resource_id: `vm-${++v}`, resource_type: "vm", name: `${system.split(" ")[0].toLowerCase()}-vm-${v}`, account: url, region: "",
          state: "POWERED_ON", environment: env, monthly_cost: 0, attributes: { system, size: `${[2, 4, 8][j % 3]} vCPU` }, tags: {}, metrics: {},
        });
      }
    }
  }
  return new Map(out.map((x) => [x.resource_id, x]));
}

const SAMPLE_FS: Record<string, { name: string; type: string; size?: string; modified?: string }[]> = {
  "/home/admin": [
    { name: "documents", type: "directory", size: "4.0K", modified: "2024-01-15 10:30" },
    { name: "scripts", type: "directory", size: "4.0K", modified: "2024-01-14 16:45" },
    { name: "logs", type: "directory", size: "4.0K", modified: "2024-01-16 09:15" },
    { name: "backup.tar.gz", type: "file", size: "1.2G", modified: "2024-01-16 02:00" },
    { name: "system_report.txt", type: "file", size: "45K", modified: "2024-01-16 08:30" },
  ],
  "/home/admin/logs": [
    { name: "system.log", type: "file", size: "156K", modified: "2024-01-16 09:15" },
    { name: "error.log", type: "file", size: "23K", modified: "2024-01-16 08:45" },
  ],
};

/** Replace each real tool's implementation with a sandbox one, keeping its contract. */
function override(real: ToolDef[], impl: Record<string, (a: any) => Promise<unknown> | unknown>): ToolDef[] {
  return real.map((t) => ({ ...t, run: async (a: any) => (impl[t.name] ? impl[t.name](a) : { ok: true, sandbox: true, tool: t.name, args: a }) }));
}

const inv = (kind: string, w: World) => ({ integration: kind, resources: [...w.values()].map((x) => structuredClone(x)), warnings: [] });

function setState(w: World, ids: string[], state: string, running: boolean, cost?: (r: Resource) => number) {
  for (const id of ids) {
    const r = w.get(id);
    if (!r) throw new Error(`resource ${id} not found`);
    r.state = state;
    if (!running) { r.attributes.paused_cost = r.monthly_cost || r.attributes.paused_cost; r.monthly_cost = 0; r.metrics = {}; }
    else { r.monthly_cost = cost ? cost(r) : r.attributes.paused_cost ?? r.monthly_cost; r.metrics = { cpu_avg_14d: 12, cpu_p95_14d: 30 }; }
  }
  return ids;
}

const remove = (w: World, ids: string[]) => ids.map((id) => { if (!w.delete(id)) throw new Error(`resource ${id} not found`); return id; });

export class SandboxProvider implements Provider {
  private world: World;

  constructor(private spec: IntegrationSpec) {
    this.world = { aws: awsWorld, azure: azureWorld, gcp: gcpWorld, vcenter: vcenterWorld }[spec.kind as "aws"]?.(spec) ?? new Map();
  }

  private hosts(): Host[] {
    return (this.spec.config.hosts ?? []) as Host[];
  }

  tools(): ToolDef[] {
    const w = this.world;
    const ok = (extra: object) => ({ ok: true, sandbox: true, ...extra });
    switch (this.spec.kind) {
      case "aws":
        return override(new AwsProvider(this.spec).tools(), {
          aws_inventory: () => inv("aws", w),
          aws_verify_access: () => ok({ identities: [{ account: "123456789012", arn: "arn:aws:sts::123456789012:assumed-role/MartianReadOnly/martian" }] }),
          aws_get_cpu_series: (a) => ({ resource_id: a.resource_id, period_seconds: 3600, series: w.get(a.resource_id)?.metrics.cpu_series ?? [] }),
          aws_cost_by_service: () => ({ period_days: 30, services: [
            { service: "Amazon Elastic Compute Cloud - Compute", cost: round2([...w.values()].filter((x) => x.resource_type === "vm").reduce((n, x) => n + x.monthly_cost, 0)) },
            { service: "Amazon Relational Database Service", cost: round2([...w.values()].filter((x) => x.resource_type === "database").reduce((n, x) => n + x.monthly_cost, 0)) },
            { service: "EC2 - Other", cost: round2([...w.values()].filter((x) => ["volume", "snapshot", "nat_gateway"].includes(x.resource_type)).reduce((n, x) => n + x.monthly_cost, 0)) },
          ] }),
          aws_stop_instances: (a) => ok({ changed: setState(w, a.instance_ids, "stopped", false).map((id) => ({ id, to: "stopped" })) }),
          aws_start_instances: (a) => ok({ changed: setState(w, a.instance_ids, "running", true).map((id) => ({ id, to: "running" })) }),
          aws_snapshot_and_delete_volumes: (a) => ok({ deleted: remove(w, a.volume_ids).map((id) => ({ volume_id: id, snapshot_id: `snap-${id.slice(4)}` })) }),
          aws_delete_snapshots: (a) => ok({ deleted: remove(w, a.snapshot_ids) }),
          aws_delete_load_balancers: (a) => ok({ deleted: remove(w, a.load_balancer_arns) }),
          aws_delete_nat_gateways: (a) => ok({ deleted: remove(w, a.nat_gateway_ids) }),
          aws_modify_db_instance_class: (a) => {
            const db = w.get(a.db_instance_id);
            if (!db) throw new Error(`DBInstanceNotFound: ${a.db_instance_id}`);
            db.attributes.instance_class = a.target_class;
            db.attributes.downsize_to = downsizeClass(a.target_class);
            db.monthly_cost = round2(rdsMonthly(a.target_class));
            db.metrics = { cpu_avg_14d: round1((db.metrics.cpu_avg_14d ?? 10) * 2), cpu_p95_14d: round1((db.metrics.cpu_p95_14d ?? 20) * 2) };
            return ok({ db_instance_id: a.db_instance_id, pending: { DBInstanceClass: a.target_class } });
          },
          aws_set_asg_desired_capacity: (a) => {
            const g = w.get(a.asg_name);
            if (!g) throw new Error(`AutoScalingGroup ${a.asg_name} not found`);
            const old = g.attributes.desired as number;
            g.monthly_cost = round2((g.monthly_cost / Math.max(1, old)) * a.desired);
            g.attributes.desired = a.desired;
            g.metrics.cpu_series = (g.metrics.cpu_series as number[]).map((v) => round1((v * old) / Math.max(1, a.desired)));
            return ok({ asg_name: a.asg_name, desired: a.desired });
          },
        });
      case "azure":
        return override(new AzureProvider(this.spec).tools(), {
          azure_inventory: () => inv("azure", w),
          azure_verify_access: () => ok({ subscriptions: [{ subscription: this.spec.config.subscription_ids?.[0], ok: true }] }),
          azure_deallocate_vms: (a) => ok({ deallocated: setState(w, a.vm_ids, "VM deallocated", false) }),
          azure_start_vms: (a) => ok({ started: setState(w, a.vm_ids, "running", true) }),
          azure_snapshot_and_delete_disks: (a) => ok({ deleted: remove(w, a.disk_ids) }),
        });
      case "gcp":
        return override(new GcpProvider(this.spec).tools(), {
          gcp_inventory: () => inv("gcp", w),
          gcp_verify_access: () => ok({ projects: [{ project: this.spec.config.project_ids?.[0], ok: true }] }),
          gcp_stop_instances: (a) => ok({ stopped: setState(w, a.instance_ids, "terminated", false) }),
          gcp_start_instances: (a) => ok({ started: setState(w, a.instance_ids, "running", true) }),
          gcp_snapshot_and_delete_disks: (a) => ok({ deleted: remove(w, a.disk_ids) }),
        });
      case "vcenter":
        return override(new VCenterProvider(this.spec).tools(), {
          vcenter_inventory: () => inv("vcenter", w),
          vcenter_verify_access: () => ok({}),
          vcenter_power_off_vms: (a) => ok({ powered_off: setState(w, a.vm_ids, "POWERED_OFF", false) }),
          vcenter_power_on_vms: (a) => ok({ powered_on: setState(w, a.vm_ids, "POWERED_ON", true) }),
        });
      case "ssh": {
        const find = (id: string) => {
          const h = this.hosts().find((x) => x.id === id || x.name === id);
          if (!h) throw new Error(`unknown server ${id}`);
          return h;
        };
        return override(new SshProvider(this.spec).tools(), {
          ssh_inventory: () => ({ integration: "ssh", warnings: [], resources: this.hosts().filter((h) => h.host).map((h, i): Resource => ({
            resource_id: `${h.id}:/data`, resource_type: "file_share", name: `${h.name} /data`, account: h.name, region: "", state: "mounted",
            environment: "dc", monthly_cost: 0, tags: {}, metrics: {},
            attributes: { system: h.name, size_gb: 8000, used_gb: 6100, ...(i === 0 ? { duplicate_bytes: 2.3 * 1024 ** 4, top_duplicates: [
              { files: ["/data/marketing/launch.mp4", "/data/archive/launch-final.mp4"], copies: 47, bytes_each: 2.1 * 1024 ** 3 },
            ] } : {}) },
          })) }),
          ssh_verify_access: () => ok({ hosts: this.hosts().map((h) => ({ id: h.id, ok: !!h.password })) }),
          ssh_check_host: (a) => {
            const h = find(a.host_id);
            return h.password ? ok({ output: `Linux 5.15.0-91-generic\n 09:14:02 up 41 days,  load average: 0.42, 0.38, 0.35` })
              : { ok: false, error: `Authentication failed for ${h.username}@${h.host}` };
          },
          ssh_list_dir: (a) => {
            find(a.host_id);
            const path = (a.path as string).replace(/\/$/, "") || "/";
            const files = (SAMPLE_FS[path] ?? SAMPLE_FS["/home/admin"]).map((f) => ({ ...f, path: `${path}/${f.name}` }));
            return { path, files: [{ name: "..", type: "directory", path: path.replace(/\/[^/]+$/, "") || "/" }, ...files] };
          },
          ssh_disk_usage: (a) => ({ path: a.path, entries: [{ path: "/data", size: "6.1T" }, { path: "/var", size: "120G" }] }),
          ssh_find_duplicates: () => ({ duplicate_bytes: 2.3 * 1024 ** 4, groups: [] }),
        });
      }
      default:
        return [];
    }
  }
}
