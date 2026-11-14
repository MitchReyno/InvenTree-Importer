"""Make the local development InvenTree ready: admin, intake users and API tokens.

Runs inside the one-shot init container through `manage.py shell`. Secrets
arrive through that container's private env file; the resulting tokens are
written to the container's own /tmp for the CLI to copy, never to a volume.
"""

import datetime
import json
import os

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group

from users.models import ApiToken, RuleSet, UserProfile
from users.ruleset import RULESET_NAMES

TOKEN_NAME = "bench-intake-dev"
OUTPUT = "/tmp/bench-intake-tokens.json"
User = get_user_model()


def group(name, *, write):
    """A group with view on every ruleset, and add/change/delete when writing."""
    found, _ = Group.objects.get_or_create(name=name)
    for ruleset in RULESET_NAMES:
        rule, _ = RuleSet.objects.get_or_create(name=ruleset, group=found)
        rule.can_view = True
        rule.can_add = rule.can_change = rule.can_delete = write and ruleset != "admin"
        rule.save()
    found.save()
    return found


def user(name, *, member_of, staff, superuser=False, password=None):
    found, _ = User.objects.get_or_create(username=name)
    found.is_active = True
    found.is_staff = staff
    found.is_superuser = superuser
    found.email = f"{name}@localhost"
    if password:
        found.set_password(password)
    else:
        found.set_unusable_password()
    found.save()
    # The shell counts as a read-only command, so InvenTree's signal skips the profile.
    UserProfile.objects.get_or_create(user=found)
    if member_of is not None:
        found.groups.set([member_of])
    return found


def token(owner, stored):
    """Reuse a stored token that still matches and has not expired; else issue a new one."""
    today = datetime.date.today()
    existing = ApiToken.objects.filter(user=owner, name=TOKEN_NAME)
    if stored and existing.filter(key=stored, revoked=False, expiry__gt=today).exists():
        return stored
    existing.delete()
    return ApiToken.objects.create(user=owner, name=TOKEN_NAME).key


admin_password = os.environ["INVENTREE_ADMIN_PASSWORD"]
user("admin", member_of=None, staff=True, superuser=True, password=admin_password)
reader = user("intake-reader", member_of=group("intake-readers", write=False), staff=False)
writer = user("intake-writer", member_of=group("intake-writers", write=True), staff=True)

result = {
    "reader": token(reader, os.environ.get("BENCH_INTAKE_READER_TOKEN", "")),
    "writer": token(writer, os.environ.get("BENCH_INTAKE_WRITER_TOKEN", "")),
}
descriptor = os.open(OUTPUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(descriptor, "w") as handle:
    json.dump(result, handle)
print("bench-intake bootstrap complete")
