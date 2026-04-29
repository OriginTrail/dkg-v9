import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const entrySource = () =>
  readFileSync(new URL('../openclaw-entry.mjs', import.meta.url), 'utf8');

describe('openclaw-entry', () => {
  it('does not register stale lifecycle event names through api.on', () => {
    const source = entrySource();

    expect(source).not.toMatch(/api\.on\(\s*['"]shutdown['"]/);
    expect(source).not.toMatch(/api\.on\(\s*['"]close['"]/);
    expect(source).not.toMatch(/api\.on\(\s*['"]restart['"]/);
    expect(source).not.toMatch(/api\.on\(\s*['"]reload['"]/);
    expect(source).not.toMatch(/\[[^\]]*['"]shutdown['"][^\]]*['"]close['"][^\]]*['"]restart['"][^\]]*['"]reload['"][^\]]*\]/);
    expect(source).not.toMatch(/api\.on\(\s*event\s*,\s*reset\s*\)/);
  });

  it('keeps singleton re-registration delegated to DkgNodePlugin.register', () => {
    const source = entrySource();

    expect(source).toMatch(/if\s*\(\s*instance\s*\)/);
    expect(source).toMatch(/instance\.register\(api\)/);
    expect(source).toMatch(/const dkg = new DkgNodePlugin\(config\)/);
    expect(source).toMatch(/dkg\.register\(api\)/);
  });
});
