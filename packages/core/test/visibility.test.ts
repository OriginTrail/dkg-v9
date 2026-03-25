import { describe, it, expect } from 'vitest';
import { resolveVisibility, type ResolvedVisibility } from '../src/visibility.js';
import type { AccessPolicy, Visibility } from '../src/types.js';

describe('resolveVisibility()', () => {
  describe('new Visibility parameter', () => {
    it('visibility: "private" → ownerOnly, no broadcast', () => {
      const result = resolveVisibility('private');
      expect(result).toEqual<ResolvedVisibility>({
        accessPolicy: 'ownerOnly',
        allowedPeers: [],
        broadcast: false,
      });
    });

    it('visibility: "public" → public, broadcast', () => {
      const result = resolveVisibility('public');
      expect(result).toEqual<ResolvedVisibility>({
        accessPolicy: 'public',
        allowedPeers: [],
        broadcast: true,
      });
    });

    it('visibility: { peers: ["A", "B"] } → allowList with peers, no broadcast (sync only)', () => {
      const result = resolveVisibility({ peers: ['A', 'B'] });
      expect(result).toEqual<ResolvedVisibility>({
        accessPolicy: 'allowList',
        allowedPeers: ['A', 'B'],
        broadcast: false,
      });
    });

    it('visibility: { peers: [] } → throws (empty peer list)', () => {
      expect(() => resolveVisibility({ peers: [] })).toThrow(
        'visibility { peers: [...] } requires at least one valid peer ID',
      );
    });
  });

  describe('legacy parameters', () => {
    it('localOnly: true → ownerOnly, no broadcast', () => {
      const result = resolveVisibility(undefined, { localOnly: true });
      expect(result).toEqual<ResolvedVisibility>({
        accessPolicy: 'ownerOnly',
        allowedPeers: [],
        broadcast: false,
      });
    });

    it('private: true → ownerOnly, no broadcast', () => {
      const result = resolveVisibility(undefined, { private: true });
      expect(result).toEqual<ResolvedVisibility>({
        accessPolicy: 'ownerOnly',
        allowedPeers: [],
        broadcast: false,
      });
    });

    it('accessPolicy: "ownerOnly" → ownerOnly, no broadcast', () => {
      const result = resolveVisibility(undefined, { accessPolicy: 'ownerOnly' });
      expect(result).toEqual<ResolvedVisibility>({
        accessPolicy: 'ownerOnly',
        allowedPeers: [],
        broadcast: false,
      });
    });

    it('accessPolicy: "ownerOnly" with allowedPeers → preserves peers', () => {
      const result = resolveVisibility(undefined, {
        accessPolicy: 'ownerOnly',
        allowedPeers: ['peer1'],
      });
      expect(result.accessPolicy).toBe('ownerOnly');
      expect(result.allowedPeers).toEqual(['peer1']);
      expect(result.broadcast).toBe(false);
    });

    it('accessPolicy: "allowList" with allowedPeers → allowList, no broadcast (sync only)', () => {
      const result = resolveVisibility(undefined, {
        accessPolicy: 'allowList',
        allowedPeers: ['A'],
      });
      expect(result).toEqual<ResolvedVisibility>({
        accessPolicy: 'allowList',
        allowedPeers: ['A'],
        broadcast: false,
      });
    });

    it('accessPolicy: "allowList" without peers → empty peers, no broadcast (sync only)', () => {
      const result = resolveVisibility(undefined, { accessPolicy: 'allowList' });
      expect(result).toEqual<ResolvedVisibility>({
        accessPolicy: 'allowList',
        allowedPeers: [],
        broadcast: false,
      });
    });

    it('accessPolicy: "public" → public, broadcast', () => {
      const result = resolveVisibility(undefined, { accessPolicy: 'public' });
      expect(result).toEqual<ResolvedVisibility>({
        accessPolicy: 'public',
        allowedPeers: [],
        broadcast: true,
      });
    });
  });

  describe('precedence', () => {
    it('visibility takes precedence over legacy params', () => {
      const result = resolveVisibility('public', {
        accessPolicy: 'ownerOnly',
        localOnly: true,
        private: true,
      });
      expect(result.accessPolicy).toBe('public');
      expect(result.broadcast).toBe(true);
    });

    it('visibility: "private" overrides legacy public', () => {
      const result = resolveVisibility('private', { accessPolicy: 'public' });
      expect(result.accessPolicy).toBe('ownerOnly');
      expect(result.broadcast).toBe(false);
    });

    it('visibility peers override legacy ownerOnly', () => {
      const result = resolveVisibility({ peers: ['X'] }, { accessPolicy: 'ownerOnly' });
      expect(result.accessPolicy).toBe('allowList');
      expect(result.allowedPeers).toEqual(['X']);
      expect(result.broadcast).toBe(false);
    });
  });

  describe('defaults', () => {
    it('no params → public, broadcast (matches pre-migration behavior)', () => {
      const result = resolveVisibility(undefined);
      expect(result).toEqual<ResolvedVisibility>({
        accessPolicy: 'public',
        allowedPeers: [],
        broadcast: true,
      });
    });

    it('undefined visibility with empty legacy → public, broadcast', () => {
      const result = resolveVisibility(undefined, {});
      expect(result).toEqual<ResolvedVisibility>({
        accessPolicy: 'public',
        allowedPeers: [],
        broadcast: true,
      });
    });

    it('undefined visibility with undefined legacy → public, broadcast', () => {
      const result = resolveVisibility(undefined, undefined);
      expect(result).toEqual<ResolvedVisibility>({
        accessPolicy: 'public',
        allowedPeers: [],
        broadcast: true,
      });
    });
  });

  describe('edge cases', () => {
    it('legacy private: false does not trigger ownerOnly', () => {
      const result = resolveVisibility(undefined, { private: false });
      expect(result.accessPolicy).toBe('public');
      expect(result.broadcast).toBe(true);
    });

    it('legacy localOnly: false does not trigger ownerOnly', () => {
      const result = resolveVisibility(undefined, { localOnly: false });
      expect(result.accessPolicy).toBe('public');
      expect(result.broadcast).toBe(true);
    });

    it('legacy private + localOnly both true → ownerOnly', () => {
      const result = resolveVisibility(undefined, { private: true, localOnly: true });
      expect(result.accessPolicy).toBe('ownerOnly');
      expect(result.broadcast).toBe(false);
    });
  });

  describe('peer list validation', () => {
    it('trims whitespace from peer IDs', () => {
      const result = resolveVisibility({ peers: ['  peerA  ', ' peerB'] });
      expect(result.allowedPeers).toEqual(['peerA', 'peerB']);
    });

    it('deduplicates peer IDs', () => {
      const result = resolveVisibility({ peers: ['peerA', 'peerB', 'peerA'] });
      expect(result.allowedPeers).toEqual(['peerA', 'peerB']);
    });

    it('deduplicates after trimming', () => {
      const result = resolveVisibility({ peers: ['peerA', ' peerA ', 'peerB'] });
      expect(result.allowedPeers).toEqual(['peerA', 'peerB']);
    });

    it('throws when all entries are empty strings', () => {
      expect(() => resolveVisibility({ peers: ['', '  ', ''] })).toThrow(
        'visibility { peers: [...] } requires at least one valid peer ID',
      );
    });

    it('throws when peers array is empty', () => {
      expect(() => resolveVisibility({ peers: [] })).toThrow(
        'visibility { peers: [...] } requires at least one valid peer ID',
      );
    });

    it('filters empty strings but keeps valid peers', () => {
      const result = resolveVisibility({ peers: ['', 'peerA', '  ', 'peerB', ''] });
      expect(result.allowedPeers).toEqual(['peerA', 'peerB']);
      expect(result.accessPolicy).toBe('allowList');
      expect(result.broadcast).toBe(false);
    });
  });
});
