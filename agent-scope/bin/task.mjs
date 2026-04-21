#!/usr/bin/env node
// Active-task management CLI.

import {
  readFileSync, writeFileSync, unlinkSync, existsSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import {
  resolveRepoRoot, resolveActiveTaskId, loadTask, checkPath,
  normalizeToRepoPath, listTasks, validateManifest, checkNodeVersion,
  isBootstrapActive,
} from '../lib/scope.mjs';

try { checkNodeVersion(); }
catch (e) { console.error(e.message); process.exit(3); }

const root = resolveRepoRoot();
const tasksDir = resolve(root, 'agent-scope/tasks');
const activeFile = resolve(root, 'agent-scope/active');
const logsFile = resolve(root, 'agent-scope/logs/denials.jsonl');
const bootstrapToken = resolve(root, 'agent-scope/.bootstrap-token');

function bail(msg, code = 1) { console.error(`error: ${msg}`); process.exit(code); }

function bootstrapWarning() {
  if (isBootstrapActive(root)) {
    console.log('');
    console.log('!! BOOTSTRAP MODE ACTIVE — hardcoded path protection is DISABLED.');
    console.log(`!! Remove when done:  rm ${bootstrapToken}`);
    console.log('');
  }
}

// ---------------------------------------------------------------------------

function list() {
  const ids = listTasks(root);
  if (!ids.length) { console.log('(no task manifests found)'); return; }
  const { id: activeId } = resolveActiveTaskId(root);
  for (const id of ids) {
    let desc = '';
    try { desc = loadTask(root, id).description || ''; }
    catch { desc = '(invalid manifest — run: task validate ' + id + ')'; }
    const marker = id === activeId ? '* ' : '  ';
    console.log(`${marker}${id.padEnd(28)} ${desc}`);
  }
  bootstrapWarning();
}

function show() {
  const { id, source } = resolveActiveTaskId(root);
  if (!id) {
    console.log('No active task. Writes are unrestricted (except for protected paths).');
    console.log(`Set one with:  node agent-scope/bin/task.mjs set <id>`);
    bootstrapWarning();
    return;
  }
  const task = loadTask(root, id);
  console.log(`Active task:  ${task.id}`);
  console.log(`Description:  ${task.description || '(none)'}`);
  console.log(`Owner:        ${task.owner || '(unassigned)'}`);
  console.log(`Resolved via: ${source}`);
  console.log(`Manifest:     ${task.__path}`);
  if (task.__inheritedFrom && task.__inheritedFrom.length) {
    console.log(`Inherits:     ${task.__inheritedFrom.join(', ')}`);
  }
  console.log('');
  console.log('Allowed patterns:');
  for (const p of task.allowed || []) console.log(`  ${p.startsWith('!') ? '[deny] ' : '       '}${p}`);
  if (task.exemptions && task.exemptions.length) {
    console.log('Exemptions:');
    for (const p of task.exemptions) console.log(`  ${p.startsWith('!') ? '[deny] ' : '       '}${p}`);
  }
  if (task.notes) {
    console.log('');
    console.log('Notes:');
    console.log(`  ${task.notes.replace(/\n/g, '\n  ')}`);
  }
  bootstrapWarning();
}

function set(id) {
  if (!id) bail('usage: task set <id>');
  loadTask(root, id);
  writeFileSync(activeFile, `${id}\n`, 'utf8');
  console.log(`Active task set: ${id}`);
}

function clear() {
  if (existsSync(activeFile)) unlinkSync(activeFile);
  console.log('Active task cleared. Writes are unrestricted (except for protected paths).');
}

function check(p) {
  if (!p) bail('usage: task check <path>');
  const { id } = resolveActiveTaskId(root);
  const task = id ? loadTask(root, id) : null;
  const rel = normalizeToRepoPath(root, p);
  const decision = checkPath(task, rel, root);
  console.log(`${decision.padEnd(9)} ${rel}${id ? `  [task: ${id}]` : ''}`);
  if (decision === 'deny' || decision === 'protected') process.exit(1);
}

async function init(id) {
  if (!id) bail('usage: task init <id>');
  if (!/^[a-z0-9][a-z0-9-_.]{0,63}$/.test(id)) {
    bail(`invalid id: ${id} (must match /^[a-z0-9][a-z0-9-_.]{0,63}$/)`);
  }
  const manifestPath = resolve(tasksDir, `${id}.json`);
  if (existsSync(manifestPath)) bail(`manifest already exists: ${manifestPath}`);

  const rl = createInterface({ input, output, terminal: false });
  const buffered = [];
  const waiters = [];
  let closed = false;
  rl.on('line', line => {
    if (waiters.length) waiters.shift()(line);
    else buffered.push(line);
  });
  rl.on('close', () => {
    closed = true;
    while (waiters.length) waiters.shift()('');
  });
  const ask = (q) => new Promise(resolve => {
    output.write(q);
    if (buffered.length) return resolve(buffered.shift());
    if (closed) return resolve('');
    waiters.push(resolve);
  });

  try {
    const description = (await ask('Description (one line): ')).trim();
    const owner = (await ask('Owner (free-form, blank ok): ')).trim();
    const inheritsStr = (await ask('Inherit from (comma-separated task ids, blank for [base]): ')).trim();
    const inherits = inheritsStr
      ? inheritsStr.split(',').map(s => s.trim()).filter(Boolean)
      : (listTasks(root).includes('base') ? ['base'] : []);
    output.write('\n');
    output.write('Enter allowed glob patterns, one per line. Blank line to finish.\n');
    output.write('Tip: prefix a pattern with ! to explicitly deny (e.g. !**/secrets.*)\n');
    const allowed = [];
    for (;;) {
      const line = (await ask('allowed> ')).trim();
      if (!line) break;
      allowed.push(line);
    }
    if (allowed.length === 0 && inherits.length === 0) {
      rl.close();
      bail('at least one allowed pattern is required (unless you inherit from another task)');
    }

    output.write('\n');
    output.write('Enter additional exemption patterns. Blank to finish.\n');
    const exemptions = [];
    for (;;) {
      const line = (await ask('exempt > ')).trim();
      if (!line) break;
      exemptions.push(line);
    }
    const notes = (await ask('Notes (blank ok): ')).trim();

    const manifest = {
      id,
      description: description || undefined,
      owner: owner || undefined,
      created: new Date().toISOString(),
      inherits: inherits.length ? inherits : undefined,
      allowed: allowed.length ? allowed : undefined,
      exemptions: exemptions.length ? exemptions : undefined,
      notes: notes || undefined,
    };
    const cleaned = Object.fromEntries(Object.entries(manifest).filter(([,v]) => v !== undefined));
    const errs = validateManifest(cleaned, id);
    if (errs.length) { rl.close(); bail(`invalid manifest:\n  - ${errs.join('\n  - ')}`); }

    writeFileSync(manifestPath, JSON.stringify(cleaned, null, 2) + '\n', 'utf8');
    console.log('');
    console.log(`Created ${manifestPath}`);
    console.log(`Activate with:  node agent-scope/bin/task.mjs set ${id}`);
  } finally { rl.close(); }
}

// ---------------------------------------------------------------------------
// Task onboarding — `task start` prints a trigger the user pastes to chat;
// `task create` is the non-interactive manifest builder the onboarding flow
// ultimately runs. Both are designed so *the human* creates the manifest —
// an agent-invoked shell command that writes to agent-scope/tasks/ would be
// wiped by the afterShellExecution backstop.
// ---------------------------------------------------------------------------

const ONBOARD_TRIGGER =
  'agent-scope: start task onboarding. Please follow the Task onboarding ' +
  'protocol in CLAUDE.md: ask me to describe the task, explore the codebase, ' +
  'propose a scope via AskQuestion, and print the `pnpm task create` command ' +
  'for me to run once I approve.';

function start() {
  const { id: activeId } = resolveActiveTaskId(root);
  if (activeId) {
    console.log(`A task is already active: ${activeId}`);
    console.log(`Run \`pnpm task clear\` first if you want to start a new one.`);
    console.log(`Run \`pnpm task show\` to see its scope.`);
    bootstrapWarning();
    return;
  }
  console.log('agent-scope task onboarding');
  console.log('');
  console.log('Paste this line into your Cursor chat to begin:');
  console.log('');
  console.log('  ' + ONBOARD_TRIGGER);
  console.log('');
  console.log('The agent will:');
  console.log('  1. ask you to describe the task in detail');
  console.log('  2. explore the codebase for relevant files');
  console.log('  3. propose a scope via AskQuestion (plan-mode style)');
  console.log('  4. on approval, print the exact `pnpm task create` command');
  console.log('     for you to run here so the manifest is human-authored');
  console.log('');
  console.log('If you already know the scope, skip the dance:');
  console.log('  pnpm task create <id> --description "..." \\');
  console.log('    --allowed "packages/foo/**" --allowed "packages/bar/baz.ts" \\');
  console.log('    --inherits base --activate');
  bootstrapWarning();
}

function parseCreateArgs(argv) {
  const out = {
    id: null,
    description: null,
    owner: null,
    notes: null,
    inherits: null,
    allowed: [],
    exemptions: [],
    activate: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) bail(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--description': case '-d': out.description = next(); break;
      case '--owner':                  out.owner       = next(); break;
      case '--notes':                  out.notes       = next(); break;
      case '--inherits':               out.inherits    = next().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--allowed':   case '-a':   out.allowed.push(next()); break;
      case '--exemption': case '-e':   out.exemptions.push(next()); break;
      case '--activate':               out.activate = true; break;
      case '--force':                  out.force    = true; break;
      case '-h': case '--help':
        console.log([
          'usage: task create <id> [flags]',
          '',
          '  --description, -d <text>   short description',
          '  --owner <name>             free-form owner tag',
          '  --notes <text>             multi-line notes (use \\n)',
          '  --inherits <ids>           comma-separated parent task ids',
          '  --allowed, -a <glob>       add an allowed pattern (repeatable)',
          '  --exemption, -e <glob>     add an exemption pattern (repeatable)',
          '  --activate                 set as active task after creation',
          '  --force                    overwrite an existing manifest',
        ].join('\n'));
        process.exit(0);
      default:
        if (a.startsWith('-')) bail(`unknown flag: ${a}`);
        if (!out.id) { out.id = a; break; }
        bail(`unexpected positional arg: ${a}`);
    }
  }
  return out;
}

