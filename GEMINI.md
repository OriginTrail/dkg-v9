# Agent instructions for Gemini CLI

This repository uses an `agent-scope` write-time guard that limits which
files an AI agent may modify. The full instructions live in
[`AGENTS.md`](./AGENTS.md). Read that file first.

Key points for Gemini:

- You may **read** any file in the repo.
- You may **write** only files matching the union of `tasks:scopedToPath`
  globs across `in_progress` `tasks:Task` entities attributed to your
  agent in the local DKG. Run `dkg_query_tasks` (or a SPARQL `SELECT`)
  to see the active set.
- To start a task, call `dkg_add_task({ taskUri, status: "in_progress",
  scopedToPath: [...], assignee: "<agent uri>", ... })`. To finish:
  `dkg_update_task_status({ taskUri, status: "done" })`. There is no
  separate manifest file — the DKG is the source of truth.
- A set of system files is **always protected** regardless of task. See
  the "Hardcoded protected paths" section in `AGENTS.md`.
- Gemini CLI does **not** have hard hook enforcement. You self-enforce by
  following the rules. The user trusts you to comply.
- When a denial fires, surface the menu in the denial JSON via the
  user-question primitive your harness exposes — one short prompt, two
  options (the recommendation and a free-text fallback). Never invent
  options; route through `custom_instruction` if neither side fits.

For the full protocol, denial-handling flow, and DKG reference, see
[`AGENTS.md`](./AGENTS.md).
