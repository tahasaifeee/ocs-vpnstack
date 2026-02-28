"""
Thin async wrappers around ocpasswd, occtl, and the oath/route/config files.
All blocking file operations run in a thread executor to stay non-blocking.
"""
import asyncio
import json
import re
import subprocess
from pathlib import Path

import httpx

from config import settings

OCSERV_CONF = "/etc/ocserv/ocserv.conf"


# ── helpers ───────────────────────────────────────────────────────────────────

async def _run(*args: str, input: str | None = None) -> tuple[int, str, str]:
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: subprocess.run(args, input=input, capture_output=True, text=True),
    )
    return result.returncode, result.stdout, result.stderr


# ── ocpasswd ──────────────────────────────────────────────────────────────────

async def ocpasswd_create(username: str, password: str) -> None:
    rc, _, err = await _run(
        "ocpasswd", "-c", settings.ocpasswd_file, username,
        input=f"{password}\n{password}\n",
    )
    if rc != 0:
        raise RuntimeError(f"ocpasswd failed: {err}")


async def ocpasswd_lock(username: str) -> None:
    rc, _, err = await _run("ocpasswd", "-c", settings.ocpasswd_file, "-l", username)
    if rc != 0:
        raise RuntimeError(f"ocpasswd lock failed: {err}")


async def ocpasswd_unlock(username: str) -> None:
    rc, _, err = await _run("ocpasswd", "-c", settings.ocpasswd_file, "-u", username)
    if rc != 0:
        raise RuntimeError(f"ocpasswd unlock failed: {err}")


async def ocpasswd_delete(username: str) -> None:
    rc, _, err = await _run("ocpasswd", "-c", settings.ocpasswd_file, "-d", username)
    if rc != 0:
        raise RuntimeError(f"ocpasswd delete failed: {err}")


# ── occtl ─────────────────────────────────────────────────────────────────────

async def occtl(*args: str) -> str:
    rc, out, err = await _run("occtl", "--socket-file", "/run/ocserv/ocserv.sock", *args)
    if rc != 0:
        raise RuntimeError(f"occtl {' '.join(args)} failed: {err}")
    return out


async def get_active_sessions() -> list[dict]:
    try:
        raw = await occtl("show", "users")
    except RuntimeError:
        return []

    sessions = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("username"):
            continue
        parts = re.split(r"\s{2,}", line)
        if len(parts) >= 7:
            sessions.append({
                "username": parts[0],
                "ip_real": parts[2],
                "ip_local": parts[3],
                "device": parts[4],
                "connected_since": parts[5],
                "rx_bytes": _parse_bytes(parts[6]),
                "tx_bytes": _parse_bytes(parts[7]) if len(parts) > 7 else 0,
            })
    return sessions


async def disconnect_user(username: str) -> None:
    await occtl("disconnect", "user", username)


async def reload_config() -> None:
    try:
        await occtl("reload")
    except RuntimeError:
        pass


def _parse_bytes(s: str) -> int:
    s = s.strip().upper()
    mult = {"GB": 1024**3, "MB": 1024**2, "KB": 1024, "B": 1}
    for unit, factor in mult.items():
        if s.endswith(unit):
            try:
                return int(float(s[: -len(unit)]) * factor)
            except ValueError:
                return 0
    try:
        return int(s)
    except ValueError:
        return 0


# ── OTP / users.oath ──────────────────────────────────────────────────────────

async def oath_add(username: str, secret_hex: str) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _oath_write, username, secret_hex)


def _oath_write(username: str, secret_hex: str) -> None:
    oath_path = Path(settings.oath_file)
    lines = oath_path.read_text().splitlines() if oath_path.exists() else []
    new_line = f"HOTP/T30 {username} - {secret_hex}"
    updated = [l for l in lines if not (l.strip() and l.split()[1] == username)] + [new_line]
    oath_path.write_text("\n".join(updated) + "\n")


async def oath_remove(username: str) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _oath_remove_sync, username)


def _oath_remove_sync(username: str) -> None:
    oath_path = Path(settings.oath_file)
    if not oath_path.exists():
        return
    lines = oath_path.read_text().splitlines()
    kept = [l for l in lines if not (l.strip() and l.split()[1] == username)]
    oath_path.write_text("\n".join(kept) + "\n")


# ── Per-user config files ─────────────────────────────────────────────────────

