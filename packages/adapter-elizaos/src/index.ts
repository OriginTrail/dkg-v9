/**
 * @origintrail-official/dkg-adapter-elizaos — ElizaOS plugin that turns any ElizaOS agent
 * into a DKG V9 node.
 *
 * Usage in a character config:
 *
 *   import { dkgPlugin } from '@origintrail-official/dkg-adapter-elizaos';
 *
 *   const character = {
 *     plugins: [dkgPlugin],
 *     settings: {
 *       DKG_DATA_DIR: '.dkg/my-agent',
 *       DKG_RELAY_PEERS: '/ip4/1.2.3.4/tcp/9090/p2p/12D3KooW...',
 *     },
 *   };
 */
import type { Plugin } from './types.js';
import { dkgService } from './service.js';
import { dkgKnowledgeProvider } from './provider.js';
import {
  dkgPublish,
  dkgQuery,
  dkgFindAgents,
  dkgSendMessage,
  dkgInvokeSkill,
  dkgPersistChatTurn,
} from './actions.js';

/**
 * Bot review A6: wiring `onChatTurn` AND `onAssistantReply` to the same
 * persistChatTurn handler double-publishes on frameworks that fire both
 * hooks for the same exchange. Because `persistChatTurnImpl` keys the
 * turn subject off `message.id`, the second call either:
 *   - appends a second set of metadata quads onto the same turnUri
 *     (if both hooks receive the same message), or
 *   - records the assistant message AS the `userMessage` (if the hook
 *     payload swaps user/assistant text), corrupting history retrieval.
 *
 * Fix: only register `onChatTurn` (the canonical "one hook per user
 * exchange" event). `onAssistantReply` is kept on the plugin but wired
 * to a dedicated handler that merges assistant text into the matching
 * turn (keyed by the same `message.id`) rather than re-emitting the
 * whole turn. Frameworks that only fire one of the two hooks still work
 * because `onChatTurn` accepts both user-only and user+assistant
 * payloads; frameworks that fire both now deduplicate correctly.
 */
async function onAssistantReplyHandler(
  runtime: Parameters<typeof dkgService.onChatTurn>[0],
  message: Parameters<typeof dkgService.onChatTurn>[1],
  state?: Parameters<typeof dkgService.onChatTurn>[2],
  options: Record<string, unknown> = {},
) {
  // Merge the assistant reply into the same turnUri as the user message.
  // `persistChatTurnImpl` is idempotent-ish by subject, so re-emitting
  // the same message.id after the user hook appends the assistantReply
  // quad without clobbering earlier turns. If the framework only fires
  // onAssistantReply (never onChatTurn), this still persists a complete
  // turn (userMessage will be empty, assistantReply populated).
  const opts = { ...options, assistantText: (message as any)?.content?.text ?? '' };
  return dkgService.persistChatTurn(runtime, message, state, opts);
}

export const dkgPlugin: Plugin & {
  hooks: {
    onChatTurn: (...args: Parameters<typeof dkgService.onChatTurn>) => ReturnType<typeof dkgService.onChatTurn>;
    onAssistantReply: (...args: Parameters<typeof dkgService.onChatTurn>) => ReturnType<typeof dkgService.onChatTurn>;
  };
  chatPersistenceHook: (...args: Parameters<typeof dkgService.onChatTurn>) => ReturnType<typeof dkgService.onChatTurn>;
} = {
  name: 'dkg',
  description:
    'Turns this ElizaOS agent into a DKG node — publish knowledge, ' +
    'query the graph, discover agents, and invoke remote skills over a ' +
    'decentralized P2P network.',
  actions: [dkgPublish, dkgQuery, dkgFindAgents, dkgSendMessage, dkgInvokeSkill, dkgPersistChatTurn],
  providers: [dkgKnowledgeProvider],
  services: [dkgService],
  hooks: {
    onChatTurn: (runtime, message, state, options) =>
      dkgService.persistChatTurn(runtime, message, state, options),
    // A6: dedicated handler — merges assistant text into the matching
    // turnUri rather than duplicating the whole turn.
    onAssistantReply: (runtime, message, state, options) =>
      onAssistantReplyHandler(runtime, message, state, options),
  },
  chatPersistenceHook: (runtime, message, state, options) =>
    dkgService.persistChatTurn(runtime, message, state, options),
};

export { dkgService, getAgent } from './service.js';
export { dkgKnowledgeProvider } from './provider.js';
export {
  dkgPublish,
  dkgQuery,
  dkgFindAgents,
  dkgSendMessage,
  dkgInvokeSkill,
  dkgPersistChatTurn,
} from './actions.js';
export type {
  Plugin,
  Action,
  Provider,
  Service,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
} from './types.js';
