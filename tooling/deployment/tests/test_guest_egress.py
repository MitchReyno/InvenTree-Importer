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


def dns(table, stalled=None, delays=None):
    """A getaddrinfo stand-in: unknown names fail like an NXDOMAIN answer.

    A name in `stalled` blocks until its event is set, like an unresponsive resolver; a name in
    `delays` answers after that many seconds.
    """
    def lookup(host, *_args, **_kwargs):
        if stalled and host in stalled:
            stalled[host].wait(10)
        if delays and host in delays:
            time.sleep(delays[host])
        if host not in table:
            raise socket.gaierror(socket.EAI_NONAME, "unknown name")
        return answers(*table[host])
    return lookup


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
        upstream_writer = Mock()
        upstream_writer.drain = AsyncMock()
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
        client = Mock()
        client.drain = AsyncMock()
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
        table = {"inventory.example.com": [OTHER_PUBLIC], "api.inventory.example.com": [OTHER_PUBLIC]}
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
        client = Mock()
        client.drain = AsyncMock()
        remote = asyncio.StreamReader()
        remote.feed_data(received)
        remote.feed_eof()
        upstream_writer = Mock()
        upstream_writer.drain = AsyncMock()
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

    async def held_tunnel(self, target):
        """A public tunnel that stays open until its streams are ended."""
        stream = asyncio.StreamReader()
        stream.feed_data(f"CONNECT {target} HTTP/1.1\r\n\r\n".encode())
        remote = asyncio.StreamReader()
        client = Mock()
        client.drain = AsyncMock()
        writer = Mock()
        writer.drain = AsyncMock()
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
            while not client.write.called:
                await asyncio.sleep(0.01)
            second = await self.handle("www.ti.com:443")
            provider = await self.handle("api.anthropic.com:443")
            remote.feed_eof()
            await held
        self.assertIn(b"X-Bench-Refusal: too_many_connections\r\n", second)
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
        first = Mock()
        with patch.object(egress, "MAX_PENDING_HEADERS", 1), \
                patch.object(egress, "HEADER_TIMEOUT_S", 0.3):
            held = asyncio.create_task(egress.handle(waiting, first))
            await asyncio.sleep(0.05)
            extra = Mock()
            await asyncio.wait_for(egress.handle(asyncio.StreamReader(), extra), 0.1)
            extra.write.assert_not_called()
            extra.close.assert_called_once()
            await held
        self.assertEqual(egress.pending_headers, 0)


if __name__ == "__main__":
    unittest.main()
