"""Policy checks with synthetic DNS. No private services are contacted."""
import asyncio
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bridge"))
spec = importlib.util.spec_from_file_location("reader", Path(__file__).resolve().parents[1] /
                                            "bridge/web-reader.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class PublicWeb(unittest.TestCase):
    def test_unlisted_origins_are_refused_before_dns(self):
        with patch.object(reader.socket, "getaddrinfo") as lookup:
            for url in ("http://example.com", "https://inventory.invalid", "https://127.0.0.1",
                        "https://[::1]", "https://example.com@inventory.invalid",
                        "https://example.com:8443", "https://host.lima.internal"):
                with self.subTest(url=url), self.assertRaises(ValueError):
                    reader.document(url)
            lookup.assert_not_called()

    def test_public_mode_checks_protected_names_and_public_address_aliases(self):
        with patch.object(reader, "MODE", "public"), patch.object(reader, "PROTECTED", {"inventory.example"}):
            self.assertTrue(reader.permitted("manufacturer.example"))
            for host in ("inventory.example", "api.inventory.example", "host.lima.internal", "1.1.1.1"):
                self.assertFalse(reader.permitted(host))
            answer = [(2, 1, 6, "", ("1.1.1.1", 443))]
            with patch.object(reader.socket, "getaddrinfo", return_value=answer), \
                    patch.object(reader.socket, "socket") as sock, self.assertRaises(ValueError):
                try:
                    reader.document("https://alias.example/")
                finally:
                    sock.assert_not_called()

    def test_mixed_dns_answers_are_refused_before_connect(self):
        for address in ("10.0.0.1", "100.64.0.1", "169.254.169.254", "::1", "fd00::1",
                        "fe80::1", "224.0.0.1", "::ffff:127.0.0.1", "2002:7f00:1::1"):
            answers = [(None, None, None, None, (ip, 443)) for ip in ("1.1.1.1", address)]
            with self.subTest(address=address), patch.object(reader.socket, "getaddrinfo", return_value=answers), \
                    patch.object(reader.socket, "socket") as connect, self.assertRaises(ValueError):
                try:
                    reader.document("https://example.com/")
                finally:
                    connect.assert_not_called()

    def test_redirect_rechecks_origin_and_connects_to_numeric_answer(self):
        with patch.object(reader.socket, "getaddrinfo", return_value=[
                (2, 1, 6, "", ("1.1.1.1", 443))]), patch.object(reader.socket, "socket") as sock, \
                patch.object(reader.ssl, "create_default_context") as tls, \
                patch.object(reader.http.client, "HTTPSConnection") as connection:
            response = connection.return_value.getresponse.return_value
            response.status = 302
            response.getheader.return_value = "https://inventory.invalid/"
            with self.assertRaises(ValueError):
                reader.document("https://example.com/")
            raw = sock.return_value.__enter__.return_value
            raw.connect.assert_called_once_with(("1.1.1.1", 443))
            tls.return_value.wrap_socket.assert_called_once_with(raw, server_hostname="example.com")

class ProviderTunnel(unittest.IsolatedAsyncioTestCase):
    async def test_shared_public_address_does_not_open_an_upstream_socket(self):
        script = Path(__file__).resolve().parents[1] / "bridge/claude-egress.py"
        module_spec = importlib.util.spec_from_file_location("provider_egress", script)
        egress = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(egress)
        stream = asyncio.StreamReader()
        stream.feed_data(b"CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n")
        stream.feed_eof()
        client = Mock()
        client.drain = AsyncMock()
        address = [(2, 1, 6, "", ("1.1.1.1", 443))]
        with patch.object(egress, "PROTECTED", {"inventory.example"}), \
                patch.object(egress, "HOSTS", {"api.anthropic.com"}), \
                patch.object(asyncio.get_running_loop(), "getaddrinfo", return_value=address), \
                patch.object(egress.socket, "getaddrinfo", return_value=address), \
                patch.object(egress.asyncio, "open_connection") as upstream:
            await egress.handle(stream, client)
            upstream.assert_not_called()
            client.close.assert_called_once()
