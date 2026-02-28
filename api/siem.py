"""
Syslog and SIEM (webhook) forwarding utilities.

Syslog handler is attached to the root logger and reconfigured live when
settings change via the /service/syslog endpoint.

SIEM events are forwarded as async HTTP POST supporting generic JSON,
GELF (Graylog), and Splunk HEC formats.
"""
import json
import logging
import logging.handlers
import socket
import time
from datetime import datetime, timezone

import httpx

_syslog_handler: logging.Handler | None = None

_auth_logger  = logging.getLogger("vpn.auth")
_event_logger = logging.getLogger("vpn.event")

# Cached SIEM config so the internal event helpers can use it without a DB hit
_siem_cfg: dict = {}


# ── Syslog ────────────────────────────────────────────────────────────────────

def apply_syslog_config(cfg_dict: dict) -> None:
    """Install or remove the UDP/TCP syslog handler from the root logger."""
    global _syslog_handler
    root = logging.getLogger()

    if _syslog_handler:
        root.removeHandler(_syslog_handler)
        _syslog_handler = None

    if not cfg_dict.get("enabled"):
        return

    host     = cfg_dict.get("host", "127.0.0.1")
    port     = int(cfg_dict.get("port", 514))
    protocol = cfg_dict.get("protocol", "udp")
    facility = cfg_dict.get("facility", "local0")

    try:
        socktype = socket.SOCK_STREAM if protocol == "tcp" else socket.SOCK_DGRAM
        fac_name = f"LOG_{facility.upper()}"
        fac      = getattr(logging.handlers.SysLogHandler, fac_name,
                           logging.handlers.SysLogHandler.LOG_LOCAL0)
        handler  = logging.handlers.SysLogHandler(
            address=(host, port), facility=fac, socktype=socktype,
        )
        handler.setFormatter(logging.Formatter("vpn-dashboard: %(message)s"))
        handler.setLevel(logging.INFO)
        _syslog_handler = handler
        root.addHandler(handler)
        _event_logger.info("Syslog configured: %s:%d (%s)", host, port, protocol)
    except Exception as exc:
        logging.getLogger(__name__).warning("Syslog setup failed: %s", exc)


def cache_siem_config(cfg_dict: dict) -> None:
    """Store SIEM config in memory so event helpers can fire without a DB query."""
    global _siem_cfg
    _siem_cfg = cfg_dict


# ── Auth event helpers ────────────────────────────────────────────────────────

def log_auth_event(username: str, ip: str | None, success: bool, reason: str | None = None) -> None:
    status = "SUCCESS" if success else "FAILURE"
    msg = f"AUTH {status} user={username} ip={ip or 'unknown'}"
    if reason:
        msg += f" reason={reason}"
    _auth_logger.info(msg)


# ── SIEM webhook ──────────────────────────────────────────────────────────────

async def send_siem_event(cfg_dict: dict, event: dict) -> None:
    """
    POST *event* to the configured SIEM endpoint.
    Silently swallows errors — SIEM forwarding is best-effort.
    """
    if not cfg_dict.get("enabled") or not cfg_dict.get("url"):
        return

    url        = cfg_dict["url"]
    fmt        = cfg_dict.get("format", "json")
    token      = cfg_dict.get("token", "")
    verify_ssl = cfg_dict.get("verify_ssl", True)

    if fmt == "gelf":
        payload = _to_gelf(event)
    elif fmt == "splunk-hec":
        payload = _to_splunk_hec(event)
    else:
        payload = event | {"@timestamp": datetime.now(timezone.utc).isoformat()}

    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Splunk {token}" if fmt == "splunk-hec" else f"Bearer {token}"

    try:
        async with httpx.AsyncClient(verify=verify_ssl, timeout=5.0) as client:
            await client.post(url, json=payload, headers=headers)
    except Exception as exc:
        logging.getLogger(__name__).debug("SIEM forward failed: %s", exc)


async def emit_auth_siem(username: str, ip: str | None, success: bool, reason: str | None = None) -> None:
    await send_siem_event(_siem_cfg, {
        "event_type": "auth",
        "username": username,
        "ip_address": ip,
        "success": success,
        "failure_reason": reason,
    })


async def emit_session_siem(event_type: str, username: str, ip_real: str | None, ip_local: str | None) -> None:
    await send_siem_event(_siem_cfg, {
        "event_type": event_type,
        "username": username,
        "ip_real": ip_real,
        "ip_local": ip_local,
    })


# ── Format helpers ────────────────────────────────────────────────────────────

def _to_gelf(event: dict) -> dict:
    return {
        "version": "1.1",
        "host": "vpn-dashboard",
        "short_message": event.get("message") or event.get("event_type", "vpn-event"),
        "timestamp": time.time(),
        "level": 6,
        **{f"_{k}": v for k, v in event.items() if k != "message"},
    }


def _to_splunk_hec(event: dict) -> dict:
    return {
        "time": time.time(),
        "source": "vpn-dashboard",
        "sourcetype": "vpn:event",
        "event": event,
    }
