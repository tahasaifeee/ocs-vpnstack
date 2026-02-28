from fastapi import APIRouter, Depends
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_admin
from database import get_db
from models import AdminUser, Group, VpnUser, UserRoute
from schemas import RouteOut, RoutesUpdate
import occtl as oc
from routers.users import _get_user_or_404, _effective

router = APIRouter(prefix="/users/{username}/routes", tags=["routes"])


@router.get("", response_model=list[RouteOut])
async def list_routes(
    username: str,
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    user = await _get_user_or_404(username, db)
    result = await db.execute(select(UserRoute).where(UserRoute.user_id == user.id))
    return result.scalars().all()


@router.put("", response_model=list[RouteOut])
async def set_routes(
    username: str,
    body: RoutesUpdate,
    db: AsyncSession = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
):
    user = await _get_user_or_404(username, db)

    await db.execute(sa_delete(UserRoute).where(UserRoute.user_id == user.id))
    new_routes = [
        UserRoute(user_id=user.id, cidr=r.cidr, is_excluded=r.is_excluded)
        for r in body.routes
    ]
    for r in new_routes:
        db.add(r)
    await db.commit()
    for r in new_routes:
        await db.refresh(r)

    # Load group for effective settings
    group = None
    if user.group_id:
        g = await db.execute(select(Group).where(Group.id == user.group_id))
        group = g.scalar_one_or_none()
    dns, max_s, sip, timeout = _effective(user, group)
    route_dicts = [{"cidr": r.cidr, "is_excluded": r.is_excluded} for r in new_routes]
    await oc.write_user_config(username, route_dicts, sip, max_s, dns, timeout)

    return new_routes
