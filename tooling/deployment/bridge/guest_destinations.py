"""Destination checks shared by the document service and guest provider tunnels."""
import ipaddress
import os
import re
import socket

LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
DNS_NAME = re.compile(rf"{LABEL}(?:\.{LABEL})+")
PRIVATE_SUFFIXES = (".localhost", ".internal", ".local", ".lan", ".arpa", ".onion", ".test", ".invalid")
MAX_DNS_NAME_BYTES = 253
# IANA special-purpose ranges that are not globally reachable, listed explicitly so the
# check doesn't depend on which Python version's is_global tables are installed.
NON_GLOBAL_V4 = tuple(ipaddress.ip_network(network) for network in (
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
    "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16",
    "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4"))
# Within 2000::/3: IETF protocol assignments (including Teredo), documentation, 6to4.
NON_GLOBAL_V6 = tuple(ipaddress.ip_network(network) for network in (
    "2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20"))


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
    if not address.is_global or address.is_multicast:
        return False
    if address.version == 4:
        return not any(address in network for network in NON_GLOBAL_V4)
    return (address in ipaddress.ip_network("2000::/3")
            and not any(address in network for network in NON_GLOBAL_V6))


def reader_public(value):
    """The document reader's address rule, kept unchanged while the reader remains."""
    address = ipaddress.ip_address(value)
    return (address.is_global and not address.is_multicast and
            (address.version == 4 or address in ipaddress.ip_network("2000::/3"))
            and not getattr(address, "sixtofour", None) and not getattr(address, "teredo", None))


def permitted_addresses(answers, protected):
    blocked = {address[4][0] for host in protected
               for address in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
    return bool(answers) and all(reader_public(answer[4][0]) and answer[4][0] not in blocked
                                 for answer in answers)


class Refused(Exception):
    """A public-access refusal whose reason the egress proxy reports to the agent.

    `found` holds the public addresses a refused protected subdomain resolved to, so the
    egress can block them too."""

    def __init__(self, reason, found=None):
        super().__init__(reason)
        self.reason = reason
        self.found = found


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
    """The name's addresses, looked up as an absolute name so no search domain is appended."""
    try:
        answers = socket.getaddrinfo(host + ".", 443, type=socket.SOCK_STREAM)
    except OSError as error:
        raise Refused("resolution_failed") from error
    return [answer[4][0] for answer in answers]


def check_public_syntax(host, port):
    """Refuses a public CONNECT to a port other than 443 or to something not a DNS name."""
    if port != 443 or not dns_name(host) or not host.split(".")[-1].isalpha():
        raise Refused("destination_refused")


def check_public_form(host, port, protected):
    """Refuses a public CONNECT whose name or port can never be allowed, before any DNS.

    A configured protected name with a private suffix, such as `inventory.internal`, reports
    protected_destination rather than the generic suffix refusal.
    """
    check_public_syntax(host, port)
    if host.endswith(PRIVATE_SUFFIXES):
        if protected_name(host, protected):
            raise Refused("protected_destination")
        raise Refused("destination_refused")


def public_target(host, port, protected):
    """The destination's checked addresses for a public CONNECT, or Refused with its reason.

    The caller answers an exact protected name from its own refresh, and compares the result
    with every protected name's addresses."""
    check_public_form(host, port, protected)
    protected_subdomain = protected_name(host, protected)
    try:
        addresses = resolved_addresses(host)
    except Refused:
        # A protected subdomain without its own record is still protected.
        if protected_subdomain:
            raise Refused("protected_destination") from None
        raise
    # A protected subdomain's public answers are protected addresses too.
    found = ({address for address in map(normalized, addresses) if public(str(address))}
             if protected_subdomain else None)
    # A private answer reports not_public even under a protected name.
    if not addresses or not all(public(address) for address in addresses):
        raise Refused("not_public", found)
    if protected_subdomain:
        raise Refused("protected_destination", found)
    return connection_order(addresses)


def connection_order(addresses):
    """Checked addresses, IPv4 first: the VM's container bridge has no IPv6 route."""
    unique = list(dict.fromkeys(addresses))
    return sorted(unique, key=lambda address: ipaddress.ip_address(address).version)
