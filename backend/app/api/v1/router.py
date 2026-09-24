from fastapi import APIRouter

from app.api.v1.organizations import router as organizations_router

api_v1_router = APIRouter()
api_v1_router.include_router(organizations_router)
