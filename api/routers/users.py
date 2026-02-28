import base64
import io

import pyotp
import qrcode
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_admin
from database import get_db
from models import AdminUser, VpnUser, AuditLog
from schemas import VpnUserCreate, VpnUserOut, VpnUserUpdate, VpnUserWithOtp
import occtl as oc

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

    # Write to ocpasswd
    await oc.ocpasswd_create(body.username, body.password)

    otp_secret = None
    otp_uri = None
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
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
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
    user = await _get_user_or_404(username, db)

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

    if body.email is not None:
        user.email = body.email
    if body.quota_bytes is not None:
        user.quota_bytes = body.quota_bytes
    if body.notes is not None:
        user.notes = body.notes

    await db.commit()
    await db.refresh(user)
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