function create(argv) {
  const opts = parseCreateArgs(argv);
  if (!opts.id) bail('usage: task create <id> --description "..." --allowed "<glob>" [...]');
  if (!/^[a-z0-9][a-z0-9-_.]{0,63}$/.test(opts.id)) {
    bail(`invalid id: ${opts.id} (must match /^[a-z0-9][a-z0-9-_.]{0,63}$/)`);
  }
  const manifestPath = resolve(tasksDir, `${opts.id}.json`);
  if (existsSync(manifestPath) && !opts.force) {
    bail(`manifest already exists: ${manifestPath}\n  (pass --force to overwrite)`);
  }
  const inherits = opts.inherits !== null
    ? opts.inherits
    : (listTasks(root).includes('base') && opts.id !== 'base' ? ['base'] : []);

  if (opts.allowed.length === 0 && inherits.length === 0) {
    bail('at least one --allowed pattern is required (unless --inherits)');
  }

  const manifest = {
    id: opts.id,
    description: opts.description || undefined,
    owner: opts.owner || undefined,
    created: new Date().toISOString(),
    inherits: inherits.length ? inherits : undefined,
    allowed: opts.allowed.length ? opts.allowed : undefined,
    exemptions: opts.exemptions.length ? opts.exemptions : undefined,
    notes: opts.notes || undefined,
  };
  const cleaned = Object.fromEntries(Object.entries(manifest).filter(([,v]) => v !== undefined));
  const errs = validateManifest(cleaned, opts.id);
  if (errs.length) bail(`invalid manifest:\n  - ${errs.join('\n  - ')}`);

  writeFileSync(manifestPath, JSON.stringify(cleaned, null, 2) + '\n', 'utf8');
  console.log(`Created ${manifestPath}`);

  if (opts.activate) {
    loadTask(root, opts.id);
    writeFileSync(activeFile, `${opts.id}\n`, 'utf8');
    console.log(`Active task set: ${opts.id}`);
  } else {
    console.log(`Activate with:  pnpm task set ${opts.id}`);
  }
  bootstrapWarning();
}

