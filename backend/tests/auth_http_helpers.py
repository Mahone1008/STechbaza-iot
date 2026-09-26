"""Мінімальний ASGI клієнт: зберігає всі response headers, зокрема cookie."""

import asyncio
import json
from http.cookies import SimpleCookie
from urllib.parse import urlsplit

from app.main import app
from app.security.browser_config import REFRESH_COOKIE_NAME


def request(method, path, *, body=None, headers=None, ip="198.18.0.1"):
    async def run():
        messages = []
        raw = json.dumps(body).encode() if body is not None else b""
        request_headers = {"host": "127.0.0.1:8000", **(headers or {})}
        if body is not None:
            request_headers.setdefault("content-type", "application/json")
        target = urlsplit(path)
        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": method, "scheme": "http", "path": target.path,
            "raw_path": target.path.encode(), "root_path": "",
            "query_string": target.query.encode(),
            "headers": [(k.lower().encode(), v.encode()) for k, v in request_headers.items()],
            "client": (ip, 1234), "server": ("127.0.0.1", 8000),
        }
        sent = False

        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": raw, "more_body": False}
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)

        await app(scope, receive, send)
        start = next(m for m in messages if m["type"] == "http.response.start")
        payload = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
        response_headers = {k.decode(): v.decode() for k, v in start["headers"]}
        try:
            result = json.loads(payload) if payload else None
        except ValueError:
            result = payload.decode()
        return start["status"], result, response_headers

    return asyncio.run(run())


def refresh_cookie(headers):
    jar = SimpleCookie()
    jar.load(headers["set-cookie"])
    return jar[REFRESH_COOKIE_NAME]
