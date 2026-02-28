from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from config import settings
from database import engine, Base, AsyncSessionLocal
from models import AdminUser, AuthLog, Group, SystemSetting  # ensure all tables are registered
from auth import hash_password
import redis_client
import siem
import mailer

from routers.auth_router import router as auth_router
from routers.users import router as users_router
from routers.routes_router import router as routes_router
from routers.sessions import router as sessions_router
from routers.stats import router as stats_router
from routers.internal import router as internal_router
from routers.groups import router as groups_router
from routers.network import router as network_router
from routers.logs import router as logs_router
from routers.reports import router as reports_router
from routers.service import router as service_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Redis
    await redis_client.init_redis(settings.redis_url)

    # DB: create tables + idempotent column migrations
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        migrations = [
            "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64)",
            "ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS otp_enabled BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS otp_secret VARCHAR(64)",
            "ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL",
            "ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS static_ip VARCHAR(15)",
            "ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS max_sessions INTEGER",
            "ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS dns_servers VARCHAR(256)",
        ]
        for sql in migrations:
            await conn.execute(text(sql))

    # Ensure backup directory exists
    Path("/etc/ocserv/backups").mkdir(parents=True, exist_ok=True)

    # Seed default admin + load runtime settings
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(AdminUser))
        if not result.scalars().first():
            db.add(AdminUser(username="admin", hashed_password=hash_password("admin")))
            await db.commit()
            print("Created default admin (user: admin / pass: admin) — change this immediately!")

        # Load syslog config from DB and apply
        syslog_keys = ["syslog_enabled", "syslog_host", "syslog_port", "syslog_protocol", "syslog_facility"]
        res = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(syslog_keys)))
        s = {r.key: r.value for r in res.scalars().all()}
        siem.apply_syslog_config({
            "enabled": s.get("syslog_enabled", "false").lower() == "true",
            "host": s.get("syslog_host", "127.0.0.1"),
            "port": int(s.get("syslog_port") or 514),
            "protocol": s.get("syslog_protocol", "udp"),
            "facility": s.get("syslog_facility", "local0"),
        })

        # Load SIEM config from DB and cache
        siem_keys = ["siem_enabled", "siem_url", "siem_format", "siem_token", "siem_verify_ssl"]
        res2 = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(siem_keys)))
        s2 = {r.key: r.value for r in res2.scalars().all()}
        siem.cache_siem_config({
            "enabled": s2.get("siem_enabled", "false").lower() == "true",
            "url": s2.get("siem_url", ""),
            "format": s2.get("siem_format", "json"),
            "token": s2.get("siem_token", ""),
            "verify_ssl": s2.get("siem_verify_ssl", "true").lower() == "true",
        })

        # Load SMTP config from DB and cache
        smtp_keys = [
            "smtp_enabled", "smtp_host", "smtp_port", "smtp_username", "smtp_password",
            "smtp_from_email", "smtp_from_name", "smtp_use_tls", "smtp_use_ssl",
        ]
        res3 = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(smtp_keys)))
        s3 = {r.key: r.value for r in res3.scalars().all()}
        mailer.cache_smtp_config({
            "enabled": s3.get("smtp_enabled", "false").lower() == "true",
            "host": s3.get("smtp_host", ""),
            "port": int(s3.get("smtp_port") or 587),
            "username": s3.get("smtp_username", ""),
            "password": s3.get("smtp_password", ""),
            "from_email": s3.get("smtp_from_email", ""),
            "from_name": s3.get("smtp_from_name", "VPN Dashboard"),
            "use_tls": s3.get("smtp_use_tls", "true").lower() == "true",
            "use_ssl": s3.get("smtp_use_ssl", "false").lower() == "true",
        })

    yield

    await redis_client.close_redis()


app = FastAPI(title="VPN Dashboard API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(routes_router)
app.include_router(sessions_router)
app.include_router(stats_router)
app.include_router(internal_router)
app.include_router(groups_router)
app.include_router(network_router)
app.include_router(logs_router)
app.include_router(reports_router)
app.include_router(service_router)


@app.get("/healthz")
async def health():
    return {"status": "ok"}
