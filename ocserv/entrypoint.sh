#!/bin/sh
set -e

# Preserve ocserv.conf if it already exists (may contain dashboard-managed settings).
# Scripts are always refreshed from the image so hook changes propagate on restart.
[ -f /etc/ocserv/ocserv.conf ] || cp /opt/ocserv-defaults/ocserv.conf /etc/ocserv/ocserv.conf

# Migration: ensure server-cert/server-key lines exist (absent in configs written
# before this was added — old named volume from a prior install).
if ! grep -q '^server-cert' /etc/ocserv/ocserv.conf; then
    printf '\n# TLS certificates (auto-added by entrypoint migration)\nserver-cert = /etc/ocserv/server.crt\nserver-key  = /etc/ocserv/server.key\n' \
        >> /etc/ocserv/ocserv.conf
fi
cp /opt/ocserv-defaults/connect.sh   /etc/ocserv/connect.sh
cp /opt/ocserv-defaults/disconnect.sh /etc/ocserv/disconnect.sh
chmod +x /etc/ocserv/connect.sh /etc/ocserv/disconnect.sh

# Ensure required dirs exist (volume mount may be fresh)
mkdir -p /etc/ocserv/conf.d /etc/ocserv/user-routes /run/ocserv

# ocserv plain-auth requires both files to exist (even if empty) before it
# will initialise its auth module and create the control socket.
[ -f /etc/ocserv/ocpasswd   ] || touch /etc/ocserv/ocpasswd
[ -f /etc/ocserv/users.oath ] || touch /etc/ocserv/users.oath

# Generate self-signed cert on first start (or if wiped)
if [ ! -f /etc/ocserv/server.crt ]; then
    certtool --generate-privkey --outfile /etc/ocserv/server.key
    printf 'cn = "VPN Server"\norganization = "VPN"\nserial = 1\nexpiration_days = 3650\nsigning_key\ntls_www_server\n' \
        > /tmp/cert.cfg
    certtool --generate-self-signed \
        --load-privkey /etc/ocserv/server.key \
        --outfile /etc/ocserv/server.crt \
        --template /tmp/cert.cfg
    rm -f /tmp/cert.cfg
fi

exec ocserv --foreground --config /etc/ocserv/ocserv.conf
