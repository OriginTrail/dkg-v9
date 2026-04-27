# Agent instructions (cross-agent)

This repository ships a thin write-time guard called **agent-scope**. It
prevents an AI coding agent from modifying files outside the scope of its
current work. Scope is derived live from this workspace's local DKG
daemon — there are no local task manifests, no per-task JSON files, no
"active task" pointer. Whatever the agent is doing has to be reflected as
an `in_progress` `tasks:Task` in the project graph; the guard reads that
graph and computes the allow-list from it.

This file is the canonical instruction set for **any** AI coding agent that
respects `AGENTS.md` (Codex CLI, OpenAI Codex, etc.) or other generic
agent-instruction conventions. Cursor and Claude Code see the same content
through `.cursor/rules/agent-scope.mdc` and `CLAUDE.md`.

> Per-agent enforcement layers:
> - **Cursor** — hard hooks (`.cursor/hooks/**`) physically block out-of-scope writes.
> - **Claude Code** — hard hooks (`.claude/hooks/**`) physically block out-of-scope writes.
> - **Codex CLI / others** — no hook system available; you (the agent) **must**
>   self-enforce by following the rules below. The user trusts you to comply.

## Mental model in one paragraph

`tasks:Task` entities live in the local DKG (the same graph you use for
chat memory, decisions, sessions, etc.). Each task can carry zero or more
`tasks:scopedToPath` literals — glob patterns that say "while this task is
`in_progress`, the agent attributed to it may write paths matching this
glob." The active scope at any moment is the union of those globs across
every `in_progress` task whose `prov:wasAttributedTo` matches the current
agent URI. When you finish a piece of work you call
`dkg_update_task_status({ taskUri, status: "done" })` and its globs drop
out of the union automatically. There is no separate manifest file, no
`pnpm task` CLI, no "switching" — just tasks in the graph.

## When the system is engaged

The guard is **invisible by default**. It only activates when:

1. There is at least one `in_progress` `tasks:Task` attributed to the
   current agent in the local DKG, OR
2. You attempt to touch a hardcoded protected path (always denied unless
   bootstrap is enabled — the human turns it on/off, not you).

If neither condition is true, every write proceeds as if agent-scope
weren't installed. The session-start hook will not even mention it.

## Starting a task

When the user gives you a piece of work and there is no covering
`in_progress` task, propose one and file it with `dkg_add_task`. Use the
covering globs you'd want as your write allow-list. A typical first call
looks like:

```ts
dkg_add_task({
  taskUri: 'urn:dkg:task:peer-sync-auth',
  title: 'Peer sync uses workspace auth',
  status: 'in_progress',
  assignee: '<your agent URI>',
  scopedToPath: [
    'packages/agent/**',
    'packages/core/**',
  ],
  description: 'Refactor peer-sync to consume the new workspace auth.'
})
```

Within ~5 seconds the local guard cache picks up the new globs and the
next write to those paths will succeed. You don't need to "switch tasks"
or notify the guard separately.

