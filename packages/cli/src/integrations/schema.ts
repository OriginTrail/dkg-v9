// TypeScript shape of a DKG integration registry entry.
//
// Mirrors schema/integration.schema.json in OriginTrail/dkg-integrations. Only
// the fields the CLI actually consumes are typed strongly; the rest ride in
// `[unknownExtras: string]: unknown` so a schema bump in the registry doesn't
// break the CLI without a corresponding code change here.

export type TrustTier = 'community' | 'verified' | 'featured';
export type MemoryLayer = 'WM' | 'SWM' | 'VM';
export type PublicInterface = 'http-api' | 'cli' | 'mcp';

export type InstallSpec =
  | InstallCli
  | InstallMcp
  | InstallService
  | InstallAgentPlugin
  | InstallManual;

export interface InstallCli {
  kind: 'cli';
  package: string;
  version: string;
  binary: string;
  envRequired?: string[];
  usageHint?: string;
}

export interface InstallMcp {
  kind: 'mcp';
  command: string;
  args: string[];
  env?: Record<string, string>;
  clientCompatibility?: string[];
  usageHint?: string;
}

export interface InstallService {
  kind: 'service';
  runtime: 'docker' | 'npm-global';
  docker?: {
    image: string;
    digest?: string;
    ports?: Array<{ container: number; host?: number }>;
    env?: Record<string, string>;
  };
  npmGlobal?: {
    package: string;
    version: string;
    binary: string;
    env?: Record<string, string>;
  };
  usageHint?: string;
}

export interface InstallAgentPlugin {
  kind: 'agent-plugin';
  framework: string;
  package: string;
  version: string;
  registrationHint?: string;
  usageHint?: string;
}

export interface InstallManual {
  kind: 'manual';
  steps: string[];
  usageHint?: string;
}

export interface IntegrationEntry {
  slug: string;
  name: string;
  description: string;
  category?: string[];
  maintainer: { github: string; name?: string; email?: string };
  repo: string;
  commit: string;
  license: string;
  schemaVersion?: string;
  requiresDkgNodeVersion?: string;
  memoryLayers: MemoryLayer[];
  v10PrimitivesUsed: string[];
  publicInterfacesUsed: PublicInterface[];
  targetAgents?: string[];
  install: InstallSpec;
  security: {
    networkEgress?: string[];
    writeAuthority?: string[];
    credentialsHandled?: string[];
    notes?: string;
  };
  trustTier: TrustTier;
  designBrief?: string;
  demo?: string;
  promotionPath?: string;
  fitNotes?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [extras: string]: any;
}

export function isIntegrationEntry(value: unknown): value is IntegrationEntry {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.slug === 'string' &&
    typeof o.name === 'string' &&
    typeof o.trustTier === 'string' &&
    typeof o.install === 'object' &&
    o.install !== null &&
    typeof (o.install as Record<string, unknown>).kind === 'string'
  );
}
