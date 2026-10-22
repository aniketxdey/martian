# syntax=docker/dockerfile:1.7
# MCP layer. Two published images from one build:
#   --target gateway   → ghcr.io/aniketxdey/martian-gateway    (control plane, port 8787)
#   --target connector → ghcr.io/aniketxdey/martian-connector  (customer side; dials out, no inbound ports)

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /src/node_modules ./node_modules
COPY --from=build --chown=node:node /src/dist ./dist
COPY --chown=node:node package.json ./
USER node

FROM runtime AS connector
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/connector.js"]

# Last stage is the default build target.
FROM runtime AS gateway
ENV PORT=8787
EXPOSE 8787
CMD ["node", "dist/gateway.js"]
