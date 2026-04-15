import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DkgMemoryPlugin,
  DkgMemorySearchManager,
  buildDkgMemoryRuntime,
  AGENT_CONTEXT_GRAPH,
  CHAT_TURNS_ASSERTION,
  PROJECT_MEMORY_ASSERTION,
  type DkgMemorySession,
  type DkgMemorySessionResolver,
} from '../src/DkgMemoryPlugin.js';
import { DkgDaemonClient } from '../src/dkg-client.js';
import type {
  MemoryPluginCapability,
  MemoryRuntimeRequest,
  OpenClawPluginApi,
} from '../src/types.js';

type RegisterToolSpy = ReturnType<typeof vi.fn>;
type RegisterMemoryCapabilitySpy = ReturnType<typeof vi.fn>;

interface MockApi extends OpenClawPluginApi {
  registerTool: RegisterToolSpy;
  registerHook: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  registerMemoryCapability: RegisterMemoryCapabilitySpy;
}

function makeApi(): MockApi {
  // By default, stamp the workspace config to name adapter-openclaw as
  // the memory-slot owner. This represents a fully-migrated modern
  // gateway (post setup) where the slot is elected correctly. Tests that
  // need to simulate the pre-migration state (modern gateway API
  // available but slot still unset / pointing elsewhere) can override
  // this by reassigning `api.config` before calling `plugin.register`.
  // See Codex Bug B25.
  return {
    config: {
      plugins: {
        slots: {
          memory: 'adapter-openclaw',
        },
      },
    },
    registerTool: vi.fn(),
    registerHook: vi.fn(),
    on: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    registerMemoryCapability: vi.fn(),
  };
}

function makeResolver(
  overrides?: Partial<DkgMemorySession> & {
    available?: string[];
    /**
     * When set to `null`, `getDefaultAgentAddress` returns `undefined` AND
     * `getSession().agentAddress` is also undefined, simulating the node
     * peer-id probe being pending. This mirrors the real resolver in
     * `DkgNodePlugin.memorySessionResolver` where session.agentAddress is
     * always `this.nodePeerId`, so both surfaces are unresolved together.
     * Used by the B2 and B15 tests.
     */
    defaultAgentAddress?: string | null;
  },
): DkgMemorySessionResolver {
  // B43: Resolver fixtures provide a RAW peer-ID form by default,
  // mirroring the real `DkgNodePlugin.memorySessionResolver` which
  // returns `this.nodePeerId` (populated from the daemon's
  // `/api/status.peerId` field as a raw peer identifier). The
  // consumption sites (`DkgMemorySearchManager.search` for WM routing,
  // `handleImport` for the `schema:creator` triple) normalize through
  // `toAgentPeerId` / `toAgentDid` at their respective boundaries,
  // so overrides that pass a DID-form address exercise the
  // normalization guard defensively.
  const pending = overrides?.defaultAgentAddress === null;
  const defaultAgentAddress = pending
    ? undefined
    : overrides?.defaultAgentAddress ?? overrides?.agentAddress ?? 'peer-test';
  const sessionAgentAddress = pending
    ? undefined
    : overrides?.agentAddress ?? 'peer-test';
  return {
    getSession: () => ({
      projectContextGraphId: overrides?.projectContextGraphId,
      agentAddress: sessionAgentAddress,
    }),
    getDefaultAgentAddress: () => defaultAgentAddress,
    listAvailableContextGraphs: () => overrides?.available ?? [],
  };
}

