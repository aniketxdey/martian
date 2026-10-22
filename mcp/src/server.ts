import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IntegrationSpec, Provider, ToolDef } from "./core/types.js";
import { log } from "./core/util.js";
import { AwsProvider } from "./providers/aws.js";
import { AzureProvider } from "./providers/azure.js";
import { GcpProvider } from "./providers/gcp.js";
import { SandboxProvider } from "./providers/sandbox.js";
import { SshProvider } from "./providers/ssh.js";
import { VCenterProvider } from "./providers/vcenter.js";

export const VERSION = "0.1.0";

export function makeProvider(spec: IntegrationSpec, sandbox: boolean): Provider {
  if (sandbox) return new SandboxProvider(spec);
  switch (spec.kind) {
    case "aws": return new AwsProvider(spec);
    case "azure": return new AzureProvider(spec);
    case "gcp": return new GcpProvider(spec);
    case "vcenter": return new VCenterProvider(spec);
    case "ssh": return new SshProvider(spec);
    default: throw new Error(`integration kind ${spec.kind} is not supported by this connector`);
  }
}

/** Shapes a tool result as MCP content (text for any client, structured for Martian). */
export function toResult(value: unknown) {
  const structured = value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { result: value };
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: structured };
}

/** One MCP server per integration. Tools are cached per provider instance. */
export function buildServer(spec: IntegrationSpec, provider: Provider): McpServer {
  const server = new McpServer({ name: `martian-${spec.kind}`, version: VERSION }, {
    instructions: `Martian ${spec.kind} integration "${spec.name}". Tools marked destructive change infrastructure and require approval.`,
  });
  for (const tool of provider.tools()) register(server, spec, tool);
  return server;
}

function register(server: McpServer, spec: IntegrationSpec, tool: ToolDef) {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input,
      annotations: { title: tool.title, readOnlyHint: !tool.write, destructiveHint: tool.write, openWorldHint: true },
      _meta: { "martian/write": tool.write, "martian/integration": spec.id },
    },
    async (args: any) => {
      const started = Date.now();
      try {
        const value = await tool.run(args ?? {});
        log.info({ integration: spec.id, tool: tool.name, ms: Date.now() - started }, "tool ok");
        return toResult(value);
      } catch (e) {
        const message = (e as Error).message ?? String(e);
        log.warn({ integration: spec.id, tool: tool.name, err: message }, "tool failed");
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    },
  );
}
