# Martian

**Agents That Eliminate Your Infrastructure Waste**

Martian's agents find idle and oversized resources across AWS, Azure, Google Cloud,
VMware and on‑premises servers, then make the change once a person has seen what it
costs and approved it. They also scale ahead of demand with an LSTM workload forecast.

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
- **Finds waste** with deterministic, tested rules. Idle compute and unattached volumes
  are the common ones; the rules also catch oversized databases, underused hosts,
  duplicate data and autoscaling groups the forecast says are too big.
- **Applies approved changes** as plans of MCP write calls. Each step records how to
  undo it. If a step fails, the earlier steps roll back. Integrations run in
  `read`, `ask` or `auto` (low‑risk only) mode.
- **Answers questions** in Quick Chat, a LangGraph agent with Claude. It uses the same
  tools, and write calls pause for an approval card. Every chat turn that calls tools
  becomes an agent run you can open on the **Agents** page: a map of what each agent
  touched and the full step‑by‑step trace, with a chat scoped to that run beside it.
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

`npm run dev` without `VITE_API_URL` runs the console on generated demo data with a
local chat planner, no backend needed.

### Demo data

With `MARTIAN_DEMO_MODE=true` (the default in `.env.example`, `scripts/dev.sh` and
docker compose) the console generates one of five sample companies with a fresh seed on
each visit, and every number keeps moving while you watch. Before each chat turn it
uploads a snapshot of that world (`PUT /demo/snapshot`), and the chat agent answers from
it, so Claude talks about what's on screen. Set it to `false` to show real inventory.

- `?variant=2` (1–5, or a name such as `helix`) and `?seed=123` pin the world.
- Settings → Demo data switches company or seed.

### Embedded demo

`npm run build:embed` writes a static, sign‑in‑free copy of the console to
`dist-embed/` with a fixed seed. It uses relative paths, so it works from any sub‑path
such as `/demo-app/`. See [docs/EMBED.md](docs/EMBED.md).

## Repository

| Path | What |
| --- | --- |
| `src/app` | Console data layer: `DemoStore` (generated world) and `LiveStore` (API), router with page transitions, chat hook, appearance settings |
| `src/demo` | Demo engine: five company templates, seeded generator, the tick that moves it, agent run timelines, local chat planner |
| `src/views` | One file per page, plus the agent run page (`AgentSession.tsx`) |
| `backend/martian/api` | FastAPI routes: auth/SSO, findings, approvals, integrations, connectors, chat (SSE), audit |
| `backend/martian/agents` | LangGraph chat graph with the approval gate, tool loading over MCP, demo tools, `skills/` appended to the system prompt |
| `backend/martian/scans` | Inventory collection and findings rules |
| `backend/martian/jobs` | Postgres job queue and the worker that also schedules scans |
| `backend/martian/forecast` | PyTorch LSTM with its training script and weights, served as MCP tools |
| `backend/migrations` | Alembic, including row‑level security policies |
| `mcp/src` | MCP servers per provider, sandbox provider, connector, gateway |
| `deploy/` | Terraform (AWS), connector Helm chart, customer onboarding templates, nginx |
| `.github/workflows` | CI (lint, tests, builds, infra checks) and deploy |
| `.claude/skills` | Writing skills (anti‑AI‑slop and rewrite) used for every user‑facing string |

## Tests

```bash
cd backend && uv run pytest        # needs Postgres; MARTIAN_TEST_PG overrides the admin URL
cd mcp && npm test
npx tsc --noEmit && npx vite build && npm run build:embed
```
