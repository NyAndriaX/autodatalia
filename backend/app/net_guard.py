"""SSRF guard for server-side fetches of user/tenant-supplied URLs.

The backend pulls a number of URLs server-side with httpx — media a user
pasted into a draft (LinkedIn image upload), output URLs returned by video
providers, and per-tenant AI base URLs set on the Settings page. Without a
guard, an authenticated tenant can point any of those at an internal target
(``169.254.169.254`` cloud-metadata, ``127.0.0.1`` admin ports, RFC-1918
services) and have our server fetch it for them — classic SSRF, plus a
credential-exfil vector for the ``Authorization`` headers we attach to AI
calls.

This module centralises the defence:

  * ``assert_safe_url`` / ``is_safe_public_url`` — validate scheme + resolve
    the host and reject if ANY resolved address is private / loopback /
    link-local / reserved / multicast / unspecified (covers metadata IPs and
    their IPv6 equivalents).
  * ``safe_get`` / ``safe_get_async`` — fetch with redirects disabled and
    each hop's ``Location`` re-validated before it is followed, so a public
    URL can't 30x-bounce us into an internal one.

Dependency-light on purpose: stdlib ``socket`` + ``ipaddress`` plus the
``httpx`` the callers already use.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit, urljoin

import httpx

# Allowed URL schemes. Everything else (file://, gopher://, ftp://, data:,
# ...) is rejected outright — none of our server-side fetches need them.
_ALLOWED_SCHEMES = {"http", "https"}

# How many redirect hops we'll follow while re-validating each one. Matches
# httpx's default ceiling closely enough for the provider/CDN flows we see.
_MAX_REDIRECTS = 5


def _ip_is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """True if ``ip`` points at something we must never fetch server-side."""
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    ):
        return True

    # Belt-and-braces explicit blocks. ``is_link_local`` already covers the
    # IPv4 metadata range and fe80::/10, and ``is_private`` already covers
    # fc00::/7 and ::1 — but we spell them out so the intent survives any
    # future refactor of the flag list above.
    if isinstance(ip, ipaddress.IPv4Address):
        # 169.254.0.0/16 — link-local, and the home of the cloud metadata
        # endpoint 169.254.169.254 on AWS/GCP/Azure/DO/etc.
        if ip in ipaddress.ip_network("169.254.0.0/16"):
            return True
    else:
        # IPv6: loopback ::1, unique-local fc00::/7, link-local fe80::/10.
        if (
            ip in ipaddress.ip_network("::1/128")
            or ip in ipaddress.ip_network("fc00::/7")
            or ip in ipaddress.ip_network("fe80::/10")
        ):
            return True
        # An IPv4-mapped IPv6 address (::ffff:a.b.c.d) must be judged on its
        # embedded v4 address, otherwise ::ffff:169.254.169.254 sails through.
        mapped = getattr(ip, "ipv4_mapped", None)
        if mapped is not None and _ip_is_blocked(mapped):
            return True

    return False


def is_safe_public_url(url: str) -> bool:
    """Return True iff ``url`` is an http(s) URL that resolves only to
    public addresses. Never raises — a convenience wrapper around
    :func:`assert_safe_url` for call-sites that want a boolean."""
    try:
        assert_safe_url(url)
        return True
    except ValueError:
        return False


def assert_safe_url(url: str) -> None:
    """Validate ``url`` for server-side fetching, raising ``ValueError`` on
    anything that smells like SSRF.

    Checks, in order:
      * scheme is http/https
      * a hostname is present
      * EVERY address the hostname resolves to is a public, routable IP
        (literal IPs are checked directly, no DNS needed)
    """
    if not url or not isinstance(url, str):
        raise ValueError("Refusing to fetch an empty/invalid URL.")

    parts = urlsplit(url.strip())
    scheme = (parts.scheme or "").lower()
    if scheme not in _ALLOWED_SCHEMES:
        raise ValueError(
            f"Refusing to fetch URL with unsupported scheme {scheme!r}; "
            "only http/https are allowed."
        )

    host = parts.hostname
    if not host:
        raise ValueError("Refusing to fetch URL with no host.")

    # If the host is already an IP literal, judge it directly — getaddrinfo
    # would just echo it back, but this also covers bracketed IPv6 literals.
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if _ip_is_blocked(literal):
            raise ValueError(
                f"Refusing to fetch URL whose host {host!r} is a "
                "private/loopback/link-local/reserved address."
            )
        return

    # Resolve the hostname and reject if ANY address is internal. Resolving
    # everything (not just the first) closes the DNS-rebinding-ish gap where
    # a name has both a public and an internal A record.
    try:
        infos = socket.getaddrinfo(host, parts.port or None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve host {host!r}: {exc}") from exc

    if not infos:
        raise ValueError(f"Host {host!r} did not resolve to any address.")

    for info in infos:
        sockaddr = info[4]
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            # Unparseable address — fail closed rather than assume it's safe.
            raise ValueError(f"Host {host!r} resolved to unparsable address {ip_str!r}.")
        if _ip_is_blocked(ip):
            raise ValueError(
                f"Refusing to fetch URL: host {host!r} resolves to "
                f"internal address {ip_str}."
            )


def safe_get_async(
    client: httpx.AsyncClient,
    url: str,
    *,
    max_redirects: int = _MAX_REDIRECTS,
    **kwargs,
):
    """SSRF-safe replacement for ``await client.get(url, ...)``.

    Validates the initial URL, then issues the request with redirects
    DISABLED and manually follows up to ``max_redirects`` hops, re-validating
    each ``Location`` before following it. Returns the final
    ``httpx.Response``. Caller keeps its own timeout/error handling — we only
    add the guard.

    Note: ``follow_redirects`` in ``kwargs`` is ignored on purpose; we always
    drive redirects ourselves so every hop is validated.
    """
    kwargs.pop("follow_redirects", None)

    async def _run():
        assert_safe_url(url)
        current = url
        for _ in range(max_redirects + 1):
            resp = await client.get(current, follow_redirects=False, **kwargs)
            if resp.is_redirect and resp.has_redirect_location:
                location = resp.headers.get("location", "")
                next_url = urljoin(current, location)
                assert_safe_url(next_url)
                # Drain the redirect body so the connection can be reused.
                await resp.aread()
                current = next_url
                continue
            return resp
        raise ValueError(f"Too many redirects (> {max_redirects}) fetching {url!r}.")

    return _run()


def safe_get(
    client: httpx.Client,
    url: str,
    *,
    max_redirects: int = _MAX_REDIRECTS,
    **kwargs,
) -> httpx.Response:
    """Sync counterpart of :func:`safe_get_async` for ``httpx.Client``.

    Provided for completeness; the current callers are all async, but a sync
    fetch should go through the same guard if one is ever added.
    """
    kwargs.pop("follow_redirects", None)
    assert_safe_url(url)
    current = url
    for _ in range(max_redirects + 1):
        resp = client.get(current, follow_redirects=False, **kwargs)
        if resp.is_redirect and resp.has_redirect_location:
            location = resp.headers.get("location", "")
            next_url = urljoin(current, location)
            assert_safe_url(next_url)
            resp.read()
            current = next_url
            continue
        return resp
    raise ValueError(f"Too many redirects (> {max_redirects}) fetching {url!r}.")