function validate(one) {
  const ids = one ? [one] : listTasks(root);
  if (!ids.length) { console.log('(no manifests found)'); return; }
  let failed = 0;
  for (const id of ids) {
    const file = resolve(tasksDir, `${id}.json`);
    if (!existsSync(file)) { console.error(`missing: ${file}`); failed++; continue; }
    let raw, parsed;
    try { raw = readFileSync(file, 'utf8'); } catch (e) { console.error(`${id}: cannot read (${e.message})`); failed++; continue; }
    try { parsed = JSON.parse(raw); } catch (e) { console.error(`${id}: invalid JSON (${e.message})`); failed++; continue; }
    const errs = validateManifest(parsed, id);
    if (errs.length) {
      failed++;
      console.error(`${id}: INVALID`);
      for (const err of errs) console.error(`  - ${err}`);
      continue;
    }
    try {
      loadTask(root, id);
      console.log(`${id}: ok`);
    } catch (e) {
      failed++;
      console.error(`${id}: INVALID (inheritance)`);
      console.error(`  - ${e.message}`);
    }
  }
  if (failed) process.exit(1);
}

function audit(args) {
  let limit = 50;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--since' || a === '-n') { limit = parseInt(args[++i], 10) || 50; }
    else if (a === '-h' || a === '--help') { console.log('usage: task audit [--since N]'); return; }
  }
  if (!existsSync(logsFile)) { console.log('(no denials logged)'); return; }
  const lines = readFileSync(logsFile, 'utf8').split('\n').filter(Boolean);
  const tail = lines.slice(-limit);
  for (const line of tail) {
    try {
      const r = JSON.parse(line);
      console.log(`${r.ts}  ${(r.event || '-').padEnd(26)}  ${(r.task || '-').padEnd(20)}  ${r.path || r.command || ''}`);
    } catch {
      console.log(line);
    }
  }
  console.log(`\n(${tail.length} of ${lines.length} entries)`);
}

