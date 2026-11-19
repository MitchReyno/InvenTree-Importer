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
# Each answer is watched during setup, so a larger answer set is refused before any dial.
MAX_ANSWERS = 32
# Public tunnels open at once, and how long one may sit without data before it closes. Provider
# tunnels have neither limit: model streams can pause for long stretches.
MAX_PUBLIC_TUNNELS = 32
# Provider tunnels have their own, larger budget: far above what a provider CLI opens at once,
# but enough to stop held connections exhausting the egress container's memory and files.
MAX_PROVIDER_TUNNELS = 64
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
    up the provider connection. The work is a pure lookup; its answer comes back to the loop.
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
# A provider CONNECT waits this long for protected-name refreshes; a name still refreshing
# after it blocks the addresses it has already answered with.
PROTECTED_LOOKUP_BUDGET_S = 2


class Tunnel:
    """One CONNECT's watched addresses and streams.

    Until the CONNECT is acknowledged it watches every answer; afterwards only the address it
    connected to. Revoking aborts its streams at once, so no relay writes after it.
    """

    def __init__(self, addresses, public_request):
        self.addresses = {normalized(address) for address in addresses}
        self.public_request = public_request
        self.revoked = False
        self.streams = []
        self.revocation = asyncio.Event()

    def revoke(self):
        if self.revoked:
            return
        self.revoked = True
        for writer in self.streams:
            abort(writer)
        self.revocation.set()


class TurnProtection:
    """The turn's protected addresses, failure latches and revocable tunnels.

    Everything here is read and changed only on the event loop. Resolver threads run lookups
    and hand their answers back, so a decision made between two awaits sees one consistent
    state, and a publication revokes every affected tunnel before any other coroutine runs.

    Every address a protected name answers with stays blocked for the rest of the turn, so a
    late or failed refresh never unblocks one. Each name has at most one refresh in flight.
    """

    def __init__(self):
        self.pool = ThreadPoolExecutor(max_workers=DNS_SLOTS, thread_name_prefix="protected-dns")
        self.known = {}
        self.recorded = 0
        # A protected name failed to resolve: public hosts are refused for the rest of the turn.
        self.failed = False
        # The turn's protected addresses passed their bound: every request is refused.
        self.overflowed = False
        self.in_flight = {}
        self.tunnels = set()

    def refresh(self, name):
        """The refresh of `name` in flight, started if there is none. Requests share it, and
        it publishes when it lands, even after they have stopped waiting."""
        task = self.in_flight.get(name)
        if task is None:
            task = asyncio.get_running_loop().create_task(self._refresh(name))
            self.in_flight[name] = task
        return task

    async def _refresh(self, name):
        """This lookup's public addresses for `name` and whether its answer was empty or held
        any private address; or None when the lookup fails."""
        try:
            answers = await asyncio.get_running_loop().run_in_executor(
                self.pool, resolved_addresses, name)
        except Refused:
            result = None
        else:
            # Blocked by the address each answer reaches, so an IPv4-mapped form blocks its
            # IPv4 address. The reason for a request to this name classifies the answers as
            # given, as the destination check does.
            addresses = {address for address in map(normalized, answers)
                         if public(str(address))}
            result = (addresses, not answers or not all(public(answer) for answer in answers))
        finally:
            self.in_flight.pop(name, None)
        self.publish(name, None if result is None else result[0])
        return result

    def publish(self, name, addresses):
        """Adds a successful answer for `name` to the addresses it blocks and revokes every
        tunnel watching one of them. A failed lookup, given as None, refuses public hosts for
        the rest of the turn and revokes every public tunnel."""
        if addresses is None:
            self.failed = True
            affected = [tunnel for tunnel in self.tunnels if tunnel.public_request]
        else:
            known = self.known.setdefault(name, set())
            added = set(addresses) - known
            if self.recorded + len(added) > MAX_PROTECTED_ADDRESSES:
                self.failed = self.overflowed = True
                affected = list(self.tunnels)
            else:
                known |= added
                self.recorded += len(added)
                affected = [tunnel for tunnel in self.tunnels if tunnel.addresses & added]
        for tunnel in affected:
            tunnel.revoke()

    def check_latches(self, public_request):
        """Refuses a request the turn's latches already rule out."""
        if self.overflowed or (public_request and self.failed):
            raise Refused("resolution_failed")

    def blocked(self, protected):
        """Every address the protected entries name or have answered with this turn."""
        literals = {literal for literal in map(literal_address, protected)
                    if literal is not None and public(str(literal))}
        return literals.union(*(self.known.get(entry, ()) for entry in protected))

    def register(self, addresses, public_request, protected):
        """A tunnel watching `addresses`, or Refused when they are already protected."""
        self.check_latches(public_request)
        blocked = self.blocked(protected)
        if any(normalized(address) in blocked for address in addresses):
            raise Refused("protected_destination")
        tunnel = Tunnel(addresses, public_request)
        self.tunnels.add(tunnel)
        return tunnel

    def verdict(self, tunnel):
        """Refuses a tunnel the turn's latches or a revocation have ruled out."""
        self.check_latches(tunnel.public_request)
        if tunnel.revoked:
            raise Refused("protected_destination")

    def acknowledge(self, tunnel, address, client):
        """Accepts the CONNECT: from now on the tunnel watches only the address it reached.
        A client refused here never joins the tunnel, so it keeps its stream for the 403."""
        self.verdict(tunnel)
        tunnel.addresses = {normalized(address)}
        tunnel.streams.append(client)
        client.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")

    def release(self, tunnel):
        self.tunnels.discard(tunnel)


