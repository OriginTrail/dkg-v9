# agent-scope

Keeps AI coding agents from editing files they shouldn't.

The agent can read the whole repo, but can only **write** the files your
current task covers. If it tries to touch something else, you get a short
question first — accept or tell it what to do instead. You're never
restricted. This only watches the agent.

## Start a task

```bash
pnpm task start
```

Type what you're working on, hit Enter. Then send any message in the chat
(`start working`, `hi`, whatever). The agent reads your description, looks
around the repo, and proposes which folders to include. Accept it and the
agent starts working inside that scope.

When you're done:

```bash
pnpm task clear
```

## When the agent wants to go out of scope

You'll see something like this in the chat:

> I'd like to edit `packages/foo/bar.ts`, but the active task doesn't cover
> it. Add that folder and keep going?
>
> A) Yes, add it and continue
> B) Type what you want instead

Pick A, or just type what you'd rather have. Nothing out of scope gets
written without your OK.

## Supported agents

- **Cursor** and **Claude Code** — hard-blocked at the hook level, the
  agent physically can't write out-of-scope files.
- **Codex CLI** and **Gemini CLI** — no hook API yet, so they read
  `AGENTS.md` / `GEMINI.md` on session start and are expected to follow the
  rules. Best-effort.

After you clone the repo, run this once to check your agent is wired up:

```bash
pnpm scope:check-agent
```

## Commands

```bash
pnpm task start         # AI-guided onboarding (normal flow)
pnpm task show          # what's active and what it covers
pnpm task list          # all tasks, * marks active
pnpm task set <id>      # switch to an existing task
pnpm task check <path>  # will this file be allowed?
pnpm task audit         # recent denials
pnpm task clear         # turn protection off
```

## Editing agent-scope itself

The files that run the guard are permanently off-limits to the agent —
otherwise it could disable itself. To edit them, drop a token:

```bash
touch agent-scope/.bootstrap-token   # unlock
rm agent-scope/.bootstrap-token      # lock again
```
