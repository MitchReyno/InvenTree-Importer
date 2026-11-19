"""Expose a CONNECT proxy on a guest-only Unix socket for the provider CLI and its tools.

The provider's own hosts are always allowed. Public hosts are allowed only when this turn's
policy file, written by the paired supervisor, says public web pages are on.
"""
import asyncio
import json
import os
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from guest_destinations import (
    Refused,
    check_public_form,
    check_public_syntax,
    configured_hosts,
    connection_order,
    dns_name,
    literal_address,
    normalized,
    protected_addresses,
    protected_name,
    public,
    public_target,
)

PROTECTED = configured_hosts("INTAKE_VM_PROTECTED_HOSTS")
CODEX = os.environ.get("INTAKE_VM_CODEX_SUBSCRIPTION") == "1"
HOSTS = {"auth.openai.com", "chatgpt.com"} if CODEX else {"api.anthropic.com"}
SOCKET = Path("/run/egress/codex.sock" if CODEX else "/run/egress/claude.sock")
# Mounted read-only from the supervisor's turn directory; absent outside tool turns.
POLICY_PATH = Path("/run/policy/policy.json")
POLICY_VERSION = 1
POLICY_KEYS = {"version", "public_pages", "protected_hosts"}
# Both limits match intake-server/src/agents/shared-vm/turn-policy.ts, which refuses larger.
MAX_PROTECTED_HOSTS = 32
MAX_POLICY_BYTES = 16384
HEADER_TIMEOUT_S = 5
CONNECT_TIMEOUT_S = 10
# A destination with many answers gets at most this many connection attempts.
MAX_CONNECT_ATTEMPTS = 3
# Public tunnels open at once, and how long one may sit without data before it closes. Provider
# tunnels have neither limit: model streams can pause for long stretches.
MAX_PUBLIC_TUNNELS = 32
PUBLIC_IDLE_TIMEOUT_S = 120
# Connections still sending their CONNECT line. Provider and public requests share this
# listener, so the agent could only use it to stall its own turn.
MAX_PENDING_HEADERS = 16
# A public tunnel's streams get this long to flush on close before they are aborted.
CLOSE_TIMEOUT_S = 5
# All DNS work for one CONNECT, including protected-host lookups, must finish within this.
DNS_TIMEOUT_S = 10
# Lookups in flight per path; a stalled lookup keeps its slot until its thread returns.
DNS_SLOTS = 4


class BoundedResolver:
    """Runs blocking DNS work on its own small pool and refuses when every slot is busy.

    Provider and public lookups use separate resolvers, so stalled public lookups can't hold
    up the provider connection.
    """

    def __init__(self, name):
        self.pool = ThreadPoolExecutor(max_workers=DNS_SLOTS, thread_name_prefix=name)
        self.slots = threading.BoundedSemaphore(DNS_SLOTS)

    async def run(self, function, *args):
        if not self.slots.acquire(blocking=False):
            raise Refused("resolution_failed")
        future = self.pool.submit(function, *args)
        future.add_done_callback(lambda _done: self.slots.release())
        try:
            return await asyncio.wait_for(asyncio.wrap_future(future), DNS_TIMEOUT_S)
        except asyncio.TimeoutError as error:
            raise Refused("resolution_failed") from error


PROVIDER_DNS = BoundedResolver("provider-dns")
PUBLIC_DNS = BoundedResolver("public-dns")
# Protected-name lookups for a provider CONNECT run beside the provider's own lookup and get
# this budget. A name whose refresh is still running after it blocks its last known addresses.
PROTECTED_LOOKUP_BUDGET_S = 2


