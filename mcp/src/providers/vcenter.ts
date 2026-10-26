import { z } from "zod";
import type { IntegrationSpec, InventoryResult, Provider, Resource, ToolDef } from "../core/types.js";

/**
 * VMware vCenter via the vSphere Automation REST API (vSphere 7.0U2+).
 * Host CPU statistics come from config-provided quick stats when available; the
 * REST API does not expose historical performance counters, so utilization-based
 * consolidation findings need `host_stats` (exported by the vSphere perf collector)
 * or a future PerformanceManager integration.
 */
export class VCenterProvider implements Provider {
  private session?: { token: string; at: number };

  constructor(private spec: IntegrationSpec) {}

  private base(): string {
    const url = this.spec.config.url as string | undefined;
    if (!url) throw new Error("configure the vCenter URL");
    return url.replace(/\/$/, "");
  }

  private async token(): Promise<string> {
    if (this.session && Date.now() - this.session.at < 20 * 60_000) return this.session.token;
    const user = this.spec.config.username ?? this.spec.secrets.username ?? process.env.VCENTER_USERNAME;
    const pass = this.spec.secrets.password ?? process.env.VCENTER_PASSWORD;
    if (!user || !pass) throw new Error("vCenter credentials missing (username/password)");
    const r = await fetch(`${this.base()}/api/session`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") },
    });
    if (!r.ok) throw new Error(`vCenter authentication failed (${r.status}): check credentials`);
    this.session = { token: (await r.json()) as string, at: Date.now() };
    return this.session.token;
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(`${this.base()}${path}`, {
      ...init,
      headers: { "vmware-api-session-id": await this.token(), "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!r.ok) throw new Error(`vCenter ${path} failed (${r.status}): ${await r.text()}`);
    return (r.status === 204 ? undefined : await r.json()) as T;
  }

  async inventory(): Promise<InventoryResult> {
    const hostCost = Number(this.spec.config.host_monthly_cost ?? 450);
    const stats = (this.spec.config.host_stats ?? {}) as Record<string, { cpu_avg_14d?: number }>;
    const env = (this.spec.config.environment ?? "dc") as Resource["environment"];
    const [vms, hosts, datastores] = await Promise.all([
      this.api<any[]>("/api/vcenter/vm"),
      this.api<any[]>("/api/vcenter/host"),
      this.api<any[]>("/api/vcenter/datastore"),
    ]);
    const resources: Resource[] = [
      ...hosts.map((h): Resource => ({
        resource_id: h.host, resource_type: "host", name: h.name, account: this.base(), region: "",
        state: h.power_state ?? h.connection_state, environment: env, monthly_cost: hostCost,
        attributes: { connection_state: h.connection_state }, tags: {}, metrics: stats[h.name] ?? stats[h.host] ?? {},
      })),
      ...vms.map((v): Resource => ({
        resource_id: v.vm, resource_type: "vm", name: v.name, account: this.base(), region: "",
        state: v.power_state, environment: env, monthly_cost: 0,
        attributes: { cpu_count: v.cpu_count, memory_mib: v.memory_size_MiB, size: `${v.cpu_count} vCPU` }, tags: {}, metrics: {},
      })),
      ...datastores.map((d): Resource => ({
        resource_id: d.datastore, resource_type: "datastore", name: d.name, account: this.base(), region: "",
        state: "available", environment: env, monthly_cost: 0,
        attributes: { capacity_gb: Math.round((d.capacity ?? 0) / 1024 ** 3), free_gb: Math.round((d.free_space ?? 0) / 1024 ** 3), type: d.type },
        tags: {}, metrics: {},
      })),
    ];
    return { integration: "vcenter", resources, warnings: [] };
  }

  tools(): ToolDef[] {
    const ids = z.array(z.string()).min(1).max(100);
    const power = (action: "stop" | "start") => async (a: { vm_ids: string[] }) => {
      for (const id of a.vm_ids) await this.api(`/api/vcenter/vm/${id}/power?action=${action}`, { method: "POST" });
      return { ok: true, [action === "stop" ? "powered_off" : "powered_on"]: a.vm_ids };
    };
    return [
      { name: "vcenter_inventory", title: "vCenter inventory", write: false, input: {},
        description: "Hosts, VMs and datastores in vCenter.", run: () => this.inventory() },
      { name: "vcenter_verify_access", title: "Verify access", write: false, input: {},
        description: "Confirms Martian can sign in to vCenter.", run: async () => ({ ok: !!(await this.token()) }) },
      { name: "vcenter_power_off_vms", title: "Power off VMs", write: true, input: { vm_ids: ids },
        description: "Powers off VMs. Reversible with vcenter_power_on_vms.", run: power("stop") },
      { name: "vcenter_power_on_vms", title: "Power on VMs", write: true, input: { vm_ids: ids },
        description: "Powers on VMs (rollback for vcenter_power_off_vms).", run: power("start") },
    ];
  }
}
