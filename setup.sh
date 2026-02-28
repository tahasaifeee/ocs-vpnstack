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
INSTALL_DATE=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
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
  local MAX=60 COUNT=0
  while [ $COUNT -lt $MAX ]; do
    if curl -fsSL --max-time 3 "http://127.0.0.1:8000/healthz" &>/dev/null; then
      success "API is up"
      return
    fi
    COUNT=$((COUNT + 2))
    printf "\r  Waiting… %ds / %ds" "$COUNT" "$MAX"
    sleep 2
  done
  echo ""
  warn "API did not respond within ${MAX}s — check logs with: docker compose -f $INSTALL_DIR/docker-compose.yml logs api"
}

# ── Change Default Admin Password ─────────────────────────────────────────────
set_admin_password() {
  step "Configuring dashboard admin account"
  # The API seeds 'admin'/'admin' on first boot. We update it via the REST API.
  local TOKEN
  TOKEN=$(curl -fsSL -X POST "http://127.0.0.1:8000/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin"}' 2>/dev/null | \
    grep -o '"access_token":"[^"]*"' | cut -d'"' -f4) || true

  if [ -z "$TOKEN" ]; then
    warn "Could not authenticate as default admin to change password — you may need to do this manually."
    return
  fi

  # If admin username is not 'admin', we can't rename via API (not implemented).
  # We will just update the password.
  curl -fsSL -X PATCH "http://127.0.0.1:8000/users" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"${ADMIN_PASS}\"}" &>/dev/null || true

  # Best-effort direct DB update via docker exec
  ${DOCKER_SUDO:-} docker compose -f "$INSTALL_DIR/docker-compose.yml" exec -T postgres \
    psql -U vpnuser -d vpndb -c \
    "UPDATE admin_users SET username='${ADMIN_USER}', hashed_password=crypt('${ADMIN_PASS}', gen_salt('bf')) WHERE username='admin';" \
    &>/dev/null 2>&1 || true

  success "Admin account configured (user: ${ADMIN_USER})"
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
  echo "LAST_UPDATE=$(date -u +"%Y-%m-%d %H:%M:%S UTC")" >> "$STATE_FILE"
  echo "LAST_COMMIT=$(git rev-parse --short HEAD)"        >> "$STATE_FILE"

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
  sudo rm -rf "$INSTALL_DIR"
  success "Uninstalled. Goodbye!"
  exit 0
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
    echo -e "  ${BOLD}--update,  -U${RESET}      Pull latest code and rebuild changed services"
    echo -e "  ${BOLD}--rebuild, -r${RESET}      Force full Docker image rebuild (no code pull)"
    echo -e "  ${BOLD}--status,  -s${RESET}      Show service health and recent logs"
    echo -e "  ${BOLD}--uninstall,-u${RESET}     Remove all containers, volumes, and files"
    echo -e "  ${BOLD}--help,    -h${RESET}      Show this help"
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
    echo -e "  # Custom install directory"
    echo -e "  INSTALL_DIR=/srv/vpn bash <(curl -fsSL https://raw.githubusercontent.com/tahasaifeee/ocs-vpnstack/master/setup.sh)"
    echo ""
    exit 0
    ;;
esac

# ── Main flow ─────────────────────────────────────────────────────────────────
banner
require_root_or_sudo
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
