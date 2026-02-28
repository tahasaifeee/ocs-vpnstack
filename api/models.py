from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, BigInteger, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class AdminUser(Base):
    """Dashboard admin accounts (not VPN users)."""
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(128))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
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
    quota_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # None = unlimited
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

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
    cidr: Mapped[str] = mapped_column(String(43))  # e.g. "10.10.0.0/24"
    is_excluded: Mapped[bool] = mapped_column(Boolean, default=False)  # True = no-route

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
