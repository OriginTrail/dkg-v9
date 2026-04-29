#!/usr/bin/env node
/**
 * Stdio MCP server exposing the local DKG daemon to any MCP-aware client
 * (Cursor, Claude Code, Continue, …). See README.md for installation.
 *
 * Launched either directly via `dkg-mcp` (installed binary) or via
 * `npx @origintrail-official/dkg-mcp`. Picks up `.dkg/config.yaml` from
 * the workspace or falls back to environment variables.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, describeConfig, type DkgConfig } from './config.js';
import { DkgClient } from './client.js';
import { registerReadTools } from './tools.js';
import { registerWriteTools } from './tools/writes.js';
import { registerAnnotationTools } from './tools/annotations.js';
import { registerReviewTools } from './tools/review.js';
import { runCli, isKnownCliSubcommand } from './cli/index.js';

const VERSION = '0.1.0';

/**
 * Make sure the configured `contextGraph` exists on the daemon. This runs
 * once per MCP session (typically: every Cursor / Claude Code startup).
 *
 * Why this lives here: a coworker's first install almost always happens
 * with the daemon down — the order is `pnpm install` → `pnpm build` →
 * `dkg start` → open Cursor. The postinstall `scripts/scope-setup.mjs`
 * writes `.dkg/config.yaml` but skips paranet creation (daemon was down).
 * Without this, the agent's first `dkg_add_task` call would 404 and
 * we'd be back to "user has to run an extra command before the system
 * works". Auto-creating here means by the time the first tool call
 * lands, the graph is live.
 *
 * Best-effort. If the daemon is down, unauthorized, or the create fails
 * for any reason, we log to stderr and continue serving — read tools
 * still work against existing graphs, and the next session will retry.
 * Never throws.
 */
async function ensureContextGraph(client: DkgClient, config: DkgConfig): Promise<void> {
  if (!config.defaultProject) return;
  try {
    const projects = await client.listProjects();
    const exists = projects.some((p) => p?.id === config.defaultProject);
    if (exists) return;
    await client.createContextGraph(
      config.defaultProject,
      config.defaultProject,
      `Auto-created by dkg-mcp on first connect — agent-scope coordination graph.`,
    );
    process.stderr.write(
      `[dkg-mcp] auto-created context graph "${config.defaultProject}" (first run on this daemon)\n`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[dkg-mcp] note: could not ensure context graph "${config.defaultProject}": ${msg}\n`,
    );
  }
}

/**
 * Dual-mode entrypoint. With no args (the way Cursor / Claude Code
 * spawn an MCP server), boot the stdio MCP server. With a known
 * subcommand (`join`, `status`, `sync`, `create-project`, `help`),
 * delegate to the CLI dispatcher. This keeps the operator-facing
 * binary single (`dkg-mcp`) while still letting MCP clients spawn
 * the same process with no args.
 */
async function main(): Promise<void> {
  const sub = process.argv[2];
  if (sub && isKnownCliSubcommand(sub)) {
    process.exit(await runCli(process.argv.slice(2)));
  }

  const config = loadConfig();
  process.stderr.write(`[dkg-mcp ${VERSION}] ${describeConfig(config)}\n`);

  const client = new DkgClient({ config });
  await ensureContextGraph(client, config);

  const server = new McpServer({ name: 'dkg', version: VERSION });

  registerReadTools(server, client, config);
  registerWriteTools(server, client, config);
  registerAnnotationTools(server, client, config);
  registerReviewTools(server, client, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[dkg-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
