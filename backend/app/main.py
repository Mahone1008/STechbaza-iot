from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.router import api_v1_router
from app.db import check_database
from app.security.diagnostics import require_diagnostics_access
from app.security.browser_config import AUTH_BROWSER_ORIGINS, CSRF_HEADER
from app.security.browser_auth import AuthNoStoreMiddleware
from app.mqtt_client import (
    last_command_ack_result,
    last_command_publish_result,
    last_command_result_result,
    last_heartbeat_result,
    last_ingestion_result,
    last_mqtt_message,
    mqtt_status,
    start_mqtt,
    stop_mqtt,
)
from app.services.command_reliability import (
    command_reliability_status,
    start_command_reliability_worker,
    stop_command_reliability_worker,
)
from app.services.system_alarm_worker import (
    start_system_alarm_worker,
    stop_system_alarm_worker,
    system_alarm_status,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_mqtt()
    start_command_reliability_worker()
    start_system_alarm_worker()
    yield
    stop_system_alarm_worker()
    stop_command_reliability_worker()
    stop_mqtt()


app = FastAPI(
    title="TechBaza Backend",
    version="0.36.0",
    description="Backend API платформи TechBaza IoT Pump Control",
    lifespan=lifespan,
)

app.include_router(api_v1_router, prefix="/api/v1")

app.add_middleware(CORSMiddleware, allow_origins=list(AUTH_BROWSER_ORIGINS),
                   allow_credentials=True, allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
                   allow_headers=["Authorization", "Content-Type", CSRF_HEADER],
                   expose_headers=["Retry-After"])
app.add_middleware(AuthNoStoreMiddleware)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    if request.url.path.startswith("/api/v1/auth/"):
        # Стандартна validation response містить input: password/refresh не
        # повинні повертатися клієнту чи потрапляти до журналів його помилок.
        return JSONResponse({"detail": "Некоректний формат auth-запиту"}, status_code=422)
    return await request_validation_exception_handler(request, exc)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "techbaza-backend",
        "version": "0.36.0",
    }


@app.get("/health/db", dependencies=[Depends(require_diagnostics_access)])
def database_health() -> dict[str, object]:
    try:
        database = check_database()
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="PostgreSQL недоступний",
        ) from exc

    return {
        "status": "ok",
        "postgresql": database,
    }


@app.get("/health/mqtt", dependencies=[Depends(require_diagnostics_access)])
def mqtt_health() -> dict[str, Any]:
    status = mqtt_status()

    if not status["connected"]:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "MQTT broker недоступний",
                **status,
            },
        )

    return {
        "status": "ok",
        "mqtt": status,
    }


@app.get("/mqtt/last", dependencies=[Depends(require_diagnostics_access)])
def mqtt_last_message() -> dict[str, Any]:
    return {
        "status": "ok",
        "message": last_mqtt_message(),
    }


@app.get("/mqtt/ingestion/last", dependencies=[Depends(require_diagnostics_access)])
def mqtt_last_ingestion() -> dict[str, Any]:
    return {
        "status": "ok",
        "ingestion": last_ingestion_result(),
    }


@app.get("/mqtt/heartbeat/last", dependencies=[Depends(require_diagnostics_access)])
def mqtt_last_heartbeat() -> dict[str, Any]:
    return {
        "status": "ok",
        "heartbeat": last_heartbeat_result(),
    }


@app.get("/mqtt/command/last", dependencies=[Depends(require_diagnostics_access)])
def mqtt_last_command_publish() -> dict[str, Any]:
    return {
        "status": "ok",
        "command_publish": last_command_publish_result(),
    }


@app.get("/mqtt/command/ack/last", dependencies=[Depends(require_diagnostics_access)])
def mqtt_last_command_ack() -> dict[str, Any]:
    return {
        "status": "ok",
        "command_ack": last_command_ack_result(),
    }


@app.get("/mqtt/command/result/last", dependencies=[Depends(require_diagnostics_access)])
def mqtt_last_command_result() -> dict[str, Any]:
    return {
        "status": "ok",
        "command_result": last_command_result_result(),
    }


@app.get("/command/reliability/status", dependencies=[Depends(require_diagnostics_access)])
def command_reliability() -> dict[str, Any]:
    return {
        "status": "ok",
        "worker": command_reliability_status(),
    }


@app.get("/system/alarms/status", dependencies=[Depends(require_diagnostics_access)])
def system_alarms() -> dict[str, Any]:
    return {
        "status": "ok",
        "worker": system_alarm_status(),
    }
