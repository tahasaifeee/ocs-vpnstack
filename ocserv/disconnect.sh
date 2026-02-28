#!/bin/bash
# Called by ocserv when a client disconnects
# Extra env vars: REASON, STATS_BYTES_IN, STATS_BYTES_OUT, STATS_DURATION

logger -t ocserv-disconnect "User $USERNAME disconnected. RX=${STATS_BYTES_IN} TX=${STATS_BYTES_OUT} duration=${STATS_DURATION}s"

# Notify the API about the disconnect event (best-effort)
# Use printf to safely escape any special characters in string fields
PAYLOAD=$(printf '{"username":"%s","ip_real":"%s","ip_local":"%s","bytes_in":%d,"bytes_out":%d,"duration":%d,"reason":"%s"}' \
  "${USERNAME}" "${IP_REAL}" "${IP_LOCAL}" \
  "${STATS_BYTES_IN:-0}" "${STATS_BYTES_OUT:-0}" "${STATS_DURATION:-0}" \
  "${REASON//\"/\\\"}")
curl -sf -X POST "http://api:8000/internal/events/disconnect" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  >/dev/null 2>&1 || true

exit 0
