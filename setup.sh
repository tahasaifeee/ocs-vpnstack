#!/usr/bin/env bash
# =============================================================================
#  ocs-vpnstack — One-Click Setup Script
#  https://github.com/tahasaifeee/ocs-vpnstack
# =============================================================================
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${CYAN}▶ $*${RESET}"; }
ask()     { echo -e "${YELLOW}  ?${RESET} $*"; }

REPO_URL="https://github.com/tahasaifeee/ocs-vpnstack"
INSTALL_DIR="${INSTALL_DIR:-/opt/ocs-vpnstack}"
STATE_FILE="$INSTALL_DIR/.setup-state"   # persists port/host config across updates

banner() {
  echo -e "${BOLD}${CYAN}"
  cat <<'BANNER'
  ___   ___ ____        __   ______  _   _      _             _
 / _ \ / __/ ___|      / /  |  __\ \| \ | |    | |           | |
| | | | |_\___ \ _____/ /   | |_) | |  \| |___| |_ __ _  ___| | __
| | | | __|___) |_____/ /    \  __/| . ` / __| __/ _` |/ __| |/ /
| |_| | |_ ___) |    / /     | |   | |\  \__ \ || (_| | (__|   <
 \___/ \__|____/    /_/      |_|   |_| \_|___/\__\__,_|\___|_|\_\

BANNER
  echo -e "${RESET}${BOLD}  OpenConnect VPN Management Stack — One-Click Installer${RESET}"
  echo -e "  ${BLUE}$REPO_URL${RESET}"
  echo ""
}

# ── OS Detection ──────────────────────────────────────────────────────────────
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_LIKE="${ID_LIKE:-}"
    OS_VERSION="${VERSION_ID:-}"
  else
    error "Cannot detect OS. /etc/os-release not found."
  fi

  case "$OS" in
    ubuntu|debian|linuxmint|pop)   PKG_MGR="apt" ;;
    centos|rhel|almalinux|rocky)   PKG_MGR="yum" ;;
    fedora)                         PKG_MGR="dnf" ;;
    arch|manjaro|endeavouros)       PKG_MGR="pacman" ;;
    alpine)                         PKG_MGR="apk" ;;
    *)
      if echo "$OS_LIKE" | grep -q "debian"; then PKG_MGR="apt"
      elif echo "$OS_LIKE" | grep -q "rhel\|fedora"; then PKG_MGR="yum"
      else error "Unsupported OS: $OS. Please install Docker manually and re-run."
      fi
      ;;
  esac
  info "Detected OS: ${BOLD}$OS${RESET} (package manager: $PKG_MGR)"
}

# ── Dependency installer ──────────────────────────────────────────────────────
pkg_install() {
  local PKGS=("$@")
  case "$PKG_MGR" in
    apt)    sudo apt-get update -qq && sudo apt-get install -y -q "${PKGS[@]}" ;;
    yum)    sudo yum install -y "${PKGS[@]}" ;;
    dnf)    sudo dnf install -y "${PKGS[@]}" ;;
    pacman) sudo pacman -Sy --noconfirm "${PKGS[@]}" ;;
    apk)    sudo apk add --no-cache "${PKGS[@]}" ;;
  esac
}

require_root_or_sudo() {
  if [ "$EUID" -eq 0 ]; then
    # Running as root — create a sudo alias that just runs the command
    sudo() { "$@"; }
    export -f sudo
  elif ! command -v sudo &>/dev/null; then
    error "This script requires sudo. Please run as root or install sudo."
  fi
}

# ── Install Docker ─────────────────────────────────────────────────────────────
install_docker() {
  if command -v docker &>/dev/null; then
    success "Docker already installed ($(docker --version | awk '{print $3}' | tr -d ','))"
    return
  fi
  step "Installing Docker"
  case "$PKG_MGR" in
    apt)
      pkg_install ca-certificates curl gnupg lsb-release
      sudo install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/$OS/gpg | \
        sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      sudo chmod a+r /etc/apt/keyrings/docker.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/$OS $(lsb_release -cs) stable" | \
        sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
      sudo apt-get update -qq
      pkg_install docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
    yum|dnf)
      sudo $PKG_MGR install -y yum-utils
      sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      pkg_install docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
    pacman)
      pkg_install docker docker-compose
      ;;
    apk)
      pkg_install docker docker-compose
      ;;
    *)
      warn "Auto-install not supported for $PKG_MGR. Trying generic script…"
      curl -fsSL https://get.docker.com | sudo sh
      ;;
  esac
  sudo systemctl enable --now docker
  # Add current user to docker group
  if [ "$EUID" -ne 0 ] && id -nG "$USER" | grep -qv docker; then
    sudo usermod -aG docker "$USER"
    warn "Added $USER to the docker group. You may need to log out and back in."
    warn "For this session, commands will run via sudo."
    DOCKER_SUDO="sudo"
  fi
  success "Docker installed"
}

# ── Install Docker Compose ─────────────────────────────────────────────────────
install_compose() {
  # Docker Compose v2 (plugin) check
  if docker compose version &>/dev/null 2>&1; then
    success "Docker Compose already installed ($(docker compose version --short))"
    return
  fi
  step "Installing Docker Compose plugin"
  # Fallback: standalone binary
  local COMPOSE_VER
  COMPOSE_VER=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest \
    | grep '"tag_name"' | sed 's/.*"v\([^"]*\)".*/\1/')
  sudo curl -fsSL \
    "https://github.com/docker/compose/releases/download/v${COMPOSE_VER}/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/bin/docker-compose
  sudo chmod +x /usr/local/bin/docker-compose
  # Make it available as `docker compose` too
  sudo mkdir -p /usr/local/lib/docker/cli-plugins
  sudo ln -sf /usr/local/bin/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
  success "Docker Compose $COMPOSE_VER installed"
}

