import { createLibp2p, type Libp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { kadDHT, type KadDHT } from '@libp2p/kad-dht';
import { gossipsub, type GossipSub } from '@libp2p/gossipsub';
import { mdns } from '@libp2p/mdns';
import { identify } from '@libp2p/identify';
import { ping, type Ping } from '@libp2p/ping';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { dcutr } from '@libp2p/dcutr';
import { autoNAT } from '@libp2p/autonat';
import { generateKeyPair, privateKeyFromRaw } from '@libp2p/crypto/keys';
import { peerIdFromString } from '@libp2p/peer-id';
import { ed25519GetPublicKey } from './crypto/ed25519.js';
import type { ConnectionInfo, ConnectionTransport, DKGNodeConfig } from './types.js';
import { DHT_PROTOCOL } from './constants.js';

export interface DKGServices extends Record<string, unknown> {
  dht: KadDHT;
  pubsub: GossipSub;
  identify: unknown;
  ping: Ping;
  dcutr: unknown;
  autoNAT?: unknown;
  relay?: unknown;
}

const RELAY_WATCHDOG_BASE_INTERVAL_MS = 15_000;
const RELAY_WATCHDOG_MAX_INTERVAL_MS = 5 * 60_000;

interface RelayTarget {
  peerId: ReturnType<typeof peerIdFromString>;
  addr: any;
}

type ProtocolHandler = (data: Uint8Array, remotePeerId: string) => Promise<Uint8Array>;
type PubsubMessageHandler = (topic: string, data: Uint8Array, from: string) => void;
type PeerHandler = (peerId: string) => void;
type ConnectionHandler = (info: ConnectionInfo) => void;

export class DKGNode {
  private node: Libp2p<DKGServices> | null = null;
  private readonly config: DKGNodeConfig;
  /** Peers currently connected only via relay (candidates for DCUtR upgrade). */
  private readonly relayedPeers = new Set<string>();
  private relayWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private relayTargets: RelayTarget[] = [];
  private relayWatchdogConsecutiveFailures = 0;

  constructor(config: DKGNodeConfig = {}) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.node) return;

    let privateKey;
    if (this.config.privateKey) {
      // privateKeyFromRaw needs 64 bytes for Ed25519: seed(32) + publicKey(32)
      const seed = this.config.privateKey;
      const pub = await ed25519GetPublicKey(seed);
      const raw64 = new Uint8Array(64);
      raw64.set(seed, 0);
      raw64.set(pub, 32);
      privateKey = privateKeyFromRaw(raw64);
    } else {
      privateKey = await generateKeyPair('Ed25519');
    }

    const peerDiscovery = [];
    if (this.config.bootstrapPeers && this.config.bootstrapPeers.length > 0) {
      peerDiscovery.push(bootstrap({ list: this.config.bootstrapPeers }));
    }
    if (this.config.enableMdns !== false) {
      peerDiscovery.push(mdns());
    }

    const transports: any[] = [tcp(), webSockets(), circuitRelayTransport()];

    const isCore = this.config.nodeRole === 'core';
    const enableRelay = this.config.enableRelayServer ?? isCore;

    // Nodes that already know their NAT status skip autoNAT probing:
    // - relayPeers set → agent behind NAT (knows it needs relay)
    // - enableRelayServer/core → public node acting as relay
    const useAutoNAT = this.config.enableAutoNAT ??
      !(this.config.relayPeers?.length || enableRelay);

    const services: Record<string, any> = {
      identify: identify(),
      ping: ping(),
      dht: kadDHT({ protocol: DHT_PROTOCOL }),
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: true,
      }),
      dcutr: dcutr(),
    };

    if (useAutoNAT) {
      services.autoNAT = autoNAT();
    }

    if (enableRelay) {
      services.relay = circuitRelayServer({
        reservations: {
          maxReservations: 256,
          defaultDurationLimit: 5 * 60 * 1000,
          defaultDataLimit: BigInt(1 << 24),
        },
      });
    }

    const listenAddrs = [
      ...(this.config.listenAddresses ?? [
        '/ip4/0.0.0.0/tcp/0',
        '/ip4/0.0.0.0/tcp/0/ws',
      ]),
    ];

    // When relay peers are configured, listen on circuit addresses to ensure
    // the node requests a reservation and becomes reachable through relays.
    if (this.config.relayPeers?.length) {
      listenAddrs.push('/p2p-circuit');
    }

    this.node = await createLibp2p<DKGServices>({
      privateKey,
      addresses: {
        listen: listenAddrs,
        ...(this.config.announceAddresses?.length
          ? { announce: this.config.announceAddresses }
          : {}),
      },
      transports: transports as any,
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery,
      services,
      connectionManager: {
        minConnections: 0,
      },
    } as any);

    this.setupConnectionObservability();

    // Connect to relay peers and tag them as keep-alive so libp2p's
    // connection manager maintains the connection and auto-redials.
    if (this.config.relayPeers?.length) {
      const { multiaddr } = await import('@multiformats/multiaddr');

      for (const addr of this.config.relayPeers) {
        const ma = multiaddr(addr);
        const p2pComponent = ma.getComponents().find(c => c.name === 'p2p');
        if (!p2pComponent?.value) continue;

        const peerId = peerIdFromString(p2pComponent.value);
        if (peerId.equals(this.node.peerId)) continue;

        this.relayTargets.push({ peerId, addr: ma });

        await this.node.peerStore.merge(peerId, {
          multiaddrs: [ma],
          tags: {
            'keep-alive-dkg-relay': { value: 100 },
          },
        });

        try {
          await this.node.dial(ma);
        } catch {
          // watchdog will retry
        }
      }

      this.startRelayWatchdog();
    }
  }

  /**
   * Periodically check that relay connections are alive. After a network
   * outage (e.g. laptop sleep/wake) TCP sockets die silently and libp2p
   * won't automatically redial. Uses exponential backoff when the relay is
   * unreachable and resets to the base interval on successful reconnect.
   */
  private startRelayWatchdog(): void {
    if (this.relayWatchdogTimer) return;
    if (this.relayTargets.length === 0) return;

    this.scheduleWatchdogTick();
  }

  private scheduleWatchdogTick(): void {
    const delay = Math.min(
      RELAY_WATCHDOG_BASE_INTERVAL_MS * Math.pow(2, this.relayWatchdogConsecutiveFailures),
      RELAY_WATCHDOG_MAX_INTERVAL_MS,
    );

    this.relayWatchdogTimer = setTimeout(async () => {
      await this.watchdogTick();
      if (this.node) this.scheduleWatchdogTick();
    }, delay);

    if (this.relayWatchdogTimer.unref) {
      this.relayWatchdogTimer.unref();
    }
  }

  private async watchdogTick(): Promise<void> {
    const node = this.node;
    if (!node) return;

    const ts = () => new Date().toISOString();
    const short = (id: string) => id.slice(-8);
    let allConnected = true;

    for (const { peerId, addr } of this.relayTargets) {
      if (peerId.equals(node.peerId)) continue;

      const conns = node.getConnections(peerId);
      if (conns.length > 0) continue;

      allConnected = false;
      console.log(`[${ts()}] Relay watchdog: ${short(peerId.toString())} disconnected, redialing…`);
      try {
        await node.dial(addr);
        console.log(`[${ts()}] Relay watchdog: reconnected to ${short(peerId.toString())}`);
      } catch (err: any) {
        console.log(`[${ts()}] Relay watchdog: redial failed for ${short(peerId.toString())}: ${err.message}`);
      }
    }

    if (allConnected) {
      this.relayWatchdogConsecutiveFailures = 0;
    } else {
      this.relayWatchdogConsecutiveFailures++;
      const nextDelay = Math.min(
        RELAY_WATCHDOG_BASE_INTERVAL_MS * Math.pow(2, this.relayWatchdogConsecutiveFailures),
        RELAY_WATCHDOG_MAX_INTERVAL_MS,
      );
      console.log(`[${ts()}] Relay watchdog: next check in ${Math.round(nextDelay / 1000)}s (attempt ${this.relayWatchdogConsecutiveFailures})`);
    }
  }

  /**
   * Wire up connection:open / connection:close listeners that track transport
   * type (direct vs relayed) and detect DCUtR upgrades from relay to direct.
   */
  private setupConnectionObservability(): void {
    const node = this.requireNode();
    const ts = () => new Date().toISOString();
    const short = (id: string) => id.slice(-8);

    node.addEventListener('connection:open', (evt) => {
      const conn = evt.detail;
      const pid = conn.remotePeer.toString();
      const addr = conn.remoteAddr?.toString() ?? 'unknown';
      const transport: ConnectionTransport = this.isRelayedAddress(addr)
        ? 'relayed'
        : 'direct';
      const dir = conn.direction;

      if (transport === 'relayed') {
        this.relayedPeers.add(pid);
        console.log(
          `[${ts()}] Connection opened: ${short(pid)} transport=relayed ` +
          `dir=${dir} addr=${addr}`,
        );
      } else {
        const upgraded = this.relayedPeers.has(pid);
        if (upgraded) {
          this.relayedPeers.delete(pid);
          console.log(
            `[${ts()}] DCUtR upgrade: ${short(pid)} relayed -> direct ` +
            `dir=${dir} addr=${addr}`,
          );
        } else {
          console.log(
            `[${ts()}] Connection opened: ${short(pid)} transport=direct ` +
            `dir=${dir} addr=${addr}`,
          );
        }
      }
    });

    node.addEventListener('connection:close', (evt) => {
      const conn = evt.detail;
      const pid = conn.remotePeer.toString();
      const addr = conn.remoteAddr?.toString() ?? 'unknown';
      const transport: ConnectionTransport = this.isRelayedAddress(addr)
        ? 'relayed'
        : 'direct';
      const durationMs = conn.timeline.close
        ? conn.timeline.close - conn.timeline.open
        : '?';

      // If this was the last connection to the peer, clean up tracking state.
      const remaining = node.getConnections(conn.remotePeer);
      if (remaining.length === 0) {
        this.relayedPeers.delete(pid);
      }

      console.log(
        `[${ts()}] Connection closed: ${short(pid)} transport=${transport} ` +
        `duration=${durationMs}ms addr=${addr}`,
      );
    });

    node.addEventListener('peer:disconnect', (evt) => {
      const pid = evt.detail.toString();
      this.relayedPeers.delete(pid);
      console.log(`[${ts()}] Peer disconnected: ${short(pid)}`);
    });
  }

  async stop(): Promise<void> {
    if (!this.node) return;
    if (this.relayWatchdogTimer) {
      clearTimeout(this.relayWatchdogTimer);
      this.relayWatchdogTimer = null;
    }
    this.relayTargets = [];
    this.relayWatchdogConsecutiveFailures = 0;
    this.relayedPeers.clear();
    await this.node.stop();
    this.node = null;
  }

  async dial(address: string): Promise<void> {
    const node = this.requireNode();
    const { multiaddr } = await import('@multiformats/multiaddr');
    await node.dial(multiaddr(address));
  }

  getPeers(): string[] {
    return this.requireNode().getPeers().map((p) => p.toString());
  }

  getConnections(peerIdStr?: string): ConnectionInfo[] {
    const node = this.requireNode();
    const conns = peerIdStr
      ? node.getConnections(peerIdFromString(peerIdStr))
      : node.getConnections();
    return conns.map((c) => this.connectionToInfo(c));
  }

  onPeerConnect(handler: PeerHandler): () => void {
    const node = this.requireNode();
    const listener = ((evt: any) => {
      handler(evt.detail.toString());
    }) as EventListener;
    node.addEventListener('peer:connect', listener);
    return () => node.removeEventListener('peer:connect', listener);
  }

  onPeerDisconnect(handler: PeerHandler): () => void {
    const node = this.requireNode();
    const listener = ((evt: any) => {
      handler(evt.detail.toString());
    }) as EventListener;
    node.addEventListener('peer:disconnect', listener);
    return () => node.removeEventListener('peer:disconnect', listener);
  }

  onConnectionOpen(handler: ConnectionHandler): () => void {
    const node = this.requireNode();
    const listener = ((evt: any) => {
      handler(this.connectionToInfo(evt.detail));
    }) as EventListener;
    node.addEventListener('connection:open', listener);
    return () => node.removeEventListener('connection:open', listener);
  }

  onConnectionClose(handler: ConnectionHandler): () => void {
    const node = this.requireNode();
    const listener = ((evt: any) => {
      handler(this.connectionToInfo(evt.detail));
    }) as EventListener;
    node.addEventListener('connection:close', listener);
    return () => node.removeEventListener('connection:close', listener);
  }

  async peerSupportsProtocol(peerIdStr: string, protocolId: string): Promise<boolean> {
    const node = this.requireNode();
    try {
      const peer = await node.peerStore.get(peerIdFromString(peerIdStr));
      return peer.protocols.includes(protocolId);
    } catch {
      return false;
    }
  }

  async addPeerAddress(
    peerIdStr: string,
    address: string,
    options?: { keepAlive?: boolean },
  ): Promise<void> {
    const node = this.requireNode();
    const { multiaddr } = await import('@multiformats/multiaddr');
    const peerId = peerIdFromString(peerIdStr);
    const ma = multiaddr(address);
    const mergeData: any = { multiaddrs: [ma] };
    if (options?.keepAlive) {
      mergeData.tags = { 'keep-alive-dkg-relay': { value: 100 } };
    }
    await node.peerStore.merge(peerId, mergeData);
  }

  buildRelayAddress(relayAddress: string, peerIdStr: string): string {
    const relayBase = relayAddress.endsWith('/')
      ? relayAddress.slice(0, -1)
      : relayAddress;
    return `${relayBase}/p2p-circuit/p2p/${peerIdStr}`;
  }

  async addRelayAddress(
    peerIdStr: string,
    relayAddress: string,
    options?: { keepAlive?: boolean },
  ): Promise<void> {
    await this.addPeerAddress(
      peerIdStr,
      this.buildRelayAddress(relayAddress, peerIdStr),
      options,
    );
  }

  getRelayReservationAddresses(): string[] {
    return this.multiaddrs.filter((addr) => this.isRelayedAddress(addr));
  }

  hasRelayReservation(): boolean {
    return this.getRelayReservationAddresses().length > 0;
  }

  handleProtocol(protocolId: string, handler: ProtocolHandler): void {
    const node = this.requireNode();
    node.handle(protocolId, async (stream: any, connection: any) => {
      try {
        const requestData = await readAll(stream);
        const responseData = await handler(requestData, connection.remotePeer.toString());
        stream.send(responseData);
        await stream.close();
      } catch (err) {
        console.error(
          `[DKGNode] protocol handler error on ${protocolId} from ${connection.remotePeer.toString().slice(-8)}:`,
          err instanceof Error ? err.message : err,
        );
        try {
          stream.abort(new Error('handler error'));
        } catch {
          // stream already closed
        }
      }
    }, { runOnLimitedConnection: true });
  }

  unhandleProtocol(protocolId: string): void {
    this.requireNode().unhandle(protocolId);
  }

  async sendProtocol(
    peerIdStr: string,
    protocolId: string,
    data: Uint8Array,
    timeoutMs = 10_000,
  ): Promise<Uint8Array> {
    const node = this.requireNode();
    const peerId = peerIdFromString(peerIdStr);
    const signal = AbortSignal.timeout(timeoutMs);
    const stream = await node.dialProtocol(peerId, protocolId, {
      runOnLimitedConnection: true,
      signal,
    });

    if (stream.writeStatus === 'closed' || stream.writeStatus === 'closing') {
      stream.abort(new Error('stream closed before send'));
      throw new Error('stream returned in closed state');
    }

    stream.send(data);
    await stream.close({ signal });

    return await readAll(stream);
  }

  onPubsubMessage(handler: PubsubMessageHandler): () => void {
    const pubsub = this.requireNode().services.pubsub;
    const listener = ((evt: any) => {
      const msg = evt.detail;
      const topic = msg.topic;
      const data = msg.data instanceof Uint8Array ? msg.data : new Uint8Array(0);
      const from = 'from' in msg ? String(msg.from) : 'unknown';
      handler(topic, data, from);
    }) as EventListener;
    pubsub.addEventListener('message', listener);
    return () => pubsub.removeEventListener('message', listener);
  }

  subscribeTopic(topic: string): void {
    this.requireNode().services.pubsub.subscribe(topic);
  }

  unsubscribeTopic(topic: string): void {
    this.requireNode().services.pubsub.unsubscribe(topic);
  }

  async publishTopic(topic: string, data: Uint8Array): Promise<void> {
    await this.requireNode().services.pubsub.publish(topic, data);
  }

  getSubscribedTopics(): string[] {
    return this.requireNode().services.pubsub.getTopics();
  }

  get peerId(): string {
    return this.requireNode().peerId.toString();
  }

  get peerIdBytes(): Uint8Array {
    return this.requireNode().peerId.toMultihash().bytes;
  }

  get multiaddrs(): string[] {
    return this.requireNode()
      .getMultiaddrs()
      .map((ma) => ma.toString());
  }

  get libp2p(): Libp2p<DKGServices> {
    return this.requireNode();
  }

  get isStarted(): boolean {
    return this.node !== null;
  }

  private requireNode(): Libp2p<DKGServices> {
    if (!this.node) throw new Error('DKGNode not started');
    return this.node;
  }

  private connectionToInfo(conn: any): ConnectionInfo {
    const addr = conn.remoteAddr?.toString() ?? 'unknown';
    const transport: ConnectionTransport = this.isRelayedAddress(addr)
      ? 'relayed'
      : 'direct';
    return {
      peerId: conn.remotePeer.toString(),
      remoteAddr: addr,
      transport,
      direction: conn.direction,
      openedAt: conn.timeline?.open ?? Date.now(),
    };
  }

  private isRelayedAddress(addr: string): boolean {
    return addr.includes('/p2p-circuit');
  }
}

async function readAll(stream: AsyncIterable<any>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    if (chunk instanceof Uint8Array) {
      chunks.push(chunk);
      continue;
    }

    if (chunk && typeof chunk.subarray === 'function') {
      chunks.push(new Uint8Array(chunk.subarray()));
      continue;
    }

    if (chunk && typeof chunk.slice === 'function') {
      chunks.push(new Uint8Array(chunk.slice()));
    }
  }
  return concat(chunks);
}

function concat(arrays: Uint8Array[]): Uint8Array {
  if (arrays.length === 0) return new Uint8Array(0);
  if (arrays.length === 1) return arrays[0];
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}
