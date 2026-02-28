"""
Service management endpoints — ocserv status, config file backup/restore,
and runtime settings for syslog / SIEM forwarding.
"""
import asyncio
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

import occtl
import siem as siem_module
import mailer
from auth import get_current_admin
from database import get_db
from models import AdminUser, SystemSetting
from schemas import (
    BackupInfo,
    ConfigValidationResult,
    ServiceStatusOut,
    SIEMConfig,
    SmtpConfig,
    SyslogConfig,
)

router = APIRouter(prefix="/service", tags=["service"])

OCSERV_CONF = Path("/etc/ocserv/ocserv.conf")
BACKUP_DIR  = Path("/etc/ocserv/backups")
MAX_CONF_BYTES = 512 * 1024   # 512 KB


# ── Service status ────────────────────────────────────────────────────────────

@router.get("/status", response_model=ServiceStatusOut)
async def service_status(
    _: AdminUser = Depends(get_current_admin),
):
    try:
        out = await occtl.occtl("show", "status")
        running = True
        active = 0
        for line in out.splitlines():
            m = re.search(r"Connected clients[:\s]+(\d+)", line, re.IGNORECASE)
            if m:
                active = int(m.group(1))
    except RuntimeError:
        running = False
        active = 0

    version: str | None = None
    try:
        _, ver_out, _ = await occtl._run("ocserv", "--version")
        first_line = ver_out.strip().splitlines()[0] if ver_out.strip() else ""
        if first_line:
            version = first_line
    except Exception:
        pass

    return ServiceStatusOut(
        ocserv_running=running,
        active_connections=active,
        version=version,
        uptime=None,
    )


# ── Config reload / validate ──────────────────────────────────────────────────

@router.post("/reload")
async def reload_service(
    _: AdminUser = Depends(get_current_admin),
):
    await occtl.reload_config()
    return {"reloaded": True}


@router.get("/validate", response_model=ConfigValidationResult)
async def validate_config(
    _: AdminUser = Depends(get_current_admin),
):
    try:
        text = await asyncio.get_event_loop().run_in_executor(None, OCSERV_CONF.read_text)
    except FileNotFoundError:
        return ConfigValidationResult(valid=False, errors=["ocserv.conf not found"], warnings=[])
    return _validate_conf_text(text)


# ── Config file download / upload ─────────────────────────────────────────────

@router.get("/config/download")
async def download_config(
    _: AdminUser = Depends(get_current_admin),
):
    if not OCSERV_CONF.exists():
        raise HTTPException(status_code=404, detail="ocserv.conf not found")
    return FileResponse(
        str(OCSERV_CONF),
        media_type="text/plain",
        filename="ocserv.conf",
        headers={"Content-Disposition": "attachment; filename=ocserv.conf"},
    )


@router.post("/config/upload", response_model=ConfigValidationResult)
async def upload_config(
    file: Annotated[UploadFile, File()],
    apply: bool = Query(False),
    _: AdminUser = Depends(get_current_admin),
):
    contents = await file.read(MAX_CONF_BYTES + 1)
    if len(contents) > MAX_CONF_BYTES:
        raise HTTPException(status_code=400, detail="Config file too large (max 512 KB)")

    text = contents.decode("utf-8", errors="replace")
    result = _validate_conf_text(text)

    if apply:
        # Save a backup first, then overwrite
        await _save_backup(text)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: OCSERV_CONF.write_text(text))
        await occtl.reload_config()

    return result


# ── Backups ───────────────────────────────────────────────────────────────────

@router.get("/config/backups", response_model=list[BackupInfo])
async def list_backups(
    _: AdminUser = Depends(get_current_admin),
):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _list_backups_sync)


@router.post("/config/backup")
async def create_backup(
    _: AdminUser = Depends(get_current_admin),
):
    """Create a manual backup of the current ocserv.conf."""
    try:
        text = await asyncio.get_event_loop().run_in_executor(None, OCSERV_CONF.read_text)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ocserv.conf not found")
    filename = await _save_backup(text)
    return {"filename": filename}