# ── Install Git & Curl ─────────────────────────────────────────────────────────
install_basics() {
  local MISSING=()
  command -v git  &>/dev/null || MISSING+=(git)
  command -v curl &>/dev/null || MISSING+=(curl)
  command -v openssl &>/dev/null || MISSING+=(openssl)
  if [ ${#MISSING[@]} -gt 0 ]; then
    step "Installing missing tools: ${MISSING[*]}"
    pkg_install "${MISSING[@]}"
  fi
  success "Required tools present (git, curl, openssl)"
}

# ── Clone / Update Repo ───────────────────────────────────────────────────────
setup_repo() {
  step "Setting up repository"
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Repository already exists at $INSTALL_DIR — pulling latest changes…"
    git -C "$INSTALL_DIR" pull --ff-only origin master 2>/dev/null || \
    git -C "$INSTALL_DIR" pull --ff-only origin main  2>/dev/null || true
  else
    info "Cloning repository to $INSTALL_DIR"
    sudo mkdir -p "$(dirname "$INSTALL_DIR")"
    # Move to a guaranteed-valid directory before cloning; the caller's cwd
    # may be a deleted path (e.g. right after --uninstall) which causes git
    # to fail with "Unable to read current working directory".
    cd /tmp
    if [ "$EUID" -ne 0 ]; then
      sudo git clone "$REPO_URL" "$INSTALL_DIR"
      sudo chown -R "$USER:$USER" "$INSTALL_DIR"
    else
      git clone "$REPO_URL" "$INSTALL_DIR"
    fi
  fi
  success "Repository ready at $INSTALL_DIR"
}

# ── Collect Configuration ─────────────────────────────────────────────────────
collect_config() {
  step "Configuration"
  echo ""

  # Server host
  local DEFAULT_HOST
  DEFAULT_HOST=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  ask "Server public IP or domain name [${DEFAULT_HOST}]:"
  read -r SERVER_HOST
  SERVER_HOST="${SERVER_HOST:-$DEFAULT_HOST}"

  # Dashboard port
  ask "Dashboard HTTPS port [8443]:"
  read -r DASHBOARD_PORT
  DASHBOARD_PORT="${DASHBOARD_PORT:-8443}"

  # VPN port (443 is optimal but may conflict with nginx/apache)
  ask "VPN listen port (TCP+UDP) [443]:"
  read -r VPN_PORT
  VPN_PORT="${VPN_PORT:-443}"

  # Admin username
  ask "Dashboard admin username [admin]:"
  read -r ADMIN_USER
  ADMIN_USER="${ADMIN_USER:-admin}"

  # Admin password
  while true; do
    ask "Dashboard admin password (min 8 chars):"
    read -rs ADMIN_PASS
    echo ""
    if [ ${#ADMIN_PASS} -ge 8 ]; then break
    else warn "Password must be at least 8 characters."; fi
  done

  # PostgreSQL password
  local DEFAULT_PG_PASS
  DEFAULT_PG_PASS=$(openssl rand -base64 18 | tr -d '=/+' | head -c 24)
  ask "PostgreSQL password [auto-generated: press Enter to accept]:"
  read -rs PG_PASS
  echo ""
  PG_PASS="${PG_PASS:-$DEFAULT_PG_PASS}"

  # Secret key — always auto-generate
  SECRET_KEY=$(openssl rand -hex 32)

  # TLS certificate choice
  echo ""
  ask "TLS certificate for the dashboard:"
  echo "  1) Self-signed (quick, browser will warn — good for private use)"
  echo "  2) Let's Encrypt (requires a real domain + port 80 open)"
  read -r TLS_CHOICE
  TLS_CHOICE="${TLS_CHOICE:-1}"

  # VPN subnet
  ask "VPN IP subnet [172.16.0.0/16]:"
  read -r VPN_SUBNET
  VPN_SUBNET="${VPN_SUBNET:-172.16.0.0/16}"

  # Export for later use
  export SERVER_HOST DASHBOARD_PORT VPN_PORT ADMIN_USER ADMIN_PASS PG_PASS SECRET_KEY TLS_CHOICE VPN_SUBNET

  echo ""
  success "Configuration collected"
}

# ── Generate TLS Certs ────────────────────────────────────────────────────────
generate_certs() {
  step "Setting up TLS certificates"
  local CERT_DIR="$INSTALL_DIR/nginx/certs"
  mkdir -p "$CERT_DIR"

  if [ "$TLS_CHOICE" = "2" ]; then
    # Let's Encrypt
    info "Installing certbot…"
    case "$PKG_MGR" in
      apt)    pkg_install certbot ;;
      yum|dnf) pkg_install certbot ;;
      pacman)  pkg_install certbot ;;
      *)       warn "Install certbot manually if needed" ;;
    esac
    info "Requesting Let's Encrypt certificate for $SERVER_HOST"
    sudo certbot certonly --standalone \
      --agree-tos --non-interactive \
      --email "admin@${SERVER_HOST}" \
      -d "$SERVER_HOST" \
      --http-01-port 80 || {
        warn "Let's Encrypt failed — falling back to self-signed cert"
        TLS_CHOICE="1"
      }
    if [ "$TLS_CHOICE" = "2" ]; then
      sudo cp "/etc/letsencrypt/live/${SERVER_HOST}/fullchain.pem" "$CERT_DIR/server.crt"
      sudo cp "/etc/letsencrypt/live/${SERVER_HOST}/privkey.pem"   "$CERT_DIR/server.key"
      sudo chown -R "$USER:$USER" "$CERT_DIR" 2>/dev/null || true
      success "Let's Encrypt certificate installed"
      return
    fi
  fi

  # Self-signed
  info "Generating self-signed TLS certificate for $SERVER_HOST"
  openssl req -x509 -nodes -newkey rsa:4096 \
    -keyout "$CERT_DIR/server.key" \
    -out    "$CERT_DIR/server.crt" \
    -days 3650 \
    -subj  "/CN=${SERVER_HOST}/O=VPN Dashboard/C=US" \
    -addext "subjectAltName=IP:${SERVER_HOST},DNS:${SERVER_HOST}" \
    2>/dev/null
  success "Self-signed certificate generated (valid 10 years)"
}

# ── Generate ocserv TLS cert ──────────────────────────────────────────────────
generate_ocserv_cert() {
  # Only needed if not mounted externally — the Dockerfile handles it, but
  # we can pre-seed it into the named volume via a temp container.
  # For simplicity we leave this to the Dockerfile auto-generation.
  true
}

# ── Write .env ────────────────────────────────────────────────────────────────
write_env() {
  step "Writing environment configuration"
  cat > "$INSTALL_DIR/.env" <<ENV
# Generated by setup.sh on $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# !! Keep this file secret — do not commit it !!

POSTGRES_PASSWORD=${PG_PASS}
SECRET_KEY=${SECRET_KEY}
ENV
  success ".env written"
}

# ── Persist / restore install state ──────────────────────────────────────────
save_state() {
  cat > "$STATE_FILE" <<STATE
# ocs-vpnstack install state — written by setup.sh
# Edit values here if you change ports on the host, then run: setup.sh --update
SAVED_VPN_PORT=${VPN_PORT}
SAVED_DASHBOARD_PORT=${DASHBOARD_PORT}
SAVED_SERVER_HOST=${SERVER_HOST}
SAVED_TLS_CHOICE=${TLS_CHOICE}
SAVED_VPN_SUBNET=${VPN_SUBNET}
INSTALL_DATE="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
STATE
  success "Install state saved to $STATE_FILE"
}

