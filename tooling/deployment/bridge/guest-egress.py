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


class Revocation:
    """Marks a tunnel's address protected. Marking takes effect as the resolver publishes, and
    every relay write checks it under the same lock, so no byte is relayed after an answer is
    published. The streams are then aborted on the event loop."""

    def __init__(self):
        self.loop = asyncio.get_running_loop()
        self.lock = threading.Lock()
        self.revoked = False
        self.event = asyncio.Event()
        self.streams = []

    def mark(self):
        """Revokes the tunnel; called from any thread."""
        with self.lock:
            self.revoked = True
        self.loop.call_soon_threadsafe(self.fire)

    def fire(self):
        self.event.set()
        for writer in self.streams:
            abort(writer)

    def is_set(self):
        with self.lock:
            return self.revoked

    def write(self, target, data):
        """Writes `data` unless the tunnel is revoked; returns whether it wrote."""
        with self.lock:
            if self.revoked:
                return False
            target.write(data)
            return True

    async def wait(self):
        await self.event.wait()


class ProtectedLookups:
    """Protected-name addresses for provider CONNECTs.

    Every CONNECT refreshes each name, joining a refresh already in flight, so a name that
    moves is blocked at its new address straight away. Every address a name has answered
    with stays blocked for the rest of the turn, whichever lookup finished last, so a late or
    failed refresh never unblocks one. Each name has at most one refresh in flight and a turn
    has at most a few dozen names, so the work stays bounded.
    """

    def __init__(self):
        self.pool = ThreadPoolExecutor(max_workers=DNS_SLOTS, thread_name_prefix="protected-dns")
        self.lock = threading.Lock()
        self.known = {}
        self.in_flight = {}
        # Set once a protected name fails to resolve: public hosts are refused for the turn.
        # Read it only under the lock, so a failure is seen together with its revocations.
        self.failed = False
        # Open provider tunnels: their connected address and the event that drops them.
        self.tunnels = {}

    def resolve(self, name):
        """Fresh addresses for `name`, or None when the lookup fails."""
        try:
            addresses = protected_addresses({name})
        except Refused:
            addresses = None
        self.publish(name, addresses)
        with self.lock:
            self.in_flight.pop(name, None)
        return addresses

    def publish(self, name, addresses):
        """Adds a successful answer for `name`, from either path, to the addresses it blocks
        and revokes every tunnel to one of them. A failed lookup, given as None, refuses
        public hosts for the rest of the turn."""
        with self.lock:
            if addresses is None:
                self.failed = True
                for _address, revocation, public_request in self.tunnels.values():
                    if public_request:
                        revocation.mark()
                return
            self.known[name] = self.known.get(name, set()) | set(addresses)
            for address, revocation, _public_request in self.tunnels.values():
                if address in addresses:
                    revocation.mark()

    def watch(self, address, public_request):
        """A Revocation fired once any protected lookup shows `address` is protected, or, for
        a public request, once a protected lookup fails; and a function that stops watching.
        Register before the first check, so no update falls between them."""
        revocation = Revocation()
        with self.lock:
            self.tunnels[revocation] = (normalized(address), revocation, public_request)

        def stop():
            with self.lock:
                self.tunnels.pop(revocation, None)

        return revocation, stop

    def verdict(self, revocations, public_request):
        """Refuses a public request once a protected lookup has failed, then any request whose
        answers were revoked during setup. Call with the publication lock held."""
        if public_request and self.failed:
            raise Refused("resolution_failed")
        if any(revocation.is_set() for revocation in revocations):
            raise Refused("protected_destination")

    def check(self, revocations, public_request):
        """The setup verdict, decided under the publication lock so its reason is consistent."""
        with self.lock:
            self.verdict(revocations, public_request)

    def settle(self, revocations, kept, public_request):
        """The setup verdict, then stops watching every answer but `kept`. One step under the
        publication lock, so nothing is published in between."""
        with self.lock:
            self.verdict(revocations, public_request)
            for revocation in revocations:
                if revocation is not kept:
                    self.tunnels.pop(revocation, None)

    def refresh(self, name):
        """Every address the name has answered with and its refresh in flight."""
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
            blocked |= known | (fresh or set())
        return blocked

    def latest(self, protected):
        """Every address a protected name has answered with this turn, including lookups that
        finished after their budget."""
        with self.lock:
            return set().union(*(self.known.get(entry, set()) for entry in protected))

    def has_failed(self):
        with self.lock:
            return self.failed

    def guard(self, address, protected, public_request):
        """Refuses a public request once a protected lookup has failed, then an address any
        protected name has answered with this turn, as one step under the publication lock."""
        with self.lock:
            if public_request and self.failed:
                raise Refused("resolution_failed")
            blocked = set().union(*(self.known.get(entry, set()) for entry in protected))
        if normalized(address) in blocked:
            raise Refused("protected_destination")


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
    blocked = await deny
    # Lookups that finished after the budget, while the provider lookup ran, still count.
    blocked |= PROTECTED_LOOKUPS.latest(protected)
    if not addresses or not all(public(address) for address in addresses):
        raise Refused("not_public")
    if any(normalized(address) in blocked for address in addresses):
        raise Refused("protected_destination")
    return connection_order(addresses)


def protection_guard(protected, public_request):
    """Refuses an address that a protected lookup has found since it was checked, and a public
    request once a protected lookup has failed this turn."""
    def guard(address):
        PROTECTED_LOOKUPS.guard(address, protected, public_request)
    return guard


def current_protection():
    """This turn's policy and every protected entry: the environment's and the policy's."""
    policy = load_policy()
    return policy, PROTECTED | (policy["protected_hosts"] if policy else set())


