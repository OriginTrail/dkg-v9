import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ChatTurnWriter } from "../src/ChatTurnWriter";
import type { AgentEndContext, InternalMessageEvent } from "../src/ChatTurnWriter";

/** Wait long enough for fire-and-forget persistOne() to complete. */
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 20));

describe("ChatTurnWriter", () => {
  let writer: ChatTurnWriter;
  let mockClient: { storeChatTurn: ReturnType<typeof vi.fn> };
  let mockLogger: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let stateDir: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatturnwriter-test-"));
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    mockClient = {
      storeChatTurn: vi.fn().mockResolvedValue(undefined),
    };
    writer = new ChatTurnWriter({ client: mockClient, logger: mockLogger, stateDir });
  });

  afterEach(() => {
    writer.flushSync();
    try {
      fs.rmSync(stateDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
    vi.clearAllMocks();
  });

  it("initializes with empty watermarks when state dir is fresh", () => {
    expect((writer as any).cachedWatermarks.size).toBe(0);
  });

  it("calls storeChatTurn on onAgentEnd with ctx", async () => {
    const event: AgentEndContext = {
      sessionId: "test-session",
      messages: [
        { role: "user", content: "test message" },
        { role: "assistant", content: "test response" },
      ],
    };
    writer.onAgentEnd(event, { channelId: "slack", sessionKey: "key123" });
    await flushMicrotasks();
    expect(mockClient.storeChatTurn).toHaveBeenCalled();
  });

  it("skips persist when ctx missing", async () => {
    const event: AgentEndContext = {
      sessionId: "test",
      messages: [{ role: "user", content: "test" }],
    };
    writer.onAgentEnd(event);
    await flushMicrotasks();
    expect(mockClient.storeChatTurn).not.toHaveBeenCalled();
  });

  it("skips persist when no messages", async () => {
    const event: AgentEndContext = { sessionId: "test", messages: [] };
    writer.onAgentEnd(event, { channelId: "ch1", sessionKey: "sk1" });
    await flushMicrotasks();
    expect(mockClient.storeChatTurn).not.toHaveBeenCalled();
  });

  it("extracts text from string content", async () => {
    const event: AgentEndContext = {
      sessionId: "test",
      messages: [
        { role: "user", content: "hello world" },
        { role: "assistant", content: "hi there" },
      ],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    await flushMicrotasks();
    expect(mockClient.storeChatTurn).toHaveBeenCalledWith(
      "openclaw:ch:sk",
      "hello world",
      "hi there",
      expect.any(Object),
    );
  });

  it("extracts text from array content", async () => {
    const event: AgentEndContext = {
      sessionId: "test",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "part1" },
            { type: "text", text: "part2" },
          ],
        },
        { role: "assistant", content: [{ type: "text", text: "resp" }] },
      ],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    await flushMicrotasks();
    expect(mockClient.storeChatTurn).toHaveBeenCalled();
  });

  it("strips well-formed <recalled-memory> block from assistant text before persist (I1)", async () => {
    const event: AgentEndContext = {
      sessionId: "test",
      messages: [
        { role: "user", content: "query" },
        {
          role: "assistant",
          content: "prefix <recalled-memory>\n[1] (agent-context-wm) secret\n</recalled-memory> suffix",
        },
      ],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    await flushMicrotasks();
    const call = mockClient.storeChatTurn.mock.calls[0];
    expect(call[2]).not.toContain("recalled-memory");
    expect(call[2]).not.toContain("secret");
    expect(call[2]).toContain("prefix");
    expect(call[2]).toContain("suffix");
  });

  it("strips orphaned <recalled-memory> open tag when closing tag is missing (I1 truncation)", async () => {
    const event: AgentEndContext = {
      sessionId: "test",
      messages: [
        { role: "user", content: "query" },
        {
          role: "assistant",
          content: "answer text <recalled-memory>\n[1] (agent-context-wm) truncated",
        },
      ],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    await flushMicrotasks();
    const call = mockClient.storeChatTurn.mock.calls[0];
    expect(call[2]).toBe("answer text");
  });

  it("stores user message on onMessageReceived", () => {
    writer.onMessageReceived({
      sessionKey: "session-123",
      direction: "inbound",
      text: "user input",
    });
    expect((writer as any).pendingUserMessages.size).toBeGreaterThan(0);
  });

  it("persists on onMessageSent pairing with prior onMessageReceived", async () => {
    writer.onMessageReceived({
      sessionKey: "key123",
      direction: "inbound",
      text: "hello",
    });
    writer.onMessageSent({
      sessionKey: "key123",
      direction: "outbound",
      text: "response",
    });
    await flushMicrotasks();
    expect(mockClient.storeChatTurn).toHaveBeenCalled();
  });

  it("flushSync clears debounce timers", () => {
    writer.flushSync();
    expect((writer as any).debounceTimers.size).toBe(0);
  });

  it("generates deterministic turnId (16-hex)", async () => {
    const event: AgentEndContext = {
      sessionId: "session-1",
      messages: [
        { role: "user", content: "test" },
        { role: "assistant", content: "test" },
      ],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    await flushMicrotasks();
    const call = mockClient.storeChatTurn.mock.calls[0];
    expect(call[3].turnId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("derives sessionId from context", async () => {
    const event: AgentEndContext = {
      sessionId: "test",
      messages: [
        { role: "user", content: "x" },
        { role: "assistant", content: "y" },
      ],
    };
    writer.onAgentEnd(event, { channelId: "telegram", sessionKey: "user-42" });
    await flushMicrotasks();
    const call = mockClient.storeChatTurn.mock.calls[0];
    expect(call[0]).toContain("openclaw:telegram:");
  });

  it("retries storeChatTurn with backoff on transient failure", async () => {
    mockClient.storeChatTurn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValue(undefined);
    // Re-instantiate writer so it uses the newly-patched mock.
    writer = new ChatTurnWriter({ client: mockClient, logger: mockLogger, stateDir });

    const event: AgentEndContext = {
      sessionId: "test",
      messages: [
        { role: "user", content: "x" },
        { role: "assistant", content: "y" },
      ],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    await new Promise((r) => setTimeout(r, 500));
    expect(mockClient.storeChatTurn).toHaveBeenCalledTimes(2);
  });

  it("onBeforeCompaction does not throw", () => {
    expect(() => writer.onBeforeCompaction({}, {})).not.toThrow();
  });

  it("onBeforeReset does not throw", () => {
    expect(() => writer.onBeforeReset({}, {})).not.toThrow();
  });

  it("warns when onMessageReceived has no sessionKey", () => {
    writer.onMessageReceived({
      sessionKey: undefined as unknown as string,
      direction: "inbound",
      text: "msg",
    });
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
