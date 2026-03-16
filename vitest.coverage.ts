/**
 * Shared coverage thresholds for the monorepo.
 * CI runs `pnpm test:coverage`; if any package is below these percentages, the run fails and the PR is blocked.
 *
 * Individual packages can override these in their vitest.config.ts when their
 * coverage exceeds the global floor. See per-package configs for higher thresholds.
 */
export const coverageThresholds = {
  lines: 30,
  functions: 30,
  branches: 30,
  statements: 30,
} as const;
