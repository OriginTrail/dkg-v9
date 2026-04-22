/**
 * ElizaOS Actions for DKG V9.
 *
 * Each action maps to a DKGAgent capability. The DKG node must be
 * running (via DKGService) before actions are invoked.
 */
import { requireAgent } from './service.js';
import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from './types.js';

function hasSetting(runtime: IAgentRuntime, key: string): boolean {
  return !!runtime.getSetting(key);
}

export const dkgPublish: Action = {
  name: 'DKG_PUBLISH',
  similes: ['PUBLISH_TO_DKG', 'STORE_KNOWLEDGE', 'ADD_TO_GRAPH'],
  description: 'Publish knowledge (RDF triples) to the OriginTrail Decentralized Knowledge Graph.',

  validate: async (runtime: IAgentRuntime) => hasSetting(runtime, 'DKG_DATA_DIR') || true,

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    try {
      const agent = requireAgent();
      const text = message.content.text;

      const contextGraphMatch = text.match(/context[- ]?graph[:\s]+["']?([^\s"']+)/i)
        ?? text.match(/paranet[:\s]+["']?([^\s"']+)/i);
      const contextGraphId = contextGraphMatch?.[1] ?? 'default';

      const nquadsMatch = text.match(/```(?:nquads|n-quads|turtle)?\s*([\s\S]*?)```/i);
      if (!nquadsMatch) {
        callback({ text: 'Please provide N-Quads triples in a code block to publish.' });
        return false;
      }

      const quads = parseNQuads(nquadsMatch[1]);
      if (quads.length === 0) {
        callback({ text: 'No valid triples found in the code block.' });
        return false;
      }

      const result = await agent.publish(contextGraphId, quads as any);
      callback({
        text: `Published ${quads.length} triple(s) to context graph "${contextGraphId}". KC ID: ${result.kcId}, KAs: ${result.kaManifest.length}`,
      });
      return true;
    } catch (err: any) {
      callback({ text: `DKG publish failed: ${err.message}` });
      return false;
    }
  },

  examples: [
    [
      { user: '{{user1}}', content: { text: 'publish this to DKG:\n```nquads\n<http://ex.org/alice> <http://schema.org/name> "Alice" .\n```', action: 'DKG_PUBLISH' } },
      { user: '{{user2}}', content: { text: 'Published 1 triple(s) to context graph "default".' } },
    ],
  ],
};

export const dkgQuery: Action = {
  name: 'DKG_QUERY',
  similes: ['QUERY_DKG', 'SEARCH_KNOWLEDGE', 'SPARQL_QUERY', 'ASK_DKG'],
  description: 'Query the DKG knowledge graph using SPARQL.',

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    try {
      const agent = requireAgent();
      const text = message.content.text;

      const sparqlMatch = text.match(/```(?:sparql)?\s*([\s\S]*?)```/i)
        ?? text.match(/(SELECT\s[\s\S]+)/i);
      if (!sparqlMatch) {
        callback({ text: 'Please provide a SPARQL query (in a code block or inline).' });
        return false;
      }

      const result = await agent.query(sparqlMatch[1].trim());
      const bindings = result.bindings;
      if (bindings.length === 0) {
        callback({ text: 'Query returned no results.' });
      } else {
        const formatted = bindings.slice(0, 20).map(row =>
          Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(', '),
        ).join('\n');
        callback({
          text: `Query returned ${bindings.length} result(s):\n${formatted}${bindings.length > 20 ? '\n... (truncated)' : ''}`,
        });
      }
      return true;
    } catch (err: any) {
      callback({ text: `DKG query failed: ${err.message}` });
      return false;
    }
  },

  examples: [
    [
      { user: '{{user1}}', content: { text: 'query the DKG:\n```sparql\nSELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10\n```', action: 'DKG_QUERY' } },
      { user: '{{user2}}', content: { text: 'Query returned 10 result(s):' } },
    ],
  ],
};

export const dkgFindAgents: Action = {
  name: 'DKG_FIND_AGENTS',
  similes: ['DISCOVER_AGENTS', 'FIND_AGENT', 'SEARCH_AGENTS', 'LIST_AGENTS'],
  description: 'Discover AI agents on the DKG network by skill or framework.',

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    try {
      const agent = requireAgent();
      const text = message.content.text.toLowerCase();

      const skillMatch = text.match(/skill[:\s]+["']?([^\s"']+)/i);
      if (skillMatch) {
        const offerings = await agent.findSkills({ skillType: skillMatch[1] });
        if (offerings.length === 0) {
          callback({ text: `No agents found offering skill "${skillMatch[1]}".` });
        } else {
          const list = offerings.map(o =>
            `- ${o.agentName}: ${o.skillType} (${o.pricePerCall ?? 0} ${o.currency ?? 'TRAC'})`,
          ).join('\n');
          callback({ text: `Found ${offerings.length} agent(s) with that skill:\n${list}` });
        }
        return true;
      }

      const frameworkMatch = text.match(/framework[:\s]+["']?(\w+)/i);
      const agents = await agent.findAgents(
        frameworkMatch ? { framework: frameworkMatch[1] } : undefined,
      );
      if (agents.length === 0) {
        callback({ text: 'No agents found on the network.' });
      } else {
        const list = agents.map(a =>
          `- ${a.name} (${a.peerId.slice(0, 12)}...): ${a.framework ?? 'unknown'}`,
        ).join('\n');
        callback({ text: `Found ${agents.length} agent(s):\n${list}` });
      }
      return true;
    } catch (err: any) {
      callback({ text: `Agent discovery failed: ${err.message}` });
      return false;
    }
  },

  examples: [
    [
      { user: '{{user1}}', content: { text: 'find agents with skill: ImageAnalysis', action: 'DKG_FIND_AGENTS' } },
      { user: '{{user2}}', content: { text: 'Found 2 agent(s) with that skill:' } },
    ],
  ],
};

export const dkgSendMessage: Action = {
  name: 'DKG_SEND_MESSAGE',
  similes: ['MESSAGE_AGENT', 'CHAT_AGENT', 'DM_AGENT'],
  description: 'Send an encrypted message to another DKG agent.',

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    try {
      const agent = requireAgent();
      const text = message.content.text;

      const peerMatch = text.match(/peer[:\s]+["']?([^\s"']+)/i);
      if (!peerMatch) {
        callback({ text: 'Please specify a peer ID to message.' });
        return false;
      }

      const msgMatch = text.match(/message[:\s]+["'](.+?)["']/i)
        ?? text.match(/say[:\s]+["'](.+?)["']/i);
      const msgText = msgMatch?.[1] ?? text.replace(/.*peer[:\s]+["']?[^\s"']+["']?\s*/i, '').trim();

      const result = await agent.sendChat(peerMatch[1], msgText);
      if (result.delivered) {
        callback({ text: `Message delivered to ${peerMatch[1].slice(0, 12)}...` });
      } else {
        callback({ text: `Message delivery failed: ${result.error ?? 'unknown error'}` });
      }
      return true;
    } catch (err: any) {
      callback({ text: `Message send failed: ${err.message}` });
      return false;
    }
  },

  examples: [
    [
      { user: '{{user1}}', content: { text: 'message peer: 12D3KooW... say: "Hello!"', action: 'DKG_SEND_MESSAGE' } },
      { user: '{{user2}}', content: { text: 'Message delivered to 12D3KooW...' } },
    ],
  ],
};

export const dkgInvokeSkill: Action = {
  name: 'DKG_INVOKE_SKILL',
  similes: ['CALL_SKILL', 'USE_SKILL', 'RUN_SKILL', 'INVOKE_AGENT'],
  description: 'Invoke a remote agent skill on the DKG network.',

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    try {
      const agent = requireAgent();
      const text = message.content.text;

      const peerMatch = text.match(/peer[:\s]+["']?([^\s"']+)/i);
      const skillMatch = text.match(/skill[:\s]+["']?([^\s"']+)/i);
      if (!peerMatch || !skillMatch) {
        callback({ text: 'Please specify both a peer ID and skill URI.' });
        return false;
      }

      const inputMatch = text.match(/input[:\s]+["'](.+?)["']/i)
        ?? text.match(/```([\s\S]*?)```/);
      const input = inputMatch?.[1] ?? '';

      const response = await agent.invokeSkill(
        peerMatch[1],
        skillMatch[1],
        new TextEncoder().encode(input),
      );

      if (response.success && response.outputData) {
        callback({ text: `Skill response: ${new TextDecoder().decode(response.outputData)}` });
      } else {
        callback({ text: `Skill invocation ${response.success ? 'ok' : 'failed'}: ${response.error ?? 'no output'}` });
      }
      return true;
    } catch (err: any) {
      callback({ text: `Skill invocation failed: ${err.message}` });
      return false;
    }
  },

  examples: [
    [
      { user: '{{user1}}', content: { text: 'invoke skill: ImageAnalysis on peer: 12D3KooW... input: "analyze this"', action: 'DKG_INVOKE_SKILL' } },
      { user: '{{user2}}', content: { text: 'Skill response: ...' } },
    ],
  ],
};

/**
 * DKG_PERSIST_CHAT_TURN — fulfils spec §09A_FRAMEWORK_ADAPTERS chat-turn
 * persistence contract. Stores the user message + assistant reply (when
 * present) into the agent's working-memory graph as RDF triples so that
 * downstream queries can recover the chat history through the DKG node
 * itself. See BUGS_FOUND.md K-11.
 */
export const dkgPersistChatTurn: Action = {
  name: 'DKG_PERSIST_CHAT_TURN',
  similes: ['STORE_CHAT_TURN', 'PERSIST_CHAT', 'STORE_CHAT', 'RECORD_TURN', 'SAVE_CHAT_TURN'],
  description:
    'Persist a chat turn (user message + assistant reply) into the DKG ' +
    'working-memory graph so it can be retrieved later via SPARQL.',

  validate: async () => true,

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: Record<string, unknown>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    try {
      const agent = requireAgent();
      const result = await persistChatTurnImpl(agent, runtime, message, state, options);
      callback({ text: `Chat turn persisted (${result.tripleCount} triples).` });
      return true;
    } catch (err: any) {
      callback({ text: `Chat turn persist failed: ${err.message}` });
      return false;
    }
  },

  examples: [
    [
      { user: '{{user1}}', content: { text: 'remember this conversation', action: 'DKG_PERSIST_CHAT_TURN' } },
      { user: '{{user2}}', content: { text: 'Chat turn persisted.' } },
    ],
  ],
};

/**
 * Minimal agent contract required by {@link persistChatTurnImpl}.
 *
 * Bot review A1/A3: chat-turn persistence MUST NOT go through the canonical
 * `agent.publish()` pipeline — that writes finalized data to the broadcast
 * data graph (and requires the CG to already exist on-chain), which means
 * every user/assistant message would be shipped to the network and charged
 * against KA/finalization semantics. Chat history belongs in the per-agent
 * working-memory assertion graph instead (`agent.assertion.write`), which
 * stays local to the node and satisfies the `view: 'working-memory'`
 * retrieval contract this hook advertises.
 *
 * Bot review A2: fresh installs don't have a `chat` context graph. Before
 * writing we best-effort call `ensureContextGraphLocal` so the CG exists
 * locally (this is idempotent if it already exists) and won't throw on
 * the first turn persisted. In production this method is on `DKGAgent`;
 * tests may omit it and the ensure step becomes a no-op.
 *
 * The tuple type is deliberately wide so unit tests can plug in a capturing
 * fake without booting a real DKGAgent (libp2p + chain + storage are
 * validated end-to-end by the downstream integration suites).
 */
export interface ChatTurnPersistenceAgent {
  assertion: {
    write: (
      contextGraphId: string,
      name: string,
      quads: Array<{ subject: string; predicate: string; object: string; graph?: string }>,
      opts?: { subGraphName?: string },
    ) => Promise<void>;
  };
  ensureContextGraphLocal?: (opts: {
    id: string;
    name: string;
    description?: string;
    curated?: boolean;
  }) => Promise<void>;
}

/** Shared implementation used by the action AND the dkgService.persistChatTurn / hooks.onChatTurn surface.
 *
 *  Bot review A1/A2/A3/A4/A5 fixes:
 *    - A1/A3: writes via `agent.assertion.write` (WM path) instead of
 *             `agent.publish` (broadcast/finalization path).
 *    - A2:    lazily ensures the target CG exists locally so fresh
 *             installs with the default `chat` CG don't throw.
 *    - A3:    builds real `Quad[]` (with `graph: ''`; the publisher
 *             rewrites this to the real assertion graph URI) so
 *             serialization doesn't produce `<undefined>` named graphs.
 *    - A4:    emits the `rdf:type` object as a bare IRI — the publisher
 *             wraps non-literals in `<...>` on serialization, so the
 *             previous `'<...>'` double-wrapped to `<<...>>`.
 *    - A5:    uses `encodeURIComponent` for reversible ID encoding so
 *             `room/a` and `room:a` don't collide onto the same subject.
 */
export async function persistChatTurnImpl(
  agent: ChatTurnPersistenceAgent,
  runtime: IAgentRuntime,
  message: Memory,
  state: State,
  options: Record<string, unknown>,
): Promise<{ tripleCount: number; turnUri: string; kcId: string }> {
  const optsAny = options as Record<string, unknown> & {
    contextGraphId?: string;
    assistantText?: string;
    assistantReply?: { text?: string };
    assertionName?: string;
  };

  const userId = (message as any).userId ?? 'anonymous';
  const roomId = (message as any).roomId ?? 'default';
  const memId = (message as any).id ?? `mem-${Date.now()}`;
  const userText = message.content?.text ?? '';
  const assistantText =
    optsAny.assistantText
    ?? optsAny.assistantReply?.text
    ?? (state as any)?.lastAssistantReply
    ?? '';
  const characterName = runtime.character?.name ?? runtime.getSetting('DKG_AGENT_NAME') ?? 'elizaos-agent';
  const contextGraphId = optsAny.contextGraphId ?? runtime.getSetting('DKG_CHAT_CG') ?? 'chat';
  const assertionName = optsAny.assertionName ?? runtime.getSetting('DKG_CHAT_ASSERTION') ?? 'chat-turns';
  const turnUri = `urn:dkg:elizaos:chat:${encodeIriSegment(roomId)}:${encodeIriSegment(memId)}`;
  const ts = new Date().toISOString();

  const quads: Array<{ subject: string; predicate: string; object: string; graph: string }> = [
    // A4: bare IRI for the rdf:type object. Publisher wraps non-literals
    //     in <...> at serialization; previously we stored `'<...>'` which
    //     then serialized as `<<...>>` and the write failed.
    { subject: turnUri, predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
      object: 'https://schema.origintrail.io/dkg/v10/ChatTurn', graph: '' },
    { subject: turnUri, predicate: 'https://schema.origintrail.io/dkg/v10/userId',
      object: rdfString(userId), graph: '' },
    { subject: turnUri, predicate: 'https://schema.origintrail.io/dkg/v10/roomId',
      object: rdfString(roomId), graph: '' },
    { subject: turnUri, predicate: 'https://schema.origintrail.io/dkg/v10/agentName',
      object: rdfString(characterName), graph: '' },
    { subject: turnUri, predicate: 'https://schema.origintrail.io/dkg/v10/userMessage',
      object: rdfString(userText), graph: '' },
    { subject: turnUri, predicate: 'https://schema.origintrail.io/dkg/v10/timestamp',
      object: `${rdfString(ts)}^^<http://www.w3.org/2001/XMLSchema#dateTime>`, graph: '' },
  ];
  if (assistantText) {
    quads.push({
      subject: turnUri,
      predicate: 'https://schema.origintrail.io/dkg/v10/assistantReply',
      object: rdfString(assistantText),
      graph: '',
    });
  }

  // A2: best-effort lazy CG ensure. If the CG already exists this is a
  // cheap no-op; if the agent doesn't expose the method (unit tests) we
  // skip and let assertionWrite surface a real error. We intentionally do
  // NOT register on-chain here — that's a separate explicit operation.
  if (typeof agent.ensureContextGraphLocal === 'function') {
    await agent.ensureContextGraphLocal({
      id: contextGraphId,
      name: contextGraphId,
      description: 'ElizaOS chat-turn persistence context graph (auto-ensured)',
      curated: true,
    });
  }

  // A1/A3: write into the per-agent WM assertion graph, not the
  // broadcast data graph.
  await agent.assertion.write(contextGraphId, assertionName, quads);
  return { tripleCount: quads.length, turnUri, kcId: '' };
}

/**
 * Bot review A5: reversible URI-segment encoding. Replacing every non-[A-Za-z0-9_.-]
 * byte with `_` is lossy — `room/a` and `room:a` both collapse to `room_a`,
 * silently merging distinct rooms (or distinct messages) onto the same
 * `turnUri`. `encodeURIComponent` is round-trippable via `decodeURIComponent`
 * and keeps percent-encoded chars IRI-safe for our `urn:dkg:` scheme.
 *
 * We leave the legacy `escapeIri` export in place for back-compat with
 * any callers still importing it (none in-tree), but route chat-turn
 * encoding through `encodeIriSegment`.
 */
function encodeIriSegment(s: string): string {
  // Keep `.`, `-`, `_` unescaped (they're safe in our URN scheme);
  // everything else goes through encodeURIComponent.
  return encodeURIComponent(String(s));
}

function escapeIri(s: string): string {
  // Back-compat shim (intentionally unused by persistChatTurnImpl now).
  // Kept to avoid breaking hypothetical external importers. Consider
  // removing in the next breaking release.
  void encodeIriSegment; // silence linters that flag unused helper pairs
  return String(s).replace(/[^A-Za-z0-9_.-]/g, '_');
}

function rdfString(s: string): string {
  const escaped = String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

function parseNQuads(text: string): Array<{ subject: string; predicate: string; object: string; graph?: string }> {
  const quads: Array<{ subject: string; predicate: string; object: string; graph?: string }> = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^<([^>]+)>\s+<([^>]+)>\s+("[^"]*(?:\\.[^"]*)*"(?:@\w+|(?:\^\^<[^>]+>))?|<[^>]+>)\s*(?:<([^>]+)>)?\s*\.?\s*$/);
    if (!match) continue;
    quads.push({
      subject: match[1],
      predicate: match[2],
      object: match[3].startsWith('<') ? match[3].slice(1, -1) : match[3],
      graph: match[4],
    });
  }
  return quads;
}
