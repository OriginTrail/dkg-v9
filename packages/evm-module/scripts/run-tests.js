#!/usr/bin/env node
'use strict';
// Run Hardhat tests with fixed args. Ignores extra flags (e.g. --run from turbo)
// so that "pnpm test -- --run" at repo root does not break: Hardhat does not accept --run.
const { execSync } = require('child_process');
const cmd = 'npx hardhat test --network hardhat --config hardhat.node.config.ts';
execSync(cmd, { stdio: 'inherit' });
