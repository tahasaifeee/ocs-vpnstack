from fastapi import APIRouter, Depends
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_admin
from database import get_db
from models import AdminUser, VpnUser, UserRoute
from schemas import RouteOut, RoutesUpdate
import occtl as oc
from routers.users import _get_user_or_404

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

    # Replace all existing routes
    await db.execute(delete(UserRoute).where(UserRoute.user_id == user.id))

    new_routes = []
    for r in body.routes:
        route = UserRoute(user_id=user.id, cidr=r.cidr, is_excluded=r.is_excluded)
        db.add(route)
        new_routes.append(route)

    await db.commit()
    for r in new_routes:
        await db.refresh(r)

    # Write to ocserv config file and reload
    route_dicts = [{"cidr": r.cidr, "is_excluded": r.is_excluded} for r in new_routes]
    await oc.write_user_routes(username, route_dicts)

    return new_routes
