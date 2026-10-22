import { readFileSync } from "node:fs";
import { Client } from "ssh2";
import { z } from "zod";
import type { IntegrationSpec, InventoryResult, Provider, Resource, ToolDef } from "../core/types.js";

export type Host = { id: string; name: string; host: string; username: string; password?: string | null; os?: string };

/** Single-quote for POSIX shells. */
export const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Absolute paths only, so a value can never be parsed as a command-line option. */
export const absPath = z.string().regex(/^\/[^\0\n]*$/, "must be an absolute path");
/** systemd unit names. */
export const unitName = z.string().regex(/^[\w@.:-]+$/, "invalid service name").refine((v) => !v.startsWith("-"), "invalid service name");

export function run(h: Host, command: string, timeoutMs = 30_000): Promise<{ code: number; stdout: string; stderr: string }> {
  const keyPath = process.env.MARTIAN_SSH_KEY_PATH;
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => { conn.end(); reject(new Error(`timed out after ${timeoutMs}ms`)); }, timeoutMs);
    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) { clearTimeout(timer); conn.end(); return reject(err); }
          let stdout = "", stderr = "";
          stream.on("data", (d: Buffer) => (stdout += d.toString())).stderr.on("data", (d: Buffer) => (stderr += d.toString()));
          stream.on("close", (code: number) => { clearTimeout(timer); conn.end(); resolve({ code: code ?? 0, stdout, stderr }); });
        });
      })
      .on("error", (e) => { clearTimeout(timer); reject(e); })
      .connect({
        host: h.host, port: 22, username: h.username, readyTimeout: 10_000,
        password: h.password ?? undefined,
        privateKey: !h.password && keyPath ? readFileSync(keyPath) : undefined,
      });
  });
}

export function parseLs(path: string, out: string) {
  const files = [];
  for (const line of out.split("\n").slice(1)) {
    const m = line.match(/^([dl-])\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+(.+)$/);
    if (!m || m[4] === ".") continue;
    const name = m[4].replace(/ -> .*$/, "");
    const full = name === ".." ? path.replace(/\/[^/]+\/?$/, "") || "/" : `${path.replace(/\/$/, "")}/${name}`;
    files.push({ name, type: m[1] === "d" ? "directory" : "file", path: full, size: human(Number(m[2])), modified: m[3] });
  }
  return files;
}

