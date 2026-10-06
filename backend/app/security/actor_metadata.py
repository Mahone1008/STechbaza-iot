"""Credential-free lookup for the customer worker under production database RLS."""
from types import SimpleNamespace

from sqlalchemy import text

from app.security.plane import APP_PLANE


def customer_actor_metadata(session, user_id):
    if APP_PLANE != "customer" or session.scalar(text("SELECT current_user")) != "kerumo_customer":
        return None
    row = session.execute(text("SELECT * FROM public.customer_actor_metadata(:id)"), {"id": user_id}).mappings().first()
    return SimpleNamespace(**row) if row else None
