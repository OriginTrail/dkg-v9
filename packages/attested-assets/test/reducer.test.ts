import { describe, it, expect } from 'vitest';
import { ReducerRegistry } from '../src/reducer.js';
import type { ReducerModule, ReducerConfig } from '../src/types.js';

function makeReducer(name: string, version: string, hash: string): ReducerModule {
  return {
    name,
    version,
    hash,
    reduce: (prev, inputs) => {
      const sum = inputs.reduce((acc, i) => acc + i[0], 0);
      return new Uint8Array([...prev, sum]);
    },
    genesisState: () => new Uint8Array([0]),
  };
}

describe('ReducerRegistry', () => {
  it('registers and retrieves a reducer', () => {
    const registry = new ReducerRegistry();
    const reducer = makeReducer('test', '1.0.0', 'hash-1');
    registry.register(reducer);

    expect(registry.has('test', '1.0.0')).toBe(true);
    expect(registry.get('test', '1.0.0')).toBe(reducer);
  });

  it('returns undefined for missing reducer', () => {
    const registry = new ReducerRegistry();
    expect(registry.get('missing', '1.0.0')).toBeUndefined();
    expect(registry.has('missing', '1.0.0')).toBe(false);
  });

  it('unregisters a reducer', () => {
    const registry = new ReducerRegistry();
    registry.register(makeReducer('test', '1.0.0', 'h'));
    registry.unregister('test', '1.0.0');
    expect(registry.has('test', '1.0.0')).toBe(false);
  });

  it('matches by name, version, and hash', () => {
    const registry = new ReducerRegistry();
    registry.register(makeReducer('test', '1.0.0', 'correct-hash'));

    expect(registry.matches({ name: 'test', version: '1.0.0', hash: 'correct-hash' })).toBe(true);
    expect(registry.matches({ name: 'test', version: '1.0.0', hash: 'wrong-hash' })).toBe(false);
    expect(registry.matches({ name: 'test', version: '2.0.0', hash: 'correct-hash' })).toBe(false);
  });

  it('resolve returns the module when hash matches', () => {
    const registry = new ReducerRegistry();
    const reducer = makeReducer('test', '1.0.0', 'h1');
    registry.register(reducer);

    expect(registry.resolve({ name: 'test', version: '1.0.0', hash: 'h1' })).toBe(reducer);
    expect(registry.resolve({ name: 'test', version: '1.0.0', hash: 'h2' })).toBeUndefined();
  });

  it('listRegistered returns all reducers', () => {
    const registry = new ReducerRegistry();
    registry.register(makeReducer('a', '1.0.0', 'ha'));
    registry.register(makeReducer('b', '2.0.0', 'hb'));

    const list = registry.listRegistered();
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.name).sort()).toEqual(['a', 'b']);
  });

  it('supports multiple versions of the same reducer', () => {
    const registry = new ReducerRegistry();
    registry.register(makeReducer('app', '1.0.0', 'h1'));
    registry.register(makeReducer('app', '2.0.0', 'h2'));

    expect(registry.has('app', '1.0.0')).toBe(true);
    expect(registry.has('app', '2.0.0')).toBe(true);
    expect(registry.get('app', '1.0.0')!.hash).toBe('h1');
    expect(registry.get('app', '2.0.0')!.hash).toBe('h2');
  });

  it('reducer actually computes correctly', () => {
    const reducer = makeReducer('test', '1.0.0', 'h');
    const genesis = reducer.genesisState([]);
    expect(genesis).toEqual(new Uint8Array([0]));

    const next = reducer.reduce(genesis, [new Uint8Array([3]), new Uint8Array([7])]);
    expect(next).toEqual(new Uint8Array([0, 10]));
  });
});
