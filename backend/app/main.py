from fastapi import FastAPI

app = FastAPI(
    title="TechBaza Backend",
    version="0.1.0",
    description="Backend API платформи TechBaza IoT Pump Control",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "techbaza-backend",
        "version": "0.1.0",
    }
