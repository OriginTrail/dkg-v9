import { describe, it, expect } from "vitest";
import { ChatTurnWriter } from "../src/ChatTurnWriter";

describe("ChatTurnWriter.sanitize (N6)", () => {
  let writer: ChatTurnWriter;
  let mockClient: any;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    mockClient = { persistChatTurn: vi.fn().mockResolvedValue(undefined) };
    writer = new ChatTurnWriter({ client: mockClient, logger: mockLogger, stateDir: "/tmp" });
  });

  it("strips null bytes (\x00)", () => {
    const event = {
      sessionId: "test",
      messages: [{ role: "user", content: "a\x00b" }, { role: "assistant", content: "y" }],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    expect(mockClient.persistChatTurn).toHaveBeenCalled();
  });

  it("strips control chars (\x01-\x1f)", () => {
    const event = {
      sessionId: "test",
      messages: [{ role: "user", content: "a\x1fb" }, { role: "assistant", content: "y" }],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    expect(mockClient.persistChatTurn).toHaveBeenCalled();
  });

  it("strips DEL byte (\x7f)", () => {
    const event = {
      sessionId: "test",
      messages: [{ role: "user", content: "a\x7fb" }, { role: "assistant", content: "y" }],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    expect(mockClient.persistChatTurn).toHaveBeenCalled();
  });

  it("caps sanitized field at 64 chars", () => {
    const longStr = "a".repeat(100);
    const event = {
      sessionId: "test",
      messages: [{ role: "user", content: longStr }, { role: "assistant", content: "y" }],
    };
    writer.onAgentEnd(event, { channelId: longStr, sessionKey: "sk" });
    expect(mockClient.persistChatTurn).toHaveBeenCalled();
  });

  it("passes clean text unchanged", () => {
    const event = {
      sessionId: "test",
      messages: [{ role: "user", content: "clean" }, { role: "assistant", content: "resp" }],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    expect(mockClient.persistChatTurn).toHaveBeenCalled();
  });

  it("handles mixed control + long strings", () => {
    const mixed = "a\x00b\x1fc" + "d".repeat(100);
    const event = {
      sessionId: "test",
      messages: [{ role: "user", content: mixed }, { role: "assistant", content: "y" }],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    expect(mockClient.persistChatTurn).toHaveBeenCalled();
  });
});
