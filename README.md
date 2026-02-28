# ocs-vpnstack

A self-hosted OpenConnect VPN management stack built on **ocserv**, with a full web dashboard, OTP/TOTP support, per-user routing, and traffic statistics.

## Architecture

```
[Web Dashboard (React + Vite + TailwindCSS)]
                ↕ REST API (/api/*)
[Backend API — FastAPI]
                ↕ subprocess (ocpasswd / occtl)
[ocserv — OpenConnect VPN]
                ↕ TLS/DTLS
[VPN Clients]
```

## Services (Docker Compose)

| Service    | Image / Build  | Purpose                                     |
|------------|----------------|---------------------------------------------|
| `ocserv`   | ./ocserv       | OpenConnect VPN daemon                      |
| `api`      | ./api          | FastAPI — user CRUD, OTP, routes, stats     |
| `frontend` | ./frontend     | React SPA dashboard                         |
| `postgres` | postgres:16    | User metadata, session logs, audit trail    |
| `redis`    | redis:7        | Session cache, rate-limiting                |
| `nginx`    | nginx:alpine   | Reverse proxy + TLS termination             |

## Quick Start

### 1. Clone and configure

```bash
git clone <this-repo>
cd ocs-vpnstack
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD and SECRET_KEY
```

### 2. Generate TLS certs for nginx

```bash
mkdir -p nginx/certs
openssl req -x509 -nodes -newkey rsa:4096 \
  -keyout nginx/certs/server.key \
  -out nginx/certs/server.crt \
  -days 365 -subj "/CN=vpn-dashboard"
```

### 3. Build and run

```bash
docker compose up -d --build
```

### 4. Access the dashboard

Open **https://\<your-host\>:8443** in a browser.

Default credentials: `admin` / `admin` — **change immediately** via the Users page.

---

## Features

### User Management
- Create / edit / delete VPN users
- Enable / disable accounts (ocpasswd lock/unlock)
- Set data quotas
- View and edit notes

### OTP / 2FA
- Per-user TOTP (Google Authenticator, Authy, etc.)
- Secret generated with `pyotp`, stored in DB and written to `users.oath`
- QR code shown at creation time
- ocserv validates OTP natively — no custom auth code

### Per-User Routes
- Assign CIDR ranges that get pushed to each client
- Mark routes as `no-route` (excluded)
- Changes take effect immediately via `occtl reload` — no restart needed
- Config written to `/etc/ocserv/user-routes/<username>.conf`

### Live Sessions
- Active sessions polled from `occtl show users` every 30 seconds
- Kick any user from the dashboard
- RX / TX displayed per session

### Traffic Statistics
- Historical session log stored in PostgreSQL via connect/disconnect hooks
- Per-user totals: bytes in, bytes out, session count, last seen
- Bar chart of top-10 users by traffic

---

## Directory Structure

```
ocs-vpnstack/
├── docker-compose.yml
├── .env.example
├── ocserv/
│   ├── Dockerfile          # Alpine + ocserv + gnutls-utils
│   ├── ocserv.conf         # Main VPN config
│   ├── connect.sh          # Hook -> notifies API on connect
│   └── disconnect.sh       # Hook -> notifies API on disconnect
├── api/
│   ├── main.py             # FastAPI app entry point
│   ├── models.py           # SQLAlchemy ORM models
│   ├── schemas.py          # Pydantic request/response schemas
│   ├── auth.py             # JWT + bcrypt helpers
│   ├── occtl.py            # Async wrappers for ocpasswd/occtl/files
│   └── routers/
│       ├── auth_router.py  # /auth/*
│       ├── users.py        # /users/*
│       ├── routes_router.py# /users/{u}/routes
│       ├── sessions.py     # /sessions/active, /users/{u}/sessions
│       ├── stats.py        # /stats/*
│       └── internal.py     # /internal/events/* (hooks only)
├── frontend/
│   ├── src/
│   │   ├── pages/          # Login, Users, Sessions, Stats
│   │   ├── components/     # Layout, Sidebar
│   │   ├── api/client.ts   # Axios API client
│   │   ├── store/auth.ts   # Zustand auth store
│   │   └── types/          # Shared TypeScript types
│   └── ...
└── nginx/
    ├── nginx.conf
    └── certs/              # Mount your TLS cert + key here
```

## API Reference

All endpoints (except `/auth/*` and `/internal/*`) require `Authorization: Bearer <token>`.

| Method | Path                          | Description                     |
|--------|-------------------------------|---------------------------------|
| POST   | `/auth/login`                 | Get access + refresh tokens     |
| POST   | `/auth/refresh`               | Refresh access token            |
| GET    | `/users`                      | List all VPN users              |
| POST   | `/users`                      | Create user                     |
| PATCH  | `/users/{u}`                  | Update user                     |
| DELETE | `/users/{u}`                  | Delete user                     |
| POST   | `/users/{u}/disconnect`       | Kick active session             |
| GET    | `/users/{u}/otp-qr`           | Get OTP QR data URL             |
| GET/PUT| `/users/{u}/routes`           | Get / replace route list        |
| GET    | `/sessions/active`            | Live sessions from occtl        |
| GET    | `/users/{u}/sessions`         | Session history                 |
| GET    | `/stats/users`                | Traffic stats for all users     |
| GET    | `/stats/users/{u}`            | Stats for one user              |

## Security Notes

- Change default admin credentials immediately after first login
- Restrict `ALLOWED_ORIGINS` in `.env` to your domain in production
- The `/internal/*` endpoints have no JWT auth — they rely on Docker network isolation
- The VPN listens on port 443 (TCP+UDP) for maximum compatibility with restrictive firewalls
- Dashboard is on port 8443 to avoid conflict with the VPN port
