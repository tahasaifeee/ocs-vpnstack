import base64
import io

import pyotp
import qrcode
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from auth import get_current_admin
from database import get_db
from models import AdminUser, Group, VpnUser, AuditLog
from schemas import VpnUserCreate, VpnUserOut, VpnUserUpdate, VpnUserWithOtp, SendCredentialsRequest
import occtl as oc
import mailer

router = APIRouter(prefix="/users", tags=["users"])


async def _get_user_or_404(username: str, db: AsyncSession) -> VpnUser:
    result = await db.execute(select(VpnUser).where(VpnUser.username == username))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def _audit(db: AsyncSession, admin: AdminUser, action: str, target: str, detail: str | None = None):
    db.add(AuditLog(admin_username=admin.username, action=action, target=target, detail=detail))
    await db.commit()


def _effective(user: VpnUser, group: Group | None) -> tuple[str | None, int | None, str | None, int | None]:
    """Return (dns_servers, max_sessions, static_ip, session_timeout) merged with group defaults."""
    dns = user.dns_servers or (group.dns_servers if group else None)
    max_s = user.max_sessions or (group.max_sessions if group else None)
    timeout = group.session_timeout if group else None
    return dns, max_s, user.static_ip, timeout


@router.get("", response_model=list[VpnUserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    result = await db.execute(select(VpnUser).order_by(VpnUser.username))
    return result.scalars().all()


@router.post("", response_model=VpnUserWithOtp, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: VpnUserCreate,
    db: AsyncSession = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
):
    existing = await db.execute(select(VpnUser).where(VpnUser.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already exists")

    if body.group_id is not None:
        grp = await db.execute(select(Group).where(Group.id == body.group_id))
        if not grp.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Group not found")

    await oc.ocpasswd_create(body.username, body.password)

    otp_secret = otp_uri = None
    if body.otp_enabled:
        otp_secret = pyotp.random_base32()
        secret_hex = base64.b32decode(otp_secret).hex()
        await oc.oath_add(body.username, secret_hex)
        otp_uri = pyotp.totp.TOTP(otp_secret).provisioning_uri(
            name=body.username, issuer_name="VPN Dashboard"
        )

    user = VpnUser(
        username=body.username,
        email=body.email,
        is_active=True,
        otp_enabled=body.otp_enabled,
        otp_secret=otp_secret,
        quota_bytes=body.quota_bytes,
        notes=body.notes,
        group_id=body.group_id,
        static_ip=body.static_ip,
        max_sessions=body.max_sessions,
        dns_servers=body.dns_servers,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Write per-user config (static IP / session limits / DNS)
    group = None
    if user.group_id:
        g = await db.execute(select(Group).where(Group.id == user.group_id))
        group = g.scalar_one_or_none()
    dns, max_s, sip, timeout = _effective(user, group)
    if sip or max_s or dns or timeout:
        await oc.write_user_config(body.username, [], sip, max_s, dns, timeout)

    await _audit(db, admin, "create_user", body.username)
    return VpnUserWithOtp.model_validate(user).model_copy(
        update={"otp_secret": otp_secret, "otp_uri": otp_uri}
    )


@router.get("/{username}", response_model=VpnUserOut)
async def get_user(
    username: str,
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    return await _get_user_or_404(username, db)


@router.patch("/{username}", response_model=VpnUserOut)
async def update_user(
    username: str,
    body: VpnUserUpdate,
    db: AsyncSession = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
):
    result = await db.execute(
        select(VpnUser)
        .where(VpnUser.username == username)
        .options(selectinload(VpnUser.routes))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.password is not None:
        await oc.ocpasswd_create(username, body.password)

    if body.is_active is not None and body.is_active != user.is_active:
        user.is_active = body.is_active
        if body.is_active:
            await oc.ocpasswd_unlock(username)
        else:
            await oc.ocpasswd_lock(username)

    if body.otp_enabled is not None and body.otp_enabled != user.otp_enabled:
        if body.otp_enabled:
            otp_secret = pyotp.random_base32()
            secret_hex = base64.b32decode(otp_secret).hex()
            await oc.oath_add(username, secret_hex)
            user.otp_secret = otp_secret
            user.otp_enabled = True
        else:
            await oc.oath_remove(username)
            user.otp_secret = None
            user.otp_enabled = False

    if "email" in body.model_fields_set:
        user.email = body.email
    if "quota_bytes" in body.model_fields_set:
        user.quota_bytes = body.quota_bytes
    if "notes" in body.model_fields_set:
        user.notes = body.notes
    if body.group_id is not None:
        grp = await db.execute(select(Group).where(Group.id == body.group_id))
        if not grp.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Group not found")
        user.group_id = body.group_id
    elif "group_id" in body.model_fields_set and body.group_id is None:
        user.group_id = None
    if body.static_ip is not None:
        user.static_ip = body.static_ip
    elif "static_ip" in body.model_fields_set and body.static_ip is None:
        user.static_ip = None
    if body.max_sessions is not None:
        user.max_sessions = body.max_sessions
    elif "max_sessions" in body.model_fields_set and body.max_sessions is None:
        user.max_sessions = None
    if body.dns_servers is not None:
        user.dns_servers = body.dns_servers
    elif "dns_servers" in body.model_fields_set and body.dns_servers is None:
        user.dns_servers = None

    await db.commit()
    await db.refresh(user)

    # Rewrite per-user config with updated settings
    group = None
    if user.group_id:
        g = await db.execute(select(Group).where(Group.id == user.group_id))
        group = g.scalar_one_or_none()
    dns, max_s, sip, timeout = _effective(user, group)
    routes = [{"cidr": r.cidr, "is_excluded": r.is_excluded} for r in user.routes]
    await oc.write_user_config(username, routes, sip, max_s, dns, timeout)

    await _audit(db, admin, "update_user", username)
    return user


@router.delete("/{username}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    username: str,
    db: AsyncSession = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
):
    user = await _get_user_or_404(username, db)
    await oc.ocpasswd_delete(username)
    await oc.oath_remove(username)
    await oc.delete_user_routes(username)
    await db.delete(user)
    await db.commit()
    await _audit(db, admin, "delete_user", username)


@router.post("/{username}/disconnect", status_code=status.HTTP_204_NO_CONTENT)
async def kick_user(
    username: str,
    db: AsyncSession = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
):
    await _get_user_or_404(username, db)
    await oc.disconnect_user(username)
    await _audit(db, admin, "disconnect_user", username)


@router.get("/{username}/otp-qr")
async def otp_qr(
    username: str,
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    user = await _get_user_or_404(username, db)
    if not user.otp_enabled or not user.otp_secret:
        raise HTTPException(status_code=400, detail="OTP not enabled for this user")
    uri = pyotp.totp.TOTP(user.otp_secret).provisioning_uri(
        name=username, issuer_name="VPN Dashboard"
    )
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return {"qr_data_url": f"data:image/png;base64,{b64}", "otp_uri": uri}


@router.post("/{username}/send-credentials")
async def send_credentials(
    username: str,
    body: SendCredentialsRequest,
    db: AsyncSession = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
):
    """Email VPN credentials to the given address."""
    if not mailer._smtp_cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="SMTP is not configured. Set it up in Service → SMTP.")
    try:
        await mailer.send_vpn_credentials(
            to_email=body.to_email,
            username=username,
            password=body.password,
            server_host=body.server_host,
            client_url=body.client_url,
        )
        await _audit(db, admin, "send_credentials", username)
        return {"sent": True}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
