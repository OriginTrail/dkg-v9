import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatMemoryManager } from '../src/chat-memory.js';

describe('ChatMemoryManager', () => {
  let manager: ChatMemoryManager;
  let mockQuery: ReturnType<typeof vi.fn>;
  let mockWriteToWorkspace: ReturnType<typeof vi.fn>;
  let mockCreateParanet: ReturnType<typeof vi.fn>;
  let mockListParanets: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockQuery = vi.fn();
    mockWriteToWorkspace = vi.fn().mockResolvedValue({ workspaceOperationId: 'op-1' });
    mockCreateParanet = vi.fn().mockResolvedValue(undefined);
    mockListParanets = vi.fn().mockResolvedValue([{ id: 'agent-memory', name: 'Agent Memory' }]);

    manager = new ChatMemoryManager(
      {
        query: mockQuery,
        writeToWorkspace: mockWriteToWorkspace,
        enshrineFromWorkspace: vi.fn().mockResolvedValue({}),
        createParanet: mockCreateParanet,
        listParanets: mockListParanets,
      },
      { apiKey: 'test' },
    );
  });

  it('stores a chat exchange and writes quads to workspace', async () => {
    mockQuery.mockResolvedValueOnce({ result: { bindings: [{ result: 'false' }] } }); // ASK: session does not exist
    await manager.storeChatExchange('session-1', 'Hello', 'Hi there!');

    expect(mockWriteToWorkspace).toHaveBeenCalledWith('agent-memory', expect.any(Array));
    const quads = mockWriteToWorkspace.mock.calls[0][1];
    expect(quads.length).toBeGreaterThanOrEqual(12);
    const sessionTriple = quads.find((q: any) => q.predicate?.includes('sessionId'));
    expect(sessionTriple).toBeDefined();
    expect(sessionTriple.object).toContain('session-1');
  });

  it('appends to existing session without re-writing session triple (Rule 4)', async () => {
    mockQuery.mockResolvedValueOnce({ result: { bindings: [{ result: 'true' }] } }); // ASK: session exists
    await manager.storeChatExchange('session-1', 'Second message', 'Second reply');

    expect(mockWriteToWorkspace).toHaveBeenCalledWith('agent-memory', expect.any(Array));
    const quads = mockWriteToWorkspace.mock.calls[0][1];
    expect(quads.length).toBe(10); // only message quads, no session triples
    const sessionTriple = quads.find((q: any) => q.predicate?.includes('sessionId'));
    expect(sessionTriple).toBeUndefined();
  });

  it('creates agent-memory paranet when not in list', async () => {
    mockListParanets.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce({ result: { bindings: [{ result: 'false' }] } }); // ASK: session does not exist
    const m = new ChatMemoryManager(
      {
        query: mockQuery,
        writeToWorkspace: mockWriteToWorkspace,
        enshrineFromWorkspace: vi.fn().mockResolvedValue({}),
        createParanet: mockCreateParanet,
        listParanets: mockListParanets,
      },
      { apiKey: 'test' },
    );
    await m.storeChatExchange('s1', 'x', 'y');
    expect(mockCreateParanet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-memory', name: 'Agent Memory' }),
    );
  });

  it('getRecentChats returns sessions from query bindings', async () => {
    mockQuery
      .mockResolvedValueOnce({
        result: {
          bindings: [
            { s: 'urn:dkg:chat:session:uuid-1', sid: '"uuid-1"' },
          ],
        },
      })
      .mockResolvedValueOnce({
        result: {
          bindings: [
            { author: 'urn:dkg:chat:actor:user', text: '"Hi"', ts: '"2026-01-01T12:00:00Z"' },
            { author: 'urn:dkg:chat:actor:agent', text: '"Hello"', ts: '"2026-01-01T12:00:01Z"' },
          ],
        },
      });

    const chats = await manager.getRecentChats(10);
    expect(chats).toHaveLength(1);
    expect(chats[0].session).toBe('uuid-1');
    expect(chats[0].messages).toHaveLength(2);
    expect(chats[0].messages[0].author).toBe('user');
    expect(chats[0].messages[1].author).toBe('agent');
  });

  it('getStats returns session and triple counts', async () => {
    mockQuery
      .mockResolvedValueOnce({ result: { bindings: [{ c: '10' }] } })
      .mockResolvedValueOnce({ result: { bindings: [{ c: '3' }] } });

    const stats = await manager.getStats();
    expect(stats.paranetId).toBe('agent-memory');
    expect(stats.initialized).toBe(true);
    expect(stats.sessionCount).toBe(3);
  });
});
