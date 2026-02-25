import type { ChainAdapter, EventFilter, ChainEvent } from '@dkg/chain';
import { Logger, createOperationContext, type OperationContext } from '@dkg/core';
import type { PublishHandler } from './publish-handler.js';
import { ethers } from 'ethers';

export interface ChainEventPollerConfig {
  chain: ChainAdapter;
  publishHandler: PublishHandler;
  /** Polling interval in ms. Default: 12000 (roughly 1 L2 block). */
  intervalMs?: number;
}

/**
 * Background poller that watches for on-chain KnowledgeBatchCreated events
 * and promotes tentative publishes to confirmed. Runs independently of
 * GossipSub — the chain is the single source of truth for finalization.
 *
 * The GossipSub confirmation (if it arrives first) acts as a fast hint;
 * this poller provides trustless, publisher-independent confirmation.
 */
export class ChainEventPoller {
  private readonly chain: ChainAdapter;
  private readonly publishHandler: PublishHandler;
  private readonly intervalMs: number;
  private readonly log = new Logger('ChainEventPoller');
  private lastBlock = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: ChainEventPollerConfig) {
    this.chain = config.chain;
    this.publishHandler = config.publishHandler;
    this.intervalMs = config.intervalMs ?? 12_000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    const ctx = createOperationContext('system');
    this.log.info(ctx, `Starting chain event poller (interval=${this.intervalMs}ms)`);

    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        const pollCtx = createOperationContext('system');
        this.log.error(pollCtx, `Poll failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, this.intervalMs);

    // Run first poll immediately
    this.poll().catch(() => {});
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;

    const ctx = createOperationContext('system');
    this.log.info(ctx, 'Chain event poller stopped');
  }

  private async poll(): Promise<void> {
    if (!this.publishHandler.hasPendingPublishes) return;

    const ctx = createOperationContext('publish');

    const filter: EventFilter = {
      eventTypes: ['KnowledgeBatchCreated'],
      fromBlock: this.lastBlock + 1,
    };

    let maxBlock = this.lastBlock;

    for await (const event of this.chain.listenForEvents(filter)) {
      if (event.blockNumber > maxBlock) {
        maxBlock = event.blockNumber;
      }

      if (event.type === 'KnowledgeBatchCreated') {
        await this.handleBatchCreated(event, ctx);
      }
    }

    if (maxBlock > this.lastBlock) {
      this.lastBlock = maxBlock;
    }
  }

  private async handleBatchCreated(event: ChainEvent, ctx: OperationContext): Promise<void> {
    const { data } = event;

    const merkleRoot = typeof data['merkleRoot'] === 'string'
      ? ethers.getBytes(data['merkleRoot'] as string)
      : data['merkleRoot'] as Uint8Array;

    const publisherAddress = data['publisherAddress'] as string ?? '';
    const startKAId = BigInt(data['startKAId'] as string ?? '0');
    const endKAId = BigInt(data['endKAId'] as string ?? '0');

    this.log.info(ctx,
      `Chain event: KnowledgeBatchCreated block=${event.blockNumber} ` +
      `publisher=${publisherAddress} range=${startKAId}..${endKAId}`,
    );

    const confirmed = await this.publishHandler.confirmByMerkleRoot(
      merkleRoot,
      {
        publisherAddress,
        startKAId,
        endKAId,
        chainId: this.chain.chainId,
      },
      ctx,
    );

    if (confirmed) {
      this.log.info(ctx, `Confirmed tentative publish via chain event (block ${event.blockNumber})`);
    }
  }
}
