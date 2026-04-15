import { afterEach, describe, expect, it, vi } from 'vitest';
import { SemanticEnrichmentWorker } from '../src/SemanticEnrichmentWorker.js';
import type { DkgDaemonClient, SemanticEnrichmentEventLease } from '../src/dkg-client.js';
import type { OpenClawPluginApi } from '../src/types.js';

function makeApi(runtime?: OpenClawPluginApi['runtime']): OpenClawPluginApi {
  return {
    config: {},
    registerTool: vi.fn(),
    registerHook: vi.fn(),
    on: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    runtime,
  };
}

function makeClient(overrides: Partial<DkgDaemonClient> = {}): DkgDaemonClient {
  return {
    baseUrl: 'http://127.0.0.1:9200',
    getAuthToken: vi.fn(),
    getStatus: vi.fn(),
    query: vi.fn(),
    storeChatTurn: vi.fn(),
    claimSemanticEnrichmentEvent: vi.fn().mockResolvedValue({ event: null }),
    renewSemanticEnrichmentEvent: vi.fn().mockResolvedValue({ renewed: true }),
    appendSemanticEnrichmentEvent: vi.fn().mockResolvedValue({
      applied: true,
      completed: true,
      semanticEnrichment: {
        eventId: 'evt-1',
        status: 'completed',
        semanticTripleCount: 1,
        updatedAt: new Date().toISOString(),
      },
    }),
    completeSemanticEnrichmentEvent: vi.fn(),
    failSemanticEnrichmentEvent: vi.fn().mockResolvedValue({ status: 'pending' }),
    fetchFileText: vi.fn(),
    ...overrides,
  } as unknown as DkgDaemonClient;
}

