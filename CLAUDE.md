# DKG Dev Coordination — Agent Instructions

This repository uses a **Decentralized Knowledge Graph (DKG)** for multi-agent development coordination. A local DKG node maintains a structured code graph and project knowledge that you should query before exploring files directly.

## Setup

The DKG MCP server must be configured in your MCP settings:

```json
{
  "mcpServers": {
    "dkg": {
      "command": "node",
      "args": ["packages/mcp-server/dist/index.js"]
    }
  }
}
```

The DKG daemon must be running (`dkg start`).

## Session Start Protocol

Before exploring the codebase, **always** query the dev-coordination paranet first. These queries cost a fraction of the tokens that file exploration does.

### 1. Check what has been worked on recently

```sparql
SELECT ?s ?summary ?agent ?date ?cost WHERE {
  ?s a <https://ontology.dkg.io/devgraph#Session> ;
     <https://ontology.dkg.io/devgraph#summary> ?summary ;
     <https://ontology.dkg.io/devgraph#agent> ?agent ;
     <https://ontology.dkg.io/devgraph#startedAt> ?date .
  OPTIONAL { ?s <https://ontology.dkg.io/devgraph#estimatedCost> ?cost }
}
ORDER BY DESC(?date) LIMIT 10
```

### 2. Check active tasks

```sparql
SELECT ?t ?desc ?status ?assignee WHERE {
  ?t a <https://ontology.dkg.io/devgraph#Task> ;
     <https://ontology.dkg.io/devgraph#description> ?desc ;
     <https://ontology.dkg.io/devgraph#status> ?status .
  OPTIONAL { ?t <https://ontology.dkg.io/devgraph#assignee> ?assignee }
  FILTER(?status != "done")
}
```

### 3. Check recent architectural decisions

```sparql
SELECT ?d ?summary ?rationale ?by ?date WHERE {
  ?d a <https://ontology.dkg.io/devgraph#Decision> ;
     <https://ontology.dkg.io/devgraph#summary> ?summary ;
     <https://ontology.dkg.io/devgraph#rationale> ?rationale ;
     <https://ontology.dkg.io/devgraph#madeBy> ?by ;
     <https://ontology.dkg.io/devgraph#madeAt> ?date .
}
ORDER BY DESC(?date) LIMIT 5
```

## Code Exploration via DKG

Instead of using Glob/Grep/Read to find files, **query the code graph first**. The DKG graph gives you the **map**; file tools give you the **territory**. Start with the map.

Use Read/Grep/Glob when:
- The code graph doesn't cover the specific file (e.g., config files, scripts)
- You need to see the actual implementation, not just the structure
- The graph is not yet indexed for a new file you just created

## During Your Session

### When making architectural decisions

Publish a `devgraph:Decision` so other agents can see it via the
`dkg_publish` MCP tool.

### When completing a task

Call `dkg_update_task_status({ taskUri, status: "done" })`. This is also
how you tell the agent-scope guard that a piece of work is finished —
see below.

## Vocabulary Reference

All classes and properties use the `devgraph:` namespace (`https://ontology.dkg.io/devgraph#`).

| Class | Description |
|-------|-------------|
| `Session` | A coding agent work session |
| `Decision` | An architectural decision |
| `Task` | A planned work item; may carry `tasks:scopedToPath` for write-time scope |
| `Package` | A workspace package |
| `CodeModule` | A source file |
| `Function` | An exported function or method |
| `Class` | An exported class |
| `Contract` | A Solidity smart contract |

The full ontology is at `packages/mcp-server/schema/dev-paranet.ttl`.

---

## Task-scoped writes (`agent-scope`) — MANDATORY behaviour

This repo ships a thin write-time guard called **agent-scope**. It is
**invisible by default**: it only activates when (a) at least one
`tasks:Task` is `in_progress` and attributed to your agent URI in the
local DKG, or (b) you try to touch one of the hardcoded protected paths
(always denied unless a human has enabled bootstrap mode).

### Mental model

The active scope at any moment is the **union of `tasks:scopedToPath`
globs** across every `in_progress` task whose `prov:wasAttributedTo`
matches the current agent URI. There is no separate manifest file, no
"active task" pointer, no `pnpm task` CLI — the DKG is the source of
truth and the guard reads it live (with a 5s cache).

### Starting a task

When the user gives you a piece of work and there is no covering
`in_progress` task, propose one and file it. A typical first call:

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

The guard cache picks up the new globs within ~5s; the next write to
those paths succeeds. To extend scope mid-work, file an additional
`in_progress` task (its globs union into the active scope) or re-issue
`dkg_add_task` for the same `taskUri` with the extended `scopedToPath`.