PROTECTION = TurnProtection()


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


def protected_names(protected):
    """The protected entries that are DNS names, sorted so which name wins a resolver slot
    doesn't depend on hash order."""
    return sorted(entry for entry in protected if literal_address(entry) is None)


def protecting_name(host, protected):
    """The protected entry `host` falls under; the longest, when several do."""
    return max((entry for entry in protected if host == entry or host.endswith("." + entry)),
               key=len)


async def provider_addresses(host, protected):
    """The provider host's checked addresses, or Refused.

    Its own lookup and the protected refreshes run at the same time. The provider waits at
    most PROTECTED_LOOKUP_BUDGET_S for the refreshes; a name that fails or stalls is skipped
    here, and public access is refused separately.
    """
    if protected_name(host, protected):
        raise Refused("protected_destination")
    PROTECTION.check_latches(False)
    refreshes = [PROTECTION.refresh(name) for name in protected_names(protected)]
    budget = (asyncio.ensure_future(asyncio.wait(refreshes, timeout=PROTECTED_LOOKUP_BUDGET_S))
              if refreshes else None)
    try:
        addresses = await PROVIDER_DNS.run(provider_answers, host)
        if budget is not None:
            await budget
    except Refused:
        # Past the protected-address bound, every request reports that, whatever its DNS says.
        PROTECTION.check_latches(False)
        raise
    finally:
        # Cancelling the wait leaves the shared refreshes running.
        if budget is not None and not budget.done():
            budget.cancel()
            await asyncio.gather(budget, return_exceptions=True)
    PROTECTION.check_latches(False)
    if not addresses or not all(public(address) for address in addresses):
        raise Refused("not_public")
    blocked = PROTECTION.blocked(protected)
    if any(normalized(address) in blocked for address in addresses):
        raise Refused("protected_destination")
    return connection_order(addresses)


def current_protection():
    """This turn's policy and every protected entry: the environment's and the policy's."""
    policy = load_policy()
    return policy, PROTECTED | (policy["protected_hosts"] if policy else set())


def check_public_request(host, port, policy, protected):
    """Every DNS-free check for a public CONNECT, run before it takes a tunnel slot."""
    if policy is None or not policy["public_pages"]:
        raise Refused("destination_refused")
    check_public_form(host, port, protected)


