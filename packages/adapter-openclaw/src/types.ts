/**
 * Minimal OpenClaw plugin API types.
 *
 * These mirror the OpenClaw runtime API surface that plugins interact with.
 * The full types live in the OpenClaw runtime; these are the subset needed
 * to build a DKG adapter plugin.
 */

export interface OpenClawPluginApi {
  registerTool(tool: OpenClawTool): void;
  registerHook(hookName: string, handler: (...args: any[]) => Promise<void>): void;
  on(event: string, handler: (...args: any[]) => void): void;
}

export interface OpenClawTool {
  name: string;
  description: string;
  parameters: Record<string, OpenClawToolParam>;
  handler: (args: Record<string, unknown>) => Promise<OpenClawToolResult>;
}

export interface OpenClawToolParam {
  type: string;
  description: string;
  required?: boolean;
}

export interface OpenClawToolResult {
  status: 'ok' | 'error';
  data?: unknown;
  message?: string;
}

export interface DkgOpenClawConfig {
  /** Persistent identity / state directory. Default: `.dkg/openclaw` */
  dataDir?: string;
  /** DKG listen port. Default: random */
  listenPort?: number;
  /** Relay peer multiaddrs for NAT traversal. */
  relayPeers?: string[];
  /** Bootstrap peer multiaddrs. */
  bootstrapPeers?: string[];
  /** Agent display name (defaults to OpenClaw agent name). */
  name?: string;
  /** Agent description. */
  description?: string;
  /** Skills this agent offers. */
  skills?: Array<{
    skillType: string;
    pricePerCall?: number;
    currency?: string;
    handler: (input: Uint8Array) => Promise<{ status: string; output?: Uint8Array; error?: string }>;
  }>;
}
