#!/usr/bin/env bash
# ============================================================
# NOVA TV — start a local Psiphon tunnel (residential exit IP)
# ------------------------------------------------------------
# The Oscar TV API answers datacenter/cloud IPs (GitHub Actions,
# Render, AWS ...) with an EMPTY payload. Psiphon gives us a
# residential exit IP so the updater can fetch the REAL data.
#
# Usage:  bash tools/start-psiphon.sh
#   -> starts psiphon-tunnel-core in the background and waits
#      until the local HTTP proxy (127.0.0.1:18080) is ready.
# ============================================================
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$DIR/psiphon-tunnel-core"
CFG="$DIR/psiphon.config.json"
LOG="${PSIPHON_LOG:-/tmp/psiphon.log}"

if [ ! -x "$BIN" ]; then
  echo "psiphon binary not found or not executable: $BIN" >&2
  exit 1
fi

echo "starting Psiphon tunnel ..."
nohup "$BIN" -config "$CFG" > "$LOG" 2>&1 &
PSI_PID=$!
echo "psiphon pid=$PSI_PID  log=$LOG"

# Wait up to ~120s for the local HTTP proxy port to accept connections.
for i in $(seq 1 60); do
  if (exec 3<>/dev/tcp/127.0.0.1/18080) 2>/dev/null; then
    exec 3>&- 2>/dev/null || true
    echo "Psiphon HTTP proxy is up on 127.0.0.1:18080"
    # sanity check: can we reach the internet through it?
    if curl -s -m 20 -x http://127.0.0.1:18080 https://api.ipify.org >/dev/null 2>&1; then
      echo "proxy egress OK -> $(curl -s -m 20 -x http://127.0.0.1:18080 https://api.ipify.org || echo '?')"
    else
      echo "warning: proxy port is open but egress check failed (continuing anyway)"
    fi
    exit 0
  fi
  sleep 2
done

echo "warning: Psiphon proxy did not come up in time; tailing log:" >&2
tail -n 40 "$LOG" >&2 || true
exit 0