async def write_user_config(
    username: str,
    routes: list[dict],
    static_ip: str | None = None,
    max_sessions: int | None = None,
    dns_servers: str | None = None,
    session_timeout: int | None = None,
) -> None:
    """Write a comprehensive per-user ocserv config file, then reload."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None, _write_config_sync,
        username, routes, static_ip, max_sessions, dns_servers, session_timeout,
    )
    await reload_config()


def _write_config_sync(
    username: str,
    routes: list[dict],
    static_ip: str | None,
    max_sessions: int | None,
    dns_servers: str | None,
    session_timeout: int | None,
) -> None:
    routes_dir = Path(settings.user_routes_dir)
    routes_dir.mkdir(parents=True, exist_ok=True)
    conf_path = routes_dir / f"{username}.conf"

    lines = ["# Auto-generated by vpn-api — do not edit manually\n"]
    if static_ip:
        lines.append(f"ipv4-address = {static_ip}\n")
    if max_sessions is not None:
        lines.append(f"max-same-clients = {max_sessions}\n")
    if session_timeout is not None:
        lines.append(f"session-timeout = {session_timeout}\n")
    if dns_servers:
        for dns in [d.strip() for d in dns_servers.split(",") if d.strip()]:
            lines.append(f"dns = {dns}\n")
    for r in routes:
        directive = "no-route" if r.get("is_excluded") else "route"
        lines.append(f"{directive} = {r['cidr']}\n")

    conf_path.write_text("".join(lines))


async def write_user_routes(username: str, routes: list[dict]) -> None:
    """Backward-compat alias — use write_user_config for full control."""
    await write_user_config(username, routes)


async def delete_user_routes(username: str) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _delete_routes_sync, username)


def _delete_routes_sync(username: str) -> None:
    conf_path = Path(settings.user_routes_dir) / f"{username}.conf"
    conf_path.unlink(missing_ok=True)


# ── Global network settings (ocserv.conf read/write) ─────────────────────────

def _read_conf_sync() -> dict:
    result: dict = {
        "ipv4_network": "172.16.0.0/16",
        "ipv4_netmask": "255.255.0.0",
        "dns_servers": ["8.8.8.8", "1.1.1.1"],
        "max_clients": 128,
        "max_same_clients": 2,
        "ipv6_network": None,
        "tunnel_all_dns": True,
    }
    try:
        text = Path(OCSERV_CONF).read_text()
        dns: list[str] = []
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip().lower()
            val = val.strip()
            if key == "ipv4-network":
                result["ipv4_network"] = val
            elif key == "ipv4-netmask":
                result["ipv4_netmask"] = val
            elif key == "dns":
                dns.append(val)
            elif key == "max-clients":
                try:
                    result["max_clients"] = int(val)
                except ValueError:
                    pass
            elif key == "max-same-clients":
                try:
                    result["max_same_clients"] = int(val)
                except ValueError:
                    pass
            elif key == "ipv6-network":
                result["ipv6_network"] = val
            elif key == "tunnel-all-dns":
                result["tunnel_all_dns"] = val.lower() in ("true", "1", "yes")
        if dns:
            result["dns_servers"] = dns
    except FileNotFoundError:
        pass
    return result


def _write_conf_sync(updates: dict) -> None:
    conf_path = Path(OCSERV_CONF)
    if not conf_path.exists():
        return

    lines = conf_path.read_text().splitlines(keepends=True)
    single_directives: dict[str, str | None] = {}
    if "ipv4_network" in updates:
        single_directives["ipv4-network"] = updates["ipv4_network"]
    if "ipv4_netmask" in updates:
        single_directives["ipv4-netmask"] = updates["ipv4_netmask"]
    if "max_clients" in updates:
        single_directives["max-clients"] = str(updates["max_clients"])
    if "max_same_clients" in updates:
        single_directives["max-same-clients"] = str(updates["max_same_clients"])
    if "tunnel_all_dns" in updates:
        single_directives["tunnel-all-dns"] = "true" if updates["tunnel_all_dns"] else "false"
    if "ipv6_network" in updates:
        single_directives["ipv6-network"] = updates["ipv6_network"] or None

    dns_servers: list[str] | None = updates.get("dns_servers")

    new_lines: list[str] = []
    seen: set[str] = set()
    dns_written = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            new_lines.append(line)
            continue
        key, _, _ = stripped.partition("=")
        key = key.strip().lower()

        if key in single_directives:
            if key not in seen:
                val = single_directives[key]
                if val is not None:
                    new_lines.append(f"{key} = {val}\n")
                seen.add(key)
        elif key == "dns" and dns_servers is not None:
            if not dns_written:
                for dns in dns_servers:
                    new_lines.append(f"dns = {dns}\n")
                dns_written = True
        else:
            new_lines.append(line)

    for key, val in single_directives.items():
        if key not in seen and val is not None:
            new_lines.append(f"{key} = {val}\n")
    if dns_servers is not None and not dns_written:
        for dns in dns_servers:
            new_lines.append(f"dns = {dns}\n")

    conf_path.write_text("".join(new_lines))


async def get_network_settings() -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _read_conf_sync)


async def set_network_settings(updates: dict) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _write_conf_sync, updates)
    await reload_config()


# ── GeoIP (ip-api.com with Redis cache) ──────────────────────────────────────

_PRIVATE_PREFIXES = (
    "10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.2",
    "192.168.", "127.", "::1", "fc", "fd",
)


async def get_geoip(ip: str, redis=None) -> dict:
    """Geo-locate an IP via ip-api.com with a 24 h Redis cache."""
    if any(ip.startswith(p) for p in _PRIVATE_PREFIXES):
        return {}

    cache_key = f"geoip:{ip}"
    if redis:
        cached = await redis.get(cache_key)
        if cached:
            return json.loads(cached)

    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(
                f"http://ip-api.com/json/{ip}",
                params={"fields": "status,country,countryCode,city"},
            )
            data = resp.json()
            if data.get("status") == "success":
                result = {
                    "geo_country": data.get("country"),
                    "geo_country_code": data.get("countryCode"),
                    "geo_city": data.get("city"),
                }
                if redis:
                    await redis.setex(cache_key, 86400, json.dumps(result))
                return result
    except Exception:
        pass
    return {}
