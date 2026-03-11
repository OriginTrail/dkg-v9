# OpenClaw Benchmark: Agent Collaboration over DKG

## Goal

Measure whether collaboration substrate changes the speed/cost frontier for coding swarms.

This is not just a tooling benchmark. It is a collaboration experiment:
- How agents discover and share knowledge
- How quickly they converge on implementations
- How consistently they deliver across features

## Experiment Arms

- **Control:** 1 agent, no DKG
- **Exp-A:** 1 agent, DKG via raw SPARQL (`dkg_query`)
- **Exp-A2:** 1 agent, DKG semantic wrappers
- **Exp-P:** 4 agents parallel, shared markdown coordination, **no DKG** (parallel control)
- **Exp-B2:** 4 agents parallel, semantic wrappers
- **Exp-AB:** 4 agents parallel, SPARQL-only DKG
- **Exp-C1:** 4 agents parallel, workspace shared-memory log + DKG query
- **Exp-C2:** 4 agents parallel, full DKG publish/query in shared paranet

## Overall Results

| Metric | Control | Exp-A | Exp-A2 | **Exp-P** | Exp-B2 | Exp-AB | Exp-C1 | Exp-C2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Completion | 7/8 | 8/8 | 7/8 | **7/8** | 8/8 | 6/8 | 7/8 | 8/8 |
| Total cost | $11.58 | $11.31 | $21.10 | **$14.57** | $20.26 | $13.87 | $20.57 | $21.45 |
| Cost vs Control | — | -2% | +82% | **+26%** | +75% | +20% | +78% | +85% |
| Wall time | 38m | 38m | 73m | **17m** | 21m | 22m | 26m | 20m |
| Time vs Control | — | +0% | +92% | **-55%** | -46% | -43% | -32% | -47% |
| $/successful feature | $1.65 | $1.41 | $3.01 | **$2.08** | $2.53 | $2.31 | $2.94 | $2.68 |
| Turns (successful) | 205 | 158 | 277 | **317** | 353 | 195 | 353 | 380 |
| Cache-read tokens | 9.3M | 4.6M | 13.6M | **18.9M** | 17.5M | 7.9M | 21.2M | 19.8M |

## Per-Feature Cost with Precise Deltas (vs Control)

| Feature | Control | Exp-A | Exp-A2 | **Exp-P** | Exp-B2 | Exp-AB |
|---|---:|---:|---:|---:|---:|---:|
| X/Twitter DM channel | $1.08 | $2.70 (+151%) | FAIL | **$2.65 (+145%)** | $3.38 (+214%) | $1.59 (+48%) |
| Pinecone memory backend | $1.75 | $0.83 (-53%) | $1.71 (-2%) | **$1.99 (+14%)** | $2.16 (+23%) | $1.99 (+14%) |
| Sessions export CLI | $1.69 | $1.44 (-15%) | $6.04 (+256%) | **$1.77 (+5%)** | $2.62 (+54%) | FAIL |
| Webhook delivery logging | $1.14 | $0.98 (-14%) | $2.41 (+111%) | **$1.00 (-13%)** | $1.88 (+65%) | $2.16 (+90%) |
| Reddit channel | FAIL | FAIL | FAIL | **$1.56 (Control FAIL)** | FAIL | FAIL |
| Matrix channel card | $1.33 | $1.47 (+10%) | $1.68 (+26%) | **$1.89 (+42%)** | $1.98 (+49%) | $1.86 (+39%) |
| Session archiving | $2.88 | $0.67 (-77%) | $2.51 (-13%) | **FAIL** | $1.83 (-36%) | $1.72 (-40%) |
| Mistral portal auth | $1.71 | $0.52 (-70%) | $2.11 (+24%) | **$1.09 (-36%)** | $3.17 (+86%) | $2.13 (+25%) |

## Why Those Deltas Happened (Reasoning by Feature)