const human = (n: number) => {
  const u = ["B", "K", "M", "G", "T"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${i ? n.toFixed(1) : n}${u[i]}`;
};

export class SshProvider implements Provider {
  constructor(private spec: IntegrationSpec) {}

  hosts(): Host[] {
    return (this.spec.config.hosts ?? []) as Host[];
  }

  host(id: string): Host {
    const h = this.hosts().find((x) => x.id === id || x.name === id);
    if (!h) throw new Error(`unknown server ${id}`);
    if (!h.host) throw new Error(`${h.name} has no IP address`);
    return h;
  }

  async duplicates(h: Host, path: string, minMb = 10) {
    if (!absPath.safeParse(path).success) throw new Error(`scan path must be absolute: ${path}`);
    minMb = Math.max(1, Math.floor(Number(minMb) || 10));
    // Files of identical size are hashed; identical hashes are duplicates.
    const cmd = `find ${sh(path)} -xdev -type f -size +${minMb}M -printf '%s\\t%p\\n' 2>/dev/null | sort -n | ` +
      `awk -F'\\t' '{c[$1]++; p[$1]=p[$1] "\\n" $2} END {for (s in c) if (c[s]>1) print substr(p[s],2)}' | ` +
      `head -5000 | xargs -d '\\n' -r sha256sum 2>/dev/null`;
    const r = await run(h, cmd, 300_000);
    const byHash = new Map<string, string[]>();
    for (const line of r.stdout.split("\n")) {
      const [hash, file] = line.split(/\s+(.+)/);
      if (hash && file) byHash.set(hash, [...(byHash.get(hash) ?? []), file]);
    }
    const groups = [...byHash.values()].filter((g) => g.length > 1);
    const sizes = await run(h, `stat -c '%s %n' ${groups.map((g) => sh(g[0])).join(" ") || "/dev/null"}`, 60_000);
    const size = new Map(sizes.stdout.split("\n").filter(Boolean).map((l) => [l.slice(l.indexOf(" ") + 1), Number(l.split(" ")[0])]));
    const top = groups.map((g) => ({ files: g, copies: g.length, bytes_each: size.get(g[0]) ?? 0 }))
      .sort((a, b) => b.bytes_each * (b.copies - 1) - a.bytes_each * (a.copies - 1));
    return { duplicate_bytes: top.reduce((n, g) => n + g.bytes_each * (g.copies - 1), 0), groups: top.slice(0, 50) };
  }

  async inventory(): Promise<InventoryResult> {
    const resources: Resource[] = [];
    const warnings: string[] = [];
    const scanPaths = (this.spec.config.scan_paths as string[] | undefined) ?? [];
    for (const h of this.hosts().filter((x) => x.host)) {
      try {
        const df = await run(h, "df -kP -x tmpfs -x devtmpfs -x overlay");
        for (const line of df.stdout.split("\n").slice(1).filter(Boolean)) {
          const [fs, total, used, , , mount] = line.split(/\s+/);
          const dup = scanPaths.includes(mount) ? await this.duplicates(h, mount) : undefined;
          resources.push({
            resource_id: `${h.id}:${mount}`, resource_type: "file_share", name: `${h.name} ${mount}`,
            account: h.name, region: "", state: "mounted", environment: "dc", monthly_cost: 0,
            attributes: {
              system: h.name, filesystem: fs, size_gb: Math.round(Number(total) / 1024 ** 2), used_gb: Math.round(Number(used) / 1024 ** 2),
              ...(dup ? { duplicate_bytes: dup.duplicate_bytes, top_duplicates: dup.groups.slice(0, 10) } : {}),
            },
            tags: {}, metrics: {},
          });
        }
      } catch (e) {
        warnings.push(`${h.name}: ${(e as Error).message}`);
      }
    }
    return { integration: "ssh", resources, warnings };
  }

  tools(): ToolDef[] {
    const hostId = z.string().describe("Server id from Settings");
    return [
      { name: "ssh_inventory", title: "Server inventory", write: false, input: {},
        description: "Mounted filesystems on each server, with duplicate-file analysis for configured scan paths.",
        run: () => this.inventory() },
      { name: "ssh_verify_access", title: "Verify access", write: false, input: {},
        description: "Checks SSH access to every configured server.",
        run: async () => ({ ok: true, hosts: await Promise.all(this.hosts().filter((h) => h.host).map(async (h) => {
          try { await run(h, "true", 10_000); return { id: h.id, ok: true }; } catch (e) { return { id: h.id, ok: false, error: (e as Error).message }; }
        })) }) },
      { name: "ssh_check_host", title: "Check server", write: false, input: { host_id: hostId },
        description: "Connects to one server and reports OS, uptime and load.",
        run: async (a: { host_id: string }) => {
          try {
            const r = await run(this.host(a.host_id), "uname -sr; uptime", 15_000);
            return { ok: r.code === 0, output: r.stdout.trim() };
          } catch (e) {
            return { ok: false, error: (e as Error).message };
          }
        } },
      { name: "ssh_list_dir", title: "List directory", write: false, input: { host_id: hostId, path: absPath.default("/home") },
        description: "Lists files in a directory on a server.",
        run: async (a: { host_id: string; path: string }) => {
          const r = await run(this.host(a.host_id), `ls -la --time-style='+%Y-%m-%d %H:%M' -- ${sh(a.path)}`);
          if (r.code !== 0) throw new Error(r.stderr.trim() || "ls failed");
          return { path: a.path, files: parseLs(a.path, r.stdout) };
        } },
      { name: "ssh_disk_usage", title: "Disk usage", write: false, input: { host_id: hostId, path: absPath.default("/") },
        description: "Largest directories under a path.",
        run: async (a: { host_id: string; path: string }) => {
          const r = await run(this.host(a.host_id), `du -xk --max-depth=1 -- ${sh(a.path)} 2>/dev/null | sort -rn | head -20`, 120_000);
          return { path: a.path, entries: r.stdout.split("\n").filter(Boolean).map((l) => { const [k, p] = l.split(/\t/); return { path: p, size: human(Number(k) * 1024) }; }) };
        } },
      { name: "ssh_find_duplicates", title: "Find duplicate files", write: false, input: { host_id: hostId, path: absPath, min_size_mb: z.number().int().min(1).default(10) },
        description: "Finds identical files (by SHA-256) larger than a size threshold.",
        run: (a: { host_id: string; path: string; min_size_mb: number }) => this.duplicates(this.host(a.host_id), a.path, a.min_size_mb) },
      { name: "ssh_stop_service", title: "Stop service", write: true, input: { host_id: hostId, service: unitName },
        description: "Stops a systemd service. Reversible with ssh_start_service.",
        run: async (a: { host_id: string; service: string }) => {
          const r = await run(this.host(a.host_id), `sudo -n systemctl stop -- ${sh(a.service)}`);
          if (r.code !== 0) throw new Error(r.stderr.trim() || "systemctl failed");
          return { ok: true, stopped: a.service };
        } },
      { name: "ssh_start_service", title: "Start service", write: true, input: { host_id: hostId, service: unitName },
        description: "Starts a systemd service (rollback for ssh_stop_service).",
        run: async (a: { host_id: string; service: string }) => {
          const r = await run(this.host(a.host_id), `sudo -n systemctl start -- ${sh(a.service)}`);
          if (r.code !== 0) throw new Error(r.stderr.trim() || "systemctl failed");
          return { ok: true, started: a.service };
        } },
    ];
  }
}
