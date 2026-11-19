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
    protected_name,
    public,
    public_target,
    resolved_addresses,
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
# Each answer is watched during setup, so a larger answer set is refused before any watch.
MAX_ANSWERS = 32
# Public tunnels open at once, and how long one may sit without data before it closes. Provider
# tunnels have neither limit: model streams can pause for long stretches.
MAX_PUBLIC_TUNNELS = 32
# Every address protected names answer with stays blocked for the turn; past this many the
# turn fails closed rather than grow without bound.
MAX_PROTECTED_ADDRESSES = 1024
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
    """Marks a tunnel's address protected. Revocation happens under the publication lock, and
    every relay write checks it under that same lock, so once an answer is published no tunnel
    it affects relays another byte. The streams are then aborted on the event loop."""

    def __init__(self, lock):
        self.loop = asyncio.get_running_loop()
        self.lock = lock
        self.revoked = False
        self.event = asyncio.Event()
        self.streams = []

    def revoke(self):
        """Revokes the tunnel. The caller holds the publication lock."""
        self.revoked = True

    def schedule_abort(self):
        """Aborts the tunnel's streams on its event loop; called from any thread."""
        self.loop.call_soon_threadsafe(self.fire)

    def fire(self):
        """Aborts the streams, then sets the event, so the event means they are aborted."""
        for writer in self.streams:
            abort(writer)
        self.event.set()

    def is_set(self):
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
        # Set once the turn's protected addresses pass their bound: every request is refused.
        self.overflowed = False
        self.recorded = 0
        # Open provider tunnels: their connected address and the event that drops them.
        self.tunnels = {}

    def resolve(self, name):
        """This lookup's public addresses for `name` and whether its answer was empty or held
        any private address; or None when the lookup fails."""
        try:
            answers = resolved_addresses(name)
        except Refused:
            addresses = None
            result = None
        else:
            # Blocked by the address each answer reaches, so an IPv4-mapped form blocks its
            # IPv4 address; a private address is already refused by address. The reason for a
            # request to this name classifies the answers as given, as the destination check does.
            addresses = {address for address in map(normalized, answers)
                         if public(str(address))}
            result = (addresses, not answers or not all(public(answer) for answer in answers))
        self.publish(name, addresses)
        with self.lock:
            self.in_flight.pop(name, None)
        return result

    def publish(self, name, addresses):
        """Adds a successful answer for `name`, from either path, to the addresses it blocks
        and revokes every tunnel to one of them. A failed lookup, given as None, refuses
        public hosts for the rest of the turn."""
        with self.lock:
            if addresses is None:
                self.failed = True
                affected = [revocation for _address, revocation, public_request
                            in self.tunnels.values() if public_request]
            else:
                known = self.known.setdefault(name, set())
                added = set(addresses) - known
                if self.recorded + len(added) > MAX_PROTECTED_ADDRESSES:
                    self.failed = self.overflowed = True
                    affected = [revocation for _address, revocation, _public_request
                                in self.tunnels.values()]
                else:
                    known |= added
                    self.recorded += len(added)
                    affected = [revocation for address, revocation, _public_request
                                in self.tunnels.values() if address in addresses]
            # Every affected tunnel is revoked before any abort is queued, each only once.
            affected = [revocation for revocation in affected if not revocation.revoked]
            for revocation in affected:
                revocation.revoke()
            for revocation in affected:
                revocation.schedule_abort()

    def watch(self, address, public_request):
        """A Revocation fired once any protected lookup shows `address` is protected, or, for
        a public request, once a protected lookup fails; and a function that stops watching.
        Register before the first check, so no update falls between them."""
        revocation = Revocation(self.lock)
        with self.lock:
            self.tunnels[revocation] = (normalized(address), revocation, public_request)

        def stop():
            with self.lock:
                self.tunnels.pop(revocation, None)

        return revocation, stop

    def verdict(self, revocations, public_request):
        """Refuses a public request once a protected lookup has failed, then any request whose
        answers were revoked during setup. Call with the publication lock held."""
        if self.overflowed or (public_request and self.failed):
            raise Refused("resolution_failed")
        if any(revocation.is_set() for revocation in revocations):
            raise Refused("protected_destination")

    def check(self, revocations, public_request):
        """The setup verdict, decided under the publication lock so its reason is consistent."""
        with self.lock:
            self.verdict(revocations, public_request)

    def acknowledge(self, revocations, kept, public_request, client):
        """The last verdict over every answer, then the 200, then stops watching every answer
        but `kept`: one step under the publication lock, so no answer lands in between. A
        refused client never joins the tunnel, so it keeps its stream for the 403."""
        with self.lock:
            self.verdict(revocations, public_request)
            kept.streams.append(client)
            client.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            for revocation in revocations:
                if revocation is not kept:
                    self.tunnels.pop(revocation, None)

    def refresh(self, name):
        """Every address the name has answered with and its refresh in flight. Requests joining
        a refresh share one event-loop future, so a stalled lookup gains no waiters per request."""
        with self.lock:
            if name not in self.in_flight:
                self.in_flight[name] = asyncio.wrap_future(self.pool.submit(self.resolve, name))
            return self.known.get(name, set()), self.in_flight[name]

    async def deny_set(self, protected):
        blocked = set()
        refreshes = []
        # Sorted, so which names win a resolver slot doesn't depend on hash order.
        for entry in sorted(protected):
            literal = literal_address(entry)
            if literal is not None:
                if public(str(literal)):
                    blocked.add(literal)
                continue
            refreshes.append(self.refresh(entry))
        if refreshes:
            await asyncio.wait([waiter for _known, waiter in refreshes],
                               timeout=PROTECTED_LOOKUP_BUDGET_S)
        for known, waiter in refreshes:
            fresh = waiter.result() if waiter.done() else None
            blocked |= known | (fresh[0] if fresh else set())
        return blocked

    def latest(self, protected):
        """Every address a protected name has answered with this turn, including lookups that
        finished after their budget."""
        with self.lock:
            return set().union(*(self.known.get(entry, set()) for entry in protected))

    def check_overflow(self):
        """Refuses every request once the turn's protected addresses have passed their bound."""
        with self.lock:
            if self.overflowed:
                raise Refused("resolution_failed")

    def has_failed(self):
        with self.lock:
            return self.failed

    def guard(self, address, protected, public_request):
        """Refuses a public request once a protected lookup has failed, then an address any
        protected name has answered with this turn, as one step under the publication lock."""
        address = normalized(address)
        with self.lock:
            if self.overflowed or (public_request and self.failed):
                raise Refused("resolution_failed")
            if any(address in self.known.get(entry, ()) for entry in protected):
                raise Refused("protected_destination")


