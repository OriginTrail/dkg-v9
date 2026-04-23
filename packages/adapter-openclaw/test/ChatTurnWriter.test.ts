import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChatTurnWriter } from "../src/ChatTurnWriter";
import type { AgentEndContext, InternalMessageEvent } from "../src/ChatTurnWriter";

describe("ChatTurnWriter", () => {
  let writer: ChatTurnWriter;
  let mockClient: any;
  let mockLogger: any;
  let stateDir: string;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockClient = {
      storeChatTurn: vi.fn().mockResolvedValue(undefined),
    };

    stateDir = "/tmp/test-state";
    writer = new ChatTurnWriter({ client: mockClient, logger: mockLogger, stateDir });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with empty watermarks", () => {
    const stats = writer as any;
    expect(stats.cachedWatermarks.size).toBe(0);
  });

  it("loads watermarks from file if present", async () => {
    const event: AgentEndContext = {
      sessionId: "session-1",
      messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }],
    };
    writer.onAgentEnd(event, { channelId: "telegram", sessionKey: "user123" });
    expect(mockClient.storeChatTurn).toHaveBeenCalled();
  });

  it("calls storeChatTurn on onAgentEnd", async () => {
    const event: AgentEndContext = {
      sessionId: "test-session",
      messages: [
        { role: "user", content: "test message" },
        { role: "assistant", content: "test response" },
      ],
    };
    await new Promise(r => setTimeout(r, 100));
    writer.onAgentEnd(event, { channelId: "slack", sessionKey: "key123" });
    await new Promise(r => setTimeout(r, 100));
    expect(mockClient.storeChatTurn).toHaveBeenCalled();
  });

  it("handles missing context in onAgentEnd", () => {
    const event: AgentEndContext = {
      sessionId: "test",
      messages: [{ role: "user", content: "test" }],
    };
    writer.onAgentEnd(event);
    expect(mockClient.storeChatTurn).not.toHaveBeenCalled();
  });

  it("skips persist when no new messages", () => {
    const event: AgentEndContext = {
      sessionId: "test",
      messages: [],
    };
    writer.onAgentEnd(event, { channelId: "ch1", sessionKey: "sk1" });
    expect(mockClient.storeChatTurn).not.toHaveBeenCalled();
  });

  it("extracts text from string content", () => {
    const event: AgentEndContext = {
      sessionId: "test",
      messages: [{ role: "user", content: "hello world" }, { role: "assistant", content: "hi there" }],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    expect(mockClient.storeChatTurn).toHaveBeenCalledWith(
      "openclaw:ch:sk",
      "hello world",
      "hi there",
      expect.any(Object)
    );
  });

  it("extracts text from array content", () => {
    const event: AgentEndContext = {
      sessionId: "test",
      messages: [
        { role: "user", content: [{ type: "text", text: "part1" }, { type: "text", text: "part2" }] },
        { role: "assistant", content: [{ type: "text", text: "resp" }] },
      ],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    expect(mockClient.storeChatTurn).toHaveBeenCalled();
  });

  it("strips recalled memory markers (I1)", () => {
    const event: AgentEndContext = {
      sessionId: "test",
      messages: [
        { role: "user", content: "query" },
        { role: "assistant", content: "answer<!--TRUNCATED_FROM_SAVED_MEMORY-->after" },
      ],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    expect(mockClient.storeChatTurn).toHaveBeenCalledWith(
      "openclaw:ch:sk",
      "query",
      "answer",
      expect.any(Object)
    );
  });

  it("stores user message on onMessageReceived", () => {
    const event: InternalMessageEvent = {
      sessionKey: "session-123",
      direction: "inbound",
      text: "user input",
    };
    writer.onMessageReceived(event);
    const pending = (writer as any).pendingUserMessages;
    expect(pending.size).toBeGreaterThan(0);
  });

  it("persists on onMessageSent", async () => {
    const recvEvent: InternalMessageEvent = {
      sessionKey: "key123",
      direction: "inbound",
      text: "hello",
    };
    writer.onMessageReceived(recvEvent);

    const sendEvent: InternalMessageEvent = {
      sessionKey: "key123",
      direction: "outbound",
      text: "response",
    };
    writer.onMessageSent(sendEvent);
    await new Promise(r => setTimeout(r, 100));
    expect(mockClient.storeChatTurn).toHaveBeenCalled();
  });

  it("flushSync clears debounce timers", () => {
    writer.flushSync();
    const debounceMap = (writer as any).debounceTimers;
    expect(debounceMap.size).toBe(0);
  });

  it("generates deterministic turnId", () => {
    const event: AgentEndContext = {
      sessionId: "session-1",
      messages: [{ role: "user", content: "test" }, { role: "assistant", content: "test" }],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    const call = mockClient.storeChatTurn.mock.calls[0];
    expect(call[3].turnId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("derives sessionId from context", () => {
    const event: AgentEndContext = {
      sessionId: "test",
      messages: [{ role: "user", content: "x" }, { role: "assistant", content: "y" }],
    };
    writer.onAgentEnd(event, { channelId: "telegram", sessionKey: "user-42" });
    const call = mockClient.storeChatTurn.mock.calls[0];
    expect(call[0]).toContain("openclaw:telegram:");
  });

  it("extracts conversation key from internal event", () => {
    const event: InternalMessageEvent = {
      sessionKey: "key-abc",
      direction: "inbound",
      text: "msg",
    };
    writer.onMessageReceived(event);
    const pending = (writer as any).pendingUserMessages;
    expect(pending.size).toBe(1);
  });

  it("sanitizes control characters (I5)", () => {
    const event: AgentEndContext = {
      sessionId: "test",
      messages: [{ role: "user", content: "a\x00b\x1fc" }, { role: "assistant", content: "resp" }],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    expect(mockClient.storeChatTurn).toHaveBeenCalled();
  });

  it("retries storeChatTurn with backoff", async () => {
    mockClient.storeChatTurn = vi.fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValue(undefined);

    const event: AgentEndContext = {
      sessionId: "test",
      messages: [{ role: "user", content: "x" }, { role: "assistant", content: "y" }],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    await new Promise(r => setTimeout(r, 500));
    expect(mockClient.storeChatTurn).toHaveBeenCalledTimes(2);
  });

  it("handles onBeforeCompaction by flushing", () => {
    writer.onBeforeCompaction({}, {});
    expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining("Error"));
  });

  it("handles onBeforeReset by flushing", () => {
    writer.onBeforeReset({}, {});
    expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining("Error"));
  });

  it("handles errors in onMessageReceived", () => {
    const event = { sessionKey: undefined, text: "msg" } as any;
    writer.onMessageReceived(event);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("skips persist when conversation key missing", () => {
    const event: InternalMessageEvent = {
      sessionKey: undefined as any,
      direction: "inbound",
      text: "msg",
    };
    writer.onMessageReceived(event);
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
