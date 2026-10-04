#!/usr/bin/env bash
# Presentation launcher: runs the companion on production, restarts it if it ever exits, and
# keeps the laptop from sleeping while it runs. Start detached so closing the terminal is safe:
#   setsid nohup apps/imessage/scripts/demo-run.sh >/dev/null 2>&1 &
# Stop:  pkill -f demo-run.sh; pkill -f main.imessage.ts
# Log:   apps/imessage/data/companion.log   (agent screen: http://127.0.0.1:8787/)
set -u
APP="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$APP/data/companion.log"
mkdir -p "$APP/data"
cd "$APP"
export STDB_DB="${STDB_DB:-thermal-reserve}" CHAT_DEMO="${CHAT_DEMO:-1}" CHAT_ONBOARD="${CHAT_ONBOARD:-1}" CHAT_LLM="${CHAT_LLM:-gemini}"
exec systemd-inhibit --what=sleep:idle:handle-lid-switch --who="BoreaFlux iMessage companion" --why="Live demo" --mode=block \
  bash -c '
    while true; do
      echo "$(date -u +%T) [launcher] starting companion ($CHAT_LLM, $STDB_DB)" >> "'"$LOG"'"
      node --env-file="'"$APP"'/.env" --import tsx "'"$APP"'/src/main.imessage.ts" >> "'"$LOG"'" 2>&1
      echo "$(date -u +%T) [launcher] companion exited ($?); restarting in 5 s" >> "'"$LOG"'"
      sleep 5
    done'
