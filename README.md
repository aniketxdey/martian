# Martian

Agentic infrastructure optimization. Martian finds idle and oversized resources across
AWS, Azure, Google Cloud, VMware and on‑premises servers, explains the savings, and
applies changes after a person approves them. It also scales ahead of demand using an
LSTM workload forecast.

**Stack:** Python (FastAPI, LangGraph, SQLAlchemy, PyTorch) · Node.js (MCP servers,
connector, gateway) · React + TypeScript console · Postgres · Claude as the reasoning
model.

```
browser ─▶ web ─▶ api ──┬─ Postgres (data, job queue, agent checkpoints, audit log)
                        ├─ worker (scans, approved changes, scheduler)
                        ├─ LangGraph agent ── Claude
                        ├─ forecast (PyTorch LSTM, MCP tools)
                        └─ gateway ◀── outbound WebSocket ── connector (customer network)
                                                              └ MCP: aws · azure · gcp · vcenter · ssh
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) to run it for a customer.

## What it does

- **Discovers** inventory and 14‑day utilization through MCP tools that run on a
  connector inside the customer's network, using the customer's own cloud identity.
- **Finds waste** with deterministic, tested rules: idle compute, unattached volumes,
  old snapshots, oversized databases, idle load balancers and NAT gateways,
  underused hosts, duplicate data, and forecast‑driven autoscaling changes.
- **Applies approved changes** as plans of MCP write calls. Each step records how to
  undo it. If a step fails, the earlier steps roll back. Integrations run in
  `read`, `ask` or `auto` (low‑risk only) mode.
- **Answers questions** in Ask Martian, a LangGraph agent with Claude. It uses the same
  tools, and write calls pause for an approval card.
- **Records everything** in a hash‑chained, append‑only audit log.

## Run it locally

With Docker:

```bash
cp .env.example .env
docker compose up --build
open http://localhost:8080            # admin@company.com / admin123
```

This starts the whole platform with a **sandbox connector**: deterministic
infrastructure behind the real tool contracts. Set `ANTHROPIC_API_KEY` in `.env` to
use Claude; without it, chat uses a deterministic offline planner.

Without Docker (Postgres 16 on localhost):

```bash
# control plane
cd backend && uv sync --all-extras
MARTIAN_MIGRATION_DATABASE_URL=postgresql+psycopg://martian_owner:martian@localhost/martian \
MARTIAN_APP_DB_PASSWORD=martian MARTIAN_SEED_DEMO=true uv run martian-migrate
uv run martian-api & uv run martian-worker & uv run martian-forecast &

# MCP layer
cd ../mcp && npm ci && npm run build
MARTIAN_INTERNAL_TOKEN=dev-internal-token-change-me node dist/gateway.js &
MARTIAN_SANDBOX=true MARTIAN_CONNECTOR_TOKEN=mct_demo_sandbox_connector_token_do_not_use_in_production node dist/connector.js &

# console against the API (Vite proxies /api → :8000)
cd .. && npm install && VITE_API_URL=/api npm run dev
```

`npm run dev` without `VITE_API_URL` runs the console on built‑in demo data.

## Repository

| Path | What |
| --- | --- |
| `src/` | Console (React, Vite, Tailwind). `src/state/useLiveData.ts` etc. talk to the API |
| `backend/martian/api` | FastAPI routes: auth/SSO, findings, approvals, integrations, connectors, chat (SSE), audit |
| `backend/martian/agents` | LangGraph chat graph with the approval gate, tool loading over MCP |
| `backend/martian/scans` | Inventory collection and findings rules |
| `backend/martian/jobs` | Postgres job queue, worker and scheduler |
| `backend/martian/forecast` | PyTorch LSTM, training script, weights and the MCP server |
| `backend/migrations` | Alembic, including row‑level security policies |
| `mcp/src` | MCP servers per provider, sandbox provider, connector, gateway |
| `deploy/` | Terraform (AWS), connector Helm chart, customer onboarding templates, nginx |
| `.github/workflows` | CI (lint, tests, builds, infra checks) and deploy |

## Tests

```bash
cd backend && uv run pytest        # needs Postgres; MARTIAN_TEST_PG overrides the admin URL
cd mcp && npm test
npx tsc --noEmit && npx vite build
```
