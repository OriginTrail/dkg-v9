// daemon/handle-request.ts
//
// The `handleRequest` HTTP router (~5,160 lines) extracted verbatim
// from the legacy monolithic `daemon.ts`. Single switch over URL
// pathnames; called per-request by the http server set up in
// `./lifecycle.ts`.
//
// Splitting this internally by route group is the next AI-DX win
// and is queued as a follow-up PR.

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { execSync, exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname, resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync, openSync, closeSync, writeFileSync as fsWriteFileSync, unlinkSync } from 'node:fs';
// Namespace import: our Phase-8 install-context builder (~line 290) calls
// `osModule.homedir()`, and the later agent-identity probe (~line 6851)
// uses `osModule.hostname()` + `osModule.userInfo()`. v10-rc's new
// OpenClaw config helper (~line 2535) uses a bare `homedir()` — aliased
// below so both sites coexist without a duplicate-module import.
import * as osModule from 'node:os';
const { homedir } = osModule;
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ethers } from 'ethers';

// Lazy resolver used by the manifest-install flow: find the
// @origintrail-official/dkg-mcp package via Node's own resolution
// algorithm, so the daemon can write workspace-level configs that
// point at a valid MCP server install regardless of whether it's
// running from a monorepo checkout, an npm-global `dkg`, or a
// `pnpm dlx` tarball.
const daemonRequire = createRequire(import.meta.url);

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
import { enrichEvmError, MockChainAdapter } from '@origintrail-official/dkg-chain';
import { DKGAgent, loadOpWallets } from '@origintrail-official/dkg-agent';
import { computeNetworkId, createOperationContext, DKGEvent, Logger, PayloadTooLargeError, GET_VIEWS, TrustLevel, validateSubGraphName, validateAssertionName, validateContextGraphId, isSafeIri, assertSafeIri, sparqlIri, contextGraphSharedMemoryUri, contextGraphAssertionUri, contextGraphMetaUri } from '@origintrail-official/dkg-core';
import { findReservedSubjectPrefix, isSkolemizedUri } from '@origintrail-official/dkg-publisher';
import {
  DashboardDB,
  MetricsCollector,
  OperationTracker,
  handleNodeUIRequest,
  ChatMemoryManager,
  LogPushWorker,
  LlmClient,
  type MetricsSource,
} from "@origintrail-official/dkg-node-ui";
import {
  loadConfig,
  saveConfig,
  loadNetworkConfig,
  dkgDir,
  writePid,
  removePid,
  writeApiPort,
  removeApiPort,
  logPath,
  ensureDkgDir,
  TELEMETRY_ENDPOINTS,
  type DkgConfig,
  type AutoUpdateConfig,
  type LocalAgentIntegrationCapabilities,
  type LocalAgentIntegrationConfig,
  type LocalAgentIntegrationManifest,
  type LocalAgentIntegrationRuntime,
  type LocalAgentIntegrationStatus,
  type LocalAgentIntegrationTransport,
  resolveContextGraphs,
  resolveNetworkDefaultContextGraphs,
  resolveSharedMemoryTtlMs,
  repoDir,
  releasesDir,
  activeSlot,
  inactiveSlot,
  swapSlot,
  gitCommandEnv,
  gitCommandArgs,
  isStandaloneInstall,
  slotEntryPoint,
  CLI_NPM_PACKAGE,
} from '../config.js';
import { createPublisherControlFromStore, startPublisherRuntimeIfEnabled, type PublisherRuntime } from '../publisher-runner.js';
import { createCatchupRunner, type CatchupJobResult, type CatchupRunner } from '../catchup-runner.js';
import { loadTokens, httpAuthGuard, extractBearerToken } from '../auth.js';
import { ExtractionPipelineRegistry } from '@origintrail-official/dkg-core';
import { MarkItDownConverter, isMarkItDownAvailable, extractFromMarkdown, extractWithLlm } from '../extraction/index.js';
import {
  expectedBundledMarkItDownBuildMetadata,
  readCliPackageVersion,
  type BundledMarkItDownMetadata,
} from "../extraction/markitdown-bundle-metadata.js";
import {
  checksumPathFor as markItDownChecksumPath,
  hasVerifiedBundledBinary as hasVerifiedBundledMarkItDownBinary,
  metadataPathFor as markItDownMetadataPath,
} from '../../scripts/markitdown-bundle-validation.mjs';
import { type ExtractionStatusRecord, getExtractionStatusRecord, setExtractionStatusRecord } from '../extraction-status.js';
import { FileStore } from '../file-store.js';
import { VectorStore, OpenAIEmbeddingProvider, type EmbeddingProvider } from '../vector-store.js';
import { parseBoundary, parseMultipart, MultipartParseError } from '../http/multipart.js';
import { handleCapture, EpcisValidationError, handleEventsQuery, EpcisQueryError, type Publisher as EpcisPublisher } from '@origintrail-official/dkg-epcis';
// Phase 8 — project-manifest publish + install (UI-driven onboarding flow).
// Daemon constructs a self-pointing DkgClient (localhost:listenPort) and
// reuses the same publish/fetch/plan/write helpers the CLI uses, so wire
// format stays identical between curator/joiner/CLI paths.
import {
  publishManifest as publishManifestImpl,
  assembleStandardTemplates,
} from '@origintrail-official/dkg-mcp/manifest/publish';
import { fetchManifest as fetchManifestImpl } from '@origintrail-official/dkg-mcp/manifest/fetch';
import {
  planInstall as planInstallImpl,
  writeInstall as writeInstallImpl,
  buildReviewMarkdown as buildReviewMarkdownImpl,
  type InstallContext,
} from '@origintrail-official/dkg-mcp/manifest/install';
import { DkgClient } from '@origintrail-official/dkg-mcp/client';

import {
  loadApps,
  handleAppRequest,
  startAppStaticServer,
  type LoadedApp,
} from "../app-loader.js";

// Daemon sub-module imports — every public symbol from sibling
// modules is pulled in here because the legacy monolithic file used
// them all without explicit imports. Unused ones are tolerated by
// the project's tsconfig (`noUnusedLocals` is off).
import {
  daemonState,
  type CorsAllowlist,
} from './state.js';
import {
  type CatchupJobState,
  type CatchupJob,
  type CatchupTracker,
  toCatchupStatusResponse,
} from './types.js';
import {
  type MarkItDownTarget,
  manifestRepoRoot,
  type McpDkgAssets,
  resolveMcpDkgAssets,
  readMcpDkgVersion,
  parseSemver,
  cmpSemverForRange,
  versionSatisfiesRange,
  manifestNetworkLabel,
  formatDaemonAuthority,
  manifestSelfClient,
  manifestPublisherUri,
  type SupportedTool,
  nicknameToSlug,
  buildManifestInstallContext,
  _autoUpdateIo,
  loadMarkItDownTargets,
  getNodeVersion,
  getCurrentCommitShort,
  loadSkillTemplate,
  buildSkillMd,
  skillEtag,
  DAEMON_EXIT_CODE_RESTART,
  parseRequiredSignatures,
  normalizeDetectedContentType,
  currentBundledMarkItDownAssetName,
  bindingValue,
  carryForwardBundledMarkItDownBinary,
} from './manifest.js';
import {
  resolveNameToPeerId,
  isPublishQuad,
  parsePublishRequestBody,
  jsonResponse,
  safeDecodeURIComponent,
  safeParseJson,
  validateOptionalSubGraphName,
  validateRequiredContextGraphId,
  validateEntities,
  validateConditions,
  MAX_BODY_BYTES,
  SMALL_BODY_BYTES,
  MAX_UPLOAD_BYTES,
  type ImportFileExtractionPayload,
  buildImportFileResponse,
  unregisteredSubGraphError,
  readBody,
  readBodyBuffer,
  buildCorsAllowlist,
  resolveCorsOrigin,
  corsHeaders,
  HttpRateLimiter,
  isLoopbackClientIp,
  isLoopbackRateLimitExemptPath,
  shouldBypassRateLimitForLoopbackTraffic,
  isValidContextGraphId,
  shortId,
  sleep,
  deriveBlockExplorerUrl,
} from './http-utils.js';
import {
  normalizeRepo,
  parseTagName,
  isValidRef,
  isValidRepoSpec,
  repoToFetchUrl,
  githubRepoForApi,
  resolveRemoteCommitSha,
  type PendingUpdateState,
  type CommitCheckStatus,
  readPendingUpdateState,
  clearPendingUpdateState,
  writePendingUpdateState,
  type NpmVersionResult,
  resolveLatestNpmVersion,
  compareSemver,
  getCurrentCliVersion,
  type NpmVersionStatus,
  checkForNpmVersionUpdate,
  checkForNewCommit,
  checkForNewCommitWithStatus,
  type UpdateStatus,
  acquireUpdateLock,
  releaseUpdateLock,
  performUpdate,
  performUpdateWithStatus,
  performNpmUpdate,
  checkForUpdate,
} from './auto-update.js';
import {
  OPENCLAW_UI_CONNECT_TIMEOUT_MS,
  OPENCLAW_UI_CONNECT_POLL_MS,
  OPENCLAW_CHANNEL_RESPONSE_TIMEOUT_MS,
  type PendingOpenClawUiAttachJob,
  isOpenClawBridgeHealthCacheValid,
  type OpenClawChannelTarget,
  trimTrailingSlashes,
  buildOpenClawGatewayBase,
  loadBridgeAuthToken,
  getOpenClawChannelTargets,
  type OpenClawBridgeHealthState,
  type OpenClawGatewayHealthState,
  type OpenClawChannelHealthReport,
  transportPatchFromOpenClawTarget,
  probeOpenClawChannelHealth,
  runOpenClawUiSetup,
  localOpenclawConfigPath,
  isOpenClawMemorySlotElected,
  restartOpenClawGateway,
  waitForOpenClawChatReady,
  type OpenClawUiAttachDeps,
  formatOpenClawUiAttachFailure,
  scheduleOpenClawUiAttachJob,
  cancelPendingLocalAgentAttachJob,
  isOpenClawUiAttachCancelled,
  shouldTryNextOpenClawTarget,
  buildOpenClawChannelHeaders,
  ensureOpenClawBridgeAvailable,
  type OpenClawStreamRequest,
  type OpenClawStreamResponse,
  type OpenClawStreamReader,
  writeOpenClawStreamChunk,
  pipeOpenClawStream,
  isValidOpenClawPersistTurnPayload,
  type OpenClawAttachmentRef,
  normalizeOpenClawAttachmentRef,
  normalizeOpenClawAttachmentRefs,
  type OpenClawChatContextEntry,
  normalizeOpenClawChatContextEntry,
  normalizeOpenClawChatContextEntries,
  hasOpenClawChatTurnContent,
  unescapeOpenClawAttachmentLiteralBody,
  stripOpenClawAttachmentLiteral,
  parseOpenClawAttachmentTripleCount,
  isOpenClawAttachmentAssertionUriForContextGraph,
  extractionRecordMatchesOpenClawAttachmentRef,
  verifyOpenClawAttachmentRefsProvenance,
} from './openclaw.js';
import {
  type LocalAgentIntegrationDefinition,
  type LocalAgentIntegrationRecord,
  LOCAL_AGENT_INTEGRATION_DEFINITIONS,
  isPlainRecord,
  normalizeIntegrationId,
  normalizeLocalAgentTransport,
  normalizeLocalAgentCapabilities,
  normalizeLocalAgentManifest,
  normalizeLocalAgentRuntime,
  isLocalAgentExplicitlyUserDisabled,
  isExplicitLocalAgentDisconnectPatch,
  normalizeExplicitLocalAgentDisconnectBody,
  mergeLocalAgentIntegrationConfig,
  getStoredLocalAgentIntegrations,
  computeLocalAgentIntegrationStatus,
  buildLocalAgentIntegrationRecord,
  listLocalAgentIntegrations,
  getLocalAgentIntegration,
  pruneLegacyOpenClawConfig,
  extractLocalAgentIntegrationPatch,
  connectLocalAgentIntegration,
  updateLocalAgentIntegration,
  hasConfiguredLocalAgentChat,
  hasStoredLocalAgentTransportConfig,
  connectLocalAgentIntegrationFromUi,
  type ReverseLocalAgentSetupDeps,
  reverseLocalAgentSetupForUi,
  refreshLocalAgentIntegrationFromUi,
} from './local-agents.js';


const DEBUG_SYNC_TRACE = process.env.DKG_DEBUG_SYNC_PROGRESS === '1' || process.env.DKG_DEBUG_SYNC === '1';

