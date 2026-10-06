"""Durable business audit and secret-free JSON request logs."""

import json
import logging
import time
import uuid

from app.db import SessionLocal
from app.models.platform_audit import PlatformAudit
from app.security.tokens import utc_now

logger = logging.getLogger("kerumo.requests")
REQUEST_METRICS = {"requests": 0, "errors": 0, "received_bytes": 0, "sent_bytes": 0}


def audit(session, request, current, action, resource_type, resource_id, details=None):
    session.add(PlatformAudit(
        occurred_at=utc_now(), actor_user_id=current.user.id if current else None,
        actor_session_id=current.auth_session.id if current else None,
        action=action, resource_type=resource_type, resource_id=str(resource_id) if resource_id else None,
        request_id=getattr(request.state, "request_id", str(uuid.uuid4())),
        client_ip=request.client.host if request.client else None, status=200,
        details=details or {},
    ))


class RequestAuditMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        measured = not scope["path"].startswith(("/_internal/", "/health"))
        if measured:
            REQUEST_METRICS["requests"] += 1
        started = time.monotonic()
        request_id = str(uuid.uuid4())
        state = scope.setdefault("state", {})
        state["request_id"] = request_id
        response_status = 500

        async def receive_counted():
            message = await receive()
            if measured and message["type"] == "http.request":
                REQUEST_METRICS["received_bytes"] += len(message.get("body", b""))
            return message

        async def send_response(message):
            nonlocal response_status
            if message["type"] == "http.response.start":
                response_status = message["status"]
                if measured and response_status >= 400:
                    REQUEST_METRICS["errors"] += 1
                message = {**message, "headers": message.get("headers", []) + [(b"x-request-id", request_id.encode())]}
            if measured and message["type"] == "http.response.body":
                REQUEST_METRICS["sent_bytes"] += len(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, receive_counted, send_response)
        finally:
            route = getattr(scope.get("route"), "path", "unmatched")
            # Log the route template, never query strings, body, token or raw unknown path.
            entry = dict(request_id=request_id, method=scope["method"], route=route,
                         status=response_status, duration_ms=round((time.monotonic()-started)*1000),
                         client_ip=scope["client"][0] if scope.get("client") else None)
            logger.info(json.dumps(entry, ensure_ascii=False))
            auth_event = scope["path"].endswith(("/login", "/logout", "/recover")) and scope["path"].startswith("/api/v1/auth/")
            staff_mutation = scope["method"] in ("POST", "PUT", "PATCH", "DELETE") and bool(state.get("audit_user_id"))
            if auth_event or staff_mutation:
                try:
                    with SessionLocal.begin() as session:
                        session.add(PlatformAudit(
                            occurred_at=utc_now(), actor_user_id=state.get("audit_user_id"),
                            actor_session_id=state.get("audit_session_id"),
                            action="http."+scope["method"].lower(), resource_type="request",
                            resource_id=None, request_id=request_id, client_ip=entry["client_ip"],
                            status=response_status, details={"route": route, "duration_ms": entry["duration_ms"], "resources": {k: str(v) for k, v in scope.get("path_params", {}).items() if k.endswith("_id")}},
                        ))
                except Exception:
                    # Mutating staff business operations include an atomic audit themselves.
                    logger.error(json.dumps({"request_id": request_id, "event": "request_audit_unavailable"}))
