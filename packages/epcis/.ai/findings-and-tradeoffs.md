# EPCIS E2E Testing — Findings, Workarounds & Open Questions

Compiled during E2E test development (March 2026). Documents every workaround, design question, and deviation from the ideal implementation discovered while building the capture→query pipeline.

---

## 1. Public vs Private Publishing

### What we did
The daemon wraps EPCIS content as `{ public: content }` before calling `agent.publish()`.

```js
// daemon.ts — EPCIS publisher bridge
const result = await agent.publish(paranetId, { public: content }, opts);
```

### Why
Bare JSON-LD (no envelope) defaults to **private** in v9's `jsonLdToQuads`. Private triples go to `GRAPH <paranet/_private>`, which is a separate graph from the queryable data graph (`GRAPH <paranet>`). SPARQL queries only search the data graph, so private data is invisible to the EPCIS query builder.

### What's wrong with this
EPCIS data is forced to be public. There's no option for private EPCIS events. The `accessPolicy` from `publishOptions` is passed through but only affects KC-level access control, not the public/private graph split.

### Alternatives
1. **Fix the private graph to be queryable** — make SPARQL queries search both `<paranet>` and `<paranet/_private>` (or merge them). See GitHub issue #224.
2. **Adopt v8's approach** — store private triples in the same graph, with access control at the KC/peer level, not graph level. Private data gets a merkle hash linked from public data.
3. **Keep as-is** — EPCIS data is inherently supply-chain data meant to be shared. Public may be the right default. Add a comment and move on.

### Related issue
GitHub issue #224 — "Private and public triples in separate graphs"

---

## 2. eventID (EPCIS 2.0 §7.4.1)

### What we did
Events with `eventID` get it mapped to `@id` via the JSON-LD context (`"eventID": "@id"`). This gives each event a named URI as its RDF subject, which becomes the rootEntity in the DKG Knowledge Asset.

We **recommend** but **do not require** `eventID`. Events without it get auto-generated `uuid:` URIs via blank node replacement.

### Why eventID matters
- Without `@id`, `jsonld.toRDF()` produces blank nodes (`_:b0`, `_:b1`)
- `autoPartition` needs named URIs as root entities
- Before the blank-node-to-UUID fix, blank nodes caused silent publish failures (`kcId: "0"`, empty KCs)
- Even with the fix, auto-generated UUIDs are random — the creator can't predict or reference them

### Should we make it mandatory?
**Arguments for mandatory:**
- Deterministic, meaningful IDs for provenance queries
- The EPCIS standard defines it (though as optional)
- Creators should know their event URIs
- Enables `eventID` query parameter for direct lookup

**Arguments against mandatory:**
- The standard says optional
- v8 auto-generated IDs and it worked fine
- Lower barrier to entry for new users
- Blank node auto-UUID now handles the technical issue

### Current state
Optional with a comment in `handlers.ts` to revisit. The `eventID` query parameter IS implemented for direct event lookup.

---

## 3. Blank Node Auto-UUID Assignment

### What we did
Added blank node → `uuid:{v4}` replacement in `jsonLdToQuads()` in `dkg-agent.ts`. This runs after `jsonld.toRDF()` and before quads reach the publisher.

```js
// dkg-agent.ts — inside jsonLdToQuads()
const blankNodeMap = new Map<string, string>();
const resolveBlank = (value: string) => {
  if (!value.startsWith('_:')) return value;
  let uri = blankNodeMap.get(value);
  if (!uri) { uri = `uuid:${crypto.randomUUID()}`; blankNodeMap.set(value, uri); }
  return uri;
};
```

### What's ugly about it
- Inline implementation — a map + closure stuffed into `jsonLdToQuads`
- v8's `generateMissingIdsForBlankNodes` was a clean, named, standalone function in assertion-tools
- The current code iterates all quads and replaces subjects/objects — straightforward but verbose
- Unclear if this should apply to ALL JSON-LD publishes or just EPCIS

### Does quad-based publish need this?
No — quads have explicit `subject`/`predicate`/`object`/`graph` strings. No JSON-LD conversion, no blank nodes. The issue is JSON-LD-specific.

### Alternatives
1. **Extract to a named function** — `assignUrisToBlankNodes(quads)` — cleaner, testable, matches v8's pattern
2. **Do it in the EPCIS handler** — assign `eventID` to events before passing to publish. EPCIS-specific, doesn't fix the general problem.
3. **Do it in autoPartition** — the publisher's partitioner could handle blank nodes. Would fix it for all publish paths.

### Recommendation
Extract to a standalone function. It applies to all JSON-LD publishes, not just EPCIS.

---

## 4. N-Quads Literal Quoting (unwrapLiteral)

### What we did
Added `unwrapLiteral()` in `handlers.ts` to strip the double-quoting from SPARQL binding values.

