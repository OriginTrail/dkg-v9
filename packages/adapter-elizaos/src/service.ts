/**
 * DKGService — manages the DKG agent lifecycle within ElizaOS.
 *
 * Initialized once per ElizaOS agent runtime. Reads config from runtime
 * settings (DKG_*), starts a DKGAgent, and publishes the agent profile.
 */
import { DKGAgent, type DKGAgentConfig } from '@origintrail-official/dkg-agent';
import type { IAgentRuntime, Memory, Service, State } from './types.js';
import { persistChatTurnImpl } from './actions.js';

let agentInstance: DKGAgent | null = null;

export function getAgent(): DKGAgent | null {
  return agentInstance;
}

function requireAgent(): DKGAgent {
  if (!agentInstance) throw new Error('DKG node not started — is DKGService initialized?');
  return agentInstance;
}

export { requireAgent };

/**
 * Bot review A7: export a real extended service type instead of only
 * asserting the object literal. Without this, downstream TypeScript
 * consumers would only see `Service` and would have to cast to `any`
 * to reach `persistChatTurn`/`onChatTurn`. Declaring the symbol itself
 * as `DKGService` — a named interface that extends `Service` with the
 * new chat-turn surface — preserves the API in the emitted `.d.ts`.
 */
export interface DKGService extends Service {
  persistChatTurn(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
  ): Promise<{ tripleCount: number; turnUri: string; kcId: string }>;
  onChatTurn(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
  ): Promise<{ tripleCount: number; turnUri: string; kcId: string }>;
}

export const dkgService: DKGService = {
  name: 'dkg-node',

  async initialize(runtime: IAgentRuntime): Promise<void> {
    if (agentInstance) return;

    const relayPeersRaw = runtime.getSetting('DKG_RELAY_PEERS');
    const bootstrapRaw = runtime.getSetting('DKG_BOOTSTRAP_PEERS');

    const config: DKGAgentConfig = {
      name: runtime.character?.name ?? runtime.getSetting('DKG_AGENT_NAME') ?? 'elizaos-agent',
      framework: 'ElizaOS',
      description: runtime.getSetting('DKG_AGENT_DESCRIPTION'),
      dataDir: runtime.getSetting('DKG_DATA_DIR') ?? '.dkg/elizaos',
      listenPort: runtime.getSetting('DKG_LISTEN_PORT')
        ? parseInt(runtime.getSetting('DKG_LISTEN_PORT')!, 10)
        : undefined,
      relayPeers: relayPeersRaw ? relayPeersRaw.split(',').map(s => s.trim()) : undefined,
      bootstrapPeers: bootstrapRaw ? bootstrapRaw.split(',').map(s => s.trim()) : undefined,
    };

    agentInstance = await DKGAgent.create(config);
    await agentInstance.start();
    await agentInstance.publishProfile();
  },

  async cleanup(): Promise<void> {
    if (!agentInstance) return;
    await agentInstance.stop();
    agentInstance = null;
  },

  /**
   * Spec §09A_FRAMEWORK_ADAPTERS — chat-turn persistence hook surface.
   * Delegates to the same RDF-emitting impl as DKG_PERSIST_CHAT_TURN so
   * frameworks that don't expose actions can still route turns through
   * the DKG node. See BUGS_FOUND.md K-11.
   */
  async persistChatTurn(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options: Record<string, unknown> = {},
  ): Promise<{ tripleCount: number; turnUri: string; kcId: string }> {
    const agent = requireAgent();
    return persistChatTurnImpl(agent, runtime, message, (state ?? {}) as State, options);
  },

  /** Alias used by the ElizaOS hook contract (`hooks.onChatTurn`). */
  async onChatTurn(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options: Record<string, unknown> = {},
  ): Promise<{ tripleCount: number; turnUri: string; kcId: string }> {
    return dkgService.persistChatTurn(runtime, message, state, options);
  },
};
