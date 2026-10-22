import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * An MCP transport for one gateway session, carried over the connector's tunnel.
 * The MCP Server writes responses with `send()`; the tunnel delivers requests with
 * `deliver()`.
 */
export class TunnelTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;
  private closed = false;

  constructor(session: string, private sendFrame: (message: JSONRPCMessage) => void) {
    this.sessionId = session;
  }

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error("session closed");
    this.sendFrame(message);
  }

  deliver(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}
