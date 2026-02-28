# ocs-vpnstack

A self-hosted OpenConnect VPN management stack built on **ocserv**, with a full web dashboard, group-based policies, OTP/TOTP support, per-user routing, static IP assignment, GeoIP session tracking, traffic statistics, SIEM/syslog integration, SMTP notifications, and detailed audit logging.

## One-Click Install

Run this single command on any Linux machine (Ubuntu, Debian, CentOS, Fedora, Arch, Alpine):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/tahasaifeee/ocs-vpnstack/master/setup.sh)
```

The script will:
- Install Docker and Docker Compose if not already present
- Clone this repository to `/opt/ocs-vpnstack`
- Ask you for: server IP/domain, dashboard port, VPN port, admin credentials, and TLS cert type
- Generate TLS certificates (self-signed or Let's Encrypt)
- Write the `.env` file with auto-generated secrets
- Build and start all services
- Open firewall ports via ufw / firewalld automatically
- Save your port/host config to `.setup-state` for future updates

> **Custom install directory**
> ```bash
> INSTALL_DIR=/home/myuser/vpn bash <(curl -fsSL https://raw.githubusercontent.com/tahasaifeee/ocs-vpnstack/master/setup.sh)
> ```

---

## Updating

When this repo receives new code changes, apply them to your running stack with a single command:

```bash
bash /opt/ocs-vpnstack/setup.sh --update
```

The update command will:
1. Fetch the latest commits and **show you a changelog** before doing anything
2. Ask for confirmation
3. Detect **which services changed** (`api`, `frontend`, `ocserv`) and rebuild only those
4. Perform a **rolling restart** — restarts one service at a time so your VPN stays up during frontend/API updates
5. Re-apply your saved port configuration automatically (no re-prompting)
6. Run a health check and show a status summary

**Other management commands:**

```bash
# Check service health + recent logs
bash /opt/ocs-vpnstack/setup.sh --status

# Force a full image rebuild without pulling new code
bash /opt/ocs-vpnstack/setup.sh --rebuild

# Remove everything (containers, volumes, files)
bash /opt/ocs-vpnstack/setup.sh --uninstall
```

Full help:

```bash
bash /opt/ocs-vpnstack/setup.sh --help
```

> **How updates preserve your config**
> On first install, `setup.sh` saves your port numbers, server host, and TLS type to
> `/opt/ocs-vpnstack/.setup-state`. On `--update` this file is read back so your
> customised ports are re-applied to the fresh `docker-compose.yml` automatically.
> Your `.env` (passwords, secret key) is backed up before every update.

---

## Architecture

```
[Web Dashboard (React + Vite + TailwindCSS)]
                ↕ REST API (/api/*)
[Backend API — FastAPI + PostgreSQL + Redis]
                ↕ subprocess (ocpasswd / occtl / ocserv.conf)
[ocserv — OpenConnect VPN]
                ↕ TLS/DTLS
[VPN Clients]
```

## Services (Docker Compose)

| Service    | Image / Build  | Purpose                                                    |
|------------|----------------|------------------------------------------------------------|
| `ocserv`   | ./ocserv       | OpenConnect VPN daemon                                     |
| `api`      | ./api          | FastAPI — user/group CRUD, OTP, routes, stats, network     |
| `frontend` | ./frontend     | React SPA dashboard                                        |
| `postgres` | postgres:16    | User metadata, groups, session logs, audit trail           |
| `redis`    | redis:7        | GeoIP cache (24 h TTL), session cache, rate-limiting       |
| `nginx`    | nginx:alpine   | Reverse proxy + TLS termination                            |

## Quick Start

### Option A — One-click (recommended)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/tahasaifeee/ocs-vpnstack/master/setup.sh)
```

Follow the interactive prompts. Done.

### Option B — Manual

#### 1. Clone and configure

```bash
git clone https://github.com/tahasaifeee/ocs-vpnstack.git
cd ocs-vpnstack
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD and SECRET_KEY
```

#### 2. Generate TLS certs for nginx

```bash
mkdir -p nginx/certs
openssl req -x509 -nodes -newkey rsa:4096 \
  -keyout nginx/certs/server.key \
  -out nginx/certs/server.crt \
  -days 3650 -subj "/CN=your-server-ip"
```

#### 3. Build and run

```bash
docker compose up -d --build
```

#### 4. Access the dashboard

Open **https://\<your-host\>:8443** in a browser.

Default credentials: `admin` / `admin` — **change immediately** via Settings.

---

## Features

### User Management
- Create / edit / delete VPN users
- Enable / disable accounts (ocpasswd lock/unlock)
- Assign users to groups (inherits group policies)
- Set static VPN IP per user (overrides dynamic pool)
- Set per-user max concurrent sessions override
- Set per-user DNS servers override
- Set data quota (bytes)
- View and edit notes
- **Credentials panel after creation** — shows server address, username, password (click-to-reveal), OTP QR code, and VPN client download link with one-click copy-all and email-send
- **Persistent user info modal** — click the info icon on any user row to view connection details, 2FA QR, set a new password to share, and send credentials by email

### Group Policies
- Create groups with shared policy settings
- Per-group: max concurrent sessions, data quota, DNS servers, session timeout
- Split-tunnel mode toggle (push specific routes vs. full tunnel)
- Editing a group immediately regenerates per-user ocserv config files for all members
- Users without a group use the global ocserv.conf defaults

### OTP / 2FA
- Per-user TOTP for VPN login (Google Authenticator, Authy, etc.)
- Secret generated with `pyotp`, stored in DB and written to `users.oath`
- QR code shown at user creation time and accessible at any time via the user info modal
- ocserv validates OTP natively — no custom auth code
- Admin account TOTP for dashboard login

### Per-User Routes
- Assign CIDR ranges pushed to each client on connect
- Mark routes as `no-route` (excluded / split-tunnel)
- Changes take effect immediately via `occtl reload` — no restart needed
- Config written to `/etc/ocserv/user-routes/<username>.conf`

### Network Settings
- Edit VPN IP pool (CIDR + netmask) from the dashboard
- Configure global DNS servers pushed to all clients
- Toggle `tunnel-all-dns`
- Enable / disable IPv6 and set IPv6 network CIDR
- Configure global max clients and max same-user sessions
- Settings written directly to `ocserv.conf` and applied with `occtl reload`

### Live Sessions
- Active sessions polled from `occtl show users` every 30 seconds
- Per session: username, public IP, **GeoIP location** (country flag + city), VPN IP, device/OS, connect time, RX/TX bytes
- Force-disconnect any user from the dashboard
- GeoIP resolved via ip-api.com with 24-hour Redis cache to avoid rate limits

### Traffic Statistics
- Historical session log stored in PostgreSQL via connect/disconnect hooks
- Per-user totals: bytes in, bytes out, session count, last seen
- Bar chart of top-10 users by traffic

### Logs
- **Auth log** — every login attempt (success and failure) with timestamp, IP, and reason
- **Session log** — full VPN session history with duration and bandwidth
- **Audit trail** — admin actions (user created/deleted, config changed, etc.)
- All log views support filtering, pagination, and CSV/JSON export

### Reports
- **Daily bandwidth** — bar chart of RX+TX per day
- **Monthly bandwidth** — bar chart of RX+TX per calendar month
- **Top users** — bar chart + table ranked by total data transferred
- **Login failures** — chart of failed auth attempts over time
- **Peak hours** — 24-hour line chart showing busiest connection times
- Configurable time window (30 / 90 / 180 / 365 days) and CSV/JSON export

### Service Management
- **Service status** — real-time ocserv status with one-click reload
- **Config management** — validate, download, and upload `ocserv.conf` from the browser
- **Backups** — create and restore timestamped config backups
- **Syslog** — configure remote syslog forwarding (host, port, protocol, severity)
- **SIEM webhook** — forward auth and session events to any HTTP endpoint (Splunk HEC, Elastic, Graylog, etc.)
- **SMTP settings** — configure email delivery (host, port, TLS/SSL, credentials) with a built-in test button
- **VPN Client settings** — set the canonical server address and client download URL shown in credentials panels

---

## Directory Structure

```
ocs-vpnstack/
├── setup.sh                # One-click installer (run via curl | bash)
├── docker-compose.yml
├── .env.example
├── ocserv/
│   ├── Dockerfile
│   ├── ocserv.conf         # Default VPN config (preserved on restart if modified)
│   ├── entrypoint.sh       # Cert generation + config bootstrap
│   ├── connect.sh          # Hook → notifies API on connect
│   └── disconnect.sh       # Hook → notifies API on disconnect
├── api/
│   ├── main.py             # FastAPI app entry point + DB migrations
│   ├── models.py           # SQLAlchemy ORM models (AdminUser, VpnUser, Group, AuthLog, SystemSetting, …)
│   ├── schemas.py          # Pydantic request/response schemas
│   ├── auth.py             # JWT + bcrypt helpers
│   ├── occtl.py            # ocpasswd/occtl wrappers, per-user config writer, GeoIP
│   ├── mailer.py           # SMTP email delivery (smtplib, STARTTLS + SSL)
│   ├── siem.py             # Syslog forwarding + SIEM webhook emission
│   ├── redis_client.py     # Async Redis connection helper
│   └── routers/
│       ├── auth_router.py  # /auth/*
│       ├── users.py        # /users/*
│       ├── groups.py       # /groups/*
│       ├── network.py      # /network
│       ├── routes_router.py# /users/{u}/routes
│       ├── sessions.py     # /sessions/active, /users/{u}/sessions
│       ├── stats.py        # /stats/*
│       ├── logs.py         # /logs/* (auth, sessions, audit + exports)
│       ├── reports.py      # /reports/* (daily, monthly, top users, failures, peak hours)
│       ├── service.py      # /service/* (status, reload, config, backups, syslog, SIEM, SMTP)
│       └── internal.py     # /internal/events/* (hooks only)
├── frontend/
│   ├── src/
│   │   ├── pages/          # Login, Users, Sessions, Stats, Groups, Network, Settings, Logs, Reports, Service
│   │   ├── components/     # Layout, Sidebar
│   │   ├── api/client.ts   # Axios API client + per-resource helpers
│   │   ├── store/auth.ts   # Zustand auth store
│   │   └── types/          # Shared TypeScript types
│   └── ...
└── nginx/
    ├── nginx.conf
    └── certs/              # Mount your TLS cert + key here
```

## API Reference

All endpoints (except `/auth/*` and `/internal/*`) require `Authorization: Bearer <token>`.

### Auth

| Method | Path                  | Description                        |
|--------|-----------------------|------------------------------------|
| POST   | `/auth/login`         | Get access + refresh tokens        |
| POST   | `/auth/refresh`       | Refresh access token               |
| GET    | `/auth/me`            | Get current admin profile          |
| PATCH  | `/auth/me`            | Change admin password / username   |
| POST   | `/auth/totp/setup`    | Generate admin TOTP secret + QR    |
| POST   | `/auth/totp/enable`   | Confirm and activate admin TOTP    |
| POST   | `/auth/totp/disable`  | Disable admin TOTP                 |

### Users

| Method   | Path                              | Description                           |
|----------|-----------------------------------|---------------------------------------|
| GET      | `/users`                          | List all VPN users                    |
| POST     | `/users`                          | Create user                           |
| PATCH    | `/users/{u}`                      | Update user (password, group, IP, …)  |
| DELETE   | `/users/{u}`                      | Delete user                           |
| POST     | `/users/{u}/disconnect`           | Kick active session                   |
| GET      | `/users/{u}/otp-qr`               | Get OTP QR data URL                   |
| GET/PUT  | `/users/{u}/routes`               | Get / replace route list              |
| POST     | `/users/{u}/send-credentials`     | Email VPN credentials to user         |

### Groups / Network / Sessions / Stats

| Method   | Path                       | Description                                    |
|----------|----------------------------|------------------------------------------------|
| GET      | `/groups`                  | List all groups                                |
| POST     | `/groups`                  | Create group                                   |
| PATCH    | `/groups/{id}`             | Update group (regenerates configs)             |
| DELETE   | `/groups/{id}`             | Delete group                                   |
| GET      | `/network`                 | Get current ocserv network settings            |
| PUT      | `/network`                 | Update network settings + reload               |
| GET      | `/sessions/active`         | Live sessions with GeoIP from occtl            |
| GET      | `/users/{u}/sessions`      | Session history                                |
| GET      | `/stats/users`             | Traffic stats for all users                    |
| GET      | `/stats/users/{u}`         | Stats for one user                             |

### Logs

| Method | Path                          | Description                                    |
|--------|-------------------------------|------------------------------------------------|
| GET    | `/logs/auth`                  | Auth log (paginated, filterable)               |
| GET    | `/logs/auth/export`           | Export auth log (CSV or JSON)                  |
| GET    | `/logs/sessions`              | Session log (paginated, filterable)            |
| GET    | `/logs/sessions/export`       | Export session log                             |
| GET    | `/logs/audit`                 | Audit trail (paginated, filterable)            |
| GET    | `/logs/audit/export`          | Export audit trail                             |

### Reports

| Method | Path                    | Description                                         |
|--------|-------------------------|-----------------------------------------------------|
| GET    | `/reports/daily`        | Daily bandwidth (RX + TX per day)                   |
| GET    | `/reports/monthly`      | Monthly bandwidth                                   |
| GET    | `/reports/top-users`    | Top users by total data transferred                 |
| GET    | `/reports/login-failures` | Failed auth attempts over time                    |
| GET    | `/reports/peak-hours`   | Connections by hour of day (0–23)                   |
| GET    | `/reports/export`       | Export any report as CSV or JSON                    |

### Service

| Method   | Path                       | Description                                    |
|----------|----------------------------|------------------------------------------------|
| GET      | `/service/status`          | ocserv service status                          |
| POST     | `/service/reload`          | Reload ocserv config (occtl reload)            |
| GET      | `/service/config`          | Download current ocserv.conf                   |
| PUT      | `/service/config`          | Upload and apply a new ocserv.conf             |
| POST     | `/service/config/validate` | Validate an ocserv.conf without applying       |
| GET      | `/service/backups`         | List config backups                            |
| POST     | `/service/backups`         | Create a new backup                            |
| POST     | `/service/backups/{name}/restore` | Restore a backup                      |
| GET/PUT  | `/service/syslog`          | Get / update syslog forwarding settings        |
| GET/PUT  | `/service/siem`            | Get / update SIEM webhook settings             |
| POST     | `/service/siem/test`       | Send a test event to the SIEM webhook          |
| GET/PUT  | `/service/smtp`            | Get / update SMTP email settings               |
| POST     | `/service/smtp/test`       | Send a test email                              |
| GET/PUT  | `/service/vpn-client`      | Get / update VPN client settings (server addr, download URL) |

## Security Notes

- Change default admin credentials immediately after first login
- Enable admin TOTP (Settings → Two-Factor Authentication) for an extra layer of protection
- Restrict `ALLOWED_ORIGINS` in `.env` to your domain in production
- The `/internal/*` endpoints have no JWT auth — they rely on Docker network isolation
- The VPN listens on port 443 (TCP+UDP) for maximum compatibility with restrictive firewalls
- Dashboard is on port 8443 to avoid conflict with the VPN port
- User passwords are stored as bcrypt hashes in ocpasswd and are never retrievable — use the user info modal to set a fresh password when sharing credentials with a user
