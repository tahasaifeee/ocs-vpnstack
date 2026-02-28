"""
Thin async wrappers around ocpasswd, occtl, and the oath/route files.
All file operations run in a thread executor to stay non-blocking.
"""
import asyncio
import os
import re
import subprocess
from pathlib import Path

from config import settings


# ── helpers ───────────────────────────────────────────────────────────────────

async def _run(*args: str, input: str | None = None) -> tuple[int, str, str]:
    """Run a subprocess, return (returncode, stdout, stderr)."""
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: subprocess.run(
            args,
            input=input,
            capture_output=True,
            text=True,
        ),
    )
    return result.returncode, result.stdout, result.stderr


# ── ocpasswd ──────────────────────────────────────────────────────────────────

async def ocpasswd_create(username: str, password: str) -> None:
    """Create or update a VPN user password in ocpasswd."""
    rc, _, err = await _run(
        "ocpasswd",
        "-c", settings.ocpasswd_file,
        username,
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
    """Parse `occtl show users` output into a list of dicts."""
    try:
        raw = await occtl("show", "users")
    except RuntimeError:
        return []

    sessions = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("username"):
            continue
        # occtl columns: username  groupname  ip  vpn-ip  device  since  rx  tx
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
    """Signal ocserv to reload per-user config files (no restart needed)."""
    try:
        await occtl("reload")
    except RuntimeError:
        pass  # reload is best-effort; ocserv may be restarting


def _parse_bytes(s: str) -> int:
    s = s.strip().upper()
    mult = {"B": 1, "KB": 1024, "MB": 1024**2, "GB": 1024**3}
    for unit, factor in sorted(mult.items(), key=lambda x: -len(x[0])):
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
    """Write / replace an entry in users.oath (TOTP, 30-second window)."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _oath_write, username, secret_hex)


def _oath_write(username: str, secret_hex: str) -> None:
    oath_path = Path(settings.oath_file)
    lines = oath_path.read_text().splitlines() if oath_path.exists() else []
    new_line = f"HOTP/T30 {username} - {secret_hex}"
    updated = [l for l in lines if not l.split()[1] == username if l.strip()] + [new_line]
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


# ── Per-user route files ───────────────────────────────────────────────────────

async def write_user_routes(username: str, routes: list[dict]) -> None:
    """
    Write /etc/ocserv/user-routes/<username>.conf
    Each route: {"cidr": "10.0.0.0/8", "is_excluded": False}
    """
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _write_routes_sync, username, routes)
    await reload_config()


def _write_routes_sync(username: str, routes: list[dict]) -> None:
    routes_dir = Path(settings.user_routes_dir)
    routes_dir.mkdir(parents=True, exist_ok=True)
    conf_path = routes_dir / f"{username}.conf"

    lines = [f"# Auto-generated by vpn-api — do not edit manually\n"]
    for r in routes:
        directive = "no-route" if r.get("is_excluded") else "route"
        lines.append(f"{directive} = {r['cidr']}\n")

    conf_path.write_text("".join(lines))


async def delete_user_routes(username: str) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _delete_routes_sync, username)


def _delete_routes_sync(username: str) -> None:
    conf_path = Path(settings.user_routes_dir) / f"{username}.conf"
    conf_path.unlink(missing_ok=True)
