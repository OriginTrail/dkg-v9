/**
 * OpenClaw plugin API types + DKG integration types.
 *
 * Upstream memory types in the bottom half of this file are vendored from
 * the OpenClaw source tree — `src/plugins/memory-state.ts` and
 * `packages/memory-host-sdk/src/host/types.ts` at commit
 * `dae060390b1d17aa949c4a1a0c12fbc3b1eedb79`. `@openclaw/plugin-sdk` does
 * not publicly export memory types, so they are mirrored here instead of
 * imported. Resync on OpenClaw minor-version bumps.
 */

// ---------------------------------------------------------------------------
// Core OpenClaw plugin API surface
// ---------------------------------------------------------------------------

export interface OpenClawPluginApi {
  config: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  registrationMode?: 'full' | 'setup-only' | 'setup-runtime' | 'cli-metadata';
  registerTool(tool: OpenClawTool): void;
  registerHook(event: string, handler: (...args: any[]) => Promise<void>, opts?: { name: string }): void;
  on(event: string, handler: (...args: any[]) => void): void;
  logger: { info?(...args: any[]): void; warn?(...args: any[]): void; debug?(...args: any[]): void };

  /** Register a bidirectional channel plugin. */
  registerChannel?(opts: { plugin: OpenClawChannelAdapter; dock?: unknown }): void;

  /** Register an HTTP route on the gateway. */
  registerHttpRoute?(route: {
    method: string;
    path: string;
    auth?: string;
    handler: (req: any, res: any) => Promise<void> | void;
  }): void;

  /** Register a long-running background service. */
  registerService?(service: {
    name: string;
    start: () => Promise<void>;
    stop: () => Promise<void>;
  }): void;

  /** Route an inbound channel message through the session system. */
  routeInboundMessage?(message: ChannelInboundMessage): Promise<ChannelOutboundReply>;

  /**
   * Register the memory-slot capability. Optional on the type so adapters
   * can feature-detect older gateway versions at runtime.
   */
  registerMemoryCapability?(capability: MemoryPluginCapability): void;

  /** Workspace directory path (set by gateway). */
  workspaceDir?: string;
}

export interface OpenClawTool {
  name: string;
  description: string;
  parameters: JSONSchemaObject;
  execute(toolCallId: string, params: Record<string, unknown>): Promise<OpenClawToolResult>;
}

export interface JSONSchemaObject {
  type: 'object';
  properties: Record<string, { type: string; description?: string; items?: any; enum?: string[] }>;
  required?: string[];
}

export interface OpenClawToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Channel types
// ---------------------------------------------------------------------------

/** Inbound message from an external channel into OpenClaw. */
export interface ChannelInboundMessage {
  /** Channel name (e.g. "dkg-ui"). */
  channelName: string;
  /** Sender identifier within the channel. */
  senderId: string;
  /** Whether the sender is the agent owner (bypasses permission checks). */
  senderIsOwner?: boolean;
  /** Message text. */
  text: string;
  /** Correlation ID for request-reply tracking. */
  correlationId?: string;
}

/** Outbound reply from OpenClaw to an external channel. */
export interface ChannelOutboundReply {
  /** Correlation ID matching the inbound message. */
  correlationId?: string;
  /** Reply text. */
  text: string;
  /** Session-internal turn ID. */
  turnId?: string;
  /** Tool calls made during this turn. */
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
}

/**
 * Channel adapter interface.
 *
 * Mirrors OpenClaw's ChannelPlugin contract — channels are bidirectional
 * message transports.  The adapter registers one of these per channel.
 */
export interface OpenClawChannelAdapter {
  /** Channel identifier (must be unique across registered channels). */
  id: string;
  /** Display name for the channel. */
  name: string;
  /** Channel metadata. */
  meta?: { displayName?: string; [key: string]: unknown };
  /** Channel capabilities. */
  capabilities?: Record<string, unknown>;
  /** Channel account/config adapter expected by current OpenClaw runtimes. */
  config?: {
    listAccountIds(cfg: any): string[];
    resolveAccount(cfg: any, accountId?: string): Record<string, unknown>;
    defaultAccountId?(cfg: any): string;
    isEnabled?(account: Record<string, unknown>, cfg: any): boolean;
    isConfigured?(account: Record<string, unknown>, cfg: any): boolean | Promise<boolean>;
    describeAccount?(account: Record<string, unknown>, cfg: any): Record<string, unknown>;
    disabledReason?(account: Record<string, unknown>, cfg: any): string;
    unconfiguredReason?(account: Record<string, unknown>, cfg: any): string;
  };
  /** Called when the gateway starts.  Set up transport here. */
  start?(): Promise<void>;
  /** Called when the gateway stops.  Tear down transport. */
  stop?(): Promise<void>;
  /**
   * Called by the gateway when the agent produces a reply for this channel.
   * The adapter should deliver it via its transport.
   */
  onOutbound?(reply: ChannelOutboundReply): Promise<void>;
}

// ---------------------------------------------------------------------------
// Vendored upstream memory types
// ---------------------------------------------------------------------------
// Source: `src/plugins/memory-state.ts` + `packages/memory-host-sdk/src/host/types.ts`
// at OpenClaw commit `dae060390b1d17aa949c4a1a0c12fbc3b1eedb79`.
// Resync on minor-version bumps.
// ---------------------------------------------------------------------------

/** Discriminator for where a `MemorySearchResult` originated. */
export type MemorySource = 'memory' | 'sessions';

