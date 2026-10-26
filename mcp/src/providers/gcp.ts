import { DisksClient, InstancesClient } from "@google-cloud/compute";
import { MetricServiceClient } from "@google-cloud/monitoring";
import { z } from "zod";
import { diskMonthly, gcpVmMonthly, round2 } from "../core/pricing.js";
import type { IntegrationSpec, InventoryResult, Provider, Resource, ToolDef } from "../core/types.js";
import { avg, daysSince, log, p95, round1 } from "../core/util.js";

// Resource ids look like "projects/<p>/zones/<z>/instances/<name>" (or /disks/<name>).
const parse = (id: string) => {
  const m = id.match(/projects\/([^/]+)\/zones\/([^/]+)\/(instances|disks)\/([^/]+)/);
  if (!m) throw new Error(`not a GCP resource path: ${id}`);
  return { project: m[1], zone: m[2], name: m[4] };
};
const last = (url?: string | null) => (url ?? "").split("/").pop() ?? "";

export class GcpProvider implements Provider {
  // Uses Application Default Credentials (workload identity on GKE/GCE, or a key file).
  private instances = new InstancesClient();
  private disks = new DisksClient();
  private monitoring = new MetricServiceClient();

  constructor(private spec: IntegrationSpec) {}

  private projects(): string[] {
    const p = this.spec.config.project_ids as string[] | undefined;
    if (!p?.length) throw new Error("configure at least one project id");
    return p;
  }

  private async cpuByInstance(project: string): Promise<Map<string, number[]>> {
    const end = Math.floor(Date.now() / 1000);
    const out = new Map<string, number[]>();
    try {
      const [series] = await this.monitoring.listTimeSeries({
        name: `projects/${project}`,
        filter: 'metric.type="compute.googleapis.com/instance/cpu/utilization"',
        interval: { startTime: { seconds: end - 14 * 86400 }, endTime: { seconds: end } },
        aggregation: { alignmentPeriod: { seconds: 3600 }, perSeriesAligner: "ALIGN_MEAN" },
      });
      for (const ts of series) {
        const id = ts.resource?.labels?.instance_id ?? "";
        out.set(id, (ts.points ?? []).map((p) => 100 * Number(p.value?.doubleValue ?? 0)));
      }
    } catch (e) {
      log.warn({ err: e, project }, "gcp monitoring failed");
    }
    return out;
  }

  async inventory(): Promise<InventoryResult> {
    const resources: Resource[] = [];
    const warnings: string[] = [];
    for (const project of this.projects()) {
      try {
        const cpu = await this.cpuByInstance(project);
        for await (const [zonePath, scoped] of this.instances.aggregatedListAsync({ project })) {
          for (const i of scoped.instances ?? []) {
            const zone = last(zonePath);
            const type = last(i.machineType);
            const s = cpu.get(String(i.id)) ?? [];
            resources.push({
              resource_id: `projects/${project}/zones/${zone}/instances/${i.name}`,
              resource_type: "vm",
              name: i.name ?? "",
              account: project,
              region: zone,
              state: i.status === "RUNNING" ? "running" : String(i.status ?? "").toLowerCase(),
              environment: "cloud",
              monthly_cost: i.status === "RUNNING" ? round2(gcpVmMonthly(type)) : 0,
              attributes: { instance_type: type, system: i.labels?.system },
              tags: (i.labels ?? {}) as Record<string, string>,
              metrics: s.length ? { cpu_avg_14d: round1(avg(s)), cpu_p95_14d: round1(p95(s)) } : {},
            });
          }
        }
        for await (const [zonePath, scoped] of this.disks.aggregatedListAsync({ project })) {
          for (const d of scoped.disks ?? []) {
            const zone = last(zonePath);
            const attached = (d.users ?? []).length > 0;
            resources.push({
              resource_id: `projects/${project}/zones/${zone}/disks/${d.name}`,
              resource_type: "volume",
              name: d.name ?? "",
              account: project,
              region: zone,
              state: attached ? "in-use" : "unattached",
              environment: "cloud",
              monthly_cost: round2(diskMonthly(Number(d.sizeGb ?? 0), last(d.type).includes("ssd"))),
              attributes: {
                size_gb: Number(d.sizeGb ?? 0), disk_type: last(d.type), attached,
                unattached_days: attached ? 0 : daysSince(d.lastDetachTimestamp ?? d.creationTimestamp),
              },
              tags: (d.labels ?? {}) as Record<string, string>,
              metrics: {},
            });
          }
        }
      } catch (e) {
        warnings.push(`${project}: ${(e as Error).message}`);
      }
    }
    return { integration: "gcp", resources, warnings };
  }

  tools(): ToolDef[] {
    const ids = z.array(z.string()).min(1).max(100);
    return [
      { name: "gcp_inventory", title: "Google Cloud inventory", write: false, input: {},
        description: "All Compute Engine instances and persistent disks with 14-day CPU and estimated monthly cost.",
        run: () => this.inventory() },
      { name: "gcp_verify_access", title: "Verify access", write: false, input: {},
        description: "Confirms Martian can read each configured project.",
        run: async () => ({ ok: true, projects: await Promise.all(this.projects().map(async (p) => {
          const it = this.instances.aggregatedListAsync({ project: p, maxResults: 1 });
          await it[Symbol.asyncIterator]().next();
          return { project: p, ok: true };
        })) }) },
      { name: "gcp_stop_instances", title: "Stop instances", write: true, input: { instance_ids: ids },
        description: "Stops Compute Engine instances. Reversible with gcp_start_instances.",
        run: async (a: { instance_ids: string[] }) => {
          for (const id of a.instance_ids) {
            const { project, zone, name } = parse(id);
            const [op] = await this.instances.stop({ project, zone, instance: name });
            await op.promise();
          }
          return { ok: true, stopped: a.instance_ids };
        } },
      { name: "gcp_start_instances", title: "Start instances", write: true, input: { instance_ids: ids },
        description: "Starts stopped instances (rollback for gcp_stop_instances).",
        run: async (a: { instance_ids: string[] }) => {
          for (const id of a.instance_ids) {
            const { project, zone, name } = parse(id);
            const [op] = await this.instances.start({ project, zone, instance: name });
            await op.promise();
          }
          return { ok: true, started: a.instance_ids };
        } },
      { name: "gcp_snapshot_and_delete_disks", title: "Snapshot and delete disks", write: true, input: { disk_ids: ids },
        description: "Snapshots each unattached persistent disk, then deletes it.",
        run: async (a: { disk_ids: string[] }) => {
          const out = [];
          for (const id of a.disk_ids) {
            const { project, zone, name } = parse(id);
            const snapshot = `${name}-martian-${Date.now()}`.slice(0, 62);
            const [snapOp] = await this.disks.createSnapshot({ project, zone, disk: name, snapshotResource: { name: snapshot } });
            await snapOp.promise();
            const [delOp] = await this.disks.delete({ project, zone, disk: name });
            await delOp.promise();
            out.push({ disk_id: id, snapshot });
          }
          return { ok: true, deleted: out };
        } },
    ];
  }
}
