/**
 * Minimal ElizaOS types.
 *
 * These mirror the ElizaOS core interfaces that plugins interact with.
 * The full types live in @elizaos/core; these are the subset needed
 * to build a DKG adapter plugin.
 */

export interface IAgentRuntime {
  getSetting(key: string): string | undefined;
  character?: { name?: string };
}

export interface Memory {
  userId: string;
  agentId: string;
  roomId: string;
  content: { text: string; action?: string };
}

export interface State {
  [key: string]: unknown;
}

export interface HandlerCallback {
  (response: { text: string; action?: string }): void;
}

export interface ActionExample {
  user: string;
  content: { text: string; action?: string };
}

export interface Action {
  name: string;
  similes: string[];
  description: string;
  examples: ActionExample[][];
  validate?: (runtime: IAgentRuntime, message: Memory) => Promise<boolean>;
  handler: (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => Promise<boolean>;
}

export interface Provider {
  get: (runtime: IAgentRuntime, message: Memory, state?: State) => Promise<string | null>;
}

export interface Service {
  name: string;
  initialize?: (runtime: IAgentRuntime) => Promise<void>;
  cleanup?: () => Promise<void>;
}

export interface Plugin {
  name: string;
  description: string;
  actions?: Action[];
  providers?: Provider[];
  services?: Service[];
}