describe('DkgMemoryPlugin.register', () => {
  let client: DkgDaemonClient;
  let plugin: DkgMemoryPlugin;

  beforeEach(() => {
    client = new DkgDaemonClient({ baseUrl: 'http://localhost:9200' });
    plugin = new DkgMemoryPlugin(client, { enabled: true }, makeResolver());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls api.registerMemoryCapability exactly once with a runtime factory', () => {
    const api = makeApi();
    plugin.register(api);

    expect(api.registerMemoryCapability).toHaveBeenCalledTimes(1);
    const capability = api.registerMemoryCapability.mock.calls[0][0] as MemoryPluginCapability;
    expect(typeof capability.runtime?.getMemorySearchManager).toBe('function');
  });

  it('registers only the memory slot capability, no conventional memory tools (Codex B-retire)', () => {
    // Regression guard against accidentally re-introducing
    // `dkg_memory_import` / `dkg_memory_search` on the modern-gateway
    // path. Both explicit tool surfaces were retired in the
    // openclaw-dkg-primary-memory workstream; the memory slot is the
    // single entry point for reads and writes. This test exhaustively
    // asserts that `plugin.register` does not call `api.registerTool`
    // at all — if a future change adds a memory tool by accident, this
    // fails fast instead of shipping a duplicate recall/write surface.
    const api = makeApi();
    plugin.register(api);

    expect(api.registerMemoryCapability).toHaveBeenCalledTimes(1);
    expect(api.registerTool).not.toHaveBeenCalled();
  });

  it('does not fall back to a compat memory tool on legacy gateways (Codex B-retire)', () => {
    // Complement of the modern-gateway regression guard above: on a
    // legacy gateway where `api.registerMemoryCapability` is absent,
    // the adapter must NOT fall back to a compat `dkg_memory_search`
    // tool registration. The compat surface was retired alongside
    // `dkg_memory_import`; legacy gateways get no memory surface from
    // this adapter at all (operators must upgrade the gateway to
    // restore recall). This locks down the legacy-gateway branch of
    // `registerCapability` against accidental re-introduction of a
    // fallback tool registration.
    const legacyApi = makeApi();
    (legacyApi as any).registerMemoryCapability = undefined;
    plugin.register(legacyApi);

    expect(legacyApi.registerTool).not.toHaveBeenCalled();
  });

  it('skips registerMemoryCapability when plugins.slots.memory points at another plugin (Codex B58)', () => {
    // B58: register() must not silently override the operator's elected
    // memory provider. If plugins.slots.memory points at a different
    // plugin, this adapter must no-op the capability registration and
    // log a diagnostic — not steal the slot by merely being loaded.
    const api = makeApi();
    (api.config as any).plugins.slots.memory = 'some-other-memory-plugin';
    plugin.register(api);

    expect(api.registerMemoryCapability).not.toHaveBeenCalled();
    expect(api.registerTool).not.toHaveBeenCalled();
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('plugins.slots.memory is not set to "adapter-openclaw"'),
    );
  });

  it('skips registerMemoryCapability when plugins.slots.memory is unset (Codex B58)', () => {
    // B58 second branch: an unelected slot (fresh install, no setup run
    // yet, or partial migration) must also no-op. Operators have to
    // explicitly elect this adapter via `dkg setup` before it claims
    // the slot.
    const api = makeApi();
    (api.config as any).plugins.slots.memory = undefined;
    plugin.register(api);

    expect(api.registerMemoryCapability).not.toHaveBeenCalled();
    expect(api.registerTool).not.toHaveBeenCalled();
  });

  it('reads plugins.slots.memory from api.cfg when api.config is missing (Codex B58 gateway shim)', () => {
    // Some OpenClaw gateway builds expose the merged config on `api.cfg`
    // instead of `api.config`. The slot-ownership gate mirrors the same
    // fallback order as DkgChannelPlugin.register so those runtimes
    // still resolve correctly and don't get a false negative that would
    // leave the adapter unregistered after a successful setup.
    const api = makeApi();
    (api as any).cfg = api.config;
    (api as any).config = undefined;
    plugin.register(api);

    expect(api.registerMemoryCapability).toHaveBeenCalledTimes(1);
  });

  it('DkgMemorySearchManager.search floors fractional maxResults into a valid SPARQL LIMIT (Codex B37)', async () => {
    // B37: the clamped value is interpolated directly into the SPARQL
    // `LIMIT` clause. A fractional input like `2.5` would produce
    // `LIMIT 2.5`, which is invalid SPARQL and gets swallowed by the
    // per-query `.catch` blocks as an empty result set. The fix floors
    // the clamped value so fractional caller intent maps to the
    // nearest valid integer.
    const querySpy = vi.spyOn(client, 'query').mockResolvedValue({
      result: { bindings: [] },
    });
    const manager = new DkgMemorySearchManager({ client, resolver: makeResolver() });

    await manager.search('alpha beta', { maxResults: 2.5 });

    expect(querySpy).toHaveBeenCalled();
    const sparql = querySpy.mock.calls[0][0] as string;
    // The interpolated LIMIT must be an integer (no dot).
    expect(sparql).toMatch(/LIMIT \d+(\s|$)/);
    // Specifically 2 for input 2.5 (Math.floor after clamp).
    expect(sparql).toContain('LIMIT 2');
    expect(sparql).not.toContain('LIMIT 2.5');
  });

  it('DkgMemorySearchManager.search clamps-then-floors extreme fractional inputs (Codex B37)', async () => {
    // Belt-and-suspenders for the B37 clamp-then-floor interaction.
    // Input 150.9 → clamped to 100 → floored to 100. Input 0.4 →
    // clamped to 1 (via Math.max(1, ...)) → floored to 1.
    const querySpy = vi.spyOn(client, 'query').mockResolvedValue({
      result: { bindings: [] },
    });
    const managerHi = new DkgMemorySearchManager({ client, resolver: makeResolver() });
    await managerHi.search('alpha', { maxResults: 150.9 });
    const managerLo = new DkgMemorySearchManager({ client, resolver: makeResolver() });
    await managerLo.search('alpha', { maxResults: 0.4 });

    const sparqlHi = querySpy.mock.calls[0][0] as string;
    const sparqlLo = querySpy.mock.calls[1][0] as string;
    expect(sparqlHi).toContain('LIMIT 100');
    expect(sparqlLo).toContain('LIMIT 1');
  });

  it('DkgMemorySearchManager.search strips the did:dkg:agent: prefix when the resolver returns a DID-form address (Codex B43)', async () => {
    // B43 for the WM read path: the daemon's query engine uses the raw
    // peer-ID form for assertion-graph URI scoping when `view: 'working-memory'`.
    // A DID-form input from the resolver must be normalized to the raw
    // form before being passed to `client.query`, otherwise the read
    // looks in an assertion graph scoped to a literal DID string and
    // finds nothing.
    const querySpy = vi.spyOn(client, 'query').mockResolvedValue({ result: { bindings: [] } });
    const manager = new DkgMemorySearchManager({
      client,
      resolver: makeResolver({ agentAddress: 'did:dkg:agent:peer-readtest' }),
    });

    await manager.search('hello world');

    expect(querySpy).toHaveBeenCalled();
    const opts = querySpy.mock.calls[0][1]!;
    expect(opts.agentAddress).toBe('peer-readtest');
  });

});

