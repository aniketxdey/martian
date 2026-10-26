import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EgressError, isPublicAddress, tenantFetch } from "../src/core/egress.js";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "169.254.170.2",
    "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isPublicAddress(ip)).toBe(true));

  it("rejects non-IP input", () => expect(isPublicAddress("localhost")).toBe(false));
});

describe("tenantFetch", () => {
  let server: Server;
  let port: number;
  beforeAll(async () => {
    server = createServer((_req, res) => res.end("internal secret"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => {
    server.close();
    delete process.env.MARTIAN_ALLOW_PRIVATE_EGRESS;
  });

  it("requires https", async () => {
    await expect(tenantFetch(`http://example.com/mcp`)).rejects.toBeInstanceOf(EgressError);
  });

  it("refuses literal private and metadata addresses", async () => {
    await expect(tenantFetch("https://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(EgressError);
    await expect(tenantFetch("https://[::1]/")).rejects.toBeInstanceOf(EgressError);
  });

  it("refuses credentials in the URL", async () => {
    await expect(tenantFetch("https://user:pw@example.com/")).rejects.toBeInstanceOf(EgressError);
  });

  it("refuses hostnames that resolve to loopback at connect time", async () => {
    const err = await tenantFetch(`https://localhost:${port}/`).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.cause ?? err)).toMatch(/non-public address/);
  });

  it("allows private targets only when explicitly enabled", async () => {
    process.env.MARTIAN_ALLOW_PRIVATE_EGRESS = "true";
    const r = await tenantFetch(`http://127.0.0.1:${port}/`);
    expect(await r.text()).toBe("internal secret");
  });
});

import { absPath, unitName } from "../src/providers/ssh.js";

describe("ssh argument schemas", () => {
  it("accepts absolute paths only", () => {
    expect(absPath.safeParse("/var/log").success).toBe(true);
    for (const bad of ["-delete", "relative/dir", "--files0-from=/etc/shadow", ""]) expect(absPath.safeParse(bad).success).toBe(false);
  });
  it("accepts systemd unit names only", () => {
    expect(unitName.safeParse("nginx.service").success).toBe(true);
    for (const bad of ["--now", "a b", "x;reboot", "-x"]) expect(unitName.safeParse(bad).success).toBe(false);
  });
});
