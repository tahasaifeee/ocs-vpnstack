#!/bin/bash
# Called by ocserv when a client connects
# Environment variables available:
#   USERNAME, DEVICE, IP_REAL, IP_LOCAL, IP_REMOTE, ID

logger -t ocserv-connect "User $USERNAME connected from $IP_REAL, assigned $IP_LOCAL"

# Enable NAT for the VPN subnet
iptables -t nat -A POSTROUTING -s 172.16.0.0/16 -j MASQUERADE 2>/dev/null || true
iptables -A FORWARD -s 172.16.0.0/16 -j ACCEPT 2>/dev/null || true
iptables -A FORWARD -d 172.16.0.0/16 -j ACCEPT 2>/dev/null || true

# Notify the API about the connect event (best-effort)
curl -sf -X POST "http://api:8000/internal/events/connect" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"ip_real\":\"$IP_REAL\",\"ip_local\":\"$IP_LOCAL\",\"device\":\"$DEVICE\"}" \
  >/dev/null 2>&1 || true

exit 0
