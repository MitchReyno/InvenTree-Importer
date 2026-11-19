"""Per-turn egress policy with synthetic DNS. No network connection is opened."""
import asyncio
import importlib.util
import json
from pathlib import Path
import socket
import sys
from tempfile import TemporaryDirectory
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


def dns(table):
    """A getaddrinfo stand-in: unknown names fail like an NXDOMAIN answer."""
    def lookup(host, *_args, **_kwargs):
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

    async def connect(self, target, table, open_results=None):
        stream = asyncio.StreamReader()
        stream.feed_data(f"CONNECT {target} HTTP/1.1\r\n\r\n".encode())
        stream.feed_eof()
        client = Mock()
        client.drain = AsyncMock()
        remote = asyncio.StreamReader()
        remote.feed_eof()
        upstream_writer = Mock()
        upstream_writer.drain = AsyncMock()
        lookup = dns(table)
        loop = asyncio.get_running_loop()

        async def loop_lookup(host, port, **kwargs):
            return lookup(host, port, **kwargs)

        with patch.object(socket, "getaddrinfo", side_effect=lookup) as guest_dns, \
                patch.object(loop, "getaddrinfo", side_effect=loop_lookup) as provider_dns, \
                patch.object(egress.asyncio, "open_connection",
                             AsyncMock(side_effect=open_results(remote, upstream_writer) if open_results
                                       else None, return_value=(remote, upstream_writer))) as upstream:
            await egress.handle(stream, client)
        written = b"".join(call.args[0] for call in client.write.call_args_list)
        client.close.assert_called_once()
        self.lookups = guest_dns.call_count + provider_dns.call_count
        return written, upstream

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


if __name__ == "__main__":
    unittest.main()
