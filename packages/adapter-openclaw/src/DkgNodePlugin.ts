/**
 * DkgNodePlugin — OpenClaw adapter that turns any OpenClaw agent into a
 * DKG V9 node.
 *
 * Wraps a `DKGAgent` and exposes its capabilities as OpenClaw tools.
 * The agent lifecycle is bound to the OpenClaw session: node starts on
 * `session_start` and stops on `session_end`.
 */
import { DKGAgent, type DKGAgentConfig } from '@dkg/agent';
import type {
  DkgOpenClawConfig,
  OpenClawPluginApi,
  OpenClawTool,
  OpenClawToolResult,
} from './types.js';

export class DkgNodePlugin {
  private agent: DKGAgent | null = null;
  private readonly config: DkgOpenClawConfig;

  constructor(config?: DkgOpenClawConfig) {
    this.config = {
      dataDir: '.dkg/openclaw',
      ...config,
    };
  }

  /**
   * Register the DKG plugin with an OpenClaw plugin API instance.
   * Registers lifecycle hooks and agent-facing tools.
   */
  register(api: OpenClawPluginApi): void {
    api.registerHook('session_start', () => this.start());
    api.registerHook('session_end', () => this.stop());

    for (const tool of this.tools()) {
      api.registerTool(tool);
    }
  }

  async start(): Promise<void> {
    if (this.agent) return;

    const agentConfig: DKGAgentConfig = {
      name: this.config.name ?? 'openclaw-agent',
      framework: 'OpenClaw',
      description: this.config.description,
      listenPort: this.config.listenPort,
      dataDir: this.config.dataDir,
      relayPeers: this.config.relayPeers,
      bootstrapPeers: this.config.bootstrapPeers,
      skills: this.config.skills?.map(s => ({
        skillType: s.skillType,
        pricePerCall: s.pricePerCall,
        currency: s.currency,
        handler: async (req: any) => {
          const result = await s.handler(req.inputData);
          return {
            success: result.status === 'ok',
            outputData: result.output,
            error: result.error,
          };
        },
      })),
    };

    this.agent = await DKGAgent.create(agentConfig);
    await this.agent.start();
    await this.agent.publishProfile();
  }

  async stop(): Promise<void> {
    if (!this.agent) return;
    await this.agent.stop();
    this.agent = null;
  }

  getAgent(): DKGAgent | null {
    return this.agent;
  }

  private requireAgent(): DKGAgent {
    if (!this.agent) throw new Error('DKG node not started');
    return this.agent;
  }

  private tools(): OpenClawTool[] {
    return [
      {
        name: 'dkg_status',
        description: 'Show DKG node status: peer ID, connected peers, multiaddrs.',
        parameters: {},
        handler: async () => this.handleStatus(),
      },
      {
        name: 'dkg_publish',
        description: 'Publish RDF triples (N-Quads) to a DKG paranet.',
        parameters: {
          paranet_id: { type: 'string', description: 'Target paranet ID', required: true },
          nquads: { type: 'string', description: 'N-Quads triples to publish', required: true },
        },
        handler: async (args) => this.handlePublish(args),
      },
      {
        name: 'dkg_query',
        description: 'Run a SPARQL query against the local DKG triple store.',
        parameters: {
          sparql: { type: 'string', description: 'SPARQL query string', required: true },
          paranet_id: { type: 'string', description: 'Optional paranet scope' },
        },
        handler: async (args) => this.handleQuery(args),
      },
      {
        name: 'dkg_find_agents',
        description: 'Discover DKG agents by framework or skill type.',
        parameters: {
          framework: { type: 'string', description: 'Filter by framework (OpenClaw, ElizaOS)' },
          skill_type: { type: 'string', description: 'Filter by skill type URI' },
        },
        handler: async (args) => this.handleFindAgents(args),
      },
      {
        name: 'dkg_send_message',
        description: 'Send an encrypted chat message to another DKG agent by peer ID.',
        parameters: {
          peer_id: { type: 'string', description: 'Recipient peer ID', required: true },
          text: { type: 'string', description: 'Message text', required: true },
        },
        handler: async (args) => this.handleSendMessage(args),
      },
      {
        name: 'dkg_invoke_skill',
        description: 'Invoke a remote agent skill on the DKG network.',
        parameters: {
          peer_id: { type: 'string', description: 'Target agent peer ID', required: true },
          skill_uri: { type: 'string', description: 'Skill URI to invoke', required: true },
          input: { type: 'string', description: 'Input data (UTF-8 text)', required: true },
        },
        handler: async (args) => this.handleInvokeSkill(args),
      },
    ];
  }

