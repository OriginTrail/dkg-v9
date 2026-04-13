import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type BundledMarkItDownMetadata = {
  source?: 'release' | 'build';
  cliVersion?: string;
  buildFingerprint?: string;
};

type BundledMarkItDownBuildConfig = {
  markItDownUpstreamVersion: string;
  pyInstallerVersion: string;
  bundlerScriptBytes: Buffer;
};

export function sha256Hex(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function readCliPackageVersion(cliDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(resolve(cliDir), 'package.json'), 'utf-8')) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.trim().length > 0 ? pkg.version.trim() : null;
  } catch {
    return null;
  }
}

function readBundledMarkItDownBuildConfig(cliDir: string): BundledMarkItDownBuildConfig | null {
  try {
    const resolvedCliDir = resolve(cliDir);
    const bundlerScriptBytes = readFileSync(join(resolvedCliDir, 'scripts', 'bundle-markitdown-binaries.mjs'));
    const bundlerScriptText = bundlerScriptBytes.toString('utf-8');
    const markItDownUpstreamVersion = bundlerScriptText.match(/export const MARKITDOWN_UPSTREAM_VERSION = '([^']+)';/)?.[1];
    const pyInstallerVersion = bundlerScriptText.match(/export const PYINSTALLER_VERSION = '([^']+)';/)?.[1];
    if (!markItDownUpstreamVersion || !pyInstallerVersion) return null;
    return { markItDownUpstreamVersion, pyInstallerVersion, bundlerScriptBytes };
  } catch {
    return null;
  }
}

export function bundledMarkItDownBuildFingerprint(cliDir: string): string | null {
  try {
    const buildConfig = readBundledMarkItDownBuildConfig(cliDir);
    if (!buildConfig) return null;
    const entryScript = readFileSync(join(resolve(cliDir), 'scripts', 'markitdown-entry.py'));
    return sha256Hex([
      buildConfig.markItDownUpstreamVersion,
      buildConfig.pyInstallerVersion,
      sha256Hex(entryScript),
      sha256Hex(buildConfig.bundlerScriptBytes),
    ].join('\n'));
  } catch {
    return null;
  }
}

export function expectedBundledMarkItDownBuildMetadata(cliDir: string): BundledMarkItDownMetadata | null {
  const cliVersion = readCliPackageVersion(cliDir);
  const buildFingerprint = bundledMarkItDownBuildFingerprint(cliDir);
  if (!cliVersion || !buildFingerprint) return null;
  return { source: 'build', cliVersion, buildFingerprint };
}