class ProtectedLookups:
    """Protected-name addresses for provider CONNECTs.

    Every CONNECT refreshes each name, joining a refresh already in flight, so a name that
    moves is blocked at its new address straight away. A refresh that fails or runs late
    leaves the name's last known addresses blocking. Each name has at most one refresh in
    flight and a turn has at most a few dozen names, so the work stays bounded.
    """

    def __init__(self):
        self.pool = ThreadPoolExecutor(max_workers=DNS_SLOTS, thread_name_prefix="protected-dns")
        self.lock = threading.Lock()
        self.known = {}
        self.in_flight = {}

    def resolve(self, name):
        """Fresh addresses for `name`, or None when the lookup fails."""
        try:
            addresses = protected_addresses({name})
        except Refused:
            addresses = None
        with self.lock:
            self.in_flight.pop(name, None)
            if addresses is not None:
                self.known[name] = addresses
        return addresses

    def refresh(self, name):
        """The name's last known addresses and its refresh in flight."""
        with self.lock:
            if name not in self.in_flight:
                self.in_flight[name] = self.pool.submit(self.resolve, name)
            return self.known.get(name, set()), self.in_flight[name]

    async def deny_set(self, protected):
        blocked = set()
        refreshes = []
        for entry in protected:
            literal = literal_address(entry)
            if literal is not None:
                if public(str(literal)):
                    blocked.add(literal)
                continue
            known, future = self.refresh(entry)
            refreshes.append((known, asyncio.wrap_future(future)))
        if refreshes:
            await asyncio.wait([waiter for _known, waiter in refreshes],
                               timeout=PROTECTED_LOOKUP_BUDGET_S)
        for known, waiter in refreshes:
            fresh = waiter.result() if waiter.done() else None
            blocked |= fresh if fresh is not None else known
        return blocked

    def latest(self, protected):
        """Every address a protected name is known to have now, including lookups that
        finished after their budget."""
        with self.lock:
            return set().union(*(self.known.get(entry, set()) for entry in protected))


PROTECTED_LOOKUPS = ProtectedLookups()


def protected_entry(value):
    return isinstance(value, str) and (dns_name(value) or literal_address(value) is not None)


def unique_object(pairs):
    keys = [key for key, _value in pairs]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate policy key")
    return dict(pairs)


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
        policy = json.loads(raw, object_pairs_hook=unique_object)
    except (ValueError, RecursionError):
        # Deep nesting can exhaust the decoder's recursion on some Python versions.
        return None
    # `type(...) is int` keeps JSON true from passing as version 1.
    if (not isinstance(policy, dict) or set(policy) != POLICY_KEYS
            or type(policy["version"]) is not int or policy["version"] != POLICY_VERSION):
        return None
    hosts = policy["protected_hosts"]
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
    if not separator or not (port.isdigit() and len(port) <= 5) or not 1 <= int(port) <= 65535:
        raise Refused("destination_refused")
    return host, int(port)


def provider_answers(host):
    """The provider host's IPv4 answers, or Refused. Blocking; run on PROVIDER_DNS."""
    try:
        answers = socket.getaddrinfo(host, 443, family=socket.AF_INET, type=socket.SOCK_STREAM)
    except OSError as error:
        raise Refused("resolution_failed") from error
    return [answer[4][0] for answer in answers]


async def provider_addresses(host, protected):
    """The provider host's checked addresses, or Refused.

    Its own lookup and the protected lookups run at the same time under separate deadlines, so
    a stalled protected name can't cost the provider its DNS deadline. A protected name that
    fails or stalls is skipped here; public access is refused separately by public_target.
    """
    if protected_name(host, protected):
        raise Refused("protected_destination")
    deny = asyncio.create_task(PROTECTED_LOOKUPS.deny_set(protected))
    try:
        addresses = await PROVIDER_DNS.run(provider_answers, host)
    except BaseException:
        deny.cancel()
        raise
    # Lookups that finished after the budget, while the provider lookup ran, still count.
    blocked = await deny | PROTECTED_LOOKUPS.latest(protected)
    if not addresses or not all(public(address) for address in addresses):
        raise Refused("not_public")
    if any(normalized(address) in blocked for address in addresses):
        raise Refused("protected_destination")
    return connection_order(addresses)


def provider_guard(protected):
    """Refuses a provider address that a protected lookup has found since it was checked."""
    def guard(address):
        if normalized(address) in PROTECTED_LOOKUPS.latest(protected):
            raise Refused("protected_destination")
    return guard


async def checked_addresses(host, port):
    """Addresses to try, in order, all of them checked, and a recheck to run before each dial;
    or Refused."""
    policy = load_policy()
    protected = PROTECTED | (policy["protected_hosts"] if policy else set())
    if host in HOSTS and port == 443:
        return await provider_addresses(host, protected), provider_guard(protected)
    if policy is None or not policy["public_pages"]:
        raise Refused("destination_refused")
    check_public_form(host, port, protected)
    try:
        # public_target resolved every protected name for this request; nothing to recheck.
        return await PUBLIC_DNS.run(public_target, host, port, protected), None
    except Refused as refusal:
        # A protected name stays protected when its lookup runs out of time or slots.
        if refusal.reason == "resolution_failed" and protected_name(host, protected):
            raise Refused("protected_destination") from None
        raise


