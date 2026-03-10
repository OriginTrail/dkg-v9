/**
 * DkgChannelPlugin — Spike A: DKG UI ↔ OpenClaw channel bridge.
 *
 * Makes the DKG Node UI a first-class OpenClaw channel.  Messages sent
 * through the Agent Hub chat go through this channel into the OpenClaw
 * gateway's session system, meaning they share the same transcript and
 * context as messages from Telegram, WhatsApp, or any other channel
 * (when `dmScope: "main"`).
 *
 * Transport: The DKG daemon exposes `/api/openclaw-channel/send` for
 * the frontend.  The daemon forwards the message to this plugin via
 * either `api.registerHttpRoute()` (preferred) or a standalone HTTP
 * server on a dedicated port.
 *
 * Spike A must validate:
 *   1. Custom channel joins the shared "main" session
 *   2. Identity propagation (senderIsOwner)
 *   3. Cross-channel context continuity
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type {
  ChannelInboundMessage,
  ChannelOutboundReply,
  DkgOpenClawConfig,
  OpenClawPluginApi,
} from './types.js';
import type { DkgDaemonClient } from './dkg-client.js';

export const CHANNEL_NAME = 'dkg-ui';

interface PendingRequest {
  resolve: (reply: ChannelOutboundReply) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DkgChannelPlugin {
  private api: OpenClawPluginApi | null = null;
  private server: Server | null = null;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly port: number;
  private useGatewayRoute = false;

  constructor(
    private readonly config: NonNullable<DkgOpenClawConfig['channel']>,
    private readonly client: DkgDaemonClient,
  ) {
    this.port = config.port ?? 9201;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  register(api: OpenClawPluginApi): void {
    this.api = api;
    const log = api.logger;

    // --- Strategy 1: register as a first-class channel ---
    if (typeof api.registerChannel === 'function') {
      api.registerChannel({
        name: CHANNEL_NAME,
        plugin: {
          name: CHANNEL_NAME,
          start: () => this.start(),
          stop: () => this.stop(),
          onOutbound: (reply) => this.handleOutboundReply(reply),
        },
      });
      log.info?.('[dkg-channel] Registered as OpenClaw channel via registerChannel()');
    }

    // --- Strategy 2: register an HTTP route on the gateway ---
    if (typeof api.registerHttpRoute === 'function') {
      api.registerHttpRoute({
        method: 'POST',
        path: '/api/dkg-channel/inbound',
        handler: (req: any, res: any) => this.handleGatewayRoute(req, res),
      });
      this.useGatewayRoute = true;
      log.info?.('[dkg-channel] Registered HTTP route on gateway: POST /api/dkg-channel/inbound');
    }

    // --- Lifecycle hook for standalone server startup ---
    // Only register session_start for starting the bridge server.
    // Stop is handled by DkgNodePlugin.stop() to avoid double-stop.
    api.registerHook('session_start', () => this.start(), { name: 'dkg-channel-start' });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    // If we registered an HTTP route on the gateway, no standalone server needed
    if (this.useGatewayRoute) return;
    if (this.server) return;

    this.server = createServer((req, res) => this.handleHttpRequest(req, res));

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
        this.api?.logger.info?.(`[dkg-channel] Bridge server listening on 127.0.0.1:${this.port}`);
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Channel shutting down'));
      this.pendingRequests.delete(id);
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Inbound message handling  (DKG daemon → OpenClaw session)
  // ---------------------------------------------------------------------------

  /**
   * Process an inbound message from the DKG UI.
   * Routes through the OpenClaw session system and returns the agent reply.
   */
  async processInbound(
    text: string,
    correlationId: string,
    identity: string,
  ): Promise<ChannelOutboundReply> {
    const api = this.api;
    if (!api) throw new Error('Channel not registered');

    const message: ChannelInboundMessage = {
      channelName: CHANNEL_NAME,
      senderId: identity || 'owner',
      senderIsOwner: true,
      text,
      correlationId,
    };

    // --- Primary: use OpenClaw's routeInboundMessage API ---
    if (typeof api.routeInboundMessage === 'function') {
      return api.routeInboundMessage(message);
    }

    // --- Fallback: register a pending request and wait for onOutbound callback ---
    // This path is used when registerChannel() is available but
    // routeInboundMessage() is not — the gateway calls our onOutbound().
    if (typeof api.registerChannel !== 'function') {
      throw new Error(
        'No message routing mechanism available. ' +
        'The OpenClaw gateway must support either routeInboundMessage() or registerChannel().',
      );
    }

    return new Promise<ChannelOutboundReply>((resolve, reject) => {
      const TIMEOUT_MS = 120_000;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error('Agent response timeout'));
      }, TIMEOUT_MS);

      this.pendingRequests.set(correlationId, { resolve, reject, timer });
    });
  }

  // ---------------------------------------------------------------------------
  // Outbound reply handling  (OpenClaw session → DKG daemon)
  // ---------------------------------------------------------------------------

  private async handleOutboundReply(reply: ChannelOutboundReply): Promise<void> {
    const correlationId = reply.correlationId;
    if (!correlationId) return;

    const pending = this.pendingRequests.get(correlationId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(correlationId);
      pending.resolve(reply);
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP server handlers (standalone bridge mode)
  // ---------------------------------------------------------------------------

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/inbound') {
      await this.handleInboundHttp(req, res);
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { ...corsHeaders(), 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, channel: CHANNEL_NAME }));
      return;
    }

    res.writeHead(404, { ...corsHeaders(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private async handleInboundHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let parsed: { text?: string; correlationId?: string; identity?: string };
    try {
      const body = await readBody(req);
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const { text, correlationId, identity } = parsed;
    if (!text || !correlationId) {
      res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing "text" or "correlationId"' }));
      return;
    }

    try {
      const reply = await this.processInbound(text, correlationId, identity ?? 'owner');

      res.writeHead(200, { ...corsHeaders(), 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    } catch (err: any) {
      const status = err.message === 'Agent response timeout' ? 504 : 500;
      res.writeHead(status, { ...corsHeaders(), 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  /** Handler for api.registerHttpRoute() — same logic, different req/res shape. */
  private async handleGatewayRoute(req: any, res: any): Promise<void> {
    try {
      const body = typeof req.body === 'object' ? req.body : JSON.parse(await readBody(req));
      const { text, correlationId, identity } = body;
      if (!text || !correlationId) {
        res.writeHead?.(400, { 'Content-Type': 'application/json' });
        res.end?.(JSON.stringify({ error: 'Missing "text" or "correlationId"' }));
        return;
      }

      const reply = await this.processInbound(text, correlationId, identity ?? 'owner');
      res.writeHead?.(200, { 'Content-Type': 'application/json' });
      res.end?.(JSON.stringify(reply));
    } catch (err: any) {
      const status = err.message === 'Agent response timeout' ? 504 : 500;
      res.writeHead?.(status, { 'Content-Type': 'application/json' });
      res.end?.(JSON.stringify({ error: err.message }));
    }
  }

  // ---------------------------------------------------------------------------
  // Public accessors (for wiring in DkgNodePlugin)
  // ---------------------------------------------------------------------------

  get bridgePort(): number {
    return this.port;
  }

  get isUsingGatewayRoute(): boolean {
    return this.useGatewayRoute;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
