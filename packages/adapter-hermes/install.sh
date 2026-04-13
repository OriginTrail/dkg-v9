#!/bin/bash
# ============================================================================
# DKG Hermes Adapter — Install Script
#
# Creates a symlink from the Hermes Agent's plugin directory to this adapter's
# Python plugin, so Hermes discovers the DKG memory provider automatically.
#
# Usage:
#   cd packages/adapter-hermes
#   ./install.sh [path-to-hermes-agent]
#
# If no path is given, auto-detects from `which hermes` or common locations.
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_SRC="$SCRIPT_DIR/hermes-plugin"

# Verify source exists
if [ ! -f "$PLUGIN_SRC/__init__.py" ]; then
  echo "Error: hermes-plugin/ directory not found at $PLUGIN_SRC"
  echo "Run this script from packages/adapter-hermes/"
  exit 1
fi

# ── Find Hermes Agent installation ──────────────────────────────────────────

HERMES_DIR=""

# Option 1: User provided path
if [ -n "$1" ]; then
  HERMES_DIR="$1"
fi

# Option 2: Auto-detect from `which hermes`
if [ -z "$HERMES_DIR" ] && command -v hermes &>/dev/null; then
  HERMES_BIN="$(which hermes)"
  # Follow symlinks to find the real location
  if [ -L "$HERMES_BIN" ]; then
    HERMES_BIN="$(readlink -f "$HERMES_BIN" 2>/dev/null || readlink "$HERMES_BIN")"
  fi
  # Walk up to find the repo root (look for plugins/memory/)
  CANDIDATE="$(dirname "$(dirname "$HERMES_BIN")")"
  if [ -d "$CANDIDATE/plugins/memory" ]; then
    HERMES_DIR="$CANDIDATE"
  fi
fi

# Option 3: Common locations
for CANDIDATE in \
  "$HOME/.hermes/hermes-agent" \
  "$HOME/hermes-agent" \
  "../../../hermes-agent" \
  "../../hermes-agent" \
  ; do
  if [ -z "$HERMES_DIR" ] && [ -d "$CANDIDATE/plugins/memory" ]; then
    HERMES_DIR="$(cd "$CANDIDATE" && pwd)"
  fi
done

if [ -z "$HERMES_DIR" ] || [ ! -d "$HERMES_DIR/plugins/memory" ]; then
  echo "Error: Could not find Hermes Agent installation."
  echo ""
  echo "Usage: ./install.sh /path/to/hermes-agent"
  echo ""
  echo "The path should contain a plugins/memory/ directory."
  exit 1
fi

PLUGIN_TARGET="$HERMES_DIR/plugins/memory/dkg"

echo "DKG Hermes Adapter Installer"
echo "============================"
echo ""
echo "  Source:  $PLUGIN_SRC"
echo "  Target:  $PLUGIN_TARGET"
echo ""

# ── Create symlink ──────────────────────────────────────────────────────────

if [ -L "$PLUGIN_TARGET" ]; then
  echo "  Existing symlink found — replacing..."
  rm "$PLUGIN_TARGET"
elif [ -d "$PLUGIN_TARGET" ]; then
  echo "  Warning: $PLUGIN_TARGET is a regular directory."
  echo "  Moving to $PLUGIN_TARGET.bak"
  mv "$PLUGIN_TARGET" "$PLUGIN_TARGET.bak"
fi

ln -sfn "$PLUGIN_SRC" "$PLUGIN_TARGET"

# ── Verify ──────────────────────────────────────────────────────────────────

if [ -L "$PLUGIN_TARGET" ] && [ -f "$PLUGIN_TARGET/__init__.py" ]; then
  echo "  Symlink created successfully."
else
  echo "  Error: Symlink verification failed."
  exit 1
fi

# ── Daemon-side adapter setup ───────────────────────────────────────────────
# The TypeScript daemon adapter serves /api/hermes/* routes. When running
# the DKG node from the monorepo, these routes are already available.
# For standalone installs, register the adapter with the running daemon.

echo ""
echo "Registering daemon-side adapter…"
DKG_HOME="${DKG_HOME:-$HOME/.dkg}"
TOKEN_FILE="$DKG_HOME/auth.token"
DAEMON_URL="${DKG_DAEMON_URL:-http://127.0.0.1:9200}"

AUTH_HEADER=""
if [ -f "$TOKEN_FILE" ]; then
  AUTH_TOKEN=$(grep -v '^#' "$TOKEN_FILE" | head -n1 | tr -d '[:space:]')
  if [ -n "$AUTH_TOKEN" ]; then
    AUTH_HEADER="Authorization: Bearer $AUTH_TOKEN"
  fi
fi

REG_RESP=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$DAEMON_URL/api/register-adapter" \
  -H "Content-Type: application/json" \
  ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
  -d '{"id":"hermes","framework":"hermes-agent"}' 2>/dev/null || true)

if [ "$REG_RESP" = "200" ] || [ "$REG_RESP" = "204" ]; then
  echo "  Daemon adapter registered."
elif [ "$REG_RESP" = "000" ]; then
  echo "  Daemon not reachable at $DAEMON_URL — adapter will register on first connect."
else
  echo "  Daemon returned HTTP $REG_RESP — adapter may need manual registration."
fi

echo ""
echo "Next steps:"
echo "  1. Run: hermes memory setup"
echo "  2. Select 'dkg' from the provider list"
echo "  3. Enter your DKG daemon URL (default: http://127.0.0.1:9200)"
echo ""
echo "  Or set directly in config.yaml:"
echo "    memory:"
echo "      provider: dkg"
echo ""
echo "  The DKG daemon must be running (dkg start) for full functionality."
echo "  If the daemon is not available, the plugin falls back to local cache."
