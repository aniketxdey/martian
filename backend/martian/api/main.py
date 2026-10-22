from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from martian.agents.chat import close_checkpointer, get_checkpointer
from martian.api.routes import auth, chat, core, integrations, internal, inventory, org, servers
from martian.config import get_settings
from martian.db.base import dispose_engine, get_engine
from martian.services.findings import FindingStateError
from martian.services.policy import PolicyError


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer()
            if get_settings().is_production
            else structlog.dev.ConsoleRenderer(colors=False),
        ]
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    settings.validate_for_production()
    configure_logging()
    await get_checkpointer()
    yield
    await close_checkpointer()
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Martian API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/docs",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        structlog.contextvars.bind_contextvars(request_id=request_id)
        start = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        if request.url.path not in {"/healthz", "/readyz"}:
            structlog.get_logger().info(
                "request",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                ms=round((time.perf_counter() - start) * 1000),
            )
        structlog.contextvars.clear_contextvars()
        return response

    @app.exception_handler(PolicyError)
    async def _policy(_: Request, exc: PolicyError):
        return JSONResponse({"detail": str(exc)}, status_code=403)

    @app.exception_handler(LookupError)
    async def _missing(_: Request, exc: LookupError):
        return JSONResponse({"detail": str(exc).strip("'")}, status_code=404)

    @app.exception_handler(FindingStateError)
    async def _state(_: Request, exc: FindingStateError):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> dict:
        return {"ok": True}

    @app.get("/readyz", include_in_schema=False)
    async def readyz() -> dict:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"ok": True}

    for r in (auth, core, inventory, integrations, servers, chat, org, internal):
        app.include_router(r.router)
    return app


app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run(
        "martian.api.main:app", host="0.0.0.0", port=8000, proxy_headers=True, forwarded_allow_ips="*"
    )
