"""Complete, bounded API collection reads; incomplete discovery is never absence."""
from __future__ import annotations

import json
from urllib.parse import parse_qsl, unquote, urljoin, urlsplit

from requests import RequestException

from .api import InvenTreeError

MAX_PAGES = 1000
MAX_ROWS = 100000


class DiscoveryError(InvenTreeError):
    """The collection could not be read completely and safely."""


def _next_request(api, current: str, link: str) -> tuple[str, dict]:
    base = getattr(api, "api_url", None)
    if not isinstance(base, str) or not base:
        raise DiscoveryError("pagination requires a known API root")
    root = urlsplit(base)
    target = urlsplit(urljoin(urljoin(base, current), link))
    root_path = root.path.rstrip("/") + "/"
    decoded = unquote(target.path)
    if (root.scheme not in ("http", "https")
            or (target.scheme, target.netloc) != (root.scheme, root.netloc)
            or target.username or target.password or target.fragment
            or not target.path.startswith(root_path)
            or not decoded.startswith(root_path)
            or any(segment in (".", "..") for segment in decoded.split("/"))
            or "\\" in decoded):
        raise DiscoveryError("unsafe pagination target")
    # Keep queries out of SDK constructApiUrl, which appends a trailing slash.
    route = target.path[len(root_path):]
    decoded_route = decoded[len(root_path):]
    # SDK urljoin treats a scheme-like relative endpoint as an absolute URL.
    # A same-origin path containing /api/https://evil/ must never become one.
    if (route.startswith("/") or decoded_route.startswith("/")
            or urlsplit(route).scheme or urlsplit(decoded_route).scheme):
        raise DiscoveryError("unsafe pagination endpoint")
    query = parse_qsl(target.query, keep_blank_values=True)
    if len({key for key, _ in query}) != len(query):
        raise DiscoveryError("ambiguous pagination query")
    return route, dict(query)


def list_rows(api, route: str, *, params: dict | None = None) -> list[dict]:
    """Return every page, or raise without returning a usable partial collection.

    Only same-origin links below the configured API root are dispatched.
    """
    query = dict(params or {})
    rows: list[dict] = []
    requests_seen: set[tuple] = set()
    pages_seen: set[str] = set()
    for _ in range(MAX_PAGES):
        request_key = (route, tuple(sorted((key, str(value)) for key, value in query.items())))
        if request_key in requests_seen:
            raise DiscoveryError("pagination request loop")
        requests_seen.add(request_key)
        try:
            response = api.get(route, params=query)
        except RequestException as exc:
            raise DiscoveryError(f"could not read collection {route}") from exc
        if isinstance(response, list):
            page, next_link = response, None
        elif isinstance(response, dict) and isinstance(response.get("results"), list):
            page, next_link = response["results"], response.get("next")
            if "next" not in response:
                raise DiscoveryError("paginated response has no completion marker")
        else:
            raise DiscoveryError("invalid collection response")
        if any(not isinstance(row, dict) for row in page):
            raise DiscoveryError("invalid collection row")
        try:
            signature = json.dumps(page, sort_keys=True, separators=(",", ":"))
        except (TypeError, ValueError) as exc:
            raise DiscoveryError("invalid collection data") from exc
        if signature in pages_seen:
            raise DiscoveryError("pagination repeated a page")
        pages_seen.add(signature)
        rows.extend(page)
        if len(rows) > MAX_ROWS:
            raise DiscoveryError("collection row bound exceeded")
        if isinstance(response, dict) and "count" in response:
            count = response["count"]
            if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                raise DiscoveryError("invalid collection count")
            if next_link is None and count != len(rows):
                raise DiscoveryError("collection count does not confirm completeness")
        if next_link is None:
            return rows
        if not isinstance(next_link, str) or not next_link:
            raise DiscoveryError("invalid pagination next link")
        route, query = _next_request(api, route, next_link)
    raise DiscoveryError("collection page bound exceeded")


def list_models(model, api, **params) -> list:
    """SDK list-compatible model construction after a complete collection read."""
    model.checkApiVersion(api)
    route = params.pop("url", model.URL)
    rows = list_rows(api, route, params=params)
    if any(isinstance(row.get("pk"), bool) or not isinstance(row.get("pk"), int)
           or row["pk"] <= 0 for row in rows):
        raise DiscoveryError(f"invalid {model.__name__} collection identity")
    return [model(api=api, data=row) for row in rows]
