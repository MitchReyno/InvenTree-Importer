"""Persistent one-shot ack-loss faults on the reviewed loopback demonstration."""
from __future__ import annotations

import socket
from threading import Event
from urllib.parse import urlsplit

from invimport.demo.server import DemoHandler, DemoHTTPServer


class FaultServer(DemoHTTPServer):
    def __init__(self, state, instance, port=0):
        super().__init__(state, instance, port)
        self.RequestHandlerClass = FaultHandler
        self.release_ack = Event()
        with state.connect() as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS spike_faults(route TEXT, mode TEXT, consumed INTEGER DEFAULT 0)")

    def arm(self, route: str, mode: str) -> None:
        if mode not in {"lose_ack", "hold_ack"}:
            raise ValueError("unsupported spike fault")
        with self.state.connect() as connection:
            connection.execute("INSERT INTO spike_faults(route,mode) VALUES (?,?)", (route, mode))


class FaultHandler(DemoHandler):
    def send(self, code: int, body: object) -> None:
        route = urlsplit(self.path).path.removeprefix("/api/")
        fault = None
        if self.command in {"POST", "PATCH"} and 200 <= code < 300:
            with self.server.state.connect() as connection:
                fault = connection.execute("SELECT rowid,mode FROM spike_faults WHERE route=? AND consumed=0 LIMIT 1", (route,)).fetchone()
                if fault:
                    connection.execute("UPDATE spike_faults SET consumed=1 WHERE rowid=?", (fault[0],))
        if fault:
            self.server.state.record_request(self.command, route, {}, fault[1])
            if fault[1] == "hold_ack":
                # Tests release the accepted response after delivering cancel;
                # a bound prevents a failed test from leaving the listener hung.
                self.server.release_ack.wait(timeout=15)
            else:
                self.close_connection = True
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
        super().send(code, body)
