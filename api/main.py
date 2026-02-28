from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from config import settings
from database import engine, Base, AsyncSessionLocal
from models import AdminUser, Group  # ensure all tables are registered
from auth import hash_password
import redis_client

from routers.auth_router import router as auth_router
from routers.users import router as users_router
from routers.routes_router import router as routes_router
from routers.sessions import router as sessions_router
from routers.stats import router as stats_router
from routers.internal import router as internal_router
from routers.groups import router as groups_router
from routers.network import router as network_router


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

    # Seed default admin
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(AdminUser))
        if not result.scalars().first():
            db.add(AdminUser(username="admin", hashed_password=hash_password("admin")))
            await db.commit()
            print("Created default admin (user: admin / pass: admin) — change this immediately!")

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


@app.get("/healthz")
async def health():
    return {"status": "ok"}
