import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Connector } from "../src/connector.js";
import { Gateway } from "../src/gateway.js";

const INTERNAL = "test-internal-token";
const TOKEN = "mct_test";
const ORG = "11111111-1111-1111-1111-111111111111";
const AWS_ID = "22222222-2222-2222-2222-222222222222";
const SSH_ID = "33333333-3333-3333-3333-333333333333";

const integrations = [
  { id: AWS_ID, kind: "aws", name: "AWS", enabled: true, config: { accounts: [{ account_id: "123456789012" }] }, secrets: {} },
  { id: SSH_ID, kind: "ssh", name: "Servers", enabled: true, secrets: {},
    config: { hosts: [{ id: "h1", name: "Production Server 01", host: "192.168.1.100", username: "admin", password: "pw" }] } },
];

let api: Server;
let gateway: Gateway;
let connector: Connector;
let gwUrl: string;
const statuses: string[] = [];

function stubApi() {
  return createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${INTERNAL}`) return void res.writeHead(401).end();
    let body = "";
    for await (const c of req) body += c;
    const json = (v: unknown, s = 200) => res.writeHead(s, { "Content-Type": "application/json" }).end(JSON.stringify(v));
    const cfg = { connector_id: "c1", org_id: ORG, sandbox: true, integrations };
    if (req.url === "/internal/connectors/auth") return JSON.parse(body).token === TOKEN ? json(cfg) : json({}, 401);
    if (req.url === "/internal/connectors/c1/config") return json(cfg);
    if (req.url === "/internal/connectors/c1/status") { statuses.push(JSON.parse(body).status); return json({ ok: true }); }
    const route = req.url?.match(/^\/internal\/integrations\/([\w-]+)\/route$/);
    if (route) return integrations.some((i) => i.id === route[1]) ? json({ type: "connector", org_id: ORG, connector_id: "c1" }) : json({}, 404);
    json({}, 404);
  });
}

async function client(integration: string, headers: Record<string, string> = {}) {
  const c = new Client({ name: "test", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${gwUrl}/mcp/${integration}`), {
    requestInit: { headers: { Authorization: `Bearer ${INTERNAL}`, ...headers } },
  }));
  return c;
}

const data = (r: any) => r.structuredContent;

beforeAll(async () => {
  api = stubApi();
  await new Promise<void>((r) => api.listen(0, r));
  gateway = new Gateway(`http://127.0.0.1:${(api.address() as AddressInfo).port}`, INTERNAL);
  await gateway.listen(0);
  gwUrl = `http://127.0.0.1:${(gateway.server.address() as AddressInfo).port}`;
  connector = new Connector(`${gwUrl.replace("http", "ws")}/connect`, TOKEN);
  connector.start();
  for (let i = 0; i < 50 && !connector.connected; i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 100)); // config frame
});

afterAll(async () => {
  await connector.stop();
  await gateway.close();
  api.close();
});

describe("connector tunnel", () => {
  it("reports online and exposes tools with read/write metadata", async () => {
    expect(statuses).toContain("online");
    const c = await client(AWS_ID);
    const { tools } = await c.listTools();
    const stop = tools.find((t) => t.name === "aws_stop_instances")!;
    const inv = tools.find((t) => t.name === "aws_inventory")!;
    expect(stop.annotations?.destructiveHint).toBe(true);
    expect(stop._meta?.["martian/write"]).toBe(true);
    expect(inv.annotations?.readOnlyHint).toBe(true);
    await c.close();
  });

  it("returns normalized inventory and applies sandbox writes", async () => {
    const c = await client(AWS_ID);
    const before = data(await c.callTool({ name: "aws_inventory", arguments: {} }));
    const idle = before.resources.filter((r: any) => r.resource_type === "vm" && r.metrics.cpu_avg_14d < 5);
    expect(idle.length).toBeGreaterThan(10);
    const id = idle[0].resource_id;
    const res = data(await c.callTool({ name: "aws_stop_instances", arguments: { region: "us-east-1", instance_ids: [id] } }));
    expect(res.ok).toBe(true);
    const after = data(await c.callTool({ name: "aws_inventory", arguments: {} }));
    expect(after.resources.find((r: any) => r.resource_id === id).state).toBe("stopped");
    await c.close();
  });

  it("validates tool input and surfaces tool errors", async () => {
    const c = await client(AWS_ID);
    const bad = await c.callTool({ name: "aws_stop_instances", arguments: { instance_ids: [] } });
    expect(bad.isError).toBe(true);
    const missing = await c.callTool({ name: "aws_modify_db_instance_class", arguments: { db_instance_id: "nope", target_class: "db.r5.large" } });
    expect(missing.isError).toBe(true);
    await c.close();
  });

  it("serves SSH tools from config pushed by the control plane", async () => {
    const c = await client(SSH_ID);
    const check = data(await c.callTool({ name: "ssh_check_host", arguments: { host_id: "h1" } }));
    expect(check.ok).toBe(true);
    const ls = data(await c.callTool({ name: "ssh_list_dir", arguments: { host_id: "h1", path: "/home/admin" } }));
    expect(ls.files.some((f: any) => f.name === "logs")).toBe(true);
    await c.close();
  });

  it("rejects callers without the internal token or from another org", async () => {
    const r = await fetch(`${gwUrl}/mcp/${AWS_ID}`, { method: "POST", body: "{}" });
    expect(r.status).toBe(401);
    await expect(client(AWS_ID, { "X-Martian-Org": "someone-else" })).rejects.toThrow();
  });

  it("rejects connectors with a bad token", async () => {
    const bad = new Connector(`${gwUrl.replace("http", "ws")}/connect`, "mct_wrong");
    bad.start();
    await new Promise((r) => setTimeout(r, 300));
    expect(bad.connected).toBe(false);
    await bad.stop();
  });
});
