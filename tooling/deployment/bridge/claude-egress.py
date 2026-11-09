"""Expose a CONNECT proxy on a guest-only Unix socket for the Claude CLI."""
import asyncio
import os
import socket
from pathlib import Path

from guest_destinations import configured_hosts, permitted_addresses

PROTECTED = configured_hosts("INTAKE_VM_PROTECTED_HOSTS")
CODEX = os.environ.get("INTAKE_VM_CODEX_SUBSCRIPTION") == "1"
HOSTS = {"auth.openai.com", "chatgpt.com"} if CODEX else {"api.anthropic.com"}
SOCKET = Path("/run/egress/codex.sock" if CODEX else "/run/egress/claude.sock")


async def copy(source, target):
    while data := await source.read(65536):
        target.write(data)
        await target.drain()


async def handle(reader, client):
    upstream = None
    tasks = []
    try:
        headers = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
        fields = headers.split(b"\r\n", 1)[0].split()
        allowed = {f"{host}:443".encode(): host for host in HOSTS}
        if (len(fields) != 3 or fields[0] != b"CONNECT" or fields[1] not in allowed
                or fields[2] not in (b"HTTP/1.0", b"HTTP/1.1")):
            client.write(b"HTTP/1.1 403 Forbidden\r\n\r\n")
            await client.drain()
            return
        addresses = await asyncio.get_running_loop().getaddrinfo(
            allowed[fields[1]], 443, family=socket.AF_INET, type=socket.SOCK_STREAM)
        if not await asyncio.to_thread(permitted_addresses, addresses, PROTECTED):
            return
        address = addresses[0][4][0]
        remote, upstream = await asyncio.wait_for(asyncio.open_connection(address, 443), 10)
        client.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await client.drain()
        tasks = [asyncio.create_task(copy(reader, upstream)),
                 asyncio.create_task(copy(remote, client))]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except (OSError, ValueError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
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
