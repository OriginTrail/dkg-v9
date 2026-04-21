#!/usr/bin/env bash
# Install agent-scope git hooks into .git/hooks/.
#
# Idempotent: if a hook with a different name already exists, we preserve it
# and only chain the agent-scope checks on top.

set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

hooks_src="$repo_root/agent-scope/hooks"
hooks_dst="$repo_root/.git/hooks"

if [[ ! -d "$hooks_dst" ]]; then
  echo "error: $hooks_dst not found (is this a git repo?)" >&2
  exit 1
fi

install_hook() {
  local name="$1"
  local src="$hooks_src/$name"
  local dst="$hooks_dst/$name"

  if [[ ! -f "$src" ]]; then
    echo "skip: $name (no source)" >&2
    return
  fi

  if [[ -f "$dst" ]] && ! grep -q 'agent-scope' "$dst" 2>/dev/null; then
    # Existing non-agent-scope hook — back it up and chain.
    cp "$dst" "$dst.pre-agent-scope.bak"
    cat > "$dst" <<EOF
#!/usr/bin/env bash
# Composite hook created by agent-scope installer.
# Runs the pre-existing hook (backed up to $(basename "$dst").pre-agent-scope.bak)
# followed by the agent-scope check.
set -e
"\$(dirname "\$0")/$(basename "$dst").pre-agent-scope.bak" "\$@"
exec "$src" "\$@"
EOF
  else
    cp "$src" "$dst"
  fi
  chmod +x "$dst"
  echo "installed: $dst"
}

install_hook pre-commit

echo ""
echo "Done. To skip an emergency commit (leaves an audit trail):"
echo "  AGENT_SCOPE_SKIP=1 git commit ..."
