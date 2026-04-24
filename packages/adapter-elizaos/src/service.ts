/**
 * DKGService — manages the DKG agent lifecycle within ElizaOS.
 *
 * Initialized once per ElizaOS agent runtime. Reads config from runtime
 * settings (DKG_*), starts a DKGAgent, and publishes the agent profile.
 */
import { DKGAgent, type DKGAgentConfig } from '@origintrail-official/dkg-agent';
import type {
  ChatTurnPersistOptions,
  IAgentRuntime,
  Memory,
  PersistableMemory,
  Service,
  State,
} from './types.js';
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
 * Chat-turn persistence result shape — shared across every user-turn
 * and assistant-reply overload below.
 */
export interface ChatTurnPersistResult {
  tripleCount: number;
  turnUri: string;
  kcId: string;
}

/**
 * Options shape for the ASSISTANT-REPLY path.
 *
 * PR #229 bot review round 18 (r18-2): the assistant-reply path takes
 * a plain `Memory` (the ElizaOS-side assistant message may not have a
 * stable `id`), but it MUST carry `options.userMessageId` so the
 * persister can reconstruct the same `turnUri`/`userMsgUri` the
 * preceding user-turn hook emitted. Expressing that as a narrow type
 * lets the compiler catch the missing id instead of letting
 * `persistChatTurnImpl` throw at runtime.
 *
 * PR #229 bot review round 19 (r19-2): `userTurnPersisted` is also
 * MANDATORY on this overload. `persistChatTurnImpl` infers the flag
 * from "does `userMessageId` exist?" when it's omitted (see the
 * `legacyInference` branch in actions.ts), which is exactly the
 * unsafe shortcut round-13 introduced `ChatTurnPersistOptions.userTurnPersisted`
 * to close: a caller can know the parent id without knowing the
 * corresponding user-turn write succeeded (hook disabled, earlier
 * write failed, reconnect replay), and the cheap-append-only path
 * produces unreadable assistant replies. Requiring the boolean on
 * the TYPED overload forces the caller to think about whether the
 * user turn really made it to disk before taking the append path.
 *
 * Callers that genuinely don't know whether the user turn was
 * persisted (e.g. external integrations restarting mid-session)
 * should pass `userTurnPersisted: false` — that routes the
 * persister through the safe full-envelope branch, which always
 * produces a readable reply.
 */
export interface AssistantReplyChatTurnOptions extends ChatTurnPersistOptions {
  readonly mode: 'assistant-reply';
  readonly userMessageId: string;
  readonly userTurnPersisted: boolean;
}

/**
 * Options shape for the USER-TURN path.
 *
 * User-turn persistence derives the turn source id from `message.id`
 * (see `PersistableMemory`), so `userMessageId` MUST be omitted on
 * this path. `mode` is either explicitly `'user-turn'` or left
 * undefined (the default).
 */
export interface UserTurnChatTurnOptions extends ChatTurnPersistOptions {
  readonly mode?: 'user-turn';
  readonly userMessageId?: never;
}

/**
 * Bot review A7 + round 18 (r18-2): export a real extended service
 * type with *split signatures* so the compiler enforces the
 * user-turn / assistant-reply contracts that `persistChatTurnImpl`
 * previously only enforced at runtime.
 *
 *   - User-turn path (default):
 *       `message: PersistableMemory` — `message.id` is mandatory.
 *       `options.mode` omitted or `'user-turn'`.
 *   - Assistant-reply path:
 *       `message: Memory` — `message.id` can be missing.
 *       `options.mode === 'assistant-reply'` AND
 *       `options.userMessageId` (the parent user-turn id) required.
 *
 * Without the split, downstream TS callers could legally pass a
 * `Memory` without `id` on the user-turn path and only discover the
 * violation via a runtime exception. Callers that still want the
 * loose-old-shape can pass through `Record<string, unknown>` options
 * via the catch-all overload, which still routes into the runtime
 * guard in `persistChatTurnImpl` — but the two typed overloads
 * above cover every documented call site in the adapter.
 */
export interface DKGService extends Service {
  persistChatTurn(
    runtime: IAgentRuntime,
    message: PersistableMemory,
    state?: State,
    options?: UserTurnChatTurnOptions,
  ): Promise<ChatTurnPersistResult>;
  persistChatTurn(
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options: AssistantReplyChatTurnOptions,
  ): Promise<ChatTurnPersistResult>;
  // Catch-all: preserved for legacy callers that went through
  // `dkgService as any` (and for the internal plugin wiring in
  // `src/index.ts` which must stay agnostic of the caller's mode).
  // New downstream code SHOULD use one of the typed overloads above.
  persistChatTurn(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
  ): Promise<ChatTurnPersistResult>;

  onChatTurn(
    runtime: IAgentRuntime,
    message: PersistableMemory,
    state?: State,
    options?: UserTurnChatTurnOptions,
  ): Promise<ChatTurnPersistResult>;
  onChatTurn(
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options: AssistantReplyChatTurnOptions,
  ): Promise<ChatTurnPersistResult>;
  // Catch-all (same rationale as persistChatTurn above).
  onChatTurn(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
  ): Promise<ChatTurnPersistResult>;
}

// Intermediate "loose" shape used by the implementation. TypeScript
// can't validate an object literal against a multi-overload method
// directly (the catch-all `Record<string, unknown>` options bag
// widens `AssistantReplyChatTurnOptions`'s indexed signature, which
// makes the strict-overload check fail). We build the loose object
// first, then assert it conforms to the public `DKGService` shape —
// the overload contract is still visible and enforced for every
// downstream caller, which is what r18-2 asks for.
interface DKGServiceImpl extends Service {
  persistChatTurn(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
  ): Promise<ChatTurnPersistResult>;
  onChatTurn(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
  ): Promise<ChatTurnPersistResult>;
}

const dkgServiceImpl: DKGServiceImpl = {
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
   *
   * PR #229 bot review round 18 (r18-2): the public interface splits
   * user-turn and assistant-reply overloads so the compiler enforces
   * the contract; the implementation below keeps the loose
   * `Memory + Record<string, unknown>` shape internally so existing
   * callers that went through `dkgService as any` still work at
   * runtime, and `persistChatTurnImpl` still provides the final
   * defence-in-depth via its own runtime guards.
   */
  async persistChatTurn(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options: Record<string, unknown> = {},
  ): Promise<ChatTurnPersistResult> {
    const agent = requireAgent();
    return persistChatTurnImpl(agent, runtime, message, (state ?? {}) as State, options);
  },

  /** Alias used by the ElizaOS hook contract (`hooks.onChatTurn`). */
  async onChatTurn(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options: Record<string, unknown> = {},
  ): Promise<ChatTurnPersistResult> {
    return dkgServiceImpl.persistChatTurn(runtime, message, state, options);
  },
};

// PR #229 bot review round 18 (r18-2): publish the same runtime
// object under the narrowed `DKGService` contract so downstream TS
// consumers see the split user-turn / assistant-reply overloads and
// get compile-time errors when they omit `message.id` on the
// user-turn path or `options.userMessageId` on the assistant-reply
// path. The runtime behaviour is identical — every call still routes
// through `persistChatTurnImpl`, whose own runtime guards provide
// defence-in-depth for callers that bypass the TS types (e.g. the
// plugin wiring in `src/index.ts`).
export const dkgService: DKGService = dkgServiceImpl as unknown as DKGService;