```js
// The triplestore returns: "\"ADD\"" (string ADD with N-Quads quotes)
// unwrapLiteral strips to: "ADD"
function unwrapLiteral(value: string): string {
  const typedMatch = value.match(/^"(.*)"(?:\^\^<.*>)?$/s);
  if (typedMatch) return typedMatch[1];
  return value;
}
```

### Why
The Oxigraph adapter's `termToString()` (in `packages/storage/src/adapters/oxigraph.ts`) deliberately serializes all literal values to N-Quads format. The storage test at `storage.test.ts:41` even expects `'"Alice"'`. This is an intentional internal convention — the entire storage layer speaks N-Quads.

### What's wrong with this
Every consumer of SPARQL results must strip the quoting themselves. The EPCIS handler shouldn't need to know about N-Quads formatting. This is a leaky abstraction.

### Alternatives
1. **Fix at the storage layer** — make `termToString` return plain values for SPARQL SELECT bindings. Would be a breaking change (the storage tests expect the current format).
2. **Add a "clean bindings" utility** — a shared helper at the storage/core level that unwraps literals. All SPARQL consumers use it.
3. **Keep as-is** — `unwrapLiteral` in the EPCIS handler works. Ugly but contained.

### Related info
- `packages/storage/src/adapters/oxigraph.ts:260-275` — `termToString()` adds the quoting
- `packages/storage/src/adapters/blazegraph.ts:237-248` — same pattern
- `packages/storage/test/storage.test.ts:41` — test expects `'"Alice"'`

---

## 5. Angle Brackets vs FILTER(STR()) for URI Fields

### What we did
Changed `bizLocation` and `readPoint` queries from `FILTER(STR(?var) = "value")` to `<value>` angle bracket matching.

```sparql
-- Old (slow — scan + string conversion)
?event epcis:bizLocation ?bizLocation .
FILTER(STR(?bizLocation) = "urn:epc:id:sgln:TEST.00001.0")

-- New (fast — direct index lookup)
?event epcis:bizLocation <urn:epc:id:sgln:TEST.00001.0> .
OPTIONAL { ?event epcis:bizLocation ?bizLocation . }
```

### Why both lines are needed
The angle bracket match **filters** efficiently (index lookup). The OPTIONAL **binds the variable** so `?bizLocation` appears in SELECT results for `toEpcisEvent` to reconstruct `{ id: "..." }`. Without the OPTIONAL, the variable is unbound and the response has `undefined` for that field.

### What's slightly off
Having both a concrete triple pattern AND an OPTIONAL for the same predicate looks redundant. It works correctly but may confuse future readers. A comment explains the intent.

### Why not FILTER for everything?
`FILTER(STR())` converts URIs to strings for comparison — this requires the triplestore to scan matching triples and apply a function to each. Angle brackets use the triple index directly. For large datasets, the performance difference matters.

---

## 6. Daemon Response Wrapping

### What we observed
The daemon at `packages/cli/src/daemon.ts:2231-2235` passes the handler result directly to `jsonResponse()`. The handler returns `{ body: EPCISQueryDocument, headers?: { link?: string } }`. Currently the daemon doesn't unwrap `body` or set the Link header.

### What happened
The tests work because `unwrapQueryDoc()` in the test helper handles both shapes. The "daemon returns EPCISQueryDocument directly" test passes because the daemon happens to not wrap it further — but it also doesn't set Link headers for pagination.

### What needs to happen
The daemon should:
1. Pass `basePath: '/api/epcis/events'` in the config
2. Set `result.headers.link` as an HTTP response header
3. Return `result.body` (not the full result) as the HTTP response body

---

## 7. Test Coverage for Blank Node Path

### Current state
The E2E test "event without eventID → still succeeds" verifies capture works (200 + UAL). But it doesn't verify the data is **queryable** afterward.

### What should be tested
A stronger test would:
1. Capture an event without `eventID`
2. Query for it (e.g., by `bizStep` or `epcList`)
3. Verify it appears in results with an auto-generated UUID as subject

### Why we didn't do it yet
The test would need to know what auto-UUID was assigned to query for the event — but the UUID is random. A workaround: query by the unique EPC value and verify events come back.

---

## Summary Table

| Issue | Status | Severity | Fix location |
|-------|--------|----------|-------------|
| Public-only publishing | Workaround (`{ public: content }`) | Medium | daemon.ts + private graph design |
| eventID optional/required | Comment to revisit | Low | handlers.ts |
| Blank node auto-UUID | Working but ugly inline code | Low | dkg-agent.ts → extract function |
| N-Quads literal quoting | Workaround (`unwrapLiteral`) | Medium | storage layer (oxigraph.ts) |
| Angle brackets + OPTIONAL | Proper fix, slightly redundant-looking | Low | query-builder.ts |
| Daemon response wrapping | Test accommodation | Medium | daemon.ts |
| Blank node query coverage | Missing | Low | e2e test |