export function resolveAutoUpdateEnabled(config: DkgConfig): boolean {
  if (daemonState.standaloneCache === null) daemonState.standaloneCache = isStandaloneInstall();
  return daemonState.standaloneCache
    ? config.autoUpdate?.enabled !== false
    : (config.autoUpdate?.enabled ?? false);
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  agent: DKGAgent,
  publisherControl: ReturnType<typeof createPublisherControlFromStore>,
  config: DkgConfig,
  startedAt: number,
  dashDb: DashboardDB,
  opWallets: import("@origintrail-official/dkg-agent").OpWalletsConfig,
  network: Awaited<ReturnType<typeof loadNetworkConfig>>,
  tracker: OperationTracker,
  memoryManager: ChatMemoryManager,
  bridgeAuthToken: string | undefined,
  nodeVersion: string,
  nodeCommit: string,
  catchupTracker: CatchupTracker,
  extractionRegistry: ExtractionPipelineRegistry,
  fileStore: FileStore,
  extractionStatus: Map<string, ExtractionStatusRecord>,
  assertionImportLocks: Map<string, Promise<void>>,
  vectorStore: VectorStore,
  embeddingProvider: EmbeddingProvider | null,
  validTokens: Set<string>,
  // API socket identity — passed in from the outer daemon closure so
  // `manifestSelfClient()` can build a self-pointing URL from trusted
  // server state instead of request headers (SSRF defence).
  apiHost: string,
  apiPortRef: { value: number },
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;

  // Resolve the requesting agent's address from the Bearer token.
  // Agent tokens (dkg_at_...) resolve to their specific agent; node-level tokens
  // fall back to the default owner agent.
  const requestToken = extractBearerToken(req.headers.authorization);
  const requestAgentAddress = agent.resolveAgentAddress(requestToken);

  // GET /.well-known/skill.md — Agent Skills document (PUBLIC, no auth)
  if (req.method === "GET" && path === "/.well-known/skill.md") {
    const proto = req.headers["x-forwarded-proto"] ?? "http";
    const host =
      req.headers["x-forwarded-host"] ??
      req.headers.host ??
      `localhost:${config.listenPort ?? 9200}`;
    const baseUrl = `${proto}://${host}`;
    // text/markdown is always handled natively by the import-file route
    // (skip Phase 1, run the Phase 2 markdown extractor directly), even when
    // no Phase 1 converter is registered. Surface it in the discovery list so
    // skill-driven clients see Markdown ingestion as supported regardless of
    // converter availability.
    const pipelines = extractionRegistry.availableContentTypes();
    const content = buildSkillMd({
      version: nodeVersion,
      baseUrl,
      peerId: agent.peerId,
      nodeRole: config.nodeRole ?? "edge",
      extractionPipelines: [...new Set(["text/markdown", ...pipelines])],
    });
    const etag = skillEtag(content);
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/markdown; charset=utf-8",
      ETag: etag,
      "Cache-Control": "public, max-age=300",
      Vary: "Host, X-Forwarded-Host, X-Forwarded-Proto",
    });
    res.end(content);
    return;
  }

  // GET /api/status
  if (req.method === "GET" && path === "/api/status") {
    const allConns = agent.node.libp2p.getConnections();
    const directConns = allConns.filter(
      (c) => !c.remoteAddr?.toString().includes("/p2p-circuit"),
    );
    const relayedConns = allConns.length - directConns.length;
    const uniquePeers = new Set(allConns.map((c) => c.remotePeer.toString()));
    const circuitAddrs = agent.multiaddrs.filter((a) =>
      a.includes("/p2p-circuit/"),
    );
    const networkId = await computeNetworkId();
    const chainConf = config.chain ?? network?.chain;
    const blockExplorerUrl =
      config.blockExplorerUrl ?? deriveBlockExplorerUrl(chainConf?.chainId);
    const identityId = agent.publisher.getIdentityId();
    const localAgentIntegrations = listLocalAgentIntegrations(config);
    return jsonResponse(res, 200, {
      name: config.name,
      version: nodeVersion,
      commit: nodeCommit || null,
      peerId: agent.peerId,
      nodeRole: config.nodeRole ?? "edge",
      networkId: networkId.slice(0, 16),
      networkName: network?.networkName ?? null,
      storeBackend: config.store?.backend ?? "oxigraph-worker",
      uptimeMs: Date.now() - startedAt,
      connectedPeers: uniquePeers.size,
      connections: {
        total: allConns.length,
        direct: directConns.length,
        relayed: relayedConns,
      },
      relayConnected: circuitAddrs.length > 0,
      multiaddrs: agent.multiaddrs,
      blockExplorerUrl,
      identityId: String(identityId),
      hasIdentity: identityId > 0n,
      hasOpenClawChannel: hasConfiguredLocalAgentChat(config, 'openclaw'),
      localAgentIntegrations,
      connectedLocalAgentIds: localAgentIntegrations.filter((integration) => integration.enabled).map((integration) => integration.id),
      autoUpdate: resolveAutoUpdateEnabled(config),
      updateAvailable:
        daemonState.lastUpdateCheck.checkedAt > 0 ? !daemonState.lastUpdateCheck.upToDate : null,
      latestCommit: daemonState.lastUpdateCheck.latestCommit || null,
      latestVersion: daemonState.lastUpdateCheck.latestVersion || null,
    });
  }

  // GET /api/info — lightweight DevOps health check (authenticated)
  if (req.method === "GET" && path === "/api/info") {
    const allConns = agent.node.libp2p.getConnections();
    const uniquePeers = new Set(allConns.map((c) => c.remotePeer.toString()));
    const chainConf = config.chain ?? network?.chain;
    const now = Date.now();

    return jsonResponse(res, 200, {
      status: "running",
      version: getNodeVersion(),
      name: config.name,
      peerId: agent.peerId,
      nodeRole: config.nodeRole ?? "edge",
      network: network?.networkName ?? null,
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.floor((now - startedAt) / 1000),
      timestamp: new Date(now).toISOString(),
      chain: chainConf
        ? {
            chainId: chainConf.chainId ?? null,
            rpcUrl: chainConf.rpcUrl,
            hubAddress: chainConf.hubAddress,
          }
        : null,
      peers: uniquePeers.size,
      paranets: resolveContextGraphs(config).length,
      telemetry: config.telemetry?.enabled ?? false,
      autoUpdate: resolveAutoUpdateEnabled(config),
      auth: config.auth?.enabled !== false,
    });
  }

  // GET /api/connections — detailed per-connection info with transport type
  if (req.method === "GET" && path === "/api/connections") {
    const allConns = agent.node.libp2p.getConnections();
    const connections = allConns.map((c) => {
      const addr = c.remoteAddr?.toString() ?? "unknown";
      return {
        peerId: c.remotePeer.toString(),
        remoteAddr: addr,
        transport: addr.includes("/p2p-circuit") ? "relayed" : "direct",
        direction: c.direction,
        openedAt: c.timeline?.open ?? null,
        durationMs: c.timeline?.open ? Date.now() - c.timeline.open : null,
      };
    });
    const direct = connections.filter((c) => c.transport === "direct").length;
    return jsonResponse(res, 200, {
      total: connections.length,
      direct,
      relayed: connections.length - direct,
      connections,
    });
  }

  // POST /api/agent/register — register a new agent on this node
  if (req.method === "POST" && path === "/api/agent/register") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const parsed = JSON.parse(body);
    const { name, publicKey, framework } = parsed;
    if (!name || typeof name !== "string") {
      return jsonResponse(res, 400, { error: 'Missing required field "name"' });
    }
    try {
      const record = await agent.registerAgent(name, { publicKey, framework });
      validTokens.add(record.authToken);
      const response: Record<string, unknown> = {
        agentAddress: record.agentAddress,
        authToken: record.authToken,
        mode: record.mode,
      };
      if (record.mode === "custodial") {
        response.publicKey = record.publicKey;
        response.privateKey = record.privateKey;
      }
      return jsonResponse(res, 200, response);
    } catch (err: any) {
      return jsonResponse(res, 400, { error: err.message });
    }
  }

  // GET /api/agent/identity — current agent identity for the requesting token
  if (req.method === "GET" && path === "/api/agent/identity") {
    const token = extractBearerToken(req.headers.authorization);
    const agentAddress = agent.resolveAgentAddress(token);
    const localAgents = agent.listLocalAgents();
    const current = localAgents.find((a) => a.agentAddress === agentAddress);
    return jsonResponse(res, 200, {
      agentAddress,
      agentDid: `did:dkg:agent:${agentAddress}`,
      name: current?.name ?? agent.nodeName,
      framework: current?.framework ?? agent.nodeFramework,
      peerId: agent.peerId,
      nodeIdentityId: String(agent.publisher.getIdentityId()),
    });
  }

  // GET /api/agents — enriched with live connection health
  // Optional query params: ?framework=X &skill_type=X
  if (req.method === "GET" && path === "/api/agents") {
    const frameworkFilter = url.searchParams.get("framework") || undefined;
    const skillTypeFilter = url.searchParams.get("skill_type") || undefined;
    const agents = await agent.findAgents({
      ...(frameworkFilter ? { framework: frameworkFilter } : {}),
    });
    // If skill_type filter is requested, find agents offering that skill and intersect
    let filteredAgents = agents;
    if (skillTypeFilter) {
      const offerings = await agent.findSkills({ skillType: skillTypeFilter });
      const agentUris = new Set(offerings.map((o: any) => o.agentUri));
      filteredAgents = agents.filter((a: any) => agentUris.has(a.agentUri));
    }
    const allConns = agent.node.libp2p.getConnections();
    const connByPeer = new Map<
      string,
      { transport: string; direction: string; sinceMs: number }
    >();
    for (const c of allConns) {
      const pid = c.remotePeer.toString();
      if (!connByPeer.has(pid)) {
        connByPeer.set(pid, {
          transport: c.remoteAddr?.toString().includes("/p2p-circuit")
            ? "relayed"
            : "direct",
          direction: c.direction,
          sinceMs: c.timeline?.open ? Date.now() - c.timeline.open : 0,
        });
      }
    }
    const myPeerId = agent.peerId;
    const healthMap = agent.getPeerHealth();
    const enriched = filteredAgents.map((a: any) => {
      const isSelf = a.peerId === myPeerId;
      const conn = connByPeer.get(a.peerId);
      const health = healthMap.get(a.peerId);
      return {
        ...a,
        connectionStatus: isSelf ? "self" : conn ? "connected" : "disconnected",
        connectionTransport: conn?.transport ?? null,
        connectionDirection: conn?.direction ?? null,
        connectedSinceMs: conn?.sinceMs ?? null,
        lastSeen: isSelf ? Date.now() : (health?.lastSeen ?? null),
        latencyMs: health?.latencyMs ?? null,
      };
    });
    return jsonResponse(res, 200, { agents: enriched });
  }

  // GET /api/peer-info?peerId=<id>
  if (req.method === "GET" && path === "/api/peer-info") {
    const peerId = url.searchParams.get("peerId");
    if (!peerId) {
      return jsonResponse(res, 400, { error: 'Missing "peerId" query param' });
    }

    const allConns = agent.node.libp2p.getConnections();
    const peerConns = allConns.filter((c) => c.remotePeer.toString() === peerId);
    const protocols = await agent.getPeerProtocols(peerId);

    const health = agent.getPeerHealth().get(peerId);
    return jsonResponse(res, 200, {
      peerId,
      connected: peerConns.length > 0,
      connectionCount: peerConns.length,
      transports: peerConns.map((c) =>
        c.remoteAddr?.toString().includes('/p2p-circuit') ? 'relayed' : 'direct',
      ),
      directions: peerConns.map((c) => c.direction),
      remoteAddrs: peerConns.map((c) => c.remoteAddr?.toString() ?? null),
      protocols,
      syncCapable: protocols.includes('/dkg/10.0.0/sync'),
      lastSeen: health?.lastSeen ?? null,
      latencyMs: health?.latencyMs ?? null,
    });
  }

  // GET /api/skills
  // Optional query params: ?skillType=X
  if (req.method === "GET" && path === "/api/skills") {
    const skillTypeFilter = url.searchParams.get("skillType") || undefined;
    const skills = await agent.findSkills(
      skillTypeFilter ? { skillType: skillTypeFilter } : undefined,
    );
    return jsonResponse(res, 200, { skills });
  }

  // POST /api/invoke-skill  { peerId: "...", skillUri: "...", input: "..." }
  if (req.method === "POST" && path === "/api/invoke-skill") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON body" });
    }
    const rawPeerId = parsed.peerId ? String(parsed.peerId) : "";
    const skillUri = parsed.skillUri ? String(parsed.skillUri) : "";
    const input = parsed.input != null ? String(parsed.input) : "";
    if (!rawPeerId || !skillUri)
      return jsonResponse(res, 400, {
        error: 'Missing "peerId" or "skillUri"',
      });

    // Resolve name → peerId
    const peerId = await resolveNameToPeerId(agent, rawPeerId);
    if (!peerId)
      return jsonResponse(res, 404, {
        error: `Agent "${rawPeerId}" not found`,
      });

    try {
      const inputData = new TextEncoder().encode(input);
      const response = await agent.invokeSkill(peerId, skillUri, inputData);
      return jsonResponse(res, 200, {
        success: response.success,
        output: response.outputData
          ? new TextDecoder().decode(response.outputData)
          : undefined,
        error: response.error,
        executionTimeMs: response.executionTimeMs,
      });
    } catch (err: any) {
      return jsonResponse(res, 502, { error: err.message });
    }
  }

  // POST /api/chat  { to: "name-or-peerId", text: "..." }
  if (req.method === "POST" && path === "/api/chat") {
    const serverT0 = Date.now();
    const body = await readBody(req, SMALL_BODY_BYTES);
    const { to, text } = JSON.parse(body);
    if (!to || !text)
      return jsonResponse(res, 400, { error: 'Missing "to" or "text"' });

    const resolveT0 = Date.now();
    const peerId = await resolveNameToPeerId(agent, to);
    const resolveDur = Date.now() - resolveT0;
    if (!peerId)
      return jsonResponse(res, 404, { error: `Agent "${to}" not found` });

    const sendT0 = Date.now();
    const result = await Promise.race([
      agent.sendChat(peerId, text),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("sendChat timeout (30s)")), 30_000),
      ),
    ]);
    const sendDur = Date.now() - sendT0;
    try {
      dashDb.insertChatMessage({
        ts: Date.now(),
        direction: "out",
        peer: peerId,
        text,
        delivered: result.delivered,
      });
    } catch {
      /* never crash */
    }
    return jsonResponse(res, 200, {
      ...result,
      phases: {
        resolve: resolveDur,
        send: sendDur,
        serverTotal: Date.now() - serverT0,
      },
    });
  }

  // GET /api/messages?peer=<name-or-id>&limit=N
  if (req.method === "GET" && path === "/api/messages") {
    const peerFilter = url.searchParams.get("peer");
    const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const since = parseInt(url.searchParams.get("since") ?? "0", 10);

    let peer: string | undefined;
    if (peerFilter) {
      peer = (await resolveNameToPeerId(agent, peerFilter)) ?? undefined;
    }
    const rows = dashDb.getChatMessages({ peer, since: since || undefined, limit });
    const msgs = rows.map((r: any) => ({
      ts: r.ts,
      direction: r.direction,
      peer: r.peer,
      peerName: r.peer_name ?? undefined,
      text: r.text,
      delivered: r.delivered == null ? undefined : r.delivered === 1,
    }));
    return jsonResponse(res, 200, { messages: msgs });
  }

  // GET /api/openclaw-agents — discover connected OpenClaw agents
  if (req.method === "GET" && path === "/api/openclaw-agents") {
    try {
      const allAgents = await agent.findAgents({ framework: "OpenClaw" });
      const allConns = agent.node.libp2p.getConnections();
      const connectedPeers = new Set(
        allConns.map((c: any) => c.remotePeer.toString()),
      );
      const healthMap = agent.getPeerHealth();

      const enriched = allAgents.map((a: any) => {
        const isConnected = connectedPeers.has(a.peerId);
        const health = healthMap.get(a.peerId);
        return {
          peerId: a.peerId,
          name: a.name,
          description: a.description,
          framework: a.framework,
          connected: isConnected,
          lastSeen: health?.lastSeen ?? null,
          latencyMs: health?.latencyMs ?? null,
        };
      });
      return jsonResponse(res, 200, { agents: enriched });
    } catch (err: any) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // POST /api/chat-openclaw  { peerId: "...", text: "..." }
  // Sends a message to an OpenClaw agent via P2P and waits for a response.
  if (req.method === "POST" && path === "/api/chat-openclaw") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const { peerId: rawPeerId, text } = JSON.parse(body);
    if (!rawPeerId || !text)
      return jsonResponse(res, 400, { error: 'Missing "peerId" or "text"' });

    const peerId = await resolveNameToPeerId(agent, rawPeerId);
    if (!peerId)
      return jsonResponse(res, 404, {
        error: `Agent "${rawPeerId}" not found`,
      });

    const waitStart = Date.now();
    const sendResult = await agent.sendChat(peerId, text);
    try {
      dashDb.insertChatMessage({
        ts: Date.now(),
        direction: "out",
        peer: peerId,
        text,
        delivered: sendResult.delivered,
      });
    } catch {
      /* never crash */
    }

    if (!sendResult.delivered) {
      return jsonResponse(res, 200, {
        delivered: false,
        reply: null,
        timedOut: false,
        error:
          sendResult.error ?? "Message not delivered — agent may be offline",
      });
    }

    // Wait for a reply from the OpenClaw agent (poll incoming messages)
    const TIMEOUT_MS = 30_000;
    const POLL_MS = 500;
    let reply: string | null = null;

    while (Date.now() - waitStart < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        const rows = dashDb.getChatMessages({
          peer: peerId,
          since: waitStart - 100,
          limit: 10,
        });
        const incoming = rows.filter(
          (r: any) =>
            r.direction === "in" && r.ts >= waitStart && r.peer === peerId,
        );
        if (incoming.length > 0) {
          reply = incoming[incoming.length - 1].text;
          break;
        }
      } catch {
        /* ignore */
      }
    }

    return jsonResponse(res, 200, {
      delivered: true,
      reply: reply ?? null,
      timedOut: reply === null,
      waitMs: Date.now() - waitStart,
    });
  }

  // -----------------------------------------------------------------------
  // OpenClaw channel bridge — routes DKG UI messages through OpenClaw agent
  // -----------------------------------------------------------------------

  // POST /api/openclaw-channel/send  { text, correlationId, identity?, attachmentRefs?, contextEntries?, contextGraphId? }
  // DKG Node UI frontend calls this to send a message to the local OpenClaw
  // agent.  The daemon forwards to the adapter's channel bridge server and
  // returns the agent's reply. `contextGraphId` carries the UI-selected
  // project context graph so the adapter's memory slot can scope
  // slot-backed recall to the user's current project.
  if (req.method === "POST" && path === "/api/openclaw-channel/send") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    let payload: {
      text?: string;
      correlationId?: string;
      identity?: string;
      attachmentRefs?: unknown;
      contextEntries?: unknown;
      contextGraphId?: unknown;
    };
    try {
      payload = JSON.parse(body);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON" });
    }

    const normalizedAttachmentRefs = normalizeOpenClawAttachmentRefs(payload.attachmentRefs);
    if (payload.attachmentRefs != null && normalizedAttachmentRefs === undefined) {
      return jsonResponse(res, 400, { error: 'Invalid "attachmentRefs"' });
    }
    const normalizedContextEntries = normalizeOpenClawChatContextEntries(
      payload.contextEntries,
    );
    if (payload.contextEntries != null && normalizedContextEntries === undefined) {
      return jsonResponse(res, 400, { error: 'Invalid "contextEntries"' });
    }
    const uiContextGraphId =
      typeof payload.contextGraphId === "string" && payload.contextGraphId.trim()
        ? payload.contextGraphId.trim()
        : undefined;
    const { text, correlationId, identity } = payload;
    if (!hasOpenClawChatTurnContent(text, normalizedAttachmentRefs)) {
      return jsonResponse(res, 400, { error: 'Missing "text"' });
    }
    const corrId = correlationId ?? crypto.randomUUID();
    const attachmentRefs = await verifyOpenClawAttachmentRefsProvenance(
      agent,
      extractionStatus,
      normalizedAttachmentRefs,
    );
    if (payload.attachmentRefs != null && attachmentRefs === undefined) {
      return jsonResponse(res, 400, { error: 'Invalid "attachmentRefs"' });
    }

    const targets = getOpenClawChannelTargets(config);
    let lastFailure: {
      status?: number;
      details?: string;
      offline?: boolean;
    } | null = null;

    for (const target of targets) {
      const availability = await ensureOpenClawBridgeAvailable(
        target,
        bridgeAuthToken,
      );
      if (!availability.ok) {
        lastFailure = availability;
        continue;
      }

      try {
        const forwardRes = await fetch(target.inboundUrl, {
          method: "POST",
          headers: buildOpenClawChannelHeaders(target, bridgeAuthToken, {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            text,
            correlationId: corrId,
            identity: identity ?? "owner",
            ...(attachmentRefs ? { attachmentRefs } : {}),
            ...(normalizedContextEntries
              ? { contextEntries: normalizedContextEntries }
              : {}),
            ...(uiContextGraphId ? { uiContextGraphId } : {}),
          }),
          signal: AbortSignal.timeout(OPENCLAW_CHANNEL_RESPONSE_TIMEOUT_MS),
        });
        if (!forwardRes.ok) {
          const details = await forwardRes.text().catch(() => "");
          if (shouldTryNextOpenClawTarget(forwardRes.status)) {
            lastFailure = {
              status: forwardRes.status,
              details: details || `${target.name} transport unavailable`,
              offline: forwardRes.status === 503,
            };
            continue;
          }
          return jsonResponse(res, 502, {
            error: "Bridge error",
            code: "BRIDGE_ERROR",
            details,
          });
        }
        if (target.name === "bridge") {
          daemonState.openClawBridgeHealth = { ok: true, ts: Date.now() };
        }
        const reply = await forwardRes.json();
        return jsonResponse(res, 200, reply);
      } catch (err: any) {
        if (err.name === "TimeoutError") {
          return jsonResponse(res, 504, {
            error: "Agent response timeout",
            code: "AGENT_TIMEOUT",
            correlationId: corrId,
          });
        }
        if (target.name === "bridge") {
          daemonState.openClawBridgeHealth = { ok: false, ts: Date.now() };
        }
        lastFailure = { details: err.message, offline: true };
      }
    }

    return jsonResponse(res, lastFailure?.offline ? 503 : 502, {
      error: lastFailure?.offline
        ? "OpenClaw bridge unreachable"
        : "Bridge error",
      code: lastFailure?.offline ? "BRIDGE_OFFLINE" : "BRIDGE_ERROR",
      details: lastFailure?.details,
    });
  }

  // POST /api/openclaw-channel/stream  { text, correlationId, identity?, attachmentRefs? }
  // SSE streaming variant — pipes agent response chunks as they arrive.
  if (req.method === "POST" && path === "/api/openclaw-channel/stream") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    let payload: {
      text?: string;
      correlationId?: string;
      identity?: string;
      attachmentRefs?: unknown;
      contextEntries?: unknown;
      contextGraphId?: unknown;
    };
    try {
      payload = JSON.parse(body);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON" });
    }

    const normalizedAttachmentRefs = normalizeOpenClawAttachmentRefs(payload.attachmentRefs);
    if (payload.attachmentRefs != null && normalizedAttachmentRefs === undefined) {
      return jsonResponse(res, 400, { error: 'Invalid "attachmentRefs"' });
    }
    const normalizedContextEntries = normalizeOpenClawChatContextEntries(
      payload.contextEntries,
    );
    if (payload.contextEntries != null && normalizedContextEntries === undefined) {
      return jsonResponse(res, 400, { error: 'Invalid "contextEntries"' });
    }
    const uiContextGraphId =
      typeof payload.contextGraphId === "string" && payload.contextGraphId.trim()
        ? payload.contextGraphId.trim()
        : undefined;
    const { text, correlationId, identity } = payload;
    if (!hasOpenClawChatTurnContent(text, normalizedAttachmentRefs)) {
      return jsonResponse(res, 400, { error: 'Missing "text"' });
    }
    const corrId = correlationId ?? crypto.randomUUID();
    const attachmentRefs = await verifyOpenClawAttachmentRefsProvenance(agent, extractionStatus, normalizedAttachmentRefs);
    if (payload.attachmentRefs != null && attachmentRefs === undefined) {
      return jsonResponse(res, 400, { error: 'Invalid "attachmentRefs"' });
    }

    const targets = getOpenClawChannelTargets(config);
    let lastFailure: {
      status?: number;
      details?: string;
      offline?: boolean;
    } | null = null;

    for (const target of targets) {
      const availability = await ensureOpenClawBridgeAvailable(
        target,
        bridgeAuthToken,
      );
      if (!availability.ok) {
        lastFailure = availability;
        continue;
      }

      try {
        const transportRes = await fetch(target.streamUrl ?? target.inboundUrl, {
          method: 'POST',
          headers: buildOpenClawChannelHeaders(
            target,
            bridgeAuthToken,
            {
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream',
            },
          ),
          body: JSON.stringify({
            text,
            correlationId: corrId,
            identity: identity ?? "owner",
            ...(attachmentRefs ? { attachmentRefs } : {}),
            ...(normalizedContextEntries
              ? { contextEntries: normalizedContextEntries }
              : {}),
            ...(uiContextGraphId ? { uiContextGraphId } : {}),
          }),
          signal: AbortSignal.timeout(OPENCLAW_CHANNEL_RESPONSE_TIMEOUT_MS),
        });

        if (!transportRes.ok) {
          const details = await transportRes.text().catch(() => "");
          if (shouldTryNextOpenClawTarget(transportRes.status)) {
            lastFailure = {
              status: transportRes.status,
              details: details || `${target.name} transport unavailable`,
              offline: transportRes.status === 503,
            };
            continue;
          }
          return jsonResponse(res, 502, {
            error: "Bridge error",
            code: "BRIDGE_ERROR",
            details,
          });
        }

        if (target.name === "bridge") {
          daemonState.openClawBridgeHealth = { ok: true, ts: Date.now() };
        }

        const contentType = (
          transportRes.headers.get("content-type") ?? ""
        ).toLowerCase();
        if (contentType.includes("text/event-stream") && transportRes.body) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            ...corsHeaders(resolveCorsOrigin(req, daemonState.moduleCorsAllowed)),
          });

          try {
            await pipeOpenClawStream(
              req,
              res,
              (transportRes.body as any).getReader(),
            );
          } catch (err: any) {
            if (!res.writableEnded) {
              res.write(
                `data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`,
              );
            }
          }
          if (!res.writableEnded) res.end();
          return;
        }

        const reply = await transportRes.json();
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...corsHeaders(resolveCorsOrigin(req, daemonState.moduleCorsAllowed)),
        });
        res.write(
          `data: ${JSON.stringify({ type: "final", text: reply.text ?? "", correlationId: reply.correlationId ?? corrId })}\n\n`,
        );
        res.end();
        return;
      } catch (err: any) {
        if (err.name === "TimeoutError") {
          return jsonResponse(res, 504, {
            error: "Agent response timeout",
            code: "AGENT_TIMEOUT",
            correlationId: corrId,
          });
        }
        if (target.name === "bridge") {
          daemonState.openClawBridgeHealth = { ok: false, ts: Date.now() };
        }
        lastFailure = { details: err.message, offline: true };
      }
    }

    return jsonResponse(res, lastFailure?.offline ? 503 : 502, {
      error: lastFailure?.offline
        ? "OpenClaw bridge unreachable"
        : "Bridge error",
      code: lastFailure?.offline ? "BRIDGE_OFFLINE" : "BRIDGE_ERROR",
      details: lastFailure?.details,
    });
  }

  // POST /api/openclaw-channel/persist-turn  { sessionId, userMessage, assistantReply, attachmentRefs?, ... }
  // Called by the adapter to persist an OpenClaw turn into the `'chat-turns'`
  // Working Memory assertion of the `'agent-context'` context graph (the
  // ChatMemoryManager default since the openclaw-dkg-primary-memory retarget).
  // Uses the same ChatMemoryManager pathway as the node-owned local-agent
  // chat flow — chat-turn content never reaches Shared Working Memory in v1.
  if (req.method === 'POST' && path === '/api/openclaw-channel/persist-turn') {
    const body = await readBody(req, SMALL_BODY_BYTES);
    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON" });
    }

    if (!isValidOpenClawPersistTurnPayload(payload)) {
      return jsonResponse(res, 400, {
        error:
          "Missing required fields: sessionId, userMessage, assistantReply",
      });
    }
    const { sessionId, userMessage, assistantReply, turnId, toolCalls, attachmentRefs, persistenceState, failureReason } =
      payload;
    const normalizedToolCalls = Array.isArray(toolCalls)
      ? (toolCalls as Array<{
          name: string;
          args: Record<string, unknown>;
          result: unknown;
        }>)
      : undefined;
    const normalizedAttachmentRefs = normalizeOpenClawAttachmentRefs(attachmentRefs);
    if (attachmentRefs != null && normalizedAttachmentRefs === undefined) {
      return jsonResponse(res, 400, { error: 'Invalid "attachmentRefs"' });
    }
    const verifiedAttachmentRefs = await verifyOpenClawAttachmentRefsProvenance(agent, extractionStatus, normalizedAttachmentRefs);
    if (attachmentRefs != null && verifiedAttachmentRefs === undefined) {
      return jsonResponse(res, 400, { error: 'Invalid "attachmentRefs"' });
    }
    const normalizedTurnId =
      typeof turnId === "string" ? turnId : crypto.randomUUID();
    const normalizedPersistenceState = persistenceState === 'failed' || persistenceState === 'pending'
      ? persistenceState
      : 'stored';
    const normalizedFailureReason = typeof failureReason === 'string'
      ? failureReason.trim() || undefined
      : undefined;
    try {
      await memoryManager.storeChatExchange(
        sessionId,
        userMessage,
        assistantReply,
        normalizedToolCalls,
        {
          turnId: normalizedTurnId,
          attachmentRefs: verifiedAttachmentRefs,
          persistenceState: normalizedPersistenceState,
          failureReason: normalizedFailureReason,
        },
      );
      return jsonResponse(res, 200, { ok: true });
    } catch (err: any) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // GET /api/openclaw-channel/health — check if the channel bridge is reachable
  if (req.method === 'GET' && path === '/api/openclaw-channel/health') {
    return jsonResponse(res, 200, await probeOpenClawChannelHealth(config, bridgeAuthToken));
  }

  // POST /api/connect  { multiaddr: "..." }
  if (req.method === "POST" && path === "/api/connect") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const { multiaddr: addr } = JSON.parse(body);
    if (!addr) return jsonResponse(res, 400, { error: 'Missing "multiaddr"' });
    try {
      await agent.connectTo(addr);
    } catch (err: any) {
      return jsonResponse(res, 400, {
        error: err.message ?? "Failed to connect",
      });
    }
    return jsonResponse(res, 200, { connected: true });
  }

  // POST /api/update  { kcId: "...", contextGraphId|paranetId: "...", quads: [...], privateQuads?: [...] }
  if (req.method === "POST" && path === "/api/update") {
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    const { kcId, quads, privateQuads } = parsed;
    const paranetId = parsed.contextGraphId ?? parsed.paranetId;
    if (!kcId || !paranetId || !quads?.length) {
      return jsonResponse(res, 400, {
        error: 'Missing "kcId", "contextGraphId" (or "paranetId"), or "quads"',
      });
    }
    let kcIdBigInt: bigint;
    try {
      kcIdBigInt = BigInt(kcId);
    } catch {
      return jsonResponse(res, 400, {
        error: `Invalid "kcId": ${String(kcId).slice(0, 50)}`,
      });
    }
    const ctx = createOperationContext("update");
    tracker.start(ctx, {
      contextGraphId: paranetId,
      details: { kcId: String(kcId), tripleCount: quads.length, source: "api" },
    });
    try {
      const result = await agent.update(
        kcIdBigInt,
        paranetId,
        quads,
        privateQuads,
        {
          operationCtx: ctx,
          onPhase: tracker.phaseCallback(ctx),
        },
      );
      const chain = result.onChainResult;
      if (chain) {
        tracker.setCost(ctx, {
          gasUsed: chain.gasUsed,
          gasPrice: chain.effectiveGasPrice,
          gasCost: chain.gasCostWei,
          tracCost: chain.tokenAmount,
        });
        const chainId = (config.chain ?? network?.chain)?.chainId;
        tracker.setTxHash(
          ctx,
          chain.txHash,
          chainId ? Number(chainId) : undefined,
        );
      }
      if (result.status === "failed") {
        tracker.fail(ctx, new Error(`Update failed on-chain (kcId=${kcId})`));
      } else {
        tracker.complete(ctx, {
          tripleCount: quads.length,
          details: { kcId: String(result.kcId), status: result.status },
        });
      }
      const opDetail = dashDb.getOperation(ctx.operationId);
      return jsonResponse(res, 200, {
        kcId: String(result.kcId),
        status: result.status,
        kas: result.kaManifest.map((ka) => ({
          tokenId: String(ka.tokenId),
          rootEntity: ka.rootEntity,
        })),
        ...(chain && { txHash: chain.txHash, blockNumber: chain.blockNumber }),
        phases: opDetail.phases,
      });
    } catch (err) {
      tracker.fail(ctx, err);
      throw err;
    }
  }

  // POST /api/shared-memory/write (V10) or /api/workspace/write (legacy)
  if (
    req.method === "POST" &&
    (path === "/api/shared-memory/write" || path === "/api/workspace/write")
  ) {
    const body = await readBody(req);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;
    const { quads, subGraphName } = parsed;
    const localOnly = parsed.localOnly === true;
    if (
      parsed.localOnly !== undefined &&
      typeof parsed.localOnly !== "boolean"
    ) {
      return jsonResponse(res, 400, { error: '"localOnly" must be a boolean' });
    }
    const paranetId = parsed.contextGraphId ?? parsed.paranetId;
    if (!paranetId || !quads?.length) {
      return jsonResponse(res, 400, {
        error: 'Missing "contextGraphId" (or "paranetId") or "quads"',
      });
    }
    if (!validateOptionalSubGraphName(subGraphName, res)) return;
    const ctx = createOperationContext("share");
    tracker.start(ctx, {
      contextGraphId: paranetId,
      details: { tripleCount: quads.length, source: "api", subGraphName },
    });
    try {
      await tracker.trackPhase(ctx, "validate", async () => {
        // validation happens inside share
      });
      const result = await tracker.trackPhase(ctx, "store", () =>
        agent.share(paranetId, quads, {
          subGraphName,
          localOnly,
          operationCtx: ctx,
        }),
      );
      tracker.complete(ctx, { tripleCount: quads.length });
      return jsonResponse(res, 200, {
        shareOperationId: result?.shareOperationId,
        workspaceOperationId: result?.shareOperationId,
        contextGraphId: paranetId,
        paranetId,
        graph: contextGraphSharedMemoryUri(paranetId, subGraphName),
        triplesWritten: quads.length,
      });
    } catch (err: any) {
      tracker.fail(ctx, err);
      if (
        typeof err?.message === "string" &&
        err.message.includes("has not been registered")
      ) {
        return jsonResponse(res, 400, { error: err.message });
      }
      throw err;
    }
  }

  // POST /api/shared-memory/publish (V10) or /api/workspace/enshrine (legacy)
  if (
    req.method === "POST" &&
    (path === "/api/shared-memory/publish" ||
      path === "/api/workspace/enshrine")
  ) {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;
    const { selection, clearAfter, publishContextGraphId, subGraphName } =
      parsed;
    const paranetId = parsed.contextGraphId ?? parsed.paranetId;
    if (!paranetId)
      return jsonResponse(res, 400, {
        error: 'Missing "contextGraphId" (or "paranetId")',
      });
    if (!validateOptionalSubGraphName(subGraphName, res)) return;
    if (subGraphName && publishContextGraphId) {
      return jsonResponse(res, 400, {
        error:
          '"subGraphName" and "publishContextGraphId" cannot be used together',
      });
    }
    const ctx = createOperationContext("publishFromSWM");
    tracker.start(ctx, {
      contextGraphId: paranetId,
      details: { source: "api", publishContextGraphId, subGraphName },
    });
    try {
      const sel: "all" | { rootEntities: string[] } = Array.isArray(selection)
        ? { rootEntities: selection }
        : selection || "all";
      let resolvedPublishContextGraphId: string | null = null;
      if (publishContextGraphId != null) {
        resolvedPublishContextGraphId = String(publishContextGraphId);
      } else if (!subGraphName) {
        const onChainId = await agent.getContextGraphOnChainId(paranetId);
        if (onChainId && /^\d+$/.test(onChainId)) {
          resolvedPublishContextGraphId = onChainId;
        }
      }
      const result = await tracker.trackPhase(ctx, "read-shared-memory", () =>
        agent.publishFromSharedMemory(paranetId, sel, {
          clearSharedMemoryAfter: clearAfter ?? true,
          operationCtx: ctx,
          subGraphName,
          ...(resolvedPublishContextGraphId != null
            ? { contextGraphId: resolvedPublishContextGraphId }
            : {}),
        }),
      );
      const chain = result.onChainResult;
      if (chain) {
        tracker.setCost(ctx, {
          gasUsed: chain.gasUsed,
          gasPrice: chain.effectiveGasPrice,
        });
        const chainId = (config.chain ?? network?.chain)?.chainId;
        tracker.setTxHash(
          ctx,
          chain.txHash,
          chainId ? Number(chainId) : undefined,
        );
      }
      tracker.complete(ctx, { tripleCount: result.kaManifest?.length ?? 0 });
      const httpStatus = result.contextGraphError ? 207 : 200;
      return jsonResponse(res, httpStatus, {
        kcId: String(result.kcId),
        status: result.status,
        kas: result.kaManifest.map((ka: any) => ({ tokenId: String(ka.tokenId), rootEntity: ka.rootEntity })),
        ...(chain && { txHash: chain.txHash, blockNumber: chain.blockNumber }),
        ...(resolvedPublishContextGraphId != null
          ? { publishContextGraphId: String(resolvedPublishContextGraphId) }
          : {}),
        ...(result.contextGraphError
          ? { contextGraphError: result.contextGraphError }
          : {}),
      });
    } catch (err) {
      tracker.fail(ctx, err);
      throw err;
    }
  }

  // POST /api/publisher/enqueue
  // Accepts both the old wrapped shape { request: LiftRequest } and the new flat shape.
  if (req.method === "POST" && path === "/api/publisher/enqueue") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    let raw: any;
    try {
      raw = JSON.parse(body);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON body" });
    }
    const parsed =
      raw.request && typeof raw.request === "object" ? raw.request : raw;
    const { roots, namespace, scope, authorityProofRef, priorVersion } = parsed;
    const contextGraphId = parsed.contextGraphId ?? parsed.paranetId;
    const shareOperationId =
      parsed.shareOperationId ?? parsed.workspaceOperationId;
    const swmId = parsed.swmId ?? parsed.workspaceId ?? "swm-main";
    const transitionType = parsed.transitionType ?? "CREATE";
    const authorityType =
      parsed.authorityType ?? parsed.authority?.type ?? "owner";
    const proofRef = authorityProofRef ?? parsed.authority?.proofRef;
    if (
      !contextGraphId ||
      !shareOperationId ||
      !Array.isArray(roots) ||
      roots.length === 0 ||
      !namespace ||
      !scope ||
      !proofRef
    ) {
      return jsonResponse(res, 400, {
        error: "Missing required enqueue fields",
      });
    }
    const jobId = await publisherControl.lift({
      swmId,
      shareOperationId,
      roots,
      contextGraphId,
      namespace,
      scope,
      transitionType,
      authority: { type: authorityType, proofRef },
      ...(priorVersion ? { priorVersion } : {}),
    } as any);
    return jsonResponse(res, 200, {
      jobId,
      contextGraphId,
      shareOperationId,
      rootsCount: roots.length,
    });
  }

  // GET /api/publisher/jobs?status=...
  if (req.method === "GET" && path === "/api/publisher/jobs") {
    const status =
      typeof url.searchParams.get("status") === "string"
        ? url.searchParams.get("status")!
        : undefined;
    const jobs = await publisherControl.list(
      status ? { status: status as any } : undefined,
    );
    return jsonResponse(res, 200, { jobs });
  }

  // GET /api/publisher/job?id=...  (new route, wrapped response)
  if (req.method === "GET" && path === "/api/publisher/job") {
    const jobId = url.searchParams.get("id");
    if (!jobId) return jsonResponse(res, 400, { error: "Missing job id" });
    const job = await publisherControl.getStatus(jobId);
    if (!job)
      return jsonResponse(res, 404, {
        error: `Publisher job not found: ${jobId}`,
      });
    return jsonResponse(res, 200, { job });
  }

  // GET /api/publisher/job-payload?id=...  (new route, wrapped response)
  if (req.method === "GET" && path === "/api/publisher/job-payload") {
    const jobId = url.searchParams.get("id");
    if (!jobId) return jsonResponse(res, 400, { error: "Missing job id" });
    const job = await publisherControl.getStatus(jobId);
    if (!job)
      return jsonResponse(res, 404, {
        error: `Publisher job not found: ${jobId}`,
      });
    const payload = await publisherControl.inspectPreparedPayload(jobId);
    return jsonResponse(res, 200, { job, payload });
  }

  // Legacy: GET /api/publisher/jobs/:id and /api/publisher/jobs/:id/payload (bare response)
  if (req.method === "GET" && path.startsWith("/api/publisher/jobs/")) {
    const segments = path.slice("/api/publisher/jobs/".length).split("/");
    const jobId = segments[0];
    if (!jobId) return jsonResponse(res, 400, { error: "Missing job id" });
    const job = await publisherControl.getStatus(jobId);
    if (!job)
      return jsonResponse(res, 404, {
        error: `Publisher job not found: ${jobId}`,
      });
    if (segments[1] === "payload") {
      const payload = await publisherControl.inspectPreparedPayload(jobId);
      return jsonResponse(res, 200, { ...job, payload });
    }
    return jsonResponse(res, 200, job);
  }

  // GET /api/publisher/stats — returns the raw status map directly for backward compat
  if (req.method === "GET" && path === "/api/publisher/stats") {
    const stats = await publisherControl.getStats();
    return jsonResponse(res, 200, stats);
  }

  // POST /api/publisher/cancel
  if (req.method === "POST" && path === "/api/publisher/cancel") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON body" });
    }
    const { jobId } = parsed;
    if (!jobId) return jsonResponse(res, 400, { error: "Missing jobId" });
    await publisherControl.cancel(jobId);
    return jsonResponse(res, 200, { cancelled: jobId });
  }

  // POST /api/publisher/retry
  if (req.method === "POST" && path === "/api/publisher/retry") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    let retryParsed: any;
    try {
      retryParsed = JSON.parse(body || "{}");
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON body" });
    }
    const { status } = retryParsed;
    if (status && status !== "failed")
      return jsonResponse(res, 400, {
        error: "Only status=failed is supported",
      });
    const count = await publisherControl.retry({ status: "failed" });
    return jsonResponse(res, 200, { retried: count });
  }

  // POST /api/publisher/clear
  if (req.method === "POST" && path === "/api/publisher/clear") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    let clearParsed: any;
    try {
      clearParsed = JSON.parse(body || "{}");
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON body" });
    }
    const { status } = clearParsed;
    if (status !== "failed" && status !== "finalized") {
      return jsonResponse(res, 400, {
        error: "status must be failed or finalized",
      });
    }
    const count = await publisherControl.clear(status);
    return jsonResponse(res, 200, { cleared: count, status });
  }

  // POST /api/context-graph/create — on-chain context graph creation (V10)
  // When the body has `participantIdentityIds` but no local create metadata (`id`/`name`),
  // treat it as the on-chain multisig creation flow. Otherwise, handle it as the
  // free/local context-graph create flow below.
  if (req.method === "POST" && path === "/api/context-graph/create") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const parsed = JSON.parse(body);
    const isLocalCreate = typeof parsed.id === 'string' && typeof parsed.name === 'string';
    if (Array.isArray(parsed.participantIdentityIds) && !isLocalCreate) {
      const { participantIdentityIds } = parsed;
      const isPrivateLocalOnly = parsed.private === true;
      const requiredSignatures = typeof parsed.requiredSignatures === 'number'
        ? parsed.requiredSignatures
        : (isPrivateLocalOnly ? 1 : undefined);
      if (typeof requiredSignatures !== 'number') {
        return jsonResponse(res, 400, { error: 'Missing requiredSignatures (number)' });
      }
      if (!Number.isInteger(requiredSignatures) || requiredSignatures < 1) {
        return jsonResponse(res, 400, {
          error: "requiredSignatures must be a positive integer (>= 1)",
        });
      }
      if (requiredSignatures > participantIdentityIds.length) {
        return jsonResponse(res, 400, {
          error: `requiredSignatures (${requiredSignatures}) cannot exceed participantIdentityIds count (${participantIdentityIds.length})`,
        });
      }
      for (let i = 0; i < participantIdentityIds.length; i++) {
        const id = participantIdentityIds[i];
        if (typeof id === "number") {
          if (
            !Number.isInteger(id) ||
            id <= 0 ||
            id > Number.MAX_SAFE_INTEGER
          ) {
            return jsonResponse(res, 400, {
              error: `participantIdentityIds[${i}] must be a positive safe integer`,
            });
          }
        } else if (typeof id === "string") {
          if (!/^\d+$/.test(id) || id === "0") {
            return jsonResponse(res, 400, {
              error: `participantIdentityIds[${i}] must be a positive decimal integer string`,
            });
          }
        } else {
          return jsonResponse(res, 400, {
            error: `participantIdentityIds[${i}] must be a number or string`,
          });
        }
      }
      try {
        const mappedIds = participantIdentityIds.map((id: number | string) =>
          BigInt(id),
        );
        const uniqueIds: bigint[] = Array.from(new Set(mappedIds));
        const sortedUniqueIds = uniqueIds.sort((a, b) =>
          a < b ? -1 : a > b ? 1 : 0,
        );
        if (requiredSignatures > sortedUniqueIds.length) {
          return jsonResponse(res, 400, {
            error: `requiredSignatures (${requiredSignatures}) exceeds unique participant count (${sortedUniqueIds.length}) after deduplication`,
          });
        }
        const result = await agent.registerContextGraphOnChain({
          participantIdentityIds: sortedUniqueIds,
          requiredSignatures,
        });
        return jsonResponse(res, 200, {
          contextGraphId: String(result.contextGraphId),
          success: true,
        });
      } catch (err: any) {
        return jsonResponse(res, 500, { error: err.message });
      }
    }
    // Body has `id` + `name` → context-graph-style context graph definition create (handled below)
    const { id, name, description, allowedAgents, allowedPeers, publishPolicy, accessPolicy, register } = parsed;
    if (!id || !name)
      return jsonResponse(res, 400, { error: 'Missing "id" or "name"' });
    if (!isValidContextGraphId(id))
      return jsonResponse(res, 400, { error: "Invalid context graph id" });
    try {
      await agent.createContextGraph({
        id,
        name,
        description,
        allowedAgents: Array.isArray(allowedAgents) ? allowedAgents : undefined,
        allowedPeers: Array.isArray(allowedPeers) ? allowedPeers : undefined,
        accessPolicy: typeof accessPolicy === 'number' ? accessPolicy : undefined,
        callerAgentAddress: requestAgentAddress,
        ...(parsed.private === true ? { private: true } : {}),
        ...(Array.isArray(parsed.participantIdentityIds)
          ? { participantIdentityIds: parsed.participantIdentityIds.map((v: string | number) => BigInt(v)) }
          : {}),
        ...(typeof parsed.requiredSignatures === 'number' ? { requiredSignatures: parsed.requiredSignatures } : {}),
      });
    } catch (err: any) {
      const msg = err?.message ?? "";
      if (
        msg.includes("already exists") ||
        msg.includes("duplicate") ||
        msg.includes("conflict")
      ) {
        return jsonResponse(res, 409, { error: msg });
      }
      throw err;
    }
    // Registration is opt-in: callers that want on-chain registration
    // pass `register: true`. Otherwise CG stays local-only and can be
    // registered later via POST /api/context-graph/register.
    if (register === true) {
      try {
        const regResult = await agent.registerContextGraph(id, { callerAgentAddress: requestAgentAddress });
        return jsonResponse(res, 200, {
          created: id,
          uri: `did:dkg:context-graph:${id}`,
          registered: true,
          onChainId: regResult.onChainId,
        });
      } catch (regErr: any) {
        process.stderr.write(`[DKG-Daemon] WARN: Context graph "${id}" created locally but on-chain registration failed: ${regErr?.message ?? 'unknown error'}\n`);
        return jsonResponse(res, 200, {
          created: id,
          uri: `did:dkg:context-graph:${id}`,
          registered: false,
          registerError: regErr?.message ?? 'Registration failed',
          hint: 'CG created locally. Use POST /api/context-graph/register to retry on-chain registration.',
        });
      }
    }
    return jsonResponse(res, 200, { created: id, uri: `did:dkg:context-graph:${id}` });
  }

  // POST /api/context-graph/register — on-chain registration (upgrade from free CG)
  if (req.method === 'POST' && path === '/api/context-graph/register') {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;
    const { id, revealOnChain, accessPolicy } = parsed;
    if (!id) return jsonResponse(res, 400, { error: 'Missing "id"' });
    if (typeof id !== 'string') return jsonResponse(res, 400, { error: '"id" must be a string' });
    if (!isValidContextGraphId(id)) return jsonResponse(res, 400, { error: 'Invalid context graph id' });
    if (revealOnChain !== undefined && typeof revealOnChain !== 'boolean') {
      return jsonResponse(res, 400, { error: '"revealOnChain" must be a boolean' });
    }
    if (accessPolicy !== undefined && (accessPolicy !== 0 && accessPolicy !== 1)) {
      return jsonResponse(res, 400, { error: '"accessPolicy" must be 0 (open) or 1 (private)' });
    }
    try {
      const result = await agent.registerContextGraph(id, { revealOnChain, accessPolicy, callerAgentAddress: requestAgentAddress });
      return jsonResponse(res, 200, {
        registered: id,
        onChainId: result.onChainId,
        ...(result.txHash ? { txHash: result.txHash } : {}),
        hint: 'Context graph registered on-chain. You can now publish SWM to Verified Memory.',
      });
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('already registered')) {
        return jsonResponse(res, 409, { error: msg });
      }
      if (msg.includes('does not exist')) {
        return jsonResponse(res, 404, { error: msg });
      }
      if (msg.includes('no known creator')) {
        return jsonResponse(res, 503, { error: msg, hint: 'Creator not yet synced. Retry after sync completes.' });
      }
      if (msg.includes('Only the context graph creator')) {
        return jsonResponse(res, 403, { error: msg });
      }
      return jsonResponse(res, 500, { error: msg });
    }
  }

  // POST /api/context-graph/invite — invite a peer to a context graph
  if (req.method === 'POST' && path === '/api/context-graph/invite') {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;
    const { contextGraphId, peerId: targetPeerId } = parsed;
    if (!contextGraphId || !targetPeerId) {
      return jsonResponse(res, 400, { error: 'Missing "contextGraphId" or "peerId"' });
    }
    if (!isValidContextGraphId(contextGraphId)) return jsonResponse(res, 400, { error: 'Invalid context graph id' });
    try {
      await agent.inviteToContextGraph(contextGraphId, targetPeerId, requestAgentAddress);
      return jsonResponse(res, 200, { invited: targetPeerId, contextGraphId });
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('does not exist')) {
        return jsonResponse(res, 404, { error: msg });
      }
      if (msg.includes('no known creator')) {
        return jsonResponse(res, 503, { error: msg, hint: 'Creator not yet synced. Retry after sync completes.' });
      }
      if (msg.includes('Only the context graph creator')) {
        return jsonResponse(res, 403, { error: msg });
      }
      if (msg.includes('Invalid peer ID format')) {
        return jsonResponse(res, 400, { error: msg });
      }
      return jsonResponse(res, 500, { error: msg });
    }
  }

  // POST /api/sub-graph/create  { contextGraphId, subGraphName }
  if (req.method === "POST" && path === "/api/sub-graph/create") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;
    const { contextGraphId, subGraphName } = parsed;
    if (!subGraphName)
      return jsonResponse(res, 400, { error: 'Missing "subGraphName"' });
    if (!validateRequiredContextGraphId(contextGraphId, res)) return;
    if (typeof subGraphName !== "string")
      return jsonResponse(res, 400, {
        error: '"subGraphName" must be a string',
      });
    const sgVal = validateSubGraphName(subGraphName);
    if (!sgVal.valid)
      return jsonResponse(res, 400, {
        error: `Invalid "subGraphName": ${sgVal.reason}`,
      });
    try {
      await agent.createSubGraph(contextGraphId, subGraphName);
      return jsonResponse(res, 200, { created: subGraphName, contextGraphId });
    } catch (err: any) {
      if (
        err.message?.includes("already exists") ||
        err.message?.includes("not found") ||
        err.message?.includes("Invalid")
      ) {
        return jsonResponse(res, 400, { error: err.message });
      }
      throw err;
    }
  }

  // GET /api/sub-graph/list?contextGraphId=...
  // Returns per-sub-graph metadata + entity/triple counts so UIs can render a
  // SubGraphBar without a second round-trip per sub-graph.
  if (req.method === "GET" && path === "/api/sub-graph/list") {
    const qs = new URL(req.url ?? "", "http://localhost").searchParams;
    const contextGraphId = qs.get("contextGraphId");
    if (!validateRequiredContextGraphId(contextGraphId, res)) return;
    try {
      const registered = await agent.listSubGraphs(contextGraphId!);
      // One pass enumerates *all* named graphs in the project + their
      // distinct-subject and triple counts. Sub-graph ownership is inferred
      // from the named-graph path segment after the context-graph id:
      //   did:dkg:context-graph:<cg>/<subGraph>/assertion/<author>/<name>
      //   did:dkg:context-graph:<cg>/<subGraph>   (committed sub-graph view)
      // This is one SPARQL round-trip regardless of how many sub-graphs exist.
      const counts = new Map<string, { entityCount: number; tripleCount: number }>();
      try {
        const sparql = `
          SELECT ?g (COUNT(DISTINCT ?s) AS ?entities) (COUNT(*) AS ?triples)
          WHERE { GRAPH ?g { ?s ?p ?o } }
          GROUP BY ?g
        `;
        const result = await agent.query(sparql, { contextGraphId: contextGraphId! });
        const prefix = `did:dkg:context-graph:${contextGraphId}/`;
        const parseCount = (v: any) => {
          if (v === undefined || v === null) return 0;
          const s = typeof v === 'string' ? v : (v && typeof v === 'object' && 'value' in v ? (v as any).value : '');
          const m = String(s).match(/^"?(\d+)/);
          return m ? Number(m[1]) : 0;
        };
        for (const row of (result?.bindings ?? []) as Array<Record<string, any>>) {
          const g = typeof row.g === 'string' ? row.g : (row.g && typeof row.g === 'object' && 'value' in row.g ? row.g.value : undefined);
          if (!g || !g.startsWith(prefix)) continue;
          const tail = g.slice(prefix.length);
          // tail starts with either "<subGraphName>/..." or "_meta" or "_shared_memory".
          // Only care about the first segment, but skip daemon-internal graphs.
          const firstSlash = tail.indexOf('/');
          const seg = firstSlash >= 0 ? tail.slice(0, firstSlash) : tail;
          if (!seg || seg.startsWith('_')) continue;
          const entry = counts.get(seg) ?? { entityCount: 0, tripleCount: 0 };
          entry.entityCount += parseCount(row.entities);
          entry.tripleCount += parseCount(row.triples);
          counts.set(seg, entry);
        }
      } catch {
        // Counts are best-effort — UI degrades to zeros on query failure.
      }
      const items = registered.map((sg) => ({
        name: sg.name,
        uri: sg.uri,
        description: sg.description,
        createdBy: sg.createdBy,
        createdAt: sg.createdAt,
        entityCount: counts.get(sg.name)?.entityCount ?? 0,
        tripleCount: counts.get(sg.name)?.tripleCount ?? 0,
      }));
      return jsonResponse(res, 200, { contextGraphId, subGraphs: items });
    } catch (err: any) {
      if (err.message?.includes("not found") || err.message?.includes("Invalid")) {
        return jsonResponse(res, 400, { error: err.message });
      }
      throw err;
    }
  }

  // POST /api/assertion/create  { contextGraphId, name, subGraphName? }
  if (req.method === "POST" && path === "/api/assertion/create") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;
    const { contextGraphId, name, subGraphName } = parsed;
    if (!name) return jsonResponse(res, 400, { error: 'Missing "name"' });
    if (!validateRequiredContextGraphId(contextGraphId, res)) return;
    if (typeof name !== "string")
      return jsonResponse(res, 400, { error: '"name" must be a string' });
    const nameVal = validateAssertionName(name);
    if (!nameVal.valid)
      return jsonResponse(res, 400, {
        error: `Invalid "name": ${nameVal.reason}`,
      });
    if (!validateOptionalSubGraphName(subGraphName, res)) return;
    try {
      const assertionUri = await agent.assertion.create(
        contextGraphId,
        name,
        subGraphName ? { subGraphName } : undefined,
      );
      return jsonResponse(res, 200, { assertionUri });
    } catch (err: any) {
      if (
        err.message?.includes("already exists") ||
        err.message?.includes("not found") ||
        err.message?.includes("Invalid")
      ) {
        return jsonResponse(res, 400, { error: err.message });
      }
      throw err;
    }
  }

  // POST /api/assertion/:name/write  { contextGraphId, quads, subGraphName? }
  if (
    req.method === "POST" &&
    path.startsWith("/api/assertion/") &&
    path.endsWith("/write")
  ) {
    const assertionName = safeDecodeURIComponent(
      path.slice("/api/assertion/".length, -"/write".length),
      res,
    );
    if (assertionName === null) return;
    const nameVal = validateAssertionName(assertionName);
    if (!nameVal.valid)
      return jsonResponse(res, 400, {
        error: `Invalid assertion name: ${nameVal.reason}`,
      });
    const body = await readBody(req);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;
    const { contextGraphId, quads, subGraphName } = parsed;
    if (!quads?.length)
      return jsonResponse(res, 400, { error: 'Missing "quads"' });
    if (!validateRequiredContextGraphId(contextGraphId, res)) return;
    if (!validateOptionalSubGraphName(subGraphName, res)) return;
    try {
      await agent.assertion.write(
        contextGraphId,
        assertionName,
        quads,
        subGraphName ? { subGraphName } : undefined,
      );
      return jsonResponse(res, 200, { written: quads.length });
    } catch (err: any) {
      if (
        err.message?.includes("not found") ||
        err.message?.includes("Invalid") ||
        err.message?.includes("Unsafe") ||
        // Round 9 Bug 25: reserved-namespace writes surface as 400.
        err.name === "ReservedNamespaceError" ||
        err.message?.includes("reserved namespace")
      ) {
        return jsonResponse(res, 400, { error: err.message });
      }
      throw err;
    }
  }

  // POST /api/assertion/:name/query  { contextGraphId, subGraphName? }
  if (
    req.method === "POST" &&
    path.startsWith("/api/assertion/") &&
    path.endsWith("/query")
  ) {
    const assertionName = safeDecodeURIComponent(
      path.slice("/api/assertion/".length, -"/query".length),
      res,
    );
    if (assertionName === null) return;
    const nameVal = validateAssertionName(assertionName);
    if (!nameVal.valid)
      return jsonResponse(res, 400, {
        error: `Invalid assertion name: ${nameVal.reason}`,
      });
    const body = await readBody(req, SMALL_BODY_BYTES);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;
    const { contextGraphId, subGraphName } = parsed;
    if (!validateRequiredContextGraphId(contextGraphId, res)) return;
    if (!validateOptionalSubGraphName(subGraphName, res)) return;
    try {
      const quads = await agent.assertion.query(
        contextGraphId,
        assertionName,
        subGraphName ? { subGraphName } : undefined,
      );
      return jsonResponse(res, 200, { quads, count: quads.length });
    } catch (err: any) {
      if (
        err.message?.includes("not found") ||
        err.message?.includes("Invalid") ||
        err.message?.includes("Unsafe")
      ) {
        return jsonResponse(res, 400, { error: err.message });
      }
      throw err;
    }
  }

  // POST /api/assertion/:name/promote  { contextGraphId, entities?, subGraphName? }
  if (
    req.method === "POST" &&
    path.startsWith("/api/assertion/") &&
    path.endsWith("/promote")
  ) {
    const assertionName = safeDecodeURIComponent(
      path.slice("/api/assertion/".length, -"/promote".length),
      res,
    );
    if (assertionName === null) return;
    const nameVal = validateAssertionName(assertionName);
    if (!nameVal.valid)
      return jsonResponse(res, 400, {
        error: `Invalid assertion name: ${nameVal.reason}`,
      });
    const body = await readBody(req, SMALL_BODY_BYTES);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;
    const { contextGraphId, entities, subGraphName } = parsed;
    if (!validateRequiredContextGraphId(contextGraphId, res)) return;
    if (!validateEntities(entities, res)) return;
    if (!validateOptionalSubGraphName(subGraphName, res)) return;
    try {
      const result = await agent.assertion.promote(
        contextGraphId,
        assertionName,
        { entities: entities ?? "all", subGraphName },
      );
      return jsonResponse(res, 200, result);
    } catch (err: any) {
      if (
        err.message?.includes("not found") ||
        err.message?.includes("Invalid") ||
        err.message?.includes("Unsafe")
      ) {
        return jsonResponse(res, 400, { error: err.message });
      }
      throw err;
    }
  }

  // POST /api/assertion/:name/discard  { contextGraphId, subGraphName? }
  if (
    req.method === "POST" &&
    path.startsWith("/api/assertion/") &&
    path.endsWith("/discard")
  ) {
    const assertionName = safeDecodeURIComponent(
      path.slice("/api/assertion/".length, -"/discard".length),
      res,
    );
    if (assertionName === null) return;
    const nameVal = validateAssertionName(assertionName);
    if (!nameVal.valid)
      return jsonResponse(res, 400, {
        error: `Invalid assertion name: ${nameVal.reason}`,
      });
    const body = await readBody(req, SMALL_BODY_BYTES);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;
    const { contextGraphId, subGraphName } = parsed;
    if (!validateRequiredContextGraphId(contextGraphId, res)) return;
    if (!validateOptionalSubGraphName(subGraphName, res)) return;
    try {
      await agent.assertion.discard(
        contextGraphId,
        assertionName,
        subGraphName ? { subGraphName } : undefined,
      );
      const assertionUri = contextGraphAssertionUri(
        contextGraphId,
        requestAgentAddress,
        assertionName,
        subGraphName,
      );
      extractionStatus.delete(assertionUri);
      return jsonResponse(res, 200, { discarded: true });
    } catch (err: any) {
      if (
        err.message?.includes("not found") ||
        err.message?.includes("Invalid") ||
        err.message?.includes("Unsafe")
      ) {
        return jsonResponse(res, 400, { error: err.message });
      }
      throw err;
    }
  }

  // GET /api/assertion/:name/history?contextGraphId=...&agentAddress=...
  if (
    req.method === "GET" &&
    path.startsWith("/api/assertion/") &&
    path.includes("/history")
  ) {
    const assertionName = safeDecodeURIComponent(
      path.slice("/api/assertion/".length, -"/history".length),
      res,
    );
    if (assertionName === null) return;
    const nameVal = validateAssertionName(assertionName);
    if (!nameVal.valid)
      return jsonResponse(res, 400, {
        error: `Invalid assertion name: ${nameVal.reason}`,
      });
    const qs = new URL(req.url ?? "", "http://localhost").searchParams;
    const contextGraphId = qs.get("contextGraphId");
    if (!validateRequiredContextGraphId(contextGraphId, res)) return;
    const rawAgentAddress = qs.get("agentAddress") ?? undefined;
    if (rawAgentAddress && !/^[\w:.\-]+$/.test(rawAgentAddress)) {
      return jsonResponse(res, 400, { error: "Invalid agentAddress format" });
    }
    const subGraphName = qs.get("subGraphName") ?? undefined;
    try {
      const descriptor = await agent.assertion.history(
        contextGraphId!,
        assertionName,
        { ...(rawAgentAddress ? { agentAddress: rawAgentAddress } : {}), ...(subGraphName ? { subGraphName } : {}) },
      );
      if (!descriptor) {
        return jsonResponse(res, 404, {
          error: `No lifecycle record found for assertion "${assertionName}"`,
        });
      }
      return jsonResponse(res, 200, descriptor);
    } catch (err: any) {
      if (
        err.message?.includes("not found") ||
        err.message?.includes("Invalid") ||
        err.message?.includes("Unsafe")
      ) {
        return jsonResponse(res, 400, { error: err.message });
      }
      throw err;
    }
  }

  // POST /api/assertion/:name/import-file  (multipart/form-data)
  //   file (required):           the uploaded document bytes
  //   contextGraphId (required): target context graph
  //   contentType (optional):    override the file part's Content-Type
  //   ontologyRef (optional):    CG _ontology URI for guided Phase 2 extraction
  //   subGraphName (optional):   target sub-graph inside the CG
  //
  // Orchestration:
  //   1. Parse multipart, store original file in file store → fileHash
  //   2. Resolve detectedContentType (explicit field > multipart content-type)
  //   3. If content type is text/markdown: skip Phase 1, use raw bytes as mdIntermediate
  //      Else if a converter is registered: run Phase 1, store mdIntermediate → mdIntermediateHash
  //      Else: graceful degrade — return extraction.status="skipped", no triples written
  //   4. Run Phase 2 markdown extractor on the mdIntermediate → triples + provenance
  //   5. Write triples + provenance to the assertion graph via agent.assertion.write
  //   6. Record the extraction status in the in-memory Map, return ImportFileResponse
  if (
    req.method === "POST" &&
    path.startsWith("/api/assertion/") &&
    path.endsWith("/import-file")
  ) {
    const assertionName = safeDecodeURIComponent(
      path.slice("/api/assertion/".length, -"/import-file".length),
      res,
    );
    if (assertionName === null) return;
    const nameVal = validateAssertionName(assertionName);
    if (!nameVal.valid)
      return jsonResponse(res, 400, {
        error: `Invalid assertion name: ${nameVal.reason}`,
      });

    const boundary = parseBoundary(req.headers["content-type"]);
    if (!boundary) {
      return jsonResponse(res, 400, {
        error: "Request must be multipart/form-data with a boundary",
      });
    }

    let body: Buffer;
    try {
      body = await readBodyBuffer(req, MAX_UPLOAD_BYTES);
    } catch (err: any) {
      if (err instanceof PayloadTooLargeError) throw err;
      return jsonResponse(res, 400, {
        error: `Failed to read request body: ${err.message}`,
      });
    }

    let fields;
    try {
      fields = parseMultipart(body, boundary);
    } catch (err: any) {
      if (err instanceof MultipartParseError) {
        return jsonResponse(res, 400, {
          error: `Malformed multipart body: ${err.message}`,
        });
      }
      throw err;
    }

    const filePart = fields.find(
      (f) => f.name === "file" && f.filename !== undefined,
    );
    if (!filePart) {
      return jsonResponse(res, 400, {
        error: 'Missing required "file" field in multipart body',
      });
    }
    const textField = (name: string): string | undefined => {
      const f = fields.find((x) => x.name === name && x.filename === undefined);
      return f ? f.content.toString("utf-8") : undefined;
    };
    const contextGraphId = textField("contextGraphId");
    const contentTypeOverrideRaw = textField("contentType");
    // Treat blank (`contentType=` with empty/whitespace value) as absent so we
    // fall through to the file part's own Content-Type header instead of
    // downgrading a real text/markdown / application/pdf upload to
    // application/octet-stream and silently skipping extraction.
    const contentTypeOverride =
      contentTypeOverrideRaw && contentTypeOverrideRaw.trim().length > 0
        ? contentTypeOverrideRaw
        : undefined;
    const ontologyRef = textField("ontologyRef");
    const subGraphName = textField("subGraphName");

    if (!validateRequiredContextGraphId(contextGraphId, res)) return;
    if (!validateOptionalSubGraphName(subGraphName, res)) return;

    const detectedContentType = normalizeDetectedContentType(
      contentTypeOverride ?? filePart.contentType,
    );

    if (subGraphName) {
      try {
        const registeredSubGraphs: Array<{ name: string }> =
          await agent.listSubGraphs(contextGraphId!);
        if (
          !registeredSubGraphs.some(
            (subGraph) => subGraph.name === subGraphName,
          )
        ) {
          return jsonResponse(res, 400, {
            error: unregisteredSubGraphError(contextGraphId!, subGraphName),
          });
        }
      } catch (err: any) {
        return jsonResponse(res, 500, {
          error: `Failed to verify sub-graph registration: ${err.message}`,
        });
      }
    }

    // Persist the original upload to the file store.
    let fileStoreEntry;
    try {
      fileStoreEntry = await fileStore.put(
        filePart.content,
        detectedContentType,
      );
    } catch (err: any) {
      return jsonResponse(res, 500, {
        error: `Failed to store uploaded file: ${err.message}`,
      });
    }

    const assertionUri = contextGraphAssertionUri(
      contextGraphId!,
      requestAgentAddress,
      assertionName,
      subGraphName,
    );
    const startedAt = new Date().toISOString();

    // ── Round 14 Bug 42: per-assertion mutex BEFORE extraction ──
    //
    // Round 6 originally acquired this lock just before the
    // snapshot→insert→rollback critical section, AFTER Phase 1 and
    // Phase 2 extraction had already run. Concurrent imports of the
    // same assertion name then raced during extraction, and the one
    // whose extraction finished LAST committed LAST — regardless of
    // which request arrived first. Final stored state depended on
    // extraction duration (bytes-to-parse, converter latency, PDF
    // complexity), not request order.
    //
    // Option 42A fix: move the lock acquisition here, before any
    // extraction work begins. This serializes the entire import-file
    // handler per assertion name so concurrent imports commit in
    // request order, not in extraction-finish order.
    //
    // Tradeoff: a long-running extraction (large PDF through the
    // MarkItDown converter) now holds the lock and blocks other
    // imports of the SAME assertion name for the duration. In
    // practice, same-name re-imports should be rare (name collision
    // is usually a user mistake, not a workflow), so this is an
    // acceptable tradeoff for correctness. Imports of DIFFERENT
    // assertion names are unaffected — the lock is per-URI, not
    // global. Async extraction (if/when it lands) will need a
    // different locking story, but for V10.0's synchronous
    // extraction this is correct by construction.
    //
    // `releaseLock` is invoked in the outer `finally` block at the
    // bottom of the handler so the next waiter unblocks regardless
    // of success, failure, return, or throw.
    const previousLock =
      assertionImportLocks.get(assertionUri) ?? Promise.resolve();
    let releaseLock: () => void = () => {};
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const chainedLock = previousLock.then(() => currentLock);
    assertionImportLocks.set(assertionUri, chainedLock);
    await previousLock;

    try {
      // ── Phase 1: converter lookup + MD intermediate resolution ──
      // text/markdown is deliberately NOT a registered converter content type.
      // The raw uploaded bytes ARE the Markdown intermediate, so Phase 1 is skipped.
      // For any other content type, look up a converter; if none is registered,
      // gracefully degrade (store the file, skip extraction, return status=skipped).
      let mdIntermediate: string | null = null;
      let pipelineUsed: string | null = null;
      let mdIntermediateHash: string | undefined;
      let importRootEntity: string | undefined;
      const respondWithImportFileResponse = (
        statusCode: number,
        extraction: ImportFileExtractionPayload,
      ) =>
        jsonResponse(
          res,
          statusCode,
          buildImportFileResponse({
            assertionUri,
            fileHash: fileStoreEntry.keccak256,
            rootEntity: importRootEntity,
            detectedContentType,
            extraction,
          }),
        );
      const recordInProgressExtraction = (): void => {
        setExtractionStatusRecord(extractionStatus, assertionUri, {
          status: "in_progress",
          fileHash: fileStoreEntry.keccak256,
          detectedContentType,
          pipelineUsed,
          tripleCount: 0,
          ...(mdIntermediateHash ? { mdIntermediateHash } : {}),
          startedAt,
        });
      };
      const recordFailedExtraction = (
        error: string,
        tripleCount: number,
        failedPipelineUsed: string | null = pipelineUsed,
      ): ExtractionStatusRecord => {
        const failedRecord: ExtractionStatusRecord = {
          status: "failed",
          fileHash: fileStoreEntry.keccak256,
          ...(importRootEntity ? { rootEntity: importRootEntity } : {}),
          detectedContentType,
          pipelineUsed: failedPipelineUsed,
          tripleCount,
          ...(mdIntermediateHash ? { mdIntermediateHash } : {}),
          error,
          startedAt,
          completedAt: new Date().toISOString(),
        };
        setExtractionStatusRecord(extractionStatus, assertionUri, failedRecord);
        return failedRecord;
      };
      const respondWithFailedExtraction = (
        statusCode: number,
        error: string,
        tripleCount: number,
        failedPipelineUsed: string | null = pipelineUsed,
      ) => {
        const failedRecord = recordFailedExtraction(
          error,
          tripleCount,
          failedPipelineUsed,
        );
        return respondWithImportFileResponse(statusCode, {
          status: "failed",
          tripleCount,
          pipelineUsed: failedRecord.pipelineUsed,
          ...(failedRecord.mdIntermediateHash
            ? { mdIntermediateHash: failedRecord.mdIntermediateHash }
            : {}),
          error,
        });
      };

      recordInProgressExtraction();

      if (detectedContentType === "text/markdown") {
        mdIntermediate = filePart.content.toString("utf-8");
        pipelineUsed = "text/markdown";
        recordInProgressExtraction();
      } else {
        const converter = extractionRegistry.get(detectedContentType);
        if (converter) {
          try {
            const { mdIntermediate: md } = await converter.extract({
              filePath: fileStoreEntry.path,
              contentType: detectedContentType,
              ontologyRef,
              agentDid: `did:dkg:agent:${requestAgentAddress}`,
            });
            mdIntermediate = md;
            pipelineUsed = detectedContentType;
            const mdEntry = await fileStore.put(
              Buffer.from(md, "utf-8"),
              "text/markdown",
            );
            mdIntermediateHash = mdEntry.keccak256;
            recordInProgressExtraction();
          } catch (err: any) {
            return respondWithFailedExtraction(
              500,
              `Phase 1 converter failed: ${err.message}`,
              0,
              detectedContentType,
            );
          }
        }
      }

      // ── Graceful degrade: no converter registered and not text/markdown ──
      // Store the file blob, return status=skipped, no triples written.
      if (mdIntermediate === null) {
        const skippedRecord: ExtractionStatusRecord = {
          status: "skipped",
          fileHash: fileStoreEntry.keccak256,
          detectedContentType,
          pipelineUsed: null,
          tripleCount: 0,
          startedAt,
          completedAt: new Date().toISOString(),
        };
        setExtractionStatusRecord(
          extractionStatus,
          assertionUri,
          skippedRecord,
        );
        return respondWithImportFileResponse(200, {
          status: "skipped",
          tripleCount: 0,
          pipelineUsed: null,
        });
      }

      // ── Source-file linkage inputs for §10.1 / §10.2 triples ──
      // fileUri is the content-addressed URN the extractor stamps on the
      // document subject (row 1) and the daemon uses as both the subject of
      // the file descriptor block (rows 4-8) and the object of the extraction
      // provenance resource (row 10). provUri is a fresh UUID per import for
      // the ExtractionProvenance subject (rows 9-13).
      //
      // Cross-assertion promote contention on `<urn:dkg:file:...>` as a
      // root entity is prevented by a subject-prefix filter in
      // `packages/publisher/src/dkg-publisher.ts` `assertionPromote` that
      // excludes both `urn:dkg:file:` and `urn:dkg:extraction:` subjects
      // from the partition before `autoPartition` runs. Row 1 (whose
      // subject is the doc entity, not the file URN) is preserved through
      // promote; rows 4-13 are WM-only by design. See Codex Bug 8 Round 4
      // reconciled ruling — Round 3 tried blank-node subjects, but an
      // `autoPartition` audit showed they silently drop the prov block on
      // promote, which was a correctness smell. See `19_MARKDOWN_CONTENT_TYPE.md
      // §10.2` for the normative rule.
      const fileUri = `urn:dkg:file:${fileStoreEntry.keccak256}`;
      const provUri = `urn:dkg:extraction:${randomUUID()}`;
      const agentDid = `did:dkg:agent:${agent.peerId}`;

      // ── Phase 2: markdown → triples + linkage ──
      let triples;
      let sourceFileLinkage;
      let documentSubjectIri: string;
      let resolvedRootEntity: string;
      try {
        // The extractor owns rows 1 and 3. Row 2 (dkg:sourceContentType) is
        // daemon-owned — it must describe the ORIGINAL upload blob (row 1's
        // target), not the markdown intermediate the extractor processes.
        // Only the daemon has `detectedContentType` here, so it emits row 2
        // itself below alongside the file descriptor block.
        let result = extractFromMarkdown({
          markdown: mdIntermediate,
          agentDid,
          ontologyRef,
          documentIri: assertionUri,
          sourceFileIri: fileUri,
        });
        // Issue #122 interim rule: the import-file path still pins the
        // document subject to the assertion URI. A divergent frontmatter
        // `rootEntity` would require distinct document-vs-root identity
        // plumbing through promote/update paths; until that lands, reject
        // the override explicitly rather than silently rewriting content
        // triples onto a different subject during import.
        if (result.resolvedRootEntity !== assertionUri) {
          importRootEntity = result.resolvedRootEntity;
          const reservedPrefix = findReservedSubjectPrefix(
            result.resolvedRootEntity,
          );
          if (reservedPrefix) {
            return respondWithFailedExtraction(
              400,
              `Frontmatter 'rootEntity' resolves to the reserved namespace '${reservedPrefix}*', which is protocol-reserved for daemon-generated import bookkeeping subjects.`,
              0,
            );
          }
          if (isSkolemizedUri(result.resolvedRootEntity)) {
            return respondWithFailedExtraction(
              400,
              `Frontmatter 'rootEntity' resolves to the skolemized URI '${result.resolvedRootEntity}', but import-file rootEntity must identify a root subject rather than a skolemized child (/.well-known/genid/...).`,
              0,
            );
          }
          return respondWithFailedExtraction(
            400,
            `Frontmatter 'rootEntity' override is not yet supported on the import-file path when it diverges from the imported document subject. Remove the 'rootEntity' key from frontmatter or make it match the document subject; tracking issue #122.`,
            0,
          );
        }
        triples = result.triples;
        // Round 13 Bug 39: `provenance` renamed to `sourceFileLinkage`.
        // The old name conflicted with its original extraction-run
        // metadata semantic, which was moved to daemon-owned rows 9-13
        // (on the `<urn:dkg:extraction:uuid>` subject) in Round 9 Bug 27.
        // The extractor now only emits rows 1 and 3 of the source-file
        // linkage block, so the field's name reflects that directly.
        sourceFileLinkage = result.sourceFileLinkage;
        documentSubjectIri = result.subjectIri;
        // §19.10.1:508 precedence: frontmatter `rootEntity` > explicit input >
        // reflexive subject. The extractor has already applied it to row 3;
        // reuse the resolved value for `_meta` row 14 below so row 3 and row
        // 14 are guaranteed to agree on the same root entity.
        resolvedRootEntity = result.resolvedRootEntity;
        importRootEntity = resolvedRootEntity;
      } catch (err: any) {
        // Bug 13 + Round 7 Bug 20: invalid frontmatter IRIs AND invalid
        // programmatic `rootEntityIri` / `sourceFileIri` inputs both
        // throw from the extractor with a clear message. Surface as a
        // 400 so the user sees it immediately rather than a generic 500.
        const message = err?.message ?? String(err);
        if (
          message.includes("Invalid frontmatter") ||
          message.includes("Invalid 'rootEntityIri'") ||
          message.includes("Invalid 'sourceFileIri'")
        ) {
          return respondWithFailedExtraction(400, message, 0);
        }
        return respondWithFailedExtraction(
          500,
          `Phase 2 extraction failed: ${message}`,
          0,
        );
      }

      // ── Build the full quad set for both graphs (atomic single insert) ──
      // We assemble rows 1-13 as data-graph quads + rows 14-20 as CG root
      // `_meta` quads, each with its own explicit `graph` field, and commit
      // them all in ONE `agent.store.insert(...)` call. Every supported
      // triple-store adapter (oxigraph, blazegraph, sparql-http) implements
      // `insert` as a single N-Quads load / `INSERT DATA` operation, so the
      // call is naturally atomic across graphs: either every row lands or
      // none does. This replaces the earlier two-call flow
      // (`assertion.write` + `store.insert`) which had a window where rows
      // 1-13 could commit and rows 14-20 fail, leaving dangling data.
      //
      // `assertion.create` still runs first to register the assertion graph
      // container (idempotent on "already exists"). The write itself
      // bypasses `assertion.write` so the daemon can set per-quad graph
      // fields directly — `publisher.assertionWrite` hardcodes every quad to
      // the assertion graph URI, which defeats the multi-graph atomicity
      // we need here. Sub-graph registration is already validated by
      // `assertion.create`, so bypassing `assertion.write` doesn't skip any
      // safety checks.
      const assertionGraph = contextGraphAssertionUri(
        contextGraphId!,
        requestAgentAddress,
        assertionName,
        subGraphName,
      );
      const metaGraph = contextGraphMetaUri(contextGraphId!);
      const startedAtLiteral = `"${startedAt}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`;
      const markdownFormUri = mdIntermediateHash
        ? `urn:dkg:file:${mdIntermediateHash}`
        : fileUri;

      // Data-graph quads: content (triples) + extractor linkage (provenance)
      // + daemon-owned rows 2, markdownForm, 4, 5, 8, 9-13. Every quad is pinned to the
      // assertion graph URI. `triples` and `provenance` come from the
      // extractor without a `graph` field, so we stamp each one here.
      //
      // Round 9 Bug 27: rows 6 (`dkg:fileName`) and 7 (`dkg:contentType`)
      // are REMOVED from the file descriptor block. `<fileUri>` is
      // content-addressed — two imports of identical bytes under different
      // filenames / upload content types would have written contradictory
      // facts to the same subject. Per-upload metadata now lives on the
      // assertion UAL in `_meta` (new row 15a: `dkg:sourceFileName`,
      // existing row 15: `dkg:sourceContentType` already there) where
      // per-assertion facts belong. Only intrinsic-to-content properties
      // (rdf:type, dkg:contentHash, dkg:size) remain on `<fileUri>` —
      // those are safe because they're derived purely from the blob bytes.
      // See `19_MARKDOWN_CONTENT_TYPE.md §10.2`.
      const dataGraphQuads = [
        ...triples.map((t) => ({ ...t, graph: assertionGraph })),
        ...sourceFileLinkage.map((t) => ({ ...t, graph: assertionGraph })),
        // Row 2 — daemon-owned. Describes the ORIGINAL upload blob (row 1's
        // target), so for a PDF upload this is "application/pdf" — NOT the
        // markdown intermediate the extractor processes. Extractor never
        // emits this row; the daemon is the single source of truth. Its
        // subject matches rows 1 and 3 on the resolved document entity.
        {
          subject: documentSubjectIri,
          predicate: "http://dkg.io/ontology/sourceContentType",
          object: JSON.stringify(detectedContentType),
          graph: assertionGraph,
        },
        // Graph-level link to the markdown bytes structural extraction ran
        // against. For markdown-native uploads this equals row 1's object;
        // for converter-backed uploads it points at the stored intermediate.
        {
          subject: documentSubjectIri,
          predicate: "http://dkg.io/ontology/markdownForm",
          object: markdownFormUri,
          graph: assertionGraph,
        },
        // Row 4 — file descriptor block subject is the content-addressed URN
        {
          subject: fileUri,
          predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
          object: "http://dkg.io/ontology/File",
          graph: assertionGraph,
        },
        // Row 5 — on-chain canonical hash format is keccak256:<hex>
        {
          subject: fileUri,
          predicate: "http://dkg.io/ontology/contentHash",
          object: JSON.stringify(fileStoreEntry.keccak256),
          graph: assertionGraph,
        },
        // Row 8 — xsd:integer for size (byte count)
        {
          subject: fileUri,
          predicate: "http://dkg.io/ontology/size",
          object: `"${fileStoreEntry.size}"^^<http://www.w3.org/2001/XMLSchema#integer>`,
          graph: assertionGraph,
        },
        // Row 9 — ExtractionProvenance subject is a fresh UUID URN per import
        {
          subject: provUri,
          predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
          object: "http://dkg.io/ontology/ExtractionProvenance",
          graph: assertionGraph,
        },
        // Row 10 — back-references the ORIGINAL upload file URN (same value
        // as rows 4-5, 8 subject). The new `dkg:markdownForm` entity link
        // above separately exposes the markdown bytes Phase 2 actually read.
        {
          subject: provUri,
          predicate: "http://dkg.io/ontology/extractedFrom",
          object: fileUri,
          graph: assertionGraph,
        },
        // Row 11
        {
          subject: provUri,
          predicate: "http://dkg.io/ontology/extractedBy",
          object: agentDid,
          graph: assertionGraph,
        },
        // Row 12
        {
          subject: provUri,
          predicate: "http://dkg.io/ontology/extractedAt",
          object: startedAtLiteral,
          graph: assertionGraph,
        },
        // Row 13
        {
          subject: provUri,
          predicate: "http://dkg.io/ontology/extractionMethod",
          object: JSON.stringify("structural"),
          graph: assertionGraph,
        },
      ];

      // `_meta` quads (rows 14-20): always land in the CG ROOT `_meta`, never
      // a sub-graph `_meta`, keyed by the assertion UAL so daemon restarts
      // can recover the file ↔ assertion linkage from the graph alone.
      const metaQuads: Array<{
        subject: string;
        predicate: string;
        object: string;
        graph: string;
      }> = [
        // Row 14 — rootEntity comes from the extractor's resolved value so
        // the data-graph row 3 and `_meta` row 14 point at the same IRI.
        {
          subject: assertionUri,
          predicate: "http://dkg.io/ontology/rootEntity",
          object: resolvedRootEntity,
          graph: metaGraph,
        },
        // Row 15 — original content type from the upload (matches row 2
        // now that both rows are sourced from `detectedContentType`).
        {
          subject: assertionUri,
          predicate: "http://dkg.io/ontology/sourceContentType",
          object: JSON.stringify(detectedContentType),
          graph: metaGraph,
        },
        // Row 16 — load-bearing: lets a caller look up the source blob by UAL alone.
        {
          subject: assertionUri,
          predicate: "http://dkg.io/ontology/sourceFileHash",
          object: JSON.stringify(fileStoreEntry.keccak256),
          graph: metaGraph,
        },
        // Row 17
        {
          subject: assertionUri,
          predicate: "http://dkg.io/ontology/extractionMethod",
          object: JSON.stringify("structural"),
          graph: metaGraph,
        },
        // Row 18
        {
          subject: assertionUri,
          predicate: "http://dkg.io/ontology/structuralTripleCount",
          object: `"${triples.length}"^^<http://www.w3.org/2001/XMLSchema#integer>`,
          graph: metaGraph,
        },
        // Row 19 — V10.0 has no semantic (Layer 2) extraction, so always zero.
        {
          subject: assertionUri,
          predicate: "http://dkg.io/ontology/semanticTripleCount",
          object: `"0"^^<http://www.w3.org/2001/XMLSchema#integer>`,
          graph: metaGraph,
        },
      ];
      // Row 20 — only emitted when Phase 1 actually ran (PDF/DOCX path).
      if (mdIntermediateHash) {
        metaQuads.push({
          subject: assertionUri,
          predicate: "http://dkg.io/ontology/mdIntermediateHash",
          object: JSON.stringify(mdIntermediateHash),
          graph: metaGraph,
        });
      }
      // Round 9 Bug 27: `dkg:sourceFileName` — per-upload metadata that
      // used to live on `<fileUri>` (row 6 in the old file descriptor
      // block) moves to `_meta` keyed by `<assertionUri>` so two imports
      // of identical bytes under different filenames don't collide on
      // the same content-addressed subject. Symmetric to row 15
      // (`dkg:sourceContentType`). Skipped entirely when the upload
      // didn't carry a filename (matches the row 20 optional pattern).
      const uploadedFilename = filePart.filename?.trim() ?? "";
      if (uploadedFilename.length > 0) {
        metaQuads.push({
          subject: assertionUri,
          predicate: "http://dkg.io/ontology/sourceFileName",
          object: JSON.stringify(uploadedFilename),
          graph: metaGraph,
        });
      }

      // Round 14 Bug 42: lock acquisition moved to the top of the
      // handler, before Phase 1/2 extraction. This inner `try` now
      // wraps only the assertion.create + snapshot + cleanup + insert
      // + rollback sequence. See the lock-acquisition site above for
      // the full rationale.
      try {
        // Ensure the assertion graph exists even when Phase 2 yields zero
        // content triples, so a completed import always materializes the
        // reported assertion URI. `assertion.create` also runs the sub-graph
        // registration check, so bypassing `assertion.write` below doesn't
        // skip that safety gate.
        try {
          await agent.assertion.create(
            contextGraphId!,
            assertionName,
            subGraphName ? { subGraphName } : undefined,
          );
        } catch (err: any) {
          const message = err?.message ?? String(err);
          if (
            message.includes("already exists") ||
            message.includes("duplicate") ||
            message.includes("conflict")
          ) {
            // create() is idempotent when the graph already exists.
          } else if (
            message.includes("has not been registered") ||
            message.includes("Invalid") ||
            message.includes("Unsafe")
          ) {
            return respondWithFailedExtraction(400, message, triples.length);
          } else {
            return respondWithFailedExtraction(500, message, triples.length);
          }
        }

        // ── Snapshot BOTH graphs for Bugs 11 + 15 rollback ──
        //
        // Before the destructive cleanup (dropGraph + deleteByPattern),
        // CONSTRUCT the current contents of BOTH the assertion data graph
        // AND the assertion's `_meta` rows so the rollback path can
        // restore either or both if the subsequent atomic `store.insert`
        // fails.
        //
        // Round 4 (Bug 11) added the data-graph snapshot but NOT the
        // `_meta` snapshot, which left an edge case: a transient insert
        // failure would restore the prior data graph but leave `_meta`
        // empty for this assertion. Codex Bug 15 called that out — the
        // old `sourceFileHash` / `rootEntity` rows need to come back too.
        //
        // The data-graph CONSTRUCT pulls every quad where the assertion
        // graph is the context. The `_meta` CONSTRUCT is scoped to the
        // `<assertionUal> ?p ?o` subject pattern inside the CG root
        // `_meta` graph — we only rollback rows keyed by THIS assertion,
        // not every row in the shared `_meta` graph.
        //
        // First-import case: both CONSTRUCTs return zero quads (nothing
        // to preserve), and the rollback path is a no-op on both sides.
        let dataSnapshot: Array<{
          subject: string;
          predicate: string;
          object: string;
          graph: string;
        }> = [];
        let metaSnapshot: Array<{
          subject: string;
          predicate: string;
          object: string;
          graph: string;
        }> = [];
        try {
          const dataResult = await agent.store.query(
            `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${assertionGraph}> { ?s ?p ?o } }`,
          );
          if (dataResult.type === "quads") {
            // Pin the graph field to the assertion graph URI — CONSTRUCT
            // result quads have graph="" by adapter convention, but the
            // rollback re-insert needs to target the original graph.
            dataSnapshot = dataResult.quads.map((q) => ({
              ...q,
              graph: assertionGraph,
            }));
          }
        } catch (err: any) {
          const message = err?.message ?? String(err);
          // Round 13 Bug 38: mark the error so the outer catch doesn't
          // overwrite this stage-specific failure record with the raw
          // store error. Callers reading `/extraction-status` see
          // "Failed to snapshot assertion data graph for rollback: ..."
          // which tells them WHICH stage of the import pipeline broke,
          // not just the underlying store error in isolation.
          recordFailedExtraction(
            `Failed to snapshot assertion data graph for rollback: ${message}`,
            0,
          );
          (err as any).__failureAlreadyRecorded = true;
          throw err;
        }
        try {
          const metaResult = await agent.store.query(
            `CONSTRUCT { <${assertionUri}> ?p ?o } WHERE { GRAPH <${metaGraph}> { <${assertionUri}> ?p ?o } }`,
          );
          if (metaResult.type === "quads") {
            // Same graph-field pinning as above — preserve `metaGraph`
            // on every snapshotted quad so the rollback re-insert targets
            // the CG root `_meta` graph, not the empty default graph.
            metaSnapshot = metaResult.quads.map((q) => ({
              ...q,
              graph: metaGraph,
            }));
          }
        } catch (err: any) {
          const message = err?.message ?? String(err);
          // Round 13 Bug 38: same stage-context preservation as the
          // dataSnapshot failure branch above.
          recordFailedExtraction(
            `Failed to snapshot _meta for rollback: ${message}`,
            0,
          );
          (err as any).__failureAlreadyRecorded = true;
          throw err;
        }

        // ── Clear stale content from BOTH graphs before the fresh insert ──
        //
        // import-file has REPLACE semantics on same-name re-import: the
        // assertion ends up with exactly the content of the latest upload,
        // not a merge of every prior upload. Without this cleanup:
        //
        // 1. `_meta` rows 14-20 keyed by `<assertionUal>` would stack a
        //    second block next to the old one, so
        //    `<assertionUal> dkg:sourceFileHash ?h` would return two
        //    different hashes with no way to tell which is canonical.
        //
        // 2. Data-graph rows 1 and 4-13 would leave the old blob's
        //    descriptor next to the new blob's — a consumer walking the
        //    assertion graph would see two source files for one assertion.
        //
        // Order (Bug 14 reorder): `_meta` cleanup runs FIRST, then
        // `dropGraph`. This matches the Bug 12 pattern in
        // `assertionDiscard`. Both primitives are idempotent:
        // `deleteByPattern` returns 0 on a fresh assertion, `dropGraph`
        // uses `DROP SILENT GRAPH` so it's a no-op on a missing graph.
        //
        // Round 7 Bug 22: the Round 5/6 rollback path only fired when
        // the atomic `store.insert` failed. If `dropGraph` failed AFTER
        // `deleteByPattern` succeeded, the old `_meta` rows were gone
        // and the old data graph was still intact — a self-inconsistent
        // state with no rollback. Track which cleanup steps succeeded
        // and, on ANY subsequent failure, restore whichever snapshots
        // correspond to state we actually corrupted:
        //
        //  - `metaCleanupSucceeded` → restore `metaSnapshot`
        //  - `dataDropSucceeded` → restore `dataSnapshot`
        //  - insert succeeded → no rollback
        //  - `deleteByPattern` itself failed → no rollback (nothing
        //    changed, retry converges cleanly)
        //
        // The rollback is best-effort: compound failures record a rich
        // error with every failure message, then rethrow the ORIGINAL
        // error so the 500 envelope matches what the caller experienced.
        let metaCleanupSucceeded = false;
        let dataDropSucceeded = false;
        try {
          await agent.store.deleteByPattern({
            subject: assertionUri,
            graph: metaGraph,
          });
          metaCleanupSucceeded = true;
          await agent.store.dropGraph(assertionGraph);
          dataDropSucceeded = true;
          // ── Atomic multi-graph insert: rows 1-13 + rows 14-20 in one call ──
          // A single `store.insert` across two graphs — either both
          // land or neither does, per the adapter contracts.
          await agent.store.insert([...dataGraphQuads, ...metaQuads]);
        } catch (writeErr: any) {
          const writeMsg = writeErr?.message ?? String(writeErr);
          const rollbackErrors: string[] = [];
          // Restore each side we corrupted, in reverse order of the
          // forward sequence (insert → dropGraph → deleteByPattern).
          // `dataSnapshot` is restored only if `dropGraph` succeeded
          // (before then the old data is still in the store); likewise
          // `metaSnapshot` is restored only if `deleteByPattern`
          // succeeded. On a `deleteByPattern`-only failure both flags
          // are false and no rollback fires — the state is unchanged.
          if (dataDropSucceeded && dataSnapshot.length > 0) {
            try {
              await agent.store.insert(dataSnapshot);
            } catch (dataRollbackErr: any) {
              rollbackErrors.push(
                `data rollback failed: ${dataRollbackErr?.message ?? dataRollbackErr}`,
              );
            }
          }
          if (metaCleanupSucceeded && metaSnapshot.length > 0) {
            try {
              await agent.store.insert(metaSnapshot);
            } catch (metaRollbackErr: any) {
              rollbackErrors.push(
                `_meta rollback failed: ${metaRollbackErr?.message ?? metaRollbackErr}`,
              );
            }
          }
          if (rollbackErrors.length > 0) {
            // One or both rollback re-inserts failed. Log the compound
            // failure with every error message so a human can diagnose
            // the state, then rethrow the original error so the
            // top-level 500 handler responds with the envelope that
            // matches what the caller actually experienced.
            recordFailedExtraction(
              `write stage failed AND rollback failures: ${writeMsg}; ${rollbackErrors.join("; ")}`,
              triples.length,
            );
            (writeErr as any).__failureAlreadyRecorded = true;
          }
          throw writeErr;
        }
      } catch (err: any) {
        const message = err?.message ?? String(err);
        // Round 10 Bug 29: the previous `message.includes('Invalid' |
        // 'Unsafe' | 'has not been registered')` branches were moved
        // OUT of this outer catch. They now live only in the inner
        // `assertion.create` catch above (lines 2815-2828), which is
        // the only step in this block where a user-input validation
        // error can legitimately originate.
        //
        // The outer catch is only reachable for post-`assertion.create`
        // steps — snapshot queries, `_meta` cleanup, `dropGraph`, atomic
        // insert, and rollback re-inserts. Those all operate on
        // daemon-constructed quads and storage-layer primitives; an
        // `Invalid` or `Unsafe` substring in a thrown message from
        // those steps signals an INTERNAL storage error (e.g., an
        // Oxigraph `Invalid query plan` or a replication layer
        // `Unsafe write`), not a user-input failure. Misclassifying
        // them as HTTP 400 would mislead the caller into retrying
        // with a "fixed" payload when the problem was server-side.
        // Let them bubble up as 500 via the top-level handler.
        //
        // Bug 15: compound rollback failure already wrote a rich error
        // record — don't overwrite it with the bare insert error.
        if ((err as any)?.__failureAlreadyRecorded) {
          throw err;
        }
        // Unexpected write-stage failure: record the failure on the extraction
        // status map before rethrowing so /extraction-status doesn't stay stuck
        // at in_progress when the top-level 500 handler takes over. Because
        // the insert is atomic across both graphs, nothing landed and a retry
        // sees a clean slate.
        recordFailedExtraction(message, triples.length);
        throw err;
      }

      const completedRecord: ExtractionStatusRecord = {
        status: "completed",
        fileHash: fileStoreEntry.keccak256,
        ...(importRootEntity ? { rootEntity: importRootEntity } : {}),
        detectedContentType,
        pipelineUsed,
        tripleCount: triples.length,
        mdIntermediateHash,
        startedAt,
        completedAt: new Date().toISOString(),
      };
      setExtractionStatusRecord(
        extractionStatus,
        assertionUri,
        completedRecord,
      );

      return respondWithImportFileResponse(200, {
        status: "completed",
        tripleCount: triples.length,
        pipelineUsed,
        ...(mdIntermediateHash ? { mdIntermediateHash } : {}),
      });
    } finally {
      // Round 14 Bug 42 outer finally: release the per-assertion
      // lock so the next waiter can start. Runs regardless of
      // early returns (graceful-degrade skipped path, failed-
      // extraction paths, successful completion) AND regardless
      // of whether the inner write-stage try/catch threw. The map
      // entry is cleaned up iff this call is still the head of
      // the queue — if another waiter has chained on after us, its
      // chained promise has already replaced our slot in the map
      // and we leave it alone.
      releaseLock();
      if (assertionImportLocks.get(assertionUri) === chainedLock) {
        assertionImportLocks.delete(assertionUri);
      }
    }
  }

  // GET /api/assertion/:name/extraction-status?contextGraphId=...&subGraphName=...
  // Returns the current extraction job state for the given assertion.
  // Synchronous extractions (V10.0 default) return status="completed" immediately
  // on the import-file response; this endpoint lets agents re-query the status
  // later without having to hold the import-file response, and provides the hook
  // for async extraction workflows in V10.x.
  if (
    req.method === "GET" &&
    path.startsWith("/api/assertion/") &&
    path.endsWith("/extraction-status")
  ) {
    const assertionName = safeDecodeURIComponent(
      path.slice("/api/assertion/".length, -"/extraction-status".length),
      res,
    );
    if (assertionName === null) return;
    const nameVal = validateAssertionName(assertionName);
    if (!nameVal.valid)
      return jsonResponse(res, 400, {
        error: `Invalid assertion name: ${nameVal.reason}`,
      });
    const contextGraphId =
      url.searchParams.get("contextGraphId") ??
      url.searchParams.get("paranetId");
    if (!validateRequiredContextGraphId(contextGraphId, res)) return;
    const subGraphName = url.searchParams.get("subGraphName") ?? undefined;
    if (!validateOptionalSubGraphName(subGraphName, res)) return;

    const assertionUri = contextGraphAssertionUri(
      contextGraphId!,
      requestAgentAddress,
      assertionName,
      subGraphName,
    );
    const record = getExtractionStatusRecord(extractionStatus, assertionUri);
    if (!record) {
      return jsonResponse(res, 404, {
        error: `No extraction record found for assertion "${assertionName}" in context graph "${contextGraphId}"`,
      });
    }
    return jsonResponse(res, 200, {
      assertionUri,
      status: record.status,
      fileHash: record.fileHash,
      ...(record.rootEntity ? { rootEntity: record.rootEntity } : {}),
      detectedContentType: record.detectedContentType,
      pipelineUsed: record.pipelineUsed,
      tripleCount: record.tripleCount,
      ...(record.mdIntermediateHash
        ? { mdIntermediateHash: record.mdIntermediateHash }
        : {}),
      ...(record.error ? { error: record.error } : {}),
      startedAt: record.startedAt,
      ...(record.completedAt ? { completedAt: record.completedAt } : {}),
    });
  }

  // GET /api/file/:hash — serve a stored file by its content hash.
  // Accepts sha256:<hex>, keccak256:<hex>, or bare <hex> (treated as sha256).
  if (req.method === 'GET' && path.startsWith('/api/file/')) {
    const fileHash = safeDecodeURIComponent(path.slice('/api/file/'.length), res);
    if (fileHash === null) return;
    if (!fileHash) {
      return jsonResponse(res, 400, { error: 'Missing file hash' });
    }
    const bytes = await fileStore.get(fileHash);
    if (!bytes) {
      return jsonResponse(res, 404, { error: `File not found: ${fileHash}` });
    }
    const SAFE_PREVIEW_TYPES = new Set([
      'application/pdf',
      'application/json',
      'text/plain',
      'text/csv',
      'text/markdown',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
    ]);
    const rawCt = normalizeDetectedContentType(
      url.searchParams.get('contentType') ?? undefined,
    );
    const contentType = SAFE_PREVIEW_TYPES.has(rawCt)
      ? rawCt
      : 'application/octet-stream';
    const disposition = SAFE_PREVIEW_TYPES.has(rawCt) ? 'inline' : 'attachment';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': disposition,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    });
    res.end(bytes);
    return;
  }

  // POST /api/shared-memory/conditional-write  { contextGraphId, quads, conditions, subGraphName? }
  if (
    req.method === "POST" &&
    path === "/api/shared-memory/conditional-write"
  ) {
    const body = await readBody(req);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;
    const { quads, conditions, subGraphName } = parsed;
    const paranetId = parsed.contextGraphId ?? parsed.paranetId;
    if (!quads?.length)
      return jsonResponse(res, 400, { error: 'Missing "quads"' });
    if (!validateRequiredContextGraphId(paranetId, res)) return;
    if (!validateConditions(conditions, res)) return;
    if (!validateOptionalSubGraphName(subGraphName, res)) return;
    const ctx = createOperationContext("share");
    tracker.start(ctx, {
      contextGraphId: paranetId,
      details: { tripleCount: quads.length, source: "api-cas", subGraphName },
    });
    try {
      const result = await agent.conditionalShare(
        paranetId,
        quads,
        conditions,
        { subGraphName, operationCtx: ctx },
      );
      tracker.complete(ctx, { tripleCount: quads.length });
      return jsonResponse(res, 200, {
        ok: true,
        shareOperationId: result?.shareOperationId,
      });
    } catch (err: any) {
      tracker.fail(ctx, err);
      if (
        err.name === "StaleWriteError" ||
        err.message?.includes("stale") ||
        err.message?.includes("CAS condition failed")
      ) {
        return jsonResponse(res, 409, { error: err.message });
      }
      throw err;
    }
  }

  // POST /api/query  { sparql: "...", paranetId?: "...", graphSuffix?: "_shared_memory", includeWorkspace?: bool }
  if (req.method === "POST" && path === "/api/query") {
    const serverT0 = Date.now();
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    const sparql = parsed.sparql;
    const contextGraphId = parsed.contextGraphId ?? parsed.paranetId;
    const graphSuffix = parsed.graphSuffix;
    const includeSharedMemory =
      parsed.includeSharedMemory ?? parsed.includeWorkspace;
    const view = parsed.view;
    const agentAddress = parsed.agentAddress;
    const verifiedGraph = parsed.verifiedGraph;
    const assertionName = parsed.assertionName;
    const subGraphName = parsed.subGraphName;
    // P-13: accept `minTrust` as a string ("SelfAttested"|"Endorsed"|
    // "PartiallyVerified"|"ConsensusVerified") or the matching integer
    // (0..3). Unrecognised values fail closed with a 400 rather than
    // silently dropping the filter, because a dropped filter leaks
    // low-trust data into a query that asked for high-trust only.
    const TRUST_LEVELS: Record<string, number> = {
      selfattested: 0,
      endorsed: 1,
      partiallyverified: 2,
      consensusverified: 3,
    };
    // PR #239 Codex iter-5: also accept the legacy `_minTrust` underscore
    // form as a deprecation-window alias, so SDK consumers that adopted
    // the underscore shape before the rename get the same trust gate the
    // canonical `minTrust` does. `minTrust` wins if both are present.
    const rawMinTrust = parsed.minTrust ?? parsed._minTrust;
    const minTrustSrcField = parsed.minTrust !== undefined && parsed.minTrust !== null
      ? 'minTrust'
      : '_minTrust';
    if (!sparql || !String(sparql).trim())
      return jsonResponse(res, 400, { error: 'Missing "sparql"' });
    if (view && !(GET_VIEWS as readonly string[]).includes(view)) {
      return jsonResponse(res, 400, {
        error: `Invalid view "${view}". Supported: ${GET_VIEWS.join(", ")}`,
      });
    }
    // PR #239 Codex iter-7: gate minTrust normalization/validation behind
    // view === 'verified-memory'. Upstream `resolveViewGraphs()` already
    // ignores `minTrust` outside VM, so the HTTP layer must match that —
    // otherwise a reused options object like
    //   { view: "working-memory", minTrust: 99 }
    // would 400 on a request where the field is semantically irrelevant.
    // Keep view === undefined NOT rejecting either: resolveViewGraphs
    // treats "no view" as implicit working-memory semantics.
    let minTrust: number | undefined;
    if (view === 'verified-memory' && rawMinTrust !== undefined && rawMinTrust !== null) {
      if (typeof rawMinTrust === 'number' && Number.isInteger(rawMinTrust) && rawMinTrust >= 0 && rawMinTrust <= 3) {
        minTrust = rawMinTrust;
      } else if (typeof rawMinTrust === 'string') {
        const canon = rawMinTrust.toLowerCase().replace(/[_-]/g, '');
        if (canon in TRUST_LEVELS) minTrust = TRUST_LEVELS[canon];
      }
      if (minTrust === undefined) {
        return jsonResponse(res, 400, {
          error: `Invalid ${minTrustSrcField} "${rawMinTrust}". Expected one of: SelfAttested, Endorsed, PartiallyVerified, ConsensusVerified (or integer 0..3).`,
        });
      }
    }
    const ctx = createOperationContext("query");
    tracker.start(ctx, {
      contextGraphId,
      details: { sparql: sparql.slice(0, 200) },
    });
    tracker.startPhase(ctx, "parse");
    try {
      tracker.completePhase(ctx, "parse");
      tracker.startPhase(ctx, "execute");
      const execT0 = Date.now();
      // A-1 review: `callerAgentAddress` must come from an
      // *agent-scoped* bearer token, not the node-level default.
      // `resolveAgentAddress(token)` silently falls back to
      // `defaultAgentAddress` / `peerId` for node-level tokens, which
      // would make every node-level `/api/query` look like an
      // agent-scoped WM read and deny legitimate cross-agent reads
      // (e.g. OpenClaw sessions authenticating with
      // `~/.dkg/auth.token` and supplying a different `agentAddress`
      // in the body). `resolveAgentByToken` returns `undefined` for
      // node-level tokens, so only genuine agent-scoped identities
      // ever reach the A-1 guard.
      const callerAgentAddress = requestToken
        ? agent.resolveAgentByToken(requestToken)
        : undefined;
      // A-1 follow-up review (iteration 2): close the auth-disabled WM
      // hole WITHOUT regressing existing node-token clients.
      //
      // When we reach this line with `callerAgentAddress === undefined`,
      // the caller is one of:
      //
      //   (a) node-level admin (`~/.dkg/auth.token`, a token present in
      //       `validTokens`). Admin is already trusted to run as any
      //       local agent — `packages/adapter-openclaw` relies on this
      //       by passing a session-specific `agentAddress` alongside the
      //       admin token. Keep the legacy "skip the A-1 guard" here.
      //
      //   (b) unauthenticated (auth disabled at daemon level, OR no
      //       Authorization header, OR a bogus / mismatched bearer that
      //       the auth middleware never validated because `authEnabled`
      //       is false). This is the hole Codex flagged: a raw
      //       `Authorization: Bearer junk` used to set `requestToken`
      //       truthy, sliding past a `!requestToken` check and letting
      //       foreign WM reads through.
      //
      //   (c) auth-enabled + rejected — we never reach this line
      //       because `httpAuthGuard` has already 401'd the request.
      //
      // Gate the 403 on "not a known admin token" (i.e. the caller is
      // not in `validTokens`), which fails closed for (b) regardless of
      // what garbage they put in the header, and leaves (a) alone.
      //
      // Codex PR #242 iter-8: `validTokens` contains BOTH the
      // node-level admin token (`~/.dkg/auth.token`) AND any
      // per-agent tokens the node has issued. Treating every
      // validToken as "admin" means an authenticated agent could
      // use its OWN token to skip the A-1 guard and read another
      // local agent's WM via `agentAddress`. Restrict the admin
      // bypass to tokens that are NOT bound to a specific agent
      // (`resolveAgentByToken(token) === undefined`), which is the
      // current signal for "node-level / admin-scoped".
      //
      // Codex PR #242 iter-8 re-review: the A-1 fallback 403 must
      // also NOT fire for authenticated agent callers. An agent
      // querying its OWN WM (`callerAgentAddress === agentAddress`)
      // was previously being rejected here unless the target happened
      // to be the node default / peerId alias, and genuine cross-agent
      // reads were surfacing as a 403 (leaking existence) instead of
      // the intended silent empty-per-kind result from
      // `DKGAgent.query`. Only gate the self-alias fallback when the
      // caller has no recognised identity at all — neither a
      // node-level admin token nor an agent-scoped bearer. Authenticated
      // agent callers flow straight into `agent.query()` below, which
      // enforces the isolation invariant by returning an empty-per-kind
      // result for any target that is not `callerAgentAddress`.
      const isAdminToken =
        !!requestToken
        && validTokens.has(requestToken)
        && callerAgentAddress === undefined;
      const hasRecognisedIdentity = isAdminToken || callerAgentAddress !== undefined;
      if (
        !hasRecognisedIdentity &&
        view === 'working-memory' &&
        typeof agentAddress === 'string'
      ) {
        // Codex (iteration 4): the daemon's canonical "own WM" identity is
        // whatever `agent.resolveAgentAddress(undefined)` returns — i.e.
        // `defaultAgentAddress ?? peerId`. Several in-repo paths still
        // authenticate under the legacy peerId alias (node-level tokens,
        // auth-disabled self-reads before a default agent was configured),
        // so we must accept both the default agent address *and* the bare
        // peerId as self, otherwise an auth-disabled self-read via the
        // legacy alias now 403s where it used to return the node's own WM.
        const targetLower = agentAddress.toLowerCase();
        const selfAliasesLower = new Set<string>();
        const defaultAgent = agent.getDefaultAgentAddress();
        if (defaultAgent) selfAliasesLower.add(defaultAgent.toLowerCase());
        if (agent.peerId) selfAliasesLower.add(agent.peerId.toLowerCase());
        if (selfAliasesLower.size === 0 || !selfAliasesLower.has(targetLower)) {
          return jsonResponse(res, 403, {
            error:
              `working-memory reads for agentAddress=${agentAddress} require authentication. ` +
              `An unauthenticated / auth-disabled caller may only read the node-default agent's WM ` +
              `(accepted self-aliases: defaultAgentAddress and the node's peerId).`,
          });
        }
      }
      const result = await agent.query(sparql, {
        contextGraphId,
        graphSuffix,
        includeSharedMemory,
        view,
        agentAddress,
        verifiedGraph,
        assertionName,
        subGraphName,
        callerAgentAddress,
        minTrust: minTrust as TrustLevel | undefined,
        operationCtx: ctx,
      });
      const execDur = Date.now() - execT0;
      tracker.completePhase(ctx, "execute");
      tracker.complete(ctx, { tripleCount: result?.bindings?.length ?? 0 });
      return jsonResponse(res, 200, {
        result,
        phases: { execute: execDur, serverTotal: Date.now() - serverT0 },
      });
    } catch (err: any) {
      tracker.fail(ctx, err);
      const msg = err?.message ?? "";
      if (
        msg.startsWith("SPARQL rejected:") ||
        msg.startsWith("Parse error") ||
        /must start with (SELECT|CONSTRUCT|ASK|DESCRIBE)/i.test(msg) ||
        msg.includes("was removed in V10") ||
        msg.includes("agentAddress is required") ||
        msg.includes("requires a contextGraphId") ||
        msg.includes("cannot be combined with") ||
        // A-1 review: DKGAgent.query throws these when the caller sends
        // a non-string `agentAddress` / `callerAgentAddress` in the
        // body. Classify as 400 so malformed input is a clean client
        // error instead of a 500.
        msg.startsWith("query: 'agentAddress' must be a string") ||
        msg.startsWith("query: 'callerAgentAddress' must be a string") ||
        // P-13 review: `resolveViewGraphs` validates `minTrust` now,
        // so direct callers that forward a string / out-of-range
        // value get a 400 instead of a 500.
        msg.startsWith("Invalid minTrust")
      ) {
        return jsonResponse(res, 400, { error: msg });
      }
      throw err;
    }
  }

  // POST /api/genui/render  { contextGraphId, entityUri, libraryPrompt }
  //
  // Streams OpenUI Lang deltas over Server-Sent Events. The UI registers
  // the component library client-side with @openuidev/react-lang and
  // passes its `library.prompt()` text up; the daemon does the heavy
  // lifting — resolving triples, reading the profile hint for the entity's
  // rdf:type, composing the messages, and piping LlmClient stream events.
  if (req.method === "POST" && path === "/api/genui/render") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;
    const { contextGraphId, entityUri, libraryPrompt } = parsed;
    if (!validateRequiredContextGraphId(contextGraphId, res)) return;
    if (typeof entityUri !== "string" || !entityUri.trim()) {
      return jsonResponse(res, 400, { error: 'Missing "entityUri"' });
    }
    if (typeof libraryPrompt !== "string" || !libraryPrompt.trim()) {
      return jsonResponse(res, 400, { error: 'Missing "libraryPrompt"' });
    }
    if (!config.llm?.apiKey) {
      return jsonResponse(res, 503, {
        error: 'LLM not configured. Set an API key in Settings to enable GenUI.',
      });
    }

    // Fetch entity triples.
    // The entity's data lives in the sub-graph's named assertion graph, so
    // we must wrap the pattern in GRAPH ?g — otherwise we'd only see the
    // default graph, which is empty for these imports. DISTINCT because
    // promoted triples can appear under both WM and SWM/VM named graphs
    // for the same sub-graph.
    let triples: Array<{ p: string; o: string }> = [];
    let entityRdfType: string | null = null;
    try {
      // Stripping angle brackets is only ergonomic ("accept <uri> or uri"),
      // not sanitisation — a crafted input containing `>` or whitespace can
      // still break out of the interpolated `<…>`. `sparqlIri` runs
      // `assertSafeIri` before wrapping.
      const entityIri = entityUri.replace(/^<|>$/g, '');
      let safeEntityIri: string;
      try {
        safeEntityIri = sparqlIri(entityIri);
      } catch {
        return jsonResponse(res, 400, {
          error: `Unsafe entityUri: ${entityUri}`,
        });
      }
      const triplesResult = await agent.query(
        `SELECT DISTINCT ?p ?o WHERE { GRAPH ?g { ${safeEntityIri} ?p ?o } } LIMIT 200`,
        { contextGraphId },
      );
      // `agent.query()` can return bindings as SPARQL-JSON objects
      // (`{value, type, …}`) once the result has passed through the
      // normaliser — stringifying them directly produces "[object Object]"
      // and wrecks the downstream rdf:type lookup / LLM prompt. See
      // `bindingValue` near the top of this file.
      triples = (triplesResult?.bindings ?? []).map((row: any) => ({
        p: bindingValue(row.p),
        o: bindingValue(row.o),
      }));
      const typeT = triples.find(
        (t) => t.p === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
      );
      if (typeT) entityRdfType = typeT.o;
    } catch (err: any) {
      return jsonResponse(res, 500, {
        error: `Failed to fetch entity triples: ${err.message}`,
      });
    }

    if (triples.length === 0) {
      return jsonResponse(res, 404, {
        error: `No triples found for <${entityUri}> in ${contextGraphId}`,
      });
    }

    // Fetch the profile's detailHint for this type from the `meta` sub-graph.
    // Same GRAPH ?g reasoning as above — the profile lives in a named
    // assertion graph under `.../meta/assertion/...`, not in the default.
    let detailHint: string | null = null;
    let entityTypeLabel: string | null = null;
    if (entityRdfType) {
      // `entityRdfType` came from the quadstore as the value of `rdf:type`,
      // so it's normally a safe IRI — but crafted imported data could in
      // principle smuggle unsafe chars through. Validate before interpolating.
      let safeTypeIri: string | null = null;
      try {
        safeTypeIri = sparqlIri(entityRdfType);
      } catch {
        safeTypeIri = null;
      }
      if (safeTypeIri) {
        try {
          const hintResult = await agent.query(
            `
              SELECT ?hint ?label WHERE {
                GRAPH ?g {
                  ?binding <http://dkg.io/ontology/profile/forType> ${safeTypeIri} ;
                           <http://dkg.io/ontology/profile/detailHint> ?hint .
                  OPTIONAL { ?binding <http://dkg.io/ontology/profile/label> ?label }
                }
              } LIMIT 1
            `,
            { contextGraphId, subGraphName: 'meta' },
          );
          const row = hintResult?.bindings?.[0];
          if (row) {
            const hintRaw = bindingValue(row.hint);
            detailHint = hintRaw.replace(/^"|"$/g, '').replace(/^"(.+)"(?:@\w+|\^\^.+)?$/, '$1');
            if (row.label) {
              const labelRaw = bindingValue(row.label);
              entityTypeLabel = labelRaw.replace(/^"|"$/g, '').replace(/^"(.+)"(?:@\w+|\^\^.+)?$/, '$1');
            }
          }
        } catch {
          // meta sub-graph may be missing — fall through, LLM still has triples.
        }
      }
    }

    // Compose the prompt
    const systemPrompt =
      libraryPrompt +
      `\n\n# Task\n` +
      `You will be given an RDF entity from a DKG context graph, described by its triples (predicate -> object). ` +
      `Compose a single OpenUI Lang response that renders a rich, domain-appropriate detail view of this entity ` +
      `using only components from the library above.\n` +
      `\n## Rules\n` +
      `- Output OpenUI Lang only. No prose, no markdown fences, no commentary.\n` +
      `- Use the EntityDetail root if the library declares one; otherwise start with whatever the library's root wants.\n` +
      `- Extract display values from the literal objects (strip XSD datatype suffixes).\n` +
      `- If URI objects look like "urn:dkg:...", treat them as links to other entities.\n` +
      `- Prefer grouping: header card -> stats grid -> related lists.\n` +
      `- Keep it compact — no more than ~12 child blocks.\n`;

    const userMessage = [
      `Entity URI: ${entityUri}`,
      entityRdfType ? `rdf:type: ${entityRdfType}${entityTypeLabel ? ` (${entityTypeLabel})` : ''}` : '',
      detailHint ? `\nProfile hint for this type:\n${detailHint}` : '',
      `\nTriples (${triples.length}):\n` + triples.slice(0, 120).map(t => `  ${t.p}  ${t.o}`).join('\n'),
      triples.length > 120 ? `  … (${triples.length - 120} more triples truncated)` : '',
    ].filter(Boolean).join('\n');

    // Start SSE stream
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const client = new LlmClient();
    const sendEvent = (type: string, data: unknown) => {
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('start', { entityUri, entityRdfType, entityTypeLabel });
    try {
      const events = client.stream({
        config: config.llm!,
        request: {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          stream: true,
          temperature: 0.3,
          maxTokens: 1500,
        },
      });
      for await (const ev of events) {
        if (ev.type === 'text_delta') {
          sendEvent('delta', { text: ev.delta });
        } else if (ev.type === 'final') {
          sendEvent('final', { content: ev.message.content ?? '' });
        } else if (ev.type === 'error') {
          sendEvent('error', { error: ev.error });
        }
      }
      sendEvent('done', {});
    } catch (err: any) {
      sendEvent('error', { error: err?.message ?? String(err) });
    } finally {
      res.end();
    }
    return;
  }

  // POST /api/query-remote  { peerId, lookupType, paranetId?, ual?, entityUri?, rdfType?, sparql?, limit?, timeout? }
  if (req.method === "POST" && path === "/api/query-remote") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const {
      peerId: rawPeerId,
      lookupType,
      paranetId,
      ual,
      entityUri,
      rdfType,
      sparql,
      limit,
      timeout,
    } = JSON.parse(body);
    if (!rawPeerId)
      return jsonResponse(res, 400, { error: 'Missing "peerId"' });
    if (!lookupType)
      return jsonResponse(res, 400, { error: 'Missing "lookupType"' });
    const ctx = createOperationContext("query");
    tracker.start(ctx, {
      contextGraphId: paranetId,
      details: { lookupType, remotePeer: rawPeerId, source: "api-remote" },
    });
    try {
      const peerId = await tracker.trackPhase(ctx, "resolve", () =>
        resolveNameToPeerId(agent, rawPeerId),
      );
      if (!peerId) {
        tracker.fail(ctx, new Error(`Agent "${rawPeerId}" not found`));
        return jsonResponse(res, 404, {
          error: `Agent "${rawPeerId}" not found`,
        });
      }
      const response = await tracker.trackPhase(ctx, "execute", () =>
        agent.queryRemote(peerId, {
          lookupType,
          paranetId,
          ual,
          entityUri,
          rdfType,
          sparql,
          limit,
          timeout,
        }),
      );
      tracker.complete(ctx, { details: { lookupType, remotePeer: rawPeerId } });
      return jsonResponse(res, 200, response);
    } catch (err) {
      tracker.fail(ctx, err);
      throw err;
    }
  }

  // POST /api/context-graph/{id}/add-participant
  const addParticipantMatch = path.match(/^\/api\/context-graph\/([^/]+)\/add-participant$/);
  if (req.method === "POST" && addParticipantMatch) {
    const contextGraphId = decodeURIComponent(addParticipantMatch[1]);
    const body = await readBody(req);
    const { agentAddress } = JSON.parse(body);
    if (!agentAddress || typeof agentAddress !== 'string') {
      return jsonResponse(res, 400, { error: 'agentAddress is required' });
    }
    try {
      await agent.inviteAgentToContextGraph(contextGraphId, agentAddress, requestAgentAddress);
      return jsonResponse(res, 200, { ok: true, contextGraphId, agentAddress });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(res, 400, { error: msg });
    }
  }

  // POST /api/context-graph/{id}/remove-participant
  const removeParticipantMatch = path.match(/^\/api\/context-graph\/([^/]+)\/remove-participant$/);
  if (req.method === "POST" && removeParticipantMatch) {
    const contextGraphId = decodeURIComponent(removeParticipantMatch[1]);
    const body = await readBody(req);
    const { agentAddress } = JSON.parse(body);
    if (!agentAddress || typeof agentAddress !== 'string') {
      return jsonResponse(res, 400, { error: 'agentAddress is required' });
    }
    try {
      await agent.removeAgentFromContextGraph(contextGraphId, agentAddress, requestAgentAddress);
      return jsonResponse(res, 200, { ok: true, contextGraphId, agentAddress });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(res, 400, { error: msg });
    }
  }

  // GET /api/context-graph/{id}/participants
  const listParticipantsMatch = path.match(/^\/api\/context-graph\/([^/]+)\/participants$/);
  if (req.method === "GET" && listParticipantsMatch) {
    const contextGraphId = decodeURIComponent(listParticipantsMatch[1]);
    try {
      const agents = await agent.getContextGraphAllowedAgents(contextGraphId);
      return jsonResponse(res, 200, { contextGraphId, allowedAgents: agents });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(res, 400, { error: msg });
    }
  }

  // POST /api/context-graph/{id}/request-join — signed join request from an invitee
  // If local node is the curator (owns the CG), store locally.
  // Otherwise, forward via P2P to all connected peers so the curator receives it.
  const requestJoinMatch = path.match(/^\/api\/context-graph\/([^/]+)\/request-join$/);
  if (req.method === "POST" && requestJoinMatch) {
    const contextGraphId = decodeURIComponent(requestJoinMatch[1]);
    const body = await readBody(req);
    try {
      const { agentAddress, signature, timestamp, agentName } = JSON.parse(body);
      if (!agentAddress || !signature || !timestamp) {
        return jsonResponse(res, 400, { error: 'Missing agentAddress, signature, or timestamp' });
      }
      agent.verifyJoinRequest(contextGraphId, agentAddress, timestamp, signature);

      const isCurator = await agent.isCuratorOf(contextGraphId);
      if (isCurator) {
        await agent.storePendingJoinRequest(contextGraphId, agentAddress, signature, timestamp, agentName);
        return jsonResponse(res, 200, { ok: true, status: 'pending', delivered: 'local' });
      }

      const result = await agent.forwardJoinRequest(contextGraphId, agentAddress, signature, timestamp, agentName);
      if (result.delivered === 0) {
        return jsonResponse(res, 502, { error: 'Could not deliver join request to curator. No reachable curator found.' });
      }
      return jsonResponse(res, 200, { ok: true, status: 'pending', delivered: result.delivered });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(res, 400, { error: msg });
    }
  }

  // GET /api/context-graph/{id}/join-requests — list pending join requests (curator view)
  const joinRequestsMatch = path.match(/^\/api\/context-graph\/([^/]+)\/join-requests$/);
  if (req.method === "GET" && joinRequestsMatch) {
    const contextGraphId = decodeURIComponent(joinRequestsMatch[1]);
    try {
      const requests = await agent.listPendingJoinRequests(contextGraphId);
      return jsonResponse(res, 200, { contextGraphId, requests });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(res, 400, { error: msg });
    }
  }

  // POST /api/context-graph/{id}/approve-join — approve a pending request
  const approveJoinMatch = path.match(/^\/api\/context-graph\/([^/]+)\/approve-join$/);
  if (req.method === "POST" && approveJoinMatch) {
    const contextGraphId = decodeURIComponent(approveJoinMatch[1]);
    const body = await readBody(req);
    try {
      const { agentAddress } = JSON.parse(body);
      if (!agentAddress) return jsonResponse(res, 400, { error: 'Missing agentAddress' });
      await agent.approveJoinRequest(contextGraphId, agentAddress, requestAgentAddress);
      return jsonResponse(res, 200, { ok: true, status: 'approved', agentAddress });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(res, 400, { error: msg });
    }
  }

  // POST /api/context-graph/{id}/reject-join — reject a pending request
  const rejectJoinMatch = path.match(/^\/api\/context-graph\/([^/]+)\/reject-join$/);
  if (req.method === "POST" && rejectJoinMatch) {
    const contextGraphId = decodeURIComponent(rejectJoinMatch[1]);
    const body = await readBody(req);
    try {
      const { agentAddress } = JSON.parse(body);
      if (!agentAddress) return jsonResponse(res, 400, { error: 'Missing agentAddress' });
      await agent.rejectJoinRequest(contextGraphId, agentAddress);
      return jsonResponse(res, 200, { ok: true, status: 'rejected', agentAddress });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(res, 400, { error: msg });
    }
  }

  // POST /api/context-graph/{id}/sign-join — sign a join request and forward to curator via P2P
  const signJoinMatch = path.match(/^\/api\/context-graph\/([^/]+)\/sign-join$/);
  if (req.method === "POST" && signJoinMatch) {
    const contextGraphId = decodeURIComponent(signJoinMatch[1]);
    try {
      const callerAddress = agent.resolveAgentAddress(
        extractBearerToken(req.headers.authorization),
      );
      const signed = await agent.signJoinRequest(contextGraphId, callerAddress);
      const { delivered, errors } = await agent.forwardJoinRequest(
        signed.contextGraphId,
        signed.agentAddress,
        signed.signature,
        signed.timestamp,
        agent.nodeName,
      );
      return jsonResponse(res, 200, {
        ok: true,
        ...signed,
        delivered,
        ...(errors.length > 0 ? { errors } : {}),
        status: delivered > 0 ? 'sent' : 'no-curator-found',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(res, 400, { error: msg });
    }
  }

  // ── Phase 8: project-manifest publish + install (UI-driven) ───────
  //
  // These three routes power the CreateProjectModal (curator side,
  // /publish) and JoinProjectModal (joiner side, /plan-install +
  // /install) wire-workspace flow. They reuse the same publish /
  // fetch / plan / write helpers that scripts/import-manifest.mjs
  // and `dkg-mcp join` use, by constructing a self-pointing DkgClient
  // that talks back to this same daemon over HTTP.
  //
  // Why a self-client and not direct internal calls? Two reasons:
  // (1) keeps the manifest helpers framework-agnostic (one wire
  // format whether they're called from CLI, browser-via-daemon, or
  // anywhere else), (2) honours the same auth/rate-limit/audit path
  // any other client would go through.

  const manifestPublishMatch = path.match(/^\/api\/context-graph\/([^/]+)\/manifest\/publish$/);
  if (req.method === 'POST' && manifestPublishMatch) {
    const contextGraphId = decodeURIComponent(manifestPublishMatch[1]);
    let body: any = {};
    try { body = JSON.parse(await readBody(req, SMALL_BODY_BYTES) || '{}'); }
    catch { return jsonResponse(res, 400, { error: 'Invalid JSON body' }); }

    // Authorization gate (Codex tier-4g finding on 6921): publish
    // rewrites + promotes the project's onboarding templates into
    // Shared Working Memory. Without an owner-check, any participant
    // who reaches the daemon with a valid bearer token could overwrite
    // the manifest and poison every future install (malicious hook
    // URLs, swapped agent URIs, etc.). Only the CG's registered
    // curator/creator may publish.
    try {
      await agent.assertContextGraphOwner(contextGraphId, requestAgentAddress, 'publish a project manifest');
    } catch (authErr: unknown) {
      const msg = authErr instanceof Error ? authErr.message : String(authErr);
      // Distinguish "not the owner" from "CG has no registered owner".
      const code = /has no registered owner/.test(msg) ? 400 : 403;
      return jsonResponse(res, code, { error: msg });
    }

    try {
      const requestedNetwork = typeof body.networkLabel === 'string' ? body.networkLabel : null;
      const networkLabel: 'testnet' | 'mainnet' | 'devnet' =
        requestedNetwork === 'testnet' || requestedNetwork === 'mainnet' || requestedNetwork === 'devnet'
          ? requestedNetwork
          : manifestNetworkLabel(network?.networkName);
      // Codex tier-4h finding N11: the prior `Array.isArray(...) && .length
      // ? filter : defaults` chain accepted the request when `body.supportedTools`
      // contained ONLY values the filter throws away (e.g. `['codex']`). The
      // filter would return `[]`, `publishManifestImpl` would happily publish
      // a manifest with zero supported tools, and then `fetchManifest()`'s Zod
      // schema would reject the manifest because it requires at least one —
      // so the project would be un-installable until someone republishes.
      // Fail fast at the route when the caller supplied a non-empty array
      // but nothing in it survives the filter; fall back to the default
      // ONLY when the caller didn't specify anything.
      let supportedTools: ('cursor' | 'claude-code')[];
      if (Array.isArray(body.supportedTools) && body.supportedTools.length) {
        supportedTools = body.supportedTools
          .filter((t: unknown): t is 'cursor' | 'claude-code' => t === 'cursor' || t === 'claude-code');
        if (supportedTools.length === 0) {
          return jsonResponse(res, 400, {
            error:
              `"supportedTools" contained none of the supported values. ` +
              `Pass one or more of ["cursor", "claude-code"], or omit the ` +
              `field entirely to publish the default set.`,
          });
        }
      } else {
        supportedTools = ['cursor', 'claude-code'];
      }
      // Always derive the publisher from the authenticated caller. Accepting
      // `publisherAgentUri` from the request body let any client forge
      // `prov:wasAttributedTo` on the manifest entities, impersonating another
      // agent's provenance on-chain. The server-side derivation below is the
      // only source of truth.
      const publisherAgentUri = manifestPublisherUri(requestAgentAddress);
      const requiresMcpDkgVersion = (body.requiresMcpDkgVersion as string) ?? '>=0.1.0';

      const repoRoot = manifestRepoRoot();
      let templates;
      try {
        templates = assembleStandardTemplates(repoRoot);
      } catch (assembleErr: unknown) {
        const msg = assembleErr instanceof Error ? assembleErr.message : String(assembleErr);
        return jsonResponse(res, 500, {
          error: `Could not assemble templates from repo root ${repoRoot}: ${msg}. ` +
            `The daemon must be started from a dkg-v9 checkout for manifest publish to work today.`,
        });
      }

      const ontologyUri = body.ontologyUri ?? `urn:dkg:project:${contextGraphId}:ontology`;
      const client = manifestSelfClient(apiHost, apiPortRef.value, requestToken);
      const result = await publishManifestImpl({
        contextGraphId,
        network: networkLabel,
        supportedTools,
        publisherAgentUri,
        ontologyUri,
        requiresMcpDkgVersion,
        templates,
        client,
      });
      return jsonResponse(res, 200, {
        ok: true,
        manifestUri: result.manifestUri,
        templateUris: result.templateUris,
        tripleCount: result.tripleCount,
        network: networkLabel,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(res, 500, { error: `manifest publish failed: ${msg}` });
    }
  }

  const manifestPlanInstallMatch = path.match(/^\/api\/context-graph\/([^/]+)\/manifest\/plan-install$/);
  if (req.method === 'POST' && manifestPlanInstallMatch) {
    const contextGraphId = decodeURIComponent(manifestPlanInstallMatch[1]);
    let body: any = {};
    try { body = JSON.parse(await readBody(req, SMALL_BODY_BYTES) || '{}'); }
    catch { return jsonResponse(res, 400, { error: 'Invalid JSON body' }); }

    try {
      const ctx = buildManifestInstallContext(req, body, contextGraphId, requestToken, requestAgentAddress, apiHost, apiPortRef.value);
      if (!ctx.ok) return jsonResponse(res, 400, { error: ctx.error });
      const fetched = await fetchManifestImpl({ client: manifestSelfClient(apiHost, apiPortRef.value, requestToken), contextGraphId });
      // Strip supportedTools the operator didn't pick — planner uses
      // supportedTools to gate claude-code wiring, and we want the same
      // gating to apply for any tool the operator deselected.
      const filteredSupportedTools = fetched.supportedTools.filter((t) =>
        (ctx.context.tools as readonly string[]).includes(t));
      // Fail fast when the intersection of requested tools and the
      // manifest's supportedTools is empty (Codex tier-4k N28). Without
      // this, `plan-install` happily returns a "successful" plan that
      // writes AGENTS.md / config.yaml but no usable Cursor/Claude
      // wiring, because the planner gates each wiring block on
      // `supportedTools.includes(…)`. Operators then hit a confusing
      // "install succeeded but nothing works" state. Return 400 with
      // the actionable options so the UI can surface the choice.
      if (filteredSupportedTools.length === 0) {
        return jsonResponse(res, 400, {
          error:
            `None of the requested tools (${(ctx.context.tools as readonly string[]).join(', ') || 'none'}) ` +
            `are supported by this project's manifest. Supported tools are: ` +
            `[${fetched.supportedTools.join(', ')}]. Pass at least one of those in ` +
            `"tools", or ask the curator to republish the manifest with broader ` +
            `"supportedTools".`,
        });
      }
      // Enforce `requiresMcpDkgVersion` before planning (Codex tier-4k N30).
      // A manifest can declare the minimum mcp-dkg version its wiring needs
      // (e.g. new capture-hook format, new schema fields). Without this
      // check an operator on an older local @origintrail-official/dkg-mcp
      // gets a plan that looks fine but fails the moment Cursor/Claude
      // tries to invoke the bundled entry. We skip gating when the range
      // is absent OR when we can't read the local mcp-dkg version — the
      // latter is very rare (no resolution path) and erring-permissive
      // keeps existing deployments working.
      if (fetched.requiresMcpDkgVersion) {
        const installedVersion = readMcpDkgVersion();
        if (installedVersion && !versionSatisfiesRange(installedVersion, fetched.requiresMcpDkgVersion)) {
          return jsonResponse(res, 400, {
            error:
              `This project's manifest requires @origintrail-official/dkg-mcp ` +
              `"${fetched.requiresMcpDkgVersion}", but the local installation is ` +
              `v${installedVersion}. Upgrade mcp-dkg (e.g. \`pnpm add -g ` +
              `@origintrail-official/dkg-mcp@${fetched.requiresMcpDkgVersion}\`) ` +
              `before running install.`,
          });
        }
      }
      const manifest = {
        ...fetched,
        supportedTools: filteredSupportedTools,
      };
      const plan = planInstallImpl({ ...ctx.context, manifest });
      const markdown = buildReviewMarkdownImpl(manifest, plan);
      return jsonResponse(res, 200, {
        ok: true,
        manifest: {
          uri: manifest.uri,
          contextGraphId: manifest.contextGraphId,
          network: manifest.network,
          publishedBy: manifest.publishedBy,
          publishedAt: manifest.publishedAt,
          supportedTools: manifest.supportedTools,
          ontologyUri: manifest.ontologyUri,
        },
        plan: {
          files: plan.files.map((f) => ({
            field: f.field,
            absPath: f.absPath,
            exists: f.exists,
            merges: f.merges,
            bytes: f.bytes,
            encodingFormat: f.encodingFormat,
          })),
          warnings: plan.warnings,
          substitutionValues: plan.substitutionValues,
        },
        markdown,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(res, 500, { error: `manifest plan-install failed: ${msg}` });
    }
  }

  const manifestInstallMatch = path.match(/^\/api\/context-graph\/([^/]+)\/manifest\/install$/);
  if (req.method === 'POST' && manifestInstallMatch) {
    const contextGraphId = decodeURIComponent(manifestInstallMatch[1]);
    let body: any = {};
    try { body = JSON.parse(await readBody(req, SMALL_BODY_BYTES) || '{}'); }
    catch { return jsonResponse(res, 400, { error: 'Invalid JSON body' }); }

    try {
      const ctx = buildManifestInstallContext(req, body, contextGraphId, requestToken, requestAgentAddress, apiHost, apiPortRef.value);
      if (!ctx.ok) return jsonResponse(res, 400, { error: ctx.error });
      const fetched = await fetchManifestImpl({ client: manifestSelfClient(apiHost, apiPortRef.value, requestToken), contextGraphId });
      const filteredSupportedTools = fetched.supportedTools.filter((t) =>
        (ctx.context.tools as readonly string[]).includes(t));
      // Same fail-fast as `/manifest/plan-install` (Codex N28): refuse to
      // run the install if the operator's selected tools don't intersect
      // what the manifest actually supports — otherwise we silently
      // write generic config without any of the editor wiring the user
      // asked for.
      if (filteredSupportedTools.length === 0) {
        return jsonResponse(res, 400, {
          error:
            `None of the requested tools (${(ctx.context.tools as readonly string[]).join(', ') || 'none'}) ` +
            `are supported by this project's manifest. Supported tools are: ` +
            `[${fetched.supportedTools.join(', ')}]. Pass at least one of those in ` +
            `"tools", or ask the curator to republish the manifest with broader ` +
            `"supportedTools".`,
        });
      }
      // Same `requiresMcpDkgVersion` gate as /manifest/plan-install
      // (Codex tier-4k N30). Blocking here prevents the writeInstallImpl
      // step from spraying incompatible wiring onto disk that the local
      // mcp-dkg can't actually service.
      if (fetched.requiresMcpDkgVersion) {
        const installedVersion = readMcpDkgVersion();
        if (installedVersion && !versionSatisfiesRange(installedVersion, fetched.requiresMcpDkgVersion)) {
          return jsonResponse(res, 400, {
            error:
              `This project's manifest requires @origintrail-official/dkg-mcp ` +
              `"${fetched.requiresMcpDkgVersion}", but the local installation is ` +
              `v${installedVersion}. Upgrade mcp-dkg (e.g. \`pnpm add -g ` +
              `@origintrail-official/dkg-mcp@${fetched.requiresMcpDkgVersion}\`) ` +
              `before running install.`,
          });
        }
      }
      const manifest = {
        ...fetched,
        supportedTools: filteredSupportedTools,
      };
      const plan = planInstallImpl({ ...ctx.context, manifest });
      const written = await writeInstallImpl(plan);
      const skipped: string[] = [];
      if (!(ctx.context.tools as readonly string[]).includes('claude-code')) {
        skipped.push('claudeHooksTemplate (claude-code not selected)');
      }
      if ((ctx.context.tools as readonly string[]).includes('codex')) {
        skipped.push('codex wiring is "coming soon" — no template entries shipped yet');
      }
      return jsonResponse(res, 200, {
        ok: true,
        written: written.map((w) => ({
          field: w.field,
          absPath: w.absPath,
          bytesWritten: w.bytesWritten,
          action: w.action,
        })),
        warnings: plan.warnings,
        skipped,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(res, 500, { error: `manifest install failed: ${msg}` });
    }
  }

  // GET /api/host/info — surface enough host info for the WireWorkspacePanel
  // to render real absolute defaults (no `~` paths). Auth-required because
  // hostname/username can be considered identifying. Returns nothing
  // sensitive — just $HOME, hostname, platform, and a sensible default
  // workspace parent dir.
  if (req.method === 'GET' && path === '/api/host/info') {
    try {
      const home = osModule.homedir();
      const hostname = osModule.hostname();
      const username = osModule.userInfo().username;
      const platform = process.platform;
      // Default workspace parent: ~/code if it exists, else ~/dev,
      // else ~. Most operators put projects under ~/code in macOS / Linux.
      const candidates = [`${home}/code`, `${home}/dev`, `${home}/projects`];
      let defaultWorkspaceParent = home;
      for (const c of candidates) {
        try {
          if (existsSync(c)) { defaultWorkspaceParent = c; break; }
        } catch { /* ignore */ }
      }
      return jsonResponse(res, 200, {
        homedir: home,
        hostname,
        username,
        platform,
        defaultWorkspaceParent,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(res, 500, { error: `host info failed: ${msg}` });
    }
  }

  // POST /api/context-graph/subscribe (V10) or /api/subscribe (legacy)
  if (
    req.method === "POST" &&
    (path === "/api/context-graph/subscribe" || path === "/api/subscribe")
  ) {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const parsed = JSON.parse(body);
    const { includeWorkspace, includeSharedMemory } = parsed;
    const paranetId = parsed.contextGraphId ?? parsed.paranetId;
    if (!paranetId)
      return jsonResponse(res, 400, {
        error: 'Missing "contextGraphId" (or legacy "paranetId")',
      });

    // For curated CGs, verify this node's agent is on the allowlist.
    // The allowlist may not be available locally yet (it lives on the
    // curator's node), so this is a best-effort early rejection —
    // the sync protocol enforces access on the remote side regardless.
    const localAllowed = await agent.getContextGraphAllowedAgents(paranetId).catch(() => [] as string[]);
    if (localAllowed.length > 0) {
      const callerAddr = requestAgentAddress ?? agent.getDefaultAgentAddress();
      const isEthAddress = callerAddr && /^0x[0-9a-fA-F]{40}$/.test(callerAddr);
      if (isEthAddress && !localAllowed.some((a: string) => a.toLowerCase() === callerAddr.toLowerCase())) {
        return jsonResponse(res, 403, {
          error: `Your agent (${callerAddr}) is not on the allowlist for this curated project. Ask the curator to invite you first.`,
        });
      }
    }

    const shouldSyncSharedMemory =
      (includeSharedMemory ?? includeWorkspace) !== false;
    console.log(`[subscribe] contextGraph=${paranetId} includeSharedMemory=${shouldSyncSharedMemory}`);
    agent.subscribeToContextGraph(paranetId);

    const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const job: CatchupJob = {
      jobId,
      paranetId,
      includeWorkspace: shouldSyncSharedMemory,
      status: "queued",
      queuedAt: Date.now(),
    };
    catchupTracker.jobs.set(jobId, job);
    catchupTracker.latestByParanet.set(paranetId, jobId);

    while (catchupTracker.jobs.size > 100) {
      let oldestId: string | undefined;
      let oldestQueuedAt = Number.POSITIVE_INFINITY;
      for (const [id, entry] of catchupTracker.jobs.entries()) {
        if (entry.queuedAt < oldestQueuedAt) {
          oldestQueuedAt = entry.queuedAt;
          oldestId = id;
        }
      }
      if (!oldestId) break;
      const removed = catchupTracker.jobs.get(oldestId);
      catchupTracker.jobs.delete(oldestId);
      if (
        removed &&
        catchupTracker.latestByParanet.get(removed.paranetId) === oldestId
      ) {
        catchupTracker.latestByParanet.delete(removed.paranetId);
      }
    }

    void (async () => {
      job.status = "running";
      job.startedAt = Date.now();
      if (DEBUG_SYNC_TRACE) console.log(`[catchup] job=${jobId} contextGraph=${paranetId} started`);
      try {
        const result = await daemonState.catchupRunner!.run({
          contextGraphId: paranetId,
          includeSharedMemory: shouldSyncSharedMemory,
        });
        job.result = result;
        job.status = "done";

        const d = result.diagnostics?.durable;
        const s = result.diagnostics?.sharedMemory;
        const cleanResponse =
          result.dataSynced > 0 ||
          result.sharedMemorySynced > 0 ||
          (d?.emptyResponses ?? 0) > 0 ||
          (d?.metaOnlyResponses ?? 0) > 0 ||
          (s?.emptyResponses ?? 0) > 0;
        const servedByPeer =
          result.dataSynced > 0 ||
          result.sharedMemorySynced > 0 ||
          (d?.insertedMetaTriples ?? 0) > 0 ||
          (s?.insertedMetaTriples ?? 0) > 0 ||
          (d?.metaOnlyResponses ?? 0) > 0;
        if (result.denied && !servedByPeer) {
          job.status = "denied";
          job.error = result.deniedPeers > 1 ? `Sync denied by ${result.deniedPeers} remote peers` : "Sync denied by remote peer";
          if (DEBUG_SYNC_TRACE) console.log(`[catchup] job=${jobId} contextGraph=${paranetId} denied by remote peer(s): ${result.deniedPeers}`);
        }

        if (job.status === "done") {
          if (cleanResponse) {
            const subMap = (agent as any).subscribedContextGraphs as
              | Map<string, { subscribed: boolean; synced: boolean; metaSynced?: boolean; name?: string; [k: string]: unknown }>
              | undefined;
            const sub = subMap?.get(paranetId);
            if (sub) {
              sub.synced = true;
              const hasContent = await agent.contextGraphHasLocalContent(paranetId).catch(() => false);
              if (hasContent) sub.metaSynced = true;
            }
          } else if (result.peersTried > 0) {
            job.status = "failed";
            job.error = "Sync did not complete — all reachable peers failed (timeouts or transport errors). Retry once the network is healthier.";
          } else if (result.connectedPeers > 0 && result.syncCapablePeers === 0) {
            job.status = "failed";
            job.error = "No sync-capable peers found for catch-up";
          }

          if (DEBUG_SYNC_TRACE) {
            console.log(
              `[catchup] job=${jobId} contextGraph=${paranetId} status=${job.status} ` +
                `peers=${result.peersTried}/${result.syncCapablePeers} connected=${result.connectedPeers} ` +
                `data=${result.dataSynced} swm=${result.sharedMemorySynced} denied=${result.denied}`,
            );
          }
        }
      } catch (err) {
        job.error = err instanceof Error ? err.message : String(err);
        job.status = "failed";
        if (DEBUG_SYNC_TRACE) console.log(`[catchup] job=${jobId} contextGraph=${paranetId} threw: ${job.error}`);
      } finally {
        job.finishedAt = Date.now();
      }
    })();

    return jsonResponse(res, 200, {
      subscribed: paranetId,
      catchup: {
        status: "queued",
        includeWorkspace: shouldSyncSharedMemory,
        jobId,
      },
    });
  }

  // GET /api/sync/catchup-status?contextGraphId=<id> | ?paranetId=<id> | ?jobId=<id>
  if (req.method === "GET" && path === "/api/sync/catchup-status") {
    const paranetId =
      url.searchParams.get("contextGraphId") ??
      url.searchParams.get("paranetId");
    const jobIdParam = url.searchParams.get("jobId");
    if (!paranetId && !jobIdParam) {
      return jsonResponse(res, 400, {
        error:
          'Missing "contextGraphId" (or "paranetId") or "jobId" query param',
      });
    }

    const jobId =
      jobIdParam ??
      (paranetId ? catchupTracker.latestByParanet.get(paranetId) : undefined);
    if (!jobId) {
      return jsonResponse(res, 404, { error: "No catch-up job found" });
    }
    const job = catchupTracker.jobs.get(jobId);
    if (!job) {
      return jsonResponse(res, 404, {
        error: `Catch-up job "${jobId}" not found`,
      });
    }

    return jsonResponse(res, 200, toCatchupStatusResponse(job));
  }

  // POST /api/paranet/create (legacy) — create a context graph definition
  // V10 route /api/context-graph/create is handled above (combined with on-chain context graph create).
  if (req.method === "POST" && path === "/api/paranet/create") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const { id, name, description, allowedAgents, accessPolicy } = JSON.parse(body);
    if (!id || !name)
      return jsonResponse(res, 400, { error: 'Missing "id" or "name"' });
    await agent.createContextGraph({
      id,
      name,
      description,
      callerAgentAddress: requestAgentAddress,
      ...(Array.isArray(allowedAgents) ? { allowedAgents } : {}),
      ...(typeof accessPolicy === 'number' ? { accessPolicy } : {}),
    });
    return jsonResponse(res, 200, {
      created: id,
      uri: `did:dkg:context-graph:${id}`,
    });
  }

  // POST /api/context-graph/rename (or /api/paranet/rename)
  //
  // Updates the display name (schema:name) of an existing context graph
  // without touching any of its data. Delegates to `agent.renameContextGraph`
  // which (a) enforces owner-only authorization via `assertCallerIsOwner`
  // (same protection as add/remove-participant), (b) wipes old name triples
  // from both the ONTOLOGY graph and the CG `_meta` graph, and (c) writes
  // the new name into both so the rename is durable for open AND private
  // CGs (private curated graphs read their definition from `_meta`).
  if (
    req.method === "POST" &&
    (path === "/api/context-graph/rename" || path === "/api/paranet/rename")
  ) {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const { id, name } = JSON.parse(body);
    if (!id || !name) {
      return jsonResponse(res, 400, { error: 'Missing "id" or "name"' });
    }
    try {
      await agent.renameContextGraph(id, String(name), requestAgentAddress);
      return jsonResponse(res, 200, { renamed: id, name });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/Only the context graph creator/.test(msg)) {
        return jsonResponse(res, 403, { error: msg });
      }
      if (/does not exist|has no known creator|non-empty string/.test(msg)) {
        return jsonResponse(res, 400, { error: msg });
      }
      return jsonResponse(res, 500, {
        error: `Failed to rename context graph: ${msg}`,
      });
    }
  }

  // GET /api/context-graph/list (V10) or /api/paranet/list (legacy)
  if (
    req.method === "GET" &&
    (path === "/api/context-graph/list" || path === "/api/paranet/list")
  ) {
    const contextGraphs = await agent.listContextGraphs();
    return jsonResponse(res, 200, {
      contextGraphs,
      paranets: contextGraphs, // backward compat
    });
  }

  // GET /api/local-agent-integrations — generic local agent registry/status surface
  if (req.method === 'GET' && path === '/api/local-agent-integrations') {
    return jsonResponse(res, 200, {
      integrations: listLocalAgentIntegrations(config),
    });
  }

  // GET /api/local-agent-integrations/:id — single local agent integration status
  if (req.method === 'GET' && path.startsWith('/api/local-agent-integrations/')) {
    const id = path.slice('/api/local-agent-integrations/'.length);
    if (!id) return jsonResponse(res, 404, { error: 'Integration not found' });
    const integration = getLocalAgentIntegration(config, id);
    if (!integration) return jsonResponse(res, 404, { error: `Unknown integration: ${id}` });
    return jsonResponse(res, 200, { integration });
  }

  // POST /api/local-agent-integrations/connect — upsert/connect an integration
  if (req.method === 'POST' && path === '/api/local-agent-integrations/connect') {
    const body = await readBody(req, SMALL_BODY_BYTES);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(body); } catch { return jsonResponse(res, 400, { error: 'Invalid JSON body' }); }
    try {
      const source = isPlainRecord(parsed.metadata) && typeof parsed.metadata.source === 'string'
        ? parsed.metadata.source
        : undefined;
      const result = source === 'node-ui'
        ? await connectLocalAgentIntegrationFromUi(config, parsed, bridgeAuthToken, { saveConfig })
        : { integration: connectLocalAgentIntegration(config, parsed) };
      await saveConfig(config);
      return jsonResponse(res, 200, { ok: true, integration: result.integration, notice: result.notice });
    } catch (err: any) {
      try { await saveConfig(config); } catch { /* best effort: preserve failed attach state when available */ }
      return jsonResponse(res, 400, { error: err?.message ?? 'Invalid local agent integration payload' });
    }
  }

  // POST /api/local-agent-integrations/:id/refresh — re-probe bridge health (OpenClaw) or
  // return the current record (other integrations that don't yet have a bridge).
  if (
    req.method === 'POST'
    && path.startsWith('/api/local-agent-integrations/')
    && path.endsWith('/refresh')
  ) {
    const segments = path.slice('/api/local-agent-integrations/'.length, -'/refresh'.length);
    if (!segments || segments.includes('/')) {
      return jsonResponse(res, 404, { error: 'Unknown integration' });
    }
    const rawId = decodeURIComponent(segments);
    const normalizedId = normalizeIntegrationId(rawId);
    if (!LOCAL_AGENT_INTEGRATION_DEFINITIONS[normalizedId]) {
      return jsonResponse(res, 404, { error: 'Unknown integration' });
    }
    try {
      const integration = await refreshLocalAgentIntegrationFromUi(config, normalizedId, bridgeAuthToken);
      await saveConfig(config);
      return jsonResponse(res, 200, { ok: true, integration });
    } catch (err: any) {
      return jsonResponse(res, 400, { error: err?.message ?? 'Integration refresh failed' });
    }
  }

  // PUT /api/local-agent-integrations/:id — partial update for stored integration state
  if (req.method === 'PUT' && path.startsWith('/api/local-agent-integrations/')) {
    const id = path.slice('/api/local-agent-integrations/'.length);
    if (!id) return jsonResponse(res, 404, { error: 'Integration not found' });
    const body = await readBody(req, SMALL_BODY_BYTES);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(body); } catch { return jsonResponse(res, 400, { error: 'Invalid JSON body' }); }
    try {
      const normalizedId = normalizeIntegrationId(id);
      const normalizedPatch = normalizeExplicitLocalAgentDisconnectBody(parsed);
      const explicitDisconnect = normalizedPatch.enabled === false
        && isPlainRecord(normalizedPatch.runtime)
        && normalizedPatch.runtime.status === 'disconnected';
      if (explicitDisconnect && normalizedId) {
        cancelPendingLocalAgentAttachJob(normalizedId);
      }

      if (explicitDisconnect && normalizedId === 'openclaw') {
        try {
          await reverseLocalAgentSetupForUi(config);
        } catch (err: any) {
          const integration = updateLocalAgentIntegration(config, id, {
            runtime: {
              status: 'error',
              ready: false,
              lastError: `OpenClaw disconnect failed: ${err?.message ?? 'unknown error'}`,
            },
          });
          await saveConfig(config);
          return jsonResponse(res, 200, { ok: true, integration });
        }
      }

      const integration = updateLocalAgentIntegration(config, id, normalizedPatch);
      await saveConfig(config);
      return jsonResponse(res, 200, { ok: true, integration });
    } catch (err: any) {
      return jsonResponse(res, 400, { error: err?.message ?? 'Invalid local agent integration payload' });
    }
  }

  // GET /api/integrations — aggregated view for Integrations panel
  if (req.method === 'GET' && path === '/api/integrations') {
    const [skills, paranets] = await Promise.all([agent.findSkills(), agent.listContextGraphs()]);
    const localAgentIntegrations = listLocalAgentIntegrations(config);
    const adapters = localAgentIntegrations.map((integration) => ({
      id: integration.id,
      name: integration.name,
      enabled: integration.enabled,
      description: integration.description,
      status: integration.status,
      capabilities: integration.capabilities,
    }));
    return jsonResponse(res, 200, { adapters, localAgentIntegrations, skills, paranets });
  }

  // POST /api/register-adapter — legacy OpenClaw alias for /api/local-agent-integrations/connect
  if (req.method === 'POST' && path === '/api/register-adapter') {
    const body = await readBody(req, SMALL_BODY_BYTES);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(body); } catch { return jsonResponse(res, 400, { error: 'Invalid JSON body' }); }
    if (parsed.id !== undefined && parsed.id !== 'openclaw') {
      return jsonResponse(res, 400, { error: `Unknown adapter id: ${String(parsed.id)}` });
    }
    try {
      const integration = connectLocalAgentIntegration(config, {
        ...parsed,
        id: parsed.id ?? 'openclaw',
        capabilities: {
          localChat: true,
          connectFromUi: true,
          installNode: true,
          dkgPrimaryMemory: true,
          wmImportPipeline: true,
          nodeServedSkill: true,
          ...(isPlainRecord(parsed.capabilities) ? parsed.capabilities : {}),
        },
      });
      await saveConfig(config);
      return jsonResponse(res, 200, { ok: true, integration });
    } catch (err: any) {
      return jsonResponse(res, 400, { error: err?.message ?? 'Invalid JSON body' });
    }
  }

  // GET /api/context-graph/exists (V10) or /api/paranet/exists (legacy)
  if (
    req.method === "GET" &&
    (path === "/api/context-graph/exists" || path === "/api/paranet/exists")
  ) {
    const id = url.searchParams.get("id");
    if (!id)
      return jsonResponse(res, 400, { error: 'Missing "id" query param' });
    const exists = await agent.contextGraphExists(id);
    return jsonResponse(res, 200, { id, exists });
  }

  // POST /api/verify
  if (req.method === "POST" && path === "/api/verify") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const {
      contextGraphId,
      verifiedMemoryId,
      batchId,
      timeoutMs,
      requiredSignatures,
    } = JSON.parse(body);
    if (!contextGraphId || !verifiedMemoryId || !batchId) {
      return jsonResponse(res, 400, {
        error: "Missing contextGraphId, verifiedMemoryId, or batchId",
      });
    }
    const parsedSigs = parseRequiredSignatures(requiredSignatures);
    if ("error" in parsedSigs) {
      return jsonResponse(res, 400, { error: parsedSigs.error });
    }
    const validatedRequiredSigs = parsedSigs.value || undefined;
    const result = await agent.verify({
      contextGraphId,
      verifiedMemoryId,
      batchId: BigInt(batchId),
      timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
      requiredSignatures: validatedRequiredSigs,
    });
    return jsonResponse(res, 200, { ...result, batchId: String(batchId) });
  }

  // POST /api/endorse
  if (req.method === "POST" && path === "/api/endorse") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const parsed = JSON.parse(body);
    const { contextGraphId, ual } = parsed;
    if (!contextGraphId || !ual) {
      return jsonResponse(res, 400, {
        error: "Missing contextGraphId or ual",
      });
    }
    // A-12 review: the endorser MUST come from the authenticated bearer
    // token, not from the request body. Trusting body.agentAddress let
    // any caller with node access publish endorsements as an arbitrary
    // `did:dkg:agent:0x...`, forging provenance. `requestAgentAddress`
    // is the token-resolved identity. If the body also includes
    // `agentAddress`, it must match or we reject with 403. The
    // registered-local-agent check is implicit: resolveAgentAddress
    // returns either the token's agent (if it's an agent-scoped
    // token) or `defaultAgentAddress` (the node's own auto-registered
    // agent). Both are owned by this node by construction.
    // Defence in depth: an unauthenticated caller has no agent identity
    // to attribute an endorsement to. Early return 401 rather than
    // attempting `.toLowerCase()` on a null/undefined address.
    if (!requestAgentAddress) {
      return jsonResponse(res, 401, {
        error:
          "Endorsement requires an authenticated agent. Provide a bearer token tied to a registered agent.",
      });
    }
    const bodyAgentAddress = typeof parsed.agentAddress === 'string' ? parsed.agentAddress : undefined;
    if (
      bodyAgentAddress &&
      bodyAgentAddress.toLowerCase() !== requestAgentAddress.toLowerCase()
    ) {
      return jsonResponse(res, 403, {
        error:
          `Endorser mismatch: authenticated as ${requestAgentAddress} but request body claims ${bodyAgentAddress}. ` +
          `The endorser is resolved from the bearer token; omit body.agentAddress or use the matching agent's token.`,
      });
    }
    const result = await agent.endorse({
      contextGraphId,
      knowledgeAssetUal: ual,
      agentAddress: requestAgentAddress,
    });
    return jsonResponse(res, 200, {
      endorsed: true,
      endorserAddress: requestAgentAddress,
      ...result,
    });
  }

  // POST /api/ccl/policy/publish
  if (req.method === "POST" && path === "/api/ccl/policy/publish") {
    const body = await readBody(req, SMALL_BODY_BYTES * 4);
    const {
      paranetId,
      name,
      version,
      content,
      description,
      contextType,
      language,
      format,
    } = JSON.parse(body);
    if (!paranetId || !name || !version || !content) {
      return jsonResponse(res, 400, {
        error: "Missing required fields: paranetId, name, version, content",
      });
    }
    const result = await agent.publishCclPolicy({
      paranetId,
      name,
      version,
      content,
      description,
      contextType,
      language,
      format,
    });
    return jsonResponse(res, 200, result);
  }

  // POST /api/ccl/policy/approve
  if (req.method === "POST" && path === "/api/ccl/policy/approve") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const { paranetId, policyUri, contextType } = JSON.parse(body);
    if (!paranetId || !policyUri) {
      return jsonResponse(res, 400, {
        error: "Missing required fields: paranetId, policyUri",
      });
    }
    try {
      const result = await agent.approveCclPolicy({
        paranetId,
        policyUri,
        contextType,
        callerAgentAddress: requestAgentAddress,
      });
      return jsonResponse(res, 200, result);
    } catch (err: any) {
      const msg = err?.message ?? "";
      if (/Only the paranet owner can manage policies/.test(msg)) {
        return jsonResponse(res, 403, { error: msg });
      }
      throw err;
    }
  }

  // POST /api/ccl/policy/revoke
  if (req.method === "POST" && path === "/api/ccl/policy/revoke") {
    const body = await readBody(req, SMALL_BODY_BYTES);
    const { paranetId, policyUri, contextType } = JSON.parse(body);
    if (!paranetId || !policyUri) {
      return jsonResponse(res, 400, {
        error: "Missing required fields: paranetId, policyUri",
      });
    }
    try {
      const result = await agent.revokeCclPolicy({
        paranetId,
        policyUri,
        contextType,
        callerAgentAddress: requestAgentAddress,
      });
      return jsonResponse(res, 200, result);
    } catch (err: any) {
      const msg = err?.message ?? "";
      if (/Only the paranet owner can manage policies/.test(msg)) {
        return jsonResponse(res, 403, { error: msg });
      }
      throw err;
    }
  }

  // GET /api/ccl/policy/list
  if (req.method === "GET" && path === "/api/ccl/policy/list") {
    const policies = await agent.listCclPolicies({
      paranetId: url.searchParams.get("paranetId") ?? undefined,
      name: url.searchParams.get("name") ?? undefined,
      contextType: url.searchParams.get("contextType") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      includeBody: url.searchParams.get("includeBody") === "true",
    });
    return jsonResponse(res, 200, { policies });
  }

  // GET /api/ccl/policy/resolve?paranetId=&name=&contextType=
  if (req.method === "GET" && path === "/api/ccl/policy/resolve") {
    const paranetId = url.searchParams.get("paranetId");
    const name = url.searchParams.get("name");
    if (!paranetId || !name) {
      return jsonResponse(res, 400, {
        error: "Missing required query params: paranetId, name",
      });
    }
    const policy = await agent.resolveCclPolicy({
      paranetId,
      name,
      contextType: url.searchParams.get("contextType") ?? undefined,
      includeBody: url.searchParams.get("includeBody") === "true",
    });
    return jsonResponse(res, 200, { policy });
  }

  // POST /api/ccl/eval
  if (req.method === "POST" && path === "/api/ccl/eval") {
    const body = await readBody(req, SMALL_BODY_BYTES * 8);
    const {
      paranetId,
      name,
      facts,
      contextType,
      view,
      snapshotId,
      scopeUal,
      publishResult,
    } = JSON.parse(body);
    if (!paranetId || !name) {
      return jsonResponse(res, 400, {
        error: "Missing required fields: paranetId, name",
      });
    }
    if (facts != null && !Array.isArray(facts)) {
      return jsonResponse(res, 400, {
        error: "facts must be an array when provided",
      });
    }
    const result = publishResult
      ? await agent.evaluateAndPublishCclPolicy({
          paranetId,
          name,
          facts,
          contextType,
          view,
          snapshotId,
          scopeUal,
        })
      : await agent.evaluateCclPolicy({
          paranetId,
          name,
          facts,
          contextType,
          view,
          snapshotId,
          scopeUal,
        });
    return jsonResponse(res, 200, result);
  }

  // GET /api/ccl/results?paranetId=&...
  if (req.method === "GET" && path === "/api/ccl/results") {
    const paranetId = url.searchParams.get("paranetId");
    if (!paranetId) {
      return jsonResponse(res, 400, {
        error: "Missing required query param: paranetId",
      });
    }
    const evaluations = await agent.listCclEvaluations({
      paranetId,
      policyUri: url.searchParams.get("policyUri") ?? undefined,
      snapshotId: url.searchParams.get("snapshotId") ?? undefined,
      view: url.searchParams.get("view") ?? undefined,
      contextType: url.searchParams.get("contextType") ?? undefined,
      resultKind:
        (url.searchParams.get("resultKind") as "derived" | "decision" | null) ??
        undefined,
      resultName: url.searchParams.get("resultName") ?? undefined,
    });
    return jsonResponse(res, 200, { evaluations });
  }

  // GET /api/wallets (list addresses only)
  if (
    req.method === "GET" &&
    (path === "/api/wallet" || path === "/api/wallets")
  ) {
    return jsonResponse(res, 200, {
      wallets: opWallets.wallets.map((w) => w.address),
      chainId: (config.chain ?? network?.chain)?.chainId,
    });
  }

  // GET /api/wallets/balances — ETH + TRAC per wallet, RPC health
  if (req.method === "GET" && path === "/api/wallets/balances") {
    const chain = config.chain ?? network?.chain;
    const rpcUrl = chain?.rpcUrl;
    const hubAddress = chain?.hubAddress;
    const chainId = chain?.chainId ?? null;
    if (!rpcUrl || !hubAddress || !opWallets.wallets.length) {
      return jsonResponse(res, 200, {
        wallets: [],
        balances: [],
        chainId,
        rpcUrl: rpcUrl ?? null,
        error: !rpcUrl || !hubAddress ? "Chain not configured" : "No wallets",
      });
    }
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const hub = new ethers.Contract(
        hubAddress,
        ["function getContractAddress(string) view returns (address)"],
        provider,
      );
      const tokenAddr = await hub.getContractAddress("Token").catch(() => null);
      let token: ethers.Contract | null = null;
      let tokenSymbol = "TRAC";
      if (tokenAddr && tokenAddr !== ethers.ZeroAddress) {
        token = new ethers.Contract(
          tokenAddr,
          [
            "function balanceOf(address) view returns (uint256)",
            "function symbol() view returns (string)",
          ],
          provider,
        );
        tokenSymbol = await token.symbol().catch(() => "TRAC");
      }
      const balances: Array<{
        address: string;
        eth: string;
        trac: string;
        symbol: string;
      }> = [];
      for (const w of opWallets.wallets) {
        const ethBal = await provider.getBalance(w.address);
        const tracBal = token ? await token.balanceOf(w.address) : 0n;
        balances.push({
          address: w.address,
          eth: ethers.formatEther(ethBal),
          trac: ethers.formatEther(tracBal),
          symbol: tokenSymbol,
        });
      }
      return jsonResponse(res, 200, {
        wallets: opWallets.wallets.map((w) => w.address),
        balances,
        chainId,
        rpcUrl,
        symbol: tokenSymbol,
      });
    } catch (err: any) {
      return jsonResponse(res, 200, {
        wallets: opWallets.wallets.map((w) => w.address),
        balances: [],
        chainId,
        rpcUrl,
        error: err.message,
      });
    }
  }

  // GET /api/chain/rpc-health
  if (req.method === "GET" && path === "/api/chain/rpc-health") {
    const chain = config.chain ?? network?.chain;
    const rpcUrl = chain?.rpcUrl;
    if (!rpcUrl) {
      return jsonResponse(res, 200, {
        ok: false,
        rpcUrl: null,
        latencyMs: null,
        blockNumber: null,
        error: "Chain not configured",
      });
    }
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const start = Date.now();
      const blockNumber = await provider.getBlockNumber();
      const latencyMs = Date.now() - start;
      return jsonResponse(res, 200, {
        ok: true,
        rpcUrl,
        latencyMs,
        blockNumber,
      });
    } catch (err: any) {
      return jsonResponse(res, 200, {
        ok: false,
        rpcUrl,
        latencyMs: null,
        blockNumber: null,
        error: err.message,
      });
    }
  }

  // GET /api/identity — current on-chain identity status
  if (req.method === "GET" && path === "/api/identity") {
    const identityId = agent.publisher.getIdentityId();
    return jsonResponse(res, 200, {
      identityId: String(identityId),
      hasIdentity: identityId > 0n,
    });
  }

  // POST /api/identity/ensure — (re)attempt on-chain identity creation
  if (req.method === "POST" && path === "/api/identity/ensure") {
    try {
      const identityId = await agent.ensureIdentity();
      return jsonResponse(res, 200, {
        identityId: String(identityId),
        hasIdentity: identityId > 0n,
      });
    } catch (err: any) {
      return jsonResponse(res, 500, {
        error: err.message,
        identityId: "0",
        hasIdentity: false,
      });
    }
  }

  // POST /api/shutdown
  if (req.method === "POST" && path === "/api/shutdown") {
    jsonResponse(res, 200, { ok: true });
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 100);
    return;
  }

  // GET /api/epcis/events?epc=...&bizStep=...&from=...&to=...&limit=100&offset=0
  if (req.method === "GET" && path === "/api/epcis/events") {
    const epcisContextGraphId =
      config.epcis?.contextGraphId ?? config.epcis?.paranetId;
    if (!epcisContextGraphId) {
      return jsonResponse(res, 503, {
        error:
          "EPCIS plugin is not configured (missing epcis.contextGraphId in config)",
      });
    }
    const searchParams = new URL(req.url!, `http://${req.headers.host}`)
      .searchParams;
    const epcisQueryEngine = {
      query: (sparql: string, opts?: { contextGraphId?: string }) =>
        agent.query(sparql, opts),
    };
    try {
      const result = await handleEventsQuery(searchParams, {
        contextGraphId: epcisContextGraphId,
        queryEngine: epcisQueryEngine,
        basePath: "/api/epcis/events",
      });
      if (result.headers?.link) {
        res.setHeader("Link", result.headers.link);
      }
      return jsonResponse(res, 200, result.body);
    } catch (err) {
      if (err instanceof EpcisQueryError) {
        return jsonResponse(res, err.statusCode, { error: err.message });
      }
      throw err;
    }
  }

  // POST /api/epcis/capture  { epcisDocument: {...}, publishOptions?: { accessPolicy? } }
  if (req.method === "POST" && path === "/api/epcis/capture") {
    const captureContextGraphId =
      config.epcis?.contextGraphId ?? config.epcis?.paranetId;
    if (!captureContextGraphId) {
      return jsonResponse(res, 503, {
        error:
          "EPCIS plugin is not configured (missing epcis.contextGraphId in config)",
      });
    }
    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON in request body" });
    }
    const { epcisDocument, publishOptions } = parsed;
    if (!epcisDocument) {
      return jsonResponse(res, 400, {
        error: 'Missing "epcisDocument" in request body',
      });
    }
    const epcisPublisher: EpcisPublisher = {
      async publish(contextGraphId, content, opts) {
        const result = await agent.publish(
          contextGraphId,
          { public: content } as Record<string, unknown>,
          opts,
        );
        return {
          ual: result.ual,
          kcId: String(result.kcId),
          status: result.status,
        };
      },
    };
    try {
      const result = await handleCapture(
        { epcisDocument, publishOptions },
        { contextGraphId: captureContextGraphId, publisher: epcisPublisher },
      );
      // TODO: EPCIS 2.0 §12.6.1 requires 202 Accepted + captureID for async job tracking.
      // Current sync model returns 200 with the full result. Switch to 202 + captureID +
      // GET /capture/{captureID} polling endpoint when async capture is implemented (Phase 2).
      return jsonResponse(res, 200, result);
    } catch (err) {
      if (err instanceof EpcisValidationError) {
        return jsonResponse(res, 400, {
          error: err.message,
          details: err.errors,
        });
      }
      throw err;
    }
  }

  // POST /api/memory/turn — ingest a conversation turn as a tri-modal Knowledge Asset.
  //
  // Streamlined path for agent memory: accepts a markdown conversation turn,
  // stores it in the file store, runs structural + optional semantic extraction,
  // and writes the resulting triples to SWM (or WM if layer=wm).
  //
  // Spec: 21_TRI_MODAL_MEMORY.md §8
  if (req.method === 'POST' && path === '/api/memory/turn') {
    const body = await readBody(req);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;

    const { markdown, contextGraphId, sessionUri, layer, subGraphName } = parsed;
    if (!markdown || typeof markdown !== 'string') {
      return jsonResponse(res, 400, { error: 'Missing or invalid "markdown" field (string)' });
    }
    if (!validateRequiredContextGraphId(contextGraphId, res)) return;
    if (!validateOptionalSubGraphName(subGraphName, res)) return;

    const targetLayer = layer === 'wm' ? 'wm' : 'swm';
    const agentDid = `did:dkg:agent:${agent.peerId}`;
    const now = new Date().toISOString();

    // 1. Store markdown in the file store
    const mdBytes = Buffer.from(markdown, 'utf-8');
    let fileEntry;
    try {
      fileEntry = await fileStore.put(mdBytes, 'text/markdown');
    } catch (err: any) {
      return jsonResponse(res, 500, { error: `Failed to store turn markdown: ${err.message}` });
    }
    const fileUri = `urn:dkg:file:${fileEntry.keccak256}`;

    // Derive turn URI from agent address + timestamp for collision avoidance
    const turnUri = `did:dkg:context-graph:${contextGraphId}/turn/${agent.peerId}-${now}`;

    // 2. Run structural extraction
    let extractResult;
    try {
      extractResult = extractFromMarkdown({
        markdown,
        agentDid,
        documentIri: turnUri,
        sourceFileIri: fileUri,
      });
    } catch (err: any) {
      return jsonResponse(res, 500, { error: `Structural extraction failed: ${err.message}` });
    }

    // 3. Run semantic extraction (optional, best-effort)
    let semanticTriples: Array<{ subject: string; predicate: string; object: string }> = [];
    if (config.llm?.apiKey) {
      try {
        const llmResult = await extractWithLlm(
          { markdown, agentDid, documentIri: turnUri },
          config.llm,
        );
        semanticTriples = llmResult.triples;
      } catch {
        // Semantic extraction is best-effort — structural extraction alone is sufficient
      }
    }

    // 4. Build quads for the target graph
    const targetGraph = targetLayer === 'swm'
      ? contextGraphSharedMemoryUri(contextGraphId, subGraphName)
      : contextGraphAssertionUri(contextGraphId, requestAgentAddress, `turn-${now}`, subGraphName);

    const quads: Array<{ subject: string; predicate: string; object: string; graph: string }> = [];

    // Content triples from structural extraction
    for (const t of extractResult.triples) {
      quads.push({ ...t, graph: targetGraph });
    }
    // Source-file linkage from extractor (rows 1 + 3)
    for (const t of extractResult.sourceFileLinkage) {
      quads.push({ ...t, graph: targetGraph });
    }
    // Semantic triples (if any)
    for (const t of semanticTriples) {
      quads.push({ ...t, graph: targetGraph });
    }

    // Ensure the turn is typed as a ConversationTurn
    quads.push({
      subject: turnUri,
      predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
      object: 'http://schema.org/ConversationTurn',
      graph: targetGraph,
    });
    // Persist the markdown body so the UI can display turn content
    // without fetching the source file separately
    const truncatedBody = markdown.length > 2000 ? markdown.slice(0, 2000) + '…' : markdown;
    quads.push({
      subject: turnUri,
      predicate: 'http://schema.org/description',
      object: JSON.stringify(truncatedBody),
      graph: targetGraph,
    });
    // Source content type
    quads.push({
      subject: turnUri,
      predicate: 'http://dkg.io/ontology/sourceContentType',
      object: JSON.stringify('text/markdown'),
      graph: targetGraph,
    });
    // Agent attribution
    quads.push({
      subject: turnUri,
      predicate: 'http://schema.org/agent',
      object: agentDid,
      graph: targetGraph,
    });
    // Timestamp
    quads.push({
      subject: turnUri,
      predicate: 'http://schema.org/dateCreated',
      object: `"${now}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`,
      graph: targetGraph,
    });

    // Session linking (if session URI provided)
    if (sessionUri && typeof sessionUri === 'string') {
      quads.push({
        subject: turnUri,
        predicate: 'http://schema.org/isPartOf',
        object: sessionUri,
        graph: targetGraph,
      });
      quads.push({
        subject: sessionUri,
        predicate: 'http://schema.org/hasPart',
        object: turnUri,
        graph: targetGraph,
      });
    }

    // 5. Write to target layer
    try {
      if (targetLayer === 'swm') {
        // agent.share sets the graph field itself — pass quads with empty graph
        const shareQuads = quads.map(({ subject, predicate, object }) => ({ subject, predicate, object, graph: '' }));
        const ctx = createOperationContext('share');
        tracker.start(ctx, { contextGraphId, details: { tripleCount: shareQuads.length, source: 'memory-turn', subGraphName } });
        try {
          await tracker.trackPhase(ctx, 'store', () =>
            agent.share(contextGraphId, shareQuads, { subGraphName, localOnly: false, operationCtx: ctx }),
          );
          tracker.complete(ctx, { tripleCount: shareQuads.length });
        } catch (err: any) {
          tracker.fail(ctx, err);
          throw err;
        }
      } else {
        await agent.store.insert(quads);
      }
    } catch (err: any) {
      return jsonResponse(res, 500, { error: `Failed to write turn to ${targetLayer}: ${err.message}` });
    }

    // 6. Generate embedding (best-effort, non-blocking for response)
    let embeddingId: string | null = null;
    if (embeddingProvider) {
      try {
        const snippet = markdown.length > 500 ? markdown.slice(0, 500) + '...' : markdown;
        const embedding = await embeddingProvider.embed(markdown);
        embeddingId = await vectorStore.insert({
          embedding,
          sourceUri: fileUri,
          entityUri: turnUri,
          contextGraphId,
          memoryLayer: targetLayer,
          model: embeddingProvider.model,
          snippet,
          label: extractResult.subjectIri,
        });
      } catch {
        // Embedding generation is best-effort
      }
    }

    return jsonResponse(res, 200, {
      turnUri,
      fileHash: fileEntry.keccak256,
      layer: targetLayer,
      graph: targetGraph,
      structuralTripleCount: extractResult.triples.length,
      semanticTripleCount: semanticTriples.length,
      totalQuads: quads.length,
      embeddingId,
      sessionUri: sessionUri ?? null,
    });
  }

  // POST /api/memory/search — tri-modal search across text, graph, and vector stores.
  //
  // Fans out the query to SPARQL (triple store), text search (file store),
  // and vector similarity (vector store), then merges and deduplicates results.
  //
  // Spec: 21_TRI_MODAL_MEMORY.md §7
  if (req.method === 'POST' && path === '/api/memory/search') {
    const body = await readBody(req);
    const parsed = safeParseJson(body, res);
    if (!parsed) return;

    const { query, contextGraphId, limit: rawLimit } = parsed;
    if (!query || typeof query !== 'string') {
      return jsonResponse(res, 400, { error: 'Missing or invalid "query" field (string)' });
    }
    if (!validateRequiredContextGraphId(contextGraphId, res)) return;

    const resultLimit = typeof rawLimit === 'number' && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
    const memoryLayers: Array<'swm' | 'vm'> = parsed.memoryLayers ?? ['swm', 'vm'];

    const results: Array<{
      entityUri: string;
      label: string | null;
      sources: string[];
      similarity: number | null;
      sourceFile: string | null;
      snippet: string | null;
      memoryLayer: string | null;
    }> = [];
    const seen = new Map<string, number>();

    // Fan-out 1: Vector search
    if (embeddingProvider) {
      try {
        const queryEmbedding = await embeddingProvider.embed(query);
        const vectorResults = await vectorStore.search(queryEmbedding, {
          contextGraphId,
          memoryLayers,
          limit: resultLimit,
          minSimilarity: 0.3,
        });
        for (const vr of vectorResults) {
          const idx = results.length;
          seen.set(vr.entityUri, idx);
          results.push({
            entityUri: vr.entityUri,
            label: vr.label,
            sources: ['vector'],
            similarity: Math.round(vr.similarity * 1000) / 1000,
            sourceFile: vr.sourceUri,
            snippet: vr.snippet,
            memoryLayer: vr.memoryLayer,
          });
        }
      } catch {
        // Vector search failure is non-fatal
      }
    }

    // Fan-out 2: SPARQL text search (scoped to the requested CG + layers)
    const escapedQuery = query.replace(/"/g, '\\"').toLowerCase();
    const cgUri = `did:dkg:context-graph:${contextGraphId}`;
    const graphFilters = memoryLayers.map((l: string) => {
      if (l === 'swm') return `STRSTARTS(STR(?g), "${cgUri}/_shared_memory")`;
      if (l === 'vm') return `STRSTARTS(STR(?g), "${cgUri}/_verified")`;
      return `STRSTARTS(STR(?g), "${cgUri}/")`;
    }).join(' || ');
    try {
      const sparqlResult = await agent.store.query(`
        SELECT DISTINCT ?entity ?name ?desc WHERE {
          GRAPH ?g {
            ?entity <http://schema.org/name>|<http://www.w3.org/2000/01/rdf-schema#label> ?name .
            OPTIONAL { ?entity <http://schema.org/description> ?desc }
          }
          FILTER(${graphFilters})
          FILTER(
            CONTAINS(LCASE(STR(?name)), "${escapedQuery}")
            || (BOUND(?desc) && CONTAINS(LCASE(STR(?desc)), "${escapedQuery}"))
          )
        }
        LIMIT ${resultLimit}
      `);
      if (sparqlResult.type === 'bindings') {
        for (const binding of sparqlResult.bindings) {
          const uri = binding.entity;
          const label = binding.name ?? null;
          const snippet = binding.desc ?? null;
          if (seen.has(uri)) {
            const idx = seen.get(uri)!;
            if (!results[idx].sources.includes('sparql')) {
              results[idx].sources.push('sparql');
            }
          } else {
            const idx = results.length;
            seen.set(uri, idx);
            results.push({
              entityUri: uri,
              label,
              sources: ['sparql'],
              similarity: null,
              sourceFile: null,
              snippet,
              memoryLayer: null,
            });
          }
        }
      }
    } catch {
      // SPARQL search failure is non-fatal
    }

    // Sort: vector-matched results first (by similarity), then SPARQL-only
    results.sort((a, b) => {
      if (a.similarity !== null && b.similarity !== null) return b.similarity - a.similarity;
      if (a.similarity !== null) return -1;
      if (b.similarity !== null) return 1;
      return 0;
    });

    return jsonResponse(res, 200, {
      query,
      contextGraphId,
      resultCount: results.length,
      results: results.slice(0, resultLimit),
    });
  }

  jsonResponse(res, 404, { error: 'Not found' });
}
