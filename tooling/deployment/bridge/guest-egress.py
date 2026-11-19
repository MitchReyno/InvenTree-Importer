"""Expose a CONNECT proxy on a guest-only Unix socket for the provider CLI and its tools.

The provider's own hosts are always allowed. Public hosts are allowed only when this turn's
policy file, written by the paired supervisor, says public web pages are on.
"""
import asyncio
import ipaddress
import json
import os
import socket
from pathlib import Path

from guest_destinations import (
    DNS_NAME,
    Refused,
    configured_hosts,
    literal_address,
    protected_addresses,
    public_target,
)

PROTECTED = configured_hosts("INTAKE_VM_PROTECTED_HOSTS")
CODEX = os.environ.get("INTAKE_VM_CODEX_SUBSCRIPTION") == "1"
HOSTS = {"auth.openai.com", "chatgpt.com"} if CODEX else {"api.anthropic.com"}
SOCKET = Path("/run/egress/codex.sock" if CODEX else "/run/egress/claude.sock")
# Mounted read-only from the supervisor's turn directory; absent outside tool turns.
POLICY_PATH = Path("/run/policy/policy.json")
POLICY_VERSION = 1
MAX_PROTECTED_HOSTS = 32
MAX_POLICY_BYTES = 8192
HEADER_TIMEOUT_S = 5
CONNECT_TIMEOUT_S = 10


def protected_entry(value):
    return isinstance(value, str) and (DNS_NAME.fullmatch(value) is not None
                                       or literal_address(value) is not None)


def load_policy():
    """The turn's policy, or None (provider hosts only) when it is missing or malformed."""
    try:
        with POLICY_PATH.open("rb") as file:
            raw = file.read(MAX_POLICY_BYTES + 1)
    except OSError:
        return None
    if len(raw) > MAX_POLICY_BYTES:
        return None
    try:
        policy = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(policy, dict) or policy.get("version") != POLICY_VERSION:
        return None
    hosts = policy.get("protected_hosts")
    if (not isinstance(policy.get("public_pages"), bool) or not isinstance(hosts, list)
            or len(hosts) > MAX_PROTECTED_HOSTS or not all(protected_entry(host) for host in hosts)):
        return None
    return {"public_pages": policy["public_pages"], "protected_hosts": set(hosts)}


def connect_target(request_line):
    """The (host, port) a CONNECT request line names, or Refused."""
    fields = request_line.split()
    if len(fields) != 3 or fields[0] != b"CONNECT" or fields[2] not in (b"HTTP/1.0", b"HTTP/1.1"):
        raise Refused("destination_refused")
    try:
        host, separator, port = fields[1].decode("ascii").rpartition(":")
    except UnicodeDecodeError as error:
        raise Refused("destination_refused") from error
    if not separator or not port.isdigit():
        raise Refused("destination_refused")
    return host, int(port)


def provider_protected_addresses(protected):
    """Protected addresses for a provider connection.

    A protected name that doesn't resolve is skipped here, so the provider stays reachable;
    public access for the turn is refused separately by public_target.
    """
    blocked = set()
    for entry in protected:
        try:
            blocked |= protected_addresses({entry})
        except Refused:
            continue
    return blocked


async def provider_address(host, protected):
    answers = await asyncio.get_running_loop().getaddrinfo(
        host, 443, family=socket.AF_INET, type=socket.SOCK_STREAM)
    blocked = await asyncio.to_thread(provider_protected_addresses, protected)
    addresses = [answer[4][0] for answer in answers]
    if not addresses or any(ipaddress.ip_address(address) in blocked for address in addresses):
        raise Refused("protected_destination")
    return addresses[0]


async def checked_address(host, port):
    policy = load_policy()
    protected = PROTECTED | (policy["protected_hosts"] if policy else set())
    if host in HOSTS and port == 443:
        return await provider_address(host, protected)
    if policy is None or not policy["public_pages"]:
        raise Refused("destination_refused")
    return await asyncio.to_thread(public_target, host, port, protected)


async def refuse(client, reason):
    client.write(b"HTTP/1.1 403 Forbidden\r\nX-Bench-Refusal: " + reason.encode()
                 + b"\r\nContent-Length: 0\r\n\r\n")
    await client.drain()


async def copy(source, target):
    while data := await source.read(65536):
        target.write(data)
        await target.drain()


async def handle(reader, client):
    upstream = None
    tasks = []
    try:
        headers = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), HEADER_TIMEOUT_S)
        host, port = connect_target(headers.split(b"\r\n", 1)[0])
        address = await checked_address(host, port)
        remote, upstream = await asyncio.wait_for(
            asyncio.open_connection(address, 443), CONNECT_TIMEOUT_S)
        client.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await client.drain()
        tasks = [asyncio.create_task(copy(reader, upstream)),
                 asyncio.create_task(copy(remote, client))]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except Refused as refusal:
        await refuse(client, refusal.reason)
    except (OSError, ValueError, asyncio.IncompleteReadError, asyncio.LimitOverrunError,
            asyncio.TimeoutError):
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if upstream:
            upstream.close()
        client.close()


async def main():
    os.umask(0o077)
    SOCKET.unlink(missing_ok=True)
    server = await asyncio.start_unix_server(handle, SOCKET, limit=8192)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