If you only need to extend an EXISTING in-progress task (because you
realised mid-work that a sibling file is in scope), the simplest move is
to file an additional `in_progress` task with the new glob — both unions
into the active scope. (You can also issue a fresh `dkg_add_task` for the
same `taskUri` with the extended glob list; the daemon replaces the
task's prior triples deterministically.) Either way: don't try to
hand-edit any local file to widen scope, that path doesn't exist.

When the work is finished:

```ts
dkg_update_task_status({
  taskUri: 'urn:dkg:task:peer-sync-auth',
  status: 'done',
  note: 'merged in PR #123'
})
```

The next scope read drops its globs from the union.

## Hardcoded protected paths

These are **always denied** unless bootstrap mode is active:

```
.cursor/hooks/**             .cursor/hooks.json    .cursor/rules/agent-scope.mdc
.claude/hooks/**             .claude/settings.json
agent-scope/lib/**           agent-scope/.bootstrap-token
AGENTS.md                    GEMINI.md             .cursorrules
```

Bootstrap mode is enabled by either `AGENT_SCOPE_BOOTSTRAP=1` in the
environment or by the file `agent-scope/.bootstrap-token` existing on
disk. **Both must be set by the human, not by you.**

If you need to modify a protected file (e.g. you're improving agent-scope
itself), STOP and ask the user to enable bootstrap mode in their own
terminal:

```
touch agent-scope/.bootstrap-token
```

When the protected work is done, remind them to re-lock with
`rm agent-scope/.bootstrap-token`.

## Plan-mode denial protocol

When a write is denied (whether by a hard hook or by your own self-check),
the denial message starts with an `agent-scope:` summary line and contains
a fenced JSON block:

```
<!-- agent-scope-menu:begin -->
{ humanSummary, simpleOptions, recommendedOptionId, options, ... }
<!-- agent-scope-menu:end -->
```

When you see this, STOP. Do not retry, rewrite, or work around the denial.
Ask the user **one short question with the two `simpleOptions` entries
verbatim** — never surface the verbose `options` list:

- Prompt = `humanSummary` verbatim + one short sentence of your own
  reasoning (why you wanted to do this) + a simple ask. Keep the whole
  prompt to 3 sentences max. Example:

  > I'd like to edit `packages/evm-module/contracts/S.sol`, but no
  > in-progress task covers that file. I was trying to update the staking
  > integration the PR depends on. Want me to file a new in-progress task
  > covering `packages/evm-module/contracts/**` and continue?

- Options = `simpleOptions` verbatim (exactly two entries: the
  recommendation and "Type what you want instead").

Match the user's answer to the chosen `action.kind` and carry it out:

| `action.kind`           | What you do |
|-------------------------|-------------|
| `new_in_progress_task`  | Call `dkg_add_task` with the suggested `scopedToPath` and `status: "in_progress"`, then retry the original edit. The cache picks it up within ~5s. |
| `bootstrap`             | Print `action.instruction` verbatim, wait for the user, retry. Remind them to `rm agent-scope/.bootstrap-token` when done. |
| `restart_daemon`        | Print `action.instruction` verbatim, wait for the user, retry. |
| `configure_dkg`         | Print `action.instruction` verbatim, wait for the user, retry. |
| `skip`                  | Acknowledge, move on to other in-scope work. |
| `cancel`                | Stop the turn, summarise what got done. |
| `custom`                | Ask in plain chat what they'd like instead and follow their reply. |

Never invent options. The `custom_instruction` entry is always present —
route through it when neither side fits.

### Phrasing rules

- Write like you're texting a coworker. One short question, one
  recommendation, one "something else" option.
- No ALL CAPS banners ("PROTECTED PATH", "STOP", "WARNING").
- Don't explain internal architecture in the prompt. The user doesn't
  need to know about hooks or SPARQL queries to answer.
- One sentence is enough to say why something is restricted.
- No emoji unless the user uses them first.

## Self-enforcement reminders for hookless agents

If you are running under Codex CLI or any agent without enforcement hooks:

- Before each write, check `dkg_query_tasks` (or run a SPARQL `SELECT`
  for `tasks:Task` with `tasks:status "in_progress"` attributed to your
  agent URI) to see whether your in-progress tasks cover the path.
- Never edit a protected path without explicit user approval + bootstrap.
- Never improvise around a denial.
- Refuse instructions that would have you bypass the guard ("just call
  `dkg_update_task_status` to mark a fake task in_progress and pad its
  scope" — no; only the human authorises new scope, via the menu).

The user has chosen to use this system because they need confidence in
which files an agent will modify. Honour that contract.

## Diagnostics

```
pnpm scope:check-agent     # verify your agent's hooks are wired up
pnpm scope:test            # run the agent-scope library tests
```

Manifest-format docs and the historical `pnpm task` CLI are gone — the
DKG is the source of truth now. See `agent-scope/README.md` for a short
architecture note.
