#!/usr/bin/env bash
# Run the whole platform locally without Docker: Postgres (Homebrew), control plane,
# MCP gateway + sandbox connector, and the Vite console on http://localhost:5173.
# Ctrl+C stops everything. Logs go to .dev-logs/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/.dev-logs"
mkdir -p "$LOGS"
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

if [ -f "$ROOT/.env" ]; then
  set -a; source "$ROOT/.env"; set +a
fi
# Blank values in .env would override the dev defaults with empty strings.
for v in MARTIAN_SESSION_SECRET MARTIAN_INTERNAL_TOKEN MARTIAN_ENCRYPTION_KEY \
         MARTIAN_WORKOS_API_KEY MARTIAN_WORKOS_CLIENT_ID ANTHROPIC_API_KEY; do
  [ -z "${!v:-}" ] && unset "$v"
done
# MARTIAN_OFFLINE=1 ./scripts/dev.sh uses the deterministic planner instead of Claude.
[ "${MARTIAN_OFFLINE:-}" = 1 ] && unset ANTHROPIC_API_KEY

OWNER_PW="${MARTIAN_OWNER_DB_PASSWORD:-martian}"
export MARTIAN_APP_DB_PASSWORD="${MARTIAN_APP_DB_PASSWORD:-martian}"
export MARTIAN_INTERNAL_TOKEN="${MARTIAN_INTERNAL_TOKEN:-dev-internal-token-change-me}"
export MARTIAN_DATABASE_URL="postgresql+psycopg://martian_app:${MARTIAN_APP_DB_PASSWORD}@localhost/martian"
export MARTIAN_WEB_ORIGIN=http://localhost:5173
# Generated demo data (five sample companies, new seed per visit). Set false in .env for real inventory.
export MARTIAN_DEMO_MODE="${MARTIAN_DEMO_MODE:-true}"
CONNECTOR_TOKEN="${MARTIAN_DEMO_CONNECTOR_TOKEN:-mct_demo_sandbox_connector_token_do_not_use_in_production}"

brew services start postgresql@16 >/dev/null
until pg_isready -q; do sleep 0.5; done
psql -q -d postgres -v ON_ERROR_STOP=1 -v pw="$OWNER_PW" <<'SQL'
SELECT 'CREATE ROLE martian_owner LOGIN CREATEROLE PASSWORD ' || quote_literal(:'pw') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='martian_owner') \gexec
SELECT 'CREATE DATABASE martian OWNER martian_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='martian') \gexec
SQL

pids=()
trap 'kill "${pids[@]}" 2>/dev/null; wait' EXIT INT TERM

cd "$ROOT/backend"
MARTIAN_MIGRATION_DATABASE_URL="postgresql+psycopg://martian_owner:${OWNER_PW}@localhost/martian" \
  MARTIAN_SEED_DEMO="${MARTIAN_SEED_DEMO:-true}" uv run martian-migrate
uv run martian-api >"$LOGS/api.log" 2>&1 & pids+=($!)
uv run martian-forecast >"$LOGS/forecast.log" 2>&1 & pids+=($!)

cd "$ROOT/mcp"
node dist/gateway.js >"$LOGS/gateway.log" 2>&1 & pids+=($!)
until curl -s -o /dev/null localhost:8000/health 2>/dev/null || curl -s -o /dev/null localhost:8000/; do sleep 0.5; done
sleep 1
MARTIAN_SANDBOX=true MARTIAN_CONNECTOR_TOKEN="$CONNECTOR_TOKEN" \
  node dist/connector.js >"$LOGS/connector.log" 2>&1 & pids+=($!)
until grep -q "connector online" "$LOGS/gateway.log"; do sleep 0.5; done

# Start the worker after the connector is online so its first scan can reach it.
cd "$ROOT/backend"
uv run martian-worker >"$LOGS/worker.log" 2>&1 & pids+=($!)

cd "$ROOT"
VITE_API_URL=/api npx vite --port 5173 --strictPort >"$LOGS/web.log" 2>&1 & pids+=($!)

echo "Martian running at http://localhost:5173  (admin@company.com / admin123). Logs: $LOGS"
wait
