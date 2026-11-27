"""Explicit setup used by CLI processes, never an AppConfig worker hook."""

import os
import re
from pathlib import Path

import django
from django.conf import settings

from .boundary import FIXTURE


def bundle_path() -> Path:
    return Path(os.environ.get("COORDINATION_BUNDLE", str(FIXTURE))).resolve(strict=True)


def setup() -> None:
    port = int(os.environ["COORDINATION_PG_PORT"])
    database = os.environ["COORDINATION_PG_DATABASE"]
    if not 1 <= port <= 65535 or not re.fullmatch(r"coordination_spike_[a-z0-9_]+", database):
        raise ValueError("Only owned coordination_spike_ databases are accepted")
    settings.configure(
        INSTALLED_APPS=["coordination"],
        DATABASES={"default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": database, "HOST": "127.0.0.1", "PORT": port,
            "USER": "coordination_spike", "PASSWORD": "",
            "OPTIONS": {"connect_timeout": 5},
        }},
        DEFAULT_AUTO_FIELD="django.db.models.BigAutoField",
        USE_TZ=True,
        SECRET_KEY="synthetic-spike-not-a-web-service",
    )
    django.setup()


def system_url() -> str:
    return (
        "postgresql+psycopg://coordination_spike@127.0.0.1:"
        f"{int(os.environ['COORDINATION_PG_PORT'])}/"
        f"{os.environ['COORDINATION_PG_DATABASE']}"
    )