def check_public_request(host, port, policy, protected):
    """Every DNS-free check for a public CONNECT, run before it takes a tunnel slot."""
    if policy is None or not policy["public_pages"]:
        raise Refused("destination_refused")
    check_public_form(host, port, protected)
    if PROTECTED_LOOKUPS.has_failed():
        raise Refused("resolution_failed")


async def checked_addresses(host, port, provider, protected):
    """Addresses to try, in order, all of them checked, and a recheck to run around each dial;
    or Refused."""
    if provider:
        return await provider_addresses(host, protected), protection_guard(protected, False)
    try:
        # Other connections' lookups can still protect this address before or after the dial.
        addresses = await PUBLIC_DNS.run(
            public_target, host, port, protected, PROTECTED_LOOKUPS.publish)
        return addresses, protection_guard(protected, True)
    except Refused as refusal:
        # Once a protected lookup has failed, every public refusal reports that first.
        if PROTECTED_LOOKUPS.has_failed():
            raise Refused("resolution_failed") from None
        # A protected name stays protected when its lookup runs out of time or slots.
        if refusal.reason == "resolution_failed" and protected_name(host, protected):
            raise Refused("protected_destination") from None
        raise


async def open_first(addresses, guard, public_request):
    """Connects to the first reachable checked address, trying at most a few.

    Every answer is watched from before the first dial until setup ends, and the connected
    one until the tunnel closes, so a protected lookup finishing at any point refuses the
    host, even when it names an address whose dial failed. Returns the streams, the
    Revocation that drops them and the function that stops watching.
    """
    watches = [PROTECTED_LOOKUPS.watch(address, public_request) for address in addresses]

    def check():
        for address in addresses:
            guard(address)
        PROTECTED_LOOKUPS.check([watched for watched, _stop in watches], public_request)

    kept = None
    try:
        failure = OSError("no checked address")
        for index, address in enumerate(addresses[:MAX_CONNECT_ATTEMPTS]):
            check()
            try:
                remote, upstream = await asyncio.wait_for(
                    asyncio.open_connection(address, 443), CONNECT_TIMEOUT_S)
            except (OSError, asyncio.TimeoutError) as error:
                failure = error
                continue
            revocation, stop_watching = watches[index]
            revocation.streams.append(upstream)
            try:
                check()
                PROTECTED_LOOKUPS.settle([watched for watched, _stop in watches], revocation,
                                         public_request)
            except Refused:
                abort(upstream)
                upstream.close()
                raise
            kept = index
            return remote, upstream, revocation, stop_watching
        # A protected answer found during the last dial keeps its refusal reason.
        check()
        raise failure
    finally:
        for index, (_revocation, stop) in enumerate(watches):
            if index != kept:
                stop()


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


async def copy(source, target, activity, revoked):
    while data := await source.read(65536):
        if not revoked.write(target, data):
            return
        activity.touch()
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


async def close_tunnel(writers, revoked, drop):
    """Closes the streams, giving them CLOSE_TIMEOUT_S to flush, and aborts them at once when
    `drop` is set or at the deadline. A fired `revoked`, even mid-close, has aborted them."""
    def fired():
        return revoked is not None and revoked.is_set()

    if fired():
        return
    if drop:
        for writer in writers:
            abort(writer)
        return
    for writer in writers:
        writer.close()
    closing = asyncio.ensure_future(asyncio.gather(
        *(writer.wait_closed() for writer in writers), return_exceptions=True))
    waits = [closing]
    if revoked is not None:
        waits.append(asyncio.create_task(revoked.wait()))
    done, pending = await asyncio.wait(waits, timeout=CLOSE_TIMEOUT_S,
                                       return_when=asyncio.FIRST_COMPLETED)
    for waiter in pending:
        waiter.cancel()
    await asyncio.gather(*pending, return_exceptions=True)
    if closing not in done and not fired():
        for writer in writers:
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
    drop = False
    revoked = None
    stop_watching = None
    try:
        host, port = await read_request(reader)
        provider = host in HOSTS and port == 443
        policy, protected = current_protection()
        if not provider:
            check_public_request(host, port, policy, protected)
            # Counted before any DNS work, so idle or slow public tunnels can't crowd out the
            # provider, which is never counted.
            if public_tunnels >= MAX_PUBLIC_TUNNELS:
                raise Refused("too_many_connections")
            public_tunnels += 1
            counted = True
        addresses, guard = await checked_addresses(host, port, provider, protected)
        remote, upstream, revoked, stop_watching = await open_first(addresses, guard, not provider)
        revoked.streams.append(client)
        client.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await client.drain()
        activity = Activity()
        tasks = [asyncio.create_task(copy(reader, upstream, activity, revoked)),
                 asyncio.create_task(copy(remote, client, activity, revoked))]
        watches = [asyncio.create_task(revoked.wait())]
        if not provider:
            watches.append(asyncio.create_task(idle_watch(activity, PUBLIC_IDLE_TIMEOUT_S)))
        tasks += watches
        done, _running = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        # An idle tunnel, or one to an address now known to be protected, is dropped at once.
        drop = any(watch in done for watch in watches)
    except Refused as refusal:
        await refuse(client, refusal.reason)
    except (OSError, ValueError, asyncio.IncompleteReadError, asyncio.LimitOverrunError,
            asyncio.TimeoutError):
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        # The address stays watched until both streams are closed or aborted, and a public
        # tunnel keeps its slot until then, so neither outlives a socket still flushing.
        await close_tunnel([writer for writer in (upstream, client) if writer], revoked, drop)
        if stop_watching:
            stop_watching()
        if counted:
            public_tunnels -= 1


async def main():
    os.umask(0o077)
    SOCKET.unlink(missing_ok=True)
    server = await asyncio.start_unix_server(handle, SOCKET, limit=8192)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