PROTECTED_LOOKUPS = ProtectedLookups()


def protected_entry(value):
    # A zone such as `%eth0` would stop the literal matching the same unscoped address.
    return isinstance(value, str) and "%" not in value and (
        dns_name(value) or literal_address(value) is not None)


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
        # An absolute name, so no search domain can supply the answer.
        answers = socket.getaddrinfo(host + ".", 443, family=socket.AF_INET,
                                     type=socket.SOCK_STREAM)
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


async def checked_addresses(host, port, provider, protected):
    """Addresses to try, in order, all of them checked, and a recheck to run around each dial;
    or Refused."""
    if provider:
        # Past the protected-address bound, every request reports that, whatever its DNS says.
        PROTECTED_LOOKUPS.check_overflow()
        try:
            addresses = await provider_addresses(host, protected)
        except Refused:
            PROTECTED_LOOKUPS.check_overflow()
            raise
        return addresses, protection_guard(protected, False)
    # Protected names refresh on the shared per-name pool, joining any refresh in flight, while
    # the destination resolves; each refresh publishes when it lands, even after this request.
    # Sorted, so which names win a resolver slot doesn't depend on hash order.
    refreshes = {entry: PROTECTED_LOOKUPS.refresh(entry)[1] for entry in sorted(protected)
                 if literal_address(entry) is None}
    # A protected name asked for directly is answered by its own refresh, not looked up twice.
    exact = refreshes.get(host)
    target = None if exact else asyncio.ensure_future(PUBLIC_DNS.run(
        public_target, host, port, protected))
    # Refreshes still running at the deadline stay overdue for this request, even if they land
    # while the destination lookup finishes; they keep running and publish when they do.
    overdue = set()
    if refreshes:
        _landed, overdue = await asyncio.wait(refreshes.values(), timeout=DNS_TIMEOUT_S)
    refusal = None
    if target is not None:
        try:
            addresses = await target
        except Refused as error:
            refusal = error
    # Once a protected lookup has failed, every public refusal reports that first; a refresh
    # still running at the deadline refuses this request without failing the turn.
    if exact is not None:
        # The name is protected whatever its lookup says, but the answer this request waited on
        # reports not_public if it held any private address, as it would for any other host.
        answer = None if exact in overdue else exact.result()
        with PROTECTED_LOOKUPS.lock:
            if PROTECTED_LOOKUPS.failed:
                raise Refused("resolution_failed")
        raise Refused("not_public" if answer and answer[1] else "protected_destination")
    literals = {literal for literal in map(literal_address, protected)
                if literal is not None and public(str(literal))}
    # One decision under the publication lock, so a failure latched at any point before it
    # takes precedence over every other reason.
    with PROTECTED_LOOKUPS.lock:
        if PROTECTED_LOOKUPS.failed:
            raise Refused("resolution_failed")
        if overdue:
            raise Refused("resolution_failed")
        if refusal is not None:
            # A protected name stays protected when its lookup runs out of time or slots.
            if refusal.reason == "resolution_failed" and protected_name(host, protected):
                raise Refused("protected_destination") from None
            raise refusal
        blocked = literals.union(*(PROTECTED_LOOKUPS.known.get(entry, ()) for entry in protected))
        if any(normalized(address) in blocked for address in addresses):
            raise Refused("protected_destination")
    # Other connections' lookups can still protect this address before or after the dial.
    return addresses, protection_guard(protected, True)


