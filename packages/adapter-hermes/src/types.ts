/**
 * Configuration for the Hermes Agent adapter.
 */
export interface HermesAdapterConfig {
  /** Base URL of the DKG daemon (default: "http://127.0.0.1:9200"). */
  daemonUrl?: string;
}

/**
 * Session turn payload from the Hermes Python plugin.
 */
export interface SessionTurnPayload {
  sessionId: string;
  user: string;
  assistant: string;
}

/**
 * Session end payload from the Hermes Python plugin.
 */
export interface SessionEndPayload {
  sessionId: string;
  turnCount?: number;
}

/**
 * Daemon plugin API — the interface the daemon provides to adapters
 * for registering HTTP routes and lifecycle hooks.
 *
 * This mirrors the OpenClaw adapter pattern but is framework-agnostic.
 */
export interface DaemonPluginApi {
  /** Register an HTTP route on the daemon server. */
  registerHttpRoute(route: {
    method: 'GET' | 'POST';
    path: string;
    handler: (req: any, res: any) => Promise<void>;
  }): void;

  /** Register a lifecycle hook. */
  registerHook(event: string, handler: () => Promise<void>, opts?: { name?: string }): void;

  /** Logger. */
  logger: {
    info?(...args: any[]): void;
    warn?(...args: any[]): void;
    debug?(...args: any[]): void;
  };

  /** Access to the DKG agent instance running in the daemon. */
  agent: {
    query(sparql: string, opts?: { contextGraphId?: string }): Promise<any>;
    share(contextGraphId: string, quads: any[], opts?: any): Promise<any>;
    importMemories?(text: string, source?: string): Promise<any>;
    storeChatTurn?(sessionId: string, user: string, assistant: string): Promise<any>;
  };
}
