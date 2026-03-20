# CCL v0.1 — Corroboration & Consensus Language

CCL is a **small deterministic adjudication language** for evaluating corroboration, contradiction, and promotion conditions over a fixed DKG snapshot.

It is designed to align with the DKG v9 axioms:

- paranet-scoped evaluation
- authority-aware facts
- typed transitions outside the language
- canonical publish as the only ingress into authoritative shared state
- deterministic conflict handling
- explicit view / snapshot boundaries

## What CCL is for

CCL is for evaluating questions like:

- does claim `C` have enough independent support?
- is claim `C` disputed by an accepted contradiction?
- is claim `C` promotable under the current quorum / epoch?
- is an owner-scoped assertion signed by the correct authority?

CCL is **not** a general reasoning engine and **not** an LLM-facing tool language.

## Trustless-network constraints

CCL v0.1 is intentionally restricted:

- no recursion
- no external I/O
- no model calls
- no floating-point math
- no wall-clock access
- no hidden heuristics
- only explicit published facts in a declared snapshot/view
- decisions are **proposals**, not state changes

## Package layout

- `LANGUAGE_SPEC.md` — language design and semantics
- `SURFACE_SYNTAX.md` — human-friendly DSL shape
- `grammar.ebnf` — small EBNF for the surface syntax
- `policies/` — canonical YAML policies used by the reference evaluator
- `examples/` — surface-language examples
- `evaluator/reference_evaluator.py` — tiny deterministic evaluator for the canonical YAML format
- `evaluator/reference_evaluator.js` — JavaScript port of the reference evaluator
- `tests/cases/` — test cases with expected derived facts and decisions
- `tests/run_all_tests.py` — executes the bundled test cases
- `tests/run_all_tests.js` — executes the bundled test cases with Node.js

## Canonical evaluation model

The reference evaluator consumes a canonical YAML policy format. This is deliberate:

- human authors may write surface CCL
- nodes should evaluate a normalized canonical form
- canonical form is easier to serialize, audit, hash, and replay

## Running the tests

```bash
python tests/run_all_tests.py
```

Or with Node.js from the `ccl_v0_1` directory:

```bash
pnpm test
```

From the project root, or:

```bash
python evaluator/reference_evaluator.py policies/context_corroboration.yaml tests/cases/03_context_minimal_corroboration.yaml
```

JavaScript evaluator:

```bash
node evaluator/reference_evaluator.js policies/context_corroboration.yaml tests/cases/03_context_minimal_corroboration.yaml --check
```

## Output model

CCL produces two kinds of outputs:

1. **Derived predicates**
   - e.g. `corroborated(c1)`, `promotable(c1)`, `owner_asserted(p1)`

2. **Decisions**
   - e.g. `propose_accept(c1)`, `propose_reject(c2)`

A decision is still **non-authoritative** until a normal DKG `PUBLISH` introduces it as a typed transition into shared state.

## Included policies

### 1. `owner_assertion`
Simple owner-scope adjudication:
- a claim is owner-asserted if the signer matches the declared owner

### 2. `context_corroboration`
Context-governed corroboration + promotion:
- at least two independent accepted supports
- at least one accepted vendor-class support
- no accepted contradiction
- matching claim epoch and quorum epoch
- quorum reached at 3-of-4

## Included test coverage

- single-owner valid signature
- single-owner invalid signature
- minimal corroboration
- missing vendor support
- workspace-only evidence excluded from accepted view
- accepted contradiction blocks promotion
- epoch mismatch blocks promotion
- successful quorum-based promotion

## Suggested next steps

- add a canonical CBOR serialization
- add Merkleizable rule / policy hashing
- add rule-set version negotiation
- add policy signatures / authority binding
- add bounded provenance traces as first-class evaluation outputs
