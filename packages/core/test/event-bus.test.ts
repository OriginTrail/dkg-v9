import { describe, it, expect, vi } from 'vitest';
import { TypedEventBus, DKGEvent } from '../src/index.js';

describe('TypedEventBus', () => {
  it('emits and receives events', () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();
    bus.on(DKGEvent.KC_PUBLISHED, handler);
    bus.emit(DKGEvent.KC_PUBLISHED, { kcId: '1' });
    expect(handler).toHaveBeenCalledWith({ kcId: '1' });
  });

  it('removes listeners with off', () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();
    bus.on('test', handler);
    bus.off('test', handler);
    bus.emit('test', null);
    expect(handler).not.toHaveBeenCalled();
  });

  it('once fires exactly once', () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();
    bus.once('test', handler);
    bus.emit('test', 'a');
    bus.emit('test', 'b');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('a');
  });

  it('does not crash on emit with no listeners', () => {
    const bus = new TypedEventBus();
    expect(() => bus.emit('nonexistent', null)).not.toThrow();
  });

  it('removeAllListeners clears specific event', () => {
    const bus = new TypedEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('a', h1);
    bus.on('b', h2);
    bus.removeAllListeners('a');
    bus.emit('a', null);
    bus.emit('b', null);
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
  });
});
