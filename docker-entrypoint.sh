#!/bin/sh
set -e

CONFIG_FILE="${DKG_HOME:-/data}/config.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "[entrypoint] No config.json found at $CONFIG_FILE — generating from environment variables..."

  NODE_NAME="${DKG_NODE_NAME:-dkg-node}"
  API_PORT="${DKG_API_PORT:-9200}"
  API_HOST="${DKG_API_HOST:-0.0.0.0}"
  LISTEN_PORT="${DKG_LISTEN_PORT:-0}"
  NODE_ROLE="${DKG_NODE_ROLE:-edge}"
  RELAY="${DKG_RELAY:-}"
  CHAIN_RPC="${DKG_CHAIN_RPC_URL:-https://sepolia.base.org}"
  CHAIN_HUB="${DKG_CHAIN_HUB_ADDRESS:-0xC056e67Da4F51377Ad1B01f50F655fFdcCD809F6}"
  CHAIN_ID="${DKG_CHAIN_ID:-base:84532}"

  RELAY_LINE=""
  if [ -n "$RELAY" ]; then
    RELAY_LINE="\"relay\": \"$RELAY\","
  fi

  mkdir -p "$(dirname "$CONFIG_FILE")"

  cat > "$CONFIG_FILE" <<EOF
{
  "name": "$NODE_NAME",
  "apiPort": $API_PORT,
  "apiHost": "$API_HOST",
  "listenPort": $LISTEN_PORT,
  "nodeRole": "$NODE_ROLE",
  $RELAY_LINE
  "paranets": ["testing", "origin-trail-game"],
  "chain": {
    "type": "evm",
    "rpcUrl": "$CHAIN_RPC",
    "hubAddress": "$CHAIN_HUB",
    "chainId": "$CHAIN_ID"
  },
  "auth": {
    "enabled": true
  }
}
EOF

  echo "[entrypoint] Config written to $CONFIG_FILE"
fi

exec node /app/packages/cli/dist/cli.js start --foreground