When the work is done:

```ts
dkg_update_task_status({
  taskUri: 'urn:dkg:task:peer-sync-auth',
  status: 'done',
})
```

The next scope read drops its globs automatically.

### Hardcoded protected paths

Always denied unless bootstrap mode is active:

```
.cursor/hooks/**             .cursor/hooks.json    .cursor/rules/agent-scope.mdc
.claude/hooks/**             .claude/settings.json
agent-scope/lib/**           agent-scope/.bootstrap-token
AGENTS.md                    GEMINI.md             .cursorrules
```

Bootstrap mode is enabled by either `AGENT_SCOPE_BOOTSTRAP=1` in the
environment or `agent-scope/.bootstrap-token` existing on disk. **Both
must be set by the human, not by you.** If you need to modify a
protected file, STOP and ask the user to:

```
touch agent-scope/.bootstrap-token
```

…then remind them to `rm agent-scope/.bootstrap-token` when the
protected work is done.

### Plan-mode denial protocol — MANDATORY when a write is blocked

The denial message starts with an `agent-scope:` summary line and
contains a fenced JSON block:

```
<!-- agent-scope-menu:begin -->
{ humanSummary, simpleOptions, recommendedOptionId, options, ... }
<!-- agent-scope-menu:end -->
```

When you see this, STOP. Do not retry, rewrite, or work around the denial
— the defense-in-depth layers (post-shell hook) will revert tracked
changes and delete untracked files in denied paths anyway.

**Protocol:**

1. **Stop.** Do not retry via another tool or command form.
2. **Extract the JSON.** Parse between the fences.
3. **Call `AskQuestion`** — ONE question, the TWO `simpleOptions` entries
   verbatim. Prompt = `humanSummary` verbatim, plus one short sentence of
   your own reasoning (why you wanted to do this), plus a simple ask.
   Keep the whole prompt to 3 sentences max. Example:

   > I'd like to edit `packages/evm-module/contracts/S.sol`, but no
   > in-progress task covers that file. I was trying to update the
   > staking integration the PR depends on. Want me to file a new
   > in-progress task covering `packages/evm-module/contracts/**` and
   > continue?

   Do NOT surface the verbose `options` list. Do NOT add or rewrite options.

4. **Act on the user's choice** by matching the `action.kind`:
   - `new_in_progress_task` → call `dkg_add_task` with the suggested
     `scopedToPath` (use `action.suggestedScopedToPath`) and
     `status: "in_progress"`. The cache picks it up within ~5s; retry.
   - `bootstrap` → print `action.instruction` verbatim, wait for the user.
     Remind them to `rm agent-scope/.bootstrap-token` when done.
   - `restart_daemon` / `configure_dkg` → print `action.instruction`
     verbatim, wait for the user, retry.
   - `skip` → acknowledge, move on.
   - `cancel` → stop the turn, summarise.
   - `custom` → ask the user in plain chat "OK, what should I do instead?"
     Wait for their free-text reply, then carry out whatever they say.

5. **Never invent options.** The `custom_instruction` entry is always in
   `simpleOptions` — route through it when neither side fits.

### Phrasing rules

- Write like you're texting a coworker. One short question, one
  recommendation, one "something else" option.
- Never use ALL CAPS banners ("PROTECTED PATH", "STOP", "WARNING").
- Don't explain internal architecture in the prompt. The user doesn't
  need to know about hooks or SPARQL queries to answer.
- One sentence is enough to say why something is restricted.
- No emoji unless the user uses them first.

### Cross-agent coverage

| Agent | Enforcement | Wired via |
|---|---|---|
| Cursor | hard hooks (block writes physically) | `.cursor/hooks/`, `.cursor/hooks.json`, `.cursor/rules/agent-scope.mdc` |
| Claude Code | hard hooks (block writes physically) | `.claude/hooks/`, `.claude/settings.json`, `CLAUDE.md` |
| Codex CLI | soft (no hook system available) | `AGENTS.md` — agent self-enforces |
| Gemini CLI | soft | `GEMINI.md` — agent self-enforces |
| Continue / Cline / older Cursor | soft | `.cursorrules` (legacy) |

Run `pnpm scope:check-agent` after pulling to verify your agent is wired
up correctly. The same denial menu / DKG-derived scope applies across all
agents — only the enforcement layer differs.

When you're running under Claude Code, the first time the user opens
this repo Claude Code will prompt them to **trust** the project hooks.
They must approve — that's how the enforcement attaches.