describe('SemanticEnrichmentWorker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('probes api.runtime.subagent and reports missing methods when the surface is incomplete', () => {
    const worker = new SemanticEnrichmentWorker(
      makeApi({
        subagent: {
          run: vi.fn(),
          waitForRun: vi.fn(),
        } as any,
      }),
      makeClient(),
    );

    const probe = worker.getRuntimeProbe();
    expect(probe.supported).toBe(false);
    expect(probe.missing).toEqual(expect.arrayContaining(['getSessionMessages', 'deleteSession']));
    expect(probe.subagent).toBeNull();
  });

  it('dedupes repeated daemon wakes by event id while executing work only through the daemon lease queue', async () => {
    const claim = vi.fn<() => Promise<{ event: SemanticEnrichmentEventLease | null }>>()
      .mockResolvedValueOnce({
        event: {
          id: 'evt-1',
          kind: 'chat_turn',
          payload: {
            kind: 'chat_turn',
            sessionId: 'openclaw:dkg-ui',
            turnId: 'turn-123',
            contextGraphId: 'agent-context',
            assertionName: 'chat-turns',
            assertionUri: 'did:dkg:context-graph:agent-context/assertion/peer/chat-turns',
            sessionUri: 'urn:dkg:chat:session:openclaw:dkg-ui',
            turnUri: 'urn:dkg:chat:turn:turn-123',
            userMessage: 'hello',
            assistantReply: 'hi',
            persistenceState: 'stored',
            projectContextGraphId: 'project-42',
          },
          status: 'leased',
          attempts: 1,
          maxAttempts: 5,
          leaseOwner: 'worker',
          leaseExpiresAt: Date.now() + 60_000,
          nextAttemptAt: Date.now(),
        },
      })
      .mockResolvedValueOnce({ event: null })
      .mockResolvedValue({ event: null });
    const query = vi.fn().mockResolvedValue({
      result: {
        bindings: [
          {
            s: { value: 'https://schema.org/Person' },
            p: { value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
            o: { value: 'http://www.w3.org/2000/01/rdf-schema#Class' },
          },
        ],
      },
    });
    const append = vi.fn().mockResolvedValue({
      applied: true,
      completed: true,
      semanticEnrichment: {
        eventId: 'evt-1',
        status: 'completed',
        semanticTripleCount: 1,
        updatedAt: new Date().toISOString(),
      },
    });
    const client = makeClient({
      claimSemanticEnrichmentEvent: claim,
      query,
      appendSemanticEnrichmentEvent: append,
    });
    const run = vi.fn().mockResolvedValue({ runId: 'run-1' });
    const waitForRun = vi.fn().mockResolvedValue({ status: 'completed' });
    const getSessionMessages = vi.fn().mockResolvedValue({
      messages: [
        {
          role: 'assistant',
          text: '{"triples":[{"subject":"urn:dkg:chat:turn:turn-123","predicate":"https://schema.org/about","object":"https://schema.org/Person"}]}',
        },
      ],
    });
    const deleteSession = vi.fn().mockResolvedValue(undefined);

    const worker = new SemanticEnrichmentWorker(
      makeApi({
        subagent: {
          run,
          waitForRun,
          getSessionMessages,
          deleteSession,
        } as any,
      }),
      client,
    );

    worker.noteWake({
      kind: 'chat_turn',
      eventKey: 'evt-1',
      triggerSource: 'daemon',
      uiContextGraphId: 'project-42',
      payload: { userMessage: 'hello' },
    });
    worker.noteWake({
      kind: 'chat_turn',
      eventKey: 'evt-1',
      triggerSource: 'daemon',
      payload: { assistantReply: 'hi' },
    });

    expect(worker.getPendingSummaries()).toHaveLength(1);
    expect(worker.getPendingSummaries()[0].eventKey).toBe('evt-1');
    expect(worker.getPendingSummaries()[0].triggerSources).toEqual(['daemon']);

    await worker.flush();

    expect(claim.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(run).toHaveBeenCalledTimes(1);
    expect(waitForRun).toHaveBeenCalledTimes(1);
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(
      'evt-1',
      worker.getWorkerInstanceId(),
      [
        {
          subject: 'urn:dkg:chat:turn:turn-123',
          predicate: 'https://schema.org/about',
          object: 'https://schema.org/Person',
        },
      ],
    );
    expect(worker.getPendingSummaries()).toHaveLength(0);
  });

  it('treats non-successful wait statuses as failures and never appends triples from an incomplete run', async () => {
    const claim = vi.fn<() => Promise<{ event: SemanticEnrichmentEventLease | null }>>()
      .mockResolvedValueOnce({
        event: {
          id: 'evt-2',
          kind: 'chat_turn',
          payload: {
            kind: 'chat_turn',
            sessionId: 'openclaw:dkg-ui',
            turnId: 'turn-456',
            contextGraphId: 'agent-context',
            assertionName: 'chat-turns',
            assertionUri: 'did:dkg:context-graph:agent-context/assertion/peer/chat-turns',
            sessionUri: 'urn:dkg:chat:session:openclaw:dkg-ui',
            turnUri: 'urn:dkg:chat:turn:turn-456',
            userMessage: 'hello again',
            assistantReply: 'pending',
            persistenceState: 'stored',
          },
          status: 'leased',
          attempts: 1,
          maxAttempts: 5,
          leaseOwner: 'worker',
          leaseExpiresAt: Date.now() + 60_000,
          nextAttemptAt: Date.now(),
        },
      })
      .mockResolvedValueOnce({ event: null })
      .mockResolvedValue({ event: null });
    const append = vi.fn();
    const fail = vi.fn().mockResolvedValue({ status: 'pending' });
    const getSessionMessages = vi.fn();
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    const worker = new SemanticEnrichmentWorker(
      makeApi({
        subagent: {
          run: vi.fn().mockResolvedValue({ runId: 'run-2' }),
          waitForRun: vi.fn().mockResolvedValue({ status: 'failed' }),
          getSessionMessages,
          deleteSession,
        } as any,
      }),
      makeClient({
        claimSemanticEnrichmentEvent: claim,
        appendSemanticEnrichmentEvent: append,
        failSemanticEnrichmentEvent: fail,
      }),
    );

    worker.noteWake({
      kind: 'chat_turn',
      eventKey: 'evt-2',
      triggerSource: 'daemon',
    });
    await worker.flush();

    expect(getSessionMessages).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      'evt-2',
      worker.getWorkerInstanceId(),
      expect.stringContaining('ended with status "failed"'),
    );
    expect(deleteSession).toHaveBeenCalledTimes(1);
  });

  it('loads markdown-backed file imports and falls back to schema.org guidance when no project ontology is usable', async () => {
    const claim = vi.fn<() => Promise<{ event: SemanticEnrichmentEventLease | null }>>()
      .mockResolvedValueOnce({
        event: {
          id: 'evt-file-1',
          kind: 'file_import',
          payload: {
            kind: 'file_import',
            contextGraphId: 'project-1',
            assertionName: 'product-brief',
            assertionUri: 'did:dkg:context-graph:project-1/assertion/peer/product-brief',
            importStartedAt: '2026-04-15T10:00:00.000Z',
            fileHash: 'keccak256:file-1',
            mdIntermediateHash: 'keccak256:md-1',
            detectedContentType: 'application/pdf',
            sourceFileName: 'brief.pdf',
          },
          status: 'leased',
          attempts: 1,
          maxAttempts: 5,
          leaseOwner: 'worker',
          leaseExpiresAt: Date.now() + 60_000,
          nextAttemptAt: Date.now(),
        },
      })
      .mockResolvedValueOnce({ event: null })
      .mockResolvedValue({ event: null });
    const fetchFileText = vi.fn().mockResolvedValue('# Brief\n\nAcme builds sensors.');
    const query = vi.fn().mockResolvedValue({ result: { bindings: [] } });
    const append = vi.fn().mockResolvedValue({
      applied: true,
      completed: true,
      semanticEnrichment: {
        eventId: 'evt-file-1',
        status: 'completed',
        semanticTripleCount: 1,
        updatedAt: new Date().toISOString(),
      },
    });
    const run = vi.fn().mockResolvedValue({ runId: 'run-file-1' });
    const waitForRun = vi.fn().mockResolvedValue({ status: 'ok' });
    const getSessionMessages = vi.fn().mockResolvedValue({
      messages: [
        {
          role: 'assistant',
          text: '{"triples":[{"subject":"urn:dkg:file:keccak256:file-1#product","predicate":"https://schema.org/about","object":"https://schema.org/Product"}]}',
        },
      ],
    });

    const worker = new SemanticEnrichmentWorker(
      makeApi({
        subagent: {
          run,
          waitForRun,
          getSessionMessages,
          deleteSession: vi.fn().mockResolvedValue(undefined),
        } as any,
      }),
      makeClient({
        claimSemanticEnrichmentEvent: claim,
        fetchFileText,
        query,
        appendSemanticEnrichmentEvent: append,
      }),
    );

    worker.noteWake({
      kind: 'file_import',
      eventKey: 'evt-file-1',
      triggerSource: 'daemon',
    });
    await worker.flush();

    expect(fetchFileText).toHaveBeenCalledWith('keccak256:md-1', 'text/markdown');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]?.message).toContain('Source: schema_org');
    expect(run.mock.calls[0]?.[0]?.message).toContain('Triples: none loaded; use schema.org terms where appropriate.');
    expect(append).toHaveBeenCalledWith(
      'evt-file-1',
      worker.getWorkerInstanceId(),
      [
        {
          subject: 'urn:dkg:file:keccak256:file-1#product',
          predicate: 'https://schema.org/about',
          object: 'https://schema.org/Product',
        },
      ],
    );
    expect(worker.getPendingSummaries()).toHaveLength(0);
  });

  it('uses the explicit ontologyRef as a replace-only override for file import prompts', async () => {
    const claim = vi.fn<() => Promise<{ event: SemanticEnrichmentEventLease | null }>>()
      .mockResolvedValueOnce({
        event: {
          id: 'evt-file-2',
          kind: 'file_import',
          payload: {
            kind: 'file_import',
            contextGraphId: 'project-2',
            assertionName: 'roadmap',
            assertionUri: 'did:dkg:context-graph:project-2/assertion/peer/roadmap',
            importStartedAt: '2026-04-15T11:00:00.000Z',
            fileHash: 'keccak256:file-2',
            detectedContentType: 'text/markdown',
            ontologyRef: 'did:dkg:context-graph:project-2/custom-ontology',
          },
          status: 'leased',
          attempts: 1,
          maxAttempts: 5,
          leaseOwner: 'worker',
          leaseExpiresAt: Date.now() + 60_000,
          nextAttemptAt: Date.now(),
        },
      })
      .mockResolvedValueOnce({ event: null })
      .mockResolvedValue({ event: null });
    const query = vi.fn().mockResolvedValue({
      result: {
        bindings: [
          {
            s: { value: 'https://example.com/Project' },
            p: { value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
            o: { value: 'http://www.w3.org/2000/01/rdf-schema#Class' },
          },
        ],
      },
    });
    const run = vi.fn().mockResolvedValue({ runId: 'run-file-2' });
    const append = vi.fn().mockResolvedValue({
      applied: true,
      completed: true,
      semanticEnrichment: {
        eventId: 'evt-file-2',
        status: 'completed',
        semanticTripleCount: 0,
        updatedAt: new Date().toISOString(),
      },
    });

    const worker = new SemanticEnrichmentWorker(
      makeApi({
        subagent: {
          run,
          waitForRun: vi.fn().mockResolvedValue({ status: 'completed' }),
          getSessionMessages: vi.fn().mockResolvedValue({ messages: [{ role: 'assistant', text: '{"triples":[]}' }] }),
          deleteSession: vi.fn().mockResolvedValue(undefined),
        } as any,
      }),
      makeClient({
        claimSemanticEnrichmentEvent: claim,
        fetchFileText: vi.fn().mockResolvedValue('# Roadmap'),
        query,
        appendSemanticEnrichmentEvent: append,
      }),
    );

    worker.noteWake({
      kind: 'file_import',
      eventKey: 'evt-file-2',
      triggerSource: 'daemon',
    });
    await worker.flush();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('GRAPH <did:dkg:context-graph:project-2/custom-ontology>'),
      expect.objectContaining({ contextGraphId: 'project-2', view: 'working-memory' }),
    );
    expect(run.mock.calls[0]?.[0]?.message).toContain('Source: override');
    expect(run.mock.calls[0]?.[0]?.message).toContain('Graph: did:dkg:context-graph:project-2/custom-ontology');
    expect(worker.getPendingSummaries()).toHaveLength(0);
  });
});
