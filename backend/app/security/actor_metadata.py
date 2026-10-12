"""Credential-free lookup for the customer worker under production database RLS."""
from types import SimpleNamespace

from sqlalchemy import text
from sqlalchemy import select
from app.models.user import User

from app.security.plane import APP_PLANE


def customer_actor_metadata(session, user_id):
    if APP_PLANE != "customer" or session.scalar(text("SELECT current_user")) != "kerumo_customer":
        return None
    row = session.execute(text("SELECT * FROM public.customer_actor_metadata(:id)"), {"id": user_id}).mappings().first()
    return SimpleNamespace(**row) if row else None


def installer_by_email(session, email):
    if APP_PLANE == "customer" and session.scalar(text("SELECT current_user")) == "kerumo_customer":
        row = session.execute(text("SELECT * FROM public.customer_installer_metadata(:email)"), {"email": email}).mappings().first()
        return SimpleNamespace(**row) if row else None
    return session.scalar(select(User).where(User.email == email, User.is_active,
        User.platform_role.in_(("service_admin", "superadmin")), User.email_verified_at.is_not(None)))