  private async handleStatus(): Promise<OpenClawToolResult> {
    try {
      const agent = this.requireAgent();
      const peers = agent.node.libp2p.getPeers();
      return {
        status: 'ok',
        data: {
          peerId: agent.peerId,
          multiaddrs: agent.multiaddrs,
          connectedPeers: peers.map(p => p.toString()),
          peerCount: peers.length,
        },
      };
    } catch (err: any) {
      return { status: 'error', message: err.message };
    }
  }

  private async handlePublish(args: Record<string, unknown>): Promise<OpenClawToolResult> {
    try {
      const agent = this.requireAgent();
      const paranetId = String(args.paranet_id);
      const nquadsText = String(args.nquads);

      const quads = parseNQuadsText(nquadsText);
      const result = await agent.publish(paranetId, quads as any);
      return {
        status: 'ok',
        data: { kcId: result.kcId, kaCount: result.kaManifest.length },
      };
    } catch (err: any) {
      return { status: 'error', message: err.message };
    }
  }

  private async handleQuery(args: Record<string, unknown>): Promise<OpenClawToolResult> {
    try {
      const agent = this.requireAgent();
      const sparql = String(args.sparql);
      const paranetId = args.paranet_id ? String(args.paranet_id) : undefined;
      const result = await agent.query(sparql, paranetId);
      return { status: 'ok', data: result };
    } catch (err: any) {
      return { status: 'error', message: err.message };
    }
  }

  private async handleFindAgents(args: Record<string, unknown>): Promise<OpenClawToolResult> {
    try {
      const agent = this.requireAgent();

      if (args.skill_type) {
        const offerings = await agent.findSkills({ skillType: String(args.skill_type) });
        return { status: 'ok', data: offerings };
      }

      const agents = await agent.findAgents(
        args.framework ? { framework: String(args.framework) } : undefined,
      );
      return { status: 'ok', data: agents };
    } catch (err: any) {
      return { status: 'error', message: err.message };
    }
  }

  private async handleSendMessage(args: Record<string, unknown>): Promise<OpenClawToolResult> {
    try {
      const agent = this.requireAgent();
      const result = await agent.sendChat(String(args.peer_id), String(args.text));
      return { status: 'ok', data: result };
    } catch (err: any) {
      return { status: 'error', message: err.message };
    }
  }

  private async handleInvokeSkill(args: Record<string, unknown>): Promise<OpenClawToolResult> {
    try {
      const agent = this.requireAgent();
      const response = await agent.invokeSkill(
        String(args.peer_id),
        String(args.skill_uri),
        new TextEncoder().encode(String(args.input)),
      );
      return {
        status: 'ok',
        data: {
          success: response.success,
          output: response.outputData ? new TextDecoder().decode(response.outputData) : undefined,
          error: response.error,
        },
      };
    } catch (err: any) {
      return { status: 'error', message: err.message };
    }
  }
}

function parseNQuadsText(text: string): Array<{ subject: string; predicate: string; object: string; graph?: string }> {
  const quads: Array<{ subject: string; predicate: string; object: string; graph?: string }> = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^<([^>]+)>\s+<([^>]+)>\s+("[^"]*(?:\\.[^"]*)*"(?:@\w+|(?:\^\^<[^>]+>))?|<[^>]+>)\s*(?:<([^>]+)>)?\s*\.?\s*$/);
    if (!match) continue;
    quads.push({
      subject: match[1],
      predicate: match[2],
      object: match[3].startsWith('<') ? match[3].slice(1, -1) : match[3],
      graph: match[4],
    });
  }
  return quads;
}
