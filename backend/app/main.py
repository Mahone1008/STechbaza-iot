from fastapi import FastAPI, HTTPException
from sqlalchemy.exc import SQLAlchemyError

from app.db import check_database

app = FastAPI(
    title="TechBaza Backend",
    version="0.2.0",
    description="Backend API платформи TechBaza IoT Pump Control",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "techbaza-backend",
        "version": "0.2.0",
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
