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

from contextlib import nullcontext
import logging
import os
import time
from typing import Any

import requests

from ..execution.dispatch import semantic_read_request
from ..execution.observation import active
from ..execution.transport import ObservedRequests
from .numbers import lossless_float, reject_nonfinite

log = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Endpoints. Production plus the sandbox mirrors (--sandbox).
# --------------------------------------------------------------------------
TOKEN_URL = "https://api.digikey.com/v1/oauth2/token"
PRODUCT_DETAILS_URL = "https://api.digikey.com/products/v4/search/{pn}/productdetails"
# Searched when productdetails 404s. DigiKey retires part numbers - a SKU on a
# 2024 invoice may not resolve today - but the search still finds the product
# the old number referred to.
KEYWORD_SEARCH_URL = "https://api.digikey.com/products/v4/search/keyword"

SANDBOX_TOKEN_URL = "https://sandbox-api.digikey.com/v1/oauth2/token"
SANDBOX_PRODUCT_DETAILS_URL = (
    "https://sandbox-api.digikey.com/products/v4/search/{pn}/productdetails"
)
SANDBOX_KEYWORD_SEARCH_URL = (
    "https://sandbox-api.digikey.com/products/v4/search/keyword"
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
    try:
        resp = ObservedRequests(active(), service="DigiKey authentication", transport=requests).post(
            url,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "client_credentials",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )
    except requests.RequestException as exc:
        raise DigiKeyError("Token request failed (transport)") from exc
    if resp.status_code != 200:
        raise DigiKeyError(
            f"Token request failed ({resp.status_code}). "
            f"Check the client id/secret and that the app is subscribed to the "
            f"API product you are calling."
        )
    try:
        payload = resp.json()
    except ValueError as exc:
        raise DigiKeyError("Invalid token response JSON") from exc
    if not isinstance(payload, dict):
        raise DigiKeyError("Expected an object in token response")
    token = payload.get("access_token")
    if not isinstance(token, str) or not token:
        raise DigiKeyError("No access_token in token response")
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

    def post(self, url: str, body: dict[str, Any],
             label: str = "", *, retry_safe: bool = False) -> dict[str, Any] | None:
        """POST once unless the caller explicitly identifies a safe read."""
        headers = {**self.headers(), "Content-Type": "application/json"}
        return request_json(url, headers, label=label, json_body=body,
                            retry_safe=retry_safe)


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
    json_body: dict[str, Any] | None = None,
    *,
    retry_safe: bool = False,
) -> dict[str, Any] | None:
    """Return JSON, or None only for a missing resource (404).

    Other HTTP, transport and invalid-response failures raise DigiKeyError.
    Retry transient failures for GETs and explicitly safe read-only POSTs;
    never replay an arbitrary POST whose outcome may be unknown.
    """
    transport = ObservedRequests(active(), service="DigiKey", transport=requests)
    can_retry = json_body is None or retry_safe
    attempts = MAX_RETRIES if can_retry else 1
    target = "DigiKey endpoint"  # Caller labels can contain URLs or untrusted SKU text.
    for attempt in range(1, attempts + 1):
        try:
            if json_body is None:
                resp = transport.get(url, headers=headers, params=params, timeout=30)
            else:
                with semantic_read_request("post", url) if retry_safe else nullcontext():
                    resp = transport.post(url, headers=headers, json=json_body, timeout=30)
        except (requests.ConnectionError, requests.Timeout) as exc:
            if attempt == attempts:
                raise DigiKeyError(
                    f"Request failed for {target} after {attempt} attempt(s)"
                ) from exc
            log.warning("    [connection failed] %s (attempt %s)", target, attempt)
        except requests.RequestException as exc:
            raise DigiKeyError(f"Request failed for {target}") from exc
        else:
            if resp.status_code == 200:
                try:
                    payload = resp.json(parse_float=lossless_float, parse_constant=reject_nonfinite)
                except ValueError as exc:
                    raise DigiKeyError(f"Invalid JSON response for {target}") from exc
                if not isinstance(payload, dict):
                    raise DigiKeyError(f"Expected a JSON object for {target}")
                _wait(REQUEST_DELAY_S)
                return payload

            if resp.status_code == 404:
                log.warning("    [not found] %s", target)
                return None

            if resp.status_code in (401, 403):
                raise DigiKeyError(
                    f"Auth rejected ({resp.status_code}) for {target}. Token expired "
                    "or the app is not subscribed to this API product."
                )

            transient = resp.status_code in (408, 429, 500, 502, 503, 504)
            if not transient or attempt == attempts:
                raise DigiKeyError(
                    f"HTTP {resp.status_code} for {target} after {attempt} attempt(s)"
                )
            log.warning("    [http %s] %s (attempt %s)",
                        resp.status_code, target, attempt)
        _wait(min(60, 2 ** attempt))

    raise DigiKeyError(f"No request attempts configured for {target}")


def _wait(seconds: float) -> None:
    """One retry budget, with interruptible service pacing and safe events."""
    observation = active()
    if observation is None:
        time.sleep(seconds)
        return
    observation.emit("service_wait", "DigiKey backoff", outcome="waiting")
    remaining = seconds
    while remaining > 0:
        if observation.cancelled.is_set():
            raise InterruptedError("DigiKey read cancelled during backoff")
        interval = min(remaining, 0.1)
        time.sleep(interval)
        remaining -= interval
    if observation.cancelled.is_set():
        raise InterruptedError("DigiKey read cancelled during backoff")
