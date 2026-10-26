import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { Gateway } from "../src/gateway.js";

const statusFor = (url: string, token: string) =>
  new Promise<number>((resolve) => {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("open", () => { ws.close(); resolve(101); });
    ws.on("error", () => undefined);
  });

describe("connector authentication", () => {
  it("answers 503 (retry soon) when the API is unreachable", async () => {
    const gw = new Gateway("http://127.0.0.1:1", "internal");
    await gw.listen(0);
    const port = (gw.server.address() as AddressInfo).port;
    expect(await statusFor(`ws://127.0.0.1:${port}/connect`, "mct_x")).toBe(503);
    await gw.close();
  });

  it("answers 401 when the API rejects the token", async () => {
    const api = createServer((_req, res) => res.writeHead(401).end());
    await new Promise<void>((r) => api.listen(0, r));
    const gw = new Gateway(`http://127.0.0.1:${(api.address() as AddressInfo).port}`, "internal");
    await gw.listen(0);
    const port = (gw.server.address() as AddressInfo).port;
    expect(await statusFor(`ws://127.0.0.1:${port}/connect`, "mct_bad")).toBe(401);
    await gw.close();
    api.close();
  });
});
