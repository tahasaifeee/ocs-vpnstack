"""
Node monitoring — network interfaces, routing table, and live traffic rates.
Reads directly from /proc and psutil so the ocserv container must share the
host network namespace (network_mode: host) or be run privileged.
"""
import asyncio
import socket
import struct
import time

import psutil
from fastapi import APIRouter, Depends

from auth import get_current_admin
from models import AdminUser

router = APIRouter(prefix="/node", tags=["node"])

# Module-level snapshot for computing per-second byte rates.
# (Single-worker uvicorn — module state is safe.)
_prev_io: dict = {}
_prev_ts: float = 0.0


def _family_label(af: int) -> str:
    try:
        af_enum = socket.AddressFamily(af)
        if af_enum == socket.AF_INET:
            return "IPv4"
        if af_enum == socket.AF_INET6:
            return "IPv6"
    except ValueError:
        pass
    if af == psutil.AF_LINK:
        return "MAC"
    return f"AF_{af}"


def _parse_ipv4_routes() -> list[dict]:
    """Parse /proc/net/route (IPv4 routing table, hex-encoded)."""
    routes: list[dict] = []
    try:
        with open("/proc/net/route") as f:
            for line in f.readlines()[1:]:
                parts = line.strip().split()
                if len(parts) < 8:
                    continue
                iface   = parts[0]
                dest    = socket.inet_ntoa(struct.pack("<L", int(parts[1], 16)))
                gateway = socket.inet_ntoa(struct.pack("<L", int(parts[2], 16)))
                flags   = int(parts[3], 16)
                metric  = int(parts[6])
                mask    = socket.inet_ntoa(struct.pack("<L", int(parts[7], 16)))

                RTF_UP      = 0x0001
                RTF_GATEWAY = 0x0002
                if not (flags & RTF_UP):
                    continue  # skip down routes

                # Compute prefix length from mask
                prefix = bin(int.from_bytes(socket.inet_aton(mask), "big")).count("1")
                cidr = f"{dest}/{prefix}" if dest != "0.0.0.0" else f"0.0.0.0/0"

                routes.append({
                    "interface": iface,
                    "destination": cidr,
                    "gateway": gateway if (flags & RTF_GATEWAY) else None,
                    "metric": metric,
                    "is_default": dest == "0.0.0.0",
                    "family": "IPv4",
                })
    except Exception:
        pass
    return routes


def _parse_ipv6_routes() -> list[dict]:
    """Parse /proc/net/ipv6_route (IPv6 routing table)."""
    routes: list[dict] = []
    try:
        with open("/proc/net/ipv6_route") as f:
            for line in f.readlines():
                parts = line.strip().split()
                if len(parts) < 10:
                    continue
                dest_hex    = parts[0]
                prefix_len  = int(parts[1], 16)
                gateway_hex = parts[4]
                flags       = int(parts[8], 16)
                iface       = parts[9]

                RTF_UP = 0x0001
                if not (flags & RTF_UP):
                    continue

                def _fmt_ipv6(h: str) -> str:
                    raw = bytes.fromhex(h)
                    return socket.inet_ntop(socket.AF_INET6, raw)

                dest    = _fmt_ipv6(dest_hex)
                gateway = _fmt_ipv6(gateway_hex)
                cidr    = f"{dest}/{prefix_len}"
                is_gw   = bool(flags & 0x0002)

                routes.append({
                    "interface": iface,
                    "destination": cidr,
                    "gateway": gateway if is_gw else None,
                    "metric": 0,
                    "is_default": dest == "::" and prefix_len == 0,
                    "family": "IPv6",
                })
    except Exception:
        pass
    return routes


def _collect_interfaces() -> list[dict]:
    stats_map  = psutil.net_if_stats()
    addrs_map  = psutil.net_if_addrs()
    io_map     = psutil.net_io_counters(pernic=True)
    routes     = _parse_ipv4_routes() + _parse_ipv6_routes()

    result = []
    for name, addr_list in addrs_map.items():
        st  = stats_map.get(name)
        io  = io_map.get(name)

        iface_routes = [r for r in routes if r["interface"] == name]

        addresses = []
        for a in addr_list:
            af = a.family if isinstance(a.family, int) else a.family.value
            addresses.append({
                "family":    _family_label(af),
                "address":   a.address,
                "netmask":   a.netmask,
                "broadcast": a.broadcast,
            })

        result.append({
            "name":       name,
            "is_up":      st.isup if st else False,
            "speed_mbps": st.speed if st else 0,
            "mtu":        st.mtu if st else 0,
            "duplex":     str(st.duplex).split(".")[-1] if st and st.duplex else None,
            "addresses":  addresses,
            "rx_bytes":   io.bytes_recv   if io else 0,
            "tx_bytes":   io.bytes_sent   if io else 0,
            "rx_packets": io.packets_recv if io else 0,
            "tx_packets": io.packets_sent if io else 0,
            "rx_errors":  io.errin        if io else 0,
            "tx_errors":  io.errout       if io else 0,
            "rx_drops":   io.dropin       if io else 0,
            "tx_drops":   io.dropout      if io else 0,
            "routes":     iface_routes,
        })

    return result


def _collect_traffic_rates() -> dict:
    """Return per-interface bytes/sec compared to previous call."""
    global _prev_io, _prev_ts

    now     = time.monotonic()
    current = psutil.net_io_counters(pernic=True)
    dt      = now - _prev_ts if _prev_ts else 1.0

    rates: dict[str, dict] = {}
    for name, c in current.items():
        prev = _prev_io.get(name)
        if prev and dt > 0:
            rates[name] = {
                "rx_bps": max(0.0, (c.bytes_recv - prev.bytes_recv) / dt),
                "tx_bps": max(0.0, (c.bytes_sent - prev.bytes_sent) / dt),
            }
        else:
            rates[name] = {"rx_bps": 0.0, "tx_bps": 0.0}

    _prev_io = current
    _prev_ts = now
    return rates


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/interfaces")
async def get_interfaces(_: AdminUser = Depends(get_current_admin)):
    """All network interfaces: addresses, counters, associated routes."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _collect_interfaces)


@router.get("/interfaces/traffic")
async def get_traffic(_: AdminUser = Depends(get_current_admin)):
    """Per-interface bytes/sec rates. Poll every 2–5 s for live charts."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _collect_traffic_rates)