async def open_first(addresses, guard=None):
    """Connects to the first reachable checked address, trying at most a few.

    `guard` rechecks an address before it is dialled and again once connected, so a protected
    lookup that finishes during the dial still stops the tunnel before any byte is relayed.
    """
    failure = OSError("no checked address")
    for address in addresses[:MAX_CONNECT_ATTEMPTS]:
        if guard:
            guard(address)
        try:
            remote, upstream = await asyncio.wait_for(
                asyncio.open_connection(address, 443), CONNECT_TIMEOUT_S)
        except (OSError, asyncio.TimeoutError) as error:
            failure = error
            continue
        if guard:
            try:
                guard(address)
            except Refused:
                abort(upstream)
                upstream.close()
                raise
        return remote, upstream
    raise failure


async def refuse(client, reason):
    client.write(b"HTTP/1.1 403 Forbidden\r\nX-Bench-Refusal: " + reason.encode()
                 + b"\r\nContent-Length: 0\r\n\r\n")
    await client.drain()


class Activity:
    """When a tunnel last carried data in either direction."""

    def __init__(self):
        self.last = time.monotonic()

    def touch(self):
        self.last = time.monotonic()


async def copy(source, target, activity):
    while data := await source.read(65536):
        activity.touch()
        target.write(data)
        await target.drain()


async def idle_watch(activity, timeout):
    """Returns once the tunnel has carried no data either way for `timeout` seconds."""
    while (remaining := activity.last + timeout - time.monotonic()) > 0:
        await asyncio.sleep(remaining)


# Public CONNECTs being set up or tunnelling, and connections still sending their header; the
# egress serves them on one event loop.
public_tunnels = 0
pending_headers = 0


async def read_request(reader):
    """The CONNECT target, counting this connection until its header arrives."""
    global pending_headers
    if pending_headers >= MAX_PENDING_HEADERS:
        raise ConnectionRefusedError("too many pending requests")
    pending_headers += 1
    try:
        headers = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), HEADER_TIMEOUT_S)
    finally:
        pending_headers -= 1
    return connect_target(headers.split(b"\r\n", 1)[0])


async def close_within(writer):
    """Closes a stream, giving it CLOSE_TIMEOUT_S to flush before aborting it."""
    if writer is None:
        return
    writer.close()
    try:
        await asyncio.wait_for(writer.wait_closed(), CLOSE_TIMEOUT_S)
    except (OSError, asyncio.TimeoutError):
        abort(writer)


def abort(writer):
    """Drops a stream at once, without waiting for a stalled peer to read buffered data."""
    transport = getattr(writer, "transport", None)
    if transport is not None:
        transport.abort()


async def handle(reader, client):
    global public_tunnels
    upstream = None
    tasks = []
    counted = False
    idle_expired = False
    try:
        host, port = await read_request(reader)
        provider = host in HOSTS and port == 443
        if not provider:
            check_public_syntax(host, port)
            # Counted before any DNS work, so idle or slow public tunnels can't crowd out the
            # provider, which is never counted.
            if public_tunnels >= MAX_PUBLIC_TUNNELS:
                raise Refused("too_many_connections")
            public_tunnels += 1
            counted = True
        addresses, guard = await checked_addresses(host, port)
        remote, upstream = await open_first(addresses, guard)
        client.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await client.drain()
        activity = Activity()
        tasks = [asyncio.create_task(copy(reader, upstream, activity)),
                 asyncio.create_task(copy(remote, client, activity))]
        watch = None
        if not provider:
            watch = asyncio.create_task(idle_watch(activity, PUBLIC_IDLE_TIMEOUT_S))
            tasks.append(watch)
        done, _running = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        idle_expired = watch in done
    except Refused as refusal:
        await refuse(client, refusal.reason)
    except (OSError, ValueError, asyncio.IncompleteReadError, asyncio.LimitOverrunError,
            asyncio.TimeoutError):
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if idle_expired:
            abort(upstream)
            abort(client)
        if counted:
            # A public tunnel keeps its slot until both streams are closed or aborted, so the
            # slot never outlives an open socket, even one flushing to a stalled peer.
            await close_within(upstream)
            await close_within(client)
            public_tunnels -= 1
        else:
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
