from datetime import datetime
from pydantic import BaseModel, Field


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class RefreshRequest(BaseModel):
    refresh_token: str

class AdminUpdateRequest(BaseModel):
    """Used by PATCH /auth/me to change the dashboard admin's own credentials."""
    current_password: str
    new_password: str | None = Field(None, min_length=8)
    new_username: str | None = Field(None, min_length=1, max_length=64)


# ── VPN Users ─────────────────────────────────────────────────────────────────

class VpnUserCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9._\-]+$")
    password: str = Field(..., min_length=6)
    email: str | None = None
    otp_enabled: bool = False
    quota_bytes: int | None = None
    notes: str | None = None

class VpnUserUpdate(BaseModel):
    password: str | None = None
    email: str | None = None
    is_active: bool | None = None
    otp_enabled: bool | None = None
    quota_bytes: int | None = None
    notes: str | None = None

class VpnUserOut(BaseModel):
    id: int
    username: str
    email: str | None
    is_active: bool
    otp_enabled: bool
    quota_bytes: int | None
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}

class VpnUserWithOtp(VpnUserOut):
    otp_secret: str | None = None
    otp_uri: str | None = None


# ── Routes ────────────────────────────────────────────────────────────────────

class RouteIn(BaseModel):
    cidr: str = Field(..., pattern=r"^\d{1,3}(\.\d{1,3}){3}/\d{1,2}$")
    is_excluded: bool = False

class RouteOut(BaseModel):
    id: int
    cidr: str
    is_excluded: bool

    model_config = {"from_attributes": True}

class RoutesUpdate(BaseModel):
    routes: list[RouteIn]


# ── Sessions ──────────────────────────────────────────────────────────────────

class ActiveSession(BaseModel):
    username: str
    ip_real: str
    ip_local: str
    device: str
    connected_since: str
    rx_bytes: int
    tx_bytes: int

class SessionLogOut(BaseModel):
    id: int
    ip_real: str | None
    ip_local: str | None
    device: str | None
    connected_at: datetime
    disconnected_at: datetime | None
    bytes_in: int
    bytes_out: int
    duration_seconds: int
    disconnect_reason: str | None

    model_config = {"from_attributes": True}


# ── Stats ─────────────────────────────────────────────────────────────────────

class UserStatsOut(BaseModel):
    username: str
    total_bytes_in: int
    total_bytes_out: int
    total_sessions: int
    last_seen: datetime | None


# ── Internal events ───────────────────────────────────────────────────────────

class ConnectEvent(BaseModel):
    username: str
    ip_real: str
    ip_local: str
    device: str | None = None

class DisconnectEvent(BaseModel):
    username: str
    ip_real: str | None = None
    ip_local: str | None = None
    bytes_in: int = 0
    bytes_out: int = 0
    duration: int = 0
    reason: str | None = None