function resolveDebug() {
  console.log(`repo root:   ${root}`);
  console.log(`env:         AGENT_SCOPE_TASK=${process.env.AGENT_SCOPE_TASK || '(unset)'}`);
  console.log(`             AGENT_SCOPE_BOOTSTRAP=${process.env.AGENT_SCOPE_BOOTSTRAP || '(unset)'}`);
  console.log(`bootstrap:   ${isBootstrapActive(root) ? 'ACTIVE' : 'inactive'} (token: ${existsSync(bootstrapToken) ? 'present' : 'absent'})`);
  const activeStr = existsSync(activeFile) ? readFileSync(activeFile, 'utf8').trim() : '(none)';
  console.log(`file:        ${activeFile} → ${activeStr}`);
  const { id, source } = resolveActiveTaskId(root);
  console.log(`resolved:    ${id || '(none)'}  (source: ${source})`);
}

// ---------------------------------------------------------------------------

const [cmd, ...rest] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'list':     list(); break;
    case 'show':
    case undefined:
    case null:
    case '':         show(); break;
    case 'set':      set(rest[0]); break;
    case 'clear':    clear(); break;
    case 'check':    check(rest[0]); break;
    case 'init':     await init(rest[0]); break;
    case 'start':    start(); break;
    case 'create':   create(rest); break;
    case 'validate': validate(rest[0]); break;
    case 'audit':    audit(rest); break;
    case 'resolve':  resolveDebug(); break;
    case '-h': case '--help': case 'help':
      console.log([
        'usage: task <command> [args]',
        '',
        '  start              begin guided onboarding (prints a chat trigger)',
        '  list               list available task manifests',
        '  show               show the active task and its scope',
        '  set <id>           set the active task',
        '  clear              clear the active task',
        '  check <path>       check a path against the active task',
        '  init <id>          create a new task manifest interactively',
        '  create <id> [...]  create a manifest non-interactively (flags)',
        '  validate [<id>]    validate one or all manifests',
        '  audit [--since N]  show recent denials from the audit log',
        '  resolve            debug: show how the active task is resolved',
      ].join('\n'));
      break;
    default:
      bail(`unknown command: ${cmd}\nrun: task --help`, 2);
  }
} catch (e) {
  bail(e.message);
}