| Feature | Exp-A delta reason | Exp-A2 delta reason | Exp-B2 delta reason | Exp-AB delta reason |
|---|---|---|---|---|
| X/Twitter DM | **+151%**: cold-start SPARQL learning + greenfield OAuth+DM surface area | fail (API refusal) | **+214%**: parallel agent, 51-turn exploratory loop, high cache-read | **+48%**: still greenfield, but SPARQL-only toolset reduced tool-churn vs B2 |
| Pinecone backend | **-53%**: strong reuse from memory-lancedb pattern via targeted SPARQL | **-2%**: semantic wrappers helped locate files but still extra tool turns | **+23%**: parallel context rebuilt independently | **+14%**: parallel overhead remains, but tighter SPARQL queries than B2 |
| Sessions export CLI | **-15%**: direct query-to-command wiring | **+256%**: semantic loop over-explored CLI command graph | **+54%**: parallel isolation + broader validation | fail (API 500) |
| Webhook logging | **-14%**: good module targeting in gateway methods | **+111%**: many wrapper calls + broader edge-case expansion | **+65%**: independent agent context and larger output | **+90%**: parallel overhead plus schema/endpoint churn |
| Matrix channel card | **+10%**: slight extra exploration over control | **+26%**: wrapper-driven over-querying | **+49%**: high turn count from UI state branching | **+39%**: better than B2, but still parallel rebuild cost |
| Session archiving | **-77%**: best SPARQL payoff; direct method hit and fast edits | **-13%**: semantic still okay but less direct than raw query | **-36%**: parallel still faster once path known | **-40%**: parallel + SPARQL concentrated search |
| Mistral auth | **-70%**: excellent reuse from analogous auth extensions | **+24%**: wrapper overhead masked reuse gains | **+86%**: large parallel exploration and retries | **+25%**: lower than B2 but still above control |

## Collaboration-Specific C1 vs C2

Run IDs:
- C1: `c1-20260302-234121`
- C2: `c2-20260303-001039`

| Metric | C1 Workspace Collaboration | C2 Full Publishing |
|---|---:|---:|
| Completion | 7/8 | 8/8 |
| Total cost | $20.57 | $21.45 |
| Total turns | 353 | 380 |
| Cache read tokens | 21,175,794 | 19,785,478 |
| Cost consistency (CV, lower better) | 0.247 | 0.319 |
| Turn consistency (CV, lower better) | 0.111 | 0.113 |
| Collaboration signal | 13 shared-log entries | 14 run-scoped published entities |

Interpretation:
- **C2 improved reliability** (8/8), and reduced cache-read despite slightly higher total cost.
- **C1 was cheaper and more cost-consistent**, but had one failure.
- Publishing collaboration did produce shared graph artifacts; in this run, the benefit showed up more in completion than raw cost.

## Experiment P: Parallel Control (Completed)

**Purpose:** Exp-AB showed -43% wall time vs Control, but that advantage bundles two
variables: parallelism *and* DKG. Exp-P isolates pure parallelism by running 4
agents with shared markdown coordination but **no DKG access**.

Run ID: `p-20260309-152726`

### Comparison Matrix (Completed)

|                  | Sequential     | 4 Parallel     |
|------------------|----------------|----------------|
| **No DKG**       | Control (38m)  | **Exp-P (17m)**|
| **DKG + SPARQL** | Exp-A (38m)    | Exp-AB (22m)   |

### Per-Feature Results

| Feature | Cost | Turns | Duration | Status |
|---|---:|---:|---:|---|
| X/Twitter DM channel | $2.65 | 63 | 560s | OK |
| Pinecone memory backend | $1.99 | 37 | 406s | OK |
| Sessions export CLI | $1.77 | 44 | 362s | OK |
| Webhook delivery logging | $1.00 | 28 | 181s | OK |
| Reddit channel | $1.56 | 44 | 386s | OK |
| Matrix channel card | $1.89 | 56 | 418s | OK |
| Session archiving | $2.62 | 51 | 347s | FAIL (max turns) |
| Mistral portal auth | $1.09 | 45 | 212s | OK |
| **TOTAL** | **$14.57** | **368** | **17m** | **7/8** |

### Key Comparison: Exp-AB vs Exp-P (DKG Effect at Equal Parallelism)

| Metric | Exp-P (no DKG) | Exp-AB (DKG) | Exp-AB vs Exp-P |
|---|---:|---:|---|
| Completion | 7/8 | 6/8 | -14% (worse) |
| Total cost | $14.57 | $13.87 | **-5%** (cheaper) |
| Wall time | 17m | 22m | **+29%** (slower) |
| $/successful feature | $2.08 | $2.31 | +11% (more expensive) |
| Cache-read tokens | 18.9M | 7.9M | **-58%** (far less exploration) |
| Coordination entries | 15 (markdown) | n/a (SPARQL) | — |

