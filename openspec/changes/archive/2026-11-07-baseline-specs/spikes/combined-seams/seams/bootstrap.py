"""Explicit process setup; importing a model must never launch a worker."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def paths() -> None:
    # Repository-only spike modules are not installable application libraries.
    for directory in ("durable-coordination", "importer-adapter", "subscription-runtime"):
        sys.path.insert(0, str(ROOT / "spikes" / directory))


def setup() -> None:
    import django
    from django.conf import settings

    paths()
    port = int(os.environ["COMBINED_PG_PORT"])
    if not 1 <= port <= 65535:
        raise ValueError("invalid private port")
    settings.configure(
        INSTALLED_APPS=["coordination", "seams"],
        DATABASES={"default": {
            "ENGINE": "django.db.backends.postgresql", "NAME": "combined_spike",
            "USER": "combined_spike", "HOST": "127.0.0.1", "PORT": port,
            "OPTIONS": {"connect_timeout": 5},
        }},
        DEFAULT_AUTO_FIELD="django.db.models.BigAutoField", USE_TZ=True,
        SECRET_KEY="owned-command-probe-no-http",
    )
    django.setup()


def system_url() -> str:
    return f"postgresql+psycopg://combined_spike@127.0.0.1:{int(os.environ['COMBINED_PG_PORT'])}/combined_spike"
