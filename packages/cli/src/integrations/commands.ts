// Wires up the `dkg integration ...` subcommand tree on a Commander program.
//
// Exposed:
//   dkg integration list          - enumerate entries in the registry
//   dkg integration info <slug>   - show one entry
//   dkg integration install <slug> [--allow-community] [--dry-run]
//
// Only install kinds currently in the registry (cli, mcp) are implemented.
// Other kinds print an explicit "not implemented in this CLI version" error
// pointing at the entry's repo and registry page so users can follow manual
// install instructions.

import type { Command } from 'commander';
import { installCli } from './install-cli.js';
import { installMcp } from './install-mcp.js';
import { fetchAllEntries, fetchEntry, resolveRegistryConfig } from './registry-client.js';
import type { IntegrationEntry, TrustTier } from './schema.js';

const TIER_RANK: Record<TrustTier, number> = { community: 0, verified: 1, featured: 2 };

export function registerIntegrationCommands(program: Command): void {
  const integrationCmd = program
    .command('integration')
    .description('Install and inspect community DKG integrations from the registry');

  integrationCmd
    .command('list')
    .description('List integrations available in the registry')
    .option('--tier <tier>', 'Minimum trust tier: community | verified | featured', 'verified')
    .option('--json', 'Print the raw registry entries as JSON')
    .action(async (opts: { tier: string; json?: boolean }) => {
      try {
        const cfg = resolveRegistryConfig();
        const all = await fetchAllEntries(cfg);
        const min = parseTier(opts.tier);
        const filtered = all.filter((e) => TIER_RANK[e.trustTier] >= TIER_RANK[min]);

        if (opts.json) {
          console.log(JSON.stringify(filtered, null, 2));
          return;
        }

        if (filtered.length === 0) {
          console.log(`No integrations at tier "${min}" or above.`);
          return;
        }

        console.log(`Showing ${filtered.length} integration(s) at tier ${min}+:\n`);
        for (const e of filtered) {
          console.log(`  ${e.slug.padEnd(24)}  [${e.trustTier}]  ${e.name}`);
          console.log(`    ${e.description.slice(0, 120)}${e.description.length > 120 ? '…' : ''}`);
          console.log(`    install: ${e.install.kind} · memory: ${e.memoryLayers.join(', ')} · ${e.repo}`);
          console.log('');
        }
      } catch (err) {
        console.error(`Failed to list integrations: ${toMessage(err)}`);
        process.exit(1);
      }
    });

  integrationCmd
    .command('info <slug>')
    .description('Show full registry metadata for one integration')
    .option('--json', 'Print the raw entry as JSON')
    .action(async (slug: string, opts: { json?: boolean }) => {
      try {
        const cfg = resolveRegistryConfig();
        const entry = await fetchEntry(slug, cfg);
        if (opts.json) {
          console.log(JSON.stringify(entry, null, 2));
          return;
        }
        printEntryHuman(entry);
      } catch (err) {
        console.error(`Failed to load integration "${slug}": ${toMessage(err)}`);
        process.exit(1);
      }
    });

  integrationCmd
    .command('install <slug>')
    .description('Install an integration from the registry')
    .option('--allow-community', 'Allow installing community-tier entries (not peer-reviewed)')
    .option('--dry-run', 'Print what would happen without executing any install step')
    .option('--api-url <url>', 'DKG node HTTP API URL to wire into integrations', 'http://127.0.0.1:9200')
    .action(async (slug: string, opts: { allowCommunity?: boolean; dryRun?: boolean; apiUrl: string }) => {
      try {
        const cfg = resolveRegistryConfig();
        const entry = await fetchEntry(slug, cfg);

        if (entry.trustTier === 'community' && !opts.allowCommunity) {
          console.error(
            `Refusing to install community-tier integration "${entry.slug}" without --allow-community.\n\n` +
              `Community-tier entries are contributor-submitted and have not been peer-reviewed by the\n` +
              `OriginTrail core team. Read ${entry.repo} and the security declaration before proceeding:\n\n` +
              formatSecurity(entry) +
              `\n\nRe-run with --allow-community to install anyway.`,
          );
          process.exit(3);
        }

        console.log(`Installing ${entry.name} (${entry.slug}) [${entry.trustTier}]`);
        console.log(`  repo:    ${entry.repo}`);
        console.log(`  pinned:  ${entry.commit.slice(0, 12)}`);
        console.log('');

        switch (entry.install.kind) {
          case 'cli': {
            const result = await installCli({ entry, dryRun: opts.dryRun });
            console.log('');
            console.log(`Installed ${entry.install.package}@${entry.install.version}.`);
            console.log(`Run \`${result.binary} --help\` to get started.`);
            if (result.postInstructions.length > 0) {
              console.log('');
              for (const line of result.postInstructions) console.log(line);
            }
            break;
          }
          case 'mcp': {
            await installMcp({ entry, apiUrl: opts.apiUrl });
            break;
          }
          case 'service':
          case 'agent-plugin':
          case 'manual':
            console.error(
              `Install kind "${entry.install.kind}" is declared by this entry but not yet supported by the CLI.\n` +
                `Follow the manual instructions at ${entry.repo} for now. ` +
                `Automated support is planned for a follow-up release.`,
            );
            process.exit(2);
            break;
          default: {
            const _exhaustive: never = entry.install as never;
            void _exhaustive;
            console.error(
              `Unknown install kind in registry entry. The CLI may be out of date; try upgrading it.`,
            );
            process.exit(2);
          }
        }
      } catch (err) {
        console.error(`Install failed: ${toMessage(err)}`);
        process.exit(1);
      }
    });
}