async def public_addresses(host, port, protected):
    """The public destination's checked addresses, or Refused.

    Protected names refresh on the shared per-name pool while the destination resolves, and
    each refresh publishes when it lands, even after this request. A protected name asked for
    directly is answered by its own refresh, not looked up twice.
    """
    refreshes = {name: PROTECTION.refresh(name) for name in protected_names(protected)}
    exact = refreshes.get(host)
    target = None if exact else asyncio.ensure_future(
        PUBLIC_DNS.run(public_target, host, port, protected))
    overdue = set()
    addresses = None
    refusal = None
    try:
        if refreshes:
            # A refresh still running at the deadline refuses this request without failing
            # the turn; it keeps running and publishes when it lands.
            _landed, overdue = await asyncio.wait(refreshes.values(), timeout=DNS_TIMEOUT_S)
        if target is not None:
            try:
                addresses = await target
            except Refused as error:
                refusal = error
                if error.found:
                    # The refused subdomain's answers block aliases and open tunnels too.
                    PROTECTION.publish(protecting_name(host, protected), error.found)
    finally:
        # The destination lookup belongs to this request alone.
        if target is not None and not target.done():
            target.cancel()
            await asyncio.gather(target, return_exceptions=True)
    PROTECTION.check_latches(True)
    if exact is not None:
        # The name is protected whatever its lookup says, but an answer that held a private
        # address reports not_public, as it would for any other host.
        answer = None if exact in overdue else exact.result()
        raise Refused("not_public" if answer and answer[1] else "protected_destination")
    if overdue:
        raise Refused("resolution_failed")
    if refusal is not None:
        # A protected name stays protected when its lookup runs out of time or slots.
        if refusal.reason == "resolution_failed" and protected_name(host, protected):
            raise Refused("protected_destination") from None
        raise refusal
    blocked = PROTECTION.blocked(protected)
    if any(normalized(address) in blocked for address in addresses):
        raise Refused("protected_destination")
    return addresses


async def open_first(addresses, public_request, protected):
    """Connects to the first reachable checked address, trying at most a few.

    The returned tunnel watches every answer from before the first dial until the CONNECT is
    acknowledged, so a protected answer landing at any point refuses the host, even one for an
    address whose dial failed. Returns the tunnel, the address reached and its streams.
    """
    PROTECTION.check_latches(public_request)
    if len(addresses) > MAX_ANSWERS:
        raise Refused("destination_refused")
    tunnel = PROTECTION.register(addresses, public_request, protected)
    try:
        failure = OSError("no checked address")
        for address in addresses[:MAX_CONNECT_ATTEMPTS]:
            PROTECTION.verdict(tunnel)
            try:
                remote, upstream = await asyncio.wait_for(
                    asyncio.open_connection(address, 443), CONNECT_TIMEOUT_S)
            except (OSError, asyncio.TimeoutError) as error:
                failure = error
                continue
            try:
                PROTECTION.verdict(tunnel)
            except Refused:
                abort(upstream)
                upstream.close()
                raise
            tunnel.streams.append(upstream)
            return tunnel, address, remote, upstream
        # A protected answer found during the last dial keeps its refusal reason.
        PROTECTION.verdict(tunnel)
        raise DialFailed() from failure
    except BaseException:
        PROTECTION.release(tunnel)
        raise


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


async def copy(source, target, activity, tunnel):
    while data := await source.read(65536):
        if tunnel.revoked:
            return
        target.write(data)
        activity.touch()
        await target.drain()


async def idle_watch(activity, timeout):
    """Returns once the tunnel has carried no data either way for `timeout` seconds."""
    while (remaining := activity.last + timeout - time.monotonic()) > 0:
        await asyncio.sleep(remaining)


# Public CONNECTs being set up or tunnelling, and connections still sending their header; the
# egress serves them on one event loop.
public_tunnels = 0
provider_tunnels = 0
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