### Interpretation

1. **Parallelism alone explains most of the speed gain.** Exp-P is actually 55% faster
   than Control (17m vs 38m) compared to Exp-AB's 43%. Without DKG query overhead,
   raw parallel agents are *faster*.

2. **DKG massively reduces redundant exploration.** Exp-AB used 58% fewer cache-read
   tokens than Exp-P (7.9M vs 18.9M). The code graph genuinely helps agents navigate
   the codebase more efficiently.

3. **DKG's token savings don't translate to wall-time savings in parallel mode.** The
   SPARQL query latency overhead offsets the exploration savings. This suggests DKG's
   value in parallel setups is primarily *cost efficiency at scale* rather than speed.

4. **Cost per feature is better without DKG.** Exp-P's $2.08/feature vs Exp-AB's
   $2.31/feature, because Exp-P completed more features (7 vs 6) and spent less per
   agent on tooling overhead.

5. **Reddit channel: only parallel arms completed it.** Both Exp-P and (some other
   parallel arms) succeeded where sequential Control and Exp-A timed out. This
   suggests the Reddit feature has a high fixed exploration cost that benefits from
   parallel isolation.

### Updated Conclusion

The original hypothesis — "Exp-AB's speed comes from DKG" — is **refuted**. The speed
advantage is purely from parallelism. However, DKG provides a clear **token efficiency**
benefit (-58% cache reads) that would compound at larger codebase scale or with
cost-constrained budgets. The right framing is:

- **Parallelism = speed lever** (use more agents)
- **DKG = cost lever** (each agent explores less)

## Conclusions

1. **Raw SPARQL remains the strongest cost primitive** for single-agent flow (Exp-A).
2. **Parallelism is the dominant speed lever** — Exp-P (17m) is the fastest arm overall.
3. **DKG is a token-efficiency lever, not a speed lever** (Exp-AB: -58% cache reads vs Exp-P, but +29% wall time).
4. **Collaboration method changes outcome shape**:
   - workspace memory (C1): lower cost variance
   - full graph publishing (C2): better completion reliability
5. **Best frontier depends on objective**:
   - minimum cost: Exp-A (sequential + DKG)
   - maximum throughput: Exp-P (parallel, no DKG)
   - best cost/throughput balance: Exp-AB (parallel + DKG)
   - strongest collaboration artifact traceability: C2
6. **DKG value scales with codebase size.** The 58% cache-read reduction suggests that
   for larger codebases (or cost-constrained budgets), DKG's exploration savings will
   eventually outweigh its query overhead.

## Future Ideas

### 1) Smaller-model collaboration hypothesis (new)

Question: could smaller models become net-better when paired with a rich shared graph?

Hypothesis:
- Smaller models are worse at broad exploration but can perform well with precise retrieval.
- DKG collaboration can act as an externalized reasoning/cache substrate, narrowing tasks enough for smaller models.

Experiment design:
- Re-run Control vs Exp-A vs Exp-C2 with at least one smaller model tier.
- Keep identical tasks and turn budgets.
- Compare:
  - cost per successful feature
  - completion
  - consistency CV
  - dependency on shared artifacts (queries hitting previously published entities)

Success condition:
- Smaller model + C2 beats larger-model Control on either cost-per-success or reliability-at-fixed-budget.

### 2) Stronger collaboration enforcement

- Require publish/query checkpoints with hard fail if missing.
- Add schema validation for published decision entities.
- Add explicit dependency edges between decisions and files changed.

### 3) Reliability controls

- Add retry policy for transient API failures/timeouts.
- Separate infrastructure failures from reasoning failures in scoring.

## Experiment D: Same-Task Swarm (MD vs DKG)

Purpose: test true swarm collaboration where 4 agents work on one interdependent
task (API, core orchestration, UI, tests), instead of separate features.

Run IDs:
- D1 (shared markdown): `d1-20260303-083320`
- D2 (DKG publish/query): `d2-20260303-085254`

