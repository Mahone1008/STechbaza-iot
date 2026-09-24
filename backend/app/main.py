from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.router import api_v1_router
from app.db import check_database
from app.mqtt_client import (
    last_ingestion_result,
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
    version="0.8.0",
    description="Backend API платформи TechBaza IoT Pump Control",
    lifespan=lifespan,
)

app.include_router(api_v1_router, prefix="/api/v1")


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "techbaza-backend",
        "version": "0.8.0",
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