describe('DkgMemorySearchManager', () => {
  let client: DkgDaemonClient;

  beforeEach(() => {
    client = new DkgDaemonClient({ baseUrl: 'http://localhost:9200' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readFile', () => {
    it('returns an empty shell for any relPath without calling the daemon', async () => {
      const querySpy = vi.spyOn(client, 'query');
      const manager = new DkgMemorySearchManager({ client, resolver: makeResolver() });
      const result = await manager.readFile({ relPath: 'MEMORY.md' });
      expect(result).toEqual({ text: '', path: 'MEMORY.md' });
      expect(querySpy).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('returns a synchronous MemoryProviderStatus with backend=builtin and provider=dkg', () => {
      const manager = new DkgMemorySearchManager({ client, resolver: makeResolver() });
      const status = manager.status();
      expect(status.backend).toBe('builtin');
      expect(status.provider).toBe('dkg');
      expect(status.vector).toEqual({ enabled: false, available: false });
      expect(status.fts).toEqual({ enabled: false, available: false });
      expect(status.sources).toEqual(['memory', 'sessions']);
    });
  });

  describe('probes', () => {
    it('probeEmbeddingAvailability returns ok:false with an explanation', async () => {
      const manager = new DkgMemorySearchManager({ client, resolver: makeResolver() });
      const result = await manager.probeEmbeddingAvailability();
      expect(result.ok).toBe(false);
      expect(result.error).toBeTypeOf('string');
    });

    it('probeVectorAvailability returns a bare boolean false (not an object)', async () => {
      // FAIL #2 from openclaw-runtime's contract audit: upstream declares
      // this method Promise<boolean>, and upstream's `if (available) …`
      // check would treat any object (even {ok:false}) as truthy and
      // silently claim a vector backend is available. The DKG provider
      // must return a bare `false` to opt out honestly.
      const manager = new DkgMemorySearchManager({ client, resolver: makeResolver() });
      const result = await manager.probeVectorAvailability();
      expect(result).toBe(false);
      expect(typeof result).toBe('boolean');
      // And the truthiness check must evaluate to false the way upstream
      // uses it, not the way a {ok:false,...} object would (truthy).
      expect(result ? 'upstream-would-use-vector' : 'upstream-skips-vector').toBe('upstream-skips-vector');
    });
  });

  describe('search', () => {
    it('issues three parallel /api/query calls against agent-context (WM + SWM + VM) when no project CG is resolved', async () => {
      // The fan-out was broadened during live validation: agent-context
      // is now queried across all three memory views, not just WM. The
      // assertionName pin was also dropped — with `view: 'working-memory'`
      // and no assertionName, the query engine scans all assertions in
      // the agent's WM namespace (including `chat-turns` and any other
      // assertions the agent may have written into agent-context). SWM
      // and VM views don't have assertion-level sub-graphing, so dropping
      // the pin on those is a no-op that still scans the whole shared-
      // memory / verified-memory graph for the CG.
      const querySpy = vi.spyOn(client, 'query').mockResolvedValue({ result: { bindings: [] } });
      const manager = new DkgMemorySearchManager({ client, resolver: makeResolver() });

      await manager.search('hello world');

      expect(querySpy).toHaveBeenCalledTimes(3);
      const allOpts = querySpy.mock.calls.map(c => c[1]!);
      for (const opts of allOpts) {
        expect(opts.contextGraphId).toBe(AGENT_CONTEXT_GRAPH);
        // B43: WM view routing uses the raw peer-ID form. The fixture
        // provides a raw peer id (`peer-test`), which is passed through
        // to the query engine as-is — consumers that pass DID-form
        // addresses through the resolver would be normalized by
        // `toAgentPeerId` at the consumption site.
        expect(opts.agentAddress).toBe('peer-test');
        // No assertionName pin — the whole point of the broadened
        // fan-out is to let all assertions in the CG view participate
        // in recall, not just a specific "canonical" one.
        expect(opts.assertionName).toBeUndefined();
      }
      const views = allOpts.map(o => o.view).sort();
      expect(views).toEqual(
        ['shared-working-memory', 'verified-memory', 'working-memory'],
      );
    });

    it('issues six parallel /api/query calls (agent-context WM/SWM/VM + project WM/SWM/VM) when a project CG is resolved', async () => {
      // With a project CG resolved, the fan-out is three agent-context
      // views plus three project views, for six queries total. None of
      // them pin an assertionName — all six scan the whole CG view.
      const querySpy = vi.spyOn(client, 'query').mockResolvedValue({ result: { bindings: [] } });
      const manager = new DkgMemorySearchManager({
        client,
        resolver: makeResolver({ projectContextGraphId: 'research-x' }),
      });

      await manager.search('hello world');

      expect(querySpy).toHaveBeenCalledTimes(6);
      const allOpts = querySpy.mock.calls.map(c => c[1]!);

      for (const opts of allOpts) {
        expect(opts.assertionName).toBeUndefined();
        expect(opts.agentAddress).toBe('peer-test');
      }

      const agentContextOpts = allOpts.filter(o => o.contextGraphId === AGENT_CONTEXT_GRAPH);
      expect(agentContextOpts).toHaveLength(3);
      expect(agentContextOpts.map(o => o.view).sort()).toEqual(
        ['shared-working-memory', 'verified-memory', 'working-memory'],
      );

      const projectOpts = allOpts.filter(o => o.contextGraphId === 'research-x');
      expect(projectOpts).toHaveLength(3);
      expect(projectOpts.map(o => o.view).sort()).toEqual(
        ['shared-working-memory', 'verified-memory', 'working-memory'],
      );
    });

    it('uses a permissive SPARQL shape — no rdf:type constraint, no specific predicate, literal-length floor', async () => {
      // The SPARQL template itself should match any literal object of
      // 20+ characters regardless of the predicate or subject type.
      // This is the whole point of the broadened fan-out: agents can
      // write memories in whatever RDF shape fits their domain
      // (schema:description, rdfs:comment, custom predicates, typed or
      // untyped subjects) and slot-backed recall still finds them.
      const querySpy = vi.spyOn(client, 'query').mockResolvedValue({ result: { bindings: [] } });
      const manager = new DkgMemorySearchManager({ client, resolver: makeResolver() });

      await manager.search('hello world');

      expect(querySpy).toHaveBeenCalled();
      const sparql = querySpy.mock.calls[0][0] as string;
      // Any predicate: `?uri ?pred ?text` instead of
      // `?uri <schema:description> ?text` or `?uri a schema:Message`.
      expect(sparql).toMatch(/\?uri\s+\?pred\s+\?text/);
      // Literal filter excludes IRIs and blank nodes.
      expect(sparql).toContain('isLiteral(?text)');
      // 20-char floor on literal length to exclude tiny metadata
      // (flags, IDs, short tags).
      expect(sparql).toContain('STRLEN(STR(?text)) >= 20');
      // No hard-pinned predicates anywhere in the template.
      expect(sparql).not.toContain('schema:description');
      expect(sparql).not.toContain('http://schema.org/description');
      expect(sparql).not.toContain('schema:text');
      expect(sparql).not.toContain('http://schema.org/text');
      expect(sparql).not.toContain('schema:Message');
      expect(sparql).not.toContain('http://schema.org/Message');
      // The keyword substring filter stays — that's still how we match.
      expect(sparql).toMatch(/CONTAINS\(LCASE\(STR\(\?text\)\),\s*"hello"\)/);
      expect(sparql).toMatch(/CONTAINS\(LCASE\(STR\(\?text\)\),\s*"world"\)/);
    });

    it('merges results from all six layers and tags them with the correct source + layer', async () => {
      // Deterministic ordering lines up with the plan array in
      // DkgMemorySearchManager.search: agent-context WM, SWM, VM first,
      // then project WM, SWM, VM.
      vi.spyOn(client, 'query')
        .mockResolvedValueOnce({
          result: {
            bindings: [
              { uri: { value: 'urn:m:1' }, text: { value: 'agent context wm hello world note' } },
            ],
          },
        })
        .mockResolvedValueOnce({
          result: {
            bindings: [
              { uri: { value: 'urn:m:2' }, text: { value: 'agent context swm hello world note' } },
            ],
          },
        })
        .mockResolvedValueOnce({
          result: {
            bindings: [
              { uri: { value: 'urn:m:3' }, text: { value: 'agent context vm hello world note' } },
            ],
          },
        })
        .mockResolvedValueOnce({
          result: {
            bindings: [
              { uri: { value: 'urn:m:4' }, text: { value: 'project wm hello world draft' } },
            ],
          },
        })
        .mockResolvedValueOnce({
          result: {
            bindings: [
              { uri: { value: 'urn:m:5' }, text: { value: 'project swm hello world shared' } },
            ],
          },
        })
        .mockResolvedValueOnce({
          result: {
            bindings: [
              { uri: { value: 'urn:m:6' }, text: { value: 'project vm hello world verified' } },
            ],
          },
        });

      const manager = new DkgMemorySearchManager({
        client,
        resolver: makeResolver({ projectContextGraphId: 'research-x' }),
      });

      const results = await manager.search('hello world');
      expect(results).toHaveLength(6);
      const layers = results.map(r => r.layer).sort();
      expect(layers).toEqual([
        'agent-context-swm',
        'agent-context-vm',
        'agent-context-wm',
        'project-swm',
        'project-vm',
        'project-wm',
      ]);
      // source stays on the closed upstream union — sessions for every
      // agent-context layer, memory for every project layer.
      const sources = results.map(r => r.source).sort();
      expect(sources).toEqual([
        'memory', 'memory', 'memory',
        'sessions', 'sessions', 'sessions',
      ]);
      for (const r of results) {
        expect(r.startLine).toBe(1);
        expect(r.endLine).toBe(1);
        expect(typeof r.path).toBe('string');
        expect(typeof r.snippet).toBe('string');
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    });

    it('ranks with trust-weighted scores: VM×1.3 > SWM×1.15 > WM×1.0 across both context graphs', async () => {
      // All six layers return a single result with identical keyword
      // overlap (`hello world` matches both keywords → raw score 1.0).
      // Trust weights order the tiers VM > SWM > WM uniformly across
      // both CGs. Within a tier, the tie is broken by raw score (all
      // tied here) and then by deterministic Promise.all resolution
      // order from the plans array — agent-context entries come
      // first in that array, so on a full tie they land before their
      // project-CG counterparts.
      vi.spyOn(client, 'query')
        .mockResolvedValueOnce({
          result: { bindings: [{ uri: { value: 'urn:m:actxwm' }, text: { value: 'hello world agent context wm' } }] },
        })
        .mockResolvedValueOnce({
          result: { bindings: [{ uri: { value: 'urn:m:actxswm' }, text: { value: 'hello world agent context swm' } }] },
        })
        .mockResolvedValueOnce({
          result: { bindings: [{ uri: { value: 'urn:m:actxvm' }, text: { value: 'hello world agent context vm' } }] },
        })
        .mockResolvedValueOnce({
          result: { bindings: [{ uri: { value: 'urn:m:pwm' }, text: { value: 'hello world project wm' } }] },
        })
        .mockResolvedValueOnce({
          result: { bindings: [{ uri: { value: 'urn:m:pswm' }, text: { value: 'hello world project swm' } }] },
        })
        .mockResolvedValueOnce({
          result: { bindings: [{ uri: { value: 'urn:m:pvm' }, text: { value: 'hello world project vm' } }] },
        });

      const manager = new DkgMemorySearchManager({
        client,
        resolver: makeResolver({ projectContextGraphId: 'research-x' }),
      });

      const results = await manager.search('hello world');
      expect(results).toHaveLength(6);
      // Head is VM tier (highest trust weight, VM×1.3). Both VM hits
      // share the tier; order within the tier is deterministic via the
      // plan array — agent-context before project in the current
      // topology.
      const headLayers = [results[0].layer, results[1].layer].sort();
      expect(headLayers).toEqual(['agent-context-vm', 'project-vm']);
      // Middle is SWM tier.
      const middleLayers = [results[2].layer, results[3].layer].sort();
      expect(middleLayers).toEqual(['agent-context-swm', 'project-swm']);
      // Tail is WM tier.
      const tailLayers = [results[4].layer, results[5].layer].sort();
      expect(tailLayers).toEqual(['agent-context-wm', 'project-wm']);
    });

    it('dedups across layers by (cg, uri), keeping the highest-trust layer', async () => {
      // The same memory URI surfaces in all three project-CG layers
      // (a verified memory that is still in the WM draft buffer and
      // the SWM view). All three should collapse to one result tagged
      // with the VM layer. agent-context bindings are unrelated and
      // stay as their own entries (different contextGraphId key).
      const sameUri = { value: 'urn:m:shared' };
      const sameText = { value: 'hello world canonical memory' };
      vi.spyOn(client, 'query')
        .mockResolvedValueOnce({ result: { bindings: [] } }) // agent-context WM
        .mockResolvedValueOnce({ result: { bindings: [] } }) // agent-context SWM
        .mockResolvedValueOnce({ result: { bindings: [] } }) // agent-context VM
        .mockResolvedValueOnce({ result: { bindings: [{ uri: sameUri, text: sameText }] } }) // project WM
        .mockResolvedValueOnce({ result: { bindings: [{ uri: sameUri, text: sameText }] } }) // project SWM
        .mockResolvedValueOnce({ result: { bindings: [{ uri: sameUri, text: sameText }] } }); // project VM

      const manager = new DkgMemorySearchManager({
        client,
        resolver: makeResolver({ projectContextGraphId: 'research-x' }),
      });

      const results = await manager.search('hello world');
      expect(results).toHaveLength(1);
      expect(results[0].layer).toBe('project-vm');
      expect(results[0].source).toBe('memory');
    });

    it('degrades to the succeeding layers when one view query fails, with one warn per failing (cg, view) pair', async () => {
      // Project-VM query fails; the other five layers succeed. The
      // failed layer emits exactly one warn identifying the (cg, view)
      // pair, and the surviving layers contribute results.
      vi.spyOn(client, 'query')
        .mockResolvedValueOnce({
          result: { bindings: [{ uri: { value: 'urn:m:ctwm' }, text: { value: 'match agent context wm body' } }] },
        }) // agent-context WM
        .mockResolvedValueOnce({
          result: { bindings: [{ uri: { value: 'urn:m:ctswm' }, text: { value: 'match agent context swm body' } }] },
        }) // agent-context SWM
        .mockResolvedValueOnce({
          result: { bindings: [{ uri: { value: 'urn:m:ctvm' }, text: { value: 'match agent context vm body' } }] },
        }) // agent-context VM
        .mockResolvedValueOnce({
          result: { bindings: [{ uri: { value: 'urn:m:pwm' }, text: { value: 'match project wm body' } }] },
        }) // project WM
        .mockResolvedValueOnce({
          result: { bindings: [{ uri: { value: 'urn:m:pswm' }, text: { value: 'match project swm body' } }] },
        }) // project SWM
        .mockRejectedValueOnce(new Error('verified-memory view offline')); // project VM

      const warnSpy = vi.fn();
      const manager = new DkgMemorySearchManager({
        client,
        resolver: makeResolver({ projectContextGraphId: 'research-x' }),
        logger: { info: vi.fn(), warn: warnSpy, debug: vi.fn() } as any,
      });

      const results = await manager.search('match');
      const layers = results.map(r => r.layer).sort();
      expect(layers).toEqual([
        'agent-context-swm',
        'agent-context-vm',
        'agent-context-wm',
        'project-swm',
        'project-wm',
      ]);

      const vmWarns = warnSpy.mock.calls.filter(c =>
        typeof c[0] === 'string' && c[0].includes('project-vm'),
      );
      expect(vmWarns).toHaveLength(1);
      expect(vmWarns[0][0]).toContain('research-x');
      expect(vmWarns[0][0]).toContain('verified-memory');
    });

    it('emits a single info-level observability log per search call showing query, project, layers, and per-layer raw hits', async () => {
      // Live-validation follow-up: without this log, we have no runtime
      // signal distinguishing "slot called but query missed" from "slot
      // never called at all". The log must fire once per `search()`
      // call with query text, resolved project CG, total layer count,
      // and per-layer raw hit counts.
      vi.spyOn(client, 'query')
        .mockResolvedValueOnce({
          result: { bindings: [{ uri: { value: 'urn:m:actxwm' }, text: { value: 'hello world agent context wm hit' } }] },
        })
        .mockResolvedValueOnce({ result: { bindings: [] } })
        .mockResolvedValueOnce({ result: { bindings: [] } })
        .mockResolvedValueOnce({
          result: {
            bindings: [
              { uri: { value: 'urn:m:pwm1' }, text: { value: 'hello world project wm first' } },
              { uri: { value: 'urn:m:pwm2' }, text: { value: 'hello world project wm second' } },
            ],
          },
        })
        .mockResolvedValueOnce({ result: { bindings: [] } })
        .mockResolvedValueOnce({ result: { bindings: [] } });

      const infoSpy = vi.fn();
      const manager = new DkgMemorySearchManager({
        client,
        resolver: makeResolver({ projectContextGraphId: 'research-x' }),
        logger: { info: infoSpy, warn: vi.fn(), debug: vi.fn() } as any,
      });

      await manager.search('hello world');

      const searchFiredLogs = infoSpy.mock.calls.filter(c =>
        typeof c[0] === 'string' && c[0].includes('[dkg-memory] search fired:'),
      );
      expect(searchFiredLogs).toHaveLength(1);
      const logLine = searchFiredLogs[0][0] as string;
      expect(logLine).toContain('query="hello world"');
      expect(logLine).toContain('project=research-x');
      expect(logLine).toContain('layers=6');
      expect(logLine).toContain('raw_hits=3');
      expect(logLine).toContain('agent-context-wm:1');
      expect(logLine).toContain('agent-context-swm:0');
      expect(logLine).toContain('agent-context-vm:0');
      expect(logLine).toContain('project-wm:2');
      expect(logLine).toContain('project-swm:0');
      expect(logLine).toContain('project-vm:0');
    });

    it('observability log uses ∅ for the project field when no project CG is resolved', async () => {
      vi.spyOn(client, 'query').mockResolvedValue({ result: { bindings: [] } });
      const infoSpy = vi.fn();
      const manager = new DkgMemorySearchManager({
        client,
        resolver: makeResolver(),
        logger: { info: infoSpy, warn: vi.fn(), debug: vi.fn() } as any,
      });

      await manager.search('hello world');

      const searchFiredLogs = infoSpy.mock.calls.filter(c =>
        typeof c[0] === 'string' && c[0].includes('[dkg-memory] search fired:'),
      );
      expect(searchFiredLogs).toHaveLength(1);
      const logLine = searchFiredLogs[0][0] as string;
      expect(logLine).toContain('project=∅');
      expect(logLine).toContain('layers=3');
      expect(logLine).toContain('raw_hits=0');
    });

    it('returns an empty array for queries with no meaningful keywords', async () => {
      const querySpy = vi.spyOn(client, 'query');
      const manager = new DkgMemorySearchManager({ client, resolver: makeResolver() });
      const results = await manager.search('a');
      expect(results).toEqual([]);
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('respects maxResults when merging results', async () => {
      vi.spyOn(client, 'query').mockResolvedValue({
        result: {
          bindings: Array.from({ length: 20 }, (_, i) => ({
            uri: { value: `urn:m:${i}` },
            text: { value: `hello world item ${i}` },
          })),
        },
      });

      const manager = new DkgMemorySearchManager({ client, resolver: makeResolver() });
      const results = await manager.search('hello world', { maxResults: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });
});

describe('buildDkgMemoryRuntime', () => {
  it('returns a factory that yields a DkgMemorySearchManager wired to the given resolver', async () => {
    const client = new DkgDaemonClient({ baseUrl: 'http://localhost:9200' });
    const runtime = buildDkgMemoryRuntime(client, makeResolver());

    const request: MemoryRuntimeRequest = { sessionKey: 'test-session' };
    const result = await runtime.getMemorySearchManager(request);
    expect(result.manager).toBeInstanceOf(DkgMemorySearchManager);
    expect(result.error).toBeUndefined();
  });

  it('returns { manager: null, error } when DkgMemorySearchManager construction throws', async () => {
    // FAIL #3 from openclaw-runtime's audit: MemoryRuntimeResult.manager
    // must be nullable so the runtime can gracefully decline to build a
    // manager rather than propagating a construction throw. Simulate a
    // construction failure by spying on the class prototype.
    const client = new DkgDaemonClient({ baseUrl: 'http://localhost:9200' });
    const runtime = buildDkgMemoryRuntime(client, makeResolver());

    const buildStatusSpy = vi
      .spyOn(DkgMemorySearchManager.prototype as any, 'buildStatus')
      .mockImplementation(() => {
        throw new Error('simulated construction failure');
      });
    try {
      const result = await runtime.getMemorySearchManager({ sessionKey: 'test-session' });
      expect(result.manager).toBeNull();
      expect(result.error).toContain('simulated construction failure');
    } finally {
      buildStatusSpy.mockRestore();
    }
  });

  it('resolveMemoryBackendConfig reports kind=dkg and the agent-context graph', () => {
    const client = new DkgDaemonClient({ baseUrl: 'http://localhost:9200' });
    const runtime = buildDkgMemoryRuntime(client, makeResolver());
    const cfg = runtime.resolveMemoryBackendConfig!({});
    expect(cfg.kind).toBe('dkg');
    expect(cfg.agentContextGraph).toBe(AGENT_CONTEXT_GRAPH);
  });

  it('returns { manager: null, error } when the node peer ID probe has not yet landed (B12)', async () => {
    // B12: before constructing the manager, the factory must resolve an
    // effective agent address (session-scoped or default). If neither is
    // available — typically because the daemon /api/status probe has not
    // yet completed — returning a live manager would turn every WM read
    // into a silently-caught query-engine throw (`agentAddress is required
    // for the working-memory view`). Instead surface "backend not ready"
    // via the null-manager contract path so upstream uses its fallback.
    const client = new DkgDaemonClient({ baseUrl: 'http://localhost:9200' });
    const resolver: DkgMemorySessionResolver = {
      getSession: () => undefined,
      getDefaultAgentAddress: () => undefined,
      listAvailableContextGraphs: () => [],
    };
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const runtime = buildDkgMemoryRuntime(client, resolver, logger as any);

    const result = await runtime.getMemorySearchManager({ sessionKey: 'test-session' });
    expect(result.manager).toBeNull();
    expect(result.error).toContain('peer ID not yet available');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('prefers session-scoped agentAddress over the default when constructing the manager (B12)', async () => {
    // When the lazy re-probe hasn't landed but a session-scoped address is
    // stamped on the dispatch, the factory must still construct a live
    // manager using the session-scoped path rather than falling through
    // to the null-manager branch.
    const client = new DkgDaemonClient({ baseUrl: 'http://localhost:9200' });
    const resolver: DkgMemorySessionResolver = {
      getSession: () => ({ agentAddress: 'did:dkg:agent:session-specific' }),
      getDefaultAgentAddress: () => undefined,
      listAvailableContextGraphs: () => [],
    };
    const runtime = buildDkgMemoryRuntime(client, resolver);

    const result = await runtime.getMemorySearchManager({ sessionKey: 'scoped-session' });
    expect(result.manager).toBeInstanceOf(DkgMemorySearchManager);
    expect(result.error).toBeUndefined();
  });

  it('constructs a live manager from the default peer ID when no session stamp exists (B12 recovery path)', async () => {
    // After the lazy re-probe completes, subsequent dispatches should see
    // a cached default address and get a live manager back — even when no
    // session-scoped stamp is present. This exercises the "default only"
    // branch of the resolvedAgentAddress fallback.
    const client = new DkgDaemonClient({ baseUrl: 'http://localhost:9200' });
    const resolver: DkgMemorySessionResolver = {
      getSession: () => undefined,
      getDefaultAgentAddress: () => 'did:dkg:agent:probed',
      listAvailableContextGraphs: () => [],
    };
    const runtime = buildDkgMemoryRuntime(client, resolver);

    const result = await runtime.getMemorySearchManager({ sessionKey: 'recovered-session' });
    expect(result.manager).toBeInstanceOf(DkgMemorySearchManager);
    expect(result.error).toBeUndefined();
  });
});
