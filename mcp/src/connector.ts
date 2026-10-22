/**
 * Martian connector: runs inside the customer's cloud account or data center,
 * hosts one MCP server per integration and dials OUT to the Martian gateway over a
 * TLS WebSocket. No inbound ports are needed and cloud credentials never leave the
 * customer's environment (the AWS/Azure/GCP SDKs use the host's own identity).
 *
 * Env:
 *   MARTIAN_CONNECTOR_TOKEN   required, from the Integrations page
 *   MARTIAN_GATEWAY_URL       wss://gateway.martian-ai.com/connect
 *   MARTIAN_SANDBOX=true      force demo data (otherwise set by the control plane)
 *   PORT                      health endpoint (default 8080)
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import WebSocket from "ws";
import type { IntegrationSpec, Provider } from "./core/types.js";
import { log } from "./core/util.js";
import { buildServer, makeProvider, VERSION } from "./server.js";
import { decode, encode, type Frame } from "./tunnel/protocol.js";
import { TunnelTransport } from "./tunnel/transport.js";

type Session = { server: McpServer; transport: TunnelTransport };

export class Connector {
  private ws?: WebSocket;
  private specs = new Map<string, IntegrationSpec>();
  private providers = new Map<string, { hash: string; provider: Provider }>();
  private sessions = new Map<string, Session>();
  private sandbox: boolean;
  private attempt = 0;
  private stopped = false;
  connected = false;

  constructor(private gatewayUrl: string, private token: string, forceSandbox = false) {
    this.sandbox = forceSandbox;
  }

  start() {
    this.stopped = false;
    this.dial();
  }

  async stop() {
    this.stopped = true;
    for (const [id] of this.sessions) await this.closeSession(id);
    this.ws?.close(1000);
  }

  private dial() {
    const ws = new WebSocket(this.gatewayUrl, { headers: { Authorization: `Bearer ${this.token}` }, handshakeTimeout: 15_000 });
    this.ws = ws;
    ws.on("open", () => {
      this.attempt = 0;
      this.connected = true;
      log.info({ gateway: this.gatewayUrl }, "connected to gateway");
      ws.send(encode({ type: "hello", version: VERSION, sandbox: this.sandbox, kinds: ["aws", "azure", "gcp", "vcenter", "ssh"] }));
    });
    ws.on("message", (raw) => {
      try {
        this.onFrame(decode(raw));
      } catch (e) {
        log.warn({ err: e }, "bad frame");
      }
    });
    ws.on("unexpected-response", (_req, res) => log.error({ status: res.statusCode }, "gateway rejected the connector (check the token)"));
    ws.on("error", (e) => log.warn({ err: e.message }, "gateway connection error"));
    ws.on("close", (code) => {
      this.connected = false;
      for (const [id] of this.sessions) void this.closeSession(id);
      if (this.stopped) return;
      // Exponential backoff with jitter, capped at 60s; slower after auth failures.
      const delay = Math.min(60_000, 1000 * 2 ** this.attempt++) * (0.5 + Math.random() / 2) * (code === 4401 ? 5 : 1);
      log.info({ code, delay: Math.round(delay) }, "gateway disconnected; reconnecting");
      setTimeout(() => this.dial(), delay);
    });
  }

  private send(f: Frame) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(f));
  }

  private onFrame(f: Frame) {
    switch (f.type) {
      case "config":
        this.applyConfig(f.integrations, f.sandbox);
        break;
      case "open":
        void this.openSession(f.session, f.integration);
        break;
      case "rpc": {
        const s = this.sessions.get(f.session);
        if (s) s.transport.deliver(f.message);
        else this.send({ type: "error", session: f.session, message: "unknown session" });
        break;
      }
      case "close":
        void this.closeSession(f.session);
        break;
      case "ping":
        this.send({ type: "pong", t: f.t });
        break;
    }
  }

  private applyConfig(integrations: IntegrationSpec[], sandbox: boolean) {
    this.sandbox = this.sandbox || sandbox;
    const next = new Map(integrations.filter((i) => i.enabled).map((i) => [i.id, i]));
    for (const id of this.providers.keys()) if (!next.has(id)) this.providers.delete(id);
    for (const [id, spec] of next) {
      const hash = createHash("sha256").update(JSON.stringify([spec.config, spec.secrets, this.sandbox])).digest("hex");
      // Keep providers whose config didn't change (preserves caches and sandbox state).
      if (this.providers.get(id)?.hash !== hash) {
        try {
          this.providers.set(id, { hash, provider: makeProvider(spec, this.sandbox) });
        } catch (e) {
          log.error({ integration: id, err: (e as Error).message }, "cannot start integration");
        }
      }
    }
    this.specs = next;
    log.info({ integrations: [...next.values()].map((i) => i.kind), sandbox: this.sandbox }, "configuration applied");
  }

  private async openSession(session: string, integration: string) {
    const spec = this.specs.get(integration);
    const entry = this.providers.get(integration);
    if (!spec || !entry) {
      this.send({ type: "error", session, message: `integration ${integration} is not served by this connector` });
      return;
    }
    const transport = new TunnelTransport(session, (message) => this.send({ type: "rpc", session, message }));
    const server = buildServer(spec, entry.provider);
    this.sessions.set(session, { server, transport });
    transport.onclose = () => this.sessions.delete(session);
    await server.connect(transport);
  }

  private async closeSession(session: string) {
    const s = this.sessions.get(session);
    this.sessions.delete(session);
    await s?.server.close().catch(() => undefined);
  }
}

function main() {
  const token = process.env.MARTIAN_CONNECTOR_TOKEN;
  const gateway = process.env.MARTIAN_GATEWAY_URL ?? "ws://localhost:8787/connect";
  if (!token) {
    log.fatal("MARTIAN_CONNECTOR_TOKEN is required");
    process.exit(2);
  }
  const connector = new Connector(gateway, token, process.env.MARTIAN_SANDBOX === "true");
  connector.start();
  const port = Number(process.env.PORT ?? 8080);
  createServer((req, res) => {
    const ok = req.url === "/healthz" || connector.connected;
    res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" }).end(JSON.stringify({ ok, connected: connector.connected }));
  }).listen(port);
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void connector.stop().then(() => process.exit(0)));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
