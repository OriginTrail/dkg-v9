import { describe, expect, it } from 'vitest';
import { nodeUiNpmStaticIndexPaths, nodeUiStaticIndexPaths } from '../src/node-ui-static.js';

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
