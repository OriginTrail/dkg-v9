import { describe, it, expect } from 'vitest';
import {
  resolvePalette,
  PALETTES,
  PALETTE_DARK,
  PALETTE_MIDNIGHT,
  PALETTE_CYBERPUNK,
  PALETTE_LIGHT,
} from '../src/core/palette.js';

describe('resolvePalette', () => {
  it('returns PALETTE_DARK when called with no arguments', () => {
    const result = resolvePalette();
    expect(result).toBe(PALETTE_DARK);
  });

  it('returns PALETTE_DARK when called with undefined', () => {
    const result = resolvePalette(undefined);
    expect(result).toBe(PALETTE_DARK);
  });

  it('resolves "dark" to PALETTE_DARK', () => {
    expect(resolvePalette('dark')).toBe(PALETTE_DARK);
  });

  it('resolves "midnight" to PALETTE_MIDNIGHT', () => {
    expect(resolvePalette('midnight')).toBe(PALETTE_MIDNIGHT);
  });

  it('resolves "cyberpunk" to PALETTE_CYBERPUNK', () => {
    expect(resolvePalette('cyberpunk')).toBe(PALETTE_CYBERPUNK);
  });

  it('resolves "light" to PALETTE_LIGHT', () => {
    expect(resolvePalette('light')).toBe(PALETTE_LIGHT);
  });

  it('falls back to PALETTE_DARK for unknown name', () => {
    expect(resolvePalette('nonexistent')).toBe(PALETTE_DARK);
  });

  it('returns a custom palette object as-is when no overrides', () => {
    const custom = { ...PALETTE_DARK, name: 'custom', primary: '#ff0000' };
    expect(resolvePalette(custom)).toBe(custom);
  });

  it('applies overrides on top of a named palette', () => {
    const result = resolvePalette('dark', { primary: '#ff0000' });
    expect(result.primary).toBe('#ff0000');
    expect(result.background).toBe(PALETTE_DARK.background);
    expect(result.name).toBe('dark');
  });

  it('preserves override name when provided', () => {
    const result = resolvePalette('dark', { name: 'custom-dark', danger: '#000' });
    expect(result.name).toBe('custom-dark');
    expect(result.danger).toBe('#000');
  });

  it('applies overrides on top of a custom palette', () => {
    const custom = { ...PALETTE_LIGHT, name: 'my-light' };
    const result = resolvePalette(custom, { danger: '#0000ff' });
    expect(result.danger).toBe('#0000ff');
    expect(result.background).toBe(PALETTE_LIGHT.background);
    expect(result.name).toBe('my-light');
  });
});

describe('PALETTES registry', () => {
  it('contains all four built-in palettes', () => {
    expect(Object.keys(PALETTES).sort()).toEqual(['cyberpunk', 'dark', 'light', 'midnight']);
  });

  it('each palette has a name matching its key', () => {
    for (const [key, palette] of Object.entries(PALETTES)) {
      expect(palette.name).toBe(key);
    }
  });

  it('each palette has a non-empty nodeColors array', () => {
    for (const palette of Object.values(PALETTES)) {
      expect(palette.nodeColors.length).toBeGreaterThan(0);
    }
  });

  it('each palette has all required semantic colors', () => {
    for (const palette of Object.values(PALETTES)) {
      expect(palette.danger).toBeTruthy();
      expect(palette.warning).toBeTruthy();
      expect(palette.safe).toBeTruthy();
      expect(palette.info).toBeTruthy();
    }
  });
});