@router.post("/config/backups/{filename}/restore", response_model=ConfigValidationResult)
async def restore_backup(
    filename: str,
    _: AdminUser = Depends(get_current_admin),
):
    if not re.match(r"^[\w\-\.]+\.conf$", filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    backup_path = BACKUP_DIR / filename
    if not backup_path.exists():
        raise HTTPException(status_code=404, detail="Backup not found")

    loop = asyncio.get_event_loop()
    text = await loop.run_in_executor(None, backup_path.read_text)
    await loop.run_in_executor(None, lambda: OCSERV_CONF.write_text(text))
    await occtl.reload_config()
    return _validate_conf_text(text)


# ── Syslog settings ───────────────────────────────────────────────────────────

@router.get("/syslog", response_model=SyslogConfig)
async def get_syslog(
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    return await _load_syslog(db)


@router.put("/syslog", response_model=SyslogConfig)
async def put_syslog(
    body: SyslogConfig,
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    await _upsert(db, "syslog_enabled", str(body.enabled).lower())
    await _upsert(db, "syslog_host", body.host)
    await _upsert(db, "syslog_port", str(body.port))
    await _upsert(db, "syslog_protocol", body.protocol)
    await _upsert(db, "syslog_facility", body.facility)
    await db.commit()

    # Apply immediately to siem module's cached config
    siem_module.apply_syslog_config(body.model_dump())

    return body


# ── SIEM settings ─────────────────────────────────────────────────────────────

@router.get("/siem", response_model=SIEMConfig)
async def get_siem(
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    return await _load_siem(db)


@router.put("/siem", response_model=SIEMConfig)
async def put_siem(
    body: SIEMConfig,
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    await _upsert(db, "siem_enabled", str(body.enabled).lower())
    await _upsert(db, "siem_url", body.url)
    await _upsert(db, "siem_format", body.format)
    await _upsert(db, "siem_token", body.token)
    await _upsert(db, "siem_verify_ssl", str(body.verify_ssl).lower())
    await db.commit()

    siem_module.cache_siem_config(body.model_dump())
    return body


@router.post("/siem/test")
async def test_siem(
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    """Send a test event to the configured SIEM endpoint."""
    cfg = await _load_siem(db)
    if not cfg.enabled or not cfg.url:
        raise HTTPException(status_code=400, detail="SIEM not enabled or URL not set")
    try:
        await siem_module.send_siem_event(cfg.model_dump(), {
            "event_type": "test",
            "message": "VPN Dashboard SIEM test event",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return {"sent": True}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _upsert(db: AsyncSession, key: str, value: str | None) -> None:
    stmt = pg_insert(SystemSetting).values(key=key, value=value)
    stmt = stmt.on_conflict_do_update(index_elements=["key"], set_={"value": value})
    await db.execute(stmt)


async def _load_syslog(db: AsyncSession) -> SyslogConfig:
    keys = ["syslog_enabled", "syslog_host", "syslog_port", "syslog_protocol", "syslog_facility"]
    result = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(keys)))
    s = {r.key: r.value for r in result.scalars().all()}
    return SyslogConfig(
        enabled=s.get("syslog_enabled", "false").lower() == "true",
        host=s.get("syslog_host", "127.0.0.1"),
        port=int(s.get("syslog_port") or 514),
        protocol=s.get("syslog_protocol", "udp"),
        facility=s.get("syslog_facility", "local0"),
    )


async def _load_siem(db: AsyncSession) -> SIEMConfig:
    keys = ["siem_enabled", "siem_url", "siem_format", "siem_token", "siem_verify_ssl"]
    result = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(keys)))
    s = {r.key: r.value for r in result.scalars().all()}
    return SIEMConfig(
        enabled=s.get("siem_enabled", "false").lower() == "true",
        url=s.get("siem_url", ""),
        format=s.get("siem_format", "json"),
        token=s.get("siem_token", ""),
        verify_ssl=s.get("siem_verify_ssl", "true").lower() == "true",
    )


def _list_backups_sync() -> list[BackupInfo]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(BACKUP_DIR.glob("*.conf"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [
        BackupInfo(
            filename=p.name,
            size_bytes=p.stat().st_size,
            created_at=datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).isoformat(),
        )
        for p in files
    ]


async def _save_backup(text: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"{ts}_ocserv.conf"
    backup_path = BACKUP_DIR / filename
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: (BACKUP_DIR.mkdir(parents=True, exist_ok=True), backup_path.write_text(text)))
    return filename


_REQUIRED_DIRECTIVES = {"auth", "server-cert", "server-key", "ipv4-network", "ipv4-netmask"}
_FILE_DIRECTIVES = {"server-cert", "server-key", "ca-cert"}


def _validate_conf_text(text: str) -> ConfigValidationResult:
    errors: list[str] = []
    warnings: list[str] = []
    found: set[str] = set()

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, val = stripped.partition("=")
        key = key.strip().lower()
        val = val.strip()
        found.add(key)
        if key in _FILE_DIRECTIVES and not Path(val).exists():
            errors.append(f"File not found: {val!r} (directive: {key})")

    for req in _REQUIRED_DIRECTIVES:
        if req not in found:
            errors.append(f"Required directive missing: {req}")

    return ConfigValidationResult(valid=not errors, errors=errors, warnings=warnings)


# ── SMTP settings ─────────────────────────────────────────────────────────────

_SMTP_KEYS = [
    "smtp_enabled", "smtp_host", "smtp_port", "smtp_username", "smtp_password",
    "smtp_from_email", "smtp_from_name", "smtp_use_tls", "smtp_use_ssl",
]


async def _load_smtp(db: AsyncSession) -> SmtpConfig:
    result = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(_SMTP_KEYS)))
    s = {r.key: r.value for r in result.scalars().all()}
    return SmtpConfig(
        enabled=s.get("smtp_enabled", "false").lower() == "true",
        host=s.get("smtp_host", ""),
        port=int(s.get("smtp_port") or 587),
        username=s.get("smtp_username", ""),
        password=s.get("smtp_password", ""),
        from_email=s.get("smtp_from_email", ""),
        from_name=s.get("smtp_from_name", "VPN Dashboard"),
        use_tls=s.get("smtp_use_tls", "true").lower() == "true",
        use_ssl=s.get("smtp_use_ssl", "false").lower() == "true",
    )


@router.get("/smtp", response_model=SmtpConfig)
async def get_smtp(
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    return await _load_smtp(db)


@router.put("/smtp", response_model=SmtpConfig)
async def put_smtp(
    body: SmtpConfig,
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    await _upsert(db, "smtp_enabled",    str(body.enabled).lower())
    await _upsert(db, "smtp_host",       body.host)
    await _upsert(db, "smtp_port",       str(body.port))
    await _upsert(db, "smtp_username",   body.username)
    await _upsert(db, "smtp_password",   body.password)
    await _upsert(db, "smtp_from_email", body.from_email)
    await _upsert(db, "smtp_from_name",  body.from_name)
    await _upsert(db, "smtp_use_tls",    str(body.use_tls).lower())
    await _upsert(db, "smtp_use_ssl",    str(body.use_ssl).lower())
    await db.commit()
    mailer.cache_smtp_config(body.model_dump())
    return body


@router.post("/smtp/test")
async def test_smtp(
    to: str,
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    """Send a test email to the given address using the saved SMTP config."""
    cfg = await _load_smtp(db)
    if not cfg.enabled or not cfg.host or not cfg.from_email:
        raise HTTPException(status_code=400, detail="SMTP not enabled or incomplete")
    try:
        await mailer.send_test_email(to_email=to, cfg=cfg.model_dump())
        return {"sent": True, "to": to}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