function parseTier(tier: string): TrustTier {
  if (tier === 'community' || tier === 'verified' || tier === 'featured') return tier;
  throw new Error(`Unknown tier "${tier}". Expected one of: community, verified, featured.`);
}

function printEntryHuman(e: IntegrationEntry): void {
  console.log(`${e.name}  [${e.trustTier}]`);
  console.log(`  slug:         ${e.slug}`);
  console.log(`  description:  ${e.description}`);
  console.log(`  repo:         ${e.repo}`);
  console.log(`  commit:       ${e.commit}`);
  console.log(`  license:      ${e.license}`);
  console.log(`  memory:       ${e.memoryLayers.join(', ')}`);
  console.log(`  primitives:   ${e.v10PrimitivesUsed.join(', ')}`);
  console.log(`  interfaces:   ${e.publicInterfacesUsed.join(', ')}`);
  if (e.maintainer) {
    console.log(`  maintainer:   ${e.maintainer.github}${e.maintainer.name ? ` (${e.maintainer.name})` : ''}`);
  }
  console.log(`  install:      ${e.install.kind}`);
  switch (e.install.kind) {
    case 'cli':
      console.log(`    package:    ${e.install.package}@${e.install.version}`);
      console.log(`    binary:     ${e.install.binary}`);
      break;
    case 'mcp':
      console.log(`    command:    ${e.install.command} ${e.install.args.join(' ')}`);
      if (e.install.clientCompatibility) {
        console.log(`    clients:    ${e.install.clientCompatibility.join(', ')}`);
      }
      break;
    case 'service':
      if (e.install.runtime === 'docker' && e.install.docker) {
        console.log(`    docker:     ${e.install.docker.image}${e.install.docker.digest ? `@${e.install.docker.digest}` : ''}`);
      } else if (e.install.runtime === 'npm-global' && e.install.npmGlobal) {
        console.log(`    npm global: ${e.install.npmGlobal.package}@${e.install.npmGlobal.version}`);
      }
      break;
    case 'agent-plugin':
      console.log(`    framework:  ${e.install.framework}`);
      console.log(`    package:    ${e.install.package}@${e.install.version}`);
      break;
    case 'manual':
      console.log(`    steps:      ${e.install.steps.length} manual step(s); see registry entry.`);
      break;
  }
  console.log('');
  console.log(formatSecurity(e));
  if (e.fitNotes) {
    console.log('');
    console.log(`  fit notes:   ${e.fitNotes}`);
  }
  if (e.designBrief) console.log(`  design:      ${e.designBrief}`);
}

function formatSecurity(e: IntegrationEntry): string {
  const lines: string[] = ['  security:'];
  const egress = e.security.networkEgress ?? [];
  const writes = e.security.writeAuthority ?? [];
  const creds = e.security.credentialsHandled ?? [];
  lines.push(`    network:      ${egress.length === 0 ? 'none (local DKG node only)' : egress.join(', ')}`);
  lines.push(`    writes:       ${writes.length === 0 ? 'none' : writes.join('; ')}`);
  lines.push(`    credentials:  ${creds.length === 0 ? 'none' : creds.join(', ')}`);
  if (e.security.notes) lines.push(`    notes:        ${e.security.notes}`);
  return lines.join('\n');
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
