"""Destination checks shared by the document service and guest provider tunnels."""
import ipaddress
import os
import re
import socket

LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
DNS_NAME = re.compile(rf"{LABEL}(?:\.{LABEL})+")
PRIVATE_SUFFIXES = (".localhost", ".internal", ".local", ".lan", ".arpa", ".onion", ".test", ".invalid")


def configured_hosts(name):
    names = set(filter(None, os.environ.get(name, "").lower().split(",")))
    if any(not DNS_NAME.fullmatch(host) for host in names):
        raise ValueError("invalid web policy hostname")
    return names


def public(value):
    address = ipaddress.ip_address(value)
    return (address.is_global and not address.is_multicast and
            (address.version == 4 or address in ipaddress.ip_network("2000::/3"))
            and not getattr(address, "sixtofour", None) and not getattr(address, "teredo", None))


def permitted_addresses(answers, protected):
    blocked = {address[4][0] for host in protected
               for address in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
    return bool(answers) and all(public(answer[4][0]) and answer[4][0] not in blocked for answer in answers)
