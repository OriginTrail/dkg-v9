/**
 * BlazegraphStore unit tests with mocked fetch (03 §16 — graph isolation via GRAPH IRIs;
 * no live Blazegraph required).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlazegraphStore } from '../src/adapters/blazegraph.js';

describe('BlazegraphStore (mocked HTTP)', () => {
  const baseUrl = 'http://blaze.test/sparql';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips trailing slash from endpoint URL', () => {
    const s = new BlazegraphStore(`${baseUrl}/`);
    expect((s as unknown as { url: string }).url).toBe(baseUrl);
  });

  it('insert is a no-op for empty quad list', async () => {
    const s = new BlazegraphStore(baseUrl);
    await s.insert([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('insert POSTs N-Quads with correct content type', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    const s = new BlazegraphStore(baseUrl);
    await s.insert([
      {
        subject: 'http://ex.org/s',
        predicate: 'http://ex.org/p',
        object: '"o"',
        graph: 'http://ex.org/g',
      },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe(baseUrl);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('text/x-nquads');
    expect(String(init?.body)).toContain('<http://ex.org/s>');
    expect(String(init?.body)).toContain('<http://ex.org/g>');
  });

  it('insert throws on HTTP error with body snippet', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('bad request', { status: 400, statusText: 'Bad Request' }),
    );
    const s = new BlazegraphStore(baseUrl);
    await expect(
      s.insert([
        { subject: 'http://a', predicate: 'http://b', object: '"c"', graph: 'http://g' },
      ]),
    ).rejects.toThrow(/Blazegraph insert failed \(400\)/);
  });

  it('SELECT query parses JSON bindings (graph isolation query)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          head: { vars: ['name'] },
          results: {
            bindings: [
              {
                name: { type: 'literal', value: 'Alice' },
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const s = new BlazegraphStore(baseUrl);
    const r = await s.query(
      'SELECT ?name WHERE { GRAPH <http://ctx/1> { ?s <http://schema.org/name> ?name } }',
    );
    expect(r.type).toBe('bindings');
    if (r.type === 'bindings') {
      expect(r.bindings).toHaveLength(1);
      expect(r.bindings[0].name).toBe('"Alice"');
    }
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(String(init?.body)).toMatch(/^query=/);
  });

  it('ASK query returns boolean result', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ boolean: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const s = new BlazegraphStore(baseUrl);
    const r = await s.query('ASK { GRAPH <http://g1> { ?s ?p ?o } }');
    expect(r.type).toBe('boolean');
    if (r.type === 'boolean') expect(r.value).toBe(true);
  });

  it('query throws when SPARQL endpoint returns error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('syntax error', { status: 500 }),
    );
    const s = new BlazegraphStore(baseUrl);
    await expect(s.query('SELECT * WHERE { ?s ?p ?o }')).rejects.toThrow(/Blazegraph query failed/);
  });

  it('CONSTRUCT returns quads from n-quads body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        '<http://s> <http://p> "o" <http://g> .\n',
        { status: 200, headers: { 'Content-Type': 'text/x-nquads' } },
      ),
    );
    const s = new BlazegraphStore(baseUrl);
    const r = await s.query('CONSTRUCT WHERE { ?s ?p ?o }');
    expect(r.type).toBe('quads');
    if (r.type === 'quads') {
      expect(r.quads.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('dropGraph sends SPARQL UPDATE', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 200 }));
    const s = new BlazegraphStore(baseUrl);
    await s.dropGraph('http://ex.org/g1');
    expect(globalThis.fetch).toHaveBeenCalled();
    const call = vi.mocked(globalThis.fetch).mock.calls.find((c) =>
      String(c[1]?.body).includes('DROP%20SILENT%20GRAPH'),
    );
    expect(call).toBeDefined();
  });
});
