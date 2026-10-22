import type { ZodRawShape } from "zod";

/** One integration served by a connector, as configured in the control plane. */
export interface IntegrationSpec {
  id: string;
  kind: "aws" | "azure" | "gcp" | "vcenter" | "ssh" | "custom";
  name: string;
  enabled: boolean;
  /** Non-secret configuration: accounts, regions, subscription ids, URLs, SSH hosts. */
  config: Record<string, any>;
  /** Secrets entered in the Martian UI (delivered only to the bound connector). */
  secrets: Record<string, string>;
}

/** A tool exposed over MCP. `write` tools change infrastructure and are gated by approval. */
export interface ToolDef<A = any> {
  name: string;
  title: string;
  description: string;
  write: boolean;
  input: ZodRawShape;
  run: (args: A) => Promise<unknown>;
}

/** The normalized resource contract every `*_inventory` tool returns. */
export interface Resource {
  resource_id: string;
  resource_type:
    | "vm"
    | "volume"
    | "snapshot"
    | "database"
    | "load_balancer"
    | "nat_gateway"
    | "asg"
    | "host"
    | "datastore"
    | "file_share";
  name: string;
  account: string;
  region: string;
  state: string;
  environment: "cloud" | "dc" | "labs" | "edge";
  monthly_cost: number;
  attributes: Record<string, any>;
  tags: Record<string, string>;
  metrics: Record<string, any>;
}

export interface InventoryResult {
  integration: string;
  resources: Resource[];
  warnings: string[];
}

export interface Provider {
  tools(): ToolDef[];
}

export class ToolFailure extends Error {}
