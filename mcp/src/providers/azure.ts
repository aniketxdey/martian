import { ComputeManagementClient } from "@azure/arm-compute";
import { MonitorClient } from "@azure/arm-monitor";
import { ClientSecretCredential, DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import { z } from "zod";
import { azureVmMonthly, diskMonthly, round2 } from "../core/pricing.js";
import type { IntegrationSpec, InventoryResult, Provider, Resource, ToolDef } from "../core/types.js";
import { avg, daysSince, log, p95, round1 } from "../core/util.js";

const parseId = (id: string) => {
  const m = id.match(/\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/[^/]+\/[^/]+\/([^/]+)/i);
  if (!m) throw new Error(`not an Azure resource id: ${id}`);
  return { subscription: m[1], group: m[2], name: m[3] };
};

export class AzureProvider implements Provider {
  private cred: TokenCredential;

  constructor(private spec: IntegrationSpec) {
    const s = spec.secrets;
    // Prefer the connector's managed identity / workload identity; a service principal
    // entered in the UI is supported for hosted connectors.
    this.cred = s.client_secret && s.client_id && s.tenant_id
      ? new ClientSecretCredential(s.tenant_id, s.client_id, s.client_secret)
      : new DefaultAzureCredential();
  }

  private subs(): string[] {
    const subs = this.spec.config.subscription_ids as string[] | undefined;
    if (!subs?.length) throw new Error("configure at least one subscription id");
    return subs;
  }

  private compute = (sub: string) => new ComputeManagementClient(this.cred, sub);

  private async cpu(sub: string, resourceId: string) {
    const end = new Date();
    const start = new Date(end.getTime() - 14 * 86_400_000);
    try {
      const r: any = await new MonitorClient(this.cred, sub).metrics.list(resourceId, {
        timespan: `${start.toISOString()}/${end.toISOString()}`,
        interval: "PT1H",
        metricnames: "Percentage CPU",
        aggregation: "Average",
      });
      const series: number[] = (r.value?.[0]?.timeseries?.[0]?.data ?? [])
        .map((d: any) => d.average)
        .filter((v: unknown) => typeof v === "number");
      return series.length ? { cpu_avg_14d: round1(avg(series)), cpu_p95_14d: round1(p95(series)) } : {};
    } catch (e) {
      log.warn({ err: e, resourceId }, "azure metrics failed");
      return {};
    }
  }

  async inventory(): Promise<InventoryResult> {
    const resources: Resource[] = [];
    const warnings: string[] = [];
    for (const sub of this.subs()) {
      const client = this.compute(sub);
      try {
        for await (const vm of client.virtualMachines.listAll({ statusOnly: "true" })) {
          const statuses = (vm as any).instanceView?.statuses ?? (vm as any).properties?.instanceView?.statuses ?? [];
          const power = statuses.find((x: any) => String(x.code).startsWith("PowerState/"))?.displayStatus ?? "";
          const size = (vm as any).hardwareProfile?.vmSize ?? (vm as any).properties?.hardwareProfile?.vmSize ?? "";
          resources.push({
            resource_id: vm.id!,
            resource_type: "vm",
            name: vm.name ?? "",
            account: sub,
            region: vm.location ?? "",
            state: power === "VM running" ? "running" : power,
            environment: "cloud",
            monthly_cost: power === "VM running" ? round2(azureVmMonthly(size)) : 0,
            attributes: { instance_type: size, resource_group: parseId(vm.id!).group, system: vm.tags?.System },
            tags: (vm.tags ?? {}) as Record<string, string>,
            metrics: power === "VM running" ? await this.cpu(sub, vm.id!) : {},
          });
        }
        for await (const d of client.disks.list()) {
          const p: any = (d as any).properties ?? d;
          const unattached = p.diskState === "Unattached";
          resources.push({
            resource_id: d.id!,
            resource_type: "volume",
            name: d.name ?? "",
            account: sub,
            region: d.location ?? "",
            state: p.diskState ?? "",
            environment: "cloud",
            monthly_cost: round2(diskMonthly(p.diskSizeGB ?? 0, String(d.sku?.name ?? "").startsWith("Premium"))),
            attributes: {
              size_gb: p.diskSizeGB,
              sku: d.sku?.name,
              attached: !unattached,
              unattached_days: unattached ? daysSince(p.lastOwnershipUpdateTime ?? p.timeCreated) : 0,
            },
            tags: (d.tags ?? {}) as Record<string, string>,
            metrics: {},
          });
        }
      } catch (e) {
        warnings.push(`${sub}: ${(e as Error).message}`);
      }
    }
    return { integration: "azure", resources, warnings };
  }

  tools(): ToolDef[] {
    const ids = z.array(z.string()).min(1).max(100);
    return [
      { name: "azure_inventory", title: "Azure inventory", write: false, input: {},
        description: "All VMs and managed disks with power state, 14-day CPU and estimated monthly cost.",
        run: () => this.inventory() },
      { name: "azure_verify_access", title: "Verify access", write: false, input: {},
        description: "Confirms Martian can read each configured subscription.",
        run: async () => {
          const out = [];
          for (const sub of this.subs()) {
            const it = this.compute(sub).virtualMachines.listAll();
            await it.next();
            out.push({ subscription: sub, ok: true });
          }
          return { ok: true, subscriptions: out };
        } },
      { name: "azure_deallocate_vms", title: "Deallocate VMs", write: true, input: { vm_ids: ids },
        description: "Stops and deallocates VMs so compute billing stops. Reversible with azure_start_vms.",
        run: async (a: { vm_ids: string[] }) => {
          for (const id of a.vm_ids) {
            const { subscription, group, name } = parseId(id);
            await this.compute(subscription).virtualMachines.deallocate(group, name);
          }
          return { ok: true, deallocated: a.vm_ids };
        } },
      { name: "azure_start_vms", title: "Start VMs", write: true, input: { vm_ids: ids },
        description: "Starts deallocated VMs (rollback for azure_deallocate_vms).",
        run: async (a: { vm_ids: string[] }) => {
          for (const id of a.vm_ids) {
            const { subscription, group, name } = parseId(id);
            await this.compute(subscription).virtualMachines.start(group, name);
          }
          return { ok: true, started: a.vm_ids };
        } },
      { name: "azure_snapshot_and_delete_disks", title: "Snapshot and delete disks", write: true, input: { disk_ids: ids },
        description: "Snapshots each unattached managed disk, then deletes the disk.",
        run: async (a: { disk_ids: string[] }) => {
          const out = [];
          for (const id of a.disk_ids) {
            const { subscription, group, name } = parseId(id);
            const client = this.compute(subscription);
            const disk = await client.disks.get(group, name);
            const snapName = `${name}-martian-${Date.now()}`.slice(0, 80);
            await client.snapshots.createOrUpdate(group, snapName, {
              location: disk.location!,
              creationData: { createOption: "Copy", sourceResourceId: id },
              tags: { "martian:source-disk": name },
            } as any);
            await client.disks.delete(group, name);
            out.push({ disk_id: id, snapshot: snapName });
          }
          return { ok: true, deleted: out };
        } },
    ];
  }
}
