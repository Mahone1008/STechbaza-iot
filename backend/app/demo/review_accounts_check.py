"""Живий HTTP login/RBAC review-входів; жодних команд обладнанню."""

import argparse
import json
from pathlib import Path

from app.demo.catalog import identity, require_demo
from app.demo.check import Client, ensure
from app.demo.review_accounts import ACCOUNTS, validate_passwords


def check(path: Path) -> None:
    require_demo()
    passwords = validate_passwords(json.loads(path.read_text(encoding="utf-8-sig")))
    for account in ACCOUNTS:
        client = Client(account.key, credentials={"email": account.email, "password": passwords[account.key]})
        try:
            visible = {item['id'] for item in client.call('GET', '/api/v1/organizations')}
            expected = ({str(identity('org:' + key)) for key in ('a', 'b')}
                        if account.key == 'superadmin' else
                        {str(identity('org:' + account.organization))} if account.organization else set())
            ensure(expected <= visible if account.key == 'superadmin' else visible == expected,
                   account.key + ': unexpected organization access')
            for key in ('a', 'b'):
                org_id = str(identity('org:' + key))
                own = org_id in expected
                client.call('GET', f'/api/v1/organizations/{org_id}', expected=200 if own else 404)
                members = own and account.key in {'owner', 'admin', 'other', 'superadmin'}
                client.call('GET', f'/api/v1/organizations/{org_id}/memberships',
                            expected=200 if members else 403 if own else 404)
                # Перевіряємо доступ до даних пристрою навіть за відомим чужим UUID.
                device = identity('device:pump' if key == 'a' else 'device:other')
                client.call('GET', f'/api/v1/devices/{device}/overview', expected=200 if own else 404)
        finally:
            client.logout()
    print('PASS: 8 browser logins, role boundaries and foreign-device denial; no equipment commands sent')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credentials', type=Path, required=True)
    check(parser.parse_args().credentials)
