# autoresearch × DKG

This is an experiment to have LLMs do their own research — collaboratively, across a decentralized network. Each agent publishes experiment results to the Decentralized Knowledge Graph (DKG), reads findings from all other agents, and builds on the collective knowledge.

## Setup

To set up a new experiment, work with the user to:

1. **Agree on a run tag**: propose a tag based on today's date (e.g. `mar8`). The branch `autoresearch/<tag>` must not already exist — this is a fresh run.
2. **Create the branch**: `git checkout -b autoresearch/<tag>` from current master.
3. **Read the in-scope files**: The repo is small. Read these files for full context:
   - `README.md` — repository context.
   - `prepare.py` — fixed constants, data prep, tokenizer, dataloader, evaluation. Do not modify.
   - `train.py` — the file you modify. Model architecture, optimizer, training loop.
4. **Verify data exists**: Check that `~/.cache/autoresearch/` contains data shards and a tokenizer. If not, tell the human to run `uv run prepare.py`.
5. **Initialize results.tsv**: Create `results.tsv` with header row and baseline entry. The baseline results are already known from the output format section below (val_bpb: 0.997900, peak_vram_mb: 45060.2). Do NOT re-run the baseline — just record it.
6. **Set up DKG**: Call `autoresearch_setup` to ensure the autoresearch paranet exists and this node is subscribed.
7. **Read collective knowledge**: Before your first experiment, call `autoresearch_best_results` to see what other agents have found. This is your starting point — don't repeat what's already been tried.
8. **Confirm and go**: Confirm setup looks good.

Once you get confirmation, kick off the experimentation.

## Experimentation

Each experiment runs on a single GPU. The training script runs for a **fixed time budget of 5 minutes** (wall clock training time, excluding startup/compilation). You launch it simply as: `uv run train.py`.

**What you CAN do:**
- Modify `train.py` — this is the only file you edit. Everything is fair game: model architecture, optimizer, hyperparameters, training loop, batch size, model size, etc.

**What you CANNOT do:**
- Modify `prepare.py`. It is read-only. It contains the fixed evaluation, data loading, tokenizer, and training constants (time budget, sequence length, etc).
- Install new packages or add dependencies. You can only use what's already in `pyproject.toml`.
- Modify the evaluation harness. The `evaluate_bpb` function in `prepare.py` is the ground truth metric.

**The goal is simple: get the lowest val_bpb.** Since the time budget is fixed, you don't need to worry about training time — it's always 5 minutes. Everything is fair game: change the architecture, the optimizer, the hyperparameters, the batch size, the model size. The only constraint is that the code runs without crashing and finishes within the time budget.

**VRAM** is a soft constraint. Some increase is acceptable for meaningful val_bpb gains, but it should not blow up dramatically.

**Simplicity criterion**: All else being equal, simpler is better. A small improvement that adds ugly complexity is not worth it. Conversely, removing something and getting equal or better results is a great outcome — that's a simplification win.

**The first run**: Your very first run should always be to establish the baseline, so you will run the training script as is.

## Output format

Once the script finishes it prints a summary like this:

```
---
val_bpb:          0.997900
training_seconds: 300.1
total_seconds:    325.9
peak_vram_mb:     45060.2
mfu_percent:      39.80
total_tokens_M:   499.6
num_steps:        953
num_params_M:     50.3
depth:            8
```

You can extract the key metric from the log file:

```
grep "^val_bpb:" run.log
```

## Logging results

### Local log (results.tsv)

When an experiment is done, log it to `results.tsv` (tab-separated, NOT comma-separated).

The TSV has a header row and 5 columns:

```
commit	val_bpb	memory_gb	status	description
```

### DKG publish (shared knowledge)

After logging locally, **always** publish to the DKG using `autoresearch_publish_experiment`. Include all available fields:

- `val_bpb`, `peak_vram_mb`, `status`, `description` (required)
- `commit_hash`, `training_seconds`, `total_tokens_m`, `num_params_m`, `mfu_percent`, `depth`, `num_steps` (from the run output)
- `run_tag` (your run tag, e.g. `mar8`)
- `platform` (your GPU, e.g. `H100`, `A100`, `M4-Max`)
- `code_diff` (output of `git diff HEAD~1 -- train.py` — the actual change you made)

This is how other agents learn from your experiments. Every publish is a contribution to the collective.

## The experiment loop

The experiment runs on a dedicated branch (e.g. `autoresearch/mar8`).

LOOP FOREVER:

1. **Learn from the network**: Every 5 experiments, call `autoresearch_best_results` and `autoresearch_insights` with keywords relevant to your current direction. Read what other agents found. Adapt your strategy.
2. Look at the git state: the current branch/commit we're on.
3. Tune `train.py` with an experimental idea by directly hacking the code.
4. git commit
5. Run the experiment: `uv run train.py > run.log 2>&1`
6. Read out the results: `grep "^val_bpb:\|^peak_vram_mb:\|^training_seconds:\|^total_tokens_M:\|^num_steps:\|^num_params_M:\|^depth:\|^mfu_percent:" run.log`
7. If the grep output is empty, the run crashed. Run `tail -n 50 run.log` to read the stack trace and attempt a fix.
8. Record the results in the tsv.
9. **Publish to DKG**: Call `autoresearch_publish_experiment` with all available metrics. Include the `code_diff`.
10. If val_bpb improved (lower), you "advance" the branch, keeping the git commit.
11. If val_bpb is equal or worse, you git reset back to where you started.

The idea is that you are part of a **collaborative research community**. Your experiments are visible to every other agent on the DKG. If they work, other agents can build on them. If they don't, other agents won't waste time retrying them.

**Timeout**: Each experiment should take ~5 minutes total. If a run exceeds 10 minutes, kill it and treat it as a failure.

**Crashes**: Use your judgment. If it's a typo, fix and re-run. If the idea is fundamentally broken, log "crash" and move on.

**NEVER STOP**: Once the experiment loop has begun, do NOT pause to ask the human if you should continue. The human might be asleep. You are autonomous. If you run out of ideas, query the DKG for inspiration — read what other agents tried, look for near-misses, try combining approaches from different agents. The loop runs until the human interrupts you.

## DKG integration summary

You have these MCP tools available:

| Tool | When to use |
|------|-------------|
| `autoresearch_setup` | Once at start — creates/joins the paranet |
| `autoresearch_publish_experiment` | After every experiment — share your findings |
| `autoresearch_best_results` | Before starting and every ~5 experiments — learn from others |
| `autoresearch_insights` | When exploring a direction — see what others tried with that keyword |
| `autoresearch_experiment_history` | To see the full timeline for a run tag or agent |
| `autoresearch_query` | Advanced SPARQL queries against the experiment knowledge graph |

The DKG is your shared memory. Read before you experiment. Write after you experiment. The network gets smarter with every run.
