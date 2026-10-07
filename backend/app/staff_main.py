"""Separate ASGI application for the VPN-only administration and service portal."""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1 import (account_security, alarms, auth, capabilities, commands, devices,
                        equipment, events, frontend, memberships, notifications,
                        onboarding, organizations, personal_accounts, schedules, sites, staff, telemetry)
from app.security.browser_auth import AuthNoStoreMiddleware
from app.security.browser_config import AUTH_BROWSER_ORIGINS, CSRF_HEADER
from app.security.plane import APP_PLANE
from app.services.account_security import AccountSecurityConflict, InvalidAccountProof
from app.security.account_keys import AccountKeyUnavailableError
from app.services.controller_broker import BrokerUnavailable
from app.services.platform_audit import RequestAuditMiddleware


@asynccontextmanager
async def lifespan(app):
    if APP_PLANE != "staff":
        raise RuntimeError("staff_main must run with APP_PLANE=staff")
    # A publish-only connection supports existing safe device actions. Only the
    # customer worker consumes telemetry/results and runs scheduling/alarm workers.
    from app.mqtt_client import start_mqtt, stop_mqtt
    start_mqtt()
    yield
    stop_mqtt()


app = FastAPI(title="KERUMO Operations", version="0.51.0", lifespan=lifespan)
for router in (auth.router, account_security.router):
    app.include_router(router, prefix="/api/v1")
for router in (staff.router, organizations.router,
               memberships.router, sites.router, devices.router, capabilities.router,
               alarms.router, commands.router, equipment.router, events.router,
               frontend.router, notifications.router, schedules.router, telemetry.router):
    app.include_router(router, prefix="/api/v1", dependencies=[Depends(staff.require_staff)])
# Manufacturing and invitation administration are private. Registration,
# activation/bootstrap and invitation acceptance stay in the customer app.
for router, prefix in ((onboarding.router, "/factory/"), (personal_accounts.router, "/organizations/")):
    from fastapi import APIRouter
    selected = APIRouter()
    selected.routes = [route for route in router.routes if route.path.startswith(prefix)]
    app.include_router(selected, prefix="/api/v1", dependencies=[Depends(staff.require_staff)])

app.add_middleware(CORSMiddleware, allow_origins=list(AUTH_BROWSER_ORIGINS),
                   allow_credentials=True, allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
                   allow_headers=["Authorization", "Content-Type", CSRF_HEADER], expose_headers=["Retry-After", "X-Request-ID"])
app.add_middleware(AuthNoStoreMiddleware)
app.add_middleware(RequestAuditMiddleware)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc):
    return JSONResponse({"detail": "Перевірте заповнення полів"}, status_code=422, headers={"Cache-Control": "no-store"})


@app.exception_handler(AccountSecurityConflict)
async def conflict(request: Request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=409, headers={"Cache-Control": "no-store"})


@app.exception_handler(InvalidAccountProof)
async def invalid_proof(request: Request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=401, headers={"Cache-Control": "no-store"})


@app.exception_handler(AccountKeyUnavailableError)
@app.exception_handler(BrokerUnavailable)
@app.exception_handler(SQLAlchemyError)
async def temporarily_unavailable(request: Request, exc):
    return JSONResponse({"detail": "Операція тимчасово недоступна. Повторіть пізніше"}, status_code=503, headers={"Cache-Control": "no-store"})


@app.get("/health")
def health():
    return {"status": "ok", "service": "kerumo-operations", "version": "0.51.0"}
