"""
Logs API — paginated auth, session, and audit log endpoints with CSV/JSON export.
"""
import csv
import io
import json
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_admin
from database import get_db
from models import AdminUser, AuditLog, AuthLog, SessionLog, VpnUser
from schemas import AuditLogOut, AuthLogOut, SessionLogOut

router = APIRouter(prefix="/logs", tags=["logs"])


# ── Auth logs ─────────────────────────────────────────────────────────────────

@router.get("/auth", response_model=list[AuthLogOut])
async def auth_logs(
    username: str | None = Query(None),
    success: bool | None = Query(None),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    limit: int = Query(200, le=5000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    stmt = select(AuthLog)
    if username:
        stmt = stmt.where(AuthLog.username == username)
    if success is not None:
        stmt = stmt.where(AuthLog.success == success)
    if start:
        stmt = stmt.where(AuthLog.created_at >= start)
    if end:
        stmt = stmt.where(AuthLog.created_at <= end)
    stmt = stmt.order_by(AuthLog.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/auth/export")
async def export_auth_logs(
    fmt: Literal["csv", "json"] = Query("csv", alias="format"),
    username: str | None = Query(None),
    success: bool | None = Query(None),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    limit: int = Query(5000, le=50000),
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    stmt = select(AuthLog)
    if username:
        stmt = stmt.where(AuthLog.username == username)
    if success is not None:
        stmt = stmt.where(AuthLog.success == success)
    if start:
        stmt = stmt.where(AuthLog.created_at >= start)
    if end:
        stmt = stmt.where(AuthLog.created_at <= end)
    stmt = stmt.order_by(AuthLog.created_at.desc()).limit(limit)
    result = await db.execute(stmt)
    rows = result.scalars().all()

    fields = ["id", "username", "ip_address", "success", "failure_reason", "created_at"]
    return _export(rows, fields, fmt, "auth-logs")


# ── Session logs ──────────────────────────────────────────────────────────────

class _SessionWithUser:
    def __init__(self, log: SessionLog, username: str):
        self._log = log
        self.username = username

    def __getattr__(self, name: str):
        return getattr(self._log, name)


@router.get("/sessions")
async def session_logs(
    username: str | None = Query(None),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    limit: int = Query(200, le=5000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    stmt = (
        select(SessionLog, VpnUser.username)
        .join(VpnUser, VpnUser.id == SessionLog.user_id)
    )
    if username:
        stmt = stmt.where(VpnUser.username == username)
    if start:
        stmt = stmt.where(SessionLog.connected_at >= start)
    if end:
        stmt = stmt.where(SessionLog.connected_at <= end)
    stmt = stmt.order_by(SessionLog.connected_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    rows = result.all()
    return [
        {
            **SessionLogOut.model_validate(log).model_dump(),
            "username": uname,
        }
        for log, uname in rows
    ]


@router.get("/sessions/export")
async def export_session_logs(
    fmt: Literal["csv", "json"] = Query("csv", alias="format"),
    username: str | None = Query(None),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    limit: int = Query(5000, le=50000),
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    stmt = (
        select(SessionLog, VpnUser.username)
        .join(VpnUser, VpnUser.id == SessionLog.user_id)
    )
    if username:
        stmt = stmt.where(VpnUser.username == username)
    if start:
        stmt = stmt.where(SessionLog.connected_at >= start)
    if end:
        stmt = stmt.where(SessionLog.connected_at <= end)
    stmt = stmt.order_by(SessionLog.connected_at.desc()).limit(limit)
    result = await db.execute(stmt)

    fields = [
        "id", "username", "ip_real", "ip_local", "device",
        "connected_at", "disconnected_at",
        "bytes_in", "bytes_out", "duration_seconds", "disconnect_reason",
    ]

    class _Row:
        pass

    plain_rows = []
    for log, uname in result.all():
        r = _Row()
        r.id = log.id
        r.username = uname
        r.ip_real = log.ip_real
        r.ip_local = log.ip_local
        r.device = log.device
        r.connected_at = log.connected_at
        r.disconnected_at = log.disconnected_at
        r.bytes_in = log.bytes_in
        r.bytes_out = log.bytes_out
        r.duration_seconds = log.duration_seconds
        r.disconnect_reason = log.disconnect_reason
        plain_rows.append(r)

    return _export(plain_rows, fields, fmt, "session-logs")


# ── Audit logs ────────────────────────────────────────────────────────────────

@router.get("/audit", response_model=list[AuditLogOut])
async def audit_logs(
    admin_username: str | None = Query(None),
    action: str | None = Query(None),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    limit: int = Query(200, le=5000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    stmt = select(AuditLog)
    if admin_username:
        stmt = stmt.where(AuditLog.admin_username == admin_username)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if start:
        stmt = stmt.where(AuditLog.created_at >= start)
    if end:
        stmt = stmt.where(AuditLog.created_at <= end)
    stmt = stmt.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/audit/export")
async def export_audit_logs(
    fmt: Literal["csv", "json"] = Query("csv", alias="format"),
    admin_username: str | None = Query(None),
    action: str | None = Query(None),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    limit: int = Query(5000, le=50000),
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    stmt = select(AuditLog)
    if admin_username:
        stmt = stmt.where(AuditLog.admin_username == admin_username)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if start:
        stmt = stmt.where(AuditLog.created_at >= start)
    if end:
        stmt = stmt.where(AuditLog.created_at <= end)
    stmt = stmt.order_by(AuditLog.created_at.desc()).limit(limit)
    result = await db.execute(stmt)
    rows = result.scalars().all()

    fields = ["id", "admin_username", "action", "target", "detail", "created_at"]
    return _export(rows, fields, fmt, "audit-logs")


# ── Export helper ─────────────────────────────────────────────────────────────

def _export(rows: list, fields: list[str], fmt: str, basename: str) -> StreamingResponse:
    if fmt == "json":
        data = [
            {f: str(getattr(r, f, "")) if not isinstance(getattr(r, f, None), (str, int, float, bool, type(None))) else getattr(r, f, None) for f in fields}
            for r in rows
        ]
        content = json.dumps(data, default=str, indent=2)
        return StreamingResponse(
            iter([content]),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={basename}.json"},
        )

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow({f: getattr(r, f, "") for f in fields})
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={basename}.csv"},
    )
