import base64
import io

import pyotp
import qrcode
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_admin,
    hash_password,
    verify_password,
)
from database import get_db
from models import AdminUser, AuthLog
from schemas import (
    AdminUpdateRequest,
    LoginRequest,
    RefreshRequest,
    TokenResponse,
    TotpDisableRequest,
    TotpEnableRequest,
    TotpSetupResponse,
)
import siem

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Login ──────────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    ip = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or (
        request.client.host if request.client else None
    )

    result = await db.execute(select(AdminUser).where(AdminUser.username == body.username))
    admin = result.scalar_one_or_none()

    if not admin or not verify_password(body.password, admin.hashed_password):
        db.add(AuthLog(username=body.username, ip_address=ip, success=False, failure_reason="bad_credentials"))
        await db.commit()
        siem.log_auth_event(body.username, ip, success=False, reason="bad_credentials")
        await siem.emit_auth_siem(body.username, ip, success=False, reason="bad_credentials")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad credentials")

    if not admin.is_active:
        db.add(AuthLog(username=body.username, ip_address=ip, success=False, failure_reason="account_disabled"))
        await db.commit()
        siem.log_auth_event(body.username, ip, success=False, reason="account_disabled")
        await siem.emit_auth_siem(body.username, ip, success=False, reason="account_disabled")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    # 2FA gate: if enabled, require a TOTP code
    if admin.totp_enabled:
        if not body.totp_code:
            # Signal the frontend to ask for the TOTP code (credentials were correct)
            return JSONResponse(status_code=200, content={"requires_totp": True})
        if not admin.totp_secret or \
                not pyotp.TOTP(admin.totp_secret).verify(body.totp_code, valid_window=1):
            db.add(AuthLog(username=body.username, ip_address=ip, success=False, failure_reason="bad_totp"))
            await db.commit()
            siem.log_auth_event(body.username, ip, success=False, reason="bad_totp")
            await siem.emit_auth_siem(body.username, ip, success=False, reason="bad_totp")
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid 2FA code")

    db.add(AuthLog(username=body.username, ip_address=ip, success=True))
    await db.commit()
    siem.log_auth_event(body.username, ip, success=True)
    await siem.emit_auth_siem(body.username, ip, success=True)

    return TokenResponse(
        access_token=create_access_token(admin.username),
        refresh_token=create_refresh_token(admin.username),
    )


# ── Token refresh ──────────────────────────────────────────────────────────────

@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    username = decode_token(body.refresh_token, expected_type="refresh")
    result = await db.execute(select(AdminUser).where(AdminUser.username == username))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    return TokenResponse(
        access_token=create_access_token(admin.username),
        refresh_token=create_refresh_token(admin.username),
    )


# ── Current admin profile ──────────────────────────────────────────────────────

@router.get("/me")
async def me(admin: AdminUser = Depends(get_current_admin)):
    return {"username": admin.username, "id": admin.id, "totp_enabled": admin.totp_enabled}


@router.patch("/me")
async def update_me(
    body: AdminUpdateRequest,
    admin: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Change the currently-authenticated admin's username and/or password."""
    if not verify_password(body.current_password, admin.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    if body.new_username is not None and body.new_username != admin.username:
        taken = await db.execute(select(AdminUser).where(AdminUser.username == body.new_username))
        if taken.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
        admin.username = body.new_username

    if body.new_password is not None:
        admin.hashed_password = hash_password(body.new_password)

    await db.commit()
    return {"username": admin.username, "id": admin.id, "totp_enabled": admin.totp_enabled}


# ── TOTP / 2FA management ──────────────────────────────────────────────────────

@router.post("/totp/setup", response_model=TotpSetupResponse)
async def totp_setup(
    admin: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Generate a new TOTP secret and return the QR code. Does NOT enable 2FA yet."""
    secret = pyotp.random_base32()
    uri = pyotp.TOTP(secret).provisioning_uri(
        name=admin.username, issuer_name="VPN Dashboard"
    )
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    # Store the pending secret (totp_enabled stays False until /totp/enable)
    admin.totp_secret = secret
    await db.commit()

    return TotpSetupResponse(
        totp_secret=secret,
        totp_uri=uri,
        qr_data_url=f"data:image/png;base64,{qr_b64}",
    )


@router.post("/totp/enable")
async def totp_enable(
    body: TotpEnableRequest,
    admin: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Verify a TOTP code against the pending secret and activate 2FA."""
    if not admin.totp_secret:
        raise HTTPException(status_code=400, detail="Call /auth/totp/setup first")
    if not pyotp.TOTP(admin.totp_secret).verify(body.code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid code — check your authenticator app")
    admin.totp_enabled = True
    await db.commit()
    return {"totp_enabled": True}


@router.post("/totp/disable")
async def totp_disable(
    body: TotpDisableRequest,
    admin: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Disable 2FA after verifying the admin's password."""
    if not verify_password(body.password, admin.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect password")
    admin.totp_enabled = False
    admin.totp_secret = None
    await db.commit()
    return {"totp_enabled": False}
