#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required for Sync Latest Episode. Install Node.js or run the GitHub Action workflow."
  exit 1
fi
echo "Scanning Art Smart & Who ARTed RSS feeds for new short episodes..."
node scripts/feed-agent.mjs
