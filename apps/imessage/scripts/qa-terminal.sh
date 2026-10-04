#!/usr/bin/env bash
# Phase 2 acceptance: the brief's 10 scripted questions through the terminal provider (non-TTY),
# against thermal-reserve-dev. Needs ANTHROPIC_API_KEY. Link code comes from `npm run codes`.
# Usage: scripts/qa-terminal.sh <LINKCODE>   (run a dev scenario first, e.g. spike/drive-dev.ts)
set -euo pipefail
cd "$(dirname "$0")/.."
CODE="${1:?link code}"
GAP="${QA_GAP_S:-12}"
{
  echo "Link my home $CODE"; sleep 3
  for q in \
    "why now?" \
    "how cold will it get?" \
    "why not yesterday?" \
    "how much have I saved?" \
    "what if 50,000 homes did this?" \
    "is this real?" \
    "what's your favorite movie?" \
    "it's too cold in here" \
    "thanks" \
    "STOP"; do
    echo "$q"; sleep "$GAP"
  done
} | CHAT_DEMO=1 npx tsx --env-file=.env src/main.terminal.ts
