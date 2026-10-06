"""Create a private first-install pilot environment, without changing an existing file."""
import argparse
import os
from pathlib import Path
import re
import secrets
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--customer-host', required=True)
parser.add_argument('--staff-url', required=True)
parser.add_argument('--output', type=Path, default=Path('.env.pilot'))
args = parser.parse_args()
if not re.fullmatch(r'[a-z0-9][a-z0-9.-]+[a-z0-9]', args.customer_host):
    parser.error('customer-host must be a DNS name without a scheme or path')
url = urlparse(args.staff_url)
if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
    parser.error('staff-url must be the HTTPS origin provided by your private VPN')
template = (Path(__file__).resolve().parents[1] / 'infrastructure/staff/pilot.env.example').read_text()
values = {name: secrets.token_hex(32) for name in ('MIGRATOR_DB_PASSWORD', 'CUSTOMER_DB_PASSWORD', 'STAFF_DB_PASSWORD', 'CUSTOMER_JWT_SECRET', 'STAFF_JWT_SECRET', 'ACCOUNT_KEY_SECRET', 'STAFF_DIAGNOSTICS_SECRET')}
values.update(CUSTOMER_HOST=args.customer_host, STAFF_PUBLIC_URL=args.staff_url.rstrip('/'))
for name, value in values.items():
    template = re.sub(r'^'+name+r'=.*$', name+'='+value, template, flags=re.MULTILINE)
try:
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    raise SystemExit('Existing environment preserved. Edit it privately; do not regenerate account keys.') from None
with os.fdopen(descriptor, 'w', encoding='utf-8') as file:
    file.write(template)
print('PASS: private pilot environment created with distinct random secrets. SMTP remains disabled until configured.')
