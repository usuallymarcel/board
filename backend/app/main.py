"""Application factory: `uvicorn app.main:create_app --factory`."""
import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.auth import AuthGateway, RateLimiter
from app.config import Settings
from app.db import Database
from app.middleware import GuardMiddleware
from app.routes import auth, boards, collections, files, forum, frontend, items, misc, notes, secrets, shares
from app.routes.items import purge_expired_items
from app.routes.secrets import purge_expired_secrets
from app.storage import clean_tmp

logging.basicConfig(level=logging.INFO, format='%(levelname)s %(name)s: %(message)s')
logging.getLogger('httpx').setLevel(logging.WARNING)  # Otherwise a line per health probe.
log = logging.getLogger(__name__)


def run_maintenance(app: FastAPI) -> None:
    with app.state.db.write() as db:
        items_removed = purge_expired_items(db, app.state.settings)
        secrets_removed = purge_expired_secrets(db)
        db.commit()
    if items_removed or secrets_removed:
        log.info('maintenance: %s items, %s secrets', items_removed, secrets_removed)


async def maintenance_loop(app: FastAPI) -> None:
    while True:
        try:
            await run_in_threadpool(run_maintenance, app)
        except Exception:
            log.exception('maintenance failed')
        await asyncio.sleep(app.state.settings.maintenance_interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    state = app.state
    state.settings.ensure_dirs()
    await run_in_threadpool(clean_tmp, state.settings)
    auth_watch = asyncio.create_task(state.auth.watch())
    maintenance = asyncio.create_task(maintenance_loop(app))
    yield
    auth_watch.cancel()
    maintenance.cancel()
    await state.auth.aclose()
    state.db.dispose()


async def http_error(_request: Request, error: HTTPException) -> JSONResponse:
    return JSONResponse({'error': str(error.detail)}, status_code=error.status_code, headers=error.headers)


async def validation_error(_request: Request, error: RequestValidationError) -> JSONResponse:
    first = error.errors()[0]
    field = '.'.join(str(part) for part in first['loc'] if part != 'body')
    return JSONResponse({'error': f'{field}: {first["msg"]}' if field else first['msg']}, status_code=422)


async def unexpected_error(_request: Request, error: Exception) -> JSONResponse:
    log.error('unhandled error', exc_info=error)
    return JSONResponse({'error': 'Something went wrong.'}, status_code=500)


def create_app(settings: Settings | None = None, users_transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.ensure_dirs()

    app = FastAPI(title='Board', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.db = Database(settings.database_url)
    app.state.auth = AuthGateway(settings, transport=users_transport)
    app.state.signing_key = settings.signing_key()
    app.state.login_limiter = RateLimiter(settings.login_rate_limit, settings.login_rate_window)
    app.state.public_limiter = RateLimiter(settings.public_rate_limit, 60.0)
    app.state.forum_limiter = RateLimiter(settings.forum_rate_limit, 60.0)

    app.add_exception_handler(HTTPException, http_error)
    app.add_exception_handler(RequestValidationError, validation_error)
    app.add_exception_handler(Exception, unexpected_error)
    app.add_middleware(GuardMiddleware, trusted_origins=settings.trusted_origins)

    for module in (misc, auth, collections, items, notes, boards, files, shares, secrets, forum):
        app.include_router(module.router)
    app.include_router(frontend.router)  # catch-all, must stay last
    return app
