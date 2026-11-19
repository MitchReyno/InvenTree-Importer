"""Per-turn egress policy with synthetic DNS. No network connection is opened."""
import asyncio
import importlib.util
import json
from pathlib import Path
import socket
import sys
from contextlib import contextmanager
from tempfile import TemporaryDirectory
import threading
import time
import unittest
from unittest.mock import AsyncMock, Mock, patch

BRIDGE = Path(__file__).resolve().parents[1] / "bridge"
sys.path.insert(0, str(BRIDGE))
spec = importlib.util.spec_from_file_location("guest_egress", BRIDGE / "guest-egress.py")
egress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(egress)

PUBLIC = "93.184.216.34"
OTHER_PUBLIC = "1.1.1.1"


def answers(*addresses):
    return [(socket.AF_INET6 if ":" in a else socket.AF_INET, socket.SOCK_STREAM, 6, "", (a, 443))
            for a in addresses]


def stream_writer():
    """A StreamWriter stand-in whose drain and close complete at once."""
    writer = Mock()
    writer.drain = AsyncMock()
    writer.wait_closed = AsyncMock()
    return writer


def dns(table, stalled=None, delays=None):
    """A getaddrinfo stand-in: unknown names fail like an NXDOMAIN answer.

    A name in `stalled` blocks until its event is set, like an unresponsive resolver; a name in
    `delays` answers after that many seconds. An absolute name (`name.`) uses its own entry when
    the table has one, and otherwise the entry for the same name without the dot.
    """
    def lookup(host, *_args, **_kwargs):
        if host not in table:
            host = host.rstrip(".")
        if stalled and host in stalled:
            stalled[host].wait(10)
        if delays and host in delays:
            time.sleep(delays[host])
        if host not in table:
            raise socket.gaierror(socket.EAI_NONAME, "unknown name")
        return answers(*table[host])
    return lookup



class PublishOnRelease:
    """Wraps the publication lock: the first release after `then` is set runs it."""

    def __init__(self, lock):
        self.lock = lock
        self.then = None

    def __enter__(self):
        self.lock.acquire()

    def __exit__(self, *_exc):
        self.lock.release()
        then, self.then = self.then, None
        if then:
            then()

