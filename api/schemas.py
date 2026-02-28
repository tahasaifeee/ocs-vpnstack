from datetime import datetime
from pydantic import BaseModel, Field


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str
    totp_code: str | None = None

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class RefreshRequest(BaseModel):
    refresh_token: str

class AdminUpdateRequest(BaseModel):
    current_password: str
    new_password: str | None = Field(None, min_length=8)
    new_username: str | None = Field(None, min_length=1, max_length=64)

class TotpSetupResponse(BaseModel):
    totp_secret: str
    totp_uri: str
    qr_data_url: str

class TotpEnableRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=6)

class TotpDisableRequest(BaseModel):
    password: str


# ── Groups ────────────────────────────────────────────────────────────────────

class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9._\-]+$")
    description: str | None = None
    max_sessions: int | None = Field(None, ge=1)
    quota_bytes: int | None = None
    dns_servers: str | None = None
    split_tunnel: bool = False
    session_timeout: int | None = Field(None, ge=60)

class GroupUpdate(BaseModel):
    description: str | None = None
    max_sessions: int | None = Field(None, ge=1)
    quota_bytes: int | None = None
    dns_servers: str | None = None
    split_tunnel: bool | None = None
    session_timeout: int | None = Field(None, ge=60)

class GroupOut(BaseModel):
    id: int
    name: str
    description: str | None
    max_sessions: int | None
    quota_bytes: int | None
    dns_servers: str | None
    split_tunnel: bool
    session_timeout: int | None
    user_count: int = 0

    model_config = {"from_attributes": True}


# ── VPN Users ─────────────────────────────────────────────────────────────────

class VpnUserCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9._\-]+$")
    password: str = Field(..., min_length=6)
    email: str | None = None
    otp_enabled: bool = False
    quota_bytes: int | None = None
    notes: str | None = None
    group_id: int | None = None
    static_ip: str | None = Field(None, pattern=r"^\d{1,3}(\.\d{1,3}){3}$")
    max_sessions: int | None = Field(None, ge=1)
    dns_servers: str | None = None

class VpnUserUpdate(BaseModel):
    password: str | None = None
    email: str | None = None
    is_active: bool | None = None
    otp_enabled: bool | None = None
    quota_bytes: int | None = None
    notes: str | None = None
    group_id: int | None = None
    static_ip: str | None = Field(None, pattern=r"^\d{1,3}(\.\d{1,3}){3}$")
    max_sessions: int | None = None
    dns_servers: str | None = None

class VpnUserOut(BaseModel):
    id: int
    username: str
    email: str | None
    is_active: bool
    otp_enabled: bool
    quota_bytes: int | None
    notes: str | None
    created_at: datetime
    group_id: int | None = None
    static_ip: str | None = None
    max_sessions: int | None = None
    dns_servers: str | None = None

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
    geo_country: str | None = None
    geo_country_code: str | None = None
    geo_city: str | None = None

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


# ── Network config ────────────────────────────────────────────────────────────

class NetworkConfig(BaseModel):
    ipv4_network: str = "172.16.0.0/16"
    ipv4_netmask: str = "255.255.0.0"
    dns_servers: list[str] = ["8.8.8.8", "1.1.1.1"]
    max_clients: int = 128
    max_same_clients: int = 2
    ipv6_network: str | None = None
    tunnel_all_dns: bool = True


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


# ── Logs ──────────────────────────────────────────────────────────────────────

class AuthLogOut(BaseModel):
    id: int
    username: str
    ip_address: str | None
    success: bool
    failure_reason: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditLogOut(BaseModel):
    id: int
    admin_username: str
    action: str
    target: str | None
    detail: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Reports ───────────────────────────────────────────────────────────────────

class DailyStatOut(BaseModel):
    date: str
    total_sessions: int
    total_bytes_in: int
    total_bytes_out: int
    unique_users: int


class MonthlyStatOut(BaseModel):
    month: str
    total_sessions: int
    total_bytes_in: int
    total_bytes_out: int
    unique_users: int


class HourlyStatOut(BaseModel):
    hour: int
    session_count: int


class TopUserOut(BaseModel):
    username: str
    total_bytes: int
    total_sessions: int


class LoginFailureStatOut(BaseModel):
    username: str
    failure_count: int
    last_attempt: datetime | None


# ── Service ───────────────────────────────────────────────────────────────────

class ServiceStatusOut(BaseModel):
    ocserv_running: bool
    active_connections: int
    version: str | None
    uptime: str | None


class ConfigValidationResult(BaseModel):
    valid: bool
    errors: list[str]
    warnings: list[str]


class BackupInfo(BaseModel):
    filename: str
    size_bytes: int
    created_at: str


class SyslogConfig(BaseModel):
    enabled: bool = False
    host: str = "127.0.0.1"
    port: int = 514
    protocol: str = "udp"   # "udp" | "tcp"
    facility: str = "local0"


class SIEMConfig(BaseModel):
    enabled: bool = False
    url: str = ""
    format: str = "json"    # "json" | "gelf" | "splunk-hec"
    token: str = ""
    verify_ssl: bool = True


class SmtpConfig(BaseModel):
    enabled: bool = False
    host: str = ""
    port: int = 587
    username: str = ""
    password: str = ""
    from_email: str = ""
    from_name: str = "VPN Dashboard"
    use_tls: bool = True      # STARTTLS on port 587
    use_ssl: bool = False     # Implicit SSL on port 465


class VpnClientSettings(BaseModel):
    server_address: str = ""   # hostname/IP users connect to (e.g. vpn.example.com)
    client_url: str = ""       # download URL for the VPN client app


class SendCredentialsRequest(BaseModel):
    to_email: str
    password: str              # plaintext password to include in the email
    server_host: str = ""
    client_url: str = ""
