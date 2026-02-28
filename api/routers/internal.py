"""
Internal endpoints called by ocserv connect/disconnect shell hooks.
These are NOT authenticated with JWT — they're only reachable inside the
Docker network, so network isolation is the security boundary.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import VpnUser, SessionLog
from schemas import ConnectEvent, DisconnectEvent

router = APIRouter(prefix="/internal", tags=["internal"])


@router.post("/events/connect", status_code=204)
async def on_connect(event: ConnectEvent, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(VpnUser).where(VpnUser.username == event.username))
    user = result.scalar_one_or_none()
    if not user:
        return

    log = SessionLog(
        user_id=user.id,
        ip_real=event.ip_real,
        ip_local=event.ip_local,
        device=event.device,
        connected_at=datetime.now(timezone.utc),
    )
    db.add(log)
    await db.commit()


@router.post("/events/disconnect", status_code=204)
async def on_disconnect(event: DisconnectEvent, db: AsyncSession = Depends(get_db)):
    # Find the most recent open session for this user
    result = await db.execute(
        select(SessionLog)
        .join(VpnUser, VpnUser.id == SessionLog.user_id)
        .where(VpnUser.username == event.username, SessionLog.disconnected_at.is_(None))
        .order_by(SessionLog.connected_at.desc())
        .limit(1)
    )
    log = result.scalar_one_or_none()
    if not log:
        return

    log.disconnected_at = datetime.now(timezone.utc)
    log.bytes_in = event.bytes_in
    log.bytes_out = event.bytes_out
    log.duration_seconds = event.duration
    log.disconnect_reason = event.reason
    await db.commit()
