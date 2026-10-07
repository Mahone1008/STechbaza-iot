from fastapi import APIRouter

from app.api.v1.alarms import router as alarms_router
from app.api.v1.auth import router as auth_router
from app.api.v1.capabilities import router as capabilities_router
from app.api.v1.commands import router as commands_router
from app.api.v1.devices import router as devices_router
from app.api.v1.events import router as events_router
from app.api.v1.frontend import router as frontend_router
from app.api.v1.memberships import router as memberships_router
from app.api.v1.notifications import router as notifications_router
from app.api.v1.organizations import router as organizations_router
from app.api.v1.sites import router as sites_router
from app.api.v1.telemetry import router as telemetry_router
from app.api.v1.schedules import router as schedules_router
from app.api.v1.equipment import router as equipment_router
from app.api.v1.personal_accounts import router as personal_accounts_router
from app.api.v1.control_mode import router as control_mode_router

api_v1_router = APIRouter()
api_v1_router.include_router(auth_router)
api_v1_router.include_router(organizations_router)
api_v1_router.include_router(memberships_router)
api_v1_router.include_router(sites_router)
api_v1_router.include_router(devices_router)
api_v1_router.include_router(control_mode_router)
api_v1_router.include_router(capabilities_router)
api_v1_router.include_router(telemetry_router)
api_v1_router.include_router(events_router)
api_v1_router.include_router(alarms_router)
api_v1_router.include_router(notifications_router)
api_v1_router.include_router(commands_router)
api_v1_router.include_router(frontend_router)
api_v1_router.include_router(schedules_router)
api_v1_router.include_router(equipment_router)
api_v1_router.include_router(personal_accounts_router)

from app.api.v1.account_security import router as account_security_router
from app.api.v1.onboarding import router as onboarding_router
api_v1_router.include_router(account_security_router)
from app.security.plane import APP_PLANE
if APP_PLANE == "customer":
    selected = APIRouter()
    selected.routes = [route for route in onboarding_router.routes if not route.path.startswith("/factory/")]
    api_v1_router.include_router(selected)
else:
    api_v1_router.include_router(onboarding_router)
