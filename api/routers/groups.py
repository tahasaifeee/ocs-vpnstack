import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from auth import get_current_admin
from database import get_db
from models import AdminUser, Group, VpnUser, UserRoute
from schemas import GroupCreate, GroupOut, GroupUpdate
import occtl as oc

router = APIRouter(prefix="/groups", tags=["groups"])


async def _get_group_or_404(gid: int, db: AsyncSession) -> Group:
    result = await db.execute(select(Group).where(Group.id == gid))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


async def _regen_group_configs(group: Group, db: AsyncSession) -> None:
    """Regenerate per-user ocserv configs for every member of the group."""
    result = await db.execute(
        select(VpnUser)
        .where(VpnUser.group_id == group.id)
        .options(selectinload(VpnUser.routes))
    )
    users = result.scalars().all()
    tasks = []
    for user in users:
        dns = user.dns_servers or group.dns_servers
        max_s = user.max_sessions or group.max_sessions
        timeout = group.session_timeout
        routes = [{"cidr": r.cidr, "is_excluded": r.is_excluded} for r in user.routes]
        tasks.append(
            oc.write_user_config(user.username, routes, user.static_ip, max_s, dns, timeout)
        )
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def _group_out(group: Group, db: AsyncSession) -> GroupOut:
    count_res = await db.execute(
        select(func.count(VpnUser.id)).where(VpnUser.group_id == group.id)
    )
    return GroupOut.model_validate(group).model_copy(update={"user_count": count_res.scalar_one()})


@router.get("", response_model=list[GroupOut])
async def list_groups(
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    rows = await db.execute(
        select(Group, func.count(VpnUser.id).label("cnt"))
        .outerjoin(VpnUser, VpnUser.group_id == Group.id)
        .group_by(Group.id)
        .order_by(Group.name)
    )
    return [
        GroupOut.model_validate(g).model_copy(update={"user_count": cnt})
        for g, cnt in rows.all()
    ]


@router.post("", response_model=GroupOut, status_code=status.HTTP_201_CREATED)
async def create_group(
    body: GroupCreate,
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    existing = await db.execute(select(Group).where(Group.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Group name already exists")
    group = Group(**body.model_dump())
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return GroupOut.model_validate(group)


@router.patch("/{group_id}", response_model=GroupOut)
async def update_group(
    group_id: int,
    body: GroupUpdate,
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    group = await _get_group_or_404(group_id, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    await db.commit()
    await db.refresh(group)
    await _regen_group_configs(group, db)
    return await _group_out(group, db)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: int,
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    group = await _get_group_or_404(group_id, db)
    # Collect members before nulling FK (SET NULL fires via DB cascade)
    res = await db.execute(
        select(VpnUser)
        .where(VpnUser.group_id == group.id)
        .options(selectinload(VpnUser.routes))
    )
    members = res.scalars().all()
    await db.delete(group)
    await db.commit()
    # Rewrite configs without group overrides
    tasks = [
        oc.write_user_config(
            u.username,
            [{"cidr": r.cidr, "is_excluded": r.is_excluded} for r in u.routes],
            u.static_ip, u.max_sessions, u.dns_servers,
        )
        for u in members
    ]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