load_state() {
  if [ ! -f "$STATE_FILE" ]; then
    error "State file not found at $STATE_FILE — was this installed via setup.sh?\nRun without --update to do a fresh install, or set INSTALL_DIR if you used a custom path."
  fi
  # shellcheck source=/dev/null
  . "$STATE_FILE"
  VPN_PORT="${SAVED_VPN_PORT:-443}"
  DASHBOARD_PORT="${SAVED_DASHBOARD_PORT:-8443}"
  SERVER_HOST="${SAVED_SERVER_HOST:-localhost}"
  TLS_CHOICE="${SAVED_TLS_CHOICE:-1}"
  VPN_SUBNET="${SAVED_VPN_SUBNET:-172.16.0.0/16}"
  success "Loaded config: VPN=$VPN_PORT  Dashboard=$DASHBOARD_PORT  Host=$SERVER_HOST"
}

# ── Patch docker-compose ports ─────────────────────────────────────────────────
patch_compose() {
  step "Patching docker-compose.yml with your port choices"
  local COMPOSE="$INSTALL_DIR/docker-compose.yml"

  # Replace VPN port (443:443) with chosen port
  sed -i "s|\"443:443/tcp\"|\"${VPN_PORT}:443/tcp\"|g" "$COMPOSE"
  sed -i "s|\"443:443/udp\"|\"${VPN_PORT}:443/udp\"|g" "$COMPOSE"

  # Replace dashboard port (8443:8443)
  sed -i "s|\"8443:8443\"|\"${DASHBOARD_PORT}:8443\"|g" "$COMPOSE"

  success "Ports patched (VPN: $VPN_PORT, Dashboard: $DASHBOARD_PORT)"
}

# ── Start Services ────────────────────────────────────────────────────────────
start_services() {
  step "Building and starting all services (this may take a few minutes…)"
  cd "$INSTALL_DIR"
  ${DOCKER_SUDO:-} docker compose pull --quiet 2>/dev/null || true
  ${DOCKER_SUDO:-} docker compose up -d --build --remove-orphans
  success "Services started"
}

# ── Wait for API ──────────────────────────────────────────────────────────────
wait_for_api() {
  step "Waiting for API to become healthy"

  # Port 8000 is NOT exposed to the host — only reachable inside vpn-net.
  # Primary strategy: poll Docker's own container healthcheck status.
  # Fallback: reach the API through nginx at :DASHBOARD_PORT/api/healthz.
  local MAX=90 COUNT=0 HEALTH

  while [ $COUNT -lt $MAX ]; do
    HEALTH=$(${DOCKER_SUDO:-} docker compose ps --format '{{.Health}}' api 2>/dev/null \
             | head -1 || true)

    if [ "$HEALTH" = "healthy" ]; then
      echo ""
      success "API is healthy (Docker health check passed)"
      return 0
    fi

    # Fallback: try via nginx reverse-proxy (available from the host)
    if curl -fsSL -k --max-time 3 \
        "https://127.0.0.1:${DASHBOARD_PORT:-8443}/api/healthz" &>/dev/null; then
      echo ""
      success "API is reachable via nginx proxy"
      return 0
    fi

    COUNT=$((COUNT + 3))
    printf "\r  Waiting… %ds / %ds  (container: %s)" "$COUNT" "$MAX" "${HEALTH:-starting}"
    sleep 3
  done

  echo ""
  warn "API did not become healthy within ${MAX}s — check logs with:"
  warn "  docker compose -f $INSTALL_DIR/docker-compose.yml logs api"
}

# ── Change Default Admin Password ─────────────────────────────────────────────
set_admin_password() {
  step "Configuring dashboard admin account"

  # Strategy: run a Python snippet inside the already-running API container.
  # This uses the exact same passlib/bcrypt hash_password() the API uses, so
  # the stored hash is always compatible.  Credentials are passed as
  # environment variables (never interpolated into Python source) so special
  # characters in passwords are handled safely.
  _exec_admin_update() {
    ${DOCKER_SUDO:-} docker compose -f "$INSTALL_DIR/docker-compose.yml" \
      exec -T \
      -e _NEW_USER="${ADMIN_USER}" \
      -e _NEW_PASS="${ADMIN_PASS}" \
      api python -c "
import asyncio, os
from auth import hash_password
from database import AsyncSessionLocal
from models import AdminUser
from sqlalchemy import select

async def run():
    new_user = os.environ['_NEW_USER']
    new_pass = os.environ['_NEW_PASS']
    hashed   = hash_password(new_pass)
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(AdminUser).where(AdminUser.username == 'admin'))
        admin = result.scalar_one_or_none()
        if admin is None:
            print('NOTFOUND', flush=True)
            return
        admin.username        = new_user
        admin.hashed_password = hashed
        await db.commit()
        print('OK', flush=True)

asyncio.run(run())
" 2>&1
  }

  local OUT
  OUT=$(_exec_admin_update) || true

  # Retry once if the seed row isn't in the DB yet (race on first boot)
  if echo "$OUT" | grep -q "NOTFOUND"; then
    warn "Admin seed row not found — retrying in 5s…"
    sleep 5
    OUT=$(_exec_admin_update) || true
  fi

  if echo "$OUT" | grep -q "^OK"; then
    success "Admin account configured (user: ${ADMIN_USER})"
  else
    warn "Could not set admin credentials automatically."
    [ -n "$OUT" ] && info "  Detail: $OUT"
    warn "  → Log in with  admin / admin  and use PATCH /auth/me to update."
  fi
}

