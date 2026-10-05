import os
import ssl
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from app.services.account_mail import send_account_mail


class AccountMailTests(unittest.TestCase):
    def test_local_mail_is_private_and_does_not_require_network(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.dict(
                os.environ, {"MAIL_DELIVERY_MODE": "local", "MAIL_LOCAL_DIRECTORY": directory}
            ),
            patch("app.services.account_mail.AUTH_BROWSER_ORIGINS", ("http://127.0.0.1:3000",)),
        ):
            send_account_mail("buyer@example.com", "Підтвердіть пошту", "Private proof")
            files = list(Path(directory).glob("*.txt"))
            self.assertEqual(len(files), 1)
            self.assertIn("Private proof", files[0].read_text())
            self.assertEqual(files[0].stat().st_mode & 0o777, 0o600)

    def test_public_origin_cannot_use_a_local_mail_file(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.dict(
                os.environ, {"MAIL_DELIVERY_MODE": "local", "MAIL_LOCAL_DIRECTORY": directory}
            ),
            patch(
                "app.services.account_mail.AUTH_BROWSER_ORIGINS", ("https://cabinet.example.com",)
            ),
        ):
            with self.assertRaises(HTTPException) as error:
                send_account_mail("buyer@example.com", "Confirm", "Private proof")
            self.assertEqual(error.exception.status_code, 503)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_smtp_uses_verified_tls_and_credentials_are_not_returned_on_failure(self):
        from smtplib import SMTPAuthenticationError

        with (
            patch.dict(
                os.environ,
                {
                    "MAIL_DELIVERY_MODE": "smtp",
                    "SMTP_HOST": "smtp.example.com",
                    "SMTP_USERNAME": "test",
                    "SMTP_PASSWORD": "private-smtp-secret",
                },
            ),
            patch("app.services.account_mail.smtplib.SMTP") as smtp,
        ):
            server = smtp.return_value.__enter__.return_value
            server.login.side_effect = SMTPAuthenticationError(535, b"private-smtp-secret")
            with self.assertRaises(HTTPException) as error:
                send_account_mail("buyer@example.com", "Confirm", "Private proof")
            server.starttls.assert_called_once()
            self.assertEqual(
                server.starttls.call_args.kwargs["context"].verify_mode, ssl.CERT_REQUIRED
            )
            self.assertNotIn("private-smtp-secret", str(error.exception.detail))

    def test_implicit_tls_verifies_the_smtp_certificate(self):
        with (
            patch.dict(
                os.environ,
                {
                    "MAIL_DELIVERY_MODE": "smtp",
                    "SMTP_HOST": "smtp.example.com",
                    "SMTP_SECURITY": "tls",
                    "SMTP_PORT": "465",
                    "SMTP_USERNAME": "",
                },
            ),
            patch("app.services.account_mail.smtplib.SMTP_SSL") as smtp,
        ):
            send_account_mail("buyer@example.com", "Confirm", "Private proof")
            context = smtp.call_args.kwargs["context"]
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(context.check_hostname)
