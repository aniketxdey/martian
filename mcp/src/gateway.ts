/**
 * Martian gateway (control plane). Terminates connector tunnels and exposes every
 * integration as an MCP Streamable HTTP endpoint for the agents:
 *
 *   POST /mcp/:integrationId     JSON-RPC in, JSON out (Mcp-Session-Id header)
 *   DELETE /mcp/:integrationId   end the session
 *   WS   /connect                connectors dial in here (Bearer connector token)
 *   POST /internal/connectors/:id/refresh   push fresh config to a connector
 *
 * Callers authenticate with the internal service token. Custom MCP servers that are
 * reachable over HTTP are proxied directly instead of through a connector.
 *
 * Env: PORT (8787), MARTIAN_API_URL, MARTIAN_INTERNAL_TOKEN
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import WebSocket, { WebSocketServer } from "ws";
import { log } from "./core/util.js";
import { decode, encode, type Frame } from "./tunnel/protocol.js";

type Pending = { resolve: (m: JSONRPCMessage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
type Tunnel = { id: string; org: string; ws: WebSocket; alive: boolean; sessions: Set<string> };
type Route = { type: "connector"; org_id: string; connector_id: string } | { type: "http"; org_id: string; url: string; headers: Record<string, string> };

const REQUEST_TIMEOUT_MS = Number(process.env.MARTIAN_TOOL_TIMEOUT_MS ?? 30 * 60_000); // snapshots can be slow

export class Gateway {
  private tunnels = new Map<string, Tunnel>();
  private sessions = new Map<string, { connector: string; integration: string }>();
  private pending = new Map<string, Pending>();
  private routes = new Map<string, { route: Route; at: number }>();
  readonly server = createServer((req, res) => void this.http(req, res).catch((e) => this.fail(res, 500, (e as Error).message)));
  private wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  private heartbeat?: NodeJS.Timeout;

  constructor(private apiUrl: string, private internalToken: string) {
    this.server.on("upgrade", (req, socket, head) => {
      if (!req.url?.startsWith("/connect")) return socket.destroy();
      void this.authenticate(req).then(
        (cfg) => this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws, cfg)),
        (e) => {
          log.warn({ err: (e as Error).message }, "connector rejected");
          socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
          socket.destroy();
        },
      );
    });
    this.heartbeat = setInterval(() => this.ping(), 25_000);
  }

  listen(port: number) {
    return new Promise<void>((resolve) => this.server.listen(port, resolve));
  }

  async close() {
    clearInterval(this.heartbeat);
    for (const t of this.tunnels.values()) t.ws.terminate();
    await new Promise((r) => this.server.close(r));
  }

  // ---------------------------------------------------------------- control-plane API

  private async api(path: string, init: RequestInit = {}) {
    const r = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.internalToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!r.ok) throw Object.assign(new Error(`api ${path}: ${r.status}`), { status: r.status });
    return r.json() as Promise<any>;
  }

  private async authenticate(req: IncomingMessage) {
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ")) throw new Error("missing token");
    return this.api("/internal/connectors/auth", { method: "POST", body: JSON.stringify({ token: auth.slice(7), version: req.headers["user-agent"] }) });
  }

  private async route(integration: string): Promise<Route> {
    const cached = this.routes.get(integration);
    if (cached && Date.now() - cached.at < 30_000) return cached.route;
    const route = (await this.api(`/internal/integrations/${integration}/route`)) as Route;
    this.routes.set(integration, { route, at: Date.now() });
    return route;
  }

  // ---------------------------------------------------------------- tunnels

  private attach(ws: WebSocket, cfg: any) {
    const id = cfg.connector_id as string;
    this.tunnels.get(id)?.ws.close(4000, "replaced by a newer connection");
    const tunnel: Tunnel = { id, org: cfg.org_id, ws, alive: true, sessions: new Set() };
    this.tunnels.set(id, tunnel);
    log.info({ connector: id, integrations: cfg.integrations.length }, "connector online");
    ws.send(encode({ type: "config", connector_id: id, org_id: cfg.org_id, sandbox: cfg.sandbox, integrations: cfg.integrations }));
    void this.api(`/internal/connectors/${id}/status`, { method: "POST", body: JSON.stringify({ status: "online" }) }).catch(() => undefined);
    ws.on("message", (raw) => {
      try {
        this.onFrame(tunnel, decode(raw));
      } catch (e) {
        log.warn({ err: e }, "bad frame from connector");
      }
    });
    ws.on("close", () => {
      if (this.tunnels.get(id) !== tunnel) return;
      this.tunnels.delete(id);
      for (const s of tunnel.sessions) this.dropSession(s, "connector disconnected");
      log.info({ connector: id }, "connector offline");
      void this.api(`/internal/connectors/${id}/status`, { method: "POST", body: JSON.stringify({ status: "offline" }) }).catch(() => undefined);
    });
  }

  private onFrame(t: Tunnel, f: Frame) {
    if (f.type === "pong") {
      t.alive = true;
    } else if (f.type === "rpc") {
      const m = f.message as any;
      if (m.id !== undefined && ("result" in m || "error" in m)) {
        const key = `${f.session}:${m.id}`;
        const p = this.pending.get(key);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(key);
          p.resolve(f.message);
        }
      } // server-initiated notifications/requests are not forwarded (no SSE stream)
    } else if (f.type === "error" && f.session) {
      this.dropSession(f.session, f.message);
    }
  }

  private ping() {
    for (const t of this.tunnels.values()) {
      if (!t.alive) {
        t.ws.terminate();
        continue;
      }
      t.alive = false;
      t.ws.send(encode({ type: "ping", t: Date.now() }));
    }
  }

  private dropSession(session: string, reason: string) {
    this.sessions.delete(session);
    for (const [key, p] of this.pending) {
      if (key.startsWith(`${session}:`)) {
        clearTimeout(p.timer);
        this.pending.delete(key);
        p.reject(new Error(reason));
      }
    }
  }

  async refresh(connectorId: string) {
    const t = this.tunnels.get(connectorId);
    if (!t) return false;
    try {
      const cfg = await this.api(`/internal/connectors/${connectorId}/config`);
      t.ws.send(encode({ type: "config", connector_id: connectorId, org_id: cfg.org_id, sandbox: cfg.sandbox, integrations: cfg.integrations }));
      this.routes.clear();
    } catch (e) {
      if ((e as any).status === 404) t.ws.close(4401, "connector revoked");
      else throw e;
    }
    return true;
  }

  // ---------------------------------------------------------------- HTTP

  private fail(res: ServerResponse, status: number, message: string, id: unknown = null) {
    if (res.headersSent) return res.end();
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }));
  }

  private async body(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 8 * 1024 * 1024) throw new Error("request too large");
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  private async http(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://gateway");
    if (url.pathname === "/healthz") {
      return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, connectors: this.tunnels.size }));
    }
    if (req.headers.authorization !== `Bearer ${this.internalToken}`) return this.fail(res, 401, "unauthorized");

    const refresh = url.pathname.match(/^\/internal\/connectors\/([\w-]+)\/refresh$/);
    if (refresh && req.method === "POST") {
      const pushed = await this.refresh(refresh[1]);
      return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ pushed }));
    }

    const m = url.pathname.match(/^\/mcp\/([\w-]+)$/);
    if (!m) return this.fail(res, 404, "not found");
    const integration = m[1];
    let route: Route;
    try {
      route = await this.route(integration);
    } catch (e) {
      return this.fail(res, (e as any).status === 404 ? 404 : 502, "integration not found or disabled");
    }
    const org = req.headers["x-martian-org"];
    if (org && org !== route.org_id) return this.fail(res, 403, "integration belongs to another organization");

    if (route.type === "http") return this.proxy(req, res, route);
    return this.viaTunnel(req, res, integration, route.connector_id);
  }

  /** Custom MCP servers reachable over HTTP: pass the request through. */
  private async proxy(req: IncomingMessage, res: ServerResponse, route: Extract<Route, { type: "http" }>) {
    const headers: Record<string, string> = { ...route.headers };
    for (const h of ["content-type", "accept", "mcp-session-id", "mcp-protocol-version"]) {
      const v = req.headers[h];
      if (typeof v === "string") headers[h] = v;
    }
    const upstream = await fetch(route.url, { method: req.method, headers, body: req.method === "POST" ? await this.body(req) : undefined });
    const out: Record<string, string> = {};
    upstream.headers.forEach((v, k) => { if (["content-type", "mcp-session-id"].includes(k)) out[k] = v; });
    res.writeHead(upstream.status, out);
    if (upstream.body) for await (const chunk of upstream.body as any) res.write(chunk);
    res.end();
  }

  private async viaTunnel(req: IncomingMessage, res: ServerResponse, integration: string, connectorId: string) {
    const tunnel = this.tunnels.get(connectorId);
    let session = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "DELETE") {
      if (session && this.sessions.has(session)) {
        tunnel?.ws.send(encode({ type: "close", session }));
        this.dropSession(session, "session closed");
      }
      return void res.writeHead(200).end();
    }
    if (req.method === "GET") return void res.writeHead(405, { Allow: "POST, DELETE" }).end();
    if (req.method !== "POST") return this.fail(res, 405, "method not allowed");
    if (!tunnel) return this.fail(res, 503, "the connector for this integration is offline");

    let payload: JSONRPCMessage | JSONRPCMessage[];
    try {
      payload = JSON.parse(await this.body(req));
    } catch {
      return this.fail(res, 400, "invalid JSON");
    }
    const messages = Array.isArray(payload) ? payload : [payload];
    const isInit = messages.some((x: any) => x.method === "initialize");

    if (!session) {
      if (!isInit) return this.fail(res, 400, "missing Mcp-Session-Id");
      session = randomUUID();
      this.sessions.set(session, { connector: connectorId, integration });
      tunnel.sessions.add(session);
      tunnel.ws.send(encode({ type: "open", session, integration }));
    } else if (!this.sessions.has(session)) {
      return this.fail(res, 404, "session not found"); // client re-initializes
    }

    const sid = session;
    const waits = messages
      .filter((x: any) => x.id !== undefined && x.method)
      .map((x: any) => new Promise<JSONRPCMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(`${sid}:${x.id}`);
          reject(new Error("tool call timed out"));
        }, REQUEST_TIMEOUT_MS);
        this.pending.set(`${sid}:${x.id}`, { resolve, reject, timer });
      }));
    for (const message of messages) tunnel.ws.send(encode({ type: "rpc", session: sid, message }));

    if (!waits.length) return void res.writeHead(202, { "Mcp-Session-Id": sid }).end();
    try {
      const responses = await Promise.all(waits);
      res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": sid });
      res.end(JSON.stringify(Array.isArray(payload) ? responses : responses[0]));
    } catch (e) {
      this.fail(res, 504, (e as Error).message, (messages[0] as any).id ?? null);
    }
  }
}

function main() {
  const token = process.env.MARTIAN_INTERNAL_TOKEN;
  if (!token) {
    log.fatal("MARTIAN_INTERNAL_TOKEN is required");
    process.exit(2);
  }
  const gw = new Gateway(process.env.MARTIAN_API_URL ?? "http://localhost:8000", token);
  const port = Number(process.env.PORT ?? 8787);
  void gw.listen(port).then(() => log.info({ port }, "gateway listening"));
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void gw.close().then(() => process.exit(0)));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
