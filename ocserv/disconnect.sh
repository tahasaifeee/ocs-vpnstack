#!/bin/bash
# Called by ocserv when a client disconnects
# Extra env vars: REASON, STATS_BYTES_IN, STATS_BYTES_OUT, STATS_DURATION

logger -t ocserv-disconnect "User $USERNAME disconnected. RX=${STATS_BYTES_IN} TX=${STATS_BYTES_OUT} duration=${STATS_DURATION}s"

# Notify the API about the disconnect event (best-effort)
curl -sf -X POST "http://api:8000/internal/events/disconnect" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"ip_real\":\"$IP_REAL\",\"ip_local\":\"$IP_LOCAL\",\"bytes_in\":${STATS_BYTES_IN:-0},\"bytes_out\":${STATS_BYTES_OUT:-0},\"duration\":${STATS_DURATION:-0},\"reason\":\"$REASON\"}" \
  >/dev/null 2>&1 || true

exit 0
