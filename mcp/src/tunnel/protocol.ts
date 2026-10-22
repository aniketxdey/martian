import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { IntegrationSpec } from "../core/types.js";

/**
 * Frames on the connector ↔ gateway WebSocket. The connector opens the socket
 * (outbound only) and authenticates with its token in the Authorization header.
 *
 *   gateway → connector: config, open, rpc, close, ping
 *   connector → gateway: hello, rpc, pong
 */
export type Frame =
  | { type: "hello"; version: string; sandbox: boolean; kinds: string[] }
  | { type: "config"; connector_id: string; org_id: string; sandbox: boolean; integrations: IntegrationSpec[] }
  | { type: "open"; session: string; integration: string }
  | { type: "rpc"; session: string; message: JSONRPCMessage }
  | { type: "close"; session: string }
  | { type: "error"; session?: string; message: string }
  | { type: "ping"; t: number }
  | { type: "pong"; t: number };

export const encode = (f: Frame) => JSON.stringify(f);

export function decode(raw: unknown): Frame {
  const f = JSON.parse(String(raw));
  if (!f || typeof f.type !== "string") throw new Error("invalid frame");
  return f as Frame;
}