async def open_first(addresses, guard, public_request):
    """Connects to the first reachable checked address, trying at most a few.

    Every answer is watched from before the first dial until the CONNECT is acknowledged, and
    the connected one until the tunnel closes, so a protected lookup finishing at any point
    refuses the host, even when it names an address whose dial failed. Returns the streams,
    the connected answer's Revocation and every answer's watch, which the caller stops.
    """
    # A latched failure or overflow reports itself ahead of the answer limit.
    with PROTECTED_LOOKUPS.lock:
        PROTECTED_LOOKUPS.verdict([], public_request)
        if len(addresses) > MAX_ANSWERS:
            raise Refused("destination_refused")
    watches = [PROTECTED_LOOKUPS.watch(address, public_request) for address in addresses]

    def check():
        for address in addresses:
            guard(address)
        PROTECTED_LOOKUPS.check([watched for watched, _stop in watches], public_request)

    handed_over = False
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
            revocation, _stop = watches[index]
            revocation.streams.append(upstream)
            try:
                check()
            except Refused:
                abort(upstream)
                upstream.close()
                raise
            handed_over = True
            return remote, upstream, revocation, watches
        # A protected answer found during the last dial keeps its refusal reason.
        check()
        raise DialFailed() from failure
    finally:
        if not handed_over:
            for _revocation, stop in watches:
                stop()


class DialFailed(Exception):
    """Every checked address failed to connect."""


