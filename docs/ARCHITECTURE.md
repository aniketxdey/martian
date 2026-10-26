# Martian architecture

Martian finds and removes infrastructure waste across AWS, Azure, Google Cloud,
VMware and on‑premises servers. Agents do the discovery and analysis; people
approve every change unless an integration's policy allows low‑risk changes to
run on their own.

```
                        ┌──────────────────────── Martian control plane (hosted) ────────────────────────┐
  Browser ── HTTPS ───▶ │  web (React)   api (FastAPI)  ── Postgres (app data, jobs, LangGraph checkpoints) │
                        │                    │   ▲                                                         │
                        │                    ▼   │                                                         │
                        │              worker (scans, executor, scheduler)                                 │
                        │                    │ LangGraph agents ── Claude (Anthropic API)                  │
                        │                    │ MCP (Streamable HTTP)                                       │
                        │          ┌─────────┴──────────┐                                                  │
                        │      gateway (Node)      forecast (PyTorch LSTM, MCP)                            │
                        └──────────▲─────────────────────────────────────────────────────────────────────┘
                                   │  outbound‑only WebSocket (TLS), opened by the connector
                        ┌──────────┴──────── Customer environment ───────┐
                        │  connector (Node) ── MCP servers: aws · azure ·  │
                        │                      gcp · vcenter · ssh         │
                        │  credentials: IAM role / managed identity /      │
                        │  workload identity / local secrets               │
                        └──────────────────────────────────────────────────┘
```

## Services

| Service | Language | Responsibility |
| --- | --- | --- |
| `api` | Python (FastAPI) | Auth (password + WorkOS SSO), tenants, integrations, findings, approvals, chat (SSE), audit log |
| `worker` | Python | Postgres job queue: scheduled scans, finding execution, retries |
| `gateway` | Node.js | Terminates connector tunnels; exposes each integration as an MCP Streamable HTTP endpoint to the agents |
| `connector` | Node.js | Runs in the customer's cloud or data center; hosts the MCP servers; dials out to the gateway |
| `forecast` | Python (PyTorch) | LSTM workload forecasting, exposed as MCP tools `forecast_utilization` and `recommend_scaling` |
| `web` | TypeScript (React) | The console |

## Key decisions

- **Credentials stay with the customer.** The connector uses the customer's own
  identity (EC2/EKS instance role, Azure managed identity, GCP workload identity,
  local secrets). It only dials *out*, so no inbound firewall rules are needed.
  Secrets typed into the UI (for example an SSH password) are encrypted with
  AES‑256‑GCM (envelope‑encrypted with AWS KMS in production) and delivered only to
  the connector that owns that integration.
- **MCP everywhere.** Every integration is an MCP server with named tools, marked
  read or write. Scans and the chat agent call the same tools, and the Integrations
  page lists them so admins can switch each one on or off and pick a permission mode
  (`read`, `ask`, `auto`).
- **Deterministic detection, LLM orchestration.** Findings come from explicit,
  tested rules over normalized inventory and metrics, so savings figures are
  reproducible and auditable. Claude explains them and plans multi‑step work, but it
  never invents a number.
- **Human in the loop by construction.** Write tool calls pass through an approval
  node that uses LangGraph `interrupt()`. Graph state is checkpointed in Postgres,
  so a pending approval survives restarts and deploys.
- **Auto mode is narrow.** `auto` lets the executor apply findings that pass the
  risk and savings policy without a person. Free‑form write calls from chat always
  wait for approval, because tool output can carry prompt‑injected instructions.
- **Tenant URLs never reach internal networks.** Custom MCP servers are proxied
  through an egress guard that allows public HTTPS only. It checks the address at
  connect time and refuses redirects, so metadata and private ranges stay unreachable.
  Private servers belong behind the customer's connector.
- **Postgres is the only stateful dependency.** App data, the job queue
  (`FOR UPDATE SKIP LOCKED`) and LangGraph checkpoints share one managed database.
  Row‑level security on every tenant table backs up the app's tenant filters.
- **Tamper‑evident audit log.** Every mutation is recorded with actor, target and
  details, and each entry is hash‑chained to the previous one.

## Request paths

1. **Scan.** The scheduler enqueues `scan` jobs. The worker calls each enabled
   integration's `*_inventory` tool through the gateway, normalizes resources,
   asks the forecast service for demand forecasts on compute with metric history,
   runs the findings rules and upserts findings (dismissed findings stay dismissed).
2. **Approve a finding.** `POST /findings/{id}/approve` checks role, integration
   mode and tool policy, then records the approval and enqueues `execute_finding`. The
   executor re‑reads the resource first and only then applies the write tool. Once the
   result checks out, it keeps the rollback arguments and updates realized savings.
3. **Chat.** `POST /chat/threads/{id}/messages` streams a LangGraph run over SSE.
   Read tools run immediately. Write tools pause the run with an approval card;
   `POST /chat/threads/{id}/resume` continues it. `tool_end` events carry the first
   2,000 characters of each result so the console can show it in the trace. A thread
   can carry a `context` (for example the agent run it was opened from), which is
   added to the system prompt on every turn.
4. **Agent runs.** `GET /agents/sessions` lists conversations and scans as agent runs,
   along with approved changes; `GET /agents/sessions/{id}` returns one with every agent and
   step. `GET /inventory/graph` returns integrations → clusters → services for the
   Infrastructure map, and findings carry the `node_id` they belong to.

## Skills

Markdown files in `backend/martian/agents/skills/` are appended to the chat agent's
system prompt on every turn. `writing_style.md` condenses the two writing skills in
`.claude/skills/` (anti‑AI‑slop and rewrite) into rules for answers, including a
condensed copy of the banned word list. The short version: lead with the number and
ground it in a tool result.
The offline planner and the console's demo planner follow the same rules.

## Modes

- `MARTIAN_SANDBOX=true` on a connector serves deterministic demo data with the
  same tool contracts, so the whole product runs without cloud accounts.
- Without `ANTHROPIC_API_KEY` the chat agent falls back to a deterministic offline
  planner over the same tools (useful for demos and tests).
- `MARTIAN_DEMO_MODE=true` makes `GET /demo/config` tell the console to generate a
  sample company. The console uploads a snapshot of it before each chat turn, and the
  agent swaps its internal tools for demo tools that read that snapshot
  (`get_overview`, `list_findings`, `describe_topology`, `get_resource_telemetry`,
  `get_agent_session` and others). `approve_finding` still goes through the approval
  gate; `start_workflow` is read‑only. The forecast service stays real.

## Deployment

Every service ships as a container. Docker compose runs them on one host, and the
Terraform in `deploy/` puts them on AWS (ECS Fargate, RDS, ALB with WAF, KMS,
CloudFront). Customer‑side setup uses a Helm chart for the connector, plus a
least‑privilege access script for each cloud. See
[DEPLOYMENT.md](DEPLOYMENT.md).
