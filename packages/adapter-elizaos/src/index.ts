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
 * Bot review A6 + 2nd-pass follow-ups (assistant-reply corruption /
 * duplicate-publish):
 *
 *   1. Wiring `onChatTurn` AND `onAssistantReply` to the SAME
 *      `persistChatTurn` handler used to double-publish — the second call
 *      either re-emitted the whole turn (duplicate metadata + new
 *      timestamp) or recorded the assistant text AS `userMessage` because
 *      `persistChatTurnImpl` derived `userText` from `message.content.text`.
 *   2. Fix v1 (commit ce5983a6) added a dedicated `onAssistantReplyHandler`
 *      but still forwarded the assistant `Memory` straight through, which
 *      meant `message.content.text` was again read as `userMessage`.
 *   3. Fix v2 (this revision) introduces an explicit `mode:
 *      'assistant-reply'` flag on the persist call. In that mode
 *      `persistChatTurnImpl` skips the user-message + turn-envelope quads
 *      and only writes the assistant `schema:Message` subject + a single
 *      `dkg:hasAssistantMessage` link onto the existing turn. The user
 *      message id from the matching `onChatTurn` call is forwarded via
 *      `userMessageId` so both calls land on the SAME `urn:dkg:chat:turn:`
 *      / `urn:dkg:chat:msg:user:` URIs (deterministic per (roomId,
 *      messageId) tuple).
 *
 * Frameworks that fire only `onChatTurn` keep working — the user-turn
 * branch already accepts both user-only and user+assistant payloads
 * (`options.assistantText` / `state.lastAssistantReply`). Frameworks that
 * fire both hooks no longer corrupt the turn.
 */
async function onAssistantReplyHandler(
  runtime: Parameters<typeof dkgService.onChatTurn>[0],
  message: Parameters<typeof dkgService.onChatTurn>[1],
  state?: Parameters<typeof dkgService.onChatTurn>[2],
  options: Record<string, unknown> = {},
) {
  // ElizaOS conventions: when an assistant reply fires, the matching
  // user-message id is normally on `message.replyTo` / `message.parentId`
  // / `message.inReplyTo`. We thread it through as `userMessageId` so the
  // assistant-reply path lands on the same turnUri as the user-turn.
  const userMessageId =
    (message as any)?.replyTo
    ?? (message as any)?.parentId
    ?? (message as any)?.inReplyTo
    ?? (options as any)?.userMessageId;
  const opts: Record<string, unknown> = {
    ...options,
    mode: 'assistant-reply' as const,
  };
  if (userMessageId) opts.userMessageId = String(userMessageId);
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