class EgressPolicy(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.policy = Path(self.directory.name) / "policy.json"
        patches = [
            patch.object(egress, "POLICY_PATH", self.policy),
            patch.object(egress, "PROTECTED", set()),
            patch.object(egress, "HOSTS", {"api.anthropic.com"}),
        ]
        # Each test gets its own lookup pools, so one test's stalled lookups can't hold slots
        # in the next. Cleanups run last-in first-out: the tests' releases run before these.
        pools = {"PROTECTED_LOOKUPS": egress.ProtectedLookups(),
                 "PROVIDER_DNS": egress.BoundedResolver("test-provider-dns"),
                 "PUBLIC_DNS": egress.BoundedResolver("test-public-dns")}
        for name, pool in pools.items():
            patches.append(patch.object(egress, name, pool))
            self.addCleanup(pool.pool.shutdown, wait=True)
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        self.addCleanup(self.directory.cleanup)

    def write_policy(self, public_pages=True, protected_hosts=()):
        self.policy.write_text(json.dumps({
            "version": 1,
            "public_pages": public_pages,
            "protected_hosts": list(protected_hosts),
        }))

    async def connect(self, target, table, open_results=None, stalled=None, delays=None):
        """One CONNECT through the proxy with fake DNS and a fake upstream."""
        with self.fake_network(table, open_results, stalled, delays) as upstream:
            written = await self.handle(target)
        return written, upstream

    @contextmanager
    def fake_network(self, table, open_results=None, stalled=None, delays=None):
        """Patches DNS and upstream connections once; concurrent CONNECTs share it."""
        remote = asyncio.StreamReader()
        remote.feed_eof()
        upstream_writer = stream_writer()
        self.guest_dns = Mock(side_effect=dns(table, stalled, delays))
        opened = AsyncMock(side_effect=open_results(remote, upstream_writer) if open_results else None,
                           return_value=(remote, upstream_writer))
        with patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection", opened) as upstream:
            yield upstream

    async def handle(self, target):
        stream = asyncio.StreamReader()
        stream.feed_data(f"CONNECT {target} HTTP/1.1\r\n\r\n".encode())
        stream.feed_eof()
        client = stream_writer()
        await egress.handle(stream, client)
        client.close.assert_called_once()
        self.lookups = self.guest_dns.call_count
        return b"".join(call.args[0] for call in client.write.call_args_list)

    def assert_refused(self, written, upstream, reason):
        self.assertTrue(written.startswith(b"HTTP/1.1 403"), written)
        self.assertIn(f"X-Bench-Refusal: {reason}\r\n".encode(), written)
        upstream.assert_not_called()

    def assert_connected(self, written, upstream, address):
        self.assertTrue(written.startswith(b"HTTP/1.1 200"), written)
        upstream.assert_called_once_with(address, 443)

    async def test_provider_host_is_allowed_with_and_without_a_policy(self):
        table = {"api.anthropic.com": [OTHER_PUBLIC]}
        written, upstream = await self.connect("api.anthropic.com:443", table)
        self.assert_connected(written, upstream, OTHER_PUBLIC)
        self.write_policy(public_pages=False)
        written, upstream = await self.connect("api.anthropic.com:443", table)
        self.assert_connected(written, upstream, OTHER_PUBLIC)

    async def test_public_host_is_refused_without_policy_or_with_web_off(self):
        table = {"www.ti.com": [PUBLIC]}
        written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "destination_refused")
        self.write_policy(public_pages=False)
        written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "destination_refused")

    async def test_malformed_policy_means_provider_only(self):
        table = {"www.ti.com": [PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        for content in ("not json", json.dumps({"version": 1, "public_pages": "yes", "protected_hosts": []}),
                        json.dumps({"version": 2, "public_pages": True, "protected_hosts": []}),
                        json.dumps({"version": 1, "public_pages": True, "protected_hosts": ["Bad Host"]}),
                        json.dumps({"version": 1, "public_pages": True,
                                    "protected_hosts": ["2606:4700::1111%eth0"]}),
                        json.dumps({"version": True, "public_pages": True, "protected_hosts": []}),
                        json.dumps({"version": 1, "public_pages": True, "protected_hosts": [], "extra": 1}),
                        '{"version": 1, "public_pages": false, "public_pages": true, "protected_hosts": []}',
                        "[" * 8000 + "]" * 8000):
            with self.subTest(content=content):
                self.policy.write_text(content)
                written, upstream = await self.connect("www.ti.com:443", table)
                self.assert_refused(written, upstream, "destination_refused")
                written, upstream = await self.connect("api.anthropic.com:443", table)
                self.assert_connected(written, upstream, OTHER_PUBLIC)

    async def test_public_host_connects_to_its_checked_address(self):
        self.write_policy()
        written, upstream = await self.connect("www.ti.com:443", {"www.ti.com": [PUBLIC]})
        self.assert_connected(written, upstream, PUBLIC)

    async def test_ipv6_public_answer_is_allowed(self):
        self.write_policy()
        written, upstream = await self.connect("www.ti.com:443", {"www.ti.com": ["2606:4700::6810:84e5"]})
        self.assert_connected(written, upstream, "2606:4700::6810:84e5")

    async def test_non_public_answers_are_refused(self):
        self.write_policy()
        for private in ("10.0.0.1", "100.64.0.1", "169.254.169.254", "::1", "fd00::1", "fe80::1",
                        "224.0.0.1", "::ffff:127.0.0.1", "2002:7f00:1::1", "203.0.113.10",
                        "3fff::1", "192.0.0.8", "192.88.99.2", "198.18.0.1", "2001:20::1",
                        "2001:db8::1"):
            with self.subTest(address=private):
                written, upstream = await self.connect("mixed.example.com:443",
                                                       {"mixed.example.com": [PUBLIC, private]})
                self.assert_refused(written, upstream, "not_public")

    async def test_malformed_targets_are_refused_before_dns(self):
        self.write_policy()
        for target in ("example.com:22", "127.0.0.1:443", "[::1]:443", "inventory.internal:443",
                       "host.lima.local:443", "Example.com:443", "example:443", "example.com:abc", "example.com:0",
                       "example.com:" + "4" * 4500,
                       ".".join(["a" * 63] * 4) + ":443"):
            with self.subTest(target=target):
                written, upstream = await self.connect(target, {})
                self.assert_refused(written, upstream, "destination_refused")
                self.assertEqual(self.lookups, 0)

    async def test_protected_names_and_their_subdomains_are_refused(self):
        self.write_policy(protected_hosts=["inventory.example.com"])
        # The subdomain has an address of its own, so only its name can refuse it.
        table = {"inventory.example.com": [OTHER_PUBLIC], "api.inventory.example.com": [PUBLIC]}
        for target in ("inventory.example.com:443", "api.inventory.example.com:443"):
            with self.subTest(target=target):
                written, upstream = await self.connect(target, table)
                self.assert_refused(written, upstream, "protected_destination")

    async def test_alias_of_a_protected_address_is_refused(self):
        table = {"inventory.internal": [OTHER_PUBLIC], "inventory.example.com": [OTHER_PUBLIC],
                 "alias.example.net": [OTHER_PUBLIC]}
        for protected in ("inventory.example.com", "inventory.internal", OTHER_PUBLIC):
            with self.subTest(protected=protected):
                self.write_policy(protected_hosts=[protected])
                written, upstream = await self.connect("alias.example.net:443", table)
                self.assert_refused(written, upstream, "protected_destination")

    async def test_protected_names_resolving_only_privately_are_skipped(self):
        self.write_policy(protected_hosts=["bench.tailnet.ts.net", "127.0.0.1"])
        table = {"bench.tailnet.ts.net": ["100.64.0.7"], "www.ti.com": [PUBLIC]}
        written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_connected(written, upstream, PUBLIC)

    async def test_failed_protected_lookup_refuses_public_hosts_only(self):
        self.write_policy(protected_hosts=["inventory.example.com"])
        table = {"www.ti.com": [PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "resolution_failed")
        written, upstream = await self.connect("api.anthropic.com:443", table)
        self.assert_connected(written, upstream, OTHER_PUBLIC)

    async def test_provider_host_on_a_protected_address_is_refused(self):
        self.write_policy(protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": [OTHER_PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        written, upstream = await self.connect("api.anthropic.com:443", table)
        self.assert_refused(written, upstream, "protected_destination")

    async def test_environment_protected_host_still_guards_the_provider(self):
        table = {"inventory.example.com": [OTHER_PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        with patch.object(egress, "PROTECTED", {"inventory.example.com"}):
            written, upstream = await self.connect("api.anthropic.com:443", table)
        self.assert_refused(written, upstream, "protected_destination")

    async def test_provider_host_with_a_private_answer_is_refused(self):
        for addresses in (["10.0.0.5"], [OTHER_PUBLIC, "192.168.1.2"]):
            for public_pages in (None, False):
                with self.subTest(addresses=addresses, public_pages=public_pages):
                    if public_pages is None:
                        self.policy.unlink(missing_ok=True)
                    else:
                        self.write_policy(public_pages=public_pages)
                    written, upstream = await self.connect("api.anthropic.com:443",
                                                           {"api.anthropic.com": addresses})
                    self.assert_refused(written, upstream, "not_public")

    async def test_ipv4_mapped_protected_literal_blocks_its_ipv4_alias(self):
        self.write_policy(protected_hosts=["::ffff:101:101"])
        written, upstream = await self.connect("alias.example.net:443",
                                               {"alias.example.net": [OTHER_PUBLIC]})
        self.assert_refused(written, upstream, "protected_destination")

    async def test_configured_tailnet_name_is_refused_by_its_answers(self):
        self.write_policy(protected_hosts=["bench.tailnet.ts.net"])
        written, upstream = await self.connect("bench.tailnet.ts.net:443",
                                               {"bench.tailnet.ts.net": ["100.64.0.7"]})
        self.assert_refused(written, upstream, "not_public")
        written, upstream = await self.connect("bench.tailnet.ts.net:443",
                                               {"bench.tailnet.ts.net": [OTHER_PUBLIC]})
        self.assert_refused(written, upstream, "protected_destination")

    async def test_largest_valid_policy_is_read(self):
        # 32 distinct 249-byte names: three 63-byte labels and a 57-byte final label.
        hosts = [".".join([f"{index:02d}" + "a" * 61] + ["a" * 63] * 2 + ["b" * 57])
                 for index in range(32)]
        self.assertTrue(all(len(host) == 249 for host in hosts))
        self.write_policy(protected_hosts=hosts)
        self.assertLessEqual(self.policy.stat().st_size, egress.MAX_POLICY_BYTES)
        written, upstream = await self.connect("www.ti.com:443", {"www.ti.com": [PUBLIC]})
        # The policy loaded: its unresolvable protected names stop public access for the turn.
        self.assert_refused(written, upstream, "resolution_failed")

    async def test_provider_host_under_a_protected_name_is_refused(self):
        self.write_policy(protected_hosts=["anthropic.com"])
        table = {"anthropic.com": [PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        written, upstream = await self.connect("api.anthropic.com:443", table)
        self.assert_refused(written, upstream, "protected_destination")

    async def test_overlong_protected_name_makes_the_policy_invalid(self):
        self.write_policy(protected_hosts=[".".join(["a" * 63] * 4)])
        written, upstream = await self.connect("www.ti.com:443", {"www.ti.com": [PUBLIC]})
        self.assert_refused(written, upstream, "destination_refused")

    async def test_dual_stack_answer_connects_over_ipv4_first(self):
        self.write_policy()
        written, upstream = await self.connect(
            "www.ti.com:443", {"www.ti.com": ["2606:4700::6810:84e5", PUBLIC]})
        self.assert_connected(written, upstream, PUBLIC)

    async def test_unreachable_first_address_falls_back_to_the_next_checked_one(self):
        self.write_policy()
        written, upstream = await self.connect(
            "www.ti.com:443", {"www.ti.com": [PUBLIC, OTHER_PUBLIC]},
            open_results=lambda remote, writer: [OSError("unreachable"), (remote, writer)])
        self.assertTrue(written.startswith(b"HTTP/1.1 200"), written)
        self.assertEqual([call.args for call in upstream.call_args_list],
                         [(PUBLIC, 443), (OTHER_PUBLIC, 443)])

    async def test_provider_lookup_failure_is_refused_with_its_reason(self):
        written, upstream = await self.connect("api.anthropic.com:443", {})
        self.assert_refused(written, upstream, "resolution_failed")

    async def test_protected_subdomain_without_its_own_record_is_protected(self):
        self.write_policy(protected_hosts=["inventory.example.com"])
        written, upstream = await self.connect("api.inventory.example.com:443",
                                               {"inventory.example.com": [OTHER_PUBLIC]})
        self.assert_refused(written, upstream, "protected_destination")

    async def test_stalled_public_lookups_leave_room_for_the_provider(self):
        self.write_policy()
        release = threading.Event()
        self.addCleanup(release.set)
        table = {"slow.example.com": [PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        stalled = {"slow.example.com": release}
        with patch.object(egress, "DNS_TIMEOUT_S", 0.5), \
                self.fake_network(table, stalled=stalled) as upstream:
            public = [self.handle("slow.example.com:443") for _ in range(egress.DNS_SLOTS + 1)]
            *refused, provider = await asyncio.gather(*public, self.handle("api.anthropic.com:443"))
        for written in refused:
            self.assertIn(b"X-Bench-Refusal: resolution_failed\r\n", written)
        self.assertTrue(provider.startswith(b"HTTP/1.1 200"), provider)
        upstream.assert_called_once_with(OTHER_PUBLIC, 443)

    async def test_stalled_protected_lookup_leaves_the_provider_reachable(self):
        release = threading.Event()
        self.addCleanup(release.set)
        table = {"inventory.example.com": [PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        for public_pages in (False, True):
            with self.subTest(public_pages=public_pages), \
                    patch.object(egress, "PROTECTED_LOOKUP_BUDGET_S", 0.2):
                self.write_policy(public_pages=public_pages, protected_hosts=["inventory.example.com"])
                written, upstream = await self.connect(
                    "api.anthropic.com:443", table, stalled={"inventory.example.com": release})
                self.assert_connected(written, upstream, OTHER_PUBLIC)

    async def test_protected_target_whose_lookup_stalls_stays_protected(self):
        release = threading.Event()
        self.addCleanup(release.set)
        self.write_policy(protected_hosts=["inventory.example.com"])
        with patch.object(egress, "DNS_TIMEOUT_S", 0.3):
            written, upstream = await self.connect(
                "inventory.example.com:443", {"inventory.example.com": [PUBLIC]},
                stalled={"inventory.example.com": release})
        self.assert_refused(written, upstream, "protected_destination")

    async def test_tunnel_carries_bytes_unchanged_both_ways(self):
        self.write_policy()
        sent = bytes(range(256)) * 64
        received = b"%PDF-1.7\n" + bytes(reversed(range(256))) * 64
        stream = asyncio.StreamReader()
        # The client's half stays open; the upstream ending closes the tunnel.
        stream.feed_data(b"CONNECT www.ti.com:443 HTTP/1.1\r\n\r\n" + sent)
        client = stream_writer()
        remote = asyncio.StreamReader()
        remote.feed_data(received)
        remote.feed_eof()
        upstream_writer = stream_writer()
        with patch.object(socket, "getaddrinfo", side_effect=dns({"www.ti.com": [PUBLIC]})), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, upstream_writer))):
            await egress.handle(stream, client)
        to_client = b"".join(call.args[0] for call in client.write.call_args_list)
        to_upstream = b"".join(call.args[0] for call in upstream_writer.write.call_args_list)
        self.assertEqual(to_client, b"HTTP/1.1 200 Connection Established\r\n\r\n" + received)
        self.assertEqual(to_upstream, sent)

    async def test_protected_literal_blocks_the_provider_while_name_lookups_stall(self):
        release = threading.Event()
        self.addCleanup(release.set)
        names = [f"h{index}.example.com" for index in range(31)]
        self.write_policy(public_pages=False, protected_hosts=names + [OTHER_PUBLIC])
        table = {"api.anthropic.com": [OTHER_PUBLIC]}
        with patch.object(egress, "PROTECTED_LOOKUP_BUDGET_S", 0.2), \
                self.fake_network(table, stalled={name: release for name in names}) as upstream:
            written = await self.handle("api.anthropic.com:443")
            # Queued lookups finish against the fake resolver, never the real one.
            release.set()
            egress.PROTECTED_LOOKUPS.pool.shutdown(wait=True)
        self.assert_refused(written, upstream, "protected_destination")

    async def test_bad_port_is_refused_by_name_even_with_the_dns_pool_full(self):
        self.write_policy()
        full = threading.BoundedSemaphore(1)
        full.acquire()
        with patch.object(egress.PUBLIC_DNS, "slots", full):
            written, upstream = await self.connect("www.ti.com:22", {"www.ti.com": [PUBLIC]})
        self.assert_refused(written, upstream, "destination_refused")
        self.assertEqual(self.lookups, 0)

    async def test_stale_protected_addresses_keep_blocking_while_a_refresh_stalls(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        release = threading.Event()
        known = {"inventory.example.com": [OTHER_PUBLIC], "api.anthropic.com": [PUBLIC]}
        with patch.object(egress, "PROTECTED_LOOKUP_BUDGET_S", 0.2):
            written, upstream = await self.connect("api.anthropic.com:443", known)
            self.assert_connected(written, upstream, PUBLIC)
            # The next refresh stalls, and the provider moves onto the last known address.
            moved = {"inventory.example.com": [OTHER_PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
            with self.fake_network(moved, stalled={"inventory.example.com": release}) as upstream:
                written = await self.handle("api.anthropic.com:443")
                release.set()
                egress.PROTECTED_LOOKUPS.pool.shutdown(wait=True)
        self.assert_refused(written, upstream, "protected_destination")

    async def test_private_suffix_protected_name_reports_protected(self):
        self.write_policy(protected_hosts=["inventory.internal"])
        for target in ("inventory.internal:443", "api.inventory.internal:443"):
            with self.subTest(target=target):
                written, upstream = await self.connect(target, {})
                self.assert_refused(written, upstream, "protected_destination")
                self.assertEqual(self.lookups, 0)

    async def test_protected_name_that_moves_is_blocked_at_its_new_address(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        before = {"inventory.example.com": [PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        written, upstream = await self.connect("api.anthropic.com:443", before)
        self.assert_connected(written, upstream, OTHER_PUBLIC)
        after = {"inventory.example.com": [OTHER_PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        written, upstream = await self.connect("api.anthropic.com:443", after)
        self.assert_refused(written, upstream, "protected_destination")

    async def test_provider_answering_near_its_deadline_is_not_held_by_a_stalled_protected_lookup(self):
        release = threading.Event()
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": [PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        with patch.object(egress, "DNS_TIMEOUT_S", 0.6), \
                patch.object(egress, "PROTECTED_LOOKUP_BUDGET_S", 0.4), \
                self.fake_network(table, stalled={"inventory.example.com": release},
                                  delays={"api.anthropic.com": 0.4}) as upstream:
            written = await self.handle("api.anthropic.com:443")
            release.set()
            egress.PROTECTED_LOOKUPS.pool.shutdown(wait=True)
        self.assert_connected(written, upstream, OTHER_PUBLIC)

    async def test_protected_lookup_finishing_late_still_blocks_the_provider(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": [OTHER_PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        with patch.object(egress, "PROTECTED_LOOKUP_BUDGET_S", 0.1):
            written, upstream = await self.connect(
                "api.anthropic.com:443", table,
                delays={"inventory.example.com": 0.3, "api.anthropic.com": 0.6})
        self.assert_refused(written, upstream, "protected_destination")

    async def until_open(self, client, task):
        """Waits up to two seconds for `task` to reply to `client`, and cancels it at cleanup."""
        self.addAsyncCleanup(self.cancelled, task)
        deadline = time.monotonic() + 2
        while not client.write.called:
            self.assertFalse(task.done(), "the handler ended before replying")
            self.assertLess(time.monotonic(), deadline, "the handler never replied")
            await asyncio.sleep(0.01)

    async def cancelled(self, task):
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async def held_tunnel(self, target):
        """A public tunnel that stays open until its streams are ended."""
        stream = asyncio.StreamReader()
        stream.feed_data(f"CONNECT {target} HTTP/1.1\r\n\r\n".encode())
        remote = asyncio.StreamReader()
        client = stream_writer()
        writer = stream_writer()
        return stream, remote, client, writer

    async def test_public_tunnels_are_capped_without_blocking_the_provider(self):
        self.write_policy()
        table = {"www.ti.com": [PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")
        self.guest_dns = Mock(side_effect=dns(table))
        with patch.object(egress, "MAX_PUBLIC_TUNNELS", 1), \
                patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            held = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, held)
            second = await self.handle("www.ti.com:443")
            wrong_port = await self.handle("www.ti.com:22")
            private_suffix = await self.handle("other.internal:443")
            provider = await self.handle("api.anthropic.com:443")
            remote.feed_eof()
            await held
        self.assertIn(b"X-Bench-Refusal: too_many_connections\r\n", second)
        self.assertIn(b"X-Bench-Refusal: destination_refused\r\n", wrong_port)
        self.assertIn(b"X-Bench-Refusal: destination_refused\r\n", private_suffix)
        self.assertTrue(provider.startswith(b"HTTP/1.1 200"), provider)

    async def test_idle_public_tunnel_closes_but_one_way_traffic_keeps_it_open(self):
        self.write_policy()
        table = {"www.ti.com": [PUBLIC]}
        with patch.object(egress, "PUBLIC_IDLE_TIMEOUT_S", 0.2), \
                patch.object(socket, "getaddrinfo", side_effect=dns(table)):
            stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")
            with patch.object(egress.asyncio, "open_connection",
                              AsyncMock(return_value=(remote, writer))):
                await asyncio.wait_for(egress.handle(stream, client), 2)
            stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")

            async def download():
                for _ in range(6):
                    await asyncio.sleep(0.1)
                    remote.feed_data(b"x" * 1024)
                remote.feed_eof()

            with patch.object(egress.asyncio, "open_connection",
                              AsyncMock(return_value=(remote, writer))):
                feeding = asyncio.create_task(download())
                await asyncio.wait_for(egress.handle(stream, client), 3)
                await feeding
        delivered = b"".join(call.args[0] for call in client.write.call_args_list)
        self.assertTrue(delivered.endswith(b"x" * 6 * 1024))

    async def test_provider_fallback_never_dials_an_address_protected_during_the_first_dial(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": [PUBLIC], "api.anthropic.com": [OTHER_PUBLIC, PUBLIC]}

        def slow_first_dial(_remote, _writer):
            async def dial(address, _port):
                await asyncio.sleep(0.4)
                raise OSError(f"{address} unreachable")
            return dial

        with patch.object(egress, "PROTECTED_LOOKUP_BUDGET_S", 0.05):
            written, upstream = await self.connect(
                "api.anthropic.com:443", table, open_results=slow_first_dial,
                delays={"inventory.example.com": 0.2})
        # The first, unprotected address was dialled and failed; the second was refused.
        self.assertIn(b"X-Bench-Refusal: protected_destination\r\n", written)
        self.assertEqual([call.args[0] for call in upstream.call_args_list], [OTHER_PUBLIC])

    async def test_idle_public_tunnel_aborts_both_streams_before_freeing_its_slot(self):
        self.write_policy()
        stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")
        self.guest_dns = Mock(side_effect=dns({"www.ti.com": [PUBLIC]}))
        with patch.object(egress, "PUBLIC_IDLE_TIMEOUT_S", 0.1), \
                patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            await asyncio.wait_for(egress.handle(stream, client), 2)
        writer.transport.abort.assert_called_once()
        client.transport.abort.assert_called_once()
        self.assertEqual(egress.public_tunnels, 0)

    async def test_connections_waiting_for_a_header_are_bounded(self):
        waiting = asyncio.StreamReader()
        first = stream_writer()
        with patch.object(egress, "MAX_PENDING_HEADERS", 1), \
                patch.object(egress, "HEADER_TIMEOUT_S", 0.3):
            held = asyncio.create_task(egress.handle(waiting, first))
            await asyncio.sleep(0.05)
            extra = stream_writer()
            await asyncio.wait_for(egress.handle(asyncio.StreamReader(), extra), 0.1)
            extra.write.assert_not_called()
            extra.close.assert_called_once()
            await held
        self.assertEqual(egress.pending_headers, 0)

    async def test_provider_dial_that_succeeds_after_its_address_is_protected_relays_nothing(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": [OTHER_PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}

        def slow_dial(remote, writer):
            async def dial(_address, _port):
                await asyncio.sleep(0.4)
                return remote, writer
            return dial

        with patch.object(egress, "PROTECTED_LOOKUP_BUDGET_S", 0.05):
            with self.fake_network(table, open_results=slow_dial,
                                   delays={"inventory.example.com": 0.2}) as upstream:
                written = await self.handle("api.anthropic.com:443")
                dialled = upstream.call_args_list
        self.assertNotIn(b"200 Connection Established", written)
        self.assertIn(b"X-Bench-Refusal: protected_destination\r\n", written)
        self.assertEqual(len(dialled), 1)

    async def test_public_tunnel_keeps_its_slot_while_a_stalled_peer_blocks_its_close(self):
        self.write_policy()
        stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")

        async def stalled_close():
            await asyncio.sleep(5)

        client.wait_closed = AsyncMock(side_effect=stalled_close)
        remote.feed_data(b"tail of a download")
        remote.feed_eof()
        self.guest_dns = Mock(side_effect=dns({"www.ti.com": [PUBLIC]}))
        with patch.object(egress, "MAX_PUBLIC_TUNNELS", 1), \
                patch.object(egress, "CLOSE_TIMEOUT_S", 0.3), \
                patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            closing = asyncio.create_task(egress.handle(stream, client))
            await asyncio.sleep(0.1)
            during_close = await self.handle("www.ti.com:443")
            await closing
        self.assertIn(b"X-Bench-Refusal: too_many_connections\r\n", during_close)
        client.transport.abort.assert_called_once()
        self.assertEqual(egress.public_tunnels, 0)

    async def test_protected_private_suffix_name_keeps_its_reason_at_the_cap(self):
        self.write_policy(protected_hosts=["inventory.internal"])
        stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")
        self.guest_dns = Mock(side_effect=dns({"www.ti.com": [PUBLIC]}))
        with patch.object(egress, "MAX_PUBLIC_TUNNELS", 1), \
                patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            held = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, held)
            protected = await self.handle("inventory.internal:443")
            remote.feed_eof()
            await held
        self.assertIn(b"X-Bench-Refusal: protected_destination\r\n", protected)

    async def test_provider_tunnel_is_dropped_when_a_late_lookup_protects_its_address(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("api.anthropic.com:443")
        table = {"inventory.example.com": [OTHER_PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        self.guest_dns = Mock(side_effect=dns(table, delays={"inventory.example.com": 0.3}))

        async def upstream_sends():
            await asyncio.sleep(0.1)
            remote.feed_data(b"before")
            await asyncio.sleep(0.5)
            remote.feed_data(b"after")
            remote.feed_eof()

        with patch.object(egress, "PROTECTED_LOOKUP_BUDGET_S", 0.05), \
                patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            sending = asyncio.create_task(upstream_sends())
            await asyncio.wait_for(egress.handle(stream, client), 2)
            await sending
        delivered = b"".join(call.args[0] for call in client.write.call_args_list)
        self.assertTrue(delivered.startswith(b"HTTP/1.1 200"), delivered)
        self.assertIn(b"before", delivered)
        self.assertNotIn(b"after", delivered)
        writer.transport.abort.assert_called_once()
        client.transport.abort.assert_called_once()

    async def test_open_provider_tunnel_is_dropped_when_a_later_lookup_protects_its_address(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("api.anthropic.com:443")
        # The protected name doesn't resolve while the first tunnel opens.
        table = {"api.anthropic.com": [OTHER_PUBLIC]}
        self.guest_dns = Mock(side_effect=dns(table))
        with patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            first = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, first)
            table["inventory.example.com"] = [OTHER_PUBLIC]
            second = await self.handle("api.anthropic.com:443")
            await asyncio.wait_for(first, 2)
        self.assertIn(b"X-Bench-Refusal: protected_destination\r\n", second)
        writer.transport.abort.assert_called_once()
        client.transport.abort.assert_called_once()

    async def test_protected_answer_from_a_public_request_drops_an_open_provider_tunnel(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("api.anthropic.com:443")
        table = {"api.anthropic.com": [OTHER_PUBLIC], "www.ti.com": [PUBLIC],
                 "inventory.example.com": ["8.8.8.8"]}
        self.guest_dns = Mock(side_effect=dns(table))
        with patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            provider = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, provider)
            table["inventory.example.com"] = [OTHER_PUBLIC]
            # A public request resolves the protected name for its own check.
            await self.handle("www.ti.com:443")
            await asyncio.wait_for(provider, 2)
        writer.transport.abort.assert_called_once()
        client.transport.abort.assert_called_once()

    async def test_public_dial_is_refused_when_its_address_becomes_protected_meanwhile(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC],
                 "api.anthropic.com": [OTHER_PUBLIC]}

        def slow_dial(remote, writer):
            async def dial(_address, _port):
                await asyncio.sleep(0.4)
                return remote, writer
            return dial

        with self.fake_network(table, open_results=slow_dial):
            public = asyncio.create_task(self.handle("www.ti.com:443"))
            await asyncio.sleep(0.1)
            # The name moves onto the public target's address; a provider CONNECT finds out.
            table["inventory.example.com"] = [PUBLIC]
            await self.handle("api.anthropic.com:443")
            written = await asyncio.wait_for(public, 2)
        self.assertNotIn(b"200 Connection Established", written)
        self.assertIn(b"X-Bench-Refusal: protected_destination\r\n", written)

    async def test_open_public_tunnel_is_dropped_when_its_address_becomes_protected(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC],
                 "api.anthropic.com": [OTHER_PUBLIC]}
        self.guest_dns = Mock(side_effect=dns(table))
        with patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            public = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, public)
            table["inventory.example.com"] = [PUBLIC]
            await self.handle("api.anthropic.com:443")
            await asyncio.wait_for(public, 2)
        writer.transport.abort.assert_called_once()
        client.transport.abort.assert_called_once()

    async def publish(self, name, *addresses):
        """A protected lookup's answer, published from a resolver thread."""
        await asyncio.to_thread(egress.PROTECTED_LOOKUPS.publish, name,
                                {egress.normalized(address) for address in addresses})

    async def test_dial_is_refused_when_a_protected_answer_is_replaced_before_it_completes(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        dialling = asyncio.Event()

        def slow_dial(remote, writer):
            async def dial(_address, _port):
                dialling.set()
                await asyncio.sleep(0.3)
                return remote, writer
            return dial

        with self.fake_network(table, open_results=slow_dial):
            public = asyncio.create_task(self.handle("www.ti.com:443"))
            await asyncio.wait_for(dialling.wait(), 2)
            # The name briefly answers with the dialled address, then moves away again.
            await self.publish("inventory.example.com", PUBLIC)
            await self.publish("inventory.example.com", "8.8.8.8")
            written = await asyncio.wait_for(public, 2)
        self.assertNotIn(b"200 Connection Established", written)
        self.assertIn(b"X-Bench-Refusal: protected_destination\r\n", written)

    async def test_closing_tunnel_is_aborted_when_its_address_becomes_protected(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("api.anthropic.com:443")

        async def stalled_close():
            await asyncio.sleep(5)

        client.wait_closed = AsyncMock(side_effect=stalled_close)
        remote.feed_data(b"tail of a response")
        remote.feed_eof()
        self.guest_dns = Mock(side_effect=dns({"api.anthropic.com": [OTHER_PUBLIC]}))
        with patch.object(egress, "CLOSE_TIMEOUT_S", 3), \
                patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            closing = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, closing)
            await asyncio.sleep(0.1)
            client.transport.abort.assert_not_called()
            await self.publish("inventory.example.com", OTHER_PUBLIC)
            await asyncio.wait_for(closing, 1)
        writer.transport.abort.assert_called_once()
        client.transport.abort.assert_called_once()

    async def test_buffered_bytes_are_not_relayed_once_the_address_is_protected(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("api.anthropic.com:443")
        self.guest_dns = Mock(side_effect=dns({"api.anthropic.com": [OTHER_PUBLIC]}))
        with patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            tunnel = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, tunnel)
            # The answer lands with a response already waiting to be relayed.
            egress.PROTECTED_LOOKUPS.publish("inventory.example.com",
                                             {egress.normalized(OTHER_PUBLIC)})
            remote.feed_data(b"response after protection")
            await asyncio.wait_for(tunnel, 2)
        relayed = b"".join(call.args[0] for call in client.write.call_args_list)
        self.assertNotIn(b"response after protection", relayed)
        writer.transport.abort.assert_called_once()
        client.transport.abort.assert_called_once()

    async def test_ready_relay_writes_nothing_once_an_answer_is_published(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("api.anthropic.com:443")
        self.guest_dns = Mock(side_effect=dns({"api.anthropic.com": [OTHER_PUBLIC]}))
        with patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            tunnel = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, tunnel)
            # The relay is runnable with data before the answer's abort callback is queued.
            remote.feed_data(b"response after protection")
            egress.PROTECTED_LOOKUPS.publish("inventory.example.com",
                                             {egress.normalized(OTHER_PUBLIC)})
            await asyncio.wait_for(tunnel, 2)
        relayed = b"".join(call.args[0] for call in client.write.call_args_list)
        self.assertNotIn(b"response after protection", relayed)
        client.transport.abort.assert_called_once()

    async def test_host_is_refused_when_a_failed_dials_address_becomes_protected(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC, OTHER_PUBLIC]}
        dialling = asyncio.Event()
        release = asyncio.Event()

        def first_fails(remote, writer):
            async def dial(address, _port):
                if address == PUBLIC:
                    dialling.set()
                    await release.wait()
                    raise ConnectionRefusedError("unreachable")
                return remote, writer
            return dial

        with self.fake_network(table, open_results=first_fails) as upstream:
            public = asyncio.create_task(self.handle("www.ti.com:443"))
            await asyncio.wait_for(dialling.wait(), 2)
            await self.publish("inventory.example.com", PUBLIC)
            release.set()
            written = await asyncio.wait_for(public, 2)
            dialled = [call.args[0] for call in upstream.call_args_list]
        self.assertIn(b"X-Bench-Refusal: protected_destination\r\n", written)
        self.assertEqual(dialled, [PUBLIC])

    async def test_every_answer_a_protected_name_gave_this_turn_stays_blocked(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        # Two lookups finish in either order; the next refresh times out.
        await self.publish("inventory.example.com", OTHER_PUBLIC)
        await self.publish("inventory.example.com", "8.8.8.8")
        stalled = {"inventory.example.com": threading.Event()}
        self.addCleanup(stalled["inventory.example.com"].set)
        for address in (OTHER_PUBLIC, "8.8.8.8"):
            table = {"api.anthropic.com": [address], "inventory.example.com": ["9.9.9.9"]}
            with patch.object(egress, "PROTECTED_LOOKUP_BUDGET_S", 0.05):
                written, upstream = await self.connect(
                    "api.anthropic.com:443", table, stalled=stalled)
            self.assert_refused(written, upstream, "protected_destination")

    async def test_answer_published_between_the_dns_check_and_the_dial_refuses(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        checked = egress.checked_addresses

        async def then_published(*args):
            result = await checked(*args)
            await self.publish("inventory.example.com", PUBLIC)
            return result

        with patch.object(egress, "checked_addresses", then_published):
            written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "protected_destination")

    async def test_only_address_protected_during_its_failed_dial_keeps_the_reason(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        dialling = asyncio.Event()
        release = asyncio.Event()

        def fails(_remote, _writer):
            async def dial(_address, _port):
                dialling.set()
                await release.wait()
                raise ConnectionRefusedError("unreachable")
            return dial

        with self.fake_network(table, open_results=fails):
            public = asyncio.create_task(self.handle("www.ti.com:443"))
            await asyncio.wait_for(dialling.wait(), 2)
            await self.publish("inventory.example.com", PUBLIC)
            release.set()
            written = await asyncio.wait_for(public, 2)
        self.assertIn(b"X-Bench-Refusal: protected_destination\r\n", written)

    async def test_failed_protected_lookup_refuses_public_hosts_for_the_rest_of_the_turn(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"www.ti.com": [PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "resolution_failed")
        # DNS recovers, but the turn stays refused; the provider is unaffected.
        table["inventory.example.com"] = ["8.8.8.8"]
        written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "resolution_failed")
        written, upstream = await self.connect("api.anthropic.com:443", table)
        self.assert_connected(written, upstream, OTHER_PUBLIC)

    async def test_connect_to_a_protected_name_revokes_tunnels_to_its_answer(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        self.guest_dns = Mock(side_effect=dns(table))
        with patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            tunnel = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, tunnel)
            table["inventory.example.com"] = [PUBLIC]
            refused = await self.handle("inventory.example.com:443")
            await asyncio.wait_for(tunnel, 2)
        self.assertIn(b"X-Bench-Refusal: protected_destination\r\n", refused)
        writer.transport.abort.assert_called_once()
        client.transport.abort.assert_called_once()

    async def test_answer_published_as_setup_settles_refuses_the_host(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC, OTHER_PUBLIC]}
        settle = egress.PROTECTED_LOOKUPS.settle

        def published_first(revocations, kept, public_request):
            # The unused second answer becomes protected just before setup settles.
            egress.PROTECTED_LOOKUPS.publish("inventory.example.com",
                                             {egress.normalized(OTHER_PUBLIC)})
            return settle(revocations, kept, public_request)

        with patch.object(egress.PROTECTED_LOOKUPS, "settle", published_first):
            written, upstream = await self.connect("www.ti.com:443", table)
        self.assertNotIn(b"200 Connection Established", written)
        self.assertIn(b"X-Bench-Refusal: protected_destination\r\n", written)

    async def test_failed_lookup_of_a_protected_name_itself_refuses_the_turn(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"www.ti.com": [PUBLIC], "api.anthropic.com": [OTHER_PUBLIC]}
        # The failed lookup latches the turn, so even this request reports it.
        written, upstream = await self.connect("inventory.example.com:443", table)
        self.assert_refused(written, upstream, "resolution_failed")
        table["inventory.example.com"] = ["8.8.8.8"]
        written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "resolution_failed")
        written, upstream = await self.connect("api.anthropic.com:443", table)
        self.assert_connected(written, upstream, OTHER_PUBLIC)

    async def test_public_dial_is_refused_when_a_protected_lookup_fails_meanwhile(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC],
                 "api.anthropic.com": [OTHER_PUBLIC]}
        dialling = asyncio.Event()

        def slow_public_dial(remote, writer):
            async def dial(address, _port):
                if address == PUBLIC:
                    dialling.set()
                    await asyncio.sleep(0.3)
                return remote, writer
            return dial

        with self.fake_network(table, open_results=slow_public_dial):
            public = asyncio.create_task(self.handle("www.ti.com:443"))
            await asyncio.wait_for(dialling.wait(), 2)
            # A provider CONNECT finds the protected name no longer resolves.
            del table["inventory.example.com"]
            provider = await self.handle("api.anthropic.com:443")
            written = await asyncio.wait_for(public, 2)
        self.assertTrue(provider.startswith(b"HTTP/1.1 200"), provider)
        self.assertNotIn(b"200 Connection Established", written)
        self.assertIn(b"X-Bench-Refusal: resolution_failed\r\n", written)

    async def test_failed_protected_lookup_stops_open_public_tunnels_only(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        public_stream, public_remote, public_client, public_writer = \
            await self.held_tunnel("www.ti.com:443")
        provider_stream, provider_remote, provider_client, provider_writer = \
            await self.held_tunnel("api.anthropic.com:443")
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC],
                 "api.anthropic.com": [OTHER_PUBLIC]}
        self.guest_dns = Mock(side_effect=dns(table))
        dials = AsyncMock(side_effect=[(public_remote, public_writer),
                                       (provider_remote, provider_writer)])
        with patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection", dials):
            public = asyncio.create_task(egress.handle(public_stream, public_client))
            await self.until_open(public_client, public)
            provider = asyncio.create_task(egress.handle(provider_stream, provider_client))
            await self.until_open(provider_client, provider)
            await self.publish_failure("inventory.example.com")
            public_remote.feed_data(b"public after failure")
            provider_remote.feed_data(b"provider after failure")
            await asyncio.wait_for(public, 2)
            await asyncio.sleep(0.05)
            self.assertFalse(provider.done())
        relayed = b"".join(call.args[0] for call in public_client.write.call_args_list)
        self.assertNotIn(b"public after failure", relayed)
        public_client.transport.abort.assert_called_once()
        provider_client.write.assert_any_call(b"provider after failure")
        provider_client.transport.abort.assert_not_called()

    async def publish_failure(self, name):
        await asyncio.to_thread(egress.PROTECTED_LOOKUPS.publish, name, None)

    async def test_failure_published_as_setup_decides_reports_resolution_failed(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        check = egress.PROTECTED_LOOKUPS.check

        def failed_first(revocations, public_request):
            # The failure also revokes this request's watch; the latch decides the reason.
            egress.PROTECTED_LOOKUPS.publish("inventory.example.com", None)
            return check(revocations, public_request)

        with patch.object(egress.PROTECTED_LOOKUPS, "check", failed_first):
            written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "resolution_failed")

    async def test_failure_is_seen_only_once_every_public_tunnel_is_revoked(self):
        lookups = egress.PROTECTED_LOOKUPS
        first, stop_first = lookups.watch(PUBLIC, True)
        second, stop_second = lookups.watch(OTHER_PUBLIC, True)
        self.addCleanup(stop_first)
        self.addCleanup(stop_second)
        seen = {}
        observers = []
        revoke = first.revoke

        def observed_mark():
            # Another thread reads the latch while publication is between the two tunnels.
            def observe():
                seen["failed"] = lookups.has_failed()
                seen["second revoked"] = second.is_set()
            observer = threading.Thread(target=observe)
            observer.start()
            observers.append(observer)
            observer.join(0.1)
            revoke()

        first.revoke = observed_mark
        await asyncio.to_thread(lookups.publish, "inventory.example.com", None)
        await asyncio.to_thread(observers[0].join, 2)
        self.assertEqual(seen, {"failed": True, "second revoked": True})

    async def test_failure_published_during_the_guard_reports_resolution_failed(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        guard = egress.PROTECTED_LOOKUPS.guard

        def published_first(address, protected, public_request):
            # The address becomes protected and a lookup fails before the guard decides.
            egress.PROTECTED_LOOKUPS.publish("inventory.example.com",
                                             {egress.normalized(PUBLIC)})
            egress.PROTECTED_LOOKUPS.publish("inventory.example.com", None)
            return guard(address, protected, public_request)

        with patch.object(egress.PROTECTED_LOOKUPS, "guard", published_first):
            written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "resolution_failed")

    async def test_failure_published_before_a_dns_refusal_reports_resolution_failed(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": ["10.0.0.1"]}
        target = egress.public_target

        def failed_meanwhile(*args):
            try:
                return target(*args)
            finally:
                egress.PROTECTED_LOOKUPS.publish("inventory.example.com", None)

        with patch.object(egress, "public_target", failed_meanwhile):
            written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "resolution_failed")

    async def test_guard_reads_the_latch_and_addresses_in_one_locked_step(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        lookups = egress.PROTECTED_LOOKUPS
        lock = PublishOnRelease(lookups.lock)
        guard = lookups.guard

        def publish_on_release(address, protected, public_request):
            def publish():
                lookups.publish("inventory.example.com", {egress.normalized(PUBLIC)})
                lookups.publish("inventory.example.com", None)
            # A guard that released the lock between its two reads would see the address.
            lock.then = publish
            return guard(address, protected, public_request)

        with patch.object(lookups, "lock", lock), \
                patch.object(lookups, "guard", publish_on_release):
            written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "resolution_failed")

    async def test_one_answer_revokes_every_affected_tunnel_before_any_write(self):
        lookups = egress.PROTECTED_LOOKUPS
        first, stop_first = lookups.watch(PUBLIC, False)
        second, stop_second = lookups.watch(PUBLIC, False)
        self.addCleanup(stop_first)
        self.addCleanup(stop_second)
        target = Mock()
        wrote = []
        writers = []
        revoke = first.revoke

        def paused_after_first():
            # A relay write on the second tunnel arrives while publication is mid-way.
            revoke()
            writer = threading.Thread(target=lambda: wrote.append(second.write(target, b"x")))
            writer.start()
            writers.append(writer)
            writer.join(0.1)

        first.revoke = paused_after_first
        await asyncio.to_thread(lookups.publish, "inventory.example.com",
                                {egress.normalized(PUBLIC)})
        await asyncio.to_thread(writers[0].join, 2)
        self.assertEqual(wrote, [False])
        target.write.assert_not_called()

    async def test_refused_resolving_connect_still_refreshes_protected_names(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC],
                 "intranet.example.com": ["10.0.0.1"]}
        self.guest_dns = Mock(side_effect=dns(table))
        with patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            tunnel = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, tunnel)
            table["inventory.example.com"] = [PUBLIC]
            refused = await self.handle("intranet.example.com:443")
            await asyncio.wait_for(tunnel, 2)
        self.assertIn(b"X-Bench-Refusal: not_public\r\n", refused)
        writer.transport.abort.assert_called_once()
        client.transport.abort.assert_called_once()

    async def test_failed_protected_lookup_still_refreshes_the_other_names(self):
        self.write_policy(public_pages=True,
                          protected_hosts=["inventory.example.com", "archive.example.com"])
        stream, remote, client, writer = await self.held_tunnel("api.anthropic.com:443")
        table = {"inventory.example.com": ["8.8.8.8"], "archive.example.com": ["9.9.9.9"],
                 "api.anthropic.com": [OTHER_PUBLIC], "www.ti.com": [PUBLIC]}
        held = threading.Event()
        self.addCleanup(held.set)
        self.guest_dns = Mock(side_effect=dns(table))
        with patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            provider = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, provider)
            # The archive stops resolving and the inventory moves onto the provider's address,
            # but the inventory's answer is held until the archive's failure has latched.
            del table["archive.example.com"]
            table["inventory.example.com"] = [OTHER_PUBLIC]
            self.guest_dns.side_effect = dns(table, stalled={"inventory.example.com": held})
            public = asyncio.create_task(self.handle("www.ti.com:443"))
            self.addAsyncCleanup(self.cancelled, public)
            deadline = time.monotonic() + 2
            while not egress.PROTECTED_LOOKUPS.has_failed():
                self.assertLess(time.monotonic(), deadline, "the failure never latched")
                await asyncio.sleep(0.01)
            self.assertFalse(provider.done())
            held.set()
            refused = await asyncio.wait_for(public, 2)
            await asyncio.wait_for(provider, 2)
        self.assertIn(b"X-Bench-Refusal: resolution_failed\r\n", refused)
        writer.transport.abort.assert_called_once()
        client.transport.abort.assert_called_once()

    async def test_connect_to_a_protected_name_refreshes_it_while_public_dns_is_full(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        self.guest_dns = Mock(side_effect=dns(table))

        async def full(*_args):
            raise egress.Refused("resolution_failed")

        with patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            tunnel = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, tunnel)
            table["inventory.example.com"] = [PUBLIC]
            # A slow answer, so both requests arrive while one refresh is in flight.
            self.guest_dns.side_effect = dns(table, delays={"inventory.example.com": 0.2})
            before = self.guest_dns.call_count
            with patch.object(egress.PUBLIC_DNS, "run", full):
                first, second = await asyncio.gather(self.handle("inventory.example.com:443"),
                                                     self.handle("inventory.example.com:443"))
            await asyncio.wait_for(tunnel, 2)
            lookups = self.guest_dns.call_args_list[before:]
        for written in (first, second):
            self.assertIn(b"X-Bench-Refusal: protected_destination\r\n", written)
        # Both requests joined one refresh, and its answer revoked the open tunnel.
        self.assertEqual(len(lookups), 1)
        writer.transport.abort.assert_called_once()

    async def test_rotating_protected_answers_past_the_bound_fail_the_turn_closed(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("api.anthropic.com:443")
        table = {"inventory.example.com": ["8.8.8.8"], "api.anthropic.com": [OTHER_PUBLIC]}
        self.guest_dns = Mock(side_effect=dns(table))
        lookups = egress.PROTECTED_LOOKUPS
        with patch.object(egress, "MAX_PROTECTED_ADDRESSES", 4), \
                patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            provider = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, provider)
            # The record rotates through more addresses than the turn may keep.
            for last in range(1, 6):
                await self.publish("inventory.example.com", f"9.9.9.{last}")
            await asyncio.wait_for(provider, 2)
            written, upstream = await self.connect("api.anthropic.com:443", table)
        self.assertLessEqual(lookups.recorded, 4)
        self.assertIn(egress.normalized("8.8.8.8"), lookups.known["inventory.example.com"])
        writer.transport.abort.assert_called_once()
        self.assert_refused(written, upstream, "resolution_failed")

    async def test_requests_joining_a_stalled_lookup_add_no_waiters(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        stalled = {"inventory.example.com": threading.Event()}
        self.addCleanup(stalled["inventory.example.com"].set)
        lookups = egress.PROTECTED_LOOKUPS
        submitted = []
        submit = lookups.pool.submit

        def recorded(*args):
            submitted.append(submit(*args))
            return submitted[-1]

        table = {"api.anthropic.com": [OTHER_PUBLIC]}
        with patch.object(egress, "PROTECTED_LOOKUP_BUDGET_S", 0.02), \
                patch.object(lookups.pool, "submit", recorded):
            for _attempt in range(5):
                written, upstream = await self.connect(
                    "api.anthropic.com:443", table, stalled=stalled)
                self.assert_connected(written, upstream, OTHER_PUBLIC)
        self.assertEqual(len(submitted), 1)
        # One event-loop future follows the lookup, however many requests waited on it.
        self.assertEqual(len(submitted[0]._done_callbacks), 1)

    async def test_protected_names_resolve_as_absolute_names(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        # A search domain could answer differently for the relative name.
        table = {"inventory.example.com.": [PUBLIC], "inventory.example.com": ["8.8.8.8"],
                 "alias.example.net": [PUBLIC]}
        written, upstream = await self.connect("alias.example.net:443", table)
        self.assert_refused(written, upstream, "protected_destination")

    async def test_provider_host_resolves_as_an_absolute_name(self):
        self.write_policy(public_pages=False)
        # A search domain could answer differently for the relative name.
        table = {"api.anthropic.com.": [OTHER_PUBLIC], "api.anthropic.com": ["8.8.4.4"]}
        written, upstream = await self.connect("api.anthropic.com:443", table)
        self.assert_connected(written, upstream, OTHER_PUBLIC)

    async def test_revoked_public_tunnel_keeps_its_slot_until_its_aborts_run(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        self.guest_dns = Mock(side_effect=dns(table))
        release = asyncio.Event()

        def held_abort(revocation):
            # The abort runs only once the test releases it.
            async def fire_when_released():
                await release.wait()
                revocation.fire()
            revocation.loop.call_soon_threadsafe(
                lambda: revocation.loop.create_task(fire_when_released()))

        with patch.object(egress, "MAX_PUBLIC_TUNNELS", 1), \
                patch.object(egress.Revocation, "schedule_abort", held_abort), \
                patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            tunnel = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, tunnel)
            await self.publish("inventory.example.com", PUBLIC)
            remote.feed_data(b"after protection")
            during_abort = await self.handle("www.ti.com:443")
            self.assertFalse(tunnel.done())
            writer.transport.abort.assert_not_called()
            release.set()
            await asyncio.wait_for(tunnel, 2)
        self.assertIn(b"X-Bench-Refusal: too_many_connections\r\n", during_abort)
        writer.transport.abort.assert_called_once()
        client.transport.abort.assert_called_once()
        self.assertEqual(egress.public_tunnels, 0)

    async def test_provider_requests_after_overflow_report_resolution_failed(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        lookups = egress.PROTECTED_LOOKUPS
        with patch.object(egress, "MAX_PROTECTED_ADDRESSES", 1):
            await self.publish("inventory.example.com", "9.9.9.1", "9.9.9.2")
        self.assertTrue(lookups.overflowed)
        # A private provider answer and a protected one would each refuse earlier otherwise.
        for answer in ("10.0.0.1", "9.9.9.1"):
            with self.subTest(answer=answer):
                table = {"api.anthropic.com": [answer], "inventory.example.com": ["9.9.9.1"]}
                written, upstream = await self.connect("api.anthropic.com:443", table)
                self.assert_refused(written, upstream, "resolution_failed")
                self.assertEqual(self.lookups, 0)
    async def test_overflow_published_during_provider_dns_reports_resolution_failed(self):
        self.write_policy(public_pages=False, protected_hosts=["inventory.example.com"])
        stalled = {"api.anthropic.com": threading.Event()}
        self.addCleanup(stalled["api.anthropic.com"].set)
        table = {"api.anthropic.com": ["10.0.0.1"], "inventory.example.com": ["9.9.9.1"]}
        with patch.object(egress, "MAX_PROTECTED_ADDRESSES", 1), \
                self.fake_network(table, stalled=stalled) as upstream:
            provider = asyncio.create_task(self.handle("api.anthropic.com:443"))
            deadline = time.monotonic() + 2
            while not any(call.args[0].startswith("api.") for call in
                          self.guest_dns.call_args_list):
                self.assertLess(time.monotonic(), deadline, "provider DNS never started")
                await asyncio.sleep(0.01)
            await self.publish("inventory.example.com", "9.9.9.2", "9.9.9.3")
            stalled["api.anthropic.com"].set()
            written = await asyncio.wait_for(provider, 2)
        self.assertIn(b"X-Bench-Refusal: resolution_failed\r\n", written)
        upstream.assert_not_called()

    async def test_exhausted_dials_answer_bad_gateway(self):
        self.write_policy()

        def refused(_remote, _writer):
            async def dial(_address, _port):
                raise ConnectionRefusedError("refused")
            return dial

        written, upstream = await self.connect("www.ti.com:443", {"www.ti.com": [PUBLIC]},
                                               open_results=refused)
        self.assertTrue(written.startswith(b"HTTP/1.1 502 Bad Gateway\r\n"), written)
        self.assertNotIn(b"X-Bench-Refusal", written)

    async def test_protected_refresh_runs_while_a_destination_lookup_stalls(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC],
                 "slow.example.com": [OTHER_PUBLIC]}
        stalled = {"slow.example.com": threading.Event()}
        self.addCleanup(stalled["slow.example.com"].set)
        self.guest_dns = Mock(side_effect=dns(table, stalled=stalled))
        with patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            tunnel = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, tunnel)
            table["inventory.example.com"] = [PUBLIC]
            held = asyncio.create_task(self.handle("slow.example.com:443"))
            self.addAsyncCleanup(self.cancelled, held)
            # The open tunnel is revoked while the new request's own lookup is still held.
            await asyncio.wait_for(tunnel, 2)
            self.assertFalse(held.done())
            stalled["slow.example.com"].set()
            await asyncio.wait_for(held, 2)
        writer.transport.abort.assert_called_once()
        client.transport.abort.assert_called_once()

    async def test_public_connect_looks_each_protected_name_up_once(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_connected(written, upstream, PUBLIC)
        protected_lookups = [call for call in self.guest_dns.call_args_list
                             if call.args[0].startswith("inventory.")]
        self.assertEqual(len(protected_lookups), 1)

    async def test_oversized_answer_is_refused_before_any_watch_or_dial(self):
        self.write_policy()
        many = [f"93.184.{index // 250}.{index % 250 + 1}" for index in range(33)]
        watch = Mock(side_effect=egress.PROTECTED_LOOKUPS.watch)
        with patch.object(egress.PROTECTED_LOOKUPS, "watch", watch):
            written, upstream = await self.connect("www.ti.com:443", {"www.ti.com": many})
        self.assert_refused(written, upstream, "destination_refused")
        watch.assert_not_called()

    async def test_protected_name_with_a_mixed_answer_reports_not_public(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        # The IPv4-mapped form is not public as answered, though it maps to a public address.
        for answer in ([PUBLIC, "10.0.0.2"], [PUBLIC, "::ffff:" + PUBLIC]):
            with self.subTest(answer=answer):
                table = {"inventory.example.com": answer}
                written, upstream = await self.connect("inventory.example.com:443", table)
                self.assert_refused(written, upstream, "not_public")
                self.assertEqual(self.lookups, 1)

    async def test_exact_name_reason_comes_from_the_refresh_it_waited_on(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": [PUBLIC, "10.0.0.2"]}
        wait = asyncio.wait
        lookups = egress.PROTECTED_LOOKUPS

        async def then_refreshed_publicly(*args, **kwargs):
            result = await wait(*args, **kwargs)
            # A later refresh lands, public-only, before this request decides its reason.
            table["inventory.example.com"] = [PUBLIC]
            await asyncio.to_thread(lookups.resolve, "inventory.example.com")
            return result

        with patch.object(egress.asyncio, "wait", then_refreshed_publicly):
            written, upstream = await self.connect("inventory.example.com:443", table)
        self.assert_refused(written, upstream, "not_public")

    async def test_protected_names_beyond_the_resolver_slots_all_refresh(self):
        names = [f"name{index}.example.com" for index in range(egress.DNS_SLOTS + 2)]
        self.write_policy(public_pages=True, protected_hosts=names)
        # The first name in sorted order fails; every later one still refreshes.
        table = {name: [f"9.9.9.{index}"] for index, name in enumerate(names) if index}
        table["www.ti.com"] = [PUBLIC]
        written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "resolution_failed")
        looked_up = [call.args[0].rstrip(".") for call in self.guest_dns.call_args_list]
        for name in names:
            self.assertEqual(looked_up.count(name), 1, name)
        for name in names[1:]:
            self.assertTrue(egress.PROTECTED_LOOKUPS.known.get(name), name)

    async def test_admission_reads_the_latch_and_addresses_in_one_locked_step(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        lookups = egress.PROTECTED_LOOKUPS
        lock = PublishOnRelease(lookups.lock)
        wait = asyncio.wait

        def publish():
            lookups.publish("inventory.example.com", {egress.normalized(PUBLIC)})
            lookups.publish("inventory.example.com", None)

        async def armed_after_refreshes(*args, **kwargs):
            result = await wait(*args, **kwargs)
            # The next release is the admission's first read of the shared state.
            lock.then = publish
            return result

        with patch.object(lookups, "lock", lock), \
                patch.object(egress.asyncio, "wait", armed_after_refreshes):
            written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "resolution_failed")

    async def test_latched_failure_takes_precedence_over_a_full_tunnel_cap(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        self.guest_dns = Mock(side_effect=dns(table))
        release = asyncio.Event()

        def held_abort(revocation):
            # The revoked tunnel keeps its slot until the test releases its abort.
            async def fire_when_released():
                await release.wait()
                revocation.fire()
            revocation.loop.call_soon_threadsafe(
                lambda: revocation.loop.create_task(fire_when_released()))

        with patch.object(egress, "MAX_PUBLIC_TUNNELS", 1), \
                patch.object(egress.Revocation, "schedule_abort", held_abort), \
                patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            tunnel = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, tunnel)
            await self.publish_failure("inventory.example.com")
            at_cap = await self.handle("www.ti.com:443")
            release.set()
            await asyncio.wait_for(tunnel, 2)
        self.assertIn(b"X-Bench-Refusal: resolution_failed\r\n", at_cap)

    async def test_cap_decision_sees_the_latch_it_was_made_with(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        stream, remote, client, writer = await self.held_tunnel("www.ti.com:443")
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        self.guest_dns = Mock(side_effect=dns(table))
        lookups = egress.PROTECTED_LOOKUPS

        class ObservedCap:
            """A cap of one that records whether a failure was latched when compared."""

            def __init__(self):
                self.latched_at_compare = []

            def __le__(self, count):
                self.latched_at_compare.append(lookups.failed)
                return 1 <= count

        with patch.object(egress, "MAX_PUBLIC_TUNNELS", 1), \
                patch.object(socket, "getaddrinfo", self.guest_dns), \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(return_value=(remote, writer))):
            tunnel = asyncio.create_task(egress.handle(stream, client))
            await self.until_open(client, tunnel)
            self.addAsyncCleanup(self.cancelled, tunnel)
            lock = PublishOnRelease(lookups.lock)
            cap = ObservedCap()
            # The failure lands on the admission's first release of the shared lock.
            lock.then = lambda: lookups.publish("inventory.example.com", None)
            with patch.object(lookups, "lock", lock), \
                    patch.object(egress, "MAX_PUBLIC_TUNNELS", cap):
                at_cap = await self.handle("www.ti.com:443")
        # The cap was decided before the failure, under the same lock as the latch.
        self.assertEqual(cap.latched_at_compare, [False])
        self.assertIn(b"X-Bench-Refusal: too_many_connections\r\n", at_cap)

    async def test_latched_failure_reports_itself_ahead_of_the_answer_limit(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        many = [f"93.184.{index // 250}.{index % 250 + 1}" for index in range(33)]
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": many}
        checked = egress.checked_addresses
        watch = Mock(side_effect=egress.PROTECTED_LOOKUPS.watch)

        async def failed_after_admission(*args):
            result = await checked(*args)
            egress.PROTECTED_LOOKUPS.publish("inventory.example.com", None)
            return result

        with patch.object(egress, "checked_addresses", failed_after_admission), \
                patch.object(egress.PROTECTED_LOOKUPS, "watch", watch):
            written, upstream = await self.connect("www.ti.com:443", table)
        self.assert_refused(written, upstream, "resolution_failed")
        watch.assert_not_called()

    async def test_protected_refresh_overdue_at_the_deadline_refuses_the_request(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}

        async def slow_destination(*_args):
            # The destination answers after the protected refresh has landed late.
            await asyncio.sleep(0.3)
            return [PUBLIC]

        with patch.object(egress, "DNS_TIMEOUT_S", 0.1), \
                patch.object(egress.PUBLIC_DNS, "run", slow_destination):
            written, upstream = await self.connect(
                "www.ti.com:443", table, delays={"inventory.example.com": 0.2})
        self.assert_refused(written, upstream, "resolution_failed")
        # The overdue refresh still published its answer when it landed.
        self.assertTrue(egress.PROTECTED_LOOKUPS.known.get("inventory.example.com"))

    async def test_answer_landing_before_the_acknowledgement_is_refused(self):
        self.write_policy(public_pages=True, protected_hosts=["inventory.example.com"])
        table = {"inventory.example.com": ["8.8.8.8"], "www.ti.com": [PUBLIC]}
        settle = egress.PROTECTED_LOOKUPS.settle
        lookups = egress.PROTECTED_LOOKUPS

        def then_protected(*args):
            result = settle(*args)
            # The match is published after setup settles, before the CONNECT is answered.
            lookups.publish("inventory.example.com", {egress.normalized(PUBLIC)})
            return result

        with patch.object(lookups, "settle", then_protected):
            written, upstream = await self.connect("www.ti.com:443", table)
        self.assertNotIn(b"200 Connection Established", written)
        self.assertIn(b"X-Bench-Refusal: protected_destination\r\n", written)


if __name__ == "__main__":
    unittest.main()