async def bad_gateway(client):
    client.write(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
    await client.drain()


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
    """Closes the streams within CLOSE_TIMEOUT_S, aborting whatever is still open at the
    deadline, and returns only once none is outstanding. `drop` aborts them at once. A
    revocation aborts the tunnel's own streams, and the close waits for that abort; a stream
    that never joined the tunnel, such as a refused client, keeps closing on the same budget.
    """
    deadline = time.monotonic() + CLOSE_TIMEOUT_S

    def in_tunnel(writer):
        return revoked is not None and writer in revoked.streams

    def revoking():
        return revoked is not None and revoked.is_set()

    # A revoked tunnel's own streams are left to the revocation's abort.
    own = [writer for writer in writers if not (revoking() and in_tunnel(writer))]
    if drop:
        for writer in own:
            abort(writer)
        graceful = []
    else:
        graceful = own
    for writer in graceful:
        writer.close()
    closes = {writer: asyncio.ensure_future(writer.wait_closed()) for writer in graceful}
    aborted = asyncio.ensure_future(revoked.wait()) if revoked is not None else None
    # Writers no longer awaited; their tasks stay in `closes` so each result is collected.
    finished = set()
    try:
        while True:
            if aborted is not None and aborted.done():
                # The revocation's abort has run: the tunnel's own streams are finished.
                finished |= {writer for writer in closes if in_tunnel(writer)}
            outstanding = [close for writer, close in closes.items()
                           if writer not in finished and not close.done()]
            awaiting_abort = revoking() and not aborted.done()
            remaining = deadline - time.monotonic()
            if not outstanding and not awaiting_abort:
                return
            if remaining <= 0:
                break
            waits = outstanding + ([aborted] if aborted is not None and not aborted.done() else [])
            await asyncio.wait(waits, timeout=remaining, return_when=asyncio.FIRST_COMPLETED)
        # The deadline passed: abort every stream still open, each once.
        stuck = {writer for writer, close in closes.items()
                 if writer not in finished and not close.done()}
        if revoking() and not aborted.done():
            stuck |= {writer for writer in writers if in_tunnel(writer)}
        for writer in writers:
            if writer in stuck:
                abort(writer)
    except asyncio.CancelledError:
        # A cancelled close still leaves no stream open behind the slot it gives back.
        for writer in writers:
            if writer not in finished and not (writer in closes and closes[writer].done()):
                abort(writer)
        raise
    finally:
        leftovers = [*closes.values(), *([aborted] if aborted is not None else [])]
        for task in leftovers:
            task.cancel()
        await asyncio.gather(*leftovers, return_exceptions=True)


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
    answer_watches = []
    try:
        host, port = await read_request(reader)
        provider = host in HOSTS and port == 443
        policy, protected = current_protection()
        if not provider:
            check_public_request(host, port, policy, protected)
            # Counted before any DNS work, so idle or slow public tunnels can't crowd out the
            # provider, which is never counted. The latch and the slot are decided together,
            # so a failure latched at the cap still reports itself.
            with PROTECTED_LOOKUPS.lock:
                if PROTECTED_LOOKUPS.failed:
                    raise Refused("resolution_failed")
                if public_tunnels >= MAX_PUBLIC_TUNNELS:
                    raise Refused("too_many_connections")
                public_tunnels += 1
                counted = True
        addresses, guard = await checked_addresses(host, port, provider, protected)
        remote, upstream, revoked, answer_watches = await open_first(
            addresses, guard, not provider)
        PROTECTED_LOOKUPS.acknowledge([watched for watched, _stop in answer_watches], revoked,
                                      not provider, client)
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
    except DialFailed:
        # Not a policy decision, so no refusal reason: the destination didn't answer.
        await bad_gateway(client)
    except (OSError, ValueError, asyncio.IncompleteReadError, asyncio.LimitOverrunError,
            asyncio.TimeoutError):
        pass
    finally:
        # The address stays watched until both streams are closed or aborted, and a public
        # tunnel keeps its slot until then, so neither outlives a socket still flushing.
        streams = [writer for writer in (upstream, client) if writer]
        closing = False
        try:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            closing = True
            await close_tunnel(streams, revoked, drop)
        except asyncio.CancelledError:
            # Cancelled before the close began: nothing has closed the streams, so abort them.
            # A close cancelled midway has already aborted what was open.
            if not closing:
                for writer in streams:
                    abort(writer)
            raise
        finally:
            # Even a cancelled teardown gives back the watches and the slot.
            for _revocation, stop in answer_watches:
                stop()
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
