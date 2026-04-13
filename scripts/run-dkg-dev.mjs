#!/usr/bin/env node

import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const wantsBuildAlias = args[0] === 'build';

function run(command, commandArgs) {
  const child = spawn(command, commandArgs, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

if (wantsBuildAlias) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    run(process.execPath, [npmExecPath, '--filter', '@origintrail-official/dkg', 'build', ...args.slice(1)]);
  } else {
    const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    run(pnpmCommand, ['--filter', '@origintrail-official/dkg', 'build', ...args.slice(1)]);
  }
} else {
  run(process.execPath, ['--import', 'tsx', 'packages/cli/src/cli.ts', ...args]);
}
