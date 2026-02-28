from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, BigInteger, Integer, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Group(Base):
    """VPN user group with shared policy settings."""
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(String(256), nullable=True)
    max_sessions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quota_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    dns_servers: Mapped[str | None] = mapped_column(String(256), nullable=True)  # comma-separated
    split_tunnel: Mapped[bool] = mapped_column(Boolean, default=False)
    session_timeout: Mapped[int | None] = mapped_column(Integer, nullable=True)  # seconds

    users: Mapped[list["VpnUser"]] = relationship("VpnUser", back_populates="group")


class AdminUser(Base):
    """Dashboard admin accounts (not VPN users)."""
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(128))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VpnUser(Base):
    """VPN user metadata (auth managed by ocserv)."""
    __tablename__ = "vpn_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    otp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    otp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    quota_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("groups.id", ondelete="SET NULL"), nullable=True
    )
    static_ip: Mapped[str | None] = mapped_column(String(15), nullable=True)
    max_sessions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dns_servers: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    group: Mapped["Group | None"] = relationship("Group", back_populates="users")
    sessions: Mapped[list["SessionLog"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    routes: Mapped[list["UserRoute"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class SessionLog(Base):
    """Historical connection log."""
    __tablename__ = "session_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("vpn_users.id", ondelete="CASCADE"), index=True)
    ip_real: Mapped[str | None] = mapped_column(String(45), nullable=True)
    ip_local: Mapped[str | None] = mapped_column(String(45), nullable=True)
    device: Mapped[str | None] = mapped_column(String(128), nullable=True)
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    disconnected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    bytes_in: Mapped[int] = mapped_column(BigInteger, default=0)
    bytes_out: Mapped[int] = mapped_column(BigInteger, default=0)
    duration_seconds: Mapped[int] = mapped_column(BigInteger, default=0)
    disconnect_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)

    user: Mapped["VpnUser"] = relationship(back_populates="sessions")


class UserRoute(Base):
    """Per-user route assignments."""
    __tablename__ = "user_routes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("vpn_users.id", ondelete="CASCADE"), index=True)
    cidr: Mapped[str] = mapped_column(String(43))
    is_excluded: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped["VpnUser"] = relationship(back_populates="routes")


class AuditLog(Base):
    """Admin action audit trail."""
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    admin_username: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64))
    target: Mapped[str | None] = mapped_column(String(128), nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuthLog(Base):
    """Authentication attempt log (success and failure)."""
    __tablename__ = "auth_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), index=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    success: Mapped[bool] = mapped_column(Boolean)
    failure_reason: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class SystemSetting(Base):
    """Persistent key-value store for runtime configuration (syslog, SIEM, etc.)."""
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
