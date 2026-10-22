# syntax=docker/dockerfile:1.7
# Control plane image. One image, three processes:
#   api      → martian-api            (FastAPI, port 8000)
#   worker   → martian-worker         (job queue, scans, executions)
#   migrate  → martian-migrate        (one-shot: app role + alembic upgrade)
# The forecast service has its own target because it carries PyTorch.

ARG PYTHON_VERSION=3.12

FROM python:${PYTHON_VERSION}-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never \
    PATH="/app/.venv/bin:$PATH"
WORKDIR /app
RUN groupadd --system --gid 10001 martian && useradd --system --uid 10001 --gid martian --home /app martian

FROM base AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv
# Dependencies first so code changes do not invalidate the layer.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --extra kms --no-install-project
COPY alembic.ini ./
COPY migrations ./migrations
COPY martian ./martian
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --extra kms

FROM base AS app
COPY --from=build --chown=martian:martian /app /app
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status == 200 else 1)"
ENV MARTIAN_ENV=production
CMD ["martian-api"]

# Forecast: CPU-only PyTorch wheels keep the image ~5x smaller than the default CUDA build.
FROM base AS forecast-build
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project && \
    uv pip install --python /app/.venv/bin/python "torch>=2.4" "numpy>=1.26" \
      --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple
COPY martian ./martian
RUN --mount=type=cache,target=/root/.cache/uv uv pip install --python /app/.venv/bin/python --no-deps -e .

FROM base AS forecast
COPY --from=forecast-build --chown=martian:martian /app /app
USER 10001
EXPOSE 8790
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8790/healthz', timeout=2).status == 200 else 1)"
CMD ["martian-forecast"]
