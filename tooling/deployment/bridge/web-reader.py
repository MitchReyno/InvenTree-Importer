"""Serve read-only public HTTPS documents over a worker-only Unix socket."""
import http.client
import os
import socket
import socketserver
import ssl
from http.server import BaseHTTPRequestHandler
from urllib.parse import urljoin, urlsplit

from guest_destinations import DNS_NAME, PRIVATE_SUFFIXES, configured_hosts, permitted_addresses

EXTRA = configured_hosts("INTAKE_VM_WEB_ORIGINS")
PROTECTED = configured_hosts("INTAKE_VM_PROTECTED_HOSTS")
MODE = os.environ.get("INTAKE_VM_WEB_MODE", "listed")
if MODE not in ("listed", "public"):
    raise ValueError("invalid web access mode")
if (EXTRA or MODE == "public") and not PROTECTED:
    raise ValueError("configure protected deployment hostnames before extending web access")
ORIGINS = {"www.rfc-editor.org", "docs.python.org", "example.com"} | EXTRA
MAX_BYTES = 2 * 1024 * 1024


def permitted(host):
    if not DNS_NAME.fullmatch(host) or host.endswith(PRIVATE_SUFFIXES):
        return False
    if any(host == name or host.endswith("." + name) for name in PROTECTED):
        return False
    # Only DNS authorities, without embedded credentials, ports or numeric address literals.
    return host.split(".")[-1].isalpha() and (MODE == "public" or host in ORIGINS)


def document(url):
    for _ in range(5):
        target = urlsplit(url)
        if (target.scheme != "https" or not permitted(target.netloc)
                or any(ord(char) < 33 for char in url)):
            raise ValueError("destination refused")
        host = target.netloc
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        if not permitted_addresses(addresses, PROTECTED):
            raise ValueError("destination refused")
        context = ssl.create_default_context()
        connection = http.client.HTTPSConnection(host, timeout=8, context=context)
        try:
            family, kind, proto, _, address = addresses[0]
            with socket.socket(family, kind, proto) as raw:
                raw.settimeout(8)
                raw.connect(address)
                connection.sock = context.wrap_socket(raw, server_hostname=host)
                connection.request("GET", (target.path or "/") + ("?" + target.query if target.query else ""))
                response = connection.getresponse()
                if response.status in (301, 302, 303, 307, 308):
                    url = urljoin(url, response.getheader("Location") or "")
                    continue
                if response.status != 200:
                    raise ValueError("document unavailable")
                body = response.read(MAX_BYTES + 1)
                if len(body) > MAX_BYTES:
                    raise ValueError("document too large")
                return body
        finally:
            connection.close()
    raise ValueError("redirect limit")


class Reader(BaseHTTPRequestHandler):
    timeout = 8

    def do_GET(self):
        try:
            body = document(self.path.removeprefix("/"))
        except (OSError, ValueError, http.client.HTTPException):
            self.send_error(403)
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    path = "/run/web/reader.sock"
    os.umask(0o077)
    if os.path.exists(path):
        os.unlink(path)
    with socketserver.UnixStreamServer(path, Reader) as server:
        server.serve_forever()
