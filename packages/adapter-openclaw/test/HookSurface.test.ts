import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HookSurface } from "../src/HookSurface";

describe("HookSurface", () => {
  let hookSurface: HookSurface;
  let mockApi: any;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    mockApi = { on: vi.fn(() => () => {}), registerHook: vi.fn(() => () => {}) };
    hookSurface = new HookSurface(mockApi, mockLogger, "auto");
  });

  afterEach(() => {
    hookSurface.unsubscribeAll();
    vi.clearAllMocks();
  });

  it("installs typed hook via api.on", () => {
    const handler = vi.fn();
    const unsub = hookSurface.install("typed", "test_event", handler);
    expect(unsub).toBeDefined();
    expect(mockApi.on).toHaveBeenCalledWith("test_event", expect.any(Function));
  });
  it("installs legacy hook via api.registerHook", () => {
    const handler = vi.fn();
    const unsub = hookSurface.install("legacy", "test_event", handler);
    expect(unsub).toBeDefined();
    expect(mockApi.registerHook).toHaveBeenCalledWith("test_event", expect.any(Function));
  });

  it("installs internal hook via globalThis", () => {
    const HOOK_SYMBOL = Symbol.for("openclaw.internalHookHandlers");
    const hookMap = new Map();
    (globalThis as any)[HOOK_SYMBOL] = hookMap;
    const handler = vi.fn();
    const unsub = hookSurface.install("internal", "internal_event", handler);
    expect(unsub).toBeDefined();
    expect(hookMap.has("internal_event")).toBe(true);
  });

  it("blocks double registration on same (kind, event)", () => {
    const handler1 = vi.fn();
    const unsub1 = hookSurface.install("typed", "dup_event", handler1);
    expect(unsub1).toBeDefined();
    const handler2 = vi.fn();
    const unsub2 = hookSurface.install("typed", "dup_event", handler2);
    expect(unsub2).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Double registration blocked"),
      expect.any(Object)
    );
  });
  it("allows different kinds for same event name", () => {
    const HOOK_SYMBOL = Symbol.for("openclaw.internalHookHandlers");
    const hookMap = new Map();
    (globalThis as any)[HOOK_SYMBOL] = hookMap;
    const unsub1 = hookSurface.install("typed", "multi_event", vi.fn());
    expect(unsub1).toBeDefined();
    const unsub2 = hookSurface.install("internal", "multi_event", vi.fn());
    expect(unsub2).toBeDefined();
    const unsub3 = hookSurface.install("legacy", "multi_event", vi.fn());
    expect(unsub3).toBeDefined();
  });

  it("tracks fire count for dispatched events", () => {
    hookSurface.install("typed", "fire_event", vi.fn());
    const stats = hookSurface.getDispatchStats();
    expect(stats["fire_event"]).toBeDefined();
    expect(stats["fire_event"].fireCount).toBe(0);
  });

  it("commits on first fire", (done) => {
    const handler = vi.fn();
    let wrappedHandler: any;
    mockApi.on = vi.fn((event: string, h: any) => { wrappedHandler = h; return () => {}; });
    hookSurface.install("typed", "first_fire_event", handler);
    wrappedHandler();
    setTimeout(() => {
      const stats = hookSurface.getDispatchStats();
      expect(stats["first_fire_event"].commitState).toBe("committed-at-first-fire");
      expect(stats["first_fire_event"].fireCount).toBe(1);
      done();
    }, 50);
  });
  it("commits on 30s timeout if never fired", (done) => {
    hookSurface.install("typed", "timeout_event", vi.fn());
    const stats = hookSurface.getDispatchStats();
    expect(stats["timeout_event"].commitState).toBe("uncommitted");
    setTimeout(() => {
      const updatedStats = hookSurface.getDispatchStats();
      expect(updatedStats["timeout_event"].commitState).toBe("committed-at-timeout");
      done();
    }, 30100);
  }).timeout(32000);

  it("unsubscribeAll clears all handlers and timers", () => {
    hookSurface.install("typed", "event1", vi.fn());
    hookSurface.install("legacy", "event2", vi.fn());
    hookSurface.unsubscribeAll();
    const stats = hookSurface.getDispatchStats();
    expect(stats).toBeDefined();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Unsubscribed all handlers"),
      expect.anything()
    );
  });

  it("warns when strategy=api-on overrides internal kind", () => {
    const HOOK_SYMBOL = Symbol.for("openclaw.internalHookHandlers");
    const hookMap = new Map();
    (globalThis as any)[HOOK_SYMBOL] = hookMap;
    const surfaceWithOverride = new HookSurface(mockApi, mockLogger, "api-on");
    surfaceWithOverride.install("internal", "override_event", vi.fn());
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Strategy override=api-on does not apply"),
      expect.any(Object)
    );
  });
  it("blocks typed hooks when strategy=off", () => {
    const surfaceOff = new HookSurface(mockApi, mockLogger, "off");
    const unsub = surfaceOff.install("typed", "blocked_event", vi.fn());
    expect(unsub).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("override=off"),
      expect.anything()
    );
  });

  it("returns null when api.on is unavailable", () => {
    const apiNoOn = { registerHook: vi.fn() };
    const surface = new HookSurface(apiNoOn, mockLogger, "auto");
    const unsub = surface.install("typed", "no_api_on", vi.fn());
    expect(unsub).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("api.on not available"),
      expect.anything()
    );
  });

  it("returns null when global hook map is unavailable", () => {
    const HOOK_SYMBOL = Symbol.for("openclaw.internalHookHandlers");
    (globalThis as any)[HOOK_SYMBOL] = undefined;
    const unsub = hookSurface.install("internal", "no_hook_map", vi.fn());
    expect(unsub).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Global hook map not available"),
      expect.anything()
    );
  });
  it("returns null when api.registerHook is unavailable", () => {
    const apiNoRegister = { on: vi.fn() };
    const surface = new HookSurface(apiNoRegister, mockLogger, "auto");
    const unsub = surface.install("legacy", "no_register_hook", vi.fn());
    expect(unsub).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("api.registerHook not available"),
      expect.anything()
    );
  });

  it("returns all installed events in dispatch stats", () => {
    hookSurface.install("typed", "event_a", vi.fn());
    hookSurface.install("legacy", "event_b", vi.fn());
    const stats = hookSurface.getDispatchStats();
    expect(Object.keys(stats)).toContain("event_a");
    expect(Object.keys(stats)).toContain("event_b");
    expect(stats["event_a"].installedVia).toBe("api.on");
    expect(stats["event_b"].installedVia).toBe("api.registerHook");
  });

  it("wrapped handler invokes original handler with arguments", (done) => {
    const handler = vi.fn();
    let wrappedHandler: any;
    mockApi.on = vi.fn((event: string, h: any) => { wrappedHandler = h; return () => {}; });
    hookSurface.install("typed", "args_event", handler);
    wrappedHandler("arg1", "arg2");
    setTimeout(() => {
      expect(handler).toHaveBeenCalledWith("arg1", "arg2");
      done();
    }, 50);
  });
  it("catches errors during installation and logs them", () => {
    const errorApi = { on: vi.fn(() => { throw new Error("api.on failed"); }) };
    const surface = new HookSurface(errorApi, mockLogger, "auto");
    const unsub = surface.install("typed", "error_event", vi.fn());
    expect(unsub).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to install typed hook"),
      expect.any(Object)
    );
  });

  it("creates new event set in global hook map if missing", () => {
    const HOOK_SYMBOL = Symbol.for("openclaw.internalHookHandlers");
    const hookMap = new Map();
    (globalThis as any)[HOOK_SYMBOL] = hookMap;
    hookSurface.install("internal", "new_event", vi.fn());
    expect(hookMap.has("new_event")).toBe(true);
    const handlers = hookMap.get("new_event");
    expect(handlers).toBeInstanceOf(Set);
    expect(handlers!.size).toBe(1);
  });

  it("internal hook unsubscribe removes handler from global set", () => {
    const HOOK_SYMBOL = Symbol.for("openclaw.internalHookHandlers");
    const hookMap = new Map();
    (globalThis as any)[HOOK_SYMBOL] = hookMap;
    const unsub = hookSurface.install("internal", "unsub_event", vi.fn());
    expect(hookMap.get("unsub_event")!.size).toBe(1);
    unsub!();
    expect(hookMap.get("unsub_event")!.size).toBe(0);
  });

  it("increments fireCount on each dispatch", (done) => {
    const handler = vi.fn();
    let wrappedHandler: any;
    mockApi.on = vi.fn((event: string, h: any) => { wrappedHandler = h; return () => {}; });
    hookSurface.install("typed", "multi_fire", handler);
    wrappedHandler();
    wrappedHandler();
    wrappedHandler();
    setTimeout(() => {
      const stats = hookSurface.getDispatchStats();
      expect(stats["multi_fire"].fireCount).toBe(3);
      done();
    }, 50);
  });
});
