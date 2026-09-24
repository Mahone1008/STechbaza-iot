from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from sqlalchemy.exc import SQLAlchemyError

from app.db import check_database
from app.mqtt_client import (
    last_mqtt_message,
    mqtt_status,
    start_mqtt,
    stop_mqtt,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_mqtt()
    yield
    stop_mqtt()


app = FastAPI(
    title="TechBaza Backend",
    version="0.3.0",
    description="Backend API платформи TechBaza IoT Pump Control",
    lifespan=lifespan,
)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "techbaza-backend",
        "version": "0.3.0",
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