| Metric | D1 (Shared MD) | D2 (DKG publish/query) | D2 vs D1 |
|---|---:|---:|---:|
| Stream completion | 3/4 | 4/4 | +33% reliability |
| Total cost | $13.92 | $10.15 | -27% |
| Total turns | 172 | 203 | +18% |
| Cache-read tokens | 12,063,106 | 9,596,499 | -20% |
| Cost consistency CV (lower better) | 0.228 | 0.320 | worse (+40%) |
| Turn consistency CV (lower better) | 0.156 | 0.308 | worse (+97%) |
| Collaboration artifacts | 12 MD entries | 12 published DKG entities | parity |
| Wall time | 15m 28s | 11m 46s | -24% |

Interpretation:
- D2 won on **speed, cost, completion, and cache efficiency** for this same-task swarm.
- D1 had lower variance among successful streams, but suffered one timeout and higher
  total cost from longer-running coordination.
- DKG collaboration appears to reduce duplicate context loading and improve routing to
  shared state, even when the swarm is operating on one overlapping objective.

Next improvement for D:
- Add checkpoint compliance scoring (plan/decision/handoff completeness per stream).
- Track conflict/rework explicitly (interface contradictions and rollback edits).
- Run at N=8 to stress decentralized coordination and observe scaling curve.

## Experiment D (Apples-to-Apples): D1A/D2A on 8-feature suite

To make D1/D2 directly comparable with prior arms, we ran:
- **D1A:** shared Markdown collaboration protocol across the same 8 benchmark features.
- **D2A:** DKG publish/query collaboration protocol across the same 8 benchmark features.

Run IDs:
- D1A: `d1a-20260303-091815`
- D2A: `d2a-20260303-094616`

Totals:
- **D1A:** 8/8 success, $21.98 total, 424 turns
- **D2A:** 5/8 success, $21.92 total, 246 turns

Per-feature (cost / turns):

| Feature | Control | Exp-A | Exp-A2 | **Exp-P** | Exp-B2 | Exp-AB | Exp-C1 | Exp-C2 | Exp-D1A | Exp-D2A |
|---|---|---|---|---|---|---|---|---|---|---|
| X/Twitter DM channel | $1.08 / 21t | $2.70 / 22t | FAIL | **$2.65 / 63t** | $3.38 / 51t | $1.59 / 34t | FAIL | $1.90 / 53t | $3.17 / 63t | $2.98 / 59t |
| Pinecone memory backend | $1.75 / 31t | $0.83 / 23t | $1.71 / 29t | **$1.99 / 37t** | $2.16 / 36t | $1.99 / 14t | $2.31 / 42t | $1.97 / 41t | $1.75 / 37t | $2.02 / 39t |
| Sessions export CLI | $1.69 / 30t | $1.44 / 33t | $6.04 / 23t | **$1.77 / 44t** | $2.62 / 14t | FAIL | $2.97 / 51t | $2.54 / 46t | $2.59 / 49t | $2.25 / 46t |
| Webhook delivery logging | $1.14 / 23t | $0.98 / 21t | $2.41 / 51t | **$1.00 / 28t** | $1.88 / 49t | $2.16 / 27t | $2.36 / 47t | $2.97 / 51t | $2.62 / 51t | $2.65 / 51t |
| Reddit channel | FAIL | $2.70 / 9t | $3.93 / 29t | **$1.56 / 44t** | $3.23 / 28t | FAIL | $2.79 / 49t | $4.47 / 49t | $5.03 / 64t | FAIL |
| Matrix channel card | $1.33 / 24t | $1.47 / 29t | $1.68 / 57t | **$1.89 / 56t** | $1.98 / 65t | $1.86 / 42t | $3.33 / 51t | $2.50 / 52t | $1.75 / 44t | FAIL |
| Session archiving | $2.88 / 51t | $0.67 / 11t | $2.51 / 51t | **FAIL** | $1.83 / 38t | $1.72 / 26t | $4.48 / 51t | $3.37 / 51t | $2.68 / 51t | $2.71 / 51t |
| Mistral portal auth | $1.71 / 25t | $0.52 / 10t | $2.11 / 37t | **$1.09 / 45t** | $3.17 / 72t | $2.13 / 52t | $2.32 / 62t | $1.72 / 37t | $2.41 / 65t | FAIL |
