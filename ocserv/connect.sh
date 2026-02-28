#!/bin/bash
# Called by ocserv when a client connects
# Environment variables available:
#   USERNAME, DEVICE, IP_REAL, IP_LOCAL, IP_REMOTE, ID

logger -t ocserv-connect "User $USERNAME connected from $IP_REAL, assigned $IP_LOCAL"

# Enable NAT for the VPN subnet (read from config so it matches any custom pool)
VPN_SUBNET=$(awk -F'=' '/^ipv4-network[[:space:]]*=/{gsub(/ /,"",$2); print $2}' /etc/ocserv/ocserv.conf 2>/dev/null)
VPN_SUBNET="${VPN_SUBNET:-172.16.0.0/16}"

# Add rules only if they don't already exist — prevents accumulation on repeated connects
iptables -t nat -C POSTROUTING -s "$VPN_SUBNET" -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s "$VPN_SUBNET" -j MASQUERADE 2>/dev/null || true
iptables -C FORWARD -s "$VPN_SUBNET" -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -s "$VPN_SUBNET" -j ACCEPT 2>/dev/null || true
iptables -C FORWARD -d "$VPN_SUBNET" -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -d "$VPN_SUBNET" -j ACCEPT 2>/dev/null || true

# Notify the API about the connect event (best-effort)
curl -sf -X POST "http://api:8000/internal/events/connect" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"ip_real\":\"$IP_REAL\",\"ip_local\":\"$IP_LOCAL\",\"device\":\"$DEVICE\"}" \
  >/dev/null 2>&1 || true

exit 0
