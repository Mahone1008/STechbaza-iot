"""Explicit SMTP delivery or private local mail files, never a public mail preview."""

import os
import smtplib
import ssl
import uuid
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import HTTPException

from app.security.browser_config import AUTH_BROWSER_ORIGINS


def public_url() -> str:
    value = os.getenv("MAIL_PUBLIC_URL", AUTH_BROWSER_ORIGINS[0]).rstrip("/")
    parsed = urlsplit(value)
    if value not in AUTH_BROWSER_ORIGINS or parsed.query or parsed.fragment:
        raise HTTPException(503, "Надсилання листів тимчасово недоступне")
    return value


def send_account_mail(email: str, subject: str, message: str) -> None:
    mode = os.getenv("MAIL_DELIVERY_MODE", "disabled")
    local = all(
        urlsplit(origin).hostname in ("localhost", "127.0.0.1", "::1")
        for origin in AUTH_BROWSER_ORIGINS
    )
    letter = EmailMessage()
    letter["To"] = email
    letter["From"] = os.getenv("MAIL_FROM", "KERUMO <access@kerumo.example.com>")
    letter["Subject"] = subject
    letter.set_content(message)
    try:
        if mode == "local" and local:
            folder = Path(os.getenv("MAIL_LOCAL_DIRECTORY", ".local/mail"))
            folder.mkdir(mode=0o700, parents=True, exist_ok=True)
            descriptor = os.open(
                folder / f"{uuid.uuid4().hex}.txt", os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600
            )
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(f"Кому: {email}\nТема: {subject}\n\n{message}\n")
        elif mode == "smtp":
            host, port = os.environ["SMTP_HOST"], int(os.getenv("SMTP_PORT", "587"))
            security = os.getenv("SMTP_SECURITY", "starttls")
            if security not in ("starttls", "tls"):
                raise ValueError("TLS is required")
            transport = (
                smtplib.SMTP_SSL(host, port, timeout=10, context=ssl.create_default_context())
                if security == "tls"
                else smtplib.SMTP(host, port, timeout=10)
            )
            with transport as server:
                if security == "starttls":
                    server.starttls(context=ssl.create_default_context())
                username = os.getenv("SMTP_USERNAME")
                if username:
                    server.login(username, os.environ["SMTP_PASSWORD"])
                server.send_message(letter)
        else:
            raise ValueError("Mail is not configured")
    except (OSError, ValueError, KeyError, smtplib.SMTPException):
        raise HTTPException(
            503, "Надсилання листів тимчасово недоступне. Спробуйте пізніше."
        ) from None
