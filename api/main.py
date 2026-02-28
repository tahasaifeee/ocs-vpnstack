from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import select, text

from database import engine, Base
from models import AdminUser  # ensure tables are registered
from auth import hash_password
from database import AsyncSessionLocal

from routers.auth_router import router as auth_router
from routers.users import router as users_router
from routers.routes_router import router as routes_router
from routers.sessions import router as sessions_router
from routers.stats import router as stats_router
from routers.internal import router as internal_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create all tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent column migrations for existing installs
        await conn.execute(text(
            "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        await conn.execute(text(
            "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64)"
        ))
        # VPN-user OTP columns (added after initial schema)
        await conn.execute(text(
            "ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS otp_enabled BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        await conn.execute(text(
            "ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS otp_secret VARCHAR(64)"
        ))

    # Seed default admin if none exists
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(AdminUser))
        if not result.scalars().first():
            admin = AdminUser(
                username="admin",
                hashed_password=hash_password("admin"),
            )
            db.add(admin)
            await db.commit()
            print("Created default admin (user: admin / pass: admin) — change this immediately!")

    yield


app = FastAPI(
    title="VPN Dashboard API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restrict in production via ALLOWED_ORIGINS env var
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


@app.get("/healthz")
async def health():
    return {"status": "ok"}
