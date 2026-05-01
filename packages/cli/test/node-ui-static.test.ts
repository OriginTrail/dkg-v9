import { describe, expect, it } from 'vitest';
import {
  RUNTIME_BUILD_COMPATIBILITY_WRAPPER,
  runtimeBuildCommandFromPackageJson,
  nodeUiNpmStaticIndexPaths,
  nodeUiStaticIndexPaths,
} from '../src/node-ui-static.js';

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

describe('nodeUiStaticIndexPaths', () => {
  it('includes git and npm slot layouts', () => {
    const paths = nodeUiStaticIndexPaths('/tmp/dkg-test/releases/b').map(normalizePath);

    expect(paths).toContain('/tmp/dkg-test/releases/b/packages/node-ui/dist-ui/index.html');
    expect(paths).toContain('/tmp/dkg-test/releases/b/node_modules/@origintrail-official/dkg-node-ui/dist-ui/index.html');
    expect(paths).toContain('/tmp/dkg-test/releases/b/node_modules/@dkg/node-ui/dist-ui/index.html');
    expect(paths).toContain('/tmp/dkg-test/releases/b/node_modules/@origintrail-official/dkg/node_modules/@origintrail-official/dkg-node-ui/dist-ui/index.html');
    expect(paths).toContain('/tmp/dkg-test/releases/b/node_modules/@origintrail-official/dkg/node_modules/@dkg/node-ui/dist-ui/index.html');
  });

  it('keeps npm candidates separate from the git workspace artifact', () => {
    const paths = nodeUiNpmStaticIndexPaths('/tmp/dkg-test/releases/b').map(normalizePath);

    expect(paths).not.toContain('/tmp/dkg-test/releases/b/packages/node-ui/dist-ui/index.html');
    expect(paths).toContain('/tmp/dkg-test/releases/b/node_modules/@origintrail-official/dkg-node-ui/dist-ui/index.html');
    expect(paths).toContain('/tmp/dkg-test/releases/b/node_modules/@origintrail-official/dkg/node_modules/@origintrail-official/dkg-node-ui/dist-ui/index.html');
  });

  it('can scope npm candidates to the expected UI package', () => {
    const paths = nodeUiNpmStaticIndexPaths(
      '/tmp/dkg-test/releases/b',
      ['@origintrail-official/dkg-node-ui'],
    ).map(normalizePath);

    expect(paths).toContain('/tmp/dkg-test/releases/b/node_modules/@origintrail-official/dkg-node-ui/dist-ui/index.html');
    expect(paths.some((path) => path.includes('/@dkg/node-ui/'))).toBe(false);
  });
});

describe('runtimeBuildCommandFromPackageJson', () => {
  it('prefers the runtime-only package build script when present', () => {
    expect(runtimeBuildCommandFromPackageJson(JSON.stringify({
      scripts: {
        'build:runtime:packages': '...',
        'build:runtime': RUNTIME_BUILD_COMPATIBILITY_WRAPPER,
      },
    }))).toBe('pnpm build:runtime:packages');
  });

  it('keeps using build:runtime when the wrapper contains extra prep work', () => {
    expect(runtimeBuildCommandFromPackageJson(JSON.stringify({
      scripts: {
        'build:runtime:packages': '...',
        'build:runtime': `node prep.js && ${RUNTIME_BUILD_COMPATIBILITY_WRAPPER}`,
      },
    }))).toBe('pnpm build:runtime');
  });

  it('falls back across build:runtime and pnpm build', () => {
    expect(runtimeBuildCommandFromPackageJson(JSON.stringify({
      scripts: { 'build:runtime': '...' },
    }))).toBe('pnpm build:runtime');
    expect(runtimeBuildCommandFromPackageJson(JSON.stringify({
      scripts: { build: 'turbo build' },
    }))).toBe('pnpm build');
    expect(runtimeBuildCommandFromPackageJson('not json')).toBe('pnpm build');
  });
});
