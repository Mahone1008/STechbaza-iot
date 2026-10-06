"""A deployment selects one trust plane; staff credentials never work on customer API."""

import os

APP_PLANE = os.getenv("APP_PLANE", "demo")
if APP_PLANE not in ("demo", "customer", "staff"):
    raise RuntimeError("APP_PLANE must be demo, customer or staff")
STAFF_ROLES = ("superadmin", "service_admin")
