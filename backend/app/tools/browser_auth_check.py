"""Перевірка справжнім Chromium на ізольованій БД з тимчасовими HTTP servers.

TECHBAZA_RUN_BROWSER_TESTS=1 python -m app.tools.browser_auth_check
Потрібні requirements-browser-tests.txt та playwright install chromium.
"""

import os
import secrets
import socket
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def main():
    if os.getenv("TECHBAZA_RUN_BROWSER_TESTS") != "1":
        raise SystemExit("Потрібен явний TECHBAZA_RUN_BROWSER_TESTS=1 та ізольована тестова БД")

    class Page(BaseHTTPRequestHandler):
        def do_GET(self):
            body = b"<!doctype html><html><title>TechBaza auth test</title><body>Isolated browser test</body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    frontend = ThreadingHTTPServer(("127.0.0.1", 0), Page)
    foreign = ThreadingHTTPServer(("127.0.0.1", 0), Page)
    for server in (frontend, foreign):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{frontend.server_port}"
    os.environ["AUTH_BROWSER_ORIGINS"] = origin
    os.environ["AUTH_COOKIE_SECURE"] = "false"

    import uvicorn
    from playwright.sync_api import sync_playwright
    from sqlalchemy import delete
    from app.db import SessionLocal
    from app.main import app
    from app.models.user import User
    from app.models.auth_rate_limit import AuthRateLimit
    from app.security.passwords import hash_password
    from app.security.browser_config import REFRESH_COOKIE_NAME
    from app.services.auth_throttle import rate_key

    user_id = uuid.uuid4()
    email = f"chromium-{user_id.hex}@example.com"
    password = secrets.token_urlsafe(32)
    api_socket = socket.socket()
    api_socket.bind(("127.0.0.1", 0))
    api = f"http://127.0.0.1:{api_socket.getsockname()[1]}"
    server = uvicorn.Server(uvicorn.Config(app, lifespan="off", proxy_headers=False, log_level="error"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [api_socket]}, daemon=True)
    try:
        with SessionLocal() as session:
            session.add(User(id=user_id, email=email, display_name="Chromium test",
                             password_hash=hash_password(password), platform_role="user", is_active=True))
            session.commit()
        thread.start()
        for _ in range(100):
            if server.started:
                break
            time.sleep(0.05)
        if not server.started:
            raise RuntimeError("Тестовий API не запустився")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context()
            page = context.new_page()
            page.goto(origin)

            def call(action, body=None, csrf=True):
                return page.evaluate("""async ({api, action, body, csrf}) => {
                    const headers = csrf ? {'X-TechBaza-CSRF': '1'} : {};
                    if (body) headers['Content-Type'] = 'application/json';
                    const r = await fetch(api + '/api/v1/auth/browser/' + action, {
                        method: 'POST', credentials: 'include', headers,
                        body: body ? JSON.stringify(body) : undefined
                    });
                    return {status: r.status, body: r.status === 204 ? null : await r.json()};
                }""", {"api": api, "action": action, "body": body, "csrf": csrf})

            result = call("login", {"email": email, "password": password})
            assert result["status"] == 200, result["status"]
            assert "refresh_token" not in result["body"]
            cookies = [c for c in context.cookies() if c["name"] == REFRESH_COOKIE_NAME]
            assert len(cookies) == 1 and cookies[0]["httpOnly"] and cookies[0]["sameSite"] == "Strict"
            old_cookie = cookies[0]["value"]
            assert cookies[0]["path"] == "/api/v1/auth/browser"
            probe = context.new_page()
            probe.goto(api + "/api/v1/auth/browser/probe")
            assert REFRESH_COOKIE_NAME not in probe.evaluate("document.cookie")
            probe.close()
            page.reload()
            result = call("refresh")
            assert result["status"] == 200
            access = result["body"]["access_token"]
            assert next(c for c in context.cookies() if c["name"] == REFRESH_COOKIE_NAME)["value"] != old_cookie
            assert call("refresh", csrf=False)["status"] == 403
            page.goto(f"http://127.0.0.1:{foreign.server_port}")
            blocked = page.evaluate("""async api => {
                try { await fetch(api + '/api/v1/auth/browser/refresh', {
                    method: 'POST', credentials: 'include', headers: {'X-TechBaza-CSRF': '1'}
                }); return false; } catch { return true; }
            }""", api)
            assert blocked
            page.goto(origin)
            assert call("logout")["status"] == 204
            assert not any(c["name"] == REFRESH_COOKIE_NAME for c in context.cookies())
            code = page.evaluate("""async ({api, access}) => (await fetch(api + '/api/v1/auth/me', {
                headers: {'Authorization': 'Bearer ' + access}
            })).status""", {"api": api, "access": access})
            assert code == 401
            browser.close()
        print("PASS: Chromium login, HttpOnly cookie, reload/rotation, CSRF/CORS rejection, logout and access revocation")
    finally:
        server.should_exit = True
        if thread.is_alive():
            thread.join(timeout=10)
        api_socket.close()
        frontend.shutdown()
        foreign.shutdown()
        frontend.server_close()
        foreign.server_close()
        with SessionLocal() as session:
            session.execute(delete(User).where(User.id == user_id))
            session.execute(delete(AuthRateLimit).where(AuthRateLimit.key.in_([
                rate_key("login-account", email), rate_key("login-ip", "127.0.0.1"),
                rate_key("session-ip", "127.0.0.1"),
            ])))
            session.commit()


if __name__ == "__main__":
    main()
