"""Pure rules for what the backend records about a client (ADR 0002, sections 10 and 11).

- The client address is taken from the proxy header only when the request comes from a
  configured trusted proxy.
- A counter's key is a hash: an address is never stored in a counter.
- An audit event holds the address shortened to its network (/24 or /48) and the browser family.
"""

from __future__ import annotations

import hashlib
import ipaddress
from collections.abc import Sequence
from dataclasses import dataclass

type Address = ipaddress.IPv4Address | ipaddress.IPv6Address
type Network = ipaddress.IPv4Network | ipaddress.IPv6Network

_UNKNOWN = "unknown"
# Checked in this order: later names also appear in the earlier browsers' strings.
_FAMILIES = (
    ("Edg", "Edge"),
    ("OPR", "Opera"),
    ("Firefox", "Firefox"),
    ("FxiOS", "Firefox"),
    ("Chrome", "Chrome"),
    ("CriOS", "Chrome"),
    ("Safari", "Safari"),
)


@dataclass(frozen=True)
class ClientInfo:
    """What the `auth_*` functions and the audit events get: the `client` argument."""

    network: str | None
    family: str


def _parse(text: str | None) -> Address | None:
    if text is None:
        return None
    try:
        address = ipaddress.ip_address(text.strip())
    except ValueError:
        return None
    mapped = address.ipv4_mapped if isinstance(address, ipaddress.IPv6Address) else None
    return mapped or address


def _trusted(address: Address, proxies: Sequence[Network]) -> bool:
    return any(address.version == proxy.version and address in proxy for proxy in proxies)


def client_address(
    peer: str | None, forwarded_for: str | None, proxies: Sequence[Network]
) -> Address | None:
    """The client's address: the peer, or the nearest hop of the header that is not a proxy.

    The header counts only when the peer itself is a trusted proxy. It is read from the right,
    the side the trusted proxies wrote. An entry that is not an address ends the walk, so
    nothing a client wrote further left is believed.
    """
    address = _parse(peer)
    if address is None or not _trusted(address, proxies) or forwarded_for is None:
        return address
    for entry in reversed(forwarded_for.split(",")):
        hop = _parse(entry)
        if hop is None:
            break
        address = hop
        if not _trusted(hop, proxies):
            break
    return address


def _network(address: Address, v4_bits: int, v6_bits: int) -> Network:
    bits = v4_bits if address.version == 4 else v6_bits
    return ipaddress.ip_network((address, bits), strict=False)


def audit_network(address: Address | None) -> str | None:
    """The address shortened to its network, /24 or /48 (section 11)."""
    return None if address is None else str(_network(address, 24, 48))


def address_hash(address: Address | None) -> bytes:
    """The key of an address in the counters. An IPv6 client is its /64: it owns all of it."""
    subject = _UNKNOWN if address is None else str(_network(address, 32, 64))
    return hashlib.sha256(("address:" + subject).encode("ascii")).digest()


def browser_family(user_agent: str | None) -> str:
    """The browser family of a User-Agent header: a short fixed name, never the header."""
    if user_agent:
        for marker, family in _FAMILIES:
            if marker in user_agent:
                return family
    return "Other"


def client_info(address: Address | None, user_agent: str | None) -> ClientInfo:
    return ClientInfo(network=audit_network(address), family=browser_family(user_agent))
