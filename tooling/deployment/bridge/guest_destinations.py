"""Destination checks shared by the document service and guest provider tunnels."""
import ipaddress
import os
import re
import socket

LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
DNS_NAME = re.compile(rf"{LABEL}(?:\.{LABEL})+")
PRIVATE_SUFFIXES = (".localhost", ".internal", ".local", ".lan", ".arpa", ".onion", ".test", ".invalid")
MAX_DNS_NAME_BYTES = 253
# IANA's IPv6 documentation range inside 2000::/3; not globally reachable.
DOCUMENTATION_V6 = ipaddress.ip_network("3fff::/20")


def configured_hosts(name):
    names = set(filter(None, os.environ.get(name, "").lower().split(",")))
    if any(not DNS_NAME.fullmatch(host) for host in names):
        raise ValueError("invalid web policy hostname")
    return names


def dns_name(value):
    """A lowercase DNS name of at least two labels within the 253-byte limit."""
    return len(value) <= MAX_DNS_NAME_BYTES and DNS_NAME.fullmatch(value) is not None


def public(value):
    address = ipaddress.ip_address(value)
    return (address.is_global and not address.is_multicast and
            (address.version == 4 or (address in ipaddress.ip_network("2000::/3")
                                      and address not in DOCUMENTATION_V6))
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


def normalized(value):
    """An address with IPv4-mapped IPv6 replaced by its IPv4 address, so aliases compare equal."""
    address = ipaddress.ip_address(value)
    return getattr(address, "ipv4_mapped", None) or address


def literal_address(value):
    """The IP address a protected entry names directly, or None for a DNS name."""
    try:
        return normalized(value)
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
        addresses = [literal] if literal is not None else map(normalized, resolved_addresses(entry))
        blocked |= {address for address in addresses if public(str(address))}
    return blocked


def public_target(host, port, protected):
    """The checked address to connect to for a public CONNECT, or Refused with its reason."""
    target_name = (dns_name(host) and host.split(".")[-1].isalpha()
                   and not host.endswith(PRIVATE_SUFFIXES))
    if port != 443 or not target_name:
        raise Refused("destination_refused")
    addresses = resolved_addresses(host)
    if not addresses or not all(public(address) for address in addresses):
        raise Refused("not_public")
    if protected_name(host, protected):
        raise Refused("protected_destination")
    blocked = protected_addresses(protected)
    if any(normalized(address) in blocked for address in addresses):
        raise Refused("protected_destination")
    return addresses[0]
