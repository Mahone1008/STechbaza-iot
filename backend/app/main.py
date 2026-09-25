from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.router import api_v1_router
from app.db import check_database
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
    version="0.28.0",
    description="Backend API платформи TechBaza IoT Pump Control",
    lifespan=lifespan,
)

app.include_router(api_v1_router, prefix="/api/v1")


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "techbaza-backend",
        "version": "0.28.0",
    }


@app.get("/health/db")
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


@app.get("/health/mqtt")
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


@app.get("/mqtt/last")
def mqtt_last_message() -> dict[str, Any]:
    return {
        "status": "ok",
        "message": last_mqtt_message(),
    }


@app.get("/mqtt/ingestion/last")
def mqtt_last_ingestion() -> dict[str, Any]:
    return {
        "status": "ok",
        "ingestion": last_ingestion_result(),
    }


@app.get("/mqtt/heartbeat/last")
def mqtt_last_heartbeat() -> dict[str, Any]:
    return {
        "status": "ok",
        "heartbeat": last_heartbeat_result(),
    }


@app.get("/mqtt/command/last")
def mqtt_last_command_publish() -> dict[str, Any]:
    return {
        "status": "ok",
        "command_publish": last_command_publish_result(),
    }


@app.get("/mqtt/command/ack/last")
def mqtt_last_command_ack() -> dict[str, Any]:
    return {
        "status": "ok",
        "command_ack": last_command_ack_result(),
    }


@app.get("/mqtt/command/result/last")
def mqtt_last_command_result() -> dict[str, Any]:
    return {
        "status": "ok",
        "command_result": last_command_result_result(),
    }


@app.get("/command/reliability/status")
def command_reliability() -> dict[str, Any]:
    return {
        "status": "ok",
        "worker": command_reliability_status(),
    }


@app.get("/system/alarms/status")
def system_alarms() -> dict[str, Any]:
    return {
        "status": "ok",
        "worker": system_alarm_status(),
    }
