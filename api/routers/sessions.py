from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_admin
from database import get_db
from models import AdminUser, SessionLog, VpnUser
from schemas import ActiveSession, SessionLogOut
import occtl as oc
from routers.users import _get_user_or_404

router = APIRouter(tags=["sessions"])


@router.get("/sessions/active", response_model=list[ActiveSession])
async def active_sessions(_: AdminUser = Depends(get_current_admin)):
    """Live sessions from occtl — polled by the dashboard every ~30 s."""
    return await oc.get_active_sessions()


@router.get("/users/{username}/sessions", response_model=list[SessionLogOut])
async def user_session_history(
    username: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    user = await _get_user_or_404(username, db)
    result = await db.execute(
        select(SessionLog)
        .where(SessionLog.user_id == user.id)
        .order_by(SessionLog.connected_at.desc())
        .limit(limit)
    )
    return result.scalars().all()
