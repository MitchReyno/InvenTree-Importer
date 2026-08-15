"""
DigiKey API v4: auth, endpoints and the shared HTTP layer.

Credentials come from the environment (see invimport.env):

    DIGIKEY_CLIENT_ID=...
    DIGIKEY_CLIENT_SECRET=...
    DIGIKEY_ACCOUNT_ID=...        # order endpoints only, see below

Optional:
    DIGIKEY_LOCALE_SITE=AU        # default AU
    DIGIKEY_LOCALE_CURRENCY=AUD   # default AUD
    DIGIKEY_LOCALE_LANGUAGE=en    # default en

The app must be subscribed to each API product separately in the DigiKey
developer portal - Product Information access does not grant OrderStatus.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

import requests

log = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Endpoints. Production plus the sandbox mirrors (--sandbox).
# --------------------------------------------------------------------------
TOKEN_URL = "https://api.digikey.com/v1/oauth2/token"
PRODUCT_DETAILS_URL = "https://api.digikey.com/products/v4/search/{pn}/productdetails"

SANDBOX_TOKEN_URL = "https://sandbox-api.digikey.com/v1/oauth2/token"
SANDBOX_PRODUCT_DETAILS_URL = (
    "https://sandbox-api.digikey.com/products/v4/search/{pn}/productdetails"
)

# OrderStatus API v4 (basePath /orderstatus/v4).
ORDER_SEARCH_URL = "https://api.digikey.com/orderstatus/v4/orders"
SALES_ORDER_URL = "https://api.digikey.com/orderstatus/v4/salesorder/{sales_order_id}"

SANDBOX_ORDER_SEARCH_URL = "https://sandbox-api.digikey.com/orderstatus/v4/orders"
SANDBOX_SALES_ORDER_URL = (
    "https://sandbox-api.digikey.com/orderstatus/v4/salesorder/{sales_order_id}"
)

REQUEST_DELAY_S = 0.5      # be polite; DigiKey rate limits per second and per day
MAX_RETRIES = 4


class DigiKeyError(RuntimeError):
    pass


class Locale:
    """The three locale headers every DigiKey v4 endpoint accepts."""

    def __init__(self, site: str, currency: str, language: str):
        self.site = site
        self.currency = currency
        self.language = language

    def __str__(self) -> str:
        return (f"site={self.site} currency={self.currency} "
                f"language={self.language}")


def resolve_locale() -> Locale:
    return Locale(
        os.getenv("DIGIKEY_LOCALE_SITE", "AU"),
        os.getenv("DIGIKEY_LOCALE_CURRENCY", "AUD"),
        os.getenv("DIGIKEY_LOCALE_LANGUAGE", "en"),
    )


def resolve_credentials() -> tuple[str, str]:
    """Return (client_id, client_secret) or exit with a usable message."""
    client_id = os.getenv("DIGIKEY_CLIENT_ID")
    client_secret = os.getenv("DIGIKEY_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise DigiKeyError(
            "set DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET in the .env or "
            "environment"
        )
    return client_id, client_secret


def resolve_account_id() -> str:
    """
    The OrderStatus API ties orders to an account. Under two-legged OAuth there
    is no signed-in user to infer it from, so the header is mandatory.
    """
    account_id = os.getenv("DIGIKEY_ACCOUNT_ID")
    if not account_id:
        raise DigiKeyError(
            "order lookups need DIGIKEY_ACCOUNT_ID (your DigiKey customer/"
            "account id) in the .env or environment"
        )
    return account_id


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
def get_access_token(client_id: str, client_secret: str, sandbox: bool = False) -> str:
    """Two-legged OAuth2 client-credentials grant."""
    url = SANDBOX_TOKEN_URL if sandbox else TOKEN_URL
    resp = requests.post(
        url,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "client_credentials",
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    if resp.status_code != 200:
        raise DigiKeyError(
            f"Token request failed ({resp.status_code}). "
            f"Check the client id/secret and that the app is subscribed to the "
            f"API product you are calling. Body: {resp.text[:400]}"
        )
    payload = resp.json()
    token = payload.get("access_token")
    if not token:
        raise DigiKeyError(f"No access_token in token response: {payload}")
    return token


class Client:
    """A token plus the locale/account context every request needs."""

    def __init__(self, token: str, client_id: str, locale: Locale,
                 account_id: str | None = None, sandbox: bool = False):
        self.token = token
        self.client_id = client_id
        self.locale = locale
        self.account_id = account_id
        self.sandbox = sandbox

    def headers(self, with_account: bool = False) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.token}",
            "X-DIGIKEY-Client-Id": self.client_id,
            "X-DIGIKEY-Locale-Site": self.locale.site,
            "X-DIGIKEY-Locale-Currency": self.locale.currency,
            "X-DIGIKEY-Locale-Language": self.locale.language,
            "Accept": "application/json",
        }
        if with_account and self.account_id:
            headers["X-DIGIKEY-Account-Id"] = self.account_id
        return headers

    def get(self, url: str, params: dict[str, Any] | None = None,
            label: str = "", with_account: bool = False) -> dict[str, Any] | None:
        return request_json(url, self.headers(with_account), params, label)


def connect(sandbox: bool = False, need_account: bool = False) -> Client:
    """Resolve credentials from the environment and acquire a token."""
    client_id, client_secret = resolve_credentials()
    account_id = resolve_account_id() if need_account else None
    locale = resolve_locale()

    if sandbox:
        log.warning("SANDBOX MODE - responses are fabricated.")
    log.info("Locale: %s", locale)

    token = get_access_token(client_id, client_secret, sandbox=sandbox)
    log.info("Access token acquired.")
    return Client(token, client_id, locale, account_id, sandbox)


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------
def request_json(
    url: str,
    headers: dict[str, str],
    params: dict[str, Any] | None = None,
    label: str = "",
) -> dict[str, Any] | None:
    """
    GET a DigiKey endpoint with retry/backoff. Returns the parsed body, or None
    if the resource is absent (404) or every attempt failed.

    Raises DigiKeyError on 401/403, which mean the token or the app's API
    subscriptions are wrong - retrying those just wastes quota.
    """
    for attempt in range(1, MAX_RETRIES + 1):
        resp = requests.get(url, headers=headers, params=params, timeout=30)

        if resp.status_code == 200:
            time.sleep(REQUEST_DELAY_S)
            return resp.json()

        if resp.status_code == 404:
            log.warning("    [not found] %s", label)
            return None

        if resp.status_code == 429:
            wait = min(60, 2 ** attempt)
            log.warning("    [rate limited] sleeping %ss (attempt %s)", wait, attempt)
            time.sleep(wait)
            continue

        if resp.status_code in (401, 403):
            raise DigiKeyError(
                f"Auth rejected ({resp.status_code}) for {label}. Token expired or "
                f"the app is not subscribed to this API product. Body: {resp.text[:300]}"
            )

        log.warning("    [http %s] %s: %s", resp.status_code, label, resp.text[:200])
        time.sleep(2 ** attempt)

    log.warning("    [give up] %s after %s attempts", label, MAX_RETRIES)
    return None


