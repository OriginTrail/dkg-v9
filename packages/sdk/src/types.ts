export interface DKGClientOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface Quad {
  subject: string;
  predicate: string;
  object: string;
  graph: string;
}

export interface NodeStatus {
  name: string;
  peerId: string;
  nodeRole?: string;
  networkId?: string;
  uptimeMs: number;
  connectedPeers: number;
  relayConnected: boolean;
  multiaddrs: string[];
}

export interface DKGSDK {
  node: {
    status(): Promise<NodeStatus>;
  };
  paranet: {
    list(): Promise<ListParanetsResponse>;
    create(input: CreateParanetInput): Promise<CreateParanetResponse>;
    exists(id: string): Promise<ParanetExistsResponse>;
    subscribe(paranetId: string, options?: SubscribeParanetOptions): Promise<SubscribeParanetResponse>;
    catchupStatus(paranetId: string): Promise<CatchupStatusResponse>;
  };
  publish: {
    quads(input: PublishQuadsInput): Promise<PublishResult>;
    workspaceWrite(input: WorkspaceWriteInput): Promise<WorkspaceWriteResult>;
    workspaceEnshrine(input: WorkspaceEnshrineInput): Promise<WorkspaceEnshrineResult>;
  };
  query: {
    sparql(sparql: string, options?: QueryOptions): Promise<QueryResult>;
    remote(input: QueryRemoteInput): Promise<QueryRemoteResult>;
  };
}

export type AccessPolicy = 'public' | 'ownerOnly' | 'allowList';

export interface KARef {
  tokenId: string;
  rootEntity: string;
}

export interface PublishResult {
  kcId: string;
  status: 'tentative' | 'confirmed';
  kas: KARef[];
  txHash?: string;
  blockNumber?: number;
  batchId?: string;
  publisherAddress?: string;
}

export interface PublishQuadsInput {
  paranetId: string;
  quads: Quad[];
  privateQuads?: Quad[];
  accessPolicy?: AccessPolicy;
  allowedPeers?: string[];
}

export interface WorkspaceWriteInput {
  paranetId: string;
  quads: Quad[];
}

export interface WorkspaceWriteResult {
  workspaceOperationId: string;
  paranetId: string;
  graph: string;
  triplesWritten: number;
  skolemizedBlankNodes?: number;
}

export type WorkspaceSelection = 'all' | { rootEntities: string[] };

export interface WorkspaceEnshrineInput {
  paranetId: string;
  selection?: WorkspaceSelection;
  clearAfter?: boolean;
}

export interface WorkspaceEnshrineResult {
  kcId: string;
  status: 'tentative' | 'confirmed';
  kas: KARef[];
  txHash?: string;
  blockNumber?: number;
}

export interface QueryOptions {
  paranetId?: string;
}

export interface QueryResult {
  result: unknown;
}

export interface QueryRemoteInput {
  peerId: string;
  lookupType: string;
  paranetId?: string;
  ual?: string;
  entityUri?: string;
  rdfType?: string;
  sparql?: string;
  limit?: number;
  timeout?: number;
}

export interface QueryRemoteResult {
  operationId: string;
  status: string;
  ntriples?: string;
  bindings?: string;
  entityUris?: string[];
  truncated: boolean;
  resultCount: number;
  gasConsumed?: number;
  error?: string;
}

export interface ParanetSummary {
  id: string;
  uri: string;
  name: string;
  description?: string;
  creator?: string;
  createdAt?: string;
  isSystem: boolean;
}

export interface ListParanetsResponse {
  paranets: ParanetSummary[];
}

export interface CreateParanetInput {
  id: string;
  name: string;
  description?: string;
}

export interface CreateParanetResponse {
  created: string;
  uri: string;
}

export interface ParanetExistsResponse {
  id: string;
  exists: boolean;
}

export interface SubscribeParanetOptions {
  includeWorkspace?: boolean;
}

export interface CatchupResult {
  connectedPeers: number;
  syncCapablePeers: number;
  peersTried: number;
  dataSynced: number;
  workspaceSynced: number;
}

export interface QueuedCatchup {
  status: 'queued';
  includeWorkspace: boolean;
  jobId: string;
}

export interface SubscribeParanetResponse {
  subscribed: string;
  catchup?: CatchupResult | QueuedCatchup;
}

export interface CatchupStatusResponse {
  jobId: string;
  paranetId: string;
  includeWorkspace: boolean;
  status: 'queued' | 'running' | 'done' | 'failed';
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: CatchupResult;
  error?: string;
}
