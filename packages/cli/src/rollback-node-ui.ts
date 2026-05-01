import { execSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { toErrorMessage } from '@origintrail-official/dkg-core';
import {
  isNodeUiGitLayoutSlot,
  NODE_UI_PACKAGE_NAME_FALLBACKS,
  nodeUiPackageJsonPath,
  nodeUiPackageNamesFromCliPackageJson,
  nodeUiPackageNameFromPackageJson,
  nodeUiNpmStaticIndexPaths,
  nodeUiStaticBuildCommand,
  nodeUiStaticBuildLabel,
  nodeUiStaticDistPath,
  nodeUiStaticIndexPath,
} from './node-ui-static.js';

const ROLLBACK_UI_BUILD_TIMEOUT_MS = 15 * 60_000;

export interface RollbackNodeUiIo {
  existsSync: typeof existsSync;
  readFileSync: typeof readFileSync;
  rmSync: typeof rmSync;
  renameSync: typeof renameSync;
  execSync: typeof execSync;
  log: (message: string) => void;
  error: (message: string) => void;
}

const defaultIo: RollbackNodeUiIo = {
  existsSync,
  readFileSync,
  rmSync,
  renameSync,
  execSync,
  log: console.log,
  error: console.error,
};

function nodeUiPackageNamesForRollback(slotDir: string, io: RollbackNodeUiIo): string[] {
  try {
    return [nodeUiPackageNameFromPackageJson(
      io.readFileSync(nodeUiPackageJsonPath(slotDir), 'utf-8'),
    )];
  } catch {
    return NODE_UI_PACKAGE_NAME_FALLBACKS;
  }
}

function nodeUiPackageNamesForNpmSlot(slotDir: string, io: RollbackNodeUiIo): string[] {
  try {
    return nodeUiPackageNamesFromCliPackageJson(
      io.readFileSync(join(
        slotDir,
        'node_modules',
        '@origintrail-official',
        'dkg',
        'package.json',
      ), 'utf-8'),
    );
  } catch {
    return NODE_UI_PACKAGE_NAME_FALLBACKS;
  }
}

export function ensureRollbackNodeUiBundle(
  slotDir: string,
  target: 'a' | 'b',
  io: RollbackNodeUiIo = defaultIo,
): boolean {
  const gitIndex = nodeUiStaticIndexPath(slotDir);
  const isGitSlot = isNodeUiGitLayoutSlot(slotDir, io.existsSync);

  if (!isGitSlot) {
    const npmCandidateIndexes = nodeUiNpmStaticIndexPaths(
      slotDir,
      nodeUiPackageNamesForNpmSlot(slotDir, io),
    );
    if (npmCandidateIndexes.some((indexFile) => io.existsSync(indexFile))) return true;
    io.error(`Slot ${target} has no Node UI static bundle (${npmCandidateIndexes.join(', ')}). Run "dkg update" first to prepare it.`);
    return false;
  }

  const hadExistingGitBundle = io.existsSync(gitIndex);
  const gitDist = nodeUiStaticDistPath(slotDir);
  const backupDist = `${gitDist}.rollback-backup`;
  io.log(
    hadExistingGitBundle
      ? `Slot ${target} has an existing Node UI static bundle; rebuilding UI assets before rollback...`
      : `Slot ${target} has no Node UI static bundle; building UI assets before rollback...`,
  );
  try {
    io.rmSync(backupDist, { recursive: true, force: true });
    if (hadExistingGitBundle) {
      io.renameSync(gitDist, backupDist);
    } else {
      io.rmSync(gitDist, { recursive: true, force: true });
    }
  } catch (err) {
    io.error(
      `Rollback aborted: failed to clear stale Node UI static bundle for slot ${target} ` +
        `(${toErrorMessage(err)}).`,
    );
    return false;
  }
  let lastError: unknown;
  const packageNames = nodeUiPackageNamesForRollback(slotDir, io);
  for (const packageName of packageNames) {
    try {
      io.execSync(nodeUiStaticBuildCommand(packageName), {
        cwd: slotDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: ROLLBACK_UI_BUILD_TIMEOUT_MS,
      });
      if (io.existsSync(gitIndex)) {
        try {
          io.rmSync(backupDist, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup only; the rebuilt UI bundle is ready.
        }
        return true;
      }
      lastError = new Error(`Node UI static bundle missing (${gitIndex})`);
    } catch (err) {
      lastError = err;
    }
  }
  if (hadExistingGitBundle) {
    try {
      io.rmSync(gitDist, { recursive: true, force: true });
      io.renameSync(backupDist, gitDist);
    } catch (restoreErr) {
      io.error(
        `Rollback warning: failed to restore previous Node UI static bundle for slot ${target} ` +
          `(${toErrorMessage(restoreErr)}).`,
      );
    }
  }
  io.error(
    `Rollback aborted: failed to build Node UI static bundle for slot ${target} ` +
      `with ${packageNames.map(nodeUiStaticBuildLabel).join(', ')} ` +
      `(${toErrorMessage(lastError)}).`,
  );
  return false;
}
