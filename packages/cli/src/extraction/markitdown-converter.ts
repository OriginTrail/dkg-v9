/**
 * MarkItDown converter — file-to-Markdown using the standalone MarkItDown binary.
 *
 * Microsoft MarkItDown (MIT license) converts PDF, DOCX, PPTX, XLSX, CSV, HTML,
 * images, EPUB, XML, and JSON to Markdown. The binary is a PyInstaller-compiled
 * standalone executable shipped with the DKG node.
 *
 * Spec: 05_PROTOCOL_EXTENSIONS.md §6.5.1
 */

import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { platform, arch } from 'node:process';
import { fileURLToPath } from 'node:url';
import type { ExtractionPipeline, ExtractionInput, ConverterOutput } from '@origintrail-official/dkg-core';

const MAX_OUTPUT_BYTES = 50 * 1024 * 1024; // 50 MB

type BundledMarkItDownMetadata = {
  source?: 'release' | 'build';
  cliVersion?: string;
  buildFingerprint?: string;
};

type BundledMarkItDownBuildConfig = {
  markItDownUpstreamVersion: string;
  pyInstallerVersion: string;
  bundlerScriptBytes: Buffer;
};

function checksumPathFor(binaryPath: string): string {
  return `${binaryPath}.sha256`;
}

function metadataPathFor(binaryPath: string): string {
  return `${binaryPath}.meta.json`;
}

function parseSha256Sidecar(text: string): string | null {
  const [hash] = text.trim().split(/\s+/);
  return hash ? hash.toLowerCase() : null;
}

function sha256Hex(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function readCliVersion(): string | null {
  try {
    const raw = readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8');
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.trim().length > 0 ? pkg.version.trim() : null;
  } catch {
    return null;
  }
}

function readBundledMarkItDownBuildConfig(): BundledMarkItDownBuildConfig | null {
  try {
    const bundlerScriptBytes = readFileSync(fileURLToPath(new URL('../../scripts/bundle-markitdown-binaries.mjs', import.meta.url)));
    const bundlerScriptText = bundlerScriptBytes.toString('utf-8');
    const markItDownUpstreamVersion = bundlerScriptText.match(/export const MARKITDOWN_UPSTREAM_VERSION = '([^']+)';/)?.[1];
    const pyInstallerVersion = bundlerScriptText.match(/export const PYINSTALLER_VERSION = '([^']+)';/)?.[1];
    if (!markItDownUpstreamVersion || !pyInstallerVersion) return null;
    return { markItDownUpstreamVersion, pyInstallerVersion, bundlerScriptBytes };
  } catch {
    return null;
  }
}

function bundledMarkItDownBuildFingerprint(): string | null {
  try {
    const buildConfig = readBundledMarkItDownBuildConfig();
    if (!buildConfig) return null;
    const entryScript = readFileSync(fileURLToPath(new URL('../../scripts/markitdown-entry.py', import.meta.url)));
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

function readBundledMetadata(candidate: string): BundledMarkItDownMetadata | null {
  const metadataPath = metadataPathFor(candidate);
  if (!existsSync(metadataPath)) return null;
  try {
    return JSON.parse(readFileSync(metadataPath, 'utf-8')) as BundledMarkItDownMetadata;
  } catch {
    return null;
  }
}

function bundledMetadataMatchesCurrentPackage(metadata: BundledMarkItDownMetadata | null): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const cliVersion = readCliVersion();
  if (!cliVersion || metadata.cliVersion !== cliVersion) return false;
  if (metadata.source === 'release') return true;
  if (metadata.source !== 'build') return false;
  const buildFingerprint = bundledMarkItDownBuildFingerprint();
  return !!buildFingerprint && metadata.buildFingerprint === buildFingerprint;
}

function bundledBinaryValidationFailure(candidate: string): 'checksum' | 'metadata' | null {
  const checksumPath = checksumPathFor(candidate);
  if (!existsSync(candidate) || !existsSync(checksumPath)) return 'checksum';
  try {
    const expectedHash = parseSha256Sidecar(readFileSync(checksumPath, 'utf-8'));
    if (!expectedHash) return 'checksum';
    const actualHash = sha256Hex(readFileSync(candidate));
    if (actualHash !== expectedHash) return 'checksum';
    const metadata = readBundledMetadata(candidate);
    return bundledMetadataMatchesCurrentPackage(metadata) ? null : 'metadata';
  } catch {
    return 'checksum';
  }
}

function hasVerifiedBundledBinary(candidate: string): boolean {
  return bundledBinaryValidationFailure(candidate) === null;
}

function resolveMarkItDownBin(): string | null {
  const suffix = platform === 'win32' ? '.exe' : '';
  const binaryName = `markitdown-${platform}-${arch}${suffix}`;
  const binDir = resolve(fileURLToPath(new URL('../../bin', import.meta.url)));
  const candidate = join(binDir, binaryName);
  if (hasVerifiedBundledBinary(candidate)) return candidate;
  if (existsSync(candidate)) {
    const failure = bundledBinaryValidationFailure(candidate);
    if (failure === 'metadata') {
      console.warn(
        `Ignoring bundled MarkItDown binary with incompatible metadata sidecar (${candidate}). `
        + 'Rerun the staging flow or remove the stale file to use a bundled converter that matches this package version.',
      );
    } else {
      console.warn(
        `Ignoring bundled MarkItDown binary without a valid checksum sidecar (${candidate}). `
        + 'Rerun the staging flow or remove the stale file to use a verified bundled converter.',
      );
    }
  }

  // Fallback: check if markitdown is on PATH
  const pathBin = `markitdown${suffix}`;
  try {
    const whichCmd = platform === 'win32' ? 'where' : 'which';
    execFileSync(whichCmd, [pathBin], { encoding: 'utf-8', stdio: 'pipe' });
    return pathBin;
  } catch {
    return null;
  }
}

let cachedBinPath: string | null | undefined;

function getMarkItDownBin(): string | null {
  if (cachedBinPath !== undefined) return cachedBinPath;
  cachedBinPath = resolveMarkItDownBin();
  return cachedBinPath;
}

export function isMarkItDownAvailable(): boolean {
  return getMarkItDownBin() !== null;
}

async function runMarkItDown(filePath: string): Promise<string> {
  const bin = getMarkItDownBin();
  if (!bin) {
    throw new Error(
      'MarkItDown binary not found. Document extraction unavailable. '
      + 'Install markitdown or place the standalone binary in the node bin/ directory.',
    );
  }

  return new Promise<string>((resolve, reject) => {
    execFile(bin, [filePath], { maxBuffer: MAX_OUTPUT_BYTES }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim() || err.message;
        reject(new Error(`MarkItDown conversion failed: ${msg}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

export const MARKITDOWN_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/html',
  'application/epub+zip',
  'application/xml',
  'text/xml',
] as const;

export class MarkItDownConverter implements ExtractionPipeline {
  readonly contentTypes = [...MARKITDOWN_CONTENT_TYPES];

  async extract(input: ExtractionInput): Promise<ConverterOutput> {
    const markdown = await runMarkItDown(input.filePath);
    return { mdIntermediate: markdown };
  }
}