/** Minimal citation metadata attached to a search hit. Shape intentionally loose. */
export interface MemoryCitation {
  kind?: string;
  ref?: string;
  label?: string;
  [key: string]: unknown;
}

/**
 * Upstream search result shape. `path` is an opaque identifier (file path or
 * graph-backed synthetic URI). `startLine`/`endLine` are `1` for graph-backed
 * backends that have no natural line concept. `snippet` is the matched text,
 * typically truncated. `source` distinguishes per-project memory hits from
 * session-history hits.
 */
export interface MemorySearchResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: MemorySource;
  citation?: MemoryCitation;
}

/** Search opts the memory slot passes through. */
export interface MemorySearchOptions {
  maxResults?: number;
  minScore?: number;
  sessionKey?: string;
}

/**
 * Upstream `readFile` request shape. Non-nullable return per upstream contract
 * (`readFile` cannot signal "not found" structurally — callers must inspect
 * `text`). V10 memory is graph-native, so the DKG provider returns an empty
 * shell unconditionally.
 */
export interface MemoryReadFileRequest {
  relPath: string;
  from?: number;
  lines?: number;
}

export interface MemoryReadFileResult {
  text: string;
  path: string;
}

/**
 * Synchronous status block returned by `MemorySearchManager.status()`.
 * `backend` is a closed union (`"builtin" | "qmd"`) in the upstream contract;
 * the DKG provider reports `"builtin"` as a pragmatic lie because no
 * `"custom"` option exists upstream. Logged as an upstream gap.
 */
export interface MemoryProviderStatus {
  backend: 'builtin' | 'qmd';
  provider: string;
  model?: string;
  vector?: { enabled: boolean; available: boolean };
  fts?: { enabled: boolean; available: boolean };
  cache?: { enabled: boolean };
  batch?: { enabled: boolean };
  sources?: readonly MemorySource[];
  workspaceDir?: string;
  custom?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Upstream probe result shape. The only documented fields are `ok` and an
 * optional `error` string. No structured `notAvailable` field — logged as an
 * upstream gap.
 */
export interface MemoryEmbeddingProbeResult {
  ok: boolean;
  error?: string;
}

/**
 * Upstream `MemorySearchManager` contract — what `registerMemoryCapability`
 * expects from a plugin's memory runtime. The DKG provider implements this
 * against real V10 primitives (assertion-scoped WM SPARQL queries) rather
 * than the file-backed pattern `memory-core` / `memory-lancedb` use.
 */
export interface MemorySearchManager {
  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]>;
  readFile(request: MemoryReadFileRequest): Promise<MemoryReadFileResult>;
  status(): MemoryProviderStatus;
  probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult>;
  probeVectorAvailability(): Promise<MemoryEmbeddingProbeResult>;
  sync?(): Promise<void>;
  close?(): Promise<void>;
}

/** Factory call parameters — upstream passes cfg + agent + session. */
export interface MemoryRuntimeRequest {
  cfg?: Record<string, unknown>;
  agentId?: string;
  sessionKey?: string;
  purpose?: string;
}

/** Factory result — a search manager plus optional non-fatal error. */
export interface MemoryRuntimeResult {
  manager: MemorySearchManager;
  error?: string;
}

/**
 * Upstream `MemoryPluginRuntime` shape. `getMemorySearchManager` is the
 * per-(cfg, agentId, sessionKey) factory; a slot-filling plugin is expected
 * to return a manager instance or an error-wrapped result.
 */
export interface MemoryPluginRuntime {
  getMemorySearchManager(request: MemoryRuntimeRequest): Promise<MemoryRuntimeResult>;
  resolveMemoryBackendConfig?(request: { cfg?: Record<string, unknown>; agentId?: string }): Record<string, unknown>;
  closeAllMemorySearchManagers?(): Promise<void>;
}

/**
 * Prompt-section builder — emits the memory region of the system prompt.
 * Called synchronously during prompt assembly.
 */
export type MemoryPromptSectionBuilder = (params: {
  availableTools: Set<string>;
  citationsMode?: string;
}) => string[];

/**
 * Full capability object handed to `api.registerMemoryCapability`. All four
 * fields optional — the minimum is `{ runtime }`, which is what the DKG
 * adapter registers.
 */
export interface MemoryPluginCapability {
  runtime?: MemoryPluginRuntime;
  promptBuilder?: MemoryPromptSectionBuilder;
  flushPlanResolver?: (params: { cfg?: Record<string, unknown>; nowMs?: number }) => unknown;
  publicArtifacts?: { listArtifacts: (...args: any[]) => Promise<unknown> };
}

// ---------------------------------------------------------------------------
// DKG adapter config
// ---------------------------------------------------------------------------

export interface DkgOpenClawConfig {
  /** DKG daemon HTTP URL (default: "http://127.0.0.1:9200"). */
  daemonUrl?: string;

  /** DKG memory integration config. */
  memory?: {
    enabled?: boolean;
    /**
     * @deprecated v0/Phase-0 file-watcher config. Retained for backward
     * compatibility with existing workspace configs; ignored by v1.
     */
    memoryDir?: string;
    /**
     * @deprecated v0/Phase-0 file-watcher config. Retained for backward
     * compatibility with existing workspace configs; ignored by v1.
     */
    watchDebounceMs?: number;
  };

  /** DKG UI channel bridge config. */
  channel?: {
    enabled?: boolean;
    /**
     * Port for the channel bridge HTTP server.
     * Only used if `api.registerHttpRoute` is not available.
     * Default: 9201.
     */
    port?: number;
  };
}
