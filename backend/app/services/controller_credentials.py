"""Стійкий намір ротації: після збою worker повторює його до ACK брокера."""

import logging
import threading

from cryptography.fernet import InvalidToken
from sqlalchemy import select

from app.db import SessionLocal
from app.models import ControllerCredential, Device
from app.security.account_keys import new_key, secret_box
from app.services.controller_broker import BrokerUnavailable, ControllerBroker, configured

logger = logging.getLogger(__name__)
_stop = threading.Event()
_thread = None


def credential_secret(row):
    try:
        return secret_box("controller").decrypt(row.secret.encode()).decode()
    except (InvalidToken, UnicodeError) as exc:
        raise BrokerUnavailable(
            "Ключ контролера недоступний; перевірте ACCOUNT_KEY_SECRET"
        ) from exc


def issue(session, controller, device):
    row = session.get(ControllerCredential, device.id)
    if row is None:
        row = ControllerCredential(
            device_id=device.id, controller_id=controller.id, applied_revision=0
        )
        session.add(row)
    controller.credential_revision += 1
    controller.access_revoked = False
    row.secret = secret_box("controller").encrypt(new_key().encode()).decode()
    row.revision, row.revoked = controller.credential_revision, False
    return row


def revoke(session, controller):
    controller.access_revoked = True
    row = session.get(ControllerCredential, controller.device_id)
    if row and not row.revoked:
        controller.credential_revision += 1
        row.revision, row.revoked = controller.credential_revision, True


def synchronize(device_id):
    with SessionLocal.begin() as session:
        row = session.scalar(
            select(ControllerCredential)
            .where(ControllerCredential.device_id == device_id)
            .with_for_update()
        )
        if row is None or row.applied_revision == row.revision:
            return
        uid = session.get(Device, row.device_id).uid
        with ControllerBroker() as broker:
            broker.apply(uid, "" if row.revoked else credential_secret(row), row.revoked)
        row.applied_revision = row.revision


def _run():
    while not _stop.wait(5):
        try:
            with SessionLocal() as session:
                ids = list(
                    session.scalars(
                        select(ControllerCredential.device_id)
                        .where(
                            ControllerCredential.revision != ControllerCredential.applied_revision
                        )
                        .order_by(ControllerCredential.device_id)
                        .limit(50)
                    )
                )
            for device_id in ids:
                if _stop.is_set():
                    return
                try:
                    synchronize(device_id)
                except Exception:
                    # Одна пошкоджена identity не блокує решту черги.
                    logger.warning("Controller credential reconciliation pending: device_id=%s", device_id)
        except Exception:
            # Винятки SDK можуть містити credentials або response; не друкуємо їх.
            logger.warning("Controller credential reconciliation pending")


def start_controller_credentials():
    global _thread
    if configured() and (_thread is None or not _thread.is_alive()):
        _stop.clear()
        _thread = threading.Thread(target=_run, name="controller-credentials", daemon=True)
        _thread.start()


def stop_controller_credentials():
    _stop.set()
    if _thread:
        _thread.join(timeout=10)