# ── Show Summary ──────────────────────────────────────────────────────────────
show_summary() {
  echo ""
  echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${GREEN}║        ✓  VPN Stack installed successfully!          ║${RESET}"
  echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "  ${BOLD}Dashboard${RESET}"
  echo -e "  URL      : ${CYAN}https://${SERVER_HOST}:${DASHBOARD_PORT}${RESET}"
  echo -e "  Username : ${BOLD}${ADMIN_USER}${RESET}"
  echo -e "  Password : ${BOLD}${ADMIN_PASS}${RESET}"
  echo ""
  echo -e "  ${BOLD}VPN Server${RESET}"
  echo -e "  Host     : ${CYAN}${SERVER_HOST}${RESET}"
  echo -e "  Port     : ${BOLD}${VPN_PORT}${RESET} (TCP + UDP)"
  echo -e "  Protocol : OpenConnect / Cisco AnyConnect compatible"
  echo ""
  echo -e "  ${BOLD}Connect a client${RESET}"
  echo -e "  ${YELLOW}openconnect --user=<vpn-username> ${SERVER_HOST}:${VPN_PORT}${RESET}"
  echo ""
  echo -e "  ${BOLD}Manage services${RESET}"
  echo -e "  ${INSTALL_DIR}/setup.sh --update     ${CYAN}# pull latest code & rebuild${RESET}"
  echo -e "  ${INSTALL_DIR}/setup.sh --status     ${CYAN}# health + recent logs${RESET}"
  echo -e "  ${INSTALL_DIR}/setup.sh --diagnose   ${CYAN}# full diagnostic (ports, DB, TLS, disk)${RESET}"
  echo -e "  ${INSTALL_DIR}/setup.sh --rebuild    ${CYAN}# force full image rebuild${RESET}"
  echo -e "  ${INSTALL_DIR}/setup.sh --uninstall  ${CYAN}# remove everything${RESET}"
  echo ""
  echo -e "  ${BOLD}Docker shortcuts${RESET}"
  echo -e "  cd ${INSTALL_DIR}"
  echo -e "  docker compose logs -f api       ${CYAN}# tail API logs${RESET}"
  echo -e "  docker compose ps                ${CYAN}# service status${RESET}"
  echo -e "  docker compose down              ${CYAN}# stop everything${RESET}"
  echo ""
  if [ "$TLS_CHOICE" = "1" ]; then
    echo -e "  ${YELLOW}Note: Using a self-signed certificate. Your browser will show${RESET}"
    echo -e "  ${YELLOW}a security warning — click 'Advanced' → 'Proceed' to continue.${RESET}"
    echo ""
  fi
  echo -e "  ${BOLD}Files${RESET}"
  echo -e "  ${INSTALL_DIR}/.env         — secrets (keep this safe!)"
  echo -e "  ${INSTALL_DIR}/.setup-state — port/host config used by --update"
  echo ""
}

