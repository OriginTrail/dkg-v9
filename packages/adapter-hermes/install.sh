#!/bin/bash
# Compatibility wrapper for older Hermes adapter setup notes.
#
# Hermes provider installation is now profile-managed by the DKG CLI:
#
#   dkg hermes setup [options]
#
# That command installs the provider into $HERMES_HOME/plugins/dkg, writes
# ownership markers, preserves conflicting Hermes memory providers, and registers
# the Hermes local-agent integration with the DKG daemon when reachable.

set -euo pipefail

echo "DKG Hermes Adapter setup is managed by: dkg hermes setup"
echo ""

if command -v dkg >/dev/null 2>&1; then
  exec dkg hermes setup "$@"
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if command -v pnpm >/dev/null 2>&1 && [ -f "$REPO_ROOT/pnpm-workspace.yaml" ]; then
  cd "$REPO_ROOT"
  exec pnpm --filter @origintrail-official/dkg exec dkg hermes setup "$@"
fi

echo "Could not find the DKG CLI."
echo "Build or install the CLI, then run: dkg hermes setup [options]"
exit 1
