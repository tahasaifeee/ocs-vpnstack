"""
Reporting & Analytics endpoints.
All queries are time-bounded and read-only against the session_logs and auth_logs tables.
"""
import csv
import io
import json
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_admin
from database import get_db
from models import AdminUser, AuthLog, SessionLog, VpnUser
from schemas import (
    DailyStatOut,
    HourlyStatOut,
    LoginFailureStatOut,
    MonthlyStatOut,
    TopUserOut,
)

router = APIRouter(prefix="/reports", tags=["reports"])


# ── Daily bandwidth ───────────────────────────────────────────────────────────

@router.get("/daily", response_model=list[DailyStatOut])
async def daily_stats(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    stmt = text("""
        SELECT
            date_trunc('day', connected_at AT TIME ZONE 'UTC')::date::text AS date,
            COUNT(*)                   AS total_sessions,
            COALESCE(SUM(bytes_in),0)  AS total_bytes_in,
            COALESCE(SUM(bytes_out),0) AS total_bytes_out,
            COUNT(DISTINCT user_id)    AS unique_users
        FROM session_logs
        WHERE connected_at >= NOW() - INTERVAL :interval
        GROUP BY 1
        ORDER BY 1
    """)
    result = await db.execute(stmt, {"interval": f"{days} days"})
    rows = result.fetchall()
    return [
        DailyStatOut(
            date=r.date,
            total_sessions=r.total_sessions,
            total_bytes_in=r.total_bytes_in,
            total_bytes_out=r.total_bytes_out,
            unique_users=r.unique_users,
        )
        for r in rows
    ]


# ── Monthly bandwidth ─────────────────────────────────────────────────────────

@router.get("/monthly", response_model=list[MonthlyStatOut])
async def monthly_stats(
    months: int = Query(12, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    stmt = text("""
        SELECT
            to_char(date_trunc('month', connected_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
            COUNT(*)                   AS total_sessions,
            COALESCE(SUM(bytes_in),0)  AS total_bytes_in,
            COALESCE(SUM(bytes_out),0) AS total_bytes_out,
            COUNT(DISTINCT user_id)    AS unique_users
        FROM session_logs
        WHERE connected_at >= NOW() - INTERVAL :interval
        GROUP BY 1
        ORDER BY 1
    """)
    result = await db.execute(stmt, {"interval": f"{months} months"})
    rows = result.fetchall()
    return [
        MonthlyStatOut(
            month=r.month,
            total_sessions=r.total_sessions,
            total_bytes_in=r.total_bytes_in,
            total_bytes_out=r.total_bytes_out,
            unique_users=r.unique_users,
        )
        for r in rows
    ]


# ── Top users by bandwidth ────────────────────────────────────────────────────

@router.get("/top-users", response_model=list[TopUserOut])
async def top_users(
    limit: int = Query(10, ge=1, le=100),
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    result = await db.execute(
        select(
            VpnUser.username,
            func.coalesce(func.sum(SessionLog.bytes_in + SessionLog.bytes_out), 0).label("total_bytes"),
            func.coalesce(func.count(SessionLog.id), 0).label("total_sessions"),
        )
        .join(SessionLog, SessionLog.user_id == VpnUser.id)
        .where(
            SessionLog.connected_at >= func.now() - text(f"interval '{days} days'")
        )
        .group_by(VpnUser.username)
        .order_by(func.coalesce(func.sum(SessionLog.bytes_in + SessionLog.bytes_out), 0).desc())
        .limit(limit)
    )
    rows = result.all()
    return [
        TopUserOut(
            username=r.username,
            total_bytes=r.total_bytes,
            total_sessions=r.total_sessions,
        )
        for r in rows
    ]


# ── Login failure statistics ──────────────────────────────────────────────────

@router.get("/login-failures", response_model=list[LoginFailureStatOut])
async def login_failures(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    result = await db.execute(
        select(
            AuthLog.username,
            func.count(AuthLog.id).label("failure_count"),
            func.max(AuthLog.created_at).label("last_attempt"),
        )
        .where(
            AuthLog.success == False,  # noqa: E712
            AuthLog.created_at >= func.now() - text(f"interval '{days} days'"),
        )
        .group_by(AuthLog.username)
        .order_by(func.count(AuthLog.id).desc())
        .limit(limit)
    )
    rows = result.all()
    return [
        LoginFailureStatOut(
            username=r.username,
            failure_count=r.failure_count,
            last_attempt=r.last_attempt,
        )
        for r in rows
    ]


# ── Peak hours ────────────────────────────────────────────────────────────────

@router.get("/peak-hours", response_model=list[HourlyStatOut])
async def peak_hours(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    stmt = text("""
        SELECT
            EXTRACT(HOUR FROM connected_at AT TIME ZONE 'UTC')::int AS hour,
            COUNT(*) AS session_count
        FROM session_logs
        WHERE connected_at >= NOW() - INTERVAL :interval
        GROUP BY 1
        ORDER BY 1
    """)
    result = await db.execute(stmt, {"interval": f"{days} days"})
    rows_map = {r.hour: r.session_count for r in result.fetchall()}
    # Return all 24 hours, filling zeros for hours with no data
    return [
        HourlyStatOut(hour=h, session_count=rows_map.get(h, 0))
        for h in range(24)
    ]


# ── Export ────────────────────────────────────────────────────────────────────

@router.get("/export")
async def export_report(
    report_type: Literal["daily", "monthly", "top-users", "login-failures", "peak-hours"] = Query(...),
    fmt: Literal["csv", "json"] = Query("csv", alias="format"),
    days: int = Query(30, ge=1, le=365),
    months: int = Query(12, ge=1, le=24),
    limit: int = Query(10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
):
    if report_type == "daily":
        rows = await daily_stats(days=days, db=db, _=admin)
        fields = ["date", "total_sessions", "total_bytes_in", "total_bytes_out", "unique_users"]
    elif report_type == "monthly":
        rows = await monthly_stats(months=months, db=db, _=admin)
        fields = ["month", "total_sessions", "total_bytes_in", "total_bytes_out", "unique_users"]
    elif report_type == "top-users":
        rows = await top_users(limit=limit, days=days, db=db, _=admin)
        fields = ["username", "total_bytes", "total_sessions"]
    elif report_type == "login-failures":
        rows = await login_failures(days=days, limit=limit, db=db, _=admin)
        fields = ["username", "failure_count", "last_attempt"]
    else:
        rows = await peak_hours(days=days, db=db, _=admin)
        fields = ["hour", "session_count"]

    basename = report_type
    if fmt == "json":
        data = [r.model_dump() for r in rows]
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
        writer.writerow(r.model_dump())
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={basename}.csv"},
    )