# ── Update ────────────────────────────────────────────────────────────────────
update() {
  step "ocs-vpnstack Updater"

  # 1. Verify installation
  [ -d "$INSTALL_DIR/.git" ] || \
    error "No installation found at $INSTALL_DIR.\nSet INSTALL_DIR or run without --update to install fresh."

  load_state

  cd "$INSTALL_DIR"

  # 2. Fetch remote changes
  step "Checking for updates"
  local DEFAULT_BRANCH
  DEFAULT_BRANCH=$(git -C "$INSTALL_DIR" remote show origin 2>/dev/null | \
    grep 'HEAD branch' | awk '{print $NF}')
  DEFAULT_BRANCH="${DEFAULT_BRANCH:-master}"

  git fetch origin "$DEFAULT_BRANCH" --quiet || \
    error "Failed to fetch from remote. Check your internet connection."

  local CURRENT_SHA NEW_SHA
  CURRENT_SHA=$(git rev-parse HEAD)
  NEW_SHA=$(git rev-parse "origin/$DEFAULT_BRANCH")

  if [ "$CURRENT_SHA" = "$NEW_SHA" ]; then
    success "Already up to date ($(git rev-parse --short HEAD)). Nothing to do."
    echo ""
    echo -e "  To force a rebuild without new code: ${CYAN}setup.sh --rebuild${RESET}"
    exit 0
  fi

  # 3. Show incoming changelog
  echo ""
  echo -e "${BOLD}Incoming changes:${RESET}"
  git log --oneline --no-walk --ancestry-path \
    "${CURRENT_SHA}..origin/${DEFAULT_BRANCH}" 2>/dev/null | \
    head -20 | while IFS= read -r line; do
      echo -e "  ${CYAN}·${RESET} $line"
    done
  CHANGE_COUNT=$(git rev-list --count "${CURRENT_SHA}..origin/${DEFAULT_BRANCH}")
  echo ""
  info "$CHANGE_COUNT new commit(s) will be applied"

  # 4. Detect which services have changed (so we can rebuild only those)
  local CHANGED_SERVICES=()
  local CHANGED_FILES
  CHANGED_FILES=$(git diff --name-only "${CURRENT_SHA}..origin/${DEFAULT_BRANCH}" 2>/dev/null)

  echo "$CHANGED_FILES" | grep -q '^api/'      && CHANGED_SERVICES+=("api")
  echo "$CHANGED_FILES" | grep -q '^frontend/' && CHANGED_SERVICES+=("frontend")
  echo "$CHANGED_FILES" | grep -q '^ocserv/'   && CHANGED_SERVICES+=("ocserv")

  if [ ${#CHANGED_SERVICES[@]} -eq 0 ]; then
    CHANGED_SERVICES=("api" "frontend" "ocserv")   # config-only change — rebuild all
  fi

  info "Services requiring rebuild: ${CHANGED_SERVICES[*]}"
  echo ""

  # 5. Confirm with user
  ask "Proceed with update? [Y/n]"
  read -r CONFIRM
  CONFIRM="${CONFIRM:-y}"
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { info "Update cancelled."; exit 0; }

  # 6. Backup .env
  step "Backing up configuration"
  cp "$INSTALL_DIR/.env" "$INSTALL_DIR/.env.bak.$(date +%Y%m%d%H%M%S)"
  success ".env backed up"

  # 7. Reset docker-compose.yml to the git version so pull is clean
  #    (we patch it after pulling fresh code)
  git checkout HEAD -- docker-compose.yml 2>/dev/null || true

  # 8. Pull new code
  step "Pulling latest code"
  git pull origin "$DEFAULT_BRANCH" --ff-only
  success "Code updated to $(git rev-parse --short HEAD)"

  # 9. Restore .env (pull never touches it since it's .gitignored, but be safe)
  [ -f "$INSTALL_DIR/.env" ] || \
    cp "$INSTALL_DIR/.env.bak."* "$INSTALL_DIR/.env" 2>/dev/null || \
    warn ".env missing — you may need to re-create it from .env.example"

  # 10. Re-apply port patches with saved values
  step "Re-applying port configuration"
  sed -i "s|\"443:443/tcp\"|\"${VPN_PORT}:443/tcp\"|g"   docker-compose.yml
  sed -i "s|\"443:443/udp\"|\"${VPN_PORT}:443/udp\"|g"   docker-compose.yml
  sed -i "s|\"8443:8443\"|\"${DASHBOARD_PORT}:8443\"|g"  docker-compose.yml
  success "Ports re-applied (VPN: $VPN_PORT, Dashboard: $DASHBOARD_PORT)"

  # 11. Pull updated base images
  step "Pulling updated base images"
  ${DOCKER_SUDO:-} docker compose pull --quiet 2>/dev/null || true

  # 12. Rolling rebuild — only rebuild changed services, then restart
  step "Rebuilding changed services: ${CHANGED_SERVICES[*]}"
  ${DOCKER_SUDO:-} docker compose build --pull --no-cache "${CHANGED_SERVICES[@]}"

  # 13. Restart changed services one at a time (keeps VPN up during api/frontend rebuild)
  step "Restarting services with minimal downtime"
  for SVC in "${CHANGED_SERVICES[@]}"; do
    info "Restarting $SVC…"
    ${DOCKER_SUDO:-} docker compose up -d --no-deps "$SVC"
    sleep 2
  done

  # Ensure any new services from docker-compose.yml are started too
  ${DOCKER_SUDO:-} docker compose up -d --remove-orphans

  # 14. Health check
  wait_for_api

  # 15. Update state file with latest commit
  echo "LAST_UPDATE=\"$(date -u '+%Y-%m-%d %H:%M:%S UTC')\"" >> "$STATE_FILE"
  echo "LAST_COMMIT=$(git rev-parse --short HEAD)"        >> "$STATE_FILE"

  check_docker_health || true
  show_update_summary
}

# ── Force rebuild (no code change needed) ────────────────────────────────────
rebuild() {
  step "Force Rebuild"
  [ -d "$INSTALL_DIR/.git" ] || error "No installation found at $INSTALL_DIR."
  load_state
  cd "$INSTALL_DIR"

  ask "This will rebuild all Docker images and restart services. Continue? [Y/n]"
  read -r CONFIRM
  CONFIRM="${CONFIRM:-y}"
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { info "Cancelled."; exit 0; }

  step "Rebuilding all images"
  ${DOCKER_SUDO:-} docker compose build --pull --no-cache
  ${DOCKER_SUDO:-} docker compose up -d --remove-orphans

  wait_for_api
  check_docker_health || true
  success "Rebuild complete — running commit $(git rev-parse --short HEAD)"
}

# ── Show service status ───────────────────────────────────────────────────────
status() {
  [ -d "$INSTALL_DIR" ] || error "No installation found at $INSTALL_DIR."
  load_state

  step "Service Status"
  cd "$INSTALL_DIR"
  ${DOCKER_SUDO:-} docker compose ps
  echo ""

  step "Recent Logs (last 20 lines per service)"
  for SVC in ocserv api frontend postgres redis nginx; do
    echo -e "\n${BOLD}── $SVC ──${RESET}"
    ${DOCKER_SUDO:-} docker compose logs --tail=20 --no-log-prefix "$SVC" 2>/dev/null | \
      tail -5 || true
  done
  echo ""

  step "Current Version"
  git -C "$INSTALL_DIR" log --oneline -1 2>/dev/null || echo "  (unknown)"
  echo ""

  info "Dashboard : https://${SERVER_HOST}:${DASHBOARD_PORT}"
  info "VPN       : ${SERVER_HOST}:${VPN_PORT}"
}

# ── Show update summary ───────────────────────────────────────────────────────
show_update_summary() {
  echo ""
  echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${GREEN}║         ✓  Update applied successfully!              ║${RESET}"
  echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "  ${BOLD}Running version${RESET} : $(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
  echo -e "  ${BOLD}Dashboard${RESET}       : ${CYAN}https://${SERVER_HOST}:${DASHBOARD_PORT}${RESET}"
  echo -e "  ${BOLD}VPN${RESET}             : ${SERVER_HOST}:${VPN_PORT}"
  echo ""
  echo -e "  ${BOLD}Useful commands${RESET}"
  echo -e "  ${INSTALL_DIR}/setup.sh --update    # update again next time"
  echo -e "  ${INSTALL_DIR}/setup.sh --status    # check service health"
  echo -e "  ${INSTALL_DIR}/setup.sh --diagnose  # full diagnostic"
  echo -e "  ${INSTALL_DIR}/setup.sh --rebuild   # force full image rebuild"
  echo -e "  cd ${INSTALL_DIR} && docker compose logs -f api"
  echo ""
}

# ── Uninstall helper ──────────────────────────────────────────────────────────
uninstall() {
  warn "This will stop all services and remove volumes (all data will be lost)!"
  ask "Type 'yes' to confirm:"
  read -r CONFIRM
  [ "$CONFIRM" = "yes" ] || { info "Aborted."; exit 0; }
  cd "$INSTALL_DIR"
  ${DOCKER_SUDO:-} docker compose down -v --remove-orphans
  # Step out before deleting — otherwise the shell's cwd becomes a ghost
  # directory and any subsequent command (including a fresh reinstall) will
  # fail with "getcwd: cannot access parent directories".
  cd /
  sudo rm -rf "$INSTALL_DIR"
  success "Uninstalled. Re-install with: bash <(curl -fsSL ${REPO_URL}/raw/master/setup.sh)"
  exit 0
}

# ── Docker Health Check ───────────────────────────────────────────────────────
# Called after every start_services / update / rebuild.
# Prints a status table; for any container that is not running+healthy it
# dumps the last 60 log lines so the operator knows exactly what went wrong.
check_docker_health() {
  step "Docker container health check"
  cd "$INSTALL_DIR"

  # Give containers a moment to settle after a compose up
  sleep 3

  local ALL_GOOD=true
  local FAILED_SVCS=()

  # Collect the list of services defined in this compose project
  local SERVICES
  SERVICES=$(${DOCKER_SUDO:-} docker compose ps --services 2>/dev/null || true)

  if [ -z "$SERVICES" ]; then
    warn "No services found in $INSTALL_DIR — is docker-compose.yml present?"
    return 1
  fi

  echo ""
  printf "  ${BOLD}%-20s %-14s %-12s${RESET}\n" "SERVICE" "STATE" "HEALTH"
  printf "  %-20s %-14s %-12s\n" "────────────────────" "──────────────" "────────────"

  while IFS= read -r svc; do
    [ -z "$svc" ] && continue

    local STATE HEALTH
    # --format flag supported by Compose v2 (json fallback for older)
    STATE=$(${DOCKER_SUDO:-} docker compose ps --format '{{.State}}' "$svc" 2>/dev/null \
            | head -1 || true)
    HEALTH=$(${DOCKER_SUDO:-} docker compose ps --format '{{.Health}}' "$svc" 2>/dev/null \
             | head -1 || true)
    STATE="${STATE:-unknown}"
    HEALTH="${HEALTH:--}"

    local COLOR
    if [ "$STATE" = "running" ] && [ "$HEALTH" != "unhealthy" ]; then
      COLOR="${GREEN}"
    elif [ "$STATE" = "running" ] && [ "$HEALTH" = "unhealthy" ]; then
      COLOR="${YELLOW}"
      FAILED_SVCS+=("$svc")
      ALL_GOOD=false
    else
      COLOR="${RED}"
      FAILED_SVCS+=("$svc")
      ALL_GOOD=false
    fi

    printf "  ${COLOR}%-20s %-14s %-12s${RESET}\n" "$svc" "$STATE" "$HEALTH"
  done <<< "$SERVICES"

  echo ""

  if [ "$ALL_GOOD" = true ]; then
    success "All containers are running and healthy"
    return 0
  fi

  echo -e "${YELLOW}[WARN]${RESET}  ${#FAILED_SVCS[@]} container(s) are not healthy: ${BOLD}${FAILED_SVCS[*]}${RESET}"
  echo ""

  for svc in "${FAILED_SVCS[@]}"; do
    echo -e "${BOLD}${RED}┌── Logs: $svc $(printf '─%.0s' {1..50})${RESET}"
    ${DOCKER_SUDO:-} docker compose logs --tail=60 --no-log-prefix --timestamps "$svc" 2>&1 \
      | sed 's/^/│ /' || true
    echo -e "${BOLD}${RED}└$(printf '─%.0s' {1..58})${RESET}"
    echo ""
  done

  warn "Tip: run  '${INSTALL_DIR}/setup.sh --diagnose'  for a full system check"
  return 1
}

# ── Full Diagnostic ───────────────────────────────────────────────────────────
diagnose() {
  step "ocs-vpnstack — Full System Diagnostic"
  local ISSUES=0

  # ── 1. Environment ──────────────────────────────────────────────────────────
  echo -e "\n${BOLD}[1/8] Environment${RESET}"
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    info "OS          : $PRETTY_NAME"
  fi
  info "Kernel      : $(uname -r)"
  info "Install dir : $INSTALL_DIR"
  info "Script date : $(stat -c '%y' "${BASH_SOURCE[0]}" 2>/dev/null | cut -d' ' -f1 || echo 'unknown')"

  if docker --version &>/dev/null; then
    info "Docker      : $(docker --version | awk '{print $3}' | tr -d ',')"
  else
    echo -e "${RED}[ERROR]${RESET} Docker not found"; ISSUES=$((ISSUES+1))
  fi
  if docker compose version &>/dev/null; then
    info "Compose     : $(docker compose version --short 2>/dev/null || docker compose version)"
  else
    echo -e "${RED}[ERROR]${RESET} Docker Compose not found"; ISSUES=$((ISSUES+1))
  fi

  # ── 2. State & Config files ─────────────────────────────────────────────────
  echo -e "\n${BOLD}[2/8] Configuration files${RESET}"
  if [ -f "$STATE_FILE" ]; then
    success ".setup-state found"
    . "$STATE_FILE"
    info "  VPN port   : ${SAVED_VPN_PORT:-?}"
    info "  Dashboard  : ${SAVED_DASHBOARD_PORT:-?}"
    info "  Host       : ${SAVED_SERVER_HOST:-?}"
    info "  Installed  : ${INSTALL_DATE:-?}"
    VPN_PORT="${SAVED_VPN_PORT:-443}"
    DASHBOARD_PORT="${SAVED_DASHBOARD_PORT:-8443}"
    SERVER_HOST="${SAVED_SERVER_HOST:-localhost}"
  else
    warn ".setup-state missing — port info unavailable"; ISSUES=$((ISSUES+1))
    VPN_PORT=443; DASHBOARD_PORT=8443; SERVER_HOST="localhost"
  fi

  if [ -f "$INSTALL_DIR/.env" ]; then
    success ".env found"
    # Check required keys
    for KEY in POSTGRES_PASSWORD SECRET_KEY; do
      if grep -q "^${KEY}=" "$INSTALL_DIR/.env"; then
        success "  $KEY present"
      else
        warn "  $KEY MISSING from .env"; ISSUES=$((ISSUES+1))
      fi
    done
  else
    echo -e "${RED}[ERROR]${RESET} .env missing — services cannot start"; ISSUES=$((ISSUES+1))
  fi

  # ── 3. Container status ─────────────────────────────────────────────────────
  echo -e "\n${BOLD}[3/8] Container status${RESET}"
  if [ -d "$INSTALL_DIR" ]; then
    cd "$INSTALL_DIR"
    local SERVICES
    SERVICES=$(${DOCKER_SUDO:-} docker compose ps --services 2>/dev/null || true)
    if [ -z "$SERVICES" ]; then
      warn "No services running"; ISSUES=$((ISSUES+1))
    else
      local FAILED_SVCS=()
      printf "  ${BOLD}%-20s %-14s %-12s %-6s${RESET}\n" "SERVICE" "STATE" "HEALTH" "RESTARTS"
      printf "  %-20s %-14s %-12s %-6s\n" "────────────────────" "──────────────" "────────────" "────────"
      while IFS= read -r svc; do
        [ -z "$svc" ] && continue
        local STATE HEALTH RESTARTS
        STATE=$(${DOCKER_SUDO:-} docker compose ps --format '{{.State}}'    "$svc" 2>/dev/null | head -1 || true)
        HEALTH=$(${DOCKER_SUDO:-} docker compose ps --format '{{.Health}}'   "$svc" 2>/dev/null | head -1 || true)
        # Restart count from docker inspect
        local CID
        CID=$(${DOCKER_SUDO:-} docker compose ps -q "$svc" 2>/dev/null | head -1 || true)
        RESTARTS="-"
        if [ -n "$CID" ]; then
          RESTARTS=$(docker inspect --format '{{.RestartCount}}' "$CID" 2>/dev/null || echo "-")
        fi
        STATE="${STATE:-unknown}"; HEALTH="${HEALTH:--}"
        local COLOR
        if [ "$STATE" = "running" ] && [ "$HEALTH" != "unhealthy" ]; then
          COLOR="${GREEN}"
        else
          COLOR="${RED}"; FAILED_SVCS+=("$svc"); ISSUES=$((ISSUES+1))
        fi
        printf "  ${COLOR}%-20s %-14s %-12s %-6s${RESET}\n" "$svc" "$STATE" "$HEALTH" "$RESTARTS"
      done <<< "$SERVICES"
      echo ""

      # Show logs for failed containers
      if [ ${#FAILED_SVCS[@]} -gt 0 ]; then
        warn "Failed/unhealthy: ${FAILED_SVCS[*]}"
        for svc in "${FAILED_SVCS[@]}"; do
          echo -e "\n${BOLD}${RED}┌── Last 60 log lines: $svc${RESET}"
          ${DOCKER_SUDO:-} docker compose logs --tail=60 --no-log-prefix --timestamps "$svc" 2>&1 \
            | sed 's/^/│ /' || true
          echo -e "${BOLD}${RED}└$(printf '─%.0s' {1..58})${RESET}"
        done
      fi
    fi
  else
    warn "Install dir $INSTALL_DIR not found"; ISSUES=$((ISSUES+1))
  fi

  # ── 4. Port availability ────────────────────────────────────────────────────
  echo -e "\n${BOLD}[4/8] Port listeners${RESET}"
  # Port 8000 is internal-only (not exposed to host); API is checked via nginx below.
  local CHECK_PORTS=("${VPN_PORT}:VPN(tcp)" "${VPN_PORT}:VPN(udp)" "${DASHBOARD_PORT}:Dashboard")
  for ENTRY in "${CHECK_PORTS[@]}"; do
    local PORT LABEL
    PORT="${ENTRY%%:*}"; LABEL="${ENTRY#*:}"
    if ss -tlnup 2>/dev/null | grep -q ":${PORT} \|:${PORT}$" || \
       netstat -tlnup 2>/dev/null | grep -q ":${PORT} "; then
      success "$LABEL  port $PORT is listening"
    else
      warn "$LABEL  port $PORT — nothing listening (container may still be starting)"; ISSUES=$((ISSUES+1))
    fi
  done

  # ── 5. Postgres connectivity ────────────────────────────────────────────────
  echo -e "\n${BOLD}[5/8] PostgreSQL${RESET}"
  local PG_CONTAINER
  PG_CONTAINER=$(${DOCKER_SUDO:-} docker compose ps -q postgres 2>/dev/null | head -1 || true)
  if [ -z "$PG_CONTAINER" ]; then
    warn "Postgres container not found"; ISSUES=$((ISSUES+1))
  else
    # Test local trust-auth socket connection
    if ${DOCKER_SUDO:-} docker exec "$PG_CONTAINER" \
        psql -U vpnuser -d vpndb -c "SELECT 1" &>/dev/null 2>&1; then
      success "Local socket connection OK (trust auth)"
    else
      warn "Local socket connection FAILED"; ISSUES=$((ISSUES+1))
    fi

    # Test that .env password actually authenticates
    if [ -f "$INSTALL_DIR/.env" ]; then
      local PG_PASS
      PG_PASS=$(grep ^POSTGRES_PASSWORD "$INSTALL_DIR/.env" | cut -d'=' -f2-)
      if ${DOCKER_SUDO:-} docker exec -e PGPASSWORD="$PG_PASS" "$PG_CONTAINER" \
          psql -U vpnuser -d vpndb -h 127.0.0.1 -c "SELECT 1" &>/dev/null 2>&1; then
        success ".env POSTGRES_PASSWORD authenticates over TCP"
      else
        warn ".env POSTGRES_PASSWORD does NOT match the running DB password"
        echo -e "  ${YELLOW}Fix:${RESET} docker exec $PG_CONTAINER psql -U vpnuser -d vpndb \\"
        echo    "       -c \"ALTER USER vpnuser WITH PASSWORD '\$(grep ^POSTGRES_PASSWORD $INSTALL_DIR/.env | cut -d= -f2-)';\""
        ISSUES=$((ISSUES+1))
      fi
    fi
  fi

  # ── 6. API health ───────────────────────────────────────────────────────────
  # Port 8000 is not exposed to the host — reach the API through the nginx proxy.
  echo -e "\n${BOLD}[6/8] API health endpoint${RESET}"
  local HTTP_CODE
  HTTP_CODE=$(curl -o /dev/null -w '%{http_code}' -fsSLk --max-time 5 \
              "https://127.0.0.1:${DASHBOARD_PORT:-8443}/api/healthz" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    success "API /healthz → HTTP 200 (via nginx proxy)"
  else
    warn "API /healthz → HTTP $HTTP_CODE (not reachable via nginx proxy)"; ISSUES=$((ISSUES+1))
  fi

  # ── 7. TLS certificate ──────────────────────────────────────────────────────
  echo -e "\n${BOLD}[7/8] TLS certificate${RESET}"
  local CERT_FILE="$INSTALL_DIR/nginx/certs/server.crt"
  if [ -f "$CERT_FILE" ]; then
    local EXPIRY DAYS_LEFT
    EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_FILE" 2>/dev/null | cut -d= -f2 || echo "")
    if [ -n "$EXPIRY" ]; then
      # Calculate days remaining (POSIX-friendly)
      local EXP_EPOCH NOW_EPOCH
      EXP_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$EXPIRY" +%s 2>/dev/null || echo 0)
      NOW_EPOCH=$(date +%s)
      DAYS_LEFT=$(( (EXP_EPOCH - NOW_EPOCH) / 86400 ))
      if [ "$DAYS_LEFT" -gt 30 ]; then
        success "Certificate expires in ${DAYS_LEFT} days ($EXPIRY)"
      elif [ "$DAYS_LEFT" -gt 0 ]; then
        warn "Certificate expires SOON: ${DAYS_LEFT} days ($EXPIRY)"; ISSUES=$((ISSUES+1))
      else
        echo -e "${RED}[ERROR]${RESET} Certificate EXPIRED ($EXPIRY)"; ISSUES=$((ISSUES+1))
      fi
    else
      warn "Could not read certificate expiry"
    fi
  else
    warn "Certificate not found at $CERT_FILE"; ISSUES=$((ISSUES+1))
  fi

  # ── 8. Disk space ───────────────────────────────────────────────────────────
  echo -e "\n${BOLD}[8/8] Disk space${RESET}"
  local DISK_USE DISK_AVAIL
  DISK_USE=$(df -h "$INSTALL_DIR" 2>/dev/null | awk 'NR==2{print $5}' || echo "?")
  DISK_AVAIL=$(df -h "$INSTALL_DIR" 2>/dev/null | awk 'NR==2{print $4}' || echo "?")
  info "Volume $(df -h "$INSTALL_DIR" 2>/dev/null | awk 'NR==2{print $1}') — used: $DISK_USE  available: $DISK_AVAIL"
  # Warn if >90%
  local DISK_PCT
  DISK_PCT=$(echo "$DISK_USE" | tr -d '%')
  if [ -n "$DISK_PCT" ] && [ "$DISK_PCT" -ge 90 ] 2>/dev/null; then
    warn "Disk usage is critically high ($DISK_USE used)"; ISSUES=$((ISSUES+1))
  fi
  # Docker volumes summary
  local DOCKER_VOL_SIZE
  DOCKER_VOL_SIZE=$(docker system df 2>/dev/null | awk '/Volumes/{print $3" used, "$4" reclaimable"}' || echo "unknown")
  info "Docker volumes: $DOCKER_VOL_SIZE"

  # ── Summary ─────────────────────────────────────────────────────────────────
  echo ""
  echo -e "${BOLD}────────────────────────────────────────────────────────────${RESET}"
  if [ "$ISSUES" -eq 0 ]; then
    echo -e "${BOLD}${GREEN}  Diagnostic passed — no issues found${RESET}"
  else
    echo -e "${BOLD}${RED}  Diagnostic found ${ISSUES} issue(s) — review the WARNs/ERRORs above${RESET}"
  fi
  echo -e "${BOLD}────────────────────────────────────────────────────────────${RESET}"
  echo ""
  info "Dashboard : https://${SERVER_HOST}:${DASHBOARD_PORT}"
  info "VPN       : ${SERVER_HOST}:${VPN_PORT}"
  echo ""
}

# ── Firewall helper ───────────────────────────────────────────────────────────
open_firewall() {
  step "Opening firewall ports (best-effort)"
  if command -v ufw &>/dev/null; then
    sudo ufw allow "${VPN_PORT}/tcp" &>/dev/null || true
    sudo ufw allow "${VPN_PORT}/udp" &>/dev/null || true
    sudo ufw allow "${DASHBOARD_PORT}/tcp" &>/dev/null || true
    sudo ufw allow 80/tcp &>/dev/null || true
    info "ufw rules added"
  elif command -v firewall-cmd &>/dev/null; then
    sudo firewall-cmd --permanent --add-port="${VPN_PORT}/tcp" &>/dev/null || true
    sudo firewall-cmd --permanent --add-port="${VPN_PORT}/udp" &>/dev/null || true
    sudo firewall-cmd --permanent --add-port="${DASHBOARD_PORT}/tcp" &>/dev/null || true
    sudo firewall-cmd --permanent --add-port=80/tcp &>/dev/null || true
    sudo firewall-cmd --reload &>/dev/null || true
    info "firewalld rules added"
  else
    info "No ufw/firewalld detected — please open ports ${VPN_PORT} and ${DASHBOARD_PORT} manually in your cloud firewall / security group."
  fi
}

# ── Argument handling ─────────────────────────────────────────────────────────
DOCKER_SUDO=""

case "${1:-}" in
  --update|-U)
    banner
    require_root_or_sudo
    update
    exit 0
    ;;
  --rebuild|-r)
    banner
    require_root_or_sudo
    rebuild
    exit 0
    ;;
  --status|-s)
    banner
    require_root_or_sudo
    status
    exit 0
    ;;
  --diagnose|-d)
    banner
    require_root_or_sudo
    diagnose
    exit 0
    ;;
  --uninstall|-u)
    banner
    require_root_or_sudo
    uninstall
    ;;
  --help|-h)
    echo ""
    echo -e "${BOLD}Usage:${RESET}  bash setup.sh [OPTION]"
    echo ""
    echo -e "  ${BOLD}(no args)${RESET}          Fresh install — interactive prompts"
    echo -e "  ${BOLD}--update,   -U${RESET}     Pull latest code and rebuild changed services"
    echo -e "  ${BOLD}--rebuild,  -r${RESET}     Force full Docker image rebuild (no code pull)"
    echo -e "  ${BOLD}--status,   -s${RESET}     Show service health and recent logs"
    echo -e "  ${BOLD}--diagnose, -d${RESET}     Full system diagnostic (ports, DB, TLS, disk, container logs)"
    echo -e "  ${BOLD}--uninstall,-u${RESET}     Remove all containers, volumes, and files"
    echo -e "  ${BOLD}--help,     -h${RESET}     Show this help"
    echo ""
    echo -e "${BOLD}Environment variables:${RESET}"
    echo -e "  INSTALL_DIR   Installation path (default: /opt/ocs-vpnstack)"
    echo ""
    echo -e "${BOLD}Examples:${RESET}"
    echo -e "  # Fresh install"
    echo -e "  bash <(curl -fsSL https://raw.githubusercontent.com/tahasaifeee/ocs-vpnstack/master/setup.sh)"
    echo ""
    echo -e "  # Update an existing install"
    echo -e "  bash /opt/ocs-vpnstack/setup.sh --update"
    echo ""
    echo -e "  # Diagnose a broken installation"
    echo -e "  bash /opt/ocs-vpnstack/setup.sh --diagnose"
    echo ""
    echo -e "  # Custom install directory"
    echo -e "  INSTALL_DIR=/srv/vpn bash <(curl -fsSL https://raw.githubusercontent.com/tahasaifeee/ocs-vpnstack/master/setup.sh)"
    echo ""
    exit 0
    ;;
