import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChatTurnWriter } from "../src/ChatTurnWriter";
import * as fs from "fs";
import * as path from "path";

describe("ChatTurnWriter crash recovery (Task #12)", () => {
  let stateDir: string;
  let mockClient: any;
  let mockLogger: any;

  beforeEach(() => {
    stateDir = path.join("/tmp", `dkg-test-${Date.now()}`);
    fs.mkdirSync(path.dirname(stateDir), { recursive: true });
    mockLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    mockClient = { persistChatTurn: vi.fn().mockResolvedValue(undefined) };
  });

  it("survives missing watermark file on init", () => {
    const writer = new ChatTurnWriter({ client: mockClient, logger: mockLogger, stateDir });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("tolerates malformed JSON in watermark file", () => {
    const wmPath = path.join(stateDir, "dkg-adapter", "chat-turn-watermarks.json");
    fs.mkdirSync(path.dirname(wmPath), { recursive: true });
    fs.writeFileSync(wmPath, "{invalid json", "utf-8");
    const writer = new ChatTurnWriter({ client: mockClient, logger: mockLogger, stateDir });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load watermarks"),
      expect.anything()
    );
  });

  it("atomic rename prevents partial writes", async () => {
    const writer = new ChatTurnWriter({ client: mockClient, logger: mockLogger, stateDir });
    const event = {
      sessionId: "test",
      messages: [{ role: "user", content: "x" }, { role: "assistant", content: "y" }],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    await new Promise(r => setTimeout(r, 100));
    const wmPath = path.join(stateDir, "dkg-adapter", "chat-turn-watermarks.json");
    expect(fs.existsSync(wmPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(wmPath, "utf-8"));
    expect(typeof content).toBe("object");
  });

  it("handles debounce flush without race on shutdown", async () => {
    const writer = new ChatTurnWriter({ client: mockClient, logger: mockLogger, stateDir });
    const event = {
      sessionId: "test",
      messages: [{ role: "user", content: "x" }, { role: "assistant", content: "y" }],
    };
    writer.onAgentEnd(event, { channelId: "ch", sessionKey: "sk" });
    writer.flushSync();
    await new Promise(r => setTimeout(r, 100));
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});
