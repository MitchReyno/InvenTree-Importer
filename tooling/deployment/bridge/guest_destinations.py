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


class Refused(Exception):
    """A public-access refusal whose reason the egress proxy reports to the agent."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def literal_address(value):
    """The IP address a protected entry names directly, or None for a DNS name."""
    try:
        return ipaddress.ip_address(value)
    except ValueError:
        return None


def protected_name(host, protected):
    return any(host == name or host.endswith("." + name) for name in protected)


def resolved_addresses(host):
    try:
        answers = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as error:
        raise Refused("resolution_failed") from error
    return [answer[4][0] for answer in answers]


def protected_addresses(protected):
    """Public addresses of the protected entries.

    A name that resolves only to non-public addresses adds nothing: the public-address rule
    already refuses them. A name that doesn't resolve leaves its addresses unknown, so this
    raises and the caller refuses public access for the turn.
    """
    blocked = set()
    for entry in protected:
        literal = literal_address(entry)
        if literal is not None:
            if public(entry):
                blocked.add(literal)
            continue
        for address in resolved_addresses(entry):
            if public(address):
                blocked.add(ipaddress.ip_address(address))
    return blocked


def public_target(host, port, protected):
    """The checked address to connect to for a public CONNECT, or Refused with its reason."""
    target_name = (DNS_NAME.fullmatch(host) and host.split(".")[-1].isalpha()
                   and not host.endswith(PRIVATE_SUFFIXES))
    if port != 443 or not target_name:
        raise Refused("destination_refused")
    if protected_name(host, protected):
        raise Refused("protected_destination")
    blocked = protected_addresses(protected)
    addresses = resolved_addresses(host)
    if not addresses or not all(public(address) for address in addresses):
        raise Refused("not_public")
    if any(ipaddress.ip_address(address) in blocked for address in addresses):
        raise Refused("protected_destination")
    return addresses[0]
