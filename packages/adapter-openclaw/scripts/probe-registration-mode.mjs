#!/usr/bin/env node

/**
 * Registration-mode probe runner.
 *
 * Instructs the user how to enable and collect registration-mode diagnostics
 * from the OpenClaw gateway. The actual probing logic lives in DkgNodePlugin
 * and is gated on DKG_PROBE_REGISTRATION_MODE=1.
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BANNER = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                  DKG Registration-Mode Probe Helper                          ║
╚══════════════════════════════════════════════════════════════════════════════╝

This probe instruments DkgNodePlugin.register() to observe:

  1. Which registrationMode the gateway passes on each call
  2. Which hook-registration mechanisms (api.on, api.registerHook, globalThis)
     accept handlers for typed hooks (before_prompt_build, agent_end, etc.)
  3. Which handlers actually fire at runtime

SETUP:

  1. Set environment variable:
     export DKG_PROBE_REGISTRATION_MODE=1

  2. Restart your OpenClaw gateway:
     dkg stop
     dkg start

  3. Drive test turns:
     - Click "Send" in the DKG Agent Hub (UI turn via dkg-ui channel)
     - Send a test message via Telegram or other channel (non-UI turn)

  4. Collect diagnostic logs:
     Gateway logs will include lines like:
       [dkg-probe] register() called: mode=... call#=... api.on=... api.registerHook=...
       [dkg-probe] HOOK FIRED: event=... via=... mode=...

  5. Fill in results:
     Copy all [dkg-probe] lines and paste them into:
       agent-docs/notes/probe-results.md

     Review decision matrix in agent-docs/memory-integration-plan.md §0.3
     and record your decision: Branch A or No-Go.

NOTES:

  - The probe is silent if DKG_PROBE_REGISTRATION_MODE is not set.
  - Probe handlers log every time a hook fires, so gateway logs may grow.
  - This diagnostic has zero effect on normal agent operation.

For details, see: agent-docs/memory-integration-plan.md §0.3
`;

console.log(BANNER);

// Optional: tail gateway log if a path was provided
const logPath = process.argv[2];
if (logPath) {
  console.log(`\nTailing gateway log: ${logPath}\n`);
  try {
    // Use tail -f to follow the log (Ctrl+C to stop)
    execSync(`tail -f "${logPath}"`, { stdio: 'inherit' });
  } catch (err) {
    if (err.code !== 130) { // 130 = SIGINT
      console.error(`Error tailing log: ${err.message}`);
    }
  }
}