async def close_tunnel(writers, tunnel, drop):
    """Closes the streams within CLOSE_TIMEOUT_S and returns once none is still open,
    aborting any that are at the deadline or when the close is cancelled. `drop` aborts them
    at once. A revocation has already aborted the tunnel's own streams; any other stream, such
    as a refused client, keeps closing on the same budget.
    """
    def finished_by_revocation(writer):
        return tunnel is not None and tunnel.revoked and writer in tunnel.streams

    open_writers = [writer for writer in writers if not finished_by_revocation(writer)]
    if drop:
        for writer in open_writers:
            abort(writer)
        return
    deadline = time.monotonic() + CLOSE_TIMEOUT_S
    for writer in open_writers:
        writer.close()
    closes = {writer: asyncio.ensure_future(writer.wait_closed()) for writer in open_writers}
    revocation = (asyncio.ensure_future(tunnel.revocation.wait())
                  if tunnel is not None and not tunnel.revoked else None)

    def still_open():
        return [writer for writer, close in closes.items()
                if not close.done() and not finished_by_revocation(writer)]

    try:
        while still_open():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            waits = [closes[writer] for writer in still_open()]
            if revocation is not None and not revocation.done():
                waits.append(revocation)
            await asyncio.wait(waits, timeout=remaining, return_when=asyncio.FIRST_COMPLETED)
        for writer in still_open():
            abort(writer)
    except asyncio.CancelledError:
        # A cancelled close still leaves no stream open behind the slot it gives back.
        for writer in still_open():
            abort(writer)
        raise
    finally:
        leftovers = [*closes.values(), *([revocation] if revocation is not None else [])]
        for task in leftovers:
            task.cancel()
        await asyncio.gather(*leftovers, return_exceptions=True)


def abort(writer):
    """Drops a stream at once, without waiting for a stalled peer to read buffered data."""
    transport = getattr(writer, "transport", None)
    if transport is not None:
        transport.abort()


async def handle(reader, client):
    global public_tunnels, provider_tunnels
    upstream = None
    tunnel = None
    tasks = []
    counted = False
    counted_provider = False
    drop = False
    try:
        host, port = await read_request(reader)
        provider = host in HOSTS and port == 443
        policy, protected = current_protection()
        if provider:
            if provider_tunnels >= MAX_PROVIDER_TUNNELS:
                raise Refused("too_many_connections")
            provider_tunnels += 1
            counted_provider = True
            addresses = await provider_addresses(host, protected)
        else:
            check_public_request(host, port, policy, protected)
            PROTECTION.check_latches(True)
            # Counted before any DNS work, so idle or slow public tunnels can't crowd out the
            # provider, which has its own budget.
            if public_tunnels >= MAX_PUBLIC_TUNNELS:
                raise Refused("too_many_connections")
            public_tunnels += 1
            counted = True
            addresses = await public_addresses(host, port, protected)
        tunnel, address, remote, upstream = await open_first(addresses, not provider, protected)
        PROTECTION.acknowledge(tunnel, address, client)
        await client.drain()
        activity = Activity()
        tasks = [asyncio.create_task(copy(reader, upstream, activity, tunnel)),
                 asyncio.create_task(copy(remote, client, activity, tunnel))]
        watches = [asyncio.create_task(tunnel.revocation.wait())]
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
        # The tunnel stays watched until both streams are closed or aborted, and a public
        # tunnel keeps its slot until then, so neither outlives a socket still flushing.
        streams = [writer for writer in (upstream, client) if writer]
        closing = False
        try:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            closing = True
            await close_tunnel(streams, tunnel, drop)
        except asyncio.CancelledError:
            # Cancelled before the close began: nothing has closed the streams, so abort them.
            # A close cancelled midway has already aborted what was open.
            if not closing:
                for writer in streams:
                    abort(writer)
            raise
        finally:
            if tunnel is not None:
                PROTECTION.release(tunnel)
            if counted:
                public_tunnels -= 1
            if counted_provider:
                provider_tunnels -= 1


async def main():
    os.umask(0o077)
    SOCKET.unlink(missing_ok=True)
    server = await asyncio.start_unix_server(handle, SOCKET, limit=8192)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
