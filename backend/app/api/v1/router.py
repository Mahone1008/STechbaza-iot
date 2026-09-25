from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.capabilities import router as capabilities_router
from app.api.v1.commands import router as commands_router
from app.api.v1.devices import router as devices_router
from app.api.v1.events import router as events_router
from app.api.v1.memberships import router as memberships_router
from app.api.v1.organizations import router as organizations_router
from app.api.v1.sites import router as sites_router
from app.api.v1.telemetry import router as telemetry_router

api_v1_router = APIRouter()
api_v1_router.include_router(auth_router)
api_v1_router.include_router(organizations_router)
api_v1_router.include_router(memberships_router)
api_v1_router.include_router(sites_router)
api_v1_router.include_router(devices_router)
api_v1_router.include_router(capabilities_router)
api_v1_router.include_router(telemetry_router)
api_v1_router.include_router(events_router)
api_v1_router.include_router(commands_router)
