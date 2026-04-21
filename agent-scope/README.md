# agent-scope

Task-scoped write permissions for AI coding agents.

An agent can **read** the whole repo, but can only **write** files that are
listed in the active task's manifest. Attempts to write out-of-scope files are
blocked by Cursor hooks, git pre-commit, and CI — and must be explicitly
approved by a human (by editing the manifest).

## Opt-in by default

agent-scope stays **invisible** until you engage it. With no active task and
no bootstrap, Cursor sessions behave as if the system didn't exist: the
session-start hook emits nothing, and the write/shell hooks only fire on the
hardcoded protected paths (the guard's own files). You can do ad-hoc work
without any task ceremony.

You engage the system in one of three ways:

1. **Guided onboarding** — run `pnpm task start`. The CLI prints a line you
   paste into your Cursor chat. The agent then asks you to describe the task,
   explores the codebase, proposes a scope via AskQuestion, and prints the
   exact `pnpm task create` command for you to run.
2. **Explicit** — `pnpm task set <existing-id>` activates a manifest you
   already have.
3. **Direct** — `pnpm task create <id> --description "..." --allowed "..." --activate`
   builds + activates a manifest in one shot.

Clearing the active task (`pnpm task clear`) returns Cursor to its invisible
default.

## Architecture (defense in depth)

```
Agent  → Cursor sessionStart hook       → injects active-task context (silent when idle)
Agent  → Cursor preToolUse hook         → blocks out-of-scope Write/Edit/Delete
Agent  → Cursor beforeShellExecution    → blocks destructive shell cmds on denied paths
Agent  → Cursor afterShellExecution     → reverts out-of-scope shell writes
System → hardcoded protected paths      → always blocks writes to agent-scope itself
Dev    → git pre-commit hook            → blocks local commits of out-of-scope files
CI     → GitHub Actions                 → blocks PRs with out-of-scope diffs
Ops    → optional webhook sink          → forwards denials to DKG/Slack/etc.
```

All layers use the same library (`agent-scope/lib/scope.mjs`) and the same
manifests (`agent-scope/tasks/*.json`). No layer is optional — bypassing one
(e.g. Cursor's hook) still leaves the commit, PR, and review layers.

## Concepts

| Concept | File | Description |
|---|---|---|
| **Task manifest** | `agent-scope/tasks/<id>.json` | Declares what files a task is allowed to modify |
| **JSON schema** | `agent-scope/schema/task.schema.json` | Validates manifest structure |
| **Active task** | `agent-scope/active` | One-line file with the active task id (gitignored, per-developer) |
| **Env override** | `AGENT_SCOPE_TASK` | If set, takes precedence over the file |
| **Branch convention** | `task/<id>/*` or `agent-scope/<id>/*` | Branch name auto-detects the task if the env/file is unset |
| **Git config fallback** | `git config agent-scope.task <id>` | Lowest-priority fallback |
| **Denial log** | `agent-scope/logs/denials.jsonl` | Append-only audit trail (gitignored, rotates at 5MB) |
| **Bootstrap token** | `agent-scope/.bootstrap-token` | If present, disables hardcoded path protection (for maintainers editing agent-scope itself) |
| **Bootstrap env** | `AGENT_SCOPE_BOOTSTRAP=1` | Same as above but per-process |
| **Webhook sink** | `AGENT_SCOPE_WEBHOOK=<url>` | POSTs each denial to the URL (opt-in) |

## One-time setup

```bash
# Install the git pre-commit hook (per developer)
pnpm scope:install-hooks

# Verify everything is in order
pnpm scope:test          # runs the scope library unit tests
pnpm scope:validate      # validates every manifest
```

## Quick start

```bash
# Guided onboarding — prints a chat trigger for the Cursor agent
pnpm task start

# Non-interactive manifest creation (run this yourself; see "Onboarding flow")
pnpm task create my-task \
  --description "Refactor peer sync for workspace auth" \
  --allowed "packages/agent/src/**sync*" \
  --allowed "packages/agent/test/**sync*" \
  --inherits base \
  --activate

# List available tasks (marks the active one with *)
pnpm task list

# Set the active task
pnpm task set sync-refactor

# See which task is active and what it allows
pnpm task show

# Debug how the active task was resolved (env/file/branch/git-config)
pnpm task resolve

# Create a new task manifest interactively (prompts you)
pnpm task init my-task

# Check whether a specific path is in scope
pnpm task check packages/agent/src/sync-handler.ts
# → allow

# Recent denials (audit)
pnpm task audit

# Clear the active task (writes unrestricted again)
pnpm task clear
```

## Onboarding flow

The `pnpm task start` command is the paved path. It prints a trigger line
like:

```
agent-scope: start task onboarding. Please follow the Task onboarding
protocol in CLAUDE.md: ask me to describe the task, explore the codebase,
propose a scope via AskQuestion, and print the `pnpm task create` command
for me to run once I approve.
```

When you paste that into your Cursor chat, the agent follows a fixed protocol
(defined in `.cursor/rules/agent-scope.mdc` and `CLAUDE.md`):

1. Asks you to describe what you're building or fixing.
2. Explores the codebase (Grep / Glob / DKG) to find relevant files.
3. Proposes a set of globs via `AskQuestion` in plan-mode style — approve,
   show JSON, edit, cancel, or type a custom instruction.
4. On approve, prints the exact `pnpm task create` command for you to run.
5. You run it in your terminal (not the agent — otherwise the
   `afterShellExecution` hook would delete the new manifest as an untracked
   file in a protected path).
6. The agent starts the real work.

From here, every attempted write to an out-of-scope file triggers a plan-mode
AskQuestion menu — see **Escalation** below.

## Manifest format

```json
{
  "id": "sync-refactor",
  "description": "Refactor peer sync protocol to add workspace sync auth",
  "owner": "bojan",
  "allowed": [
    "packages/agent/src/**sync*",
    "packages/agent/src/discovery.ts",
    "packages/core/src/**sync*",
    "packages/publisher/src/**sync*",
    "packages/*/test/**sync*",
    "!**/secrets.*"
  ],
  "exemptions": [
    "**/dist/**",
    "**/*.tsbuildinfo",
    "pnpm-lock.yaml"
  ]
}
```

- `allowed` — glob patterns that the agent may write to. Supports `*`, `**`, `?`.
- `exemptions` — patterns that are always allowed (build artifacts, lockfiles).
- `!pattern` — explicit deny, overrides everything else in both lists.
- **Default-deny**: anything not matched is blocked.

Run `pnpm scope:validate` to verify all manifests conform to
`agent-scope/schema/task.schema.json`.

## How enforcement works

Six layers:

1. **Cursor `sessionStart` hook** (`.cursor/hooks/session-start.mjs`) injects
   the active task's allowed patterns into the agent's context so it knows
   what it may modify from the first turn. **When no task is active and
   bootstrap is off, the hook emits nothing** — the agent's initial context
   is untouched. Only when a task is active (or bootstrap is on) does it
   surface a context block.
2. **Cursor `preToolUse` hook** (`.cursor/hooks/scope-guard.mjs`) runs before
   every `Write`, `StrReplace`, `Delete`, `EditNotebook`, `MultiEdit`, and
   `Edit`. Runs the protected-path check first, then the task-scope check.
3. **Cursor `beforeShellExecution` hook** (`.cursor/hooks/shell-precheck.mjs`)
   tokenises the pending shell command and blocks destructive verbs
   (`rm`, `mv`, `cp`, `chmod`, `chown`, `truncate`, `ln -sf`, `sed -i`,
   redirections `>` / `>>` / `tee`, `find -delete`, `xargs rm`) when their
   target is out-of-scope or hardcode-protected. Recurses into `bash -c`,
   `sh -c`, and opaque evaluators (`node -e`, `python -c`, `perl -e`) to
   catch bypass attempts that hide destructive operations inside string
   arguments. Parsing logic lives in `agent-scope/lib/shell-parse.mjs` and
   is fully unit-tested.
4. **Cursor `afterShellExecution` hook** (`.cursor/hooks/shell-diff-check.mjs`)
   is the backstop for anything the pre-check misses: it runs
   `git status --porcelain` and `git checkout --` reverts any tracked
   out-of-scope/protected modifications. Untracked files in denied paths
   are **deleted** (so an agent cannot establish persistent state like a
   new hook file via a pre-shell bypass).
5. **Git pre-commit hook** (`agent-scope/hooks/pre-commit`, installed via
   `pnpm scope:install-hooks`) blocks local commits of out-of-scope files.
   Also hard-refuses to commit `agent-scope/.bootstrap-token`.
6. **GitHub Actions** (`.github/workflows/agent-scope.yml`) runs on every
   PR: validates all manifests, runs the unit tests, blocks the bootstrap
   token from being committed, resolves the task id from the PR body or
   branch name, and fails the check (with a PR comment) if any changed file
   is out of scope.

If no active task is set (no env, no file, no matching branch, no git-config)
**and** bootstrap is off, layer 1 is silent and layers 2–4 only trigger on
the hardcoded protected paths. Layers 5–6 likewise only gate protected-path
commits/PRs. Everything else is a no-op — you can do ad-hoc work without
changing the workflow.

## Hardcoded protected paths

Some files define the enforcement system itself. If the agent were free to
edit them, the whole thing would be worthless. These paths are **always
denied** regardless of active task, unless bootstrap mode is active:

- `.cursor/hooks/**`, `.cursor/hooks.json`, `.cursor/rules/agent-scope.mdc`
- `agent-scope/lib/**`, `agent-scope/bin/**`, `agent-scope/hooks/**`
- `agent-scope/schema/**`, `agent-scope/tasks/**`, `agent-scope/active`
- `agent-scope/.bootstrap-token`
- `.git/hooks/**`, `.github/workflows/agent-scope.yml`

### Bootstrap mode

To legitimately improve `agent-scope` itself, a human enables bootstrap mode.
Two equivalent switches:

```bash
# Option A — file token (persists across sessions until deleted)
touch agent-scope/.bootstrap-token

# Option B — env var (just for the current Cursor process)
export AGENT_SCOPE_BOOTSTRAP=1
```

While bootstrap is active, the sessionStart hook prints a loud warning into
the agent context. When you're done, remove it:

```bash
rm agent-scope/.bootstrap-token
```

The bootstrap token is in `.gitignore` and the pre-commit hook hard-refuses
to commit it, so it cannot leak into git history.

## Manifest inheritance

Manifests can share common exemptions (e.g. `**/dist/**`, `pnpm-lock.yaml`)
via an `inherits` field. The `base` task ships as a pure-exemption parent:

```json
{ "id": "child", "inherits": ["base"], "allowed": ["src/**"] }
```

Inheritance merges parents first (deduplicating), then the child's own
`allowed`/`exemptions` are appended. `!pattern` denials in a child override
parent `allowed` patterns. Cycles are detected and rejected.

## Optional webhook sink

Forward denials to a DKG node / Slack / log aggregator by setting
`AGENT_SCOPE_WEBHOOK` to an http(s) URL. Each denial is POSTed as JSON
(fire-and-forget, 1.5s timeout). Activity is also written to
`agent-scope/logs/denials.jsonl` locally with automatic rotation at 5MB.

## Escalation — plan-mode denial menu

Every denial (preToolUse, beforeShellExecution, afterShellExecution) emits both
a human-readable prose block **and** a machine-readable JSON menu embedded in
the hook's response. Agents following `.cursor/rules/agent-scope.mdc` (and
`CLAUDE.md`) must parse the menu and surface it to the user via the same
`AskQuestion` mechanism Cursor uses for plan mode.

The structured block is fenced by HTML comments so it's trivial to locate:

```
<!-- agent-scope-menu:begin -->
{
  "version": 1,
  "hook": "preToolUse",
  "reason": "out-of-scope",
  "deniedPath": "packages/evm-module/contracts/Staking.sol",
  "activeTask": "sync-refactor",
  "suggestedGlob": "packages/evm-module/contracts/**",
  "alternativeTasks": [ { "id": "staking", "description": "..." } ],
  "options": [
    { "id": "add_file",           "label": "...", "action": { "kind": "add_to_manifest", ... } },
    { "id": "add_glob",           "label": "...", "action": { "kind": "add_to_manifest", ... } },
    { "id": "switch_task_staking","label": "...", "action": { "kind": "switch_task",     "task": "staking" } },
    { "id": "skip",               "label": "...", "action": { "kind": "skip" } },
    { "id": "cancel",             "label": "...", "action": { "kind": "cancel" } },
    { "id": "custom_instruction", "label": "Let me type my own instruction", "action": { "kind": "custom" } }
  ],
  "recommendedOptionId": "add_glob",
  "agentReasoning": null
}
<!-- agent-scope-menu:end -->
```

Possible `action.kind` values:

| kind | what the agent should do |
|---|---|
| `add_to_manifest` | Add `action.patterns` to `agent-scope/tasks/<action.task>.json` under `allowed`, then retry the original operation. |
| `switch_task` | Run `pnpm task set <action.task>`, then retry. |
| `bootstrap` | Print `action.instruction` to the user and wait for confirmation. Remind them to remove the token after. |
| `fix_manifest` | Open `agent-scope/tasks/<action.task>.json`, fix the error (`action.error`), re-run `pnpm task validate`. |
| `clear_task` | Run `pnpm task clear`. |
| `skip` | Acknowledge and move on. |
| `cancel` | Stop the turn; summarise for the user. |
| `custom` | Ask the user in plain chat what they want instead, then do it. |

Extra guidance in the block:

- `recommendedOptionId` is a hint for which option to highlight. It's chosen
  conservatively (`add_glob` for out-of-scope, `cancel` for protected,
  `fix_manifest` for manifest-load errors). The agent is told to lead with it
  unless overriding has a concrete reason.
- `agentReasoning: null` is a placeholder. The hook can't know the agent's
  reasoning, so the agent **fills it in when surfacing the menu via
  `AskQuestion`**: the prompt must include a 1–2 sentence "here's what I was
  trying to do and why this file came up". Plan-mode equivalent.

Heuristics (in `agent-scope/lib/denial.mjs`):

- `suggestedGlob` is derived from the denied path's parent directory
  (`dirname/**`).
- `alternativeTasks` lists up to 3 other manifests that already cover the
  denied path.
- `protected` reasons offer only `bootstrap` / `skip` / `cancel` /
  `custom_instruction` — no other option can legitimately unblock the write.

Builders and tests live alongside the scope library:

```
agent-scope/lib/denial.mjs         # the builders
agent-scope/lib/denial.test.mjs    # 33 unit tests
```

No special tokens or APIs — the manifest is the source of truth; edit it to
grant permission. Changes to a manifest still go through normal review.

## Emergency override

For genuine emergencies, the git pre-commit hook can be skipped with:

```bash
AGENT_SCOPE_SKIP=1 git commit ...
```

The CI check cannot be bypassed from the dev machine — it runs on GitHub.

## Debug / audit

```bash
pnpm task resolve        # how was the active task resolved?
pnpm task audit          # recent denials
pnpm task validate       # check all manifests
tail -f agent-scope/logs/denials.jsonl
```
