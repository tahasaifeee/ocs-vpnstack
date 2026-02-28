from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_admin
from database import get_db
from models import AdminUser, SessionLog, VpnUser
from schemas import UserStatsOut

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/users", response_model=list[UserStatsOut])
async def all_user_stats(
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    result = await db.execute(
        select(
            VpnUser.username,
            func.coalesce(func.sum(SessionLog.bytes_in), 0).label("total_bytes_in"),
            func.coalesce(func.sum(SessionLog.bytes_out), 0).label("total_bytes_out"),
            func.count(SessionLog.id).label("total_sessions"),
            func.max(SessionLog.connected_at).label("last_seen"),
        )
        .outerjoin(SessionLog, SessionLog.user_id == VpnUser.id)
        .group_by(VpnUser.username)
        .order_by(VpnUser.username)
    )
    rows = result.all()
    return [
        UserStatsOut(
            username=r.username,
            total_bytes_in=r.total_bytes_in,
            total_bytes_out=r.total_bytes_out,
            total_sessions=r.total_sessions,
            last_seen=r.last_seen,
        )
        for r in rows
    ]


@router.get("/users/{username}", response_model=UserStatsOut)
async def user_stats(
    username: str,
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    result = await db.execute(
        select(
            VpnUser.username,
            func.coalesce(func.sum(SessionLog.bytes_in), 0).label("total_bytes_in"),
            func.coalesce(func.sum(SessionLog.bytes_out), 0).label("total_bytes_out"),
            func.count(SessionLog.id).label("total_sessions"),
            func.max(SessionLog.connected_at).label("last_seen"),
        )
        .outerjoin(SessionLog, SessionLog.user_id == VpnUser.id)
        .where(VpnUser.username == username)
        .group_by(VpnUser.username)
    )
    row = result.one_or_none()
    if not row:
        return UserStatsOut(username=username, total_bytes_in=0, total_bytes_out=0, total_sessions=0, last_seen=None)
    return UserStatsOut(
        username=row.username,
        total_bytes_in=row.total_bytes_in,
        total_bytes_out=row.total_bytes_out,
        total_sessions=row.total_sessions,
        last_seen=row.last_seen,
    )