esac

# ── Main flow ─────────────────────────────────────────────────────────────────
banner
require_root_or_sudo

# Guard: detect an existing installation and refuse a destructive re-run.
# Running the plain install flow a second time would overwrite .env with a
# freshly generated POSTGRES_PASSWORD while the postgres volume still holds the
# old password, permanently breaking the API connection.
if [ -f "$STATE_FILE" ] || [ -f "$INSTALL_DIR/.env" ]; then
  echo ""
  echo -e "${BOLD}${YELLOW}⚠  Existing installation detected at $INSTALL_DIR${RESET}"
  echo ""
  echo -e "  Running a fresh install would overwrite ${BOLD}.env${RESET} with new random"
  echo -e "  credentials while the postgres data volume keeps the old ones,"
  echo -e "  permanently breaking the database connection."
  echo ""
  echo -e "  ${BOLD}Use one of these instead:${RESET}"
  echo -e "  $INSTALL_DIR/setup.sh ${CYAN}--update${RESET}     # pull latest code & rebuild"
  echo -e "  $INSTALL_DIR/setup.sh ${CYAN}--rebuild${RESET}    # force full image rebuild"
  echo -e "  $INSTALL_DIR/setup.sh ${CYAN}--status${RESET}     # check service health"
  echo -e "  $INSTALL_DIR/setup.sh ${CYAN}--uninstall${RESET}  # remove everything, then reinstall"
  echo ""
  exit 1
fi

detect_os
install_basics
install_docker
install_compose
setup_repo
collect_config
generate_certs
write_env
patch_compose
save_state
start_services
wait_for_api
set_admin_password
open_firewall
show_summary
check_docker_health || true
