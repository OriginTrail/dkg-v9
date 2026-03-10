import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DkgChannelPlugin, CHANNEL_NAME } from '../src/DkgChannelPlugin.js';
import { DkgDaemonClient } from '../src/dkg-client.js';
import type { OpenClawPluginApi } from '../src/types.js';

function makeApi(overrides?: Partial<OpenClawPluginApi>): OpenClawPluginApi {
  return {
    config: {},
    registerTool: vi.fn(),
    registerHook: vi.fn(),
    on: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    ...overrides,
  };
}

describe('DkgChannelPlugin', () => {
  let client: DkgDaemonClient;
  let plugin: DkgChannelPlugin;

  beforeEach(() => {
    client = new DkgDaemonClient({ baseUrl: 'http://localhost:9200' });
    plugin = new DkgChannelPlugin({ enabled: true, port: 0 }, client);
  });

  afterEach(async () => {
    await plugin.stop();
    vi.restoreAllMocks();
  });

  it('should have channel name "dkg-ui"', () => {
    expect(CHANNEL_NAME).toBe('dkg-ui');
  });

  it('should start bridge server immediately on register', async () => {
    const api = makeApi();
    plugin.register(api);

    // Bridge starts asynchronously during register — no session_start hook needed
    expect(api.registerHook).not.toHaveBeenCalledWith(
      'session_start',
      expect.any(Function),
      expect.objectContaining({ name: 'dkg-channel-start' }),
    );
  });

  it('should call registerChannel if available', () => {
    const registerChannel = vi.fn();
    const api = makeApi({ registerChannel });
    plugin.register(api);

    expect(registerChannel).toHaveBeenCalledOnce();
    expect(registerChannel.mock.calls[0][0].name).toBe(CHANNEL_NAME);
  });

  it('should call registerHttpRoute if available', () => {
    const registerHttpRoute = vi.fn();
    const api = makeApi({ registerHttpRoute });
    plugin.register(api);

    expect(registerHttpRoute).toHaveBeenCalledOnce();
    expect(registerHttpRoute.mock.calls[0][0].method).toBe('POST');
    expect(registerHttpRoute.mock.calls[0][0].path).toBe('/api/dkg-channel/inbound');
  });

  it('should set useGatewayRoute when registerHttpRoute is available', () => {
    const registerHttpRoute = vi.fn();
    const api = makeApi({ registerHttpRoute });
    plugin.register(api);

    expect(plugin.isUsingGatewayRoute).toBe(true);
  });

  it('should not set useGatewayRoute when registerHttpRoute is not available', () => {
    const api = makeApi();
    plugin.register(api);

    expect(plugin.isUsingGatewayRoute).toBe(false);
  });

  it('processInbound should use plugin-sdk dispatch when runtime.channel is available', async () => {
    // Simulate a runtime with channel subsystem + config
    const mockRuntime = {
      channel: {
        routing: {
          resolveAgentRoute: vi.fn().mockReturnValue({ agentId: 'agent-1', sessionKey: 'session-1' }),
        },
        session: {
          resolveStorePath: vi.fn().mockReturnValue('/tmp/store'),
          readSessionUpdatedAt: vi.fn().mockReturnValue(undefined),
          recordInboundSession: vi.fn(),
        },
        reply: {
          resolveEnvelopeFormatOptions: vi.fn().mockReturnValue({}),
          formatAgentEnvelope: vi.fn().mockReturnValue('[DKG UI Owner] Hello'),
          dispatchReplyWithBufferedBlockDispatcher: vi.fn().mockImplementation(
            async (_ctx: any, _cfg: any, opts: any) => {
              // Simulate agent reply delivery
              await opts.deliver({ text: 'Hello from agent' });
            },
          ),
        },
      },
    };
    const mockCfg = { session: { dmScope: 'main' }, agents: {} };

    const api = makeApi() as any;
    api.runtime = mockRuntime;
    api.cfg = mockCfg;
    plugin.register(api);

    const reply = await plugin.processInbound('Hello', 'corr-1', 'owner');

    expect(reply.text).toBe('Hello from agent');
    expect(reply.correlationId).toBe('corr-1');
    expect(mockRuntime.channel.routing.resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({ channel: CHANNEL_NAME }),
    );
  });

  it('processInbound should throw if api is not registered', async () => {
    await expect(plugin.processInbound('test', 'c-1', 'owner'))
      .rejects.toThrow('Channel not registered');
  });

  it('processInbound should throw if no routing mechanism available', async () => {
    // Register with a bare api (no routeInboundMessage, no registerChannel)
    const api = makeApi();
    plugin.register(api);

    await expect(plugin.processInbound('test', 'c-1', 'owner'))
      .rejects.toThrow('No message routing mechanism available');
  });

  it('processInbound should wait for onOutbound when registerChannel is available', async () => {
    let channelAdapter: any;
    const registerChannel = vi.fn((opts) => { channelAdapter = opts.plugin; });
    const api = makeApi({ registerChannel });
    plugin.register(api);

    // Start the processInbound — it should create a pending request
    const replyPromise = plugin.processInbound('Hello', 'corr-2', 'owner');

    // Simulate the gateway calling onOutbound
    await channelAdapter.onOutbound({ correlationId: 'corr-2', text: 'Reply!', turnId: 't-2' });

    const reply = await replyPromise;
    expect(reply.text).toBe('Reply!');
    expect(reply.correlationId).toBe('corr-2');
  });

  it('stop should reject pending requests', async () => {
    const registerChannel = vi.fn();
    const api = makeApi({ registerChannel });
    plugin.register(api);

    // Start a request that will be rejected by stop()
    const promise = plugin.processInbound('test', 'c-1', 'owner').catch(e => e.message);

    // Stop the channel — should reject pending
    await plugin.stop();

    const errorMsg = await promise;
    expect(errorMsg).toBe('Channel shutting down');
  });

  it('stop should be safe to call multiple times', async () => {
    const api = makeApi();
    plugin.register(api);

    await plugin.stop();
    await plugin.stop();
  });
});
